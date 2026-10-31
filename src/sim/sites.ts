// The way down's stops out in the world (the owner, 2026-10-31: "go out into the world to a new poi and use it there which
// unlocks a special high tier loot room there and an alarm and a zombie event that gives the red card"; the plan,
// marketing/plan-grand-tour.html). A card from the bunker goes in a reader: a strong room opens, a siren goes, the infected
// come for as long as `hold` says, and the end of it gives the next card. Then the place is spent for a while. The rules
// only: the server runs it (server/sites.ts), and every number is here.

import { STOLOVAYA } from './outposts';
import { townPoint, type Town } from './towns';

export type SitePhase = 'idle' | 'alarm' | 'spent';

export interface Site {
  town: Town;
  name: string;
  /** the card that starts it, and the one its end gives */
  card: string;
  gives: string;
  /** the strong room's middle and where the reader stands, in the town's frame */
  room: [number, number];
  reader: [number, number];
  /** where its crates are set down, in the town's frame: the strong room's as the alarm goes, the locker's at the end of it */
  crate: [number, number];
  locker: [number, number];
  /** how long the alarm lasts, seconds, and how long the place is spent after it */
  hold: number;
  again: number;
  /** how far off the siren is heard by the infected, metres */
  heard: number;
  /** how often the infected come, seconds; how many each time; the most on their feet at once; and how far out they start, metres */
  wave: { every: number; n: number; most: number; from: [number, number] };
}

export const SITES: Record<string, Site> = {
  stolovaya: {
    town: STOLOVAYA, name: 'Stolovaya', card: 'card_blue', gives: 'card_yellow',
    room: [22, -10], reader: [18.7, -12.3], crate: [22.2, -9], locker: [16.4, -7.6],
    hold: 240, again: 1800, heard: 90,
    wave: { every: 28, n: 7, most: 26, from: [24, 42] },
  },
};

/** a place of a site's in the world */
export const sitePoint = (s: Site, p: [number, number]): [number, number] => townPoint(s.town, p[0], p[1]);

/** which of a world's doors is a site's strong room's: the nearest to its middle */
export function strongDoor(s: Site, at: (i: number) => [number, number] | null, count: number): number {
  const [x, z] = sitePoint(s, s.room);
  let best = -1, near = 6;
  for (let i = 0; i < count; i++) {
    const d = at(i);
    if (!d) continue;
    const e = Math.hypot(d[0] - x, d[1] - z);
    if (e < near) {
      near = e;
      best = i;
    }
  }
  return best;
}

/** where one of the infected of a wave starts: `k` of `n`, on a ring about the reader, a turn apart and never in one place */
export function waveSpot(s: Site, k: number, n: number, roll: () => number): [number, number] {
  const [x, z] = sitePoint(s, s.reader), a = ((k + roll() * 0.7) / n) * Math.PI * 2, r = s.wave.from[0] + roll() * (s.wave.from[1] - s.wave.from[0]);
  return [x + Math.cos(a) * r, z + Math.sin(a) * r];
}
