// A bag set for a kind of thing (2026-10-23, the owner: "people want to be able to assign their containers as a "Type"
// like ammo or food or medical etc so those items automatically go there", and "make it simple"). What is worn that
// has room (a jacket, trousers, a vest, a pack) is set For one kind, or for anything; whatever of that kind is taken,
// bought or sorted goes into it first (PlayerInventory.prefer). Kept in this browser by the bag's own number until the
// server keeps it with the bag itself.

import type { Container } from '../sim/inventory';
import { ITEMS, type ItemInstance } from '../sim/items';
import './inv-qol.css';

export type BagFor = 'ammo' | 'food' | 'medical' | 'parts' | 'tools';

/** the kinds, in the order they are offered, each with the item categories it takes */
export const BAG_FOR: { id: BagFor; label: string; cats: string[] }[] = [
  { id: 'ammo', label: 'Ammo', cats: ['ammo', 'magazine'] },
  { id: 'food', label: 'Food', cats: ['food', 'drink'] },
  { id: 'medical', label: 'Medical', cats: ['medical'] },
  { id: 'parts', label: 'Gun parts', cats: ['attachment'] },
  { id: 'tools', label: 'Tools', cats: ['tool', 'misc'] },
];

const KEY = 'zona.bagFor';
let set: Record<string, BagFor> = {};
try {
  set = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
} catch {
  set = {};
}

/** the worn thing a grid is the inside of (`gear:<uid>`), or null for any other grid */
const bagUid = (c: Container) => (c.id.startsWith('gear:') ? c.id.slice(5) : null);

export function bagFor(c: Container): BagFor | null {
  const uid = bagUid(c);
  return uid ? set[uid] ?? null : null;
}

export function setBagFor(c: Container, kind: BagFor | null) {
  const uid = bagUid(c);
  if (!uid) return;
  if (kind) set[uid] = kind;
  else delete set[uid];
  try {
    localStorage.setItem(KEY, JSON.stringify(set));
  } catch {
    // (no storage, a private window: it holds until the page is left)
  }
}

/** would this thing rather go in this grid: it is set for the thing's kind (PlayerInventory.prefer) */
export function wants(c: Container, item: ItemInstance): boolean {
  const kind = bagFor(c);
  return !!kind && BAG_FOR.find((k) => k.id === kind)!.cats.includes(ITEMS[item.id]?.category ?? '');
}

/** can this grid be set for a kind (it is the inside of something worn) */
export const typable = (c: Container) => !!bagUid(c);
