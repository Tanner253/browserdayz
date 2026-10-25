// A survivor's gear taken back off their own body at one press (the owner, 2026-10-25: "when you return to the place
// where you died, you can return the inventory at the push of a button ... button on corpse small that auto takes
// everything and fills all equipment and back slots from the body"). The server does it (server/handle.ts 'reclaim')
// and the game is told what it carries after. Where each thing goes is the inventory's own: a free place of its kind
// (`freeSlotFor`), else room in what is worn (`add`). No place is named here, so whatever places there are, are filled.

import { ALL_SLOTS, ITEMS, SLOT_KIND, type ItemInstance, type Slot } from './items';
import type { Container, PlayerInventory } from './inventory';

/** the places a thing is worn or slung in, of its kind (none: it is carried in a pocket or a pack) */
const placesOf = (it: ItemInstance): Slot[] => ALL_SLOTS.filter((s) => SLOT_KIND[s] === ITEMS[it.id]?.slot);

/**
 * What lies on the body goes back onto the survivor as it was. What was worn and slung goes back into its place;
 * where that place has something in it now (the clothes they came back in, a gun found since), the two change
 * places: the body's goes on, and the other lies on the body where it lay, after what was in it has gone into the
 * pockets now on, as far as there is room. Everything else goes wherever it fits. What finds no room stays on the body.
 * The hands are not touched.
 * @returns what came off the body (with what is in it), and what was put on it in its place
 */
export function reclaim(inv: PlayerInventory, body: Container): { took: ItemInstance[]; put: ItemInstance[] } {
  const took: ItemInstance[] = [], put: ItemInstance[] = [];
  // (what is worn first, so that its pockets are there for the rest)
  for (const it of body.items.map((p) => p.item)) {
    const places = placesOf(it);
    if (!places.length) continue;
    const at = body.items.find((p) => p.item === it)!;
    body.remove(it);
    const free = inv.freeSlotFor(it);
    if (free) {
      inv.slots[free] = it;
      took.push(it);
      continue;
    }
    const was = inv.slots[places[0]]!;
    if (body.add(was)) {
      body.restore(it, at.x, at.y, at.rot);
      continue;
    }
    inv.slots[places[0]] = it;
    took.push(it);
    put.push(was);
  }
  for (const it of body.items.map((p) => p.item)) {
    if (put.includes(it)) continue;
    const at = body.items.find((p) => p.item === it)!;
    body.remove(it);
    // (a pile may go in part, onto the piles of its kind: what is left of it lies where it lay)
    const left = inv.add(it);
    if (left) body.restore(left, at.x, at.y, at.rot);
    if (left !== it) took.push(it);
  }
  for (const was of put) {
    if (!was.cargo) continue;
    for (const p of [...was.cargo]) {
      was.cargo.splice(was.cargo.indexOf(p), 1);
      const left = inv.add(p.item);
      if (left) was.cargo.push({ ...p, item: left });
    }
  }
  inv.autoBind();
  return { took, put };
}
