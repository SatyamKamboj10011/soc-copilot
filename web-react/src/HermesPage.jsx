import { useState } from "react";
import { useHermes } from "./HermesContext";
import { HermesDocumentsPanel, SaveToDocumentButton } from "./HermesDocuments";

/* ==================== Icons ==================== */

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

/* ==================== Signal trace (per active case) ==================== */

function SignalTrace({ running, settled, error }) {
  const jag = "M0,18 L14,18 L20,6 L26,30 L32,10 L38,18 L52,18 L58,4 L64,32 L70,18 L86,18 L92,9 L98,27 L104,18 L120,18";
  const flat = "M0,18 L120,18";
  const color = error ? "var(--red, #E15554)" : running ? "var(--accent, #29D3FF)" : settled ? "var(--green, #22D97A)" : "var(--purple, #8B7CFF)";
  return (
    <svg width="100%" height="34" viewBox="0 0 120 36" preserveAspectRatio="none" style={{ display: "block" }}>
      <line x1="0" y1="18" x2="120" y2="18" stroke="var(--border2, rgba(255,255,255,0.12))" strokeWidth="0.5" strokeDasharray="1 3" />
      <path
        d={running ? jag : flat}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={running ? { animation: "traceSweep 1.1s linear infinite" } : undefined}
      />
    </svg>
  );
}

/* ==================== Report parsing + TLP stamp ==================== */

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

const TLP = {
  critical: { label: "TLP:RED", sub: "restricted — immediate action", color: "var(--red, #E15554)", bg: "rgba(225,85,84,0.08)" },
  high:     { label: "TLP:AMBER", sub: "limited disclosure — act soon", color: "var(--orange, #F0A857)", bg: "rgba(240,168,87,0.08)" },
  medium:   { label: "TLP:GREEN", sub: "community — monitor", color: "var(--green, #22D97A)", bg: "rgba(34,217,122,0.08)" },
  low:      { label: "TLP:CLEAR", sub: "no restriction — informational", color: "var(--text-dim, #5A5A62)", bg: "rgba(255,255,255,0.03)" },
};

function HermesReportView({ text }) {
  const sections = parseHermesReport(text);
  const hasStructure = Object.keys(sections).length > 0;
  const riskText = sections["RISK LEVEL"] || "";
  const riskLevel = /CRITICAL/i.test(riskText) ? "critical" : /HIGH/i.test(riskText) ? "high" : /MEDIUM/i.test(riskText) ? "medium" : "low";
  const tlp = TLP[riskLevel];

  if (!hasStructure) {
    return <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 11, color: "var(--text-mid, #9A9AA2)", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>{text}</div>;
  }

  const blocks = [
    { key: "SUMMARY", label: "Summary" },
    { key: "TOP THREATS", label: "Top Threats" },
    { key: "CVE IMPACT", label: "CVE Impact" },
  ];
  const actionLines = (sections["RECOMMENDED ACTIONS"] || "").split("\n").map(l => l.trim()).filter(l => /^\d+\./.test(l));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "stretch", borderRadius: 10, overflow: "hidden", border: `1px solid ${tlp.color}`, background: tlp.bg }}>
        <div style={{ width: 6, background: tlp.color, flexShrink: 0 }} />
        <div style={{ padding: "10px 14px", flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 12, letterSpacing: 1.5, color: tlp.color, fontWeight: 700 }}>{tlp.label}</span>
          <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 9.5, color: "var(--text-dim, #5A5A62)", flex: 1 }}>{tlp.sub}</span>
        </div>
      </div>

      {blocks.map(b => sections[b.key] && (
        <div key={b.key}>
          <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 9, letterSpacing: 2, color: "var(--purple, #8B7CFF)", marginBottom: 6, textTransform: "uppercase" }}>{b.label}</div>
          <div style={{ fontFamily: "var(--sans, Inter, sans-serif)", fontSize: 12, color: "var(--text-mid, #9A9AA2)", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
            {sections[b.key].split(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g).map((part, i) =>
              /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(part)
                ? <span key={i} style={{ color: "var(--red, #E15554)", fontWeight: 700, fontFamily: "var(--mono, monospace)" }}>{part}</span>
                : part
            )}
          </div>
        </div>
      ))}

      {actionLines.length > 0 && (
        <div>
          <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 9, letterSpacing: 2, color: "var(--purple, #8B7CFF)", marginBottom: 8, textTransform: "uppercase" }}>Recommended Actions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {actionLines.map((line, i) => {
              const stripped = line.replace(/^\d+\.\s*/, "");
              const tags = ["Immediate", "Short term", "Long term"];
              return (
                <div key={i} style={{ display: "flex", gap: 10, padding: "9px 12px", borderRadius: 8, background: "var(--bg3, rgba(255,255,255,0.03))", border: "1px solid var(--border, rgba(255,255,255,0.06))" }}>
                  <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 8, color: "var(--purple, #8B7CFF)", letterSpacing: 1, flexShrink: 0, minWidth: 62 }}>{tags[i] || `Step ${i + 1}`}</span>
                  <span style={{ fontFamily: "var(--sans, Inter, sans-serif)", fontSize: 11.5, color: "var(--text, #F2F2F4)", lineHeight: 1.6 }}>{stripped}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ==================== Chain-of-custody ledger ==================== */

function HermesLedger({ steps, running }) {
  return (
    <div style={{ border: "1px solid var(--border, rgba(255,255,255,0.06))", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "var(--bg3, rgba(255,255,255,0.03))", borderBottom: "1px solid var(--border, rgba(255,255,255,0.06))" }}>
        <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 8.5, letterSpacing: 1.5, color: "var(--text-dim, #5A5A62)", textTransform: "uppercase" }}>Chain of custody</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--mono, monospace)", fontSize: 8.5, color: "var(--text-dim, #5A5A62)" }}>{steps.length} {steps.length === 1 ? "entry" : "entries"}</span>
      </div>
      <div>
        {steps.map((step, i) => (
          <div key={i} style={{ display: "flex", gap: 10, padding: "9px 12px", borderBottom: i < steps.length - 1 || running ? "1px solid var(--border, rgba(255,255,255,0.06))" : "none", alignItems: "flex-start" }}>
            <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 9.5, color: "var(--text-dim, #5A5A62)", minWidth: 22, paddingTop: 1 }}>{String(i + 1).padStart(2, "0")}</span>
            <span style={{ color: "var(--purple, #8B7CFF)", flexShrink: 0, paddingTop: 1 }}><ToolIcon tool={step.tool} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 10.5, color: "var(--text, #F2F2F4)", fontWeight: 700 }}>{step.tool}</span>
                {step.input && <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 9.5, color: "var(--text-dim, #5A5A62)" }}>({step.input})</span>}
              </div>
              <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 9.5, color: "var(--text-mid, #9A9AA2)", lineHeight: 1.6, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {step.result}
              </div>
            </div>
            <span style={{ color: "var(--green, #22D97A)", flexShrink: 0, paddingTop: 2 }}><CheckIcon /></span>
          </div>
        ))}
        {running && (
          <div style={{ display: "flex", gap: 10, padding: "9px 12px", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 9.5, color: "var(--text-dim, #5A5A62)", minWidth: 22 }}>{String(steps.length + 1).padStart(2, "0")}</span>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent, #29D3FF)", animation: "pulseDot 1s ease-in-out infinite" }} />
            <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 9.5, color: "var(--accent, #29D3FF)", letterSpacing: 0.5 }}>selecting next tool…</span>
          </div>
        )}
        {steps.length === 0 && !running && (
          <div style={{ padding: "14px 12px", fontFamily: "var(--mono, monospace)", fontSize: 10, color: "var(--text-dim, #5A5A62)" }}>No tool calls recorded.</div>
        )}
      </div>
    </div>
  );
}

/* ==================== Investigation detail (right pane) ==================== */

function InvestigationDetail({ investigation, onNewCase, username }) {
  const running = investigation.status === "running";
  const settled = investigation.status === "done";
  const failed = investigation.status === "error";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ marginBottom: 14, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--display, inherit)", fontSize: 15, fontWeight: 600, color: "var(--text, #F2F2F4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {investigation.task}
            </div>
            <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 9, color: "var(--text-dim, #5A5A62)", letterSpacing: 1, marginTop: 2 }}>{investigation.caseId}</div>
          </div>
          <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 8, letterSpacing: 1.5, textTransform: "uppercase", color: failed ? "var(--red, #E15554)" : running ? "var(--accent, #29D3FF)" : "var(--green, #22D97A)" }}>
            {failed ? "error" : running ? "active" : "closed"}
          </div>
        </div>
        <div style={{ borderRadius: 8, border: "1px solid var(--border, rgba(255,255,255,0.06))", background: "var(--bg3, rgba(255,255,255,0.03))", padding: "2px 10px" }}>
          <SignalTrace running={running} settled={settled} error={failed} />
        </div>
      </div>

      <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
        {failed && (
          <div style={{ padding: "12px 14px", background: "rgba(225,85,84,0.09)", border: "1px solid rgba(225,85,84,0.3)", borderRadius: 10, marginBottom: 14, fontFamily: "var(--mono, monospace)", fontSize: 11, color: "var(--red, #E15554)" }}>
            {investigation.error || "Investigation failed."}
          </div>
        )}

        {(running || investigation.steps.length > 0) && (
          <div style={{ marginBottom: investigation.answer ? 16 : 0 }}>
            <HermesLedger steps={investigation.steps} running={running} />
          </div>
        )}

        {investigation.answer && !running && (
          <div style={{ background: "var(--bg3, rgba(255,255,255,0.03))", border: "1px solid var(--border2, rgba(255,255,255,0.12))", borderRadius: 12, padding: 16 }}>
            <HermesReportView text={investigation.answer} />
          </div>
        )}
      </div>

      {investigation.answer && !running && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexShrink: 0 }}>
          <button onClick={onNewCase} style={ghostBtnStyle}>RE-RUN</button>
          <button onClick={() => navigator.clipboard.writeText(investigation.answer)} style={purpleBtnStyle}>COPY</button>
          <SaveToDocumentButton username={username} content={investigation.answer} sourceQuery={investigation.task} />
        </div>
      )}
    </div>
  );
}

/* Quick-select leads — clicking one opens a case AND runs it immediately,
 * no separate "OPEN CASE" click needed. Covers the questions a SOC analyst
 * reaches for most often when starting cold. */
const QUICK_LEADS = [
  "Who is attacking us right now?",
  "Give me a full threat assessment",
  "What is the most dangerous IP?",
  "Investigate the entire network",
  "Any signs of lateral movement?",
  "Summarise today's alerts by severity",
];

/* ==================== Page ==================== */

export function HermesPage({ username }) {
  const [subView, setSubView] = useState("investigations"); // 'investigations' | 'documents'
  const [taskInput, setTaskInput] = useState("");
  const { investigations, activeId, setActiveId, startInvestigation, closeInvestigation, clearInvestigation, runningCount } = useHermes();

  const active = investigations.find(i => i.id === activeId) || null;

  const handleStart = () => {
    if (!taskInput.trim()) return;
    startInvestigation(taskInput);
    setTaskInput("");
  };

  return (
    <div style={pageStyle}>
      <div style={subNavStyle}>
        <button onClick={() => setSubView("investigations")} style={pillStyle(subView === "investigations")}>
          Investigations
          {runningCount > 0 && <span style={countDotStyle}>{runningCount}</span>}
        </button>
        <button onClick={() => setSubView("documents")} style={pillStyle(subView === "documents")}>
          Saved Documents
        </button>
      </div>

      {subView === "investigations" ? (
        <div style={investigationsWrapStyle}>
          <div style={tabListStyle}>
            <div style={{ padding: "14px 14px 12px", flexShrink: 0 }}>
              <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 8.5, letterSpacing: 1.5, color: "var(--text-dim, #5A5A62)", textTransform: "uppercase", marginBottom: 8 }}>
                Open a new case
              </div>
              <input
                value={taskInput}
                onChange={e => setTaskInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleStart()}
                placeholder="e.g. Investigate 185.220.101.45"
                style={taskInputStyle}
              />
              <button onClick={handleStart} disabled={!taskInput.trim()} style={openCaseBtnStyle(!!taskInput.trim())}>
                OPEN CASE
              </button>

              <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 8, letterSpacing: 1, color: "var(--text-dim, #5A5A62)", textTransform: "uppercase", margin: "12px 0 6px" }}>
                Common leads
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {QUICK_LEADS.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => startInvestigation(t)}
                    title="Opens a case and runs this immediately"
                    style={quickLeadBtnStyle}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ overflowY: "auto", flex: 1, padding: "0 10px 10px" }}>
              {investigations.length === 0 && (
                <div style={{ padding: "20px 10px", textAlign: "center", fontFamily: "var(--mono, monospace)", fontSize: 10.5, color: "var(--text-dim, #5A5A62)", lineHeight: 1.6 }}>
                  No cases open. Investigations you start keep running here even if you leave this page.
                </div>
              )}
              {investigations.map(inv => (
                <div key={inv.id} onClick={() => setActiveId(inv.id)} style={tabItemStyle(inv.id === activeId)}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0, marginTop: 4,
                    background: inv.status === "running" ? "var(--accent, #29D3FF)" : inv.status === "error" ? "var(--red, #E15554)" : "var(--green, #22D97A)",
                    animation: inv.status === "running" ? "hermesTabPulse 1s ease-in-out infinite" : undefined,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 9, color: "var(--purple, #8B7CFF)", letterSpacing: 0.5 }}>{inv.caseId}</div>
                    <div style={{ fontSize: 12, color: "var(--text, #F2F2F4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{inv.task}</div>
                  </div>
                  {inv.status !== "running" && (
                    <button onClick={e => { e.stopPropagation(); closeInvestigation(inv.id); }} style={tabCloseBtnStyle} title="Close case">✕</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={detailPaneStyle}>
            {!active ? (
              <div style={{ margin: "auto", textAlign: "center", fontFamily: "var(--mono, monospace)", fontSize: 11, color: "var(--text-dim, #5A5A62)" }}>
                Select or open a case to view its trace and findings.
              </div>
            ) : (
              <InvestigationDetail investigation={active} onNewCase={() => clearInvestigation(active.id)} username={username} />
            )}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <HermesDocumentsPanel username={username} />
        </div>
      )}

      <style>{`
        @keyframes traceSweep { 0% { stroke-dasharray: 0 400; } 60% { stroke-dasharray: 400 400; } 100% { stroke-dasharray: 400 400; } }
        @keyframes pulseDot { 0%, 100% { opacity: 0.3; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1); } }
        @keyframes hermesTabPulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
      `}</style>
    </div>
  );
}

/* ==================== styles ==================== */

const pageStyle = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  color: "var(--text, #F2F2F4)",
  fontFamily: "var(--sans, Inter, sans-serif)",
  gap: 14,
};

const subNavStyle = { display: "flex", gap: 8, flexShrink: 0 };

const pillStyle = (active) => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "8px 16px",
  borderRadius: 20,
  border: active ? "1px solid var(--purple, #8B7CFF)" : "1px solid var(--border2, rgba(255,255,255,0.12))",
  background: active ? "var(--purple-dim, rgba(139,124,255,0.12))" : "transparent",
  color: active ? "var(--purple, #8B7CFF)" : "var(--text-mid, #9A9AA2)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 10.5,
  letterSpacing: 0.5,
  cursor: "pointer",
});

const countDotStyle = {
  background: "var(--accent, #29D3FF)",
  color: "#060608",
  borderRadius: 10,
  fontSize: 9,
  fontWeight: 700,
  padding: "1px 6px",
};

const investigationsWrapStyle = { display: "flex", gap: 14, flex: 1, minHeight: 0 };

const tabListStyle = {
  width: 300,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  background: "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015))",
  border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  borderRadius: "var(--radius, 18px)",
  overflow: "hidden",
};

const taskInputStyle = {
  width: "100%",
  background: "var(--bg3, rgba(255,255,255,0.03))",
  border: "1px solid rgba(139,124,255,0.25)",
  borderRadius: 10,
  padding: "10px 12px",
  color: "var(--text, #F2F2F4)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 10.5,
  outline: "none",
  boxSizing: "border-box",
  marginBottom: 8,
};

const openCaseBtnStyle = (enabled) => ({
  width: "100%",
  padding: "9px",
  background: "linear-gradient(135deg,#8B7CFF,#6A54D9)",
  border: "none",
  borderRadius: 10,
  color: "white",
  fontFamily: "var(--mono, monospace)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1,
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.4,
});

const quickLeadBtnStyle = {
  textAlign: "left",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border, rgba(255,255,255,0.06))",
  background: "var(--bg3, rgba(255,255,255,0.03))",
  color: "var(--text-mid, #9A9AA2)",
  fontFamily: "var(--sans, Inter, sans-serif)",
  fontSize: 11,
  lineHeight: 1.4,
  cursor: "pointer",
};

const tabItemStyle = (active) => ({
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
  padding: "10px 10px",
  borderRadius: 10,
  cursor: "pointer",
  marginBottom: 4,
  background: active ? "var(--purple-dim, rgba(139,124,255,0.1))" : "transparent",
  border: active ? "1px solid rgba(139,124,255,0.3)" : "1px solid transparent",
});

const tabCloseBtnStyle = {
  background: "transparent",
  border: "none",
  color: "var(--text-dim, #5A5A62)",
  cursor: "pointer",
  fontSize: 11,
  flexShrink: 0,
  padding: 2,
};

const detailPaneStyle = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
  border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  borderRadius: "var(--radius, 18px)",
  padding: 18,
};

const ghostBtnStyle = {
  flex: 1,
  padding: "9px",
  background: "transparent",
  border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  borderRadius: 10,
  color: "var(--text-mid, #9A9AA2)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 9,
  cursor: "pointer",
  letterSpacing: 1,
};

const purpleBtnStyle = {
  flex: 1,
  padding: "9px",
  background: "var(--purple-dim, rgba(139,124,255,0.12))",
  border: "1px solid var(--purple, #8B7CFF)",
  borderRadius: 10,
  color: "var(--purple, #8B7CFF)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 9,
  cursor: "pointer",
  letterSpacing: 1,
};
