import { useState, useEffect, useRef, useMemo, memo } from "react";
import { motion, animate } from "framer-motion";
import ThreatMap from "./ThreatMap";

const FLASK_URL = "https://api.sira-soc.me";

const TSC_ORDER = [
  "security",
  "availability",
  "confidentiality",
  "processing_integrity",
  "privacy",
];

const TSC_COLORS = {
  security: "var(--accent)",
  availability: "var(--purple)",
  confidentiality: "var(--green)",
  processing_integrity: "var(--orange)",
  privacy: "var(--red)",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const SEVERITY_LABEL = {
  critical: "Critical",
  elevated: "Elevated",
  informational: "Informational",
};

const RANGE_OPTIONS = [
  { key: "24h", label: "24h", hours: 24 },
  { key: "7d", label: "7d", hours: 168 },
  { key: "all", label: "All time", hours: null },
];

/* =========================================================
   HELPERS
========================================================= */

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

/* =========================================================
   MOTION
========================================================= */

const fadeUp = {
  hidden: {
    opacity: 0,
    y: 10,
  },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.35,
      ease: "easeOut",
    },
  },
};

const staggerContainer = (stagger = 0.05, delay = 0) => ({
  hidden: {},
  show: {
    transition: {
      staggerChildren: stagger,
      delayChildren: delay,
    },
  },
});

function useCountUp(target, duration = 0.9) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const t =
      typeof target === "number" && !isNaN(target)
        ? target
        : 0;

    const controls = animate(0, t, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    });

    return () => controls.stop();
  }, [target, duration]);

  return display;
}

/* =========================================================
   ICONS
========================================================= */

function IconTrend() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 17 9 11 13 15 21 6" />
      <polyline points="14 6 21 6 21 13" />
    </svg>
  );
}

function IconCoverage() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" />
    </svg>
  );
}

function IconTable() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="9" y1="10" x2="9" y2="20" />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

function IconSparkle() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 2l1.9 5.9L20 10l-6.1 2.1L12 18l-1.9-5.9L4 10l6.1-2.1L12 2z" />
    </svg>
  );
}

function IconActivity() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function IconAlertTriangle() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IconShieldCheck() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function IconBot() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M12 8V4" />
      <circle cx="12" cy="3" r="1" />
      <line x1="9" y1="13" x2="9" y2="15" />
      <line x1="15" y1="13" x2="15" y2="15" />
    </svg>
  );
}

/* =========================================================
   ACTIVITY RINGS
========================================================= */

function Ring({
  cx,
  cy,
  r,
  stroke,
  color,
  value,
  delay = 0,
}) {
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(
    0,
    Math.min(100, value ?? 0)
  );

  const offset =
    circumference -
    (pct / 100) * circumference;

  return (
    <>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        stroke="rgba(255,255,255,0.07)"
        strokeWidth={stroke}
        fill="none"
      />

      <motion.circle
        cx={cx}
        cy={cy}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{
          strokeDashoffset: circumference,
        }}
        animate={{
          strokeDashoffset: offset,
        }}
        transition={{
          duration: 1.1,
          ease: "easeOut",
          delay,
        }}
      />
    </>
  );
}

function ActivityRings({ criteria, loaded }) {
  const size = 140;
  const cx = size / 2;
  const cy = size / 2;
  const stroke = 8;
  const gap = 12;
  const outerR = 60;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        flex: 1,
        minHeight: 0,
        width: "100%",
      }}
    >
      <svg
        width={size}
        height={size}
        style={{
          transform: "rotate(-90deg)",
          flexShrink: 0,
        }}
      >
        {TSC_ORDER.map((key, i) => {
          const c = criteria.find(
            (x) => x.key === key
          );

          return (
            <Ring
              key={key}
              cx={cx}
              cy={cy}
              r={outerR - i * gap}
              stroke={stroke}
              color={TSC_COLORS[key]}
              value={
                loaded
                  ? c?.score ?? 0
                  : 0
              }
              delay={i * 0.08}
            />
          );
        })}
      </svg>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          width: "100%",
          marginTop: 14,
        }}
      >
        {TSC_ORDER.map((key) => {
          const c = criteria.find(
            (x) => x.key === key
          );

          return (
            <div
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background:
                    TSC_COLORS[key],
                  flexShrink: 0,
                }}
              />

              <span className="mac-ring-label">
                {c?.label || key}
              </span>

              <span className="mac-ring-score">
                {loaded
                  ? `${c?.score ?? 0}%`
                  : "--"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =========================================================
   KPI WIDGET
========================================================= */

function StatWidget({
  icon,
  label,
  value,
  suffix = "",
  tone = "neutral",
  loaded,
  area,
}) {
  const displayValue = useCountUp(
    loaded ? value ?? 0 : 0
  );

  const toneColor = {
    neutral: "var(--accent)",
    good: "var(--green)",
    bad: "var(--red)",
  }[tone];

  return (
    <motion.div
      className="mac-card mac-stat"
      variants={fadeUp}
      style={{
        gridArea: area,
      }}
    >
      <div
        className="mac-stat-icon"
        style={{
          color: toneColor,
        }}
      >
        {icon}
      </div>

      <div
        className="mac-stat-value"
        style={{
          color: loaded
            ? "var(--text)"
            : "var(--text-dim)",
        }}
      >
        {loaded ? displayValue : "--"}
        {loaded ? suffix : ""}
      </div>

      <div className="mac-stat-label">
        {label}
      </div>
    </motion.div>
  );
}

/* =========================================================
   COVERAGE BARS
========================================================= */

function CoverageBars({
  criteria,
  loaded,
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        marginTop: 4,
        flex: 1,
        justifyContent: "center",
      }}
    >
      {TSC_ORDER.map((key, i) => {
        const c = criteria.find(
          (x) => x.key === key
        );

        const score = loaded
          ? c?.score ?? 0
          : 0;

        return (
          <div key={key}>
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                marginBottom: 6,
              }}
            >
              <span className="mac-bar-label">
                {c?.label || key}
              </span>

              <span className="mac-bar-value">
                {loaded
                  ? `${c.controls_passing}/${c.controls_total}`
                  : "--"}
              </span>
            </div>

            <div className="mac-bar-track">
              <motion.div
                className="mac-bar-fill"
                style={{
                  background:
                    TSC_COLORS[key],
                }}
                initial={{
                  width: 0,
                }}
                animate={{
                  width: `${score}%`,
                }}
                transition={{
                  duration: 0.8,
                  delay: i * 0.06,
                  ease: "easeOut",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* =========================================================
   MAIN SOC DASHBOARD
========================================================= */

const Soc2Dashboard = memo(
  function Soc2Dashboard({
    onAskSira,
    onSeeFindings,
  }) {
    const [overview, setOverview] =
      useState(null);

    const [findings, setFindings] =
      useState([]);

    const [heatmap, setHeatmap] =
      useState({
        cells: [],
        max: 0,
      });

    const [trend, setTrend] =
      useState([]);

    const [threatOrigins, setThreatOrigins] =
      useState(0);

    const [activeWidget, setActiveWidget] =
      useState("trend");

    const [range, setRange] =
      useState("all");

    const activeHours =
      RANGE_OPTIONS.find(
        (r) => r.key === range
      )?.hours;

    const trendChartRef =
      useRef(null);

    const trendChartInstance =
      useRef(null);

    const trendSectionRef =
      useRef(null);

    const coverageSectionRef =
      useRef(null);

    const findingsSectionRef =
      useRef(null);

    const heatmapSectionRef =
      useRef(null);

    const originsSectionRef =
      useRef(null);

    const askSectionRef =
      useRef(null);

    /* =====================================================
       API DATA
    ===================================================== */

    useEffect(() => {
      const hp = activeHours
        ? `hours=${activeHours}`
        : "";

      const q = (extra) =>
        [hp, extra]
          .filter(Boolean)
          .join("&");

      fetch(
        `${FLASK_URL}/compliance/overview?${q()}`
      )
        .then((r) => r.json())
        .then(setOverview)
        .catch(() => {});

      fetch(
        `${FLASK_URL}/compliance/findings?${q(
          "limit=8"
        )}`
      )
        .then((r) => r.json())
        .then((d) =>
          setFindings(
            Array.isArray(d) ? d : []
          )
        )
        .catch(() => {});

      fetch(
        `${FLASK_URL}/compliance/heatmap?${q()}`
      )
        .then((r) => r.json())
        .then((d) =>
          setHeatmap(
            d || {
              cells: [],
              max: 0,
            }
          )
        )
        .catch(() => {});

      fetch(
        `${FLASK_URL}/compliance/trend?${q()}`
      )
        .then((r) => r.json())
        .then((d) =>
          setTrend(
            Array.isArray(d) ? d : []
          )
        )
        .catch(() => {});

      fetch(
        `${FLASK_URL}/top-ips?${q(
          "limit=15"
        )}`
      )
        .then((r) => r.json())
        .then((d) =>
          setThreatOrigins(
            Array.isArray(d)
              ? d.length
              : 0
          )
        )
        .catch(() => {});
    }, [activeHours]);

    /* =====================================================
       TREND CHART
    ===================================================== */

    useEffect(() => {
      if (
        !trend.length ||
        !trendChartRef.current ||
        !window.Chart
      ) {
        return;
      }

      if (trendChartInstance.current) {
        trendChartInstance.current.destroy();
      }

      trendChartInstance.current =
        new window.Chart(
          trendChartRef.current,
          {
            type: "line",

            data: {
              labels: trend.map(
                (t) => t.date
              ),

              datasets: [
                {
                  label:
                    "Compliance score",

                  data: trend.map(
                    (t) => t.score
                  ),

                  borderColor:
                    "#4DD8E8",

                  backgroundColor:
                    "rgba(77,216,232,0.10)",

                  borderWidth: 2,

                  tension: 0.35,

                  fill: true,

                  pointRadius: 2.5,

                  pointBackgroundColor:
                    "#4DD8E8",

                  yAxisID: "y",
                },

                {
                  label:
                    "Alert volume",

                  data: trend.map(
                    (t) => t.alerts
                  ),

                  borderColor:
                    "#5A5A62",

                  backgroundColor:
                    "transparent",

                  borderWidth: 1.5,

                  borderDash: [3, 3],

                  tension: 0.35,

                  fill: false,

                  pointRadius: 2,

                  pointBackgroundColor:
                    "#5A5A62",

                  yAxisID: "y1",
                },
              ],
            },

            options: {
              responsive: true,

              maintainAspectRatio:
                false,

              interaction: {
                mode: "index",
                intersect: false,
              },

              plugins: {
                legend: {
                  display: false,
                },

                tooltip: {
                  backgroundColor:
                    "#14161B",

                  borderColor:
                    "rgba(255,255,255,0.12)",

                  borderWidth: 1,

                  titleColor:
                    "#EDEDEF",

                  bodyColor:
                    "#9A9AA2",

                  titleFont: {
                    family: "Inter",
                    size: 11,
                  },

                  bodyFont: {
                    family: "Inter",
                    size: 11,
                  },

                  padding: 10,

                  cornerRadius: 8,
                },
              },

              scales: {
                x: {
                  grid: {
                    color:
                      "rgba(255,255,255,0.04)",
                    borderDash: [3, 4],
                  },

                  ticks: {
                    color: "#5A5A62",
                    font: {
                      family: "Inter",
                      size: 9,
                    },
                  },
                },

                y: {
                  position: "left",

                  grid: {
                    color:
                      "rgba(255,255,255,0.04)",
                    borderDash: [3, 4],
                  },

                  ticks: {
                    color: "#5A5A62",
                    font: {
                      family: "Inter",
                      size: 9,
                    },
                  },

                  min: 0,
                  max: 100,
                },

                y1: {
                  position: "right",

                  grid: {
                    display: false,
                  },

                  ticks: {
                    color: "#5A5A62",
                    font: {
                      family: "Inter",
                      size: 9,
                    },
                  },
                },
              },
            },
          }
        );

      return () => {
        if (trendChartInstance.current) {
          trendChartInstance.current.destroy();
        }
      };
    }, [trend]);

    /* =====================================================
       HEATMAP
    ===================================================== */

    const heatGrid = useMemo(() => {
      const byCell = {};

      heatmap.cells.forEach((c) => {
        byCell[
          `${c.weekday}-${c.hour}`
        ] = c.count;
      });

      return byCell;
    }, [heatmap]);

    /* =====================================================
       NAVIGATION
    ===================================================== */

    const jumpTo = (widget, ref) => {
      setActiveWidget(widget);

      ref.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    };

    const criteria =
      overview?.criteria || [];

    const loaded = !!overview;

    const findingsRelative = (ts) => {
      if (!ts) return "--";

      const d = new Date(ts);

      if (isNaN(d.getTime())) {
        return ts.slice(11, 16);
      }

      const pad = (n) =>
        String(n).padStart(2, "0");

      return `${pad(
        d.getHours()
      )}:${pad(d.getMinutes())}`;
    };

    const findingsOpen =
      overview?.findings_open ?? 0;

    /* =====================================================
       TOOLBAR
    ===================================================== */

    const toolbarItems = [
      {
        key: "trend",
        icon: <IconTrend />,
        ref: trendSectionRef,
        title: "Score trend",
      },

      {
        key: "coverage",
        icon: <IconCoverage />,
        ref: coverageSectionRef,
        title: "Coverage",
      },

      {
        key: "findings",
        icon: <IconTable />,
        ref: findingsSectionRef,
        title: "Findings",
      },

      {
        key: "heatmap",
        icon: <IconGrid />,
        ref: heatmapSectionRef,
        title: "Alert heatmap",
      },
    ];

    return (
      <div className="soc2-dashboard page">
        <style>{soc2Css}</style>

        <div className="soc-shell">

          {/* =================================================
              SIDEBAR
          ================================================= */}

          <aside className="soc-sidebar">

            <div className="soc-brand">
              <div className="soc-brand-mark">
                <IconShieldCheck />
              </div>

              <div>
                <div className="soc-brand-name">
                  SOC 2
                </div>

                <div className="soc-brand-sub">
                  Compliance Operations
                </div>
              </div>
            </div>

            <div className="soc-nav-section">
              <div className="soc-nav-label">
                WORKSPACE
              </div>

              <button
                className="soc-nav-item active"
                onClick={() =>
                  jumpTo(
                    "trend",
                    trendSectionRef
                  )
                }
              >
                <IconGrid />
                <span>Overview</span>
              </button>

              <button
                className="soc-nav-item"
                onClick={() =>
                  jumpTo(
                    "trend",
                    trendSectionRef
                  )
                }
              >
                <IconActivity />
                <span>Score Trend</span>
              </button>

              <button
                className="soc-nav-item"
                onClick={() =>
                  jumpTo(
                    "findings",
                    findingsSectionRef
                  )
                }
              >
                <IconAlertTriangle />
                <span>Findings</span>

                {findingsOpen > 0 && (
                  <b>{findingsOpen}</b>
                )}
              </button>

              <button
                className="soc-nav-item"
                onClick={() =>
                  jumpTo(
                    "coverage",
                    coverageSectionRef
                  )
                }
              >
                <IconCoverage />
                <span>Controls</span>
              </button>

              <button
                className="soc-nav-item"
                onClick={() =>
                  jumpTo(
                    "heatmap",
                    heatmapSectionRef
                  )
                }
              >
                <IconTable />
                <span>Alert Activity</span>
              </button>
            </div>

            <div className="soc-nav-section">
              <div className="soc-nav-label">
                ANALYSIS
              </div>

              <button
                className="soc-nav-item"
                onClick={() =>
                  jumpTo(
                    "origins",
                    originsSectionRef
                  )
                }
              >
                <IconGlobe />
                <span>Incident Origins</span>
              </button>

              <button
                className="soc-nav-item"
                onClick={() =>
                  jumpTo(
                    "ask",
                    askSectionRef
                  )
                }
              >
                <IconBot />
                <span>Ask SIRA</span>
              </button>
            </div>

            <div className="soc-sidebar-bottom">

              <div className="soc-source-card">
                <div className="soc-nav-label">
                  DATA SOURCES
                </div>

                <div className="soc-source">
                  <span />
                  Compliance API
                  <em>Connected</em>
                </div>

                <div className="soc-source">
                  <span />
                  Findings Feed
                  <em>Connected</em>
                </div>

                <div className="soc-source">
                  <span />
                  Threat Intelligence
                  <em>Connected</em>
                </div>

                <div className="soc-source">
                  <span />
                  Alert Telemetry
                  <em>Connected</em>
                </div>
              </div>

              <div className="soc-profile">
                <div className="soc-avatar">
                  A
                </div>

                <div>
                  <strong>Analyst</strong>
                  <small>
                    Security Operations
                  </small>
                </div>

                <span className="soc-profile-dot" />
              </div>
            </div>
          </aside>

          {/* =================================================
              MAIN
          ================================================= */}

          <main className="soc-main">

            {/* TOP BAR */}

            <header className="soc-topbar">

              <div className="soc-breadcrumb">
                <span>
                  Security Operations
                </span>

                <i>/</i>

                <strong>
                  SOC 2 Compliance
                </strong>

                <div className="soc-live">
                  <span />

                  {overview?.generated_at
                    ? `Updated ${timeAgo(
                        overview.generated_at
                      )}`
                    : "Connecting…"}
                </div>
              </div>

              <div className="soc-top-actions">

                <div className="soc-range">
                  {RANGE_OPTIONS.map((r) => (
                    <button
                      key={r.key}
                      className={
                        range === r.key
                          ? "active"
                          : ""
                      }
                      onClick={() =>
                        setRange(r.key)
                      }
                    >
                      {r.label}
                    </button>
                  ))}
                </div>

                <button
                  className="soc-icon-btn"
                  title="Score trend"
                  onClick={() =>
                    jumpTo(
                      "trend",
                      trendSectionRef
                    )
                  }
                >
                  <IconTrend />
                </button>

                <button
                  className="soc-icon-btn"
                  title="Coverage"
                  onClick={() =>
                    jumpTo(
                      "coverage",
                      coverageSectionRef
                    )
                  }
                >
                  <IconCoverage />
                </button>

                <button
                  className="soc-icon-btn"
                  title="Findings"
                  onClick={() =>
                    jumpTo(
                      "findings",
                      findingsSectionRef
                    )
                  }
                >
                  <IconTable />
                </button>
              </div>
            </header>

            {/* PAGE HEADER */}

            <section className="soc-page-head">

              <div>
                <div className="soc-eyebrow">
                  COMPLIANCE COMMAND CENTER
                </div>

                <h1>
                  Security Posture Overview
                </h1>

                <p>
                  Real-time visibility across
                  Trust Service Criteria,
                  findings and alert activity.
                </p>
              </div>

              <div className="soc-health-badge">
                <span />
                SYSTEM OPERATIONAL
              </div>
            </section>

            {/* =================================================
                KPI ROW
            ================================================= */}

            <motion.section
              className="soc-kpi-grid"
              variants={staggerContainer()}
              initial="hidden"
              animate="show"
            >
              <StatWidget
                area=""
                icon={<IconShieldCheck />}
                label="Compliance score"
                value={
                  overview?.overall_score
                }
                suffix="%"
                tone="neutral"
                loaded={loaded}
              />

              <StatWidget
                area=""
                icon={
                  <IconAlertTriangle />
                }
                label="Open findings"
                value={findingsOpen}
                tone={
                  findingsOpen > 0
                    ? "bad"
                    : "good"
                }
                loaded={loaded}
              />

              <StatWidget
                area=""
                icon={<IconGlobe />}
                label="Threat origins"
                value={threatOrigins}
                tone="neutral"
                loaded={loaded}
              />

              <StatWidget
                area=""
                icon={<IconActivity />}
                label="Controls passing"
                value={
                  overview?.controls_passing
                }
                suffix={` / ${
                  overview?.controls_total ??
                  "--"
                }`}
                tone="good"
                loaded={loaded}
              />
            </motion.section>

            {/* =================================================
                BIG CENTER THREAT MAP
            ================================================= */}

            <section
              className="soc-threat-center-grid"
              ref={originsSectionRef}
            >
              <motion.div
                className="soc-panel soc-map-panel soc-map-center"
                variants={fadeUp}
              >

                <div className="soc-map-overlay">

                  <div>
                    <div className="soc-panel-kicker">
                      <span className="soc-kicker-dot red" />
                      THREAT TELEMETRY
                    </div>

                    <div className="soc-panel-title">
                      Incident origins
                    </div>

                    <div className="soc-panel-sub">
                      Geographic distribution
                      of observed activity
                    </div>
                  </div>

                  <div className="soc-map-live">
                    <span />
                    LIVE
                  </div>
                </div>

                <div className="soc-map-inner">
                  <ThreatMap />
                </div>

              </motion.div>
            </section>

            {/* =================================================
                COMPLIANCE TREND + CONTROL POSTURE
            ================================================= */}

            <section className="soc-primary-grid">

              <motion.div
                className="soc-panel soc-trend-panel"
                variants={fadeUp}
                ref={trendSectionRef}
              >
                <div className="soc-panel-head">

                  <div>
                    <div className="soc-panel-kicker">
                      <span className="soc-kicker-dot cyan" />
                      PERFORMANCE
                    </div>

                    <div className="soc-panel-title">
                      Compliance score trend
                    </div>

                    <div className="soc-panel-sub">
                      Daily compliance score
                      compared with alert volume
                    </div>
                  </div>

                  <div className="soc-legend">
                    <span>
                      <i className="cyan" />
                      Score
                    </span>

                    <span>
                      <i className="muted" />
                      Alerts
                    </span>
                  </div>

                </div>

                <div className="soc-chart-wrap">
                  <canvas
                    ref={trendChartRef}
                    role="img"
                    aria-label="Compliance score trend line chart"
                  />
                </div>

              </motion.div>

              <motion.div
                className="soc-panel soc-posture-panel"
                variants={fadeUp}
                ref={coverageSectionRef}
              >

                <div className="soc-panel-head">

                  <div>
                    <div className="soc-panel-kicker">
                      <span className="soc-kicker-dot green" />
                      CONTROL POSTURE
                    </div>

                    <div className="soc-panel-title">
                      Trust Service Criteria
                    </div>

                    <div className="soc-panel-sub">
                      {overview?.controls_passing ??
                        "--"}{" "}
                      /{" "}
                      {overview?.controls_total ??
                        "--"}{" "}
                      controls passing
                    </div>
                  </div>

                  <div className="soc-score-chip">
                    {loaded
                      ? `${overview?.overall_score ?? 0}%`
                      : "--"}
                  </div>

                </div>

                <CoverageBars
                  criteria={criteria}
                  loaded={loaded}
                />

              </motion.div>
            </section>

            {/* =================================================
                CRITERIA COVERAGE
            ================================================= */}

            <section className="soc-rings-strip">

              <motion.div
                className="soc-panel soc-rings-panel"
                variants={fadeUp}
              >

                <div className="soc-panel-head">

                  <div>
                    <div className="soc-panel-kicker">
                      <span className="soc-kicker-dot purple" />
                      TRUST FRAMEWORK
                    </div>

                    <div className="soc-panel-title">
                      Criteria coverage
                    </div>

                    <div className="soc-panel-sub">
                      Current posture by category
                    </div>
                  </div>

                </div>

                <ActivityRings
                  criteria={criteria}
                  loaded={loaded}
                />

              </motion.div>

            </section>

            {/* =================================================
                FINDINGS + ALERT HEATMAP
            ================================================= */}

            <section className="soc-lower-grid">

              <motion.div
                className="soc-panel soc-findings-panel"
                variants={fadeUp}
                ref={findingsSectionRef}
              >

                <div className="soc-panel-head">

                  <div>
                    <div className="soc-panel-kicker">
                      <span className="soc-kicker-dot orange" />
                      INVESTIGATIONS
                    </div>

                    <div className="soc-panel-title">
                      Audit findings
                    </div>

                    <div className="soc-panel-sub">
                      Most recent open findings
                      requiring attention
                    </div>
                  </div>

                  <button
                    className="soc-see-all"
                    onClick={() =>
                      onSeeFindings &&
                      onSeeFindings()
                    }
                  >
                    View all findings{" "}
                    <span>→</span>
                  </button>

                </div>

                <div className="soc-table-scroll">

                  <table className="soc-table">

                    <colgroup>
                      <col
                        style={{
                          width: "43%",
                        }}
                      />

                      <col
                        style={{
                          width: "23%",
                        }}
                      />

                      <col
                        style={{
                          width: "20%",
                        }}
                      />

                      <col
                        style={{
                          width: "14%",
                        }}
                      />
                    </colgroup>

                    <thead>
                      <tr>
                        <th>Finding</th>
                        <th>Source IP</th>
                        <th>Severity</th>
                        <th>Detected</th>
                      </tr>
                    </thead>

                    <tbody>

                      {findings.length === 0 && (
                        <tr>
                          <td
                            colSpan={4}
                            className="soc-empty"
                          >
                            {loaded
                              ? "No open findings"
                              : "Loading…"}
                          </td>
                        </tr>
                      )}

                      {findings.map(
                        (f, i) => (
                          <motion.tr
                            key={f.id}
                            initial={{
                              opacity: 0,
                              x: -4,
                            }}
                            animate={{
                              opacity: 1,
                              x: 0,
                            }}
                            transition={{
                              duration: 0.25,
                              delay:
                                Math.min(
                                  i,
                                  8
                                ) * 0.04,
                            }}
                          >
                            <td
                              className="soc-finding-name"
                              title={f.title}
                            >
                              {f.title}
                            </td>

                            <td className="soc-mono soc-ellipsis">
                              {f.src_ip ||
                                "--"}
                            </td>

                            <td>
                              <span
                                className={`soc-status soc-status-${f.severity}`}
                              >
                                <span />
                                {
                                  SEVERITY_LABEL[
                                    f.severity
                                  ] ||
                                    f.severity
                                }
                              </span>
                            </td>

                            <td className="soc-mono">
                              {findingsRelative(
                                f.detected_at
                              )}
                            </td>
                          </motion.tr>
                        )
                      )}

                    </tbody>
                  </table>

                </div>

              </motion.div>

              {/* ALERT HEATMAP */}

              <motion.div
                className="soc-panel soc-heat-panel"
                variants={fadeUp}
                ref={heatmapSectionRef}
              >

                <div className="soc-panel-head">

                  <div>
                    <div className="soc-panel-kicker">
                      <span className="soc-kicker-dot blue" />
                      ALERT TELEMETRY
                    </div>

                    <div className="soc-panel-title">
                      Alert activity
                    </div>

                    <div className="soc-panel-sub">
                      Volume by weekday and hour
                    </div>
                  </div>

                  <div className="soc-heat-total">
                    {heatmap.max || 0}
                    <small> peak</small>
                  </div>

                </div>

                <div className="soc-heat-wrap">

                  {WEEKDAYS.map(
                    (day, wd) => (
                      <div
                        key={day}
                        className="soc-heat-row"
                      >

                        <span>{day}</span>

                        {Array.from(
                          {
                            length: 24,
                          },
                          (_, hr) => {
                            const count =
                              heatGrid[
                                `${wd}-${hr}`
                              ] || 0;

                            const intensity =
                              heatmap.max
                                ? count /
                                  heatmap.max
                                : 0;

                            return (
                              <div
                                key={hr}
                                className="soc-heat-cell"
                                title={`${day} ${hr}:00 — ${count} alerts`}
                                style={{
                                  opacity:
                                    count ===
                                    0
                                      ? 0.18
                                      : 0.28 +
                                        intensity *
                                          0.72,
                                }}
                              />
                            );
                          }
                        )}

                      </div>
                    )
                  )}

                  <div className="soc-heat-hours">
                    <span>0h</span>
                    <span>6h</span>
                    <span>12h</span>
                    <span>18h</span>
                    <span>23h</span>
                  </div>

                </div>

              </motion.div>

            </section>

            {/* =================================================
                ASK SIRA
            ================================================= */}

            <motion.section
              className="soc-panel soc-ask-panel"
              variants={fadeUp}
              ref={askSectionRef}
            >

              <div className="soc-ask-icon">
                <IconBot />
              </div>

              <div className="soc-ask-copy">

                <div className="soc-panel-kicker">
                  <span className="soc-kicker-dot purple" />
                  AI ANALYST
                </div>

                <div className="soc-panel-title">
                  Ask SIRA
                </div>

                <div className="soc-panel-sub">
                  Get a plain-language assessment
                  of the current compliance posture
                  and open findings.
                </div>

              </div>

              <motion.button
                className="soc-ai-btn"
                onClick={() =>
                  onAskSira &&
                  onAskSira(
                    "Give me a summary of our current SOC 2 compliance posture and any open findings."
                  )
                }
                whileHover={{
                  y: -1,
                }}
                whileTap={{
                  scale: 0.98,
                }}
              >
                <IconSparkle />
                Run AI analysis
                <span>→</span>
              </motion.button>

            </motion.section>

          </main>
        </div>
      </div>
    );
  }
);

/* =========================================================
   STYLES
========================================================= */

const soc2Css = `
  .soc2-dashboard {
    min-height: 100%;
    background: #07101d;
    color: #e8eef7;
    font-family: var(--sans), Inter, system-ui, sans-serif;
  }

  .soc-shell {
    min-height: calc(100vh - 40px);
    display: grid;
    grid-template-columns: 226px minmax(0, 1fr);
    background: #07101d;
  }

  .soc-sidebar {
    position: sticky;
    top: 0;
    height: calc(100vh - 40px);
    display: flex;
    flex-direction: column;
    padding: 20px 12px 14px;
    box-sizing: border-box;
    background: #091523;
    border-right: 1px solid rgba(142,178,216,.12);
  }

  .soc-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 2px 10px 22px;
    border-bottom: 1px solid rgba(142,178,216,.1);
  }

  .soc-brand-mark {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(77,216,232,.38);
    border-radius: 10px;
    color: #4dd8e8;
    background: rgba(77,216,232,.07);
    box-shadow: 0 0 22px rgba(77,216,232,.08);
  }

  .soc-brand-mark svg {
    width: 19px;
    height: 19px;
  }

  .soc-brand-name {
    font-size: 15px;
    font-weight: 750;
    letter-spacing: .2px;
  }

  .soc-brand-sub {
    margin-top: 2px;
    font-size: 9.5px;
    color: #718198;
    text-transform: uppercase;
    letter-spacing: .9px;
  }

  .soc-nav-section {
    padding: 20px 4px 0;
  }

  .soc-nav-label {
    padding: 0 9px 8px;
    color: #56677d;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.1px;
  }

  .soc-nav-item {
    width: 100%;
    height: 36px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px;
    margin: 2px 0;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    color: #8797ab;
    font-size: 11.5px;
    text-align: left;
    cursor: pointer;
    transition: .16s ease;
  }

  .soc-nav-item svg {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
  }

  .soc-nav-item:hover {
    color: #e9f0f8;
    background: rgba(255,255,255,.035);
  }

  .soc-nav-item.active {
    color: #59d9ee;
    background:
      linear-gradient(
        90deg,
        rgba(77,216,232,.13),
        rgba(77,216,232,.035)
      );
    border-color: rgba(77,216,232,.1);
    box-shadow: inset 2px 0 #4dd8e8;
  }

  .soc-nav-item b {
    margin-left: auto;
    min-width: 19px;
    height: 18px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: #d9494d;
    color: #fff;
    font-size: 9px;
  }

  .soc-sidebar-bottom {
    margin-top: auto;
  }

  .soc-source-card {
    margin: 12px 4px;
    border: 1px solid rgba(142,178,216,.1);
    border-radius: 8px;
    padding: 11px 9px;
    background: #0b1929;
  }

  .soc-source {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 0;
    color: #8191a5;
    font-size: 9.5px;
  }

  .soc-source span,
  .soc-live span,
  .soc-profile-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #25d58a;
    box-shadow: 0 0 7px rgba(37,213,138,.55);
    flex-shrink: 0;
  }

  .soc-source em {
    margin-left: auto;
    color: #35c994;
    font-size: 8.5px;
    font-style: normal;
  }

  .soc-profile {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 10px 8px;
    border-top: 1px solid rgba(142,178,216,.1);
  }

  .soc-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: #17334d;
    border: 1px solid rgba(77,216,232,.2);
    color: #bcecf3;
    font-size: 11px;
    font-weight: 700;
  }

  .soc-profile strong {
    display: block;
    font-size: 10.5px;
    color: #dce5ef;
  }

  .soc-profile small {
    display: block;
    margin-top: 2px;
    color: #5f7187;
    font-size: 8.5px;
  }

  .soc-profile-dot {
    margin-left: auto;
  }

  .soc-main {
    min-width: 0;
    padding: 0 22px 28px;
    overflow: hidden;
  }

  .soc-topbar {
    min-height: 62px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(142,178,216,.1);
    gap: 14px;
  }

  .soc-breadcrumb {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #617288;
    font-size: 10.5px;
    white-space: nowrap;
  }

  .soc-breadcrumb i {
    color: #304258;
    font-style: normal;
  }

  .soc-breadcrumb strong {
    color: #b5c1cf;
    font-weight: 600;
  }

  .soc-live {
    margin-left: 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #4bcf9b;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: .3px;
  }

  .soc-top-actions {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .soc-range {
    display: flex;
    gap: 1px;
    padding: 3px;
    border: 1px solid rgba(142,178,216,.12);
    background: #0b1726;
    border-radius: 6px;
  }

  .soc-range button {
    border: 0;
    background: transparent;
    color: #718198;
    font-size: 9.5px;
    padding: 5px 9px;
    border-radius: 4px;
    cursor: pointer;
  }

  .soc-range button.active {
    color: #e7f3fb;
    background: #173247;
    box-shadow:
      inset 0 0 0 1px
      rgba(77,216,232,.15);
  }

  .soc-icon-btn {
    width: 29px;
    height: 29px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(142,178,216,.12);
    border-radius: 6px;
    background: #0b1726;
    color: #7e8ea2;
    cursor: pointer;
  }

  .soc-icon-btn:hover {
    color: #4dd8e8;
    border-color: rgba(77,216,232,.25);
  }

  .soc-page-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding: 24px 2px 18px;
    gap: 20px;
  }

  .soc-eyebrow,
  .soc-panel-kicker {
    color: #58708a;
    font-size: 8.5px;
    font-weight: 750;
    letter-spacing: 1.15px;
  }

  .soc-page-head h1 {
    margin: 5px 0 4px;
    font-size: 22px;
    line-height: 1.15;
    letter-spacing: -.45px;
    font-weight: 700;
    color: #edf3f8;
  }

  .soc-page-head p {
    margin: 0;
    color: #6f8196;
    font-size: 10.5px;
  }

  .soc-health-badge,
  .soc-map-live {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 10px;
    border: 1px solid rgba(37,213,138,.18);
    background: rgba(37,213,138,.045);
    border-radius: 5px;
    color: #43d09b;
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: .7px;
  }

  .soc-health-badge span,
  .soc-map-live span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #28d792;
    box-shadow:
      0 0 8px rgba(40,215,146,.6);
  }

  /* ========================================================
     KPI GRID
  ======================================================== */

  .soc-kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin-bottom: 10px;
  }

  .soc-kpi-grid > .mac-stat {
    min-height: 104px;
  }

  .mac-card {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
  }

  .mac-stat {
    position: relative;
    padding: 14px 15px !important;
    background: #0b1726 !important;
    border: 1px solid rgba(142,178,216,.11) !important;
    border-radius: 8px !important;
    box-shadow: none !important;
    overflow: hidden;
  }

  .mac-stat:after {
    content: "";
    position: absolute;
    right: -30px;
    top: -35px;
    width: 95px;
    height: 95px;
    border-radius: 50%;
    background:
      radial-gradient(
        circle,
        rgba(77,216,232,.09),
        transparent 68%
      );
    pointer-events: none;
  }

  .mac-stat-icon {
    width: 24px !important;
    height: 24px !important;
    color: #4dd8e8 !important;
  }

  .mac-stat-value {
    margin-top: 11px !important;
    font-size: 24px !important;
    font-weight: 720 !important;
    letter-spacing: -.7px !important;
    color: #edf3f8 !important;
  }

  .mac-stat-label {
    margin-top: 4px !important;
    font-size: 9.5px !important;
    color: #687b91 !important;
    text-transform: uppercase;
    letter-spacing: .5px;
  }

  /* ========================================================
     PRIMARY GRID
  ======================================================== */

  .soc-primary-grid {
    display: grid;
    grid-template-columns:
      minmax(0, 2fr)
      minmax(300px, 1fr);
    gap: 10px;
    margin-bottom: 10px;
  }

  .soc-panel {
    background: #0b1726;
    border: 1px solid rgba(142,178,216,.11);
    border-radius: 8px;
    box-sizing: border-box;
    overflow: hidden;
  }

  .soc-trend-panel,
  .soc-posture-panel {
    min-height: 284px;
    padding: 16px;
    display: flex;
    flex-direction: column;
  }

  .soc-panel-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 15px;
  }

  .soc-panel-title {
    margin-top: 5px;
    color: #e4ebf3;
    font-size: 13px;
    font-weight: 650;
    letter-spacing: -.12px;
  }

  .soc-panel-sub {
    margin-top: 3px;
    color: #64768c;
    font-size: 9.5px;
    line-height: 1.45;
  }

  .soc-kicker-dot {
    display: inline-block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    margin-right: 6px;
    vertical-align: 1px;
  }

  .soc-kicker-dot.cyan {
    background: #4dd8e8;
    box-shadow:
      0 0 7px rgba(77,216,232,.5);
  }

  .soc-kicker-dot.green {
    background: #28d792;
  }

  .soc-kicker-dot.red {
    background: #ed5a5a;
  }

  .soc-kicker-dot.orange {
    background: #f1a54d;
  }

  .soc-kicker-dot.blue {
    background: #4d8fe8;
  }

  .soc-kicker-dot.purple {
    background: #a06cff;
  }

  .soc-legend {
    display: flex;
    gap: 12px;
    padding-top: 3px;
    color: #63748a;
    font-size: 9px;
  }

  .soc-legend span {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .soc-legend i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    display: block;
  }

  .soc-legend i.cyan {
    background: #4dd8e8;
  }

  .soc-legend i.muted {
    background: #586678;
  }

  .soc-chart-wrap {
    position: relative;
    flex: 1;
    min-height: 190px;
    margin-top: 8px;
  }

  .soc-score-chip {
    padding: 6px 9px;
    border: 1px solid rgba(77,216,232,.16);
    border-radius: 5px;
    color: #54dced;
    background: rgba(77,216,232,.045);
    font-size: 11px;
    font-weight: 700;
  }

  /* ========================================================
     LARGE CENTER THREAT MAP
     
     This is the main structural change.
     ThreatMap now occupies the full content width and
     becomes the dominant center panel.
  ======================================================== */

  .soc-threat-center-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    margin-bottom: 10px;
  }

  .soc-map-panel {
    height: 430px;
    position: relative;
    background: #081321;
  }

  .soc-map-center {
    width: 100%;
    min-height: 430px;
  }

  .soc-map-inner {
    position: absolute;
    inset: 0;
  }

  .soc-map-overlay {
    position: absolute;
    z-index: 5;
    top: 15px;
    left: 16px;
    right: 16px;
    display: flex;
    justify-content: space-between;
    pointer-events: none;
  }

  .soc-map-live {
    pointer-events: none;
    padding: 5px 8px;
    font-size: 7.5px;
  }

  /* ========================================================
     CRITERIA COVERAGE
  ======================================================== */

  .soc-rings-strip {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    margin-bottom: 10px;
  }

  .soc-rings-panel {
    height: 190px;
    padding: 16px;
    display: flex;
    flex-direction: column;
  }

  .soc-rings-panel > div:last-child {
    margin-top: 5px;
  }

  /* ========================================================
     LOWER GRID
  ======================================================== */

  .soc-lower-grid {
    display: grid;
    grid-template-columns:
      minmax(0, 1.55fr)
      minmax(300px, 1fr);
    gap: 10px;
    margin-bottom: 10px;
  }

  .soc-findings-panel,
  .soc-heat-panel {
    min-height: 274px;
    padding: 16px;
    display: flex;
    flex-direction: column;
  }

  .soc-see-all {
    border: 0;
    background: transparent;
    color: #4dd8e8;
    font-size: 9.5px;
    cursor: pointer;
    padding: 4px 0;
  }

  .soc-see-all span {
    font-size: 12px;
    margin-left: 4px;
  }

  .soc-table-scroll {
    overflow: auto;
    margin-top: 12px;
    flex: 1;
  }

  .soc-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 10.5px;
  }

  .soc-table th {
    text-align: left;
    color: #566a81;
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: .6px;
    font-weight: 650;
    padding: 7px 8px;
    border-bottom: 1px solid rgba(142,178,216,.1);
  }

  .soc-table td {
    padding: 9px 8px;
    border-bottom: 1px solid rgba(142,178,216,.07);
    color: #91a1b3;
  }

  .soc-table tr:last-child td {
    border-bottom: 0;
  }

  .soc-finding-name {
    color: #c8d2de !important;
    font-weight: 520;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .soc-mono {
    font-family: var(--mono);
    font-size: 9.5px;
    color: #71859b !important;
  }

  .soc-ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .soc-empty {
    text-align: center;
    color: #607389 !important;
    padding: 30px !important;
  }

  .soc-status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 8.5px;
    font-weight: 650;
  }

  .soc-status > span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }

  .soc-status-critical {
    color: #ed5a5a;
    background: rgba(237,90,90,.08);
  }

  .soc-status-elevated {
    color: #f1a54d;
    background: rgba(241,165,77,.08);
  }

  .soc-status-informational {
    color: #35cf91;
    background: rgba(53,207,145,.08);
  }

  /* ========================================================
     ALERT HEATMAP
  ======================================================== */

  .soc-heat-wrap {
    margin-top: 20px;
  }

  .soc-heat-row {
    display: grid;
    grid-template-columns:
      28px repeat(
        24,
        minmax(3px, 1fr)
      );
    gap: 2px;
    align-items: center;
    margin-bottom: 4px;
  }

  .soc-heat-row > span {
    color: #61748b;
    font-size: 8.5px;
  }

  .soc-heat-cell {
    height: 13px;
    border-radius: 2px;
    background: #42d7ea;
    box-shadow:
      inset 0 0 0 1px
      rgba(255,255,255,.025);
  }

  .soc-heat-hours {
    display: grid;
    grid-template-columns:
      28px repeat(4, 1fr);
    margin-top: 6px;
    color: #4f6278;
    font-size: 8px;
  }

  .soc-heat-hours span {
    text-align: center;
  }

  .soc-heat-hours span:first-child {
    text-align: left;
  }

  .soc-heat-hours span:last-child {
    text-align: right;
  }

  .soc-heat-total {
    color: #8ea1b7;
    font-family: var(--mono);
    font-size: 10px;
  }

  .soc-heat-total small {
    color: #50637a;
    font-family: var(--sans);
    font-size: 8px;
  }

  /* ========================================================
     ASK SIRA
  ======================================================== */

  .soc-ask-panel {
    min-height: 88px;
    padding: 14px 16px;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 13px;
    background:
      linear-gradient(
        90deg,
        #0b1726,
        #0c1a2a
      ) !important;
  }

  .soc-ask-icon {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: 7px;
    color: #a06cff;
    background: rgba(160,108,255,.08);
    border: 1px solid rgba(160,108,255,.16);
    flex-shrink: 0;
  }

  .soc-ask-copy {
    flex: 1;
  }

  .soc-ai-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 1px solid rgba(77,216,232,.2);
    background: #102c3d;
    color: #65dced;
    border-radius: 5px;
    padding: 8px 11px;
    font-size: 9.5px;
    font-weight: 650;
    cursor: pointer;
  }

  .soc-ai-btn span {
    font-size: 12px;
  }

  .soc-ai-btn:hover {
    background: #14364a;
  }

  /* ========================================================
     SHARED MACOS WIDGET ELEMENTS
  ======================================================== */

  .mac-ring-label {
    font-size: 9.5px !important;
    color: #788ba0 !important;
  }

  .mac-ring-score {
    font-size: 9.5px !important;
  }

  .mac-bar-label {
    font-size: 9.5px !important;
    color: #8293a7 !important;
  }

  .mac-bar-value {
    font-size: 8.5px !important;
  }

  .mac-bar-track {
    height: 5px !important;
    background: rgba(255,255,255,.055) !important;
  }

  .mac-bar-fill {
    box-shadow:
      0 0 8px
      rgba(77,216,232,.16);
  }

  /* ========================================================
     RESPONSIVE
  ======================================================== */

  @media (max-width: 1180px) {

    .soc-shell {
      grid-template-columns:
        190px minmax(0, 1fr);
    }

    .soc-primary-grid,
    .soc-threat-center-grid,
    .soc-rings-strip,
    .soc-lower-grid {
      grid-template-columns: 1fr;
    }

    .soc-map-panel,
    .soc-map-center {
      height: 360px;
      min-height: 360px;
    }

    .soc-kpi-grid {
      grid-template-columns:
        repeat(2, 1fr);
    }
  }

  @media (max-width: 760px) {

    .soc-shell {
      display: block;
    }

    .soc-sidebar {
      position: relative;
      height: auto;
      border-right: 0;
      border-bottom:
        1px solid
        rgba(142,178,216,.1);
    }

    .soc-nav-section,
    .soc-sidebar-bottom {
      display: none;
    }

    .soc-main {
      padding: 0 12px 20px;
    }

    .soc-topbar {
      align-items: flex-start;
      padding: 12px 0;
      flex-direction: column;
    }

    .soc-page-head {
      align-items: flex-start;
      flex-direction: column;
    }

    .soc-kpi-grid {
      grid-template-columns:
        1fr 1fr;
    }

    .soc-ask-panel {
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .soc-ai-btn {
      margin-left: 47px;
    }

    .soc-map-panel,
    .soc-map-center,
    .soc-rings-panel {
      height: auto;
      min-height: 300px;
    }
  }

  @media (max-width: 480px) {

    .soc-kpi-grid {
      grid-template-columns: 1fr;
    }

    .soc-range button {
      padding: 5px 7px;
    }

    .soc-breadcrumb {
      font-size: 9px;
    }

    .soc-health-badge {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {

    .soc2-dashboard * {
      animation-duration: .001ms !important;
      transition-duration: .001ms !important;
    }
  }
`;

export default Soc2Dashboard;