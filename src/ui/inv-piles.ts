// The inventory's tidying (Fettah's inventory pull request, a contributor's, 2026-10-18): a grid sorted kind by
// kind, piles of one thing joined, a bag's weight, and which things feed one another. Kept with the screen, the only
// thing that uses them, and not in src/sim, which the game server loads too.

import { Container, bagGrid, type PlayerInventory } from '../sim/inventory';
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
    if (from.qty <= 0) { piles[j].c.remove(from); j--; }
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
