// A thing thrown from the hands (the owner, 2026-10-23: "i should be able to press g to drop an item in my hands and
// hold G to throw an item in my hands with power depending on how long held, and a bar to indicate, like dayz"):
// how long G is held for what power, how fast that throws it, how it flies and comes to rest, and the furthest it can
// then lie from where it left the hand. The game flies it (src/game/throwing.ts), the server believes where it says it
// came to rest no further than that (server/throws.ts). Grenades keep their own throw (src/sim/grenades.ts).

import { NADE } from './grenades';

export const THROW = {
  /** G let go sooner than this is a tap, and puts what is held down at the feet; held longer, a throw winds up, s */
  tap: 0.2,
  /** from there to the full bar, s */
  wind: 0.9,
  /** how fast the arm throws, m/s along the way the thrower looks, at the least power and the most; and how much is added upward */
  slow: 3,
  fast: 13,
  lift: 2,
  /** what it keeps of its speed when it strikes something: along the surface, and back out of it (a thing is no ball: it hardly bounces) */
  keep: 0.3,
  give: 0.12,
  /** slower than this on something level, it lies there, m/s; and however it goes, it lies still after this long, s */
  rest: 0.8,
  most: 6,
  /** how far the hand is from where the server has its thrower standing, along the ground and up, m (where they stand is told a moment late) */
  from: 2.5,
  up: 2.2,
  /** throws are not closer together than this, ms; one is waited for to come down this long, ms */
  gap: 250,
  keepFor: 20_000,
  /** and how far it may lie past the furthest its throw carries it: laid on the surface, clear of what it fell against, m */
  slack: 1.5,
} as const;

/** the power of a throw wound up for `held` seconds of G (0 to 1) */
export const powerOf = (held: number): number => Math.min(1, Math.max(0, (held - THROW.tap) / THROW.wind));

/** how fast a throw of this power leaves the hand along the way its thrower looks, m/s */
export const throwSpeed = (power: number): number => THROW.slow + (THROW.fast - THROW.slow) * Math.min(1, Math.max(0, power));

/** the fastest a throw of this power leaves the hand in all, m/s (the arm's along the look and the lift together, at the worst) */
export const fastest = (power: number): number => throwSpeed(power) + THROW.lift;

/**
 * The furthest from where it left the hand, along the ground, that a throw of this power can come to rest: thrown at the
 * best angle (it leaves `drop` metres above where it lands: more is further, less is shorter, and higher than its speed
 * can lift it is never), then what its hops along the ground can add (each keeps THROW.keep of its speed), and the slack.
 * @returns metres; -1 if it cannot come to rest that high
 */
export function throwReach(power: number, drop: number): number {
  const v = fastest(power), g = NADE.fall, under = v * v + 2 * g * drop;
  if (under < 0) return -1;
  const flown = (v / g) * Math.sqrt(under);
  // (each hop keeps THROW.keep of its speed, so carries THROW.keep squared as far as a flight from the ground at that speed: all of them together)
  const k = THROW.keep * THROW.keep, hops = ((v * v) / g) * (k / (1 - k));
  return flown + hops + THROW.slack;
}

/** how high above the higher of its two ends a throw of this power can go, m */
export const apex = (power: number): number => (fastest(power) * fastest(power)) / (2 * NADE.fall);

export type V3 = [number, number, number];

/** what a thing in flight met: how far along it went first, and which way the surface faces */
export type Met = { toi: number; normal: V3 } | null;

/**
 * One small step of a thing in flight (pos and vel are changed in place): gravity, then along its way until it meets
 * something (`hit` looks along a line: from, which way, how far). Off whatever it meets it keeps a little of its speed.
 * @returns true once it lies still
 */
export function flightStep(pos: V3, vel: V3, h: number, hit: (from: V3, dir: V3, len: number) => Met, radius = 0.08): boolean {
  vel[1] -= NADE.fall * h;
  const sx = vel[0] * h, sy = vel[1] * h, sz = vel[2] * h, len = Math.hypot(sx, sy, sz);
  if (len < 1e-7) return false;
  const dir: V3 = [sx / len, sy / len, sz / len];
  const m = hit(pos, dir, len + radius);
  if (!m) {
    pos[0] += sx;
    pos[1] += sy;
    pos[2] += sz;
    return false;
  }
  const t = Math.max(0, m.toi - radius), n = m.normal;
  pos[0] += dir[0] * t;
  pos[1] += dir[1] * t;
  pos[2] += dir[2] * t;
  // (along the surface it keeps THROW.keep of its speed, and THROW.give of what went into it comes back out: never faster than it struck)
  const into = vel[0] * n[0] + vel[1] * n[1] + vel[2] * n[2];
  for (let i = 0; i < 3; i++) vel[i] = (vel[i] - into * n[i]) * THROW.keep - into * n[i] * THROW.give;
  return Math.hypot(vel[0], vel[1], vel[2]) < THROW.rest && n[1] > 0.6;
}
