// The server: salvage (2026-10-25, plan-crafting; the rules are src/sim/craft/salvage.ts). A blow that lands on a
// wreck, a drum or a heap of junk is told by the game that swung it, and believed as a blow at a tree is (server/
// gather.ts): the tool in the hands, near enough, no faster than it swings, not ruined. The fragments (and, on the blow
// that strips it, the scrap) go into the pockets; each spot has them again two hours after it was last struck, when
// nobody stands at it.

import { SALVAGE, Scrapyard } from '../src/sim/craft/salvage';
import { MAT } from '../src/sim/craft/materials';
import type { C2S } from '../src/net/protocol';
import { ITEMS } from '../src/sim/items';
import { clients, send, type Client } from './players';
import { world } from './index';
import { ruined, tool, use } from './gather';
import { give } from './craft';

let made: Scrapyard | null = null;
/** every spot's fragments (made when first asked: this file is read before the world is built) */
export const yard = () => (made ??= new Scrapyard(world.salvage));

/** each player's last believed blow, ms */
const last = new WeakMap<Client, number>();

export function salvage(c: Client, m: Extract<C2S, { t: 'salvage' }>) {
  const s = Number.isInteger(m.i) ? world.salvage[m.i] : undefined;
  if (!c.alive || !s) return;
  const it = tool(c, m.u, SALVAGE.tools);
  if (!it || Math.hypot(s.x - c.pose[0], s.z - c.pose[2]) > s.reach + 1.5 || ruined(c, it)) return;
  const now = Date.now();
  if (now - (last.get(c) ?? 0) < (ITEMS[it.id].melee?.rate ?? 0.75) * 750) return;
  last.set(c, now);
  const r = yard().blow(m.i, SALVAGE.tools[it.id], now);
  if (!r) return;
  if (!r.give) return void send(c, { t: 'tell', kind: 'info', text: `Nothing more comes off this ${s.name}: come back to it later` });
  use(c, it);
  send(c, { t: 'salvage', i: m.i, done: r.done });
  give(c, MAT.frags, r.give);
  if (r.scrap) give(c, MAT.scrap, r.scrap);
}

/** every half minute: the spots whose time is up and that nobody is near have their fragments again */
setInterval(() => {
  const alive = [...clients.values()].filter((c) => c.alive);
  yard().rust(Date.now(), (x, z, within) => alive.some((c) => Math.hypot(c.pose[0] - x, c.pose[2] - z) < within));
}, 30_000);
