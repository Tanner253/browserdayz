// A thing thrown from somebody's hands, as the server believes it (src/sim/throw.ts has the throw itself): told as it
// leaves the hand ('toss': from where, how fast, at what power), and believed where its game then says it came to rest
// (the 'drop' that follows) only as far from there as that throw could carry it. Not higher than it could rise, not
// over a hill it could not clear, and not out of the ground or into it. (The server has no walls: a game flies it
// against its own, as it does a grenade.) What is put down without a throw is an ordinary drop. test/throw.test.ts.

import { THROW, apex, fastest, throwReach, type V3 } from '../src/sim/throw';

export interface Toss {
  from: V3;
  power: number;
  at: number;
}

/** each player's throws still in the air, by the thing's uid; and when they last threw */
const tosses = new WeakMap<object, { air: Map<string, Toss>; last: number }>();

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown): v is V3 => Array.isArray(v) && v.length === 3 && v.every(num);

/**
 * A game says a thing has left its player's hand: from `o`, at `v`, with this much power, its player standing at `feet`.
 * Believed if it leaves from about where they stand, no faster than that power throws, and not sooner after the last
 * than an arm throws again. @returns what is kept of it until it comes down; null if it is not believed
 */
export function tossed(who: object, uid: unknown, o: unknown, v: unknown, power: unknown, feet: V3, now: number): Toss | null {
  if (typeof uid !== 'string' || !uid || uid.length > 80 || !vec(o) || !vec(v) || !num(power) || power < 0 || power > 1) return null;
  if (Math.hypot(o[0] - feet[0], o[2] - feet[2]) > THROW.from || o[1] - feet[1] > THROW.up || o[1] - feet[1] < -0.5) return null;
  if (Math.hypot(v[0], v[1], v[2]) > fastest(power) + 0.25) return null;
  let mine = tosses.get(who);
  if (!mine) tosses.set(who, (mine = { air: new Map(), last: -Infinity }));
  if (now - mine.last < THROW.gap) return null;
  mine.last = now;
  for (const [k, t] of mine.air) if (now - t.at > THROW.keepFor) mine.air.delete(k);
  // (a few in the air at once, and no more: the oldest let go of)
  if (mine.air.size >= 8) mine.air.delete(mine.air.keys().next().value!);
  const t: Toss = { from: [o[0], o[1], o[2]], power, at: now };
  mine.air.set(uid, t);
  return t;
}

/**
 * Where a thing a player put down came to rest. Thrown (a toss of it is waiting), it is believed within the reach of
 * that throw from where it left the hand: 'ok', or why not. Not thrown: 'free', and it is an ordinary drop.
 * @param ground the height of the ground under a point
 */
export function landing(who: object, uid: string, at: V3, ground: (x: number, z: number) => number, now: number): 'free' | 'ok' | string {
  const t = tosses.get(who)?.air.get(uid);
  if (!t || now - t.at > THROW.keepFor) return 'free';
  tosses.get(who)!.air.delete(uid);
  const [fx, fy, fz] = t.from, d = Math.hypot(at[0] - fx, at[2] - fz), reach = throwReach(t.power, fy - at[1]);
  if (reach < 0) return `higher than the throw rises (${(at[1] - fy).toFixed(1)} m up)`;
  if (d > reach) return `further than the throw carries (${d.toFixed(1)} m, at most ${reach.toFixed(1)})`;
  // under the ground where it left or where it lies, and not the other (the bunker, a cellar, a cave): no further than a drop
  const under = (x: number, y: number, z: number) => y < ground(x, z) - 2;
  if (under(fx, fy, fz) !== under(at[0], at[1], at[2]) && d > 3) return 'out of the ground or into it';
  // over the ground between: no higher than the throw can rise above the higher of its two ends
  const top = Math.max(fy, at[1]) + apex(t.power) + 0.5;
  for (let s = 2; s < d - 1; s += 2) {
    const k = s / d;
    if (ground(fx + (at[0] - fx) * k, fz + (at[2] - fz) * k) > top) return 'over ground higher than the throw rises';
  }
  return 'ok';
}
