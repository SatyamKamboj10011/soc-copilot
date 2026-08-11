import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { auth, googleProvider } from "./firebase";
import { signInWithPopup } from "firebase/auth";

const TICKER_LINES = [
  "SURICATA :: signature match — logged",
  "ZEEK :: conn.log correlation — no anomaly",
  "HERMES :: agent idle — awaiting case",
  "ABUSEIPDB :: reputation check — clear",
  "NVD :: CVE feed synced",
];

function ScanReticle({ scanning, size = 96 }) {
  return (
    <div style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(41,211,255,0.15)" strokeWidth="1" />
        <circle cx="50" cy="50" r="34" fill="none" stroke="rgba(41,211,255,0.12)" strokeWidth="1" />
        <motion.circle
          cx="50" cy="50" r="46" fill="none" stroke="#29D3FF" strokeWidth="2"
          strokeDasharray="60 229" strokeLinecap="round"
          animate={{ rotate: 360 }}
          transition={{ duration: scanning ? 1 : 4.5, repeat: Infinity, ease: "linear" }}
          style={{ transformOrigin: "50px 50px" }}
        />
        <motion.circle cx="50" cy="50" r="3.5" fill="#29D3FF"
          animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 2, repeat: Infinity }} />
      </svg>
    </div>
  );
}

export default function Login() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleGoogle = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      localStorage.setItem("token", await result.user.getIdToken());
      localStorage.setItem("username", result.user.displayName || result.user.email.split("@")[0]);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message.replace("Firebase: ", "").replace(/\(auth.*\)/, "").trim());
    }
    setLoading(false);
  };

  return (
    <div className="lg-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .lg-root { min-height:100vh; display:flex; background:#060A11; font-family:'Inter',sans-serif; }

        .lg-left { flex:1.15; position:relative; overflow:hidden; display:none; }
        @media (min-width: 900px) { .lg-left { display:block; } }
        .lg-video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:70% 40%; z-index:0; }
        .lg-left-overlay { position:absolute; inset:0; z-index:1;
          background: linear-gradient(180deg, rgba(6,10,17,0.55) 0%, rgba(6,10,17,0.25) 40%, rgba(6,10,17,0.92) 100%); }
        .lg-left-content { position:relative; z-index:2; height:100%; display:flex; flex-direction:column;
          justify-content:space-between; padding:48px; }

        .lg-left-brand { display:flex; align-items:center; gap:10px; }
        .lg-left-brand-mark { width:34px; height:34px; background:rgba(10,18,28,0.6); border:1.5px solid #29D3FF;
          clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
          display:flex; align-items:center; justify-content:center; }
        .lg-left-brand-name { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:16px; letter-spacing:1.5px; color:#F2F6FA; }

        .lg-left-center { display:flex; flex-direction:column; align-items:flex-start; }
        .lg-left-tagline { font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:26px; line-height:1.3;
          color:#F2F6FA; margin:22px 0 10px; max-width:360px; }
        .lg-left-sub { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.1em; color:#22D97A; }

        .lg-stats-row { display:flex; gap:32px; }
        .lg-stat-num { font-family:'Space Grotesk',sans-serif; font-size:24px; font-weight:700; color:#29D3FF; }
        .lg-stat-label { font-family:'IBM Plex Mono',monospace; font-size:9px; color:#7C93A6; letter-spacing:1px; margin-top:2px; }

        .lg-left-ticker-wrap { position:absolute; left:0; right:0; bottom:0; z-index:2; height:32px; overflow:hidden;
          border-top:1px solid rgba(41,211,255,0.15); background:rgba(6,10,17,0.55); backdrop-filter:blur(4px);
          display:flex; align-items:center; }
        .lg-ticker { display:flex; gap:44px; white-space:nowrap; animation:lg-scroll 30s linear infinite; padding-left:100%; }
        @keyframes lg-scroll { from{ transform:translateX(0); } to{ transform:translateX(-100%); } }
        .lg-ticker span { font-family:'IBM Plex Mono',monospace; font-size:9.5px; color:#5C7488; }

        .lg-right { flex:1; display:flex; align-items:center; justify-content:center; padding:40px 24px; }
        .lg-card { width:100%; max-width:400px; position:relative; border:1px solid #163B57; border-radius:16px;
          padding:44px 36px; background:rgba(12,21,32,0.55); backdrop-filter:blur(14px);
          box-shadow:0 24px 60px -20px rgba(0,0,0,0.6); }
        .lg-card::before, .lg-card::after { content:''; position:absolute; width:18px; height:18px;
          border-color:#29D3FF; border-style:solid; opacity:.6; pointer-events:none; }
        .lg-card::before { top:-1px; left:-1px; border-width:1.5px 0 0 1.5px; border-radius:16px 0 0 0; }
        .lg-card::after { bottom:-1px; right:-1px; border-width:0 1.5px 1.5px 0; border-radius:0 0 16px 0; }

        .lg-mobile-brand { display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:28px; }
        @media (min-width: 900px) { .lg-mobile-brand { display:none; } }

        .lg-reticle-wrap { display:flex; justify-content:center; margin-bottom:22px; }

        .lg-form-head { text-align:center; margin-bottom:32px; }
        .lg-form-title { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:22px; color:#F2F6FA; margin-bottom:8px; }
        .lg-form-sub { font-size:13px; color:#8FA3B5; line-height:1.6; }

        .lg-google { width:100%; padding:15px; background:#F2F6FA; border:none; border-radius:8px;
          color:#0C1520; font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:14px; cursor:pointer;
          display:flex; align-items:center; justify-content:center; gap:11px; transition:all .2s; }
        .lg-google:hover:not(:disabled) { background:#FFFFFF; transform:translateY(-1px); box-shadow:0 8px 24px -8px rgba(41,211,255,0.35); }
        .lg-google:active:not(:disabled) { transform:translateY(0); }
        .lg-google:disabled { opacity:.6; cursor:not-allowed; }
        .lg-google:focus-visible { outline:2px solid #29D3FF; outline-offset:2px; }

        .lg-error { margin-top:16px; background:rgba(225,85,84,0.12); border:1px solid rgba(225,85,84,0.4); border-radius:8px;
          padding:11px 13px; font-size:12px; color:#FF8080; font-family:'IBM Plex Mono',monospace; }

        .lg-fine-print { text-align:center; font-size:11px; color:#4C6478; margin-top:22px; line-height:1.6;
          font-family:'IBM Plex Mono',monospace; letter-spacing:.02em; }

        .lg-back-link { position:absolute; top:28px; left:28px; z-index:3; font-family:'IBM Plex Mono',monospace;
          font-size:11px; letter-spacing:.08em; color:#8FA3B5; text-decoration:none; display:flex; align-items:center; gap:6px; }
        .lg-back-link:hover { color:#29D3FF; }

        @media (prefers-reduced-motion: reduce) {
          .lg-left circle, .lg-ticker { animation:none !important; }
        }
      `}</style>

      <a className="lg-back-link" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
        ← Back to SIRA
      </a>

      <div className="lg-left">
        <video className="lg-video" autoPlay muted loop playsInline src="/robot-face.mp4" aria-hidden="true" />
        <div className="lg-left-overlay" />
        <div className="lg-left-content">
          <motion.div className="lg-left-brand" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="lg-left-brand-mark"><span style={{ color: "#29D3FF", fontSize: 15 }}>⬡</span></div>
            <span className="lg-left-brand-name">SIRA v4</span>
          </motion.div>

          <motion.div className="lg-left-center" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}>
            <ScanReticle scanning={loading} />
            <h1 className="lg-left-tagline">Every session starts with a live system check.</h1>
            <div className="lg-left-sub">SOC ACCESS TERMINAL — MONITORING ACTIVE</div>
          </motion.div>

          <motion.div className="lg-stats-row" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.35 }}>
            <div><div className="lg-stat-num">22,847</div><div className="lg-stat-label">EVENTS MONITORED</div></div>
            <div><div className="lg-stat-num">2</div><div className="lg-stat-label">SENSORS ONLINE</div></div>
            <div><div className="lg-stat-num">6</div><div className="lg-stat-label">AGENT TOOLS</div></div>
          </motion.div>
        </div>

        <div className="lg-left-ticker-wrap" aria-hidden="true">
          <div className="lg-ticker">
            {[...TICKER_LINES, ...TICKER_LINES].map((line, i) => <span key={i}>{line}</span>)}
          </div>
        </div>
      </div>

      <div className="lg-right">
        <motion.div
          className="lg-card"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="lg-mobile-brand">
            <div className="lg-left-brand-mark"><span style={{ color: "#29D3FF", fontSize: 15 }}>⬡</span></div>
            <span className="lg-left-brand-name">SIRA v4</span>
          </div>

          <div className="lg-reticle-wrap">
            <ScanReticle scanning={loading} size={64} />
          </div>

          <div className="lg-form-head">
            <h2 className="lg-form-title">Analyst Access</h2>
            <div className="lg-form-sub">Sign in with your Google account to open the queue.</div>
          </div>

          <button className="lg-google" onClick={handleGoogle} disabled={loading}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            {loading ? "Authenticating…" : "Continue with Google"}
          </button>

          {error && <div className="lg-error" role="alert" aria-live="polite">⚠ {error}</div>}

          <p className="lg-fine-print">No separate account needed — access is tied to your Google identity.</p>
        </motion.div>
      </div>
    </div>
  );
}
