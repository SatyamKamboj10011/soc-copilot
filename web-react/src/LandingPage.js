import { useRef, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

const fadeUp = {
  hidden: { opacity: 0, y: 22 },
  show: (delay = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] } }),
};

export default function LandingPage() {
  const navigate = useNavigate();
  const goEnter = () => navigate("/login");

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

  return (
    <div className="lp-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .lp-root { position:relative; min-height:100vh; overflow-x:hidden; background:#060A11; color:#E9F1F7;
          font-family:'Inter',sans-serif; display:flex; flex-direction:column; }

        .lp-video { position:fixed; inset:0; width:100%; height:100%; object-fit:cover; z-index:0; }
        .lp-overlay { position:fixed; inset:0; z-index:1;
          background:
            linear-gradient(90deg, rgba(6,10,17,0.92) 0%, rgba(6,10,17,0.6) 42%, rgba(6,10,17,0.18) 68%, rgba(6,10,17,0.05) 100%),
            linear-gradient(180deg, rgba(6,10,17,0.15) 0%, rgba(6,10,17,0.1) 55%, rgba(6,10,17,0.85) 100%);
        }

        .lp-nav { position:relative; z-index:2; display:flex; align-items:center; justify-content:space-between;
          padding:24px clamp(20px, 5vw, 64px); }
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
          padding:40px clamp(20px, 5vw, 64px) 60px; }
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
        .lp-enter-btn { font-family:'IBM Plex Mono',monospace; font-size:13px; letter-spacing:.14em; color:#060A11;
          background:#29D3FF; border:none; border-radius:4px; padding:16px 32px; cursor:pointer;
          display:inline-flex; align-items:center; gap:10px; transition:all .2s;
          box-shadow:0 0 30px -6px rgba(41,211,255,0.5); }
        .lp-enter-btn:hover { background:#5CE0FF; }

        .lp-meta { font-family:'IBM Plex Mono',monospace; font-size:11px; color:#4C6478; letter-spacing:.04em;
          line-height:1.5; max-width:220px; }

        .lp-footer { position:relative; z-index:2; display:flex; justify-content:space-between; align-items:center;
          flex-wrap:wrap; gap:8px; padding:22px clamp(20px, 5vw, 64px); font-family:'IBM Plex Mono',monospace;
          font-size:10px; color:#3A5570; border-top:1px solid rgba(18,49,74,0.5); }

        @media (max-width: 640px) {
          .lp-hero { padding-top:20px; padding-bottom:40px; align-items:flex-start; }
          .lp-title { font-size:clamp(28px, 8vw, 38px); }
          .lp-desc { font-size:14.5px; }
          .lp-cta-row { flex-direction:column; align-items:flex-start; gap:14px; }
          .lp-footer { flex-direction:column; align-items:flex-start; text-align:left; }
        }
      `}</style>

      <video
        ref={videoRef}
        className="lp-video"
        style={{ opacity: videoOpacity, transition: "opacity 0.1s linear" }}
        autoPlay muted loop playsInline
        src="/robot-face.mp4"
      />
      <div className="lp-overlay" />

      <nav className="lp-nav">
        <motion.div initial="hidden" animate="show" custom={0} variants={fadeUp} className="lp-logo">
          <div className="lp-logo-mark"><span style={{ color: "#29D3FF", fontSize: 15 }}>⬡</span></div>
          SIRA
        </motion.div>
        <motion.button
          initial="hidden" animate="show" custom={0.1} variants={fadeUp}
          className="lp-login-btn" onClick={goEnter}
        >
          LOGIN
        </motion.button>
      </nav>

      <div className="lp-hero">
        <div className="lp-hero-inner">
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
        </div>
      </div>

      <footer className="lp-footer">
        <div>SIRA v4 · AI SOC Copilot</div>
        <div>Satyam Kamboj &amp; Pratham · Otago Polytechnic 2026</div>
      </footer>
    </div>
  );
}