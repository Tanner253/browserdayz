// Where a piece can go (2026-10-24, base building's second step): Rust's sockets, without a world grid. The owner:
// "snapping building and a clean ui and ux is super important to making this enjoyable".
//
// Each base has a frame of its own, set where and however its first foundation was laid; every piece is placed in it
// and turned in steps of 30 degrees (a triangle turns a square by 60). A floor-like piece (a foundation, a floor, a
// roof) has an outline; its edges are where the next foundation goes, where a wall stands, and, at the top of a wall,
// where a floor goes over it. This file says, for a kind of piece and what already stands, every place it could go
// (`spots`), which of them is nearest where the player aims (`snap`), and why one may not be built (`blocked`). The
// game asks it to draw the ghost; the server asks the same of its own copy to believe a piece laid.
//
// Directions: an angle a is the way (sin a, cos a) on the ground (x, z), as three.js's rotation.y turns +z.

import { CELL, FOUND, PIECES, STOREY, type Shape, type Tier } from './pieces';

export interface Piece {
  id: number;
  /** its kind (PIECES) and tier */
  k: string;
  t: Tier;
  /** where it is in its base's frame: a floor-like piece's middle at its top; anything else's foot */
  x: number;
  y: number;
  z: number;
  /** how it is turned, in steps of 30 degrees (0..11); a wall faces its outside, which is its hard side */
  r: number;
  hp: number;
  /** when it was laid (ms) and by whom */
  at: number;
  by: string;
  /** the pieces it rests on (none: it stands on the ground) */
  on: number[];
}

export interface Base {
  id: number;
  /** where its frame is in the world, and how it is turned (radians) */
  ox: number;
  oy: number;
  oz: number;
  yaw: number;
  /** who laid its first piece (their key's hash, as the server keeps characters) */
  owner: string;
  pieces: Map<number, Piece>;
  next: number;
}

export interface Spot {
  x: number;
  y: number;
  z: number;
  r: number;
  /** what it would rest on */
  on: number[];
}

const STEP = Math.PI / 6;
export const angleOf = (r: number) => r * STEP;
const sin = (r: number) => Math.sin(r * STEP), cos = (r: number) => Math.cos(r * STEP);
const mod12 = (r: number) => ((Math.round(r) % 12) + 12) % 12;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** how near two places have to be to be one place */
const SAME = 0.05;
/** an outline's middle to its edge (its inradius), and the turns of its edges' outward sides */
const INR: Record<Shape, number> = { sq: CELL / 2, tri: CELL / (2 * Math.sqrt(3)) };
const EDGE_R: Record<Shape, number[]> = { sq: [0, 3, 6, 9], tri: [0, 4, 8] };
/** an outline looks the same turned this many steps */
const SYM: Record<Shape, number> = { sq: 3, tri: 4 };
/** the most storeys over the foundations */
export const STOREYS = 4;

const kindOf = (p: { k: string }) => PIECES[p.k];
const isFloor = (p: Piece) => kindOf(p).role === 'floor';
const isWall = (p: Piece) => kindOf(p).role === 'wall';
/** a wall a floor can be laid on: a whole storey high */
const bears = (p: Piece) => isWall(p) && (kindOf(p).h ?? 0) >= STOREY - 1e-6;

export interface Edge {
  x: number;
  z: number;
  y: number;
  /** its outward side, in steps of 30 degrees */
  n: number;
}

/** a floor-like piece's edges, at its top */
export function edgesOf(shape: Shape, x: number, y: number, z: number, r: number): Edge[] {
  const d = INR[shape];
  return EDGE_R[shape].map((a) => {
    const n = mod12(r + a);
    return { x: x + sin(n) * d, z: z + cos(n) * d, y, n };
  });
}

/** a floor-like piece's corners (for telling whether two overlap) */
export function cornersOf(shape: Shape, x: number, z: number, r: number, shrink = 0): [number, number][] {
  const out: [number, number][] = [];
  if (shape === 'sq') {
    const h = CELL / 2 - shrink;
    for (const [a, b] of [[-h, -h], [h, -h], [h, h], [-h, h]]) out.push([x + a * cos(r) + b * sin(r), z - a * sin(r) + b * cos(r)]);
  } else {
    const R = CELL / Math.sqrt(3) - shrink * 2;
    for (const a of [2, 6, 10]) {
      const n = r + a;
      out.push([x + sin(n) * R, z + cos(n) * R]);
    }
  }
  return out;
}

/** whether two convex outlines overlap (the separating-axis test) */
function overlaps(a: [number, number][], b: [number, number][]) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length];
      const nx = z2 - z1, nz = x1 - x2;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const [x, z] of a) { const p = x * nx + z * nz; amin = Math.min(amin, p); amax = Math.max(amax, p); }
      for (const [x, z] of b) { const p = x * nx + z * nz; bmin = Math.min(bmin, p); bmax = Math.max(bmax, p); }
      if (amax <= bmin || bmax <= amin) return false;
    }
  }
  return true;
}

const near = (a: { x: number; z: number; y: number }, b: { x: number; z: number; y: number }) => Math.abs(a.x - b.x) < SAME && Math.abs(a.z - b.z) < SAME && Math.abs(a.y - b.y) < SAME;
/** how many steps a piece turns and looks the same: a floor's outline; a square roof (it slopes) and stairs never */
const symOf = (kind: string) => {
  const K = PIECES[kind];
  return K.role === 'floor' && K.shape && !(K.roof && K.shape === 'sq') ? SYM[K.shape] : 12;
};
/** the same turn, as far as a piece of that kind can tell */
const sameTurn = (kind: string, a: number, b: number) => mod12(a - b) % symOf(kind) === 0;

/** a wall's top: its middle, and its line */
const topOf = (w: Piece): Edge => ({ x: w.x, z: w.z, y: w.y + (kindOf(w).h ?? STOREY), n: w.r });

/** a floor-like piece's spot so that one of its edges is `e`, lying on the side `n` of it */
function floorOn(shape: Shape, e: Edge, n: number, turn = 0, slopes = false): { x: number; z: number; r: number } {
  const d = INR[shape];
  // (a square roof slopes: it keeps the turn the player gives it; anything else is its outline's least turn)
  return { x: r3(e.x + sin(n) * d), z: r3(e.z + cos(n) * d), r: slopes ? mod12(n + 6 + 3 * turn) : mod12(n + 6) % SYM[shape] };
}

/**
 * Every place a piece of `kind` could go in `base`, as the base stands: on the edges, the wall tops and the floors of
 * what is there. (Not whether it may: `blocked` says that.) A turn the player asks for (`turn`, in steps) is given to
 * what can be turned on its spot: stairs, and a wall's facing.
 */
export function spots(base: Base, kind: string, turn = 0): Spot[] {
  const K = PIECES[kind];
  const all = [...base.pieces.values()];
  const out: Spot[] = [];
  const add = (s: Spot) => {
    if (!out.some((o) => near(o, s) && sameTurn(kind, o.r, s.r))) out.push(s);
  };
  if (K.role === 'floor' && K.ground) {
    // a foundation beside a foundation, at its level
    for (const f of all) {
      const F = kindOf(f);
      if (!F.ground) continue;
      for (const e of edgesOf(F.shape!, f.x, f.y, f.z, f.r)) add({ ...floorOn(K.shape!, e, e.n), y: f.y, on: [] });
    }
  } else if (K.role === 'floor') {
    // over walls, on either side of the wall's top; or, a floor and not a roof, out from a floor at its level
    for (const w of all) {
      if (!bears(w)) continue;
      const top = topOf(w);
      for (const side of [0, 6]) add({ ...floorOn(K.shape!, top, w.r + side, turn, !!K.roof && K.shape === 'sq'), y: r3(top.y), on: [] });
    }
    if (!K.roof) {
      for (const f of all) {
        const F = kindOf(f);
        if (!isFloor(f) || F.ground || F.roof) continue;
        for (const e of edgesOf(F.shape!, f.x, f.y, f.z, f.r)) add({ ...floorOn(K.shape!, e, e.n), y: f.y, on: [] });
      }
    }
  } else if (K.role === 'wall') {
    // on any edge of a foundation or a floor, its hard side out; or on top of a wall
    for (const f of all) {
      const F = kindOf(f);
      if (!isFloor(f) || F.roof) continue;
      for (const e of edgesOf(F.shape!, f.x, f.y, f.z, f.r)) add({ x: r3(e.x), y: f.y, z: r3(e.z), r: mod12(e.n + (turn % 2) * 6), on: [] });
    }
    for (const w of all) if (isWall(w)) add({ x: w.x, y: r3(topOf(w).y), z: w.z, r: mod12(w.r + (turn % 2) * 6), on: [] });
  } else if (K.role === 'stairs') {
    for (const f of all) {
      const F = kindOf(f);
      if (!isFloor(f) || F.roof || F.shape !== K.shape || F.hole) continue;
      add({ x: f.x, y: f.y, z: f.z, r: mod12(f.r + 3 * (turn % 4)), on: [] });
    }
  } else if (K.role === 'steps') {
    const deep = K.half ? CELL / 4 : CELL / 2;
    for (const f of all) {
      const F = kindOf(f);
      if (!F.ground) continue;
      for (const e of edgesOf(F.shape!, f.x, f.y, f.z, f.r)) add({ x: r3(e.x + sin(e.n) * deep), y: f.y, z: r3(e.z + cos(e.n) * deep), r: e.n, on: [] });
    }
  } else if (K.role === 'free') {
    // end to end with another of its kind, along its line (either way)
    for (const w of all) {
      if (w.k !== kind) continue;
      const L = K.long ?? CELL;
      for (const s of [-1, 1]) add({ x: r3(w.x + s * L * cos(w.r)), y: w.y, z: r3(w.z - s * L * sin(w.r)), r: w.r, on: [] });
    }
  }
  for (const s of out) s.on = restsOn(base, kind, s);
  return out;
}

/** what a piece of `kind` at `s` would rest on (an empty list: nothing, unless it is a foundation or free) */
export function restsOn(base: Base, kind: string, s: { x: number; y: number; z: number; r: number }): number[] {
  const K = PIECES[kind];
  const on: number[] = [];
  for (const p of base.pieces.values()) {
    const P = kindOf(p);
    if (K.role === 'floor' && !K.ground) {
      // the walls under any of its edges; a floor out from a floor rests on that floor
      for (const e of edgesOf(K.shape!, s.x, s.y, s.z, s.r)) {
        if (bears(p) && near(topOf(p), e)) on.push(p.id);
        else if (isFloor(p) && !P.ground && !P.roof && !K.roof && Math.abs(p.y - s.y) < SAME && edgesOf(P.shape!, p.x, p.y, p.z, p.r).some((f) => near(f, e))) on.push(p.id);
      }
    } else if (K.role === 'wall') {
      if (isFloor(p) && !P.roof && edgesOf(P.shape!, p.x, p.y, p.z, p.r).some((e) => near(e, s))) on.push(p.id);
      if (isWall(p) && near(topOf(p), s)) on.push(p.id);
    } else if (K.role === 'stairs') {
      if (isFloor(p) && !P.roof && near(p, s)) on.push(p.id);
    } else if (K.role === 'steps') {
      const back = K.half ? CELL / 4 : CELL / 2;
      if (P.ground && edgesOf(P.shape!, p.x, p.y, p.z, p.r).some((e) => near(e, { x: s.x - sin(s.r) * back, y: s.y, z: s.z - cos(s.r) * back }))) on.push(p.id);
    }
  }
  return [...new Set(on)];
}

/**
 * Why a piece of `kind` may not go at `s` in `base` (null: it may). `ground` is the height of the ground under a
 * place in the base's frame, for a foundation's posts. The rules are Rust's, plainly said.
 */
export function blocked(base: Base, kind: string, s: Spot, ground?: (x: number, z: number) => number): string | null {
  const K = PIECES[kind];
  const all = [...base.pieces.values()];
  const level = (p: { y: number }) => p.y;
  // (nothing is set where something of its sort stands already)
  for (const p of all) {
    const P = kindOf(p);
    if (P.role === 'wall' && K.role === 'wall' && near(p, s)) return 'A wall stands there already';
    if (P.role === 'stairs' && K.role === 'stairs' && near(p, s)) return 'Stairs stand there already';
    if (P.role === 'steps' && K.role === 'steps' && near(p, s)) return 'Something stands there already';
    if (P.role === 'free' && K.role === 'free' && Math.hypot(p.x - s.x, p.z - s.z) < 1 && Math.abs(p.y - s.y) < 2) return 'A wall stands there already';
  }
  if (K.role === 'floor') {
    const mine = cornersOf(K.shape!, s.x, s.z, s.r, 0.06);
    for (const p of all) {
      const P = kindOf(p);
      if (P.role === 'floor' && Math.abs(level(p) - s.y) < 0.3 && overlaps(mine, cornersOf(P.shape!, p.x, p.z, p.r, 0.06))) return near(p, s) ? 'Something is built there already' : 'It would go through what is there';
      // (stairs come up through the floor over them)
      if (P.role === 'stairs' && Math.abs(p.y + STOREY - s.y) < 0.3 && overlaps(mine, cornersOf(P.shape!, p.x, p.z, p.r, 0.06))) return 'The stairs come up through here';
    }
  }
  if (K.role === 'stairs') {
    const mine = cornersOf(K.shape!, s.x, s.z, s.r, 0.06);
    if (all.some((p) => isFloor(p) && Math.abs(p.y - (s.y + STOREY)) < 0.3 && overlaps(mine, cornersOf(kindOf(p).shape!, p.x, p.z, p.r, 0.06)))) return 'No room over it: the floor above is in the way';
  }
  // (no more storeys than four: a floor may be the fourth's ceiling, nothing may stand on it)
  const lowest = Math.min(0, ...all.filter((p) => kindOf(p).ground).map(level));
  if (s.y - lowest > STOREYS * STOREY + (K.role === 'floor' ? 0.1 : -0.1)) return `Too high: ${STOREYS} storeys at most`;
  if (K.role !== 'floor' || !K.ground) {
    if (K.role !== 'free' && !s.on.length) return K.role === 'wall' ? 'It needs a foundation or a floor under it' : K.role === 'floor' ? 'It needs walls to rest on' : 'It needs a foundation under it';
    // (a floor holds on walls on two sides, or beside a floor that does: one cell past its walls, no more)
    if (K.role === 'floor' && !K.ground && !held(base, s.on)) return s.on.some((id) => isFloor(base.pieces.get(id)!)) ? 'Too far out: a floor reaches one cell past its walls' : 'It needs walls on two sides, or a floor beside it';
  }
  if (ground && (K.ground || K.role === 'free')) {
    const pts = K.ground ? [...cornersOf(K.shape!, s.x, s.z, s.r), [s.x, s.z] as [number, number]] : [[s.x, s.z] as [number, number]];
    const hs = pts.map(([x, z]) => ground(x, z));
    if (K.ground && Math.max(...hs) > s.y + 0.05) return 'The ground is in the way';
    if (K.ground && Math.min(...hs) < s.y - FOUND.posts - FOUND.deep) return 'Too high off the ground';
  }
  return null;
}

/** whether a floor resting on these is held: on two walls or more, or beside a floor that is on two walls or more */
function held(base: Base, on: number[]) {
  const walls = (ids: number[]) => ids.filter((id) => { const p = base.pieces.get(id); return !!p && bears(p); }).length;
  return walls(on) >= 2 || on.some((id) => { const p = base.pieces.get(id); return !!p && isFloor(p) && walls(p.on) >= 2; });
}

/** the nearest of `list` to where the player aims (in the base's frame), within `reach` metres; null: none near enough */
export function nearestSpot(list: Spot[], kind: string, aim: { x: number; y: number; z: number }, reach = 3.2): Spot | null {
  const K = PIECES[kind];
  // (the middle of what it would be: a wall's halfway up, stairs' halfway up the storey)
  const mid = (s: Spot) => ({ x: s.x, y: s.y + (K.role === 'wall' ? (K.h ?? STOREY) / 2 : K.role === 'stairs' ? STOREY / 2 : K.role === 'floor' ? -0.1 : 0.5), z: s.z });
  let best: Spot | null = null, bd = reach;
  for (const s of list) {
    const m = mid(s), d = Math.hypot(m.x - aim.x, m.y - aim.y, m.z - aim.z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/**
 * The spot nearest the player's line of sight (Rust's way: where a wall would stand is looked at, in the air, not the
 * ground behind it): of those in front of the eye no further than `far`, the one whose middle passes nearest the line,
 * within `reach` of it. The eye and the way it looks are in the base's frame.
 */
export function nearestToRay(list: Spot[], kind: string, from: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, far: number, reach = 1.4): Spot | null {
  const K = PIECES[kind];
  const lift = K.role === 'wall' ? (K.h ?? STOREY) / 2 : K.role === 'stairs' ? STOREY / 2 : K.role === 'floor' ? -0.1 : 0.5;
  let best: Spot | null = null, bd = Infinity;
  for (const s of list) {
    const mx = s.x - from.x, my = s.y + lift - from.y, mz = s.z - from.z;
    const t = mx * dir.x + my * dir.y + mz * dir.z;
    if (t < 0.4 || t > far) continue;
    const d = Math.hypot(mx - dir.x * t, my - dir.y * t, mz - dir.z * t);
    // (the nearer of two equally near the line: a little of the distance along it counts)
    const score = d + t * 0.04;
    if (d < reach && score < bd) {
      bd = score;
      best = s;
    }
  }
  return best;
}

/** whether a spot asked for is one the base offers (the server's test of what a game says it laid) */
export function offered(base: Base, kind: string, want: { x: number; y: number; z: number; r: number }): Spot | null {
  for (const turn of [0, 1, 2, 3]) {
    for (const s of spots(base, kind, turn)) if (near(s, want) && sameTurn(kind, s.r, want.r)) return s;
  }
  return null;
}

/**
 * The pieces that still stand: a foundation and a free piece on the ground, and whatever rests on something that
 * stands. Taken away, a piece takes with it whatever stood only on it (Rust's stability, plainly).
 */
export function standing(base: Base): Set<number> {
  const up = new Set<number>();
  for (const p of base.pieces.values()) if (kindOf(p).ground || kindOf(p).role === 'free') up.add(p.id);
  let more = true;
  while (more) {
    more = false;
    for (const p of base.pieces.values()) {
      if (up.has(p.id) || !p.on.some((id) => up.has(id))) continue;
      up.add(p.id);
      more = true;
    }
  }
  return up;
}

// ---- the frame

/** a place in a base's frame, in the world */
export function toWorld(b: Base, x: number, y: number, z: number): [number, number, number] {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return [b.ox + x * c + z * s, b.oy + y, b.oz - x * s + z * c];
}
/** and a place in the world, in a base's frame */
export function toLocal(b: Base, x: number, y: number, z: number): [number, number, number] {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = x - b.ox, dz = z - b.oz;
  return [dx * c - dz * s, y - b.oy, dx * s + dz * c];
}
/** a piece's turn in the world, radians */
export const worldYaw = (b: Base, r: number) => b.yaw + angleOf(r);
