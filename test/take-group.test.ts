// Which button takes what from a crate (idea 10, src/ui/inv-take.ts): rounds and magazines under Ammo, drink with
// food, and a gun under none.
//   npx tsx test/take-group.test.ts

import assert from 'node:assert/strict';
import { makeItem } from '../src/sim/items';
import { TAKE_GROUPS, fitsGuns, inTakeGroup } from '../src/ui/inv-take';

{
  const kinds = (id: string) => TAKE_GROUPS.filter((g) => inTakeGroup(makeItem(id), g.id)).map((g) => g.id);
  assert.deepEqual(kinds('ammo_9mm'), ['ammo']);
  assert.deepEqual(kinds('mag_mpa'), ['ammo']);
  assert.deepEqual(kinds('bandage'), ['medical']);
  assert.deepEqual(kinds('ak'), []);
  console.log('  ok  rounds and magazines are ammo, a bandage medical, a gun none');
}
{
  // "Fits my guns" (idea 11): an AK's magazines and rounds, not a pistol's, a bandage or another gun
  const fits = (id: string) => fitsGuns(makeItem(id), ['ak']);
  assert.ok(fits('mag_ak') && fits('drum_ak') && fits('ammo_739'));
  assert.ok(!fits('mag_mpa') && !fits('ammo_9mm') && !fits('bandage') && !fits('ak'));
  assert.ok(!fitsGuns(makeItem('ammo_739'), []));
  console.log('  ok  only what feeds a carried gun fits it');
}
console.log('take-group: ok');
