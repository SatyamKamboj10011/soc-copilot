import os
import time
import datetime
import json
import shutil
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
EMBED_BATCH_DELAY_SECONDS = 1  # small pause between batches, safety margin

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

# Delete old ChromaDB
if os.path.exists(CHROMA_DB_PATH):
    shutil.rmtree(CHROMA_DB_PATH)
    print("Deleted old ChromaDB")

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

# NOTE: this used to call langchain_chroma's Chroma.from_documents(), which
# was silently re-invoking embeddings.embed_documents() on the FULL document
# list multiple times in a row (visible as the progress counter completing
# 5461/5461 and then restarting from 0 with no error and no explanation in
# between). from_documents() internally batches and writes through several
# layers of langchain_chroma/chromadb that were not behaving predictably in
# this environment. Rather than chase that further, this now computes
# embeddings exactly once ourselves, explicitly batched (see EMBED_BATCH
# above -- same reasoning applied to the Gemini switch: don't trust an
# unverified internal batching behaviour with ~5100 texts in one call) and
# writes them straight into chromadb's own client in a single, plain,
# bounded loop -- no framework retry logic left that can loop silently.
texts     = [d.page_content for d in docs]
metadatas = [d.metadata for d in docs]
ids       = [str(i) for i in range(len(docs))]

print(f"Computing embeddings for {len(texts)} documents (batches of {EMBED_BATCH})...")
vectors = []
for start in range(0, len(texts), EMBED_BATCH):
    end = min(start + EMBED_BATCH, len(texts))
    batch_vectors = embeddings.embed_documents(texts[start:end])
    vectors.extend(batch_vectors)
    print(f"[embeddings] computed {end}/{len(texts)}")
    if end < len(texts):
        time.sleep(EMBED_BATCH_DELAY_SECONDS)
print(f"Computed {len(vectors)} embeddings.")

client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
# "langchain" matches langchain_chroma's default collection_name, so app.py's
# existing `Chroma(persist_directory=..., embedding_function=embeddings)`
# (which doesn't pass an explicit collection_name) finds this collection
# without any change needed on that side.
collection = client.get_or_create_collection(name="langchain")

WRITE_BATCH = 500
for start in range(0, len(texts), WRITE_BATCH):
    end = min(start + WRITE_BATCH, len(texts))
    collection.add(
        ids=ids[start:end],
        embeddings=vectors[start:end],
        documents=texts[start:end],
        metadatas=metadatas[start:end],
    )
    print(f"[chromadb] wrote {end}/{len(texts)}")

print(f"\n✅ Done! {len(docs)} events stored in ChromaDB")
print(f"   Mode: {args.mode.upper()}")