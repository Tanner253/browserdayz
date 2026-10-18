// Furniture that holds the loot of its own places (src/sim/storage.ts): what is in it, as the server tells whoever
// opens it, and what they changed. The things the economy put inside stay the economy's (their counts, lifetime and
// restock are its own), and are shown in the piece where they lie; what a player leaves in it is the piece's (`items`).
//
// A thing of the economy's taken out is taken as if from the ground (economy.take: the place rests, then is stocked
// again). Where each sits in the grid is kept (`layout`) so that it is where it was left the next time it is opened.

import { Container } from '../src/sim/inventory';
import type { StoredItem } from '../src/net/protocol';
import type { ItemInstance } from '../src/sim/items';
import { economy, world, type Box } from './index';

/** the economy's things inside a piece, by its id */
function insideOf(cid: string) {
  const out: ReturnType<typeof economy.loot.get>[] = [];
  for (const l of economy.loot.values()) if (l.point >= 0 && world.lootPoints[l.point]?.inside === cid) out.push(l);
  return out.filter((l): l is NonNullable<typeof l> => !!l);
}

/** whether what the economy puts at this place is in a piece of furniture, and not drawn */
export const hidden = (point: number) => point >= 0 && !!world.lootPoints[point]?.inside;

/** what is in a piece, as its grid shows it: what was left in it, and the economy's things where each was last put (or wherever there is room) */
export function contents(b: Box): StoredItem[] {
  const c = new Container(b.cid, 'furniture', b.w, b.h, [], true);
  // (each where it was, or wherever there is room; never merged into another's stack, which would lose whose it was)
  const put = (it: ItemInstance, at?: [number, number, boolean]) => {
    if (at && c.place(it, at[0], at[1], at[2])) return;
    const s = c.findSpace(it);
    if (s) c.place(it, s.x, s.y, s.rot);
  };
  for (const it of b.items) put(it, [it.x, it.y, !!it.rot]);
  const layout = (b.layout ??= {});
  for (const l of insideOf(b.cid)) put(l.item, layout[l.uid]);
  return c.serialize().items;
}

/**
 * What the one who has it open says is in it now. The economy's things that are no longer in it were taken (out to
 * their pockets, or onto the ground: each of those is said by its own message); those still in it keep their places;
 * everything else is theirs, left in the piece.
 */
export function changed(b: Box, items: StoredItem[]) {
  const inside = new Map(insideOf(b.cid).map((l) => [l.uid, l]));
  const now = new Set(items.map((it) => it.uid));
  for (const uid of inside.keys()) if (!now.has(uid)) economy.take(uid);
  const layout: Record<string, [number, number, boolean]> = {};
  b.items = [];
  for (const it of items) {
    if (inside.has(it.uid)) layout[it.uid] = [it.x, it.y, !!it.rot];
    else b.items.push(it);
  }
  b.layout = layout;
}
