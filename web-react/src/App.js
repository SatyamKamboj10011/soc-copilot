import { useState, useEffect, useRef } from "react";

const FLASK_URL = "http://localhost:5000";

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0b0f17;
    --surface: #111622;
    --surface2: #161c2d;
    --border: #1e2d45;
    --border2: #2a3f5f;
    --accent: #4a9eff;
    --accent2: #1a6fd4;
    --green: #2ecc8a;
    --red: #e05252;
    --orange: #e07c3a;
    --text: #b8cce0;
    --text-dim: #445566;
    --text-mid: #6a88a8;
    --mono: 'Space Mono', monospace;
    --sans: 'DM Sans', sans-serif;
  }

  html, body, #root { height: 100%; }
  body { font-family: var(--sans); background: var(--bg); color: var(--text); overflow: hidden; }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 4px; }

  .app {
    display: grid;
    grid-template-rows: 48px 1fr;
    grid-template-columns: 260px 1fr 290px;
    height: 100vh;
  }

  .nav {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 18px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }

  .nav-logo {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 2px;
  }

  .logo-box {
    width: 26px; height: 26px;
    background: var(--accent2);
    border-radius: 5px;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px;
  }

  .nav-center { display: flex; align-items: center; gap: 18px; }

  .nav-stat {
    display: flex; align-items: center; gap: 5px;
    font-family: var(--mono); font-size: 9px;
    color: var(--text-dim); letter-spacing: 1px; text-transform: uppercase;
  }

  .dot { width: 5px; height: 5px; border-radius: 50%; }
  .dot-green { background: var(--green); }
  .dot-red { background: var(--red); }
  .dot-blue { background: var(--accent); }
  .nav-time { font-family: var(--mono); font-size: 10px; color: var(--text-dim); }

  .threat-badge {
    font-family: var(--mono); font-size: 9px; font-weight: 700;
    padding: 3px 10px; border-radius: 3px; letter-spacing: 1px;
    text-transform: uppercase; border: 1px solid;
  }
  .threat-high { background: rgba(224,82,82,0.12); color: var(--red); border-color: rgba(224,82,82,0.3); }
  .threat-medium { background: rgba(224,124,58,0.12); color: var(--orange); border-color: rgba(224,124,58,0.3); }
  .threat-low { background: rgba(46,204,138,0.1); color: var(--green); border-color: rgba(46,204,138,0.25); }

  .sidebar {
    border-right: 1px solid var(--border);
    display: flex; flex-direction: column;
    overflow: hidden; background: var(--surface);
  }

  .sidebar-header {
    padding: 10px 14px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
  }

  .sidebar-title {
    font-family: var(--mono); font-size: 9px;
    letter-spacing: 2px; text-transform: uppercase; color: var(--text-dim);
  }

  .count-badge {
    background: rgba(224,82,82,0.15); color: var(--red);
    border: 1px solid rgba(224,82,82,0.3);
    font-family: var(--mono); font-size: 9px; font-weight: 700;
    padding: 2px 7px; border-radius: 3px;
  }

  .filter-bar {
    padding: 7px 10px; border-bottom: 1px solid var(--border);
    display: flex; gap: 4px; flex-wrap: wrap;
  }

  .filter-btn {
    padding: 3px 9px; font-family: var(--mono); font-size: 8px;
    letter-spacing: 0.5px; text-transform: uppercase;
    border-radius: 3px; border: 1px solid var(--border2);
    background: transparent; color: var(--text-dim);
    cursor: pointer; transition: all 0.12s;
  }

  .filter-btn.active-all { border-color: var(--accent); color: var(--accent); background: rgba(74,158,255,0.08); }
  .filter-btn.active-alert { border-color: var(--red); color: var(--red); background: rgba(224,82,82,0.08); }
  .filter-btn.active-dns { border-color: var(--accent); color: var(--accent); background: rgba(74,158,255,0.08); }
  .filter-btn.active-http { border-color: var(--green); color: var(--green); background: rgba(46,204,138,0.08); }
  .filter-btn.active-flow { border-color: var(--text-mid); color: var(--text-mid); }
  .filter-btn.active-tls { border-color: var(--orange); color: var(--orange); background: rgba(224,124,58,0.08); }

  .alerts-list { flex: 1; overflow-y: auto; }

  .alert-item {
    padding: 10px 14px;
    border-bottom: 1px solid rgba(30,45,69,0.5);
    cursor: pointer; border-left: 2px solid transparent; transition: all 0.12s;
  }

  .alert-item:hover { background: rgba(74,158,255,0.03); border-left-color: var(--border2); }
  .alert-item.active { background: rgba(74,158,255,0.05); border-left-color: var(--accent); }

  .alert-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }

  .sev-tag {
    font-family: var(--mono); font-size: 8px; font-weight: 700;
    letter-spacing: 1px; text-transform: uppercase;
    padding: 2px 6px; border-radius: 2px; border: 1px solid;
  }

  .sev-alert { background: rgba(224,82,82,0.1); color: var(--red); border-color: rgba(224,82,82,0.25); }
  .sev-dns { background: rgba(74,158,255,0.1); color: var(--accent); border-color: rgba(74,158,255,0.2); }
  .sev-http { background: rgba(46,204,138,0.08); color: var(--green); border-color: rgba(46,204,138,0.2); }
  .sev-flow { background: rgba(106,136,168,0.1); color: var(--text-mid); border-color: rgba(106,136,168,0.2); }
  .sev-tls { background: rgba(224,124,58,0.1); color: var(--orange); border-color: rgba(224,124,58,0.2); }

  .alert-time { font-family: var(--mono); font-size: 8px; color: var(--text-dim); }

  .alert-ips {
    font-family: var(--mono); font-size: 9px; color: var(--text-mid);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .alert-ips span { color: var(--accent); }

  .main { display: flex; flex-direction: column; overflow: hidden; }

  .stats-bar { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid var(--border); }
  .stat { padding: 10px 14px; border-right: 1px solid var(--border); }
  .stat:last-child { border-right: none; }
  .stat-label { font-family: var(--mono); font-size: 8px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-dim); margin-bottom: 4px; }
  .stat-value { font-family: var(--mono); font-size: 20px; font-weight: 700; line-height: 1; }
  .stat-value.red { color: var(--red); }
  .stat-value.green { color: var(--green); }
  .stat-value.blue { color: var(--accent); }
  .stat-value.orange { color: var(--orange); }
  .stat-sub { font-size: 10px; color: var(--text-dim); margin-top: 3px; }

  .chat-wrap { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  .chat-header {
    padding: 10px 14px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 8px; background: var(--surface);
  }

  .ai-avatar {
    width: 28px; height: 28px; background: var(--accent2);
    border-radius: 6px; display: flex; align-items: center;
    justify-content: center; font-size: 14px; flex-shrink: 0;
  }

  .ai-name { font-weight: 600; font-size: 12px; color: var(--text); }
  .ai-status { font-size: 9px; color: var(--green); font-family: var(--mono); letter-spacing: 0.5px; }

  .clear-btn {
    margin-left: auto; background: transparent;
    border: 1px solid var(--border2); color: var(--text-dim);
    padding: 4px 10px; border-radius: 3px; font-size: 9px;
    font-family: var(--mono); cursor: pointer; letter-spacing: 0.5px;
    text-transform: uppercase; transition: all 0.12s;
  }
  .clear-btn:hover { border-color: var(--red); color: var(--red); }

  .date-filter-bar {
    padding: 8px 14px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 8px;
    background: var(--surface2); flex-wrap: wrap;
  }

  .date-input, .hour-select {
    background: var(--surface); border: 1px solid var(--border2);
    border-radius: 4px; padding: 4px 8px; color: var(--text);
    font-family: var(--mono); font-size: 10px; outline: none; cursor: pointer;
  }

  .date-input:focus, .hour-select:focus { border-color: var(--accent); }

  .clear-filter-btn {
    padding: 4px 10px; border-radius: 3px;
    border: 1px solid rgba(224,82,82,0.3);
    background: transparent; color: var(--red);
    font-family: var(--mono); font-size: 8px;
    cursor: pointer; letter-spacing: 0.5px; text-transform: uppercase; transition: all 0.12s;
  }
  .clear-filter-btn:hover { background: var(--red); color: white; }

  .filter-active-badge {
    font-family: var(--mono); font-size: 8px; color: var(--accent);
    background: rgba(74,158,255,0.1); border: 1px solid rgba(74,158,255,0.2);
    padding: 2px 8px; border-radius: 3px;
  }

  .messages { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }

  .msg { display: flex; gap: 8px; }
  .msg.user { flex-direction: row-reverse; }

  .msg-icon { width: 24px; height: 24px; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
  .msg-icon.ai { background: var(--accent2); }
  .msg-icon.user { background: rgba(74,158,255,0.1); border: 1px solid var(--border2); }

  .bubble-wrap { display: flex; flex-direction: column; max-width: 76%; }
  .msg.user .bubble-wrap { align-items: flex-end; }

  .bubble { padding: 9px 13px; border-radius: 8px; font-size: 12px; line-height: 1.65; white-space: pre-wrap; }

  .msg.ai .bubble { background: var(--surface2); border: 1px solid var(--border); border-top-left-radius: 2px; color: var(--text); }
  .msg.user .bubble { background: rgba(26,111,212,0.15); border: 1px solid rgba(26,111,212,0.25); border-top-right-radius: 2px; color: var(--text); }

  .msg-time { font-family: var(--mono); font-size: 8px; color: var(--text-dim); margin-top: 4px; padding: 0 2px; }

  .typing { display: flex; gap: 4px; padding: 9px 13px; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; border-top-left-radius: 2px; width: fit-content; }
  .typing span { width: 5px; height: 5px; background: var(--accent); border-radius: 50%; animation: bounce 1s infinite; }
  .typing span:nth-child(2) { animation-delay: 0.15s; }
  .typing span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes bounce { 0%,100%{transform:translateY(0);opacity:0.3} 50%{transform:translateY(-4px);opacity:1} }

  .input-area { padding: 10px 14px; border-top: 1px solid var(--border); background: var(--surface); }
  .quick-btns { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 8px; }

  .qbtn {
    font-size: 9px; font-family: var(--mono); padding: 4px 10px;
    border-radius: 3px; border: 1px solid var(--border2);
    background: transparent; color: var(--text-dim);
    cursor: pointer; transition: all 0.12s; white-space: nowrap; letter-spacing: 0.3px;
  }
  .qbtn:hover { border-color: var(--accent); color: var(--accent); }

  .input-row { display: flex; gap: 7px; }

  .chat-input {
    flex: 1; background: var(--surface2); border: 1px solid var(--border2);
    border-radius: 6px; padding: 9px 13px; color: var(--text);
    font-family: var(--mono); font-size: 11px; outline: none; transition: border 0.12s;
  }
  .chat-input::placeholder { color: var(--text-dim); }
  .chat-input:focus { border-color: var(--accent); }

  .send-btn {
    width: 38px; height: 38px; background: var(--accent2);
    border: none; border-radius: 6px; cursor: pointer;
    color: white; font-size: 14px; transition: all 0.12s; flex-shrink: 0;
  }
  .send-btn:hover { background: var(--accent); }
  .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .right-panel { border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; background: var(--surface); }
  .panel-tabs { display: flex; border-bottom: 1px solid var(--border); }

  .tab {
    flex: 1; padding: 10px 6px; font-family: var(--mono); font-size: 8px;
    letter-spacing: 1.5px; text-transform: uppercase; text-align: center;
    cursor: pointer; color: var(--text-dim); border-bottom: 2px solid transparent; transition: all 0.12s;
  }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab:hover:not(.active) { color: var(--text-mid); }

  .tab-body { flex: 1; overflow-y: auto; padding: 12px; display: none; }
  .tab-body.active { display: block; }

  .detail-label { font-family: var(--mono); font-size: 8px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-dim); margin-bottom: 5px; margin-top: 12px; }
  .detail-label:first-child { margin-top: 0; }

  .detail-value { font-family: var(--mono); font-size: 10px; color: var(--text); background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; padding: 7px 10px; word-break: break-all; line-height: 1.6; }
  .detail-value .hi { color: var(--accent); }
  .detail-value .bad { color: var(--red); }

  .sev-bar { display: flex; gap: 2px; margin-top: 7px; }
  .sev-seg { flex: 1; height: 4px; border-radius: 1px; background: var(--border); }
  .sev-seg.on { background: var(--red); }

  .actions { padding: 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }

  .action-btn {
    padding: 8px 12px; border-radius: 5px; font-family: var(--mono);
    font-size: 9px; font-weight: 700; cursor: pointer; transition: all 0.12s;
    border: 1px solid; display: flex; align-items: center; gap: 7px;
    letter-spacing: 0.5px; text-transform: uppercase;
  }
  .btn-red { background: rgba(224,82,82,0.08); border-color: rgba(224,82,82,0.25); color: var(--red); }
  .btn-red:hover { background: var(--red); color: white; }
  .btn-orange { background: rgba(224,124,58,0.08); border-color: rgba(224,124,58,0.2); color: var(--orange); }
  .btn-orange:hover { background: var(--orange); color: white; }
  .btn-green { background: rgba(46,204,138,0.06); border-color: rgba(46,204,138,0.18); color: var(--green); }
  .btn-green:hover { background: var(--green); color: #0b0f17; }

  .log-entry { font-family: var(--mono); font-size: 9px; padding: 5px 8px; border-radius: 3px; margin-bottom: 2px; border-left: 2px solid var(--border); color: var(--text-dim); line-height: 1.5; cursor: pointer; transition: all 0.12s; }
  .log-entry:hover { background: rgba(74,158,255,0.03); border-left-color: var(--accent); color: var(--text); }
  .log-entry .hi { color: var(--accent); }
  .log-entry .bad { color: var(--red); }

  .toast { position: fixed; bottom: 18px; right: 18px; background: var(--surface2); border: 1px solid var(--border2); color: var(--text); padding: 9px 14px; border-radius: 5px; font-family: var(--mono); font-size: 10px; opacity: 0; transform: translateY(8px); transition: all 0.2s; z-index: 999; pointer-events: none; }
  .toast.show { opacity: 1; transform: translateY(0); }
`;

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
    { role: "ai", text: "Hello! I am SIRA, your Security Incident Response Assistant. I have loaded your Suricata and Zeek logs. Ask me anything about your network activity.", time: new Date().toLocaleTimeString() }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [alerts, setAlerts] = useState(mockAlerts);
  const [activeAlert, setActiveAlert] = useState(0);
  const [activeTab, setActiveTab] = useState("details");
  const [toast, setToast] = useState("");
  const [time, setTime] = useState(new Date().toLocaleTimeString());
  const [filter, setFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [hourFilter, setHourFilter] = useState("");
  const messagesRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch(`${FLASK_URL}/logs`)
      .then(r => r.json())
      .then(data => { if (data.length > 0) setAlerts(data); })
      .catch(() => {});
  }, []);

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
    const now = new Date().toLocaleTimeString();
    setMessages(prev => [...prev, { role: "user", text: q, time: now }]);
    setLoading(true);
    try {
      const res = await fetch(`${FLASK_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, date: dateFilter || null, hour: hourFilter || null })
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "ai", text: data.answer, time: new Date().toLocaleTimeString() }]);
    } catch {
      setMessages(prev => [...prev, { role: "ai", text: "Could not reach the Flask server. Make sure it is running on port 5000.", time: new Date().toLocaleTimeString() }]);
    }
    setLoading(false);
  };

  const selected = alerts[activeAlert] || {};
  const alertCount = alerts.filter(a => a.event_type === "alert").length;
  const threatLevel = alertCount >= 3 ? "high" : alertCount >= 1 ? "medium" : "low";
  const filteredAlerts = alerts.filter(a => filter === "all" || a.event_type === filter);
  const isFilterActive = dateFilter || hourFilter;

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
            <div className="logo-box">🛡</div>
            SOC COPILOT
          </div>
          <div className="nav-center">
            <div className="nav-stat"><div className="dot dot-green" />SURICATA LIVE</div>
            <div className="nav-stat"><div className="dot dot-green" />ZEEK ONLINE</div>
            <div className="nav-stat"><div className="dot dot-red" />{alertCount} ALERTS</div>
            <div className="nav-stat"><div className="dot dot-blue" />AI READY</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className={`threat-badge threat-${threatLevel}`}>THREAT: {threatLevel}</span>
            <div className="nav-time">{time} UTC</div>
          </div>
        </nav>

        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">Live Events</span>
            {alertCount > 0 && <span className="count-badge">{alertCount} ALERT</span>}
          </div>
          <div className="filter-bar">
            {["all", "alert", "dns", "http", "flow", "tls"].map(f => (
              <button key={f} className={`filter-btn ${filter === f ? `active-${f}` : ""}`} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
          <div className="alerts-list">
            {filteredAlerts.map((a, i) => (
              <div key={i} className={`alert-item${activeAlert === alerts.indexOf(a) ? " active" : ""}`} onClick={() => setActiveAlert(alerts.indexOf(a))}>
                <div className="alert-top">
                  <span className={`sev-tag ${sevColor(a.event_type)}`}>{a.event_type}</span>
                  <span className="alert-time">{a.timestamp?.substring(11, 19)}</span>
                </div>
                <div className="alert-ips"><span>{a.src_ip}</span>{" → "}{a.dest_ip}</div>
              </div>
            ))}
            {filteredAlerts.length === 0 && (
              <div style={{ padding: "20px 14px", fontFamily: "var(--mono)", fontSize: "9px", color: "var(--text-dim)", textAlign: "center" }}>
                NO {filter.toUpperCase()} EVENTS
              </div>
            )}
          </div>
        </aside>

        {/* MAIN */}
        <main className="main">
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

          <div className="chat-wrap">
            <div className="chat-header">
              <div className="ai-avatar">🤖</div>
              <div>
                <div className="ai-name">SIRA — Security Incident Response Assistant</div>
                <div className="ai-status">{loading ? "ANALYSING..." : "MONITORING LIVE"}</div>
              </div>
              <button className="clear-btn" onClick={() => setMessages([{ role: "ai", text: "Hello! I am SIRA, your Security Incident Response Assistant. Ask me anything about your logs.", time: new Date().toLocaleTimeString() }])}>
                Clear
              </button>
            </div>

            {/* Date and Time Filter Bar */}
            <div className="date-filter-bar">
              <span style={{ fontFamily: "var(--mono)", fontSize: "8px", color: "var(--text-dim)", letterSpacing: "1px", textTransform: "uppercase" }}>Filter:</span>
              <input type="date" className="date-input" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
              <select className="hour-select" value={hourFilter} onChange={e => setHourFilter(e.target.value)}>
                <option value="">All Hours</option>
                {[...Array(24)].map((_, i) => (
                  <option key={i} value={String(i).padStart(2, '0')}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
              {isFilterActive && (
                <>
                  <span className="filter-active-badge">FILTER ON</span>
                  <button className="clear-filter-btn" onClick={() => { setDateFilter(""); setHourFilter(""); }}>Clear</button>
                </>
              )}
            </div>

            <div className="messages" ref={messagesRef}>
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div className={`msg-icon ${m.role}`}>{m.role === "ai" ? "🤖" : "👤"}</div>
                  <div className="bubble-wrap">
                    <div className="bubble">{m.text}</div>
                    <div className="msg-time">{m.time}</div>
                  </div>
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
                  placeholder="Ask SIRA about your logs..."
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
              <div key={t} className={`tab${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>{t}</div>
            ))}
          </div>

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

          <div className={`tab-body${activeTab === "mitre" ? " active" : ""}`}>
            {[
              { id: "T1046", name: "Network Service Discovery", desc: "Port scanning detected via nmap signatures.", tactic: "Discovery" },
              { id: "T1021", name: "Remote Services", desc: "Lateral movement via SMB or SSH connections.", tactic: "Lateral Movement" },
              { id: "T1041", name: "Exfiltration Over C2", desc: "Data sent outside the network via C2 channel.", tactic: "Exfiltration" },
            ].map((t, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div className="detail-label">{t.tactic}</div>
                <div className="detail-value">
                  <span className="hi">{t.id}</span> — {t.name}
                  <div style={{ color: "var(--text-dim)", fontSize: 9, marginTop: 4 }}>{t.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="actions">
            <button className="action-btn btn-red" onClick={() => showToast("Escalated to Tier 2 analyst")}>🚨 Escalate Alert</button>
            <button className="action-btn btn-orange" onClick={() => showToast(`IP ${selected.src_ip} blocked`)}>🔒 Block Source IP</button>
            <button className="action-btn btn-green" onClick={() => showToast("Alert marked as investigated")}>✅ Mark Investigated</button>
          </div>
        </aside>

      </div>
      <div className={`toast${toast ? " show" : ""}`}>{toast}</div>
    </>
  );
}