// Watchtowers: Pokrov's bell tower stood alone about the map (the owner, 2026-10-19, of the tower north of its church:
// "the watch tower we have in pokrov is super cool we should add those around the map i will put green dots in bright
// green where we sould copy and paste the watchtower", and "loot tier depends on how far east/west it is, tier 2 for the
// furthest west one and tier 4 for the furthest east ones"). Where each of the green dots on the owner's map falls (the
// nearest level ground to it, clear of roads, water and buildings), west to east, with its step of the map. Pure data,
// the same for the game and the server; the world sets each on the ground (src/world/worldgen/west.ts).

import type { Tier } from './tiers';

export interface Watchtower { x: number; z: number; tier: Tier }

/**
 * West to east: the first out in the desert's south, the last beyond Kamenka. (The desert's was by Blokpost's road, the
 * owner: "its too op in the desert people will spawn camp freshies, i think it needs to go out in the distance away from
 * the roads and poi's so its a looting opportuinity but not an obstacle": out where it is 360 m from any road and 400 from
 * any place. The two in the east stood off the map's edge, on a slope of snow: "the snow bell tower is off the map and
 * doesnt look good". Each on the nearest level ground inside it.)
 */
export const WATCHTOWERS: Watchtower[] = [
  { x: -2650, z: 540, tier: 2 },
  { x: -2070, z: -363, tier: 2 },
  { x: -1124, z: 18, tier: 3 },
  { x: -918, z: -355, tier: 3 },
  { x: -508, z: 502, tier: 3 },
  { x: -278, z: -324, tier: 3 },
  { x: 690, z: -134, tier: 4 },
  { x: 700, z: 496, tier: 4 },
];

/**
 * Hunting towers: the wooden watchtower (Lipki's, Blokpost's) stood in the woods (the owner, 2026-10-19: "same with the
 * wooden towers, we should call those hunting towers, and we should put those in the woods in appropriate places with
 * lower tier milkitary and survival equipment gear ... it will be the area tier-1, minimum being tier 1", and "desert
 * doesnt have hunting shacks"). Where the woods are thickest, 60 m and more from any road, clear of every place, of the
 * gas, the bunker and the fort, 350 m apart and 250 m from a watchtower. Each a step under its ground's, as the
 * watchtowers have it (2 in the west to 4 in the east): 2 in the green west and the valley's west, 3 in the east.
 */
export const HUNTING_TOWERS: Watchtower[] = [
  { x: -1750, z: -350, tier: 2 },
  { x: -1500, z: -600, tier: 2 },
  { x: -1350, z: 525, tier: 2 },
  { x: -1200, z: -375, tier: 2 },
  { x: -875, z: 300, tier: 2 },
  { x: -600, z: -450, tier: 2 },
  { x: -450, z: 0, tier: 2 },
  { x: 50, z: -425, tier: 3 },
  { x: 325, z: 425, tier: 3 },
  { x: 500, z: 50, tier: 3 },
];

/** the plot of the k-th (its loot places carry it as their building) */
export const watchtowerId = (k: number) => `watchtower_${k}`;
export const huntingId = (k: number) => `hunting_${k}`;
/** a loot place's step, if it is a watchtower's or a hunting tower's */
export function watchtowerTier(building: string): Tier | null {
  const m = /^(watchtower|hunting)_(\d+)$/.exec(building);
  return m ? (m[1] === 'hunting' ? HUNTING_TOWERS : WATCHTOWERS)[Number(m[2])]?.tier ?? null : null;
}
