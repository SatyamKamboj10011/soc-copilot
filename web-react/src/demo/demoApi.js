/*
 * SIRA public demo: a tiny in-browser "backend".
 *
 * When the app is built with REACT_APP_DEMO=true, every request the UI makes to
 * the (now offline) API host is answered here instead:
 *   - list/search/stats endpoints are computed live from /demo/eve.json
 *   - slower endpoints are served from JSON snapshots that were produced by
 *     running the real Flask code against the same synthetic dataset
 *     (see /demo/snapshot_api.py)
 *   - AI endpoints use demoAi.js (optionally a Groq-backed serverless function)
 *
 * All data is synthetic. No server, no cost, never sleeps.
 */
import { answerQuestion, answerWhatIf, runHermes, answerAskAll } from "./demoAi";
import { speakResponse, makePdf } from "./demoMedia";
import { loadEvents, setRealFetch, getRealFetch, isInternal } from "./demoData";

export const DEMO = process.env.REACT_APP_DEMO === "true";

const API_HOST = "api.sira-soc.me";
let realFetch = null;

// ---------------------------------------------------------------- data layer
const snapCache = {};
function snap(name) {
  if (!snapCache[name]) {
    snapCache[name] = getRealFetch()(`/demo/snapshots/${name}.json`).then((r) => {
      if (!r.ok) throw new Error("no snapshot " + name);
      return r.json();
    });
  }
  return snapCache[name];
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });


// pending actions live in memory only (reset on reload)
let pendingActions = [
  {
    id: "act-001",
    action_type: "block_ip",
    target: "185.231.77.14",
    machine_id: null,
    reason:
      "Hermes: source achieved a successful SSH login with default credentials, pulled a Mirai-style payload and started Stratum miner traffic. Block at the perimeter.",
    status: "pending",
    created_at: "2026-10-16T20:31:00Z",
  },
  {
    id: "act-002",
    action_type: "block_ip",
    target: "62.204.41.190",
    machine_id: null,
    reason: "Hermes: host served the malware payload (/bins/x86_64.sh) to the compromised honeypot session.",
    status: "pending",
    created_at: "2026-10-16T20:31:30Z",
  },
];

function topIps(events, limit) {
  const c = new Map();
  events.forEach((e) => e.src_ip && c.set(e.src_ip, (c.get(e.src_ip) || 0) + 1));
  return [...c.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([ip, count]) => ({ ip, count }));
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function buildCsv(params) {
  const ev = await loadEvents();
  const q = (params.get("q") || "").trim();
  const type = params.get("type");
  const rows = ev
    .filter((e) => (!type || e.event_type === type) && (e.event_type === "alert" || type))
    .filter((e) => !q || (e.src_ip || "").includes(q) || (e.dest_ip || "").includes(q) || (e.alert?.signature || "").includes(q));
  const head = ["timestamp", "event_type", "src_ip", "src_port", "dest_ip", "dest_port", "proto", "signature", "category", "severity"];
  const lines = [head.join(",")].concat(
    rows.map((e) =>
      [e.timestamp, e.event_type, e.src_ip, e.src_port, e.dest_ip, e.dest_port, e.proto, e.alert?.signature, e.alert?.category, e.alert?.severity]
        .map(csvEscape)
        .join(",")
    )
  );
  return lines.join("\n");
}

// -------------------------------------------------------------------- router
async function route(method, path, params, body) {
  // ---- AI --------------------------------------------------------------
  if (method === "POST" && path === "/ask") return json(await answerQuestion(body));
  if (method === "POST" && path === "/ask-all") return json(await answerAskAll(body));
  if (method === "POST" && path === "/what-if") return json(await answerWhatIf(body));
  if (method === "POST" && path === "/hermes-agent") return json(await runHermes(body));
  if (method === "POST" && (path === "/sira-speak" || path === "/sira-face-speak"))
    return speakResponse(body.text);

  // ---- actions / writes ---------------------------------------------------
  let m;
  if (method === "POST" && (m = path.match(/^\/pending-actions\/([^/]+)\/(approve|reject)$/))) {
    const act = pendingActions.find((a) => a.id === m[1]);
    if (!act) return json({ error: "not found" }, 404);
    pendingActions = pendingActions.filter((a) => a.id !== m[1]);
    return m[2] === "approve"
      ? json({ status: "executed", detail: `Demo mode: ${act.action_type} on ${act.target} approved. No real firewall change was made.` })
      : json({ status: "rejected" });
  }
  if (method === "POST" && ["/upload", "/rebuild-index"].includes(path))
    return json({ error: "Uploads are disabled in the public demo" }, 403);
  if (method === "POST" && path === "/block-ip") return json({ message: "Demo mode: block request accepted (no real change made)" });
  if (method === "POST" && path === "/email-schedule") return json({ message: "Demo mode: schedule not saved" });
  if (method === "POST" && path.startsWith("/history/")) return json({ ok: true });
  if (method === "POST" && path === "/api/documents/pdf")
    return new Response(await makePdf(body), { status: 200, headers: { "Content-Type": "application/pdf" } });
  if (method === "POST" && path.startsWith("/api/documents/"))
    return json({ error: "Email delivery is disabled in the public demo (PDF export works)" }, 403);
  if (method !== "GET") return json({ error: "Not available in demo" }, 404);

  // ---- computed from the dataset ------------------------------------------
  if (path === "/logs") {
    const ev = await loadEvents();
    const explicit = params.get("limit");
    const limit = Math.min(parseInt(explicit || "50", 10) || 50, 500);
    const offset = parseInt(params.get("offset") || "0", 10) || 0;
    // default dashboard feed: recent inbound activity, not flow bookkeeping or the honeypot's own chatter
    const feed = explicit ? ev : ev.filter((e) => e.event_type !== "flow" && !isInternal(e.src_ip));
    return json(feed.slice(offset, offset + limit));
  }
  if (path === "/search") {
    const ev = await loadEvents();
    const q = (params.get("q") || "").trim();
    const type = params.get("type");
    const limit = Math.min(parseInt(params.get("limit") || "100", 10) || 100, 500);
    const offset = parseInt(params.get("offset") || "0", 10) || 0;
    const ql = q.toLowerCase();
    const hits = ev.filter(
      (e) =>
        (!type || e.event_type === type) &&
        (!q ||
          (e.src_ip || "").includes(q) ||
          (e.dest_ip || "").includes(q) ||
          (e.alert?.signature || "").toLowerCase().includes(ql) ||
          (e.http?.url || "").toLowerCase().includes(ql) ||
          (e.dns?.rrname || "").toLowerCase().includes(ql))
    );
    return json({ results: hits.slice(offset, offset + limit), total: hits.length }, 200, { "X-Total-Count": String(hits.length) });
  }
  if (path === "/stats") {
    const ev = await loadEvents();
    const breakdown = {};
    ev.forEach((e) => (breakdown[e.event_type] = (breakdown[e.event_type] || 0) + 1));
    const ext = ev.filter((e) => !isInternal(e.src_ip));
    return json({
      total_events: ev.length,
      alert_count: breakdown.alert || 0,
      unique_ips: new Set(ext.map((e) => e.src_ip).filter(Boolean)).size,
      top_source_ips: topIps(ext, 3).map((x) => [x.ip, x.count]),
      event_breakdown: breakdown,
    });
  }
  if (path === "/top-ips") {
    const ev = await loadEvents();
    return json(topIps(ev.filter((e) => !isInternal(e.src_ip)), parseInt(params.get("limit") || "10", 10)));
  }
  if (path === "/geoip/top-ips") return json(await snap("geoip__top-ips__limit-15"));
  if ((m = path.match(/^\/reputation\/(.+)$/))) {
    try {
      const p = await snap(`attacker-profile__${m[1]}`);
      return json({ ip: m[1], score: p.abuse.score, country: p.geo.flag, reports: p.abuse.reports, malicious: p.abuse.malicious });
    } catch {
      return json({ ip: m[1], score: 0, country: "??", reports: 0, malicious: false });
    }
  }
  if ((m = path.match(/^\/attacker-profile\/(.+)$/))) return json(await snap(`attacker-profile__${m[1]}`).catch(() => ({
    ip: m[1], geo: { country: "Unknown", city: "Unknown", isp: "Unknown", flag: "" }, abuse: { score: 0, reports: 0, malicious: false },
    stats: { total_events: 0, total_alerts: 0, signatures: [], ports_targeted: [] },
    sira_assessment: `THREAT ACTOR TYPE:\nNo data - ${m[1]} does not appear in current log data.\n\nLIKELY INTENT:\nCannot be assessed - no recorded activity for this IP.\n\nTACTICS:\n- No real events available to analyse.\n\nDANGER LEVEL:\nUNKNOWN - no basis for a rating without real activity data.\n\nRECOMMENDED BLOCK:\nNO - insufficient evidence to justify blocking an IP with no observed activity.`,
  })));
  if ((m = path.match(/^\/attacker-timeline\/(.+)$/)))
    return json(await snap(`attacker-timeline__${m[1]}`).catch(() => ({ ip: m[1], total_events: 0, timeline: [] })));
  if (path === "/correlate/ip") {
    const ip = params.get("ip") || "";
    return json(await snap(`correlate__${ip}`).catch(() => ({ ip, suricata_events: [], zeek_events: [], total_suricata: 0, total_zeek: 0 })));
  }
  if (path === "/compliance/findings") {
    const want = parseInt(params.get("limit") || "10", 10);
    const lim = [10, 25, 50, 100, 200].find((n) => n >= want) || 200;
    return json(await snap(`compliance__findings__limit-${lim}`));
  }

  // ---- plain snapshots ---------------------------------------------------
  const snapMap = {
    "/timeline": "timeline",
    "/logs/grouped": "logs__grouped",
    "/logs/grouped-mitre": "logs__grouped-mitre",
    "/attention-items": "attention-items",
    "/pipeline-status": "pipeline-status",
    "/compliance/overview": "compliance__overview",
    "/compliance/controls": "compliance__controls",
    "/compliance/heatmap": "compliance__heatmap",
    "/compliance/trend": "compliance__trend",
    "/zeek-logs": "zeek-logs",
    "/models": "models",
    "/voices": "voices",
    "/health": "health",
    "/log-info": "log-info",
    "/rustinel-alerts": "rustinel-alerts",
  };
  if (snapMap[path]) return json(await snap(snapMap[path]));

  // ---- constants for features that are intentionally absent in the demo ----
  if (path === "/machines") return json([]);
  if (path === "/sentinel-config") return json({ server: "" });
  if (path === "/pending-actions") return json(pendingActions);
  if (path === "/email-schedule") return json({});
  if (path === "/history/sessions") return json([]);
  if (path.startsWith("/history/")) return json({});
  if (path === "/cve-lookup") return json({ results: [] });
  if (path === "/export") return json({ error: "use window.open" }, 400);

  return json({ error: `Not available in demo: ${path}` }, 404);
}

// ------------------------------------------------------------------- install
export function installDemoApi() {
  if (!DEMO || realFetch) return;
  realFetch = window.fetch.bind(window);
  setRealFetch(realFetch);

  window.fetch = async (input, init = {}) => {
    let url;
    try {
      url = new URL(typeof input === "string" ? input : input.url, window.location.href);
    } catch {
      return realFetch(input, init);
    }
    if (url.host !== API_HOST) return realFetch(input, init);

    const method = (init.method || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    let body = {};
    try {
      if (init.body) body = JSON.parse(init.body);
    } catch {
      /* non-JSON body */
    }
    // small artificial latency so loading states look natural
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 120));
    try {
      return await route(method, url.pathname, url.searchParams, body);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  };

  // CSV export opens the API URL directly in a new tab: serve a blob instead.
  const realOpen = window.open.bind(window);
  window.open = (target, ...rest) => {
    try {
      const u = new URL(target, window.location.href);
      if (u.host === API_HOST && u.pathname === "/export") {
        buildCsv(u.searchParams).then((csv) => {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
          a.download = "sira-demo-alerts.csv";
          document.body.appendChild(a);
          a.click();
          a.remove();
        });
        return null;
      }
    } catch {
      /* fall through */
    }
    return realOpen(target, ...rest);
  };
}
