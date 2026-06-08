import { useState, useRef } from "react";

const FLASK_URL = "http://localhost:5000";

export default function SiraVoice({ isOpen, onClose }) {
  const [input, setInput]         = useState("");
  const [response, setResponse]   = useState("S.I.R.A. online. Standing by.");
  const [loading, setLoading]     = useState(false);
  const [speaking, setSpeaking]   = useState(false);
  const [listening, setListening] = useState(false);
  const audioRef                  = useRef(null);

  if (!isOpen) return null;

  const speak = async (text) => {
    setSpeaking(true);
    try {
      const res   = await fetch(`${FLASK_URL}/sira-speak`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.substring(0, 500) })
      });
      const blob  = await res.blob();
      const url   = URL.createObjectURL(blob);
      if (audioRef.current) { audioRef.current.pause(); }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      audio.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      audio.play();
    } catch { setSpeaking(false); }
  };

  const askSira = async (question) => {
    if (!question.trim()) return;
    setLoading(true);
    setResponse("Analysing...");
    try {
      const res  = await fetch(`${FLASK_URL}/ask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, model: "ollama" })
      });
      const data = await res.json();
      const answer = data.answer || "No response.";
      const clean  = answer
        .replace(/SUMMARY:|THREAT DETAILS:|WHAT THIS MEANS:|RISK ASSESSMENT:|RECOMMENDED ACTIONS:/g, "")
        .replace(/\n+/g, " ").trim().substring(0, 400);
      setResponse(answer);
      speak(clean);
    } catch {
      setResponse("Cannot reach server.");
      speak("I cannot connect to the server right now, Sir.");
    }
    setLoading(false);
    setInput("");
  };

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice input requires Chrome"); return; }
    const rec = new SR();
    rec.lang = "en-US";
    setListening(true);
    rec.onresult = (e) => {
      const t = e.results[0][0].transcript;
      setInput(t); setListening(false); askSira(t);
    };
    rec.onerror = () => setListening(false);
    rec.start();
  };

  const stopSpeaking = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setSpeaking(false);
  };

  const status = speaking ? "SPEAKING" : listening ? "LISTENING" : loading ? "PROCESSING" : "STANDBY";
  const statusColor = speaking ? "#00e5ff" : listening ? "#b47cff" : loading ? "#ffaa00" : "#00ff9d";

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)",
      zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center"
    }} onClick={onClose}>
      <div style={{
        background: "#060b14", border: "1px solid rgba(0,229,255,0.15)",
        borderRadius: 4, width: 520, fontFamily: "'Space Mono',monospace",
        position: "relative", overflow: "hidden"
      }} onClick={e => e.stopPropagation()}>

        {/* Top bar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 20px", borderBottom: "1px solid rgba(0,229,255,0.1)",
          background: "rgba(0,229,255,0.03)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: statusColor, boxShadow: `0 0 8px ${statusColor}`
            }}/>
            <span style={{ fontSize: 9, color: statusColor, letterSpacing: 3 }}>{status}</span>
          </div>
          <span style={{ fontSize: 9, color: "#3d4f63", letterSpacing: 2 }}>S.I.R.A. v4.0</span>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#3d4f63",
            fontSize: 16, cursor: "pointer", padding: 0
          }}>✕</button>
        </div>

        {/* SVG Face */}
        <div style={{ position: "relative", background: "#050a10" }}>
          <svg viewBox="0 0 520 300" xmlns="http://www.w3.org/2000/svg"
            style={{ width: "100%", height: 300, display: "block" }}>
            <defs>
              <filter id="jglow">
                <feGaussianBlur stdDeviation="4" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <filter id="jglow2">
                <feGaussianBlur stdDeviation="8" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <radialGradient id="bg-grad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.08"/>
                <stop offset="100%" stopColor="#050a10" stopOpacity="0"/>
              </radialGradient>
            </defs>

            {/* Background glow */}
            <ellipse cx="260" cy="150" rx="180" ry="140" fill="url(#bg-grad)"/>

            {/* Grid lines */}
            {[100,180,260,340,420].map(x => (
              <line key={`x${x}`} x1={x} y1="0" x2={x} y2="300" stroke="rgba(0,229,255,0.04)" strokeWidth="0.5"/>
            ))}
            {[60,120,180,240].map(y => (
              <line key={`y${y}`} x1="0" y1={y} x2="520" y2={y} stroke="rgba(0,229,255,0.04)" strokeWidth="0.5"/>
            ))}

            {/* Outer ring */}
            <circle cx="260" cy="150" r="130" fill="none" stroke="rgba(0,229,255,0.1)" strokeWidth="1" strokeDasharray="6 4">
              <animateTransform attributeName="transform" type="rotate" from="0 260 150" to="360 260 150" dur="25s" repeatCount="indefinite"/>
            </circle>

            {/* Middle ring */}
            <circle cx="260" cy="150" r="110" fill="none" stroke="rgba(180,124,255,0.12)" strokeWidth="1" strokeDasharray="3 6">
              <animateTransform attributeName="transform" type="rotate" from="360 260 150" to="0 260 150" dur="18s" repeatCount="indefinite"/>
            </circle>

            {/* Inner ring — pulses when speaking */}
            <circle cx="260" cy="150" r="88" fill="none"
              stroke={speaking ? "rgba(0,229,255,0.4)" : "rgba(0,229,255,0.12)"}
              strokeWidth={speaking ? "2" : "1"}
              filter={speaking ? "url(#jglow)" : "none"}>
              {speaking && <animate attributeName="r" values="88;92;88" dur="0.8s" repeatCount="indefinite"/>}
            </circle>

            {/* Hexagon */}
            <polygon
              points="260,72 318,104 318,196 260,228 202,196 202,104"
              fill="rgba(0,229,255,0.02)"
              stroke={speaking ? "rgba(0,229,255,0.5)" : "rgba(0,229,255,0.2)"}
              strokeWidth="1.5"
              filter="url(#jglow)">
              <animate attributeName="opacity" values="0.6;1;0.6" dur="3s" repeatCount="indefinite"/>
            </polygon>

            {/* Left eye */}
            <g filter="url(#jglow2)">
              <ellipse cx="234" cy="138" rx="16" ry="7" fill="none" stroke="#00e5ff" strokeWidth="1.5">
                <animate attributeName="ry" values="7;0.5;7" dur="5s" begin="1s" repeatCount="indefinite"/>
              </ellipse>
              <ellipse cx="234" cy="138" rx="8" ry="4" fill="#00e5ff" opacity="0.9">
                <animate attributeName="ry" values="4;0.3;4" dur="5s" begin="1s" repeatCount="indefinite"/>
              </ellipse>
            </g>

            {/* Right eye */}
            <g filter="url(#jglow2)">
              <ellipse cx="286" cy="138" rx="16" ry="7" fill="none" stroke="#00e5ff" strokeWidth="1.5">
                <animate attributeName="ry" values="7;0.5;7" dur="5s" begin="1s" repeatCount="indefinite"/>
              </ellipse>
              <ellipse cx="286" cy="138" rx="8" ry="4" fill="#00e5ff" opacity="0.9">
                <animate attributeName="ry" values="4;0.3;4" dur="5s" begin="1s" repeatCount="indefinite"/>
              </ellipse>
            </g>

            {/* Nose */}
            <line x1="260" y1="148" x2="256" y2="164" stroke="rgba(0,229,255,0.25)" strokeWidth="1.5"/>
            <line x1="256" y1="164" x2="264" y2="164" stroke="rgba(0,229,255,0.25)" strokeWidth="1.5"/>

            {/* Mouth */}
            {speaking ? (
              <g filter="url(#jglow)">
                {[0,1,2,3,4,5,6,7].map(i => (
                  <rect key={i} x={228 + i*9} y={182} width="5" height="10" rx="2" fill="#00e5ff" opacity="0.85">
                    <animate attributeName="height" values={`${3+(i*4)%14};${10+(i*3)%10};${3+(i*4)%14}`} dur={`${0.25+i*0.06}s`} repeatCount="indefinite"/>
                    <animate attributeName="y" values="184;178;184" dur={`${0.25+i*0.06}s`} repeatCount="indefinite"/>
                  </rect>
                ))}
              </g>
            ) : (
              <path d="M 232 186 Q 260 194 288 186" fill="none"
                stroke="rgba(0,229,255,0.4)" strokeWidth="1.5" strokeLinecap="round">
                <animate attributeName="opacity" values="0.4;0.7;0.4" dur="3s" repeatCount="indefinite"/>
              </path>
            )}

            {/* Data lines left */}
            <line x1="100" y1="138" x2="190" y2="138" stroke="rgba(0,229,255,0.2)" strokeWidth="1"/>
            <line x1="120" y1="144" x2="190" y2="144" stroke="rgba(0,229,255,0.1)" strokeWidth="0.5"/>
            <line x1="100" y1="162" x2="190" y2="162" stroke="rgba(0,229,255,0.15)" strokeWidth="0.5"/>

            {/* Data lines right */}
            <line x1="330" y1="138" x2="420" y2="138" stroke="rgba(0,229,255,0.2)" strokeWidth="1"/>
            <line x1="330" y1="144" x2="400" y2="144" stroke="rgba(0,229,255,0.1)" strokeWidth="0.5"/>
            <line x1="330" y1="162" x2="420" y2="162" stroke="rgba(0,229,255,0.15)" strokeWidth="0.5"/>

            {/* Core pulse */}
            <circle cx="260" cy="150" r="3" fill="#00e5ff" filter="url(#jglow2)">
              <animate attributeName="r" values="3;6;3" dur="2s" repeatCount="indefinite"/>
              <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite"/>
            </circle>

            {/* Status text */}
            <text x="20" y="20" fontFamily="monospace" fontSize="8" fill="rgba(0,229,255,0.4)">S.I.R.A.</text>
            <text x="20" y="32" fontFamily="monospace" fontSize="7" fill="rgba(0,229,255,0.2)">NEURAL NET ACTIVE</text>
            <text x="500" y="20" fontFamily="monospace" fontSize="8" fill={statusColor} textAnchor="end">{status}</text>
            <text x="500" y="32" fontFamily="monospace" fontSize="7" fill="rgba(0,229,255,0.2)" textAnchor="end">SECURE CHANNEL</text>

            {/* Scan line when speaking */}
            {speaking && (
              <line x1="0" y1="150" x2="520" y2="150" stroke="rgba(0,229,255,0.08)" strokeWidth="40">
                <animate attributeName="y1" values="50;250;50" dur="2s" repeatCount="indefinite"/>
                <animate attributeName="y2" values="50;250;50" dur="2s" repeatCount="indefinite"/>
              </line>
            )}

            {/* Corner brackets */}
            <path d="M8,8 L8,24 M8,8 L24,8" stroke="rgba(0,229,255,0.3)" strokeWidth="1.5" fill="none"/>
            <path d="M512,8 L512,24 M512,8 L496,8" stroke="rgba(0,229,255,0.3)" strokeWidth="1.5" fill="none"/>
            <path d="M8,292 L8,276 M8,292 L24,292" stroke="rgba(0,229,255,0.3)" strokeWidth="1.5" fill="none"/>
            <path d="M512,292 L512,276 M512,292 L496,292" stroke="rgba(0,229,255,0.3)" strokeWidth="1.5" fill="none"/>

            {/* Scanlines overlay */}
            <rect x="0" y="0" width="520" height="300" fill="none"
              style={{backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,229,255,0.01) 3px,rgba(0,229,255,0.01) 4px)"}}/>
          </svg>
        </div>

        {/* Response */}
        <div style={{
          padding: "14px 20px", borderTop: "1px solid rgba(0,229,255,0.08)",
          borderBottom: "1px solid rgba(0,229,255,0.08)",
          minHeight: 60, maxHeight: 80, overflowY: "auto"
        }}>
          <div style={{ fontSize: 9, color: "#3d4f63", letterSpacing: 2, marginBottom: 6 }}>
            SIRA RESPONSE
          </div>
          <div style={{ fontSize: 12, color: "#7a8fa6", lineHeight: 1.7 }}>{response}</div>
        </div>

        {/* Input area */}
        <div style={{ padding: "14px 20px" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && askSira(input)}
              placeholder="Ask SIRA..."
              style={{
                flex: 1, background: "rgba(0,229,255,0.03)",
                border: "1px solid rgba(0,229,255,0.15)",
                borderRadius: 3, padding: "10px 14px",
                color: "#e8f0fe", fontSize: 11, outline: "none",
                fontFamily: "'Space Mono',monospace"
              }}
            />
            <button onClick={() => askSira(input)} disabled={loading || !input.trim()} style={{
              padding: "10px 18px",
              background: "linear-gradient(135deg,#00e5ff,#00b4cc)",
              border: "none", borderRadius: 3, color: "#060b14",
              fontSize: 9, fontWeight: 700, letterSpacing: 2,
              cursor: "pointer", fontFamily: "'Space Mono',monospace"
            }}>SEND</button>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button onClick={startListening} disabled={listening} style={{
              flex: 1, padding: "8px",
              background: listening ? "rgba(180,124,255,0.15)" : "transparent",
              border: "1px solid rgba(180,124,255,0.3)",
              borderRadius: 3, color: "#b47cff",
              fontSize: 9, letterSpacing: 1, cursor: "pointer",
              fontFamily: "'Space Mono',monospace"
            }}>
              {listening ? "◎ LISTENING..." : "◎ VOICE INPUT"}
            </button>
            <button onClick={stopSpeaking} style={{
              padding: "8px 14px",
              background: "transparent",
              border: "1px solid rgba(255,61,90,0.2)",
              borderRadius: 3, color: "#ff3d5a",
              fontSize: 9, cursor: "pointer",
              fontFamily: "'Space Mono',monospace"
            }}>■ STOP</button>
          </div>

          {/* Quick commands */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {[
              "Current threat level?",
              "Who is attacking us?",
              "What should I do?",
              "Run full analysis"
            ].map((q, i) => (
              <button key={i} onClick={() => askSira(q)} style={{
                fontSize: 8, padding: "4px 10px", borderRadius: 2,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "transparent", color: "#3d4f63",
                cursor: "pointer", letterSpacing: 1,
                fontFamily: "'Space Mono',monospace",
                textTransform: "uppercase",
                transition: "all 0.15s"
              }}
              onMouseEnter={e => { e.target.style.borderColor = "rgba(0,229,255,0.3)"; e.target.style.color = "#00e5ff"; }}
              onMouseLeave={e => { e.target.style.borderColor = "rgba(255,255,255,0.06)"; e.target.style.color = "#3d4f63"; }}
              >{q}</button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}