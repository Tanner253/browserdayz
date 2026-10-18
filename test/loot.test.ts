// What lies where (src/sim/economy.ts, src/sim/tiers.ts, src/sim/crates.ts): the rules of 2026-10-10 as they were
// redone on 2026-10-13 ("a specific type of loot is in specific types of buildings. the density and tier of the
// loot depends on its location on the map"), held to on the map as it is, over several stockings of it. Every
// place for a thing is on one of five steps, and every sort of thing is kept on the steps it belongs to, in the
// kind of building it belongs in.   npx tsx test/loot.test.ts
//
//   - the outskirts are for something to hit with, and no gun; past them a tool lies in a shed and nowhere else
//   - pistols from the village on, most of them where guns were kept; a submachine gun at the big police station
//   - Kamenka is the submachine gun's; one AK and one AR-15 in the whole town, seldom with a magazine, and a long
//     time coming back; the showcase that strewed every new gun through its houses is gone
//   - the sniper rifle and the two assault rifles are the gas's; the shotgun, the Desert Eagle, the heavy armour
//     and the K6-3 helmet are the bunker's and nobody else's
//   - what a gun fires: every calibre where the police and the army were, from the village on; a calibre is
//     heavy on its gun's step and above, light on the step below
//   - a clinic leans on bandages and stims, the hospital on first aid kits and stims; a shop is food, water and a
//     light; a shed is tools, fuel, gloves and boots
//   - the gas masks are a policeman's; the keycards are under the gas
//   - the K6-3 leaves whoever wears it standing after a sniper's round to the head, barely
//   - one of the army's cases holds no rifle, scope or plates; a wooden crate holds no gun
//   - a looted spot, and the ground about it, is left alone for three minutes, and what lay there does not come
//     straight back to it (2026-10-13)

import assert from 'node:assert/strict';
import { buildWorldData } from '../server/world';
import { RNG } from '../src/core/noise';
import { CRATE_SPECS, fillCrate } from '../src/sim/crates';
import { APART_KIND, Economy, TYPES, apartOf } from '../src/sim/economy';
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
// (The map's own places, by their numbers in the whole list. A place stocked apart, the fort on the mountain, is
// left out of every count below but its own: it is stocked on top of the map and takes nothing from it. Its
// places are the last in the list, so the numbers of the rest are theirs still.)
const every = data.lootPoints;
const points = every.filter((p) => !apartOf(p.building));
assert.ok(every.slice(0, points.length).every((p, i) => p === points[i]), 'a place apart is not at the end of the list of places');
const STEPS: Tier[] = [1, 2, 3, 4, 5];
const melee = Object.values(ITEMS).filter((d) => d.category === 'melee').map((d) => d.id);
const guns = Object.values(ITEMS).filter((d) => d.weapon).map((d) => d.id);

/** one stocking of the map: of each sort, how many lie on each step, and where each thing lies */
const stock = (seed: number) => {
  const e = new Economy(every, { spawn: () => {}, despawn: () => {} });
  (e as unknown as { rng: RNG }).rng = new RNG(seed);
  e.populate();
  /** what lies in the place apart: put by, and taken out of what the map's own rules are held to */
  const fort = [...e.loot.values()].filter((l) => l.point >= points.length).map((l) => ({ id: l.item.id, p: every[l.point] }));
  for (const l of [...e.loot.values()]) if (l.point >= points.length) e.loot.delete(l.uid);
  const on = (id: string, t: Tier) => [...e.loot.values()].filter((l) => l.item.id === id && points[l.point].tier === t).length;
  // (by the rules alone: not what a place always keeps, whatever the rules say: the rifle on the hospital's roof and its parts)
  const ruled = (id: string, t: Tier) => [...e.loot.values()].filter((l) => l.item.id === id && points[l.point].tier === t && !points[l.point].keeps).length;
  return { e, on, ruled, fort, all: [...e.loot.values()].map((l) => ({ id: l.item.id, p: points[l.point], item: l.item })) };
};
const worlds = [11, 2026, 77123].map(stock);

ok('every place for a thing is on a step, and every step has places: the camp and the checkpoints on the second', () => {
  for (const p of points) assert.ok(p.tier && p.tier >= 1 && p.tier <= 5, 'a place on no step');
  for (const t of STEPS) assert.ok(points.filter((p) => p.tier === t).length > 100, `step ${t} has hardly a place`);
  const camp = points.filter((p) => Math.hypot(p.x - ARMY_CAMP.x, p.z - ARMY_CAMP.z) < 40);
  assert.ok(camp.length >= 30 && camp.every((p) => p.tier === 2 && p.usage.includes('Military')), `the army's camp: ${camp.length} places`);
  assert.ok(camp.some((p) => p.arms === 'guns'), 'nothing to fight with is kept at the camp');
  assert.ok(points.filter((p) => p.usage.includes('Bunker')).every((p) => p.tier === 5) && points.filter((p) => p.usage.includes('Gas')).every((p) => p.tier === 4) && points.filter((p) => p.usage.includes('East')).every((p) => p.tier === 3));
  assert.deepEqual(Object.keys(TIERS), ['1', '2', '3', '4', '5']);
});

ok('every sort of thing has a rule, and gets what its rule says on every step it is kept on', () => {
  // (the jacket and the trousers everybody starts in lie nowhere: a spare of either is room for nothing)
  // (nor the launcher and its grenades: the owner, "the grenade launcher and its ammo is an admin only weapon")
  for (const id of Object.keys(ITEMS)) if (!['dogtag', 'watch', 'field_jacket', 'field_trousers', 'm32', 'ammo_40mm'].includes(id)) assert.ok(TYPES[id], `${id} is kept nowhere`);
  for (const id of Object.keys(TYPES)) assert.ok(ITEMS[id], `a rule for ${id}, which there is no such thing as`);
  const { ruled: on, e, all } = worlds[0];
  // (how full each step is: a thing short where there is room, two or a fifth where a step is nearly full (the police
  // stations and the army's posts of Kamenka are wanted by more than they hold: of the 5.56 kept there by its rate the old
  // roll put down half, this one five in six), and where every place
  // is spoken for, under the gas and down the bunker, up to half of a sort: the bunker is asked for 175 things on its
  // 145 places, and for 23 that lie only on a floor on its 13 floors, and its guns and its own are put down first)
  const full = (t: Tier) => all.filter(({ p }) => p.tier === t && !p.arms).length / points.filter((p) => p.tier === t && !p.arms).length;
  for (const id of Object.keys(TYPES)) for (const t of STEPS) {
    // (and never one too many beyond what is always left at an armed place)
    // (what is wanted: its count, or what its rate comes to on this map, see TypeRule.per)
    const got = on(id, t), spare = guns.includes(id) || melee.includes(id) ? 40 : 0, want = e.kept(id, t);
    const short = full(t) >= 0.95 ? Math.max(Math.ceil(want / 2), Math.min(want, 3)) : full(t) >= 0.85 ? Math.max(2, Math.ceil(want * 0.2)) : 1;
    assert.ok(got >= want - short && got <= want + spare, `${id} on step ${t}: ${got}, and ${want} are wanted`);
  }
  // (the AR-15's rounds by a rate: some at most police and army places in the village and Kamenka, the owner, 2026-10-15:
  // "someone with an AR needs to be able to loot reliable places for ammo not set spawns, just spawn frequency")
  // (the second step is the checkpoints and the army's camp since the village went to the third, 2026-10-17)
  assert.ok(e.kept('ammo_556', 2) >= 8 && e.kept('ammo_556', 3) >= 20, `5.56 kept: ${e.kept('ammo_556', 2)} at the checkpoints and the camp, ${e.kept('ammo_556', 3)} in Kamenka and the village`);
});

const kind = (p: (typeof points)[number], ...kinds: string[]) => kinds.some((k) => p.usage.includes(k as never));
const SHED = ['Farm', 'Industrial', 'Hunting'], KEPT_GUNS = ['Police', 'Military'];

ok('the outskirts are for something to hit with, and no gun; past them a tool lies in a shed and nowhere else; most of the lights are out there', () => {
  for (const { on, all } of worlds) {
    const out = melee.reduce((s, id) => s + on(id, 1), 0), past = all.filter(({ id, p }) => melee.includes(id) && p.tier !== 1);
    assert.ok(out >= 70, `little to hit with on the outskirts: ${out}`);
    // (a few, and they are a shed's: "sheds should spawn industrial and tools")
    // (the village is of the third step now, 2026-10-17, its sheds and their tools with it: still fewer past the outskirts than on them)
    assert.ok(past.length >= 6 && past.length < out, `${past.length} things to hit with past the outskirts, ${out} on them`);
    for (const { id, p } of past) assert.ok(p.tier! <= 3 && kind(p, ...SHED) && !kind(p, 'Village', 'Town', 'Shop', 'Medic', 'Hospital', 'Police'), `a ${id} on step ${p.tier} in ${p.building}`);
    for (const id of ['bat', 'machete']) assert.equal(on(id, 2) + on(id, 3), 0, `a ${id} past the outskirts`);
    for (const id of guns) assert.equal(on(id, 1), 0, `a ${id} on the outskirts`);
    // (and what is always left at an armed place out there is something to hit with)
    for (const { id, p } of all) if (p.arms && p.tier === 1) assert.ok(melee.includes(id), `a ${id} left at an armed place on the outskirts`);
    // (by the place: the village and its sheds are of the third step now, which has six times the outskirts' places)
    const lights = (t: Tier) => on('flashlight', t) / points.filter((p) => p.tier === t && !p.arms).length;
    assert.ok(lights(1) > lights(2) && lights(1) > lights(3), 'the lights are not mostly on the outskirts');
  }
});

ok('pistols from the second step on, most of them where guns were kept; a submachine gun at the police station; the sniper rare in Kamenka and common under the gas', () => {
  for (const { on, all } of worlds) {
    // (the second step is the checkpoints, the army's camp and the depot: the village went to the third, 2026-10-17)
    assert.ok(on('colt', 2) + on('m9', 2) >= 10, 'few pistols at the checkpoints and the army\'s places');
    const pistols = all.filter(({ id, p }) => (id === 'colt' || id === 'm9') && p.tier === 2);
    const kept = pistols.filter(({ p }) => kind(p, ...KEPT_GUNS)).length;
    assert.ok(kept > pistols.length * 0.6, `${kept} of ${pistols.length} pistols on the second step are where guns were kept`);
    // ("we shoul dhave more sub machine guns in the story police station": on the second step they are the army's, and in no house)
    const smg = all.filter(({ id, p }) => id === 'mpa' && p.tier === 2);
    assert.ok(smg.length >= 2 && smg.every(({ p }) => kind(p, ...KEPT_GUNS)), `${smg.length} submachine guns on the second step, or one of them in a house`);
    assert.ok(all.filter(({ id, p }) => id === 'mpa' && p.tier === 3 && /^police/.test(p.building)).length >= 5, 'the submachine guns are not at the police');
    assert.equal(on('mosin', 1) + on('mosin', 2), 0, 'a sniper rifle below Kamenka');
    assert.ok(on('mosin', 3) >= 1 && on('mosin', 3) <= 3, `${on('mosin', 3)} sniper rifles in Kamenka`);
    assert.ok(on('mosin', 4) >= 6 && on('mosin', 4) >= on('mosin', 3) * 3, `${on('mosin', 4)} sniper rifles under the gas, ${on('mosin', 3)} in Kamenka`);
    // (under the gas every place is spoken for, some forty things more wanted than there are places: a scope or two short)
    assert.ok(on('pu_scope', 4) >= 3 && on('pu_scope', 1) + on('pu_scope', 2) === 0, `${[1, 2, 3, 4, 5].map((t) => on('pu_scope', t as Tier))} scopes`);
  }
});

ok('Kamenka is the submachine gun\'s; one AK and one AR-15 in the whole town, seldom with a magazine, and a long time coming back; the rifles are the gas\'s', () => {
  let rifles = 0, withMag = 0;
  for (const { on, all, e } of worlds) {
    // ("tier 3 should be submachine guns heavy")
    // (the weapons pass's submachine guns with the MPA30's, 2026-10-17)
    const smgs = ['mpa', 'scorpion', 'dual_smg', 'dual_mac10', 'mp7a1'].reduce((n, id) => n + on(id, 3), 0);
    assert.ok(on('mpa', 3) >= 12 && smgs > on('colt', 3) + on('m9', 3), `${smgs} submachine guns in Kamenka, ${on('colt', 3) + on('m9', 3)} pistols`);
    assert.ok(on('mag_mpa', 3) >= 12 && on('ammo_9mm', 3) + on('box_9mm', 3) >= 36, 'little to feed a submachine gun with in Kamenka');
    // ("it should be possible to find an AK and an AR15 at kamenka but rarely ... you CAN get everything you need from T3 for AR's but its very rare")
    for (const [gun, mag, rounds] of [['ak', 'mag_ak', 'ammo_739'], ['ar15', 'mag_ar', 'ammo_556']]) {
      assert.equal(on(gun, 1) + on(gun, 2), 0, `a ${gun} below Kamenka`);
      // (one in Kamenka and one in the village, since the village is of the third step)
      assert.ok(on(gun, 3) >= 1 && on(gun, 3) <= TYPES[gun].at[2], `${on(gun, 3)} of ${gun} in Kamenka`);
      assert.ok(on(mag, 3) >= 1 && on(mag, 3) <= TYPES[mag].at[2], `${on(mag, 3)} of ${mag} in Kamenka`);
      // (but the AR-15's rounds, kept by a rate where the police and the army were: see TypeRule.per)
      // (light by the place: the third step has eight times the gas's places)
      const per = (t: Tier) => on(rounds, t) / points.filter((p) => p.tier === t && !p.arms).length;
      assert.ok(on(rounds, 3) >= 2 && (TYPES[rounds].per || per(3) < per(4)), `${on(rounds, 3)} handfuls of ${rounds} in Kamenka, ${on(rounds, 4)} under the gas`);
      // ("more common in the T4")
      // (the magazines a little short, where every place is spoken for)
      assert.ok(on(gun, 4) >= 3 && on(mag, 4) >= 2, `${on(gun, 4)} of ${gun} and ${on(mag, 4)} of ${mag} under the gas`);
      assert.ok(TYPES[gun].on![3]!.restock! >= 2400 && TYPES[mag].on![3]!.restock! >= 2400, `${gun} or its magazine is back in Kamenka inside forty minutes`);
    }
    // (they lie where the army and the police kept things, and in nobody's kitchen)
    for (const { id, p } of all) if ((id === 'ak' || id === 'ar15' || id === 'mosin') && p.tier === 3 && !p.keeps) assert.ok(kind(p, ...KEPT_GUNS), `a ${id} in ${p.building}`);
    // ("an even rarer chance of having a magazine": over many makings of the town)
    const eco = e as unknown as { rng: RNG; fill(where: Tier, place: string | null, due: Map<string, number>): Map<string, number>; loot: Map<string, { item: { id: string; mag?: string | null } }>; take(uid: string, looted: boolean): unknown };
    // (The town's own two are taken up first, as they are in play before another is put down: of its thirty-one
    // places for a rifle none or one is free after a stocking, by the dice, and with none nothing was counted.)
    for (const l of [...e.loot.values()]) if ((l.item.id === 'ak' || l.item.id === 'ar15') && points[l.point].tier === 3 && !points[l.point].keeps) eco.take(l.uid, false);
    for (let k = 0; k < 200; k++) {
      const had = new Set(eco.loot.keys());
      if (!eco.fill(3, null, new Map([[k % 2 ? 'ak' : 'ar15', 1]])).size) continue;
      const [uid] = [...eco.loot.keys()].filter((u) => !had.has(u));
      rifles++;
      if (eco.loot.get(uid)!.item.mag) withMag++;
      eco.take(uid, false);
    }
    // (the showcase is gone: nothing of the bunker's or the gas's is in the town's houses)
    for (const id of ['benelli', 'box_12', 'suppressor_12', 'drum_ak', 'mag_ar_60', 'suppressor_739', 'suppressor_556', 'keycard']) assert.equal(on(id, 3), 0, `a ${id} in Kamenka`);
  }
  assert.ok(rifles > 100 && withMag / rifles > 0.05 && withMag / rifles < 0.25, `${withMag} of ${rifles} rifles put down in Kamenka had a magazine in them`);
});

ok('the shotgun, the Desert Eagle, the heavy armour and the K6-3 are the bunker\'s and nobody else\'s; the rucksack is not below the fourth step', () => {
  for (const { on } of worlds) {
    for (const id of ['benelli', 'suppressor_12', 'deagle', 'mag_deagle', 'mag_deagle_ext', 'box_50', 'heavy_armor', 'helmet_k63', 'drum_ak', 'mag_ar_60']) {
      assert.ok(on(id, 5) >= 1, `no ${id} in the bunker`);
      for (const t of [1, 2, 3, 4] as Tier[]) assert.equal(on(id, t), 0, `a ${id} on step ${t}`);
    }
    for (const t of [1, 2, 3] as Tier[]) assert.equal(on('suitcase', t) + on('life_vest', t), 0, `the army's rucksack or a plate carrier on step ${t}`);
    // (the rucksack lies only on a floor, and the bunker's thirteen floors are its guns' first)
    assert.ok(on('suitcase', 4) + on('suitcase', 5) >= 1, `${on('suitcase', 4) + on('suitcase', 5)} rucksacks under the gas and down the bunker`);
  }
  // (and nothing below the fourth step is drawn with the army's backpack)
  for (const [id, rule] of Object.entries(TYPES)) if (ITEMS[id].model === 'military_backpack') assert.equal(rule.at[0] + rule.at[1] + rule.at[2], 0, `${id} is the army's backpack and is kept below the fourth step`);
});

ok('every calibre where the police and the army were, from the village on: heavy on its gun\'s step and above, light below it', () => {
  const rounds = Object.values(ITEMS).filter((d) => d.category === 'ammo').map((d) => d.id);
  /** the loose rounds of a gun, and the step the gun belongs to */
  const OF: [string, Tier][] = [['ammo_9mm', 2], ['ammo_45', 2], ['ammo_762', 4], ['ammo_739', 4], ['ammo_556', 4], ['ammo_12', 5], ['ammo_50', 5]];
  for (const { on, all, e } of worlds) {
    // (of whatever kind: down the bunker it is mostly what the guns kept there fire)
    for (const t of STEPS) assert.ok(rounds.reduce((n, id) => n + on(id, t), 0) >= 12, `little to fire on step ${t}`);
    // ("i am only finding low tier ammo in the big police when i should find all ammo there", "the small police
    // station has low caliber weapons and all ammos": every calibre lies at the police of the village and of Kamenka)
    for (const t of [2, 3] as Tier[]) {
      const there = new Set(all.filter(({ p }) => p.tier === t && kind(p, ...KEPT_GUNS)).map(({ id }) => id));
      for (const [id] of OF) assert.ok(there.has(id), `no ${id} where the police and the army were on step ${t}`);
    }
    const hq = new Set(all.filter(({ p }) => /^police_(hq|cells|garage)/.test(p.building)).map(({ id }) => id));
    assert.ok(OF.filter(([id]) => hq.has(id)).length >= 6, `the big police station has ${OF.filter(([id]) => hq.has(id)).map(([id]) => id).join(', ')} and no more`);
    for (const [id, home] of OF) {
      // (none two steps and more below its gun's but the pistols', which are everybody's; a little on the step below; most at home and above)
      if (home >= 4) {
        assert.ok(on(id, 1) <= 2, `${on(id, 1)} of ${id} on the outskirts`);
        // (but the AR-15's, kept by a rate where the police and the army were: see above)
        // (light by the place: Kamenka and the village have eight times the gas's places, so fifteen there is lighter than five under it)
        const per = (t: Tier) => on(id, t) / points.filter((p) => p.tier === t && !p.arms).length;
        if (!TYPES[id].per) assert.ok(per(2) < per(home) && per(3) < per(home), `${id}: ${on(id, 2)} on the second step and ${on(id, 3)} on the third, of a gun of step ${home}`);
        // (and past the outskirts it is nobody's but the police's, the army's and a hunter's)
        for (const { id: it, p } of all) if (it === id && (p.tier === 2 || p.tier === 3)) assert.ok(kind(p, ...KEPT_GUNS, 'Hunting'), `${id} in ${p.building}`);
      }
      // (as many as its own step keeps, up to three: under the gas the counts are cut to its places, see Economy.fit)
      assert.ok(on(id, home) >= Math.min(3, e.kept(id, home)), `${on(id, home)} of ${id} on its gun's own step`);
    }
    // (sealed boxes of the rifles' rounds: one or so below the gas, and the bunker's guns' not below the gas at all)
    // (the AR-15's boxes by a rate where the police and the army were, as its rounds are: see TypeRule.per)
    for (const id of ['box_739', 'box_556']) assert.ok(on(id, 1) === 0 && (TYPES[id].per || (on(id, 2) <= 2 && on(id, 3) <= TYPES[id].at[2])) && on(id, 4) >= 1, `${id}: ${[1, 2, 3, 4].map((t) => on(id, t as Tier))}`);
    for (const id of ['box_12', 'box_50']) assert.equal(on(id, 1) + on(id, 2) + on(id, 3), 0, `a ${id} below the gas`);
  }
});

ok('the gas masks are a policeman\'s, and the keycards are under the gas', () => {
  for (const { on, all } of worlds) {
    const masks = all.filter(({ id }) => id === 'gasmask');
    // (all five on the third step since the village is of it, 2026-10-17)
    assert.ok(masks.filter(({ p }) => p.tier === 3).length >= 4 && masks.length <= 5, `${masks.length} gas masks, on steps ${masks.map(({ p }) => p.tier)}`);
    assert.ok(masks.every(({ p }) => kind(p, 'Police')), 'a mask that is not in a police station');
    assert.ok(on('keycard', 4) >= 1 && on('keycard', 1) + on('keycard', 2) + on('keycard', 3) + on('keycard', 5) === 0);
  }
});

ok('a building is of one kind, and holds what its kind is for: the clinic, the hospital, the shop, the shed', () => {
  // (none is of two that pull against each other: a clinic that is also a house, a shop that is also a house)
  for (const p of points) {
    if (kind(p, 'Medic', 'Hospital', 'Shop')) assert.ok(!kind(p, 'Village', 'Town'), `${p.building} is ${p.usage.join(' and ')}`);
    if (/^(shed|shanty)/.test(p.building)) assert.ok(!kind(p, 'Village', 'Town'), `${p.building} is ${p.usage.join(' and ')}`);
    if (kind(p, 'Medic', 'Hospital')) assert.equal(kind(p, 'Hospital'), /^hospital/.test(p.building), `${p.building} is ${p.usage.join(' and ')}`);
  }
  const sum = (m: Map<string, number>, ...ids: string[]) => ids.reduce((n, id) => n + (m.get(id) ?? 0), 0);
  const cat = (m: Map<string, number>, ...cats: string[]) => [...m].reduce((n, [id, k]) => n + (cats.includes(ITEMS[id].category) ? k : 0), 0);
  const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  /** the lights lying in shops, one count to a stocking: held to over them all and not on any one throw of the dice */
  const lights: number[] = [];
  for (const { all } of worlds) {
    const inside = (ok: (p: (typeof points)[number]) => boolean) => {
      const m = new Map<string, number>();
      for (const { id, p } of all) if (!p.arms && !p.keeps && ok(p)) m.set(id, (m.get(id) ?? 0) + 1);
      return m;
    };
    // ("the small medical buildings should lean heavy on bandages and stims and less mekits")
    for (const t of [3] as Tier[]) {
      const clinic = inside((p) => p.tier === t && kind(p, 'Medic'));
      assert.ok(total(clinic) >= 12 && cat(clinic, 'medical') === total(clinic), `a clinic on step ${t} holds ${[...clinic].map(([id, k]) => `${id} ${k}`).join(', ')}`);
      assert.ok(sum(clinic, 'bandage') >= 4 && sum(clinic, 'stim', 'stim_stamina') >= 4 && sum(clinic, 'firstaid') * 4 <= sum(clinic, 'bandage', 'stim', 'stim_stamina'), `a clinic on step ${t}: ${sum(clinic, 'bandage')} bandages, ${sum(clinic, 'stim', 'stim_stamina')} stims, ${sum(clinic, 'firstaid')} kits`);
    }
    // ("the hospital should be medkit abundant and lots of stims")
    const hospital = inside((p) => kind(p, 'Hospital') && !kind(p, 'Military'));
    assert.ok(cat(hospital, 'medical') === total(hospital) && sum(hospital, 'firstaid') >= 40 && sum(hospital, 'stim', 'stim_stamina') >= 45 && sum(hospital, 'firstaid') > sum(hospital, 'bandage') * 2, `the hospital: ${[...hospital].map(([id, k]) => `${id} ${k}`).join(', ')}`);
    // ("the store should spawn supplies and food, and water, flashlight")
    for (const t of [1, 3] as Tier[]) {
      const shop = inside((p) => p.tier === t && kind(p, 'Shop'));
      assert.ok(cat(shop, 'food') >= 8 && cat(shop, 'drink') >= 4 && cat(shop, 'food', 'drink') * 5 >= total(shop) * 3, `the shop on step ${t}: ${[...shop].map(([id, k]) => `${id} ${k}`).join(', ')}`);
      assert.equal(cat(shop, 'weapon', 'magazine', 'ammo', 'attachment', 'melee'), 0, `the shop on step ${t} holds something to fight with`);
    }
    lights.push([1, 2, 3].reduce((n, t) => n + sum(inside((p) => p.tier === t && kind(p, 'Shop')), 'flashlight'), 0));
    // ("sheds should spawn industrial and tools, flashlight etc": past the outskirts they were all but empty)
    const TOOLS = ['hatchet', 'crowbar', 'shovel', 'knife', 'flashlight', 'jerrycan', 'work_gloves', 'rubber_boots', 'garden_gloves', 'stash_kit', 'black_bag', 'sack_pack', 'chest_rig', 'gun_light'];
    const sheds = inside((p) => p.tier === 3 && kind(p, ...SHED) && !kind(p, 'Military')), places = points.filter((p) => p.tier === 3 && !p.arms && kind(p, ...SHED) && !kind(p, 'Military')).length;
    assert.ok(total(sheds) >= places * 0.25 && sum(sheds, ...TOOLS) * 2 >= total(sheds), `the sheds of the village: ${total(sheds)} things on ${places} places, ${sum(sheds, ...TOOLS)} of them a shed's`);
    // (a hunter's cabin keeps its shotgun, as DayZ's hunting places keep theirs: a farm's or a works' shed keeps no gun)
    assert.equal(cat(inside((p) => p.tier === 3 && kind(p, 'Farm', 'Industrial') && !kind(p, 'Military', 'Hunting', 'Village', 'Town')), 'weapon', 'magazine'), 0, 'a gun or a magazine in a shed');
  }
  // ("the store should spawn supplies and food, and water, flashlight": three to a stocking on the whole, and never a stocking with none)
  assert.ok(lights.reduce((a, b) => a + b, 0) >= worlds.length * 3 - 2 && Math.min(...lights) >= 1, `hardly a light in any shop: ${lights.join(', ')} over ${worlds.length} stockings`);
});

ok('food is in the shop before anywhere, and dressings in the clinic', () => {
  const share = (kind: 'Shop' | 'Medic', t: Tier) => points.filter((p) => p.tier === t && p.usage.includes(kind)).length / points.filter((p) => p.tier === t).length;
  let food = 0, inShop = 0, dress = 0, inCare = 0;
  for (const { all } of worlds) for (const { id, p } of all) {
    if (p.tier !== 3) continue;
    if (ITEMS[id].category === 'food') (food++, p.usage.includes('Shop') && inShop++);
    if (id === 'bandage' || id === 'stim') (dress++, p.usage.includes('Medic') && inCare++);
  }
  // (a place in the shop gets food several times as often as its share of the places would give it)
  assert.ok(inShop / food > share('Shop', 3) * 2.5, `${inShop} of ${food} things to eat in the village and Kamenka were in their shops`);
  assert.ok(inCare / dress > share('Medic', 3) * 4, `${inCare} of ${dress} bandages and stims in the village and Kamenka were in their clinics`);
});

ok('the gas and the bunker hold all they are asked; a step asked for more than it has places is stocked to what it holds, what it is for cut least', () => {
  // (2026-10-17: the gas was asked for 165 things on its 127 places and the bunker for 175 on its 145; with their new
  // places they hold all of it, and nothing is cut)
  const { e } = worlds[0];
  for (const t of [4, 5] as Tier[]) for (const id of Object.keys(TYPES)) if (!TYPES[id].per) assert.equal(e.kept(id, t), TYPES[id].at[t - 1], `${id} cut on step ${t}`);
  // (and a bunker of a hundred and twenty places is cut to them)
  const few = new Economy(points.filter((p) => p.tier === 5).slice(0, 120), { spawn: () => {}, despawn: () => {} });
  const kept = Object.keys(TYPES).reduce((n, id) => n + few.kept(id, 5), 0);
  assert.ok(kept <= 120 && kept >= 118, `a bunker of 120 places keeps ${kept} things`);
  for (const id of Object.keys(TYPES)) if (TYPES[id].at[4]) assert.ok(few.kept(id, 5) >= 1, `${id} cut to nothing`);
  // (what is the bunker's and nobody else's cut least; a dressing every village has more than a shotgun)
  assert.ok(few.kept('benelli', 5) / TYPES.benelli.at[4] > few.kept('bandage', 5) / TYPES.bandage.at[4], 'the shotgun cut more than a dressing');
  for (const id of ['sniper50', 'barrett', 'vssk']) assert.equal(few.kept(id, 5), 1, `${id} cut`);
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

ok('a looted spot, and the ground about it, is left alone for three minutes; and what lay there does not come straight back to it', () => {
  const e = new Economy(points, { spawn: () => {}, despawn: () => {} });
  (e as unknown as { rng: RNG }).rng = new RNG(11);
  e.populate();
  const nobody = [{ x: 9999, z: 9999 }];
  // (some time goes by first: what was laid out at the start is not what is looked for as newly put down)
  for (let t = 0; t < 60; t += 5) e.tick(5, nobody);
  const tiers = (e as unknown as { tier: Tier[] }).tier;
  const all = () => [...e.loot.values()];
  const about = (a: number, b: number) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y, points[a].z - points[b].z);
  // (things lying in Kamenka, where whatever is gone is put back soonest, and where it came straight back)
  const lies = () => all().filter((l) => l.point >= 0 && tiers[l.point] === 3 && !points[l.point].arms && !points[l.point].keeps);
  const lying = lies();
  assert.ok(lying.length > 25, `${lying.length} things lie in Kamenka`);
  const before = lying.length;
  let near = 0, same = 0, early = 0, back = 0, tried = 0;
  const missed = new Set<string>();
  const sorts = new Set<string>();
  // (A dozen things, one after another, each of what lies there at the time: of many sorts, in many buildings.
  // It goes on for hours of the game's time, and what lay there at the start has gone with age by the end.)
  for (let n = 0; n < 12; n++) {
    // (of the sorts the rules say are back in the town inside ten minutes: its one AK is most of an hour coming, on purpose)
    // (and none of which some are about to go with age inside the time looked at: a sort laid out all at once goes all at
    // once, and its spots are kept from it for SAME_AGAIN, which is longer; that is its age, and not what is looked at here)
    const ageing = (id: string) => lies().some((q) => q.item.id === id && e.time - q.spawnedAt > TYPES[id].lifetime - 800);
    const now = lies().filter((q) => !sorts.has(q.item.id) && (TYPES[q.item.id].on?.[3]?.restock ?? Math.min(TYPES[q.item.id].restock, 420)) <= 600 && !ageing(q.item.id));
    const l = now[(n * 37 + 5) % now.length];
    const spot = l.point, id = l.item.id;
    sorts.add(id);
    tried++;
    const had = e.held(id, 3), took = e.time;
    e.take(l.uid);
    for (let t = 0; t < 175; t += 5) {
      e.tick(5, nobody);
      // (put down since it was taken: what was laid beside it a moment before was laid beside a spot nobody had looted)
      for (const q of all()) if (q.point >= 0 && q.spawnedAt > took && q.spawnedAt > e.time - 5.01 && about(q.point, spot) < 6) near++;
    }
    if (all().some((q) => q.point === spot)) early++;
    for (let t = 0; t < 600; t += 5) e.tick(5, nobody);
    if (all().some((q) => q.point === spot && q.item.id === id)) same++;
    if (e.held(id, 3) >= had) back++;
    else missed.add(id);
  }
  assert.equal(near, 0, `${near} things were put down within 6 m of a spot looted less than three minutes before`);
  assert.equal(early, 0, `${early} spots had something on them again inside three minutes`);
  // (none but a sort kept in two or three spots and nowhere else, the police station's gas masks among them: theirs
  // is the one spot there is, and it goes back there once the spot has rested, as things do under the gas)
  assert.ok(same <= 2, `${same} things were back on the very spot they were taken from inside fifteen minutes`);
  // (Kamenka's police stations and the army's posts are wanted by more than they hold: a sort kept only there waits
  // for a place there to come free, and that is not always inside thirteen minutes)
  assert.ok(tried >= 8 && back >= Math.ceil(tried * 0.7), `only ${back} of ${tried} sorts were made up again inside thirteen minutes: not ${[...missed].join(', ')}`);
  // (and the town is as full as it was, give or take: nothing is lost to the rule, and nothing piles up)
  const after = all().filter((q) => q.point >= 0 && tiers[q.point] === 3 && !points[q.point].arms && !points[q.point].keeps).length;
  // (things age away and come back after their wait, so over two and a half hours with nobody about a town is a few in a
  // hundred short at any moment: the old roll as well, 1539 and 1500)
  assert.ok(Math.abs(after - before) <= before * 0.04, `Kamenka held ${before} things and holds ${after}`);
});

ok('the fort on the mountain is stocked on top of the map: the army\'s things in its armoury, a dressing station\'s in its cells, and nothing taken from anywhere else', () => {
  const own = every.filter((p) => apartOf(p.building)), free = own.filter((p) => !p.arms && !p.keeps);
  assert.ok(own.length >= 40, `${own.length} places in the fort`);
  for (const { fort } of worlds) {
    const loose = fort.filter(({ p }) => !p.arms && !p.keeps);
    // (well stocked, and not a shop)
    assert.ok(loose.length >= free.length * 0.45 && loose.length <= free.length * 0.9, `${loose.length} things in the fort's ${free.length} free places`);
    const top = loose.filter(({ p }) => p.tier === 4);
    assert.ok(top.length >= 10, `${top.length} things of the fourth step in the fort`);
    // (each thing lies in a spot of a kind it is kept in, on every step: no rifle on a cot, no blood in the armoury)
    for (const { id, p } of loose) assert.ok((APART_KIND[id] ?? []).some((u) => p.usage.includes(u)) || TYPES[id].usage.some((u) => p.usage.includes(u)) || (TYPES[id].on?.[p.tier!]?.usage ?? []).some((u) => p.usage.includes(u)), `${id} in the fort's ${p.usage.join(' and ')}`);
    // (and it is a garrison's store, 2026-10-13: a magazine for each rifle of its racks, a scope, and what a wound needs)
    const has = (id: string) => loose.filter((l) => l.id === id).length;
    for (const [id, n] of [['mag_ak', 2], ['mag_ar', 2], ['mag_sniper', 1], ['pu_scope', 1], ['stim_combat', 2], ['blood_bag', 2], ['firstaid', 2], ['grenade', 2]] as const) assert.ok(has(id) >= n, `${has(id)} of ${id} in the fort, and ${n} are always there`);
    // (its guns are on its racks, a rifle among them; what lies loose is what goes with them, and a dressing station's things)
    const guns = fort.filter(({ id, p }) => p.tier === 4 && ITEMS[id].weapon), med = top.filter(({ id }) => ITEMS[id].category === 'medical').length;
    assert.ok(guns.length >= 4 && med >= 2, `${guns.length} guns and ${med} medical things in the fort's fourth step`);
    // (and the racks that always hold a gun hold one)
    const racks = own.filter((p) => p.arms === 'guns').length;
    assert.ok(racks >= 4 && fort.filter(({ p, id }) => p.arms === 'guns' && ITEMS[id].weapon).length === racks, `${racks} racks in the fort, not all with a gun`);
  }
});

console.log(`\n${n} checks passed`);
