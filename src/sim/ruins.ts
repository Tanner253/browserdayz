// The ruined walled town in the desert: a palace-fort at its point, the best stretch of its wall with three
// towers, the bent gate over a causeway, a quarter of dug-out houses, the footings of the north wall with four
// small towers, and the wall that ran out to the river for water. It is built from the measurements of a real one
// (Calatrava la Vieja, in La Mancha) and from nothing else of it: every stone here is laid by rule, in this file,
// as plain numbers.
//
// It comes in PIECES, each in its own measure, each to be set down and turned by itself: the ground of the map is
// the map's to shape, and the pieces stand on whatever it is given. `ruinsPlan` says where each stood in the real
// town, for whoever wants that; nothing here depends on it.
//
// What is the real town's: the plan and sizes of each piece, the heights, which wall is whole and which is a
// footing, the great arch, the church with its round end, the courts stepping down, the cisterns. What is ours,
// because a ruin has no insides and a place that is fought over needs them: every floor, stair and platform in the
// towers, the walks along the walls, the way the gate's passage is overlooked, the rooms of the courts, the ways
// out of the cisterns, and where the walls are breached.
//
// Rules and layout only: no drawing here. The game builds each piece from `ruinParts` (src/world/ruins.ts); the
// server wants `ruinLoot`, `ruinProps` and `ruinHomes`. In a piece's own measure `x` and `z` lie on the ground and
// `y` is metres above the town's top, which is the height a `Place` gives.

import type { Place } from './bunker';

export type { Place };
export type V2 = [number, number];
export type V3 = [number, number, number];

/** the pieces: the palace-fort, the south-east wall, the gate, the houses, the wall to the river, the north footings, and three remnants of the bank's wall to stand wherever a wall is gone */
export type Piece = 'alcazar' | 'curtain' | 'gate' | 'honeycomb' | 'spur' | 'north' | 'stubA' | 'stubB' | 'stump';
export const PIECE_NAMES: Piece[] = ['alcazar', 'curtain', 'gate', 'honeycomb', 'spur', 'north', 'stubA', 'stubB', 'stump'];

/** what a part is made of: rubble limestone in mortar; the rammed earth and stones of a wall's heart (seen where it is broken); fallen stone and earth; sand, blown in and trodden; what is walked on along a wall and through a gate; old timber */
export type Paint = 'stone' | 'core' | 'earth' | 'sand' | 'paving' | 'timber';
/** what a part stops: everything; a body and nothing else (a rail, a timber stair: a shot goes through); nothing */
export type Body = 'all' | 'feet' | 'none';

interface Common {
  paint?: Paint;
  body?: Body;
  /** small enough to be drawn only from near */
  near?: boolean;
  /** it stops what `body` says and is not seen */
  hidden?: boolean;
  /** which piece of the place it is: for whoever reads a plan of it */
  name?: string;
}
/** a way through a wall: where its middle is along the wall's line (metres from its first point), how wide, and from how high to how high (an arch: `y1` is its crown, and it springs half its width under that) */
export interface Opening { s: number; w: number; y0: number; y1: number; arch?: boolean }
/**
 * A wall along a line of points (its middle line), `thick` across, from `foot` up to `top`. A thick one is a
 * block or a platform. `top` is one height or a line of [metres along, height]. `ruin` breaks its top: up to
 * `bite` metres gone, in courses, never under `floor`; `ends` are the lengths over which it runs down to that
 * floor at its first and last point. `gaps` are breaches: [from, to, down to, and the length either side over
 * which it climbs back to its own height]. `batter`: how far its foot stands out from its face where it meets the
 * ground (a tower's, and a wall's over a moat).
 */
export interface Wall extends Common {
  t: 'wall';
  pts: V2[];
  closed?: boolean;
  thick: number;
  foot: number;
  top: number | [number, number][];
  ruin?: { seed: number; bite: number; floor: number; ends?: [number, number] };
  gaps?: [number, number, number, number?][];
  openings?: Opening[];
  batter?: number;
  /** what its top is made of (left out: the wall's heart, where it is broken; its own stone, where it is not) */
  cap?: Paint;
}
/** a level floor: its outline, the holes in it, its height. `under`: it is seen from below too (boards over a room), and is so thick */
export interface Floor extends Common { t: 'floor'; pts: V2[]; holes?: V2[][]; y: number; under?: number }
/** a slab lying at any slope: the four corners of its top, in order round it, and how thick it is under them */
export interface Slab extends Common { t: 'slab'; p: [V3, V3, V3, V3]; thick: number }
/**
 * A straight flight: the middle of its foot on the floor below, the middle of the far edge of its last tread
 * (which is level with the floor above), and its width. Of stone it is solid down to `base`; of timber it is
 * treads on two strings.
 */
export interface Flight extends Common { t: 'flight'; foot: V3; head: V3; w: number; base?: number }
/** fallen stone and earth in a heap: where its middle is on the ground, how far it reaches each way, how high, and the number it is shaped from */
export interface Heap extends Common { t: 'heap'; x: number; z: number; y: number; rx: number; rz: number; h: number; yaw?: number; seed: number }
/** a fallen block: where its middle is, half its size each way, how it is turned, and the number it is shaped from */
export interface Lump extends Common { t: 'lump'; x: number; y: number; z: number; rx: number; ry: number; rz: number; yaw: number; seed: number }
/** a timber from one point to another: so wide and so deep */
export interface Beam extends Common { t: 'beam'; a: V3; b: V3; w: number; h: number }
/** a rail from one point to another: posts and two bars. A body does not go through it; a shot does */
export interface Rail extends Common { t: 'rail'; a: V3; b: V3 }
export type Part = Wall | Floor | Slab | Flight | Heap | Lump | Beam | Rail;

// ------------------------------------------------------------------ where it is

/** A spot in a piece's own measure, as a place in the world. */
export function ruinAt(p: Place, x: number, z: number, y = 0): V3 {
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  return [p.x + x * c + z * s, p.y + y, p.z - x * s + z * c];
}
/** A place in the world, in a piece's own measure: [x, z, above the town's top]. */
export function ruinLocal(p: Place, wx: number, wy: number, wz: number): V3 {
  const dx = wx - p.x, dz = wz - p.z, c = Math.cos(p.rot), s = Math.sin(p.rot);
  return [dx * c - dz * s, dx * s + dz * c, wy - p.y];
}
/** a measure within a piece: where its own beginning is and how it is turned (as a `Place` is) */
const frame = (ox: number, oz: number, yaw: number) => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return (x: number, z: number): V2 => [ox + x * c + z * s, oz - x * s + z * c];
};

// ------------------------------------------------------------------ small sums

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** a line through points [x, y], level beyond its ends */
const through = (pts: [number, number][], x: number) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let k = 1; k < pts.length; k++) if (x <= pts[k][0]) return pts[k - 1][1] + ((pts[k][1] - pts[k - 1][1]) * (x - pts[k - 1][0])) / (pts[k][0] - pts[k - 1][0] || 1);
  return pts[pts.length - 1][1];
};
/** a number between 0 and 1 from three whole ones, the same every time */
export function hash(i: number, j: number, s: number): number {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** a slow unevenness, 0..1, the same wherever it is asked */
export function rough(x: number, z: number, seed: number): number {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j, seed), b = hash(i + 1, j, seed), c = hash(i, j + 1, seed), d = hash(i + 1, j + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** how far a point is from a stretch of line, and how far along it the nearest point is (0..1) */
function toSegment(x: number, z: number, a: V2, b: V2): [number, number] {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
  const t = clamp01(((x - a[0]) * dx + (z - a[1]) * dz) / l2);
  return [Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t), t];
}
/** is a point inside an outline */
export function inside(x: number, z: number, poly: V2[]): boolean {
  let in_ = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) in_ = !in_;
  }
  return in_;
}
/** how far outside an outline a point is (less than nothing: that far inside it) */
export function outside(x: number, z: number, poly: V2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, toSegment(x, z, poly[i], poly[(i + 1) % poly.length])[0]);
  return inside(x, z, poly) ? -d : d;
}
/** how far along a wall's line the nearest point of it to a spot is: where an opening is put, said by where it is */
export function along(pts: V2[], closed: boolean, x: number, z: number): number {
  let best = Infinity, at = 0, s = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [d, t] = toSegment(x, z, a, b);
    if (d < best - 1e-9) {
      best = d;
      at = s + t * len;
    }
    s += len;
  }
  return at;
}
const rect = (x0: number, z0: number, x1: number, z1: number): V2[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
/** points round a part of a circle, degrees: 0 toward +x, 90 toward +z */
const arc = (cx: number, cz: number, r: number, from: number, to: number, n: number, f: (x: number, z: number) => V2 = (x, z) => [x, z]): V2[] =>
  Array.from({ length: n + 1 }, (_, k) => {
    const a = ((from + ((to - from) * k) / n) * Math.PI) / 180;
    return f(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
  });

// ------------------------------------------------------------------ a wall, cut into the lengths it is built of

/** the height of a wall's top at a point along it, before anything is broken off it */
function topLine(w: Wall, s: number): number {
  return typeof w.top === 'number' ? w.top : through(w.top, s);
}
/** The height of a wall's top, as it is left, at a point along it. (The length it belongs to has this height all along.) */
export function wallTop(w: Wall, s: number, total = wallLength(w)): number {
  const full = topLine(w, s);
  let t = full;
  const R = w.ruin;
  if (R) {
    // a slow rise and fall along the wall, and a quicker one stone by stone: more gone where both say so
    const e = 0.6 * rough(s / 4.7, R.seed * 0.37, R.seed) + 0.4 * hash(Math.round(s * 3), 7, R.seed);
    t -= R.bite * e * e * 1.5;
    // and here and there a bite out of it from the top: where one stone went, the ones beside it followed
    if (R.bite >= 0.7) {
      const shift = hash(1, 2, R.seed), cell = Math.floor(s / 7 + shift), at = (cell + 0.2 + 0.6 * hash(cell, 5, R.seed) - shift) * 7, wide = 0.9 + 2.2 * hash(cell, 6, R.seed);
      if (hash(cell, 4, R.seed) < 0.45) t -= R.bite * (0.8 + 1.4 * hash(cell, 8, R.seed)) * clamp01(1 - Math.abs(s - at) / wide);
    }
    if (R.ends) {
      if (R.ends[0] > 0) t = Math.min(t, R.floor + (full - R.floor) * clamp01(s / R.ends[0]));
      if (R.ends[1] > 0) t = Math.min(t, R.floor + (full - R.floor) * clamp01((total - s) / R.ends[1]));
    }
    // (it breaks along its courses: a quarter of a metre each)
    t = Math.max(R.floor, Math.round(t * 4) / 4);
  }
  // a breach: down to its floor between its ends, and climbing back to the wall's own height over the shoulder either side
  for (const [a, b, y, shoulder = 0] of w.gaps ?? []) {
    const d = s < a ? a - s : s > b ? s - b : 0;
    if (d > 0 && d >= shoulder) continue;
    const lip = y + 0.125 * Math.round(hash(Math.round(s * 2), 3, 11) * 2);
    t = Math.min(t, d > 0 ? Math.round((lip + (full - lip) * (d / shoulder) ** 1.3) * 4) / 4 : lip);
  }
  return Math.min(t, full);
}
export function wallLength(w: Wall): number {
  let s = 0;
  const n = w.closed ? w.pts.length : w.pts.length - 1;
  for (let i = 0; i < n; i++) s += Math.hypot(w.pts[(i + 1) % w.pts.length][0] - w.pts[i][0], w.pts[(i + 1) % w.pts.length][1] - w.pts[i][1]);
  return s;
}
/** the underside of an opening at a point along the wall: level, or the curve of an arch */
function soffit(o: Opening, s: number): number {
  if (!o.arch) return o.y1;
  const r = o.w / 2, d = Math.min(r, Math.abs(s - o.s));
  return o.y1 - r + Math.sqrt(r * r - d * d);
}
/** one length of a wall: from where to where along it, its four corners on the ground (left and right of somebody walking it, at its start and its end), and what of it is solid: [from how high at its start, at its end, up to how high, is that the wall's own top] */
export interface Length {
  span: number;
  s0: number;
  s1: number;
  l0: V2;
  l1: V2;
  r0: V2;
  r1: V2;
  solids: [number, number, number, boolean][];
}
/**
 * A wall as the lengths it is built of, in order along it. A length is cut at every corner, at the sides of every
 * opening, along the curve of an arch, and every metre or two between: each has one height of top. What is drawn
 * and what stops a body are both made from these, so they cannot disagree.
 */
export function wallLengths(w: Wall): Length[] {
  const P = w.pts, n = P.length, spans = w.closed ? n : n - 1, half = w.thick / 2, total = wallLength(w);
  const dir = (i: number): V2 => {
    const a = P[i], b = P[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  /** the corner of the wall's face at point `j`: where the faces of the two stretches that meet there cross (`side` 1: the left of somebody walking the line) */
  const corner = (j: number, side: number): V2 => {
    const prev = w.closed || j > 0 ? dir((j - 1 + spans) % spans) : null, next = w.closed || j < n - 1 ? dir(j % spans) : null;
    const nl = (d: V2): V2 => [d[1] * side, -d[0] * side];
    const a = prev ? nl(prev) : nl(next!), b = next ? nl(next) : nl(prev!);
    let mx = a[0] + b[0], mz = a[1] + b[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const k = Math.min(3, 1 / Math.max(0.2, mx * b[0] + mz * b[1]));
    return [P[j % n][0] + mx * half * k, P[j % n][1] + mz * half * k];
  };
  const out: Length[] = [];
  let s = 0;
  for (let i = 0; i < spans; i++) {
    const a = P[i], b = P[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const la = corner(i, 1), lb = corner(i + 1, 1), ra = corner(i, -1), rb = corner(i + 1, -1);
    // where it is cut: first what must be (the sides of openings, the curve of an arch, the ends of a breach)
    const cuts = [0, len];
    for (const o of w.openings ?? []) {
      const strips = o.arch ? 8 : 1;
      for (let k = 0; k <= strips; k++) cuts.push(o.s - o.w / 2 + (o.w * k) / strips - s);
    }
    for (const [g0, g1, , shoulder = 0] of w.gaps ?? []) cuts.push(g0 - s, g1 - s, g0 - shoulder - s, g1 + shoulder - s);
    if (typeof w.top !== 'number') for (const [at] of w.top) cuts.push(at - s);
    const must = cuts.filter((c) => c >= 0 && c <= len).sort((p, q) => p - q).filter((c, k, all) => k === 0 || c - all[k - 1] > 0.04);
    // then every so often between: a broken wall in the lengths its stones come away in, a whole one more seldom
    const step = w.ruin ? (w.thick > 2.5 ? 2.2 : 1.25) : 3.2, all = [...must];
    for (let k = 1, m = Math.max(1, Math.round(len / step)); k < m; k++) {
      const c = ((k + (w.ruin ? (hash(k, i, w.ruin.seed) - 0.5) * 0.5 : 0)) * len) / m;
      if (must.every((q) => Math.abs(q - c) > 0.3)) all.push(c);
    }
    all.sort((p, q) => p - q);
    const at = (c: number, p: V2, q: V2): V2 => [p[0] + ((q[0] - p[0]) * c) / len, p[1] + ((q[1] - p[1]) * c) / len];
    for (let k = 0; k + 1 < all.length; k++) {
      const c0 = all[k], c1 = all[k + 1], mid = s + (c0 + c1) / 2, top = wallTop(w, mid, total);
      // what is solid: the wall from its foot to its top, less every opening over this length
      let solids: [number, number, number, boolean][] = top > w.foot + 0.02 ? [[w.foot, w.foot, top, true]] : [];
      for (const o of w.openings ?? []) {
        if (mid < o.s - o.w / 2 || mid > o.s + o.w / 2) continue;
        const ya = soffit(o, s + c0), yb = soffit(o, s + c1), next: typeof solids = [];
        for (const [f0, f1, t, own] of solids) {
          if (o.y0 > Math.max(f0, f1) + 0.02) next.push([f0, f1, Math.min(t, o.y0), own && t <= o.y0]);
          if (t > Math.max(ya, yb) + 0.08) next.push([Math.max(f0, ya), Math.max(f1, yb), t, own]);
        }
        solids = next;
      }
      out.push({ span: i, s0: s + c0, s1: s + c1, l0: at(c0, la, lb), l1: at(c1, la, lb), r0: at(c0, ra, rb), r1: at(c1, ra, rb), solids });
    }
    s += len;
  }
  return out;
}

// ------------------------------------------------------------------ the pieces, part by part

const wall = (pts: V2[], thick: number, foot: number, top: Wall['top'], o: Partial<Wall> = {}): Wall => ({ t: 'wall', pts, thick, foot, top, ...o });
const opening = (w: Wall, x: number, z: number, wide: number, y0: number, y1: number, arch = false): Wall => {
  (w.openings ??= []).push({ s: along(w.pts, !!w.closed, x, z), w: wide, y0, y1, ...(arch ? { arch } : {}) });
  return w;
};
/** a part of a wall fallen, said by where it is: from the point of it nearest one spot to the point nearest another, down to a height, with shoulders so long */
const fallen = (w: Wall, a: V2, b: V2, y: number, shoulder: number): Wall => {
  const s0 = along(w.pts, !!w.closed, a[0], a[1]), s1 = along(w.pts, !!w.closed, b[0], b[1]);
  (w.gaps ??= []).push([Math.min(s0, s1), Math.max(s0, s1), y, shoulder]);
  return w;
};
/** openings to shoot through along the top of a wall: one every so often, from so high */
const crenels = (w: Wall, from: number, to: number, every: number, sill: number, wide = 0.85) => {
  for (let s = from + every / 2; s < to - wide; s += every) (w.openings ??= []).push({ s, w: wide, y0: sill, y1: 99 });
  return w;
};
const floor = (pts: V2[], y: number, paint: Paint, o: Partial<Floor> = {}): Floor => ({ t: 'floor', pts, y, paint, ...o });
const flight = (foot: V3, head: V3, w: number, paint: Paint, base?: number): Flight => ({ t: 'flight', foot, head, w, paint, ...(paint === 'timber' ? { body: 'feet' as Body } : { base: base ?? Math.min(foot[1], head[1]) - 0.6 }) });
const beam = (a: V3, b: V3, w = 0.16, h = 0.18): Beam => ({ t: 'beam', a, b, w, h, paint: 'timber', near: true, body: 'none' });
const post = (x: number, z: number, y0: number, y1: number): Beam => ({ t: 'beam', a: [x, y0, z], b: [x, y1, z], w: 0.16, h: 0.16, paint: 'timber', near: true, body: 'all' });
const heap = (x: number, z: number, y: number, rx: number, rz: number, h: number, seed: number, yaw = 0): Heap => ({ t: 'heap', x, z, y, rx, rz, h, seed, yaw, paint: 'earth' });
/** fallen blocks strewn round a spot: so many, within so far, on the ground at `y` */
const strewn = (x: number, z: number, y: number, n: number, r: number, seed: number): Lump[] =>
  Array.from({ length: n }, (_, k) => {
    const a = hash(k, 1, seed) * Math.PI * 2, d = (0.25 + 0.75 * hash(k, 2, seed)) * r, big = 0.16 + hash(k, 3, seed) * 0.3;
    return { t: 'lump', x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, y: y + big * 0.45, rx: big * (0.8 + hash(k, 4, seed) * 0.9), ry: big * 0.6, rz: big * (0.7 + hash(k, 5, seed) * 0.6), yaw: hash(k, 6, seed) * 3, seed: seed + k, paint: 'stone', near: true, body: big > 0.3 ? 'all' : 'none' } as Lump;
  });
/** a tread level with the ground outside a way in, for a round foot to roll up: it stops feet and nothing else and is not seen */
const apron = (a: V2, b: V2, out: V2, y: number, drop = 0.2, len = 0.9): Slab => ({
  t: 'slab', hidden: true, body: 'feet', thick: 0.06,
  p: [[a[0], y, a[1]], [b[0], y, b[1]], [b[0] + out[0] * len, y - drop, b[1] + out[1] * len], [a[0] + out[0] * len, y - drop, a[1] + out[1] * len]],
});

/** the level a doorway's own floor is at over the ground outside it: a sill, a hand's breadth */
const SILL = 0.14;

export const ALCAZAR = {
  /** the two walls that leave its west front: the south one over the moat, in the palace's own measure, and how it is turned from the front */
  south: { z: 51.5, turn: 0.21405 },
  /** the floors of its courts, over the town's top: the upper court, the middle and east courts, the lower ward (which is the ground itself) */
  upper: -1.5,
  middle: -4,
  lower: -8,
  /** what the ground under its floors must be dug to: nothing of it may stand higher */
  dug: -9.2,
  /** the top of the keep's wall: sixteen metres and more over the ditch at its foot */
  keep: 14.6,
  /** its corners, along the middle lines of its outer walls: the north end of the front, the south end, the two towers of the point, the two corners of the lower ward */
  A: [0, 0] as V2, B: [0, 51.5] as V2, C: [71.4, 36.3] as V2, D: [74.9, 23.6] as V2, N2: [38.8, -4.5] as V2, N1: [21, -22.4] as V2,
  /** the great arch: where it is along the front, how wide, where it springs and how high its crown is */
  arch: { z0: 19, z1: 23.5, crown: 6.85 },
  /** the way in from the arch: level through the gate, then down to the upper court */
  ramp: { level: 3.3, foot: 12 },
  /** the walks: along the top of the west wall and over the arch, and along the south wall */
  walk: { west: 9, south: SILL },
  /** where the west wall is breached: from where to where along the front, and how high the sill of the gap is left */
  breach: [35.6, 40.6, 3.6] as [number, number, number],
};
/** how high the way down from the arch is at a point along it */
export const rampY = (x: number) => (x <= ALCAZAR.ramp.level ? SILL : SILL + ((ALCAZAR.upper - SILL) * Math.min(1, (x - ALCAZAR.ramp.level) / (ALCAZAR.ramp.foot - ALCAZAR.ramp.level))));

/**
 * A tower's floors and the stairs between them: boards with a well where each stair comes up, a stair of timber
 * to each from the one below, set against the walls turn about. `x0..z1` is the room inside its walls; the stairs
 * run along z, the first up the wall at x0, the next up the wall at x1.
 */
function towerFloors(x0: number, z0: number, x1: number, z1: number, levels: number[], name: string, left: (V2[] | undefined)[] = []): Part[] {
  const out: Part[] = [floor(rect(x0, z0, x1, z1), levels[0], 'paving', { name: `${name} floor` })];
  for (let k = 1; k < levels.length; k++) {
    const lo = levels[k - 1], hi = levels[k], west = k % 2 === 1, up = k % 2 === 1 ? -1 : 1;
    const x = west ? x0 + 0.52 : x1 - 0.52, run = Math.min(z1 - z0 - 1, (hi - lo) / 0.82), clear = (z1 - z0 - run) / 2, zf = up < 0 ? z1 - clear : z0 + clear, zh = zf + up * run;
    // (the well: over the stair from where a head would meet the boards, to where the stair lands)
    const need = zf + up * run * clamp01(1 - 2.1 / (hi - lo)) - up * 0.3, well = west ? rect(x0, Math.min(need, zh), x0 + 1.05, Math.max(need, zh)) : rect(x1 - 1.05, Math.min(need, zh), x1, Math.max(need, zh));
    out.push(floor(left[k] ?? rect(x0, z0, x1, z1), hi, 'timber', { holes: [well], under: 0.1, near: true, name: `${name} floor ${k}` }));
    out.push({ ...flight([x, lo, zf], [x, hi, zh], 0.9, 'timber'), near: true, name: `${name} stair ${k}` });
  }
  return out;
}

function alcazar(): Part[] {
  const A = ALCAZAR, out: Part[] = [], U = A.upper, M = A.middle, L = A.lower;
  const S = frame(0, A.south.z, A.south.turn);
  const add = (...p: Part[]) => void out.push(...p);

  // ---- the keep at the north end of the front: the tallest thing there is, its foot in the ditch
  {
    const w = wall(rect(-0.6, -3.6, 6.6, 3.6), 1.8, -15, A.keep, { closed: true, ruin: { seed: 11, bite: 0.9, floor: A.keep - 0.7 }, batter: 0.4, name: 'keep' });
    opening(w, 3, 3.6, 1.1, SILL, 2.2);
    opening(w, 3, 3.6, 1.0, 7.1, 9.2);
    for (const [x, z] of [[-0.6, 0], [3, -3.6], [6.6, 0]] as V2[]) for (const y of [4.7, 8.2, 11.6]) opening(w, x, z, 0.5, y, y + 1.3);
    for (const [x, z] of [[-0.6, 1.8], [-0.6, -1.8], [1.2, -3.6], [4.8, -3.6], [6.6, -1.8], [6.6, 1.8], [1.2, 3.6], [4.8, 3.6]] as V2[]) opening(w, x, z, 0.9, A.keep - 0.6, 99);
    // (its corner toward the town has gone from the top, and lies before it)
    fallen(w, [2.2, 3.6], [-0.6, 1], A.keep - 3, 2.6);
    add(w, ...towerFloors(0.3, -2.7, 5.7, 2.7, [SILL, 3.6, 7.1, 10.6, 13.1], 'keep', [undefined, undefined, undefined, undefined, [[0.3, -2.7], [5.7, -2.7], [5.7, 2.7], [2.6, 2.7], [0.3, 0.4]]]));
    add(heap(-3.4, 5.6, 0, 3.4, 3, 1.5, 281, 0.6), ...strewn(-4.5, 4.5, 0, 12, 5, 283), ...strewn(9.5, -6.5, L, 8, 4, 285));
  }
  // ---- the block beside it: a hall on the ground, a roof to fight from, the way through to the keep
  {
    const west = wall([[0.85, 4.5], [0.85, 17.3]], 1.7, -15, 10, { ruin: { seed: 23, bite: 1.5, floor: 8.1 }, name: 'block west wall' });
    crenels(west, 0.5, 12.5, 3, 8.1);
    fallen(west, [0.85, 9.6], [0.85, 12.2], 7.35, 1.6);
    for (const z of [8, 13]) opening(west, 0.85, z, 0.5, 1.2, 2.5);
    const south = wall([[0, 18.15], [9.5, 18.15]], 1.7, -15, A.walk.west, { cap: 'paving', name: 'block south wall' });
    opening(south, 4.3, 18.15, 1.2, SILL, 2.3);
    const east = wall([[8.65, 4.5], [8.65, 17.3]], 1.7, -15, 8.9, { ruin: { seed: 29, bite: 1.5, floor: 7.3 }, name: 'block east wall' });
    opening(east, 8.65, 16.3, 0.8, 1.1, 2.3);
    opening(east, 8.65, 10.6, 0.5, 4.7, 6);
    crenels(east, 1, 12, 3.6, 7.9);
    add(west, south, east);
    add(floor(rect(1.7, 4.5, 7.8, 17.3), SILL, 'paving', { name: 'hall floor' }));
    add(floor(rect(1.7, 4.5, 7.8, 17.3), 7.1, 'timber', { holes: [rect(6.7, 13, 7.8, 15.8)], under: 0.12, name: 'block roof' }));
    add(flight([7.2, SILL, 5.4], [7.2, 3.6, 9.7], 0.9, 'timber'), floor(rect(6.5, 9.7, 7.8, 11.5), 3.6, 'timber', { under: 0.1, near: true }), flight([7.2, 3.6, 11.5], [7.2, 7.1, 15.8], 0.9, 'timber'));
    add(post(6.6, 9.8, SILL, 3.5), post(6.6, 11.4, SILL, 3.5), beam([6.6, 3.42, 9.8], [6.6, 3.42, 11.4]));
    for (const z of [7.2, 10.4, 13.6]) add(beam([1.7, 6.9, z], [7.8, 6.9, z], 0.2, 0.24));
    // the steps from the roof up to the walk over the arch
    add(flight([3.6, 7.1, 14.2], [3.6, A.walk.west, 17.3], 1.2, 'stone', 7.1));
  }
  // ---- the great arch, the pier it leans on, and the wall on to the south tower
  {
    const span: Opening = { s: (A.arch.z1 - A.arch.z0) / 2 + 0.1, w: A.arch.z1 - A.arch.z0, y0: -2, y1: A.arch.crown, arch: true };
    const a = wall([[2.3, A.arch.z0 - 0.1], [2.3, A.arch.z1 + 0.1]], 1.4, -1, A.walk.west, { cap: 'paving', name: 'the great arch' });
    a.openings = [span];
    // (the outer ring still springs and still meets: what it carried is down to a course or two over its crown, and less than that over one haunch)
    const outer = wall([[0.8, A.arch.z0 - 0.1], [0.8, A.arch.z1 + 0.1]], 1.6, -1, 9.75, { ruin: { seed: 33, bite: 1.3, floor: A.arch.crown + 0.5 }, gaps: [[span.s + 0.8, span.s + 1.7, A.arch.crown - 0.2, 0.7], [span.s - 0.6, span.s + 0.5, A.arch.crown + 0.35, 0.8]], name: 'outer ring of the arch' });
    outer.openings = [span];
    add(a, outer, ...strewn(-2.4, 21.6, 0, 9, 3.4, 293));
    add(wall([[0, 25.75], [3.2, 25.75]], 4.5, -15, A.walk.west, { cap: 'paving', name: 'pier' }), wall([[3.2, 25.75], [6, 25.75]], 4.5, -15, 10.6, { ruin: { seed: 31, bite: 1.6, floor: 8.4 }, name: 'pier stump' }));
    const B0 = A.breach[0], B1 = A.breach[1], BY = A.breach[2], SH = 3.2;
    add(wall([[1, 28], [1, 47.5]], 2, -6, A.walk.west, { cap: 'paving', ruin: { seed: 35, bite: 0, floor: BY - 0.3 }, gaps: [[B0 - 28, B1 - 28, BY, SH]], batter: 0.25, name: 'west wall' }));
    const parapet = wall([[0.25, 17.3], [0.25, 47.5]], 0.5, A.walk.west - 0.1, 10.4, { ruin: { seed: 37, bite: 1.2, floor: A.walk.west }, gaps: [[B0 - SH - 17.3, B1 + SH - 17.3, -99], [A.arch.z0 - 0.4 - 17.3, A.arch.z1 + 0.4 - 17.3, -99]], name: 'west parapet' });
    crenels(parapet, 0, 30.2, 2.6, A.walk.west + 0.9);
    add(parapet, { t: 'rail', a: [1.92, A.walk.west, 28.1], b: [1.92, A.walk.west, B0 - SH - 0.2], paint: 'timber', near: true }, { t: 'rail', a: [1.92, A.walk.west, B1 + SH + 0.2], b: [1.92, A.walk.west, 47.3], paint: 'timber', near: true });
    // (what fell of it lies both sides: outside it is the way up to the gap, inside the way down onto the terrace)
    const bm = (B0 + B1) / 2;
    add(heap(-0.6, bm, 0, 6.8, 5.6, BY - 0.1, 295), heap(2.3, bm, SILL, 2.9, 6.6, BY - SILL - 0.15, 297), ...strewn(-4, bm + 1, 0, 14, 6, 299), ...strewn(4.6, bm - 0.5, SILL, 8, 3, 301));
  }
  // ---- the way in: level through the gate, then a ramp down into the upper court between two low walls
  {
    const z0 = A.arch.z0, z1 = A.arch.z1, R = A.ramp;
    add({ t: 'slab', p: [[-1.2, SILL, z0], [-1.2, SILL, z1], [R.level, SILL, z1], [R.level, SILL, z0]], thick: 0.5, paint: 'paving', name: 'gate sill' });
    add({ t: 'slab', p: [[R.level, SILL, z0], [R.level, SILL, z1], [R.foot, U, z1], [R.foot, U, z0]], thick: 0.6, paint: 'paving', name: 'gate ramp' });
    add(apron([-1.2, z0], [-1.2, z1], [-1, 0], SILL));
    const north = wall([[9.5, z0 - 0.35], [52.4, z0 - 0.35]], 0.7, -13.5, [[0, rampY(9.5) + 1], [R.foot - 9.5, U + 1], [43, U + 1]], { ruin: { seed: 41, bite: 0.75, floor: -99 }, name: 'court wall' });
    opening(north, 24.6, z0 - 0.35, 1.2, U, 99);
    const south = wall([[6, z1 + 0.35], [R.foot, z1 + 0.35]], 0.7, -6, [[0, rampY(6) + 1], [R.foot - 6, U + 1]], { ruin: { seed: 43, bite: 0.7, floor: -99, ends: [0, 2.5] }, name: 'ramp wall' });
    add(north, south);
  }
  // ---- the terrace behind the west wall: level with the town, a parapet over the court, a stair down
  {
    add(floor(rect(2, 28, 6.5, 47.5), SILL, 'paving', { name: 'terrace' }));
    const edge = wall([[6.25, 28], [6.25, 47.5]], 0.5, -13.5, 1.05, { ruin: { seed: 47, bite: 0.8, floor: SILL + 0.05 }, name: 'terrace wall' });
    opening(edge, 6.25, 36.4, 1.2, SILL, 99);
    add(edge, wall([[7.15, 35.8], [7.15, 37]], 1.3, -6, SILL, { cap: 'paving' }), flight([7.15, U, 44.4], [7.15, SILL, 37], 1.2, 'stone', U - 0.8));
  }
  // ---- the south tower, at the corner where the wall over the moat begins
  {
    const w = wall(rect(-0.6, 48.4, 6.6, 55.6), 1.8, -15, 10.5, { closed: true, ruin: { seed: 53, bite: 0.9, floor: 9.9 }, name: 'south tower' });
    opening(w, 4.2, 48.4, 1.1, SILL, 2.2);
    opening(w, 6.6, 50.1, 1.0, SILL, 2.2);
    opening(w, 1.1, 48.4, 1.1, 9.1, 99);
    for (const [x, z] of [[-0.6, 52], [3, 55.6]] as V2[]) opening(w, x, z, 0.5, 5.6, 6.9);
    for (const [x, z] of [[-0.6, 50.2], [-0.6, 53.8], [1.2, 55.6], [4.8, 55.6], [6.6, 53.5]] as V2[]) opening(w, x, z, 0.9, 10, 99);
    fallen(w, [2.8, 55.6], [-0.6, 52.2], 5.4, 2.4);
    add(w, ...towerFloors(0.3, 49.3, 5.7, 54.7, [SILL, 4.6, 9.1], 'south tower', [undefined, undefined, [[0.3, 49.3], [5.7, 49.3], [5.7, 54.7], [3.4, 54.7], [0.3, 51.6]]]));
    add(heap(-2.6, 57.4, -2.6, 4.4, 3.6, 2.2, 303, 0.5), ...strewn(-3.5, 58.5, -3.2, 12, 4.5, 305));
  }
  // ---- the wall over the moat, with its walk, to the two towers of the point
  {
    const end = S(71.3, 0);
    add(wall([S(7.6, 0), end], 2, -13.5, A.walk.south, { cap: 'paving', name: 'south wall' }));
    const p = wall([S(7.6, 0.75), S(71.3, 0.75)], 0.5, 0, 1.75, { ruin: { seed: 59, bite: 1.3, floor: SILL + 0.15 }, name: 'south parapet' });
    crenels(p, 2, 62, 2.8, SILL + 0.95);
    add(p, flight([S(22.4, -1.6)[0], U, S(22.4, -1.6)[1]], [S(15, -1.6)[0], A.walk.south, S(15, -1.6)[1]], 1.1, 'stone', U - 0.8));
    // the towers of the point: each a prow of five sides, a platform level with the walks
    const prow = (c: V2, ax: V2, seed: number, name: string, ways: V2[]) => {
      const px: V2 = [-ax[1], ax[0]], at = (f: number, s: number): V2 => [c[0] + ax[0] * f + px[0] * s, c[1] + ax[1] * f + px[1] * s];
      const w = wall([at(-2.6, 3.2), at(3, 3.2), at(6.6, 0), at(3, -3.2), at(-2.6, -3.2)], 1.3, -14.5, 1.7, { closed: true, ruin: { seed, bite: 1.1, floor: SILL + 0.45 }, name });
      for (const [x, z] of ways) opening(w, x, z, 1.5, SILL, 99);
      if (seed === 61) fallen(w, at(4.6, 1.78), at(4.6, -1.78), SILL + 0.1, 1.2);
      else fallen(w, at(1.2, -3.2), at(3.9, -2.4), SILL + 0.1, 1);
      for (const f of [0.4, 4.8]) for (const s of [1, -1]) {
        const q = f > 3 ? at(f, s * 3.2 * (1 - (f - 3) / 3.6)) : at(f, s * 3.2);
        opening(w, q[0], q[1], 0.8, SILL + 0.95, 99);
      }
      add(w, floor([at(-2.3, 2.9), at(2.8, 2.9), at(5.9, 0), at(2.8, -2.9), at(-2.3, -2.9)], SILL, 'paving', { name: `${name} platform` }));
    };
    const mid: V2 = [(A.C[0] + A.D[0]) / 2 - 0.4, (A.C[1] + A.D[1]) / 2];
    prow([A.C[0] + 0.6, A.C[1] + 0.3], [0.898, 0.439], 61, 'south prow', [end, [A.C[0] - 0.3, A.C[1] - 3.4]]);
    prow([A.D[0], A.D[1]], [0.954, -0.301], 67, 'north prow', [[A.D[0] - 1.6, A.D[1] + 3.6]]);
    // the short wall between them, its walk, and the small door under it that gives on the river side
    const a: V2 = [A.C[0] - 0.2, A.C[1] - 2.9], b: V2 = [A.D[0] - 1.3, A.D[1] + 3.3], l = Math.hypot(b[0] - a[0], b[1] - a[1]), d: V2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], o: V2 = [-d[1], d[0]];
    const tip = wall([a, b], 1.7, -14.5, A.walk.south, { cap: 'paving', name: 'east wall' });
    opening(tip, mid[0], mid[1], 1.3, M, M + 2.15);
    // (its parapet stops short of each prow: the way from a prow onto the walk is past its end)
    add(tip, wall([[a[0] + d[0] * 1.8 + o[0] * 0.6, a[1] + d[1] * 1.8 + o[1] * 0.6], [b[0] - d[0] * 1.8 + o[0] * 0.6, b[1] - d[1] * 1.8 + o[1] * 0.6]], 0.5, 0, 1.6, { ruin: { seed: 71, bite: 1.2, floor: SILL + 0.3 }, name: 'east parapet' }));
    const sx = mid[0] + o[0] * 0.85, sz = mid[1] + o[1] * 0.85;
    // (its steps go down the bank outside as far as the moat's floor: where the ground is higher than was thought, the foot of them is under it)
    add(flight([sx + o[0] * 7.3, M - 3.9, sz + o[1] * 7.3], [sx + o[0] * 0.9, M, sz + o[1] * 0.9], 1.7, 'stone', -14.5));
    add(wall([[sx - o[0] * 0.2, sz - o[1] * 0.2], [sx + o[0] * 0.9, sz + o[1] * 0.9]], 1.7, -14.5, M, { cap: 'paving', name: 'postern step' }));
  }
  // ---- the church along the south wall: its long walls, the round end, the gable, a gallery, what is left of a roof
  {
    const south = wall([S(20.6, -3.6), S(47, -3.6)], 1.2, U - 3.5, U + 8.5, { ruin: { seed: 73, bite: 4.4, floor: U + 3.9 }, name: 'church south wall' });
    opening(south, ...S(40, -3.6), 1.1, U, U + 2.2);
    for (const x of [26, 33]) opening(south, ...S(x, -3.6), 0.8, U + 4, U + 6.2, true);
    const apse = wall(arc(47, -8.5, 4.9, 90, -90, 12, S), 1.2, M - 4, U + 7.1, { ruin: { seed: 79, bite: 1.5, floor: U + 5.1 }, name: 'apse' });
    for (const a of [45, 0, -45]) opening(apse, ...S(47 + 4.9 * Math.cos((a * Math.PI) / 180), -8.5 + 4.9 * Math.sin((a * Math.PI) / 180)), 0.55, U + 1.4, U + 3.2);
    const north = wall([S(47, -13.4), S(20.6, -13.4)], 1.2, U - 3.5, U + 7.5, { ruin: { seed: 83, bite: 5, floor: U + 2.1 }, gaps: [[12.2, 15.4, U + 0.9]], name: 'church north wall' });
    opening(north, ...S(36, -13.4), 1.8, U, U + 2.6, true);
    opening(north, ...S(28, -13.4), 0.8, U + 4, U + 6.2, true);
    const gable = wall([S(20.6, -14), S(20.6, -3)], 1.2, U - 3.5, [[0, U + 7.5], [5.5, U + 11.1], [11, U + 7.5]], { ruin: { seed: 89, bite: 2.2, floor: U + 4.7 }, name: 'church gable' });
    opening(gable, ...S(20.6, -8.5), 2.2, U, U + 3.1, true);
    gable.gaps = [[6.6, 7.6, U + 4.9, 1.4]];
    add(south, apse, north, gable, floor([S(20, -14), S(47, -14), ...arc(47, -8.5, 5.5, -90, 90, 10, S).slice(1, -1), S(47, -3), S(20, -3)], U + 0.04, 'paving', { name: 'church floor', body: 'none' }));
    const porch = wall([S(20, -12.6), S(15.4, -12.6), S(15.4, -4.4), S(20, -4.4)], 0.8, U - 3.5, U + 2.3, { ruin: { seed: 97, bite: 2, floor: U + 0.35 }, name: 'porch' });
    opening(porch, ...S(15.4, -8.5), 2, U, 99);
    add(porch);
    // the stumps of its piers, and the altar
    [[27, -11, -1.4], [33.5, -11, 0.6], [40, -11, -3], [27, -6, 2.4], [33.5, -6, -2.2], [40, -6, -0.6]].forEach(([x, z, top], k) => add(wall([S(x - 0.45, z), S(x + 0.45, z)], 0.9, U - 1, U + 4.5 + top, { ruin: { seed: 101 + k, bite: 0.5, floor: U + 0.5 }, name: 'pier' })));
    add(wall([S(44.2, -9.7), S(44.2, -7.3)], 1.1, U - 1, U + 1, { cap: 'stone', name: 'altar' }));
    // the gallery over the west door, on posts, and the stair up to it
    const gy = U + 3.3;
    add(floor([S(21.2, -12.8), S(25.6, -12.8), S(25.6, -4.2), S(21.2, -4.2)], gy, 'timber', { under: 0.12, name: 'gallery' }));
    for (const z of [-10.6, -6.4]) add(post(...S(25.4, z), U, gy - 0.12));
    add(beam([S(25.4, -12.8)[0], gy - 0.21, S(25.4, -12.8)[1]], [S(25.4, -4.2)[0], gy - 0.21, S(25.4, -4.2)[1]], 0.2, 0.2), { t: 'rail', a: [S(25.6, -11.6)[0], gy, S(25.6, -11.6)[1]], b: [S(25.6, -4.3)[0], gy, S(25.6, -4.3)[1]], paint: 'timber', near: true });
    add(flight([S(29.6, -12.2)[0], U, S(29.6, -12.2)[1]], [S(25.6, -12.2)[0], gy, S(25.6, -12.2)[1]], 0.9, 'timber'));
    // two beams of the roof still across it, each lying on what is left of the walls
    for (const x of [24, 31, 43]) {
      const yn = wallTop(north, along(north.pts, false, ...S(x, -13.4))), ys = wallTop(south, along(south.pts, false, ...S(x, -3.6)));
      add({ ...beam([S(x, -13.6)[0], yn + 0.12, S(x, -13.6)[1]], [S(x, -3.4)[0], ys + 0.12, S(x, -3.4)[1]], 0.26, 0.3), near: false });
    }
    add(heap(...S(38, -15.4), U, 3.2, 2.2, 1.5, 211, A.south.turn), ...strewn(...S(34, -9), U, 9, 4, 223), ...strewn(...S(38, -16.5), U, 7, 3, 227));
  }
  // ---- the courts: the upper by the church, the middle and the east a step under it, each with its floor
  {
    const edge = (x: number) => A.south.z - Math.tan(A.south.turn) * x - 0.5;
    const c2 = rect(29.6, 20.2, 37.4, 25), c1 = rect(10.1, 5.1, 14.9, 13.9), c3 = arc(62, 27, 2.85, 0, 330, 11);
    add(floor([[5, 18.6], [52.4, 18.6], [52.4, edge(52.4)], [5, edge(5)]], U, 'sand', { holes: [c2], name: 'upper court' }));
    add(floor([[6.5, 2.2], [47.4, 2.2], [A.D[0], A.D[1]], [A.C[0], A.C[1]], [52.4, edge(52.4) + 0.5], [52.4, 18.6], [6.5, 18.6]], M, 'sand', { holes: [c1, c3], name: 'middle court' }));
    // the wall the upper court ends in on the east, and the broad steps down through it
    const east = wall([[52.4, 19], [52.4, edge(52.4) + 0.4]], 0.7, -13.5, U + 1, { ruin: { seed: 103, bite: 0.8, floor: U + 0.1 }, name: 'east court wall' });
    opening(east, 52.4, 22.5, 3, U, 99);
    add(east, flight([56.75, M, 22.5], [52.75, U, 22.5], 3, 'stone', M - 0.8));
    // the steps from the upper court to the middle, down the north face of the wall between them
    add(wall([[24, 17.7], [25.2, 17.7]], 1.2, M - 0.8, U, { cap: 'paving' }), flight([29.2, M, 17.7], [25.2, U, 17.7], 1.2, 'stone', M - 0.8));
    // the wall over the lower ward, the stone stair down its face, and a stair of timber further on
    const over = wall([[7.5, 2.6], [47.8, 2.6]], 0.8, -15, M + 1, { ruin: { seed: 107, bite: 0.7, floor: M + 0.1 }, name: 'ward wall' });
    opening(over, 29.3, 2.6, 1.2, M, 99);
    opening(over, 37.6, 2.6, 1.2, M, 99);
    add(over, wall([[28.7, 1.6], [29.9, 1.6]], 1.2, -15, M, { cap: 'paving' }), flight([36.3, L, 1.6], [29.9, M, 1.6], 1.2, 'stone', -15));
    add(floor(rect(37, 1, 38.2, 2.2), M, 'timber', { under: 0.1 }), flight([42.3, L, 1.6], [38.2, M, 1.6], 0.9, 'timber'), post(37.1, 1.1, L - 1, M - 0.1), post(38.1, 1.1, L - 1, M - 0.1));
  }
  // ---- the cisterns: two long ones and a round one, each with a kerb and a way out
  {
    const kerb = (pts: V2[], top: number, foot: number, seed: number, name: string) => wall(pts, 0.5, foot, top + 0.25, { closed: true, ruin: { seed, bite: 0.3, floor: top + 0.05 }, name });
    const k1 = kerb(rect(10.25, 5.25, 14.75, 13.75), M, -11.5, 109, 'long cistern');
    opening(k1, 14.75, 6.75, 1.2, M, 99);
    add(k1, floor(rect(10.5, 5.5, 14.5, 13.5), M - 3.5, 'sand'), wall([[14, 6.15], [14, 7.35]], 1, M - 4, M, { cap: 'paving' }), flight([14, M - 3.5, 12.95], [14, M, 7.35], 0.95, 'stone', M - 4));
    const k2 = kerb(rect(29.75, 20.35, 37.25, 24.85), U, U - 4, 113, 'court cistern');
    opening(k2, 37.25, 23.9, 1.2, U, 99);
    add(k2, floor(rect(30, 20.6, 37, 24.6), U - 3.5, 'sand'), flight([33.1, U - 3.5, 23.9], [37, U, 23.9], 0.95, 'timber'), heap(30.8, 21.4, U - 3.5, 1.1, 1, 0.9, 229));
    const k3 = kerb(arc(62, 27, 2.65, 0, 330, 11), M, -11.5, 127, 'round cistern');
    opening(k3, 64.65, 27, 1.2, M, 99);
    add(k3, floor(arc(62, 27, 2.45, 0, 330, 11), M - 3.5, 'sand'), flight([61, M - 3.5, 27], [64.4, M, 27], 0.95, 'timber'), heap(62.7, 25.3, M - 3.5, 1, 0.9, 0.8, 233));
  }
  // ---- the outer walls of the north side: round the lower ward, breached, and on to the north tower of the point
  {
    const ward = wall([[2.5, -4.5], A.N1, A.N2], 1.8, -15.5, [[0, L + 7.5], [25.7, L + 7], [25.8, L + 5.5], [51, L + 5.5]], { ruin: { seed: 131, bite: 3.2, floor: L + 1.3 }, gaps: [[35.2, 40.2, L + 0.3]], name: 'ward walls' });
    const breach = 25.74 + 12, t = breach - 25.74, bx = A.N1[0] + ((A.N2[0] - A.N1[0]) * t) / 25.24, bz = A.N1[1] + ((A.N2[1] - A.N1[1]) * t) / 25.24;
    add(ward, heap(bx, bz, L - 0.5, 4.6, 3.4, 1.15, 239, -0.78), ...strewn(bx + 2, bz + 3, L, 10, 4.5, 241), ...strewn(bx - 2.5, bz - 3.5, L - 0.5, 8, 4, 251));
    add(wall([A.N2, [A.D[0] - 2.4, A.D[1] - 1.9]], 1.8, -14.5, M + 5.5, { ruin: { seed: 137, bite: 3.6, floor: M + 1.4 }, name: 'north-east wall' }));
  }
  // ---- what is left of rooms: in the middle court along the ward wall, in the east court, and stubs in the upper
  {
    const room = (pts: V2[], y: number, seed: number, doors: V2[], closed = true) => {
      const w = wall(pts, 0.6, y - 1.5, y + 2.5, { closed, ruin: { seed, bite: 2.1, floor: y + 0.45 }, name: 'room' });
      for (const [x, z] of doors) opening(w, x, z, 1.05, y, 99);
      add(w);
    };
    room(rect(16.2, 3.6, 21.6, 9), M, 139, [[18.9, 9], [21.6, 6.2]]);
    room(rect(31.2, 3.6, 36.6, 9.2), M, 149, [[33.8, 9.2], [36.6, 6]]);
    room([[36.6, 9.2], [42.2, 9.2], [42.2, 3.6], [36.6, 3.6]], M, 151, [[39.4, 9.2], [37.6, 3.6]], false);
    room([[44.5, 6], [44.5, 12.5], [50.5, 12.5]], M, 157, [[44.5, 9.5]], false);
    room(rect(56.2, 30.4, 61.4, 35.6), M, 163, [[58.8, 30.4], [56.2, 33]]);
    room([[61.4, 30.4], [66.4, 30.4], [66.4, 34.6]], M, 167, [[64, 30.4]], false);
    room([[40, 26.5], [40, 20.2], [45.5, 20.2]], U, 173, [[40, 23.6]], false);
    room([[12, 27.5], [18.5, 27.5], [18.5, 32]], U, 179, [[15.5, 27.5]], false);
    add(...strewn(20, 12, M, 8, 5, 257), ...strewn(47, 23, U, 7, 4, 263), ...strewn(60, 21, M, 8, 5, 269), ...strewn(26, 30, U, 6, 4, 271));
  }
  return out;
}

/** the best stretch of the town's wall: sixty-six metres, two towers proud of it, a prow under them, and what is left of it going on east */
export const CURTAIN = { len: 66.2, walk: 4, breach: [44.2, 48.6, 1.3] as [number, number, number], on: 91.6, turn: -6.6, t1: [14.15, 20.65] as V2, t2: [50.9, 56.5] as V2, prow: [32, 42] as V2, postern: 37, stair: [23, 29.4] as V2 };
/** the ground it is built for, across it: level inside, a fall of earth against its foot, a berm, the scarp, the moat, and the far lip */
const CURTAIN_GROUND: [number, number][] = [[0.9, 0], [7, -3.5], [13.5, -4.4], [24, -10.4], [46, -10.4], [61, -8.8]];

function curtain(): Part[] {
  const C = CURTAIN, out: Part[] = [], W = C.walk;
  const add = (...p: Part[]) => void out.push(...p);
  const main = wall([[0, 0], [C.len, 0]], 1.8, -8.5, W, { cap: 'paving', ruin: { seed: 307, bite: 0, floor: 0.6, ends: [7, 0] }, gaps: [[C.breach[0], C.breach[1], C.breach[2], 2.6]], batter: 0.3, name: 'curtain' });
  for (const x of [17.4, 53.7, C.postern]) opening(main, x, 0, x === C.postern ? 1.2 : 1.1, SILL, 2.2);
  add(main);
  // its parapet, in the three lengths the towers leave of it
  for (const [a, b, seed] of [[7, C.t1[0] - 0.75, 311], [C.t1[1] + 0.75, C.t2[0] - 0.7, 313], [C.t2[1] + 0.7, C.len, 317]]) {
    const p = wall([[a, 0.65], [b, 0.65]], 0.5, W - 0.1, W + 1.6, { ruin: { seed, bite: 1.3, floor: W + 0.2 }, gaps: [[C.breach[0] - 2.7 - a, C.breach[1] + 2.7 - a, -99]], name: 'curtain parapet' });
    add(crenels(p, 0.6, b - a, 2.7, W + 0.95));
  }
  // the two towers: three walls outside the curtain, a room on the ground, a platform level with the walk
  const tower = (x0: number, x1: number, z1: number, seed: number, name: string, whole: boolean, gone: [V2, V2, number, number]) => {
    const t = wall([[x0, 0.9], [x0, z1], [x1, z1], [x1, 0.9]], 1.5, -9.5, W + 1.6, { ruin: { seed, bite: 1.1, floor: W + 0.5 }, batter: 0.35, name });
    fallen(t, ...gone);
    for (const [x, z] of [[x0, (z1 + 0.9) / 2 + 0.6], [(x0 + x1) / 2 - 1.2, z1], [(x0 + x1) / 2 + 1.2, z1], [x1, (z1 + 0.9) / 2 + 0.6]] as V2[]) opening(t, x, z, 0.85, W + 0.95, 99);
    for (const x of [(x0 + x1) / 2]) opening(t, x, z1, 0.5, 1.2, 2.5);
    const a = x0 + 0.75, b = x1 - 0.75, d = z1 - 0.75;
    add(t, floor(rect(a, 0.9, b, d), SILL, 'paving', { name: `${name} floor` }), apron([(x0 + x1) / 2 - 0.6, -0.9], [(x0 + x1) / 2 + 0.6, -0.9], [0, -1], SILL));
    if (whole) {
      // a platform of boards level with the walk, and one stair to it along the outer wall: its foot a pace clear of the corner, so that it is come onto from behind
      const xf = a + 0.75, run = Math.min(b - xf - 0.15, (W - SILL) / 0.95), xh = xf + run;
      add(floor(rect(a, 0.9, b, d), W, 'timber', { holes: [rect(xf + run * 0.45, d - 1.05, xh, d)], under: 0.12, name: `${name} platform` }));
      add(flight([xf, SILL, d - 0.52], [xh, W, d - 0.52], 0.9, 'timber'));
    } else {
      // no platform is left in it: a stair along its outer wall to a landing in the corner, and a second from that up
      // onto the walk itself
      const half = SILL + (W - SILL) / 2;
      add(flight([b - 0.75, SILL, d - 0.52], [a + 0.95, half, d - 0.52], 0.9, 'timber'), floor(rect(a, d - 2, a + 0.95, d), half, 'timber', { under: 0.1, name: `${name} landing` }));
      add(flight([a + 0.475, half, d - 2], [a + 0.475, W, 0.9], 0.9, 'timber'), post(a + 0.87, d - 1.92, SILL, half - 0.1), post(a + 0.87, d - 0.08, SILL, half - 0.1));
    }
  };
  tower(C.t1[0], C.t1[1], 5.75, 331, 'west tower', true, [[C.t1[0], 3.2], [C.t1[0] + 2.4, 5.75], W + 0.2, 1.6]);
  tower(C.t2[0], C.t2[1], 5.7, 337, 'east tower', false, [[C.t2[1] - 1.6, 5.7], [C.t2[1], 1.4], W + 0.15, 1.8]);
  add(heap(C.t1[0] - 1.6, 6.6, -3.3, 3.2, 2.8, 1.5, 341), ...strewn(C.t1[0] - 2, 7.5, -3.6, 8, 3.5, 343), heap(C.t2[1] + 1.8, 5.4, -3.2, 3.4, 2.8, 1.6, 345), ...strewn(C.t2[1] + 2.5, 6.5, -3.5, 8, 3.5, 351));
  // the breach: the wall down to a step over the town's ground, its fall a slope up from the berm outside and a scatter inside
  {
    const bm = (C.breach[0] + C.breach[1]) / 2;
    add(heap(bm, 1.2, -1.6, 5.6, 7.8, C.breach[2] + 1.5, 355), heap(bm, -1.9, 0, 3.6, 2.6, C.breach[2] - 0.15, 357), ...strewn(bm + 1, 6, -3.2, 14, 5, 361), ...strewn(bm - 1, -4, 0, 9, 3.5, 363));
  }
  // the stair of stone up the town side of it
  add(flight([C.stair[0], 0, -1.5], [C.stair[1], W, -1.5], 1.2, 'stone', -3.5));
  // the prow: five sides out over the berm, level with the town on top, reached by the small door in the curtain,
  // and fallen in on its east side, where the fall is the way down to the moat
  {
    const pts: V2[] = [[C.prow[0], 0.9], [C.prow[0], 9], [(C.prow[0] + C.prow[1]) / 2, 14], [C.prow[1], 9], [C.prow[1], 0.9]];
    const p = wall(pts, 1, -9.5, 1.3, { ruin: { seed: 347, bite: 1, floor: SILL + 0.25 }, gaps: [[25, 29.5, SILL - 0.3]], name: 'prow' });
    add(p, floor([[C.prow[0] + 0.3, 0.9], [C.prow[0] + 0.3, 8.8], [(C.prow[0] + C.prow[1]) / 2, 13.4], [C.prow[1] - 0.3, 8.8], [C.prow[1] - 0.3, 0.9]], SILL, 'sand', { name: 'prow platform' }));
    add(heap(C.prow[1] + 0.6, 6.2, -3.9, 6.8, 4.6, 4.15, 349), ...strewn(C.prow[1] + 4, 6.5, -3.6, 12, 4.5, 353));
  }
  // where the curtain is broken off at its west end, and what is left of it on toward the palace
  add(heap(1.5, 0.2, -0.4, 4.4, 3.2, 1.5, 359), ...strewn(-1.5, -1.5, 0, 9, 4, 367), ...strewn(8, -2.5, 0, 6, 3, 373));
  add(wall([[C.len, 0], [C.on, C.turn]], 1.6, -7.5, 2.4, { ruin: { seed: 379, bite: 2.5, floor: 0.2, ends: [0, 3] }, gaps: [[9, 12.5, 0.1]], name: 'low wall' }));
  return out;
}

/**
 * The south gate. The way in comes over the moat on a causeway, through an outer gate, turns left along a passage
 * sunk between a wall and the platform that overlooks it, turns right and climbs through an inner gate onto the
 * town's top. Its own measure: x east, z south, from the middle of it.
 */
export const GATE = {
  /** the causeway: from where to where across, how far it runs out, how high its top is */
  causeway: { x0: 3, x1: 9, z0: 10, z1: 27, y: -8 },
  /** the passage: the landing inside the outer gate, the corridor west, the landing at the turn, and the ramp north to the town's top */
  floor: { low: -8, turn: -3.8, top: SILL },
  out: { x0: -21, x1: 15, z0: -7, z1: 10 },
  /** where the inner ramp leaves the level of the town and starts down */
  sill: -5.6,
};
function gate(): Part[] {
  const G = GATE, F = G.floor, out: Part[] = [];
  const add = (...p: Part[]) => void out.push(...p);
  const slab = (x0: number, z0: number, x1: number, z1: number, ya: number, yb: number, alongX: boolean, name: string): Slab => ({ t: 'slab', thick: 0.6, paint: 'paving', name, p: alongX ? [[x0, ya, z0], [x0, ya, z1], [x1, yb, z1], [x1, yb, z0]] : [[x0, ya, z0], [x0, yb, z1], [x1, yb, z1], [x1, ya, z0]] });
  // ---- what is walked on: causeway, landing, corridor (rising west), landing, ramp (rising north)
  add(wall([[6, G.causeway.z0], [6, G.causeway.z1]], 6, -15, G.causeway.y, { cap: 'paving', name: 'causeway' }));
  for (const x of [3.25, 8.75]) add(wall([[x, 10], [x, G.causeway.z1]], 0.5, G.causeway.y - 0.1, G.causeway.y + 0.75, { ruin: { seed: 401 + x, bite: 0.6, floor: G.causeway.y + 0.1 }, name: 'causeway kerb' }));
  add(slab(3, 3, 10, 10.2, F.low, F.low, true, 'outer landing'), slab(-11, 3, 3, 7.5, F.turn, F.low, true, 'corridor'), slab(-15, 3, -11, 7.5, F.turn, F.turn, true, 'turn'), slab(-15, GATE.sill, -11, 3, F.top, F.turn, false, 'inner ramp'));
  add(slab(-15, -8.2, -11, GATE.sill, F.top, F.top, true, 'inner sill'), apron([-15, -8.2], [-11, -8.2], [0, -1], F.top));
  // ---- the platforms that look down on it, level with the town
  add(floor([[-11, -7], [15, -7], [15, 10], [10, 10], [10, 3], [-11, 3]], SILL, 'sand', { name: 'gate platform' }), floor(rect(-21, -7, -15, 10), SILL, 'sand', { name: 'west platform' }));
  // ---- the walls: the outside, deep-footed, and the faces of the platforms over the passage (each rises a parapet's height over its platform)
  const P = { ruin: (seed: number) => ({ seed, bite: 1.1, floor: SILL + 0.1 }) };
  const south = wall([[-21, 9], [15, 9]], 2, -15.5, [[0, 1.2], [5.9, 1.2], [6, -2], [23.9, -2], [24, 2.6], [29.9, 2.6], [30, 1.2], [36, 1.2]], { ruin: { seed: 409, bite: 1.4, floor: -3.4 }, name: 'gate south wall' });
  south.openings = [{ s: 27, w: 3.2, y0: F.low, y1: F.low + 4.3, arch: true }];
  south.gaps = [[26.2, 27.9, F.low + 4.65, 1.3], [8.5, 11.5, -3.2, 1.6]];
  add(south, wall([[14.5, -7], [14.5, 8]], 1, -15.5, 1.2, { ruin: P.ruin(419), name: 'gate east wall' }), wall([[-20.5, -7], [-20.5, 8]], 1, -15.5, 1.2, { ruin: P.ruin(421), name: 'gate west wall' }));
  add(crenels(wall([[-11, 2.5], [10.5, 2.5]], 1, -9, 1.15, { ruin: P.ruin(431), name: 'platform wall over the corridor' }), 1, 13, 3.2, SILL + 0.6));
  add(wall([[10.5, 3], [10.5, 8]], 1, -9, 1.15, { ruin: P.ruin(433), name: 'platform wall over the landing' }));
  add(wall([[-10.5, 2], [-10.5, -7]], 1, -9, 1.15, { ruin: P.ruin(439), name: 'platform wall over the ramp' }), wall([[-15.5, 8], [-15.5, -7]], 1, -9, 1.15, { ruin: P.ruin(443), name: 'west platform wall' }));
  // the inner gate: two jambs and what is left of the arch between them
  const inner = wall([[-16, -4.2], [-10, -4.2]], 1.4, -6, 4.2, { ruin: { seed: 449, bite: 2.4, floor: 1.4 }, name: 'inner gate' });
  inner.openings = [{ s: 3, w: 3, y0: -6, y1: rampYGate(-4.2) + 3.6, arch: true }];
  inner.gaps = [[2.3, 3.9, rampYGate(-4.2) + 2.9, 0.9]];
  add(inner, ...strewn(-13, 1, F.turn + 0.5, 7, 2.2, 457), ...strewn(6.5, 6, F.low, 8, 3, 461), heap(-2, 6.6, -6.4, 2.4, 1.2, 1.1, 463));
  return out;
}
/** how high the gate's inner ramp is at a point along it (z, in the gate's own measure) */
export function rampYGate(z: number): number {
  const F = GATE.floor;
  return z <= GATE.sill ? F.top : F.top + ((F.turn - F.top) * Math.min(1, (z - GATE.sill) / (3 - GATE.sill)));
}

/** the dug-out houses: a block of small rooms between two lanes, their walls knee to shoulder high */
export const HONEYCOMB = { w: 37, d: 32, lane: 2, seed: 503 };
/** the rooms of the houses, each [x0, z0, x1, z1] between the middle lines of its walls, with the lines of wall each block of them is cut by */
function houses(): { rooms: [number, number, number, number][]; blocks: { x0: number; x1: number; z0: number; z1: number; cx: number[]; cz: number[]; seed: number }[] } {
  const H = HONEYCOMB, rooms: [number, number, number, number][] = [], blocks: ReturnType<typeof houses>['blocks'] = [];
  // four blocks, with a lane along the middle and a lane across it
  const xs = [[0, (H.w - H.lane) / 2], [(H.w + H.lane) / 2, H.w]], zs = [[0, (H.d - H.lane) / 2], [(H.d + H.lane) / 2, H.d]];
  let n = 0;
  for (const [x0, x1] of xs) for (const [z0, z1] of zs) {
    const seed = H.seed + n++ * 31;
    const cut = (a: number, b: number, s: number) => {
      const at = [a];
      while (b - at[at.length - 1] > 6.2) at.push(at[at.length - 1] + 3.3 + hash(at.length, s, seed) * 1.6);
      at.push(b);
      return at;
    };
    const cx = cut(x0, x1, 1), cz = cut(z0, z1, 2);
    blocks.push({ x0, x1, z0, z1, cx, cz, seed });
    for (let i = 0; i + 1 < cx.length; i++) for (let j = 0; j + 1 < cz.length; j++) rooms.push([cx[i], cz[j], cx[i + 1], cz[j + 1]]);
  }
  return { rooms, blocks };
}
function honeycomb(): Part[] {
  const out: Part[] = [], { rooms, blocks } = houses();
  for (const { x0, x1, z0, z1, cx, cz, seed } of blocks) {
    // every line of wall, with ways through it: each room has a way to the next along its row, and the rows on a lane
    // have doors to it. No two lines are left as high as one another: here a footing, there a wall to the shoulder.
    const line = (pts: V2[], k: number) => {
      const top = 0.7 + 1.7 * hash(k, 11, seed) ** 1.6;
      return wall(pts, 0.7, -3.5, top, { ruin: { seed: seed + k * 3, bite: top - 0.2, floor: 0.2, ends: [hash(k, 12, seed) < 0.3 ? 2.5 : 0, hash(k, 13, seed) < 0.3 ? 2.5 : 0] }, name: 'house wall' });
    };
    cz.forEach((z, j) => {
      const w = line([[x0, z], [x1, z]], j);
      for (let i = 0; i + 1 < cx.length; i++) if (j === 0 || j === cz.length - 1 ? hash(i, j, seed) < 0.75 : hash(i, j, seed) < 0.45) opening(w, (cx[i] + cx[i + 1]) / 2 + (hash(i, j + 9, seed) - 0.5), z, 0.95, -4, 99);
      out.push(w);
    });
    cx.forEach((x, i) => {
      const w = line([[x, z0], [x, z1]], 50 + i);
      for (let j = 0; j + 1 < cz.length; j++) if (i === 0 || i === cx.length - 1 ? hash(i + 20, j, seed) < 0.6 : hash(i + 20, j, seed) < 0.7) opening(w, x, (cz[j] + cz[j + 1]) / 2 + (hash(i + 30, j, seed) - 0.5), 0.95, -4, 99);
      out.push(w);
    });
    out.push(...strewn((x0 + x1) / 2, (z0 + z1) / 2, 0, 9, 7, seed + 7));
  }
  // a room in ten is full of what fell into it, or of what was dug out of the next
  rooms.forEach(([x0, z0, x1, z1], k) => {
    if (hash(k, 21, HONEYCOMB.seed) < 0.12) out.push(heap((x0 + x1) / 2, (z0 + z1) / 2, 0, (x1 - x0) / 2 - 0.5, (z1 - z0) / 2 - 0.5, 0.7 + hash(k, 22, HONEYCOMB.seed) * 0.5, 520 + k));
  });
  return out;
}

/** the wall to the river: seventy-five metres out from the town, a way along its top, small towers on one side, a tower at its end */
export const SPUR = { len: 72, wide: 4.5, top: -8.4, plain: -11.7, stair: [3, 24] as V2, turrets: [26, 43, 60], breach: [34.3, 36.7] as V2, end: { x0: 72, x1: 78, half: 3 } };
/** the ground it is built for, along it: the town's top, the scarp, the moat it crosses, and the plain it runs out on */
const SPUR_GROUND: [number, number][] = [[1, 0], [19.5, -11.7]];
function spur(): Part[] {
  const P = SPUR, out: Part[] = [], T = P.top;
  const add = (...p: Part[]) => void out.push(...p);
  // (under the steps the wall is kept well down: each length of it has one height, and the steps a slope)
  const line: [number, number][] = [[0, SILL], [P.stair[0], SILL], [P.stair[0] + 0.05, SILL - 0.9], [P.stair[1], T - 0.9], [P.stair[1] + 0.05, T], [P.len, T]];
  add(wall([[0, 0], [P.len, 0]], P.wide, -16, line, { cap: 'paving', gaps: [[P.breach[0], P.breach[1], P.plain + 2.2]], name: 'spur' }));
  add(flight([P.stair[1], T, 0], [P.stair[0], SILL, 0], P.wide - 1.1, 'stone', -16));
  for (const side of [-1, 1]) {
    const z = side * (P.wide / 2 - 0.25);
    const up = wall([[0, z], [P.stair[1], z]], 0.5, -16, [[0, SILL + 1], [P.stair[0], SILL + 1], [P.stair[1], T + 1]], { ruin: { seed: 601 + side, bite: 0.8, floor: -99 }, name: 'spur parapet' });
    const a = wall([[P.stair[1], z], [P.breach[0] - 1, z]], 0.5, T - 0.1, T + 1.1, { ruin: { seed: 607 + side, bite: 1, floor: T + 0.1, ends: [0, 3] }, name: 'spur parapet' });
    const b = wall([[P.breach[1] + 1, z], [P.len, z]], 0.5, T - 0.1, T + 1.1, { ruin: { seed: 613 + side, bite: 1, floor: T + 0.1, ends: [3, 0] }, name: 'spur parapet' });
    // (on the side the small towers stand, the parapet is open to each)
    if (side > 0) for (const w of [a, b]) for (const x of P.turrets) if (x > w.pts[0][0] && x < w.pts[1][0]) opening(w, x, z, 2.6, T, 99);
    add(up, a, b);
  }
  // the small towers on the east side: each a bay off the walk, walled on three sides
  for (const [k, x] of P.turrets.entries()) {
    add(wall([[x, P.wide / 2], [x, P.wide / 2 + 3]], 4, -16, T, { cap: 'paving', name: 'turret' }));
    add(crenels(wall([[x - 1.75, P.wide / 2 + 0.2], [x - 1.75, P.wide / 2 + 2.75], [x + 1.75, P.wide / 2 + 2.75], [x + 1.75, P.wide / 2 + 0.2]], 0.5, T - 0.1, T + 1.5, { ruin: { seed: 617 + k, bite: 1.1, floor: T + 0.3 }, name: 'turret wall' }), 2.2, 6.4, 1.4, T + 0.9, 0.7));
  }
  // where it is broken through: a way across its line on the plain, and up onto it either side
  const bm = (P.breach[0] + P.breach[1]) / 2;
  add(heap(bm, 0, P.plain, 5.4, 6.2, T - P.plain + 0.4, 631), ...strewn(bm, 3.5, P.plain, 10, 4, 641), ...strewn(bm, -3.5, P.plain, 8, 4, 643));
  // the tower at its end: a room on the plain with a door to the river, a platform level with the walk, a stair between
  {
    const E = P.end, w = wall(rect(E.x0 + 0.5, -E.half + 0.5, E.x1 - 0.5, E.half - 0.5), 1, P.plain - 3, T + 1.6, { closed: true, ruin: { seed: 647, bite: 1.1, floor: T + 0.4 }, name: 'end tower' });
    opening(w, E.x1 - 0.5, 0.9, 1.1, P.plain + SILL, P.plain + 2.3);
    fallen(w, [E.x1 - 2.2, -E.half + 0.5], [E.x1 - 0.5, -0.6], T + 0.2, 1.4);
    add(heap(E.x1 + 1.2, -E.half - 0.6, P.plain, 3, 2.6, 1.3, 651), ...strewn(E.x1 + 2, -E.half - 1.5, P.plain, 8, 3.5, 653));
    opening(w, E.x0 + 0.5, 0, 1.6, T, 99);
    for (const [x, z] of [[E.x1 - 0.5, -1], [E.x0 + 3, -E.half + 0.5], [E.x0 + 3, E.half - 0.5]] as V2[]) opening(w, x, z, 0.8, T + 0.95, 99);
    add(w, floor(rect(E.x0 + 1, -E.half + 1, E.x1 - 1, E.half - 1), P.plain + SILL, 'paving', { name: 'end tower floor' }));
    add(floor(rect(E.x0 + 1, -E.half + 1, E.x1 - 1, E.half - 1), T, 'timber', { holes: [rect(E.x0 + 2.4, -E.half + 1, E.x1 - 1, -E.half + 2.05)], under: 0.12, name: 'end tower platform' }));
    add(flight([E.x1 - 1.55, P.plain + SILL, -E.half + 1.52], [E.x0 + 1.4, T, -E.half + 1.52], 0.9, 'timber'));
    add(apron([E.x1, 0.35], [E.x1, 1.45], [1, 0], P.plain + SILL));
  }
  return out;
}

/** the north wall: footings a hundred and thirty metres long, and four small towers standing out from them */
export const NORTH = { len: 130, towers: [6, 22, 42, 62], tower: { w: 4, d: 5 } };
function north(): Part[] {
  const N = NORTH, out: Part[] = [];
  out.push(wall([[0, 0], [N.len, 0]], 2, -6, 1, { ruin: { seed: 701, bite: 1.3, floor: 0.15, ends: [4, 6] }, gaps: [[30, 33, 0.1], [76, 81, 0.05], [104, 107, 0.1]], name: 'north footings' }));
  N.towers.forEach((x, k) => {
    const w = wall([[x - 1.55, 1], [x - 1.55, N.tower.d - 0.45], [x + 1.55, N.tower.d - 0.45], [x + 1.55, 1]], 0.9, -9, 3.2, { ruin: { seed: 709 + k * 4, bite: 2.4, floor: 0.9 }, name: 'north tower' });
    out.push(w, ...strewn(x, N.tower.d + 1.5, -0.6, 6, 2.5, 733 + k));
  });
  // (each tower is come into over the footings, which are broken down before it)
  for (const x of N.towers) (out[0] as Wall).gaps!.push([x - 0.8, x + 0.8, 0.2]);
  out.push(...strewn(79, 1.5, 0, 9, 4, 751), ...strewn(31.5, -1, 0, 6, 3, 757));
  return out;
}

/** what is left of the wall on the banks: a short length, a longer one with a return, and the foot of a tower */
function stub(which: 'stubA' | 'stubB' | 'stump'): Part[] {
  if (which === 'stubA') return [wall([[-3.5, 0], [3.5, 0]], 2, -5, 2.2, { ruin: { seed: 801, bite: 2, floor: 0.3, ends: [2, 2.5] }, name: 'wall stub' }), ...strewn(1, 2, 0, 6, 3, 811)];
  if (which === 'stubB') return [wall([[-6.5, 0], [4, 0], [5.5, -3.5]], 2, -5, 2.6, { ruin: { seed: 821, bite: 2.3, floor: 0.3, ends: [3, 1.5] }, gaps: [[4.5, 6.5, 0.4]], name: 'wall stub' }), ...strewn(-1, 2.2, 0, 8, 4, 823)];
  const w = wall(rect(-2.4, -2.4, 2.4, 2.4), 1.4, -6, 2.4, { closed: true, ruin: { seed: 827, bite: 2, floor: 0.5 }, name: 'tower stump' });
  opening(w, 0, -2.4, 1.1, -7, 99);
  return [w, ...strewn(0, 4, 0, 7, 3, 829)];
}

const made = new Map<Piece, Part[]>();
/** Every part of a piece, in the piece's own measure. (Worked out once: it is the same every time.) */
export function ruinParts(piece: Piece): Part[] {
  let p = made.get(piece);
  if (!p) made.set(piece, (p = piece === 'alcazar' ? alcazar() : piece === 'curtain' ? curtain() : piece === 'gate' ? gate() : piece === 'honeycomb' ? honeycomb() : piece === 'spur' ? spur() : piece === 'north' ? north() : stub(piece)));
  return p;
}

// ------------------------------------------------------------------ the ground each piece is built for

/**
 * What a piece asks of the ground: 2, it MUST be no higher than this (a floor of the piece lies over it); 1, the
 * piece is built for this, give or take a hand (a doorway opens at it, a stair lands on it); 0, the piece does not
 * mind, and this is only what was assumed (its footings go four metres under it).
 */
export type Hold = 0 | 1 | 2;
/** what the ground is at a spot, for whoever paints it: the town's trodden top; a court of the palace; ground dug away under a floor (never seen); a bank's or a ditch's side; a moat's floor; a shelf under a wall; the open plain; a worn way; the river's flats; its dry bed */
export type GroundKind = 'top' | 'court' | 'dug' | 'scarp' | 'moat' | 'berm' | 'plain' | 'path' | 'flats' | 'river';
export interface Ground { y: number; hold: Hold; kind: GroundKind }

/** the outline a piece is the middle of: how far its ground is its own */
const FOOT: Record<Piece, V2[]> = {
  alcazar: [[-3, -6], [22, -26], [41, -7], [78, 22], [80, 40], [-3, 58]],
  curtain: [[-3, -4], [93, -11], [93, 2], [67, 7], [43, 15], [31, 15], [12, 7], [-3, 3]],
  gate: [[-22, -9], [16, -9], [16, 11], [10, 25], [2, 25], [-22, 11]],
  honeycomb: rect(-1, -1, HONEYCOMB.w + 1, HONEYCOMB.d + 1),
  spur: [[-1, -3], [70, -3], [70, -4], [79, -4], [79, 4], [70, 4], [70, 6], [24, 6], [-1, 3]],
  north: rect(-1, -2, NORTH.len + 1, 6),
  stubA: rect(-4, -1.5, 4, 1.5),
  stubB: rect(-7, -4, 6, 1.5),
  stump: rect(-3.4, -3.4, 3.4, 3.4),
};
export const ruinFoot = (piece: Piece): V2[] => FOOT[piece];

/**
 * The palace's outer walls, each with the height of the ground at its foot outside, how low that ground has got
 * by so many metres out, and what it is: the front stands on the level of its own gate; the ward's west wall in a
 * ditch that climbs to that level; the rest over the moat and the river's flats. The last is no outer wall: it is
 * the foot of the wall between the middle court and the lower ward, which the ground inside is as low as.
 */
const ALCAZAR_SIDES: [V2, V2, number, number, number, 'top' | 'ditch' | 'moat' | 'ward'][] = [
  [[0, -4.5], [0, 56.5], 0, 0, 1, 'top'],
  [[2.5, -4.5], ALCAZAR.N1, ALCAZAR.lower + 1, 0, 20, 'ditch'],
  [ALCAZAR.N1, ALCAZAR.N2, ALCAZAR.lower - 0.5, -14, 13, 'moat'],
  [ALCAZAR.N2, ALCAZAR.D, ALCAZAR.middle - 1, -12.5, 17, 'moat'],
  [ALCAZAR.D, ALCAZAR.C, ALCAZAR.middle - 1.3, -9.5, 10, 'moat'],
  [ALCAZAR.C, [50, 40.87], ALCAZAR.middle - 1.3, -8, 7, 'moat'],
  [[44, 42.15], [-1.5, 51.8], ALCAZAR.upper - 1, -8, 13, 'moat'],
  [[7.5, 2.2], [47.4, 2.2], ALCAZAR.lower, 0, 1, 'ward'],
];
const ALCAZAR_WALLS: V2[] = [[0, -4.5], [2.5, -4.5], ALCAZAR.N1, ALCAZAR.N2, ALCAZAR.D, ALCAZAR.C, [0, 51.5]];
const LOWER_WARD: V2[] = [[2.5, -4.5], ALCAZAR.N1, ALCAZAR.N2, [47.4, 2.2], [7.5, 2.2], [7.5, -4.5]];
/**
 * Where the ground under the palace's floors is dug right out. Its edge is three metres inside the outer face of
 * every wall: the ground of the map is a net of two metres, and a cut made nearer a wall than that shows as a
 * trench along the outside of it. Between this edge and the walls the ground is at the height of the ground
 * outside, which every floor over that strip is higher than.
 */
const UNDER_FLOORS: V2[] = [[3, 5.2], [47.8, 5.2], [71.5, 26.3], [69.1, 32.8], [68.5, 34.9], [3, 48.8]];
/** how far a cut in the ground is kept from the face that hides it: the longest way between two points of the map's net, and a little */
export const CUT_IN = 3;

/** The ground a piece is built for at a spot of its own measure, as a height over the town's top, and how much the piece minds. */
export function ruinGround(piece: Piece, x: number, z: number): Ground {
  if (piece === 'alcazar') {
    if (inside(x, z, LOWER_WARD)) return { y: ALCAZAR.lower, hold: 1, kind: 'court' };
    if (inside(x, z, UNDER_FLOORS)) return { y: ALCAZAR.dug, hold: 2, kind: 'dug' };
    // everywhere else each wall says how high the ground is at its foot, and the nearest says most. Outside the
    // walls it falls away from that as the wall's side of the place does; inside them it stays at it.
    const within = inside(x, z, ALCAZAR_WALLS);
    let sum = 0, weight = 0, near = Infinity;
    for (const [a, b, foot, far, run, how] of ALCAZAR_SIDES) {
      if (how === 'ward' && !within) continue;
      const [d, t] = toSegment(x, z, a, b), k = 1 / (d + 0.5) ** 4;
      // (the ditch is shallow where it begins, under the keep, and at its full depth a dozen metres on)
      const at = how === 'ditch' ? -3 + (foot + 3) * smooth(0, 0.45, t) : foot;
      const y = within || how === 'top' ? at : how === 'ditch' ? at * (1 - smooth(3, run, d)) : far + (foot - far) * (1 - smooth(0.5, run, d));
      sum += y * k;
      weight += k;
      near = Math.min(near, d);
    }
    const y = sum / weight;
    return { y, hold: within ? 2 : near < 6 ? 1 : 0, kind: within ? 'dug' : y > -0.5 ? 'top' : 'scarp' };
  }
  if (piece === 'curtain') {
    const y = through(CURTAIN_GROUND, z);
    return { y, hold: z < 14 && x > -6 && x < 98 ? 1 : 0, kind: z < 1 ? 'top' : z < 7 ? 'scarp' : z < 13.5 ? 'berm' : z < 24 ? 'scarp' : z < 46 ? 'moat' : 'plain' };
  }
  if (piece === 'gate') {
    const G = GATE, O = G.out;
    // (dug out under the sunk passage and on under the platforms that overlook it, as far as hides the cut: see CUT_IN)
    const sunk = (x > -15 - CUT_IN + 0.2 && x < 10 + CUT_IN - 0.9 && z > 3 - CUT_IN + 0.2 && z < 9) || (x > -15 - CUT_IN + 0.2 && x < -11 + CUT_IN - 0.2 && z > G.sill && z <= 3);
    if (sunk) return { y: -12.5, hold: 2, kind: 'dug' };
    const y = through([[-5, 0], [12, -11.2], [21, -11.2], [G.causeway.z1, -8]], z);
    return { y, hold: x > O.x0 - 4 && x < O.x1 + 4 && z < 14 ? 1 : 0, kind: z < -5 ? 'top' : z < 12 ? 'scarp' : z < 21 ? 'moat' : z < G.causeway.z1 ? 'scarp' : 'plain' };
  }
  if (piece === 'spur') {
    const y = through(SPUR_GROUND, x);
    return { y, hold: Math.abs(z) < 9 ? 1 : 0, kind: x < 1 ? 'top' : x < 19.5 ? 'scarp' : 'flats' };
  }
  if (piece === 'north') {
    // (no moat on this side: a bank down to a shelf, the shelf, and a second bank down to the river's flats)
    const y = through([[2.5, 0], [11, -4.4], [33, -5.4], [45, -8.7]], z);
    return { y, hold: z < 7 ? 1 : 0, kind: z < 2.5 ? 'top' : z < 11 ? 'scarp' : z < 33 ? 'berm' : z < 45 ? 'scarp' : 'flats' };
  }
  return { y: 0, hold: piece === 'honeycomb' ? 1 : 0, kind: 'top' };
}

/**
 * What lies at the foot of a wall at a spot beside it: the highest floor of the piece there that is under a
 * height, or the ground the piece is built for (null: neither, the ground is dug away there under a floor).
 */
export function ruinBase(piece: Piece, x: number, z: number, under: number): number | null {
  let best: number | null = null;
  for (const p of ruinParts(piece)) {
    if (p.t !== 'floor' || p.hidden || p.under || p.y > under) continue;
    if (inside(x, z, p.pts) && !(p.holes ?? []).some((h) => inside(x, z, h)) && (best === null || p.y > best)) best = p.y;
  }
  if (best !== null) return best;
  const g = ruinGround(piece, x, z);
  return g.kind === 'dug' ? null : g.y;
}

// ------------------------------------------------------------------ the town as it stood: where each piece was

/** the edge of the town's top, as it was measured: clockwise from the west tip (x east, z south, from the survey's own beginning) */
export const OUTLINE: V2[] = [[-195, 56], [-180, 32], [-151, -1], [-121, -34], [-91, -68], [-68, -88], [-31, -89], [8, -89], [47, -85], [71, -78], [93, -64], [113, -52], [158, -37], [161, -28], [137, -10], [104, 11], [81, 29], [59, 48], [30, 66], [-1, 86], [-13, 93], [-34, 104], [-79, 108], [-121, 105], [-191, 80]];
/** the levels of the land round it, over the town's top: the plain to the west and south, a moat's floor, the river's flats to the north, and how far under them its dry bed lies */
export const LAND = { plain: -8, moat: -11, flats: -17.3, bed: 1.7 };
/** the paths on the top: from the palace's arch west to a fork, one arm to the north corner, one to the south gate */
export const PATHS: V2[][] = [[[78, -11], [20, -8], [-40, -5]], [[-40, -5], [-56, -50], [-69, -84]], [[-40, -5], [-34, 50], [-28, 90]]];
/** the track that comes to the gate over the fields, from the foot of its causeway */
export const TRACK: V2[] = [[-9, 127], [-16, 150], [-44, 196], [-96, 250]];
/** the middle of the river's dry bed, north of the town: it passes the end of the spur, which was built out to reach it */
export const RIVER: V2[] = [[-300, -150], [-170, -174], [-80, -182], [-20, -152], [40, -131], [100, -125], [170, -111], [270, -92]];
/**
 * The land round the edge of the top, side by side: for each side of the outline (in its order), what a line
 * run straight out from the middle of it does. [how high the rampart's bank stands over the edge; how far out the
 * foot of the scarp is; the level there; how wide that floor is; how far on the far side climbs or falls; the
 * level it comes to; the level twenty metres beyond; and sixty beyond that.] Measured at intake from the survey
 * of the real town (a line every thirty metres or so round it) and rounded to rules: on the west and the south a
 * ditch with a far bank; on the south-west and south-east a broad flat floor that rises slowly to the fields; on
 * the north no moat at all, but a shelf and then the river's flats; and the scarp never asked steeper than a net
 * of two metres can carry without a stretched face (about thirty-four degrees).
 */
const RIM: number[][] = [
  [1.2, 15, -9.1, 11, 6, -7.2, -7.4, -8], [1.7, 15, -9, 9, 6, -7.4, -7.6, -9.3], [1.7, 16, -9.9, 10, 6, -8, -8.3, -9.6], [1.4, 17, -12.5, 10, 8, -8.6, -8.9, -10.2], [1, 16, -15.1, 10, 9, -10.6, -10.9, -15.1],
  [0, 17, -16.9, 30, 6, -17.2, -17.3, -17.3], [0, 16, -17.3, 30, 6, -17.3, -17.3, -17.3], [0, 9, -13.4, 18, 9, -17.6, -17.6, -17.3], [0, 8, -14.2, 24, 8, -17.5, -17.4, -17.3], [0, 9, -13.6, 14, 8, -16.8, -17, -17.3],
  [0, 13, -15, 26, 6, -15.4, -16, -17.3], [0, 14, -14.8, 26, 6, -15, -15.8, -17], [0, 13, -14, 24, 6, -13.8, -13.7, -15], [0, 13, -12.1, 7, 6, -9.2, -9.5, -10], [0, 15, -10.3, 22, 14, -8.6, -8.5, -8.8],
  [0, 15, -10.3, 22, 14, -8.7, -8.6, -8.9], [0.4, 16, -10.4, 22, 14, -8.8, -8.8, -9], [0.5, 16, -10.5, 22, 14, -8.8, -8.8, -9], [0.5, 17, -11, 10, 6, -8.9, -9, -9.3], [0.8, 17, -11.2, 9, 8, -8, -8.1, -8.5],
  [0.6, 17, -10.9, 9, 7, -7.9, -8.1, -8.5], [1.2, 17, -11.3, 16, 10, -9.1, -9.4, -9.6], [1.4, 17, -10.8, 26, 12, -9.6, -9.8, -10], [1.5, 17, -10.9, 28, 12, -9.5, -9.6, -10.3], [1.8, 16, -9.5, 14, 8, -6.9, -6.7, -7.5],
];
/** the steepest the land is asked to be where it is seen, rise over run */
export const GENTLE = 0.67;

/**
 * Where a piece stood in the real town, in the town's measure, and how high its own level is over the town's
 * (the palace stands on the low ground at the point, three metres under the top; the houses on the fall toward
 * it; the north wall and the spur where the top has tilted down to the river; a remnant of the bank's wall on
 * the bank's crest).
 */
export interface Stood { piece: Piece; x: number; z: number; yaw: number; y: number }
/** Where each piece stood in the real town. */
let laid: Stood[] | null = null;
export function ruinsLayout(): Stood[] {
  if (laid) return laid;
  const out: Stood[] = [
    { piece: 'alcazar', x: 80, z: -31, yaw: Math.atan2(0.408, 0.913), y: -3 },
    { piece: 'curtain', x: 20, z: 72, yaw: Math.atan2(0.483, 0.876), y: 0 },
    { piece: 'gate', x: -15, z: 100, yaw: 0, y: 0 },
    { piece: 'honeycomb', x: 48.2, z: 15.4, yaw: Math.atan2(0.483, 0.876), y: -2.2 },
    { piece: 'spur', x: -70, z: -90, yaw: Math.atan2(75, 7), y: -5.6 },
    { piece: 'north', x: 62, z: -82, yaw: Math.PI - 0.0461, y: -8.6 },
  ];
  // what is left of the wall along the west and south banks: a remnant on each long side of the outline, set back from its edge
  const kinds: Piece[] = ['stubB', 'stubA', 'stump', 'stubA', 'stubB', 'stubA'];
  [0, 1, 2, 3, 4, 21, 22, 23, 24].forEach((e, k) => {
    const a = OUTLINE[e], b = OUTLINE[(e + 1) % OUTLINE.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]), d: V2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], t = 0.3 + 0.4 * hash(e, 1, 9);
    // (the outline runs clockwise, so its inside is on the right of somebody walking it)
    const x = a[0] + (b[0] - a[0]) * t - d[1] * 4, z = a[1] + (b[1] - a[1]) * t + d[0] * 4;
    out.push({ piece: kinds[k % kinds.length], x, z, yaw: Math.atan2(-d[1], d[0]), y: Math.round(land(x, z).y * 10) / 10 - 0.2 });
  });
  return (laid = out);
}
/** Where each piece stands in the world, for a town set down at a place as it really stood. */
export function ruinsPlan(site: Place): { piece: Piece; place: Place }[] {
  return ruinsLayout().map(({ piece, x, z, yaw, y }) => {
    const [wx, wy, wz] = ruinAt(site, x, z, y);
    return { piece, place: { x: wx, y: wy, z: wz, rot: site.rot + yaw } };
  });
}

/** how far a spot is from a line of points */
function toLine(x: number, z: number, pts: V2[]): number {
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, toSegment(x, z, pts[i], pts[i + 1])[0]);
  return d;
}
/** the town's top at a spot: a low dome, tilting down to the river in its north third, and falling east to the palace's gate */
function topLevel(x: number, z: number, d: number): number {
  const dome = 1.2 * smooth(0, 60, -d), north = -0.07 * Math.max(0, -z - 22) ** 1.15 * (1 + 0.25 * smooth(-60, 60, x)), east = -4.3 * smooth(40, 75, x) * (1 - 0.75 * smooth(5, 35, z));
  return dome + north + east;
}
const rimMade: { start: number[]; len: number[]; total: number } = { start: [], len: [], total: 0 };
/**
 * The land without the pieces: the top, the bank inside its edge, and outside it whatever that side of the town
 * has (see RIM), with the river's bed across the flats, a slow roll in the open ground, and the worn ways.
 */
function land(x: number, z: number): Ground {
  const O = OUTLINE, n = O.length;
  if (!rimMade.total) for (let e = 0; e < n; e++) {
    rimMade.start.push(rimMade.total);
    rimMade.len.push(Math.hypot(O[(e + 1) % n][0] - O[e][0], O[(e + 1) % n][1] - O[e][1]));
    rimMade.total += rimMade.len[e];
  }
  // the nearest point of the edge, and how far round the edge it is
  let near = Infinity, arc = 0, px = 0, pz = 0;
  for (let e = 0; e < n; e++) {
    const a = O[e], b = O[(e + 1) % n], [dist, t] = toSegment(x, z, a, b);
    if (dist < near) {
      near = dist;
      arc = rimMade.start[e] + t * rimMade.len[e];
      px = a[0] + (b[0] - a[0]) * t;
      pz = a[1] + (b[1] - a[1]) * t;
    }
  }
  const d = inside(x, z, O) ? -near : near;
  // that side's measures: between the middle of the side the point is nearest and the middle of the next (or the last)
  let e = 0;
  while (e + 1 < n && rimMade.start[e + 1] <= arc) e++;
  const half = arc - rimMade.start[e] < rimMade.len[e] / 2, e0 = half ? (e + n - 1) % n : e, e1 = half ? e : (e + 1) % n;
  const m0 = rimMade.start[e0] + rimMade.len[e0] / 2, m1 = rimMade.start[e1] + rimMade.len[e1] / 2;
  const span = (m1 - m0 + rimMade.total) % rimMade.total || 1, t = smooth(0, 1, ((arc - m0 + rimMade.total) % rimMade.total) / span);
  const R = RIM[e0].map((v, k) => v + (RIM[e1][k] - v) * t), [crest, , floor, wide, , lip, far, deep] = R;
  if (d <= 0) {
    // inside: the top, the bank near its edge, a slow unevenness away from the edge, and the paths worn into it
    const worn = Math.min(...PATHS.map((p) => toLine(x, z, p)));
    const y = topLevel(x, z, d) + crest * smooth(-9, -4.5, d) * (1 - 0.4 * smooth(-2.5, 0, d)) + (rough(x * 0.05, z * 0.05, 19) - 0.5) * 0.4 * smooth(10, 28, -d) - 0.14 * (1 - smooth(1.2, 2.6, worn));
    return { y, hold: 0, kind: worn < 2 ? 'path' : 'top' };
  }
  // outside: down the scarp to that side's floor, across it, up or down the far side, and on
  const edge = topLevel(px, pz, 0) + crest * 0.6, run = Math.max(R[1], (edge - floor) / GENTLE), on = Math.max(R[4], Math.abs(lip - floor) / (GENTLE * 0.9));
  const a1 = run + wide, a2 = a1 + on, bank = lip > floor + 1.5 ? 0.35 : 0;
  let y = through([[0, edge], [run, floor], [a1, floor], [a2, lip + bank], [a2 + 7, lip], [a2 + 20, far], [a2 + 80, deep]], d);
  let kind: GroundKind = d < run ? 'scarp' : d < a1 ? (floor < -15.5 ? 'flats' : 'moat') : d < a2 ? (lip < -15.5 ? 'flats' : 'scarp') : far < -15.5 ? 'flats' : 'plain';
  // (the road that follows the far lip of the ditch, and the track to the gate)
  if ((bank && Math.abs(d - a2 - 3.5) < 2.2) || toLine(x, z, TRACK) < 2.2) kind = 'path';
  // the open ground rolls a little: nothing in a desert is laid with a level
  y += (rough(x * 0.033, z * 0.033, 17) - 0.5) * 0.9 * smooth(a2 + 6, a2 + 40, d);
  // the river's dry bed, across the flats
  if (y < -14.5) {
    const r = toLine(x, z, RIVER), in_ = (1 - smooth(9, 19, r)) * smooth(-14.5, -16.5, y);
    y -= LAND.bed * in_;
    if (r < 12 && in_ > 0.5) kind = 'river';
  }
  return { y, hold: 0, kind };
}

/**
 * The ground of the whole town as it stood, in the town's measure: the land (see `land`) with each piece's own
 * ground where a piece stands. It is what the town is stood on to be looked at by itself, and it is the brief for
 * whoever shapes the real ground: the heights to give the map's net, how much each spot matters, and what kind of
 * ground it is. Nowhere that is seen is it steeper than GENTLE; what is steeper than that in the real place (the
 * foot of a wall, a fall of stone) is built, not asked of the ground.
 */
export function ruinsGround(x: number, z: number): Ground {
  const base = land(x, z);
  let { y, kind } = base;
  let hold: Hold = 0, most = 0, sum = 0, weight = 0;
  for (const st of ruinsLayout()) {
    const c = Math.cos(st.yaw), s = Math.sin(st.yaw), dx = x - st.x, dz = z - st.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
    const off = outside(lx, lz, FOOT[st.piece]);
    if (off > 14) continue;
    const g = ruinGround(st.piece, lx, lz), w = g.hold === 2 ? 1e6 : (1 - smooth(0, 14, off)) * (st.piece.startsWith('stu') ? 0 : 1);
    if (w <= 0) continue;
    sum += (g.y + st.y) * w;
    weight += w;
    if (w > most) {
      most = Math.min(1, w);
      if (most > 0.5 && !(base.kind === 'path' && g.kind === 'top')) kind = g.kind;
      hold = g.hold;
    }
  }
  if (weight > 0) y += (sum / weight - y) * most;
  return { y, hold, kind };
}

// ------------------------------------------------------------------ what is found there, what burns, who walks

/**
 * WHAT IS KEPT HERE, AND ON WHICH STEP OF THE MAP (the owner: "refer to dayz and use common sense"; the rules are
 * the long comment over TYPES in src/sim/economy.ts).
 *
 * Nobody has lived in the town for eight hundred years, so nothing here is a house, a shop, a clinic or a police
 * station, and nothing of theirs lies here. Two sorts of people have been: the ones who dug it (a shed's worth:
 * spades, lamps, gloves, sacks, a stash kit, which is `Farm` and `Industrial`), and the ones who camp in it now
 * because it is a wall with a view (a hunter's leavings, `Hunting`: a knife, a compass, a flask, tins, rifle
 * rounds). DayZ's castles are just that: hunting and farm loot, no barracks, and worth going to for the walls. A
 * ruin there is never a military place, and here only the three high posts are: the keep, the south tower and the
 * block's roof are a rifleman's nests, with what a soldier who held one left (`Military`).
 *
 * The step: a place's step is where it lies on the map, which is the map's to say. What is proposed is 3 for the
 * town (as far out as Kamenka and as dangerous to cross), and 4 for the palace, as the fort on the mountain is: a
 * long walk, one covered way in, and seen from everywhere. On 4 a thing lies wherever it will (the economy leaves
 * kinds out up there), so the kinds matter for the town and are only good sense for the palace.
 */
export const RUIN_TIER: Record<Piece, 3 | 4> = { alcazar: 4, curtain: 3, gate: 3, honeycomb: 3, spur: 3, north: 3, stubA: 3, stubB: 3, stump: 3 };
export type RuinUsage = 'Hunting' | 'Farm' | 'Industrial' | 'Military';
export interface RuinLoot {
  x: number;
  y: number;
  z: number;
  usage: RuinUsage[];
  building: string;
  floor: boolean;
  tier: 3 | 4;
  /** kept stocked with something to fight with: a gun in the nests, anything in a camp */
  arms?: 'guns' | 'any';
}
const DIG: RuinUsage[] = ['Farm', 'Industrial'], CAMP: RuinUsage[] = ['Hunting'], NEST: RuinUsage[] = ['Military', 'Hunting'];
/** where things lie, in a piece's own measure: [x, z, y, what kind of place, kept armed] */
type Spot = [number, number, number | null, RuinUsage[], ('guns' | 'any')?];
function lootSpots(piece: Piece): Spot[] {
  const A = ALCAZAR, U = A.upper, M = A.middle;
  if (piece === 'alcazar') {
    const S = frame(0, A.south.z, A.south.turn), s = (x: number, z: number, y: number, u: RuinUsage[], arms?: 'guns' | 'any'): Spot => [...S(x, z), y, u, arms];
    return [
      // the nests: the keep's top and its rooms, the block's hall and roof, the south tower
      [3.6, -1.4, 13.1, NEST, 'guns'], [3.9, 2, 13.1, NEST], [2.5, -0.6, 10.6, NEST], [3, 0.4, 7.1, NEST], [3.4, -1, 3.6, NEST], [3, 0.5, SILL, CAMP],
      [3.2, 6.5, SILL, NEST], [4.6, 11, SILL, NEST], [3, 15.4, SILL, CAMP], [3.4, 9, 7.1, NEST, 'guns'], [5.2, 6, 7.1, NEST],
      [3, 52, SILL, CAMP], [3.6, 53, 4.6, NEST], [2.6, 51.4, 9.1, NEST, 'guns'],
      // the walks and the terrace
      [1.3, 30.4, A.walk.west, NEST], [1.2, 45.6, A.walk.west, CAMP], [4.2, 31, SILL, CAMP], [4.4, 44, SILL, DIG],
      s(30, -0.2, A.walk.south, CAMP), s(55, -0.2, A.walk.south, NEST), [A.C[0] + 1.6, A.C[1] + 0.8, SILL, NEST], [A.D[0] + 1.2, A.D[1] - 0.4, SILL, NEST],
      // the church: the camp in it, the gallery, the round end
      s(23.4, -8.5, U + 3.3, CAMP, 'any'), s(22.6, -6, U + 3.3, CAMP), s(30, -7, U, CAMP), s(35, -10.8, U, DIG), s(42, -6.4, U, CAMP), s(46.6, -8.5, U, CAMP), s(18, -8.5, U, DIG),
      // the courts and their rooms
      [12, 24.5, U, DIG], [24, 26, U, CAMP], [42.5, 23.5, U, DIG], [16, 30, U, DIG], [48.6, 26.2, U, CAMP],
      [18.8, 6.2, M, DIG], [33.8, 6.4, M, CAMP], [39.4, 6.2, M, DIG], [47.4, 9.4, M, CAMP], [24, 13, M, DIG], [58.8, 33, M, CAMP], [64, 32.4, M, DIG], [68, 26, M, CAMP],
      // down the cisterns
      [12.2, 9.5, M - 3.5, DIG], [34.5, 21.6, U - 3.5, CAMP], [62.6, 26.2, M - 3.5, DIG],
      // the lower ward: a camp under the wall
      [14, -2, null, CAMP, 'any'], [22, -8, null, CAMP], [30, -4, null, DIG], [36, -1, null, CAMP],
    ];
  }
  if (piece === 'curtain') {
    const C = CURTAIN, W = C.walk;
    return [[17.4, 3, SILL, CAMP, 'any'], [16.2, 2, W, NEST], [53.7, 3, SILL, CAMP], [58.4, -0.2, W, NEST], [28, 0, W, CAMP], [39.6, 0, W, CAMP], [62, 0, W, NEST], [37, 6, SILL, DIG], [36, 10.5, SILL, CAMP], [10, -3, null, DIG], [40, -3, null, DIG], [76, -5, null, DIG]];
  }
  if (piece === 'gate') return [[0, -2, SILL, CAMP, 'any'], [8, -4, SILL, DIG], [12.5, 4, SILL, CAMP], [-18, 2, SILL, DIG], [-4, 5.4, GATE.floor.low + (GATE.floor.turn - GATE.floor.low) * (7 / 14), DIG], [6.5, 5.5, GATE.floor.low, CAMP], [-13, 5, GATE.floor.turn, DIG], [6, 18, GATE.causeway.y, DIG]];
  if (piece === 'honeycomb') {
    // a place in the middle of two rooms in five (not the ones that are full of fallen stone): a spade's work, mostly, and somebody's bed here and there
    return houses().rooms.flatMap(([x0, z0, x1, z1], k): Spot[] => (hash(k, 21, HONEYCOMB.seed) < 0.12 || hash(k, 23, HONEYCOMB.seed) > 0.42 ? [] : [[(x0 + x1) / 2 + 0.3, (z0 + z1) / 2 - 0.2, null, hash(k, 24, HONEYCOMB.seed) < 0.6 ? DIG : CAMP]]));
  }
  if (piece === 'spur') {
    const P = SPUR;
    return [[P.turrets[0], 4, P.top, CAMP], [P.turrets[1], 4, P.top, NEST], [P.turrets[2], 4, P.top, CAMP], [75, 0.4, P.top, NEST, 'any'], [74.6, 0.6, P.plain + SILL, CAMP], [50, 0, P.top, DIG]];
  }
  if (piece === 'north') return [...NORTH.towers.map((x, k): Spot => [x, 2.6, null, k % 2 ? CAMP : DIG]), [90, -2, null, DIG], [118, -2, null, DIG]];
  return [[0, piece === 'stump' ? 0 : 1.6, null, piece === 'stump' ? CAMP : DIG]];
}

/** the height of the ground at a spot of the world, for whoever stands a thing on it: the world's own, where there is one; else what the piece assumes */
export type GroundAt = (wx: number, wz: number) => number;
const assumed = (piece: Piece, p: Place): GroundAt => (wx, wz) => {
  const [x, z] = ruinLocal(p, wx, 0, wz);
  return p.y + ruinGround(piece, x, z).y;
};
/**
 * Every place a thing can lie in a piece, as places in the world. The same on the server and in every game: it is
 * all in the plan. A place on a floor of the piece lies on that floor; one on the ground lies on the ground as it
 * is (`ground`), wherever the map has put it.
 */
export function ruinLoot(piece: Piece, p: Place, ground: GroundAt = assumed(piece, p)): RuinLoot[] {
  return lootSpots(piece).map(([lx, lz, ly, usage, arms]) => {
    const [x, , z] = ruinAt(p, lx, lz), y = ly === null ? ground(x, z) : p.y + ly;
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return { x: r(x), y: r(y + 0.02), z: r(z), usage, building: `ruins_${piece}`, floor: true, tier: RUIN_TIER[piece], ...(arms ? { arms } : {}) };
  });
}

/** what stands in a piece off the shelf: [what, x, z, y (null: on the ground as it is), which way it is turned] */
function stood(piece: Piece): [string, number, number, number | null, number][] {
  const A = ALCAZAR, U = A.upper, M = A.middle;
  if (piece === 'alcazar') {
    const S = frame(0, A.south.z, A.south.turn);
    return [
      // the hall of the block: what was carried in and stacked
      ['wooden_military_crate', 2.6, 5.6, SILL, 0], ['wooden_crate_01', 4.2, 5.3, SILL, 0.3], ['crate_big', 5.2, 16.2, SILL, 1.5],
      // the block's roof and the keep's top: something to kneel behind
      ['wooden_crate_01', 2.6, 8, 7.1, 1.3], ['old_military_crate', 5, 12, 7.1, 0.2], ['weapons_case', 3.2, -1.9, 13.1, 0.4], ['wooden_crate_01', 2.2, -0.6, 13.1, 0.9],
      // the camp in the church, out of the wind, and the one under the wall of the lower ward
      ['stone_fire_pit', ...S(31.5, -8.2), U + 0.19, 0], ['wooden_crate_01', ...S(29.4, -6.6), U, 0.8], ['wooden_crate_01', ...S(23, -10), U + 3.3, 0.4],
      ['stone_fire_pit', 15.5, -4, null, 0], ['wooden_crate_01', 13, -6.4, null, 1.1], ['shovel', 29, -3, null, 0.6],
      // the courts: the diggers' boxes
      ['wooden_crate_01', 11.5, 26, U, 0.2], ['crate_big', 43, 21.6, U, 0], ['wooden_crate_01', 34, 5.2, M, 1.4], ['wooden_crate_01', 59, 34.4, M, 0.5], ['stone_fire_pit', 66, 23, M + 0.19, 0],
      ['old_military_crate', 3, 53.2, 4.6, 0.3], ['wooden_crate_01', 4.6, 40, SILL, 1.6],
    ];
  }
  if (piece === 'curtain') return [['stone_fire_pit', 30, -5.5, null, 0], ['wooden_crate_01', 17.6, 4, SILL, 0.3], ['wooden_crate_01', 38.6, 8, SILL, 1], ['wooden_crate_01', 40.4, 0.1, CURTAIN.walk, 0.1]];
  if (piece === 'gate') return [['stone_fire_pit', 2, -3.5, SILL + 0.19, 0], ['wooden_crate_01', -1, -4.6, SILL, 0.6], ['wooden_crate_01', 9, 6, GATE.floor.low, 0.7], ['crate_big', -18, -3, SILL, 0.2]];
  if (piece === 'honeycomb') return [['stone_fire_pit', 9, 9.4, null, 0], ['wooden_crate_01', 26, 22, null, 0.4], ['shovel', 13, 24, null, 1.2], ['wooden_crate_01', 30.5, 5.5, null, 1.2], ['wooden_crate_01', 6, 27, null, 2.1]];
  if (piece === 'spur') return [['wooden_crate_01', 43, 4.2, SPUR.top, 0.3], ['wooden_crate_01', 76.4, 1.4, SPUR.plain + SILL, 0.5], ['stone_fire_pit', 75, -0.2, SPUR.top + 0.19, 0]];
  if (piece === 'north') return [['stone_fire_pit', 42, 2.8, null, 0], ['wooden_crate_01', 22, 2.6, null, 0.3]];
  return [];
}
/** What stands in a piece off the shelf, as the world's own list of such things has them: crates and cases are searched, a fire pit can be lit. */
export function ruinProps(piece: Piece, p: Place, ground: GroundAt = assumed(piece, p)): { kind: string; x: number; y: number; z: number; rot: number; scale: number; far?: number }[] {
  return stood(piece).map(([kind, lx, lz, ly, rot]) => {
    const [x, y, z] = ruinAt(p, lx, lz, ly ?? 0);
    return { kind, x, y: ly === null ? ground(x, z) + (kind === 'stone_fire_pit' ? 0.19 : 0) : y, z, rot: p.rot + rot, scale: 1, far: kind === 'stone_fire_pit' ? 140 : 90 };
  });
}
/** Where a piece's fires are, as places in the world: what lights it at night, when somebody has lit them. */
export function ruinFires(piece: Piece, p: Place, ground: GroundAt = assumed(piece, p)): V3[] {
  return ruinProps(piece, p, ground).filter((q) => q.kind === 'stone_fire_pit').map((q) => [q.x, q.y, q.z]);
}

/**
 * Where the infected of a piece live. They have the open ground and the low places: the houses, the foot of the
 * north wall, the lower ward, the east court, the moat under the gate. They do not have the towers, the walks or
 * the church: those are for whoever holds the place and whoever comes to take it.
 */
export function ruinHomes(piece: Piece, p: Place): { x: number; z: number; r: number; n: number; inside?: V3[] }[] {
  const at = (x: number, z: number, r: number, n: number, pts?: V3[]) => ({ x: ruinAt(p, x, z)[0], z: ruinAt(p, x, z)[2], r, n, ...(pts ? { inside: pts.map(([a, b, c]) => ruinAt(p, a, c, b)) } : {}) });
  const A = ALCAZAR;
  if (piece === 'alcazar') return [at(24, -8, 12, 3), at(30, 10, 10, 3, [[22, A.middle, 12], [28, A.middle, 8], [42, A.middle, 14], [36, A.middle, 12]]), at(62, 24, 8, 2, [[58, A.middle, 22], [66, A.middle, 28], [60, A.middle, 36]])];
  if (piece === 'honeycomb') return [at(HONEYCOMB.w / 2, HONEYCOMB.d / 2, 18, 5)];
  if (piece === 'gate') return [at(6, 16, 9, 2)];
  if (piece === 'north') return [at(34, -6, 20, 3)];
  if (piece === 'curtain') return [at(40, -14, 16, 2)];
  if (piece === 'spur') return [at(48, -9, 14, 2)];
  return [];
}
