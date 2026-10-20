// How far off a shot is heard (2026-10-19), by the round it fires: as loud as its distance makes it out to the first
// figure, then falling away steeply to nothing at the second. The server passes a shot on to nobody further off than
// that (server/handle.ts 'shot'), and the game plays it so (src/core/audio.ts gunshot). A shot was passed on to every
// game on the map, and each flew its rounds (the owner: "people sometimes complain of lag spike when fighting
// people"). The .50s carry furthest and stop short of the whole map (the owner: "im not sure 50cal reaching the whole
// map makes sense unless its really quiet and also falls off sharply at like 750m").

import { GUNS } from './gunplay';
import { ITEMS } from './items';

/** [metres heard as loud as its distance makes it, metres heard no more], by cartridge */
const HEARD: Record<string, [number, number]> = {
  ammo_50bmg: [750, 1100],
  ammo_762: [450, 800],
  ammo_739: [450, 800],
  ammo_556: [450, 800],
  ammo_127x55: [450, 800],
  ammo_12: [400, 700],
};
/** a pistol's round, and a submachine gun's (and anything not listed) */
const SHORT: [number, number] = [250, 500];
/** what a suppressor leaves of those, and a gun quieted by build (the VSSK), which always is */
const QUIETED = 0.45;

export function shotHeard(weapon: string, suppressed: boolean): [number, number] {
  const [full, gone] = HEARD[ITEMS[weapon]?.weapon?.ammo ?? ''] ?? SHORT;
  const k = suppressed || GUNS[weapon]?.quiet ? QUIETED : 1;
  return [full * k, gone * k];
}

/** how much of a shot is left at `distance` past its distance's own fall-off: 1 to `full`, nothing from `gone` */
export function heardShare([full, gone]: [number, number], distance: number): number {
  if (distance <= full) return 1;
  if (distance >= gone) return 0;
  const t = (distance - full) / (gone - full);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Bunker 17's alarm, heard over the whole map (the owner, 2026-10-19: "a siren for the whole map with a gradual
 * dropoff, it should be very feint from far away but still hearable"): as loud as at the door out to `near`, then
 * falling as a power of the distance, never to nothing: a fifth at 500 m, under a tenth at 2 km, some 4% (-27 dB) at
 * the map's far edge. And `dull`: the most of it heard, Hz, as the far end of anything is only its low notes.
 */
export const ALARM = { near: 60, fall: 0.75, dull: [9000, 300, 450] as const };

/** how much of the alarm is left at `distance`, 1 at the door */
export function alarmShare(distance: number): number {
  return distance <= ALARM.near ? 1 : Math.pow(ALARM.near / distance, ALARM.fall);
}

/** the highest of the alarm still heard at `distance`, Hz */
export function alarmTop(distance: number): number {
  const [top, per, floor] = ALARM.dull;
  return Math.max(floor, top / (1 + distance / per));
}
