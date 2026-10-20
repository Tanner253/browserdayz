// The places stocked apart from the rest of the map, on top of it: the fort, the hamlet on its track, the wreck under the
// bridge, every cellar, Kalat and the new towns, the canyon pass. How each is told, and how its share leans. Read by
// the economy (src/sim/economy.ts).

import type { Usage } from '../world/buildings';
import { ITEMS } from './items';
import { TOWNS } from './towns';
import { DESERT_TOWNS } from './desert';

/** the towns stocked apart: all but the desert's, which are the map's own first and second steps (src/sim/desert.ts) */
const APART_TOWNS = TOWNS.filter((t) => !DESERT_TOWNS.includes(t));

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
// ('kamenka', its army and police places on the fourth step, 2026-10-18: of the step, they would have taken the gas's
// guns. Told by being of the town ('East') and of that step, not by a building's name)
// ('watchtower' and 'hunting', the towers stood about the map 2026-10-19, `watchtower_<n>` and `hunting_<n>`: part of the
// fourth step, the eastern watchtowers took the gas's things, a keycard among them, as under the gas anything lies
// anywhere; apart, each keeps the army's and the hunter's gear it was stood for)
export const APART = new Set(['castle', 'hamlet', 'wreck', 'cellar', 'kalat', 'pass', 'kamenka', 'watchtower', 'hunting', ...APART_TOWNS.map((t) => t.name.toLowerCase())]);
/** the place apart a loot point is of, by the name of its building (Kalat's pieces `ruins_<piece>`, a new town's plots `<town>_<n>`, the pass's caves `cave_<where>`; Kamenka's fourth step by its kind), or null: the map's own */
export function apartOf({ building, usage, tier }: { building: string; usage?: readonly string[]; tier?: number }): string | null {
  if (APART.has(building)) return building;
  if (tier === 4 && usage?.includes('East')) return 'kamenka';
  if (building.startsWith('ruins_')) return 'kalat';
  if (building.startsWith('cave_')) return 'pass';
  const town = building.replace(/_\d+$/, '');
  return town !== building && APART.has(town) ? town : null;
}
/** how a place apart's share leans, sort by sort, as each sort's own rule says (see APART_LEAN) */
function APART_LEAN_OF(): Record<string, number> {
  return Object.fromEntries(Object.values(ITEMS).flatMap((d) => (d.loot?.lean ? [[d.id, d.loot.lean]] : [])));
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
  // (the fort on the fifth step, half as thick as the bunker and with none of what is the bunker's alone: the owner, 2026-10-18: "kalat should be tier 2 loot zavo tier 2, the pass tier 3 pipki tier 3 mokroye tier 3 zalena tier 3 and kamenka tier 4 orlanoy tier 5 (not as dense as bunker, but still top tier loot, player should still want to go to bunker)")
  castle: { rich: 0.5, lean: { ...APART_LEAN_OF(), ...Object.fromEntries(Object.values(ITEMS).filter((d) => d.loot?.at && d.loot.at.slice(0, 4).every((n) => !n) && (d.loot.at[4] ?? 0) > 0).map((d) => [d.id, 0])) } },
  ...Object.fromEntries(['kalat', ...APART_TOWNS.map((t) => t.name.toLowerCase())].map((k) => [k, { rich: 1, lean: {} }])),
  // (as its step is, and never a keycard: those are the Chemical Works' alone)
  kamenka: { rich: 1, lean: { keycard: 0 } },
};
/**
 * How a place apart's share leans, sort by sort (times its share; a sort not named, 1). 2026-10-13, after the owner
 * had played the fort: "the loot in the castle should be a bit better i think". It was stocked exactly as its step
 * of the map is, and so it held what a step holds: three loose submachine guns and their magazines, cigarettes and
 * hats, and not one magazine for the rifles on its own racks. A garrison's store leans to what a rifle needs and
 * what a wound needs, and has less of what lies in any village. (Still never more of a sort than the whole step
 * has, and nothing that is the bunker's alone: the drum, the long magazine, the K6-3.)
 */
export const APART_LEAN: Record<string, number> = APART_LEAN_OF();

/** what a named place apart never has less of on its step (the fourth and up), whatever its shares come to (where it has a spot of the kind): a magazine for each rifle of its racks, and a dressing station's own; and the fort's keycard and its pile of .50, each its one (the owner, 2026-10-19: "regular rare in T5 like the castle", "very rare in the castle") */
export const APART_LEAST: Record<string, Record<string, number>> = {
  castle: { mag_ak: 2, mag_ar: 2, mag_sniper: 1, pu_scope: 1, suppressor_762: 1, grenade: 2, armor_vest: 1, stim_combat: 2, blood_bag: 2, saline: 1, firstaid: 2, keycard: 1, ammo_50bmg: 1 },
};
/**
 * The kind of spot a sort lies at in a place apart, where it has no kind of its own (under the gas such a thing
 * lies anywhere, and a place apart is sorted on every step: so it lay nowhere in one).
 */
export const APART_KIND: Record<string, Usage[]> = Object.fromEntries(Object.values(ITEMS).flatMap((d) => (d.loot?.apart ? [[d.id, d.loot.apart]] : [])));
