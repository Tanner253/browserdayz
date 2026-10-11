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

export function hospitalPlan(): Blueprint {
  // ---------------------------------------------------------------- the ground floor: emergency, reception, the dispensary, the morgue
  const g = new Floor();
  // the way in for the wounded, at the west end of the corridor: a bed on wheels left where it stopped
  g.bed(-21.0, 0.72, Q).put('surgical_trolley', -19.2, -0.86).put('extinguisher_box', -15.6, 1.16, PI, 1.05);
  g.top('hospital_bench', -14.4, -0.96, 0, 0.46).top('hospital_bench', 10.6, -0.96, 0, 0.46).put('extinguisher_box', 16.6, -1.16, 0, 1.05);
  g.floor([-8.0, 0.2], [3.4, -0.4], [18.6, 0.3]);
  // triage: three beds under the windows with screens between them
  g.bed(-21.7, 6.75, PI).bed(-19.2, 6.75, PI).bed(-16.7, 6.75, PI);
  g.put('ward_curtain', -20.45, 6.55, Q).put('ward_curtain', -17.95, 6.55, Q).put('medical_light', -15.6, 6.9, 2.4);
  g.top('surgical_trolley', -15.2, 5.2, 0.3, 0.9).top('hospital_bench', -20.8, 1.84, 0, 0.46).put('med_cabinet', -13.3, 2.7, -Q).put('computer_cart', -14.0, 7.2, PI);
  g.floor([-18.6, 3.6], [-21.9, 3.9], [-14.6, 3.2]);
  // the treatment room
  g.bed(-11.7, 6.75, PI).put('ventilator', -10.5, 7.25, PI).put('surgical_lamp', -11.7, 5.9, 0.4, 2.5);
  g.top('lab_counter', -6.55, 5.0, -Q, 0.9, 2).put('instrument_tray', -6.55, 4.2, -Q, 0.9).put('med_sink', -7.1, 1.86, 0).shelves(-8.25, 1.78, 0);
  g.floor([-9.6, 4.0], [-11.4, 3.0]);
  // the hall: the desk faces the door, benches round the walls
  g.top('hospital_desk', 0, 3.1, PI, 0.78, 2).put('hospital_pc', 0.7, 3.0, PI, 0.76).put('SchoolChair_01', 0.1, 2.25, 0);
  g.top('hospital_bench', -5.66, 5.3, Q, 0.46).top('hospital_bench', 5.66, 5.3, -Q, 0.46).top('hospital_bench', -4.2, 7.46, PI, 0.46).put('hospital_bench', 4.2, 7.46, PI);
  g.put('water_cooler', 5.6, 2.3, -Q).put('extinguisher_box', -5.84, 2.3, Q, 1.05);
  g.floor([-2.6, 5.6], [2.8, 6.0], [-3.8, 2.6]);
  // the dispensary: a counter behind the hatch, shelves round the walls and down the middle
  g.top('lab_counter', 8.7, 2.05, 0, 0.9, 3);
  g.shelves(6.52, 3.9, Q).shelves(6.52, 5.1, Q, [0, 1, 2, 3]).shelves(6.52, 6.3, Q).shelves(12.68, 3.9, -Q).shelves(12.68, 5.1, -Q, [0, 1, 2, 3]).shelves(12.68, 6.3, -Q);
  g.shelves(9.6, 5.4, Q, [1, 2]).shelves(9.6, 6.6, Q, [0, 2]).put('med_cabinet', 11.2, 7.5, PI);
  g.floor([8.2, 3.6], [11.2, 4.6]);
  // the x-ray room: the table under the arm, the pictures on the wall
  g.top('steel_table', 18.0, 4.9, Q, 0.8).put('ceiling_arm', 18.0, 5.6, PI, 0.65).put('xray_viewer', 13.33, 4.6, Q, 1.2);
  g.top('metal_office_desk', 21.3, 2.5, PI, 0.81, 2).put('SchoolChair_01', 21.3, 1.75, 0).put('computer_cart', 15.0, 7.25, PI).top('lab_counter', 17.4, 7.46, PI, 0.9, 2).put('screen_curtain', 21.9, 6.5, 0);
  g.floor([15.6, 3.0], [20.0, 6.4]);
  // (back) the ambulance crews' room
  g.top('WoodenTable_01', -16.2, -4.6, 0, 0.57, 2).put('painted_wooden_chair_01', -16.6, -3.9, PI).put('painted_wooden_chair_01', -15.6, -5.3, 0.1).put('painted_wooden_chair_01', -17.4, -4.7, Q);
  g.top('electric_stove', -18.95, -7.45, 0, 0.88).top('painted_wooden_cabinet', -17.9, -7.47, 0, 1.2).case('Shelf_01', -13.15, -5.6, -Q, [0.66, 0.94, 1.22]).bed(-19.1, -3.4, 0);
  g.floor([-14.6, -2.6], [-17.8, -6.2]);
  // the laundry
  g.put('mop_bucket', -12.3, -2.3, 0.6).shelves(-11.7, -7.5, 0, [0, 3]).shelves(-10.5, -7.5, 0, [0, 3]).put('folded_blanket', -11.7, -7.5, 0, 0.66).put('folded_blanket', -11.4, -7.5, 0.2, 1.17).put('folded_blanket', -10.5, -7.5, 0, 0.66).put('folded_blanket', -10.7, -7.5, 0.1, 1.17);
  g.put('cardboard_box_01', -8.7, -6.9, 0.3).put('wooden_crate_01', -8.9, -3.0, Q).floor([-10.2, -4.2]);
  // the morgue: the cold chambers down the west wall, two tables, and the scales
  g.put('body_lockers', -6.48, -4.65, Q).put('autopsy_table', -2.2, -5.0, Q).put('autopsy_table', 1.2, -5.0, Q).put('covered_body', 1.2, -5.0, Q, 0.9).put('surgical_lamp', -2.2, -5.0, 0, 2.5);
  g.top('lab_counter', 2.6, -7.46, 0, 0.9).put('autopsy_scales', 3.25, -7.46, 0, 0.89).put('instrument_tray', 2.0, -7.46, 0.2, 0.9).put('med_sink', 3.62, -3.0, -Q).top('surgical_trolley', -3.6, -2.9, 0.2, 0.9).put('med_cabinet', -3.6, -7.5, 0);
  g.floor([-0.6, -2.6], [2.4, -2.8]);
  // the boiler room, and the door for the coal
  g.put('bunker_machine', 9.05, -4.7, Q).put('bunker_pipes', 4.36, -4.6, Q).put('utility_box_01', 4.9, -7.5, 0).put('utility_box_01', 4.75, -2.2, Q).put('wooden_crate_01', 5.4, -5.9, 0.4);
  g.floor([6.6, -3.2], [7.4, -6.0], [5.6, -4.2]);
  // records, and whoever watched the door
  g.top('metal_office_desk', 12.7, -4.2, 0, 0.81, 2).put('SchoolChair_01', 12.7, -3.35, PI).top('metal_office_desk', 16.6, -6.5, PI, 0.81, 2).put('SchoolChair_01', 16.6, -7.3, 0);
  g.case('wooden_bookshelf_worn', 19.28, -3.0, -Q, [0.67, 1.28]).case('wooden_bookshelf_worn', 19.28, -4.5, -Q, [0.39, 1.28]).case('wooden_bookshelf_worn', 19.28, -6.0, -Q, [0.67, 0.96]);
  g.case('Shelf_01', 10.36, -4.0, Q, [0.66, 1.22]).case('Shelf_01', 10.36, -5.2, Q, [0.38, 0.94]).top('painted_wooden_cabinet', 14.7, -7.47, 0, 1.2).put('Television_01', 14.2, -7.45, 0.2, 1.18);
  g.floor([14.8, -3.0], [18.0, -4.4]);

  const ground: WallDef[] = [
    {
      side: 'front', ext: 'plaster_ext', int: 'ward_wall',
      openings: [win(-21.6, -20.2), win(-18.2, -16.8), win(-15.2, -13.8), win(-11.6, -10.2), win(-8.8, -7.4), win(-5.4, -3.2, 0.5, 2.5), door(-1.3, -0.12, 2.3), door(0.12, 1.3, 2.3), win(3.2, 5.4, 0.5, 2.5), win(7.6, 9.0, 1.5, 2.2), win(10.4, 11.8, 1.5, 2.2), win(15.0, 16.4, 1.5, 2.2), win(19.0, 20.4, 1.5, 2.2)],
    },
    { side: 'back', ext: 'plaster_ext', int: 'int_painted', openings: [win(-18.2, -16.8), win(-15.4, -14.0), win(-11.2, -9.8, 1.5, 2.1), win(-2.6, -1.4, 2.0, 2.6), win(1.2, 2.4, 2.0, 2.6), door(6.4, 7.5), win(8.5, 9.4, 1.5, 2.1), win(12.0, 13.4), win(16.2, 17.6)] },
    { side: 'left', ext: 'plaster_ext', int: 'int_painted', openings: [door(-0.55, 0.55, 2.2), win(3.6, 5.0)] },
    { side: 'right', ext: 'plaster_ext', int: 'int_painted', openings: [door(-0.55, 0.55, 2.2), win(3.6, 5.0, 1.5, 2.2)] },
    // the corridor's front wall, in two (the hall between them is open to it), and its back wall
    inner([X0, CF], [-6.2, CF], [door(-18.0, -17.0), door(-10.2, -9.2)], 'ward_wall'),
    inner([6.2, CF], [X1, CF], [win(7.6, 9.8, 1.05, 2.0), door(11.4, 12.4), door(14.2, 15.2)], 'tile_wall'),
    inner([X0, CB], [X1, CB], [gap(-22.3, -20.7, 2.3), door(-17.2, -16.2), door(-11.0, -10.0), door(-2.5, -1.45), door(-1.35, -0.3), door(6.6, 7.6), door(13.6, 14.6), gap(20.7, 22.3, 2.3)]),
    // across the front
    inner([-12.9, RF], [-12.9, Z1], [door(4.0, 5.0)], 'ward_wall', 'ward_wall'),
    inner([-6.1, 1.3], [-6.1, Z1], [], 'ward_wall'),
    inner([6.1, 1.3], [6.1, Z1], [], 'int_painted', 'tile_wall'),
    inner([13.1, RF], [13.1, Z1], [], 'tile_wall', 'tile_wall'),
    // across the back
    inner([WW, Z0], [WW, RB]),
    inner([-12.9, Z0], [-12.9, RB]),
    inner([-8.1, Z0], [-8.1, RB], [], 'int_painted', 'tile_wall'),
    inner([4.1, Z0], [4.1, RB], [], 'tile_wall', 'int_plaster'),
    inner([10.1, Z0], [10.1, RB], [], 'int_plaster', 'office_wall'),
    inner([WE, Z0], [WE, RB], [], 'office_wall'),
  ];

  // ---------------------------------------------------------------- the first floor: one long ward to the west, single rooms to the east
  const w = new Floor();
  // sixteen beds down the two long walls, a screen at every second
  for (const [k, x] of [-21.6, -19.1, -16.6, -14.1, -11.6, -9.1, -6.6, -4.1, -1.6].entries()) {
    w.bed(x, 6.75, PI, k % 3 !== 1);
    if (k % 2 === 1) w.put('ward_curtain', x - 1.25, 6.55, Q);
  }
  for (const [k, x] of [-18.4, -15.9, -13.4, -10.9, -8.4, -5.9, -3.4].entries()) {
    w.bed(x, -6.75, 0, k % 3 !== 2);
    if (k % 2 === 0) w.put('screen_curtain', x + 1.25, -6.6, 0);
  }
  w.put('folded_blanket', -19.1, 7.0, 0.2, 0.6).put('folded_blanket', -11.6, 6.9, -0.3, 0.6).put('folded_blanket', -8.4, -6.9, 0.4, 0.6).put('medical_light', -17.85, 5.6, 0.6).put('medical_light', -7.2, -5.7, 2.2).put('ventilator', -12.85, 7.2, PI);
  // the sisters' desk, looking down the ward, and what they wheeled about
  w.top('hospital_desk', -3.0, 0, Q, 0.78, 2).put('hospital_pc', -2.9, 0.7, Q, 0.76).put('SchoolChair_01', -2.2, -0.1, -Q);
  w.top('surgical_trolley', -9.6, 0.6, 0.4, 0.9).top('surgical_trolley', -16.2, -0.5, -0.2, 0.9).put('computer_cart', -20.6, 0.4, Q).put('med_sink', -19.24, -4.0, Q).put('med_cabinet', -19.3, -6.2, Q).put('med_cabinet', -22.52, 2.6, Q);
  w.floor([-12.0, 1.8], [-6.0, -2.4], [-20.2, 3.4], [-14.4, -3.0]);
  // (east) three single rooms and the room at the end, kept apart
  w.bed(1.2, 6.75, PI).top('painted_wooden_cabinet', 2.5, 7.47, PI, 1.2).put('painted_wooden_chair_01', 3.4, 5.4, 2.6).put('medical_light', 0.6, 5.2, 1.0).floor([4.6, 3.4]);
  w.bed(7.7, 6.75, PI).top('painted_wooden_cabinet', 9.0, 7.47, PI, 1.2).put('screen_curtain', 10.4, 5.2, 0).put('painted_wooden_chair_01', 8.8, 4.6, -2.2).floor([11.4, 3.2]);
  w.bed(14.3, 6.75, PI).top('painted_wooden_cabinet', 15.6, 7.47, PI, 1.2).put('ventilator', 13.55, 5.4, Q).put('computer_cart', 17.8, 7.2, PI).floor([17.4, 3.6]);
  w.bed(21.2, 6.75, PI).put('med_sink', 22.42, 3.0, -Q).put('ward_curtain', 21.2, 4.9, 0).floor([20.6, 2.6]);
  // (back) the sisters' office, the linen, the dressing room
  w.top('metal_office_desk', 2.2, -5.4, PI, 0.81, 2).put('SchoolChair_01', 2.2, -6.25, 0).case('wooden_bookshelf_worn', 0.32, -3.6, Q, [0.67, 1.28]).shelves(4.6, -7.5, 0).shelves(5.7, -7.5, 0, [1, 2]).top('painted_wooden_cabinet', 1.0, -7.47, 0, 1.2).floor([4.4, -3.2]);
  w.shelves(6.82, -3.0, Q, [0, 3]).shelves(6.82, -4.2, Q, [1]).shelves(6.82, -5.4, Q, [0, 2]).shelves(10.58, -4.0, -Q, [0, 3]).shelves(10.58, -5.2, -Q, [2]);
  w.put('folded_blanket', 6.82, -3.0, Q, 0.66).put('folded_blanket', 6.82, -3.1, Q, 1.17).put('folded_blanket', 6.82, -4.2, Q, 1.17).put('folded_blanket', 10.58, -4.0, -Q, 0.66).put('folded_blanket', 10.58, -5.2, -Q, 0.66).put('mop_bucket', 10.3, -7.2, 2.2).floor([8.6, -6.4]);
  w.top('steel_table', 15.0, -4.6, Q, 0.8).put('surgical_lamp', 15.0, -4.6, 0.3, 2.3).top('surgical_trolley', 13.2, -3.4, 0, 0.9).put('instrument_tray', 13.2, -3.4, 0.5, 0.9).put('med_cabinet', 12.0, -7.5, 0).put('med_cabinet', 18.7, -7.5, 0).put('med_sink', 11.42, -3.0, Q);
  w.top('lab_counter', 19.18, -4.2, -Q, 0.9, 2).floor([16.8, -2.8], [13.6, -6.4]);
  // the passage between them
  w.top('hospital_bench', 5.9, -0.96, 0, 0.46).bed(17.4, 0.72, Q).put('extinguisher_box', 12.0, 1.16, PI, 1.05).floor([9.8, 0.2], [20.6, -0.4]);

  const ward: WallDef[] = [
    { side: 'front', ext: 'plaster_ext', int: 'ward_wall', openings: [...[-20.6, -17.0, -13.4, -9.8, -6.2, -2.6].map((c) => win(c - 0.7, c + 0.7)), win(2.4, 3.8), win(9.0, 10.4), win(15.6, 17.0), win(20.6, 22.0)] },
    { side: 'back', ext: 'plaster_ext', int: 'ward_wall', openings: [win(-22.0, -20.6, 2.1, 2.9), ...[-17.2, -13.4, -9.6, -5.8, -2.2].map((c) => win(c - 0.7, c + 0.7)), win(2.4, 3.8), win(8.2, 9.2, 1.5, 2.1), win(13.0, 14.4), win(16.2, 17.6), win(20.6, 22.0, 2.1, 2.9)] },
    { side: 'left', ext: 'plaster_ext', int: 'ward_wall', openings: [win(-0.7, 0.7), win(3.6, 5.0)] },
    { side: 'right', ext: 'plaster_ext', int: 'int_painted', openings: [win(-0.6, 0.6), win(3.6, 5.0)] },
    // the wall across the building that parts the ward from the rooms: two doors side by side in the passage
    inner([-0.1, Z0], [-0.1, Z1], [door(-1.15, -0.08), door(0.08, 1.15)], 'ward_wall', 'int_painted'),
    // round the west stair
    inner([X0, CB], [-19.6, CB], [gap(-22.3, -20.7, 2.3)], 'ward_wall'),
    inner([WW, Z0], [WW, RB], [], 'ward_wall'),
    // the passage east of that wall
    inner([0, CF], [X1, CF], [door(2.6, 3.6), door(9.2, 10.2), door(15.8, 16.8), door(20.6, 21.6)], 'ward_wall'),
    inner([0, CB], [X1, CB], [door(2.6, 3.6), door(8.2, 9.2), door(14.6, 15.6), gap(20.7, 22.3, 2.3)], 'int_painted', 'office_wall'),
    inner([6.4, RF], [6.4, Z1], [], 'ward_wall', 'ward_wall'),
    inner([13.0, RF], [13.0, Z1], [], 'ward_wall', 'ward_wall'),
    inner([19.6, RF], [19.6, Z1], [], 'tile_wall', 'ward_wall'),
    inner([6.4, Z0], [6.4, RB], [], 'office_wall', 'int_plaster'),
    inner([11.0, Z0], [11.0, RB], [], 'int_plaster', 'tile_wall'),
    inner([WE, Z0], [WE, RB], [], 'tile_wall'),
  ];

  // ---------------------------------------------------------------- the second floor: two theatres, the laboratory, and the offices
  const s = new Floor();
  // the big theatre
  s.put('autopsy_table', -18.0, 4.8, 0).put('surgical_lamp', -18.0, 4.8, 0.2, 2.3).put('ventilator', -19.7, 4.2, Q).top('surgical_trolley', -16.4, 5.7, 0.2, 0.9).put('instrument_tray', -16.4, 5.7, 0.4, 0.9).top('surgical_trolley', -17.2, 3.3, -0.3, 0.9);
  s.put('medical_light', -19.6, 6.4, 0.8).put('xray_viewer', -18.1, 7.67, PI, 1.2).put('med_cabinet', -13.46, 2.7, -Q).put('computer_cart', -21.9, 2.4, Q).put('ceiling_arm', -15.4, 6.3, 0.6, 0.45).floor([-20.6, 3.0], [-15.0, 2.6]);
  // the scrub room between them
  s.put('med_sink', -12.0, 7.44, PI).put('med_sink', -10.5, 7.44, PI).put('med_sink', -9.0, 7.44, PI).shelves(-8.75, 1.78, 0, [0, 1]).put('folded_blanket', -8.75, 1.78, 0, 1.17).put('folded_blanket', -8.6, 1.8, 0.3, 1.67).put('mop_bucket', -12.4, 2.2, 1.0).floor([-10.6, 4.6]);
  // the small theatre: whoever was on the table is on it still
  s.put('steel_table', -3.0, 4.9, Q).put('covered_body', -3.0, 4.9, 0, 0.8).put('surgical_lamp', -3.0, 4.9, -0.2, 2.3).put('ventilator', -5.0, 4.4, Q).top('surgical_trolley', -1.6, 3.6, 0.1, 0.9).put('instrument_tray', -1.6, 3.6, 0.2, 0.9);
  s.put('medical_light', -4.6, 6.6, 0.7).put('screen_curtain', 1.2, 6.2, 0).put('med_cabinet', -6.6, 7.5, PI).top('lab_counter', 0.6, 7.46, PI, 0.9, 2).floor([-5.6, 2.8], [0.4, 2.6]);
  // recovery: four beds, each watched
  for (const [k, x] of [3.3, 5.8, 8.3, 10.8].entries()) {
    s.bed(x, 6.75, PI);
    if (k < 3) s.put('ward_curtain', x + 1.25, 6.55, Q);
  }
  s.put('ventilator', 4.5, 7.25, PI).put('computer_cart', 9.55, 7.2, PI).put('med_cabinet', 12.56, 3.0, -Q).top('hospital_bench', 4.4, 1.84, 0, 0.46).top('surgical_trolley', 9.0, 3.4, 0.5, 0.9).floor([6.8, 4.2], [11.4, 4.6]);
  // the director's room
  s.top('metal_office_desk', 18.4, 4.6, 0, 0.81, 2).put('SchoolChair_01', 18.4, 5.5, PI).put('painted_wooden_chair_01', 17.9, 3.4, 0.2).put('painted_wooden_chair_01', 19.1, 3.3, -0.3);
  s.case('wooden_bookshelf_worn', 13.42, 3.0, Q, [0.67, 1.28]).case('wooden_bookshelf_worn', 13.42, 4.5, Q, [0.39, 0.96, 1.66]).case('wooden_bookshelf_worn', 13.42, 6.0, Q, [0.67, 1.28]);
  s.top('painted_wooden_table', 20.7, 2.9, 0, 0.98, 2).top('painted_wooden_cabinet', 21.9, 7.47, PI, 1.2).put('Television_01', 21.9, 7.45, PI - 0.2, 1.18).put('weapons_case', 14.6, 7.35, 0.1).put('water_cooler', 22.5, 5.8, -Q).floor([16.0, 6.6], [21.4, 5.2]);
  // (back) the laboratory
  s.put('lab_table', -17.0, -4.8, 0).top('steel_table', -13.4, -4.8, 0, 0.8, 2).top('lab_counter', -18.4, -7.46, 0, 0.9, 2).top('lab_counter', -12.0, -7.46, 0, 0.9, 2).put('med_sink', -19.24, -2.6, Q);
  s.shelves(-10.42, -3.2, -Q).shelves(-10.42, -4.4, -Q, [0, 1, 2, 3]).shelves(-10.42, -5.6, -Q).put('computer_cart', -15.2, -7.2, 0).put('medical_light', -19.0, -6.4, 1.2).floor([-15.2, -2.6], [-11.6, -6.4]);
  // the blood store
  s.shelves(-9.58, -3.2, Q).shelves(-9.58, -4.4, Q, [1, 2]).shelves(-9.58, -5.6, Q).shelves(-5.42, -3.6, -Q, [0, 1, 2, 3]).shelves(-5.42, -4.8, -Q).put('med_cabinet', -7.5, -7.5, 0).floor([-7.4, -4.2]);
  // the archive: cases round the walls and two rows down the middle
  for (const z of [-3.0, -4.5, -6.0]) s.case('wooden_bookshelf_worn', -4.58, z, Q, z === -4.5 ? [0.67] : [0.39, 1.28]).case('wooden_bookshelf_worn', 3.78, z, -Q, z === -4.5 ? [0.96] : []);
  for (const x of [-2.2, -1.1, 0.0, 1.1]) s.case('Shelf_01', x, -4.45, 0, x === 0 ? [0.94] : []).case('Shelf_01', x, -4.85, PI, x === -1.1 ? [0.66, 1.22] : []);
  s.top('metal_office_desk', 2.0, -2.45, PI, 0.81).put('cardboard_box_01', -2.8, -7.2, 0.3).put('cardboard_box_01', 1.6, -7.3, 1.1).put('cardboard_box_01', -0.4, -6.9, 0.7).floor([-3.0, -2.6], [2.4, -6.6]);
  // where the staff sat down
  s.top('painted_wooden_table', 8.0, -4.4, 0, 0.98, 2).put('painted_wooden_chair_01', 7.2, -3.5, PI).put('painted_wooden_chair_01', 8.8, -3.5, PI + 0.2).put('painted_wooden_chair_01', 7.4, -5.3, 0).put('painted_wooden_chair_01', 8.9, -5.3, -0.2);
  s.top('electric_stove', 4.9, -7.45, 0, 0.88).top('painted_wooden_cabinet', 5.9, -7.47, 0, 1.2).put('water_cooler', 11.62, -2.3, -Q).top('hospital_bench', 9.8, -7.46, 0, 0.46).floor([5.4, -3.0], [10.6, -5.6]);
  // the clerks
  s.top('metal_office_desk', 14.4, -4.0, 0, 0.81, 2).put('hospital_pc', 14.9, -4.1, 0, 0.8).put('SchoolChair_01', 14.4, -3.1, PI).top('metal_office_desk', 17.4, -6.3, PI, 0.81, 2).put('SchoolChair_01', 17.4, -7.15, 0);
  s.case('Shelf_01', 12.26, -4.2, Q, [0.66, 1.22]).case('Shelf_01', 12.26, -5.4, Q, [0.94]).case('wooden_bookshelf_worn', 19.28, -3.4, -Q, [0.67, 1.28]).floor([15.8, -2.6], [13.2, -6.8]);
  // the passage
  s.top('hospital_bench', -13.4, -0.96, 0, 0.46).top('hospital_bench', 11.2, 1.0, PI, 0.46).bed(-6.0, -0.72, Q).put('surgical_trolley', 3.6, 0.9, 0.3).put('extinguisher_box', -20.0, 1.16, PI, 1.05).put('extinguisher_box', 18.4, -1.16, 0, 1.05).floor([-17.6, 0.3], [7.0, -0.3], [19.6, 0.2]);

  const surgery: WallDef[] = [
    { side: 'front', ext: 'plaster_ext', int: 'tile_wall', openings: [win(-20.8, -19.4, 1.4, 2.3), win(-16.8, -15.4, 1.4, 2.3), win(-11.2, -9.8, 1.4, 2.3), win(-5.6, -4.2, 1.4, 2.3), win(-1.4, 0.0, 1.4, 2.3), win(4.2, 5.6), win(7.2, 8.6), win(10.2, 11.6), win(14.8, 16.2), win(17.4, 18.8), win(20.0, 21.4)] },
    { side: 'back', ext: 'plaster_ext', int: 'int_painted', openings: [win(-22.0, -20.6, 2.1, 2.9), win(-17.6, -16.2), win(-13.6, -12.2), win(-8.0, -7.0, 1.6, 2.1), win(-2.6, -1.2, 1.5, 2.1), win(1.2, 2.6, 1.5, 2.1), win(6.0, 7.4), win(9.0, 10.4), win(14.0, 15.4), win(17.0, 18.4), win(20.6, 22.0, 2.1, 2.9)] },
    { side: 'left', ext: 'plaster_ext', int: 'tile_wall', openings: [win(-0.6, 0.6), win(3.6, 5.0, 1.4, 2.3)] },
    { side: 'right', ext: 'plaster_ext', int: 'office_wall', openings: [win(-0.6, 0.6), win(3.6, 5.0)] },
    inner([X0, CF], [X1, CF], [door(-18.4, -17.35), door(-17.25, -16.2), door(-11.0, -10.0), door(-4.1, -3.05), door(-2.95, -1.9), door(6.6, 7.6), door(15.4, 16.4)], 'tile_wall'),
    inner([X0, CB], [X1, CB], [gap(-22.3, -20.7, 2.3), door(-15.6, -14.6), door(-8.0, -7.0), door(-0.9, 0.1), door(7.6, 8.6), door(15.2, 16.2), gap(20.7, 22.3, 2.3)]),
    inner([-13.0, RF], [-13.0, Z1], [door(4.2, 5.2)], 'tile_wall', 'tile_wall'),
    inner([-8.0, RF], [-8.0, Z1], [door(4.2, 5.2)], 'tile_wall', 'tile_wall'),
    inner([2.0, RF], [2.0, Z1], [], 'ward_wall', 'tile_wall'),
    inner([13.0, RF], [13.0, Z1], [], 'office_wall', 'ward_wall'),
    inner([WW, Z0], [WW, RB], [], 'tile_wall'),
    inner([-10.0, Z0], [-10.0, RB], [], 'tile_wall', 'tile_wall'),
    inner([-5.0, Z0], [-5.0, RB], [], 'office_wall', 'tile_wall'),
    inner([4.2, Z0], [4.2, RB], [], 'office_wall', 'office_wall'),
    inner([12.0, Z0], [12.0, RB], [], 'office_wall', 'office_wall'),
    inner([WE, Z0], [WE, RB], [], 'int_painted', 'office_wall'),
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
      { side: 'inner', from: [X0, CB], to: [-19.6, CB], ext: 'plaster_ext', int: 'int_painted', openings: [door(-21.9, -20.9)] },
      { side: 'inner', from: [WW, RB], to: [WW, Z0], ext: 'plaster_ext', int: 'int_painted', openings: [] },
      // and the east one
      { side: 'inner', from: [19.6, CB], to: [X1, CB], ext: 'plaster_ext', int: 'int_painted', openings: [door(20.9, 21.9)] },
      { side: 'inner', from: [WE, Z0], to: [WE, RB], ext: 'plaster_ext', int: 'int_painted', openings: [] },
    ],
    roofs: [{ x0: -HW, x1: -19.6, z0: -HD, z1: -1.3 }, { x0: 19.6, x1: HW, z0: -HD, z1: -1.3 }],
    boxes: [
      // the outside walls of those two rooms, on the wall round the roof
      { key: 'plaster_ext', x0: -HW, x1: X0, y0: 1.17, y1: 2.5, z0: -HD, z1: -1.3 },
      { key: 'plaster_ext', x0: X0, x1: -19.6, y0: 1.17, y1: 2.5, z0: -HD, z1: Z0 },
      { key: 'plaster_ext', x0: X1, x1: HW, y0: 1.17, y1: 2.5, z0: -HD, z1: -1.3 },
      { key: 'plaster_ext', x0: 19.6, x1: X1, y0: 1.17, y1: 2.5, z0: -HD, z1: Z0 },
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
    ],
    furniture: r.furniture,
    loot: r.loot,
    usage: ['Military'],
    // the rifle lies by the road blocks; its glass, its can and its cheek rest are on the table; a box of its rounds by the crate
    keeps: [{ id: 'mosin', x: -3.9, z: 6.4 }, { id: 'pu_scope', x: -2.8, z: 5.4 }, { id: 'suppressor_762', x: -2.2, z: 5.4 }, { id: 'rifle_wrap', x: -1.6, z: 5.4 }, { id: 'box_762', x: -4.6, z: 4.7 }],
  };

  // pillars down the long ward, where the walls of the floor below stand
  const pillars: Fitting[] = [[-14.6, 1.4], [-7.3, 1.4], [-14.6, -1.4], [-7.3, -1.4]].map(([x, z]) => ({ key: 'ward_wall', x0: x - 0.2, x1: x + 0.2, y0: 0, y1: 3.0, z0: z - 0.2, z1: z + 0.2 }));

  const levels: Level[] = [
    { h: 3.0, int: 'ward_wall', floor: 'floor_lino', walls: ward, furniture: w.furniture, loot: w.loot },
    { h: 3.0, int: 'tile_wall', floor: 'floor_lino', walls: surgery, furniture: s.furniture, loot: s.loot, usage: ['Medic', 'Town'] },
  ];
  return {
    w: HW * 2, d: HD * 2, h: 3.2, ext: 'plaster_ext', int: 'int_painted', floor: 'floor_lino', roof: 'concrete', roofType: 'flat',
    walls: ground, furniture: g.furniture, loot: g.loot,
    levels, wells: [WELL_W, WELL_E], deck: roof,
    fittings: [{ level: 1, list: pillars }],
    sign: { x: 0, y: 2.72, text: 'БОЛЬНИЦА', sub: 'HOSPITAL', board: '#e4e0d4', ink: '#8c1f1f' },
    usage: ['Medic'],
  };
}
