// What a hunt gives and what is done with it (2026-10-23): meat raw, cooked, burned and rotten; food poisoning and
// what ends and guards against it; fires built from firewood and fed; every drop an item the game has.
//   npx tsx test/hunt-food.test.ts

import assert from 'node:assert/strict';
import { COOKS, FUEL, ROTTEN, keepCooked, markMade, mealOf, rotten, stateOf } from '../src/sim/cooking';
import { ITEMS, itemName, makeItem } from '../src/sim/items';
import { cleanItem } from '../src/sim/inventory';
import { KINDS, BLADES, yieldOf } from '../src/sim/animals';
import { GUARD, POISON, fallsIll, illFor } from '../src/sim/sickness';
import { FIRE, Hearths } from '../src/sim/fires';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};
const T0 = 1_800_000_000;

ok('every animal gives things the game has, and every meat cooks and goes off', () => {
  for (const k of KINDS) for (const [id, qty] of yieldOf(k, BLADES.knife)) {
    assert.ok(ITEMS[id], `${k.id} gives ${id}, which is no item`);
    assert.ok(qty >= 1);
    if (id.startsWith('meat_')) assert.ok(COOKS[id]?.keeps, `${id} does not cook and go off`);
  }
  assert.ok(FUEL.animal_fat > 0 && FUEL.firewood > 0);
});

ok('meat: raw a quarter and as likely as not poisons you; cooked all of it; burned a quarter; rotten little and poisons you', () => {
  const steak = markMade(makeItem('meat_venison'), T0);
  const full = ITEMS.meat_venison.use!.energy!;
  const raw = mealOf(steak, T0 + 10);
  assert.equal(raw.energy, Math.round(full * 0.25));
  assert.equal(raw.sick, 0.5);
  assert.equal(itemName(steak), 'Venison Steak (raw)');
  steak.cook = COOKS.meat_venison.takes;
  const done = mealOf(steak, T0 + 10);
  assert.equal(done.energy, full);
  assert.equal(done.sick, undefined);
  assert.equal(stateOf(steak, T0 + 10).word, 'cooked');
  steak.cook = COOKS.meat_venison.takes + COOKS.meat_venison.burns;
  assert.equal(mealOf(steak, T0 + 10).energy, Math.round(full * 0.25));
  // gone off: raw after forty minutes, cooked after three hours
  const old = markMade(makeItem('meat_bear'), T0);
  assert.equal(rotten(old, T0 + 2300), false);
  assert.equal(rotten(old, T0 + 2500), true);
  assert.equal(mealOf(old, T0 + 2500).sick, ROTTEN.sick);
  assert.equal(mealOf(old, T0 + 2500).health, ROTTEN.health);
  assert.equal(itemName(old).endsWith('(raw)') || itemName(old).endsWith('(rotten)'), true);
  old.cook = COOKS.meat_bear.takes;
  assert.equal(rotten(old, T0 + 2500), false, 'cooked in time, it keeps');
  assert.equal(rotten(old, T0 + 11000), true);
});

ok('a game cannot keep its meat fresh or its cooking from the server: both are kept, and never fresher than now', () => {
  const steak = markMade(makeItem('meat_beef'), T0);
  steak.cook = 30;
  const back = cleanItem(JSON.parse(JSON.stringify({ ...steak, made: Date.now() / 1000 + 9e6 })), (v) => String(v))!;
  assert.equal(back.cook, 30);
  assert.ok(back.made! <= Date.now() / 1000 + 1);
  const kept = keepCooked(makeItem('meat_beef'), { cook: 9999, made: T0 + 100 }, T0 + 50);
  assert.equal(kept.cook, COOKS.meat_beef.takes + COOKS.meat_beef.burns);
  assert.equal(kept.made, T0 + 50);
});

ok('food poisoning: bouts every half minute or so, then it passes; vitamins halve the chance and speed it', () => {
  assert.equal(fallsIll(0.5, false, 0.4), true);
  assert.equal(fallsIll(0.5, true, 0.4), false, 'guarded: half the chance');
  assert.equal(fallsIll(undefined, false, 0), false);
  let v = { ill: POISON.lasts, guard: 0 }, bout: number = POISON.every[0], bouts = 0, t = 0;
  while (v.ill > 0 && t < 1000) {
    const r = illFor(v, bout, 1, () => 0.5);
    v = { ill: r.ill, guard: r.guard };
    bout = r.bout;
    bouts += r.bouts;
    t++;
  }
  assert.ok(Math.abs(t - POISON.lasts) <= 1, `${t} s`);
  assert.ok(bouts >= 8 && bouts <= 14, `${bouts} bouts`);
  let g = { ill: POISON.lasts, guard: 1200 }, tg = 0;
  bout = POISON.every[0];
  while (g.ill > 0 && tg < 1000) {
    const r = illFor(g, bout, 1, () => 0.5);
    g = { ill: r.ill, guard: r.guard };
    bout = r.bout;
    tg++;
  }
  assert.ok(Math.abs(tg - POISON.lasts / GUARD.pace) <= 1, `guarded: ${tg} s`);
  const items = [ITEMS.charcoal, ITEMS.vitamins];
  assert.ok(items[0].use?.cures && items[1].use?.guard, 'charcoal ends it, vitamins guard');
  assert.ok(items.every((d) => d.loot?.usage?.includes('Medic')), 'both found where medicine is');
});

ok('a fire built from firewood: alight, fed for longer, three a player, cleared away when long cold', () => {
  const h = new Hearths([{ x: 0, z: 0 }]);
  const i = h.build(50, 2, 50, 7, T0);
  assert.equal(i, 1);
  assert.equal(h.isBuilt(i), true);
  assert.equal(h.left(i, T0), FIRE.burns);
  assert.equal(h.feed(i, FUEL.firewood, 51, 50, T0 + 10), true);
  assert.equal(h.left(i, T0 + 10), FIRE.burns + FUEL.firewood - 10);
  assert.equal(h.feed(i, FUEL.firewood, 80, 50, T0 + 10), false, 'not from across the field');
  assert.ok(h.build(60, 0, 60, 7, T0) > 0 && h.build(70, 0, 70, 7, T0) > 0);
  assert.equal(h.build(80, 0, 80, 7, T0), -1, 'a fourth of one player\'s');
  assert.ok(h.build(80, 0, 80, 8, T0) > 0, 'somebody else\'s');
  const out = T0 + FIRE.burns + FUEL.firewood + 5;
  assert.deepEqual(h.cleared(out), []);
  assert.ok(h.cleared(out + FIRE.built.cold + 1).includes(i));
  assert.equal(h.light(i, 50, 50, out + FIRE.built.cold + 2), false, 'nothing is lit where it stood');
});

console.log(`hunt-food: ${n} passed`);
