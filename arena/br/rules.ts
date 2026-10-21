// The battle royale's rules (2026-10-21), shared by its server (arena/br/match.ts) and the game (src/game/br/). The
// owner: "this is pubg + fortnite mode, we will call it battle royale, and itll play like pubg, but we want to make it
// look liek fortnite visually". The plan and every decision behind these numbers: docs/BATTLE-ROYALE.md.
//
// It lives in arena/ and reads the shared folders without changing them: a change under src/sim, src/world or
// src/net would rebuild the ZONA server (the owner's hard rule for this mode).
import { ITEMS, makeItem, type ItemInstance } from '../../src/sim/items';
import { heightAt, type World } from '../../src/world/worldgen';

export type BrMode = 'solo' | 'duo' | 'squad';
/** players a team, by mode; the page asks by this number (`size` on its address) */
export const TEAM: Record<BrMode, number> = { solo: 1, duo: 2, squad: 4 };
export const modeOfSize = (n: number): BrMode => (n >= 4 ? 'squad' : n >= 2 ? 'duo' : 'solo');

export const BR = {
  /** a lobby holds this many; a match starts with at least `min` */
  max: 30,
  min: 2,
  /** the vote that starts a match: two thirds of the lobby, rounded up (the owner: "majority rules") */
  votes: (n: number) => Math.ceil((n * 2) / 3),
  /** seconds from the vote passing to the plane */
  countdown: 10,
  /** the six slots (the owner: "maybe max 6 slots, and color coated slots") */
  slots: 6,
  /** a knocked player is got up by a teammate standing over them for this long, with this much health (the owner: "the person reviving must be standing and it will take 10 seconds") */
  revive: 10,
  reviveReach: 2.6,
  reviveHp: 30,
  /** a knocked player's own health, and what they bleed of it a second */
  knockHp: 100,
  bleed: 100 / 40,
  /** every melee weapon hits for this (the owner: "spawn every player with a random melee weapon but they all do the same damage") */
  melee: 25,
  meleeReach: 3.5,
  /** the most matches the server runs at once */
  most: 3,
  /** seconds the winner and the board stand before the lobby is closed */
  endFor: 40,
  /** the waiting area: things on the ground there are laid again this often, seconds */
  relay: 20,
} as const;

/** the plane and the fall, metres and seconds */
export const FLIGHT = {
  speed: 55,
  /** how high over the map's highest ground it flies */
  over: 300,
  /** seconds from the plane being told to its crossing the map's edge */
  lead: 6,
  /** freefall: straight down, diving (forward held), and the most it is steered across */
  fall: 24,
  dive: 36,
  steer: 16,
  /** the canopy opens by itself this high over the ground (or Space), and then falls and glides so */
  open: 70,
  chuteFall: 5.5,
  chuteGlide: 11,
} as const;

/** Rarity: our tiers, as Fortnite's colours (the owner's yes, 2026-10-21) */
export const RARITY: Record<number, { name: string; colour: string }> = {
  1: { name: 'Common', colour: '#b9c0c8' },
  2: { name: 'Uncommon', colour: '#43d65f' },
  3: { name: 'Rare', colour: '#3aa6ff' },
  4: { name: 'Epic', colour: '#b65cff' },
  5: { name: 'Legendary', colour: '#ffb21e' },
};

export interface BrMap {
  id: string;
  name: string;
  /** the playable box, world metres */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** the waiting area (PUBG's): a ring on the map where the lobby fights while it fills */
  wait: { x: number; z: number; r: number };
}

/** The world cut in thirds (the owner: "our map cut into thirds, the middle, desert, and then the village"). -z is north. */
export const MAPS: BrMap[] = [
  { id: 'desert', name: 'Desert', x0: -3640, x1: -2300, z0: -740, z1: 740, wait: { x: -3470, z: 70, r: 42 } },
  { id: 'middle', name: 'Green West', x0: -2200, x1: -800, z0: -700, z1: 700, wait: { x: -1850, z: -30, r: 42 } },
  { id: 'village', name: 'Kamenka', x0: -720, x1: 740, z0: -720, z1: 740, wait: { x: -240, z: 5, r: 42 } },
];

export const inMap = (m: BrMap, x: number, z: number, out = 0) => x >= m.x0 - out && x <= m.x1 + out && z >= m.z0 - out && z <= m.z1 + out;

/**
 * The circle, phase by phase (decision 3, "like fornight exactly"): shown, then a wait, then the shrink to the next.
 * Gas damage a second outside it, health points. The first wait starts when the plane leaves the map.
 */
export const PHASES: { wait: number; shrink: number; r: number; dmg: number }[] = [
  { wait: 100, shrink: 80, r: 380, dmg: 1 },
  { wait: 80, shrink: 60, r: 210, dmg: 2 },
  { wait: 60, shrink: 45, r: 110, dmg: 4 },
  { wait: 45, shrink: 40, r: 50, dmg: 7 },
  { wait: 30, shrink: 40, r: 12, dmg: 10 },
  { wait: 20, shrink: 30, r: 0, dmg: 14 },
];

export interface Circle { x: number; z: number; r: number }

/** where the circle is at `t` (ms) with the shrink from `a` to `b` running from `t0` to `t1` */
export function circleAt(a: Circle, b: Circle, t0: number, t1: number, t: number): Circle {
  const k = t <= t0 ? 0 : t >= t1 ? 1 : (t - t0) / (t1 - t0);
  return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, r: a.r + (b.r - a.r) * k };
}

/**
 * The next circle: wholly inside the last, its middle on land a body can stand on (not the sea, not a cliff), tried
 * at random until one is found.
 */
export function nextCircle(world: World, m: BrMap, last: Circle, r: number, rnd: () => number): Circle {
  const room = Math.max(0, last.r - r);
  const ground = (x: number, z: number) => heightAt(world.heights, x, z);
  for (let k = 0; k < 60; k++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * room, x = last.x + Math.cos(a) * d, z = last.z + Math.sin(a) * d;
    if (!inMap(m, x, z, -Math.min(r, 40))) continue;
    const y = ground(x, z), steep = Math.max(...[[3, 0], [-3, 0], [0, 3], [0, -3]].map(([dx, dz]) => Math.abs(ground(x + dx, z + dz) - y))) / 3;
    if (y < -14 || steep > 0.6) continue;
    return { x, z, r };
  }
  return { x: last.x, z: last.z, r };
}

/** the first circle: the whole map, round its middle */
export function firstCircle(m: BrMap): Circle {
  return { x: (m.x0 + m.x1) / 2, z: (m.z0 + m.z1) / 2, r: Math.hypot(m.x1 - m.x0, m.z1 - m.z0) / 2 };
}

// ------------------------------------------------------------------------------------------------- what is found

/** guns by rarity (the double barrel is out of the game, the M32 is an admin's) */
export const GUNS: Record<number, string[]> = {
  1: ['m9', 'colt', 'mosin9130'],
  2: ['scorpion', 'mpa', 'benelli', 'deagle', 'dual_sawnoff'],
  3: ['aks74u', 'mp7a1', 'ak', 'mosin', 'dual_smg'],
  4: ['ar15', 'a91', 'vssk', 'dual_mac10'],
  5: ['barrett', 'sniper50'],
};
/** heals: rarity, health given, the most it heals to, seconds to use, how many a slot holds */
export const HEALS: Record<string, { tier: number; hp: number; cap: number; secs: number; stack: number }> = {
  bandage: { tier: 1, hp: 15, cap: 75, secs: 3, stack: 5 },
  aid_pouch: { tier: 2, hp: 35, cap: 100, secs: 5, stack: 3 },
  firstaid: { tier: 3, hp: 100, cap: 100, secs: 8, stack: 2 },
  stim: { tier: 4, hp: 50, cap: 100, secs: 2, stack: 2 },
};
/** armour, helmets and packs by rarity (each worn in its own slot, as PUBG has them) */
export const VESTS: Record<number, string> = { 1: 'chest_rig', 2: 'soft_vest', 3: 'armor_vest', 4: 'life_vest', 5: 'heavy_armor' };
export const HELMETS: Record<number, string> = { 1: 'patrol_cap', 2: 'helmet_m1', 3: 'boonie_hat', 4: 'boonie_hat', 5: 'helmet_k63' };
export const PACKS: Record<number, string> = { 1: 'sack_pack', 2: 'camping_pack', 3: 'suitcase' };
/** the melee weapons a player starts with, one at random, all hitting alike */
export const MELEE = ['knife', 'machete', 'bat', 'hatchet', 'crowbar', 'shovel', 'pitchfork'];

/** rounds of a calibre in a box found, and the most carried with no pack (a pack carries more: `capOf`) */
export const AMMO: Record<string, { box: number; cap: number }> = {
  ammo_9mm: { box: 30, cap: 120 },
  ammo_45: { box: 30, cap: 120 },
  ammo_50: { box: 14, cap: 42 },
  ammo_12: { box: 12, cap: 36 },
  ammo_739: { box: 30, cap: 120 },
  ammo_556: { box: 30, cap: 120 },
  ammo_762: { box: 15, cap: 45 },
  ammo_127x55: { box: 10, cap: 30 },
  ammo_50bmg: { box: 6, cap: 18 },
};
export const capOf = (ammo: string, pack: string | null) => {
  const k = pack ? Object.values(PACKS).indexOf(pack) : -1;
  return Math.round((AMMO[ammo]?.cap ?? 60) * (k < 0 ? 1 : 1.5 + 0.5 * k));
};

/** an item's rarity in the battle royale */
export function rarityOf(id: string): number {
  for (const [t, ids] of Object.entries(GUNS)) if (ids.includes(id)) return Number(t);
  if (HEALS[id]) return HEALS[id].tier;
  for (const tab of [VESTS, HELMETS, PACKS]) for (const [t, v] of Object.entries(tab)) if (v === id) return Number(t);
  if (MELEE.includes(id)) return 1;
  return 1;
}

export type Kind = 'gun' | 'melee' | 'heal' | 'vest' | 'helmet' | 'pack' | 'ammo';
export function kindOf(id: string): Kind {
  if (AMMO[id]) return 'ammo';
  if (HEALS[id]) return 'heal';
  if (Object.values(VESTS).includes(id)) return 'vest';
  if (Object.values(HELMETS).includes(id)) return 'helmet';
  if (Object.values(PACKS).includes(id)) return 'pack';
  if (ITEMS[id]?.melee) return 'melee';
  return 'gun';
}

/** a gun as it is found: loaded, its own magazine in it (no magazines to carry: decision 4) */
export function freshGun(id: string): ItemInstance {
  const it = makeItem(id);
  const w = ITEMS[id].weapon!;
  if (w.mag) it.mag = w.mag;
  it.loaded = w.capacity;
  return it;
}

/** what lies on the ground in a match */
export interface Ground {
  id: number;
  x: number;
  y: number;
  z: number;
  /** a thing (gun, heal, armour) or rounds of a calibre */
  item?: ItemInstance;
  ammo?: string;
  n?: number;
}

/** a slot, as both sides hold it */
export type SlotItem = ItemInstance | null;
