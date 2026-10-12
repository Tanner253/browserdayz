// Central Economy, modelled on DayZ's types.xml: every item type has a world-wide
// nominal (target) count, a minimum that triggers restocking, a lifetime after which
// untouched loot despawns, and usage tags that decide which buildings it spawns in.
// The economy controls *world supply* precisely, which is also what a scarce,
// redeemable item needs (nominal 1, long restock, tight usage).
//
// Runs on the server in multiplayer (clients only mirror it through inject / take)
// and in the browser when playing offline.

import type { Usage, LootPoint } from '../world/buildings';
import type { Tier } from './tiers';
import { ITEMS, fitAtRandom, foundMag, makeItem, stockGun, type ItemInstance } from './items';
import { fitsPoint } from './placement';
import { RNG } from '../core/noise';

export interface TypeRule {
  /**
   * How many are kept on each step of the map (src/sim/tiers.ts): [the outskirts, the village and the army's
   * places, Kamenka, under the gas, the bunker]. A nought is never: a thing kept only from the third step up is
   * not found on the first two, wherever anybody looks.
   */
  at: [number, number, number, number, number];
  lifetime: number; // seconds
  restock: number; // seconds
  /** the kinds of building it lies in, on the first three steps (under the gas and in the bunker a thing lies wherever it will) */
  usage: Usage[];
  qty?: [number, number]; // stack quantity range as fraction of max stack
  loaded?: [number, number]; // rounds loaded for weapons
  /** how much likelier a point of that kind of building is to get it (1 when not listed) */
  favour?: Partial<Record<Usage, number>>;
  /** it is put back when fewer than this share of them are left on a step (0.6 unless said; from Kamenka up, whenever one is gone) */
  keep?: number;
}

/**
 * Under the gas nothing stays gone for long: whatever is taken there is put back within this
 * many seconds, however slowly its sort comes back on the rest of the map. It is the richest
 * place there is, and a mask is what it costs. (Kamenka and the bunker are stocked as soon.)
 */
export const GAS_RESTOCK = 420;

/** every kind of building there is */
const ANYWHERE: Usage[] = ['Village', 'Town', 'Farm', 'Industrial', 'Military', 'Hunting', 'Medic', 'Police', 'Shop'];
/** where people lived, and where they worked out of doors */
const HOMES: Usage[] = ['Village', 'Town'];
const SHEDS: Usage[] = ['Farm', 'Hunting', 'Industrial', 'Village'];
const ARMY: Usage[] = ['Military', 'Police'];
/** guns were kept in the armoury and at the army's posts; food in the shop before anywhere; dressings in the clinic, and the shop until there is a hospital */
const ARMOURY = { Police: 12, Military: 5 };
const LARDER = { Shop: 5 };
/** a gun or what it fires that is taken is put back at the next restock, not once the map is well short */
const SOON = 0.95;

/**
 * What is left at an armed loot point (the first building of every outlying place, the guard posts, the police
 * armoury, a tent of the army's camp): always something to fight with, put back a few minutes after it is taken.
 * On the outskirts that is something to hit with and never a gun; from the village on, a pistol where guns were
 * kept, and either elsewhere. [item, weight]
 */
const ARMS: [string, number][] = [['colt', 2.4], ['m9', 1.8], ['hatchet', 1.6], ['bat', 1.6], ['crowbar', 1.4], ['machete', 1.4], ['shovel', 1.4], ['knife', 1]];
/** seconds an armed point stays bare once its weapon has been taken */
export const ARMS_RESTOCK = 180;
/** seconds before a place that always keeps one named thing has it again (the rifle on the hospital roof, and its parts) */
export const KEEPS_RESTOCK = 900;

// How many of each, and where: `npx tsx scripts/loot-audit.ts` says what the rules come to on the map as it is,
// and test/loot.test.ts holds them to what was asked (2026-10-10):
//   - what you hit with is found on the outskirts and nowhere else; lights and tools mostly there too
//   - pistols from the village on: the police station, the army's places, and now and then a house
//   - the sniper rifle is rare in Kamenka and common under the gas (and in a helicopter's cargo and a supply drop)
//   - the shotgun, the Desert Eagle, the heavy armour and the K6-3 helmet are the bunker's and nobody else's
//   - the big rucksack is not found below the fourth step
//   - what a gun fires is found everywhere, a little of it; boxes of it where guns were kept
//   - food in the shop before anywhere, dressings in the clinic and the shop
// The map has 338 places for things on the outskirts, 542 in the village and the army's places, 412 in Kamenka,
// 124 under the gas and 145 down the bunker; about six in ten are full.
export const TYPES: Record<string, TypeRule> = {
  // ------------------------------------------------------------ guns, and what they fire
  // (Weapons and what they fire come back fast: a gun taken off a shelf is back somewhere on its step within
  // three minutes, rounds within two. At seven minutes for a rifle a busy server ran dry.)
  mosin: { at: [0, 0, 2, 9, 2], lifetime: 7200, restock: 180, usage: ARMY, loaded: [1, 4], keep: SOON },
  colt: { at: [0, 21, 6, 0, 0], lifetime: 7200, restock: 180, usage: ['Police', 'Military', 'Town'], favour: ARMOURY, loaded: [2, 6], keep: SOON },
  // the service pistol, with nearly twice the magazine
  m9: { at: [0, 16, 9, 1, 0], lifetime: 7200, restock: 180, usage: ['Police', 'Military', 'Town'], favour: ARMOURY, loaded: [3, 10], keep: SOON },
  // loose rounds turn up in handfuls, everywhere; sealed boxes are the real find, and are where guns were kept
  ammo_762: { at: [6, 12, 12, 5, 2], lifetime: 3600, restock: 120, usage: ANYWHERE, favour: ARMOURY, qty: [0.25, 0.6], keep: SOON },
  ammo_9mm: { at: [12, 38, 16, 1, 1], lifetime: 3600, restock: 120, usage: ANYWHERE, favour: ARMOURY, qty: [0.25, 0.6], keep: SOON },
  box_762: { at: [0, 3, 7, 8, 2], lifetime: 3600, restock: 180, usage: ARMY, keep: SOON },
  box_9mm: { at: [0, 19, 9, 2, 2], lifetime: 3600, restock: 180, usage: ['Police', 'Military', 'Town'], favour: ARMOURY, keep: SOON },
  // Magazines (2026-10-10): a gun is found with its own in it six times in ten, and they lie by themselves where
  // the guns they fit are kept, about as many again as there are guns, a few rounds in some. A second one is
  // what makes a gun worth keeping. (Under the gas every place is spoken for: the rifle's magazines there are in
  // place of a few handfuls of loose rounds.)
  mag_colt: { at: [0, 16, 5, 0, 0], lifetime: 7200, restock: 240, usage: ['Police', 'Military', 'Town'], favour: ARMOURY, keep: SOON },
  mag_m9: { at: [0, 13, 7, 1, 0], lifetime: 7200, restock: 240, usage: ['Police', 'Military', 'Town'], favour: ARMOURY, keep: SOON },
  mag_sniper: { at: [0, 0, 2, 4, 2], lifetime: 7200, restock: 300, usage: ARMY, keep: SOON },
  // The two assault rifles (2026-10-10), and what goes with them. Nobody said where they are kept: they are put a
  // step above the pistols and beside the sniper rifle. The AK now and then in Kamenka, under the gas and down
  // the bunker; the AR-15 under the gas, seldom, and down the bunker. Their rounds are found from the village
  // on, a few; their magazines where the rifles are; the drum and the long magazine down the bunker only.
  // (Under the gas every place was spoken for: the pistols and their fittings have made way there.)
  // (Down the bunker there are thirteen places on a floor, and a rifle lies nowhere else: the shotgun, the sniper
  // rifle, the shotgun's can and the big rucksack have twelve of them. The rifles there are on its racks.)
  ak: { at: [0, 0, 2, 4, 0], lifetime: 7200, restock: 300, usage: ARMY, loaded: [5, 20], keep: SOON },
  ar15: { at: [0, 0, 0, 2, 1], lifetime: 7200, restock: 420, usage: ARMY, loaded: [5, 20], keep: SOON },
  mag_ak: { at: [0, 0, 2, 3, 2], lifetime: 7200, restock: 300, usage: ARMY, keep: SOON },
  mag_ar: { at: [0, 0, 1, 2, 3], lifetime: 7200, restock: 300, usage: ARMY, keep: SOON },
  drum_ak: { at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1200, usage: [] },
  mag_ar_60: { at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1200, usage: [] },
  ammo_739: { at: [0, 2, 4, 4, 3], lifetime: 3600, restock: 180, usage: ['Military', 'Police', 'Hunting'], qty: [0.25, 0.6], keep: SOON },
  ammo_556: { at: [0, 2, 3, 2, 4], lifetime: 3600, restock: 180, usage: ['Military', 'Police'], qty: [0.25, 0.6], keep: SOON },
  box_739: { at: [0, 0, 2, 3, 2], lifetime: 3600, restock: 240, usage: ARMY, keep: SOON },
  box_556: { at: [0, 0, 0, 2, 3], lifetime: 3600, restock: 240, usage: ARMY, keep: SOON },
  suppressor_739: { at: [0, 0, 0, 1, 1], lifetime: 7200, restock: 1800, usage: [] },
  suppressor_556: { at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1800, usage: [] },
  foregrip: { at: [0, 0, 1, 0, 2], lifetime: 7200, restock: 1200, usage: ARMY },
  // The Desert Eagle and what it fires, the shotgun, its shells and the can for its muzzle: the bunker's, and
  // nobody else's. (The Desert Eagle was the gas's own until 2026-10-10.)
  deagle: { at: [0, 0, 0, 0, 4], lifetime: 7200, restock: 600, usage: [], loaded: [2, 7] },
  ammo_50: { at: [0, 0, 0, 0, 6], lifetime: 3600, restock: 300, usage: [], qty: [0.4, 0.9] },
  box_50: { at: [0, 0, 0, 0, 3], lifetime: 3600, restock: 420, usage: [] },
  mag_deagle: { at: [0, 0, 0, 0, 4], lifetime: 7200, restock: 600, usage: [] },
  mag_deagle_ext: { at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1200, usage: [] },
  benelli: { at: [0, 0, 0, 0, 4], lifetime: 7200, restock: 600, usage: [], loaded: [3, 7] },
  ammo_12: { at: [0, 0, 0, 0, 7], lifetime: 3600, restock: 300, usage: [], qty: [0.4, 0.9] },
  box_12: { at: [0, 0, 0, 0, 4], lifetime: 3600, restock: 420, usage: [] },
  suppressor_12: { at: [0, 0, 0, 0, 3], lifetime: 7200, restock: 1200, usage: [] },
  // (and what opens the bunker is kept under the gas: the one place is the way into the other)
  keycard: { at: [0, 0, 0, 2, 0], lifetime: 7200, restock: 600, usage: [] },
  // what goes on a gun
  suppressor_762: { at: [0, 0, 0, 3, 2], lifetime: 7200, restock: 1800, usage: [] },
  red_dot: { at: [0, 1, 2, 3, 3], lifetime: 7200, restock: 1800, usage: ['Police'] },
  // (not in the police station: its few shelves are where the gas masks are kept, and a mask that has nowhere to lie is a gas nobody can enter)
  gun_light: { at: [0, 3, 3, 3, 3], lifetime: 3600, restock: 900, usage: ['Military', 'Industrial'] },
  mag_m9_ext: { at: [0, 2, 2, 0, 0], lifetime: 7200, restock: 1200, usage: ['Military'] },
  pu_scope: { at: [0, 0, 1, 6, 3], lifetime: 7200, restock: 1800, usage: ARMY },
  rifle_wrap: { at: [0, 0, 2, 3, 1], lifetime: 7200, restock: 1500, usage: ARMY },
  suppressor_9: { at: [0, 2, 2, 0, 0], lifetime: 7200, restock: 1800, usage: ['Police'] },
  box_45: { at: [0, 6, 2, 0, 0], lifetime: 3600, restock: 240, usage: ARMY },
  // ------------------------------------------------------------ what you hit with: the outskirts, and nowhere else
  hatchet: { at: [14, 0, 0, 0, 0], lifetime: 3600, restock: 180, usage: SHEDS, favour: { Farm: 2, Hunting: 2 } },
  machete: { at: [12, 0, 0, 0, 0], lifetime: 3600, restock: 180, usage: SHEDS, favour: { Farm: 2 } },
  crowbar: { at: [14, 0, 0, 0, 0], lifetime: 3600, restock: 180, usage: SHEDS, favour: { Industrial: 2 } },
  bat: { at: [13, 0, 0, 0, 0], lifetime: 3600, restock: 180, usage: [...HOMES, 'Farm'] },
  // (a tool of yards and sheds: it lies on a floor, being as long as a rifle is)
  shovel: { at: [11, 0, 0, 0, 0], lifetime: 3600, restock: 180, usage: SHEDS, favour: { Farm: 2, Industrial: 2 } },
  knife: { at: [16, 0, 0, 0, 0], lifetime: 3600, restock: 180, usage: [...HOMES, 'Farm', 'Hunting', 'Industrial'] },
  // ------------------------------------------------------------ food and drink: the shop before anywhere
  sprats: { at: [8, 10, 5, 0, 0], lifetime: 2400, restock: 300, usage: ['Shop', ...HOMES], favour: LARDER },
  condensed: { at: [3, 7, 6, 1, 3], lifetime: 2400, restock: 300, usage: ['Shop', ...HOMES, 'Military'], favour: LARDER },
  beans: { at: [9, 10, 8, 0, 1], lifetime: 2400, restock: 300, usage: ['Shop', ...HOMES, 'Farm'], favour: LARDER },
  tomatoes: { at: [6, 6, 5, 0, 0], lifetime: 2400, restock: 300, usage: ['Shop', 'Village', 'Farm'], favour: LARDER },
  sardines: { at: [7, 8, 7, 0, 1], lifetime: 2400, restock: 300, usage: ['Shop', ...HOMES, 'Hunting'], favour: LARDER },
  apple: { at: [7, 5, 5, 0, 0], lifetime: 1200, restock: 300, usage: ['Shop', 'Village', 'Farm'], favour: LARDER },
  milk: { at: [3, 5, 4, 0, 0], lifetime: 1800, restock: 300, usage: ['Shop', ...HOMES], favour: LARDER },
  // (there was a third as much to drink on the map as to eat, and thirst runs as fast as hunger)
  water_jug: { at: [7, 9, 8, 1, 1], lifetime: 2400, restock: 300, usage: ['Shop', ...HOMES, 'Farm', 'Industrial'], favour: LARDER },
  flask: { at: [4, 8, 6, 1, 3], lifetime: 2400, restock: 300, usage: ['Military', 'Hunting', 'Village', 'Farm'] },
  thermos: { at: [4, 7, 5, 1, 1], lifetime: 2400, restock: 300, usage: ['Military', 'Hunting', 'Village', 'Police', 'Industrial', 'Shop'] },
  // ------------------------------------------------------------ medical: the clinic, and the shop until there is a hospital
  // (What stops bleeding is what a fight is lost for want of.)
  // (2026-10-10: bandages common on the outskirts and in the village; stims found in the village, common from Kamenka on)
  // (2026-10-12, two asks of what is kept where. "the hospital loot pool leans heavily into meds, lots of stims
  // ... and medkits": the third step's dressings, stims, kits and splints, which lie nearly all in Kamenka's
  // hospital, are four times what they were. "the police HQ felt like it was a little light on loot": the second
  // step's pistols, what they fire and what a constable wore, by about a third. The steel cabinets of both are
  // searched besides: see crates.ts.)
  bandage: { at: [16, 30, 42, 3, 3], lifetime: 2400, restock: 240, usage: ['Medic', 'Shop', ...HOMES, 'Military', 'Police', 'Hunting', 'Farm'], favour: { Medic: 10, Shop: 6, Military: 2 } },
  // (2026-10-11, asked: "stims should be common in mid tier loot and in hospitals". Three times as many in the
  // village and the army's places, half as many again in Kamenka and under the gas, in the houses there as well
  // as where they were, and a clinic's shelf twice as likely to have one as it was. Still none on the outskirts.)
  stim: { at: [0, 15, 58, 8, 6], lifetime: 3000, restock: 360, usage: ['Medic', 'Military', 'Police', 'Shop', ...HOMES], favour: { Medic: 10, Military: 3, Police: 2 } },
  firstaid: { at: [0, 9, 30, 3, 3], lifetime: 3600, restock: 600, usage: ['Medic', 'Military', 'Police'], favour: { Medic: 12 } },
  // (what sets a broken leg and does nothing else: commoner than the kit, and where there are ladders and lofts to fall off)
  splint: { at: [5, 10, 30, 1, 2], lifetime: 3600, restock: 420, usage: ['Medic', 'Shop', ...HOMES, 'Farm', 'Hunting', 'Industrial', 'Police'], favour: { Medic: 5, Shop: 2 } },
  // ------------------------------------------------------------ what is worn and carried
  // (cloth on the head anywhere people lived or the army was; the helmet from Kamenka up, and one that got as far as the village)
  patrol_cap: { at: [0, 11, 5, 0, 0], lifetime: 3600, restock: 600, usage: ARMY },
  fishermans_hat: { at: [6, 3, 4, 0, 0], lifetime: 3600, restock: 600, usage: [...HOMES, 'Farm', 'Hunting'] },
  garden_gloves: { at: [6, 3, 4, 0, 0], lifetime: 3600, restock: 600, usage: ['Village', 'Farm', 'Industrial'] },
  boonie_hat: { at: [0, 1, 3, 7, 4], lifetime: 3600, restock: 900, usage: ['Military'] },
  // (the heaviest helmet there is: the bunker's)
  helmet_k63: { at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1800, usage: [] },
  // (The mask is what lets anybody into the gas, so it is not kept IN the gas: it is in the police station of the
  // village, and the three of them there are what the whole map has to share, bar what one of the army's cases
  // or a supply drop turns up.)
  gasmask: { at: [0, 3, 0, 0, 0], lifetime: 3600, restock: 900, usage: ['Police'] },
  // (armour by weight: the rig on the outskirts and in houses, the soft vest where the police and the army were,
  // the armoured vest in Kamenka and one that got as far as the village, the plate carrier under the gas, the
  // heavy armour only down the bunker)
  chest_rig: { at: [7, 5, 5, 0, 0], lifetime: 3600, restock: 600, usage: [...SHEDS, 'Town'] },
  soft_vest: { at: [0, 10, 6, 0, 0], lifetime: 3600, restock: 900, usage: ARMY, favour: { Police: 4 } },
  armor_vest: { at: [0, 1, 9, 1, 0], lifetime: 3600, restock: 1200, usage: ARMY, favour: { Military: 3 } },
  life_vest: { at: [0, 0, 0, 8, 4], lifetime: 3600, restock: 900, usage: [] },
  heavy_armor: { at: [0, 0, 0, 0, 3], lifetime: 7200, restock: 1800, usage: [] },
  work_gloves: { at: [0, 6, 5, 0, 0], lifetime: 3600, restock: 900, usage: ARMY },
  rubber_boots: { at: [0, 6, 5, 0, 0], lifetime: 3600, restock: 900, usage: ARMY },
  // (three packs: the day pack from the first step, the camping pack from the village on, and the army's
  // rucksack, the biggest, from the fourth step up and never below it)
  sack_pack: { at: [8, 5, 3, 0, 0], lifetime: 3600, restock: 600, usage: [...SHEDS, 'Town'] },
  camping_pack: { at: [0, 4, 5, 0, 0], lifetime: 3600, restock: 900, usage: [...HOMES, 'Hunting'] },
  suitcase: { at: [0, 0, 0, 3, 3], lifetime: 3600, restock: 1200, usage: [] },
  // ------------------------------------------------------------ tools and odds and ends
  // (a lantern is a thing of sheds, kitchens and lorries: most of them out where anybody starts, because the night is everybody's)
  flashlight: { at: [13, 5, 6, 1, 2], lifetime: 3600, restock: 420, usage: [...SHEDS, 'Town'] },
  binoculars: { at: [2, 2, 3, 1, 1], lifetime: 3600, restock: 1200, usage: ['Military', 'Hunting', 'Police'] },
  compass: { at: [4, 2, 3, 0, 0], lifetime: 3600, restock: 1200, usage: ['Military', 'Hunting', 'Village'] },
  cigarettes: { at: [4, 7, 7, 0, 1], lifetime: 2400, restock: 600, usage: [...HOMES, 'Military', 'Industrial', 'Shop'] },
  grenade: { at: [0, 3, 4, 5, 4], lifetime: 3600, restock: 1200, usage: ['Military'] },
  stash_kit: { at: [3, 0, 1, 0, 0], lifetime: 7200, restock: 1800, usage: ['Farm', 'Industrial', 'Hunting'] },
  // (a field radio: good for one supply drop called down where it is used. One at the army's; the trader sells them dear.)
  radio: { at: [0, 1, 1, 0, 0], lifetime: 7200, restock: 2400, usage: ['Military'] },
  // fuel for the jeeps (src/sim/vehicles.ts): where there are sheds, yards and soldiers
  jerrycan: { at: [6, 5, 4, 1, 1], lifetime: 3600, restock: 600, usage: ['Farm', 'Industrial', 'Military', 'Village'] },
  // (Said last, so that the dice fall for everything before it as they fell before it was there.)
  // The submachine gun (2026-10-11): a 9 mm, and kept where the pistols are kept, a good deal seldomer: the police
  // station and the army's places, and now and then in Kamenka. Its magazines with it. (Not under the gas, where
  // every place is spoken for: there it is in the crates.)
  mpa: { at: [0, 4, 3, 0, 0], lifetime: 7200, restock: 300, usage: ['Police', 'Military'], favour: ARMOURY, loaded: [5, 20], keep: SOON },
  mag_mpa: { at: [0, 5, 3, 0, 0], lifetime: 7200, restock: 300, usage: ['Police', 'Military'], favour: ARMOURY, keep: SOON },
  // What the Colt fires (2026-10-11): loose, a little of it wherever the 9 mm is, from the outskirts on; its sealed
  // boxes where the army kept things (above, in the places the Pistol 43's long magazine had) and in the police station.
  ammo_45: { at: [5, 16, 7, 0, 0], lifetime: 3600, restock: 120, usage: ANYWHERE, favour: ARMOURY, qty: [0.25, 0.6], keep: SOON },
  // Two more things to keep things in (2026-10-12), beside the stash case: a black sack, which is in every shed and
  // kitchen, and a suitcase, which is in houses. (Said last, like the others above, for the sake of the dice.)
  black_bag: { at: [8, 5, 2, 0, 0], lifetime: 7200, restock: 1200, usage: [...SHEDS, 'Town'] },
  old_suitcase: { at: [3, 4, 3, 0, 0], lifetime: 7200, restock: 1800, usage: HOMES },
};

const STEPS: Tier[] = [1, 2, 3, 4, 5];
/** from this step up, what lies there lies wherever it will: the kind of building is not asked (the works under the gas, and the bunker) */
const UNSORTED = 4;

/**
 * What is put down before anything else when a world is stocked: the masks, which are what lets anybody into the
 * gas; and then the long things and the big ones, which lie only on a floor, while there are floors free (down the
 * bunker there are thirteen, and with everything put down turn about half the shotguns had nowhere to lie; on the
 * outskirts the bats and the crowbars came up a few short, which of them depending on the dice).
 */
const FIRST = ['gasmask', 'benelli', 'mosin', 'ak', 'ar15', 'suppressor_12', 'suitcase', 'heavy_armor', 'life_vest', 'armor_vest', 'bat', 'crowbar', 'shovel', 'machete'];

/**
 * ======================================================================================================
 * TEMPORARY: THE SHOWCASE (2026-10-11). To be taken away again: delete this block and SHOWCASE in crates.ts
 * and drops.ts, put the words of TIERS back (src/sim/tiers.ts), and the marked checks in test/gas.test.ts and
 * test/loot.test.ts back as they were (each says what it was).
 *
 * The user's, 2026-10-11: "we will make all these new guns and attachments common in T3 ... all the machine guns
 * are bunker weapons, maybe submachine gun T4 weapon, but all this should be in the bunker. FOR NOW we will make
 * it available in T3 so people have a reason to visit the new town, and try the new guns. we will give the
 * players a taste of the firepower then take it away hiding it in the bunker soon. in fact lets bring the
 * shotgun to the T3 as well, and the bunker keycard, and the gasmask." And: "make sure all this new firepower is
 * in the bunker of course."
 *
 * What it is NOT: the loot the game is meant to have. That is to be worked out as DayZ has it, where a gun that
 * fires is put together from a gun, a magazine and rounds found in three places ("think about dayz, how
 * difficult it can be to make a full weapon that actually shoots, we need to make the game feel gritty"), with
 * the automatic guns the bunker's and the submachine gun the gas's or the bunker's.
 *
 * What it does: how many of each of these are kept in Kamenka (the third step) while it lasts, and in the
 * bunker (the fifth) where there were none. Nothing else is changed: what was kept on a step is kept there still.
 * ======================================================================================================
 */
export const SHOWCASE: { kamenka: Record<string, number>; bunker: Record<string, number> } = {
  kamenka: {
    // the guns
    ak: 6, ar15: 5, mpa: 7, benelli: 4,
    // what feeds them
    mag_ak: 7, mag_ar: 6, mag_mpa: 7, drum_ak: 2, mag_ar_60: 2,
    ammo_739: 6, ammo_556: 6, ammo_12: 6, box_739: 4, box_556: 4, box_12: 3,
    // what goes on them
    suppressor_739: 2, suppressor_556: 2, suppressor_12: 2, suppressor_9: 3, foregrip: 3, red_dot: 4, gun_light: 4,
    // and the way into the two places past it
    keycard: 3, gasmask: 3,
  },
  // (Down the bunker a long gun lies on its floor or its racks and nowhere else, and the floor is spoken for: the
  // submachine gun is on the racks and in the crates there, with the Colt and what both fire: see crates.ts. Its
  // magazines have a shelf.)
  bunker: { mag_mpa: 2 },
};
/**
 * Where the showcase's things lie in Kamenka: in its houses and its shops, a great many places, and not where the
 * army and the police kept theirs, which are few and are for what the town always had. (On the steps below it,
 * each lies where it always did.)
 */
const SHOWN_IN: Usage[] = ['Town'];
for (const [id, n] of Object.entries(SHOWCASE.kamenka)) TYPES[id].at[2] = Math.max(TYPES[id].at[2], n);
for (const [id, n] of Object.entries(SHOWCASE.bunker)) TYPES[id].at[4] = Math.max(TYPES[id].at[4], n);
// (Kamenka's own things are put down ahead of the showcase's, so that what the town was for is still there to be
// found: its dressings and its stims lie in the same houses the new guns are now strewn through.)
FIRST.push('firstaid', 'stim', 'soft_vest');


export interface WorldLoot {
  uid: string;
  item: ItemInstance;
  x: number;
  y: number;
  z: number;
  rot: number;
  point: number; // loot point index, -1 for player-dropped
  spawnedAt: number;
  /**
   * A case, a suitcase or a bag somebody dropped: when (milliseconds since 1970). It is not cleared away as other
   * dropped things are, after an hour: it lies for a week if it is empty and a fortnight if anything is in it
   * (`CONTAINER_LIFE`), and the server keeps it between its restarts with what is in it.
   */
  keptAt?: number;
}

/** how long a dropped container lies before it is cleared away, milliseconds: empty, and with anything in it */
export const CONTAINER_LIFE = { empty: 7 * 86400_000, full: 14 * 86400_000 };

export interface EconomyEvents {
  spawn(l: WorldLoot): void;
  despawn(l: WorldLoot): void;
}

export class Economy {
  loot = new Map<string, WorldLoot>();
  private pointBusy = new Set<number>();
  lastRestock: Record<string, number> = {};
  private rng = new RNG(20260930);
  time = 0;

  /** which step of the map each loot point is on (see src/sim/tiers.ts): each step is stocked to counts of its own */
  private tier: Tier[];

  constructor(
    private points: LootPoint[],
    private events: EconomyEvents,
    /** can this item type physically lie at this loot point? */
    private fits: (id: string, p: LootPoint) => boolean = fitsPoint,
  ) {
    this.tier = points.map((p) => p.tier ?? (p.usage.includes('Bunker') ? 5 : p.usage.includes('Gas') ? 4 : p.usage.includes('East') ? 3 : 1));
  }

  /** Count of a type currently in the world (on the ground). */
  count(id: string) {
    let n = 0;
    for (const l of this.loot.values()) if (l.item.id === id) n++;
    return n;
  }

  /**
   * How many of a sort lie on one step of the map (what a player has put down is on none). The old names still
   * mean what they did: true is under the gas, 'bunker' the bunker, 'east' Kamenka; false is the first two together.
   */
  held(id: string, where: Tier | boolean | 'bunker' | 'east'): number {
    if (where === false) return this.held(id, 1) + this.held(id, 2);
    const t: Tier = where === true ? 4 : where === 'bunker' ? 5 : where === 'east' ? 3 : where;
    let n = 0;
    for (const l of this.loot.values()) if (l.item.id === id && l.point >= 0 && this.tier[l.point] === t) n++;
    return n;
  }

  private pickPoint(id: string, rule: TypeRule, where: Tier): number {
    const sorted = where < UNSORTED;
    const candidates: number[] = [];
    const weights: number[] = [];
    let total = 0;
    this.points.forEach((p, i) => {
      // armed points are stocked on their own (see arm)
      if (p.arms || p.keeps || this.pointBusy.has(i) || this.tier[i] !== where) return;
      // (TEMPORARY, THE SHOWCASE: in Kamenka its things lie in the town's houses as well as where each was kept)
      const kinds = where === 3 && id in SHOWCASE.kamenka && id !== 'gasmask' ? SHOWN_IN : rule.usage;
      if (sorted && !p.usage.some((u) => kinds.includes(u))) return;
      // a rifle never spawns on a narrow shelf, a jerrycan never on a barrel
      if (!this.fits(id, p)) return;
      let w = 1;
      if (sorted && rule.favour) for (const u of p.usage) w = Math.max(w, rule.favour[u] ?? 1);
      candidates.push(i);
      weights.push(w);
      total += w;
    });
    if (!candidates.length) return -1;
    let r = this.rng.next() * total;
    for (let k = 0; k < candidates.length; k++) {
      r -= weights[k];
      if (r <= 0) return candidates[k];
    }
    return candidates[candidates.length - 1];
  }

  private spawnType(id: string, at = -1, where: Tier = 1): boolean {
    const rule = TYPES[id];
    const def = ITEMS[id];
    const pi = at >= 0 ? at : this.pickPoint(id, rule, where);
    if (pi < 0) return false;
    const p = this.points[pi];
    const item = makeItem(id);
    if (def.stack && rule.qty) item.qty = Math.max(1, Math.round(def.stack * this.rng.range(rule.qty[0], rule.qty[1])));
    if (def.weapon) {
      fitAtRandom(item, () => this.rng.next());
      // (what is left at an armed place is a gun that fires: it has its magazine, whatever the dice said)
      if (at >= 0 && def.weapon.mag && !item.mag) item.mag = def.weapon.mag;
      if (rule.loaded) stockGun(item, this.rng.int(rule.loaded[0], Math.min(rule.loaded[1], def.weapon.capacity)));
    }
    if (def.mag) foundMag(item, () => this.rng.next());
    const l: WorldLoot = {
      uid: item.uid,
      item,
      x: p.x + this.rng.range(-0.08, 0.08),
      y: p.y,
      z: p.z + this.rng.range(-0.08, 0.08),
      rot: this.rng.range(0, Math.PI * 2),
      point: pi,
      spawnedAt: this.time,
    };
    this.pointBusy.add(pi);
    this.loot.set(l.uid, l);
    this.events.spawn(l);
    return true;
  }

  /** when each armed point was found bare */
  private bare = new Map<number, number>();

  /** Puts a weapon at every armed point that has been bare long enough (at once, when `now`). */
  private arm(now = false) {
    this.points.forEach((p, i) => {
      if (!p.arms && !p.keeps) return;
      if (this.pointBusy.has(i)) {
        this.bare.delete(i);
        return;
      }
      if (!now) {
        if (!this.bare.has(i)) this.bare.set(i, this.time);
        if (this.time - this.bare.get(i)! < (p.keeps ? KEEPS_RESTOCK : ARMS_RESTOCK)) return;
      }
      // (a place that keeps one named thing: that thing, and nothing in its stead)
      if (p.keeps) {
        if (ITEMS[p.keeps]) this.spawnType(p.keeps, i);
        this.bare.delete(i);
        return;
      }
      // a few tries: a rifle will not lie on a shelf
      // (on the outskirts, something to hit with and never a gun; further in, a pistol where guns were kept)
      const table = this.tier[i] <= 1 ? ARMS.filter(([id]) => !ITEMS[id].weapon) : p.arms === 'guns' ? ARMS.filter(([id]) => ITEMS[id].weapon) : ARMS;
      const total = table.reduce((s, [, w]) => s + w, 0);
      for (let tries = 0; tries < 6; tries++) {
        let r = this.rng.next() * total;
        let id = table[0][0];
        for (const [tid, w] of table) {
          r -= w;
          if (r <= 0) {
            id = tid;
            break;
          }
        }
        if (this.fits(id, p) && this.spawnType(id, i)) break;
      }
      this.bare.delete(i);
    });
  }

  /** Initial fill up to nominal. */
  populate() {
    this.arm(true);
    // (what the whole map hangs on is put down first, while its few places are still free)
    for (const id of FIRST) for (const t of STEPS) while (this.held(id, t) < TYPES[id].at[t - 1] && this.spawnType(id, -1, t));
    // interleave types so scarce ones still find free points
    const ids = Object.keys(TYPES);
    let progress = true;
    while (progress) {
      progress = false;
      for (const id of ids) for (const t of STEPS) if (this.held(id, t) < TYPES[id].at[t - 1] && this.spawnType(id, -1, t)) progress = true;
    }
  }

  /**
   * Restore saved world loot. `keepPoints` is false when the map's loot points changed
   * since the save: spawned loot is then dropped (it gets repopulated) and only items
   * players left on the ground are kept.
   */
  restore(list: WorldLoot[], keepPoints = true) {
    for (const l of list) {
      if (!ITEMS[l.item.id]) continue;
      if (l.point >= 0 && (!keepPoints || l.point >= this.points.length)) continue;
      this.inject(l);
    }
  }

  /** Add an existing loot entry (restore, or mirroring the server). */
  inject(l: WorldLoot) {
    if (this.loot.has(l.uid)) return;
    this.loot.set(l.uid, l);
    if (l.point >= 0) this.pointBusy.add(l.point);
    this.events.spawn(l);
  }

  /** Player picked an item up (or it was destroyed). */
  take(uid: string) {
    const l = this.loot.get(uid);
    if (!l) return null;
    this.loot.delete(uid);
    if (l.point >= 0) this.pointBusy.delete(l.point);
    this.events.despawn(l);
    return l;
  }

  /** how long a dropped container lies (the server's may be set otherwise: see STASH_EMPTY_S and STASH_FULL_S there) */
  containerLife = { ...CONTAINER_LIFE };

  /** Player dropped an item into the world. */
  drop(item: ItemInstance, x: number, y: number, z: number, rot: number) {
    const l: WorldLoot = { uid: item.uid, item, x, y, z, rot, point: -1, spawnedAt: this.time };
    if (ITEMS[item.id]?.category === 'stash') l.keptAt = Date.now();
    this.loot.set(l.uid, l);
    this.events.spawn(l);
    return l;
  }

  /** Periodic tick: lifetime cleanup (never in sight of a player) and restocking. */
  tick(dt: number, players: { x: number; z: number }[]) {
    this.time += dt;
    const near = (l: WorldLoot) => players.some((p) => Math.hypot(l.x - p.x, l.z - p.z) < 60);
    const now = Date.now();
    for (const l of [...this.loot.values()]) {
      // (a container somebody dropped goes by the calendar, and not by how long this game has been running)
      if (l.keptAt !== undefined) {
        if (now - l.keptAt > (l.item.cargo?.length ? this.containerLife.full : this.containerLife.empty) && !near(l)) this.take(l.uid);
        continue;
      }
      const rule = TYPES[l.item.id];
      const life = rule ? rule.lifetime : 3600;
      if (this.time - l.spawnedAt > life && !near(l)) this.take(l.uid);
    }
    this.arm();
    for (const [id, rule] of Object.entries(TYPES)) {
      for (const t of STEPS) {
        const want = rule.at[t - 1];
        if (!want) continue;
        // (from Kamenka up every one that is gone is put back, and soon; below it, once a share of them is gone)
        if (t >= 3) this.restock(id, t, want, want, Math.min(rule.restock, GAS_RESTOCK));
        else this.restock(id, t, want, Math.max(1, Math.ceil(want * (rule.keep ?? 0.6))), rule.restock);
      }
    }
  }

  /** Puts a sort back up to `want` on a step where fewer than `least` of it are left there, no oftener than `every` seconds. */
  private restock(id: string, where: Tier, want: number, least: number, every: number) {
    const n = this.held(id, where);
    if (n >= least) return;
    const key = `${id}@${where}`;
    if (this.time - (this.lastRestock[key] ?? -1e9) < every) return;
    this.lastRestock[key] = this.time;
    for (let k = n; k < want; k++) if (!this.spawnType(id, -1, where)) break;
  }

  serialize() {
    return { time: this.time, lastRestock: this.lastRestock, loot: [...this.loot.values()] };
  }
}
