import { useState, useEffect, useRef, useMemo, memo } from "react";
import { motion, animate } from "framer-motion";
import ThreatMap from "./ThreatMap";

const FLASK_URL = "http://localhost:5000";

const TSC_ORDER = ["security", "availability", "confidentiality", "processing_integrity", "privacy"];
const TSC_COLORS = {
  security: "var(--accent)",
  availability: "var(--purple)",
  confidentiality: "var(--green)",
  processing_integrity: "var(--orange)",
  privacy: "var(--red)",
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SEVERITY_LABEL = { critical: "Critical", elevated: "Elevated", informational: "Informational" };

const RANGE_OPTIONS = [
  { key: "24h", label: "24h", hours: 24 },
  { key: "7d", label: "7d", hours: 168 },
  { key: "all", label: "All time", hours: null },
];

/* Color communicates status only — never decoration. Same 3-state scale everywhere. */
function statusColor(score) {
  if (score >= 80) return "var(--green)";
  if (score > 0) return "var(--orange)";
  return "var(--red)";
}

function timeAgo(iso) {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

/* ── motion primitives ── */
const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};
const staggerContainer = (stagger = 0.05, delay = 0) => ({
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

/* ── icons — thin-stroke, SF-Symbols-adjacent to match the toolbar language ── */
function IconTrend() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 17 9 11 13 15 21 6" /><polyline points="14 6 21 6 21 13" />
    </svg>
  );
}
function IconCoverage() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" />
    </svg>
  );
}
function IconTable() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="9" y1="10" x2="9" y2="20" />
    </svg>
  );
}
function IconGrid() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
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
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
function IconAlertTriangle() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function IconGlobe() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
function IconShieldCheck() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" /><path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function IconBot() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="12" rx="2" /><path d="M12 8V4" /><circle cx="12" cy="3" r="1" /><line x1="9" y1="13" x2="9" y2="15" /><line x1="15" y1="13" x2="15" y2="15" />
    </svg>
  );
}

/* ── single ring primitive, reused by the Activity Rings widget ── */
function Ring({ cx, cy, r, stroke, color, value, delay = 0 }) {
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const offset = circumference - (pct / 100) * circumference;
  return (
    <>
      <circle cx={cx} cy={cy} r={r} stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} fill="none" />
      <motion.circle
        cx={cx} cy={cy} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1.1, ease: "easeOut", delay }}
      />
    </>
  );
}

/* ── the signature widget: Apple-Activity-Rings-style cluster, one ring per TSC category ──
   Stacked vertically (ring cluster centered above a full-width legend list) so it never
   has to compete with the legend for horizontal space inside a single grid column. */
function ActivityRings({ criteria, loaded }) {
  const size = 140, cx = size / 2, cy = size / 2, stroke = 8, gap = 12;
  const outerR = 60;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, minHeight: 0, width: "100%" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
        {TSC_ORDER.map((key, i) => {
          const c = criteria.find((x) => x.key === key);
          return (
            <Ring
              key={key}
              cx={cx} cy={cy} r={outerR - i * gap} stroke={stroke}
              color={TSC_COLORS[key]}
              value={loaded ? c?.score ?? 0 : 0}
              delay={i * 0.08}
            />
          );
        })}
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", marginTop: 14 }}>
        {TSC_ORDER.map((key) => {
          const c = criteria.find((x) => x.key === key);
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: TSC_COLORS[key], flexShrink: 0 }} />
              <span className="mac-ring-label">{c?.label || key}</span>
              <span className="mac-ring-score">{loaded ? `${c?.score ?? 0}%` : "--"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── small square macOS-widget-style stat card ── */
function StatWidget({ icon, label, value, suffix = "", tone = "neutral", loaded, area }) {
  const displayValue = useCountUp(loaded ? value ?? 0 : 0);
  const toneColor = { neutral: "var(--accent)", good: "var(--green)", bad: "var(--red)" }[tone];
  return (
    <motion.div className="mac-card mac-stat" variants={fadeUp} style={{ gridArea: area }}>
      <div className="mac-stat-icon" style={{ color: toneColor }}>{icon}</div>
      <div className="mac-stat-value" style={{ color: loaded ? "var(--text)" : "var(--text-dim)" }}>
        {loaded ? displayValue : "--"}{loaded ? suffix : ""}
      </div>
      <div className="mac-stat-label">{label}</div>
    </motion.div>
  );
}

/* ── Screen-Time-style horizontal coverage bars ── */
function CoverageBars({ criteria, loaded }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4, flex: 1, justifyContent: "center" }}>
      {TSC_ORDER.map((key, i) => {
        const c = criteria.find((x) => x.key === key);
        const score = loaded ? c?.score ?? 0 : 0;
        return (
          <div key={key}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span className="mac-bar-label">{c?.label || key}</span>
              <span className="mac-bar-value">{loaded ? `${c.controls_passing}/${c.controls_total}` : "--"}</span>
            </div>
            <div className="mac-bar-track">
              <motion.div
                className="mac-bar-fill"
                style={{ background: TSC_COLORS[key] }}
                initial={{ width: 0 }}
                animate={{ width: `${score}%` }}
                transition={{ duration: 0.8, delay: i * 0.06, ease: "easeOut" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const Soc2Dashboard = memo(function Soc2Dashboard({ onAskSira, onSeeFindings }) {
  const [overview, setOverview] = useState(null);
  const [findings, setFindings] = useState([]);
  const [heatmap, setHeatmap] = useState({ cells: [], max: 0 });
  const [trend, setTrend] = useState([]);
  const [threatOrigins, setThreatOrigins] = useState(0);
  const [activeWidget, setActiveWidget] = useState("trend");
  const [range, setRange] = useState("all");
  const activeHours = RANGE_OPTIONS.find((r) => r.key === range)?.hours;

  const trendChartRef = useRef(null);
  const trendChartInstance = useRef(null);
  const trendSectionRef = useRef(null);
  const coverageSectionRef = useRef(null);
  const findingsSectionRef = useRef(null);
  const heatmapSectionRef = useRef(null);

  useEffect(() => {
    const hp = activeHours ? `hours=${activeHours}` : "";
    const q = (extra) => [hp, extra].filter(Boolean).join("&");
    fetch(`${FLASK_URL}/compliance/overview?${q()}`).then((r) => r.json()).then(setOverview).catch(() => {});
    fetch(`${FLASK_URL}/compliance/findings?${q("limit=8")}`).then((r) => r.json()).then((d) => setFindings(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${FLASK_URL}/compliance/heatmap?${q()}`).then((r) => r.json()).then((d) => setHeatmap(d || { cells: [], max: 0 })).catch(() => {});
    fetch(`${FLASK_URL}/compliance/trend?${q()}`).then((r) => r.json()).then((d) => setTrend(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${FLASK_URL}/top-ips?${q("limit=15")}`).then((r) => r.json()).then((d) => setThreatOrigins(Array.isArray(d) ? d.length : 0)).catch(() => {});
  }, [activeHours]);

  useEffect(() => {
    if (!trend.length || !trendChartRef.current || !window.Chart) return;
    if (trendChartInstance.current) trendChartInstance.current.destroy();
    trendChartInstance.current = new window.Chart(trendChartRef.current, {
      type: "line",
      data: {
        labels: trend.map((t) => t.date),
        datasets: [
          {
            label: "Compliance score",
            data: trend.map((t) => t.score),
            borderColor: "#4DD8E8", backgroundColor: "rgba(77,216,232,0.10)",
            borderWidth: 2, tension: 0.35, fill: true, pointRadius: 2.5, pointBackgroundColor: "#4DD8E8",
            yAxisID: "y",
          },
          {
            label: "Alert volume",
            data: trend.map((t) => t.alerts),
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
            backgroundColor: "#14161B", borderColor: "rgba(255,255,255,0.12)", borderWidth: 1,
            titleColor: "#EDEDEF", bodyColor: "#9A9AA2",
            titleFont: { family: "Inter", size: 11 }, bodyFont: { family: "Inter", size: 11 },
            padding: 10, cornerRadius: 8,
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
    heatmap.cells.forEach((c) => { byCell[`${c.weekday}-${c.hour}`] = c.count; });
    return byCell;
  }, [heatmap]);

  const jumpTo = (widget, ref) => { setActiveWidget(widget); ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  const criteria = overview?.criteria || [];
  const loaded = !!overview;
  const findingsRelative = (ts) => {
    if (!ts) return "--";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts.slice(11, 16);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const findingsOpen = overview?.findings_open ?? 0;
  const toolbarItems = [
    { key: "trend", icon: <IconTrend />, ref: trendSectionRef, title: "Score trend" },
    { key: "coverage", icon: <IconCoverage />, ref: coverageSectionRef, title: "Coverage" },
    { key: "findings", icon: <IconTable />, ref: findingsSectionRef, title: "Findings" },
    { key: "heatmap", icon: <IconGrid />, ref: heatmapSectionRef, title: "Alert heatmap" },
  ];

  return (
    <div className="mac-dashboard page" style={{ padding: "20px 20px 32px", position: "relative" }}>
      <style>{macCss}</style>
      <div className="mac-wallpaper" />

      <div style={{ position: "relative", zIndex: 1 }}>
        {/* ── floating macOS titlebar ── */}
        <div className="mac-titlebar">
          <div className="mac-traffic-lights">
            <span className="mac-dot" style={{ background: "#FF5F57" }} />
            <span className="mac-dot" style={{ background: "#FEBC2E" }} />
            <span className="mac-dot" style={{ background: "#28C840" }} />
          </div>
          <div className="mac-titlebar-title">
            SOC 2 Compliance
            <span className="mac-titlebar-live">
              <span className="mac-live-dot" />
              {overview?.generated_at ? `Updated ${timeAgo(overview.generated_at)}` : "Connecting…"}
            </span>
          </div>
          <div className="mac-toolbar">
            {toolbarItems.map((t) => (
              <button
                key={t.key}
                title={t.title}
                className={`mac-toolbar-btn${activeWidget === t.key ? " active" : ""}`}
                onClick={() => jumpTo(t.key, t.ref)}
              >
                {t.icon}
              </button>
            ))}
          </div>
        </div>

        {/* ── segmented control ── */}
        <div className="mac-segmented">
          {RANGE_OPTIONS.map((r) => (
            <button key={r.key} className={`mac-segment${range === r.key ? " active" : ""}`} onClick={() => setRange(r.key)}>
              {range === r.key && <motion.div layoutId="mac-seg-pill" className="mac-segment-pill" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
              <span style={{ position: "relative", zIndex: 1 }}>{r.label}</span>
            </button>
          ))}
        </div>

        {/* ── bento grid ── */}
        <motion.div className="mac-grid" variants={staggerContainer()} initial="hidden" animate="show">
          <StatWidget area="stat1" icon={<IconShieldCheck />} label="Compliance score" value={overview?.overall_score} suffix="%" tone="neutral" loaded={loaded} />
          <StatWidget area="stat2" icon={<IconAlertTriangle />} label="Open findings" value={findingsOpen} tone={findingsOpen > 0 ? "bad" : "good"} loaded={loaded} />
          <StatWidget area="stat3" icon={<IconGlobe />} label="Threat origins" value={threatOrigins} tone="neutral" loaded={loaded} />
          <StatWidget area="stat4" icon={<IconActivity />} label="Controls passing" value={overview?.controls_passing} suffix={` / ${overview?.controls_total ?? "--"}`} tone="good" loaded={loaded} />

          <motion.div className="mac-card" variants={fadeUp} ref={trendSectionRef} style={{ gridArea: "trend" }}>
            <div className="mac-card-head">
              <div>
                <div className="mac-card-title">Compliance score trend</div>
                <div className="mac-card-sub">Daily score vs. alert volume</div>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                {[["#4DD8E8", "Score"], ["#5A5A62", "Alerts"]].map(([color, label]) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                    <span className="mac-legend-text">{label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ position: "relative", flex: 1, marginTop: 10, minHeight: 0 }}>
              <canvas ref={trendChartRef} role="img" aria-label="Compliance score trend line chart" />
            </div>
          </motion.div>

          <motion.div className="mac-card mac-ask" variants={fadeUp} style={{ gridArea: "ask" }}>
            <div>
              <div className="mac-stat-icon" style={{ color: "var(--purple)", marginBottom: 10 }}><IconBot /></div>
              <div className="mac-card-title">Ask SIRA</div>
              <div className="mac-card-sub">Summarise the current compliance posture in plain language.</div>
            </div>
            <motion.button
              className="mac-pill-btn"
              onClick={() => onAskSira && onAskSira("Give me a summary of our current SOC 2 compliance posture and any open findings.")}
              whileHover={{ opacity: 0.92 }} whileTap={{ scale: 0.97 }}
            >
              <IconSparkle /> Run AI analysis
            </motion.button>
          </motion.div>

          <motion.div className="mac-card" variants={fadeUp} style={{ gridArea: "rings" }}>
            <div className="mac-card-title">Trust Service Criteria</div>
            <div className="mac-card-sub" style={{ marginBottom: 4 }}>{overview?.controls_passing ?? "--"} / {overview?.controls_total ?? "--"} controls passing</div>
            <ActivityRings criteria={criteria} loaded={loaded} />
          </motion.div>

          <motion.div className="mac-card" variants={fadeUp} ref={findingsSectionRef} style={{ gridArea: "findings", display: "flex", flexDirection: "column" }}>
            <div className="mac-card-head">
              <div className="mac-card-title">Audit findings</div>
              <button className="mac-see-all" onClick={() => onSeeFindings && onSeeFindings()}>See all</button>
            </div>
            <div style={{ overflow: "auto", marginTop: 6, flex: 1 }}>
              <table className="mac-table">
                <colgroup><col style={{ width: "40%" }} /><col style={{ width: "24%" }} /><col style={{ width: "22%" }} /><col style={{ width: "14%" }} /></colgroup>
                <thead><tr><th>Signature</th><th>Source</th><th>Status</th><th>Time</th></tr></thead>
                <tbody>
                  {findings.length === 0 && (
                    <tr><td colSpan={4} style={{ color: "var(--text-dim)" }}>{loaded ? "No open findings" : "Loading…"}</td></tr>
                  )}
                  {findings.map((f, i) => (
                    <motion.tr key={f.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, delay: Math.min(i, 8) * 0.04 }}>
                      <td className="mac-td-ellipsis" title={f.title}>{f.title}</td>
                      <td className="mac-td-mono mac-td-ellipsis">{f.src_ip || "--"}</td>
                      <td>
                        <span className={`mac-status mac-status-${f.severity}`}>
                          <span className="mac-status-dot" />
                          {SEVERITY_LABEL[f.severity] || f.severity}
                        </span>
                      </td>
                      <td className="mac-td-mono">{findingsRelative(f.detected_at)}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>

          <motion.div className="mac-card" variants={fadeUp} style={{ gridArea: "origins", padding: 0, overflow: "hidden", position: "relative" }}>
            <div style={{ position: "absolute", top: 16, left: 20, zIndex: 500 }}>
              <div className="mac-card-title" style={{ fontSize: 13 }}>Incident origins</div>
            </div>
            <div style={{ height: "100%" }}>
              <ThreatMap />
            </div>
          </motion.div>

          <motion.div className="mac-card" variants={fadeUp} ref={heatmapSectionRef} style={{ gridArea: "heat" }}>
            <div className="mac-card-title">Alert heatmap</div>
            <div className="mac-card-sub" style={{ marginBottom: 12 }}>Alert volume by day and hour</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {WEEKDAYS.map((day, wd) => (
                <div key={day} className="mac-heat-row">
                  <span className="mac-heat-label">{day}</span>
                  {Array.from({ length: 24 }, (_, hr) => {
                    const count = heatGrid[`${wd}-${hr}`] || 0;
                    const intensity = heatmap.max ? count / heatmap.max : 0;
                    return (
                      <div
                        key={hr}
                        className="mac-heat-cell"
                        title={`${day} ${hr}:00 — ${count} alerts`}
                        style={{ background: count === 0 ? "rgba(255,255,255,0.04)" : `rgba(77,216,232,${0.15 + intensity * 0.75})` }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "26px repeat(24, 1fr)", marginTop: 8 }}>
              {[0, 12, 23].map((h) => (
                <span
                  key={h}
                  className="mac-heat-label"
                  style={{ gridColumnStart: h + 2, textAlign: h === 23 ? "right" : h === 0 ? "left" : "center" }}
                >
                  {h}h
                </span>
              ))}
            </div>
          </motion.div>

          <motion.div className="mac-card" variants={fadeUp} ref={coverageSectionRef} style={{ gridArea: "coverage" }}>
            <div className="mac-card-title">Control coverage detail</div>
            <div className="mac-card-sub">Exact pass counts per criteria</div>
            <CoverageBars criteria={criteria} loaded={loaded} />
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
});

export default Soc2Dashboard;

/* ──────────────────────────────────────────────────────────────────────
   Scoped styles for this component only. Reuses the app's existing CSS
   custom properties (--accent, --purple, --green, --red, --orange, --bg,
   --panel, --border, --border2, --text, --text-mid, --text-dim, --mono,
   --sans, --radius) which are already defined at :root by App.js — no
   new palette is introduced here.
   ────────────────────────────────────────────────────────────────────── */
const macCss = `
  .mac-dashboard { --sf: -apple-system, BlinkMacSystemFont, "SF Pro Display", var(--sans), sans-serif; }
  .mac-wallpaper {
    position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0;
    background:
      radial-gradient(600px circle at 12% 15%, rgba(41,211,255,0.13), transparent 60%),
      radial-gradient(520px circle at 88% 10%, rgba(139,124,255,0.12), transparent 60%),
      radial-gradient(650px circle at 78% 90%, rgba(225,85,84,0.07), transparent 60%),
      radial-gradient(560px circle at 8% 92%, rgba(34,217,122,0.08), transparent 60%);
    filter: blur(30px);
  }

  .mac-titlebar {
    display: flex; align-items: center; gap: 16px;
    background: linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.02));
    backdrop-filter: blur(24px) saturate(160%); -webkit-backdrop-filter: blur(24px) saturate(160%);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px; padding: 12px 16px; margin-bottom: 14px;
    box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset, 0 10px 26px -12px rgba(0,0,0,0.5);
  }
  .mac-traffic-lights { display: flex; gap: 7px; flex-shrink: 0; }
  .mac-dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; opacity: 0.9; }
  .mac-titlebar-title {
    font-family: var(--sf); font-size: 14px; font-weight: 600; color: var(--text);
    display: flex; align-items: center; gap: 10px; flex: 1; letter-spacing: -0.1px;
  }
  .mac-titlebar-live {
    display: inline-flex; align-items: center; gap: 6px;
    font-family: var(--sf); font-size: 11.5px; font-weight: 500; color: var(--text-dim);
  }
  .mac-live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: mac-blink 2s infinite; }
  @keyframes mac-blink { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
  .mac-toolbar { display: flex; gap: 4px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 3px; }
  .mac-toolbar-btn {
    width: 30px; height: 26px; display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: 7px; color: var(--text-dim); cursor: pointer; transition: all 0.15s;
  }
  .mac-toolbar-btn:hover { color: var(--text); background: rgba(255,255,255,0.05); }
  .mac-toolbar-btn.active { background: var(--accent); color: var(--bg); }
  .mac-toolbar-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .mac-segmented {
    display: inline-flex; gap: 2px; background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07); border-radius: 11px; padding: 3px; margin-bottom: 16px;
  }
  .mac-segment {
    position: relative; padding: 6px 16px; background: transparent; border: none; border-radius: 8px;
    font-family: var(--sf); font-size: 12px; font-weight: 500; color: var(--text-mid); cursor: pointer;
  }
  .mac-segment:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .mac-segment-pill { position: absolute; inset: 0; background: var(--accent); border-radius: 8px; z-index: 0; }
  .mac-segment.active { color: var(--bg); font-weight: 650; }

  .mac-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    /* Rows 1-2 hold fixed-shape content (stat numbers, a canvas that needs a definite
       height to render). Rows 3-5 hold content of variable length (findings list,
       7-day heatmap, 5-row coverage list) so they use minmax(...,auto) — a floor height
       with room to grow — rather than a guessed fixed px that content could overflow. */
    grid-template-rows: 118px 250px minmax(300px, auto) minmax(200px, auto) minmax(210px, auto);
    grid-template-areas:
      "stat1 stat2 stat3 stat4"
      "trend trend trend ask"
      "rings findings findings origins"
      "heat heat heat heat"
      "coverage coverage coverage coverage";
    gap: 14px;
    align-items: stretch;
  }
  @media (max-width: 1180px) {
    .mac-grid {
      grid-template-columns: repeat(2, 1fr);
      grid-template-rows: none;
      grid-template-areas:
        "stat1 stat2"
        "stat3 stat4"
        "trend trend"
        "ask ask"
        "rings rings"
        "findings findings"
        "origins origins"
        "heat heat"
        "coverage coverage";
    }
    .mac-grid > div[style*="trend"], .mac-grid > div[style*="findings"] { min-height: 260px; }
  }
  @media (max-width: 680px) {
    .mac-grid { grid-template-columns: 1fr; }
    .mac-grid > div { grid-column: 1 !important; }
  }

  .mac-card {
    background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.018));
    backdrop-filter: blur(20px) saturate(150%); -webkit-backdrop-filter: blur(20px) saturate(150%);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 20px; padding: 18px;
    box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset, 0 12px 28px -14px rgba(0,0,0,0.55);
    display: flex; flex-direction: column; height: 100%; box-sizing: border-box; overflow: hidden;
  }
  .mac-card-head { display: flex; justify-content: space-between; align-items: center; }
  .mac-card-title { font-family: var(--sf); font-size: 13.5px; font-weight: 650; color: var(--text); letter-spacing: -0.1px; }
  .mac-card-sub { font-family: var(--sf); font-size: 11.5px; color: var(--text-mid); margin-top: 2px; line-height: 1.5; }

  .mac-stat { justify-content: space-between; padding: 16px; }
  .mac-stat-icon { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; }
  .mac-stat-value { font-family: var(--sf); font-size: 25px; font-weight: 700; letter-spacing: -0.4px; line-height: 1; margin-top: 8px; }
  .mac-stat-label { font-family: var(--sf); font-size: 11px; color: var(--text-dim); margin-top: 3px; }

  .mac-ask { justify-content: space-between; }
  .mac-pill-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    padding: 9px 16px; border-radius: 10px; background: var(--accent); color: #06141B;
    border: none; font-family: var(--sf); font-size: 12.5px; font-weight: 600; cursor: pointer; margin-top: 12px;
  }
  .mac-pill-btn:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }

  .mac-ring-label { flex: 1; min-width: 0; font-family: var(--sf); font-size: 11.5px; color: var(--text-mid); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mac-ring-score { font-family: var(--sf); font-size: 11.5px; font-weight: 650; color: var(--text); flex-shrink: 0; }

  .mac-bar-label { font-family: var(--sf); font-size: 12px; color: var(--text-mid); }
  .mac-bar-value { font-family: var(--mono); font-size: 11px; color: var(--text-dim); flex-shrink: 0; }
  .mac-bar-track { height: 6px; border-radius: 4px; background: rgba(255,255,255,0.06); overflow: hidden; }
  .mac-bar-fill { height: 100%; border-radius: 4px; }

  .mac-see-all { font-family: var(--sf); font-size: 12px; font-weight: 500; color: var(--accent); background: none; border: none; cursor: pointer; }
  .mac-see-all:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .mac-legend-text { font-family: var(--sf); font-size: 10.5px; color: var(--text-mid); }

  .mac-table { width: 100%; border-collapse: collapse; font-family: var(--sf); font-size: 12.5px; table-layout: fixed; }
  .mac-table th { text-align: left; padding: 7px 8px; color: var(--text-dim); font-size: 10.5px; font-weight: 500; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .mac-table td { padding: 8px 8px; border-bottom: 1px solid rgba(255,255,255,0.04); color: var(--text-mid); }
  .mac-table tr:last-child td { border-bottom: none; }
  .mac-td-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mac-td-mono { font-family: var(--mono); font-size: 11px; }

  .mac-status { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px 3px 7px; border-radius: 20px; font-family: var(--sf); font-size: 10.5px; font-weight: 500; white-space: nowrap; }
  .mac-status-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
  .mac-status-critical { background: rgba(225,85,84,0.12); color: var(--red); }
  .mac-status-elevated { background: rgba(240,168,87,0.12); color: var(--orange); }
  .mac-status-informational { background: rgba(34,217,122,0.12); color: var(--green); }

  .mac-heat-row { display: grid; grid-template-columns: 26px repeat(24, 1fr); gap: 2px; align-items: center; }
  .mac-heat-cell { height: 14px; border-radius: 3px; }
  .mac-heat-label { font-family: var(--sf); font-size: 9.5px; color: var(--text-dim); }

  @media (prefers-reduced-motion: reduce) {
    .mac-dashboard, .mac-dashboard * { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
  }
`;