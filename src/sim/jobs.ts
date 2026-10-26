// Work the trader has. Three jobs a day, the same three for everybody (they come out of the date): the infected to be
// put down, something common to be brought in, something that has to be gone and got. Paid in scrap (progression v3:
// "Jobs (three a day, as today) pay in scrap"), a good deal better than the stalls pay over the counter: it is what sends
// somebody out of the village and back again. The infected are counted by the server (src/sim/camp.ts TradeDay).

import { ITEMS } from './items';
import { RNG } from '../core/noise';
import type { TradeDay } from '../net/protocol';

export interface Job {
  id: string;
  /** infected put down, infected shot in the head, or things brought in */
  kind: 'cull' | 'heads' | 'bring';
  n: number;
  /** what is to be brought (a `bring`) */
  item?: string;
  /** scrap */
  pays: number;
  text: string;
}

const COMMON: [string, number][] = [['beans', 3], ['sardines', 3], ['sprats', 3], ['bandage', 2], ['water_jug', 2], ['flashlight', 1], ['compass', 1], ['work_gloves', 2]];
const HARD: [string, number][] = [['gasmask', 1], ['red_dot', 1], ['pu_scope', 1], ['boonie_hat', 1], ['life_vest', 1], ['binoculars', 1], ['firstaid', 2]];
/** what a job pays in scrap: each infected put down, each shot in the head; for a thing brought, so many times its worth */
// (two fifths of what it was when crates gave scrap by the hundred, as the stalls' prices: 2026-10-26)
const PAY = { cull: 1, heads: 2, bring: 0.6 };

/** the day a moment belongs to: days of the world's clock, so that everybody has the same one */
export const dayOf = (ms: number) => Math.floor(ms / 86_400_000);

export function jobsFor(day: number): Job[] {
  const rng = new RNG((day * 2654435761) >>> 0);
  const pick = <T>(list: T[]) => list[Math.floor(rng.next() * list.length)];
  const plural = (id: string, n: number) => (n > 1 ? `${n} × ${ITEMS[id].name}` : `a ${ITEMS[id].name}`);
  const bring = (id: string, n: number): Job => ({ id: `bring-${id}`, kind: 'bring', n, item: id, pays: Math.max(2, Math.round((ITEMS[id].worth ?? 2) * n * PAY.bring)), text: `Bring me ${plural(id, n)}.` });
  const first: Job = rng.next() < 0.6
    ? (() => { const n = pick([5, 8, 12]); return { id: `cull-${n}`, kind: 'cull' as const, n, pays: n * PAY.cull, text: `Put down ${n} of the infected.` }; })()
    : (() => { const n = pick([3, 5]); return { id: `heads-${n}`, kind: 'heads' as const, n, pays: n * PAY.heads, text: `Put down ${n} of the infected with a shot to the head.` }; })();
  return [first, bring(...pick(COMMON)), bring(...pick(HARD))];
}

/** how much of a job is done, of its `n`: `carried` says how many of a thing are on the player */
export function progress(job: Job, d: TradeDay, carried: (id: string) => number): number {
  if (d.done.includes(job.id)) return job.n;
  const have = job.kind === 'cull' ? d.kills : job.kind === 'heads' ? d.heads : carried(job.item!);
  return Math.min(job.n, have);
}

/** handing a job in: the job, or why not */
export function mayHandIn(id: string, d: TradeDay, carried: (id: string) => number): Job | string {
  const job = jobsFor(d.day).find((j) => j.id === id);
  if (!job || d.done.includes(id)) return 'That one is settled.';
  if (progress(job, d, carried) < job.n) return 'Not yet it is not.';
  return job;
}
