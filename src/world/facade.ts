// Facades of the downloaded modular kits laid over the game's own buildings (2026-10-16, the new land's towns). The
// owner: "we have tons of unused assets in src that could be put to use"; and of the towns: "do not make boring
// houses". A kit (Poly Haven's factory and apartments facades, CC0) is a set of 3 m by 3 m wall panels, each with its
// hole and the frame that goes in it, and the bands that run along a face. The building under it is a blueprint as
// any other (its rooms, floors, stairs, doors, glass and what stops a body are the game's own): this says, from one
// line of letters a floor, where the blueprint's openings are AND which panels are laid over its outside, so the
// two always agree. Nothing here draws; the pieces are drawn by src/world/towns.ts (kitMeshes), never by the server.
//
// A panel's own frame (the kit's): it runs from x -3 to 0, its face at z 0, its outside toward +z, its foot at y 0.

import type { KitPiece } from '../sim/kit';
import { cutBox } from '../sim/kit';
import type { Opening, WallDef, MatKey } from './buildings';

export type FacadeKit = 'factory_kit' | 'flats_kit';
type Side = 'front' | 'back' | 'left' | 'right';

/**
 * One building's facade. `bays`: how many 3 m bays along x (front and back) and along z (left and right). Each side
 * has a line of letters a floor, the ground first, one letter a bay, read from left to right as the side is SEEN FROM
 * OUTSIDE. A garage two or three bays wide is its letter and then '-' for each further bay it takes.
 *   factory: . wall, w window, m middling window, s small window, d double window, t tall arched window, n narrow
 *            tall window, D door, R small recessed door, x loading door with a window over it, G garage open, C
 *            garage shut (its shutter down), H great garage three bays wide, open
 *   flats:   . wall, w window, s small window, d double window, D door, S small door, x French window
 */
export interface FacadeSpec {
  kit: FacadeKit;
  bays: [number, number];
  floors: number;
  sides: Record<Side, string[]>;
  /** how high the wall stands over the roof, round its edge (the deck's parapet): cover for whoever is up there */
  parapet: number;
  /** the bays (counted from the left, from outside) where the parapet is open, for the stairs outside to come onto the roof */
  gaps?: Partial<Record<Side, number[]>>;
}

/** how far the panels stand out from the blueprint's own outer face (so the two never fight to be seen) */
const OUT = 0.03;
/** a storey: 2.8 of wall and the 0.2 of floor over it, the kit's 3 m */
export const STOREY = 3, STOREY_H = 2.8;

interface Bay { wall: string; frame?: string; open?: Omit<Opening, 'a' | 'b'> & { a: number; b: number }; span: number }
/** a frame's hole, along the bay from its left end as seen from outside (0 to 3), and its height */
const hole = (a: number, b: number, bottom: number, top: number, kind: Opening['kind']) => ({ a, b, bottom, top, kind });

// (the holes are the frames' own boxes, said from the bay's left end: a frame at x -2.61..-0.39 of a panel that runs -3..0 is 0.39..2.61 from its left)
const BAYS: Record<FacadeKit, Record<string, Bay>> = {
  factory_kit: {
    '.': { wall: 'wall_standard_standard_01', span: 1 },
    w: { wall: 'wall_window_centered_large_01', frame: 'window_centered_large_01', open: hole(0.42, 2.58, 0.62, 2.3, 'window'), span: 1 },
    m: { wall: 'wall_window_centered_medium_01', frame: 'window_centered_medium_01', open: hole(0.75, 2.25, 0.62, 2.3, 'window'), span: 1 },
    s: { wall: 'wall_window_centered_small_01', frame: 'window_centered_small_01', open: hole(1.08, 1.93, 0.62, 2.3, 'window'), span: 1 },
    d: { wall: 'wall_window_centered_double_01', frame: 'window_centered_double_01', open: hole(0.33, 2.67, 0.62, 2.3, 'window'), span: 1 },
    t: { wall: 'wall_window_tall_large_01', frame: 'window_tall_large_01', open: hole(0.11, 2.89, 1.0, 2.95, 'window'), span: 1 },
    n: { wall: 'wall_window_tall_small_01', frame: 'window_tall_small_01', open: hole(0.51, 2.49, 1.0, 2.95, 'window'), span: 1 },
    D: { wall: 'wall_door_centered_large_01', open: hole(0.62, 2.38, 0, 2.3, 'door'), span: 1 },
    R: { wall: 'wall_door_recessed_small_01', open: hole(0.86, 2.14, 0, 2.7, 'door'), span: 1 },
    x: { wall: 'wall_door_window_small_01', frame: 'door_window_small_01', open: hole(0.15, 2.69, 0.0, 2.3, 'window'), span: 1 },
    G: { wall: 'wall_door_garage_door_01', open: hole(0.36, 5.64, 0, 2.72, 'gap'), span: 2 },
    C: { wall: 'wall_door_garage_door_01', frame: 'door_garage_door_01', span: 2 },
    H: { wall: 'wall_door_garage_double_01', open: hole(0.86, 8.14, 0, 2.72, 'gap'), span: 3 },
  },
  flats_kit: {
    '.': { wall: 'wall_standard_standard_01', span: 1 },
    w: { wall: 'wall_window_centered_large_01', frame: 'window_centered_large_01', open: hole(0.46, 2.54, 0.85, 2.28, 'window'), span: 1 },
    s: { wall: 'wall_window_centered_small_01', frame: 'window_centered_small_01', open: hole(0.96, 2.04, 0.85, 2.28, 'window'), span: 1 },
    d: { wall: 'wall_window_centered_double_01', frame: 'window_centered_double_01', open: hole(0.21, 2.79, 0.85, 2.28, 'window'), span: 1 },
    D: { wall: 'wall_door_centered_large_01', open: hole(0.48, 2.52, 0, 2.6, 'door'), span: 1 },
    S: { wall: 'wall_door_centered_small_01', open: hole(0.78, 2.22, 0, 2.6, 'door'), span: 1 },
    x: { wall: 'wall_door_window_small_01', frame: 'door_window_small_01', open: hole(0.21, 2.79, 0.0, 2.28, 'window'), span: 1 },
  },
};
/** the bands: along the foot, at every floor between two, and the cap on the parapet; and how high each stands */
const BANDS: Record<FacadeKit, { foot: string; floor: string; crown: string; crownH: number }> = {
  factory_kit: { foot: 'base_standard_standard_01', floor: 'cornice02_standard_standard_01', crown: 'crown_standard_standard_01', crownH: 0.32 },
  flats_kit: { foot: 'base_standard_01', floor: 'cornice_standard_standard_01', crown: 'crown_standard_standard_01', crownH: 0.75 },
};

/** The side's length along its own way, its bays' count, and how a bay's left end (from outside) maps to the blueprint's wall axis. */
function sideFrame(s: FacadeSpec, side: Side) {
  const [nx, nz] = s.bays, hw = (nx * STOREY) / 2, hd = (nz * STOREY) / 2;
  const n = side === 'front' || side === 'back' ? nx : nz;
  // (seen from outside: the front's left is -x, the back's left +x, the right side's left +z, the left side's left -z)
  const sign = side === 'front' || side === 'left' ? 1 : -1;
  const axis = (along: number) => sign * (along - (n * STOREY) / 2);
  return { n, hw, hd, axis };
}

function rowOf(s: FacadeSpec, side: Side, floor: number): { at: number; bay: Bay; key: string }[] {
  const line = s.sides[side][floor] ?? '';
  const { n } = sideFrame(s, side), out: { at: number; bay: Bay; key: string }[] = [];
  if (line.length !== n) throw new Error(`facade: ${side} floor ${floor} has ${line.length} bays, wants ${n}`);
  for (let i = 0; i < n; i++) {
    const key = line[i];
    if (key === '-') continue;
    const bay = BAYS[s.kit][key];
    if (!bay) throw new Error(`facade: no bay "${key}" in ${s.kit}`);
    out.push({ at: i * STOREY, bay, key });
  }
  return out;
}

/** The blueprint's openings in one side on one floor, on the wall's own axis (as Opening.a and .b are said). */
export function facadeOpenings(s: FacadeSpec, side: Side, floor: number): Opening[] {
  const { axis } = sideFrame(s, side);
  const out: Opening[] = [];
  for (const { at, bay } of rowOf(s, side, floor)) {
    if (!bay.open) continue;
    const p = axis(at + bay.open.a), q = axis(at + bay.open.b);
    out.push({ a: Math.min(p, q), b: Math.max(p, q), bottom: bay.open.bottom, top: bay.open.top, kind: bay.open.kind });
  }
  return out;
}

/** The four outer walls of one floor, with their openings. */
export function facadeWalls(s: FacadeSpec, floor: number, ext: MatKey, int: MatKey): WallDef[] {
  return (['front', 'back', 'left', 'right'] as const).map((side) => ({ side, ext, int, openings: facadeOpenings(s, side, floor) }));
}

/**
 * The pieces laid over the building's outside, in its own frame (its floor at y 0): the panels and frames of every
 * floor, a band at the foot and between floors, and over the roof a strip of wall to the parapet's height under the
 * crown. `frames: false` leaves the frames out (the far copy: from far off a window is its hole and its glass).
 */
export function facadePieces(s: FacadeSpec, frames = true): KitPiece[] {
  const out: KitPiece[] = [], B = BANDS[s.kit];
  const roof = s.floors * STOREY;
  for (const side of ['front', 'back', 'left', 'right'] as const) {
    const { n, hw, hd } = sideFrame(s, side);
    const len = n * STOREY;
    // a panel whose left end (from outside) is `along` from the side's left end, its foot at y: where its origin
    // (its right end) goes, and its turn (the outside of the panel, +z, out of the side)
    const place = (along: number, span: number, y: number): { at: [number, number, number]; turn: number } => {
      const r = along + span * STOREY; // (its right end, from the side's left end)
      if (side === 'front') return { at: [-hw + r, y, hd + OUT], turn: 0 };
      if (side === 'back') return { at: [hw - r, y, -hd - OUT], turn: Math.PI };
      if (side === 'right') return { at: [hw + OUT, y, hd - r], turn: Math.PI / 2 };
      return { at: [-hw - OUT, y, -hd + r], turn: -Math.PI / 2 };
    };
    for (let f = 0; f < s.floors; f++) {
      for (const { at, bay } of rowOf(s, side, f)) {
        const p = place(at, bay.span, f * STOREY);
        out.push({ id: bay.wall, ...p, body: false });
        if (frames && bay.frame) out.push({ id: bay.frame, ...p, body: false });
      }
    }
    // the bands, a bay at a time: at the foot (sunk to stand on the ground under the floor), between floors, and the crown
    const doors = new Set(rowOf(s, side, 0).flatMap(({ at, bay }) => (bay.open?.kind === 'door' || bay.open?.kind === 'gap' || bay.frame === 'door_garage_door_01' ? Array.from({ length: bay.span }, (_, k) => at + k * STOREY) : [])));
    for (let a = 0; a < len - 0.01; a += STOREY) {
      if (!doors.has(a)) out.push({ id: B.foot, ...place(a, 1, -0.45), body: false });
      for (let f = 1; f < s.floors; f++) out.push({ id: B.floor, ...place(a, 1, f * STOREY - 0.08), body: false });
      if (s.gaps?.[side]?.includes(Math.round(a / STOREY))) continue;
      // (the strip over the roof: a plain panel stood so its top meets the crown, all of it under the roof cut away)
      const strip = place(a, 1, roof + s.parapet - B.crownH - STOREY);
      out.push({ id: BAYS[s.kit]['.'].wall, ...strip, body: false, cut: [cutBox(-1e3, 1e3, -1e3, roof, -1e3, 1e3)] });
      out.push({ id: B.crown, ...place(a, 1, roof + s.parapet - B.crownH), body: false });
    }
  }
  return out;
}

/** Pieces said in a building's own frame, moved to where it stands (its floor at y, turned `rot` as buildings are), their cuts with them. */
export function movePieces(list: KitPiece[], x: number, y: number, z: number, rot: number): KitPiece[] {
  const c = Math.cos(rot), s = Math.sin(rot);
  // (as a building is turned: its +z toward (sin, cos), its +x toward (cos, -sin))
  const to = (p: [number, number, number]): [number, number, number] => [x + p[0] * c + p[2] * s, y + p[1], z - p[0] * s + p[2] * c];
  const dir = (n: number[]) => [n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c];
  return list.map((p) => ({
    ...p,
    at: to(p.at),
    turn: (p.turn ?? 0) + rot,
    ...(p.cut ? {
      cut: p.cut.map((k) => ({
        ...k,
        mid: to(k.mid),
        planes: k.planes.map(([nx, ny, nz, d]) => {
          const [mx, my, mz] = dir([nx, ny, nz]);
          return [mx, my, mz, d + mx * x + my * y + mz * z] as [number, number, number, number];
        }),
      })),
    } : {}),
  }));
}

/** How big the building is on the ground: the blueprint's w and d. */
export const facadeSize = (s: FacadeSpec): [number, number] => [s.bays[0] * STOREY, s.bays[1] * STOREY];
