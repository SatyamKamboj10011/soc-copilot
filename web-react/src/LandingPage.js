import { useRef, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  motion,
  useScroll,
  useTransform,
  useMotionValue,
  useMotionTemplate,
} from "framer-motion";

const fadeUp = {
  hidden: { opacity: 0, y: 26, scale: 0.98, filter: "blur(8px)" },
  show: (delay = 0) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] },
  }),
};

const CAPABILITIES = [
  {
    title: "Live Traffic Analysis",
    body: "Ingests real Suricata and Zeek output, not sample data, so every alert traces back to an actual packet.",
  },
  {
    title: "Autonomous Triage",
    body: "Alerts are scored and sorted before an analyst even opens the queue.",
  },
  {
    title: "Hermes Investigation",
    body: "An AI agent walks through each incident step by step, and shows the reasoning behind every conclusion.",
  },
  {
    title: "Case Management",
    body: "Every investigation becomes a case file — alerts, evidence, and Hermes's findings in one place.",
  },
  {
    title: "Network Map",
    body: "See where an alert sits in your topology at a glance, not just its IP address.",
  },
  {
    title: "Threat Summary",
    body: "A live rollup of what's active right now, ranked by what actually needs eyes on it.",
  },
];

const PIPELINE = [
  {
    n: "01",
    title: "Capture",
    body: "Suricata and Zeek watch the wire and log everything that looks worth a second glance.",
  },
  {
    n: "02",
    title: "Index",
    body: "Alerts and context are embedded into a local vector store so Hermes can reason over real history.",
  },
  {
    n: "03",
    title: "Investigate",
    body: "Hermes pulls related evidence, cross-references it, and builds a case — reasoning shown at every step.",
  },
  {
    n: "04",
    title: "Review",
    body: "The analyst gets a finished case file, not a black box, and can override the verdict any time.",
  },
];

const HERMES_LOG = [
  { t: "analyzing alert #4471 — suspicious outbound TLS", c: "#B7C4D1" },
  { t: "checking source host history... 3 prior alerts, none critical", c: "#B7C4D1" },
  { t: "cross-referencing destination IP against known indicators... no match", c: "#B7C4D1" },
  { t: "reviewing connection timing... matches beaconing pattern (14s interval)", c: "#22D97A" },
  { t: "verdict: ESCALATE — beaconing behavior outweighs clean IP reputation", c: "#29D3FF" },
];

const STACK = ["Suricata", "Zeek", "ChromaDB", "Groq", "Gemini", "Ollama", "React", "Flask"];

const TEAM = [
  {
    initials: "SK",
    name: "Satyam Kamboj",
    role: "Backend, AI & Deployment",
    body: "Builds the ingestion pipeline, the RAG/Hermes reasoning layer, and ships it.",
    photo: "/team/satyam.jpg", // place the file at web-react/public/team/satyam.jpg
  },
  {
    initials: "P",
    name: "Pratham",
    role: "Frontend, UX & Documentation",
    body: "Designs and builds the dashboard, case views, and keeps the docs honest.",
    photo: "/team/pratham.jpg", // place the file at web-react/public/team/pratham.jpg
  },
];

// full 3D card flip: 0deg (front/name) <-> 180deg (back/photo)
const flipInnerVariants = {
  rest: { rotateY: 0 },
  hover: { rotateY: 180 },
};
const flipTransition = { duration: 0.65, ease: [0.65, 0, 0.35, 1] };

// staggered reveal for grids of cards
const gridContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09 } },
};
const gridItem = {
  hidden: { opacity: 0, y: 22, scale: 0.97, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
  },
};

// tracks viewport width so the scroll-scrubbed pipeline only runs on desktop,
// where there's room to pin it — a tall sticky section on mobile just feels broken
function useIsDesktop(breakpoint = 900) {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= breakpoint : true
  );
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return isDesktop;
}

function PipelineStep({ step, index, total, progress }) {
  const start = index / total;
  const peak = (index + 0.5) / total;
  const end = (index + 1) / total;
  const opacity = useTransform(progress, [start, peak, end], [0.3, 1, 0.3]);
  const scale = useTransform(progress, [start, peak, end], [0.94, 1, 0.94]);
  const y = useTransform(progress, [start, peak, end], [16, 0, -16]);
  const borderColor = useTransform(progress, [start, peak, end], ["#12314A", "#29D3FF", "#12314A"]);
  const numColor = useTransform(progress, [start, peak, end], ["#4C6478", "#8B7CFF", "#4C6478"]);

  return (
    <motion.div className="lp-pipe-step corner-frame" style={{ opacity, scale, y, borderColor }}>
      <motion.div className="lp-pipe-num" style={{ color: numColor }}>
        STAGE {step.n}
      </motion.div>
      <h3>{step.title}</h3>
      <p>{step.body}</p>
    </motion.div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const goEnter = () => navigate("/login");
  const isDesktop = useIsDesktop();

  const videoRef = useRef(null);
  const [videoOpacity, setVideoOpacity] = useState(1);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const onTimeUpdate = () => {
      const remaining = vid.duration - vid.currentTime;
      if (remaining < 0.35) {
        setVideoOpacity(Math.max(0, remaining / 0.35));
      } else if (vid.currentTime < 0.35) {
        setVideoOpacity(Math.min(1, vid.currentTime / 0.35));
      } else {
        setVideoOpacity(1);
      }
    };
    vid.addEventListener("timeupdate", onTimeUpdate);
    return () => vid.removeEventListener("timeupdate", onTimeUpdate);
  }, []);

  // whole-page scroll progress, drives the top progress bar + nav chrome
  const { scrollY, scrollYProgress } = useScroll();
  const navBg = useTransform(scrollY, [0, 140], ["rgba(6,10,17,0)", "rgba(6,10,17,0.86)"]);
  const navBlur = useTransform(scrollY, [0, 140], ["blur(0px)", "blur(14px)"]);
  const navBorder = useTransform(scrollY, [0, 140], ["rgba(18,49,74,0)", "rgba(18,49,74,0.6)"]);

  // hero parallax — video pushes in and darkens, copy drifts up and fades as you leave it
  const heroRef = useRef(null);
  const { scrollYProgress: heroProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroVideoScale = useTransform(heroProgress, [0, 1], [1, 1.16]);
  const heroContentY = useTransform(heroProgress, [0, 1], [0, 90]);
  const heroContentOpacity = useTransform(heroProgress, [0, 0.75], [1, 0]);
  const heroCueOpacity = useTransform(heroProgress, [0, 0.15], [1, 0]);

  // cursor-follow spotlight in the hero
  const spotX = useMotionValue(50);
  const spotY = useMotionValue(50);
  const spotlightBg = useMotionTemplate`radial-gradient(560px circle at ${spotX}% ${spotY}%, rgba(41,211,255,0.10), transparent 65%)`;
  const handleHeroMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    spotX.set(((e.clientX - rect.left) / rect.width) * 100);
    spotY.set(((e.clientY - rect.top) / rect.height) * 100);
  };

  // pipeline scroll-scrub
  const pipelineWrapRef = useRef(null);
  const { scrollYProgress: pipelineProgress } = useScroll({
    target: pipelineWrapRef,
    offset: ["start start", "end end"],
  });

  return (
    <div className="lp-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .lp-root { position:relative; min-height:100vh; background:#060A11; color:#E9F1F7;
          font-family:'Inter',sans-serif; display:flex; flex-direction:column; }

        .lp-progress { position:fixed; top:0; left:0; right:0; height:2.5px; z-index:40; transform-origin:0%;
          background:linear-gradient(90deg,#29D3FF,#8B7CFF); box-shadow:0 0 12px rgba(41,211,255,0.6); }

        .lp-video-wrap { position:fixed; inset:0; width:100%; height:100%; z-index:0; overflow:hidden; }
        .lp-video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
        .lp-scanline { position:absolute; left:0; right:0; height:140px; pointer-events:none;
          background:linear-gradient(180deg, rgba(41,211,255,0) 0%, rgba(41,211,255,0.06) 50%, rgba(41,211,255,0) 100%);
          animation:lp-scan 9s linear infinite; }
        @keyframes lp-scan { 0%{ top:-140px } 100%{ top:100% } }
        .lp-overlay { position:fixed; inset:0; z-index:1;
          background:
            linear-gradient(90deg, rgba(6,10,17,0.92) 0%, rgba(6,10,17,0.6) 42%, rgba(6,10,17,0.18) 68%, rgba(6,10,17,0.05) 100%),
            linear-gradient(180deg, rgba(6,10,17,0.15) 0%, rgba(6,10,17,0.1) 55%, rgba(6,10,17,0.85) 100%);
        }
        .lp-spotlight { position:absolute; inset:0; z-index:1; pointer-events:none; }

        .lp-nav { position:fixed; top:0; left:0; right:0; z-index:10; display:flex; align-items:center;
          justify-content:space-between; padding:20px clamp(20px, 5vw, 64px); border-bottom:1px solid transparent; }
        .lp-logo { display:flex; align-items:center; gap:10px; font-family:'Space Grotesk',sans-serif;
          font-weight:700; font-size:16px; letter-spacing:1px; color:#E9F1F7; }
        .lp-logo-mark { width:30px; height:30px; background:rgba(10,18,28,0.6); border:1.5px solid #29D3FF;
          clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
          display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .lp-login-btn { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.1em; color:#29D3FF;
          border:1px solid #12314A; border-radius:4px; padding:10px 22px; background:rgba(6,10,17,0.4);
          cursor:pointer; transition:all .2s; }
        .lp-login-btn:hover { border-color:#29D3FF; background:rgba(41,211,255,0.1); }

        .lp-hero { position:relative; z-index:2; flex:1; display:flex; align-items:center;
          padding:130px clamp(20px, 5vw, 64px) 60px; min-height:100vh; }
        .lp-hero-inner { max-width:620px; width:100%; }

        .lp-eyebrow { font-family:'IBM Plex Mono',monospace; font-size:12px; letter-spacing:.2em; color:#22D97A;
          text-transform:uppercase; margin-bottom:22px; display:flex; align-items:center; gap:8px; }
        .lp-eyebrow::before { content:''; width:6px; height:6px; border-radius:50%; background:#22D97A;
          box-shadow:0 0 8px #22D97A; animation:lp-pulse 2s infinite; flex-shrink:0; }
        @keyframes lp-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

        .lp-title { font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:clamp(32px, 5vw, 54px);
          line-height:1.12; letter-spacing:-.01em; margin:0 0 22px; }
        .lp-accent { color:#29D3FF; }

        .lp-desc { font-size:16px; color:#B7C4D1; line-height:1.75; max-width:520px; margin:0 0 38px; }

        .lp-cta-row { display:flex; align-items:center; gap:20px; flex-wrap:wrap; }
        .lp-enter-btn { position:relative; overflow:hidden; font-family:'IBM Plex Mono',monospace; font-size:13px;
          letter-spacing:.14em; color:#060A11; background:#29D3FF; border:none; border-radius:4px; padding:16px 32px;
          cursor:pointer; display:inline-flex; align-items:center; gap:10px; transition:all .2s;
          box-shadow:0 0 30px -6px rgba(41,211,255,0.5); }
        .lp-enter-btn:hover { background:#5CE0FF; }
        .lp-enter-btn::after { content:''; position:absolute; top:0; bottom:0; left:-60%; width:40%;
          background:linear-gradient(115deg, transparent, rgba(255,255,255,0.45), transparent);
          transform:skewX(-20deg); transition:left .5s ease; }
        .lp-enter-btn:hover::after { left:130%; }

        .lp-meta { font-family:'IBM Plex Mono',monospace; font-size:11px; color:#4C6478; letter-spacing:.04em;
          line-height:1.5; max-width:220px; }

        .lp-scroll-cue { position:absolute; left:50%; bottom:36px; transform:translateX(-50%);
          display:flex; flex-direction:column; align-items:center; gap:8px; z-index:2; }
        .lp-scroll-cue span { font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:.2em;
          color:#4C6478; text-transform:uppercase; }

        /* ---------- shared corner-bracket framing (signature element, reused site-wide) ---------- */
        .corner-frame { position:relative; }
        .corner-frame::before, .corner-frame::after { content:''; position:absolute; width:14px; height:14px;
          border-color:#29D3FF; border-style:solid; opacity:.75; pointer-events:none; }
        .corner-frame::before { top:-1px; left:-1px; border-width:1.5px 0 0 1.5px; }
        .corner-frame::after { bottom:-1px; right:-1px; border-width:0 1.5px 1.5px 0; }

        /* ---------- below-the-fold wrapper: solid bg so scrolled content sits above the fixed video ---------- */
        .lp-below { position:relative; z-index:2; background:#060A11; border-top:1px solid rgba(18,49,74,0.5); }
        .lp-section { padding:88px clamp(20px, 5vw, 64px); border-bottom:1px solid rgba(18,49,74,0.35); }
        .lp-section-head { max-width:640px; margin:0 0 52px; }
        .lp-section-title { font-family:'Space Grotesk',sans-serif; font-weight:600;
          font-size:clamp(24px, 3.4vw, 34px); line-height:1.2; margin:14px 0 0; letter-spacing:-.01em; }

        /* ---------- capabilities grid ---------- */
        .lp-cap-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:1px; background:rgba(18,49,74,0.5); }
        .lp-cap-card { background:#060A11; padding:30px 26px; }
        .lp-cap-card h3 { font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:16px;
          color:#E9F1F7; margin:0 0 10px; }
        .lp-cap-card p { font-size:14px; color:#8FA2B4; line-height:1.65; margin:0; }

        /* ---------- pipeline (scroll-scrubbed on desktop) ---------- */
        .lp-pipeline { display:grid; grid-template-columns:repeat(4, 1fr); gap:22px; }
        .lp-pipe-step { padding:24px 20px; border:1px solid #12314A; border-radius:4px; background:rgba(10,18,28,0.4); }
        .lp-pipe-num { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.1em; color:#8B7CFF; }
        .lp-pipe-step h3 { font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:16px;
          margin:10px 0 8px; color:#E9F1F7; }
        .lp-pipe-step p { font-size:13px; color:#8FA2B4; line-height:1.6; margin:0; }

        .lp-pipeline-outer { position:relative; height:340vh; border-bottom:1px solid rgba(18,49,74,0.35); }
        .lp-pipeline-sticky { position:sticky; top:0; height:100vh; display:flex; flex-direction:column;
          justify-content:center; padding:0 clamp(20px, 5vw, 64px); }
        .lp-pipe-track { position:relative; height:2px; margin-top:40px; border-radius:2px; overflow:hidden;
          background:rgba(18,49,74,0.5); }
        .lp-pipe-track-fill { position:absolute; inset:0; transform-origin:0%;
          background:linear-gradient(90deg,#29D3FF,#8B7CFF); }

        /* ---------- hermes spotlight ---------- */
        .lp-hermes-wrap { display:grid; grid-template-columns:1fr 1.3fr; gap:48px; align-items:center; }
        .lp-hermes-copy p { font-size:15px; color:#B7C4D1; line-height:1.75; margin:0 0 0; max-width:420px; }
        .lp-terminal { border:1px solid #12314A; border-radius:6px; background:rgba(8,14,22,0.85);
          padding:22px 22px 22px 20px; border-left:2px solid #29D3FF; overflow:hidden; }
        .lp-terminal-head { display:flex; gap:6px; margin-bottom:16px; }
        .lp-terminal-dot { width:8px; height:8px; border-radius:50%; background:#22314A; }
        .lp-terminal-line { font-family:'IBM Plex Mono',monospace; font-size:12.5px; line-height:2;
          white-space:pre-wrap; word-break:break-word; }
        .lp-terminal-caret { display:inline-block; width:7px; height:13px; background:#29D3FF; margin-left:2px;
          animation:lp-pulse 1s steps(2) infinite; vertical-align:middle; }

        /* ---------- stats strip ---------- */
        .lp-stats { display:grid; grid-template-columns:repeat(3, 1fr); }
        .lp-stat { padding:0 24px; border-left:1px solid rgba(18,49,74,0.6); position:relative; }
        .lp-stat:first-child { border-left:none; padding-left:0; }
        .lp-stat-rail { position:absolute; top:0; left:-1px; width:2px; height:100%;
          background:linear-gradient(180deg,#29D3FF,#8B7CFF); transform-origin:top; }
        .lp-stat-label { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.12em;
          color:#22D97A; text-transform:uppercase; margin-bottom:8px; }
        .lp-stat-body { font-size:14px; color:#B7C4D1; line-height:1.6; }

        /* ---------- tech stack strip ---------- */
        .lp-stack-row { display:flex; flex-wrap:wrap; gap:0; align-items:center;
          font-family:'IBM Plex Mono',monospace; font-size:13px; letter-spacing:.06em; color:#8FA2B4; }
        .lp-stack-item { padding:6px 18px; border-right:1px solid rgba(18,49,74,0.6); }
        .lp-stack-item:last-child { border-right:none; }

        /* ---------- team: 3D flip cards (front = name, back = photo) ---------- */
        .lp-team-grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:24px; }
        .lp-flip-card { position:relative; height:280px; border-radius:6px; cursor:pointer; }
        .lp-flip-inner { position:relative; width:100%; height:100%; transform-style:preserve-3d; }
        .lp-flip-face { position:absolute; inset:0; padding:28px; display:flex; flex-direction:column;
          border:1px solid #12314A; border-radius:6px; background:rgba(10,18,28,0.4);
          backface-visibility:hidden; -webkit-backface-visibility:hidden; overflow:hidden; }

        .lp-flip-face-name { justify-content:center; }
        .lp-avatar-mini { width:52px; height:52px; background:rgba(10,18,28,0.7); border:1.5px solid #29D3FF;
          clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
          display:flex; align-items:center; justify-content:center;
          font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:15px; color:#29D3FF; margin-bottom:18px; }
        .lp-flip-face-name h3 { font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:19px;
          margin:0 0 4px; color:#E9F1F7; }
        .lp-flip-face-name p { font-size:13.5px; color:#8FA2B4; line-height:1.6; margin:12px 0 0; max-width:280px; }
        .lp-flip-hint { font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:.12em;
          color:#4C6478; margin-top:20px; }

        .lp-flip-face-image { justify-content:flex-end; transform:rotateY(180deg); padding:0; }
        .lp-flip-face-image img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
          object-position:center 15%; }
        .lp-flip-face-image::after { content:''; position:absolute; inset:0;
          background:linear-gradient(180deg, rgba(6,10,17,0) 45%, rgba(6,10,17,0.55) 75%, rgba(6,10,17,0.9) 100%); }
        .lp-photo-placeholder { position:absolute; inset:0; display:flex; flex-direction:column;
          align-items:center; justify-content:center; gap:10px;
          background:linear-gradient(160deg, rgba(41,211,255,0.10), rgba(139,124,255,0.07)); }
        .lp-photo-placeholder svg { opacity:.55; }
        .lp-photo-placeholder span { font-family:'IBM Plex Mono',monospace; font-size:10px;
          letter-spacing:.12em; color:#4C6478; }
        .lp-flip-caption { position:relative; z-index:1; padding:22px; }
        .lp-flip-caption h3 { font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:17px;
          margin:0 0 2px; color:#E9F1F7; }
        .lp-team-role { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.06em;
          color:#8B7CFF; margin-bottom:10px; }

        /* ---------- closing CTA ---------- */
        .lp-close-cta { position:relative; text-align:center; padding:100px clamp(20px, 5vw, 64px); border-bottom:none; }
        .lp-close-glow { position:absolute; left:50%; top:50%; width:520px; height:280px;
          transform:translate(-50%,-50%); background:radial-gradient(circle, rgba(41,211,255,0.14), transparent 70%);
          pointer-events:none; animation:lp-glow-pulse 4s ease-in-out infinite; }
        @keyframes lp-glow-pulse { 0%,100%{ opacity:.6 } 50%{ opacity:1 } }
        .lp-close-title { position:relative; font-family:'Space Grotesk',sans-serif; font-weight:600;
          font-size:clamp(26px, 4vw, 40px); margin:0 0 32px; letter-spacing:-.01em; }

        .lp-footer { position:relative; z-index:2; display:flex; justify-content:space-between; align-items:center;
          flex-wrap:wrap; gap:8px; padding:22px clamp(20px, 5vw, 64px); font-family:'IBM Plex Mono',monospace;
          font-size:10px; color:#3A5570; background:#060A11; }

        @media (max-width: 900px) {
          .lp-cap-grid { grid-template-columns:repeat(2, 1fr); }
          .lp-pipeline { grid-template-columns:repeat(2, 1fr); }
          .lp-hermes-wrap { grid-template-columns:1fr; gap:32px; }
          .lp-stats { grid-template-columns:1fr; gap:24px; }
          .lp-stat { border-left:none; padding-left:0; padding-top:0; }
          .lp-stat-rail { display:none; }
          .lp-team-grid { grid-template-columns:1fr; }
        }
        @media (max-width: 640px) {
          .lp-hero { padding-top:96px; padding-bottom:40px; align-items:flex-start; }
          .lp-title { font-size:clamp(28px, 8vw, 38px); }
          .lp-desc { font-size:14.5px; }
          .lp-cta-row { flex-direction:column; align-items:flex-start; gap:14px; }
          .lp-footer { flex-direction:column; align-items:flex-start; text-align:left; }
          .lp-cap-grid { grid-template-columns:1fr; }
          .lp-section { padding:64px 20px; }
          .lp-flip-card { height:240px; }
          .lp-scroll-cue { display:none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-scanline, .lp-close-glow, .lp-eyebrow::before, .lp-terminal-caret { animation:none; }
        }
      `}</style>

      <motion.div className="lp-progress" style={{ scaleX: scrollYProgress }} />

      <div className="lp-video-wrap">
        <motion.video
          ref={videoRef}
          className="lp-video"
          style={{ opacity: videoOpacity, scale: heroVideoScale }}
          autoPlay muted loop playsInline
          src="/robot-face.mp4"
        />
        <div className="lp-scanline" />
      </div>
      <div className="lp-overlay" />

      <motion.nav
        className="lp-nav"
        style={{ background: navBg, backdropFilter: navBlur, WebkitBackdropFilter: navBlur, borderBottomColor: navBorder }}
      >
        <motion.div initial="hidden" animate="show" custom={0} variants={fadeUp} className="lp-logo">
          <div className="lp-logo-mark"><span style={{ color: "#29D3FF", fontSize: 15 }}>⬡</span></div>
          SIRA
        </motion.div>
        <motion.div
          initial="hidden" animate="show" custom={0.1} variants={fadeUp}
          style={{ display: "flex", alignItems: "center", gap: 22 }}
        >
          <span
            onClick={() => navigate("/faq")}
            style={{
              fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, letterSpacing: ".1em",
              color: "#B7C4D1", cursor: "pointer", transition: "color .2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#29D3FF")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#B7C4D1")}
          >
            FAQ
          </span>
          <button className="lp-login-btn" onClick={goEnter}>
            LOGIN
          </button>
        </motion.div>
      </motion.nav>

      <div className="lp-hero" ref={heroRef} onMouseMove={handleHeroMouseMove}>
        <motion.div className="lp-spotlight" style={{ background: spotlightBg }} />
        <motion.div className="lp-hero-inner" style={{ y: heroContentY, opacity: heroContentOpacity }}>
          <motion.div initial="hidden" animate="show" custom={0.15} variants={fadeUp} className="lp-eyebrow">
            AI SOC Copilot
          </motion.div>

          <motion.h1 initial="hidden" animate="show" custom={0.28} variants={fadeUp} className="lp-title">
            SIRA watches your network so you don't have to <span className="lp-accent">watch alone.</span>
          </motion.h1>

          <motion.p initial="hidden" animate="show" custom={0.42} variants={fadeUp} className="lp-desc">
            SIRA analyses real Suricata and Zeek traffic, triages alerts autonomously, and
            investigates every incident with Hermes — an AI agent that shows its reasoning
            instead of hiding it. Built for Studio 6 at Otago Polytechnic.
          </motion.p>

          <motion.div initial="hidden" animate="show" custom={0.56} variants={fadeUp} className="lp-cta-row">
            <motion.button
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.97 }}
              className="lp-enter-btn"
              onClick={goEnter}
            >
              ENTER THE LAB →
            </motion.button>
            <span className="lp-meta">No account? You'll be able to request access next.</span>
          </motion.div>
        </motion.div>

        <motion.div className="lp-scroll-cue" style={{ opacity: heroCueOpacity }}>
          <span>Scroll</span>
          <motion.svg
            width="14" height="20" viewBox="0 0 14 20" fill="none"
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <path d="M1 1L7 19L13 1" stroke="#29D3FF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </motion.svg>
        </motion.div>
      </div>

      <div className="lp-below">

        {/* ---------- capabilities ---------- */}
        <motion.section
          className="lp-section"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="lp-section-head">
            <div className="lp-eyebrow">What SIRA Does</div>
            <h2 className="lp-section-title">One analyst's view of everything on the wire.</h2>
          </div>
          <motion.div
            className="lp-cap-grid corner-frame"
            variants={gridContainer}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
          >
            {CAPABILITIES.map((c) => (
              <motion.div
                className="lp-cap-card"
                key={c.title}
                variants={gridItem}
                whileHover={{ y: -6, scale: 1.015, backgroundColor: "rgba(41,211,255,0.04)" }}
                transition={{ duration: 0.25 }}
              >
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </motion.section>

        {/* ---------- pipeline: pinned scroll-scrub on desktop, static stagger on mobile ---------- */}
        {isDesktop ? (
          <section className="lp-pipeline-outer" ref={pipelineWrapRef}>
            <div className="lp-pipeline-sticky">
              <div className="lp-section-head">
                <div className="lp-eyebrow">Pipeline</div>
                <h2 className="lp-section-title">From packet to verdict.</h2>
              </div>
              <div className="lp-pipeline">
                {PIPELINE.map((s, i) => (
                  <PipelineStep key={s.n} step={s} index={i} total={PIPELINE.length} progress={pipelineProgress} />
                ))}
              </div>
              <div className="lp-pipe-track">
                <motion.div className="lp-pipe-track-fill" style={{ scaleX: pipelineProgress }} />
              </div>
            </div>
          </section>
        ) : (
          <motion.section
            className="lp-section"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="lp-section-head">
              <div className="lp-eyebrow">Pipeline</div>
              <h2 className="lp-section-title">From packet to verdict.</h2>
            </div>
            <motion.div
              className="lp-pipeline"
              variants={gridContainer}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-60px" }}
            >
              {PIPELINE.map((s) => (
                <motion.div
                  className="lp-pipe-step corner-frame"
                  key={s.n}
                  variants={gridItem}
                  whileHover={{ y: -6, borderColor: "#29D3FF" }}
                  transition={{ duration: 0.25 }}
                >
                  <div className="lp-pipe-num">STAGE {s.n}</div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </motion.div>
              ))}
            </motion.div>
          </motion.section>
        )}

        {/* ---------- hermes spotlight ---------- */}
        <motion.section
          className="lp-section"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="lp-hermes-wrap">
            <div className="lp-hermes-copy">
              <div className="lp-eyebrow">Meet Hermes</div>
              <h2 className="lp-section-title" style={{ marginBottom: 18 }}>
                It doesn't just flag it, it explains it.
              </h2>
              <p>
                Every Hermes investigation is a visible chain of reasoning, not a single
                score. You see exactly what it checked, what it ruled out, and why it
                landed on a verdict — so you can trust it, or overrule it.
              </p>
            </div>
            <motion.div
              className="lp-terminal corner-frame"
              initial={{ opacity: 0, scale: 0.96 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="lp-terminal-head">
                <span className="lp-terminal-dot" />
                <span className="lp-terminal-dot" />
                <span className="lp-terminal-dot" />
              </div>
              {HERMES_LOG.map((l, i) => (
                <motion.div
                  className="lp-terminal-line"
                  key={i}
                  style={{ color: l.c }}
                  initial={{ opacity: 0, x: -8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.35, delay: 0.15 + i * 0.12 }}
                >
                  {i === 0 ? "> " : "  "}{l.t}
                  {i === HERMES_LOG.length - 1 && <span className="lp-terminal-caret" />}
                </motion.div>
              ))}
            </motion.div>
          </div>
        </motion.section>

        {/* ---------- stats strip ---------- */}
        <motion.section
          className="lp-section"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="lp-stats">
            {[
              { label: "Real Traffic", body: "Runs on live Suricata and Zeek output, not canned demo data." },
              { label: "Full Reasoning Trace", body: "Every Hermes verdict comes with the steps that led to it." },
              { label: "Studio 6 Build", body: "Built and iterated in the open for Otago Polytechnic, Block 3 2026." },
            ].map((s, i) => (
              <motion.div
                className="lp-stat"
                key={s.label}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
              >
                {i > 0 && (
                  <motion.div
                    className="lp-stat-rail"
                    initial={{ scaleY: 0 }}
                    whileInView={{ scaleY: 1 }}
                    viewport={{ once: true, margin: "-60px" }}
                    transition={{ duration: 0.6, delay: 0.15 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                  />
                )}
                <div className="lp-stat-label">{s.label}</div>
                <div className="lp-stat-body">{s.body}</div>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ---------- tech stack ---------- */}
        <motion.section
          className="lp-section"
          style={{ paddingTop: 44, paddingBottom: 44 }}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
        >
          <div className="lp-eyebrow" style={{ marginBottom: 18 }}>Built With</div>
          <div className="lp-stack-row">
            {STACK.map((s) => (
              <span className="lp-stack-item" key={s}>{s}</span>
            ))}
          </div>
        </motion.section>

        {/* ---------- team ---------- */}
        <motion.section
          className="lp-section"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="lp-section-head">
            <div className="lp-eyebrow">The Team</div>
            <h2 className="lp-section-title">Two people, one lab.</h2>
          </div>
          <div className="lp-team-grid">
            {TEAM.map((m) => (
              <motion.div
                className="lp-flip-card corner-frame"
                key={m.name}
                initial="rest"
                whileHover="hover"
                style={{ perspective: 1200 }}
              >
                <motion.div
                  className="lp-flip-inner"
                  variants={flipInnerVariants}
                  transition={flipTransition}
                >
                  {/* front — name side */}
                  <div className="lp-flip-face lp-flip-face-name">
                    <div className="lp-avatar-mini">{m.initials}</div>
                    <h3>{m.name}</h3>
                    <div className="lp-team-role">{m.role.toUpperCase()}</div>
                    <p>{m.body}</p>
                    <div className="lp-flip-hint">HOVER TO VIEW →</div>
                  </div>

                  {/* back — photo side (pre-rotated 180deg so it reads correctly after flip) */}
                  <div className="lp-flip-face lp-flip-face-image">
                    {m.photo ? (
                      <img src={m.photo} alt={m.name} />
                    ) : (
                      <div className="lp-photo-placeholder">
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#29D3FF" strokeWidth="1.4">
                          <circle cx="12" cy="8" r="4" />
                          <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
                        </svg>
                        <span>PHOTO PENDING</span>
                      </div>
                    )}
                    <div className="lp-flip-caption">
                      <h3>{m.name}</h3>
                      <div className="lp-team-role">{m.role.toUpperCase()}</div>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ---------- closing CTA ---------- */}
        <motion.section
          className="lp-close-cta"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="lp-close-glow" />
          <h2 className="lp-close-title">Ready to see it triage something?</h2>
          <motion.button
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
            className="lp-enter-btn"
            onClick={goEnter}
          >
            ENTER THE LAB →
          </motion.button>
        </motion.section>

        <footer className="lp-footer">
          <div>SIRA v4 · AI SOC Copilot</div>
          <div>Satyam Kamboj &amp; Pratham · Otago Polytechnic 2026</div>
        </footer>
      </div>
    </div>
  );
}
