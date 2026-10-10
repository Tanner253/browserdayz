// The map from above with every place a thing can lie on it, coloured by which step of the map it is on
// (src/sim/tiers.ts), and a key beside it that says what is kept on each step. Drawn from the world as the server
// makes it: every dot is a real loot point, and the words of the key are the game's own.
//
//   npx tsx scripts/loot-map.ts      -> marketing/zona-loot-map.png and .jpg (1600 x 1000)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildWorldData } from '../server/world';
import { TIERS, type Tier } from '../src/sim/tiers';
import { PLAY_AREAS, WORLD_SIZE, generateWorld, heightAt } from '../src/world/worldgen';

const world = generateWorld();
const points = buildWorldData(process.cwd()).lootPoints;
const N = 1000, W = 1600, per = N / WORLD_SIZE, half = WORLD_SIZE / 2;
const px = (x: number) => (x + half) * per, pz = (z: number) => (z + half) * per;

// the ground: dark, lit a little from the west so that its shape reads
const img = Buffer.alloc(N * N * 3);
let lo = 1e9, hi = -1e9;
for (const h of world.heights) {
  lo = Math.min(lo, h);
  hi = Math.max(hi, h);
}
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = -half + (i + 0.5) / per, z = -half + (j + 0.5) / per;
  const h = heightAt(world.heights, x, z), k = (h - lo) / (hi - lo);
  const sx = heightAt(world.heights, Math.min(half - 1, x + 3), z) - h;
  const light = Math.max(0.35, Math.min(1.5, 0.75 + 0.5 * k - sx * 0.1));
  const o = (j * N + i) * 3;
  img[o] = Math.min(255, 26 * light + 14 * k);
  img[o + 1] = Math.min(255, 34 * light + 16 * k);
  img[o + 2] = Math.min(255, 27 * light + 12 * k);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${N}" font-family="Bahnschrift, 'Arial Narrow', Arial, sans-serif">`;
svg += `<rect x="${N}" y="0" width="${W - N}" height="${N}" fill="#0c0d0b"/>`;
// roads, and the line round the Zona
for (const r of [world.road, ...world.roads]) {
  let d = '';
  for (let i = 0; i < r.points.length; i += 3) d += `${i ? 'L' : 'M'}${px(r.points[i]).toFixed(1)},${pz(r.points[i + 2]).toFixed(1)}`;
  svg += `<path d="${d}" fill="none" stroke="#6f6a5c" stroke-width="2.4" stroke-opacity="0.8"/>`;
}
for (const a of PLAY_AREAS) svg += `<circle cx="${px(a.x)}" cy="${pz(a.z)}" r="${a.r * per}" fill="none" stroke="#f3efe6" stroke-opacity="0.28" stroke-dasharray="5 6" stroke-width="1.2"/>`;
// the heat: a soft round of its step's colour under every place for a thing, so that where there are many it glows
svg += '<defs>' + ([1, 2, 3, 4, 5] as Tier[]).map((t) => `<radialGradient id="g${t}"><stop offset="0" stop-color="${TIERS[t].colour}" stop-opacity="0.34"/><stop offset="1" stop-color="${TIERS[t].colour}" stop-opacity="0"/></radialGradient>`).join('') + '</defs>';
for (const t of [1, 2, 3, 4, 5] as Tier[]) for (const p of points) if (p.tier === t) svg += `<circle cx="${px(p.x).toFixed(1)}" cy="${pz(p.z).toFixed(1)}" r="13" fill="url(#g${t})"/>`;
for (const t of [1, 2, 3, 4, 5] as Tier[]) for (const p of points) if (p.tier === t) svg += `<circle cx="${px(p.x).toFixed(1)}" cy="${pz(p.z).toFixed(1)}" r="1.5" fill="${TIERS[t].colour}"/>`;
// the names of the places, each in the colour of the step most of its places are on
for (const q of world.pois) {
  const near = points.filter((p) => Math.hypot(p.x - q.x, p.z - q.z) < Math.max(45, q.radius));
  const count = new Map<number, number>();
  for (const p of near) count.set(p.tier ?? 1, (count.get(p.tier ?? 1) ?? 0) + 1);
  const t = ([...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1) as Tier;
  const big = t >= 2;
  svg += `<text x="${px(q.x).toFixed(1)}" y="${(pz(q.z) - (big ? 30 : 16)).toFixed(1)}" text-anchor="middle" font-size="${big ? 17 : 12.5}" font-weight="${big ? 700 : 500}" letter-spacing="1" fill="${TIERS[t].colour}" stroke="#0b0c0a" stroke-width="3" paint-order="stroke">${esc(q.name.replace('Military ', '').toUpperCase())}</text>`;
}
// the key
const X = N + 44;
svg += `<text x="${X}" y="76" font-size="54" font-weight="700" letter-spacing="8" fill="#f3efe6">ZONA</text>`;
svg += `<text x="${X}" y="118" font-size="24" font-weight="700" letter-spacing="3" fill="#f3efe6">WHERE THE LOOT IS</text>`;
svg += `<text x="${X}" y="146" font-size="14" letter-spacing="2.6" fill="#d8cfb8">EVERY DOT IS A PLACE A THING CAN LIE</text>`;
const wrap = (s: string, n: number) => {
  const out: string[] = [];
  let line = '';
  for (const w of s.split(' ')) {
    if ((line + ' ' + w).trim().length > n) {
      out.push(line.trim());
      line = w;
    } else line += ' ' + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
};
let y = 196;
for (const t of [1, 2, 3, 4, 5] as Tier[]) {
  const T = TIERS[t], n = points.filter((p) => p.tier === t).length;
  svg += `<rect x="${X}" y="${y - 20}" width="8" height="126" fill="${T.colour}"/>`;
  svg += `<text x="${X + 24}" y="${y}" font-size="25" font-weight="700" letter-spacing="3" fill="${T.colour}">${T.name.toUpperCase()}</text>`;
  svg += `<text x="${W - 44}" y="${y}" text-anchor="end" font-size="13" letter-spacing="2.4" fill="#d8cfb8">${n} PLACES</text>`;
  wrap(T.where, 58).forEach((l, k) => (svg += `<text x="${X + 24}" y="${y + 25 + k * 18}" font-size="14.5" letter-spacing="1.6" fill="#d8cfb8">${esc(l.toUpperCase())}</text>`));
  const from = y + 25 + wrap(T.where, 58).length * 18 + 5;
  wrap(T.finds, 60).forEach((l, k) => (svg += `<text x="${X + 24}" y="${from + k * 20}" font-size="16.5" fill="#f3efe6">${esc(l)}</text>`));
  y += 150;
}
svg += `<text x="${X}" y="${N - 52}" font-size="14" letter-spacing="2" fill="#d8cfb8">AMMUNITION IS ON EVERY STEP. THE DOTTED LINE IS THE ZONA.</text>`;
svg += `<text x="${X}" y="${N - 28}" font-size="13" letter-spacing="2.4" fill="rgba(243,239,230,0.5)">${new Date().toISOString().slice(0, 10)} · ZONAPVP.FUN</text>`;
svg += `<rect x="1" y="1" width="${W - 2}" height="${N - 2}" fill="none" stroke="rgba(243,239,230,0.2)" stroke-width="2"/></svg>`;

// (sharp cannot open the long paths this project lives under: it writes beside the system's temporary files, and the picture is copied home)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-map-'));
const base = await sharp(img, { raw: { width: N, height: N, channels: 3 } }).extend({ right: W - N, background: '#0c0d0b' }).png().toBuffer();
await sharp(base).composite([{ input: Buffer.from(svg) }]).png({ compressionLevel: 9 }).toFile(path.join(tmp, 'm.png'));
await sharp(path.join(tmp, 'm.png')).jpeg({ quality: 90 }).toFile(path.join(tmp, 'm.jpg'));
for (const ext of ['png', 'jpg']) fs.copyFileSync(path.join(tmp, `m.${ext}`), path.join('marketing', `zona-loot-map.${ext}`));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`marketing/zona-loot-map.png  ${(fs.statSync('marketing/zona-loot-map.png').size / 1024).toFixed(0)} KB; ${points.length} places: ${([1, 2, 3, 4, 5] as Tier[]).map((t) => `step ${t} ${points.filter((p) => p.tier === t).length}`).join(', ')}`);
