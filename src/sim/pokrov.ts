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
export const POKROV_LANE = 64;
const LANE = POKROV_LANE, NORTH = 58, SOUTH = 70;
/** how high a market table's top is (WoodenTable_01) */
const TABLE = 0.55;
/** a kind's depth (the houses are said by where their fronts stand: the middle is half the depth back from it) */
const DEEP = { tavern: 10, merchant: 9, izba_two: 8, izba: 6.5, smithy: 7 } as const;
type Kind = keyof typeof DEEP;
const north = (type: Kind, x: number): TownSpot => ({ type, x, z: NORTH - DEEP[type] / 2, rot: 0 });
const south = (type: Kind, x: number): TownSpot => ({ type, x, z: SOUTH + DEEP[type] / 2, rot: PI });

/**
 * Where the cells stand: along the east side of the walls (POKROV_WALL's second side), 8 to 32 m from its south
 * corner (south of the stair up to the walk, whose foot is at 35.3), their back against the wall's inside face (the
 * kit's thin wall is 2.55 deep, inside the line the walls are said by), their front to the court.
 */
function cellsSpot(): TownSpot {
  const [ax, az] = [70, 20], [bx, bz] = [75, -60], L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L;
  // (inside is on the left of the way the side runs: (dz, -dx))
  const along = 20, inward = 2.55 + 4.5 + 0.02, x = ax + dx * along + dz * inward, z = az + dz * along - dx * inward;
  // (its front, its own +z, toward the court: the left of the way the side runs)
  return { type: 'cells', x, z, rot: Math.atan2(dz, -dx) };
}

export function pokrovBuildings(): TownSpot[] {
  return [
    // on the terrace, inside the walls: the cathedral (its nave, door to the west; its two arms; its apse to the east), the belfry, the cells, the refectory, the abbot's house
    // (half as big again since 2026-10-19, the owner: it "feels too small for the poi area": the nave 36 by 18, its
    // crossing 3.75 m east of its middle, where the arms open off it)
    { type: 'cathedral', x: 8.25, z: -38, rot: 0 },
    // (an arm's own x runs out from the nave: north, a quarter turn; south, the other way)
    { type: 'cathedral_arm', x: 12, z: -50.5, rot: Q },
    { type: 'cathedral_arm', x: 12, z: -25.5, rot: -Q },
    { type: 'cathedral_apse', x: 30.75, z: -38, rot: 0 },
    // (east of the north arm, which grew over where it stood)
    { type: 'belfry', x: 34, z: -58, rot: 0 },
    // (the cells' back against the east wall's inside face, south of its stair: see cellsSpot)
    cellsSpot(),
    { type: 'refectory', x: -40, z: 0, rot: 0 },
    { type: 'abbot', x: 30, z: 2, rot: 0 },
    // the town outside: the west lane, its north side, its south side. Never wall to wall: a roof's eaves stand 0.45 m
    // out, and two houses 0.2 m apart had their roofs and gables through each other (the owner, 2026-10-23: "the
    // buildings to the south east of pokrov are clipping into each other"); 1.2 m at least, an alley to slip down.
    north('tavern', -31), north('merchant', -45.3), north('merchant', -57.5), north('izba_two', -68.7),
    south('smithy', -30), south('merchant', -42.6), south('izba', -53.3),
    // the east lane
    north('merchant', 33.5), north('merchant', 45.7), north('izba_two', 57.9), north('izba', 67.6),
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
  // (two rows each side of the road, which runs down the lane at z = LANE: a row at 66 stood on it)
  for (const z of [50, 56, 72, 78]) for (const x of [-9, -3, 13, 19]) stall(x + (z % 4) * 0.6, z, n++);
  // what is piled at the ramp's foot and along the lanes
  out.push(
    { kind: 'crate_big', x: -1.0, z: 47.5, rot: 0.2 }, { kind: 'crate_big', x: 0.1, z: 48.2, rot: 0.1 }, { kind: 'Barrel_01', x: 10.6, z: 47.2, rot: 0 }, { kind: 'barrel_03', x: 11.4, z: 48.0, rot: 0.5 },
    // (by the crates at the ramp's foot: it stood across the middle of the ramp, a hand in the air on its bank)
    { kind: 'concrete_road_barrier', x: -3.6, z: 47.2, rot: Q + 0.1 },
    { kind: 'wooden_crate_01', x: -38.4, z: 59.4, rot: 0.3 }, { kind: 'Barrel_01', x: -50.6, z: 69.2, rot: 0 }, { kind: 'trashbag', x: 39.5, z: 59.6, rot: 0.8 },
    // (the car off the road, pulled onto the verge past the last house)
    { kind: 'old_tyre', x: 62.6, z: 69.4, rot: 0.2 }, { kind: 'covered_car', x: -80, z: 72.5, rot: Q + 0.05 },
  );
  // THE COURT (2026-10-19, the owner: "pokrov needs a polish pass really bad"): it was a lawn with buildings on it.
  // The monks' kitchen garden north of the refectory, two beds in a white fence with its gate toward the court;
  out.push(...pokrovGarden());
  // the wood for the refectory's kitchen and the abbot's stove, and the stumps it was split on
  out.push({ kind: 'log_pile', x: -55, z: 0, rot: 0 }, { kind: 'tree_stump_01', x: -55.6, z: 4.4, rot: 0.6 }, { kind: 'log_pile', x: 39.5, z: 4, rot: 0.05 }, { kind: 'tree_stump_01', x: 40.6, z: 8.2, rot: 2.1 });
  // benches either side of the church's west door and of its south arm's (each faces away from the wall it stands against)
  out.push({ kind: 'painted_wooden_bench', x: -10.6, z: -42.5, rot: -Q }, { kind: 'painted_wooden_bench', x: -10.6, z: -33.5, rot: -Q }, { kind: 'painted_wooden_bench', x: 8.0, z: -21.4, rot: 0 }, { kind: 'painted_wooden_bench', x: 16.0, z: -21.4, rot: 0 });
  return out;
}

/** the kitchen garden: its two beds (as POKROV_GROUND's), and its fence, with a gap on its east side toward the court's path */
const GARDEN = { x0: -54, z0: -26, x1: -31, z1: -10, gate: [-18.5, -16.5] as [number, number], beds: [[-52, -24, -44, -12], [-41, -24, -33, -12]] as [number, number, number, number][] };
function pokrovGarden(): TownThing[] {
  const out: TownThing[] = [], G = GARDEN;
  // (cabbages in the west bed, pumpkins in the east, in rows, a little askew)
  const [a, b] = G.beds;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) out.push({ kind: 'cabbage', x: a[0] + 1 + i * 1.5 + (j % 2) * 0.2, z: a[1] + 1.5 + j * 2, rot: i * 1.3 + j * 0.7 });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out.push({ kind: 'pumpkin', x: b[0] + 1 + i * 2 + (j % 2) * 0.3, z: b[1] + 2 + j * 2.5, rot: i * 0.9 + j * 1.7 });
  // (the fence in two-metre lengths, each run shared out evenly along its side; a length's own x runs along it)
  const run = (ax: number, az: number, bx: number, bz: number) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 2), rot = Math.atan2(-(bz - az), bx - ax);
    for (let k = 0; k < n; k++) out.push({ kind: 'fence_white', x: ax + ((bx - ax) * (k + 0.5)) / n, z: az + ((bz - az) * (k + 0.5)) / n, rot });
  };
  run(G.x0, G.z0, G.x1, G.z0);
  run(G.x0, G.z1, G.x1, G.z1);
  run(G.x0, G.z0, G.x0, G.z1);
  run(G.x1, G.z0, G.x1, G.gate[0]);
  run(G.x1, G.gate[1], G.x1, G.z1);
  return out;
}

/** the court's well, in its frame, and which way it is turned (its windlass across the path beside it) */
export const POKROV_WELL = { x: -20, z: -4, rot: 0.5 };

/** the court's trees: an avenue of birches from the Holy Gate, an oak by the abbot's house, ashes and bushes about it (kind, x, z, size) */
export const POKROV_TREES: [string, number, number, number][] = [
  ['birch_a', 0.5, 11, 1.0], ['birch_a', 9.5, 11, 0.95], ['birch_a', 0.5, 3, 1.05], ['birch_a', 9.5, 3, 1.0], ['birch_a', 0.5, -5, 0.95], ['birch_a', 9.5, -5, 1.05],
  ['oak_a', 45, -5, 1.1], ['ash_a', -24, -74, 1.0], ['ash_a', 52, -46, 0.95],
  ['bush_a', -70, -42, 0.9], ['bush_b', -56, 10, 1.0], ['bush_a', 52, 13, 0.9], ['bush_b', -6, -80, 1.0], ['bush_a', -60, -20, 0.85], ['bush_b', 24, 12, 0.9],
];

/** the market and the ramp cobbled (gravel), the lanes trodden; the terrace under the monastery */
export const POKROV_GROUND: TownGround = {
  yards: [[-13, 47, 23, 81]],
  lanes: [
    { line: [[5, 18], [5, 48]], w: 6 },
    { line: [[-130, LANE], [-16, LANE]], w: 6 },
    { line: [[26, LANE], [135, LANE]], w: 6 },
    { line: [[5, 80], [6, 118]], w: 5 },
    // (the bunker road out of the north gate)
    { line: [[-44, -75], [-58, -112]], w: 4 },
    // the court's paths: from the Holy Gate to the church's south arm (lit), round the church, out to the north gate,
    // the church's west door, the refectory, the garden's gate, the abbot's house and the cells (dark)
    { line: [[5, 17], [5, -10], [12, -20]], w: 4 },
    { line: [[-14, -16], [-14, -58], [24, -58], [30, -52], [41, -48], [41, -28], [36, -16], [-14, -16]], w: 3, dark: true },
    { line: [[-42.5, -70], [-28, -62], [-14, -58]], w: 3, dark: true },
    { line: [[-14, -38], [-9.75, -38]], w: 3, dark: true },
    { line: [[-14, -16], [-29, -8]], w: 3, dark: true },
    { line: [[-14, -17.5], [-31, -17.5]], w: 2.5, dark: true },
    { line: [[36, -16], [32, -2]], w: 3, dark: true },
    { line: [[41, -28], [56, -10]], w: 3, dark: true },
  ],
  beds: GARDEN.beds,
  terraces: [POKROV_TERRACE],
};

