import { useState, useEffect, useRef } from "react";

const FLASK_URL = "http://localhost:5000";

// ── Styles ────────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #080e1a;
    --surface: #0d1626;
    --surface2: #111d30;
    --border: #1a2d4a;
    --border2: #243d5e;
    --accent: #00c8ff;
    --accent2: #0066ff;
    --green: #00e5a0;
    --red: #ff3d5a;
    --orange: #ff8c42;
    --yellow: #ffd166;
    --text: #c8ddf0;
    --text-dim: #4a7090;
    --text-mid: #7a9db8;
    --mono: 'Space Mono', monospace;
    --sans: 'DM Sans', sans-serif;
  }

  html, body, #root { height: 100%; }

  body {
    font-family: var(--sans);
    background: var(--bg);
    color: var(--text);
    overflow: hidden;
    background-image:
      radial-gradient(ellipse 80% 50% at 10% 0%, rgba(0,102,255,0.12) 0%, transparent 60%),
      radial-gradient(ellipse 60% 40% at 90% 100%, rgba(0,200,255,0.08) 0%, transparent 50%);
  }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 4px; }

  .app {
    display: grid;
    grid-template-rows: 52px 1fr;
    grid-template-columns: 280px 1fr 300px;
    height: 100vh;
    gap: 0;
  }

  /* ── NAV ── */
  .nav {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    background: rgba(13,22,38,0.95);
    border-bottom: 1px solid var(--border);
    backdrop-filter: blur(12px);
    z-index: 10;
  }

  .nav-logo {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 1px;
  }

  .logo-shield {
    width: 28px;
    height: 28px;
    background: linear-gradient(135deg, var(--accent2), var(--accent));
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    box-shadow: 0 0 16px rgba(0,200,255,0.35);
  }

  .nav-center {
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .nav-stat {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 0.5px;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    animation: pulse 2s infinite;
  }
  .dot-green { background: var(--green); box-shadow: 0 0 8px var(--green); }
  .dot-red { background: var(--red); box-shadow: 0 0 8px var(--red); animation-duration: 1s; }
  .dot-blue { background: var(--accent); box-shadow: 0 0 8px var(--accent); }

  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }

  .nav-time {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-dim);
  }

  /* ── SIDEBAR ── */
  .sidebar {
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface);
  }

  .sidebar-header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sidebar-title {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .count-badge {
    background: var(--red);
    color: white;
    font-family: var(--mono);
    font-size: 9px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 10px;
    box-shadow: 0 0 10px rgba(255,61,90,0.4);
    animation: pulse 1.5s infinite;
  }

  .alerts-list {
    flex: 1;
    overflow-y: auto;
  }

  .alert-item {
    padding: 11px 16px;
    border-bottom: 1px solid rgba(26,45,74,0.6);
    cursor: pointer;
    border-left: 2px solid transparent;
    transition: all 0.15s;
  }

  .alert-item:hover { background: rgba(0,200,255,0.04); border-left-color: var(--accent); }
  .alert-item.active { background: rgba(0,200,255,0.07); border-left-color: var(--green); }

  .alert-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 5px;
  }

  .sev-tag {
    font-family: var(--mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: 3px;
  }

  .sev-alert { background: rgba(255,61,90,0.15); color: var(--red); border: 1px solid rgba(255,61,90,0.3); }
  .sev-dns { background: rgba(0,200,255,0.1); color: var(--accent); border: 1px solid rgba(0,200,255,0.2); }
  .sev-http { background: rgba(0,229,160,0.1); color: var(--green); border: 1px solid rgba(0,229,160,0.2); }
  .sev-flow { background: rgba(122,157,184,0.1); color: var(--text-mid); border: 1px solid rgba(122,157,184,0.2); }
  .sev-tls { background: rgba(255,140,66,0.1); color: var(--orange); border: 1px solid rgba(255,140,66,0.2); }

  .alert-time {
    font-family: var(--mono);
    font-size: 9px;
    color: var(--text-dim);
  }

  .alert-ips {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text-mid);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .alert-ips span { color: var(--accent); }

  /* ── MAIN ── */
  .main {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Stats bar */
  .stats-bar {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border-bottom: 1px solid var(--border);
  }

  .stat {
    padding: 12px 16px;
    border-right: 1px solid var(--border);
    transition: background 0.15s;
  }

  .stat:last-child { border-right: none; }
  .stat:hover { background: rgba(0,200,255,0.03); }

  .stat-label {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 5px;
  }

  .stat-value {
    font-family: var(--mono);
    font-size: 22px;
    font-weight: 700;
    line-height: 1;
  }

  .stat-value.red { color: var(--red); text-shadow: 0 0 12px rgba(255,61,90,0.4); }
  .stat-value.green { color: var(--green); }
  .stat-value.blue { color: var(--accent); }
  .stat-value.orange { color: var(--orange); }

  .stat-sub {
    font-size: 10px;
    color: var(--text-dim);
    margin-top: 3px;
  }

  /* Chat */
  .chat-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .chat-header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(13,22,38,0.5);
  }

  .ai-avatar {
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, var(--accent2), var(--accent));
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    box-shadow: 0 0 14px rgba(0,200,255,0.3);
    flex-shrink: 0;
  }

  .ai-name {
    font-weight: 600;
    font-size: 13px;
    color: var(--text);
  }

  .ai-status {
    font-size: 10px;
    color: var(--green);
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .msg {
    display: flex;
    gap: 8px;
    animation: fadeUp 0.25s ease;
  }

  @keyframes fadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }

  .msg.user { flex-direction: row-reverse; }

  .msg-icon {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    flex-shrink: 0;
  }

  .msg-icon.ai { background: linear-gradient(135deg, var(--accent2), var(--accent)); box-shadow: 0 0 10px rgba(0,200,255,0.25); }
  .msg-icon.user { background: rgba(0,200,255,0.1); border: 1px solid var(--border2); }

  .bubble {
    max-width: 76%;
    padding: 10px 14px;
    border-radius: 12px;
    font-size: 13px;
    line-height: 1.65;
  }

  .msg.ai .bubble {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-top-left-radius: 3px;
    color: var(--text);
  }

  .msg.user .bubble {
    background: rgba(0,102,255,0.18);
    border: 1px solid rgba(0,102,255,0.3);
    border-top-right-radius: 3px;
    color: var(--text);
  }

  .typing {
    display: flex;
    gap: 4px;
    padding: 10px 14px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 12px;
    border-top-left-radius: 3px;
    width: fit-content;
  }

  .typing span {
    width: 6px;
    height: 6px;
    background: var(--accent);
    border-radius: 50%;
    animation: bounce 1s infinite;
  }
  .typing span:nth-child(2) { animation-delay: 0.15s; }
  .typing span:nth-child(3) { animation-delay: 0.3s; }

  @keyframes bounce { 0%,100%{transform:translateY(0);opacity:0.4} 50%{transform:translateY(-4px);opacity:1} }

  /* Input area */
  .input-area {
    padding: 12px 16px;
    border-top: 1px solid var(--border);
    background: rgba(13,22,38,0.5);
  }

  .quick-btns {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }

  .qbtn {
    font-size: 10px;
    font-family: var(--sans);
    padding: 5px 11px;
    border-radius: 20px;
    border: 1px solid var(--border2);
    background: transparent;
    color: var(--text-mid);
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .qbtn:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: rgba(0,200,255,0.06);
  }

  .input-row {
    display: flex;
    gap: 8px;
  }

  .chat-input {
    flex: 1;
    background: var(--surface2);
    border: 1px solid var(--border2);
    border-radius: 8px;
    padding: 10px 14px;
    color: var(--text);
    font-family: var(--sans);
    font-size: 13px;
    outline: none;
    transition: border 0.15s;
  }

  .chat-input::placeholder { color: var(--text-dim); }
  .chat-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(0,200,255,0.08); }

  .send-btn {
    width: 40px;
    height: 40px;
    background: linear-gradient(135deg, var(--accent2), var(--accent));
    border: none;
    border-radius: 8px;
    cursor: pointer;
    color: white;
    font-size: 15px;
    transition: all 0.15s;
    box-shadow: 0 0 16px rgba(0,200,255,0.3);
    flex-shrink: 0;
  }

  .send-btn:hover { transform: scale(1.05); box-shadow: 0 0 22px rgba(0,200,255,0.5); }
  .send-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

  /* ── RIGHT PANEL ── */
  .right-panel {
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface);
  }

  .panel-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
  }

  .tab {
    flex: 1;
    padding: 10px 6px;
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 1px;
    text-transform: uppercase;
    text-align: center;
    cursor: pointer;
    color: var(--text-dim);
    border-bottom: 2px solid transparent;
    transition: all 0.15s;
  }

  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab:hover:not(.active) { color: var(--text-mid); }

  .tab-body {
    flex: 1;
    overflow-y: auto;
    padding: 14px;
    display: none;
  }

  .tab-body.active { display: block; }

  .detail-label {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 6px;
    margin-top: 14px;
  }

  .detail-label:first-child { margin-top: 0; }

  .detail-value {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text);
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 12px;
    word-break: break-all;
    line-height: 1.6;
  }

  .detail-value .hi { color: var(--accent); }
  .detail-value .bad { color: var(--red); }

  /* Severity bar */
  .sev-bar { display: flex; gap: 3px; margin-top: 8px; }
  .sev-seg { flex: 1; height: 5px; border-radius: 2px; background: var(--border); }
  .sev-seg.on { background: var(--red); box-shadow: 0 0 6px var(--red); }

  /* Action buttons */
  .actions {
    padding: 14px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .action-btn {
    padding: 9px 12px;
    border-radius: 7px;
    font-family: var(--sans);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    border: 1px solid;
    display: flex;
    align-items: center;
    gap: 7px;
    letter-spacing: 0.3px;
  }

  .btn-red { background: rgba(255,61,90,0.1); border-color: rgba(255,61,90,0.3); color: var(--red); }
  .btn-red:hover { background: var(--red); color: white; }
  .btn-orange { background: rgba(255,140,66,0.1); border-color: rgba(255,140,66,0.25); color: var(--orange); }
  .btn-orange:hover { background: var(--orange); color: white; }
  .btn-green { background: rgba(0,229,160,0.08); border-color: rgba(0,229,160,0.2); color: var(--green); }
  .btn-green:hover { background: var(--green); color: #080e1a; }

  /* Toast */
  .toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: var(--surface2);
    border: 1px solid var(--border2);
    color: var(--text);
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.25s;
    z-index: 999;
    pointer-events: none;
  }

  .toast.show { opacity: 1; transform: translateY(0); }

  /* Log entries */
  .log-entry {
    font-family: var(--mono);
    font-size: 9px;
    padding: 6px 10px;
    border-radius: 4px;
    margin-bottom: 3px;
    border-left: 2px solid var(--border);
    color: var(--text-dim);
    line-height: 1.5;
    cursor: pointer;
    transition: all 0.15s;
  }

  .log-entry:hover { background: rgba(0,200,255,0.04); border-left-color: var(--accent); color: var(--text); }
  .log-entry .hi { color: var(--accent); }
  .log-entry .bad { color: var(--red); }
`;

// ── Mock log data (replaced by real API data) ─────────────────────────────────
const mockAlerts = [
  { event_type: "alert", src_ip: "192.168.68.105", dest_ip: "10.0.0.45", timestamp: "2026-04-27T09:14:32", alert: { signature: "ET SCAN Nmap" } },
  { event_type: "dns", src_ip: "192.168.68.57", dest_ip: "8.8.8.8", timestamp: "2026-04-27T09:11:05" },
  { event_type: "http", src_ip: "192.168.68.57", dest_ip: "142.250.1.1", timestamp: "2026-04-27T09:10:22" },
  { event_type: "flow", src_ip: "192.168.68.54", dest_ip: "203.109.191.8", timestamp: "2026-04-27T09:08:14" },
  { event_type: "tls", src_ip: "192.168.68.57", dest_ip: "172.217.25.163", timestamp: "2026-04-27T09:07:55" },
  { event_type: "dns", src_ip: "192.168.68.57", dest_ip: "8.8.8.8", timestamp: "2026-04-27T09:06:33" },
  { event_type: "flow", src_ip: "192.168.68.51", dest_ip: "203.109.191.8", timestamp: "2026-04-27T09:05:12" },
  { event_type: "http", src_ip: "192.168.68.57", dest_ip: "142.250.1.1", timestamp: "2026-04-27T09:04:01" },
];

const quickQuestions = [
  "What suspicious activity was detected?",
  "Which IPs appear most often?",
  "What type of events are in the logs?",
  "Is there any malicious traffic?",
  "What should I do next?",
];

export default function App() {
  const [messages, setMessages] = useState([
    { role: "ai", text: "Hello! I am ARIA, your AI Security Investigation Copilot. I have loaded your Suricata and Zeek logs. Ask me anything about your network activity." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [alerts, setAlerts] = useState(mockAlerts);
  const [activeAlert, setActiveAlert] = useState(0);
  const [activeTab, setActiveTab] = useState("details");
  const [toast, setToast] = useState("");
  const [time, setTime] = useState(new Date().toLocaleTimeString());
  const messagesRef = useRef(null);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch logs from Flask
  useEffect(() => {
    fetch(`${FLASK_URL}/logs`)
      .then(r => r.json())
      .then(data => { if (data.length > 0) setAlerts(data); })
      .catch(() => {});
  }, []);

  // Scroll messages
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const sendMessage = async (text) => {
    const q = text || input.trim();
    if (!q || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", text: q }]);
    setLoading(true);

    try {
      const res = await fetch(`${FLASK_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q })
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "ai", text: data.answer }]);
    } catch {
      setMessages(prev => [...prev, { role: "ai", text: "Could not reach the Flask server. Make sure it is running on port 5000." }]);
    }
    setLoading(false);
  };

  const selected = alerts[activeAlert] || {};
  const alertCount = alerts.filter(a => a.event_type === "alert").length;

  const sevColor = (type) => {
    if (type === "alert") return "sev-alert";
    if (type === "dns") return "sev-dns";
    if (type === "http") return "sev-http";
    if (type === "tls") return "sev-tls";
    return "sev-flow";
  };

  return (
    <>
      <style>{css}</style>
      <div className="app">

        {/* NAV */}
        <nav className="nav">
          <div className="nav-logo">
            <div className="logo-shield">🛡</div>
            SOC COPILOT
          </div>
          <div className="nav-center">
            <div className="nav-stat"><div className="dot dot-green" />SURICATA LIVE</div>
            <div className="nav-stat"><div className="dot dot-green" />ZEEK ONLINE</div>
            <div className="nav-stat"><div className="dot dot-red" />{alertCount} ALERTS</div>
            <div className="nav-stat"><div className="dot dot-blue" />AI READY</div>
          </div>
          <div className="nav-time">{time} UTC</div>
        </nav>

        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">Live Events</span>
            {alertCount > 0 && <span className="count-badge">{alertCount} ALERT</span>}
          </div>
          <div className="alerts-list">
            {alerts.map((a, i) => (
              <div
                key={i}
                className={`alert-item${activeAlert === i ? " active" : ""}`}
                onClick={() => setActiveAlert(i)}
              >
                <div className="alert-top">
                  <span className={`sev-tag ${sevColor(a.event_type)}`}>{a.event_type}</span>
                  <span className="alert-time">{a.timestamp?.substring(11, 19) || "--:--:--"}</span>
                </div>
                <div className="alert-ips">
                  <span>{a.src_ip || "unknown"}</span>
                  {" → "}
                  {a.dest_ip || "unknown"}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* MAIN */}
        <main className="main">
          {/* Stats */}
          <div className="stats-bar">
            <div className="stat">
              <div className="stat-label">Total Events</div>
              <div className="stat-value blue">{alerts.length}</div>
              <div className="stat-sub">In log file</div>
            </div>
            <div className="stat">
              <div className="stat-label">Alerts</div>
              <div className="stat-value red">{alertCount}</div>
              <div className="stat-sub">Needs review</div>
            </div>
            <div className="stat">
              <div className="stat-label">Unique IPs</div>
              <div className="stat-value orange">{[...new Set(alerts.map(a => a.src_ip).filter(Boolean))].length}</div>
              <div className="stat-sub">Source addresses</div>
            </div>
            <div className="stat">
              <div className="stat-label">Status</div>
              <div className="stat-value green">OK</div>
              <div className="stat-sub">System operational</div>
            </div>
          </div>

          {/* Chat */}
          <div className="chat-wrap">
            <div className="chat-header">
              <div className="ai-avatar">🤖</div>
              <div>
                <div className="ai-name">ARIA — AI Investigation Assistant</div>
                <div className="ai-status"><div className="dot dot-green" style={{ width: 5, height: 5 }} />Analysing logs in real time</div>
              </div>
            </div>

            <div className="messages" ref={messagesRef}>
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div className={`msg-icon ${m.role}`}>{m.role === "ai" ? "🤖" : "👤"}</div>
                  <div className="bubble">{m.text}</div>
                </div>
              ))}
              {loading && (
                <div className="msg ai">
                  <div className="msg-icon ai">🤖</div>
                  <div className="typing"><span /><span /><span /></div>
                </div>
              )}
            </div>

            <div className="input-area">
              <div className="quick-btns">
                {quickQuestions.map((q, i) => (
                  <button key={i} className="qbtn" onClick={() => sendMessage(q)}>{q}</button>
                ))}
              </div>
              <div className="input-row">
                <input
                  className="chat-input"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && sendMessage()}
                  placeholder="Ask ARIA about your logs..."
                />
                <button className="send-btn" onClick={() => sendMessage()} disabled={loading}>➤</button>
              </div>
            </div>
          </div>
        </main>

        {/* RIGHT PANEL */}
        <aside className="right-panel">
          <div className="panel-tabs">
            {["details", "logs", "mitre"].map(t => (
              <div key={t} className={`tab${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>
                {t}
              </div>
            ))}
          </div>

          {/* Details tab */}
          <div className={`tab-body${activeTab === "details" ? " active" : ""}`}>
            <div className="detail-label">Event Type</div>
            <div className="detail-value"><span className="hi">{selected.event_type || "N/A"}</span></div>

            <div className="detail-label">Source IP</div>
            <div className="detail-value"><span className="bad">{selected.src_ip || "N/A"}</span></div>

            <div className="detail-label">Destination IP</div>
            <div className="detail-value"><span className="hi">{selected.dest_ip || "N/A"}</span></div>

            <div className="detail-label">Timestamp</div>
            <div className="detail-value">{selected.timestamp?.substring(0, 19) || "N/A"}</div>

            {selected.alert?.signature && (
              <>
                <div className="detail-label">Signature</div>
                <div className="detail-value"><span className="bad">{selected.alert.signature}</span></div>
              </>
            )}

            <div className="detail-label">Risk Score</div>
            <div className="sev-bar">
              {[...Array(10)].map((_, i) => (
                <div key={i} className={`sev-seg${selected.event_type === "alert" ? (i < 8 ? " on" : "") : (i < 3 ? " on" : "")}`} />
              ))}
            </div>
          </div>

          {/* Logs tab */}
          <div className={`tab-body${activeTab === "logs" ? " active" : ""}`}>
            {alerts.slice(0, 30).map((a, i) => (
              <div key={i} className="log-entry">
                <span style={{ color: "var(--text-dim)" }}>{a.timestamp?.substring(11, 19)}</span>
                <span className="hi"> [{a.event_type}]</span>
                <span style={{ color: "var(--orange)" }}> {a.src_ip}</span>
                {" → "}{a.dest_ip}
              </div>
            ))}
          </div>

          {/* MITRE tab */}
          <div className={`tab-body${activeTab === "mitre" ? " active" : ""}`}>
            {[
              { id: "T1046", name: "Network Service Discovery", desc: "Port scanning detected when nmap scans the network.", tactic: "Discovery" },
              { id: "T1021", name: "Remote Services", desc: "Lateral movement via SMB or SSH connections.", tactic: "Lateral Movement" },
              { id: "T1041", name: "Exfiltration Over C2", desc: "Data sent outside the network via C2 channel.", tactic: "Exfiltration" },
            ].map((t, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <div className="detail-label">{t.tactic}</div>
                <div className="detail-value">
                  <span className="hi">{t.id}</span> — {t.name}
                  <div style={{ color: "var(--text-dim)", fontSize: 10, marginTop: 4 }}>{t.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="actions">
            <button className="action-btn btn-red" onClick={() => showToast("🚨 Escalated to Tier 2 analyst!")}>🚨 Escalate Alert</button>
            <button className="action-btn btn-orange" onClick={() => showToast(`🔒 IP ${selected.src_ip} blocked!`)}>🔒 Block Source IP</button>
            <button className="action-btn btn-green" onClick={() => showToast("✅ Alert marked as investigated!")}>✅ Mark Investigated</button>
          </div>
        </aside>

      </div>

      {/* Toast */}
      <div className={`toast${toast ? " show" : ""}`}>{toast}</div>
    </>
  );
}