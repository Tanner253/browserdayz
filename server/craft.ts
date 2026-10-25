// The server: crafting (2026-10-24, plan-crafting; the rules are src/sim/craft/). Every craft is judged here, on the
// server's own copy of the pockets, as building is: a game asks to begin one and is let (or told why not); when its hold
// is done it says so, and only if the craft took its time, standing still, and the pockets still have what it takes is
// anything used up and made. What stacks is taken as building's costs are ('spent'); a thing used up by its number (a
// jacket cut into rags) is said back by its number; the tools wear a use each; what is made goes into the pockets.

import { RECIPE, STILL } from '../src/sim/craft/recipes';
import { plan, pocketsOf } from '../src/sim/craft/plan';
import { ITEMS, makeItem, type ItemInstance } from '../src/sim/items';
import type { C2S } from '../src/net/protocol';
import { send, type Client } from './players';
import { takeOut, things } from './index';
import { pay } from './build';
import { use } from './gather';

/** the hand craft each player is at: which, how many, since when, where they stood, what they dragged together */
const doing = new WeakMap<Client, { r: string; n: number; at: number; x: number; z: number; u: string[] }>();

export function craft(c: Client, m: Extract<C2S, { t: 'craft' }>) {
  const r = typeof m.r === 'string' ? RECIPE[m.r] : undefined;
  if (!c.alive || !r) return;
  const no = (why: string) => send(c, { t: 'craft', r: r.id, ok: false, why });
  // (the workbench's queue and the forge come in their own steps)
  if (r.at !== 'hand') return void no(r.at === 'bench' ? 'Made at a workbench' : 'Smelted at a forge');
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
  pay(c, q.pay);
  if (q.uids.length) takeOut(c.inv, new Set(q.uids));
  for (const uid of q.wear) {
    const it = find(c, uid);
    if (it) use(c, it);
  }
  send(c, { t: 'craft', r: r.id, ok: true, done: true, n: q.n, used: q.uids });
  if (q.makes > 0) give(c, r.makes, q.makes);
}

function find(c: Client, uid: string): ItemInstance | null {
  for (const it of things(c.inv)) if (it.uid === uid) return it;
  return null;
}

/** `n` of a thing into the pockets (what finds no room at the feet, by the game), in piles as big as it stacks */
export function give(c: Client, id: string, n: number) {
  const max = ITEMS[id].stack ?? 1, items: ItemInstance[] = [];
  for (let left = n; left > 0; left -= max) items.push(makeItem(id, Math.min(max, left)));
  send(c, { t: 'kit', name: ITEMS[id].name, items, adds: true, gift: `${n} ${ITEMS[id].name}` });
}
