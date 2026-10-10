// Checks of what the trader pays and asks (src/sim/trade.ts). No network:
// `npx tsx test/trade.test.ts`.

import assert from 'node:assert/strict';
import { ITEMS, makeItem } from '../src/sim/items';
import { STOCK, asks, pays, worth } from '../src/sim/trade';
import { generateWorld } from '../src/world/worldgen';
import { bookFor, jobsFor, progress } from '../src/sim/jobs';

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

ok('the day has three jobs, the same whoever asks, of real things, and they pay better than the counter', () => {
  for (let day = 20000; day < 20400; day++) {
    const jobs = jobsFor(day);
    assert.equal(jobs.length, 3);
    assert.deepEqual(jobs, jobsFor(day));
    assert.equal(new Set(jobs.map((j) => j.id)).size, 3);
    for (const j of jobs) {
      assert.ok(j.n > 0 && j.pays > 0 && j.text);
      if (j.kind !== 'bring') continue;
      assert.ok(ITEMS[j.item!], `${j.item} is not an item`);
      const over = pays(makeItem(j.item!, ITEMS[j.item!].stack ? 1 : undefined)) * j.n;
      assert.ok(j.pays > over, `${j.id}: the job pays ${j.pays}, the counter ${over}`);
    }
  }
  assert.ok(new Set(Array.from({ length: 60 }, (_, k) => jobsFor(20700 + k).map((j) => j.id).join())).size > 20, 'the days are all alike');
});

ok('work is counted for its own day, is paid once, and yesterday is a clean page', () => {
  const day = 20736, jobs = jobsFor(day);
  const book = bookFor(day, null);
  const kill = jobs[0];
  book.kills = 99;
  book.heads = 99;
  assert.equal(progress(kill, book, () => 0), kill.n);
  const bring = jobs[1];
  assert.equal(progress(bring, book, () => 0), 0);
  assert.equal(progress(bring, book, () => 50), bring.n);
  book.done.push(bring.id);
  assert.equal(progress(bring, book, () => 0), bring.n);
  assert.deepEqual(bookFor(day, book), book);
  assert.deepEqual(bookFor(day + 1, book), { day: day + 1, kills: 0, heads: 0, done: [] });
  assert.deepEqual(bookFor(day, { day, kills: -4, done: 'x' as never }), { day, kills: 0, heads: 0, done: [] });
});

console.log(`\n${n} checks passed`);
