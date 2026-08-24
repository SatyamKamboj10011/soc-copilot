import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";

const FLASK_URL = "http://localhost:5000";
const HermesContext = createContext(null);

function makeCaseId() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const suffix = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `SC-${stamp}-${suffix}`;
}

/*
 * HermesProvider must be mounted ONCE, near the root of the app — above
 * whatever switches between pages (App.js wraps its whole return in this).
 * That's what makes an investigation survive navigating to another page:
 * the fetch and the state tracking it live HERE, not inside HermesPage.
 *
 * Matches the real /hermes-agent contract from App.js's old startHermes():
 * a single blocking POST with {task, model}, response {steps, answer}.
 * No streaming — an earlier draft guessed at NDJSON streaming; this has
 * been corrected to match your actual backend.
 *
 * hermesModel: pass the current PERF_TIERS[perfTier].hermesModel from
 * App.js. Read via a ref so new investigations always use the latest tier
 * without HermesProvider needing to remount.
 */
export function HermesProvider({ children, hermesModel = "nous-hermes2" }) {
  const [investigations, setInvestigations] = useState([]);
  // each: {id, caseId, task, status: 'running'|'done'|'error', steps, answer, error, startedAt}
  const [activeId, setActiveId] = useState(null);
  const counter = useRef(0);
  const hermesModelRef = useRef(hermesModel);
  useEffect(() => { hermesModelRef.current = hermesModel; }, [hermesModel]);

  const patchInvestigation = useCallback((id, patch) => {
    setInvestigations(prev =>
      prev.map(inv => (inv.id === id ? { ...inv, ...(typeof patch === "function" ? patch(inv) : patch) } : inv))
    );
  }, []);

  const startInvestigation = useCallback(async (task) => {
    if (!task || !task.trim()) return;
    const id = `hi_${Date.now()}_${counter.current++}`;
    const investigation = {
      id,
      caseId: makeCaseId(),
      task: task.trim(),
      status: "running",
      steps: [],
      answer: "",
      error: "",
      startedAt: Date.now(),
    };
    setInvestigations(prev => [investigation, ...prev]);
    setActiveId(id);

    try {
      const res = await fetch(`${FLASK_URL}/hermes-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: investigation.task, model: hermesModelRef.current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Hermes request failed (${res.status})`);
      patchInvestigation(id, {
        status: "done",
        steps: data.steps || [],
        answer: data.answer || "Investigation complete",
      });
    } catch (e) {
      patchInvestigation(id, { status: "error", error: e.message, answer: `Error: ${e.message}` });
    }
  }, [patchInvestigation]);

  const closeInvestigation = useCallback((id) => {
    setInvestigations(prev => prev.filter(inv => inv.id !== id));
    setActiveId(prev => (prev === id ? null : prev));
  }, []);

  const clearInvestigation = useCallback((id) => {
    patchInvestigation(id, { steps: [], answer: "", status: "running", error: "" });
  }, [patchInvestigation]);

  const runningCount = investigations.filter(i => i.status === "running").length;

  const value = {
    investigations,
    activeId,
    setActiveId,
    startInvestigation,
    closeInvestigation,
    clearInvestigation,
    runningCount,
  };

  return <HermesContext.Provider value={value}>{children}</HermesContext.Provider>;
}

export function useHermes() {
  const ctx = useContext(HermesContext);
  if (!ctx) throw new Error("useHermes must be used inside <HermesProvider>");
  return ctx;
}

/* Drop this in your top nav next to the Hermes tab. Stays visible and
 * pulses while a case is active, even on pages that aren't HermesPage —
 * proof the investigation really is still running in the background. */
export function HermesNavBadge({ onClick }) {
  const { runningCount } = useHermes();
  if (runningCount === 0) return null;
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "var(--purple-dim, rgba(139,124,255,0.12))",
        border: "1px solid var(--purple, #8B7CFF)",
        borderRadius: 20,
        padding: "4px 10px",
        fontFamily: "var(--mono, monospace)",
        fontSize: 10,
        color: "var(--purple, #8B7CFF)",
        cursor: "pointer",
        letterSpacing: 0.5,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--accent, #29D3FF)",
          animation: "hermesBadgePulse 1s ease-in-out infinite",
        }}
      />
      {runningCount} case{runningCount === 1 ? "" : "s"} active
      <style>{`@keyframes hermesBadgePulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
    </button>
  );
}