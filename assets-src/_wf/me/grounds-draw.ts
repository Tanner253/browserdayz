// npx tsx assets-src/_wf/me/grounds-draw.ts <hospital|police_hq> <out.png> [x0 x1 z0 z1]
// The grounds of a building from above, in the building's own measure (x along its front, z out the way it faces,
// drawn up the page), with nothing rendered: the ground (shaded by how far it is above or below the building's
// floor, a line every half metre), every building near, the roads, every tree, every thing stood about at its real
// size and turn, and every piece the generator builds there (walls of slabs, gate, kerbs). And by rule: a thing
// standing in a building, in another thing, on a road, or in a wall.
import fs from 'node:fs';
import sharp from 'sharp';
import * as THREE from 'three';
import { assets } from '../../../src/core/assets';
import { generateWorld, heightAt, BUILDING_FOOTPRINT } from '../../../src/world/worldgen';
import { Buildings } from '../../../src/world/buildings';

const [which = 'hospital', outFile = 'assets-src/_wf/me/out-plan/grounds.png', ...box] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync('public/assets/manifest.json', 'utf8')) as { models: Record<string, { min: number[]; max: number[] }> };
(assets as { manifest: unknown }).manifest = manifest;
const world = generateWorld();
const before = world.props.length;
const gen = new Buildings(world, null as never);
type Piece = { key: string; pts: [number, number][]; y0: number; y1: number };
const pieces: Piece[] = [];
let noting = false;
const G = gen as unknown as { push: (key: string, g: THREE.BufferGeometry) => void; planGrounds: () => void; planYards: () => void };
const push = G.push.bind(gen), grounds = G.planGrounds.bind(gen), yards = G.planYards.bind(gen);
G.push = (key, g) => {
  if (noting) {
    const p = g.getAttribute('position'), pts: [number, number][] = [];
    let y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < p.count; i++) {
      pts.push([p.getX(i), p.getZ(i)]);
      y0 = Math.min(y0, p.getY(i));
      y1 = Math.max(y1, p.getY(i));
    }
    pieces.push({ key, pts, y0, y1 });
  }
  push(key, g);
};
let firstGround = 0;
G.planGrounds = () => {
  noting = true;
  firstGround = world.props.length;
  grounds();
  noting = false;
};
G.planYards = () => {
  noting = true;
  yards();
  noting = false;
};
gen.plan();
// (`village`: the village whole, as the map lies: north up)
const b = which === 'village' ? { id: 'village', type: 'shed' as const, x: world.pois[0].x - 10, z: world.pois[0].z + 20, rot: Math.PI, floorY: heightAt(world.heights, world.pois[0].x, world.pois[0].z), seed: 0 } : world.buildings.find((q) => q.type === which)!;
const c = Math.cos(b.rot), s = Math.sin(b.rot);
const own = (x: number, z: number): [number, number] => [(x - b.x) * c - (z - b.z) * s, (x - b.x) * s + (z - b.z) * c];
const out = (lx: number, lz: number): [number, number] => [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
const [X0, X1, Z0, Z1] = box.length === 4 ? box.map(Number) : which === 'hospital' ? [-42, 34, -32, 50] : which === 'village' ? [-125, 125, -105, 115] : [-30, 30, -20, 34];
const S = Math.min(18, Math.floor(1500 / (X1 - X0))), W = Math.round((X1 - X0) * S), Hh = Math.round((Z1 - Z0) * S);
const px = (lx: number) => (lx - X0) * S, py = (lz: number) => (Z1 - lz) * S;
const hull = (pts: [number, number][]) => {
  const p = [...pts].sort((a, q) => a[0] - q[0] || a[1] - q[1]);
  const cross = (o: number[], a: number[], q: number[]) => (a[0] - o[0]) * (q[1] - o[1]) - (a[1] - o[1]) * (q[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
};
const poly = (pts: [number, number][]) => pts.map(([lx, lz]) => `${px(lx).toFixed(1)},${py(lz).toFixed(1)}`).join(' ');
const into = (A: [number, number][], B: [number, number][]) => {
  let least = Infinity;
  for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
    const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % P.length], nx = z1 - z0, nz = x0 - x1, l = Math.hypot(nx, nz) || 1;
    const pr = (Q: [number, number][]) => Q.map(([x, z]) => (x * nx + z * nz) / l);
    const a = pr(A), q = pr(B), o = Math.min(Math.max(...a), Math.max(...q)) - Math.max(Math.min(...a), Math.min(...q));
    if (o <= 0) return 0;
    least = Math.min(least, o);
  }
  return least;
};

// the ground
const img = Buffer.alloc(W * Hh * 3);
for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
  const lx = X0 + (i + 0.5) / S, lz = Z1 - (j + 0.5) / S, [x, z] = out(lx, lz);
  const h = heightAt(world.heights, x, z) - b.floorY;
  const k = Math.max(-1, Math.min(1, h / 3)), line = Math.abs(h * 2 - Math.round(h * 2)) < 0.035 * (1 + Math.abs(h)) ? 0.82 : 1;
  const o = (j * W + i) * 3, gi = Math.min(world.splat.length / 4 - 1, Math.round((z + 768) / 2) * 769 + Math.round((x + 768) / 2));
  const gravel = world.splat[gi * 4 + 3] / 255;
  const base = [118 + 70 * k, 138 + 30 * k - 20 * Math.abs(k), 96 - 40 * k];
  const col = [base[0] * (1 - gravel) + 168 * gravel, base[1] * (1 - gravel) + 150 * gravel, base[2] * (1 - gravel) + 120 * gravel];
  for (let q = 0; q < 3; q++) img[o + q] = Math.max(0, Math.min(255, col[q] * line));
}
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" font-family="Arial" font-size="9">`;
for (let gx = Math.ceil(X0 / 10) * 10; gx <= X1; gx += 10) svg += `<line x1="${px(gx)}" y1="0" x2="${px(gx)}" y2="${Hh}" stroke="#000" stroke-opacity="0.12"/><text x="${px(gx) + 2}" y="10" fill="#222">x ${gx}</text>`;
for (let gz = Math.ceil(Z0 / 10) * 10; gz <= Z1; gz += 10) svg += `<line x1="0" y1="${py(gz)}" x2="${W}" y2="${py(gz)}" stroke="#000" stroke-opacity="0.12"/><text x="2" y="${py(gz) - 2}" fill="#222">z ${gz}</text>`;
// roads
for (const road of [world.road, ...world.roads]) {
  const p = road.points;
  let d = '', pen = false;
  for (let i = 0; i < p.length / 3; i++) {
    const [lx, lz] = own(p[i * 3], p[i * 3 + 2]);
    if (lx < X0 - 30 || lx > X1 + 30 || lz < Z0 - 30 || lz > Z1 + 30) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${px(lx).toFixed(1)} ${py(lz).toFixed(1)} `;
    pen = true;
  }
  if (d.trim()) svg += `<path d="${d}" fill="none" stroke="#3a3a3c" stroke-opacity="0.85" stroke-width="${(road.width - 0.6) * S}" stroke-linejoin="round"/>`;
}
// buildings
const feet: { name: string; p: [number, number][]; kind: 'building' | 'thing' | 'piece' | 'tree'; tall: number }[] = [];
for (const q of world.buildings) {
  const [w, d] = BUILDING_FOOTPRINT[q.type], qc = Math.cos(q.rot), qs = Math.sin(q.rot);
  const p = ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as [number, number][]).map(([lx, lz]) => own(q.x + lx * qc + lz * qs, q.z - lx * qs + lz * qc));
  if (p.every(([lx, lz]) => lx < X0 - 5 || lx > X1 + 5 || lz < Z0 - 5 || lz > Z1 + 5)) continue;
  feet.push({ name: q.id, p, kind: 'building', tall: 9 });
  const [fx, fz] = own(q.x + (d / 2) * qs, q.z + (d / 2) * qc), [cx, cz] = own(q.x, q.z);
  svg += `<polygon points="${poly(p)}" fill="#efece2" stroke="#222"/><line x1="${px(p[2][0])}" y1="${py(p[2][1])}" x2="${px(p[3][0])}" y2="${py(p[3][1])}" stroke="#c0241c" stroke-width="2.5"/><text x="${px(cx)}" y="${py(cz)}" text-anchor="middle" fill="#333">${q.id}</text>`;
  void fx, fz;
}
// the generator's pieces
for (const pc of pieces) {
  const p = hull(pc.pts.map(([x, z]) => own(x, z)));
  if (p.every(([lx, lz]) => lx < X0 || lx > X1 || lz < Z0 || lz > Z1)) continue;
  feet.push({ name: `${pc.key} piece`, p, kind: 'piece', tall: pc.y1 - pc.y0 });
  const col = pc.key === 'steel' ? '#20262b' : pc.key === 'brick_ext' ? '#9a4a34' : '#77756c';
  svg += `<polygon points="${poly(p)}" fill="${col}" stroke="#111" stroke-width="0.5"/>`;
}
// things
world.props.forEach((q, k) => {
  if (q.far && k < firstGround) return;
  const [lx, lz] = own(q.x, q.z);
  if (lx < X0 || lx > X1 || lz < Z0 || lz > Z1) return;
  const e = manifest.models[q.kind.split(/[#@]/)[0]], sc = q.scale ?? 1;
  const qc = Math.cos(q.rot), qs = Math.sin(q.rot);
  const corners: [number, number][] = e ? [[e.min[0], e.min[2]], [e.max[0], e.min[2]], [e.max[0], e.max[2]], [e.min[0], e.max[2]]] : [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]];
  const p = corners.map(([ax, az]) => own(q.x + ax * sc * qc + az * sc * qs, q.z - ax * sc * qs + az * sc * qc));
  const mine = k >= firstGround;
  if (Math.abs(q.y - heightAt(world.heights, q.x, q.z)) > 0.6) return; // (indoors, upstairs)
  feet.push({ name: `${q.kind} at ${lx.toFixed(1)}, ${lz.toFixed(1)}${mine ? '' : ' (was there)'}`, p, kind: 'thing', tall: e ? e.max[1] * sc : 1 });
  const col = /lamp/.test(q.kind) ? '#f2c230' : /car/.test(q.kind) ? '#31506e' : /body/.test(q.kind) ? '#d8d6cc' : /barrier/.test(q.kind) ? '#9b9a94' : /bed|trolley|curtain|bench/.test(q.kind) ? '#3d7a4a' : '#7a4a22';
  svg += `<polygon points="${poly(p)}" fill="${col}" fill-opacity="${mine ? 0.95 : 0.5}" stroke="${mine ? '#000' : '#a00'}" stroke-width="0.8"/>`;
});
for (const t of world.trees) {
  const [lx, lz] = own(t.x, t.z);
  if (lx < X0 || lx > X1 || lz < Z0 || lz > Z1) continue;
  feet.push({ name: `${t.kind} at ${lx.toFixed(1)}, ${lz.toFixed(1)}`, p: [[lx - 0.3, lz - 0.3], [lx + 0.3, lz - 0.3], [lx + 0.3, lz + 0.3], [lx - 0.3, lz + 0.3]], kind: 'tree', tall: 8 });
  svg += `<circle cx="${px(lx)}" cy="${py(lz)}" r="${2.2 * S}" fill="#1f5a2a" fill-opacity="0.32" stroke="#1f5a2a"/><circle cx="${px(lx)}" cy="${py(lz)}" r="2.5" fill="#3a2a16"/>`;
}
svg += `<text x="8" y="${Hh - 8}" font-size="13" fill="#111">${which}: its grounds. Things stood by planGrounds: ${world.props.length - firstGround}; pieces built: ${pieces.length}. Front is up.</text></svg>`;

// by rule
let found = 0;
const say = (t: string) => {
  found++;
  console.log('  ' + t);
};
const roadsNear = [world.road, ...world.roads];
const onRoad = (p: [number, number][]) => {
  for (const road of roadsNear) {
    const r = road.points, half = (road.width - 0.6) / 2;
    for (let i = 0; i < r.length / 3 - 1; i++) {
      const a = own(r[i * 3], r[i * 3 + 2]), q = own(r[i * 3 + 3], r[i * 3 + 5]);
      if (Math.abs(a[0]) > 90 || Math.abs(a[1]) > 90) continue;
      const dx = q[0] - a[0], dz = q[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
      const seg: [number, number][] = [[a[0] + nx * half, a[1] + nz * half], [q[0] + nx * half, q[1] + nz * half], [q[0] - nx * half, q[1] - nz * half], [a[0] - nx * half, a[1] - nz * half]];
      const d = into(p, seg);
      if (d > 0.1) return d;
    }
  }
  return 0;
};
for (const [i, a] of feet.entries()) {
  if (a.kind === 'building') continue;
  const mine = !a.name.endsWith('(was there)');
  for (const [j, q] of feet.entries()) {
    if (i === j || (q.kind !== 'building' && j < i)) continue;
    if (a.kind === 'piece' && q.kind === 'piece') continue;
    if (!mine && q.kind !== 'piece' && q.name.endsWith('(was there)')) continue;
    if (/fern/.test(a.name) && /fern/.test(q.name)) continue;
    const d = into(a.p, q.p);
    if (d > (a.kind === 'tree' || q.kind === 'tree' ? 0.02 : 0.06)) say(`${a.name} is ${(d * 100).toFixed(0)} cm into ${q.name}`);
  }
  if (a.kind === 'thing' && !/barrier|trolley|trashbag|covered_car/.test(a.name) && mine) {
    const d = onRoad(a.p);
    if (d) say(`${a.name} stands ${(d * 100).toFixed(0)} cm onto a road`);
  }
  if (a.kind === 'piece' && a.tall > 0.5) {
    const d = onRoad(a.p);
    if (d) say(`a ${a.name} stands ${(d * 100).toFixed(0)} cm onto a road`);
  }
}
await sharp(img, { raw: { width: W, height: Hh, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toFile(outFile);
console.log(`${which}: ${outFile}; ${found ? found + ' found by rule' : 'nothing found by rule'}`);
