// The inventory's tidying (Fettah's inventory pull request, a contributor's, 2026-10-18): a grid sorted kind by
// kind, piles of one thing joined, a bag's weight, and which things feed one another. Kept with the screen, the only
// thing that uses them, and not in src/sim, which the game server loads too.

import { Container, bagGrid, poured, type PlayerInventory } from '../sim/inventory';
import { ITEMS, itemWeight, magFits, type ItemInstance, type Placed } from '../sim/items';

/** the order kinds stand in once a grid is sorted: guns and what feeds them first, the rest after */
const SORT_ORDER = ['weapon', 'melee', 'magazine', 'ammo', 'attachment', 'explosive', 'medical', 'food', 'drink', 'tool', 'clothing', 'stash', 'misc'];
const sortRank = (id: string) => {
  const i = SORT_ORDER.indexOf(ITEMS[id]?.throw ? 'explosive' : ITEMS[id]?.category ?? 'misc');
  return i < 0 ? SORT_ORDER.length : i;
};

/**
 * A grid packed afresh, kind by kind (the sort button on a bag): guns, then what feeds them, then the rest, the
 * bigger of a kind first, each in the first place it fits. If that leaves anything without room the bigger things go
 * first whatever their kind; and if that does too, nothing is moved.
 * @param apply false: only asks whether sorting would move anything, and leaves the grid as it was (the button is
 *   shown only then: "if the box is already sorted, so we don't show it")
 * @returns whether anything moved (or would)
 */
export function sortGrid(c: Container, apply = true): boolean {
  const was = c.items.map((p) => ({ ...p }));
  const area = (p: Placed) => ITEMS[p.item.id].w * ITEMS[p.item.id].h;
  const byKind = (a: Placed, b: Placed) => sortRank(a.item.id) - sortRank(b.item.id) || area(b) - area(a) || a.item.id.localeCompare(b.item.id) || (b.item.qty ?? 0) - (a.item.qty ?? 0);
  const bySize = (a: Placed, b: Placed) => area(b) - area(a) || byKind(a, b);
  for (const order of [byKind, bySize]) {
    c.items.length = 0;
    const all = [...was].sort(order).every((p) => {
      const at = c.findSpace(p.item);
      if (at) c.items.push({ item: p.item, ...at });
      return !!at;
    });
    if (!all) continue;
    const moved = c.items.some((p) => { const o = was.find((q) => q.item === p.item)!; return o.x !== p.x || o.y !== p.y || o.rot !== p.rot; });
    if (apply) return moved;
    c.items.length = 0;
    c.items.push(...was);
    return moved;
  }
  c.items.length = 0;
  c.items.push(...was);
  return false;
}

/**
 * Everything carried sorted at once (Sort all, the owner, 2026-10-23: "a sort button for all inventories would be a
 * nice addition instead of just per contianer"): piles of a kind joined across every bag, each kind into the bag set
 * for it (`wants`), the rest into the bags set for nothing, then wherever there is room; each bag packed kind by kind.
 * The biggest things are found room first, each in the bags it would go to, so that a gun only one bag can hold is
 * not left out by rounds spread through it. If that leaves anything without room, every bag is put back as it was
 * and sorted by itself instead.
 * @returns whether anything moved
 */
export function sortAll(inv: PlayerInventory, wants: (c: Container, item: ItemInstance) => boolean, typed: (c: Container) => boolean): boolean {
  const bags = inv.containers.filter((c) => c !== inv.tags && c !== inv.theHold);
  // (a bag set for a kind takes other things only once the bags set for nothing are full)
  const loose = bags.filter((c) => !typed(c));
  const was = bags.map((c) => c.items.map((p) => ({ ...p, qty: p.item.qty })));
  const ids = new Set(bags.flatMap((c) => c.items.map((p) => p.item.id)).filter((id) => ITEMS[id]?.stack));
  for (const id of ids) combinePiles(bags, id);
  const area = (it: ItemInstance) => ITEMS[it.id].w * ITEMS[it.id].h;
  const things = bags.flatMap((c) => c.items.map((p) => p.item));
  const hasBag = (it: ItemInstance) => bags.some((c) => wants(c, it));
  const kinds = (a: ItemInstance, b: ItemInstance) => sortRank(a.id) - sortRank(b.id) || a.id.localeCompare(b.id) || b.qty - a.qty;
  const orders = [(a: ItemInstance, b: ItemInstance) => area(b) - area(a) || Number(hasBag(b)) - Number(hasBag(a)) || kinds(a, b), (a: ItemInstance, b: ItemInstance) => Number(hasBag(b)) - Number(hasBag(a)) || area(b) - area(a) || kinds(a, b)];
  for (const order of orders) {
    for (const c of bags) c.items.length = 0;
    const placed = [...things].sort(order).every((it) => {
      for (const c of [...bags.filter((c) => wants(c, it)), ...loose, ...bags]) {
        if (!c.accepts(it)) continue;
        const at = c.findSpace(it);
        if (at) {
          c.items.push({ item: it, ...at });
          return true;
        }
      }
      return false;
    });
    if (!placed) continue;
    // (each bag then laid out kind by kind, as its own sort button does)
    for (const c of bags) sortGrid(c);
    return bags.some((c, i) => c.items.length !== was[i].length || c.items.some((p) => { const o = was[i].find((q) => q.item === p.item); return !o || o.x !== p.x || o.y !== p.y || o.rot !== p.rot || o.qty !== p.item.qty; }));
  }
  // (no room for all of it packed this way: as it was, piles too, and each bag sorted by itself)
  bags.forEach((c, i) => {
    c.items.length = 0;
    for (const p of was[i]) {
      p.item.qty = p.qty;
      c.items.push({ item: p.item, x: p.x, y: p.y, rot: p.rot });
    }
  });
  return bags.map((c) => sortGrid(c)).some(Boolean);
}

const SORTS = new WeakMap<Container, { as: string; would: boolean }>();

/** would sorting this grid move anything (`sortGrid` asked, and its answer kept until what is in the grid moves: it was asked of every bag on every redraw) */
export function wouldSort(c: Container): boolean {
  const as = c.items.map((p) => `${p.item.uid}:${p.x},${p.y},${p.rot ? 1 : 0},${p.item.qty}`).join('|');
  const kept = SORTS.get(c);
  if (kept?.as === as) return kept.would;
  const would = sortGrid(c, false);
  SORTS.set(c, { as, would });
  return would;
}

/** what is in a grid weighs, a bag in it with all that is in that */
export const gridWeight = (c: Container) => c.items.reduce((s, p) => s + itemWeight(p.item), 0);

/**
 * Every grid of what is carried in the order piles are joined in (`combinePiles`): what is worn, as `containers` has
 * it, then the inside of every bag lying in those (not the tag pouch: tags are no pile).
 */
export function pileGrids(inv: PlayerInventory): Container[] {
  const worn = inv.containers.filter((c) => c !== inv.tags);
  const inner = worn.flatMap((c) => c.items.map((p) => bagGrid(p.item)).filter((g): g is Container => !!g));
  return [...worn, ...inner];
}

/** One pile topped up from another: what Combine all did, for the screen to show it. */
export interface PileMove { from: ItemInstance; to: ItemInstance; n: number }

/**
 * Every pile of one thing in these grids made into as few as hold it (Combine all). The first piles are topped up
 * from the last, so what is worn fills before the bags carried inside it ("start filling the stacks ... in his main
 * containers before the sub containers"). A pile emptied is taken out of its grid. Nothing is made or lost.
 */
export function combinePiles(grids: Container[], id: string): PileMove[] {
  const cap = ITEMS[id]?.stack ?? 1, moves: PileMove[] = [];
  const piles = grids.flatMap((c) => c.items.filter((p) => p.item.id === id).map((p) => ({ c, item: p.item })));
  let i = 0, j = piles.length - 1;
  while (i < j) {
    const to = piles[i].item, from = piles[j].item;
    if (to.qty >= cap) { i++; continue; }
    const n = Math.min(cap - to.qty, from.qty);
    to.qty += n;
    from.qty -= n;
    if (n > 0) moves.push({ from, to, n });
    if (from.qty <= 0) { piles[j].c.remove(from); poured.set(from, to); j--; }
  }
  return moves;
}

/** The rounds a thing is, loose or sealed in their box (null for anything else). */
function roundsOf(id: string): string | null {
  const d = ITEMS[id];
  if (d?.open) return ITEMS[d.open.gives]?.category === 'ammo' ? d.open.gives : null;
  return d?.category === 'ammo' ? id : null;
}

/**
 * Do these two feed one another: a gun and the rounds it fires or a magazine it takes, or a magazine and its rounds?
 * Either way round. (What the inventory lights up beside a chosen thing.)
 */
export function goesWith(a: string, b: string): boolean {
  const one = (x: string, y: string) => {
    const d = ITEMS[x];
    if (d?.weapon) return ITEMS[y]?.mag ? magFits(y, x) : roundsOf(y) === d.weapon.ammo;
    if (d?.mag) return roundsOf(y) === d.mag.ammo;
    return false;
  };
  return a !== b && (one(a, b) || one(b, a));
}
