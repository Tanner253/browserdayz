// Searchable crates that are part of the map (military crates at the checkpoint, wooden
// crates in barns, sheds and yards). Unlike ground loot they hide their contents until
// opened, and refill some time after being emptied. Pure data + rules, shared with the
// future server.

import { ITEMS, fitAtRandom, makeItem } from './items';
import type { Container } from './inventory';

type Table = [id: string, weight: number][];

const MILITARY: Table = [
  ['box_762', 3], ['box_9mm', 3], ['ammo_762', 2], ['ammo_9mm', 2], ['bandage', 2], ['firstaid', 1],
  ['condensed', 1.5], ['thermos', 1], ['binoculars', 0.5], ['gasmask', 0.5], ['grenade', 0.9], ['compass', 0.5],
  ['mag_p38_ext', 0.5], ['pu_scope', 0.1], ['rifle_wrap', 0.4], ['suppressor_9', 0.25], ['life_vest', 0.2],
  // (the service pistol was in no crate at all, and the other one was in this table twice)
  ['mosin', 0.9], ['p38', 0.9], ['m9', 0.9], ['machete', 0.4], ['rubber_boots', 0.3], ['work_gloves', 0.3], ['suitcase', 0.3],
  ['flask', 0.8], ['gun_light', 0.25], ['mag_m9_ext', 0.2], ['flashlight', 0.5],
];
const CIVILIAN: Table = [
  ['beans', 2], ['sardines', 2], ['sprats', 2], ['tomatoes', 1.5], ['apple', 1.5], ['milk', 1], ['thermos', 0.6],
  ['bandage', 1.5], ['cigarettes', 1.2], ['box_9mm', 0.4], ['ammo_9mm', 0.5],
  ['knife', 0.8], ['work_gloves', 0.8], ['boonie_hat', 0.12], ['sack_pack', 0.8], ['rubber_boots', 0.5],
  ['hatchet', 0.8], ['bat', 0.7], ['crowbar', 0.7], ['machete', 0.5], ['p38', 0.45], ['m9', 0.3], ['mosin', 0.25], ['ammo_762', 0.5],
  ['water_jug', 0.8], ['flask', 0.5], ['flashlight', 0.7],
];

/** what is in any crate that stands under the gas, whatever sort of crate it is: the best of everything */
const UNDER_GAS: Table = [
  ['box_762', 3], ['box_9mm', 3], ['ammo_762', 1.5], ['ammo_9mm', 1.5], ['mosin', 1.4], ['m9', 1.4], ['p38', 1],
  ['boonie_hat', 2], ['life_vest', 2], ['pu_scope', 1.6], ['grenade', 1.5], ['firstaid', 1.5], ['bandage', 1.5],
  ['suppressor_9', 0.8], ['mag_p38_ext', 0.8], ['rifle_wrap', 0.6], ['binoculars', 0.4], ['condensed', 0.8], ['thermos', 0.8], ['suitcase', 0.4],
  ['deagle', 0.8], ['ammo_50', 1.2], ['red_dot', 0.6], ['gun_light', 0.6], ['suppressor_762', 0.4], ['mag_m9_ext', 0.4], ['mag_deagle_ext', 0.3], ['flask', 0.5], ['keycard', 0.5],
];

/**
 * What is in whatever is searched down the bunker: the fourth and (for now) the best of the
 * places things are kept. The shotgun and all that goes with it is here and nowhere else; the
 * Desert Eagle is the gas's own and is not.
 */
const IN_BUNKER: Table = [
  ['benelli', 1.5], ['ammo_12', 3.2], ['box_12', 2.2], ['suppressor_12', 0.9], ['red_dot', 1.1], ['gun_light', 1.1],
  ['mosin', 1.1], ['pu_scope', 1.5], ['suppressor_762', 0.9], ['box_762', 2.2], ['ammo_762', 1.2],
  ['m9', 0.9], ['mag_m9_ext', 0.7], ['suppressor_9', 0.7], ['box_9mm', 1.8], ['ammo_50', 1.2], ['box_50', 0.6],
  ['grenade', 1.8], ['boonie_hat', 1.8], ['life_vest', 1.8], ['firstaid', 2.2], ['bandage', 2.2], ['splint', 0.8],
  ['flashlight', 0.9], ['flask', 0.9], ['condensed', 0.8], ['thermos', 0.6], ['water_jug', 0.7], ['beans', 0.7], ['sardines', 0.6],
];
/** and on its racks, the long things */
const ON_RACKS: Table = [['benelli', 3], ['mosin', 2], ['ammo_12', 2], ['box_12', 1.5], ['box_762', 1.5], ['suppressor_12', 0.8], ['suppressor_762', 0.8], ['pu_scope', 1.2], ['red_dot', 0.8], ['gun_light', 0.8]];

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
  // (the hard case that stands wherever a military crate or an ammunition crate stood, and a little better filled)
  weapons_case: { label: 'Weapons Case', w: 8, h: 4, table: MILITARY, count: [2, 5] },
  wooden_crate_01: { label: 'Wooden Crate', w: 6, h: 3, table: CIVILIAN, count: [1, 3] },
  // what is searched in the bunker and is no crate (see bunkerCrates): some of them are empty
  locker: { label: 'Locker', w: 4, h: 6, table: IN_BUNKER, count: [0, 2] },
  gun_rack: { label: 'Weapon Rack', w: 8, h: 4, table: ON_RACKS, count: [1, 3] },
  bunker_cabinet: { label: 'Cabinet', w: 6, h: 4, table: IN_BUNKER, count: [1, 2] },
  bunker_desk: { label: 'Desk', w: 6, h: 3, table: IN_BUNKER, count: [0, 2] },
};
/** the kinds that are the bunker's own furniture: what they hold is theirs whatever is said of where they stand */
const OF_BUNKER = new Set(['locker', 'gun_rack', 'bunker_cabinet', 'bunker_desk']);

/** seconds an emptied crate stays empty before it refills (only while nobody is near): five minutes, it was twenty */
export const CRATE_RESTOCK = 300;

/**
 * @param rich the crate stands under the gas (true) or down the bunker ('bunker'): it holds the
 *   best of what is kept there, and one thing more
 */
export function fillCrate(c: Container, kind: string, rnd: () => number = Math.random, rich: boolean | 'bunker' = false) {
  const spec = CRATE_SPECS[kind];
  if (!spec) return;
  const own = OF_BUNKER.has(kind);
  const table = own ? spec.table : rich === 'bunker' ? IN_BUNKER : rich ? UNDER_GAS : spec.table;
  const total = table.reduce((s, [, w]) => s + w, 0);
  const n = spec.count[0] + Math.floor(rnd() * (spec.count[1] - spec.count[0] + 1)) + (rich && !own ? 1 : 0);
  for (let i = 0; i < n; i++) {
    let r = rnd() * total;
    let id = table[0][0];
    for (const [tid, w] of table) {
      r -= w;
      if (r <= 0) {
        id = tid;
        break;
      }
    }
    const def = ITEMS[id];
    const item = makeItem(id, def.stack ? Math.max(1, Math.round(def.stack * (0.2 + rnd() * 0.45))) : 1);
    if (def.weapon) {
      item.loaded = Math.floor(rnd() * (def.weapon.capacity / 2 + 1));
      fitAtRandom(item, rnd);
    }
    c.add(item);
  }
}
