// The two buildings of several floors (2026-10-11): the district hospital in Kamenka and the police headquarters
// at the edge of the village. Asked for: "police station 2 story and the hospital 3 story and long, this will be
// the biggest building in the game so far ... make sure no overlapping textures, be creative with the layout, it
// should feel unique, each floor should have a different floorplan/purpose. stairs to the roof. Sniper spawn on
// roof of hospital and attachments."
//
// They are plans, in the same words every other building's is (see `blueprint` in buildings.ts): walls with their
// openings, what stands on each floor, and where things are kept. What is new in them is said in Blueprint:
// `levels` (the floors above the ground one), `wells` (the stairs), `deck` (the roof that is walked on).
//
// How the walls are laid, so that no face of one lies in a face of another (two faces in one plane flicker):
//   - a corridor's walls run its whole length; the walls across the building stop at the corridor wall's face;
//   - where two walls meet at a corner one runs through and the other stops at its face;
//   - nothing ends in the middle of another wall's doorway or window.
// x is along the building (its long side), z across it; the front, with the main door, is +z. Heights are from
// the floor a thing stands on.

import type { Blueprint, Deck, Fitting, Furn, Level, Opening, WallDef } from './buildings';

const win = (a: number, b: number, bottom = 0.9, top = 2.05): Opening => ({ a, b, bottom, top, kind: 'window' });
const door = (a: number, b: number, top = 2.1): Opening => ({ a, b, bottom: 0, top, kind: 'door' });
const gap = (a: number, b: number, top = 2.1): Opening => ({ a, b, bottom: 0, top, kind: 'gap' });

const PI = Math.PI, Q = PI / 2;
type P3 = [number, number, number];

/** What stands on a floor and what is kept there, gathered a room at a time. */
class Floor {
  furniture: Furn[] = [];
  loot: P3[] = [];
  /** a thing stood on the floor (`y`: or hung so high over it) */
  put(id: string, x: number, z: number, rot = 0, y?: number): this {
    this.furniture.push({ id, x, z, rot, ...(y === undefined ? {} : { y }) });
    return this;
  }
  /** places for things on the floor itself */
  floor(...at: [number, number][]): this {
    for (const [x, z] of at) this.loot.push([x, 0.02, z]);
    return this;
  }
  /** a bed (its head to -z, turned `rot`), and a place on it */
  bed(x: number, z: number, rot = 0, kept = true): this {
    this.put('old_bed_frame', x, z, rot);
    if (kept) this.loot.push([x, 0.48, z]);
    return this;
  }
  /** steel shelves, with a place on each of the boards named (0 the lowest of four) */
  shelves(x: number, z: number, rot: number, boards: number[] = [0, 1, 2]): this {
    this.furniture.push({ id: 'steel_frame_shelves_01', x, z, rot, scale: 0.1 });
    for (const b of boards) this.loot.push([x, [0.14, 0.65, 1.16, 1.66][b], z]);
    return this;
  }
  /** a thing with a top that things lie on, and `n` places on it at height `y` */
  top(id: string, x: number, z: number, rot: number, y: number, n = 1): this {
    this.put(id, x, z, rot);
    // (side by side along its length: the generator shares the top out between them)
    for (let k = 0; k < n; k++) this.loot.push([x, y, z]);
    return this;
  }
  /** a bookcase or a set of open shelves, with places at the heights named */
  case(id: 'wooden_bookshelf_worn' | 'Shelf_01', x: number, z: number, rot: number, heights: number[]): this {
    this.put(id, x, z, rot);
    for (const y of heights) this.loot.push([x, y, z]);
    return this;
  }
}

/** an inside wall: both its faces painted (`a` the face to the left of the way it runs, `b` the other) */
const inner = (from: [number, number], to: [number, number], openings: Opening[] = [], a: WallDef['ext'] = 'int_painted', b: WallDef['int'] = 'int_painted'): WallDef => ({ side: 'inner', from, to, ext: a, int: b, openings });

// ------------------------------------------------------------------------------------------------ the hospital

/** half its length and half its depth */
const HW = 23, HD = 8;
/** the inside faces of its outside walls */
const X0 = -HW + 0.2, X1 = HW - 0.2, Z0 = -HD + 0.2, Z1 = HD - 0.2;
/** the corridor's two walls (their middles), and the faces of them the rooms see */
const CF = 1.4, CB = -1.4, RF = 1.5, RB = -1.5;
/** the two stairwells: at the back, one at each end */
const WELL_W = { x0: X0, x1: X0 + 3.0, land: -3.6, far: Z0 }, WELL_E = { x0: X1 - 3.0, x1: X1, land: -3.6, far: Z0 };
/** the wall that shuts each off from the rooms beside it (its middle) */
const WW = WELL_W.x1 + 0.1, WE = WELL_E.x0 - 0.1;

/** a ceiling light: a long box hung under the ceiling of a floor `h` high, its tubes long dead */
const lamp = (h: number, x: number, z: number): Fitting => ({ key: 'lamp', x0: x - 0.6, x1: x + 0.6, y0: h - 0.07, y1: h - 0.004, z0: z - 0.09, z1: z + 0.09, soft: true });

/**
 * Its long sides are fourteen bays, 3.2 m apart: a window in each, one over another on every floor, and the walls
 * between rooms stand on the lines between two bays (so that none ever comes to the outside wall in a window).
 * (As first drawn, every room had the windows that suited it, each floor its own: from outside, a grey box with
 * holes in it. "the new buildings need more character ... make the building more realistic", 2026-10-12.)
 */
const BAY = 3.2;
const bay = (k: number) => -20.8 + BAY * k;
const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
/** a window in each of the bays numbered: all one size; some boarded up from outside, some barred */
const bays = (ks: number[], o: { boards?: number[]; bars?: number[] } = {}): Opening[] =>
  ks.map((k) => ({ ...win(bay(k) - 0.7, bay(k) + 0.7, 0.9, 2.3), ...(o.boards?.includes(k) ? { boards: true } : {}), ...(o.bars?.includes(k) ? { bars: true } : {}) }));
/** the window of a stair, half a floor up: at one end of the back wall or the other */
const stairWin = (east: boolean, bottom = 1.8): Opening => (east ? win(20.1, 21.5, bottom, bottom + 1.0) : win(-21.5, -20.1, bottom, bottom + 1.0));
/** the lights of a floor, hung under its ceiling: down the passage, and in the rooms of the bays numbered */
const lamps = (h: number, front: number[], back: number[]): Fitting[] => [...ALL.map((k) => lamp(h, bay(k), 0)), ...front.map((k) => lamp(h, bay(k), 4.6)), ...back.map((k) => lamp(h, bay(k), -4.6))];

export function hospitalPlan(): Blueprint {
  // ---------------------------------------------------------------- the ground floor: emergency, reception, the dispensary, the morgue
  const g = new Floor();
  // the way in for the wounded, at the west end of the corridor: a bed on wheels left where it stopped
  g.bed(-20.6, 0.72, Q).put('surgical_trolley', -19.0, -0.86).put('extinguisher_box', -15.2, 1.16, PI, 1.05);
  g.top('hospital_bench', -13.9, -0.96, 0, 0.46).top('hospital_bench', 10.6, -0.96, 0, 0.46).put('extinguisher_box', 16.6, -1.16, 0, 1.05);
  g.floor([-8.0, 0.2], [3.4, -0.4], [18.6, 0.3]);
  // triage: a bed under each of three windows, a screen on the wall between one and the next
  g.bed(-20.8, 6.75, PI).bed(-17.6, 6.75, PI).bed(-14.4, 6.75, PI);
  g.put('ward_curtain', -19.2, 6.55, Q).put('ward_curtain', -16.0, 6.55, Q).put('medical_light', -18.9, 4.9, 2.4);
  g.top('surgical_trolley', -15.6, 4.6, 0.3, 0.9).top('hospital_bench', -20.8, 1.84, 0, 0.46).put('med_cabinet', -13.2, 2.9, -Q).put('computer_cart', -13.25, 7.25, PI);
  g.floor([-18.6, 3.6], [-21.9, 3.9], [-14.6, 3.2]);
  // the treatment room
  g.bed(-11.2, 6.75, PI).put('ventilator', -9.75, 7.25, PI).put('surgical_lamp', -11.2, 5.9, 0.4, 2.5);
  g.top('lab_counter', -6.83, 5.0, -Q, 0.9, 2).put('instrument_tray', -6.83, 4.2, -Q, 0.9).put('med_sink', -7.2, 1.87, 0).shelves(-8.6, 1.78, 0);
  g.floor([-9.6, 4.0], [-11.4, 3.0]);
  // the hall: the desk faces the door, benches round the walls
  g.top('hospital_desk', 0, 3.4, PI, 0.78, 2).put('hospital_pc', 0.7, 3.3, PI, 0.76).put('SchoolChair_01', 0.1, 2.5, 0);
  g.top('hospital_bench', -5.97, 5.3, Q, 0.46).top('hospital_bench', 5.97, 5.3, -Q, 0.46).top('hospital_bench', -4.8, 7.46, PI, 0.46).put('hospital_bench', 4.8, 7.46, PI);
  g.put('water_cooler', 5.95, 2.3, -Q).put('extinguisher_box', -6.13, 2.3, Q, 1.05);
  g.floor([-2.6, 5.6], [2.8, 6.0], [-3.8, 2.6]);
  // the dispensary: a counter behind the hatch, shelves round the walls and down the middle
  g.top('lab_counter', 8.7, 2.05, 0, 0.9, 3);
  g.shelves(6.77, 3.9, Q).shelves(6.77, 5.1, Q, [0, 1, 2, 3]).shelves(6.77, 6.3, Q).shelves(12.43, 3.9, -Q).shelves(12.43, 5.1, -Q, [0, 1, 2, 3]).shelves(12.43, 6.3, -Q);
  g.shelves(9.6, 4.4, Q, [1, 2]).shelves(9.6, 5.6, Q, [0, 2]).put('med_cabinet', 9.6, 7.5, PI);
  g.floor([8.2, 3.6], [11.2, 4.6]);
  // the x-ray room: the table under the arm, the pictures on the wall
  g.top('steel_table', 18.0, 4.9, Q, 0.8).put('ceiling_arm', 18.0, 5.75, PI, 0.65).put('xray_viewer', 13.05, 4.6, Q, 1.2);
  g.top('metal_office_desk', 21.3, 3.1, PI, 0.81, 2).put('SchoolChair_01', 21.3, 2.2, 0).put('computer_cart', 13.35, 7.2, PI).top('lab_counter', 17.4, 7.46, PI, 0.9, 2).put('screen_curtain', 21.9, 6.2, 0);
  g.floor([15.6, 3.0], [20.0, 6.4]);
  // (back) the ambulance crews' room
  g.top('WoodenTable_01', -16.2, -4.6, 0, 0.57, 2).put('painted_wooden_chair_01', -16.6, -3.9, PI).put('painted_wooden_chair_01', -15.6, -5.3, 0.1).put('painted_wooden_chair_01', -17.5, -4.7, Q);
  g.top('electric_stove', -18.95, -7.45, 0, 0.88).top('painted_wooden_cabinet', -16.0, -7.47, 0, 1.2).case('Shelf_01', -13.05, -5.6, -Q, [0.66, 0.94, 1.22]).bed(-19.1, -3.5, 0);
  g.floor([-14.6, -2.6], [-17.8, -6.2]);
  // the laundry
  g.put('mop_bucket', -12.25, -2.6, 0.6).shelves(-12.43, -6.8, Q, [0, 3]).shelves(-12.43, -5.6, Q, [0, 3]).put('folded_blanket', -12.43, -6.8, Q, 0.66).put('folded_blanket', -12.43, -6.6, Q + 0.2, 1.17).put('folded_blanket', -12.43, -5.6, Q, 0.66).put('folded_blanket', -12.43, -5.8, Q + 0.1, 1.17);
  g.put('cardboard_box_01', -10.1, -6.5, 0.3).put('wooden_crate_01', -10.0, -3.8, Q).floor([-11.2, -4.6]);
  // the morgue: the cold chambers down the west wall, three tables, and the scales
  g.put('body_lockers', -7.98, -4.65, Q).put('autopsy_table', -4.4, -5.0, Q).put('autopsy_table', -1.8, -5.0, Q).put('covered_body', -1.8, -5.0, Q, 0.9).put('autopsy_table', 0.8, -5.0, Q).put('surgical_lamp', -4.4, -5.0, 0, 2.5);
  g.top('lab_counter', 1.7, -7.46, 0, 0.9).put('autopsy_scales', 2.4, -7.46, 0, 0.89).put('instrument_tray', 1.2, -7.46, 0.2, 0.9).put('med_sink', 2.73, -3.0, -Q).top('surgical_trolley', -5.6, -2.9, 0.2, 0.9).put('med_cabinet', -6.4, -7.5, 0);
  g.floor([-0.6, -2.6], [1.6, -2.8]);
  // the boiler room, and the door for the coal
  g.put('bunker_machine', 8.55, -4.3, Q).put('bunker_pipes', 3.46, -4.6, Q).put('utility_box_01', 4.0, -7.5, 0).put('utility_box_01', 3.56, -2.4, Q).put('wooden_crate_01', 4.7, -5.9, 0.4);
  g.floor([6.0, -3.2], [6.4, -6.0], [5.0, -4.2]);
  // records, and whoever watched the door
  g.top('metal_office_desk', 12.7, -4.2, 0, 0.81, 2).put('SchoolChair_01', 12.7, -3.35, PI).top('metal_office_desk', 16.6, -6.4, PI, 0.81, 2).put('SchoolChair_01', 16.6, -7.3, 0);
  g.case('wooden_bookshelf_worn', 19.28, -3.0, -Q, [0.67, 1.28]).case('wooden_bookshelf_worn', 19.28, -4.5, -Q, [0.39, 1.28]).case('wooden_bookshelf_worn', 19.28, -6.0, -Q, [0.67, 0.96]);
  g.case('Shelf_01', 9.85, -4.0, Q, [0.66, 1.22]).case('Shelf_01', 9.85, -5.2, Q, [0.38, 0.94]).top('painted_wooden_cabinet', 14.2, -7.47, 0, 1.2).put('Television_01', 13.7, -7.45, 0.2, 1.18);
  g.floor([14.8, -3.0], [18.0, -4.4]);

  const ground: WallDef[] = [
    // (the dispensary's windows were boarded when the looting began, and one by the way in was put through)
    // (the block built out before its doors stands against the middle of it: the two windows there look into that)
    { side: 'front', ext: 'hosp_ext', int: 'ward_wall', covered: [[-6.4, 6.4]], openings: [...bays([0, 1, 2, 3, 4, 5], { boards: [4] }), jdoor(-1.3, -0.05, 2.3), jdoor(0.05, 1.3, 2.3), ...bays([8, 9, 10, 11, 12, 13], { boards: [9, 10, 12] })] },
    // (bars on the records room; the morgue's two middle windows boarded; the boiler has the chimney where its window would be, and its door)
    // (the wing stands against it from -16 to -3.2: the way into the wing's passage, and the door from the morgue to its cold room)
    { side: 'back', ext: 'hosp_ext', int: 'int_painted', covered: [[-16, -3.2]], openings: [stairWin(false, 1.9), ...bays([1]), jdoor(-11.75, -10.65), jdoor(-5.3, -4.3), ...bays([6, 7], { boards: [6] }), door(7.45, 8.55), ...bays([10, 11, 12], { bars: [10, 11, 12] }), stairWin(true, 1.9)] },
    { side: 'left', ext: 'hosp_ext', int: 'int_painted', openings: [door(-0.55, 0.55, 2.2), win(3.6, 5.0)] },
    { side: 'right', ext: 'hosp_ext', int: 'int_painted', openings: [door(-0.55, 0.55, 2.2), win(3.6, 5.0)] },
    // the corridor's front wall, in two (the hall between them is open to it), and its back wall
    inner([X0, CF], [-6.4, CF], [door(-18.0, -17.0), door(-10.2, -9.2)], 'ward_wall'),
    inner([6.4, CF], [X1, CF], [win(7.6, 9.8, 1.05, 2.0), door(11.4, 12.4), door(14.2, 15.2)], 'tile_wall'),
    inner([X0, CB], [X1, CB], [gap(-22.3, -20.7, 2.3), door(-17.2, -16.2), door(-11.7, -10.7), door(-2.5, -1.45), door(-1.35, -0.3), door(5.9, 6.9), door(13.6, 14.6), gap(20.7, 22.3, 2.3)]),
    // across the front
    inner([-12.8, RF], [-12.8, Z1], [door(4.0, 5.0)], 'ward_wall', 'ward_wall'),
    inner([-6.4, 1.3], [-6.4, Z1], [], 'ward_wall'),
    inner([6.4, 1.3], [6.4, Z1], [], 'int_painted', 'tile_wall'),
    inner([12.8, RF], [12.8, Z1], [], 'tile_wall', 'tile_wall'),
    // across the back
    inner([WW, Z0], [WW, RB]),
    inner([-12.8, Z0], [-12.8, RB]),
    inner([-9.6, Z0], [-9.6, RB], [], 'int_painted', 'tile_wall'),
    inner([3.2, Z0], [3.2, RB], [], 'tile_wall', 'int_plaster'),
    inner([9.6, Z0], [9.6, RB], [], 'int_plaster', 'office_wall'),
    inner([WE, Z0], [WE, RB], [], 'office_wall'),
    // (two walls across the corridor with a way through each: the length of it is not one line of fire)
    screen(-15.9, 'ward_wall'), screen(16.0),
  ];

  // ---------------------------------------------------------------- the first floor: one long ward to the west, single rooms to the east
  const w = new Floor();
  // beds down the two long walls. At the front a pair to every window, a pace between one bed and the next, and a
  // screen on the wall between two windows here and there (two are gone: something else stands in their places);
  // at the back one under each window.
  for (const [k, x] of [-21.6, -20.0, -18.4, -16.8, -13.6, -12.0, -10.4, -8.8, -2.4, -0.8].entries()) w.bed(x, 6.75, PI, k % 3 !== 1);
  for (const x of [-19.2, -12.8, -6.4]) w.put('ward_curtain', x, 6.55, Q);
  for (const [k, x] of [-17.6, -14.4, -8.0, -4.8, -1.6].entries()) w.bed(x, -6.75, 0, k % 3 !== 2);
  for (const x of [-16.0, -9.6, -3.2]) w.put('screen_curtain', x, -6.6, 0);
  w.put('folded_blanket', -20.0, 7.0, 0.2, 0.6).put('folded_blanket', -12.0, 6.9, -0.3, 0.6).put('folded_blanket', -8.0, -6.9, 0.4, 0.6).put('medical_light', -15.3, 6.2, 0.6).put('medical_light', -12.8, -6.3, 2.2).put('ventilator', -7.0, 7.2, PI);
  // the sisters' desk, looking down the ward, and what they wheeled about
  w.top('hospital_desk', -3.0, 0, Q, 0.78, 2).put('hospital_pc', -2.9, 0.7, Q, 0.76).put('SchoolChair_01', -2.1, -0.1, -Q);
  w.top('surgical_trolley', -9.6, 0.6, 0.4, 0.9).top('surgical_trolley', -16.2, -0.5, -0.2, 0.9).put('computer_cart', -20.6, 0.4, Q).put('med_sink', -19.24, -4.0, Q).put('med_cabinet', -19.3, -5.6, Q).put('med_cabinet', -22.52, 2.6, Q);
  w.floor([-12.0, 1.8], [-6.0, -2.4], [-20.2, 3.4], [-14.4, -3.0]);
  // (east) three single rooms and the room at the end, kept apart
  w.bed(1.6, 6.75, PI).top('painted_wooden_cabinet', 3.2, 7.47, PI, 1.2).put('painted_wooden_chair_01', 3.4, 5.4, 2.6).put('medical_light', 2.4, 4.4, 1.0).floor([4.6, 3.4]);
  w.bed(8.0, 6.75, PI).top('painted_wooden_cabinet', 9.6, 7.47, PI, 1.2).put('screen_curtain', 10.4, 5.2, 0).put('painted_wooden_chair_01', 8.8, 4.6, -2.2).floor([11.4, 3.2]);
  w.bed(14.4, 6.75, PI).top('painted_wooden_cabinet', 16.0, 7.47, PI, 1.2).put('ventilator', 13.35, 5.2, Q).put('computer_cart', 18.75, 7.2, PI).floor([17.4, 3.6]);
  w.bed(20.8, 6.75, PI).put('med_sink', 22.42, 3.0, -Q).put('ward_curtain', 20.8, 5.0, 0).floor([20.4, 2.6]);
  // (back) the sisters' office, the linen, the dressing room
  w.top('metal_office_desk', 2.4, -5.4, PI, 0.81, 2).put('SchoolChair_01', 2.4, -6.25, 0).case('wooden_bookshelf_worn', 0.42, -3.6, Q, [0.67, 1.28]).shelves(3.2, -7.5, 0).shelves(6.03, -6.6, -Q, [1, 2]).top('painted_wooden_cabinet', 0.8, -7.47, 0, 1.2).floor([4.4, -3.2]);
  w.shelves(6.77, -3.0, Q, [0, 3]).shelves(6.77, -4.2, Q, [1]).shelves(6.77, -5.4, Q, [0, 2]).shelves(9.23, -4.0, -Q, [0, 3]).shelves(9.23, -5.2, -Q, [2]);
  w.put('folded_blanket', 6.77, -3.0, Q, 0.66).put('folded_blanket', 6.77, -3.1, Q, 1.17).put('folded_blanket', 6.77, -4.2, Q, 1.17).put('folded_blanket', 9.23, -4.0, -Q, 0.66).put('folded_blanket', 9.23, -5.2, -Q, 0.66).put('mop_bucket', 8.9, -7.2, 2.2).floor([8.0, -6.4]);
  w.top('steel_table', 15.0, -4.6, Q, 0.8).put('surgical_lamp', 15.0, -4.6, 0.3, 2.3).top('surgical_trolley', 13.2, -3.2, 0, 0.9).put('instrument_tray', 13.2, -3.2, 0.5, 0.9).put('med_cabinet', 12.8, -7.5, 0).put('med_cabinet', 18.85, -7.5, 0).put('med_sink', 10.07, -3.2, Q);
  w.top('lab_counter', 19.28, -4.2, -Q, 0.9, 2).floor([16.8, -2.8], [13.6, -6.4]);
  // the passage between them
  w.top('hospital_bench', 5.9, -0.96, 0, 0.46).bed(13.7, 0.72, Q).put('extinguisher_box', 12.0, -1.16, 0, 1.05).floor([9.8, 0.2], [20.6, -0.4]);

  const ward: WallDef[] = [
    // (two doors onto the roof of the block before the doors, which is a balcony at this height)
    { side: 'front', ext: 'hosp_ext', int: 'ward_wall', openings: [...bays([0, 1, 2, 3, 4], { boards: [3] }), door(-5.3, -4.3), ...bays([6, 7]), door(4.3, 5.3), ...bays([9, 10, 11, 12, 13], { boards: [11] })] },
    { side: 'back', ext: 'hosp_ext', int: 'ward_wall', covered: [[-16, -3.2]], openings: [stairWin(false), ...bays([1]), jdoor(-11.75, -10.65), ...bays([6, 7, 9, 10, 11, 12], { boards: [10] }), stairWin(true)] },
    // (at each end of the building a door onto the stairs outside)
    { side: 'left', ext: 'hosp_ext', int: 'ward_wall', openings: [door(-0.55, 0.55), win(3.6, 5.0)] },
    { side: 'right', ext: 'hosp_ext', int: 'int_painted', openings: [door(-0.55, 0.55), win(3.6, 5.0)] },
    // the wall across the building that parts the ward from the rooms: two doors side by side in the passage
    inner([0, Z0], [0, Z1], [door(-1.15, -0.08), door(0.08, 1.15)], 'ward_wall', 'int_painted'),
    // round the west stair
    inner([X0, CB], [-19.6, CB], [gap(-22.3, -20.7, 2.3)], 'ward_wall'),
    inner([WW, Z0], [WW, RB], [], 'ward_wall'),
    // the passage east of that wall
    inner([0.1, CF], [X1, CF], [door(2.6, 3.6), door(9.2, 10.2), door(15.8, 16.8), door(20.6, 21.6)], 'ward_wall'),
    inner([0.1, CB], [X1, CB], [door(2.6, 3.6), door(7.5, 8.5), door(14.6, 15.6), gap(20.7, 22.3, 2.3)], 'int_painted', 'office_wall'),
    inner([6.4, RF], [6.4, Z1], [], 'ward_wall', 'ward_wall'),
    inner([12.8, RF], [12.8, Z1], [], 'ward_wall', 'ward_wall'),
    inner([19.2, RF], [19.2, Z1], [], 'tile_wall', 'ward_wall'),
    inner([6.4, Z0], [6.4, RB], [], 'office_wall', 'int_plaster'),
    inner([9.6, Z0], [9.6, RB], [], 'int_plaster', 'tile_wall'),
    inner([WE, Z0], [WE, RB], [], 'tile_wall'),
    screen(11.5),
  ];

  // ---------------------------------------------------------------- the second floor: two theatres, the laboratory, and the offices
  const s = new Floor();
  // the big theatre
  s.put('autopsy_table', -18.0, 4.8, 0).put('surgical_lamp', -18.0, 4.8, 0.2, 2.3).put('ventilator', -19.7, 4.2, Q).top('surgical_trolley', -16.4, 5.7, 0.2, 0.9).put('instrument_tray', -16.4, 5.7, 0.4, 0.9).top('surgical_trolley', -17.2, 3.3, -0.3, 0.9);
  s.put('medical_light', -19.6, 6.4, 0.8).put('xray_viewer', -18.1, 7.67, PI, 1.2).put('med_cabinet', -13.2, 2.9, -Q).put('computer_cart', -21.9, 2.4, Q).put('ceiling_arm', -15.2, 6.3, 0.6, 0.45).floor([-20.6, 3.0], [-15.0, 2.6]);
  // the scrub room between them
  s.put('med_sink', -12.0, 7.44, PI).put('med_sink', -10.6, 7.44, PI).shelves(-10.0, 2.9, -Q, [0, 1]).put('folded_blanket', -10.0, 2.9, -Q, 1.17).put('folded_blanket', -10.0, 3.1, -Q, 1.67).put('mop_bucket', -12.2, 3.3, 1.0).floor([-11.2, 5.8]);
  // the small theatre: whoever was on the table is on it still
  s.put('steel_table', -3.0, 4.9, Q).put('covered_body', -3.0, 4.9, 0, 0.8).put('surgical_lamp', -3.0, 4.9, -0.2, 2.3).put('ventilator', -5.2, 4.4, Q).top('surgical_trolley', -1.2, 3.4, 0.1, 0.9).put('instrument_tray', -1.2, 3.4, 0.2, 0.9);
  s.put('medical_light', -5.0, 6.6, 0.7).put('screen_curtain', 2.2, 5.8, 0).put('med_cabinet', -6.4, 7.5, PI).top('lab_counter', 1.2, 7.46, PI, 0.9, 2).floor([-5.6, 2.8], [0.6, 2.6]);
  // recovery: a bed under each window, each watched
  for (const x of [4.8, 8.0, 11.2]) s.bed(x, 6.75, PI);
  s.put('ward_curtain', 6.4, 6.55, Q).put('ward_curtain', 9.6, 6.55, Q).put('medical_light', 6.5, 4.9, 0.9);
  s.put('ventilator', 3.7, 4.6, Q).put('computer_cart', 12.25, 3.4, -Q).put('med_cabinet', 12.41, 4.9, -Q).top('hospital_bench', 5.5, 1.84, 0, 0.46).top('surgical_trolley', 9.0, 3.4, 0.5, 0.9).floor([6.8, 4.2], [10.4, 4.6]);
  // the director's room
  s.top('metal_office_desk', 18.4, 4.6, 0, 0.81, 2).put('SchoolChair_01', 18.4, 5.5, PI).put('painted_wooden_chair_01', 17.9, 3.4, 0.2).put('painted_wooden_chair_01', 19.1, 3.3, -0.3);
  s.case('wooden_bookshelf_worn', 13.21, 3.0, Q, [0.67, 1.28]).case('wooden_bookshelf_worn', 13.21, 4.5, Q, [0.39, 0.96, 1.66]).case('wooden_bookshelf_worn', 13.21, 6.0, Q, [0.67, 1.28]);
  s.top('painted_wooden_table', 20.7, 2.9, 0, 0.98, 2).top('painted_wooden_cabinet', 21.9, 7.47, PI, 1.2).put('Television_01', 21.9, 7.45, PI - 0.2, 1.18).put('weapons_case', 15.0, 7.35, 0.1).put('water_cooler', 22.5, 5.8, -Q).floor([16.0, 6.6], [21.4, 5.2]);
  // (back) the laboratory
  s.put('lab_table', -17.0, -4.8, 0).top('steel_table', -13.6, -4.8, 0, 0.8, 2).top('lab_counter', -18.4, -7.46, 0, 0.9, 2).top('lab_counter', -13.8, -7.46, 0, 0.9, 2).put('med_sink', -19.24, -2.7, Q);
  s.shelves(-10.0, -3.2, -Q).shelves(-10.0, -4.4, -Q, [0, 1, 2, 3]).shelves(-10.0, -5.6, -Q).put('computer_cart', -15.4, -7.2, 0).put('medical_light', -19.0, -6.2, 1.2).floor([-15.2, -2.6], [-11.6, -6.4]);
  // the blood store
  s.shelves(-9.2, -3.3, Q).shelves(-9.2, -4.5, Q, [1, 2]).shelves(-9.2, -5.7, Q).shelves(-6.8, -3.6, -Q, [0, 1, 2, 3]).shelves(-6.8, -4.8, -Q).put('med_cabinet', -6.77, -6.3, -Q).floor([-8.0, -4.2]);
  // the archive: cases round the walls and two rows down the middle
  for (const z of [-3.0, -4.5, -6.0]) s.case('wooden_bookshelf_worn', -5.99, z, Q, z === -4.5 ? [0.67] : [0.39, 1.28]).case('wooden_bookshelf_worn', 2.79, z, -Q, z === -4.5 ? [0.96] : []);
  for (const x of [-3.1, -2.0, -0.9, 0.2]) s.case('Shelf_01', x, -4.45, 0, x === -0.9 ? [0.94] : []).case('Shelf_01', x, -4.85, PI, x === -2.0 ? [0.66, 1.22] : []);
  s.top('metal_office_desk', 1.2, -2.45, PI, 0.81).put('cardboard_box_01', -2.8, -7.2, 0.3).put('cardboard_box_01', 1.6, -7.3, 1.1).put('cardboard_box_01', -0.4, -6.9, 0.7).floor([-3.8, -2.6], [1.8, -6.6]);
  // where the staff sat down
  s.top('painted_wooden_table', 8.0, -4.4, 0, 0.98, 2).put('painted_wooden_chair_01', 7.2, -3.5, PI).put('painted_wooden_chair_01', 8.8, -3.5, PI + 0.2).put('painted_wooden_chair_01', 7.4, -5.3, 0).put('painted_wooden_chair_01', 8.9, -5.3, -0.2);
  s.top('electric_stove', 4.0, -7.45, 0, 0.88).top('painted_wooden_cabinet', 5.0, -7.47, 0, 1.2).put('water_cooler', 12.5, -2.3, -Q).top('hospital_bench', 9.8, -7.46, 0, 0.46).floor([5.4, -3.0], [10.6, -5.6]);
  // the clerks
  s.top('metal_office_desk', 15.2, -4.0, 0, 0.81, 2).put('hospital_pc', 15.7, -4.1, 0, 0.8).put('SchoolChair_01', 15.2, -3.1, PI).top('metal_office_desk', 17.4, -6.3, PI, 0.81, 2).put('SchoolChair_01', 17.4, -7.15, 0);
  s.case('Shelf_01', 13.05, -4.2, Q, [0.66, 1.22]).case('Shelf_01', 13.05, -5.4, Q, [0.94]).case('wooden_bookshelf_worn', 19.28, -3.4, -Q, [0.67, 1.28]).floor([16.8, -2.6], [13.6, -6.8]);
  // the passage
  s.top('hospital_bench', -13.4, -0.96, 0, 0.46).top('hospital_bench', 11.2, 0.96, PI, 0.46).bed(-6.0, -0.72, Q).put('surgical_trolley', 3.6, 0.9, 0.3).put('extinguisher_box', -20.0, 1.16, PI, 1.05).put('extinguisher_box', 18.4, -1.16, 0, 1.05).floor([-17.6, 0.3], [7.0, -0.3], [19.6, 0.2]);

  const surgery: WallDef[] = [
    { side: 'front', ext: 'hosp_ext', int: 'tile_wall', openings: bays(ALL, { boards: [6] }) },
    // (the wing's roof is a terrace at this height: a door onto it from the laboratory and one from the archive)
    { side: 'back', ext: 'hosp_ext', int: 'int_painted', openings: [stairWin(false), ...bays([1, 2], { boards: [2] }), door(-11.7, -10.7), ...bays([4]), door(-5.3, -4.3), ...bays([6, 7, 9, 10, 11, 12]), stairWin(true)] },
    { side: 'left', ext: 'hosp_ext', int: 'tile_wall', openings: [door(-0.55, 0.55), win(3.6, 5.0)] },
    { side: 'right', ext: 'hosp_ext', int: 'office_wall', openings: [door(-0.55, 0.55), win(3.6, 5.0)] },
    inner([X0, CF], [X1, CF], [door(-18.4, -17.35), door(-17.25, -16.2), door(-11.7, -10.7), door(-4.1, -3.05), door(-2.95, -1.9), door(6.6, 7.6), door(15.4, 16.4)], 'tile_wall'),
    inner([X0, CB], [X1, CB], [gap(-22.3, -20.7, 2.3), door(-15.6, -14.6), door(-8.5, -7.5), door(-0.9, 0.1), door(7.6, 8.6), door(15.2, 16.2), gap(20.7, 22.3, 2.3)]),
    inner([-12.8, RF], [-12.8, Z1], [door(4.2, 5.2)], 'tile_wall', 'tile_wall'),
    inner([-9.6, RF], [-9.6, Z1], [door(4.2, 5.2)], 'tile_wall', 'tile_wall'),
    inner([3.2, RF], [3.2, Z1], [], 'ward_wall', 'tile_wall'),
    inner([12.8, RF], [12.8, Z1], [], 'office_wall', 'ward_wall'),
    inner([WW, Z0], [WW, RB], [], 'tile_wall'),
    inner([-9.6, Z0], [-9.6, RB], [], 'tile_wall', 'tile_wall'),
    inner([-6.4, Z0], [-6.4, RB], [], 'office_wall', 'tile_wall'),
    inner([3.2, Z0], [3.2, RB], [], 'office_wall', 'office_wall'),
    inner([12.8, Z0], [12.8, RB], [], 'office_wall', 'office_wall'),
    inner([WE, Z0], [WE, RB], [], 'int_painted', 'office_wall'),
    screen(-9.4, 'tile_wall'), screen(13.0),
  ];

  // ---------------------------------------------------------------- the roof
  const r = new Floor();
  // somebody made a place to shoot from up here, over the street: two road blocks dragged to the edge, a table,
  // and what they could not carry down again
  r.put('concrete_road_barrier', -4.6, 7.25, 0).put('concrete_road_barrier', -2.9, 7.25, 0).top('WoodenTable_01', -2.2, 5.4, 0.1, 0.57, 3).put('painted_wooden_chair_01', -3.4, 5.6, 1.9).put('wooden_military_crate', -5.4, 5.3, 0.5).put('cardboard_box_01', -0.6, 6.2, 0.3);
  r.floor([-3.9, 6.4], [-4.6, 4.7], [6.0, -3.0], [-12.0, 2.0], [14.0, -5.6]);
  const roof: Deck = {
    parapet: 1.1, h: 2.5,
    walls: [
      // over the west stair: its door to the roof in the wall that faces the front
      { side: 'inner', from: [X0, CB], to: [-19.6, CB], ext: 'hosp_ext', int: 'int_painted', openings: [door(-21.9, -20.9)] },
      { side: 'inner', from: [WW, RB], to: [WW, Z0], ext: 'hosp_ext', int: 'int_painted', openings: [] },
      // and the east one
      { side: 'inner', from: [19.6, CB], to: [X1, CB], ext: 'hosp_ext', int: 'int_painted', openings: [door(20.9, 21.9)] },
      { side: 'inner', from: [WE, Z0], to: [WE, RB], ext: 'hosp_ext', int: 'int_painted', openings: [] },
    ],
    roofs: [{ x0: -HW, x1: -19.6, z0: -HD, z1: -1.3 }, { x0: 19.6, x1: HW, z0: -HD, z1: -1.3 }],
    boxes: [
      // the outside walls of those two rooms, on the wall round the roof
      { key: 'hosp_ext', x0: -HW, x1: X0, y0: 1.17, y1: 2.5, z0: -HD, z1: -1.3 },
      { key: 'hosp_ext', x0: X0, x1: -19.6, y0: 1.17, y1: 2.5, z0: -HD, z1: Z0 },
      { key: 'hosp_ext', x0: X1, x1: HW, y0: 1.17, y1: 2.5, z0: -HD, z1: -1.3 },
      { key: 'hosp_ext', x0: 19.6, x1: X1, y0: 1.17, y1: 2.5, z0: -HD, z1: Z0 },
      // the water tank on its legs
      ...[[6.4, -6.4], [9.0, -6.4], [6.4, -4.4], [9.0, -4.4]].map(([x, z]) => ({ key: 'steel' as const, x0: x - 0.08, x1: x + 0.08, y0: 0, y1: 1.0, z0: z - 0.08, z1: z + 0.08 })),
      { key: 'steel', x0: 6.1, x1: 9.3, y0: 1.0, y1: 2.7, z0: -6.7, z1: -4.1 },
      { key: 'concrete', x0: 6.0, x1: 9.4, y0: 2.7, y1: 2.78, z0: -6.8, z1: -4.0, soft: true },
      // air shafts, each with a cap
      ...[[-12.4, -5.6], [-1.0, -5.8], [-9.4, 3.4], [13.4, 4.4]].flatMap(([x, z]) => [
        { key: 'concrete' as const, x0: x - 0.6, x1: x + 0.6, y0: 0, y1: 0.95, z0: z - 0.45, z1: z + 0.45 },
        { key: 'roof_iron' as const, x0: x - 0.75, x1: x + 0.75, y0: 0.95, y1: 1.02, z0: z - 0.6, z1: z + 0.6, soft: true },
      ]),
      // the coolers
      { key: 'steel', x0: 15.6, x1: 17.0, y0: 0.12, y1: 1.0, z0: 2.0, z1: 2.8 },
      { key: 'steel', x0: 17.5, x1: 18.9, y0: 0.12, y1: 1.0, z0: 2.0, z1: 2.8 },
      { key: 'concrete', x0: 15.4, x1: 19.1, y0: 0, y1: 0.12, z0: 1.8, z1: 3.0 },
      // a mast
      { key: 'steel', x0: 3.46, x1: 3.54, y0: 0, y1: 5.2, z0: -6.54, z1: -6.46 },
      { key: 'steel', x0: 2.9, x1: 4.1, y0: 4.2, y1: 4.24, z0: -6.52, z1: -6.48, soft: true },
      { key: 'steel', x0: 3.1, x1: 3.9, y0: 4.8, y1: 4.84, z0: -6.52, z1: -6.48, soft: true },
      { key: 'concrete', x0: 3.2, x1: 3.8, y0: 0, y1: 0.18, z0: -6.8, z1: -6.2 },
      // the middle of the front stands a little higher than the rest, over the way in: the name of the place was on it
      { key: 'hosp_ext', x0: -4.3, x1: 4.3, y0: 1.17, y1: 2.6, z0: HD - 0.2, z1: HD },
      { key: 'concrete', x0: -4.36, x1: 4.36, y0: 2.6, y1: 2.68, z0: HD - 0.26, z1: HD + 0.06, soft: true },
    ],
    furniture: r.furniture,
    loot: r.loot,
    open: [{ side: 'left', a: -0.85, b: 0.85 }, { side: 'right', a: -0.85, b: 0.85 }],
    usage: ['Military'],
    // the rifle lies by the road blocks; its glass, its can and its cheek rest are on the table; a box of its rounds by the crate
    keeps: [{ id: 'mosin', x: -3.9, z: 6.4 }, { id: 'pu_scope', x: -2.8, z: 5.4 }, { id: 'suppressor_762', x: -2.2, z: 5.4 }, { id: 'rifle_wrap', x: -1.6, z: 5.4 }, { id: 'box_762', x: -4.6, z: 4.7 }],
  };

  // pillars down the long ward, where the walls of the floor below stand
  const pillars: Fitting[] = [[-12.8, 1.4], [-6.4, 1.4], [-12.8, -1.4], [-6.4, -1.4]].map(([x, z]) => ({ key: 'ward_wall', x0: x - 0.2, x1: x + 0.2, y0: 0, y1: 3.0, z0: z - 0.2, z1: z + 0.2 }));
  // What stands against it outside: the boiler's chimney up the back wall, by its door, as high again as the
  // roof; a slab over that door. (The way in is a block of its own: `hospitalLobbyPlan`. Over the door at the west
  // end, where the wounded were brought in, is the first landing of the stairs outside.)
  const outside: Fitting[] = [
    { key: 'brick_ext', x0: 4.1, x1: 5.5, y0: -1, y1: 14.6, z0: -HD - 1.4, z1: -HD - 0.002 },
    { key: 'concrete', x0: 4.02, x1: 5.58, y0: 14.6, y1: 14.82, z0: -HD - 1.48, z1: -HD + 0.08, soft: true },
    { key: 'concrete', x0: 4.05, x1: 5.55, y0: 11.3, y1: 11.48, z0: -HD - 1.45, z1: -HD + 0.05, soft: true },
    { key: 'concrete', x0: 6.9, x1: 9.1, y0: 2.3, y1: 2.42, z0: -HD - 1.3, z1: -HD - 0.002 },
  ];

  const levels: Level[] = [
    { h: 3.0, int: 'ward_wall', floor: 'floor_lino', walls: ward, furniture: w.furniture, loot: w.loot },
    { h: 3.0, int: 'tile_wall', floor: 'floor_lino', walls: surgery, furniture: s.furniture, loot: s.loot, usage: ['Medic', 'Town'] },
  ];
  return {
    w: HW * 2, d: HD * 2, h: 3.2, ext: 'hosp_ext', int: 'int_painted', floor: 'floor_lino', roof: 'concrete', roofType: 'flat',
    walls: ground, furniture: g.furniture, loot: g.loot,
    levels, wells: [WELL_W, WELL_E], deck: roof,
    // (out at either end from every floor and from the roof)
    escapes: [{ side: 'left', at: 0, dir: -1, floors: 2, roof: true }, { side: 'right', at: 0, dir: -1, floors: 2, roof: true }],
    fittings: [
      { level: 0, list: [...outside, ...lamps(3.2, [1, 3, 4, 6, 7, 9, 10, 12], [1, 2, 3, 5, 7, 9, 11, 12])] },
      { level: 1, list: [...pillars, ...lamps(3.0, [0, 2, 4, 6, 7, 9, 11, 13], [1, 3, 5, 7, 8, 10, 12])] },
      { level: 2, list: lamps(3.0, [0, 2, 4, 6, 8, 10, 12], [1, 3, 5, 7, 9, 11, 12]) },
    ],
    // (the name of the place, on the raised middle of the wall round the roof)
    sign: { x: 0, y: 11.72, size: 1.7, text: 'БОЛЬНИЦА', sub: 'HOSPITAL', board: '#e4e0d4', ink: '#8c1f1f' },
    dress: {
      plinth: { h: 0.85, key: 'plinth' }, bands: 'trim_white', trim: 'trim_white',
      // (none where the wing stands against the back, nor down the ends where the stairs outside are)
      piers: { front: [-22.74, -19.2, -12.8, -6.4, 6.4, 12.8, 19.2, 22.74], back: [-22.74, -19.2, 0, 6.4, 12.8, 19.2, 22.74], left: [2.3, 7.74], right: [2.3, 7.74], w: 0.44, key: 'trim_white' },
      dado: { ward_wall: 'ward_dado', office_wall: 'office_dado', tile_wall: 'tile_dado', int_painted: 'office_dado' },
    },
    usage: ['Medic'],
  };
}

/** a door that leads into another part of the same building */
const jdoor = (a: number, b: number, top = 2.1): Opening => ({ ...door(a, b, top), join: true });
/** a way across a corridor, through a wall that is only there to break it up: somewhere to stand out of a line of fire */
const screen = (x: number, a: WallDef['ext'] = 'int_painted'): WallDef => inner([x, CB], [x, CF], [gap(-0.8, 0.8, 2.3)], a, a);

// ------------------------------------------------------------------------------------------------ the hospital's wing

/**
 * The wing behind the hospital (2026-10-12: "i dont like the rigid box style ... more creative layouts ... 2
 * flights of stairs at least on both sides and emergency exits ... think about dynamic gameplay and FPS angles").
 * Two floors, standing against the back of the main block west of its middle; its roof is a terrace at the height
 * of the main block's top floor, which has two doors onto it. Below: a passage on from the main block's, the cold
 * room (a door from the morgue), the pathology laboratory behind a window, a bay cars were unloaded in, a stair of
 * its own. Above: rooms for those who were kept apart, each watched through a window from the passage. Out at
 * its far end by a door, and down from its roof and its upper floor by stairs outside.
 *
 * In its own measure: x across it (-6.4 to 6.4), z along it, its front (+7) the main block's back wall, which is
 * the only wall there. The main block's x is this less 9.6, its z this less 15.
 */
export function hospitalWingPlan(): Blueprint {
  const WX = 6.4, WZ = 7, x0 = -WX + 0.2, x1 = WX - 0.2, z0 = -WZ + 0.2, z1 = WZ;
  // the passage's two walls (their middles): it is the main block's own passage carried on, west of the wing's middle
  const PW_ = -2.9, PE = -0.3;
  const well = { x0, x1: PW_ - 0.1, land: -1.6, far: z0 };
  const side = (z: number, o: Partial<Opening> = {}): Opening => ({ ...win(z - 0.7, z + 0.7, 0.9, 2.3), ...o });

  // ---------------------------------------------------------------- below
  const g = new Floor();
  // the sluice
  g.put('med_sink', -5.84, 5.0, Q).shelves(-4.6, 6.73, PI, [0, 3]).put('folded_blanket', -4.6, 6.73, PI, 0.66).put('mop_bucket', -5.6, 6.4, 0.5).floor([-4.4, 4.6]);
  // before the stair
  g.top('hospital_bench', -5.87, 1.6, Q, 0.46).put('extinguisher_box', -4.6, 3.24, PI, 1.05).floor([-4.6, 0.2]);
  // the cold room: two tables, one of them in use
  g.put('autopsy_table', 2.0, 6.2, 0).put('covered_body', 2.0, 6.2, 0, 0.9).put('autopsy_table', 2.2, 4.25, 0).put('med_cabinet', 4.9, 3.58, 0).floor([4.6, 5.4], [0.6, 3.9]);
  // the laboratory: benches under the windows, a table in the middle
  g.top('lab_counter', 5.88, 1.6, -Q, 0.9, 2).top('lab_counter', 5.88, -1.6, -Q, 0.9, 2).put('lab_table', 2.6, 0.2, 0).put('xray_viewer', 2.6, 2.97, PI, 1.2).put('med_cabinet', 3.2, -2.82, 0).put('computer_cart', 0.3, -2.6, Q).floor([4.2, 0], [1.2, 1.9]);
  // the bay: a cot nobody came back for, drums, boxes
  g.bed(1.6, -6.2, Q).put('barrel_03', 0.3, -3.8, 0).put('barrel_03', 1.08, -3.75, 1).put('cardboard_box_01', 3.2, -3.7, 0.4).put('surgical_trolley', 3.4, -6.3, 0.3).floor([4.6, -5.0], [2.6, -4.8]);
  // the passage
  g.put('surgical_trolley', -0.85, -2.8, 0.2).put('extinguisher_box', -2.64, -4.4, Q, 1.05).floor([-1.6, 4.0], [-1.6, -5.4]);

  const below: WallDef[] = [
    { side: 'back', ext: 'hosp_ext', int: 'int_painted', openings: [win(-5.3, -3.9, 1.9, 2.9), door(-2.15, -1.05), win(2.6, 4.0, 0.9, 2.3)] },
    { side: 'left', ext: 'hosp_ext', int: 'int_painted', openings: [side(1.6), side(4.8, { boards: true })] },
    // (the bay's way in for a car; bars on the laboratory)
    { side: 'right', ext: 'hosp_ext', int: 'tile_wall', openings: [gap(-6.2, -3.9, 2.6), side(-1.6, { bars: true }), side(1.6, { bars: true }), side(4.8, { boards: true })] },
    inner([PW_, z0], [PW_, z1], [gap(0.4, 2.6, 2.3), door(4.6, 5.6)], 'int_painted', 'int_painted'),
    inner([PE, z0], [PE, z1], [door(-5.6, -4.6), win(-2.6, -0.6, 1.05, 2.0), door(0.2, 1.2), door(4.4, 5.4)], 'tile_wall', 'int_painted'),
    inner([x0, 3.5], [PW_ - 0.1, 3.5], [], 'int_painted', 'tile_wall'),
    inner([PE + 0.1, 3.2], [x1, 3.2], [], 'tile_wall', 'tile_wall'),
    inner([PE + 0.1, -3.2], [x1, -3.2], [], 'int_plaster', 'tile_wall'),
  ];

  // ---------------------------------------------------------------- above: those who were kept apart
  const u = new Floor();
  u.put('med_sink', -5.84, 4.6, Q).put('med_sink', -5.84, 5.8, Q).shelves(-4.6, 6.73, PI, [1, 2]).floor([-4.2, 4.8]);
  u.top('hospital_bench', -5.87, 1.6, Q, 0.46).floor([-4.6, 0.4]);
  // one bed, and what kept its last patient breathing
  u.bed(5.1, 4.8, Q).put('ventilator', 3.6, 6.5, PI).top('painted_wooden_cabinet', 2.0, 3.62, 0, 1.2).put('ward_curtain', 3.4, 5.0, Q).floor([1.2, 5.6]);
  // two beds
  u.bed(5.1, 1.6, Q).bed(5.1, -1.6, Q, false).put('screen_curtain', 4.6, 0, Q).put('medical_light', 2.6, 1.9, 0.8).top('painted_wooden_cabinet', 2.4, -2.78, 0, 1.2).put('computer_cart', 0.3, 2.6, Q).floor([2.0, 0.2]);
  // whoever watched them
  u.top('metal_office_desk', 2.2, -5.2, 0, 0.81, 2).put('SchoolChair_01', 2.2, -4.35, PI).put('med_cabinet', 1.2, -3.58, PI).put('hospital_pc', 2.7, -5.3, 0, 0.8).floor([0.6, -5.8], [5.4, -4.4]);
  u.put('surgical_trolley', -0.9, 2.6, 0.4).put('extinguisher_box', -2.64, -4.0, Q, 1.05).floor([-1.6, 5.0], [-1.6, -4.6]);

  const above: WallDef[] = [
    // (the door onto the stairs outside)
    { side: 'back', ext: 'hosp_ext', int: 'int_painted', openings: [win(-5.3, -3.9, 1.8, 2.8), win(-2.3, -0.9, 0.9, 2.3), door(3.85, 4.95)] },
    { side: 'left', ext: 'hosp_ext', int: 'int_painted', openings: [side(1.6), side(4.8)] },
    { side: 'right', ext: 'hosp_ext', int: 'ward_wall', openings: [side(-4.8), side(-1.6, { boards: true }), side(1.6), side(4.8)] },
    inner([PW_, z0], [PW_, z1], [gap(0.4, 2.6, 2.3), door(4.6, 5.6)], 'int_painted', 'int_painted'),
    inner([PE, z0], [PE, z1], [door(-5.6, -4.6), win(-2.6, -0.4, 1.05, 2.0), door(0.5, 1.5), win(3.6, 5.0, 1.05, 2.0), door(5.4, 6.4)], 'ward_wall', 'int_painted'),
    inner([x0, 3.5], [PW_ - 0.1, 3.5], [], 'int_painted', 'tile_wall'),
    inner([PE + 0.1, 3.2], [x1, 3.2], [], 'ward_wall', 'ward_wall'),
    inner([PE + 0.1, -3.2], [x1, -3.2], [], 'office_wall', 'ward_wall'),
  ];

  // ---------------------------------------------------------------- its roof: a terrace under the main block's top windows
  const r = new Floor();
  r.top('WoodenTable_01', 1.6, 2.6, 0.2, 0.57, 2).put('painted_wooden_chair_01', 0.9, 3.4, 2.8).put('painted_wooden_chair_01', 2.5, 1.8, 0.4).put('concrete_road_barrier', 5.75, -1.2, Q).put('concrete_road_barrier', 5.75, 0.6, Q).put('wooden_military_crate', 4.6, -0.4, 0.2);
  r.floor([4.8, 0.9], [0.4, -4.2], [-1.6, 5.2], [3.4, 5.6]);
  const roof: Deck = {
    parapet: 1.1, h: 2.5,
    walls: [
      { side: 'inner', from: [x0, well.land + 0.2], to: [PW_ + 0.1, well.land + 0.2], ext: 'hosp_ext', int: 'int_painted', openings: [door(-5.1, -4.1)] },
      { side: 'inner', from: [PW_, well.land + 0.1], to: [PW_, z0], ext: 'hosp_ext', int: 'int_painted', openings: [] },
    ],
    roofs: [{ x0: -WX, x1: PW_ + 0.1, z0: -WZ, z1: well.land + 0.3 }],
    boxes: [
      { key: 'hosp_ext', x0: -WX, x1: x0, y0: 1.17, y1: 2.5, z0: -WZ, z1: well.land + 0.3 },
      { key: 'hosp_ext', x0, x1: PW_ + 0.1, y0: 1.17, y1: 2.5, z0: -WZ, z1: z0 },
      ...[[-0.4, -5.2], [3.0, -2.6]].flatMap(([x, z]) => [
        { key: 'concrete' as const, x0: x - 0.5, x1: x + 0.5, y0: 0, y1: 0.9, z0: z - 0.4, z1: z + 0.4 },
        { key: 'roof_iron' as const, x0: x - 0.65, x1: x + 0.65, y0: 0.9, y1: 0.97, z0: z - 0.55, z1: z + 0.55, soft: true },
      ]),
    ],
    furniture: r.furniture,
    loot: r.loot,
    open: [{ side: 'back', a: 3.55, b: 5.25 }],
    usage: ['Medic', 'Military'],
  };

  return {
    w: WX * 2, d: WZ * 2, h: 3.2, ext: 'hosp_ext', int: 'int_painted', floor: 'floor_lino', roof: 'concrete', roofType: 'flat',
    walls: below, furniture: g.furniture, loot: g.loot,
    levels: [{ h: 3.0, int: 'ward_wall', floor: 'floor_lino', walls: above, furniture: u.furniture, loot: u.loot }],
    wells: [well], deck: roof, joined: ['front'],
    escapes: [{ side: 'back', at: 4.4, dir: -1, floors: 1, roof: true }],
    fittings: [
      { level: 0, list: [lamp(3.2, -1.6, 4.6), lamp(3.2, -1.6, -0.4), lamp(3.2, -1.6, -5.0), lamp(3.2, 3.0, 5.0), lamp(3.2, 3.0, 0), lamp(3.2, 3.0, -5.0)] },
      { level: 1, list: [lamp(3.0, -1.6, 4.6), lamp(3.0, -1.6, -0.4), lamp(3.0, -1.6, -5.0), lamp(3.0, 3.0, 5.0), lamp(3.0, 3.0, 0), lamp(3.0, 3.0, -5.0)] },
    ],
    dress: {
      plinth: { h: 0.85, key: 'plinth' }, bands: 'trim_white', trim: 'trim_white',
      piers: { back: [-6.18, 6.18], left: [-6.78, -3.2, 3.2], right: [-6.78, -3.3, 0, 3.2], w: 0.44, key: 'trim_white' },
      dado: { ward_wall: 'ward_dado', office_wall: 'office_dado', tile_wall: 'tile_dado', int_painted: 'office_dado' },
    },
    usage: ['Medic'],
  };
}

/**
 * The way into the hospital: a low block built out from the middle of its front, glass on three sides, with the
 * doors in it and the main block's own doors behind them. Its roof is a balcony at the height of the first floor,
 * with a door onto it from the long ward and one from the first of the single rooms: over the doors, over the
 * ground before them, and looking up the drive.
 *
 * In its own measure: x as the main block's, z its own (-1.8, the main block's front wall, to 1.8).
 */
export function hospitalLobbyPlan(): Blueprint {
  const LW = 6.4, LD = 1.8;
  const g = new Floor();
  g.top('hospital_bench', -4.8, 1.29, PI, 0.46).top('hospital_bench', 4.8, 1.29, PI, 0.46).put('water_cooler', 5.95, -1.2, -Q).put('extinguisher_box', -6.04, 1.1, Q, 1.05).floor([-2.6, -0.4], [3.2, 0.2], [0.2, 0.8]);
  const r = new Floor();
  r.put('concrete_road_barrier', -2.6, 1.15, 0).put('concrete_road_barrier', -0.9, 1.15, 0).put('painted_wooden_chair_01', -1.8, 0.2, 0.3).put('cardboard_box_01', 3.6, 0.9, 0.5).floor([-1.8, -0.6], [2.4, 0.4], [5.2, -0.4]);
  return {
    w: LW * 2, d: LD * 2, h: 3.2, ext: 'hosp_ext', int: 'ward_wall', floor: 'floor_lino', roof: 'concrete', roofType: 'flat',
    walls: [
      { side: 'front', ext: 'hosp_ext', int: 'ward_wall', openings: [win(-5.5, -4.1, 0.9, 2.3), { ...win(-3.4, -2.0, 0.9, 2.3), boards: true }, door(-1.3, -0.05, 2.3), door(0.05, 1.3, 2.3), win(2.0, 3.4, 0.9, 2.3), win(4.1, 5.5, 0.9, 2.3)] },
      { side: 'left', ext: 'hosp_ext', int: 'ward_wall', openings: [door(-0.75, 0.35, 2.1)] },
      { side: 'right', ext: 'hosp_ext', int: 'ward_wall', openings: [win(-0.9, 0.5, 0.9, 2.3)] },
    ],
    furniture: g.furniture, loot: g.loot,
    levels: [], joined: ['back'],
    deck: { parapet: 1.0, h: 2.5, walls: [], roofs: [], boxes: [], furniture: r.furniture, loot: r.loot, usage: ['Medic', 'Military'] },
    fittings: [{
      level: 0,
      list: [
        lamp(3.2, -3.2, 0), lamp(3.2, 3.2, 0),
        // a slab over the doors, and paving before them
        { key: 'concrete', x0: -2.3, x1: 2.3, y0: 2.52, y1: 2.64, z0: LD + 0.002, z1: LD + 1.2 },
        { key: 'trim_white', x0: -2.36, x1: 2.36, y0: 2.64, y1: 2.71, z0: LD + 0.004, z1: LD + 1.26, soft: true },
        { key: 'plinth', x0: -3.2, x1: 3.2, y0: -0.7, y1: -0.066, z0: LD + 0.06, z1: LD + 1.3, soft: true },
      ],
    }],
    dress: {
      plinth: { h: 0.85, key: 'plinth' }, bands: 'trim_white', trim: 'trim_white',
      piers: { front: [-6.18, -1.72, 1.72, 6.18], w: 0.44, key: 'trim_white' },
      dado: { ward_wall: 'ward_dado' },
    },
    usage: ['Medic'],
  };
}

// ------------------------------------------------------------------------------------------------ the police headquarters

const grille = (a: number, b: number, bottom = 0.2, top = 2.2): Opening => ({ a, b, bottom, top, kind: 'grille' });

/**
 * The police headquarters, at the foot of the street south of the village's road: three blocks round a yard the
 * street runs into (2026-10-12: "the police station needs to be bigger, and also i dont like the rigid box style
 * ... 2 flights of stairs at least on both sides and emergency exits ... think about dynamic gameplay and FPS
 * angles"). This is the main block, across the back of the yard: two floors and a roof, a stair at each end of it
 * that goes to the roof, a door at each end of its passage and one at the back, and stairs of steel outside each
 * end, from the roof down. West of the yard the cells, with the men's quarters over them (`policeCellsPlan`): its
 * roof is one with this block's. East of it the garage (`policeGaragePlan`), whose roof is a terrace that the
 * chief's room opens onto, with stairs of its own down the outside.
 *
 * Nine bays along it, 3.2 m apart; the walls between rooms on the lines between two. Ochre plaster, the trim white.
 */
export function policeHqPlan(): Blueprint {
  const PW = 15, PD = 6.5;
  const x0 = -PW + 0.2, x1 = PW - 0.2, z0 = -PD + 0.2, z1 = PD - 0.2;
  // the passage's two walls (their middles), and the faces of them the rooms see
  const pf = 0.7, pb = -1.2, rf = 0.8, rb = -1.3;
  const wellW = { x0, x1: -11.3, land: -2.7, far: z0 }, wellE = { x0: 11.3, x1, land: -2.7, far: z0 };
  const at = (k: number) => -12.8 + 3.2 * k;
  const wins = (ks: number[], o: { boards?: number[]; bars?: number[] } = {}): Opening[] =>
    ks.map((k) => ({ ...win(at(k) - 0.65, at(k) + 0.65, 0.9, 2.2), ...(o.boards?.includes(k) ? { boards: true } : {}), ...(o.bars?.includes(k) ? { bars: true } : {}) }));
  /** a slit, high up and barred: the evidence store's, the armoury's */
  const slit = (k: number): Opening => ({ ...win(at(k) - 0.35, at(k) + 0.35, 1.85, 2.3), bars: true });
  /** the window of a stair, half a floor up */
  const stairWin = (k: number): Opening => win(at(k) - 0.7, at(k) + 0.7, 2.1, 2.8);
  /** in an end wall: the door at the end of the passage, and a front room's window */
  const endDoor = (): Opening => door(-0.8, 0.3, 2.1), endWin = (o: Partial<Opening> = {}): Opening => ({ ...win(2.95, 4.25, 0.9, 2.2), ...o });

  // ---------------------------------------------------------------- below
  const g = new Floor();
  // the hall: the desk, and where people waited
  g.top('hospital_desk', 0.9, 2.3, PI, 0.78, 2).put('hospital_pc', 1.5, 2.2, PI, 0.76).put('SchoolChair_01', 0.9, 1.5, 0);
  g.top('hospital_bench', -4.39, 4.2, Q, 0.46).top('hospital_bench', -3.2, 5.99, PI, 0.46).put('hospital_bench', 3.2, 5.99, PI).put('extinguisher_box', -4.54, 1.6, Q, 1.05).put('water_cooler', 4.5, 5.6, -Q);
  g.floor([-1.4, 4.6], [2.6, 3.6]);
  // the charge room
  g.top('metal_office_desk', -8.1, 3.3, PI, 0.81, 2).put('SchoolChair_01', -8.1, 2.45, 0).put('painted_wooden_chair_01', -8.0, 4.4, PI).top('metal_office_desk', -12.9, 4.7, Q, 0.81).put('SchoolChair_01', -12.05, 4.7, -Q).top('hospital_bench', -14.46, 2.4, Q, 0.46);
  g.shelves(-5.17, 2.3, -Q).top('painted_wooden_cabinet', -12.8, 5.97, PI, 1.2).case('Shelf_01', -6.9, 6.15, PI, [0.66, 1.22]).floor([-10.6, 2.0], [-6.2, 4.4]);
  // the duty room: a counter under the hatch
  g.top('lab_counter', 5.23, 3.4, Q, 0.9).top('metal_office_desk', 8.4, 2.7, PI, 0.81, 2).put('SchoolChair_01', 8.4, 1.85, 0).top('metal_office_desk', 13.0, 4.6, -Q, 0.81, 2).put('SchoolChair_01', 12.15, 4.6, Q);
  g.case('wooden_bookshelf_worn', 14.48, 1.9, -Q, [0.67, 1.28]).top('painted_wooden_cabinet', 6.8, 5.97, PI, 1.2).put('Television_01', 6.4, 5.95, PI + 0.2, 1.18).put('weapons_case', 10.95, 5.75, 0.1).floor([6.6, 4.4], [10.6, 2.2]);
  // where they were asked questions: a table, a chair one side of it and two the other
  g.top('painted_wooden_table', -8.0, -4.1, 0, 0.98).put('painted_wooden_chair_01', -8.0, -5.1, 0).put('painted_wooden_chair_01', -8.6, -3.1, PI).put('painted_wooden_chair_01', -7.4, -3.1, PI).case('Shelf_01', -10.95, -3.4, Q, [0.66, 1.22]).floor([-5.8, -2.4], [-10.2, -5.6]);
  // the evidence store: shelves down both walls
  g.shelves(-4.43, -2.5, Q).shelves(-4.43, -3.7, Q, [0, 1, 2, 3]).shelves(-4.43, -4.9, Q).shelves(-1.97, -3.9, -Q, [1, 2]).shelves(-1.97, -5.1, -Q);
  g.put('weapons_case', -3.2, -5.98, 0).put('cardboard_box_01', -2.4, -2.3, 0.4).floor([-3.2, -3.6]);
  // the way through to the back door
  g.put('extinguisher_box', -1.34, -4.2, Q, 1.05).floor([0, -4.4]);
  // the lockers
  g.put('med_cabinet', 1.98, -2.2, Q).put('med_cabinet', 1.98, -3.5, Q).put('med_cabinet', 1.98, -4.8, Q).put('med_cabinet', 7.62, -2.2, -Q).put('med_cabinet', 7.62, -5.3, -Q);
  g.top('hospital_bench', 4.8, -3.7, Q, 0.46).case('Shelf_01', 4.8, -6.15, 0, [0.38, 0.94, 1.51]).put('cardboard_box_01', 6.6, -5.6, 1.2).floor([3.4, -3.0], [6.2, -4.0]);
  // where they ate
  g.top('electric_stove', 8.5, -5.95, 0, 0.88).top('painted_wooden_cabinet', 10.4, -5.97, 0, 1.2).top('WoodenTable_01', 8.46, -3.4, Q, 0.57, 2).put('painted_wooden_chair_01', 9.3, -3.0, -Q).put('painted_wooden_chair_01', 9.3, -3.9, -Q - 0.2).floor([10.2, -4.4]);
  // the passage
  g.top('hospital_bench', -5.3, 0.28, PI, 0.46).top('hospital_bench', 4.6, 0.28, PI, 0.46).put('extinguisher_box', 6.6, -0.94, 0, 1.05).floor([-10.4, -0.2], [-6.4, -0.3], [7.0, -0.3], [12.6, -0.2]);

  const below: WallDef[] = [
    { side: 'front', ext: 'ochre_ext', int: 'int_painted', covered: [[-PW, -4.8], [4.8, PW]], openings: [jdoor(-10.15, -9.05), ...wins([3], { bars: [3] }), door(-1.1, -0.04, 2.25), door(0.04, 1.1, 2.25), ...wins([5], { bars: [5] }), jdoor(9.05, 10.15)] },
    { side: 'back', ext: 'ochre_ext', int: 'int_painted', openings: [stairWin(0), ...wins([1, 2], { bars: [1, 2] }), slit(3), door(-0.55, 0.55), ...wins([5, 6, 7], { bars: [5, 6], boards: [7] }), stairWin(8)] },
    { side: 'left', ext: 'ochre_ext', int: 'int_painted', openings: [endDoor(), endWin({ bars: true })] },
    { side: 'right', ext: 'ochre_ext', int: 'int_painted', openings: [endDoor(), endWin({ bars: true })] },
    // the passage: its front wall, and its back wall
    inner([x0, pf], [x1, pf], [door(-8.6, -7.6), door(-2.9, -1.9), door(7.6, 8.6)], 'office_wall'),
    inner([x0, pb], [x1, pb], [gap(-14.6, -11.5, 2.3), door(-8.5, -7.5), door(-3.7, -2.7), gap(-1.0, 1.0, 2.3), door(4.3, 5.3), door(9.2, 10.2), gap(11.5, 14.6, 2.3)], 'int_painted', 'int_painted'),
    // the two sides of the hall: a hatch in the one the duty room is behind
    inner([-4.8, rf], [-4.8, z1], [], 'int_painted', 'office_wall'),
    inner([4.8, rf], [4.8, z1], [win(2.4, 4.4, 1.05, 2.0)], 'office_wall', 'int_painted'),
    // across the back
    inner([-11.2, z0], [-11.2, rb], [], 'int_painted', 'office_wall'),
    inner([-4.8, z0], [-4.8, rb], [], 'office_wall', 'int_plaster'),
    inner([-1.6, z0], [-1.6, rb], [], 'int_plaster', 'int_painted'),
    inner([1.6, z0], [1.6, rb], [], 'int_painted', 'office_wall'),
    inner([8.0, z0], [8.0, rb], [], 'office_wall', 'office_wall'),
    inner([11.2, z0], [11.2, rb], [], 'office_wall', 'int_painted'),
  ];

  // ---------------------------------------------------------------- above
  const u = new Floor();
  // the detectives: six desks in two rows
  for (const x of [-12.8, -6.4, -3.4]) u.top('metal_office_desk', x, 4.6, PI, 0.81, x === -6.4 ? 2 : 1).put('SchoolChair_01', x, 3.75, 0);
  for (const x of [-11.0, -7.6, -4.2]) u.top('metal_office_desk', x, 2.0, 0, 0.81, x === -7.6 ? 2 : 1).put('SchoolChair_01', x, 2.85, PI);
  u.put('hospital_pc', -6.0, 4.6, PI, 0.8).case('wooden_bookshelf_worn', -14.48, 2.0, Q, [0.67, 1.28]).case('Shelf_01', -1.85, 4.6, -Q, [0.66, 1.22]).floor([-9.4, 3.4], [-2.4, 3.2]);
  // where they were told what to do: a long table
  u.top('painted_wooden_table', 1.6, 3.6, 0, 0.98, 2).put('painted_wooden_chair_01', 0.9, 2.6, 0).put('painted_wooden_chair_01', 2.3, 2.6, 0.1).put('painted_wooden_chair_01', 0.9, 4.6, PI).put('painted_wooden_chair_01', 2.4, 4.6, PI - 0.2).case('Shelf_01', -1.35, 2.4, Q, [0.66, 1.22]).floor([3.8, 1.6]);
  // the chief: his door onto the garage's roof
  u.top('metal_office_desk', 9.6, 3.3, 0, 0.81, 2).put('SchoolChair_01', 9.6, 4.2, PI).put('painted_wooden_chair_01', 9.1, 2.1, 0.2).put('painted_wooden_chair_01', 10.3, 2.0, -0.3);
  u.case('wooden_bookshelf_worn', 14.48, 1.9, -Q, [0.67, 1.28]).case('wooden_bookshelf_worn', 14.48, 5.3, -Q, [0.39, 0.96]).top('painted_wooden_cabinet', 11.2, 5.97, PI, 1.2).put('weapons_case', 5.6, 5.7, Q).put('water_cooler', 5.2, 1.2, Q).floor([6.6, 4.8], [12.6, 3.6]);
  // the armoury: what the hatch was for. Racks down both walls, cases under the slits
  u.shelves(-10.83, -5.6, Q, [0, 1, 2, 3]).shelves(-10.83, -4.4, Q).shelves(-10.83, -3.2, Q, [0, 1, 2, 3]).shelves(-5.17, -5.6, -Q).shelves(-5.17, -4.4, -Q, [0, 1, 2, 3]);
  u.put('weapons_case', -9.2, -5.98, 0).put('weapons_case', -6.8, -5.98, 0.05).put('weapons_case', -7.8, -3.9, 0.3).top('lab_counter', -8.0, -1.72, 0, 0.9, 2).floor([-9.2, -4.8], [-7.2, -4.9], [-6.0, -2.6]);
  // the radio room
  u.put('bunker_terminal', -3.2, -5.62, 0).top('metal_office_desk', -2.2, -3.3, -Q, 0.81, 2).put('SchoolChair_01', -3.05, -3.3, Q).case('Shelf_01', -4.55, -3.0, Q, [0.66, 1.22]).floor([-3.6, -4.6]);
  // a store
  u.shelves(-1.23, -3.2, Q).shelves(-1.23, -4.4, Q, [0, 3]).shelves(1.23, -3.8, -Q, [1, 2]).put('cardboard_box_01', 0.9, -5.6, 0.6).floor([0, -5.0]);
  // where they ate
  u.top('electric_stove', 2.1, -5.95, 0, 0.88).top('painted_wooden_cabinet', 3.9, -5.97, 0, 1.2).top('WoodenTable_01', 2.06, -3.5, Q, 0.57, 2).put('painted_wooden_chair_01', 2.9, -3.1, -Q).put('painted_wooden_chair_01', 2.9, -4.0, -Q - 0.2).floor([3.8, -4.6]);
  // the files: cases down the west wall, shelves between the windows, and two rows down the middle
  u.case('wooden_bookshelf_worn', 5.22, -3.0, Q, [0.67, 1.28]).case('wooden_bookshelf_worn', 5.22, -4.5, Q, [0.39]).shelves(8.0, -6.02, 0, [0, 2]).shelves(10.83, -2.4, -Q, [1, 3]).shelves(10.83, -5.5, -Q);
  for (const x of [7.2, 8.3]) u.case('Shelf_01', x, -3.5, 0, x === 7.2 ? [0.94] : []).case('Shelf_01', x, -3.9, PI, x === 8.3 ? [0.66, 1.22] : []);
  u.put('cardboard_box_01', 9.9, -4.2, 0.5).put('cardboard_box_01', 6.4, -5.7, 1.3).floor([9.4, -2.5], [6.6, -5.0]);
  u.put('extinguisher_box', -5.6, 0.44, PI, 1.05).top('hospital_bench', 4.4, 0.28, PI, 0.46).floor([-11.0, -0.2], [-2.0, -0.3], [9.6, -0.3]);

  const above: WallDef[] = [
    // (west of the yard the men's quarters stand against it; east of it, over the garage's roof, the chief's door and windows)
    { side: 'front', ext: 'ochre_ext', int: 'office_wall', covered: [[-PW, -4.8]], openings: [jdoor(-10.15, -9.05), ...wins([3, 4, 5, 6]), door(9.05, 10.15), ...wins([8], { boards: [8] })] },
    { side: 'back', ext: 'ochre_ext', int: 'int_painted', openings: [stairWin(0), slit(1), slit(2), ...wins([3, 4, 5, 6, 7], { boards: [6] }), stairWin(8)] },
    // (the doors onto the stairs outside)
    { side: 'left', ext: 'ochre_ext', int: 'office_wall', openings: [endDoor(), endWin()] },
    { side: 'right', ext: 'ochre_ext', int: 'office_wall', openings: [endDoor(), endWin({ boards: true })] },
    inner([x0, pf], [x1, pf], [door(-9.8, -8.8), door(0.6, 1.6), door(7.2, 8.2)], 'office_wall'),
    inner([x0, pb], [x1, pb], [gap(-14.6, -11.5, 2.3), door(-10.6, -9.7), grille(-9.2, -6.8, 1.0, 2.0), door(-4.2, -3.2), door(-0.5, 0.5), door(3.2, 4.2), door(7.8, 8.8), gap(11.5, 14.6, 2.3)], 'int_painted', 'int_painted'),
    inner([-1.6, rf], [-1.6, z1], [], 'office_wall', 'office_wall'),
    inner([4.8, rf], [4.8, z1], [], 'office_wall', 'office_wall'),
    inner([-11.2, z0], [-11.2, rb], [], 'int_painted', 'int_plaster'),
    inner([-4.8, z0], [-4.8, rb], [], 'int_plaster', 'int_painted'),
    inner([-1.6, z0], [-1.6, rb], [], 'int_painted', 'int_plaster'),
    inner([1.6, z0], [1.6, rb], [], 'int_plaster', 'office_wall'),
    inner([4.8, z0], [4.8, rb], [], 'office_wall', 'office_wall'),
    inner([11.2, z0], [11.2, rb], [], 'office_wall', 'int_painted'),
  ];

  // ---------------------------------------------------------------- the roof
  const r = new Floor();
  r.put('concrete_road_barrier', -1.6, 5.75, 0).put('concrete_road_barrier', 0.1, 5.75, 0).put('wooden_military_crate', 1.9, 5.2, 0.3).put('painted_wooden_chair_01', -0.6, 4.6, 2.9).floor([-0.8, 5.0], [1.2, 4.2], [8.0, 2.0], [-8.0, -3.0], [6.0, -4.0]);
  const head = (sx: 1 | -1): { walls: WallDef[]; roof: Deck['roofs'][number]; boxes: Deck['boxes'] } => {
    const a = sx < 0 ? x0 : 11.1, b = sx < 0 ? -11.1 : x1, mid = sx * 11.2, edge = sx * PW;
    return {
      walls: [
        { side: 'inner', from: [a, pb], to: [b, pb], ext: 'ochre_ext', int: 'int_painted', openings: [door(sx * 12.4, sx * 13.4)] },
        { side: 'inner', from: [mid, sx < 0 ? rb : z0], to: [mid, sx < 0 ? z0 : rb], ext: 'ochre_ext', int: 'int_painted', openings: [] },
      ],
      roof: { x0: Math.min(edge, mid - sx * 0.1), x1: Math.max(edge, mid - sx * 0.1), z0: -PD, z1: -1.1 },
      boxes: [
        { key: 'ochre_ext', x0: Math.min(edge, sx * (PW - 0.2)), x1: Math.max(edge, sx * (PW - 0.2)), y0: 1.17, y1: 2.5, z0: -PD, z1: -1.1 },
        { key: 'ochre_ext', x0: Math.min(sx * (PW - 0.2), mid - sx * 0.1), x1: Math.max(sx * (PW - 0.2), mid - sx * 0.1), y0: 1.17, y1: 2.5, z0: -PD, z1: z0 },
      ],
    };
  };
  const hw = head(-1), he = head(1);
  const roof: Deck = {
    parapet: 1.1, h: 2.5,
    walls: [...hw.walls, ...he.walls],
    roofs: [hw.roof, he.roof],
    boxes: [
      ...hw.boxes, ...he.boxes,
      // the mast, on a block, and its two arms
      { key: 'concrete', x0: 6.6, x1: 7.4, y0: 0, y1: 0.25, z0: -4.9, z1: -4.1 },
      { key: 'steel', x0: 6.95, x1: 7.05, y0: 0.25, y1: 8.5, z0: -4.55, z1: -4.45 },
      { key: 'steel', x0: 6.3, x1: 7.7, y0: 6.6, y1: 6.64, z0: -4.52, z1: -4.48, soft: true },
      { key: 'steel', x0: 6.5, x1: 7.5, y0: 7.6, y1: 7.64, z0: -4.52, z1: -4.48, soft: true },
      // the coolers, and two shafts
      { key: 'concrete', x0: 8.4, x1: 11.0, y0: 0, y1: 0.12, z0: 2.4, z1: 3.6 },
      { key: 'steel', x0: 8.6, x1: 9.6, y0: 0.12, y1: 0.95, z0: 2.6, z1: 3.4 },
      { key: 'steel', x0: 9.9, x1: 10.9, y0: 0.12, y1: 0.95, z0: 2.6, z1: 3.4 },
      ...[[-5.0, -4.6], [2.6, -4.2], [-8.6, 1.6]].flatMap(([x, z]) => [
        { key: 'concrete' as const, x0: x - 0.5, x1: x + 0.5, y0: 0, y1: 0.9, z0: z - 0.4, z1: z + 0.4 },
        { key: 'roof_iron' as const, x0: x - 0.65, x1: x + 0.65, y0: 0.9, y1: 0.97, z0: z - 0.55, z1: z + 0.55, soft: true },
      ]),
      // over the doors the wall round the roof stands a little higher, and the pole of a flag on it
      { key: 'ochre_ext', x0: -1.7, x1: 1.7, y0: 1.17, y1: 1.72, z0: PD - 0.2, z1: PD },
      { key: 'concrete', x0: -1.76, x1: 1.76, y0: 1.72, y1: 1.79, z0: PD - 0.26, z1: PD + 0.06, soft: true },
      { key: 'steel', x0: -0.03, x1: 0.03, y0: 1.79, y1: 4.9, z0: PD - 0.13, z1: PD - 0.07, soft: true },
    ],
    furniture: r.furniture,
    loot: r.loot,
    // (onto the roof of the men's quarters, which is this roof carried on; and onto the stairs outside each end)
    open: [{ side: 'front', a: -PW, b: -4.8 }, { side: 'left', a: -1.1, b: 0.6 }, { side: 'right', a: -1.1, b: 0.6 }],
    usage: ['Police', 'Military'],
  };

  // What stands against it outside: a slab over its doors (the board with its name stands on the slab's edge), a
  // light under it, paving before them; a slab over the door at the back.
  const outside: Fitting[] = [
    { key: 'plinth', x0: -2.6, x1: 2.6, y0: -0.7, y1: -0.066, z0: PD + 0.06, z1: PD + 2.0, soft: true },
    { key: 'concrete', x0: -2.3, x1: 2.3, y0: 2.6, y1: 2.74, z0: PD + 0.002, z1: PD + 1.6 },
    { key: 'trim_white', x0: -2.36, x1: 2.36, y0: 2.74, y1: 2.81, z0: PD + 0.004, z1: PD + 1.66, soft: true },
    { key: 'lamp', x0: -0.3, x1: 0.3, y0: 2.52, y1: 2.598, z0: PD + 0.6, z1: PD + 0.9, soft: true },
    { key: 'concrete', x0: -1.0, x1: 1.0, y0: 2.3, y1: 2.4, z0: -PD - 1.0, z1: -PD - 0.002 },
  ];
  const lit = (h: number, spots: [number, number][]): Fitting[] => spots.map(([x, z]) => lamp(h, x, z));

  return {
    w: PW * 2, d: PD * 2, h: 3.0, ext: 'ochre_ext', int: 'int_painted', floor: 'floor_lino', roof: 'concrete', roofType: 'flat',
    walls: below, furniture: g.furniture, loot: g.loot,
    levels: [{ h: 3.0, int: 'office_wall', floor: 'floor_wood', walls: above, furniture: u.furniture, loot: u.loot }],
    wells: [wellW, wellE], deck: roof,
    escapes: [{ side: 'left', at: -0.25, dir: -1, floors: 1, roof: true }, { side: 'right', at: -0.25, dir: -1, floors: 1, roof: true }],
    fittings: [
      { level: 0, list: [...outside, ...lit(3.0, [[-9.8, 3.6], [0, 3.6], [9.8, 3.6], [-12, -0.25], [-6, -0.25], [0, -0.25], [6, -0.25], [12, -0.25], [-8, -3.8], [-3.2, -3.8], [4.8, -3.8], [9.6, -3.8]])] },
      { level: 1, list: lit(3.0, [[-9.8, 3.6], [-4, 3.6], [1.6, 3.6], [9.8, 3.6], [-12, -0.25], [-6, -0.25], [0, -0.25], [6, -0.25], [12, -0.25], [-8, -3.8], [-3.2, -3.8], [3.2, -3.8], [8, -3.8]]) },
    ],
    // (on the edge of the slab over its doors)
    sign: { x: 0, y: 3.14, out: 1.54, text: 'ПОЛИЦИЯ', sub: 'POLICE' },
    dress: {
      plinth: { h: 0.7, key: 'plinth' }, bands: 'trim_white', trim: 'trim_white',
      piers: { front: [-1.6, 1.6], back: [-14.78, -11.2, -4.8, 4.8, 11.2, 14.78], left: [-6.28, 1.65], right: [-6.28, 1.65], w: 0.4, key: 'trim_white' },
      dado: { int_painted: 'office_dado', office_wall: 'office_dado', cell_wall: 'cell_dado' },
    },
    usage: ['Police'],
  };
}

/**
 * West of the headquarters' yard: the cells below, the men's quarters over them, and a roof that is the main
 * block's roof carried on. A passage down its middle from the main block's charge room to a door at its far end;
 * four cells behind bars on the outer side of it; on the yard's side the guard's room, with a door of its own
 * into the yard, the booking room, the visitors' room, a store.
 *
 * In its own measure: x across it (-5.1, its outer wall, to 5.1, the yard), z along it from the main block's
 * front wall (-6), which is the only wall there, to its far end (6). The main block's x is this less 9.9, its z
 * this plus 12.5.
 */
export function policeCellsPlan(): Blueprint {
  const CW = 5.1, CD = 6, x0 = -CW + 0.2, x1 = CW - 0.2, z0 = -CD, z1 = CD - 0.2;
  const slit = (z: number): Opening => ({ ...win(z - 0.35, z + 0.35, 1.85, 2.3), bars: true });
  const side = (z: number, o: Partial<Opening> = {}): Opening => ({ ...win(z - 0.65, z + 0.65, 0.9, 2.2), ...o });

  const g = new Floor();
  // the cells: a bed in each
  for (const [k, z] of [-4.5, -1.5, 1.5, 4.4].entries()) g.bed(-4.4, z, 0, k !== 1);
  g.put('painted_wooden_chair_01', -2.2, 1.9, 2.4).floor([-2.6, -4.6], [-2.4, -1.2], [-2.8, 4.8]);
  // the guard: a desk, the keys
  g.top('metal_office_desk', 3.2, -5.45, 0, 0.81, 2).put('SchoolChair_01', 3.2, -4.6, PI).case('Shelf_01', 2.4, -3.25, PI, [0.66, 1.22]).floor([2.2, -4.2]);
  // booking: a counter, and what was taken off them
  g.top('lab_counter', 3.2, -0.42, PI, 0.9, 2).shelves(3.3, -2.63, 0, [0, 1]).put('cardboard_box_01', 4.5, -2.5, 0.3).floor([3.2, -1.6]);
  // the visitors' room: a table between two chairs
  g.top('WoodenTable_01', 3.2, 1.5, 0, 0.57).put('painted_wooden_chair_01', 3.2, 0.7, 0).put('painted_wooden_chair_01', 3.2, 2.3, PI).floor([4.4, 0.6]);
  // a store
  g.shelves(3.2, 3.37, 0).put('cardboard_box_01', 4.4, 5.3, 0.8).put('cardboard_box_01', 2.0, 5.2, 0.2).floor([2.4, 4.0]);
  g.put('extinguisher_box', 1.04, 3.0, -Q, 1.05).floor([0, -3.0], [0.2, 2.0], [-0.2, 4.8]);

  const below: WallDef[] = [
    { side: 'front', ext: 'ochre_ext', int: 'int_painted', openings: [door(-0.55, 0.55), { ...win(2.5, 3.8, 0.9, 2.2), bars: true }] },
    { side: 'left', ext: 'ochre_ext', int: 'cell_wall', openings: [slit(-4.5), slit(-1.5), slit(1.5), slit(4.5)] },
    // (the yard's side: the guard's door, and bars on every window)
    { side: 'right', ext: 'ochre_ext', int: 'int_painted', openings: [door(-5.05, -3.95), side(-1.5, { bars: true }), side(1.5, { bars: true }), side(4.5, { boards: true })] },
    // the passage: bars and a door to each cell on the one side, a door to each room on the other
    inner([-1.3, z0], [-1.3, z1], [door(-5.7, -4.8), grille(-4.6, -3.3), door(-2.7, -1.8), grille(-1.6, -0.3), door(0.3, 1.2), grille(1.4, 2.7), door(3.3, 4.2), grille(4.4, 5.5)], 'cell_wall', 'int_painted'),
    inner([1.3, z0], [1.3, z1], [door(-5.3, -4.3), door(-2.0, -1.0), door(1.0, 2.0), door(4.0, 5.0)], 'int_painted', 'office_wall'),
    inner([x0, -3], [-1.4, -3], [], 'cell_wall', 'cell_wall'),
    inner([x0, 0], [-1.4, 0], [], 'cell_wall', 'cell_wall'),
    inner([x0, 3], [-1.4, 3], [], 'cell_wall', 'cell_wall'),
    inner([1.4, -3], [x1, -3], [], 'office_wall', 'office_wall'),
    inner([1.4, 0], [x1, 0], [], 'office_wall', 'office_wall'),
    inner([1.4, 3], [x1, 3], [], 'int_plaster', 'office_wall'),
  ];

  // ---------------------------------------------------------------- above: where the men slept
  const u = new Floor();
  for (const [k, z] of [-4.6, -1.6, 1.5, 4.4].entries()) u.bed(-4.4, z, 0, k % 2 === 0);
  u.put('med_cabinet', -1.68, -1.2, -Q).put('med_cabinet', -1.68, 4.7, -Q).put('painted_wooden_chair_01', -2.6, -5.0, 1.2).floor([-2.8, -3.6], [-2.8, 1.6]);
  // where they sat: a table, the set
  u.top('WoodenTable_01', 3.2, -3.4, 0, 0.57, 2).put('painted_wooden_chair_01', 2.6, -2.7, PI).put('painted_wooden_chair_01', 3.8, -4.1, 0).top('painted_wooden_cabinet', 3.2, -0.43, PI, 1.2).put('Television_01', 3.2, -0.45, PI, 1.18).floor([2.2, -1.8]);
  // where they washed
  u.put('med_sink', 4.54, 1.0, -Q).put('med_sink', 4.54, 2.2, -Q).put('mop_bucket', 2.0, 2.5, 0.4).floor([3.0, 1.4]);
  // a store
  u.shelves(3.2, 3.37, 0, [0, 1, 2, 3]).put('weapons_case', 3.3, 5.3, 0.1).floor([2.2, 4.4]);
  u.put('extinguisher_box', 1.04, -1.4, -Q, 1.05).floor([0, -4.0], [0.2, 3.0]);

  const above: WallDef[] = [
    { side: 'front', ext: 'ochre_ext', int: 'office_wall', openings: [win(-3.8, -2.5, 0.9, 2.2), win(-0.65, 0.65, 0.9, 2.2), { ...win(2.5, 3.8, 0.9, 2.2), boards: true }] },
    { side: 'left', ext: 'ochre_ext', int: 'office_wall', openings: [side(-4.5), side(-1.5, { boards: true }), side(1.5), side(4.5)] },
    { side: 'right', ext: 'ochre_ext', int: 'office_wall', openings: [side(-4.5), side(-1.5), side(1.5), side(4.5)] },
    inner([-1.3, z0], [-1.3, z1], [door(-3.6, -2.6), door(2.4, 3.4)], 'office_wall', 'int_painted'),
    inner([1.3, z0], [1.3, z1], [door(-4.0, -3.0), door(1.0, 2.0), door(4.0, 5.0)], 'int_painted', 'office_wall'),
    inner([x0, 0], [-1.4, 0], [], 'office_wall', 'office_wall'),
    inner([1.4, 0], [x1, 0], [], 'tile_wall', 'office_wall'),
    inner([1.4, 3], [x1, 3], [], 'int_plaster', 'tile_wall'),
  ];

  const r = new Floor();
  r.put('concrete_road_barrier', -1.2, 5.25, 0).put('concrete_road_barrier', 0.5, 5.25, 0).put('concrete_road_barrier', 4.35, 3.6, Q).put('painted_wooden_chair_01', 3.2, 4.6, 2.2).floor([0, 4.2], [3.4, 2.4], [-3.0, -2.0]);
  return {
    w: CW * 2, d: CD * 2, h: 3.0, ext: 'ochre_ext', int: 'int_painted', floor: 'floor_lino', roof: 'concrete', roofType: 'flat',
    walls: below, furniture: g.furniture, loot: g.loot,
    levels: [{ h: 3.0, int: 'office_wall', floor: 'floor_wood', walls: above, furniture: u.furniture, loot: u.loot }],
    joined: ['back'],
    deck: {
      parapet: 1.1, h: 2.5, walls: [], roofs: [],
      boxes: [
        { key: 'concrete', x0: -3.0, x1: -2.0, y0: 0, y1: 0.9, z0: 1.0, z1: 1.8 },
        { key: 'roof_iron', x0: -3.15, x1: -1.85, y0: 0.9, y1: 0.97, z0: 0.85, z1: 1.95, soft: true },
      ],
      furniture: r.furniture, loot: r.loot, usage: ['Police', 'Military'],
    },
    fittings: [
      { level: 0, list: [lamp(3.0, 0, -3.6), lamp(3.0, 0, 0.6), lamp(3.0, 0, 4.4), lamp(3.0, 3.2, -4.4), lamp(3.0, 3.2, 1.5)] },
      { level: 1, list: [lamp(3.0, 0, -3.6), lamp(3.0, 0, 3.0), lamp(3.0, -3.2, -3.0), lamp(3.0, -3.2, 3.0), lamp(3.0, 3.2, -3.0)] },
    ],
    dress: {
      plinth: { h: 0.7, key: 'plinth' }, bands: 'trim_white', trim: 'trim_white',
      piers: { front: [-4.88, -1.5, 1.5, 4.88], left: [-3, 0, 3, 5.78], right: [-3, 0, 3, 5.78], w: 0.4, key: 'trim_white' },
      dado: { int_painted: 'office_dado', office_wall: 'office_dado', cell_wall: 'cell_dado', tile_wall: 'tile_dado' },
    },
    usage: ['Police'],
  };
}

/**
 * East of the headquarters' yard: the garage. One floor, two ways in for a car in its far end, a door into the
 * yard and one through to the duty room. Its roof is a terrace at the height of the main block's upper floor, with
 * the chief's door onto it, a wall round it to shoot over, and stairs of steel down its outer side: a way up into
 * the building that passes neither of its stairs.
 *
 * In its own measure: x across it (-5.1, the yard, to 5.1, its outer wall), z along it from the main block's
 * front wall (-6) to its far end (6). The main block's x is this plus 9.9, its z this plus 12.5.
 */
export function policeGaragePlan(): Blueprint {
  const GW = 5.1, GD = 6;
  const g = new Floor();
  // a car that was never mended, and what it was to be mended with
  g.put('covered_car', -2.75, 1.7, 0.04).top('lab_counter', 4.59, 0.4, -Q, 0.9, 2).top('lab_counter', 4.59, -1.7, -Q, 0.9).shelves(4.63, -4.3, -Q, [0, 1, 2, 3]).shelves(4.63, 3.0, -Q, [0, 2]);
  g.put('barrel_03', -4.4, -5.2, 0).put('barrel_03', -3.65, -5.45, 1).put('crate_big', 2.9, -5.25, 0.2).put('old_tyre', 1.5, -5.4, 0.5, 0.08).put('old_tyre', 1.55, -5.35, 1.4, 0.24).put('old_tyre', 3.9, 4.9, 0.3, 0.08).put('utility_box_01', -4.62, -2.2, Q);
  g.floor([0.4, -3.4], [2.4, 1.0], [-0.4, 4.4], [3.2, -2.6]);
  const r = new Floor();
  r.put('concrete_road_barrier', -4.35, 3.4, Q).put('concrete_road_barrier', -4.35, 1.6, Q).put('concrete_road_barrier', -1.0, 5.25, 0).top('WoodenTable_01', 1.6, -3.2, 0.1, 0.57, 2).put('painted_wooden_chair_01', 1.0, -2.4, 2.9).put('painted_wooden_chair_01', 2.4, -4.0, 0.2).put('wooden_military_crate', -3.6, 4.6, 0.4);
  r.floor([-3.2, 2.4], [0.6, 4.2], [-1.0, -1.0], [3.4, 2.0]);
  return {
    w: GW * 2, d: GD * 2, h: 3.0, ext: 'ochre_ext', int: 'int_plaster', floor: 'concrete', roof: 'concrete', roofType: 'flat',
    walls: [
      { side: 'front', ext: 'ochre_ext', int: 'int_plaster', openings: [gap(-4.3, -1.3, 2.6), gap(0.9, 3.9, 2.6)] },
      { side: 'left', ext: 'ochre_ext', int: 'int_plaster', openings: [door(-4.7, -3.6), { ...win(-0.65, 0.65, 0.9, 2.2), bars: true }, { ...win(2.85, 4.15, 0.9, 2.2), boards: true }] },
      { side: 'right', ext: 'ochre_ext', int: 'int_plaster', openings: [{ ...win(3.85, 5.15, 0.9, 2.2), bars: true }] },
    ],
    furniture: g.furniture, loot: g.loot,
    levels: [], joined: ['back'],
    deck: {
      parapet: 1.1, h: 2.5, walls: [], roofs: [],
      boxes: [
        { key: 'concrete', x0: 2.4, x1: 3.4, y0: 0, y1: 0.9, z0: 3.6, z1: 4.4 },
        { key: 'roof_iron', x0: 2.25, x1: 3.55, y0: 0.9, y1: 0.97, z0: 3.45, z1: 4.55, soft: true },
      ],
      furniture: r.furniture, loot: r.loot,
      open: [{ side: 'right', a: -4.45, b: -2.75 }],
      usage: ['Police', 'Military'],
    },
    escapes: [{ side: 'right', at: -3.6, dir: 1, floors: 0, roof: true }],
    fittings: [{ level: 0, list: [lamp(3.0, -2.6, -2.0), lamp(3.0, -2.6, 3.0), lamp(3.0, 2.4, -2.0), lamp(3.0, 2.4, 3.0)] }],
    dress: {
      plinth: { h: 0.7, key: 'plinth' }, bands: 'trim_white', trim: 'trim_white',
      piers: { front: [-4.88, -0.2, 4.88], left: [-2.2, 1.75, 5.78], right: [2.6, 5.78], w: 0.4, key: 'trim_white' },
    },
    usage: ['Police'],
  };
}
