// The guns, what they fire and the boxes it comes in. Each item says everything about itself: what it is, where and how much of it is found (`loot`, on
// DayZ's Central Economy: see rules.ts) and what the trader gives for it. Adding a thing is one entry here.

import type { ItemDef } from '../items';
import { HOMES, ARMY, ARMOURY, ROUNDS, SOON, IN_TOWN } from './rules';

export const GUN_ITEMS: ItemDef[] = [
  // ---------------------------------------------------------------- weapons
  {
    id: 'mosin', name: 'Sniper Rifle', model: 'sniper', w: 9, h: 2, weight: 4.1, category: 'weapon', slot: 'long',
    desc: 'Bolt-action rifle in 7.62. Five rounds in a box magazine, and the bolt worked by hand after every one. Slow, loud and devastating. Takes a scope, a cheek rest, a suppressor and a light.',
    weapon: { kind: 'rifle', ammo: 'ammo_762', capacity: 5, mag: 'mag_sniper', ergo: 40, shows: { pu_scope: ['scope', 'glass'], rifle_wrap: ['cheekrest'], suppressor_762: ['silencer'] } }, iconYaw: 0,
    // The sniper rifle: the gas's. One in Kamenka (and the one the hospital's roof always keeps).
    loot: { pair: 'Mosin9130', at: [0, 0, 2, 7, 2], restock: 180, usage: ARMY, loaded: [1, 4], keep: SOON, on: { 3: { restock: 1500 } }, fitted: [['pu_scope', 0.025], ['rifle_wrap', 0.12], ['suppressor_762', 0.02]], rack: { fort: 1.6 }, lean: 2.5 },
    worth: 28,
  },
  // (The Colt 1911, 2026-10-11, in place of the Pistol 43, which is gone. It fires the .45, seven to a magazine.)
  {
    id: 'colt', name: 'Colt 1911', model: 'colt_1911', w: 3, h: 2, weight: 1.1, category: 'weapon', slot: 'holster',
    desc: 'The old .45 service pistol. Seven rounds in its magazine, each a good deal heavier than a 9 mm: slower to fire again, and it needs fewer. Takes a suppressor, a holographic sight and a light.',
    weapon: { kind: 'pistol', ammo: 'ammo_45', capacity: 7, mag: 'mag_colt', ergo: 80 }, iconYaw: 0,
    // Pistols: the village's. Where guns were kept, and now and then a house.
    loot: { pair: 'Colt1911', at: [0, 7, 20, 0, 0], restock: 180, usage: [...ARMY, 'Town'], favour: ARMOURY, loaded: [2, 6], keep: SOON, on: { 3: IN_TOWN }, fitted: [['suppressor_9', 0.08], ['gun_light', 0.06], ['red_dot', 0.03]], rack: { any: 2.4, town: 1 } },
    worth: 14,
  },
  {
    id: 'm9', name: 'M9 Pistol', model: 'm9', w: 3, h: 2, weight: 1.0, category: 'weapon', slot: 'holster',
    desc: 'Full-size 9x19mm service pistol. Fifteen rounds in its magazine, twenty in the long one. Takes a suppressor, a holographic sight and a light.',
    weapon: { kind: 'pistol', ammo: 'ammo_9mm', capacity: 15, mag: 'mag_m9', ergo: 74 }, iconYaw: 0,
    loot: { pair: 'CZ75', at: [0, 6, 24, 0, 0], restock: 180, usage: [...ARMY, 'Town'], favour: ARMOURY, loaded: [3, 10], keep: SOON, on: { 3: IN_TOWN }, fitted: [['suppressor_9', 0.06], ['mag_m9_ext', 0.08], ['red_dot', 0.03]], rack: { any: 1.8, town: 1.6, fort: 0.6 }, lean: 0.5 },
    worth: 16,
  },
  {
    id: 'deagle', name: 'Desert Eagle', model: 'desert_eagle', w: 3, h: 2, weight: 2.0, category: 'weapon', slot: 'holster',
    desc: 'A .50 pistol the size of a brick. Seven rounds in its magazine, ten in the long one, a kick to match, and two of them end most arguments. Nothing else fits it.',
    // (A .50 AE leaves at about 440 m/s. What a round does is its `damage` times how fast it is still going, and
    // nothing as slow as a pistol's does all of it (see where a round lands in src/game/weapons.ts): at 58 this
    // did 50 at the muzzle, and two to the body left a man standing with a sliver. At 82 it does 70: two to the
    // body are the end of anybody not in plates, and of whoever wears the armoured vest, barely.)
    weapon: { kind: 'pistol', ammo: 'ammo_50', capacity: 7, mag: 'mag_deagle', ergo: 56 }, iconYaw: 0,
    loot: { pair: 'Deagle', at: [0, 0, 0, 0, 4], restock: 600, loaded: [2, 7], fitted: [['mag_deagle_ext', 0.1]] },
    worth: 40,
  },
  {
    id: 'benelli', name: 'Benelli M3', model: 'benelli_m3', w: 8, h: 2, weight: 3.5, category: 'weapon', slot: 'long',
    desc: 'Twelve-gauge shotgun, self-loading. Seven shells in the tube, pushed in one at a time: it takes no magazine. Nine pellets a shell: nothing is worse to meet in a corridor, and little is less use across a field. Takes a holographic sight, a suppressor and a light.',
    weapon: { kind: 'rifle', ammo: 'ammo_12', capacity: 7, ergo: 52, action: 'self', tube: true, shows: { red_dot: ['sight'], suppressor_12: ['silencer'] } }, iconYaw: 0,
    // The shotgun and the Desert Eagle: the bunker's, and nobody else's.
    loot: { pair: 'Mp133Shotgun', at: [0, 0, 0, 0, 4], restock: 600, loaded: [3, 7], fitted: [['red_dot', 0.25], ['gun_light', 0.2]] },
    worth: 45,
  },
  // The submachine gun (2026-10-11): a MAC-pattern 9 mm with a railed fore-end, its magazine up its grip. It fires
  // what the pistols fire, thirty to a magazine, for as long as the trigger is held; it is slung on the back.
  {
    id: 'mpa', name: 'MPA30 SMG', model: 'smg', w: 5, h: 3, weight: 2.6, category: 'weapon', slot: 'long',
    desc: 'Submachine gun in 9x19mm. Thirty rounds in the magazine up its grip, and it empties it in under three seconds: a great deal of fire across a room, and a pistol\'s round past the end of the street. B changes it to single shots. Takes a holographic sight, the 9 mm suppressor, a foregrip and a light.',
    weapon: { kind: 'auto', ammo: 'ammo_9mm', capacity: 30, mag: 'mag_mpa', ergo: 68, modes: ['auto', 'semi'], shows: { mag_mpa: ['mag'] } }, iconYaw: 0,
    // The submachine gun: Kamenka's, and the big police station's before that.
    // (in the village it is a policeman's and a soldier's, and not a householder's)
    loot: { pair: 'MP5K', at: [0, 3, 38, 0, 0], restock: 240, usage: [...ARMY, 'Town'], favour: ARMOURY, loaded: [5, 20], keep: SOON, on: { 2: { usage: ARMY }, 3: IN_TOWN }, rack: { town: 2.4, fort: 1.6 }, lean: 0.4, fitted: [['suppressor_9', 0.05], ['red_dot', 0.05], ['gun_light', 0.06], ['foregrip', 0.06]] },
    worth: 34,
  },
  // The CZ Scorpion EVO (2026-10-17, the weapons pass): a 9 mm submachine gun of the newer kind, light and quick to
  // the shoulder, its magazine in front of its trigger guard. Its own hands and movements (scorpion pack).
  {
    id: 'scorpion', name: 'CZ Scorpion EVO', model: 'scorpion', w: 5, h: 3, weight: 2.8, category: 'weapon', slot: 'long',
    desc: 'Submachine gun in 9x19mm. Thirty rounds in its magazine, light, quick to the shoulder and steady in a burst. B changes it to single shots.',
    weapon: { kind: 'auto', ammo: 'ammo_9mm', capacity: 30, mag: 'mag_scorpion', ergo: 72, modes: ['auto', 'semi'], shows: { mag_scorpion: ['mag'] } }, iconYaw: 0,
    loot: { pair: 'CZ61', at: [0, 0, 23, 3, 0], restock: 240, usage: [...ARMY, 'Town'], favour: ARMOURY, loaded: [5, 20], keep: SOON, on: { 3: IN_TOWN }, rack: { town: 1.2 } },
    worth: 36,
  },
  // A .50 calibre bolt-action sniper rifle (2026-10-17): the bunker's, its scope part of it.
  {
    id: 'sniper50', name: 'L96 AWP .50', model: 'sniper50', w: 10, h: 3, weight: 11.5, category: 'weapon', slot: 'long',
    desc: 'A bolt-action rifle in .50 BMG with a scope of its own that turns from four to twelve times on the mouse wheel, mil-dots on its cross and a laser rangefinder that reads the range to whatever is under it. Five rounds. It reaches further and hits harder than anything else in the Zone.',
    weapon: { kind: 'rifle', ammo: 'ammo_50bmg', capacity: 5, mag: 'mag_sniper50', ergo: 30, ownScope: true, shows: { mag_sniper50: ['mag'] } }, iconYaw: 0,
    loot: { pair: 'SV98', at: [0, 0, 0, 0, 1], restock: 900, loaded: [1, 5], rack: { fort: 0.6 } },
    worth: 120,
  },
  // The M32 MGL (2026-10-17): a six-shot 40 mm grenade launcher, for admins only (the owner: "the grenade launcher
  // and its ammo is an admin only weapon"): found nowhere, sold by nobody, and its grenades believed by the server
  // from an admin alone. Held in the .50 sniper rifle's movements.
  {
    id: 'm32', name: 'M32 MGL', model: 'm32', w: 6, h: 3, weight: 5.3, category: 'weapon', slot: 'long',
    desc: 'A six-shot 40 mm grenade launcher, loaded by hand, aimed through its own holographic sight. Its grenades fly in an arc and go off where they strike. For admins.',
    weapon: { kind: 'rifle', ammo: 'ammo_40mm', capacity: 6, ergo: 35, action: 'self', launches: 'ammo_40mm', fixedSight: true }, iconYaw: 0,
    loot: { pair: 'M79' },
  },
  // The Barrett M82 (2026-10-17): the bunker's .50, loading itself, ten rounds, its scope part of it. No movements of
  // its own: held as the .50 sniper rifle is.
  {
    id: 'barrett', name: 'Barrett .50', model: 'barrett', w: 10, h: 3, weight: 13.5, category: 'weapon', slot: 'long',
    desc: 'A self-loading rifle in .50 BMG with a scope of its own that turns from four to twelve times on the mouse wheel, mil-dots on its cross and a laser rangefinder that reads the range to whatever is under it. Ten rounds, as fast as the trigger, and it kicks like a mule.',
    weapon: { kind: 'rifle', ammo: 'ammo_50bmg', capacity: 10, mag: 'mag_barrett', ergo: 25, action: 'self', ownScope: true, shows: { mag_barrett: ['mag'] } }, iconYaw: 0,
    // (the weapons pass, 2026-10-17: the Scorpion a third-step gun, the towns' and the army's)
    loot: { pair: 'SVD', at: [0, 0, 0, 0, 1], restock: 1200, loaded: [2, 10], rack: { fort: 0.5 } },
    worth: 140,
  },
  // The VSSK Vykhlop (2026-10-17): a quiet heavy bullpup, 12.7x55 subsonic, its scope part of it. Held as the .50 sniper rifle is.
  {
    id: 'vssk', name: 'VSSK Vykhlop', model: 'vssk', w: 8, h: 3, weight: 7.0, category: 'weapon', slot: 'long',
    desc: 'A bullpup sniper rifle with a can the length of its barrel, firing heavy subsonic 12.7x55. Five rounds, self-loading. Its scope turns from two to six times on the mouse wheel, with the chevrons and range lines of a PSO.',
    weapon: { kind: 'rifle', ammo: 'ammo_127x55', capacity: 5, mag: 'mag_vssk', ergo: 40, action: 'self', ownScope: true, shows: { mag_vssk: ['mag', 'bullet'] } }, iconYaw: 0,
    loot: { pair: 'VSS', at: [0, 0, 0, 0, 1], restock: 900, loaded: [1, 5], rack: { fort: 1 } },
    worth: 110,
  },
  // A pair of submachine guns, one in each hand (2026-10-17): the left button fires the left one, the right button the
  // right ("akimbo weapons are shot with left and right click controlling their respective hands"). Never aimed.
  {
    id: 'dual_smg', name: 'Dual SMGs', model: 'dualsmg', w: 6, h: 3, weight: 4.4, category: 'weapon', slot: 'long',
    desc: 'Two submachine guns in 9 mm, one in each hand: left button for the left, right button for the right. Thirty rounds in each, never aimed down a sight.',
    weapon: { kind: 'auto', ammo: 'ammo_9mm', capacity: 60, mag: 'mag_dual_smg', ergo: 55, modes: ['auto', 'semi'], akimbo: true, shows: { mag_dual_smg: ['mag'] } }, iconYaw: 0,
    loot: { pair: 'PP19', at: [0, 0, 9, 2, 0], restock: 300, usage: [...ARMY, 'Town'], favour: ARMOURY, loaded: [10, 40], keep: SOON, rack: { town: 0.8 } },
    worth: 50,
  },
  // A pair of MAC-10s (2026-10-17), as the Dual SMGs: left button the left one, right button the right. .45, and a
  // suppressor of their own that quiets both. Held in the Dual SMGs' movements.
  {
    id: 'dual_mac10', name: 'Dual MAC-10s', model: 'dualmac', w: 5, h: 3, weight: 5.6, category: 'weapon', slot: 'long',
    desc: 'Two MAC-10s in .45 ACP, one in each hand: left button for the left, right button for the right. Thirty rounds in each and very fast. Never aimed down a sight.',
    weapon: { kind: 'auto', ammo: 'ammo_45', capacity: 60, mag: 'mag_dual_mac10', ergo: 50, modes: ['auto', 'semi'], akimbo: true, shows: { mag_dual_mac10: ['mag'], mac10_suppressor: ['silencer'] } }, iconYaw: 0,
    loot: { pair: 'UMP45', at: [0, 0, 7, 2, 0], restock: 300, usage: [...ARMY, 'Town'], favour: ARMOURY, loaded: [10, 40], keep: SOON, rack: { town: 0.8 }, fitted: [['mac10_suppressor', 0.06]] },
    worth: 52,
  },
  // A pair of sawn-off shotguns (2026-10-17), one in each hand: left button the left, right button the right. Two
  // shells in each, both broken open and loaded together. Common in the countryside (T2).
  {
    id: 'dual_sawnoff', name: 'Sawn-Offs', model: 'sawnoffs', w: 5, h: 3, weight: 4.2, category: 'weapon', slot: 'long',
    desc: 'Two sawn-off 12 gauge shotguns, one in each hand: left button for the left, right button for the right. Two shells in each; murderous up close, nothing at range.',
    weapon: { kind: 'rifle', ammo: 'ammo_12', capacity: 4, ergo: 45, action: 'self', akimbo: true }, iconYaw: 0,
    loot: { pair: 'SawedoffIzh43Shotgun', at: [0, 1, 12, 0, 0], restock: 240, usage: ['Hunting', ...HOMES], loaded: [0, 4], keep: SOON },
    worth: 30,
  },
  // A double-barrelled shotgun (2026-10-17): two shells, broken open and both loaded at once. Common in the
  // countryside (T2), as DayZ's double barrel is.
  {
    id: 'db12', name: 'Double-Barrel Shotgun', model: 'db12', w: 8, h: 2, weight: 3.2, category: 'weapon', slot: 'long',
    desc: 'A side-by-side 12 gauge. Two shells, one in each barrel, both loaded at once when it is broken open.',
    weapon: { kind: 'rifle', ammo: 'ammo_12', capacity: 2, ergo: 50, action: 'self' }, iconYaw: 0,
    loot: { pair: 'Izh43Shotgun', at: [0, 0, 15, 0, 0], restock: 240, usage: ['Hunting', ...HOMES], loaded: [0, 2], keep: SOON, fitted: [['foregrip', 0.1]] },
    worth: 22,
  },
  // The AKS-74U (2026-10-17): the AK cut short, folding stock, rare. It takes the AK's magazines.
  {
    id: 'aks74u', name: 'AKS-74U', model: 'aks74u', w: 6, h: 3, weight: 2.7, category: 'weapon', slot: 'long',
    desc: 'The AK cut short. Takes AK magazines. Fast and loud, it climbs in a burst and is no rifle past a hundred metres. B changes it to single shots.',
    weapon: { kind: 'auto', ammo: 'ammo_739', capacity: 30, mag: 'mag_ak', ergo: 66, modes: ['auto', 'semi'], shows: { mag_ak: ['mag'] } }, iconYaw: 0,
    loot: { pair: 'AKS74U', at: [0, 0, 0, 2, 0], restock: 300, usage: ARMY, loaded: [5, 20], keep: SOON, rack: { town: 0.8, fort: 1.2 } },
    worth: 48,
  },
  // The MP7A1 (2026-10-17): the small personal defence weapon, rare. Its own suppressor and sight are its own parts,
  // seen only when fitted. Fed 9 mm here, as every submachine gun in the Zone is.
  {
    id: 'mp7a1', name: 'MP7A1', model: 'mp7a1', w: 5, h: 3, weight: 1.9, category: 'weapon', slot: 'long',
    desc: 'Compact personal defence weapon. Forty rounds in its long magazine, very fast and very steady. B changes it to single shots.',
    weapon: { kind: 'auto', ammo: 'ammo_9mm', capacity: 40, mag: 'mag_mp7', ergo: 78, modes: ['auto', 'semi'], shows: { mag_mp7: ['mag'], mp7_suppressor: ['silencer'], mp7_sight: ['sight'] }, optic: 'mp7_sight' }, iconYaw: 0,
    loot: { pair: 'Vikhr', at: [0, 0, 0, 4, 2], restock: 300, usage: [...ARMY], favour: ARMOURY, loaded: [5, 20], keep: SOON, rack: { town: 0.8, fort: 1 }, fitted: [['mp7_sight', 0.12], ['mp7_suppressor', 0.05]] },
    worth: 44,
  },
  // Ammunition (2026-10-10). Loose rounds lie thirty to a place in a pocket, whatever they are. A box is one place,
  // and holds twenty-five: it is unwrapped in the hands, and what was in it is loose rounds. Rounds go into a
  // magazine by hand, and a magazine into a gun: nothing goes from a pocket into a gun but through one of those,
  // except a shell into the shotgun's tube, and a single round into an empty chamber.
  // The two rifles that fire as long as the trigger is held (2026-10-10). Each is fed by a thirty-round magazine
  // of its own, three cells tall, or by a big one that is two wide; neither goes in a pocket: they are slung on
  // the back. (The AK is drawn from an AK-74M and fires what the box found with it says, 7.62x39.)
  {
    id: 'ak', name: 'AK', model: 'ak', w: 8, h: 3, weight: 3.6, category: 'weapon', slot: 'long',
    desc: 'Assault rifle in 7.62x39. Thirty rounds in its magazine, seventy-five in the drum. It fires for as long as the trigger is held, kicks up and to the right, and hits hard at any range a man is seen at. B changes it to single shots. Takes a holographic sight, a suppressor and the drum.',
    weapon: { kind: 'auto', ammo: 'ammo_739', capacity: 30, mag: 'mag_ak', ergo: 46, modes: ['auto', 'semi'], shows: { mag_ak: ['mag'] } }, iconYaw: 0,
    // The two assault rifles: the gas's, and the bunker's racks and lockers (see crates.ts). In Kamenka one of each,
    // where the army and the police kept things, seldom with a magazine in it, and a long time coming back.
    loot: { pair: 'AKM', at: [0, 0, 2, 5, 0], restock: 300, usage: ARMY, loaded: [5, 20], keep: SOON, on: { 3: { restock: 2700, mag: 0.15 } }, fitted: [['red_dot', 0.1], ['suppressor_739', 0.05], ['drum_ak', 0.04]], rack: { fort: 2 }, lean: 3 },
    worth: 55,
  },
  {
    id: 'ar15', name: 'AR-15', model: 'ar15', w: 7, h: 3, weight: 3.0, category: 'weapon', slot: 'long',
    desc: 'Carbine in 5.56. Thirty rounds in its magazine, sixty in the long one. Faster and flatter than the AK and easier to hold on a target, and each round does less. B changes it to single shots. Takes a holographic sight, a suppressor, a foregrip, a light and the long magazine.',
    weapon: { kind: 'auto', ammo: 'ammo_556', capacity: 30, mag: 'mag_ar', ergo: 62, modes: ['auto', 'semi'], shows: { mag_ar: ['mag'], suppressor_556: ['silencer'], red_dot: ['sight'], gun_light: ['light'] }, hides: { suppressor_556: ['brake'] }, never: ['foregrip'] }, iconYaw: 0,
    loot: { pair: 'M4A1', at: [0, 0, 2, 3, 1], restock: 420, usage: ARMY, loaded: [5, 20], keep: SOON, on: { 3: { restock: 3000, mag: 0.12 } }, fitted: [['red_dot', 0.2], ['foregrip', 0.2], ['gun_light', 0.15], ['suppressor_556', 0.06], ['mag_ar_60', 0.05]], rack: { fort: 2 }, lean: 3 },
    worth: 60,
  },
  {
    id: 'ammo_739', name: '7.62x39 Rounds', model: 'round_739', w: 1, h: 1, weight: 0.008, category: 'ammo', stack: 30, scale: 1.3, pile: 5,
    desc: 'Loose rifle cartridges, for the AK. They go into its magazine by hand.',
    // 7.39 and 5.56: the rifles'. Light where the army and the police were below the gas, heavier from the gas up.
    loot: { pair: 'Ammo_762x39', at: [0, 1, 12, 5, 3], restock: 180, usage: ARMY, favour: ARMOURY, qty: [0.25, 0.6], keep: SOON, lean: 1.5 },
    worth: 0.7,
  },
  {
    id: 'ammo_556', name: '5.56x45 Rounds', model: 'round_556', w: 1, h: 1, weight: 0.004, category: 'ammo', stack: 30, scale: 1.15, pile: 5,
    desc: 'Loose rifle cartridges, small and fast, for the AR-15. They go into its magazine by hand.',
    // (the AR-15's rounds by a rate: one police or army spot in sixteen in the village, one in twelve in Kamenka, most of
    // them at the police stations; a box in sixty and in forty. See `per`.)
    loot: { pair: 'Ammo_556x45', at: [0, 0, 26, 4, 4], per: [0, 1 / 16, 1 / 12, 0, 0], restock: 180, usage: ARMY, favour: ARMOURY, qty: [0.25, 0.6], keep: SOON, lean: 1.5 },
    worth: 0.7,
  },
  {
    id: 'box_739', name: '7.62x39 Ammo Box', model: 'ammo_box_739', w: 1, h: 1, weight: 0.23, category: 'ammo',
    desc: 'A sealed box of 25 cartridges for the AK. Hold it and unwrap it to get the rounds out.',
    open: { gives: 'ammo_739', qty: 25, time: 2.2 },
    loot: { pair: 'AmmoBox_762x39_20Rnd', at: [0, 0, 3, 3, 2], restock: 240, usage: ARMY, favour: ARMOURY, keep: SOON, lean: 3 },
    sells: 3,
  },
  {
    id: 'box_556', name: '5.56x45 Ammo Box', model: 'ammo_box_556', w: 1, h: 1, weight: 0.13, category: 'ammo',
    desc: 'A sealed box of 25 cartridges for the AR-15. Hold it and unwrap it to get the rounds out.',
    open: { gives: 'ammo_556', qty: 25, time: 2.2 },
    loot: { pair: 'AmmoBox_556x45_20Rnd', at: [0, 0, 7, 2, 3], per: [0, 1 / 60, 1 / 40, 0, 0], restock: 240, usage: ARMY, favour: ARMOURY, keep: SOON, lean: 4 },
    sells: 3,
  },
  {
    id: 'ammo_40mm', name: '40 mm Grenades', model: 'm32', nodeRe: '^cylinder_[23]$', w: 1, h: 1, weight: 0.23, category: 'ammo', stack: 50, scale: 1, pile: 1,
    desc: '40 mm high-explosive grenades for the M32. They go off where they strike. For admins.',
    loot: { pair: 'Ammo_40mm_Explosive' },
  },
  {
    id: 'ammo_50bmg', name: '.50 BMG Rounds', model: 'round_50bmg', w: 1, h: 1, weight: 0.115, category: 'ammo', stack: 10, scale: 1, pile: 3,
    desc: 'Loose .50 calibre cartridges, heavy as a fistful of bolts. They go into the .50 rifle magazine by hand.',
    loot: { pair: 'Ammo_308WinTracer', at: [0, 0, 0, 2, 4], restock: 600, qty: [0.3, 0.8] },
  },
  {
    id: 'ammo_127x55', name: '12.7x55 Rounds', model: 'vssk', nodeRe: '^bullet', w: 1, h: 1, weight: 0.075, category: 'ammo', stack: 10, scale: 1, pile: 3,
    desc: 'Heavy subsonic 12.7x55 cartridges for the VSSK Vykhlop. They go into its magazine by hand.',
    loot: { pair: 'Ammo_9x39AP', at: [0, 0, 0, 2, 3], restock: 600, qty: [0.3, 0.8] },
  },
  {
    id: 'ammo_762', name: '7.62x54R Rounds', model: 'round_762', w: 1, h: 1, weight: 0.009, category: 'ammo', stack: 30, scale: 1.3, pile: 5,
    desc: 'Loose full-power rifle cartridges, for the sniper rifle. They go into its magazine by hand.',
    // 7.62: the sniper rifle's. A hunter has some.
    loot: { pair: 'Ammo_762x54', at: [2, 2, 15, 5, 2], restock: 120, usage: [...ARMY, 'Hunting'], favour: ARMOURY, qty: [0.25, 0.6], keep: SOON, lean: 1.5 },
    worth: 0.6,
  },
  {
    id: 'ammo_9mm', name: '9x19mm Rounds', model: 'round_9mm', w: 1, h: 1, weight: 0.006, category: 'ammo', stack: 30, scale: 1.6, pile: 6,
    desc: 'Loose pistol cartridges, for the M9 and the MPA30. Common among police and military. They go into a magazine by hand.',
    // (loose rounds turn up in handfuls; sealed boxes are the real find, and are where guns were kept)
    // 9 mm and .45: the pistols' and the submachine gun's. A handful in a house or a cabin as well.
    loot: { pair: 'Ammo_9x19', at: [10, 9, 76, 0, 1], restock: 120, usage: [...ARMY, 'Hunting', ...HOMES], favour: ROUNDS, qty: [0.25, 0.6], keep: SOON, on: { 3: IN_TOWN }, lean: 0.4 },
    worth: 0.4,
  },
  {
    id: 'ammo_45', name: '.45 ACP Rounds', model: 'round_45', w: 1, h: 1, weight: 0.012, category: 'ammo', stack: 30, scale: 1.6, pile: 6,
    desc: 'Loose .45 cartridges, short and fat, for the Colt 1911. They go into its magazine by hand.',
    loot: { pair: 'Ammo_45ACP', at: [5, 6, 26, 0, 0], restock: 120, usage: [...ARMY, 'Hunting', ...HOMES], favour: ROUNDS, qty: [0.25, 0.6], keep: SOON, on: { 3: IN_TOWN } },
    worth: 0.5,
  },
  {
    id: 'ammo_50', name: '.50 AE Rounds', model: 'round_50', w: 1, h: 1, weight: 0.015, category: 'ammo', stack: 30, scale: 1.5, pile: 4,
    desc: 'Loose .50 cartridges. Only the Desert Eagle fires them.',
    loot: { pair: 'Ammo_357', at: [0, 1, 6, 1, 6], restock: 300, usage: ARMY, favour: ARMOURY, qty: [0.3, 0.7], lean: 3 },
    worth: 1.5,
  },
  {
    id: 'ammo_12', name: '12 Gauge Shells', model: 'shell_12', w: 1, h: 1, weight: 0.028, category: 'ammo', stack: 30, scale: 1.3, pile: 5,
    desc: 'Buckshot: nine pellets a shell. Pushed into the shotgun\'s tube one at a time.',
    // 12 gauge and .50: the bunker's guns'. A handful where the police and the army were, for whoever is going
    // down there ("you should be able to find high tier ammo in medium-high tier loot spots"); boxes from the gas up.
    loot: { pair: 'Ammo_12gaPellets', at: [0, 1, 6, 2, 7], restock: 300, usage: ARMY, favour: ARMOURY, qty: [0.3, 0.7] },
    worth: 1.2,
  },
  {
    id: 'box_45', name: '.45 ACP Ammo Box', model: 'ammo_box_45', w: 1, h: 1, weight: 0.33, category: 'ammo', scale: 0.75,
    desc: 'An old box of 25 .45 cartridges for the Colt 1911. Hold it and unwrap it to get the rounds out.',
    open: { gives: 'ammo_45', qty: 25, time: 2.2 },
    loot: { pair: 'AmmoBox_45ACP_25rnd', at: [0, 1, 10, 0, 0], restock: 240, usage: ARMY, favour: ARMOURY, keep: SOON },
    sells: 3,
  },
  {
    id: 'box_50', name: '.50 AE Ammo Box', model: 'ammo_box_50', w: 1, h: 1, weight: 0.405, category: 'ammo',
    desc: 'A sealed box of 25 .50 cartridges. Hold it and unwrap it to get the rounds out.',
    open: { gives: 'ammo_50', qty: 25, time: 2.2 },
    loot: { pair: 'AmmoBox_357_20Rnd', at: [0, 0, 0, 0, 3], restock: 420 },
    sells: 2,
  },
  {
    id: 'box_12', name: '12 Gauge Shell Box', model: 'ammo_box_12', w: 1, h: 1, weight: 0.73, category: 'ammo',
    desc: 'A sealed box of 25 buckshot shells. Hold it and unwrap it to get them out.',
    open: { gives: 'ammo_12', qty: 25, time: 2.2 },
    loot: { pair: 'AmmoBox_00buck_10rnd', at: [0, 0, 0, 1, 4], restock: 420 },
    sells: 4,
  },
  {
    // (the .50s' and the VSSK's rounds in a box too, the owner, 2026-10-17: "ensure ammo models and ammo boxes spawn
    // properly for the new ammo types": a steel ammunition can, as such rounds are kept, small enough for a pocket)
    id: 'box_50bmg', name: '.50 BMG Ammo Can', model: 'ammo_box', scale: 0.55, w: 1, h: 1, weight: 2.925, category: 'ammo',
    desc: 'A small steel can of 25 .50 BMG cartridges, for the .50 rifles. Hold it and open it to get the rounds out.',
    open: { gives: 'ammo_50bmg', qty: 25, time: 2.6 },
    loot: { pair: 'AmmoBox_308WinTracer_20Rnd', at: [0, 0, 0, 0, 1], restock: 900 },
  },
  {
    id: 'box_127x55', name: '12.7x55 Ammo Can', model: 'ammo_box', tint: 0x9a9a88, scale: 0.5, w: 1, h: 1, weight: 1.925, category: 'ammo',
    desc: 'A small steel can of 25 subsonic 12.7x55 cartridges, for the VSSK. Hold it and open it to get the rounds out.',
    open: { gives: 'ammo_127x55', qty: 25, time: 2.6 },
    loot: { pair: 'AmmoBox_9x39AP_20Rnd', at: [0, 0, 0, 0, 1], restock: 900 },
  },
  {
    id: 'box_762', name: '7.62x54R Ammo Box', model: 'ammo_box_762', w: 1, h: 1, weight: 0.255, category: 'ammo',
    desc: 'A sealed box of 25 rifle cartridges. Hold it and unwrap it to get the rounds out.',
    open: { gives: 'ammo_762', qty: 25, time: 2.2 },
    loot: { pair: 'AmmoBox_762x54_20Rnd', at: [0, 1, 8, 6, 2], restock: 180, usage: ARMY, favour: ARMOURY, keep: SOON, lean: 2.5 },
    sells: 4,
  },
  {
    id: 'box_9mm', name: '9x19mm Ammo Box', model: 'ammo_box_9mm', w: 1, h: 1, weight: 0.18, category: 'ammo',
    desc: 'A sealed box of 25 pistol cartridges. Hold it and unwrap it to get the rounds out.',
    open: { gives: 'ammo_9mm', qty: 25, time: 2.2 },
    loot: { pair: 'AmmoBox_9x19_25rnd', at: [0, 3, 42, 1, 2], restock: 180, usage: ARMY, favour: ARMOURY, keep: SOON, on: { 3: { usage: [...ARMY, 'Town'], ...IN_TOWN } }, lean: 0.6 },
    sells: 4,
  },
];
