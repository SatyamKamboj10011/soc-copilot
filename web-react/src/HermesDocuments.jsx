import React, { useState, useEffect, useCallback } from "react";
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

/**
 * Hermes Agent Output — Document Manager (Firestore version)
 * -------------------------------------------------------------
 * Drop into src/components/HermesDocuments.jsx (or wherever App.js/History.js live).
 *
 * WHY FIRESTORE: your chat history (soc_sessions / soc_messages) already
 * lives in Firestore, shared automatically across every laptop that logs
 * in with the same Firebase project — so Hermes documents follow the same
 * pattern. Satyam sees the same documents you do, no shared backend needed
 * for CRUD.
 *
 * Collection: "hermes_documents"
 * Fields: username, title, content, source_query, created_at, updated_at
 *
 * PDF export + email still go through the Flask backend (Python libraries
 * can't run in the browser) — but the backend no longer needs to know
 * about Firestore at all. The frontend already has the full document
 * content in memory, so it just POSTs {title, content} straight to the
 * backend for those two actions only.
 *
 * Usage:
 *   <SaveToDocumentButton username={username} content={hermesText} sourceQuery={query} />
 *   <HermesDocumentsPanel username={username} />
 *
 * `username` should be whatever variable App.js/History.js already use
 * when they do where("username","==",username) — pass the same one in.
 */

const BACKEND_BASE = "http://127.0.0.1:5000"; // same host your other fetch() calls in App.js use

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
    <button onClick={handleSave} disabled={saving} style={saveBtnStyle(saving)} title={error || "Save this response as a document"}>
      {saving ? "Saving..." : saved ? "Saved \u2713" : "Save as Document"}
    </button>
  );
}

/* ==================== Full CRUD Panel ==================== */

export function HermesDocumentsPanel({ username }) {
  const [docs, setDocs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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
      setSelected(null);
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
      setEmailStatus("Sent \u2713");
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

  return (
    <div style={panelStyle}>
      {/* List column */}
      <div style={{ width: 260, borderRight: "1px solid #333", paddingRight: 12 }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>Saved Documents</h3>
        {loading && <p style={{ fontSize: 12, opacity: 0.7 }}>Loading...</p>}
        {docs.length === 0 && !loading && (
          <p style={{ fontSize: 12, opacity: 0.6 }}>No documents saved yet.</p>
        )}
        {docs.map((d) => (
          <div key={d.id} onClick={() => openDoc(d)} style={docItemStyle(selected?.id === d.id)}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{d.title}</div>
            <div style={{ fontSize: 10, opacity: 0.6 }}>
              {d.updated_at?.toDate ? d.updated_at.toDate().toLocaleString() : ""}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button onClick={(e) => { e.stopPropagation(); exportPdf(d); }} style={miniBtnStyle}>
                PDF
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openDoc(d);
                  setEmailModalOpen(true);
                }}
                style={miniBtnStyle}
              >
                Email
              </button>
              <button onClick={(e) => { e.stopPropagation(); deleteDocById(d.id); }} style={{ ...miniBtnStyle, color: "#f87171", borderColor: "#f87171" }}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Editor column */}
      <div style={{ flex: 1 }}>
        {error && <p style={{ color: "#f87171", fontSize: 12 }}>{error}</p>}
        {!selected ? (
          <p style={{ fontSize: 13, opacity: 0.6 }}>Select a document to view or edit.</p>
        ) : (
          <>
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={inputStyle} />
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={16}
              style={{ ...inputStyle, marginTop: 8, resize: "vertical" }}
            />
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button onClick={saveEdit} style={primaryBtnStyle}>
                Save Changes
              </button>
              <button onClick={() => setSelected(null)} style={miniBtnStyle}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>

      {/* Email modal */}
      {emailModalOpen && selected && (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <h4 style={{ fontSize: 14, marginBottom: 10 }}>Email "{selected.title}"</h4>
            <input placeholder="recipient@example.com" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} style={inputStyle} />
            <textarea
              placeholder="Optional note"
              value={emailNote}
              onChange={(e) => setEmailNote(e.target.value)}
              rows={3}
              style={{ ...inputStyle, marginTop: 8 }}
            />
            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={sendEmail} style={primaryBtnStyle}>
                Send
              </button>
              <button onClick={() => setEmailModalOpen(false)} style={miniBtnStyle}>
                Close
              </button>
              {emailStatus && <span style={{ fontSize: 12 }}>{emailStatus}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==================== styles ==================== */

const saveBtnStyle = (saving) => ({
  background: "transparent",
  border: "1px solid var(--accent, #2dd4bf)",
  color: "var(--accent, #2dd4bf)",
  borderRadius: 4,
  padding: "4px 10px",
  fontSize: 12,
  cursor: saving ? "default" : "pointer",
  opacity: saving ? 0.6 : 1,
});

const panelStyle = {
  background: "var(--bg, #0d1117)",
  color: "var(--text, #e6edf3)",
  fontFamily: "var(--mono, monospace)",
  border: "1px solid var(--accent, #2dd4bf)",
  borderRadius: 6,
  padding: 16,
  display: "flex",
  gap: 16,
  minHeight: 400,
};

const docItemStyle = (active) => ({
  padding: "8px 6px",
  marginBottom: 6,
  borderRadius: 4,
  cursor: "pointer",
  background: active ? "rgba(45,212,191,0.1)" : "transparent",
  border: "1px solid #222",
});

const miniBtnStyle = {
  background: "transparent",
  border: "1px solid #444",
  color: "inherit",
  borderRadius: 3,
  padding: "2px 6px",
  fontSize: 10,
  cursor: "pointer",
};

const primaryBtnStyle = {
  background: "var(--accent, #2dd4bf)",
  border: "none",
  color: "#0d1117",
  borderRadius: 4,
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const inputStyle = {
  width: "100%",
  background: "#161b22",
  color: "inherit",
  border: "1px solid #333",
  borderRadius: 4,
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "inherit",
};

const modalOverlayStyle = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalStyle = {
  background: "var(--bg, #0d1117)",
  border: "1px solid var(--accent, #2dd4bf)",
  borderRadius: 6,
  padding: 20,
  width: 360,
};
