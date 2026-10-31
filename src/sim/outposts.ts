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
export const USTYE: Town = { name: "Ust'ye", x: -3570, z: -460, pad: [34, 26], rot: 0 };
/** the pump station that waters the desert's fields from the river, on its north bank */
export const NASOSNAYA: Town = { name: 'Nasosnaya', x: -3244, z: -441, pad: [26, 22], rot: 0 };
/** a camp at the ford below the brick works */
export const BROD: Town = { name: 'Brod', x: -2890, z: -362, pad: [26, 22], rot: -0.15 };
/** a sawmill in the north valley, where the timber off its slopes comes down to the road */
export const MELNITSA: Town = { name: "Mel'nitsa", x: -1760, z: -505, pad: [34, 28], rot: 0.3 };
/** a farmstead on the north valley's rim */
export const KHUTOR: Town = { name: 'Khutor', x: -1560, z: -575, pad: [34, 28], rot: -0.2 };
/** the forest ranger's post */
export const KORDON: Town = { name: 'Kordon', x: -1300, z: -480, pad: [28, 24], rot: 0.1 };
/**
 * The army's camp over Bunker 17, in the gas (the owner, 2026-10-31: "put some buildings on top and around it in the gas").
 * In the bunker's own frame (x its right, z toward its way out: src/sim/bunker.ts), on the hollow's level ground as it is:
 * its dig is under the pad between, and a pad levelled here would fill it.
 */
export const GORODOK: Town = { name: 'Gorodok', x: -1450, z: -320, pad: [62, 62], rot: -1.0458, asIs: true };
/**
 * A test range's observation post on the table top of a mesa in the desert, seen for kilometres (the way down's first stop:
 * src/sim/sites.ts). Its strong room is what the blue card opens.
 */
export const STOLOVAYA: Town = { name: 'Stolovaya', x: -2580, z: 380, pad: [46, 36], rot: 0.2, asIs: true };
// (the way down's other stops, on the ground as it lies. Each mine portal is turned to look straight out of the rock it stands against:
// the ground's own fall there; the siding runs along the contour)
export const BOLOTNAYA: Town = { name: 'Bolotnaya', x: -2024, z: 666, pad: [40, 30], rot: 0, asIs: true };
export const KUPOL: Town = { name: 'Kupol', x: 720, z: -540, pad: [30, 30], rot: 0, asIs: true };
export const SIDING: Town = { name: 'Kupol Siding', x: 708, z: -474, pad: [20, 8], rot: -0.873, asIs: true };
export const MINE_W: Town = { name: 'Old Mine', x: -2389, z: 540, pad: [8, 8], rot: 2.53, asIs: true };
export const MINE_E: Town = { name: 'Old Mine East', x: -2104.5, z: 540, pad: [8, 8], rot: -0.478, asIs: true };

// (new ones at the end: what is laid after them keeps its numbers)
export const OUTPOSTS: Town[] = [KOLODETS, AERODROM, KARYER, RYBAKI, KEMPING, USTYE, NASOSNAYA, BROD, MELNITSA, KHUTOR, KORDON, GORODOK, STOLOVAYA, BOLOTNAYA, KUPOL, SIDING, MINE_W, MINE_E];
/** their loot steps: the coast's and the desert's first and second, the valley's second (see westTier) */
export const OUTPOST_TIERS: Record<string, 1 | 2 | 4> = { Gorodok: 4, Stolovaya: 2, Bolotnaya: 2, Kupol: 4, 'Kupol Siding': 2, 'Old Mine': 2, 'Old Mine East': 2, Kolodets: 1, Aerodrom: 2, "Kar'yer": 2, Rybaki: 1, Kemping: 1, "Ust'ye": 1, Nasosnaya: 1, Brod: 1, "Mel'nitsa": 2, Khutor: 2, Kordon: 2 };

// (a building north of a lane faces south, rot 0; south of it, north, rot PI)
const N = 0, S = PI;

const BUILDINGS: Record<string, TownSpot[]> = {
  Gorodok: [
    // (the men's quarters along the east of the yard, the motor pool beyond them, the decon tents by the way in, the gate)
    { type: 'barracks', x: 38, z: 14, rot: Q },
    { type: 'barracks', x: 53, z: 14, rot: Q },
    { type: 'garage', x: 42, z: 40, rot: S },
    { type: 'garage', x: 54, z: 40, rot: S },
    { type: 'hut', x: 18, z: 48, rot: N },
    { type: 'tent', x: -14, z: 36, rot: S },
    { type: 'tent', x: -23, z: 36, rot: S },
    { type: 'guardpost', x: 10, z: 60, rot: N },
  ],
  Stolovaya: [
    // (the observers' quarters, the instrument shop, the crew tent; and the guard post, its door to the reader, the strong room)
    { type: 'hut', x: -10, z: -18, rot: N },
    { type: 'barracks', x: -30, z: 10, rot: Q },
    { type: 'garage', x: 30, z: 20, rot: S },
    { type: 'tent', x: -4, z: 20, rot: S },
    { type: 'guardpost', x: 22, z: -10, rot: -Q },
  ],
  Bolotnaya: [
    // (the pump house, its door to the south and the sunken room under it; the keeper's shed; a barn the swamp has had)
    { type: 'guardpost', x: 0, z: 0, rot: N },
    { type: 'shed', x: 14, z: -8, rot: 0.3 },
    { type: 'barn_sunk', x: -26, z: -16, rot: 0.3 },
  ],
  Kupol: [
    // (the crew's strong room, its door to the dome and the reader by it; a hut for the watch)
    { type: 'guardpost', x: -12, z: 14, rot: S },
    { type: 'hut', x: 6, z: 30, rot: S },
  ],
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
    { type: 'boathouse', x: 6, z: 21, rot: S },
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
    // (the mill along the road, the sawyer's house, his shed)
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
  Gorodok: [
    // the way in, barred; what the camp ran on; what is left of the motor pool; the bunker's air
    { kind: 'concrete_road_barrier', x: -6, z: 58, rot: 0 }, { kind: 'concrete_road_barrier', x: -12, z: 58, rot: 0.04 }, { kind: 'concrete_road_barrier', x: -18, z: 57, rot: -0.1 },
    { kind: 'concrete_road_barrier', x: 22, z: 58, rot: 0 }, { kind: 'container_shell@0', x: 28, z: 40, rot: Q }, { kind: 'container_shell@1', x: 28, z: 32, rot: Q + 0.05 },
    { kind: 'uaz_469', x: 44, z: 28, rot: 0.3 }, { kind: 'covered_car', x: 58, z: 28, rot: Q },
    { kind: 'portable_generator', x: 30, z: 6, rot: 0.4 }, { kind: 'propane_tank', x: 29, z: 3.6, rot: 0 }, { kind: 'Barrel_01', x: 33, z: 30, rot: 0 }, { kind: 'Barrel_01', x: 34.2, z: 30.6, rot: 0 },
    { kind: 'barrel_03', x: 33.4, z: 31.8, rot: 0.5 }, { kind: 'metal_jerrycan_green', x: 35.6, z: 29.6, rot: 0.4 }, { kind: 'crate_big', x: 12, z: 36, rot: 0.2 }, { kind: 'crate_big', x: 13.4, z: 37.6, rot: 0.6 },
    { kind: 'wooden_military_crate', x: -18, z: 42, rot: 0.3 }, { kind: 'ventilator', x: 30, z: -8, rot: 0 }, { kind: 'ventilator', x: 34, z: -8, rot: 0 }, { kind: 'bunker_pipes', x: 32, z: -14, rot: Q },
    { kind: 'old_tyre', x: 62, z: 34, rot: 0.3 }, { kind: 'old_tyre', x: 61, z: 35, rot: 1.2 },
  ],
  Bolotnaya: [
    // the works of the pumps, and the reader by the door. A valve's wheel is its +z: each looks in at the pump house; the reader's panel, its +x, looks south
    { kind: 'card_reader', x: -2, z: 3.4, rot: -Q },
    { kind: 'valve_stand', x: -24, z: 12, rot: 2.03 }, { kind: 'valve_stand', x: 26, z: 8, rot: -1.87 }, { kind: 'valve_stand', x: 4, z: -26, rot: -0.15 },
    { kind: 'Barrel_01', x: 5, z: 4, rot: 0 }, { kind: 'barrel_03', x: 6.2, z: 3.4, rot: 0.3 }, { kind: 'portable_generator', x: -6, z: -5, rot: 0.8 }, { kind: 'concrete_road_barrier', x: -7, z: 6, rot: 0.1 }, { kind: 'old_tyre', x: 12, z: 6, rot: 0.5 },
  ],
  Kupol: [
    // the dome, its door (+x) to the south; the reader by the strong room, its panel (+x) looking north at the yard; three breakers (+x) looking in at the dome
    { kind: 'radar_dome', x: 0, z: 0, rot: -Q }, { kind: 'card_reader', x: -14.2, z: 10.7, rot: Q },
    { kind: 'breaker_box', x: -24, z: -6, rot: -0.245 }, { kind: 'breaker_box', x: 20, z: 8, rot: 2.76 }, { kind: 'breaker_box', x: 2, z: 24, rot: 1.65 },
    { kind: 'portable_generator', x: -18, z: 4, rot: 0.4 }, { kind: 'propane_tank', x: -20, z: 8, rot: 0 }, { kind: 'Barrel_01', x: 12, z: 18, rot: 0 }, { kind: 'wooden_military_crate', x: -7, z: 10, rot: 0.3 },
  ],
  'Kupol Siding': [
    // the track along the contour, the town's +x; the boxcar (its length its +z) on it, its door to +z here; the reader's panel (+x) to +z, at the door
    { kind: 'rail_track', x: -12, z: 0, rot: 0 }, { kind: 'rail_track', x: 0, z: 0, rot: 0 }, { kind: 'rail_track', x: 12, z: 0, rot: 0 },
    { kind: 'boxcar', x: 0, z: 0, rot: Q, up: 0.42 }, { kind: 'card_reader', x: -4, z: 3.4, rot: -Q },
  ],
  'Old Mine': [
    // the portal in the rock (+x straight out of it), and the reader (+x) looking out with it, to one side
    { kind: 'mine_portal', x: 0, z: 0, rot: 0 }, { kind: 'card_reader', x: 2.6, z: 3.8, rot: 0 }, { kind: 'mine_timber', x: 3.4, z: -5, rot: 0.2 }, { kind: 'ore_cart', x: 5, z: -2.6, rot: 1.2 },
  ],
  'Old Mine East': [
    { kind: 'mine_portal', x: 0, z: 0, rot: 0 }, { kind: 'card_reader', x: 2.6, z: 3.8, rot: 0 }, { kind: 'ore_cart', x: 5.2, z: 2.2, rot: 0.4 },
  ],
  Stolovaya: [
    // the range's instruments and what they ran on, up here for the view; concrete round the strong room's way in, and its reader
    // (its panel is the model's +x: turned half about, it looks west across the yard, at whoever comes up the lane)
    { kind: 'card_reader', x: 18.7, z: -12.3, rot: S },
    { kind: 'concrete_road_barrier', x: 12, z: -3, rot: Q }, { kind: 'concrete_road_barrier', x: 12, z: -17, rot: Q }, { kind: 'container_shell@1', x: -4, z: 4, rot: 0.05 },
    { kind: 'container_shell@0', x: 8, z: 22, rot: Q + 0.04 }, { kind: 'uaz_469', x: 34, z: 4, rot: 2.6 }, { kind: 'portable_generator', x: 30, z: -24, rot: 0.5 }, { kind: 'propane_tank', x: 32, z: -26, rot: 0 },
    { kind: 'Barrel_01', x: -18, z: -6, rot: 0 }, { kind: 'Barrel_01', x: -16.8, z: -5.4, rot: 0 }, { kind: 'barrel_03', x: -17.4, z: -7.2, rot: 0.3 }, { kind: 'crate_big', x: -2, z: -6, rot: 0.2 }, { kind: 'wooden_military_crate', x: 0, z: -4.6, rot: 0.7 },
    { kind: 'old_tyre', x: -38, z: -22, rot: 0.5 }, { kind: 'covered_car', x: -18, z: 28, rot: Q + 0.1 },
  ],
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
    // the pit's own walls its faces; on its floor the rock broken out of them and left, heaped against their feet
    { kind: 'namaqualand_boulder_04', x: 12, z: -14, rot: 0.4 }, { kind: 'namaqualand_boulder_03', x: 14.6, z: -15.2, rot: 2.2 }, { kind: 'namaqualand_boulder_02', x: 9.8, z: -12.6, rot: 1.3 },
    { kind: 'namaqualand_boulder_04', x: 32, z: -6, rot: 1.9 }, { kind: 'namaqualand_boulder_02', x: 33.4, z: -3.4, rot: 0.2 }, { kind: 'namaqualand_boulder_03', x: 24, z: 17, rot: 2.8 },
    { kind: 'namaqualand_boulder_04', x: 20, z: 4, rot: 1.1 }, { kind: 'boulder_01', x: 12, z: 12, rot: 2.3 }, { kind: 'boulder_01', x: 26.2, z: 18.4, rot: 0.9 },
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
  Gorodok: { yards: [[26, 4, 62, 50]], lanes: [{ line: [[0, 64], [0, 24]], w: 6, dark: true }] },
  Stolovaya: { yards: [[-38, -26, 40, 30]], lanes: [{ line: [[-46, 30], [-12, 6], [10, -8]], w: 4, dark: true }] },
  Kolodets: { yards: [[-14, -12, 0, 8]], lanes: [{ line: [[-30, 2], [-12, 0]], w: 4 }] },
  // (the strip, graded flat and trodden; the apron along its north side)
  Aerodrom: { yards: [[-30, -20, 42, -5]], lanes: [{ line: [[-70, 9], [70, 9]], w: 14, dark: true }, { line: [[4, -5], [4, 2]], w: 4 }] },
  // (the pit: 7 m deep, worked back in faces, its walls straight; its bench west of it trodden, a ramp down into it)
  "Kar'yer": {
    yards: [[-52, -32, -24, 22]], lanes: [{ line: [[-24, 0], [2, 3]], w: 5 }],
    terraces: [{ poly: [[0, -22], [22, -26], [42, -14], [44, 8], [34, 26], [12, 28], [-2, 14], [-4, -6]], h: -7, out: 3.5 }, { poly: [[-12, -2], [2, -1], [2, 7], [-12, 6]], h: -3.5, out: 8 }],
  },
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
