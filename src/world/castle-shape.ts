// The fort's pieces (src/sim/castle.ts) as shapes: the triangles each is drawn with, by what it is made of, from
// near and from far; and what of it stops a body and a shot. Plain numbers and nothing else: no drawing library
// and no physics, so that the same lines are checked by rule (test/castle.test.ts), drawn flat as a plan, and
// handed to the game (src/world/castle.ts).
//
// Everything is in the fort's own measure: x toward the gate, y above the terrace, z toward the steep side.
//
// How the pictures are laid on (their size is in TILE, metres to one turn of the picture). A course of stone runs
// level and is as tall as it is anywhere else: up a wall the picture goes by the height, up a leaning wall by the
// length of the lean, and along either by the metre. Round a tower it goes a whole number of times, so there is no
// seam; and since a tower is wider at its foot than at its head, the leaning part of it is done in bands a few
// courses tall, each with the number of turns that fits its own girth. A stone at the foot is the size of a stone
// at the top, to within a twelfth.

import { CASTLE, castleGround, castleParts, moundTop, rough, towerRadius, type Beam, type Body, type Box, type Curtain, type Flight, type Lump, type Mound, type Opening, type Paint, type Part, type Rail, type Slab, type Tower, type V3, type Wall } from '../sim/castle';

export type Quat = [number, number, number, number];
/** what a thing sounds like underfoot and when it is hit */
export type Surf = 'rock' | 'concrete' | 'wood' | 'metal';
/**
 * What stops a body: a block (its middle, half its size each way, how it is turned), a shape drawn tight round
 * some points, or ground given as heights on a grid (`heights[iz * (nx + 1) + ix]`). `feet`: it stops a body and
 * nothing else, as a stair and a rail do everywhere in the game.
 */
export type Solid =
  | { t: 'box'; c: V3; h: V3; q: Quat; feet: boolean; surface: Surf; name: string }
  | { t: 'hull'; pts: number[]; feet: boolean; surface: Surf; name: string }
  | { t: 'field'; x0: number; z0: number; nx: number; nz: number; cell: number; heights: Float32Array; surface: Surf; name: string };
/** triangles, three corners each: where, which way each faces, where on the picture, and how light (red, green, blue) */
export interface Skin { pos: number[]; nrm: number[]; uv: number[]; col: number[] }
export interface Shape { near: Record<Paint, Skin>; far: Skin; solids: Solid[] }

export const PAINTS: Paint[] = ['stone', 'ashlar', 'paving', 'timber', 'iron', 'rock', 'scree'];
/** metres to one turn of each picture */
export const TILE: Record<Paint, number> = { stone: 3.25, ashlar: 1.5, paving: 2.4, timber: 1.6, iron: 1, rock: 4.5, scree: 3 };
/** from far off it is all drawn with the stone's picture: what each other stuff is beside the stone, as a colour */
const FAR_TINT: Record<Paint, V3> = { stone: [1, 1, 1], ashlar: [1.05, 1.04, 1.02], paving: [0.82, 0.81, 0.78], timber: [0.36, 0.29, 0.22], iron: [0.14, 0.14, 0.14], rock: [0.74, 0.74, 0.75], scree: [0.9, 0.88, 0.84] };
const SURF: Record<Paint, Surf> = { stone: 'concrete', ashlar: 'concrete', paving: 'concrete', timber: 'wood', iron: 'metal', rock: 'rock', scree: 'rock' };

// ------------------------------------------------------------------ small sums

const UP: V3 = [0, 1, 0];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const rad = (deg: number) => (deg * Math.PI) / 180;
const norm360 = (a: number) => ((a % 360) + 360) % 360;
/** how far one direction is from another, degrees, 0..180 */
const apart = (a: number, b: number) => Math.abs(norm360(a - b + 180) - 180);
const hash = (i: number, j: number, s: number) => {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** numbers in order, with none twice */
const sorted = (xs: Iterable<number>, eps = 1e-4) => [...xs].sort((p, q) => p - q).filter((x, i, all) => i === 0 || x - all[i - 1] > eps);
/** what of the stretches `a` is in none of the stretches `b` */
const minus = (a: [number, number][], b: [number, number][]) => {
  const out: [number, number][] = [];
  for (const [lo, hi] of a) {
    let from = lo;
    for (const [p, q] of [...b].sort((m, n) => m[0] - n[0])) {
      if (q <= from || p >= hi) continue;
      if (p > from) out.push([from, p]);
      from = Math.max(from, q);
    }
    if (from < hi) out.push([from, hi]);
  }
  return out.filter(([p, q]) => q - p > 0.004);
};
/** How a thing is turned, from the three ways it lies (each of length one, square to one another, the third the first two's cross). */
export function quatOf(x: V3, y: V3, z: V3): Quat {
  const tr = x[0] + y[1] + z[2];
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4];
  }
  if (x[0] > y[1] && x[0] > z[2]) {
    const s = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2;
    return [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s];
  }
  if (y[1] > z[2]) {
    const s = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2;
    return [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s];
  }
  const s = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2;
  return [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s];
}
/** how much lighter the stone is toward the top of a wall: the foot of it is the weather side of a mountain */
const weather = (y: number) => 0.78 + 0.2 * Math.min(1, Math.max(0, 1 + y / 9));

type UV = [number, number];
/** Where triangles are put, for one stuff: it knows the size of that stuff's picture. */
class Out {
  constructor(private s: Skin, private tile: number, private tint: V3) {}
  private put(p: V3, n: V3, t: UV, tone: number) {
    this.s.pos.push(p[0], p[1], p[2]);
    this.s.nrm.push(n[0], n[1], n[2]);
    this.s.uv.push(t[0] / this.tile, t[1] / this.tile);
    this.s.col.push(this.tint[0] * tone, this.tint[1] * tone, this.tint[2] * tone);
  }
  /**
   * A triangle, turned to face `out` whichever way round its corners were said. `t`: where each corner is on the
   * picture, in metres. `smooth`: the way each corner faces, where the thing is round and not flat.
   */
  tri(p: V3[], t: UV[], out: V3, tone: number | number[] = 1, smooth?: V3[]) {
    let g = cross(sub(p[1], p[0]), sub(p[2], p[0]));
    const twice = len(g);
    // (a triangle with no size: where an arch comes down to its jamb, or two cuts fall together)
    if (twice < 1e-7) return;
    let order = [0, 1, 2];
    if (dot(g, out) < 0) {
      order = [0, 2, 1];
      g = mul(g, -1);
    }
    const n = mul(g, 1 / twice);
    for (const k of order) this.put(p[k], smooth ? smooth[k] : n, t[k], typeof tone === 'number' ? tone : tone[k]);
  }
  /** Four corners, in order round it. */
  quad(p: V3[], t: UV[], out: V3, tone: number | number[] = 1, smooth?: V3[]) {
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) this.tri([p[a], p[b], p[c]], [t[a], t[b], t[c]], out, typeof tone === 'number' ? tone : [tone[a], tone[b], tone[c]], smooth && [smooth[a], smooth[b], smooth[c]]);
  }
}
const skin = (): Skin => ({ pos: [], nrm: [], uv: [], col: [] });
/** where what is not seen is drawn */
const VOID = new Out(skin(), 1, [1, 1, 1]);
/** which way a picture of boards goes on a block: not at all (courses run level); along its length; across it */
type Grain = 0 | 1 | 2;

/** A block: its middle, the three ways it lies, half its size along each. */
function block(o: Out, c: V3, ax: V3[], h: V3, tone = 1, grain: Grain = 0) {
  if (o === VOID) return;
  const corner = (k: number[]): V3 => add(add(add(c, mul(ax[0], k[0] * h[0])), mul(ax[1], k[1] * h[1])), mul(ax[2], k[2] * h[2]));
  for (let f = 0; f < 3; f++) {
    let iu = (f + 1) % 3, iv = (f + 2) % 3;
    // (the picture's own up is the way that is nearer upright; of a board, the way the board runs)
    const turn = grain === 1 ? h[iu] > h[iv] : grain === 2 ? h[iu] < h[iv] : Math.abs(ax[iu][1]) > Math.abs(ax[iv][1]);
    if (turn) [iu, iv] = [iv, iu];
    for (const s of [-1, 1]) {
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
        const k = [0, 0, 0];
        k[f] = s;
        k[iu] = a;
        k[iv] = b;
        return corner(k);
      });
      o.quad(pts, pts.map((p): UV => [dot(p, ax[iu]), dot(p, ax[iv])]), mul(ax[f], s), tone);
    }
  }
}
const boxSolid = (c: V3, ax: V3[], h: V3, feet: boolean, surface: Surf, name: string): Solid => ({ t: 'box', c, h, q: quatOf(ax[0], ax[1], ax[2]), feet, surface, name });
/** the three ways a timber lies that runs from `a` to `b`: its depth, its width, its length */
function along(a: V3, b: V3): V3[] {
  const t = unit(sub(b, a)), side: V3 = Math.abs(t[1]) > 0.99 ? [1, 0, 0] : unit(cross(t, UP));
  return [cross(side, t), side, t];
}
function timber(o: Out, a: V3, b: V3, w: number, h: number, tone = 1) {
  block(o, mul(add(a, b), 0.5), along(a, b), [h / 2, w / 2, len(sub(b, a)) / 2], tone, 1);
}

// ------------------------------------------------------------------ the pieces

type Put = (s: Solid) => void;

function boxPart(p: Box, o: Out, put: Put) {
  const c = Math.cos(p.yaw ?? 0), s = Math.sin(p.yaw ?? 0), ax: V3[] = [[c, 0, -s], UP, [s, 0, c]];
  const mid: V3 = [(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, (p.z0 + p.z1) / 2], h: V3 = [(p.x1 - p.x0) / 2, (p.y1 - p.y0) / 2, (p.z1 - p.z0) / 2];
  block(o, mid, ax, h, p.tone, p.paint === 'timber' ? 1 : 0);
  put(boxSolid(mid, ax, h, p.body === 'feet', SURF[p.paint], p.name ?? 'block'));
}

function slabPart(p: Slab, o: Out, put: Put) {
  const [a, b, , d] = p.p;
  let n = unit(cross(sub(b, a), sub(d, a)));
  if (n[1] < 0) n = mul(n, -1);
  const x = unit(sub(b, a)), ax = [x, n, cross(x, n)];
  const mid = mul(add(add(p.p[0], p.p[1]), add(p.p[2], p.p[3])), 0.25), h: V3 = [len(sub(b, a)) / 2, p.thick / 2, len(sub(d, a)) / 2];
  const c = sub(mid, mul(n, p.thick / 2));
  // (boards lie across the way that is walked)
  block(o, c, ax, h, p.tone, p.paint === 'timber' ? 2 : 0);
  put(boxSolid(c, ax, h, p.body === 'feet', SURF[p.paint], p.name ?? 'slab'));
}

function beamPart(p: Beam, o: Out, put: Put) {
  timber(o, p.a, p.b, p.w, p.h, p.tone);
  put(boxSolid(mul(add(p.a, p.b), 0.5), along(p.a, p.b), [p.h / 2, p.w / 2, len(sub(p.b, p.a)) / 2], p.body === 'feet', SURF[p.paint], p.name ?? 'timber'));
}

/** how high a rail's top bar is over what it stands on, and how much higher than its line what stops a body goes */
const RAIL = { top: 0.93, mid: 0.5, over: 1.05 };
/** posts and two bars from `a` to `b`; what stops a body stands straight up from the line of it, whatever the slope */
function railRun(o: Out, put: Put, a: V3, b: V3, tone = 1, name = 'rail', under = 0) {
  const flat = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (flat < 0.05) return;
  const lift = (p: V3, y: number): V3 => [p[0], p[1] + y, p[2]];
  timber(o, lift(a, RAIL.top), lift(b, RAIL.top), 0.05, 0.07, tone);
  timber(o, lift(a, RAIL.mid), lift(b, RAIL.mid), 0.035, 0.05, tone);
  const posts = Math.max(1, Math.round(flat / 1.1)), dir: V3 = [(b[0] - a[0]) / flat, 0, (b[2] - a[2]) / flat], ax = [dir, UP, cross(dir, UP)];
  for (let k = 0; k <= posts; k++) {
    const p = add(a, mul(sub(b, a), k / posts));
    block(o, lift(p, RAIL.top / 2), ax, [0.03, RAIL.top / 2, 0.03], tone, 1);
  }
  const lo = Math.min(a[1], b[1]) - under, tall = Math.abs(b[1] - a[1]) + RAIL.over + under;
  put(boxSolid([(a[0] + b[0]) / 2, lo + tall / 2, (a[2] + b[2]) / 2], ax, [flat / 2, tall / 2, 0.03], true, 'wood', name));
}

/** how thick the slope is that is walked on under a flight of steps: it lies along the fronts of the treads */
const SLOPE_HALF = 0.04;
/**
 * A flight: boards to look at, and one slope to walk on, laid from a tread before the first to a tread short of
 * the last, with the last tread level after it. (As every stair in the game is: see `flight` in buildings.ts. A
 * body goes up a bank and catches on steps.)
 */
function flightPart(p: Flight, o: Out, put: Put) {
  const dx = p.head[0] - p.foot[0], dz = p.head[2] - p.foot[2], L = Math.hypot(dx, dz), up = p.head[1] - p.foot[1];
  const f: V3 = [dx / L, 0, dz / L], r: V3 = [f[2], 0, -f[0]], n = Math.max(1, Math.round(up / 0.2)), rise = up / n, run = L / n, hw = p.w / 2;
  const P = (s: number, y: number, lat = 0): V3 => [p.foot[0] + f[0] * s + r[0] * lat, p.foot[1] + y, p.foot[2] + f[2] * s + r[2] * lat];
  const ax = [r, UP, f];
  for (let i = 0; i < n; i++) {
    // (of stone, each step is a block down to the floor; of boards, a tread on two strings)
    if (p.paint !== 'timber') block(o, P((i + 0.5) * run, ((i + 1) * rise) / 2), ax, [hw, ((i + 1) * rise) / 2, run / 2], p.tone);
    else block(o, P((i + 0.5) * run, (i + 1) * rise - 0.0225), ax, [hw, 0.0225, run / 2 + (i === n - 1 ? 0 : 0.015)], p.tone, 1);
  }
  if (p.paint === 'timber') for (const side of [-1, 1]) timber(o, P(0, rise / 2 - 0.12, side * (hw - 0.04)), P(L, up - rise / 2 - 0.12, side * (hw - 0.04)), 0.05, 0.2, (p.tone ?? 1) * 0.9);
  const z = unit(add(mul(f, L), mul(UP, up))), y = cross(z, r), from = P(-run, 0), to = P(L - run, up);
  put(boxSolid(sub(mul(add(from, to), 0.5), mul(y, SLOPE_HALF)), [r, y, z], [hw, SLOPE_HALF, Math.hypot(L, up) / 2], true, SURF[p.paint], p.name ?? 'stair'));
  put(boxSolid(P(L - run / 2, up - SLOPE_HALF), ax, [hw, SLOPE_HALF, run / 2 + 0.03], true, SURF[p.paint], p.name ?? 'stair'));
}

/** how tall a course of the stone is: a broken top steps down by so much */
const COURSE = 0.17;
/** how high an opening's head is at a place across it: level, or an arch that springs from its jambs. `t`: -1 at one jamb, 1 at the other */
const headAt = (y0: number, y1: number, halfWidth: number, arch: boolean | undefined, t: number) => {
  if (!arch) return y1;
  const rise = Math.min(halfWidth, (y1 - y0) * 0.5), k = Math.min(1, Math.abs(t));
  return y1 - rise * (1 - Math.sqrt(1 - k * k));
};
/** as far up as a body is let through an arched opening: it is cut square, half way up the arch */
const squareHead = (o: { y0: number; y1: number; arch?: boolean }, halfWidth: number) => (o.arch ? o.y1 - Math.min(halfWidth, (o.y1 - o.y0) * 0.5) / 2 : o.y1);

function wallPart(w: Wall, o: Out, put: Put, lod: number) {
  const [ax, az] = w.a, L = Math.hypot(w.b[0] - ax, w.b[1] - az), d: V3 = [(w.b[0] - ax) / L, 0, (w.b[1] - az) / L], out: V3 = [d[2], 0, -d[0]], half = w.thick / 2;
  const tops = typeof w.top === 'number' ? [w.top] : w.top, broken = tops.length > 1 && !lod, tone = w.tone ?? 1, ops = w.openings ?? [];
  const topAt = (u: number) => tops[Math.min(tops.length - 1, Math.floor((u / L) * tops.length))];
  const at = (u: number, y: number, s: number): V3 => [ax + d[0] * u + out[0] * s * half, y, az + d[2] * u + out[2] * s * half];
  // (the picture goes along it by where it stands: two lengths of one wall carry on from each other)
  const base = ax * d[0] + az * d[2], seed = Math.round(ax * 31 + az * 17 + L * 7);
  const opAt = (u: number) => ops.find((p) => u > p.u0 && u < p.u1);
  const head = (p: Opening, u: number) => headAt(p.y0, p.y1, (p.u1 - p.u0) / 2, p.arch, (u - (p.u0 + p.u1) / 2) / ((p.u1 - p.u0) / 2));

  // ---- what is seen. It is cut along its length wherever its top or an opening changes, and a broken top is cut
  // again between: no two stones of a ruin's top are at one height.
  const cuts = new Set<number>([0, L]);
  for (let k = 1; k < tops.length; k++) cuts.add((k * L) / tops.length);
  for (const p of ops) for (let k = 0, n = p.arch && !lod ? 6 : 1; k <= n; k++) cuts.add(p.u0 + ((p.u1 - p.u0) * k) / n);
  if (broken) for (let k = 1, n = Math.round(L / 0.42); k < n; k++) cuts.add((k * L) / n);
  const us = sorted([...cuts].filter((u) => u >= 0 && u <= L), 0.03);
  us[us.length - 1] = L;
  /** what stands in each length: [its foot at the near end, its foot at the far end, its top] for each piece, lowest first */
  const cols = us.slice(0, -1).map((u0, i) => {
    const u1 = us[i + 1], mid = (u0 + u1) / 2, p = opAt(mid);
    // (a broken top comes down from one height to the next a course at a time, where the two are not far apart: a
    // wall falls in slopes, and stands in steps only where a length of it has gone altogether)
    let top = topAt(mid);
    if (broken) {
      const g = (mid / L) * tops.length - 0.5, k = Math.max(0, Math.min(tops.length - 2, Math.floor(g))), t = Math.min(1, Math.max(0, g - k));
      if (Math.abs(tops[k + 1] - tops[k]) < 0.8) top = tops[k] + (tops[k + 1] - tops[k]) * t;
      top = Math.round((top - hash(i, seed, 3) * 0.2) / COURSE) * COURSE;
    }
    const spans: [number, number, number][] = [];
    if (!p) spans.push([w.y0, w.y0, top]);
    else {
      if (p.y0 > w.y0 + 0.01) spans.push([w.y0, w.y0, Math.min(p.y0, top)]);
      const h0 = head(p, u0), h1 = head(p, u1);
      if (top > Math.max(h0, h1) + 0.02) spans.push([h0, h1, top]);
    }
    return { u0, u1, spans };
  });
  for (const c of cols) {
    for (const [b0, b1, t] of c.spans) {
      for (const s of [1, -1]) {
        const pts = [at(c.u0, b0, s), at(c.u1, b1, s), at(c.u1, t, s), at(c.u0, t, s)];
        o.quad(pts, [[base + c.u0, b0], [base + c.u1, b1], [base + c.u1, t], [base + c.u0, t]], mul(out, s), tone);
      }
      // its top (a sill, where it is under an opening), and its underside where it is over one
      const face = (y0: number, y1: number, n: V3, k: number) => o.quad([at(c.u0, y0, -1), at(c.u1, y1, -1), at(c.u1, y1, 1), at(c.u0, y0, 1)], [[base + c.u0, -half], [base + c.u1, -half], [base + c.u1, half], [base + c.u0, half]], n, tone * k);
      face(t, t, UP, 0.94);
      if (b0 > w.y0 + 0.005 || b1 > w.y0 + 0.005) face(b0, b1, [0, -1, 0], 0.8);
    }
  }
  // the ends of it, the jambs of its openings, and the steps of a broken top: wherever stone stands beside none
  for (let i = 0; i <= cols.length; i++) {
    const left = i > 0 ? cols[i - 1].spans.map(([, b, t]): [number, number] => [b, t]) : [], right = i < cols.length ? cols[i].spans.map(([b, , t]): [number, number] => [b, t]) : [];
    const u = i < cols.length ? cols[i].u0 : L;
    for (const [side, list] of [[1, minus(left, right)], [-1, minus(right, left)]] as [number, [number, number][]][]) {
      for (const [lo, hi] of list) o.quad([at(u, lo, -1), at(u, lo, 1), at(u, hi, 1), at(u, hi, -1)], [[-half, lo], [half, lo], [half, hi], [-half, hi]], mul(d, side), tone * 0.9);
    }
  }

  // ---- what stops a body: a block for each length between its openings and the steps of its top
  const hard = new Set<number>([0, L]);
  for (let k = 1; k < tops.length; k++) if (Math.abs(tops[k] - tops[k - 1]) > 0.25) hard.add((k * L) / tops.length);
  for (const p of ops) hard.add(p.u0).add(p.u1);
  const hs = sorted(hard, 0.01);
  for (let i = 0; i + 1 < hs.length; i++) {
    const u0 = hs[i], u1 = hs[i + 1], mid = (u0 + u1) / 2, p = opAt(mid);
    // (over a length whose top is all at about one height: the highest of it)
    let top = -Infinity;
    for (let k = 0; k < tops.length; k++) if (((k + 1) * L) / tops.length > u0 + 0.01 && (k * L) / tops.length < u1 - 0.01) top = Math.max(top, tops[k]);
    const spans: [number, number][] = p ? [[w.y0, p.y0], [squareHead(p, (p.u1 - p.u0) / 2), top]] : [[w.y0, top]];
    for (const [lo, hi] of spans) if (hi - lo > 0.05) put(boxSolid(at(mid, (lo + hi) / 2, 0), [d, UP, cross(d, UP)], [(u1 - u0) / 2, (hi - lo) / 2, half], false, SURF[w.paint], w.name ?? 'wall'));
  }
}

/** the square holes left in a wall by the poles it was built from: a dark square a finger proud of the stone */
function putlog(o: Out, at: V3, across: V3, upIt: V3, n: V3) {
  const c = add(at, mul(n, 0.012)), k = 0.065;
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => add(c, add(mul(across, a * k), mul(upIt, b * k))));
  o.quad(pts, pts.map((): UV => [0.5, 0.5]), n, 0.07);
}

function curtainPart(c: Curtain, o: Out, put: Put, lod: number) {
  const [ax, az] = c.a, L = Math.hypot(c.b[0] - ax, c.b[1] - az), d: V3 = [(c.b[0] - ax) / L, 0, (c.b[1] - az) / L], out: V3 = [d[2], 0, -d[0]];
  const k = Math.hypot(1, 1 / c.lean), n = unit([out[0], 1 / c.lean, out[2]]), tone = c.tone ?? 1;
  const at = (u: number, y: number): V3 => [ax + d[0] * u - (out[0] * y) / c.lean, y, az + d[2] * u - (out[2] * y) / c.lean];
  const base = ax * d[0] + az * d[2], rows = lod ? 1 : Math.ceil(-c.y0 / 2.6), cols = lod ? 1 : Math.ceil(L / 3.3);
  for (let i = 0; i < rows; i++) {
    const y0 = (c.y0 * (i + 1)) / rows, y1 = (c.y0 * i) / rows;
    for (let j = 0; j < cols; j++) {
      const u0 = (L * j) / cols, u1 = (L * (j + 1)) / cols;
      o.quad([at(u0, y0), at(u1, y0), at(u1, y1), at(u0, y1)], [[base + u0, y0 * k], [base + u1, y0 * k], [base + u1, y1 * k], [base + u0, y1 * k]], n, [weather(y0), weather(y0), weather(y1), weather(y1)].map((t) => t * tone));
    }
  }
  const upIt = unit(sub(at(0, 1), at(0, 0)));
  if (!lod) for (let y = -1.3, r = 0; y > c.y0 + 1; y -= 1.75, r++) for (let u = 1.2 + (r % 2) * 1.2; u < L - 0.8; u += 2.4) putlog(o, at(u, y), d, upIt, n);
  // (what stops a body is a slab behind the face: nobody is ever behind it)
  put(boxSolid(sub(at(L / 2, c.y0 / 2), mul(n, 0.3)), [d, upIt, cross(d, upIt)], [L / 2, (-c.y0 * k) / 2, 0.3], false, 'concrete', c.name ?? 'curtain'));
}

function moundPart(m: Mound, o: Out, put: Put, lod: number, ground: (x: number, z: number) => number) {
  const nx = Math.round((m.x1 - m.x0) / m.cell), nz = Math.round((m.z1 - m.z0) / m.cell), W = nx + 1, step = lod ? 3 : 1;
  const H = new Float32Array(W * (nz + 1));
  for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) H[iz * W + ix] = moundTop(m.kind, m.x0 + ix * m.cell, m.z0 + iz * m.cell);
  const P = (ix: number, iz: number): V3 => [m.x0 + ix * m.cell, H[iz * W + ix], m.z0 + iz * m.cell];
  const N = (ix: number, iz: number): V3 => {
    const x0 = Math.max(0, ix - 1), x1 = Math.min(nx, ix + 1), z0 = Math.max(0, iz - 1), z1 = Math.min(nz, iz + 1);
    return unit([-(H[iz * W + x1] - H[iz * W + x0]) / ((x1 - x0) * m.cell), 1, -(H[z1 * W + ix] - H[z0 * W + ix]) / ((z1 - z0) * m.cell)]);
  };
  const tone = (p: V3) => (m.tone ?? 1) * (0.84 + 0.32 * rough(p[0] * 0.35, p[2] * 0.35, 3));
  for (let iz = 0; iz + step <= nz; iz += step) {
    for (let ix = 0; ix + step <= nx; ix += step) {
      const q: [number, number][] = [[ix, iz], [ix + step, iz], [ix, iz + step], [ix + step, iz + step]], c = q.map(([i, j]) => P(i, j));
      // (nothing of it is drawn where the hill has it covered)
      if (Math.max(...c.map((p) => p[1] - ground(p[0], p[2]))) < -0.4) continue;
      // (cut the way the ground itself is cut, corner to corner: what is stood on is what is seen)
      for (const [a, b, e] of [[0, 2, 1], [1, 2, 3]]) {
        const g = cross(sub(c[b], c[a]), sub(c[e], c[a]));
        // (the picture is laid on from whichever side sees the face most squarely: it does not run down a cliff in streaks)
        const flat = Math.abs(g[1]) > 0.72 * len(g), east = Math.abs(g[0]) > Math.abs(g[2]);
        const uv = (p: V3): UV => (flat ? [p[0], p[2]] : east ? [p[2], p[1]] : [p[0], p[1]]);
        o.tri([c[a], c[b], c[e]], [uv(c[a]), uv(c[b]), uv(c[e])], UP, [tone(c[a]), tone(c[b]), tone(c[e])], [N(...q[a]), N(...q[b]), N(...q[e])]);
      }
    }
  }
  put({ t: 'field', x0: m.x0, z0: m.z0, nx, nz, cell: m.cell, heights: H, surface: 'rock', name: m.name ?? 'mound' });
}

function lumpPart(l: Lump, o: Out, put: Put, lod: number) {
  const tone = l.tone ?? 1, yaw = hash(l.seed, 1, 77) * Math.PI, cy = Math.cos(yaw), sy = Math.sin(yaw), ax: V3[] = [[cy, 0, -sy], UP, [sy, 0, cy]];
  if (l.blocky || lod) block(o, [l.x, l.y, l.z], ax, [l.rx, l.ry, l.rz], tone * (0.9 + 0.2 * hash(l.seed, 2, 77)));
  else {
    // a rock: a ball of a few flat faces, each corner pushed in or out by its own amount
    const A = 7, B = 4, pt = (i: number, j: number): V3 => {
      const lat = -Math.PI / 2 + (Math.PI * j) / B, lon = (2 * Math.PI * (i % A)) / A, k = j === 0 || j === B ? 0.8 : 0.62 + 0.62 * hash(i % A, j, l.seed);
      return [l.x + Math.cos(lat) * Math.cos(lon) * l.rx * k, l.y + Math.sin(lat) * l.ry * (j === B ? 0.75 + 0.4 * hash(9, 9, l.seed) : 1), l.z + Math.cos(lat) * Math.sin(lon) * l.rz * k];
    };
    for (let j = 0; j < B; j++) for (let i = 0; i < A; i++) {
      const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
      for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
        const p = [q[a], q[b], q[c]], g = cross(sub(p[1], p[0]), sub(p[2], p[0])), away = sub(mul(add(add(p[0], p[1]), p[2]), 1 / 3), [l.x, l.y, l.z]);
        const flat = Math.abs(g[1]) > 0.72 * len(g), east = Math.abs(g[0]) > Math.abs(g[2]);
        o.tri(p, p.map((v): UV => (flat ? [v[0], v[2]] : east ? [v[2], v[1]] : [v[0], v[1]])), away, tone * (0.82 + 0.3 * hash(i, j, l.seed + 5)));
      }
    }
  }
  const k = l.blocky ? 1 : 0.78;
  put(boxSolid([l.x, l.y, l.z], l.blocky ? ax : [[1, 0, 0], UP, [0, 0, 1]], [l.rx * k, l.ry * (l.blocky ? 1 : 0.9), l.rz * k], false, 'rock', l.name ?? 'rock'));
}

/** the boards a tower's floor is laid with stand this far over the paving (they lie on it, and are heard underfoot) */
export const TOWER_FLOOR = 0.06;

function towerPart(tw: Tower, stone: Out, wood: Out, put: Put, lod: number) {
  const T = CASTLE.tower, n = lod ? 20 : 48, rin = T.r - T.wall, tone = tw.tone ?? 1, tile = TILE.stone, seed = Math.round(tw.cx * 7 + tw.cz * 13);
  const P = (a: number, r: number, y: number): V3 => [tw.cx + Math.cos(rad(a)) * r, y, tw.cz + Math.sin(rad(a)) * r];
  const out = (a: number): V3 => [Math.cos(rad(a)), 0, Math.sin(rad(a))], round = (a: number): V3 => [-Math.sin(rad(a)), 0, Math.cos(rad(a))];
  const levels = (from: number, to: number, step: number) => {
    const k = Math.max(1, Math.ceil((from - to) / step));
    return Array.from({ length: k + 1 }, (_, i) => from + ((to - from) * i) / k);
  };

  // ---- under the terrace: a cone in bands, each with as many turns of the picture as fit its girth
  const ys = [...levels(0, T.bend, lod ? 99 : 2.5), ...levels(T.bend, tw.foot, lod ? 99 : 3.3).slice(1)];
  let s0 = 0;
  for (let i = 0; i + 1 < ys.length; i++) {
    const y0 = ys[i], y1 = ys[i + 1], r0 = towerRadius(y0), r1 = towerRadius(y1), lean = (r1 - r0) / (y0 - y1), s1 = s0 - Math.hypot(y0 - y1, r1 - r0);
    const turns = Math.max(1, Math.round((Math.PI * (r0 + r1)) / tile)), face = (a: number) => unit([Math.cos(rad(a)), lean, Math.sin(rad(a))]);
    for (let j = 0; j < n; j++) {
      const a0 = (j * 360) / n, a1 = ((j + 1) * 360) / n, u0 = (a0 / 360) * turns * tile, u1 = (a1 / 360) * turns * tile;
      stone.quad([P(a0, r1, y1), P(a1, r1, y1), P(a1, r0, y0), P(a0, r0, y0)], [[u0, s1], [u1, s1], [u1, s0], [u0, s0]], out((a0 + a1) / 2), [weather(y1), weather(y1), weather(y0), weather(y0)].map((t) => t * tone), [face(a0), face(a1), face(a1), face(a0)]);
    }
    s0 = s1;
  }
  if (!lod) for (let y = -1.3, r = 0; y > tw.foot + 1; y -= 1.75, r++) for (let a = (r % 2) * 15; a < 360; a += 30) {
    const k = y > T.bend ? 1 / T.lean : 1 / T.flare;
    putlog(stone, P(a, towerRadius(y), y), round(a), unit([-k * Math.cos(rad(a)), 1, -k * Math.sin(rad(a))]), unit([Math.cos(rad(a)), k, Math.sin(rad(a))]));
  }

  // ---- over it: a drum, open to the sky, with a door to the terrace and windows; its top is what is left of a battlement
  type Hole = { a: number; w: number; y0: number; y1: number; arch: boolean };
  const holes: Hole[] = lod ? [] : [{ a: tw.door, w: TOWER_DOOR.w, y0: 0, y1: TOWER_DOOR.h, arch: true }, ...tw.slits.map((s) => ({ a: s.a, w: SLIT_WIDE, y0: s.y0, y1: s.y1, arch: true }))];
  /** how far either side of its middle an opening reaches, at so far from the tower's own: its sides are square to the wall, not drawn to the tower's middle */
  const halfAt = (h: Hole, r: number) => (Math.asin(h.w / 2 / r) * 180) / Math.PI;
  const rimAt = (a: number) => {
    const k = Math.floor(norm360(a) / (360 / T.slots)) % T.slots;
    // (no two stones of a broken top are at one height: each half of a stub is a little under what the plan says)
    return tw.rim[k] - (!lod && k % 2 === 0 ? 0.24 * hash(Math.floor(norm360(a) / 7.5), seed, 5) : 0);
  };
  const columns = (r: number) => {
    const cuts = new Set<number>();
    for (let j = 0; j < n; j++) cuts.add((j * 360) / n);
    for (const h of holes) for (let k = 0; k <= 6; k++) cuts.add(norm360(h.a - halfAt(h, r) + (2 * halfAt(h, r) * k) / 6));
    const as = sorted(cuts, 0.05);
    return as.map((a0, i) => ({ a0, a1: i + 1 < as.length ? as[i + 1] : as[0] + 360 }));
  };
  for (const [r, s] of [[T.r, 1], [rin, -1]] as [number, number][]) {
    const turns = Math.max(1, Math.round((2 * Math.PI * r) / tile)), u = (a: number) => (a / 360) * turns * tile;
    for (const { a0, a1 } of columns(r)) {
      const mid = (a0 + a1) / 2, top = rimAt(mid), h = holes.find((q) => apart(mid, q.a) < halfAt(q, r));
      const spans: [number, number][] = [];
      if (!h) spans.push([0, 0]);
      else {
        const head = (a: number) => headAt(h.y0, h.y1, h.w / 2, h.arch, (norm360(a - h.a + 180) - 180) / halfAt(h, r));
        if (h.y0 > 0.01) stone.quad([P(a0, r, 0), P(a1, r, 0), P(a1, r, h.y0), P(a0, r, h.y0)], [[u(a0), 0], [u(a1), 0], [u(a1), h.y0], [u(a0), h.y0]], mul(out(mid), s), tone * (s > 0 ? 1 : 0.86), [a0, a1, a1, a0].map((a) => mul(out(a), s)));
        if (top > h.y1 + 0.02) spans.push([head(a0), head(a1)]);
      }
      for (const [b0, b1] of spans) stone.quad([P(a0, r, b0), P(a1, r, b1), P(a1, r, top), P(a0, r, top)], [[u(a0), b0], [u(a1), b1], [u(a1), top], [u(a0), top]], mul(out(mid), s), tone * (s > 0 ? 1 : 0.86), [a0, a1, a1, a0].map((a) => mul(out(a), s)));
    }
  }
  // the top of the wall, and the faces of its stubs
  for (let j = 0; j < n; j++) {
    const a0 = (j * 360) / n, a1 = ((j + 1) * 360) / n, top = rimAt((a0 + a1) / 2), next = rimAt(a1 + 180 / n);
    const pts = [P(a0, rin, top), P(a1, rin, top), P(a1, T.r, top), P(a0, T.r, top)];
    stone.quad(pts, pts.map((p): UV => [p[0], p[2]]), UP, tone * 0.94);
    if (Math.abs(next - top) > 0.01) stone.quad([P(a1, rin, Math.min(top, next)), P(a1, T.r, Math.min(top, next)), P(a1, T.r, Math.max(top, next)), P(a1, rin, Math.max(top, next))], [[rin, Math.min(top, next)], [T.r, Math.min(top, next)], [T.r, Math.max(top, next)], [rin, Math.max(top, next)]], mul(round(a1), next < top ? 1 : -1), tone * 0.9);
  }
  if (!lod) for (const h of holes) {
    // the sides of each opening, its sill and its head, through the thickness of the wall
    const ho = halfAt(h, T.r), hi = halfAt(h, rin), rise = h.y1 - headAt(h.y0, h.y1, h.w / 2, h.arch, 1);
    for (const side of [-1, 1]) stone.quad([P(h.a + side * ho, T.r, h.y0), P(h.a + side * hi, rin, h.y0), P(h.a + side * hi, rin, h.y1 - rise), P(h.a + side * ho, T.r, h.y1 - rise)], [[0, h.y0], [T.wall, h.y0], [T.wall, h.y1 - rise], [0, h.y1 - rise]], mul(round(h.a), -side), tone * 0.84);
    for (let k = 0; k < 6; k++) {
      const t0 = -1 + k / 3, t1 = -1 + (k + 1) / 3, h0 = headAt(h.y0, h.y1, h.w / 2, h.arch, t0), h1 = headAt(h.y0, h.y1, h.w / 2, h.arch, t1);
      stone.quad([P(h.a + t0 * ho, T.r, h0), P(h.a + t1 * ho, T.r, h1), P(h.a + t1 * hi, rin, h1), P(h.a + t0 * hi, rin, h0)], [[t0 * 0.4, 0], [t1 * 0.4, 0], [t1 * 0.4, T.wall], [t0 * 0.4, T.wall]], [0, -1, 0], tone * 0.78);
    }
    if (h.y0 > 0.01) stone.quad([P(h.a - ho, T.r, h.y0), P(h.a + ho, T.r, h.y0), P(h.a + hi, rin, h.y0), P(h.a - hi, rin, h.y0)], [[-0.4, 0], [0.4, 0], [0.4, T.wall], [-0.4, T.wall]], UP, tone * 0.9);
  }
  if (lod) return;
  for (let y = 0.95, r = 0; y < 6; y += 1.75, r++) for (let a = (r % 2) * 15 + 7.5; a < 360; a += 30) if (y < rimAt(a) - 0.4 && !holes.some((h) => apart(a, h.a) < halfAt(h, T.r) + 4 && y > h.y0 - 0.4 && y < h.y1 + 0.4)) putlog(stone, P(a, T.r, y), round(a), UP, out(a));

  // ---- what stops a body. Under the terrace, the cone itself (it bulges nowhere, so a shape drawn tight round
  // three rings of it is the cone); over it, the wall in lengths, left out where its openings are.
  const hull: number[] = [];
  for (const y of [0, T.bend, tw.foot]) for (let k = 0; k < 16; k++) hull.push(...P(k * 22.5, towerRadius(y) / Math.cos(rad(11.25)), y));
  put({ t: 'hull', pts: hull, feet: false, surface: 'concrete', name: tw.name ?? 'tower' });
  const rm = (T.r + rin) / 2, hard = new Set<number>();
  for (let k = 0; k < T.slots; k++) hard.add((k * 360) / T.slots);
  for (const h of holes) hard.add(norm360(h.a - halfAt(h, rm))).add(norm360(h.a + halfAt(h, rm)));
  const hs = sorted(hard, 0.5);
  hs.forEach((a0, i) => {
    const a1 = i + 1 < hs.length ? hs[i + 1] : hs[0] + 360, mid = (a0 + a1) / 2, h = holes.find((q) => apart(mid, q.a) < halfAt(q, rm));
    const top = tw.rim[Math.floor(norm360(mid) / (360 / T.slots)) % T.slots];
    for (const [lo, hi] of h ? [[0, h.y0], [squareHead(h, h.w / 2), top]] : [[0, top]]) {
      if (hi - lo > 0.05) put(boxSolid(P(mid, rm, (lo + hi) / 2), [out(mid), UP, cross(out(mid), UP)], [T.wall / 2, (hi - lo) / 2, T.r * Math.tan(rad((a1 - a0) / 2)) + 0.01], false, 'concrete', tw.name ?? 'tower'));
    }
  });

  // ---- its floor: boards laid on the paving, with a riser where the door comes in
  const ring = (y: number, r0: number, r1: number, a0: number, a1: number, face: V3, k = 1) => {
    const pts = r0 > 0 ? [P(a0, r0, y), P(a1, r0, y), P(a1, r1, y), P(a0, r1, y)] : [P(0, 0, y), P(a1, r1, y), P(a0, r1, y)];
    // (boards across the way that is walked: the picture's own boards run up it)
    const uv = pts.map((p): UV => [p[0], p[2]]);
    if (r0 > 0) wood.quad(pts, uv, face, tone * k);
    else wood.tri(pts, uv, face, tone * k);
  };
  const disc = (name: string, y0: number, y1: number, r: number) => {
    const pts: number[] = [];
    for (const y of [y0, y1]) for (let k = 0; k < 16; k++) pts.push(...P(k * 22.5, r / Math.cos(rad(11.25)), y));
    put({ t: 'hull', pts, feet: false, surface: 'wood', name });
  };
  for (let j = 0; j < 24; j++) ring(TOWER_FLOOR, 0, rin, j * 15, (j + 1) * 15, UP);
  {
    const half = halfAt(holes[0], rin) + 2;
    wood.quad([P(tw.door - half, rin, 0), P(tw.door + half, rin, 0), P(tw.door + half, rin, TOWER_FLOOR), P(tw.door - half, rin, TOWER_FLOOR)], [[0, 0], [1, 0], [1, TOWER_FLOOR], [0, TOWER_FLOOR]], out(tw.door), tone * 0.8);
  }
  disc('tower floor', -0.2, TOWER_FLOOR, rin);

  // ---- the stair round the inside of the wall, and the rail on its open side
  const S = tw.stair, sg = Math.sign(S.sweep), N = Math.round(T.deck / 0.2), da = S.sweep / N, rise = T.deck / N, ri = T.stairIn, ro = rin - 0.02, mid = (ri + ro) / 2;
  for (let i = 0; i < N; i++) {
    const a0 = S.from + da * i, a1 = a0 + da, y = (i + 1) * rise, lap = sg * 0.6;
    // (each tread laps the one under it; its boards lie across the way up)
    const top = [P(a0 - lap, ri, y), P(a1, ri, y), P(a1, ro, y), P(a0 - lap, ro, y)], am = (a0 + a1) / 2, uv = top.map((p): UV => [dot(p, round(am)), dot(p, out(am))]);
    wood.quad(top, uv, UP, tone);
    wood.quad(top.map((p): V3 => [p[0], p[1] - 0.05, p[2]]), uv, [0, -1, 0], tone * 0.8);
    for (const [a, face] of [[a0 - lap, -sg], [a1, sg]] as [number, number][]) wood.quad([P(a, ri, y - 0.05), P(a, ro, y - 0.05), P(a, ro, y), P(a, ri, y)], [[ri, 0], [ro, 0], [ro, 0.05], [ri, 0.05]], mul(round(a), face), tone * 0.85);
    wood.quad([P(a0 - lap, ri, y - 0.05), P(a1, ri, y - 0.05), P(a1, ri, y), P(a0 - lap, ri, y)], [[0, 0], [0.4, 0], [0.4, 0.05], [0, 0.05]], mul(out((a0 + a1) / 2), -1), tone * 0.85);
    // the string under its open edge
    timber(wood, P(a0, ri + 0.05, y - rise - 0.15), P(a1, ri + 0.05, y - 0.15), 0.06, 0.2, tone * 0.9);
  }
  // (the rail goes up with it as far as the platform lets it; from there the platform's own rail stands over the stair)
  const posts: V3[] = [];
  for (let i = 0; i < N && (i + 1) * rise + RAIL.top < T.deck - 0.12; i += 2) posts.push(P(S.from + da * (i + 0.5), ri + 0.04, (i + 1) * rise));
  for (let i = 0; i + 1 < posts.length; i++) railRun(wood, put, posts[i], posts[i + 1], tone, 'tower stair rail');
  // what is walked on: the slope under the treads, in short lengths round the wall, from a tread before the first
  // to a tread short of the last (a round stair is a twisted slope: each length of it is flat, and near enough)
  for (let j = 0; j < 2 * N; j++) {
    const am = S.from - da + (da / 2) * (j + 0.5), y = (T.deck * (j + 0.5)) / (2 * N), tilt = Math.atan(rise / 2 / (mid * rad(Math.abs(da) / 2)));
    const z = unit(add(mul(round(am), sg * Math.cos(tilt)), mul(UP, Math.sin(tilt)))), x = mul(out(am), sg), yy = cross(z, x);
    put(boxSolid(sub(P(am, mid, y), mul(yy, SLOPE_HALF)), [x, yy, z], [(rin - ri) / 2, SLOPE_HALF, rin * Math.tan(rad(Math.abs(da) / 4)) + 0.03], true, 'wood', 'tower stair'));
  }

  // ---- the platform under the rim: all of the round but the well the stair comes up in
  const D = T.deck, well0 = tw.well[0], wide = Math.abs(tw.well[1] - tw.well[0]), inWell = (a: number) => norm360((a - well0) * sg) < wide;
  for (let j = 0; j < 24; j++) for (const [y, face, k] of [[D, UP, 1], [D - 0.1, [0, -1, 0], 0.75]] as [number, V3, number][]) ring(y, 0, ri, j * 15, (j + 1) * 15, face, k);
  for (let j = 0; j < 48; j++) {
    const a0 = j * 7.5, a1 = a0 + 7.5;
    if (inWell(a0 + 3.75)) {
      // (the edge of the boards, round the well)
      wood.quad([P(a0, ri, D - 0.1), P(a1, ri, D - 0.1), P(a1, ri, D), P(a0, ri, D)], [[0, 0], [0.3, 0], [0.3, 0.1], [0, 0.1]], out(a0 + 3.75), tone * 0.8);
      continue;
    }
    ring(D, ri, rin, a0, a1, UP);
    ring(D - 0.1, ri, rin, a0, a1, [0, -1, 0], 0.75);
  }
  wood.quad([P(well0, ri, D - 0.1), P(well0, rin, D - 0.1), P(well0, rin, D), P(well0, ri, D)], [[ri, 0], [rin, 0], [rin, 0.1], [ri, 0.1]], mul(round(well0), sg), tone * 0.8);
  // two joists under it, where no head comes up: across the middle square to the well, and along the side away from it
  const wc = well0 + (sg * wide) / 2;
  timber(wood, P(wc + 90, rin, D - 0.21), P(wc - 90, rin, D - 0.21), 0.18, 0.22, tone * 0.85);
  timber(wood, P(wc + 180 - 57, rin, D - 0.21), P(wc + 180 + 57, rin, D - 0.21), 0.18, 0.22, tone * 0.85);
  // what holds a body up there: the middle of it, and the ring in lengths; the last tread of the stair is one of them
  disc('tower platform', D - 0.1, D, ri + 0.02);
  for (let j = 0; j < 48; j++) {
    if (inWell(j * 7.5 + 3.75)) continue;
    const pts: number[] = [];
    for (const a of [j * 7.5, j * 7.5 + 7.5]) for (const r of [ri, rin]) for (const y of [D - 0.1, D]) pts.push(...P(a, r, y));
    put({ t: 'hull', pts, feet: false, surface: 'wood', name: 'tower platform' });
  }
  {
    const pts: number[] = [];
    for (const a of [tw.well[1] - da, tw.well[1] - da / 2, tw.well[1]]) for (const r of [ri, rin]) for (const y of [D - 0.1, D]) pts.push(...P(a, r, y));
    put({ t: 'hull', pts, feet: true, surface: 'wood', name: 'tower stair head' });
  }
  // a rail along the open edge of the middle, over the stair, and one across the ring where the well begins.
  // (What stops a body goes down as well as up: whoever is on the last of the stair does not step in under the boards.)
  for (let k = 0, m = 4, each = (wide - Math.abs(da)) / m; k < m; k++) railRun(wood, put, P(well0 + sg * k * each, ri - 0.05, D), P(well0 + sg * (k + 1) * each, ri - 0.05, D), tone, 'tower platform rail', 1.3);
  railRun(wood, put, P(well0 - sg * 1.5, ri - 0.05, D), P(well0 - sg * 1.5, rin - 0.04, D), tone, 'tower platform rail');
}

/** a tower's door to the terrace, and how wide its windows are */
export const TOWER_DOOR = { w: 1.0, h: 2.1 };
export const SLIT_WIDE = 0.7;

// ------------------------------------------------------------------ the whole of it

/** a piece that stands on the ground, at the height the ground is there */
function lifted(p: Part, g: number): Part {
  switch (p.t) {
    case 'box': return { ...p, y0: p.y0 + g, y1: p.y1 + g };
    case 'wall': return { ...p, y0: p.y0 + g, top: typeof p.top === 'number' ? p.top + g : p.top.map((t) => t + g), openings: p.openings?.map((o) => ({ ...o, y0: o.y0 + g, y1: o.y1 + g })) };
    case 'lump': return { ...p, y: p.y + g };
    default: return p;
  }
}

function emit(p: Part, of: (paint: Paint) => Out, solids: Solid[] | null, lod: number, ground: (x: number, z: number) => number) {
  const body: Body = p.body ?? 'all';
  const put: Put = (s) => void (solids && body !== 'none' && solids.push(s));
  const o = p.hidden ? VOID : of(p.paint);
  switch (p.t) {
    case 'box': return boxPart(p, o, put);
    case 'slab': return slabPart(p, o, put);
    case 'beam': return beamPart(p, o, put);
    case 'rail': return railRun(o, put, (p as Rail).a, p.b, p.tone, p.name);
    case 'flight': return flightPart(p, o, put);
    case 'wall': return wallPart(p, o, put, lod);
    case 'curtain': return curtainPart(p, o, put, lod);
    case 'tower': return towerPart(p, o, of('timber'), put, lod);
    case 'mound': return moundPart(p, o, put, lod, ground);
    case 'lump': return lumpPart(p, o, put, lod);
  }
}

/**
 * The whole fort and its grounds as shapes.
 * @param ground how high the ground is at a spot, over the terrace (the ruined houses and the rocks stand on it)
 */
export function castleShape(ground: (x: number, z: number) => number = castleGround): Shape {
  const near = Object.fromEntries(PAINTS.map((p) => [p, skin()])) as Record<Paint, Skin>, far = skin(), solids: Solid[] = [];
  const nears = Object.fromEntries(PAINTS.map((p) => [p, new Out(near[p], TILE[p], [1, 1, 1])])) as Record<Paint, Out>;
  const fars = Object.fromEntries(PAINTS.map((p) => [p, new Out(far, TILE.stone, FAR_TINT[p])])) as Record<Paint, Out>;
  for (const raw of castleParts()) {
    const p = raw.sits ? lifted(raw, ground(raw.sits[0], raw.sits[1])) : raw;
    if (p.at !== 'far') emit(p, (paint) => nears[paint], solids, 0, ground);
    if (p.at) emit(p, (paint) => fars[paint], null, 1, ground);
  }
  return { near, far, solids };
}
