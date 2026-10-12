// What lies where (src/sim/economy.ts, src/sim/tiers.ts, src/sim/crates.ts): the rules of 2026-10-10, held to on
// the map as it is, over several stockings of it. Every place for a thing is on one of five steps, and every sort
// of thing is kept on the steps it belongs to.   npx tsx test/loot.test.ts
//
//   - what you hit with is on the outskirts and nowhere else; most of the lights are out there too
//   - no gun on the outskirts; pistols from the village on, most of them where guns were kept
//   - the sniper rifle: none below Kamenka, a few there, most under the gas
//   - the shotgun, the Desert Eagle, the heavy armour and the K6-3 helmet: the bunker's and nobody else's
//   - the army's rucksack is not found below the fourth step
//   - the gas masks are in the village's police station; the keycards are under the gas
//   - what a gun fires is on every step
//   - food in the shop before anywhere; dressings in the clinic and the shop
//   - the K6-3 leaves whoever wears it standing after a sniper's round to the head, barely
//   - one of the army's cases holds no rifle, scope or plates; a wooden crate holds no gun

import assert from 'node:assert/strict';
import { buildWorldData } from '../server/world';
import { RNG } from '../src/core/noise';
import { CRATE_SPECS, fillCrate } from '../src/sim/crates';
import { Economy, SHOWCASE, TYPES } from '../src/sim/economy';
import { ITEMS } from '../src/sim/items';
import { TIERS, type Tier } from '../src/sim/tiers';
import { ARMY_CAMP } from '../src/world/worldgen';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};
const data = buildWorldData(process.cwd());
const points = data.lootPoints;
const STEPS: Tier[] = [1, 2, 3, 4, 5];
const melee = Object.values(ITEMS).filter((d) => d.category === 'melee').map((d) => d.id);
const guns = Object.values(ITEMS).filter((d) => d.weapon).map((d) => d.id);

/** one stocking of the map: of each sort, how many lie on each step, and where each thing lies */
const stock = (seed: number) => {
  const e = new Economy(points, { spawn: () => {}, despawn: () => {} });
  (e as unknown as { rng: RNG }).rng = new RNG(seed);
  e.populate();
  const on = (id: string, t: Tier) => [...e.loot.values()].filter((l) => l.item.id === id && points[l.point].tier === t).length;
  // (by the rules alone: not what a place always keeps, whatever the rules say: the rifle on the hospital's roof and its parts)
  const ruled = (id: string, t: Tier) => [...e.loot.values()].filter((l) => l.item.id === id && points[l.point].tier === t && !points[l.point].keeps).length;
  return { e, on, ruled, all: [...e.loot.values()].map((l) => ({ id: l.item.id, p: points[l.point] })) };
};
const worlds = [11, 2026, 77123].map(stock);

ok('every place for a thing is on a step, and every step has places: the camp, the village and the checkpoint on the second', () => {
  for (const p of points) assert.ok(p.tier && p.tier >= 1 && p.tier <= 5, 'a place on no step');
  for (const t of STEPS) assert.ok(points.filter((p) => p.tier === t).length > 100, `step ${t} has hardly a place`);
  const camp = points.filter((p) => Math.hypot(p.x - ARMY_CAMP.x, p.z - ARMY_CAMP.z) < 40);
  assert.ok(camp.length >= 30 && camp.every((p) => p.tier === 2 && p.usage.includes('Military')), `the army's camp: ${camp.length} places`);
  assert.ok(camp.some((p) => p.arms === 'guns'), 'nothing to fight with is kept at the camp');
  assert.ok(points.filter((p) => p.usage.includes('Bunker')).every((p) => p.tier === 5) && points.filter((p) => p.usage.includes('Gas')).every((p) => p.tier === 4) && points.filter((p) => p.usage.includes('East')).every((p) => p.tier === 3));
  assert.deepEqual(Object.keys(TIERS), ['1', '2', '3', '4', '5']);
});

ok('every sort of thing has a rule, and gets what its rule says on every step it is kept on', () => {
  for (const id of Object.keys(ITEMS)) if (!['dogtag', 'watch'].includes(id)) assert.ok(TYPES[id], `${id} is kept nowhere`);
  for (const id of Object.keys(TYPES)) assert.ok(ITEMS[id], `a rule for ${id}, which there is no such thing as`);
  const { ruled: on } = worlds[0];
  for (const [id, rule] of Object.entries(TYPES)) for (const t of STEPS) {
    // (a thing or two short where a step is nearly full, and never one too many beyond what is always left at an armed place)
    const got = on(id, t), spare = guns.includes(id) || melee.includes(id) ? 40 : 0;
    assert.ok(got >= rule.at[t - 1] - 1 && got <= rule.at[t - 1] + spare, `${id} on step ${t}: ${got}, and ${rule.at[t - 1]} are wanted`);
  }
});

ok('what you hit with is on the outskirts and nowhere else; no gun is; and most of the lights are out there', () => {
  for (const { on, all } of worlds) {
    for (const id of melee) for (const t of [2, 3, 4, 5] as Tier[]) assert.equal(on(id, t), 0, `a ${id} on step ${t}`);
    assert.ok(melee.reduce((s, id) => s + on(id, 1), 0) >= 60, 'little to hit with on the outskirts');
    for (const id of guns) assert.equal(on(id, 1), 0, `a ${id} on the outskirts`);
    // (and what is always left at an armed place out there is something to hit with)
    for (const { id, p } of all) if (p.arms && p.tier === 1) assert.ok(melee.includes(id), `a ${id} left at an armed place on the outskirts`);
    assert.ok(on('flashlight', 1) > on('flashlight', 2) + on('flashlight', 3) - 1, 'the lights are not mostly on the outskirts');
  }
});

ok('pistols from the village on, most of them where guns were kept; the sniper rare in Kamenka and common under the gas', () => {
  for (const { on, all } of worlds) {
    assert.ok(on('colt', 2) + on('m9', 2) >= 26, 'few pistols in the village and the army\'s places');
    const pistols = all.filter(({ id, p }) => (id === 'colt' || id === 'm9') && p.tier === 2);
    const kept = pistols.filter(({ p }) => p.usage.includes('Police') || p.usage.includes('Military')).length;
    assert.ok(kept > pistols.length * 0.6, `${kept} of ${pistols.length} pistols on the second step are where guns were kept`);
    assert.equal(on('mosin', 1) + on('mosin', 2), 0, 'a sniper rifle below Kamenka');
    assert.ok(on('mosin', 3) >= 1 && on('mosin', 3) <= 3, `${on('mosin', 3)} sniper rifles in Kamenka`);
    assert.ok(on('mosin', 4) >= 8 && on('mosin', 4) > on('mosin', 3) * 3, `${on('mosin', 4)} sniper rifles under the gas`);
    assert.ok(on('pu_scope', 4) >= 5 && on('pu_scope', 1) + on('pu_scope', 2) === 0);
  }
});

ok('the shotgun, the Desert Eagle, the heavy armour and the K6-3 are the bunker\'s and nobody else\'s; the rucksack is not below the fourth step', () => {
  for (const { on } of worlds) {
    // TEMPORARY, THE SHOWCASE (2026-10-11; see SHOWCASE in src/sim/economy.ts): the shotgun, its shells and its
    // can are in Kamenka as well for now. It was: all ten of these in the bunker and on no other step.
    for (const id of ['benelli', 'ammo_12', 'box_12', 'suppressor_12', 'deagle', 'ammo_50', 'box_50', 'mag_deagle_ext', 'heavy_armor', 'helmet_k63']) {
      assert.ok(on(id, 5) >= 1, `no ${id} in the bunker`);
      for (const t of [1, 2, 3, 4] as Tier[]) if (!(t === 3 && id in SHOWCASE.kamenka)) assert.equal(on(id, t), 0, `a ${id} on step ${t}`);
    }
    for (const [id, n] of Object.entries(SHOWCASE.kamenka)) assert.ok(on(id, 3) >= n - 1, `the showcase: ${on(id, 3)} of ${id} in Kamenka, and ${n} are wanted`);
    for (const t of [1, 2, 3] as Tier[]) assert.equal(on('suitcase', t) + on('life_vest', t), 0, `the army's rucksack or a plate carrier on step ${t}`);
    assert.ok(on('suitcase', 4) + on('suitcase', 5) >= 4);
  }
  // (and nothing below the fourth step is drawn with the army's backpack)
  for (const [id, rule] of Object.entries(TYPES)) if (ITEMS[id].model === 'military_backpack') assert.equal(rule.at[0] + rule.at[1] + rule.at[2], 0, `${id} is the army's backpack and is kept below the fourth step`);
});

ok('the gas masks are in the village\'s police station and the keycards under the gas; what a gun fires is on every step', () => {
  for (const { on, all } of worlds) {
    // TEMPORARY, THE SHOWCASE: masks and keycards are in Kamenka as well for now. It was: three masks, all on the
    // second step in the police station; and no keycard on any step but the fourth.
    assert.ok(all.filter(({ id, p }) => id === 'gasmask' && p.tier === 3).every(({ p }) => p.usage.includes('Police')), 'a mask in Kamenka that is not in its police station');
    const masks = all.filter(({ id, p }) => id === 'gasmask' && p.tier !== 3);
    assert.ok(masks.length === 3 && masks.every(({ p }) => p.tier === 2 && p.usage.includes('Police')), 'the masks are not all in the village\'s police station');
    assert.ok(on('keycard', 4) >= 1 && on('keycard', 1) + on('keycard', 2) + on('keycard', 5) === 0);
    // (of whatever kind: down the bunker it is mostly what the guns kept there fire)
    const rounds = Object.values(ITEMS).filter((d) => d.category === 'ammo').map((d) => d.id);
    for (const t of STEPS) assert.ok(rounds.reduce((n, id) => n + on(id, t), 0) >= 12, `little to fire on step ${t}`);
  }
});

ok('food is in the shop before anywhere, and dressings in the clinic and the shop', () => {
  const share = (kind: 'Shop' | 'Medic', t: Tier) => points.filter((p) => p.tier === t && p.usage.includes(kind)).length / points.filter((p) => p.tier === t).length;
  let food = 0, inShop = 0, dress = 0, inCare = 0;
  for (const { all } of worlds) for (const { id, p } of all) {
    if (p.tier !== 2) continue;
    if (ITEMS[id].category === 'food') (food++, p.usage.includes('Shop') && inShop++);
    if (id === 'bandage' || id === 'firstaid') (dress++, (p.usage.includes('Medic') || p.usage.includes('Shop')) && inCare++);
  }
  // (a place in the shop gets food several times as often as its share of the places would give it)
  assert.ok(inShop / food > share('Shop', 2) * 2.5, `${inShop} of ${food} things to eat in the village were in its shop`);
  assert.ok(inCare / dress > (share('Medic', 2) + share('Shop', 2)) * 2.5, `${inCare} of ${dress} dressings in the village were in its clinic or its shop`);
});

ok('the K6-3 stops a sniper\'s round to the head, barely; nothing else does', () => {
  // (a rifle's round does 95 at the muzzle, and 3.2 times that to the head: see CARTRIDGES in src/sim/gunplay.ts and ZONE_MULT in src/game/weapons.ts)
  const head = 95 * 3.2;
  const left = 100 - head * ITEMS.helmet_k63.wear!.head!;
  assert.ok(left > 0 && left < 10, `it leaves ${left.toFixed(1)} of 100`);
  for (const d of Object.values(ITEMS)) if (d.id !== 'helmet_k63' && d.wear?.head) assert.ok(head * d.wear.head > 100, `${d.id} stops it as well`);
  assert.equal(ITEMS.helmet_k63.slot, 'head');
});

ok('one of the army\'s cases holds pistols and kit, now and then a mask or something of the third step, and no rifle, scope or plates; a wooden crate holds no gun', () => {
  let s = 7;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  const open = (kind: string, times: number) => {
    const seen = new Map<string, number>();
    for (let k = 0; k < times; k++) fillCrate({ add: (it: { id: string }) => (seen.set(it.id, (seen.get(it.id) ?? 0) + 1), it) } as never, kind, rnd);
    return seen;
  };
  for (const kind of ['weapons_case', 'old_military_crate', 'wooden_military_crate']) {
    const seen = open(kind, 600);
    for (const id of ['mosin', 'pu_scope', 'life_vest', 'suitcase', 'deagle', 'benelli', 'heavy_armor', 'helmet_k63', 'keycard', ...melee]) assert.ok(!seen.has(id), `a ${id} in a ${CRATE_SPECS[kind].label}`);
    assert.ok((seen.get('colt') ?? 0) + (seen.get('m9') ?? 0) > 60, 'hardly a pistol in the army\'s cases');
    const mask = (seen.get('gasmask') ?? 0) / 600;
    assert.ok(mask > 0.01 && mask < 0.12, `a gas mask in ${(mask * 100).toFixed(0)} cases of a hundred`);
    assert.ok((seen.get('armor_vest') ?? 0) + (seen.get('boonie_hat') ?? 0) > 0 && ((seen.get('armor_vest') ?? 0) + (seen.get('boonie_hat') ?? 0)) / 600 < 0.15, 'the third step\'s things are not rare in them');
  }
  const wood = open('wooden_crate_01', 600);
  for (const id of guns) assert.ok(!wood.has(id), `a ${id} in a wooden crate`);
  assert.ok(melee.some((id) => wood.has(id)));
});

console.log(`\n${n} checks passed`);
