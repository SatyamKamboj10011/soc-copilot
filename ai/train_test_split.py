import json
import os
import random

# ── CONFIG ──────────────────────────────────────────────────────────────────
EVE_JSON_PATH   = "../logs/eve.json"
TRAIN_PATH      = "../logs/train_logs.json"
TEST_PATH       = "../logs/test_logs.json"
USEFUL_TYPES    = {"alert", "dns", "http", "tls", "flow"}
TRAIN_RATIO     = 0.8   # 80% training, 20% testing
RANDOM_SEED     = 42    # keeps split consistent every run
# ────────────────────────────────────────────────────────────────────────────

def load_events():
    events = []
    seen = set()
    with open(EVE_JSON_PATH, "r") as f:
        for line in f:
            try:
                event = json.loads(line)
                if event.get("event_type") not in USEFUL_TYPES:
                    continue
                key = (event.get("event_type"), event.get("src_ip"), event.get("dest_ip"), event.get("timestamp"))
                if key in seen:
                    continue
                seen.add(key)
                events.append(event)
            except:
                continue
    return events

print("Loading events from eve.json...")
events = load_events()
print(f"Total unique events loaded: {len(events)}")

# Shuffle with fixed seed so split is reproducible
random.seed(RANDOM_SEED)
random.shuffle(events)

split_idx    = int(len(events) * TRAIN_RATIO)
train_events = events[:split_idx]
test_events  = events[split_idx:]

# Save training set
with open(TRAIN_PATH, "w") as f:
    for event in train_events:
        f.write(json.dumps(event) + "\n")

# Save test set
with open(TEST_PATH, "w") as f:
    for event in test_events:
        f.write(json.dumps(event) + "\n")

print(f"\n✅ Split complete!")
print(f"   Training logs : {len(train_events)} events → {TRAIN_PATH}")
print(f"   Test logs     : {len(test_events)} events  → {TEST_PATH}")

# Show breakdown by event type
from collections import Counter
train_types = Counter(e.get("event_type") for e in train_events)
test_types  = Counter(e.get("event_type") for e in test_events)

print(f"\nTraining set breakdown:")
for etype, count in train_types.items():
    print(f"   {etype}: {count}")

print(f"\nTest set breakdown:")
for etype, count in test_types.items():
    print(f"   {etype}: {count}")
