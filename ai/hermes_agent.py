import os
import re
import json
import ipaddress
from langchain_ollama import OllamaLLM

# Every tool below used to make a REAL HTTP request back to this exact
# same Flask process (requests.get(f"{FLASK_URL}/...")). With
# WEB_CONCURRENCY=1 (Render's default), that's a guaranteed deadlock: the
# single worker handling the outer /hermes-agent request can never also
# answer its own inner self-call, since there's no second worker free to
# do it. Confirmed by direct evidence during testing -- every single tool
# failed with "Read timed out" connecting to 127.0.0.1:$PORT, every time,
# meaning Hermes had likely never actually retrieved real data on the
# deployed single-worker instance at all.
#
# The fix: Flask's own test client dispatches a route IN-PROCESS,
# synchronously, in the current thread -- it never touches a real socket
# or the gunicorn worker pool at all, so it works correctly regardless of
# worker count. set_flask_client() is called once from app.py's
# /hermes-agent route, right before invoking run_hermes_agent().
_flask_client = None


def set_flask_client(client):
    global _flask_client
    _flask_client = client


def _local_get(path, params=None, timeout=None):
    """In-process GET via Flask's test client. timeout is accepted but
    unused -- kept as a parameter so call sites didn't all need editing --
    an in-process call has no network layer to time out on."""
    resp = _flask_client.get(path, query_string=params)
    try:
        return resp.get_json()
    except Exception:
        return None


def _local_post(path, json_body=None, timeout=None):
    resp = _flask_client.post(path, json=json_body)
    try:
        return resp.get_json(), resp.status_code
    except Exception:
        return None, resp.status_code

# ── Deployment-aware report model ───────────────────────────────────────
# Mirrors web/app.py's DEPLOYED-aware fallback in get_llm(), duplicated
# here (rather than imported) to keep this module self-contained and avoid
# a circular import back into the Flask app (app.py imports run_hermes_agent
# from here, at call time inside the route handler). On Render, model names
# like "nous-hermes2" or "phi4-mini" from the frontend's performance-tier
# picker don't exist -- there is no cloud-capable Hermes model option
# exposed in the UI at all today -- so DEPLOYED=true always routes the
# final report-writing step to a cloud model instead, regardless of which
# Ollama-only name was requested.
DEPLOYED = os.getenv("DEPLOYED", "false").strip().lower() in ("1", "true", "yes")
DEFAULT_CLOUD_MODEL = os.getenv("DEFAULT_CLOUD_MODEL", "groq")
_KNOWN_CLOUD_MODELS = {"groq", "gemini", "mistral"}


def _get_report_llm(model):
    """Returns (llm, is_cloud) for the final report-writing step."""
    if DEPLOYED and model not in _KNOWN_CLOUD_MODELS:
        cloud_model = DEFAULT_CLOUD_MODEL if DEFAULT_CLOUD_MODEL in _KNOWN_CLOUD_MODELS else "groq"
        if cloud_model == "groq":
            from langchain_groq import ChatGroq
            return ChatGroq(model="llama-3.3-70b-versatile", groq_api_key=os.getenv("GROQ_API_KEY"), temperature=0.3), True
        elif cloud_model == "gemini":
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(model="gemini-2.0-flash", google_api_key=os.getenv("GEMINI_API_KEY"), temperature=0.3), True
        elif cloud_model == "mistral":
            from langchain_mistralai import ChatMistralAI
            return ChatMistralAI(model="mistral-small-latest", mistral_api_key=os.getenv("MISTRAL_API_KEY"), temperature=0.3), True
    return OllamaLLM(model=model, temperature=0.3, num_predict=2048), False


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
        data = _local_get("/search", params={"q": query})
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
        data = _local_get("/search", params={"q": query})
        return data if isinstance(data, list) else []
    except Exception:
        return []


def check_reputation(ip: str) -> str:
    """Check IP reputation on AbuseIPDB."""
    try:
        ip = ip.strip()
        data = _local_get(f"/reputation/{ip}")
        return (f"IP {ip} reputation:\n"
                f"- Abuse Score: {data.get('score')}%\n"
                f"- Malicious: {data.get('malicious')}\n"
                f"- Country: {data.get('country')}\n"
                f"- Total Reports: {data.get('reports')}")
    except Exception as e:
        return f"Reputation check failed: {str(e)}"


def _check_reputation_raw(ip: str):
    """Same lookup as check_reputation(), but returns parsed data instead
    of a formatted string -- used internally to decide whether there's
    real enough evidence to PROPOSE an action, not just describe one."""
    try:
        return _local_get(f"/reputation/{ip.strip()}") or {}
    except Exception:
        return {}


def propose_action(action_type: str, target: str, reason: str, machine_id: str = None) -> str:
    """Proposes an action for human approval -- this NEVER executes
    anything itself, it only creates a pending row a person must approve
    via the dashboard. Hermes calling this is not the same as Hermes
    DOING something; it's Hermes recommending something, with its
    reasoning attached, same as it would in written report form."""
    try:
        body = {"action_type": action_type, "target": target, "reason": reason}
        if machine_id:
            body["machine_id"] = machine_id
        data, status_code = _local_post("/propose-action", json_body=body)
        if status_code == 201:
            return f"Proposed action #{data.get('id')}: {action_type} on {target} -- awaiting human approval."
        return f"Failed to propose action: {(data or {}).get('error', 'unknown error')}"
    except Exception as e:
        return f"Failed to propose action: {str(e)}"


def lookup_cve(signature: str) -> str:
    """Look up CVEs related to an attack signature from NVD database."""
    try:
        data = _local_get("/cve-lookup", params={"signature": signature})
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
        data = _local_get("/correlate/ip", params={"ip": ip})
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
            data = _local_get(f"/machine/{machine_id}")
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
            data = _local_get("/machines")
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
            rustinel_alerts = _local_get("/rustinel-alerts", params={"limit": 5})
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
        data = _local_get("/stats")
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
        data = _local_get("/top-ips", params={"limit": limit})
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

def _safe_step(label, fn, *args):
    """Run one investigation step without letting a single failing tool
    abort the entire run. Any exception is captured as that step's result
    so the report still gets produced with whatever did succeed."""
    try:
        return fn(*args), "done"
    except Exception as e:
        return f"{label} failed: {type(e).__name__}: {e}", "failed"


def run_hermes_agent(task: str, model: str = "nous-hermes2") -> dict:
    # model is now a real parameter, not hardcoded -- lets the frontend's
    # performance-tier picker choose a lighter model (e.g. phi4-mini) for
    # the report-writing step when the user's hardware doesn't comfortably
    # fit nous-hermes2 (10.7B, ~6.1GB). Defaults to nous-hermes2 so any
    # existing caller that doesn't pass a model keeps today's behaviour.
    # _get_report_llm additionally routes to a cloud model instead when
    # DEPLOYED=true, regardless of which Ollama-only name was requested --
    # see its docstring above.
    llm, is_cloud = _get_report_llm(model)

    steps = []

    # Step 1 — Get stats
    print("Step 1: Getting network stats...")
    stats_result, status = _safe_step("get_stats", get_stats, "")
    steps.append({"step": 1, "tool": "get_stats", "input": "", "result": stats_result, "status": status})

    # Step 2 — Get top IPs
    print("Step 2: Getting top IPs...")
    try:
        top_ips_data = _fetch_top_ips_raw(limit=5)
    except Exception:
        top_ips_data = []
    ips_result, status = _safe_step("get_top_ips", get_top_ips, "")
    steps.append({"step": 2, "tool": "get_top_ips", "input": "", "result": ips_result, "status": status})

    # Step 3 — Check Sentinel endpoint telemetry -- separate data source
    # from the honeypot's network logs (your own monitored machines, not
    # attacker traffic), but genuinely relevant context for a full
    # investigation: is anything flagged on the machines Hermes is meant
    # to be protecting, independent of what's happening on the honeypot?
    print("Step 3: Checking Sentinel endpoint activity...")
    endpoint_result, status = _safe_step("check_endpoint_activity", check_endpoint_activity, "")
    steps.append({"step": 3, "tool": "check_endpoint_activity", "input": "", "result": endpoint_result, "status": status})

    # Step 4 — Pick a real target IP: explicit from the task, else the
    # highest-volume genuinely external IP. No hardcoded placeholder.
    try:
        target_ip = _pick_target_ip(task, top_ips_data)
    except Exception:
        target_ip = None

    if target_ip is None:
        # Nothing external to investigate in the current data -- say so
        # honestly instead of inventing a target IP to run the rest of the
        # pipeline against.
        no_target_msg = "No external (non-internal) attacking IP found in current top-IPs data."
        steps.append({"step": 4, "tool": "search_logs", "input": "(none)", "result": no_target_msg, "status": "skipped"})
        steps.append({"step": 5, "tool": "check_reputation", "input": "(none)", "result": no_target_msg, "status": "skipped"})
        steps.append({"step": 6, "tool": "propose_action", "input": "(none)", "result": no_target_msg, "status": "skipped"})
        steps.append({"step": 7, "tool": "lookup_cve", "input": "(none)", "result": no_target_msg, "status": "skipped"})
        steps.append({"step": 8, "tool": "correlate_zeek", "input": "(none)", "result": no_target_msg, "status": "skipped"})
        logs_result = rep_result = cve_result = zeek_result = proposal_result = no_target_msg
        raw_logs = []
    else:
        # Step 5 — Search logs for target IP
        print(f"Step 4: Searching logs for {target_ip}...")
        try:
            raw_logs = _search_logs_raw(target_ip)
        except Exception:
            raw_logs = []
        logs_result, status = _safe_step("search_logs", search_logs, target_ip)
        steps.append({"step": 4, "tool": "search_logs", "input": target_ip, "result": logs_result, "status": status})

        # Step 6 — Check reputation
        print(f"Step 5: Checking reputation of {target_ip}...")
        rep_result, status = _safe_step("check_reputation", check_reputation, target_ip)
        steps.append({"step": 5, "tool": "check_reputation", "input": target_ip, "result": rep_result, "status": status})

        # Step 6 — Propose blocking, but ONLY when AbuseIPDB itself
        # confirms malicious=True -- a real evidence threshold, not
        # "propose blocking every IP investigated". This never executes
        # anything -- always waits for a human to approve via the dashboard.
        rep_raw = _check_reputation_raw(target_ip)
        if rep_raw.get("malicious"):
            propose_reason = f"AbuseIPDB confirms malicious activity ({rep_raw.get('score')}% abuse score, {rep_raw.get('reports')} reports) during this Hermes investigation."
            proposal_result = propose_action("block_ip", target_ip, propose_reason)
            steps.append({"step": 6, "tool": "propose_action", "input": f"block_ip: {target_ip}", "result": proposal_result, "status": "done"})
        else:
            proposal_result = "No action proposed — AbuseIPDB does not confirm this IP as malicious."
            steps.append({"step": 6, "tool": "propose_action", "input": target_ip, "result": proposal_result, "status": "skipped"})

        # Step 7 — CVE lookup, driven by a real detected signature
        try:
            cve_search_term = _pick_cve_search_term(target_ip, raw_logs)
        except Exception:
            cve_search_term = None
        if cve_search_term:
            print(f"Step 6: Looking up CVEs for signature '{cve_search_term}'...")
            cve_result = lookup_cve(cve_search_term)
            steps.append({"step": 6, "tool": "lookup_cve", "input": cve_search_term, "result": cve_result, "status": "done"})
        else:
            cve_result = f"No alert signature detected for {target_ip} to correlate against CVEs."
            steps.append({"step": 7, "tool": "lookup_cve", "input": "(no signature)", "result": cve_result, "status": "skipped"})

        # Step 8 — Zeek correlation
        print(f"Step 7: Correlating Zeek data for {target_ip}...")
        zeek_result = correlate_zeek(target_ip)
        steps.append({"step": 7, "tool": "correlate_zeek", "input": target_ip, "result": zeek_result, "status": "done"})

    # Step 9 — Generate final report with Hermes
    print("Step 9: Generating investigation report...")

    prompt = f"""You are SIRA — Security Incident Response Assistant.
You have completed an autonomous investigation. Here are the results:

TASK: {task}

NETWORK STATISTICS:
{stats_result}

TOP ATTACKING IPs:
{ips_result}

SENTINEL ENDPOINT ACTIVITY (this project's own custom-built endpoint monitoring agent -- unrelated to Microsoft's product of the same name):
{endpoint_result}

LOG SEARCH RESULTS for {target_ip or "(no external target identified)"}:
{logs_result}

REPUTATION CHECK for {target_ip or "(no external target identified)"}:
{rep_result}

PROPOSED ACTION RESULT:
{proposal_result}

CVE LOOKUP RESULTS:
{cve_result}

ZEEK CORRELATION for {target_ip or "(no external target identified)"}:
{zeek_result}

STRICT GROUNDING RULES — follow these exactly:
- Only reference IP addresses, CVE identifiers, signatures, endpoint names, and figures that appear explicitly in the tool results above. Never invent or assume an IP, CVE, vulnerability, or endpoint not listed above.
- Private/internal IP addresses (10.x.x.x, 172.16-31.x.x, 192.168.x.x) and known cloud platform IPs (168.63.129.16, 169.254.169.254) are internal infrastructure traffic, not external attackers -- even if they show a very high event count. Do not describe activity from these IPs as unauthorized access, an intrusion, or an attack.
- "Sentinel" here refers ONLY to this project's own custom endpoint monitoring agent -- never describe it using Microsoft Sentinel's product terminology, features, or capabilities (it is a completely different, unrelated tool that happens to share a name). Sentinel endpoint activity is also a SEPARATE data source from the honeypot's network logs -- it describes your own monitored machines, not attacker traffic. Do not conflate a flagged endpoint (Sentinel's connection heuristic, or a real Rustinel Sigma/YARA/IOC detection) with a network-level attacker finding, or vice versa.
- Rustinel detections are real, rule-based findings (Sigma/YARA/IOC) -- if none are present, say "no Rustinel alerts" rather than inventing one, same as any other tool result.
- If no external attacker, no relevant CVE, or no flagged endpoint was found in the results above, say so plainly instead of filling the gap with a plausible-sounding but unverified claim.
- You NEVER execute anything yourself -- you only PROPOSE actions, which require explicit human approval in the dashboard before anything happens. Never write as if an action has already been taken; the PROPOSED ACTION RESULT above tells you exactly what state it's actually in.

Based on all this intelligence, write a comprehensive investigation report with:

SUMMARY:
[What you found — key threats, attacker IPs, attack types]

TOP THREATS:
[Most dangerous findings with specific IPs and signatures]

ENDPOINT SECURITY:
[Any flagged Sentinel endpoints, or state clearly that none are flagged]

PROPOSED ACTIONS:
[If an action was proposed above (e.g. blocking an IP), state it here plainly and note it is awaiting human approval in the dashboard -- do not claim it has already been done. If nothing was proposed, say so.]

RISK LEVEL:
[CRITICAL / HIGH / MEDIUM / LOW — with justification]

CVE IMPACT:
[How the found CVEs relate to the detected attacks]

RECOMMENDED ACTIONS:
1. [Immediate action — within 60 minutes]
2. [Short term — today]
3. [Long term — this week]

Write clearly for a junior SOC analyst."""

    try:
        result = llm.invoke(prompt)
        final_answer = result.content if is_cloud else result
    except Exception as e:
        # The report-writing model failed (model not pulled, Ollama not
        # running, out of memory on a large model, bad cloud API key, etc).
        # Return the steps that did complete plus a readable reason, rather
        # than throwing and producing a bare 500 with no detail for the user.
        final_answer = (
            f"Report generation failed using model '{model}': {type(e).__name__}: {e}\n\n"
            f"The investigation steps above completed successfully — only the final "
            f"written report could not be generated. If this is a memory or model "
            f"issue, try a lighter model from the performance-tier picker."
        )
        steps.append({
            "step": len(steps) + 1,
            "tool": "generate_report",
            "input": model,
            "result": final_answer,
            "status": "failed",
        })

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