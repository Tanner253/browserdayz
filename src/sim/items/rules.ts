// What an item's `loot` says: DayZ's Central Economy (types.xml) rebuilt for this map. The owner, 2026-10-17: "we should
// use dayz as a template for loot distribution. all of our items can be paired to one of dayz items", and "it should
// be easy to add new items and assign them values into the system, we want to keep it DRY". So every item carries its
// own rule, and the economy (src/sim/economy.ts), the crates, the furniture and the trader read it from there. DayZ's
// files are licensed for its own games only: the system is rebuilt and every number is ours; `pair` names the DayZ thing
// whose role an item has, so that "how does DayZ do it" has an answer for each.
//
// DayZ's tiers are 1 to 4, and so are ours; our best of the best (the .50s, the VSSK, the bunker's guns) are a fifth,
// above anything DayZ has (the owner: "for dayz their max tier is 4 so we will have to assign the best of the best
// guns we offer to T5").

import type { Usage } from '../../world/buildings';
import type { Tier } from '../tiers';
import type { Category, ItemDef } from '../items';

/** what the economy reads of an item: its `loot` with what is unsaid filled in (see `typeRule`) */
export interface TypeRule {
  /**
   * How many are kept on each step of the map (src/sim/tiers.ts): [the outskirts, the village and the army's
   * places, Kamenka, under the gas, the bunker]. A nought is never: a thing kept only from the third step up is
   * not found on the first two, wherever anybody looks. (DayZ's `nominal`, given for each tier.)
   */
  at: [number, number, number, number, number];
  /**
   * Or as a rate: of the spots on each step where it can lie (its kinds of building, see `usage`), the share that are
   * kept with one, so that the places it belongs to have it however many of them there are; the count is worked out
   * from the map (Economy.kept), never less than `at`. The owner, 2026-10-15: "someone with an AR needs to be able to
   * loot reliable places for ammo not set spawns, just spawn frequency ... based on tiers and cateogryu of building".
   */
  per?: [number, number, number, number, number];
  /** seconds it lies untouched before it is cleared away (DayZ's `lifetime`) */
  lifetime: number;
  /** seconds before one that is gone is put back (DayZ's `restock`) */
  restock: number;
  /** the kinds of building it lies in, on the first three steps (under the gas and in the bunker a thing lies wherever it will) */
  usage: Usage[];
  /** stack quantity range as fraction of max stack (DayZ's `quantmin`, `quantmax`) */
  qty?: [number, number];
  /** rounds loaded for weapons */
  loaded?: [number, number];
  /** how much likelier a point of that kind of building is to get it (1 when not listed) */
  favour?: Partial<Record<Usage, number>>;
  /** it is put back when fewer than this share of them are left on a step (0.6 unless said; from Kamenka up, whenever one is gone). DayZ's `min`, as a share. */
  keep?: number;
  /**
   * What is otherwise on one step of the map: the kinds of building it lies in there, how it leans among them, how
   * many seconds before one that is taken is put back, and how often a gun put down there has its magazine in it
   * (0..1; unsaid, as often as anywhere: six times in ten).
   */
  on?: Partial<Record<Tier, { usage?: Usage[]; favour?: Partial<Record<Usage, number>>; restock?: number; mag?: number }>>;
}

/** an item's own loot rule, as written on it: the economy's numbers, and the rest of what DayZ says of a thing */
export interface LootRule extends Partial<TypeRule> {
  /** its counterpart in DayZ's types.xml: the thing whose role it has (the numbers are ours) */
  pair: string;
  /** what a gun is found fitted with now and then: [what, how often], one roll each (DayZ's cfgspawnabletypes attachments) */
  fitted?: [string, number][];
  /** a pack or a case: how often one is found with something in it, and the most things in it (DayZ's cargo presets; see `pack` in economy.ts) */
  filled?: { chance: number; most: number };
  /** its weight on an armed point (a rack, a guard post): anywhere, from Kamenka on where guns were kept, and on a fort's racks */
  rack?: { any?: number; town?: number; fort?: number };
  /** how a place apart's share of it leans, times its share (the fort's garrison store: see APART_LEAN in economy.ts) */
  lean?: number;
  /** the kind of spot it lies at in a place apart, where it has no kind of its own (see APART_KIND in economy.ts) */
  apart?: Usage[];
}

/** seconds a thing lies untouched, where its rule does not say: by its sort */
export const LIFETIME: Record<Category, number> = {
  weapon: 7200, magazine: 7200, attachment: 7200, stash: 7200,
  ammo: 3600, melee: 3600, medical: 3600, clothing: 3600, misc: 3600, tool: 3600,
  food: 2400, drink: 2400,
};

/** an item's rule as the economy reads it, or null where it is found nowhere */
export function typeRule(def: ItemDef): TypeRule | null {
  const l = def.loot;
  if (!l?.at || l.restock === undefined) return null;
  const { pair: _p, fitted: _f, filled: _c, rack: _r, lean: _l, apart: _a, ...rule } = l;
  return { ...rule, at: l.at, restock: l.restock, lifetime: l.lifetime ?? LIFETIME[def.category], usage: l.usage ?? [] };
}

/** DayZ's category of a thing (types.xml `category`), from what it is */
export type DayzCategory = 'weapons' | 'tools' | 'clothes' | 'food' | 'containers' | 'explosives';
export function dayzCategory(def: ItemDef): DayzCategory {
  if (def.throw) return 'explosives';
  switch (def.category) {
    case 'weapon': case 'ammo': case 'magazine': case 'attachment': return 'weapons';
    case 'food': case 'drink': return 'food';
    case 'stash': return 'containers';
    // (a pack is a container to DayZ, and the rest of what is worn is clothes)
    case 'clothing': return def.wear?.cargo && def.slot === 'back' ? 'containers' : 'clothes';
    default: return 'tools';
  }
}

// ---- the kinds of building, and how things lean among them

/** where people lived */
export const HOMES: Usage[] = ['Village', 'Town'];
/** sheds, barns, garages and yards, and a hunter's cabin: where the tools are */
export const SHEDS: Usage[] = ['Farm', 'Hunting', 'Industrial'];
export const ARMY: Usage[] = ['Military', 'Police'];
/** guns were kept in the armoury and at the army's posts; food in the shop before anywhere */
export const ARMOURY = { Police: 12, Military: 7 };
/** loose rounds: where guns were kept before anywhere, a hunter's cabin next, and a handful in a house */
export const ROUNDS = { Police: 12, Military: 8, Hunting: 2 };
export const LARDER = { Shop: 6 };
/**
 * A gun or what it fires that is taken is put back at the next restock, not once the map is well short.
 * (Weapons and what they fire come back fast: a gun taken off a shelf is back somewhere on its step within
 * three minutes, rounds within two. At seven minutes for a rifle a busy server ran dry.)
 */
export const SOON = 0.95;
/**
 * Kamenka has one small police station and a few army posts, and they are full of what only they keep. So what the
 * town is for, the pistols and the submachine gun and what feeds them, lies in its houses nearly as readily as
 * where guns were kept: there, the town itself is the armoury.
 */
export const IN_TOWN = { favour: { Police: 3, Military: 1.5 } };
/** past the outskirts, a tool lies in a shed and nowhere else */
export const IN_SHEDS: TypeRule['on'] = { 2: { usage: SHEDS }, 3: { usage: SHEDS } };
