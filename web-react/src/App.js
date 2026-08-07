import { useState, useEffect, useRef, useCallback, memo } from "react";
import { v4 as uuidv4 } from 'uuid';
import History from "./History";
import NeuralBrain from "./NeuralBrain";
import { db } from "./firebase";
import { collection, doc, setDoc, addDoc, serverTimestamp, increment } from "firebase/firestore";

import SiraVoice from "./SiraVoice";
import SiraAvatar from "./SiraAvatar";
import { HermesModal } from "./HermesModal";

const FLASK_URL = "http://localhost:5000";

const MODEL_OPTIONS = [
  { value: "ollama",      label: "SIRA — qwen2.5:7b (local)",       tag: "LOCAL — FREE", chip: "sira-model (local)",    cloud: false },
  { value: "ollama_phi3", label: "Phi3 3.8B — fastest (local)",     tag: "LOCAL — FREE", chip: "phi3 3.8b (local)",     cloud: false },
  { value: "groq",        label: "Groq — Llama 3.3 70B (cloud)",    tag: "CLOUD — FREE", chip: "groq llama3 (cloud)",   cloud: true  },
  { value: "gemini",      label: "Google Gemini 2.0 Flash (cloud)", tag: "CLOUD — FREE", chip: "gemini 2.0 (cloud)",    cloud: true  },
  { value: "mistral",     label: "Mistral Small (cloud — free)",    tag: "CLOUD — FREE", chip: "mistral small (cloud)", cloud: true  },
];

const QUICK_QUESTIONS = [
  "What IPs triggered alerts?",
  "Suspicious activity?",
  "What should I do?",
  "Summarise events",
];

const MAX_CHARS = 500;
const darkCss = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #060A11; --bg2: #0A121C; --bg3: #0D1622; --panel: #0A121C;
    --border: rgba(41,211,255,0.09); --border2: rgba(41,211,255,0.18);
    --accent: #29D3FF; --accent2: #1FA8CC;
    --accent-glow: rgba(41,211,255,0.16); --accent-dim: rgba(41,211,255,0.08);
    --green: #22D97A; --green-dim: rgba(34,217,122,0.09);
    --red: #E15554; --red-dim: rgba(225,85,84,0.09);
    --orange: #F0A857; --orange-dim: rgba(240,168,87,0.09);
    --purple: #8B7CFF; --purple-dim: rgba(139,124,255,0.09);
    --text: #F2F6FA; --text-mid: #8FA3B5; --text-dim: #4C6478;
    --mono: 'IBM Plex Mono', monospace; --sans: 'Inter', sans-serif; --display: 'Space Grotesk', sans-serif;
    --scroll-btn-bg: rgba(41,211,255,0.16); --scroll-btn-border: rgba(41,211,255,0.4); --scroll-btn-color: #29D3FF;
    --char-ok: #8FA3B5; --char-warn: #F0A857; --char-over: #E15554;
  }
`;

const lightCss = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #F4F7FA; --bg2: #FFFFFF; --bg3: #EEF2F7; --panel: #FFFFFF;
    --border: rgba(14,165,214,0.12); --border2: rgba(14,165,214,0.22);
    --accent: #0EA5D6; --accent2: #0B84AD;
    --accent-glow: rgba(14,165,214,0.14); --accent-dim: rgba(14,165,214,0.07);
    --green: #16A34A; --green-dim: rgba(22,163,74,0.08);
    --red: #DC2626; --red-dim: rgba(220,38,38,0.08);
    --orange: #D97706; --orange-dim: rgba(217,119,6,0.08);
    --purple: #7C6CE0; --purple-dim: rgba(124,108,224,0.08);
    --text: #0F172A; --text-mid: #475569; --text-dim: #94A3B8;
    --mono: 'IBM Plex Mono', monospace; --sans: 'Inter', sans-serif; --display: 'Space Grotesk', sans-serif;
    --scroll-btn-bg: rgba(14,165,214,0.12); --scroll-btn-border: rgba(14,165,214,0.4); --scroll-btn-color: #0EA5D6;
    --char-ok: #64748B; --char-warn: #D97706; --char-over: #DC2626;
  }
`;

const sharedCss = `
  html, body, #root { height: 100%; }
  body { font-family: var(--sans); background: var(--bg); color: var(--text); overflow: hidden; -webkit-font-smoothing: antialiased; }
  ::-webkit-scrollbar { width: 3px; height: 3px; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }

  .app { position: relative; z-index: 1; display: grid; grid-template-rows: 66px 1fr; grid-template-columns: var(--sidebar-width, 320px) 1fr; height: 100vh; width: 100vw; }

  /* ===== TOP NAV ===== */
  .topnav { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; background: var(--panel); border-bottom: 1px solid var(--border); position: relative; z-index: 10; gap: 10px; overflow-x: auto; }
  .topnav::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--accent), transparent); opacity: 0.35; }
  .nav-brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .brand-icon { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, var(--accent), var(--purple)); display: flex; align-items: center; justify-content: center; font-size: 15px; box-shadow: 0 0 22px var(--accent-glow); animation: pulse-icon 3s ease-in-out infinite; flex-shrink: 0; }
  @keyframes pulse-icon { 0%,100%{box-shadow:0 0 18px var(--accent-glow)} 50%{box-shadow:0 0 30px var(--accent-glow)} }
  .brand-name { font-family: var(--display); font-size: 15px; font-weight: 700; letter-spacing: 0.3px; color: var(--text); }
  .brand-sub { font-family: var(--mono); font-size: 8px; color: var(--text-dim); letter-spacing: 1.5px; text-transform: uppercase; margin-top: 2px; }
  .nav-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .nav-status { display: flex; align-items: center; gap: 3px; padding: 4px; background: var(--bg3); border-radius: 10px; border: 1px solid var(--border); }
  .status-pill { display: flex; align-items: center; gap: 5px; padding: 5px 9px; border-radius: 7px; border: none; background: transparent; font-family: var(--mono); font-size: 8px; color: var(--text-mid); letter-spacing: 0.3px; white-space: nowrap; }
  .ndot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
  .ndot-green { background: var(--green); box-shadow: 0 0 6px var(--green); animation: blink 2s infinite; }
  .ndot-red   { background: var(--red);   box-shadow: 0 0 6px var(--red); }
  .ndot-cyan  { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .nav-time { font-family: var(--mono); font-size: 11px; color: var(--accent); letter-spacing: 0.5px; padding: 5px 9px; background: var(--bg3); border-radius: 7px; border: 1px solid var(--border); white-space: nowrap; }
  .user-pill { display: flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 7px; border: 1px solid var(--border2); background: var(--bg3); font-family: var(--mono); font-size: 8px; color: var(--accent); letter-spacing: 0.3px; white-space: nowrap; }
  .user-avatar { width: 18px; height: 18px; border-radius: 6px; background: linear-gradient(135deg, var(--accent), var(--purple)); display: flex; align-items: center; justify-content: center; font-size: 8px; color: var(--bg); font-weight: 700; }
  .logout-btn { display: flex; align-items: center; gap: 4px; padding: 5px 11px; border-radius: 7px; cursor: pointer; background: var(--red-dim); border: 1px solid rgba(225,85,84,0.3); color: var(--red); font-family: var(--mono); font-size: 8px; letter-spacing: 0.3px; text-transform: uppercase; transition: all 0.2s; white-space: nowrap; }
  .logout-btn:hover { background: rgba(225,85,84,0.18); }
  .theme-toggle { display: flex; align-items: center; gap: 5px; padding: 5px 8px; border-radius: 20px; border: 1px solid var(--border2); background: var(--bg3); font-family: var(--mono); font-size: 9px; color: var(--text-mid); cursor: pointer; transition: all 0.2s; flex-shrink: 0; }
  .theme-toggle:hover { border-color: var(--accent); color: var(--accent); }
  .toggle-track { width: 26px; height: 13px; border-radius: 7px; background: var(--border2); position: relative; transition: background 0.2s; flex-shrink: 0; }
  .toggle-track.on { background: var(--accent); }
  .toggle-thumb { position: absolute; top: 2px; left: 2px; width: 9px; height: 9px; border-radius: 50%; background: white; transition: transform 0.2s; }
  .toggle-thumb.on { transform: translateX(13px); }

  /* ===== LEFT SIDEBAR ===== */
  .left-panel { background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; }
  .section-label { font-family: var(--mono); font-size: 9px; font-weight: 600; color: var(--text-dim); letter-spacing: 2.5px; text-transform: uppercase; display: flex; align-items: center; gap: 8px; padding: 20px 20px 0; }
  .section-label::after { content: ''; flex: 1; height: 1px; background: var(--border); }
  .model-select-wrap { padding: 12px 20px 0; }
  .model-select { width: 100%; appearance: none; background: var(--bg3); border: 1px solid var(--border2); border-radius: 10px; padding: 12px 16px; font-family: var(--mono); font-size: 12px; color: var(--text); cursor: pointer; outline: none; transition: all 0.2s; }
  .model-select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
  .model-select option { background: var(--bg3); color: var(--text); }
  .model-badge { display: inline-flex; align-items: center; gap: 5px; margin: 10px 20px 0; font-family: var(--mono); font-size: 8px; letter-spacing: 1px; padding: 4px 10px; border-radius: 20px; border: 1px solid; }
  .badge-local { color: var(--green); border-color: rgba(34,217,122,0.3); background: var(--green-dim); }
  .badge-cloud { color: var(--orange); border-color: rgba(240,168,87,0.3); background: var(--orange-dim); }
  .panel-divider { height: 1px; background: var(--border); margin: 18px 0; }

  .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 0 20px; }
  .stat { background: var(--bg3); border: 1px solid var(--border); border-radius: 10px; padding: 14px; position: relative; overflow: hidden; transition: transform 0.2s, border-color 0.2s; }
  .stat:hover { border-color: var(--border2); transform: translateY(-2px); }
  .stat::before, .stat::after { content: ''; position: absolute; width: 7px; height: 7px; border-color: var(--accent); opacity: 0.55; pointer-events: none; }
  .stat::before { top: -1px; left: -1px; border-top: 1.5px solid; border-left: 1.5px solid; border-radius: 4px 0 0 0; }
  .stat::after  { bottom: -1px; right: -1px; border-bottom: 1.5px solid; border-right: 1.5px solid; border-radius: 0 0 4px 0; }
  .stat-glow { position: absolute; top: 0; left: 0; right: 0; height: 1px; }
  .stat-glow.c { background: linear-gradient(90deg, transparent, var(--accent), transparent); }
  .stat-glow.r { background: linear-gradient(90deg, transparent, var(--red), transparent); }
  .stat-glow.o { background: linear-gradient(90deg, transparent, var(--orange), transparent); }
  .stat-glow.g { background: linear-gradient(90deg, transparent, var(--green), transparent); }
  .stat-label { font-family: var(--mono); font-size: 8px; color: var(--text-dim); letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 7px; }
  .stat-value { font-family: var(--display); font-size: 24px; font-weight: 700; line-height: 1; }
  .stat-value.c { color: var(--accent); }
  .stat-value.r { color: var(--red); }
  .stat-value.o { color: var(--orange); }
  .stat-value.g { color: var(--green); font-size: 14px; padding-top: 6px; font-family: var(--mono); }

  .feed-wrap { display: flex; flex-direction: column; }
  .feed { flex: 1; overflow-y: auto; padding: 0 20px 20px; display: flex; flex-direction: column; gap: 5px; }
  .feed-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 12px; border-radius: 8px; border: 1px solid transparent; background: var(--bg3); cursor: default; transition: all 0.15s; position: relative; overflow: hidden; flex-shrink: 0; }
  .feed-item::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2.5px; }
  .feed-item.alert::before { background: var(--red); }
  .feed-item.dns::before   { background: var(--accent); }
  .feed-item.http::before  { background: var(--green); }
  .feed-item.tls::before   { background: var(--purple); }
  .feed-item.flow::before  { background: var(--text-dim); }
  .feed-item:hover { border-color: var(--border2); background: var(--bg2); transform: translateX(2px); }
  .feed-type { font-family: var(--mono); font-size: 8px; font-weight: 700; min-width: 30px; text-transform: uppercase; }
  .feed-type.alert { color: var(--red); }
  .feed-type.dns   { color: var(--accent); }
  .feed-type.http  { color: var(--green); }
  .feed-type.tls   { color: var(--purple); }
  .feed-type.flow  { color: var(--text-dim); }
  .feed-ips { font-family: var(--mono); font-size: 8px; color: var(--text-mid); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .feed-src { color: var(--accent); }
  .feed-time { font-family: var(--mono); font-size: 7px; color: var(--text-dim); flex-shrink: 0; }

  /* ===== CHAT ===== */
  .chat-col { display: flex; flex-direction: column; overflow: hidden; position: relative;
    background-image: linear-gradient(180deg, rgba(6,10,17,0.93) 0%, rgba(6,10,17,0.88) 60%, rgba(6,10,17,0.96) 100%),
      url('https://images.unsplash.com/photo-1770249196589-36453bf42a4b?fm=jpg&q=80&w=2000&auto=format&fit=crop');
    background-size: cover; background-position: center 25%; background-attachment: fixed; }
  .chat-header { display: flex; align-items: center; gap: 14px; padding: 0 28px; height: 68px; flex-shrink: 0; background: var(--panel); border-bottom: 1px solid var(--border); }
  .agent-avatar { width: 40px; height: 40px; flex-shrink: 0; border-radius: 10px; background: linear-gradient(135deg, var(--accent), var(--purple)); display: flex; align-items: center; justify-content: center; font-size: 17px; box-shadow: 0 0 18px var(--accent-glow); }
  .agent-name { font-family: var(--display); font-size: 15px; font-weight: 600; letter-spacing: 0; color: var(--text); }
  .agent-sub { font-family: var(--mono); font-size: 9px; color: var(--text-mid); }
  .sdot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--green); box-shadow: 0 0 6px var(--green); margin-right: 5px; animation: blink 2s infinite; }
  .model-chip { margin-left: auto; font-family: var(--mono); font-size: 8px; letter-spacing: 1px; padding: 5px 12px; border-radius: 20px; background: var(--accent-dim); color: var(--accent); border: 1px solid var(--border2); }
  .clear-btn { background: transparent; border: 1px solid var(--border2); color: var(--text-dim); padding: 6px 14px; border-radius: 20px; font-family: var(--mono); font-size: 9px; letter-spacing: 0.5px; cursor: pointer; transition: all 0.15s; text-transform: uppercase; }
  .clear-btn:hover { border-color: var(--red); color: var(--red); }

  .messages-wrap { flex: 1; position: relative; overflow: hidden; }
  .messages { height: 100%; overflow-y: auto; padding: 28px; display: flex; flex-direction: column; gap: 20px; }
  .msg { display: flex; }
  .msg.user { justify-content: flex-end; }
  .bubble-wrap { display: flex; flex-direction: column; max-width: 68%; }
  .msg.ai .bubble-wrap { max-width: 94%; width: 94%; }
  .msg.user .bubble-wrap { align-items: flex-end; }
  .bubble { padding: 14px 18px; font-size: 13px; line-height: 1.7; border-radius: 14px; }
  .msg.ai .bubble { background: transparent; border: none; padding: 0; width: 100%; }
  .msg.user .bubble { background: var(--accent-dim); border: 1px solid var(--accent-glow); color: var(--text); border-radius: 16px 16px 4px 16px; }
  @keyframes cardIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .msg-meta { font-family: var(--mono); font-size: 8px; color: var(--text-dim); margin-top: 7px; display: flex; align-items: center; gap: 10px; }
  .msg.user .msg-meta { justify-content: flex-end; }
  .copy-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; font-family: var(--mono); font-size: 8px; letter-spacing: 0.5px; text-transform: uppercase; padding: 0; transition: color 0.15s; }
  .copy-btn:hover { color: var(--accent); }
  .typing-wrap { display: flex; gap: 8px; align-items: center; padding: 12px 16px; background: var(--panel); border: 1px solid var(--border2); border-left: 2.5px solid var(--accent); border-radius: 12px; width: fit-content; }
  .typing-label { font-family: var(--mono); font-size: 9px; color: var(--accent); letter-spacing: 1.5px; }
  .typing-dot { width: 4px; height: 4px; border-radius: 50%; animation: bounce 1s infinite; }
  .typing-dot:nth-child(2) { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
  .typing-dot:nth-child(3) { background: var(--purple); box-shadow: 0 0 6px var(--purple); animation-delay: 0.15s; }
  .typing-dot:nth-child(4) { background: var(--accent); box-shadow: 0 0 6px var(--accent); animation-delay: 0.3s; }
  @keyframes bounce { 0%,100%{transform:translateY(0);opacity:0.3} 50%{transform:translateY(-5px);opacity:1} }
  .scroll-btn { position: absolute; bottom: 20px; right: 20px; width: 40px; height: 40px; border-radius: 12px; background: var(--scroll-btn-bg); border: 1px solid var(--scroll-btn-border); color: var(--scroll-btn-color); font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(0,0,0,0.2); transition: all 0.2s; z-index: 20; }
  .scroll-btn.hidden { opacity: 0; pointer-events: none; }
  .scroll-btn.visible { opacity: 1; pointer-events: all; }
  .unread-badge { position: absolute; top: -4px; right: -4px; width: 16px; height: 16px; border-radius: 50%; background: var(--red); color: white; font-family: var(--mono); font-size: 8px; font-weight: 700; display: flex; align-items: center; justify-content: center; }

  .input-area { padding: 16px 28px 22px; background: var(--panel); border-top: 1px solid var(--border); }
  .quick-btns { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 12px; }
  .qbtn { font-family: var(--mono); font-size: 9px; letter-spacing: 0.5px; text-transform: uppercase; padding: 7px 14px; border-radius: 20px; border: 1px solid var(--border2); background: var(--bg3); color: var(--text-mid); cursor: pointer; transition: all 0.15s; }
  .qbtn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); transform: translateY(-1px); }
  .input-row { display: flex; gap: 10px; }
  .chat-input { flex: 1; background: var(--bg3); border: 1px solid var(--border2); border-radius: 12px; padding: 14px 18px; color: var(--text); font-family: var(--mono); font-size: 12.5px; outline: none; transition: all 0.2s; }
  .chat-input::placeholder { color: var(--text-dim); }
  .chat-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
  .send-btn { padding: 14px 28px; background: linear-gradient(135deg, var(--accent), var(--accent2)); border: none; border-radius: 12px; cursor: pointer; color: var(--bg); font-family: var(--mono); font-size: 10px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; transition: all 0.15s; box-shadow: 0 4px 16px -4px var(--accent-glow); }
  .send-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px -4px var(--accent-glow); }
  .send-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .input-meta { display: flex; justify-content: flex-end; margin-top: 7px; }
  .char-counter { font-family: var(--mono); font-size: 9px; letter-spacing: 0.5px; transition: color 0.2s; }
  .char-counter.ok   { color: var(--char-ok); }
  .char-counter.warn { color: var(--char-warn); }
  .char-counter.over { color: var(--char-over); font-weight: 700; }

  .toast { position: fixed; bottom: 90px; right: 24px; background: var(--panel); border: 1px solid var(--accent); color: var(--accent); font-family: var(--mono); font-size: 10px; padding: 10px 18px; border-radius: 10px; letter-spacing: 0.5px; z-index: 9999; box-shadow: 0 4px 24px -6px var(--accent-glow); animation: fadeIn 0.2s ease; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }

  .welcome-card { background: var(--panel); border: 1px solid var(--border2); border-left: 3px solid var(--accent); border-radius: 14px; padding: 22px; }
  .welcome-title { font-family: var(--display); font-size: 19px; font-weight: 600; letter-spacing: 0; margin-bottom: 7px; color: var(--text); }
  .welcome-title span { color: var(--accent); }
  .welcome-body { font-family: var(--mono); font-size: 11px; color: var(--text-mid); line-height: 1.8; }
  .welcome-tags { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 14px; }
  .wtag { font-family: var(--mono); font-size: 8px; letter-spacing: 0.5px; padding: 4px 11px; border-radius: 20px; border: 1px solid var(--border2); color: var(--text-dim); }

  /* ===== SUB-PAGES (Analytics, Investigation) ===== */
  .page { flex: 1; overflow-y: auto; padding: 28px; background: var(--bg); }
  .page-title { font-family: var(--display); font-size: 21px; font-weight: 700; color: var(--text); margin-bottom: 5px; }
  .page-sub { font-family: var(--mono); font-size: 10px; color: var(--text-mid); letter-spacing: 2px; margin-bottom: 26px; }
  .page-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .page-card { background: var(--panel); border: 1px solid var(--border2); border-radius: 14px; padding: 22px; position: relative; }
  .page-card::before, .page-card::after { content: ''; position: absolute; width: 9px; height: 9px; border-color: var(--accent); opacity: 0.45; pointer-events: none; }
  .page-card::before { top: -1px; left: -1px; border-top: 1.5px solid; border-left: 1.5px solid; border-radius: 6px 0 0 0; }
  .page-card::after  { bottom: -1px; right: -1px; border-bottom: 1.5px solid; border-right: 1.5px solid; border-radius: 0 0 6px 0; }
  .page-card-title { font-family: var(--mono); font-size: 9px; font-weight: 700; color: var(--accent); letter-spacing: 2.5px; text-transform: uppercase; margin-bottom: 18px; }

  .inv-search { width: 100%; background: var(--bg3); border: 1px solid var(--border2); border-radius: 10px; padding: 12px 18px; color: var(--text); font-family: var(--mono); font-size: 12px; outline: none; margin-bottom: 18px; }
  .inv-search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
  .inv-table { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 11px; }
  .inv-table th { text-align: left; padding: 9px 14px; color: var(--text-dim); font-size: 9px; letter-spacing: 1.5px; border-bottom: 1px solid var(--border2); }
  .inv-table td { padding: 9px 14px; border-bottom: 1px solid var(--border); color: var(--text-mid); }
  .inv-table tr:hover td { background: var(--bg3); color: var(--text); cursor: pointer; }
  .inv-type-badge { display: inline-block; padding: 3px 9px; border-radius: 20px; font-size: 8px; font-weight: 700; text-transform: uppercase; }
  .inv-type-alert { background: var(--red-dim); color: var(--red); }
  .inv-type-dns   { background: var(--accent-dim); color: var(--accent); }
  .inv-type-http  { background: var(--green-dim); color: var(--green); }
  .inv-type-tls   { background: var(--purple-dim); color: var(--purple); }
  .inv-type-flow  { background: var(--bg3); color: var(--text-dim); }

  /* ===== MODALS ===== */
  .modal-overlay { position: fixed; inset: 0; background: rgba(4,6,10,0.75); backdrop-filter: blur(3px); z-index: 100; display: flex; align-items: center; justify-content: center; }
  .modal { background: var(--panel); border: 1px solid var(--border2); border-radius: 16px; padding: 26px; width: 600px; max-width: 90vw; max-height: 82vh; overflow-y: auto; position: relative; box-shadow: 0 30px 70px -20px rgba(0,0,0,0.6); }
  .modal-close { position: absolute; top: 18px; right: 18px; background: var(--bg3); border: 1px solid var(--border2); border-radius: 8px; width: 28px; height: 28px; color: var(--text-dim); cursor: pointer; font-size: 15px; display: flex; align-items: center; justify-content: center; }
  .modal-close:hover { color: var(--red); border-color: var(--red); }
  .modal-title { font-family: var(--display); font-size: 16px; font-weight: 600; color: var(--text); margin-bottom: 5px; }
  .modal-sub { font-family: var(--mono); font-size: 9px; color: var(--text-mid); margin-bottom: 22px; letter-spacing: 0.5px; }
  .modal-row { display: flex; gap: 8px; margin-bottom: 11px; align-items: flex-start; }
  .modal-key { font-family: var(--mono); font-size: 10px; color: var(--text-dim); min-width: 120px; }
  .modal-val { font-family: var(--mono); font-size: 11px; color: var(--text); font-weight: 700; }
  .ask-sira-btn { margin-top: 16px; width: 100%; padding: 12px; background: linear-gradient(135deg, var(--accent), var(--accent2)); border: none; border-radius: 10px; color: var(--bg); font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: 1.5px; cursor: pointer; text-transform: uppercase; }

  .top-ip-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .top-ip-addr { font-family: var(--mono); font-size: 11px; color: var(--accent); min-width: 140px; }
  .top-ip-bar { flex: 1; height: 6px; background: var(--bg3); border-radius: 4px; overflow: hidden; }
  .top-ip-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--purple)); border-radius: 4px; }
  .top-ip-count { font-family: var(--mono); font-size: 10px; color: var(--text-dim); min-width: 30px; text-align: right; }
`;
function SimpleExplain({ text }) {
  const [open, setOpen]       = useState(false);
  const [explain, setExplain] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchExplain = async () => {
    if (explain) { setOpen(o => !o); return; }
    setOpen(true);
    setLoading(true);
    try {
      const res  = await fetch(`${FLASK_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: `Explain this security alert in very simple English for a complete beginner with no technical knowledge. Use an analogy if possible. Maximum 3 sentences. No jargon at all. Here is the alert: ${text.substring(0, 600)}`,
          model: "ollama"
        })
      });
      const data = await res.json();
      setExplain(data.answer || "Could not generate explanation.");
    } catch {
      setExplain("Could not connect to SIRA.");
    }
    setLoading(false);
  };

  return (
    <div style={{borderTop:"1px solid rgba(255,255,255,0.04)"}}>
     <button onClick={fetchExplain} style={{
  width:"100%", padding:"10px 14px",
  background:"rgba(255,170,0,0.06)",
  border:"none",
  borderTop:"1px solid rgba(255,170,0,0.15)",
  display:"flex", alignItems:"center", gap:8,
  cursor:"pointer", transition:"all 0.15s"
}}
onMouseEnter={e=>e.currentTarget.style.background="rgba(255,170,0,0.12)"}
onMouseLeave={e=>e.currentTarget.style.background="rgba(255,170,0,0.06)"}>
  <span style={{fontSize:14}}>💡</span>
  <span style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--orange)",letterSpacing:2,fontWeight:700}}>
    {open ? "▲ HIDE SIMPLE EXPLANATION" : "▼ EXPLAIN IN SIMPLE ENGLISH"}
  </span>
  <span style={{marginLeft:"auto",fontFamily:"var(--mono)",fontSize:8,color:"var(--orange)",opacity:0.6}}>
    {open ? "" : "FOR BEGINNERS"}
  </span>
</button>

      {open && (
        <div style={{
          padding:"12px 14px 14px",
          background:"rgba(255,170,0,0.04)",
          borderTop:"1px solid rgba(255,170,0,0.1)"
        }}>
          <div style={{
            fontFamily:"var(--mono)",fontSize:8,
            color:"var(--orange)",letterSpacing:2,marginBottom:8,
            display:"flex",alignItems:"center",gap:6
          }}>
            💡 SIMPLE EXPLANATION
          </div>
          {loading ? (
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <div style={{width:4,height:4,borderRadius:"50%",background:"var(--orange)",animation:"blink 1s infinite"}}/>
              <span style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--text-dim)"}}>Simplifying...</span>
            </div>
          ) : (
            <div style={{
              fontSize:12,color:"var(--text-mid)",
              lineHeight:1.8,fontFamily:"var(--sans)"
            }}>{explain}</div>
          )}
        </div>
      )}
    </div>
  );
}

function ConfidenceRing({ pct, color }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d");
    const cx = 20, cy = 20, r = 15;
    ctx.clearRect(0, 0, 40, 40);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (pct / 100) * Math.PI * 2); ctx.stroke();
  }, [pct, color]);
  return <canvas ref={ref} width={40} height={40} style={{ width: 40, height: 40 }} />;
}

function SiraMessage({ text, modelChip }) {
  if (!text) return null;
  const sections = {};
  const sectionNames = ["SUMMARY","THREAT DETAILS","WHAT THIS MEANS","RISK ASSESSMENT","RECOMMENDED ACTIONS"];
  for (let i = 0; i < sectionNames.length; i++) {
    const current = sectionNames[i], next = sectionNames[i+1];
    const startIdx = text.indexOf(current);
    if (startIdx === -1) continue;
    const endIdx = next ? text.indexOf(next) : text.length;
    sections[current] = text.slice(startIdx + current.length, endIdx !== -1 ? endIdx : undefined).replace(/^[\s:\-]+/, "").trim();
  }
  const riskText = sections["RISK ASSESSMENT"] || "";
  const riskLevel = /CRITICAL/i.test(riskText) ? "critical" : /HIGH/i.test(riskText) ? "high" : /MEDIUM/i.test(riskText) ? "medium" : /LOW/i.test(riskText) ? "low" : "medium";
  const riskLabel = riskLevel.toUpperCase();
  const riskColor = riskLevel === "low" ? "var(--green)" : riskLevel === "medium" ? "var(--orange)" : "var(--red)";
  const confidenceMatch = riskText.match(/confidence[:\s]+(\w+)/i);
  const confidenceText = confidenceMatch ? confidenceMatch[1].toLowerCase() : null;
  const confidencePct = confidenceText === "high" ? 85 : confidenceText === "medium" ? 60 : confidenceText === "low" ? 35 : null;
  const threatText = sections["THREAT DETAILS"] || "";
  const ipMatches = threatText.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g) || [];
  const portMatch = threatText.match(/[Pp]ort[:\s]+(\d+)/);
  const sigMatch = text.match(/ET\s+\w+[^\n]*/);
  const tags = [
    ...ipMatches.slice(0,2).map(ip => ({ label: ip, color:"var(--red)", bg:"rgba(225,85,84,0.08)", border:"rgba(225,85,84,0.25)" })),
    portMatch ? { label:`PORT ${portMatch[1]}`, color:"var(--text)", bg:"rgba(255,255,255,0.04)", border:"rgba(255,255,255,0.08)" } : null,
    sigMatch ? { label:sigMatch[0].substring(0,28)+"...", color:"var(--orange)", bg:"rgba(240,168,87,0.08)", border:"rgba(240,168,87,0.2)" } : null,
    { label:`SEVERITY ${riskLabel}`, color:riskColor, bg:`rgba(${riskLevel==="low"?"34,217,122":riskLevel==="medium"?"240,168,87":"225,85,84"},0.09)`, border:`rgba(${riskLevel==="low"?"34,217,122":riskLevel==="medium"?"240,168,87":"225,85,84"},0.25)` },
  ].filter(Boolean);
  const actionsText = sections["RECOMMENDED ACTIONS"] || "";
  const actionLines = actionsText.split("\n").map(l => l.trim()).filter(l => /^\d+\./.test(l));
  const actions = actionLines.slice(0,3).map(l => l.replace(/^\d+\.\s*/,"").split("—")[0].trim());
  while (actions.length < 3) actions.push(null);
  const hasStructure = Object.keys(sections).length > 0;
  return (
    <div style={{background:"var(--panel)",borderRadius:14,overflow:"hidden",border:"1px solid var(--border2)",boxShadow:"0 4px 24px -8px rgba(0,0,0,0.3)",animation:"cardIn 0.3s ease both"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"12px 16px",borderBottom:"1px solid var(--border)"}}>
        <div style={{width:6,height:6,borderRadius:"50%",background:hasStructure?riskColor:"var(--accent)",flexShrink:0}}/>
        <span style={{fontSize:10,fontFamily:"var(--mono)",letterSpacing:2,color:hasStructure?riskColor:"var(--accent)"}}>{hasStructure?`${riskLabel} RISK`:"SIRA ANALYSIS"}</span>
        <span style={{color:"var(--text-dim)",fontSize:10,fontFamily:"var(--mono)"}}>·</span>
        <span style={{fontSize:10,color:"var(--text-dim)",fontFamily:"var(--mono)"}}>{modelChip||"sira-model"}</span>
        <span style={{fontSize:10,color:"var(--text-dim)",fontFamily:"var(--mono)",marginLeft:"auto"}}>{new Date().toLocaleTimeString()}</span>
      </div>
      <div style={{fontSize:12.5,color:"var(--text-mid)",lineHeight:1.9,padding:16,borderBottom:"1px solid var(--border)",fontFamily:"var(--sans)",letterSpacing:0.1}}>
  {(sections["SUMMARY"]||text).split(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g).map((part,i)=>
    /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(part)
      ?<span key={i} style={{color:"var(--red)",fontWeight:700,fontFamily:"var(--mono)"}}>{part}</span>
      :part
  )}
</div>
      {hasStructure && tags.length > 0 && (
        <div style={{display:"flex",gap:7,flexWrap:"wrap",padding:"12px 16px",borderBottom:"1px solid var(--border)"}}>
          {tags.map((tag,i)=>(
            <span key={i} style={{fontSize:10,padding:"4px 12px",borderRadius:20,fontFamily:"var(--mono)",color:tag.color,background:tag.bg,border:`1px solid ${tag.border}`}}>{tag.label}</span>
          ))}
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,padding:16}}>
        <div style={{padding:"12px 14px",borderRadius:10,background:"var(--red-dim)",border:"1px solid rgba(225,85,84,0.22)"}}>
          <div style={{fontSize:8,color:"var(--red)",fontFamily:"var(--mono)",letterSpacing:1,marginBottom:6}}>NOW</div>
          <div style={{fontSize:11.5,color:"var(--text)",lineHeight:1.5}}>{actions[0]||"Block attacker IP at perimeter firewall immediately"}</div>
        </div>
        <div style={{padding:"12px 14px",borderRadius:10,background:"var(--orange-dim)",border:"1px solid rgba(240,168,87,0.18)"}}>
          <div style={{fontSize:8,color:"var(--orange)",fontFamily:"var(--mono)",letterSpacing:1,marginBottom:6}}>SOON</div>
          <div style={{fontSize:11.5,color:"var(--text)",lineHeight:1.5}}>{actions[1]||"Run Hermes investigation for full threat assessment"}</div>
        </div>
        <div style={{padding:"12px 14px",borderRadius:10,background:"var(--green-dim)",border:"1px solid rgba(34,217,122,0.15)"}}>
          <div style={{fontSize:8,color:"var(--green)",fontFamily:"var(--mono)",letterSpacing:1,marginBottom:6}}>LATER</div>
          <div style={{fontSize:11.5,color:"var(--text)",lineHeight:1.5}}>{actions[2]||"Check AbuseIPDB score and build attacker profile"}</div>
        </div>
      </div>
      {hasStructure && confidencePct && (
        <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:"rgba(255,255,255,0.02)",borderTop:"1px solid var(--border)"}}>
          <ConfidenceRing pct={confidencePct} color={riskColor} />
          <div>
            <div style={{fontSize:9,color:"var(--text-dim)",fontFamily:"var(--mono)",letterSpacing:1}}>CONFIDENCE</div>
            <div style={{fontSize:15,fontFamily:"var(--display)",fontWeight:700,color:riskColor}}>{confidencePct}%</div>
          </div>
        </div>
      )}
      <SimpleExplain text={text} />
    </div>
  );
}

const AnalyticsPage = memo(function AnalyticsPage({ stats }) {
  const [topIPs, setTopIPs] = useState([]);
  const [timeline, setTimeline]   = useState([]);
  const hourChartRef              = useRef(null);
  const typeChartRef              = useRef(null);
  const hourChartInstance         = useRef(null);
  const typeChartInstance         = useRef(null);

  useEffect(() => {
    fetch(`${FLASK_URL}/top-ips?limit=10`).then(r=>r.json()).then(data=>setTopIPs(Array.isArray(data)?data:[])).catch(()=>{});
    fetch(`${FLASK_URL}/timeline`).then(r=>r.json()).then(setTimeline).catch(()=>{});
  }, []);

  useEffect(() => {
    if (!timeline.length || !hourChartRef.current || !window.Chart) return;
    if (hourChartInstance.current) hourChartInstance.current.destroy();
    const hours = Array.from({length:24},(_,i)=>String(i).padStart(2,'0'));
    const counts = hours.map(h => timeline.find(t=>t.hour===h)?.count || 0);
    const max = Math.max(...counts) || 1;
    hourChartInstance.current = new window.Chart(hourChartRef.current, {
      type:'bar',
      data:{
        labels: hours.map(h=>h+'h'),
        datasets:[{
          data: counts,
          backgroundColor: counts.map(c => c===max?'#E15554':c>max*0.5?'#F0A857':'#29D3FF'),
          borderRadius: 4,
          borderSkipped: false
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{
          backgroundColor:'#0A121C',borderColor:'rgba(41,211,255,0.3)',borderWidth:1,
          titleColor:'#29D3FF',bodyColor:'#8FA3B5',
          titleFont:{family:'IBM Plex Mono',size:10},bodyFont:{family:'IBM Plex Mono',size:10},
          callbacks:{title:i=>`Hour: ${i[0].label}`,body:i=>`Events: ${i[0].raw}`}
        }},
        scales:{
          x:{grid:{color:'rgba(41,211,255,0.05)'},ticks:{color:'#4C6478',font:{family:'IBM Plex Mono',size:9},maxRotation:0},border:{color:'rgba(41,211,255,0.08)'}},
          y:{grid:{color:'rgba(41,211,255,0.05)'},ticks:{color:'#4C6478',font:{family:'IBM Plex Mono',size:9}},border:{color:'rgba(41,211,255,0.08)'}}
        }
      }
    });
    return () => { if (hourChartInstance.current) hourChartInstance.current.destroy(); };
  }, [timeline]);

  useEffect(() => {
    if (!stats || !typeChartRef.current || !window.Chart) return;
    if (typeChartInstance.current) typeChartInstance.current.destroy();
    const breakdown = stats.event_breakdown || {};
    const labels = Object.keys(breakdown);
    const data   = Object.values(breakdown);
    const colors = { alert:'#E15554', dns:'#29D3FF', http:'#22D97A', tls:'#8B7CFF', flow:'#4C6478' };
    typeChartInstance.current = new window.Chart(typeChartRef.current, {
      type:'doughnut',
      data:{
        labels,
        datasets:[{
          data,
          backgroundColor: labels.map(l=>colors[l]||'#8FA3B5'),
          borderColor:'#0A121C',
          borderWidth:3,
          hoverOffset:6
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false, cutout:'70%',
        plugins:{legend:{display:false},tooltip:{
          backgroundColor:'#0A121C',borderColor:'rgba(41,211,255,0.3)',borderWidth:1,
          titleColor:'#29D3FF',bodyColor:'#8FA3B5',
          titleFont:{family:'IBM Plex Mono',size:10},bodyFont:{family:'IBM Plex Mono',size:10}
        }}
      }
    });
    return () => { if (typeChartInstance.current) typeChartInstance.current.destroy(); };
  }, [stats]);

  const breakdown = stats?.event_breakdown || {};
  const breakdownTotal = Object.values(breakdown).reduce((a,b)=>a+b,0) || 1;
  const typeColors = { alert:'#E15554', dns:'#29D3FF', http:'#22D97A', tls:'#8B7CFF', flow:'#4C6478' };
  const maxCount = topIPs.length > 0 ? topIPs[0].count : 1;

  return (
    <div className="page">
      <div className="page-title">Analytics</div>
      <div className="page-sub">REAL-TIME EVENT ANALYSIS FROM YOUR LOGS</div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:22}}>
        {[
          {label:"TOTAL EVENTS", value:stats?.total_events||"--", color:"var(--accent)", sub:"from eve.json"},
          {label:"ALERTS",       value:stats?.alert_count||"--",  color:"var(--red)",    sub:`${stats?.alert_count&&stats?.total_events?Math.round(stats.alert_count/stats.total_events*100):0}% of total`},
          {label:"UNIQUE IPs",   value:stats?.unique_ips||"--",   color:"var(--orange)", sub:"threat actors"},
          {label:"THREAT LEVEL", value:stats?.alert_count>10?"CRITICAL":stats?.alert_count>5?"HIGH":"ELEVATED", color:stats?.alert_count>10?"var(--red)":"var(--orange)", sub:"based on alerts"},
        ].map((s,i)=>(
          <div key={i} className="page-card" style={{padding:16}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${s.color},transparent)`}}/>
            <div style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--text-dim)",letterSpacing:1.5,marginBottom:9}}>{s.label}</div>
            <div style={{fontFamily:"var(--display)",fontSize:s.label==="THREAT LEVEL"?15:28,fontWeight:700,color:s.color,lineHeight:1}}>{s.value}</div>
            <div style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--text-dim)",marginTop:5}}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="page-card" style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div className="page-card-title" style={{marginBottom:0}}>EVENTS PER HOUR</div>
          <div style={{display:"flex",gap:14}}>
            {[["#E15554","Peak"],["#F0A857","High"],["#29D3FF","Normal"]].map(([color,label])=>(
              <div key={label} style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:8,height:8,borderRadius:3,background:color}}/>
                <span style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--text-dim)"}}>{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{position:"relative",height:200}}>
          <canvas ref={hourChartRef} role="img" aria-label="Events per hour bar chart"/>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>

        <div className="page-card">
          <div className="page-card-title">EVENT TYPE BREAKDOWN</div>
          <div style={{position:"relative",height:180}}>
            <canvas ref={typeChartRef} role="img" aria-label="Event type donut chart"/>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:10,marginTop:16,paddingTop:14,borderTop:"1px solid var(--border)"}}>
            {Object.entries(breakdown).map(([type,count])=>(
              <div key={type} style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:8,height:8,borderRadius:3,background:typeColors[type]||"#8FA3B5"}}/>
                <span style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--text-dim)",textTransform:"uppercase"}}>{type} {Math.round(count/breakdownTotal*100)}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="page-card">
          <div className="page-card-title">TOP 10 ATTACKER IPs</div>
          <div style={{display:"flex",flexDirection:"column",gap:11}}>
            {topIPs.map((item,i)=>{
              const color = i===0?"var(--red)":i<3?"var(--orange)":"var(--accent)";
              return (
                <div key={i}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--text-dim)",minWidth:16}}>{i+1}.</span>
                      <span style={{fontFamily:"var(--mono)",fontSize:10,color}}>{item.ip}</span>
                    </div>
                    <span style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--text-dim)"}}>{item.count} hits</span>
                  </div>
                  <div className="top-ip-bar">
                    <div className="top-ip-fill" style={{width:`${(item.count/maxCount)*100}%`,background:color,transition:"width 0.5s"}}/>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

const InvestigationPage = memo(function InvestigationPage({ onAskSira }) {
  const [logs, setLogs]                     = useState([]);
  const [search, setSearch]                 = useState("");
  const [selected, setSelected]             = useState(null);
  const [profile, setProfile]               = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [whatIf, setWhatIf]                 = useState(null);
  const [whatIfLoading, setWhatIfLoading]   = useState(false);

  const loadProfile = async (ip) => {
    setProfileLoading(true); setProfile(null);
    try { const res = await fetch(`${FLASK_URL}/attacker-profile/${ip}`); setProfile(await res.json()); }
    catch { setProfile({ error:"Failed to load profile" }); }
    setProfileLoading(false);
  };

  useEffect(() => { fetch(`${FLASK_URL}/logs?limit=200`).then(r=>r.json()).then(setLogs).catch(()=>{}); }, []);

  const filtered = logs.filter(l => !search || l.src_ip?.includes(search) || l.dest_ip?.includes(search) || l.alert?.signature?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="page">
      <div className="page-title">Investigation</div>
      <div className="page-sub">SEARCH AND ANALYSE LOG EVENTS</div>
      <input className="inv-search" placeholder="Search by IP or alert signature..." value={search} onChange={e=>setSearch(e.target.value)} />
      <div className="page-card">
        <table className="inv-table">
          <thead><tr><th>TYPE</th><th>TIME</th><th>SOURCE IP</th><th>DEST IP</th><th>DETAILS</th></tr></thead>
          <tbody>
            {filtered.slice(0,100).map((l,i)=>(
              <tr key={i} onClick={()=>setSelected(l)}>
                <td><span className={`inv-type-badge inv-type-${l.event_type}`}>{l.event_type}</span></td>
                <td>{l.timestamp?.substring(11,19)}</td>
                <td style={{color:"var(--accent)"}}>{l.src_ip}</td>
                <td>{l.dest_ip}</td>
                <td style={{color:"var(--text-dim)",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.alert?.signature||l.dns?.rrname||l.http?.hostname||"—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="modal-overlay" onClick={()=>setSelected(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <button className="modal-close" onClick={()=>setSelected(null)}>✕</button>
            <div className="modal-title">Event Details</div>
            <div className="modal-sub">{selected.timestamp}</div>
            <div className="modal-row"><span className="modal-key">Type</span><span className="modal-val">{selected.event_type?.toUpperCase()}</span></div>
            <div className="modal-row"><span className="modal-key">Source IP</span><span className="modal-val" style={{color:"var(--accent)"}}>{selected.src_ip}:{selected.src_port}</span></div>
            <div className="modal-row"><span className="modal-key">Destination IP</span><span className="modal-val">{selected.dest_ip}:{selected.dest_port}</span></div>
            <div className="modal-row"><span className="modal-key">Protocol</span><span className="modal-val">{selected.proto}</span></div>
            {selected.alert && <>
              <div className="modal-row"><span className="modal-key">Alert</span><span className="modal-val" style={{color:"var(--red)"}}>{selected.alert.signature}</span></div>
              <div className="modal-row"><span className="modal-key">Category</span><span className="modal-val">{selected.alert.category}</span></div>
              <div className="modal-row"><span className="modal-key">Severity</span><span className="modal-val">{selected.alert.severity}</span></div>
            </>}
            {selected.dns && <div className="modal-row"><span className="modal-key">DNS Query</span><span className="modal-val">{selected.dns.rrname}</span></div>}
            {selected.http && <div className="modal-row"><span className="modal-key">HTTP</span><span className="modal-val">{selected.http.http_method} {selected.http.hostname}{selected.http.url}</span></div>}
            {selected.src_ip && (
              <button onClick={()=>{loadProfile(selected.src_ip);setSelected(null);}} style={{marginTop:14,width:"100%",padding:"11px",background:"var(--purple-dim)",border:"1px solid var(--purple)",borderRadius:10,color:"var(--purple)",fontFamily:"var(--mono)",fontSize:11,fontWeight:700,letterSpacing:1.5,cursor:"pointer",textTransform:"uppercase"}}>◈ VIEW ATTACKER PROFILE</button>
            )}
            <div style={{display:"flex",gap:8,marginTop:12}}>
              <button className="ask-sira-btn" style={{flex:1,marginTop:0}} onClick={()=>{onAskSira(`Analyse this ${selected.event_type} event from ${selected.src_ip} to ${selected.dest_ip} at ${selected.timestamp}`);setSelected(null);}}>⬡ ASK SIRA</button>
              {selected.alert?.signature && (
                <button onClick={async()=>{
                  const sig=selected.alert.signature,src=selected.src_ip,dst=selected.dest_ip;
                  setSelected(null);setWhatIfLoading(true);setWhatIf(null);
                  try{const res=await fetch(`${FLASK_URL}/what-if`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({signature:sig,src_ip:src,dest_ip:dst})});setWhatIf(await res.json());}
                  catch{setWhatIf({error:"Failed to load"});}
                  setWhatIfLoading(false);
                }} style={{flex:1,padding:"11px",background:"var(--orange-dim)",border:"1px solid var(--orange)",borderRadius:10,color:"var(--orange)",fontFamily:"var(--mono)",fontSize:11,fontWeight:700,letterSpacing:1.5,cursor:"pointer",textTransform:"uppercase"}}>⚠ WHAT IF?</button>
              )}
            </div>
          </div>
        </div>
      )}

      {(profile||profileLoading) && (
        <div className="modal-overlay" onClick={()=>setProfile(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{width:680}}>
            <button className="modal-close" onClick={()=>setProfile(null)}>✕</button>
            {profileLoading && <div style={{textAlign:"center",padding:40,fontFamily:"var(--mono)",color:"var(--accent)"}}>◈ Building attacker profile...</div>}
            {profile && !profile.error && (
              <>
                <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20,padding:"16px",background:"var(--bg3)",borderRadius:12,border:"1px solid var(--purple)",borderLeft:"3px solid var(--purple)"}}>
                  <img src={`https://flagcdn.com/24x18/${profile.geo.flag?.toLowerCase()}.png`} alt="" style={{width:36,height:27,borderRadius:3}} onError={e=>e.target.style.display='none'}/>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"var(--mono)",fontSize:20,fontWeight:700,color:"var(--purple)"}}>{profile.ip}</div>
                    <div style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--text-mid)",marginTop:4}}>{profile.geo.city}, {profile.geo.country} — {profile.geo.isp}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"var(--display)",fontSize:28,fontWeight:700,color:profile.abuse.score>75?"var(--red)":profile.abuse.score>25?"var(--orange)":"var(--green)"}}>{profile.abuse.score}%</div>
                    <div style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--text-dim)",letterSpacing:1.5}}>ABUSE SCORE</div>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:16}}>
                  {[{label:"Total Events",value:profile.stats.total_events,color:"var(--accent)"},{label:"Alerts",value:profile.stats.total_alerts,color:"var(--red)"},{label:"AbuseIPDB Reports",value:profile.abuse.reports,color:"var(--orange)"},{label:"Ports Targeted",value:profile.stats.ports_targeted.length,color:"var(--purple)"}].map((s,i)=>(
                    <div key={i} style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:10,padding:"12px",textAlign:"center"}}>
                      <div style={{fontFamily:"var(--display)",fontSize:22,fontWeight:700,color:s.color}}>{s.value}</div>
                      <div style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--text-dim)",letterSpacing:1,marginTop:4}}>{s.label}</div>
                    </div>
                  ))}
                </div>
                {profile.stats.signatures.length>0 && <div style={{marginBottom:16}}><div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--text-dim)",letterSpacing:1.5,marginBottom:8}}>ATTACK SIGNATURES USED</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{profile.stats.signatures.map((sig,i)=>(<span key={i} style={{fontFamily:"var(--mono)",fontSize:9,padding:"4px 10px",borderRadius:20,background:"var(--red-dim)",color:"var(--red)",border:"1px solid rgba(225,85,84,0.3)"}}>{sig}</span>))}</div></div>}
                {profile.stats.ports_targeted.length>0 && <div style={{marginBottom:16}}><div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--text-dim)",letterSpacing:1.5,marginBottom:8}}>PORTS TARGETED</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{profile.stats.ports_targeted.map((port,i)=>(<span key={i} style={{fontFamily:"var(--mono)",fontSize:9,padding:"4px 10px",borderRadius:20,background:"var(--accent-dim)",color:"var(--accent)",border:"1px solid rgba(41,211,255,0.25)"}}>{port}</span>))}</div></div>}
                <div style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderLeft:"2px solid var(--purple)",borderRadius:10,padding:16}}>
                  <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--purple)",letterSpacing:1.5,marginBottom:12}}>◈ SIRA THREAT ACTOR ASSESSMENT</div>
                  <div style={{fontFamily:"var(--sans)",fontSize:12,color:"var(--text-mid)",lineHeight:1.8,whiteSpace:"pre-wrap"}}>{profile.sira_assessment}</div>
                </div>
                <button className="ask-sira-btn" style={{marginTop:16}} onClick={()=>{onAskSira(`Give me a full threat analysis for attacker IP ${profile.ip} including all their attack patterns and recommended response`);setProfile(null);}}>⬡ ASK SIRA FOR FULL ANALYSIS</button>
              </>
            )}
            {profile?.error && <div style={{color:"var(--red)",fontFamily:"var(--mono)",fontSize:12,padding:20}}>✗ {profile.error}</div>}
          </div>
        </div>
      )}

      {(whatIf||whatIfLoading) && (
        <div className="modal-overlay" onClick={()=>{setWhatIf(null);setWhatIfLoading(false);}}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{width:640}}>
            <button className="modal-close" onClick={()=>{setWhatIf(null);setWhatIfLoading(false);}}>✕</button>
            <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--orange)",letterSpacing:2,marginBottom:4}}>⚠ WHAT IF MODE</div>
            <div className="modal-title">If This Attack Wasn't Blocked...</div>
            <div className="modal-sub">{whatIf?.signature}</div>
            {whatIfLoading && <div style={{textAlign:"center",padding:40,fontFamily:"var(--mono)",color:"var(--orange)"}}>⚠ SIRA is simulating the attack chain...</div>}
            {whatIf && !whatIfLoading && (
              <div style={{fontFamily:"var(--sans)",fontSize:12,color:"var(--text-mid)",lineHeight:1.8,whiteSpace:"pre-wrap",background:"var(--bg3)",border:"1px solid var(--orange)",borderLeft:"3px solid var(--orange)",borderRadius:10,padding:16}}>
                {whatIf.error ? <span style={{color:"var(--red)"}}>✗ {whatIf.error}</span> : whatIf.answer}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

function BootSequence({ onComplete }) {
  const [lines, setLines] = useState([]);
  const [done, setDone]   = useState(false);
  const bootLines = [
    { text:"SIRA v4.0 INITIALISING...",              delay:0,    color:"#29D3FF" },
    { text:"Loading threat intelligence database...", delay:500,  color:"#8FA3B5" },
    { text:"✓ ChromaDB connected",                    delay:1000, color:"#22D97A" },
    { text:"Connecting to Suricata IDS...",            delay:1400, color:"#8FA3B5" },
    { text:"✓ Suricata online",                       delay:1800, color:"#22D97A" },
    { text:"Connecting to Zeek network monitor...",    delay:2200, color:"#8FA3B5" },
    { text:"✓ Zeek online",                           delay:2600, color:"#22D97A" },
    { text:"Loading RAG pipeline...",                  delay:3000, color:"#8FA3B5" },
    { text:"✓ Neural mesh synchronised",               delay:3600, color:"#22D97A" },
    { text:"Establishing secure connection...",        delay:4000, color:"#8FA3B5" },
    { text:"✓ Encryption active — AES-256",            delay:4600, color:"#22D97A" },
    { text:"▶ ALL SYSTEMS OPERATIONAL",                delay:5200, color:"#29D3FF" },
    { text:"▶ SIRA ONLINE — STANDING BY",              delay:5800, color:"#29D3FF" },
  ];
  useEffect(() => {
    const timers = [];
    bootLines.forEach(({ text, delay, color }) => {
      timers.push(setTimeout(() => setLines(prev => [...prev, { text, color }]), delay));
    });
    timers.push(setTimeout(() => { setDone(true); timers.push(setTimeout(onComplete, 800)); }, 6600));
    return () => timers.forEach(clearTimeout);
  }, []); // eslint-disable-line

  return (
    <div style={{
      position:"fixed", inset:0, background:"#060A11", display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", zIndex:9999,
      fontFamily:"'IBM Plex Mono',monospace", opacity:done?0:1, transition:"opacity 0.8s ease"
    }}>
      <video autoPlay muted loop playsInline src="/robot-face.mp4"
        style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", opacity:0.35 }} />
      <div style={{ position:"absolute", inset:0, background:"linear-gradient(180deg, rgba(6,10,17,0.4), rgba(6,10,17,0.94))" }} />

      <div style={{ width:500, maxWidth:"90vw", position:"relative", zIndex:2 }}>
        {lines.map((line,i)=>(
          <div key={i} style={{color:line.color,fontSize:12,letterSpacing:1,marginBottom:8,opacity:0,animation:"fadeInLine 0.3s ease forwards"}}>
            {line.text}
            {i===lines.length-1 && !done && <span style={{display:"inline-block",width:8,height:14,background:"#29D3FF",marginLeft:4,animation:"blink 0.7s infinite"}}/>}
          </div>
        ))}
      </div>
      <div style={{ width:500, maxWidth:"90vw", height:2, background:"rgba(41,211,255,0.12)", marginTop:30, borderRadius:1, position:"relative", zIndex:2 }}>
        <div style={{height:"100%",background:"linear-gradient(90deg,#29D3FF,#22D97A)",borderRadius:1,transition:"width 6.6s linear",width:lines.length>0?"100%":"0%"}}/>
      </div>
      <style>{`
        @keyframes fadeInLine{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:translateX(0)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
      `}</style>
    </div>
  );
}

function NavClock() {
  const [time, setTime] = useState(new Date().toLocaleTimeString());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--accent)",letterSpacing:2}}>{time}</span>;
}

function ThreatLevelCard({ alertCount }) {
  const canvasRef = useRef(null);
  const level = alertCount > 15 ? "HIGH" : alertCount > 5 ? "MEDIUM" : "LOW";
  const color = level === "HIGH" ? "#E15554" : level === "MEDIUM" ? "#F0A857" : "#22D97A";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const bars = Array.from({ length: 14 }, () => 0.2 + Math.random() * 0.8);
    ctx.clearRect(0, 0, w, h);
    const bw = w / bars.length;
    bars.forEach((v, i) => {
      ctx.fillStyle = i === bars.length - 1 ? color : "rgba(255,255,255,0.15)";
      const bh = v * h;
      ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
    });
  }, [color, alertCount]);

  return (
    <div style={{ margin: "0 20px 14px", padding: 14, borderRadius: 10, background: "var(--bg3)", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>🛡️</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-dim)", letterSpacing: 2 }}>THREAT LEVEL</span>
        </div>
        <span style={{ fontFamily: "var(--display)", fontSize: 15, fontWeight: 700, color }}>{level}</span>
      </div>
      <canvas ref={canvasRef} width={280} height={36} style={{ width: "100%", height: 36, display: "block" }} />
    </div>
  );
}

function NetworkMap({ alerts, machines }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  const ipCounts = {};
  alerts.filter(a => a.event_type === "alert" && a.src_ip).forEach(a => {
    ipCounts[a.src_ip] = (ipCounts[a.src_ip] || 0) + 1;
  });
  const topIPs = Object.entries(ipCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([ip]) => ip);
  const machineIds = machines.slice(0, 4).map(m => m.id);
  const nodes = [
    ...topIPs.map(ip => ({ label: ip, type: "threat" })),
    ...machineIds.map(id => ({ label: id, type: "machine" })),
  ];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = 240, H = 160, cx = W / 2, cy = H / 2;
    let angle = 0;

    const positions = nodes.map((n, i) => {
      const a = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const r = 62;
      return { ...n, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    });

    const draw = () => {
      angle += 0.012;
      ctx.clearRect(0, 0, W, H);

      ctx.strokeStyle = "rgba(41,211,255,0.06)";
      ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 20) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 20) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      const grad = ctx.createLinearGradient(0, 0, 70, 0);
      grad.addColorStop(0, "rgba(41,211,255,0.35)");
      grad.addColorStop(1, "rgba(41,211,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 70, -0.35, 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = "rgba(41,211,255,0.15)";
      [30, 50, 70].forEach(r => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); });

      positions.forEach(n => {
        const color = n.type === "threat" ? "#E15554" : "#22D97A";
        ctx.strokeStyle = n.type === "threat" ? "rgba(225,85,84,0.35)" : "rgba(34,217,122,0.35)";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(n.x, n.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.type === "threat" ? 3.5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });

      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#29D3FF";
      ctx.shadowColor = "#29D3FF";
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [JSON.stringify(nodes)]); // eslint-disable-line

  return (
    <div style={{ marginTop: 20 }}>
      <div className="section-label" style={{ padding: 0, marginBottom: 10 }}>Network Map</div>
      <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)", background: "var(--bg3)" }}>
        <canvas ref={canvasRef} width={240} height={160} style={{ width: "100%", height: 160, display: "block" }} />
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#E15554" }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 8, color: "var(--text-dim)" }}>Top attackers</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22D97A" }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 8, color: "var(--text-dim)" }}>Your agents</span>
        </div>
      </div>
    </div>
  );
}

function ThreatSummaryPanel({ alerts, machines, siraAvatarRef, onOpenFullView }) {
  const canvasRef = useRef(null);
  const alertEvents = alerts.filter(a => a.event_type === "alert");
  const total = alertEvents.length;

  const sevCounts = { High: 0, Medium: 0, Low: 0 };
  alertEvents.forEach(a => {
    const sev = a.alert?.severity;
    if (sev === 1) sevCounts.High++;
    else if (sev === 2) sevCounts.Medium++;
    else sevCounts.Low++;
  });
  const sevColors = { High: "#E15554", Medium: "#F0A857", Low: "#29D3FF" };

  const catCounts = {};
  alertEvents.forEach(a => {
    const cat = a.alert?.category || "Uncategorised";
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  });
  const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || total === 0) return;
    const ctx = canvas.getContext("2d");
    const cx = 50, cy = 50, r = 38;
    ctx.clearRect(0, 0, 100, 100);
    let start = -Math.PI / 2;
    Object.entries(sevCounts).forEach(([label, count]) => {
      if (count === 0) return;
      const slice = (count / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + slice);
      ctx.closePath();
      ctx.fillStyle = sevColors[label];
      ctx.fill();
      start += slice;
    });
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }, [total, JSON.stringify(sevCounts)]); // eslint-disable-line

  return (
    <div style={{ width: "100%", height: "100%", background: "var(--panel)", overflowY: "auto", padding: 20, boxSizing: "border-box" }}>
      <SiraAvatar ref={siraAvatarRef} onOpenFullView={onOpenFullView} />

      <div className="section-label" style={{ padding: 0, marginBottom: 16 }}>Threat Summary</div>

      <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 20 }}>
        <div style={{ position: "relative", width: 100, height: 100, flexShrink: 0 }}>
          <canvas ref={canvasRef} width={100} height={100} style={{ width: 100, height: 100 }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{total}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 7, color: "var(--text-dim)" }}>TOTAL</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.entries(sevCounts).map(([label, count]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 8, height: 8, borderRadius: 3, background: sevColors[label] }} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-mid)", minWidth: 46 }}>{label}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text)", fontWeight: 700 }}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section-label" style={{ padding: 0, marginBottom: 12 }}>Top Categories</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {topCats.length === 0 && <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-dim)" }}>No alert data yet</div>}
        {topCats.map(([cat, count]) => (
          <div key={cat}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-mid)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170 }}>{cat}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-dim)" }}>{Math.round((count / total) * 100)}%</span>
            </div>
            <div className="top-ip-bar">
              <div className="top-ip-fill" style={{ width: `${(count / total) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      <NetworkMap alerts={alerts} machines={machines} />
    </div>
  );
}
export default function App() {
  const [selectedModel, setSelectedModel] = useState("ollama");
  const [messages, setMessages]           = useState([{ role:"ai", text:null, time:new Date().toLocaleTimeString(), isWelcome:true }]);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [lastSession, setLastSession]     = useState(null);
  const [input, setInput]                 = useState("");
  const [loading, setLoading]             = useState(false);
  const [alerts, setAlerts]               = useState([]);
  const [toast, setToast]                 = useState(null);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [reputations, setReputations]     = useState({});
  const [isDark, setIsDark]               = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [unreadCount, setUnreadCount]     = useState(0);
  const [sidebarWidth, setSidebarWidth]   = useState(320);
  const siraAvatarRef                     = useRef(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelWidth, setRightPanelWidth] = useState(280);
  const isRightResizing = useRef(false);
  const [stats, setStats]                 = useState(null);
  const [health, setHealth]               = useState(null);
  const [page, setPage]                   = useState("dashboard");
  const [showUpload, setShowUpload]       = useState(false);
  const [uploadFile, setUploadFile]       = useState(null);
  const [uploadStatus, setUploadStatus]   = useState("");
  const [uploading, setUploading]         = useState(false);
const [sessionId, setSessionId] = useState(() => {
  const existing = sessionStorage.getItem("currentSessionId");
  if (existing) return existing;
  const newId = uuidv4();
  sessionStorage.setItem("currentSessionId", newId);
  return newId;
});
  const [didOpen, setDidOpen]             = useState(false);
  const [bootDone, setBootDone]           = useState(() => sessionStorage.getItem("bootDone") === "true");
  const [hermesOpen, setHermesOpen]       = useState(false);
  const [hermesTask, setHermesTask]       = useState("");
  const [hermesLoading, setHermesLoading] = useState(false);
  const [hermesSteps, setHermesSteps]     = useState([]);
  const [hermesAnswer, setHermesAnswer]   = useState("");
  const [machines, setMachines]           = useState([]);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [sentinelIP, setSentinelIP]       = useState("");
  const [sentinelSaving, setSentinelSaving] = useState(false);

  const messagesRef  = useRef(null);
  const toastTimer   = useRef(null);
  const isResizing   = useRef(false);
  const isAtBottom   = useRef(true);
  const voicePlayed  = useRef(false);

  const username = localStorage.getItem("username") || "USER";
  const modelObj = MODEL_OPTIONS.find(m => m.value === selectedModel);
  const charCount = input.length;
  const charClass = charCount === 0 ? "ok" : charCount > MAX_CHARS ? "over" : charCount > MAX_CHARS * 0.8 ? "warn" : "ok";

  const handleLogout = () => { localStorage.removeItem("token"); localStorage.removeItem("username"); window.location.href = "/login"; };
  const startResize  = (e) => {
    isResizing.current = true;
    const startX = e.clientX, startWidth = sidebarWidth;
    const onMove = (e) => { if (!isResizing.current) return; setSidebarWidth(Math.min(500, Math.max(220, startWidth + e.clientX - startX))); };
    const onUp   = () => { isResizing.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };

  const startRightResize = (e) => {
    isRightResizing.current = true;
    const startX = e.clientX, startWidth = rightPanelWidth;
    const onMove = (e) => {
      if (!isRightResizing.current) return;
      const delta = startX - e.clientX; // dragging left grows the right panel
      setRightPanelWidth(Math.min(420, Math.max(200, startWidth + delta)));
    };
    const onUp = () => { isRightResizing.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };

  const showToast    = useCallback((msg) => { setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 2500); }, []);
  const scrollToBottom = useCallback((smooth=true) => { if (messagesRef.current) { messagesRef.current.scrollTo({ top: messagesRef.current.scrollHeight, behavior: smooth?"smooth":"auto" }); setUnreadCount(0); } }, []);
  const handleScroll = useCallback(() => { if (!messagesRef.current) return; const { scrollTop, scrollHeight, clientHeight } = messagesRef.current; const atBottom = scrollHeight - scrollTop - clientHeight < 60; isAtBottom.current = atBottom; setShowScrollBtn(!atBottom); if (atBottom) setUnreadCount(0); }, []);

  useEffect(() => {
    const fetchLogs = () => fetch(`${FLASK_URL}/logs`).then(r=>r.json()).then(data=>{ if (Array.isArray(data) && data.length>0) setAlerts(data); }).catch(()=>{});
    setTimeout(fetchLogs, 800);
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { const t = setTimeout(() => { fetch(`${FLASK_URL}/stats`).then(r=>r.json()).then(setStats).catch(()=>{}); }, 500); return () => clearTimeout(t); }, []);
  useEffect(() => { const t = setTimeout(() => { fetch(`${FLASK_URL}/health`).then(r=>r.json()).then(setHealth).catch(()=>{}); }, 1000); return () => clearTimeout(t); }, []);

  useEffect(() => {
    fetch(`${FLASK_URL}/sentinel-config`).then(r=>r.json()).then(data=>{
      if (data.server) {
        const ip = data.server.replace("http://","").split(":")[0];
        setSentinelIP(ip);
      }
    }).catch(()=>{});
  }, []);

  useEffect(() => {
    const loadLastSession = async () => {
      try {
        const { collection, query, where, orderBy, limit, getDocs } = await import("firebase/firestore");
        const q = query(collection(db,"soc_sessions"), where("username","==",username), orderBy("updated_at","desc"), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) { setLastSession({ id:snap.docs[0].id, ...snap.docs[0].data() }); setShowResumePrompt(true); }
      } catch(e) { console.error("Session load error:",e); }
    };
    loadLastSession();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (voicePlayed.current) return;
    voicePlayed.current = true;
    const timer = setTimeout(async () => {
      try {
        const statsData = await fetch(`${FLASK_URL}/stats`).then(r=>r.json());
        const text = `SIRA online. All systems operational. I have loaded ${(statsData.total_events||0).toLocaleString()} security events. ${statsData.alert_count||0} active alerts detected from ${statsData.unique_ips||0} unique IP addresses. Standing by for your instructions.`;
        const blob = await fetch(`${FLASK_URL}/sira-speak`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})}).then(r=>r.blob());
        const url  = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audio.play();
      } catch {}
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => { if (isAtBottom.current) { scrollToBottom(false); } else { setUnreadCount(prev=>prev+1); } }, [messages, loading]); // eslint-disable-line

  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`${FLASK_URL}/machines`).then(r=>r.json()).then(setMachines).catch(()=>{});
      const interval = setInterval(() => fetch(`${FLASK_URL}/machines`).then(r=>r.json()).then(setMachines).catch(()=>{}), 30000);
      return () => clearInterval(interval);
    }, 2000);
    return () => clearTimeout(t);
  }, []);

  const checkReputation = async (ip) => { if (reputations[ip]) return; try { const data = await fetch(`${FLASK_URL}/reputation/${ip}`).then(r=>r.json()); setReputations(prev=>({...prev,[ip]:data})); } catch {} };
  useEffect(() => {
    const alertIPs = [...new Set(alerts.filter(a=>a.event_type==="alert").map(a=>a.src_ip).filter(Boolean))];
    alertIPs.slice(0,3).forEach((ip,i) => setTimeout(()=>checkReputation(ip), i*1000));
  }, [alerts]); // eslint-disable-line

  const handleModelChange = (e) => { const val=e.target.value; setSelectedModel(val); showToast(`Switched to ${MODEL_OPTIONS.find(x=>x.value===val).chip}`); };

  const startHermes = async () => {
    if (!hermesTask.trim()) return;
    setHermesLoading(true); setHermesSteps([]); setHermesAnswer("");
    try {
      const data = await fetch(`${FLASK_URL}/hermes-agent`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({task:hermesTask})}).then(r=>r.json());
      setHermesSteps(data.steps||[]); setHermesAnswer(data.answer||"Investigation complete");
    } catch(err) { setHermesAnswer(`Error: ${err.message}`); }
    setHermesLoading(false);
  };

  const sendMessage = async (text) => {
    const q = (text||input).trim();
    if (!q || loading || charCount > MAX_CHARS) return;
    setInput("");
    setMessages(prev=>[...prev,{ role:"user", text:q, time:new Date().toLocaleTimeString() }]);
   setLoading(true);
const isFirstMessage = messages.filter(m=>!m.isWelcome).length === 0;
const sessionTitle = isFirstMessage ? (q.length>50 ? q.substring(0,50)+"..." : q) : undefined;
try {
  await setDoc(doc(db,"soc_sessions",sessionId),{username,...(sessionTitle&&{title:sessionTitle}),model_used:selectedModel,updated_at:serverTimestamp(),created_at:serverTimestamp()},{merge:true});
  await addDoc(collection(db,"soc_messages"),{username,session_id:sessionId,role:"user",message:q,model_used:selectedModel,created_at:serverTimestamp()});
} catch(e) { console.error("Firestore user save error:",e); }
try {
  const recentHistory = messages.slice(-6).filter(m=>!m.isWelcome).map(m=>({role:m.role==="user"?"user":"assistant",content:m.text}));
  const data = await fetch(`${FLASK_URL}/ask`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:q,model:selectedModel,history:recentHistory})}).then(r=>r.json());
  setMessages(prev=>[...prev,{role:"ai",text:data.answer,time:new Date().toLocaleTimeString(),model:modelObj.chip}]);
  const cleanForVoice = (data.answer || "")
    .replace(/SUMMARY:|THREAT DETAILS:|WHAT THIS MEANS:|RISK ASSESSMENT:|RECOMMENDED ACTIONS:|OVERVIEW:|TOP THREATS:|PATTERNS DETECTED:|PRIORITY ACTIONS:|SITUATION:|IMMEDIATE ACTIONS:|TODAY:|THIS WEEK:/g, "")
    .replace(/\n+/g, " ").trim().substring(0, 300);
  siraAvatarRef.current?.speak(cleanForVoice);
  try {
    await addDoc(collection(db,"soc_messages"),{username,session_id:sessionId,role:"ai",message:data.answer,model_used:selectedModel,created_at:serverTimestamp()});
    await setDoc(doc(db,"soc_sessions",sessionId),{updated_at:serverTimestamp(),message_count:increment(1)},{merge:true});
  } catch(e) { console.error("Firestore AI save error:",e); }
} catch(err) { setMessages(prev=>[...prev,{role:"ai",text:`Error: ${err.message}`,time:new Date().toLocaleTimeString()}]); }
setLoading(false);
  }

  const handleUpload = async () => {
    if (!uploadFile) { setUploadStatus("No file selected"); return; }
    setUploading(true); setUploadStatus("Uploading...");
    const formData = new FormData(); formData.append("file",uploadFile);
    try {
      const data = await fetch(`${FLASK_URL}/upload`,{method:"POST",body:formData}).then(r=>r.json());
      if (data.message) { setUploadStatus("✓ "+data.message+(data.events_loaded?` (${data.events_loaded} events loaded)`:"")); showToast("Logs uploaded"); setTimeout(()=>{setShowUpload(false);setUploadFile(null);setUploadStatus("");},2000); }
      else { setUploadStatus("✗ "+(data.error||"Upload failed")); }
    } catch { setUploadStatus("✗ Cannot connect to Flask"); }
    setUploading(false);
  };

  const saveSentinelIP = async () => {
    if (!sentinelIP.trim()) return;
    setSentinelSaving(true);
    try {
      const res = await fetch(`${FLASK_URL}/sentinel-config`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ip:sentinelIP.trim()})
      });
      const data = await res.json();
      if (data.message) showToast("Sentinel IP updated");
      else showToast(data.error||"Save failed");
    } catch { showToast("Cannot connect to Flask"); }
    setSentinelSaving(false);
  };

  const alertCount  = alerts.filter(a=>a.event_type==="alert").length;
  const uniqueIPs   = [...new Set(alerts.map(a=>a.src_ip).filter(Boolean))].length;
  const loadingLabel = { ollama:"SIRA", ollama_phi3:"PHI3", groq:"GROQ", gemini:"GEMINI", mistral:"MISTRAL" };

  return (
    <>
      {!bootDone && <BootSequence onComplete={()=>{ sessionStorage.setItem("bootDone","true"); setBootDone(true); }}/>}
      <style>{isDark ? darkCss : lightCss}{sharedCss}</style>
      {toast && <div className="toast">✓ {toast.toUpperCase()}</div>}

      {showResumePrompt && lastSession && (
        <div className="modal-overlay" onClick={()=>setShowResumePrompt(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{width:460}}>
            <div className="modal-title">Resume Last Session?</div>
            <div className="modal-sub">YOU HAVE A PREVIOUS INVESTIGATION SESSION</div>
            <div style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--text-mid)",margin:"16px 0",lineHeight:1.8,background:"var(--bg3)",padding:"12px",borderRadius:10,border:"1px solid var(--border2)"}}>
              <div style={{color:"var(--accent)",marginBottom:6}}>⬡ {lastSession.title}</div>
              <div style={{fontSize:9,color:"var(--text-dim)"}}>MODEL: {lastSession.model_used?.toUpperCase()} — {lastSession.updated_at?.toDate?.()?.toLocaleString?.()||"Recent"}</div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={async()=>{
                try {
                  const { collection, query, where, orderBy, getDocs } = await import("firebase/firestore");
                  const q = query(collection(db,"soc_messages"),where("session_id","==",lastSession.id),orderBy("created_at","asc"));
                  const snap = await getDocs(q);
                  const loaded = snap.docs.map(d=>({role:d.data().role==="user"?"user":"ai",text:d.data().message,time:d.data().created_at?.toDate?.()?.toLocaleTimeString?.()||"",model:d.data().model_used}));
                  setMessages([{role:"ai",text:null,time:new Date().toLocaleTimeString(),isWelcome:true},...loaded]);
                  setSessionId(lastSession.id);
                  if (lastSession.model_used) setSelectedModel(lastSession.model_used);
                  showToast("Session resumed");
                } catch(e) { console.error("Resume error:",e); }
                setShowResumePrompt(false);
              }} style={{flex:1,padding:"12px",background:"linear-gradient(135deg,var(--accent),var(--accent2))",border:"none",borderRadius:10,color:"var(--bg)",fontFamily:"var(--mono)",fontSize:11,fontWeight:700,letterSpacing:1.5,cursor:"pointer",textTransform:"uppercase"}}>↩ RESUME SESSION</button>
              <button onClick={()=>{setShowResumePrompt(false);showToast("Starting fresh");}} style={{flex:1,padding:"12px",background:"transparent",border:"1px solid var(--border2)",borderRadius:10,color:"var(--text-mid)",fontFamily:"var(--mono)",fontSize:11,fontWeight:700,letterSpacing:1.5,cursor:"pointer",textTransform:"uppercase"}}>+ NEW SESSION</button>
            </div>
          </div>
        </div>
      )}

      {showUpload && (
        <div className="modal-overlay" onClick={()=>setShowUpload(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{width:480}}>
            <button className="modal-close" onClick={()=>setShowUpload(false)}>✕</button>
            <div className="modal-title">Upload Log File</div>
            <div className="modal-sub">REPLACE EVE.JSON OR CONN.LOG — CHROMADB WILL REBUILD AUTOMATICALLY</div>
            <div style={{margin:"20px 0"}}>
              <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--text-dim)",letterSpacing:1.5,marginBottom:8}}>SELECT FILE</div>
              <input type="file" accept=".json,.log" onChange={e=>{setUploadFile(e.target.files[0]);setUploadStatus("");}} style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--text)",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:10,padding:"10px",width:"100%"}}/>
              {uploadFile && <div style={{marginTop:8,fontFamily:"var(--mono)",fontSize:10,color:"var(--accent)"}}>▸ {uploadFile.name} ({(uploadFile.size/1024).toFixed(1)} KB)</div>}
            </div>
            {uploadStatus && <div style={{fontFamily:"var(--mono)",fontSize:11,padding:"9px 13px",borderRadius:10,marginBottom:16,background:uploadStatus.startsWith("✓")?"var(--green-dim)":"var(--red-dim)",color:uploadStatus.startsWith("✓")?"var(--green)":"var(--red)",border:`1px solid ${uploadStatus.startsWith("✓")?"rgba(34,217,122,0.3)":"rgba(225,85,84,0.3)"}`}}>{uploadStatus}</div>}
            <button onClick={handleUpload} disabled={!uploadFile||uploading} style={{width:"100%",padding:"12px",background:"linear-gradient(135deg,var(--accent),var(--accent2))",border:"none",borderRadius:10,color:"var(--bg)",fontFamily:"var(--mono)",fontSize:11,fontWeight:700,letterSpacing:1.5,cursor:uploadFile&&!uploading?"pointer":"not-allowed",opacity:uploadFile&&!uploading?1:0.4,textTransform:"uppercase"}}>
              {uploading?"UPLOADING...":"⬆ UPLOAD AND REBUILD"}
            </button>
          </div>
        </div>
      )}

      <div className="app" style={{gridTemplateColumns:`${sidebarWidth}px 1fr`}}>
        <nav className="topnav">
          <div className="nav-brand">
            <div className="brand-icon">⬡</div>
            <div><div className="brand-name">SOC Copilot</div><div className="brand-sub">SIRA v4 — Threat Intelligence</div></div>
          </div>
          <div style={{display:"flex",gap:4}}>
            {["dashboard","analytics","investigation","history"].map(p=>(
              <button key={p} onClick={()=>setPage(p)} style={{fontFamily:"var(--mono)",fontSize:9,letterSpacing:1,textTransform:"uppercase",padding:"6px 15px",borderRadius:20,cursor:"pointer",transition:"all 0.15s",background:page===p?"var(--accent)":"transparent",color:page===p?"var(--bg)":"var(--text-dim)",border:page===p?"1px solid var(--accent)":"1px solid var(--border2)"}}>{p}</button>
            ))}
            <button onClick={()=>setHermesOpen(true)} style={{fontFamily:"var(--mono)",fontSize:9,letterSpacing:1,padding:"6px 15px",borderRadius:20,cursor:"pointer",background:"linear-gradient(135deg,rgba(139,124,255,0.2),rgba(41,211,255,0.1))",color:"var(--purple)",border:"1px solid var(--purple)",textTransform:"uppercase",fontWeight:700}}>⬡ HERMES AGENT</button>
          </div>
          <div className="nav-right">
            <div className="nav-status">
              <div className="status-pill"><div className={`ndot ${health?.status==="ok"?"ndot-green":"ndot-red"}`}/>SURICATA</div>
              <div className="status-pill"><div className={`ndot ${health?.status==="ok"?"ndot-green":"ndot-red"}`}/>ZEEK</div>
              <div className="status-pill"><div className="ndot ndot-red"/>{stats?.alert_count??alertCount} ALERTS</div>
              <div className="status-pill"><div className={`ndot ${health?.ollama==="ok"?"ndot-cyan":"ndot-red"}`}/>AI {health?.ollama==="ok"?"READY":"OFFLINE"}</div>
            </div>
            <div className="nav-time"><NavClock/></div>
            <div className="user-pill"><div className="user-avatar">{username[0].toUpperCase()}</div>{username.toUpperCase()}</div>
            <button className="logout-btn" onClick={handleLogout}>⏻ LOGOUT</button>
            <button className="theme-toggle" onClick={()=>{setIsDark(d=>!d);showToast(isDark?"Light theme":"Dark theme");}}>
              {isDark?"☀":"☾"}
              <div className={`toggle-track ${isDark?"":"on"}`}><div className={`toggle-thumb ${isDark?"":"on"}`}/></div>
            </button>
          </div>
        </nav>

        <aside className="left-panel" style={{position:"relative"}}>
          <div onMouseDown={startResize} style={{position:"absolute",right:0,top:0,bottom:0,width:4,cursor:"col-resize",zIndex:10,background:"transparent"}} onMouseEnter={e=>e.target.style.background="var(--accent)"} onMouseLeave={e=>e.target.style.background="transparent"}/>
          <div className="section-label">AI Engine</div>
          <div className="model-select-wrap">
            <select className="model-select" value={selectedModel} onChange={handleModelChange}>
              {MODEL_OPTIONS.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className={`model-badge ${modelObj.cloud?"badge-cloud":"badge-local"}`}>⬡ {modelObj.tag}</div>
          <div className="panel-divider"/>
          <div className="section-label" style={{justifyContent:"space-between"}}>
            Overview
            <button onClick={()=>fetch(`${FLASK_URL}/stats`).then(r=>r.json()).then(setStats).catch(()=>{})} style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--accent)",background:"none",border:"none",cursor:"pointer",letterSpacing:1}}>↻ REFRESH</button>
          </div>
          <div className="stats-grid" style={{marginTop:10, marginBottom:14}}>
            <div className="stat"><div className="stat-glow c"/><div className="stat-label">Total Events</div><div className="stat-value c">{stats?.total_events||alerts.length||"--"}</div></div>
            <div className="stat"><div className="stat-glow r"/><div className="stat-label">Alerts</div><div className="stat-value r">{String(stats?.alert_count??alertCount).padStart(2,"0")}</div></div>
            <div className="stat"><div className="stat-glow o"/><div className="stat-label">Unique IPs</div><div className="stat-value o">{stats?.unique_ips||uniqueIPs||"--"}</div></div>
            <div className="stat"><div className="stat-glow g"/><div className="stat-label">Status</div><div className="stat-value g">ONLINE</div></div>
          </div>
          <ThreatLevelCard alertCount={stats?.alert_count ?? alertCount} />
          <div className="panel-divider"/>
          <div className="section-label">Connected Machines</div>
          <div style={{padding:"8px 20px"}}>
            {machines.length===0 && <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--text-dim)",letterSpacing:1}}>NO AGENTS CONNECTED</div>}
            {machines.map((m,i)=>(
  <div key={i} onClick={()=>setSelectedMachine(m)} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:"1px solid var(--border)",cursor:"pointer",transition:"all 0.15s"}}
  onMouseEnter={e=>e.currentTarget.style.background="var(--bg3)"}
  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div style={{width:6,height:6,borderRadius:"50%",flexShrink:0,background:m.alert?"var(--red)":"var(--green)",boxShadow:m.alert?"0 0 6px var(--red)":"0 0 6px var(--green)",animation:"blink 2s infinite"}}/>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--text)",fontWeight:700}}>{m.id}</div>
                  <div style={{fontFamily:"var(--mono)",fontSize:7,color:"var(--text-dim)"}}>{m.local_ip} — {m.platform}</div>
                </div>
                {m.alert && <span style={{fontFamily:"var(--mono)",fontSize:7,padding:"3px 8px",borderRadius:20,background:"var(--red-dim)",color:"var(--red)",border:"1px solid rgba(225,85,84,0.3)"}}>⚠ {m.suspicious_count}</span>}
              </div>
            ))}

            <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid var(--border)"}}>
              <div style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--text-dim)",letterSpacing:1.5,marginBottom:6}}>SENTINEL SERVER IP</div>
              <div style={{display:"flex",gap:6}}>
                <input
                  value={sentinelIP}
                  onChange={e=>setSentinelIP(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&saveSentinelIP()}
                  placeholder="e.g. 10.33.4.176"
                  style={{flex:1,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:8,padding:"7px 10px",color:"var(--text)",fontFamily:"var(--mono)",fontSize:10,outline:"none"}}
                />
                <button
                  onClick={saveSentinelIP}
                  disabled={sentinelSaving||!sentinelIP.trim()}
                  style={{padding:"7px 14px",background:"var(--accent-dim)",border:"1px solid var(--accent)",borderRadius:8,color:"var(--accent)",fontFamily:"var(--mono)",fontSize:9,fontWeight:700,letterSpacing:1,cursor:sentinelIP.trim()?"pointer":"not-allowed",opacity:sentinelIP.trim()?1:0.4,textTransform:"uppercase"}}
                >
                  {sentinelSaving?"...":"SAVE"}
                </button>
              </div>
            </div>
          </div>
          <div className="panel-divider"/>
          <div className="feed-wrap">
            <div style={{padding:"0 20px 10px"}}>
              <button onClick={()=>setShowUpload(true)} style={{width:"100%",padding:"9px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:10,color:"var(--accent)",fontFamily:"var(--mono)",fontSize:9,letterSpacing:1,textTransform:"uppercase",cursor:"pointer"}} onMouseEnter={e=>e.target.style.borderColor="var(--accent)"} onMouseLeave={e=>e.target.style.borderColor="var(--border2)"}>⬆ Upload Logs</button>
            </div>
            <div className="section-label">Live Feed</div>
            <div style={{display:"flex",gap:5,padding:"9px 20px 7px",flexWrap:"wrap"}}>
              {["all","alert","dns","http","tls","flow"].map(f=>(
                <button key={f} onClick={()=>setSeverityFilter(f)} style={{fontFamily:"var(--mono)",fontSize:8,letterSpacing:1,textTransform:"uppercase",padding:"4px 10px",borderRadius:20,cursor:"pointer",background:severityFilter===f?"var(--accent)":"var(--bg3)",color:severityFilter===f?"var(--bg)":"var(--text-dim)",border:severityFilter===f?"1px solid var(--accent)":"1px solid var(--border2)"}}>{f}</button>
              ))}
            </div>
            <div className="feed">
              {alerts.length===0 && <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--text-dim)",padding:"8px 0",letterSpacing:1}}>WAITING FOR FLASK...</div>}
              {alerts.filter(a=>severityFilter==="all"||a.event_type===severityFilter).slice(0,8).map((a,i)=>(
                <div key={i} className={`feed-item ${a.event_type}`}>
                  <span className={`feed-type ${a.event_type}`}>{a.event_type?.substring(0,4).toUpperCase()}</span>
                  <span className="feed-ips">
                    <span className="feed-src">{a.src_ip}</span>
                    {reputations[a.src_ip] && (
                      <span style={{marginLeft:4,fontFamily:"var(--mono)",fontSize:7,padding:"2px 6px",borderRadius:20,fontWeight:700,background:reputations[a.src_ip].malicious?"var(--red-dim)":"var(--green-dim)",color:reputations[a.src_ip].malicious?"var(--red)":"var(--green)",border:reputations[a.src_ip].malicious?"1px solid rgba(225,85,84,0.3)":"1px solid rgba(34,217,122,0.3)"}}>
                        {reputations[a.src_ip].malicious?`⚠ ${reputations[a.src_ip].score}%`:"✓ CLEAN"}
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

        <div style={{display:page==="analytics"?"flex":"none",flex:1,overflow:"hidden"}}>
          <AnalyticsPage stats={stats}/>
        </div>
        <div style={{display:page==="investigation"?"flex":"none",flex:1,overflow:"hidden"}}>
          <InvestigationPage onAskSira={(q)=>{setPage("dashboard");setTimeout(()=>sendMessage(q),300);}}/>
        </div>
        <div style={{display:page==="history"?"flex":"none",flex:1,overflow:"hidden"}}>
          <History/>
        </div>
        <div style={{display:page==="dashboard"?"flex":"none",flexDirection:"column",flex:1,overflow:"hidden"}}>
        <div style={{display:"flex",flex:1,overflow:"hidden",position:"relative"}}>
        <div className="chat-col" style={{flex:1}}>
          <div className="chat-header">
            <div className="agent-avatar">⬡</div>
            <div>
              <div className="agent-name">SIRA</div>
              <div className="agent-sub"><span className="sdot"/>{loading?`Analysing with ${loadingLabel[selectedModel]}...`:"Security Incident Response Assistant"}</div>
            </div>
            <div className="model-chip">{modelObj.chip}</div>
            <button className="clear-btn" onClick={()=>{const newId=uuidv4();sessionStorage.setItem("currentSessionId",newId);setMessages([{role:"ai",text:null,time:new Date().toLocaleTimeString(),isWelcome:true}]);setSessionId(newId);showToast("Chat cleared");}}>CLEAR</button>
            <button onClick={()=>setDidOpen(true)} style={{padding:"5px 14px",background:"var(--purple-dim)",border:"1px solid var(--purple)",borderRadius:20,color:"var(--purple)",fontFamily:"var(--mono)",fontSize:8,letterSpacing:1,cursor:"pointer"}}>◈ SIRA FACE</button>
          </div>
          <div className="messages-wrap">
            <div className="messages" ref={messagesRef} onScroll={handleScroll}>
              {messages.map((m,i)=>(
                <div key={i} className={`msg ${m.role}`}>
                  <div className="bubble-wrap">
                    {m.isWelcome ? (
  <div className="bubble">
    <div className="welcome-card">
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
        <div style={{width:34,height:34,borderRadius:10,background:"linear-gradient(135deg,var(--accent),var(--purple))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,boxShadow:"0 0 15px var(--accent-glow)",flexShrink:0}}>⬡</div>
        <div className="welcome-title">S.I.R.A. <span>Online</span></div>
      </div>
      <div className="welcome-body">Security Incident Response Assistant — all systems operational.<br/>Suricata and Zeek logs loaded. RAG pipeline active. Standing by.</div>
      <div className="welcome-tags" style={{marginTop:12}}>
        <span className="wtag">{alerts.length||"?"} EVENTS LOADED</span>
        <span className="wtag">{alertCount} ALERTS DETECTED</span>
        <span className="wtag">RAG ACTIVE</span>
        <span className="wtag">CHROMADB READY</span>
      </div>
    </div>
  </div>
                    ) : m.role==="ai" ? (
                      <div className="bubble"><SiraMessage text={m.text} modelChip={m.model}/></div>
                    ) : (
                      <div className="bubble">{m.text}</div>
                    )}
                    <div className="msg-meta">
                      <span>{m.time}</span>
                      {m.role==="ai" && !m.isWelcome && (
                        <>
                          <span style={{color:"var(--accent)",letterSpacing:1}}>⬡ {m.model}</span>
                          <button className="copy-btn" onClick={()=>{navigator.clipboard.writeText(m.text);showToast("Copied");}}>⊕ COPY</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="msg ai">
                  <div className="typing-wrap">
                    <video autoPlay muted loop playsInline src="/robot-face.mp4"
                      style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover" }} />
                    <span className="typing-label">ANALYSING</span>
                  </div>
                </div>
              )}
            </div>
            <button className={`scroll-btn ${showScrollBtn?"visible":"hidden"}`} onClick={()=>scrollToBottom(true)}>
              {unreadCount>0 && <span className="unread-badge">{unreadCount>9?"9+":unreadCount}</span>}↓
            </button>
          </div>
          <div className="input-area">
            <div className="quick-btns">{QUICK_QUESTIONS.map((q,i)=>(<button key={i} className="qbtn" onClick={()=>sendMessage(q)}>{q}</button>))}</div>
            <div className="input-row">
              <input className="chat-input" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMessage()} placeholder="Ask SIRA about your logs..." maxLength={MAX_CHARS+50}/>
              <button className="send-btn" onClick={()=>sendMessage()} disabled={loading||charCount>MAX_CHARS}>SEND ▶</button>
            </div>
            <div className="input-meta"><span className={`char-counter ${charClass}`}>{charCount>0?`${charCount} / ${MAX_CHARS}${charCount>MAX_CHARS?" — TOO LONG":""}`:`MAX ${MAX_CHARS} CHARS`}</span></div>
          </div>
        </div>
        <div style={{ position: "relative", width: rightPanelOpen ? rightPanelWidth : 0, flexShrink: 0, transition: isRightResizing.current ? "none" : "width 0.2s", overflow: "hidden", borderLeft: rightPanelOpen ? "1px solid var(--border)" : "none" }}>
          {rightPanelOpen && (
            <div onMouseDown={startRightResize} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, cursor: "col-resize", zIndex: 10 }}
              onMouseEnter={e=>e.target.style.background="var(--accent)"} onMouseLeave={e=>e.target.style.background="transparent"} />
          )}
          <ThreatSummaryPanel alerts={alerts} machines={machines} siraAvatarRef={siraAvatarRef} onOpenFullView={()=>setDidOpen(true)} />
        </div>
        <button onClick={()=>setRightPanelOpen(o=>!o)} title={rightPanelOpen ? "Hide panel" : "Show panel"} style={{
          position: "absolute", right: rightPanelOpen ? rightPanelWidth - 12 : -12, top: "50%", transform: "translateY(-50%)",
          width: 24, height: 40, borderRadius: "6px 0 0 6px", background: "var(--bg3)", border: "1px solid var(--border2)", borderRight: "none",
          color: "var(--text-dim)", cursor: "pointer", fontSize: 11, zIndex: 20, transition: "right 0.2s",
        }}>{rightPanelOpen ? "\u203A" : "\u2039"}</button>
        </div>
        </div>
      </div>


      {selectedMachine && (
  <div className="modal-overlay" onClick={()=>setSelectedMachine(null)}>
    <div className="modal" onClick={e=>e.stopPropagation()} style={{width:580}}>
      <button className="modal-close" onClick={()=>setSelectedMachine(null)}>✕</button>

      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,padding:16,background:"var(--bg3)",borderRadius:12,border:`1px solid ${selectedMachine.alert?"var(--red)":"var(--green)"}`,borderLeft:`3px solid ${selectedMachine.alert?"var(--red)":"var(--green)"}`}}>
        <div style={{width:10,height:10,borderRadius:"50%",background:selectedMachine.alert?"var(--red)":"var(--green)",boxShadow:`0 0 8px ${selectedMachine.alert?"var(--red)":"var(--green)"}`,animation:"blink 2s infinite"}}/>
        <div style={{flex:1}}>
          <div style={{fontFamily:"var(--mono)",fontSize:16,fontWeight:700,color:"var(--text)"}}>{selectedMachine.id}</div>
          <div style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--text-mid)",marginTop:3}}>{selectedMachine.local_ip} — {selectedMachine.platform}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontFamily:"var(--display)",fontSize:22,fontWeight:700,color:selectedMachine.alert?"var(--red)":"var(--green)"}}>{selectedMachine.suspicious_count}</div>
          <div style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--text-dim)",letterSpacing:2}}>SUSPICIOUS</div>
        </div>
      </div>

      <div style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--text-dim)",letterSpacing:2,marginBottom:8}}>QUICK ACTIONS</div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <button onClick={()=>{
          setSelectedMachine(null);
          setPage("dashboard");
        setTimeout(()=>sendMessage(`What suspicious connections and threats are currently active on our network? Focus on any lateral movement or exploit attempts.`),300);
        }} style={{flex:1,padding:"10px",background:"var(--accent-dim)",border:"1px solid var(--accent)",borderRadius:10,color:"var(--accent)",fontFamily:"var(--mono)",fontSize:9,cursor:"pointer",letterSpacing:1,textTransform:"uppercase"}}>
          ⬡ ASK SIRA
        </button>
        <button onClick={()=>{
          setSelectedMachine(null);
          setPage("dashboard");
          setTimeout(()=>sendMessage(`Run full Hermes investigation on machine ${selectedMachine.id} at IP ${selectedMachine.local_ip}`),300);
        }} style={{flex:1,padding:"10px",background:"var(--purple-dim)",border:"1px solid var(--purple)",borderRadius:10,color:"var(--purple)",fontFamily:"var(--mono)",fontSize:9,cursor:"pointer",letterSpacing:1,textTransform:"uppercase"}}>
          ◈ HERMES SCAN
        </button>
        <button onClick={async()=>{
          if(selectedMachine.suspicious[0]){
            const ip = selectedMachine.suspicious[0].remote?.split(":")[0];
            if(ip){
              await fetch(`${FLASK_URL}/block-ip`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ip})});
              showToast(`Blocking ${ip}`);
            }
          }
        }} style={{flex:1,padding:"10px",background:"var(--red-dim)",border:"1px solid var(--red)",borderRadius:10,color:"var(--red)",fontFamily:"var(--mono)",fontSize:9,cursor:"pointer",letterSpacing:1,textTransform:"uppercase"}}>
          ✕ BLOCK TOP IP
        </button>
      </div>

      {selectedMachine.suspicious?.length > 0 && (
        <div style={{marginBottom:16}}>
          <div style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--text-dim)",letterSpacing:2,marginBottom:8}}>SUSPICIOUS CONNECTIONS</div>
          {selectedMachine.suspicious.map((c,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:"var(--bg3)",border:"1px solid rgba(225,85,84,0.18)",borderLeft:"2px solid var(--red)",borderRadius:8,marginBottom:5}}>
              <span style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--red)"}}>{c.remote}</span>
              <button onClick={async()=>{
                const ip = c.remote?.split(":")[0];
                await fetch(`${FLASK_URL}/block-ip`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ip})});
                showToast(`Blocking ${ip}`);
              }} style={{fontFamily:"var(--mono)",fontSize:8,padding:"4px 10px",borderRadius:20,background:"var(--red-dim)",border:"1px solid rgba(225,85,84,0.3)",color:"var(--red)",cursor:"pointer"}}>
                BLOCK
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedMachine.processes?.length > 0 && (
        <div>
          <div style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--text-dim)",letterSpacing:2,marginBottom:8}}>TOP PROCESSES</div>
          {selectedMachine.processes.map((p,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"7px 12px",background:"var(--bg3)",borderRadius:8,marginBottom:4,border:"1px solid var(--border)"}}>
              <span style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--text-mid)"}}>{p.name}</span>
              <span style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--text-dim)"}}>{p.cpu_percent}% CPU</span>
            </div>
          ))}
        </div>
      )}

    </div>
  </div>
)}

      <SiraVoice isOpen={didOpen} onClose={()=>setDidOpen(false)}/>

      <HermesModal
        hermesOpen={hermesOpen} setHermesOpen={setHermesOpen}
        hermesLoading={hermesLoading} hermesTask={hermesTask} setHermesTask={setHermesTask}
        startHermes={startHermes} hermesSteps={hermesSteps} hermesAnswer={hermesAnswer}
        setHermesAnswer={setHermesAnswer} setHermesSteps={setHermesSteps} showToast={showToast}
      />
    </>
  );
  }