// Ozerki, the fishing village on the lake (2026-10-16): its two buildings of its own. The houses are the hamlets' log
// houses (src/world/town-plans.ts). Where they stand: src/sim/ozerki.ts.

import type { Blueprint } from './buildings';
import { Floor, PI, Q, door, gap, win } from './big-buildings';

/**
 * The boathouse at the end of the long pier: its floor the pier's deck, its lake end open from the deck to the eaves
 * where the boat came in, a door onto the pier. What was worth keeping dry is kept here: one way in, along thirty
 * metres of bare boards, and nowhere to go but the water.
 */
export function boathousePlan(): Blueprint {
  const HW = 3.5, HD = 3;
  const g = new Floor();
  g.put('old_military_crate', -2.6, -2.2, 0.1).put('old_military_crate', -2.6, -2.2, 0.05, 0.3).put('Barrel_01', 2.7, -2.3).put('metal_jerrycan_green', 2.0, -2.5, 0.6);
  g.top('WoodenTable_01', -2.7, 1.2, Q, 0.57, 2).case('Shelf_01', 2.95, 1.0, -Q, [0.66, 1.22]).floor([0.2, -0.6], [-0.4, 1.6]);
  return {
    w: HW * 2, d: HD * 2, h: 3.0, ext: 'boards_pale', int: 'planks', floor: 'floor_wood', roof: 'roof_iron', roofType: 'gable',
    walls: [
      // (its front to the pier, its back over the lake)
      { side: 'front', ext: 'boards_pale', int: 'planks', openings: [door(-0.5, 0.5), win(1.6, 2.4, 1.1, 1.9)] },
      { side: 'back', ext: 'boards_pale', int: 'planks', openings: [gap(-2.0, 2.0, 2.6)] },
      { side: 'left', ext: 'boards_pale', int: 'planks', openings: [win(-0.4, 0.4, 1.1, 1.9)] },
      { side: 'right', ext: 'boards_pale', int: 'planks', openings: [] },
    ],
    furniture: g.furniture, loot: g.loot,
    usage: ['Hunting'],
  };
}

/** The smokehouse on the shore: a dark little shed of boards where the catch was hung over a slow fire, one door, no window. */
export function smokehousePlan(): Blueprint {
  const HW = 2.2, HD = 1.8;
  const g = new Floor();
  g.put('stone_fire_pit', 0, -0.4, 0).put('wooden_crate_01', 1.4, 1.1, PI).floor([-1.2, 0.8]);
  return {
    w: HW * 2, d: HD * 2, h: 2.4, ext: 'planks_ext', int: 'planks', floor: 'floor_concrete', roof: 'roof_iron', roofType: 'gable',
    walls: [
      { side: 'front', ext: 'planks_ext', int: 'planks', openings: [door(-0.45, 0.45)] },
      { side: 'back', ext: 'planks_ext', int: 'planks', openings: [] },
      { side: 'left', ext: 'planks_ext', int: 'planks', openings: [] },
      { side: 'right', ext: 'planks_ext', int: 'planks', openings: [] },
    ],
    furniture: g.furniture, loot: g.loot,
    usage: ['Village'],
  };
}
