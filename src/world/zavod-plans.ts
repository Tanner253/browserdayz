// Zavod, the brick works by the river (2026-10-16): its buildings. The owner: "the towns should feel fresh with
// different types of environemnts building sand generally feel". Each is a blueprint of the game's own (rooms,
// stairs, doors, what stops a body) whose outer walls come from a line of letters a floor (src/world/facade.ts),
// the same letters that lay the downloaded facade kit's panels over its outside. Where they stand: src/sim/zavod.ts.

import type { Blueprint, Deck, Level } from './buildings';
import { Floor, PI, Q, door, inner } from './big-buildings';
import { STOREY_H, facadeSize, facadeWalls, type FacadeSpec } from './facade';

// ------------------------------------------------------------------------------------------------ the works hall

/**
 * The hall: 36 m of red brick, two storeys, its flat roof walked on behind a parapet. Two garages on the yard (one
 * open, one shut), one on the quay; a door at each end under the steel stairs that are the only way onto the roof.
 * Below, the machine floor, open end to end; above, the drawing office and the stores behind a wall.
 */
export const HALL: FacadeSpec = {
  kit: 'factory_kit', bays: [12, 5], floors: 2, parapet: 1.0,
  sides: {
    front: ['tG-ttDttC-tt', 'wtwtwxxwtwtw'],
    back: ['ww.wwDwwG-ww', 'w.w.w.w.w.w.'],
    left: ['w.D.w', 'w.D.w'],
    right: ['wtDtw', 'w.D.w'],
  },
  gaps: { left: [2], right: [2] },
};

export function hallPlan(): Blueprint {
  const [W, D] = facadeSize(HALL), HD = D / 2;
  const g = new Floor();
  // the machine floor: three machines down the middle, benches and racks along the back, what was being loaded by the garages
  for (const x of [-9, -1, 7]) g.put('bunker_machine', x, -0.4, 0).floor([x, 1.4]);
  // (the counter against the blank bay of the back wall, the racks back to the west wall either side of its door: the
  // counter stood across the back door; the racks 0.9 m out from the wall, one in the door's swing)
  g.top('steel_table', -13.5, -5.6, Q, 0.8, 2).top('steel_table', -4.5, -5.6, Q, 0.8, 2).top('lab_counter', 10.5, -6.98, 0, 0.9, 2);
  g.put('rack_wide', -17.48, -3.0, Q).put('rack_wide', -17.48, 3.0, Q);
  g.put('crate_big', -12.6, 5.6, 0.2).put('crate_big', -11.4, 5.9, 0.1).put('wooden_crate_01', -13.4, 4.4, 0.6).put('Barrel_01', 9.6, 5.8).put('barrel_03', 10.4, 6.3).put('Barrel_01', 11.1, 5.6);
  g.put('old_tyre', 12.0, -6.6, 0.3).put('metal_jerrycan_green', 11.75, -7.1, 1.2).put('utility_box_01', 17.55, 1.3, -Q);
  g.floor([-14.6, 3.8], [-6.2, 4.4], [2.6, 5.6], [10.6, 3.2], [-15.6, -6.4], [0.4, -3.2], [12.6, -4.6]);
  // above: the drawing office to the west, the stores to the east behind a wall with a door
  const u = new Floor();
  for (const x of [-15, -11, -7, -3]) u.top('metal_office_desk', x, 4.6, PI, 0.79).put('SchoolChair_01', x, 3.6, 0.2);
  u.put('steel_locker', -17.3, -4.0, Q).put('steel_locker', -17.3, -2.9, Q).top('WoodenTable_01', -8, -4.4, 0, 0.57, 2);
  // (the stores' shelves back to the wall, on its blank bays and not before its windows)
  u.shelves(1.6, -7.03, 0).shelves(6.6, -7.03, 0).shelves(8.4, -7.03, 0).put('wooden_military_crate', 4.2, 4.8, 0.3).put('cardboard_box_01', 6.4, 5.4, 1.1).put('cardboard_box_01', 6.8, 5.0, 0.4);
  u.floor([-12.6, 0.4], [-4.0, 1.6], [5.4, 1.0], [9.8, 4.6], [1.6, 3.0]);
  const well = { x0: 13.4, x1: 16.6, land: -2.2, far: -6.6, upTo: 1 };
  const levels: Level[] = [{
    h: STOREY_H, int: 'int_plaster', floor: 'floor_concrete',
    walls: [...facadeWalls(HALL, 1, 'brick_red', 'int_plaster'), inner([0.2, -HD + 0.2], [0.2, HD - 0.2], [door(-1.0, 0)], 'int_plaster', 'int_plaster')],
    furniture: u.furniture, loot: u.loot,
  }];
  // the roof: nothing over it but the vents, and whoever climbed the stairs outside
  const r = new Floor();
  r.put('wooden_military_crate', -10.2, -5.8, 0.4).put('concrete_road_barrier', 4.0, HD - 0.8, 0).floor([-10.2, -4.8], [8.0, 2.0]);
  const deck: Deck = {
    parapet: HALL.parapet, h: 2.5, walls: [], roofs: [],
    boxes: [[-12, -1], [-2, -1], [8, -1]].flatMap(([x, z]) => [
      { key: 'steel' as const, x0: x - 0.7, x1: x + 0.7, y0: 0, y1: 1.1, z0: z - 0.7, z1: z + 0.7 },
      { key: 'roof_iron' as const, x0: x - 0.85, x1: x + 0.85, y0: 1.1, y1: 1.16, z0: z - 0.85, z1: z + 0.85, soft: true },
    ]),
    furniture: r.furniture, loot: r.loot,
    open: [{ side: 'left', a: -0.85, b: 0.85 }, { side: 'right', a: -0.85, b: 0.85 }],
    usage: ['Industrial'],
  };
  return {
    w: W, d: D, h: STOREY_H, ext: 'brick_red', int: 'int_plaster', floor: 'floor_garage', roof: 'concrete', roofType: 'flat',
    walls: facadeWalls(HALL, 0, 'brick_red', 'int_plaster'), furniture: g.furniture, loot: g.loot,
    levels, wells: [well], deck,
    escapes: [{ side: 'left', at: 0, dir: 1, floors: 1, roof: true }, { side: 'right', at: 0, dir: -1, floors: 1, roof: true }],
    usage: ['Industrial'],
  };
}

// ------------------------------------------------------------------------------------------------ the works office

/** The office: two storeys by the gate, the guard's room and the canteen below, the director's rooms above. */
export const OFFICE: FacadeSpec = {
  kit: 'factory_kit', bays: [6, 4], floors: 2, parapet: 1.0,
  sides: {
    front: ['mwRDwm', 'dmddmd'],
    back: ['s.ss.s', 'sd..ds'],
    left: ['m..m', 'mmmm'],
    right: ['wR.w', 'mmmm'],
  },
};

export function officePlan(): Blueprint {
  const [W, D] = facadeSize(OFFICE), HD = D / 2;
  const g = new Floor();
  // the guard's room by the door, the canteen behind
  g.top('metal_office_desk', -6.6, 4.6, PI, 0.79).put('SchoolChair_01', -6.6, 3.6, 0.3).put('steel_locker', -8.4, 1.2, Q).put('Television_01', -7.9, 5.4, PI);
  for (const x of [2.4, 6.0]) g.top('WoodenTable_01', x, -2.6, 0, 0.57, 2).put('painted_wooden_chair_01', x - 0.6, -1.8, 2.9).put('painted_wooden_chair_01', x + 0.6, -3.4, 0.2);
  // (the stove and the counter on the canteen's blank walls, out of its windows)
  g.put('electric_stove', 8.47, -1.6, -Q).top('lab_counter', 4.5, -5.48, 0, 0.9, 1);
  g.floor([-6.0, 2.0], [-1.2, 2.6], [4.2, 0.6], [-5.0, -3.8]);
  g.put('painted_wooden_cabinet', -4.2, -5.47, 0).put('Shelf_01', -5.6, -5.67, 0).put('painted_wooden_bench', -8.55, -1.5, Q);
  const u = new Floor();
  // (the bookcase and the lockers between the windows: every bay of these walls has one)
  u.top('metal_office_desk', 5.2, -3.8, 0, 0.79, 2).put('painted_wooden_chair_01', 5.2, -2.8, PI).case('wooden_bookshelf_worn', 8.5, 3.0, -Q, [0.4, 1.0, 1.55]);
  u.top('metal_office_desk', -6.0, 4.6, PI, 0.79).top('metal_office_desk', -3.2, 4.6, PI, 0.79).put('steel_locker', -8.52, -3.0, Q).put('steel_locker', -8.52, 0, Q);
  u.floor([6.4, 0.2], [-4.6, 1.8], [-6.4, -2.6], [2.0, 4.2]);
  u.put('SchoolChair_01', -6.0, 3.7, 0.15).put('SchoolChair_01', -3.2, 3.7, -0.2).put('GreenChair_01', 4.6, -4.95, 0.2).put('GreenChair_01', 5.9, -4.95, -0.2);
  const well = { x0: -2.4, x1: 0.8, land: -0.8, far: -5.3 };
  const levels: Level[] = [{
    h: STOREY_H, int: 'int_painted', floor: 'floor_lino',
    walls: [...facadeWalls(OFFICE, 1, 'brick_red', 'int_painted'), inner([1.0, -HD + 0.2], [1.0, HD - 0.2], [door(1.6, 2.6)], 'int_painted', 'office_wall')],
    furniture: u.furniture, loot: u.loot, usage: ['Town'],
  }];
  return {
    w: W, d: D, h: STOREY_H, ext: 'brick_red', int: 'int_painted', floor: 'floor_lino', roof: 'concrete', roofType: 'flat',
    walls: [...facadeWalls(OFFICE, 0, 'brick_red', 'int_painted'), inner([-4.6, 0.6], [-4.6, HD - 0.2], [door(1.4, 2.4)], 'int_painted', 'int_painted'), inner([-8.8, 0.6], [-4.6, 0.6], [], 'int_painted', 'int_painted')],
    furniture: g.furniture, loot: g.loot,
    levels, wells: [well],
    deck: { parapet: OFFICE.parapet, h: 2.5, walls: [], roofs: [], boxes: [], furniture: [], loot: [] },
    usage: ['Industrial'],
  };
}

// ------------------------------------------------------------------------------------------------ the flats

/**
 * The flats: four storeys of plaster over the road, a flat each side of the stair on every floor. The stair goes
 * no higher than the top floor: the roof, the highest place in Zavod, is reached only by the fire escape up the
 * back, in the open.
 */
export const FLATS: FacadeSpec = {
  kit: 'flats_kit', bays: [8, 3], floors: 4, parapet: 1.0,
  sides: {
    front: ['wswD.wsw', 'wwdwwdww', 'wwdwwdww', 'wxdwwdxw'],
    back: ['w.wSw.ww', 'wDsw.wsw', 'wDsw.wsw', 'wDsw.wsw'],
    left: ['w.w', 'wsw', 'wsw', 'wsw'],
    right: ['w.w', 'wsw', 'wsw', 'wsw'],
  },
  gaps: { back: [1] },
};

export function flatsPlan(): Blueprint {
  const [W, D] = facadeSize(FLATS), HD = D / 2;
  // (the stair behind the front door, between two walls: x -3.2 to 0.2; a flat to the west of it and one to the east)
  const SW = -3.2, SE = 0.2;
  const flat = (f: Floor, n: number) => {
    // west: the kitchen at the front, the bedroom behind a wall. (The stove stood facing the wall; the shelves and the
    // cabinets before windows, and the beds out from the wall their heads were to.)
    f.put('electric_stove', -11.47, 0.2, Q).top('WoodenTable_01', -8.6, 2.6, 0, 0.57, 2).put('painted_wooden_chair_01', -8.0, 1.8, 2.8);
    f.bed(-10.6, -3.28, 0).put('painted_wooden_cabinet', -4.6, -1.62, PI).floor([-6.4, 0.4], [-9.6, 0.8]);
    // east: a long room and a bedroom at its end
    f.top('WoodenTable_01', 3.6, 2.8, 0.1, 0.57, 2).put('painted_wooden_chair_01', 2.8, 2.0, 0.4).case('Shelf_01', 5.77, -3.3, -Q, [0.66, 1.22]);
    f.bed(9.8, -3.28, 0).put('painted_wooden_cabinet', 6.4, -2.7, Q).floor([4.4, -1.0], [9.0, 1.6]);
    if (n % 2) f.put('cardboard_box_01', -4.2, 3.9, 0.6).put('vintage_suitcase', 6.24, -1.0, Q);
    f.put('sofa_02', 5.42, -1.0, -Q).put('painted_wooden_nightstand', 0.56, -1.0, Q).put('Television_01', 0.56, -1.0, Q, 0.62).put('GreenChair_01', 2.6, -3.2, -1.0);
    f.put('painted_wooden_cabinet', -11.5, 1.2, Q).put('painted_wooden_shelves', -3.3, -0.4, -Q).put('painted_wooden_chair_01', -9.2, 3.4, PI - 0.3);
    f.put('painted_wooden_nightstand', 10.65, -4.0, 0).put('painted_wooden_nightstand', -9.8, -4.0, 0).put('wooden_bookshelf_worn', 11.51, 1.25, -Q);
    return f;
  };
  const walls = (floor: number) => [
    ...facadeWalls(FLATS, floor, 'plaster_ext', 'int_painted'),
    inner([SW, -HD + 0.2], [SW, HD - 0.2], [door(1.6, 2.5)], 'int_painted', 'int_plaster'),
    inner([SE, -HD + 0.2], [SE, HD - 0.2], [door(1.6, 2.5)], 'int_plaster', 'int_painted'),
    inner([-11.8, -1.2], [SW, -1.2], [door(-7.6, -6.7)], 'int_painted', 'int_painted'),
    inner([6.0, -HD + 0.2], [6.0, HD - 0.2], [door(0.6, 1.5)], 'int_painted', 'int_painted'),
  ];
  const levels: Level[] = [1, 2, 3].map((n) => {
    const f = flat(new Floor(), n);
    return { h: STOREY_H, int: 'int_painted' as const, floor: 'floor_wood' as const, walls: walls(n), furniture: f.furniture, loot: f.loot };
  });
  const r = new Floor();
  // somebody watched the yard from up here
  r.put('wooden_military_crate', 2.0, HD - 1.0, 0.1).put('painted_wooden_chair_01', 3.4, HD - 1.4, 2.9).put('cardboard_box_01', -4.0, -3.2, 0.5);
  r.floor([2.6, HD - 1.8], [-6.0, 0.0], [8.0, 1.0]);
  const deck: Deck = {
    parapet: FLATS.parapet, h: 2.5, walls: [], roofs: [],
    boxes: [[-9.0, 0], [5.0, 0]].flatMap(([x, z]) => [
      { key: 'brick_rough' as const, x0: x - 0.5, x1: x + 0.5, y0: 0, y1: 1.3, z0: z - 0.35, z1: z + 0.35 },
      { key: 'concrete' as const, x0: x - 0.6, x1: x + 0.6, y0: 1.3, y1: 1.4, z0: z - 0.45, z1: z + 0.45, soft: true },
    ]),
    furniture: r.furniture, loot: r.loot,
    open: [{ side: 'back', a: 6.65, b: 8.35 }],
    usage: ['Town'],
  };
  const g = flat(new Floor(), 0);
  return {
    w: W, d: D, h: STOREY_H, ext: 'plaster_ext', int: 'int_painted', floor: 'floor_wood', roof: 'concrete', roofType: 'flat',
    walls: walls(0), furniture: g.furniture, loot: g.loot,
    levels, wells: [{ x0: SW + 0.2, x1: SE - 0.2, land: 0.4, far: -4.1, upTo: 3 }], deck,
    escapes: [{ side: 'back', at: 7.5, dir: -1, floors: 3, roof: true }],
    usage: ['Town'],
  };
}

/** which of the towns' buildings wear a facade, and which (for the drawing: src/world/towns.ts) */
export const FACADES: Partial<Record<string, FacadeSpec>> = { works_hall: HALL, works_office: OFFICE, zavod_flats: FLATS };
