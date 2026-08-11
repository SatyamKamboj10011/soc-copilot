import { useState, useEffect, useRef, useMemo, memo } from "react";
import { motion, animate } from "framer-motion";
import ThreatMap from "./ThreatMap";

const FLASK_URL = "http://localhost:5000";

const TSC_ORDER = ["security", "availability", "confidentiality", "processing_integrity", "privacy"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SEVERITY_LABEL = { critical: "Critical", elevated: "Elevated", informational: "Informational" };

const RANGE_OPTIONS = [
  { key: "24h", label: "Last 24h", hours: 24 },
  { key: "7d",  label: "Last 7d",  hours: 168 },
  { key: "all", label: "All time", hours: null },
];

/* Color communicates status only — never decoration. Same 3-state scale everywhere. */
function statusColor(score) {
  if (score >= 80) return "#22D97A";
  if (score > 0) return "#E8B84D";
  return "#E15554";
}

/* ── motion primitives (small, reused everywhere; kept subtle) ── */
const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};
const staggerContainer = (stagger = 0.06, delay = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
});

function useCountUp(target, duration = 0.9) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const t = typeof target === "number" && !isNaN(target) ? target : 0;
    const controls = animate(0, t, { duration, ease: "easeOut", onUpdate: (v) => setDisplay(Math.round(v)) });
    return () => controls.stop();
  }, [target, duration]);
  return display;
}

/* ── icons (inline SVG — no emoji, matches the app's existing glyph convention) ── */
function IconTrend() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 17 9 11 13 15 21 6" /><polyline points="14 6 21 6 21 13" />
    </svg>
  );
}
function IconCoverage() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" />
    </svg>
  );
}
function IconTable() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="9" y1="10" x2="9" y2="20" />
    </svg>
  );
}
function IconGrid() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}
function IconSparkle() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.9 5.9L20 10l-6.1 2.1L12 18l-1.9-5.9L4 10l6.1-2.1L12 2z" />
    </svg>
  );
}
function IconActivity() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
function IconAlertTriangle() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function IconGlobe() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
function IconShieldCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" /><path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function IconBot() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="12" rx="2" /><path d="M12 8V4" /><circle cx="12" cy="3" r="1" /><line x1="9" y1="13" x2="9" y2="15" /><line x1="15" y1="13" x2="15" y2="15" />
    </svg>
  );
}

/* ── radial gauge (SVG ring, animated draw-on; color = status, not decoration) ── */
function RadialGauge({ value, size = 84, stroke = 6, color }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const displayValue = useCountUp(value ?? 0);
  const ringColor = color || statusColor(value ?? 0);
  const offset = circumference - (Math.max(0, Math.min(100, value ?? 0)) / 100) * circumference;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="var(--border2)" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={radius} stroke={ringColor} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="radial-gauge-label" style={{ fontSize: size * 0.24, color: "var(--text)" }}>{displayValue}%</span>
      </div>
    </div>
  );
}

/* ── stat chip with animated count ── */
function HudStat({ icon, label, value, suffix = "", tone = "neutral" }) {
  const displayValue = useCountUp(value ?? 0);
  const toneColor = { neutral: "var(--accent)", good: "#22D97A", bad: "#E15554" }[tone];
  return (
    <motion.div className="bento-card hud-stat-chip" variants={fadeUp}>
      <div className="hud-stat-icon">{icon}</div>
      <div>
        <div className="hud-stat-label">{label}</div>
        <div className="hud-stat-value" style={{ color: toneColor }}>{displayValue}{suffix}</div>
      </div>
    </motion.div>
  );
}

const Soc2Dashboard = memo(function Soc2Dashboard({ onAskSira, onSeeFindings }) {
  const [overview, setOverview]   = useState(null);
  const [findings, setFindings]   = useState([]);
  const [heatmap, setHeatmap]     = useState({ cells: [], max: 0 });
  const [trend, setTrend]         = useState([]);
  const [threatOrigins, setThreatOrigins] = useState(0);
  const [activeWidget, setActiveWidget] = useState("trend");
  const [range, setRange] = useState("all");
  const activeHours = RANGE_OPTIONS.find(r => r.key === range)?.hours;

  const trendChartRef      = useRef(null);
  const trendChartInstance = useRef(null);
  const trendSectionRef    = useRef(null);
  const coverageSectionRef = useRef(null);
  const findingsSectionRef = useRef(null);
  const heatmapSectionRef  = useRef(null);

  useEffect(() => {
    const hp = activeHours ? `hours=${activeHours}` : "";
    const q = (extra) => [hp, extra].filter(Boolean).join("&");
    fetch(`${FLASK_URL}/compliance/overview?${q()}`).then(r => r.json()).then(setOverview).catch(() => {});
    fetch(`${FLASK_URL}/compliance/findings?${q("limit=8")}`).then(r => r.json()).then(d => setFindings(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${FLASK_URL}/compliance/heatmap?${q()}`).then(r => r.json()).then(d => setHeatmap(d || { cells: [], max: 0 })).catch(() => {});
    fetch(`${FLASK_URL}/compliance/trend?${q()}`).then(r => r.json()).then(d => setTrend(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${FLASK_URL}/top-ips?${q("limit=15")}`).then(r => r.json()).then(d => setThreatOrigins(Array.isArray(d) ? d.length : 0)).catch(() => {});
  }, [activeHours]);

  useEffect(() => {
    if (!trend.length || !trendChartRef.current || !window.Chart) return;
    if (trendChartInstance.current) trendChartInstance.current.destroy();
    trendChartInstance.current = new window.Chart(trendChartRef.current, {
      type: "line",
      data: {
        labels: trend.map(t => t.date),
        datasets: [
          {
            label: "Compliance score",
            data: trend.map(t => t.score),
            borderColor: "#4DD8E8", backgroundColor: "rgba(77,216,232,0.10)",
            borderWidth: 2, tension: 0.35, fill: true, pointRadius: 2.5, pointBackgroundColor: "#4DD8E8",
            yAxisID: "y",
          },
          {
            label: "Alert volume",
            data: trend.map(t => t.alerts),
            borderColor: "#5A5A62", backgroundColor: "transparent",
            borderWidth: 1.5, borderDash: [3, 3], tension: 0.35, fill: false, pointRadius: 2, pointBackgroundColor: "#5A5A62",
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#14161B", borderColor: "var(--border2)", borderWidth: 1,
            titleColor: "#EDEDEF", bodyColor: "#9A9AA2",
            titleFont: { family: "Inter", size: 11 }, bodyFont: { family: "Inter", size: 11 },
          },
        },
        scales: {
          x: { grid: { color: "rgba(255,255,255,0.04)", borderDash: [3, 4] }, ticks: { color: "#5A5A62", font: { family: "Inter", size: 9 } } },
          y: { position: "left", grid: { color: "rgba(255,255,255,0.04)", borderDash: [3, 4] }, ticks: { color: "#5A5A62", font: { family: "Inter", size: 9 } }, min: 0, max: 100 },
          y1: { position: "right", grid: { display: false }, ticks: { color: "#5A5A62", font: { family: "Inter", size: 9 } } },
        },
      },
    });
    return () => { if (trendChartInstance.current) trendChartInstance.current.destroy(); };
  }, [trend]);

  const heatGrid = useMemo(() => {
    const byCell = {};
    heatmap.cells.forEach(c => { byCell[`${c.weekday}-${c.hour}`] = c.count; });
    return byCell;
  }, [heatmap]);

  const jumpTo = (widget, ref) => { setActiveWidget(widget); ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  const criteria = overview?.criteria || [];
  const findingsRelative = (ts) => {
    if (!ts) return "--";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts.slice(11, 16);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const findingsOpen = overview?.findings_open ?? 0;

  return (
    <div className="page" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="page-title">SOC 2 Compliance Dashboard</div>
          <div className="page-sub" style={{ marginBottom: 0 }}>TRUST SERVICE CRITERIA — LIVE FROM SURICATA, ZEEK &amp; SENTINEL TELEMETRY</div>
        </div>
        <span className="hud-live"><span className="hud-live-dot" />Live telemetry</span>
      </div>

      {/* ── TIME-RANGE FILTER — above the charts, controls every fetch on this page ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {RANGE_OPTIONS.map(r => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            style={{
              fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 1, textTransform: "uppercase",
              padding: "6px 15px", borderRadius: 20, cursor: "pointer", transition: "all 0.15s",
              background: range === r.key ? "var(--accent)" : "var(--bg3)",
              color: range === r.key ? "var(--bg)" : "var(--text-dim)",
              border: range === r.key ? "1px solid var(--accent)" : "1px solid var(--border2)",
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* ── STATUS STRIP ── */}
      <motion.div className="hud-stat-strip" style={{ marginBottom: 14 }} variants={staggerContainer()} initial="hidden" animate="show">
        <HudStat icon={<IconShieldCheck />} label="Compliance score" value={overview?.overall_score} suffix="%" tone="neutral" />
        <HudStat icon={<IconAlertTriangle />} label="Open findings" value={findingsOpen} tone={findingsOpen > 0 ? "bad" : "good"} />
        <HudStat icon={<IconGlobe />} label="Threat origins" value={threatOrigins} tone="neutral" />
        <HudStat icon={<IconActivity />} label="Controls passing" value={overview?.controls_passing} suffix={` / ${overview?.controls_total ?? "--"}`} tone="good" />
      </motion.div>

      {/* ── TOP ROW: AI card + trend + widget switcher ── */}
      <motion.div style={{ display: "grid", gridTemplateColumns: "260px 1fr 220px", gap: 14, marginBottom: 14 }} variants={staggerContainer(0.08)} initial="hidden" animate="show">
        <motion.div className="bento-card hud-card" variants={fadeUp} style={{ padding: 20, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 14 }}>
          <div>
            <div className="hud-stat-icon" style={{ marginBottom: 12 }}><IconBot /></div>
            <div className="bento-card-title" style={{ fontSize: 15 }}>Ask SIRA</div>
            <div className="bento-card-sub" style={{ marginTop: 4 }}>Get a plain-language summary of your current compliance posture and open findings.</div>
          </div>
          <motion.button
            className="bento-pill" onClick={() => onAskSira && onAskSira("Give me a summary of our current SOC 2 compliance posture and any open findings.")}
            whileHover={{ opacity: 0.92 }} whileTap={{ scale: 0.98 }} style={{ justifyContent: "center" }}
          >
            <IconSparkle /> Run AI analysis
          </motion.button>
        </motion.div>

        <motion.div className="bento-card hud-card" variants={fadeUp} ref={trendSectionRef}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div className="bento-card-title">Compliance score trend</div>
              <div className="bento-card-sub">Daily score vs. alert volume, derived from live telemetry</div>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              {[["#4DD8E8", "Score"], ["#5A5A62", "Alerts"]].map(([color, label]) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
                  <span style={{ fontFamily: "var(--sans)", fontSize: 11, color: "var(--text-mid)" }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: "relative", height: 190, marginTop: 14 }}>
            <canvas ref={trendChartRef} role="img" aria-label="Compliance score trend line chart" />
          </div>
        </motion.div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 10 }}>
          {[
            { key: "trend",    icon: <IconTrend />,    label: "Score Trend",  ref: trendSectionRef },
            { key: "coverage", icon: <IconCoverage />, label: "Coverage",     ref: coverageSectionRef },
            { key: "findings", icon: <IconTable />,     label: "Findings",     ref: findingsSectionRef },
            { key: "heatmap",  icon: <IconGrid />,      label: "Alert Heatmap", ref: heatmapSectionRef },
          ].map(w => (
            <motion.div
              key={w.key} variants={fadeUp} whileTap={{ scale: 0.97 }}
              className={`bento-card hud-card bento-widget${activeWidget === w.key ? " active" : ""}`}
              onClick={() => jumpTo(w.key, w.ref)}
            >
              <div className="bento-widget-icon">{w.icon}</div>
              <div className="bento-widget-label">{w.label}</div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ── MIDDLE ROW: findings / heatmap / map ── */}
      <motion.div style={{ display: "grid", gridTemplateColumns: "0.9fr 0.9fr 1.2fr", gap: 14, marginBottom: 14 }} variants={staggerContainer(0.1)} initial="hidden" animate="show">
        <motion.div className="bento-card hud-card" variants={fadeUp} ref={findingsSectionRef}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div className="bento-card-title">Audit findings</div>
            <button className="bento-see-all" onClick={() => onSeeFindings && onSeeFindings()}>See all</button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="bento-table" style={{ tableLayout: "fixed", width: "100%" }}>
              <colgroup><col style={{ width: "38%" }} /><col style={{ width: "24%" }} /><col style={{ width: "22%" }} /><col style={{ width: "16%" }} /></colgroup>
              <thead><tr><th>Signature</th><th>Source</th><th>Status</th><th>Time</th></tr></thead>
              <tbody>
                {findings.length === 0 && (
                  <tr><td colSpan={4} style={{ color: "var(--text-dim)" }}>No open findings</td></tr>
                )}
                {findings.map((f, i) => (
                  <motion.tr key={f.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, delay: Math.min(i, 8) * 0.04 }}>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.title}>{f.title}</td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.src_ip || "--"}</td>
                    <td style={{ overflow: "hidden" }}>
                      <span className={`status-badge ${f.severity}`}>
                        <span className="bento-dot" />
                        {SEVERITY_LABEL[f.severity] || f.severity}
                      </span>
                    </td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden" }}>{findingsRelative(f.detected_at)}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        <motion.div className="bento-card hud-card" variants={fadeUp} ref={heatmapSectionRef}>
          <div className="bento-card-title" style={{ marginBottom: 14 }}>Alert heatmap</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {WEEKDAYS.map((day, wd) => (
              <div key={day} className="bento-heat-row">
                <span className="bento-heat-label">{day}</span>
                {Array.from({ length: 24 }, (_, hr) => {
                  const count = heatGrid[`${wd}-${hr}`] || 0;
                  const intensity = heatmap.max ? count / heatmap.max : 0;
                  return (
                    <div
                      key={hr}
                      className="bento-heat-cell"
                      title={`${day} ${hr}:00 — ${count} alerts`}
                      style={{ background: count === 0 ? "var(--bg3)" : `rgba(77,216,232,${0.15 + intensity * 0.75})` }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <span className="bento-heat-label">00h</span><span className="bento-heat-label">12h</span><span className="bento-heat-label">23h</span>
          </div>
        </motion.div>

        <motion.div className="bento-card hud-card" variants={fadeUp} style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 16, left: 20, zIndex: 500 }}>
            <div className="bento-card-title" style={{ fontSize: 14 }}>Incident origins</div>
          </div>
          <div style={{ height: 320 }}>
            <ThreatMap />
          </div>
        </motion.div>
      </motion.div>

      {/* ── BOTTOM ROW: control coverage + TSC balances ── */}
      <motion.div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 14 }} variants={staggerContainer(0.1)} initial="hidden" animate="show">
        <motion.div className="bento-card hud-card" variants={fadeUp} ref={coverageSectionRef}>
          <div className="bento-card-title" style={{ marginBottom: 4 }}>Control coverage by criteria</div>
          <div className="bento-card-sub" style={{ marginBottom: 18 }}>{overview?.controls_passing ?? "--"} / {overview?.controls_total ?? "--"} controls passing</div>
          <div style={{ display: "flex", alignItems: "flex-end", height: 150, gap: 4 }}>
            {TSC_ORDER.map((key, i) => {
              const c = criteria.find(x => x.key === key);
              const score = c?.score ?? 0;
              const color = statusColor(score);
              return (
                <div key={key} className="lollipop-col">
                  <motion.div
                    className="lollipop-stem"
                    style={{ background: `linear-gradient(180deg, transparent, ${color}55)` }}
                    initial={{ height: 0 }} animate={{ height: `${Math.max(score, 4)}%` }}
                    transition={{ duration: 0.7, delay: i * 0.06, ease: "easeOut" }}
                  >
                    <div className="lollipop-dot" style={{ background: color }} />
                  </motion.div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
            {TSC_ORDER.map(key => (
              <div key={key} style={{ flex: 1, textAlign: "center", fontFamily: "var(--sans)", fontSize: 11, color: "var(--text-dim)" }}>
                {(overview ? (criteria.find(x => x.key === key)?.score ?? 0) : "--")}%
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div className="bento-card hud-card" variants={fadeUp}>
          <div className="bento-card-title" style={{ marginBottom: 16 }}>Trust Service Criteria balances</div>
          <div className="balance-row" style={{ gridTemplateColumns: `repeat(${TSC_ORDER.length}, 1fr)` }}>
            {TSC_ORDER.map(key => {
              const c = criteria.find(x => x.key === key);
              const score = c?.score ?? 0;
              return (
                <div key={key} className="balance-card" style={{ alignItems: "center", textAlign: "center" }}>
                  <RadialGauge value={overview ? score : 0} />
                  <div className="balance-label" style={{ marginTop: 4 }}>{c?.label || key}</div>
                  <div className="balance-delta" style={{ color: "var(--text-dim)", fontWeight: 400 }}>
                    {c ? `${c.controls_passing}/${c.controls_total} controls` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
});

export default Soc2Dashboard;