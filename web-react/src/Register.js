import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { auth, googleProvider } from "./firebase";
import { createUserWithEmailAndPassword, signInWithPopup } from "firebase/auth";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (delay = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] } }),
};

const STATS = [
  { value: "22,847", label: "EVENTS MONITORED" },
  { value: "2", label: "SENSORS ONLINE" },
  { value: "6", label: "AGENT TOOLS" },
];

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async () => {
    if (!email || !password) { setError("All fields required"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true); setError("");
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      localStorage.setItem("token", await result.user.getIdToken());
      localStorage.setItem("username", email.split("@")[0]);
      setSuccess("Account created — redirecting...");
      setTimeout(() => navigate("/dashboard"), 1500);
    } catch (err) {
      setError(err.message.replace("Firebase: ", "").replace(/\(auth.*\)/, "").trim());
    }
    setLoading(false);
  };

  const handleGoogle = async () => {
    setLoading(true); setError("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      localStorage.setItem("token", await result.user.getIdToken());
      localStorage.setItem("username", result.user.displayName || result.user.email.split("@")[0]);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message.replace("Firebase: ", "").trim());
    }
    setLoading(false);
  };

  return (
    <div className="reg-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .reg-root { min-height:100vh; display:flex; background:#060A11; color:#E9F1F7; font-family:'Inter',sans-serif; }

        /* ---------- left panel: visual side ---------- */
        .reg-left { position:relative; flex:0 0 51%; min-height:100vh; overflow:hidden; }
        .reg-video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
        .reg-left-overlay { position:absolute; inset:0;
          background:
            linear-gradient(180deg, rgba(6,10,17,0.35) 0%, rgba(6,10,17,0.15) 30%, rgba(6,10,17,0.55) 70%, rgba(6,10,17,0.95) 100%),
            linear-gradient(90deg, rgba(6,10,17,0.2) 0%, transparent 30%); }

        .reg-brand { position:absolute; top:28px; left:32px; z-index:2; display:flex; align-items:center; gap:10px;
          font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:15px; letter-spacing:.5px; }
        .reg-brand-mark { width:26px; height:26px; background:rgba(10,18,28,0.6); border:1.5px solid #29D3FF;
          clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
          display:flex; align-items:center; justify-content:center; }

        .reg-scan-ring { position:absolute; left:56px; top:270px; width:96px; height:96px; z-index:2;
          border:1px solid rgba(41,211,255,0.35); border-radius:50%; }
        .reg-scan-ring::before { content:''; position:absolute; top:-1px; left:-1px; width:14px; height:14px;
          border-radius:50%; background:#060A11; border:1px solid #29D3FF; }
        .reg-scan-dot { position:absolute; left:96px; top:308px; width:6px; height:6px; border-radius:50%;
          background:#29D3FF; box-shadow:0 0 10px #29D3FF; z-index:2; }

        .reg-left-copy { position:absolute; left:32px; right:32px; bottom:96px; z-index:2; }
        .reg-left-title { font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:clamp(24px, 2.4vw, 32px);
          line-height:1.2; margin:0 0 14px; max-width:420px; }
        .reg-left-status { font-family:'IBM Plex Mono',monospace; font-size:12px; letter-spacing:.06em; color:#8FA2B4; }
        .reg-left-status .accent { color:#22D97A; }

        .reg-stats { position:absolute; left:32px; right:32px; bottom:28px; z-index:2; display:flex; gap:44px; }
        .reg-stat-value { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:26px; color:#29D3FF; line-height:1; }
        .reg-stat-label { font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:.08em; color:#5A7185; margin-top:6px; }

        /* ---------- right panel: form side ---------- */
        .reg-right { flex:1; display:flex; align-items:center; justify-content:center; padding:40px 32px; background:#070B12; }
        .reg-form-wrap { width:100%; max-width:360px; }
        .reg-header { text-align:center; margin-bottom:28px; }
        .reg-title { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:24px; margin:0 0 8px; color:#E9F1F7; }
        .reg-subtitle { font-size:14px; color:#8FA2B4; margin:0; }

        .reg-form { display:flex; flex-direction:column; gap:16px; }
        .reg-field { display:flex; flex-direction:column; gap:8px; }
        .reg-label { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.06em; color:#29D3FF; }
        .reg-input { background:rgba(10,18,28,0.6); border:1px solid #12314A; border-radius:6px; padding:13px 15px;
          color:#E9F1F7; font-size:14px; font-family:'IBM Plex Mono',monospace; outline:none; transition:all .2s; width:100%; }
        .reg-input::placeholder { color:#3A5570; }
        .reg-input:focus { border-color:#29D3FF; box-shadow:0 0 0 3px rgba(41,211,255,0.12); }

        .reg-error { background:rgba(255,68,68,0.06); border:1px solid rgba(255,68,68,0.25); border-radius:5px;
          padding:11px 14px; font-size:12.5px; color:#FF7A7A; font-family:'IBM Plex Mono',monospace; }
        .reg-success { background:rgba(34,217,122,0.06); border:1px solid rgba(34,217,122,0.3); border-radius:5px;
          padding:11px 14px; font-size:12.5px; color:#22D97A; font-family:'IBM Plex Mono',monospace; }

        .reg-submit { font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:14.5px; color:#060A11;
          background:#29D3FF; border:none; border-radius:6px; padding:15px; cursor:pointer; width:100%; transition:all .2s; }
        .reg-submit:hover { background:#5CE0FF; }
        .reg-submit:disabled { opacity:.6; cursor:not-allowed; }

        .reg-or { display:flex; align-items:center; gap:12px; margin:2px 0; }
        .reg-or-line { flex:1; height:1px; background:#12314A; }
        .reg-or-text { font-family:'IBM Plex Mono',monospace; font-size:10.5px; color:#3A5570; letter-spacing:.1em; }

        .reg-google { background:transparent; border:1px solid #12314A; border-radius:6px; padding:13px;
          color:#E9F1F7; font-size:13.5px; font-family:'Inter',sans-serif; font-weight:500; cursor:pointer;
          width:100%; display:flex; align-items:center; justify-content:center; gap:10px; transition:all .2s; }
        .reg-google:hover { background:rgba(255,255,255,0.04); border-color:#29354A; }

        .reg-login-text { color:#5A7185; font-size:13.5px; text-align:center; margin:6px 0 0; }
        .reg-login-link { color:#29D3FF; cursor:pointer; text-decoration:underline; }

        @media (max-width: 900px) {
          .reg-left { display:none; }
          .reg-right { flex:1; }
        }
      `}</style>

      {/* ---------- left: visual panel ---------- */}
      <div className="reg-left">
        <video className="reg-video" autoPlay muted loop playsInline src="/robot-face.mp4" />
        <div className="reg-left-overlay" />

        <div className="reg-brand">
          <div className="reg-brand-mark"><span style={{ color: "#29D3FF", fontSize: 13 }}>⬡</span></div>
          SIRA v4
        </div>

        <div className="reg-scan-ring" />
        <div className="reg-scan-dot" />

        <motion.div className="reg-left-copy" initial="hidden" animate="show" custom={0.1} variants={fadeUp}>
          <h2 className="reg-left-title">Every investigation starts with a verified analyst.</h2>
          <div className="reg-left-status">
            SOC ACCESS TERMINAL — <span className="accent">REGISTRATION OPEN</span>
          </div>
        </motion.div>

        <motion.div className="reg-stats" initial="hidden" animate="show" custom={0.2} variants={fadeUp}>
          {STATS.map((s) => (
            <div key={s.label}>
              <div className="reg-stat-value">{s.value}</div>
              <div className="reg-stat-label">{s.label}</div>
            </div>
          ))}
        </motion.div>
      </div>

      {/* ---------- right: form panel ---------- */}
      <div className="reg-right">
        <motion.div className="reg-form-wrap" initial="hidden" animate="show" custom={0} variants={fadeUp}>
          <div className="reg-header">
            <h1 className="reg-title">Create Access</h1>
            <p className="reg-subtitle">Register to start your investigation.</p>
          </div>

          <div className="reg-form">
            <div className="reg-field">
              <label className="reg-label">Email</label>
              <input
                className="reg-input"
                placeholder="analyst@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="reg-field">
              <label className="reg-label">Password</label>
              <input
                className="reg-input"
                type="password"
                placeholder="Min 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRegister()}
              />
            </div>

            {error && <div className="reg-error">⚠ {error}</div>}
            {success && <div className="reg-success">✓ {success}</div>}

            <motion.button
              whileHover={{ scale: loading ? 1 : 1.02 }}
              whileTap={{ scale: loading ? 1 : 0.98 }}
              className="reg-submit"
              onClick={handleRegister}
              disabled={loading}
            >
              {loading ? "Creating account..." : "Create Account"}
            </motion.button>

            <div className="reg-or">
              <div className="reg-or-line" />
              <span className="reg-or-text">OR</span>
              <div className="reg-or-line" />
            </div>

            <motion.button
              whileHover={{ scale: loading ? 1 : 1.02 }}
              whileTap={{ scale: loading ? 1 : 0.98 }}
              className="reg-google"
              onClick={handleGoogle}
              disabled={loading}
            >
              <svg width="17" height="17" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Continue with Google
            </motion.button>

            <p className="reg-login-text">
              Already have access?{" "}
              <span className="reg-login-link" onClick={() => navigate("/login")}>Login →</span>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}