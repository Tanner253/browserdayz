// Every recipe, as data (2026-10-24, plan-crafting; progression v3, the owner's yes 2026-10-25). Three places to make
// things: by hand anywhere, DayZ's way (a timed hold, standing still); at a workbench within 4 m, Rust's (queued), each
// recipe needing a bench of its level ("three bench levels"); at a forge, ours (it smelts while it burns). What may be
// made is learned (src/sim/craft/learn.ts). Never made: nails, hardware and steel plate (the owner: nails "must be looted
// which is hard and time consuming ... think like how dayz does it"), the code lock, rubbing alcohol, gun parts, and the
// best guns, which stay loot-only (gas, bunker, airdrops). A crafted gun costs iron bars plus a spring, a pipe and a body.

import { MAT } from './materials';
import { PIECES, PLACED } from '../build/pieces';
import { FORGE } from './forge';

export type Place = 'hand' | 'bench' | 'forge';
/** a workbench's level: what it crafts (v3: "I iron tools ... II pistols, simple attachments ... III rifles, SMGs, scopes, suppressors") */
export type Level = 1 | 2 | 3;
export const LEVEL_NAME: Record<Level, string> = { 1: 'Bench I', 2: 'Bench II', 3: 'Bench III' };
/** the screen's rail: what a recipe is filed under */
export type Cat = 'survival' | 'medical' | 'tools' | 'build' | 'weapons' | 'raid';
export const CATS: { id: Cat; name: string }[] = [
  { id: 'survival', name: 'Survival' },
  { id: 'medical', name: 'Medical' },
  { id: 'tools', name: 'Tools' },
  { id: 'build', name: 'Building' },
  { id: 'weapons', name: 'Weapons' },
  { id: 'raid', name: 'Raiding' },
];

export interface Need {
  /** what it is: one thing, or any one of several (all `n` of a need come from the same one) */
  id: string | readonly string[];
  n: number;
  /** a tool: not used up, but worn a use for each one made */
  keep?: true;
  /** what a need of several kinds is called on a card */
  name?: string;
}

export interface Recipe {
  id: string;
  /** what is made, and how many of it each time */
  makes: string;
  qty: number;
  /** what one made comes to by what was used for the first need, where it is not `qty`: rags by the size of the clothes, powder by the round */
  by?: Readonly<Record<string, number>>;
  needs: Need[];
  at: Place;
  /** a workbench's: the level of bench it needs */
  lv?: Level;
  /** seconds each one takes */
  time: number;
  cat: Cat;
}

/** how near a workbench or a forge has to be for what needs one, m (Rust's bench: its recipes light up near it) */
export const NEAR: Record<Exclude<Place, 'hand'>, number> = { bench: 4, forge: 3 };
/** how many one hand craft makes at most, one after another in one hold; and how many a bench keeps queued */
export const MOST = { hand: 10, queue: 5 };
/** how far a player may move during a hand craft, m: they stand still (DayZ) */
export const STILL = 0.6;

/** rags cut out of each piece of clothing, by its size (the fabric ones: a helmet, a vest or a pack is not cut up) */
// (the survivors' clothes too, the fabric ones, from 2026-10-27: only the first five were cut, and a survivor's own
// clothes gave no rags, the owner: "where does cloth come from? I cut jacket into bandages? rags?". Not leather, boots,
// helmets, vests, packs or the ghillie suit)
export const RAGS: Readonly<Record<string, number>> = {
  field_jacket: 6, field_trousers: 4, fishermans_hat: 2, patrol_cap: 1, garden_gloves: 1,
  tshirt: 3, tracksuit_jacket: 4, flannel_shirt: 4, hoodie: 5, quilted_jacket: 5, parka: 6, tactical_jacket: 5, combat_shirt: 4, mountain_smock: 5,
  tracksuit_pants: 3, jeans: 3, work_trousers: 4, cargo_pants: 4, combat_trousers: 4, mountain_trousers: 4,
  beanie: 1, ushanka: 2, beret: 1, boonie_hat: 2, balaclava: 1, fingerless_gloves: 1, work_gloves: 1,
};
/** what cuts clothes: a blade, or anything with an edge (the owner: "a knife or sharp object") */
export const BLADES = ['knife', 'bone_knife', 'machete', 'hatchet', 'stone_hatchet'] as const;
/** powder out of ten rounds of each kind: a rifle round has more in it than a pistol's (the plan; a satchel is ten, a hundred rounds) */
export const POWDER: Readonly<Record<string, number>> = {
  ammo_9mm: 1, ammo_45: 1, ammo_12: 1, ammo_50: 2,
  ammo_556: 2, ammo_739: 2, ammo_762: 2,
  ammo_127x55: 4, ammo_50bmg: 5,
};

const F = MAT.frags, BAR = MAT.bar;
const hand = (id: string, makes: string, qty: number, needs: Need[], time: number, cat: Cat, by?: Record<string, number>): Recipe => ({ id, makes, qty, needs, at: 'hand', time, cat, ...(by ? { by } : {}) });
const bench = (lv: Level, id: string, makes: string, qty: number, needs: Need[], time: number, cat: Cat): Recipe => ({ id, makes, qty, needs, at: 'bench', lv, time, cat });
/** a gun: bars, and the parts that are found (v3: "a spring, a pipe and a gun body") */
const gun = (lv: Level, id: string, bars: number, springs: number, pipes: number, body: 'pistol' | 'rifle', time: number, more: Need[] = []) =>
  bench(lv, id, id, 1, [{ id: BAR, n: bars }, { id: 'spring', n: springs }, { id: 'metal_pipe', n: pipes }, { id: `gun_body_${body}`, n: 1 }, ...more], time, 'weapons');

export const RECIPES: Recipe[] = [
  // ---------------------------------------------------------------- by hand, anywhere (DayZ)
  hand('rags', 'rags', 0, [{ id: Object.keys(RAGS), n: 1, name: 'Clothes' }, { id: BLADES, n: 1, keep: true, name: 'A blade' }], 4, 'survival', RAGS),
  hand('rope', 'rope', 1, [{ id: 'rags', n: 4 }], 5, 'survival'),
  hand('torch', 'torch', 1, [{ id: 'planks', n: 1 }, { id: 'rags', n: 2 }, { id: 'animal_fat', n: 1 }], 4, 'survival'),
  hand('bandage', 'bandage', 1, [{ id: 'rags', n: 2 }, { id: 'rubbing_alcohol', n: 1 }], 4, 'medical'),
  hand('aid_pouch', 'aid_pouch', 1, [{ id: 'rags', n: 3 }, { id: 'rubbing_alcohol', n: 2 }, { id: 'bandage', n: 1 }], 6, 'medical'),
  hand('splint', 'splint', 1, [{ id: 'planks', n: 2 }, { id: 'rags', n: 2 }], 5, 'medical'),
  hand('stone_hatchet', 'stone_hatchet', 1, [{ id: 'stone', n: 5 }, { id: 'planks', n: 1 }], 6, 'tools'),
  hand('bone_knife', 'bone_knife', 1, [{ id: 'bones', n: 2 }], 4, 'tools'),
  hand('gunpowder', 'gunpowder', 0, [{ id: Object.keys(POWDER), n: 10, name: 'Rounds of one kind' }], 5, 'raid', POWDER),
  // ---------------------------------------------------------------- Bench I: iron tools, a bed, a plan, key cutting, the first pistol rounds
  bench(1, 'hammer', 'hammer', 1, [{ id: F, n: 50 }, { id: 'planks', n: 1 }], 10, 'tools'),
  bench(1, 'hatchet', 'hatchet', 1, [{ id: F, n: 75 }, { id: 'planks', n: 1 }], 12, 'tools'),
  bench(1, 'hand_saw', 'hand_saw', 1, [{ id: F, n: 75 }, { id: 'planks', n: 1 }], 12, 'tools'),
  bench(1, 'pickaxe', 'pickaxe', 1, [{ id: F, n: 100 }, { id: 'planks', n: 1 }], 12, 'tools'),
  bench(1, 'building_plan', 'building_plan', 1, [{ id: 'rags', n: 2 }, { id: MAT.coal, n: 1 }], 5, 'build'),
  // (what is set down from the hands, made from what it cost to lay, at the workbench level it asked for: src/sim/build/pieces.ts PLACED)
  ...Object.entries(PLACED).filter(([, item]) => item !== 'sleeping_bag' && item !== 'torch').map(([k, item]) => {
    const needs = Object.entries(PIECES[k].cost ?? {}).map(([id, n]) => ({ id, n })), lv = PIECES[k].bench;
    return lv ? bench(Math.min(3, lv) as Level, item, item, 1, needs, 20, 'build') : hand(item, item, 1, needs, 6, 'build');
  }),
  bench(1, 'sleeping_bag', 'sleeping_bag', 1, [{ id: 'rags', n: 10 }, { id: 'rope', n: 1 }], 15, 'build'),
  bench(1, 'key_lock', 'key_lock', 1, [{ id: F, n: 75 }], 10, 'build'),
  // (the code lock made, and found rarely: the owner, 2026-10-25, "i think it should be craftable and lootable, rare to loot.
  // people should use a key and keylock for early game basing": a level II bench and its hardware, so the key lock comes first)
  bench(2, 'code_lock', 'code_lock', 1, [{ id: F, n: 150 }, { id: 'hardware', n: 1 }], 15, 'build'),
  // (a key copied from one held, cut to the same lock: the owner, 2026-10-25, "need a way to make key copies to share with
  // friends"; a lock taken off or fitted again takes a new number, and every copy of its old one opens nothing)
  hand('key_copy', 'key', 1, [{ id: 'key', n: 1, keep: true, name: 'The key to copy' }, { id: 'planks', n: 1 }], 4, 'build'),
  bench(1, 'ammo_9mm', 'ammo_9mm', 10, [{ id: 'gunpowder', n: 2 }, { id: F, n: 10 }], 8, 'weapons'),
  bench(1, 'ammo_45', 'ammo_45', 10, [{ id: 'gunpowder', n: 2 }, { id: F, n: 12 }], 8, 'weapons'),
  // ---------------------------------------------------------------- Bench II: sheet metal, the sledgehammer, the satchel, pistols, simple fittings
  bench(2, 'sheet_metal', 'sheet_metal', 1, [{ id: BAR, n: 3 }], 10, 'build'),
  bench(2, 'sledgehammer', 'sledgehammer', 1, [{ id: BAR, n: 3 }, { id: 'planks', n: 1 }], 14, 'tools'),
  bench(2, 'satchel', 'satchel', 1, [{ id: 'gunpowder', n: 10 }, { id: 'rags', n: 2 }, { id: 'rope', n: 1 }, { id: 'tin_can', n: 1 }], 20, 'raid'),
  bench(2, 'gun_light', 'gun_light', 1, [{ id: F, n: 60 }, { id: 'spring', n: 1 }], 15, 'weapons'),
  bench(2, 'red_dot', 'red_dot', 1, [{ id: BAR, n: 2 }, { id: F, n: 50 }], 20, 'weapons'),
  gun(2, 'colt', 4, 1, 1, 'pistol', 30),
  gun(2, 'm9', 5, 1, 1, 'pistol', 30),
  // ---------------------------------------------------------------- Bench III: rifles, submachine guns, scopes, suppressors, rifle rounds, C4
  bench(3, 'ammo_762', 'ammo_762', 10, [{ id: 'gunpowder', n: 4 }, { id: F, n: 20 }], 10, 'weapons'),
  bench(3, 'ammo_739', 'ammo_739', 10, [{ id: 'gunpowder', n: 4 }, { id: F, n: 20 }], 10, 'weapons'),
  bench(3, 'suppressor_9', 'suppressor_9', 1, [{ id: BAR, n: 2 }, { id: 'metal_pipe', n: 1 }, { id: F, n: 50 }], 25, 'weapons'),
  bench(3, 'suppressor_739', 'suppressor_739', 1, [{ id: BAR, n: 3 }, { id: 'metal_pipe', n: 1 }, { id: F, n: 75 }], 30, 'weapons'),
  bench(3, 'pu_scope', 'pu_scope', 1, [{ id: BAR, n: 3 }, { id: 'metal_pipe', n: 1 }, { id: F, n: 100 }], 30, 'weapons'),
  gun(3, 'mosin9130', 8, 1, 2, 'rifle', 45, [{ id: 'planks', n: 4 }]),
  gun(3, 'mpa', 8, 2, 1, 'rifle', 45),
  gun(3, 'scorpion', 9, 2, 1, 'rifle', 45),
  gun(3, 'ak', 12, 2, 1, 'rifle', 60),
  // (C4, plan v3's Bench III: four satchels' powder for what four or five do, src/sim/build/raid.ts; found too, where the army was)
  bench(3, 'c4', 'c4', 1, [{ id: 'gunpowder', n: 40 }, { id: F, n: 60 }, { id: 'rags', n: 5 }, { id: 'spring', n: 1 }], 45, 'raid'),
  // ---------------------------------------------------------------- at a forge (ours): ten fragments and half a minute of its fire make a bar
  { id: 'iron_bar', makes: BAR, qty: 1, needs: [{ id: F, n: FORGE.frags }], at: 'forge', time: FORGE.smelt, cat: 'build' },
];

export const RECIPE: Record<string, Recipe> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

/** the things a need may be met with */
export const optionsOf = (need: Need): readonly string[] => (typeof need.id === 'string' ? [need.id] : need.id);
