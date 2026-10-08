// Renders a marketing card: an HTML page in marketing/ photographed by a headless Chrome at
// twice its size and brought down to size (so the lettering is clean).
//
//   node scripts/card.mjs dex-paid            marketing/dex-paid.html -> marketing/zona-dex-paid.png (+ .jpg)
//   node scripts/card.mjs dex-paid 1080 1080  a page laid out at another size

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const name = process.argv[2];
const W = Number(process.argv[3] ?? 1600), H = Number(process.argv[4] ?? 900);
if (!name) throw new Error('which card? e.g. node scripts/card.mjs dex-paid');
const page = path.join(ROOT, 'marketing', `${name}.html`);
if (!fs.existsSync(page)) throw new Error(`no ${page}`);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-card-'));
const big = path.join(profile, 'big.png');
const r = spawnSync(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=2', `--window-size=${W},${H}`, '--virtual-time-budget=3000', `--screenshot=${big}`, pathToFileURL(page).href], { stdio: 'ignore' });
if (r.status !== 0 || !fs.existsSync(big)) throw new Error('Chrome did not take the picture');
const out = path.join(ROOT, 'marketing', `zona-${name}`);
await sharp(big).resize(W, H).png({ compressionLevel: 9 }).toFile(`${out}.png`);
await sharp(big).resize(W, H).jpeg({ quality: 92 }).toFile(`${out}.jpg`);
console.log(`${out}.png  ${(fs.statSync(`${out}.png`).size / 1024).toFixed(0)} KB\n${out}.jpg  ${(fs.statSync(`${out}.jpg`).size / 1024).toFixed(0)} KB`);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still letting go */ }
