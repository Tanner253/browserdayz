// Locks on a base (2026-10-24, base building's fourth step). The owner: "keycode keylocks": a code lock and a key lock
// with its key. Plan v2, approved: "Code lock, 4 digits (Rust): a wrong code shocks (10 health); three wrong, locked
// out 60 s. It remembers who entered the code; a new code forgets them"; "Locks fit doors, gates, boxes and the claim".
// A key lock opens for whoever fitted it and whoever carries one of its keys; keys are cut at it by whoever may open it.
// What a code is, and which key fits which lock, is the server's alone: a game is told only a lock's kind, whether it is
// locked, and who knows its code.

import { PIECES } from './pieces';
import { shapeOf } from './solids';

export interface Lock {
  k: 'code' | 'key';
  /** locked: shut to whoever it does not let in */
  on: boolean;
  /** a code lock: who has entered its code (public ids); a key lock: whoever fitted it */
  who: string[];
  /** the server's only: the code, and the number its keys carry */
  code?: string;
  key?: number;
}

export const LOCK = {
  digits: 4,
  /** what a wrong code does to the hand on it, and how many wrong ones it takes before it shuts out whoever tries */
  shock: 10,
  tries: 3,
  out: 60_000,
  /** seconds a lock takes to fit */
  fit: 3,
  /** what a key is cut from */
  cut: { planks: 1 } as Record<string, number>,
};

/** the lock items, by the kind of lock each fits */
export const LOCK_ITEMS: Record<string, Lock['k']> = { code_lock: 'code', key_lock: 'key' };

/** what takes a lock: what swings shut (not shutters, which bar from inside), a box, the claim */
export const lockable = (kind: string) => (!!shapeOf(kind).leaves?.length && kind !== 'shutters') || !!PIECES[kind]?.store || kind === 'claim';

export const goodCode = (s: unknown): s is string => typeof s === 'string' && new RegExp(`^\\d{${LOCK.digits}}$`).test(s);

/** whether a lock lets somebody (by public id, with the numbers of the keys they carry) through */
export function mayPass(lock: Lock | undefined, pid: string, keys: number[] = []): boolean {
  if (!lock || !lock.on) return true;
  if (lock.who.includes(pid)) return true;
  return lock.k === 'key' && lock.key !== undefined && keys.includes(lock.key);
}

/** whether somebody may work the lock itself (lock, unlock, change its code, cut a key): whoever it lets in */
export const mayWorkLock = (lock: Lock, pid: string, keys: number[] = []) => lock.who.includes(pid) || (lock.k === 'key' && lock.key !== undefined && keys.includes(lock.key));

/** a lock as a game is told it: [kind (0 code, 1 key), locked, who] */
export type SaidLock = [0 | 1, 0 | 1, string[]];
/** and as the save keeps it: with its code, or its keys' number */
export type KeptLock = [0 | 1, 0 | 1, string[], string?, number?];

export const saidLock = (l: Lock, secret = false): KeptLock => {
  const k: KeptLock = [l.k === 'code' ? 0 : 1, l.on ? 1 : 0, [...l.who]];
  if (secret) k.push(l.code ?? '', l.key ?? 0);
  return k;
};

export function heardLock(q: unknown): Lock | undefined {
  if (!Array.isArray(q) || (q[0] !== 0 && q[0] !== 1) || !Array.isArray(q[2])) return undefined;
  const l: Lock = { k: q[0] === 0 ? 'code' : 'key', on: q[1] === 1, who: (q[2] as unknown[]).filter((p): p is string => typeof p === 'string') };
  if (goodCode(q[3])) l.code = q[3];
  if (Number.isInteger(q[4]) && (q[4] as number) > 0) l.key = q[4] as number;
  return l;
}
