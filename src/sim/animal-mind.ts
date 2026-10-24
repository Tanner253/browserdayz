// The animals' minds (2026-10-23): the herds, their ground and their day, what frightens them, the bear's charge and
// the wolves' hunt. Kept and run by the server, which moves every animal itself (server/animals.ts); the numbers are in
// src/sim/animals.ts and the ground in src/sim/animal-ground.ts.
//
// The owner: "the animal ai and migration should make SENSE and be balanced". So:
//   - A herd has ground of its own, and a day: it feeds out in the open in its feeding hours (deer at dawn and dusk)
//     and lies up in cover the rest, goes to water once while feeding, and moves on across its ground as it grazes.
//   - It notices a person by sight (less if they crouch, lie down, keep still, are in the trees or it is night), by
//     noise (how fast they go; a car; a shot) and by scent (from far upwind, near downwind). A little makes it look
//     up; enough and the whole herd bolts together, away and toward cover, for as far as its kind runs.
//   - Ground where it is shot at, chased and killed is ground it leaves: it moves to fresh ground of its kind far off,
//     and only comes home once things have been quiet for two of the Zone's days. Nobody can camp a herd.
//   - With nobody near, a herd sleeps; when somebody comes it is where its day would have taken it by now.

import { ANIMALS, A_ALERT, A_DEAD, A_DRINK, A_GRAZE, A_HIT, A_IDLE, A_REST, A_RUN, A_TROT, A_WALK, HERDS, KINDS, ROW_BLEEDS, SKIN, fwd, smellReach, yawTo, type AnimalRow, type Call, type HerdKind, type Kind, type Move } from './animals';
import type { Ground } from './animal-ground';
import { heardShare } from './heard';
import { fighter, pack } from './animal-fight';
import { alarm, herdCall } from './animal-calls';
import { apart, crowd, fit, groundFor, homesFor, onCountry, room, slotFor } from './animal-places';

/** A person as the animals know of them. */
export interface Seen {
  id: number;
  x: number;
  y: number;
  z: number;
  crouch: boolean;
  prone: boolean;
  /** metres a second over the ground */
  speed: number;
  /** in a car, or in a helicopter, or neither */
  ride: '' | 'car' | 'air';
  /** under a roof the animals cannot get into */
  sheltered: boolean;
  /** there, and never noticed (an admin vanished): the herds about them are awake and hear shots, and nothing sees, smells or goes for them */
  unseen?: boolean;
}

/** A blow that landed on somebody: who struck it, on whom, how hard, whether it opened a wound, and from where. */
export interface Strike {
  i: number;
  on: number;
  damage: number;
  bleed: boolean;
  mode: number;
  from: [number, number];
}

export interface Beast {
  i: number;
  /** its row of KINDS, and its herd */
  k: number;
  g: number;
  x: number;
  z: number;
  yaw: number;
  mode: number;
  hp: number;
  /** when it died (0: alive), and whether it has been gutted */
  diedAt: number;
  skinned: boolean;
  bleeds: boolean;
  speed: number;
  /** how frightened it is, 0 to 1, of what was at `fearX`, `fearZ` */
  aware: number;
  fearX: number;
  fearZ: number;
  /** seconds it has been running flat out */
  ranFor: number;
  /** its place in its herd, metres from where the herd is making for */
  slot: [number, number];
  /** what it is doing standing about, and when it next changes */
  act: number;
  next: number;
  /** which way it goes round what is in its way, and how long it has been getting nowhere */
  side: number;
  stuckT: number;
  /** a way it has turned to after getting nowhere, and for how much longer it keeps to it, seconds */
  detourYaw: number;
  detourT: number;
  // --- a fight (a bear, a wolf)
  foe: number;
  fightAt: number;
  fightX: number;
  fightZ: number;
  sensedAt: number;
  seenX: number;
  seenZ: number;
  warnUntil: number;
  rushUntil: number;
  move: Move | null;
  moveAt: number;
  restUntil: number;
  /** a wolf's run in at whoever the pack has: until when */
  dashUntil: number;
  /** who last hurt it, and when; and until when it will not start another fight */
  hurtBy: number;
  hurtAt: number;
  calmUntil: number;
  /** a body being gutted: by whom, from when */
  skinner: { id: number; at: number } | null;
  /** half eaten by wolves before anybody got to it */
  eaten: boolean;
}

export interface Group {
  i: number;
  herd: number;
  /** where its ground is, where it keeps to now (`mid`: home, or fresh ground it moved to), and where it is making for */
  home: { x: number; z: number };
  mid: { x: number; z: number };
  at: { x: number; z: number };
  spot: 'feed' | 'rest' | 'water';
  nextSpot: number;
  feeding: boolean;
  drank: boolean;
  members: number[];
  /** the kinds it is made of, as it should be */
  wants: number[];
  awake: boolean;
  /** when it may next call, and a deer herd next bark its alarm (src/sim/animal-calls.ts) */
  callAt: number;
  barkAt: number;
  sleptAt: number;
  pressure: number;
  pressedAt: number;
  movedAt: number;
  flee: { x: number; z: number; until: number } | null;
  /** members owed it: which kind, from when */
  owed: { k: number; at: number }[];
  /** a pack's hunt: whom (a person's number; or minus an animal's), since when */
  hunt: { foe: number; since: number; x: number; z: number } | null;
  nextDash: number;
  dasher: number;
  /** the day number of its last hunt of deer */
  huntedDay: number;
}

export interface Turn {
  strikes: Strike[];
  /** those that died this turn of their own (bled out, killed by wolves) */
  died: number[];
  /** what was heard of them (src/sim/animal-calls.ts) */
  calls: { i: number; call: Call; x: number; z: number }[];
}

const PI2 = Math.PI * 2;
const turnTo = (a: number, b: number, max: number) => a + Math.max(-max, Math.min(max, Math.atan2(Math.sin(b - a), Math.cos(b - a))));
const angleOff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
const isNight = (p: number) => p >= 0.73 || p < 0.02;
const inHours = (h: HerdKind, p: number) => h.hours.some(([a, b]) => p >= a && p < b);

/** a small seeded random: the herds' ground is chosen the same at every start (their territories are the map's) */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Herd {
  readonly beasts = new Map<number, Beast>();
  readonly groups: Group[] = [];
  private next = 1;
  private lastTick = 0;

  /**
   * @param live whether a kind can be stood (the game has its model)
   * @param phase the share of the Zone's day at a moment (src/sim/daynight.ts phaseOf), milliseconds in
   */
  constructor(readonly ground: Ground, private live: (k: Kind) => boolean, readonly phase: (now: number) => number, readonly rnd: () => number = Math.random) {}

  // ------------------------------------------------------------------ the herds' ground

  /** Every herd of every kind the game can draw, on ground of its own. */
  populate(now: number, people: Seen[] = []) {
    for (const _ of this.populating(now, people));
  }

  /** The same, a little at a time: a game playing alone stands its herds over many frames, not in one (see Wildlife.alone). */
  *populating(now: number, people: Seen[] = []): Generator<void> {
    const pick = seeded(7331);
    for (let hi = 0; hi < HERDS.length; hi++) {
      const h = HERDS[hi];
      const kinds = h.of.map(([id]) => KINDS.findIndex((k) => k.id === id));
      if (kinds.some((k) => k < 0 || !this.live(KINDS[k]))) continue;
      const homes: { x: number; z: number }[] = h.farm ? this.ground.farms.slice(0, h.count).map((f) => ({ x: f.x, z: f.z })) : [];
      if (!h.farm) yield* homesFor(this, h, pick, homes);
      for (const home of homes) {
        const wants: number[] = [];
        h.of.forEach(([, lo, hi2], n) => {
          const many = lo + Math.floor(pick() * (hi2 - lo + 1));
          for (let c = 0; c < many; c++) wants.push(kinds[n]);
        });
        const g: Group = {
          i: this.groups.length, herd: hi, home, mid: { ...home }, at: { ...home }, spot: 'rest', nextSpot: 0, feeding: false, drank: false,
          members: [], wants, awake: false, sleptAt: now, pressure: 0, pressedAt: now, movedAt: 0, flee: null, owed: [], hunt: null, nextDash: 0, dasher: 0, huntedDay: -1, callAt: 0, barkAt: 0,
        };
        this.groups.push(g);
        this.plan(g, now);
        for (const k of wants) if (this.beasts.size < ANIMALS.max) this.stand(g, k, now, people, true);
        yield;
      }
    }
  }




  /** a spot of its ground for what the herd is about to do (null: none found this time) */
  private spotFor(g: Group, what: 'feed' | 'rest' | 'water', away?: { x: number; z: number }): { x: number; z: number } | null {
    const h = HERDS[g.herd], ks = (g.wants.length ? g.wants : g.members.map((i) => this.beasts.get(i)!.k)).map((k) => KINDS[k]), steep = Math.min(...ks.map((k) => k.steep)), lives = ks[0]?.lives;
    if (what === 'water') {
      const w = this.ground.water(g.mid.x, g.mid.z, h.range * 1.2);
      return w && fit(this, w.x, w.z, steep, 'spot', !!h.farm, lives) ? w : null;
    }
    const want = what === 'feed' ? h.feed : h.rest, farm = h.farm ? this.farmOf(g) : null;
    for (let n = 0; n < 24; n++) {
      const a = this.rnd() * PI2, d = h.range * Math.sqrt(this.rnd());
      const x = g.mid.x + Math.cos(a) * d, z = g.mid.z + Math.sin(a) * d;
      if (farm && Math.hypot(x - farm.x, z - farm.z) > farm.r * 0.8) continue;
      if (away && Math.hypot(x - away.x, z - away.z) < 120) continue;
      if (want.includes(this.ground.biome(x, z)) && fit(this, x, z, steep, 'spot', !!h.farm, lives)) return { x, z };
    }
    return null;
  }

  private farmOf(g: Group) {
    return this.ground.farms.find((f) => Math.hypot(f.x - g.home.x, f.z - g.home.z) < 1) ?? null;
  }

  /** what the herd does next by the hour: out to feed (water first, once), or into cover to lie up */
  private plan(g: Group, now: number, away?: { x: number; z: number }) {
    const h = HERDS[g.herd], feeding = inHours(h, this.phase(now));
    if (feeding !== g.feeding) g.drank = false;
    g.feeding = feeding;
    const what = feeding ? (h.drinks && !g.drank && this.rnd() < 0.45 ? 'water' : 'feed') : 'rest';
    const at = this.spotFor(g, what, away) ?? (what === 'water' ? this.spotFor(g, 'feed', away) : null);
    if (at) g.at = at;
    g.spot = at && what === 'water' ? 'water' : what === 'water' ? 'feed' : what;
    // (moving on while feeding every few minutes, as a grazing herd does; lying up until the hour changes)
    g.nextSpot = now + (feeding ? 150_000 + this.rnd() * 150_000 : 600_000);
  }

  /** one more of a herd, where nobody living can see it turn up (null: no such spot this time) */
  private stand(g: Group, k: number, now: number, people: Seen[], start = false): Beast | null {
    const kind = KINDS[k];
    for (let n = 0; n < 12; n++) {
      const a = this.rnd() * PI2, d = 4 + this.rnd() * (start ? 30 : 60);
      // (one that never walks is stood at its own place in the herd, which no other has)
      const farm = !!HERDS[g.herd].farm, at = kind.still ? slotFor(this, g, k, (x, z) => fit(this, x, z, kind.steep, 'walk', farm, kind.lives)) : null;
      const x = at ? g.at.x + at[0] : g.at.x + Math.cos(a) * d, z = at ? g.at.z + at[1] : g.at.z + Math.sin(a) * d;
      if (!fit(this, x, z, kind.steep, 'walk', farm, kind.lives)) continue;
      if (people.some((p) => Math.hypot(p.x - x, p.z - z) < ANIMALS.clear)) return null;
      const slot = at ?? slotFor(this, g, k);
      const b: Beast = {
        i: this.next++, k, g: g.i, x, z, yaw: this.rnd() * PI2, mode: A_IDLE, hp: kind.hp, diedAt: 0, skinned: false, bleeds: false, speed: 0,
        aware: 0, fearX: x, fearZ: z, ranFor: 0, slot, act: A_GRAZE, next: now + this.rnd() * 6000, side: this.rnd() < 0.5 ? 1 : -1, stuckT: 0, detourYaw: 0, detourT: 0,
        foe: 0, fightAt: 0, fightX: x, fightZ: z, sensedAt: 0, seenX: x, seenZ: z, warnUntil: 0, rushUntil: 0, move: null, moveAt: 0, restUntil: 0, dashUntil: 0,
        hurtBy: 0, hurtAt: 0, calmUntil: 0, skinner: null, eaten: false,
      };
      // (at the start nobody is near: it stands at its own place in the herd)
      if (start && fit(this, g.at.x + slot[0], g.at.z + slot[1], kind.steep, 'walk', farm, kind.lives)) {
        b.x = g.at.x + slot[0];
        b.z = g.at.z + slot[1];
      }
      this.beasts.set(b.i, b);
      g.members.push(b.i);
      return b;
    }
    return null;
  }





  /**
   * An admin's (`/spawn wolf 4`): `n` of a kind stood where they ask, as ONE herd or pack that lives there (a stag
   * asked for with others comes with hinds, as a herd of deer is). Nothing is owed for them when they die.
   */
  place(kindId: string, x: number, z: number, now: number, n = 1): Beast[] {
    const k = KINDS.findIndex((kk) => kk.id === kindId);
    const hi = HERDS.findIndex((h) => h.of.some(([id]) => id === kindId));
    if (k < 0 || hi < 0 || n < 1) return [];
    const g: Group = {
      i: this.groups.length, herd: hi, home: { x, z }, mid: { x, z }, at: { x, z }, spot: 'feed', nextSpot: now + 120_000, feeding: true, drank: true,
      members: [], wants: [], awake: true, sleptAt: now, pressure: 0, pressedAt: now, movedAt: 0, flee: null, owed: [], hunt: null, nextDash: 0, dasher: 0, huntedDay: -1, callAt: 0, barkAt: 0,
    };
    this.groups.push(g);
    const others = HERDS[hi].of.map(([id]) => KINDS.findIndex((kk) => kk.id === id)).filter((o) => o !== k);
    const out: Beast[] = [];
    for (let c = 0; c < n; c++) {
      const b = this.stand(g, c === 0 || !others.length || KINDS[k].id !== 'stag' ? k : others[0], now, []);
      if (!b) continue;
      // (each at its own place in the herd, which keeps them apart)
      b.x = x + b.slot[0];
      b.z = z + b.slot[1];
      out.push(b);
    }
    return out;
  }

  // ------------------------------------------------------------------ time

  /** Five times a second or so. `people` is everybody alive, as the animals know of them. */
  tick(now: number, people: Seen[]): Turn {
    const turn: Turn = { strikes: [], died: [], calls: [] };
    const dt = Math.max(0, Math.min(0.5, this.lastTick ? (now - this.lastTick) / 1000 : ANIMALS.step));
    this.lastTick = now;
    const p = this.phase(now), noticed = people.filter((q) => !q.unseen);
    for (const g of this.groups) {
      // clearing away the dead, and what is owed for them
      for (const i of [...g.members]) {
        const b = this.beasts.get(i)!;
        if (b.diedAt && (now - b.diedAt > KINDS[b.k].lies * 1000 || (b.skinned && now - (b.skinner?.at ?? b.diedAt) > 20_000))) {
          this.beasts.delete(i);
          g.members.splice(g.members.indexOf(i), 1);
        }
      }
      const living = g.members.map((i) => this.beasts.get(i)!).filter((b) => !b.diedAt);
      if (living.length + g.owed.length < g.wants.length) {
        // (one died: the herd is owed one of its kind)
        const have = [...living.map((b) => b.k), ...g.owed.map((o) => o.k)];
        for (const k of g.wants) {
          const n = have.indexOf(k);
          if (n >= 0) have.splice(n, 1);
          else g.owed.push({ k, at: now + HERDS[g.herd].respawn * 1000 });
        }
      }
      for (const o of [...g.owed]) {
        if (now < o.at || this.beasts.size >= ANIMALS.max) continue;
        if (this.stand(g, o.k, now, people)) g.owed.splice(g.owed.indexOf(o), 1);
      }
      // awake while anybody is near the herd
      const lead = living[0];
      const near = lead ? people.some((q) => Math.hypot(q.x - lead.x, q.z - lead.z) < ANIMALS.wake) : false;
      if (near && !g.awake) this.wake(g, now, people);
      g.awake = near;
      if (!near) {
        g.sleptAt = now;
        continue;
      }
      // the hunted leave their ground; the quiet go home
      if (g.pressure > 0 && now - g.pressedAt > ANIMALS.pressure.fade * 1000) {
        g.pressure--;
        g.pressedAt = now;
      }
      if (g.pressure >= ANIMALS.pressure.move) this.moveOn(g, now, people);
      else if (!g.pressure && g.movedAt && now - g.movedAt > ANIMALS.pressure.home * 1000) {
        g.mid = { ...g.home };
        g.movedAt = 0;
        this.plan(g, now);
      }
      if (!g.flee && !g.hunt && (now > g.nextSpot || inHours(HERDS[g.herd], p) !== g.feeding)) this.plan(g, now);
      if (g.flee && now > g.flee.until) {
        const from = { x: g.flee.x, z: g.flee.z };
        g.flee = null;
        this.plan(g, now, from);
      }
      // (only those near enough to be sensed: every animal sensing everybody on the map was most of the cost)
      const close = noticed.filter((q) => Math.hypot(q.x - lead.x, q.z - lead.z) < ANIMALS.wake + 100);
      for (const b of living) this.think(b, g, now, dt, close, turn, p);
      apart(this, living);
      herdCall(this, g, living, now, p, turn);
    }
    return turn;
  }

  /** Somebody has come near a herd that was asleep: it is where its day would have taken it, if nobody can see it move there. */
  private wake(g: Group, now: number, people: Seen[]) {
    if (now - g.sleptAt < 90_000 || g.flee) return;
    this.plan(g, now);
    const seen = (x: number, z: number) => people.some((q) => Math.hypot(q.x - x, q.z - z) < 160);
    for (const i of g.members) {
      const b = this.beasts.get(i)!, k = KINDS[b.k];
      if (b.diedAt || seen(b.x, b.z)) continue;
      const x = g.at.x + b.slot[0], z = g.at.z + b.slot[1];
      if (seen(x, z) || !fit(this, x, z, k.steep, 'walk', !!HERDS[g.herd].farm, k.lives)) continue;
      b.x = x;
      b.z = z;
      b.aware = 0;
      b.act = g.spot === 'rest' ? A_REST : A_GRAZE;
    }
  }

  /** Hunted on its ground: the herd moves off to fresh ground of its kind, far from here and from anybody. */
  private moveOn(g: Group, now: number, people: Seen[]) {
    const h = HERDS[g.herd];
    g.pressure = 0;
    if (h.farm) return;
    const pick = this.rnd;
    // (fresh ground as wild as a first home is: none such near, and it stays where it is)
    for (let n = 0; n < 60; n++) {
      const a = pick() * PI2, d = 400 + pick() * 500, x = g.mid.x + Math.cos(a) * d, z = g.mid.z + Math.sin(a) * d;
      if (groundFor(this, h, x, z) < 0) continue;
      if (people.some((q) => Math.hypot(q.x - x, q.z - z) < 300)) continue;
      if (this.groups.some((o) => o !== g && o.herd === g.herd && Math.hypot(o.mid.x - x, o.mid.z - z) < h.apart * 0.6)) continue;
      g.mid = { x, z };
      g.movedAt = now;
      g.at = this.spotFor(g, 'rest') ?? g.at;
      g.spot = 'rest';
      g.nextSpot = now + 600_000;
      return;
    }
  }

  private press(g: Group, by: number, now: number) {
    g.pressure += by;
    g.pressedAt = now;
  }

  // ------------------------------------------------------------------ one animal

  private think(b: Beast, g: Group, now: number, dt: number, people: Seen[], turn: Turn, phase: number) {
    const k = KINDS[b.k];
    if (b.bleeds) {
      b.hp -= ANIMALS.bleedRate * k.hp * dt;
      if (b.hp <= 0) {
        this.die(b, now);
        turn.died.push(b.i);
        return;
      }
    }
    if (b.mode === A_HIT && now < b.restUntil) return;
    // what it makes of everybody about it
    const night = isNight(phase);
    let fear = 0, from: Seen | null = null;
    for (const q of people) {
      const s = this.sense(b, k, q, night);
      if (s > fear) {
        fear = s;
        from = q;
      }
    }
    // and of the wolves and the bears, if it is something they eat
    if (k.temper === 'prey' || k.temper === 'tame') {
      for (const o of this.beasts.values()) {
        if (o.diedAt || o.g === b.g) continue;
        const ok = KINDS[o.k];
        if (ok.temper !== 'bear' && ok.temper !== 'pack') continue;
        const d = Math.hypot(o.x - b.x, o.z - b.z), hunting = o.mode === A_RUN || o.mode === A_TROT || o.foe < 0;
        const s = d < (hunting ? 70 : 30) ? 1 - d / (hunting ? 70 : 30) + 0.4 : 0;
        if (s > fear) {
          fear = s;
          b.fearX = o.x;
          b.fearZ = o.z;
          from = null;
        }
      }
    }
    if (from) {
      b.fearX = from.x;
      b.fearZ = from.z;
    }
    b.aware = Math.min(1, fear > 0 ? b.aware + fear * dt * 2.5 : Math.max(0, b.aware - ANIMALS.calm * dt));
    if (fear >= 0.95) b.aware = Math.max(b.aware, ANIMALS.fleeAt);
    switch (k.temper) {
      case 'bear':
        if (fighter(this, b, k, now, dt, people, turn, from)) return;
        break;
      case 'pack':
        if (pack(this, b, g, k, now, dt, people, turn, from, phase)) return;
        break;
    }
    this.prey(b, g, k, now, dt, turn, !!from && from.ride !== '');
  }

  /** How much a person frightens it this moment, 0 to 1 (and over: something it cannot mistake). */
  private sense(b: Beast, k: Kind, q: Seen, night: boolean): number {
    const d = Math.hypot(q.x - b.x, q.z - b.z);
    if (d > 340) return 0;
    if (q.ride === 'air') return d < ANIMALS.rotor * k.hear ? 1 - d / (ANIMALS.rotor * k.hear) + 0.5 : 0;
    if (q.ride === 'car') return q.speed > 2 && d < ANIMALS.engine * k.hear ? 1 - d / (ANIMALS.engine * k.hear) + 0.45 : 0;
    let s = 0;
    const N = ANIMALS.noise, noise = (q.speed > 5.4 ? N.sprint : q.speed > 2.6 ? N.jog : q.speed > 0.6 ? (q.crouch || q.prone ? N.crouch : N.walk) : 0) * k.hear;
    if (d < noise) s = 0.5 + 0.5 * (1 - d / noise);
    if (q.sheltered) return s * 0.5;
    let r = k.sight * (q.prone ? ANIMALS.prone : q.crouch ? ANIMALS.crouched : 1) * (night ? ANIMALS.night : 1) * (1 - (1 - ANIMALS.trees) * this.ground.cover(q.x, q.z));
    if (q.speed < 0.3) r *= 0.6;
    if (d < r && (d < 6 || angleOff(b.yaw, yawTo(q.x - b.x, q.z - b.z)) < k.view)) {
      const eye = this.ground.height(b.x, b.z) + KINDS[b.k].tall;
      if (this.ground.clear(b.x, eye, b.z, q.x, q.y + (q.prone ? 0.3 : q.crouch ? 0.9 : 1.5), q.z)) s = Math.max(s, 0.3 + 0.7 * (1 - d / r));
    }
    const smell = smellReach(k, b.x, b.z, q.x, q.z);
    if (d < smell) s = Math.max(s, 0.35 + 0.5 * (1 - d / smell));
    return s;
  }

  /** What anything does that is not fighting: keeps with its herd, feeds, lies up, looks up, bolts. */
  private prey(b: Beast, g: Group, k: Kind, now: number, dt: number, turn: Turn, rideFear = false) {
    const h = HERDS[g.herd];
    if (k.still) {
      // (no gait: it would slide. It grazes and looks up where it stands; a fright only brings its head up)
      if (now > b.next) {
        b.act = this.rnd() < 0.6 ? A_GRAZE : A_IDLE;
        b.next = now + 6000 + this.rnd() * 9000;
      }
      b.speed = 0;
      b.mode = b.aware >= ANIMALS.alert ? A_ALERT : b.act;
      return;
    }
    // (a bear or a wolf whole and unhurt does not run from a person: it stands and watches. A car, a helicopter, a
    // shot from further off than it will charge, or being hurt past bearing, and it runs like anything else.)
    const stands = !!k.fight && b.hp >= k.hp * k.fight.breakAt && !rideFear && !(b.hurtBy && now - b.hurtAt < 8000);
    if (b.aware >= ANIMALS.fleeAt && !g.flee && !stands) {
      // (the whole herd goes at once: DayZ's deer)
      const run = k.flee / k.run;
      g.flee = { x: b.fearX, z: b.fearZ, until: now + (run + 2) * 1000 };
      alarm(g, b, now, turn);
      this.press(g, ANIMALS.pressure.fled, now);
      for (const i of g.members) {
        const o = this.beasts.get(i)!;
        if (!o.diedAt && Math.hypot(o.x - b.x, o.z - b.z) < 90) o.aware = Math.max(o.aware, ANIMALS.fleeAt);
      }
    }
    if (g.flee) {
      // away from it, and on
      const ax = b.x - g.flee.x, az = b.z - g.flee.z, d = Math.hypot(ax, az) || 1;
      let tx = b.x + (ax / d) * 40, tz = b.z + (az / d) * 40;
      if (h.farm) {
        const f = this.farmOf(g);
        if (f && Math.hypot(tx - f.x, tz - f.z) > f.r * 0.8) {
          tx = f.x + (b.x - f.x) * 0.5;
          tz = f.z + (b.z - f.z) * 0.5;
        }
      }
      const tired = b.ranFor > k.wind, slow = b.bleeds ? 0.75 : 1;
      const speed = (h.farm ? k.trot : tired ? k.trot * 1.2 : k.run) * slow;
      if (speed >= k.run * 0.8) b.ranFor += dt;
      this.go(b, k, tx, tz, speed, dt);
      return;
    }
    b.ranFor = Math.max(0, b.ranFor - dt * 0.5);
    // (never stopped by a road or in a town: it goes on to its own place, which is neither, and looks round there)
    const here = this.ground.biome(b.x, b.z), astray = !HERDS[g.herd].farm && (this.ground.road(b.x, b.z) < ANIMALS.keepOff.road.walk || here === 'town' || !onCountry(k.lives, here));
    if (b.aware >= ANIMALS.alert && !astray) {
      // head up, facing it: still for as long as the fright lasts
      b.yaw = turnTo(b.yaw, yawTo(b.fearX - b.x, b.fearZ - b.z), 2.5 * dt);
      b.speed = 0;
      b.mode = A_ALERT;
      for (const i of g.members) {
        const o = this.beasts.get(i)!;
        if (!o.diedAt && o !== b && Math.hypot(o.x - b.x, o.z - b.z) < 50 && o.aware < ANIMALS.alert * 0.9) {
          o.aware = ANIMALS.alert * 0.9;
          o.fearX = b.fearX;
          o.fearZ = b.fearZ;
        }
      }
      return;
    }
    // with its herd, at its place in it
    const tx = g.at.x + b.slot[0], tz = g.at.z + b.slot[1], d = Math.hypot(tx - b.x, tz - b.z);
    if (d > 7 || (astray && d > 0.8)) {
      const far = d > 90 || (g.movedAt && now - g.movedAt < 120_000);
      this.go(b, k, tx, tz, far ? k.trot : k.walk, dt);
      return;
    }
    if (now > b.next) {
      const r = this.rnd();
      b.act = g.spot === 'rest' ? (r < 0.8 ? A_REST : A_IDLE) : g.spot === 'water' ? (r < 0.7 ? A_DRINK : A_IDLE) : r < 0.6 ? A_GRAZE : r < 0.85 ? A_IDLE : A_ALERT;
      b.next = now + (b.act === A_REST ? 20_000 : 4000) + this.rnd() * 8000;
      if (g.spot === 'water' && b.act === A_DRINK) g.drank = true;
      // (a step or two on as it grazes, never onto a herd mate's place)
      if (b.act === A_GRAZE && this.rnd() < 0.4) {
        const s: [number, number] = [b.slot[0] + (this.rnd() - 0.5) * 4, b.slot[1] + (this.rnd() - 0.5) * 4];
        const mates = g.members.map((i) => this.beasts.get(i)!).filter((o) => o !== b && !o.diedAt);
        if (mates.every((o) => Math.hypot(o.slot[0] - s[0], o.slot[1] - s[1]) >= room(o.k, b.k, true))) b.slot = s;
      }
    }
    // (and should another stand in it, it steps aside to make room, as a grazing herd shuffles apart)
    const c = crowd(this, b);
    if (c) {
      const ox = b.x - c.o.x, oz = b.z - c.o.z, a = Math.hypot(ox, oz) > 0.01 ? Math.atan2(oz, ox) : this.rnd() * PI2;
      this.go(b, k, b.x + Math.cos(a) * (c.by + 0.5), b.z + Math.sin(a) * (c.by + 0.5), k.walk, dt, 0.1);
      return;
    }
    b.speed = 0;
    b.mode = b.act;
  }

  /** a step toward somewhere, round what is in the way (true: it is there) */
  /** (and for animal-fight.ts) */
  go(b: Beast, k: Kind, tx: number, tz: number, speed: number, dt: number, near = 0.8): boolean {
    const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
    if (d < near) {
      b.speed = 0;
      b.mode = A_IDLE;
      return true;
    }
    // (a detour after getting nowhere is kept to for a moment, and turned onto as any turn is: it snapped round once)
    b.detourT = Math.max(0, b.detourT - dt);
    const want = b.detourT > 0 ? b.detourYaw : yawTo(dx, dz), look = Math.max(1.6, speed * 0.7);
    const farm = HERDS[this.groups[b.g].herd].farm ? this.farmOf(this.groups[b.g]) : null;
    // (out of the towns; one that is in one already, stood there by an admin or chased in, may walk on through it and out)
    const inTown = !farm && this.ground.biome(b.x, b.z) === 'town';
    // (and on its own country, fleeing too, as it would keep off a wall: only one off it already walks where it must, back)
    const home = !onCountry(k.lives, this.ground.biome(b.x, b.z));
    const can = (x: number, z: number) => this.ground.open(x, z, k.steep) && (!farm || Math.hypot(x - farm.x, z - farm.z) < farm.r * 0.9) && (!!farm || inTown || this.ground.biome(x, z) !== 'town') && (home || onCountry(k.lives, this.ground.biome(x, z)));
    // (a way is open where it is clear both at the next step and further on: clear only further on, the way went
    // through a wall or a house it could not step through, and it stood there running for good)
    const step = Math.min(d, speed * dt), next = Math.max(0.8, Math.min(3, speed * dt * 1.3));
    let yaw = NaN;
    for (const off of [0, 0.45, 0.9, 1.4, 2.0, 2.6]) {
      for (const s of off ? [b.side, -b.side] : [1]) {
        const y = want + off * s, [fx, fz] = fwd(y);
        if (can(b.x + fx * step, b.z + fz * step) && can(b.x + fx * next, b.z + fz * next) && can(b.x + fx * look, b.z + fz * look)) {
          yaw = y;
          if (off > 1) b.side = s;
          break;
        }
      }
      if (!Number.isNaN(yaw)) break;
    }
    if (Number.isNaN(yaw)) {
      b.side = -b.side;
      yaw = b.yaw + Math.PI;
      speed *= 0.3;
    }
    b.yaw = turnTo(b.yaw, yaw, (speed > 5 ? 3.2 : 2.4) * dt);
    // (the step the way it faces; or, where that is blocked while it is still turning, the way it is turning to; or
    // half of either, to slip between two trunks)
    let moved = false;
    stepping: for (const k2 of [1, 0.5]) {
      for (const y of [b.yaw, yaw]) {
        const [fx, fz] = fwd(y), nx = b.x + fx * step * k2, nz = b.z + fz * step * k2;
        if (!can(nx, nz)) continue;
        b.x = nx;
        b.z = nz;
        moved = true;
        break stepping;
      }
    }
    // (and should it still get nowhere for a second, it turns about and tries another line: nothing stands running on one spot)
    b.stuckT = moved ? 0 : b.stuckT + dt;
    if (b.stuckT > 1) {
      b.stuckT = 0;
      b.side = -b.side;
      b.detourYaw = b.yaw + Math.PI * (0.5 + this.rnd()) * b.side;
      b.detourT = 1.5;
    }
    // (apart from the rest of its herd)
    for (const i of this.groups[b.g].members) {
      const o = this.beasts.get(i)!;
      if (o === b || o.diedAt) continue;
      const ox = b.x - o.x, oz = b.z - o.z, od = Math.hypot(ox, oz), min = room(o.k, b.k, true);
      // (the whole way out, not half: at a bolt's 11 m/s half a gap a step left them in each other for a second)
      if (od > 0.01 && od < min && can(b.x + (ox / od) * (min - od), b.z + (oz / od) * (min - od))) {
        b.x += (ox / od) * (min - od);
        b.z += (oz / od) * (min - od);
      }
    }
    b.speed = speed;
    b.mode = speed >= k.run * 0.8 ? A_RUN : speed >= k.trot * 0.7 ? A_TROT : A_WALK;
    return false;
  }

  /** it is dead: and the rest of its herd near it bolt, away from what killed it (`from`: where that was, else where it fell) */
  die(b: Beast, now: number, from?: { x: number; z: number }) {
    b.diedAt = now || 1;
    b.hp = 0;
    b.mode = A_DEAD;
    b.speed = 0;
    b.bleeds = false;
    b.move = null;
    b.foe = 0;
    const g = this.groups[b.g];
    this.press(g, ANIMALS.pressure.killed, now);
    const fx = from?.x ?? b.x, fz = from?.z ?? b.z;
    for (const o of this.beasts.values()) {
      if (o.diedAt || KINDS[o.k].temper === 'pack' || KINDS[o.k].temper === 'bear') continue;
      // (its own herd within a long shot of it, and anything else close enough to see it go down)
      const d = Math.hypot(o.x - b.x, o.z - b.z);
      if ((o.g === b.g && d < 120) || d < 40) {
        o.aware = 1;
        o.fearX = fx;
        o.fearZ = fz;
      }
    }
  }

  // ------------------------------------------------------------------ what the world does to them

  /** A shot: everything within earshot that hears it (its range as src/sim/heard.ts says it) is frightened by it. */
  heard(x: number, z: number, range: [number, number], now: number) {
    for (const g of this.groups) {
      if (!g.awake) continue;
      for (const i of g.members) {
        const b = this.beasts.get(i)!, k = KINDS[b.k];
        if (b.diedAt) continue;
        const d = Math.hypot(b.x - x, b.z - z), share = heardShare([range[0] * k.hear, range[1] * k.hear], d);
        if (share <= 0) continue;
        if (d < 150) this.press(g, ANIMALS.pressure.shot / Math.max(1, g.members.length), now);
        if (k.temper === 'bear' || k.temper === 'pack') {
          b.aware = Math.max(b.aware, ANIMALS.alert);
          continue;
        }
        b.aware = Math.min(1, b.aware + share * 1.2);
        if (share > 0.3) b.aware = Math.max(b.aware, ANIMALS.fleeAt);
        b.fearX = x;
        b.fearZ = z;
      }
    }
  }

  /** It was hit. What it has left, and whether that was the end of it; null if there is no such animal standing. */
  hurt(i: number, amount: number, by: Seen | null, now: number): { hp: number; dead: boolean } | null {
    const b = this.beasts.get(i);
    if (!b || b.diedAt || !(amount > 0)) return null;
    const k = KINDS[b.k];
    b.hp = Math.max(0, b.hp - amount * k.tough);
    if (by) {
      b.hurtBy = by.id;
      b.hurtAt = now;
      b.fearX = by.x;
      b.fearZ = by.z;
    }
    b.aware = 1;
    if (b.hp <= 0) {
      this.die(b, now, by ?? undefined);
      return { hp: 0, dead: true };
    }
    if (b.hp < k.hp * ANIMALS.bleedBelow && k.temper !== 'bear') b.bleeds = true;
    if (!b.move && k.temper !== 'bear') {
      b.mode = A_HIT;
      b.restUntil = now + 250;
    }
    return { hp: b.hp, dead: false };
  }

  // ------------------------------------------------------------------ gutting and skinning

  /** Somebody kneels at a body with a blade: why they cannot (null: they can, and are timed from now). */
  startSkin(i: number, who: number, x: number, z: number, now: number): string | null {
    const b = this.beasts.get(i);
    if (!b || !b.diedAt || b.skinned) return 'There is nothing here to skin.';
    if (Math.hypot(b.x - x, b.z - z) > SKIN.reach + 1) return 'Too far from it.';
    if (b.skinner && b.skinner.id !== who && now - b.skinner.at < SKIN.time * 1000 + 3000) return 'Somebody is already at it.';
    b.skinner = { id: who, at: now };
    return null;
  }

  /** And is done: the kind it was, and whether wolves had been at it (null: it was not theirs to finish). */
  endSkin(i: number, who: number, x: number, z: number, now: number): { kind: Kind; eaten: boolean; x: number; z: number } | null {
    const b = this.beasts.get(i);
    if (!b || !b.diedAt || b.skinned || !b.skinner || b.skinner.id !== who) return null;
    if (now - b.skinner.at < (SKIN.time - 0.7) * 1000 || Math.hypot(b.x - x, b.z - z) > SKIN.reach + 1.5) return null;
    b.skinned = true;
    b.skinner.at = now;
    return { kind: KINDS[b.k], eaten: b.eaten, x: b.x, z: b.z };
  }

  // ------------------------------------------------------------------ telling

  /** every animal within `r` of a place, as a game is told of them (the gutted are gone from sight) */
  rows(x: number, z: number, r: number): AnimalRow[] {
    const out: AnimalRow[] = [];
    for (const b of this.beasts.values()) {
      if (b.skinned || Math.abs(b.x - x) > r || Math.abs(b.z - z) > r || Math.hypot(b.x - x, b.z - z) > r) continue;
      out.push([b.i, b.k, Math.round(b.x * 10), Math.round(b.z * 10), Math.round((((b.yaw % PI2) + PI2) % PI2) * 100), b.mode, b.bleeds ? ROW_BLEEDS : 0]);
    }
    return out;
  }

  /** how many of each kind are alive, for the admin panel */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const b of this.beasts.values()) if (!b.diedAt) out[KINDS[b.k].id] = (out[KINDS[b.k].id] ?? 0) + 1;
    return out;
  }
}

export { A_DEAD };
