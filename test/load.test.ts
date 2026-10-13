// Checks of what a load does to whoever carries it (src/sim/load.ts), and of the weights it is worked from (the
// `weight` of every item in src/sim/items.ts), of 2026-10-13. No network, no world: `npx tsx test/load.test.ts`.
//
// What was asked: "Make sure our weight balance makes sense, perhaps dayz has some info on this or theres server
// files to look at for ratios im not sure." DayZ's rule is its script's: six kilograms for nothing, 1.75 of a
// hundred of stamina for each one past them. What is held to here is that rule, what it is to feel like for five
// survivors as they are really kitted (a new arrival unburdened, a rifleman plainly shorter of breath, a man under
// two rifles and a rucksack of ammunition hardly able to sprint, and nobody ever stood still), and that the table
// of weights hangs together: a full magazine is the empty one and its rounds, a box its rounds and a little card,
// more armour is more weight.

import assert from 'node:assert/strict';
import { LOAD, breathOf, heavy, paceOf, runCost } from '../src/sim/load';
import { CLOTHES, FITTED, ITEMS, itemWeight, loadGun, makeItem, makeMag, type ItemDef } from '../src/sim/items';
import { PlayerInventory } from '../src/sim/inventory';
import { KITS, type KitThing } from '../src/sim/kits';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const many = (k: number, t: KitThing): KitThing[] => Array.from({ length: k }, () => ({ ...t }));

/** what somebody weighs down with these things on a new survivor, in kilograms: all of it has to find room */
const carried = (things: KitThing[]): number => {
  const inv = new PlayerInventory();
  for (const t of things) {
    const it = makeItem(t.id, t.qty);
    if (t.mag !== undefined) it.mag = t.mag;
    if (t.loaded !== undefined) it.loaded = t.loaded;
    if (t.rounds !== undefined) it.rounds = t.rounds;
    if (t.mods) it.mods = [...t.mods];
    assert.equal(inv.add(it), null, `no room for ${t.id}`);
  }
  return inv.weight();
};

// Five survivors, as they are found at each step of the map. (What is worn comes first, so that its pockets are there.)
const M9: KitThing = { id: 'm9', mag: 'mag_m9', loaded: 16 };
const FRESH = KITS.find((k) => k.id === 'spawn')!.things;
const SCAVENGER: KitThing[] = [
  { id: 'sack_pack' }, { id: 'patrol_cap' }, { id: 'garden_gloves' }, M9, { id: 'mag_m9', rounds: 15 }, { id: 'box_9mm' },
  { id: 'hatchet' }, { id: 'flashlight' }, { id: 'compass' }, { id: 'beans' }, { id: 'sprats' }, { id: 'flask' }, { id: 'bandage', qty: 2 },
];
const FIGHTER: KitThing[] = [
  { id: 'sack_pack' }, { id: 'soft_vest' }, { id: 'helmet_m1' }, { id: 'rubber_boots' }, { id: 'garden_gloves' },
  { id: 'mpa', mag: 'mag_mpa', loaded: 31, mods: ['red_dot'] }, ...many(3, { id: 'mag_mpa', rounds: 30 }), M9, { id: 'mag_m9', rounds: 15 }, ...many(2, { id: 'box_9mm' }),
  { id: 'knife' }, { id: 'flashlight' }, { id: 'compass' }, { id: 'bandage', qty: 3 }, { id: 'stim', qty: 1 }, { id: 'beans' }, { id: 'sardines' }, { id: 'flask' },
];
const RIFLEMAN: KitThing[] = [
  { id: 'camping_pack' }, { id: 'life_vest' }, { id: 'boonie_hat' }, { id: 'gasmask' }, { id: 'rubber_boots' }, { id: 'work_gloves' },
  { id: 'ar15', mag: 'mag_ar', loaded: 31, mods: ['red_dot', 'suppressor_556', 'foregrip', 'gun_light'] }, ...many(5, { id: 'mag_ar', rounds: 30 }),
  M9, { id: 'mag_m9', rounds: 15 }, ...many(2, { id: 'box_556' }), { id: 'grenade' },
  { id: 'firstaid' }, { id: 'bandage', qty: 5 }, { id: 'stim', qty: 2 }, { id: 'blood_bag' }, { id: 'saline' }, { id: 'splint' },
  { id: 'beans' }, { id: 'sprats' }, { id: 'flask' }, { id: 'binoculars' }, { id: 'compass' }, { id: 'flashlight' }, { id: 'knife' },
];
const MULE: KitThing[] = [
  { id: 'suitcase' }, { id: 'heavy_armor' }, { id: 'helmet_k63' }, { id: 'rubber_boots' }, { id: 'work_gloves' },
  { id: 'ak', mag: 'drum_ak', loaded: 76, mods: ['red_dot', 'suppressor_739'] }, { id: 'ar15', mag: 'mag_ar_60', loaded: 61, mods: ['red_dot', 'suppressor_556', 'foregrip', 'gun_light'] },
  { id: 'deagle', mag: 'mag_deagle', loaded: 8 },
  ...many(2, { id: 'drum_ak', rounds: 75 }), ...many(4, { id: 'mag_ak', rounds: 30 }), ...many(2, { id: 'mag_ar_60', rounds: 60 }), ...many(4, { id: 'mag_ar', rounds: 30 }),
  ...many(6, { id: 'box_739' }), ...many(6, { id: 'box_556' }), ...many(2, { id: 'box_12' }), ...many(2, { id: 'box_762' }), ...many(2, { id: 'grenade' }), { id: 'bandage', qty: 5 }, { id: 'beans' },
];

ok("the shape is DayZ's and the figures are kinder: more kilograms for nothing, and less of a breath for each one more", () => {
  // (DayZ's are 6 kg and 1.75%. They were tried, and the user found them too much: see the top of src/sim/load.ts.)
  assert.ok(LOAD.free >= 6 && LOAD.free <= 10);
  assert.ok(LOAD.perKg > 0.008 && LOAD.perKg <= 0.0175);
  for (const kg of [0, 2.3, LOAD.free - 0.01, LOAD.free]) assert.equal(breathOf(kg), 1, `${kg} kg costs something`);
  assert.ok(near(breathOf(LOAD.free + 10), 1 - 10 * LOAD.perKg));
  assert.ok(breathOf(LOAD.free + 0.5) < 1);
  // (a full fighting kit, 30 kg, still runs at least seven tenths as far as a bare man)
  assert.ok(breathOf(30) >= 0.7, `30 kg leaves ${breathOf(30).toFixed(2)}`);
});

ok('more weight is never more breath or more pace; a breath is never worth less than three fifths, and nobody is stood still', () => {
  let b = 1, p = 1;
  for (let kg = 0; kg <= 400; kg += 0.25) {
    assert.ok(breathOf(kg) <= b && paceOf(kg) <= p, `${kg} kg is lighter to carry than a little less`);
    b = breathOf(kg);
    p = paceOf(kg);
    assert.ok(b >= LOAD.least && b <= 1 && p >= LOAD.slowest && p <= 1);
  }
  assert.equal(breathOf(400), LOAD.least);
  assert.equal(paceOf(400), LOAD.slowest);
  // (2026-10-13, the user: "the sprint skew is too dramatic near the top end", then "a bit to harsh": the least was a
  // fifth, then a half, and is two thirds or thereabouts)
  assert.ok(LOAD.least >= 0.6 && LOAD.slowest >= 0.5, 'the least is too little to move on');
  // (a weight that is no weight is nothing carried)
  for (const odd of [NaN, -5, -Infinity]) assert.deepEqual([breathOf(odd), paceOf(odd), runCost(odd)], [1, 1, 1]);
  assert.deepEqual([breathOf(Infinity), paceOf(Infinity)], [LOAD.least, LOAD.slowest]);
});

ok('the breath is at its least from a full fighting kit, and the legs slow only far past one', () => {
  const at = heavy();
  assert.ok(at > 30 && at < 45, `a breath is at its least from ${at} kg`);
  assert.ok(near(breathOf(at), LOAD.least));
  assert.ok(breathOf(at - 1) > LOAD.least);
  assert.ok(LOAD.slowsFrom >= at + 15, 'the legs slow before the breath has given all it has to give');
  for (let kg = 0; kg <= LOAD.slowsFrom; kg += 0.5) assert.equal(paceOf(kg), 1, `${kg} kg slows the legs`);
  assert.ok(paceOf(LOAD.slowsFrom + 1) < 1 && near(paceOf(LOAD.slowsFrom + 10), 1 - 10 * LOAD.slows));
  // (and gently: ten kilograms past it is a tenth of the pace, where the old rule took a fifth for the same)
  assert.ok(LOAD.slows <= 0.012);
});

ok('running costs more by exactly what the breath is short', () => {
  for (const kg of [0, 6, 12, 26.8, 41.6, 52, 90]) assert.ok(near(runCost(kg) * breathOf(kg), 1));
  assert.equal(runCost(3), 1);
  assert.ok(near(runCost(400), 1 / LOAD.least));
});

ok('a new arrival is unburdened, and has room under the free weight for what is first found', () => {
  const clothes = CLOTHES.reduce((s, [, id]) => s + ITEMS[id].weight, 0);
  const fresh = carried(FRESH);
  assert.ok(fresh > clothes, 'the clothes stood in weigh nothing');
  assert.equal(breathOf(fresh), 1);
  assert.equal(paceOf(fresh), 1);
  assert.ok(fresh <= LOAD.free - 2, `a new life starts at ${fresh.toFixed(1)} kg: a pistol and a tin are already a burden`);
});

ok('each step of the map is a little shorter of breath: scavenger, fighter, rifleman', () => {
  const [scav, fight, rifle] = [SCAVENGER, FIGHTER, RIFLEMAN].map((l) => breathOf(carried(l)));
  // (a day pack, a pistol and a hatchet: nothing at all)
  assert.ok(scav >= 0.97, `a scavenger has ${scav.toFixed(2)} of a breath`);
  // (a submachine gun, a soft vest and a steel helmet: a second or three off a sprint)
  assert.ok(fight >= 0.8 && fight <= 0.95 && fight < scav - 0.04, `a fighter has ${fight.toFixed(2)}`);
  // (a rifle and six magazines, plates, helmet, pack: shorter of breath, and well able to run)
  assert.ok(rifle >= 0.65 && rifle <= 0.85 && rifle < fight - 0.06, `a rifleman has ${rifle.toFixed(2)}`);
  for (const l of [SCAVENGER, FIGHTER, RIFLEMAN]) assert.equal(paceOf(carried(l)), 1, 'somebody kitted to fight is slowed at a walk');
});

ok('plates are a price: the same rifleman without his carrier and helmet runs a good deal further', () => {
  const light = RIFLEMAN.filter((t) => t.id !== 'life_vest' && t.id !== 'boonie_hat');
  const [bare, plated] = [breathOf(carried(light)), breathOf(carried(RIFLEMAN))];
  assert.ok(bare - plated >= 0.06, `plates and a helmet cost ${(bare - plated).toFixed(2)} of a breath`);
});

ok('two rifles and a rucksack of ammunition: hardly a sprint left, slower on the feet, and still going', () => {
  const kg = carried(MULE);
  assert.ok(kg > heavy(), `it comes to ${kg.toFixed(1)} kg`);
  assert.equal(breathOf(kg), LOAD.least);
  assert.ok(paceOf(kg) >= 0.85, `it leaves ${paceOf(kg).toFixed(2)} of the pace`);
});

ok('every kit an admin can hand out can be carried, and none of them slows the legs', () => {
  // (the heaviest of them, a drum and the best armour, is a kilo or two short of the weight that does: one more
  // thing in a kit and this says so)
  for (const k of KITS.filter((kit) => !kit.adds)) {
    const kg = carried(k.things);
    assert.equal(paceOf(kg), 1, `the ${k.name} kit is ${kg.toFixed(1)} kg, and the legs slow from ${LOAD.slowsFrom}`);
  }
});

// ------------------------------------------------------------------ the table of weights

const all = Object.values(ITEMS);
const g = (kg: number) => Math.round(kg * 1000);

ok('everything weighs something, and no one thing more than fifteen kilograms', () => {
  for (const d of all) {
    assert.ok(d.weight > 0, `${d.id} weighs nothing`);
    assert.ok(d.weight <= 15, `${d.id} weighs ${d.weight} kg`);
    assert.equal(itemWeight(makeItem(d.id, 1)), d.weight, `one ${d.id} by itself does not weigh what it says`);
  }
});

ok('a pile weighs its count', () => {
  for (const d of all.filter((x) => x.stack)) assert.ok(near(itemWeight(makeItem(d.id, d.stack)), d.weight * d.stack!), d.id);
});

ok('a full magazine is the empty one and its rounds', () => {
  for (const d of all.filter((x) => x.mag)) {
    const rounds = d.mag!.capacity * ITEMS[d.mag!.ammo].weight;
    assert.ok(near(itemWeight(makeMag(d.id, d.mag!.capacity)), d.weight + rounds), d.id);
    // (Rounds weigh what DayZ has them weigh, about half the real thing, and a magazine what a real one does: so
    // an empty one may outweigh what goes into it, as DayZ's do, but never by more than three times: the rifle's
    // five-round box comes nearest.)
    assert.ok(d.weight < rounds * 3, `${d.id} empty (${g(d.weight)} g) far outweighs what it holds (${g(rounds)} g)`);
  }
});

ok('a bigger magazine for the same gun outweighs the smaller', () => {
  const mags = all.filter((x) => x.mag);
  let pairs = 0;
  for (const a of mags) for (const b of mags) {
    if (a.attach!.fits[0] !== b.attach!.fits[0] || a.mag!.capacity >= b.mag!.capacity) continue;
    pairs++;
    assert.ok(b.weight > a.weight, `${b.id} is no heavier than ${a.id}`);
  }
  assert.ok(pairs >= 4);
});

ok('a box is its rounds and a little card', () => {
  for (const d of all.filter((x) => x.open)) {
    const card = d.weight - d.open!.qty * ITEMS[d.open!.gives].weight;
    assert.ok(card >= 0.005 && card <= 0.06, `${d.id}: ${g(card)} g of card round ${d.open!.qty} rounds`);
  }
});

ok('a gun weighs itself, what is fitted to it and what is in it', () => {
  for (const d of all.filter((x) => x.weapon)) {
    const gun = loadGun(makeItem(d.id), 999);
    gun.mods = (FITTED[d.id] ?? []).map(([m]) => m).filter((m) => !ITEMS[m].mag);
    const parts = gun.mods.reduce((s, m) => s + ITEMS[m].weight, 0) + (gun.mag ? ITEMS[gun.mag].weight : 0);
    assert.ok(near(itemWeight(gun), d.weight + parts + (gun.loaded ?? 0) * ITEMS[d.weapon!.ammo].weight), d.id);
    assert.ok(itemWeight(gun) > d.weight);
  }
  // (a long gun outweighs a pistol, whatever the pistol)
  const long = all.filter((x) => x.weapon && x.slot === 'long'), short = all.filter((x) => x.weapon && x.slot === 'holster');
  assert.ok(Math.min(...long.map((x) => x.weight)) > Math.max(...short.map((x) => x.weight)));
});

ok('more of what a thing is for is more weight: armour, helmets, packs, stashes', () => {
  const ladder = (ids: string[], of: (d: ItemDef) => number) => {
    const l = ids.map((id) => ITEMS[id]);
    for (let i = 1; i < l.length; i++) {
      assert.ok(of(l[i]) > of(l[i - 1]), `${l[i].id} is listed after ${l[i - 1].id} and is no more`);
      assert.ok(l[i].weight > l[i - 1].weight, `${l[i].id} is no heavier than ${l[i - 1].id}`);
    }
  };
  ladder(['chest_rig', 'soft_vest', 'armor_vest', 'life_vest', 'heavy_armor'], (d) => 1 - d.wear!.armor!);
  ladder(['patrol_cap', 'helmet_m1', 'boonie_hat', 'helmet_k63'], (d) => 1 - d.wear!.head!);
  ladder(['sack_pack', 'camping_pack', 'suitcase'], (d) => d.wear!.cargo![0] * d.wear!.cargo![1]);
  ladder(['black_bag', 'old_suitcase', 'stash_kit'], (d) => d.stash![0] * d.stash![1]);
  // (Armour was tried at what plates really weigh, 8 and 12 kg, and the user found it too much, 2026-10-13: "armour
  // weight might be too dramatic". It is as it was before: a price, and not a ball and chain.)
  assert.ok(ITEMS.life_vest.weight <= 6 && ITEMS.heavy_armor.weight <= 9);
});

ok('the biggest pack takes two rifles since its grid grew (9x7, 2026-10-13), and they are paid for in breath: room is not what limits a load, weight is', () => {
  // (a rifleman as he is found, with the Field Rucksack on his back in place of the camping pack)
  const base = RIFLEMAN.map((t) => (t.id === 'camping_pack' ? { id: 'suitcase' } : t));
  const AK: KitThing = { id: 'ak', mag: 'mag_ak', loaded: 31 };
  // one rifle more fills the second place on his back; the two after that have nowhere but the pack, and find room there
  const one = carried(base), two = carried([...base, AK]), four = carried([...base, AK, AK, AK]);
  const rifle = itemWeight(Object.assign(makeItem('ak'), { mag: 'mag_ak', loaded: 31 }));
  assert.ok(near(four - two, 2 * rifle, 1e-6), `two rifles in the pack weigh ${(four - two).toFixed(2)} kg more, and two loaded AKs weigh ${(2 * rifle).toFixed(2)}`);
  assert.ok(breathOf(four) < breathOf(two) && breathOf(two) < breathOf(one), 'a rifle more costs no breath');
  // (and nobody is slowed on their feet by it: that begins far above anything a pack of rifles comes to)
  assert.equal(paceOf(four), 1);
  // a pack of nothing but rifles, by itself: three Mosins across it
  const pack = new PlayerInventory();
  pack.add(makeItem('suitcase'));
  for (let k = 0; k < 3; k++) assert.equal(pack.cargoOf(pack.slots.back!)!.add(loadGun(makeItem('mosin'), 999)), null);
  const full = itemWeight(pack.slots.back!);
  assert.ok(full > 12 && full > LOAD.free, `a rucksack of three Mosins weighs ${full.toFixed(1)} kg: it costs nothing`);
  const pc = (kg: number) => `${kg.toFixed(1)} kg, a breath runs ${Math.round(breathOf(kg) * 100)}% as far`;
  console.log(`      (a rifleman with the rucksack: ${pc(one)}; with a second rifle on his back: ${pc(two)}; with two more in the pack: ${pc(four)}; a rucksack of three Mosins by itself: ${full.toFixed(1)} kg)`);
});

console.log(`\n${n} checks passed`);
