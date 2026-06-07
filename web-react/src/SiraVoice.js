import { useState, useRef } from "react";

const FLASK_URL = "http://localhost:5000";

export default function SiraVoice({ isOpen, onClose }) {
  const [input, setInput]         = useState("");
  const [response, setResponse]   = useState("SIRA online. Ask me anything about your network.");
  const [loading, setLoading]     = useState(false);
  const [speaking, setSpeaking]   = useState(false);
  const [listening, setListening] = useState(false);
  const synthRef                  = useRef(window.speechSynthesis);
  const videoRef                  = useRef(null);

  if (!isOpen) return null;

  const speak = (text) => {
    synthRef.current.cancel();
    const utterance  = new SpeechSynthesisUtterance(text);
    utterance.rate   = 0.9;
    utterance.pitch  = 0.85;
    const voices     = synthRef.current.getVoices();
    const preferred  = voices.find(v =>
      v.name.includes("Google UK English Female") ||
      v.name.includes("Microsoft Zira") ||
      v.name.includes("Female")
    );
    if (preferred) utterance.voice = preferred;

    utterance.onstart = () => {
      setSpeaking(true);
      if (videoRef.current) {
        videoRef.current.play();
      }
    };
    utterance.onend = () => {
      setSpeaking(false);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
    };
    synthRef.current.speak(utterance);
  };

  const askSira = async (question) => {
    if (!question.trim()) return;
    setLoading(true);
    setResponse("Analysing your logs...");
    try {
      const res  = await fetch(`${FLASK_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, model: "ollama" })
      });
      const data = await res.json();
      const answer = data.answer || "No response from SIRA";
      const clean  = answer
        .replace(/SUMMARY:|THREAT DETAILS:|WHAT THIS MEANS:|RISK ASSESSMENT:|RECOMMENDED ACTIONS:/g, "")
        .replace(/\n+/g, " ").trim().substring(0, 400);
      setResponse(answer);
      speak(clean);
    } catch {
      setResponse("Error connecting to Flask.");
      speak("I cannot connect to the server right now.");
    }
    setLoading(false);
    setInput("");
  };

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice input requires Chrome"); return; }
    const rec = new SR();
    rec.lang  = "en-US";
    setListening(true);
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput(transcript);
      setListening(false);
      askSira(transcript);
    };
    rec.onerror = () => setListening(false);
    rec.start();
  };

  const stopSpeaking = () => {
    synthRef.current.cancel();
    setSpeaking(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
      zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center"
    }} onClick={onClose}>
      <div style={{
        background: "#060b14", border: "1px solid rgba(0,229,255,0.2)",
        borderRadius: 12, padding: 24, width: 460,
        fontFamily: "'Space Mono',monospace", position: "relative"
      }} onClick={e => e.stopPropagation()}>

        {/* Close */}
        <button onClick={onClose} style={{
          position: "absolute", top: 14, right: 14,
          background: "none", border: "none",
          color: "#7a8fa6", fontSize: 18, cursor: "pointer"
        }}>✕</button>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 9, color: "#00e5ff", letterSpacing: 4, marginBottom: 2 }}>
            SIRA v4 — VOICE INTERFACE
          </div>
          <div style={{ fontSize: 7, color: "#3d4f63", letterSpacing: 2 }}>
            SECURITY INCIDENT RESPONSE ASSISTANT
          </div>
        </div>

        {/* Video Face */}
        <div style={{
          width: "100%", borderRadius: 8, overflow: "hidden",
          border: `2px solid ${speaking ? "rgba(0,229,255,0.6)" : "rgba(0,229,255,0.15)"}`,
          background: "#0a1120", marginBottom: 16, position: "relative",
          transition: "border-color 0.3s",
          boxShadow: speaking ? "0 0 20px rgba(0,229,255,0.3)" : "none"
        }}>
          <video
            ref={videoRef}
            src="/women.mp4"
            loop
            muted={false}
            style={{ width: "100%", height: 280, objectFit: "cover", display: "block" }}
          />

          {/* Scanline overlay */}
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            background: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,229,255,0.03) 3px,rgba(0,229,255,0.03) 4px)"
          }} />

          {/* Status */}
          <div style={{ position: "absolute", bottom: 10, left: 0, right: 0, textAlign: "center" }}>
            <span style={{
              fontSize: 8, letterSpacing: 2, padding: "3px 12px", borderRadius: 20,
              background: speaking ? "rgba(0,229,255,0.15)" : listening ? "rgba(180,124,255,0.15)" : "rgba(0,255,157,0.08)",
              border: `1px solid ${speaking ? "rgba(0,229,255,0.4)" : listening ? "rgba(180,124,255,0.4)" : "rgba(0,255,157,0.3)"}`,
              color: speaking ? "#00e5ff" : listening ? "#b47cff" : "#00ff9d"
            }}>
              {speaking ? "● SPEAKING" : listening ? "◎ LISTENING..." : loading ? "◈ ANALYSING..." : "● STANDBY"}
            </span>
          </div>

          {/* Voice bars when speaking */}
          {speaking && (
            <div style={{
              position: "absolute", bottom: 36, left: "50%",
              transform: "translateX(-50%)",
              display: "flex", gap: 3, alignItems: "flex-end"
            }}>
              {[8,14,20,28,20,14,8].map((h, i) => (
                <div key={i} style={{
                  width: 3, height: h, background: "#00e5ff",
                  borderRadius: 2, opacity: 0.7,
                  animation: `barAnim 0.6s ease-in-out infinite`,
                  animationDelay: `${i * 0.1}s`
                }} />
              ))}
            </div>
          )}
        </div>

        {/* CSS for bar animation */}
        <style>{`
          @keyframes barAnim {
            0%,100% { transform: scaleY(0.3); }
            50% { transform: scaleY(1); }
          }
        `}</style>

        {/* Response */}
        <div style={{
          background: "#0a1120",
          border: "1px solid rgba(255,255,255,0.06)",
          borderLeft: "2px solid #00e5ff",
          borderRadius: 4, padding: "10px 14px", marginBottom: 10,
          fontSize: 11, color: "#7a8fa6", lineHeight: 1.8,
          maxHeight: 80, overflowY: "auto"
        }}>{response}</div>

        {/* Input */}
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && askSira(input)}
            placeholder="Ask SIRA..."
            style={{
              flex: 1, background: "#0f1828",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 3, padding: "8px 12px",
              color: "#e8f0fe", fontSize: 10, outline: "none",
              fontFamily: "'Space Mono',monospace"
            }}
          />
          <button onClick={() => askSira(input)} disabled={loading || !input.trim()} style={{
            padding: "8px 14px",
            background: "linear-gradient(135deg,#00e5ff,#00b4cc)",
            border: "none", borderRadius: 3, color: "#060b14",
            fontSize: 9, fontWeight: 700, cursor: "pointer",
            fontFamily: "'Space Mono',monospace"
          }}>SEND</button>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <button onClick={startListening} disabled={listening} style={{
            flex: 1, padding: "7px",
            background: "rgba(180,124,255,0.1)",
            border: "1px solid rgba(180,124,255,0.3)",
            borderRadius: 3, color: "#b47cff",
            fontSize: 9, letterSpacing: 1, cursor: "pointer",
            fontFamily: "'Space Mono',monospace"
          }}>
            {listening ? "◎ LISTENING..." : "◎ VOICE INPUT"}
          </button>
          <button onClick={stopSpeaking} style={{
            padding: "7px 12px",
            background: "rgba(255,61,90,0.08)",
            border: "1px solid rgba(255,61,90,0.25)",
            borderRadius: 3, color: "#ff3d5a",
            fontSize: 9, cursor: "pointer",
            fontFamily: "'Space Mono',monospace"
          }}>■ STOP</button>
        </div>

        {/* Quick questions */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {[
            "What IPs are attacking us?",
            "Summarise threats",
            "What should I do?",
            "Analyse 185.220.101.45"
          ].map((q, i) => (
            <button key={i} onClick={() => askSira(q)} style={{
              fontSize: 8, padding: "4px 8px", borderRadius: 2,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "#0f1828", color: "#7a8fa6",
              cursor: "pointer", letterSpacing: 1,
              fontFamily: "'Space Mono',monospace",
              textTransform: "uppercase"
            }}>{q}</button>
          ))}
        </div>

      </div>
    </div>
  );
}