// The jeep that burns before the fort's gate, for good (the owner, 2026-10-14: "can we put a static burning jeep out
// front of the draw bridge that eluminates light as well for night time, and heat"). Where it stands is the fort's
// to say, in the fort's own measure (`JEEP_WRECK` and `castleJeep`, src/sim/castle.ts): it turns and moves with the
// fort, and sits on the ground the world has there. What its fire is worth is here.
//
// It is made of what the game had: the jeep (JEEP.model), burned out as one that is blown up is left; the fire a
// wreck keeps for as long as it stands (Effects.engineSmoke) and the black column of a wreck (Effects.signal); the
// fires' own lamp for its light; and a lit campfire's warmth, by the campfire's own rule and numbers (FIRE). Nobody
// lit it and nobody can put it out; it is no car (it is not driven, fuelled or blown up), no crate (it is not
// searched) and no fireplace (it is not lit, and nothing is cooked on it).
//
// Rules and data only: the game draws it and runs its fire (src/game/wreck-fire.ts). The server is told nothing of
// it and keeps nothing of it: it is in the world's list of things on both sides, and never changes.

import { JEEP_WRECK, castleJeep, type GroundAt, type Place } from './castle';
import { restsBy } from './fires';

export const WRECK_FIRE = {
  /**
   * The heart of its fire, in the jeep's own frame (x to its right, y over the foot of its wheels, z back: its nose
   * is toward -z): in the cabin, where a jeep that was blown up has its fire (see Garage.looks).
   */
  heart: [0, 1.6, -0.35] as [number, number, number],
  /**
   * And its engine burns still: flames of the same kind standing on the bonnet, where a jeep that is alight and
   * not yet gone up has them: where their foot is (the same frame), how big they are (1 is a campfire's) and how
   * hard they burn. They have no smoke of their own, and the fire's light, warmth and reach are all told from the heart.
   */
  bonnet: { at: [0.08, 1.16, -1.45] as [number, number, number], size: 1.05, strength: 0.8 },
  /**
   * What stops a body at it, as the world's own list of things makes it: the box of its model (half its width, its
   * height, half its length), on the foot of its wheels and turned as it is. For whoever asks how near it somebody is.
   */
  hull: [0.79, 2.15, 1.78] as [number, number, number],
  /**
   * Its light after dark: the fires' own lamp (the one light that stands at whatever burns nearest the eye: see
   * `Fires`), made this fire's while it has it. `strength`: a campfire's is 9 and a burned-out car's 10; `reach`,
   * metres: how far off anything is lit by it at all (it falls off as every fire's light does, and is next to
   * nothing well before that: the gate towers' faces, 13 and 23 m off, are what it is sized by); `up`, how high over
   * the heart the lamp hangs, clear of the roof; `dusk`: how dark it must be for it to begin to be more than any
   * wreck's, and to be so in full (as the fort's own fire baskets are lit); `from`: how far off the eye may be and
   * the walls still be lit by it (a campfire's lamp is lit from 48 m). By day it is a burned-out car's and no more:
   * a fire lights nothing the sun has not.
   */
  light: { strength: 84, reach: 30, up: 1.9, dusk: [0.3, 0.6] as [number, number], from: 130 },
  /** how far off it burns (its flames fed and its own smoke made: flames are drawn from as far as flames are seen), the black column over it is kept up, and the wreck itself is drawn, metres */
  seen: { fire: 260, column: 420, model: 240 },
  /**
   * BURNING. No fire in the game burned a body before this one (a campfire's wood stops a body, and a wreck that
   * was blown up hurts only as it goes up): so this is the rule, and it is this fire's alone. Whoever is within
   * `reach` metres of its hull, which is to say against it, loses `harm` health a second, taken `every` so many
   * seconds as a hurt is (a flinch and a cry). Not from over its roof by more than `over` metres.
   */
  burn: { reach: 0.48, harm: 12, every: 0.5, over: 0.6 },
};

/** The burning jeep as it stands in a world. */
export interface WreckSpot {
  /** its middle, at the foot of its wheels, and how it is turned (as the world's list of things has a turn) */
  x: number;
  y: number;
  z: number;
  rot: number;
  /** the heart of its fire, in the world */
  heart: [number, number, number];
}

/** Where it burns: the fort's jeep, on the ground it is given (the world's own, where there is one). */
export function wreckSpot(p: Place, ground?: GroundAt): WreckSpot {
  const j = castleJeep(p, ground), [hx, hy, hz] = WRECK_FIRE.heart, c = Math.cos(j.rot), s = Math.sin(j.rot);
  return { x: j.x, y: j.y, z: j.z, rot: j.rot, heart: [j.x + hx * c + hz * s, j.y + hy, j.z - hx * s + hz * c] };
}

/** A place in the world, in the jeep's own frame: [to its right, over the foot of its wheels, back]. */
export function wreckLocal(w: WreckSpot, x: number, y: number, z: number): [number, number, number] {
  const dx = x - w.x, dz = z - w.z, c = Math.cos(w.rot), s = Math.sin(w.rot);
  return [dx * c - dz * s, y - w.y, dx * s + dz * c];
}

/** How far a place is from its hull, over the ground, metres: nothing inside it. */
export function hullGap(w: WreckSpot, x: number, z: number): number {
  const [lx, , lz] = wreckLocal(w, x, 0, z), H = WRECK_FIRE.hull;
  return Math.hypot(Math.max(0, Math.abs(lx) - H[0]), Math.max(0, Math.abs(lz) - H[2]));
}

/**
 * Whether somebody standing at a place (their feet) is warmed by it: a lit campfire's rule, to the letter (`restsBy`):
 * within FIRE.warm of the middle of the fire over the ground, and not a floor above or below it. What it is worth
 * to them is a campfire's too, and the game's to give as it gives a campfire's: FIRE.heal, FIRE.meal.
 */
export function warmedBy(w: WreckSpot, x: number, y: number, z: number): boolean {
  return restsBy({ x: w.heart[0], y: w.y, z: w.heart[2] }, x, y, z);
}

/** Whether somebody standing at a place (their feet) is in its flames: against its hull, or on it (see WRECK_FIRE.burn). */
export function burnedBy(w: WreckSpot, x: number, y: number, z: number): boolean {
  const B = WRECK_FIRE.burn, up = y - w.y;
  return up > -1.2 && up < WRECK_FIRE.hull[1] + B.over && hullGap(w, x, z) < B.reach;
}

/** The plan's own word for where it stands, for whoever only wants to say so (a test, a map). */
export { JEEP_WRECK };
