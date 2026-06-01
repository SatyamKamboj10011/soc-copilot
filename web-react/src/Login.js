import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { auth, googleProvider } from "./firebase";
import { signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";

export default function Login() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [authMode, setAuthMode] = useState("firebase");
  const [particles, setParticles] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const p = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      top: Math.random() * 100,
      size: Math.random() * 2 + 1,
      duration: Math.random() * 4 + 3,
      delay: Math.random() * 3,
    }));
    setParticles(p);
  }, []);

  const handleLogin = async () => {
    if (!email || !password) { setError("All fields required"); return; }
    setLoading(true); setError("");
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      localStorage.setItem("token", await result.user.getIdToken());
      localStorage.setItem("username", result.user.email.split("@")[0]);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message.replace("Firebase: ", "").replace(/\(auth.*\)/, "").trim());
    }
    setLoading(false);
  };

  const handleJwtLogin = async () => {
    if (!username || !password) { setError("All fields required"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("http://localhost:5000/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.token) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("username", data.username);
        navigate("/dashboard");
      } else {
        setError(data.error || "Login failed");
      }
    } catch {
      setError("Cannot connect to server");
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
    <div style={s.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;600;700&display=swap');
        @keyframes floatUp { 0%{transform:translateY(0);opacity:0.4} 50%{transform:translateY(-20px);opacity:1} 100%{transform:translateY(0);opacity:0.4} }
        @keyframes scanline { 0%{top:-10%} 100%{top:110%} }
        @keyframes glow { 0%,100%{box-shadow:0 0 10px #00ffff44} 50%{box-shadow:0 0 25px #00ffff99,0 0 50px #00ffff33} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        .soc-input { background:#0a0e1a; border:1px solid #00ffff33; border-radius:6px; padding:14px 16px; color:#e0f7ff; font-size:14px; font-family:'Share Tech Mono',monospace; outline:none; transition:all 0.3s; width:100%; box-sizing:border-box; }
        .soc-input:focus { border-color:#00ffff; box-shadow:0 0 15px #00ffff33; background:#0d1520; }
        .soc-input::placeholder { color:#3a5566; }
        .login-btn { background:linear-gradient(135deg,#00ffff22,#0066ff22); border:1px solid #00ffff; border-radius:6px; padding:14px; color:#00ffff; font-size:15px; font-family:'Rajdhani',sans-serif; font-weight:700; letter-spacing:3px; cursor:pointer; transition:all 0.3s; width:100%; animation:glow 3s infinite; }
        .login-btn:hover { background:linear-gradient(135deg,#00ffff44,#0066ff44); box-shadow:0 0 30px #00ffff55; transform:translateY(-1px); }
        .google-btn { background:#ffffff08; border:1px solid #ffffff22; border-radius:6px; padding:12px; color:#ffffff; font-size:13px; font-family:'Rajdhani',sans-serif; font-weight:600; letter-spacing:2px; cursor:pointer; transition:all 0.3s; width:100%; display:flex; align-items:center; justify-content:center; gap:10px; }
        .google-btn:hover { background:#ffffff15; border-color:#ffffff44; transform:translateY(-1px); }
      `}</style>

      {particles.map(p => (
        <div key={p.id} style={{ position:"fixed", left:`${p.left}%`, top:`${p.top}%`, width:`${p.size}px`, height:`${p.size}px`, borderRadius:"50%", background:"#00ffff", animation:`floatUp ${p.duration}s ${p.delay}s infinite ease-in-out`, pointerEvents:"none", zIndex:0 }} />
      ))}
      <div style={{ position:"fixed", left:0, right:0, height:"3px", background:"linear-gradient(transparent,#00ffff22,transparent)", animation:"scanline 6s linear infinite", zIndex:1, pointerEvents:"none" }} />
      <div style={{ position:"fixed", inset:0, zIndex:0, backgroundImage:`linear-gradient(#00ffff08 1px,transparent 1px),linear-gradient(90deg,#00ffff08 1px,transparent 1px)`, backgroundSize:"40px 40px" }} />

      <div style={{ ...s.card, animation:"fadeIn 0.6s ease forwards" }}>
        <div style={s.header}>
          <div style={s.hexagon}><span style={{ fontSize:24 }}>🛡</span></div>
          <h1 style={s.title}>SOC COPILOT</h1>
          <p style={s.subtitle}>// SECURITY INCIDENT RESPONSE PLATFORM</p>
          <div style={s.statusBar}>
            <span style={s.dot} /><span style={s.statusText}>SYSTEM ONLINE</span>
            <span style={{ ...s.dot, marginLeft:16, background:"#ffaa00" }} /><span style={s.statusText}>AUTH REQUIRED</span>
          </div>
        </div>

        <div style={s.divider} />

        {/* Auth mode toggle */}
        <div style={{ display:"flex", gap:0, marginBottom:16, border:"1px solid #00ffff33", borderRadius:6, overflow:"hidden" }}>
          <button
            onClick={() => { setAuthMode("firebase"); setError(""); }}
            style={{ flex:1, padding:"10px", background: authMode === "firebase" ? "#00ffff22" : "transparent", border:"none", color: authMode === "firebase" ? "#00ffff" : "#3a5566", fontFamily:"'Share Tech Mono',monospace", fontSize:11, letterSpacing:2, cursor:"pointer", textTransform:"uppercase" }}>
            ⬡ Firebase
          </button>
          <button
            onClick={() => { setAuthMode("jwt"); setError(""); }}
            style={{ flex:1, padding:"10px", background: authMode === "jwt" ? "#00ffff22" : "transparent", border:"none", borderLeft:"1px solid #00ffff33", color: authMode === "jwt" ? "#00ffff" : "#3a5566", fontFamily:"'Share Tech Mono',monospace", fontSize:11, letterSpacing:2, cursor:"pointer", textTransform:"uppercase" }}>
            🔑 JWT
          </button>
        </div>

        {/* ── FIREBASE FORM ── */}
        {authMode === "firebase" && (
          <div style={s.form}>
            <div style={s.fieldGroup}>
              <label style={s.label}>▸ EMAIL</label>
              <input className="soc-input" placeholder="Enter email address" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div style={s.fieldGroup}>
              <label style={s.label}>▸ PASSWORD</label>
              <input className="soc-input" type="password" placeholder="Enter password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />
            </div>

            {error && <div style={s.errorBox}><span style={{ color:"#ff4444" }}>⚠ {error}</span></div>}

            <button className="login-btn" onClick={handleLogin}>
              {loading ? "AUTHENTICATING..." : "INITIALIZE ACCESS"}
            </button>

            <div style={{ display:"flex", alignItems:"center", gap:10, margin:"4px 0" }}>
              <div style={{ flex:1, height:1, background:"#ffffff11" }} />
              <span style={{ color:"#3a5566", fontSize:11, fontFamily:"'Share Tech Mono'" }}>OR</span>
              <div style={{ flex:1, height:1, background:"#ffffff11" }} />
            </div>

            <button className="google-btn" onClick={handleGoogle}>
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              CONTINUE WITH GOOGLE
            </button>

            <p style={s.registerText}>
              No account?{" "}
              <span style={s.registerLink} onClick={() => navigate("/register")}>REQUEST ACCESS →</span>
            </p>
          </div>
        )}

        {/* ── JWT FORM ── */}
        {authMode === "jwt" && (
          <div style={s.form}>
            <div style={s.fieldGroup}>
              <label style={s.label}>▸ USERNAME</label>
              <input className="soc-input" placeholder="Enter username" value={username} onChange={e => setUsername(e.target.value)} />
            </div>
            <div style={s.fieldGroup}>
              <label style={s.label}>▸ PASSWORD</label>
              <input className="soc-input" type="password" placeholder="Enter password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleJwtLogin()} />
            </div>

            {error && <div style={s.errorBox}><span style={{ color:"#ff4444" }}>⚠ {error}</span></div>}

            <button className="login-btn" onClick={handleJwtLogin}>
              {loading ? "AUTHENTICATING..." : "INITIALIZE ACCESS"}
            </button>

            <p style={s.registerText}>
              No account?{" "}
              <span style={s.registerLink} onClick={() => navigate("/register")}>REQUEST ACCESS →</span>
            </p>
          </div>
        )}

        <div style={s.footer}><span style={s.footerText}>SIRA v3.0 — THREAT INTELLIGENCE ENGINE</span></div>
      </div>
    </div>
  );
}

const s = {
  page:         { display:"flex", justifyContent:"center", alignItems:"center", minHeight:"100vh", background:"#060a12", fontFamily:"'Share Tech Mono',monospace", position:"relative", overflow:"hidden" },
  card:         { background:"linear-gradient(145deg,#0d1520,#0a1018)", border:"1px solid #00ffff33", borderRadius:"12px", padding:"40px", width:"400px", zIndex:10, position:"relative", boxShadow:"0 0 40px #00ffff11,inset 0 0 40px #00000033" },
  header:       { textAlign:"center", marginBottom:"24px" },
  hexagon:      { width:"60px", height:"60px", background:"#00ffff11", border:"1px solid #00ffff55", borderRadius:"12px", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" },
  title:        { color:"#00ffff", fontSize:"26px", fontFamily:"'Rajdhani',sans-serif", fontWeight:700, letterSpacing:"6px", margin:"0 0 6px" },
  subtitle:     { color:"#2a5566", fontSize:"11px", margin:"0 0 14px", letterSpacing:"1px" },
  statusBar:    { display:"flex", alignItems:"center", justifyContent:"center", gap:"6px" },
  dot:          { width:"7px", height:"7px", borderRadius:"50%", background:"#00ff88", display:"inline-block" },
  statusText:   { color:"#3a6677", fontSize:"11px", letterSpacing:"1px" },
  divider:      { height:"1px", background:"linear-gradient(90deg,transparent,#00ffff33,transparent)", margin:"20px 0" },
  form:         { display:"flex", flexDirection:"column", gap:"18px" },
  fieldGroup:   { display:"flex", flexDirection:"column", gap:"8px" },
  label:        { color:"#00ffff88", fontSize:"11px", letterSpacing:"2px" },
  errorBox:     { background:"#ff000011", border:"1px solid #ff444433", borderRadius:"6px", padding:"10px 14px", fontSize:"13px" },
  registerText: { color:"#2a4455", fontSize:"13px", textAlign:"center", margin:0 },
  registerLink: { color:"#00ffff", cursor:"pointer" },
  footer:       { marginTop:"24px", textAlign:"center" },
  footerText:   { color:"#1a3344", fontSize:"10px", letterSpacing:"1px" },
};