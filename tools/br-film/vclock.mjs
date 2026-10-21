// The arena server's clock for filming the battle royale (src/trailer/shots25.ts): stopped, and moved on only when the
// film says, so the server's match (its 4 Hz tick, the plane, the circle, the poses sent 15 times a second) keeps step
// with the film page's own stopped clock (tools/trailer/clock.js) frame by frame. Loaded before the server:
//   PORT=8095 VCLOCK_PORT=8096 node --import tsx --import ./tools/br-film/vclock.mjs arena/server.ts
// The film says how far on with GET http://127.0.0.1:VCLOCK_PORT/advance?ms=<ms>, answered once every timer due in
// that time has run, in order. Until the first word the clock runs as it should (the world is made, the walls built).
import http from 'node:http';

// (and its dice from a seed: the plane's line, the loot and the circles fall the same way every take)
let seed = Number(process.env.VCLOCK_SEED) || 20261021;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const RealDate = Date, realNow = Date.now.bind(Date), realSetTimeout = setTimeout, realClearTimeout = clearTimeout;
let held = false, t = realNow(), seq = 0;
const timers = new Map();
const now = () => (held ? t : realNow());

class VirtualDate extends RealDate {
  constructor(...a) {
    if (a.length === 0) super(now());
    else super(...a);
  }
  static now() { return now(); }
}
globalThis.Date = VirtualDate;
const perf0 = realNow();
performance.now = () => now() - perf0;

/** a timer handle as Node's are: unref, ref, refresh, and a number for clearTimeout */
const handle = (id) => ({ id, unref() { return this; }, ref() { return this; }, hasRef() { return true; }, refresh() { const q = timers.get(id); if (q) q.at = now() + q.ms; return this; }, [Symbol.toPrimitive]() { return id; } });
const add = (fn, ms, args, every) => {
  const id = ++seq, d = Math.max(0, Number(ms) || 0);
  timers.set(id, { at: now() + d, ms: d, fn, args, every });
  return handle(id);
};
globalThis.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
globalThis.setInterval = (fn, ms, ...args) => add(fn, Math.max(1, Number(ms) || 1), args, true);
globalThis.clearTimeout = globalThis.clearInterval = (h) => { timers.delete(typeof h === 'object' && h ? h.id : Number(h)); };

/** before the film holds the clock, the timers run on the real one: looked at every few milliseconds */
const run = (upTo) => {
  for (let n = 0; n < 100000; n++) {
    let first = null;
    for (const [id, q] of timers) if (q.at <= upTo && (!first || q.at < first[1].at || (q.at === first[1].at && id < first[0]))) first = [id, q];
    if (!first) break;
    const [id, q] = first;
    if (held) t = Math.max(t, q.at);
    if (q.every) q.at += q.ms;
    else timers.delete(id);
    try { q.fn(...q.args); } catch (e) { console.error('[vclock] a timer threw', e); }
  }
};
(function free() {
  if (held) return;
  run(realNow());
  realSetTimeout(free, 4);
})();

http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/advance') {
    if (!held) {
      held = true;
      t = realNow();
    }
    const ms = Math.max(0, Math.min(600000, Number(u.searchParams.get('ms')) || 0)), end = t + ms;
    run(end);
    t = end;
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    return void res.end(String(t));
  }
  res.writeHead(404, { 'access-control-allow-origin': '*' });
  res.end();
}).listen(Number(process.env.VCLOCK_PORT) || 8096, '127.0.0.1');
void realClearTimeout;
console.log(`[vclock] the server's clock waits for the film on :${Number(process.env.VCLOCK_PORT) || 8096}`);
