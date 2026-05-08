import json
import shutil
import os
import argparse
from langchain_chroma import Chroma
from langchain_ollama import OllamaEmbeddings
from langchain_core.documents import Document

# ── CONFIG ──────────────────────────────────────────────────────────────────
USEFUL_TYPES = {"alert", "dns", "http", "tls", "flow"}
MAX_EVENTS   = 150

# Paths
ALL_LOGS_PATH   = "../logs/eve.json"
TRAIN_LOGS_PATH = "../logs/train_logs.json"
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
                if len(docs) >= MAX_EVENTS:
                    break
            except:
                continue
    return docs

# Delete old ChromaDB
if os.path.exists(CHROMA_DB_PATH):
    shutil.rmtree(CHROMA_DB_PATH)
    print("Deleted old ChromaDB")

print(f"Loading logs from {LOG_SOURCE}...")
docs = load_logs(LOG_SOURCE)
print(f"Loaded {len(docs)} clean events")

print("\nSample chunk:")
print(docs[0].page_content)
print()

print("Building ChromaDB...")
embeddings   = OllamaEmbeddings(model="nomic-embed-text")
vectorstore  = Chroma.from_documents(
    docs,
    embeddings,
    persist_directory=CHROMA_DB_PATH
)
print(f"\n✅ Done! {len(docs)} events stored in ChromaDB")
print(f"   Mode: {args.mode.upper()}")
