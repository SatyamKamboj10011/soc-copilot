import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from "react";

const FLASK_URL = "http://localhost:5000";

/**
 * Docked SIRA presence card in the sidebar. Reacts automatically to
 * whatever the main chat produces (parent calls ref.current.speak(text)).
 * Also offers a manual stop and a button to open the full SiraVoice
 * modal for a focused conversation, separate from the passive card.
 */
const SiraAvatar = forwardRef(function SiraAvatar({ onOpenFullView }, ref) {
  const [status, setStatus] = useState("standby"); // standby | generating | speaking

  const videoRef      = useRef(null);
  const audioCtxRef   = useRef(null);
  const analyserRef   = useRef(null);
  const graphReadyRef = useRef(false);
  const currentUrlRef = useRef(null);

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
    graphReadyRef.current = true;
  };

  const returnToIdle = () => {
    setStatus("standby");
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  };

  const speak = async (text) => {
    if (!text || !text.trim()) return;
    setStatus("generating");
    returnToIdle();
    setStatus("generating"); // returnToIdle resets to standby -- re-assert
    try {
      const res = await fetch(`${FLASK_URL}/sira-face-speak`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.substring(0, 500) }),
      });
      if (!res.ok) throw new Error("face-speak failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current);
      currentUrlRef.current = url;

      const video = videoRef.current;
      ensureAudioGraph();
      video.muted = false;
      video.src = url;
      video.load();
      video.onended = returnToIdle;
      video.onerror = returnToIdle;
      setStatus("speaking");
      await video.play();
    } catch {
      returnToIdle();
    }
  };

  useImperativeHandle(ref, () => ({ speak, stop: returnToIdle }));

  useEffect(() => () => { if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current); }, []);

  const statusColor = status === "speaking" ? "#29D3FF" : status === "generating" ? "#F0A857" : "#22D97A";
  const statusLabel = status === "speaking" ? "SPEAKING" : status === "generating" ? "GENERATING" : "STANDBY";
  const busy = status !== "standby";

  return (
    <div style={{ marginBottom: 20 }}>
      <div className="section-label" style={{ padding: 0, marginBottom: 10 }}>SIRA</div>
      <div style={{
        position: "relative", borderRadius: 10, overflow: "hidden",
        border: `1px solid ${busy ? statusColor : "var(--border)"}`,
        background: "var(--bg3)", padding: "20px 12px 14px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
        transition: "border-color 0.2s",
      }}>
        <video
          ref={videoRef}
          playsInline
          poster="/sira_face.jpg"
          style={{
            width: 140, height: 140, borderRadius: 12, objectFit: "cover",
            border: `2px solid ${statusColor}`,
            filter: status === "generating" ? "brightness(0.85) saturate(0.7)" : "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor, boxShadow: `0 0 5px ${statusColor}` }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 8, letterSpacing: 1.5, color: statusColor }}>{statusLabel}</span>
        </div>

        <div style={{ display: "flex", gap: 6, width: "100%" }}>
          <button
            onClick={returnToIdle}
            disabled={!busy}
            style={{
              flex: 1, padding: "7px 0", borderRadius: 8,
              background: busy ? "var(--red-dim)" : "var(--bg3)",
              border: `1px solid ${busy ? "rgba(225,85,84,0.4)" : "var(--border)"}`,
              color: busy ? "var(--red)" : "var(--text-dim)",
              fontFamily: "var(--mono)", fontSize: 8, letterSpacing: 1,
              cursor: busy ? "pointer" : "not-allowed", opacity: busy ? 1 : 0.5,
            }}
          >■ STOP</button>
          <button
            onClick={onOpenFullView}
            style={{
              flex: 1, padding: "7px 0", borderRadius: 8,
              background: "var(--accent-dim)", border: "1px solid var(--border2)",
              color: "var(--accent)", fontFamily: "var(--mono)", fontSize: 8, letterSpacing: 1,
              cursor: "pointer",
            }}
          >⛶ OPEN</button>
        </div>
      </div>
    </div>
  );
});

export default SiraAvatar;