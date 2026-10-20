// The west's car places (JEEP.refill): which stand a new car this second, and how long one of theirs may stand idle away
// from home. Apart from server/index.ts so that the rules can be tried without a server (test/west-cars.test.ts).
import { JEEP } from '../src/sim/vehicles';

type Spot = { x: number; z: number };
type Car = { home: number; s: number[] };

/**
 * The west's places that stand a new car now: one that has stood empty `after` seconds with nobody on the spot, while
 * fewer than `most` of its own are within `near` metres, and while the whole map holds fewer than `cap` cars to each
 * of the west's places. Each place's empty clock is kept in `emptySince`.
 * @param from the number of the west's first place in `parks`
 * @param held a place whose own car is due back by the ordinary respawn (jeepsDue)
 * @param someoneAt somebody alive stands on the spot
 */
export function westDue(cars: Car[], parks: Spot[], from: number, now: number, emptySince: Map<number, number>, held: (home: number) => boolean, someoneAt: (p: Spot) => boolean): number[] {
  const due: number[] = [];
  let west = cars.filter((v) => v.home >= from).length;
  const most = (parks.length - from) * JEEP.refill.cap;
  for (let home = from; home < parks.length; home++) {
    const p = parks[home];
    // (its own counted only near it: one driven east is no car for the west)
    const own = cars.filter((v) => v.home === home && Math.hypot(v.s[0] - p.x, v.s[2] - p.z) < JEEP.refill.near).length;
    if (held(home) || own >= JEEP.refill.most || west >= most || cars.some((v) => Math.hypot(v.s[0] - p.x, v.s[2] - p.z) < 8)) {
      emptySince.delete(home);
      continue;
    }
    const since = emptySince.get(home) ?? emptySince.set(home, now).get(home)!;
    if (now - since < JEEP.refill.after * 1000 || someoneAt(p)) continue;
    emptySince.delete(home);
    due.push(home);
    west++;
  }
  return due;
}

/**
 * How long a car may stand with nobody at its wheel before it is taken away (JEEP.idle): one of the west's left away
 * from its place goes sooner (JEEP.refill.idle), so that the cars the west keeps giving do not stand about the east
 * for two hours holding the map's count of them full.
 */
export function idleMs(v: Car, parks: Spot[], from: number, ms: number): number {
  const p = parks[v.home];
  if (v.home < from || !p || Math.hypot(v.s[0] - p.x, v.s[2] - p.z) < JEEP.refill.near) return ms;
  return Math.min(ms, JEEP.refill.idle * 1000);
}
