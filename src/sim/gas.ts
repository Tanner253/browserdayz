// The gas. One place on the map is sunk in it (the Chemical Works, in the cirque behind the
// checkpoint: the map's first expansion). A low dome of it lies over the place, thickest
// at the middle and thinning to nothing at the rim. It is not breathed for long. A gas mask on
// the face is all that is needed to walk about in it; the infected do not breathe at all.
//
// These are the rules, and nothing else: where it is, how deep in a point is, and what
// breathing it does. The game draws it (src/world/atmosphere.ts, src/game/gas.ts) and takes
// the health off (a survivor's health is their own game's to keep, as with a wound or thirst).

import { BUNKER, bunkerAt, bunkerLocal, type Place } from './bunker';
import { bunkerPlace, heightAt, type World } from '../world/worldgen';

export const GAS = {
  /** the place that is sunk in it, by its name on the map */
  place: 'Chemical Works',
  /** how far out from the middle of the place it reaches along the ground, and how high it stands over the middle, metres */
  radius: 96,
  height: 36,
  /**
   * How it is to look at, the same wherever it lies (the works', the bunker's): every gas is drawn by the same
   * lines of the fog every shader has (src/world/atmosphere.ts), from these figures and no others.
   * - `thick`: how much of what is seen through it is lost to each metre of it where it is thickest, from outside.
   * - `skirt`: it is seen further out than it is breathed, by this much of its reach: a skirt of it that thickens
   *   from nothing at its own edge to its thickest where the breathing begins. The edge is soft, and nobody who is
   *   in the part that kills is seen through the part that does not.
   * - `top`: above this share of its height it thins away to nothing, so its top is a haze and not a lid.
   * - `puffs`: how much the skirt is broken into puffs and gaps (0: a smooth bank).
   * - `within`: what is left of it for an eye that is in it.
   *
   * 2026-10-13, the user, watching it change: "The gas from a distance looks too much like a green bio dome and
   * its not thick enough ... they should both use the same resource as well, 1 thing to maintain"; "Its too easy
   * to shoot and hit targets in the gas zone while im on the outside of the gas. The gas should be thick enough to
   * protect the people inside, visually, we dont build any special logic around this, its just a measurable for
   * what we want"; and of being in it, "once inside the gas ... little to no fog". So: six times as thick from
   * outside as it was (ten metres of it hide a body), thick all the way out to where it is breathed and not only
   * at its middle, soft and broken at its edge and its top, and to an eye in it a fiftieth of that: which is
   * also why it can be this thick (at 0.04, seen from inside as from outside, the works could not be seen across).
   */
  thick: 0.18,
  skirt: 0.3,
  top: 0.4,
  puffs: 0.7,
  within: 0.02,
  /** how deep in (0 at the rim, 1 at the middle) it is thick enough to be breathed */
  breathe: 0.08,
  /** seconds of it in the lungs before it starts to hurt (and it is out of them again as fast, in clean air) */
  hold: 2.5,
  /** health a second once it hurts: just inside, and at the middle */
  damage: [6, 16] as [number, number],
  /** seconds from one cough to the next */
  cough: 1.5,
  /** how far off a cough is heard by the infected, metres (a jog is heard at eleven) */
  heard: 14,
};

export interface GasZone { x: number; y: number; z: number; r: number; h: number }

/**
 * A gas, as it lies over the ground: where, how far out and how high, and the height under which there is none
 * of it. Every gas in a world is one of these, in one list (`gasClouds`), and everything that has to do with gas
 * goes through that list: the fog it is drawn as, the wisps and the dimmed day in it, the boards round it, the
 * warning on the way to it, the lungs, the ring on the maps. A new place under gas is one more row in the list,
 * and looks and hurts exactly as the others do (2026-10-13, the user: "they should both use the same resource
 * ... 1 thing to maintain", "the code should be reusable. And the gas should be the same visually between the two").
 */
export interface GasCloud extends GasZone { floor: number }

/**
 * The bunker's: a bank of it over the ground above the place, `r` metres out from a point `back` metres behind
 * the bunker's own middle and `h` high. Under the ground none of it is seen, and it is everywhere: as deep as
 * `under` says (`bunkerUnder`), which is the one thing about it that the works' has not.
 */
export const BUNKER_GAS = { r: 52, back: 6, h: 24, under: 0.6 };

/** every gas in a world: the works', and the bunker's */
export function gasClouds(world: Pick<World, 'pois' | 'heights' | 'sites'>): GasCloud[] {
  const out: GasCloud[] = [];
  const works = gasZone(world.pois, (x, z) => heightAt(world.heights, x, z));
  if (works) out.push({ ...works, floor: -1e4 });
  const p = bunkerPlace(world);
  if (p) {
    const G = BUNKER_GAS, [x, y, z] = bunkerAt(p, 0, -G.back, 0);
    out.push({ x, y, z, r: G.r, h: G.h, floor: y - 0.8 });
  }
  return out;
}

/** how deep in gas a point is, whichever of them it is in: 0 outside them all, 1 at the middle of one on the ground */
export function cloudDepth(clouds: GasCloud[], x: number, y: number, z: number): number {
  let d = 0;
  for (const c of clouds) if (y > c.floor) d = Math.max(d, gasDepth(c, x, y, z));
  return d;
}

/** how far along the ground a point is from the nearest gas, metres: under 0 is inside one */
export function cloudEdge(clouds: GasCloud[], x: number, z: number): number {
  let d = Infinity;
  for (const c of clouds) d = Math.min(d, gasEdge(c, x, z));
  return d;
}

/** how deep in gas a point under the ground in the bunker is (it is all through the place): 0 anywhere else */
export function bunkerUnder(p: Place | null, x: number, y: number, z: number): number {
  if (!p) return 0;
  const [r, f, h] = bunkerLocal(p, x, y, z);
  return h < -0.8 && Math.abs(r) < BUNKER.hall.r + 1 && f > BUNKER.hall.back - 1 && f < BUNKER.stair.foot + BUNKER.stair.run + 1 ? BUNKER_GAS.under : 0;
}

/** where the gas lies in a world: over the place named in GAS, standing on the ground there */
export function gasZone(pois: { name: string; x: number; z: number }[], ground: (x: number, z: number) => number): GasZone | null {
  const p = pois.find((q) => q.name === GAS.place);
  return p ? { x: p.x, y: ground(p.x, p.z), z: p.z, r: GAS.radius, h: GAS.height } : null;
}

/** how deep in the gas a point is: 0 outside it and at its rim, 1 at the middle of it on the ground */
export function gasDepth(g: GasZone | null, x: number, y: number, z: number): number {
  if (!g) return 0;
  const qx = (x - g.x) / g.r, qy = (y - g.y) / g.h, qz = (z - g.z) / g.r;
  return Math.max(0, 1 - (qx * qx + qy * qy + qz * qz));
}

/** whether something standing there is under the gas: deep enough in it that it is breathed */
export const underGas = (g: GasZone | null, x: number, y: number, z: number) => gasDepth(g, x, y, z) > GAS.breathe;

/** how far along the ground from the middle of the gas a point is, in metres, less the gas's own reach: under 0 is inside */
export function gasEdge(g: GasZone, x: number, z: number): number {
  return Math.hypot(x - g.x, z - g.z) - g.r;
}

/** what a survivor's lungs have had of it: seconds of it (see GAS.hold), and how long since the last cough */
export interface Lungs { held: number; cough: number }
export const freshLungs = (): Lungs => ({ held: 0, cough: 0 });

/**
 * A moment's breathing, `depth` deep in the gas, with or without something over the face that
 * keeps it out. Says how much health it cost, and whether this is the moment of a cough.
 */
export function breathe(l: Lungs, depth: number, masked: boolean, dt: number): { hurt: number; cough: boolean } {
  if (masked || depth < GAS.breathe) {
    l.held = Math.max(0, l.held - dt);
    l.cough = 0;
    return { hurt: 0, cough: false };
  }
  const first = l.held === 0;
  l.held = Math.min(GAS.hold + 1, l.held + dt);
  l.cough -= dt;
  // (the first breath of it is coughed straight out: nobody is left wondering what the green is)
  const cough = l.cough <= 0 || first;
  if (cough) l.cough = first ? 0.9 : GAS.cough;
  const k = Math.min(1, (depth - GAS.breathe) / (1 - GAS.breathe));
  const hurt = l.held >= GAS.hold ? (GAS.damage[0] + (GAS.damage[1] - GAS.damage[0]) * k) * dt : 0;
  return { hurt, cough };
}
