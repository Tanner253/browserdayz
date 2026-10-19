// Central Economy, modelled on DayZ's types.xml: every item type has a world-wide
// nominal (target) count, a minimum that triggers restocking, a lifetime after which
// untouched loot despawns, and usage tags that decide which buildings it spawns in.
// The economy controls *world supply* precisely, which is also what a scarce,
// redeemable item needs (nominal 1, long restock, tight usage).
//
// Runs on the server in multiplayer (clients only mirror it through inject / take)
// and in the browser when playing offline.

import type { LootPoint, Usage } from '../world/buildings';
import type { Tier } from './tiers';
import { ITEMS, fitAtRandom, foundMag, holds, makeItem, plainMag, stockGun, TAG_GROUND, type ItemInstance } from './items';
import { bagGrid } from './inventory';
import { ITEM_SIZES, fitsPoint } from './placement';
import { RNG } from '../core/noise';
import { APART_FILL, APART_KIND, APART_LEAN, APART_LEAST, APART_RICH, OWN, apartOf } from './apart';

export { APART, APART_KIND, apartOf } from './apart';
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
 * The most of a building's spots that hold anything at once, by its step: DayZ's `lootmax` (a house of a dozen-odd
 * spots holds six things), so that no house is stuffed full and the rest bare. Under the gas and down the bunker every
 * place is spoken for, and a place apart has its own most (APART_FILL).
 */
const LOOTMAX: Record<Tier, number> = { 1: 0.8, 2: 0.8, 3: 1, 4: 1, 5: 1 };
/** the kinds of building that keep no most: a shop, a clinic, the police and the army are meant to be full of what they keep (the outskirts' shop held at 24 of its 30 shelves went short of water) */
const FULL_KINDS = new Set<Usage>(['Shop', 'Medic', 'Hospital', 'Police', 'Military']);
/**
 * How much likelier a weapon is to be put down next than anything else as far short (see `fill`). DayZ lays its guns
 * in a container of their own and they never want for room; here they lie where everything else does, and where every
 * place is spoken for (the bunker: 175 things wanted on 145 spots) a gun is what a place is fought over: the dressings
 * are what goes short, not the shotgun.
 */
const ARMS_FIRST = 1000;
/**
 * And how much sooner what a step is FOR is put down there, by how much the step is its home (squared: see
 * Economy.home): under the gas its helmets and scopes before a dressing that every village has, and down the bunker
 * what is the bunker's and nobody else's before anything.
 */
const HOME = 1000;
/**
 * How much sooner a sort is put down for every whole of its free spots it still needs (see `fill`): one that can lie
 * only where the army kept things is put there before a pistol, which can lie in a house as well, has taken the last
 * of them.
 */
const PRESSED = 50;
/** floors are kept for what lies only on a floor when that wants this share of the free ones (see `fill`) */
const FLOORS_SCARCE = 0.6;
/** what a pack or a case is found with in it: supplies (see `pack`) */
const SUPPLIES = new Set(['food', 'drink', 'medical', 'ammo', 'tool', 'misc', 'clothing']);
/** a step of the map's own spots, or a place apart's on it, as one key */
const group = (place: string | null, t: Tier) => `${place ?? ''}@${t}`;

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
  /** the place apart each loot point belongs to, if it belongs to one (see APART): null for the map's own */
  private apart: (string | null)[];
  /** the places apart there are, and how many of each sort each is stocked to on each step (`place|sort@step`) */
  private places: string[];
  private wants = new Map<string, number>();
  /** the building each spot is of (an index; -1: an armed spot, or a place apart's, which keep no building's most), and each building's most and what it holds (see LOOTMAX) */
  private bld: number[];
  private bldMax: number[] = [];
  private bldHeld: number[] = [];
  /** the buildings (by name) with a place on a shelf or a table: food is kept off their floors */
  private shelved: Set<string>;
  /** what lies on each spot, and the spots in each piece of furniture (by its uid): an emptied one is filled offline from
   * its own spots, not from a look through all the loot for each (a hitch every five minutes) */
  private atPoint = new Map<number, WorldLoot>();
  private furnished = new Map<string, number[]>();
  /** each spot's step (and place apart) as a key, and the spots of each, in order: a count looks at its own, not at all of them for each step */
  private groupOf: string[];
  private groups = new Map<string, number[]>();

  constructor(
    readonly points: LootPoint[],
    private events: EconomyEvents,
    /** can this item type physically lie at this loot point? */
    private fits: (id: string, p: LootPoint) => boolean = fitsPoint,
  ) {
    this.tier = points.map((p) => p.tier ?? (p.usage.includes('Bunker') ? 5 : p.usage.includes('Gas') ? 4 : p.usage.includes('East') ? 3 : 1));
    this.apart = points.map((p) => apartOf(p.building));
    this.shelved = new Set(points.filter((p) => !p.floor).map((p) => p.building));
    this.groupOf = points.map((_, i) => group(this.apart[i], this.tier[i]));
    points.forEach((p, i) => {
      if (p.inside) (this.furnished.get(p.inside) ?? this.furnished.set(p.inside, []).get(p.inside)!).push(i);
      const g = this.groupOf[i];
      (this.groups.get(g) ?? this.groups.set(g, []).get(g)!).push(i);
    });
    const named = new Map<string, number>(), step: Tier[] = [];
    this.bld = points.map((p, i) => {
      if (p.arms || p.keeps || this.apart[i] !== null || p.usage.some((u) => FULL_KINDS.has(u))) return -1;
      let b = named.get(p.building);
      if (b === undefined) {
        named.set(p.building, (b = named.size));
        this.bldMax.push(0);
        this.bldHeld.push(0);
        step.push(this.tier[i]);
      }
      this.bldMax[b]++;
      return b;
    });
    this.bldMax = this.bldMax.map((n, b) => (n <= 2 ? n : Math.ceil(n * LOOTMAX[step[b]])));
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
    this.spots = STEPS.map((t) => this.points.filter((p, i) => this.tier[i] === t && this.apart[i] === null && !p.arms && !p.keeps).length);
    // (every step's cut worked out from the counts as written, and only then made)
    for (const [t, cut] of STEPS.map((t) => [t, this.fit(t)] as const)) for (const [id, k] of cut) this.cuts.set(`${id}@${t}`, k);
    this.places = [...new Set(this.apart.filter((a): a is string => a !== null))];
    for (const place of this.places) for (const t of STEPS) this.share(place, t);
  }

  private counts = new Map<string, number[]>();
  /** how many places of the map's own each step has (not an armed one, nor one that keeps a named thing) */
  private spots: number[] = [];

  /**
   * How much a step is a sort's home: of how thickly it lies on each step (its count over the step's places), the
   * share that is this step's. The helmet lies five in Kamenka and the village and five under the gas, and the gas has
   * a thirteenth of their places: it is the gas's. (A dressing every village has is nobody's in particular.)
   */
  private home(id: string, t: Tier): number {
    const thick = (s: Tier) => (this.spots[s - 1] ? this.written(id, s) / this.spots[s - 1] : 0);
    const all = STEPS.reduce((n, s) => n + thick(s), 0);
    return all ? thick(t) / all : 0;
  }

  /**
   * A step asked for more than it has places is stocked to what it holds: every sort is cut to fit, none below one, and
   * what the step is for least (a sort whose home it is, see `home`: the keycards under the gas, its rifles and helmets,
   * the bunker's own), and a dressing that every village has most. (2026-10-17: the gas was asked for 165 things on its 127 places and the bunker
   * for 175 on its 145, and whatever came last went without: which that was hung on the order things were put down
   * in.) What the counts then say is what lies there. @returns the cut counts, [sort, how many]
   */
  private fit(t: Tier): [string, number][] {
    const room = this.spots[t - 1];
    const ids = Object.keys(TYPES).filter((id) => this.written(id, t) > 0);
    const asked = ids.reduce((n, id) => n + this.written(id, t), 0);
    if (asked <= room) return [];
    // (each sort's share of the room by its count, the more as the step is its home: its own are cut least, and none
    // below one; then a thing less of the most-kept of what is not its own while there are too many)
    const weight = (id: string) => this.written(id, t) * (1 + this.home(id, t)) ** 2;
    const all = ids.reduce((n, id) => n + weight(id), 0);
    const cut = ids.map((id) => {
      const x = Math.min(this.written(id, t), (weight(id) * room) / all);
      return { id, n: Math.max(1, Math.floor(x)), rest: x - Math.floor(x) };
    });
    let left = room - cut.reduce((n, c) => n + c.n, 0);
    for (const c of [...cut].sort((p, q) => q.rest - p.rest || (p.id < q.id ? -1 : 1))) {
      if (left <= 0) break;
      if (c.n < this.written(c.id, t)) (c.n++, left--);
    }
    while (left < 0) {
      const most = cut.filter((c) => c.n > 1).sort((p, q) => this.home(p.id, t) - this.home(q.id, t) || q.n - p.n)[0];
      if (!most) break;
      most.n--;
      left++;
    }
    return cut.map((c): [string, number] => [c.id, c.n]);
  }

  /** what a step asked for more than it holds keeps of a sort (`sort@step`): see `fit` */
  private cuts = new Map<string, number>();
  /** how many of a sort are kept on a step: its `at`, or what its rate comes to on this map (see TypeRule.per), cut to the step's places (see `fit`) */
  kept(id: string, t: Tier): number {
    return this.cuts.get(`${id}@${t}`) ?? this.written(id, t);
  }
  /** and as its rule has it, before any cut: what a place apart's share is reckoned from, being stocked on top of the map, and a crate's (DayZ's nominal) */
  written(id: string, t: Tier): number {
    return this.counts.get(id)?.[t - 1] ?? TYPES[id].at[t - 1];
  }

  /** how strongly a spot draws a sort on a step (its kind of building's favour) */
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
      const at = this.written(id, t);
      if (!at) continue;
      const sum = (list: number[]) => list.reduce((a, i) => a + (this.liesAt(id, rule, i, t) ? this.pull(rule, i, t) : 0), 0);
      const mine = sum(here), theirs = sum(there);
      if (mine > 0) fair.push([id, Math.min(at, (theirs > 0 ? (at * mine) / theirs : at) * (OWN[place]?.rich ?? APART_RICH) * ((OWN[place]?.lean ?? APART_LEAN)[id] ?? 1))]);
    }
    // (What it is never without is taken out of the room there is first: `sure` of each sort. What each sort's share
    // comes to over that is its `spare`, and the spares fill what room is left, cut down alike if there is not
    // enough of it.)
    const least = t >= 4 ? APART_LEAST[place] ?? {} : {};
    const base = fair.map(([id, e]) => {
      const sure = Math.min(least[id] ?? 0, this.written(id, t));
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
    // (DayZ's floor takes tools, clothes and what things are kept in, and its shelves food as well: a tin is on a shelf.
    // A jug or a flask may stand on a floor, most being too big for a shelf: kept off the floor, the shops went short of
    // water. Where there is no shelf at all, a root cellar or a wreck, a tin lies on the floor: the cellars had no food.
    // And a shop's floor is where its stock stands: "the store should spawn supplies and food, and water".)
    if (p.floor && this.shelved.has(p.building) && ITEMS[id].category === 'food' && !p.usage.includes('Shop')) return false;
    // a rifle never spawns on a narrow shelf, a jerrycan never on a barrel
    return this.fits(id, p);
  }

  /** a spot is taken, or given up: its building's count goes with it (see LOOTMAX) */
  private occupy(i: number, on: boolean) {
    if (on === this.pointBusy.has(i)) return;
    if (on) this.pointBusy.add(i);
    else this.pointBusy.delete(i);
    const b = this.bld[i];
    if (b >= 0) this.bldHeld[b] += on ? 1 : -1;
  }

  /** is there room for one more thing in the building this spot is of */
  private room(i: number): boolean {
    const b = this.bld[i];
    return b < 0 || this.bldHeld[b] < this.bldMax[b];
  }

  /**
   * Puts down what is due on one step, or in one place apart: a roll per spot (the owner, 2026-10-17: "a loot roll is
   * rolled for each spot when loot rerolls or respawns"). Every free spot there with room (its building under its
   * most, nobody near, not just looted) is rolled for among the sorts that are short and can lie on it: each sort as
   * likely as it is short, the hard-pressed first (a rifle lies only on a floor, and where every place is spoken for the
   * floors are its before a tin's), and a spot drawing what its kind of building favours. What lay at a spot comes back
   * to it only when there is nowhere else (see SAME_AGAIN). @returns how many of each were put down
   */
  private fill(where: Tier, place: string | null, due: Map<string, number>): Map<string, number> {
    const put = new Map<string, number>();
    const ids = [...due.keys()].filter((id) => due.get(id)! > 0);
    if (!ids.length) return put;
    const open = new Set<number>(), inBld = new Map<number, number[]>();
    for (const i of this.groups.get(group(place, where)) ?? []) {
      const p = this.points[i];
      if (p.arms || p.keeps || this.pointBusy.has(i) || this.crowded.has(i) || !this.room(i) || !this.rested(i)) continue;
      open.add(i);
      if (this.bld[i] >= 0) (inBld.get(this.bld[i]) ?? inBld.set(this.bld[i], []).get(this.bld[i])!).push(i);
    }
    // where each sort can lie; and where it could but for having lain there last, where it goes when there is nowhere else
    const at = ids.map(() => [] as number[]), again = ids.map(() => [] as number[]);
    const sorts = new Map<number, number[]>();
    ids.forEach((id, k) => {
      for (const i of open) {
        if (!this.liesAt(id, TYPES[id], i, where)) continue;
        const was = this.lastAt.get(i);
        (was && was.id === id && this.time - was.at < SAME_AGAIN ? again[k] : at[k]).push(i);
        (sorts.get(i) ?? sorts.set(i, []).get(i)!).push(k);
      }
    });
    const n = at.map((a) => a.length), m = again.map((a) => a.length);
    // (where the floors are wanted by most of what lies only on a floor, they are kept for it: see below)
    const floorOnly = (k: number) => [...at[k], ...again[k]].every((i) => this.points[i].floor);
    const floors = [...open].filter((i) => this.points[i].floor).length;
    const scarce = ids.reduce((a, id, k) => a + (floorOnly(k) ? due.get(id)! : 0), 0) >= floors * FLOORS_SCARCE;
    // (how sought after each spot is: of every sort that can lie on it, how much of its room it needs. A pistol, which can
    // lie in a house as well, keeps off a police station's shelf that the rifles' rounds have nowhere else to go than)
    const need = new Map<number, number>();
    for (const [i, ks] of sorts) need.set(i, ks.reduce((a, k) => a + due.get(ids[k])! / Math.max(1, n[k] || m[k]), 0));
    const want = ids.map((id) => Math.max(due.get(id)!, place ? this.wanted(place, id, where) : this.kept(id, where)));
    const armed = ids.map((id) => !!(ITEMS[id].weapon || ITEMS[id].melee));
    // (and what this step is for, the more of the map's that lie on it: "the bunker's and nobody else's" before the rest)
    const home = ids.map((id) => HOME * this.home(id, where) ** 2);
    const close = (i: number) => {
      if (!open.delete(i)) return;
      for (const k of sorts.get(i) ?? []) {
        const was = this.lastAt.get(i);
        if (was && was.id === ids[k] && this.time - was.at < SAME_AGAIN) m[k]--;
        else n[k]--;
      }
    };
    for (;;) {
      let total = 0;
      const w = ids.map((id, k) => {
        const left = due.get(id)! - (put.get(id) ?? 0), room = n[k] || m[k];
        const x = left > 0 && room > 0 ? (left / want[k]) ** 6 * (1 + PRESSED * (left / room)) * (1 + (armed[k] ? ARMS_FIRST : 0) + home[k]) : 0;
        total += x;
        return x;
      });
      if (total <= 0) break;
      let r = this.rng.next() * total, k = 0;
      for (; k < ids.length - 1; k++) if ((r -= w[k]) <= 0) break;
      const id = ids[k], list = (n[k] ? at[k] : again[k]).filter((i) => open.has(i));
      // (where floors are scarce, a thing that will lie on a shelf takes a shelf while there is one free: the floors are
      // the rifles'. Only made less likely, a tin took a floor one time in seven, and under the gas its rifles went short
      // of floors; kept so everywhere, the shops' floors stood empty and the shops went short of water.)
      const shelf = scarce && list.some((i) => !this.points[i].floor);
      let pulls = 0;
      const pw = list.map((i) => {
        const x = shelf && this.points[i].floor ? 0 : this.pull(TYPES[id], i, where) / (need.get(i) || 1);
        pulls += x;
        return x;
      });
      let q = this.rng.next() * pulls, j = 0;
      for (; j < list.length - 1; j++) if ((q -= pw[j]) <= 0) break;
      const i = list[j];
      close(i);
      if (!this.spawnType(id, i, where, false, place)) continue;
      put.set(id, (put.get(id) ?? 0) + 1);
      // (a building at its most takes nothing more)
      if (!this.room(i)) for (const o of inBld.get(this.bld[i]) ?? []) close(o);
    }
    return put;
  }

  /** @param armed the spot is one that always holds a weapon (see `arm`): what is put there is a gun that fires */
  private spawnType(id: string, pi: number, where: Tier = 1, armed = true, _place: string | null = null): boolean {
    const rule = TYPES[id];
    const def = ITEMS[id];
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
    const filled = def.loot?.filled;
    if (filled && this.rng.next() < filled.chance) this.pack(item, pi, where, filled.most);
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
    this.occupy(pi, true);
    this.atPoint.set(pi, l);
    this.loot.set(l.uid, l);
    this.events.spawn(l);
    return true;
  }

  /**
   * Puts a few things in a pack or a case found at a spot (its `loot.filled`): supplies its step and its kind of
   * building keep, each as likely as it is kept there, small enough for a pocket of it. Not a gun, a part of one, a grenade or another bag, and nothing kept by
   * twos and threes (a keycard in a bag would be a keycard more than the gas keeps). What is in a bag is not counted to
   * the map, as DayZ counts no cargo.
   */
  private pack(bag: ItemInstance, i: number, where: Tier, most: number) {
    const grid = bagGrid(bag);
    if (!grid) return;
    const pool: [string, number][] = [];
    for (const [id, rule] of Object.entries(TYPES)) {
      const d = ITEMS[id], n = this.kept(id, where);
      if (n < 3 || !SUPPLIES.has(d.category) || holds(id) || d.throw || d.w * d.h > 4) continue;
      const kinds = rule.on?.[where]?.usage ?? rule.usage;
      if (where < UNSORTED && !this.points[i].usage.some((u) => kinds.includes(u))) continue;
      pool.push([id, n]);
    }
    for (let k = this.rng.int(1, most); k > 0 && pool.length; k--) {
      const total = pool.reduce((a, [, w]) => a + w, 0);
      let r = this.rng.next() * total, j = 0;
      for (; j < pool.length - 1; j++) if ((r -= pool[j][1]) <= 0) break;
      const it = makeItem(pool[j][0]), d = ITEMS[it.id], q = TYPES[it.id].qty;
      if (d.stack && q) it.qty = Math.max(1, Math.round(d.stack * this.rng.range(q[0], q[1])));
      grid.add(it);
    }
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
    for (const t of STEPS) this.fill(t, null, this.short(t, null));
    // (and each place apart, to its own counts, out of its own places)
    this.arm(true, 'apart');
    for (const place of this.places) for (const t of STEPS) this.fill(t, place, this.short(t, place));
  }

  /** what each sort is short of on a step, or in a place apart, against what is kept there */
  private short(t: Tier, place: string | null): Map<string, number> {
    const has = this.tally(t, place), due = new Map<string, number>();
    for (const id of Object.keys(TYPES)) {
      const want = place ? this.wanted(place, id, t) : this.kept(id, t);
      if (want > (has.get(id) ?? 0)) due.set(id, want - (has.get(id) ?? 0));
    }
    return due;
  }

  /** how many of each sort lie on a step, or in a place apart (as `held` counts them, all at once) */
  private tally(t: Tier, place: string | null): Map<string, number> {
    const n = new Map<string, number>();
    for (const l of this.loot.values()) if (l.point >= 0 && this.tier[l.point] === t && this.apart[l.point] === place) n.set(l.item.id, (n.get(l.item.id) ?? 0) + 1);
    return n;
  }

  /** every step's and place's tally at once, by `group`: one look through the loot a count, not one for each */
  private tallies(): Map<string, Map<string, number>> {
    const all = new Map<string, Map<string, number>>();
    for (const l of this.loot.values()) {
      if (l.point < 0) continue;
      const g = this.groupOf[l.point];
      if (g === undefined) continue;
      let n = all.get(g);
      if (!n) all.set(g, (n = new Map()));
      n.set(l.item.id, (n.get(l.item.id) ?? 0) + 1);
    }
    return all;
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
    if (l.point >= 0) {
      this.occupy(l.point, true);
      this.atPoint.set(l.point, l);
    }
    this.events.spawn(l);
  }

  /** what the economy has put in a piece of furniture (by its uid) */
  within(uid: string): WorldLoot[] {
    const out: WorldLoot[] = [];
    for (const i of this.furnished.get(uid) ?? []) {
      const l = this.atPoint.get(i);
      if (l) out.push(l);
    }
    return out;
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
      this.occupy(l.point, false);
      if (this.atPoint.get(l.point) === l) this.atPoint.delete(l.point);
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
    // (each restock puts things on its own step's spots only, so what every other one holds is as counted here)
    const all = this.tallies(), none = new Map<string, number>();
    for (const t of STEPS) this.restock(t, null, all.get(group(null, t)) ?? none);
    for (const place of this.places) for (const t of STEPS) this.restock(t, place, all.get(group(place, t)) ?? none);
  }

  /**
   * Puts back what is gone on a step, or in a place apart, by a roll per spot (see `fill`): each sort that is short and
   * whose wait is over. From Kamenka up, and in a place apart, every one that is gone is put back, and soon; below it,
   * once a share of them is gone (its `keep`). The wait runs from when it was first found short, which is within a
   * count of its being taken. (It ran from when its sort was last PUT BACK: a thing that had lain an hour came back
   * five seconds after it was taken, however long its rule said. Kamenka's one AK, "three quarters of an hour" coming
   * back, came straight back. Found on reading, twice over, 2026-10-13.)
   */
  private restock(t: Tier, place: string | null, has: Map<string, number>) {
    const due = new Map<string, number>(), least = new Map<string, number>();
    for (const { id, want, lo, wait, key } of this.asked(t, place)) {
      const n = has.get(id) ?? 0;
      if (n >= lo) {
        delete this.shortSince[key];
        continue;
      }
      const since = (this.shortSince[key] ??= this.time);
      if (this.time - since < wait) continue;
      due.set(id, want - n);
      least.set(id, lo - n);
    }
    // (the clock of a sort starts again when some of it has been put back; still short with nowhere for the rest just
    // now, a looted spot resting and its only other place taken, it is tried again at the next count)
    for (const [id, k] of this.fill(t, place, due)) {
      const key = place ? `${place}|${id}@${t}` : `${id}@${t}`;
      this.lastRestock[key] = this.time;
      if (k >= least.get(id)!) delete this.shortSince[key];
    }
  }

  /** the sorts kept on a step (or in a place apart there), how many, below how many it is restocked, after how long, and
   * its clock's key: fixed from the start, so worked out once (every sort on every step and place, a key made for each,
   * was most of what a count cost, every five seconds) */
  private asks = new Map<string, { id: string; want: number; lo: number; wait: number; key: string }[]>();
  private asked(t: Tier, place: string | null) {
    const at = group(place, t);
    let list = this.asks.get(at);
    if (list) return list;
    list = [];
    for (const [id, rule] of Object.entries(TYPES)) {
      const want = place ? this.wanted(place, id, t) : this.kept(id, t);
      if (!want) continue;
      const every = rule.on?.[t]?.restock;
      const soon = place !== null || t >= 3;
      const lo = soon ? want : Math.max(1, Math.ceil(want * (rule.keep ?? 0.6)));
      const wait = every ?? (soon ? Math.min(rule.restock, GAS_RESTOCK) : rule.restock);
      list.push({ id, want, lo, wait, key: place ? `${place}|${id}@${t}` : `${id}@${t}` });
    }
    this.asks.set(at, list);
    return list;
  }

  serialize() {
    return { time: this.time, lastRestock: this.lastRestock, loot: [...this.loot.values()] };
  }
}
