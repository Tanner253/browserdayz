// The bodies of the infected, searched as a player's is, and bodies cleared away by an admin. The rules only: the server
// lays them in (server/acts.ts `infectedBody`) and clears them away (server/admin-bodies.ts). test/bodies.test.ts.
//
// The owner, 2026-10-23: "loot should not drop in the world from zombies. it should be lootable on the zombies dead
// body, until they are cleaned up. (5 mins)". And "admin needs a way to get rid of corpses ... and a way to delete
// corpses in bulk like the kill zombies in bulk vicinity control".

import type { CorpseInfo, StoredItem } from '../src/net/protocol';
import { INFECTED, INFECTED_GRID, infectedDrop, type Body } from '../src/sim/infected';
import { Container } from '../src/sim/inventory';
import { makeItem, type ItemInstance } from '../src/sim/items';

/**
 * A body, as much of the server's Box (server/index.ts) as these rules read: said here, so that they and their test
 * do not bring in the whole server.
 */
export interface BodyBox {
  cid: string;
  kind: 'crate' | 'stash' | 'corpse' | 'drop' | 'furniture' | 'claim' | 'bbox' | 'recycler';
  w: number;
  h: number;
  items: StoredItem[];
  x: number;
  y: number;
  z: number;
  rot: number;
  emptiedAt: number;
  name?: string;
  expires?: number;
  v?: number;
  ride?: { i: number; seat: number };
  zed?: number;
  buried?: boolean;
  bd?: number;
}

/** the uid of the body of one of the infected (its number is its own for as long as the server runs, and the body is not kept through a restart) */
export const zedUid = (i: number) => `zbody_${i}`;

/** which way one fell from a blow from `dir`, as every game works it out (`hp` in src/game/infected.ts): 0 on its back, 1 on its face, 2 on its side */
export function fellWay(yaw: number, dir: [number, number]): number {
  const along = -Math.sin(yaw) * dir[0] - Math.cos(yaw) * dir[1];
  return along > 0.4 ? 1 : along < -0.4 ? 0 : 2;
}

/**
 * One has gone down to a player's hand: what it had on it is in its body, and the body is there for as long as the
 * infected's own body lies (INFECTED.linger), with whatever is left in it. Nothing on it: no body to search.
 * @param way which way it fell (`fellWay`)
 * @param time the economy's clock, seconds
 */
export function zedBody(b: Body, way: number, time: number, rnd: () => number = Math.random): BodyBox | null {
  const had = infectedDrop(rnd);
  if (!had) return null;
  const uid = zedUid(b.i), box = new Container(uid, 'Infected', INFECTED_GRID[0], INFECTED_GRID[1]);
  if (box.add(makeItem(had[0], had[1]))) return null;
  // (where, to the centimetre: as the games report it, to the double's last digit, it was a third of what is told of it)
  const c = (v: number) => Math.round(v * 100) / 100;
  return { cid: uid, kind: 'corpse', w: INFECTED_GRID[0], h: INFECTED_GRID[1], items: box.serialize().items, x: c(b.s[0]), y: c(b.s[1]), z: c(b.s[2]), rot: Math.round(b.s[3] * 1000) / 1000, emptiedAt: -1, name: 'Infected', v: way, zed: b.i, expires: time + INFECTED.linger };
}

/** what the games are told of a body: where it lies, and whose (one of the infected's says which: it is drawn by them) */
export function bodyInfo(b: BodyBox): CorpseInfo {
  return { uid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot, name: b.name ?? 'Survivor', v: b.v ?? 0, ...(b.ride ? { ride: b.ride } : {}), ...(b.zed !== undefined ? { zed: b.zed } : {}), ...(b.bd !== undefined ? { bd: b.bd } : {}) };
}

/** the dog tags in what a body holds, in its bags and pockets too (a body taken away says how many went with it) */
export const tagsIn = (items: ItemInstance[]): number => items.reduce((n, it) => n + (it.id === 'dogtag' ? 1 : 0) + tagsIn((it.cargo ?? []).map((p) => p.item)), 0);

/** a body lying: a player's or one of the infected's with something on it (a box), or one of the infected's with nothing (a number) */
export type Lying = { box: string; zed?: number; x: number; z: number } | { zed: number; x: number; z: number };

/**
 * Every body lying within `r` metres of x, z, nearest first: the players', and the infected's with or without
 * something on them (one of the infected's with a box is one body, not two). Not one still sat in a helicopter: it
 * goes with what it rides in.
 */
export function bodiesWithin(boxes: Iterable<BodyBox>, horde: Iterable<Body>, x: number, z: number, r: number): Lying[] {
  const out: Lying[] = [], boxed = new Set<number>();
  for (const b of boxes) {
    if (b.kind !== 'corpse' || b.ride) continue;
    if (b.zed !== undefined) boxed.add(b.zed);
    if (Math.hypot(b.x - x, b.z - z) <= r) out.push({ box: b.cid, ...(b.zed !== undefined ? { zed: b.zed } : {}), x: b.x, z: b.z });
  }
  for (const b of horde) if (b.diedAt && !boxed.has(b.i) && Math.hypot(b.s[0] - x, b.s[2] - z) <= r) out.push({ zed: b.i, x: b.s[0], z: b.s[2] });
  return out.sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z));
}
