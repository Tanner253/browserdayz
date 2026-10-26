// The server: crafting (2026-10-24, plan-crafting; the rules are src/sim/craft/). Every craft is judged here, on the
// server's own copy of the pockets, as building is. By hand: a game asks to begin one and is let (or told why not); when
// its hold is done it says so, and only if it took its time, standing still, and the pockets still have what it takes is
// anything used up and made. At a workbench (Rust's): up to five jobs queued, run here one after another while their maker
// stands at a bench, waiting while they are away; each one made takes what it needs as it is finished, so nothing queued
// is ever owed back. What stacks is taken as building's costs are ('spent'); a thing used up by its number (a jacket cut
// into rags) is said back by its number; the tools wear a use each; what is made goes into the pockets. Only what the
// player has learned is made (server/learn.ts), and a bench's recipe only at a bench of its level.

import { LEVEL_NAME, MOST, NEAR, RECIPE, STILL, type Recipe } from '../src/sim/craft/recipes';
import { madeItems, plan, pocketsOf, type Plan } from '../src/sim/craft/plan';
import { makeItem, ITEMS, type ItemInstance } from '../src/sim/items';
import type { C2S } from '../src/net/protocol';
import { clients, send, type Client } from './players';
import { issue, things } from './index';
import { creative, pay } from './build';
import { use } from './gather';
import { mayMake, usedBench } from './learn';
import { refuse } from './searched';
// (every forge runs on its own clock from here: server/forge.ts)
import './forge';

/** the hand craft each player is at: which, how many, since when, where they stood, what they dragged together */
const doing = new WeakMap<Client, { r: string; n: number; at: number; x: number; z: number; u: string[] }>();

export function craft(c: Client, m: Extract<C2S, { t: 'craft' }>) {
  const r = typeof m.r === 'string' ? RECIPE[m.r] : undefined;
  if (!c.alive || !r) return;
  const no = (why: string) => send(c, { t: 'craft', r: r.id, ok: false, why });
  // (a workbench's are queued: 'cq'; the forge's are its own)
  if (r.at !== 'hand') return void no(r.at === 'bench' ? 'Made at a workbench' : 'Smelted at a forge');
  // (an admin in creative: made at once, for nothing, learned or not)
  if (creative(c)) return void made(c, r, Number(m.n));
  if (!mayMake(c, r.id)) return void no('You have not learned it');
  const u = Array.isArray(m.u) ? m.u.filter((x): x is string => typeof x === 'string').slice(0, 4) : [];
  if (m.go === 1) {
    const q = plan(r, Number(m.n), pocketsOf(c.inv), u);
    if (typeof q === 'string') {
      doing.delete(c);
      return void no(q);
    }
    doing.set(c, { r: r.id, n: q.n, at: Date.now(), x: c.pose[0], z: c.pose[2], u });
    return void send(c, { t: 'craft', r: r.id, ok: true, n: q.n, time: q.time });
  }
  const d = doing.get(c);
  doing.delete(c);
  if (!d || d.r !== r.id) return;
  const q = plan(r, d.n, pocketsOf(c.inv), d.u);
  if (typeof q === 'string') return void no(q);
  // (a game's word that it is done sooner, or that it was done walking about, is not believed)
  if (Date.now() - d.at < q.time * 850) return void no('That was done too quickly');
  if (Math.hypot(c.pose[0] - d.x, c.pose[2] - d.z) > STILL + 0.4) return void no('You moved, and stopped what you were making');
  make(c, q);
  send(c, { t: 'craft', r: r.id, ok: true, done: true, n: q.n, used: q.uids });
}

/** made for an admin in creative: so many of what a recipe makes, at once, out of nothing */
function made(c: Client, r: Recipe, n: number) {
  const k = Math.max(1, Math.min(99, Math.floor(n) || 1));
  give(c, r.makes, r.qty * k);
  send(c, { t: 'craft', r: r.id, ok: true, done: true, n: k, used: [] });
}

/** a plan carried out on a player's pockets: what it takes taken, the tools worn, what it makes given (and its uids gone) */
function make(c: Client, q: Plan) {
  // (a key copied: cut to the number of the key it was copied from, which is kept and not worn)
  if (q.r.id === 'key_copy') {
    const from = q.wear.map((uid) => find(c, uid)).find((it) => it?.id === 'key' && it.key !== undefined);
    if (!from) return;
    pay(c, q.pay);
    const keys = Array.from({ length: q.makes }, () => Object.assign(makeItem('key', 1), { key: from.key }));
    return void send(c, { t: 'kit', name: 'Key', items: keys, adds: true, gift: keys.length > 1 ? `${keys.length} copies of the key` : 'A copy of the key' });
  }
  pay(c, q.pay);
  if (q.uids.length) refuse(c, q.uids);
  for (const uid of q.wear) {
    const it = find(c, uid);
    if (it) use(c, it);
  }
  if (q.makes > 0) give(c, q.r.makes, q.makes);
}

function find(c: Client, uid: string): ItemInstance | null {
  for (const it of things(c.inv)) if (it.uid === uid) return it;
  return null;
}

/** `n` of a thing into the pockets (what finds no room at the feet, by the game), in piles as big as it stacks; a gun or a
 * tool the server's own, so that it is not taken for one a game made up (index.ts's `issue`) */
export function give(c: Client, id: string, n: number) {
  const items = madeItems(id, n);
  for (const it of items) issue(it);
  send(c, { t: 'kit', name: ITEMS[id].name, items, adds: true, gift: `${n} ${ITEMS[id].name}` });
}

// ---- a workbench's queue

/** each player's: the jobs, the seconds the first is through, and whether it is waiting for them to come back to a bench */
const queues = new Map<Client, { jobs: { r: string; n: number }[]; done: number; paused: boolean }>();
/** how often the queues are run, s */
const STEP = 0.25;
let timer: ReturnType<typeof setInterval> | null = null;

/** the workbench a player uses (F at it) within reach (a little more than its recipes light up within, for the lateness of their word), of a recipe's level or above */
const atBench = (c: Client, r: Recipe, slack = 0) => usedBench(c, slack) >= (r.lv ?? 1);

const tellQueue = (c: Client) => {
  const q = queues.get(c);
  send(c, { t: 'cq', q: q?.jobs ?? [], done: q?.done ?? 0, paused: q?.paused ?? false });
};

export function enqueue(c: Client, m: Extract<C2S, { t: 'cq' }>) {
  const r = typeof m.r === 'string' ? RECIPE[m.r] : undefined;
  if (!c.alive || !r || r.at !== 'bench') return;
  const no = (why: string) => send(c, { t: 'craft', r: r.id, ok: false, why });
  if (creative(c)) return void made(c, r, Number(m.n));
  if (!mayMake(c, r.id)) return void no('You have not learned it');
  if (!atBench(c, r, 1)) return void no(r.lv && r.lv > 1 ? `Use a ${LEVEL_NAME[r.lv]} or better: F at it` : 'Use a workbench: F at it');
  const q = queues.get(c) ?? { jobs: [], done: 0, paused: false };
  if (q.jobs.length >= MOST.queue) return void no(`The bench takes ${MOST.queue} jobs at a time`);
  const p = plan(r, Math.max(1, Math.min(99, Math.floor(Number(m.n)) || 1)), pocketsOf(c.inv));
  if (typeof p === 'string') return void no(p);
  q.jobs.push({ r: r.id, n: p.n });
  queues.set(c, q);
  timer ??= setInterval(runQueues, STEP * 1000);
  tellQueue(c);
}

export function unqueue(c: Client, m: Extract<C2S, { t: 'cqx' }>) {
  const q = queues.get(c);
  if (!q || !Number.isInteger(m.i) || !q.jobs[m.i]) return;
  q.jobs.splice(m.i, 1);
  if (m.i === 0) q.done = 0;
  if (!q.jobs.length) queues.delete(c);
  tellQueue(c);
}

/** every queue a step on: the first job of each runs while its maker stands at a bench, and is made when its time is up */
function runQueues() {
  for (const [c, q] of queues) {
    // (gone, or dead: the queue goes with them, and nothing was taken for it)
    if (clients.get(c.id) !== c || !c.alive || !q.jobs.length) {
      queues.delete(c);
      continue;
    }
    const job = q.jobs[0], r = RECIPE[job.r];
    const paused = !atBench(c, r, 1.5);
    if (paused !== q.paused) {
      q.paused = paused;
      tellQueue(c);
    }
    if (paused) continue;
    q.done += STEP;
    if (q.done + 1e-6 < r.time) continue;
    q.done = 0;
    const p = plan(r, 1, pocketsOf(c.inv));
    if (typeof p === 'string') {
      send(c, { t: 'tell', kind: 'warn', text: `${ITEMS[r.makes].name}: ${p}, taken off the bench` });
      q.jobs.shift();
    } else {
      make(c, p);
      if (--job.n <= 0) q.jobs.shift();
    }
    if (!q.jobs.length) queues.delete(c);
    tellQueue(c);
  }
  if (!queues.size && timer) {
    clearInterval(timer);
    timer = null;
  }
}
