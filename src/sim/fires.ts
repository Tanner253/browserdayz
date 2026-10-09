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
};

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

  constructor(readonly spots: { x: number; z: number }[]) {}

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
