// Which button takes what from a crate (idea 10, src/ui/inv-take.ts): rounds and magazines under Ammo, drink with
// food, and a gun under none.
//   npx tsx test/take-group.test.ts

import assert from 'node:assert/strict';
import { makeItem } from '../src/sim/items';
import { TAKE_GROUPS, inTakeGroup } from '../src/ui/inv-take';

{
  const kinds = (id: string) => TAKE_GROUPS.filter((g) => inTakeGroup(makeItem(id), g.id)).map((g) => g.id);
  assert.deepEqual(kinds('ammo_9mm'), ['ammo']);
  assert.deepEqual(kinds('mag_mpa'), ['ammo']);
  assert.deepEqual(kinds('bandage'), ['medical']);
  assert.deepEqual(kinds('ak'), []);
  console.log('  ok  rounds and magazines are ammo, a bandage medical, a gun none');
}
console.log('take-group: ok');
