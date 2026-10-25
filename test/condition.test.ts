// How worn clothes are (src/sim/condition.ts): a hit wears what covers where it lands, a ruined piece does nothing it
// did, the name says the colour and the state, the server keeps both, and a piece is cut into bandages.
import assert from 'node:assert/strict';
import { PlayerInventory, cleanItem } from '../src/sim/inventory';
import { itemName, makeItem } from '../src/sim/items';
import { bandagesFrom, cuttable, stateOf, wearOut } from '../src/sim/condition';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

ok('a hit in the body wears the vest and the top over it, and nothing on the legs; a hundred of damage ruins a piece', () => {
  const inv = new PlayerInventory();
  inv.slots.vest = makeItem('soft_vest');
  const top = inv.slots.top!, legs = inv.slots.legs!;
  assert.deepEqual(wearOut(inv.slots, 'torso', 40), []);
  assert.deepEqual([top.hp, inv.slots.vest.hp, legs.hp], [0.6, 0.6, undefined]);
  assert.equal(stateOf(top), 'Worn');
  assert.deepEqual(wearOut(inv.slots, 'torso', 60), [inv.slots.vest, top]);
  assert.equal(stateOf(top), 'Ruined');
});

ok('a ruined vest stops nothing it stopped', () => {
  const inv = new PlayerInventory();
  inv.slots.vest = makeItem('soft_vest');
  assert.equal(inv.wear('armor').length, 1);
  inv.slots.vest.hp = 0;
  assert.deepEqual(inv.wear('armor'), []);
});

ok('clothes are called by their colour and, once worn, by how worn; the server keeps both', () => {
  const j = Object.assign(makeItem('field_jacket'), { c: 2 });
  assert.equal(itemName(j), 'Field Jacket (Woodland)');
  j.hp = 0.45;
  assert.equal(itemName(j), 'Field Jacket (Woodland, damaged)');
  const kept = cleanItem(JSON.parse(JSON.stringify(j)), String)!;
  assert.deepEqual([kept.c, kept.hp], [2, 0.45]);
  // (a colour it has not, or a health past new, is not kept)
  const bad = cleanItem({ ...j, c: 9, hp: 3 }, String)!;
  assert.deepEqual([bad.c, bad.hp], [undefined, undefined]);
});

ok('a piece with nothing in it is cut into a bandage for every two cells, half as many when ruined', () => {
  const j = makeItem('field_jacket');
  assert.ok(cuttable(j));
  assert.equal(bandagesFrom(j), 4);
  j.hp = 0;
  assert.equal(bandagesFrom(j), 2);
  j.cargo = [{ item: makeItem('beans'), x: 0, y: 0, rot: false }];
  assert.ok(!cuttable(j), 'a jacket with things in its pockets was cut up');
});

console.log(`${n} checks passed`);
