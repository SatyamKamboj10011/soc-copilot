#!/usr/bin/env python3
"""
Run the REAL Flask backend (web/app.py) against the synthetic demo data and
save the JSON responses as static snapshots for the serverless demo.

Heavy / network dependencies (LangChain, Ollama, Chroma, Firebase, AbuseIPDB,
ip-api) are stubbed, so this needs only: flask flask-cors flask-jwt-extended
flask-bcrypt python-dotenv requests.

Usage:  python3 demo/generate_demo_data.py && python3 demo/snapshot_api.py
"""
import json
import os
import shutil
import sys
import tempfile
import threading
import types
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "snapshots")
os.makedirs(OUT, exist_ok=True)

GEO = json.load(open(os.path.join(DATA, "geoip.json")))

# ---------------------------------------------------------------- sandbox copy
tmp = tempfile.mkdtemp(prefix="sira_demo_")
for sub in ("web", "ai"):
    dst = os.path.join(tmp, sub)
    os.makedirs(dst)
    for fn in os.listdir(os.path.join(REPO, sub)):
        p = os.path.join(REPO, sub, fn)
        if fn.endswith(".py"):
            shutil.copy(p, dst)
os.makedirs(os.path.join(tmp, "logs"))
shutil.copy(os.path.join(DATA, "eve.json"), os.path.join(tmp, "logs", "eve.json"))
shutil.copy(os.path.join(DATA, "conn.log"), os.path.join(tmp, "logs", "conn.log"))
os.environ["TZ"] = "UTC"

# --------------------------------------------------------------------- stubs
def stub(name, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m
    return m


class _Dummy:
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, n):
        return _Dummy()

    def __call__(self, *a, **k):
        return _Dummy()


for mod, attrs in {
    "langchain_ollama": {"OllamaLLM": _Dummy},
    "langchain_groq": {"ChatGroq": _Dummy},
    "langchain_google_genai": {"ChatGoogleGenerativeAI": _Dummy},
    "langchain_chroma": {"Chroma": _Dummy},
    "langchain_mistralai": {"ChatMistralAI": _Dummy},
    "langgraph": {},
    "langgraph.func": {"task": (lambda f=None, **k: (f if f else (lambda g: g)))},
    "edge_tts": {"Communicate": _Dummy},
    "paramiko": {},
}.items():
    stub(mod, **attrs)

fa = stub("firebase_admin", credentials=_Dummy(), firestore=_Dummy(), initialize_app=lambda *a, **k: None)
fa.credentials = stub("firebase_admin.credentials", Certificate=_Dummy)
fa.firestore = stub("firebase_admin.firestore", client=lambda *a, **k: None)
try:
    import reportlab  # noqa: F401
except ImportError:
    pass  # hermes_documents blueprint just won't register; not needed for the demo

# network stubs -------------------------------------------------------------
import requests  # noqa: E402


class _Resp:
    def __init__(self, data):
        self._d = data
        self.status_code = 200

    def json(self):
        return self._d


def fake_get(url, *a, **k):
    params = k.get("params") or {}
    if "ip-api.com" in url:
        ip = url.rsplit("/", 1)[-1]
        g = GEO.get(ip)
        if g:
            return _Resp({"status": "success", "country": g["country"], "countryCode": g["country_code"],
                          "city": g["city"], "lat": g["lat"], "lon": g["lon"], "isp": g["isp"]})
        return _Resp({"status": "fail"})
    if "abuseipdb" in url:
        ip = params.get("ipAddress", "")
        score = (sum(map(ord, ip)) * 7) % 41 + 55 if ip in GEO else 0   # deterministic 55-95
        return _Resp({"data": {"abuseConfidenceScore": score, "totalReports": score * 9 + 14, "countryCode": GEO.get(ip, {}).get("country_code", "??")}})
    return _Resp({})


requests.get = fake_get

# keep import-time background threads (log sync, index rebuild, email) quiet
_real_start = threading.Thread.start
threading.Thread.start = lambda self, *a, **k: None
sys.path.insert(0, tmp)
os.chdir(os.path.join(tmp, "web"))
stub("ai.honeypot_log_sync", start_background_sync=lambda: None, sync_status={
    "connected": True, "last_connected_at": None, "last_pull_at": None, "last_pull_bytes": 0,
    "last_error": None, "currently_active": True, "recent_events": []})
sys.modules.setdefault("ai", types.ModuleType("ai"))
sys.modules["ai"].__path__ = [os.path.join(tmp, "ai")]
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("app", os.path.join(tmp, "web", "app.py"))
app_mod = importlib.util.module_from_spec(spec)
sys.modules["app"] = app_mod
spec.loader.exec_module(app_mod)
threading.Thread.start = _real_start

app_mod.retriever = types.SimpleNamespace(invoke=lambda q: [])
app_mod.vectorstore = types.SimpleNamespace(get=lambda **k: {})
_orig_ctx = app_mod._compliance_context


def _demo_ctx():
    c = _orig_ctx()
    # demo has no endpoint agents and a cloud-only LLM path: report a healthy baseline
    c.update(machine_count=1, stale_machines=0, flagged_machines=0, user_count=3,
             ollama_ok=False, cloud_ok=True, chroma_ok=True)
    return c


app_mod._compliance_context = _demo_ctx
app = app_mod.app
client = app.test_client()

# ------------------------------------------------------------------ snapshot
campaign_of = {}
for a in json.load(open(os.path.join(DATA, "geoip.json"))):
    pass
# campaign ground truth for the SIRA assessments
ASSESS = {
    "ssh_compromise": ("Targeted Attacker", "Gain persistent root access to the host, pull a Mirai-style payload, then monetise the box as a Monero miner.",
                       ["Reconnaissance sweep of SSH, HTTP and MySQL", "Credential brute force until default root login succeeds",
                        "Ingress tool transfer via wget from a separate payload host", "Resource hijacking - Stratum miner traffic to an external pool"],
                       "CRITICAL - the only actor in the window to achieve a successful login and execute a full kill chain.", "YES - confirmed compromise indicators; block the source and the payload host."),
    "ssh_bruteforce": ("Opportunistic Scanner", "Harvest weak SSH credentials at scale; no follow-on activity observed.",
                       ["Rapid repeated SSH authentication attempts", "Common username/password dictionary", "Bursty, automated timing"],
                       "HIGH - persistent and high-volume, but no successful login in the recorded window.", "YES - repeat offender with high-volume brute-force behaviour."),
    "mirai_telnet": ("Botnet Node", "Recruit weak IoT devices into a DDoS botnet via default Telnet credentials.",
                     ["Telnet scanning on 23/2323", "Default credential guesses (root/xc3511-style)", "Mirai-like SYN fingerprint"],
                     "HIGH - typical infected-device scanner; low sophistication but high volume.", "YES - low cost to block, no legitimate reason to touch this honeypot."),
    "web_exploit": ("Opportunistic Scanner", "Find vulnerable web apps and chain public RCE exploits (Log4Shell, PHPUnit, Spring).",
                    ["Known-CVE exploit strings in URLs and User-Agent headers", "Path traversal and config-file probing (/.env, /wp-login.php)"],
                    "HIGH - exploit attempts target critical CVEs; the honeypot is not vulnerable, but a real server could be.", "YES - active exploitation attempts."),
    "scanner": ("Opportunistic Scanner", "Internet-wide service discovery; likely an index/research scanner or a mass-scan botnet.",
                ["Wide port sweeps across common services", "Banner grabbing (HTTP / TLS)"],
                "LOW - discovery only, no exploitation observed.", "NO - noisy but low risk; monitor rather than block."),
    "smb_rdp": ("Opportunistic Scanner", "Look for exposed Windows services to exploit (EternalBlue) or brute-force (RDP).",
                ["SMB MS17-010 probes", "RDP credential spraying", "VNC discovery"],
                "HIGH - targets historically wormable services.", "YES - exposure probes against high-impact services."),
    "db_probe": ("Opportunistic Scanner", "Find unauthenticated databases (Redis, MongoDB, MSSQL) to steal data or plant persistence.",
                 ["Redis CONFIG SET abuse attempts", "Database port sweeps"],
                 "MEDIUM - dangerous only if a database is actually exposed.", "YES - repeated database-port probing."),
    "payload_host": ("Botnet Node", "Serve malware payloads to compromised hosts.", ["Hosts Mirai-style shell/ELF payloads"],
                     "CRITICAL - confirmed malware distribution.", "YES - block immediately."),
    "miner_pool": ("Botnet Node", "Receive Stratum connections from a hijacked host (mining pool endpoint).", ["Monero Stratum traffic on 3333"],
                   "HIGH - destination of resource-hijacking traffic.", "YES - block outbound to this address."),
}
sys.path.insert(0, HERE)
ATTACK_CAMPAIGN = {}
import re as _re  # noqa: E402
src = open(os.path.join(HERE, "generate_demo_data.py")).read()
for m in _re.finditer(r'\("([\d.]+)",\s+"[^"]+",\s+"[A-Z]{2}",\s+"[^"]+",\s+[-\d.]+,\s+[-\d.]+,\s+"[^"]+",\s+"(\w+)"\)', src):
    ATTACK_CAMPAIGN[m.group(1)] = m.group(2)


def get(path, name=None):
    r = client.get(path)
    if r.status_code != 200:
        print("  !", path, r.status_code, r.get_data(as_text=True)[:120])
        return None
    data = json.loads(json.dumps(r.get_json()).replace("Sentinel endpoints", "endpoints")
                      .replace("Sentinel endpoint", "endpoint").replace("Sentinel", "endpoint agent"))
    fn = (name or path.strip("/").replace("/", "__").replace("?", "__").replace("=", "-").replace("&", "_")) + ".json"
    with open(os.path.join(OUT, fn), "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print("  ok", path, "->", fn)
    return data


print("snapshotting from the real Flask code ...")
stats = get("/stats")
get("/timeline")
get("/top-ips?limit=10", "top-ips__limit-10")
get("/top-ips?limit=15", "top-ips__limit-15")
get("/geoip/top-ips?limit=15", "geoip__top-ips__limit-15")
get("/logs/grouped")
get("/logs/grouped-mitre")
get("/attention-items")
get("/pipeline-status")
get("/compliance/overview")
get("/compliance/controls")
get("/compliance/heatmap")
get("/compliance/trend")
get("/zeek-logs")
get("/models")
get("/log-info")
get("/rustinel-alerts")
for lim in (10, 25, 50, 100, 200):
    get(f"/compliance/findings?limit={lim}", f"compliance__findings__limit-{lim}")

ips = sorted({e for e in GEO})
for ip in ips:
    get(f"/attacker-timeline/{ip}", f"attacker-timeline__{ip}")
    get(f"/correlate/ip?ip={ip}", f"correlate__{ip}")
    # attacker-profile: real stats/geo/abuse from the app, SIRA assessment from ground truth
    r = client.get(f"/attacker-profile/{ip}")
    prof = r.get_json() if r.status_code == 200 else None
    if prof:
        kind = ATTACK_CAMPAIGN.get(ip, "scanner")
        t, intent, tactics, danger, block = ASSESS[kind]
        prof["sira_assessment"] = (
            f"THREAT ACTOR TYPE:\n{t}\n\nLIKELY INTENT:\n{intent}\n\nTACTICS:\n"
            + "\n".join(f"- {x}" for x in tactics)
            + f"\n\nDANGER LEVEL:\n{danger}\n\nRECOMMENDED BLOCK:\n{block}"
        )
        with open(os.path.join(OUT, f"attacker-profile__{ip}.json"), "w") as f:
            json.dump(prof, f, separators=(",", ":"))

# health / voices / machines are demo constants, not derived
json.dump({"status": "ok", "flask": "ok", "ollama": "skipped (demo mode)", "cloud": "ok", "chromadb": "ok",
           "deployed": True, "demo": True}, open(os.path.join(OUT, "health.json"), "w"))
json.dump([{"id": "en-GB-ThomasNeural", "label": "Thomas (British, calm)", "default": True}],
          open(os.path.join(OUT, "voices.json"), "w"))
print("done:", len(os.listdir(OUT)), "snapshot files in", OUT)
shutil.rmtree(tmp, ignore_errors=True)
