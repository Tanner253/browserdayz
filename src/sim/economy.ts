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
import { typeRule, type TypeRule } from './items/rules';

export type { TypeRule };

/**
 * Under the gas nothing stays gone for long: whatever is taken there is put back within this
 * many seconds, however slowly its sort comes back on the rest of the map. It is the richest
 * place there is, and a mask is what it costs. (Kamenka and the bunker are stocked as soon.)
 */
export const GAS_RESTOCK = 420;

/**
 * What is left at an armed loot point (the first building of every outlying place, the guard posts, the police
 * armoury, a tent of the army's camp): always something to fight with, put back a few minutes after it is taken.
 * On the outskirts that is something to hit with and never a gun; from the village on, a pistol where guns were
 * kept, and either elsewhere. [item, weight]
 */
const racked = (k: 'any' | 'town' | 'fort'): [string, number][] => Object.values(ITEMS).flatMap((d) => (d.loot?.rack?.[k] ? [[d.id, d.loot.rack[k]!] as [string, number]] : []));
const ARMS = racked('any');
/** and from Kamenka on, where guns were kept: the submachine gun before a pistol ("tier 3 should be submachine guns heavy") */
// (and the weapons pass's submachine guns, the owner, 2026-10-17: "ensure that the new weapons can spawn at T3+")
const ARMS_TOWN = racked('town');
/**
 * And on the racks of a place apart on the fourth step, the fort's armoury: the army's rifles. (The submachine gun
 * was the likeliest of them until the owner had climbed to it, 2026-10-13: "the loot in the castle should be a bit
 * better i think". A rack at the top of a mountain holds a rifle two times in three.)
 */
// (and the weapons pass's: its rifles, its short AK and its MP7 on the fort's racks too)
const ARMS_FORT = racked('fort');
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
export const TYPES: Record<string, TypeRule> = Object.fromEntries(Object.values(ITEMS).flatMap((d) => {
  const r = typeRule(d);
  return r ? [[d.id, r]] : [];
}));

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
const APART_LEAN: Record<string, number> = Object.fromEntries(Object.values(ITEMS).flatMap((d) => (d.loot?.lean ? [[d.id, d.loot.lean]] : [])));

/** what a named place apart never has less of on its fourth step, whatever its shares come to (where it has a spot of the kind): a magazine for each rifle of its racks, and a dressing station's own */
const APART_LEAST: Record<string, Record<string, number>> = {
  castle: { mag_ak: 2, mag_ar: 2, mag_sniper: 1, pu_scope: 1, suppressor_762: 1, grenade: 2, armor_vest: 1, stim_combat: 2, blood_bag: 2, saline: 1, firstaid: 2 },
};
/**
 * The kind of spot a sort lies at in a place apart, where it has no kind of its own (under the gas such a thing
 * lies anywhere, and a place apart is sorted on every step: so it lay nowhere in one).
 */
export const APART_KIND: Record<string, Usage[]> = Object.fromEntries(Object.values(ITEMS).flatMap((d) => (d.loot?.apart ? [[d.id, d.loot.apart]] : [])));

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
