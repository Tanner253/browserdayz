// The places stocked apart from the rest of the map, on top of it: the fort, the hamlet on its track, the wreck under the
// bridge, every cellar, Kalat and the new towns, the canyon pass. How each is told, and how its share leans. Read by
// the economy (src/sim/economy.ts).

import type { Usage } from '../world/buildings';
import { ITEMS } from './items';
import { TOWNS } from './towns';

/**
 * Places that are stocked APART from the rest of the map, by the name their loot points carry as their building
 * (2026-10-13: the fort on the mountain, seventy places; and the wreck in the cleft under the bridge, five, which
 * being floor took three of the gas's five AKs). Every step of the map is stocked to counts (`at`), so a
 * new place on a step took its things out of the places that were there: with the fort part of the third step
 * Kamenka had two armoured vests where it had five, and the Chemical Works shared its rifles with the fort's
 * vaults. A place apart is stocked ON TOP of the map, which keeps all of its own: of each sort, as many as its
 * places would have drawn had they been part of their step (by the same kinds of place and the same leanings),
 * never more of a sort than the whole step has, and never more things than `APART_FILL` of its places.
 */
// ('hamlet': the ruined houses along the track to the fort, 2026-10-13: named apart from the fort so that the map
// marks the fort as wide as the fort)
// ('cellar': every basement's places, 2026-10-14: "basements are missing loot". Part of their steps they shared those
// steps' counts with every house, and stood empty.)
// ('kalat', the ruined town in the desert, and the new towns of the map three times over, 2026-10-16, each by its
// name: their places are `ruins_<piece>`'s and `<town>_<n>`'s. Of their steps, they took those steps' things from the
// old map: Kalat the gas works' share of the fourth step's, the towns on the third Kamenka's. See OWN: stocked as
// their steps are.)
// ('pass', the canyon pass's caves and the cache on its floor, `cave_<where>`: part of the fifth step they took the
// bunker's own things; apart, stocked as the fort is, as the owner's "best loot in the center of the bottom of the canyon")
export const APART = new Set(['castle', 'hamlet', 'wreck', 'cellar', 'kalat', 'pass', ...TOWNS.map((t) => t.name.toLowerCase())]);
/** the place apart a loot point is of, by the name of its building (Kalat's pieces `ruins_<piece>`, a new town's plots `<town>_<n>`, the pass's caves `cave_<where>`), or null: the map's own */
export function apartOf(building: string): string | null {
  if (APART.has(building)) return building;
  if (building.startsWith('ruins_')) return 'kalat';
  if (building.startsWith('cave_')) return 'pass';
  const town = building.replace(/_\d+$/, '');
  return town !== building && APART.has(town) ? town : null;
}
/** the most of a place apart's free places that are ever filled: a room with something on every surface is a shop */
export const APART_FILL = 0.85;
/** and how many times its fair share it is stocked to, up to that: a place apart is somewhere worth the going to */
export const APART_RICH = 1.5;
/**
 * A place apart that is not stocked as the fort is: how many times its fair share, and how it leans (unsaid: APART_RICH
 * and APART_LEAN, the fort's garrison store). The cellars are houses' stores, of every kind a house keeps, and well
 * stocked, a reward for going down: their places are few against the map's, and at the fort's share they held little.
 */
// (the new places of the map three times over are stocked as their steps are, no richer: they are new ground, not a reward)
export const OWN: Record<string, { rich: number; lean: Record<string, number> }> = {
  cellar: { rich: 3, lean: {} },
  ...Object.fromEntries(['kalat', ...TOWNS.map((t) => t.name.toLowerCase())].map((k) => [k, { rich: 1, lean: {} }])),
};
/**
 * How a place apart's share leans, sort by sort (times its share; a sort not named, 1). 2026-10-13, after the owner
 * had played the fort: "the loot in the castle should be a bit better i think". It was stocked exactly as its step
 * of the map is, and so it held what a step holds: three loose submachine guns and their magazines, cigarettes and
 * hats, and not one magazine for the rifles on its own racks. A garrison's store leans to what a rifle needs and
 * what a wound needs, and has less of what lies in any village. (Still never more of a sort than the whole step
 * has, and nothing that is the bunker's alone: the drum, the long magazine, the K6-3.)
 */
export const APART_LEAN: Record<string, number> = Object.fromEntries(Object.values(ITEMS).flatMap((d) => (d.loot?.lean ? [[d.id, d.loot.lean]] : [])));

/** what a named place apart never has less of on its fourth step, whatever its shares come to (where it has a spot of the kind): a magazine for each rifle of its racks, and a dressing station's own */
export const APART_LEAST: Record<string, Record<string, number>> = {
  castle: { mag_ak: 2, mag_ar: 2, mag_sniper: 1, pu_scope: 1, suppressor_762: 1, grenade: 2, armor_vest: 1, stim_combat: 2, blood_bag: 2, saline: 1, firstaid: 2 },
};
/**
 * The kind of spot a sort lies at in a place apart, where it has no kind of its own (under the gas such a thing
 * lies anywhere, and a place apart is sorted on every step: so it lay nowhere in one).
 */
export const APART_KIND: Record<string, Usage[]> = Object.fromEntries(Object.values(ITEMS).flatMap((d) => (d.loot?.apart ? [[d.id, d.loot.apart]] : [])));
