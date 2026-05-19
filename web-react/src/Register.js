import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Register() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
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

  const handleRegister = async () => {
    if (!username || !email || !password) { setError("All fields required"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("http://localhost:5000/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });
      const data = await res.json();
      if (data.message) {
        setSuccess("Account created! Redirecting...");
        setTimeout(() => navigate("/login"), 1500);
      } else {
        setError(data.error || "Registration failed");
      }
    } catch {
      setError("Cannot connect to server");
    }
    setLoading(false);
  };

  return (
    <div style={s.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;600;700&display=swap');
        @keyframes floatUp {
          0% { transform: translateY(0px); opacity: 0.4; }
          50% { transform: translateY(-20px); opacity: 1; }
          100% { transform: translateY(0px); opacity: 0.4; }
        }
        @keyframes scanline {
          0% { top: -10%; }
          100% { top: 110%; }
        }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 10px #00ffff44; }
          50% { box-shadow: 0 0 25px #00ffff99, 0 0 50px #00ffff33; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .soc-input {
          background: #0a0e1a;
          border: 1px solid #00ffff33;
          border-radius: 6px;
          padding: 14px 16px;
          color: #e0f7ff;
          font-size: 14px;
          font-family: 'Share Tech Mono', monospace;
          outline: none;
          transition: all 0.3s;
          width: 100%;
          box-sizing: border-box;
        }
        .soc-input:focus {
          border-color: #00ffff;
          box-shadow: 0 0 15px #00ffff33;
          background: #0d1520;
        }
        .soc-input::placeholder { color: #3a5566; }
        .register-btn {
          background: linear-gradient(135deg, #00ffff22, #0066ff22);
          border: 1px solid #00ffff;
          border-radius: 6px;
          padding: 14px;
          color: #00ffff;
          font-size: 15px;
          font-family: 'Rajdhani', sans-serif;
          font-weight: 700;
          letter-spacing: 3px;
          cursor: pointer;
          transition: all 0.3s;
          width: 100%;
          animation: glow 3s infinite;
        }
        .register-btn:hover {
          background: linear-gradient(135deg, #00ffff44, #0066ff44);
          box-shadow: 0 0 30px #00ffff55;
          transform: translateY(-1px);
        }
      `}</style>

      {particles.map(p => (
        <div key={p.id} style={{
          position: "fixed", left: `${p.left}%`, top: `${p.top}%`,
          width: `${p.size}px`, height: `${p.size}px`,
          borderRadius: "50%", background: "#00ffff",
          animation: `floatUp ${p.duration}s ${p.delay}s infinite ease-in-out`,
          pointerEvents: "none", zIndex: 0,
        }} />
      ))}

      <div style={{
        position: "fixed", left: 0, right: 0, height: "3px",
        background: "linear-gradient(transparent, #00ffff22, transparent)",
        animation: "scanline 6s linear infinite", zIndex: 1, pointerEvents: "none",
      }} />

      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        backgroundImage: `
          linear-gradient(#00ffff08 1px, transparent 1px),
          linear-gradient(90deg, #00ffff08 1px, transparent 1px)
        `,
        backgroundSize: "40px 40px",
      }} />

      <div style={{ ...s.card, animation: "fadeIn 0.6s ease forwards" }}>
        <div style={s.header}>
          <div style={s.hexagon}>
            <span style={{ fontSize: 24 }}>🔐</span>
          </div>
          <h1 style={s.title}>SOC COPILOT</h1>
          <p style={s.subtitle}>// REQUEST SYSTEM ACCESS</p>
          <div style={s.statusBar}>
            <span style={s.dot} />
            <span style={s.statusText}>NEW USER REGISTRATION</span>
          </div>
        </div>

        <div style={s.divider} />

        <div style={s.form}>
          <div style={s.fieldGroup}>
            <label style={s.label}>▸ USERNAME</label>
            <input className="soc-input" placeholder="Choose a username"
              value={username} onChange={e => setUsername(e.target.value)} />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>▸ EMAIL</label>
            <input className="soc-input" placeholder="Enter email address"
              value={email} onChange={e => setEmail(e.target.value)} />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>▸ PASSWORD</label>
            <input className="soc-input" type="password" placeholder="Create password"
              value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleRegister()} />
          </div>

          {error && (
            <div style={s.errorBox}>
              <span style={{ color: "#ff4444" }}>⚠ {error}</span>
            </div>
          )}

          {success && (
            <div style={s.successBox}>
              <span style={{ color: "#00ff88" }}>✓ {success}</span>
            </div>
          )}

          <button className="register-btn" onClick={handleRegister}>
            {loading ? "CREATING ACCOUNT..." : "REQUEST ACCESS"}
          </button>

          <p style={s.loginText}>
            Already have access?{" "}
            <span style={s.loginLink} onClick={() => navigate("/login")}>
              LOGIN →
            </span>
          </p>
        </div>

        <div style={s.footer}>
          <span style={s.footerText}>SIRA v3.0 — THREAT INTELLIGENCE ENGINE</span>
        </div>
      </div>
    </div>
  );
}

const s = {
  page: {
    display: "flex", justifyContent: "center", alignItems: "center",
    minHeight: "100vh", background: "#060a12",
    fontFamily: "'Share Tech Mono', monospace", position: "relative", overflow: "hidden",
  },
  card: {
    background: "linear-gradient(145deg, #0d1520, #0a1018)",
    border: "1px solid #00ffff33",
    borderRadius: "12px", padding: "40px",
    width: "400px", zIndex: 10, position: "relative",
    boxShadow: "0 0 40px #00ffff11, inset 0 0 40px #00000033",
  },
  header: { textAlign: "center", marginBottom: "24px" },
  hexagon: {
    width: "60px", height: "60px", background: "#00ffff11",
    border: "1px solid #00ffff55", borderRadius: "12px",
    display: "flex", alignItems: "center", justifyContent: "center",
    margin: "0 auto 16px",
  },
  title: {
    color: "#00ffff", fontSize: "26px", fontFamily: "'Rajdhani', sans-serif",
    fontWeight: 700, letterSpacing: "6px", margin: "0 0 6px",
  },
  subtitle: { color: "#2a5566", fontSize: "11px", margin: "0 0 14px", letterSpacing: "1px" },
  statusBar: { display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" },
  dot: { width: "7px", height: "7px", borderRadius: "50%", background: "#00ffff", display: "inline-block" },
  statusText: { color: "#3a6677", fontSize: "11px", letterSpacing: "1px" },
  divider: { height: "1px", background: "linear-gradient(90deg, transparent, #00ffff33, transparent)", margin: "20px 0" },
  form: { display: "flex", flexDirection: "column", gap: "18px" },
  fieldGroup: { display: "flex", flexDirection: "column", gap: "8px" },
  label: { color: "#00ffff88", fontSize: "11px", letterSpacing: "2px" },
  errorBox: {
    background: "#ff000011", border: "1px solid #ff444433",
    borderRadius: "6px", padding: "10px 14px", fontSize: "13px",
  },
  successBox: {
    background: "#00ff8811", border: "1px solid #00ff8833",
    borderRadius: "6px", padding: "10px 14px", fontSize: "13px",
  },
  loginText: { color: "#2a4455", fontSize: "13px", textAlign: "center", margin: 0 },
  loginLink: { color: "#00ffff", cursor: "pointer" },
  footer: { marginTop: "24px", textAlign: "center" },
  footerText: { color: "#1a3344", fontSize: "10px", letterSpacing: "1px" },
};