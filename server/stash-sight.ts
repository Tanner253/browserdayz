// A buried stash is told to a player only once they come near it (the owner, 2026-10-23: "Fix the buried stash leak
// now: the server stops sending buried stashes in the welcome, digging still works"). Every buried stash on the map was
// in every joining game's welcome, and each new one was told to everybody as it went into the ground: a script could
// read them all. Now one is told to a player within SEE_M of it, once a connection: as near as its heap of mud can be
// made out, and nearer than anybody needs to be to dig it (BURY.reach). The server's lists are passed in (index.ts,
// handle.ts), so that this file stands alone (test/stash-sight.test.ts).

import type { S2C, StashInfo } from '../src/net/protocol';

export const SEE_M = 50;

/** what of a player is read here: where they are, and whether their line is open */
export type Seer = { pose: number[]; ws: { readyState: number } };
/** a stash as the server keeps it */
export type Kept = { cid: string; kind: string; buried?: boolean; x: number; y: number; z: number; rot: number; item?: string };

const told = new WeakMap<Seer, Set<string>>();

const infoOf = (b: Kept): StashInfo => ({ uid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot, ...(b.item ? { item: b.item } : {}), buried: true });
const near = (c: Seer, b: { x: number; z: number }) => (b.x - c.pose[0]) ** 2 + (b.z - c.pose[2]) ** 2 <= SEE_M * SEE_M;

/** tells one player of one buried stash, unless they have been told of it already on this connection */
function tell<C extends Seer>(c: C, b: Kept, send: (c: C, m: S2C) => void) {
  let mine = told.get(c);
  if (!mine) told.set(c, (mine = new Set()));
  if (mine.has(b.cid)) return;
  mine.add(b.cid);
  send(c, { t: 'stash+', s: infoOf(b) });
}

/** Each second: every buried stash a player has come within SEE_M of, told to them once. */
export function stashesSeen<C extends Seer>(clients: Iterable<C>, boxes: Iterable<Kept>, send: (c: C, m: S2C) => void) {
  const buried = [...boxes].filter((b) => b.kind === 'stash' && b.buried);
  if (!buried.length) return;
  for (const c of clients) {
    if (c.ws.readyState !== 1) continue;
    for (const b of buried) if (near(c, b)) tell(c, b, send);
  }
}

/** A stash gone into the ground this moment: told to those near enough to see it go (the one burying it among them). */
export function stashBuriedNear<C extends Seer>(s: StashInfo, clients: Iterable<C>, send: (c: C, m: S2C) => void) {
  const b: Kept = { cid: s.uid, kind: 'stash', buried: true, x: s.x, y: s.y, z: s.z, rot: s.rot, ...(s.item ? { item: s.item } : {}) };
  for (const c of clients) if (c.ws.readyState === 1 && near(c, b)) tell(c, b, send);
}
