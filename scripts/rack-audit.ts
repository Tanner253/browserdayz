// Every rack on the map (the gun rack, the two racks of angle iron and boards), and whether it stands into anything:
// a wall, a door's way or swing, a window, or another piece of furniture; and how far its back is from the wall it is
// set against, at each end (equal: square to the wall). The owner, 2026-10-19: "the weapon rack in zstava and pretty
// much all location slips into the wall".
//
//   npx tsx scripts/rack-audit.ts         a count by place, and every rack that is wrong
//   npx tsx scripts/rack-audit.ts all     ... and every rack, right or wrong
//
// The buildings are laid out as the server lays them (Buildings.plan) and every box a body would be stopped by is
// noted as it is made; the bunker by its own plan (src/sim/bunker.ts), the field posts by their room (src/sim/posts.ts),
// the fort's racks of boards by its parts (src/sim/castle). A thing's size is the model's own (the manifest).

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { assets } from '../src/core/assets';
import { Buildings } from '../src/world/buildings';
import { generateWorld } from '../src/world/worldgen';
import { BUNKER, bunkerAt, bunkerPlan, inBunker, levelY } from '../src/sim/bunker';
import { bunkerPlace } from '../src/world/worldgen/layout';
import { POSTS, POST_ROOM, PILLBOX } from '../src/sim/posts';
import { CASTLE_SCALE, castleAt, castleParts } from '../src/sim/castle';

const ALL = process.argv[2] === 'all', JSON_OUT = process.argv.find((a) => a.endsWith('.json'));
const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'assets', 'manifest.json'), 'utf8'));
(assets as { manifest: unknown }).manifest = manifest;
const RACK = new Set(['gun_rack', 'rack_small', 'rack_wide']);
const size = (kind: string) => {
  const m = manifest.models?.[kind.split(/[#@]/)[0]] as { min: number[]; max: number[] } | undefined;
  return m ? { min: m.min, max: m.max } : null;
};

/** a box turned any way: its middle, its three axes (unit), its half sizes along them */
interface Obb { c: THREE.Vector3; ax: [THREE.Vector3, THREE.Vector3, THREE.Vector3]; h: [number, number, number] }
const yawObb = (x: number, y: number, z: number, rot: number, lo: number[], hi: number[], scale = 1, grow = [0, 0, 0]): Obb => {
  const cx = ((lo[0] + hi[0]) / 2) * scale, cy = ((lo[1] + hi[1]) / 2) * scale, cz = ((lo[2] + hi[2]) / 2) * scale;
  const c = Math.cos(rot), s = Math.sin(rot);
  return {
    c: new THREE.Vector3(x + cx * c + cz * s, y + cy, z - cx * s + cz * c),
    ax: [new THREE.Vector3(c, 0, -s), new THREE.Vector3(0, 1, 0), new THREE.Vector3(s, 0, c)],
    h: [((hi[0] - lo[0]) / 2) * scale + grow[0], ((hi[1] - lo[1]) / 2) * scale + grow[1], ((hi[2] - lo[2]) / 2) * scale + grow[2]],
  };
};
/** how far two boxes go into each other along the axis that parts them most (<= 0: apart) */
function depth(a: Obb, b: Obb): number {
  const axes: THREE.Vector3[] = [...a.ax, ...b.ax];
  for (const u of a.ax) for (const v of b.ax) {
    const w = new THREE.Vector3().crossVectors(u, v);
    if (w.lengthSq() > 1e-8) axes.push(w.normalize());
  }
  const d = new THREE.Vector3().subVectors(b.c, a.c);
  let least = Infinity;
  for (const n of axes) {
    const ra = a.h.reduce((t, h, i) => t + h * Math.abs(a.ax[i].dot(n)), 0), rb = b.h.reduce((t, h, i) => t + h * Math.abs(b.ax[i].dot(n)), 0);
    least = Math.min(least, ra + rb - Math.abs(d.dot(n)));
    if (least <= 0) return least;
  }
  return least;
}
/** where a ray from `o` along `dir` first meets a box, or Infinity */
function hit(o: THREE.Vector3, dir: THREE.Vector3, b: Obb): number {
  let t0 = -Infinity, t1 = Infinity;
  const p = new THREE.Vector3().subVectors(b.c, o);
  for (let i = 0; i < 3; i++) {
    const e = b.ax[i].dot(p), f = b.ax[i].dot(dir);
    if (Math.abs(f) > 1e-9) {
      let a = (e + b.h[i]) / f, c = (e - b.h[i]) / f;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
      if (t0 > t1 || t1 < 0) return Infinity;
    } else if (Math.abs(e) > b.h[i]) return Infinity;
  }
  return t0 >= 0 ? t0 : 0;
}

interface Rack { where: string; kind: string; x: number; y: number; z: number; rot: number; obb: Obb; lo: number[]; hi: number[]; /** where it is in the world, and its turn there, where its own measure is another's */ world?: [number, number, number, number] }
interface Solid { obb: Obb; what: string; glass?: boolean }
interface Found { rack: Rack; wrong: string[]; back: [number, number] }
const found: Found[] = [];

/** a rack against what is round it: solids (walls and what else stops a body), furniture, doors' ways; and, `backed`, how its back meets the wall */
function judge(rack: Rack, solids: Solid[], furniture: { obb: Obb; what: string }[], doors: { obb: Obb; what: string }[], backed = true) {
  const wrong: string[] = [];
  const { lo, hi } = rack;
  // (the rack less a centimetre all round, and its foot lifted off the floor it stands on)
  const body = yawObb(rack.x, rack.y + 0.03, rack.z, rack.rot, [lo[0] + 0.01, lo[1], lo[2] + 0.01], [hi[0] - 0.01, hi[1] - 0.04, hi[2] - 0.01]);
  for (const s of solids) {
    if (s.glass) continue;
    const dd = depth(body, s.obb);
    if (dd > 0) wrong.push(`into ${s.what} ${(dd * 100).toFixed(0)} cm`);
  }
  // (a window in the wall at its back, lower than the rack is tall: the rack before it)
  const behind = yawObb(rack.x, rack.y + 0.03, rack.z, rack.rot, [lo[0] + 0.05, lo[1], lo[2] - 0.45], [hi[0] - 0.05, hi[1] - 0.04, lo[2]]);
  for (const s of solids) if (s.glass && depth(behind, s.obb) > 0) wrong.push(`before ${s.what}`);
  for (const f of furniture) {
    const dd = depth(body, f.obb);
    if (dd > 0) wrong.push(`into ${f.what} ${(dd * 100).toFixed(0)} cm`);
  }
  for (const d of doors) if (depth(body, d.obb) > 0) wrong.push(`in ${d.what}`);
  // its back: from each end of it, a hand in from the side, at the height of a hip, straight back to the first solid
  const c = Math.cos(rack.rot), s = Math.sin(rack.rot), back = new THREE.Vector3(-s, 0, -c);
  const gaps = [lo[0] + 0.1, hi[0] - 0.1].map((lx) => {
    const lz = lo[2];
    const o = new THREE.Vector3(rack.x + lx * c + lz * s, rack.y + 0.9, rack.z - lx * s + lz * c).addScaledVector(back, -0.05);
    let t = Infinity;
    for (const q of solids) if (!q.glass) t = Math.min(t, hit(o, back, q.obb));
    return t - 0.05;
  }) as [number, number];
  if (!backed) gaps.fill(NaN);
  else if (gaps.some((g) => g > 0.12)) wrong.push(`back off the wall ${gaps.map((g) => (g === Infinity ? '-' : (g * 100).toFixed(0))).join('/')} cm`);
  else if (Math.abs(gaps[0] - gaps[1]) > 0.04) wrong.push(`not square to the wall ${gaps.map((g) => (g * 100).toFixed(0)).join('/')} cm`);
  found.push({ rack, wrong, back: gaps });
}

// ---- the buildings, as the server lays them, every box that stops a body noted as it is made
const world = generateWorld();
const b = new Buildings(world, null as never);
const boxes: Solid[] = [];
(Buildings.prototype as unknown as { collider: unknown }).collider = function (hx: number, hy: number, hz: number, m: THREE.Matrix4, surface: string) {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  const ax = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((v) => v.applyQuaternion(q)) as Obb['ax'];
  boxes.push({ obb: { c: p, ax, h: [hx * s.x, hy * s.y, hz * s.z] }, what: surface === 'glass' ? 'a window' : `a ${surface} wall`, glass: surface === 'glass' });
};
b.plan();

const named = (x: number, z: number) => {
  let best = '', bd = Infinity;
  for (const p of world.pois) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < Math.max(p.radius, 40) && d < bd) [best, bd] = [p.name, d];
  }
  for (const p of POSTS) if (Math.hypot(p.x - x, p.z - z) < 8) best = `field post ${Math.round(p.x)},${Math.round(p.z)}`;
  return best || `${Math.round(x)},${Math.round(z)}`;
};
const plotOf = (x: number, z: number) => {
  let best = '', bd = 18;
  for (const q of world.buildings) {
    const d = Math.hypot(q.x - x, q.z - z);
    if (d < bd) [best, bd] = [`${q.type}`, d];
  }
  return best;
};
// what is near each rack, by the square of the map it is in
const near = <T extends { obb: Obb }>(list: T[], x: number, z: number, r = 4) => list.filter((q) => Math.hypot(q.obb.c.x - x, q.obb.c.z - z) < r + Math.max(...q.obb.h));
const furn = world.props.flatMap((p) => {
  const sz = size(p.kind);
  return sz ? [{ obb: yawObb(p.x, p.y, p.z, p.rot, sz.min, sz.max, p.scale ?? 1, [-0.01, -0.01, -0.01]), what: p.kind.split(/[#@]/)[0], p }] : [];
});
// a door's way: the leaf's breadth, as far out as the leaf is wide on either side, as tall as the door
const doorWays = b.doorSpecs.map((d) => {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  d.m.decompose(p, q, s);
  const ax = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((v) => v.applyQuaternion(q)) as Obb['ax'];
  const c = p.clone().addScaledVector(ax[0], d.w / 2).addScaledVector(ax[1], d.h / 2);
  return { obb: { c, ax, h: [d.w / 2 - 0.02, d.h / 2 - 0.05, d.w - 0.02] as [number, number, number] }, what: `a door's way (${d.id})` };
});
for (const p of world.props) {
  const kind = p.kind.split(/[#@]/)[0];
  // (the bunker's are judged below, in its own measure)
  if (!RACK.has(kind) || inBunker(bunkerPlace(world), p.x, p.y + 0.5, p.z)) continue;
  const sz = size(kind)!;
  const rack: Rack = { where: `${named(p.x, p.z)} ${plotOf(p.x, p.z)}`.trim(), kind, x: p.x, y: p.y, z: p.z, rot: p.rot, obb: yawObb(p.x, p.y, p.z, p.rot, sz.min, sz.max), lo: sz.min, hi: sz.max };
  const others = near(furn, p.x, p.z).filter((f) => f.p !== p).map(({ obb, what }) => ({ obb, what }));
  // (a post's walls are the model's own: its room, from src/sim/posts.ts, stands in for them below)
  const post = POSTS.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 8);
  let solids = near(boxes, p.x, p.z);
  if (post) {
    const a = post.rot + Math.PI, R = PILLBOX.room, T = 0.4, H = 3;
    const wall = (x0: number, x1: number, z0: number, z1: number) => {
      const lx = (x0 + x1) / 2, lz = (z0 + z1) / 2, c = Math.cos(a), s = Math.sin(a);
      return { obb: yawObb(post.x + lx * c + lz * s, p.y + H / 2, post.z - lx * s + lz * c, a, [-(x1 - x0) / 2, -H / 2, -(z1 - z0) / 2], [(x1 - x0) / 2, H / 2, (z1 - z0) / 2]), what: 'the post\'s wall' };
    };
    solids = [wall(R.x0 - T, R.x0, R.z0 - T, R.z1 + T), wall(R.x1, R.x1 + T, R.z0 - T, R.z1 + T), wall(R.x0, R.x1, R.z1, R.z1 + T)];
  }
  judge(rack, solids, others, near(doorWays, p.x, p.z));
}

// ---- the bunker, in its own measure (r across, f forward; a thing turned as the world turns it)
{
  const plan = bunkerPlan(), Hh = 2.6;
  const solids: Solid[] = plan.walls.map((w) => {
    const y0 = w.y0 ?? 0;
    return { obb: yawObb((w.r0 + w.r1) / 2, (y0 + Hh) / 2, (w.f0 + w.f1) / 2, 0, [-(w.r1 - w.r0) / 2, -(Hh - y0) / 2, -(w.f1 - w.f0) / 2], [(w.r1 - w.r0) / 2, (Hh - y0) / 2, (w.f1 - w.f0) / 2]), what: 'the bunker\'s wall' };
  });
  const made = plan.made.filter((m) => m.solid !== false && !['sign', 'stain', 'stripe', 'scrawl', 'duct', 'pipe'].includes(m.kind) && !(m.y && m.y > 1.8))
    .map((m) => ({ obb: yawObb(m.r, m.y ?? 0, m.f, m.rot, [-m.w / 2, 0, -m.d / 2], [m.w / 2, m.h, m.d / 2], 1, [-0.01, -0.01, -0.01]), what: `a made ${m.kind}` }));
  const stood = plan.stood.flatMap((st) => {
    const sz = size(st.id);
    return sz ? [{ obb: yawObb(st.r, st.y ?? 0, st.f, st.rot, sz.min, sz.max, st.scale ?? 1, [-0.01, -0.01, -0.01]), what: st.id, st }] : [];
  });
  // (each room's ways in: as far in as a door is wide on either side of it)
  const ways = plan.rooms.flatMap((q) => q.doors.map(([r, f]) => {
    const across = Math.abs(r - q.r0) < 0.5 || Math.abs(r - q.r1) < 0.5;
    return { obb: yawObb(r, 0, f, across ? Math.PI / 2 : 0, [-0.9, 0, -0.9], [0.9, 2.1, 0.9]), what: `a way into ${q.name}` };
  }));
  const roomOf = (r: number, f: number) => plan.rooms.find((q) => r >= q.r0 && r <= q.r1 && f >= q.f0 && f <= q.f1)?.name ?? '?';
  for (const st of plan.stood) {
    if (!RACK.has(st.id)) continue;
    const sz = size(st.id)!;
    const at = bunkerPlace(world)!, [wx, wy, wz] = bunkerAt(at, st.r, st.f, levelY() + (st.y ?? 0));
    const rack: Rack = { where: `Bunker 17 ${roomOf(st.r, st.f)}`, kind: st.id, x: st.r, y: st.y ?? 0, z: st.f, rot: st.rot, obb: yawObb(st.r, 0, st.f, st.rot, sz.min, sz.max), lo: sz.min, hi: sz.max, world: [wx, wy, wz, st.rot + at.rot] };
    judge(rack, solids, [...made, ...stood.filter((q) => q.st !== st)], ways);
  }
  void BUNKER;
}
void POST_ROOM;

// ---- the fort's racks of boards, in its own measure, against its own boxes (a box turned about its middle by `yaw`).
// (Open shelves, with no back: how far each stands from its wall is not judged here, as the rooms under the terrace are
// walled by its vaults, which are no boxes. Measured against UNDER.mid and UNDER.armoury on 2026-10-19: 12 cm, each.)
{
  const parts = castleParts().filter((p) => p.t === 'box') as { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; yaw?: number; name?: string; hidden?: boolean }[];
  const obbOf = (p: (typeof parts)[number], grow = 0) => yawObb((p.x0 + p.x1) / 2, p.y0, (p.z0 + p.z1) / 2, p.yaw ?? 0, [-(p.x1 - p.x0) / 2, 0, -(p.z1 - p.z0) / 2], [(p.x1 - p.x0) / 2, p.y1 - p.y0, (p.z1 - p.z0) / 2], 1, [grow, grow, grow]);
  const named = new Set(['table', 'bench', 'bunk', 'rack']);
  const solids: Solid[] = parts.filter((p) => !named.has(p.name ?? '') && p.y1 - p.y0 > 0.3).map((p) => ({ obb: obbOf(p), what: `the fort's ${p.name ?? 'wall'}` }));
  const furniture = parts.filter((p) => named.has(p.name ?? '') && p.hidden).map((p) => ({ obb: obbOf(p, -0.01), what: `the fort's ${p.name}`, p }));
  for (const f of furniture) {
    if (f.what !== "the fort's rack") continue;
    const p = f.p, hw = (p.x1 - p.x0) / 2, hd = (p.z1 - p.z0) / 2;
    const fort = world.castle!, [wx, wy, wz] = castleAt(fort, (p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, p.y0);
    const rack: Rack = { where: `Orlinoye fort y ${p.y0.toFixed(1)}`, kind: 'fort rack', x: (p.x0 + p.x1) / 2, y: p.y0, z: (p.z0 + p.z1) / 2, rot: p.yaw ?? 0, obb: obbOf(p), lo: [-hw, 0, -hd], hi: [hw, p.y1 - p.y0, hd], world: [wx, wy, wz, (p.yaw ?? 0) + fort.rot] };
    judge(rack, solids, furniture.filter((q) => q !== f), [], false);
  }
}

// ---- the count
const by = new Map<string, { n: number; bad: number }>();
for (const f of found) {
  const key = f.rack.where.replace(/ [a-z_]+$/, '');
  const e = by.get(key) ?? by.set(key, { n: 0, bad: 0 }).get(key)!;
  e.n++;
  if (f.wrong.length) e.bad++;
}
const bad = found.filter((f) => f.wrong.length);
console.log(`${found.length} racks, ${bad.length} wrong (${found.filter((f) => f.rack.kind === 'gun_rack').length} gun racks, ${bad.filter((f) => f.rack.kind === 'gun_rack').length} of them wrong)\n`);
for (const [k, e] of [...by].sort((a, b) => b[1].bad - a[1].bad)) console.log(`${String(e.bad).padStart(3)} / ${String(e.n).padEnd(3)} ${k}`);
console.log('');
for (const f of ALL ? found : bad) console.log(`${f.rack.kind.padEnd(10)} ${f.rack.where.padEnd(34)} (${f.rack.x.toFixed(2)}, ${f.rack.z.toFixed(2)}) ${f.wrong.join('; ') || 'ok'} [back ${f.back.map((g) => (g === Infinity ? '-' : Number.isNaN(g) ? '?' : (g * 100).toFixed(0))).join('/')}]`);
// (a failure, for test/racks.test.ts, when any rack is wrong)
process.exitCode = bad.length ? 1 : 0;
// (and, given a file, every rack as it stands in the world, for a script that looks at them: scripts/rack-look.js)
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(found.map((f) => {
  const [x, y, z, rot] = f.rack.world ?? [f.rack.x, f.rack.y, f.rack.z, f.rack.rot];
  return { kind: f.rack.kind, where: f.rack.where, x: +x.toFixed(3), y: +y.toFixed(3), z: +z.toFixed(3), rot: +rot.toFixed(4), wrong: f.wrong };
}), null, 1));
void CASTLE_SCALE;
