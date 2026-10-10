// The infected: the people who lived here, and did not leave.
//
// Rules and data only, shared by the server and the game. Who does what:
//
//   the director (the server; the game itself when playing alone) decides how many there
//     are and where each starts, keeps what each has left, says when one is dead, and names
//     for each the one game that moves it;
//   that game (the nearest living player's) is the only one that knows where the walls,
//     the doors and the trees are, so it is the one that walks the body about, has it see
//     and hear, and says when a blow of its has landed. Every other game is told where the
//     body is and draws it there. (The jeeps are moved the same way: see src/sim/vehicles.ts.)
//
// A game can therefore lie about one it moves, as it can about its own player. What it
// cannot do is hurt anybody from further off than an arm, or faster than an arm swings:
// the director believes a blow only when the two are standing together.

import { BUILDING_FOOTPRINT, bunkerPlace, heightAt, type World } from '../world/worldgen';
import { BUNKER, bunkerAt, bunkerPlan, levelY } from './bunker';

export const INFECTED = {
  /** as many as are ever alive at once, over the whole map */
  max: 60,
  /** what each has to begin with: a rifle round anywhere, a pistol round in the head, three in the chest */
  hp: 90,
  /** how long a body lies there, and how long after that before another turns up about the same place, seconds */
  linger: 50,
  respawn: 210,
  /** none turns up within this of somebody living, metres */
  clear: 75,
  /**
   * Metres a second: drifting about, walking back to where it lives, going to see what a noise
   * was, and after somebody. A person jogs at 4 and sprints at 6.2: whoever keeps moving gets
   * away from them, and whoever stops to fight, to loot or to dress a wound has them to deal with.
   */
  wander: 0.6,
  back: 1.0,
  look: 1.7,
  chase: 3.3,
  /** how far they see a standing person in front of them, a crouched one, and anybody at all whichever way they face */
  sight: 34,
  sightCrouched: 15,
  sightAround: 3.5,
  /** half the angle they see in, radians */
  view: 1.2,
  /** how far off they hear: somebody jogging, sprinting, a jeep, a shot, a shot through a suppressor */
  hearJog: 11,
  hearSprint: 19,
  hearJeep: 45,
  hearShot: 125,
  hearQuiet: 22,
  /** how long they go on after somebody they can no longer see, seconds (and how long they then look about where they last saw them) */
  forget: 14,
  search: 9,
  /**
   * How long one goes on looking for somebody it has lost, or beating on a door with nobody to
   * be seen or heard behind it, before it gives up and goes home, seconds. (Shut in a house,
   * keep away from the windows and keep still or crouched, and they go.)
   */
  patience: 32,
  /** further than this from where it lives with nothing to be after, it walks back there, metres */
  stray: 24,
  /** an arm's length; how long the arm takes to come down; how long the whole lunge takes; how long from one blow to the next; what it does */
  reach: 1.75,
  windup: 0.55,
  lunge: 1.15,
  swing: 1.6,
  damage: 10,
  /** the chance a blow opens a wound */
  bleed: 0.18,
  /**
   * A guard: fists up, or something held in the hand to strike with, and the guard button held.
   * A blow from in front of whoever is on guard (within this of the way they face, radians) does
   * nothing to them, takes this much of their wind, and stops the one that threw it for a moment:
   * the moment to hit back in. With no wind left there is no guard.
   */
  guardArc: 1.35,
  guardCost: 14,
  /**
   * How long one is stopped: by a blow of its that was blocked, by being shot, by being struck,
   * seconds. And how long after being stopped before a shot or a blow can stop it again: it is
   * checked, not held where it stands for as long as somebody goes on hitting it.
   */
  stopBlocked: 0.7,
  stopShot: 0.18,
  stopStruck: 0.28,
  stopAgain: 1.1,
  /** a game moves the ones within this of its player; past it, with nobody nearer, they stand where they are */
  own: 170,
  /** the chance one has something on it worth picking up when it goes down */
  carries: 0.6,
};

/**
 * What they had in their pockets: [what, the fewest, the most, how likely beside the others].
 * Rounds more than anything (about one in four of them has some), an injector on one in nine.
 */
const POCKETS: [string, number, number, number][] = [
  ['ammo_9mm', 3, 8, 7], ['ammo_762', 2, 5, 5], ['bandage', 1, 1, 5], ['beans', 1, 1, 2], ['sardines', 1, 1, 2],
  ['apple', 1, 1, 2], ['cigarettes', 1, 1, 2], ['watch', 1, 1, 1], ['compass', 1, 1, 1], ['knife', 1, 1, 1],
];

/** What one drops when it goes down, if anything: [item, how many]. */
export function infectedDrop(rnd: () => number = Math.random): [string, number] | null {
  if (rnd() > INFECTED.carries) return null;
  let roll = rnd() * POCKETS.reduce((n, p) => n + p[3], 0);
  for (const [id, lo, hi, w] of POCKETS) {
    if ((roll -= w) < 0) return [id, lo + Math.floor(rnd() * (hi - lo + 1))];
  }
  return null;
}

/** what one is doing: standing, drifting, going to look at a noise, after somebody, striking, dead */
export const I_IDLE = 0, I_WANDER = 1, I_ALERT = 2, I_CHASE = 3, I_ATTACK = 4, I_DEAD = 5;

/** [x, y, z, yaw, what it is doing, who it is after (a player's number, 0 nobody)] */
export type IState = [number, number, number, number, number, number];

export interface InfectedInfo {
  i: number;
  s: IState;
  hp: number;
  /** the player whose game moves it (null: nobody is near enough, it stands where it is) */
  own: number | null;
  /** where it lives: it turned up there, and goes back there when it has nobody to be after */
  h: [number, number];
}

/**
 * Whether a blow from `fx, fz` is stopped by somebody standing at `x, z` and facing `yaw`
 * (0 looks down -z) with their guard up: only from in front of them.
 */
export function guarded(x: number, z: number, yaw: number, fx: number, fz: number): boolean {
  const to = Math.atan2(-(fx - x), -(fz - z));
  return Math.abs(Math.atan2(Math.sin(to - yaw), Math.cos(to - yaw))) < INFECTED.guardArc;
}

/** somewhere they live: the middle of it, how far out they are found, and how many */
export interface Home {
  x: number;
  z: number;
  r: number;
  n: number;
  /** a place that is not open ground (the bunker): the spots they turn up at, and no others */
  inside?: [number, number, number][];
}

// (the outlying places are where somebody new finds a first weapon: one or two there, the crowd in the village)
const ABOUT: Record<string, number> = { hamlet: 4, depot: 4, post: 3, yard: 2, farm: 2, lodge: 1, dacha: 1, works: 0, bunker: 0 };
/** how many keep to the works (said apart from the small places: it comes high in the list, so it is never the one that goes short) */
const AT_WORKS = 6;
/** and how many are shut in the bunker, in the dark */
const IN_BUNKER = 12;
/** and how many walk the ground over it, in its gas */
const OVER_BUNKER = 9;
/** how far from the middle of the works one that turned up there may have done so */
const WORKS_REACH = 62;

/**
 * Where the infected of the bunker turn up: down its two passages and just inside its rooms,
 * clear of everything that stands there.
 */
export function bunkerSpots(world: World): [number, number, number][] {
  const P = bunkerPlace(world);
  if (!P) return [];
  const plan = bunkerPlan(), H = BUNKER.hall, out: [number, number, number][] = [];
  const clear = (r: number, f: number) => Math.abs(r) < H.r - 0.8 && f > H.back + 0.8 && f < H.front - 0.8
    && !plan.stood.some((s) => Math.hypot(s.r - r, s.f - f) < 1.4)
    && !plan.made.some((m) => m.solid !== false && Math.hypot(m.r - r, m.f - f) < 1.0 + Math.max(m.w, m.d) / 2);
  const put = (r: number, f: number) => void (clear(r, f) && out.push(bunkerAt(P, r, f, levelY())));
  for (let f = H.front - 6; f > H.back + 2; f -= 4) put(0, f);
  for (let r = -H.r + 3; r < H.r - 2; r += 4) if (Math.abs(r) > BUNKER.passage + 1.5) put(r, plan.cross);
  for (const q of plan.rooms) {
    // (a step inside each of its ways in: there are more of those than there were, and more standing in its middle)
    const cr = (q.r0 + q.r1) / 2, cf = (q.f0 + q.f1) / 2;
    for (const [dr, df] of q.doors) {
      const d = Math.hypot(cr - dr, cf - df) || 1;
      put(dr + ((cr - dr) / d) * 1.6, df + ((cf - df) / d) * 1.6);
    }
  }
  return out;
}

/**
 * Whether one that turned up at a spot is one of the gas or of the bunker: those wear the
 * orange suit. (Every game says the same of each: it goes by where it turned up.)
 */
export function suited(world: World, x: number, z: number): boolean {
  const works = world.sites.find((s) => s.kind === 'works');
  if (works && Math.hypot(x - works.x, z - works.z) < WORKS_REACH + 2) return true;
  // (and every one within the bunker's gas, above ground or below)
  const bunker = world.sites.find((q) => q.kind === 'bunker');
  return !!bunker && Math.hypot(x - bunker.x, z - bunker.z) < 56;
}

/** Where the infected live: the village most of all, the checkpoint, and a few about every outlying place. */
export function infectedHomes(world: World): Home[] {
  const homes: Home[] = [];
  const village = world.pois[0];
  if (village) homes.push({ x: village.x, z: village.z, r: Math.max(70, village.radius), n: 13 });
  const camp = world.pois.find((p) => p.name === 'Military Checkpoint');
  if (camp) homes.push({ x: camp.x, z: camp.z, r: 38, n: 5 });
  const works = world.sites.find((s) => s.kind === 'works');
  if (works) homes.push({ x: works.x, z: works.z, r: WORKS_REACH, n: AT_WORKS });
  const below = bunkerSpots(world), bunker = world.sites.find((s) => s.kind === 'bunker');
  if (bunker && below.length) homes.push({ x: bunker.x, z: bunker.z, r: 30, n: IN_BUNKER, inside: below });
  if (bunker) homes.push({ x: bunker.x, z: bunker.z, r: 40, n: OVER_BUNKER });
  for (const s of world.sites) homes.push({ x: s.x, z: s.z, r: 34, n: ABOUT[s.kind] ?? 1 });
  // (never more than the map is meant to hold: the places furthest down the list go short)
  let left = INFECTED.max;
  for (const h of homes) {
    h.n = Math.min(h.n, left);
    left -= h.n;
  }
  return homes.filter((h) => h.n > 0);
}

/** Open ground: not in a building, a tree, a rock or a prop, and not on a slope. */
export function openGround(world: World, x: number, z: number) {
  // (the ground as it is seen: over the bunker that is its roof, not the bottom of the hole under it)
  const h0 = heightAt(world.surface, x, z);
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (Math.abs(heightAt(world.surface, x + dx, z + dz) - h0) > 0.9) return false;
  for (const b of world.buildings) {
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const dx = x - b.x, dz = z - b.z;
    const [w, d] = BUILDING_FOOTPRINT[b.type];
    if (Math.abs(dx * c - dz * s) < w / 2 + 1.6 && Math.abs(dx * s + dz * c) < d / 2 + 1.6) return false;
  }
  const near = (list: { x: number; z: number }[], r: number) => list.some((t) => Math.abs(t.x - x) < r && Math.abs(t.z - z) < r && Math.hypot(t.x - x, t.z - z) < r);
  if (world.solids.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 1.6)) return false;
  return !near(world.trees, 1.8) && !near(world.rocks, 2.2) && !near(world.props, 1.6);
}

/** A place to stand one about a home, or null if a dozen tries found none. */
export function homeSpot(world: World, home: Home, rnd: () => number): { x: number; y: number; z: number } | null {
  if (home.inside) {
    const at = home.inside[Math.floor(rnd() * home.inside.length)];
    return at ? { x: at[0], y: at[1], z: at[2] } : null;
  }
  for (let k = 0; k < 14; k++) {
    const a = rnd() * Math.PI * 2, r = home.r * (0.25 + 0.75 * Math.sqrt(rnd()));
    const x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
    if (openGround(world, x, z)) return { x, y: heightAt(world.surface, x, z), z };
  }
  return null;
}

export interface Body extends InfectedInfo {
  home: number;
  /** when it died (0: alive), and when its owner last said where it was */
  diedAt: number;
  heard: number;
  /** when a blow of its was last believed */
  struck: number;
}

export interface Somebody {
  id: number;
  x: number;
  z: number;
}

/** What the director's clock turned up: new ones, ones cleared away, and ones whose game has changed. */
export interface Turn {
  added: Body[];
  gone: number[];
  owned: [number, number | null][];
}

export class Director {
  readonly bodies = new Map<number, Body>();
  private next = 1;
  /** homes owed one: which, and when */
  private due: { home: number; at: number }[] = [];

  constructor(private homes: Home[], private spot: (home: Home) => { x: number; y: number; z: number } | null, private rnd: () => number = Math.random) {
    homes.forEach((h, k) => {
      for (let n = 0; n < h.n; n++) this.due.push({ home: k, at: 0 });
    });
  }

  /** one more about a home, somewhere nobody living is near enough to watch it appear (null: no such spot this time) */
  private stand(home: number, now: number, living: Somebody[]): Body | null {
    const at = this.spot(this.homes[home]);
    if (!at || living.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < INFECTED.clear)) return null;
    // (and not where another of them is standing: two in one place can neither of them move)
    for (const o of this.bodies.values()) if (!o.diedAt && Math.hypot(o.s[0] - at.x, o.s[2] - at.z) < 1.5 && Math.abs(o.s[1] - at.y) < 2) return null;
    const b: Body = { i: this.next++, s: [at.x, at.y, at.z, this.rnd() * Math.PI * 2, I_IDLE, 0], hp: INFECTED.hp, own: null, h: [Math.round(at.x * 10) / 10, Math.round(at.z * 10) / 10], home, diedAt: 0, heard: now, struck: 0 };
    this.bodies.set(b.i, b);
    return b;
  }

  /**
   * Once a second or so. `living` is everybody alive, with where they stand.
   * @param now milliseconds
   */
  tick(now: number, living: Somebody[]): Turn {
    const turn: Turn = { added: [], gone: [], owned: [] };
    for (const b of [...this.bodies.values()]) {
      if (b.diedAt && now - b.diedAt > INFECTED.linger * 1000) {
        this.bodies.delete(b.i);
        turn.gone.push(b.i);
        this.due.push({ home: b.home, at: now + INFECTED.respawn * 1000 });
      }
    }
    // The ones that are owed. (It is the spot that has to be clear of the living, not the
    // whole place: somebody is nearly always somewhere in the village, and it would never
    // fill again.)
    for (const d of [...this.due]) {
      if (now < d.at) continue;
      const b = this.stand(d.home, now, living);
      if (!b) continue;
      this.due.splice(this.due.indexOf(d), 1);
      turn.added.push(b);
    }
    // whose game moves each: the nearest living player's, kept until they are well out of range or somebody is much nearer
    for (const b of this.bodies.values()) {
      if (b.diedAt) continue;
      let best: Somebody | null = null, bd = INFECTED.own;
      for (const p of living) {
        const d = Math.hypot(p.x - b.s[0], p.z - b.s[2]);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      const cur = b.own === null ? undefined : living.find((p) => p.id === b.own);
      const curD = cur ? Math.hypot(cur.x - b.s[0], cur.z - b.s[2]) : Infinity;
      if (cur && curD < INFECTED.own * 1.2 && (!best || best.id === cur.id || bd > curD * 0.6)) continue;
      const to = best?.id ?? null;
      if (to === b.own) continue;
      b.own = to;
      b.heard = now;
      if (to === null) {
        b.s[4] = I_IDLE;
        b.s[5] = 0;
      }
      turn.owned.push([b.i, to]);
    }
    return turn;
  }

  /** Where the game that moves some of them says they are. What is believed is kept and returned, to be passed on. */
  report(by: number, rows: unknown, now: number): [number, ...IState][] {
    const out: [number, ...IState][] = [];
    if (!Array.isArray(rows)) return out;
    for (const r of rows.slice(0, 64)) {
      if (!Array.isArray(r) || r.length !== 7 || !r.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
      const b = this.bodies.get(r[0]);
      if (!b || b.diedAt || b.own !== by) continue;
      const [x, y, z, yaw, mode, after] = r.slice(1) as IState;
      if (Math.abs(x) > 600 || Math.abs(z) > 600 || Math.abs(y) > 500 || mode < I_IDLE || mode > I_ATTACK) continue;
      // no further than it could have run since it was last heard of (with room for a late message)
      const dt = Math.min(3, (now - b.heard) / 1000);
      if (Math.hypot(x - b.s[0], z - b.s[2]) > INFECTED.chase * 1.5 * dt + 2.5) continue;
      b.s = [x, y, z, yaw, Math.round(mode), Math.round(after)];
      b.heard = now;
      out.push([b.i, ...b.s]);
    }
    return out;
  }

  /**
   * A blow: believed when it is that game's to move, it is standing by whoever it hit, and
   * its arm has had time to come round again.
   */
  strikes(i: number, by: number, at: Somebody | undefined, now: number): boolean {
    const b = this.bodies.get(i);
    if (!b || b.diedAt || b.own !== by || !at) return false;
    if (Math.hypot(at.x - b.s[0], at.z - b.s[2]) > INFECTED.reach + 1.6) return false;
    if (now - b.struck < INFECTED.swing * 800) return false;
    b.struck = now;
    return true;
  }

  /** It was hit. What it has left, and whether that was the end of it; null if there is no such body standing. */
  hurt(i: number, amount: number, now: number): { hp: number; dead: boolean } | null {
    const b = this.bodies.get(i);
    if (!b || b.diedAt || !(amount > 0)) return null;
    b.hp = Math.max(0, b.hp - amount);
    if (b.hp <= 0) {
      b.diedAt = now;
      b.s[4] = I_DEAD;
      b.s[5] = 0;
      b.own = null;
    }
    return { hp: b.hp, dead: b.hp <= 0 };
  }

  /** everything standing or lying, for somebody who has just arrived */
  list(): InfectedInfo[] {
    return [...this.bodies.values()].map((b) => ({ i: b.i, s: b.s, hp: b.hp, own: b.own, h: b.h }));
  }
}
