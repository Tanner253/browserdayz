// Traps set on the ground (2026-10-31, the owner: "players want more content they can play with and interact with"): a
// bear trap, which breaks the leg of whoever steps on it, and a land mine. DayZ's: anybody's foot sets one off, its
// setter's too, once it has armed, and anybody may take one up who is given the time. The server keeps them and decides
// when they go (server/traps.ts); no game is told of one further off than `sight`, so none can be listed from afar.
//
// What a trap kills earns no tag: nobody is the killer (`nobody` in server/acts.ts), so a mine laid on a road pays nothing.

export const TRAPS = {
  /** how near a foot sets it off, metres; seconds until it is armed; seconds it takes to take up; what its jaws do */
  bear_trap: { reach: 0.6, arm: 4, take: 3, damage: 45 },
  land_mine: { reach: 0.8, arm: 8, take: 6, damage: 0 },
} as const;
export type TrapKind = keyof typeof TRAPS;
export const isTrap = (id: string): id is TrapKind => id in TRAPS;

export const TRAP_KEEP = {
  /** how many one player has set at once */
  most: 6,
  /** how long one lies before it rusts away, ms: there is no base to pay for it */
  lasts: 4 * 3600_000,
  /** how far off a game is told of one, metres */
  sight: 60,
  /** how far from their feet a player sets one or takes one up, metres */
  reach: 3,
  /** how far above or below it a foot may be and still be on it, metres: not from the floor over a cellar */
  up: 1.4,
  /** how near a car sets a mine off, metres */
  car: 2.2,
};

/** does a foot gone from a to b come within `r` of (x, z)? (A sprint is a metre between two looks: it does not step over one.) */
export function steppedOn(ax: number, az: number, bx: number, bz: number, x: number, z: number, r: number): boolean {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz, t = l > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l)) : 0;
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < r;
}
