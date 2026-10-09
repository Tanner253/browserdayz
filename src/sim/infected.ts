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

import { BUILDING_FOOTPRINT, heightAt, type World } from '../world/worldgen';

export const INFECTED = {
  /** as many as are ever alive at once, over the whole map */
  max: 26,
  /** what each has to begin with: a rifle round anywhere, a pistol round in the head, three in the chest */
  hp: 90,
  /** how long a body lies there, and how long after that before another turns up about the same place, seconds */
  linger: 50,
  respawn: 210,
  /** none turns up within this of somebody living, metres */
  clear: 75,
  /** metres a second: drifting about, going to see what a noise was, and after somebody (a jog is 4, a sprint 6.2) */
  wander: 0.7,
  look: 2.4,
  chase: 5.0,
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
  /** how long they go on after somebody they can no longer see, seconds */
  forget: 7,
  /** an arm's length; how long the arm takes to come down; how long from one blow to the next; what it does */
  reach: 1.75,
  windup: 0.45,
  swing: 1.35,
  damage: 13,
  /** the chance a blow opens a wound */
  bleed: 0.28,
  /** a game moves the ones within this of its player; past it, with nobody nearer, they stand where they are */
  own: 170,
  /** the chance one has something on it worth picking up when it goes down */
  carries: 0.45,
};

/** what they had in their pockets: [what, the fewest, the most, how likely beside the others] */
const POCKETS: [string, number, number, number][] = [
  ['ammo_9mm', 3, 8, 5], ['ammo_762', 2, 5, 3], ['bandage', 1, 1, 3], ['beans', 1, 1, 3], ['sardines', 1, 1, 2],
  ['apple', 1, 1, 2], ['cigarettes', 1, 1, 3], ['watch', 1, 1, 1], ['compass', 1, 1, 1], ['knife', 1, 1, 1],
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
}

/** somewhere they live: the middle of it, how far out they are found, and how many */
export interface Home {
  x: number;
  z: number;
  r: number;
  n: number;
}

// (the outlying places are where somebody new finds a first weapon: one or two there, the crowd in the village)
const ABOUT: Record<string, number> = { hamlet: 3, depot: 3, post: 2, yard: 2, farm: 1, lodge: 1, dacha: 1 };

/** Where the infected live: the village most of all, the checkpoint, and a few about every outlying place. */
export function infectedHomes(world: World): Home[] {
  const homes: Home[] = [];
  const village = world.pois[0];
  if (village) homes.push({ x: village.x, z: village.z, r: Math.max(70, village.radius), n: 10 });
  const camp = world.pois.find((p) => p.name === 'Military Checkpoint');
  if (camp) homes.push({ x: camp.x, z: camp.z, r: 38, n: 4 });
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
  const h0 = heightAt(world.heights, x, z);
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (Math.abs(heightAt(world.heights, x + dx, z + dz) - h0) > 0.9) return false;
  for (const b of world.buildings) {
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const dx = x - b.x, dz = z - b.z;
    const [w, d] = BUILDING_FOOTPRINT[b.type];
    if (Math.abs(dx * c - dz * s) < w / 2 + 1.6 && Math.abs(dx * s + dz * c) < d / 2 + 1.6) return false;
  }
  const near = (list: { x: number; z: number }[], r: number) => list.some((t) => Math.abs(t.x - x) < r && Math.abs(t.z - z) < r && Math.hypot(t.x - x, t.z - z) < r);
  return !near(world.trees, 1.8) && !near(world.rocks, 2.2) && !near(world.props, 1.6);
}

/** A place to stand one about a home, or null if a dozen tries found none. */
export function homeSpot(world: World, home: Home, rnd: () => number): { x: number; y: number; z: number } | null {
  for (let k = 0; k < 14; k++) {
    const a = rnd() * Math.PI * 2, r = home.r * (0.25 + 0.75 * Math.sqrt(rnd()));
    const x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
    if (openGround(world, x, z)) return { x, y: heightAt(world.heights, x, z), z };
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
    const b: Body = { i: this.next++, s: [at.x, at.y, at.z, this.rnd() * Math.PI * 2, I_IDLE, 0], hp: INFECTED.hp, own: null, home, diedAt: 0, heard: now, struck: 0 };
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
    return [...this.bodies.values()].map((b) => ({ i: b.i, s: b.s, hp: b.hp, own: b.own }));
  }
}
