// Optional live-LLM endpoint for the public demo. Needs GROQ_API_KEY (free tier).
// Without it this returns 501 and the browser falls back to its built-in answer engine.
const ctx = require("./_context.json");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(501).json({ error: "LLM not configured" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const question = String(body.question || "").slice(0, 500);
  const honorific = String(body.honorific || "Sir").slice(0, 20);
  if (!question) return res.status(400).json({ error: "question required" });
  const history = Array.isArray(body.history) ? body.history.slice(-4) : [];

  const prompt = `You are SIRA, a SOC investigation assistant. Speak like JARVIS: calm, precise. Address the analyst as "${honorific}" occasionally.
Use ONLY the dataset summary below; never invent IPs, signatures or events. If the data does not cover the question, say so.
Write times as "at HH:MM". Private IPs (10.x) are infrastructure, not attackers.
Pick a format that fits: short plain answer for simple questions; for a specific IP use SUMMARY / THREAT DETAILS / WHAT THIS MEANS / RISK ASSESSMENT / RECOMMENDED ACTIONS.
End with one line starting exactly "SPOKEN_SUMMARY:" containing 1-2 short conversational sentences.

DATASET SUMMARY (synthetic demo data):
${JSON.stringify(ctx)}

Previous conversation:
${history.map((m) => `${String(m.role).toUpperCase()}: ${String(m.content).slice(0, 600)}`).join("\n") || "None"}

Question: ${question}`;

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-oss-120b", temperature: 0.4, max_tokens: 900, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) return res.status(502).json({ error: `upstream ${r.status}` });
    const data = await r.json();
    let answer = data.choices?.[0]?.message?.content || "";
    let spoken = "";
    const m = answer.match(/SPOKEN_SUMMARY:\s*([\s\S]*)$/);
    if (m) {
      spoken = m[1].trim();
      answer = answer.slice(0, m.index).trim();
    }
    return res.status(200).json({ answer, spoken_summary: spoken, model_used: "groq" });
  } catch (e) {
    return res.status(502).json({ error: "upstream failure" });
  }
};
