// Doors, hatches, shutters and gates as they swing (2026-10-24, base building's fourth step). The owner: "airlock
// mechanics like rust has doors that swing open 1 way with collision". Plan v2, approved: "A door swings one way, set
// when it is hung: R flips it"; "Solid as it swings: it stops on a body and goes back; it never shuts on anyone, never
// passes through". The server will not swing a leaf through where anybody stands (`inTheWay`); the game holds a leaf
// where it meets its own player's body. What a leaf is made of is src/sim/build/solids.ts.

import { angleOf, type Base, type Piece } from './snap';
import { shapeOf, type Leaf, type Solid } from './solids';

export const DOOR = {
  /** how near a door's middle a player opens it, m */
  reach: 3,
  /** seconds a leaf takes to swing all the way */
  swing: 0.55,
  /** the least time between two swings of one door, ms (a door is not drummed open and shut) */
  again: 400,
  /** a body, as the swing is tested against it: its round, and its height from the feet */
  body: 0.32,
  tall: 1.85,
};

type V3 = [number, number, number];

/** a point of a leaf's own frame, turned `a` radians about its hinge, in its piece's frame */
export function leafPoint(l: Leaf, a: number, p: V3): V3 {
  const c = Math.cos(a), s = Math.sin(a);
  // (three.js's turns: about y, +x goes to -z for a positive angle; about x, +y goes to +z)
  const q: V3 = l.axis === 'y' ? [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c] : [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
  return [q[0] + l.hinge[0], q[1] + l.hinge[1], q[2] + l.hinge[2]];
}

/** a point of a piece's frame in its base's frame */
export function inBase(p: Piece, q: V3): V3 {
  const a = angleOf(p.r), c = Math.cos(a), s = Math.sin(a);
  return [p.x + q[0] * c + q[2] * s, p.y + q[1], p.z - q[0] * s + q[2] * c];
}

/** a box's corners and middle (what a leaf is sampled by) */
function samples(s: Solid): V3[] {
  if (!('box' in s)) return [];
  const [cx, cy, cz, sx, sy, sz] = s.box, out: V3[] = [];
  // (along its length and up its height, on its middle plane: a leaf is thin)
  const long = sx >= sz;
  for (const u of [-0.5, -0.17, 0.17, 0.5]) for (const v of [-0.5, 0, 0.5]) out.push(long ? [cx + u * sx, cy + v * sy, cz] : [cx, cy + v * sy, cz + u * sz]);
  return out;
}

/** where a piece's leaves pass between shut and open, in its base's frame: points enough to find a body in the way */
export function swept(p: Piece, steps = 8): V3[] {
  const out: V3[] = [];
  for (const l of shapeOf(p.k).leaves ?? []) {
    const pts = l.solid.flatMap(samples);
    for (let i = 0; i <= steps; i++) for (const q of pts) out.push(inBase(p, leafPoint(l, (l.open * i) / steps, q)));
  }
  return out;
}

/** whether a body standing at `feet` (in the base's frame) is where any of these points are */
export function struck(pts: V3[], feet: { x: number; y: number; z: number }) {
  return pts.some(([x, y, z]) => y > feet.y - 0.05 && y < feet.y + DOOR.tall && Math.hypot(x - feet.x, z - feet.z) < DOOR.body);
}

/** whether anybody (their feet in the base's frame) stands where a piece's leaves swing */
export function inTheWay(p: Piece, feet: { x: number; y: number; z: number }[]) {
  if (!feet.length) return false;
  const pts = swept(p);
  return feet.some((f) => struck(pts, f));
}

/** a piece's leaves' middle, in its base's frame (what is reached for) */
export function middleOf(p: Piece): V3 {
  const ls = shapeOf(p.k).leaves ?? [];
  if (!ls.length) return [p.x, p.y + 1, p.z];
  const all = ls.flatMap((l) => l.solid.flatMap(samples).map((q) => leafPoint(l, 0, q)));
  const m: V3 = [0, 0, 0];
  for (const q of all) for (let i = 0; i < 3; i++) m[i] += q[i] / all.length;
  return inBase(p, m);
}

/** whether a kind swings */
export const swings = (kind: string) => !!shapeOf(kind).leaves?.length;

/** the doors of a base (a test's, a save's) */
export const doorsOf = (b: Base) => [...b.pieces.values()].filter((p) => swings(p.k));
