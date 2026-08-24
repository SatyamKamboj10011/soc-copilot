import { SaveToDocumentButton } from "./HermesDocuments";

// ── Inline icons (no new dependency) ────────────────────────────────────
const ToolIcon = ({ tool, size = 15 }) => {
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

const Spinner = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: "hspin 0.8s linear infinite" }}>
    <path d="M12 3a9 9 0 019 9" />
  </svg>
);

const CheckIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

// ── Report section parsing (mirrors SiraMessage's approach) ─────────────
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

function HermesReportView({ text }) {
  const sections = parseHermesReport(text);
  const hasStructure = Object.keys(sections).length > 0;
  const riskText = sections["RISK LEVEL"] || "";
  const riskLevel = /CRITICAL/i.test(riskText) ? "critical" : /HIGH/i.test(riskText) ? "high" : /MEDIUM/i.test(riskText) ? "medium" : "low";
  const riskColor = riskLevel === "low" ? "var(--green)" : riskLevel === "medium" ? "var(--orange)" : "var(--red)";

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
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, background: `rgba(${riskLevel === "low" ? "34,217,122" : riskLevel === "medium" ? "240,168,87" : "225,85,84"},0.08)`, border: `1px solid ${riskColor}` }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: riskColor, flexShrink: 0 }} />
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 1.5, color: riskColor, fontWeight: 700 }}>{riskLevel.toUpperCase()} RISK</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-dim)", flex: 1 }}>{riskText.replace(/^(CRITICAL|HIGH|MEDIUM|LOW)[\s\-—:]*/i, "")}</span>
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

// ── Timeline (steps connected by a line — meaningful now that the agent
//    genuinely reasons step by step, not a fixed pipeline) ──────────────
function HermesTimeline({ steps, running }) {
  return (
    <div style={{ position: "relative", paddingLeft: 4 }}>
      {steps.map((step, i) => (
        <div key={i} style={{ display: "flex", gap: 12, position: "relative", paddingBottom: 16 }}>
          {i < steps.length - 1 || running ? (
            <div style={{ position: "absolute", left: 15, top: 32, bottom: -4, width: 1, background: "rgba(139,124,255,0.22)" }} />
          ) : null}
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "var(--purple-dim)", border: "1px solid rgba(139,124,255,0.35)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--purple)", flexShrink: 0, zIndex: 1 }}>
            <ToolIcon tool={step.tool} />
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text)", fontWeight: 700 }}>{step.tool}</span>
              {step.input && <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-dim)" }}>({step.input})</span>}
              <CheckIcon size={11} />
              <span style={{ color: "var(--green)" }} />
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--text-mid)", lineHeight: 1.6, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              {step.result}
            </div>
          </div>
        </div>
      ))}
      {running && (
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "var(--accent-dim)", border: "1px solid rgba(41,211,255,0.35)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)", flexShrink: 0, zIndex: 1 }}>
            <Spinner />
          </div>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--accent)", letterSpacing: 1 }}>deciding next step…</span>
        </div>
      )}
    </div>
  );
}

// ── Full modal — swap in place of the existing {hermesOpen && (...)} block
export function HermesModal({ hermesOpen, setHermesOpen, hermesLoading, hermesTask, setHermesTask, startHermes, hermesSteps, hermesAnswer, setHermesAnswer, setHermesSteps, showToast, username }) {
  if (!hermesOpen) return null;
  return (
    <div className="modal-overlay" onClick={() => { if (!hermesLoading) setHermesOpen(false); }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 640, maxHeight: "88vh", border: "1px solid rgba(139,124,255,0.25)" }}>
        <button className="modal-close" onClick={() => { if (!hermesLoading) setHermesOpen(false); }}>✕</button>

        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid rgba(139,124,255,0.18)" }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#8B7CFF,#6A54D9)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", flexShrink: 0 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L3 9l6-1z" /></svg>
          </div>
          <div>
            <div style={{ fontFamily: "var(--display)", fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Hermes</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 8, color: "var(--text-dim)", letterSpacing: 1 }}>autonomous investigation agent</div>
          </div>
          {hermesLoading && (
            <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 9, color: "var(--purple)", letterSpacing: 1, display: "flex", alignItems: "center", gap: 6 }}>
              <Spinner size={11} /> INVESTIGATING
            </span>
          )}
          {hermesAnswer && !hermesLoading && (
            <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 9, color: "var(--green)", letterSpacing: 1, display: "flex", alignItems: "center", gap: 6 }}>
              <CheckIcon size={11} /> COMPLETE
            </span>
          )}
        </div>

        {!hermesLoading && !hermesAnswer && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <input value={hermesTask} onChange={e => setHermesTask(e.target.value)}
                onKeyDown={e => e.key === "Enter" && hermesTask.trim() && startHermes()}
                placeholder="e.g. Investigate 185.220.101.45"
                style={{ flex: 1, background: "var(--bg3)", border: "1px solid rgba(139,124,255,0.25)", borderRadius: 10, padding: "11px 14px", color: "var(--text)", fontFamily: "var(--mono)", fontSize: 11, outline: "none" }} />
              <button onClick={startHermes} disabled={!hermesTask.trim()} style={{ padding: "11px 20px", background: "linear-gradient(135deg,#8B7CFF,#6A54D9)", border: "none", borderRadius: 10, color: "white", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: 1, cursor: "pointer", opacity: hermesTask.trim() ? 1 : 0.4 }}>RUN</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {["Investigate the entire network", "Who is attacking us right now?", "Give me a full threat assessment", "What is the most dangerous IP?"].map((t, i) => (
                <button key={i} onClick={() => setHermesTask(t)} style={{ fontFamily: "var(--mono)", fontSize: 8.5, padding: "6px 12px", borderRadius: 20, border: "1px solid rgba(139,124,255,0.25)", background: "var(--purple-dim)", color: "var(--text-mid)", cursor: "pointer" }}>{t}</button>
              ))}
            </div>
          </div>
        )}

        {(hermesLoading || (hermesAnswer && hermesSteps.length > 0)) && (
          <div style={{ marginBottom: hermesAnswer ? 18 : 0 }}>
            <HermesTimeline steps={hermesSteps} running={hermesLoading} />
          </div>
        )}

        {hermesAnswer && !hermesLoading && (
          <div>
            <div style={{ background: "var(--bg3)", border: "1px solid rgba(139,124,255,0.2)", borderRadius: 12, padding: 16, maxHeight: 340, overflowY: "auto" }}>
              <HermesReportView text={hermesAnswer} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
              <button onClick={() => { setHermesAnswer(""); setHermesSteps([]); }} style={{ flex: 1, padding: "9px", background: "transparent", border: "1px solid var(--border2)", borderRadius: 10, color: "var(--text-mid)", fontFamily: "var(--mono)", fontSize: 9, cursor: "pointer", letterSpacing: 1 }}>NEW INVESTIGATION</button>
              <button onClick={() => { navigator.clipboard.writeText(hermesAnswer); showToast("Report copied"); }} style={{ flex: 1, padding: "9px", background: "var(--purple-dim)", border: "1px solid var(--purple)", borderRadius: 10, color: "var(--purple)", fontFamily: "var(--mono)", fontSize: 9, cursor: "pointer", letterSpacing: 1 }}>COPY</button>
              <SaveToDocumentButton username={username} content={hermesAnswer} sourceQuery={hermesTask} />
            </div>
          </div>
        )}

        <style>{`@keyframes hspin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );
}
