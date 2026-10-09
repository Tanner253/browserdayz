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
}

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
  mosin: { nominal: 16, min: 15, lifetime: 7200, restock: 180, usage: ANYWHERE, favour: ARMOURY, loaded: [1, 4] },
  p38: { nominal: 16, min: 15, lifetime: 7200, restock: 180, usage: ANYWHERE, favour: ARMOURY, loaded: [2, 6] },
  // the service pistol, with nearly twice the magazine: as easy to come by as the other one
  // (at half as many, and in half the kinds of building, nobody could find one)
  m9: { nominal: 16, min: 15, lifetime: 7200, restock: 180, usage: ANYWHERE, favour: ARMOURY, loaded: [3, 10] },
  // loose rounds turn up in handfuls; sealed boxes are the real find
  ammo_762: { nominal: 32, min: 31, lifetime: 3600, restock: 120, usage: ANYWHERE, favour: ARMOURY, qty: [0.25, 0.6] },
  ammo_9mm: { nominal: 40, min: 39, lifetime: 3600, restock: 120, usage: ANYWHERE, favour: ARMOURY, qty: [0.25, 0.6] },
  box_762: { nominal: 14, min: 13, lifetime: 3600, restock: 180, usage: ['Military', 'Police', 'Hunting', 'Farm', 'Industrial'], favour: ARMOURY },
  box_9mm: { nominal: 18, min: 17, lifetime: 3600, restock: 180, usage: ['Police', 'Military', 'Town', 'Village'], favour: ARMOURY },
  // attachments
  pu_scope: { nominal: 2, min: 1, lifetime: 7200, restock: 1800, usage: ['Police', 'Military'] },
  rifle_wrap: { nominal: 2, min: 1, lifetime: 7200, restock: 1500, usage: ['Military', 'Hunting'] },
  suppressor_9: { nominal: 2, min: 1, lifetime: 7200, restock: 1800, usage: ['Police'] },
  mag_p38_ext: { nominal: 3, min: 1, lifetime: 7200, restock: 1200, usage: ['Police', 'Military'] },
  // melee
  hatchet: { nominal: 12, min: 10, lifetime: 3600, restock: 180, usage: ANYWHERE, favour: { Farm: 2, Hunting: 2 } },
  machete: { nominal: 10, min: 8, lifetime: 3600, restock: 180, usage: ANYWHERE, favour: { Farm: 2 } },
  crowbar: { nominal: 12, min: 10, lifetime: 3600, restock: 180, usage: ANYWHERE, favour: { Industrial: 2 } },
  bat: { nominal: 12, min: 10, lifetime: 3600, restock: 180, usage: ANYWHERE, favour: { Village: 2, Town: 2 } },
  knife: { nominal: 18, min: 15, lifetime: 3600, restock: 180, usage: ANYWHERE },
  // food and drink
  sprats: { nominal: 14, min: 8, lifetime: 2400, restock: 300, usage: ['Village', 'Town'] },
  condensed: { nominal: 8, min: 4, lifetime: 2400, restock: 300, usage: ['Village', 'Town', 'Military'] },
  beans: { nominal: 12, min: 7, lifetime: 2400, restock: 300, usage: ['Village', 'Town', 'Farm'] },
  tomatoes: { nominal: 8, min: 4, lifetime: 2400, restock: 300, usage: ['Village', 'Farm'] },
  sardines: { nominal: 9, min: 5, lifetime: 2400, restock: 300, usage: ['Village', 'Town', 'Hunting'] },
  apple: { nominal: 8, min: 4, lifetime: 1200, restock: 300, usage: ['Village', 'Farm'] },
  milk: { nominal: 6, min: 3, lifetime: 1800, restock: 300, usage: ['Village', 'Town'] },
  // (there was a third as much to drink on the map as to eat, and thirst runs as fast as hunger)
  water_jug: { nominal: 11, min: 6, lifetime: 2400, restock: 300, usage: ['Village', 'Town', 'Farm', 'Industrial'] },
  thermos: { nominal: 8, min: 4, lifetime: 2400, restock: 300, usage: ['Military', 'Hunting', 'Village', 'Police', 'Industrial'] },
  // medical
  // What stops bleeding is what a fight is lost for want of: twelve things on the whole map
  // was too few of it. More, sooner back, and most of it where it was kept: the clinic.
  bandage: { nominal: 16, min: 10, lifetime: 2400, restock: 240, usage: ['Village', 'Town', 'Military', 'Medic', 'Police', 'Hunting', 'Farm'], favour: { Medic: 6, Military: 2 } },
  firstaid: { nominal: 6, min: 3, lifetime: 3600, restock: 600, usage: ['Military', 'Medic', 'Town', 'Police'], favour: { Medic: 8 } },
  // clothing and bags: this is how you carry more
  // (What these are now is a soldier's kit, and their rules were written for a sun hat, a
  // life jacket and a pair of rubber boots: plates were found in a cow shed and never at an
  // army post. They are still about the farms, where people took them; most are where they were issued.)
  boonie_hat: { nominal: 5, min: 3, lifetime: 3600, restock: 900, usage: ['Village', 'Farm', 'Hunting', 'Military'], favour: { Military: 3 } },
  gasmask: { nominal: 2, min: 1, lifetime: 3600, restock: 1200, usage: ['Military', 'Police'] },
  life_vest: { nominal: 5, min: 3, lifetime: 3600, restock: 900, usage: ['Military', 'Police', 'Industrial', 'Town'], favour: { Military: 5, Police: 5 } },
  work_gloves: { nominal: 5, min: 3, lifetime: 3600, restock: 900, usage: ['Farm', 'Industrial', 'Village', 'Military', 'Police'], favour: { Military: 2 } },
  rubber_boots: { nominal: 5, min: 3, lifetime: 3600, restock: 900, usage: ['Farm', 'Village', 'Military', 'Industrial'], favour: { Military: 2 } },
  sack_pack: { nominal: 8, min: 4, lifetime: 3600, restock: 600, usage: ['Village', 'Town', 'Farm', 'Industrial', 'Military', 'Hunting'] },
  suitcase: { nominal: 4, min: 2, lifetime: 3600, restock: 1200, usage: ['Village', 'Town', 'Military', 'Hunting'], favour: { Military: 3 } },
  // tools and odds and ends
  binoculars: { nominal: 3, min: 1, lifetime: 3600, restock: 1200, usage: ['Military', 'Hunting', 'Police'] },
  compass: { nominal: 4, min: 2, lifetime: 3600, restock: 1200, usage: ['Military', 'Hunting', 'Village'] },
  cigarettes: { nominal: 8, min: 3, lifetime: 2400, restock: 600, usage: ['Village', 'Town', 'Military', 'Industrial'] },
  grenade: { nominal: 6, min: 3, lifetime: 3600, restock: 1200, usage: ['Military', 'Police'] },
  stash_kit: { nominal: 3, min: 1, lifetime: 7200, restock: 1800, usage: ['Farm', 'Industrial', 'Hunting'] },
  // fuel for the jeeps (src/sim/vehicles.ts): where there are sheds, yards and soldiers
  jerrycan: { nominal: 8, min: 5, lifetime: 3600, restock: 600, usage: ['Farm', 'Industrial', 'Military', 'Village'] },
};

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

  constructor(
    private points: LootPoint[],
    private events: EconomyEvents,
    /** can this item type physically lie at this loot point? */
    private fits: (id: string, p: LootPoint) => boolean = fitsPoint,
  ) {}

  /** Count of a type currently in the world (on the ground). */
  count(id: string) {
    let n = 0;
    for (const l of this.loot.values()) if (l.item.id === id) n++;
    return n;
  }

  private pickPoint(id: string, rule: TypeRule): number {
    const candidates: number[] = [];
    const weights: number[] = [];
    let total = 0;
    this.points.forEach((p, i) => {
      // armed points are stocked on their own (see arm)
      if (p.arms || this.pointBusy.has(i)) return;
      if (!p.usage.some((u) => rule.usage.includes(u))) return;
      // a rifle never spawns on a narrow shelf, a jerrycan never on a barrel
      if (!this.fits(id, p)) return;
      let w = 1;
      if (rule.favour) for (const u of p.usage) w = Math.max(w, rule.favour[u] ?? 1);
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

  private spawnType(id: string, at = -1): boolean {
    const rule = TYPES[id];
    const def = ITEMS[id];
    const pi = at >= 0 ? at : this.pickPoint(id, rule);
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
    // interleave types so scarce ones still find free points
    const ids = Object.keys(TYPES);
    let progress = true;
    while (progress) {
      progress = false;
      for (const id of ids) {
        if (this.count(id) < TYPES[id].nominal && this.spawnType(id)) progress = true;
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
      const n = this.count(id);
      if (n >= rule.min) continue;
      const last = this.lastRestock[id] ?? -1e9;
      if (this.time - last < rule.restock) continue;
      this.lastRestock[id] = this.time;
      for (let k = n; k < rule.nominal; k++) if (!this.spawnType(id)) break;
    }
  }

  serialize() {
    return { time: this.time, lastRestock: this.lastRestock, loot: [...this.loot.values()] };
  }
}
