// What was made of the packs the user brought in, 2026-10-13 (src/sim/items.ts): the respirator in its four
// paints, the steel helmet, and the pouch between a stim and the First Aid Kit. What each is, what each does beside
// its neighbours, and where each is kept.   npx tsx test/wear.test.ts
//
//   - any of the four masks is a gas mask: whatever asks whether one is on asks for `wear.gas`, never for a name
//   - the black one is the ordinary one (the village's police); the painted ones are further in
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
import { STOCK, worth } from '../src/sim/trade';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};
const MASKS = ['gasmask', 'gasmask_white', 'gasmask_orange', 'gasmask_skull'];
const models = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')).models as Record<string, unknown>;
/** what a bullet does to a head, as src/sim/combat.ts has it */
const HEAD = 3.2;

ok('the mask is the respirator now, in four paints, each a model of its own that the game ships', () => {
  assert.equal(ITEMS.gasmask.model, 'gas_mask_black');
  assert.deepEqual(MASKS.map((id) => ITEMS[id].model), ['gas_mask_black', 'gas_mask_white', 'gas_mask_orange', 'gas_mask_skull']);
  for (const id of MASKS) {
    const d = ITEMS[id];
    assert.ok(models[d.model], `${id} is drawn with ${d.model}, which is not among the game's models`);
    assert.deepEqual([d.slot, d.category, d.w, d.h, d.weight, d.wear], ['face', 'clothing', 2, 2, ITEMS.gasmask.weight, ITEMS.gasmask.wear], id);
    assert.ok(ITEM_SIZES[id], `${id} has no size to be laid on a shelf by`);
  }
  assert.equal(new Set(MASKS.map((id) => ITEMS[id].name)).size, 4, 'two masks are called the same');
});

ok('any of the four on the face keeps the gas out: nothing asks for one of them by name', () => {
  const bare = new PlayerInventory();
  assert.equal(bare.wear('gas').length, 0);
  for (const id of MASKS) {
    const inv = new PlayerInventory();
    assert.equal(inv.add(makeItem(id)), null);
    assert.equal(inv.slots.face?.id, id, `${id} was not put on the face`);
    assert.equal(inv.wear('gas').length, 1, `${id} on the face, and the gas is not kept out`);
    assert.deepEqual(inv.wear('head'), [ITEMS.gasmask.wear!.head]);
    // (and a second mask is carried, not worn over the first)
    assert.equal(inv.add(makeItem(MASKS[(MASKS.indexOf(id) + 1) % 4])), null);
    assert.equal(inv.wear('gas').length, 1);
  }
  // (what the game and the server read is the item's own word, and no list of names)
  for (const file of ['src/game/game.ts', 'src/game/gas.ts', 'src/sim/gas.ts', 'server/index.ts']) assert.ok(!/['"]gasmask['"]\s*(===|!==)|(===|!==)\s*['"]gasmask['"]/.test(readFileSync(file, 'utf8').replace(/id === 'gasmask' \? facepiece\(model\) : model/, '')), `${file} asks for the gas mask by its name`);
});

ok('the black mask is the ordinary one, the painted ones are further in, and the map has as many to get into the gas with as it had', () => {
  const at = (id: string) => TYPES[id].at;
  assert.deepEqual(at('gasmask'), [0, 3, 0, 0, 0]);
  assert.deepEqual(at('gasmask_white'), [0, 0, 1, 0, 0]);
  assert.deepEqual(at('gasmask_orange'), [0, 0, 1, 0, 0]);
  assert.deepEqual(at('gasmask_skull'), [0, 0, 0, 0, 1]);
  // (five in the police stations, as there were of the one mask: three in the village and two in Kamenka; and none under the gas itself)
  assert.deepEqual([0, 1, 2, 3].map((t) => MASKS.reduce((s, id) => s + at(id)[t], 0)), [0, 3, 2, 0]);
  for (const id of ['gasmask', 'gasmask_white', 'gasmask_orange']) assert.deepEqual(TYPES[id].usage, ['Police'], id);
  // (he sells the plain one and takes any of them; a painted one is worth more to him)
  assert.ok(STOCK.includes('gasmask') && MASKS.slice(1).every((id) => !STOCK.includes(id) && worth(id) > worth('gasmask')));
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
  // the pouch: the one thing that closes a wound AND gives blood back; less health than a stim, and it sets no leg
  assert.ok(p.blood! > 0 && p.over! > 0 && p.health! < s.health! && p.health! > ITEMS.bandage.use!.health! && !p.splint);
  assert.deepEqual(Object.values(ITEMS).filter((d) => d.use?.stopBleed && d.use.blood).map((d) => d.id), ['aid_pouch']);
  // the kit: the most health at one go, and a broken leg set; nothing for blood
  assert.ok(k.health! > s.health! && k.splint && !k.blood);
  // (and the bags are still what blood comes back by: a bag of saline is half the pouch's size and gives more, a bag of blood three times as much)
  assert.ok(p.blood! < ITEMS.saline.use!.blood! && ITEMS.saline.w * ITEMS.saline.h < pouch.w * pouch.h && ITEMS.blood_bag.use!.blood! >= p.blood! * 3);
  // (what it gives is worth having: from where the head swims to where a body can run again, and no more than a fifth of what there is to lose)
  assert.ok(p.blood! >= 400 && p.blood! <= (BLOOD.full - BLOOD.dead) / 5);
  assert.ok(worth('aid_pouch') > worth('bandage') && worth('aid_pouch') < worth('firstaid'));
});

ok('the pouch is a soldier\'s: kept where the army and the police were before a clinic, in what the bandages and the kit gave up', () => {
  const r = TYPES.aid_pouch;
  assert.deepEqual(r.at, [0, 3, 5, 1, 1]);
  assert.ok(r.usage.includes('Military') && r.usage.includes('Police') && (r.favour?.Military ?? 0) > 1 && !r.usage.includes('Village') && !r.usage.includes('Shop'));
  // (what lay on each step in bandages, kits and pouches together is what lay there in bandages and kits before it)
  assert.deepEqual([0, 1, 2, 3, 4].map((t) => TYPES.bandage.at[t] + TYPES.firstaid.at[t] + r.at[t]), [16, 39, 81, 5, 6]);
  // (and the same of the caps and the steel helmet, and of the Combat Helmet and the mask it made way for down the bunker)
  assert.deepEqual([0, 1, 2, 3, 4].map((t) => TYPES.patrol_cap.at[t] + TYPES.helmet_m1.at[t]), [0, 11, 3, 0, 0]);
  assert.equal(TYPES.boonie_hat.at[4] + TYPES.gasmask_skull.at[4], 4);
  // (every kit an admin hands out that has the First Aid Kit in it has the pouch)
  for (const kit of KITS) assert.equal(kit.things.some((t) => t.id === 'firstaid'), kit.things.some((t) => t.id === 'aid_pouch'), kit.id);
});

console.log(`\n${n} checks passed`);
