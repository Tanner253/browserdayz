// How the voice sounds, measured (nobody who wrote it can hear it). In a headless Chrome a steady note is spoken
// by one player's voice (src/game/voice.ts, all of it but the microphone) and heard by another's, over a line
// made up between the two, and what comes out to be heard is looked at a sample at a time. A note that comes
// through whole is smooth: every sample is a small step from the last. A piece lost, or two pieces badly joined,
// is a step no note makes; a piece late with nothing in hand is a silence.
//
//   node scripts/voice-check.mjs                    the voice as it is now
//   node scripts/voice-check.mjs --of <commit>      as it was at that commit (to see what a change did)
//
// Three times over, each harder than the last:
//   quiet     - the page idle, the line perfect
//   stopping  - the page as busy as a game keeps it, and stopping dead for a third of a second every two and a half
//               (a place loading, a shader made): what is owed then comes all at once
//   bad line  - that, and a line that holds each piece back by 40 to 130 ms and every few seconds stops for up to
//               three quarters of a second and then gives all it holds together (as a line that resends does)
// For each: pieces sent and heard; how often the listener ran dry while it was finding how much to keep in hand
// (the first four seconds) and after; and, of what was listened to after those four seconds, how much was silence
// and how many steps no note makes.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';

const of = process.argv.includes('--of') ? process.argv[process.argv.indexOf('--of') + 1] : null;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-voice-'));
const PORT = 9338;
// the module by itself, as a script a page can load (and, for an old commit, that commit's own two files)
let entry = path.resolve('src/game/voice.ts');
if (of) {
  fs.mkdirSync(path.join(dir, 'src/game'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src/sim'), { recursive: true });
  for (const f of ['src/game/voice.ts', 'src/sim/voice.ts']) fs.writeFileSync(path.join(dir, f), execFileSync('git', ['show', `${of}:${f}`]));
  entry = path.join(dir, 'src/game/voice.ts');
}
execFileSync(process.execPath, [path.resolve('node_modules/esbuild/bin/esbuild'), entry, '--bundle', '--format=iife', '--global-name=VoiceMod', `--outfile=${path.join(dir, 'voice.js')}`, '--log-level=error']);
fs.writeFileSync(path.join(dir, 'check.html'), `<!doctype html><meta charset="utf-8"><script src="voice.js"></script><script>
window.check = async (rate, mode) => {
  const ctx = new AudioContext({ sampleRate: rate });
  await ctx.resume();
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(ctx.destination);
  const hard = mode !== 'quiet', bad = mode === 'bad line';
  // the line: pieces come out in the order they went in, each late by its own amount; now and then it stops, and then gives all it holds at once
  let free = 0, stopped = 0, heard = 0;
  const listener = new VoiceMod.Voice(() => ctx, () => bus, () => {});
  const speaker = new VoiceMod.Voice(() => ctx, () => bus, (b) => {
    const o = new Uint8Array(b.length + 2);
    o[0] = 7;
    o.set(b, 2);
    const now = performance.now();
    if (bad && now > stopped && Math.random() < 0.007) stopped = now + 300 + Math.random() * 450;
    const at = Math.max(now + (bad ? 40 + Math.random() * 90 : 0), stopped, free);
    free = at;
    line.push([at, o.buffer]);
  });
  // (given out by one hand, in the order it went in: a timer for each piece let a later one overtake an earlier, which no line does)
  const line = [];
  const pump = setInterval(() => { const now = performance.now(); while (line.length && line[0][0] <= now) { heard++; listener.hear(line.shift()[1]); } }, 4);
  // the page's thread as a game keeps it: busy for most of every frame, and every two and a half seconds stopped dead for a third of one
  let n = 0;
  const work = hard ? setInterval(() => { const until = performance.now() + (++n % 75 === 0 ? 330 : 22); while (performance.now() < until); }, 33) : 0;
  speaker.testing = true;
  const error = await speaker.talk(440);
  const tap = ctx.createAnalyser();
  tap.fftSize = 32768;
  await new Promise((r) => setTimeout(r, 4000));
  const peer = () => [...listener.peers.values()][0];
  const settling = peer()?.state?.dry ?? -1;
  const p = peer();
  if (p) {
    (p.ear ?? p.gain).connect(tap);
    if (!p.ear) p.gain.gain.value = 1;
  }
  // listened to eight times over the next twelve seconds, seven tenths of a second each
  const takes = [];
  for (let k = 0; k < 8; k++) {
    await new Promise((r) => setTimeout(r, 1500));
    const buf = new Float32Array(tap.fftSize);
    tap.getFloatTimeDomainData(buf);
    takes.push(buf);
  }
  speaker.testing = false;
  speaker.hush();
  clearInterval(work);
  clearInterval(pump);
  let silent = 0, jumps = 0, total = 0, peak = 0;
  for (const b of takes) for (let i = 0; i < b.length; i++) peak = Math.max(peak, Math.abs(b[i]));
  // the biggest step a note of 440 can make from one sample to the next, and half as much again
  const most = peak * 2 * Math.PI * 440 / rate * 1.6 + 0.004;
  for (const b of takes) for (let i = 1; i < b.length; i++) {
    total++;
    if (Math.abs(b[i]) < 1e-4 && Math.abs(b[i - 1]) < 1e-4) silent++;
    if (Math.abs(b[i] - b[i - 1]) > most) jumps++;
  }
  const st = peer()?.state ?? null;
  const out = { rate, mode, sent: speaker.stats.sent, heard, played: listener.stats.played, error, settling, dry: st ? st.dry - settling : -1, want: st?.want ?? -1, silentPct: +(100 * silent / Math.max(1, total)).toFixed(1), jumps, peak: +peak.toFixed(2) };
  await new Promise((r) => setTimeout(r, 1200));
  await ctx.close();
  return out;
};
</script>`);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(dir, 'p')}`, '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required', '--mute-audio', pathToFileURL(path.join(dir, 'check.html')).href], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let page = null;
  for (let k = 0; k < 60 && !page; k++) {
    await sleep(250);
    try {
      page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page' && t.url.endsWith('check.html'));
    } catch {
      // not up yet
    }
  }
  if (!page) throw new Error('Chrome did not open the page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, no) => (ws.once('open', ok), ws.once('error', no)));
  let id = 0;
  const waiting = new Map();
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)), w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.error || m.result?.exceptionDetails) w.no(new Error(JSON.stringify(m.error ?? m.result.exceptionDetails).slice(0, 500)));
    else w.ok(m.result.result.value);
  });
  const run = (expression) => new Promise((ok, no) => {
    waiting.set(++id, { ok, no });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  console.log(of ? `the voice as it was at ${of}:` : 'the voice as it is:');
  for (const [rate, mode] of [[48000, 'quiet'], [44100, 'stopping'], [48000, 'bad line'], [44100, 'bad line']]) {
    const r = await run(`check(${rate}, '${mode}')`);
    console.log(`  ${mode.padEnd(8)} at ${r.rate}: ${r.sent} pieces sent, ${r.heard} passed on, ${r.played} played; ran dry ${r.settling} times settling and ${r.dry} after (keeping ${r.want} ms in hand); after settling ${r.silentPct}% silence and ${r.jumps} steps no note makes; peak ${r.peak}${r.error ? '; ' + r.error : ''}`);
  }
  ws.close();
} finally {
  chrome.kill();
  await sleep(400);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Chrome still letting go
  }
}
