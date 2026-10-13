// The bridge on the loop road (2026-10-13: "perhaps we even make a bridge over a valley"): what it is, in figures,
// for everything that has to agree about it. The map says where one stands (`World.bridges`, made in
// src/world/worldgen.ts); src/world/bridge.ts draws it and makes it solid; and the server, which knows the ground
// only as heights, is told by `standAt` that somebody on its deck is standing on something.
//
// That last is why this file is here. The server writes down anybody who is far over the ground with nothing
// under them (CHECK.high in server/index.ts), and on the live game what it writes down puts players off: a deck
// twenty metres over a cleft is exactly that, to anything that asks only the ground. So what is asked is `standAt`:
// the deck for whoever is on it, the ground for whoever is in the cleft under it.
//
// Sums only: nothing is drawn and no physics is known here.

/** A bridge: a straight, level-ended deck from one bank to the other. */
export interface Bridge {
  /** the middle of the road at each end of the deck, on the road's surface: where the deck leaves the one bank and meets the other */
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
}

/**
 * The shape every bridge has, metres.
 *   road   – the asphalt between the kerbs
 *   walk   – the raised way either side of it, kerb to railing
 *   kerb   – how high that stands over the asphalt
 *   slab   – how thick the deck is; beam – how deep the beams under it are; beams – how many, side by side
 *   spans  – how many, of equal length, on piers between
 *   rail   – how high the railing stands over the footway
 *   under  – how far under the top of the deck somebody's feet may be and still be on it (the deck and its beams
 *            are a metre and three quarters through: whoever is under a bridge is further down than that)
 *   over   – how far past the deck's edge and ends a spot still counts as on it (a foot on the edge)
 *   gap    – where a car went through the railing: how far along the deck from its first end (a part of its length),
 *            and how wide the gap is. It is in the railing on the deck's south side (see `gapSide`)
 */
export const BRIDGE = { road: 6.6, walk: 1.15, kerb: 0.2, slab: 0.34, beam: 1.4, beams: 5, spans: 3, rail: 1.05, under: 2.6, over: 0.45, gap: { at: 0.4, wide: 7 } };

/** how wide a deck is, railing to railing */
export const deckWidth = () => BRIDGE.road + 2 * BRIDGE.walk;

/** how long a bridge's deck is over the ground, bank to bank */
export const spanOf = (b: Bridge) => Math.hypot(b.bx - b.ax, b.bz - b.az);

/**
 * A spot in a bridge's own measure: `along` its deck from its first end (metres), `side` of its middle line
 * (metres, to the right going from the first end to the second), and `top`, the height of the road's surface
 * there (the deck runs straight from the one end's height to the other's).
 */
export function onBridge(b: Bridge, x: number, z: number): { along: number; side: number; top: number } {
  const len = spanOf(b) || 1, ux = (b.bx - b.ax) / len, uz = (b.bz - b.az) / len;
  const along = (x - b.ax) * ux + (z - b.az) * uz, side = (x - b.ax) * -uz + (z - b.az) * ux;
  return { along, side, top: b.ay + ((b.by - b.ay) * Math.min(len, Math.max(0, along))) / len };
}

/**
 * How high the deck stands at a spot: the top of whatever of it is there to stand on (the footways are a kerb
 * higher than the road). Null where no bridge is over the spot.
 */
export function deckAt(bridges: readonly Bridge[], x: number, z: number): number | null {
  for (const b of bridges) {
    const p = onBridge(b, x, z);
    if (p.along < -BRIDGE.over || p.along > spanOf(b) + BRIDGE.over || Math.abs(p.side) > deckWidth() / 2 + BRIDGE.over) continue;
    return p.top + (Math.abs(p.side) > BRIDGE.road / 2 ? BRIDGE.kerb : 0);
  }
  return null;
}

/**
 * What somebody at (x, y, z) has under them to stand on: the ground, or the deck of a bridge if they are on one.
 * Whoever is in the cleft under a bridge is on the ground: only a body at the deck's own height, or over it, is
 * on the deck.
 * @param ground how high the ground is at (x, z)
 */
export function standAt(bridges: readonly Bridge[], ground: number, x: number, y: number, z: number): number {
  const top = deckAt(bridges, x, z);
  return top !== null && top > ground && y > top - BRIDGE.under ? top : ground;
}

/**
 * Which side of a deck the gap in its railing is on: 1 to the right of the way from its first end to its second,
 * -1 to the left. The side that lies further south (further east, of a bridge that runs north and south).
 */
export function gapSide(b: Bridge): 1 | -1 {
  const ux = b.bx - b.ax, uz = b.bz - b.az;
  return (Math.abs(ux) > 1e-6 ? ux : -uz) > 0 ? 1 : -1;
}

/**
 * The car that went through the railing lies in the cleft under the gap it left (see BRIDGE.gap): where its middle
 * is over the ground, which way it lies, and the places about it where what it carried was thrown out. Out from the
 * deck's edge as far as a car going over it at a town's pace would fall in the height there is, and then down the
 * bank a little: the same on every game and on the server, which numbers those places.
 */
export function wreckUnder(b: Bridge): { x: number; z: number; rot: number; spots: [number, number][] } {
  const len = spanOf(b) || 1, ux = (b.bx - b.ax) / len, uz = (b.bz - b.az) / len;
  const k = gapSide(b), rx = -uz * k, rz = ux * k, along = len * BRIDGE.gap.at + 4.2, out = deckWidth() / 2 + 6.2;
  const x = b.ax + ux * along + rx * out, z = b.az + uz * along + rz * out, rot = Math.atan2(ux, uz) + 0.7;
  const spots: [number, number][] = [[2.3, 0.6], [-1.9, 1.7], [0.7, -2.4], [-2.6, -1.1], [3.4, -2.2]].map(([dx, dz]) => [x + dx, z + dz]);
  return { x, z, rot, spots };
}
