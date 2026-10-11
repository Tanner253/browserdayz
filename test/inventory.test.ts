// Checks of the grids things are carried in (src/sim/inventory.ts): piles, two things changing places, a pile
// halved. No network: `npx tsx test/inventory.test.ts`.

import assert from 'node:assert/strict';
import { ITEMS, makeItem } from '../src/sim/items';
import { Container, PlayerInventory, splitPile, swapPlaces } from '../src/sim/inventory';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};
const at = (c: Container, it: unknown) => c.items.find((p) => p.item === it)!;

ok('bandages are carried five to a place and stims three, and each is found, given and made one at a time', () => {
  assert.equal(ITEMS.bandage.stack, 5);
  assert.equal(ITEMS.stim.stack, 3);
  assert.equal(makeItem('bandage').qty, 1);
  assert.equal(makeItem('stim').qty, 1);
  const inv = new PlayerInventory();
  for (let i = 0; i < 7; i++) assert.equal(inv.add(makeItem('bandage')), null);
  for (let i = 0; i < 4; i++) assert.equal(inv.add(makeItem('stim')), null);
  const piles = (id: string) => inv.containers.flatMap((c) => c.items).filter((p) => p.item.id === id).map((p) => p.item.qty);
  assert.deepEqual(piles('bandage'), [5, 2]);
  assert.deepEqual(piles('stim'), [3, 1]);
  // (rounds are still made six tenths of a pile, where nothing says how many)
  assert.equal(makeItem('ammo_9mm').qty, Math.round(ITEMS.ammo_9mm.stack! * 0.6));
});

ok('two things in one grid change places when one is let go on the other', () => {
  const c = new Container('c', 'c', 4, 3);
  const a = makeItem('bandage'), b = makeItem('stim');
  c.place(a, 0, 0, false);
  c.place(b, 3, 2, false);
  assert.ok(swapPlaces(a, c, c, b, { x: 3, y: 2, rot: false }));
  assert.deepEqual([at(c, a).x, at(c, a).y, at(c, b).x, at(c, b).y], [3, 2, 0, 0]);
  assert.equal(c.items.length, 2);
});

ok('a tall thing and a small one change places only where the tall one has room; with none, nothing is moved', () => {
  const c = new Container('c', 'c', 2, 2);
  const tall = makeItem('beans'), small = makeItem('bandage'), other = makeItem('stim');
  assert.deepEqual([ITEMS.beans.w, ITEMS.beans.h], [1, 2]);
  c.place(tall, 0, 0, false);
  c.place(small, 1, 0, false);
  // (the cell under the small one is free: the tall one goes where it lay, and the small one where the tall one was)
  assert.ok(swapPlaces(tall, c, c, small, { x: 1, y: 0, rot: false }));
  assert.deepEqual([at(c, tall).x, at(c, tall).y, at(c, small).x, at(c, small).y], [1, 0, 0, 0]);
  // (now a third thing lies under the small one: the tall one has no room there, either way up)
  const d = new Container('d', 'd', 2, 2);
  d.place(tall, 0, 0, false);
  d.place(small, 1, 0, false);
  d.place(other, 1, 1, false);
  const was = JSON.stringify(d.items.map((p) => [p.item.uid, p.x, p.y, p.rot]));
  assert.ok(!swapPlaces(tall, d, d, small, { x: 1, y: 0, rot: false }));
  assert.equal(JSON.stringify(d.items.map((p) => [p.item.uid, p.x, p.y, p.rot])), was, 'something was moved by a swap that could not be made');
});

ok('things change places between two grids, and a thing off the ground takes the place of one that is handed back', () => {
  const pocket = new Container('p', 'p', 2, 1), crate = new Container('k', 'k', 2, 2);
  const a = makeItem('bandage'), b = makeItem('stim');
  pocket.place(a, 0, 0, false);
  crate.place(b, 1, 1, false);
  assert.ok(swapPlaces(a, pocket, crate, b, { x: 1, y: 1, rot: false }));
  assert.ok(crate.has(a) && pocket.has(b) && !crate.has(b) && !pocket.has(a));
  // (off the ground: it is in no grid, and what it is let go on comes out of its grid)
  const g = makeItem('splint');
  assert.ok(swapPlaces(g, null, crate, a, { x: 1, y: 1, rot: false }));
  assert.ok(crate.has(g) && !crate.has(a));
  // (the pouch for dog tags takes nothing else: no swap into it)
  const tags = Object.assign(new Container('tags', 'tags', 2, 1), { only: 'dogtag' });
  const tag = makeItem('dogtag');
  tags.place(tag, 0, 0, false);
  assert.ok(!swapPlaces(b, pocket, tags, tag, { x: 0, y: 0, rot: false }));
  assert.ok(tags.has(tag) && pocket.has(b));
});

ok('a pile is halved, the smaller half laid beside it as a thing of its own; with no room, or one left, it is not', () => {
  const c = new Container('c', 'c', 2, 1);
  const five = makeItem('bandage', 5);
  c.place(five, 0, 0, false);
  const half = splitPile(c, five, makeItem)!;
  assert.ok(half && half.uid !== five.uid && half.id === 'bandage');
  assert.deepEqual([five.qty, half.qty], [3, 2]);
  assert.deepEqual([at(c, half).x, at(c, half).y], [1, 0]);
  // (the grid is full now)
  assert.equal(splitPile(c, five, makeItem), null);
  assert.equal(five.qty, 3);
  const one = makeItem('stim', 1), d = new Container('d', 'd', 2, 1);
  d.place(one, 0, 0, false);
  assert.equal(splitPile(d, one, makeItem), null);
  // (and a thing that is not piled is not halved)
  const tin = makeItem('beans'), e = new Container('e', 'e', 2, 2);
  e.place(tin, 0, 0, false);
  assert.equal(splitPile(e, tin, makeItem), null);
});

console.log(`\n${n} checks passed`);
