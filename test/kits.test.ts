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

// A kit "replaces everything" a player carries, and leaves them a jacket and trousers (2026-10-13, when the two
// became things that can be taken off): new ones, with nothing of the old pockets in them. As kitUp in
// src/game/game.ts does it: the tags are kept, `clear`, and then each thing of the kit is put on or away.
for (const kit of [...KITS, { id: 'nothing', name: '', does: 'what /clear sends: a kit of nothing', things: [] }]) {
  for (const th of kit.things) assert.ok(!['top', 'legs'].includes(ITEMS[th.id].slot ?? ''), `${kit.id}: lists ${th.id}, which is worn where the jacket or the trousers are: whoever is given a kit has those on already, and it would be a spare in a pocket`);
  const inv = new PlayerInventory();
  const jacket = inv.slots.top!, trousers = inv.slots.legs!, tin = makeItem('beans'), tag = Object.assign(makeItem('dogtag'), { owner: 'Ann', pid: 'pid-ann' });
  inv.add(tin);
  inv.tags.add(tag);
  inv.slots.vest = makeItem('chest_rig');
  assert.equal(jacket.cargo![0].item, tin);
  if (!('adds' in kit && kit.adds)) {
    const pouch = inv.tags.items.map((q) => q.item);
    inv.clear();
    for (const t of pouch) inv.tags.add(t);
  }
  const over = kit.things.filter((th) => inv.add(makeItem(th.id, th.qty)));
  assert.equal(inv.slots.top?.id, 'field_jacket', `${kit.id}: left them with no jacket`);
  assert.equal(inv.slots.legs?.id, 'field_trousers', `${kit.id}: left them with no trousers`);
  assert.deepEqual(inv.tags.items.map((q) => q.item), [tag], `${kit.id}: the tags they had taken are gone`);
  if ('adds' in kit && kit.adds) {
    // (a bag of supplies: nothing is taken away, and what does not fit is theirs to pick up)
    assert.ok(inv.slots.top === jacket && inv.slots.legs === trousers && jacket.cargo!.some((p) => p.item === tin) && inv.slots.vest?.id === 'chest_rig', `${kit.id}: adds, and took something away`);
  } else {
    assert.deepEqual(over, [], `${kit.id}: these found no room`);
    assert.ok(inv.slots.top !== jacket && inv.slots.legs !== trousers, `${kit.id}: the jacket or the trousers that were on are still on`);
    assert.ok(!inv.find((it) => it === tin), `${kit.id}: what was in the old pockets is still carried`);
    if (!kit.things.length) assert.deepEqual([inv.jacket.items.length, inv.pants.items.length, inv.slots.vest], [0, 0, null]);
  }
  console.log(`  ok  ${kit.id}: whoever is given it stands in a jacket and trousers${'adds' in kit && kit.adds ? ', their own' : ', new ones, with nothing of what they carried'}`);
}
console.log(`\n${KITS.length} kits passed`);
