// Traps set on the ground (2026-10-31, the owner: "players want more content they can play with and interact with"): a
// bear trap, which breaks the leg of whoever steps on it, and a land mine. DayZ's: anybody's foot sets one off, its
// setter's too, once it has armed, and anybody may take one up who is given the time. The server keeps them and decides
// when they go (server/traps.ts); no game is told of one further off than `sight`, so none can be listed from afar.
//
// The owner, 2026-10-31: "traps should surive restart i think... but have a max timer on their life. can be reset by picking
// up and replacing trap by owner. also you cna get tags from traps." So they are kept with the world, each with its end, and
// one taken up and set again has a whole life from then; and a death in one is its setter's doing, as a shot is.

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
  /** how long one lies before it rusts away, ms: taken up and set again it has all of this again */
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

/** a trap as it is kept over a restart */
export interface KeptTrap {
  k: TrapKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** whose it is, and what they are called: whose doing a death in it is, when they are not here */
  key: string;
  name: string;
  /** when it rusts away, ms */
  ends: number;
}

/** What was kept and is still in its time. (Time runs while the server is down: a life is by the clock.) */
export function trapsBack(list: unknown, now: number): KeptTrap[] {
  if (!Array.isArray(list)) return [];
  return list.filter((t): t is KeptTrap => !!t && isTrap(t.k) && [t.x, t.y, t.z, t.yaw, t.ends].every(Number.isFinite) && typeof t.key === 'string' && t.ends > now).map((t) => ({ k: t.k, x: t.x, y: t.y, z: t.z, yaw: t.yaw, key: t.key, name: typeof t.name === 'string' ? t.name : 'somebody', ends: t.ends }));
}

/** does a foot gone from a to b come within `r` of (x, z)? (A sprint is a metre between two looks: it does not step over one.) */
export function steppedOn(ax: number, az: number, bx: number, bz: number, x: number, z: number, r: number): boolean {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz, t = l > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l)) : 0;
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < r;
}
