import { useState, useEffect, useRef } from "react";

const FLASK_URL = "http://localhost:5000";

const MODEL_OPTIONS = [
  { value: "ollama",      label: "SIRA Model — qwen2.5 (local)",       tag: "Local — free",   needsKey: false, chip: "sira-model (local)" },
  { value: "ollama_phi3", label: "Phi3 3.8B — fastest (local)",        tag: "Local — free",   needsKey: false, chip: "Phi3 3.8B (local)" },
  { value: "groq",        label: "Groq — Llama 3.3 70B (cloud)",       tag: "Cloud — free",   needsKey: false, chip: "Groq llama3 (cloud)" },
  { value: "gemini", label: "Google Gemini 2.0 Flash (cloud)", tag: "Cloud — free", needsKey: false, chip: "Gemini 2.0 Flash (cloud)" },
  { value: "mistral", label: "Mistral Small (cloud — free)", tag: "Cloud — free", needsKey: false, chip: "Mistral Small (cloud)" },
];

const QUICK_QUESTIONS = [
  "What IPs triggered alerts?",
  "Suspicious activity?",
  "What should I do?",
  "Summarise events",
];

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:          #eef1f8;
    --surface:     #ffffff;
    --surface2:    #f4f6fb;
    --surface3:    #e8ecf5;
    --border:      #dde1ee;
    --border2:     #c8cede;
    --accent:      #2563eb;
    --accent-dark: #1d4ed8;
    --accent-lite: #dbeafe;
    --accent-glow: rgba(37,99,235,0.10);
    --green:       #059669;
    --green-bg:    #ecfdf5;
    --green-bd:    #a7f3d0;
    --red:         #dc2626;
    --red-bg:      #fef2f2;
    --red-bd:      #fecaca;
    --orange:      #d97706;
    --orange-bg:   #fffbeb;
    --orange-bd:   #fde68a;
    --text:        #0f172a;
    --text-mid:    #475569;
    --text-dim:    #94a3b8;
    --mono: 'JetBrains Mono', monospace;
    --sans: 'Plus Jakarta Sans', sans-serif;
    --r:    10px;
    --sh:   0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
    --sh-md:0 4px 16px rgba(0,0,0,0.08);
  }

  html, body, #root { height: 100%; }
  body { font-family: var(--sans); background: var(--bg); color: var(--text); overflow: hidden; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 4px; }

  /* ── FULL SCREEN LAYOUT ── */
  .app {
    display: grid;
    grid-template-rows: 58px 1fr;
    grid-template-columns: 300px 1fr;
    height: 100vh;
    width: 100vw;
  }

  /* ── TOP NAV ── */
  .topnav {
    grid-column: 1 / -1;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 24px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    box-shadow: var(--sh);
    z-index: 10;
  }
  .nav-left { display: flex; align-items: center; gap: 12px; }
  .shield-icon {
    width: 36px; height: 36px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    border-radius: 9px; display: flex; align-items: center; justify-content: center;
    font-size: 18px; box-shadow: 0 2px 8px rgba(37,99,235,0.35);
  }
  .nav-title     { font-size: 15px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; }
  .nav-subtitle  { font-size: 11px; color: var(--text-dim); margin-top: 1px; }
  .nav-right     { display: flex; align-items: center; gap: 10px; }
  .nav-pill {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; font-weight: 500; color: var(--text-mid);
    background: var(--surface2); border: 1px solid var(--border);
    padding: 5px 12px; border-radius: 20px;
  }
  .ndot { width: 6px; height: 6px; border-radius: 50%; }
  .ndot-green { background: #10b981; box-shadow: 0 0 0 2px rgba(16,185,129,0.2); animation: glow-dot 2s infinite; }
  .ndot-red   { background: var(--red); }
  .ndot-blue  { background: var(--accent); }
  @keyframes glow-dot { 0%,100%{opacity:1} 50%{opacity:0.45} }
  .nav-time { font-family: var(--mono); font-size: 10px; color: var(--text-dim); }

  /* ── LEFT PANEL ── */
  .left-panel {
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .section-head {
    padding: 14px 16px 0;
    font-size: 9px; font-weight: 700;
    color: var(--text-dim); letter-spacing: 1.5px; text-transform: uppercase;
  }

  /* Model selector */
  .model-select-wrap { position: relative; padding: 8px 16px 0; }
  .model-select {
    width: 100%; appearance: none;
    background: var(--surface2); border: 1.5px solid var(--border2);
    border-radius: var(--r); padding: 10px 36px 10px 13px;
    font-family: var(--sans); font-size: 13px; font-weight: 500;
    color: var(--text); cursor: pointer; outline: none; transition: all 0.15s;
  }
  .model-select:focus { border-color: var(--accent); background: white; box-shadow: 0 0 0 3px var(--accent-glow); }
  .sel-arrow { position: absolute; right: 28px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--text-dim); font-size: 10px; }
  .model-tag {
    display: inline-block; margin: 8px 16px 0;
    font-family: var(--mono); font-size: 9px; font-weight: 600;
    padding: 3px 10px; border-radius: 20px; border: 1px solid;
  }
  .tag-local { background: var(--green-bg);  color: var(--green);  border-color: var(--green-bd); }
  .tag-cloud { background: var(--orange-bg); color: var(--orange); border-color: var(--orange-bd); }

  .divider { height: 1px; background: var(--border); margin: 14px 0; }

  /* Stats */
  .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 0 16px; }
  .stat-card {
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: var(--r); padding: 12px 14px;
    position: relative; overflow: hidden;
  }
  .stat-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
    border-radius: var(--r) var(--r) 0 0;
  }
  .stat-card.blue::before   { background: linear-gradient(90deg,#2563eb,#60a5fa); }
  .stat-card.red::before    { background: linear-gradient(90deg,#dc2626,#f87171); }
  .stat-card.orange::before { background: linear-gradient(90deg,#d97706,#fbbf24); }
  .stat-card.green::before  { background: linear-gradient(90deg,#059669,#34d399); }
  .stat-lbl { font-size: 9px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .stat-val  { font-family: var(--mono); font-size: 26px; font-weight: 700; line-height: 1; }
  .stat-val.blue   { color: var(--accent); }
  .stat-val.red    { color: var(--red); }
  .stat-val.orange { color: var(--orange); }
  .stat-val.green  { color: var(--green); }

  /* Live event feed */
  .feed-head { padding: 14px 16px 6px; font-size: 9px; font-weight: 700; color: var(--text-dim); letter-spacing: 1.5px; text-transform: uppercase; }
  .feed { flex: 1; overflow-y: auto; padding: 0 16px 16px; display: flex; flex-direction: column; gap: 5px; }
  .feed-item {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 10px; border-radius: 7px;
    background: var(--surface2); border: 1px solid var(--border);
    cursor: default; transition: all 0.12s;
  }
  .feed-item:hover { background: var(--accent-lite); border-color: rgba(37,99,235,0.2); }
  .feed-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .feed-dot.alert { background: var(--red); }
  .feed-dot.dns   { background: var(--accent); }
  .feed-dot.http  { background: var(--green); }
  .feed-dot.tls   { background: var(--orange); }
  .feed-dot.flow  { background: var(--text-dim); }
  .feed-type { font-family: var(--mono); font-size: 9px; font-weight: 600; min-width: 34px; color: var(--text-mid); text-transform: uppercase; }
  .feed-ips  { font-family: var(--mono); font-size: 9px; color: var(--text-dim); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .feed-src  { color: var(--accent); }
  .feed-time { font-family: var(--mono); font-size: 8px; color: var(--text-dim); }

  /* ── CHAT COLUMN ── */
  .chat-col { display: flex; flex-direction: column; overflow: hidden; background: var(--bg); }
  .chat-topbar {
    display: flex; align-items: center; gap: 10px;
    padding: 0 20px; height: 54px; flex-shrink: 0;
    background: var(--surface); border-bottom: 1px solid var(--border);
    box-shadow: var(--sh);
  }
  .chat-avatar {
    width: 34px; height: 34px;
    background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
    border-radius: 9px; display: flex; align-items: center; justify-content: center;
    font-size: 17px; box-shadow: 0 2px 8px rgba(37,99,235,0.3);
  }
  .chat-agent-name { font-size: 14px; font-weight: 700; color: var(--text); }
  .chat-agent-sub  { font-size: 10px; color: var(--text-mid); }
  .sdot { width: 7px; height: 7px; border-radius: 50%; background: #10b981; display: inline-block; margin-right: 5px; animation: glow-dot 2s infinite; }
  .model-chip {
    margin-left: auto;
    font-family: var(--mono); font-size: 9px; font-weight: 600;
    padding: 4px 10px; border-radius: 20px;
    background: var(--surface2); color: var(--text-mid);
    border: 1px solid var(--border2);
  }
  .clear-btn {
    background: transparent; border: 1px solid var(--border2);
    color: var(--text-dim); padding: 5px 12px; border-radius: 6px;
    font-size: 10px; font-family: var(--sans); font-weight: 500;
    cursor: pointer; transition: all 0.13s;
  }
  .clear-btn:hover { border-color: var(--red); color: var(--red); }

  /* Messages */
  .messages {
    flex: 1; overflow-y: auto;
    padding: 20px 24px;
    display: flex; flex-direction: column; gap: 14px;
  }
  .msg { display: flex; }
  .msg.user { justify-content: flex-end; }
  .bubble-wrap { display: flex; flex-direction: column; max-width: 68%; }
  .msg.user .bubble-wrap { align-items: flex-end; }
  .bubble { padding: 11px 15px; border-radius: 14px; font-size: 13px; line-height: 1.7; }
  .msg.ai .bubble {
    background: var(--surface); border: 1px solid var(--border);
    border-top-left-radius: 4px; color: var(--text); box-shadow: var(--sh);
  }
  .msg.user .bubble {
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: white; border-top-right-radius: 4px;
    box-shadow: 0 2px 12px rgba(37,99,235,0.3);
  }
  .msg-time { font-family: var(--mono); font-size: 8px; color: var(--text-dim); margin-top: 5px; padding: 0 3px; }
  .msg.user .msg-time { text-align: right; }

  .typing {
    display: flex; gap: 5px; padding: 11px 15px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 14px; border-top-left-radius: 4px;
    width: fit-content; box-shadow: var(--sh);
  }
  .typing span { width: 6px; height: 6px; background: var(--accent); border-radius: 50%; animation: bounce 1s infinite; }
  .typing span:nth-child(2) { animation-delay: 0.15s; }
  .typing span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes bounce { 0%,100%{transform:translateY(0);opacity:0.3} 50%{transform:translateY(-5px);opacity:1} }

  /* Input area */
  .input-area {
    padding: 14px 24px 18px;
    background: var(--surface); border-top: 1px solid var(--border);
    box-shadow: 0 -2px 12px rgba(0,0,0,0.04);
  }
  .quick-btns { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 12px; }
  .qbtn {
    font-size: 11.5px; font-family: var(--sans); font-weight: 500;
    padding: 6px 14px; border-radius: 20px;
    border: 1.5px solid var(--border2);
    background: var(--surface2); color: var(--text-mid);
    cursor: pointer; transition: all 0.13s;
  }
  .qbtn:hover {
    border-color: var(--accent); color: var(--accent);
    background: var(--accent-lite); transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(37,99,235,0.12);
  }
  .input-row { display: flex; gap: 10px; }
  .chat-input {
    flex: 1; background: var(--surface2);
    border: 1.5px solid var(--border2); border-radius: 10px;
    padding: 11px 16px; color: var(--text);
    font-family: var(--sans); font-size: 13px; outline: none; transition: all 0.15s;
  }
  .chat-input::placeholder { color: var(--text-dim); }
  .chat-input:focus { border-color: var(--accent); background: white; box-shadow: 0 0 0 3px var(--accent-glow); }
  .send-btn {
    padding: 11px 24px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    border: none; border-radius: 10px;
    cursor: pointer; color: white;
    font-size: 13px; font-family: var(--sans); font-weight: 600;
    transition: all 0.13s; flex-shrink: 0;
    box-shadow: 0 2px 10px rgba(37,99,235,0.3);
  }
  .send-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(37,99,235,0.4); }
  .send-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }

  /* ── MOBILE ── */
  @media (max-width: 768px) {
    body { overflow: auto; }
    .app { display: flex; flex-direction: column; height: auto; min-height: 100vh; }
    .topnav { position: sticky; top: 0; z-index: 20; flex-wrap: wrap; gap: 6px; padding: 8px 14px; height: auto; }
    .nav-right { flex-wrap: wrap; gap: 6px; }
    .left-panel { border-right: none; border-bottom: 1px solid var(--border); }
    .stats-grid { grid-template-columns: repeat(4,1fr); }
    .feed { max-height: 140px; }
    .messages { padding: 14px 16px; }
    .input-area { padding: 12px 16px 16px; }
    .bubble-wrap { max-width: 85%; }
  }
`;

const MOCK_ALERTS = [
  { event_type: "alert", src_ip: "192.168.68.105", dest_ip: "10.0.0.45",      timestamp: "2026-04-27T09:14:32" },
  { event_type: "dns",   src_ip: "192.168.68.57",  dest_ip: "8.8.8.8",        timestamp: "2026-04-27T09:11:05" },
  { event_type: "http",  src_ip: "192.168.68.57",  dest_ip: "142.250.1.1",    timestamp: "2026-04-27T09:10:22" },
  { event_type: "flow",  src_ip: "192.168.68.54",  dest_ip: "203.109.191.8",  timestamp: "2026-04-27T09:08:14" },
  { event_type: "tls",   src_ip: "192.168.68.57",  dest_ip: "172.217.25.163", timestamp: "2026-04-27T09:07:55" },
  { event_type: "alert", src_ip: "192.168.68.44",  dest_ip: "10.0.0.1",       timestamp: "2026-04-27T09:06:33" },
  { event_type: "flow",  src_ip: "192.168.68.51",  dest_ip: "203.109.191.8",  timestamp: "2026-04-27T09:05:12" },
  { event_type: "http",  src_ip: "192.168.68.57",  dest_ip: "142.250.1.1",    timestamp: "2026-04-27T09:04:01" },
];

export default function App() {
  const [selectedModel, setSelectedModel] = useState("ollama");
  const [messages, setMessages]           = useState([
    { role: "ai", text: "Hello! I am SIRA, your Security Incident Response Assistant. I have loaded your Suricata and Zeek logs. Ask me anything about your network activity.", time: new Date().toLocaleTimeString() }
  ]);
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const [alerts, setAlerts]   = useState(MOCK_ALERTS);
  const [time, setTime]       = useState(new Date().toLocaleTimeString());
  const messagesRef           = useRef(null);

  const modelObj = MODEL_OPTIONS.find(m => m.value === selectedModel);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch(`${FLASK_URL}/logs`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data) && data.length > 0) setAlerts(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (messagesRef.current)
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages, loading]);

  const sendMessage = async (text) => {
    const q = (text || input).trim();
    if (!q || loading) return;
    setInput("");
    const now = new Date().toLocaleTimeString();
    setMessages(prev => [...prev, { role: "user", text: q, time: now }]);
    setLoading(true);
    try {
      const res = await fetch(`${FLASK_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, model: selectedModel })
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "ai", text: data.answer, time: new Date().toLocaleTimeString() }]);
    } catch {
      setMessages(prev => [...prev, { role: "ai", text: "Could not reach the Flask server. Make sure it is running on port 5000.", time: new Date().toLocaleTimeString() }]);
    }
    setLoading(false);
  };

  const alertCount = alerts.filter(a => a.event_type === "alert").length;
  const uniqueIPs  = [...new Set(alerts.map(a => a.src_ip).filter(Boolean))].length;

  return (
    <>
      <style>{css}</style>
      <div className="app">

        {/* ── TOP NAV ── */}
        <nav className="topnav">
          <div className="nav-left">
            <div className="shield-icon">🛡</div>
            <div>
              <div className="nav-title">SOC Copilot</div>
              <div className="nav-subtitle">Security Operations Centre</div>
            </div>
          </div>
          <div className="nav-right">
            <div className="nav-pill"><div className="ndot ndot-green" />Suricata Live</div>
            <div className="nav-pill"><div className="ndot ndot-green" />Zeek Online</div>
            <div className="nav-pill"><div className="ndot ndot-red" />{alertCount} Alerts</div>
            <div className="nav-pill"><div className="ndot ndot-blue" />AI Ready</div>
            <div className="nav-time">{time}</div>
          </div>
        </nav>

        {/* ── LEFT PANEL ── */}
        <aside className="left-panel">
          <div className="section-head" style={{ marginTop: 14 }}>AI Model</div>
          <div className="model-select-wrap">
            <select
              className="model-select"
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
            >
              {MODEL_OPTIONS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <span className="sel-arrow">▾</span>
          </div>
          <span className={`model-tag ${modelObj.tag.includes("Cloud") ? "tag-cloud" : "tag-local"}`}>
            {modelObj.tag}
          </span>

          {/* API key input intentionally removed — keys are managed in backend .env */}

          <div className="divider" />

          <div className="section-head">Overview</div>
          <div className="stats-grid" style={{ marginTop: 10 }}>
            <div className="stat-card blue">
              <div className="stat-lbl">Total Events</div>
              <div className="stat-val blue">{alerts.length}</div>
            </div>
            <div className="stat-card red">
              <div className="stat-lbl">Alerts</div>
              <div className="stat-val red">{alertCount}</div>
            </div>
            <div className="stat-card orange">
              <div className="stat-lbl">Unique IPs</div>
              <div className="stat-val orange">{uniqueIPs}</div>
            </div>
            <div className="stat-card green">
              <div className="stat-lbl">Status</div>
              <div className="stat-val green">OK</div>
            </div>
          </div>

          <div className="divider" />

          <div className="feed-head">Live Events</div>
          <div className="feed">
            {alerts.slice(0, 20).map((a, i) => (
              <div key={i} className="feed-item">
                <div className={`feed-dot ${a.event_type}`} />
                <span className="feed-type">{a.event_type}</span>
                <span className="feed-ips">
                  <span className="feed-src">{a.src_ip}</span> → {a.dest_ip}
                </span>
                <span className="feed-time">{a.timestamp?.substring(11, 19)}</span>
              </div>
            ))}
          </div>
        </aside>

        {/* ── CHAT COLUMN ── */}
        <div className="chat-col">
          <div className="chat-topbar">
            <div className="chat-avatar">🤖</div>
            <div>
              <div className="chat-agent-name">SIRA</div>
              <div className="chat-agent-sub">
                <span className="sdot" />
                {loading ? "Analysing..." : "Security Incident Response Assistant"}
              </div>
            </div>
            <div className="model-chip">{modelObj.chip}</div>
            <button className="clear-btn" onClick={() => setMessages([])}>Clear chat</button>
          </div>

          <div className="messages" ref={messagesRef}>
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <div className="bubble-wrap">
                  <div className="bubble">{m.text}</div>
                  <div className="msg-time">{m.time}</div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="msg ai">
                <div className="typing"><span /><span /><span /></div>
              </div>
            )}
          </div>

          <div className="input-area">
            <div className="quick-btns">
              {QUICK_QUESTIONS.map((q, i) => (
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
              <button className="send-btn" onClick={() => sendMessage()} disabled={loading}>Ask</button>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}