// Central Economy, modelled on DayZ's types.xml: every item type has a world-wide
// nominal (target) count, a minimum that triggers restocking, a lifetime after which
// untouched loot despawns, and usage tags that decide which buildings it spawns in.
// The economy controls *world supply* precisely, which is also what a scarce,
// redeemable item needs (nominal 1, long restock, tight usage).
//
// Runs on the server in multiplayer (clients only mirror it through inject / take)
// and in the browser when playing offline.

import type { Usage, LootPoint } from '../world/buildings';
import { ITEMS, makeItem, type ItemInstance } from './items';
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
}

export const TYPES: Record<string, TypeRule> = {
  // firearms: the police station in the middle of the map and the military checkpoint
  mosin: { nominal: 4, min: 2, lifetime: 7200, restock: 1500, usage: ['Military', 'Police', 'Hunting'], loaded: [0, 3] },
  p38: { nominal: 6, min: 3, lifetime: 7200, restock: 1000, usage: ['Police', 'Military', 'Town'], loaded: [0, 4] },
  // loose rounds turn up in small handfuls; sealed boxes are the real find
  ammo_762: { nominal: 5, min: 2, lifetime: 3600, restock: 600, usage: ['Military', 'Police', 'Hunting'], qty: [0.15, 0.5] },
  ammo_9mm: { nominal: 7, min: 3, lifetime: 3600, restock: 600, usage: ['Police', 'Military', 'Town', 'Village'], qty: [0.15, 0.5] },
  box_762: { nominal: 4, min: 2, lifetime: 3600, restock: 900, usage: ['Military', 'Police', 'Hunting'] },
  box_9mm: { nominal: 6, min: 3, lifetime: 3600, restock: 900, usage: ['Police', 'Military', 'Town'] },
  // attachments
  pu_scope: { nominal: 2, min: 1, lifetime: 7200, restock: 1800, usage: ['Police', 'Military'] },
  rifle_wrap: { nominal: 2, min: 1, lifetime: 7200, restock: 1500, usage: ['Military', 'Hunting'] },
  suppressor_9: { nominal: 2, min: 1, lifetime: 7200, restock: 1800, usage: ['Police'] },
  mag_p38_ext: { nominal: 3, min: 1, lifetime: 7200, restock: 1200, usage: ['Police', 'Military'] },
  // melee
  hatchet: { nominal: 3, min: 1, lifetime: 3600, restock: 900, usage: ['Farm', 'Hunting', 'Village'] },
  machete: { nominal: 2, min: 1, lifetime: 3600, restock: 900, usage: ['Farm', 'Village'] },
  crowbar: { nominal: 3, min: 1, lifetime: 3600, restock: 900, usage: ['Industrial', 'Farm'] },
  bat: { nominal: 3, min: 1, lifetime: 3600, restock: 900, usage: ['Village', 'Town'] },
  knife: { nominal: 5, min: 2, lifetime: 3600, restock: 600, usage: ['Village', 'Town', 'Farm', 'Hunting'] },
  // food and drink
  sprats: { nominal: 10, min: 5, lifetime: 2400, restock: 300, usage: ['Village', 'Town'] },
  condensed: { nominal: 6, min: 3, lifetime: 2400, restock: 300, usage: ['Village', 'Town', 'Military'] },
  beans: { nominal: 8, min: 4, lifetime: 2400, restock: 300, usage: ['Village', 'Town', 'Farm'] },
  tomatoes: { nominal: 6, min: 3, lifetime: 2400, restock: 300, usage: ['Village', 'Farm'] },
  sardines: { nominal: 6, min: 3, lifetime: 2400, restock: 300, usage: ['Village', 'Town', 'Hunting'] },
  apple: { nominal: 6, min: 3, lifetime: 1200, restock: 300, usage: ['Village', 'Farm'] },
  milk: { nominal: 4, min: 2, lifetime: 1800, restock: 300, usage: ['Village', 'Town'] },
  water_jug: { nominal: 6, min: 3, lifetime: 2400, restock: 300, usage: ['Village', 'Farm', 'Industrial'] },
  thermos: { nominal: 4, min: 2, lifetime: 2400, restock: 300, usage: ['Military', 'Hunting', 'Village', 'Police'] },
  // medical
  bandage: { nominal: 9, min: 4, lifetime: 2400, restock: 300, usage: ['Village', 'Town', 'Military', 'Medic', 'Police'] },
  firstaid: { nominal: 3, min: 1, lifetime: 3600, restock: 900, usage: ['Military', 'Medic', 'Town', 'Police'] },
  // clothing and bags: this is how you carry more
  boonie_hat: { nominal: 4, min: 2, lifetime: 3600, restock: 900, usage: ['Village', 'Farm', 'Hunting'] },
  gasmask: { nominal: 2, min: 1, lifetime: 3600, restock: 1200, usage: ['Military', 'Police'] },
  life_vest: { nominal: 4, min: 2, lifetime: 3600, restock: 900, usage: ['Farm', 'Industrial', 'Village', 'Police'] },
  work_gloves: { nominal: 4, min: 2, lifetime: 3600, restock: 900, usage: ['Farm', 'Industrial', 'Village'] },
  rubber_boots: { nominal: 4, min: 2, lifetime: 3600, restock: 900, usage: ['Farm', 'Village'] },
  sack_pack: { nominal: 6, min: 3, lifetime: 3600, restock: 600, usage: ['Village', 'Town', 'Farm', 'Industrial'] },
  suitcase: { nominal: 3, min: 1, lifetime: 3600, restock: 1200, usage: ['Village', 'Town'] },
  // tools and odds and ends
  flashlight: { nominal: 3, min: 1, lifetime: 3600, restock: 900, usage: ['Village', 'Industrial', 'Hunting', 'Police'] },
  binoculars: { nominal: 2, min: 1, lifetime: 3600, restock: 1200, usage: ['Military', 'Hunting', 'Police'] },
  compass: { nominal: 3, min: 1, lifetime: 3600, restock: 1200, usage: ['Military', 'Hunting', 'Village'] },
  watch: { nominal: 3, min: 1, lifetime: 3600, restock: 900, usage: ['Village', 'Town'] },
  radio: { nominal: 1, min: 0, lifetime: 7200, restock: 3600, usage: ['Military', 'Police'] },
  cigarettes: { nominal: 6, min: 2, lifetime: 2400, restock: 600, usage: ['Village', 'Town', 'Military', 'Industrial'] },
  jerrycan: { nominal: 3, min: 1, lifetime: 3600, restock: 900, usage: ['Farm', 'Industrial'] },
  grenade: { nominal: 1, min: 0, lifetime: 3600, restock: 2400, usage: ['Military'] },
  stash_kit: { nominal: 3, min: 1, lifetime: 7200, restock: 1800, usage: ['Farm', 'Industrial', 'Hunting'] },
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

  private pickPoint(id: string, usage: Usage[]): number {
    const candidates: number[] = [];
    this.points.forEach((p, i) => {
      if (this.pointBusy.has(i)) return;
      if (!p.usage.some((u) => usage.includes(u))) return;
      // a rifle never spawns on a narrow shelf, a jerrycan never on a barrel
      if (this.fits(id, p)) candidates.push(i);
    });
    if (!candidates.length) return -1;
    return candidates[Math.floor(this.rng.next() * candidates.length)];
  }

  private spawnType(id: string): boolean {
    const rule = TYPES[id];
    const def = ITEMS[id];
    const pi = this.pickPoint(id, rule.usage);
    if (pi < 0) return false;
    const p = this.points[pi];
    const item = makeItem(id);
    if (def.stack && rule.qty) item.qty = Math.max(1, Math.round(def.stack * this.rng.range(rule.qty[0], rule.qty[1])));
    if (def.weapon && rule.loaded) item.loaded = this.rng.int(rule.loaded[0], Math.min(rule.loaded[1], def.weapon.capacity));
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

  /** Initial fill up to nominal. */
  populate() {
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
