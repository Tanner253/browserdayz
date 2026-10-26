// The Build & craft guide's pictures (src/ui/guide.ts), made from a headless run's frames: each step's frames, in the
// order they were taken, as one small looping webp; a still where nothing moves; the five tools side by side.
//   node scripts/guide-media.mjs <frames dir>     -> public/guide/*.webp
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/guide-media.mjs <frames dir>');
const out = path.join('public', 'guide');
fs.mkdirSync(out, { recursive: true });
const W = 640;
const all = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => a.t - b.t).map((x) => x.f);
const of = (prefix) => all.filter((f) => f.startsWith(prefix));
const frame = (f) => sharp(path.join(dir, f)).resize({ width: W }).toBuffer();

/** @param every one frame in this many (a long one kept small) */
async function loop(name, prefixes, delay = 200, hold = 3, every = 1) {
  const files = prefixes.flatMap(of).filter((_, i, a) => i % every === 0 || i === a.length - 1);
  if (files.length < 2) return console.log(`  ${name}: ${files.length} frame(s), skipped`);
  const bufs = await Promise.all(files.map(frame));
  // (the last frame held a moment before it starts again)
  const delays = bufs.map((_, i) => (i === bufs.length - 1 ? delay * hold : delay));
  await sharp(bufs, { join: { animated: true } }).webp({ quality: 58, effort: 5, loop: 0, delay: delays }).toFile(path.join(out, `${name}.webp`));
  console.log(`  ${name}: ${files.length} frames, ${(fs.statSync(path.join(out, `${name}.webp`)).size / 1024).toFixed(0)} KB`);
}

async function still(name, file) {
  if (!all.includes(file)) return console.log(`  ${name}: ${file} missing, skipped`);
  await sharp(path.join(dir, file)).resize({ width: W }).webp({ quality: 70 }).toFile(path.join(out, `${name}.webp`));
  console.log(`  ${name}: still`);
}

async function tools() {
  const ids = ['felling_axe', 'pickaxe', 'hand_saw', 'hammer', 'building_plan'].filter((id) => all.includes(`tool-${id}.png`));
  if (!ids.length) return console.log('  tools: none');
  const m = await sharp(path.join(dir, `tool-${ids[0]}.png`)).metadata();
  // (the right-hand half of each picture, where the hand holds it)
  const cw = Math.round(m.width * 0.5), ch = Math.round(m.height * 0.8), tile = 256, th = Math.round((tile * ch) / cw);
  const tiles = await Promise.all(ids.map((id) => sharp(path.join(dir, `tool-${id}.png`)).extract({ left: m.width - cw, top: m.height - ch, width: cw, height: ch }).resize({ width: tile }).toBuffer()));
  await sharp({ create: { width: tile * ids.length, height: th, channels: 3, background: '#0b0c0c' } })
    .composite(tiles.map((input, i) => ({ input, left: i * tile, top: 0 })))
    .webp({ quality: 70 })
    .toFile(path.join(out, 'tools.webp'));
  console.log(`  tools: ${ids.join(', ')}`);
}

await tools();
await loop('chop', ['chop-'], 230);
await loop('mine', ['mine-'], 250);
await loop('saw', ['saw-'], 260);
await loop('wheel', ['wheel-'], 160);
await loop('found', ['found'], 300, 4);
await loop('walls', ['walls-'], 420, 3);
await loop('upgrade', ['up-'], 480, 4, 3);
await loop('door', ['door-'], 600, 2);
await still('bench', 'bench-craft.png');
await still('map', 'map.png');
await still('traders', 'traders.png');
// (the flag, the forge, the recycler and the research table are the changelog's own pictures: public/changelog/media)
