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
import { SECTION, type WalkRun } from './walkways';

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
export const DECK = WATER + 0.35;
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

/** a number in [0, 1) from two, the same in the game and on the server */
const hash = (a: number, b: number) => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * A boardwalk along its waypoints as it would have been laid by hand and mended for years (2026-10-23, the owner's
 * review of straight walks "branching like a circuit board"): each leg in lengths of two or three sections, each
 * joint off the straight by up to 1.2 m, its waypoints (porches, junctions) where they are. With `gap`, its longest
 * leg's middle length left out over a hummock, stepped across a little under the deck (see the hummocks in
 * MOKROYE_GROUND). Its gateway and its posts by its first length.
 */
export function wander(pts: [number, number][], deck: number, seed: number, o: { gate?: boolean; posts?: boolean; gap?: boolean } = {}): { runs: WalkRun[]; hummocks: [number, number, number, number, number][] } {
  const runs: WalkRun[] = [], hummocks: [number, number, number, number, number][] = [];
  const lens = pts.slice(1).map((p, k) => Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1])), longest = lens.indexOf(Math.max(...lens));
  for (let leg = 0; leg + 1 < pts.length; leg++) {
    const [ax, az] = pts[leg], [bx, bz] = pts[leg + 1], L = lens[leg], ux = (bx - ax) / L, uz = (bz - az) / L;
    const joints: [number, number][] = [[ax, az]];
    let along = 0, was = 0, k = 0;
    while (L - along > 10.5) {
      const n = hash(seed, leg * 31 + k) < 0.5 ? 2 : 3, off = (hash(seed + 7, leg * 31 + k) - 0.5) * 2.4, piece = n * SECTION.step;
      along += Math.sqrt(piece * piece - (off - was) ** 2);
      joints.push([ax + ux * along - uz * off, az + uz * along + ux * off]);
      was = off;
      k++;
    }
    joints.push([bx, bz]);
    const gapAt = o.gap && leg === longest && joints.length >= 4 ? Math.floor((joints.length - 1) / 2) : -1;
    for (let j = 0; j + 1 < joints.length; j++) {
      const [p, q] = [joints[j], joints[j + 1]];
      if (j === gapAt) {
        const half = Math.hypot(q[0] - p[0], q[1] - p[1]) / 2;
        hummocks.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, half + 3, deck - 0.08, half + 0.4]);
        continue;
      }
      const first = !runs.length;
      runs.push({ a: p, b: q, deck, ...(o.gate && first ? { gate: true } : {}), ...(o.posts && first ? { posts: true } : {}) });
    }
  }
  return { runs, hummocks };
}

/** The boardwalks: in from the swamp's east edge, branching to the houses and the little island; from the big island to the barn; the jetty off the island's west end into open water, straight as a jetty is. */
const WALKED = [
  wander([[79, 2], [46, -10]], DECK, 1, { posts: true, gap: true }),
  wander([[46, -10], [14, -8], [-13, -14]], DECK, 2),
  wander([[14, -8], [6, 18], [-3, 24]], DECK, 3),
  // (on to the stilt house's porch, the last length a step up to it: the walk ended 5 m short in the water, and the
  // door opened onto the swamp)
  wander([[46, -10], [40.95, -26.34]], DECK, 4),
  { runs: [{ a: [40.95, -26.34], b: [40.06, -29.21], deck: STILT_FLOOR - 0.25 }], hummocks: [] },
  wander([[6, 18], [31, 22]], DECK, 5, { posts: true }),
  wander([[-31, -9], [-40, 22.5], [-41, 26]], DECK, 6, { gap: true }),
  { runs: [{ a: [-42, -24], b: [-74, -26], deck: DECK, gate: true, posts: true }], hummocks: [] },
] as { runs: WalkRun[]; hummocks: [number, number, number, number, number][] }[];
export const MOKROYE_WALKS: WalkRun[] = WALKED.flatMap((w) => w.runs);
/** the hummocks the boardwalks are broken over */
const WALK_HUMMOCKS = WALKED.flatMap((w) => w.hummocks);

/** the point of the boardwalks nearest a spot, `side` metres off their middle line (what stands on them is set so, wherever their bends now are) */
function onBoards(x: number, z: number, side = 0.55): [number, number] {
  let best = Infinity, at: [number, number] = [x, z];
  for (const { a, b } of MOKROYE_WALKS) {
    const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1, u = Math.max(0.1, Math.min(0.9, ((x - a[0]) * ex + (z - a[1]) * ez) / (L * L)));
    const px = a[0] + ex * u, pz = a[1] + ez * u, d = Math.hypot(x - px, z - pz);
    if (d < best) [best, at] = [d, [px - (ez / L) * side, pz + (ex / L) * side]];
  }
  return at;
}

/** the stilts under the house on stilts: a cluster of the kit's old posts at each corner, their tops at its floor (on the pad at y) */
export function mokroyePosts(y: number): KitPiece[] {
  return stiltsUnder(mokroyeBuildings().find((s) => s.up === STILT_FLOOR)!, y);
}
/** the stilts under a house on stilts (its floor `floor` over the pad at y: STILT_FLOOR, or a boathouse's at the deck) */
export function stiltsUnder(h: TownSpot, y: number, floor = STILT_FLOOR): KitPiece[] {
  const c = Math.cos(h.rot), s = Math.sin(h.rot);
  // (a cluster of posts stands 3.85 m from 0.71 under its origin: its tops at the floor, its feet sunk in the mud)
  const foot = y + floor - 3.14;
  // (a cluster's middle is (0.92, 1.45) of its own from its origin: each stood so that its middle is at its corner)
  return [[-3.6, -2.9], [3.6, -2.9], [3.6, 2.9], [-3.6, 2.9]].map(([lx, lz], k) => {
    const turn = h.rot + k * 1.3, x = h.x + lx * c + lz * s, z = h.z - lx * s + lz * c;
    return { id: 'pier_poles', at: [x - (0.92 * Math.cos(turn) + 1.45 * Math.sin(turn)), foot, z - (-0.92 * Math.sin(turn) + 1.45 * Math.cos(turn))] as [number, number, number], turn, body: false, name: 'Mokroye stilts' };
  });
}

/** a run of 2 m fence panels from a to b, panels gone here and there (the water took them) */
export function drowned(a: [number, number], b: [number, number], gone: number[] = []): TownThing[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / 2)), step = len / n;
  const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len, rot = Math.atan2(-dz, dx), out: TownThing[] = [];
  for (let k = 0; k < n; k++) if (!gone.includes(k)) out.push({ kind: 'fence_grey', x: a[0] + dx * (k + 0.5) * step, z: a[1] + dz * (k + 0.5) * step, rot: rot + ((k * 5) % 3 - 1) * 0.05 });
  return out;
}

/**
 * A house's yard fence on the bank of mud round it (src/world/worldgen/west-towns.ts layHamlet), `out` metres off its
 * walls, along its back and its two sides, its front open to its walk; some panels gone. `half`: half the house's
 * width and depth. (Standing in the open water they were, the owner's review 2026-10-23: "take the fences out of the
 * water, keep them on dry ground round a house".)
 */
export function yardFence(h: TownSpot, half: [number, number], out: number, gone: number[] = []): TownThing[] {
  const c = Math.cos(h.rot), s = Math.sin(h.rot), at = (lx: number, lz: number): [number, number] => [h.x + lx * c + lz * s, h.z - lx * s + lz * c];
  const X = half[0] + out, Z = half[1] + out, front = half[1] - 0.5;
  const sides = [drowned(at(-X, front), at(-X, -Z)), drowned(at(-X, -Z), at(X, -Z)), drowned(at(X, -Z), at(X, front))].flat();
  return sides.filter((_, k) => !gone.includes(k));
}

/** an izba's half width and depth (src/world/worldgen/layout.ts BUILDING_FOOTPRINT) */
export const IZBA_HALF: [number, number] = [4, 3.25];

export function mokroyeThings(): TownThing[] {
  const [, , wetA, wetB] = mokroyeBuildings();
  return [
    // the yards' fences of the two houses the water stands in, on the mud round them, some panels gone
    ...yardFence(wetA, IZBA_HALF, 5.5, [2, 9]), ...yardFence(wetB, IZBA_HALF, 5.5, [1, 5, 10]),
    // trunks and stumps the water lifted and left
    { kind: 'dead_tree_trunk', x: 26, z: 36, rot: 0.6 }, { kind: 'dead_tree_trunk', x: -58, z: 4, rot: 2.1 }, { kind: 'dead_tree_trunk', x: 60, z: 30, rot: 1.2 },
    { kind: 'tree_stump_01', x: -60, z: -40, rot: 0.3 }, { kind: 'tree_stump_01', x: 64, z: -18, rot: 1.9 },
    // on the boardwalks, the island and by the houses
    { kind: 'Barrel_01', x: onBoards(30, -9)[0], z: onBoards(30, -9)[1], rot: 0, up: DECK }, { kind: 'wooden_crate_01', x: onBoards(2, -10.6)[0], z: onBoards(2, -10.6)[1], rot: 0.2, up: DECK },
    { kind: 'wooden_crate_01', x: -36, z: -12, rot: 0.9 }, { kind: 'Barrel_01', x: -23, z: -12, rot: 0 }, { kind: 'barrel_03', x: -22.2, z: -12.8, rot: 0.4 },
    { kind: 'old_tyre', x: 12, z: 26, rot: 0.3 }, { kind: 'Barrel_01', x: -60, z: -25.5, rot: 0, up: DECK },
  ];
}

/** the water over all of it (a swamp: its look and its mist, src/world/water.ts SWAMP), the islands raised, the hollow sunk, a hummock or two and a pool */
export const MOKROYE_GROUND: TownGround = {
  yards: [],
  lanes: [],
  mounds: [ISLAND1, ISLAND2, HOLLOW, [58, 8, 10, 0.25, 3], [-6, -50, 9, 0.3, 2], [22, 42, 14, -0.25, 6], ...WALK_HUMMOCKS],
  water: {
    level: WATER,
    swamp: true,
    // (its edge ragged, out past the pad's ground so the swamp's own water meets it: the world's lane lays the real swamp)
    outline: [[-88, -64], [-40, -78], [20, -74], [70, -80], [90, -40], [86, 20], [92, 70], [30, 78], [-30, 74], [-90, 76], [-94, 10]],
  },
};
