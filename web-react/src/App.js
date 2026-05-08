import { useState, useEffect, useRef, useCallback } from "react";

const FLASK_URL = "http://localhost:5000";

const MODEL_OPTIONS = [
  { value: "ollama",      label: "SIRA — qwen2.5:7b (local)",        tag: "LOCAL — FREE", chip: "sira-model (local)",    cloud: false },
  { value: "ollama_phi3", label: "Phi3 3.8B — fastest (local)",      tag: "LOCAL — FREE", chip: "phi3 3.8b (local)",     cloud: false },
  { value: "groq",        label: "Groq — Llama 3.3 70B (cloud)",     tag: "CLOUD — FREE", chip: "groq llama3 (cloud)",   cloud: true  },
  { value: "gemini",      label: "Google Gemini 2.0 Flash (cloud)",  tag: "CLOUD — FREE", chip: "gemini 2.0 (cloud)",    cloud: true  },
  { value: "mistral",     label: "Mistral Small (cloud — free)",     tag: "CLOUD — FREE", chip: "mistral small (cloud)", cloud: true  },
];

const QUICK_QUESTIONS = [
  "What IPs triggered alerts?",
  "Suspicious activity?",
  "What should I do?",
  "Summarise events",
];

function parseSiraResponse(text) {
  const sections = ["SUMMARY", "THREAT DETAILS", "RISK ASSESSMENT", "RECOMMENDED ACTIONS"];
  const result = [];
  for (let i = 0; i < sections.length; i++) {
    const current = sections[i];
    const next = sections[i + 1];
    const startIdx = text.indexOf(current);
    if (startIdx === -1) continue;
    const contentStart = startIdx + current.length;
    const endIdx = next ? text.indexOf(next) : text.length;
    const content = text.slice(contentStart, endIdx !== -1 ? endIdx : undefined).replace(/^[\s:\-]+/, "").trim();
    result.push({ heading: current, content });
  }
  return result.length === 0 ? null : result;
}

function getRiskLevel(text) {
  if (/HIGH/i.test(text)) return "high";
  if (/MEDIUM/i.test(text)) return "medium";
  if (/LOW/i.test(text)) return "low";
  return null;
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #080c12; --bg2: #0d1219; --bg3: #111820; --panel: #0f1520;
    --border: rgba(255,255,255,0.06); --border2: rgba(255,255,255,0.10);
    --accent: #00e5ff; --accent2: #00b4cc;
    --accent-glow: rgba(0,229,255,0.12); --accent-dim: rgba(0,229,255,0.06);
    --green: #00ff9d; --green-dim: rgba(0,255,157,0.08);
    --red: #ff3d5a; --red-dim: rgba(255,61,90,0.08);
    --orange: #ffaa00; --orange-dim: rgba(255,170,0,0.08);
    --purple: #b47cff;
    --text: #e8f0fe; --text-mid: #7a8fa6; --text-dim: #3d4f63;
    --mono: 'Space Mono', monospace; --sans: 'Syne', sans-serif;
  }
  html, body, #root { height: 100%; }
  body { font-family: var(--sans); background: var(--bg); color: var(--text); overflow: hidden; }
  body::before {
    content: ''; position: fixed; inset: 0;
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px);
    pointer-events: none; z-index: 9998;
  }
  body::after {
    content: ''; position: fixed; inset: 0;
    background-image: linear-gradient(rgba(0,229,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.025) 1px, transparent 1px);
    background-size: 40px 40px; pointer-events: none; z-index: 0;
  }
  ::-webkit-scrollbar { width: 2px; }
  ::-webkit-scrollbar-thumb { background: var(--border2); }
  .app { position: relative; z-index: 1; display: grid; grid-template-rows: 52px 1fr; grid-template-columns: var(--sidebar-width, 320px) 1fr; height: 100vh; width: 100vw; }
  .topnav { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; background: var(--bg2); border-bottom: 1px solid var(--border); position: relative; z-index: 10; }
  .topnav::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--accent), transparent); opacity: 0.4; }
  .nav-brand { display: flex; align-items: center; gap: 10px; }
  .brand-icon { width: 32px; height: 32px; background: linear-gradient(135deg, var(--accent), var(--purple)); clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); display: flex; align-items: center; justify-content: center; font-size: 14px; box-shadow: 0 0 20px rgba(0,229,255,0.4); animation: pulse-icon 3s ease-in-out infinite; }
  @keyframes pulse-icon { 0%,100%{box-shadow:0 0 20px rgba(0,229,255,0.4)} 50%{box-shadow:0 0 35px rgba(0,229,255,0.7)} }
  .brand-name { font-size: 15px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; }
  .brand-sub { font-family: var(--mono); font-size: 8px; color: var(--accent); letter-spacing: 3px; text-transform: uppercase; margin-top: 1px; }
  .nav-status { display: flex; align-items: center; gap: 8px; }
  .status-pill { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 3px; border: 1px solid var(--border2); background: var(--bg3); font-family: var(--mono); font-size: 9px; color: var(--text-mid); letter-spacing: 1px; }
  .ndot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
  .ndot-green { background: var(--green); box-shadow: 0 0 6px var(--green); animation: blink 2s infinite; }
  .ndot-red { background: var(--red); box-shadow: 0 0 6px var(--red); }
  .ndot-cyan { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .nav-time { font-family: var(--mono); font-size: 11px; color: var(--accent); letter-spacing: 2px; }
  .left-panel { background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
  .section-label { font-family: var(--mono); font-size: 8px; font-weight: 700; color: var(--accent); letter-spacing: 3px; text-transform: uppercase; display: flex; align-items: center; gap: 8px; padding: 14px 16px 0; }
  .section-label::after { content: ''; flex: 1; height: 1px; background: var(--border2); }
  .model-select-wrap { padding: 10px 16px 0; }
  .model-select { width: 100%; appearance: none; background: var(--bg3); border: 1px solid var(--border2); border-radius: 4px; padding: 10px 14px; font-family: var(--mono); font-size: 11px; color: var(--text); cursor: pointer; outline: none; transition: all 0.2s; }
  .model-select:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-glow); }
  .model-select option { background: var(--bg3); }
  .model-badge { display: inline-flex; align-items: center; gap: 5px; margin: 8px 16px 0; font-family: var(--mono); font-size: 8px; letter-spacing: 1px; padding: 3px 8px; border-radius: 2px; border: 1px solid; }
  .badge-local { color: var(--green); border-color: rgba(0,255,157,0.3); background: var(--green-dim); }
  .badge-cloud { color: var(--orange); border-color: rgba(255,170,0,0.3); background: var(--orange-dim); }
  .panel-divider { height: 1px; background: var(--border); margin: 14px 0; }
  .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 0 16px; }
  .stat { background: var(--bg3); border: 1px solid var(--border); border-radius: 4px; padding: 12px; position: relative; overflow: hidden; transition: border-color 0.2s; }
  .stat:hover { border-color: var(--border2); }
  .stat-glow { position: absolute; top: 0; left: 0; right: 0; height: 1px; }
  .stat-glow.c { background: linear-gradient(90deg, transparent, var(--accent), transparent); }
  .stat-glow.r { background: linear-gradient(90deg, transparent, var(--red), transparent); }
  .stat-glow.o { background: linear-gradient(90deg, transparent, var(--orange), transparent); }
  .stat-glow.g { background: linear-gradient(90deg, transparent, var(--green), transparent); }
  .stat-label { font-family: var(--mono); font-size: 7px; color: var(--text-dim); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 6px; }
  .stat-value { font-family: var(--mono); font-size: 26px; font-weight: 700; line-height: 1; }
  .stat-value.c { color: var(--accent); }
  .stat-value.r { color: var(--red); text-shadow: 0 0 12px rgba(255,61,90,0.4); }
  .stat-value.o { color: var(--orange); }
  .stat-value.g { color: var(--green); font-size: 14px; padding-top: 6px; }
  .feed-wrap { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
  .feed { flex: 1; overflow-y: auto; padding: 0 16px 16px; display: flex; flex-direction: column; gap: 3px; }
  .feed-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 10px; border-radius: 3px; border: 1px solid transparent; background: var(--bg3); cursor: default; transition: all 0.15s; position: relative; overflow: hidden; flex-shrink: 0; }
  .feed-item::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; }
  .feed-item.alert::before { background: var(--red); }
  .feed-item.dns::before   { background: var(--accent); }
  .feed-item.http::before  { background: var(--green); }
  .feed-item.tls::before   { background: var(--purple); }
  .feed-item.flow::before  { background: var(--text-dim); }
  .feed-item:hover { border-color: var(--border2); background: var(--bg2); }
  .feed-type { font-family: var(--mono); font-size: 8px; font-weight: 700; min-width: 30px; text-transform: uppercase; }
  .feed-type.alert { color: var(--red); }
  .feed-type.dns   { color: var(--accent); }
  .feed-type.http  { color: var(--green); }
  .feed-type.tls   { color: var(--purple); }
  .feed-type.flow  { color: var(--text-dim); }
  .feed-ips { font-family: var(--mono); font-size: 8px; color: var(--text-mid); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .feed-src { color: var(--accent); }
  .feed-time { font-family: var(--mono); font-size: 7px; color: var(--text-dim); flex-shrink: 0; }
  .chat-col { display: flex; flex-direction: column; overflow: hidden; background: var(--bg); }
  .chat-header { display: flex; align-items: center; gap: 12px; padding: 0 20px; height: 52px; flex-shrink: 0; background: var(--panel); border-bottom: 1px solid var(--border); }
  .agent-avatar { width: 36px; height: 36px; flex-shrink: 0; background: linear-gradient(135deg, var(--accent), var(--purple)); clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 0 15px rgba(0,229,255,0.3); }
  .agent-name { font-size: 14px; font-weight: 800; letter-spacing: 1px; }
  .agent-sub { font-family: var(--mono); font-size: 9px; color: var(--text-mid); }
  .sdot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--green); box-shadow: 0 0 6px var(--green); margin-right: 5px; animation: blink 2s infinite; }
  .model-chip { margin-left: auto; font-family: var(--mono); font-size: 8px; letter-spacing: 1px; padding: 4px 10px; border-radius: 2px; background: var(--accent-dim); color: var(--accent); border: 1px solid rgba(0,229,255,0.2); }
  .clear-btn { background: transparent; border: 1px solid var(--border2); color: var(--text-dim); padding: 5px 12px; border-radius: 3px; font-family: var(--mono); font-size: 9px; letter-spacing: 1px; cursor: pointer; transition: all 0.15s; text-transform: uppercase; }
  .clear-btn:hover { border-color: var(--red); color: var(--red); }
  .messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
  .msg { display: flex; }
  .msg.user { justify-content: flex-end; }
  .bubble-wrap { display: flex; flex-direction: column; max-width: 72%; }
  .msg.user .bubble-wrap { align-items: flex-end; }
  .bubble { padding: 12px 16px; font-size: 13px; line-height: 1.7; border-radius: 2px; }
  .msg.ai .bubble { background: var(--panel); border: 1px solid var(--border2); border-left: 2px solid var(--accent); color: var(--text); }
  .msg.user .bubble { background: linear-gradient(135deg, rgba(0,229,255,0.12), rgba(180,124,255,0.12)); border: 1px solid rgba(0,229,255,0.2); color: var(--text); }
  .sira-section { margin-bottom: 14px; }
  .sira-section:last-child { margin-bottom: 0; }
  .sira-heading { font-family: var(--mono); font-size: 8px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 7px; padding-bottom: 5px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 6px; }
  .sira-heading.summary { color: var(--accent); }
  .sira-heading.threat  { color: var(--red); }
  .sira-heading.risk    { color: var(--orange); }
  .sira-heading.actions { color: var(--green); }
  .sira-body { font-size: 12px; line-height: 1.85; color: var(--text-mid); white-space: pre-wrap; }
  .risk-badge { display: inline-block; font-family: var(--mono); font-size: 9px; padding: 2px 8px; border-radius: 2px; font-weight: 700; letter-spacing: 1px; margin-left: 8px; }
  .risk-high   { background: var(--red-dim);    color: var(--red);    border: 1px solid rgba(255,61,90,0.3); }
  .risk-medium { background: var(--orange-dim); color: var(--orange); border: 1px solid rgba(255,170,0,0.3); }
  .risk-low    { background: var(--green-dim);  color: var(--green);  border: 1px solid rgba(0,255,157,0.3); }
  .msg-meta { font-family: var(--mono); font-size: 8px; color: var(--text-dim); margin-top: 5px; display: flex; align-items: center; gap: 10px; }
  .msg.user .msg-meta { justify-content: flex-end; }
  .copy-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; font-family: var(--mono); font-size: 8px; letter-spacing: 1px; text-transform: uppercase; padding: 0; transition: color 0.15s; }
  .copy-btn:hover { color: var(--accent); }
  .typing-wrap { display: flex; gap: 6px; align-items: center; padding: 12px 16px; background: var(--panel); border: 1px solid var(--border2); border-left: 2px solid var(--accent); border-radius: 2px; width: fit-content; }
  .typing-label { font-family: var(--mono); font-size: 9px; color: var(--accent); letter-spacing: 2px; }
  .typing-dot { width: 4px; height: 4px; border-radius: 50%; animation: bounce 1s infinite; }
  .typing-dot:nth-child(2) { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
  .typing-dot:nth-child(3) { background: var(--purple); box-shadow: 0 0 6px var(--purple); animation-delay: 0.15s; }
  .typing-dot:nth-child(4) { background: var(--accent); box-shadow: 0 0 6px var(--accent); animation-delay: 0.3s; }
  @keyframes bounce { 0%,100%{transform:translateY(0);opacity:0.3} 50%{transform:translateY(-5px);opacity:1} }
  .input-area { padding: 12px 20px 16px; background: var(--panel); border-top: 1px solid var(--border); }
  .quick-btns { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
  .qbtn { font-family: var(--mono); font-size: 9px; letter-spacing: 1px; text-transform: uppercase; padding: 5px 12px; border-radius: 2px; border: 1px solid var(--border2); background: var(--bg3); color: var(--text-mid); cursor: pointer; transition: all 0.15s; }
  .qbtn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
  .input-row { display: flex; gap: 8px; }
  .chat-input { flex: 1; background: var(--bg3); border: 1px solid var(--border2); border-radius: 3px; padding: 11px 16px; color: var(--text); font-family: var(--mono); font-size: 12px; outline: none; transition: all 0.2s; }
  .chat-input::placeholder { color: var(--text-dim); }
  .chat-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-glow); }
  .send-btn { padding: 11px 24px; background: linear-gradient(135deg, var(--accent), var(--accent2)); border: none; border-radius: 3px; cursor: pointer; color: var(--bg); font-family: var(--mono); font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; transition: all 0.15s; box-shadow: 0 0 16px rgba(0,229,255,0.25); }
  .send-btn:hover { box-shadow: 0 0 24px rgba(0,229,255,0.5); transform: translateY(-1px); }
  .send-btn:disabled { opacity: 0.3; cursor: not-allowed; transform: none; }
  .toast { position: fixed; bottom: 80px; right: 20px; background: var(--panel); border: 1px solid var(--accent); color: var(--accent); font-family: var(--mono); font-size: 10px; padding: 8px 16px; border-radius: 3px; letter-spacing: 1px; z-index: 9999; box-shadow: 0 0 16px rgba(0,229,255,0.2); animation: fadeIn 0.2s ease; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  .welcome-card { background: var(--panel); border: 1px solid var(--border2); border-left: 2px solid var(--accent); border-radius: 2px; padding: 18px; }
  .welcome-title { font-size: 17px; font-weight: 800; letter-spacing: 1px; margin-bottom: 6px; }
  .welcome-title span { color: var(--accent); }
  .welcome-body { font-family: var(--mono); font-size: 11px; color: var(--text-mid); line-height: 1.8; }
  .welcome-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
  .wtag { font-family: var(--mono); font-size: 8px; letter-spacing: 1px; padding: 3px 8px; border-radius: 2px; border: 1px solid var(--border2); color: var(--text-dim); }
  @media (max-width: 768px) {
    body { overflow: auto; }
    .app { display: flex; flex-direction: column; height: auto; min-height: 100vh; }
    .topnav { flex-wrap: wrap; gap: 6px; padding: 8px 14px; height: auto; }
    .nav-status { flex-wrap: wrap; }
    .left-panel { border-right: none; border-bottom: 1px solid var(--border); }
    .feed { max-height: 160px; }
    .messages { padding: 14px 16px; }
    .bubble-wrap { max-width: 88%; }
  }
`;

function SiraMessage({ text }) {
  
  const sections = parseSiraResponse(text);
  if (!sections) {
    return <div className="bubble"><div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-mid)", lineHeight: 1.8 }}>{text}</div></div>;
  }
  const headingClass = { "SUMMARY": "summary", "THREAT DETAILS": "threat", "RISK ASSESSMENT": "risk", "RECOMMENDED ACTIONS": "actions" };
  return (
    <div className="bubble">
      {sections.map((s, i) => {
        const riskLevel = s.heading === "RISK ASSESSMENT" ? getRiskLevel(s.content) : null;
        return (
          <div key={i} className="sira-section">
            <div className={`sira-heading ${headingClass[s.heading] || ""}`}>
              ▸ {s.heading}
              {riskLevel && <span className={`risk-badge risk-${riskLevel}`}>{riskLevel.toUpperCase()}</span>}
            </div>
            <div className="sira-body">{s.content}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [selectedModel, setSelectedModel] = useState("ollama");
  const [messages, setMessages] = useState([{ role: "ai", text: null, time: new Date().toLocaleTimeString(), isWelcome: true }]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [alerts, setAlerts]     = useState([]);
  const [time, setTime]         = useState(new Date().toLocaleTimeString());
  const [toast, setToast]       = useState(null);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [reputations, setReputations] = useState({});
  const messagesRef             = useRef(null);
  const toastTimer              = useRef(null);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isResizing = useRef(false);

  const modelObj = MODEL_OPTIONS.find(m => m.value === selectedModel);
  const startResize = (e) => {
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (e) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(500, Math.max(220, startWidth + e.clientX - startX));
      setSidebarWidth(newWidth);
    };
    const onUp = () => { isResizing.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

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

  useEffect(() => {
    const alertIPs = [...new Set(alerts.filter(a => a.event_type === "alert").map(a => a.src_ip).filter(Boolean))];
    alertIPs.forEach(ip => checkReputation(ip));
  }, [alerts]);

  const handleModelChange = (e) => {
    const val = e.target.value;
    setSelectedModel(val);
    showToast(`Switched to ${MODEL_OPTIONS.find(x => x.value === val).chip}`);
  };

  const checkReputation = async (ip) => {
    if (reputations[ip]) return;
    try {
      const res = await fetch(`${FLASK_URL}/reputation/${ip}`);
      const data = await res.json();
      setReputations(prev => ({ ...prev, [ip]: data }));
    } catch {}
  };
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
      setMessages(prev => [...prev, { role: "ai", text: data.answer, time: new Date().toLocaleTimeString(), model: modelObj.chip }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: "ai", text: `Error: ${err.message}`, time: new Date().toLocaleTimeString() }]);
    }
    setLoading(false);
  };

  const alertCount = alerts.filter(a => a.event_type === "alert").length;
  const uniqueIPs  = [...new Set(alerts.map(a => a.src_ip).filter(Boolean))].length;
  const loadingLabel = { ollama: "SIRA", ollama_phi3: "PHI3", groq: "GROQ", gemini: "GEMINI", mistral: "MISTRAL" };

  return (
    <>
      <style>{css}</style>
      {toast && <div className="toast">✓ {toast.toUpperCase()}</div>}
      <div className="app" style={{ gridTemplateColumns: `${sidebarWidth}px 1fr` }}>

        <nav className="topnav">
          <div className="nav-brand">
            <div className="brand-icon">⬡</div>
            <div>
              <div className="brand-name">SOC Copilot</div>
              <div className="brand-sub">SIRA v3 — Threat Intelligence</div>
            </div>
          </div>
          <div className="nav-status">
            <div className="status-pill"><div className="ndot ndot-green" />SURICATA</div>
            <div className="status-pill"><div className="ndot ndot-green" />ZEEK</div>
            <div className="status-pill"><div className="ndot ndot-red" />{alertCount} ALERTS</div>
            <div className="status-pill"><div className="ndot ndot-cyan" />AI READY</div>
            <div className="nav-time">{time}</div>
          </div>
        </nav>

        <aside className="left-panel" style={{ position: "relative" }}>
        <div onMouseDown={startResize} style={{
  position: "absolute", right: 0, top: 0, bottom: 0, width: 4,
  cursor: "col-resize", zIndex: 10, background: "transparent",
  transition: "background 0.15s"
}} onMouseEnter={e => e.target.style.background = "var(--accent)"}
   onMouseLeave={e => e.target.style.background = "transparent"} />
          <div className="section-label">AI Engine</div>
          <div className="model-select-wrap">
            <select className="model-select" value={selectedModel} onChange={handleModelChange}>
              {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className={`model-badge ${modelObj.cloud ? "badge-cloud" : "badge-local"}`}>
            ⬡ {modelObj.tag}
          </div>

          <div className="panel-divider" />

          <div className="section-label">Overview</div>
          <div className="stats-grid" style={{ marginTop: 10 }}>
            <div className="stat"><div className="stat-glow c" /><div className="stat-label">Total Events</div><div className="stat-value c">{alerts.length || "--"}</div></div>
            <div className="stat"><div className="stat-glow r" /><div className="stat-label">Alerts</div><div className="stat-value r">{String(alertCount).padStart(2,"0")}</div></div>
            <div className="stat"><div className="stat-glow o" /><div className="stat-label">Unique IPs</div><div className="stat-value o">{uniqueIPs || "--"}</div></div>
            <div className="stat"><div className="stat-glow g" /><div className="stat-label">Status</div><div className="stat-value g">ONLINE</div></div>
          </div>

          <div className="panel-divider" />

          <div className="feed-wrap">
          <div className="section-label">Live Feed</div>
<div style={{ display:"flex", gap:4, padding:"8px 16px 6px", flexWrap:"wrap" }}>
  {["all","alert","dns","http","tls","flow"].map(f => (
    <button key={f} onClick={() => setSeverityFilter(f)} style={{
      fontFamily:"var(--mono)", fontSize:8, letterSpacing:1, textTransform:"uppercase",
      padding:"3px 8px", borderRadius:2, cursor:"pointer", transition:"all 0.15s",
      background: severityFilter === f ? "var(--accent)" : "var(--bg3)",
      color: severityFilter === f ? "var(--bg)" : "var(--text-dim)",
      border: severityFilter === f ? "1px solid var(--accent)" : "1px solid var(--border2)"
    }}>{f}</button>
  ))}
</div>
<div className="feed">
  {alerts.length === 0 && (
    <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"var(--text-dim)", padding:"8px 0", letterSpacing:1 }}>WAITING FOR FLASK...</div>
  )}
  {alerts.filter(a => severityFilter === "all" || a.event_type === severityFilter).slice(0, 25).map((a, i) => (
    <div key={i} className={`feed-item ${a.event_type}`}>
      <span className={`feed-type ${a.event_type}`}>{a.event_type?.substring(0,4).toUpperCase()}</span>
      <span className="feed-ips">
  <span className="feed-src">{a.src_ip}</span>
  {reputations[a.src_ip] && (
    <span style={{
      marginLeft: 4, fontFamily:"var(--mono)", fontSize:7, padding:"1px 5px",
      borderRadius:2, fontWeight:700,
      background: reputations[a.src_ip].malicious ? "var(--red-dim)" : "var(--green-dim)",
      color: reputations[a.src_ip].malicious ? "var(--red)" : "var(--green)",
      border: reputations[a.src_ip].malicious ? "1px solid rgba(255,61,90,0.3)" : "1px solid rgba(0,255,157,0.3)"
    }}>
      {reputations[a.src_ip].malicious ? `⚠ ${reputations[a.src_ip].score}%` : "✓ CLEAN"}
    </span>
  )}
  → {a.dest_ip}
</span>
      <span className="feed-time">{a.timestamp?.substring(11,19)}</span>
    </div>
  ))}
</div>
          </div>
        </aside>

        <div className="chat-col">
          <div className="chat-header">
            <div className="agent-avatar">⬡</div>
            <div>
              <div className="agent-name">SIRA</div>
              <div className="agent-sub">
                <span className="sdot" />
                {loading ? `Analysing with ${loadingLabel[selectedModel]}...` : "Security Incident Response Assistant"}
              </div>
            </div>
            <div className="model-chip">{modelObj.chip}</div>
            <button className="clear-btn" onClick={() => { setMessages([]); showToast("Chat cleared"); }}>CLEAR</button>
          </div>

          <div className="messages" ref={messagesRef}>
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <div className="bubble-wrap">
                  {m.isWelcome ? (
                    <div className="bubble">
                      <div className="welcome-card">
                        <div className="welcome-title">Hello, I'm <span>SIRA</span></div>
                        <div className="welcome-body">Security Incident Response Assistant — online and ready.<br />I have loaded your Suricata and Zeek logs. Ask me anything about your network activity.</div>
                        <div className="welcome-tags">
                          <span className="wtag">{alerts.length || "?"} EVENTS LOADED</span>
                          <span className="wtag">{alertCount} ALERTS DETECTED</span>
                          <span className="wtag">RAG ACTIVE</span>
                          <span className="wtag">CHROMADB READY</span>
                        </div>
                      </div>
                    </div>
                  ) : m.role === "ai" ? (
                    <SiraMessage text={m.text} />
                  ) : (
                    <div className="bubble">{m.text}</div>
                  )}
                <div className="msg-meta">
                  <span>{m.time}</span>
                  {m.role === "ai" && !m.isWelcome && (
                  <>
                   <span style={{ color: "var(--accent)", letterSpacing: 1 }}>⬡ {m.model}</span>
                   <button className="copy-btn" onClick={() => { navigator.clipboard.writeText(m.text); showToast("Copied"); }}>⊕ COPY</button>
                  </>
                )}
               </div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="msg ai">
                <div className="typing-wrap">
                  <span className="typing-label">ANALYSING</span>
                  <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                </div>
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
              <button className="send-btn" onClick={() => sendMessage()} disabled={loading}>SEND ▶</button>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}