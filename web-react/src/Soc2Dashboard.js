import { useState, useEffect, useRef, useMemo, memo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { MeshDistortMaterial, Sphere } from "@react-three/drei";
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

function BlobMesh() {
  const meshRef = useRef();
  useFrame((_, delta) => { if (meshRef.current) meshRef.current.rotation.y += delta * 0.25; });
  return (
    <Sphere ref={meshRef} args={[1.15, 128, 128]}>
      <MeshDistortMaterial color="#8B7CFF" attach="material" distort={0.45} speed={1.6} roughness={0.15} metalness={0.75} />
    </Sphere>
  );
}

function HeroBlob() {
  return (
    <Canvas camera={{ position: [0, 0, 3] }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.7} />
      <pointLight position={[3, 3, 3]} intensity={45} color="#4DD8E8" />
      <pointLight position={[-3, -2, 2]} intensity={35} color="#C93DE0" />
      <pointLight position={[0, 3, -3]} intensity={25} color="#E8B84D" />
      <BlobMesh />
    </Canvas>
  );
}

const Soc2Dashboard = memo(function Soc2Dashboard({ onAskSira, onSeeFindings }) {
  const [overview, setOverview]   = useState(null);
  const [findings, setFindings]   = useState([]);
  const [heatmap, setHeatmap]     = useState({ cells: [], max: 0 });
  const [trend, setTrend]         = useState([]);
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
    if (isNaN(d.getTime())) return ts.slice(5, 16).replace("T", " ");
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div className="page" style={{ padding: 20 }}>
      <div className="page-title">SOC 2 Compliance Dashboard</div>
      <div className="page-sub">TRUST SERVICE CRITERIA — LIVE FROM SURICATA, ZEEK &amp; SENTINEL TELEMETRY</div>

      {/* ── TOP ROW: hero + trend + widget switcher ── */}
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 220px", gap: 14, marginBottom: 14 }}>
        <div className="bento-card" style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ width: "100%", height: 150, borderRadius: 14, overflow: "hidden", background: "radial-gradient(circle at 50% 40%, rgba(139,124,255,0.18), transparent 70%)" }}>
            <HeroBlob />
          </div>
          <button className="bento-pill" onClick={() => onAskSira && onAskSira("Give me a summary of our current SOC 2 compliance posture and any open findings.")}>
            <IconSparkle /> AI analytics
          </button>
        </div>

        <div className="bento-card" ref={trendSectionRef}>
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
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 10 }}>
          {[
            { key: "trend",    icon: <IconTrend />,    label: "Score Trend",  ref: trendSectionRef },
            { key: "coverage", icon: <IconCoverage />, label: "Coverage",     ref: coverageSectionRef },
            { key: "findings", icon: <IconTable />,     label: "Findings",     ref: findingsSectionRef },
            { key: "heatmap",  icon: <IconGrid />,      label: "Alert Heatmap", ref: heatmapSectionRef },
          ].map(w => (
            <div key={w.key} className={`bento-card bento-widget${activeWidget === w.key ? " active" : ""}`} onClick={() => jumpTo(w.key, w.ref)}>
              <div className="bento-widget-icon">{w.icon}</div>
              <div className="bento-widget-label">{w.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── MIDDLE ROW: findings / heatmap / map ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div className="bento-card" ref={findingsSectionRef}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div className="bento-card-title">Audit Findings</div>
            <button className="bento-see-all" onClick={() => onSeeFindings && onSeeFindings()}>See all</button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="bento-table" style={{ tableLayout: "fixed", width: "100%" }}>
              <colgroup><col style={{ width: "42%" }} /><col style={{ width: "22%" }} /><col style={{ width: "20%" }} /><col style={{ width: "16%" }} /></colgroup>
              <thead><tr><th>Signature</th><th>Source</th><th>Status</th><th>Time</th></tr></thead>
              <tbody>
                {findings.length === 0 && (
                  <tr><td colSpan={4} style={{ color: "var(--text-dim)" }}>No open findings</td></tr>
                )}
                {findings.map(f => (
                  <tr key={f.id}>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.title}>{f.title}</td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.src_ip || "--"}</td>
                    <td style={{ overflow: "hidden" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                        <span className={`bento-dot ${f.severity}`} />
                        {SEVERITY_LABEL[f.severity] || f.severity}
                      </span>
                    </td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 10, whiteSpace: "nowrap" }}>{findingsRelative(f.detected_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bento-card" ref={heatmapSectionRef}>
          <div className="bento-card-title" style={{ marginBottom: 14 }}>Alert Heatmap</div>
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
                      style={{ background: count === 0 ? "var(--bg3)" : `rgba(77,216,232,${0.15 + intensity * 0.8})` }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <span className="bento-heat-label">00h</span><span className="bento-heat-label">12h</span><span className="bento-heat-label">23h</span>
          </div>
        </div>

        <div className="bento-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 16, left: 20, zIndex: 500 }}>
            <div className="bento-card-title" style={{ fontSize: 14 }}>Incident Origins</div>
          </div>
          <div style={{ height: 320 }}>
            <ThreatMap />
          </div>
        </div>
      </div>

      {/* ── BOTTOM ROW: control coverage lollipop + TSC balances ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 14 }}>
        <div className="bento-card" ref={coverageSectionRef}>
          <div className="bento-card-title" style={{ marginBottom: 4 }}>Control Coverage by Criteria</div>
          <div className="bento-card-sub" style={{ marginBottom: 18 }}>{overview?.controls_passing ?? "--"} / {overview?.controls_total ?? "--"} controls passing</div>
          <div style={{ display: "flex", alignItems: "flex-end", height: 150, gap: 4 }}>
            {TSC_ORDER.map(key => {
              const c = criteria.find(x => x.key === key);
              const score = c?.score ?? 0;
              const color = TSC_COLORS[key];
              return (
                <div key={key} className="lollipop-col">
                  <div className="lollipop-stem" style={{ height: `${Math.max(score, 4)}%`, background: `linear-gradient(180deg, transparent, ${color}66)` }}>
                    <div className="lollipop-dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                  </div>
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
        </div>

        <div className="bento-card">
          <div className="bento-card-title" style={{ marginBottom: 16 }}>Trust Service Criteria Balances</div>
          <div className="balance-row" style={{ gridTemplateColumns: `repeat(${TSC_ORDER.length}, 1fr)` }}>
            {TSC_ORDER.map(key => {
              const c = criteria.find(x => x.key === key);
              const score = c?.score ?? 0;
              const up = score >= 80;
              return (
                <div key={key} className="balance-card">
                  <div className="balance-label">{c?.label || key}</div>
                  <div className="balance-value">{overview ? `${score}%` : "--"}</div>
                  <div className={`balance-delta ${up ? "up" : "down"}`}>
                    {up ? "▲" : "▼"} {c ? `${c.controls_passing}/${c.controls_total} controls` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

export default Soc2Dashboard;
