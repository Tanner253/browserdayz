// The kits an admin hands out (src/sim/kits.ts): every thing in one exists, every part fits the gun it is on,
// no magazine holds more than it can, and the whole of it goes on and away with nothing left over.
//   npx tsx test/kits.test.ts

import assert from 'node:assert/strict';
import { PlayerInventory } from '../src/sim/inventory';
import { ITEMS, makeItem } from '../src/sim/items';
import { KITS } from '../src/sim/kits';

for (const kit of KITS) {
  const inv = new PlayerInventory();
  const over: string[] = [];
  for (const th of kit.things) {
    const def = ITEMS[th.id];
    assert.ok(def, `${kit.id}: there is no ${th.id}`);
    assert.notEqual(th.id, 'dogtag', `${kit.id}: a kit has a dog tag in it`);
    if (th.qty !== undefined) assert.ok(def.stack && th.qty <= def.stack, `${kit.id}: ${th.qty} of ${th.id} is more than a pile holds`);
    if (th.rounds !== undefined) assert.ok(def.mag && th.rounds <= def.mag.capacity, `${kit.id}: ${th.rounds} rounds do not go in ${th.id}`);
    if (th.mag !== undefined) {
      const mag = ITEMS[th.mag];
      assert.ok(def.weapon && mag?.mag && mag.attach?.fits.includes(th.id), `${kit.id}: ${th.mag} does not fit ${th.id}`);
      assert.ok((th.loaded ?? 0) <= mag.mag.capacity + 1, `${kit.id}: ${th.id} is loaded with more than ${th.mag} and the chamber hold`);
      assert.equal(mag.mag.ammo, def.weapon.ammo, `${kit.id}: ${th.mag} is not of the rounds ${th.id} fires`);
    } else if (th.loaded !== undefined) assert.ok(def.weapon && th.loaded <= def.weapon.capacity + 1, `${kit.id}: ${th.id} is loaded with more than it holds`);
    const places = new Set<string>();
    for (const mod of th.mods ?? []) {
      const a = ITEMS[mod]?.attach;
      assert.ok(a && a.fits.includes(th.id), `${kit.id}: ${mod} does not fit ${th.id}`);
      assert.ok(!places.has(a.slot), `${kit.id}: ${th.id} has two things where ${mod} goes`);
      places.add(a.slot);
    }
    const it = makeItem(th.id, th.qty);
    if (inv.add(it)) over.push(th.id);
  }
  if (!kit.adds) assert.deepEqual(over, [], `${kit.id}: these found no room on a body that carried nothing: ${over.join(', ')}`);
  console.log(`  ok  ${kit.id}: ${kit.things.length} things, all of them real, fitted and carried`);
}
console.log(`\n${KITS.length} kits passed`);
