// The changelog's card of steep ground: the whole map from above, every face painted by the band of
// src/sim/slopes.ts it falls in, and beside it what each band does and how much of the map it is.
// Nothing is run but the map's own generator: no game, no browser.
//
//   npx tsx marketing/steep-bands.mts          -> public/changelog/media/steep-bands.jpg (1600x900)
//
// Every figure on it is worked out here from the map as it stands and from SLOPE, so when the ground is moved
// (a road, a crag) run it again and read the four shares against what the changelog's entry says of them.

import path from 'node:path';
import sharp from 'sharp';
import { SLOPE, riseOf } from '../src/sim/slopes';
import { CELL, WORLD_RES, WORLD_SIZE, generateWorld, idx } from '../src/world/worldgen';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const out = process.argv[2] ?? path.join(ROOT, 'public/changelog/media/steep-bands.jpg');

const world = generateWorld();
const Hs = world.heights, half = WORLD_SIZE / 2, N = 900, per = N / WORLD_SIZE, W = 1600, H = 900;
const px = (x: number) => (x + half) * per, pz = (z: number) => (z + half) * per;
let lo = 1e9, hi = -1e9;
for (let i = 0; i < Hs.length; i++) { lo = Math.min(lo, Hs[i]); hi = Math.max(hi, Hs[i]); }

/** the bands over an ordinary hillside: where each begins (rise over run), its colour, its name, and what it does */
const BANDS: { from: number; colour: [number, number, number]; head: string; says: string[] }[] = [
  { from: riseOf(SLOPE.steep), colour: [236, 214, 92], head: `Steep: ${SLOPE.steep}° to ${SLOPE.scramble}°`, says: ['Slower going up, and it costs breath.', 'Going down you are carried faster than you walk.'] },
  { from: riseOf(SLOPE.scramble), colour: [238, 138, 48], head: `A scramble: ${SLOPE.scramble}° to ${SLOPE.climb}°`, says: ['Hands and feet, up or across: no sprint,', 'no jump, nothing held up to aim. Down is a slide.'] },
  { from: riseOf(SLOPE.climb), colour: [222, 52, 44], head: `A climb: over ${SLOPE.climb}°`, says: ['It goes for as long as you have breath.', 'Out of breath, it is a slide.'] },
];

const img = Buffer.alloc(N * N * 3);
const share = [0, 0, 0, 0];
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = -half + (i + 0.5) / per, z = -half + (j + 0.5) / per;
  const fx = Math.min(WORLD_RES - 1.001, Math.max(0, (x + half) / CELL)), fz = Math.min(WORLD_RES - 1.001, Math.max(0, (z + half) / CELL));
  const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
  const h00 = Hs[idx(ix, iz)], h10 = Hs[idx(ix + 1, iz)], h01 = Hs[idx(ix, iz + 1)], h11 = Hs[idx(ix + 1, iz + 1)];
  // (as the game reads the ground: the triangle by the corner 00, and the one by the corner 11)
  const [gx, gz] = u + v <= 1 ? [(h10 - h00) / CELL, (h01 - h00) / CELL] : [(h11 - h01) / CELL, (h11 - h10) / CELL];
  const h = u + v <= 1 ? h00 + gx * u * CELL + gz * v * CELL : h11 - gx * (1 - u) * CELL - gz * (1 - v) * CELL;
  const s = Math.hypot(gx, gz), k = (h - lo) / (hi - lo), light = Math.max(0.35, 0.62 + 0.38 * k - gx * 0.1);
  let c: [number, number, number] = [(62 + 96 * k) * light, (84 + 92 * k) * light, (58 + 84 * k) * light];
  let b = 0;
  for (let n = 0; n < BANDS.length; n++) if (s >= BANDS[n].from) b = n + 1;
  share[b]++;
  if (b) { const p = BANDS[b - 1].colour, m = 0.8; c = [c[0] * (1 - m) + p[0] * m, c[1] * (1 - m) + p[1] * m, c[2] * (1 - m) + p[2] * m]; }
  const o = (j * N + i) * 3;
  img[o] = Math.min(255, c[0]); img[o + 1] = Math.min(255, c[1]); img[o + 2] = Math.min(255, c[2]);
}
const all = share.reduce((a, n) => a + n, 0), pct = (n: number) => `${((100 * n) / all).toFixed(n / all < 0.02 ? 1 : 0)}%`;

const FONT = `font-family="Bahnschrift, Arial Narrow, Arial"`;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ${FONT}>`;
// the roads, and the places somebody would look for
for (const r of [world.road, ...world.roads]) {
  let d = '';
  for (let i = 0; i < r.points.length; i += 3) d += `${i ? 'L' : 'M'}${px(r.points[i]).toFixed(1)},${pz(r.points[i + 2]).toFixed(1)}`;
  svg += `<path d="${d}" fill="none" stroke="#141414" stroke-width="2.6" stroke-linejoin="round"/>`;
}
const NAMED = ['Zelenaya Dolina', 'Kamenka', 'Chemical Works', 'Bunker 17', 'Orlinoye', 'Army Camp', 'Military Checkpoint'];
for (const p of world.pois) {
  if (!NAMED.includes(p.name)) continue;
  svg += `<text x="${px(p.x).toFixed(0)}" y="${(pz(p.z) - 7).toFixed(0)}" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke" font-size="15" font-weight="600" text-anchor="middle">${p.name}</text>`;
}
// the key
const L = N + 44;
svg += `<rect x="${N}" y="0" width="${W - N}" height="${H}" fill="#0c0d0b"/>`;
svg += `<text x="${L}" y="92" fill="#f3efe6" font-size="54" font-weight="700" letter-spacing="5">STEEP GROUND</text>`;
svg += `<text x="${L}" y="130" fill="#d8cfb8" font-size="23">Never a wall. The steeper, the slower up</text>`;
svg += `<text x="${L}" y="158" fill="#d8cfb8" font-size="23">and the less sure down.</text>`;
let y = 236;
const row = (col: string, head: string, says: string[], part: string) => {
  svg += `<rect x="${L}" y="${y - 30}" width="40" height="40" fill="${col}" stroke="#000"/>`;
  svg += `<text x="${L + 60}" y="${y}" fill="#f3efe6" font-size="29" font-weight="600">${head}</text>`;
  svg += `<text x="${W - 44}" y="${y}" fill="#ffd35a" font-size="29" font-weight="600" text-anchor="end">${part}</text>`;
  says.forEach((t, k) => (svg += `<text x="${L + 60}" y="${y + 32 + k * 26}" fill="#d8cfb8" font-size="20">${t}</text>`));
  y += 142;
};
row('#6f8a62', `An ordinary hillside: under ${SLOPE.steep}°`, ['Nothing changes: walk, run and jump as before.'], pct(share[0]));
BANDS.forEach((b, n) => row(`rgb(${b.colour.join(',')})`, b.head, b.says, pct(share[n + 1])));
svg += `<text x="${L}" y="${H - 112}" fill="#d8cfb8" font-size="20">A face taken at a slant is a gentler climb.</text>`;
svg += `<text x="${L}" y="${H - 86}" fill="#d8cfb8" font-size="20">A slide gathers pace with the drop, and is a fall when it ends.</text>`;
svg += `<text x="${L}" y="${H - 60}" fill="#d8cfb8" font-size="20">Crouch to slow one.</text>`;
svg += `<text x="${W - 44}" y="${H - 26}" fill="rgba(243,239,230,0.42)" font-size="15" letter-spacing="3" text-anchor="end">SHARE OF THE WHOLE MAP · ZONAPVP.FUN</text>`;
svg += '</svg>';

await sharp(img, { raw: { width: N, height: N, channels: 3 } })
  .extend({ right: W - N, background: '#0c0d0b' })
  .composite([{ input: Buffer.from(svg) }])
  .jpeg({ quality: 86, mozjpeg: true })
  .toFile(out);
console.log('ordinary / steep / scramble / climb:', share.map(pct).join(' / '), '->', out);
