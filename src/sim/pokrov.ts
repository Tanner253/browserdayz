// Pokrov, the white-walled monastery and the town outside its gate (2026-10-16, reworked): where its buildings and
// what lies about them stand, and the terrace it stands on. Pure numbers, the same for the game and the server; in
// Pokrov's frame (x east, z south of its middle). Its walls are the fort kit's (src/sim/towns.ts, pokrovWalls).
// The owner, of the first pass: "i am underhwlemed and not impressed witht he layouts". It was a box of a cathedral
// on a lawn, flat white walls, and a scatter of houses outside. Now:
//   - The monastery stands 4 m up on a terrace: the Holy Gate at the head of a cobbled ramp, and whoever holds the
//     terrace's edge looks down on the market.
//   - The cathedral is a cross: the nave, an arm each side, the apse to the east, five domes.
//   - Outside, two lanes of houses built close (wall to wall, or a man's width of alley between) meet at a market
//     square of stalls under the ramp: crates, barrels, tables of produce, cover everywhere and sight lines nowhere.

import type { TownGround, TownSpot } from './towns';
import type { TownThing } from './zavod';

const PI = Math.PI, Q = PI / 2;

/** the terrace under the monastery: its edge (beyond the walls), how high, how far its bank reaches out */
export const POKROV_TERRACE = { poly: [[-78, 31], [83, 31], [88, -66], [0, -108], [-93, -60]] as [number, number][], h: 4, out: 14 };

/** the lanes of the town outside, both along z = LANE: the fronts of the houses stand back from it either side */
const LANE = 64, NORTH = 58, SOUTH = 70;
/** how high a market table's top is (WoodenTable_01) */
const TABLE = 0.55;
/** a kind's depth (the houses are said by where their fronts stand: the middle is half the depth back from it) */
const DEEP = { tavern: 10, merchant: 9, izba_two: 8, izba: 6.5, smithy: 7 } as const;
type Kind = keyof typeof DEEP;
const north = (type: Kind, x: number): TownSpot => ({ type, x, z: NORTH - DEEP[type] / 2, rot: 0 });
const south = (type: Kind, x: number): TownSpot => ({ type, x, z: SOUTH + DEEP[type] / 2, rot: PI });

export function pokrovBuildings(): TownSpot[] {
  return [
    // on the terrace, inside the walls: the cathedral (its nave, door to the west; its two arms; its apse to the east), the belfry, the cells, the refectory, the abbot's house
    { type: 'cathedral', x: 10, z: -38, rot: 0 },
    // (an arm's own x runs out from the nave: north, a quarter turn; south, the other way)
    { type: 'cathedral_arm', x: 12.5, z: -47, rot: Q },
    { type: 'cathedral_arm', x: 12.5, z: -29, rot: -Q },
    { type: 'cathedral_apse', x: 25, z: -38, rot: 0 },
    { type: 'belfry', x: 18, z: -58, rot: 0 },
    { type: 'cells', x: 58, z: -22, rot: -Q, arms: 1 },
    { type: 'refectory', x: -40, z: 0, rot: 0 },
    { type: 'abbot', x: 30, z: 2, rot: 0 },
    // the town outside: the west lane, its north side (a man's width of alley after the tavern, then wall to wall), its south side
    north('tavern', -31), north('merchant', -45.3), north('merchant', -56.5), north('izba_two', -66.7),
    south('smithy', -30), south('merchant', -42.6), south('izba', -53.3),
    // the east lane
    north('merchant', 33.5), north('merchant', 44.7), north('izba_two', 56.8), north('izba', 65.6),
    south('izba_two', 34), south('merchant', 45.5), south('izba', 58),
  ];
}

export function pokrovThings(): TownThing[] {
  const out: TownThing[] = [];
  // the market: four rows of stalls either side of the way down from the ramp, each a table, what was for sale on it and round it
  const stall = (x: number, z: number, n: number) => {
    const turn = ((n % 3) - 1) * 0.06;
    out.push({ kind: 'WoodenTable_01', x, z, rot: turn });
    // (on the table: produce, or boxes; beside it what it came in)
    const top = n % 3 === 0 ? ['pumpkin', 'cabbage', 'pumpkin'] : n % 3 === 1 ? ['cabbage', 'cabbage', 'cardboard_box_01'] : ['cardboard_box_01', 'pumpkin', 'cardboard_box_01'];
    top.forEach((kind, k) => out.push({ kind, x: x + (k - 1) * 0.55, z: z + (k % 2 ? 0.1 : -0.12), rot: n + k * 1.9, up: TABLE }));
    out.push({ kind: n % 2 ? 'wooden_crate_01' : 'Barrel_01', x: x + (n % 4 < 2 ? -1.35 : 1.35), z: z + 0.5, rot: n * 0.7 });
  };
  let n = 0;
  for (const z of [52, 58, 66, 72]) for (const x of [-9, -3, 13, 19]) stall(x + (z % 4) * 0.6, z, n++);
  // what is piled at the ramp's foot and along the lanes
  out.push(
    { kind: 'crate_big', x: -1.0, z: 47.5, rot: 0.2 }, { kind: 'crate_big', x: 0.1, z: 48.2, rot: 0.1 }, { kind: 'Barrel_01', x: 10.6, z: 47.2, rot: 0 }, { kind: 'barrel_03', x: 11.4, z: 48.0, rot: 0.5 },
    { kind: 'concrete_road_barrier', x: 5, z: 33, rot: 0.1 },
    { kind: 'wooden_crate_01', x: -38.4, z: 59.4, rot: 0.3 }, { kind: 'Barrel_01', x: -50.6, z: 69.2, rot: 0 }, { kind: 'trashbag', x: 39.5, z: 59.6, rot: 0.8 },
    { kind: 'old_tyre', x: 60.4, z: 69.0, rot: 0.2 }, { kind: 'covered_car', x: -78, z: 64, rot: Q + 0.05 },
  );
  return out;
}

/** the market and the ramp cobbled (gravel), the lanes trodden; the terrace under the monastery */
export const POKROV_GROUND: TownGround = {
  yards: [[-13, 47, 23, 77]],
  lanes: [
    { line: [[5, 18], [5, 48]], w: 6 },
    { line: [[-130, LANE], [-16, LANE]], w: 6 },
    { line: [[26, LANE], [135, LANE]], w: 6 },
    { line: [[5, 80], [6, 118]], w: 5 },
    // (the bunker road out of the north gate)
    { line: [[-44, -75], [-58, -112]], w: 4 },
  ],
  terraces: [POKROV_TERRACE],
};

