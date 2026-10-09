// Central Economy, modelled on DayZ's types.xml: every item type has a world-wide
// nominal (target) count, a minimum that triggers restocking, a lifetime after which
// untouched loot despawns, and usage tags that decide which buildings it spawns in.
// The economy controls *world supply* precisely, which is also what a scarce,
// redeemable item needs (nominal 1, long restock, tight usage).
//
// Runs on the server in multiplayer (clients only mirror it through inject / take)
// and in the browser when playing offline.

import type { Usage, LootPoint } from '../world/buildings';
import { ITEMS, fitAtRandom, makeItem, type ItemInstance } from './items';
import { fitsPoint } from './placement';
import { RNG } from '../core/noise';

export interface TypeRule {
  nominal: number;
  min: number;
  lifetime: number; // seconds
  restock: number; // seconds
  usage: Usage[];
  qty?: [number, number]; // stack quantity range as fraction of max stack
  loaded?: [number, number]; // rounds loaded for weapons
  /** how much likelier a point of that kind of building is to get it (1 when not listed) */
  favour?: Partial<Record<Usage, number>>;
  /**
   * How many more are kept under the gas, wherever there it will lie (nothing there is sorted
   * by kind of building: everything is to be had in the works). `nominal` and `min` are for the
   * rest of the map, and what is under the gas is over and above them.
   */
  gas?: number;
}

/**
 * Under the gas nothing stays gone for long: whatever is taken there is put back within this
 * many seconds, however slowly its sort comes back on the rest of the map. It is the richest
 * place there is, and a mask is what it costs.
 */
export const GAS_RESTOCK = 420;

/** every kind of building there is */
const ANYWHERE: Usage[] = ['Village', 'Town', 'Farm', 'Industrial', 'Military', 'Hunting', 'Medic', 'Police'];
/** guns turn up everywhere, but the armoury and the army's posts are where they were kept */
const ARMOURY = { Police: 12, Military: 5, Hunting: 2 };

/**
 * What is left at an armed loot point (the first building of every outlying place, the
 * guard posts, the police armoury): always something to fight with, put back a few
 * minutes after it is taken. [item, weight]
 */
const ARMS: [string, number][] = [['p38', 2.4], ['m9', 1.8], ['mosin', 1.2], ['hatchet', 1.6], ['bat', 1.6], ['crowbar', 1.4], ['machete', 1.4], ['knife', 1]];
/** seconds an armed point stays bare once its weapon has been taken */
export const ARMS_RESTOCK = 180;

// (How many of each: set for the map as it is now, with the clinic, the shops, the barracks and
// the two places built later. There are half as many places again to put things as there
// were, and with what there was to put in them four in every nine stood empty.
// `npx tsx scripts/loot-audit.ts` says what the rules come to.)
export const TYPES: Record<string, TypeRule> = {
  // firearms: the police station in the middle of the map and the military checkpoint
  // firearms: in any building, far more of them in the police station in the middle of the
  // map and at the army's posts
  // Weapons and what they fire come back fast: a gun taken off a shelf is back somewhere on
  // the map within three minutes, rounds within two. (At seven minutes for a rifle, and none
  // of it restocked until a third of the map's supply was gone, a busy server ran dry: people
  // who played fast were out of ammunition for good.) `min` one under `nominal` means every
  // one taken is put back at the next restock, not only once the world is well short.
  mosin: { nominal: 16, min: 15, lifetime: 7200, restock: 180, usage: ANYWHERE, favour: ARMOURY, loaded: [1, 4], gas: 5 },
  p38: { nominal: 16, min: 15, lifetime: 7200, restock: 180, usage: ANYWHERE, favour: ARMOURY, loaded: [2, 6], gas: 3 },
  // the service pistol, with nearly twice the magazine: as easy to come by as the other one
  // (at half as many, and in half the kinds of building, nobody could find one)
  m9: { nominal: 16, min: 15, lifetime: 7200, restock: 180, usage: ANYWHERE, favour: ARMOURY, loaded: [3, 10], gas: 4 },
  // loose rounds turn up in handfuls; sealed boxes are the real find
  ammo_762: { nominal: 36, min: 35, lifetime: 3600, restock: 120, usage: ANYWHERE, favour: ARMOURY, qty: [0.25, 0.6], gas: 4 },
  ammo_9mm: { nominal: 46, min: 45, lifetime: 3600, restock: 120, usage: ANYWHERE, favour: ARMOURY, qty: [0.25, 0.6], gas: 4 },
  box_762: { nominal: 14, min: 13, lifetime: 3600, restock: 180, usage: ['Military', 'Police', 'Hunting', 'Farm', 'Industrial'], favour: ARMOURY, gas: 6 },
  box_9mm: { nominal: 18, min: 17, lifetime: 3600, restock: 180, usage: ['Police', 'Military', 'Town', 'Village'], favour: ARMOURY, gas: 6 },
  // The Desert Eagle, and what it fires, are of the gas and nowhere else: `nominal` 0 and no
  // kind of building, so not one is ever put down on the rest of the map.
  deagle: { nominal: 0, min: 0, lifetime: 7200, restock: 600, usage: [], loaded: [2, 7], gas: 3 },
  ammo_50: { nominal: 0, min: 0, lifetime: 3600, restock: 300, usage: [], qty: [0.4, 0.9], gas: 6 },
  box_50: { nominal: 0, min: 0, lifetime: 3600, restock: 420, usage: [], gas: 3 },
  mag_deagle_ext: { nominal: 0, min: 0, lifetime: 7200, restock: 1200, usage: [], gas: 1 },
  // attachments
  suppressor_762: { nominal: 0, min: 0, lifetime: 7200, restock: 1800, usage: [], gas: 2 },
  red_dot: { nominal: 1, min: 1, lifetime: 7200, restock: 1800, usage: ['Police'], gas: 3 },
  // (not in the police station: its few shelves are where the gas masks are kept, and a mask that has nowhere to lie is a gas nobody can enter)
  gun_light: { nominal: 3, min: 2, lifetime: 3600, restock: 900, usage: ['Military', 'Industrial'], gas: 3 },
  mag_m9_ext: { nominal: 2, min: 1, lifetime: 7200, restock: 1200, usage: ['Military'], gas: 2 },
  // (the scope is a thing of the gas: five are kept there, and one on all the rest of the map)
  pu_scope: { nominal: 1, min: 1, lifetime: 7200, restock: 1800, usage: ['Police', 'Military'], gas: 5 },
  rifle_wrap: { nominal: 2, min: 1, lifetime: 7200, restock: 1500, usage: ['Military', 'Hunting'], gas: 2 },
  suppressor_9: { nominal: 2, min: 1, lifetime: 7200, restock: 1800, usage: ['Police'], gas: 2 },
  mag_p38_ext: { nominal: 3, min: 1, lifetime: 7200, restock: 1200, usage: ['Police', 'Military'], gas: 3 },
  // melee
  hatchet: { nominal: 12, min: 10, lifetime: 3600, restock: 180, usage: ANYWHERE, favour: { Farm: 2, Hunting: 2 } },
  machete: { nominal: 10, min: 8, lifetime: 3600, restock: 180, usage: ANYWHERE, favour: { Farm: 2 } },
  crowbar: { nominal: 12, min: 10, lifetime: 3600, restock: 180, usage: ANYWHERE, favour: { Industrial: 2 } },
  bat: { nominal: 12, min: 10, lifetime: 3600, restock: 180, usage: ANYWHERE, favour: { Village: 2, Town: 2 } },
  knife: { nominal: 18, min: 15, lifetime: 3600, restock: 180, usage: ANYWHERE, gas: 1 },
  // food and drink
  sprats: { nominal: 14, min: 8, lifetime: 2400, restock: 300, usage: ['Village', 'Town'] },
  condensed: { nominal: 8, min: 4, lifetime: 2400, restock: 300, usage: ['Village', 'Town', 'Military'], gas: 1 },
  beans: { nominal: 14, min: 8, lifetime: 2400, restock: 300, usage: ['Village', 'Town', 'Farm'], gas: 1 },
  tomatoes: { nominal: 8, min: 4, lifetime: 2400, restock: 300, usage: ['Village', 'Farm'] },
  sardines: { nominal: 11, min: 6, lifetime: 2400, restock: 300, usage: ['Village', 'Town', 'Hunting'], gas: 1 },
  apple: { nominal: 8, min: 4, lifetime: 1200, restock: 300, usage: ['Village', 'Farm'] },
  milk: { nominal: 6, min: 3, lifetime: 1800, restock: 300, usage: ['Village', 'Town'] },
  // (there was a third as much to drink on the map as to eat, and thirst runs as fast as hunger)
  water_jug: { nominal: 11, min: 6, lifetime: 2400, restock: 300, usage: ['Village', 'Town', 'Farm', 'Industrial'], gas: 1 },
  flask: { nominal: 9, min: 5, lifetime: 2400, restock: 300, usage: ['Military', 'Hunting', 'Village', 'Farm'], gas: 2 },
  thermos: { nominal: 8, min: 4, lifetime: 2400, restock: 300, usage: ['Military', 'Hunting', 'Village', 'Police', 'Industrial'], gas: 1 },
  // medical
  // What stops bleeding is what a fight is lost for want of: twelve things on the whole map
  // was too few of it. More, sooner back, and most of it where it was kept: the clinic.
  bandage: { nominal: 20, min: 13, lifetime: 2400, restock: 240, usage: ['Village', 'Town', 'Military', 'Medic', 'Police', 'Hunting', 'Farm'], favour: { Medic: 6, Military: 2 }, gas: 4 },
  firstaid: { nominal: 8, min: 4, lifetime: 3600, restock: 600, usage: ['Military', 'Medic', 'Town', 'Police'], favour: { Medic: 8 }, gas: 3 },
  // (what sets a broken leg and does nothing else: commoner than the kit, and where there are ladders and lofts to fall off)
  splint: { nominal: 12, min: 7, lifetime: 3600, restock: 420, usage: ['Medic', 'Village', 'Town', 'Farm', 'Hunting', 'Industrial', 'Police'], favour: { Medic: 5 }, gas: 2 },
  // clothing and bags: this is how you carry more
  // (The helmet and the plates are things of the gas too: seven of each are kept there, and
  // two of each on all the rest of the map.)
  // (What these are now is a soldier's kit, and their rules were written for a sun hat, a
  // life jacket and a pair of rubber boots: plates were found in a cow shed and never at an
  // army post. They are still about the farms, where people took them; most are where they were issued.)
  boonie_hat: { nominal: 2, min: 1, lifetime: 3600, restock: 900, usage: ['Village', 'Farm', 'Hunting', 'Military'], favour: { Military: 3 }, gas: 7 },
  // (The mask is what lets anybody into the gas, so it is not kept IN the gas, where most of
  // the army's things are: it is in the police station, and the three of them there are
  // what the whole map has to share, bar what a crate or a supply drop turns up.)
  gasmask: { nominal: 3, min: 2, lifetime: 3600, restock: 900, usage: ['Police'] },
  life_vest: { nominal: 2, min: 1, lifetime: 3600, restock: 900, usage: ['Military', 'Police', 'Industrial', 'Town'], favour: { Military: 5, Police: 5 }, gas: 7 },
  work_gloves: { nominal: 5, min: 3, lifetime: 3600, restock: 900, usage: ['Farm', 'Industrial', 'Village', 'Military', 'Police'], favour: { Military: 2 } },
  rubber_boots: { nominal: 5, min: 3, lifetime: 3600, restock: 900, usage: ['Farm', 'Village', 'Military', 'Industrial'], favour: { Military: 2 } },
  sack_pack: { nominal: 8, min: 4, lifetime: 3600, restock: 600, usage: ['Village', 'Town', 'Farm', 'Industrial', 'Military', 'Hunting'], gas: 1 },
  suitcase: { nominal: 4, min: 2, lifetime: 3600, restock: 1200, usage: ['Village', 'Town', 'Military', 'Hunting'], favour: { Military: 3 }, gas: 1 },
  // tools and odds and ends
  binoculars: { nominal: 3, min: 1, lifetime: 3600, restock: 1200, usage: ['Military', 'Hunting', 'Police'], gas: 1 },
  compass: { nominal: 4, min: 2, lifetime: 3600, restock: 1200, usage: ['Military', 'Hunting', 'Village'] },
  cigarettes: { nominal: 8, min: 3, lifetime: 2400, restock: 600, usage: ['Village', 'Town', 'Military', 'Industrial'] },
  grenade: { nominal: 4, min: 2, lifetime: 3600, restock: 1200, usage: ['Military', 'Police'], gas: 5 },
  stash_kit: { nominal: 3, min: 1, lifetime: 7200, restock: 1800, usage: ['Farm', 'Industrial', 'Hunting'] },
  // fuel for the jeeps (src/sim/vehicles.ts): where there are sheds, yards and soldiers
  jerrycan: { nominal: 8, min: 5, lifetime: 3600, restock: 600, usage: ['Farm', 'Industrial', 'Military', 'Village'], gas: 1 },
};

/** what is put down before anything else when a world is stocked: the masks, which are what lets anybody into the gas */
const FIRST = ['gasmask'];

export interface WorldLoot {
  uid: string;
  item: ItemInstance;
  x: number;
  y: number;
  z: number;
  rot: number;
  point: number; // loot point index, -1 for player-dropped
  spawnedAt: number;
}

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

  /**
   * Which loot points are under the gas. They are stocked apart from the rest of the map, to
   * counts of their own (`gas` in a rule): the works were added to the map, and what lies in
   * them is over and above what the map held before.
   */
  private gasPoint: boolean[];

  constructor(
    private points: LootPoint[],
    private events: EconomyEvents,
    /** can this item type physically lie at this loot point? */
    private fits: (id: string, p: LootPoint) => boolean = fitsPoint,
  ) {
    this.gasPoint = points.map((p) => p.usage.includes('Gas'));
  }

  /** Count of a type currently in the world (on the ground). */
  count(id: string) {
    let n = 0;
    for (const l of this.loot.values()) if (l.item.id === id) n++;
    return n;
  }

  /** how many of a sort lie under the gas, or on the rest of the map (what a player has put down counts with the rest of the map) */
  held(id: string, gas: boolean) {
    let n = 0;
    for (const l of this.loot.values()) if (l.item.id === id && (l.point >= 0 && this.gasPoint[l.point]) === gas) n++;
    return n;
  }

  private pickPoint(id: string, rule: TypeRule, gas: boolean): number {
    const candidates: number[] = [];
    const weights: number[] = [];
    let total = 0;
    this.points.forEach((p, i) => {
      // armed points are stocked on their own (see arm)
      if (p.arms || this.pointBusy.has(i) || this.gasPoint[i] !== gas) return;
      // (under the gas a thing lies wherever it will: the kind of building is not asked)
      if (!gas && !p.usage.some((u) => rule.usage.includes(u))) return;
      // a rifle never spawns on a narrow shelf, a jerrycan never on a barrel
      if (!this.fits(id, p)) return;
      let w = 1;
      if (!gas && rule.favour) for (const u of p.usage) w = Math.max(w, rule.favour[u] ?? 1);
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

  private spawnType(id: string, at = -1, gas = false): boolean {
    const rule = TYPES[id];
    const def = ITEMS[id];
    const pi = at >= 0 ? at : this.pickPoint(id, rule, gas);
    if (pi < 0) return false;
    const p = this.points[pi];
    const item = makeItem(id);
    if (def.stack && rule.qty) item.qty = Math.max(1, Math.round(def.stack * this.rng.range(rule.qty[0], rule.qty[1])));
    if (def.weapon && rule.loaded) item.loaded = this.rng.int(rule.loaded[0], Math.min(rule.loaded[1], def.weapon.capacity));
    if (def.weapon) fitAtRandom(item, () => this.rng.next());
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
      if (!p.arms) return;
      if (this.pointBusy.has(i)) {
        this.bare.delete(i);
        return;
      }
      if (!now) {
        if (!this.bare.has(i)) this.bare.set(i, this.time);
        if (this.time - this.bare.get(i)! < ARMS_RESTOCK) return;
      }
      // a few tries: a rifle will not lie on a shelf
      const table = p.arms === 'guns' ? ARMS.filter(([id]) => ITEMS[id].weapon) : ARMS;
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
    for (const id of FIRST) while (this.held(id, false) < TYPES[id].nominal && this.spawnType(id));
    // interleave types so scarce ones still find free points
    const ids = Object.keys(TYPES);
    let progress = true;
    while (progress) {
      progress = false;
      for (const id of ids) {
        const rule = TYPES[id];
        if (this.held(id, false) < rule.nominal && this.spawnType(id)) progress = true;
        if (this.held(id, true) < (rule.gas ?? 0) && this.spawnType(id, -1, true)) progress = true;
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

  /** Player picked an item up (or it was destroyed). */
  take(uid: string) {
    const l = this.loot.get(uid);
    if (!l) return null;
    this.loot.delete(uid);
    if (l.point >= 0) this.pointBusy.delete(l.point);
    this.events.despawn(l);
    return l;
  }

  /** Player dropped an item into the world. */
  drop(item: ItemInstance, x: number, y: number, z: number, rot: number) {
    const l: WorldLoot = { uid: item.uid, item, x, y, z, rot, point: -1, spawnedAt: this.time };
    this.loot.set(l.uid, l);
    this.events.spawn(l);
    return l;
  }

  /** Periodic tick: lifetime cleanup (never in sight of a player) and restocking. */
  tick(dt: number, players: { x: number; z: number }[]) {
    this.time += dt;
    const near = (l: WorldLoot) => players.some((p) => Math.hypot(l.x - p.x, l.z - p.z) < 60);
    for (const l of [...this.loot.values()]) {
      const rule = TYPES[l.item.id];
      const life = rule ? rule.lifetime : 3600;
      if (this.time - l.spawnedAt > life && !near(l)) this.take(l.uid);
    }
    this.arm();
    for (const [id, rule] of Object.entries(TYPES)) {
      this.restock(id, false, rule.nominal, rule.min, rule.restock);
      // (under the gas every one that is gone is put back, and soon)
      if (rule.gas) this.restock(id, true, rule.gas, rule.gas, Math.min(rule.restock, GAS_RESTOCK));
    }
  }

  /** Puts a sort back up to `want` where fewer than `least` of it are left, no oftener than `every` seconds. */
  private restock(id: string, gas: boolean, want: number, least: number, every: number) {
    const n = this.held(id, gas);
    if (n >= least) return;
    const key = gas ? `${id}@gas` : id;
    if (this.time - (this.lastRestock[key] ?? -1e9) < every) return;
    this.lastRestock[key] = this.time;
    for (let k = n; k < want; k++) if (!this.spawnType(id, -1, gas)) break;
  }

  serialize() {
    return { time: this.time, lastRestock: this.lastRestock, loot: [...this.loot.values()] };
  }
}
