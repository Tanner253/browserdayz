// Locks on a base as the server keeps them (2026-10-24, base building's fourth step; the rules are
// src/sim/build/locks.ts). The owner: "keycode keylocks". A code lock's code, and the number a key lock's keys carry,
// are kept here and in the save, and told to no game: a game is told a lock's kind, whether it is locked and who has its
// code. What a lock bars: a door swung (server/doors.ts), a box or the claim's store opened (`lockLets`), a claim joined.

import { randomInt } from 'node:crypto';
import { lockPoint, LOCK, LOCK_ITEMS, goodCode, lockable, mayPass, mayWorkLock } from '../src/sim/build/locks';
import { saidPiece } from '../src/sim/build/bases';
import { toWorld, type Base, type Piece } from '../src/sim/build/snap';
import { middleOf } from '../src/sim/build/doors';
import { HAMMERS, condition } from '../src/sim/gather';
import { ITEMS, makeItem } from '../src/sim/items';
import type { C2S } from '../src/net/protocol';
import { broadcastNear, send, type Client } from './players';
import { log, things } from './index';
import { bases, known, pay, short, tellBase } from './build';
import { tool, use } from './gather';
import { pidOf } from './acts';

/** how near a lock somebody has to be to work it, m */
const REACH = 3.2;

/** the numbers of the keys somebody carries */
const keysOf = (c: Client) => [...things(c.inv)].filter((it) => it.id === 'key' && Number.isInteger(it.key)).map((it) => it.key!);
/** whether a piece's lock lets somebody through */
export const passes = (c: Client, p: Piece) => mayPass(p.lock, pidOf(c.key), keysOf(c));

/** wrong codes tried, by whom and at which lock, and when they were shut out till */
const tries = new WeakMap<Client, Map<string, { n: number; out: number; at: number }>>();

/** the piece asked for, if the player stands at it */
function at(c: Client, b: unknown, p: unknown): { base: Base; piece: Piece } | null {
  if (!c.alive || typeof b !== 'number' || typeof p !== 'number' || !known(c, b)) return null;
  const base = bases().bases.get(b), piece = base?.pieces.get(p);
  if (!base || !piece) return null;
  const [x, y, z] = toWorld(base, ...middleOf(piece));
  return Math.hypot(x - c.pose[0], y - (c.pose[1] + 1), z - c.pose[2]) <= REACH + 0.6 ? { base, piece } : null;
}

const tell = (c: Client, text: string, kind: 'good' | 'warn' | 'info' = 'warn') => send(c, { t: 'tell', kind, text });
const told = (b: Base, p: Piece) => tellBase(b.id, { t: 'bpc', b: b.id, p: saidPiece(p) });

/** a lock fitted: by somebody who may build here, to what takes one and has none; a key lock's first key given them */
export function fit(c: Client, m: Extract<C2S, { t: 'block' }>) {
  const a = at(c, m.b, m.p);
  if (!a) return;
  const it = [...things(c.inv)].find((i) => i.uid === m.u && LOCK_ITEMS[i.id]);
  if (!it) return tell(c, 'You need a lock');
  if (!lockable(a.piece.k)) return tell(c, 'That takes no lock');
  if (a.piece.lock) return tell(c, 'It has a lock already');
  if (!bases().mayWork(a.base, pidOf(c.key))) return tell(c, a.base.claim ? 'You are not on its claim' : 'It is not yours');
  const k = LOCK_ITEMS[it.id];
  if (k === 'code' && !goodCode(m.code)) return tell(c, `A code is ${LOCK.digits} figures`);
  pay(c, { [it.id]: 1 });
  a.piece.lock = { k, on: true, who: [pidOf(c.key)], ...(k === 'code' ? { code: m.code } : { key: randomInt(1, 2 ** 31) }) };
  if (k === 'key') {
    const key = makeItem('key', 1);
    key.key = a.piece.lock.key;
    send(c, { t: 'kit', name: 'Key', items: [key], adds: true, gift: 'Its key' });
  }
  told(a.base, a.piece);
  log(`[build] ${c.name} fitted a ${k} lock to a ${a.piece.k} in base ${a.base.id}`);
}

/** a code entered: the right one lets them in for good (until a new code); a wrong one shocks, and three shut them out a minute */
export function code(c: Client, m: Extract<C2S, { t: 'bcode' }>) {
  const a = at(c, m.b, m.p), l = a?.piece.lock;
  if (!a || !l || l.k !== 'code' || !goodCode(m.code)) return;
  const pid = pidOf(c.key);
  if (m.set) {
    if (!l.who.includes(pid)) return tell(c, 'Only somebody who has its code may change it');
    l.code = m.code;
    l.who = [pid];
    told(a.base, a.piece);
    return tell(c, 'Its code is changed: whoever knew the old one must be told the new', 'good');
  }
  const key = `${m.b}:${m.p}`, mine = tries.get(c) ?? new Map<string, { n: number; out: number; at: number }>(), t = mine.get(key) ?? { n: 0, out: 0, at: 0 }, now = Date.now();
  tries.set(c, mine);
  if (now < t.out) return tell(c, `It takes no code for ${Math.ceil((t.out - now) / 1000)} s`);
  // (heard by whoever is near, right or wrong: the keypad's beep, or its buzz and the shock)
  const [hx, hy, hz] = toWorld(a.base, ...lockPoint(a.piece));
  broadcastNear({ t: 'bcoded', x: hx, y: hy, z: hz, ok: m.code === l.code, by: c.id }, hx, hz, 30);
  if (m.code === l.code) {
    mine.delete(key);
    if (!l.who.includes(pid)) l.who.push(pid);
    told(a.base, a.piece);
    return tell(c, 'The code is right: it lets you in', 'good');
  }
  // (each wrong code within a minute of the last hurts more: no code is guessed by trying them all)
  const shock = LOCK.shock + (now - t.at < LOCK.again ? t.n * LOCK.more : 0);
  if (now - t.at >= LOCK.again) t.n = 0;
  t.at = now;
  t.n++;
  if (t.n >= LOCK.tries) {
    t.n = 0;
    t.out = now + LOCK.out;
  }
  mine.set(key, t);
  send(c, { t: 'dmg', from: 0, amount: shock, zone: 'torso', w: 'shock', dir: [0, 0, 0] });
  tell(c, t.out > now ? `Wrong code: it will take none for ${LOCK.out / 1000} s` : 'Wrong code');
}

/** locked or unlocked, by whoever it lets in */
export function onOff(c: Client, m: Extract<C2S, { t: 'blockon' }>) {
  const a = at(c, m.b, m.p), l = a?.piece.lock;
  if (!a || !l) return;
  if (!mayWorkLock(l, pidOf(c.key), keysOf(c))) return tell(c, 'It is locked');
  l.on = !!m.on;
  told(a.base, a.piece);
}

/** a key cut at a key lock, by whoever it lets in, from a plank */
export function cutKey(c: Client, m: Extract<C2S, { t: 'bkey' }>) {
  const a = at(c, m.b, m.p), l = a?.piece.lock;
  if (!a || !l || l.k !== 'key' || l.key === undefined) return;
  if (!mayWorkLock(l, pidOf(c.key), keysOf(c))) return tell(c, 'It is locked');
  const no = short(c.inv, LOCK.cut);
  if (no) return tell(c, no);
  pay(c, LOCK.cut);
  const key = makeItem('key', 1);
  key.key = l.key;
  send(c, { t: 'kit', name: 'Key', items: [key], adds: true, gift: 'A key' });
}

/** a lock taken off with the hammer, by whoever it lets in and may work the base: given back */
export function unfit(c: Client, m: Extract<C2S, { t: 'bunlock' }>) {
  const a = at(c, m.b, m.p), l = a?.piece.lock;
  const it = tool(c, m.u, HAMMERS);
  if (!a || !l || !it) return;
  if (condition(it.cond).ruined) return tell(c, 'Your hammer is ruined');
  if (!mayWorkLock(l, pidOf(c.key), keysOf(c)) || !bases().mayWork(a.base, pidOf(c.key))) return tell(c, 'It is not yours to take off');
  delete a.piece.lock;
  use(c, it);
  const back = makeItem(l.k === 'code' ? 'code_lock' : 'key_lock', 1);
  send(c, { t: 'kit', name: 'Lock', items: [back], adds: true, gift: ITEMS[back.id].name });
  told(a.base, a.piece);
}

/** whether a box of a base's (a box's store, a claim's) may be opened by somebody: its lock lets them in */
export function lockLets(c: Client, cid: string): boolean {
  const [kind, b, p] = cid.split(':');
  if (kind !== 'bbox' && kind !== 'claim') return true;
  const base = bases().bases.get(Number(b));
  const piece = base && (kind === 'claim' ? (base.claim ? base.pieces.get(base.claim.p) : undefined) : base.pieces.get(Number(p)));
  return !piece || passes(c, piece);
}
