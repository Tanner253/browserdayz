// The server: recyclers (progression v3; the rules are src/sim/craft/recyclers.ts). Each is a store of the server's own,
// opened and filled as a crate is, by anybody (Rust's); switched on by whoever stands at it, it runs a thing at a time
// until nothing in it goes through, whoever is about. Whoever has it open sees it change; everybody is told it runs
// (it is heard far off: the game plays its sound), and whoever comes in is told which are running.

import type { C2S, StoredItem } from '../src/net/protocol';
import { RECYCLE, recycleStep, recyclable, type Run } from '../src/sim/craft/recyclers';
import type { ItemInstance } from '../src/sim/items';
import { broadcast, send, type Client } from './players';
import { KEPT } from './keep';
import { boxes, world } from './index';
import { boxItems, tellOpeners } from './searched';

export const recyCid = (i: number) => `recy:${i}`;
const runs: Run[] = [];

/** each recycler's store, made the first time it is asked for (this file is read before the world is), or as it was kept over a restart */
function storeOf(i: number) {
  const r = world.recyclers[i];
  if (!r) return undefined;
  let box = boxes.get(recyCid(i));
  if (!box) {
    const [w, h] = RECYCLE.store;
    boxes.set(recyCid(i), (box = { cid: recyCid(i), kind: 'recycler', w, h, items: [] as StoredItem[], x: r.x, y: r.y + 1, z: r.z, rot: 0, emptiedAt: -1 }));
  }
  runs[i] ??= { on: false, done: 0 };
  return box;
}
// (made as soon as the world is: a store is opened by its name, 'copen', before anybody has switched it on)
setTimeout(() => world.recyclers.forEach((_, i) => storeOf(i)), 0);

export function recycle(c: Client, m: Extract<C2S, { t: 'recy' }>) {
  const r = Number.isInteger(m.i) ? world.recyclers[m.i] : undefined, box = r && storeOf(m.i);
  if (!c.alive || !r || !box || Math.hypot(r.x - c.pose[0], r.z - c.pose[2]) > 4.5) return;
  const run = runs[m.i];
  if (m.on && !box.items.some((it) => recyclable(it as ItemInstance))) return void send(c, { t: 'tell', kind: 'info', text: 'Nothing in it goes through a recycler' });
  if (run.on === !!m.on) return;
  run.on = !!m.on;
  run.done = 0;
  broadcast({ t: 'recy', i: m.i, on: run.on });
}

/** whoever comes in: told which recyclers are running */
export function tellRecyclers(c: Client) {
  runs.forEach((run, i) => run?.on && send(c, { t: 'recy', i, on: true }));
}

/** every second: each running recycler a second on; whoever has it open told what is in it now */
setInterval(() => {
  runs.forEach((run, i) => {
    if (!run?.on) return;
    const box = boxes.get(recyCid(i));
    if (!box) return;
    const was = run.on;
    if (!recycleStep(run, box.items, 1)) return;
    tellOpeners(box.cid, { t: 'cdata', cid: box.cid, items: boxItems(box) });
    KEPT.dirty = true;
    if (was && !run.on) broadcast({ t: 'recy', i, on: false });
  });
}, 1000);
