// What each piece is made of, as solids in its own frame (2026-10-24): boxes, upright prisms and a few hulls, the same
// list drawn by the game (src/game/building/draw.ts) and made into what stops a body and a bullet. Its frame: +z is
// the way it faces (a wall's outside), +x along it, y up from its foot (a floor-like piece: down from its top).
// Built cheap by design: a wall is one box, a doorway three.

import { CELL, FLOOR_T, FOUND, PIECES, STOREY, WALL_T } from './pieces';

export type Solid =
  /** a box: its middle and its size */
  | { box: [number, number, number, number, number, number] }
  /** an upright prism: its outline on the ground (x, z) from y0 to y1 */
  | { prism: [number, number][]; y0: number; y1: number }
  /** the hull of these points */
  | { hull: [number, number, number][] };

export interface Shape {
  /** what stops a body and a bullet, and is drawn */
  solid: Solid[];
  /** drawn, and stops nothing (a foundation's posts into the ground, a high wall's sharpened tops) */
  dress?: Solid[];
}

const H = CELL / 2;
/** a wall's length: a hand past its edge each end, so that two meeting at a corner close it */
const LONG = CELL + WALL_T;
const TRI = (y0: number, y1: number, shrink = 0): Solid => {
  const R = CELL / Math.sqrt(3) - shrink;
  return { prism: [2, 6, 10].map((a) => [Math.sin((a * Math.PI) / 6) * R, Math.cos((a * Math.PI) / 6) * R]), y0, y1 };
};
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Solid => ({ box: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0] });
const wallBox = (x0: number, y0: number, x1: number, y1: number) => box(x0, y0, -WALL_T / 2, x1, y1, WALL_T / 2);

/** steps of a flight: `n` of them over [a, b] along one way, rising from `y0` to `y1`, each solid to the floor */
function flight(n: number, across: [number, number], along: [number, number], y0: number, y1: number, alongX: boolean): Solid[] {
  const out: Solid[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = along[0] + ((along[1] - along[0]) * i) / n, t1 = along[0] + ((along[1] - along[0]) * (i + 1)) / n;
    const top = y0 + ((y1 - y0) * (i + 1)) / n;
    const [a0, a1] = [Math.min(t0, t1), Math.max(t0, t1)];
    out.push(alongX ? box(a0, 0, across[0], a1, top, across[1]) : box(across[0], 0, a0, across[1], top, a1));
  }
  return out;
}

const SHAPES: Record<string, () => Shape> = {
  foundation: () => ({
    solid: [box(-H, -FOUND.deep, -H, H, 0, H)],
    dress: [-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(sx * (H - 0.28), -FOUND.deep - FOUND.posts, sz * (H - 0.28), sx * (H - 0.08), -FOUND.deep, sz * (H - 0.08)))),
  }),
  foundation_tri: () => ({ solid: [TRI(-FOUND.deep, 0)], dress: [2, 6, 10].map((a) => { const R = CELL / Math.sqrt(3) - 0.35, x = Math.sin((a * Math.PI) / 6) * R, z = Math.cos((a * Math.PI) / 6) * R; return box(x - 0.1, -FOUND.deep - FOUND.posts, z - 0.1, x + 0.1, -FOUND.deep, z + 0.1); }) }),
  // (against a foundation's edge: its back at the edge, going down away from it)
  foundation_steps: () => ({ solid: [0, 1, 2].map((i) => box(-H, -0.2 * (i + 1) - 1.2, -0.75 + i * 0.5, H, -0.2 * (i + 1) + 0.0, -0.25 + i * 0.5)) }),
  ramp: () => ({ solid: [{ hull: [[-H, 0, -H], [H, 0, -H], [-H, -1.2, -H], [H, -1.2, -H], [-H, -1.2, H], [H, -1.2, H]] }] }),
  wall: () => ({ solid: [wallBox(-LONG / 2, 0, LONG / 2, STOREY)] }),
  wall_half: () => ({ solid: [wallBox(-LONG / 2, 0, LONG / 2, STOREY / 2)] }),
  wall_low: () => ({ solid: [wallBox(-LONG / 2, 0, LONG / 2, 1)] }),
  // (an opening a metre wide and 2.2 m high: a door is hung in it, step four)
  doorway: () => ({ solid: [wallBox(-LONG / 2, 0, -0.5, STOREY), wallBox(0.5, 0, LONG / 2, STOREY), wallBox(-0.5, 2.2, 0.5, STOREY)] }),
  // (a window 1.2 m across, from 1.1 m to 2.1 m: shutters or bars go in it)
  window: () => ({ solid: [wallBox(-LONG / 2, 0, LONG / 2, 1.1), wallBox(-LONG / 2, 2.1, LONG / 2, STOREY), wallBox(-LONG / 2, 1.1, -0.6, 2.1), wallBox(0.6, 1.1, LONG / 2, 2.1)] }),
  // (an opening 2.4 m across and 2.6 m high: double doors or a garage door)
  wall_frame: () => ({ solid: [wallBox(-LONG / 2, 0, -1.2, STOREY), wallBox(1.2, 0, LONG / 2, STOREY), wallBox(-1.2, 2.6, 1.2, STOREY)] }),
  floor: () => ({ solid: [box(-H, -FLOOR_T, -H, H, 0, H)] }),
  floor_tri: () => ({ solid: [TRI(-FLOOR_T, 0)] }),
  // (a hole 1.4 m square: a ladder hatch goes in it)
  floor_frame: () => ({ solid: [box(-H, -FLOOR_T, -H, H, 0, -0.7), box(-H, -FLOOR_T, 0.7, H, 0, H), box(-H, -FLOOR_T, -0.7, -0.7, 0, 0.7), box(0.7, -FLOOR_T, -0.7, H, 0, 0.7)] }),
  floor_frame_tri: () => {
    const R = CELL / Math.sqrt(3), r = R * 0.42, at = (a: number, d: number): [number, number] => [Math.sin((a * Math.PI) / 6) * d, Math.cos((a * Math.PI) / 6) * d];
    return { solid: [[2, 6], [6, 10], [10, 2]].map(([a, b]) => ({ prism: [at(a, R), at(b, R), at(b, r), at(a, r)], y0: -FLOOR_T, y1: 0 })) };
  },
  // (up the -x side away from +z, a landing in the far corner, along the far side to +x: it comes out on the floor above at +x)
  stairs_l: () => ({ solid: [...flight(6, [-H, -0.3], [H, -0.3], 0, STOREY / 2, false), box(-H, 0, -H, -0.3, STOREY / 2, -0.3), ...flight(6, [-H, -0.3], [-0.3, H], STOREY / 2, STOREY, true)] }),
  // (up the +x side toward -z, across a landing the whole width, back down the -x side toward +z, rising)
  stairs_u: () => ({ solid: [...flight(5, [0.3, H], [H, 0], 0, STOREY / 2, false), box(-H, 0, -H, H, STOREY / 2, 0), ...flight(5, [-H, -0.3], [0, H], STOREY / 2, STOREY, false)] }),
  stairs_spiral: () => {
    const out: Solid[] = [box(-0.15, 0, -0.15, 0.15, STOREY, 0.15)];
    for (let i = 0; i < 12; i++) {
      const a0 = (i * Math.PI) / 6, a1 = a0 + Math.PI / 6 + 0.02, R = 1.45, y = (STOREY * (i + 1)) / 12;
      out.push({ prism: [[0, 0], [Math.sin(a0) * R, Math.cos(a0) * R], [Math.sin(a1) * R, Math.cos(a1) * R]], y0: y - 0.14, y1: y });
    }
    return { solid: out };
  },
  // (a slope from its front edge up to its back: turned, four of them make a hipped roof)
  roof: () => ({ solid: [{ hull: [[-H, -FLOOR_T, H], [H, -FLOOR_T, H], [-H, -FLOOR_T, -H], [H, -FLOOR_T, -H], [-H, 1.5, -H], [H, 1.5, -H]] }] }),
  roof_tri: () => {
    const R = CELL / Math.sqrt(3), c = [2, 6, 10].map((a): [number, number, number] => [Math.sin((a * Math.PI) / 6) * R, -FLOOR_T, Math.cos((a * Math.PI) / 6) * R]);
    return { solid: [{ hull: [...c, [0, 1.3, 0]] }] };
  },
  // (sharpened logs, six to a length, and the rail that holds them)
  high_wall_wood: () => ({
    solid: [box(-H, 0, -0.25, H, 6, 0.25)],
    dress: Array.from({ length: 6 }, (_, i) => ({ hull: [[-H + i * 0.5 + 0.02, 6, -0.23], [-H + i * 0.5 + 0.48, 6, -0.23], [-H + i * 0.5 + 0.02, 6, 0.23], [-H + i * 0.5 + 0.48, 6, 0.23], [-H + i * 0.5 + 0.25, 6.6, 0]] as [number, number, number][] })),
  }),
  high_wall_stone: () => ({ solid: [box(-H, 0, -0.4, H, 6, 0.4), box(-H - 0.05, 6, -0.45, H + 0.05, 6.25, 0.45)] }),
};

const made = new Map<string, Shape>();
/** a piece's solids */
export function shapeOf(kind: string): Shape {
  let s = made.get(kind);
  if (!s) made.set(kind, (s = SHAPES[kind]()));
  return s;
}

/** every kind has its shape (a test's word) */
export const SHAPED = () => Object.keys(PIECES).every((k) => !!SHAPES[k]);
