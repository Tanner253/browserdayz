// What one of the server's survivors can see, and how soon (2026-11-15). The owner: "polish the ai in zona so that
// they behave and play like real players, realistic. If the ai doesn't have LOS then they shouldnt be able to see the
// user". Nobody is known of through a wall, a hill, a door or a bush; nobody behind it is seen at all but at arm's
// length; and one in view is not known at once: it takes the time a person takes, longer the further off, the lower
// they are, and out of the corner of its eye, shorter when they run.

import { F_CROUCH, F_PRONE, type Pose } from '../src/net/protocol';
import type { Ground } from '../src/sim/animal-ground';
import type { Vec3 } from '../src/sim/grenades';
import { world } from './index';
import { solid } from './solid';
import { roundClear, sightClear } from './walls';
import { doorAcross } from './npc-doors';

let ground: Ground;
export const sightOn = (g: Ground) => void (ground = g);

export const SIGHT = {
  /** sees a standing player this far in the open in front of it; less of one crouched, lying, or in the trees */
  sees: 75,
  /** and this far once it is looking for somebody: it has heard a shot, taken a round, or is in a fight */
  feels: 130,
  /** in front of it, radians either side; past that the corner of its eye, to `edge`; past that its back */
  cone: 1.05,
  edge: 1.75,
};

export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const yawTo = (ax: number, az: number, bx: number, bz: number) => Math.atan2(-(bx - ax), -(bz - az));
export const eyeOf = (p: Pose): Vec3 => [p[0], p[1] + (p[5] & F_PRONE ? 0.35 : p[5] & F_CROUCH ? 1.0 : 1.58), p[2]];

/** whether nothing stands between two places: no hill, none of the map's walls, no base's, no door */
export function clear(a: Vec3, b: Vec3, round = false) {
  // (the ground looked at every two metres of the line, and the line kept clear of it: at eight places a line, the
  // crest of a hill between two of them was not there at all. The owner, 2026-11-15: "ais are shooting through the
  // ground, theyre on the peaks of hills but the player cannot see them")
  const n = Math.max(8, Math.min(80, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 2)));
  for (let k = 1; k < n; k++) {
    const t = k / n;
    if (world.groundAt(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t) > a[1] + (b[1] - a[1]) * t - 0.05) return false;
  }
  return solid.clear(a, b) && (round ? roundClear(a, b) : sightClear(a, b)) && doorAcross(a, b, false) < 0;
}

/**
 * How many seconds of having them in view it takes to know of them; Infinity where it cannot see them at all: too
 * far, behind it, or nothing of them (chest or head) in a clear line from its eyes. `keen`: it is looking for somebody.
 */
export function noticeIn(me: Pose, them: Pose, keen: boolean, speed: number): number {
  const d = Math.hypot(them[0] - me[0], them[2] - me[2]), off = Math.abs(wrap(yawTo(me[0], me[2], them[0], them[2]) - me[3]));
  const low = them[5] & F_PRONE ? 2 : them[5] & F_CROUCH ? 1 : 0;
  let reach = keen ? SIGHT.feels : SIGHT.sees, slow = 1;
  // (looking for somebody it still sees less of one who is down or in the trees: it does not know where they are)
  reach *= low === 2 ? (keen ? 0.55 : 0.4) : low === 1 ? (keen ? 0.8 : 0.7) : 1;
  if (ground.cover(them[0], them[2]) > 0.55) reach *= keen ? 0.75 : 0.7;
  // (behind it: only one near enough to be heard walking)
  if (off > SIGHT.edge) {
    if (d > (keen ? 15 : 6)) return Infinity;
    slow = 2;
  } else if (off > SIGHT.cone) slow = 2.5;
  if (d > reach) return Infinity;
  const eye = eyeOf(me), chest = low === 2 ? 0.3 : low === 1 ? 0.8 : 1.15, head = low === 2 ? 0.35 : low === 1 ? 1.0 : 1.6;
  if (!clear(eye, [them[0], them[1] + chest, them[2]]) && !clear(eye, [them[0], them[1] + head, them[2]])) return Infinity;
  return (0.25 + 1.9 * (d / SIGHT.sees)) * slow * (low === 2 ? 2.2 : low === 1 ? 1.4 : 1) * (speed > 3 ? 0.6 : 1);
}
