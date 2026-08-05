import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (delay = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] } }),
};

const FAQ_DATA = [
  {
    category: "Getting Started",
    items: [
      {
        q: "What is SIRA?",
        a: "SIRA is an AI-powered SOC investigation platform. It ingests live network traffic, triages alerts automatically, and uses Hermes — an AI agent — to investigate each incident and explain its reasoning, instead of just handing you a raw alert feed.",
      },
      {
        q: "Who is SIRA built for?",
        a: "Security analysts and SOC teams who want alerts pre-triaged and investigated before they land in the queue, so time goes into decisions instead of digging through raw logs.",
      },
      {
        q: "Do I need to install anything to use SIRA?",
        a: "No — SIRA runs in the browser. Suricata and Zeek need to be running wherever your traffic is captured, but the dashboard itself is web-based.",
      },
      {
        q: "How do I get access?",
        a: "Request access from the login page. An existing account holder or admin can approve new analyst accounts.",
      },
    ],
  },
  {
    category: "Data & Security",
    items: [
      {
        q: "What data does SIRA analyze?",
        a: "Network traffic metadata from Suricata and Zeek — alerts, flow records, and connection details. SIRA doesn't need or request the content of your traffic, just what those tools already log.",
      },
      {
        q: "Is my data stored or shared with anyone?",
        a: "Data stays within your own SIRA deployment. Alerts and case data are used only to power your investigations and aren't shared externally.",
      },
      {
        q: "Can I use my own Suricata or Zeek setup?",
        a: "Yes — SIRA is built to work with standard Suricata and Zeek output rather than a custom sensor format.",
      },
    ],
  },
  {
    category: "Hermes & AI",
    items: [
      {
        q: "What is Hermes?",
        a: "Hermes is the AI agent that investigates alerts. Instead of returning a single score, it works through the evidence step by step — checking history, cross-referencing indicators, reviewing patterns — and shows that reasoning alongside its verdict.",
      },
      {
        q: "Which AI models power Hermes?",
        a: "Hermes can run on Groq or Gemini as the underlying model provider, configurable per deployment. Local models are also supported for fully offline use.",
      },
      {
        q: "Can I trust Hermes's verdicts, or should I double-check everything?",
        a: "Treat Hermes as a fast first-pass investigator, not a final authority. Its reasoning is fully visible specifically so you can verify it and override the verdict when your own judgment differs.",
      },
      {
        q: "Can Hermes make mistakes?",
        a: "Yes. Like any AI system, it can misjudge an alert. That's the reason every investigation shows its full reasoning trace instead of just a conclusion — so an incorrect verdict is easy to catch.",
      },
    ],
  },
  {
    category: "Account & Access",
    items: [
      {
        q: "Can I sign in with Google?",
        a: "Yes — both login and registration support signing in with a Google account, alongside standard email and password.",
      },
      {
        q: "How do I connect my own Groq or Gemini API key?",
        a: "Add it under Settings → API Keys. Keys are masked after entry and you can test the connection before saving.",
      },
      {
        q: "Who can see my case files and investigations?",
        a: "Case visibility follows your organization's account setup — typically your team or SOC group, not shared outside your deployment.",
      },
    ],
  },
];

function AccordionItem({ item, isOpen, onToggle }) {
  return (
    <div className="faq-item corner-frame">
      <button className="faq-question" onClick={onToggle} aria-expanded={isOpen}>
        <span>{item.q}</span>
        <motion.span
          className="faq-chevron"
          animate={{ rotate: isOpen ? 45 : 0 }}
          transition={{ duration: 0.25 }}
        >
          +
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            className="faq-answer-wrap"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="faq-answer">{item.a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FAQ() {
  const [openKey, setOpenKey] = useState("Getting Started-0");

  const toggle = (key) => setOpenKey((prev) => (prev === key ? null : key));

  return (
    <div className="faq-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .faq-root { min-height:100vh; background:#060A11; color:#E9F1F7; font-family:'Inter',sans-serif;
          padding:56px clamp(20px, 5vw, 64px) 100px; }

        .corner-frame { position:relative; }
        .corner-frame::before, .corner-frame::after { content:''; position:absolute; width:12px; height:12px;
          border-color:#29D3FF; border-style:solid; opacity:.6; pointer-events:none; }
        .corner-frame::before { top:-1px; left:-1px; border-width:1.5px 0 0 1.5px; }
        .corner-frame::after { bottom:-1px; right:-1px; border-width:0 1.5px 1.5px 0; }

        .faq-header { max-width:640px; margin:0 auto 56px; text-align:center; }
        .faq-eyebrow { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.16em; color:#22D97A;
          text-transform:uppercase; margin:0 0 14px; display:flex; align-items:center; justify-content:center; gap:8px; }
        .faq-eyebrow::before { content:''; width:6px; height:6px; border-radius:50%; background:#22D97A;
          box-shadow:0 0 8px #22D97A; }
        .faq-title { font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:clamp(26px, 3.4vw, 38px);
          margin:0 0 14px; letter-spacing:-.01em; }
        .faq-subtitle { font-size:14.5px; color:#8FA2B4; line-height:1.7; margin:0; }

        .faq-body { max-width:760px; margin:0 auto; }

        .faq-category { margin-bottom:44px; }
        .faq-category-label { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.14em;
          color:#8B7CFF; text-transform:uppercase; margin:0 0 16px; }

        .faq-item { border:1px solid #12314A; border-radius:6px; background:rgba(10,18,28,0.4);
          margin-bottom:10px; overflow:hidden; }
        .faq-question { width:100%; background:none; border:none; padding:18px 20px; cursor:pointer;
          display:flex; align-items:center; justify-content:space-between; gap:16px; text-align:left;
          font-family:'Space Grotesk',sans-serif; font-weight:500; font-size:15px; color:#E9F1F7; }
        .faq-question:hover { color:#29D3FF; }
        .faq-chevron { font-family:'IBM Plex Mono',monospace; font-size:20px; color:#29D3FF; flex-shrink:0;
          line-height:1; }
        .faq-answer-wrap { overflow:hidden; }
        .faq-answer { margin:0; padding:0 20px 20px; font-size:13.5px; color:#8FA2B4; line-height:1.75; }

        @media (max-width: 640px) {
          .faq-root { padding:40px 20px 80px; }
          .faq-question { font-size:14px; padding:16px; }
        }
      `}</style>

      <motion.div className="faq-header" initial="hidden" animate="show" custom={0} variants={fadeUp}>
        <div className="faq-eyebrow">Behind The Build</div>
        <h1 className="faq-title">What we actually ran into.</h1>
        <p className="faq-subtitle">
          SIRA didn't come together in a straight line. Here's the honest version —
          what broke, why, and what we changed across Studio 5 and Studio 6.
        </p>
      </motion.div>

      <div className="faq-body">
        {FAQ_DATA.map((section, si) => (
          <motion.div
            className="faq-category"
            key={section.category}
            initial="hidden"
            animate="show"
            custom={0.1 + si * 0.08}
            variants={fadeUp}
          >
            <div className="faq-category-label">{section.category}</div>
            {section.items.map((item, ii) => {
              const key = `${section.category}-${ii}`;
              return (
                <AccordionItem
                  key={key}
                  item={item}
                  isOpen={openKey === key}
                  onToggle={() => toggle(key)}
                />
              );
            })}
          </motion.div>
        ))}
      </div>
    </div>
  );
}