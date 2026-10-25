// Crafting as the game has it (2026-10-24, plan-crafting; the rules are src/sim/craft/, the server's side
// server/craft.ts). A hand craft is DayZ's: the hands at it for its time, standing still (the ring we have), the server
// asked first and told when it is done; it says what was used up and gives what was made. A workbench's recipes are
// Rust's: queued, up to five, run by the server while you stand at a bench and waiting while you are away; the game shows
// the queue the server tells it. Played alone, the same rules on this game's own pockets and bases.

import * as THREE from 'three';
import { MOST, NEAR, RECIPE, STILL, type Place, type Recipe } from '../sim/craft/recipes';
import { placeNear } from '../sim/craft/places';
import type { Bases } from '../sim/build/bases';
import { plan, recipeName, recipesFor, type Pockets } from '../sim/craft/plan';
import { worn } from '../sim/gather';
import { ITEMS, makeItem, type ItemInstance } from '../sim/items';
import type { C2S, S2C } from '../net/protocol';

export interface CraftHost {
  online: () => boolean;
  send: (m: C2S) => void;
  note: (text: string, kind: 'good' | 'warn' | 'info') => void;
  /** what is carried, as the rule reads it */
  pockets: () => Pockets;
  /** a thing carried, by its uid */
  find: (uid: string) => ItemInstance | null;
  me: () => THREE.Vector3;
  /** the hands at a thing for `dur` seconds (TimedAction): done unless `valid` stops being true */
  begin: (label: string, dur: number, valid: () => boolean, done: () => void, lost: string) => void;
  busy: () => boolean;
  breakOff: () => void;
  /** a thing used up by its number (a jacket cut into rags) */
  remove: (uid: string) => void;
  /** played alone: so many of a kind taken out of the pockets */
  take: (id: string, n: number) => void;
  /** played alone: things put into the pockets (what finds no room at the feet), with what to say of them */
  give: (items: ItemInstance[], gift: string) => void;
  /** the pockets have changed: the server is told, and the screens drawn again */
  changed: () => void;
  /** the bases this game knows: where its workbenches and forges stand */
  bases: () => Bases;
}

/** a workbench's queue as this game has it: the jobs, the seconds the first is through as told, and when that was told */
export interface BenchQueue {
  jobs: { r: string; n: number }[];
  done: number;
  paused: boolean;
  at: number;
}

export class Crafting {
  /** what the hands were last set to make (the Crafting tab's strip shows the hold while it is this) */
  label = '';
  /** the workbench's queue: the server's word on it, or this game's own played alone */
  queue: BenchQueue = { jobs: [], done: 0, paused: false, at: 0 };
  constructor(private h: CraftHost) {}

  /** whether a workbench or a forge is near enough to make its recipes (by hand: always) */
  near(at: Place) {
    if (at === 'hand') return true;
    const me = this.h.me();
    return !!placeNear(this.h.bases(), at, me.x, me.y, me.z, NEAR[at]);
  }

  /** the hand recipes two carried things dragged onto each other go into */
  recipesFor(a: ItemInstance, b: ItemInstance): Recipe[] {
    const p = this.h.pockets();
    if (!p.free.some((it) => it.uid === a.uid) || !p.all.some((it) => it.uid === b.uid)) return [];
    return recipesFor(a, b);
  }

  /** `n` of recipe `rid` made by hand, the things in `u` used first: the hands at it, standing still */
  craft(rid: string, n = 1, u: string[] = []): boolean {
    const r = RECIPE[rid];
    if (!r) return false;
    if (r.at === 'bench') return this.enqueue(r, n);
    if (r.at !== 'hand') return void this.h.note('That is smelted at a forge', 'info'), false;
    if (this.h.busy()) return void this.h.note('Your hands are busy', 'info'), false;
    const q = plan(r, n, this.h.pockets(), u);
    if (typeof q === 'string') return void this.h.note(q, 'warn'), false;
    const from = this.h.me().clone();
    const still = () => Math.hypot(this.h.me().x - from.x, this.h.me().z - from.z) < STILL;
    if (this.h.online()) this.h.send({ t: 'craft', r: r.id, n: q.n, go: 1, u });
    const label = (this.label = r.id === 'rags' ? 'Cutting clothes into rags' : `Making ${q.n > 1 ? `${q.n} × ` : ''}${recipeName(r)}`);
    this.h.begin(label, q.time, still, () => {
      if (!still()) return;
      if (this.h.online()) return void this.h.send({ t: 'craft', r: r.id, n: q.n, go: 2, u });
      this.alone(r, q.n, u);
    }, 'You stopped: nothing was used up');
    return true;
  }

  /** `n` of a workbench's recipe put on its queue */
  private enqueue(r: Recipe, n: number): boolean {
    if (!this.near('bench')) return void this.h.note(`Needs a workbench within ${NEAR.bench} m`, 'warn'), false;
    if (this.queue.jobs.length >= MOST.queue) return void this.h.note(`The bench takes ${MOST.queue} jobs at a time`, 'warn'), false;
    const q = plan(r, n, this.h.pockets());
    if (typeof q === 'string') return void this.h.note(q, 'warn'), false;
    if (this.h.online()) this.h.send({ t: 'cq', r: r.id, n: q.n });
    else {
      this.queue.jobs.push({ r: r.id, n: q.n });
      this.queue.at = performance.now();
    }
    return true;
  }

  /** job `i` taken off the queue */
  unqueue(i: number) {
    if (this.h.online()) return void this.h.send({ t: 'cqx', i });
    if (!this.queue.jobs[i]) return;
    this.queue.jobs.splice(i, 1);
    if (i === 0) this.queue.done = 0;
    this.queue.at = performance.now();
  }

  onQueue(m: Extract<S2C, { t: 'cq' }>) {
    this.queue = { jobs: m.q, done: m.done, paused: m.paused, at: performance.now() };
  }

  /** the queue's first job, how far through (0..1) and how long it has left, s, as of now */
  running(): { r: Recipe; t: number; left: number; paused: boolean } | null {
    const q = this.queue, job = q.jobs[0];
    if (!job) return null;
    const r = RECIPE[job.r], done = Math.min(r.time, q.done + (q.paused ? 0 : (performance.now() - q.at) / 1000));
    return { r, t: done / r.time, left: r.time - done, paused: q.paused };
  }

  /** played alone, every frame: the queue run as the server runs it (src/server/craft.ts runQueues) */
  update(dt: number) {
    const q = this.queue;
    if (this.h.online() || !q.jobs.length) return;
    q.paused = !this.near('bench');
    q.at = performance.now();
    if (q.paused) return;
    const r = RECIPE[q.jobs[0].r];
    if ((q.done += dt) < r.time) return;
    q.done = 0;
    const p = plan(r, 1, this.h.pockets());
    if (typeof p === 'string') {
      this.h.note(`${ITEMS[r.makes].name}: ${p}, taken off the bench`, 'warn');
      q.jobs.shift();
      return;
    }
    this.alone(r, 1, []);
    if (--q.jobs[0].n <= 0) q.jobs.shift();
  }

  onCraft(m: Extract<S2C, { t: 'craft' }>) {
    if (!m.ok) {
      this.h.breakOff();
      if (m.why) this.h.note(m.why, 'warn');
      return;
    }
    if (!m.done) return;
    for (const uid of m.used ?? []) this.h.remove(uid);
    this.h.changed();
  }

  /** played alone: the same rule, on this game's own pockets */
  private alone(r: Recipe, n: number, u: string[]) {
    const q = plan(r, n, this.h.pockets(), u);
    if (typeof q === 'string') return void this.h.note(q, 'warn');
    for (const [id, k] of Object.entries(q.pay)) this.h.take(id, k);
    for (const uid of q.uids) this.h.remove(uid);
    for (const uid of q.wear) {
      const it = this.h.find(uid);
      if (!it) continue;
      it.cond = worn(it.id, it.cond);
      if (it.cond <= 0) this.h.note(`Your ${ITEMS[it.id].name.toLowerCase()} is ruined`, 'warn');
    }
    this.h.changed();
    if (q.makes <= 0) return;
    const max = ITEMS[r.makes].stack ?? 1, items: ItemInstance[] = [];
    for (let left = q.makes; left > 0; left -= max) items.push(makeItem(r.makes, Math.min(max, left)));
    this.h.give(items, `${q.makes} ${ITEMS[r.makes].name}`);
  }
}
