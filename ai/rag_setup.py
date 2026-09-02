import os
import time
import hashlib
import datetime
import json
import argparse
import chromadb
from langchain_core.documents import Document

# Was DirectOllamaEmbeddings, pointed at a local Ollama server -- this
# script has its OWN embeddings instantiation, separate from app.py's, so
# switching app.py to Gemini embeddings alone didn't fix this file. Both
# now need to agree on the same embedding space, or ChromaDB ends up with
# vectors from one provider being queried by another -- which doesn't
# error, it just returns nonsense-similar results that look like real hits.
# That's exactly what caused a fabricated answer citing a documentation-
# placeholder IP (203.0.113.5) instead of saying "no data available."
from langchain_google_genai import GoogleGenerativeAIEmbeddings

# ── CONFIG ──────────────────────────────────────────────────────────────────
USEFUL_TYPES = {"alert", "dns", "http", "tls", "flow"}
MAX_EVENTS   = 5000

# Gemini's embedding API is rate-limited by tokens-per-minute (generous --
# 10M/min on the free tier) rather than a strict request count the way chat
# models are, but the exact per-call batch size limit isn't clearly
# documented. Rather than trust embed_documents() to chunk ~5100 texts
# safely on its own, this batches explicitly and predictably -- same
# reasoning that already moved this script away from from_documents()
# once before (see the comment further down).
EMBED_BATCH = 100
# Confirmed by a real 429 in production: Gemini's free embedding tier caps
# at 100 requests/minute. 1s between ~51 sequential batch calls wasn't
# enough margin -- especially since the client library's own internal
# retry logic (visible in the traceback as tenacity frames) burns through
# the quota faster than the batch count alone suggests, retrying before
# ever surfacing the error to this script. 2s base delay plus the explicit
# backoff-and-retry below (rather than just a longer fixed delay) is the
# actual fix -- it recovers from a quota hit instead of crashing the whole
# rebuild over it.
EMBED_BATCH_DELAY_SECONDS = 2
MAX_RATE_LIMIT_RETRIES = 5
RATE_LIMIT_BACKOFF_SECONDS = 60  # Gemini's own error message suggested ~48s; padded for safety

# Paths
ALL_LOGS_PATH   = "../logs/eve.json"
TRAIN_LOGS_PATH = "../logs/train_logs.json"
ZEEK_CONN_PATH  = "../logs/conn.log"
CHROMA_DB_PATH  = "./chroma_db"
# ────────────────────────────────────────────────────────────────────────────

# Parse argument: --mode train OR --mode full (default: full)
parser = argparse.ArgumentParser()
parser.add_argument("--mode", choices=["full", "train"], default="full",
                    help="full = all logs, train = training set only (80%%)")
args = parser.parse_args()

if args.mode == "train":
    LOG_SOURCE = TRAIN_LOGS_PATH
    print("🎓 TRAINING MODE — loading train_logs.json (80% of logs)")
else:
    LOG_SOURCE = ALL_LOGS_PATH
    print("📦 FULL MODE — loading all logs from eve.json")

def format_event(event):
    etype = event.get("event_type", "unknown")
    src   = event.get("src_ip", "unknown")
    dst   = event.get("dest_ip", "unknown")
    sport = event.get("src_port", "?")
    dport = event.get("dest_port", "?")
    ts    = event.get("timestamp", "unknown")
    proto = event.get("proto", "unknown")

    text  = f"Event: {etype} | Time: {ts} | Protocol: {proto}\n"
    text += f"Source: {src}:{sport} → Destination: {dst}:{dport}\n"

    if etype == "alert":
        alert = event.get("alert", {})
        text += f"Alert: {alert.get('signature', 'unknown')}\n"
        text += f"Severity: {alert.get('severity', '?')}\n"
        text += f"Category: {alert.get('category', '?')}\n"

    if etype == "dns":
        dns = event.get("dns", {})
        text += f"DNS Query: {dns.get('rrname', '?')}\n"

    if etype == "http":
        http = event.get("http", {})
        text += f"HTTP: {http.get('http_method','?')} {http.get('hostname','?')}{http.get('url','?')}\n"

    if etype == "tls":
        tls = event.get("tls", {})
        text += f"TLS SNI: {tls.get('sni', '?')}\n"

    return text.strip()


# //ZEEK FORMATTER FUNCTION

def format_zeek_conn(line):
    if line.startswith("#"):
        return None
    parts = line.strip().split("\t")
    if len(parts) < 10:
        return None
    try:
        from datetime import datetime, timezone
        ts = datetime.fromtimestamp(float(parts[0]), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        text  = f"Event: zeek_conn | Time: {ts} | Protocol: {parts[6]}\n"
        text += f"Source: {parts[2]}:{parts[3]} → Destination: {parts[4]}:{parts[5]}\n"
        text += f"Duration: {parts[8]}s | Bytes sent: {parts[9]} | State: {parts[11] if len(parts) > 11 else 'unknown'}\n"
        return text.strip()
    except:
        return None


def load_logs(path):
    docs = []
    seen = set()
    with open(path, "r") as f:
        for line in f:
            try:
                event = json.loads(line)
                if event.get("event_type") not in USEFUL_TYPES:
                    continue
                text = format_event(event)
                if text in seen:
                    continue
                seen.add(text)
                docs.append(Document(
                    page_content=text,
                    metadata={
                        "event_type": event.get("event_type", ""),
                        "src_ip":     event.get("src_ip", ""),
                        "dest_ip":    event.get("dest_ip", ""),
                        "timestamp":  event.get("timestamp", ""),
                        "date":       event.get("timestamp", "")[:10],
                        "hour":       event.get("timestamp", "")[11:13],
                        "split":      "train" if args.mode == "train" else "full"
                    }
                ))
            except:
                continue
    # eve.json is chronological (oldest first). Previously this loop broke
    # as soon as MAX_EVENTS was reached, which meant the OLDEST events won
    # once the file grew past the cap -- SIRA would get permanently stuck
    # reasoning about old data and blind to everything newer from that point
    # on. Keeping the most recent MAX_EVENTS instead means the cap always
    # reflects current activity, not whichever events happened to come first
    # the day the threshold was first crossed.
    if len(docs) > MAX_EVENTS:
        docs = docs[-MAX_EVENTS:]
    return docs


def load_zeek_conns(path, max_events=100):
    docs = []
    seen = set()
    if not os.path.exists(path):
        print(f"Zeek conn.log not found at {path} - skipping zeek connections")
        return docs
    with open(path, "r") as f:
        for line in f:
            text = format_zeek_conn(line)
            if not text or text in seen:
                continue
            seen.add(text)
            parts = line.strip().split("\t")
            try:
                ts = datetime.fromtimestamp(float(parts[0]), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
            except:
                ts = parts[0] if len(parts) > 0 else ""
            docs.append(Document(
                page_content=text,
                metadata={
                    "event_type": "zeek_conn",
                    "src_ip":     parts[2] if len(parts) > 2 else "",
                    "dest_ip":    parts[4] if len(parts) > 4 else "",
                    "timestamp":  parts[0] if len(parts) > 0 else "",
                    "date":       ts[:10] if len(parts) > 0 else "",
                    "hour":       ts[11:13] if len(parts) > 0 else "",
                    "split":      "full"

                }
            ))
            if len(docs) >= max_events:
                break
    return docs

# Was: delete the whole ChromaDB and re-embed every document from scratch,
# every single rebuild. Confirmed by a real 429 in production: with the
# rebuild loop running every 2 hours and the honeypot data mostly just
# APPENDING (most of the "top 5000 most recent" events are the SAME real
# events as two hours ago), this was calling the embedding API for
# thousands of documents that were already embedded last time, burning
# through Gemini's free-tier rate limit for no reason. Now keeps the
# existing collection and only embeds documents that are genuinely new.
print(f"Loading logs from {LOG_SOURCE}...")
docs = load_logs(LOG_SOURCE)
print(f"Loaded {len(docs)} Suricata events")

print(f"Loading Zeek logs from {ZEEK_CONN_PATH}...")
zeek_docs = load_zeek_conns(ZEEK_CONN_PATH, max_events=100)
print(f"Loaded {len(zeek_docs)} Zeek connection events")

docs = docs + zeek_docs
print(f"\nTotal events in ChromaDB: {len(docs)}")

print("\nSample chunk:")
print(docs[0].page_content)
print()

print("Building ChromaDB (Gemini embeddings)...")
embeddings = GoogleGenerativeAIEmbeddings(model="gemini-embedding-001")

# Stable, content-based ID -- the SAME real event always hashes to the
# SAME id regardless of its position in the list, which shifts between
# runs as new events push old ones out of the "most recent N" window.
# This is what makes the diff below actually work; the old positional
# "str(i)" ids meant the exact same event could get a different id on
# every single run, making before/after comparison meaningless.
def _stable_id(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]

texts     = [d.page_content for d in docs]
metadatas = [d.metadata for d in docs]
ids       = [_stable_id(t) for t in texts]

client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
# "langchain" matches langchain_chroma's default collection_name, so
# app.py's existing Chroma(persist_directory=..., embedding_function=...)
# (which doesn't pass an explicit collection_name) finds this collection
# without any change needed on that side.
collection = client.get_or_create_collection(name="langchain")

# Cheap -- include=[] means only ids come back, not embeddings/documents.
existing_ids = set(collection.get(include=[])["ids"])
desired_ids = set(ids)

ids_to_add = desired_ids - existing_ids
ids_to_remove = existing_ids - desired_ids
ids_unchanged = desired_ids & existing_ids

print(f"[diff] {len(ids_unchanged)} already indexed (skipping), {len(ids_to_add)} new (embedding), {len(ids_to_remove)} aged out (removing)")

if ids_to_remove:
    collection.delete(ids=list(ids_to_remove))
    print(f"[chromadb] removed {len(ids_to_remove)} documents no longer in the recent window")

if not ids_to_add:
    print("\n✅ Done! Nothing new to embed -- index already reflects current data.")
    print(f"   Mode: {args.mode.upper()}")
    raise SystemExit(0)

# Only the genuinely new documents get embedded -- this is the actual fix
# for the rate limit, not just a longer delay between batches.
id_to_text = dict(zip(ids, texts))
id_to_meta = dict(zip(ids, metadatas))
new_ids_ordered = list(ids_to_add)
new_texts = [id_to_text[i] for i in new_ids_ordered]
new_metadatas = [id_to_meta[i] for i in new_ids_ordered]

def _is_rate_limit_error(err_msg):
    """Same string-matching approach used elsewhere in this project (see
    app.py's _is_rate_limit_error) -- more resilient to exact exception
    class names differing across library versions than importing a
    specific exception type."""
    m = (err_msg or "").lower()
    return any(k in m for k in ["resource_exhausted", "429", "rate limit", "quota"])


def _embed_batch_with_retry(batch_texts):
    """Calls embed_documents() for one batch, retrying with a real pause
    if it hits a rate limit rather than letting the whole rebuild crash --
    confirmed necessary by a genuine 429 in production."""
    for attempt in range(MAX_RATE_LIMIT_RETRIES + 1):
        try:
            return embeddings.embed_documents(batch_texts)
        except Exception as e:
            if _is_rate_limit_error(str(e)) and attempt < MAX_RATE_LIMIT_RETRIES:
                print(f"[embeddings] rate limited (attempt {attempt + 1}/{MAX_RATE_LIMIT_RETRIES}) -- waiting {RATE_LIMIT_BACKOFF_SECONDS}s before retrying this batch")
                time.sleep(RATE_LIMIT_BACKOFF_SECONDS)
                continue
            raise  # a genuinely different error, or retries exhausted -- don't mask it


print(f"Computing embeddings for {len(new_texts)} NEW documents (batches of {EMBED_BATCH})...")
vectors = []
for start in range(0, len(new_texts), EMBED_BATCH):
    end = min(start + EMBED_BATCH, len(new_texts))
    batch_vectors = _embed_batch_with_retry(new_texts[start:end])
    vectors.extend(batch_vectors)
    print(f"[embeddings] computed {end}/{len(new_texts)}")
    if end < len(new_texts):
        time.sleep(EMBED_BATCH_DELAY_SECONDS)
print(f"Computed {len(vectors)} embeddings.")

WRITE_BATCH = 500
for start in range(0, len(new_ids_ordered), WRITE_BATCH):
    end = min(start + WRITE_BATCH, len(new_ids_ordered))
    collection.add(
        ids=new_ids_ordered[start:end],
        embeddings=vectors[start:end],
        documents=new_texts[start:end],
        metadatas=new_metadatas[start:end],
    )
    print(f"[chromadb] wrote {end}/{len(new_ids_ordered)}")

print(f"\n✅ Done! {len(docs)} events current, {len(new_ids_ordered)} newly embedded, {len(ids_unchanged)} reused from before")
print(f"   Mode: {args.mode.upper()}")