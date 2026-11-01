// Levels 2 and 3, built by hand (the owner, 2026-11-01: "high quality dynamic environments ... DYNAMIC ROOMS AND LAYOUTS, elevation and jumping on things to get to new areas or
// drop downs ... special places to loot"). Level 2 is the Institute: the glass labs to the west, the anatomy theatre stepped down into the rock, the tank hall two storeys deep to
// the east, and in the middle the observation room whose floor is glass over Level 3. Level 3 is the great hall: a balcony, a stair straight at the round vault door, galleries
// down both sides, a crane over it all and a flooded trench along its foot. Its two ways in (the owner: "one from train tunnel underneath direct to bunker 3 and then one through
// bunker lvl 2"): the platform behind the lift's cab, and a stair from Level 2 behind a door that wants the same purple card. Out by a ladder and a hatch up into the generator hall.
// Everything is in the bunker's own measure (r right, f forward), heights over the level's own floor.

import type { Area } from './bunker-wings';

export interface Box { r0: number; r1: number; f0: number; f1: number }
export interface DeepArea extends Area {
  /** areas of one hall have no wall between them, only the face where one floor stands over the other */
  hall?: string;
  /** a hole in its floor, or in its ceiling */
  hole?: Box;
  roofHole?: Box;
  /** a wall between this and any other part stops at this height: over that, it is the other level's wall */
  capped?: number;
}
/** a way through a wall: on the line between two parts, its foot over the level's floor, how high and how wide (half) when not a door's */
export type Door = [number, number, number?, number?, number?];
/** a steel floor at a height, walked on and seen under */
export interface Deck extends Box { y: number }
/** a flight of stairs in a box of the plan, climbing toward `up` from y0 to y1; of steel, or a solid mass of concrete to the floor under it */
export interface Flight extends Box { up: 'r0' | 'r1' | 'f0' | 'f1'; y0: number; y1: number; steel?: boolean }
export interface Rail { ra: number; fa: number; rb: number; fb: number; y: number }
/** a ladder: where it stands, the way out from its rungs, its foot and top */
export interface Rungs { r: number; f: number; nr: number; nf: number; y0: number; y1: number }
/** a stretch of wall glazed between two heights */
export interface Glazed { axis: 'r' | 'f'; at: number; from: number; to: number; y0: number; y1: number }
export interface Things {
  id: string; r: number; f: number; rot: number; y?: number; on?: number[]; scale?: number;
  /** it stops a body: a box of the model's own size */
  solid?: boolean;
}
export interface Tank { r: number; f: number; y0: number; y1: number; rad: number; broken?: boolean }
/** a pair of glass leaves that part for whoever comes near; `along` the line they stand on; `gate`: only while that gate stands open, or from the far side */
export interface Parting { r: number; f: number; along: 'r' | 'f'; half: number; gate?: string; heavy?: boolean }

/** a mass of concrete: what is walked on where no room is laid out, and what fell */
export interface Mass extends Box { y0: number; y1: number; rough?: boolean }
/** rows of seats, one step down each row toward `to`, either side of an aisle */
export interface Tiers extends Box { to: 'f0' | 'f1'; rows: number; rise: number; aisle: [number, number] }

export interface Deep {
  areas: DeepArea[]; doors: Door[]; walls: { r0: number; r1: number; f0: number; f1: number; y0: number; y1: number }[]; decks: Deck[]; flights: Flight[]; rails: Rail[]; ladders: Rungs[]; glazed: Glazed[];
  masses: Mass[]; tiers: Tiers[];
  /** glass to walk on */
  floors: Deck[]; water: Deck[]; tanks: Tank[]; parting: Parting[];
  stood: Things[]; spots: [number, number, number][]; lamps: [number, number, number, number][];
}

const Q = Math.PI / 2, TOP = [1], SHELF = [0.38, 0.94, 1.51];

// ---- Level 2

/** the plant's own place: the plinth it stands on, and where the can is poured */
export const PLANT = { r: 0, f: 8.5, plinth: 0.9 };
/** the door the purple card opens at the head of the stair down, in Level 2's wall, and its reader beside it */
export const STAIR_DOOR = { r: -7.5, f: -28, reader: [-5.9, -27.4] as [number, number] };
/** the observation room's window on to Level 3 */
export const GLASS_FLOOR: Box = { r0: -6, r1: 6, f0: -12, f1: -3 };
/** the room the plant opens when it starts */
export const STRONG: Box = { r0: -29, r1: -22, f0: 4, f1: 10 };

const lab = (r0: number, r1: number, f0: number, f1: number, v: number): Things[] => {
  const c = (r0 + r1) / 2, m = (f0 + f1) / 2, out: Things[] = [];
  for (let k = 0; k < 4; k++) out.push({ id: 'lab_counter', r: r0 + 1.5 + k * 2.3, f: f0 + 0.5, rot: 0, on: [0.89], solid: true });
  out.push({ id: 'med_sink', r: r1 - 2.4, f: f0 + 0.5, rot: 0, solid: true }, { id: 'med_cabinet', r: r1 - 0.5, f: f0 + 1.6, rot: -Q, solid: true }, { id: 'med_cabinet', r: r1 - 0.5, f: f0 + 3, rot: -Q, solid: true });
  out.push({ id: 'steel_table', r: c - 1.4, f: m + 0.2, rot: 0, on: [0.79], solid: true }, { id: 'surgical_trolley', r: c - 0.1, f: m + 1, rot: 1 + v });
  if (v === 0) out.push({ id: 'steel_table', r: c + 1.6, f: m + 0.2, rot: 0, on: [0.79], solid: true }, { id: 'computer_cart', r: c + 3, f: m - 1, rot: 2.4 }, { id: 'xray_viewer', r: r0 + 0.27, f: m, rot: Q, y: 1.2 });
  if (v === 1) out.push({ id: 'research_table', r: c + 2, f: m, rot: Q, solid: true }, { id: 'ventilator', r: c + 3.6, f: m + 2, rot: 0.6 }, { id: 'surgical_lamp', r: c - 1.4, f: m + 0.2, rot: 0, y: 1.05 });
  if (v === 2) out.push({ id: 'autopsy_table', r: c + 2, f: m + 0.5, rot: 0.3, solid: true }, { id: 'covered_body', r: c + 2, f: m + 0.5, rot: 0.3, y: 0.83 }, { id: 'metal_trash_can', r: r0 + 0.8, f: f1 - 0.8, rot: 0 }, { id: 'computer_cart', r: c - 3, f: m + 2, rot: 1.2 });
  return out;
};

export const LEVEL2: Deep = {
  areas: [
    // the way from the lift
    { r0: -2, r1: 2, f0: -28, f1: -16, name: 'Decontamination' },
    { r0: -8.5, r1: -2, f0: -28, f1: -20, kind: 'washroom', name: 'Change room' },
    { r0: -11, r1: -8.5, f0: -22, f1: -20, name: 'Scrub room' },
    { r0: 2, r1: 11, f0: -28, f1: -20, kind: 'stores', name: 'Reagent store' },
    // the room in the middle, with Level 3 under its floor
    { r0: -11, r1: 11, f0: -16, f1: 0, kind: 'control', name: 'Observation', bare: true, hole: GLASS_FLOOR },
    { r0: -11, r1: 11, f0: 0, f1: 16, kind: 'plant', name: 'Plant', bare: true, top: 3.4 },
    // the glass labs
    { r0: -44, r1: -11, f0: -9, f1: -7, name: 'Glass corridor' },
    { r0: -22, r1: -11, f0: -22, f1: -9, kind: 'medical', name: 'Lab A', bare: true },
    { r0: -33, r1: -22, f0: -22, f1: -9, kind: 'medical', name: 'Lab B', bare: true },
    { r0: -44, r1: -33, f0: -22, f1: -9, kind: 'medical', name: 'Lab C', bare: true },
    { r0: -22, r1: -11, f0: -7, f1: 4, kind: 'medical', name: 'Morgue', bare: true },
    { r0: -29, r1: -22, f0: -7, f1: 4, kind: 'quarters', name: 'Director' },
    { ...STRONG, kind: 'armoury', name: 'Strong room' },
    // the theatre, stepped down into the rock, and the room behind its floor
    { r0: -46, r1: -29, f0: -7, f1: 4, y: -2.4, kind: 'plant', name: 'Anatomy theatre', bare: true },
    { r0: -42, r1: -33, f0: 4, f1: 10, y: -2.4, top: 0.4, kind: 'stores', name: 'Prep room', bare: true },
    // the tank hall, and what opens off it
    { r0: 11, r1: 18, f0: -9, f1: -7, name: 'Tank passage' },
    { r0: 18, r1: 48, f0: -26, f1: 2, y: -3.8, kind: 'plant', name: 'Tank hall', bare: true },
    { r0: 48, r1: 56, f0: -18, f1: -10, kind: 'stores', name: 'Cold room', bare: true },
    { r0: 48, r1: 54, f0: -6, f1: 2, y: -3.8, top: -1, kind: 'workshop', name: 'Pump room', bare: true },
    // the ways nobody was meant to use: the pipe tunnel from the plant to the hall's platform, bent double; and behind the morgue, on your belly
    { r0: 11, r1: 18, f0: 0, f1: 1.5, top: 1.25, name: 'Pipe tunnel' },
    { r0: -21, r1: -16, f0: 4, f1: 8, top: 1.8, kind: 'stores', name: 'Behind the morgue', bare: true },
  ],
  doors: [
    [0, -28, 0, 2.3, 1.1],
    [-2, -24], [2, -24], [0, -16], [0, 0], [-11, -8], [11, -8], [18, -8],
    [-16.5, -9], [-27.5, -9], [-38.5, -9], [-16.5, -7], [-25.5, -7], [-37.5, -7], [-25.5, 4], [-37.5, 4, -2.4, 2.15],
    [STAIR_DOOR.r, STAIR_DOOR.f],
    [48, -14], [48, -2, -3.8, 2.15],
    // (round again: from the labs back to the change room, from the morgue through to the plant)
    [-11, -21], [-8.5, -21], [-11, 2],
    // (bent double; on your belly)
    [11, 0.75, 0, 1.2, 0.6], [18, 0.75, 0, 1.2, 0.6], [-18.5, 4, 0, 0.72, 0.55],
  ],
  walls: [],
  masses: [
    // the plant's plinth
    { r0: -4.5, r1: 4.5, f0: 6.3, f1: 11.5, y0: 0, y1: PLANT.plinth },
  ],
  tiers: [{ r0: -46, r1: -29, f0: -7, f1: -1.6, to: 'f1', rows: 6, rise: 0.4, aisle: [-38.5, -36.5] }],
  decks: [
    // the west platform along the hall's wall, the east one, and the bridge between them with its middle gone
    { r0: 18, r1: 21.5, f0: -26, f1: 2, y: 0 }, { r0: 44.5, r1: 48, f0: -26, f1: 2, y: 0 },
    { r0: 21.5, r1: 31.5, f0: -9, f1: -7, y: 0 }, { r0: 34.5, r1: 44.5, f0: -9, f1: -7, y: 0 },
    // (spurs out to the tank tops: over them is the other way across)
    { r0: 26, r1: 28, f0: -12.6, f1: -9, y: 0 }, { r0: 38, r1: 40, f0: -12.6, f1: -9, y: 0 },
    // the landing at the head of the steel stair down
    { r0: 21.5, r1: 23.5, f0: -7, f1: -5.5, y: 0 },
    // the plant's mezzanine, from the bench under it
    { r0: 6.5, r1: 10.8, f0: 11.5, f1: 15.8, y: 1.6 },
  ],
  flights: [
    { r0: 21.5, r1: 23.5, f0: -5.5, f1: 1, up: 'f0', y0: -3.8, y1: 0, steel: true },
    // up on to the plant's plinth, from each end
    { r0: -1, r1: 1, f0: 4.6, f1: 6.3, up: 'f1', y0: 0, y1: 0.9 },
    // the theatre's middle aisle
    { r0: -38.5, r1: -36.5, f0: -7, f1: -1.6, up: 'f0', y0: -2.4, y1: 0 },
  ],
  rails: [
    { ra: 21.5, fa: -26, rb: 21.5, fb: -9, y: 0 }, { ra: 21.5, fa: -5.5, rb: 21.5, fb: 2, y: 0 },
    { ra: 44.5, fa: -26, rb: 44.5, fb: -14.6, y: 0 }, { ra: 44.5, fa: -13.4, rb: 44.5, fb: -9, y: 0 }, { ra: 44.5, fa: -7, rb: 44.5, fb: 2, y: 0 },
    { ra: 23.5, fa: -7, rb: 23.5, fb: -5.5, y: 0 }, { ra: 23.5, fa: -7, rb: 31.5, fb: -7, y: 0 }, { ra: 21.5, fa: -9, rb: 26, fb: -9, y: 0 },
    { ra: 28, fa: -9, rb: 31.5, fb: -9, y: 0 }, { ra: 34.5, fa: -9, rb: 38, fb: -9, y: 0 }, { ra: 40, fa: -9, rb: 44.5, fb: -9, y: 0 }, { ra: 34.5, fa: -7, rb: 44.5, fb: -7, y: 0 },
    { ra: 6.5, fa: 11.5, rb: 7.8, fb: 11.5, y: 1.6 },
  ],
  ladders: [
    // up out of the pit, on to the east platform: a ladder leans on what it comes out on, so on the platform's edge
    { r: 44.44, f: -14, nr: -1, nf: 0, y0: -3.8, y1: 0.05 },
  ],
  glazed: [
    { axis: 'f', at: -9, from: -44, to: -11, y0: 0.85, y1: 2.5 },
    { axis: 'f', at: -7, from: -22, to: -11, y0: 0.85, y1: 2.5 },
    { axis: 'r', at: -22, from: -22, to: -9, y0: 0.85, y1: 2.5 },
    { axis: 'r', at: -33, from: -22, to: -9, y0: 0.85, y1: 2.5 },
    { axis: 'r', at: 18, from: -26, to: -10, y0: 0.9, y1: 2.5 },
  ],
  floors: [{ ...GLASS_FLOOR, y: 0 }],
  water: [{ r0: 28.5, r1: 37.5, f0: -5, f1: 2, y: -3.74 }],
  tanks: [
    { r: 27, f: -14, y0: -3.8, y1: 0.2, rad: 1.6 }, { r: 33, f: -14, y0: -3.8, y1: 0.2, rad: 1.6 }, { r: 39, f: -14, y0: -3.8, y1: 0.2, rad: 1.6 },
    { r: 27, f: -21, y0: -3.8, y1: 0.2, rad: 1.6 }, { r: 39, f: -21, y0: -3.8, y1: 0.2, rad: 1.6 }, { r: 33, f: -21, y0: -3.8, y1: 0.2, rad: 1.6 },
    { r: 39, f: -2, y0: -3.8, y1: 0.2, rad: 1.6 }, { r: 33, f: -2, y0: -3.8, y1: 0.2, rad: 1.6, broken: true },
  ],
  parting: [
    { r: 0, f: -24, along: 'r', half: 2 }, { r: 0, f: -20, along: 'r', half: 2 },
    { r: STAIR_DOOR.r, f: STAIR_DOOR.f, along: 'r', half: 0.95, gate: 'stair', heavy: true },
    { r: (STRONG.r0 + STRONG.r1) / 2, f: STRONG.f0, along: 'r', half: 0.95, gate: 'strong', heavy: true },
  ],
  stood: [
    // decontamination: the showers it was named for
    { id: 'bunker_pipes', r: -1.68, f: -26, rot: Q }, { id: 'bunker_pipes', r: 1.68, f: -22, rot: -Q }, { id: 'bunker_pipes', r: -1.68, f: -18, rot: Q },
    { id: 'bunker_grate', r: 0, f: -22, rot: 0 }, { id: 'bunker_grate', r: 0, f: -18.5, rot: 0 },
    // the observation room, its desks turned to the glass
    { id: 'bunker_terminal', r: -8.5, f: -13.8, rot: 0.5, solid: true }, { id: 'bunker_terminal', r: 8.5, f: -13.8, rot: -0.5, solid: true },
    { id: 'hospital_desk', r: -9.8, f: -3.2, rot: Q, solid: true }, { id: 'hospital_pc', r: -10, f: -3.2, rot: Q, y: 0.95 }, { id: 'SchoolChair_01', r: -8.4, f: -3.1, rot: -Q + 0.3 },
    { id: 'hospital_desk', r: 9.8, f: -3.2, rot: -Q, solid: true }, { id: 'Television_01', r: 10, f: -3.2, rot: -Q, y: 0.95 }, { id: 'SchoolChair_01', r: 8.4, f: -2.6, rot: Q - 0.8 },
    { id: 'metal_office_desk', r: 4.8, f: -1, rot: Math.PI, on: TOP }, { id: 'water_cooler', r: 10.3, f: -0.8, rot: -Q }, { id: 'painted_wooden_cabinet', r: -10.4, f: -0.9, rot: Q, on: TOP },
    // the labs and the morgue
    ...lab(-22, -11, -22, -9, 0), ...lab(-33, -22, -22, -9, 1), ...lab(-44, -33, -22, -9, 2),
    { id: 'body_lockers', r: -20.35, f: -1.5, rot: Q, solid: true }, { id: 'body_lockers', r: -12.65, f: -1.5, rot: -Q, solid: true },
    { id: 'autopsy_table', r: -16.5, f: -2, rot: 0, solid: true }, { id: 'autopsy_table', r: -16.5, f: 2, rot: 0, solid: true }, { id: 'covered_body', r: -16.5, f: 2, rot: 0, y: 0.83 },
    { id: 'autopsy_scales', r: -14.4, f: 3.3, rot: Math.PI }, { id: 'surgical_trolley', r: -14.8, f: -2.6, rot: 0.8 }, { id: 'mop_bucket', r: -18.8, f: 3, rot: 2 },
    // the theatre's table, under its lamp, and the rows looking down at it are built (see `steps` in the world)
    { id: 'autopsy_table', r: -37.5, f: 1.2, rot: 0, y: -2.4, solid: true }, { id: 'covered_body', r: -37.5, f: 1.2, rot: 0, y: -1.57 }, { id: 'surgical_lamp', r: -37.5, f: 1.2, rot: 0, y: 1.4 },
    { id: 'instrument_tray', r: -35.4, f: 2.4, rot: 0.3, y: -1.61 }, { id: 'surgical_trolley', r: -35.4, f: 2.4, rot: 0.3, y: -2.4 }, { id: 'xray_viewer', r: -37.5, f: 3.76, rot: Math.PI, y: -1 },
    // the prep room behind it: nobody looks here
    { id: 'body_lockers', r: -37.5, f: 8.35, rot: Math.PI, y: -2.4, solid: true }, { id: 'steel_table', r: -40, f: 6.6, rot: Q, y: -2.4, on: [0.79], solid: true }, { id: 'weapons_case', r: -34.6, f: 5.2, rot: 0.2, y: -2.4 }, { id: 'med_cabinet', r: -33.5, f: 8.2, rot: -Q, y: -2.4, solid: true },
    // the benches of the theatre's rows
    ...[0, 1, 2, 3, 4, 5].flatMap((k) => [-44, -41.6, -33.6, -31.2].map((r) => ({ id: 'painted_wooden_bench', r, f: -6.55 + k * 0.9, rot: 0, y: -k * 0.4 } as Things))),
    // behind the morgue: what somebody put by, and the wall they lay against to do it
    { id: 'weapons_case', r: -18.5, f: 6.6, rot: 0.1 }, { id: 'folded_blanket', r: -20, f: 5.4, rot: 0.8 }, { id: 'can_rusted', r: -17.2, f: 5, rot: 0 }, { id: 'vintage_radio_transceiver', r: -19.8, f: 7.2, rot: 1 },
    // the plant
    { id: 'bunker_machine', r: -7.4, f: 3.5, rot: 0, solid: true }, { id: 'bunker_machine', r: 7.4, f: 3.5, rot: 0, solid: true }, { id: 'bunker_pipe', r: -10.3, f: 12, rot: Q }, { id: 'bunker_pipe', r: -10.3, f: 8, rot: Q },
    { id: 'bunker_cable', r: 0, f: 3, rot: 0, scale: 1 }, { id: 'portable_generator', r: -8, f: 14.5, rot: 0.4 }, { id: 'Barrel_01', r: -9.8, f: 15, rot: 0.2 }, { id: 'Barrel_01', r: -9, f: 15.2, rot: 1.2 }, { id: 'barrel_03', r: -9.6, f: 14.2, rot: 2 },
    { id: 'steel_table', r: 8.8, f: 10.4, rot: 0, on: [0.79], solid: true }, { id: 'rack_small', r: 9.6, f: 15.4, rot: Math.PI, y: 1.6, solid: true }, { id: 'weapons_case', r: 7.6, f: 14.6, rot: 0.4, y: 1.6 },
    // the tank hall's floor: its pumps, what fell, and what was left on the platforms. Up on the middle tank, what somebody hid there
    { id: 'bunker_machine', r: 43, f: -17.5, rot: Math.PI, y: -3.8, solid: true }, { id: 'bunker_machine', r: 23.5, f: -17.5, rot: Math.PI, y: -3.8, solid: true }, { id: 'bunker_pipe', r: 47.4, f: -24, rot: -Q, y: -3.8 }, { id: 'bunker_pipe', r: 47.4, f: -8, rot: -Q, y: -3.8 },
    { id: 'bunker_cable', r: 33, f: -8, rot: Q, y: -3.8, scale: 1 }, { id: 'covered_body', r: 30.5, f: -3.5, rot: 0.9, y: -3.8 }, { id: 'Barrel_01', r: 26, f: 0.8, rot: 0, y: -3.8 }, { id: 'barrel_03', r: 25.4, f: 0.2, rot: 1, y: -3.8 }, { id: 'wooden_military_crate', r: 41, f: 0.8, rot: 0.2, y: -3.8 },
    { id: 'weapons_case', r: 33, f: -14, rot: 0.5, y: 0.2 }, { id: 'wooden_crate_01', r: 46.5, f: -24, rot: 0.4 }, { id: 'old_military_crate', r: 19.5, f: -22, rot: Q },
    // the cold room over the gap, and the pump room behind the pit
    { id: 'steel_frame_shelves_01', r: 49, f: -11, rot: Q, scale: 0.13 }, { id: 'Shelf_01', r: 55.6, f: -14, rot: -Q, on: SHELF }, { id: 'Shelf_01', r: 55.6, f: -12, rot: -Q, on: SHELF }, { id: 'Shelf_01', r: 55.6, f: -16, rot: -Q, on: SHELF }, { id: 'rack_wide', r: 52, f: -17.6, rot: 0, solid: true }, { id: 'weapons_case', r: 52, f: -11, rot: 1.4 },
    { id: 'bunker_machine', r: 51, f: -4.8, rot: 0, y: -3.8, solid: true }, { id: 'utility_box_01', r: 53.5, f: 0, rot: -Q, y: -3.8 }, { id: 'wooden_military_crate', r: 49.6, f: 1, rot: 0.2, y: -3.8 },
  ],
  spots: [
    [0, -19, 0], [-8.8, -1.4, 0], [6.8, -1.4, 0],
    [-20, -3, 0], [-13, 0, 0], [-37.5, 3.2, -2.4], [-42, 2.2, -2.4], [-34, 6.2, -2.4], [-39, 5, -2.4],
    [-5.2, 12, 0], [7.4, 12.4, 1.6], [9.2, 13.4, 1.6],
    [-19.6, 6, 0], [-17.4, 7, 0], [14.5, 0.75, 0],
    [33, -8, -3.8], [28, -24.6, -3.8], [43, -2, -3.8], [19.6, -14, 0], [46.2, -18, 0], [33.4, -13.2, 0.2], [51, -14, 0], [53, -11.6, 0], [50, 0, -3.8],
  ],
  lamps: [
    [-8.5, -8, 2.75, 1], [8.5, -8, 2.75, 1], [-8, -14.2, 2.75, 1], [8, -14.2, 2.75, 1], [0, -14.2, 2.75, 0.4], [0, -1.5, 2.75, 1],
    [-6, 3.5, 3.15, 1], [6, 3.5, 3.15, 1], [-6, 12, 3.15, 1], [6, 12, 3.15, 1], [0, 13.5, 3.15, 0.4], [0, 8.5, 3.15, 1], [0, 2, 3.15, 1],
    [-13.5, -15.5, 2.75, 1], [-19.5, -15.5, 2.75, 1], [-25, -15.5, 2.75, 1], [-30, -15.5, 2.75, 1], [-36, -15.5, 2.75, 0.3], [-41, -15.5, 2.75, 1], [-16.5, -1.5, 2.75, 0.3], [-25.5, -1.5, 2.75, 1],
    [-37.5, 1.2, 2.75, 1], [-37.5, -4.5, 2.75, 1], [-44, -1, 2.75, 0], [-31, -1, 2.75, 0.4], [-37.5, 7, 0.15, 0.3],
    [24, -20, 2.75, 1], [33, -20, 2.75, 0.4], [42, -20, 2.75, 1], [24, -10, 2.75, 1], [42, -10, 2.75, 0.3], [33, -5, 2.75, 1], [24, -1, 2.75, 0], [42, -1, 2.75, 1],
    [52, -14, 2.75, 0.3], [51, -2, -1.25, 0.3],
  ],
};

// ---- Level 3

/** the great hall: where its floor lies under the galleries, and how high its roof stands */
export const HALL3 = { floor: -6.2, top: 3.2, r: 13, f0: -22, f1: 6 };
/** the round door, in the hall's far wall: its middle, its radius, and how far it rolls aside on its track */
export const VAULT_DOOR = { r: 0, f: 5.26, y: -3.6, rad: 2.6, thick: 0.5, roll: 5.9, wide: 1.8, high: 3.6 };
/** the way out: a ladder up from the end of the east drift to a hatch in the generator hall's floor */
export const ESCAPE = { r: 40.5, f: 8.25, half: 0.62, high: 3.8 };

export const LEVEL3: Deep = {
  areas: [
    { r0: -17, r1: 17, f0: -28, f1: -22, top: HALL3.top, hall: 'H', name: 'Balcony' },
    { r0: -10, r1: 13, f0: -22, f1: 6, y: HALL3.floor, top: HALL3.top, hall: 'H', kind: 'plant', name: 'Great hall', bare: true, roofHole: GLASS_FLOOR },
    { r0: -13, r1: -10, f0: -22, f1: 6, y: -7.6, top: HALL3.top, hall: 'H', name: 'The trench' },
    // (its west gallery came down at one place, and has lain where it fell: over that gap, or through the rooms, or down)
    { r0: -17, r1: -13, f0: -22, f1: -12, top: HALL3.top, hall: 'H', name: 'West gallery' },
    { r0: -17, r1: -13, f0: -12, f1: -9.5, y: -2.5, top: HALL3.top, hall: 'H', name: 'The fall' },
    { r0: -17, r1: -13, f0: -9.5, f1: 6, top: HALL3.top, hall: 'H', name: 'West gallery' },
    { r0: 13, r1: 17, f0: -22, f1: 6, top: HALL3.top, hall: 'H', name: 'East gallery' },
    { r0: -17, r1: 17, f0: 6, f1: 10, top: HALL3.top, hall: 'H', name: 'Far gallery' },
    { r0: -6, r1: 6, f0: 10, f1: 16, kind: 'control', name: 'Vault control', bare: true },
    { r0: -29, r1: -17, f0: -22, f1: -13, kind: 'quarters', name: 'Officers' },
    { r0: -29, r1: -17, f0: -13, f1: -4, kind: 'control', name: 'Map room' },
    { r0: -29, r1: -17, f0: -4, f1: 6, kind: 'armoury', name: 'Armoury' },
    { r0: -29, r1: -17, f0: 6, f1: 10, name: 'Back passage' },
    { r0: -17, r1: -6, f0: 10, f1: 19, kind: 'cells', name: 'Cells' },
    { r0: 6, r1: 17, f0: 10, f1: 19, kind: 'medical', name: 'Sick bay' },
    { r0: 17, r1: 31, f0: 3, f1: 19, kind: 'stores', name: 'Last stores' },
    { r0: 31, r1: 42, f0: 7, f1: 9.5, name: 'East drift', roofHole: { r0: ESCAPE.r - ESCAPE.half, r1: ESCAPE.r + ESCAPE.half, f0: ESCAPE.f - ESCAPE.half, f1: ESCAPE.f + ESCAPE.half } },
    // the stair up to Level 2, behind the back wall of the balcony, and all it passes through
    { r0: -18, r1: -8.5, f0: -30.5, f1: -28, top: 6.9, hall: 'S', name: 'The stair' },
    { r0: -8.5, r1: -6.5, f0: -30.5, f1: -28, y: 3.8, top: 6.9, hall: 'S', name: 'The stair', capped: 3.4 },
    // under the far gallery: the vault; under the west one: the sump, by a way you go in on your knees
    { r0: -6, r1: 6, f0: 6, f1: 18, y: HALL3.floor, top: -1, kind: 'armoury', name: 'The vault', bare: true, under: true },
    { r0: -17, r1: -13.5, f0: -8.5, f1: -1, y: -7.6, top: -5.4, kind: 'stores', name: 'Sump', bare: true, under: true },
    // and in the hollow under the great stair's landing, by a gap at the foot of its side you go through on your belly
    { r0: -3, r1: 3, f0: -17.2, f1: -15.2, y: HALL3.floor, top: -3.3, kind: 'stores', name: 'Under the landing', bare: true, under: true },
  ],
  doors: [
    [0, -28, 0, 2.3, 1.1],
    [-16.5, -28], [-17, -17.5], [-17, -8.5], [-17, 1], [-23, -13], [-23, -4], [-23, 6], [-17, 8], [-4.5, 10], [-11, 10], [11, 10], [17, 8], [31, 8.25], [6, 13],
    // (from the cells into vault control, bent double)
    [-6, 13, 0, 1.2, 0.6],
    // (the far wall's way into the vault, and the sump's, on your knees)
    [VAULT_DOOR.r, 6, HALL3.floor, VAULT_DOOR.high, VAULT_DOOR.wide], [-13, -5, -7.6, 1.3, 0.6],
  ],
  walls: [
    // the vault's sides and back, the sump's
    { r0: -6.3, r1: -6, f0: 6.15, f1: 18.3, y0: HALL3.floor, y1: -1 }, { r0: 6, r1: 6.3, f0: 6.15, f1: 18.3, y0: HALL3.floor, y1: -1 }, { r0: -6, r1: 6, f0: 18, f1: 18.3, y0: HALL3.floor, y1: -1 },
    { r0: -17.3, r1: -17, f0: -8.8, f1: -0.7, y0: -7.6, y1: -5.4 }, { r0: -17, r1: -13.15, f0: -8.8, f1: -8.5, y0: -7.6, y1: -5.4 }, { r0: -17, r1: -13.15, f0: -1, f1: -0.7, y0: -7.6, y1: -5.4 },
    // the landing's sides: solid but for the gap in the west one, a hand's height over the floor to its lintel
    { r0: -3.3, r1: -3, f0: -17.2, f1: -16.75, y0: HALL3.floor, y1: -3.3 }, { r0: -3.3, r1: -3, f0: -15.65, f1: -15.2, y0: HALL3.floor, y1: -3.3 }, { r0: -3.3, r1: -3, f0: -16.75, f1: -15.65, y0: HALL3.floor + 0.72, y1: -3.3 },
    { r0: 3, r1: 3.3, f0: -17.2, f1: -15.2, y0: HALL3.floor, y1: -3.3 },
  ],
  masses: [
    // the great stair's landing, a slab over the hollow under it
    { r0: -3, r1: 3, f0: -17.2, f1: -15.2, y0: -3.3, y1: -3 },
    // what came down of the west gallery, with the floor of the fall on top of it
    { r0: -12.6, r1: -10.2, f0: -12, f1: -9.6, y0: -7.6, y1: -6.4, rough: true }, { r0: -11.2, r1: -10, f0: -13, f1: -9, y0: -6.2, y1: -5.5, rough: true },
  ],
  tiers: [],
  decks: [
    // the crane's bridge, across the hall from the edge of one gallery to the other: a body walks along the galleries past the foot of its steps
    { r0: -13, r1: 13, f0: -3.7, f1: -2.3, y: 1 },
  ],
  flights: [
    // the great stair, straight at the door, with a landing half way
    { r0: -3, r1: 3, f0: -22, f1: -17.2, up: 'f0', y0: -3, y1: 0 },
    { r0: -3, r1: 3, f0: -15.2, f1: -10.4, up: 'f0', y0: HALL3.floor, y1: -3 },
    // out of the trench at each end, and up to the crane
    { r0: -12, r1: -10, f0: -20, f1: -18, up: 'r1', y0: -7.6, y1: HALL3.floor, steel: true },
    { r0: -12, r1: -10, f0: 2, f1: 4, up: 'r1', y0: -7.6, y1: HALL3.floor, steel: true },
    { r0: -15.4, r1: -13, f0: -3.7, f1: -2.3, up: 'r1', y0: 0, y1: 1, steel: true },
    { r0: 13, r1: 15.4, f0: -3.7, f1: -2.3, up: 'r0', y0: 0, y1: 1, steel: true },
    // the stair to Level 2
    { r0: -15.5, r1: -8.5, f0: -30.3, f1: -28.2, up: 'r1', y0: 0, y1: 3.8 },
  ],
  rails: [
    { ra: -17, fa: -22, rb: -3, fb: -22, y: 0 }, { ra: 3, fa: -22, rb: 13, fb: -22, y: 0 },
    { ra: -13, fa: -22, rb: -13, fb: -12, y: 0 }, { ra: -13, fa: -9.5, rb: -13, fb: -3.7, y: 0 }, { ra: -13, fa: -2.3, rb: -13, fb: 6, y: 0 },
    { ra: 13, fa: -22, rb: 13, fb: -13, y: 0 }, { ra: 13, fa: -7, rb: 13, fb: -3.7, y: 0 }, { ra: 13, fa: -2.3, rb: 13, fb: 6, y: 0 },
    { ra: -13, fa: 6, rb: 8.4, fb: 6, y: 0 }, { ra: 9.6, fa: 6, rb: 13, fb: 6, y: 0 },
    { ra: -13, fa: -3.7, rb: 13, fb: -3.7, y: 1 }, { ra: -13, fa: -2.3, rb: 2, fb: -2.3, y: 1 }, { ra: 5.5, fa: -2.3, rb: 13, fb: -2.3, y: 1 },
    // and either side of the great stair's top, for the landing's edge
    { ra: -3, fa: -17.2, rb: -3, fb: -15.2, y: -3 }, { ra: 3, fa: -17.2, rb: 3, fb: -15.2, y: -3 },
  ],
  ladders: [
    { r: 9, f: 5.76, nr: 0, nf: -1, y0: HALL3.floor, y1: 0.05 },
    { r: 11.8, f: -6.86, nr: 0, nf: 1, y0: HALL3.floor, y1: 0.45 },
    { r: ESCAPE.r, f: ESCAPE.f + ESCAPE.half - 0.14, nr: 0, nf: -1, y0: 0, y1: ESCAPE.high + 0.05 },
  ],
  glazed: [{ axis: 'f', at: 10, from: -2.5, to: 5.5, y0: 1, y1: 2.5 }],
  floors: [],
  water: [{ r0: -13, r1: -10, f0: -22, f1: 6, y: -7.25 }, { r0: -17, r1: -13.5, f0: -10, f1: -2, y: -7.25 }],
  tanks: [],
  parting: [],
  stood: [
    // the hall's floor: what was being got out when it ended. Three containers high against the east gallery, a ladder up the end of them, and the one on the crane
    { id: 'container_shell@0', r: 11.8, f: -10, rot: 0, y: HALL3.floor }, { id: 'container_shell@1', r: 11.8, f: -10, rot: 0, y: HALL3.floor + 2.2 }, { id: 'container_shell@0', r: 11.8, f: -10, rot: 0, y: HALL3.floor + 4.4 },
    { id: 'container_shell@1', r: 9.4, f: -3, rot: 0, y: HALL3.floor }, { id: 'container_shell@0', r: 9.4, f: -3, rot: 0, y: HALL3.floor + 2.2 },
    { id: 'container_shell@1', r: 4, f: -3, rot: Q, y: -3.8 },
    { id: 'zil_wreck', r: -5, f: -6, rot: 0.25, y: HALL3.floor, solid: true }, { id: 'tractor_wreck', r: 5.5, f: -8.5, rot: 2.4, y: HALL3.floor, solid: true },
    { id: 'crate_big', r: 8.8, f: 3.2, rot: 0.2, y: HALL3.floor, solid: true }, { id: 'crate_big', r: 10, f: 3.5, rot: 0.1, y: HALL3.floor, solid: true }, { id: 'crate_big', r: 9.4, f: 3.3, rot: 0.5, y: HALL3.floor + 1, solid: true },
    { id: 'wooden_military_crate', r: -7.6, f: 3.4, rot: 0.1, y: HALL3.floor }, { id: 'wooden_military_crate', r: -7.4, f: 3.3, rot: 0.3, y: HALL3.floor + 0.46 }, { id: 'old_military_crate', r: -3.8, f: 3.8, rot: 1.4, y: HALL3.floor },
    { id: 'Barrel_01', r: 11.8, f: 4.8, rot: 0, y: HALL3.floor }, { id: 'barrel_03', r: 12.2, f: 3.4, rot: 1, y: HALL3.floor }, { id: 'old_tyre', r: -8.8, f: -13, rot: 1.5, y: HALL3.floor },
    // up on the crane, and out on the box hung from it
    { id: 'weapons_case', r: 3.2, f: -3, rot: 0.3, y: -1.6 },
    { id: 'weapons_case', r: 4.6, f: -3.2, rot: 1.5, y: -3.8 + 0.1 },
    // vault control
    { id: 'breaker_box', r: 0, f: 15.5, rot: -Q }, { id: 'bunker_terminal', r: 0.2, f: 11.1, rot: Math.PI, solid: true }, { id: 'bunker_terminal', r: 3.6, f: 11.1, rot: Math.PI, solid: true }, { id: 'SchoolChair_01', r: 1.8, f: 12.3, rot: 0.3 }, { id: 'metal_office_desk', r: 5, f: 15, rot: -Q, on: TOP },
    // the vault: racks down both sides, the cases on a table up the middle
    ...[8.5, 11, 13.5, 16].flatMap((f) => [{ id: 'gun_rack', r: -5.55, f, rot: Q } as Things, { id: 'rack_wide', r: 5.55, f, rot: -Q, y: 0, solid: true } as Things]).map((t) => ({ ...t, y: HALL3.floor })),
    { id: 'steel_table', r: 0, f: 13, rot: 0, y: HALL3.floor, on: [0.79], solid: true }, { id: 'weapons_case', r: 0, f: 16.8, rot: 0, y: HALL3.floor }, { id: 'weapons_case', r: -1.6, f: 16.8, rot: 0.2, y: HALL3.floor }, { id: 'weapons_case', r: 1.6, f: 16.8, rot: -0.2, y: HALL3.floor },
    // the sump, and the hollow under the landing
    { id: 'weapons_case', r: -15.6, f: -7.4, rot: 0.1, y: -7.6 }, { id: 'Shelf_01', r: -16.6, f: -4, rot: Q, y: -7.6, on: SHELF }, { id: 'wooden_crate_01', r: -15, f: -2, rot: 0.8, y: -7.6 },
    { id: 'wooden_military_crate', r: 1.6, f: -16.2, rot: Q, y: HALL3.floor }, { id: 'folded_blanket', r: -0.6, f: -16.4, rot: 0.2, y: HALL3.floor },
    // the east drift, what was dropped on the way out
    { id: 'cardboard_box_01', r: 36, f: 9, rot: 0.4 }, { id: 'metal_trash_can', r: 39, f: 7.5, rot: 0 },
  ],
  spots: [
    [-14.6, -14, 0], [15, -9, 0], [0, 8, 0], [-14, 8.4, 0], [-8, -2.9, 1], [10, -3.1, 1], [12.2, -26.5, 0],
    [-5, 2.4, HALL3.floor], [6, 0, HALL3.floor], [11.8, -10, HALL3.floor], [-7, -16, HALL3.floor], [8, -18, HALL3.floor], [-11.5, -7, -7.6],
    [1.8, -2.4, -1.6], [5.6, -3.6, -1.6], [2.6, -3, -3.7],
    [-15.2, -4.6, -7.6], [-14.8, -6.8, -7.6], [0.6, -16, HALL3.floor], [-23, 8, 0], [-14.6, -10.8, -2.5], [-2.4, 9.8, HALL3.floor], [2.4, 9.8, HALL3.floor], [0, 15.6, HALL3.floor],
  ],
  lamps: [
    [-8, -18, 2.95, 1], [8, -18, 2.95, 1], [-8, -9, 2.95, 1], [8, -9, 2.95, 1], [-8, 2, 2.95, 1], [8, 2, 2.95, 1], [0, 2, 2.95, 1],
    [-11.5, -10, 2.95, 0], [-11.5, 3, 2.95, 0.3],
    [0, -26, 2.95, 1], [-12, -25, 2.95, 1], [12, -25, 2.95, 0.4], [-15, -14, 2.95, 1], [-15, -4, 2.95, 0.3], [15, -14, 2.95, 0.4], [15, -4, 2.95, 1], [-14, 8, 2.95, 1], [14, 8, 2.95, 0.3], [0, 8, 2.95, 1],
    [0, 13, 2.75, 1], [-2.5, 9.5, -1.25, 1], [2.5, 9.5, -1.25, 1], [-2.5, 14.5, -1.25, 1], [2.5, 14.5, -1.25, 1],
    [-15.2, -4.5, -5.65, 0.3], [36, 8.25, 2.75, 0.3], [-23, 8, 2.75, 0.3], [-12, -29.2, 2.75, 1], [-7.5, -29.2, 6.6, 1],
  ],
};

export const DEEP: Record<number, Deep> = { 2: LEVEL2, 3: LEVEL3 };

/** how much light a great space has all through it, from a level and a spot in it: its halls have, its rooms keep what their lamps give */
export function deepFill(level: number, r: number, f: number, power: boolean) {
  // (Level 1, wherever it is lit at all: what is asked of it comes with being inside it)
  if (level === 1) return 0.12;
  if (level !== 2 && level !== 3) return 0;
  const a = DEEP[level].areas[deepAreaAt(level, r, f)];
  if (level === 3) return a?.hall === 'H' ? 0.36 : 0.14;
  if (!power) return 0;
  return a?.name === 'Tank hall' ? 0.3 : a?.name === 'Anatomy theatre' ? 0.26 : 0.17;
}

/** rooms that are their own secret: nothing is stood in them to wake */
export const HIDDEN = new Set(['Sump', 'Under the landing', 'Behind the morgue', 'Prep room', 'The vault', 'Strong room']);

/** a part of a deep level as whatever has no map finds its way: a box of a floor, or a flight */
export interface DeepPart extends Box { level: number; y: number; low?: Flight }
export function deepParts(level: number): DeepPart[] {
  const d = DEEP[level];
  return [
    ...d.flights.map((q) => ({ level, r0: q.r0, r1: q.r1, f0: q.f0, f1: q.f1, y: q.y0, low: q })),
    ...d.decks.map((q) => ({ level, r0: q.r0, r1: q.r1, f0: q.f0, f1: q.f1, y: q.y })),
    ...d.areas.map((q) => ({ level, r0: q.r0, r1: q.r1, f0: q.f0, f1: q.f1, y: q.y ?? 0 })),
  ];
}

/** which of a level's parts a spot is in: on a flight or a deck where it is that high, or the highest floor under it. @param y its feet over the level's floor */
export function deepPartAt(parts: DeepPart[], r: number, f: number, y: number): number {
  let best = -1, bestY = -Infinity;
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    if (!inside(p, r, f, 0.02)) continue;
    if (p.low) {
      const q = p.low, t = q.up === 'r0' ? (q.r1 - r) / (q.r1 - q.r0) : q.up === 'r1' ? (r - q.r0) / (q.r1 - q.r0) : q.up === 'f0' ? (q.f1 - f) / (q.f1 - q.f0) : (f - q.f0) / (q.f1 - q.f0);
      if (Math.abs(q.y0 + t * (q.y1 - q.y0) - y) < 1) return k;
      continue;
    }
    if (p.y <= y + 0.6 && p.y > bestY) [best, bestY] = [k, p.y];
  }
  return best;
}

/** The ways between a level's parts: its doors, where two floors of one height meet, and each end of each flight. */
export function deepLinks(level: number, parts: DeepPart[]) {
  const d = DEEP[level], out: { a: number; b: number; r: number; f: number; nr: number; nf: number }[] = [], at = (r: number, f: number, y: number) => deepPartAt(parts, r, f, y);
  const add = (a: number, b: number, r: number, f: number, nr: number, nf: number) => void (a >= 0 && b >= 0 && a !== b && out.push({ a, b, r, f, nr, nf }));
  for (const [r, f, y, high] of d.doors) {
    // (nothing walks through what you go through on your knees)
    if ((high ?? 2) < 1.5) continue;
    const onR = deepAreaAt(level, r - 0.4, f) !== deepAreaAt(level, r + 0.4, f), g = 0.4;
    add(at(onR ? r - g : r, onR ? f : f - g, y ?? 0), at(onR ? r + g : r, onR ? f : f + g, y ?? 0), r, f, onR ? 1 : 0, onR ? 0 : 1);
  }
  parts.forEach((p, i) => {
    if (p.low) {
      const q = p.low, mr = (q.r0 + q.r1) / 2, mf = (q.f0 + q.f1) / 2, nr = q.up === 'r0' ? -1 : q.up === 'r1' ? 1 : 0, nf = q.up === 'f0' ? -1 : q.up === 'f1' ? 1 : 0;
      const hr = nr ? (nr > 0 ? q.r1 : q.r0) : mr, hf = nf ? (nf > 0 ? q.f1 : q.f0) : mf, lr = nr ? (nr > 0 ? q.r0 : q.r1) : mr, lf = nf ? (nf > 0 ? q.f0 : q.f1) : mf;
      add(i, at(hr + nr * 0.3, hf + nf * 0.3, q.y1), hr, hf, nr, nf);
      add(at(lr - nr * 0.3, lf - nf * 0.3, q.y0), i, lr, lf, nr, nf);
      return;
    }
    parts.forEach((o, j) => {
      if (j <= i || o.low || Math.abs(o.y - p.y) > 0.01) return;
      const lr = Math.max(p.r0, o.r0), hr = Math.min(p.r1, o.r1), lf = Math.max(p.f0, o.f0), hf = Math.min(p.f1, o.f1);
      if (lr > hr || lf > hf || (lr === hr && lf === hf)) return;
      // (a passage and a room that merely lie side by side have a wall between them: only parts of one hall, and decks, run on into each other)
      const ai = d.areas[i - d.flights.length - d.decks.length], aj = d.areas[j - d.flights.length - d.decks.length];
      if (ai && aj && !(ai.hall && ai.hall === aj.hall)) return;
      if (ai && !aj && !ai.hall) return;
      const across = lr === hr;
      add(i, j, (lr + hr) / 2, (lf + hf) / 2, across ? Math.sign(o.r0 + o.r1 - p.r0 - p.r1) : 0, across ? 0 : Math.sign(o.f0 + o.f1 - p.f0 - p.f1));
    });
  });
  return out;
}

/** the middle of a box */
export const middle = (b: Box): [number, number] => [(b.r0 + b.r1) / 2, (b.f0 + b.f1) / 2];
const inside = (a: Box, r: number, f: number, slack = 0) => r > a.r0 - slack && r < a.r1 + slack && f > a.f0 - slack && f < a.f1 + slack;

/** the part of a level a spot is in, by plan alone: what lies under another part is not said */
export const deepAreaAt = (level: number, r: number, f: number, slack = 0) => DEEP[level].areas.findIndex((a) => !a.under && inside(a, r, f, slack));

/**
 * Which of the deep levels a spot is in, by where it is as well as how high: the tank hall and the theatre go down to Level 3's own height, and Level 3's stair up past Level 2's.
 * 0: neither. @param h its height over the pad @param Y2 Level 2's floor @param Y3 Level 3's
 */
export function deepLevelAt(r: number, f: number, h: number, Y2: number, Y3: number): number {
  for (const a of LEVEL3.areas) if (inside(a, r, f, 0.4) && h > Y3 + (a.y ?? 0) - 1.5 && h < Y3 + (a.top ?? 3) + 0.4) return 3;
  for (const a of LEVEL2.areas) if (inside(a, r, f, 0.4) && h > Y2 + (a.y ?? 0) - 1.5 && h < Y2 + (a.top ?? 3) + 0.4) return 2;
  return 0;
}

/** Is a spot anywhere in the deep levels, as a body goes? @param h as above */
export const inDeep = (r: number, f: number, h: number, Y2: number, Y3: number) => deepLevelAt(r, f, h, Y2, Y3) > 0;

/** where one deep level is seen from the other: through the glass floor from either side, and on the stair and at either end of it */
export function bothLevels(r: number, f: number) {
  const G = GLASS_FLOOR, S = LEVEL3.areas.find((a) => a.name === 'The stair')!;
  // (from anywhere in the great hall the window in its roof is in sight, and from the observation room the hall through its floor)
  return inside({ r0: -17.5, r1: 17.5, f0: -28.5, f1: 10.5 }, r, f) || inside({ r0: -11.5, r1: 11.5, f0: G.f0 - 4.5, f1: 0.5 }, r, f) || inside(S, r, f, 10);
}

export const WALL = 0.3;
const T = WALL, GAP = 0.95, HIGH = 2.15, STEP = 0.5, TALL = 3;

/** Every wall of a deep level: wherever two parts meet, or a part meets the rock, cut at its ways through. Where two parts are of one hall only the faces between their floors and their roofs. */
export function deepWalls(d: Deep) {
  const of = (r: number, f: number) => d.areas.findIndex((a) => !a.under && inside(a, r, f));
  const out: { r0: number; r1: number; f0: number; f1: number; y0: number; y1: number }[] = [];
  const say = (axis: 'r' | 'f', at: number, a: number, b: number, y0: number, y1: number) => {
    if (y1 - y0 < 0.01 || b - a < 0.01) return;
    out.push(axis === 'r' ? { r0: at - T / 2, r1: at + T / 2, f0: a, f1: b, y0, y1 } : { r0: a, r1: b, f0: at - T / 2, f1: at + T / 2, y0, y1 });
  };
  const spans = (A: DeepArea | undefined, B: DeepArea | undefined): [number, number][] => {
    const ya = A?.y ?? 0, yb = B?.y ?? 0, ta = A?.top ?? TALL, tb = B?.top ?? TALL;
    if (!A) return [[yb, tb]];
    if (!B) return [[ya, ta]];
    if (A.hall && A.hall === B.hall) return [[Math.min(ya, yb), Math.max(ya, yb) - 0.02], [Math.min(ta, tb), Math.max(ta, tb)]];
    const cap = A.capped ?? B.capped;
    return [[Math.min(ya, yb), cap ?? Math.max(ta, tb)]];
  };
  for (const axis of ['r', 'f'] as const) {
    const [lo, hi, from, to] = axis === 'r' ? [-70, 70, -34, 24] : [-34, 24, -70, 70];
    for (let at = lo; at <= hi; at += STEP) {
      let run: { a: number; spans: [number, number][] } | null = null;
      const close = (b: number) => {
        if (!run) return;
        const on = d.doors.filter(([dr, df]) => Math.abs((axis === 'r' ? dr : df) - at) < 0.01 && (axis === 'r' ? df : dr) > run!.a && (axis === 'r' ? df : dr) < b);
        for (const [y0, y1] of run.spans) {
          // (cut at each way through that stands in this span of it)
          const cuts = on.map(([dr, df, y, high, half]) => ({ g: axis === 'r' ? df : dr, y: y ?? 0, high: high ?? HIGH, half: half ?? GAP })).filter((c) => c.y >= y0 - 0.01 && c.y < y1).sort((p, q) => p.g - q.g);
          let v = run.a;
          for (const c of cuts) {
            say(axis, at, v, c.g - c.half, y0, y1);
            say(axis, at, c.g - c.half, c.g + c.half, y0, c.y - 0.02);
            say(axis, at, c.g - c.half, c.g + c.half, c.y + c.high, y1);
            v = c.g + c.half;
          }
          say(axis, at, v, b, y0, y1);
        }
        run = null;
      };
      for (let v = from; v < to; v += STEP) {
        const m = v + STEP / 2, [ra, fa] = axis === 'r' ? [at - STEP / 2, m] : [m, at - STEP / 2], [rb, fb] = axis === 'r' ? [at + STEP / 2, m] : [m, at + STEP / 2];
        const a = of(ra, fa), b = of(rb, fb);
        const sp = a !== b ? spans(d.areas[a], d.areas[b]) : null, key = JSON.stringify(sp);
        if (sp && run && JSON.stringify(run.spans) === key) continue;
        close(v);
        if (sp) run = { a: v, spans: sp };
      }
      close(to);
    }
  }
  // (glazed stretches: the wall below and above, and what lies between them is a pane: see `panes`)
  for (const g of d.glazed) {
    for (let k = out.length - 1; k >= 0; k--) {
      const w = out[k], mid = g.axis === 'r' ? (w.r0 + w.r1) / 2 : (w.f0 + w.f1) / 2, a = g.axis === 'r' ? w.f0 : w.r0, b = g.axis === 'r' ? w.f1 : w.r1;
      if (Math.abs(mid - g.at) > 0.01 || w.y0 > g.y0 || w.y1 < g.y1 || b <= g.from || a >= g.to) continue;
      const lo = Math.max(a, g.from), hi = Math.min(b, g.to);
      out.splice(k, 1);
      say(g.axis, g.at, a, lo, w.y0, w.y1);
      say(g.axis, g.at, hi, b, w.y0, w.y1);
      say(g.axis, g.at, lo, hi, w.y0, g.y0);
      say(g.axis, g.at, lo, hi, g.y1, w.y1);
    }
  }
  out.push(...d.walls);
  return out;
}

/** the panes of a level's glazed stretches: what is left of each between its doorways */
export function panes(d: Deep) {
  const out: { axis: 'r' | 'f'; at: number; a: number; b: number; y0: number; y1: number }[] = [];
  for (const g of d.glazed) {
    const cuts = d.doors.filter(([dr, df]) => Math.abs((g.axis === 'r' ? dr : df) - g.at) < 0.01).map(([dr, df, , , half]) => [(g.axis === 'r' ? df : dr) - (half ?? GAP), (g.axis === 'r' ? df : dr) + (half ?? GAP)]).filter(([, b]) => b > g.from).sort((p, q) => p[0] - q[0]);
    let v = g.from;
    for (const [a, b] of cuts) {
      if (a > v) out.push({ axis: g.axis, at: g.at, a: v, b: Math.min(a, g.to), y0: g.y0, y1: g.y1 });
      v = Math.max(v, b);
    }
    if (v < g.to) out.push({ axis: g.axis, at: g.at, a: v, b: g.to, y0: g.y0, y1: g.y1 });
  }
  return out;
}
