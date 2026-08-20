import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase"; // adjust path if this file isn't in src/ root — same import App.js/History.js use

const BACKEND_BASE = "http://localhost:5000";
/* ==================== Icons ==================== */

const Icon = {
  Save: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>),
  Check: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>),
  Pdf: () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>),
  Mail: () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></svg>),
  Trash: () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>),
  Edit: () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>),
  Search: () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>),
  Doc: () => (<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>),
  X: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>),
};

/* ==================== Save Button ==================== */

export function SaveToDocumentButton({ username, content, sourceQuery = "", defaultTitle = "" }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!username) {
      setError("Not logged in");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const title =
        defaultTitle ||
        (sourceQuery ? sourceQuery.slice(0, 60) : "Hermes Investigation " + new Date().toLocaleString());
      await addDoc(collection(db, "hermes_documents"), {
        username,
        title,
        content,
        source_query: sourceQuery,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button onClick={handleSave} disabled={saving} style={saveBtnStyle(saving, saved)} title={error || "Save this response as a document"}>
      {saved ? <Icon.Check /> : <Icon.Save />}
      {saving ? "Saving..." : saved ? "Saved" : "Save as Document"}
    </button>
  );
}

/* ==================== Report rendering ==================== */

const SECTION_NAMES = [
  "SUMMARY",
  "TOP THREATS",
  "ENDPOINT SECURITY",
  "RISK LEVEL",
  "CVE IMPACT",
  "RECOMMENDED ACTIONS",
];

/** Split a Hermes report into its labelled sections. Returns null when the
 *  text doesn't use the expected headings, so plain content still renders. */
function parseReport(text) {
  if (!text) return null;
  const found = SECTION_NAMES.map((name) => ({ name, idx: text.indexOf(name) })).filter((s) => s.idx !== -1);
  if (found.length === 0) return null;
  found.sort((a, b) => a.idx - b.idx);

  const sections = [];
  const preamble = text.slice(0, found[0].idx).trim();
  if (preamble) sections.push({ name: null, body: preamble });

  found.forEach((s, i) => {
    const start = s.idx + s.name.length;
    const end = i + 1 < found.length ? found[i + 1].idx : text.length;
    const body = text.slice(start, end).replace(/^[\s:\-]+/, "").trim();
    if (body) sections.push({ name: s.name, body });
  });
  return sections;
}

function riskFromReport(text) {
  if (!text) return null;
  const risk = /RISK LEVEL[:\s]*\n?\s*\[?\s*(CRITICAL|HIGH|MEDIUM|LOW)/i.exec(text);
  return risk ? risk[1].toUpperCase() : null;
}

const RISK_COLORS = {
  CRITICAL: { fg: "var(--red, #E15554)", bg: "var(--red-dim, rgba(225,85,84,0.09))" },
  HIGH: { fg: "var(--red, #E15554)", bg: "var(--red-dim, rgba(225,85,84,0.09))" },
  MEDIUM: { fg: "var(--orange, #E8B84D)", bg: "var(--orange-dim, rgba(232,184,77,0.09))" },
  LOW: { fg: "var(--green, #22D97A)", bg: "var(--green-dim, rgba(34,217,122,0.09))" },
};

function ReportView({ content }) {
  const sections = useMemo(() => parseReport(content), [content]);

  if (!sections) {
    return <div style={readBodyStyle}>{content}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {sections.map((s, i) => (
        <div key={i}>
          {s.name && <div style={sectionLabelStyle}>{s.name}</div>}
          <div style={readBodyStyle}>{s.body}</div>
        </div>
      ))}
    </div>
  );
}

/* ==================== Full CRUD Panel ==================== */

export function HermesDocumentsPanel({ username }) {
  const [docs, setDocs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailNote, setEmailNote] = useState("");
  const [emailStatus, setEmailStatus] = useState("");

  const loadDocs = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    setError("");
    try {
      const q = query(
        collection(db, "hermes_documents"),
        where("username", "==", username),
        orderBy("updated_at", "desc")
      );
      const snap = await getDocs(q);
      setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  const openDoc = (d) => {
    setSelected(d);
    setEditTitle(d.title);
    setEditContent(d.content);
    setEditing(false);
  };

  const saveEdit = async () => {
    if (!selected) return;
    try {
      await updateDoc(doc(db, "hermes_documents", selected.id), {
        title: editTitle,
        content: editContent,
        updated_at: serverTimestamp(),
      });
      await loadDocs();
      setSelected({ ...selected, title: editTitle, content: editContent });
      setEditing(false);
    } catch (e) {
      setError(e.message);
    }
  };

  const deleteDocById = async (id) => {
    if (!window.confirm("Delete this document? This can't be undone.")) return;
    try {
      await deleteDoc(doc(db, "hermes_documents", id));
      await loadDocs();
      if (selected?.id === id) setSelected(null);
    } catch (e) {
      setError(e.message);
    }
  };

  const exportPdf = async (d) => {
    try {
      const res = await fetch(`${BACKEND_BASE}/api/documents/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: d.title, content: d.content, source_query: d.source_query }),
      });
      if (!res.ok) throw new Error("PDF export failed");
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = window.URL.createObjectURL(blob);
      link.download = `${(d.title || "document").slice(0, 50)}.pdf`;
      link.click();
    } catch (e) {
      setError(e.message + " — is the Flask backend running?");
    }
  };

  const sendEmail = async () => {
    if (!selected) return;
    setEmailStatus("Sending...");
    try {
      const res = await fetch(`${BACKEND_BASE}/api/documents/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: selected.title,
          content: selected.content,
          source_query: selected.source_query,
          to: emailTo,
          message: emailNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      setEmailStatus("Sent ✓");
      setTimeout(() => {
        setEmailModalOpen(false);
        setEmailStatus("");
        setEmailTo("");
        setEmailNote("");
      }, 1200);
    } catch (e) {
      setEmailStatus(`Failed: ${e.message}`);
    }
  };

  const visibleDocs = useMemo(() => {
    if (!filter.trim()) return docs;
    const f = filter.toLowerCase();
    return docs.filter(
      (d) => (d.title || "").toLowerCase().includes(f) || (d.content || "").toLowerCase().includes(f)
    );
  }, [docs, filter]);

  const selectedRisk = selected ? riskFromReport(selected.content) : null;

  const fmtDate = (ts) => (ts?.toDate ? ts.toDate().toLocaleString() : "");
  const preview = (text) => (text || "").replace(/\s+/g, " ").slice(0, 90);

  return (
    <div style={panelStyle}>
      {/* ---------- List column ---------- */}
      <div style={listColStyle}>
        <div style={listHeaderStyle}>
          <div>
            <div style={panelTitleStyle}>Saved Documents</div>
            <div style={panelSubtitleStyle}>
              {loading ? "Loading..." : `${docs.length} saved investigation${docs.length === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>

        {docs.length > 0 && (
          <div style={searchWrapStyle}>
            <span style={{ color: "var(--text-dim, #5A5A62)", display: "flex" }}><Icon.Search /></span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter documents..."
              style={searchInputStyle}
            />
          </div>
        )}

        <div style={listScrollStyle}>
          {docs.length === 0 && !loading && (
            <div style={emptyStateStyle}>
              <span style={{ color: "var(--text-dim, #5A5A62)" }}><Icon.Doc /></span>
              <div style={{ fontSize: 12.5, marginTop: 10 }}>No documents saved yet</div>
              <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4, lineHeight: 1.5 }}>
                Run a Hermes investigation and choose "Save as Document" to keep it here.
              </div>
            </div>
          )}

          {visibleDocs.length === 0 && docs.length > 0 && (
            <div style={{ ...emptyStateStyle, paddingTop: 30 }}>
              <div style={{ fontSize: 12 }}>No documents match "{filter}"</div>
            </div>
          )}

          {visibleDocs.map((d) => {
            const risk = riskFromReport(d.content);
            const active = selected?.id === d.id;
            return (
              <div key={d.id} onClick={() => openDoc(d)} style={docItemStyle(active)}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={docTitleStyle}>{d.title}</div>
                    <div style={docPreviewStyle}>{preview(d.content)}</div>
                  </div>
                  {risk && (
                    <span style={riskPillStyle(risk, true)}>{risk}</span>
                  )}
                </div>
                <div style={docMetaStyle}>{fmtDate(d.updated_at)}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button onClick={(e) => { e.stopPropagation(); exportPdf(d); }} style={miniBtnStyle} title="Export as PDF">
                    <Icon.Pdf /> PDF
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); openDoc(d); setEmailModalOpen(true); }}
                    style={miniBtnStyle}
                    title="Send by email"
                  >
                    <Icon.Mail /> Email
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteDocById(d.id); }}
                    style={{ ...miniBtnStyle, color: "var(--red, #E15554)", borderColor: "rgba(225,85,84,0.3)" }}
                    title="Delete document"
                  >
                    <Icon.Trash />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------- Editor / reader column ---------- */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {error && <div style={errorBannerStyle}>{error}</div>}

        {!selected ? (
          <div style={{ ...emptyStateStyle, margin: "auto" }}>
            <span style={{ color: "var(--text-dim, #5A5A62)" }}><Icon.Doc /></span>
            <div style={{ fontSize: 13, marginTop: 10 }}>Select a document to view or edit</div>
          </div>
        ) : (
          <>
            {/* Document header */}
            <div style={docHeaderStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {editing ? (
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={titleInputStyle} />
                ) : (
                  <div style={docHeaderTitleStyle}>{selected.title}</div>
                )}
                <div style={docHeaderMetaStyle}>
                  <span>{fmtDate(selected.updated_at)}</span>
                  {selected.source_query && (
                    <>
                      <span style={{ opacity: 0.4 }}>·</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {selected.source_query}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {selectedRisk && <span style={riskPillStyle(selectedRisk, false)}>{selectedRisk} RISK</span>}
            </div>

            {/* Toolbar */}
            <div style={toolbarStyle}>
              {!editing ? (
                <>
                  <button onClick={() => setEditing(true)} style={toolBtnStyle}><Icon.Edit /> Edit</button>
                  <button onClick={() => exportPdf(selected)} style={toolBtnStyle}><Icon.Pdf /> Export PDF</button>
                  <button onClick={() => setEmailModalOpen(true)} style={toolBtnStyle}><Icon.Mail /> Email</button>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={() => deleteDocById(selected.id)}
                    style={{ ...toolBtnStyle, color: "var(--red, #E15554)", borderColor: "rgba(225,85,84,0.3)" }}
                  >
                    <Icon.Trash /> Delete
                  </button>
                </>
              ) : (
                <>
                  <button onClick={saveEdit} style={primaryBtnStyle}><Icon.Check /> Save Changes</button>
                  <button
                    onClick={() => { setEditing(false); setEditTitle(selected.title); setEditContent(selected.content); }}
                    style={toolBtnStyle}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>

            {/* Body */}
            <div style={docBodyWrapStyle}>
              {editing ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  style={editTextareaStyle}
                />
              ) : (
                <ReportView content={selected.content} />
              )}
            </div>
          </>
        )}
      </div>

      {/* ---------- Email modal ---------- */}
      {emailModalOpen && selected && (
        <div style={modalOverlayStyle} onClick={() => setEmailModalOpen(false)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
              <div>
                <div style={modalTitleStyle}>Send Document</div>
                <div style={modalSubtitleStyle}>{selected.title}</div>
              </div>
              <button onClick={() => setEmailModalOpen(false)} style={modalCloseStyle}><Icon.X /></button>
            </div>

            <div style={{ marginTop: 18 }}>
              <label style={fieldLabelStyle}>RECIPIENT</label>
              <input
                placeholder="recipient@example.com"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={fieldLabelStyle}>MESSAGE (OPTIONAL)</label>
              <textarea
                placeholder="Add a short note for the recipient..."
                value={emailNote}
                onChange={(e) => setEmailNote(e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--sans, Inter, sans-serif)" }}
              />
            </div>

            <div style={{ marginTop: 18, display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={sendEmail} disabled={!emailTo.trim()} style={{ ...primaryBtnStyle, opacity: emailTo.trim() ? 1 : 0.4 }}>
                <Icon.Mail /> Send
              </button>
              <button onClick={() => setEmailModalOpen(false)} style={toolBtnStyle}>Cancel</button>
              {emailStatus && (
                <span style={{ fontSize: 11.5, fontFamily: "var(--mono, monospace)", color: emailStatus.startsWith("Failed") ? "var(--red, #E15554)" : "var(--green, #22D97A)" }}>
                  {emailStatus}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==================== styles ==================== */

const saveBtnStyle = (saving, saved) => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  background: saved
    ? "var(--green-dim, rgba(34,217,122,0.09))"
    : "linear-gradient(135deg, var(--accent, #4DD8E8), var(--purple, #8B7CFF))",
  border: saved ? "1px solid var(--green, #22D97A)" : "none",
  color: saved ? "var(--green, #22D97A)" : "#060608",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12,
  fontWeight: 700,
  fontFamily: "var(--sans, Inter, sans-serif)",
  cursor: saving ? "default" : "pointer",
  opacity: saving ? 0.6 : 1,
  transition: "all 0.15s",
});

const panelStyle = {
  background: "transparent",
  color: "var(--text, #F2F2F4)",
  fontFamily: "var(--sans, Inter, sans-serif)",
  display: "flex",
  gap: 16,
  minHeight: 400,
  height: "100%",
};

const listColStyle = {
  width: 300,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  background: "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015))",
  backdropFilter: "blur(20px) saturate(150%)",
  WebkitBackdropFilter: "blur(20px) saturate(150%)",
  border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  borderRadius: "var(--radius, 18px)",
  overflow: "hidden",
};

const listHeaderStyle = { padding: "18px 18px 12px" };

const panelTitleStyle = {
  fontSize: 15,
  fontWeight: 700,
  color: "var(--text, #F2F2F4)",
};

const panelSubtitleStyle = {
  fontSize: 11,
  color: "var(--text-mid, #9A9AA2)",
  marginTop: 3,
};

const searchWrapStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  margin: "0 18px 12px",
  padding: "7px 10px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  borderRadius: 8,
};

const searchInputStyle = {
  flex: 1,
  background: "transparent",
  border: "none",
  outline: "none",
  color: "var(--text, #F2F2F4)",
  fontSize: 12,
  fontFamily: "var(--sans, Inter, sans-serif)",
};

const listScrollStyle = { flex: 1, overflowY: "auto", padding: "0 12px 12px" };

const emptyStateStyle = {
  textAlign: "center",
  padding: "40px 20px",
  color: "var(--text-mid, #9A9AA2)",
};

const docItemStyle = (active) => ({
  padding: "12px 12px 10px",
  marginBottom: 8,
  borderRadius: 10,
  cursor: "pointer",
  background: active ? "var(--accent-dim, rgba(77,216,232,0.08))" : "rgba(255,255,255,0.03)",
  border: active
    ? "1px solid var(--accent, #4DD8E8)"
    : "1px solid var(--border, rgba(255,255,255,0.06))",
  transition: "all 0.15s",
});

const docTitleStyle = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text, #F2F2F4)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const docPreviewStyle = {
  fontSize: 11,
  color: "var(--text-mid, #9A9AA2)",
  marginTop: 4,
  lineHeight: 1.5,
  overflow: "hidden",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
};

const docMetaStyle = {
  fontSize: 10,
  fontFamily: "var(--mono, monospace)",
  color: "var(--text-dim, #5A5A62)",
  marginTop: 6,
};

const riskPillStyle = (risk, small) => {
  const c = RISK_COLORS[risk] || RISK_COLORS.MEDIUM;
  return {
    fontFamily: "var(--mono, monospace)",
    fontSize: small ? 8.5 : 10,
    fontWeight: 700,
    letterSpacing: 0.8,
    padding: small ? "2px 6px" : "5px 12px",
    borderRadius: 20,
    color: c.fg,
    background: c.bg,
    border: `1px solid ${c.fg}33`,
    flexShrink: 0,
    whiteSpace: "nowrap",
  };
};

const docHeaderStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: 14,
  padding: "18px 20px 14px",
  borderBottom: "1px solid var(--border, rgba(255,255,255,0.06))",
};

const docHeaderTitleStyle = {
  fontSize: 17,
  fontWeight: 700,
  color: "var(--text, #F2F2F4)",
  lineHeight: 1.3,
};

const docHeaderMetaStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 11,
  fontFamily: "var(--mono, monospace)",
  color: "var(--text-dim, #5A5A62)",
  marginTop: 6,
};

const toolbarStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "12px 20px",
  borderBottom: "1px solid var(--border, rgba(255,255,255,0.06))",
};

const toolBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  color: "var(--text-mid, #9A9AA2)",
  borderRadius: 8,
  padding: "7px 13px",
  fontSize: 11.5,
  fontWeight: 500,
  fontFamily: "var(--sans, Inter, sans-serif)",
  cursor: "pointer",
  transition: "all 0.15s",
};

const primaryBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "var(--accent, #4DD8E8)",
  border: "none",
  color: "#060608",
  borderRadius: 8,
  padding: "7px 15px",
  fontSize: 11.5,
  fontWeight: 700,
  fontFamily: "var(--sans, Inter, sans-serif)",
  cursor: "pointer",
};

const miniBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "transparent",
  border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  color: "var(--text-mid, #9A9AA2)",
  borderRadius: 6,
  padding: "4px 9px",
  fontSize: 10,
  fontFamily: "var(--mono, monospace)",
  cursor: "pointer",
  transition: "all 0.15s",
};

const docBodyWrapStyle = {
  flex: 1,
  overflowY: "auto",
  padding: "20px",
};

const readBodyStyle = {
  fontSize: 13,
  lineHeight: 1.85,
  color: "var(--text-mid, #9A9AA2)",
  whiteSpace: "pre-wrap",
  fontFamily: "var(--sans, Inter, sans-serif)",
};

const sectionLabelStyle = {
  fontFamily: "var(--mono, monospace)",
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: 2,
  color: "var(--accent, #4DD8E8)",
  marginBottom: 8,
  textTransform: "uppercase",
};

const editTextareaStyle = {
  width: "100%",
  minHeight: 380,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  borderRadius: 10,
  padding: 16,
  color: "var(--text, #F2F2F4)",
  fontSize: 12.5,
  lineHeight: 1.8,
  fontFamily: "var(--mono, monospace)",
  outline: "none",
  resize: "vertical",
  boxSizing: "border-box",
};

const titleInputStyle = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  borderRadius: 8,
  padding: "8px 12px",
  color: "var(--text, #F2F2F4)",
  fontSize: 15,
  fontWeight: 600,
  fontFamily: "var(--sans, Inter, sans-serif)",
  outline: "none",
  boxSizing: "border-box",
};

const inputStyle = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  borderRadius: 8,
  padding: "9px 12px",
  color: "var(--text, #F2F2F4)",
  fontSize: 12.5,
  fontFamily: "var(--mono, monospace)",
  outline: "none",
  boxSizing: "border-box",
};

const fieldLabelStyle = {
  display: "block",
  fontFamily: "var(--mono, monospace)",
  fontSize: 9.5,
  letterSpacing: 1.4,
  color: "var(--text-dim, #5A5A62)",
  marginBottom: 7,
};

const errorBannerStyle = {
  margin: "0 0 12px",
  padding: "10px 14px",
  background: "var(--red-dim, rgba(225,85,84,0.09))",
  border: "1px solid rgba(225,85,84,0.3)",
  borderRadius: 8,
  color: "var(--red, #E15554)",
  fontSize: 11.5,
  fontFamily: "var(--mono, monospace)",
};

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(4,6,10,0.7)",
  backdropFilter: "blur(4px)",
  zIndex: 200,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const modalStyle = {
  background: "linear-gradient(180deg, rgba(30,30,34,0.95), rgba(20,20,24,0.95))",
  backdropFilter: "blur(28px) saturate(160%)",
  WebkitBackdropFilter: "blur(28px) saturate(160%)",
  border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  borderRadius: "var(--radius, 18px)",
  padding: 24,
  width: 460,
  maxWidth: "90vw",
  boxShadow: "0 1px 0 rgba(255,255,255,0.06) inset, 0 30px 70px -20px rgba(0,0,0,0.6)",
};

const modalTitleStyle = {
  fontSize: 16,
  fontWeight: 700,
  color: "var(--text, #F2F2F4)",
};

const modalSubtitleStyle = {
  fontSize: 11.5,
  color: "var(--text-mid, #9A9AA2)",
  marginTop: 4,
  maxWidth: 320,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const modalCloseStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid var(--border2, rgba(255,255,255,0.12))",
  borderRadius: 8,
  width: 28,
  height: 28,
  color: "var(--text-dim, #5A5A62)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
