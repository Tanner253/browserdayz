// Who has played lately, for the door's "N played today" (the owner, offered a true number in place of fake players
// to fill the count: "do 1 2 and 3"). One mark a player, by their key's hash (nobody's anything), made the moment
// their game first moves them in the world: a connection that never plays is never counted. Kept with the world
// (keep.ts), so a restart does not put it back to nothing; a week of it, no more.

import { keyHash } from './gate';

const DAY = 24 * 3600_000, WEEK = 7 * DAY;
const marks = new Map<string, number>();

const prune = (now: number) => {
  for (const [k, at] of marks) if (now - at > WEEK) marks.delete(k);
};

export const seen = {
  mark(key: string) {
    marks.set(keyHash(key), Date.now());
  },
  /** how many different players have been in the world in the last 24 hours */
  today(): number {
    const now = Date.now();
    let n = 0;
    for (const at of marks.values()) if (now - at <= DAY) n++;
    return n;
  },
  keep(): [string, number][] {
    prune(Date.now());
    return [...marks];
  },
  /** what was kept (or a copy that turned up late): the later mark of the two wins */
  restore(list: unknown) {
    if (!Array.isArray(list)) return;
    const now = Date.now();
    for (const e of list) {
      if (!Array.isArray(e) || typeof e[0] !== 'string' || typeof e[1] !== 'number' || !(now - e[1] <= WEEK)) continue;
      marks.set(e[0], Math.max(marks.get(e[0]) ?? 0, e[1]));
    }
  },
};
