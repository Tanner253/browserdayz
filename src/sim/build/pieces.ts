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
/**
 * A foundation: how far it stands above its highest ground, how deep its slab is, and how far its skirt reaches below
 * the slab into the ground (as Rust's does: the navigator, 2026-10-24, of one standing over a slope, "no foundation
 * ever shows a gap under it"). It may be laid no higher over its lowest ground than slab and skirt reach.
 */
export const FOUND = { lift: 0.25, deep: 0.6, skirt: 2.5 };
/**
 * A high wall's or a gate's footing: how far its logs, its stone and its posts reach down into the ground, so that one
 * stood on a slope meets the ground at both ends; and how far over its foot the ground may rise.
 */
export const FREE = { skirt: 1.5, rise: 0.6 };
/** a floor's thickness, under the level it makes */
export const FLOOR_T = 0.2;
export const WALL_T = 0.2;

// (the armoured tier, a fifth after metal: the owner's yes to the progression plan, 2026-10-25, "the highest tier
// upgrades to base should be quite grindy and also shoudl require th euser to loot")
export type Tier = 0 | 1 | 2 | 3 | 4;
export const TIERS = ['Frame', 'Wood', 'Stone', 'Metal', 'Armoured'] as const;
/** health by tier, and the seconds the hammer takes to bring a piece up to it (a frame is laid with the plan) */
export const TIER_HP = [60, 500, 1000, 2000, 4000];
export const TIER_S = [1, 5, 8, 12, 16];
/** what a full piece costs at each tier, of the materials (src/sim/items/build.ts; steel plate and iron bars are looted and forged) */
const TIER_COST: Record<string, number>[] = [{ planks: 4 }, { planks: 10, nails: 12 }, { stone: 30, nails: 6 }, { sheet_metal: 4, nails: 24 }, { steel_plate: 2, iron_bar: 6, nails: 30 }];
/** the level of workbench a piece is nailed up to each tier near (0: none): metal at a bench II, armoured at a bench III */
export const TIER_BENCH = [0, 0, 0, 2, 3];
/**
 * The workbench's levels, I to III, brought up in place with the hammer as a tier is (the progression plan, approved):
 * what each level beyond the first costs. Its level is its piece's `t` (`benchLevel`): crafting reads it for its recipes.
 */
export const BENCH_LEVELS: Record<string, number>[] = [{}, {}, { iron_bar: 10, nails: 40, hardware: 2 }, { iron_bar: 25, nails: 60, steel_plate: 3 }];

/**
 * What a piece is to the snapping (src/sim/build/snap.ts):
 *   floor  a floor-like piece with an outline: laid edge to edge, or on wall tops (a foundation, a floor, a roof)
 *   wall   stands on an edge: a foundation's or a floor's, or on top of another wall
 *   stairs fills the storey over a square (or a triangle) of floor
 *   steps  against a foundation's edge, on the outside
 *   free   laid anywhere on the ground, end to end with another (the high walls and their gates)
 *   fit    hung in an opening of its sort (a door in a doorway, bars in a window, a hatch in a floor frame)
 *   lean   leant on either face of a full wall or a high wall, or on top of another (a ladder)
 *   deploy set down anywhere on a foundation or a floor, turned as the player likes (the claim, boxes, the bench)
 */
export type Role = 'floor' | 'wall' | 'stairs' | 'steps' | 'free' | 'fit' | 'lean' | 'deploy';
export type Shape = 'sq' | 'tri';
export type Hole = 'door' | 'window' | 'wide' | 'hatch';
export type Cat = 'found' | 'walls' | 'floors' | 'stairs' | 'roofs' | 'doors' | 'windows' | 'outside' | 'deploy';

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
  /** what opening it has, and so what fitting it takes */
  hole?: Hole;
  /** a fitting: the opening it is hung in */
  fits?: Hole;
  /** costs and takes half of a full piece */
  half?: boolean;
  /** made in one tier only (the high walls, the fittings, what is set down): it is not hammered up */
  only?: Tier;
  /** what one made in one tier costs, and its health */
  cost?: Record<string, number>;
  hp?: number;
  /** laid only with a workbench of this level or better near (plan v2: "metal ones need a workbench in the claim") */
  bench?: 1 | 2 | 3;
  /** brought up in levels with the hammer, not tiers (the workbench: BENCH_LEVELS) */
  levels?: boolean;
  /** the length of a free piece along its line, m */
  long?: number;
  /** a box: its store, squares across and down */
  store?: [number, number];
  /** a bed or a sleeping bag: its owner wakes at it after a death (how often, and how many one may have: SLEEP in src/sim/build/beds.ts) */
  sleep?: true;
  /** laid on anybody's base, a claim's or not (a raider's ladder, Rust's) */
  anywhere?: boolean;
}

/** how near a workbench has to be for what needs one, m */
export const BENCH_NEAR = 30;

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
    // (a row of sharpened logs, or a wall of stone)
    { id: 'high_wall_wood', name: 'High Wood Wall', cat: 'outside', role: 'free', only: 1, long: 3, h: 6, cost: { log: 4, nails: 10 }, hp: 800 },
    { id: 'high_wall_stone', name: 'High Stone Wall', cat: 'outside', role: 'free', only: 2, long: 3, h: 6, cost: { stone: 60, planks: 4 }, hp: 1500 },
    // (the third step: DayZ's flag over Rust's tool cupboard, plan v2: "Building rights 20 m round every piece; its members build, repair and remove")
    { id: 'claim', name: 'Claim', cat: 'deploy', role: 'deploy', only: 1, cost: { log: 1, planks: 10, nails: 10 }, hp: 300 },
    // (the fourth step's fittings, plan v2: "Doors: wood 250, metal 500, garage 1,000: the way in is always weaker than
    // the wall"; "wood door 12 planks, 8 nails · metal door 4 sheet metal, 20 nails · garage door 8 sheet metal, 40
    // nails (the metal ones need a bench); double doors twice a single". The owner: "airlock mechanics like rust has
    // doors that swing open 1 way with collision".)
    { id: 'door_wood', name: 'Wooden Door', cat: 'doors', role: 'fit', fits: 'door', only: 1, cost: { planks: 12, nails: 8 }, hp: 250 },
    // (and a tin of hinges and bolts in every metal door, hatch and gate: the progression plan's `hardware`, looted)
    { id: 'door_metal', name: 'Metal Door', cat: 'doors', role: 'fit', fits: 'door', only: 3, cost: { sheet_metal: 4, nails: 20, hardware: 1 }, hp: 500, bench: 2 },
    { id: 'double_door_wood', name: 'Wooden Double Door', cat: 'doors', role: 'fit', fits: 'wide', only: 1, cost: { planks: 24, nails: 16 }, hp: 250 },
    { id: 'double_door_metal', name: 'Metal Double Door', cat: 'doors', role: 'fit', fits: 'wide', only: 3, cost: { sheet_metal: 8, nails: 40, hardware: 1 }, hp: 500, bench: 2 },
    { id: 'garage_door', name: 'Garage Door', cat: 'doors', role: 'fit', fits: 'wide', only: 3, cost: { sheet_metal: 8, nails: 40, hardware: 1 }, hp: 1000, bench: 2 },
    { id: 'hatch', name: 'Ladder Hatch', cat: 'doors', role: 'fit', fits: 'hatch', only: 3, cost: { sheet_metal: 3, nails: 16, hardware: 1 }, hp: 500, bench: 2 },
    { id: 'shutters', name: 'Wooden Shutters', cat: 'windows', role: 'fit', fits: 'window', only: 1, cost: { planks: 8, nails: 6 }, hp: 250 },
    { id: 'bars_wood', name: 'Wooden Bars', cat: 'windows', role: 'fit', fits: 'window', only: 1, cost: { planks: 6, nails: 6 }, hp: 250 },
    { id: 'bars_metal', name: 'Metal Bars', cat: 'windows', role: 'fit', fits: 'window', only: 3, cost: { sheet_metal: 2, nails: 10 }, hp: 500, bench: 2 },
    { id: 'embrasure', name: 'Embrasure', cat: 'windows', role: 'fit', fits: 'window', only: 3, cost: { sheet_metal: 3, nails: 12 }, hp: 500, bench: 2 },
    { id: 'gate_wood', name: 'High Wood Gate', cat: 'outside', role: 'free', only: 1, long: 3, h: 6, cost: { log: 6, nails: 20, hardware: 1 }, hp: 800 },
    // (plan v2: "Ladder: 8 planks, 10 nails. Leans on any wall. Raiders' ladders work anywhere too")
    { id: 'ladder', name: 'Ladder', cat: 'outside', role: 'lean', only: 1, cost: { planks: 8, nails: 10 }, hp: 150, anywhere: true },
    { id: 'gate_stone', name: 'High Stone Gate', cat: 'outside', role: 'free', only: 2, long: 3, h: 6, cost: { stone: 40, sheet_metal: 6, nails: 20, hardware: 1 }, hp: 1500, bench: 3 },
    // (what is set down, plan v2: "Small box · Large box: 12 planks, 8 nails · 25 planks, 20 nails; 6×5 and 10×8
    // squares; health 150 and 300"; "Workbench: 2 logs, 20 planks, 20 nails. Lets metal fittings be made in its claim")
    { id: 'box_small', name: 'Small Box', cat: 'deploy', role: 'deploy', only: 1, cost: { planks: 12, nails: 8 }, hp: 150, store: [6, 5] },
    { id: 'box_large', name: 'Large Box', cat: 'deploy', role: 'deploy', only: 1, cost: { planks: 25, nails: 20 }, hp: 300, store: [10, 8] },
    { id: 'workbench', name: 'Workbench', cat: 'deploy', role: 'deploy', only: 1, cost: { log: 2, planks: 20, nails: 20 }, hp: 500, levels: true },
    // (crafting's forge, plan-crafting: "an oil drum lined with stone, laid in your claim; feed it wood, it smelts while it
    // burns, even while you are away": 40 stone, 10 planks; its store takes the wood (six wide: a log lies in it on its side), the fragments and what comes out, src/sim/craft/forge.ts)
    { id: 'forge', name: 'Forge', cat: 'deploy', role: 'deploy', only: 1, cost: { stone: 40, planks: 10 }, hp: 500, store: [6, 4] },
    // (the owner, 2026-10-24: "players can place a bed or bedroll in their base when they have a TC down like rust". Plan
    // v2: "Sleeping bag: found ... Wake here after a death, with nothing, at most every 10 min"; a bed, Rust's, sooner)
    { id: 'bedroll', name: 'Sleeping Bag', cat: 'deploy', role: 'deploy', only: 1, cost: { sleeping_bag: 1 }, hp: 100, sleep: true },
    // (the owner, 2026-10-24: torches "hung on walls"; the torch itself, set in an iron bracket)
    { id: 'torch_wall', name: 'Wall Torch', cat: 'deploy', role: 'lean', only: 1, cost: { torch: 1 }, hp: 50 },
    { id: 'bed', name: 'Bed', cat: 'deploy', role: 'deploy', only: 1, cost: { planks: 20, nails: 12, sleeping_bag: 1 }, hp: 250, sleep: true },
    // (the armoured tier's doors, the progression plan: "cost in steel plates, iron bars, hardware and nails; raid cost
    // about twice metal's": two C4 for the door, four for the garage door, src/sim/build/raid.ts)
    { id: 'door_armoured', name: 'Armoured Door', cat: 'doors', role: 'fit', fits: 'door', only: 4, cost: { steel_plate: 2, iron_bar: 4, hardware: 2, nails: 20 }, hp: 1000, bench: 3 },
    { id: 'garage_door_armoured', name: 'Armoured Garage Door', cat: 'doors', role: 'fit', fits: 'wide', only: 4, cost: { steel_plate: 4, iron_bar: 8, hardware: 3, nails: 40 }, hp: 2000, bench: 3 },
    // (crafting's research table, progression v3: "put a found item in with scrap, and the item is used up; you know it for good"; laid by a bench, as Bench I makes it; on the end, as every new piece goes)
    { id: 'research_table', name: 'Research Table', cat: 'deploy', role: 'deploy', only: 1, cost: { planks: 20, metal_frags: 75, scrap: 25 }, hp: 300, bench: 1 },
  ] satisfies PieceKind[] as PieceKind[]).map((k) => [k.id, k]),
);

/** the pieces' numbers on the wire and in the save (never reordered: a new piece goes on the end) */
export const PIECE_IDS = Object.keys(PIECES);

/** what bringing a piece to tier `t` takes (a frame: what laying it takes; the workbench: its level `t`) */
export function costOf(kind: string, t: Tier): Record<string, number> {
  const k = PIECES[kind];
  if (k.levels && t > (k.only ?? 0)) return { ...BENCH_LEVELS[t] };
  // (one made in one tier is laid whole, at its own cost)
  if (k.cost) return { ...k.cost };
  const of = TIER_COST[t], out: Record<string, number> = {};
  for (const [id, n] of Object.entries(of)) out[id] = k.half ? Math.ceil(n / 2) : n;
  // (a foundation's frame stands on two logs, its posts)
  if (t === 0 && k.ground) out.log = k.half ? 1 : 2;
  return out;
}

/** a piece's health at its tier */
export const hpOf = (kind: string, t: Tier) => PIECES[kind].hp ?? TIER_HP[t];

/** the first tier a piece is laid at: a frame, or the one tier it comes in */
export const laidAt = (kind: string): Tier => PIECES[kind].only ?? 0;

/** a workbench's level, I to III (anything else: none) */
export const benchLevel = (p: { k: string; t: number }) => (PIECES[p.k].levels ? p.t : 0);
/** the highest a piece is brought up to: the armoured tier; the workbench, level III */
export const topOf = (kind: string): Tier => (PIECES[kind].levels ? 3 : PIECES[kind].only ?? 4);
