// A bag set for a kind of thing (2026-10-23, the owner: "people want to be able to assign their containers as a "Type"
// like ammo or food or medical etc so those items automatically go there", and "make it simple"). What is worn that
// has room (a jacket, trousers, a vest, a pack) is set For one kind, or for anything; whatever of that kind is taken,
// bought or sorted goes into it first (PlayerInventory.prefer). It is kept on the bag itself (`for`, BAG_KINDS in
// src/sim/items.ts), which the server keeps with everything carried: the same after a restart, on another device, and
// on a bag dropped and picked up again. (It was kept in the browser for the first day: see `fromBrowser`.)

import type { Container } from '../sim/inventory';
import { BAG_KINDS, ITEMS, isBagKind, type BagKind, type ItemInstance } from '../sim/items';
import './inv-qol.css';

export type BagFor = BagKind;

/** the kinds, in the order they are offered */
export const BAG_FOR: { id: BagFor; label: string }[] = [
  { id: 'ammo', label: 'Ammo' },
  { id: 'food', label: 'Food' },
  { id: 'medical', label: 'Medical' },
  { id: 'parts', label: 'Gun parts' },
  { id: 'tools', label: 'Tools' },
];

/** what the first day's build kept in this browser, by the bag's number: put on the bag the first time it is asked of, then forgotten */
const OLD = 'zona.bagFor';
function fromBrowser(bag: ItemInstance) {
  try {
    const kept = JSON.parse(localStorage.getItem(OLD) ?? 'null') as Record<string, string> | null;
    if (!kept || !(bag.uid in kept)) return;
    if (bag.for === undefined && isBagKind(kept[bag.uid])) bag.for = kept[bag.uid] as BagKind;
    delete kept[bag.uid];
    if (Object.keys(kept).length) localStorage.setItem(OLD, JSON.stringify(kept));
    else localStorage.removeItem(OLD);
  } catch {
    // (no storage: nothing was kept there either)
  }
}

export function bagFor(c: Container): BagFor | null {
  if (!c.bag) return null;
  fromBrowser(c.bag);
  return c.bag.for ?? null;
}

/** set on the bag itself (the caller tells the game its pockets changed, and so the server) */
export function setBagFor(c: Container, kind: BagFor | null) {
  if (!c.bag) return;
  if (kind) c.bag.for = kind;
  else delete c.bag.for;
}

/** would this thing rather go in this grid: it is set for the thing's kind (PlayerInventory.prefer) */
export function wants(c: Container, item: ItemInstance): boolean {
  const kind = bagFor(c);
  return !!kind && (BAG_KINDS[kind] as readonly string[]).includes(ITEMS[item.id]?.category ?? '');
}

/** can this grid be set for a kind (it is the inside of something worn) */
export const typable = (c: Container) => !!c.bag;
