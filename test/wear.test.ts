// What is worn on the head and the face, and what was made of the packs the user brought in, 2026-10-13
// (src/sim/items.ts): the gas mask, the helmets, and the pouch between a stim and the First Aid Kit. What each is,
// what each does beside its neighbours, and where each is kept.   npx tsx test/wear.test.ts
//
//   - there is one gas mask, the GP-5, and it is built without the hose and the filter can it came with
//   - whatever asks whether a mask is on asks for `wear.gas`, never for a name
//   - the K6-3 is built with its visor down, and it stays down: nothing in the model puts it up again
//   - the steel helmet is the weakest thing that is a helmet: between a cap and the Combat Helmet, and the army's
//   - a stim, the pouch and the kit each do something neither of the others does
//   - nothing new lies on a step in more places than what it stands in for gave up

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BLOOD } from '../src/sim/blood';
import { TYPES } from '../src/sim/economy';
import { CARTRIDGES } from '../src/sim/gunplay';
import { PlayerInventory } from '../src/sim/inventory';
import { ITEMS, makeItem } from '../src/sim/items';
import { KITS } from '../src/sim/kits';
import { ITEM_SIZES } from '../src/sim/placement';
import { STALLS } from '../src/sim/camp';

/** what the trader camp's stalls sell, and what a thing is worth to them (src/sim/camp.ts) */
const STOCK = Object.values(STALLS).flatMap((s) => s.sells.map((g) => g.id));
const worth = (id: string) => ITEMS[id]?.worth ?? 0;

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};
const models = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')).models as Record<string, { url: string; hi?: string; tris: number; srcTris: number; min: number[]; max: number[] }>;
/** what a built model says of itself: the first part of its file, which is plain text */
const said = (url: string) => {
  const file = readFileSync(`public/${url}`);
  return JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString('utf8')) as { materials: { name: string; alphaMode?: string }[]; meshes: { primitives: { attributes: Record<string, number>; material: number }[] }[] };
};
/** what a bullet does to a head, as src/sim/combat.ts has it */
const HEAD = 3.2;

ok('there is one gas mask, the GP-5: no painted ones, and no model of theirs is shipped', () => {
  const masks = Object.values(ITEMS).filter((d) => d.wear?.gas);
  assert.deepEqual(masks.map((d) => d.id), ['gasmask']);
  assert.deepEqual(Object.keys(ITEMS).filter((id) => id.startsWith('gasmask')), ['gasmask']);
  const d = ITEMS.gasmask;
  assert.deepEqual([d.model, d.slot, d.category, d.w, d.h], ['old_gas_mask', 'face', 'clothing', 2, 2]);
  assert.ok(ITEM_SIZES.gasmask, 'the mask has no size to be laid on a shelf by');
  assert.deepEqual(Object.keys(models).filter((id) => id.startsWith('gas_mask')), []);
  assert.deepEqual(Object.keys(TYPES).filter((id) => id.startsWith('gasmask')), ['gasmask']);
});

ok('the mask is built alone: the hood and its valve, without the metre of hose and the filter can it came with', () => {
  const m = models.old_gas_mask;
  const size = m.max.map((v, k) => v - m.min[k]);
  // (with its hose it was 1.13 m from its crown to the foot of its can)
  assert.ok(Math.max(...size) < 0.36, `the mask is ${Math.max(...size).toFixed(2)} m long`);
  // (it lies on its back, its eyepieces up: lower than it is long, and longer than it is wide)
  assert.ok(size[1] < size[2] && size[0] < size[2]);
  // (every triangle of what is kept: the hose, its coupling and the can were 10,004 of its 18,900)
  assert.deepEqual([m.srcTris, m.tris], [18900, 8896]);
  // (and what is laid in the world is that size, give or take the centimetre it is said to)
  ITEM_SIZES.gasmask.forEach((v, k) => assert.ok(Math.abs(v - size[k]) < 0.006, `the mask is said to be ${ITEM_SIZES.gasmask} and is ${size.map((x) => x.toFixed(3))}`));
});

ok('the mask on the face keeps the gas out: nothing asks for it by name', () => {
  const bare = new PlayerInventory();
  assert.equal(bare.wear('gas').length, 0);
  const inv = new PlayerInventory();
  assert.equal(inv.add(makeItem('gasmask')), null);
  assert.equal(inv.slots.face?.id, 'gasmask');
  assert.equal(inv.wear('gas').length, 1);
  assert.deepEqual(inv.wear('head'), [ITEMS.gasmask.wear!.head]);
  // (and a second mask is carried, not worn over the first)
  assert.equal(inv.add(makeItem('gasmask')), null);
  assert.equal(inv.wear('gas').length, 1);
  // (what the game and the server read is the item's own word, and no list of names)
  for (const file of ['src/game/game.ts', 'src/game/gas.ts', 'src/sim/gas.ts', 'server/index.ts']) assert.ok(!/['"]gasmask['"]\s*(===|!==)|(===|!==)\s*['"]gasmask['"]/.test(readFileSync(file, 'utf8').replace(/id === 'gasmask' \? facepiece\(model\) : model/, '')), `${file} asks for the gas mask by its name`);
});

ok('the masks are a policeman\'s: three in the village and two in Kamenka, as there were', () => {
  assert.deepEqual(TYPES.gasmask.at, [0, 0, 5, 0, 0]);
  assert.deepEqual(TYPES.gasmask.usage, ['Police']);
  assert.ok(STOCK.includes('gasmask') && worth('gasmask') > worth('boonie_hat'));
});

ok('the K6-3 is built with its visor down and its glass apart from its steel, and nothing in it puts the visor up again', () => {
  const m = models.helmet_k63;
  // (with its visor raised it stood 28 cm tall and 37.7 cm from the visor's edge to the nape: down, the visor's
  // lower edge is what it stands on, and it is no longer than its shell and the visor's frame)
  assert.ok(m.max[1] - m.min[1] > 0.3 && m.max[2] - m.min[2] < 0.345, `the K6-3 is ${m.max.map((v, k) => (v - m.min[k]).toFixed(3))}`);
  assert.equal(m.tris, m.srcTris);
  ITEM_SIZES.helmet_k63.forEach((v, k) => assert.ok(Math.abs(v - (m.max[k] - m.min[k])) < 0.006, `the K6-3 is said to be ${ITEM_SIZES.helmet_k63}`));
  for (const url of [m.url, m.hi!]) {
    const file = said(url), prims = file.meshes.flatMap((mesh) => mesh.primitives);
    // (two paints of the one picture: the panes of the visor are seen through, and nothing else of it is)
    assert.deepEqual(file.materials.map((mat) => mat.alphaMode ?? 'OPAQUE').sort(), ['BLEND', 'OPAQUE'], url);
    assert.equal(prims.length, 2, url);
    // (the visor is down for good, "keep the visor down": no shape of it carries the way back to where it was)
    for (const prim of prims) assert.deepEqual(Object.keys(prim.attributes).filter((name) => name.startsWith('_')), [], `${url}: a shape of the K6-3 still says where its visor was`);
  }
});

ok('the steel helmet is the weakest thing that is a helmet: between a cap and the Combat Helmet, and it turns a 9 mm and no more', () => {
  const pot = ITEMS.helmet_m1, head = (id: string) => ITEMS[id].wear!.head!;
  assert.deepEqual([pot.slot, pot.category, pot.w, pot.h], ['head', 'clothing', 2, 2]);
  assert.ok(models[pot.model] && ITEM_SIZES.helmet_m1);
  assert.ok(head('patrol_cap') > head('helmet_m1') && head('helmet_m1') > head('boonie_hat') && head('boonie_hat') > head('helmet_k63'));
  assert.ok(pot.weight < ITEMS.boonie_hat.weight && pot.weight > ITEMS.patrol_cap.weight);
  // (at the muzzle: a 9 mm to a bare head is the end, under the pot it leaves 13 of a hundred, and a cap leaves 2)
  const nine = CARTRIDGES.ammo_9mm.damage * HEAD;
  assert.ok(nine > 100 && Math.round(100 - nine * head('helmet_m1')) === 13 && Math.round(100 - nine * head('patrol_cap')) === 2);
  // (a .45 and every rifle's round are still the end under it; under a Combat Helmet the 5.56 is not)
  for (const id of ['ammo_45', 'ammo_556', 'ammo_739', 'ammo_762']) assert.ok(CARTRIDGES[id].damage * HEAD * head('helmet_m1') > 100, id);
  assert.ok(CARTRIDGES.ammo_556.damage * HEAD * head('boonie_hat') < 100);
  // (the army's, on the pistols' step and a couple in Kamenka: commoner below the gas than the Combat Helmet, and never the bunker's)
  const at = TYPES.helmet_m1.at, combat = TYPES.boonie_hat.at;
  assert.deepEqual(TYPES.helmet_m1.usage, ['Military']);
  assert.ok(at[0] === 0 && at[1] + at[2] > combat[1] + combat[2] && at[3] + at[4] === 0);
  assert.ok(worth('helmet_m1') > worth('patrol_cap') && worth('helmet_m1') < worth('boonie_hat') && !STOCK.includes('helmet_m1'));
});

ok('the pink stim is the white one and the yellow one at one press: five to a pile, and only under the gas and down the bunker', () => {
  const white = ITEMS.stim.use!, yellow = ITEMS.stim_stamina.use!, pink = ITEMS.stim_combat, u = pink.use!;
  assert.ok(u.stopBleed && u.health === white.health && u.stamina === yellow.stamina && u.boost === yellow.boost && u.time === white.time);
  assert.ok(!u.blood && !u.splint, 'it is a stim, not a kit');
  // ("can stack up to 5 instead of the normal")
  assert.deepEqual([pink.w, pink.h, pink.stack, pink.model], [1, 1, 5, ITEMS.stim.model]);
  assert.ok(ITEMS.stim.stack === 3 && ITEMS.stim_stamina.stack === 3);
  // (told from the other two by its barrel)
  assert.ok(pink.paint !== undefined && pink.paint !== ITEMS.stim_stamina.paint && ITEMS.stim.paint === undefined);
  const all = (id: string) => TYPES[id].at.reduce((a, n) => a + n, 0);
  assert.ok(TYPES.stim_combat && all('stim_combat') * 2 <= all('stim_stamina') && all('stim_combat') * 4 <= all('stim'), `${all('stim_combat')} pink against ${all('stim_stamina')} yellow and ${all('stim')} white`);
  // ("the new hybrid stim will be in loot areas T4 and higher", "medical and military")
  assert.deepEqual(TYPES.stim_combat.at.slice(0, 3), [0, 0, 0], 'one below the fourth step');
  assert.ok(TYPES.stim_combat.at[3] > 0 && TYPES.stim_combat.at[4] > 0);
  assert.ok(TYPES.stim_combat.usage.includes('Military') && TYPES.stim_combat.usage.includes('Medic') && TYPES.stim_combat.usage.every((u) => ['Military', 'Medic', 'Hospital'].includes(u)));
  assert.ok(!STOCK.includes('stim_combat'), 'the trader sells it');
  assert.ok(ITEM_SIZES.stim_combat && worth('stim_combat') > worth('stim') && worth('stim_combat') > worth('stim_stamina'));
});

ok('a stim, the pouch and the kit: each does something that neither of the others does', () => {
  const stim = ITEMS.stim, pouch = ITEMS.aid_pouch, kit = ITEMS.firstaid;
  const s = stim.use!, p = pouch.use!, k = kit.use!;
  // (between the two in size and in the time it takes)
  assert.deepEqual([stim.w * stim.h, pouch.w * pouch.h, kit.w * kit.h], [1, 4, 6]);
  assert.deepEqual([pouch.w, pouch.h, pouch.category], [2, 2, 'medical']);
  assert.ok(s.time < p.time && p.time < k.time);
  assert.ok(models[pouch.model] && ITEM_SIZES.aid_pouch);
  // (all three close a wound)
  assert.ok(s.stopBleed && p.stopBleed && k.stopBleed);
  // the stim: the most health for its size and its time, and nothing else
  assert.ok(s.health! / (stim.w * stim.h) > k.health! / (kit.w * kit.h) && s.health! / s.time > k.health! / k.time && !s.blood && !s.splint);
  // the pouch: the small one of the two that close a wound AND give blood back; less health than a stim, and it sets no leg
  assert.ok(p.blood! > 0 && p.over! > 0 && p.health! < s.health! && p.health! > ITEMS.bandage.use!.health! && !p.splint);
  assert.deepEqual(Object.values(ITEMS).filter((d) => d.use?.stopBleed && d.use.blood).map((d) => d.id).sort(), ['aid_pouch', 'firstaid']);
  // the kit: the most health at one go, a broken leg set, and no less blood than the pouch (2026-10-13: "medkit
  // should recover some blood"), nor as much as a bag
  assert.ok(k.health! > s.health! && k.splint && k.blood! >= p.blood! && k.blood! < ITEMS.saline.use!.blood!);
  // (and the bags are still what blood comes back by: a bag of saline is half the pouch's size and gives more, a bag of blood three times as much)
  assert.ok(p.blood! < ITEMS.saline.use!.blood! && ITEMS.saline.w * ITEMS.saline.h < pouch.w * pouch.h && ITEMS.blood_bag.use!.blood! >= p.blood! * 3);
  // (what it gives is worth having: from where the head swims to where a body can run again, and no more than a fifth of what there is to lose)
  assert.ok(p.blood! >= 400 && p.blood! <= (BLOOD.full - BLOOD.dead) / 5);
  assert.ok(worth('aid_pouch') > worth('bandage') && worth('aid_pouch') < worth('firstaid'));
});

ok('the pouch is a soldier\'s: kept where the army and the police were before a clinic, in what the bandages and the kit gave up', () => {
  const r = TYPES.aid_pouch;
  assert.deepEqual(r.at, [0, 1, 13, 1, 1]);
  assert.ok(r.usage.includes('Military') && r.usage.includes('Police') && (r.favour?.Military ?? 0) > 1 && !r.usage.includes('Village') && !r.usage.includes('Shop'));
  // (what lay on each step in bandages, kits and pouches together: the village's share of the second step moved to the third with it, 2026-10-17)
  assert.deepEqual([0, 1, 2, 3, 4].map((t) => TYPES.bandage.at[t] + TYPES.firstaid.at[t] + r.at[t]), [16, 5, 151, 5, 6]);
  // (and the same of the caps and the steel helmet; the bunker's Combat Helmets are the four they were)
  assert.deepEqual([0, 1, 2, 3, 4].map((t) => TYPES.patrol_cap.at[t] + TYPES.helmet_m1.at[t]), [0, 6, 12, 0, 0]);
  assert.equal(TYPES.boonie_hat.at[4], 4);
  // (every kit an admin hands out that has the First Aid Kit in it has the pouch)
  for (const kit of KITS) assert.equal(kit.things.some((t) => t.id === 'firstaid'), kit.things.some((t) => t.id === 'aid_pouch'), kit.id);
});

console.log(`\n${n} checks passed`);
