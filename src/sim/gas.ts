// The gas. One place on the map is sunk in it (the Chemical Works, in the cirque behind the
// checkpoint: the map's first expansion). A low dome of it lies over the place, thickest
// at the middle and thinning to nothing at the rim. It is not breathed for long. A gas mask on
// the face is all that is needed to walk about in it; the infected do not breathe at all.
//
// These are the rules, and nothing else: where it is, how deep in a point is, and what
// breathing it does. The game draws it (src/world/atmosphere.ts, src/game/gas.ts) and takes
// the health off (a survivor's health is their own game's to keep, as with a wound or thirst).

import { BUNKER, bunkerLocal, type Place } from './bunker';

export const GAS = {
  /** the place that is sunk in it, by its name on the map */
  place: 'Chemical Works',
  /** how far out from the middle of the place it reaches along the ground, and how high it stands over the middle, metres */
  radius: 96,
  height: 36,
  /** how much of what is seen through it is lost to each metre of it, at its thickest */
  // (a quarter thinner than it was: at 0.04 the works could not be seen across from inside it)
  thick: 0.03,
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
 * The bunker has gas of its own: over the ground above it, and all through it. It is as bad to
 * breathe as the works' and nothing like as thick to look at (it is hardly drawn at all: the
 * place is not to be given away by a green cloud). Over the ground it is a low dome, `r` metres
 * out from a point `back` metres behind the bunker's own middle and `h` high; under the ground
 * it is everywhere, as deep as `under` says.
 */
export const BUNKER_GAS = { r: 46, back: 6, h: 14, under: 0.6 };

/** how deep in the bunker's gas a point is: 0 outside it; as `gasDepth`, inside */
export function bunkerGas(p: Place | null, x: number, y: number, z: number): number {
  if (!p) return 0;
  const G = BUNKER_GAS, [r, f, h] = bunkerLocal(p, x, y, z);
  if (h < -0.8 && Math.abs(r) < BUNKER.hall.r + 1 && f > BUNKER.hall.back - 1 && f < BUNKER.stair.foot + BUNKER.stair.run + 1) return G.under;
  return Math.max(0, 1 - ((r * r + (f + G.back) * (f + G.back)) / (G.r * G.r) + (h * h) / (G.h * G.h)));
}

/** how far along the ground a point is from where the bunker's gas begins, metres: under 0 is inside */
export function bunkerGasEdge(p: Place | null, x: number, z: number): number {
  if (!p) return Infinity;
  const [r, f] = bunkerLocal(p, x, 0, z);
  return Math.hypot(r, f + BUNKER_GAS.back) - BUNKER_GAS.r;
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
