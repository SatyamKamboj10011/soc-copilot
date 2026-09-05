import { useState, useEffect } from "react";

const FLASK_URL = "https://api.sira-soc.me";

/**
 * Every number, timestamp, and activity-feed entry here comes straight
 * from /pipeline-status -- nothing is simulated. The connector pulse
 * animation only plays on a connector when the stage it leads INTO is
 * genuinely active right now (currently_active / in_progress /
 * currently_processing, all real backend flags) -- so highlighting
 * reflects actual in-flight work, not a decorative loop.
 */
export default function PipelineStatus() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = () => {
      fetch(`${FLASK_URL}/pipeline-status`)
        .then(r => r.json())
        .then(setStatus)
        .catch(() => {})
        .finally(() => setLoading(false));
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 8000);
    return () => clearInterval(interval);
  }, []);

  const timeAgo = (iso) => {
    if (!iso) return "never";
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  const clockTime = (iso) => iso ? new Date(iso).toLocaleTimeString() : "—";

  const sync = status?.honeypot_sync || {};
  const rebuild = status?.index_rebuild || {};
  const chat = status?.chat_activity || {};
  const breakdown = status?.current_event_breakdown || {};

  const EVENT_TYPE_COLOR = { connected: "#22D97A", pulled: "#29D3FF", error: "#E15554", rotated: "#F0A857", started: "#F0A857", completed: "#22D97A", received: "#8B7CFF" };

  const nodes = status ? [
    {
      label: "HONEYPOT", sublabel: "Suricata + Zeek (Azure)",
      ok: sync.connected, active: sync.currently_active,
      statusText: sync.connected ? "CONNECTED" : "DISCONNECTED",
      detail: sync.connected ? `Since ${timeAgo(sync.last_connected_at)}` : (sync.last_error || "No connection yet"),
      events: sync.recent_events || [],
    },
    {
      label: "SYNC", sublabel: "SFTP pull, every 15s",
      ok: sync.last_pull_at && (Date.now() - new Date(sync.last_pull_at).getTime()) < 120000,
      active: sync.currently_active,
      statusText: sync.currently_active ? "SYNCING NOW" : (sync.last_pull_bytes ? `+${sync.last_pull_bytes.toLocaleString()}B` : "NO DATA"),
      detail: `Last pull ${timeAgo(sync.last_pull_at)}`,
      events: sync.recent_events || [],
    },
    {
      label: "INDEX", sublabel: "ChromaDB (Gemini embeddings)",
      ok: status.chromadb_reachable, active: rebuild.in_progress,
      statusText: rebuild.in_progress ? "REBUILDING NOW" : (status.chromadb_reachable ? "READY" : "UNREACHABLE"),
      detail: `${status.current_indexed_events?.toLocaleString() ?? 0} events — rebuilt ${timeAgo(rebuild.last_rebuilt_at)}`,
      events: rebuild.recent_events || [],
      breakdown,
    },
    {
      label: "CHAT", sublabel: "SIRA + Hermes reasoning",
      ok: true, active: chat.currently_processing,
      statusText: chat.currently_processing ? "PROCESSING NOW" : `${status.total_ask_requests_served ?? 0} SERVED`,
      detail: "Total requests since this instance started",
      events: chat.recent_requests || [],
    },
  ] : [];

  return (
    <div style={{ width: "100%", height: "100%", overflowY: "auto", padding: 28, boxSizing: "border-box", background: "var(--bg, #060A11)" }}>
      <style>{`
        @keyframes pipe-pulse-active {
          0%   { background-position: 0% 0; opacity: 1; }
          100% { background-position: 200% 0; opacity: 1; }
        }
        .pipe-connector-active {
          background: linear-gradient(90deg, transparent 0%, #22D97A 50%, transparent 100%);
          background-size: 200% 100%;
          animation: pipe-pulse-active 1s linear infinite;
        }
        .pipe-connector-idle { background: rgba(255,255,255,0.08); }
        @keyframes live-badge-pulse {
          0%, 100% { opacity: 1; } 50% { opacity: 0.4; }
        }
      `}</style>

      <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 10, color: "var(--text-dim, #5A5A62)", letterSpacing: 2, marginBottom: 6 }}>
        LIVE DATA PIPELINE — EXTENDED VIEW
      </div>
      <div style={{ fontFamily: "var(--display, sans-serif)", fontSize: 20, fontWeight: 700, color: "var(--text, #F2F6FA)", marginBottom: 24 }}>
        How SIRA actually works, right now
      </div>

      {loading && (
        <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 11, color: "var(--accent, #29D3FF)" }}>◈ Loading real pipeline state...</div>
      )}

      {!loading && status && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 0, flexWrap: "wrap" }}>
          {nodes.map((node, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start" }}>
              <div style={{
                width: 280, borderRadius: 14,
                background: "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015))",
                border: `1px solid ${node.ok ? "rgba(34,217,122,0.35)" : "rgba(225,85,84,0.35)"}`,
                boxShadow: "0 10px 24px -16px rgba(0,0,0,0.5)",
                overflow: "hidden",
              }}>
                <div style={{ padding: 18, paddingBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: node.ok ? "#22D97A" : "#E15554",
                        boxShadow: `0 0 8px ${node.ok ? "#22D97A" : "#E15554"}`,
                      }} />
                      <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 10, letterSpacing: 1.5, color: "var(--text, #F2F6FA)", fontWeight: 700 }}>{node.label}</span>
                    </div>
                    {node.active && (
                      <span style={{
                        fontFamily: "var(--mono, monospace)", fontSize: 8, letterSpacing: 1, color: "#22D97A",
                        border: "1px solid rgba(34,217,122,0.4)", borderRadius: 20, padding: "2px 7px",
                        animation: "live-badge-pulse 1.2s ease-in-out infinite",
                      }}>● LIVE</span>
                    )}
                  </div>
                  <div style={{ fontFamily: "var(--sans, sans-serif)", fontSize: 10, color: "var(--text-dim, #5A5A62)", marginBottom: 10 }}>{node.sublabel}</div>
                  <div style={{
                    fontFamily: "var(--mono, monospace)", fontSize: 11, fontWeight: 700,
                    color: node.ok ? "#22D97A" : "#E15554", marginBottom: 6,
                  }}>{node.statusText}</div>
                  <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 9, color: "var(--text-dim, #5A5A62)", lineHeight: 1.5 }}>{node.detail}</div>

                  {node.breakdown && Object.keys(node.breakdown).length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
                      {Object.entries(node.breakdown).map(([type, count]) => (
                        <span key={type} style={{
                          fontFamily: "var(--mono, monospace)", fontSize: 8, padding: "2px 6px", borderRadius: 10,
                          background: "rgba(255,255,255,0.05)", color: "var(--text-mid, #8FA3B5)",
                        }}>{type}: {count}</span>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "10px 18px 14px", background: "rgba(0,0,0,0.15)" }}>
                  <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 8, color: "var(--text-dim, #5A5A62)", letterSpacing: 1, marginBottom: 8 }}>
                    RECENT ACTIVITY {node.events.length === 0 && "(none yet)"}
                  </div>
                  <div style={{ maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                    {[...node.events].reverse().map((e, ei) => (
                      <div key={ei} style={{ fontFamily: "var(--mono, monospace)", fontSize: 8.5, lineHeight: 1.4 }}>
                        <span style={{ color: "var(--text-dim, #5A5A62)" }}>{clockTime(e.at)}</span>{" "}
                        <span style={{ color: EVENT_TYPE_COLOR[e.type] || EVENT_TYPE_COLOR[e.outcome?.split(" ")[0]] || "var(--text-mid, #8FA3B5)", fontWeight: 700 }}>
                          {(e.type || "event").toUpperCase()}
                        </span>{" "}
                        <span style={{ color: "var(--text-mid, #8FA3B5)" }}>
                          {e.detail || e.outcome || e.question_preview || ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {i < nodes.length - 1 && (
                <div
                  className={nodes[i + 1].active ? "pipe-connector-active" : "pipe-connector-idle"}
                  style={{ width: 36, height: 2, flexShrink: 0, marginTop: 28 }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && status && (
        <div style={{ marginTop: 24, fontFamily: "var(--mono, monospace)", fontSize: 9, color: "var(--text-dim, #5A5A62)", letterSpacing: 1 }}>
          Refreshes every 8s. The green "LIVE" badge and glowing connector only appear on a stage while it's genuinely doing real work right now — not decorative. Every activity-feed entry is a real event that actually happened, with its real timestamp.
        </div>
      )}
    </div>
  );
}
