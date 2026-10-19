// A grid sorted by its button (sortGrid in src/ui/inv-piles.ts): everything still in it, nothing over
// another, kinds in their order where there is room for that, and nothing moved where there is no room to sort.
//   npx tsx test/sort.test.ts

import assert from 'node:assert/strict';
import { Container } from '../src/sim/inventory';
import { sortGrid } from '../src/ui/inv-piles';
import { ITEMS, makeItem } from '../src/sim/items';

const sound = (c: Container) => {
  for (const [i, p] of c.items.entries()) {
    assert.ok(c.free(p.item, p.x, p.y, p.rot, p.item), `${p.item.id} is off the grid or under another`);
    for (const q of c.items.slice(i + 1)) assert.notEqual(p.item, q.item);
  }
};

// a jumble, as a pocket is after a fight: it comes out whole, guns first and food last
{
  const c = new Container('t', 'Test', 9, 7);
  const ids = ['beans', 'ammo_9mm', 'mpa', 'bandage', 'mag_mpa', 'apple', 'box_9mm', 'mag_mpa', 'flask', 'colt'];
  for (const id of ids) assert.equal(c.add(makeItem(id, ITEMS[id].stack ? 5 : undefined)), null, `${id} did not go in`);
  const before = c.items.map((p) => p.item.uid).sort();
  const at = JSON.stringify(c.items.map((p) => [p.item.uid, p.x, p.y, p.rot]));
  assert.equal(sortGrid(c, false), true, 'a jumble was said to be sorted');
  assert.equal(JSON.stringify(c.items.map((p) => [p.item.uid, p.x, p.y, p.rot])), at, 'asking whether it would sort moved things');
  assert.equal(sortGrid(c), true, 'nothing moved');
  sound(c);
  assert.deepEqual(c.items.map((p) => p.item.uid).sort(), before, 'something was lost or made');
  const first = c.items.slice().sort((a, b) => a.y - b.y || a.x - b.x)[0];
  assert.equal(ITEMS[first.item.id].category, 'weapon', `the top left is ${first.item.id}, not a gun`);
  assert.equal(sortGrid(c, false), false, 'a sorted grid was said to need sorting (its button would show)');
  assert.equal(sortGrid(c), false, 'sorted twice, it moved again');
  console.log('  ok  a jumble comes out whole, guns first, and a second sort moves nothing');
}

// a grid packed so tight that no other order fits it all: nothing moves
{
  const c = new Container('t', 'Tight', 2, 2);
  for (let i = 0; i < 4; i++) assert.equal(c.add(makeItem('apple')), null);
  const was = JSON.stringify(c.items.map((p) => [p.x, p.y, p.rot]));
  sortGrid(c);
  sound(c);
  assert.equal(c.items.length, 4);
  console.log(`  ok  a full grid keeps all four (${was === JSON.stringify(c.items.map((p) => [p.x, p.y, p.rot])) ? 'unmoved' : 'reordered'})`);
}

// every kit's load, poured into one grid as big as a field rucksack, sorts without losing anything
{
  const c = new Container('t', 'Ruck', 9, 7);
  for (const id of ['ak', 'mag_ak', 'mag_ak', 'ammo_739', 'box_739', 'firstaid', 'stim', 'water_jug', 'sardines', 'grenade', 'compass']) c.add(makeItem(id));
  const n = c.items.length;
  sortGrid(c);
  sound(c);
  assert.equal(c.items.length, n);
  console.log(`  ok  a rucksack of ${n} things sorts whole`);
}
console.log('sort: ok');
