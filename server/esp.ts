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

const BOX_AT: Record<BodyBox['kind'], number> = { corpse: ESP_AT.body, crate: ESP_AT.crate, stash: ESP_AT.stash, drop: ESP_AT.drop, furniture: ESP_AT.furniture };

/** the thing in a box that says most of what is in it: the biggest */
const biggest = (items: ItemInstance[]) => items.reduce((a, b) => (ITEMS[b.id] && (!ITEMS[a.id] || ITEMS[b.id].w * ITEMS[b.id].h > ITEMS[a.id].w * ITEMS[a.id].h) ? b : a));

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * What lies within `range` of x, z, nearest first: a thing on the ground as itself (what, how many, and whether it is
 * put away in a piece of furniture); a body, a crate, a stash or a drop with something in it as one row, its biggest
 * thing and how many things in all; what somebody left in a piece of furniture as itself.
 * @param inFurniture whether a loot point is in a piece of furniture (server/storages.ts `hidden`)
 */
export function espRows(loot: Iterable<WorldLoot>, boxes: Iterable<BodyBox>, x: number, z: number, inFurniture: (point: number) => boolean, range = ESP.range): EspRow[] {
  const out: [number, EspRow][] = [];
  const near = (px: number, pz: number) => {
    const d = Math.hypot(px - x, pz - z);
    return d <= range ? d : -1;
  };
  for (const l of loot) {
    const d = near(l.x, l.z);
    if (d >= 0) out.push([d, [r1(l.x), r1(l.y), r1(l.z), l.item.id, l.item.qty, inFurniture(l.point) ? ESP_AT.furniture : ESP_AT.ground]]);
  }
  for (const b of boxes) {
    const d = b.items.length ? near(b.x, b.z) : -1;
    if (d < 0) continue;
    if (b.kind === 'furniture') for (const it of b.items) out.push([d, [r1(b.x), r1(b.y), r1(b.z), it.id, it.qty, ESP_AT.furniture]]);
    else out.push([d, [r1(b.x), r1(b.y), r1(b.z), biggest(b.items).id, b.items.length, b.buried ? ESP_AT.buried : BOX_AT[b.kind]]]);
  }
  return out.sort((a, b) => a[0] - b[0]).slice(0, ESP.most).map((o) => o[1]);
}

const asked = new WeakMap<object, number>();

/** what a game that asks is answered with: null if it is not an admin's, or it asked again too soon */
export function espAnswer(who: object, role: string | null, now: number, rows: () => EspRow[]): EspRow[] | null {
  if (role !== 'admin' || now - (asked.get(who) ?? -Infinity) < ESP.every) return null;
  asked.set(who, now);
  return rows();
}
