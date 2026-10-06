// Films the trailer: the real game, on a clock that only moves when told to, photographed one
// frame at a time in a headless Chrome and encoded in the page (H.264 + AAC into an MP4).
//
//   node scripts/film.mjs                     full take, 1920x1080 at 60 fps -> trailer/out/zona-trailer.mp4
//   node scripts/film.mjs --draft             half size, 30 fps
//   node scripts/film.mjs --from 18 --to 30   only that stretch (seconds)
//   node scripts/film.mjs --stills 30         also keep every 30th frame, and lay them out as contact sheets
//   node scripts/film.mjs --no-video          stills and contact sheets only (fastest way to look at a cut)
//   node scripts/film.mjs --twice             film the stretch twice and report how many frames differ
//
// The dev server must not reload during a take: do not edit game source while this runs.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = path.join(ROOT, 'trailer', 'out');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true;
};
const draft = !!arg('draft', false);
const fps = draft ? 30 : 60;
const scale = draft ? 0.75 : 1.5; // the page is laid out at 1280x720 and drawn denser (or sparser)
const from = Number(arg('from', 0));
const to = arg('to', null) === null ? null : Number(arg('to'));
const stills = Number(arg('stills', 0));
const noVideo = !!arg('no-video', false);
const twice = !!arg('twice', false);
const name = String(arg('out', draft ? 'draft' : 'zona-trailer'));
const URL_ = String(arg('url', 'http://localhost:5173/trailer.html'));
const PORT = 9333;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-film-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720', 'about:blank',
], { stdio: 'ignore' });
const quit = () => { try { chrome.kill(); } catch { /* gone */ } };
process.on('exit', quit);
process.on('SIGINT', () => process.exit(1));

let target = null;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
  } catch { /* not up yet */ }
}
if (!target) throw new Error('Chrome did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
let seq = 0;
const waiting = new Map();
ws.on('message', (data) => {
  const m = JSON.parse(String(data));
  if (m.id && waiting.has(m.id)) {
    const [res, rej] = waiting.get(m.id);
    waiting.delete(m.id);
    if (m.error) rej(new Error(m.error.message));
    else res(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') console.log('  page error:', m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails.text);
  else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.args[0]?.value?.startsWith?.('[tr]'))) console.log('  page:', m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
});
const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, [res, rej]); ws.send(JSON.stringify({ id, method, params })); });
const run = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: scale, mobile: false });
await cdp('Page.navigate', { url: URL_ });
process.stdout.write('loading the game');
for (let i = 0; ; i++) {
  await sleep(1000);
  const state = await run('window.tr ? (window.tr.failed || (window.tr.ready ? "ready" : "staging")) : "booting"').catch(() => 'booting');
  if (state === 'ready') break;
  if (state !== 'booting' && state !== 'staging') throw new Error(`staging failed: ${state}`);
  process.stdout.write('.');
  if (i > 240) throw new Error('the game did not come up in four minutes');
}
const info = await run('window.tr.info()');
console.log(`\nGPU: ${info.gpu}`);
if (/swiftshader|software/i.test(info.gpu)) console.log('  WARNING: software rendering. The picture will be slow and may differ.');
const total = info.seconds;
const first = Math.round(from * fps), last = Math.round(Math.min(to ?? total, total) * fps);
console.log(`${name}: ${(first / fps).toFixed(2)}s to ${(last / fps).toFixed(2)}s, ${last - first} frames at ${fps} fps, ${Math.round(1280 * scale)}x${Math.round(720 * scale)}`);

const kept = [];
async function take(pass) {
  const hashes = [];
  await run(`window.tr.begin(${JSON.stringify({ fps, first, last, width: Math.round(1280 * scale), height: Math.round(720 * scale), video: !noVideo && pass === 0 })})`);
  const t0 = Date.now();
  for (let i = first; i < last; i++) {
    await run(`window.tr.step(${i})`);
    const shot = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 93 });
    // for the two-takes test: a small grey copy of the frame (film grain averages out of it, a body in a different place does not)
    if (twice) hashes.push(await sharp(Buffer.from(shot.data, 'base64')).resize(96, 54).greyscale().raw().toBuffer());
    if (pass === 0) {
      if (i === first) fs.writeFileSync(path.join(OUT, `${name}-first-frame.jpg`), Buffer.from(shot.data, 'base64'));
      if (stills && (i - first) % stills === 0) kept.push({ t: i / fps, data: Buffer.from(shot.data, 'base64') });
      if (!noVideo) await run(`window.tr.encodeFrame(${JSON.stringify(shot.data)}, ${i - first})`);
    }
    if ((i - first) % 60 === 59) {
      const done = i - first + 1, per = (Date.now() - t0) / done;
      process.stdout.write(`\r  frame ${done}/${last - first}  ${(per / 1000).toFixed(2)} s a frame  about ${Math.ceil(((last - first - done) * per) / 60000)} min left   `);
    }
  }
  process.stdout.write('\n');
  // what happened, as the game's own sound calls tell it: who fired, what was hit, every step, each with its time
  const events = twice ? (await run('window.tr.soundLog()')).map((e) => `${e.t.toFixed(3)} ${e.n} ${JSON.stringify(e.a).slice(0, 80)}`) : [];
  return { hashes, events, seconds: (Date.now() - t0) / 1000 };
}

const a = await take(0);
console.log(`filmed in ${(a.seconds / 60).toFixed(1)} min`);
if (!noVideo) {
  process.stdout.write('rendering the soundtrack and closing the file...');
  const pieces = await run('window.tr.finish()');
  const file = path.join(OUT, `${name}.mp4`);
  const fd = fs.openSync(file, 'w');
  for (let k = 0; k < pieces; k++) fs.writeSync(fd, Buffer.from(await run(`window.tr.piece(${k})`), 'base64'));
  fs.closeSync(fd);
  console.log(` ${file} (${(fs.statSync(file).size / 1048576).toFixed(1)} MB)`);
  fs.writeFileSync(path.join(OUT, `${name}-sounds.json`), JSON.stringify(await run('window.tr.soundLog()')));
}
if (kept.length) {
  // contact sheets: the cut at a glance, each still stamped with its time
  const COLS = 5, ROWS = 4, W = 384, H = 216;
  for (let s = 0; s * COLS * ROWS < kept.length; s++) {
    const page = kept.slice(s * COLS * ROWS, (s + 1) * COLS * ROWS);
    const tiles = await Promise.all(page.map(async (k, i) => ({
      input: await sharp(k.data).resize(W, H).composite([{ input: Buffer.from(`<svg width="${W}" height="${H}"><rect x="0" y="0" width="74" height="22" fill="#000" opacity="0.7"/><text x="6" y="16" font-family="monospace" font-size="14" fill="#fff">${k.t.toFixed(2)}s</text></svg>`), top: 0, left: 0 }]).jpeg({ quality: 86 }).toBuffer(),
      left: (i % COLS) * W, top: Math.floor(i / COLS) * H,
    })));
    const file = path.join(OUT, `${name}-sheet-${String(s + 1).padStart(2, '0')}.jpg`);
    await sharp({ create: { width: COLS * W, height: ROWS * H, channels: 3, background: '#111' } }).composite(tiles).jpeg({ quality: 86 }).toFile(file);
    console.log(`contact sheet ${file}`);
  }
}
if (twice) {
  const b = await take(1);
  const gap = a.hashes.map((h, i) => { let d = 0; for (let k = 0; k < h.length; k++) d += Math.abs(h[k] - b.hashes[i][k]); return d / h.length; });
  fs.writeFileSync(path.join(OUT, `${name}-events-1.txt`), a.events.join('\n'));
  fs.writeFileSync(path.join(OUT, `${name}-events-2.txt`), b.events.join('\n'));
  const same = a.events.length === b.events.length && a.events.every((e, i) => e === b.events[i]);
  console.log(`second take: ${a.events.length} game events in the first, ${b.events.length} in the second: ${same ? 'identical, to the frame' : `DIFFERENT (first difference: ${a.events.find((e, i) => e !== b.events[i]) ?? b.events[a.events.length]})`}`);
  const off = gap.filter((d) => d > 1.5).length, worst = Math.max(...gap);
  console.log(`second take: ${off} of ${gap.length} frames differ by more than film grain (mean difference ${(gap.reduce((x, y) => x + y, 0) / gap.length).toFixed(2)} of 255, worst ${worst.toFixed(2)}${off ? ` at ${((first + gap.indexOf(worst)) / fps).toFixed(2)}s` : ''})`);
}
ws.close();
quit();
await sleep(300);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still letting go */ }
process.exit(0);
