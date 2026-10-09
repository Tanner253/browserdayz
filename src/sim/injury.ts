// A broken leg. A hard enough landing breaks one, and so, as often as not, does a bullet in
// the legs. On a broken leg nobody runs or jumps: it is a limp until it is set (a splint, or
// a first aid kit), or until it has knitted by itself, which takes a long while. It gives the
// legs a point as somewhere to shoot at (a man who cannot run is caught), and a height a
// price beyond the health it costs.
//
// Rules only. A survivor's body is their own game's to keep, as with a wound; whether a leg
// is broken goes to the server with the rest of them, so it is still broken after a rest.

import type { HitZone } from './combat';

export const LEG = {
  /** a landing harder than the first of these (metres a second) may break one; at the second it is certain */
  fall: [11.2, 14.5] as [number, number],
  /** how often a bullet in the legs breaks one, and a blow there with something swung */
  shot: 0.5,
  blow: 0.25,
  /** the most that is made on one, metres a second (a jog is 4, a walk 1.7) */
  limp: 1.5,
  /** seconds it takes to knit with nothing done for it */
  knits: 420,
};

/** does a landing at this speed (metres a second, downward) break a leg: `roll` is a number from 0 to 1 thrown for it */
export function breaksOnLanding(speed: number, roll: number): boolean {
  const [may, will] = LEG.fall;
  return speed > may && roll < (speed - may) / (will - may);
}

/** does a hit there break a leg */
export function breaksOnHit(zone: HitZone | null | undefined, melee: boolean, roll: number): boolean {
  return zone === 'legs' && roll < (melee ? LEG.blow : LEG.shot);
}
