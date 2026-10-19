/*
 * Demo-only stand-in for "firebase/firestore" (aliased in craco.config.js when
 * REACT_APP_DEMO=true). Implements the small slice of the API the app uses,
 * backed by localStorage, so chat history, alert triage, saved profiles and
 * Hermes documents work for every visitor without a Firebase project.
 * Each visitor's data stays in their own browser.
 */
const PREFIX = "sira_demo_fs_";
const mem = {};

class Ts {
  constructor(ms) {
    this.seconds = Math.floor(ms / 1000);
    this.nanoseconds = (ms % 1000) * 1e6;
    this._ms = ms;
  }
  toDate() { return new Date(this._ms); }
  toMillis() { return this._ms; }
}

const revive = (v) => {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === "object") {
    if (v.__ts !== undefined) return new Ts(v.__ts);
    const o = {};
    Object.keys(v).forEach((k) => (o[k] = revive(v[k])));
    return o;
  }
  return v;
};
const store = (v) => {
  if (v instanceof Ts) return { __ts: v._ms };
  if (Array.isArray(v)) return v.map(store);
  if (v && typeof v === "object") {
    const o = {};
    Object.keys(v).forEach((k) => (o[k] = store(v[k])));
    return o;
  }
  return v;
};

function readCol(name) {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    if (raw) return JSON.parse(raw);
  } catch { /* fall through */ }
  return mem[name] || null;
}
function writeCol(name, obj) {
  mem[name] = obj;
  try { localStorage.setItem(PREFIX + name, JSON.stringify(obj)); } catch { /* quota / private mode */ }
}
function loadCol(name) {
  let c = readCol(name);
  if (!c) {
    c = SEED[name] ? JSON.parse(JSON.stringify(SEED[name]())) : {};
    writeCol(name, c);
  }
  return c;
}

// ---------- seed data so History / Documents are not empty on first visit ----------
const ago = (min) => ({ __ts: Date.now() - min * 60000 });
const SEED = {
  soc_sessions: () => ({
    "demo-s1": { username: "demo.analyst", title: "Who compromised the honeypot?", model_used: "groq", message_count: 2, created_at: ago(190), updated_at: ago(185) },
    "demo-s2": { username: "demo.analyst", title: "Top attackers this week", model_used: "groq", message_count: 2, created_at: ago(1500), updated_at: ago(1490) },
  }),
  soc_messages: () => ({
    m1: { username: "demo.analyst", session_id: "demo-s1", role: "user", message: "Which attacker actually got in?", model_used: "groq", created_at: ago(190) },
    m2: { username: "demo.analyst", session_id: "demo-s1", role: "ai", model_used: "groq", created_at: ago(189),
      message: "SUMMARY:\n185.231.77.14 is the only source that completed a full intrusion. It brute-forced SSH, logged in as root with default credentials at 20:27 on 2026-10-16, pulled a Mirai-style payload from 62.204.41.190, then started Stratum miner traffic to 51.222.30.101:3333.\n\nRECOMMENDED ACTIONS:\n1. Block 185.231.77.14 and 62.204.41.190 now.\n2. Rebuild the host and rotate credentials.\n3. Disable password SSH." },
    m3: { username: "demo.analyst", session_id: "demo-s2", role: "user", message: "Top attackers this week?", model_used: "groq", created_at: ago(1500) },
    m4: { username: "demo.analyst", session_id: "demo-s2", role: "ai", model_used: "groq", created_at: ago(1499),
      message: "The most active external sources are 185.231.77.14 (465 events), 103.77.192.208 (284) and 91.240.118.52 (223). Most of the volume is SSH brute forcing." },
  }),
  hermes_documents: () => ({
    d1: { username: "demo.analyst", title: "Case: 185.231.77.14 full compromise", source_query: "Investigate the top attacker",
      content: "SUMMARY:\n185.231.77.14 completed a five-stage intrusion against the honeypot: recon, SSH brute force, successful root login, payload download, cryptominer traffic.\n\nTOP THREATS:\n- 185.231.77.14 (initial access, 465 events)\n- 62.204.41.190 (payload host)\n- 51.222.30.101:3333 (mining pool)\n\nMITRE ATT&CK:\nT1595 Active Scanning; T1110 Brute Force; T1105 Ingress Tool Transfer; T1496 Resource Hijacking.\n\nRECOMMENDED ACTIONS:\n1. Block all three addresses.\n2. Rebuild the host from a clean image.\n3. Disable password authentication for SSH.",
      created_at: ago(300), updated_at: ago(300) },
  }),
};

// ---------- API ----------
export const getFirestore = () => ({ __demo: true });
export const collection = (_db, name) => ({ type: "col", name });
export const doc = (a, b, c) => (a && a.type === "col" ? { type: "doc", col: a.name, id: b || uid() } : { type: "doc", col: b, id: c });
export const where = (field, op, value) => ({ t: "where", field, op, value });
export const orderBy = (field, dir = "asc") => ({ t: "order", field, dir });
export const limit = (n) => ({ t: "limit", n });
export const query = (col, ...constraints) => ({ type: "query", name: col.name, constraints });
export const serverTimestamp = () => new Ts(Date.now());
export const increment = (n) => ({ __inc: n });
export const Timestamp = { now: () => new Ts(Date.now()), fromDate: (d) => new Ts(d.getTime()) };

const uid = () => "id" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const getField = (o, f) => f.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
const cmp = (a, b) => {
  const av = a instanceof Ts ? a._ms : a;
  const bv = b instanceof Ts ? b._ms : b;
  return av < bv ? -1 : av > bv ? 1 : 0;
};

function snapOf(colName, id, raw) {
  const data = revive(raw);
  return { id, ref: { type: "doc", col: colName, id }, exists: () => true, data: () => data };
}

export async function getDocs(q) {
  const name = q.name;
  const constraints = q.constraints || [];
  const col = loadCol(name);
  let rows = Object.keys(col).map((id) => snapOf(name, id, col[id]));
  constraints.filter((c) => c.t === "where").forEach((c) => {
    rows = rows.filter((r) => {
      const v = getField(r.data(), c.field);
      if (c.op === "==") return v === c.value;
      if (c.op === "!=") return v !== c.value;
      if (c.op === "in") return c.value.includes(v);
      return true;
    });
  });
  constraints.filter((c) => c.t === "order").forEach((c) => {
    rows.sort((a, b) => cmp(getField(a.data(), c.field), getField(b.data(), c.field)) * (c.dir === "desc" ? -1 : 1));
  });
  const lim = constraints.find((c) => c.t === "limit");
  if (lim) rows = rows.slice(0, lim.n);
  return { docs: rows, empty: rows.length === 0, size: rows.length, forEach: (fn) => rows.forEach(fn) };
}

export async function getDoc(ref) {
  const col = loadCol(ref.col);
  const raw = col[ref.id];
  if (!raw) return { id: ref.id, exists: () => false, data: () => undefined, ref };
  return snapOf(ref.col, ref.id, raw);
}

function applyWrite(existing, data, merge) {
  const base = merge && existing ? existing : {};
  const out = { ...base };
  Object.keys(data).forEach((k) => {
    const v = data[k];
    if (v && typeof v === "object" && v.__inc !== undefined) out[k] = (typeof base[k] === "number" ? base[k] : 0) + v.__inc;
    else out[k] = store(v);
  });
  return out;
}

export async function setDoc(ref, data, opts) {
  const col = loadCol(ref.col);
  col[ref.id] = applyWrite(col[ref.id], data, opts && opts.merge);
  writeCol(ref.col, col);
}
export async function addDoc(colRef, data) {
  const col = loadCol(colRef.name);
  const id = uid();
  col[id] = applyWrite(null, data, false);
  writeCol(colRef.name, col);
  return { type: "doc", col: colRef.name, id };
}
export async function updateDoc(ref, data) {
  return setDoc(ref, data, { merge: true });
}
export async function deleteDoc(ref) {
  const col = loadCol(ref.col);
  delete col[ref.id];
  writeCol(ref.col, col);
}
export function writeBatch() {
  const ops = [];
  return {
    set: (ref, data, opts) => ops.push(() => setDoc(ref, data, opts)),
    update: (ref, data) => ops.push(() => updateDoc(ref, data)),
    delete: (ref) => ops.push(() => deleteDoc(ref)),
    commit: async () => { for (const op of ops) await op(); },
  };
}
export function onSnapshot(q, cb) {
  (q.type === "doc" ? getDoc(q) : getDocs(q)).then(cb);
  return () => {};
}
