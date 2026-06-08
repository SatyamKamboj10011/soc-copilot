import React, { useState } from "react";
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
  const navigate = useNavigate();

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
      const res  = await fetch("http://localhost:5000/auth/login", {
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
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#080c12",
      fontFamily: "'Space Mono', monospace"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@700;800&display=swap');
        .si { width:100%; background:#0d1219; border:1px solid rgba(255,255,255,0.08); border-radius:4px; padding:12px 14px; color:#e8f0fe; font-size:13px; font-family:'Space Mono',monospace; outline:none; box-sizing:border-box; transition:border-color 0.2s; }
        .si:focus { border-color:#00e5ff; box-shadow:0 0 0 2px rgba(0,229,255,0.1); }
        .si::placeholder { color:#3d4f63; }
        .sb { width:100%; padding:12px; background:linear-gradient(135deg,#00e5ff,#00b4cc); border:none; border-radius:4px; color:#080c12; font-family:'Space Mono',monospace; font-size:11px; font-weight:700; letter-spacing:2px; cursor:pointer; transition:opacity 0.2s; }
        .sb:hover { opacity:0.9; }
        .sb:disabled { opacity:0.4; cursor:not-allowed; }
        .gb { width:100%; padding:11px; background:transparent; border:1px solid rgba(255,255,255,0.1); border-radius:4px; color:#7a8fa6; font-family:'Space Mono',monospace; font-size:10px; letter-spacing:1px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; transition:all 0.2s; }
        .gb:hover { border-color:rgba(255,255,255,0.2); color:#e8f0fe; }
        .tb { flex:1; padding:9px; background:transparent; border:none; font-family:'Space Mono',monospace; font-size:10px; letter-spacing:1px; cursor:pointer; transition:all 0.2s; text-transform:uppercase; }
      `}</style>

      <div style={{
        width: 400, background: "#0d1219",
        border: "1px solid rgba(0,229,255,0.15)",
        borderRadius: 8, padding: 36,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)"
      }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 52, height: 52, margin: "0 auto 16px",
            background: "linear-gradient(135deg,#00e5ff,#b47cff)",
            clipPath: "polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 30px rgba(0,229,255,0.3)"
          }}>
            <span style={{ fontSize: 22, color: "#080c12" }}>⬡</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 4, color: "#e8f0fe", fontFamily: "Syne" }}>
            SOC COPILOT
          </div>
          <div style={{ fontSize: 9, color: "#00e5ff", letterSpacing: 3, marginTop: 4 }}>
            SIRA v4 — THREAT INTELLIGENCE
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00ff9d", boxShadow: "0 0 6px #00ff9d" }} />
            <span style={{ fontSize: 9, color: "#3d4f63", letterSpacing: 2 }}>SYSTEM ONLINE</span>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ffaa00", boxShadow: "0 0 6px #ffaa00", marginLeft: 10 }} />
            <span style={{ fontSize: 9, color: "#3d4f63", letterSpacing: 2 }}>AUTH REQUIRED</span>
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "linear-gradient(90deg,transparent,rgba(0,229,255,0.2),transparent)", marginBottom: 24 }} />

        {/* Auth toggle */}
        <div style={{ display: "flex", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden", marginBottom: 20 }}>
          <button className="tb" onClick={() => { setAuthMode("firebase"); setError(""); }}
            style={{ color: authMode === "firebase" ? "#00e5ff" : "#3d4f63", background: authMode === "firebase" ? "rgba(0,229,255,0.08)" : "transparent" }}>
            ⬡ Firebase
          </button>
          <div style={{ width: 1, background: "rgba(255,255,255,0.08)" }} />
          <button className="tb" onClick={() => { setAuthMode("jwt"); setError(""); }}
            style={{ color: authMode === "jwt" ? "#00e5ff" : "#3d4f63", background: authMode === "jwt" ? "rgba(0,229,255,0.08)" : "transparent" }}>
            ◈ JWT
          </button>
        </div>

        {/* Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {authMode === "firebase" ? (
            <>
              <div>
                <div style={{ fontSize: 9, color: "#00e5ff", letterSpacing: 2, marginBottom: 6 }}>▸ EMAIL</div>
                <input className="si" placeholder="analyst@company.com" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: 9, color: "#00e5ff", letterSpacing: 2, marginBottom: 6 }}>▸ PASSWORD</div>
                <input className="si" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />
              </div>
              {error && (
                <div style={{ background: "rgba(255,61,90,0.08)", border: "1px solid rgba(255,61,90,0.3)", borderRadius: 4, padding: "10px 12px", fontSize: 11, color: "#ff3d5a" }}>
                  ⚠ {error}
                </div>
              )}
              <button className="sb" onClick={handleLogin} disabled={loading}>
                {loading ? "AUTHENTICATING..." : "INITIALIZE ACCESS"}
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
                <span style={{ fontSize: 9, color: "#3d4f63", letterSpacing: 1 }}>OR</span>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
              </div>
              <button className="gb" onClick={handleGoogle} disabled={loading}>
                <svg width="16" height="16" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
                CONTINUE WITH GOOGLE
              </button>
            </>
          ) : (
            <>
              <div>
                <div style={{ fontSize: 9, color: "#00e5ff", letterSpacing: 2, marginBottom: 6 }}>▸ USERNAME</div>
                <input className="si" placeholder="analyst" value={username} onChange={e => setUsername(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: 9, color: "#00e5ff", letterSpacing: 2, marginBottom: 6 }}>▸ PASSWORD</div>
                <input className="si" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleJwtLogin()} />
              </div>
              {error && (
                <div style={{ background: "rgba(255,61,90,0.08)", border: "1px solid rgba(255,61,90,0.3)", borderRadius: 4, padding: "10px 12px", fontSize: 11, color: "#ff3d5a" }}>
                  ⚠ {error}
                </div>
              )}
              <button className="sb" onClick={handleJwtLogin} disabled={loading}>
                {loading ? "AUTHENTICATING..." : "INITIALIZE ACCESS"}
              </button>
            </>
          )}

          <p style={{ textAlign: "center", margin: 0, fontSize: 11, color: "#3d4f63" }}>
            No account?{" "}
            <span onClick={() => navigate("/register")} style={{ color: "#00e5ff", cursor: "pointer" }}>
              REQUEST ACCESS →
            </span>
          </p>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 24, textAlign: "center", fontSize: 9, color: "#1a2535", letterSpacing: 1 }}>
          SECURITY INCIDENT RESPONSE ASSISTANT — OPAIC 2026
        </div>
      </div>
    </div>
  );
}