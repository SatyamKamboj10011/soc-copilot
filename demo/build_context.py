#!/usr/bin/env python3
"""Compact dataset summary used as grounding context by the optional /api/ask (Groq) function."""
import json, os, collections
HERE = os.path.dirname(os.path.abspath(__file__))
ev = [json.loads(l) for l in open(os.path.join(HERE, "data", "eve.json"))]
geo = json.load(open(os.path.join(HERE, "data", "geoip.json")))
ext = [e for e in ev if not e["src_ip"].startswith("10.")]
al = [e for e in ev if e["event_type"] == "alert"]
per_ip = {}
for ip in geo:
    mine = [e for e in ev if e["src_ip"] == ip]
    a = [e for e in mine if e["event_type"] == "alert"]
    sigs = collections.Counter(e["alert"]["signature"] for e in a).most_common(3)
    ports = collections.Counter(str(e["dest_port"]) for e in mine).most_common(3)
    ts = sorted(e["timestamp"] for e in mine) or [""]
    per_ip[ip] = {"country": geo[ip]["country"], "events": len(mine), "alerts": len(a),
                  "first": ts[0][:16], "last": ts[-1][:16], "top_signatures": sigs, "top_ports": ports}
ctx = {
    "window": [min(e["timestamp"] for e in ev)[:16], max(e["timestamp"] for e in ev)[:16]],
    "totals": dict(collections.Counter(e["event_type"] for e in ev)),
    "unique_external_ips": len({e["src_ip"] for e in ext}),
    "top_signatures": collections.Counter(e["alert"]["signature"] for e in al).most_common(10),
    "top_dest_ports": collections.Counter(str(e["dest_port"]) for e in al if not e["src_ip"].startswith("10.")).most_common(8),
    "campaign_story": json.load(open(os.path.join(HERE, "data", "campaigns.json"))),
    "per_ip": per_ip,
    "note": "Synthetic demo data. Honeypot is 10.0.0.4. Private IPs are infrastructure, not attackers.",
}
out = os.path.join(os.path.dirname(HERE), "web-react", "api", "_context.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(ctx, open(out, "w"), separators=(",", ":"))
print("wrote", out, os.path.getsize(out), "bytes")
