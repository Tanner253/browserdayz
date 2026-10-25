// A base's boxes as the server keeps them (2026-10-24, base building's fourth step). Plan v2, approved: "Small box ·
// Large box: 12 planks, 8 nails · 25 planks, 20 nails; 6×5 and 10×8 squares; health 150 and 300; take a lock. Broken,
// they spill all they hold." Each is a box of the server's own (opened and filled as a crate is), kept with its base.

import { PIECES } from '../src/sim/build/pieces';
import { toWorld, type Base, type Piece } from '../src/sim/build/snap';
import type { StoredItem } from '../src/net/protocol';
import { LOOT_BAG } from '../src/sim/items/build';
import { newUid } from '../src/sim/items';
import { boxes, economy, stashItem, world, type Box } from './index';
import { bases } from './build';

const cidOf = (b: number, p: number) => `bbox:${b}:${p}`;

/** a box's store made (set down, or read back), with what was in it */
export function boxStore(b: Base, p: Piece, items: StoredItem[] = []) {
  const size = PIECES[p.k].store;
  if (!size) return;
  const [x, y, z] = toWorld(b, p.x, p.y, p.z);
  boxes.set(cidOf(b.id, p.id), { cid: cidOf(b.id, p.id), kind: 'bbox', w: size[0], h: size[1], items, x, y: y + 0.3, z, rot: 0, emptiedAt: -1 });
}

/** what is in a box (for the save; none: not a box) */
export const heldIn = (b: Base, p: Piece): StoredItem[] | undefined => (PIECES[p.k].store ? boxes.get(cidOf(b.id, p.id))?.items : undefined);

/** whether a box holds nothing (it is picked up only so) */
export const emptyBox = (b: number, p: number) => !boxes.get(cidOf(b, p))?.items.length;

/** pieces gone (taken down, broken, fallen): what was in any box among them lies on the ground where it stood */
export function spillBoxes(b: number, ids: number[]) {
  for (const p of ids) {
    const box = boxes.get(cidOf(b, p));
    if (!box) continue;
    boxes.delete(box.cid);
    bagged(box);
  }
}

/** a broken store's things in one bag where it stood, on the floor it stood on or whatever is under (Rust's loot bag: LOOT_BAG) */
export function bagged(box: Box) {
  if (!box.items.length) return;
  const bag = stashItem({ ...box, cid: newUid(), item: LOOT_BAG.id });
  economy.drop(bag, box.x, world.standAt(box.x, box.y + 0.3, box.z) + 0.03, box.z, box.rot);
}

/** after the bases are read back: each box's store made again with what was kept in it */
export function boxesBack() {
  for (const b of bases().bases.values()) {
    for (const p of b.pieces.values()) {
      if (!PIECES[p.k].store) continue;
      boxStore(b, p, (p.kept as StoredItem[] | undefined) ?? []);
      delete p.kept;
    }
  }
}
