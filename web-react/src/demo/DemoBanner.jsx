import React from "react";

/** Small fixed badge so nobody mistakes the public demo for a live deployment. */
export default function DemoBanner() {
  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        zIndex: 99999,
        padding: "6px 10px",
        borderRadius: 8,
        background: "rgba(10,10,14,0.88)",
        border: "1px solid rgba(41,211,255,0.45)",
        color: "#9fe8ff",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 10,
        letterSpacing: 0.6,
        pointerEvents: "none",
        backdropFilter: "blur(6px)",
      }}
    >
      DEMO MODE · synthetic honeypot data (13–19 Oct 2026)
    </div>
  );
}
