// The server: claims, upkeep and rot (2026-10-24, base building's third step; the rules are src/sim/build/upkeep.ts).
// A claim set down in a base is DayZ's flag over Rust's tool cupboard: its store (a box of its own, opened as a crate
// is, taking only what a base is kept with) pays the base's upkeep a minute at a time; run dry, or with no claim at
// all, the base rots, and what comes to nothing breaks. Its members are who may build within 20 m of the base, and
// whoever reaches it may join it (Rust's: that is how a raided base changes hands). Kept with its base in the save.

import { saidClaim } from '../src/sim/build/bases';
import { toWorld, type Base } from '../src/sim/build/snap';
import { perDay, pay, protectedFor, rot, UPKEEP } from '../src/sim/build/upkeep';
import type { StoredItem } from '../src/net/protocol';
import { clients, send, type Client } from './players';
import { boxes, economy, log, world } from './index';
import { tellOpeners } from './searched';
import { bases, known, tellBase } from './build';
import { pidOf } from './acts';
import { spillBoxes } from './boxes';
import { passes } from './locks';

/** a claim's store: so many places across and down */
export const STORE = { w: 6, h: 4 };
/** how near its claim somebody has to stand to join it or leave it */
const AT = 3;

const cidOf = (b: number) => `claim:${b}`;

/** where a base's claim stands in the world */
function claimAt(b: Base): [number, number, number] | null {
  const p = b.claim && b.pieces.get(b.claim.p);
  return p ? toWorld(b, p.x, p.y, p.z) : null;
}

/** a claim's store made (laid, or read back), with what was in it */
export function storeFor(b: Base, items: StoredItem[] = []) {
  const at = claimAt(b);
  if (!at) return;
  boxes.set(cidOf(b.id), { cid: cidOf(b.id), kind: 'claim', w: STORE.w, h: STORE.h, items, x: at[0], y: at[1] + 0.4, z: at[2], rot: 0, emptiedAt: -1 });
}

/** what is in a base's claim's store (for the save) */
export const stockOf = (b: Base): StoredItem[] => boxes.get(cidOf(b.id))?.items ?? [];

/** a claim gone (taken down, broken, its base gone): what was in its store lies on the ground where it stood */
export function spill(b: number) {
  const box = boxes.get(cidOf(b));
  if (!box) return;
  boxes.delete(cidOf(b));
  box.items.forEach((it, i) => {
    const { x: _x, y: _y, rot: _r, ...item } = it as StoredItem & { rot?: boolean };
    const a = (i / Math.max(1, box.items.length)) * Math.PI * 2;
    const x = box.x + Math.cos(a) * 0.8, z = box.z + Math.sin(a) * 0.8;
    economy.drop(item, x, world.standAt(x, box.y + 0.3, z) + 0.03, z, a);
  });
}

/** everybody who has been told the base, told its claim as it is now */
export function tellClaim(b: Base) {
  tellBase(b.id, { t: 'bclaim', b: b.id, c: b.claim ? saidClaim(b.claim) : null });
}

export function join(c: Client, m: { b: number }) {
  const b = bases().bases.get(m.b), at = b && claimAt(b);
  if (!c.alive || !b || !at || Math.hypot(at[0] - c.pose[0], at[2] - c.pose[2]) > AT || !known(c, b.id)) return;
  // (a locked claim is joined only by whoever its lock lets in: Rust's locked cupboard)
  const cp = b.claim && b.pieces.get(b.claim.p);
  if (cp && !passes(c, cp)) return void send(c, { t: 'tell', kind: 'warn', text: 'The claim is locked' });
  const on = bases().join(b, pidOf(c.key), c.name);
  if (on) keepTold(b);
  send(c, { t: 'tell', kind: on ? 'good' : 'info', text: on ? 'You are on this claim: you may build here' : 'You have left this claim' });
  log(`[build] ${c.name} ${on ? 'joined' : 'left'} the claim of base ${b.id}`);
  tellClaim(b);
}

/** counts of what is in a store */
function counts(items: StoredItem[]) {
  const n: Record<string, number> = {};
  for (const it of items) if (UPKEEP.has(it.id)) n[it.id] = (n[it.id] ?? 0) + it.qty;
  return n;
}

/** so many of each thing taken out of a store's piles, the last first */
function takeOut(items: StoredItem[], want: Record<string, number>) {
  for (const [id, n] of Object.entries(want)) {
    let left = n;
    for (let i = items.length - 1; i >= 0 && left > 0; i--) {
      if (items[i].id !== id) continue;
      const k = Math.min(left, items[i].qty);
      items[i].qty -= k;
      left -= k;
      if (items[i].qty <= 0) items.splice(i, 1);
    }
  }
}

/**
 * Every minute: each base with a claim pays its upkeep out of its store; a base with none, or whose store has run dry,
 * rots, and whatever comes to nothing breaks (and takes with it whatever stood only on it).
 */
export function upkeep(now = Date.now(), minutes = 1) {
  const all = bases(), hours = minutes / 60;
  for (const b of [...all.bases.values()]) {
    let kept = false;
    if (b.claim) {
      const box = boxes.get(cidOf(b.id));
      const have = counts(box?.items ?? []), before = { ...have };
      const paid = pay(perDay(b), hours, b.claim.due, have);
      const used = Object.fromEntries(Object.entries(before).map(([id, n]) => [id, n - (have[id] ?? 0)]).filter(([, n]) => (n as number) > 0));
      if (box && Object.keys(used).length) {
        takeOut(box.items, used as Record<string, number>);
        tellOpeners(box.cid, { t: 'cdata', cid: box.cid, items: box.items });
      }
      if (b.claim.dry === paid) {
        b.claim.dry = !paid;
        tellClaim(b);
      }
      kept = paid;
      keepTold(b, have);
    }
    if (kept) continue;
    const { hurt, broken } = rot(b, hours, now, !!b.claim);
    if (hurt.length) tellBase(b.id, { t: 'bhp', b: b.id, hp: hurt.map((p) => [p.id, Math.round(p.hp)] as [number, number]) });
    for (const id of broken) {
      if (!b.pieces.has(id)) continue;
      const claimed = b.claim?.p;
      const gone = all.remove(b.id, id);
      if (claimed !== undefined && gone.includes(claimed)) spill(b.id);
      spillBoxes(b.id, gone);
      if (gone.length) tellBase(b.id, { t: 'bout', b: b.id, ids: gone });
    }
  }
}

/** a claim's members near enough to have been told its base: how long it is kept, and what it costs a day */
export function keepTold(b: Base, have = counts(boxes.get(cidOf(b.id))?.items ?? [])) {
  if (!b.claim) return;
  const day = perDay(b), s = protectedFor(have, day), on = new Set(b.claim.members.map((m) => m.pid));
  const m = { t: 'bkeep', b: b.id, s: Number.isFinite(s) ? Math.round(s) : -1, dry: b.claim.dry, day: Object.entries(day).map(([id, n]) => [id, Math.round(n * 10) / 10] as [string, number]) } as const;
  for (const c of clients.values()) if (known(c, b.id) && on.has(pidOf(c.key))) send(c, m);
}

/** after the bases are read back: each claim's store made again with what was kept in it */
export function storesBack() {
  for (const b of bases().bases.values()) if (b.claim) storeFor(b, (b.claim.kept as StoredItem[] | undefined) ?? []);
}

