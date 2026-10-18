// The search box at the top of Carried (idea 5, 2026-10-18: typing "9mm" dims everything else, lit as the things
// that go with a chosen one are). A thing is found by the words of its name, its id ("ammo_9mm" is how "9mm" finds
// 9x19mm Rounds), its kind, and the rounds it takes or holds, so that "9mm" finds the guns and magazines for them too.
// Every word typed must begin one of those words: "ak" finds the AK-74 and not a snack.

import { ITEMS, itemName, type ItemInstance } from '../sim/items';

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** what is typed, as the words to find (none: nothing is being looked for) */
export const searchTerms = words;

/** @param kind the thing's kind in the words the inventory shows it under ("Medical", "Gun part") */
export function searchMatch(it: ItemInstance, terms: string[], kind = ''): boolean {
  if (!terms.length) return true;
  const d = ITEMS[it.id];
  const rounds = d.weapon?.ammo ?? d.mag?.ammo ?? d.open?.gives;
  const own = words([itemName(it), it.id, d.category, kind, rounds ?? '', rounds ? ITEMS[rounds]?.name ?? '' : ''].join(' '));
  return terms.every((t) => own.some((w) => w.startsWith(t)));
}
