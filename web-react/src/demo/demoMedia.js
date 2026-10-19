/* Demo-only helpers: browser text-to-speech (silent WAV carrier) and client-side PDF export. */

function silentWav(seconds) {
  const rate = 8000;
  const n = Math.max(1, Math.floor(seconds * rate));
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + n, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, "data"); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  return new Blob([buf], { type: "audio/wav" });
}

let hooked = false;
function hookStop() {
  if (hooked) return;
  hooked = true;
  // when the app pauses/ends/replaces the carrier audio, stop speaking too
  ["pause", "emptied"].forEach((ev) =>
    document.addEventListener(ev, (e) => {
      if (e.target && e.target.tagName && /VIDEO|AUDIO/.test(e.target.tagName)) {
        try { window.speechSynthesis.cancel(); } catch { /* unsupported */ }
      }
    }, true)
  );
}

export function speakResponse(text) {
  const clean = String(text || "").replace(/[*_#`]/g, "").slice(0, 500);
  let seconds = Math.min(40, Math.max(1.5, clean.length / 14));
  try {
    const synth = window.speechSynthesis;
    if (synth) {
      hookStop();
      synth.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.rate = 1.0;
      const voices = synth.getVoices();
      const pick = voices.find((x) => /en[-_](GB|US)/i.test(x.lang) && /female|samantha|zira|google uk english female|jenny/i.test(x.name)) ||
        voices.find((x) => /^en/i.test(x.lang));
      if (pick) u.voice = pick;
      synth.speak(u);
    }
  } catch { /* speech not available: silent audio still lets the UI animate */ }
  return new Response(silentWav(seconds), { status: 200, headers: { "Content-Type": "audio/wav" } });
}

export async function makePdf({ title, content, source_query }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  let y = M;
  const ensure = (h) => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const ascii = (s) => String(s || "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/[^\x09\x0A\x20-\x7E]/g, "");

  doc.setFillColor(15, 23, 42); doc.rect(0, 0, W, 64, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.text("SIRA - SOC Investigation Report", M, 38);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text("Demo - synthetic honeypot data", W - M, 38, { align: "right" });
  y = 96;
  doc.setTextColor(20); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.splitTextToSize(ascii(title || "Untitled"), W - 2 * M).forEach((l) => { ensure(20); doc.text(l, M, y); y += 20; });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110);
  if (source_query) { ensure(14); doc.text(doc.splitTextToSize("Query: " + ascii(source_query), W - 2 * M), M, y); y += 16; }
  doc.text("Generated " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", M, y); y += 22;

  ascii(content).split("\n").forEach((raw) => {
    const line = raw.replace(/^#+\s*/, "").replace(/\*\*/g, "");
    const heading = /^[A-Z][A-Z &/-]{3,}:?$/.test(line.trim());
    if (!line.trim()) { y += 6; return; }
    doc.setFont("helvetica", heading ? "bold" : "normal");
    doc.setFontSize(heading ? 11 : 10);
    doc.setTextColor(heading ? 30 : 40);
    if (heading) y += 6;
    doc.splitTextToSize(line, W - 2 * M).forEach((l) => { ensure(14); doc.text(l, M, y); y += 14; });
  });
  return doc.output("blob");
}
