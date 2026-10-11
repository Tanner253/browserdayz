// Decodes Ogg recordings to WAV. Nothing on this machine reads Ogg but a browser, so a headless Chrome does it:
// each file is handed to its decoder and written out as it comes, one channel, 16 bits.
//
//   node scripts/ogg.mjs impactWood_heavy impactWood_light      Kenney's "Impact Sounds", every take of each kind:
//        assets-src/sounds/kenney-impact/Audio/<kind>_00<n>.ogg -> assets-src/sounds/decoded/k-<kind>-<n>.wav
//   node scripts/ogg.mjs --dir cc0-wood-metal door_open_01 wood_close_01        files of another pack, by name:
//        assets-src/sounds/<dir>/<name>.ogg -> assets-src/sounds/decoded/c-<name>.wav
//
// scripts/sounds.mjs reads them from there.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'assets-src', 'sounds', 'kenney-impact', 'Audio'), OUT = path.join(ROOT, 'assets-src', 'sounds', 'decoded');
const args = process.argv.slice(2);
const pack = args[0] === '--dir' ? args[1] : null;
const kinds = pack ? args.slice(2) : args;
if (!kinds.length) throw new Error('which kinds? e.g. node scripts/ogg.mjs impactWood_heavy');
const PORT = 9336;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-ogg-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--mute-audio', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let page = null;
  for (let k = 0; k < 60 && !page; k++) {
    await sleep(250);
    try {
      page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
    } catch {
      // not up yet
    }
  }
  if (!page) throw new Error('Chrome did not start');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
  await new Promise((ok, no) => (ws.once('open', ok), ws.once('error', no)));
  let id = 0;
  const waiting = new Map();
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.error || m.result?.exceptionDetails) w.no(new Error(JSON.stringify(m.error ?? m.result.exceptionDetails).slice(0, 300)));
    else w.ok(m.result.result.value);
  });
  const run = (expression) => new Promise((ok, no) => {
    waiting.set(++id, { ok, no });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  fs.mkdirSync(OUT, { recursive: true });
  // (of Kenney's pack, the five takes of each kind; of another, the one file of each name)
  const jobs = pack ? kinds.map((name) => [path.join(ROOT, 'assets-src', 'sounds', pack, `${name}.ogg`), `c-${name}`]) : kinds.flatMap((kind) => [0, 1, 2, 3, 4].map((n) => [path.join(SRC, `${kind}_00${n}.ogg`), `k-${kind}-${n}`]));
  {
    for (const [file, out] of jobs) {
      if (!fs.existsSync(file)) continue;
      // (the decoder gives it at the rate asked for, mixed down to one channel here)
      const got = await run(`(async () => {
        const raw = Uint8Array.from(atob('${fs.readFileSync(file).toString('base64')}'), (c) => c.charCodeAt(0));
        const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(raw.buffer);
        const pcm = new Int16Array(buf.length);
        for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < pcm.length; i++) pcm[i] += Math.max(-32768, Math.min(32767, Math.round(ch[i] * 32767 / buf.numberOfChannels))); }
        let s = ''; const b = new Uint8Array(pcm.buffer);
        for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768));
        return { rate: buf.sampleRate, pcm: btoa(s) };
      })()`);
      const pcm = Buffer.from(got.pcm, 'base64'), head = Buffer.alloc(44);
      head.write('RIFF', 0);
      head.writeUInt32LE(36 + pcm.length, 4);
      head.write('WAVEfmt ', 8);
      head.writeUInt32LE(16, 16);
      head.writeUInt16LE(1, 20);
      head.writeUInt16LE(1, 22);
      head.writeUInt32LE(got.rate, 24);
      head.writeUInt32LE(got.rate * 2, 28);
      head.writeUInt16LE(2, 32);
      head.writeUInt16LE(16, 34);
      head.write('data', 36);
      head.writeUInt32LE(pcm.length, 40);
      fs.writeFileSync(path.join(OUT, `${out}.wav`), Buffer.concat([head, pcm]));
      console.log(`${out}.wav  ${(pcm.length / 2 / got.rate).toFixed(2)} s`);
    }
  }
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
