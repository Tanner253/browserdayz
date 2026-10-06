// The trailer's virtual clock. Loaded by trailer.html before any game code: from then on
// time in the page only moves when the film script says so, and "random" is the same every take.
(() => {
  const real = {
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    raf: window.requestAnimationFrame.bind(window),
    now: performance.now.bind(performance),
    random: Math.random,
  };
  // a fixed moment, so anything that depends on the date never changes between takes
  const EPOCH = Date.UTC(2026, 9, 7, 15, 0, 0);
  let t = 0;
  let seq = 0;
  const timers = new Map();
  let rafs = [];

  performance.now = () => t;
  const RealDate = Date;
  class VirtualDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(EPOCH + t);
      else super(...a);
    }
    static now() { return EPOCH + t; }
  }
  window.Date = VirtualDate;

  window.setTimeout = (fn, ms = 0, ...args) => {
    const id = ++seq;
    timers.set(id, { at: t + Math.max(0, Number(ms) || 0), fn, args, every: 0 });
    return id;
  };
  window.setInterval = (fn, ms = 0, ...args) => {
    const id = ++seq;
    const every = Math.max(1, Number(ms) || 0);
    timers.set(id, { at: t + every, fn, args, every });
    return id;
  };
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  window.requestAnimationFrame = (fn) => { const id = ++seq; rafs.push([id, fn]); return id; };
  window.cancelAnimationFrame = (id) => { rafs = rafs.filter((r) => r[0] !== id); };

  // the same "random" numbers every take
  let seed = 20261006;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  // CSS animations and transitions follow the virtual clock too
  const started = new WeakMap();
  function sync() {
    for (const a of document.getAnimations()) {
      let s = started.get(a);
      if (s === undefined) {
        s = t;
        started.set(a, s);
        try { a.pause(); } catch { /* already finished */ }
      }
      const local = t - s;
      try {
        const end = a.effect ? a.effect.getComputedTiming().endTime : Infinity;
        if (Number.isFinite(end) && local >= end) a.finish();
        else a.currentTime = local;
      } catch { /* detached */ }
    }
  }

  window.__clock = {
    real,
    get now() { return t; },
    reseed(n) { seed = n | 0; },
    sync,
    /** Move time on: run the timers that fall due, in order, then one animation frame. */
    advance(ms) {
      const end = t + ms;
      for (let guard = 0; guard < 10000; guard++) {
        let next = null;
        for (const [id, tm] of timers) if (tm.at <= end && (!next || tm.at < next[1].at)) next = [id, tm];
        if (!next) break;
        const [id, tm] = next;
        t = Math.max(t, tm.at);
        if (tm.every) tm.at += tm.every; else timers.delete(id);
        try { tm.fn(...tm.args); } catch (e) { console.error(e); }
      }
      t = end;
      const run = rafs;
      rafs = [];
      for (const [, fn] of run) { try { fn(t); } catch (e) { console.error(e); } }
      sync();
    },
  };
})();
