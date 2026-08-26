import React, { useState, useEffect, useCallback } from "react";
import { db } from "./firebase";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  writeBatch,
} from "firebase/firestore";

// ── HELPERS ──────────────────────────────────────────────────────────────────
function formatDate(ts) {
  if (!ts) return "—";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(ts) {
  if (!ts) return "";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatRelative(ts) {
  if (!ts) return "";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function modelChip(model) {
  const map = {
    ollama:      { label: "SIRA LOCAL",    color: "var(--green)" },
    ollama_phi3: { label: "PHI3 LOCAL",    color: "var(--green)" },
    groq:        { label: "GROQ CLOUD",    color: "var(--orange)" },
    gemini:      { label: "GEMINI CLOUD",  color: "var(--purple)" },
    mistral:     { label: "MISTRAL CLOUD", color: "var(--accent)" },
  };
  return map[model] || { label: model?.toUpperCase() || "AI", color: "var(--text-mid)" };
}

function parseSiraResponse(text) {
  const sections = ["SUMMARY", "THREAT DETAILS", "WHAT THIS MEANS", "RISK ASSESSMENT", "RECOMMENDED ACTIONS"];
  const result = [];
  for (let i = 0; i < sections.length; i++) {
    const current = sections[i];
    const next = sections[i + 1];
    const startIdx = text.indexOf(current + ":");
    if (startIdx === -1) continue;
    const contentStart = startIdx + current.length + 1;
    const endIdx = next ? text.indexOf(next + ":") : text.length;
    const content = text.slice(contentStart, endIdx !== -1 ? endIdx : undefined).replace(/^[\s-]+/, "").trim();
    result.push({ heading: current, content });
  }
  return result.length > 0 ? result : null;
}

function getRiskBadge(text) {
  if (/CRITICAL/i.test(text)) return { label: "CRITICAL", cls: "risk-critical" };
  if (/HIGH/i.test(text)) return { label: "HIGH", cls: "risk-high" };
  if (/MEDIUM/i.test(text)) return { label: "MEDIUM", cls: "risk-medium" };
  if (/LOW/i.test(text)) return { label: "LOW", cls: "risk-low" };
  return null;
}

function groupSessionsByDate(sessions) {
  const groups = {};
  sessions.forEach(s => {
    const d = s.updated_at?.toDate ? s.updated_at.toDate() : new Date(s.updated_at);
    const now = new Date();
    const diffDays = Math.floor((now - d) / 86400000);
    let label;
    if (diffDays === 0) label = "Today";
    else if (diffDays === 1) label = "Yesterday";
    else if (diffDays < 7) label = "This Week";
    else if (diffDays < 30) label = "This Month";
    else label = "Older";
    if (!groups[label]) groups[label] = [];
    groups[label].push(s);
  });
  return groups;
}

// \u2500\u2500 ICONS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const IconSearch = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)", flexShrink: 0 }}>
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const IconTrash = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
const IconX = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconChat = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);
const IconChatLarge = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

// ── CSS ───────────────────────────────────────────────────────────────────────
const css = `
  .hist-root { display:flex; height:100%; width:100%; overflow:hidden; background:transparent; font-family:var(--sans,Inter,sans-serif); gap:12px; padding:12px; box-sizing:border-box; }

  /* ── Sidebar ── */
  .hist-sidebar {
    width:300px; min-width:300px; display:flex; flex-direction:column; overflow:hidden;
    background:linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015));
    backdrop-filter:blur(20px) saturate(150%); -webkit-backdrop-filter:blur(20px) saturate(150%);
    border:1px solid var(--border2); border-radius:var(--radius,18px);
    box-shadow:0 1px 0 rgba(255,255,255,0.05) inset, 0 12px 28px -18px rgba(0,0,0,0.5);
  }
  .hist-sidebar-head { padding:18px 18px 14px; flex-shrink:0; }
  .hist-sidebar-title { font-size:15px; font-weight:700; color:var(--text); margin-bottom:2px; }
  .hist-sidebar-sub { font-size:11px; color:var(--text-mid); margin-bottom:14px; }
  .hist-search-wrap { display:flex; align-items:center; gap:8px; background:rgba(255,255,255,0.04); border:1px solid var(--border2); border-radius:8px; padding:8px 11px; transition:border-color 0.2s; }
  .hist-search-wrap:focus-within { border-color:var(--accent); }
  .hist-search { flex:1; background:transparent; border:none; outline:none; color:var(--text); font-family:var(--sans,Inter,sans-serif); font-size:12px; }
  .hist-search::placeholder { color:var(--text-dim); }
  .hist-clear-all {
    margin-top:10px; width:100%; display:flex; align-items:center; justify-content:center; gap:6px;
    background:transparent; border:1px solid rgba(225,85,84,0.25); color:var(--red);
    font-family:var(--sans,Inter,sans-serif); font-size:11px; font-weight:500;
    padding:8px; border-radius:8px; cursor:pointer; transition:all 0.15s;
  }
  .hist-clear-all:hover { background:var(--red-dim); border-color:var(--red); }

  .hist-session-list { flex:1; overflow-y:auto; padding:4px 12px 12px; }
  .hist-session-list::-webkit-scrollbar { width:3px; }
  .hist-session-list::-webkit-scrollbar-thumb { background:var(--border2); border-radius:3px; }
  .hist-group-label { font-family:var(--mono,monospace); font-size:9px; letter-spacing:1.8px; color:var(--text-dim); text-transform:uppercase; padding:14px 4px 7px; }

  .hist-session-item {
    display:flex; align-items:flex-start; gap:10px; padding:12px; margin-bottom:8px;
    cursor:pointer; transition:all 0.15s; position:relative; border-radius:10px;
    background:rgba(255,255,255,0.03); border:1px solid var(--border);
  }
  .hist-session-item:hover { background:rgba(255,255,255,0.06); border-color:var(--border2); }
  .hist-session-item.active { background:var(--accent-dim); border-color:var(--accent); }
  .hist-session-icon {
    width:32px; height:32px; border-radius:9px; flex-shrink:0;
    background:rgba(255,255,255,0.05); border:1px solid var(--border2);
    display:flex; align-items:center; justify-content:center; font-size:13px; color:var(--text-mid);
  }
  .hist-session-item.active .hist-session-icon { background:var(--accent-dim); border-color:var(--accent); color:var(--accent); }
  .hist-session-info { flex:1; min-width:0; }
  .hist-session-name { font-size:12.5px; font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:5px; }
  .hist-session-meta { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
  .hist-mdot { width:5px; height:5px; border-radius:50%; flex-shrink:0; }
  .hist-session-time { font-family:var(--mono,monospace); font-size:10px; color:var(--text-dim); }
  .hist-session-count { font-family:var(--mono,monospace); font-size:9px; color:var(--text-dim); background:rgba(255,255,255,0.04); border:1px solid var(--border); padding:2px 7px; border-radius:20px; }
  .hist-del-btn {
    position:absolute; right:8px; top:10px; background:rgba(255,255,255,0.04);
    border:1px solid var(--border2); color:var(--text-dim); cursor:pointer;
    width:24px; height:24px; border-radius:6px; opacity:0; transition:all 0.15s;
    display:flex; align-items:center; justify-content:center;
  }
  .hist-session-item:hover .hist-del-btn { opacity:1; }
  .hist-del-btn:hover { background:var(--red-dim); color:var(--red); border-color:rgba(225,85,84,0.4); }
  .hist-empty-sidebar { padding:44px 20px; text-align:center; font-size:12px; color:var(--text-mid); line-height:1.8; white-space:pre-line; }

  /* ── Main panel ── */
  .hist-main {
    flex:1; display:flex; flex-direction:column; overflow:hidden; min-width:0;
    background:linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015));
    backdrop-filter:blur(20px) saturate(150%); -webkit-backdrop-filter:blur(20px) saturate(150%);
    border:1px solid var(--border2); border-radius:var(--radius,18px);
    box-shadow:0 1px 0 rgba(255,255,255,0.05) inset, 0 12px 28px -18px rgba(0,0,0,0.5);
  }
  .hist-main-head { padding:18px 22px 16px; border-bottom:1px solid var(--border); display:flex; align-items:flex-start; gap:12px; flex-shrink:0; }
  .hist-main-title { font-size:17px; font-weight:700; color:var(--text); line-height:1.3; }
  .hist-main-sub { font-family:var(--mono,monospace); font-size:11px; color:var(--text-dim); margin-top:5px; }
  .hist-head-right { margin-left:auto; display:flex; align-items:center; gap:10px; flex-shrink:0; }
  .hist-model-chip { font-family:var(--mono,monospace); font-size:9.5px; padding:5px 11px; border-radius:20px; letter-spacing:0.6px; }
  .hist-count-label { font-family:var(--mono,monospace); font-size:10px; color:var(--text-dim); letter-spacing:0.5px; }
  .hist-del-session-btn {
    display:flex; align-items:center; gap:6px;
    font-family:var(--sans,Inter,sans-serif); font-size:11px; font-weight:500;
    padding:7px 13px; border-radius:8px; border:1px solid rgba(225,85,84,0.25);
    background:transparent; color:var(--red); cursor:pointer; transition:all 0.15s;
  }
  .hist-del-session-btn:hover { background:var(--red-dim); border-color:var(--red); }

  .hist-msgs { flex:1; overflow-y:auto; padding:22px; display:flex; flex-direction:column; gap:18px; }
  .hist-msgs::-webkit-scrollbar { width:3px; }
  .hist-msgs::-webkit-scrollbar-thumb { background:var(--border2); border-radius:3px; }
  .hist-date-sep { display:flex; align-items:center; gap:12px; margin:6px 0; }
  .hist-date-line { flex:1; height:1px; background:var(--border); }
  .hist-date-lbl { font-family:var(--mono,monospace); font-size:9.5px; letter-spacing:1.6px; color:var(--text-dim); text-transform:uppercase; }

  .hist-msg { display:flex; }
  .hist-msg.user { justify-content:flex-end; }
  .hist-bwrap { display:flex; flex-direction:column; max-width:74%; }
  .hist-msg.user .hist-bwrap { align-items:flex-end; }
  .hist-bubble { padding:14px 17px; font-size:12.5px; line-height:1.8; border-radius:14px; }
  .hist-msg.ai .hist-bubble {
    background:rgba(255,255,255,0.04); border:1px solid var(--border2);
    border-left:2px solid var(--accent); color:var(--text);
    border-radius:4px 14px 14px 14px;
  }
  .hist-msg.user .hist-bubble {
    background:var(--accent-dim); border:1px solid var(--accent-glow); color:var(--text);
    border-radius:14px 14px 4px 14px;
  }

  .hist-sira-sec { margin-bottom:14px; }
  .hist-sira-sec:last-child { margin-bottom:0; }
  .hist-sira-head { font-family:var(--mono,monospace); font-size:9.5px; font-weight:700; letter-spacing:1.8px; text-transform:uppercase; margin-bottom:7px; display:flex; align-items:center; gap:7px; }
  .hist-sira-head.sum { color:var(--accent); }
  .hist-sira-head.thr { color:var(--red); }
  .hist-sira-head.means { color:var(--purple); }
  .hist-sira-head.risk { color:var(--orange); }
  .hist-sira-head.act { color:var(--green); }
  .hist-sira-body { font-size:12.5px; line-height:1.8; color:var(--text-mid); white-space:pre-wrap; }
  .hist-rbadge { font-family:var(--mono,monospace); font-size:9px; padding:2px 8px; border-radius:20px; font-weight:700; letter-spacing:0.8px; }
  .risk-critical,.risk-high { background:var(--red-dim); color:var(--red); border:1px solid rgba(225,85,84,0.3); }
  .risk-medium { background:var(--orange-dim); color:var(--orange); border:1px solid rgba(232,184,77,0.3); }
  .risk-low { background:var(--green-dim); color:var(--green); border:1px solid rgba(34,217,122,0.3); }

  .hist-msg-meta { display:flex; align-items:center; gap:10px; margin-top:7px; font-family:var(--mono,monospace); font-size:9.5px; color:var(--text-dim); }
  .hist-msg.user .hist-msg-meta { justify-content:flex-end; }
  .hist-copy-btn { background:none; border:none; color:var(--text-dim); cursor:pointer; font-family:var(--mono,monospace); font-size:9.5px; padding:0; transition:color 0.15s; }
  .hist-copy-btn:hover { color:var(--accent); }

  .hist-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; }
  .hist-empty-icon { color:var(--text-dim); opacity:0.5; }
  .hist-empty-title { font-size:14px; font-weight:600; color:var(--text-mid); }
  .hist-empty-sub { font-size:12px; color:var(--text-dim); text-align:center; max-width:300px; line-height:1.75; }

  .hist-spinner { width:26px; height:26px; border:2px solid var(--border2); border-top-color:var(--accent); border-radius:50%; animation:hspin 0.8s linear infinite; }
  @keyframes hspin { to { transform:rotate(360deg); } }

  .hist-stats-bar { display:flex; align-items:center; gap:20px; padding:12px 22px; border-top:1px solid var(--border); flex-shrink:0; }
  .hist-stat-item { display:flex; align-items:center; gap:7px; font-family:var(--mono,monospace); font-size:10px; color:var(--text-dim); letter-spacing:0.5px; }
  .hist-stat-val { color:var(--accent); font-weight:700; }

  .hist-confirm-overlay { position:fixed; inset:0; background:rgba(4,6,10,0.7); z-index:200; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(6px); }
  .hist-confirm-box {
    background:linear-gradient(180deg, rgba(30,30,34,0.95), rgba(20,20,24,0.95));
    backdrop-filter:blur(28px) saturate(160%); -webkit-backdrop-filter:blur(28px) saturate(160%);
    border:1px solid var(--border2); border-radius:var(--radius,18px);
    padding:26px; width:380px; text-align:center;
    box-shadow:0 1px 0 rgba(255,255,255,0.06) inset, 0 30px 70px -20px rgba(0,0,0,0.6);
  }
  .hist-confirm-title { font-size:16px; font-weight:700; color:var(--text); margin-bottom:8px; }
  .hist-confirm-sub { font-size:12.5px; color:var(--text-mid); line-height:1.75; margin-bottom:22px; }
  .hist-confirm-btns { display:flex; gap:10px; }
  .hist-confirm-cancel { flex:1; padding:11px; border-radius:9px; cursor:pointer; background:rgba(255,255,255,0.04); border:1px solid var(--border2); color:var(--text-mid); font-family:var(--sans,Inter,sans-serif); font-size:12px; font-weight:500; transition:all 0.15s; }
  .hist-confirm-cancel:hover { background:rgba(255,255,255,0.08); }
  .hist-confirm-delete { flex:1; padding:11px; border-radius:9px; cursor:pointer; background:var(--red); border:none; color:#fff; font-family:var(--sans,Inter,sans-serif); font-size:12px; font-weight:700; transition:all 0.15s; }
  .hist-confirm-delete:hover { opacity:0.9; }

  .hist-toast { position:fixed; bottom:80px; right:24px; background:var(--panel); border:1px solid var(--accent); color:var(--accent); font-family:var(--mono,monospace); font-size:11px; padding:10px 18px; border-radius:10px; letter-spacing:0.5px; z-index:9999; box-shadow:0 4px 24px -6px var(--accent-glow); animation:hfadeIn 0.2s ease; }
  @keyframes hfadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
`;

// ── SIRA MESSAGE ─────────────────────────────────────────────────────────────
function SiraMessageBubble({ text }) {
  const sections = parseSiraResponse(text);
  const headingCls = {
    "SUMMARY": "sum", "THREAT DETAILS": "thr",
    "WHAT THIS MEANS": "means", "RISK ASSESSMENT": "risk", "RECOMMENDED ACTIONS": "act"
  };
  if (!sections) {
    return (
      <div className="hist-bubble">
        <div style={{ fontFamily: "var(--mono,monospace)", fontSize: 10, color: "var(--text-mid)", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
          {text}
        </div>
      </div>
    );
  }
  return (
    <div className="hist-bubble">
      {sections.map((s, i) => {
        const badge = s.heading === "RISK ASSESSMENT" ? getRiskBadge(s.content) : null;
        return (
          <div key={i} className="hist-sira-sec">
            <div className={`hist-sira-head ${headingCls[s.heading] || ""}`}>
              ▸ {s.heading}
              {badge && <span className={`hist-rbadge ${badge.cls}`}>{badge.label}</span>}
            </div>
            <div className="hist-sira-body">{s.content}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function History() {
  const [sessions, setSessions]           = useState([]);
  const [filteredSessions, setFiltered]   = useState([]);
  const [activeSession, setActive]        = useState(null);
  const [messages, setMessages]           = useState([]);
  const [loading, setLoading]             = useState(false);
  const [msgLoading, setMsgLoading]       = useState(false);
  const [search, setSearch]               = useState("");
  const [toast, setToast]                 = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const toastRef = React.useRef(null);

  const username = localStorage.getItem("username") || "";

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // ── Load sessions from Firestore ─────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, "soc_sessions"),
        where("username", "==", username),
        orderBy("updated_at", "desc")
      );
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setSessions(data);
    } catch (e) {
      console.error("Load sessions error:", e);
      showToast("Could not load history");
    }
    setLoading(false);
  }, [username, showToast]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── Filter sessions ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!search.trim()) { setFiltered(sessions); return; }
    const q = search.toLowerCase();
    setFiltered(sessions.filter(s => s.title?.toLowerCase().includes(q)));
  }, [sessions, search]);

  // ── Load messages for a session ───────────────────────────────────────────
  const loadMessages = useCallback(async (sessionId) => {
    setActive(sessionId);
    setMsgLoading(true);
    setMessages([]);
    try {
      const q = query(
        collection(db, "soc_messages"),
        where("session_id", "==", sessionId),
        where("username", "==", username),
        orderBy("created_at", "asc")
      );
      const snap = await getDocs(q);
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Load messages error:", e);
      showToast("Could not load messages");
    }
    setMsgLoading(false);
  }, [username, showToast]);

  // ── Delete a session ──────────────────────────────────────────────────────
  const deleteSession = async (sessionId) => {
    try {
      const batch = writeBatch(db);
      // Delete session doc
      batch.delete(doc(db, "soc_sessions", sessionId));
      // Delete all messages of this session
      const q = query(
        collection(db, "soc_messages"),
        where("session_id", "==", sessionId),
        where("username", "==", username)
      );
      const snap = await getDocs(q);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (activeSession === sessionId) { setActive(null); setMessages([]); }
      showToast("Session deleted");
    } catch (e) {
      showToast("Delete failed");
    }
    setConfirmDelete(null);
  };

  // ── Clear all history ─────────────────────────────────────────────────────
  const clearAll = async () => {
    try {
      const batch = writeBatch(db);
      // Delete all sessions
      const sq = query(collection(db, "soc_sessions"), where("username", "==", username));
      const sSnap = await getDocs(sq);
      sSnap.docs.forEach(d => batch.delete(d.ref));
      // Delete all messages
      const mq = query(collection(db, "soc_messages"), where("username", "==", username));
      const mSnap = await getDocs(mq);
      mSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      setSessions([]);
      setActive(null);
      setMessages([]);
      showToast("All history cleared");
    } catch (e) {
      showToast("Clear failed");
    }
    setConfirmDelete(null);
  };

  const totalMessages = sessions.reduce((a, s) => a + (s.message_count || 0), 0);
  const activeSessionObj = sessions.find(s => s.id === activeSession);
  const chip = activeSessionObj ? modelChip(activeSessionObj.model_used) : null;
  const groups = groupSessionsByDate(filteredSessions);

  return (
    <>
      <style>{css}</style>
      {toast && <div className="hist-toast">✓ {toast.toUpperCase()}</div>}

      {confirmDelete && (
        <div className="hist-confirm-overlay">
          <div className="hist-confirm-box">
            <div className="hist-confirm-title">
              {confirmDelete === "all" ? "Clear All History?" : "Delete Session?"}
            </div>
            <div className="hist-confirm-sub">
              {confirmDelete === "all"
                ? "All sessions and messages will be permanently deleted."
                : "This session and all its messages will be deleted."}
            </div>
            <div className="hist-confirm-btns">
              <button className="hist-confirm-cancel" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="hist-confirm-delete"
                onClick={() => confirmDelete === "all" ? clearAll() : deleteSession(confirmDelete)}>
                {confirmDelete === "all" ? "Clear All" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="hist-root">

        {/* ── SIDEBAR ── */}
        <aside className="hist-sidebar">
          <div className="hist-sidebar-head">
            <div className="hist-sidebar-title">Chat History</div>
            <div className="hist-sidebar-sub">
              {sessions.length === 0
                ? "No sessions yet"
                : `${sessions.length} session${sessions.length === 1 ? "" : "s"} \u00b7 ${totalMessages} message${totalMessages === 1 ? "" : "s"}`}
            </div>
            <div className="hist-search-wrap">
              <IconSearch />
              <input className="hist-search" placeholder="Search sessions..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {sessions.length > 0 && (
              <button className="hist-clear-all" onClick={() => setConfirmDelete("all")}>
                <IconTrash /> Clear All History
              </button>
            )}
          </div>

          <div className="hist-session-list">
            {loading && (
              <div style={{ display: "flex", justifyContent: "center", padding: 28 }}>
                <div className="hist-spinner" />
              </div>
            )}
            {!loading && filteredSessions.length === 0 && (
              <div className="hist-empty-sidebar">
                {search ? "No sessions match your search." : "No chat history yet.\nStart a conversation with SIRA!"}
              </div>
            )}
            {!loading && Object.entries(groups).map(([label, groupSessions]) => (
              <div key={label}>
                <div className="hist-group-label">{label}</div>
                {groupSessions.map(s => {
                  const c = modelChip(s.model_used);
                  return (
                    <div key={s.id}
                      className={`hist-session-item ${activeSession === s.id ? "active" : ""}`}
                      onClick={() => loadMessages(s.id)}>
                      <div className="hist-session-icon"><IconChat /></div>
                      <div className="hist-session-info">
                        <div className="hist-session-name">{s.title || "Security Analysis"}</div>
                        <div className="hist-session-meta">
                          <div className="hist-mdot" style={{ background: c.color }} />
                          <span className="hist-session-time">{formatRelative(s.updated_at)}</span>
                          <span className="hist-session-count">{s.message_count || 0} msgs</span>
                        </div>
                      </div>
                      <button className="hist-del-btn" title="Delete session"
                        onClick={e => { e.stopPropagation(); setConfirmDelete(s.id); }}><IconX /></button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>

        {/* ── MAIN ── */}
        <div className="hist-main">
          <div className="hist-main-head">
            {activeSessionObj ? (
              <>
                <div>
                  <div className="hist-main-title">{activeSessionObj.title || "Security Analysis"}</div>
                  <div className="hist-main-sub">{formatDate(activeSessionObj.created_at)} · {formatTime(activeSessionObj.created_at)}</div>
                </div>
                <div className="hist-head-right">
                  {chip && (
                    <div className="hist-model-chip"
                      style={{ border: `1px solid ${chip.color}33`, background: `${chip.color}14`, color: chip.color }}>
                      {chip.label}
                    </div>
                  )}
                  <div className="hist-count-label">{messages.length} MESSAGES</div>
                  <button className="hist-del-session-btn" onClick={() => setConfirmDelete(activeSession)}>
                    <IconTrash /> Delete
                  </button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="hist-main-title">History</div>
                  <div className="hist-main-sub">Select a session to view messages</div>
                </div>
                <div className="hist-head-right">
                  <div className="hist-count-label">{sessions.length} SESSIONS · {totalMessages} MESSAGES</div>
                </div>
              </>
            )}
          </div>

          {/* Messages */}
          <div className="hist-msgs">
            {msgLoading && (
              <div style={{ display: "flex", justifyContent: "center", paddingTop: 50 }}>
                <div className="hist-spinner" />
              </div>
            )}
            {!msgLoading && !activeSession && (
              <div className="hist-empty">
                <div className="hist-empty-icon"><IconChatLarge /></div>
                <div className="hist-empty-title">No session selected</div>
                <div className="hist-empty-sub">Pick a session from the left to review your past conversations with SIRA.</div>
              </div>
            )}
            {!msgLoading && activeSession && messages.length === 0 && (
              <div className="hist-empty">
                <div className="hist-empty-icon"><IconChatLarge /></div>
                <div className="hist-empty-title">No messages</div>
                <div className="hist-empty-sub">This session has no recorded messages.</div>
              </div>
            )}
            {!msgLoading && messages.length > 0 && (() => {
              let lastDate = null;
              return messages.map((m, i) => {
                const msgDate = formatDate(m.created_at);
                const showSep = msgDate !== lastDate;
                lastDate = msgDate;
                return (
                  <React.Fragment key={i}>
                    {showSep && (
                      <div className="hist-date-sep">
                        <div className="hist-date-line" />
                        <div className="hist-date-lbl">{msgDate}</div>
                        <div className="hist-date-line" />
                      </div>
                    )}
                    <div className={`hist-msg ${m.role}`}>
                      <div className="hist-bwrap">
                        {m.role === "ai"
                          ? <SiraMessageBubble text={m.message} />
                          : <div className="hist-bubble">{m.message}</div>
                        }
                        <div className="hist-msg-meta">
                          <span>{formatTime(m.created_at)}</span>
                          {m.role === "ai" && (
                            <>
                              <span style={{ color: "var(--accent)", letterSpacing: 1 }}>
                                ⬡ {modelChip(m.model_used).label}
                              </span>
                              <button className="hist-copy-btn"
                                onClick={() => { navigator.clipboard.writeText(m.message); showToast("Copied"); }}>
                                COPY
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              });
            })()}
          </div>

          {/* Stats bar */}
          <div className="hist-stats-bar">
            <div className="hist-stat-item">SESSIONS <span className="hist-stat-val">{sessions.length}</span></div>
            <div className="hist-stat-item">MESSAGES <span className="hist-stat-val">{totalMessages}</span></div>
            <div className="hist-stat-item">OLDEST <span className="hist-stat-val">
              {sessions.length > 0 ? formatDate(sessions[sessions.length - 1]?.created_at) : "—"}
            </span></div>
          </div>
        </div>
      </div>
    </>
  );
}