// Checks of what the trader pays and asks (src/sim/trade.ts). No network:
// `npx tsx test/trade.test.ts`.

import assert from 'node:assert/strict';
import { ITEMS, makeItem } from '../src/sim/items';
import { STOCK, asks, pays, worth } from '../src/sim/trade';
import { generateWorld } from '../src/world/worldgen';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};

ok('everything he sells is a real thing with a price, and he sells no guns, tags or keycards', () => {
  for (const id of STOCK) {
    assert.ok(ITEMS[id], `${id} is not an item`);
    assert.ok(asks(id) > 0, `${id} has no price`);
    assert.ok(!ITEMS[id].weapon, `${id} is a gun`);
  }
  for (const id of ['dogtag', 'keycard']) {
    assert.equal(asks(id), 0);
    assert.equal(pays(makeItem(id)), 0);
  }
});

ok('nothing is gained by buying from him and selling it back, opened or not', () => {
  for (const id of STOCK) {
    const def = ITEMS[id];
    const bought = makeItem(id, def.stack);
    assert.ok(asks(id) >= 2 * pays(bought), `${id}: asks ${asks(id)}, pays ${pays(bought)}`);
    if (def.open) {
      const out = makeItem(def.open.gives, def.open.qty);
      assert.ok(asks(id) >= 2 * pays(out), `${id} opened: asks ${asks(id)}, pays ${pays(out)}`);
      // (and a box is worth what is in it, whichever way it is brought)
      assert.equal(pays(bought), pays(out));
    }
  }
});

ok('a gun is paid for with what is fitted to it', () => {
  const bare = makeItem('m9'), dressed = makeItem('m9');
  dressed.mods = ['red_dot', 'suppressor_9'];
  assert.equal(pays(dressed), pays(bare) + worth('red_dot') + worth('suppressor_9'));
});

ok('there is a shop on the map for him to stand in', () => {
  const world = generateWorld();
  assert.ok(world.buildings.filter((b) => b.type === 'store').length >= 2);
});

console.log(`\n${n} checks passed`);
