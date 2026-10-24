// Campfires. The rings of stones at the lodges, the cabins and the hamlet can be lit. A fire
// is somewhere to mend: resting beside one puts health back far faster than it comes back on
// its own, and what is eaten beside one does more good hot. It is also the one thing on the
// map that says where somebody is: its smoke stands over the trees, and the infected come to
// the sound of it.
//
// Rules and data only. The server keeps which are alight and tells everybody (playing alone,
// the game keeps it); the game draws them (src/game/fires.ts).

import type { Instance } from '../world/worldgen';

export const FIRE = {
  /** the prop that is a fireplace */
  kind: 'stone_fire_pit',
  /** how near one has to be stood to light it, metres */
  reach: 2.6,
  /** seconds of work to get one going */
  lighting: 3,
  /** seconds one burns before it is ash, and has to be lit again */
  burns: 300,
  /** how near one that is alight a survivor is resting by it, metres */
  warm: 3.6,
  /** health a second, resting by one (not while bleeding: a wound wants dressing, not warming) */
  heal: 0.8,
  /** what is eaten or drunk beside one does this many times the good */
  meal: 1.4,
  /** the infected hear one from this far off, every so many seconds, metres and seconds */
  heard: 18,
  crackle: 8,
  /**
   * A fire built from firewood where somebody stands (2026-10-23, the owner: "we need ways to cook the food"; DayZ's
   * fireplace, Rust's campfire): how many a player may have standing, and the whole map; how far from where they
   * stand; the most it can be fed up to, seconds; and how long a built one that has burned out stays before it is
   * cleared away, seconds.
   */
  built: { each: 3, most: 40, reach: 2.5, most_burn: 1500, cold: 600 },
};

/**
 * Whether somebody standing at (x, y, z), their feet, is resting by a fire whose middle is `s`, at the ground: near
 * enough (FIRE.warm), and not a floor above or below it. Asked of a fire that burns for good and is no fireplace
 * (the jeep before the fort's gate: src/sim/wreck-fire.ts); a fireplace that is alight is asked the same of by the game.
 */
export function restsBy(s: { x: number; y: number; z: number }, x: number, y: number, z: number): boolean {
  return Math.hypot(s.x - x, s.z - z) < FIRE.warm && Math.abs(s.y - y) < 2.5;
}

/** Every fireplace in the world, in the order the game and the server both count them. */
export function fireSpots(props: Instance[]): Instance[] {
  return props.filter((p) => p.kind === FIRE.kind);
}

/**
 * Which fires are alight, by whoever keeps count (the server, or the game playing alone).
 * Time is the keeper's own, in seconds.
 */
export class Hearths {
  /** when each that is alight burns out */
  private until = new Map<number, number>();
  /** the fires built where somebody stood (numbered after the map's own): where, by whom, when it went out (0: alight) */
  readonly built = new Map<number, { x: number; y: number; z: number; by: number; out: number }>();

  private readonly mapFires: number;

  constructor(readonly spots: { x: number; z: number }[]) {
    this.mapFires = spots.length;
  }

  /** is it one built by somebody (past the map's own) */
  isBuilt(i: number): boolean {
    return i >= this.mapFires;
  }

  /**
   * A fire built from firewood (FIRE.built), alight from now: its number, or -1 (too many standing, theirs or the
   * map's). Numbers are never used twice: a fire cleared away leaves a gap.
   */
  build(x: number, y: number, z: number, by: number, now: number): number {
    const standing = [...this.built.values()];
    if (standing.length >= FIRE.built.most || standing.filter((b) => b.by === by).length >= FIRE.built.each) return -1;
    const i = this.spots.length;
    this.spots.push({ x, z });
    this.built.set(i, { x, y, z, by, out: 0 });
    this.until.set(i, now + FIRE.burns);
    return i;
  }

  /** Wood put on a fire somebody at (x, z) stands at: so many seconds more of it (FIRE.built.most_burn at the most). False: it is not alight, or they are not at it. */
  feed(i: number, seconds: number, x: number, z: number, now: number, slack = 0): boolean {
    const s = this.spots[i];
    if (!Number.isInteger(i) || !s || this.left(i, now) <= 0 || Math.hypot(s.x - x, s.z - z) > FIRE.reach + slack) return false;
    this.until.set(i, Math.min(now + FIRE.built.most_burn, (this.until.get(i) ?? now) + seconds));
    return true;
  }

  /** the built fires that have stood cold long enough to be cleared away, now gone */
  cleared(now: number): number[] {
    const gone: number[] = [];
    for (const [i, b] of this.built) {
      if (this.left(i, now) > 0) b.out = 0;
      else if (!b.out) b.out = now;
      else if (now - b.out > FIRE.built.cold) {
        this.built.delete(i);
        gone.push(i);
      }
    }
    return gone;
  }

  /** seconds of burning one has left (0 = out) */
  left(i: number, now: number): number {
    return Math.max(0, (this.until.get(i) ?? 0) - now);
  }

  /**
   * Somebody standing at (x, z) lights fireplace `i`. False if there is no such fireplace, they
   * are not beside it, or it is burning already.
   * @param slack how much further off than the rule says is still believed (a moving player, told late)
   */
  light(i: number, x: number, z: number, now: number, slack = 0): boolean {
    const s = this.spots[i];
    if (!Number.isInteger(i) || !s || this.left(i, now) > 0) return false;
    // (a built one cleared away is gone: nothing is lit where it stood)
    if (i >= this.spots.length || (this.isBuilt(i) && !this.built.has(i))) return false;
    if (Math.hypot(s.x - x, s.z - z) > FIRE.reach + slack) return false;
    this.until.set(i, now + FIRE.burns);
    return true;
  }

  /** every one alight now, and how long each has left: what somebody arriving is told */
  alight(now: number): [number, number][] {
    const out: [number, number][] = [];
    for (const [i, t] of this.until) {
      if (t > now) out.push([i, Math.round(t - now)]);
      else this.until.delete(i);
    }
    return out;
  }
}
