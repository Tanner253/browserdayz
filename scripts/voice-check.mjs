// How the voice sounds, measured (nobody who wrote it can hear it): a steady note is put through the whole of
// src/game/voice.ts but the wire and the microphone, in a headless Chrome, while the page's own thread is kept as
// busy as a game keeps it; and what comes out to be heard is looked at a sample at a time. A note that comes
// through whole is smooth: every sample is a small step from the last. A piece lost, or two pieces badly joined,
// is a step no note makes.
//
//   node scripts/voice-check.mjs                    the voice as it is now
//   node scripts/voice-check.mjs --of <commit>      as it was at that commit (to see what a change did)
//
// For each engine rate (48000, and 44100: most laptops), prints: pieces sent and played of those owed; how much of
// what was listened to was silence; and how many steps were bigger than the note can make.

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
window.check = async (rate, busy) => {
  const ctx = new AudioContext({ sampleRate: rate });
  await ctx.resume();
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(ctx.destination);
  const v = new VoiceMod.Voice(() => ctx, () => bus, () => {});
  // the page's thread as a game keeps it: busy for most of every frame, and now and then for three frames together
  let n = 0;
  const work = busy ? setInterval(() => { const until = performance.now() + (++n % 20 === 0 ? 70 : 22); while (performance.now() < until); }, 33) : 0;
  const tap = ctx.createAnalyser();
  tap.fftSize = 32768;
  const first = v.loop(400);          // (the first that is heard brings the worklets in, and is not itself heard)
  await first;
  const run = v.loop(7000);  // (longer than the four listenings take: none of them is of the quiet after it)
  // what each speaker is heard through, before it is made loud or quiet: listened to four times while it plays
  const takes = [];
  for (let k = 0; k < 4; k++) {
    await new Promise((r) => setTimeout(r, 800));
    const p = [...v.peers.values()][0];
    if (!p) continue;
    (p.ear ?? p.gain).connect(tap);
    if (!p.ear) p.gain.gain.value = 1;
    await new Promise((r) => setTimeout(r, 720));
    const buf = new Float32Array(tap.fftSize);
    tap.getFloatTimeDomainData(buf);
    takes.push(buf);
  }
  const r = await run;
  clearInterval(work);
  let silent = 0, jumps = 0, total = 0, peak = 0;
  for (const b of takes) {
    for (let i = 0; i < b.length; i++) peak = Math.max(peak, Math.abs(b[i]));
    // the biggest step a note of 440 can make from one sample to the next, and half as much again
    const most = peak * 2 * Math.PI * 440 / rate * 1.5 + 0.004;
    for (let i = 1; i < b.length; i++) {
      total++;
      if (Math.abs(b[i]) < 1e-4 && Math.abs(b[i - 1]) < 1e-4) silent++;
      if (Math.abs(b[i] - b[i - 1]) > most) jumps++;
    }
  }
  await ctx.close();
  return { rate, busy, sent: r.sent, played: r.played, owed: 350, error: r.error, takes: takes.length, silentPct: +(100 * silent / Math.max(1, total)).toFixed(1), jumps, peak: +peak.toFixed(2) };
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
  for (const [rate, busy] of [[48000, false], [48000, true], [44100, true]]) {
    const r = await run(`check(${rate}, ${busy})`);
    console.log(`  engine at ${r.rate}${r.busy ? ', the page busy' : ''}: sent ${r.sent} and played ${r.played} of about ${r.owed} pieces; ${r.silentPct}% of what was listened to was silence; ${r.jumps} steps no note makes; peak ${r.peak}${r.error ? '; ' + r.error : ''}`);
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
