import { createContext, useContext, useState, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

const FLASK_URL = "https://api.sira-soc.me";
const PROFILES_COLLECTION = "attacker_profiles";

const TYPE_COLOR = {
  alert: "var(--red, #E15554)",
  dns:   "var(--accent, #29D3FF)",
  http:  "var(--green, #22D97A)",
  tls:   "var(--purple, #8B7CFF)",
  flow:  "var(--text-dim, #5A5A62)",
};

const FloatingAnalysisContext = createContext(null);

export function useFloatingAnalysis() {
  const ctx = useContext(FloatingAnalysisContext);
  if (!ctx) throw new Error("useFloatingAnalysis must be used inside <FloatingAnalysisProvider>");
  return ctx;
}

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

/* ==================== Window chrome — draggable by header, resizable from the
   bottom-right corner, no backdrop/scrim so it never blocks the rest of the app ==================== */
function FloatingWindow({ id, title, titleColor, defaultPos, defaultSize, zIndex, onFocus, onClose, children }) {
  const [pos, setPos] = useState(defaultPos);
  const [size, setSize] = useState(defaultSize);

  const startDrag = (e) => {
    if (e.target.closest("[data-no-drag]")) return;
    onFocus(id);
    const startX = e.clientX, startY = e.clientY;
    const origin = { ...pos };
    const onMove = (ev) => {
      setPos({
        x: clamp(origin.x + (ev.clientX - startX), 0, window.innerWidth - 140),
        y: clamp(origin.y + (ev.clientY - startY), 0, window.innerHeight - 44),
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startResize = (e) => {
    e.stopPropagation();
    onFocus(id);
    const startX = e.clientX, startY = e.clientY;
    const origin = { ...size };
    const onMove = (ev) => {
      setSize({
        w: clamp(origin.w + (ev.clientX - startX), 360, window.innerWidth - pos.x - 10),
        h: clamp(origin.h + (ev.clientY - startY), 260, window.innerHeight - pos.y - 10),
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      onMouseDown={() => onFocus(id)}
      style={{
        position: "fixed", left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex,
        background: "linear-gradient(180deg, rgba(20,20,24,0.98), rgba(14,14,17,0.99))",
        backdropFilter: "blur(24px) saturate(150%)", WebkitBackdropFilter: "blur(24px) saturate(150%)",
        border: "1px solid var(--border2, rgba(255,255,255,0.14))",
        borderRadius: 14,
        boxShadow: "0 1px 0 rgba(255,255,255,0.06) inset, 0 24px 60px -16px rgba(0,0,0,0.65)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      <div
        onMouseDown={startDrag}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px", borderBottom: "1px solid var(--border, rgba(255,255,255,0.08))",
          cursor: "move", flexShrink: 0, userSelect: "none",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <span style={{
          fontFamily: "var(--mono, monospace)", fontSize: 10, letterSpacing: 1,
          color: titleColor, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {title}
        </span>
        <button
          data-no-drag
          onClick={onClose}
          style={{
            background: "rgba(255,255,255,0.06)", border: "1px solid var(--border2, rgba(255,255,255,0.12))",
            borderRadius: 7, width: 24, height: 24, color: "var(--text-dim, #5A5A62)", cursor: "pointer",
            fontSize: 12, flexShrink: 0, marginLeft: 10,
          }}
        >✕</button>
      </div>

      <div data-no-drag style={{ overflowY: "auto", flex: 1, padding: "14px 18px", cursor: "default" }}>
        {children}
      </div>

      <div
        onMouseDown={startResize}
        title="Drag to resize"
        style={{
          position: "absolute", right: 2, bottom: 2, width: 16, height: 16, cursor: "nwse-resize",
          background: "linear-gradient(135deg, transparent 50%, var(--border2, rgba(255,255,255,0.3)) 50%)",
          borderRadius: "0 0 6px 0",
        }}
      />
    </div>
  );
}

/* ==================== Profile window content ==================== */
function ProfileContent({ profile, loading, timeline, onRefresh, onAskSira }) {
  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40, fontFamily: "var(--mono, monospace)", color: "var(--accent, #29D3FF)", fontSize: 11 }}>
        ◈ Building attacker profile...
      </div>
    );
  }
  if (profile?.error) {
    return <div style={{ color: "var(--red, #E15554)", fontFamily: "var(--mono, monospace)", fontSize: 11, padding: 20 }}>✗ {profile.error}</div>;
  }
  if (!profile) return null;

  return (
    <>
      {profile.model_used && (
        <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 9, color: "var(--text-dim, #5A5A62)", marginBottom: 12 }}>
          model: {profile.model_used}
          {profile.saved_by ? ` · saved by ${profile.saved_by}` : ""}
          {profile.saved_at?.seconds ? ` · ${new Date(profile.saved_at.seconds * 1000).toLocaleString()}` : ""}
        </div>
      )}

      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 16,
        padding: 14, background: "var(--bg3, rgba(255,255,255,0.03))", borderRadius: 10,
        border: "1px solid var(--purple, #8B7CFF)", borderLeft: "3px solid var(--purple, #8B7CFF)",
      }}>
        <img
          src={`https://flagcdn.com/24x18/${profile.geo?.flag?.toLowerCase()}.png`}
          alt=""
          style={{ width: 30, height: 22, borderRadius: 3, flexShrink: 0 }}
          onError={e => e.target.style.display = "none"}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 16, fontWeight: 700, color: "var(--purple, #8B7CFF)" }}>{profile.ip}</div>
          <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 10, color: "var(--text-mid, #9A9AA2)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {profile.geo?.city}, {profile.geo?.country} — {profile.geo?.isp}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{
            fontFamily: "var(--display, inherit)", fontSize: 22, fontWeight: 700,
            color: profile.abuse?.score > 75 ? "var(--red, #E15554)" : profile.abuse?.score > 25 ? "var(--orange, #F0A857)" : "var(--green, #22D97A)",
          }}>{profile.abuse?.score}%</div>
          <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 7.5, color: "var(--text-dim, #5A5A62)", letterSpacing: 1 }}>ABUSE SCORE</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        {[
          { label: "Total Events", value: profile.stats?.total_events, color: "var(--accent, #29D3FF)" },
          { label: "Alerts", value: profile.stats?.total_alerts, color: "var(--red, #E15554)" },
          { label: "AbuseIPDB Reports", value: profile.abuse?.reports, color: "var(--orange, #F0A857)" },
          { label: "Ports Targeted", value: profile.stats?.ports_targeted?.length, color: "var(--purple, #8B7CFF)" },
        ].map((s, i) => (
          <div key={i} style={{ background: "var(--bg3, rgba(255,255,255,0.03))", border: "1px solid var(--border2, rgba(255,255,255,0.12))", borderRadius: 10, padding: 10, textAlign: "center" }}>
            <div style={{ fontFamily: "var(--display, inherit)", fontSize: 18, fontWeight: 700, color: s.color }}>{s.value ?? "—"}</div>
            <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 7.5, color: "var(--text-dim, #5A5A62)", letterSpacing: 0.6, marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {profile.stats?.signatures?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 9, color: "var(--text-dim, #5A5A62)", letterSpacing: 1.5, marginBottom: 7 }}>ATTACK SIGNATURES</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {profile.stats.signatures.map((sig, i) => (
              <span key={i} style={{ fontFamily: "var(--mono, monospace)", fontSize: 8.5, padding: "3px 9px", borderRadius: 20, background: "var(--red-dim, rgba(225,85,84,0.09))", color: "var(--red, #E15554)", border: "1px solid rgba(225,85,84,0.3)" }}>{sig}</span>
            ))}
          </div>
        </div>
      )}

      {profile.stats?.ports_targeted?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 9, color: "var(--text-dim, #5A5A62)", letterSpacing: 1.5, marginBottom: 7 }}>PORTS TARGETED</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {profile.stats.ports_targeted.map((port, i) => (
              <span key={i} style={{ fontFamily: "var(--mono, monospace)", fontSize: 8.5, padding: "3px 9px", borderRadius: 20, background: "var(--accent-dim, rgba(41,211,255,0.09))", color: "var(--accent, #29D3FF)", border: "1px solid rgba(41,211,255,0.25)" }}>{port}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ background: "var(--bg3, rgba(255,255,255,0.03))", border: "1px solid var(--border2, rgba(255,255,255,0.12))", borderLeft: "2px solid var(--purple, #8B7CFF)", borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 9, color: "var(--purple, #8B7CFF)", letterSpacing: 1.5, marginBottom: 10 }}>◈ SIRA THREAT ACTOR ASSESSMENT</div>
        <div style={{ fontFamily: "var(--sans, sans-serif)", fontSize: 11.5, color: "var(--text-mid, #9A9AA2)", lineHeight: 1.75, whiteSpace: "pre-wrap" }}>{profile.sira_assessment}</div>
      </div>

      {timeline?.timeline?.length > 0 && (
        <div style={{ marginBottom: 16, background: "var(--bg3, rgba(255,255,255,0.03))", border: "1px solid var(--border2, rgba(255,255,255,0.12))", borderRadius: 10, padding: 14 }}>
          <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 9, color: "var(--text-dim, #5A5A62)", letterSpacing: 1.5, marginBottom: 10 }}>
            ⏱ EVENT TIMELINE — {timeline.total_events} TOTAL
          </div>
          <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
            {timeline.timeline.map((e, i) => (
              <div key={i} style={{
                display: "flex", gap: 8, alignItems: "baseline", padding: "5px 7px",
                borderRadius: 6, background: e.event_type === "alert" ? "var(--red-dim, rgba(225,85,84,0.09))" : "rgba(255,255,255,0.02)",
                fontFamily: "var(--mono, monospace)", fontSize: 9.5,
              }}>
                <span style={{ color: "var(--text-dim, #5A5A62)", flexShrink: 0, width: 56 }}>{e.timestamp?.substring(11, 19)}</span>
                <span style={{ color: TYPE_COLOR[e.event_type] || "var(--text-mid, #9A9AA2)", fontWeight: 700, flexShrink: 0, width: 38 }}>{e.event_type?.substring(0, 4).toUpperCase()}</span>
                <span style={{ color: "var(--text-mid, #9A9AA2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.signature || e.query || e.hostname || `${e.src_ip} → ${e.dest_ip}:${e.dest_port}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onRefresh} style={actionBtnStyle("var(--accent, #29D3FF)")}>↻ Refresh Analysis</button>
        <button onClick={() => onAskSira(`Give me a full threat analysis for attacker IP ${profile.ip} including all their attack patterns and recommended response`)} style={actionBtnStyle("var(--purple, #8B7CFF)")}>⬡ Full Analysis</button>
      </div>
    </>
  );
}

/* ==================== What-If window content ==================== */
function WhatIfContent({ whatIf, loading }) {
  if (loading) {
    return <div style={{ textAlign: "center", padding: 40, fontFamily: "var(--mono, monospace)", color: "var(--orange, #F0A857)", fontSize: 11 }}>⚠ SIRA is simulating the attack chain...</div>;
  }
  if (whatIf?.error) {
    return <div style={{ color: "var(--red, #E15554)", fontFamily: "var(--mono, monospace)", fontSize: 11, padding: 20 }}>✗ {whatIf.error}</div>;
  }
  if (!whatIf) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <div style={{ background: "var(--green-dim, rgba(34,217,122,0.08))", border: "1px solid var(--green, #22D97A)", borderRadius: 10, padding: 16 }}>
        <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 9, color: "var(--green, #22D97A)", letterSpacing: 1.5, marginBottom: 10 }}>✓ WHAT ACTUALLY HAPPENED</div>
        <div style={{ fontFamily: "var(--sans, sans-serif)", fontSize: 12, color: "var(--text-mid, #9A9AA2)", lineHeight: 1.8 }}>
          This connection was detected and blocked before it could complete. Suricata flagged the signature and the session was terminated at the perimeter.
        </div>
      </div>
      <div style={{ background: "var(--orange-dim, rgba(240,168,87,0.08))", border: "1px solid var(--orange, #F0A857)", borderRadius: 10, padding: 16 }}>
        <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 9, color: "var(--orange, #F0A857)", letterSpacing: 1.5, marginBottom: 10 }}>⚠ IF IT HADN'T BEEN</div>
        <div style={{ fontFamily: "var(--sans, sans-serif)", fontSize: 12, color: "var(--text-mid, #9A9AA2)", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{whatIf.answer}</div>
      </div>
    </div>
  );
}

const actionBtnStyle = (color) => ({
  flex: 1, padding: "9px", background: `${color}1a`, border: `1px solid ${color}`, borderRadius: 10,
  color, fontFamily: "var(--mono, monospace)", fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8,
  cursor: "pointer", textTransform: "uppercase",
});

/* ==================== Provider — lives once at the app root so both windows
   survive page navigation instead of unmounting with whatever page opened them ==================== */
export function FloatingAnalysisProvider({ onAskSira, children }) {
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileIp, setProfileIp] = useState(null);
  const [profileModel, setProfileModel] = useState("ollama");
  const [timeline, setTimeline] = useState(null);

  const [whatIf, setWhatIf] = useState(null);
  const [whatIfLoading, setWhatIfLoading] = useState(false);

  const [zOrder, setZOrder] = useState(["profile", "whatif"]);
  const bringToFront = useCallback((id) => {
    setZOrder(prev => [...prev.filter(x => x !== id), id]);
  }, []);

  const saveProfileToFirestore = useCallback(async (ip, data, username) => {
    try {
      await setDoc(doc(db, PROFILES_COLLECTION, ip), {
        ...data, saved_at: serverTimestamp(), saved_by: username,
      }, { merge: true });
    } catch {
      // Non-fatal -- the live profile view already succeeded regardless.
    }
  }, []);

  const openProfile = useCallback(async (ip, model, username) => {
    bringToFront("profile");
    setProfileIp(ip);
    setProfileModel(model);
    setProfileLoading(true); setProfile(null); setTimeline(null);
    try {
      const res = await fetch(`${FLASK_URL}/attacker-profile/${ip}?model=${model}`);
      const data = await res.json();
      setProfile(data);
      if (data && !data.error) saveProfileToFirestore(ip, data, username);
    } catch {
      setProfile({ error: "Failed to load profile" });
    }
    setProfileLoading(false);
    try { const tRes = await fetch(`${FLASK_URL}/attacker-timeline/${ip}`); setTimeline(await tRes.json()); }
    catch { setTimeline(null); }
  }, [bringToFront, saveProfileToFirestore]);

  const openSavedProfile = useCallback(async (saved) => {
    bringToFront("profile");
    setProfileIp(saved.ip);
    setProfile(saved);
    setProfileLoading(false);
    setTimeline(null);
    try { const tRes = await fetch(`${FLASK_URL}/attacker-timeline/${saved.ip}`); setTimeline(await tRes.json()); }
    catch { setTimeline(null); }
  }, [bringToFront]);

  const closeProfile = useCallback(() => {
    setProfile(null); setProfileIp(null); setTimeline(null); setProfileLoading(false);
  }, []);

  const refreshProfile = useCallback((username) => {
    if (profileIp) openProfile(profileIp, profileModel, username);
  }, [profileIp, profileModel, openProfile]);

  const openWhatIf = useCallback(async (log, model) => {
    bringToFront("whatif");
    setWhatIfLoading(true); setWhatIf(null);
    try {
      const res = await fetch(`${FLASK_URL}/what-if`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: log.alert.signature, src_ip: log.src_ip, dest_ip: log.dest_ip, model }),
      });
      setWhatIf(await res.json());
    } catch {
      setWhatIf({ error: "Failed to load" });
    }
    setWhatIfLoading(false);
  }, [bringToFront]);

  const closeWhatIf = useCallback(() => {
    setWhatIf(null); setWhatIfLoading(false);
  }, []);

  const value = useMemo(() => ({
    profile, profileLoading, profileIp, timeline,
    openProfile, openSavedProfile, closeProfile, refreshProfile,
    whatIf, whatIfLoading, openWhatIf, closeWhatIf,
  }), [profile, profileLoading, profileIp, timeline, openProfile, openSavedProfile,
      closeProfile, refreshProfile, whatIf, whatIfLoading, openWhatIf, closeWhatIf]);

  const zIndexOf = (id) => 1000 + zOrder.indexOf(id);

  return (
    <FloatingAnalysisContext.Provider value={value}>
      {children}
      {typeof document !== "undefined" && createPortal(
        <>
          {(profile || profileLoading) && (
            <FloatingWindow
              id="profile"
              title={`◈ ATTACKER PROFILE — ${profile?.ip || profileIp || "..."}`}
              titleColor="var(--purple, #8B7CFF)"
              defaultPos={{ x: Math.max(20, window.innerWidth - 500), y: 70 }}
              defaultSize={{ w: 460, h: 620 }}
              zIndex={zIndexOf("profile")}
              onFocus={bringToFront}
              onClose={closeProfile}
            >
              <ProfileContent
                profile={profile}
                loading={profileLoading}
                timeline={timeline}
                onRefresh={() => refreshProfile(localStorage.getItem("username") || "unknown")}
                onAskSira={(q) => onAskSira && onAskSira(q)}
              />
            </FloatingWindow>
          )}
          {(whatIf || whatIfLoading) && (
            <FloatingWindow
              id="whatif"
              title={`⚠ COUNTERFACTUAL — ${whatIf?.signature || "..."}`}
              titleColor="var(--orange, #F0A857)"
              defaultPos={{ x: 60, y: 90 }}
              defaultSize={{ w: 700, h: 460 }}
              zIndex={zIndexOf("whatif")}
              onFocus={bringToFront}
              onClose={closeWhatIf}
            >
              <WhatIfContent whatIf={whatIf} loading={whatIfLoading} />
            </FloatingWindow>
          )}
        </>,
        document.body
      )}
    </FloatingAnalysisContext.Provider>
  );
}