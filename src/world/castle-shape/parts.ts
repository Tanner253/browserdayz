// The fort's shape: the plain parts (blocks, boxes, slabs, beams, rails, flights of steps, walls with their openings, curtain walls).
// (One part of castle-shape.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { type V3, type Box, type Slab, type Beam, body, type Flight, type Wall, type Opening, type Curtain } from '../../sim/castle';
import { SURF, UP, VOID, add, cross, dot, hash, len, minus, mul, quatOf, sorted, sub, unit, weather, type Grain, type Out, type Solid, type Surf, type UV } from './base';

/** A block: its middle, the three ways it lies, half its size along each. */
export function block(o: Out, c: V3, ax: V3[], h: V3, tone = 1, grain: Grain = 0) {
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

export const boxSolid = (c: V3, ax: V3[], h: V3, feet: boolean, surface: Surf, name: string): Solid => ({ t: 'box', c, h, q: quatOf(ax[0], ax[1], ax[2]), feet, surface, name });

/** the three ways a timber lies that runs from `a` to `b`: its depth, its width, its length */
function along(a: V3, b: V3): V3[] {
  const t = unit(sub(b, a)), side: V3 = Math.abs(t[1]) > 0.99 ? [1, 0, 0] : unit(cross(t, UP));
  return [cross(side, t), side, t];
}

export function timber(o: Out, a: V3, b: V3, w: number, h: number, tone = 1) {
  block(o, mul(add(a, b), 0.5), along(a, b), [h / 2, w / 2, len(sub(b, a)) / 2], tone, 1);
}

// ------------------------------------------------------------------ the pieces

export type Put = (s: Solid) => void;

export function boxPart(p: Box, o: Out, put: Put) {
  const c = Math.cos(p.yaw ?? 0), s = Math.sin(p.yaw ?? 0), ax: V3[] = [[c, 0, -s], UP, [s, 0, c]];
  const mid: V3 = [(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, (p.z0 + p.z1) / 2], h: V3 = [(p.x1 - p.x0) / 2, (p.y1 - p.y0) / 2, (p.z1 - p.z0) / 2];
  block(o, mid, ax, h, p.tone, p.paint === 'timber' ? 1 : 0);
  put(boxSolid(mid, ax, h, p.body === 'feet', SURF[p.paint], p.name ?? 'block'));
}

export function slabPart(p: Slab, o: Out, put: Put) {
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

export function beamPart(p: Beam, o: Out, put: Put) {
  timber(o, p.a, p.b, p.w, p.h, p.tone);
  put(boxSolid(mul(add(p.a, p.b), 0.5), along(p.a, p.b), [p.h / 2, p.w / 2, len(sub(p.b, p.a)) / 2], p.body === 'feet', SURF[p.paint], p.name ?? 'timber'));
}

/** how high a rail's top bar is over what it stands on, and how much higher than its line what stops a body goes */
// (a body's: so high in metres of the world, whatever the fort's scale: see `body` in src/sim/castle.ts)
export const RAIL = { top: body(0.93), mid: body(0.5), over: body(1.05) };

/**
 * Posts and two bars from `a` to `b`. What stops a body stands straight up from the line of it, whatever the
 * slope; and up a slope it is in short lengths, each no taller than the rail is there. (As one piece from the foot
 * of a flight to a pace over its head, the rail of the stair below stood as a wall nobody could see across the
 * floor above, where that floor lies over the stair's foot: found by walking it, not by looking.)
 */
export function railRun(o: Out, put: Put, a: V3, b: V3, tone = 1, name = 'rail', under = 0) {
  const flat = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (flat < 0.05) return;
  const lift = (p: V3, y: number): V3 => [p[0], p[1] + y, p[2]];
  timber(o, lift(a, RAIL.top), lift(b, RAIL.top), 0.05, 0.07, tone);
  timber(o, lift(a, RAIL.mid), lift(b, RAIL.mid), 0.035, 0.05, tone);
  const posts = Math.max(1, Math.round(flat / 1.1)), dir: V3 = [(b[0] - a[0]) / flat, 0, (b[2] - a[2]) / flat], ax = [dir, UP, cross(dir, UP)];
  for (let k = 0; k <= posts; k++) {
    const p = add(a, mul(sub(b, a), k / posts));
    // (where two runs meet, at a corner or end to end, each has its post there: ONE post is stood, the first run's. Two
    // in one place, one a hair thinner inside the other, were two faces a hair apart all the way up, which flicker
    // from a few paces off.)
    const here = `${Math.round(p[0] * 50)},${Math.round(p[1] * 50)},${Math.round(p[2] * 50)}`;
    if (o.posts.has(here)) continue;
    o.posts.add(here);
    // (a post of a run that goes north and south is a little the thinner and the shorter: where it stands near another's, not in its place, their faces are not in one plane)
    const thin = (Math.abs(dir[2]) > Math.abs(dir[0]) ? 0.004 : 0) + (k === 0 ? 0.002 : k === posts ? 0.001 : 0) + (dir[0] + dir[2] < 0 ? 0.0005 : 0);
    block(o, lift(p, RAIL.top / 2 - thin), ax, [0.03 - thin, RAIL.top / 2 - thin, 0.03 - thin], tone, 1);
  }
  const n = Math.max(1, Math.ceil(Math.abs(b[1] - a[1]) / 0.4));
  for (let k = 0; k < n; k++) {
    const p = add(a, mul(sub(b, a), k / n)), q = add(a, mul(sub(b, a), (k + 1) / n));
    const lo = Math.min(p[1], q[1]) - under, tall = Math.abs(q[1] - p[1]) + RAIL.over + under;
    put(boxSolid([(p[0] + q[0]) / 2, lo + tall / 2, (p[2] + q[2]) / 2], ax, [flat / n / 2 + 0.01, tall / 2, 0.03], true, 'wood', name));
  }
}

/** how thick the slope is that is walked on under a flight of steps: it lies along the fronts of the treads */
export const SLOPE_HALF = 0.04;

/**
 * A flight: boards to look at, and one slope to walk on, laid from a tread before the first to a tread short of
 * the last, with the last tread level after it. (As every stair in the game is: see `flight` in buildings.ts. A
 * body goes up a bank and catches on steps.)
 */
export function flightPart(p: Flight, o: Out, put: Put) {
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
export const headAt = (y0: number, y1: number, halfWidth: number, arch: boolean | undefined, t: number, rise?: number) => {
  if (!arch) return y1;
  const r = archRise(y0, y1, halfWidth, rise), k = Math.min(1, Math.abs(t));
  return y1 - r * (1 - Math.sqrt(1 - k * k));
};

/** how high an arch stands from its springing to its crown: a half round, or as much of one as its height leaves room for, or what is said */
const archRise = (y0: number, y1: number, halfWidth: number, rise?: number) => Math.min(rise ?? Infinity, halfWidth, (y1 - y0) * 0.5);

/** as far up as a body is let through an arched opening: it is cut square, half way up the arch */
export const squareHead = (o: { y0: number; y1: number; arch?: boolean; rise?: number }, halfWidth: number) => (o.arch ? o.y1 - archRise(o.y0, o.y1, halfWidth, o.rise) / 2 : o.y1);

/** how high an opening's foot is at a place across it: level, or (a hole where stones have gone) round as its head is */
export const sillAt = (y0: number, y1: number, halfWidth: number, round: boolean | undefined, t: number) => (round ? y0 + y1 - headAt(y0, y1, halfWidth, true, t) : y0);

/** and as far down as a body is let through one that is round at the foot */
export const squareSill = (o: { y0: number; y1: number; round?: boolean }, halfWidth: number) => (o.round ? o.y0 + Math.min(halfWidth, (o.y1 - o.y0) * 0.5) / 2 : o.y0);

export function wallPart(w: Wall, o: Out, core: Out, put: Put, lod: number) {
  const [ax, az] = w.a, L = Math.hypot(w.b[0] - ax, w.b[1] - az), d: V3 = [(w.b[0] - ax) / L, 0, (w.b[1] - az) / L], out: V3 = [d[2], 0, -d[0]], half = w.thick / 2;
  const tops = typeof w.top === 'number' ? [w.top] : w.top, broken = tops.length > 1 && !lod, tone = w.tone ?? 1, ops = w.openings ?? [];
  const topAt = (u: number) => tops[Math.min(tops.length - 1, Math.floor((u / L) * tops.length))];
  const at = (u: number, y: number, s: number): V3 => [ax + d[0] * u + out[0] * s * half, y, az + d[2] * u + out[2] * s * half];
  // (the picture goes along it by where it stands: two lengths of one wall carry on from each other)
  const base = ax * d[0] + az * d[2], seed = Math.round(ax * 31 + az * 17 + L * 7);
  /** the openings there are at a place along it, lowest first: a door may have a doorway over it */
  const opsAt = (u: number) => ops.filter((p) => u > p.u0 && u < p.u1).sort((p, q) => p.y0 - q.y0);
  const head = (p: Opening, u: number) => headAt(p.y0, p.y1, (p.u1 - p.u0) / 2, p.arch, (u - (p.u0 + p.u1) / 2) / ((p.u1 - p.u0) / 2), p.rise);
  /** the way the underside of an opening's head faces at a place across it: down, and out along the wall as an arch comes down to its jamb */
  const soffit = (p: Opening, u: number): V3 => {
    if (!p.arch) return [0, -1, 0];
    const hw = (p.u1 - p.u0) / 2, t = Math.min(0.97, Math.max(-0.97, (u - (p.u0 + p.u1) / 2) / hw)), slope = (-archRise(p.y0, p.y1, hw, p.rise) * t) / (hw * Math.sqrt(1 - t * t));
    return unit([d[0] * slope, -1, d[2] * slope]);
  };
  const sill = (p: Opening, u: number) => sillAt(p.y0, p.y1, (p.u1 - p.u0) / 2, p.round, (u - (p.u0 + p.u1) / 2) / ((p.u1 - p.u0) / 2));

  // ---- what is seen. It is cut along its length wherever its top or an opening changes, and a broken top is cut
  // again between: no two stones of a ruin's top are at one height.
  const cuts = new Set<number>([0, L]);
  for (let k = 1; k < tops.length; k++) cuts.add((k * L) / tops.length);
  for (const p of ops) for (let k = 0, n = p.arch && !lod ? 8 : 1; k <= n; k++) cuts.add(p.u0 + ((p.u1 - p.u0) * k) / n);
  if (broken) for (let k = 1, n = Math.round(L / 0.42); k < n; k++) cuts.add((k * L) / n);
  const us = sorted([...cuts].filter((u) => u >= 0 && u <= L), 0.03);
  us[us.length - 1] = L;
  /** what stands in each length: [its foot at the near end, its foot at the far end, its top at the near end, at the far end] for each piece, lowest first */
  const cols = us.slice(0, -1).map((u0, i) => {
    const u1 = us[i + 1], mid = (u0 + u1) / 2;
    // (a broken top comes down from one height to the next a course at a time, where the two are not far apart: a
    // wall falls in slopes, and stands in steps only where a length of it has gone altogether)
    let top = topAt(mid);
    if (broken) {
      const g = (mid / L) * tops.length - 0.5, k = Math.max(0, Math.min(tops.length - 2, Math.floor(g))), t = Math.min(1, Math.max(0, g - k));
      if (Math.abs(tops[k + 1] - tops[k]) < 0.8) top = tops[k] + (tops[k + 1] - tops[k]) * t;
      top = Math.round((top - hash(i, seed, 3) * 0.2) / COURSE) * COURSE;
    }
    const spans: [number, number, number, number][] = [], over: (Opening | null)[] = [];
    let b0 = w.y0, b1 = w.y0, below: Opening | null = null;
    for (const p of opsAt(mid)) {
      const t0 = Math.min(sill(p, u0), top), t1 = Math.min(sill(p, u1), top);
      if (Math.max(t0, t1) > Math.max(b0, b1) + 0.01) {
        spans.push([b0, b1, Math.max(t0, b0), Math.max(t1, b1)]);
        over.push(below);
      }
      b0 = head(p, u0);
      b1 = head(p, u1);
      below = p;
    }
    if (top > Math.max(b0, b1) + 0.02) {
      spans.push([b0, b1, top, top]);
      over.push(below);
    }
    // (`over`: the opening each piece stands over, if it stands over one)
    return { u0, u1, spans, over };
  });
  /** how far round the underside of each opening's head the lengths before this one have come: the picture is laid round an arch, not let fall on it from above (and turned: its courses lie across the arch, one to each stone of its ring) */
  const round = new Map<Opening, number>();
  cols.forEach((c, ci) => {
    // (the rain runs off a sill and out of a gap between two merlons, and down the wall under it: darkest at the
    // top, and gone a man's height down. So a length of wall that stands lower than the length beside it is
    // stained from its top, and so is the wall under every opening.)
    const topOf = (k: number) => (cols[k] && cols[k].spans.length ? cols[k].spans[cols[k].spans.length - 1][2] : -Infinity);
    for (const [si, [b0, b1, t0, t1]] of c.spans.entries()) {
      const under = si < c.spans.length - 1, gap = !under && (topOf(ci - 1) > t0 + 0.5 || topOf(ci + 1) > t0 + 0.5) && c.u1 - c.u0 < 1.3;
      const wet = under ? 0.66 : gap ? 0.74 : 1, deep = Math.max(b0, t0 - (under ? 1.5 : 2.4)), bm = Math.max(b1, t1 - (under ? 1.5 : 2.4));
      for (const s of [1, -1]) {
        if (wet < 1 && deep > b0 + 0.05) {
          // (in two: the stained length of it, and the rest under that)
          o.quad([at(c.u0, b0, s), at(c.u1, b1, s), at(c.u1, bm, s), at(c.u0, deep, s)], [[base + c.u0, b0], [base + c.u1, b1], [base + c.u1, bm], [base + c.u0, deep]], mul(out, s), tone);
          o.quad([at(c.u0, deep, s), at(c.u1, bm, s), at(c.u1, t1, s), at(c.u0, t0, s)], [[base + c.u0, deep], [base + c.u1, bm], [base + c.u1, t1], [base + c.u0, t0]], mul(out, s), [tone, tone, tone * wet, tone * wet]);
          continue;
        }
        const pts = [at(c.u0, b0, s), at(c.u1, b1, s), at(c.u1, t1, s), at(c.u0, t0, s)];
        o.quad(pts, [[base + c.u0, b0], [base + c.u1, b1], [base + c.u1, t1], [base + c.u0, t0]], mul(out, s), wet < 1 ? [tone, tone, tone * wet, tone * wet] : tone);
      }
      // its top (a sill, where it is under an opening), and its underside where it is over one
      const face = (y0: number, y1: number, n: V3, k: number) => o.quad([at(c.u0, y0, -1), at(c.u1, y1, -1), at(c.u1, y1, 1), at(c.u0, y0, 1)], [[base + c.u0, -half], [base + c.u1, -half], [base + c.u1, half], [base + c.u0, half]], n, tone * k);
      // (a broken top shows what the wall is filled with)
      if (broken && t0 === c.spans[c.spans.length - 1][2]) core.quad([at(c.u0, t0, -1), at(c.u1, t1, -1), at(c.u1, t1, 1), at(c.u0, t0, 1)], [[base + c.u0, -half], [base + c.u1, -half], [base + c.u1, half], [base + c.u0, half]], UP, tone * 0.95);
      else face(t0, t1, UP, 0.94);
      const p = c.over[si];
      // (from far off an arch is one flat length, and faces down)
      if (p && p.arch && !lod) {
        const s0 = round.get(p) ?? 0, s1 = s0 + Math.hypot(c.u1 - c.u0, b1 - b0), n0 = soffit(p, c.u0), n1 = soffit(p, c.u1);
        round.set(p, s1);
        o.quad([at(c.u0, b0, -1), at(c.u1, b1, -1), at(c.u1, b1, 1), at(c.u0, b0, 1)], [[-half, base + p.u0 + s0], [-half, base + p.u0 + s1], [half, base + p.u0 + s1], [half, base + p.u0 + s0]], soffit(p, (c.u0 + c.u1) / 2), tone * 0.8, [n0, n1, n1, n0]);
      } else if (b0 > w.y0 + 0.005 || b1 > w.y0 + 0.005) face(b0, b1, [0, -1, 0], 0.8);
      // (a wall whose foot is in the air, over a way: its underside. Left unmade, whoever stood at the foot of the hatch's steps and looked up saw into the wall across the back of its well, and through it.)
      else if (w.soffit && si === 0) face(b0, b1, [0, -1, 0], 0.8);
    }
  });
  // the ends of it, the jambs of its openings, and the steps of a broken top: wherever stone stands beside none
  for (let i = 0; i <= cols.length; i++) {
    const left = i > 0 ? cols[i - 1].spans.map(([, b, , t]): [number, number] => [b, t]) : [], right = i < cols.length ? cols[i].spans.map(([b, , t]): [number, number] => [b, t]) : [];
    const u = i < cols.length ? cols[i].u0 : L;
    for (const [side, list] of [[1, minus(left, right)], [-1, minus(right, left)]] as [number, [number, number][]][]) {
      for (const [lo, hi] of list) (broken ? core : o).quad([at(u, lo, -1), at(u, lo, 1), at(u, hi, 1), at(u, hi, -1)], [[-half, lo], [half, lo], [half, hi], [-half, hi]], mul(d, side), tone * 0.9);
    }
  }

  // ---- what stops a body: a block for each length between its openings and the steps of its top
  const hard = new Set<number>([0, L]);
  // (a low kerb's steps are each a block of their own, a hand under what it is said to be: its stones are drawn up to
  // a fifth of a metre short of that, and one block as high as its highest step stopped a body in the air over its
  // low end: measured at the hatch, 2026-10-13, a flat top 0.5 m over the drawn one)
  for (let k = 1; k < tops.length; k++) if (w.stepped || Math.abs(tops[k] - tops[k - 1]) > 0.25) hard.add((k * L) / tops.length);
  for (const p of ops) hard.add(p.u0).add(p.u1);
  const hs = sorted(hard, 0.01);
  for (let i = 0; i + 1 < hs.length; i++) {
    const u0 = hs[i], u1 = hs[i + 1], mid = (u0 + u1) / 2;
    // (over a length whose top is all at about one height: the highest of it)
    let top = -Infinity;
    for (let k = 0; k < tops.length; k++) if (((k + 1) * L) / tops.length > u0 + 0.01 && (k * L) / tops.length < u1 - 0.01) top = Math.max(top, tops[k]);
    if (w.stepped) top -= 0.1;
    const spans: [number, number][] = [];
    let lo0 = w.y0;
    for (const p of opsAt(mid)) {
      spans.push([lo0, Math.min(top, squareSill(p, (p.u1 - p.u0) / 2))]);
      lo0 = squareHead(p, (p.u1 - p.u0) / 2);
    }
    spans.push([lo0, top]);
    for (const [lo, hi] of spans) if (hi - lo > 0.05) put(boxSolid(at(mid, (lo + hi) / 2, 0), [d, UP, cross(d, UP)], [(u1 - u0) / 2, (hi - lo) / 2, half], false, SURF[w.paint], w.name ?? 'wall'));
  }
}

/** how deep a putlog hole is, half its size, and how dark the stain under it is at its top */
const PUTLOG = { deep: 0.22, half: 0.065, stain: 0.62 };

/**
 * A face of a wall with the square holes its builders left in it (where their poles went in), each a real pocket,
 * dark inside, and the wall under each one stained where the rain has run out of it: darkest at the hole and gone
 * by the next course of holes down. `at(u, v)` is the place on the face that is `u` along it and `v` up it,
 * `n` the way it faces there, `uv` where that is on the picture, `tone` how light the wall is at that height.
 * It is cut at `us` and `vs` (and round each hole); `top(u)`, where there is one, is as high as it still stands.
 */
export function holedFace(o: Out, f: { at: (u: number, v: number) => V3; n: (u: number, v: number) => V3; uv: (u: number, v: number) => UV; tone: (v: number) => number; round?: boolean }, us0: number[], vs0: number[], holes: [number, number][], hu: number, top?: (u: number) => number) {
  const hv = PUTLOG.half, us = sorted([...us0, ...holes.flatMap(([u]) => [u - hu, u + hu])].filter((u) => u >= us0[0] - 1e-6 && u <= us0[us0.length - 1] + 1e-6), 1e-4), vs = sorted([...vs0, ...holes.flatMap(([, v]) => [v - hv, v + hv])].filter((v) => v >= vs0[0] - 1e-6 && v <= vs0[vs0.length - 1] + 1e-6), 1e-4);
  const holeAt = (u: number, v: number) => holes.some(([a, b]) => Math.abs(u - a) < hu && Math.abs(v - b) < hv);
  for (let i = 0; i + 1 < us.length; i++) {
    const u0 = us[i], u1 = us[i + 1], um = (u0 + u1) / 2, high = top ? top(um) : Infinity;
    for (let j = 0; j + 1 < vs.length; j++) {
      const v0 = vs[j], v1 = Math.min(vs[j + 1], high), vm = (v0 + vs[j + 1]) / 2;
      if (v1 - v0 < 0.01) continue;
      const c = [f.at(u0, v0), f.at(u1, v0), f.at(u1, v1), f.at(u0, v1)], t = [f.uv(u0, v0), f.uv(u1, v0), f.uv(u1, v1), f.uv(u0, v1)], n = f.n(um, vm);
      if (holeAt(um, vm)) {
        // the pocket: its four sides and its back
        const back = c.map((p) => sub(p, mul(n, PUTLOG.deep)));
        o.quad(back, t, n, 0.1);
        for (let k = 0; k < 4; k++) o.quad([c[k], c[(k + 1) % 4], back[(k + 1) % 4], back[k]], [t[k], t[(k + 1) % 4], t[(k + 1) % 4], t[k]], sub(mul(add(add(c[0], c[1]), add(c[2], c[3])), 0.25), mul(add(c[k], c[(k + 1) % 4]), 0.5)), 0.3);
        continue;
      }
      // (the stain: under a hole, down to the next cut)
      const wet = j + 2 < vs.length && holeAt(um, (vs[j + 1] + vs[j + 2]) / 2) ? PUTLOG.stain : 1, lo = f.tone(v0), hi = f.tone(v1);
      o.quad(c, t, n, [lo, lo, hi * wet, hi * wet], f.round ? [f.n(u0, v0), f.n(u1, v0), f.n(u1, v1), f.n(u0, v1)] : undefined);
    }
  }
}

/** a way through the foot of a wall, for a passage under the ground: where it is on the plan [x, z], and from how deep to how deep */
export interface Gap { x: number; z: number; y0: number; y1: number }

export function curtainPart(c: Curtain, o: Out, put: Put, lod: number, gaps: Gap[]) {
  const [ax, az] = c.a, L = Math.hypot(c.b[0] - ax, c.b[1] - az), d: V3 = [(c.b[0] - ax) / L, 0, (c.b[1] - az) / L], out: V3 = [d[2], 0, -d[0]];
  const k = Math.hypot(1, 1 / c.lean), n = unit([out[0], 1 / c.lean, out[2]]), tone = c.tone ?? 1;
  const at = (u: number, y: number): V3 => [ax + d[0] * u - (out[0] * y) / c.lean, y, az + d[2] * u - (out[2] * y) / c.lean];
  const base = ax * d[0] + az * d[2], sag = c.sag;
  // (it is cut along its length where a length of it has fallen out, and that length stands only as high as what is left of it: ragged, a little higher at its ends)
  const us = sorted([0, L, ...Array.from({ length: lod ? 0 : Math.ceil(L / 3.3) }, (_, j) => (L * j) / Math.ceil(L / 3.3)), ...(sag ? [sag[0], sag[1], ...Array.from({ length: 5 }, (_, j) => sag[0] + ((sag[1] - sag[0]) * (j + 1)) / 6)] : [])], 0.05);
  const topAt = (u: number) => (sag && u > sag[0] && u < sag[1] ? sag[2] + 0.5 * Math.abs((u - (sag[0] + sag[1]) / 2) / ((sag[1] - sag[0]) / 2)) ** 3 + hash(Math.round(u * 9), 3, 71) * 0.3 : 0);
  // (the builders' holes: a course of them every pace and three quarters down it, each course set off from the last; none where the hill has it)
  const holes: [number, number][] = [];
  if (!lod) for (let y = -1.3, r = 0; y > Math.max(c.y0 + 1, -8.6); y -= 1.75, r++) for (let u = 1.2 + (r % 2) * 1.2; u < L - 0.8; u += 2.4) if (y < topAt(u) - 0.5) holes.push([u, y]);
  const vs = lod ? [c.y0, 0.6] : sorted([c.y0, ...Array.from({ length: Math.ceil(-c.y0 / 2.6) }, (_, i) => (c.y0 * i) / Math.ceil(-c.y0 / 2.6)), 0.6], 0.05);
  holedFace(o, { at, n: () => n, uv: (u, y) => [base + u, y * k], tone: (y) => weather(y) * tone }, us, vs, holes, PUTLOG.half, topAt);
  const upIt = unit(sub(at(0, 1), at(0, 0)));
  // (what stops a body is a slab behind the face: nobody is ever behind it. Where a passage goes through its foot,
  // under the ground, it is left open for it; and where a length of it has fallen out, there is none above what is left.)
  const piece = (u0: number, u1: number, y0: number, y1: number) => void (u1 - u0 > 0.05 && y1 - y0 > 0.05 && put(boxSolid(sub(at((u0 + u1) / 2, (y0 + y1) / 2), mul(n, 0.3)), [d, upIt, cross(d, upIt)], [(u1 - u0) / 2, ((y1 - y0) * k) / 2, 0.3], false, 'concrete', c.name ?? 'curtain')));
  const through = gaps.map((g) => ({ u: (g.x - ax) * d[0] + (g.z - az) * d[2], off: (g.x - ax) * out[0] + (g.z - az) * out[2], g })).filter((q) => q.u > 0 && q.u < L && Math.abs(q.off + (q.g.y0 + q.g.y1) / 2 / c.lean) < 1.6);
  const ends = sorted([0, L, ...(sag ? [sag[0], sag[1]] : []), ...through.flatMap((q) => [q.u - 1.5, q.u + 1.5])].filter((u) => u >= 0 && u <= L), 0.01);
  for (let i = 0; i + 1 < ends.length; i++) {
    const u0 = ends[i], u1 = ends[i + 1], um = (u0 + u1) / 2, top = sag && um > sag[0] && um < sag[1] ? sag[2] : 0, q = through.find((t) => Math.abs(um - t.u) < 1.5);
    if (q) piece(u0, u1, Math.min(top, q.g.y1), top);
    piece(u0, u1, c.y0, q ? Math.min(top, q.g.y0) : top);
  }
}
