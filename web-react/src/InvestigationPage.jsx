import { useState, useEffect, useRef, memo } from "react";

const FLASK_URL = "https://soc-copilot.onrender.com";
const PAGE_SIZE = 50;

const TYPE_COLOR = {
  alert: "var(--red, #E15554)",
  dns:   "var(--accent, #29D3FF)",
  http:  "var(--green, #22D97A)",
  tls:   "var(--purple, #8B7CFF)",
  flow:  "var(--text-dim, #5A5A62)",
};

const QUICK_ASKS = [
  { label: "Explain this", build: (l) => `Explain this ${l.event_type} event in plain terms: source ${l.src_ip}, destination ${l.dest_ip}, at ${l.timestamp}.${l.alert?.signature ? ` Signature: ${l.alert.signature}.` : ""}` },
  { label: "Is this dangerous?", build: (l) => `On a scale from harmless to critical, how dangerous is this ${l.event_type} event from ${l.src_ip} to ${l.dest_ip}?${l.alert?.signature ? ` Signature: ${l.alert.signature}.` : ""} Give a one-line verdict then a short reason.` },
  { label: "What should I do?", build: (l) => `What immediate action, if any, should I take for this ${l.event_type} event from ${l.src_ip} to ${l.dest_ip}?${l.alert?.signature ? ` Signature: ${l.alert.signature}.` : ""}` },
];

/* ==================== Inline Ask SIRA — quick contextual answer, no page jump ==================== */
function InlineAskSira({ log, onEscalate }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  const ask = async (q) => {
    const finalQ = q || question;
    if (!finalQ.trim()) return;
    setLoading(true);
    setAnswer("");
    try {
      const res = await fetch(`${FLASK_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: finalQ, model: "ollama" }),
      });
      const data = await res.json();
      setAnswer(data.answer || "No answer returned.");
    } catch {
      setAnswer("Could not reach SIRA.");
    }
    setLoading(false);
  };

  // Light-touch section parse — just pulls a risk word out if the backend's
  // structured prompt happens to produce one, so the answer isn't a flat
  // grey wall even in this compact space.
  const riskMatch = /\b(CRITICAL|HIGH|MEDIUM|LOW)\b/i.exec(answer || "");
  const riskColor = riskMatch
    ? { critical: "var(--red, #E15554)", high: "var(--red, #E15554)", medium: "var(--orange, #F0A857)", low: "var(--green, #22D97A)" }[riskMatch[1].toLowerCase()]
    : "var(--accent, #29D3FF)";

  return (
    <div style={askPanelStyle}>
      <div style={askHeaderStyle}>Ask SIRA about this event</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {QUICK_ASKS.map((qa, i) => (
          <button key={i} onClick={() => ask(qa.build(log))} style={quickAskBtnStyle} disabled={loading}>
            {qa.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: answer || loading ? 10 : 0 }}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder="Or type your own question..."
          style={askInputStyle}
        />
        <button onClick={() => ask()} disabled={loading || !question.trim()} style={askSendBtnStyle}>ASK</button>
      </div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent, #29D3FF)", animation: "invAskPulse 1s ease-in-out infinite" }} />
          <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 10, color: "var(--accent, #29D3FF)" }}>SIRA is thinking…</span>
        </div>
      )}

      {answer && !loading && (
        <div style={{ borderLeft: `2px solid ${riskColor}`, paddingLeft: 12 }}>
          <div style={{ fontFamily: "var(--sans, Inter, sans-serif)", fontSize: 12, color: "var(--text-mid, #9A9AA2)", lineHeight: 1.75, whiteSpace: "pre-wrap" }}>
            {answer}
          </div>
          <button onClick={() => onEscalate(question || QUICK_ASKS[0].build(log))} style={escalateBtnStyle}>
            Continue in full chat →
          </button>
        </div>
      )}

      <style>{`@keyframes invAskPulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
    </div>
  );
}

/* ==================== Side inspector — replaces the old centered modal ==================== */
function EventInspector({ log, onClose, onViewProfile, onWhatIf, onAskSira }) {
  return (
    <>
      <div style={inspectorScrimStyle} onClick={onClose} />
      <div style={inspectorPanelStyle}>
        <div style={inspectorHeaderStyle}>
          <div>
            <span style={{ ...typeBadgeStyle, background: `${TYPE_COLOR[log.event_type]}1a`, color: TYPE_COLOR[log.event_type], border: `1px solid ${TYPE_COLOR[log.event_type]}44` }}>
              {log.event_type?.toUpperCase()}
            </span>
            <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 10, color: "var(--text-dim, #5A5A62)", marginTop: 6 }}>{log.timestamp}</div>
          </div>
          <button onClick={onClose} style={inspectorCloseStyle}>✕</button>
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: "16px 20px" }}>
          <div style={kvGridStyle}>
            <div style={kvKeyStyle}>Source</div>
            <div style={{ ...kvValStyle, color: "var(--accent, #29D3FF)" }}>{log.src_ip}:{log.src_port}</div>
            <div style={kvKeyStyle}>Destination</div>
            <div style={kvValStyle}>{log.dest_ip}:{log.dest_port}</div>
            <div style={kvKeyStyle}>Protocol</div>
            <div style={kvValStyle}>{log.proto}</div>
            {log.alert && (
              <>
                <div style={kvKeyStyle}>Signature</div>
                <div style={{ ...kvValStyle, color: "var(--red, #E15554)" }}>{log.alert.signature}</div>
                <div style={kvKeyStyle}>Category</div>
                <div style={kvValStyle}>{log.alert.category}</div>
                <div style={kvKeyStyle}>Severity</div>
                <div style={kvValStyle}>{log.alert.severity}</div>
              </>
            )}
            {log.dns && (
              <>
                <div style={kvKeyStyle}>DNS Query</div>
                <div style={kvValStyle}>{log.dns.rrname}</div>
              </>
            )}
            {log.http && (
              <>
                <div style={kvKeyStyle}>HTTP</div>
                <div style={kvValStyle}>{log.http.http_method} {log.http.hostname}{log.http.url}</div>
              </>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
            {log.src_ip && (
              <button onClick={() => onViewProfile(log.src_ip)} style={inspectorActionBtnStyle("var(--purple, #8B7CFF)")}>
                ◈ Attacker Profile
              </button>
            )}
            {log.alert?.signature && (
              <button onClick={() => onWhatIf(log)} style={inspectorActionBtnStyle("var(--orange, #F0A857)")}>
                ⚠ What If?
              </button>
            )}
          </div>

          <InlineAskSira log={log} onEscalate={onAskSira} />
        </div>
      </div>
    </>
  );
}

/* ==================== Main page ==================== */
export const InvestigationPage = memo(function InvestigationPage({ onAskSira }) {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [viewMode, setViewMode] = useState("raw"); // "raw" | "grouped"
  const [groupedRows, setGroupedRows] = useState([]);
  const [groupedLoading, setGroupedLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [timeline, setTimeline] = useState(null);
  const [whatIf, setWhatIf] = useState(null);
  const [whatIfLoading, setWhatIfLoading] = useState(false);
  const searchDebounce = useRef(null);

  const loadProfile = async (ip) => {
    setProfileLoading(true); setProfile(null); setTimeline(null);
    try { const res = await fetch(`${FLASK_URL}/attacker-profile/${ip}`); setProfile(await res.json()); }
    catch { setProfile({ error: "Failed to load profile" }); }
    setProfileLoading(false);
    // Separate try/catch -- a timeline failure shouldn't take down the
    // whole profile view, which already loaded fine above.
    try { const tRes = await fetch(`${FLASK_URL}/attacker-timeline/${ip}`); setTimeline(await tRes.json()); }
    catch { setTimeline(null); }
  };

  const runWhatIf = async (log) => {
    setSelected(null); setWhatIfLoading(true); setWhatIf(null);
    try {
      const res = await fetch(`${FLASK_URL}/what-if`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: log.alert.signature, src_ip: log.src_ip, dest_ip: log.dest_ip }),
      });
      setWhatIf(await res.json());
    } catch { setWhatIf({ error: "Failed to load" }); }
    setWhatIfLoading(false);
  };

  const fetchPage = (q, pageOffset, append) => {
    if (q) {
      // /search returns a plain array; total count comes back in an
      // X-Total-Count header. Array.isArray guard means a response-shape
      // change degrades to an empty list instead of crashing rows.map().
      fetch(`${FLASK_URL}/search?q=${encodeURIComponent(q)}&offset=${pageOffset}&limit=${PAGE_SIZE}`)
        .then(async r => {
          const headerTotal = parseInt(r.headers.get("X-Total-Count"), 10);
          const body = await r.json();
          const data = Array.isArray(body) ? body : (Array.isArray(body?.results) ? body.results : []);
          return { data, headerTotal, bodyTotal: body?.total };
        })
        .then(({ data, headerTotal, bodyTotal }) => {
          setRows(prev => append ? [...prev, ...data] : data);
          const resolvedTotal = !Number.isNaN(headerTotal) ? headerTotal
            : (typeof bodyTotal === "number" ? bodyTotal : pageOffset + data.length);
          setTotal(resolvedTotal);
          setOffset(pageOffset + data.length);
          setSearching(false); setLoadingMore(false);
        })
        .catch(() => { setSearching(false); setLoadingMore(false); });
    } else {
      const nextLimit = pageOffset + PAGE_SIZE;
      fetch(`${FLASK_URL}/logs?limit=${nextLimit}`)
        .then(r => r.json())
        .then(body => {
          const data = Array.isArray(body) ? body : [];
          setRows(data);
          setTotal(data.length === nextLimit ? nextLimit + 1 : data.length);
          setOffset(data.length);
          setSearching(false); setLoadingMore(false);
        })
        .catch(() => { setSearching(false); setLoadingMore(false); });
    }
  };

  useEffect(() => { fetchPage("", 0, false); }, []); // eslint-disable-line

  useEffect(() => {
    // Was completely missing -- this page fetched once on mount and never
    // again, so it just froze at whatever was loaded the moment it opened
    // while honeypot sync kept pulling real new data in the background
    // every 15s. Matches the 30s interval already used elsewhere in this
    // app (App.js's own log/machine polling) for consistency. Only
    // refreshes when there's no active search and the user hasn't paged
    // past the first page -- an auto-refresh resetting someone's scrolled-
    // in "load more" progress would be more disruptive than the staleness
    // it's fixing.
    const interval = setInterval(() => {
      if (!search.trim() && offset <= PAGE_SIZE) {
        fetchPage("", 0, false);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [search, offset]); // eslint-disable-line

  useEffect(() => {
    clearTimeout(searchDebounce.current);
    setSearching(true);
    searchDebounce.current = setTimeout(() => fetchPage(search.trim(), 0, false), 300);
    return () => clearTimeout(searchDebounce.current);
  }, [search]); // eslint-disable-line

  useEffect(() => {
    if (viewMode !== "grouped") return;
    const refreshGrouped = () => {
      setGroupedLoading(prev => groupedRows.length === 0 ? true : prev); // only show the loading state on the very first fetch, not on background refreshes
      fetch(`${FLASK_URL}/logs/grouped-mitre`)
        .then(r => r.json())
        .then(data => setGroupedRows(Array.isArray(data) ? data : []))
        .catch(() => {})
        .finally(() => setGroupedLoading(false));
    };
    refreshGrouped();
    const interval = setInterval(refreshGrouped, 30000);
    return () => clearInterval(interval);
  }, [viewMode]); // eslint-disable-line

  const loadMore = () => { setLoadingMore(true); fetchPage(search.trim(), offset, true); };
  const hasMore = offset < total;
  const visibleRows = typeFilter === "all" ? rows : rows.filter(r => r.event_type === typeFilter);

  const detailFor = (l) => l.alert?.signature || l.dns?.rrname || l.http?.hostname || "—";

  return (
    <div style={pageWrapStyle}>
      <div style={{ marginBottom: 18 }}>
        <div style={pageTitleStyle}>Investigation</div>
        <div style={pageSubStyle}>LOG CONSOLE — SEARCH, FILTER, INSPECT</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="query: IP, signature, hostname..."
          style={consoleSearchStyle}
        />
        {searching && <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 9, color: "var(--accent, #29D3FF)", alignSelf: "center", letterSpacing: 1 }}>◈ SEARCHING</span>}
        <button
          onClick={() => {
            // Mirrors exactly what's currently filtered on screen -- same
            // search text and type filter, not a separate "export everything"
            // path that could silently diverge from what the analyst sees.
            const params = new URLSearchParams();
            if (search.trim()) params.set("q", search.trim());
            if (typeFilter !== "all") params.set("type", typeFilter);
            window.open(`${FLASK_URL}/export?${params.toString()}`, "_blank");
          }}
          style={{
            padding: "0 14px", background: "var(--bg3, rgba(255,255,255,0.03))",
            border: "1px solid var(--border2, rgba(255,255,255,0.08))", borderRadius: 10,
            color: "var(--text-mid, #8FA3B5)", cursor: "pointer",
            fontFamily: "var(--mono, monospace)", fontSize: 10, letterSpacing: 1, flexShrink: 0,
          }}
        >⬇ EXPORT CSV</button>
      </div>

      <div style={{ display: "flex", gap: 5, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {["all", "alert", "dns", "http", "tls", "flow"].map(f => (
          <button key={f} onClick={() => setTypeFilter(f)} style={filterChipStyle(f === typeFilter)}>{f}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setViewMode(v => v === "raw" ? "grouped" : "raw")}
          style={{
            padding: "0 12px", height: 26, background: viewMode === "grouped" ? "var(--accent-dim, rgba(41,211,255,0.12))" : "var(--bg3, rgba(255,255,255,0.03))",
            border: `1px solid ${viewMode === "grouped" ? "var(--accent, #29D3FF)" : "var(--border2, rgba(255,255,255,0.08))"}`, borderRadius: 8,
            color: viewMode === "grouped" ? "var(--accent, #29D3FF)" : "var(--text-mid, #8FA3B5)", cursor: "pointer",
            fontFamily: "var(--mono, monospace)", fontSize: 9, letterSpacing: 1,
          }}
        >{viewMode === "raw" ? "☰ RAW LOGS" : "⊞ GROUPED + MITRE"}</button>
      </div>

      <div style={consoleFrameStyle}>
        {viewMode === "grouped" ? (
          <>
            <div style={consoleHeaderRowStyle}>
              <span style={{ width: 60 }}>COUNT</span>
              <span style={{ width: 150 }}>SOURCE</span>
              <span style={{ width: 150 }}>DEST</span>
              <span style={{ width: 110 }}>MITRE</span>
              <span style={{ flex: 1 }}>SIGNATURE</span>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {groupedLoading && (
                <div style={{ textAlign: "center", padding: 30, color: "var(--text-dim, #5A5A62)", fontFamily: "var(--mono, monospace)", fontSize: 10 }}>Loading grouped alerts...</div>
              )}
              {!groupedLoading && groupedRows.map((g, i) => (
                <div key={i} style={consoleRowStyle}>
                  <span style={{ width: 60, color: "var(--accent, #29D3FF)", fontWeight: 700 }}>×{g.count}</span>
                  <span style={{ width: 150, color: "var(--accent, #29D3FF)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.src_ip}</span>
                  <span style={{ width: 150, color: "var(--text-mid, #9A9AA2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.dest_ip}</span>
                  <span style={{ width: 110, color: g.mitre ? "var(--orange, #F0A857)" : "var(--text-dim, #5A5A62)", fontSize: 9 }}>
                    {g.mitre ? g.mitre.technique_id : "—"}
                  </span>
                  <span style={{ flex: 1, color: "var(--text-dim, #5A5A62)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.signature}</span>
                </div>
              ))}
              {!groupedLoading && groupedRows.length === 0 && (
                <div style={{ textAlign: "center", padding: 30, color: "var(--text-dim, #5A5A62)", fontFamily: "var(--mono, monospace)", fontSize: 10 }}>No alerts to group yet</div>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={consoleHeaderRowStyle}>
              <span style={{ width: 54 }}>TYPE</span>
              <span style={{ width: 74 }}>TIME</span>
              <span style={{ width: 150 }}>SOURCE</span>
              <span style={{ width: 150 }}>DEST</span>
              <span style={{ flex: 1 }}>DETAIL</span>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {visibleRows.map((l, i) => (
                <div key={i} onClick={() => setSelected(l)} style={consoleRowStyle}>
                  <span style={{ width: 54, color: TYPE_COLOR[l.event_type], fontWeight: 700 }}>{l.event_type?.substring(0, 4).toUpperCase()}</span>
                  <span style={{ width: 74, color: "var(--text-dim, #5A5A62)" }}>{l.timestamp?.substring(11, 19)}</span>
                  <span style={{ width: 150, color: "var(--accent, #29D3FF)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.src_ip}</span>
                  <span style={{ width: 150, color: "var(--text-mid, #9A9AA2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.dest_ip}</span>
                  <span style={{ flex: 1, color: "var(--text-dim, #5A5A62)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detailFor(l)}</span>
                </div>
              ))}
              {visibleRows.length === 0 && !searching && (
                <div style={{ textAlign: "center", padding: 30, color: "var(--text-dim, #5A5A62)", fontFamily: "var(--mono, monospace)", fontSize: 10 }}>
                  {search.trim() ? "No matching events found" : "No events loaded"}
                </div>
              )}
            </div>
            {hasMore && rows.length > 0 && (
              <button onClick={loadMore} disabled={loadingMore} style={loadMoreBtnStyle}>
                {loadingMore ? "LOADING..." : `LOAD MORE (${rows.length} of ${total})`}
              </button>
            )}
          </>
        )}
      </div>

      {selected && (
        <EventInspector
          log={selected}
          onClose={() => setSelected(null)}
          onViewProfile={(ip) => { loadProfile(ip); setSelected(null); }}
          onWhatIf={runWhatIf}
          onAskSira={(q) => { setSelected(null); onAskSira(q); }}
        />
      )}

      {(profile || profileLoading) && (
        <div className="modal-overlay" onClick={() => setProfile(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 680 }}>
            <button className="modal-close" onClick={() => setProfile(null)}>✕</button>
            {profileLoading && <div style={{ textAlign: "center", padding: 40, fontFamily: "var(--mono)", color: "var(--accent)" }}>◈ Building attacker profile...</div>}
            {profile && !profile.error && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, padding: "16px", background: "var(--bg3)", borderRadius: 12, border: "1px solid var(--purple)", borderLeft: "3px solid var(--purple)" }}>
                  <img src={`https://flagcdn.com/24x18/${profile.geo.flag?.toLowerCase()}.png`} alt="" style={{ width: 36, height: 27, borderRadius: 3 }} onError={e => e.target.style.display = 'none'} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 700, color: "var(--purple)" }}>{profile.ip}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mid)", marginTop: 4 }}>{profile.geo.city}, {profile.geo.country} — {profile.geo.isp}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "var(--display)", fontSize: 28, fontWeight: 700, color: profile.abuse.score > 75 ? "var(--red)" : profile.abuse.score > 25 ? "var(--orange)" : "var(--green)" }}>{profile.abuse.score}%</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 8, color: "var(--text-dim)", letterSpacing: 1.5 }}>ABUSE SCORE</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
                  {[{ label: "Total Events", value: profile.stats.total_events, color: "var(--accent)" }, { label: "Alerts", value: profile.stats.total_alerts, color: "var(--red)" }, { label: "AbuseIPDB Reports", value: profile.abuse.reports, color: "var(--orange)" }, { label: "Ports Targeted", value: profile.stats.ports_targeted.length, color: "var(--purple)" }].map((s, i) => (
                    <div key={i} style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 10, padding: "12px", textAlign: "center" }}>
                      <div style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 8, color: "var(--text-dim)", letterSpacing: 1, marginTop: 4 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                {profile.stats.signatures.length > 0 && <div style={{ marginBottom: 16 }}><div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-dim)", letterSpacing: 1.5, marginBottom: 8 }}>ATTACK SIGNATURES USED</div><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{profile.stats.signatures.map((sig, i) => (<span key={i} style={{ fontFamily: "var(--mono)", fontSize: 9, padding: "4px 10px", borderRadius: 20, background: "var(--red-dim)", color: "var(--red)", border: "1px solid rgba(225,85,84,0.3)" }}>{sig}</span>))}</div></div>}
                {profile.stats.ports_targeted.length > 0 && <div style={{ marginBottom: 16 }}><div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-dim)", letterSpacing: 1.5, marginBottom: 8 }}>PORTS TARGETED</div><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{profile.stats.ports_targeted.map((port, i) => (<span key={i} style={{ fontFamily: "var(--mono)", fontSize: 9, padding: "4px 10px", borderRadius: 20, background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid rgba(41,211,255,0.25)" }}>{port}</span>))}</div></div>}
                <div style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderLeft: "2px solid var(--purple)", borderRadius: 10, padding: 16 }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--purple)", letterSpacing: 1.5, marginBottom: 12 }}>◈ SIRA THREAT ACTOR ASSESSMENT</div>
                  <div style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--text-mid)", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{profile.sira_assessment}</div>
                </div>

                {timeline && timeline.timeline && timeline.timeline.length > 0 && (
                  <div style={{ marginTop: 16, background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 10, padding: 16 }}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-dim)", letterSpacing: 1.5, marginBottom: 12 }}>
                      ⏱ EVENT TIMELINE — {timeline.total_events} TOTAL EVENTS
                    </div>
                    <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                      {timeline.timeline.map((e, i) => (
                        <div key={i} style={{
                          display: "flex", gap: 10, alignItems: "baseline", padding: "6px 8px",
                          borderRadius: 6, background: e.event_type === "alert" ? "var(--red-dim)" : "rgba(255,255,255,0.02)",
                          fontFamily: "var(--mono)", fontSize: 10,
                        }}>
                          <span style={{ color: "var(--text-dim)", flexShrink: 0, width: 62 }}>{e.timestamp?.substring(11, 19)}</span>
                          <span style={{ color: TYPE_COLOR[e.event_type] || "var(--text-mid)", fontWeight: 700, flexShrink: 0, width: 44 }}>{e.event_type?.substring(0, 4).toUpperCase()}</span>
                          <span style={{ color: "var(--text-mid)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {e.signature || e.query || e.hostname || `${e.src_ip} → ${e.dest_ip}:${e.dest_port}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <button className="ask-sira-btn" style={{ marginTop: 16 }} onClick={() => { onAskSira(`Give me a full threat analysis for attacker IP ${profile.ip} including all their attack patterns and recommended response`); setProfile(null); }}>⬡ ASK SIRA FOR FULL ANALYSIS</button>
              </>
            )}
            {profile?.error && <div style={{ color: "var(--red)", fontFamily: "var(--mono)", fontSize: 12, padding: 20 }}>✗ {profile.error}</div>}
          </div>
        </div>
      )}

      {(whatIf || whatIfLoading) && (
        <div className="modal-overlay" onClick={() => { setWhatIf(null); setWhatIfLoading(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 720 }}>
            <button className="modal-close" onClick={() => { setWhatIf(null); setWhatIfLoading(false); }}>✕</button>
            <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--orange)", letterSpacing: 2, marginBottom: 4 }}>⚠ COUNTERFACTUAL</div>
            <div className="modal-title">The Divergence Point</div>
            <div className="modal-sub">{whatIf?.signature}</div>
            {whatIfLoading && <div style={{ textAlign: "center", padding: 40, fontFamily: "var(--mono)", color: "var(--orange)" }}>⚠ SIRA is simulating the attack chain...</div>}
            {whatIf && !whatIfLoading && !whatIf.error && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 8 }}>
                <div style={{ background: "var(--green-dim)", border: "1px solid var(--green)", borderRadius: 10, padding: 16 }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--green)", letterSpacing: 1.5, marginBottom: 10 }}>✓ WHAT ACTUALLY HAPPENED</div>
                  <div style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--text-mid)", lineHeight: 1.8 }}>
                    This connection was detected and blocked before it could complete. Suricata flagged the signature and the session was terminated at the perimeter.
                  </div>
                </div>
                <div style={{ background: "var(--orange-dim)", border: "1px solid var(--orange)", borderRadius: 10, padding: 16 }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--orange)", letterSpacing: 1.5, marginBottom: 10 }}>⚠ IF IT HADN'T BEEN</div>
                  <div style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--text-mid)", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{whatIf.answer}</div>
                </div>
              </div>
            )}
            {whatIf?.error && <div style={{ color: "var(--red)", fontFamily: "var(--mono)", fontSize: 12, padding: 20 }}>✗ {whatIf.error}</div>}
          </div>
        </div>
      )}
    </div>
  );
});

/* ==================== styles ==================== */

const pageWrapStyle = { flex: 1, overflowY: "auto", padding: 28, background: "transparent" };
const pageTitleStyle = { fontFamily: "var(--display, inherit)", fontSize: 21, fontWeight: 700, color: "var(--text, #F2F2F4)", marginBottom: 5 };
const pageSubStyle = { fontFamily: "var(--mono, monospace)", fontSize: 10, color: "var(--text-mid, #9A9AA2)", letterSpacing: 2 };

const consoleSearchStyle = {
  flex: 1, background: "var(--bg3, rgba(255,255,255,0.03))", border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  borderRadius: 10, padding: "11px 16px", color: "var(--text, #F2F2F4)", fontFamily: "var(--mono, monospace)",
  fontSize: 12, outline: "none",
};

const filterChipStyle = (active) => ({
  fontFamily: "var(--mono, monospace)", fontSize: 8, letterSpacing: 1, textTransform: "uppercase",
  padding: "5px 12px", borderRadius: 20, cursor: "pointer",
  background: active ? "var(--accent, #29D3FF)" : "var(--bg3, rgba(255,255,255,0.03))",
  color: active ? "var(--bg, #0A0A0C)" : "var(--text-dim, #5A5A62)",
  border: active ? "1px solid var(--accent, #29D3FF)" : "1px solid var(--border2, rgba(255,255,255,0.12))",
});

const consoleFrameStyle = {
  display: "flex", flexDirection: "column", border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  borderRadius: "var(--radius, 18px)", background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
  overflow: "hidden", maxHeight: "60vh",
};

const consoleHeaderRowStyle = {
  display: "flex", gap: 10, padding: "9px 16px", fontFamily: "var(--mono, monospace)", fontSize: 8.5,
  letterSpacing: 1.5, color: "var(--text-dim, #5A5A62)", borderBottom: "1px solid var(--border2, rgba(255,255,255,0.12))",
  background: "var(--bg3, rgba(255,255,255,0.03))", flexShrink: 0,
};

const consoleRowStyle = {
  display: "flex", gap: 10, padding: "8px 16px", fontFamily: "var(--mono, monospace)", fontSize: 10.5,
  borderBottom: "1px solid var(--border, rgba(255,255,255,0.06))", cursor: "pointer", alignItems: "center",
};

const loadMoreBtnStyle = {
  width: "100%", padding: "10px", background: "var(--bg3, rgba(255,255,255,0.03))", border: "none",
  borderTop: "1px solid var(--border2, rgba(255,255,255,0.12))", color: "var(--accent, #29D3FF)",
  fontFamily: "var(--mono, monospace)", fontSize: 9.5, letterSpacing: 1, cursor: "pointer", textTransform: "uppercase", flexShrink: 0,
};

const typeBadgeStyle = { fontFamily: "var(--mono, monospace)", fontSize: 9, fontWeight: 700, padding: "3px 9px", borderRadius: 20, letterSpacing: 0.5 };

const inspectorScrimStyle = {
  position: "fixed", inset: 0, zIndex: 90,
  background: "rgba(4,6,10,0.4)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
};
const inspectorPanelStyle = {
  position: "fixed", top: 10, right: 10, bottom: 10, width: 420, maxWidth: "calc(100vw - 20px)", zIndex: 91,
  background: "linear-gradient(180deg, rgba(20,20,24,0.97), rgba(14,14,17,0.98))",
  backdropFilter: "blur(24px) saturate(150%)", WebkitBackdropFilter: "blur(24px) saturate(150%)",
  border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  borderRadius: "var(--radius, 18px)",
  boxShadow: "0 1px 0 rgba(255,255,255,0.06) inset, 0 24px 60px -20px rgba(0,0,0,0.6)",
  display: "flex", flexDirection: "column", overflow: "hidden",
};

const inspectorHeaderStyle = {
  display: "flex", justifyContent: "space-between", alignItems: "flex-start",
  padding: "18px 20px 14px", borderBottom: "1px solid var(--border, rgba(255,255,255,0.06))", flexShrink: 0,
};

const inspectorCloseStyle = {
  background: "rgba(255,255,255,0.06)", border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  borderRadius: 8, width: 28, height: 28, color: "var(--text-dim, #5A5A62)", cursor: "pointer", fontSize: 13,
};

const kvGridStyle = { display: "grid", gridTemplateColumns: "110px 1fr", rowGap: 10, columnGap: 8 };
const kvKeyStyle = { fontFamily: "var(--mono, monospace)", fontSize: 10, color: "var(--text-dim, #5A5A62)" };
const kvValStyle = { fontFamily: "var(--mono, monospace)", fontSize: 11, color: "var(--text, #F2F2F4)", fontWeight: 600, wordBreak: "break-word" };

const inspectorActionBtnStyle = (color) => ({
  flex: 1, padding: "9px", background: `${color}1a`, border: `1px solid ${color}`, borderRadius: 10,
  color, fontFamily: "var(--mono, monospace)", fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8,
  cursor: "pointer", textTransform: "uppercase",
});

const askPanelStyle = {
  marginTop: 4, paddingTop: 16, borderTop: "1px solid var(--border, rgba(255,255,255,0.06))",
};
const askHeaderStyle = { fontFamily: "var(--mono, monospace)", fontSize: 9, letterSpacing: 1.5, color: "var(--purple, #8B7CFF)", textTransform: "uppercase", marginBottom: 10 };
const quickAskBtnStyle = {
  fontFamily: "var(--mono, monospace)", fontSize: 8.5, padding: "5px 11px", borderRadius: 20,
  border: "1px solid rgba(139,124,255,0.3)", background: "var(--purple-dim, rgba(139,124,255,0.09))",
  color: "var(--purple, #8B7CFF)", cursor: "pointer",
};
const askInputStyle = {
  flex: 1, background: "var(--bg3, rgba(255,255,255,0.03))", border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  borderRadius: 8, padding: "8px 12px", color: "var(--text, #F2F2F4)", fontFamily: "var(--mono, monospace)", fontSize: 10.5, outline: "none",
};
const askSendBtnStyle = {
  padding: "8px 16px", background: "linear-gradient(135deg, var(--accent, #29D3FF), var(--purple, #8B7CFF))",
  border: "none", borderRadius: 8, color: "#060608", fontFamily: "var(--mono, monospace)", fontSize: 9, fontWeight: 700,
  letterSpacing: 0.5, cursor: "pointer",
};
const escalateBtnStyle = {
  marginTop: 10, background: "none", border: "none", color: "var(--accent, #29D3FF)",
  fontFamily: "var(--mono, monospace)", fontSize: 9.5, letterSpacing: 0.5, cursor: "pointer", padding: 0,
};