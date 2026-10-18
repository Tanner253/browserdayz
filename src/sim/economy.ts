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
import { ITEMS, fitAtRandom, foundMag, makeItem, plainMag, stockGun, TAG_GROUND, type ItemInstance } from './items';
import { ITEM_SIZES, fitsPoint } from './placement';
import { RNG } from '../core/noise';
import { TOWNS } from './towns';

export interface TypeRule {
  /**
   * How many are kept on each step of the map (src/sim/tiers.ts): [the outskirts, the village and the army's
   * places, Kamenka, under the gas, the bunker]. A nought is never: a thing kept only from the third step up is
   * not found on the first two, wherever anybody looks.
   */
  at: [number, number, number, number, number];
  /**
   * Or as a rate: of the spots on each step where it can lie (its kinds of building, see `usage`), the share that are
   * kept with one, so that the places it belongs to have it however many of them there are; the count is worked out
   * from the map (Economy.kept), never less than `at`. The owner, 2026-10-15: "someone with an AR needs to be able to
   * loot reliable places for ammo not set spawns, just spawn frequency ... based on tiers and cateogryu of building".
   */
  per?: [number, number, number, number, number];
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
// (and the weapons pass's submachine guns, the owner, 2026-10-17: "ensure that the new weapons can spawn at T3+")
const ARMS_TOWN: [string, number][] = [['mpa', 2.4], ['m9', 1.6], ['colt', 1], ['scorpion', 1.2], ['dual_smg', 0.8], ['dual_mac10', 0.8], ['mp7a1', 0.8], ['aks74u', 0.8]];
/**
 * And on the racks of a place apart on the fourth step, the fort's armoury: the army's rifles. (The submachine gun
 * was the likeliest of them until the owner had climbed to it, 2026-10-13: "the loot in the castle should be a bit
 * better i think". A rack at the top of a mountain holds a rifle two times in three.)
 */
// (and the weapons pass's: its rifles, its short AK and its MP7 on the fort's racks too)
const ARMS_FORT: [string, number][] = [['ak', 2], ['ar15', 2], ['mosin', 1.6], ['mpa', 1.6], ['m9', 0.6], ['aks74u', 1.2], ['mp7a1', 1], ['vssk', 1], ['sniper50', 0.6], ['barrett', 0.5]];
/** seconds such a rack stays bare once its gun has been taken: the best part of half an hour, where a village's is three minutes (six racks of rifles filled every three minutes would be a well of them) */
const APART_ARMS_RESTOCK = 1500;
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
  mosin: { at: [0, 0, 2, 7, 2], lifetime: 7200, restock: 180, usage: ARMY, loaded: [1, 4], keep: SOON, on: { 3: { restock: 1500 } } },
  // Pistols: the village's. Where guns were kept, and now and then a house.
  colt: { at: [0, 7, 20, 0, 0], lifetime: 7200, restock: 180, usage: [...ARMY, 'Town'], favour: ARMOURY, loaded: [2, 6], keep: SOON, on: { 3: IN_TOWN } },
  m9: { at: [0, 6, 24, 0, 0], lifetime: 7200, restock: 180, usage: [...ARMY, 'Town'], favour: ARMOURY, loaded: [3, 10], keep: SOON, on: { 3: IN_TOWN } },
  // The submachine gun: Kamenka's, and the big police station's before that.
  // (in the village it is a policeman's and a soldier's, and not a householder's)
  mpa: { at: [0, 3, 38, 0, 0], lifetime: 7200, restock: 240, usage: [...ARMY, 'Town'], favour: ARMOURY, loaded: [5, 20], keep: SOON, on: { 2: { usage: ARMY }, 3: IN_TOWN } },
  // (the weapons pass, 2026-10-17: the Scorpion a third-step gun, the towns' and the army's)
  barrett: { at: [0, 0, 0, 0, 1], lifetime: 7200, restock: 1200, usage: [], loaded: [2, 10] },
  mag_barrett: { at: [0, 0, 0, 1, 1], lifetime: 7200, restock: 1200, usage: [] },
  vssk: { at: [0, 0, 0, 0, 1], lifetime: 7200, restock: 900, usage: [], loaded: [1, 5] },
  mag_vssk: { at: [0, 0, 0, 1, 2], lifetime: 7200, restock: 900, usage: [] },
  ammo_127x55: { at: [0, 0, 0, 2, 3], lifetime: 3600, restock: 600, usage: [], qty: [0.3, 0.8] },
  box_127x55: { at: [0, 0, 0, 0, 1], lifetime: 3600, restock: 900, usage: [] },
  sniper50: { at: [0, 0, 0, 0, 1], lifetime: 7200, restock: 900, usage: [], loaded: [1, 5] },
  mag_sniper50: { at: [0, 0, 0, 1, 2], lifetime: 7200, restock: 900, usage: [] },
  ammo_50bmg: { at: [0, 0, 0, 2, 4], lifetime: 3600, restock: 600, usage: [], qty: [0.3, 0.8] },
  box_50bmg: { at: [0, 0, 0, 0, 1], lifetime: 3600, restock: 900, usage: [] },
  dual_sawnoff: { at: [0, 1, 12, 0, 0], lifetime: 7200, restock: 240, usage: ['Hunting', ...HOMES], loaded: [0, 4], keep: SOON },
  dual_mac10: { at: [0, 0, 7, 2, 0], lifetime: 7200, restock: 300, usage: [...ARMY, 'Town'], favour: ARMOURY, loaded: [10, 40], keep: SOON },
  mag_dual_mac10: { at: [0, 0, 7, 2, 0], lifetime: 7200, restock: 300, usage: [...ARMY, 'Town'], favour: ARMOURY, keep: SOON },
  mac10_suppressor: { at: [0, 0, 2, 2, 1], lifetime: 7200, restock: 1800, usage: ARMY },
  dual_smg: { at: [0, 0, 9, 2, 0], lifetime: 7200, restock: 300, usage: [...ARMY, 'Town'], favour: ARMOURY, loaded: [10, 40], keep: SOON },
  mag_dual_smg: { at: [0, 0, 9, 2, 0], lifetime: 7200, restock: 300, usage: [...ARMY, 'Town'], favour: ARMOURY, keep: SOON },
  db12: { at: [0, 0, 15, 0, 0], lifetime: 7200, restock: 240, usage: ['Hunting', ...HOMES], loaded: [0, 2], keep: SOON },
  aks74u: { at: [0, 0, 0, 2, 0], lifetime: 7200, restock: 300, usage: ARMY, loaded: [5, 20], keep: SOON },
  mp7a1: { at: [0, 0, 0, 4, 2], lifetime: 7200, restock: 300, usage: [...ARMY], favour: ARMOURY, loaded: [5, 20], keep: SOON },
  scorpion: { at: [0, 0, 23, 3, 0], lifetime: 7200, restock: 240, usage: [...ARMY, 'Town'], favour: ARMOURY, loaded: [5, 20], keep: SOON, on: { 3: IN_TOWN } },
  // The two assault rifles: the gas's, and the bunker's racks and lockers (see crates.ts). In Kamenka one of each,
  // where the army and the police kept things, seldom with a magazine in it, and a long time coming back.
  ak: { at: [0, 0, 2, 5, 0], lifetime: 7200, restock: 300, usage: ARMY, loaded: [5, 20], keep: SOON, on: { 3: { restock: 2700, mag: 0.15 } } },
  ar15: { at: [0, 0, 2, 3, 1], lifetime: 7200, restock: 420, usage: ARMY, loaded: [5, 20], keep: SOON, on: { 3: { restock: 3000, mag: 0.12 } } },
  // The shotgun and the Desert Eagle: the bunker's, and nobody else's.
  benelli: { at: [0, 0, 0, 0, 4], lifetime: 7200, restock: 600, usage: [], loaded: [3, 7] },
  deagle: { at: [0, 0, 0, 0, 4], lifetime: 7200, restock: 600, usage: [], loaded: [2, 7] },
  // ------------------------------------------------------------ what they fire: each on its gun's step and above, a little on the step below
  // (loose rounds turn up in handfuls; sealed boxes are the real find, and are where guns were kept)
  // 9 mm and .45: the pistols' and the submachine gun's. A handful in a house or a cabin as well.
  ammo_9mm: { at: [10, 9, 76, 0, 1], lifetime: 3600, restock: 120, usage: [...ARMY, 'Hunting', ...HOMES], favour: ROUNDS, qty: [0.25, 0.6], keep: SOON, on: { 3: IN_TOWN } },
  box_9mm: { at: [0, 3, 42, 1, 2], lifetime: 3600, restock: 180, usage: ARMY, favour: ARMOURY, keep: SOON, on: { 3: { usage: [...ARMY, 'Town'], ...IN_TOWN } } },
  ammo_45: { at: [5, 6, 26, 0, 0], lifetime: 3600, restock: 120, usage: [...ARMY, 'Hunting', ...HOMES], favour: ROUNDS, qty: [0.25, 0.6], keep: SOON, on: { 3: IN_TOWN } },
  box_45: { at: [0, 1, 10, 0, 0], lifetime: 3600, restock: 240, usage: ARMY, favour: ARMOURY, keep: SOON },
  // 7.62: the sniper rifle's. A hunter has some.
  ammo_762: { at: [2, 2, 15, 5, 2], lifetime: 3600, restock: 120, usage: [...ARMY, 'Hunting'], favour: ARMOURY, qty: [0.25, 0.6], keep: SOON },
  box_762: { at: [0, 1, 8, 6, 2], lifetime: 3600, restock: 180, usage: ARMY, favour: ARMOURY, keep: SOON },
  // 7.39 and 5.56: the rifles'. Light where the army and the police were below the gas, heavier from the gas up.
  ammo_739: { at: [0, 1, 12, 5, 3], lifetime: 3600, restock: 180, usage: ARMY, favour: ARMOURY, qty: [0.25, 0.6], keep: SOON },
  box_739: { at: [0, 0, 3, 3, 2], lifetime: 3600, restock: 240, usage: ARMY, favour: ARMOURY, keep: SOON },
  // (the AR-15's rounds by a rate: one police or army spot in sixteen in the village, one in twelve in Kamenka, most of
  // them at the police stations; a box in sixty and in forty. See `per`.)
  ammo_556: { at: [0, 0, 26, 4, 4], per: [0, 1 / 16, 1 / 12, 0, 0], lifetime: 3600, restock: 180, usage: ARMY, favour: ARMOURY, qty: [0.25, 0.6], keep: SOON },
  box_556: { at: [0, 0, 7, 2, 3], per: [0, 1 / 60, 1 / 40, 0, 0], lifetime: 3600, restock: 240, usage: ARMY, favour: ARMOURY, keep: SOON },
  // 12 gauge and .50: the bunker's guns'. A handful where the police and the army were, for whoever is going
  // down there ("you should be able to find high tier ammo in medium-high tier loot spots"); boxes from the gas up.
  ammo_12: { at: [0, 1, 6, 2, 7], lifetime: 3600, restock: 300, usage: ARMY, favour: ARMOURY, qty: [0.3, 0.7] },
  box_12: { at: [0, 0, 0, 1, 4], lifetime: 3600, restock: 420, usage: [] },
  ammo_50: { at: [0, 1, 6, 1, 6], lifetime: 3600, restock: 300, usage: ARMY, favour: ARMOURY, qty: [0.3, 0.7] },
  box_50: { at: [0, 0, 0, 0, 3], lifetime: 3600, restock: 420, usage: [] },
  // ------------------------------------------------------------ magazines: where the guns they fit are kept, about as many as there are guns
  mag_colt: { at: [0, 4, 19, 0, 0], lifetime: 7200, restock: 240, usage: [...ARMY, 'Town'], favour: ARMOURY, keep: SOON, on: { 3: IN_TOWN } },
  mag_m9: { at: [0, 3, 24, 0, 0], lifetime: 7200, restock: 240, usage: [...ARMY, 'Town'], favour: ARMOURY, keep: SOON, on: { 3: IN_TOWN } },
  mag_m9_ext: { at: [0, 2, 5, 0, 0], lifetime: 7200, restock: 1200, usage: ['Military'] },
  mag_mpa: { at: [0, 4, 37, 0, 2], lifetime: 7200, restock: 300, usage: [...ARMY, 'Town'], favour: ARMOURY, keep: SOON, on: { 2: { usage: ARMY }, 3: IN_TOWN } },
  mag_mp7: { at: [0, 0, 0, 4, 2], lifetime: 7200, restock: 300, usage: [...ARMY], favour: ARMOURY, keep: SOON },
  mag_scorpion: { at: [0, 0, 23, 3, 1], lifetime: 7200, restock: 300, usage: [...ARMY, 'Town'], favour: ARMOURY, keep: SOON, on: { 3: IN_TOWN } },
  mag_sniper: { at: [0, 0, 2, 4, 2], lifetime: 7200, restock: 300, usage: ARMY, keep: SOON, on: { 3: { restock: 1500 } } },
  // (in Kamenka one of each, and as long coming back as the rifle: a rifle that fires is put together there
  // from three finds, and it is a long evening's work)
  mag_ak: { at: [0, 0, 2, 4, 2], lifetime: 7200, restock: 300, usage: ARMY, keep: SOON, on: { 3: { restock: 2400 } } },
  mag_ar: { at: [0, 0, 2, 3, 3], lifetime: 7200, restock: 300, usage: ARMY, keep: SOON, on: { 3: { restock: 2700 } } },
  drum_ak: { at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1200, usage: [] },
  mag_ar_60: { at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1200, usage: [] },
  mag_deagle: { at: [0, 0, 0, 0, 4], lifetime: 7200, restock: 600, usage: [] },
  mag_deagle_ext: { at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1200, usage: [] },
  // ------------------------------------------------------------ what goes on a gun
  suppressor_9: { at: [0, 1, 10, 0, 0], lifetime: 7200, restock: 1800, usage: ARMY, favour: { Police: 3 } },
  red_dot: { at: [0, 1, 7, 3, 3], lifetime: 7200, restock: 1800, usage: ARMY },
  // (not in the police station alone: its few shelves are where the gas masks are kept)
  gun_light: { at: [0, 0, 10, 3, 3], lifetime: 3600, restock: 900, usage: ['Military', 'Industrial', 'Police'] },
  foregrip: { at: [0, 0, 2, 0, 2], lifetime: 7200, restock: 1200, usage: ARMY },
  pu_scope: { at: [0, 0, 2, 6, 3], lifetime: 7200, restock: 1800, usage: ARMY },
  rifle_wrap: { at: [0, 0, 5, 3, 1], lifetime: 7200, restock: 1500, usage: ARMY },
  suppressor_762: { at: [0, 0, 0, 3, 2], lifetime: 7200, restock: 1800, usage: [] },
  suppressor_739: { at: [0, 0, 0, 1, 1], lifetime: 7200, restock: 1800, usage: [] },
  elcan: { at: [0, 0, 0, 3, 2], lifetime: 7200, restock: 1800, usage: ARMY },
  mp7_suppressor: { at: [0, 0, 0, 3, 2], lifetime: 7200, restock: 1800, usage: ARMY },
  mp7_sight: { at: [0, 0, 0, 3, 2], lifetime: 7200, restock: 1800, usage: ARMY },
  suppressor_556: { at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1800, usage: [] },
  suppressor_12: { at: [0, 0, 0, 0, 3], lifetime: 7200, restock: 1200, usage: [] },
  // (what opens the bunker is kept under the gas: the one place is the way into the other)
  keycard: { at: [0, 0, 0, 2, 0], lifetime: 7200, restock: 600, usage: [] },
  // ------------------------------------------------------------ what you hit with: the outskirts'
  // ("t1 melee heavy". Past the outskirts the tools of a shed are still in sheds, a few: a shed with nothing in
  // it is a shed nobody opens twice. Nothing to hit with lies in a house, a shop or a barracks past the outskirts.)
  hatchet: { at: [14, 1, 7, 0, 0], lifetime: 3600, restock: 180, usage: [...SHEDS, 'Village'], favour: { Farm: 2, Hunting: 2 }, on: IN_SHEDS },
  machete: { at: [12, 0, 0, 0, 0], lifetime: 3600, restock: 180, usage: [...SHEDS, 'Village'], favour: { Farm: 2 } },
  crowbar: { at: [14, 1, 7, 0, 0], lifetime: 3600, restock: 180, usage: [...SHEDS, 'Village'], favour: { Industrial: 2 }, on: IN_SHEDS },
  bat: { at: [13, 0, 0, 0, 0], lifetime: 3600, restock: 180, usage: [...HOMES, 'Farm'] },
  // (a tool of yards and sheds: it lies on a floor, being as long as a rifle is)
  shovel: { at: [11, 1, 7, 0, 0], lifetime: 3600, restock: 180, usage: [...SHEDS, 'Village'], favour: { Farm: 2, Industrial: 2 }, on: IN_SHEDS },
  pitchfork: { at: [6, 1, 12, 0, 0], lifetime: 3600, restock: 180, usage: [...SHEDS, 'Village'], favour: { Farm: 3 }, on: IN_SHEDS },
  knife: { at: [18, 1, 10, 0, 0], lifetime: 3600, restock: 180, usage: [...HOMES, ...SHEDS], on: IN_SHEDS },
  // ------------------------------------------------------------ food and drink: the shop before anywhere, then kitchens
  sprats: { at: [8, 0, 32, 0, 0], lifetime: 2400, restock: 300, usage: ['Shop', ...HOMES], favour: LARDER },
  condensed: { at: [3, 1, 23, 1, 3], lifetime: 2400, restock: 300, usage: ['Shop', ...HOMES, 'Military'], favour: LARDER },
  beans: { at: [9, 0, 38, 0, 1], lifetime: 2400, restock: 300, usage: ['Shop', ...HOMES, 'Farm'], favour: LARDER },
  tomatoes: { at: [6, 0, 24, 0, 0], lifetime: 2400, restock: 300, usage: ['Shop', 'Village', 'Farm'], favour: LARDER },
  sardines: { at: [7, 0, 32, 0, 1], lifetime: 2400, restock: 300, usage: ['Shop', ...HOMES, 'Hunting'], favour: LARDER },
  apple: { at: [7, 0, 23, 0, 0], lifetime: 1200, restock: 300, usage: ['Shop', 'Village', 'Farm'], favour: LARDER },
  milk: { at: [3, 0, 20, 0, 0], lifetime: 1800, restock: 300, usage: ['Shop', ...HOMES], favour: LARDER },
  // (there was a third as much to drink on the map as to eat, and thirst runs as fast as hunger)
  water_jug: { at: [8, 0, 39, 1, 1], lifetime: 2400, restock: 300, usage: ['Shop', ...HOMES, 'Farm', 'Industrial'], favour: { Shop: 9 } },
  flask: { at: [4, 2, 22, 1, 3], lifetime: 2400, restock: 300, usage: ['Shop', 'Military', 'Hunting', 'Village', 'Farm'], favour: { Shop: 5 } },
  thermos: { at: [4, 2, 19, 1, 1], lifetime: 2400, restock: 300, usage: ['Shop', 'Military', 'Hunting', 'Village', 'Police', 'Industrial'], favour: { Shop: 2 } },
  // ------------------------------------------------------------ medical: the clinic and the hospital
  // (What stops bleeding is what a fight is lost for want of: a bandage is in houses, shops and barracks too.)
  // A clinic leans on bandages and stims, with a kit or two; the hospital is where the kits are, and stims by the shelf.
  bandage: { at: [16, 3, 66, 2, 3], lifetime: 2400, restock: 240, usage: ['Medic', 'Hospital', 'Shop', ...HOMES, 'Military', 'Police', 'Hunting', 'Farm'], favour: { Medic: 26, Hospital: 2, Shop: 1.5, Military: 2 } },
  stim: { at: [0, 3, 92, 3, 4], lifetime: 3000, restock: 360, usage: ['Medic', 'Hospital', 'Military', 'Police', ...HOMES], favour: { Medic: 16, Hospital: 6, Military: 3, Police: 2 } },
  // (the yellow one, for the breath: see items.ts. A soldier's thing as much as a nurse's.)
  stim_stamina: { at: [0, 3, 44, 1, 2], lifetime: 3000, restock: 360, usage: ['Medic', 'Hospital', 'Military', 'Police'], favour: { Medic: 10, Hospital: 5, Military: 4 } },
  // (the pink one, both at once: see items.ts. 2026-10-13: "the new hybrid stim will be in loot areas T4 and
  // higher", "medical and military": under the gas and down the bunker, where the army and its medics were, and on
  // no step below. Six in the whole world where there are eighty-odd of the white, and a quarter of an hour
  // coming back.)
  stim_combat: { at: [0, 0, 0, 3, 3], lifetime: 3000, restock: 900, usage: ['Military', 'Medic', 'Hospital'], favour: { Military: 4, Medic: 4, Hospital: 4 } },
  firstaid: { at: [0, 1, 72, 2, 2], lifetime: 3600, restock: 600, usage: ['Hospital', 'Medic', 'Military', 'Police'], favour: { Hospital: 14, Medic: 3 } },
  // (The pouch between a stim and the kit: see items.ts. A soldier's own, so it lies where soldiers and constables
  // were before it lies in a clinic. Its places are taken out of the bandages' and the kit's: three bandages on the
  // second step, three bandages and two kits on the third, a kit under the gas and one down the bunker. No more
  // lies on any step than lay there before. In Kamenka the police station and the army's posts are full of what
  // only they keep, and five pouches laid there left the pistols' rounds no shelf in them on half the throws of
  // the dice: there it lies in the hospital and the clinic before an army post, and in no police station.)
  aid_pouch: { at: [0, 1, 13, 1, 1], lifetime: 3600, restock: 480, usage: ['Military', 'Police', 'Medic', 'Hospital'], favour: { Military: 6, Police: 4 }, on: { 3: { usage: ['Hospital', 'Medic', 'Military'], favour: { Hospital: 3, Medic: 3, Military: 2 } } } },
  // What gives blood back (2026-10-13; src/sim/blood.ts): saline in a clinic and the hospital, and with the army's
  // medics; blood in the hospital before anywhere, a bag or two in a clinic's fridge, and where the best of
  // everything is. (Under the gas every place is spoken for: a stim and a dressing there have made way for them.)
  saline: { at: [0, 3, 32, 1, 2], lifetime: 3600, restock: 420, usage: ['Medic', 'Hospital', 'Military'], favour: { Medic: 10, Hospital: 5 } },
  blood_bag: { at: [0, 0, 29, 2, 3], lifetime: 3600, restock: 600, usage: ['Hospital', 'Medic', 'Military'], favour: { Hospital: 12, Medic: 4 } },
  // (what sets a broken leg and does nothing else: where there are ladders and lofts to fall off, too)
  splint: { at: [5, 1, 48, 1, 2], lifetime: 3600, restock: 420, usage: ['Medic', 'Hospital', 'Shop', ...HOMES, 'Farm', 'Hunting', 'Industrial', 'Police'], favour: { Medic: 6, Hospital: 4, Shop: 2 } },
  // ------------------------------------------------------------ what is worn and carried
  // (The steel pot: the army's old helmet, the weak one and the common one, as DayZ's plain ballistic helmet is the
  // one found at every checkpoint. It is the army's and not the police's, on the pistols' own step and a couple in
  // Kamenka; its places are five of the caps' in the village and the camp, and two of theirs in the town.)
  helmet_m1: { at: [0, 4, 6, 0, 0], lifetime: 3600, restock: 900, usage: ['Military'] },
  patrol_cap: { at: [0, 2, 6, 0, 0], lifetime: 3600, restock: 600, usage: ARMY },
  fishermans_hat: { at: [6, 2, 13, 0, 0], lifetime: 3600, restock: 600, usage: [...HOMES, 'Farm', 'Hunting'] },
  // (The Field Jacket and the Field Trousers have no rule: everybody is dressed in them from the start and only one
  // of each is worn, so a spare is room for nothing. They come off the dead. The places for clothes on the first
  // step are full as it is: two more kinds there, and the bags that are wanted went short.)
  garden_gloves: { at: [6, 0, 14, 0, 0], lifetime: 3600, restock: 600, usage: ['Village', 'Farm', 'Industrial'] },
  // (a workman's: sheds and yards before barracks)
  work_gloves: { at: [3, 2, 13, 0, 0], lifetime: 3600, restock: 900, usage: ['Industrial', 'Farm', 'Military'], favour: { Industrial: 2 } },
  rubber_boots: { at: [3, 1, 14, 0, 0], lifetime: 3600, restock: 900, usage: ['Industrial', 'Farm', 'Military', 'Police'], favour: { Industrial: 2 } },
  boonie_hat: { at: [0, 1, 5, 5, 4], lifetime: 3600, restock: 900, usage: ['Military'] },
  // (the heaviest helmet there is: the bunker's)
  helmet_k63: { at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1800, usage: [] },
  // (The mask is what lets anybody into the gas, so it is not kept IN the gas: it is a policeman's, in the
  // police station of the village and in Kamenka's, and these are what the whole map has to share, bar what one
  // of the army's cases or a supply drop turns up.)
  gasmask: { at: [0, 0, 5, 0, 0], lifetime: 3600, restock: 900, usage: ['Police'] },
  // (armour by weight: the rig in sheds and houses, the soft vest where the police and the army were, the
  // armoured vest in Kamenka and one that got as far as the village, the plate carrier under the gas, the heavy
  // armour only down the bunker)
  chest_rig: { at: [7, 0, 18, 0, 0], lifetime: 3600, restock: 600, usage: [...SHEDS, 'Town'] },
  soft_vest: { at: [0, 2, 17, 0, 0], lifetime: 3600, restock: 900, usage: ARMY, favour: { Police: 3 } },
  armor_vest: { at: [0, 1, 14, 1, 0], lifetime: 3600, restock: 1200, usage: ARMY, favour: { Military: 3 } },
  life_vest: { at: [0, 0, 0, 7, 4], lifetime: 3600, restock: 900, usage: [] },
  heavy_armor: { at: [0, 0, 0, 0, 3], lifetime: 7200, restock: 1800, usage: [] },
  // (three packs: the day pack from the first step, the camping pack from the village on, and the army's
  // rucksack, the biggest, from the fourth step up and never below it)
  sack_pack: { at: [8, 0, 16, 0, 0], lifetime: 3600, restock: 600, usage: [...SHEDS, 'Town', 'Shop'] },
  camping_pack: { at: [0, 0, 17, 0, 0], lifetime: 3600, restock: 900, usage: [...HOMES, 'Hunting', 'Shop'] },
  suitcase: { at: [0, 0, 0, 3, 3], lifetime: 3600, restock: 1200, usage: [] },
  // ------------------------------------------------------------ tools and odds and ends
  // (a lantern is a thing of sheds, yards and the shop's shelf: most of them out where anybody starts, because the night is everybody's)
  flashlight: { at: [22, 1, 29, 1, 2], lifetime: 3600, restock: 420, usage: [...SHEDS, 'Shop', 'Town'], favour: { Shop: 8, Industrial: 3, Farm: 2 } },
  binoculars: { at: [2, 0, 7, 1, 1], lifetime: 3600, restock: 1200, usage: ['Military', 'Hunting', 'Police'] },
  compass: { at: [4, 1, 10, 0, 0], lifetime: 3600, restock: 1200, usage: ['Military', 'Hunting', 'Village', 'Shop'], favour: { Shop: 3 } },
  cigarettes: { at: [4, 1, 25, 0, 1], lifetime: 2400, restock: 600, usage: [...HOMES, 'Military', 'Industrial', 'Shop'], favour: { Shop: 2 } },
  // (The frag grenade, 2026-10-13: where the stick grenade is and rarer, from the third step up and never below
  // it. One in Kamenka, two under the gas, two down the bunker, and half as long again coming back. Down the bunker
  // every place is spoken for: its two are two of the stick grenade's four, which are two now.)
  grenade: { at: [0, 2, 8, 5, 2], lifetime: 3600, restock: 1200, usage: ['Military'] },
  frag: { at: [0, 0, 2, 2, 2], lifetime: 3600, restock: 1800, usage: ['Military'] },
  stash_kit: { at: [3, 1, 4, 0, 0], lifetime: 7200, restock: 1800, usage: ['Farm', 'Industrial', 'Hunting'] },
  // (a field radio: good for one supply drop called down where it is used. One at the army's; the trader sells them dear.)
  radio: { at: [0, 1, 2, 0, 0], lifetime: 7200, restock: 2400, usage: ['Military'] },
  // fuel for the jeeps (src/sim/vehicles.ts): where there are sheds, yards and soldiers
  jerrycan: { at: [6, 6, 15, 1, 1], lifetime: 3600, restock: 600, usage: ['Farm', 'Industrial', 'Military'], favour: { Industrial: 2 } },
  // (two more things to keep things in, beside the stash case: a black sack, in every shed, and a suitcase, in houses)
  black_bag: { at: [5, 0, 15, 0, 0], lifetime: 7200, restock: 1200, usage: [...SHEDS, 'Town'] },
  old_suitcase: { at: [3, 0, 13, 0, 0], lifetime: 7200, restock: 1800, usage: HOMES },
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
 * (2026-10-13: and last of these, the travelling suitcase and the stash case. Each lies only on a floor, and the
 * houses of the outskirts have seventeen floors between them: on one throw of the dice in twenty, small things had
 * taken them and two of the three suitcases had nowhere to lie.)
 */
// (the weapons pass's guns first of the long things, so that they have floors: the gas and the bunker were full,
// and stocked in the turn of the list they found none, the owner: "ensure that the new weapons can spawn at T3+")
const FIRST = [
  'gasmask', 'barrett', 'sniper50', 'vssk', 'aks74u', 'mp7a1', 'scorpion', 'dual_smg', 'dual_mac10', 'benelli', 'mosin', 'ak', 'ar15', 'suppressor_12', 'suitcase', 'heavy_armor', 'life_vest', 'armor_vest', 'bat', 'crowbar', 'shovel', 'machete', 'hatchet',
  'mpa', 'colt', 'm9', 'mag_mpa', 'mag_colt', 'mag_m9', 'firstaid', 'aid_pouch', 'blood_bag', 'stim', 'stim_stamina', 'stim_combat', 'saline', 'bandage', 'old_suitcase', 'stash_kit',
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

/**
 * Places that are stocked APART from the rest of the map, by the name their loot points carry as their building
 * (2026-10-13: the fort on the mountain, seventy places; and the wreck in the cleft under the bridge, five, which
 * being floor took three of the gas's five AKs). Every step of the map is stocked to counts (`at`), so a
 * new place on a step took its things out of the places that were there: with the fort part of the third step
 * Kamenka had two armoured vests where it had five, and the Chemical Works shared its rifles with the fort's
 * vaults. A place apart is stocked ON TOP of the map, which keeps all of its own: of each sort, as many as its
 * places would have drawn had they been part of their step (by the same kinds of place and the same leanings),
 * never more of a sort than the whole step has, and never more things than `APART_FILL` of its places.
 */
// ('hamlet': the ruined houses along the track to the fort, 2026-10-13: named apart from the fort so that the map
// marks the fort as wide as the fort)
// ('cellar': every basement's places, 2026-10-14: "basements are missing loot". Part of their steps they shared those
// steps' counts with every house, and stood empty.)
// ('kalat', the ruined town in the desert, and the new towns of the map three times over, 2026-10-16, each by its
// name: their places are `ruins_<piece>`'s and `<town>_<n>`'s. Of their steps, they took those steps' things from the
// old map: Kalat the gas works' share of the fourth step's, the towns on the third Kamenka's. See OWN: stocked as
// their steps are.)
// ('pass', the canyon pass's caves and the cache on its floor, `cave_<where>`: part of the fifth step they took the
// bunker's own things; apart, stocked as the fort is, as the owner's "best loot in the center of the bottom of the canyon")
export const APART = new Set(['castle', 'hamlet', 'wreck', 'cellar', 'kalat', 'pass', ...TOWNS.map((t) => t.name.toLowerCase())]);
/** the place apart a loot point is of, by the name of its building (Kalat's pieces `ruins_<piece>`, a new town's plots `<town>_<n>`, the pass's caves `cave_<where>`), or null: the map's own */
export function apartOf(building: string): string | null {
  if (APART.has(building)) return building;
  if (building.startsWith('ruins_')) return 'kalat';
  if (building.startsWith('cave_')) return 'pass';
  const town = building.replace(/_\d+$/, '');
  return town !== building && APART.has(town) ? town : null;
}
/** the most of a place apart's free places that are ever filled: a room with something on every surface is a shop */
const APART_FILL = 0.85;
/** and how many times its fair share it is stocked to, up to that: a place apart is somewhere worth the going to */
const APART_RICH = 1.5;
/**
 * A place apart that is not stocked as the fort is: how many times its fair share, and how it leans (unsaid: APART_RICH
 * and APART_LEAN, the fort's garrison store). The cellars are houses' stores, of every kind a house keeps, and well
 * stocked, a reward for going down: their places are few against the map's, and at the fort's share they held little.
 */
// (the new places of the map three times over are stocked as their steps are, no richer: they are new ground, not a reward)
const OWN: Record<string, { rich: number; lean: Record<string, number> }> = {
  cellar: { rich: 3, lean: {} },
  ...Object.fromEntries(['kalat', ...TOWNS.map((t) => t.name.toLowerCase())].map((k) => [k, { rich: 1, lean: {} }])),
};
/**
 * How a place apart's share leans, sort by sort (times its share; a sort not named, 1). 2026-10-13, after the owner
 * had played the fort: "the loot in the castle should be a bit better i think". It was stocked exactly as its step
 * of the map is, and so it held what a step holds: three loose submachine guns and their magazines, cigarettes and
 * hats, and not one magazine for the rifles on its own racks. A garrison's store leans to what a rifle needs and
 * what a wound needs, and has less of what lies in any village. (Still never more of a sort than the whole step
 * has, and nothing that is the bunker's alone: the drum, the long magazine, the K6-3.)
 */
const APART_LEAN: Record<string, number> = {
  ak: 3, ar15: 3, mosin: 2.5,
  mag_ak: 6, mag_ar: 6, mag_sniper: 5, box_762: 2.5, box_739: 3, box_556: 4, ammo_762: 1.5, ammo_739: 1.5, ammo_556: 1.5, ammo_50: 3,
  pu_scope: 2.5, red_dot: 4, gun_light: 3, suppressor_762: 4, suppressor_739: 3, binoculars: 2,
  armor_vest: 2.5, grenade: 2, stim_combat: 2.5, blood_bag: 2.5, saline: 4, firstaid: 2, aid_pouch: 2.5,
  mpa: 0.4, mag_mpa: 0.5, ammo_9mm: 0.4, box_9mm: 0.6, m9: 0.5, mag_m9: 0.5, cigarettes: 0.3, boonie_hat: 0.4, jerrycan: 0.5, bandage: 0.6, soft_vest: 0.6,
};
/** what a named place apart never has less of on its fourth step, whatever its shares come to (where it has a spot of the kind): a magazine for each rifle of its racks, and a dressing station's own */
const APART_LEAST: Record<string, Record<string, number>> = {
  castle: { mag_ak: 2, mag_ar: 2, mag_sniper: 1, pu_scope: 1, suppressor_762: 1, grenade: 2, armor_vest: 1, stim_combat: 2, blood_bag: 2, saline: 1, firstaid: 2 },
};
/**
 * The kind of spot a sort lies at in a place apart, where it has no kind of its own (under the gas such a thing
 * lies anywhere, and a place apart is sorted on every step: so it lay nowhere in one).
 */
export const APART_KIND: Record<string, Usage[]> = { suppressor_762: ['Military'], suppressor_739: ['Military'] };

export class Economy {
  loot = new Map<string, WorldLoot>();
  private pointBusy = new Set<number>();
  lastRestock: Record<string, number> = {};
  private rng = new RNG(20260930);
  time = 0;

  /** which step of the map each loot point is on (see src/sim/tiers.ts): each step is stocked to counts of its own */
  private tier: Tier[];
  /** the place apart each loot point belongs to, if it belongs to one (see APART): null for the map's own */
  private apart: (string | null)[];
  /** the places apart there are, and how many of each sort each is stocked to on each step (`place|sort@step`) */
  private places: string[];
  private wants = new Map<string, number>();

  constructor(
    readonly points: LootPoint[],
    private events: EconomyEvents,
    /** can this item type physically lie at this loot point? */
    private fits: (id: string, p: LootPoint) => boolean = fitsPoint,
  ) {
    this.tier = points.map((p) => p.tier ?? (p.usage.includes('Bunker') ? 5 : p.usage.includes('Gas') ? 4 : p.usage.includes('East') ? 3 : 1));
    this.apart = points.map((p) => apartOf(p.building));
    // (a sort kept by a rate: its count on each step from the spots there it can lie at, see TypeRule.per)
    for (const [id, rule] of Object.entries(TYPES)) {
      if (!rule.per) continue;
      const n = STEPS.map((t) => {
        let spots = 0;
        this.points.forEach((p, i) => {
          if (this.tier[i] === t && this.apart[i] === null && !p.arms && !p.keeps && this.liesAt(id, rule, i, t)) spots++;
        });
        return Math.max(rule.at[t - 1], Math.round(rule.per![t - 1] * spots));
      });
      this.counts.set(id, n);
    }
    this.places = [...new Set(this.apart.filter((a): a is string => a !== null))];
    for (const place of this.places) for (const t of STEPS) this.share(place, t);
  }

  private counts = new Map<string, number[]>();
  /** how many of a sort are kept on a step: its `at`, or what its rate comes to on this map (see TypeRule.per) */
  kept(id: string, t: Tier): number {
    return this.counts.get(id)?.[t - 1] ?? TYPES[id].at[t - 1];
  }

  /** how strongly a spot draws a sort on a step: as `pickPoint` weighs it */
  private pull(rule: TypeRule, i: number, where: Tier): number {
    const favour = where < UNSORTED || this.apart[i] !== null ? (rule.on?.[where]?.favour ?? rule.favour) : undefined;
    let w = 1;
    if (favour) for (const u of this.points[i].usage) w = Math.max(w, favour[u] ?? 1);
    return w;
  }

  /** What a place apart is stocked to on one step: see APART. Whole numbers, the same every time (the biggest remainders are rounded up). */
  private share(place: string, t: Tier) {
    const free = (pool: string | null) => this.points.map((_, i) => i).filter((i) => this.apart[i] === pool && this.tier[i] === t && !this.points[i].arms && !this.points[i].keeps);
    const here = free(place), there = free(null);
    if (!here.length) return;
    const fair: [string, number][] = [];
    for (const [id, rule] of Object.entries(TYPES)) {
      const at = this.kept(id, t);
      if (!at) continue;
      const sum = (list: number[]) => list.reduce((a, i) => a + (this.liesAt(id, rule, i, t) ? this.pull(rule, i, t) : 0), 0);
      const mine = sum(here), theirs = sum(there);
      if (mine > 0) fair.push([id, Math.min(at, (theirs > 0 ? (at * mine) / theirs : at) * (OWN[place]?.rich ?? APART_RICH) * ((OWN[place]?.lean ?? APART_LEAN)[id] ?? 1))]);
    }
    // (What it is never without is taken out of the room there is first: `sure` of each sort. What each sort's share
    // comes to over that is its `spare`, and the spares fill what room is left, cut down alike if there is not
    // enough of it.)
    const least = t === 4 ? APART_LEAST[place] ?? {} : {};
    const base = fair.map(([id, e]) => {
      const sure = Math.min(least[id] ?? 0, this.kept(id, t));
      return { id, sure, spare: Math.max(0, e - sure) };
    });
    const kept = base.reduce((a, s) => a + s.sure, 0), all = base.reduce((a, s) => a + s.spare, 0), most = Math.max(0, here.length * APART_FILL - kept), k = all > most ? most / all : 1;
    let left = Math.round(all * k);
    const whole = base.map((s) => ({ id: s.id, sure: s.sure, n: Math.floor(s.spare * k), rest: s.spare * k - Math.floor(s.spare * k) }));
    left -= whole.reduce((a, w) => a + w.n, 0);
    for (const w of [...whole].sort((a, b) => b.rest - a.rest || (a.id < b.id ? -1 : 1))) {
      if (left <= 0) break;
      w.n++;
      left--;
    }
    for (const w of whole) if (w.sure + w.n > 0) this.wants.set(`${place}|${w.id}@${t}`, w.sure + w.n);
  }

  /** how many of a sort a place apart is stocked to on a step */
  wanted(place: string, id: string, t: Tier): number {
    return this.wants.get(`${place}|${id}@${t}`) ?? 0;
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
  held(id: string, where: Tier | boolean | 'bunker' | 'east', place: string | null = null): number {
    if (where === false) return this.held(id, 1, place) + this.held(id, 2, place);
    const t: Tier = where === true ? 4 : where === 'bunker' ? 5 : where === 'east' ? 3 : where;
    let n = 0;
    // (the map's own, unless a place apart is named: what lies in one is not counted to the map, nor the other way)
    for (const l of this.loot.values()) if (l.item.id === id && l.point >= 0 && this.tier[l.point] === t && this.apart[l.point] === place) n++;
    return n;
  }

  /** can a sort lie at this spot on this step: is the spot of a kind it is kept in, and is there room on it */
  private liesAt(id: string, rule: TypeRule, i: number, where: Tier): boolean {
    const p = this.points[i];
    // (A place apart is sorted on every step: its spots were each said to be of a kind on purpose, an armoury's and
    // a dressing station's, where under the gas and down the bunker anything lies anywhere. A sort with no kind of
    // its own has one there: see APART_KIND.)
    const kinds = (this.apart[i] !== null ? APART_KIND[id] : undefined) ?? rule.on?.[where]?.usage ?? rule.usage;
    if ((where < UNSORTED || this.apart[i] !== null) && !p.usage.some((u) => kinds.includes(u))) return false;
    // a rifle never spawns on a narrow shelf, a jerrycan never on a barrel
    return this.fits(id, p);
  }

  private pickPoint(id: string, rule: TypeRule, where: Tier, place: string | null = null): number {
    // (a place apart is sorted on every step: see `liesAt`)
    const sorted = where < UNSORTED || place !== null, favour = rule.on?.[where]?.favour ?? rule.favour;
    let candidates: number[] = [];
    const weights: number[] = [];
    let total = 0;
    /** spots it could lie at but for having lain there last: where it goes when there is nowhere else at all */
    const again: number[] = [];
    this.points.forEach((p, i) => {
      // armed points are stocked on their own (see arm)
      if (p.arms || p.keeps || this.pointBusy.has(i) || this.tier[i] !== where || this.apart[i] !== place) return;
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
  private spawnType(id: string, at = -1, where: Tier = 1, armed = at >= 0, place: string | null = null): boolean {
    const rule = TYPES[id];
    const def = ITEMS[id];
    const pi = at >= 0 ? at : this.pickPoint(id, rule, where, place);
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
  /**
   * A rack of a place apart takes a long gun laid along it, if its top is long enough by the gun's own measure.
   * (Everywhere else a long thing lies on a floor and nowhere else: see fitsPoint. An armoury whose racks could
   * hold nothing longer than a pistol held six pistols.)
   */
  private onRack(id: string, i: number): boolean {
    const p = this.points[i], size = ITEM_SIZES[id], s = p.surf;
    if (this.apart[i] === null || !p.arms || !s || !size || size[1] > s.clear) return false;
    const long = Math.max(size[0], size[2]) / 2, thin = Math.min(size[0], size[2]) / 2;
    return long <= Math.max(s.hx, s.hz) + 0.03 && thin <= Math.min(s.hx, s.hz) + 0.03;
  }

  private arm(now = false, which: 'all' | 'map' | 'apart' = 'all') {
    this.points.forEach((p, i) => {
      if (!p.arms && !p.keeps) return;
      if (which !== 'all' && (this.apart[i] !== null) !== (which === 'apart')) return;
      if (this.pointBusy.has(i)) {
        this.bare.delete(i);
        return;
      }
      if (!now) {
        if (!this.bare.has(i)) this.bare.set(i, this.time);
        if (this.time - this.bare.get(i)! < (p.keeps ? KEEPS_RESTOCK : this.apart[i] !== null ? APART_ARMS_RESTOCK : ARMS_RESTOCK)) return;
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
      const table = this.tier[i] <= 1 ? ARMS.filter(([id]) => !ITEMS[id].weapon) : p.arms === 'guns' ? (this.apart[i] !== null && this.tier[i] >= 4 ? ARMS_FORT : this.tier[i] >= 3 ? ARMS_TOWN : ARMS.filter(([id]) => ITEMS[id].weapon)) : ARMS;
      // (Each sort is tried once at most, by its weight. Thrown for afresh every time, the one sort that would not
      // lie there could come up six times running, and the place was left bare: one rack in fifty.)
      const left = [...table];
      while (left.length) {
        const total = left.reduce((s, [, w]) => s + w, 0);
        let r = this.rng.next() * total, k = 0;
        for (; k < left.length - 1; k++) {
          r -= left[k][1];
          if (r <= 0) break;
        }
        const [id] = left.splice(k, 1)[0];
        if ((this.fits(id, p) || this.onRack(id, i)) && this.spawnType(id, i)) break;
      }
      this.bare.delete(i);
    });
  }

  /** Initial fill up to nominal. */
  /**
   * One handful of every calibre where the police and the army were, in the village and in Kamenka, put down before
   * anything else ("i am only finding low tier ammo in the big police when i should find all ammo there", "the small
   * police station has low caliber weapons and all ammos"). Left to the order things were laid in, whether a place
   * was still free there for the last calibres hung on the dice: on some stockings Kamenka's police had no 9 mm.
   */
  private calibres() {
    for (const t of [2, 3] as Tier[]) for (const [id, rule] of Object.entries(TYPES)) {
      if (!id.startsWith('ammo_') || !this.kept(id, t)) continue;
      const free: number[] = [];
      this.points.forEach((p, i) => {
        if (this.tier[i] === t && this.apart[i] === null && !p.arms && !p.keeps && !this.pointBusy.has(i) && (p.usage.includes('Police') || p.usage.includes('Military')) && this.liesAt(id, rule, i, t)) free.push(i);
      });
      if (free.length) this.spawnType(id, free[this.rng.int(0, free.length - 1)], t, false);
    }
  }

  populate() {
    // (The map's own first, all of it, and only then the places apart: so that what a place apart has, or whether
    // there is one at all, never changes a throw of the dice for the map. Stocked in one pass, a rack more in the
    // fort gave Kamenka's clinic three bandages where it had had five.)
    this.arm(true, 'map');
    this.calibres();
    // (what the whole map hangs on is put down first, while its few places are still free)
    for (const id of FIRST) for (const t of STEPS) while (this.held(id, t) < this.kept(id, t) && this.spawnType(id, -1, t));
    // interleave types so scarce ones still find free points
    const ids = Object.keys(TYPES);
    let progress = true;
    while (progress) {
      progress = false;
      for (const id of ids) for (const t of STEPS) if (this.held(id, t) < this.kept(id, t) && this.spawnType(id, -1, t)) progress = true;
    }
    // (and each place apart, to its own counts, out of its own places)
    this.arm(true, 'apart');
    for (const place of this.places) {
      progress = true;
      while (progress) {
        progress = false;
        for (const id of ids) for (const t of STEPS) if (this.held(id, t, place) < this.wanted(place, id, t) && this.spawnType(id, -1, t, false, place)) progress = true;
      }
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
      // (a dog tag on the ground is gone ten minutes on, near anybody or not: see TAG_GROUND)
      if (l.item.id === 'dogtag') {
        if (this.time - l.spawnedAt > TAG_GROUND) this.take(l.uid, false);
        continue;
      }
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
        const want = this.kept(id, t);
        if (!want) continue;
        // (from Kamenka up every one that is gone is put back, and soon; below it, once a share of them is gone)
        const every = rule.on?.[t]?.restock;
        if (t >= 3) this.restock(id, t, want, want, every ?? Math.min(rule.restock, GAS_RESTOCK));
        else this.restock(id, t, want, Math.max(1, Math.ceil(want * (rule.keep ?? 0.6))), every ?? rule.restock);
      }
      // (a place apart: every one that is gone is put back, as from Kamenka up)
      for (const place of this.places) for (const t of STEPS) {
        const want = this.wanted(place, id, t);
        if (want) this.restock(id, t, want, want, rule.on?.[t]?.restock ?? Math.min(rule.restock, GAS_RESTOCK), place);
      }
    }
  }

  /** Puts a sort back up to `want` on a step where fewer than `least` of it are left there, no oftener than `every` seconds. */
  private restock(id: string, where: Tier, want: number, least: number, every: number, place: string | null = null) {
    const n = this.held(id, where, place);
    const key = place ? `${place}|${id}@${where}` : `${id}@${where}`;
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
      if (!this.spawnType(id, -1, where, false, place)) break;
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
