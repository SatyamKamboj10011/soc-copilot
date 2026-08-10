import { useState, useEffect, useRef, useMemo, memo } from "react";
import { motion, animate } from "framer-motion";
import { Canvas, useFrame } from "@react-three/fiber";
import { MeshDistortMaterial, Sphere, Torus } from "@react-three/drei";
import ThreatMap from "./ThreatMap";

const FLASK_URL = "http://localhost:5000";

const TSC_ORDER = ["security", "availability", "confidentiality", "processing_integrity", "privacy"];
const TSC_COLORS = {
  security: "#4DD8E8",
  availability: "#22D97A",
  confidentiality: "#8B7CFF",
  processing_integrity: "#E8B84D",
  privacy: "#C93DE0",
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SEVERITY_LABEL = { critical: "Critical", elevated: "Elevated", informational: "Informational" };

/* ── motion primitives ── */
const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "easeOut" } },
};
const staggerContainer = (stagger = 0.07, delay = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
});

function useCountUp(target, duration = 1.1) {
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
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 17 9 11 13 15 21 6" /><polyline points="14 6 21 6 21 13" />
    </svg>
  );
}
function IconCoverage() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" />
    </svg>
  );
}
function IconTable() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="9" y1="10" x2="9" y2="20" />
    </svg>
  );
}
function IconGrid() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
function IconAlertTriangle() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function IconGlobe() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
function IconShieldCheck() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" /><path d="M9 12l2 2 4-4" />
    </svg>
  );
}

/* ── radial gauge (SVG ring, animated draw-on) ── */
function RadialGauge({ value, size = 92, stroke = 7, color = "#4DD8E8", label }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const displayValue = useCountUp(value ?? 0);
  const offset = circumference - (Math.max(0, Math.min(100, value ?? 0)) / 100) * circumference;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="var(--border2)" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 5px ${color}88)` }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span className="radial-gauge-label" style={{ fontSize: size * 0.24, color: "var(--text)" }}>{displayValue}%</span>
        {label && <span style={{ fontFamily: "var(--mono)", fontSize: 8, color: "var(--text-dim)", letterSpacing: 1, marginTop: 2 }}>{label}</span>}
      </div>
    </div>
  );
}

/* ── HUD stat chip with animated count ── */
function HudStat({ icon, label, value, suffix = "", color = "#4DD8E8" }) {
  const displayValue = useCountUp(value ?? 0);
  return (
    <motion.div className="bento-card hud-card hud-stat-chip" variants={fadeUp} style={{ "--hud-accent": color }}>
      <div className="hud-card-topline" />
      <div className="hud-stat-icon" style={{ background: `${color}1f`, color }}>{icon}</div>
      <div>
        <div className="hud-stat-label">{label}</div>
        <div className="hud-stat-value" style={{ color }}>{displayValue}{suffix}</div>
      </div>
    </motion.div>
  );
}

/* ── 3D hero visual: rotating network core + counter-rotating scan ring ── */
function NetworkCore() {
  const coreRef = useRef();
  const ringRef = useRef();
  useFrame((_, delta) => {
    if (coreRef.current) coreRef.current.rotation.y += delta * 0.3;
    if (ringRef.current) { ringRef.current.rotation.z -= delta * 0.5; ringRef.current.rotation.x = 1.2; }
  });
  return (
    <>
      <Sphere ref={coreRef} args={[0.95, 96, 96]}>
        <MeshDistortMaterial color="#0F3B42" attach="material" distort={0.28} speed={1.4} roughness={0.25} metalness={0.85} emissive="#4DD8E8" emissiveIntensity={0.35} />
      </Sphere>
      <Torus ref={ringRef} args={[1.55, 0.015, 16, 100]}>
        <meshBasicMaterial color="#4DD8E8" transparent opacity={0.55} />
      </Torus>
    </>
  );
}
function HeroVisual() {
  return (
    <Canvas camera={{ position: [0, 0, 3.4] }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.5} />
      <pointLight position={[3, 3, 3]} intensity={50} color="#4DD8E8" />
      <pointLight position={[-3, -2, 2]} intensity={30} color="#C93DE0" />
      <NetworkCore />
    </Canvas>
  );
}

const Soc2Dashboard = memo(function Soc2Dashboard({ onAskSira, onSeeFindings }) {
  const [overview, setOverview]   = useState(null);
  const [findings, setFindings]   = useState([]);
  const [heatmap, setHeatmap]     = useState({ cells: [], max: 0 });
  const [trend, setTrend]         = useState([]);
  const [threatOrigins, setThreatOrigins] = useState(0);
  const [activeWidget, setActiveWidget] = useState("trend");

  const trendChartRef      = useRef(null);
  const trendChartInstance = useRef(null);
  const trendSectionRef    = useRef(null);
  const coverageSectionRef = useRef(null);
  const findingsSectionRef = useRef(null);
  const heatmapSectionRef  = useRef(null);

  useEffect(() => {
    fetch(`${FLASK_URL}/compliance/overview`).then(r => r.json()).then(setOverview).catch(() => {});
    fetch(`${FLASK_URL}/compliance/findings?limit=8`).then(r => r.json()).then(d => setFindings(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${FLASK_URL}/compliance/heatmap`).then(r => r.json()).then(d => setHeatmap(d || { cells: [], max: 0 })).catch(() => {});
    fetch(`${FLASK_URL}/compliance/trend`).then(r => r.json()).then(d => setTrend(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${FLASK_URL}/top-ips?limit=15`).then(r => r.json()).then(d => setThreatOrigins(Array.isArray(d) ? d.length : 0)).catch(() => {});
  }, []);

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
            borderColor: "#4DD8E8", backgroundColor: "rgba(77,216,232,0.12)",
            tension: 0.4, fill: true, pointRadius: 3, pointBackgroundColor: "#4DD8E8",
            yAxisID: "y",
          },
          {
            label: "Alert volume",
            data: trend.map(t => t.alerts),
            borderColor: "#C93DE0", backgroundColor: "transparent",
            tension: 0.4, fill: false, pointRadius: 3, pointBackgroundColor: "#C93DE0",
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
            backgroundColor: "#141416", borderColor: "rgba(77,216,232,0.3)", borderWidth: 1,
            titleColor: "#4DD8E8", bodyColor: "#9A9AA2",
            titleFont: { family: "Inter", size: 11 }, bodyFont: { family: "IBM Plex Mono", size: 10 },
          },
        },
        scales: {
          x: { grid: { color: "rgba(255,255,255,0.04)", borderDash: [3, 4] }, ticks: { color: "#5A5A62", font: { family: "IBM Plex Mono", size: 9 } } },
          y: { position: "left", grid: { color: "rgba(255,255,255,0.04)", borderDash: [3, 4] }, ticks: { color: "#5A5A62", font: { family: "IBM Plex Mono", size: 9 } }, min: 0, max: 100 },
          y1: { position: "right", grid: { display: false }, ticks: { color: "#5A5A62", font: { family: "IBM Plex Mono", size: 9 } } },
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
    <div className="page hud-page" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="page-title">SOC 2 Compliance Dashboard</div>
          <div className="page-sub" style={{ marginBottom: 0 }}>TRUST SERVICE CRITERIA — LIVE FROM SURICATA, ZEEK &amp; SENTINEL TELEMETRY</div>
        </div>
        <span className="hud-live"><span className="hud-live-dot" />Live telemetry</span>
      </div>

      {/* ── HUD STATUS STRIP ── */}
      <motion.div className="hud-stat-strip" style={{ marginBottom: 14 }} variants={staggerContainer(0.08)} initial="hidden" animate="show">
        <HudStat icon={<IconShieldCheck />} label="Compliance Score" value={overview?.overall_score} suffix="%" color="#4DD8E8" />
        <HudStat icon={<IconAlertTriangle />} label="Open Findings" value={findingsOpen} color={findingsOpen > 0 ? "#E15554" : "#22D97A"} />
        <HudStat icon={<IconGlobe />} label="Threat Origins" value={threatOrigins} color="#C93DE0" />
        <HudStat icon={<IconActivity />} label="Controls Passing" value={overview?.controls_passing} suffix={` / ${overview?.controls_total ?? "--"}`} color="#22D97A" />
      </motion.div>

      {/* ── TOP ROW: hero + trend + widget switcher ── */}
      <motion.div style={{ display: "grid", gridTemplateColumns: "260px 1fr 220px", gap: 14, marginBottom: 14 }} variants={staggerContainer(0.1)} initial="hidden" animate="show">
        <motion.div className="bento-card hud-card" variants={fadeUp} style={{ "--hud-accent": "#8B7CFF", padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div className="hud-card-topline" />
          <div style={{ width: "100%", height: 150, borderRadius: 14, overflow: "hidden", background: "radial-gradient(circle at 50% 40%, rgba(77,216,232,0.14), transparent 70%)" }}>
            <HeroVisual />
          </div>
          <motion.button
            className="bento-pill" onClick={() => onAskSira && onAskSira("Give me a summary of our current SOC 2 compliance posture and any open findings.")}
            animate={{ scale: [1, 1.04, 1] }} transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
            whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.96 }}
          >
            <IconSparkle /> AI analytics
          </motion.button>
        </motion.div>

        <motion.div className="bento-card hud-card" variants={fadeUp} style={{ "--hud-accent": "#4DD8E8" }} ref={trendSectionRef}>
          <div className="hud-card-topline" />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div className="bento-card-title">Compliance Score Trend</div>
              <div className="bento-card-sub">Daily score vs. alert volume, derived from live telemetry</div>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              {[["#4DD8E8", "Score"], ["#C93DE0", "Alerts"]].map(([color, label]) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
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
              key={w.key} variants={fadeUp} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
              className={`bento-card hud-card bento-widget${activeWidget === w.key ? " active" : ""}`}
              style={{ "--hud-accent": "#4DD8E8" }} onClick={() => jumpTo(w.key, w.ref)}
            >
              <div className="hud-card-topline" />
              <div className="bento-widget-icon">{w.icon}</div>
              <div className="bento-widget-label">{w.label}</div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ── MIDDLE ROW: findings / heatmap / map ── */}
      <motion.div style={{ display: "grid", gridTemplateColumns: "0.9fr 0.9fr 1.2fr", gap: 14, marginBottom: 14 }} variants={staggerContainer(0.12)} initial="hidden" animate="show">
        <motion.div className="bento-card hud-card" variants={fadeUp} style={{ "--hud-accent": findingsOpen > 0 ? "#E15554" : "#22D97A" }} ref={findingsSectionRef}>
          <div className="hud-card-topline" />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div className="bento-card-title">Audit Findings</div>
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
                  <motion.tr key={f.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: i * 0.05 }}>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.title}>{f.title}</td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.src_ip || "--"}</td>
                    <td style={{ overflow: "hidden" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                        <span className={`bento-dot ${f.severity}`} />
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

        <motion.div className="bento-card hud-card" variants={fadeUp} style={{ "--hud-accent": "#E8B84D" }} ref={heatmapSectionRef}>
          <div className="hud-card-topline" />
          <div className="bento-card-title" style={{ marginBottom: 14 }}>Alert Heatmap</div>
          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
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
                      style={{ background: count === 0 ? "var(--bg3)" : `rgba(232,184,77,${0.15 + intensity * 0.8})` }}
                    />
                  );
                })}
              </div>
            ))}
          </motion.div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <span className="bento-heat-label">00h</span><span className="bento-heat-label">12h</span><span className="bento-heat-label">23h</span>
          </div>
        </motion.div>

        <motion.div className="bento-card hud-card" variants={fadeUp} style={{ "--hud-accent": "#C93DE0", padding: 0, overflow: "hidden" }}>
          <div className="hud-card-topline" />
          <div className="hud-scan-overlay" />
          <div style={{ position: "absolute", top: 16, left: 20, zIndex: 500, display: "flex", alignItems: "center", gap: 10 }}>
            <div className="bento-card-title" style={{ fontSize: 14 }}>Incident Origins</div>
            <span className="hud-live"><span className="hud-live-dot" style={{ background: "var(--magenta)", boxShadow: "0 0 6px var(--magenta)" }} />Scanning</span>
          </div>
          <div style={{ height: 320 }}>
            <ThreatMap />
          </div>
        </motion.div>
      </motion.div>

      {/* ── BOTTOM ROW: control coverage lollipop + TSC balances ── */}
      <motion.div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 14 }} variants={staggerContainer(0.12)} initial="hidden" animate="show">
        <motion.div className="bento-card hud-card" variants={fadeUp} style={{ "--hud-accent": "#4DD8E8" }} ref={coverageSectionRef}>
          <div className="hud-card-topline" />
          <div className="bento-card-title" style={{ marginBottom: 4 }}>Control Coverage by Criteria</div>
          <div className="bento-card-sub" style={{ marginBottom: 18 }}>{overview?.controls_passing ?? "--"} / {overview?.controls_total ?? "--"} controls passing</div>
          <div style={{ display: "flex", alignItems: "flex-end", height: 150, gap: 4 }}>
            {TSC_ORDER.map((key, i) => {
              const c = criteria.find(x => x.key === key);
              const score = c?.score ?? 0;
              const color = TSC_COLORS[key];
              return (
                <div key={key} className="lollipop-col">
                  <motion.div
                    className="lollipop-stem"
                    style={{ background: `linear-gradient(180deg, transparent, ${color}66)` }}
                    initial={{ height: 0 }} animate={{ height: `${Math.max(score, 4)}%` }}
                    transition={{ duration: 0.9, delay: i * 0.08, ease: "easeOut" }}
                  >
                    <div className="lollipop-dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                  </motion.div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
            {TSC_ORDER.map(key => (
              <div key={key} style={{ flex: 1, textAlign: "center", fontFamily: "var(--mono)", fontSize: 8, color: "var(--text-dim)", letterSpacing: 0.5 }}>
                {(overview ? (criteria.find(x => x.key === key)?.score ?? 0) : "--")}%
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div className="bento-card hud-card" variants={fadeUp} style={{ "--hud-accent": "#22D97A" }}>
          <div className="hud-card-topline" />
          <div className="bento-card-title" style={{ marginBottom: 16 }}>Trust Service Criteria Balances</div>
          <div className="balance-row" style={{ gridTemplateColumns: `repeat(${TSC_ORDER.length}, 1fr)` }}>
            {TSC_ORDER.map(key => {
              const c = criteria.find(x => x.key === key);
              const score = c?.score ?? 0;
              return (
                <div key={key} className="balance-card" style={{ alignItems: "center", textAlign: "center" }}>
                  <RadialGauge value={overview ? score : 0} size={78} stroke={6} color={TSC_COLORS[key]} />
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
