// Where a stash can be put under the ground (2026-10-12): out in the country, and nowhere else.
//
// A stash case or a pack put down can be buried by whoever stands by it with a shovel, and dug up again by anybody
// with a shovel who finds the place. Not in a town or a camp, not in a building, and not beside one: the rule is
// here, for the game (which says so at once) and for the server (which is the one that holds everybody to it).

import { BUILDING_FOOTPRINT, type BuildingType } from '../world/worldgen';

export const BURY = {
  /** seconds with the shovel, to bury or to dig up */
  seconds: 5,
  /** nothing is buried nearer than this to a building's walls, metres */
  clear: 15,
  /** nor anywhere but on the ground itself: this far off it at most, metres */
  ground: 0.7,
  /** how near whoever digs has to stand, metres */
  reach: 4,
};

/**
 * Why nothing is buried at this place, or null if it can be.
 * @param y how high the stash stands  @param ground how high the ground is there
 * @param places the towns, camps and other named places, each as far round as it reaches
 */
export function noBurying(x: number, y: number, z: number, ground: number, places: { x: number; z: number; radius: number }[], buildings: { type: BuildingType; x: number; z: number; rot: number }[]): string | null {
  if (Math.abs(y - ground) > BURY.ground) return 'It can only be buried in open ground';
  if (places.some((p) => Math.hypot(x - p.x, z - p.z) < p.radius)) return 'Nothing is buried in a town or a camp: take it out into the country';
  for (const b of buildings) {
    const f = BUILDING_FOOTPRINT[b.type];
    if (!f) continue;
    const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot);
    if (Math.abs(dx * c - dz * s) < f[0] / 2 + BURY.clear && Math.abs(dx * s + dz * c) < f[1] / 2 + BURY.clear) return 'Nothing is buried beside a building: take it further off';
  }
  return null;
}
