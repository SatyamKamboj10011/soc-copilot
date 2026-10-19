// Shared dataset loader for the demo (kept separate to avoid circular imports).
let realFetch = null;
export function setRealFetch(f) {
  realFetch = f;
}
export function getRealFetch() {
  return realFetch || window.fetch.bind(window);
}

let eventsPromise = null;
/** All synthetic events, newest first. */
export function loadEvents() {
  if (!eventsPromise) {
    eventsPromise = getRealFetch()("/demo/eve.json")
      .then((r) => r.text())
      .then((t) =>
        t
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l))
          .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      );
  }
  return eventsPromise;
}

export const isInternal = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip || "");
export const hhmm = (ts) => (ts && ts.length >= 16 ? ts.slice(11, 16) : "unknown time");
export const dayOf = (ts) => (ts ? ts.slice(0, 10) : "");
