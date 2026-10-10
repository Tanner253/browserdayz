// The trader. A man stands behind the counter of each shop on the map. He buys what is
// brought to him and sells what a body needs to go on with: dressings, food, rounds, a light,
// a mask. Nothing changes hands but credit in his book: what he pays is written down, and
// what he sells is paid for out of it.
//
// What he will not deal in is what the Zone is fought over: nobody's tags, the bunker's card,
// and the guns and their fittings that are kept under the gas and down the bunker. Those are
// still got the way they were got.

import { ITEMS, type ItemInstance } from './items';

/** what one of a thing is worth to him, in credit (for a thing that stacks: each of the stack) */
const WORTH: Record<string, number> = {
  // guns: he takes them, and does not sell them
  p38: 12, m9: 16, mosin: 28, deagle: 40, benelli: 45,
  hatchet: 5, machete: 5, crowbar: 4, bat: 3, knife: 3,
  // rounds by the one (a sealed box is worth the rounds in it: see `worth`)
  ammo_9mm: 0.4, ammo_762: 0.6, ammo_50: 1.5, ammo_12: 1.2,
  // fittings
  red_dot: 20, gun_light: 10, pu_scope: 30, rifle_wrap: 8, suppressor_9: 22, suppressor_762: 28, suppressor_12: 28,
  mag_m9_ext: 12, mag_p38_ext: 12, mag_deagle_ext: 14,
  // food, drink, medicine
  sprats: 2, condensed: 3, beans: 3, tomatoes: 2, sardines: 2, apple: 1, milk: 2,
  water_jug: 3, flask: 3, thermos: 4,
  bandage: 4, firstaid: 12, splint: 5,
  // what is worn and carried
  boonie_hat: 18, life_vest: 22, gasmask: 30, work_gloves: 3, rubber_boots: 3, sack_pack: 8, suitcase: 6,
  flashlight: 5, binoculars: 10, compass: 4, watch: 6,
  cigarettes: 2, grenade: 15, stash_kit: 15, jerrycan: 8, radio: 35,
};

/** what he has to sell, in the order it is shown */
export const STOCK = ['bandage', 'firstaid', 'splint', 'beans', 'sardines', 'flask', 'box_9mm', 'box_762', 'box_12', 'box_50', 'flashlight', 'gun_light', 'red_dot', 'sack_pack', 'gasmask', 'grenade', 'stash_kit', 'radio'];

/** what one of a thing is worth to him: 0 if he does not deal in it */
export function worth(id: string): number {
  const def = ITEMS[id];
  if (!def) return 0;
  // (a box of rounds: what is in it, so that nothing is gained or lost by opening it before it is sold)
  if (def.open) return (WORTH[def.open.gives] ?? 0) * def.open.qty;
  return WORTH[id] ?? 0;
}

/** how many times what he pays for a thing he asks for it */
const MARKUP = 2.5;

/** what he pays for a thing as it is (a stack: for all of it). 0: he will not take it. */
export function pays(item: ItemInstance): number {
  const each = worth(item.id);
  if (!each) return 0;
  const n = ITEMS[item.id].stack ? Math.max(1, item.qty ?? 1) : 1;
  // (a gun is paid for with what is fitted to it: nothing is lost by not stripping it first)
  const fitted = (item.mods ?? []).reduce((sum, mod) => sum + worth(mod), 0);
  return Math.max(1, Math.round(each * n + fitted));
}

/** what he asks for one of a thing he sells (a thing that stacks is sold as a full stack) */
export function asks(id: string): number {
  const def = ITEMS[id];
  if (!def || !worth(id) || !STOCK.includes(id)) return 0;
  return Math.round(worth(id) * (def.stack ?? 1) * MARKUP);
}
