// The loading screen as a short film for socials, 1920x1080 at 60 fps with its score (the owner, 2026-10-20: "can we
// make a 10 second trailer out of it? spooky music?" and "doesnt need th eloading bar or text its just a small piece
// of marketing media"). The page is held at its loading screen (the list of the game's files never comes), drawn at
// three times its size, the bar and its words taken off; every animation and timer in it runs on the film's clock, a frame
// at a time, so the motion is the screen's own whatever the filming costs. The pointer leans the mark and clicks on
// the music's beats. The page encodes it (src/dev/loading-film.ts).
//
//   node scripts/loading-film.mjs [address]   -> tools/trailer/out/zona-loading.mp4, stills in progress/loading-anim/film
//
// It needs this tree's dev page (default http://localhost:5173), and waits its turn for the graphics card.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { takeCard } from './card-lock.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const MAIN = ['', '../../..'].map((up) => path.join(ROOT, up)).find((p) => fs.existsSync(path.join(p, 'progress'))) ?? ROOT;
const BASE = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '').replace(/\/zona.*$/, '');
const ADDRESS = `${BASE}/zona?server=http://127.0.0.1:9`;
const W = 640, H = 360, SCALE = 3, FPS = 60;
const PORT = Number(process.env.PLAY_PORT) || 9361;
const OUT = path.join(ROOT, 'tools', 'trailer', 'out', 'zona-loading.mp4');
const STILLS = path.join(MAIN, 'progress', 'loading-anim', 'film');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('no Chrome found');

/** run in the page before anything of its own */
const PRE = `(() => {
  // held at the loading screen: the game's list of files never comes
  const realFetch = window.fetch;
  window.fetch = function (u, o) { return /manifest/.test(String((u && u.url) || u)) ? new Promise(() => {}) : realFetch.call(this, u, o); };
  // deaf to the dev server's word of a saved file
  const Real = window.WebSocket;
  const Still = function (url, protocols) {
    const p = Array.isArray(protocols) ? protocols : [protocols];
    if (!p.includes('vite-hmr') && !p.includes('vite-ping')) return new Real(url, protocols);
    const quiet = new EventTarget();
    Object.assign(quiet, { send() {}, close() {}, readyState: 1, url: String(url), protocol: p[0] });
    setTimeout(() => quiet.dispatchEvent(new Event('open')), 0);
    return quiet;
  };
  Still.prototype = Real.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Still[k] = Real[k];
  window.WebSocket = Still;
  // timers on the film's clock: one asked for in d ms goes off when the film is d ms on
  const realSet = window.setTimeout.bind(window), realClear = window.clearTimeout.bind(window), realEvery = window.setInterval.bind(window);
  const due = [];
  let T = 0, id = 1e7;
  const advance = (t) => {
    T = t;
    for (;;) {
      due.sort((a, b) => a.at - b.at);
      if (!due.length || due[0].at > T) break;
      const e = due.shift();
      try { e.fn(...e.args); } catch (err) { console.error(err); }
    }
  };
  window.__vt = { advance, now: () => T };
  window.setTimeout = function (fn, d, ...args) {
    if (typeof fn !== 'function') return realSet(fn, d);
    due.push({ at: T + (+d || 0), fn, args, id: ++id });
    return id;
  };
  window.clearTimeout = (n) => { const i = due.findIndex((e) => e.id === n); if (i >= 0) due.splice(i, 1); else realClear(n); };
  realEvery(() => advance(T), 15);
  // nothing on it but the mark and the word
  document.addEventListener('DOMContentLoaded', () => {
    const s = document.head.appendChild(document.createElement('style'));
    s.textContent = '.load-sub, .load-bar, .load-label, .load-help { display: none !important; }';
  });
})();`;

/** the page's half, set up once the screen is styled: its animations restarted and stopped, the film's clock */
const SETUP = `(async () => {
  const L = document.getElementById('loading'), mark = L.querySelector('.load-mark');
  const { film, SECONDS } = await import('/src/dev/loading-film.ts');
  // (a finished CSS animation is no longer listed: the mark's are restarted by taking them off and back)
  const off = document.head.appendChild(document.createElement('style'));
  off.textContent = '.load-mark, .load-mark * { animation: none !important; }';
  void L.offsetWidth;
  off.remove();
  void L.offsetWidth;
  const known = new Map();
  for (const a of document.getAnimations()) {
    a.pause();
    known.set(a, a instanceof CSSAnimation && mark.contains(a.effect && a.effect.target) ? 0 : a.currentTime || 0);
  }
  let T = 0;
  const sync = () => {
    for (const a of document.getAnimations()) {
      if (!known.has(a)) { a.pause(); known.set(a, (a.currentTime || 0) - T); }
      a.currentTime = known.get(a) + T;
    }
  };
  const fade = document.body.appendChild(document.createElement('div'));
  fade.style.cssText = 'position:fixed;inset:0;background:#000;z-index:99;pointer-events:none';
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const at = (el, u, v) => { const r = el.getBoundingClientRect(); return [r.left + r.width * u, r.top + r.height * v]; };
  const move = ([x, y]) => window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType: 'mouse', bubbles: true }));
  const click = (el, [x, y]) => el.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerType: 'mouse', bubbles: true }));
  const title = () => L.querySelector('.load-title');
  // the pointer: up to the right, a click on the word (4 s, the dread), across to the lantern on the left and a click on
  // it (6 s, the heartbeat), back, and a click on the word with the end's blow (8 s)
  const cues = [
    [2900, () => move([innerWidth * 0.82, innerHeight * 0.16])],
    [4000, () => click(L, at(title(), 0.62, 0.45))],
    [5300, () => move([innerWidth * 0.1, innerHeight * 0.78])],
    [6000, () => { const p = L.querySelector('.lp.lantern .lp-body'); if (p) click(p, at(p, 0.5, 0.5)); }],
    [6900, () => move([innerWidth * 0.5, innerHeight * 0.42])],
    [8000, () => click(L, at(title(), 0.3, 0.4))],
  ];
  window.__film = {
    seconds: SECONDS,
    enc: film(${W * SCALE}, ${H * SCALE}, ${FPS}),
    async to(t) {
      for (const c of cues) if (!c.done && t >= c[0]) { c.done = true; c[1](); }
      window.__vt.advance(t);
      T = t;
      await frame();
      sync();
      // (in from black over a quarter of a second, out over the last half)
      fade.style.opacity = String(Math.max(0, 1 - t / 250, (t - (SECONDS * 1000 - 500)) / 500));
      await frame();
    },
  };
  return SECONDS;
})()`;

await takeCard('loading-film.mjs');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-film-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio', '--hide-scrollbars',
  `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const end = (code) => {
  try { chrome.kill(); } catch { /* gone */ }
  setTimeout(() => {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still held */ }
    process.exit(code);
  }, 800);
};
process.on('SIGINT', () => end(1));

let target = null;
for (let i = 0; i < 80 && !target; i++) {
  await sleep(250);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
}
if (!target) throw new Error('Chrome did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
let seq = 0;
const waiting = new Map();
const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, [res, rej]); ws.send(JSON.stringify({ id, method, params })); });
ws.on('message', (data) => {
  const m = JSON.parse(String(data));
  if (m.id && waiting.has(m.id)) {
    const [res, rej] = waiting.get(m.id);
    waiting.delete(m.id);
    if (m.error) rej(new Error(m.error.message));
    else res(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') console.log('  page error:', m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails.text);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.log('  page error:', m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
});
const run = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

try {
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: PRE });
  await cdp('Page.navigate', { url: ADDRESS });
  // styled (the page's own CSS has come)
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    if (await run(`(() => { const m = document.querySelector('.load-mark'); return !!m && getComputedStyle(m).position === 'relative'; })()`).catch(() => false)) break;
  }
  const seconds = await run(SETUP);
  const frames = Math.round(seconds * FPS);
  fs.mkdirSync(STILLS, { recursive: true });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const t0 = Date.now();
  for (let k = 0; k < frames; k++) {
    await run(`__film.to(${((k * 1000) / FPS).toFixed(3)})`);
    const { data } = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 94 });
    if (k % 30 === 0) fs.writeFileSync(path.join(STILLS, `f${String(k).padStart(3, '0')}.jpg`), Buffer.from(data, 'base64'));
    await run(`__film.enc.frame(${JSON.stringify(data)})`);
    if (k % 60 === 0) process.stdout.write(`${k / FPS} s `);
  }
  console.log(`\n${frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s; the score...`);
  const { count, level } = await run(`__film.enc.finish().then((r) => { window.__pieces = r.pieces; return { count: r.pieces.length, level: r.level }; })`);
  const fd = fs.openSync(OUT, 'w');
  for (let k = 0; k < count; k++) fs.writeSync(fd, Buffer.from(await run(`__pieces[${k}]`), 'base64'));
  fs.closeSync(fd);
  console.log(`score before the ceiling: ${level}`);
  console.log(`${OUT} (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)`);
  end(0);
} catch (e) {
  console.error(e);
  end(1);
}
