// What a craft takes out of a set of pockets, and what comes of it (2026-10-24): one rule, read by the game for its
// screen and by the server, which judges every craft on its own copy of the pockets (as building does). What is used
// up lies in the hands or in a pocket, never what is worn; a tool may be anywhere on you, and is worn a use for each one
// made (DayZ). A piece of clothing is cut up only with nothing left in its pockets.

import { ITEMS, type ItemInstance } from '../items';
import type { SerializedInventory } from '../inventory';
import { condition } from '../gather';
import { MOST, RECIPES, optionsOf, type Recipe } from './recipes';

export interface Pockets {
  /** what may be used up: in the hands, or lying in a pocket or the pouch */
  free: ItemInstance[];
  /** everything carried, worn and in what is worn too: where a tool may be */
  all: ItemInstance[];
}

/** a set of pockets as both sides keep them (the game's own `serialize`, the server's copy) */
export function pocketsOf(inv: SerializedInventory | null): Pockets {
  const free: ItemInstance[] = [], all: ItemInstance[] = [];
  if (!inv) return { free, all };
  const walk = (it: ItemInstance | null | undefined) => {
    if (!it) return;
    all.push(it);
    for (const p of it.cargo ?? []) walk(p.item);
  };
  const slots = inv.slots as Record<string, ItemInstance | null | undefined>;
  for (const [s, it] of Object.entries(slots)) {
    walk(it);
    if (!it) continue;
    if (s === 'held') free.push(it);
    else for (const p of it.cargo ?? []) free.push(p.item);
  }
  for (const c of inv.containers) for (const it of c.items) {
    walk(it);
    free.push(it);
  }
  return { free, all };
}

export interface Plan {
  r: Recipe;
  /** how many will be made (fewer than asked for when the pockets run out part way) */
  n: number;
  /** what stacks is used up by its kind: a cost, as building pays one */
  pay: Record<string, number>;
  /** what does not stack is used up by its number (a jacket: that one, emptied) */
  uids: string[];
  /** the tools worn, a use each for every one made */
  wear: string[];
  /** how many of `r.makes` come of it */
  makes: number;
  /** seconds it takes, all of them */
  time: number;
}

const ruined = (it: ItemInstance) => condition(it.cond).ruined;
const empty = (it: ItemInstance) => !it.cargo?.length;
const nameOf = (id: string) => (ITEMS[id]?.name ?? id).toLowerCase();

/** what is short for one, said plainly */
function why(r: Recipe, p: Pockets): string {
  const missing: string[] = [];
  for (const need of r.needs) {
    const opts = optionsOf(need), have = need.keep ? (p.all.some((it) => opts.includes(it.id) && !ruined(it)) ? 1 : 0) : Math.max(0, ...opts.map((o) => count(p.free, o)));
    const short = (need.keep ? 1 : need.n) - have;
    if (short > 0) missing.push(opts.length > 1 ? (need.keep ? `something to cut with` : `${need.n} of ${opts.length > 3 ? 'one kind' : opts.map(nameOf).join(' or ')}`) : `${short} more ${nameOf(opts[0])}`);
  }
  return missing.length ? `Needs ${missing.join(' and ')}` : 'Nothing here to make it with';
}

/** how many of a kind lie free (a jacket with things in its pockets is not) */
export function count(list: ItemInstance[], id: string): number {
  let n = 0;
  for (const it of list) if (it.id === id && (ITEMS[id]?.stack || empty(it))) n += it.qty;
  return n;
}

/**
 * Up to `n` of recipe `r` out of these pockets (`want`: the uids or kinds to use first, the two things dragged onto
 * each other): a plan, or why none can be made.
 */
export function plan(r: Recipe, n: number, p: Pockets, want: string[] = []): Plan | string {
  n = Math.max(1, Math.min(Math.floor(n) || 1, r.at === 'hand' ? MOST.hand : 99));
  const left = new Map<string, number>(), used = new Set<string>();
  const out: Plan = { r, n: 0, pay: {}, uids: [], wear: [], makes: 0, time: 0 };
  const wanted = (it: ItemInstance) => want.includes(it.uid) || want.includes(it.id);
  const tally = (id: string) => {
    if (!left.has(id)) left.set(id, count(p.free, id));
    return left.get(id)!;
  };
  for (let u = 0; u < n; u++) {
    const pay: [string, number][] = [], uids: string[] = [], wear: string[] = [];
    let first: string | null = null, short = false;
    for (const need of r.needs) {
      const opts = optionsOf(need);
      if (need.keep) {
        const tools = p.all.filter((it) => opts.includes(it.id) && !ruined(it)).sort((a, b) => Number(wanted(b)) - Number(wanted(a)));
        if (!tools.length) short = true;
        else wear.push(tools[0].uid);
        continue;
      }
      // (what stacks: all of a need out of one kind, the one wanted first, else the one there is most of)
      const stacked = opts.filter((o) => ITEMS[o]?.stack);
      const kinds = stacked.filter((o) => tally(o) - (pay.find(([id]) => id === o)?.[1] ?? 0) >= need.n).sort((a, b) => Number(want.includes(b)) - Number(want.includes(a)) || tally(b) - tally(a));
      if (kinds.length) {
        pay.push([kinds[0], need.n]);
        first ??= kinds[0];
        continue;
      }
      // (what does not stack: each one by its number, emptied, the one dragged first)
      const ones = p.free.filter((it) => opts.includes(it.id) && !ITEMS[it.id]?.stack && empty(it) && !used.has(it.uid) && !uids.includes(it.uid)).sort((a, b) => Number(wanted(b)) - Number(wanted(a)));
      if (ones.length < need.n) {
        short = true;
        continue;
      }
      for (const it of ones.slice(0, need.n)) uids.push(it.uid);
      first ??= ones[0].id;
    }
    if (short) break;
    for (const [id, k] of pay) {
      left.set(id, tally(id) - k);
      out.pay[id] = (out.pay[id] ?? 0) + k;
    }
    for (const uid of uids) used.add(uid);
    out.uids.push(...uids);
    out.wear.push(...wear);
    out.makes += r.by ? (first ? r.by[first] ?? 0 : 0) : r.qty;
    out.time += r.time;
    out.n++;
  }
  return out.n ? out : why(r, p);
}

/** the most of a recipe these pockets make (0: none) */
export function most(r: Recipe, p: Pockets): number {
  const q = plan(r, r.at === 'hand' ? MOST.hand : 99, p);
  return typeof q === 'string' ? 0 : q.n;
}

/** each need with how many it wants for `n` and how many are carried: the card's have / need */
export function needsOf(r: Recipe, n: number, p: Pockets): { ids: readonly string[]; name: string; need: number; have: number; keep: boolean }[] {
  return r.needs.map((need) => {
    const ids = optionsOf(need), name = need.name ?? ITEMS[ids[0]]?.name ?? ids[0];
    if (need.keep) return { ids, name, need: 1, have: p.all.some((it) => ids.includes(it.id) && !ruined(it)) ? 1 : 0, keep: true };
    // (of several kinds that stack, all of a need come out of one: what counts is the most of any one)
    const have = ids.some((o) => ITEMS[o]?.stack) ? Math.max(0, ...ids.map((o) => count(p.free, o))) : ids.reduce((s, o) => s + count(p.free, o), 0);
    return { ids, name, need: need.n * n, have, keep: false };
  });
}

/**
 * The hand recipes two things dragged onto each other go into (DayZ's way): each one meets a need, a different need
 * unless they are two of one kind that a need takes several of (rags onto rags).
 */
export function recipesFor(a: ItemInstance, b: ItemInstance): Recipe[] {
  if (a === b) return [];
  return RECIPES.filter((r) => {
    if (r.at !== 'hand') return false;
    const ia = r.needs.findIndex((need) => optionsOf(need).includes(a.id));
    if (ia < 0) return false;
    if (a.id === b.id) return !r.needs[ia].keep && r.needs[ia].n >= 2;
    return r.needs.some((need, i) => i !== ia && optionsOf(need).includes(b.id));
  });
}

/** what a recipe is called on a card: what it makes, or what it does where that says more */
export const recipeName = (r: Recipe) => (r.id === 'rags' ? 'Cut into rags' : r.id === 'gunpowder' ? 'Pull the powder' : ITEMS[r.makes]?.name ?? r.makes);
