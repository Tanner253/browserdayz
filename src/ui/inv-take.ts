// The buttons over a crate or a body (idea 10, 2026-10-18): "Take all", and one for each kind of thing worth
// sweeping up in one press. Which kind a thing is in is decided here.

import { ITEMS, goesWith, type ItemInstance } from '../sim/items';

export type TakeGroup = 'ammo' | 'medical' | 'food';

/** the buttons, in order, with the categories (src/sim/items.ts) each one takes: magazines go with rounds, drink with food */
export const TAKE_GROUPS: { id: TakeGroup; label: string; of: string[] }[] = [
  { id: 'ammo', label: 'Ammo', of: ['ammo', 'magazine'] },
  { id: 'medical', label: 'Medical', of: ['medical'] },
  { id: 'food', label: 'Food', of: ['food', 'drink'] },
];

export const inTakeGroup = (it: ItemInstance, g: TakeGroup): boolean => TAKE_GROUPS.find((t) => t.id === g)!.of.includes(ITEMS[it.id].category);

/** "Only what fits my guns" (idea 11): rounds, boxes of them and magazines that feed one of these guns, by the rule that lights them beside a chosen gun (`goesWith`) */
export const fitsGuns = (it: ItemInstance, guns: string[]): boolean => guns.some((g) => goesWith(g, it.id));
