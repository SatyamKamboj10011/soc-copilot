import os
import re
import json
import ipaddress
import requests
from langchain_ollama import OllamaLLM

FLASK_URL = "http://localhost:5000"

# IPs that are internal infrastructure, not external attackers, even though
# they can rack up huge raw event counts (Azure's platform/metadata
# services in particular). Never picked as an investigation target, and
# the final report is explicitly told not to describe traffic from these
# as an attack.
KNOWN_PLATFORM_IPS = {
    "168.63.129.16",   # Azure host wireserver (health checks, agent comms)
    "169.254.169.254", # Azure/cloud instance metadata service (IMDS)
}


def _is_internal_or_platform_ip(ip: str) -> bool:
    """True for private/RFC1918 addresses or known cloud platform IPs --
    traffic to/from these is infrastructure noise, not an external attacker,
    regardless of how many events it generates."""
    if ip in KNOWN_PLATFORM_IPS:
        return True
    try:
        return ipaddress.ip_address(ip).is_private
    except ValueError:
        return False


# ── TOOLS ────────────────────────────────────────────────────────────────

def search_logs(query: str) -> str:
    """Search Suricata logs by IP address or alert signature."""
    try:
        res = requests.get(f"{FLASK_URL}/search", params={"q": query}, timeout=10)
        data = res.json()
        if not data:
            return f"No logs found for query: {query}"
        summary = []
        for log in data[:10]:
            alert = log.get('alert', {})
            summary.append(f"- [{log.get('event_type','unknown').upper()}] {log.get('src_ip')} → {log.get('dest_ip')} | {alert.get('signature', log.get('dns', {}).get('rrname', 'No details'))} | {log.get('timestamp','')[:19]}")
        return f"Found {len(data)} events for '{query}':\n" + "\n".join(summary)
    except Exception as e:
        return f"Log search failed: {str(e)}"


def _search_logs_raw(query: str, limit: int = 100):
    """Same query as search_logs(), but returns parsed JSON instead of a
    formatted string -- used internally to pick a real signature for the
    CVE lookup rather than guessing at a generic phrase."""
    try:
        res = requests.get(f"{FLASK_URL}/search", params={"q": query}, timeout=10)
        data = res.json()
        return data if isinstance(data, list) else []
    except Exception:
        return []


def check_reputation(ip: str) -> str:
    """Check IP reputation on AbuseIPDB."""
    try:
        ip = ip.strip()
        res = requests.get(f"{FLASK_URL}/reputation/{ip}", timeout=10)
        data = res.json()
        return (f"IP {ip} reputation:\n"
                f"- Abuse Score: {data.get('score')}%\n"
                f"- Malicious: {data.get('malicious')}\n"
                f"- Country: {data.get('country')}\n"
                f"- Total Reports: {data.get('reports')}")
    except Exception as e:
        return f"Reputation check failed: {str(e)}"


def lookup_cve(signature: str) -> str:
    """Look up CVEs related to an attack signature from NVD database."""
    try:
        res = requests.get(f"{FLASK_URL}/cve-lookup",
                          params={"signature": signature}, timeout=15)
        data = res.json()
        if not data.get('results'):
            return f"No CVEs found for: {signature}"
        result = f"CVEs related to '{data.get('search_term')}':\n"
        for cve in data['results'][:3]:
            result += (f"- {cve['cve_id']} | CVSS {cve.get('cvss_score', 'N/A')} "
                      f"({cve.get('cvss_severity', 'Unknown')}) | "
                      f"{cve['description'][:100]}...\n")
        return result
    except Exception as e:
        return f"CVE lookup failed: {str(e)}"


def correlate_zeek(ip: str) -> str:
    """Correlate Suricata alerts with Zeek connection logs for an IP."""
    try:
        ip = ip.strip()
        res = requests.get(f"{FLASK_URL}/correlate/ip",
                          params={"ip": ip}, timeout=10)
        data = res.json()
        result = (f"Zeek correlation for {ip}:\n"
                 f"- Suricata events: {data.get('total_suricata', 0)}\n"
                 f"- Zeek connections: {data.get('total_zeek', 0)}\n")
        zeek = data.get('zeek_events', [])[:3]
        for z in zeek:
            result += f"- Connection: {z.get('src_ip')} → {z.get('dest_ip')} | Protocol: {z.get('protocol')} | State: {z.get('state')} | Duration: {z.get('duration')}s\n"
        return result
    except Exception as e:
        return f"Zeek correlation failed: {str(e)}"


def check_endpoint_activity(machine_id: str = "") -> str:
    """Check Sentinel endpoint telemetry -- registered machines' last
    check-in and any flagged suspicious connections or processes -- plus
    real Sigma/YARA/IOC detections from Rustinel, if it's running. These
    are two separate endpoint data sources (raw connection heuristics vs.
    actual behavioral detection rules), reported together since they both
    describe YOUR OWN monitored machines, not attacker traffic."""
    try:
        if machine_id:
            res = requests.get(f"{FLASK_URL}/machine/{machine_id}", timeout=10)
            data = res.json()
            if not data:
                result = f"No Sentinel data found for machine '{machine_id}'.\n"
            else:
                result = (f"Endpoint {data.get('id')}:\n"
                         f"- Platform: {data.get('platform')}\n"
                         f"- Local IP: {data.get('local_ip')}\n"
                         f"- Last seen: {data.get('last_seen')}\n"
                         f"- Flagged: {data.get('alert')}\n")
                suspicious = data.get('suspicious', [])
                if suspicious:
                    result += f"- Suspicious connections ({len(suspicious)}):\n"
                    for s in suspicious[:5]:
                        result += f"  - {s.get('remote', 'unknown')}\n"
        else:
            res = requests.get(f"{FLASK_URL}/machines", timeout=10)
            data = res.json()
            if not data:
                result = "No Sentinel endpoints currently registered.\n"
            else:
                result = f"Registered Sentinel endpoints ({len(data)}):\n"
                for m in data:
                    flag = "FLAGGED" if m.get('alert') else "clean"
                    result += f"- {m.get('id')} ({m.get('platform')}) — last seen {m.get('last_seen')} — {flag}, {m.get('suspicious_count', 0)} suspicious connection(s)\n"

        # Real Sigma/YARA/IOC detections from Rustinel, if it's running --
        # a genuinely richer source than the connection-heuristic check
        # above, when available.
        try:
            rres = requests.get(f"{FLASK_URL}/rustinel-alerts", params={"limit": 5}, timeout=5)
            rustinel_alerts = rres.json()
        except Exception:
            rustinel_alerts = []

        if rustinel_alerts:
            result += f"\nRustinel EDR detections ({len(rustinel_alerts)} most recent):\n"
            for a in rustinel_alerts:
                result += f"- [{a.get('engine')}] {a.get('rule_name')} — severity {a.get('severity')} — host: {a.get('host_name') or a.get('host_os')}\n"
        else:
            result += "\nRustinel EDR: no alerts (either not running, or no detections triggered).\n"

        return result
    except Exception as e:
        return f"Sentinel endpoint check failed: {str(e)}"


def get_stats(query: str = "") -> str:
    """Get overall network statistics — total events, alerts, unique IPs."""
    try:
        res = requests.get(f"{FLASK_URL}/stats", timeout=10)
        data = res.json()
        breakdown = data.get('event_breakdown', {})
        top_ips = data.get('top_source_ips', [])
        result = (f"Network Statistics:\n"
                 f"- Total Events: {data.get('total_events', 0)}\n"
                 f"- Total Alerts: {data.get('alert_count', 0)}\n"
                 f"- Unique IPs: {data.get('unique_ips', 0)}\n"
                 f"- Event Breakdown: {json.dumps(breakdown)}\n"
                 f"- Top Attacker IPs: {top_ips}\n")
        return result
    except Exception as e:
        return f"Stats fetch failed: {str(e)}"


def _fetch_top_ips_raw(limit: int = 5):
    """Same data as get_top_ips(), but as parsed JSON -- used internally to
    pick a real, non-internal IP to investigate, instead of a hardcoded
    placeholder."""
    try:
        res = requests.get(f"{FLASK_URL}/top-ips", params={"limit": limit}, timeout=10)
        data = res.json()
        return data if isinstance(data, list) else []
    except Exception:
        return []


def get_top_ips(query: str = "") -> str:
    """Get top attacking IPs from the network logs."""
    data = _fetch_top_ips_raw(limit=5)
    if not data:
        return "Top IPs fetch failed: no data returned"
    result = "Top 5 attacking IPs:\n"
    for item in data:
        result += f"- {item['ip']}: {item['count']} events\n"
    return result


def _pick_target_ip(task: str, top_ips_data):
    """Prefer an IP explicitly named in the task. Otherwise pick the
    highest-volume IP that ISN'T internal/platform infrastructure -- never
    fall back to a hardcoded placeholder IP, since that gets fed to every
    tool as if it were real and the final report has no way to know it
    wasn't. Returns None if nothing external is found in the data at all;
    the report generation step is expected to say so honestly rather than
    inventing a target.
    """
    ip_match = re.findall(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', task)
    if ip_match:
        return ip_match[0]
    for item in top_ips_data:
        ip = item.get("ip")
        if ip and not _is_internal_or_platform_ip(ip):
            return ip
    return None


def _pick_cve_search_term(target_ip: str, raw_logs):
    """Use a real alert signature actually seen for this IP, not a generic
    guessed phrase -- a generic query is what surfaced an unrelated CVE
    (Dell DRAC4 firmware) against pure SSH-scanning traffic last time.
    Returns None if no alert signature is available to search against.
    """
    for log in raw_logs:
        if log.get("event_type") != "alert":
            continue
        sig = log.get("alert", {}).get("signature")
        if sig:
            return sig
    return None


# ── AGENT RUNNER ─────────────────────────────────────────────────────────

def run_hermes_agent(task: str, model: str = "nous-hermes2") -> dict:
    # model is now a real parameter, not hardcoded -- lets the frontend's
    # performance-tier picker choose a lighter model (e.g. phi4-mini) for
    # the report-writing step when the user's hardware doesn't comfortably
    # fit nous-hermes2 (10.7B, ~6.1GB). Defaults to nous-hermes2 so any
    # existing caller that doesn't pass a model keeps today's behaviour.
    llm = OllamaLLM(model=model, temperature=0.3, num_predict=2048)

    steps = []

    # Step 1 — Get stats
    print("Step 1: Getting network stats...")
    stats_result = get_stats("")
    steps.append({"step": 1, "tool": "get_stats", "input": "", "result": stats_result, "status": "done"})

    # Step 2 — Get top IPs
    print("Step 2: Getting top IPs...")
    top_ips_data = _fetch_top_ips_raw(limit=5)
    ips_result = get_top_ips("")
    steps.append({"step": 2, "tool": "get_top_ips", "input": "", "result": ips_result, "status": "done"})

    # Step 3 — Check Sentinel endpoint telemetry -- separate data source
    # from the honeypot's network logs (your own monitored machines, not
    # attacker traffic), but genuinely relevant context for a full
    # investigation: is anything flagged on the machines Hermes is meant
    # to be protecting, independent of what's happening on the honeypot?
    print("Step 3: Checking Sentinel endpoint activity...")
    endpoint_result = check_endpoint_activity("")
    steps.append({"step": 3, "tool": "check_endpoint_activity", "input": "", "result": endpoint_result, "status": "done"})

    # Step 4 — Pick a real target IP: explicit from the task, else the
    # highest-volume genuinely external IP. No hardcoded placeholder.
    target_ip = _pick_target_ip(task, top_ips_data)

    if target_ip is None:
        # Nothing external to investigate in the current data -- say so
        # honestly instead of inventing a target IP to run the rest of the
        # pipeline against.
        no_target_msg = "No external (non-internal) attacking IP found in current top-IPs data."
        steps.append({"step": 4, "tool": "search_logs", "input": "(none)", "result": no_target_msg, "status": "skipped"})
        steps.append({"step": 5, "tool": "check_reputation", "input": "(none)", "result": no_target_msg, "status": "skipped"})
        steps.append({"step": 6, "tool": "lookup_cve", "input": "(none)", "result": no_target_msg, "status": "skipped"})
        steps.append({"step": 7, "tool": "correlate_zeek", "input": "(none)", "result": no_target_msg, "status": "skipped"})
        logs_result = rep_result = cve_result = zeek_result = no_target_msg
        raw_logs = []
    else:
        # Step 5 — Search logs for target IP
        print(f"Step 4: Searching logs for {target_ip}...")
        raw_logs = _search_logs_raw(target_ip)
        logs_result = search_logs(target_ip)
        steps.append({"step": 4, "tool": "search_logs", "input": target_ip, "result": logs_result, "status": "done"})

        # Step 6 — Check reputation
        print(f"Step 5: Checking reputation of {target_ip}...")
        rep_result = check_reputation(target_ip)
        steps.append({"step": 5, "tool": "check_reputation", "input": target_ip, "result": rep_result, "status": "done"})

        # Step 7 — CVE lookup, driven by a real detected signature
        cve_search_term = _pick_cve_search_term(target_ip, raw_logs)
        if cve_search_term:
            print(f"Step 6: Looking up CVEs for signature '{cve_search_term}'...")
            cve_result = lookup_cve(cve_search_term)
            steps.append({"step": 6, "tool": "lookup_cve", "input": cve_search_term, "result": cve_result, "status": "done"})
        else:
            cve_result = f"No alert signature detected for {target_ip} to correlate against CVEs."
            steps.append({"step": 6, "tool": "lookup_cve", "input": "(no signature)", "result": cve_result, "status": "skipped"})

        # Step 8 — Zeek correlation
        print(f"Step 7: Correlating Zeek data for {target_ip}...")
        zeek_result = correlate_zeek(target_ip)
        steps.append({"step": 7, "tool": "correlate_zeek", "input": target_ip, "result": zeek_result, "status": "done"})

    # Step 9 — Generate final report with Hermes
    print("Step 8: Generating investigation report with Nous Hermes2...")

    prompt = f"""You are SIRA — Security Incident Response Assistant powered by Nous Hermes2.
You have completed an autonomous investigation. Here are the results:

TASK: {task}

NETWORK STATISTICS:
{stats_result}

TOP ATTACKING IPs:
{ips_result}

SENTINEL ENDPOINT ACTIVITY:
{endpoint_result}

LOG SEARCH RESULTS for {target_ip or "(no external target identified)"}:
{logs_result}

REPUTATION CHECK for {target_ip or "(no external target identified)"}:
{rep_result}

CVE LOOKUP RESULTS:
{cve_result}

ZEEK CORRELATION for {target_ip or "(no external target identified)"}:
{zeek_result}

STRICT GROUNDING RULES — follow these exactly:
- Only reference IP addresses, CVE identifiers, signatures, endpoint names, and figures that appear explicitly in the tool results above. Never invent or assume an IP, CVE, vulnerability, or endpoint not listed above.
- Private/internal IP addresses (10.x.x.x, 172.16-31.x.x, 192.168.x.x) and known cloud platform IPs (168.63.129.16, 169.254.169.254) are internal infrastructure traffic, not external attackers -- even if they show a very high event count. Do not describe activity from these IPs as unauthorized access, an intrusion, or an attack.
- Sentinel endpoint activity is a SEPARATE data source from the honeypot's network logs -- it describes your own monitored machines, not attacker traffic. Do not conflate a flagged endpoint (Sentinel's connection heuristic, or a real Rustinel Sigma/YARA/IOC detection) with a network-level attacker finding, or vice versa.
- Rustinel detections are real, rule-based findings (Sigma/YARA/IOC) -- if none are present, say "no Rustinel alerts" rather than inventing one, same as any other tool result.
- If no external attacker, no relevant CVE, or no flagged endpoint was found in the results above, say so plainly instead of filling the gap with a plausible-sounding but unverified claim.

Based on all this intelligence, write a comprehensive investigation report with:

SUMMARY:
[What you found — key threats, attacker IPs, attack types]

TOP THREATS:
[Most dangerous findings with specific IPs and signatures]

ENDPOINT SECURITY:
[Any flagged Sentinel endpoints, or state clearly that none are flagged]

RISK LEVEL:
[CRITICAL / HIGH / MEDIUM / LOW — with justification]

CVE IMPACT:
[How the found CVEs relate to the detected attacks]

RECOMMENDED ACTIONS:
1. [Immediate action — within 60 minutes]
2. [Short term — today]
3. [Long term — this week]

Write clearly for a junior SOC analyst."""

    final_answer = llm.invoke(prompt)

    return {
        "steps": steps,
        "answer": final_answer,
        "total_steps": len(steps)
    }


if __name__ == "__main__":
    print("Testing Hermes Agent...")
    result = run_hermes_agent("Get network statistics and identify the top threats")
    print("\n=== STEPS ===")
    for step in result['steps']:
        print(f"Step {step['step']}: {step['tool']}({step['input']}) → {step['result'][:100]}")
    print("\n=== FINAL ANSWER ===")
    print(result['answer'])