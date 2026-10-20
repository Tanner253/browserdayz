// Makes the inventory's pictures ahead of time. Every item is drawn from its own model by the game's own code
// (src/ui/icons.ts), in a headless Chrome looking at the local game, and kept as one small file each:
// public/assets/icons/<id>.webp, with a note of what each was made from (index.json).
//
// The game used to make them all when it started, which meant fetching the model of every item there is before
// anybody could play. Now it reads these, and fetches a model when a thing of its kind is first near. A picture
// whose item has changed since (another model, another dye, another shape in a pocket) is known by its note, and
// the game makes that one itself until this is run again.
//
//   npm run icons        (the local game must be running: npm run dev)
//   npm run icons -- http://localhost:5173/zona?gfx=ultra
//   npm run icons -- --only colt,m9   (those alone made again, every other picture and its note left as it is)
// (?gfx=ultra: drawn with everything at full, as they always were; a player starts on Medium)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = path.join(ROOT, 'public', 'assets', 'icons');
const args = process.argv.slice(2), at = args.indexOf('--only');
const only = at >= 0 ? args.splice(at, 2)[1].split(',') : null;
const address = args[0] ?? 'http://localhost:5173/zona?gfx=ultra';
const PORT = 9341;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-icons-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--mute-audio', '--window-size=480,270', 'about:blank'], { stdio: 'ignore' });
const quit = () => { try { chrome.kill(); } catch { /* gone */ } };
process.on('exit', quit);

let target = null;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(250);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
}
if (!target) throw new Error('Chrome did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
let seq = 0;
const waiting = new Map();
ws.on('message', (data) => {
  const m = JSON.parse(String(data));
  if (!m.id || !waiting.has(m.id)) return;
  const [res, rej] = waiting.get(m.id);
  waiting.delete(m.id);
  if (m.error) rej(new Error(m.error.message)); else res(m.result);
});
const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, [res, rej]); ws.send(JSON.stringify({ id, method, params })); });
const run = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await cdp('Page.enable');
await cdp('Runtime.enable');
// (The dev server's word that a file has changed is not heard by this page: with the tree being edited while this
// runs, a page told of every save starts loading afresh and never comes up. And when every picture is stale the game
// makes them all as it starts, which is the long way round: it is given ten minutes.)
const still = path.join(ROOT, 'assets-src', '_wf', 'me', 'still.js');
if (fs.existsSync(still)) await cdp('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(still, 'utf8') });
await cdp('Page.navigate', { url: address });
let up = false;
for (let i = 0; i < 1200 && !up; i++) {
  await sleep(500);
  up = await run(`!!window.T && !!window.__game && !document.querySelector('#loading:not(.done)')`).catch(() => false);
}
if (!up) throw new Error(`the local game did not come up at ${address}: is it running? (npm run dev)`);
const made = JSON.parse(await run(`(async () => JSON.stringify(await window.T.icons(${only ? JSON.stringify(only) : ''})))()`));
ws.close();
quit();

fs.mkdirSync(OUT, { recursive: true });
const index = only ? JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8')) : {};
let bytes = 0;
// (what is worn has a second picture, for the place it is worn in: `slot:<id>` in the list, slot-<id>.webp on disk)
const fileOf = (id) => `${id.replace(/^slot:/, 'slot-')}.webp`;
for (const id of Object.keys(made).sort()) {
  const { url, sig } = made[id];
  const png = Buffer.from(url.split(',')[1], 'base64');
  const webp = await sharp(png).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer();
  fs.writeFileSync(path.join(OUT, fileOf(id)), webp);
  index[id] = sig;
  bytes += webp.length;
}
// (a picture of what is no longer an item goes; not when only some were made)
const kept = new Set(Object.keys(index).map(fileOf));
if (!only) for (const f of fs.readdirSync(OUT)) if (f.endsWith('.webp') && !kept.has(f)) fs.rmSync(path.join(OUT, f));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(`${Object.keys(made).length} pictures made, ${(bytes / 1024).toFixed(0)} KB, in public/assets/icons (${Object.keys(index).length} in its note)`);
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch { /* Chrome still letting go */ }
