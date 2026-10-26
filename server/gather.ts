// The server: gathering (2026-10-24, base building's first step; the rules are src/sim/gather.ts). A blow that lands on a
// tree or a rock is told by the game that swung it, and believed when the tool is in the hands, near enough, no faster
// than it swings and not ruined. A felled tree's logs lie by it; stone and planks go into the pockets (the 'kit' a gift
// is given with), and what finds no room is at the feet. Each use wears the tool, and the wear is the server's to say:
// a game that says its tool is newer than the server has it is not believed ('me', see `keepWear`).

import { CHOPS, MINES, SAW, SAWS, TOOL_LIFE, TREE, Woods, condition, logAt, rockReach, treeOf, treeReach, worn } from '../src/sim/gather';
import { ITEMS, makeItem, type ItemInstance } from '../src/sim/items';
import type { SerializedInventory } from '../src/sim/inventory';
import type { C2S } from '../src/net/protocol';
import { broadcast, clients, send, type Client } from './players';
import { economy, things, world } from './index';
import { bases } from './build';

let made: Woods | null = null;
/** the trees that are down and the rocks that are spent (made when first asked: this file is read before the world is built) */
export const woods = () => (made ??= new Woods(world.trees, world.rocks));

/** what each player is at: the last blow that was believed (ms), and the log being sawn */
const doing = new WeakMap<Client, { blow: number; saw: { l: string; at: number } | null }>();
const of = (c: Client) => {
  let d = doing.get(c);
  if (!d) doing.set(c, (d = { blow: 0, saw: null }));
  return d;
};

/** every tool's condition as the server has worn it, by its uid: the lowest a game's word is taken down to */
const wear = new Map<string, number>();

/** the tool in the hands that this blow says it was struck with, if it is that and is fit to work with */
export function tool(c: Client, u: unknown, kinds: Record<string, number>): ItemInstance | null {
  if (typeof u !== 'string' || !c.w || !kinds[c.w]) return null;
  for (const it of things(c.inv)) if (it.uid === u && it.id === c.w) return it;
  return null;
}

/** a use of a tool: worn down a step, and its owner told */
export function use(c: Client, it: ItemInstance) {
  const was = Math.min(it.cond ?? 1, wear.get(it.uid) ?? 1);
  const now = worn(it.id, was);
  wear.set(it.uid, now);
  it.cond = now;
  send(c, { t: 'wear', u: it.uid, c: now });
  if (now <= 0) send(c, { t: 'tell', kind: 'warn', text: `Your ${ITEMS[it.id].name.toLowerCase()} is ruined` });
}

export const ruined = (c: Client, it: ItemInstance) => {
  if (!condition(Math.min(it.cond ?? 1, wear.get(it.uid) ?? 1)).ruined) return false;
  send(c, { t: 'tell', kind: 'warn', text: `Your ${ITEMS[it.id].name.toLowerCase()} is ruined: it is no use for work` });
  return true;
};

/** a blow is believed no sooner after the last than three quarters of the tool's swing */
function inTime(c: Client, now: number) {
  const d = of(c), gap = (ITEMS[c.w ?? '']?.melee?.rate ?? 0.75) * 750;
  if (now - d.blow < gap) return false;
  d.blow = now;
  return true;
}

export function chop(c: Client, m: Extract<C2S, { t: 'chop' }>) {
  const t = world.trees[m.i];
  if (!c.alive || !Number.isInteger(m.i) || !t || !treeOf(t) || woods().felled.has(m.i)) return;
  const it = tool(c, m.u, CHOPS);
  if (!it || Math.hypot(t.x - c.pose[0], t.z - c.pose[2]) > treeReach(t) || ruined(c, it)) return;
  const now = Date.now();
  if (!inTime(c, now)) return;
  const r = woods().chop(m.i, CHOPS[it.id], now);
  if (!r) return;
  use(c, it);
  const k = treeOf(t)!;
  send(c, { t: 'work', k: 0, i: m.i, done: r.fell ? 1 : 1 - r.left / k.blows });
  if (!r.fell) return;
  // (it falls away from whoever felled it, and its logs lie along where it fell)
  const a = Math.atan2(t.x - c.pose[0], t.z - c.pose[2]);
  broadcast({ t: 'fell', i: m.i, a, by: c.id });
  setTimeout(() => {
    for (let n = 0; n < r.logs; n++) {
      const { x, z, rot } = logAt(t, a, n);
      economy.drop(makeItem('log', 1), x, world.standAt(x, t.y + 2, z) + 0.05, z, rot);
    }
  }, TREE.lands);
}

export function mine(c: Client, m: Extract<C2S, { t: 'mine' }>) {
  const r = world.rocks[m.i];
  if (!c.alive || !Number.isInteger(m.i) || !r) return;
  const it = tool(c, m.u, MINES);
  if (!it || Math.hypot(r.x - c.pose[0], r.z - c.pose[2]) > rockReach(r) || ruined(c, it)) return;
  const now = Date.now();
  if (!inTime(c, now)) return;
  const got = woods().mine(m.i, MINES[it.id], now);
  if (!got) return;
  if (!got.give) return void send(c, { t: 'tell', kind: 'info', text: 'Nothing more breaks off this rock: come back to it later' });
  use(c, it);
  send(c, { t: 'work', k: 1, i: m.i, done: got.done });
  const stone = makeItem('stone', got.give);
  send(c, { t: 'kit', name: 'Stone', items: [stone], adds: true, gift: `${got.give} Stone` });
}

export function saw(c: Client, m: Extract<C2S, { t: 'saw' }>) {
  if (!c.alive || typeof m.l !== 'string') return;
  const d = of(c), log = economy.loot.get(m.l);
  const near = !!log && log.item.id === 'log' && Math.hypot(log.x - c.pose[0], log.z - c.pose[2]) < SAW.reach + 1;
  const it = tool(c, m.u, SAWS);
  if (m.go === 1) {
    const why = !it ? 'You need a saw in your hands' : !near ? 'That log is not here any more' : condition(Math.min(it.cond ?? 1, wear.get(it.uid) ?? 1)).ruined ? 'Your saw is ruined: it is no use for work' : null;
    d.saw = why ? null : { l: m.l, at: Date.now() };
    return void send(c, { t: 'saw', l: m.l, ok: !why, ...(why ? { why } : {}) });
  }
  const begun = d.saw;
  d.saw = null;
  const at = log && { x: log.x, y: log.y, z: log.z, rot: log.rot ?? 0 };
  if (!begun || begun.l !== m.l || Date.now() - begun.at < SAW.time * 850 || !it || !near || !at || !economy.take(m.l)) return;
  use(c, it);
  // (the planks lie where the log lay, to be picked up as anything is: the owner, "when sawing logs the planks should go on the ground")
  economy.drop(makeItem('planks', SAW.planks), at.x, world.standAt(at.x, at.y + 0.3, at.z) + 0.03, at.z, at.rot);
  send(c, { t: 'saw', l: m.l, ok: true, done: true });
}

/** Their game's word on their pockets ('me'): no tool newer than the server has worn it (nor than it was in their last word). */
export function keepWear(inv: SerializedInventory | null, had: SerializedInventory | null) {
  if (!inv) return;
  let before: Map<string, number> | null = null;
  for (const it of things(inv)) {
    if (!TOOL_LIFE[it.id]) continue;
    if (!before) {
      before = new Map();
      for (const h of things(had)) if (TOOL_LIFE[h.id] && h.cond !== undefined) before.set(h.uid, h.cond);
    }
    const c = Math.min(it.cond ?? 1, wear.get(it.uid) ?? 1, before.get(it.uid) ?? 1);
    if (c < 1) it.cond = c;
  }
}

/** every half minute: the trees whose time is up and that nobody is near stand again */
export function regrowing(now = Date.now()) {
  const alive = [...clients.values()].filter((c) => c.alive);
  // (nor one with a base built over its stump)
  const back = woods().regrow(now, (x, z, within) => alive.some((c) => Math.hypot(c.pose[0] - x, c.pose[2] - z) < within) || bases().near(x, z, 4).length > 0);
  if (back.length) broadcast({ t: 'grow', i: back });
}
