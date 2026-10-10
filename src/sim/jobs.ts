// Work the trader has. Three jobs a day, the same three for everybody (they come out of the
// date): the infected to be put down, something common to be brought in, something that has
// to be gone and got. He pays in credit, a good deal better than he pays over the counter:
// it is what sends somebody out of the village and back again.

import { ITEMS } from './items';
import { worth } from './trade';
import { RNG } from '../core/noise';

export interface Job {
  id: string;
  /** infected put down, infected shot in the head, or things brought in */
  kind: 'cull' | 'heads' | 'bring';
  n: number;
  /** what is to be brought (a `bring`) */
  item?: string;
  pays: number;
  text: string;
}

/** what a player has done of today's work: kept by the browser */
export interface JobBook {
  day: number;
  kills: number;
  heads: number;
  /** ids of the jobs paid for */
  done: string[];
}

const COMMON: [string, number][] = [['beans', 3], ['sardines', 3], ['sprats', 3], ['bandage', 2], ['water_jug', 2], ['flashlight', 1], ['compass', 1], ['work_gloves', 2]];
const HARD: [string, number][] = [['gasmask', 1], ['red_dot', 1], ['pu_scope', 1], ['boonie_hat', 1], ['life_vest', 1], ['binoculars', 1], ['firstaid', 2]];
/** how many times what a thing is worth over the counter it is worth when he has asked for it */
// (less than he asks for the same thing over the counter, or the job is done by buying from him)
const WANTED = 2.5;

/** the day a moment belongs to: days of the world's clock, so that everybody has the same one */
export const dayOf = (ms: number) => Math.floor(ms / 86_400_000);

export function jobsFor(day: number): Job[] {
  const rng = new RNG((day * 2654435761) >>> 0);
  const pick = <T>(list: T[]) => list[Math.floor(rng.next() * list.length)];
  const plural = (id: string, n: number) => (n > 1 ? `${n} × ${ITEMS[id].name}` : `a ${ITEMS[id].name}`);
  const bring = (id: string, n: number): Job => ({ id: `bring-${id}`, kind: 'bring', n, item: id, pays: Math.round(worth(id) * n * WANTED), text: `Bring me ${plural(id, n)}.` });
  const first: Job = rng.next() < 0.6
    ? (() => { const n = pick([5, 8, 12]); return { id: `cull-${n}`, kind: 'cull' as const, n, pays: n * 3, text: `Put down ${n} of the infected.` }; })()
    : (() => { const n = pick([3, 5]); return { id: `heads-${n}`, kind: 'heads' as const, n, pays: n * 6, text: `Put down ${n} of the infected with a shot to the head.` }; })();
  return [first, bring(...pick(COMMON)), bring(...pick(HARD))];
}

/** a book for a day: the one that was kept, if it is that day's, or a clean one */
export function bookFor(day: number, kept: Partial<JobBook> | null): JobBook {
  if (kept && kept.day === day) return { day, kills: Math.max(0, Math.floor(kept.kills ?? 0)), heads: Math.max(0, Math.floor(kept.heads ?? 0)), done: Array.isArray(kept.done) ? kept.done.filter((x) => typeof x === 'string') : [] };
  return { day, kills: 0, heads: 0, done: [] };
}

/** how much of a job is done, of its `n`: `carried` says how many of a thing are on the player */
export function progress(job: Job, book: JobBook, carried: (id: string) => number): number {
  if (book.done.includes(job.id)) return job.n;
  const have = job.kind === 'cull' ? book.kills : job.kind === 'heads' ? book.heads : carried(job.item!);
  return Math.min(job.n, have);
}
