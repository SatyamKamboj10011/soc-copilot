import { useMemo } from "react";
import { SaveToDocumentButton } from "./HermesDocuments";

// ── Inline icons (no new dependency) ────────────────────────────────────
const ToolIcon = ({ tool, size = 14 }) => {
  const stroke = "currentColor";
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (tool) {
    case "get_stats":
      return <svg {...props}><path d="M3 3v18h18"/><path d="M7 15l4-6 3 3 5-8"/></svg>;
    case "get_top_ips":
      return <svg {...props}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.5" fill={stroke}/></svg>;
    case "search_logs":
      return <svg {...props}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>;
    case "check_reputation":
      return <svg {...props}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/></svg>;
    case "lookup_cve":
      return <svg {...props}><path d="M12 3l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.5" fill={stroke}/></svg>;
    case "correlate_zeek":
      return <svg {...props}><path d="M9 15l6-6"/><path d="M13 4h4a3 3 0 013 3v0a3 3 0 01-3 3h-2"/><path d="M11 20H7a3 3 0 01-3-3v0a3 3 0 013-3h2"/></svg>;
    default:
      return <svg {...props}><circle cx="12" cy="12" r="9"/></svg>;
  }
};

const CheckIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

// ── Signature element: a live signal trace. Pulses jaggedly while Hermes
//    is reasoning, settles to a flat confirmed line once a report lands.
//    This replaces a generic spinner with something that reads as "a
//    monitored process is active" — the actual job of this agent. ───────
function SignalTrace({ running, settled }) {
  const jag = "M0,18 L14,18 L20,6 L26,30 L32,10 L38,18 L52,18 L58,4 L64,32 L70,18 L86,18 L92,9 L98,27 L104,18 L120,18";
  const flat = "M0,18 L120,18";
  return (
    <svg width="100%" height="36" viewBox="0 0 120 36" preserveAspectRatio="none" style={{ display: "block" }}>
      <line x1="0" y1="18" x2="120" y2="18" stroke="var(--border2)" strokeWidth="0.5" strokeDasharray="1 3" />
      <path
        d={settled ? flat : jag}
        fill="none"
        stroke={running ? "var(--accent)" : settled ? "var(--green)" : "var(--purple)"}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={running ? { animation: "traceSweep 1.1s linear infinite" } : undefined}
      />
    </svg>
  );
}

// ── Report parsing (unchanged logic) ─────────────────────────────────────
function parseHermesReport(text) {
  const names = ["SUMMARY", "TOP THREATS", "RISK LEVEL", "CVE IMPACT", "RECOMMENDED ACTIONS"];
  const sections = {};
  for (let i = 0; i < names.length; i++) {
    const cur = names[i], next = names[i + 1];
    const start = text.indexOf(cur);
    if (start === -1) continue;
    const end = next ? text.indexOf(next) : text.length;
    sections[cur] = text.slice(start + cur.length, end !== -1 ? end : undefined).replace(/^[\s:\-]+/, "").trim();
  }
  return sections;
}

// Real SOC vernacular instead of a generic "risk" pill: Traffic Light
// Protocol classification, stamped like an actual case marking.
const TLP = {
  critical: { label: "TLP:RED", sub: "restricted — immediate action", color: "var(--red)", bg: "rgba(225,85,84,0.08)" },
  high:     { label: "TLP:AMBER", sub: "limited disclosure — act soon", color: "var(--orange)", bg: "rgba(240,168,87,0.08)" },
  medium:   { label: "TLP:GREEN", sub: "community — monitor", color: "var(--green)", bg: "rgba(34,217,122,0.08)" },
  low:      { label: "TLP:CLEAR", sub: "no restriction — informational", color: "var(--text-dim)", bg: "rgba(255,255,255,0.03)" },
};

function HermesReportView({ text }) {
  const sections = parseHermesReport(text);
  const hasStructure = Object.keys(sections).length > 0;
  const riskText = sections["RISK LEVEL"] || "";
  const riskLevel = /CRITICAL/i.test(riskText) ? "critical" : /HIGH/i.test(riskText) ? "high" : /MEDIUM/i.test(riskText) ? "medium" : "low";
  const tlp = TLP[riskLevel];

  if (!hasStructure) {
    return <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mid)", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>{text}</div>;
  }

  const blocks = [
    { key: "SUMMARY", label: "Summary" },
    { key: "TOP THREATS", label: "Top Threats" },
    { key: "CVE IMPACT", label: "CVE Impact" },
  ];

  const actionLines = (sections["RECOMMENDED ACTIONS"] || "").split("\n").map(l => l.trim()).filter(l => /^\d+\./.test(l));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* TLP classification stamp */}
      <div style={{ display: "flex", alignItems: "stretch", borderRadius: 10, overflow: "hidden", border: `1px solid ${tlp.color}`, background: tlp.bg }}>
        <div style={{ width: 6, background: tlp.color, flexShrink: 0 }} />
        <div style={{ padding: "10px 14px", flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, letterSpacing: 1.5, color: tlp.color, fontWeight: 700 }}>{tlp.label}</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--text-dim)", flex: 1 }}>{tlp.sub}</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-dim)", opacity: 0.7 }}>{riskText.replace(/^(CRITICAL|HIGH|MEDIUM|LOW)[\s\-—:]*/i, "").slice(0, 40)}</span>
        </div>
      </div>

      {blocks.map(b => sections[b.key] && (
        <div key={b.key}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 2, color: "var(--purple)", marginBottom: 6, textTransform: "uppercase" }}>{b.label}</div>
          <div style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--text-mid)", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
            {sections[b.key].split(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g).map((part, i) =>
              /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(part)
                ? <span key={i} style={{ color: "var(--red)", fontWeight: 700, fontFamily: "var(--mono)" }}>{part}</span>
                : part
            )}
          </div>
        </div>
      ))}

      {actionLines.length > 0 && (
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 2, color: "var(--purple)", marginBottom: 8, textTransform: "uppercase" }}>Recommended Actions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {actionLines.map((line, i) => {
              const stripped = line.replace(/^\d+\.\s*/, "");
              const tags = ["Immediate", "Short term", "Long term"];
              return (
                <div key={i} style={{ display: "flex", gap: 10, padding: "9px 12px", borderRadius: 8, background: "var(--bg3)", border: "1px solid var(--border)" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 8, color: "var(--purple)", letterSpacing: 1, flexShrink: 0, minWidth: 62 }}>{tags[i] || `Step ${i + 1}`}</span>
                  <span style={{ fontFamily: "var(--sans)", fontSize: 11.5, color: "var(--text)", lineHeight: 1.6 }}>{stripped}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Chain-of-custody log — replaces the icon timeline with a numbered
//    evidence ledger, the way an investigator's case log actually reads:
//    entry number, tool used, and what it returned. ───────────────────────
function HermesLedger({ steps, running }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "var(--bg3)", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: 1.5, color: "var(--text-dim)", textTransform: "uppercase" }}>Chain of custody</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 8.5, color: "var(--text-dim)" }}>{steps.length} {steps.length === 1 ? "entry" : "entries"}</span>
      </div>
      <div>
        {steps.map((step, i) => (
          <div key={i} style={{ display: "flex", gap: 10, padding: "9px 12px", borderBottom: i < steps.length - 1 || running ? "1px solid var(--border)" : "none", alignItems: "flex-start" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--text-dim)", minWidth: 22, paddingTop: 1 }}>{String(i + 1).padStart(2, "0")}</span>
            <span style={{ color: "var(--purple)", flexShrink: 0, paddingTop: 1 }}><ToolIcon tool={step.tool} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text)", fontWeight: 700 }}>{step.tool}</span>
                {step.input && <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--text-dim)" }}>({step.input})</span>}
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--text-mid)", lineHeight: 1.6, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {step.result}
              </div>
            </div>
            <span style={{ color: "var(--green)", flexShrink: 0, paddingTop: 2 }}><CheckIcon /></span>
          </div>
        ))}
        {running && (
          <div style={{ display: "flex", gap: 10, padding: "9px 12px", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--text-dim)", minWidth: 22 }}>{String(steps.length + 1).padStart(2, "0")}</span>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", animation: "pulseDot 1s ease-in-out infinite" }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--accent)", letterSpacing: 0.5 }}>selecting next tool…</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Full modal ────────────────────────────────────────────────────────
export function HermesModal({ hermesOpen, setHermesOpen, hermesLoading, hermesTask, setHermesTask, startHermes, hermesSteps, hermesAnswer, setHermesAnswer, setHermesSteps, showToast, username }) {
  const caseId = useMemo(() => {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const suffix = Math.random().toString(16).slice(2, 6).toUpperCase();
    return `SC-${stamp}-${suffix}`;
  }, [hermesOpen]);

  if (!hermesOpen) return null;

  const settled = !!hermesAnswer && !hermesLoading;

  return (
    <div className="modal-overlay" onClick={() => { if (!hermesLoading) setHermesOpen(false); }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 660, maxHeight: "88vh", border: "1px solid rgba(139,124,255,0.25)", display: "flex", flexDirection: "column" }}>
        <button className="modal-close" onClick={() => { if (!hermesLoading) setHermesOpen(false); }}>✕</button>

        {/* Case header */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#8B7CFF,#6A54D9)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L3 9l6-1z" /></svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--display)", fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Hermes</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 8, color: "var(--text-dim)", letterSpacing: 1 }}>autonomous investigation agent</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--purple)", letterSpacing: 1 }}>{caseId}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 8, color: hermesLoading ? "var(--accent)" : settled ? "var(--green)" : "var(--text-dim)", letterSpacing: 1.5, textTransform: "uppercase" }}>
                {hermesLoading ? "active" : settled ? "closed" : "standby"}
              </div>
            </div>
          </div>
          {/* Signal trace strip — the live pulse of the investigation */}
          <div style={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg3)", padding: "2px 10px" }}>
            <SignalTrace running={hermesLoading} settled={settled} />
          </div>
        </div>

        {/* Intake */}
        {!hermesLoading && !hermesAnswer && (
          <div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: 1.5, color: "var(--text-dim)", textTransform: "uppercase", marginBottom: 8 }}>Open a new case</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <input value={hermesTask} onChange={e => setHermesTask(e.target.value)}
                onKeyDown={e => e.key === "Enter" && hermesTask.trim() && startHermes()}
                placeholder="e.g. Investigate 185.220.101.45"
                style={{ flex: 1, background: "var(--bg3)", border: "1px solid rgba(139,124,255,0.25)", borderRadius: 10, padding: "11px 14px", color: "var(--text)", fontFamily: "var(--mono)", fontSize: 11, outline: "none" }} />
              <button onClick={startHermes} disabled={!hermesTask.trim()} style={{ padding: "11px 20px", background: "linear-gradient(135deg,#8B7CFF,#6A54D9)", border: "none", borderRadius: 10, color: "white", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: 1, cursor: "pointer", opacity: hermesTask.trim() ? 1 : 0.4 }}>OPEN CASE</button>
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 8, letterSpacing: 1, color: "var(--text-dim)", textTransform: "uppercase", marginBottom: 6 }}>Common leads</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {["Investigate the entire network", "Who is attacking us right now?", "Give me a full threat assessment", "What is the most dangerous IP?"].map((t, i) => (
                <button key={i} onClick={() => setHermesTask(t)} style={{ fontFamily: "var(--mono)", fontSize: 8.5, padding: "6px 12px", borderRadius: 20, border: "1px solid rgba(139,124,255,0.25)", background: "var(--purple-dim)", color: "var(--text-mid)", cursor: "pointer" }}>{t}</button>
              ))}
            </div>
          </div>
        )}

        {/* Ledger + report, scrollable */}
        <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
          {(hermesLoading || (hermesAnswer && hermesSteps.length > 0)) && (
            <div style={{ marginBottom: hermesAnswer ? 16 : 0 }}>
              <HermesLedger steps={hermesSteps} running={hermesLoading} />
            </div>
          )}

          {hermesAnswer && !hermesLoading && (
            <div style={{ background: "var(--bg3)", border: "1px solid rgba(139,124,255,0.2)", borderRadius: 12, padding: 16 }}>
              <HermesReportView text={hermesAnswer} />
            </div>
          )}
        </div>

        {hermesAnswer && !hermesLoading && (
          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexShrink: 0 }}>
            <button onClick={() => { setHermesAnswer(""); setHermesSteps([]); }} style={{ flex: 1, padding: "9px", background: "transparent", border: "1px solid var(--border2)", borderRadius: 10, color: "var(--text-mid)", fontFamily: "var(--mono)", fontSize: 9, cursor: "pointer", letterSpacing: 1 }}>NEW CASE</button>
            <button onClick={() => { navigator.clipboard.writeText(hermesAnswer); showToast("Report copied"); }} style={{ flex: 1, padding: "9px", background: "var(--purple-dim)", border: "1px solid var(--purple)", borderRadius: 10, color: "var(--purple)", fontFamily: "var(--mono)", fontSize: 9, cursor: "pointer", letterSpacing: 1 }}>COPY</button>
            <SaveToDocumentButton username={username} content={hermesAnswer} sourceQuery={hermesTask} />
          </div>
        )}

        <style>{`
          @keyframes traceSweep {
            0% { stroke-dasharray: 0 400; }
            60% { stroke-dasharray: 400 400; }
            100% { stroke-dasharray: 400 400; }
          }
          @keyframes pulseDot {
            0%, 100% { opacity: 0.3; transform: scale(0.85); }
            50% { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </div>
    </div>
  );
}