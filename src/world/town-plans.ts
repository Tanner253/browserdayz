// The buildings of the new towns (2026-10-16), each drawn up for its place: Pokrov, the white-walled monastery, and
// the town outside its gate; Lipki, the woodcutters' hamlet in the birch woods. The owner: "we shouldnt reuse any of
// the external building assets in any of the ruins buildings or cave buildings. we are making new towns ... do not
// make boring houses. be creative". None of these is a downloaded building: walls, floors, stairs and roofs are the
// game's own (src/world/buildings.ts), what stands in them is its furniture. Where they stand: src/sim/towns.ts.

import type { RNG } from '../core/noise';
import type { Blueprint, Dress, MatKey, Opening, WallDef } from './buildings';
import { Floor, PI, Q, door, gap, inner, win } from './big-buildings';
import { KIT_LEVELS } from '../sim/kit';

/** how high the monastery's wall-walk is over the wall's foot (the cells' roof is level with it) */
const WALK = KIT_LEVELS.walk;

/** an opening with a sill and no glass: a belfry's arch, a shop's hatch */
const arch = (a: number, b: number, bottom: number, top: number): Opening => ({ a, b, bottom, top, kind: 'gap' });
/**
 * How far a crate laid on another is set askew, along both of its building's ways: a crate is known by its place to a
 * tenth of a metre (crateId in src/net/protocol.ts), and so far off along both is a tenth off along one of the world's
 * ways however the building is turned. Two in one place were one container on the server.
 */
export const STACK = 0.15;
/** where a part of a building opens into the next part of it (see Blueprint.joined): no door, no step */
const join = (a: number, b: number, top: number): Opening => ({ a, b, bottom: 0, top, kind: 'gap', join: true });
/** a rack whose boards hold things (see RACKS in buildings.ts: its places are made last) */
const rack = (g: Floor, id: 'rack_wide' | 'rack_small', x: number, z: number, rot: number, on = [0, 1, 2]) => g.furniture.push({ id, x, z, rot, on });

// ------------------------------------------------------------------------------------------------ the monastery

/**
 * The cathedral's nave: one tall hall, the door at its west end, and across its east end the iconostasis with the
 * royal doors in its middle and a door each side; the sanctuary behind it runs on into the apse and has a door of
 * its own to the outside. Its long walls open into the two arms of the cross, each with its own door out: five ways
 * in, so it is fought through, not held. Limewashed brick, the lime fallen from it here and there.
 */
export function cathedralPlan(): Blueprint {
  // (long along x, as a gable roof runs: the door in its west gable end, the left wall)
  const HW = 12, HD = 6.5, I = 7.2;
  const g = new Floor();
  // The army's store (the owner, 2026-10-19: "the interior is completely empty, a military spawn in there would be
  // nice"), as the churches of these lands were made stores: the west end, from the door to the arms, stacked along its
  // walls, a rack of arms, two lockers, the table things were counted out on, the aisle from the door kept clear. The
  // crossing is left to the church: two tables of candles before the screen, benches by the door.
  g.put('crate_big', -11.2, -5.7, 0.05).put('wooden_military_crate', -11.2 + STACK, -5.7 + STACK, 0.1, 1.0)
    .put('old_military_crate', -9.4, -5.61, 0).put('old_military_crate', -9.4 + STACK, -5.61 + STACK, 0.04, 0.3)
    .put('gun_rack', -6.0, -5.98, 0).put('wooden_military_crate', -3.6, -6.02, 0).put('Barrel_01', -2.35, -5.95);
  g.put('steel_locker', -8.3, 6.0, PI).put('steel_locker', -7.2, 6.0, PI)
    .top('steel_table', -4.5, 5.6, Q, 0.8, 2).put('SchoolChair_01', -4.9, 4.7, 0.2).put('painted_wooden_stool', -3.7, 4.75, 0.4)
    .put('metal_jerrycan_green', -2.6, 5.95, 0.2).put('metal_jerrycan_green', -2.2, 5.9, -0.3).put('propane_tank', -2.15, 4.95);
  g.put('crate_big', -6.8, -2.6, 0.1).put('crate_big', -5.75, -2.75, -0.05).put('Barrel_01', -6.3, 2.8).put('Barrel_01', -5.65, 3.1).put('metal_jerrycan_green', -7.0, 3.0, 1.2);
  g.put('crate_big', -9.2, 3.0, 0.08).put('crate_big', -9.2 + STACK, 3.0 + STACK, -0.04, 1.0);
  g.put('painted_wooden_bench', -11.55, -3.5, Q).put('painted_wooden_bench', -11.55, 3.5, Q);
  for (const x of [0.6, 2.8]) g.put('painted_wooden_bench', x, -2.4, Q).put('painted_wooden_bench', x, 2.4, Q);
  for (const z of [-2.6, 2.6]) {
    g.put('WoodenTable_01', 5.6, z, Q);
    for (const k of [-0.55, 0, 0.55]) g.put('wooden_candlestick', 5.6 + k * 0.2, z + k, 0, 0.55);
  }
  g.floor([4.2, 0], [-1.2, 2.4], [-4.6, 0], [-9.4, -2.6]);
  // the sanctuary: the altar with its candles, the vestry's cupboard and shelves
  g.top('painted_wooden_table', 9.6, 0, Q, 0.98, 2).top('painted_wooden_cabinet', 11.25, -5.2, -Q, 1.2).case('Shelf_01', 10.4, 5.95, PI, [0.66, 1.22, 1.75]).put('painted_wooden_chair_01', 9.2, 3.0, -0.4).floor([8.3, -3.6], [8.5, 3.3]);
  g.put('wooden_candlestick', 9.6, -1.05, 0, 0.96).put('wooden_candlestick', 9.6, 1.05, 0, 0.96);
  const tall = (x: number) => win(x - 0.6, x + 0.6, 3.4, 6.9);
  return {
    w: HW * 2, d: HD * 2, h: 8.0, ext: 'lime_brick', int: 'int_painted', floor: 'floor_wood', roof: 'roof_iron_green', roofType: 'gable',
    walls: [
      { side: 'left', ext: 'lime_brick', int: 'int_painted', openings: [door(-1.1, 1.1, 3.4), win(-4.7, -3.5, 4.4, 6.8), win(3.5, 4.7, 4.4, 6.8), win(-0.6, 0.6, 4.6, 6.8)] },
      // (the east gable opens into the apse, the long walls into the arms: see cathedralArmPlan, cathedralApsePlan)
      { side: 'right', ext: 'lime_brick', int: 'int_painted', openings: [join(-3.6, 3.6, 6.0)] },
      { side: 'front', ext: 'lime_brick', int: 'int_painted', openings: [tall(-8), tall(-3), join(-1.6, 6.6, 6.0), win(8.6, 9.4, 3.4, 6.9), door(-10.6, -9.4, 2.4)] },
      { side: 'back', ext: 'lime_brick', int: 'int_painted', openings: [tall(-8), tall(-3), join(-1.6, 6.6, 6.0), door(9.9, 10.9)] },
      // the iconostasis: the royal doors, and a deacon's door each side
      inner([I, -HD + 0.2], [I, HD - 0.2], [gap(-1.0, 1.0, 3.0), door(-4.2, -3.4), door(3.4, 4.2)], 'int_painted', 'int_painted'),
    ],
    furniture: g.furniture, loot: g.loot,
    dress: { plinth: { h: 0.9, key: 'plinth' }, bands: 'trim_white', trim: 'trim_white' },
    // (what is kept in it is the army's: see above)
    usage: ['Military'],
  };
}

/**
 * An arm of the cathedral's cross: its own x runs out from the nave (which its left side opens into), its gable end
 * with a door at the far end, so its roof's ridge crosses the nave's. Stood one each side.
 */
export function cathedralArmPlan(): Blueprint {
  const HW = 2.5, HD = 4.5;
  const g = new Floor();
  // (where the soldiers who kept the store slept: four cots, their heads to the walls, a locker and the old cupboard)
  g.bed(-1.3, -3.3, 0).bed(0.4, -3.3, 0, false).bed(-1.3, 3.3, PI, false).bed(0.4, 3.3, PI);
  g.put('painted_wooden_chair_01', 1.4, -3.9, 0).put('painted_wooden_chair_01', 1.4, 3.9, PI).top('painted_wooden_cabinet', HW - 0.49, -3.2, -Q, 1.2).put('steel_locker', HW - 0.48, 3.2, -Q).floor([-0.5, 1.6], [-0.8, -1.6]);
  return {
    w: HW * 2, d: HD * 2, h: 6.5, ext: 'lime_brick', int: 'int_painted', floor: 'floor_wood', roof: 'roof_iron_green', roofType: 'gable',
    walls: [
      { side: 'right', ext: 'lime_brick', int: 'int_painted', openings: [door(-0.65, 0.65, 2.6), win(-0.45, 0.45, 3.6, 5.6)] },
      { side: 'front', ext: 'lime_brick', int: 'int_painted', openings: [win(-0.5, 0.5, 2.6, 5.0)] },
      { side: 'back', ext: 'lime_brick', int: 'int_painted', openings: [win(-0.5, 0.5, 2.6, 5.0)] },
    ],
    joined: ['left'],
    furniture: g.furniture, loot: g.loot,
    dress: { plinth: { h: 0.9, key: 'plinth' }, bands: 'trim_white', trim: 'trim_white' },
    usage: ['Military'],
  };
}

/** The apse: the sanctuary run on east of the nave (which its left side opens into), a tall window in its end. */
export function cathedralApsePlan(): Blueprint {
  const HW = 3, HD = 4;
  const g = new Floor();
  g.top('painted_wooden_table', 0.6, 0, Q, 0.98, 2).put('painted_wooden_chair_01', -1.2, 2.6, 2.6).floor([1.8, -2.4]);
  g.put('wooden_candlestick', 0.6, -1.05, 0, 0.96).put('wooden_candlestick', 0.6, 1.05, 0, 0.96).put('painted_wooden_bench', 2.55, 2.4, -Q).put('painted_wooden_bench', 2.55, -2.4, -Q);
  return {
    w: HW * 2, d: HD * 2, h: 6.0, ext: 'lime_brick', int: 'int_painted', floor: 'floor_wood', roof: 'roof_iron_green', roofType: 'gable',
    walls: [
      { side: 'right', ext: 'lime_brick', int: 'int_painted', openings: [win(-0.6, 0.6, 2.4, 5.2)] },
      { side: 'front', ext: 'lime_brick', int: 'int_painted', openings: [win(-0.45, 0.45, 2.8, 4.6)] },
      { side: 'back', ext: 'lime_brick', int: 'int_painted', openings: [win(-0.45, 0.45, 2.8, 4.6)] },
    ],
    joined: ['left'],
    furniture: g.furniture, loot: g.loot,
    dress: { plinth: { h: 0.9, key: 'plinth' }, bands: 'trim_white', trim: 'trim_white' },
    usage: ['Town'],
  };
}

/**
 * The belfry: the tallest thing for a kilometre. Five floors of a stair turning up its west side, and at the top
 * the bell chamber, open on all four sides through arches: the sniper's nest that everybody can see, and that the
 * walls round it hide from most of the town.
 */
export function belfryPlan(): Blueprint {
  const HW = 3, H = 3.1;
  const well = { x0: -2.6, x1: 0.4, land: 1.3, far: -2.6, upTo: 5 };
  const slit: Opening[] = [win(-0.35, 0.35, 1.1, 2.1)];
  const sides = (o: Opening[], key: 'int_plaster' | 'int_painted' = 'int_plaster'): WallDef[] => (['front', 'back', 'left', 'right'] as const).map((side) => ({ side, ext: 'lime_brick', int: key, openings: o }));
  const levels = [1, 2, 3, 4].map((n) => {
    const f = new Floor().floor([1.7, -1.6], [1.8, 2.0]);
    if (n === 2) f.put('wooden_crate_01', 2.1, -2.3, 0.2);
    // (a bench under the east slit for whoever kept watch, and a stool)
    if (n === 1 || n === 3) f.put('painted_wooden_bench', 2.55, 0.6, -Q);
    if (n === 4) f.put('painted_wooden_stool', 2.2, 0.4, 0.5);
    return { h: H, int: 'int_plaster' as const, floor: 'floor_wood' as const, walls: sides(slit), furniture: f.furniture, loot: f.loot };
  });
  const bells = new Floor();
  bells.floor([1.8, -1.8], [1.8, 2.0], [-1.6, 2.1]);
  levels.push({ h: 3.4, int: 'int_plaster', floor: 'floor_wood', walls: sides([arch(-1.7, 1.7, 0.95, 3.0)]), furniture: bells.furniture, loot: bells.loot });
  const g = new Floor();
  g.put('Barrel_01', 2.2, -2.2).floor([1.8, 1.4]);
  return {
    w: HW * 2, d: HW * 2, h: H, ext: 'lime_brick', int: 'int_plaster', floor: 'floor_concrete', roof: 'roof_iron_green', roofType: 'gable',
    walls: [
      { side: 'front', ext: 'lime_brick', int: 'int_plaster', openings: [door(0.9, 2.0)] },
      { side: 'back', ext: 'lime_brick', int: 'int_plaster', openings: slit },
      { side: 'left', ext: 'lime_brick', int: 'int_plaster', openings: [] },
      { side: 'right', ext: 'lime_brick', int: 'int_plaster', openings: slit },
    ],
    furniture: g.furniture, loot: g.loot,
    levels, wells: [well],
    dress: { plinth: { h: 0.7, key: 'plinth' }, bands: 'trim_white', trim: 'trim_white' },
    usage: ['Town'],
  };
}

/**
 * The monks' cells: a range of small rooms on two floors along a corridor that looks onto the courtyard, against the
 * inside of the east wall, the stair in a room of its own at its north end. Four cells a floor, each a bed, a table
 * and a place on the floor. Its roof is flat and as high as the wall-walk, and open on the wall's side: from the walk
 * you step onto it, cross it, and drop into the court ("roofs to cross", on the board the owner was shown).
 */
export function cellsPlan(): Blueprint {
  const HW = 12, HD = 4.5, X0 = -HW + 0.2, X1 = HW - 0.2, Z0 = -HD + 0.2, C = 2.2, STAIR = 7.0;
  // (the ground floor's height, and the one above's: the roof at the walk's height over the wall's foot, the floor
  // 0.3 over that foot, a slab of 0.2 over each storey)
  const H0 = 3.2, H1 = WALK - 0.3 - H0 - 0.4;
  const parts = [-7.1, -2.4, 2.3, STAIR];
  const cells: [number, number][] = [[X0, parts[0]], ...parts.slice(0, -1).map((x, i): [number, number] => [x, parts[i + 1]])];
  const lay = (f: Floor) => {
    for (const [a, b] of cells) {
      const cx = (a + b) / 2;
      f.bed(cx - 1.1, -3.15).top('WoodenTable_01', cx + 1.0, -3.85, 0, 0.57).put('painted_wooden_chair_01', cx + 1.0, -3.1, PI).floor([cx, 0.9]);
      f.put('painted_wooden_shelves', a + 0.1, -0.6, Q);
    }
    f.floor([-6, 3.3], [4, 3.3]);
    f.put('painted_wooden_bench', -7.1, 4.05, PI).put('painted_wooden_bench', 2.3, 4.05, PI);
    return f;
  };
  // (the stair's door over the flight that goes up from the ground, and above over the one that comes up: above, it
  // opened onto the railed-off hole over the first)
  const doors = (up: boolean) => [...cells.map(([, b]) => door(b - 1.3, b - 0.5)), up ? door(STAIR + 2.9, STAIR + 3.7) : door(STAIR + 1.0, STAIR + 1.8)];
  const walls = (front: Opening[], up = false): WallDef[] => [
    { side: 'front', ext: 'lime_brick', int: 'int_plaster', openings: front },
    { side: 'back', ext: 'lime_brick', int: 'int_plaster', openings: [] },
    { side: 'left', ext: 'lime_brick', int: 'int_plaster', openings: [win(0.6, 1.6)] },
    { side: 'right', ext: 'lime_brick', int: 'int_plaster', openings: [win(-1.6, -0.6, 1.2, 2.0)] },
    inner([X0, C], [X1, C], doors(up), 'int_plaster', 'int_plaster'),
    ...parts.map((x) => inner([x, Z0], [x, C - 0.1], [], 'int_plaster', 'int_plaster')),
  ];
  const front = (ground: boolean) => [
    ...cells.map(([a, b]) => win((a + b) / 2 - 0.5, (a + b) / 2 + 0.5)).filter((_, i) => i !== 2),
    ...(ground ? [door(-0.4, 0.6), door(9.4, 10.4)] : [win(-0.4, 0.6), win(9.4, 10.4)]),
  ];
  const g = lay(new Floor());
  // (beside the stair, not on its landing)
  g.put('Barrel_01', 11.5, -3.95);
  const u = lay(new Floor());
  u.floor([10.6, 3.2]);
  const r = new Floor();
  r.put('wooden_crate_01', -4.0, -1.2, 0.3).floor([-8.0, 0.4], [3.4, -1.6]);
  return {
    w: HW * 2, d: HD * 2, h: H0, ext: 'lime_brick', int: 'int_plaster', floor: 'floor_wood', roof: 'concrete', roofType: 'flat',
    walls: walls(front(true)), furniture: g.furniture, loot: g.loot,
    levels: [{ h: H1, int: 'int_plaster', floor: 'floor_wood', walls: walls(front(false), true), furniture: u.furniture, loot: u.loot }],
    wells: [{ x0: STAIR + 0.4, x1: X1 - 0.6, land: 1.8, far: -4.0, upTo: 1 }],
    // (its parapet the wall's own over the walk, and none on the wall's side, where it meets the walk)
    deck: { parapet: 0.68, h: 2.5, walls: [], roofs: [], boxes: [], furniture: r.furniture, loot: r.loot, open: [{ side: 'back', a: -HW, b: HW }] },
    dress: { plinth: { h: 0.6, key: 'plinth' }, bands: 'trim_white' },
    usage: ['Village', 'Town'],
  };
}

/** The refectory: the long dining hall, two rows of tables, and the kitchen behind a wall at its east end with a back door of its own. */
export function refectoryPlan(): Blueprint {
  const HW = 11, HD = 5, K = 6.9;
  const g = new Floor();
  // (the last table clear of the kitchen's door)
  [-9.3, -6.5, -3.7, -0.9, 1.9, 4.7].forEach((x, i) => {
    g.top('painted_wooden_table', x, -1.9, 0, 0.98, i % 2).top('painted_wooden_table', x, 1.3, 0, 0.98, (i + 1) % 2);
    if (i % 2 === 0) g.put('painted_wooden_chair_01', x - 0.6, -2.7, 0).put('painted_wooden_chair_01', x + 0.5, 2.1, PI);
    else g.put('painted_wooden_bench', x, -2.85, 0).put('painted_wooden_bench', x, 2.25, PI);
  });
  g.floor([-10.0, 3.9], [3.6, -4.0], [6.0, 3.8]);
  g.put('painted_wooden_shelves', 7.0, -2.0, Q).put('painted_wooden_stool', 8.0, 1.2, 0.3);
  // the kitchen
  g.put('wood_stove', 10.3, -4.0, 0).top('painted_wooden_cabinet', 8.0, -4.45, 0, 1.2).case('Shelf_01', 10.65, 2.4, -Q, [0.66, 1.22, 1.75]).put('Barrel_01', 10.2, 4.2).top('WoodenTable_01', 8.6, 0.4, Q, 0.57).floor([8.2, 3.6]);
  return {
    w: HW * 2, d: HD * 2, h: 3.6, ext: 'lime_brick', int: 'int_painted', floor: 'floor_wood', roof: 'roof_iron_green', roofType: 'gable',
    walls: [
      { side: 'front', ext: 'lime_brick', int: 'int_painted', openings: [win(-8.6, -7.4, 1.0, 2.6), win(-5.1, -3.9, 1.0, 2.6), door(-1.0, 1.0, 2.5), win(3.4, 4.6, 1.0, 2.6), win(8.4, 9.4)] },
      { side: 'back', ext: 'lime_brick', int: 'int_painted', openings: [win(-8.6, -7.4, 1.0, 2.6), win(-5.1, -3.9, 1.0, 2.6), win(-1.6, -0.4, 1.0, 2.6), win(1.9, 3.1, 1.0, 2.6), door(8.6, 9.6)] },
      { side: 'left', ext: 'lime_brick', int: 'int_painted', openings: [win(-2.6, -1.4, 1.0, 2.6), win(1.4, 2.6, 1.0, 2.6)] },
      { side: 'right', ext: 'lime_brick', int: 'int_painted', openings: [win(-0.5, 0.5)] },
      inner([K, -HD + 0.2], [K, HD - 0.2], [door(1.6, 2.6)], 'int_painted', 'int_plaster'),
    ],
    furniture: g.furniture, loot: g.loot,
    usage: ['Village', 'Town'],
  };
}

/** The abbot's house: a hall with the stair and the study below, his bedroom and a corner for prayer above. */
export function abbotPlan(): Blueprint {
  const HW = 5, HD = 4, M = -1.1;
  const g = new Floor();
  // (the bookcases between the windows of the east wall, the cabinet in the hall against the study's wall: before, one
  // stood in a window and the other half in front of the back one, "props in a window", the owner 2026-10-19)
  g.top('metal_office_desk', 2.1, -3.3, 0, 0.81, 2).put('SchoolChair_01', 2.1, -2.4, PI).case('wooden_bookshelf_worn', 4.5, -0.72, -Q, [0.67, 1.28]).case('wooden_bookshelf_worn', 4.5, 0.72, -Q, [0.67, 1.28]).floor([1.0, 2.4]);
  g.top('painted_wooden_cabinet', -1.5, -2.0, -Q, 1.2).floor([-2.6, 0.4]);
  g.put('painted_wooden_bench', -2.0, -3.55, 0).put('painted_wooden_cabinet', 3.6, 3.47, PI).put('GreenChair_01', 0.4, 0.8, 2.6);
  const u = new Floor();
  u.bed(3.7, -2.4).top('painted_wooden_cabinet', 0.9, -3.45, 0, 1.2).put('scandinavian_masonry_heater', 4.3, 3.25, -Q).floor([1.6, 1.6]);
  // (the corner for prayer under the front window: its table stood across the head of the stair and before the door)
  u.top('WoodenTable_01', -2.5, 3.45, PI, 0.57).put('painted_wooden_chair_01', -2.5, 2.75, 0).floor([-2.0, -0.4]);
  u.put('wooden_candlestick', -2.2, 3.5, 0, 0.55).put('painted_wooden_shelves', -1.2, 1.2, -Q).put('painted_wooden_nightstand', 2.85, -3.55, 0).put('GreenChair_01', 1.2, 2.6, PI + 0.4);
  const ext = 'trim_white' as const;
  const outer = (front: Opening[]): WallDef[] => [
    { side: 'front', ext, int: 'int_painted', openings: front },
    { side: 'back', ext, int: 'int_painted', openings: [win(-2.4, -1.4), win(1.6, 2.8)] },
    { side: 'left', ext, int: 'int_painted', openings: [win(-0.5, 0.5)] },
    { side: 'right', ext, int: 'int_painted', openings: [win(-2.5, -1.5), win(1.5, 2.5)] },
  ];
  return {
    w: HW * 2, d: HD * 2, h: 2.8, ext, int: 'int_painted', floor: 'floor_wood', roof: 'roof_iron_green', roofType: 'gable',
    walls: [...outer([door(-2.6, -1.6), win(1.0, 2.4)]), inner([M, -HD + 0.2], [M, HD - 0.2], [door(1.2, 2.1)], 'int_painted', 'int_painted')],
    furniture: g.furniture, loot: g.loot,
    stairs: { x0: -4.6, x1: -3.2, foot: 2.2, top: -3.0 },
    upper: { h: 2.6, int: 'int_painted', floor: 'floor_wood', walls: [...outer([win(-2.4, -1.4), win(1.0, 2.4)]), inner([M, -HD + 0.2], [M, HD - 0.2], [door(-3.2, -2.3)], 'int_painted', 'int_painted')], furniture: u.furniture, loot: u.loot },
    dress: { plinth: { h: 0.6, key: 'plinth' }, trim: 'trim_white' },
    usage: ['Town'],
  };
}

// ------------------------------------------------------------------------------------------------ the town outside the gate

/**
 * The tavern: the taproom with its bar and the shelves behind it, the stair up the left wall, the kitchen behind a
 * wall with its own back door; above, a passage down the left side and three rooms for whoever stopped the night.
 */
export function tavernPlan(): Blueprint {
  const HW = 7, HD = 5, K = 3.1;
  const g = new Floor();
  for (const [x, z] of [[-3.2, 2.6], [-3.2, -0.6], [0.4, 3.0], [0.6, 0.7]] as [number, number][]) g.top('WoodenTable_01', x, z, 0, 0.57).put('painted_wooden_chair_01', x - 0.5, z + 0.7, PI).put('painted_wooden_chair_01', x + 0.4, z - 0.7, 0);
  g.case('Shelf_01', -1.0, -4.55, 0, [0.66, 1.22, 1.75]).case('Shelf_01', 1.0, -4.55, 0, [0.66, 1.22, 1.75]).put('Barrel_01', 2.5, -3.9).put('barrel_03', 1.92, -4.42).floor([-1.6, -3.4]);
  g.put('wood_stove', 6.42, -4.5, 0).top('painted_wooden_cabinet', 4.4, -4.45, 0, 1.2).top('WoodenTable_01', 5.0, 0.8, Q, 0.57).put('Barrel_01', 6.3, 4.3).floor([4.4, 3.4]);
  g.put('painted_wooden_shelves', 3.2, 1.6, Q).put('painted_wooden_stool', 5.75, 0.3, 0.5).put('barrel_03', 5.6, 4.4);
  // The rooms above: each bed's head to the outer wall and clear of its window, each cabinet against a wall of its own
  // room. Before, the cabinets stood across the three doors off the passage with their backs to them (the owner,
  // 2026-10-19: "many props bloock doorways"), and the beds lay with their feet to the wall.
  const u = new Floor();
  for (const [z, bed, cab, turn] of [[-3.2, -3.9, -4.52, 0], [0, -1.0, -1.21, 0], [3.2, 2.5, 4.52, PI]]) u.bed(5.7, bed, -Q).top('painted_wooden_cabinet', 1.9, cab, turn, 1.2).floor([2.0, z]);
  // (a nightstand at each bed's head, a chair against the wall beside each cabinet)
  for (const [bed, chair, turn] of [[-3.9, -4.4, 0.2], [-1.0, -1.15, 0.2], [2.5, 4.4, PI - 0.2]]) u.put('painted_wooden_nightstand', 6.55, bed + 0.95, -Q).put('painted_wooden_chair_01', 0.9, chair, turn);
  u.floor([-6.2, -4.3]);
  const ext = 'ochre_ext' as const;
  const outer = (front: Opening[], back: Opening[]): WallDef[] => [
    { side: 'front', ext, int: 'int_painted', openings: front },
    { side: 'back', ext, int: 'int_painted', openings: back },
    { side: 'left', ext, int: 'int_painted', openings: [win(0.4, 1.4)] },
    { side: 'right', ext, int: 'int_painted', openings: [win(-0.5, 0.5)] },
  ];
  return {
    w: HW * 2, d: HD * 2, h: 3.0, ext, int: 'int_painted', floor: 'floor_wood', roof: 'roof_tiles', roofType: 'gable',
    walls: [
      ...outer([win(-4.6, -3.2, 0.9, 2.3), win(-1.6, -0.4, 0.9, 2.3), door(0.8, 2.0, 2.3), win(4.6, 5.6)], [win(-3.6, -2.6), door(5.0, 6.0)]),
      inner([K, -HD + 0.2], [K, HD - 0.2], [door(-3.4, -2.6)], 'int_painted', 'int_plaster'),
    ],
    furniture: g.furniture, loot: g.loot,
    fittings: [{ level: 0, list: [
      // the bar: its front and its top
      { key: 'planks', x0: -2.2, x1: 2.8, y0: 0, y1: 1.02, z0: -2.6, z1: -2.05 },
      { key: 'trim', x0: -2.3, x1: 2.9, y0: 1.02, y1: 1.08, z0: -2.7, z1: -1.95, soft: true },
    ] }],
    stairs: { x0: -6.6, x1: -5.2, foot: 3.2, top: -2.6 },
    upper: {
      h: 2.7, int: 'int_painted', floor: 'floor_wood', furniture: u.furniture, loot: u.loot,
      walls: [
        ...outer([win(-3.6, -2.6), win(-0.2, 0.8), win(3.0, 4.0)], [win(-3.6, -2.6), win(-0.2, 0.8), win(3.0, 4.0)]),
        // (the passage's wall a stride clear of the stair's rail: at x -5.0 it stood against the hole the stair comes
        // up through, and the two rooms in from the front opened onto it, "doors in places that do not make sense")
        inner([-4.2, -HD + 0.2], [-4.2, HD - 0.2], [door(-3.8, -3.0), door(-0.6, 0.2), door(2.6, 3.4)], 'int_painted', 'int_painted'),
        inner([-4.1, -1.6], [HW - 0.2, -1.6], [], 'int_painted', 'int_painted'),
        inner([-4.1, 1.6], [HW - 0.2, 1.6], [], 'int_painted', 'int_painted'),
      ],
    },
    sign: { x: 1.4, y: 2.75, text: 'ТРАКТИР', sub: 'TAVERN' },
    dress: { plinth: { h: 0.5, key: 'plinth' }, trim: 'trim_white' },
    usage: ['Town'],
  };
}

/** A merchant's house: the shop on the street with its counter, racks and a hatch onto the street, the storeroom and stair behind; his rooms above. */
export function merchantPlan(): Blueprint {
  const HW = 5.5, HD = 4.5, S = 2.1;
  const g = new Floor();
  // (the racks either side of the back window, not across it)
  rack(g, 'rack_wide', -4.3, -3.95, 0);
  rack(g, 'rack_wide', -1.45, -3.95, 0);
  g.floor([-2.6, 2.6], [0.6, -1.6]);
  // (a crate on a crate set askew: a crate is known by its place to a tenth of a metre, and two in one place were one: STACK)
  g.put('wooden_military_crate', 3.0, -3.8, 0).put('wooden_crate_01', 3.0 + STACK, -3.8 + STACK, 0.06, 0.5).put('Barrel_01', 2.6, -2.6).floor([3.0, 1.4]);
  g.put('painted_wooden_shelves', 2.0, -2.5, -Q).put('painted_wooden_stool', -1.8, -0.2, 0.2).put('cardboard_box_01', -3.7, 3.7, 0.4).put('painted_wooden_shelves', 4.6, -4.3, 0);
  g.put('Barrel_01', 1.4, 3.6).put('barrel_03', -4.8, 1.8, 0.3);
  const u = new Floor();
  u.top('WoodenTable_01', -3.0, 0.6, 0, 0.57).put('painted_wooden_chair_01', -3.4, 1.3, PI).put('painted_wooden_chair_01', -2.6, -0.1, 0).put('scandinavian_masonry_heater', -4.58, -3.8, 0).floor([-1.2, 2.8]);
  // (the bed against the back wall beside the cabinet: it lay at the head of the stair, and whoever came up walked into it)
  u.bed(2.6, -3.28).top('painted_wooden_cabinet', 0.65, -3.97, 0, 1.2).case('Shelf_01', 1.0, 4.1, PI, [0.66, 1.22]).floor([2.4, 1.0]);
  u.put('painted_wooden_bench', -2.1, 4.05, PI).put('painted_wooden_cabinet', -1.6, -3.97, 0).put('painted_wooden_nightstand', 1.7, -4.05, 0).put('painted_wooden_stool', 0.9, 3.2, 0.7);
  const ext = 'plaster_ext' as const;
  const outer = (front: Opening[]): WallDef[] => [
    { side: 'front', ext, int: 'int_painted', openings: front },
    { side: 'back', ext, int: 'int_painted', openings: [win(-3.4, -2.4), win(3.4, 4.2, 1.3, 2.0)] },
    { side: 'left', ext, int: 'int_painted', openings: [win(-0.5, 0.5)] },
    { side: 'right', ext, int: 'int_painted', openings: [win(-2.6, -1.8)] },
  ];
  return {
    w: HW * 2, d: HD * 2, h: 3.0, ext, int: 'int_painted', floor: 'floor_wood', roof: 'roof_tiles', roofType: 'gable',
    walls: [
      ...outer([arch(-4.8, -2.6, 0.95, 2.3), door(-1.6, -0.6, 2.3), win(0.4, 1.6, 0.9, 2.3), door(2.35, 3.35)]),
      inner([S, -HD + 0.2], [S, HD - 0.2], [door(-0.4, 0.5)], 'int_painted', 'int_plaster'),
    ],
    furniture: g.furniture, loot: g.loot,
    fittings: [{ level: 0, list: [{ key: 'planks', x0: -4.4, x1: 0.8, y0: 0, y1: 0.98, z0: 0.6, z1: 1.15 }, { key: 'trim', x0: -4.5, x1: 0.9, y0: 0.98, y1: 1.03, z0: 0.5, z1: 1.25, soft: true }] }],
    stairs: { x0: 3.8, x1: 5.2, foot: 3.8, top: -1.4 },
    upper: { h: 2.6, int: 'int_painted', floor: 'floor_wood', walls: [...outer([win(-4.2, -3.0), win(-1.2, 0.0), win(2.6, 3.8)]), inner([-0.5, -HD + 0.2], [-0.5, HD - 0.2], [door(1.6, 2.5)], 'int_painted', 'int_painted')], furniture: u.furniture, loot: u.loot },
    sign: { x: -1.1, y: 2.65, text: 'ЛАВКА', sub: 'SHOP' },
    dress: { plinth: { h: 0.5, key: 'plinth' }, trim: 'trim_white' },
    usage: ['Shop'],
  };
}

/** The smithy: open to the street along most of its front, the forge in the back corner, the bench and the tool rack. */
export function smithyPlan(): Blueprint {
  const HW = 5, HD = 3.5;
  const g = new Floor();
  g.put('stone_fire_pit', -3.0, -1.9, 0).top('WoodenTable_01', 2.6, -2.85, 0, 0.57, 2).put('Barrel_01', 4.3, 2.6).put('barrel_03', 3.6, 2.9).put('wooden_crate_01', -4.45, 0.6, Q).floor([0.2, 0.6], [-1.6, 2.4]);
  rack(g, 'rack_small', 4.3, -0.4, -Q);
  g.put('painted_wooden_stool', -1.9, -1.0, 0.4);
  return {
    w: HW * 2, d: HD * 2, h: 3.4, ext: 'brick_ext', int: 'int_plaster', floor: 'floor_concrete', roof: 'roof_iron', roofType: 'shed',
    walls: [
      { side: 'front', ext: 'brick_ext', int: 'int_plaster', openings: [gap(-4.6, 1.8, 3.0), win(3.0, 4.2)] },
      { side: 'back', ext: 'brick_ext', int: 'int_plaster', openings: [win(-0.4, 0.6, 1.4, 2.2)] },
      { side: 'left', ext: 'brick_ext', int: 'int_plaster', openings: [] },
      { side: 'right', ext: 'brick_ext', int: 'int_plaster', openings: [door(1.2, 2.2)] },
    ],
    furniture: g.furniture, loot: g.loot,
    usage: ['Industrial', 'Farm'],
  };
}

// ------------------------------------------------------------------------------------------------ the hamlet

/**
 * A log house's paint, by its own number: its logs left to weather, or boarded and painted the blues and greens of
 * these villages; an iron or tiled roof; white frames round its windows (the carved ones every house here has). The
 * first pass's were all the dark weathered logs: from the green they read as black boxes.
 */
function izbaLook(rng?: RNG): { ext: MatKey; roof: MatKey; dress: Dress } {
  const pick = <T,>(list: T[]) => list[rng ? Math.floor(rng.next() * list.length) % list.length : 0];
  return {
    ext: pick<MatKey>(['boards_blue', 'planks_ext', 'boards_green', 'planks_brown', 'boards_blue', 'boards_green']),
    roof: pick<MatKey>(['roof_iron_red', 'roof_iron_green', 'roof_tiles', 'roof_iron', 'roof_slate']),
    dress: { plinth: { h: 0.5, key: 'plinth' }, trim: 'trim_white' },
  };
}

/** A log house: the big room with the stove that heats it, a bedroom through a door, a porch at the door. */
export function izbaPlan(rng?: RNG): Blueprint {
  const { ext: E, roof, dress } = izbaLook(rng);
  const HW = 4, HD = 3.25, M = 1.2;
  const g = new Floor();
  // (the table and its chairs out of the way in from the door: a chair stood in the doorway)
  g.put('scandinavian_masonry_heater', -3.08, -2.55, 0).top('WoodenTable_01', -0.9, 1.5, 0, 0.57).put('painted_wooden_chair_01', -0.5, 2.25, PI).put('painted_wooden_chair_01', -1.3, 0.8, 0).top('painted_wooden_cabinet', 0.4, -2.75, 0, 1.2).floor([-1.6, -0.8]);
  g.bed(3.15, -2.0).case('Shelf_01', 3.62, 1.7, -Q, [0.66, 1.22]).floor([2.4, 0.8]);
  g.put('painted_wooden_bench', -3.55, 0.9, Q).put('painted_wooden_shelves', -2.0, -3.05, 0).put('painted_wooden_nightstand', 2.35, -2.8, 0).put('painted_wooden_chair_01', 1.75, 2.6, PI + 0.3);
  return {
    w: HW * 2, d: HD * 2, h: 2.6, ext: E, int: 'planks', floor: 'floor_wood', roof, roofType: 'gable', dress,
    walls: [
      { side: 'front', ext: E, int: 'planks', openings: [door(-2.4, -1.4), win(-0.2, 0.8), win(2.2, 3.1)] },
      { side: 'back', ext: E, int: 'planks', openings: [win(-1.4, -0.5), win(2.0, 2.9)] },
      { side: 'left', ext: E, int: 'planks', openings: [win(0.3, 1.2)] },
      { side: 'right', ext: E, int: 'planks', openings: [win(-0.4, 0.5)] },
      inner([M, -HD + 0.2], [M, HD - 0.2], [door(-0.1, 0.8)], 'planks', 'planks'),
    ],
    furniture: g.furniture, loot: g.loot,
    // (the porch: boards before the door, a step down from the floor)
    fittings: [{ level: 0, list: [{ key: 'planks', x0: -3.1, x1: -0.7, y0: -0.3, y1: -0.04, z0: HD, z1: HD + 1.3 }] }],
    usage: ['Village'],
  };
}

/** The bigger log house of the hamlet: kitchen and stair room below, two bedrooms above. */
export function izbaTwoPlan(rng?: RNG): Blueprint {
  const HW = 4.5, HD = 4, M = 0.6;
  const { ext: E, roof, dress } = izbaLook(rng);
  const g = new Floor();
  g.put('scandinavian_masonry_heater', -3.6, -3.1, 0).top('WoodenTable_01', -2.2, 1.6, 0, 0.57).put('painted_wooden_chair_01', -2.6, 2.3, PI).put('painted_wooden_chair_01', -1.8, 0.9, 0).top('painted_wooden_cabinet', -1.0, -3.45, 0, 1.2).floor([-3.4, 3.0]);
  // (the bookcase and the shelves against the middle wall, out of the back windows; the bed's head to the front wall)
  g.case('wooden_bookshelf_worn', 1.0, -1.4, Q, [0.67, 1.28]).floor([1.6, 2.6]);
  g.put('painted_wooden_bench', -4.05, 0.05, Q).put('painted_wooden_stool', -2.6, -2.2, 0.3).put('painted_wooden_shelves', 0.95, 3.8, PI);
  const u = new Floor();
  u.bed(-3.6, -2.6).top('painted_wooden_cabinet', -0.95, -3.45, 0, 1.2).floor([-2.0, 2.2]);
  u.bed(1.7, 2.78, PI).case('Shelf_01', 0.84, -0.6, Q, [0.66, 1.22]).floor([1.6, 0.4]);
  u.put('painted_wooden_nightstand', -2.85, -3.55, 0).put('painted_wooden_bench', -4.05, 1.0, Q).put('painted_wooden_nightstand', 0.98, 3.52, PI);
  const outer = (front: Opening[]): WallDef[] => [
    { side: 'front', ext: E, int: 'planks', openings: front },
    { side: 'back', ext: E, int: 'planks', openings: [win(-2.6, -1.7), win(1.2, 2.1)] },
    { side: 'left', ext: E, int: 'planks', openings: [win(-0.4, 0.5)] },
    { side: 'right', ext: E, int: 'planks', openings: [win(0.2, 1.1)] },
  ];
  return {
    w: HW * 2, d: HD * 2, h: 2.7, ext: E, int: 'planks', floor: 'floor_wood', roof, roofType: 'gable', dress,
    walls: [...outer([door(-1.6, -0.6), win(-3.6, -2.7), win(1.4, 2.3)]), inner([M, -HD + 0.2], [M, HD - 0.2], [door(1.6, 2.5)], 'planks', 'planks')],
    furniture: g.furniture, loot: g.loot,
    stairs: { x0: 2.6, x1: 4.0, foot: 2.8, top: -2.6 },
    upper: { h: 2.5, int: 'planks', floor: 'floor_wood', walls: [...outer([win(-3.4, -2.5), win(-1.0, -0.1), win(1.6, 2.5)]), inner([M, -HD + 0.2], [M, HD - 0.2], [door(-3.0, -2.2)], 'planks', 'planks')], furniture: u.furniture, loot: u.loot },
    fittings: [{ level: 0, list: [{ key: 'planks', x0: -2.3, x1: 0.1, y0: -0.3, y1: -0.04, z0: HD, z1: HD + 1.4 }] }],
    usage: ['Village'],
  };
}

/** The hamlet's chapel: timber, a nave of benches, the screen with its doors before a small sanctuary. */
export function chapelPlan(): Blueprint {
  // (long along x, as its roof runs: the door in the gable end on its left)
  const HW = 4.5, HD = 3;
  const g = new Floor();
  g.put('painted_wooden_chair_01', 1.2, -2.4, 0).put('painted_wooden_chair_01', 0.4, 2.4, PI).floor([-2.6, 0], [0.6, 0], [-3.2, -1.6]);
  g.put('painted_wooden_bench', -3.0, 2.55, PI).put('painted_wooden_bench', -1.2, 2.55, PI).put('painted_wooden_bench', -3.0, -2.55, 0).put('painted_wooden_bench', -1.2, -2.55, 0);
  g.top('WoodenTable_01', 3.95, 0, Q, 0.57).put('painted_wooden_cabinet', 4.0, 1.8, -Q).floor([3.4, -1.8]);
  g.put('wooden_candlestick', 3.95, -0.7, 0, 0.55).put('wooden_candlestick', 3.95, 0.7, 0, 0.55);
  return {
    w: HW * 2, d: HD * 2, h: 4.6, ext: 'planks_ext', int: 'planks', floor: 'floor_wood', roof: 'roof_iron_green', roofType: 'gable',
    walls: [
      { side: 'left', ext: 'planks_ext', int: 'planks', openings: [door(-0.6, 0.6, 2.4), win(-0.4, 0.4, 3.0, 3.9)] },
      { side: 'right', ext: 'planks_ext', int: 'planks', openings: [win(-0.4, 0.4, 2.2, 3.4)] },
      { side: 'front', ext: 'planks_ext', int: 'planks', openings: [win(-2.4, -1.6, 1.6, 3.4), win(1.2, 2.0, 1.6, 3.4)] },
      { side: 'back', ext: 'planks_ext', int: 'planks', openings: [win(-2.4, -1.6, 1.6, 3.4), win(1.2, 2.0, 1.6, 3.4)] },
      inner([2.6, -HD + 0.2], [2.6, HD - 0.2], [gap(-0.7, 0.7, 2.4)], 'planks', 'planks'),
    ],
    furniture: g.furniture, loot: g.loot,
    usage: ['Village'],
  };
}

/** The sawmill: a long timber shed open on its front and its west end, the saw bench in its middle, stacks of boards, the tools at the closed end. */
export function sawmillPlan(): Blueprint {
  const HW = 10, HD = 3.5;
  const g = new Floor();
  g.top('painted_wooden_table', -1.5, -0.9, 0, 0.98, 2);
  for (const [x, z] of [[-7.6, -2.4], [-7.6, -0.9], [4.2, -2.6]] as [number, number][]) g.put('old_military_crate', x, z, 0).put('old_military_crate', x + STACK, z + STACK, 0.04, 0.3).put('old_military_crate', x + 2 * STACK, z, -0.03, 0.6);
  g.put('Barrel_01', 9.1, 2.65).put('wooden_ladder', 9.45, 0.4, -Q).floor([-5.0, 1.6], [1.6, 1.8], [6.4, -0.4]);
  rack(g, 'rack_small', 8.7, -2.9, 0);
  return {
    w: HW * 2, d: HD * 2, h: 4.2, ext: 'planks_ext', int: 'planks', floor: 'floor_concrete', roof: 'roof_iron', roofType: 'shed',
    walls: [
      { side: 'front', ext: 'planks_ext', int: 'planks', openings: [gap(-9.6, -3.0, 3.6), gap(-1.6, 5.0, 3.6), door(7.4, 8.4)] },
      { side: 'back', ext: 'planks_ext', int: 'planks', openings: [win(-6.0, -5.0, 1.6, 2.4), win(2.0, 3.0, 1.6, 2.4)] },
      { side: 'left', ext: 'planks_ext', int: 'planks', openings: [gap(-1.8, 1.8, 3.6)] },
      { side: 'right', ext: 'planks_ext', int: 'planks', openings: [] },
    ],
    furniture: g.furniture, loot: g.loot,
    usage: ['Industrial'],
  };
}
