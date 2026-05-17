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

const MAX_CHARS = 500;

function parseSiraResponse(text) {
  const sections = ["SUMMARY", "THREAT DETAILS", "WHAT THIS MEANS", "RISK ASSESSMENT", "RECOMMENDED ACTIONS"];
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
  if (/CRITICAL/i.test(text)) return "critical";
  if (/HIGH/i.test(text)) return "high";
  if (/MEDIUM/i.test(text)) return "medium";
  if (/LOW/i.test(text)) return "low";
  return null;
}

const darkCss = `
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
    --purple: #b47cff; --purple-dim: rgba(180,124,255,0.08);
    --text: #e8f0fe; --text-mid: #7a8fa6; --text-dim: #3d4f63;
    --mono: 'Space Mono', monospace; --sans: 'Syne', sans-serif;
    --scroll-btn-bg: rgba(0,229,255,0.15);
    --scroll-btn-border: rgba(0,229,255,0.4);
    --scroll-btn-color: #00e5ff;
    --char-ok: #7a8fa6; --char-warn: #ffaa00; --char-over: #ff3d5a;
  }
`;

const lightCss = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #f0f4fa; --bg2: #ffffff; --bg3: #f5f7fc; --panel: #ffffff;
    --border: rgba(0,0,0,0.08); --border2: rgba(0,0,0,0.13);
    --accent: #2563eb; --accent2: #1d4ed8;
    --accent-glow: rgba(37,99,235,0.12); --accent-dim: rgba(37,99,235,0.06);
    --green: #059669; --green-dim: rgba(5,150,105,0.08);
    --red: #dc2626; --red-dim: rgba(220,38,38,0.08);
    --orange: #d97706; --orange-dim: rgba(217,119,6,0.08);
    --purple: #7c3aed; --purple-dim: rgba(124,58,237,0.08);
    --text: #0f172a; --text-mid: #475569; --text-dim: #94a3b8;
    --mono: 'Space Mono', monospace; --sans: 'Syne', sans-serif;
    --scroll-btn-bg: rgba(37,99,235,0.1);
    --scroll-btn-border: rgba(37,99,235,0.35);
    --scroll-btn-color: #2563eb;
    --char-ok: #64748b; --char-warn: #d97706; --char-over: #dc2626;
  }
`;

const sharedCss = `
  html, body, #root { height: 100%; }
  body { font-family: var(--sans); background: var(--bg); color: var(--text); overflow: hidden; }
  ::-webkit-scrollbar { width: 2px; }
  ::-webkit-scrollbar-thumb { background: var(--border2); }

  .app { position: relative; z-index: 1; display: grid; grid-template-rows: 52px 1fr; grid-template-columns: var(--sidebar-width, 320px) 1fr; height: 100vh; width: 100vw; }

  /* ── TOPNAV ── */
  .topnav { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; background: var(--panel); border-bottom: 1px solid var(--border); position: relative; z-index: 10; }
  .topnav::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--accent), transparent); opacity: 0.4; }
  .nav-brand { display: flex; align-items: center; gap: 10px; }
  .brand-icon { width: 32px; height: 32px; background: linear-gradient(135deg, var(--accent), var(--purple)); clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); display: flex; align-items: center; justify-content: center; font-size: 14px; box-shadow: 0 0 20px var(--accent-glow); animation: pulse-icon 3s ease-in-out infinite; }
  @keyframes pulse-icon { 0%,100%{box-shadow:0 0 20px var(--accent-glow)} 50%{box-shadow:0 0 35px var(--accent-glow)} }
  .brand-name { font-size: 15px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: var(--text); }
  .brand-sub { font-family: var(--mono); font-size: 8px; color: var(--accent); letter-spacing: 3px; text-transform: uppercase; margin-top: 1px; }
  .nav-right { display: flex; align-items: center; gap: 8px; }
  .nav-status { display: flex; align-items: center; gap: 8px; }
  .status-pill { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 3px; border: 1px solid var(--border2); background: var(--bg3); font-family: var(--mono); font-size: 9px; color: var(--text-mid); letter-spacing: 1px; }
  .ndot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
  .ndot-green { background: var(--green); box-shadow: 0 0 6px var(--green); animation: blink 2s infinite; }
  .ndot-red   { background: var(--red);   box-shadow: 0 0 6px var(--red); }
  .ndot-cyan  { background: var(--accent);box-shadow: 0 0 6px var(--accent); }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .nav-time { font-family: var(--mono); font-size: 11px; color: var(--accent); letter-spacing: 2px; }

  /* ── THEME TOGGLE ── */
  .theme-toggle { display: flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 20px; border: 1px solid var(--border2); background: var(--bg3); font-family: var(--mono); font-size: 9px; color: var(--text-mid); cursor: pointer; transition: all 0.2s; letter-spacing: 1px; text-transform: uppercase; }
  .theme-toggle:hover { border-color: var(--accent); color: var(--accent); }
  .toggle-track { width: 28px; height: 14px; border-radius: 7px; background: var(--border2); position: relative; transition: background 0.2s; flex-shrink: 0; }
  .toggle-track.on { background: var(--accent); }
  .toggle-thumb { position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: white; transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
  .toggle-thumb.on { transform: translateX(14px); }

  /* ── LEFT PANEL ── */
  .left-panel { background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
  .section-label { font-family: var(--mono); font-size: 8px; font-weight: 700; color: var(--accent); letter-spacing: 3px; text-transform: uppercase; display: flex; align-items: center; gap: 8px; padding: 14px 16px 0; }
  .section-label::after { content: ''; flex: 1; height: 1px; background: var(--border2); }
  .model-select-wrap { padding: 10px 16px 0; }
  .model-select { width: 100%; appearance: none; background: var(--bg3); border: 1px solid var(--border2); border-radius: 4px; padding: 10px 14px; font-family: var(--mono); font-size: 11px; color: var(--text); cursor: pointer; outline: none; transition: all 0.2s; }
  .model-select:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-glow); }
  .model-select option { background: var(--bg3); color: var(--text); }
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
  .stat-value.r { color: var(--red); }
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

  /* ── CHAT ── */
  .chat-col { display: flex; flex-direction: column; overflow: hidden; background: var(--bg); }
  .chat-header { display: flex; align-items: center; gap: 12px; padding: 0 20px; height: 52px; flex-shrink: 0; background: var(--panel); border-bottom: 1px solid var(--border); }
  .agent-avatar { width: 36px; height: 36px; flex-shrink: 0; background: linear-gradient(135deg, var(--accent), var(--purple)); clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 0 15px var(--accent-glow); }
  .agent-name { font-size: 14px; font-weight: 800; letter-spacing: 1px; color: var(--text); }
  .agent-sub { font-family: var(--mono); font-size: 9px; color: var(--text-mid); }
  .sdot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--green); box-shadow: 0 0 6px var(--green); margin-right: 5px; animation: blink 2s infinite; }
  .model-chip { margin-left: auto; font-family: var(--mono); font-size: 8px; letter-spacing: 1px; padding: 4px 10px; border-radius: 2px; background: var(--accent-dim); color: var(--accent); border: 1px solid rgba(0,229,255,0.2); }
  .clear-btn { background: transparent; border: 1px solid var(--border2); color: var(--text-dim); padding: 5px 12px; border-radius: 3px; font-family: var(--mono); font-size: 9px; letter-spacing: 1px; cursor: pointer; transition: all 0.15s; text-transform: uppercase; }
  .clear-btn:hover { border-color: var(--red); color: var(--red); }

  /* ── MESSAGES ── */
  .messages-wrap { flex: 1; position: relative; overflow: hidden; }
  .messages { height: 100%; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
  .msg { display: flex; }
  .msg.user { justify-content: flex-end; }
  .bubble-wrap { display: flex; flex-direction: column; max-width: 80%; }
  .msg.user .bubble-wrap { align-items: flex-end; }

  .bubble { padding: 12px 16px; font-size: 13px; line-height: 1.7; border-radius: 2px; }
  .msg.user .bubble { background: var(--accent-dim); border: 1px solid var(--accent-glow); color: var(--text); }
  .msg.ai .bubble { background: transparent; border: none; padding: 0; width: 100%; }

  /* ── SIRA RESPONSE CARDS ── */
  .sira-card {
    margin-bottom: 10px;
    background: var(--bg3);
    border: 1px solid var(--border2);
    border-radius: 6px;
    padding: 16px 18px;
    position: relative;
    overflow: hidden;
    animation: cardIn 0.3s ease both;
  }
  .sira-card:last-child { margin-bottom: 0; }
  @keyframes cardIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

  .sira-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; }
  .sira-card.summary::before  { background: linear-gradient(90deg, transparent, var(--accent), transparent); }
  .sira-card.threat::before   { background: linear-gradient(90deg, transparent, var(--red), transparent); }
  .sira-card.means::before    { background: linear-gradient(90deg, transparent, var(--purple), transparent); }
  .sira-card.risk::before     { background: linear-gradient(90deg, transparent, var(--orange), transparent); }
  .sira-card.actions::before  { background: linear-gradient(90deg, transparent, var(--green), transparent); }

  .sira-card.summary { border-left: 2px solid var(--accent); }
  .sira-card.threat  { border-left: 2px solid var(--red); }
  .sira-card.means   { border-left: 2px solid var(--purple); }
  .sira-card.risk    { border-left: 2px solid var(--orange); }
  .sira-card.actions { border-left: 2px solid var(--green); }

  .sira-heading { font-family: var(--mono); font-size: 10px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
  .sira-heading.summary { color: var(--accent); }
  .sira-heading.threat  { color: var(--red); }
  .sira-heading.means   { color: var(--purple); }
  .sira-heading.risk    { color: var(--orange); }
  .sira-heading.actions { color: var(--green); }

  .sira-body { display: flex; flex-direction: column; gap: 6px; }

  .sira-line { display: flex; align-items: flex-start; gap: 8px; }

  .sira-bullet { font-family: var(--mono); font-size: 10px; flex-shrink: 0; margin-top: 3px; line-height: 1.6; }
  .sira-card.summary .sira-bullet { color: var(--accent); }
  .sira-card.threat  .sira-bullet { color: var(--red); }
  .sira-card.means   .sira-bullet { color: var(--purple); }
  .sira-card.risk    .sira-bullet { color: var(--orange); }
  .sira-card.actions .sira-bullet { color: var(--green); }

  .sira-line-text { font-family: var(--sans); font-size: 16px; line-height: 1.8; color: var(--text); }
  .sira-key { font-family: var(--mono); font-size: 14px; color: var(--text-mid); margin-right: 6px; }
  .sira-val { font-family: var(--mono); font-size: 15px; color: var(--text); font-weight: 700; }

  .risk-badge { display: inline-block; font-family: var(--mono); font-size: 9px; padding: 3px 10px; border-radius: 3px; font-weight: 700; letter-spacing: 2px; margin-left: 10px; }
  .risk-critical { background: rgba(255,61,90,0.2);  color: var(--red);    border: 1px solid rgba(255,61,90,0.5);   box-shadow: 0 0 10px rgba(255,61,90,0.3); }
  .risk-high     { background: rgba(255,61,90,0.12); color: var(--red);    border: 1px solid rgba(255,61,90,0.3); }
  .risk-medium   { background: var(--orange-dim);    color: var(--orange); border: 1px solid rgba(255,170,0,0.3); }
  .risk-low      { background: var(--green-dim);     color: var(--green);  border: 1px solid rgba(0,255,157,0.3); }

  .msg-meta { font-family: var(--mono); font-size: 10px; color: var(--text-med); margin-top: 8px; display: flex; align-items: center; gap: 10px; }
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

  .scroll-btn { position: absolute; bottom: 16px; right: 16px; width: 38px; height: 38px; border-radius: 50%; background: var(--scroll-btn-bg); border: 1px solid var(--scroll-btn-border); color: var(--scroll-btn-color); font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(0,0,0,0.2); transition: all 0.2s; z-index: 20; backdrop-filter: blur(4px); }
  .scroll-btn:hover { transform: translateY(-2px); }
  .scroll-btn.hidden { opacity: 0; pointer-events: none; transform: translateY(8px); }
  .scroll-btn.visible { opacity: 1; pointer-events: all; transform: translateY(0); }
  .unread-badge { position: absolute; top: -4px; right: -4px; width: 16px; height: 16px; border-radius: 50%; background: var(--red); color: white; font-family: var(--mono); font-size: 8px; font-weight: 700; display: flex; align-items: center; justify-content: center; }

  .input-area { padding: 12px 20px 16px; background: var(--panel); border-top: 1px solid var(--border); }
  .quick-btns { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
  .qbtn { font-family: var(--mono); font-size: 9px; letter-spacing: 1px; text-transform: uppercase; padding: 5px 12px; border-radius: 2px; border: 1px solid var(--border2); background: var(--bg3); color: var(--text-mid); cursor: pointer; transition: all 0.15s; }
  .qbtn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
  .input-row { display: flex; gap: 8px; }
  .chat-input { flex: 1; background: var(--bg3); border: 1px solid var(--border2); border-radius: 3px; padding: 11px 16px; color: var(--text); font-family: var(--mono); font-size: 12px; outline: none; transition: all 0.2s; }
  .chat-input::placeholder { color: var(--text-dim); }
  .chat-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-glow); }
  .send-btn { padding: 11px 24px; background: linear-gradient(135deg, var(--accent), var(--accent2)); border: none; border-radius: 3px; cursor: pointer; color: var(--bg); font-family: var(--mono); font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; transition: all 0.15s; }
  .send-btn:hover { opacity: 0.9; transform: translateY(-1px); }
  .send-btn:disabled { opacity: 0.3; cursor: not-allowed; transform: none; }
  .input-meta { display: flex; justify-content: flex-end; margin-top: 6px; }
  .char-counter { font-family: var(--mono); font-size: 9px; letter-spacing: 1px; transition: color 0.2s; }
  .char-counter.ok   { color: var(--char-ok); }
  .char-counter.warn { color: var(--char-warn); }
  .char-counter.over { color: var(--char-over); font-weight: 700; }

  .toast { position: fixed; bottom: 80px; right: 20px; background: var(--panel); border: 1px solid var(--accent); color: var(--accent); font-family: var(--mono); font-size: 10px; padding: 8px 16px; border-radius: 3px; letter-spacing: 1px; z-index: 9999; box-shadow: 0 0 16px var(--accent-glow); animation: fadeIn 0.2s ease; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }

  .welcome-card { background: var(--panel); border: 1px solid var(--border2); border-left: 2px solid var(--accent); border-radius: 2px; padding: 18px; }
  .welcome-title { font-size: 17px; font-weight: 800; letter-spacing: 1px; margin-bottom: 6px; color: var(--text); }
  .welcome-title span { color: var(--accent); }
  .welcome-body { font-family: var(--mono); font-size: 11px; color: var(--text-mid); line-height: 1.8; }
  .welcome-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
  .wtag { font-family: var(--mono); font-size: 8px; letter-spacing: 1px; padding: 3px 8px; border-radius: 2px; border: 1px solid var(--border2); color: var(--text-dim); }

/* ── PAGES ── */
  .page { flex: 1; overflow-y: auto; padding: 24px; background: var(--bg); }
  .page-title { font-size: 20px; font-weight: 800; letter-spacing: 2px; color: var(--text); margin-bottom: 4px; }
  .page-sub { font-family: var(--mono); font-size: 10px; color: var(--text-mid); letter-spacing: 2px; margin-bottom: 24px; }
  .page-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .page-card { background: var(--panel); border: 1px solid var(--border2); border-radius: 6px; padding: 20px; }
  .page-card-title { font-family: var(--mono); font-size: 9px; font-weight: 700; color: var(--accent); letter-spacing: 3px; text-transform: uppercase; margin-bottom: 16px; }
  .inv-search { width: 100%; background: var(--bg3); border: 1px solid var(--border2); border-radius: 4px; padding: 10px 16px; color: var(--text); font-family: var(--mono); font-size: 12px; outline: none; margin-bottom: 16px; }
  .inv-search:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-glow); }
  .inv-table { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 11px; }
  .inv-table th { text-align: left; padding: 8px 12px; color: var(--text-dim); font-size: 9px; letter-spacing: 2px; border-bottom: 1px solid var(--border2); }
  .inv-table td { padding: 8px 12px; border-bottom: 1px solid var(--border); color: var(--text-mid); }
  .inv-table tr:hover td { background: var(--bg3); color: var(--text); cursor: pointer; }
  .inv-type-badge { display: inline-block; padding: 2px 6px; border-radius: 2px; font-size: 8px; font-weight: 700; text-transform: uppercase; }
  .inv-type-alert { background: var(--red-dim); color: var(--red); }
  .inv-type-dns   { background: var(--accent-dim); color: var(--accent); }
  .inv-type-http  { background: var(--green-dim); color: var(--green); }
  .inv-type-tls   { background: var(--purple-dim); color: var(--purple); }
  .inv-type-flow  { background: var(--bg3); color: var(--text-dim); }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100; display: flex; align-items: center; justify-content: center; }
  .modal { background: var(--panel); border: 1px solid var(--border2); border-radius: 8px; padding: 24px; width: 600px; max-width: 90vw; max-height: 80vh; overflow-y: auto; position: relative; }
  .modal-close { position: absolute; top: 16px; right: 16px; background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 18px; }
  .modal-close:hover { color: var(--red); }
  .modal-title { font-size: 14px; font-weight: 800; color: var(--text); margin-bottom: 4px; }
  .modal-sub { font-family: var(--mono); font-size: 9px; color: var(--text-mid); margin-bottom: 20px; }
  .modal-row { display: flex; gap: 8px; margin-bottom: 10px; align-items: flex-start; }
  .modal-key { font-family: var(--mono); font-size: 10px; color: var(--text-dim); min-width: 120px; }
  .modal-val { font-family: var(--mono); font-size: 11px; color: var(--text); font-weight: 700; }
  .ask-sira-btn { margin-top: 16px; width: 100%; padding: 10px; background: linear-gradient(135deg, var(--accent), var(--accent2)); border: none; border-radius: 4px; color: var(--bg); font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: 2px; cursor: pointer; text-transform: uppercase; }
  .ask-sira-btn:hover { opacity: 0.9; }
  .top-ip-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .top-ip-addr { font-family: var(--mono); font-size: 11px; color: var(--accent); min-width: 140px; }
  .top-ip-bar { flex: 1; height: 6px; background: var(--bg3); border-radius: 3px; overflow: hidden; }
  .top-ip-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--purple)); border-radius: 3px; }
  .top-ip-count { font-family: var(--mono); font-size: 10px; color: var(--text-dim); min-width: 30px; text-align: right; }


  @media (max-width: 768px) {
    body { overflow: auto; }
    .app { display: flex; flex-direction: column; height: auto; min-height: 100vh; }
    .topnav { flex-wrap: wrap; gap: 6px; padding: 8px 14px; height: auto; }
    .nav-right { flex-wrap: wrap; }
    .left-panel { border-right: none; border-bottom: 1px solid var(--border); }
    .feed { max-height: 160px; }
    .messages { padding: 14px 16px; }
    .bubble-wrap { max-width: 95%; }
  }
`;

// ── Line renderer ─────────────────────────────────────────────────────────
function renderLine(line, idx) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // numbered: "1. Action — reason"
  const numMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
  if (numMatch) {
    const [, num, rest] = numMatch;
    const parts = rest.split(" — ");
    return (
      <div key={idx} className="sira-line">
        <span className="sira-bullet">▸ {num}.</span>
        <span className="sira-line-text">
          <strong>{parts[0]}</strong>
          {parts.length > 1 && <span style={{ color: "var(--text-mid)", fontStyle: "italic" }}> — {parts.slice(1).join(" — ")}</span>}
        </span>
      </div>
    );
  }

  // key-value: "- Alert: value"
  const kvMatch = trimmed.match(/^[-•]\s*([^:]+):\s*(.+)/);
  if (kvMatch) {
    return (
      <div key={idx} className="sira-line">
        <span className="sira-bullet">▸</span>
        <span className="sira-line-text">
          <span className="sira-key">{kvMatch[1]}:</span>
          <span className="sira-val">{kvMatch[2]}</span>
        </span>
      </div>
    );
  }

  // plain bullet
  if (trimmed.startsWith("-") || trimmed.startsWith("•")) {
    return (
      <div key={idx} className="sira-line">
        <span className="sira-bullet">▸</span>
        <span className="sira-line-text">{trimmed.replace(/^[-•]\s*/, "")}</span>
      </div>
    );
  }

  // plain text
  return (
    <div key={idx} className="sira-line">
      <span className="sira-line-text">{trimmed}</span>
    </div>
  );
}

// ── SIRA Message ──────────────────────────────────────────────────────────
function SiraMessage({ text }) {
  const sections = parseSiraResponse(text);

  const cardClass = {
    "SUMMARY": "summary",
    "THREAT DETAILS": "threat",
    "WHAT THIS MEANS": "means",
    "RISK ASSESSMENT": "risk",
    "RECOMMENDED ACTIONS": "actions"
  };

  const icons = {
    "SUMMARY": "◉",
    "THREAT DETAILS": "⚠",
    "WHAT THIS MEANS": "◈",
    "RISK ASSESSMENT": "◆",
    "RECOMMENDED ACTIONS": "▶"
  };

  if (!sections) {
    return (
      <div className="sira-card summary">
        <div className="sira-body">
          {text.split("\n").map((line, i) => renderLine(line, i))}
        </div>
      </div>
    );
  }

  return (
    <>
      {sections.map((s, i) => {
        const cls = cardClass[s.heading] || "summary";
        const riskLevel = s.heading === "RISK ASSESSMENT" ? getRiskLevel(s.content) : null;
        const lines = s.content.split("\n");

        return (
          <div key={i} className={`sira-card ${cls}`} style={{ animationDelay: `${i * 0.07}s` }}>
            <div className={`sira-heading ${cls}`}>
              <span>{icons[s.heading] || "▸"}</span>
              {s.heading}
              {riskLevel && <span className={`risk-badge risk-${riskLevel}`}>{riskLevel.toUpperCase()}</span>}
            </div>
            <div className="sira-body">
              {lines.map((line, idx) => renderLine(line, idx))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function AnalyticsPage({ stats }) {
  const [topIPs, setTopIPs] = useState([]);
  const [timeline, setTimeline] = useState([]);

  useEffect(() => {
    fetch(`${FLASK_URL}/top-ips?limit=10`).then(r => r.json()).then(setTopIPs).catch(() => {});
    fetch(`${FLASK_URL}/timeline`).then(r => r.json()).then(setTimeline).catch(() => {});
  }, []);

  const maxCount = topIPs.length > 0 ? topIPs[0].count : 1;
  const maxHour  = timeline.length > 0 ? Math.max(...timeline.map(t => t.count)) : 1;

  const breakdown = stats?.event_breakdown || {};
  const breakdownTotal = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const breakdownColors = { alert: "var(--red)", dns: "var(--accent)", http: "var(--green)", tls: "var(--purple)", flow: "var(--text-dim)" };

  return (
    <div className="page">
      <div className="page-title">Analytics</div>
      <div className="page-sub">REAL-TIME EVENT ANALYSIS FROM YOUR LOGS</div>

      <div className="page-grid">
        {/* Events per hour bar chart */}
        <div className="page-card" style={{ gridColumn: "1 / -1" }}>
          <div className="page-card-title">Events Per Hour</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
            {timeline.map((t, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: "100%", height: `${(t.count / maxHour) * 100}px`, background: "linear-gradient(180deg, var(--accent), var(--accent2))", borderRadius: "2px 2px 0 0", minHeight: 2 }} />
                <span style={{ fontFamily: "var(--mono)", fontSize: 7, color: "var(--text-dim)" }}>{t.hour}h</span>
              </div>
            ))}
            {timeline.length === 0 && <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-dim)" }}>Loading...</div>}
          </div>
        </div>

        {/* Event breakdown */}
        <div className="page-card">
          <div className="page-card-title">Event Type Breakdown</div>
          {Object.entries(breakdown).map(([type, count]) => (
            <div key={type} className="top-ip-row">
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: breakdownColors[type] || "var(--text)", minWidth: 60, textTransform: "uppercase" }}>{type}</span>
              <div className="top-ip-bar"><div className="top-ip-fill" style={{ width: `${(count / breakdownTotal) * 100}%`, background: breakdownColors[type] || "var(--accent)" }} /></div>
              <span className="top-ip-count">{count}</span>
            </div>
          ))}
        </div>

        {/* Top IPs */}
        <div className="page-card">
          <div className="page-card-title">Top 10 Attacker IPs</div>
          {topIPs.map((item, i) => (
            <div key={i} className="top-ip-row">
              <span className="top-ip-addr">{item.ip}</span>
              <div className="top-ip-bar"><div className="top-ip-fill" style={{ width: `${(item.count / maxCount) * 100}%` }} /></div>
              <span className="top-ip-count">{item.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InvestigationPage({ onAskSira }) {
  const [logs, setLogs]           = useState([]);
  const [search, setSearch]       = useState("");
  const [selected, setSelected]   = useState(null);

  useEffect(() => {
    fetch(`${FLASK_URL}/logs?limit=200`).then(r => r.json()).then(setLogs).catch(() => {});
  }, []);

  const filtered = logs.filter(l =>
    !search ||
    l.src_ip?.includes(search) ||
    l.dest_ip?.includes(search) ||
    l.alert?.signature?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page">
      <div className="page-title">Investigation</div>
      <div className="page-sub">SEARCH AND ANALYSE LOG EVENTS</div>

      <input
        className="inv-search"
        placeholder="Search by IP address or alert signature..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      <div className="page-card">
        <table className="inv-table">
          <thead>
            <tr>
              <th>TYPE</th>
              <th>TIME</th>
              <th>SOURCE IP</th>
              <th>DEST IP</th>
              <th>DETAILS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 100).map((l, i) => (
              <tr key={i} onClick={() => setSelected(l)}>
                <td><span className={`inv-type-badge inv-type-${l.event_type}`}>{l.event_type}</span></td>
                <td>{l.timestamp?.substring(11, 19)}</td>
                <td style={{ color: "var(--accent)" }}>{l.src_ip}</td>
                <td>{l.dest_ip}</td>
                <td style={{ color: "var(--text-dim)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.alert?.signature || l.dns?.rrname || l.http?.hostname || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)}>✕</button>
            <div className="modal-title">Event Details</div>
            <div className="modal-sub">{selected.timestamp}</div>
            <div className="modal-row"><span className="modal-key">Type</span><span className="modal-val">{selected.event_type?.toUpperCase()}</span></div>
            <div className="modal-row"><span className="modal-key">Source IP</span><span className="modal-val" style={{ color: "var(--accent)" }}>{selected.src_ip}:{selected.src_port}</span></div>
            <div className="modal-row"><span className="modal-key">Destination IP</span><span className="modal-val">{selected.dest_ip}:{selected.dest_port}</span></div>
            <div className="modal-row"><span className="modal-key">Protocol</span><span className="modal-val">{selected.proto}</span></div>
            {selected.alert && <>
              <div className="modal-row"><span className="modal-key">Alert</span><span className="modal-val" style={{ color: "var(--red)" }}>{selected.alert.signature}</span></div>
              <div className="modal-row"><span className="modal-key">Category</span><span className="modal-val">{selected.alert.category}</span></div>
              <div className="modal-row"><span className="modal-key">Severity</span><span className="modal-val">{selected.alert.severity}</span></div>
            </>}
            {selected.dns && <div className="modal-row"><span className="modal-key">DNS Query</span><span className="modal-val">{selected.dns.rrname}</span></div>}
            {selected.http && <div className="modal-row"><span className="modal-key">HTTP</span><span className="modal-val">{selected.http.http_method} {selected.http.hostname}{selected.http.url}</span></div>}
            <button className="ask-sira-btn" onClick={() => {
              onAskSira(`Analyse this ${selected.event_type} event from ${selected.src_ip} to ${selected.dest_ip} at ${selected.timestamp}`);
              setSelected(null);
            }}>⬡ ASK SIRA ABOUT THIS EVENT</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────
export default function App() {
  const [selectedModel, setSelectedModel]   = useState("ollama");
  const [messages, setMessages]             = useState([{ role: "ai", text: null, time: new Date().toLocaleTimeString(), isWelcome: true }]);
  const [input, setInput]                   = useState("");
  const [loading, setLoading]               = useState(false);
  const [alerts, setAlerts]                 = useState([]);
  const [time, setTime]                     = useState(new Date().toLocaleTimeString());
  const [toast, setToast]                   = useState(null);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [reputations, setReputations]       = useState({});
  const [isDark, setIsDark]                 = useState(true);
  const [showScrollBtn, setShowScrollBtn]   = useState(false);
  const [unreadCount, setUnreadCount]       = useState(0);
  const [sidebarWidth, setSidebarWidth]     = useState(320);
  const [stats, setStats]                   = useState(null);
  const [health, setHealth] = useState(null);
  const [page, setPage] = useState("dashboard");

  const messagesRef = useRef(null);
  const toastTimer  = useRef(null);
  const isResizing  = useRef(false);
  const isAtBottom  = useRef(true);

  const modelObj  = MODEL_OPTIONS.find(m => m.value === selectedModel);
  const charCount = input.length;
  const charClass = charCount === 0 ? "ok" : charCount > MAX_CHARS ? "over" : charCount > MAX_CHARS * 0.8 ? "warn" : "ok";

  const startResize = (e) => {
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (e) => { if (!isResizing.current) return; setSidebarWidth(Math.min(500, Math.max(220, startWidth + e.clientX - startX))); };
    const onUp = () => { isResizing.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesRef.current) {
      messagesRef.current.scrollTo({ top: messagesRef.current.scrollHeight, behavior: smooth ? "smooth" : "auto" });
      setUnreadCount(0);
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (!messagesRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 60;
    isAtBottom.current = atBottom;
    setShowScrollBtn(!atBottom);
    if (atBottom) setUnreadCount(0);
  }, []);

  useEffect(() => { const t = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const fetchLogs = () => fetch(`${FLASK_URL}/logs`).then(r => r.json()).then(data => { if (Array.isArray(data) && data.length > 0) setAlerts(data); }).catch(() => {});
    fetchLogs();
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetch(`${FLASK_URL}/stats`).then(r => r.json()).then(data => setStats(data)).catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${FLASK_URL}/health`).then(r => r.json()).then(data => setHealth(data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (isAtBottom.current) scrollToBottom(false);
    else setUnreadCount(prev => prev + 1);
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
      const res  = await fetch(`${FLASK_URL}/reputation/${ip}`);
      const data = await res.json();
      setReputations(prev => ({ ...prev, [ip]: data }));
    } catch {}
  };

  const sendMessage = async (text) => {
    const q = (text || input).trim();
    if (!q || loading || charCount > MAX_CHARS) return;
    setInput("");
    const now = new Date().toLocaleTimeString();
    setMessages(prev => [...prev, { role: "user", text: q, time: now }]);
    setLoading(true);
    try {
      const res  = await fetch(`${FLASK_URL}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, model: selectedModel }) });
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
      <style>{isDark ? darkCss : lightCss}{sharedCss}</style>
      {toast && <div className="toast">✓ {toast.toUpperCase()}</div>}

      <div className="app" style={{ gridTemplateColumns: `${sidebarWidth}px 1fr` }}>

        {/* ── TOP NAV ── */}
        <nav className="topnav">
          <div className="nav-brand">
            <div className="brand-icon">⬡</div>
            <div>
              <div className="brand-name">SOC Copilot</div>
              <div className="brand-sub">SIRA v3 — Threat Intelligence</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 4 }}>
  {["dashboard", "analytics", "investigation"].map(p => (
    <button key={p} onClick={() => setPage(p)} style={{
      fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
      padding: "5px 14px", borderRadius: 2, cursor: "pointer", transition: "all 0.15s",
      background: page === p ? "var(--accent)" : "transparent",
      color: page === p ? "var(--bg)" : "var(--text-dim)",
      border: page === p ? "1px solid var(--accent)" : "1px solid var(--border2)"
    }}>{p}</button>
  ))}
</div>

          <div className="nav-right">
            <div className="nav-status">
             <div className="status-pill"><div className={`ndot ${health?.status === "ok" ? "ndot-green" : "ndot-red"}`} />SURICATA</div>
<div className="status-pill"><div className={`ndot ${health?.status === "ok" ? "ndot-green" : "ndot-red"}`} />ZEEK</div>
<div className="status-pill"><div className="ndot ndot-red" />{stats?.alert_count ?? alertCount} ALERTS</div>
<div className="status-pill"><div className={`ndot ${health?.ollama === "ok" ? "ndot-cyan" : "ndot-red"}`} />AI {health?.ollama === "ok" ? "READY" : "OFFLINE"}</div>
              <div className="nav-time">{time}</div>
            </div>
            <button className="theme-toggle" onClick={() => { setIsDark(d => !d); showToast(isDark ? "Light theme" : "Dark theme"); }}>
              {isDark ? "☀" : "☾"}
              <div className={`toggle-track ${isDark ? "" : "on"}`}><div className={`toggle-thumb ${isDark ? "" : "on"}`} /></div>
              {isDark ? "LIGHT" : "DARK"}
            </button>
          </div>
        </nav>

        {/* ── LEFT PANEL ── */}
        <aside className="left-panel" style={{ position: "relative" }}>
          <div onMouseDown={startResize}
            style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 4, cursor: "col-resize", zIndex: 10, background: "transparent", transition: "background 0.15s" }}
            onMouseEnter={e => e.target.style.background = "var(--accent)"}
            onMouseLeave={e => e.target.style.background = "transparent"} />

          <div className="section-label">AI Engine</div>
          <div className="model-select-wrap">
            <select className="model-select" value={selectedModel} onChange={handleModelChange}>
              {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className={`model-badge ${modelObj.cloud ? "badge-cloud" : "badge-local"}`}>⬡ {modelObj.tag}</div>

          <div className="panel-divider" />

          <div className="section-label">Overview</div>
          <div className="stats-grid" style={{ marginTop: 10 }}>
           <div className="stat"><div className="stat-glow c" /><div className="stat-label">Total Events</div><div className="stat-value c">{stats?.total_events || alerts.length || "--"}</div></div>
<div className="stat"><div className="stat-glow r" /><div className="stat-label">Alerts</div><div className="stat-value r">{String(stats?.alert_count ?? alertCount).padStart(2, "0")}</div></div>
<div className="stat"><div className="stat-glow o" /><div className="stat-label">Unique IPs</div><div className="stat-value o">{stats?.unique_ips || uniqueIPs || "--"}</div></div>
<div className="stat"><div className="stat-glow g" /><div className="stat-label">Status</div><div className="stat-value g">ONLINE</div></div>
          </div>

          <div className="panel-divider" />

          <div className="feed-wrap">
            <div className="section-label">Live Feed</div>
            <div style={{ display: "flex", gap: 4, padding: "8px 16px 6px", flexWrap: "wrap" }}>
              {["all", "alert", "dns", "http", "tls", "flow"].map(f => (
                <button key={f} onClick={() => setSeverityFilter(f)} style={{
                  fontFamily: "var(--mono)", fontSize: 8, letterSpacing: 1, textTransform: "uppercase",
                  padding: "3px 8px", borderRadius: 2, cursor: "pointer", transition: "all 0.15s",
                  background: severityFilter === f ? "var(--accent)" : "var(--bg3)",
                  color: severityFilter === f ? "var(--bg)" : "var(--text-dim)",
                  border: severityFilter === f ? "1px solid var(--accent)" : "1px solid var(--border2)"
                }}>{f}</button>
              ))}
            </div>
            <div className="feed">
              {alerts.length === 0 && (
                <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-dim)", padding: "8px 0", letterSpacing: 1 }}>WAITING FOR FLASK...</div>
              )}
              {alerts.filter(a => severityFilter === "all" || a.event_type === severityFilter).slice(0, 25).map((a, i) => (
                <div key={i} className={`feed-item ${a.event_type}`}>
                  <span className={`feed-type ${a.event_type}`}>{a.event_type?.substring(0, 4).toUpperCase()}</span>
                  <span className="feed-ips">
                    <span className="feed-src">{a.src_ip}</span>
                    {reputations[a.src_ip] && (
                      <span style={{
                        marginLeft: 4, fontFamily: "var(--mono)", fontSize: 7, padding: "1px 5px", borderRadius: 2, fontWeight: 700,
                        background: reputations[a.src_ip].malicious ? "var(--red-dim)" : "var(--green-dim)",
                        color: reputations[a.src_ip].malicious ? "var(--red)" : "var(--green)",
                        border: reputations[a.src_ip].malicious ? "1px solid rgba(255,61,90,0.3)" : "1px solid rgba(0,255,157,0.3)"
                      }}>
                        {reputations[a.src_ip].malicious ? `⚠ ${reputations[a.src_ip].score}%` : "✓ CLEAN"}
                      </span>
                    )}
                    → {a.dest_ip}
                  </span>
                  <span className="feed-time">{a.timestamp?.substring(11, 19)}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ── MAIN CONTENT ── */}
        {page === "analytics" ? (
       <AnalyticsPage stats={stats} />
     ) : page === "investigation" ? (
       <InvestigationPage onAskSira={(q) => { setPage("dashboard"); setTimeout(() => sendMessage(q), 300); }} />
     ) : (
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

          <div className="messages-wrap">
            <div className="messages" ref={messagesRef} onScroll={handleScroll}>
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div className="bubble-wrap">
                    {m.isWelcome ? (
                      <div className="bubble">
                        <div className="welcome-card">
                          <div className="welcome-title">Hello, I'm <span>SIRA</span></div>
                          <div className="welcome-body">Security Incident Response Assistant — online and ready.<br />I have loaded your Suricata and Zeek logs.</div>
                          <div className="welcome-tags">
                            <span className="wtag">{alerts.length || "?"} EVENTS LOADED</span>
                            <span className="wtag">{alertCount} ALERTS DETECTED</span>
                            <span className="wtag">RAG ACTIVE</span>
                            <span className="wtag">CHROMADB READY</span>
                          </div>
                        </div>
                      </div>
                    ) : m.role === "ai" ? (
                      <div className="bubble">
                        <SiraMessage text={m.text} />
                      </div>
                    ) : (
                      <div className="bubble">{m.text}</div>
                    )}
                    <div className="msg-meta">
                      <span>{m.time}</span>
                      {m.role === "ai" && !m.isWelcome && (
                        <>
                          <span style={{ color: "var(--accent)", letterSpacing: 1 }}>🧠 {m.model}</span>
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

            <button className={`scroll-btn ${showScrollBtn ? "visible" : "hidden"}`} onClick={() => scrollToBottom(true)}>
              {unreadCount > 0 && <span className="unread-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
              ↓
            </button>
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
                maxLength={MAX_CHARS + 50}
              />
              <button className="send-btn" onClick={() => sendMessage()} disabled={loading || charCount > MAX_CHARS}>SEND ▶</button>
            </div>
            <div className="input-meta">
              <span className={`char-counter ${charClass}`}>
                {charCount > 0 ? `${charCount} / ${MAX_CHARS}${charCount > MAX_CHARS ? " — TOO LONG" : ""}` : `MAX ${MAX_CHARS} CHARS`}
              </span>
            </div>
          </div>
        </div>
)}

      </div>
            
    </>
  );
}