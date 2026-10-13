// Steep ground: what legs can do on it. (2026-10-13: "We should make super steep hills slow to walk up, and
// slippery to fall down dealing fall damage like a normal game. But I really dislike when games prevent the player
// from walking up hills as a personal pet peeve so we need middle ground. The land should be traversal but also
// realistic.")
//
// Before this a body walked up anything under fifty degrees at its full pace, stood dead against anything over it,
// and walked down a seventy degree face at a jog without a scratch. Now there is no wall anywhere and no free way
// down. By how steep the ground under the feet is (rise over run: 1 is forty-five degrees):
//
//   under 33°   an ordinary hillside. Nothing here applies: seven tenths of the map, and all but a two-hundredth of
//               the valley floor.
//   33° to 50°  steep. Going up, the pace is held to less and less (a sprint is a walk by forty degrees, a walk a
//               trudge by fifty) and costs breath. Going down, a walker is carried faster than they walk and cannot
//               stop dead; from 42° they cannot stop at all but by turning across the slope or going down on a knee.
//   50° to 60°  a scramble on hands and feet, up or across: slow, hard on the breath, nothing held up to aim, and
//               no sprint or jump. Going down there is no footing: it is a slide.
//   over 60°    a climb. It goes only while there is breath, even to hang on where one is: out of breath, a slide.
//
// What counts going up is how steep the WAY is, not the face: a face taken at a slant is a gentler climb, as a path
// with hairpins is, so a slope too steep to go straight up can be gone up across. A slide gathers pace with the
// drop and is a fall when it ends: the game's own rule for a landing (src/game/player.ts, `land`) is given how
// fast the body was coming down, so a short slide costs nothing and a long one down a cliff breaks a leg.
//
// Rules only: no physics and nothing drawn. The survivor's legs obey it (src/game/player.ts), and so do the
// infected's (src/game/infected.ts).

import { paceOf, runCost } from './load';

/** how a body stands: on its feet; on hands and feet; or not at all, and sliding */
export type Footing = 'firm' | 'scramble' | 'slide';

const RAD = Math.PI / 180;
/** the rise over run of a slope of so many degrees, and the degrees of one of so much rise over run */
export const riseOf = (deg: number) => Math.tan(deg * RAD);
export const degOf = (rise: number) => Math.atan(Math.max(0, rise)) / RAD;

/** The lines between one kind of ground and the next, degrees. */
export const SLOPE = {
  /** an ordinary hillside ends here: under it nothing in this file applies */
  steep: 33,
  /** across a face the feet are sure up to here, and are not carried down it */
  sure: 38,
  /** going down, from here a walk cannot be stopped but by turning across or crouching */
  carried: 42,
  /** hands and feet going up or across; no footing going down */
  scramble: 50,
  /** held only while there is breath */
  climb: 60,
  /** a slide that has begun goes on until the ground is this gentle */
  holds: 40,
};

/** a line through points: what it is worth at `x`, level beyond either end */
function along(pts: [number, number][], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (x > x1) continue;
    const [x0, y0] = pts[i - 1];
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}

/**
 * The most that is made going up a way so steep, metres a second along it. (A jog is 4, a sprint 6.2, with empty
 * hands 7.4: so up to 33° nothing is held back, a sprint is a jog by 42°, and a jog is cut from there.) Never
 * nothing: the steepest face on the map is 76°, and that goes at half a metre a second.
 */
const UP: [number, number][] = [[SLOPE.steep, 7.5], [40, 5], [45, 3.2], [SLOPE.scramble, 2], [SLOPE.climb, 1.1], [70, 0.65], [76, 0.5]];
/** the most that is made going any way but down on a face so steep: the feet have to be placed */
const SIDE: [number, number][] = [[SLOPE.sure, 7.5], [45, 4.5], [SLOPE.scramble, 3], [SLOPE.climb, 1.6], [70, 1], [76, 0.8]];
/** how fast a body going across a face is carried down it, metres a second over the ground (on a steep face each of those is two or three of height) */
const DRIFT: [number, number][] = [[SLOPE.sure, 0], [SLOPE.scramble, 0.25], [SLOPE.climb, 0.4], [76, 0.5]];
/** breath a second going up a way so steep (a sprint on the level takes 11; there are 300 to spend) */
const COST: [number, number][] = [[SLOPE.steep, 0], [SLOPE.scramble, 8], [SLOPE.climb, 16], [70, 26]];
/** how much faster than its own pace a walk downhill goes; how much of the power to stop is left; how fast it is carried on whatever is asked */
const CARRY: [number, number][] = [[SLOPE.steep, 1], [SLOPE.scramble, 1.35]];
const BRAKE: [number, number][] = [[SLOPE.steep, 1], [SLOPE.scramble, 0.15]];
const RUNS_ON: [number, number][] = [[SLOPE.carried, 0], [SLOPE.scramble, 2.4]];

export const LEGS = {
  /** a sprint that the slope holds to less than this is no sprint: it is not begun, and costs nothing (a jog and a tenth) */
  sprint: 4.4,
  /** out of breath on a scramble, this much of the pace is left */
  spent: 0.4,
  /** on a broken leg, this much of it (on top of the limp); and that much more breath */
  lame: 0.6,
  lameCost: 1.5,
  /** breath a second only to hang on to a climb, going nowhere */
  cling: 6,
  /** how far from straight across the way asked must point downhill before a body on a scramble lets itself go (the cosine of it, as `up` is) */
  letGo: -0.35,
};

/** who is asking: how they are down on the ground, and what they have to carry */
export interface Body {
  /** down on a knee, or on the belly: surer of the ground, and slower to slide */
  low?: boolean;
  /** a broken leg */
  broken?: boolean;
  /** kilograms carried. What they do to legs is one rule everywhere (src/sim/load.ts): a climb takes that many times the breath, as a sprint on the level does, and is slowed only by a load past all running with */
  kg?: number;
  /** out of breath */
  winded?: boolean;
}

/** what the ground lets the legs do */
export interface Legs {
  /** the most that is made the way asked, metres a second along that way (Infinity: the ground does not hold it back) */
  pace: number;
  /** how many times its own pace a body going downhill is carried at (1: no faster) */
  carried: number;
  /** once it is going downhill it goes on at this, metres a second, whatever is asked (0: it can stop) */
  runsOn: number;
  /** how much of the legs' power to stop is left against going downhill, 1 (all of it) to 0 */
  brake: number;
  /** metres a second it is carried down the face while it goes across it */
  drift: number;
  /** breath a second, going at that pace */
  cost: number;
  /** breath a second standing where it is (a climb is hung on to) */
  cling: number;
  /** on hands and feet when it moves: nothing is held up to aim */
  hands: boolean;
  /** may it be sprinted here; may the feet leave it in a jump */
  sprint: boolean;
  jump: boolean;
  /** the feet do not hold: going this way, or standing here like this, is a slide */
  slides: boolean;
}

const FIRM: Legs = { pace: Infinity, carried: 1, runsOn: 0, brake: 1, drift: 0, cost: 0, cling: 0, hands: false, sprint: true, jump: true, slides: false };

/**
 * What legs can do on ground of a given steepness, going a given way.
 * @param rise how steep the ground under the feet is, rise over run
 * @param up which way is asked, against the fall line: 1 straight up it, 0 across it (or standing), -1 straight down
 */
export function legs(rise: number, up: number, body: Body = {}): Legs {
  const face = degOf(rise);
  if (face < SLOPE.steep) return FIRM;
  const climbs = Math.max(0, up), across = Math.sqrt(Math.max(0, 1 - up * up));
  // (a face taken at a slant is a gentler way up)
  const way = degOf(rise * climbs);
  const kg = body.kg ?? 0;
  const fit = paceOf(kg) * (body.broken ? LEGS.lame : 1), toil = runCost(kg) * (body.broken ? LEGS.lameCost : 1);
  const scramble = face >= SLOPE.scramble, climb = face >= SLOPE.climb;
  // Out of breath a climb is not held at all; and no footing going down what is a scramble going up.
  const slides = (climb && !!body.winded) || (scramble && up < LEGS.letGo);
  // Up or across, the way and the face each set a limit; down, only as much of the going as is across the face is limited.
  let pace = up >= 0 ? Math.min(along(UP, way), along(SIDE, face)) : along(SIDE, face) / Math.max(across, 1e-3);
  if (pace < 7.5) pace *= fit;
  if (scramble && body.winded) pace *= LEGS.spent;
  const moving = up >= 0 || scramble;
  // (on a scramble every way but down costs what the face costs: going across it is no rest)
  const cost = moving && !body.winded ? along(COST, scramble ? Math.max(way, face) : way) * toil : 0;
  return {
    pace: pace >= 7.5 ? Infinity : pace,
    carried: up < 0 ? 1 + (along(CARRY, face) - 1) * -up : 1,
    // (down on a knee the feet are placed: nothing runs away with a body that is low)
    runsOn: body.low ? 0 : along(RUNS_ON, face),
    brake: Math.min(1, along(BRAKE, face) * (body.low ? 2 : 1)),
    drift: along(DRIFT, face) * across * (body.low ? 0.5 : 1),
    cost,
    cling: climb ? LEGS.cling * toil : 0,
    hands: scramble,
    sprint: !scramble && (up <= 0 || pace >= LEGS.sprint),
    jump: !scramble,
    slides,
  };
}

/** The most that anything on two legs makes going up a way of so much rise over run, metres a second along it (Infinity: nothing is held back). */
export function paceUp(rise: number): number {
  const p = along(UP, degOf(rise));
  return p >= 7.5 ? Infinity : p;
}

/**
 * A slide. The body goes down the fall line, faster the further it drops, and what holds it back is the ground
 * rubbing on it: more of that down on the heels (crouched), which is how a slide is ridden. However long the
 * face and whatever ground it comes onto, it does not get over the ground faster than somebody running down an
 * ordinary hill does: where the ground eases under it, what that takes off its fall is a jolt (`slideJolt`).
 *   grip, dug  – how hard the ground rubs: standing, and crouched (what part of the weight on it)
 *   level      – the fastest a slide gets over the ground, metres a second (a sprint is 6.2)
 *   most       – and the fastest it goes along the slope, which is what it hits things at
 *   low        – how much of those a crouched slide comes to; ease – how quickly heels dug in slow it to that, a second
 *   steer      – how fast it can be worked sideways across the face, metres a second; turn – how quickly, a second
 *   begins     – going downhill this fast over the ground on a scramble, the feet have gone: it is a slide
 *   stops      – slower than this on ground that could be stood on, it is over
 *   absorb     – how much of a fall a body takes up every second without being hurt by it, metres a second: jolts
 *                that come one on another faster than that add up to one blow, so a cliff that meets a floor by
 *                way of two short banks is not three harmless bumps, and ground that eases over a long run-out
 *                costs nothing however fast the slide came onto it
 */
export const SLIDE = { grip: 0.62, dug: 1, level: 6, most: 16, low: 0.55, ease: 3, steer: 2.5, turn: 4, begins: 1.6, stops: 0.6, absorb: 10 };

/** The fastest a slide goes on ground so steep, metres a second along the slope: `level` over the ground, and never more than `most`. */
export function slideTop(rise: number, low = false): number {
  return Math.min(SLIDE.most, SLIDE.level * Math.hypot(1, rise)) * (low ? SLIDE.low : 1);
}

/**
 * How fast a slide is going a moment later.
 * @param v metres a second along the slope now @param rise the ground under it @param h seconds @param gravity what pulls a body down, m/s²
 */
export function slideOn(v: number, rise: number, h: number, low: boolean, gravity: number): number {
  const run = Math.hypot(1, rise), pull = gravity * (rise / run - (low ? SLIDE.dug : SLIDE.grip) / run), top = slideTop(rise, low);
  // (no faster than this ground lets any slide go, at once; and down to what dug-in heels allow, by degrees)
  v = Math.min(v, slideTop(rise));
  if (v > top) return Math.max(top, v - Math.max(SLIDE.ease * (v - top), -pull) * h);
  return Math.max(0, Math.min(top, v + pull * h));
}

/** How fast a slide is coming DOWN, metres a second: what the end of it is reckoned by. */
export const slideFall = (v: number, rise: number) => (v * rise) / Math.hypot(1, rise);

/**
 * What the ground takes off a slide's fall where it eases, metres a second. A slide that was coming down at
 * `fall` and comes onto ground of this `rise` at `v` along the slope keeps only as much of its fall as a slide on
 * that ground can have; the rest is a blow, reckoned as a landing at that speed is. Nothing where the ground gets
 * steeper, little where it eases by degrees, and all of the fall where a cliff meets a floor.
 */
export function slideJolt(fall: number, v: number, rise: number): number {
  return Math.max(0, fall - slideFall(Math.min(v, slideTop(rise)), rise));
}

/** Does a slide go on over ground like this at this speed: it ends where the ground eases, or where it has all but stopped on ground that can be stood on. */
export function slideGoesOn(v: number, rise: number): boolean {
  const face = degOf(rise);
  return face >= SLOPE.holds && (face >= SLOPE.scramble || v > SLIDE.stops);
}
