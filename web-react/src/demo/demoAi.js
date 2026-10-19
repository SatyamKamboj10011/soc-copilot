/*
 * Demo "AI": answers are composed in the browser from the synthetic dataset, in
 * the same formats the real SIRA prompts produce. If the deployment has an
 * /api/ask serverless function with a Groq key, that is tried first and the
 * result is used when it succeeds; otherwise this engine answers on its own so
 * the demo never breaks.
 */
import { loadEvents, getRealFetch, isInternal, hhmm, dayOf } from "./demoData";

const IP_RE = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;

const count = (arr, fn) => {
  const m = new Map();
  arr.forEach((x) => {
    const k = fn(x);
    if (k) m.set(k, (m.get(k) || 0) + 1);
  });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

async function facts() {
  const ev = await loadEvents();
  const alerts = ev.filter((e) => e.event_type === "alert");
  const external = ev.filter((e) => e.src_ip && !isInternal(e.src_ip));
  return {
    ev,
    alerts,
    topIps: count(external, (e) => e.src_ip),
    topSigs: count(alerts, (e) => e.alert.signature),
    ports: count(alerts.filter((e) => !isInternal(e.src_ip)), (e) => String(e.dest_port)),
    byType: count(ev, (e) => e.event_type),
    unique: new Set(external.map((e) => e.src_ip)).size,
    first: ev[ev.length - 1]?.timestamp,
    last: ev[0]?.timestamp,
  };
}

function ipAnswer(ip, f, honorific) {
  const mine = f.ev.filter((e) => e.src_ip === ip || e.dest_ip === ip);
  if (!mine.length) {
    const t = `No log data exists for ${ip}. It does not appear anywhere in the current dataset, so I will not describe any activity for it.`;
    return { answer: t, spoken: `${honorific}, there is nothing in the logs for ${ip}.` };
  }
  const al = mine.filter((e) => e.event_type === "alert");
  const sigs = count(al, (e) => e.alert.signature);
  const ports = count(mine.filter((e) => e.src_ip === ip), (e) => String(e.dest_port));
  const times = mine.map((e) => e.timestamp).sort();
  const worst = al.length ? Math.min(...al.map((e) => e.alert.severity)) : 3;
  const risk = worst === 1 ? (al.length > 60 ? "CRITICAL" : "HIGH") : worst === 2 ? "MEDIUM" : "LOW";
  const compromiser = sigs.some(([s]) => /Successful Login|Miner|Mirai\.Variant Binary/.test(s));
  const target = mine.find((e) => e.src_ip === ip)?.dest_ip || "10.0.0.4";
  const ans = `SUMMARY:
${ip} generated ${mine.length} events (${al.length} alerts) between ${dayOf(times[0])} at ${hhmm(times[0])} and ${dayOf(times[times.length - 1])} at ${hhmm(times[times.length - 1])}. ${
    compromiser
      ? "This source did not just probe the honeypot: it logged in over SSH with default credentials, pulled a payload and triggered cryptominer traffic."
      : `Activity is consistent with automated ${sigs[0]?.[0]?.includes("SSH") ? "SSH brute forcing" : "scanning"} rather than a hands-on operator.`
  }

THREAT DETAILS:
- Alert: ${sigs[0]?.[0] || "No alert signatures"}${sigs[1] ? ` (+${sigs.length - 1} more signature${sigs.length > 2 ? "s" : ""})` : ""}
- Attacker IP: ${ip}
- Target IP: ${target}
- Time: first seen at ${hhmm(times[0])} on ${dayOf(times[0])}
- Port: ${ports.slice(0, 4).map(([p]) => p).join(", ") || "n/a"} / Protocol: TCP
- Severity: ${worst === 1 ? "3 (High)" : worst === 2 ? "2 (Medium)" : "1 (Low)"}

WHAT THIS MEANS:
${
    compromiser
      ? "A successful default-credential login followed by a payload download and miner traffic is the full intrusion chain, which on a real server would mean complete takeover of the host."
      : "These are opportunistic, automated probes that run against every public IP on the internet. They are noisy, but any exposed service with a weak password would eventually be found."
  }

RISK ASSESSMENT:
- Risk Level: ${risk}
- Why: ${al.length} alerts from one source, worst signature severity ${worst}
- Confidence: High

RECOMMENDED ACTIONS:
1. Block ${ip} at the perimeter firewall within 60 minutes${compromiser ? " and also block the payload host 62.204.41.190" : ""}.
2. Today: ${compromiser ? "rebuild the affected host from a clean image and rotate every credential it held" : "enforce key-based SSH auth and remove password logins"}.
3. This week: add a threshold rule so repeated hits from one source auto-raise an alert.`;
  return {
    answer: ans,
    spoken: `${honorific}, ${ip} is ${compromiser ? "the most serious actor in the window. It got in and started mining" : "a noisy automated scanner"}, with ${al.length} alerts. I recommend blocking it.`,
  };
}

function overviewAnswer(f, honorific) {
  const t = (k) => f.byType.find(([n]) => n === k)?.[1] || 0;
  const [topIp, topCount] = f.topIps[0];
  const ans = `OVERVIEW:
${f.ev.length} events were recorded between ${dayOf(f.first)} and ${dayOf(f.last)}: ${t("alert")} alerts, ${t("flow")} flows, ${t("dns")} DNS, ${t("http")} HTTP and ${t("tls")} TLS records, from ${f.unique} distinct external IPs.

TOP THREATS:
- ${topIp}: ${topCount} events, the most active source. SSH recon, brute force, a successful root login, a payload pull and miner traffic.
- ${f.topIps[1][0]}: ${f.topIps[1][1]} events, high-volume SSH brute forcing.
- ${f.topIps[2][0]}: ${f.topIps[2][1]} events, scan and exploit activity.

PATTERNS DETECTED:
${f.topSigs.slice(0, 4).map(([s, c]) => `- ${s} (${c}x)`).join("\n")}
Most traffic targets SSH (22), Telnet (23), HTTP (80/8080) and SMB (445).

PRIORITY ACTIONS:
1. Block ${topIp} and 62.204.41.190 (payload host): confirmed compromise indicators.
2. Review the Pending Actions queue: Hermes has already proposed both blocks.
3. Move SSH to key-only authentication; the brute-force volume will not stop on its own.`;
  return { answer: ans, spoken: `${honorific}, ${f.ev.length} events, ${t("alert")} alerts, ${f.unique} external sources. The standout is ${topIp}, which achieved a full compromise. I would block it now.` };
}

function respondAnswer(f, honorific) {
  const topIp = f.topIps[0][0];
  const ans = `SITUATION:
One source, ${topIp}, completed a full kill chain against the honeypot (login, payload, miner); the rest of the traffic is background scanning and brute forcing.

IMMEDIATE ACTIONS:
1. Block ${topIp} and 62.204.41.190 at the perimeter: the first is the intruder, the second served the malware.
2. Block outbound traffic to 51.222.30.101:3333: it is the mining pool the host was talking to.

TODAY:
1. Rebuild the compromised host from a clean image and rotate any credentials that were on it.

THIS WEEK:
1. Disable SSH password authentication and add rate limiting (fail2ban or equivalent) so brute force stops being profitable.`;
  return { answer: ans, spoken: `${honorific}, block the intruder and the payload host now, rebuild the box today, and lock SSH down to keys this week.` };
}

function storyAnswer(f, honorific) {
  const ans = `SUMMARY:
At 20:22 on 2026-10-16, 185.231.77.14 ran a full intrusion against the honeypot. It was the only actor in the window to succeed.

THREAT DETAILS:
- Stage 1, Recon (20:22): SSH, HTTP and MySQL probes in the first seconds.
- Stage 2, Brute force (20:23): about 70 SSH authentication failures in under three minutes.
- Stage 3, Access (20:27): successful root login with default credentials.
- Stage 4, Payload (20:28): wget of /bins/x86_64.sh from 62.204.41.190, flagged as Mirai-style.
- Stage 5, Impact (20:30 onwards): Stratum miner traffic to 51.222.30.101:3333 every 30 seconds.

WHAT THIS MEANS:
This maps to MITRE ATT&CK T1595, T1110, T1105 and T1496. On a production server it would mean a hijacked machine mining Monero for the attacker, usually followed by persistence and lateral movement.

RISK ASSESSMENT:
- Risk Level: CRITICAL
- Why: confirmed login plus malware download plus outbound miner traffic
- Confidence: High

RECOMMENDED ACTIONS:
1. Block 185.231.77.14, 62.204.41.190 and outbound 51.222.30.101 now.
2. Rebuild the host and rotate credentials today.
3. Disable password SSH this week.`;
  return { answer: ans, spoken: `${honorific}, that was a five-stage intrusion: recon, brute force, login, payload, miner. I recommend blocking all three addresses involved.` };
}

function countAnswer(f, q, honorific) {
  if (/port/i.test(q)) {
    const p = f.ports.slice(0, 5);
    return { answer: `The most targeted ports are ${p.map(([n, c]) => `${n} (${c} alerts)`).join(", ")}. Port 22 dominates because of SSH brute forcing, with Telnet (23) coming from Mirai-style botnet nodes and SMB (445) from EternalBlue probes.`, spoken: `${honorific}, SSH is far and away the most targeted port, followed by Telnet and web.` };
  }
  if (/signature|rule|attack type|what kind/i.test(q)) {
    const s = f.topSigs.slice(0, 5);
    return { answer: `The five most frequent alert signatures are:\n${s.map(([n, c], i) => `${i + 1}. ${n}: ${c}`).join("\n")}\nSSH brute forcing is the dominant pattern, with Telnet botnet scanning and SMB/RDP probing behind it.`, spoken: `${honorific}, SSH brute forcing dominates, followed by Telnet botnet scanning.` };
  }
  const t = (k) => f.byType.find(([n]) => n === k)?.[1] || 0;
  return { answer: `There are ${t("alert")} alerts in total, out of ${f.ev.length} events, from ${f.unique} distinct external IPs. The top source is ${f.topIps[0][0]} with ${f.topIps[0][1]} events, followed by ${f.topIps[1][0]} (${f.topIps[1][1]}) and ${f.topIps[2][0]} (${f.topIps[2][1]}). The busiest signature is "${f.topSigs[0][0]}" (${f.topSigs[0][1]}x). Activity is continuous rather than a single spike, which is typical for an internet-facing honeypot.`, spoken: `${honorific}, ${t("alert")} alerts from ${f.unique} sources. ${f.topIps[0][0]} leads the list.` };
}

export async function answerQuestion(body) {
  const q = (body.question || "").trim();
  const honorific = (body.honorific || "Sir").trim();
  const model = body.model || "groq";

  // Optional live LLM: a /api/ask serverless function (Groq). Falls back silently.
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    const r = await getRealFetch()("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, honorific, history: (body.history || []).slice(-4) }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (r.ok) {
      const d = await r.json();
      if (d && d.answer) return { answer: d.answer, model_used: d.model_used || "groq", spoken_summary: d.spoken_summary || "" };
    }
  } catch {
    /* fall through to local engine */
  }

  if (/^\s*(hi+|hello+|hey+)\b[\s!.,?]*$|good\s*(morning|afternoon|evening)/i.test(q))
    return { answer: `Good day, ${honorific}. SIRA online. Ask me about the attackers, alerts or any IP in the demo dataset.`, model_used: model, spoken_summary: `Good day, ${honorific}. SIRA online.` };
  if (/who are you|what are you|what is sira|introduce|what can you do|how do you work/i.test(q))
    return { answer: `I am SIRA, a SOC investigation assistant. I read Suricata and Zeek telemetry, triage alerts, explain attacker behaviour in plain English and, through Hermes, investigate and propose response actions for your approval. This public demo runs on synthetic honeypot data, so everything you see is safe to explore.`, model_used: model, spoken_summary: `I am SIRA, your security investigation assistant, ${honorific}.` };

  const f = await facts();
  let r;
  const ip = (q.match(IP_RE) || [])[1];
  if (ip) r = ipAnswer(ip, f, honorific);
  else if (/kill chain|compromis|successful login|miner|mining|payload|got in|breach|worst|most (serious|dangerous|critical)/i.test(q)) r = storyAnswer(f, honorific);
  else if (/what should|how (do|should) (i|we)|respond|recommend|mitigat|next step|what do i do/i.test(q)) r = respondAnswer(f, honorific);
  else if (/summar|overview|what'?s happening|going on|status|report|brief|today|latest/i.test(q)) r = overviewAnswer(f, honorific);
  else if (/top|who|attacker|source|most/i.test(q) && !/how many|count|port|signature/i.test(q)) r = overviewAnswer(f, honorific);
  else r = countAnswer(f, q, honorific);

  return { answer: r.answer, model_used: model, spoken_summary: r.spoken };
}

export async function answerAskAll(body) {
  const r = await answerQuestion({ ...body, model: "groq" });
  return { groq: r.answer, gemini: r.answer, mistral: r.answer };
}

export async function answerWhatIf(body) {
  const sig = body.signature || "this alert";
  const ip = body.src_ip || "the attacker";
  const dst = body.dest_ip || "the target";
  const ssh = /ssh/i.test(sig);
  const web = /web|exploit|log4j|http|php|spring/i.test(sig);
  const answer = `IMMEDIATE IMPACT:
${ssh ? `Within 60 seconds ${ip} would have tried a few hundred credential pairs against ${dst}. One weak password is all it takes.` : web ? `${ip} would have fired its exploit payload at ${dst}; on a vulnerable server that means remote code execution in seconds.` : `${ip} would have mapped open services on ${dst}, selecting the weakest for the next stage.`}

ATTACK CHAIN:
Step 1: ${ssh ? "Automated credential guessing against SSH" : web ? "Send the exploit string to the exposed web service" : "Sweep ports and fingerprint services"}
Step 2: ${ssh || web ? "Gain a shell and download a second-stage payload" : "Pick a vulnerable service and attempt login or exploit"}
Step 3: Install a cryptominer or botnet client and persist

POTENTIAL DAMAGE:
- Data at risk: credentials, config files and anything readable by the compromised account
- Systems at risk: the host itself, then anything reachable from it
- Business impact: stolen compute, outage risk and a reportable security incident

LIKELIHOOD:
POSSIBLE: only if the service was exposed with weak authentication or an unpatched flaw; on this honeypot it is expected and monitored.

LESSON:
Anything exposed to the internet is scanned within minutes, so password authentication and unpatched services are the real risk.`;
  return { answer, signature: sig, src_ip: body.src_ip || "" };
}

// ------------------------------------------------------------------ Hermes
export async function runHermes(body) {
  const task = (body.task || "").trim();
  if (!task) return { error: "No task provided" };
  const f = await facts();
  const ipInTask = (task.match(IP_RE) || [])[1];
  const target = ipInTask || f.topIps[0][0];
  const mine = f.ev.filter((e) => e.src_ip === target || e.dest_ip === target);
  const al = mine.filter((e) => e.event_type === "alert");
  const sigs = count(al, (e) => e.alert.signature);
  const ports = count(mine.filter((e) => e.src_ip === target), (e) => String(e.dest_port));
  const hitsStory = target === "185.231.77.14";
  const hasLog4j = al.some((e) => /log4j/i.test(e.alert.signature));
  const steps = [
    { step: 1, tool: "get_stats", input: "", status: "ok", result: `${f.ev.length} events, ${f.byType.find(([n]) => n === "alert")?.[1]} alerts, ${f.unique} unique external IPs` },
    { step: 2, tool: "get_top_ips", input: "", status: "ok", result: f.topIps.slice(0, 4).map(([i, c]) => `${i} (${c})`).join(", ") },
    { step: 3, tool: "search_logs", input: target, status: "ok", result: `${mine.length} events, ${al.length} alerts. Top signature: ${sigs[0]?.[0] || "none"}` },
    { step: 4, tool: "check_reputation", input: target, status: "ok", result: "AbuseIPDB confidence score above 55, reported as malicious" },
    { step: 5, tool: "correlate_zeek", input: target, status: "ok", result: `Zeek conn.log confirms repeated connections to ports ${ports.slice(0, 3).map(([p]) => p).join(", ")} from this source` },
  ];
  if (hasLog4j) steps.push({ step: steps.length + 1, tool: "lookup_cve", input: "CVE-2021-44228", status: "ok", result: "Apache Log4j2 JNDI RCE, CVSS 10.0 (critical). Public exploits widely available." });
  steps.push({
    step: steps.length + 1,
    tool: "propose_action",
    input: `block_ip ${target}`,
    status: "ok",
    result: `Proposed block of ${target} for analyst approval (see Pending Actions). Nothing executes without a human.`,
  });
  const answer = hitsStory
    ? `Case summary: ${target} is the most serious actor in the dataset. Hermes correlated Suricata alerts and Zeek connections and found a five-stage intrusion: recon, SSH brute force, successful root login with default credentials, a Mirai-style payload pulled from 62.204.41.190, then Stratum miner traffic to 51.222.30.101. Reputation data agrees (malicious). I have proposed blocking ${target} and the payload host; both are waiting in Pending Actions for your approval. Recommended follow-up: rebuild the host and disable password SSH.`
    : `Case summary: ${target} generated ${mine.length} events (${al.length} alerts), mainly "${sigs[0]?.[0] || "n/a"}" against ports ${ports.slice(0, 3).map(([p]) => p).join(", ")}. Zeek confirms the connections and reputation data marks the source as malicious, but there is no successful login or payload activity, so this is opportunistic scanning rather than a compromise. I have proposed a perimeter block for analyst approval.`;
  await new Promise((r) => setTimeout(r, 1200));
  return { steps, answer };
}
