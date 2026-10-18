// The trader. A man stands behind the counter of the shop at the trading post, out east of the village. He buys what is
// brought to him and sells what a body needs to go on with: dressings, food, rounds, a light,
// a mask. Nothing changes hands but credit in his book: what he pays is written down, and
// what he sells is paid for out of it.
//
// What he will not deal in is what the Zone is fought over: nobody's tags, the bunker's card,
// and the guns and their fittings that are kept under the gas and down the bunker. Those are
// still got the way they were got.

import { ITEMS, fittedOf, type Category, type ItemInstance } from './items';


// (What a thing is worth to him and whether he sells it, and how many a day, are said on the thing itself: its
// `worth` and `sells`, in src/sim/items/. He is a place to top up at, not a place to be fitted out from: the dear
// things one a day, and the rest a handful. The guns he takes and does not sell; the frag grenade he buys, half as
// dear again as the stick grenade, and does not sell: it is found, from Kamenka on.)

/** the order his shelf is shown in, by sort: what mends you first */
const SHOWN: Category[] = ['medical', 'food', 'drink', 'ammo', 'magazine', 'tool', 'attachment', 'clothing', 'misc', 'stash'];
/** what he has to sell, in the order it is shown */
export const STOCK = Object.values(ITEMS).filter((d) => d.sells).sort((x, y) => SHOWN.indexOf(x.category) - SHOWN.indexOf(y.category)).map((d) => d.id);
/** how many of a thing he will sell one player in a day */
export const aDay = (id: string) => ITEMS[id]?.sells ?? 0;
/** what is left of a player's credit with him when they are killed: he writes the rest off */
export const KEPT_ON_DEATH = 0.5;

/** what one of a thing is worth to him: 0 if he does not deal in it */
export function worth(id: string): number {
  const def = ITEMS[id];
  if (!def) return 0;
  // (a box of rounds: what is in it, so that nothing is gained or lost by opening it before it is sold)
  if (def.open) return (ITEMS[def.open.gives]?.worth ?? 0) * def.open.qty;
  return def.worth ?? 0;
}

/** how many times what he pays for a thing he asks for it */
const MARKUP = 3;

/** what he pays for a thing as it is (a stack: for all of it). 0: he will not take it. */
export function pays(item: ItemInstance): number {
  const each = worth(item.id);
  if (!each) return 0;
  const n = ITEMS[item.id].stack ? Math.max(1, item.qty ?? 1) : 1;
  // (a gun is paid for with what is fitted to it and what is in it, and a magazine with its rounds: nothing is lost by not stripping it first)
  const def = ITEMS[item.id];
  const fitted = fittedOf(item).reduce((sum, mod) => sum + worth(mod), 0);
  const rounds = def.weapon ? (item.loaded ?? 0) * worth(def.weapon.ammo) : def.mag ? (item.rounds ?? 0) * worth(def.mag.ammo) : 0;
  return Math.max(1, Math.round(each * n + fitted + rounds));
}

/** how many of a thing he hands over at a time: a full pile of what is piled (rounds), one of what is found one at a time (a bandage) */
export function sold(id: string): number {
  const def = ITEMS[id];
  return def?.fresh ?? def?.stack ?? 1;
}

/** what he asks for a thing he sells (a thing that stacks is sold as a full stack: see `sold`) */
export function asks(id: string): number {
  const def = ITEMS[id];
  if (!def || !worth(id) || !STOCK.includes(id)) return 0;
  return Math.round(worth(id) * sold(id) * MARKUP);
}
