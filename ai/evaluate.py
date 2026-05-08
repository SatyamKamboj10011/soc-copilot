import json
import os
import requests
from datetime import datetime

# ── CONFIG ──────────────────────────────────────────────────────────────────
TEST_LOGS_PATH  = "../logs/test_logs.json"
RESULTS_PATH    = "../logs/evaluation_results.json"
FLASK_URL       = "http://localhost:5000/ask"
MODEL           = "ollama"   # change to "groq" or "gemini" if needed
# ────────────────────────────────────────────────────────────────────────────

USEFUL_TYPES = {"alert", "dns", "http", "tls", "flow"}

def load_test_events():
    events = []
    with open(TEST_LOGS_PATH, "r") as f:
        for line in f:
            try:
                event = json.loads(line)
                if event.get("event_type") in USEFUL_TYPES:
                    events.append(event)
            except:
                continue
    return events

def format_event_question(event):
    etype = event.get("event_type", "unknown")
    src   = event.get("src_ip", "unknown")
    dst   = event.get("dest_ip", "unknown")
    ts    = event.get("timestamp", "unknown")

    if etype == "alert":
        sig = event.get("alert", {}).get("signature", "unknown alert")
        return f"Analyse this security alert: {sig} from {src} to {dst} at {ts}"

    elif etype == "dns":
        query = event.get("dns", {}).get("rrname", "unknown")
        return f"Analyse this DNS query: {query} from {src} at {ts}"

    elif etype == "http":
        http   = event.get("http", {})
        method = http.get("http_method", "GET")
        host   = http.get("hostname", "unknown")
        url    = http.get("url", "/")
        return f"Analyse this HTTP request: {method} {host}{url} from {src} at {ts}"

    elif etype == "tls":
        sni = event.get("tls", {}).get("sni", "unknown")
        return f"Analyse this TLS connection to {sni} from {src} at {ts}"

    elif etype == "flow":
        proto = event.get("proto", "unknown")
        return f"Analyse this {proto} flow from {src} to {dst} at {ts}"

    return f"Analyse this {etype} event from {src} to {dst} at {ts}"

def ask_sira(question):
    try:
        res = requests.post(FLASK_URL, json={
            "question": question,
            "model": MODEL
        }, timeout=120)
        data = res.json()
        return data.get("answer", "No answer returned")
    except Exception as e:
        return f"ERROR: {str(e)}"

# ── MAIN ─────────────────────────────────────────────────────────────────────
print(f"Loading test events from {TEST_LOGS_PATH}...")
test_events = load_test_events()
print(f"Found {len(test_events)} test events\n")

if not test_events:
    print("❌ No test events found. Run train_test_split.py first.")
    exit()

results = []
print(f"Sending test events to SIRA (model: {MODEL})...")
print("=" * 60)

for i, event in enumerate(test_events):
    question = format_event_question(event)
    print(f"\n[{i+1}/{len(test_events)}] {question[:80]}...")

    answer = ask_sira(question)

    result = {
        "test_index":  i + 1,
        "event_type":  event.get("event_type"),
        "src_ip":      event.get("src_ip"),
        "dest_ip":     event.get("dest_ip"),
        "timestamp":   event.get("timestamp"),
        "question":    question,
        "sira_answer": answer,
        "model_used":  MODEL,
        "evaluated_at": datetime.now().isoformat()
    }
    results.append(result)

    # Print short preview of answer
    preview = answer[:200].replace("\n", " ")
    print(f"   SIRA: {preview}...")

# Save results
with open(RESULTS_PATH, "w") as f:
    json.dump(results, f, indent=2)

print("\n" + "=" * 60)
print(f"✅ Evaluation complete!")
print(f"   Tested : {len(results)} unseen log events")
print(f"   Model  : {MODEL}")
print(f"   Results saved to: {RESULTS_PATH}")
print(f"\nOpen {RESULTS_PATH} to review SIRA's answers on unseen test data.")
