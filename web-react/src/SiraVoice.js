import { useState, useRef, useEffect } from "react";

const FLASK_URL = "https://soc-copilot.onrender.com";

export default function SiraVoice({ isOpen, onClose }) {
  const [input, setInput]         = useState("");
  const [response, setResponse]   = useState("S.I.R.A. online. Standing by.");
  const [loading, setLoading]     = useState(false);
  const [speaking, setSpeaking]   = useState(false);
  const [generating, setGenerating] = useState(false);
  const [listening, setListening] = useState(false);

  const audioCtxRef   = useRef(null);
  const analyserRef  = useRef(null);
  const sourceRef    = useRef(null);
  const graphReadyRef = useRef(false);
  const currentUrlRef = useRef(null);
  const canvasRef    = useRef(null);
  const videoRef     = useRef(null);
  const rafRef       = useRef(null);

  // Continuous render loop: audio-reactive while speaking, gentle idle pulse otherwise
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
    let t = 0;
    const bufferLength = 64;
    const data = new Uint8Array(bufferLength);

    const draw = () => {
      t += 0.02;
      ctx.clearRect(0, 0, W, H);

      let level = 0.15 + Math.sin(t) * 0.05; // idle breathing fallback
      let bars = new Array(28).fill(0).map((_, i) => 0.2 + Math.sin(t * 1.5 + i * 0.4) * 0.15);

      if (speaking && analyserRef.current) {
        analyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        level = Math.min(1, avg / 130);
        bars = Array.from({ length: 28 }, (_, i) => {
          const idx = Math.floor((i / 28) * bufferLength);
          return Math.max(0.06, data[idx] / 255);
        });
      }

      // outer glow ring — radius/opacity driven by real amplitude when speaking
      const ringColor = speaking ? "41,211,255" : listening ? "139,124,255" : "34,217,122";
      ctx.beginPath();
      ctx.arc(cx, cy, 78 + level * 18, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${ringColor},${0.25 + level * 0.5})`;
      ctx.lineWidth = 2 + level * 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, 92, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${ringColor},0.15)`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // circular waveform bars around the ring — real frequency data while speaking
      bars.forEach((v, i) => {
        const angle = (i / bars.length) * Math.PI * 2 - Math.PI / 2;
        const rInner = 100;
        const rOuter = rInner + v * 34;
        const x1 = cx + Math.cos(angle) * rInner, y1 = cy + Math.sin(angle) * rInner;
        const x2 = cx + Math.cos(angle) * rOuter, y2 = cy + Math.sin(angle) * rOuter;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(${ringColor},${0.4 + v * 0.6})`;
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.stroke();
      });

      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [isOpen, speaking, listening]);

  useEffect(() => {
    return () => {
      if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current);
    };
  }, []);

  if (!isOpen) return null;

  // Web Audio's createMediaElementSource can only be attached to a given
  // DOM element ONCE, ever -- so this runs a single time against the video
  // element itself, not per-speak-call. Swapping the video's src later
  // (idle loop <-> generated clip) keeps working through the same graph.
  const ensureAudioGraph = () => {
    if (graphReadyRef.current || !videoRef.current) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!audioCtxRef.current) audioCtxRef.current = new AC();
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") ctx.resume();
    const source = ctx.createMediaElementSource(videoRef.current);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    analyserRef.current = analyser;
    sourceRef.current = source;
    graphReadyRef.current = true;
  };

  const returnToIdle = () => {
    const video = videoRef.current;
    setSpeaking(false);
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load(); // clears the video frame so the poster (idle face photo) shows
  };

  const speak = async (text) => {
    setGenerating(true);
    try {
      const res = await fetch(`${FLASK_URL}/sira-face-speak`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.substring(0, 500) })
      });
      if (!res.ok) throw new Error("face-speak request failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);

      if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current);
      currentUrlRef.current = url;

      const video = videoRef.current;
      ensureAudioGraph();

      video.muted = false;
      video.loop = false;
      video.src = url;
      video.load();
      video.onended = returnToIdle;
      video.onerror = returnToIdle;

      setGenerating(false);
      setSpeaking(true);
      await video.play();
    } catch {
      setGenerating(false);
      setSpeaking(false);
    }
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
    returnToIdle();
  };

  const status = generating ? "GENERATING" : speaking ? "SPEAKING" : listening ? "LISTENING" : loading ? "PROCESSING" : "STANDBY";
  const statusColor = generating ? "#F0A857" : speaking ? "#29D3FF" : listening ? "#8B7CFF" : loading ? "#F0A857" : "#22D97A";

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(4,6,10,0.85)", backdropFilter: "blur(4px)",
      zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20
    }} onClick={onClose}>
      <div style={{
        background: "#0A121C", border: "1px solid rgba(41,211,255,0.2)",
        borderRadius: 18, width: 520, maxWidth: "100%", fontFamily: "'Inter',sans-serif",
        position: "relative", overflow: "hidden", boxShadow: "0 30px 80px -20px rgba(0,0,0,0.7)"
      }} onClick={e => e.stopPropagation()}>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 22px", borderBottom: "1px solid rgba(41,211,255,0.12)",
          background: "rgba(41,211,255,0.04)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor, boxShadow: `0 0 8px ${statusColor}` }}/>
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: statusColor, letterSpacing: 2 }}>{status}</span>
          </div>
          <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 0.5, color: "#F2F6FA" }}>S.I.R.A.</span>
          <button onClick={onClose} style={{
            background: "rgba(41,211,255,0.08)", border: "1px solid rgba(41,211,255,0.15)", borderRadius: 8,
            width: 26, height: 26, color: "#8FA3B5", fontSize: 14, cursor: "pointer", padding: 0,
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>✕</button>
        </div>

        <div style={{ position: "relative", background: "#060A11", height: 280, overflow: "hidden" }}>
          <video
            ref={videoRef}
            playsInline
            poster="/sira_face.jpg"
            style={{
              position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
              width: 180, height: 180, borderRadius: "50%", objectFit: "cover",
              filter: speaking ? "brightness(1.05) saturate(1.15)" : generating ? "brightness(0.85) saturate(0.7) blur(0.5px)" : "brightness(0.9) saturate(0.9)",
              transition: "filter 0.2s", zIndex: 1
            }}
          />
          <canvas ref={canvasRef} width={520} height={280} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 2 }} />

          <div style={{ position: "absolute", top: 14, left: 18, zIndex: 3, fontFamily: "'IBM Plex Mono',monospace" }}>
            <div style={{ fontSize: 8, color: "rgba(41,211,255,0.5)" }}>S.I.R.A.</div>
            <div style={{ fontSize: 7, color: "rgba(41,211,255,0.28)" }}>AUDIO-REACTIVE CORE</div>
          </div>
          <div style={{ position: "absolute", top: 14, right: 18, zIndex: 3, textAlign: "right", fontFamily: "'IBM Plex Mono',monospace" }}>
            <div style={{ fontSize: 8, color: statusColor }}>{status}</div>
            <div style={{ fontSize: 7, color: "rgba(41,211,255,0.28)" }}>SECURE CHANNEL</div>
          </div>

          <div style={{ position: "absolute", inset: 14, zIndex: 3, pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: 16, height: 16, borderTop: "1.5px solid rgba(41,211,255,0.35)", borderLeft: "1.5px solid rgba(41,211,255,0.35)", borderRadius: "4px 0 0 0" }} />
            <div style={{ position: "absolute", top: 0, right: 0, width: 16, height: 16, borderTop: "1.5px solid rgba(41,211,255,0.35)", borderRight: "1.5px solid rgba(41,211,255,0.35)", borderRadius: "0 4px 0 0" }} />
            <div style={{ position: "absolute", bottom: 0, left: 0, width: 16, height: 16, borderBottom: "1.5px solid rgba(41,211,255,0.35)", borderLeft: "1.5px solid rgba(41,211,255,0.35)", borderRadius: "0 0 0 4px" }} />
            <div style={{ position: "absolute", bottom: 0, right: 0, width: 16, height: 16, borderBottom: "1.5px solid rgba(41,211,255,0.35)", borderRight: "1.5px solid rgba(41,211,255,0.35)", borderRadius: "0 0 4px 0" }} />
          </div>
        </div>

        <div style={{
          padding: "16px 22px", borderTop: "1px solid rgba(41,211,255,0.1)",
          borderBottom: "1px solid rgba(41,211,255,0.1)",
          minHeight: 60, maxHeight: 90, overflowY: "auto"
        }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#4C6478", letterSpacing: 2, marginBottom: 7 }}>
            SIRA RESPONSE
          </div>
          <div style={{ fontSize: 13, color: "#B7C4D1", lineHeight: 1.7 }}>{response}</div>
        </div>

        <div style={{ padding: "16px 22px" }}>
          <div style={{ display: "flex", gap: 9, marginBottom: 12 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && askSira(input)}
              placeholder="Ask SIRA..."
              style={{
                flex: 1, background: "#060A11", border: "1px solid rgba(41,211,255,0.18)",
                borderRadius: 10, padding: "11px 15px", color: "#F2F6FA", fontSize: 12.5,
                outline: "none", fontFamily: "'IBM Plex Mono',monospace"
              }}
            />
            <button onClick={() => askSira(input)} disabled={loading || !input.trim()} style={{
              padding: "11px 20px", background: "linear-gradient(135deg,#29D3FF,#1FA8CC)",
              border: "none", borderRadius: 10, color: "#04121C", fontSize: 10, fontWeight: 700,
              letterSpacing: 1.5, cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              opacity: loading || !input.trim() ? 0.5 : 1, fontFamily: "'IBM Plex Mono',monospace"
            }}>SEND</button>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={startListening} disabled={listening} style={{
              flex: 1, padding: "9px", background: listening ? "rgba(139,124,255,0.15)" : "rgba(139,124,255,0.05)",
              border: "1px solid rgba(139,124,255,0.3)", borderRadius: 10, color: "#8B7CFF",
              fontSize: 9, letterSpacing: 1, cursor: "pointer", fontFamily: "'IBM Plex Mono',monospace"
            }}>
              {listening ? "◎ LISTENING..." : "◎ VOICE INPUT"}
            </button>
            <button onClick={stopSpeaking} style={{
              padding: "9px 16px", background: "rgba(225,85,84,0.06)", border: "1px solid rgba(225,85,84,0.25)",
              borderRadius: 10, color: "#E15554", fontSize: 9, cursor: "pointer", fontFamily: "'IBM Plex Mono',monospace"
            }}>■ STOP</button>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[
              "Current threat level?",
              "Who is attacking us?",
              "What should I do?",
              "Run full analysis"
            ].map((q, i) => (
              <button key={i} onClick={() => askSira(q)} style={{
                fontSize: 8.5, padding: "5px 11px", borderRadius: 20,
                border: "1px solid rgba(41,211,255,0.12)", background: "rgba(41,211,255,0.03)",
                color: "#4C6478", cursor: "pointer", letterSpacing: 0.5,
                fontFamily: "'IBM Plex Mono',monospace", textTransform: "uppercase", transition: "all 0.15s"
              }}
              onMouseEnter={e => { e.target.style.borderColor = "rgba(41,211,255,0.4)"; e.target.style.color = "#29D3FF"; }}
              onMouseLeave={e => { e.target.style.borderColor = "rgba(41,211,255,0.12)"; e.target.style.color = "#4C6478"; }}
              >{q}</button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
