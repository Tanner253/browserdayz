// Whether an item can physically lie at a loot point. Shared by the server (which
// decides what spawns where) and the client (which lays the model down), so both agree.

import type { LootPoint } from '../world/buildings';
import { ITEMS } from './items';
import sizes from './item-sizes.json';

/**
 * Footprint of every item's world model in metres [x, y, z], as laid down in the world.
 * Generated from the real models: run `copy(JSON.stringify(T.itemSizes()))` in the dev
 * console after adding items and paste the result into item-sizes.json.
 */
export const ITEM_SIZES = sizes as unknown as Record<string, [number, number, number]>;

export function fitsPoint(id: string, p: LootPoint): boolean {
  const def = ITEMS[id];
  if (p.floor) return true;
  // long guns, tools, jerrycans, suitcases: floor only
  if (Math.max(def.w, def.h) >= 4) return false;
  const size = ITEM_SIZES[id];
  if (!size || !p.surf) return Math.max(def.w, def.h) <= 2;
  const hx = size[0] / 2, hz = size[2] / 2, over = 0.03;
  const s = p.surf;
  // the next shelf up is in the way of tall things
  if (size[1] > s.clear) return false;
  return (hx <= s.hx + over && hz <= s.hz + over) || (hz <= s.hx + over && hx <= s.hz + over);
}
