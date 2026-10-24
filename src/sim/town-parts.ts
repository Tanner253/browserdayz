// The towns grown (2026-10-23, the owner: Lipki "maybe needs to be a little larger"; Mokroye "doesnt have enough
// buildings to be meaningful to visit"; their plan, progress/world-polish/towns-plan.png: "Everything looks good").
// What is added to a town stands in that town's frame, on its pad and its ground, but is a part of it laid after
// every town of the map (`part`: whose part it is), so that no building, place for a thing or door of the map is
// renumbered for it: a place's things are given back to it by its number at a restart. A part is no place on the
// maps of its own, and stands on its town's pad as that town laid it (src/world/worldgen/west.ts).
// Pure numbers, the same for the game and the server.

import { LIPKI, LIPKI_GROUND } from './lipki';
import { DECK, IZBA_HALF, MOKROYE, MOKROYE_GROUND, STILT_FLOOR, WET_FLOOR, stiltsUnder, wander, yardFence } from './mokroye';
import type { KitPiece } from './kit';
import type { Town, TownGround, TownSpot } from './towns';
import type { WalkRun } from './walkways';
import type { TownThing } from './zavod';

const PI = Math.PI, Q = PI / 2;

/**
 * Lipki's new lane, east off the main one through the gap in its east side: the village shop and the houses either
 * side of it, past the wood stacked behind the main lane's houses; and the farm's barn and shed at the north end.
 */
export const LIPKI_LANE: Town = { ...LIPKI, name: 'LipkiLane', part: LIPKI.name };
/** Mokroye's outer houses in the reeds: a plank house on piles, two more the water stands in, one on stilts, the jetty's boathouse, a high seat */
export const MOKROYE_REEDS: Town = { ...MOKROYE, name: 'MokroyeReeds', part: MOKROYE.name };

/** every part, in the order they are laid (after every town: see TOWNS) */
export const TOWN_PARTS: Town[] = [LIPKI_LANE, MOKROYE_REEDS];

/** the lane: along z = LANE, from the main lane's edge east to the pad's */
const LANE = -45;

const BUILDINGS: Record<string, TownSpot[]> = {
  LipkiLane: [
    // (north of the lane, fronts to it: the shop, then a house of two floors behind its garden. Both at its east end:
    // nothing new within 15 m of a stash kept in the village, scripts/stash-guard.ts)
    { type: 'merchant', x: 44, z: LANE - 2.2 - 5.7, rot: 0 },
    { type: 'izba_two', x: 55, z: LANE - 2.2 - 4 - 2.5, rot: 0 },
    // (south of it, fronts to it: a house behind its garden; the east high seat stands behind it)
    { type: 'izba', x: 31, z: LANE + 2.2 + 3.25 + 2.5, rot: PI },
    // the farm at the north end, west of the road: its barn and its shed
    { type: 'barn', x: -22, z: -84, rot: 0.15 },
    { type: 'shed', x: -10, z: -90, rot: -0.2 },
  ],
  MokroyeReeds: [
    // the plank house on piles east in the reeds, its front to the walk that comes to it from the island
    { type: 'shanty', x: 66, z: 22, rot: -Q },
    // two more log houses the water stands in, a foot over their boards: west by the jetty, south past the barn
    { type: 'izba_wet', x: -62, z: -2, rot: Q, up: WET_FLOOR },
    { type: 'izba_wet', x: -14, z: 56, rot: PI, up: WET_FLOOR },
    // a house on stilts out north, its front to the walk from the hamlet (as the hamlet's own on stilts is)
    { type: 'izba', x: -6, z: -62, rot: 0, up: STILT_FLOOR },
    // the boathouse at the jetty's end, on the water
    { type: 'boathouse', x: -80.2, z: -26, rot: Q, up: DECK },
    // a high seat over the reeds south-east, where the boardwalk ends
    { type: 'tower', x: 58, z: 52, rot: -Q },
  ],
};

/** a run of picket fence from a to b, a gap where its gate is (metres along from a) */
function picket(a: [number, number], b: [number, number], gate?: [number, number]): TownThing[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / 2)), step = len / n;
  const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len, rot = Math.atan2(-dz, dx), out: TownThing[] = [];
  for (let k = 0; k < n; k++) {
    const m = (k + 0.5) * step;
    if (gate && m > gate[0] && m < gate[1]) continue;
    out.push({ kind: 'fence_white', x: a[0] + dx * m, z: a[1] + dz * m, rot });
  }
  return out;
}

const THINGS: Record<string, TownThing[]> = {
  LipkiLane: [
    // the shop's yard behind it: what came on the last cart; and a bench by its door
    { kind: 'wooden_crate_01', x: 40.5, z: LANE - 14.6, rot: 0.2 }, { kind: 'wooden_crate_01', x: 40.6, z: LANE - 15.8, rot: 1.4 },
    { kind: 'Barrel_01', x: 47, z: LANE - 14.4, rot: 0 }, { kind: 'cardboard_box_01', x: 48, z: LANE - 14.8, rot: 0.6 },
    { kind: 'painted_wooden_bench', x: 41.5, z: LANE - 2.75, rot: 0 },
    // the houses' gardens on the lane, in white pickets, and their wood behind them
    ...picket([50.8, LANE - 2.6], [59.2, LANE - 2.6], [3.2, 5.2]),
    ...picket([27, LANE + 2.6], [35, LANE + 2.6], [3.0, 5.0]),
    { kind: 'log_pile', x: 55, z: LANE - 14.2, rot: 0 }, { kind: 'log_pile', x: 31, z: LANE + 13.6, rot: PI },
    { kind: 'tree_stump_01', x: 58.5, z: LANE - 13.6, rot: 0.8 },
    // the farmyard: what a farm leaves lying
    { kind: 'old_tyre', x: -30, z: -77, rot: 0.4 }, { kind: 'metal_jerrycan_green', x: -15, z: -79, rot: 0.3 },
    { kind: 'wooden_crate_01', x: -14.4, z: -87.6, rot: 0.9 }, { kind: 'Barrel_01', x: -14.6, z: -89.4, rot: 0 }, { kind: 'log_pile', x: -27, z: -92, rot: 0.3 },
  ],
  MokroyeReeds: [
    // the yards' fences of the two houses the water stands in, on the mud round them
    ...yardFence(BUILDINGS.MokroyeReeds[1], IZBA_HALF, 5.5, [3, 8]), ...yardFence(BUILDINGS.MokroyeReeds[2], IZBA_HALF, 5.5, [0, 6]),
    { kind: 'dead_tree_trunk', x: 72, z: 50, rot: 2.4 }, { kind: 'tree_stump_01', x: -70, z: -12, rot: 1.1 },
  ],
};

/** the boardwalks to the new houses in the reeds, branching off the hamlet's own (src/sim/mokroye.ts MOKROYE_WALKS), wandering as those do */
const REED_WALKS = [
  // from the little island's east shore (its walk comes to its west, and the shed is on it) to the house on piles, by
  // where the walk to the high seat leaves it
  wander([[41.5, 22.4], [44, 22.3], [57.6, 22]], DECK, 11, { posts: true }),
  // from the jetty north to the house in the west, and in to its door
  wander([[-55, -24.8], [-55, -3], [-57.6, -2]], DECK, 12),
  // from the walk to the barn, short of the barn, south-east to the house past it
  wander([[-40, 22.5], [-14, 48.5], [-14, 52.2]], DECK, 13, { posts: true, gap: true }),
  // north from the walk off the island to the house on stilts, the last length a step up to its porch: as the
  // hamlet's own house on stilts is come to, to the same places of the house
  wander([[-13, -14], [-5.96, -55.57]], DECK, 14, { posts: true, gap: true }),
  { runs: [{ a: [-5.96, -55.57], b: [-8.12, -57.66], deck: STILT_FLOOR - 0.25 }] as WalkRun[], hummocks: [] },
  // on out past the jetty's end to the boathouse
  { runs: [{ a: [-74, -26], b: [-77, -26], deck: DECK }] as WalkRun[], hummocks: [] },
  // off the walk to the house on piles, south through the reeds to the high seat
  wander([[44, 22.3], [54.4, 51]], DECK, 15, { posts: true }),
];
const WALKS: Record<string, WalkRun[]> = { MokroyeReeds: REED_WALKS.flatMap((w) => w.runs) };

/** what of a town's ground its part stands on as it is: its knolls and terraces (its floors over them), its water (its houses in it flooded as the town's are, src/sim/towns.ts placedRooms) */
const under = (g: TownGround) => ({ mounds: g.mounds, terraces: g.terraces, water: g.water });
const GROUND: Record<string, TownGround> = {
  // (the lane and the farmyard trodden)
  LipkiLane: { ...under(LIPKI_GROUND), yards: [[-30, -92, -12, -76]], lanes: [{ line: [[3, LANE], [56, LANE]], w: 4 }] },
  // (and the hummocks its walks are broken over)
  MokroyeReeds: { ...under(MOKROYE_GROUND), mounds: [...(MOKROYE_GROUND.mounds ?? []), ...REED_WALKS.flatMap((w) => w.hummocks)], yards: [], lanes: [] },
};

export const partBuildings = (t: Town): TownSpot[] => BUILDINGS[t.name] ?? [];
export const partThings = (t: Town): TownThing[] => THINGS[t.name] ?? [];
export const partGround = (t: Town): TownGround => GROUND[t.name] ?? { yards: [], lanes: [] };
export const partWalks = (t: Town): WalkRun[] => WALKS[t.name] ?? [];
/** the stilts under a part's houses on stilts, and the posts the boathouse stands on over the water (on the pad at y) */
export const partPosts = (t: Town, y: number): KitPiece[] => partBuildings(t).filter((s) => s.up === STILT_FLOOR || s.type === 'boathouse').flatMap((h) => stiltsUnder(h, y, h.up));
