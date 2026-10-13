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
import { ITEMS, fitAtRandom, foundMag, makeItem, plainMag, stockGun, type ItemInstance } from './items';
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
  /**
   * What is otherwise on one step of the map: the kinds of building it lies in there, how it leans among them, how
   * many seconds before one that is taken is put back, and how often a gun put down there has its magazine in it
   * (0..1; unsaid, as often as anywhere: six times in ten).
   */
  on?: Partial<Record<Tier, { usage?: Usage[]; favour?: Partial<Record<Usage, number>>; restock?: number; mag?: number }>>;
}

/**
 * Under the gas nothing stays gone for long: whatever is taken there is put back within this
 * many seconds, however slowly its sort comes back on the rest of the map. It is the richest
 * place there is, and a mask is what it costs. (Kamenka and the bunker are stocked as soon.)
 */
export const GAS_RESTOCK = 420;

/** where people lived */
const HOMES: Usage[] = ['Village', 'Town'];
/** sheds, barns, garages and yards, and a hunter's cabin: where the tools are */
const SHEDS: Usage[] = ['Farm', 'Hunting', 'Industrial'];
const ARMY: Usage[] = ['Military', 'Police'];
/** guns were kept in the armoury and at the army's posts; food in the shop before anywhere */
const ARMOURY = { Police: 12, Military: 7 };
/** loose rounds: where guns were kept before anywhere, a hunter's cabin next, and a handful in a house */
const ROUNDS = { Police: 12, Military: 8, Hunting: 2 };
const LARDER = { Shop: 6 };
/** a gun or what it fires that is taken is put back at the next restock, not once the map is well short */
const SOON = 0.95;
/**
 * Kamenka has one small police station and a few army posts, and they are full of what only they keep. So what the
 * town is for, the pistols and the submachine gun and what feeds them, lies in its houses nearly as readily as
 * where guns were kept: there, the town itself is the armoury.
 */
const IN_TOWN = { favour: { Police: 3, Military: 1.5 } };
/** past the outskirts, a tool lies in a shed and nowhere else */
const IN_SHEDS: TypeRule['on'] = { 2: { usage: SHEDS }, 3: { usage: SHEDS } };

/**
 * What is left at an armed loot point (the first building of every outlying place, the guard posts, the police
 * armoury, a tent of the army's camp): always something to fight with, put back a few minutes after it is taken.
 * On the outskirts that is something to hit with and never a gun; from the village on, a pistol where guns were
 * kept, and either elsewhere. [item, weight]
 */
const ARMS: [string, number][] = [['colt', 2.4], ['m9', 1.8], ['hatchet', 1.6], ['bat', 1.6], ['crowbar', 1.4], ['machete', 1.4], ['shovel', 1.4], ['knife', 1]];
/** and from Kamenka on, where guns were kept: the submachine gun before a pistol ("tier 3 should be submachine guns heavy") */
const ARMS_TOWN: [string, number][] = [['mpa', 2.4], ['m9', 1.6], ['colt', 1]];
/** seconds an armed point stays bare once its weapon has been taken */
export const ARMS_RESTOCK = 180;
/**
 * A spot that has been looted is left alone, and so is the ground about it (2026-10-13: "loot is respawning
 * instantly when it is looted. we shouldnt respawn or refresh or reroll the loot table for a location for 3 mins
 * after its looted. and each loot spot SHOULD be a rolled loot chance, the same loot shouldnt spawn in the same
 * locations (unless by chance) thats why we have tiers and categories of loot").
 *
 * Nothing is put down within LOOTED_ABOUT metres of a looted spot for LOOTED_REST seconds. And what lay at a spot
 * does not come back to that same spot for SAME_AGAIN seconds while there is anywhere else for it: it is put
 * wherever else its kind is kept, at random (Kamenka has some 240 spots free at any time). Only where there is
 * nowhere else at all (under the gas and down the bunker, where every place is spoken for) does it go back to
 * where it lay, once that spot has rested. What a spot gets next is whichever sort is
 * next wanted and happens on it: a roll among everything its step and its kind of place keep.
 *
 * (Tried and taken out: giving a looted spot something rolled at once when it had rested. The sort that was taken
 * had found another spot already, so every looting left the town one thing fuller, up to a quarter over.)
 *
 * (Why it came straight back: from Kamenka up, whatever is gone is put back as soon as it is missed. In a town
 * that is full, the spot a thing was taken from is the one free spot there is, and the thing just taken is the one
 * thing missing: it was back where it had lain at the next count, five seconds later.)
 */
export const LOOTED_REST = 180, LOOTED_ABOUT = 6, SAME_AGAIN = 900;
/** nothing is put down within this many metres of anybody living */
export const NEAR_PLAYER = 50;
/** seconds before a place that always keeps one named thing has it again (the rifle on the hospital roof, and its parts) */
export const KEEPS_RESTOCK = 900;

// How many of each, and where: `npx tsx scripts/loot-audit.ts` says what the rules come to on the map as it is,
// and test/loot.test.ts holds them to what was asked.
//
// THE RULES (2026-10-13, the user's, in two messages; they replace the rules of 2026-10-10 where they differ):
//   "a specific type of loot is in specific types of buildings. the density and tier of the loot depends on its
//   location on the map." "designate certain buildings with certain categories of loot, like sheds get tools and
//   industrial, medical gets medical." "classify the loot by tier, what tier ammo is the gun for? T4? then it
//   should spawn lighht in t3 military spawns and heavier in t4+ military spawns ... think like DAYZ."
//
// So a thing has a KIND OF BUILDING it is kept in (`usage`) and a STEP it belongs to (`at`): its own step and
// above is where it is common, the step below is where there is a little of it, and below that there is none.
//
//   the kind of building     what is kept there
//   police, army             guns, magazines, what they fire (every calibre: "the small police station has low
//                            caliber weapons and all ammos", "i am only finding low tier ammo in the big police
//                            when i should find all ammo there"), what goes on a gun, what a constable or a soldier wore
//   clinic (Medic)           "lean heavy on bandages and stims and less medkits"
//   hospital                 "medkit abundant and lots of stims"
//   shed, barn, garage       "tools and industrial, flashlight": tools, lights, fuel, gloves, boots, sacks
//   shop                     "supplies and food, and water, flashlight"
//   houses                   food and drink, what people wore and carried; now and then a pistol and its rounds
//   cabin                    a hunter's: a knife, a compass, a flask, rifle rounds
//
//   the step                 what it is for
//   1 the outskirts          "t1 melee heavy": something to hit with, a light, food and water. No gun.
//   2 the village, the camp  pistols, with the big police station the place for a submachine gun ("more sub
//                            machine guns in the [two-]story police station"); every calibre, a little of the high ones
//   3 Kamenka                "tier 3 should be submachine guns heavy". An AK and an AR-15 "rarely, and ... an even
//                            rarer chance of having a magazine. you CAN get everything you need from T3 for AR's
//                            but its very rare": one of each in the whole town, three quarters of an hour apart
//   4 under the gas          the rifles' own step: "more common in the T4"
//   5 the bunker             "abundant supplies in the T5": and the shotgun and the Desert Eagle, which are nowhere else
//
// (What went with this: the showcase of 2026-10-11, which strewed every new gun through Kamenka's houses "FOR
// NOW ... then take it away", is taken away: "move the weapons out of kamenka and into their rightful places and
// tiered spawn locations".)
//
// The map has about 324 places for things on the outskirts, 1090 in the village and the army's places, 739 in
// Kamenka, 119 under the gas and 145 down the bunker. Under the gas and down the bunker every place is spoken
// for: one more of anything there is one fewer of something else.
export const TYPES: Record<string, TypeRule> = {
  // ------------------------------------------------------------ guns
  // (Weapons and what they fire come back fast: a gun taken off a shelf is back somewhere on its step within
  // three minutes, rounds within two. At seven minutes for a rifle a busy server ran dry.)
  // The sniper rifle: the gas's. One in Kamenka (and the one the hospital's roof always keeps).
  mosin: { at: [0, 0, 1, 7, 2], lifetime: 7200, restock: 180, usage: ARMY, loaded: [1, 4], keep: SOON, on: { 3: { restock: 1500 } } },
  // Pistols: the village's. Where guns were kept, and now and then a house.
  colt: { at: [0, 18, 4, 0, 0], lifetime: 7200, restock: 180, usage: [...ARMY, 'Town'], favour: ARMOURY, loaded: [2, 6], keep: SOON, on: { 3: IN_TOWN } },
  m9: { at: [0, 16, 6, 0, 0], lifetime: 7200, restock: 180, usage: [...ARMY, 'Town'], favour: ARMOURY, loaded: [3, 10], keep: SOON, on: { 3: IN_TOWN } },
  // The submachine gun: Kamenka's, and the big police station's before that.
  // (in the village it is a policeman's and a soldier's, and not a householder's)
  mpa: { at: [0, 12, 14, 0, 0], lifetime: 7200, restock: 240, usage: [...ARMY, 'Town'], favour: ARMOURY, loaded: [5, 20], keep: SOON, on: { 2: { usage: ARMY }, 3: IN_TOWN } },
  // The two assault rifles: the gas's, and the bunker's racks and lockers (see crates.ts). In Kamenka one of each,
  // where the army and the police kept things, seldom with a magazine in it, and a long time coming back.
  ak: { at: [0, 0, 1, 5, 0], lifetime: 7200, restock: 300, usage: ARMY, loaded: [5, 20], keep: SOON, on: { 3: { restock: 2700, mag: 0.15 } } },
  ar15: { at: [0, 0, 1, 3, 1], lifetime: 7200, restock: 420, usage: ARMY, loaded: [5, 20], keep: SOON, on: { 3: { restock: 3000, mag: 0.12 } } },
  // The shotgun and the Desert Eagle: the bunker's, and nobody else's.
  benelli: { at: [0, 0, 0, 0, 4], lifetime: 7200, restock: 600, usage: [], loaded: [3, 7] },
  deagle: { at: [0, 0, 0, 0, 4], lifetime: 7200, restock: 600, usage: [], loaded: [2, 7] },
  // ------------------------------------------------------------ what they fire: each on its gun's step and above, a little on the step below
  // (loose rounds turn up in handfuls; sealed boxes are the real find, and are where guns were kept)
  // 9 mm and .45: the pistols' and the submachine gun's. A handful in a house or a cabin as well.
  ammo_9mm: { at: [10, 40, 30, 0, 1], lifetime: 3600, restock: 120, usage: [...ARMY, 'Hunting', ...HOMES], favour: ROUNDS, qty: [0.25, 0.6], keep: SOON, on: { 3: IN_TOWN } },
  box_9mm: { at: [0, 18, 12, 1, 2], lifetime: 3600, restock: 180, usage: ARMY, favour: ARMOURY, keep: SOON, on: { 3: { usage: [...ARMY, 'Town'], ...IN_TOWN } } },
  ammo_45: { at: [5, 18, 6, 0, 0], lifetime: 3600, restock: 120, usage: [...ARMY, 'Hunting', ...HOMES], favour: ROUNDS, qty: [0.25, 0.6], keep: SOON, on: { 3: IN_TOWN } },
  box_45: { at: [0, 6, 2, 0, 0], lifetime: 3600, restock: 240, usage: ARMY, favour: ARMOURY, keep: SOON },
  // 7.62: the sniper rifle's. A hunter has some.
  ammo_762: { at: [2, 6, 5, 5, 2], lifetime: 3600, restock: 120, usage: [...ARMY, 'Hunting'], favour: ARMOURY, qty: [0.25, 0.6], keep: SOON },
  box_762: { at: [0, 2, 3, 6, 2], lifetime: 3600, restock: 180, usage: ARMY, favour: ARMOURY, keep: SOON },
  // 7.39 and 5.56: the rifles'. Light where the army and the police were below the gas, heavier from the gas up.
  ammo_739: { at: [0, 4, 4, 5, 3], lifetime: 3600, restock: 180, usage: ARMY, favour: ARMOURY, qty: [0.25, 0.6], keep: SOON },
  box_739: { at: [0, 1, 1, 3, 2], lifetime: 3600, restock: 240, usage: ARMY, favour: ARMOURY, keep: SOON },
  ammo_556: { at: [0, 4, 4, 4, 4], lifetime: 3600, restock: 180, usage: ARMY, favour: ARMOURY, qty: [0.25, 0.6], keep: SOON },
  box_556: { at: [0, 1, 1, 2, 3], lifetime: 3600, restock: 240, usage: ARMY, favour: ARMOURY, keep: SOON },
  // 12 gauge and .50: the bunker's guns'. A handful where the police and the army were, for whoever is going
  // down there ("you should be able to find high tier ammo in medium-high tier loot spots"); boxes from the gas up.
  ammo_12: { at: [0, 2, 2, 2, 7], lifetime: 3600, restock: 300, usage: ARMY, favour: ARMOURY, qty: [0.3, 0.7] },
  box_12: { at: [0, 0, 0, 1, 4], lifetime: 3600, restock: 420, usage: [] },
  ammo_50: { at: [0, 2, 2, 1, 6], lifetime: 3600, restock: 300, usage: ARMY, favour: ARMOURY, qty: [0.3, 0.7] },
  box_50: { at: [0, 0, 0, 0, 3], lifetime: 3600, restock: 420, usage: [] },
  // ------------------------------------------------------------ magazines: where the guns they fit are kept, about as many as there are guns
  mag_colt: { at: [0, 14, 4, 0, 0], lifetime: 7200, restock: 240, usage: [...ARMY, 'Town'], favour: ARMOURY, keep: SOON, on: { 3: IN_TOWN } },
  mag_m9: { at: [0, 13, 6, 0, 0], lifetime: 7200, restock: 240, usage: [...ARMY, 'Town'], favour: ARMOURY, keep: SOON, on: { 3: IN_TOWN } },
  mag_m9_ext: { at: [0, 2, 2, 0, 0], lifetime: 7200, restock: 1200, usage: ['Military'] },
  mag_mpa: { at: [0, 12, 14, 0, 2], lifetime: 7200, restock: 300, usage: [...ARMY, 'Town'], favour: ARMOURY, keep: SOON, on: { 2: { usage: ARMY }, 3: IN_TOWN } },
  mag_sniper: { at: [0, 0, 1, 4, 2], lifetime: 7200, restock: 300, usage: ARMY, keep: SOON, on: { 3: { restock: 1500 } } },
  // (in Kamenka one of each, and as long coming back as the rifle: a rifle that fires is put together there
  // from three finds, and it is a long evening's work)
  mag_ak: { at: [0, 0, 1, 4, 2], lifetime: 7200, restock: 300, usage: ARMY, keep: SOON, on: { 3: { restock: 2400 } } },
  mag_ar: { at: [0, 0, 1, 3, 3], lifetime: 7200, restock: 300, usage: ARMY, keep: SOON, on: { 3: { restock: 2700 } } },
  drum_ak: { at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1200, usage: [] },
  mag_ar_60: { at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1200, usage: [] },
  mag_deagle: { at: [0, 0, 0, 0, 4], lifetime: 7200, restock: 600, usage: [] },
  mag_deagle_ext: { at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1200, usage: [] },
  // ------------------------------------------------------------ what goes on a gun
  suppressor_9: { at: [0, 2, 4, 0, 0], lifetime: 7200, restock: 1800, usage: ARMY, favour: { Police: 3 } },
  red_dot: { at: [0, 1, 3, 3, 3], lifetime: 7200, restock: 1800, usage: ARMY },
  // (not in the police station alone: its few shelves are where the gas masks are kept)
  gun_light: { at: [0, 3, 3, 3, 3], lifetime: 3600, restock: 900, usage: ['Military', 'Industrial', 'Police'] },
  foregrip: { at: [0, 0, 1, 0, 2], lifetime: 7200, restock: 1200, usage: ARMY },
  pu_scope: { at: [0, 0, 1, 6, 3], lifetime: 7200, restock: 1800, usage: ARMY },
  rifle_wrap: { at: [0, 0, 2, 3, 1], lifetime: 7200, restock: 1500, usage: ARMY },
  suppressor_762: { at: [0, 0, 0, 3, 2], lifetime: 7200, restock: 1800, usage: [] },
  suppressor_739: { at: [0, 0, 0, 1, 1], lifetime: 7200, restock: 1800, usage: [] },
  suppressor_556: { at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1800, usage: [] },
  suppressor_12: { at: [0, 0, 0, 0, 3], lifetime: 7200, restock: 1200, usage: [] },
  // (what opens the bunker is kept under the gas: the one place is the way into the other)
  keycard: { at: [0, 0, 0, 2, 0], lifetime: 7200, restock: 600, usage: [] },
  // ------------------------------------------------------------ what you hit with: the outskirts'
  // ("t1 melee heavy". Past the outskirts the tools of a shed are still in sheds, a few: a shed with nothing in
  // it is a shed nobody opens twice. Nothing to hit with lies in a house, a shop or a barracks past the outskirts.)
  hatchet: { at: [14, 3, 2, 0, 0], lifetime: 3600, restock: 180, usage: [...SHEDS, 'Village'], favour: { Farm: 2, Hunting: 2 }, on: IN_SHEDS },
  machete: { at: [12, 0, 0, 0, 0], lifetime: 3600, restock: 180, usage: [...SHEDS, 'Village'], favour: { Farm: 2 } },
  crowbar: { at: [14, 3, 2, 0, 0], lifetime: 3600, restock: 180, usage: [...SHEDS, 'Village'], favour: { Industrial: 2 }, on: IN_SHEDS },
  bat: { at: [13, 0, 0, 0, 0], lifetime: 3600, restock: 180, usage: [...HOMES, 'Farm'] },
  // (a tool of yards and sheds: it lies on a floor, being as long as a rifle is)
  shovel: { at: [11, 3, 2, 0, 0], lifetime: 3600, restock: 180, usage: [...SHEDS, 'Village'], favour: { Farm: 2, Industrial: 2 }, on: IN_SHEDS },
  knife: { at: [18, 4, 3, 0, 0], lifetime: 3600, restock: 180, usage: [...HOMES, ...SHEDS], on: IN_SHEDS },
  // ------------------------------------------------------------ food and drink: the shop before anywhere, then kitchens
  sprats: { at: [8, 16, 7, 0, 0], lifetime: 2400, restock: 300, usage: ['Shop', ...HOMES], favour: LARDER },
  condensed: { at: [3, 10, 6, 1, 3], lifetime: 2400, restock: 300, usage: ['Shop', ...HOMES, 'Military'], favour: LARDER },
  beans: { at: [9, 18, 9, 0, 1], lifetime: 2400, restock: 300, usage: ['Shop', ...HOMES, 'Farm'], favour: LARDER },
  tomatoes: { at: [6, 10, 6, 0, 0], lifetime: 2400, restock: 300, usage: ['Shop', 'Village', 'Farm'], favour: LARDER },
  sardines: { at: [7, 14, 8, 0, 1], lifetime: 2400, restock: 300, usage: ['Shop', ...HOMES, 'Hunting'], favour: LARDER },
  apple: { at: [7, 9, 6, 0, 0], lifetime: 1200, restock: 300, usage: ['Shop', 'Village', 'Farm'], favour: LARDER },
  milk: { at: [3, 9, 5, 0, 0], lifetime: 1800, restock: 300, usage: ['Shop', ...HOMES], favour: LARDER },
  // (there was a third as much to drink on the map as to eat, and thirst runs as fast as hunger)
  water_jug: { at: [8, 16, 10, 1, 1], lifetime: 2400, restock: 300, usage: ['Shop', ...HOMES, 'Farm', 'Industrial'], favour: { Shop: 9 } },
  flask: { at: [4, 10, 6, 1, 3], lifetime: 2400, restock: 300, usage: ['Shop', 'Military', 'Hunting', 'Village', 'Farm'], favour: { Shop: 5 } },
  thermos: { at: [4, 10, 5, 1, 1], lifetime: 2400, restock: 300, usage: ['Shop', 'Military', 'Hunting', 'Village', 'Police', 'Industrial'], favour: { Shop: 2 } },
  // ------------------------------------------------------------ medical: the clinic and the hospital
  // (What stops bleeding is what a fight is lost for want of: a bandage is in houses, shops and barracks too.)
  // A clinic leans on bandages and stims, with a kit or two; the hospital is where the kits are, and stims by the shelf.
  bandage: { at: [16, 34, 26, 2, 3], lifetime: 2400, restock: 240, usage: ['Medic', 'Hospital', 'Shop', ...HOMES, 'Military', 'Police', 'Hunting', 'Farm'], favour: { Medic: 26, Hospital: 2, Shop: 1.5, Military: 2 } },
  stim: { at: [0, 20, 60, 3, 4], lifetime: 3000, restock: 360, usage: ['Medic', 'Hospital', 'Military', 'Police', ...HOMES], favour: { Medic: 16, Hospital: 6, Military: 3, Police: 2 } },
  // (the yellow one, for the breath: see items.ts. A soldier's thing as much as a nurse's.)
  stim_stamina: { at: [0, 8, 24, 1, 2], lifetime: 3000, restock: 360, usage: ['Medic', 'Hospital', 'Military', 'Police'], favour: { Medic: 10, Hospital: 5, Military: 4 } },
  firstaid: { at: [0, 5, 55, 3, 3], lifetime: 3600, restock: 600, usage: ['Hospital', 'Medic', 'Military', 'Police'], favour: { Hospital: 14, Medic: 3 } },
  // What gives blood back (2026-10-13; src/sim/blood.ts): saline in a clinic and the hospital, and with the army's
  // medics; blood in the hospital before anywhere, a bag or two in a clinic's fridge, and where the best of
  // everything is. (Under the gas every place is spoken for: a stim and a dressing there have made way for them.)
  saline: { at: [0, 6, 14, 1, 2], lifetime: 3600, restock: 420, usage: ['Medic', 'Hospital', 'Military'], favour: { Medic: 10, Hospital: 5 } },
  blood_bag: { at: [0, 2, 12, 2, 3], lifetime: 3600, restock: 600, usage: ['Hospital', 'Medic', 'Military'], favour: { Hospital: 12, Medic: 4 } },
  // (what sets a broken leg and does nothing else: where there are ladders and lofts to fall off, too)
  splint: { at: [5, 10, 24, 1, 2], lifetime: 3600, restock: 420, usage: ['Medic', 'Hospital', 'Shop', ...HOMES, 'Farm', 'Hunting', 'Industrial', 'Police'], favour: { Medic: 6, Hospital: 4, Shop: 2 } },
  // ------------------------------------------------------------ what is worn and carried
  patrol_cap: { at: [0, 11, 3, 0, 0], lifetime: 3600, restock: 600, usage: ARMY },
  fishermans_hat: { at: [6, 6, 4, 0, 0], lifetime: 3600, restock: 600, usage: [...HOMES, 'Farm', 'Hunting'] },
  // (The Field Jacket and the Field Trousers have no rule: everybody is dressed in them from the start and only one
  // of each is worn, so a spare is room for nothing. They come off the dead. The places for clothes on the first
  // step are full as it is: two more kinds there, and the bags that are wanted went short.)
  garden_gloves: { at: [6, 5, 4, 0, 0], lifetime: 3600, restock: 600, usage: ['Village', 'Farm', 'Industrial'] },
  // (a workman's: sheds and yards before barracks)
  work_gloves: { at: [3, 8, 3, 0, 0], lifetime: 3600, restock: 900, usage: ['Industrial', 'Farm', 'Military'], favour: { Industrial: 2 } },
  rubber_boots: { at: [3, 8, 3, 0, 0], lifetime: 3600, restock: 900, usage: ['Industrial', 'Farm', 'Military', 'Police'], favour: { Industrial: 2 } },
  boonie_hat: { at: [0, 1, 2, 5, 4], lifetime: 3600, restock: 900, usage: ['Military'] },
  // (the heaviest helmet there is: the bunker's)
  helmet_k63: { at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1800, usage: [] },
  // (The mask is what lets anybody into the gas, so it is not kept IN the gas: it is a policeman's, in the
  // police station of the village and in Kamenka's, and these are what the whole map has to share, bar what one
  // of the army's cases or a supply drop turns up.)
  gasmask: { at: [0, 3, 2, 0, 0], lifetime: 3600, restock: 900, usage: ['Police'] },
  // (armour by weight: the rig in sheds and houses, the soft vest where the police and the army were, the
  // armoured vest in Kamenka and one that got as far as the village, the plate carrier under the gas, the heavy
  // armour only down the bunker)
  chest_rig: { at: [7, 7, 5, 0, 0], lifetime: 3600, restock: 600, usage: [...SHEDS, 'Town'] },
  soft_vest: { at: [0, 10, 4, 0, 0], lifetime: 3600, restock: 900, usage: ARMY, favour: { Police: 3 } },
  armor_vest: { at: [0, 1, 6, 1, 0], lifetime: 3600, restock: 1200, usage: ARMY, favour: { Military: 3 } },
  life_vest: { at: [0, 0, 0, 7, 4], lifetime: 3600, restock: 900, usage: [] },
  heavy_armor: { at: [0, 0, 0, 0, 3], lifetime: 7200, restock: 1800, usage: [] },
  // (three packs: the day pack from the first step, the camping pack from the village on, and the army's
  // rucksack, the biggest, from the fourth step up and never below it)
  sack_pack: { at: [8, 7, 4, 0, 0], lifetime: 3600, restock: 600, usage: [...SHEDS, 'Town', 'Shop'] },
  camping_pack: { at: [0, 6, 5, 0, 0], lifetime: 3600, restock: 900, usage: [...HOMES, 'Hunting', 'Shop'] },
  suitcase: { at: [0, 0, 0, 3, 3], lifetime: 3600, restock: 1200, usage: [] },
  // ------------------------------------------------------------ tools and odds and ends
  // (a lantern is a thing of sheds, yards and the shop's shelf: most of them out where anybody starts, because the night is everybody's)
  flashlight: { at: [22, 12, 8, 1, 2], lifetime: 3600, restock: 420, usage: [...SHEDS, 'Shop', 'Town'], favour: { Shop: 8, Industrial: 3, Farm: 2 } },
  binoculars: { at: [2, 2, 2, 1, 1], lifetime: 3600, restock: 1200, usage: ['Military', 'Hunting', 'Police'] },
  compass: { at: [4, 4, 3, 0, 0], lifetime: 3600, restock: 1200, usage: ['Military', 'Hunting', 'Village', 'Shop'], favour: { Shop: 3 } },
  cigarettes: { at: [4, 10, 7, 0, 1], lifetime: 2400, restock: 600, usage: [...HOMES, 'Military', 'Industrial', 'Shop'], favour: { Shop: 2 } },
  grenade: { at: [0, 3, 3, 5, 4], lifetime: 3600, restock: 1200, usage: ['Military'] },
  stash_kit: { at: [3, 3, 1, 0, 0], lifetime: 7200, restock: 1800, usage: ['Farm', 'Industrial', 'Hunting'] },
  // (a field radio: good for one supply drop called down where it is used. One at the army's; the trader sells them dear.)
  radio: { at: [0, 1, 1, 0, 0], lifetime: 7200, restock: 2400, usage: ['Military'] },
  // fuel for the jeeps (src/sim/vehicles.ts): where there are sheds, yards and soldiers
  jerrycan: { at: [6, 10, 5, 1, 1], lifetime: 3600, restock: 600, usage: ['Farm', 'Industrial', 'Military'], favour: { Industrial: 2 } },
  // (two more things to keep things in, beside the stash case: a black sack, in every shed, and a suitcase, in houses)
  black_bag: { at: [5, 8, 3, 0, 0], lifetime: 7200, restock: 1200, usage: [...SHEDS, 'Town'] },
  old_suitcase: { at: [3, 6, 3, 0, 0], lifetime: 7200, restock: 1800, usage: HOMES },
};

const STEPS: Tier[] = [1, 2, 3, 4, 5];
/** from this step up, what lies there lies wherever it will: the kind of building is not asked (the works under the gas, and the bunker) */
const UNSORTED = 4;

/**
 * What is put down before anything else when a world is stocked: the masks, which are what lets anybody into the
 * gas; then the long things and the big ones, which lie only on a floor, while there are floors free (down the
 * bunker there are thirteen, and with everything put down turn about half the shotguns had nowhere to lie; on the
 * outskirts the bats and the crowbars came up a few short, which of them depending on the dice); and then what
 * each kind of building is FOR, so that a clinic's shelves hold dressings and an armoury's hold guns before
 * anything else that may lie there has taken them.
 */
const FIRST = [
  'gasmask', 'benelli', 'mosin', 'ak', 'ar15', 'suppressor_12', 'suitcase', 'heavy_armor', 'life_vest', 'armor_vest', 'bat', 'crowbar', 'shovel', 'machete', 'hatchet',
  'mpa', 'colt', 'm9', 'mag_mpa', 'mag_colt', 'mag_m9', 'firstaid', 'blood_bag', 'stim', 'stim_stamina', 'saline', 'bandage',
];


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

  /** can a sort lie at this spot on this step: is the spot of a kind it is kept in, and is there room on it */
  private liesAt(id: string, rule: TypeRule, i: number, where: Tier): boolean {
    const p = this.points[i];
    const kinds = rule.on?.[where]?.usage ?? rule.usage;
    if (where < UNSORTED && !p.usage.some((u) => kinds.includes(u))) return false;
    // a rifle never spawns on a narrow shelf, a jerrycan never on a barrel
    return this.fits(id, p);
  }

  private pickPoint(id: string, rule: TypeRule, where: Tier): number {
    const sorted = where < UNSORTED, favour = rule.on?.[where]?.favour ?? rule.favour;
    let candidates: number[] = [];
    const weights: number[] = [];
    let total = 0;
    /** spots it could lie at but for having lain there last: where it goes when there is nowhere else at all */
    const again: number[] = [];
    this.points.forEach((p, i) => {
      // armed points are stocked on their own (see arm)
      if (p.arms || p.keeps || this.pointBusy.has(i) || this.tier[i] !== where) return;
      // (not under anybody's nose)
      if (this.crowded.has(i)) return;
      // (not where somebody has just looted, nor back where this same thing last lay)
      if (!this.rested(i)) return;
      if (!this.liesAt(id, rule, i, where)) return;
      const was = this.lastAt.get(i);
      if (was && was.id === id && this.time - was.at < SAME_AGAIN) return void again.push(i);
      let w = 1;
      if (sorted && favour) for (const u of p.usage) w = Math.max(w, favour[u] ?? 1);
      candidates.push(i);
      weights.push(w);
      total += w;
    });
    // (Where every place is spoken for, under the gas and down the bunker, the spot a thing was taken from is the
    // one spot there is: it goes back there once the spot has rested, and is not kept out of the world for a
    // quarter of an hour. "The same loot shouldnt spawn in the same locations (unless by chance)": or need.)
    if (!candidates.length && again.length) {
      candidates = again;
      for (const _ of again) weights.push(1);
      total = again.length;
    }
    if (!candidates.length) return -1;
    let r = this.rng.next() * total;
    for (let k = 0; k < candidates.length; k++) {
      r -= weights[k];
      if (r <= 0) return candidates[k];
    }
    return candidates[candidates.length - 1];
  }

  /** @param armed the spot is one that always holds a weapon (see `arm`): what is put there is a gun that fires */
  private spawnType(id: string, at = -1, where: Tier = 1, armed = at >= 0): boolean {
    const rule = TYPES[id];
    const def = ITEMS[id];
    const pi = at >= 0 ? at : this.pickPoint(id, rule, where);
    if (pi < 0) return false;
    const p = this.points[pi];
    const item = makeItem(id);
    if (def.stack && rule.qty) item.qty = Math.max(1, Math.round(def.stack * this.rng.range(rule.qty[0], rule.qty[1])));
    if (def.weapon) {
      fitAtRandom(item, () => this.rng.next());
      // (the drum and the long magazine are the bunker's and nobody else's: a rifle found anywhere else has its own)
      if (where < 5) plainMag(item);
      // (what is left at an armed place is a gun that fires: it has its magazine, whatever the dice said)
      if (armed && def.weapon.mag && !item.mag) item.mag = def.weapon.mag;
      // (and on a step where it is a rare find, it is rarer still with its magazine in it)
      const mag = armed ? undefined : rule.on?.[where]?.mag;
      if (mag !== undefined && def.weapon.mag) item.mag = this.rng.next() < mag ? def.weapon.mag : null;
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

  /** when each sort was first found short on each step, since it was last made up (see `restock`) */
  private shortSince: Record<string, number> = {};
  /** the spots with somebody living within NEAR_PLAYER metres of them, as of the last count: nothing is put down there */
  private crowded = new Set<number>();
  /** when each spot was last looted, and what last lay at each (see LOOTED_REST) */
  private looted = new Map<number, number>();
  private lastAt = new Map<number, { id: string; at: number }>();
  /** nothing has been taken from this spot, or from close by it, in the last LOOTED_REST seconds */
  private rested(i: number): boolean {
    const p = this.points[i];
    for (const [k, at] of this.looted) {
      if (this.time - at >= LOOTED_REST) {
        this.looted.delete(k);
        continue;
      }
      const q = this.points[k];
      if (k === i || Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < LOOTED_ABOUT) return false;
    }
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
        if (!this.rested(i)) return;
      }
      // (a place that keeps one named thing: that thing, and nothing in its stead)
      if (p.keeps) {
        if (ITEMS[p.keeps]) this.spawnType(p.keeps, i);
        this.bare.delete(i);
        return;
      }
      // a few tries: a rifle will not lie on a shelf
      // (on the outskirts, something to hit with and never a gun; further in, a pistol where guns were kept)
      const table = this.tier[i] <= 1 ? ARMS.filter(([id]) => !ITEMS[id].weapon) : p.arms === 'guns' ? (this.tier[i] >= 3 ? ARMS_TOWN : ARMS.filter(([id]) => ITEMS[id].weapon)) : ARMS;
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

  /**
   * Player picked an item up (or it was destroyed).
   * @param looted taken by somebody (the spot is then left alone a while: see LOOTED_REST), not merely gone with age
   */
  take(uid: string, looted = true) {
    const l = this.loot.get(uid);
    if (!l) return null;
    this.loot.delete(uid);
    if (l.point >= 0) {
      this.pointBusy.delete(l.point);
      this.lastAt.set(l.point, { id: l.item.id, at: this.time });
      if (looted) this.looted.set(l.point, this.time);
    }
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
    // (Nothing appears within sight of anybody: DayZ keeps a hundred metres, and this map is small, so fifty. In
    // a room that is full, under the gas or down the bunker, what a looter took came back onto its shelf three
    // minutes later with the looter still standing there.)
    this.crowded.clear();
    if (players.length) this.points.forEach((p, i) => players.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < NEAR_PLAYER) && this.crowded.add(i));
    const near = (l: WorldLoot) => players.some((p) => Math.hypot(l.x - p.x, l.z - p.z) < 60);
    const now = Date.now();
    for (const l of [...this.loot.values()]) {
      // (a container somebody dropped goes by the calendar, and not by how long this game has been running)
      if (l.keptAt !== undefined) {
        if (now - l.keptAt > (l.item.cargo?.length ? this.containerLife.full : this.containerLife.empty) && !near(l)) this.take(l.uid, false);
        continue;
      }
      const rule = TYPES[l.item.id];
      const life = rule ? rule.lifetime : 3600;
      if (this.time - l.spawnedAt > life && !near(l)) this.take(l.uid, false);
    }
    this.arm();
    for (const [id, rule] of Object.entries(TYPES)) {
      for (const t of STEPS) {
        const want = rule.at[t - 1];
        if (!want) continue;
        // (from Kamenka up every one that is gone is put back, and soon; below it, once a share of them is gone)
        const every = rule.on?.[t]?.restock;
        if (t >= 3) this.restock(id, t, want, want, every ?? Math.min(rule.restock, GAS_RESTOCK));
        else this.restock(id, t, want, Math.max(1, Math.ceil(want * (rule.keep ?? 0.6))), every ?? rule.restock);
      }
    }
  }

  /** Puts a sort back up to `want` on a step where fewer than `least` of it are left there, no oftener than `every` seconds. */
  private restock(id: string, where: Tier, want: number, least: number, every: number) {
    const n = this.held(id, where);
    const key = `${id}@${where}`;
    if (n >= least) return void delete this.shortSince[key];
    // (The wait runs from when it was first found short, which is within a count of its being taken. It ran from
    // when its sort was last PUT BACK: a thing that had lain an hour, or since the server started, was back five
    // seconds after it was taken, however long its rule said. Kamenka's one AK, "three quarters of an hour"
    // coming back, came straight back. Found on reading, twice over, 2026-10-13.)
    const since = (this.shortSince[key] ??= this.time);
    if (this.time - since < every) return;
    // (the clock of a sort starts again when some of it has been put back: with nowhere for it to go just now, a
    // looted spot resting and its only other place taken, it is tried again at the next count and not in seven minutes)
    let put = 0;
    for (let k = n; k < want; k++) {
      if (!this.spawnType(id, -1, where)) break;
      put++;
    }
    if (put) {
      this.lastRestock[key] = this.time;
      // (made up: the next wait begins at the next loss. Still short, with nowhere to put the rest: tried again at every count.)
      if (n + put >= least) delete this.shortSince[key];
    }
  }

  serialize() {
    return { time: this.time, lastRestock: this.lastRestock, loot: [...this.loot.values()] };
  }
}
