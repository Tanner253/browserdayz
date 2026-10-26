// Crates, bodies, stashes, drops, furniture and bags lying about, gone through by several at once (2026-10-23, the
// owner's list: the "Opening…" wait and "Someone else is searching that"; "We should not have cut any corners on
// anything"). Each was held by whoever opened it first, because their game said what was in the whole of it after
// each change and two would have written over each other. Now each game says what it did, move by move
// (src/sim/box-ops.ts), the server does each to the thing as it is now, and everybody who has it open is told what is
// in it after. What could not be done is said back to whoever did it ('cno'), and their game puts it right.

import { RACKS } from '../src/sim/crates';
import { applyOps, diffOps, laidIn, type BoxOp, type Laid } from '../src/sim/box-ops';
import { UPKEEP } from '../src/sim/build/upkeep';
export { laidIn };
import { Container, PlayerInventory, bagGrid } from '../src/sim/inventory';
import { reclaim } from '../src/sim/reclaim';
import { ITEMS, type ItemInstance } from '../src/sim/items';
import type { S2C, StoredItem } from '../src/net/protocol';
import type { WorldLoot } from '../src/sim/economy';
import { economy, invented, issue, locks, takeOut, things, type Box } from './index';
import { cleanItem, cleanStored, clients, send, broadcast, type Client } from './players';
import { CHECKS, flag, touched } from './checks';
import { KEPT } from './keep';
import { ajar, pidOf, rackChanged } from './acts';
import { changed, contents } from './storages';
import { cameTo, holdsTag, payingTags, wentFrom } from './custody';

/** who has each open: a crate's id, or `l:` and a lying bag's */
export const openers = new Map<string, Set<number>>();

/** this player has it open now, beside whoever else has (the first to open a locker sets its doors swinging) */
export function openIt(c: Client, k: string) {
  let s = openers.get(k);
  const first = !s?.size;
  if (!s) openers.set(k, (s = new Set()));
  s.add(c.id);
  // (`locks` says only that somebody has it open: what is left alone is cleared away, see index.ts and drops.ts)
  locks.set(k, c.id);
  if (first && !k.startsWith('l:')) ajar(k, true, c);
}

/** this player has shut it (or gone): the last to shut a locker sets its doors swinging shut */
export function shutIt(c: Client, k: string) {
  const s = openers.get(k);
  if (!s) return;
  s.delete(c.id);
  for (const id of s) if (!clients.has(id)) s.delete(id);
  if (s.size) return void locks.set(k, [...s][0]);
  openers.delete(k);
  locks.delete(k);
  if (!k.startsWith('l:')) ajar(k, false);
}

/** nobody has it open any more: it is gone (a stash dug up, a bag picked up, a box an admin took away) */
export function goneFrom(k: string) {
  for (const id of openers.get(k) ?? []) clients.get(id)?.openLying.delete(k.slice(2));
  openers.delete(k);
  locks.delete(k);
}

export const hasOpen = (c: Client, k: string) => !!openers.get(k)?.has(c.id);

/** to whoever has a box open (a claim's store, when its upkeep is taken: server/claims.ts) */
export const tellOpeners = (k: string, m: S2C) => tell(k, m);

function tell(k: string, m: S2C) {
  for (const id of openers.get(k) ?? []) {
    const o = clients.get(id);
    if (o) send(o, m);
  }
}

/** what somebody's game took that somebody else had taken first, or that the server used up (a thing researched, sold): not believed to be in their pockets for a moment, until their game has heard so (see 'me') */
const refusedOf = new Map<number, Map<string, number>>();
const REFUSED_MS = 4000;
export function refuse(c: Client, uids: string[]) {
  if (!uids.length) return;
  let m = refusedOf.get(c.id);
  if (!m) refusedOf.set(c.id, (m = new Map()));
  const until = Date.now() + REFUSED_MS;
  for (const uid of uids) m.set(uid, until);
  takeOut(c.inv, new Set(uids));
}
/** the things this player's game may still say it carries, which it was told it does not */
export function refusedNow(c: Client): Set<string> {
  const m = refusedOf.get(c.id), out = new Set<string>(), now = Date.now();
  if (!m) return out;
  for (const [uid, until] of m) if (until < now) m.delete(uid);
  else out.add(uid);
  if (!m.size) refusedOf.delete(c.id);
  return out;
}

const hasTag = (it: ItemInstance): boolean => it.id === 'dogtag' || (it.cargo ?? []).some((p) => hasTag(p.item));
const madeUp = (c: Client, it: ItemInstance, where: string) =>
  CHECKS !== 'off' && [...things({ slots: { it }, containers: [] })].some(invented) && flag(c, `put ${ITEMS[it.id].name} in ${where}, which the server never put in the world`);
const clean = (raw: unknown) => cleanItem(raw);

/** These moves done to a crate, a body, a stash, a drop or a piece of furniture, as it is now; everybody with it open told. */
export function boxOps(c: Client, b: Box, ops: BoxOp[]) {
  const furniture = b.kind === 'furniture', body = b.kind === 'corpse';
  const before = (furniture ? contents(b) : b.items) as Laid[];
  // (A dog tag lies on a body and nowhere else that holds things: the owner, "dogtags should not be stashed"; and on a
  // body only by whoever holds it, custody.ts. One that may not go in is given back, not lost.)
  // (and a claim's store takes what a base is kept with, and nothing else: server/claims.ts)
  const mayPut = (it: ItemInstance) => (body ? payingTags(it).every((t) => holdsTag(c.key, t.uid)) : !hasTag(it)) && !madeUp(c, it, `a ${b.kind}`) && (b.kind !== 'claim' || UPKEEP.has(it.id));
  const was = JSON.stringify(before);
  // (a gun rack's grid keeps its bays' rules: a gun, alone, in a bay that suits it)
  const rack = RACKS.has(b.crate ?? '') || !!b.rack;
  const r = applyOps(before, b.w, b.h, ops, mayPut, clean, true, rack ? Object.assign(new Container('rack', 'rack', b.w, b.h, [], true), { rack: true }) : undefined);
  if (body) {
    for (const it of r.took) for (const t of payingTags(it)) came(c, t.uid);
    const onto = r.put.flatMap((it) => payingTags(it)).map((t) => t.uid);
    for (const uid of onto) wentFrom(c.key, uid, `b:${b.cid}`);
    if (onto.length) takeOut(c.inv, new Set(onto));
  }
  refuse(c, r.refused.took.map((t) => t.uid));
  if (furniture) changed(b, r.items as StoredItem[]);
  else b.items = r.items as StoredItem[];
  // (put in, it is in the world from now on: it is whoever brought it that was asked)
  for (const it of r.put) issue(it);
  if (b.kind === 'crate' || b.kind === 'drop') b.emptiedAt = b.items.length ? -1 : b.emptiedAt < 0 ? economy.time : b.emptiedAt;
  if (b.kind === 'crate') b.pickedAt = economy.time;
  rackChanged(b);
  touched(b);
  if (r.refused.took.length || r.refused.back.length) send(c, { t: 'cno', cid: b.cid, ...r.refused });
  // (nothing came of it: nobody else is told it again, and whoever asked is shown it as it is, a move that could not be made undone)
  const now = { t: 'cdata', cid: b.cid, items: furniture ? contents(b) : b.items } as const;
  if (JSON.stringify(r.items) !== was) tell(b.cid, now);
  else if (ops.length) send(c, now);
}

/** a tag came to this player: theirs, its clock started now (custody.ts), and their game's countdown started again with it */
function came(c: Client, uid: string) {
  cameTo(c.key, uid);
  send(c, { t: 'tagclock', uid, held: 0 });
}

/**
 * Their own body, open within reach, gone through at one press: everything on it back onto them as it was worn and
 * carried (src/sim/reclaim.ts), all at once. Their game is told what it carries now, and whoever else has the body
 * open what is left on it. A tag off it is theirs, its clock started, as off a body thing by thing.
 * @returns false if it is not theirs to do (their game is not told: it only shows the button on their own body)
 */
export function reclaimBody(c: Client, b: Box): boolean {
  if (b.kind !== 'corpse' || !b.pid || b.pid !== pidOf(c.key) || !c.inv || !hasOpen(c, b.cid)) return false;
  const inv = new PlayerInventory();
  // (what they carry as their game last said, which says it again just before asking: nothing of it is let fall here)
  if (inv.load(JSON.parse(JSON.stringify(c.inv))).length) return false;
  const body = new Container(b.cid, 'Body', b.w, b.h, [], true);
  if (body.load({ items: b.items }).length) return false;
  const { took, put } = reclaim(inv, body);
  for (const it of took) for (const t of payingTags(it)) came(c, t.uid);
  const onto = put.flatMap((it) => payingTags(it)).map((t) => t.uid);
  for (const uid of onto) wentFrom(c.key, uid, `b:${b.cid}`);
  for (const it of put) issue(it);
  b.items = body.serialize().items;
  c.inv = inv.serialize();
  touched(b);
  send(c, { t: 'reclaimed', cid: b.cid, inv: c.inv, took: took.length, left: b.items.length });
  tell(b.cid, { t: 'cdata', cid: b.cid, items: b.items });
  return true;
}

/** What an old game says is in the whole crate now, made into the moves from what is in it (one that has it alone open loses nothing by it). */
export function boxSet(c: Client, b: Box, items: unknown) {
  const now = (b.kind === 'furniture' ? contents(b) : b.items) as Laid[];
  boxOps(c, b, diffOps(now, cleanStored(items) as Laid[]));
}


/** These moves done to a bag lying within reach; everybody told what is in it now. */
export function lyingOps(c: Client, l: WorldLoot, ops: BoxOp[]) {
  const grid = bagGrid(l.item, 1);
  if (!grid) return;
  // (no tag is put in it: it is not stashed)
  const before = laidIn(l.item), was = JSON.stringify(before);
  const r = applyOps(before, grid.w, grid.h, ops, (it) => !hasTag(it) && !madeUp(c, it, `a ${ITEMS[l.item.id].name.toLowerCase()} lying there`), clean, false, grid);
  // (a tag that was in it, dropped in it, and was taken out came to this player, as off a body: custody.ts)
  for (const it of r.took) for (const t of payingTags(it)) came(c, t.uid);
  refuse(c, r.refused.took.map((t) => t.uid));
  l.item.cargo = r.items.map(({ x, y, rot, ...it }) => ({ item: it, x, y, rot }));
  for (const it of r.put) issue(it);
  // (gone through is used: a case kept between restarts starts its time again, see Economy's containerLife)
  if (l.keptAt !== undefined) {
    l.keptAt = Date.now();
    KEPT.dirty = true;
  }
  if (r.refused.took.length || r.refused.back.length) send(c, { t: 'cno', l: l.uid, ...r.refused });
  const now = { t: 'lcargo', uid: l.uid, items: laidIn(l.item) } as const;
  if (JSON.stringify(r.items) !== was) broadcast(now);
  else if (ops.length) send(c, now);
}

/** What an old game says is in the whole of a lying bag now, made into the moves from what is in it. */
export function lyingSet(c: Client, l: WorldLoot, items: unknown) {
  lyingOps(c, l, diffOps(laidIn(l.item), cleanStored(items) as Laid[]));
}

/** a crate's contents asked for on the way to it: at most a few a second, and of each no more than every second */
const peeked = new Map<number, Map<string, number>>();
export function mayPeek(c: Client, cid: string): boolean {
  let m = peeked.get(c.id);
  if (!m) peeked.set(c.id, (m = new Map()));
  const now = Date.now();
  if (now - (m.get(cid) ?? 0) < 1000 || m.size > 64) {
    if (m.size > 64) for (const [k, at] of m) if (now - at > 10000) m.delete(k);
    return false;
  }
  m.set(cid, now);
  return true;
}

/** a player gone: nothing of theirs is left */
export function forget(c: Client) {
  refusedOf.delete(c.id);
  peeked.delete(c.id);
}

/** what a box holds, as a game is told it */
export const boxItems = (b: Box) => (b.kind === 'furniture' ? contents(b) : b.items);

