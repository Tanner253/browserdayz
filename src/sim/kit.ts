// A KIT of building pieces, and a LAYOUT made of them. (2026-10-13: "you could use the fort kit to really make
// some intricate and special layouts. and we could completley replace the textures on them to give the pieces
// completely new looks for reuse in other places. these modules could really be something special.. as long as you
// knew how to use them properly.")
//
// A kit is one model of named pieces (progress/intake/CATALOGUE.md says how each is made: a straight wall has its
// origin at its outer foot corner, runs along +z, and has its outside toward -x). A layout is a list of pieces,
// each with a place, a turn, a size and, for a ruin, a tip and what has been broken out of it. This file is the
// part of that with no drawing in it: where a point of a piece ends up, what is cut away, and what stops a body.
// src/world/kit.ts makes the meshes from the same list. Nothing here is any one place's: the fort on the mountain
// is one layout (src/sim/castle.ts), and the next place is another.

export type V3 = [number, number, number];
export type Quat = [number, number, number, number];

/**
 * A region that has been broken out of whatever it touches: everything inside it is gone. It has no dent in it: it
 * is where so many flat sides all face inward (`planes`: [nx, ny, nz, d] each, a point being inside one when
 * n . p <= d). `mid` and `reach` are a ball that holds all of it, for telling quickly what it cannot touch.
 */
export interface Cut { planes: [number, number, number, number][]; mid: V3; reach: number }

/** One piece of a layout. All of it is said in the layout's own measure (metres; y up). */
export interface KitPiece {
  /** which piece of the kit: its name in the model */
  id: string;
  /** where its origin goes */
  at: V3;
  /** turned about the upright, radians: a straight wall then runs toward (sin, cos) of it, its outside on the right of that */
  turn?: number;
  /** tipped, for what has fallen or sunk: about its own x and then its own z, radians (before it is turned) */
  tilt?: [number, number];
  /** how big: 1 as the kit has it; one number, or one for each of its own x, y and z */
  scale?: number | V3;
  /** what is broken out of it */
  cut?: Cut[];
  /** false: it stops nothing (whoever lays it out has said what does, some other way) */
  body?: boolean;
  /** what it is, for whoever reads a list of what stops a body */
  name?: string;
}

/** What stops a body: a block (its middle, half its size along each of its own ways, how it is turned), or a shape drawn tight round some points. */
export type KitSolid = { t: 'box'; c: V3; h: V3; q: Quat; name: string } | { t: 'hull'; pts: number[]; name: string };

// ------------------------------------------------------------------ cuts

const ball = (pts: V3[]): { mid: V3; reach: number } => {
  const mid: V3 = [0, 1, 2].map((k) => pts.reduce((t, p) => t + p[k], 0) / pts.length) as V3;
  return { mid, reach: Math.max(...pts.map((p) => Math.hypot(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]))) };
};
/** A block cut out, its sides square to the layout. */
export function cutBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Cut {
  const pts: V3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) pts.push([x, y, z]);
  return { planes: [[1, 0, 0, x1], [-1, 0, 0, -x0], [0, 1, 0, y1], [0, -1, 0, -y0], [0, 0, 1, z1], [0, 0, -1, -z0]], ...ball(pts) };
}
/** A block cut out that is turned about the upright: its middle on the plan, half its length along the way it is turned to (as a wall runs: sin, cos) and half its width across that, and from how high to how high. */
export function cutTurned(cx: number, cz: number, turn: number, halfLong: number, halfWide: number, y0: number, y1: number): Cut {
  const s = Math.sin(turn), c = Math.cos(turn), pts: V3[] = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const y of [y0, y1]) pts.push([cx + s * halfLong * a + c * halfWide * b, y, cz + c * halfLong * a - s * halfWide * b]);
  const along = cx * s + cz * c, across = cx * c - cz * s;
  return { planes: [[s, 0, c, along + halfLong], [-s, 0, -c, halfLong - along], [c, 0, -s, across + halfWide], [-c, 0, s, halfWide - across], [0, 1, 0, y1], [0, -1, 0, -y0]], ...ball(pts) };
}
/** A round cut out, upright: a drum of so many flat sides. */
export function cutRound(cx: number, cz: number, r: number, y0: number, y1: number, sides = 14): Cut {
  const planes: Cut['planes'] = [[0, 1, 0, y1], [0, -1, 0, -y0]], pts: V3[] = [];
  for (let k = 0; k < sides; k++) {
    const a = ((k + 0.5) * 2 * Math.PI) / sides, nx = Math.cos(a), nz = Math.sin(a);
    planes.push([nx, 0, nz, cx * nx + cz * nz + r]);
    for (const y of [y0, y1]) pts.push([cx + nx * r * 1.05, y, cz + nz * r * 1.05]);
  }
  return { planes, ...ball(pts) };
}
/** A piece of the plan cut out, upright: its corners [x, z] in order round it (no dent in it), and from how high to how high. */
export function cutPoly(poly: [number, number][], y0: number, y1: number): Cut {
  const planes: Cut['planes'] = [[0, 1, 0, y1], [0, -1, 0, -y0]], pts: V3[] = [];
  const mx = poly.reduce((t, q) => t + q[0], 0) / poly.length, mz = poly.reduce((t, q) => t + q[1], 0) / poly.length;
  for (let k = 0; k < poly.length; k++) {
    const [ax, az] = poly[k], [bx, bz] = poly[(k + 1) % poly.length], l = Math.hypot(bx - ax, bz - az) || 1;
    let nx = (bz - az) / l, nz = (ax - bx) / l;
    // (each side faces away from the middle)
    if (nx * (mx - ax) + nz * (mz - az) > 0) [nx, nz] = [-nx, -nz];
    planes.push([nx, 0, nz, nx * ax + nz * az]);
    for (const y of [y0, y1]) pts.push([ax, y, az]);
  }
  return { planes, ...ball(pts) };
}
/** Whether a point is in what was cut out. */
export function inCut(c: Cut, p: V3): boolean {
  for (const [nx, ny, nz, d] of c.planes) if (nx * p[0] + ny * p[1] + nz * p[2] > d) return false;
  return true;
}

/**
 * What is left of a flat piece with corners (a triangle, to begin with) when a cut is taken out of it: so many flat
 * pieces, each with no dent in it. A corner is a row of numbers whose first three are where it is; the rest
 * (which way it faces, where it is on a picture) are carried along and worked out for each new corner.
 */
export function clipOut(poly: number[][], cut: Cut): number[][][] {
  const kept: number[][][] = [];
  let rest = poly;
  for (const [nx, ny, nz, d] of cut.planes) {
    if (rest.length < 3) break;
    const side = rest.map((v) => nx * v[0] + ny * v[1] + nz * v[2] - d), out: number[][] = [], into: number[][] = [];
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i], b = rest[(i + 1) % rest.length], sa = side[i], sb = side[(i + 1) % rest.length];
      (sa > 0 ? out : into).push(a);
      if (sa > 0 !== sb > 0) {
        const t = sa / (sa - sb), m = a.map((v, k) => v + (b[k] - v) * t);
        out.push(m);
        into.push(m);
      }
    }
    // (what is beyond this side is outside the cut whatever the other sides say: it is kept; the rest is asked of the next)
    if (out.length >= 3) kept.push(out);
    rest = into;
  }
  return kept;
}

// ------------------------------------------------------------------ faces laid back to back

/**
 * FACES LAID BACK TO BACK (2026-10-13: "there is overlapping textures on the walls of the castles"). A kit's piece
 * is put together of blocks that each have all their faces: a parapet is a block stood on the walk, and its
 * underside is drawn in the very plane of the walk's top, which runs on under it; the ring of wall round a tower's
 * platform lies on the platform the same way. The kit's stuff is drawn from both sides, so the two are one over the
 * other to the hair wherever either is seen, and they are seen wherever a ruin has broken the block off or open:
 * 170 m2 of the mountain fort flickered so. Of a piece's triangles, in the piece's own measure, one that faces
 * straight down and lies (within `near`) on one that faces straight up has what lies on it taken away. What it lay
 * on is left: it is what is seen from over it, and from under it too. A ceiling that is seen (a gate's passage, a
 * lintel) lies on nothing, and is not touched. ONLY for stuff that is drawn from both sides: of stuff drawn from one
 * side the two are never seen together, and the lower is all that is seen from under.
 *
 * @param pos the triangles' corners in the piece's own measure, nine numbers to a triangle
 * @returns for each triangle that loses anything, by its number: the flat pieces left of it (none: all of it lay
 *          on something), each corner said as how much of each of the triangle's own three corners it is
 */
export function backedOut(pos: ArrayLike<number>, near = 0.02): Map<number, V3[][]> {
  const n = Math.floor(pos.length / 9), ups = new Map<number, number[]>(), downs: number[] = [], out = new Map<number, V3[][]>();
  for (let t = 0; t < n; t++) {
    const o = t * 9, ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2], vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    const gy = uz * vx - ux * vz, l = Math.hypot(uy * vz - uz * vy, gy, ux * vy - uy * vx);
    if (l < 1e-10 || Math.abs(gy) < 0.9994 * l) continue;
    if (gy < 0) downs.push(t);
    else {
      const k = Math.round(pos[o + 1] / near);
      (ups.get(k) ?? ups.set(k, []).get(k)!).push(t);
    }
  }
  if (!ups.size) return out;
  const area = (poly: number[][]) => {
    let s = 0;
    for (let k = 1; k + 1 < poly.length; k++) s += (poly[k][0] - poly[0][0]) * (poly[k + 1][2] - poly[0][2]) - (poly[k + 1][0] - poly[0][0]) * (poly[k][2] - poly[0][2]);
    return Math.abs(s) / 2;
  };
  const longest = (poly: number[][]) => Math.max(...poly.map((v, k) => Math.hypot(poly[(k + 1) % poly.length][0] - v[0], poly[(k + 1) % poly.length][2] - v[2])));
  for (const t of downs) {
    const o = t * 9, y = pos[o + 1], at = Math.round(y / near);
    const x0 = Math.min(pos[o], pos[o + 3], pos[o + 6]), x1 = Math.max(pos[o], pos[o + 3], pos[o + 6]), z0 = Math.min(pos[o + 2], pos[o + 5], pos[o + 8]), z1 = Math.max(pos[o + 2], pos[o + 5], pos[o + 8]);
    let rest: number[][][] = [[[pos[o], y, pos[o + 2], 1, 0, 0], [pos[o + 3], pos[o + 4], pos[o + 5], 0, 1, 0], [pos[o + 6], pos[o + 7], pos[o + 8], 0, 0, 1]]], took = false;
    for (const u of [at - 1, at, at + 1].flatMap((k) => ups.get(k) ?? [])) {
      const p = u * 9;
      if (!rest.length) break;
      if (Math.abs(pos[p + 1] - y) > near) continue;
      if (Math.min(pos[p], pos[p + 3], pos[p + 6]) >= x1 || Math.max(pos[p], pos[p + 3], pos[p + 6]) <= x0 || Math.min(pos[p + 2], pos[p + 5], pos[p + 8]) >= z1 || Math.max(pos[p + 2], pos[p + 5], pos[p + 8]) <= z0) continue;
      // (the one it lies on, as a cut: upright through its three sides, each of them facing away from its third corner)
      const planes: Cut['planes'] = [];
      for (let e = 0; e < 3; e++) {
        const a = p + e * 3, b = p + ((e + 1) % 3) * 3, c = p + ((e + 2) % 3) * 3, len = Math.hypot(pos[b + 2] - pos[a + 2], pos[a] - pos[b]) || 1;
        let nx = (pos[b + 2] - pos[a + 2]) / len, nz = (pos[a] - pos[b]) / len;
        if (nx * (pos[c] - pos[a]) + nz * (pos[c + 2] - pos[a + 2]) > 0) [nx, nz] = [-nx, -nz];
        planes.push([nx, 0, nz, nx * pos[a] + nz * pos[a + 2]]);
      }
      const cut: Cut = { planes, mid: [0, 0, 0], reach: 0 }, next: number[][][] = [];
      for (const poly of rest) {
        // (one that takes nothing of it is not let cut it into pieces)
        const kept = clipOut(poly, cut);
        if (area(poly) - kept.reduce((s, q) => s + area(q), 0) < 1e-7) next.push(poly);
        else {
          took = true;
          next.push(...kept);
        }
      }
      rest = next;
    }
    // (what is left is kept, down to a strip a hair wide: that is the sums' own error, where two it lay on met under it)
    if (took) out.set(t, rest.filter((poly) => area(poly) > 1e-4 * longest(poly)).map((poly) => poly.map((v): V3 => [v[3], v[4], v[5]])));
  }
  return out;
}

/**
 * A PIECE'S TRIANGLES AS THEY ARE STOOD in a layout, less what of them lay back to back in the piece (`backs`: see
 * `backedOut`; null: nothing is taken) and less what the layout's cuts take out. Each corner that is left is handed
 * to `put`, three to a triangle. A corner is a row of numbers whose first three are where it is in the layout's
 * measure; the rest (which way it faces, where it is on a picture) are carried along and worked out for each new
 * corner. `index`: which corners each triangle has, three to a triangle (null: the corners in threes, as they come).
 * The one place this is done: whoever draws a layout and whoever counts what is drawn of it both ask here.
 */
export function standTriangles(corners: number[][], index: ArrayLike<number> | null, cuts: Cut[], backs: Map<number, V3[][]> | null, put: (corner: number[]) => void): void {
  const count = index ? index.length : corners.length;
  for (let t = 0; t + 2 < count; t += 3) {
    const a = corners[index ? index[t] : t], b = corners[index ? index[t + 1] : t + 1], c = corners[index ? index[t + 2] : t + 2], left = backs?.get(t / 3);
    let polys: number[][][] = left ? left.map((poly) => poly.map((w) => a.map((v, k) => v * w[0] + b[k] * w[1] + c[k] * w[2]))) : [[a, b, c]];
    if (cuts.length && polys.length) {
      // (only the cuts that could touch this triangle are tried on it)
      const mx = (a[0] + b[0] + c[0]) / 3, my = (a[1] + b[1] + c[1]) / 3, mz = (a[2] + b[2] + c[2]) / 3;
      const reach = Math.max(Math.hypot(a[0] - mx, a[1] - my, a[2] - mz), Math.hypot(b[0] - mx, b[1] - my, b[2] - mz), Math.hypot(c[0] - mx, c[1] - my, c[2] - mz));
      for (const cut of cuts) {
        if (Math.hypot(cut.mid[0] - mx, cut.mid[1] - my, cut.mid[2] - mz) > cut.reach + reach) continue;
        polys = polys.flatMap((poly) => clipOut(poly, cut));
      }
    }
    for (const poly of polys) for (let k = 1; k + 1 < poly.length; k++) {
      put(poly[0]);
      put(poly[k]);
      put(poly[k + 1]);
    }
  }
}

// ------------------------------------------------------------------ where a piece's points go

/** How a piece is stood: 16 numbers, a column at a time (as three.js has them). Its own measure is made bigger, tipped, turned and then moved, in that order. */
export function kitMatrix(p: KitPiece): number[] {
  const [sx, sy, sz] = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : p.scale ?? [1, 1, 1];
  const [tx, tz] = p.tilt ?? [0, 0], a = p.turn ?? 0;
  const cx = Math.cos(tx), sxn = Math.sin(tx), cz = Math.cos(tz), szn = Math.sin(tz), ca = Math.cos(a), sa = Math.sin(a);
  // (the upright turn, times the tip about x, times the tip about z)
  const rz = [[cz, -szn, 0], [szn, cz, 0], [0, 0, 1]], rx = [[1, 0, 0], [0, cx, -sxn], [0, sxn, cx]], ry = [[ca, 0, sa], [0, 1, 0], [-sa, 0, ca]];
  const mul = (m: number[][], n: number[][]) => m.map((row) => [0, 1, 2].map((k) => row[0] * n[0][k] + row[1] * n[1][k] + row[2] * n[2][k]));
  const r = mul(ry, mul(rx, rz));
  return [r[0][0] * sx, r[1][0] * sx, r[2][0] * sx, 0, r[0][1] * sy, r[1][1] * sy, r[2][1] * sy, 0, r[0][2] * sz, r[1][2] * sz, r[2][2] * sz, 0, p.at[0], p.at[1], p.at[2], 1];
}
/** A point of a piece, where the piece is stood. */
export const kitPoint = (m: number[], v: V3): V3 => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];

/** how a thing is turned whose own three ways lie along x, y and z (each of length one, square to each other) */
function quatOf(x: V3, y: V3, z: V3): Quat {
  const t = x[0] + y[1] + z[2];
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
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

// ------------------------------------------------------------------ what stops a body, piece by piece
//
// Measured off the pieces themselves (the fort kit: Poly Haven's "Modular Fort 01"), in each piece's own measure.
// A block is [x0, x1, y0, y1, z0, z1]. A wall's outer face leans in 0.94 m between its foot and its walk: its body
// is three blocks, each a third of the way up and set in as far as the face is there, so nothing drawn is further
// than a hand from what stops a body. Its parapet is a low wall 1.05 m thick, and each merlon a block on that.

type Block = [number, number, number, number, number, number];
/** the walk on a wall's top, the top of its parapet between merlons, and the top of a merlon */
export const KIT_LEVELS = { walk: 7.08, parapet: 7.76, merlon: 8.6 };
/** a merlon, and the gap after it, along a wall; where the first begins; and the parapet's faces across the wall */
export const KIT_MERLON = { from: 0.69, long: 2.33, every: 3.705, x0: 0.95, x1: 2.01 };
const body = (deep: number, long: number, z0 = 0): Block[] => [[0.16, deep, 0, 2.4, z0, long], [0.47, deep, 2.4, 4.8, z0, long], [0.78, deep, 4.8, KIT_LEVELS.walk, z0, long]];
const parapet = (long: number, merlons: number): Block[] => [
  [KIT_MERLON.x0, KIT_MERLON.x1, KIT_LEVELS.walk, KIT_LEVELS.parapet, 0, long],
  ...Array.from({ length: merlons }, (_, k): Block => [KIT_MERLON.x0, KIT_MERLON.x1, KIT_LEVELS.parapet, KIT_LEVELS.merlon, KIT_MERLON.from + k * KIT_MERLON.every, KIT_MERLON.from + k * KIT_MERLON.every + KIT_MERLON.long]),
];
/** the gate's opening, at its narrowest: from where to where along the piece, where its arch springs and how high its crown is; and the sill across it */
export const KIT_GATE = { z0: 1.95, z1: 5.46, spring: 4.3, crown: 6.02, sill: 0.26 };
const BLOCKS: Record<string, Block[]> = {
  fort_wall_thin_straight_01: [...body(2.55, 14.82), ...parapet(14.82, 4)],
  fort_wall_thin_straight_02: [...body(2.55, 14.82), ...parapet(14.82, 4)],
  fort_wall_thin_straight_03: [...body(2.55, 7.41), ...parapet(7.41, 0)],
  fort_wall_thin_straight_04: [...body(2.55, 7.41), ...parapet(7.41, 2)],
  fort_wall_thick_straight_01: [...body(4.17, 14.56), ...parapet(14.56, 4)],
  fort_wall_thick_end_01: [...body(4.17, 4.85), [KIT_MERLON.x0, KIT_MERLON.x1, KIT_LEVELS.walk, KIT_LEVELS.parapet, 0, 4.85]],
  fort_wall_thick_end_02: [...body(4.17, 4.85), ...parapet(4.85, 1)],
  fort_wall_walkway_straight_02: [[0, 3.12, 0, KIT_LEVELS.walk, 0, 14.56]],
  fort_wall_walkway_end_01: [[0, 3.12, 0, KIT_LEVELS.walk, 0, 4.85]],
  // (the gate: a jamb either side of its opening, the wall over its arch in three steps, its sill)
  fort_wall_thin_gate_01: [
    ...body(2.55, KIT_GATE.z0), ...body(2.55, 7.41, KIT_GATE.z1),
    [0.6, 2.55, KIT_GATE.crown - 0.1, KIT_LEVELS.walk, KIT_GATE.z0, KIT_GATE.z1], [0.5, 2.55, 5.3, KIT_GATE.crown, KIT_GATE.z0, KIT_GATE.z0 + 0.75], [0.5, 2.55, 5.3, KIT_GATE.crown, KIT_GATE.z1 - 0.75, KIT_GATE.z1],
    [0.5, 2.55, KIT_GATE.spring + 0.2, 5.3, KIT_GATE.z0, KIT_GATE.z0 + 0.3], [0.5, 2.55, KIT_GATE.spring + 0.2, 5.3, KIT_GATE.z1 - 0.3, KIT_GATE.z1],
    [0.03, 2.51, 0, KIT_GATE.sill, KIT_GATE.z0, KIT_GATE.z1], ...parapet(7.41, 2),
  ],
};
/** the round tower: how far out its face is at its foot, two metres up, and at its platform; its platform; and the ring of wall round that */
export const KIT_TOWER = { foot: 7.93, waist: [2, 7.33] as [number, number], top: [11.5, 6.36] as [number, number], ring: { r0: 4.76, r1: 6.3, y: 12.75 } };

/** What a piece is in its own measure, where there is a block for it: how far it reaches. (For a far stand-in, and for knowing a piece is known.) */
export function kitBlocks(id: string): Block[] | null {
  return BLOCKS[id] ?? null;
}

/**
 * What stops a body for a layout: each piece's blocks, stood where the piece is; and where something has been cut
 * out of a piece, its blocks are cut into squares of about `cell` and what is left of them put together again. A
 * piece with no blocks said for it stops nothing (the round tower is a shape drawn round it; a cut does not
 * touch that: whoever cuts a tower says what stops a body there).
 */
export function kitSolids(layout: KitPiece[], cell = 0.5): KitSolid[] {
  const out: KitSolid[] = [];
  for (const p of layout) {
    if (p.body === false) continue;
    const m = kitMatrix(p), name = p.name ?? p.id, scale = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : p.scale ?? [1, 1, 1];
    const axes: V3[] = [0, 1, 2].map((k) => [m[k * 4] / scale[k], m[k * 4 + 1] / scale[k], m[k * 4 + 2] / scale[k]] as V3), q = quatOf(axes[0], axes[1], axes[2]);
    const put = (b: Block) => {
      const c = kitPoint(m, [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2]), h: V3 = [((b[1] - b[0]) / 2) * scale[0], ((b[3] - b[2]) / 2) * scale[1], ((b[5] - b[4]) / 2) * scale[2]];
      if (h[0] > 0.005 && h[1] > 0.005 && h[2] > 0.005) out.push({ t: 'box', c, h, q, name });
    };
    if (p.id === 'fort_tower_round') {
      const pts: number[] = [], T = KIT_TOWER;
      for (const [y, r] of [[0, T.foot], T.waist, T.top] as [number, number][]) for (let k = 0; k < 16; k++) pts.push(...kitPoint(m, [(Math.cos(k * 0.3927) * r) / Math.cos(0.19635), y, (Math.sin(k * 0.3927) * r) / Math.cos(0.19635)]));
      out.push({ t: 'hull', pts, name });
      continue;
    }
    for (const b of BLOCKS[p.id] ?? []) {
      const c = kitPoint(m, [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2]), reach = Math.hypot((b[1] - b[0]) * scale[0], (b[3] - b[2]) * scale[1], (b[5] - b[4]) * scale[2]) / 2;
      const cuts = (p.cut ?? []).filter((k) => Math.hypot(k.mid[0] - c[0], k.mid[1] - c[1], k.mid[2] - c[2]) < k.reach + reach);
      if (!cuts.length) {
        put(b);
        continue;
      }
      // in squares: which of them are still there; then put together again, a run at a time
      const n = [0, 1, 2].map((k) => Math.max(1, Math.ceil(((b[k * 2 + 1] - b[k * 2]) * scale[k]) / cell))), at = (k: number, i: number) => b[k * 2] + ((b[k * 2 + 1] - b[k * 2]) * i) / n[k];
      const there = new Uint8Array(n[0] * n[1] * n[2]), ix = (i: number, j: number, l: number) => (i * n[1] + j) * n[2] + l;
      for (let i = 0; i < n[0]; i++) for (let j = 0; j < n[1]; j++) for (let l = 0; l < n[2]; l++) {
        const w = kitPoint(m, [at(0, i + 0.5), at(1, j + 0.5), at(2, l + 0.5)]);
        there[ix(i, j, l)] = cuts.some((k) => inCut(k, w)) ? 0 : 1;
      }
      for (let i = 0; i < n[0]; i++) for (let j = 0; j < n[1]; j++) for (let l = 0; l < n[2]; l++) {
        if (!there[ix(i, j, l)]) continue;
        let l1 = l + 1, j1 = j + 1, i1 = i + 1;
        while (l1 < n[2] && there[ix(i, j, l1)]) l1++;
        const row = (ii: number, jj: number) => { for (let k = l; k < l1; k++) if (!there[ix(ii, jj, k)]) return false; return true; };
        while (j1 < n[1] && row(i, j1)) j1++;
        const slab = (ii: number) => { for (let k = j; k < j1; k++) if (!row(ii, k)) return false; return true; };
        while (i1 < n[0] && slab(i1)) i1++;
        for (let a = i; a < i1; a++) for (let c2 = j; c2 < j1; c2++) for (let e = l; e < l1; e++) there[ix(a, c2, e)] = 0;
        put([at(0, i), at(0, i1), at(1, j), at(1, j1), at(2, l), at(2, l1)]);
      }
    }
  }
  return out;
}
