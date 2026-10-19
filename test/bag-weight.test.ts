// What a grid's things weigh, as its head says (idea 6, gridWeight in src/ui/inv-piles.ts): every pile by
// its count, a loaded magazine with its rounds, and a case in it (as in a crate) with all that is in the case.
//   npx tsx test/bag-weight.test.ts

import assert from 'node:assert/strict';
import { Container } from '../src/sim/inventory';
import { gridWeight } from '../src/ui/inv-piles';
import { ITEMS, itemWeight, makeItem } from '../src/sim/items';

const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} kg, not ${b}`);

{
  const c = new Container('t', 'Test', 9, 7, [], true);
  near(gridWeight(c), 0, 'an empty grid');
  const rounds = makeItem('ammo_9mm', 20), mag = makeItem('mag_mpa');
  mag.rounds = 10;
  for (const it of [rounds, mag, makeItem('bandage')]) assert.equal(c.add(it), null);
  near(gridWeight(c), 20 * ITEMS.ammo_9mm.weight + ITEMS.mag_mpa.weight + 10 * ITEMS.ammo_9mm.weight + ITEMS.bandage.weight, 'rounds, a magazine and a bandage');
  const was = gridWeight(c);
  const kit = makeItem('stash_kit'), inner = new Container('k', 'Case', 8, 6, (kit.cargo = []), true);
  assert.equal(inner.add(makeItem('ak')), null);
  assert.equal(c.add(kit), null);
  near(gridWeight(c), was + itemWeight(kit), 'with a case in it');
  assert.ok(itemWeight(kit) > ITEMS.stash_kit.weight, 'the case weighed nothing of what is in it');
  console.log('  ok  a grid weighs its things, a case in it with its own');
}
console.log('bag-weight: ok');
