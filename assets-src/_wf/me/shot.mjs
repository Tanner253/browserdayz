// A plain page photographed by a headless Chrome with no GPU: for looking at styles without the game.
//   node assets-src/_wf/me/shot.mjs <page.html> <out.png> [W H]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [page, out, W = '960', H = '540'] = process.argv.slice(2);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-shot-'));
const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--hide-scrollbars', `--window-size=${W},${H}`, '--virtual-time-budget=2000', `--screenshot=${path.resolve(out)}`, pathToFileURL(path.resolve(page.split('?')[0])).href + (page.includes('?') ? '?' + page.split('?').slice(1).join('?') : '')], { encoding: 'utf8' });
console.log(r.status, fs.existsSync(out) ? `${out} ${(fs.statSync(out).size / 1024).toFixed(0)} KB` : (r.stderr ?? '').slice(-300));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still letting go */ }
