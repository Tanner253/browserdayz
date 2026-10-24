// The desert's places for whoever starts on the coast (2026-10-18), the owner: "we need to add more residential tier 1
// buildings on the road out of the desert to the pass for basics, simple backpacks, melee weapons etc.. flashlights food
// water etc... add a store buildings", and "new t1 and t2 buildings with roads attached in the desert that makes sense.
// we want the most of the desert to be baren but we need a middle ground". Three, each on a road, the rest left bare:
//   Peski     a hamlet by the beach where the main road comes off the coast, with a store: the first step
//   Karavan   a roadhouse halfway to the pass, with a store and a garage: the first step
//   Blokpost  the army's post on the track down to Kalat: the second step
//   Bereg     fishermen's houses on the north coast, up the coast track: the first step
//   Mys       a farmstead on the south coast, where the road round Kalat comes to the beach: the first step
// Pure numbers, the same for the game and the server; each in its own frame (x east, z south of its middle), as the
// towns of src/sim/towns.ts are. Not places apart (src/sim/apart.ts): they are the map's own first and second steps.

import type { Town, TownGround, TownSpot } from './towns';
import type { TownThing } from './zavod';

const PI = Math.PI;

/** by the beach, south of the main road where it leaves the coast; its lane east and west, the road in from the north at x -10 and on south from the east end */
export const PESKI: Town = { name: 'Peski', x: -3470, z: 70, pad: [62, 42], rot: 0 };
/** north of the main road halfway from Kalat's track to the pass; its lane east and west, the road in from the south at x 0 */
export const KARAVAN: Town = { name: 'Karavan', x: -2905, z: -175, pad: [52, 34], rot: 0 };
/** east of the track down to Kalat; its lane in from the track at the west */
export const BLOKPOST: Town = { name: 'Blokpost', x: -2930, z: 110, pad: [40, 32], rot: 0 };
/** on the north coast at the end of the coast track; its lane east and west, the track in from the south at x -20 */
export const BEREG: Town = { name: 'Bereg', x: -3520, z: -380, pad: [56, 40], rot: 0 };
/** on the south coast at the end of the road round Kalat; its lane east and west, the road in from the north at x 20 */
export const MYS: Town = { name: 'Mys', x: -3520, z: 500, pad: [56, 40], rot: 0 };

/**
 * The dig camp of the archaeologists who dug Kalat, on the flat south-west of it by the road round it (2026-10-23, the
 * owner of the desert's plan: "Everything looks good"): the site office, the tents, the finds' and the tools' stores,
 * the generator, the tables the finds are sorted on, and the trench. Its yard in from that road at the south.
 */
export const LAGER: Town = { name: 'Lager', x: -3285, z: 392, pad: [38, 26], rot: -0.1 };

export const DESERT_TOWNS: Town[] = [PESKI, KARAVAN, BLOKPOST, BEREG, MYS];
/**
 * The desert's places since the map was numbered: laid after every other (src/sim/towns.ts LATER_TOWNS), and stocked
 * apart, on top of the map, as Kalat that it dug is (src/sim/apart.ts): of the step, it would take the others' things.
 */
export const DESERT_LATER: Town[] = [LAGER];
/** their loot steps (see westTier) */
export const DESERT_TIERS: Record<string, 1 | 2> = { Peski: 1, Karavan: 1, Blokpost: 2, Bereg: 1, Mys: 1, Lager: 2 };

// (a building north of a lane faces south, rot 0; south of it, north, rot PI)
const N = 0, S = PI;

const BUILDINGS: Record<string, TownSpot[]> = {
  Peski: [
    { type: 'store', x: -34, z: -8, rot: N },
    { type: 'house_small', x: 8, z: -7, rot: N },
    { type: 'house_small', x: 26, z: -7, rot: N },
    { type: 'shed', x: 42, z: -5.5, rot: N },
    { type: 'shanty', x: -32, z: 11.5, rot: S },
    { type: 'house_small', x: -10, z: 7, rot: S },
    { type: 'hut', x: 12, z: 6, rot: S },
    { type: 'house_small', x: 32, z: 7, rot: S },
  ],
  Karavan: [
    { type: 'tavern', x: -26, z: 1, rot: N },
    { type: 'store', x: 0, z: 2.5, rot: N },
    { type: 'garage', x: 22, z: 2.5, rot: N },
    { type: 'house_small', x: -30, z: 17.5, rot: S },
    { type: 'cabin', x: -14, z: 16.5, rot: S },
    { type: 'shed', x: 26, z: 16, rot: S },
  ],
  Bereg: [
    { type: 'shanty', x: -38, z: -11.5, rot: N },
    { type: 'house_small', x: -2, z: -7, rot: N },
    { type: 'house_small', x: 16, z: -7, rot: N },
    { type: 'shed', x: 32, z: -5.5, rot: N },
    { type: 'house_small', x: -38, z: 7, rot: S },
    { type: 'hut', x: -6, z: 6, rot: S },
    { type: 'shanty', x: 20, z: 11.5, rot: S },
    { type: 'shed', x: 38, z: 5.5, rot: S },
  ],
  Mys: [
    { type: 'house_small', x: -36, z: -7, rot: N },
    { type: 'cabin', x: -18, z: -6.5, rot: N },
    { type: 'house_small', x: 4, z: -7, rot: N },
    { type: 'shed', x: 38, z: -5.5, rot: N },
    { type: 'shanty', x: -34, z: 11.5, rot: S },
    { type: 'house_small', x: -2, z: 7, rot: S },
    { type: 'cabin', x: 36, z: 6.5, rot: S },
  ],
  Lager: [
    // (the site office at the west end of a row along the north, the tents the dig sleeps in east of it, the last
    // turned to the yard; the trench to the south-east)
    { type: 'hut', x: -24, z: -13.5, rot: N },
    { type: 'tent', x: -7.5, z: -14, rot: N + 0.05 },
    { type: 'tent', x: 2, z: -14.6, rot: N - 0.04 },
    { type: 'tent', x: 11.5, z: -13.8, rot: N + 0.08 },
    { type: 'tent', x: 28.5, z: -9, rot: -PI / 2 + 0.1 },
  ],
  Blokpost: [
    { type: 'guardpost', x: -30, z: -6, rot: N },
    { type: 'barracks', x: -4, z: -7.5, rot: N },
    { type: 'tower', x: 26, z: -12, rot: N },
    { type: 'garage', x: 8, z: 8.5, rot: S },
  ],
};

const THINGS: Record<string, TownThing[]> = {
  Peski: [
    { kind: 'Barrel_01', x: -24, z: -14, rot: 0 }, { kind: 'wooden_crate_01', x: -40, z: -14, rot: 0.4 }, { kind: 'old_tyre', x: 16, z: -12, rot: 0.2 },
    { kind: 'wooden_crate_01', x: -20, z: 18, rot: 1.1 }, { kind: 'Barrel_01', x: 22, z: 12, rot: 0 }, { kind: 'covered_car', x: 50, z: -14, rot: PI / 2 },
  ],
  Karavan: [
    { kind: 'Barrel_01', x: 30, z: -4, rot: 0 }, { kind: 'Barrel_01', x: 31.5, z: -3, rot: 0 }, { kind: 'old_tyre', x: 15, z: -4, rot: 0.6 },
    { kind: 'covered_car', x: 40, z: 4, rot: PI / 2 }, { kind: 'wooden_crate_01', x: -36, z: 6, rot: 0.3 }, { kind: 'cardboard_box_01', x: 8, z: -3, rot: 0.2 },
  ],
  Bereg: [
    { kind: 'Barrel_01', x: -26, z: -16, rot: 0 }, { kind: 'wooden_crate_01', x: 8, z: -14, rot: 0.6 }, { kind: 'old_tyre', x: 28, z: 14, rot: 0.3 }, { kind: 'wooden_crate_01', x: -22, z: 14, rot: 1.2 },
  ],
  Mys: [
    { kind: 'Barrel_01', x: -8, z: -14, rot: 0 }, { kind: 'wooden_crate_01', x: 20, z: -12, rot: 0.2 }, { kind: 'cardboard_box_01', x: 16, z: 14, rot: 0.9 }, { kind: 'covered_car', x: -50, z: 14, rot: PI / 2 },
  ],
  Lager: [
    // the finds' store and the tools' store, end to end with the yard
    { kind: 'container_shell@0', x: -30, z: 7.5, rot: PI / 2 + 0.05 }, { kind: 'container_shell@1', x: -29.6, z: 14, rot: PI / 2 - 0.04 },
    // the generator and its gas by the office, the drums of fuel
    { kind: 'portable_generator', x: -19.5, z: -6.5, rot: 0.3 }, { kind: 'propane_tank', x: -21.2, z: -6.9, rot: 0 }, { kind: 'propane_tank', x: -21.8, z: -5.8, rot: 0 },
    { kind: 'Barrel_01', x: -21, z: 6.5, rot: 0 }, { kind: 'Barrel_01', x: -19.9, z: 7.4, rot: 0 },
    // the tables the finds are sorted on, and what they came up in
    { kind: 'WoodenTable_01', x: 3, z: 1.5, rot: 0.04 }, { kind: 'WoodenTable_01', x: 6.2, z: 1.7, rot: -0.03 },
    { kind: 'cardboard_box_01', x: 0.3, z: 2.4, rot: 0.5 }, { kind: 'wooden_crate_01', x: 9.6, z: 1.2, rot: 0.2 }, { kind: 'wooden_crate_01', x: 9.9, z: 2.6, rot: 1.3 },
    // the fire they eat round
    { kind: 'stone_fire_pit', x: -7, z: 5.5, rot: 0 }, { kind: 'wooden_crate_01', x: -9.4, z: 6.8, rot: 0.7 },
    // the trench's rim: a spade left in the spoil, the ladder down into it, the buckets the spoil goes up in, the
    // crates the day's finds go in; the truck by the tents
    { kind: 'shovel', x: 13.2, z: 11.6, rot: 0.6 }, { kind: 'wooden_crate_01', x: 26.6, z: 9.8, rot: 0.3 },
    { kind: 'wooden_ladder', x: 16.4, z: 12.2, rot: -0.7 }, { kind: 'mop_bucket', x: 14.6, z: 10.4, rot: 0.2 }, { kind: 'mop_bucket', x: 24.2, z: 9.4, rot: 1.9 },
    { kind: 'wooden_crate_01', x: 11.4, z: 2.4, rot: 0.8 }, { kind: 'painted_wooden_stool', x: 3.6, z: 3.2, rot: 0.3 }, { kind: 'painted_wooden_stool', x: 6.6, z: 0.2, rot: 2.6 },
    { kind: 'covered_car', x: 31, z: 6, rot: PI / 2 },
  ],
  Blokpost: [
    { kind: 'wooden_military_crate', x: 6, z: -14, rot: 0 }, { kind: 'old_military_crate@0', x: -14, z: -14, rot: 0.1 }, { kind: 'Barrel_01', x: 18, z: 12, rot: 0 },
  ],
};

const GROUND: Record<string, TownGround> = {
  Peski: { yards: [[-44, -14, -24, -2]], lanes: [{ line: [[-66, 0], [62, 0]], w: 5 }] },
  Karavan: { yards: [[-38, -6, 32, 8]], lanes: [{ line: [[-56, 10], [56, 10]], w: 5 }, { line: [[0, 10], [0, 36]], w: 5 }] },
  Blokpost: { yards: [[-20, -16, 14, 16]], lanes: [{ line: [[-46, 0], [32, 0]], w: 4 }] },
  Bereg: { yards: [], lanes: [{ line: [[-60, 0], [56, 0]], w: 4.5 }] },
  Mys: { yards: [], lanes: [{ line: [[-60, 0], [56, 0]], w: 4.5 }] },
  // (the yard; the track in to it trodden down the bank from the road round Kalat, the ground as it is, no road's bed:
  // the road is 4 m over the camp's flat and 30 m off, too steep for one; lamps down it, as each town has; the trench,
  // a hollow a man's height deep, and the spoil dug out of it heaped beside it)
  Lager: { yards: [[-34, -8, 22, 9]], lanes: [{ line: [[-6, 56], [-4, 26], [-3, 6]], w: 4 }], mounds: [[20, 16, 8, -1.4, 4.5], [30.5, 19, 4.5, 0.9, 1], [29, 11.5, 3.5, 0.6, 0.6]] },
};

export const desertBuildings = (t: Town): TownSpot[] => BUILDINGS[t.name] ?? [];
export const desertThings = (t: Town): TownThing[] => THINGS[t.name] ?? [];
export const desertGround = (t: Town): TownGround | null => GROUND[t.name] ?? null;
