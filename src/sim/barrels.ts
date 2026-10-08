// Fuel drums. The red barrels standing about the yards and sheds go up when a bullet finds
// them, and take whoever is standing near with them: a thing to shoot at instead of the man
// behind it, and a reason to look at what you are taking cover beside. One going up sets off
// the next one it reaches. The blue ones hold water and only ring.
//
// Rules and data only. How hard the blast hits is in src/sim/combat.ts (the 'barrel' rule);
// the server keeps count of which drums are gone and stands new ones up, and when playing
// alone the game does.

import type { Instance } from '../world/worldgen';

export const BARREL = {
  /** the prop that burns */
  kind: 'Barrel_01',
  /** seconds before a new one is stood where one went up */
  respawn: 300,
  /** and not while anybody is standing this close to the spot, metres */
  clear: 5,
  /** one sets off another within this much of its own reach... */
  chainReach: 0.65,
  /** ...this many seconds later */
  chainDelay: 0.22,
  /** where on it the blast is counted from, metres above its foot */
  centre: 0.45,
};

/** Every drum in the world, in the order the game and the server both count them. */
export function barrelSpots(props: Instance[]): Instance[] {
  return props.filter((p) => p.kind === BARREL.kind);
}
