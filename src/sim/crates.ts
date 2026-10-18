// Searchable crates that are part of the map (military crates at the checkpoint, wooden
// crates in barns, sheds and yards). Unlike ground loot they hide their contents until
// opened, and refill some time after being emptied. Pure data + rules, shared with the
// future server.

import { ITEMS, fitAtRandom, foundMag, makeItem, plainMag, stockGun } from './items';
import type { Container } from './inventory';

type Table = [id: string, weight: number][];

// (By the steps of the map, 2026-10-10. One of the army's cases is of the second step wherever it stands: pistols
// and what they fire, the army's kit; now and then something of the third, an armoured vest, a helmet or a
// submachine gun; and a gas mask, if you are lucky. No rifle, no scope, no plates: those are under the gas. A
// wooden crate is of the first: food, tools, something to hit with, and no gun.)
// (2026-10-13: "ammo should be more abundant in polive stations and armories ... i should find all ammo there":
// a case and a constable's locker hold a handful of every calibre now, the rifles' and the bunker's guns' among
// them, a little of each.)
const MILITARY: Table = [
  ['box_9mm', 3], ['ammo_9mm', 2.5], ['ammo_762', 1.2], ['bandage', 1.8], ['firstaid', 0.7], ['aid_pouch', 0.5], ['stim', 0.7], ['stim_stamina', 0.5], ['saline', 0.4],
  ['condensed', 1.5], ['thermos', 1], ['flask', 0.9], ['binoculars', 0.5], ['compass', 0.5], ['grenade', 0.6],
  ['colt', 1], ['m9', 1], ['box_45', 0.5], ['mag_m9_ext', 0.3], ['suppressor_9', 0.25], ['gun_light', 0.3],
  ['soft_vest', 0.6], ['patrol_cap', 0.35], ['helmet_m1', 0.25], ['rubber_boots', 0.4], ['work_gloves', 0.4], ['flashlight', 0.5], ['jerrycan', 0.4],
  ['armor_vest', 0.22], ['boonie_hat', 0.2], ['gasmask', 0.3],
  ['ammo_45', 1.2], ['mag_m9', 0.6], ['mag_colt', 0.6], ['ammo_739', 0.6], ['ammo_556', 0.6], ['ammo_12', 0.3], ['ammo_50', 0.25], ['mpa', 0.22], ['mag_mpa', 0.35],
];
const CIVILIAN: Table = [
  ['beans', 2], ['sardines', 2], ['sprats', 2], ['tomatoes', 1.5], ['apple', 1.5], ['milk', 1], ['thermos', 0.6], ['water_jug', 0.9], ['flask', 0.5],
  ['bandage', 1.2], ['splint', 0.6], ['cigarettes', 1.2], ['ammo_9mm', 0.6], ['ammo_762', 0.3],
  ['knife', 0.9], ['hatchet', 0.9], ['bat', 0.8], ['crowbar', 0.8], ['machete', 0.6], ['shovel', 0.6],
  ['garden_gloves', 0.8], ['fishermans_hat', 0.6], ['sack_pack', 0.8], ['chest_rig', 0.5], ['flashlight', 1], ['compass', 0.3], ['jerrycan', 0.4],
];

/** what is in any crate that stands under the gas, whatever sort of crate it is: the best of everything */
export const UNDER_GAS: Table = [
  // (the pistols and their rounds a good deal less than they were: the rifles below have their share)
  ['box_762', 3], ['box_9mm', 1.8], ['ammo_762', 1.5], ['ammo_9mm', 0.8], ['mosin', 1.4], ['m9', 0.7], ['colt', 0.4],
  // (the frag grenade, 2026-10-13: where the stick grenade is, a third as often; in none of the army's cases, which are of the second step)
  ['boonie_hat', 2], ['life_vest', 2], ['pu_scope', 1.6], ['grenade', 1.5], ['frag', 0.5], ['firstaid', 1.2], ['aid_pouch', 0.3], ['bandage', 1.5], ['stim', 1], ['stim_stamina', 0.7], ['stim_combat', 0.35], ['blood_bag', 0.7], ['saline', 0.5],
  ['suppressor_9', 0.8], ['box_45', 0.8], ['rifle_wrap', 0.6], ['binoculars', 0.4], ['condensed', 0.8], ['thermos', 0.8], ['suitcase', 0.4],
  ['red_dot', 0.6], ['gun_light', 0.6], ['suppressor_762', 0.5], ['mag_m9_ext', 0.4], ['flask', 0.5], ['keycard', 0.5],
  // (2026-10-10: the two assault rifles and what feeds them)
  ['ak', 0.6], ['mag_ak', 0.6], ['box_739', 0.8], ['ammo_739', 0.4], ['ar15', 0.25], ['mag_ar', 0.3], ['box_556', 0.4], ['mag_sniper', 0.4],
  // (2026-10-11: the submachine gun)
  ['mpa', 0.5], ['mag_mpa', 0.5],
];

/**
 * What is in whatever is searched down the bunker: the fourth and (for now) the best of the
 * places things are kept. The shotgun, the Desert Eagle and all that goes with them, the heavy
 * armour and the K6-3 helmet are here and nowhere else.
 */
const IN_BUNKER: Table = [
  ['benelli', 1.5], ['ammo_12', 3.2], ['box_12', 2.2], ['suppressor_12', 0.9], ['red_dot', 1.1], ['gun_light', 1.1],
  ['mosin', 1.1], ['pu_scope', 1.5], ['suppressor_762', 0.9], ['box_762', 2.2], ['ammo_762', 1.2],
  ['m9', 0.9], ['mag_m9_ext', 0.7], ['suppressor_9', 0.7], ['box_9mm', 1.8], ['deagle', 1.2], ['ammo_50', 2], ['box_50', 1], ['mag_deagle_ext', 0.6],
  ['grenade', 1.8], ['frag', 0.7], ['boonie_hat', 1.8], ['life_vest', 1.8], ['heavy_armor', 0.5], ['helmet_k63', 0.35], ['suitcase', 0.7], ['firstaid', 1.8], ['aid_pouch', 0.4], ['bandage', 2.2], ['stim', 1.3], ['stim_stamina', 1], ['stim_combat', 0.5], ['blood_bag', 1.1], ['saline', 0.7], ['splint', 0.8],
  ['flashlight', 0.9], ['flask', 0.9], ['condensed', 0.8], ['thermos', 0.6], ['water_jug', 0.7], ['beans', 0.7], ['sardines', 0.6],
  // (2026-10-10: the two assault rifles, their big magazines and what is fitted to them)
  ['ar15', 1.1], ['mag_ar', 1.4], ['mag_ar_60', 0.6], ['box_556', 1.8], ['ammo_556', 1.2], ['suppressor_556', 0.6], ['foregrip', 0.7],
  ['ak', 0.8], ['mag_ak', 1], ['drum_ak', 0.6], ['box_739', 1.4], ['ammo_739', 1], ['suppressor_739', 0.5], ['mag_deagle', 0.8], ['mag_sniper', 0.7],
];
// (the submachine gun, the Colt and what feeds them, down the bunker with the rest of the firepower)
IN_BUNKER.push(['mpa', 0.9], ['mag_mpa', 1.1], ['colt', 0.5], ['mag_colt', 0.6], ['box_45', 0.8], ['ammo_45', 0.6]);
/** and on its racks, the long things */
const ON_RACKS: Table = [['mpa', 1.5], ['benelli', 3], ['mosin', 2], ['ar15', 2], ['ak', 1.5], ['box_556', 1.2], ['box_739', 1], ['ammo_12', 2], ['box_12', 1.5], ['box_762', 1.5], ['suppressor_12', 0.8], ['suppressor_762', 0.8], ['pu_scope', 1.2], ['red_dot', 0.8], ['gun_light', 0.8]];

/**
 * The steel cabinets of the hospital, of a clinic and of the police (2026-10-12: "the metal lockers found in the
 * police station and the medical station should be lootable and have inventories"). A hospital's holds what a
 * hospital has, and a great deal of it ("the hospital should be medkit abundant and lots of stims"); a clinic's
 * leans on dressings and stims ("the small medical buildings should lean heavy on bandages and stims and less
 * medkits"); a constable's holds what the police carried: a pistol now and then, a submachine gun more seldom,
 * and what every gun fires.
 */
const IN_MEDICINE: Table = [['bandage', 4.2], ['stim', 3.6], ['stim_stamina', 1.6], ['firstaid', 0.9], ['aid_pouch', 0.3], ['splint', 1.4], ['saline', 1.4], ['blood_bag', 0.4], ['flask', 0.4], ['work_gloves', 0.3]];
const IN_HOSPITAL: Table = [['firstaid', 3.6], ['aid_pouch', 0.4], ['stim', 3.6], ['stim_stamina', 2], ['bandage', 2.2], ['splint', 1.6], ['blood_bag', 2], ['saline', 1.8], ['flask', 0.3], ['work_gloves', 0.3]];
const IN_POLICE: Table = [
  ['box_9mm', 3], ['ammo_9mm', 2.4], ['box_45', 1.2], ['ammo_45', 1.4], ['mag_m9', 1.6], ['mag_colt', 1.6], ['m9', 0.9], ['colt', 1],
  ['soft_vest', 0.9], ['patrol_cap', 0.9], ['flashlight', 0.9], ['bandage', 1], ['aid_pouch', 0.4], ['stim', 0.5], ['stim_stamina', 0.3], ['gun_light', 0.3], ['suppressor_9', 0.2], ['thermos', 0.5], ['cigarettes', 0.5],
  ['ammo_762', 0.8], ['ammo_739', 0.7], ['ammo_556', 0.7], ['ammo_12', 0.4], ['ammo_50', 0.3], ['mpa', 0.45], ['mag_mpa', 0.8],
];
/**
 * A soldier's locker, in a barracks or a long hut (2026-10-13, with the steel lockers the owner brought in): what a
 * man kept by his bed, which is his clothes, something to eat and to smoke, a dressing, a torch, and a handful of
 * what his pistol fired. A pistol itself seldom: those are in the cases. Of the second step of the map, as a case is,
 * and a good deal poorer than one.
 */
const IN_BARRACKS: Table = [
  ['patrol_cap', 1.6], ['rubber_boots', 1.4], ['work_gloves', 1.4], ['soft_vest', 0.5], ['chest_rig', 0.5], ['sack_pack', 0.5],
  ['condensed', 1.8], ['sardines', 1.2], ['thermos', 1], ['flask', 1], ['cigarettes', 1.8], ['bandage', 1.6], ['splint', 0.4], ['flashlight', 1], ['compass', 0.4], ['knife', 0.5],
  ['ammo_9mm', 1.6], ['ammo_45', 0.8], ['mag_m9', 0.5], ['mag_colt', 0.4], ['m9', 0.15], ['colt', 0.15],
];

export interface CrateSpec {
  label: string;
  w: number;
  h: number;
  table: Table;
  count: [number, number];
}

export const CRATE_SPECS: Record<string, CrateSpec> = {
  wooden_military_crate: { label: 'Military Crate', w: 8, h: 4, table: MILITARY, count: [2, 4] },
  old_military_crate: { label: 'Ammunition Crate', w: 8, h: 4, table: MILITARY, count: [2, 4] },
  // (the hard case that stands wherever a military crate or an ammunition crate stood, and a little better filled)
  weapons_case: { label: 'Weapons Case', w: 8, h: 4, table: MILITARY, count: [2, 5] },
  wooden_crate_01: { label: 'Wooden Crate', w: 6, h: 3, table: CIVILIAN, count: [1, 3] },
  // a steel cabinet (see IN_MEDICINE). The same cabinet in a police building is filled as a constable's locker: the
  // server knows which it is by where it stands, and the game is told nothing but what is in it.
  med_cabinet: { label: 'Locker', w: 4, h: 6, table: IN_MEDICINE, count: [2, 4] },
  hospital_cabinet: { label: 'Locker', w: 4, h: 6, table: IN_HOSPITAL, count: [2, 4] },
  police_locker: { label: 'Locker', w: 4, h: 6, table: IN_POLICE, count: [1, 3] },
  // The steel locker with two doors (see HUNG). Where it stands in a police building it is a constable's, and in the
  // hospital it is filled as a clinic's cabinet is: the server knows which by where it stands, as with the cabinet.
  // Anywhere else it is the army's, and this.
  steel_locker: { label: 'Locker', w: 4, h: 6, table: IN_BARRACKS, count: [1, 3] },
  // what is searched in the bunker and is no crate (see bunkerCrates): some of them are empty
  // ("abundant supplies in the T5": a rack is never bare, and a locker seldom)
  locker: { label: 'Locker', w: 4, h: 6, table: IN_BUNKER, count: [0, 3] },
  gun_rack: { label: 'Weapon Rack', w: 8, h: 4, table: ON_RACKS, count: [2, 4] },
  bunker_cabinet: { label: 'Cabinet', w: 6, h: 4, table: IN_BUNKER, count: [1, 2] },
  // (the furniture with no places of its own, filled from a list as DayZ's cargo presets fill a container: a thing or
  // two in a cardboard box, a few in a large crate. See FURNITURE in storage.ts.)
  cardboard_box_01: { label: 'Cardboard Box', w: 4, h: 3, table: CIVILIAN, count: [0, 2] },
  crate_big: { label: 'Large Crate', w: 8, h: 4, table: CIVILIAN, count: [1, 3] },
  bunker_desk: { label: 'Desk', w: 6, h: 3, table: IN_BUNKER, count: [0, 2] },
};
/** the kinds that are the bunker's own furniture: what they hold is theirs whatever is said of where they stand */
const OF_BUNKER = new Set(['locker', 'gun_rack', 'bunker_cabinet', 'bunker_desk']);
/** and the kinds that hold what is theirs wherever they stand (a cabinet under the gas would else be a crate of rifles) */
const OWN_TABLE = new Set([...OF_BUNKER, 'med_cabinet', 'hospital_cabinet', 'police_locker', 'steel_locker']);

/**
 * The containers whose doors are hung on hinges and swing (2026-10-13: "lockers for example when opened should have
 * their door crack open, and other people on the server could see that"). By the model that stands there: which of
 * its pieces are leaves (each a piece of the file whose own origin is on the line of its hinges: `hung` in
 * scripts/props.mjs), how far they swing open (radians, about that line, the free edge coming out toward the front)
 * and how long the swing takes, seconds. The leaves are left out of what is drawn standing still
 * (src/world/vegetation.ts) and drawn by src/game/lockers.ts, shut until somebody has the thing open.
 *
 * A lid is the same thing lying down: `about: 'x'` turns it about a line across the thing, and of a model whose lid
 * is a piece of its own but was not made to be hung, `at` says where that line is in the model's own space ([x, y,
 * z], metres: any point of it). The wooden crate's is its lid's upper back edge, so that the lid stands up behind
 * the opening, a little short of upright, and no part of it goes back past the crate into a wall. `wood`: it
 * sounds as a wooden door does, not as steel.
 */
export const HUNG: Record<string, { leaf: RegExp; open: number; time: number; about?: 'x'; at?: [number, number, number]; wood?: true }> = {
  steel_locker: { leaf: /_door_[lr]/, open: 1.68, time: 0.5 },
  wooden_crate_01: { leaf: /_lid$/, about: 'x', at: [0, 0.3415, -0.1957], open: -1.4, time: 0.45, wood: true },
};

/** seconds an emptied crate stays empty before it refills (only while nobody is near): five minutes, it was twenty */
export const CRATE_RESTOCK = 300;

/**
 * @param rich the crate stands under the gas (true) or down the bunker ('bunker'): it holds the
 *   best of what is kept there, and one thing more
 */
export function fillCrate(c: Container, kind: string, rnd: () => number = Math.random, rich: boolean | 'bunker' = false) {
  const spec = CRATE_SPECS[kind];
  if (!spec) return;
  const own = OWN_TABLE.has(kind);
  const table = own ? spec.table : rich === 'bunker' ? IN_BUNKER : rich ? UNDER_GAS : spec.table;
  const total = table.reduce((s, [, w]) => s + w, 0);
  const n = spec.count[0] + Math.floor(rnd() * (spec.count[1] - spec.count[0] + 1)) + (rich && !own ? 1 : 0);
  for (let i = 0; i < n; i++) {
    let r = rnd() * total;
    let id = table[0][0];
    for (const [tid, w] of table) {
      r -= w;
      if (r <= 0) {
        id = tid;
        break;
      }
    }
    const def = ITEMS[id];
    const item = makeItem(id, def.stack ? Math.max(1, Math.round(def.stack * (0.2 + rnd() * 0.45))) : 1);
    if (def.weapon) {
      fitAtRandom(item, rnd);
      if (rich !== 'bunker') plainMag(item);
      stockGun(item, Math.floor(rnd() * (def.weapon.capacity / 2 + 1)));
    }
    if (def.mag) foundMag(item, rnd);
    c.add(item);
  }
}
