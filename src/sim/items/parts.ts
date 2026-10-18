// Magazines, and what is fitted to a gun. Each item says everything about itself: what it is, where and how much of it is found (`loot`, on
// DayZ's Central Economy: see rules.ts) and what the trader gives for it. Adding a thing is one entry here.

import type { ItemDef } from '../items';
import { ARMY, ARMOURY, SOON, IN_TOWN } from './rules';

export const PART_ITEMS: ItemDef[] = [
  // ---------------------------------------------------------------- magazines
  // A thing of its own: found with a gun in it or lying by itself, carried, filled a round at a time and put into
  // the gun it fits. Each is its gun's own magazine, as its gun's model draws it; the long ones are the same drawn
  // a little longer. What it weighs is itself: the rounds in it are weighed with it (see itemWeight).
  {
    id: 'mag_sniper', name: 'Sniper Rifle Magazine', model: 'sniper', nodeRe: '^mag', w: 1, h: 1, weight: 0.12, category: 'magazine',
    desc: 'The five-round box magazine of the sniper rifle.',
    mag: { ammo: 'ammo_762', capacity: 5 }, attach: { fits: ['mosin'], slot: 'magazine' },
    loot: { pair: 'Mag_CMAG_10Rnd', at: [0, 0, 2, 4, 2], restock: 300, usage: ARMY, keep: SOON, on: { 3: { restock: 1500 } }, lean: 5 },
    worth: 8, sells: 3,
  },
  {
    id: 'mag_ak', name: 'AK Magazine', model: 'ak', nodeRe: '^mag', w: 1, h: 3, weight: 0.33, category: 'magazine',
    desc: 'Thirty rounds of 7.62x39 for the AK.',
    mag: { ammo: 'ammo_739', capacity: 30 }, attach: { fits: ['ak', 'aks74u'], slot: 'magazine' },
    // (in Kamenka one of each, and as long coming back as the rifle: a rifle that fires is put together there
    // from three finds, and it is a long evening's work)
    loot: { pair: 'Mag_AKM_30Rnd', at: [0, 0, 2, 4, 2], restock: 300, usage: ARMY, keep: SOON, on: { 3: { restock: 2400 } }, lean: 6 },
    worth: 10,
  },
  {
    id: 'drum_ak', name: 'AK Drum Magazine', model: 'ak_drum', w: 2, h: 3, weight: 0.9, category: 'magazine',
    desc: 'A drum of seventy-five rounds for the AK, off a light machine gun. Two and a half magazines without a change, and a rifle that is heavier and slower to bring up for it.',
    mag: { ammo: 'ammo_739', capacity: 75 }, attach: { fits: ['ak'], slot: 'magazine', ergo: -12 },
    loot: { pair: 'Mag_AKM_Drum75Rnd', at: [0, 0, 0, 0, 2], restock: 1200 },
    worth: 30,
  },
  {
    id: 'mag_ar', name: 'AR-15 Magazine', model: 'ar15', nodeRe: '^mag', w: 1, h: 3, weight: 0.13, category: 'magazine',
    desc: 'Thirty rounds of 5.56 for the AR-15.',
    mag: { ammo: 'ammo_556', capacity: 30 }, attach: { fits: ['ar15'], slot: 'magazine' },
    loot: { pair: 'Mag_STANAG_30Rnd', at: [0, 0, 2, 3, 3], restock: 300, usage: ARMY, keep: SOON, on: { 3: { restock: 2700 } }, lean: 6 },
    worth: 10,
  },
  {
    id: 'mag_ar_60', name: 'AR-15 60-Round Magazine', model: 'ar_mag_60', w: 2, h: 3, weight: 0.3, category: 'magazine',
    desc: 'Sixty rounds of 5.56 in a magazine four rows thick: two magazines without a change, and a longer one to swing.',
    mag: { ammo: 'ammo_556', capacity: 60 }, attach: { fits: ['ar15'], slot: 'magazine', ergo: -7 },
    loot: { pair: 'Mag_STANAG_60Rnd', at: [0, 0, 0, 0, 2], restock: 1200 },
    worth: 24,
  },
  {
    id: 'mag_mpa', name: 'MPA30 Magazine', model: 'smg', nodeRe: '^mag', w: 1, h: 2, weight: 0.22, category: 'magazine',
    desc: 'Thirty rounds of 9 mm for the MPA30.',
    mag: { ammo: 'ammo_9mm', capacity: 30 }, attach: { fits: ['mpa'], slot: 'magazine' },
    loot: { pair: 'Mag_MP5_30Rnd', at: [0, 4, 37, 0, 2], restock: 300, usage: [...ARMY, 'Town'], favour: ARMOURY, keep: SOON, on: { 2: { usage: ARMY }, 3: IN_TOWN }, lean: 0.5 },
    worth: 8,
  },
  {
    id: 'mag_scorpion', name: 'Scorpion Magazine', model: 'scorpion', nodeRe: '^mag', w: 1, h: 2, weight: 0.2, category: 'magazine',
    desc: 'Thirty rounds of 9 mm for the CZ Scorpion EVO.',
    mag: { ammo: 'ammo_9mm', capacity: 30 }, attach: { fits: ['scorpion'], slot: 'magazine' },
    loot: { pair: 'Mag_CZ61_20Rnd', at: [0, 0, 23, 3, 1], restock: 300, usage: [...ARMY, 'Town'], favour: ARMOURY, keep: SOON, on: { 3: IN_TOWN } },
  },
  {
    id: 'mag_sniper50', name: '.50 Sniper Magazine', model: 'sniper50', nodeRe: '^mag', w: 1, h: 2, weight: 0.6, category: 'magazine',
    desc: 'Five rounds of .50 BMG for the .50 sniper rifle.',
    mag: { ammo: 'ammo_50bmg', capacity: 5 }, attach: { fits: ['sniper50'], slot: 'magazine' },
    loot: { pair: 'Mag_SV98_10Rnd', at: [0, 0, 0, 1, 2], restock: 900 },
  },
  {
    id: 'mag_barrett', name: 'Barrett Magazine', model: 'barrett', nodeRe: '^mag', w: 1, h: 2, weight: 1.2, category: 'magazine',
    desc: 'Ten rounds of .50 BMG for the Barrett M82.',
    mag: { ammo: 'ammo_50bmg', capacity: 10 }, attach: { fits: ['barrett'], slot: 'magazine' },
    loot: { pair: 'Mag_SVD_10Rnd', at: [0, 0, 0, 1, 1], restock: 1200 },
  },
  {
    id: 'mag_vssk', name: 'VSSK Magazine', model: 'vssk', nodeRe: '^mag', w: 1, h: 2, weight: 0.5, category: 'magazine',
    desc: 'Five rounds of 12.7x55 for the VSSK Vykhlop.',
    mag: { ammo: 'ammo_127x55', capacity: 5 }, attach: { fits: ['vssk'], slot: 'magazine' },
    loot: { pair: 'Mag_VSS_10Rnd', at: [0, 0, 0, 1, 2], restock: 900 },
  },
  {
    id: 'mag_dual_smg', name: 'SMG Magazine Pair', model: 'dualsmg', nodeRe: '^mag', w: 1, h: 3, weight: 0.5, category: 'magazine',
    desc: 'Two thirty-round magazines taped together, one for each of the Dual SMGs.',
    mag: { ammo: 'ammo_9mm', capacity: 60 }, attach: { fits: ['dual_smg'], slot: 'magazine' },
    loot: { pair: 'Mag_PP19_64Rnd', at: [0, 0, 9, 2, 0], restock: 300, usage: [...ARMY, 'Town'], favour: ARMOURY, keep: SOON },
  },
  {
    id: 'mag_dual_mac10', name: 'MAC-10 Magazine Pair', model: 'dualmac', nodeRe: '^mag', w: 1, h: 2, weight: 0.6, category: 'magazine',
    desc: 'Two thirty-round .45 magazines taped together, one for each of the Dual MAC-10s.',
    mag: { ammo: 'ammo_45', capacity: 60 }, attach: { fits: ['dual_mac10'], slot: 'magazine' },
    loot: { pair: 'Mag_UMP_25Rnd', at: [0, 0, 7, 2, 0], restock: 300, usage: [...ARMY, 'Town'], favour: ARMOURY, keep: SOON },
  },
  {
    id: 'mag_mp7', name: 'MP7 Magazine', model: 'mp7a1', nodeRe: '^mag', w: 1, h: 2, weight: 0.25, category: 'magazine',
    desc: 'Forty rounds for the MP7A1.',
    mag: { ammo: 'ammo_9mm', capacity: 40 }, attach: { fits: ['mp7a1'], slot: 'magazine' },
    loot: { pair: 'Mag_Vikhr_30Rnd', at: [0, 0, 0, 4, 2], restock: 300, usage: [...ARMY], favour: ARMOURY, keep: SOON },
  },
  {
    id: 'mag_colt', name: 'Colt 1911 Magazine', model: 'colt_1911', nodeRe: '^mag', w: 1, h: 1, weight: 0.07, category: 'magazine',
    desc: 'Seven rounds of .45 for the Colt 1911.',
    mag: { ammo: 'ammo_45', capacity: 7 }, attach: { fits: ['colt'], slot: 'magazine' },
    loot: { pair: 'Mag_1911_7Rnd', at: [0, 4, 19, 0, 0], restock: 240, usage: [...ARMY, 'Town'], favour: ARMOURY, keep: SOON, on: { 3: IN_TOWN } },
    worth: 5, sells: 3,
  },
  {
    id: 'mag_m9', name: 'M9 Magazine', model: 'm9', nodeRe: '^mag', w: 1, h: 1, weight: 0.11, category: 'magazine',
    desc: 'Fifteen rounds of 9 mm for the M9.',
    mag: { ammo: 'ammo_9mm', capacity: 15 }, attach: { fits: ['m9'], slot: 'magazine' },
    loot: { pair: 'Mag_CZ75_15Rnd', at: [0, 3, 24, 0, 0], restock: 240, usage: [...ARMY, 'Town'], favour: ARMOURY, keep: SOON, on: { 3: IN_TOWN }, lean: 0.5 },
    worth: 5, sells: 3,
  },
  {
    id: 'mag_m9_ext', name: 'M9 Extended Magazine', model: 'm9', nodeRe: '^mag', w: 1, h: 2, weight: 0.16, category: 'magazine', scale: 1.15,
    desc: 'Twenty rounds for the M9: five more shots before you change it.',
    mag: { ammo: 'ammo_9mm', capacity: 20 }, attach: { fits: ['m9'], slot: 'magazine', ergo: -4 },
    loot: { pair: 'Mag_FNX45_15Rnd', at: [0, 2, 5, 0, 0], restock: 1200, usage: ['Military'] },
    worth: 12,
  },
  {
    id: 'mag_deagle', name: 'Desert Eagle Magazine', model: 'desert_eagle', nodeRe: '^mag', w: 1, h: 1, weight: 0.15, category: 'magazine',
    desc: 'Seven rounds of .50 for the Desert Eagle.',
    mag: { ammo: 'ammo_50', capacity: 7 }, attach: { fits: ['deagle'], slot: 'magazine' },
    loot: { pair: 'Mag_Deagle_9rnd', at: [0, 0, 0, 0, 4], restock: 600 },
    worth: 9,
  },
  {
    id: 'mag_deagle_ext', name: 'Desert Eagle Extended Magazine', model: 'desert_eagle', nodeRe: '^mag', w: 1, h: 2, weight: 0.2, category: 'magazine', scale: 1.15,
    desc: 'Ten rounds for the Desert Eagle: three more shots before you change it.',
    mag: { ammo: 'ammo_50', capacity: 10 }, attach: { fits: ['deagle'], slot: 'magazine', ergo: -4 },
    loot: { pair: 'Mag_Deagle_9rnd', at: [0, 0, 0, 0, 2], restock: 1200 },
    worth: 14,
  },
  // ---------------------------------------------------------------- attachments
  {
    id: 'pu_scope', name: 'Rifle Scope 3.5x', model: 'sniper', nodeRe: '^(scope|glass)', w: 2, h: 1, weight: 0.27, category: 'attachment',
    desc: 'A 3.5x telescopic sight for the sniper rifle. What makes the rifle a sniper, and a little slower to bring up.',
    attach: { fits: ['mosin'], slot: 'optic', ergo: -7 },
    loot: { pair: 'PUScopeOptic', at: [0, 0, 2, 6, 3], restock: 1800, usage: ARMY, lean: 2.5 },
    worth: 30,
  },
  // The .50s' and the VSSK's scopes, parted off them and found as any sight is (the owner, 2026-10-18: "the sniper scope
  // for vssk can be exclusive but the sniper for .50bmg should go on some other applicable rifles if any, and we should
  // make sure they drop as loot"). Off, a .50 is aimed along plain sights (see PLAIN_SIGHTS in src/game/weapons.ts); the VSSK has none.
  {
    id: 'scope_50', name: 'Long-Range Scope', model: 'sniper50', nodeRe: '^scope', w: 3, h: 1, weight: 0.9, category: 'attachment',
    desc: "The .50 sniper rifle's scope: it turns from four to twelve times on the mouse wheel, with mil-dots on its cross and a laser rangefinder that reads the range to whatever is under it.",
    attach: { fits: ['sniper50'], slot: 'optic', ergo: -10 },
    loot: { pair: 'HuntingOptic', at: [0, 0, 0, 0, 1], restock: 1800, usage: ARMY },
    worth: 45,
  },
  {
    id: 'scope_barrett', name: 'NightForce Scope', model: 'barrett', nodeRe: '^scope', w: 3, h: 1, weight: 0.9, category: 'attachment',
    desc: "The Barrett's scope: four to twelve times on the mouse wheel, mil-dots on its cross, and a laser rangefinder that reads the range to whatever is under it.",
    attach: { fits: ['barrett'], slot: 'optic', ergo: -10 },
    loot: { pair: 'HuntingOptic', at: [0, 0, 0, 1, 0], restock: 1800, usage: ARMY },
    worth: 50,
  },
  {
    id: 'scope_vssk', name: 'PSO Scope', model: 'vssk', nodeRe: '^scope', w: 2, h: 1, weight: 0.6, category: 'attachment',
    desc: "The VSSK's own scope, and no other rifle takes it: two to six times on the mouse wheel, with the chevrons and range lines of a PSO.",
    attach: { fits: ['vssk'], slot: 'optic', ergo: -7 },
    loot: { pair: 'PSO1Optic', at: [0, 0, 0, 0, 1], restock: 1800, usage: ARMY },
    worth: 35,
  },
  {
    id: 'rifle_wrap', name: 'Cheek Rest', model: 'sniper', nodeRe: '^cheekrest', w: 2, h: 1, weight: 0.2, category: 'attachment',
    desc: 'A raised rest for the cheek, strapped to the stock. Steadies the rifle: a quarter less sway, and a surer hold.',
    attach: { fits: ['mosin'], slot: 'wrap', ergo: 6 },
    loot: { pair: 'GhillieAtt_Mossy', at: [0, 0, 5, 3, 1], restock: 1500, usage: ARMY },
    worth: 8,
  },
  {
    id: 'suppressor_9', name: 'Pistol Suppressor', model: '@suppressor', w: 2, h: 1, weight: 0.3, category: 'attachment',
    desc: 'Screw-on sound suppressor for the M9, the Colt 1911 and the MPA30. Much quieter, no muzzle flash, slightly less punch. Softer kick, but the gun is longer and slower in the hand.',
    attach: { fits: ['colt', 'm9', 'mpa'], slot: 'muzzle', ergo: -8, recoil: 0.85, quiet: true },
    loot: { pair: 'PistolSuppressor', at: [0, 1, 10, 0, 0], restock: 1800, usage: ARMY, favour: { Police: 3 } },
    worth: 22,
  },
  {
    id: 'suppressor_762', name: 'Sniper Suppressor', model: 'sniper', nodeRe: '^silencer', w: 3, h: 1, weight: 0.55, category: 'attachment',
    desc: 'A suppressor for the sniper rifle. A shot with it on is not heard across the valley, and shows no flash: a little less punch, and a longer rifle to swing.',
    attach: { fits: ['mosin'], slot: 'muzzle', ergo: -9, recoil: 0.88, quiet: true },
    loot: { pair: 'ImprovisedSuppressor', at: [0, 0, 0, 3, 2], restock: 1800, lean: 4, apart: ['Military'] },
    worth: 28,
  },
  {
    id: 'suppressor_12', name: 'Shotgun Suppressor', model: 'benelli_m3', nodeRe: '^silencer', w: 4, h: 1, weight: 0.9, category: 'attachment',
    desc: 'The long can for the shotgun. It takes the worst of the noise and all of the flash, and makes a long gun longer.',
    attach: { fits: ['benelli'], slot: 'muzzle', ergo: -12, recoil: 0.85, quiet: true },
    loot: { pair: 'ImprovisedSuppressor', at: [0, 0, 0, 0, 3], restock: 1200 },
    worth: 28,
  },
  {
    id: 'red_dot', name: 'Holographic Sight', model: 'holo_sight', w: 2, h: 1, weight: 0.3, category: 'attachment',
    desc: 'A holographic sight: a lit ring and dot that lie on whatever the gun points at. Fits the M9, the Colt 1911, the MPA30, the shotgun and both assault rifles. Faster to aim with than irons.',
    attach: { fits: ['colt', 'm9', 'mpa', 'benelli', 'ak', 'ar15'], slot: 'optic', ergo: 3 },
    loot: { pair: 'M68Optic', at: [0, 1, 7, 3, 3], restock: 1800, usage: ARMY, lean: 4 },
    worth: 20, sells: 1,
  },
  {
    id: 'gun_light', name: 'Weapon Light', model: 'gun_light', w: 1, h: 1, weight: 0.15, category: 'attachment',
    desc: 'A light clamped to the gun, switched with L. It shows you the dark, and shows the dark where you are. Fits every gun.',
    attach: { fits: ['mosin', 'colt', 'm9', 'deagle', 'mpa', 'benelli', 'ak', 'ar15'], slot: 'light', ergo: -2 },
    // (not in the police station alone: its few shelves are where the gas masks are kept)
    loot: { pair: 'UniversalLight', at: [0, 0, 10, 3, 3], lifetime: 3600, restock: 900, usage: ['Military', 'Industrial', 'Police'], lean: 3 },
    worth: 10, sells: 1,
  },
  // (the MP7's own suppressor and sight: parts of its model, and fitting no other gun. The owner: "now that we have
  // enough guns we can start to make attachments weapon exclusive")
  {
    id: 'elcan', name: 'Elcan Specter', model: 'elcan', w: 2, h: 1, weight: 0.65, category: 'attachment',
    desc: 'A magnifying combat sight for the AR-15, and no other gun takes it. Two to six times closer when aimed through, turned on the mouse wheel, its cross lit red in the middle with drop marks under it; slower to bring up.',
    attach: { fits: ['ar15'], slot: 'optic', ergo: -4 },
    loot: { pair: 'ACOGOptic_6x', at: [0, 0, 0, 3, 2], restock: 1800, usage: ARMY },
    worth: 34,
  },
  {
    id: 'mac10_suppressor', name: 'MAC-10 Suppressors', model: 'dualmac', nodeRe: '^silencer', w: 3, h: 1, weight: 0.5, category: 'attachment',
    desc: 'A pair of suppressors for the Dual MAC-10s, and no other gun takes them. Both guns much quieter, no flash.',
    attach: { fits: ['dual_mac10'], slot: 'muzzle', ergo: -6, recoil: 0.85, quiet: true },
    loot: { pair: 'PistolSuppressor', at: [0, 0, 2, 2, 1], restock: 1800, usage: ARMY },
    worth: 24,
  },
  {
    id: 'mp7_suppressor', name: 'MP7 Suppressor', model: 'mp7a1', nodeRe: '^silencer', w: 3, h: 1, weight: 0.35, category: 'attachment',
    desc: 'The MP7A1 suppressor, and no other gun takes it. Much quieter and no flash; a softer kick, and a longer gun to swing.',
    attach: { fits: ['mp7a1'], slot: 'muzzle', ergo: -6, recoil: 0.86, quiet: true },
    loot: { pair: 'PistolSuppressor', at: [0, 0, 0, 3, 2], restock: 1800, usage: ARMY },
    worth: 26,
  },
  {
    id: 'mp7_sight', name: 'MP7 Sight', model: 'mp7a1', nodeRe: '^sight(_\\d+)?$', w: 2, h: 1, weight: 0.25, category: 'attachment',
    desc: 'The MP7A1 reflex sight, and no other gun takes it: a lit dot over its rail.',
    attach: { fits: ['mp7a1'], slot: 'optic', ergo: 3 },
    loot: { pair: 'ReflexOptic', at: [0, 0, 0, 3, 2], restock: 1800, usage: ARMY },
    worth: 22,
  },
  {
    id: 'suppressor_556', name: '5.56 Suppressor', model: 'ar15', nodeRe: '^silencer', w: 3, h: 1, weight: 0.45, category: 'attachment',
    desc: 'A suppressor for the AR-15, in place of its brake. Much quieter and no flash: a little less punch, a softer kick, and a longer rifle to swing.',
    attach: { fits: ['ar15'], slot: 'muzzle', ergo: -7, recoil: 0.88, quiet: true },
    loot: { pair: 'M4_Suppressor', at: [0, 0, 0, 0, 2], restock: 1800 },
    worth: 30,
  },
  {
    id: 'suppressor_739', name: 'AK Suppressor', model: 'rifle_suppressor', w: 3, h: 1, weight: 0.55, category: 'attachment',
    desc: 'A suppressor for the AK. A burst with it on is not heard across the valley, and shows no flash: a little less punch, a softer kick, and a longer rifle to swing.',
    attach: { fits: ['ak'], slot: 'muzzle', ergo: -9, recoil: 0.88, quiet: true },
    loot: { pair: 'AK_Suppressor', at: [0, 0, 0, 1, 1], restock: 1800, lean: 3, apart: ['Military'] },
    worth: 30,
  },
  {
    // (the M32's own vertical grip, the owner, 2026-10-17: "I like the 40mm foregrip model it should also work for the
    // ar15", and "for the db12 can we put the foregrip from the 40mm on it?". It was the AR-15's own stub of a grip.)
    id: 'foregrip', name: 'Foregrip', model: 'm32', nodeRe: '^base_3$', w: 1, h: 2, weight: 0.12, category: 'attachment',
    desc: 'A vertical grip for the forward hand, clamped under the AR-15, the MPA30 or the double-barrel shotgun. It holds the gun down when it fires: a fifth less kick, and it comes up a little faster.',
    attach: { fits: ['ar15', 'mpa', 'db12'], slot: 'grip', ergo: 4, recoil: 0.8 },
    loot: { pair: 'M4_RISHndgrd', at: [0, 0, 2, 0, 2], restock: 1200, usage: ARMY },
    worth: 12,
  },
];
