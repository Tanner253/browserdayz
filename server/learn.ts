// The server: blueprints (progression v3; the rules are src/sim/craft/learn.ts). What each player has learned, by their
// key's hash, kept in the save and through death (Rust keeps them until a wipe). Learned two ways, both judged here on the
// server's copy of the pockets: at a research table, a thing carried and scrap ("the item is used up; you know it for
// good"); at a bench of the level, a tech tree's next recipe for scrap. The game is told its list when it joins and
// whenever it grows.

import type { C2S } from '../src/net/protocol';
import { RECIPE } from '../src/sim/craft/recipes';
import { cleanKnown, knows, mayUnlock, researchCost, researchUses, teaches, treeCost } from '../src/sim/craft/learn';
import { benchAt, placeNear } from '../src/sim/craft/places';
import { NEAR } from '../src/sim/craft/recipes';
import { pocketsOf, count } from '../src/sim/craft/plan';
import { MAT } from '../src/sim/craft/materials';
import { ITEMS } from '../src/sim/items';
import { send, type Client } from './players';
import { KEPT } from './keep';
import { things } from './index';
import { bases, pay } from './build';
import { refuse } from './searched';
import { keyHash } from './gate';

const learned = new Map<string, Set<string>>();
const NONE: ReadonlySet<string> = new Set();

/** what a player has learned (besides what everybody knows from the start) */
export const knownOf = (c: Client): ReadonlySet<string> => learned.get(keyHash(c.key)) ?? NONE;
/** whether a player may make a recipe */
export const mayMake = (c: Client, id: string) => knows(knownOf(c), id);

/** their game told what they know */
export const tellKnown = (c: Client) => send(c, { t: 'known', r: [...knownOf(c)] });

function teach(c: Client, id: string) {
  const k = keyHash(c.key);
  let s = learned.get(k);
  if (!s) learned.set(k, (s = new Set()));
  s.add(id);
  KEPT.dirty = true;
  tellKnown(c);
}

const scrapOf = (c: Client) => count(pocketsOf(c.inv).all, MAT.scrap);

/** the workbench each player uses (F at it, as Rust's: the owner, "I should have to press F on the workbench to use it"); here, as its tree is unlocked at it, and server/craft.ts reads it */
const using = new WeakMap<Client, { b: number; p: number }>();
export function useBench(c: Client, m: Extract<C2S, { t: 'bench' }>) {
  if (!c.alive || !Number.isInteger(m.b) || !Number.isInteger(m.p) || !benchAt(bases(), m.b, m.p, c.pose[0], c.pose[1], c.pose[2], NEAR.bench + 1)) return;
  using.set(c, { b: m.b, p: m.p });
}
/** the level of the workbench a player uses while it is within reach (a little more, for the lateness of their word), 0 with none */
export function usedBench(c: Client, slack = 0) {
  const u = using.get(c);
  return u ? benchAt(bases(), u.b, u.p, c.pose[0], c.pose[1], c.pose[2], NEAR.bench + slack) : 0;
}

export function learn(c: Client, m: Extract<C2S, { t: 'learn' }>) {
  if (!c.alive) return;
  const no = (why: string) => send(c, { t: 'learn', ok: false, why });
  if (m.op === 'research') {
    // (at a research table, with the thing in their pockets: it and its scrap taken, the recipe theirs)
    if (!placeNear(bases(), 'research', c.pose[0], c.pose[1], c.pose[2], 4.5)) return void no('Needs a research table within 3 m');
    const it = typeof m.u === 'string' ? [...things(c.inv)].find((x) => x.uid === m.u) : undefined;
    const r = it && teaches(it.id);
    if (!it || !r) return void no('There is nothing to learn from that');
    if (knows(knownOf(c), r.id)) return void no('You know it already');
    const cost = researchCost(r.id), uses = researchUses(r);
    if (scrapOf(c) < cost) return void no(`It takes ${cost} ${ITEMS[MAT.scrap].name.toLowerCase()}`);
    if (ITEMS[it.id].stack) {
      if (count(pocketsOf(c.inv).all, it.id) < uses) return void no(`It takes ${uses} of them`);
      pay(c, { [it.id]: uses, [MAT.scrap]: cost });
    } else {
      pay(c, { [MAT.scrap]: cost });
      refuse(c, [it.uid]);
    }
    teach(c, r.id);
    return void send(c, { t: 'learn', ok: true, r: r.id, ...(ITEMS[it.id].stack ? {} : { used: [it.uid] }) });
  }
  if (m.op === 'tree') {
    const r = typeof m.r === 'string' ? RECIPE[m.r] : undefined, t = r && treeCost(r.id);
    if (!r || !t) return void no('Nothing to learn there');
    const why = mayUnlock(r.id, knownOf(c), usedBench(c, 1.5), scrapOf(c));
    if (why) return void no(why);
    pay(c, { [MAT.scrap]: t.cost });
    teach(c, r.id);
    return void send(c, { t: 'learn', ok: true, r: r.id });
  }
}

/** for the save: each player's learned recipes, by key hash */
export const keepLearned = (): [string, string[]][] => [...learned].filter(([, s]) => s.size).map(([k, s]) => [k, [...s]]);

/** read back from the save */
export function restoreLearned(list: unknown) {
  if (!Array.isArray(list)) return;
  for (const e of list) {
    if (!Array.isArray(e) || typeof e[0] !== 'string') continue;
    const ids = cleanKnown(e[1]);
    if (ids.length) learned.set(e[0], new Set(ids));
  }
}
