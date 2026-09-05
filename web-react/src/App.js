import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { v4 as uuidv4 } from 'uuid';
import History from "./History";
import Soc2Dashboard from "./Soc2Dashboard";
import { InvestigationPage } from "./InvestigationPage";
import PipelineStatusPage from "./PipelineStatusPage";
import { db } from "./firebase";
import { collection, doc, setDoc, addDoc, getDoc, serverTimestamp, increment } from "firebase/firestore";

import SiraVoice from "./SiraVoice";
import SiraAvatar from "./SiraAvatar";
import { HermesProvider, HermesNavBadge } from "./HermesContext";
import { HermesPage } from "./HermesPage";

const FLASK_URL = "https://soc-copilot.onrender.com";

const QUICK_QUESTIONS = [
  "What IPs triggered alerts?",
  "Suspicious activity?",
  "What should I do?",
  "Summarise events",
];

// Curated from a live check on 2026-08-24 — the free-tier landscape shifts
// every few months, not by the minute, so this needs occasional manual
// refreshing (ask Claude to re-check it) rather than a real search API
// call on every request. Wiring in a paid search API just to find free
// model providers would defeat the point.
const KNOWN_FREE_PROVIDERS = [
  { id: "google-ai-studio",     name: "Google AI Studio (Gemini)",  keyword: "gemini",     signupUrl: "https://aistudio.google.com/",                                   note: "Gemini 2.5 Flash, 1M context, no card" },
  { id: "openrouter",           name: "OpenRouter (free models)",   keyword: "openrouter", signupUrl: "https://openrouter.ai/",                                         note: "20+ free models behind one key" },
  { id: "mistral",              name: "Mistral AI (free tier)",     keyword: "mistral",    signupUrl: "https://console.mistral.ai/",                                    note: "Enabled by default, no card" },
  { id: "cloudflare-workers-ai",name: "Cloudflare Workers AI",      keyword: "cloudflare", signupUrl: "https://dash.cloudflare.com/?to=/:account/ai/workers-ai",       note: "10,000 Neurons/day free" },
  { id: "nvidia-nim",           name: "NVIDIA NIM",                 keyword: "nvidia",     signupUrl: "https://build.nvidia.com/",                                      note: "100+ open models, phone verification" },
  { id: "sambanova",            name: "SambaNova Cloud",            keyword: "sambanova",  signupUrl: "https://cloud.sambanova.ai/",                                    note: "200k tokens/day per model" },
];

const MAX_CHARS = 500;
const darkCss = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0A0A0C; --bg2: #111113; --bg3: #17171A; --panel: #141416;
    --border: rgba(255,255,255,0.06); --border2: rgba(255,255,255,0.12);
    --accent: #4DD8E8; --accent2: #35B3C2;
    --accent-glow: rgba(77,216,232,0.16); --accent-dim: rgba(77,216,232,0.08);
    --green: #22D97A; --green-dim: rgba(34,217,122,0.09);
    --red: #E15554; --red-dim: rgba(225,85,84,0.09);
    --orange: #E8B84D; --orange-dim: rgba(232,184,77,0.09);
    --purple: #8B7CFF; --purple-dim: rgba(139,124,255,0.09);
    --magenta: #C93DE0; --magenta-dim: rgba(201,61,224,0.1);
    --text: #F2F2F4; --text-mid: #9A9AA2; --text-dim: #5A5A62;
    --mono: 'IBM Plex Mono', monospace; --sans: 'Inter', sans-serif; --display: 'Space Grotesk', sans-serif;
    --scroll-btn-bg: rgba(77,216,232,0.16); --scroll-btn-border: rgba(77,216,232,0.4); --scroll-btn-color: #4DD8E8;
    --char-ok: #9A9AA2; --char-warn: #E8B84D; --char-over: #E15554;
    --radius: 18px; --radius-sm: 12px;
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
    --radius: 18px; --radius-sm: 12px;
  }
`;

const sharedCss = `
  html, body, #root { height: 100%; }
  body { font-family: var(--sans); background: var(--bg); color: var(--text); overflow: hidden; -webkit-font-smoothing: antialiased; position: relative; }
  body::before {
    content: ''; position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background:
      radial-gradient(650px circle at 8% 8%, var(--accent-glow), transparent 60%),
      radial-gradient(550px circle at 92% 12%, var(--purple-dim), transparent 60%),
      radial-gradient(650px circle at 82% 92%, var(--red-dim), transparent 60%),
      radial-gradient(550px circle at 8% 92%, var(--green-dim), transparent 60%);
    filter: blur(20px);
  }
  ::-webkit-scrollbar { width: 3px; height: 3px; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }

  .app { position: relative; z-index: 1; display: grid; grid-template-rows: 64px minmax(0, 1fr); grid-template-columns: var(--sidebar-width, 320px) 1fr; height: 100vh; width: 100vw; padding: 10px; gap: 10px; box-sizing: border-box; }

  /* ===== TOP NAV — floating macOS titlebar ===== */
  .topnav {
    grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
    background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.018));
    backdrop-filter: blur(24px) saturate(160%); -webkit-backdrop-filter: blur(24px) saturate(160%);
    border: 1px solid var(--border2); border-radius: var(--radius);
    box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset, 0 10px 26px -16px rgba(0,0,0,0.5);
    position: relative; z-index: 10; gap: 10px; overflow-x: auto;
  }
  .traffic-lights { display: flex; gap: 7px; flex-shrink: 0; margin-right: 6px; }
  .traffic-dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; opacity: 0.9; }
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

  /* ===== MAC-STYLE SEGMENTED PAGE TABS ===== */
  .mac-tabs { display: inline-flex; gap: 2px; background: rgba(255,255,255,0.04); border: 1px solid var(--border2); border-radius: 14px; padding: 3px; }
  .mac-tab { position: relative; padding: 7px 16px; background: transparent; border: none; border-radius: var(--radius-sm); font-family: var(--mono); font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: var(--text-dim); cursor: pointer; }
  .mac-tab.active { color: var(--bg); font-weight: 700; }
  .mac-tab-pill { position: absolute; inset: 0; background: var(--accent); border-radius: var(--radius-sm); z-index: 0; }
  .mac-hermes-btn { font-family: var(--mono); font-size: 9px; letter-spacing: 1px; padding: 8px 15px; border-radius: 20px; cursor: pointer; background: linear-gradient(135deg, rgba(139,124,255,0.2), rgba(41,211,255,0.1)); color: var(--purple); border: 1px solid var(--purple); text-transform: uppercase; font-weight: 700; }

  /* ===== LEFT SIDEBAR ===== */
  .left-panel {
    background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015));
    backdrop-filter: blur(20px) saturate(150%); -webkit-backdrop-filter: blur(20px) saturate(150%);
    border: 1px solid var(--border2); border-radius: var(--radius);
    box-shadow: 0 1px 0 rgba(255,255,255,0.05) inset, 0 12px 28px -18px rgba(0,0,0,0.5);
    display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; min-height: 0;
  }
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
  .stat { background: rgba(255,255,255,0.035); border: 1px solid var(--border2); border-radius: var(--radius-sm); padding: 14px; position: relative; overflow: hidden; transition: transform 0.2s, border-color 0.2s; }
  .stat:hover { border-color: var(--accent); transform: translateY(-2px); }
  .stat-label { font-family: var(--mono); font-size: 8px; color: var(--text-dim); letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 7px; }
  .stat-value { font-family: var(--display); font-size: 24px; font-weight: 700; line-height: 1; }
  .stat-value.c { color: var(--accent); }
  .stat-value.r { color: var(--red); }
  .stat-value.o { color: var(--orange); }
  .stat-value.g { color: var(--green); font-size: 14px; padding-top: 6px; font-family: var(--mono); }

  .feed-wrap { display: flex; flex-direction: column; }
  .feed { flex: 1; overflow-y: auto; padding: 0 20px 20px; display: flex; flex-direction: column; gap: 5px; }
  .feed-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 12px; border-radius: var(--radius-sm); border: 1px solid transparent; background: rgba(255,255,255,0.03); cursor: default; transition: all 0.15s; position: relative; overflow: hidden; flex-shrink: 0; }
  .feed-item::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2.5px; }
  .feed-item.alert::before { background: var(--red); }
  .feed-item.dns::before   { background: var(--accent); }
  .feed-item.http::before  { background: var(--green); }
  .feed-item.tls::before   { background: var(--purple); }
  .feed-item.flow::before  { background: var(--text-dim); }
  .feed-item:hover { border-color: var(--border2); background: rgba(255,255,255,0.06); transform: translateX(2px); }
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
  .chat-col {
    display: flex; flex-direction: column; overflow: hidden; position: relative; min-height: 0;
    background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015));
    backdrop-filter: blur(20px) saturate(150%); -webkit-backdrop-filter: blur(20px) saturate(150%);
    border: 1px solid var(--border2); border-radius: var(--radius);
    box-shadow: 0 1px 0 rgba(255,255,255,0.05) inset, 0 12px 28px -18px rgba(0,0,0,0.5);
  }
  .chat-header { display: flex; align-items: center; gap: 14px; padding: 0 28px; height: 68px; flex-shrink: 0; background: transparent; border-bottom: 1px solid var(--border); border-radius: var(--radius) var(--radius) 0 0; }
  .agent-avatar { width: 40px; height: 40px; flex-shrink: 0; border-radius: 10px; background: linear-gradient(135deg, var(--accent), var(--purple)); display: flex; align-items: center; justify-content: center; font-size: 17px; box-shadow: 0 0 18px var(--accent-glow); }
  .agent-name { font-family: var(--display); font-size: 15px; font-weight: 600; letter-spacing: 0; color: var(--text); }
  .agent-sub { font-family: var(--mono); font-size: 9px; color: var(--text-mid); }
  .sdot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--green); box-shadow: 0 0 6px var(--green); margin-right: 5px; animation: blink 2s infinite; }
  .model-chip { margin-left: auto; font-family: var(--mono); font-size: 8px; letter-spacing: 1px; padding: 5px 12px; border-radius: 20px; background: var(--accent-dim); color: var(--accent); border: 1px solid var(--border2); }
  .clear-btn { background: transparent; border: 1px solid var(--border2); color: var(--text-dim); padding: 6px 14px; border-radius: 20px; font-family: var(--mono); font-size: 9px; letter-spacing: 0.5px; cursor: pointer; transition: all 0.15s; text-transform: uppercase; }
  .clear-btn:hover { border-color: var(--red); color: var(--red); }

  .messages-wrap { flex: 1; position: relative; overflow: hidden; min-height: 0; }
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

  .input-area { padding: 16px 28px 22px; background: transparent; border-top: 1px solid var(--border); border-radius: 0 0 var(--radius) var(--radius); }
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

  .welcome-card { background: rgba(255,255,255,0.04); backdrop-filter: blur(10px); border: 1px solid var(--border2); border-left: 3px solid var(--accent); border-radius: var(--radius-sm); padding: 22px; }
  .welcome-title { font-family: var(--display); font-size: 19px; font-weight: 600; letter-spacing: 0; margin-bottom: 7px; color: var(--text); }
  .welcome-title span { color: var(--accent); }
  .welcome-body { font-family: var(--mono); font-size: 11px; color: var(--text-mid); line-height: 1.8; }
  .welcome-tags { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 14px; }
  .wtag { font-family: var(--mono); font-size: 8px; letter-spacing: 0.5px; padding: 4px 11px; border-radius: 20px; border: 1px solid var(--border2); color: var(--text-dim); }

  /* ===== SUB-PAGES (Analytics, Investigation) ===== */
  .page { flex: 1; overflow-y: auto; padding: 28px; background: transparent; }
  .page-title { font-family: var(--display); font-size: 21px; font-weight: 700; color: var(--text); margin-bottom: 5px; }
  .page-sub { font-family: var(--mono); font-size: 10px; color: var(--text-mid); letter-spacing: 2px; margin-bottom: 26px; }
  .page-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .page-card {
    background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015));
    backdrop-filter: blur(20px) saturate(150%); -webkit-backdrop-filter: blur(20px) saturate(150%);
    border: 1px solid var(--border2); border-radius: var(--radius); padding: 22px; position: relative;
    box-shadow: 0 1px 0 rgba(255,255,255,0.05) inset, 0 12px 28px -18px rgba(0,0,0,0.5);
  }
  .page-card-title { font-family: var(--mono); font-size: 9px; font-weight: 700; color: var(--accent); letter-spacing: 2.5px; text-transform: uppercase; margin-bottom: 18px; }

  .inv-search { width: 100%; background: rgba(255,255,255,0.04); border: 1px solid var(--border2); border-radius: var(--radius-sm); padding: 12px 18px; color: var(--text); font-family: var(--mono); font-size: 12px; outline: none; margin-bottom: 18px; }
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
  .modal-overlay { position: fixed; inset: 0; background: rgba(4,6,10,0.6); backdrop-filter: blur(6px); z-index: 100; display: flex; align-items: center; justify-content: center; }
  .modal {
    background: linear-gradient(180deg, rgba(30,30,34,0.85), rgba(20,20,24,0.85));
    backdrop-filter: blur(28px) saturate(160%); -webkit-backdrop-filter: blur(28px) saturate(160%);
    border: 1px solid var(--border2); border-radius: var(--radius); padding: 26px; width: 600px; max-width: 90vw; max-height: 82vh;
    overflow-y: auto; position: relative; box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset, 0 30px 70px -20px rgba(0,0,0,0.6);
  }
  .modal-close { position: absolute; top: 18px; right: 18px; background: rgba(255,255,255,0.06); border: 1px solid var(--border2); border-radius: 8px; width: 28px; height: 28px; color: var(--text-dim); cursor: pointer; font-size: 15px; display: flex; align-items: center; justify-content: center; }

  /* ===== FLOATING PANELS ===== */
  .float-panel {
    position: fixed; z-index: 150; width: 420px; max-width: calc(100vw - 40px); max-height: 78vh; overflow-y: auto;
    background: linear-gradient(180deg, rgba(30,30,34,0.88), rgba(20,20,24,0.9));
    backdrop-filter: blur(28px) saturate(160%); -webkit-backdrop-filter: blur(28px) saturate(160%);
    border: 1px solid var(--border2); border-radius: var(--radius);
    box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset, 0 24px 60px -20px rgba(0,0,0,0.6);
  }
  .float-panel-handle { display: flex; align-items: center; justify-content: center; padding: 8px 0 2px; user-select: none; pointer-events: none; }
  .float-panel-grip { width: 34px; height: 4px; border-radius: 3px; background: var(--border2); cursor: grab; pointer-events: auto; }
  .float-panel-grip:active { cursor: grabbing; }
  .float-panel-body { padding: 8px 22px 22px; position: relative; }
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
    sections[current] = text.slice(startIdx + current.length, endIdx !== -1 ? endIdx : undefined).replace(/^[\s:-]+/, "").trim();
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
    <div style={{background:"linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",backdropFilter:"blur(16px) saturate(150%)",WebkitBackdropFilter:"blur(16px) saturate(150%)",borderRadius:16,overflow:"hidden",border:"1px solid var(--border2)",boxShadow:"0 1px 0 rgba(255,255,255,0.06) inset, 0 4px 24px -8px rgba(0,0,0,0.3)",animation:"cardIn 0.3s ease both"}}>
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
    <div style={{ margin: "0 20px 14px", padding: 14, borderRadius: "var(--radius-sm)", background: "rgba(255,255,255,0.035)", border: "1px solid var(--border2)" }}>
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

// Rustinel EDR widget -- reads real Sigma/YARA/IOC detections from the
// /rustinel-alerts endpoint (see ai/rustinel_reader.py + app.py). Separate
// from the Connected Machines list above it: that shows Sentinel's raw
// connection heuristic, this shows Rustinel's actual rule-based detections
// -- two different depths of endpoint visibility, kept visually consistent
// (same list-item pattern) but functionally distinct.
function RustinelPanel() {
  const [ralerts, setRalerts] = useState([]);
  useEffect(() => {
    const fetchAlerts = () => fetch(`${FLASK_URL}/rustinel-alerts?limit=5`).then(r=>r.json()).then(setRalerts).catch(()=>{});
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 20000);
    return () => clearInterval(interval);
  }, []);

  const severityColor = (sev) => {
    const s = (sev||"").toLowerCase();
    if (s === "critical" || s === "high") return "var(--red)";
    if (s === "medium") return "var(--orange)";
    return "var(--accent)"; // low/unknown
  };

  return (
    <>
      <div className="panel-divider"/>
      <div className="section-label">Rustinel EDR</div>
      <div style={{padding:"8px 20px"}}>
        {ralerts.length===0 && <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--text-dim)",letterSpacing:1}}>NO DETECTIONS</div>}
        {ralerts.map((a,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:"1px solid var(--border)"}}>
            <div style={{width:6,height:6,borderRadius:"50%",flexShrink:0,background:severityColor(a.severity),boxShadow:`0 0 6px ${severityColor(a.severity)}`}}/>
            <div style={{flex:1,overflow:"hidden"}}>
              <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--text)",fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.rule_name}</div>
              <div style={{fontFamily:"var(--mono)",fontSize:7,color:"var(--text-dim)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.engine} — {a.process_name || a.host_os}</div>
            </div>
            <span style={{fontFamily:"var(--mono)",fontSize:7,padding:"3px 8px",borderRadius:20,flexShrink:0,background:`${severityColor(a.severity)}22`,color:severityColor(a.severity),border:`1px solid ${severityColor(a.severity)}44`}}>{a.severity}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function ThreatSummaryPanel({ alerts, machines, siraAvatarRef, onOpenFullView }) {
  const canvasRef = useRef(null);
  const [attentionItems, setAttentionItems] = useState([]);
  const [attentionLoading, setAttentionLoading] = useState(true);

  useEffect(() => {
    fetch(`${FLASK_URL}/attention-items`)
      .then(r => r.json())
      .then(data => setAttentionItems(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setAttentionLoading(false));
  }, []);

  const PRIORITY_COLORS = { high: "#E15554", medium: "#F0A857", low: "#6B7280" };

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
    <div style={{ width: "100%", height: "100%", background: "transparent", overflowY: "auto", padding: 20, boxSizing: "border-box" }}>
      <SiraAvatar ref={siraAvatarRef} onOpenFullView={onOpenFullView} />

      <div className="section-label" style={{ padding: 0, marginBottom: 12 }}>Needs Attention</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
        {attentionLoading && (
          <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-dim)" }}>Loading...</div>
        )}
        {!attentionLoading && attentionItems.length === 0 && (
          <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-dim)" }}>Nothing flagged right now</div>
        )}
        {attentionItems.map((item, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px",
            borderRadius: "var(--radius-sm)", background: "rgba(255,255,255,0.03)",
            borderLeft: `2px solid ${PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.low}`,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", marginTop: 4, flexShrink: 0, background: PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.low }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--sans)", fontSize: 11, color: "var(--text)", lineHeight: 1.4 }}>{item.title}</div>
              {item.detail && <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-dim)", marginTop: 2 }}>{item.detail}</div>}
            </div>
          </div>
        ))}
      </div>

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
    </div>
  );
}
export default function App() {
  const [selectedModel, setSelectedModel] = useState("ollama");
  const [modelOptions, setModelOptions]   = useState([]);
  const [voiceOptions, setVoiceOptions]   = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(() => localStorage.getItem("sira_voice") || "");
  useEffect(() => {
    // Same pattern as /models -- single source of truth fetched from the
    // backend instead of a hardcoded list, so it can never silently drift
    // out of sync with what edge-tts actually has configured server-side.
    fetch(`${FLASK_URL}/voices`).then(r=>r.json()).then(data => {
      setVoiceOptions(data);
      if (!localStorage.getItem("sira_voice")) {
        const def = data.find(v => v.default) || data[0];
        if (def) { setSelectedVoice(def.id); localStorage.setItem("sira_voice", def.id); }
      }
    }).catch(()=>{});
  }, []);
  const handleVoiceChange = (e) => {
    const val = e.target.value;
    setSelectedVoice(val);
    localStorage.setItem("sira_voice", val);
  };
  useEffect(() => {
    // Single source of truth is now Flask's /models endpoint (see app.py) --
    // this replaces a hardcoded array that had silently drifted out of sync
    // with the backend (two newly-added lightweight models existed
    // server-side but weren't selectable here at all, since this list was
    // never updated to match).
    fetch(`${FLASK_URL}/models`).then(r=>r.json()).then(data => {
      setModelOptions(data.map(m => ({
        value: m.id,
        label: m.name,
        chip: m.chip,
        tag: m.cloud ? "CLOUD — FREE" : "LOCAL — FREE",
        cloud: m.cloud,
      })));
    }).catch(()=>{});
  }, []);

  // ── Performance tier system ───────────────────────────────────────────
  // Embeddings (nomic-embed-text) never change here -- only the reasoning
  // models (SIRA chat + Hermes reports) switch. Changing the embedding
  // model would silently break retrieval, since ChromaDB's whole index was
  // built against one specific embedding space.
  const PERF_TIERS = {
    full:     { label: "Full",     siraModel: "ollama",          hermesModel: "nous-hermes2", ram: "~11 GB" },
    balanced: { label: "Balanced", siraModel: "ollama_phi4mini", hermesModel: "phi4-mini",     ram: "~3 GB"  },
    light:    { label: "Light",    siraModel: "ollama_llama32",  hermesModel: "phi4-mini",     ram: "~2.5 GB" },
  };
  const [perfTier, setPerfTier] = useState(() => localStorage.getItem("sira_perf_tier") || "full");
  const [hwSpecs, setHwSpecs] = useState(null);
  const [suggestedTier, setSuggestedTier] = useState(null);

  useEffect(() => {
    // navigator.deviceMemory is Chrome/Edge-only and browsers deliberately
    // round/cap it for privacy (e.g. reports "8" for anything >=8GB) -- a
    // rough heuristic to SUGGEST a tier, never something to force silently.
    const cores = navigator.hardwareConcurrency || null;
    const mem = navigator.deviceMemory || null; // undefined on Firefox/Safari
    setHwSpecs({ cores, mem });
    let suggestion = "full";
    if (mem && mem <= 4) suggestion = "light";
    else if (mem && mem <= 8) suggestion = "balanced";
    else if (!mem && cores && cores <= 4) suggestion = "balanced"; // no deviceMemory support -- fall back to core count only
    setSuggestedTier(suggestion);
  }, []);

  const applyPerfTier = (tierKey) => {
    const tier = PERF_TIERS[tierKey];
    if (!tier) return;
    setPerfTier(tierKey);
    localStorage.setItem("sira_perf_tier", tierKey);
    setSelectedModel(tier.siraModel);
    showToast(`Switched to ${tier.label} mode`);
  };
  // ─────────────────────────────────────────────────────────────────────
  const [messages, setMessages]           = useState([{ role:"ai", text:null, time:new Date().toLocaleTimeString(), isWelcome:true }]);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [lastSession, setLastSession]     = useState(null);
  const [input, setInput]                 = useState("");
  const [loading, setLoading]             = useState(false);
  const [alerts, setAlerts]               = useState([]);
  const [toast, setToast]                 = useState(null);
  const [modelSuggestion, setModelSuggestion] = useState(null); // {failedChip, suggestions:[{value,label,chip}]}
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
  const [machinePanelPos, setMachinePanelPos] = useState(null);
  const [pendingActions, setPendingActions] = useState([]);
  const [actionsPanelOpen, setActionsPanelOpen] = useState(false);
  const [actionsPanelPos, setActionsPanelPos] = useState(null);
  const [actionsBusy, setActionsBusy] = useState(null); // id currently being approved/rejected, for a disabled state
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
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
  const [machines, setMachines]           = useState([]);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [sentinelIP, setSentinelIP]       = useState("");
  const [sentinelSaving, setSentinelSaving] = useState(false);
  const [useOwnKey, setUseOwnKey]         = useState(false);
  const [apiKeyInput, setApiKeyInput]     = useState("");
  const [showApiKey, setShowApiKey]       = useState(false);

  const messagesRef  = useRef(null);
  const toastTimer   = useRef(null);
  const isResizing   = useRef(false);
  const isAtBottom   = useRef(true);
  const voicePlayed  = useRef(false);

  const username = localStorage.getItem("username") || "USER";
  const modelObj = modelOptions.find(m => m.value === selectedModel)
    || { value: "ollama", label: "SIRA (local)", tag: "LOCAL — FREE", chip: "sira-model (local)", cloud: false };
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
      const delta = startX - e.clientX;
      setRightPanelWidth(Math.min(420, Math.max(200, startWidth + delta)));
    };
    const onUp = () => { isRightResizing.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };

  const startPanelDrag = (setPos) => (e) => {
    const panelEl = e.currentTarget.closest(".float-panel");
    const rect = panelEl.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const startLeft = rect.left, startTop = rect.top;
    let dragging = true;
    const onMove = (e) => {
      if (!dragging) return;
      const nextLeft = Math.min(window.innerWidth - 60, Math.max(0, startLeft + (e.clientX - startX)));
      const nextTop  = Math.min(window.innerHeight - 40, Math.max(0, startTop + (e.clientY - startY)));
      setPos({ x: nextLeft, y: nextTop });
    };
    const onUp = () => { dragging = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
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

  const [honorific, setHonorific] = useState(null); // null = not yet resolved from Firestore
  const [showHonorificPrompt, setShowHonorificPrompt] = useState(false);

  useEffect(() => {
    const loadHonorific = async () => {
      try {
        const snap = await getDoc(doc(db, "user_preferences", username));
        if (snap.exists() && snap.data().honorific) {
          setHonorific(snap.data().honorific);
        } else {
          setShowHonorificPrompt(true);
        }
      } catch (e) {
        console.error("Honorific load error:", e);
        setHonorific("Sir"); // fail safe to a sensible default rather than block forever
      }
    };
    loadHonorific();
  }, []); // eslint-disable-line

  const chooseHonorific = async (choice) => {
    setHonorific(choice);
    setShowHonorificPrompt(false);
    try {
      await setDoc(doc(db, "user_preferences", username), { honorific: choice, updated_at: serverTimestamp() }, { merge: true });
    } catch (e) {
      console.error("Honorific save error:", e);
    }
  };

  useEffect(() => {
    if (!honorific) return; // wait until we actually know how to address them
    if (voicePlayed.current) return;
    voicePlayed.current = true;

    const speakBoot = async () => {
      // Poll /stats briefly instead of one fixed-delay fetch -- on a cold
      // start, honeypot sync may not have populated any events yet, and a
      // single early fetch could genuinely return 0, making SIRA announce
      // "I have loaded 0 security events" -- sounds broken, not just early.
      // Retry for up to ~9s before falling back to honest phrasing that
      // doesn't claim a specific count.
      let statsData = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const data = await fetch(`${FLASK_URL}/stats`).then(r => r.json());
          if ((data.total_events || 0) > 0) { statsData = data; break; }
          if (attempt === 0) statsData = data;
        } catch {}
        await new Promise(res => setTimeout(res, 1500));
      }

      const hasRealData = statsData && (statsData.total_events || 0) > 0;
      const text = hasRealData
        ? `SIRA online, ${honorific}. All systems operational. I have loaded ${statsData.total_events.toLocaleString()} security events, with ${statsData.alert_count || 0} active alerts from ${statsData.unique_ips || 0} unique IP addresses. Standing by for your instructions.`
        : `SIRA online, ${honorific}. All systems operational. Security event data is still syncing in — I'll have the full picture shortly. Standing by for your instructions.`;

      try {
        const blob = await fetch(`${FLASK_URL}/sira-speak`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).then(r => r.blob());
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audio.play();
      } catch {}
    };

    speakBoot();
  }, [honorific]); // eslint-disable-line

  useEffect(() => { if (isAtBottom.current) { scrollToBottom(false); } else { setUnreadCount(prev=>prev+1); } }, [messages, loading]); // eslint-disable-line

  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`${FLASK_URL}/machines`).then(r=>r.json()).then(setMachines).catch(()=>{});
      const interval = setInterval(() => fetch(`${FLASK_URL}/machines`).then(r=>r.json()).then(setMachines).catch(()=>{}), 30000);
      return () => clearInterval(interval);
    }, 2000);
    return () => clearTimeout(t);
  }, []);

  const fetchPendingActions = useCallback(() => {
    fetch(`${FLASK_URL}/pending-actions?status=pending`).then(r=>r.json()).then(setPendingActions).catch(()=>{});
  }, []);
  useEffect(() => {
    fetchPendingActions();
    const interval = setInterval(fetchPendingActions, 15000);
    return () => clearInterval(interval);
  }, [fetchPendingActions]);

  const approveAction = async (id) => {
    setActionsBusy(id);
    try {
      const res = await fetch(`${FLASK_URL}/pending-actions/${id}/approve`, { method: "POST" });
      const data = await res.json();
      showToast(data.detail || `Action #${id} approved`);
    } catch { showToast("Failed to approve action"); }
    setActionsBusy(null);
    fetchPendingActions();
  };
  const rejectAction = async (id) => {
    setActionsBusy(id);
    try {
      await fetch(`${FLASK_URL}/pending-actions/${id}/reject`, { method: "POST" });
      showToast(`Action #${id} rejected`);
    } catch { showToast("Failed to reject action"); }
    setActionsBusy(null);
    fetchPendingActions();
  };

  const checkReputation = async (ip) => { if (reputations[ip]) return; try { const data = await fetch(`${FLASK_URL}/reputation/${ip}`).then(r=>r.json()); setReputations(prev=>({...prev,[ip]:data})); } catch {} };
  useEffect(() => {
    const alertIPs = [...new Set(alerts.filter(a=>a.event_type==="alert").map(a=>a.src_ip).filter(Boolean))];
    alertIPs.slice(0,3).forEach((ip,i) => setTimeout(()=>checkReputation(ip), i*1000));
  }, [alerts]); // eslint-disable-line

  const handleModelChange = (e) => { const val=e.target.value; setSelectedModel(val); showToast(`Switched to ${modelOptions.find(x=>x.value===val)?.chip || val}`); };

  useEffect(() => {
    if (!modelObj.cloud) { setUseOwnKey(false); setApiKeyInput(""); return; }
    const storedUseOwn = localStorage.getItem(`sira_use_own_key_${selectedModel}`) === "true";
    const storedKey = localStorage.getItem(`sira_api_key_${selectedModel}`) || "";
    setUseOwnKey(storedUseOwn);
    setApiKeyInput(storedKey);
    setShowApiKey(false);
  }, [selectedModel]); // eslint-disable-line

  const handleToggleOwnKey = () => {
    const next = !useOwnKey;
    setUseOwnKey(next);
    localStorage.setItem(`sira_use_own_key_${selectedModel}`, next ? "true" : "false");
  };

  const saveApiKey = () => {
    localStorage.setItem(`sira_api_key_${selectedModel}`, apiKeyInput.trim());
    showToast(`API key saved for ${modelObj.chip}`);
  };

  // Turns a structured written report into something that sounds like a
  // person talking, not a document being read aloud. The old version just
  // stripped section-header words and hard-cut at 300 characters (often
  // mid-sentence); this also removes markdown bullets/bold and numbered-
  // list markers, and truncates at the nearest sentence boundary so it
  // never cuts off awkwardly.
  const cleanForVoice = (text) => {
    if (!text) return "";
    let clean = text
      .replace(/\b(SUMMARY|THREAT DETAILS|WHAT THIS MEANS|RISK ASSESSMENT|RECOMMENDED ACTIONS|OVERVIEW|TOP THREATS|PATTERNS DETECTED|PRIORITY ACTIONS|SITUATION|IMMEDIATE ACTIONS|TODAY|THIS WEEK|ENDPOINT SECURITY|PROPOSED ACTIONS|RISK LEVEL|CVE IMPACT)\s*:/gi, "")
      .replace(/\*\*/g, "").replace(/\*/g, "")
      .replace(/^\s*\d+\.\s*/gm, "")
      .replace(/^\s*[-•]\s*/gm, "")
      .replace(/\n+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    const MAX = 350;
    if (clean.length > MAX) {
      const cut = clean.slice(0, MAX);
      const lastSentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
      clean = lastSentenceEnd > 100 ? cut.slice(0, lastSentenceEnd + 1) : cut + "...";
    }
    return clean;
  };

  const [micListening, setMicListening] = useState(false);
  const [ratings, setRatings] = useState({}); // messageId -> "up" | "down", this session

  const rateMessage = async (messageId, rating, questionText, answerText) => {
    setRatings(prev => ({ ...prev, [messageId]: rating }));
    try {
      await setDoc(doc(db, "message_ratings", messageId), {
        username, rating, question: questionText || "", answer: (answerText || "").slice(0, 2000),
        model: selectedModel, rated_at: serverTimestamp(),
      });
    } catch (e) {
      console.error("Rating save error:", e);
    }
  };

  const startMicInput = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showToast("Voice input needs Chrome or Edge"); return; }
    const rec = new SR();
    rec.lang = "en-US";
    setMicListening(true);
    rec.onresult = (e) => {
      const t = e.results[0][0].transcript;
      setInput(t);
      setMicListening(false);
      sendMessage(t);
    };
    rec.onerror = () => setMicListening(false);
    rec.onend = () => setMicListening(false);
    rec.start();
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
setModelSuggestion(null);
try {
  const recentHistory = messages.slice(-6).filter(m=>!m.isWelcome && !m.isError).map(m=>({role:m.role==="user"?"user":"assistant",content:m.text}));
  const useOwn = localStorage.getItem(`sira_use_own_key_${selectedModel}`) === "true";
  const storedKey = localStorage.getItem(`sira_api_key_${selectedModel}`);
  const apiKeyToSend = (useOwn && storedKey) ? storedKey : undefined;
  const res = await fetch(`${FLASK_URL}/ask`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:q,model:selectedModel,history:recentHistory,honorific:honorific||"Sir",...(apiKeyToSend && {api_key:apiKeyToSend})})});
  const data = await res.json();
  if (!res.ok) { const err = new Error(data.error || `Request failed (${res.status})`); err.status = res.status; throw err; }
  const aiMessageId = uuidv4();
  // Was always modelObj.chip -- the model the user SELECTED, never what
  // the backend actually used. The backend already returns model_used
  // and fallback_used/fallback_note specifically for this (e.g. picking
  // a local-only model on Render, which silently falls back to a real
  // cloud provider) -- this was being computed server-side and simply
  // never displayed. Real bug: a response could come from Groq while the
  // UI claimed it came from a local model that was never actually reached.
  const actualModelLabel = data.fallback_used
    ? `${data.model_used} (fallback from ${modelObj.chip})`
    : (modelOptions.find(m=>m.value===data.model_used)?.chip || data.model_used || modelObj.chip);
  setMessages(prev=>[...prev,{id:aiMessageId,role:"ai",text:data.answer,time:new Date().toLocaleTimeString(),model:actualModelLabel,fellBack:!!data.fallback_used}]);
  siraAvatarRef.current?.speak(data.spoken_summary || cleanForVoice(data.answer));
  try {
    await addDoc(collection(db,"soc_messages"),{username,session_id:sessionId,role:"ai",message:data.answer,model_used:selectedModel,created_at:serverTimestamp()});
    await setDoc(doc(db,"soc_sessions",sessionId),{updated_at:serverTimestamp(),message_count:increment(1)},{merge:true});
  } catch(e) { console.error("Firestore AI save error:",e); }
} catch(err) {
  setMessages(prev=>[...prev,{role:"ai",text:`Error: ${err.message}`,time:new Date().toLocaleTimeString(),model:modelObj.chip,isError:true}]);
  // Every model in modelOptions is already tagged free (LOCAL — FREE / CLOUD — FREE, see
  // /models in Flask), so "suggest an alternative" just means "suggest a different one from
  // this list" — no separate free/paid curation needed. Local goes first since it can never
  // rate-limit; everything else in the same request is a genuine 429/quota signal, not a
  // one-off network blip, so we only show the banner for that.
  const isRateLimit = err.status === 429 || /rate.?limit|quota|too many requests|429/i.test(err.message || "");
  if (isRateLimit) {
    const alternatives = modelOptions.filter(m => m.value !== selectedModel);
    const local = alternatives.filter(m => !m.cloud);
    const otherCloud = alternatives.filter(m => m.cloud).slice(0, 2);
    const suggestions = [...local, ...otherCloud];
    // Anything in KNOWN_FREE_PROVIDERS whose keyword isn't already reflected
    // in a configured model's value/id counts as "not wired in yet" — these
    // get a signup link instead of an instant switch, since your backend
    // has no client for them.
    const configuredValues = modelOptions.map(m => (m.value || "").toLowerCase());
    const newProviders = KNOWN_FREE_PROVIDERS.filter(
      p => !configuredValues.some(v => v.includes(p.keyword))
    );
    if (suggestions.length || newProviders.length) {
      setModelSuggestion({ failedChip: modelObj.chip, suggestions, newProviders });
    }
  }
}
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
  // Was PERF_TIERS[perfTier]?.hermesModel, a separate model choice
  // entirely disconnected from the model the user actually picked for
  // chat -- defaulted to "nous-hermes2", a model never pulled on this
  // server, which is why Hermes stopped working after the migration.
  // Using selectedModel directly means Hermes always runs on whatever
  // the user is already using for regular questions -- one model choice,
  // not two to keep in sync.
  const hermesModel = selectedModel;

  return (
    <HermesProvider hermesModel={hermesModel}>
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

      {showHonorificPrompt && (
        <div className="modal-overlay">
          <div className="modal" style={{width:420}} onClick={e=>e.stopPropagation()}>
            <div className="modal-title">One quick thing</div>
            <div className="modal-sub">HOW SHOULD SIRA ADDRESS YOU?</div>
            <div style={{display:"flex",gap:10,marginTop:8}}>
              <button onClick={()=>chooseHonorific("Sir")} style={{flex:1,padding:"14px",background:"var(--accent-dim)",border:"1px solid var(--accent)",borderRadius:10,color:"var(--accent)",fontFamily:"var(--mono)",fontSize:12,fontWeight:700,letterSpacing:1,cursor:"pointer"}}>SIR</button>
              <button onClick={()=>chooseHonorific("Ma'am")} style={{flex:1,padding:"14px",background:"var(--purple-dim)",border:"1px solid var(--purple)",borderRadius:10,color:"var(--purple)",fontFamily:"var(--mono)",fontSize:12,fontWeight:700,letterSpacing:1,cursor:"pointer"}}>MA'AM</button>
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

      <div className="app" style={{gridTemplateColumns:`${leftPanelOpen ? sidebarWidth : 28}px 1fr`, transition: isResizing.current ? "none" : "grid-template-columns 0.2s"}}>
        <nav className="topnav">
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div className="traffic-lights">
              <span className="traffic-dot" style={{ background: "#FF5F57" }} />
              <span className="traffic-dot" style={{ background: "#FEBC2E" }} />
              <span className="traffic-dot" style={{ background: "#28C840" }} />
            </div>
            <div className="nav-brand">
              <div className="brand-icon">⬡</div>
              <div><div className="brand-name">SOC Copilot</div><div className="brand-sub">SIRA v4 — Threat Intelligence</div></div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div className="mac-tabs">
              {["dashboard","analytics","investigation","history","hermes","pipeline"].map(p=>(
                <button key={p} className={`mac-tab${page===p?" active":""}`} onClick={()=>setPage(p)}>
                  {page===p && <motion.div layoutId="mac-tab-pill" className="mac-tab-pill" transition={{type:"spring",stiffness:500,damping:36}} />}
                  <span style={{position:"relative",zIndex:1}}>{p}</span>
                </button>
              ))}
            </div>
            <HermesNavBadge onClick={()=>setPage("hermes")} />
          </div>
          <div className="nav-right">
            <div className="nav-status">
              <div className="status-pill"><div className={`ndot ${health?.status==="ok"?"ndot-green":"ndot-red"}`}/>SURICATA</div>
              <div className="status-pill"><div className={`ndot ${health?.status==="ok"?"ndot-green":"ndot-red"}`}/>ZEEK</div>
              <div className="status-pill"><div className="ndot ndot-red"/>{stats?.alert_count??alertCount} ALERTS</div>
              <div className="status-pill" style={{cursor:"pointer", background: pendingActions.length>0 ? "var(--purple-dim)" : undefined, border: pendingActions.length>0 ? "1px solid var(--purple)" : undefined}} onClick={()=>setActionsPanelOpen(true)} title="Actions proposed by Hermes, awaiting your approval">
                <div className="ndot" style={{background: pendingActions.length>0 ? "var(--purple)" : "var(--text-dim)", boxShadow: pendingActions.length>0 ? "0 0 6px var(--purple)" : "none", animation: pendingActions.length>0 ? "blink 1.4s infinite" : "none"}}/>
                {pendingActions.length} PENDING
              </div>
              <div className="status-pill"><div className={`ndot ${(health?.ollama==="ok"||health?.cloud==="ok")?"ndot-cyan":"ndot-red"}`}/>AI {(health?.ollama==="ok"||health?.cloud==="ok")?"READY":"OFFLINE"}</div>
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

        <div style={{ position: "relative", height: "100%", minHeight: 0 }}>
          <aside className="left-panel" style={{position:"relative", height:"100%", width: leftPanelOpen ? "100%" : 0, overflow: leftPanelOpen ? undefined : "hidden", transition: isResizing.current ? "none" : "width 0.2s"}}>
            {leftPanelOpen && (
              <div onMouseDown={startResize} style={{position:"absolute",right:0,top:0,bottom:0,width:4,cursor:"col-resize",zIndex:10,background:"transparent"}} onMouseEnter={e=>e.target.style.background="var(--accent)"} onMouseLeave={e=>e.target.style.background="transparent"}/>
            )}
            <div className="section-label">AI Engine</div>
            <div className="model-select-wrap">
              <select className="model-select" value={selectedModel} onChange={handleModelChange}>
                {modelOptions.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className={`model-badge ${modelObj.cloud?"badge-cloud":"badge-local"}`}>⬡ {modelObj.tag}</div>

            {modelObj.cloud ? (
              <div style={{padding:"12px 20px 0"}}>
                <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontFamily:"var(--mono)",fontSize:9,color:"var(--text-mid)",letterSpacing:1}}>
                  <input type="checkbox" checked={useOwnKey} onChange={handleToggleOwnKey} style={{accentColor:"var(--accent)",cursor:"pointer"}}/>
                  USE YOUR OWN API KEY
                </label>
                {useOwnKey && (
                  <div style={{marginTop:8,display:"flex",gap:6}}>
                    <div style={{position:"relative",flex:1}}>
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={apiKeyInput}
                        onChange={e=>setApiKeyInput(e.target.value)}
                        onKeyDown={e=>e.key==="Enter"&&saveApiKey()}
                        placeholder={`Enter ${modelObj.chip} key`}
                        style={{width:"100%",background:"rgba(255,255,255,0.04)",border:"1px solid var(--border2)",borderRadius:"var(--radius-sm)",padding:"7px 32px 7px 10px",color:"var(--text)",fontFamily:"var(--mono)",fontSize:10,outline:"none",boxSizing:"border-box"}}
                      />
                      <button
                        type="button"
                        onClick={()=>setShowApiKey(s=>!s)}
                        title={showApiKey ? "Hide key" : "Show key"}
                        style={{position:"absolute",right:5,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"var(--text-dim)",cursor:"pointer",padding:2,display:"flex",alignItems:"center"}}
                      >
                        {showApiKey ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17.94 17.94A10.94 10.94 0 0112 19c-7 0-11-7-11-7a21.6 21.6 0 015.06-6.06M9.9 4.24A10.4 10.4 0 0112 4c7 0 11 7 11 7a21.6 21.6 0 01-3.22 4.19M14.12 14.12a3 3 0 11-4.24-4.24"/><path d="M1 1l22 22"/></svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                    </div>
                    <button
                      onClick={saveApiKey}
                      disabled={!apiKeyInput.trim()}
                      style={{padding:"7px 14px",background:"var(--accent-dim)",border:"1px solid var(--accent)",borderRadius:"var(--radius-sm)",color:"var(--accent)",fontFamily:"var(--mono)",fontSize:9,fontWeight:700,letterSpacing:1,cursor:apiKeyInput.trim()?"pointer":"not-allowed",opacity:apiKeyInput.trim()?1:0.4,textTransform:"uppercase"}}
                    >SAVE</button>
                  </div>
                )}
                {selectedModel === "mistral" && useOwnKey && (
                  <div style={{marginTop:6,fontFamily:"var(--mono)",fontSize:8,color:"var(--text-dim)",lineHeight:1.5}}>
                    Note: backend needs an update from Satyam before Mistral will actually use this key.
                  </div>
                )}
              </div>
            ) : (
              <div style={{padding:"12px 20px 0"}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"10px 12px",background:"rgba(255,255,255,0.035)",border:"1px solid var(--border2)",borderRadius:"var(--radius-sm)"}}>
                  <span style={{color:"var(--green)",fontSize:13,lineHeight:1,flexShrink:0,marginTop:1}}>ⓘ</span>
                  <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--text-mid)",lineHeight:1.6}}>
                    Runs locally via Ollama — requires <span style={{color:"var(--accent)"}}>ollama serve</span> on <span style={{color:"var(--accent)"}}>localhost:11434</span>. No API key needed.
                  </div>
                </div>
              </div>
            )}

            {/* ── SIRA Voice — edge-tts voice picker, fetched from /voices ── */}
            <div className="section-label">SIRA Voice</div>
            <div className="model-select-wrap">
              <select className="model-select" value={selectedVoice} onChange={handleVoiceChange}>
                {voiceOptions.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </div>

            {/* ── Performance Mode — hardware-based tier picker ────────────
                Sets BOTH SIRA's model (via selectedModel, reusing the
                existing dropdown machinery) and Hermes's model (read from
                HermesContext at investigation start). Embeddings never
                change. */}
            <div className="section-label">Performance Mode</div>
            <div style={{padding:"10px 20px 0"}}>
              <div style={{display:"flex",gap:6,marginBottom:8}}>
                {Object.entries(PERF_TIERS).map(([key,t])=>(
                  <button key={key} onClick={()=>applyPerfTier(key)} style={{
                    flex:1, padding:"8px 6px", borderRadius:"var(--radius-sm)", cursor:"pointer",
                    fontFamily:"var(--mono)", fontSize:9, letterSpacing:0.5, textTransform:"uppercase",
                    background: perfTier===key ? "var(--accent)" : "var(--bg3)",
                    color: perfTier===key ? "var(--bg)" : "var(--text-mid)",
                    border: perfTier===key ? "1px solid var(--accent)" : "1px solid var(--border2)",
                    fontWeight: perfTier===key ? 700 : 400,
                  }}>
                    {t.label}
                    {suggestedTier===key && <div style={{fontSize:7,marginTop:2,opacity:0.75}}>SUGGESTED</div>}
                  </button>
                ))}
              </div>
              <div style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--text-dim)",lineHeight:1.6}}>
                {hwSpecs && (
                  <>Detected: {hwSpecs.cores||"?"} cores{hwSpecs.mem ? `, ~${hwSpecs.mem}GB RAM` : " (RAM detection unsupported in this browser)"}.<br/></>
                )}
                Est. RAM for current mode: <span style={{color:"var(--accent)"}}>{PERF_TIERS[perfTier].ram}</span>
              </div>
            </div>
            <div className="panel-divider"/>
            <div className="section-label" style={{justifyContent:"space-between"}}>
              Overview
              <button onClick={()=>fetch(`${FLASK_URL}/stats`).then(r=>r.json()).then(setStats).catch(()=>{})} style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--accent)",background:"none",border:"none",cursor:"pointer",letterSpacing:1}}>↻ REFRESH</button>
            </div>
            <div className="stats-grid" style={{marginTop:10, marginBottom:14}}>
              <div className="stat"><div className="stat-label">Total Events</div><div className="stat-value c">{stats?.total_events||alerts.length||"--"}</div></div>
              <div className="stat"><div className="stat-label">Alerts</div><div className="stat-value r">{String(stats?.alert_count??alertCount).padStart(2,"0")}</div></div>
              <div className="stat"><div className="stat-label">Unique IPs</div><div className="stat-value o">{stats?.unique_ips||uniqueIPs||"--"}</div></div>
              <div className="stat"><div className="stat-label">Status</div><div className="stat-value g">ONLINE</div></div>
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
            <RustinelPanel/>
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

          <button onClick={()=>setLeftPanelOpen(o=>!o)} title={leftPanelOpen ? "Hide panel" : "Show panel"} style={{
            position: "absolute", left: leftPanelOpen ? sidebarWidth - 12 : 2, top: "50%", transform: "translateY(-50%)",
            width: 24, height: 40, borderRadius: "0 6px 6px 0", background: "var(--bg3)", border: "1px solid var(--border2)", borderLeft: "none",
            color: "var(--text-dim)", cursor: "pointer", fontSize: 11, zIndex: 20, transition: "left 0.2s",
          }}>{leftPanelOpen ? "\u2039" : "\u203A"}</button>
        </div>

        <div style={{display:page==="analytics"?"flex":"none",flex:1,overflow:"hidden",minHeight:0}}>
          <Soc2Dashboard
            onAskSira={(q)=>{setPage("dashboard");setTimeout(()=>sendMessage(q),300);}}
            onSeeFindings={()=>setPage("investigation")}
          />
        </div>
        <div style={{display:page==="investigation"?"flex":"none",flex:1,overflow:"hidden",minHeight:0}}>
          <InvestigationPage onAskSira={(q)=>{setPage("dashboard");setTimeout(()=>sendMessage(q),300);}} model={selectedModel}/>
        </div>
        <div style={{display:page==="pipeline"?"flex":"none",flex:1,overflow:"hidden",minHeight:0}}>
          <PipelineStatusPage/>
        </div>
        <div style={{display:page==="history"?"flex":"none",flex:1,overflow:"hidden",minHeight:0}}>
          <History/>
        </div>
        <div style={{display:page==="hermes"?"flex":"none",flex:1,overflow:"hidden",minHeight:0,padding:page==="hermes"?"4px":0,boxSizing:"border-box"}}>
          <HermesPage username={username} />
        </div>
        <div style={{display:page==="dashboard"?"flex":"none",flexDirection:"column",flex:1,overflow:"hidden",minHeight:0}}>
        <div style={{display:"flex",flex:1,overflow:"hidden",position:"relative",gap:10,minHeight:0}}>
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
                          {m.id && (
                            <>
                              <button
                                onClick={()=>rateMessage(m.id,"up",messages[i-1]?.text,m.text)}
                                disabled={ratings[m.id]==="up"}
                                title="Good answer"
                                style={{background:"none",border:"none",cursor:ratings[m.id]==="up"?"default":"pointer",color:ratings[m.id]==="up"?"var(--green,#22D97A)":"var(--text-dim)",fontSize:12,padding:"0 4px",opacity:ratings[m.id]==="up"?1:0.6}}
                              >👍</button>
                              <button
                                onClick={()=>rateMessage(m.id,"down",messages[i-1]?.text,m.text)}
                                disabled={ratings[m.id]==="down"}
                                title="Poor answer"
                                style={{background:"none",border:"none",cursor:ratings[m.id]==="down"?"default":"pointer",color:ratings[m.id]==="down"?"var(--red,#E15554)":"var(--text-dim)",fontSize:12,padding:"0 4px",opacity:ratings[m.id]==="down"?1:0.6}}
                              >👎</button>
                            </>
                          )}
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
          {modelSuggestion && (
            <div style={{
              margin: "0 28px 14px", padding: "10px 14px", borderRadius: 10,
              background: "var(--orange-dim)", border: "1px solid var(--orange)",
              display: "flex", flexDirection: "column", gap: 8,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>⚠</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--orange)", flex: 1, minWidth: 200 }}>
                  {modelSuggestion.failedChip} looks rate-limited. Try a free alternative:
                </span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {modelSuggestion.suggestions.map(m => (
                    <button
                      key={m.value}
                      onClick={() => { setSelectedModel(m.value); showToast(`Switched to ${m.chip}`); setModelSuggestion(null); }}
                      style={{
                        fontFamily: "var(--mono)", fontSize: 9, padding: "6px 12px", borderRadius: 20,
                        border: "1px solid var(--orange)", background: "var(--bg3)", color: "var(--orange)",
                        cursor: "pointer", letterSpacing: 0.5,
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <button onClick={() => setModelSuggestion(null)} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 13, flexShrink: 0, marginLeft: 2 }}>✕</button>
              </div>
              {modelSuggestion.newProviders?.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingTop: 6, borderTop: "1px solid rgba(240,168,87,0.25)" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 8.5, color: "var(--text-dim)", letterSpacing: 0.5 }}>Not wired in yet, but also free:</span>
                  {modelSuggestion.newProviders.map(p => (
                    <a
                      key={p.id}
                      href={p.signupUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={p.note}
                      style={{
                        fontFamily: "var(--mono)", fontSize: 8.5, padding: "5px 10px", borderRadius: 20,
                        border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text-mid)",
                        textDecoration: "none",
                      }}
                    >
                      {p.name} ↗
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="input-area">
            <div className="quick-btns">{QUICK_QUESTIONS.map((q,i)=>(<button key={i} className="qbtn" onClick={()=>sendMessage(q)}>{q}</button>))}</div>
            <div className="input-row">
              <input className="chat-input" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMessage()} placeholder="Ask SIRA about your logs..." maxLength={MAX_CHARS+50}/>
              <button
                onClick={startMicInput}
                disabled={micListening}
                title={micListening ? "Listening..." : "Voice input"}
                style={{
                  padding: "0 16px", background: micListening ? "var(--purple-dim)" : "var(--bg3)",
                  border: `1px solid ${micListening ? "var(--purple)" : "var(--border2)"}`, borderRadius: 12,
                  color: micListening ? "var(--purple)" : "var(--text-mid)", cursor: micListening ? "default" : "pointer",
                  fontFamily: "var(--mono)", fontSize: 13, flexShrink: 0,
                }}
              >{micListening ? "◎" : "🎙"}</button>
              <button className="send-btn" onClick={()=>sendMessage()} disabled={loading||charCount>MAX_CHARS}>SEND ▶</button>
            </div>
            <div className="input-meta"><span className={`char-counter ${charClass}`}>{charCount>0?`${charCount} / ${MAX_CHARS}${charCount>MAX_CHARS?" — TOO LONG":""}`:`MAX ${MAX_CHARS} CHARS`}</span></div>
          </div>
        </div>
        <div style={{ position: "relative", width: rightPanelOpen ? rightPanelWidth : 0, flexShrink: 0, transition: isRightResizing.current ? "none" : "width 0.2s", overflow: "hidden" }}>
          {rightPanelOpen && (
            <div onMouseDown={startRightResize} style={{ position: "absolute", left: -6, top: 0, bottom: 0, width: 4, cursor: "col-resize", zIndex: 10 }}
              onMouseEnter={e=>e.target.style.background="var(--accent)"} onMouseLeave={e=>e.target.style.background="transparent"} />
          )}
          <div style={{
            width: "100%", height: "100%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015))",
            backdropFilter: "blur(20px) saturate(150%)", WebkitBackdropFilter: "blur(20px) saturate(150%)",
            border: "1px solid var(--border2)", borderRadius: "var(--radius)",
            boxShadow: "0 1px 0 rgba(255,255,255,0.05) inset, 0 12px 28px -18px rgba(0,0,0,0.5)",
            overflow: "hidden", boxSizing: "border-box",
          }}>
            <ThreatSummaryPanel alerts={alerts} machines={machines} siraAvatarRef={siraAvatarRef} onOpenFullView={()=>setDidOpen(true)} />
          </div>
        </div>
        <button onClick={()=>setRightPanelOpen(o=>!o)} title={rightPanelOpen ? "Hide panel" : "Show panel"} style={{
          position: "absolute", right: rightPanelOpen ? rightPanelWidth - 12 : -12, top: "50%", transform: "translateY(-50%)",
          width: 24, height: 40, borderRadius: "6px 0 0 6px", background: "var(--bg3)", border: "1px solid var(--border2)", borderRight: "none",
          color: "var(--text-dim)", cursor: "pointer", fontSize: 11, zIndex: 20, transition: "right 0.2s",
        }}>{rightPanelOpen ? "\u203A" : "\u2039"}</button>
        </div>
        </div>
      </div>


      {selectedMachine && createPortal(
  <div
    className="float-panel"
    style={machinePanelPos
      ? { left: machinePanelPos.x, top: machinePanelPos.y, right: "auto", bottom: "auto" }
      : { right: 20, bottom: 20 }}
  >
    <div className="float-panel-handle">
      <div className="float-panel-grip" onMouseDown={startPanelDrag(setMachinePanelPos)} />
    </div>
    <button className="modal-close" onClick={()=>setSelectedMachine(null)} style={{top:14,right:14,zIndex:5}}>✕</button>
    <div className="float-panel-body">

      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,padding:16,background:"rgba(255,255,255,0.04)",borderRadius:"var(--radius-sm)",border:`1px solid ${selectedMachine.alert?"var(--red)":"var(--green)"}`,borderLeft:`3px solid ${selectedMachine.alert?"var(--red)":"var(--green)"}`}}>
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
          setPage("hermes");
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
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(225,85,84,0.18)",borderLeft:"2px solid var(--red)",borderRadius:8,marginBottom:5}}>
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
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"7px 12px",background:"rgba(255,255,255,0.03)",borderRadius:8,marginBottom:4,border:"1px solid var(--border)"}}>
              <span style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--text-mid)"}}>{p.name}</span>
              <span style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--text-dim)"}}>{p.cpu_percent}% CPU</span>
            </div>
          ))}
        </div>
      )}

    </div>
  </div>,
  document.body
)}

      {actionsPanelOpen && createPortal(
  <div
    className="float-panel"
    style={actionsPanelPos
      ? { left: actionsPanelPos.x, top: actionsPanelPos.y, right: "auto", bottom: "auto" }
      : { right: 20, bottom: 20 }}
  >
    <div className="float-panel-handle">
      <div className="float-panel-grip" onMouseDown={startPanelDrag(setActionsPanelPos)} />
    </div>
    <button className="modal-close" onClick={()=>setActionsPanelOpen(false)} style={{top:14,right:14,zIndex:5}}>✕</button>
    <div className="float-panel-body">
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <div style={{width:34,height:34,borderRadius:10,background:"linear-gradient(135deg,var(--purple),var(--accent))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>⚠</div>
        <div>
          <div style={{fontFamily:"var(--display)",fontSize:16,fontWeight:600,color:"var(--text)"}}>Pending Actions</div>
          <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--text-mid)"}}>Proposed by Hermes — nothing executes until you approve</div>
        </div>
      </div>

      {pendingActions.length === 0 && (
        <div style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--text-dim)",padding:"20px 0",textAlign:"center"}}>No actions currently awaiting approval.</div>
      )}

      {pendingActions.map(a => (
        <div key={a.id} style={{marginBottom:12,padding:14,background:"rgba(255,255,255,0.03)",border:"1px solid var(--border2)",borderLeft:"3px solid var(--purple)",borderRadius:"var(--radius-sm)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
            <span style={{fontFamily:"var(--mono)",fontSize:10,fontWeight:700,color:"var(--purple)",textTransform:"uppercase",letterSpacing:0.5}}>{a.action_type.replace(/_/g," ")}</span>
            <span style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--text-dim)"}}>#{a.id}</span>
          </div>
          <div style={{fontFamily:"var(--mono)",fontSize:12,color:"var(--text)",marginBottom:6,wordBreak:"break-word"}}>{a.target}</div>
          {a.reason && <div style={{fontFamily:"var(--sans)",fontSize:11,color:"var(--text-mid)",lineHeight:1.5,marginBottom:10}}>{a.reason}</div>}
          <div style={{display:"flex",gap:8}}>
            <button
              disabled={actionsBusy===a.id}
              onClick={()=>approveAction(a.id)}
              style={{flex:1,padding:"8px",background:"var(--green-dim)",border:"1px solid var(--green)",borderRadius:8,color:"var(--green)",fontFamily:"var(--mono)",fontSize:9,fontWeight:700,letterSpacing:1,cursor:actionsBusy===a.id?"not-allowed":"pointer",opacity:actionsBusy===a.id?0.5:1,textTransform:"uppercase"}}
            >{actionsBusy===a.id ? "..." : "✓ Approve"}</button>
            <button
              disabled={actionsBusy===a.id}
              onClick={()=>rejectAction(a.id)}
              style={{flex:1,padding:"8px",background:"var(--red-dim)",border:"1px solid var(--red)",borderRadius:8,color:"var(--red)",fontFamily:"var(--mono)",fontSize:9,fontWeight:700,letterSpacing:1,cursor:actionsBusy===a.id?"not-allowed":"pointer",opacity:actionsBusy===a.id?0.5:1,textTransform:"uppercase"}}
            >{actionsBusy===a.id ? "..." : "✕ Reject"}</button>
          </div>
        </div>
      ))}
    </div>
  </div>,
  document.body
)}

      <SiraVoice isOpen={didOpen} onClose={()=>setDidOpen(false)}/>
    </>
    </HermesProvider>
  );
}