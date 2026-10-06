// Searchable crates that are part of the map (military crates at the checkpoint, wooden
// crates in barns, sheds and yards). Unlike ground loot they hide their contents until
// opened, and refill some time after being emptied. Pure data + rules, shared with the
// future server.

import { ITEMS, makeItem } from './items';
import type { Container } from './inventory';

type Table = [id: string, weight: number][];

const MILITARY: Table = [
  ['box_762', 3], ['box_9mm', 3], ['ammo_762', 2], ['ammo_9mm', 2], ['bandage', 2], ['firstaid', 1],
  ['condensed', 1.5], ['thermos', 1], ['binoculars', 0.5], ['gasmask', 0.5], ['grenade', 0.9], ['p38', 0.5], ['compass', 0.5],
  ['mag_p38_ext', 0.5], ['pu_scope', 0.3], ['rifle_wrap', 0.4], ['suppressor_9', 0.25], ['life_vest', 0.4],
  ['mosin', 0.9], ['p38', 1], ['machete', 0.4],
];
const CIVILIAN: Table = [
  ['beans', 2], ['sardines', 2], ['sprats', 2], ['tomatoes', 1.5], ['apple', 1.5], ['milk', 1], ['thermos', 0.6],
  ['bandage', 1.5], ['cigarettes', 1.2], ['box_9mm', 0.4], ['ammo_9mm', 0.5],
  ['knife', 0.8], ['work_gloves', 0.8], ['boonie_hat', 0.6], ['sack_pack', 0.8], ['rubber_boots', 0.5],
  ['hatchet', 0.8], ['bat', 0.7], ['crowbar', 0.7], ['machete', 0.5], ['p38', 0.6], ['mosin', 0.25], ['ammo_762', 0.5],
];

export interface CrateSpec {
  label: string;
  w: number;
  h: number;
  table: Table;
  count: [number, number];
}

export const CRATE_SPECS: Record<string, CrateSpec> = {
  wooden_military_crate: { label: 'Military Crate', w: 8, h: 4, table: MILITARY, count: [2, 4] },
  old_military_crate: { label: 'Ammunition Crate', w: 8, h: 4, table: MILITARY, count: [2, 4] },
  wooden_crate_01: { label: 'Wooden Crate', w: 6, h: 3, table: CIVILIAN, count: [1, 3] },
};

/** seconds an emptied crate stays empty before it refills (only while nobody is near) */
export const CRATE_RESTOCK = 1200;

export function fillCrate(c: Container, kind: string, rnd: () => number = Math.random) {
  const spec = CRATE_SPECS[kind];
  if (!spec) return;
  const total = spec.table.reduce((s, [, w]) => s + w, 0);
  const n = spec.count[0] + Math.floor(rnd() * (spec.count[1] - spec.count[0] + 1));
  for (let i = 0; i < n; i++) {
    let r = rnd() * total;
    let id = spec.table[0][0];
    for (const [tid, w] of spec.table) {
      r -= w;
      if (r <= 0) {
        id = tid;
        break;
      }
    }
    const def = ITEMS[id];
    const item = makeItem(id, def.stack ? Math.max(1, Math.round(def.stack * (0.2 + rnd() * 0.45))) : 1);
    if (def.weapon) item.loaded = Math.floor(rnd() * (def.weapon.capacity / 2 + 1));
    c.add(item);
  }
}
