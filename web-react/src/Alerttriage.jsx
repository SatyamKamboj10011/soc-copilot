import { useState, useEffect, useCallback, useMemo } from "react";
import {
  collection, doc, getDocs, setDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

/**
 * Alert triage — tracks what has actually been done about each alert.
 *
 * Two decisions worth knowing:
 *
 * 1. Firestore, not SQLite. Render's free tier has an ephemeral filesystem:
 *    a local SQLite file is wiped whenever the service redeploys, restarts,
 *    or spins down after inactivity. Triage state that vanishes overnight is
 *    worse than none, because it silently looks like nobody reviewed anything.
 *
 * 2. Triage is team state, not personal. If one analyst marks something a
 *    false positive, everyone should see that -- otherwise two people
 *    investigate the same alert twice and neither knows.
 */

const COLLECTION = "alert_triage";

export const TRIAGE_STATUS = {
  new:           { label: "New",           color: "var(--text-dim, #5A5A62)", short: "NEW" },
  investigating: { label: "Investigating", color: "var(--orange, #F0A857)",   short: "INVEST" },
  resolved:      { label: "Resolved",      color: "var(--green, #22D97A)",    short: "DONE" },
  false_positive:{ label: "False positive",color: "var(--purple, #8B7CFF)",   short: "FP" },
};

export const STATUS_ORDER = ["new", "investigating", "resolved", "false_positive"];

/**
 * Stable identifier for a log entry, derived from its content rather than
 * its position in a result set -- so triage survives the list being
 * re-sorted, re-filtered, or re-fetched with different pagination.
 *
 * djb2. Not cryptographic, and doesn't need to be: this is a dedup key,
 * not a security boundary.
 */
export function alertKey(log) {
  if (!log) return null;
  const seed = [
    log.alert?.signature || log.event_type || "",
    log.src_ip || "",
    log.dest_ip || "",
    log.timestamp || "",
  ].join("|");

  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  }
  return `a${h.toString(16)}`;
}

export function useAlertTriage(username) {
  const [triage, setTriage] = useState({});   // { alertKey: record }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // No where() or orderBy() -- a plain collection read needs no composite
      // index, which avoids the "query requires an index" wall entirely.
      // Sorting happens client-side. Fine at this scale; if the collection
      // ever grows large this should move to a filtered, indexed query.
      const snap = await getDocs(collection(db, COLLECTION));
      const next = {};
      snap.docs.forEach(d => { next[d.id] = d.data(); });
      setTriage(next);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = useCallback(async (log, changes) => {
    const key = alertKey(log);
    if (!key) return;

    const record = {
      status: "new",
      notes: "",
      ...(triage[key] || {}),
      ...changes,
      // Snapshot enough of the alert to make the record readable on its own,
      // so a triage entry still means something if the log rotates out.
      signature: log.alert?.signature || log.event_type || "",
      src_ip: log.src_ip || "",
      alert_timestamp: log.timestamp || "",
      updated_by: username || "unknown",
      updated_at: serverTimestamp(),
    };

    // Optimistic: the dropdown should respond immediately rather than after
    // a network round-trip.
    setTriage(prev => ({ ...prev, [key]: { ...record, updated_at: new Date() } }));

    try {
      await setDoc(doc(db, COLLECTION, key), record, { merge: true });
      setError(null);
    } catch (e) {
      setError(e.message);
      await load();   // roll back to whatever the server actually has
    }
  }, [triage, username, load]);

  const statusOf = useCallback((log) => {
    const rec = triage[alertKey(log)];
    return rec?.status || "new";
  }, [triage]);

  const recordOf = useCallback((log) => triage[alertKey(log)] || null, [triage]);

  const counts = useMemo(() => {
    const c = { new: 0, investigating: 0, resolved: 0, false_positive: 0 };
    Object.values(triage).forEach(r => {
      if (c[r.status] !== undefined) c[r.status] += 1;
    });
    return c;
  }, [triage]);

  return { triage, loading, error, update, statusOf, recordOf, counts, reload: load };
}

/* ── UI pieces ──────────────────────────────────────────────────────── */

export function TriageBadge({ status, onClick, compact }) {
  const s = TRIAGE_STATUS[status] || TRIAGE_STATUS.new;
  return (
    <span
      onClick={onClick}
      title={onClick ? "Click to change status" : s.label}
      style={{
        fontFamily: "var(--mono, monospace)",
        fontSize: compact ? 8 : 9,
        letterSpacing: 0.6,
        padding: compact ? "1px 6px" : "3px 9px",
        borderRadius: 20,
        color: s.color,
        border: `1px solid ${s.color}55`,
        background: `${s.color}14`,
        cursor: onClick ? "pointer" : "default",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {compact ? s.short : s.label}
    </span>
  );
}

export function TriageSelect({ value, onChange, disabled }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onClick={e => e.stopPropagation()}
      onChange={e => { e.stopPropagation(); onChange(e.target.value); }}
      style={{
        fontFamily: "var(--mono, monospace)",
        fontSize: 10,
        padding: "5px 8px",
        borderRadius: 6,
        background: "var(--bg3, #17171A)",
        color: TRIAGE_STATUS[value]?.color || "var(--text, #F2F6FA)",
        border: `1px solid ${TRIAGE_STATUS[value]?.color || "var(--border2)"}55`,
        cursor: disabled ? "not-allowed" : "pointer",
        outline: "none",
      }}
    >
      {STATUS_ORDER.map(k => (
        <option key={k} value={k} style={{ background: "var(--bg3, #17171A)", color: "var(--text, #F2F6FA)" }}>
          {TRIAGE_STATUS[k].label}
        </option>
      ))}
    </select>
  );
}

/** Summary strip — "12 new · 3 investigating · 8 resolved · 2 false positive" */
export function TriageSummary({ counts, loading, style }) {
  const total = STATUS_ORDER.reduce((n, k) => n + (counts[k] || 0), 0);

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      padding: "10px 14px", borderRadius: 10,
      background: "rgba(255,255,255,0.03)",
      border: "1px solid var(--border2, rgba(255,255,255,0.12))",
      ...style,
    }}>
      <span style={{
        fontFamily: "var(--mono, monospace)", fontSize: 9, letterSpacing: 1.5,
        color: "var(--text-dim, #5A5A62)",
      }}>TRIAGE</span>

      {loading && (
        <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 10, color: "var(--text-dim)" }}>
          loading…
        </span>
      )}

      {!loading && total === 0 && (
        <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 10, color: "var(--text-dim)" }}>
          No alerts triaged yet
        </span>
      )}

      {!loading && total > 0 && STATUS_ORDER.map(k => (
        <span key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: TRIAGE_STATUS[k].color,
          }} />
          <span style={{
            fontFamily: "var(--mono, monospace)", fontSize: 11,
            color: "var(--text, #F2F6FA)", fontWeight: 700,
          }}>{counts[k] || 0}</span>
          <span style={{
            fontFamily: "var(--sans, sans-serif)", fontSize: 11,
            color: "var(--text-mid, #9A9AA2)",
          }}>{TRIAGE_STATUS[k].label.toLowerCase()}</span>
        </span>
      ))}
    </div>
  );
}

/** Notes box for the event inspector. */
export function TriageNotes({ record, onSave, disabled }) {
  const [text, setText] = useState(record?.notes || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setText(record?.notes || ""); }, [record?.notes]);

  const save = async () => {
    setSaving(true);
    await onSave(text);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{
        fontFamily: "var(--mono, monospace)", fontSize: 9, letterSpacing: 1.5,
        color: "var(--text-dim, #5A5A62)", marginBottom: 7,
      }}>ANALYST NOTES</div>

      <textarea
        value={text}
        disabled={disabled}
        onChange={e => setText(e.target.value)}
        placeholder="e.g. Confirmed as our own vulnerability scanner — runs every Monday."
        rows={3}
        style={{
          width: "100%", boxSizing: "border-box",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid var(--border2, rgba(255,255,255,0.12))",
          borderRadius: 8, padding: "9px 11px",
          color: "var(--text, #F2F6FA)",
          fontFamily: "var(--sans, sans-serif)", fontSize: 12, lineHeight: 1.6,
          outline: "none", resize: "vertical",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <button
          onClick={save}
          disabled={disabled || saving || text === (record?.notes || "")}
          style={{
            fontFamily: "var(--mono, monospace)", fontSize: 10, letterSpacing: 1,
            padding: "6px 14px", borderRadius: 7, cursor: "pointer",
            background: "var(--accent-dim, rgba(41,211,255,0.08))",
            border: "1px solid var(--accent, #29D3FF)",
            color: "var(--accent, #29D3FF)",
            opacity: (disabled || saving || text === (record?.notes || "")) ? 0.4 : 1,
          }}
        >{saving ? "SAVING…" : saved ? "SAVED ✓" : "SAVE NOTE"}</button>

        {record?.updated_by && (
          <span style={{
            fontFamily: "var(--mono, monospace)", fontSize: 9,
            color: "var(--text-dim, #5A5A62)",
          }}>
            last updated by {record.updated_by}
          </span>
        )}
      </div>
    </div>
  );
}