// What a base is built of (2026-10-24, base building's second step; plan v2, approved by the owner with "think like
// rust how does rust do it"): Rust's set of pieces, each in four tiers, frame to metal. The owner: "do we offer enough
// base pieces for players to make their own dynamic bases?"; "building a base should be a rewarding time involved
// process". A piece is laid as a frame with the building plan and nailed up a tier at a time with the hammer; any tier
// may be skipped (Rust's way), and each tier costs what it costs whichever it was before.
//
// Sizes: a cell is 3 m across, a storey 3 m high (Rust's). Every piece of a base is placed in the base's own frame,
// turned in steps of 30 degrees (src/sim/build/snap.ts).

export const CELL = 3;
export const STOREY = 3;
/** a foundation's slab: how far it stands above its highest ground, and how deep the slab is */
export const FOUND = { lift: 0.25, deep: 0.6, posts: 2.5 };
/** a floor's thickness, under the level it makes */
export const FLOOR_T = 0.2;
export const WALL_T = 0.2;

export type Tier = 0 | 1 | 2 | 3;
export const TIERS = ['Frame', 'Wood', 'Stone', 'Metal'] as const;
/** health by tier, and the seconds the hammer takes to bring a piece up to it (a frame is laid with the plan) */
export const TIER_HP = [60, 500, 1000, 2000];
export const TIER_S = [1, 5, 8, 12];
/** what a full piece costs at each tier, of the materials (src/sim/items/build.ts) */
const TIER_COST: Record<string, number>[] = [{ planks: 4 }, { planks: 10, nails: 12 }, { stone: 30 }, { sheet_metal: 4, nails: 24 }];

/**
 * What a piece is to the snapping (src/sim/build/snap.ts):
 *   floor  a floor-like piece with an outline: laid edge to edge, or on wall tops (a foundation, a floor, a roof)
 *   wall   stands on an edge: a foundation's or a floor's, or on top of another wall
 *   stairs fills the storey over a square (or a triangle) of floor
 *   steps  against a foundation's edge, on the outside
 *   free   laid anywhere on the ground, end to end with its own kind (the high walls)
 */
export type Role = 'floor' | 'wall' | 'stairs' | 'steps' | 'free';
export type Shape = 'sq' | 'tri';
export type Cat = 'found' | 'walls' | 'floors' | 'stairs' | 'roofs' | 'outside';

export interface PieceKind {
  id: string;
  name: string;
  cat: Cat;
  role: Role;
  shape?: Shape;
  /** a foundation: it stands on the ground, and everything stands on it */
  ground?: boolean;
  /** a roof: nothing is built over it */
  roof?: boolean;
  /** a wall's height, m (a full wall is a storey) */
  h?: number;
  /** what opening it has, and so what fitting it takes (doors and the like: step four) */
  hole?: 'door' | 'window' | 'wide' | 'hatch';
  /** costs and takes half of a full piece */
  half?: boolean;
  /** made in one tier only (the high walls): it is not hammered up */
  only?: Tier;
  /** the length of a free piece along its line, m */
  long?: number;
}

export const PIECES: Record<string, PieceKind> = Object.fromEntries(
  ([
    { id: 'foundation', name: 'Foundation', cat: 'found', role: 'floor', shape: 'sq', ground: true },
    { id: 'foundation_tri', name: 'Triangle Foundation', cat: 'found', role: 'floor', shape: 'tri', ground: true, half: true },
    { id: 'foundation_steps', name: 'Foundation Steps', cat: 'found', role: 'steps', half: true },
    { id: 'ramp', name: 'Ramp', cat: 'found', role: 'steps' },
    { id: 'wall', name: 'Wall', cat: 'walls', role: 'wall', h: STOREY },
    { id: 'wall_half', name: 'Half Wall', cat: 'walls', role: 'wall', h: STOREY / 2, half: true },
    { id: 'wall_low', name: 'Low Wall', cat: 'walls', role: 'wall', h: 1, half: true },
    { id: 'doorway', name: 'Doorway', cat: 'walls', role: 'wall', h: STOREY, hole: 'door' },
    { id: 'window', name: 'Window', cat: 'walls', role: 'wall', h: STOREY, hole: 'window' },
    { id: 'wall_frame', name: 'Wall Frame', cat: 'walls', role: 'wall', h: STOREY, hole: 'wide' },
    { id: 'floor', name: 'Floor', cat: 'floors', role: 'floor', shape: 'sq' },
    { id: 'floor_tri', name: 'Triangle Floor', cat: 'floors', role: 'floor', shape: 'tri', half: true },
    { id: 'floor_frame', name: 'Floor Frame', cat: 'floors', role: 'floor', shape: 'sq', hole: 'hatch' },
    { id: 'floor_frame_tri', name: 'Triangle Floor Frame', cat: 'floors', role: 'floor', shape: 'tri', hole: 'hatch', half: true },
    { id: 'stairs_l', name: 'L Stairs', cat: 'stairs', role: 'stairs', shape: 'sq' },
    { id: 'stairs_u', name: 'U Stairs', cat: 'stairs', role: 'stairs', shape: 'sq' },
    { id: 'stairs_spiral', name: 'Spiral Stairs', cat: 'stairs', role: 'stairs', shape: 'sq' },
    { id: 'roof', name: 'Roof', cat: 'roofs', role: 'floor', shape: 'sq', roof: true },
    { id: 'roof_tri', name: 'Triangle Roof', cat: 'roofs', role: 'floor', shape: 'tri', roof: true, half: true },
    { id: 'high_wall_wood', name: 'High Wood Wall', cat: 'outside', role: 'free', only: 1, long: 3, h: 6 },
    { id: 'high_wall_stone', name: 'High Stone Wall', cat: 'outside', role: 'free', only: 2, long: 3, h: 6 },
  ] satisfies PieceKind[]).map((k) => [k.id, k]),
);

/** the pieces' numbers on the wire and in the save (never reordered: a new piece goes on the end) */
export const PIECE_IDS = Object.keys(PIECES);

/** what bringing a piece to tier `t` takes (a frame: what laying it takes) */
export function costOf(kind: string, t: Tier): Record<string, number> {
  const k = PIECES[kind];
  const of = TIER_COST[t], out: Record<string, number> = {};
  for (const [id, n] of Object.entries(of)) out[id] = k.half ? Math.ceil(n / 2) : n;
  // (a foundation's frame stands on two logs, its posts)
  if (t === 0 && k.ground) out.log = k.half ? 1 : 2;
  // (a high wall is laid whole: a row of sharpened logs, or a wall of stone)
  if (k.only !== undefined) return k.only === 1 ? { log: 4, nails: 10 } : { stone: 60, planks: 4 };
  return out;
}

/** a piece's health at its tier */
export const hpOf = (kind: string, t: Tier) => (PIECES[kind].only !== undefined ? (PIECES[kind].only === 1 ? 800 : 1500) : TIER_HP[t]);

/** the first tier a piece is laid at: a frame, or the one tier it comes in */
export const laidAt = (kind: string): Tier => PIECES[kind].only ?? 0;
