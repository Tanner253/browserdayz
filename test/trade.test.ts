// Checks of what the trader pays and asks (src/sim/trade.ts). No network:
// `npx tsx test/trade.test.ts`.

import assert from 'node:assert/strict';
import { ITEMS, makeItem } from '../src/sim/items';
import { KEPT_ON_DEATH, STOCK, aDay, asks, pays, worth } from '../src/sim/trade';
import { generateWorld } from '../src/world/worldgen';
import { buildWorldData } from '../server/world';
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

ok('he has a place of his own, out of the towns, and nothing lies about in it for the taking', () => {
  const world = generateWorld();
  const post = world.sites.find((st) => st.kind === 'market');
  assert.ok(post, 'there is no trading post');
  assert.ok(world.buildings.some((b) => b.type === 'store' && Math.hypot(b.x - post.x, b.z - post.z) < 40), 'no shop stands at it');
  // (well away from every other place on the map)
  for (const p of world.pois) if (p.name !== post.name) assert.ok(Math.hypot(p.x - post.x, p.z - post.z) > 120, `${p.name} is on top of it`);
  const data = buildWorldData(process.cwd());
  // (in his shop and his shed, that is. The bunkhouse along the yard is nobody's, and what is in it is found as anywhere.)
  const here = data.lootPoints.filter((p: { x: number; z: number }) => Math.hypot(p.x - post.x, p.z - post.z) < 40);
  assert.equal(here.filter((p: { building?: string }) => !p.building?.startsWith('hut_')).length, 0, 'something lies about at the trading post');
  const hut = world.buildings.find((b) => b.type === 'hut' && Math.hypot(b.x - post.x, b.z - post.z) < 60);
  assert.ok(hut, 'no bunkhouse stands by the yard');
  assert.ok(data.lootPoints.filter((p: { building?: string }) => p.building === hut.id).length >= 12, 'the bunkhouse is bare');
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
      // (and not so well that it is done by buying the thing from him)
      if (STOCK.includes(j.item!)) assert.ok(j.pays < (asks(j.item!) / (ITEMS[j.item!].stack ?? 1)) * j.n, `${j.id}: the job pays ${j.pays}, and he sells them for ${asks(j.item!)}`);
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
  assert.deepEqual(bookFor(day + 1, book), { day: day + 1, kills: 0, heads: 0, done: [], bought: {} });
  assert.deepEqual(bookFor(day, { day, kills: -4, done: 'x' as never }), { day, kills: 0, heads: 0, done: [], bought: {} });
});

ok('he is a place to top up at, not to be fitted out from: so many of a thing a day, the dear things one, and a death costs half the credit', () => {
  for (const id of STOCK) assert.ok(aDay(id) >= 1 && aDay(id) <= 4, `${id}: ${aDay(id)} a day`);
  for (const id of ['radio', 'gasmask', 'stash_kit']) assert.equal(aDay(id), 1);
  assert.ok(KEPT_ON_DEATH > 0 && KEPT_ON_DEATH < 1);
});

console.log(`\n${n} checks passed`);
