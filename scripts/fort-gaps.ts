// GAPS IN THE FORT, AS A PLAYER SEES THEM (the owner, 2026-10-23: "theres gaps in between walls all over that castle
// and it needs polishing"). Everything the game draws of the fort from near (the kit's pieces as stood and cut, with
// what closes their cuts; the door; the scanned rocks; the fort's own shapes; the post's), and the ground as the
// terrain draws it, are ray-cast in depth pictures from every place a body can stand in it and about it, and from
// the air. Wherever a line one or two rays wide sees past a surface that goes on either side of it, the opening is
// measured across with fine rays: two edges closer than GAP with the far side seen between them is a gap.
//
//   npx tsx scripts/fort-gaps.ts [out.json] [--res 256] [--eyes 320] [--threads 8]
//
// Places are said in the fort's own measure (x, z, over the terrace: as src/sim/castle/ has them) and in the world's.

import fs from 'node:fs';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { NodeIO, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { KitCaps, backedOut, kitMatrix, kitPoint, standTriangles, type KitPiece } from '../src/sim/kit';
import { CASTLE_SCALE, castleAt, castleDoor, castleKit, castleLocal, castleRocks, castleHides, castleUnder } from '../src/sim/castle';
import { postMade } from '../src/sim/castle-post';
import { SHEETS, castleShapeIn, type Shape } from '../src/world/castle-shape';
import { postShape } from '../src/world/castle-post-shape';
import { CELL, WORLD_X0, WORLD_Z0, bunkerPlace, generateWorld, heightAt, idx, seenGround } from '../src/world/worldgen';

const arg = (k: string, d: number) => (process.argv.includes(k) ? Number(process.argv[process.argv.indexOf(k) + 1]) : d);
const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'fort-gaps.json';
const RES = arg('--res', 256), EYES = arg('--eyes', 320), THREADS = arg('--threads', 8), GAP = 0.12, FAR = 60, S = CASTLE_SCALE;
const t0 = Date.now(), secs = () => ((Date.now() - t0) / 1000).toFixed(0) + ' s';

// ------------------------------------------------------------------ what is drawn, in metres from the fort's middle, turned as it is
async function gather() {
  const world = generateWorld(), P = world.castle!;
  const things: string[] = [], Pos: number[] = [], Of: number[] = [];
  const thing = (name: string) => things.push(name) - 1;
  const tri = (t: number, p: ArrayLike<number>, from = 0, s = S) => {
    for (let k = 0; k < 9; k++) Pos.push(p[from + k] * s);
    Of.push(t);
  };
  const mul4 = (a: number[], b: number[]) => {
    const o = new Array<number>(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  };
  // (the kit's pieces as src/world/kit.ts stands them, read as test/castle-faces.test.ts reads them)
  const kit = async (file: string, layout: KitPiece[]) => {
    await MeshoptDecoder.ready;
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(path.join(process.cwd(), 'public/assets/models', file));
    const find = (n: Node, id: string): Node | null => (n.getName() === id ? n : n.listChildren().reduce<Node | null>((got, k) => got ?? find(k, id), null));
    for (const p of layout) {
      const top = doc.getRoot().listScenes().flatMap((s) => s.listChildren()).reduce<Node | null>((got, k) => got ?? find(k, p.id), null);
      if (!top) throw new Error(`${file} has no ${p.id}`);
      const m = kitMatrix(p), caps = new KitCaps(p.cut ?? []);
      const walk = (n: Node, own: number[]) => {
        for (const prim of n.getMesh()?.listPrimitives() ?? []) {
          const at = prim.getAttribute('POSITION')!, index = prim.getIndices(), mat = prim.getMaterial(), v = [0, 0, 0], pts: number[][] = [];
          for (let i = 0; i < at.getCount(); i++) {
            at.getElement(i, v);
            pts.push([own[0] * v[0] + own[4] * v[1] + own[8] * v[2] + own[12], own[1] * v[0] + own[5] * v[1] + own[9] * v[2] + own[13], own[2] * v[0] + own[6] * v[1] + own[10] * v[2] + own[14]]);
          }
          const idxs = index ? Array.from(index.getArray()!) : pts.map((_, i) => i), flat = new Float64Array(idxs.length * 3);
          idxs.forEach((i, k) => flat.set(pts[i], k * 3));
          const backs = mat?.getDoubleSided() ? backedOut(flat) : null, t = thing(`${p.name ?? p.id} [${mat?.getName() ?? ''}]`);
          const stood = pts.map((c) => [...kitPoint(m, [c[0], c[1], c[2]]), 0, 0, 0, 0, 0]);
          if (caps.wanted) caps.take(stood, idxs, 'stone');
          let q: number[] = [];
          standTriangles(stood, idxs, p.cut ?? [], backs, (c) => {
            q.push(c[0], c[1], c[2]);
            if (q.length === 9) void (tri(t, q), (q = []));
          });
        }
        for (const k of n.listChildren()) walk(k, mul4(own, k.getMatrix()));
      };
      walk(top, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      if (!caps.wanted) continue;
      const t = thing(`what closes the cuts of the ${p.name ?? p.id}`);
      let q: number[] = [];
      caps.put((_, c) => {
        q.push(c[0], c[1], c[2]);
        if (q.length === 9) void (tri(t, q), (q = []));
      });
    }
  };
  const seen = (x: number, z: number) => heightAt(world.surface, x, z);
  const localGround = (x: number, z: number) => { const [wx, , wz] = castleAt(P, x, z); return (seen(wx, wz) - P.y) / S; };
  await kit('fort_kit.glb', castleKit());
  await kit('large_castle_door.glb', castleDoor());
  await kit('rock_face_01.glb', castleRocks(localGround, P.rock !== false));
  const steps = castleShapeIn(P, seen);
  let shape: Shape;
  for (;;) { const r = steps.next(); if (r.done) { shape = r.value; break; } }
  for (const [set, low] of [[shape.near, false], [shape.under, true]] as const) for (const s of SHEETS) {
    if (s === 'water') continue;
    const t = thing(`the fort's own ${s}${low ? ' (lower levels)' : ''}`);
    for (let k = 0; k < set[s].pos.length; k += 9) tri(t, set[s].pos, k);
  }
  const skins = postShape(postMade(), localGround);
  for (const s of ['hard', 'cloth'] as const) {
    const t = thing(`the post's ${s}`);
    for (let k = 0; k < skins[s].pos.length; k += 9) tri(t, skins[s].pos, k);
  }
  const fort = Of.length;
  // the ground as the terrain draws it (diagonal b-c), within 70 m: the squares it does not draw are left out
  const { heights: drawn, open } = seenGround(world, bunkerPlace(world)), g = thing('ground'), R = 70;
  const ix0 = Math.floor((P.x - R - WORLD_X0) / CELL), ix1 = Math.ceil((P.x + R - WORLD_X0) / CELL), iz0 = Math.floor((P.z - R - WORLD_Z0) / CELL), iz1 = Math.ceil((P.z + R - WORLD_Z0) / CELL);
  const at = (ix: number, iz: number) => { const [x, z, y] = castleLocal(P, WORLD_X0 + ix * CELL, drawn[idx(ix, iz)], WORLD_Z0 + iz * CELL); return [x * S, y * S, z * S]; };
  for (let iz = iz0; iz < iz1; iz++) for (let ix = ix0; ix < ix1; ix++) {
    if (open && open[idx(ix, iz)]) continue;
    const a = at(ix, iz), b = at(ix + 1, iz), c = at(ix, iz + 1), d = at(ix + 1, iz + 1);
    tri(g, [...a, ...c, ...b], 0, 1);
    tri(g, [...b, ...c, ...d], 0, 1);
  }
  const T = new Float64Array(new SharedArrayBuffer(Pos.length * 8)), O = new Int32Array(new SharedArrayBuffer(Of.length * 4));
  T.set(Pos);
  O.set(Of);
  return { T, Of: O, things, fort, P, heights: world.heights };
}

// ------------------------------------------------------------------ a tree of boxes over them, and a ray through it
let T: Float64Array, Of: Int32Array, order: Uint32Array, B: Float64Array, things: string[];
function build(): void {
  const N = Of.length, cen = new Float64Array(N * 3), nodes: number[] = []; // per node: lo xyz, hi xyz, second child | first, count (0: inner)
  order = new Uint32Array(new SharedArrayBuffer(N * 4)).map((_, i) => i);
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) cen[i * 3 + k] = (T[i * 9 + k] + T[i * 9 + 3 + k] + T[i * 9 + 6 + k]) / 3;
  const node = (from: number, to: number): number => {
    const me = nodes.length / 8;
    nodes.push(0, 0, 0, 0, 0, 0, 0, 0);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], clo = [Infinity, Infinity, Infinity], chi = [-Infinity, -Infinity, -Infinity];
    for (let i = from; i < to; i++) {
      const t = order[i];
      for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) { const x = T[t * 9 + v * 3 + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
      for (let k = 0; k < 3; k++) { const c = cen[t * 3 + k]; if (c < clo[k]) clo[k] = c; if (c > chi[k]) chi[k] = c; }
    }
    for (let k = 0; k < 3; k++) { nodes[me * 8 + k] = lo[k] - 1e-6; nodes[me * 8 + 3 + k] = hi[k] + 1e-6; }
    if (to - from <= 4) { nodes[me * 8 + 6] = from; nodes[me * 8 + 7] = to - from; return me; }
    const ax = chi[0] - clo[0] >= chi[1] - clo[1] && chi[0] - clo[0] >= chi[2] - clo[2] ? 0 : chi[1] - clo[1] >= chi[2] - clo[2] ? 1 : 2;
    order.set(Array.from(order.subarray(from, to)).sort((a, b) => cen[a * 3 + ax] - cen[b * 3 + ax]), from);
    const mid = (from + to) >> 1;
    node(from, mid);
    nodes[me * 8 + 6] = node(mid, to);
    return me;
  };
  node(0, N);
  B = new Float64Array(new SharedArrayBuffer(nodes.length * 8));
  B.set(nodes);
}
const stack = new Int32Array(128);
let hitT = 0, hitTri = -1, hitU = 0, hitV = 0;
/** the first triangle along a ray within `far` (hitT, hitTri; -1 none) */
function cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far = FAR): number {
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  hitT = far; hitTri = -1;
  let sp = 0;
  stack[sp++] = 0;
  while (sp) {
    const n = stack[--sp] * 8;
    let t1 = (B[n] - ox) * ix, t2 = (B[n + 3] - ox) * ix, tn = Math.min(t1, t2), tf = Math.max(t1, t2);
    t1 = (B[n + 1] - oy) * iy; t2 = (B[n + 4] - oy) * iy; tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2));
    t1 = (B[n + 2] - oz) * iz; t2 = (B[n + 5] - oz) * iz; tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2));
    if (tf < tn || tf < 0 || tn > hitT) continue;
    const count = B[n + 7];
    if (!count) { stack[sp++] = n / 8 + 1; stack[sp++] = B[n + 6]; continue; }
    for (let i = B[n + 6], e = i + count; i < e; i++) {
      const t = order[i], o = t * 9;
      const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2], e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) continue;
      const inv = 1 / det, sx = ox - T[o], sy = oy - T[o + 1], sz = oz - T[o + 2], u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (d > 1e-4 && d < hitT) { hitT = d; hitTri = t; hitU = u; hitV = v; }
    }
  }
  return hitTri;
}
const normalY = (t: number) => {
  const o = t * 9, ux = T[o + 3] - T[o], uy = T[o + 4] - T[o + 1], uz = T[o + 5] - T[o + 2], vx = T[o + 6] - T[o], vy = T[o + 7] - T[o + 1], vz = T[o + 8] - T[o + 2];
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
  return y / (Math.hypot(x, y, z) || 1);
};

// ------------------------------------------------------------------ the pictures from an eye, and the thin lines in them that see past
interface Gap { at: number[]; w: number; a: number; b: number; eye: number; look: number[] }
const faces: [number[], number[], number[]][] = [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
const dirAt = (f: (typeof faces)[number], i: number, j: number) => {
  const u = ((i + 0.5) / RES) * 2 - 1, v = ((j + 0.5) / RES) * 2 - 1, d = [0, 1, 2].map((k) => f[0][k] + f[1][k] * u + f[2][k] * v), l = Math.hypot(d[0], d[1], d[2]);
  return d.map((c) => c / l);
};
let rays = 0;
/** across from one ray to another (both on surfaces): where the far side is seen between them, how wide the opening is */
function across(e: number[], da: number[], db: number[], near: number): { w: number; a: number; b: number; at: number[]; look: number[] } | null {
  const K = 40, open: boolean[] = [];
  const lerp = (s: number) => { const d = [0, 1, 2].map((k) => da[k] + (db[k] - da[k]) * s), l = Math.hypot(d[0], d[1], d[2]); return d.map((c) => c / l); };
  const deep = (d: number[]) => { rays++; cast(e[0], e[1], e[2], d[0], d[1], d[2]); return hitTri < 0 || hitT > near * 1.05 + 0.3; };
  for (let k = 0; k <= K; k++) open.push(deep(lerp(k / K)));
  const first = open.indexOf(true), last = open.lastIndexOf(true);
  if (first <= 0 || last >= K || open.slice(first, last + 1).some((o) => !o)) return null;
  // (each edge found to a hair)
  const edge = (s0: number, s1: number) => {
    for (let n = 0; n < 24; n++) { const m = (s0 + s1) / 2; if (deep(lerp(m))) s1 = m; else s0 = m; }
    const d = lerp(s0);
    cast(e[0], e[1], e[2], d[0], d[1], d[2]);
    return { p: [e[0] + d[0] * hitT, e[1] + d[1] * hitT, e[2] + d[2] * hitT], t: hitTri };
  };
  const A = edge((first - 1) / K, first / K), Z = edge((last + 1) / K, last / K);
  if (A.t < 0 || Z.t < 0) return null;
  return { w: Math.hypot(A.p[0] - Z.p[0], A.p[1] - Z.p[1], A.p[2] - Z.p[2]), a: A.t, b: Z.t, at: A.p.map((v, k) => (v + Z.p[k]) / 2), look: lerp((first + last) / 2 / K) };
}
function look(e: number[], n: number, out: Gap[]): void {
  const depth = new Float64Array(RES * RES);
  for (const f of faces) {
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
      const d = dirAt(f, i, j);
      rays++;
      cast(e[0], e[1], e[2], d[0], d[1], d[2]);
      depth[j * RES + i] = hitTri < 0 ? Infinity : hitT;
    }
    for (let j = 2; j < RES - 2; j++) for (let i = 2; i < RES - 2; i++) {
      const c = depth[j * RES + i];
      tries: for (const [di, dj] of [[1, 0], [0, 1]]) for (const wide of [1, 2]) {
        // (a line one ray wide: a, c, b; or two: a, c, c2, b)
        const a = depth[(j - dj) * RES + i - di], b = depth[(j + dj * wide) * RES + i + di * wide];
        if (!(a < 40 && b < 40)) continue;
        const near = Math.max(a, b);
        if (!(c > near * 1.05 + 0.3) || (wide === 2 && !(depth[(j + dj) * RES + i + di] > near * 1.05 + 0.3))) continue;
        if (Math.abs(a - b) > 0.35 * Math.min(a, b) + 0.2) continue;
        const g = across(e, dirAt(f, i - di, j - dj), dirAt(f, i + di * wide, j + dj * wide), near);
        if (g && g.w < GAP) { out.push({ ...g, eye: n }); break tries; }
      }
    }
  }
}

if (!isMainThread) {
  ({ T, Of, order, B } = workerData);
  const out: Gap[] = [];
  for (const [n, e] of workerData.eyes as [number, number[]][]) {
    look(e, n, out);
    parentPort!.postMessage({ done: n });
  }
  parentPort!.postMessage({ out, rays });
} else {
  const soup = await gather(), P = soup.P;
  ({ T, Of, things } = soup);
  console.log(`${soup.fort} triangles of the fort, ${Of.length - soup.fort} of the ground (${secs()})`);
  build();
  const view = process.argv.indexOf('--view');
  if (view > 0) {
    // `--view <places.json> <k>`: the k-th place of a scan pictured from its eye, close (a metre and a half across),
    // each thing in its own hue, the place at the cross; and the triangles within 10 cm of it
    const from = process.argv[view + 1], scan = JSON.parse(fs.readFileSync(from, 'utf8'));
    for (const k of process.argv[view + 2].split(',').map(Number)) {
    const pl = scan.places[k];
    const e = pl.eyeOwn.map((v: number) => v * S), at = [pl.own[0] * S, pl.own[2] * S, pl.own[1] * S], W = 480;
    const f = [0, 1, 2].map((i) => at[i] - e[i]), dist = Math.hypot(f[0], f[1], f[2]), fw = f.map((v) => v / dist);
    const r0 = [fw[2], 0, -fw[0]], rl = Math.hypot(r0[0], r0[2]) || 1, rt = r0.map((v) => v / rl), up = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2], rt[0] * fw[1] - rt[1] * fw[0]];
    const span = process.argv.includes("--wide") ? 0.6 : Math.min(1, 0.75 / dist), px = Buffer.alloc(W * W * 3);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const u = ((i + 0.5) / W - 0.5) * 2 * span, v = (0.5 - (j + 0.5) / W) * 2 * span, d = [0, 1, 2].map((q) => fw[q] + rt[q] * u + up[q] * v), l = Math.hypot(d[0], d[1], d[2]);
      cast(e[0], e[1], e[2], d[0] / l, d[1] / l, d[2] / l);
      let c = [200, 225, 255];
      if (hitTri >= 0) {
        const o = hitTri * 9, ux = T[o + 3] - T[o], uy = T[o + 4] - T[o + 1], uz = T[o + 5] - T[o + 2], vx = T[o + 6] - T[o], vy = T[o + 7] - T[o + 1], vz = T[o + 8] - T[o + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, lit = 0.35 + 0.65 * Math.abs((nx * d[0] + ny * d[1] + nz * d[2]) / l / (Math.hypot(nx, ny, nz) || 1));
        const h = Of[hitTri] * 0.618, hue = [0, 2, 4].map((s) => 0.55 + 0.45 * Math.cos(6.283 * (h + s / 6)));
        // (a triangle's edges dark; what is over a metre behind the place washed out, so a crack shows pale)
        const edge = Math.min(hitU, hitV, 1 - hitU - hitV) < 0.012 ? 0.55 : 1, fog = Math.min(1, Math.max(0, (hitT - dist - 0.15) / 1));
        c = hue.map((x) => Math.round(255 * (x * lit * edge * (1 - fog) + 0.92 * fog)));
      }
      if ((Math.abs(i - W / 2) < 9 && Math.abs(j - W / 2) < 1) || (Math.abs(j - W / 2) < 9 && Math.abs(i - W / 2) < 1)) c = [255, 0, 0];
      px.set(c, (j * W + i) * 3);
    }
    const sharp = (await import('sharp')).default, png = from.replace(/\.json$/, `-${k}.png`);
    await sharp(px, { raw: { width: W, height: W, channels: 3 } }).png().toFile(png);
    console.log(`${k} at own (${pl.own.join(', ')}): ${dist.toFixed(2)} m from the eye, ${(span * 2 * dist).toFixed(2)} m across; ${pl.cm.join('-')} cm, ${pl.between.join(' ; ')}`);
    if (!process.argv.includes('--tris')) continue;
    const near = new Map<string, number[][]>();
    for (let t = 0; t < Of.length; t++) {
      const o = t * 9;
      let dmin = Infinity;
      for (let q = 0; q < 3; q++) dmin = Math.min(dmin, Math.hypot(T[o + q * 3] - at[0], T[o + q * 3 + 1] - at[1], T[o + q * 3 + 2] - at[2]));
      if (dmin > 0.25) continue;
      const list = near.get(things[Of[t]]) ?? near.set(things[Of[t]], []).get(things[Of[t]])!;
      list.push([0, 1, 2].map((q) => +(T[o + q * 3] / S).toFixed(3)).concat([0, 1, 2].map((q) => +(T[o + q * 3 + 1] / S).toFixed(3)), [0, 1, 2].map((q) => +(T[o + q * 3 + 2] / S).toFixed(3))));
    }
    for (const [name, list] of near) console.log(`  ${name}: ${list.length} triangles with a corner within 25 cm (x x x / y y y / z z z, own measure):\n    ${list.slice(0, 14).map((r) => `[${r.slice(0, 3)} / ${r.slice(3, 6)} / ${r.slice(6)}]`).join('\n    ')}`);
    }
    process.exit(0);
  }
  // ---- where an eye may be: on every floor of it with room to stand, round its foot, and in the air
  const ground = things.length - 1, hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const fortEyes: number[][] = [], footEyes: number[][] = [];
  for (let x = -34; x <= 34; x += 1.1) for (let z = -34; z <= 34; z += 1.1) {
    let y = 40;
    for (let n = 0; n < 12; n++) {
      if (cast(x, y, z, 1e-9, -1, 1e-9, 80) < 0) break;
      const t = hitTri, fy = y - hitT;
      y = fy - 0.02;
      // (a floor faces up, the ray goes on under it, and over it is room to stand)
      if (normalY(t) < 0.6) continue;
      cast(x, fy + 0.05, z, 1e-9, 1, 1e-9, 2);
      if (hitTri >= 0) continue;
      if (Of[t] === ground) { if (Math.hypot(x, z) < 30) footEyes.push([x, fy + 1.6, z]); break; }
      // (under the terrace a body is only in the lower levels and the passage the server lets it be in: not inside the
      // kit's hollow pieces, where the eye finder finds floors nobody stands on)
      const [wx, wy, wz] = castleAt(P, x / S, z / S, (fy + 0.3) / S);
      if (fy < -0.3 && castleHides(P, wx, wy, wz) && !castleUnder(P, wx, wy, wz, (a, b) => heightAt(soup.heights, a, b))) continue;
      fortEyes.push([x, fy + 1.6, z]);
    }
  }
  const pick = (from: number[][], n: number) => from.map((e) => [hash(e[0], e[2] + e[1]), e] as const).sort((a, b) => a[0] - b[0]).slice(0, n).map(([, e]) => e);
  const eyes = [...pick(fortEyes, Math.round(EYES * 0.75)), ...pick(footEyes, Math.round(EYES * 0.2))];
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, r = k % 2 ? 26 : 45; eyes.push([Math.cos(a) * r, k % 2 ? 14 : 28, Math.sin(a) * r]); }
  console.log(`${fortEyes.length} places to stand in the fort, ${footEyes.length} round its foot: ${eyes.length} eyes, ${THREADS} threads (${secs()})`);
  // ---- the eyes shared out
  const gaps: Gap[] = [];
  let done = 0, all = 0;
  await Promise.all([...Array(THREADS).keys()].map((w) => new Promise<void>((ok, no) => {
    const mine = eyes.map((e, n) => [n, e] as [number, number[]]).filter(([n]) => n % THREADS === w);
    // (a thread does not take tsx's loader from its parent: it is registered first, then this file is loaded)
    const boot = `import('tsx/esm/api').then((m) => { m.register(); return import(${JSON.stringify(import.meta.url)}); })`;
    const wk = new Worker(boot, { eval: true, workerData: { T, Of, order, B, eyes: mine }, argv: process.argv.slice(2) });
    wk.on('message', (m) => {
      if (m.out) return void (gaps.push(...m.out), (all += m.rays));
      if (++done % 20 === 0) console.log(`  ${done} of ${eyes.length} eyes (${secs()})`);
    });
    wk.on('error', no);
    wk.on('exit', () => ok());
  })));
  // ---- the sightings gathered into places
  const cell = 0.3, places = new Map<string, { n: number; w0: number; w1: number; at: number[]; pairs: Map<string, number>; eye: number; look: number[]; eyes: Set<number> }>();
  for (const g of gaps) {
    const k = g.at.map((v) => Math.round(v / cell)).join(',');
    const p = places.get(k) ?? places.set(k, { n: 0, w0: Infinity, w1: 0, at: g.at, pairs: new Map(), eye: g.eye, look: g.look, eyes: new Set() }).get(k)!;
    p.n++; p.w0 = Math.min(p.w0, g.w); p.w1 = Math.max(p.w1, g.w);
    p.eyes.add(g.eye);
    const pair = [things[Of[g.a]], things[Of[g.b]]].sort().join(' | ');
    p.pairs.set(pair, (p.pairs.get(pair) ?? 0) + 1);
  }
  const list = [...places.values()].sort((a, b) => b.eyes.size - a.eyes.size || b.n - a.n).map((p) => {
    const own = p.at.map((v) => +(v / S).toFixed(2)), e = eyes[p.eye];
    return { own: [own[0], own[2], own[1]], world: castleAt(P, own[0], own[2], own[1]).map((v) => +v.toFixed(2)), sightings: p.n, eyes: p.eyes.size, cm: [+(p.w0 * 100).toFixed(1), +(p.w1 * 100).toFixed(1)], between: [...p.pairs.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 3), eye: castleAt(P, e[0] / S, e[2] / S, e[1] / S).map((v) => +v.toFixed(2)), eyeOwn: e.map((v) => +(v / S).toFixed(2)), look: p.look.map((v) => +v.toFixed(3)) };
  });
  fs.writeFileSync(OUT, JSON.stringify({ res: RES, eyes: eyes.length, rays: all, sightings: gaps.length, places: list }, null, 1));
  console.log(`${gaps.length} sightings of a gap under ${GAP * 100} cm in ${list.length} places, from ${eyes.length} eyes (${(all / 1e6).toFixed(0)}M rays, ${secs()}): ${OUT}`);
  // (between bars, boards, a grille, the mast's lattice, the door's own parts: the gaps between them are made so)
  const made = (pair: string) => pair.split(' | ').every((s) => /own (timber|iron)|the post's|large_castle_door/.test(s));
  const stone = list.filter((p) => !p.between.every(made));
  console.log(`  of them ${stone.length} places with stone, rock or ground on a side (${stone.reduce((s, p) => s + p.eyes, 0)} eye-places), ${list.length - stone.length} between bars, boards and the mast`);
  for (const p of list.slice(0, 50)) console.log(`  ${String(p.eyes).padStart(3)} eyes ${String(p.sightings).padStart(4)}x ${p.cm[0]}-${p.cm[1]} cm at own (${p.own.join(', ')}): ${p.between.join(' ; ')}`);
}
