import os
import time
import hashlib
import datetime
import json
import argparse
import chromadb
from langchain_core.documents import Document

print("Building ChromaDB (local Ollama embeddings)...")
from local_embeddings import LocalOllamaEmbeddings, EMBED_MODEL

# ── CONFIG ──────────────────────────────────────────────────────────────────
USEFUL_TYPES = {"alert", "dns", "http", "tls", "flow"}
MAX_EVENTS   = 5000

EMBED_BATCH = 100
EMBED_BATCH_DELAY_SECONDS = 0  # local Ollama has no external rate limit -- no delay needed between batches

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
    print("TRAINING MODE — loading train_logs.json (80% of logs)")
else:
    LOG_SOURCE = ALL_LOGS_PATH
    print("FULL MODE — loading all logs from eve.json")

def format_event(event):
    etype = event.get("event_type", "unknown")
    src   = event.get("src_ip", "unknown")
    dst   = event.get("dest_ip", "unknown")
    sport = event.get("src_port", "?")
    dport = event.get("dest_port", "?")
    ts    = event.get("timestamp", "unknown")
    proto = event.get("proto", "unknown")

    text  = f"Event: {etype} | Time: {ts} | Protocol: {proto}\n"
    text += f"Source: {src}:{sport} -> Destination: {dst}:{dport}\n"

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
        text += f"Source: {parts[2]}:{parts[3]} -> Destination: {parts[4]}:{parts[5]}\n"
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

embeddings = LocalOllamaEmbeddings()

def _stable_id(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]

texts     = [d.page_content for d in docs]
metadatas = [d.metadata for d in docs]
ids       = [_stable_id(t) for t in texts]

client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
collection = client.get_or_create_collection(name="langchain")

# Content-hash IDs are stable across runs of the SAME embedding model, but
# say nothing about which model actually produced the stored vectors --
# this server's ChromaDB collection was built with Gemini vectors, which
# are incompatible with local Ollama's embedding space. Without this
# check, the diff below would see the SAME content-hash IDs already
# present and skip re-embedding them, silently leaving old, wrong-space
# vectors in place under a collection now queried with a different
# embedding model. A marker file records which model last built this
# collection; a mismatch forces one full wipe.
model_marker_path = os.path.join(CHROMA_DB_PATH, ".embedding_model")
previous_model = None
if os.path.exists(model_marker_path):
    with open(model_marker_path) as f:
        previous_model = f.read().strip()

if previous_model != EMBED_MODEL:
    if previous_model is not None:
        print(f"[migration] embedding model changed ({previous_model} -> {EMBED_MODEL}) -- wiping collection to avoid mixing incompatible vector spaces")
    else:
        print(f"[migration] no embedding-model marker found (collection predates this check) -- wiping to guarantee a clean {EMBED_MODEL} space")
    existing_all = collection.get(include=[])["ids"]
    if existing_all:
        collection.delete(ids=existing_all)
    os.makedirs(CHROMA_DB_PATH, exist_ok=True)
    with open(model_marker_path, "w") as f:
        f.write(EMBED_MODEL)

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
    print("\nDone! Nothing new to embed -- index already reflects current data.")
    print(f"   Mode: {args.mode.upper()}")
    raise SystemExit(0)

id_to_text = dict(zip(ids, texts))
id_to_meta = dict(zip(ids, metadatas))
new_ids_ordered = list(ids_to_add)
new_texts = [id_to_text[i] for i in new_ids_ordered]
new_metadatas = [id_to_meta[i] for i in new_ids_ordered]

def _embed_batch_with_retry(batch_texts):
    """No external rate limit to retry against anymore -- local Ollama
    embeddings have no quota."""
    return embeddings.embed_documents(batch_texts)


print(f"Computing embeddings for {len(new_texts)} NEW documents (batches of {EMBED_BATCH})...")
vectors = []
for start in range(0, len(new_texts), EMBED_BATCH):
    end = min(start + EMBED_BATCH, len(new_texts))
    batch_vectors = _embed_batch_with_retry(new_texts[start:end])
    vectors.extend(batch_vectors)
    print(f"[embeddings] computed {end}/{len(new_texts)}")
    if end < len(new_texts) and EMBED_BATCH_DELAY_SECONDS:
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

print(f"\nDone! {len(docs)} events current, {len(new_ids_ordered)} newly embedded, {len(ids_unchanged)} reused from before")
print(f"   Mode: {args.mode.upper()}")