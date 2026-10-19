// Mokroye, the flooded hamlet in the swamp (2026-10-16, new): where its houses, boardwalks and what the water left
// stand. Pure numbers, the same for the game and the server; in Mokroye's own frame (x east, z south of its middle).
// The owner's investor, of a lake drawn over a village: "the investor liked the swamp idea and water around buildings
// like this"; the brief from it: buildings standing in shallow water (0.2-0.6 m round their walls), some on stilts or
// islands, some with the water over their ground floors, boardwalks between them and across the swamp, a jetty, a
// half-sunk barn, drowned fences; loot on tables, shelves and upper floors, never under the water.
//
// How it is meant to be fought: the boardwalks are fast and loud and in the open; the water is slow (a walker at the
// knee goes at 62%, at the waist 45%: src/sim/water.ts) but low; the dry island house's upper floor and the house on
// stilts look over all of it; the sunk barn is waist-deep and dark, its loot on its top shelves.

import type { KitPiece } from './kit';
import type { Town, TownGround, TownSpot } from './towns';
import type { TownThing } from './zavod';
import type { WalkRun } from './walkways';

const PI = Math.PI;

/** Where it is planned (plan v5): in the swamp in the green land's south-west (about x -2060..-1650, z 430..740). */
export const MOKROYE: Town = { name: 'Mokroye', x: -1855, z: 585, pad: [80, 70], rot: 0 };

/** how high the swamp's water stands over the pad (the drowned meadow it lies on) */
export const WATER = 0.4;
/** the floors over the pad: a house the water stands in (0.3 m over its boards), the house on stilts, the barn sunk in its hollow (waist-deep) */
export const WET_FLOOR = 0.1, STILT_FLOOR = 1.25, SUNK_FLOOR = -0.65;
/** how deep the water is over the floor of a flooded house, and of the sunk barn (for its plans: src/world/mokroye-plans.ts) */
export const WET_DEPTH = WATER - WET_FLOOR, SUNK_DEPTH = WATER - SUNK_FLOOR;
/** the boardwalks' decks over the pad: a step over the water */
const DECK = WATER + 0.35;
/** the islands, the hollow the barn has sunk into, and a few hummocks and pools: [x, z, foot r, height, level top r] */
const ISLAND1: [number, number, number, number, number] = [-28, -22, 21, 0.8, 13];
const ISLAND2: [number, number, number, number, number] = [36, 24, 10, 0.8, 4.5];
const HOLLOW: [number, number, number, number, number] = [-42, 34, 13, -0.7, 8];

export function mokroyeBuildings(): TownSpot[] {
  return [
    // on the big island, dry: the headman's house of two floors (the best look over the swamp from its upper windows), the smokehouse
    { type: 'izba_two', x: -30, z: -20, rot: 0.25 },
    { type: 'smokehouse', x: -17, z: -31, rot: -0.4 },
    // two log houses the water stands in, a foot over their boards: their fronts to the boardwalks
    { type: 'izba_wet', x: 8, z: -28, rot: 0.3, up: WET_FLOOR },
    { type: 'izba_wet', x: -2, z: 31, rot: PI - 0.2, up: WET_FLOOR },
    // the house on stilts, its front to the walk that comes to it from the north
    { type: 'izba', x: 44, z: -32, rot: -0.5, up: STILT_FLOOR },
    // the barn sunk waist-deep in its hollow, its open front to the walk from the island
    { type: 'barn_sunk', x: HOLLOW[0], z: HOLLOW[1], rot: PI + 0.15, up: SUNK_FLOOR },
    // the fisherman's shed on the little island
    { type: 'shed', x: ISLAND2[0] + 0.5, z: ISLAND2[1] + 0.5, rot: -PI / 2 - 0.3 },
  ];
}

/** The boardwalks: in from the swamp's east edge, branching to the houses and the little island; from the big island to the barn; the jetty off the island's west end into open water. */
export const MOKROYE_WALKS: WalkRun[] = [
  { a: [79, 2], b: [46, -10], deck: DECK, posts: true },
  { a: [46, -10], b: [14, -8], deck: DECK },
  { a: [14, -8], b: [-13, -14], deck: DECK },
  { a: [14, -8], b: [6, 18], deck: DECK },
  { a: [6, 18], b: [-3, 24], deck: DECK },
  // (on to the stilt house's porch: it ended 5 m short, in the water, and the door opened onto the swamp)
  { a: [46, -10], b: [40.06, -29.21], deck: DECK },
  { a: [6, 18], b: [31, 22], deck: DECK, posts: true },
  { a: [-31, -9], b: [-41, 26], deck: DECK },
  { a: [-42, -24], b: [-74, -26], deck: DECK, gate: true, posts: true },
];

/** the stilts under the house on stilts: a cluster of the kit's old posts at each corner, their tops at its floor (on the pad at y) */
export function mokroyePosts(y: number): KitPiece[] {
  const h = mokroyeBuildings().find((s) => s.up === STILT_FLOOR)!, c = Math.cos(h.rot), s = Math.sin(h.rot);
  // (a cluster of posts stands 3.85 m from 0.71 under its origin: its tops at the floor, its feet sunk in the mud)
  const foot = y + STILT_FLOOR - 3.14;
  // (a cluster's middle is (0.92, 1.45) of its own from its origin: each stood so that its middle is at its corner)
  return [[-3.6, -2.9], [3.6, -2.9], [3.6, 2.9], [-3.6, 2.9]].map(([lx, lz], k) => {
    const turn = h.rot + k * 1.3, x = h.x + lx * c + lz * s, z = h.z - lx * s + lz * c;
    return { id: 'pier_poles', at: [x - (0.92 * Math.cos(turn) + 1.45 * Math.sin(turn)), foot, z - (-0.92 * Math.sin(turn) + 1.45 * Math.cos(turn))] as [number, number, number], turn, body: false, name: 'Mokroye stilts' };
  });
}

/** a run of 2 m fence panels from a to b, panels gone here and there (the water took them) */
function drowned(a: [number, number], b: [number, number], gone: number[] = []): TownThing[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / 2)), step = len / n;
  const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len, rot = Math.atan2(-dz, dx), out: TownThing[] = [];
  for (let k = 0; k < n; k++) if (!gone.includes(k)) out.push({ kind: 'fence_grey', x: a[0] + dx * (k + 0.5) * step, z: a[1] + dz * (k + 0.5) * step, rot: rot + ((k * 5) % 3 - 1) * 0.05 });
  return out;
}

export function mokroyeThings(): TownThing[] {
  return [
    // the fences of yards the water came over, standing in it to the waist of a man, some panels gone
    ...drowned([0, -40], [18, -40], [3]), ...drowned([18, -40], [20, -18], [1, 7]),
    ...drowned([-12, 38], [10, 40], [2, 6, 7]), ...drowned([22, 4], [34, -4], [0]),
    // trunks and stumps the water lifted and left
    { kind: 'dead_tree_trunk', x: 26, z: 36, rot: 0.6 }, { kind: 'dead_tree_trunk', x: -58, z: 4, rot: 2.1 }, { kind: 'dead_tree_trunk', x: 60, z: 30, rot: 1.2 },
    { kind: 'tree_stump_01', x: -60, z: -40, rot: 0.3 }, { kind: 'tree_stump_01', x: 64, z: -18, rot: 1.9 },
    // on the boardwalks, the island and by the houses
    { kind: 'Barrel_01', x: 30, z: -9.0, rot: 0, up: DECK }, { kind: 'wooden_crate_01', x: 2, z: -10.6, rot: 0.2, up: DECK },
    { kind: 'wooden_crate_01', x: -36, z: -12, rot: 0.9 }, { kind: 'Barrel_01', x: -23, z: -12, rot: 0 }, { kind: 'barrel_03', x: -22.2, z: -12.8, rot: 0.4 },
    { kind: 'old_tyre', x: 12, z: 26, rot: 0.3 }, { kind: 'Barrel_01', x: -60, z: -25.5, rot: 0, up: DECK },
  ];
}

/** the water over all of it (a swamp: its look and its mist, src/world/water.ts SWAMP), the islands raised, the hollow sunk, a hummock or two and a pool */
export const MOKROYE_GROUND: TownGround = {
  yards: [],
  lanes: [],
  mounds: [ISLAND1, ISLAND2, HOLLOW, [58, 8, 10, 0.25, 3], [-6, -50, 9, 0.3, 2], [22, 42, 14, -0.25, 6]],
  water: {
    level: WATER,
    swamp: true,
    // (its edge ragged, out past the pad's ground so the swamp's own water meets it: the world's lane lays the real swamp)
    outline: [[-88, -64], [-40, -78], [20, -74], [70, -80], [90, -40], [86, 20], [92, 70], [30, 78], [-30, 74], [-90, 76], [-94, 10]],
  },
};
