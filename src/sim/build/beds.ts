// How often a bed or a sleeping bag may be woken at, and how many a player may have (the owner, 2026-10-25: "sleeping
// bags get 1 spawn with 30 min cooldown, beds get 2 spawns 30 min cooldown. player can have 5 sleeping bags and 2
// regular beds at 1 time"). The server keeps it on the piece (`slept`, kept with the base: src/sim/build/bases.ts) and
// the game reads it the same way to show each one's state on the death screen's map.

import { PIECES } from './pieces';
import type { Piece } from './snap';

/** for each kind slept in: how many wakes it gives, how long (s) before it gives them again once they are spent, and how many one player may have */
export const SLEEP: Record<string, { wakes: number; rest: number; most: number }> = {
  bedroll: { wakes: 1, rest: 30 * 60, most: 5 },
  bed: { wakes: 2, rest: 30 * 60, most: 2 },
};

/** how many wakes a bed has left now, and in how many seconds it gives them again (0: it has some now) */
export function sleepOf(p: Piece, now: number): { left: number; wait: number } {
  const r = SLEEP[p.k];
  if (!r) return { left: 0, wait: 0 };
  const [left, until] = p.slept ?? [r.wakes, 0];
  if (until > now) return { left: 0, wait: Math.ceil((until - now) / 1000) };
  return { left: until ? r.wakes : Math.max(0, Math.min(r.wakes, left)), wait: 0 };
}

/** one wake spent at it: the last of them, and it rests (`SLEEP.rest`) before it gives any again @returns false if it had none */
export function sleptAt(p: Piece, now: number): boolean {
  const r = SLEEP[p.k], { left } = sleepOf(p, now);
  if (!r || left < 1) return false;
  p.slept = left > 1 ? [left - 1, 0] : [0, now + r.rest * 1000];
  return true;
}

/** why one more of this kind may not be laid by somebody who has these pieces already (null: it may) */
export function bedsFull(kind: string, theirs: Iterable<Piece>): string | null {
  const r = SLEEP[kind];
  if (!r) return null;
  let n = 0;
  for (const p of theirs) if (p.k === kind) n++;
  return n >= r.most ? `You can have only ${r.most} ${PIECES[kind].name.toLowerCase()}${r.most === 1 ? '' : 's'} at once: take one away first` : null;
}
