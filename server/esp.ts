// An admin's far sight of the things about them (the owner, 2026-10-23: "ESP for items on the ground (think cheat
// mode)"): every thing lying within ESP.range, through anything, those put away in furniture too, and every body,
// crate, stash and drop with how many things are in it. The game asks for it while the panel's switch is on, every
// ESP.every, from wherever its view is (the free camera too); it is answered to an admin alone. test/bodies.test.ts.

import { ESP_AT, type EspRow } from '../src/net/protocol';
import type { WorldLoot } from '../src/sim/economy';
import { ITEMS, type ItemInstance } from '../src/sim/items';
import type { BodyBox } from './bodies';

/** how far it sees, metres; the most rows it says, the nearest; how often a game may ask, ms */
export const ESP = { range: 150, most: 250, every: 900 };

const BOX_AT: Record<BodyBox['kind'], number> = { corpse: ESP_AT.body, crate: ESP_AT.crate, stash: ESP_AT.stash, drop: ESP_AT.drop, furniture: ESP_AT.furniture, claim: ESP_AT.stash };

/** the thing in a box that says most of what is in it: the biggest */
const biggest = (items: ItemInstance[]) => items.reduce((a, b) => (ITEMS[b.id] && (!ITEMS[a.id] || ITEMS[b.id].w * ITEMS[b.id].h > ITEMS[a.id].w * ITEMS[a.id].h) ? b : a));

const r1 = (v: number) => Math.round(v * 10) / 10;

/** how many things are in a thing, in the bags in it too */
export const within = (it: ItemInstance): number => (it.cargo ?? []).reduce((n, p) => n + 1 + within(p.item), 0);

/**
 * What lies within `range` of x, z, nearest first: a thing on the ground as itself (what, how many, and whether it is
 * put away in a piece of furniture); a body, a crate, a stash or a drop with something in it as one row, its biggest
 * thing and how many things in all; what somebody left in a piece of furniture as itself.
 * @param inFurniture whether a loot point is in a piece of furniture (server/storages.ts `hidden`)
 */
export function espRows(loot: Iterable<WorldLoot>, boxes: Iterable<BodyBox>, x: number, z: number, inFurniture: (point: number) => boolean, range = ESP.range): EspRow[] {
  // (what is in reach found first, by the square of how far, and a row made only for the ESP.most nearest: a street of
  // a town holds two thousand things, and making a row of each took the 1 CPU server 1.7 ms a request, 2026-10-23)
  const r2 = range * range, found: { d: number; l?: WorldLoot; b?: BodyBox; it?: ItemInstance }[] = [];
  for (const l of loot) {
    const dx = l.x - x, dz = l.z - z, d = dx * dx + dz * dz;
    if (d <= r2) found.push({ d, l });
  }
  for (const b of boxes) {
    if (!b.items.length) continue;
    const dx = b.x - x, dz = b.z - z, d = dx * dx + dz * dz;
    if (d > r2) continue;
    if (b.kind === 'furniture') for (const it of b.items) found.push({ d, b, it });
    else found.push({ d, b });
  }
  found.sort((p, q) => p.d - q.d);
  const out: EspRow[] = [];
  for (const { l, b, it } of found.slice(0, ESP.most)) {
    if (l) {
      const row: EspRow = [r1(l.x), r1(l.y), r1(l.z), l.item.id, l.item.qty, inFurniture(l.point) ? ESP_AT.furniture : ESP_AT.ground], inside = within(l.item);
      if (inside) row.push(inside);
      out.push(row);
    } else if (b && it) out.push([r1(b.x), r1(b.y), r1(b.z), it.id, it.qty, ESP_AT.furniture]);
    else if (b) out.push([r1(b.x), r1(b.y), r1(b.z), biggest(b.items).id, b.items.reduce((n, q) => n + 1 + within(q), 0), b.buried ? ESP_AT.buried : BOX_AT[b.kind]]);
  }
  return out;
}

// (the animals and the infected, 2026-10-24: "admin panel needs a toggle for show animals": all of them, wherever
// they are, asked for apart from the loot so that one switch never uses up the other's turn)
const asked = { loot: new WeakMap<object, number>(), far: new WeakMap<object, number>() };

/** what a game that asks is answered with: null if it is not an admin's, or it asked again too soon */
export function espAnswer<T>(who: object, role: string | null, now: number, rows: () => T, what: keyof typeof asked = 'loot'): T | null {
  const book = asked[what];
  if (role !== 'admin' || now - (book.get(who) ?? -Infinity) < ESP.every) return null;
  book.set(who, now);
  return rows();
}
