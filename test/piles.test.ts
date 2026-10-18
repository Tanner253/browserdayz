// Combine all (combinePiles in src/sim/inventory.ts): every pile of a thing made into as few as hold it, the
// first grids filled first, nothing made or lost, emptied piles taken out, other things left alone.
//   npx tsx test/piles.test.ts

import assert from 'node:assert/strict';
import { Container, combinePiles } from '../src/sim/inventory';
import { makeItem } from '../src/sim/items';

const pile = (c: Container, id: string, n: number) => {
  const it = makeItem(id, n);
  assert.ok(c.place(it, ...(c.findSpace(it) ? [c.findSpace(it)!.x, c.findSpace(it)!.y, c.findSpace(it)!.rot] as const : [0, 0, false] as const)));
  return it;
};
const count = (cs: Container[], id: string) => cs.flatMap((c) => c.items).filter((p) => p.item.id === id);

{
  const worn = new Container('a', 'Jacket', 5, 5), inner = new Container('b', 'Bag', 4, 4);
  pile(worn, 'ammo_9mm', 7);
  pile(inner, 'ammo_9mm', 20);
  pile(worn, 'ammo_9mm', 12);
  pile(inner, 'ammo_9mm', 5);
  const tin = pile(worn, 'beans', 1);
  const moves = combinePiles([worn, inner], 'ammo_9mm');
  const left = count([worn, inner], 'ammo_9mm');
  assert.equal(left.reduce((n, p) => n + p.item.qty, 0), 44, 'rounds were made or lost');
  assert.equal(left.length, 2, `${left.length} piles left of 44 rounds (30 a pile)`);
  assert.deepEqual(count([worn], 'ammo_9mm').map((p) => p.item.qty).sort((a, b) => b - a), [30, 14], 'the jacket was not filled first');
  assert.equal(count([inner], 'ammo_9mm').length, 0, 'piles were left in the bag inside');
  assert.ok(worn.has(tin), 'something else was moved');
  assert.ok(moves.every((m) => m.n > 0), 'a move of nothing');
  console.log(`  ok  four piles of 9 mm become 30 and 14, both in the jacket, in ${moves.length} moves`);
}

{
  const c = new Container('a', 'Jacket', 5, 5);
  pile(c, 'bandage', 5);
  pile(c, 'bandage', 5);
  assert.deepEqual(combinePiles([c], 'bandage'), [], 'full piles were moved');
  console.log('  ok  full piles are left as they are');
}
console.log('piles: ok');
