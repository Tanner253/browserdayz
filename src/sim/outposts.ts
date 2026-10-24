// The small places of the open country (2026-10-23, the owner: "the desert needs some buildings north of the river on
// spawn. And up alongside it. The valley that runs up the map on the north side needs some buildings too maybe"; their
// plans, progress/world-polish/desert-plan.png and plan2.png: "Everything looks good", "1 yes"). Each a few of our
// own houses and real models with a reason to be there; each set down where the kept stashes are well clear
// (scripts/stash-guard.ts), laid after everything else (src/sim/towns.ts LATER_TOWNS) and stocked apart, on top of the
// map (src/sim/apart.ts). In its own frame as a town is: x east, z south of its middle.
// Pure numbers, the same for the game and the server.

import type { Town, TownGround, TownSpot } from './towns';
import type { TownThing } from './zavod';

const PI = Math.PI, Q = PI / 2;

/** a desert well and the herders who water at it, by the coast track north of Bereg */
export const KOLODETS: Town = { name: 'Kolodets', x: -3330, z: -575, pad: [30, 24], rot: 0.1 };
/** a crop-dusters' strip on the north flats: its hangar, its fuel, its tower, and a helicopter that did not make it */
export const AERODROM: Town = { name: 'Aerodrom', x: -3020, z: -600, pad: [72, 32], rot: -0.05 };
/** a quarry dug into the desert's south: its pit and faces, the crusher's shed, the site's cabin */
export const KARYER: Town = { name: "Kar'yer", x: -2960, z: 640, pad: [56, 42], rot: 0.15 };
/** a fishing camp on the beach between Peski and Bereg */
export const RYBAKI: Town = { name: 'Rybaki', x: -3505, z: -160, pad: [30, 24], rot: 0 };
/** a campsite on the beach south of Peski */
export const KEMPING: Town = { name: 'Kemping', x: -3505, z: 285, pad: [32, 26], rot: 0 };
/** the fishers' huts at the river's mouth, on its north bank */
export const USTYE: Town = { name: "Ust'ye", x: -3570, z: -485, pad: [34, 26], rot: 0 };
/** the pump station that waters the desert's fields from the river, on its north bank */
export const NASOSNAYA: Town = { name: 'Nasosnaya', x: -3240, z: -465, pad: [26, 22], rot: 0.2 };
/** a camp at the ford below the brick works */
export const BROD: Town = { name: 'Brod', x: -2870, z: -405, pad: [26, 22], rot: -0.15 };
/** a watermill in the north valley */
export const MELNITSA: Town = { name: "Mel'nitsa", x: -1760, z: -505, pad: [34, 28], rot: 0.3 };
/** a farmstead on the north valley's rim */
export const KHUTOR: Town = { name: 'Khutor', x: -1560, z: -575, pad: [34, 28], rot: -0.2 };
/** the forest ranger's post */
export const KORDON: Town = { name: 'Kordon', x: -1300, z: -480, pad: [28, 24], rot: 0.1 };

export const OUTPOSTS: Town[] = [KOLODETS, AERODROM, KARYER, RYBAKI, KEMPING, USTYE, NASOSNAYA, BROD, MELNITSA, KHUTOR, KORDON];
/** their loot steps: the coast's and the desert's first and second, the valley's second (see westTier) */
export const OUTPOST_TIERS: Record<string, 1 | 2> = { Kolodets: 1, Aerodrom: 2, "Kar'yer": 2, Rybaki: 1, Kemping: 1, "Ust'ye": 1, Nasosnaya: 1, Brod: 1, "Mel'nitsa": 2, Khutor: 2, Kordon: 2 };

// (a building north of a lane faces south, rot 0; south of it, north, rot PI)
const N = 0, S = PI;

const BUILDINGS: Record<string, TownSpot[]> = {
  Kolodets: [
    // (the pump house over the well's pipe, the herders' bunkhouse, their two tents)
    { type: 'shed', x: -10, z: -7, rot: N + 0.1 },
    { type: 'hut', x: 12, z: -11, rot: N },
    { type: 'tent', x: -17, z: 10, rot: Q },
    { type: 'tent', x: -5, z: 14, rot: S - 0.1 },
  ],
  Aerodrom: [
    // (along the strip's north side: the hangar, the tower, the workshop; the strip runs east and west at z 9)
    { type: 'barn', x: -22, z: -14, rot: N },
    { type: 'guardpost', x: 4, z: -12, rot: N },
    { type: 'garage', x: 34, z: -13, rot: N - 0.05 },
  ],
  "Kar'yer": [
    // (on the bench west of the pit: the site's cabin, the crusher's shed, a store)
    { type: 'hut', x: -36, z: -26, rot: N },
    { type: 'garage', x: -40, z: 8, rot: Q },
    { type: 'shed', x: -46, z: -10, rot: Q + 0.2 },
  ],
  Rybaki: [
    // (the house on piles toward the sea, the net shed, the smokehouse)
    { type: 'shanty', x: -6, z: 2, rot: -Q },
    { type: 'shed', x: 10, z: -8, rot: N + 0.2 },
    { type: 'smokehouse', x: 12, z: 8, rot: S + 0.3 },
  ],
  Kemping: [
    // (the warden's cabin, three tents about the fires, a shed for the boats)
    { type: 'cabin', x: -18, z: -12, rot: N },
    { type: 'tent', x: 0, z: -12, rot: N + 0.1 },
    { type: 'tent', x: 11, z: -10, rot: N - 0.15 },
    { type: 'tent', x: 9, z: 12, rot: S + 0.1 },
    { type: 'shed', x: -20, z: 10, rot: Q },
  ],
  "Ust'ye": [
    // (two plank houses, the boathouse at the bank, the smokehouse and a shed)
    { type: 'shanty', x: -14, z: -4, rot: S },
    { type: 'boathouse', x: 6, z: 16, rot: S },
    { type: 'smokehouse', x: 12, z: -8, rot: N + 0.2 },
    { type: 'shed', x: 22, z: 2, rot: -Q },
  ],
  Nasosnaya: [
    // (the pump house facing the river, the workers' hut behind it)
    { type: 'garage', x: 0, z: 4, rot: S },
    { type: 'hut', x: -2, z: -12, rot: N },
  ],
  Brod: [
    // (two tents by the ford, a shed of stores)
    { type: 'tent', x: -8, z: -6, rot: N + 0.15 },
    { type: 'tent', x: 4, z: -8, rot: N - 0.1 },
    { type: 'shed', x: 14, z: 4, rot: -Q },
  ],
  "Mel'nitsa": [
    // (the mill along the stream, the miller's house, his shed)
    { type: 'sawmill', x: 0, z: -6, rot: N },
    { type: 'izba_two', x: -4, z: 13, rot: S },
    { type: 'shed', x: 14, z: 12, rot: S + 0.2 },
  ],
  Khutor: [
    // (the farmhouse, its barn across the yard, two sheds)
    { type: 'izba_two', x: -12, z: -10, rot: N },
    { type: 'barn', x: 10, z: 8, rot: S },
    { type: 'shed', x: 14, z: -12, rot: N + 0.1 },
    { type: 'shed', x: -18, z: 12, rot: Q },
  ],
  Kordon: [
    // (the ranger's house, his high seat over the clearing, the dogs' shed)
    { type: 'izba', x: -6, z: -6, rot: N },
    { type: 'tower', x: 12, z: 8, rot: -Q - 0.2 },
    { type: 'shed', x: 6, z: -10, rot: N },
  ],
};

/** a run of fence panels of a kind from a to b, every 2 m, a gap where `gone` says (by number) */
function fence(kind: string, a: [number, number], b: [number, number], gone: number[] = []): TownThing[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / 2)), step = len / n;
  const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len, rot = Math.atan2(-dz, dx), out: TownThing[] = [];
  for (let k = 0; k < n; k++) if (!gone.includes(k)) out.push({ kind, x: a[0] + dx * (k + 0.5) * step, z: a[1] + dz * (k + 0.5) * step, rot: rot + ((k * 5) % 3 - 1) * 0.04 });
  return out;
}

const THINGS: Record<string, TownThing[]> = {
  Kolodets: [
    // (the well is the game's own, drawn and drunk at: src/sim/wells.ts; its yard here)
    ...fence('fence_grey', [6, 4], [22, 4], [3]), ...fence('fence_grey', [22, 4], [22, 18]), ...fence('fence_grey', [22, 18], [6, 18], [5]), ...fence('fence_grey', [6, 18], [6, 4], [2]),
    { kind: 'Barrel_01', x: -7.4, z: -3.6, rot: 0 }, { kind: 'metal_jerrycan_green', x: -8.6, z: -3.2, rot: 0.4 }, { kind: 'propane_tank', x: -13.6, z: -4.8, rot: 0 },
    { kind: 'stone_fire_pit', x: -9, z: 6, rot: 0 }, { kind: 'wooden_crate_01', x: -11.4, z: 7.2, rot: 0.6 }, { kind: 'old_tyre', x: 16, z: -5, rot: 0.3 },
  ],
  Aerodrom: [
    // the fuel for the planes, its drums; a container of spares; the crates off the last delivery
    { kind: 'fuel_station', x: 18, z: -10, rot: 0 },
    { kind: 'Barrel_01', x: 24, z: -6, rot: 0 }, { kind: 'Barrel_01', x: 25.2, z: -6.6, rot: 0 }, { kind: 'Barrel_01', x: 24.4, z: -7.8, rot: 0 }, { kind: 'barrel_03', x: 26.4, z: -5.4, rot: 0.4 },
    { kind: 'container_shell@1', x: -42, z: -14, rot: Q + 0.04 }, { kind: 'crate_big', x: -10, z: -8, rot: 0.2 }, { kind: 'crate_big', x: -8.8, z: -7.6, rot: 0.6 },
    { kind: 'wooden_crate_01', x: 8.6, z: -9.2, rot: 0.3 }, { kind: 'old_tyre', x: 40, z: -6, rot: 0.8 }, { kind: 'covered_car', x: 48, z: -12, rot: Q },
    // the helicopter that did not make the strip, off its east end
    { kind: 'heli_wreck', x: 62, z: 20, rot: 0.5 },
  ],
  "Kar'yer": [
    // the faces of the pit, its rock stood into its walls, its floor's stones
    { kind: 'namaqualand_cliff_02', x: 16, z: -26, rot: PI + 0.1 }, { kind: 'namaqualand_cliff_02', x: 40, z: -6, rot: -Q + 0.15 },
    { kind: 'namaqualand_cliff_01', x: 30, z: 22, rot: 0.6 }, { kind: 'namaqualand_boulder_04', x: 20, z: 4, rot: 1.1 }, { kind: 'boulder_01', x: 12, z: 12, rot: 2.3 },
    // the site's things on its bench
    { kind: 'container_shell@0', x: -30, z: 18, rot: 0.08 }, { kind: 'portable_generator', x: -30, z: -16, rot: 0.4 }, { kind: 'propane_tank', x: -31.6, z: -16.4, rot: 0 },
    { kind: 'Barrel_01', x: -48, z: 0, rot: 0 }, { kind: 'Barrel_01', x: -46.8, z: 0.6, rot: 0 }, { kind: 'crate_big', x: -34, z: -4, rot: 0.3 },
    { kind: 'old_tyre', x: -26, z: 0, rot: 0.5 }, { kind: 'old_tyre', x: -25.2, z: 1.2, rot: 1.6 }, { kind: 'covered_car', x: -22, z: -32, rot: Q + 0.1 },
  ],
  Rybaki: [
    { kind: 'stone_fire_pit', x: 2, z: 12, rot: 0 }, { kind: 'wooden_crate_01', x: 4.6, z: 13.4, rot: 0.4 }, { kind: 'Barrel_01', x: 14, z: -3, rot: 0 },
    { kind: 'barrel_03', x: 15.2, z: -2.4, rot: 0.6 }, { kind: 'log_pile', x: 18, z: 14, rot: 0.3 }, { kind: 'old_tyre', x: -16, z: -14, rot: 0.2 },
    // (what the sea leaves on the line of its tides: bleached branches)
    { kind: 'dead_quiver_branch_01', x: -22, z: 8, rot: 0.8 }, { kind: 'dead_quiver_branch_01', x: -24, z: -6, rot: 2.1 }, { kind: 'dead_quiver_branch_01', x: -21, z: 16, rot: 1.4 },
  ],
  Kemping: [
    { kind: 'stone_fire_pit', x: 4, z: 0, rot: 0 }, { kind: 'stone_fire_pit', x: -8, z: 4, rot: 0 },
    { kind: 'painted_wooden_table', x: -2, z: 6, rot: 0.2 }, { kind: 'painted_wooden_bench', x: -2, z: 7.6, rot: 0.2 }, { kind: 'painted_wooden_bench', x: -2.4, z: 4.4, rot: PI + 0.2 },
    { kind: 'covered_car', x: 22, z: 2, rot: Q }, { kind: 'cardboard_box_01', x: 6, z: -3, rot: 0.5 }, { kind: 'Barrel_01', x: -14, z: -4, rot: 0 },
    { kind: 'wooden_crate_01', x: 15.4, z: 8, rot: 1.1 }, { kind: 'metal_jerrycan_green', x: 19.6, z: 0, rot: 0.2 },
  ],
  "Ust'ye": [
    { kind: 'stone_fire_pit', x: 0, z: -12, rot: 0 }, { kind: 'wooden_crate_01', x: 2.6, z: -13.4, rot: 0.3 }, { kind: 'Barrel_01', x: 16, z: -3, rot: 0 },
    { kind: 'log_pile', x: -2, z: 8, rot: 1.2 }, { kind: 'old_tyre', x: 24, z: 12, rot: 0.4 }, { kind: 'barrel_03', x: 9.4, z: -10.4, rot: 0.2 },
    { kind: 'dead_tree_trunk', x: -26, z: 14, rot: 0.4 },
  ],
  Nasosnaya: [
    { kind: 'container_shell@1', x: 14, z: -4, rot: 0.06 }, { kind: 'portable_generator', x: -8, z: 2, rot: 0.3 }, { kind: 'propane_tank', x: -9.6, z: 1.6, rot: 0 },
    { kind: 'Barrel_01', x: 8, z: 12, rot: 0 }, { kind: 'Barrel_01', x: 9.2, z: 12.6, rot: 0 }, { kind: 'metal_jerrycan_green', x: 7.4, z: 13.6, rot: 0.6 },
    { kind: 'old_tyre', x: -14, z: -4, rot: 0.5 }, { kind: 'wooden_crate_01', x: 10, z: -10, rot: 0.2 },
  ],
  Brod: [
    { kind: 'stone_fire_pit', x: -2, z: 4, rot: 0 }, { kind: 'covered_car', x: 14, z: -10, rot: Q - 0.1 },
    // (the water carried up from the ford, in drums)
    { kind: 'barrel_03', x: -10, z: 6, rot: 0 }, { kind: 'barrel_03', x: -11.2, z: 6.6, rot: 0.5 }, { kind: 'Barrel_01', x: -9.8, z: 7.6, rot: 0 },
    { kind: 'wooden_crate_01', x: 2.6, z: 5.2, rot: 0.9 }, { kind: 'metal_jerrycan_green', x: 9, z: 1, rot: 0.3 },
  ],
  "Mel'nitsa": [
    // (the sawpit: the logs waiting, the trunks dragged in)
    { kind: 'log_pile', x: 16, z: -12, rot: 0 }, { kind: 'log_pile', x: 18, z: -6, rot: 0.2 }, { kind: 'dead_tree_trunk_02', x: 22, z: 0, rot: 1.4 },
    { kind: 'dead_tree_trunk_02', x: 21, z: 4, rot: 1.6 }, { kind: 'wooden_crate_01', x: -14, z: -4, rot: 0.4 }, { kind: 'Barrel_01', x: -13, z: 4, rot: 0 },
    ...fence('fence_white', [-12, 19], [4, 19], [4]), { kind: 'tree_stump_01', x: 10, z: 20, rot: 0.6 },
  ],
  Khutor: [
    // (the yard fenced, its gate to the track)
    ...fence('fence_grey', [-24, -20], [24, -20], [11]), ...fence('fence_grey', [24, -20], [24, 20]), ...fence('fence_grey', [24, 20], [-24, 20], [3, 4]), ...fence('fence_grey', [-24, 20], [-24, -20], [9]),
    { kind: 'log_pile', x: -20, z: -4, rot: Q }, { kind: 'old_tyre', x: 2, z: 2, rot: 0.3 }, { kind: 'covered_car', x: -2, z: 12, rot: Q + 0.2 },
    { kind: 'Barrel_01', x: 18, z: -4, rot: 0 }, { kind: 'metal_jerrycan_green', x: 19, z: -3, rot: 0.4 }, { kind: 'wooden_crate_01', x: 4, z: -8, rot: 0.7 },
  ],
  Kordon: [
    { kind: 'log_pile', x: -16, z: -6, rot: Q }, { kind: 'log_pile', x: -16, z: 2, rot: Q + 0.1 }, { kind: 'covered_car', x: -4, z: 10, rot: Q },
    { kind: 'Barrel_01', x: 10, z: -4, rot: 0 }, { kind: 'wooden_crate_01', x: 2, z: -4, rot: 0.3 },
    ...fence('fence_white', [-14, -16], [2, -16], [4]),
  ],
};

const GROUND: Record<string, TownGround> = {
  Kolodets: { yards: [[-14, -12, 0, 8]], lanes: [{ line: [[-30, 2], [-12, 0]], w: 4 }] },
  // (the strip, graded flat and trodden; the apron along its north side)
  Aerodrom: { yards: [[-30, -20, 42, -5]], lanes: [{ line: [[-70, 9], [70, 9]], w: 14, dark: true }, { line: [[4, -5], [4, 2]], w: 4 }] },
  // (the pit: 6 m deep, its floor 36 m across, its walls falling from its rim over 20 m; its bench west of it trodden)
  "Kar'yer": { yards: [[-52, -32, -24, 22]], lanes: [{ line: [[-24, 0], [-2, 4]], w: 5 }], mounds: [[16, 0, 38, -6, 18]] },
  Rybaki: { yards: [], lanes: [{ line: [[28, -2], [8, 4]], w: 3.5 }] },
  Kemping: { yards: [[-10, -4, 12, 8]], lanes: [{ line: [[32, 2], [-14, 0]], w: 4 }] },
  "Ust'ye": { yards: [[-6, -16, 16, 0]], lanes: [{ line: [[0, -28], [2, -4]], w: 3.5 }] },
  Nasosnaya: { yards: [[-12, -6, 12, 14]], lanes: [{ line: [[-26, -4], [-6, -2]], w: 4 }] },
  Brod: { yards: [[-14, -12, 10, 8]], lanes: [{ line: [[-26, 0], [-12, 0]], w: 4 }] },
  "Mel'nitsa": { yards: [[10, -16, 26, 6]], lanes: [{ line: [[-34, 4], [-14, 4], [12, 4]], w: 4 }], beds: [[-12, 19.5, 4, 26]] },
  Khutor: { yards: [[-6, -8, 6, 6]], lanes: [{ line: [[-2, -40], [-2, -20]], w: 4 }], beds: [[-22, 4, -6, 18]] },
  Kordon: { yards: [[-14, -2, 6, 12]], lanes: [{ line: [[-28, 4], [-6, 4]], w: 4 }], beds: [[-14, -22, 2, -16.5]] },
};

/** where each place's well stands, in its frame, and its turn (the game's own wells: src/sim/wells.ts) */
const WELLS: Record<string, { x: number; z: number; rot: number }> = { Kolodets: { x: -1, z: 1, rot: 0.4 } };

export const isOutpost = (t: Town) => t.name in BUILDINGS;
export const outpostBuildings = (t: Town): TownSpot[] => BUILDINGS[t.name] ?? [];
export const outpostThings = (t: Town): TownThing[] => THINGS[t.name] ?? [];
export const outpostGround = (t: Town): TownGround | null => GROUND[t.name] ?? null;
export const outpostWell = (t: Town) => WELLS[t.name] ?? null;
