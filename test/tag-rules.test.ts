// Where a dog tag may be, and for how long (the owner, 2026-10-17): "dogtags should not be stashed in inventory",
// "a player should not have a dogtag object in their inventory until theyve been alive long enough", and "dogtags
// dropped on the ground should despawn after 10 mins". The containers and the economy; the server's side of the own tag
// (server/handle.ts 'me') is one line read beside it.
//   npx tsx test/tag-rules.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Economy } from '../src/sim/economy';
import { Container, PlayerInventory, bagGrid, layOnBody } from '../src/sim/inventory';
import { TAG_FRESH, TAG_GROUND, makeItem } from '../src/sim/items';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

ok('a dog tag goes in the pouch and on a body, and in nothing else that holds things', () => {
  const inv = new PlayerInventory();
  assert.equal(inv.tags.add(makeItem('dogtag')), null, 'the pouch did not take a tag');
  const crate = new Container('crate_1_1', 'Wooden Crate', 6, 3, [], true);
  assert.ok(crate.refusal(makeItem('dogtag')), 'a crate took a tag');
  const pack = makeItem('sack_pack');
  assert.ok(bagGrid(pack)!.refusal(makeItem('dogtag')), 'a pack took a tag');
  const body = new Container('corpse', 'Body', 8, 17, [], true);
  assert.deepEqual(layOnBody(body, [makeItem('dogtag'), makeItem('dogtag')]), [], 'a body did not take its tags');
  assert.equal(body.items.length, 2);
});

ok(`a dog tag on the ground is gone ${TAG_GROUND / 60} minutes on, with somebody standing by it`, () => {
  const e = new Economy([], { spawn: () => {}, despawn: () => {} });
  const tag = makeItem('dogtag'), tin = makeItem('beans');
  e.drop(tag, 0, 0, 0, 0);
  e.drop(tin, 1, 0, 0, 0);
  e.tick(TAG_GROUND - 5, [{ x: 0, z: 0 }]);
  assert.ok(e.loot.has(tag.uid), 'gone before its time');
  e.tick(10, [{ x: 0, z: 0 }]);
  assert.ok(!e.loot.has(tag.uid), 'still on the ground past its time, with somebody by it');
  assert.ok(e.loot.has(tin.uid), 'a tin went with it');
});

ok(`no tag of their own round the neck of somebody alive less than ${TAG_FRESH / 60} minutes: the server takes it off what their game says`, () => {
  const src = readFileSync('server/handle.ts', 'utf8');
  assert.ok(/c\.inv\?\.slots\?\.neck && Date\.now\(\) - c\.lifeAt < TAG_FRESH_MS\) c\.inv\.slots\.neck = null/.test(src), 'the server keeps a fresh player\'s own tag');
  const game = readFileSync('src/game/game/enter.ts', 'utf8');
  assert.ok(/this\.inv\.neck = null;\s*this\.inv\.neckDue = Date\.now\(\) \+ TAG_FRESH \* 1000;/.test(game), 'a new survivor is given their own tag at once');
});

console.log(`${n} checks passed`);
