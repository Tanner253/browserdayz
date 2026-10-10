// Cuts a small film for the changelog out of a finished trailer: the trailer is played in a headless Chrome,
// drawn half size, and recorded as it plays (so it takes as long as the stretch is). No game is run, and no
// dev server is needed. A still from the middle of it is kept beside it, for the poster.
//
//   node scripts/clip.mjs trailer/out/zona-trailer-7.mp4 public/changelog/media/teaser           the whole of it
//   node scripts/clip.mjs trailer/out/zona-trailer-7.mp4 public/changelog/media/teaser 3.7 9.4   that stretch (seconds)
//
// -> teaser.mp4 (or .webm, where this Chrome cannot record MP4) and teaser.jpg

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';

const [src, out, from = '0', to = '0'] = process.argv.slice(2);
if (!src || !out) throw new Error('node scripts/clip.mjs <trailer.mp4> <out, no extension> [from] [to]');
const W = 960, H = 540, PORT = 9335;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-clip-'));
// (beside the page, under a short name: a page may read what lies beside it)
fs.copyFileSync(path.resolve(src), path.join(dir, 'in.mp4'));
fs.writeFileSync(path.join(dir, 'clip.html'), `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">
<video id="v" src="in.mp4" muted playsinline preload="auto"></video><canvas id="c" width="${W}" height="${H}"></canvas>
<script>
window.cut = async (from, to) => {
  const v = document.getElementById('v'), c = document.getElementById('c'), g = c.getContext('2d');
  await new Promise((ok, no) => { if (v.readyState >= 2) ok(); else { v.onloadeddata = ok; v.onerror = () => no(new Error('the trailer could not be read')); } });
  const end = to > 0 ? Math.min(to, v.duration) : v.duration;
  const seek = (t) => new Promise((ok) => { v.onseeked = ok; v.currentTime = t; });
  await seek((from + end) / 2);
  g.drawImage(v, 0, 0, ${W}, ${H});
  const still = c.toDataURL('image/jpeg', 0.86);
  await seek(from);
  g.drawImage(v, 0, 0, ${W}, ${H});
  const type = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: type, videoBitsPerSecond: 1500000 });
  const parts = [];
  rec.ondataavailable = (e) => parts.push(e.data);
  const done = new Promise((ok) => (rec.onstop = ok));
  const frame = () => { g.drawImage(v, 0, 0, ${W}, ${H}); if (v.currentTime >= end || v.ended) rec.state === 'recording' && rec.stop(); else v.requestVideoFrameCallback(frame); };
  rec.start();
  v.requestVideoFrameCallback(frame);
  await v.play();
  v.onended = () => rec.state === 'recording' && rec.stop();
  await done;
  const buf = new Uint8Array(await new Blob(parts).arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
  return { type, film: btoa(s), still: still.split(',')[1], seconds: end - from };
};
</script>`);

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(dir, 'profile')}`, '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required', '--mute-audio', `--window-size=${W},${H}`, pathToFileURL(path.join(dir, 'clip.html')).href], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let page = null;
  for (let k = 0; k < 60 && !page; k++) {
    await sleep(250);
    try {
      page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page' && t.url.endsWith('clip.html'));
    } catch {
      // not up yet
    }
  }
  if (!page) throw new Error('Chrome did not open the page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1 << 29 });
  await new Promise((ok, no) => (ws.once('open', ok), ws.once('error', no)));
  const answer = new Promise((ok, no) => ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.id !== 1) return;
    if (m.error || m.result?.exceptionDetails) no(new Error(JSON.stringify(m.error ?? m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails).slice(0, 400)));
    else ok(m.result.result.value);
  }));
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `cut(${Number(from)}, ${Number(to)})`, awaitPromise: true, returnByValue: true } }));
  const r = await answer;
  const ext = r.type.startsWith('video/mp4') ? 'mp4' : 'webm';
  fs.writeFileSync(`${out}.${ext}`, Buffer.from(r.film, 'base64'));
  fs.writeFileSync(`${out}.jpg`, Buffer.from(r.still, 'base64'));
  console.log(`${out}.${ext}  ${(fs.statSync(`${out}.${ext}`).size / 1024).toFixed(0)} KB  ${r.seconds.toFixed(1)} s  (${r.type})\n${out}.jpg  ${(fs.statSync(`${out}.jpg`).size / 1024).toFixed(0)} KB`);
  ws.close();
} finally {
  chrome.kill();
  await sleep(400);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Chrome still letting go of its profile
  }
}
