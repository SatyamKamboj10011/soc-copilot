import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";

const FLASK_URL = "https://soc-copilot.onrender.com";

/**
 * Docked SIRA presence card in the sidebar. Reacts automatically to
 * whatever the main chat produces (parent calls ref.current.speak(text)).
 * The "OPEN" button expands this into a floating, draggable panel (reusing
 * the app's .float-panel styles) instead of a separate blocking modal --
 * you can keep working with everything behind it.
 *
 * The <video> element only ever exists in one place (docked card OR
 * floating panel), so expanding/collapsing re-mounts it. That drops the
 * WebAudio graph's binding to the old node, so graphReadyRef is reset on
 * every expand/collapse toggle -- the next speak() call rebuilds it
 * against whichever <video> is currently mounted.
 */
const SiraAvatar = forwardRef(function SiraAvatar({ onOpenFullView }, ref) {
  const [status, setStatus]     = useState("standby"); // standby | generating | speaking
  const [expanded, setExpanded] = useState(false);
  const [lastText, setLastText] = useState("");
  const [panelPos, setPanelPos] = useState(null); // null = default corner; {x,y} once dragged
  const [needsUnmute, setNeedsUnmute] = useState(false);

  const videoRef      = useRef(null);
  const audioCtxRef   = useRef(null);
  const analyserRef   = useRef(null);
  const graphReadyRef = useRef(false);
  const currentUrlRef = useRef(null);

  // The mounted <video> node changes identity whenever we switch between
  // the docked card and the floating panel -- force the WebAudio graph
  // to rebuild against whichever one is live now.
  useEffect(() => { graphReadyRef.current = false; }, [expanded]);

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
    setNeedsUnmute(false);
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  };

  const speak = async (text) => {
    if (!text || !text.trim()) return;
    setLastText(text);
    setStatus("generating");
    returnToIdle();
    setStatus("generating"); // returnToIdle resets to standby -- re-assert
    try {
      // Was /sira-face-speak (Kokoro -> Wav2Lip video pipeline) -- Wav2Lip
      // is out of scope for this deployment (Windows-only venv path, heavy
      // compute), so that endpoint always fails silently here. /sira-speak
      // is the plain edge-tts audio endpoint, which actually works. The
      // <video> element below still plays this fine as audio -- it just
      // shows the static poster image instead of lip-synced video, which
      // is the accepted trade-off for having real working voice at all.
      const res = await fetch(`${FLASK_URL}/sira-speak`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.substring(0, 500) }),
      });
      if (!res.ok) throw new Error("speak failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current);
      currentUrlRef.current = url;

      const video = videoRef.current;
      ensureAudioGraph();
      // Autoplay-with-sound is gated by browser policy and the "user
      // activation" window has almost certainly expired by the time this
      // fetch resolves. Muted autoplay is always allowed regardless of
      // activation state, so start muted, then unmute right after playback
      // has actually begun -- unmuting an already-playing element doesn't
      // re-trigger the gate the way calling play() with sound from cold does.
      video.muted = true;
      video.src = url;
      video.load();
      video.onended = returnToIdle;
      video.onerror = returnToIdle;
      setStatus("speaking");
      await video.play();
      video.muted = false;
      setNeedsUnmute(false);
    } catch (err) {
      if (err && err.name === "NotAllowedError") {
        // Even muted playback got blocked (rare, very strict browser
        // settings). Don't claim we're speaking when nothing is actually
        // playing -- drop back to standby and surface a manual unmute
        // button instead. A real click is always allowed to play/unmute.
        setStatus("standby");
        setNeedsUnmute(true);
      } else {
        returnToIdle();
      }
    }
  };

  const manualUnmute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    if (video.paused) video.play().catch(() => {});
    setNeedsUnmute(false);
  };

  useImperativeHandle(ref, () => ({ speak, stop: returnToIdle }));

  useEffect(() => () => { if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current); }, []);

  // Drags the floating panel by its grip. Reads the panel's current
  // on-screen position at drag start so the first frame never jumps.
  const startPanelDrag = (e) => {
    const panelEl = e.currentTarget.closest(".float-panel");
    const rect = panelEl.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const startLeft = rect.left, startTop = rect.top;
    const onMove = (e) => {
      const nextLeft = Math.min(window.innerWidth - 60, Math.max(0, startLeft + (e.clientX - startX)));
      const nextTop  = Math.min(window.innerHeight - 40, Math.max(0, startTop + (e.clientY - startY)));
      setPanelPos({ x: nextLeft, y: nextTop });
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };

  const statusColor = status === "speaking" ? "#29D3FF" : status === "generating" ? "#F0A857" : "#22D97A";
  const statusLabel = status === "speaking" ? "SPEAKING" : status === "generating" ? "GENERATING" : "STANDBY";
  const busy = status !== "standby";

  const StopButton = ({ full }) => (
    <button
      onClick={returnToIdle}
      disabled={!busy}
      style={{
        flex: full ? undefined : 1, width: full ? "100%" : undefined,
        padding: "8px 0", borderRadius: "var(--radius-sm)",
        background: busy ? "var(--red-dim)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${busy ? "rgba(225,85,84,0.4)" : "var(--border2)"}`,
        color: busy ? "var(--red)" : "var(--text-dim)",
        fontFamily: "var(--mono)", fontSize: 8, letterSpacing: 1,
        cursor: busy ? "pointer" : "not-allowed", opacity: busy ? 1 : 0.5,
      }}
    >■ STOP</button>
  );

  // ── COLLAPSED: docked mac-style card in the sidebar ──────────────────
  if (!expanded) {
    return (
      <div style={{ marginBottom: 20 }}>
        <div className="section-label" style={{ padding: 0, marginBottom: 10 }}>SIRA</div>
        <div style={{
          position: "relative", borderRadius: "var(--radius)", overflow: "hidden",
          border: `1px solid ${busy ? statusColor : "var(--border2)"}`,
          background: "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015))",
          backdropFilter: "blur(16px) saturate(150%)", WebkitBackdropFilter: "blur(16px) saturate(150%)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.05) inset, 0 10px 24px -16px rgba(0,0,0,0.5)",
          padding: "20px 12px 14px",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
          transition: "border-color 0.2s",
        }}>
          <div style={{ position: "relative" }}>
            <video
              ref={videoRef}
              playsInline
              poster="/sira_face.jpg"
              style={{
                width: 140, height: 140, borderRadius: "var(--radius-sm)", objectFit: "cover",
                border: `2px solid ${statusColor}`,
                filter: status === "generating" ? "brightness(0.85) saturate(0.7)" : "none",
              }}
            />
            {needsUnmute && (
              <button onClick={manualUnmute} style={{
                position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
                padding: "5px 12px", borderRadius: 20, background: "rgba(240,168,87,0.15)",
                border: "1px solid var(--orange)", color: "var(--orange)",
                fontFamily: "var(--mono)", fontSize: 8, letterSpacing: 1, cursor: "pointer",
              }}>🔊 TAP TO UNMUTE</button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor, boxShadow: `0 0 5px ${statusColor}` }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 8, letterSpacing: 1.5, color: statusColor }}>{statusLabel}</span>
          </div>

          <div style={{ display: "flex", gap: 6, width: "100%" }}>
            <StopButton />
            <button
              onClick={() => setExpanded(true)}
              style={{
                flex: 1, padding: "8px 0", borderRadius: "var(--radius-sm)",
                background: "var(--accent-dim)", border: "1px solid var(--border2)",
                color: "var(--accent)", fontFamily: "var(--mono)", fontSize: 8, letterSpacing: 1,
                cursor: "pointer",
              }}
            >⛶ OPEN</button>
          </div>
        </div>
      </div>
    );
  }

  // ── EXPANDED: floating, draggable, non-blocking panel ────────────────
  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="section-label" style={{ padding: 0, marginBottom: 10 }}>SIRA</div>
        <button
          onClick={() => setExpanded(false)}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
            borderRadius: "var(--radius-sm)", background: "rgba(255,255,255,0.035)",
            border: `1px solid ${statusColor}`, cursor: "pointer", textAlign: "left",
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, boxShadow: `0 0 6px ${statusColor}`, flexShrink: 0 }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-mid)" }}>Panel open — click to dock</span>
        </button>
      </div>

      {createPortal(
        <div
          className="float-panel"
          style={panelPos
            ? { left: panelPos.x, top: panelPos.y, right: "auto", bottom: "auto" }
            : { left: 24, bottom: 24 }}
        >
          <div className="float-panel-handle">
            <div className="float-panel-grip" onMouseDown={startPanelDrag} />
          </div>
          <button className="modal-close" onClick={() => setExpanded(false)} style={{ top: 14, right: 14, zIndex: 5 }}>✕</button>

          <div className="float-panel-body" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <div style={{ position: "relative" }}>
              <video
                ref={videoRef}
                playsInline
                poster="/sira_face.jpg"
                style={{
                  width: 220, height: 220, borderRadius: "var(--radius)", objectFit: "cover",
                  border: `2px solid ${statusColor}`,
                  filter: status === "generating" ? "brightness(0.85) saturate(0.7)" : "none",
                }}
              />
              {needsUnmute && (
                <button onClick={manualUnmute} style={{
                  position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
                  padding: "6px 14px", borderRadius: 20, background: "rgba(240,168,87,0.15)",
                  border: "1px solid var(--orange)", color: "var(--orange)",
                  fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 1, cursor: "pointer",
                }}>🔊 TAP TO UNMUTE</button>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 2, color: statusColor }}>{statusLabel}</span>
            </div>

            {lastText && (
              <div style={{
                width: "100%", boxSizing: "border-box", padding: "10px 12px",
                background: "rgba(255,255,255,0.035)", border: "1px solid var(--border2)",
                borderRadius: "var(--radius-sm)", fontFamily: "var(--sans)", fontSize: 12,
                color: "var(--text-mid)", lineHeight: 1.6, maxHeight: 90, overflowY: "auto",
              }}>
                {lastText}
              </div>
            )}

            <StopButton full />
          </div>
        </div>,
        document.body
      )}
    </>
  );
});

export default SiraAvatar;