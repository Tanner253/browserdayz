// Ozerki, the fishing village on a lake in the north woods (2026-10-16, new): where its houses, piers and what lies
// about them stand. Pure numbers, the same for the game and the server; in Ozerki's own frame (x east, z south of its
// middle): the lake to the north, its shore along z = SHORE, a lane along z = LANE with the houses between the two,
// their fronts to the lane and their yards running down to the water.
//
// How it is meant to be fought: the boathouse at the end of the long pier is the rich room with one way out (thirty
// metres of bare boards), the two short piers the only cover along an open shore; the watch tower on the hill
// behind the lane covers all three; the houses are quiet looting for whoever came in from the woods.

import type { KitPiece } from './kit';
import type { Town, TownGround, TownSpot } from './towns';
import type { TownThing } from './zavod';

const PI = Math.PI;

/**
 * Where it is planned (plan v5): on the west shore of the forest lake north of Lipki (about -1250, 200), turned a
 * quarter round so that its own north (the lake's side) is the world's east: the lane runs north and south, the piers
 * out east over the water. The world's lane sets it down where the lake's shore is.
 */
export const OZERKI: Town = { name: 'Ozerki', x: -1420, z: 200, pad: [70, 60], rot: -Math.PI / 2 };

/** the water's edge and the lane, along z */
export const SHORE = -10;
const LANE = 30;
/**
 * How high the piers' decks stand over the pad (the bank where they leave it): a step up from it, no more (at 0.9 m
 * nobody could climb on). On the lake, the water should lie about 0.7 m under the bank and a metre under the decks.
 */
export const DECK = 0.35;
/** the piers: where along the shore each leaves it, how many 3 m sections it runs out, and whether the boathouse stands at its end */
export const PIERS: { x: number; n: number; house?: boolean }[] = [{ x: -38, n: 5 }, { x: 0, n: 10, house: true }, { x: 34, n: 4 }];
/** a pier section's own measures (the kit's, see the pier_kit pieces): its deck so high over its origin, so long, laid every so far, its middle so far across from its origin */
const SECTION = { deck: 2.65, step: 3.0, mid: 0.98, gate: 1.22 };

export function ozerkiBuildings(): TownSpot[] {
  const house = (type: 'izba' | 'izba_two', x: number): TownSpot => ({ type, x, z: LANE - 5 - (type === 'izba' ? 3.25 : 4), rot: 0 });
  const long = PIERS.find((p) => p.house)!, end = SHORE - long.n * SECTION.step;
  return [
    house('izba', -52), house('izba_two', -30), house('izba', -8), house('izba', 16), house('izba_two', 40),
    // the smokehouse down by the water, its door to the east pier
    { type: 'smokehouse', x: 24, z: SHORE + 5, rot: PI / 2 },
    // the boathouse over the lake at the end of the long pier, its front (its door) to the pier
    { type: 'boathouse', x: long.x, z: end - 3, rot: 0, up: DECK },
    // the watch tower on the hill behind the lane
    { type: 'tower', x: -6, z: 54, rot: PI },
  ];
}

/**
 * The piers as pieces of the pier kit, in Ozerki's frame on the pad at y: each a gateway where it leaves the shore,
 * then its sections out over the water (a section runs along its own +z: turned half round to run north), and a
 * cluster of old poles standing in the water beside it.
 */
export function ozerkiPiers(y: number): KitPiece[] {
  const out: KitPiece[] = [], foot = y + DECK - SECTION.deck;
  for (const p of PIERS) {
    out.push({ id: 'pier_section_05', at: [p.x + SECTION.gate, foot, SHORE], turn: PI, body: false, name: 'Ozerki pier gate' });
    for (let k = 0; k < p.n; k++) out.push({ id: k % 3 === 2 ? 'pier_section_03' : k % 2 ? 'pier_section_02' : 'pier_section_01', at: [p.x + SECTION.mid, foot, SHORE - k * SECTION.step], turn: PI, body: false, name: 'Ozerki pier' });
    out.push({ id: 'pier_poles', at: [p.x - 4.5, foot, SHORE - p.n * 1.4], turn: 0.4, body: false, name: 'Ozerki poles' });
  }
  return out;
}

/** what stops a body on the piers: a deck of boards over each section, as boxes [middle x, y, z, half x, y, z], in Ozerki's frame on the pad at y */
export function ozerkiDecks(y: number): [number, number, number, number, number, number][] {
  return PIERS.map((p) => {
    const len = p.n * SECTION.step + 0.4, z = SHORE - (p.n * SECTION.step) / 2 + 0.2;
    return [p.x, y + DECK - 0.06, z, 1.24, 0.06, len / 2] as [number, number, number, number, number, number];
  });
}

export function ozerkiThings(): TownThing[] {
  const out: TownThing[] = [];
  // the yards behind the houses, down to the water: fences of grey boards either side, what a fisherman leaves about
  for (const x of [-52, -30, -8, 16, 40]) {
    out.push({ kind: 'Barrel_01', x: x + 3.2, z: SHORE + 6.5, rot: 0 }, { kind: 'wooden_crate_01', x: x - 2.4, z: SHORE + 4.8, rot: 0.3 });
    if (x % 3 === 0) out.push({ kind: 'old_tyre', x: x - 0.6, z: SHORE + 3.0, rot: 0.2 });
  }
  // on the piers' decks
  out.push(
    { kind: 'wooden_crate_01', x: 0.6, z: SHORE - 9, rot: 0.2, up: DECK }, { kind: 'Barrel_01', x: -0.5, z: SHORE - 20, rot: 0, up: DECK },
    { kind: 'wooden_crate_01', x: -37.4, z: SHORE - 12, rot: 1.4, up: DECK },
    { kind: 'covered_car', x: 58, z: LANE + 1, rot: PI / 2 - 0.1 },
  );
  return out;
}

/** the lane, the shore's shingle, the paths down to the piers */
export const OZERKI_GROUND: TownGround = {
  yards: [[-66, SHORE - 2, 66, SHORE + 2.5]],
  lanes: [
    { line: [[-80, LANE], [80, LANE]], w: 5 },
    ...PIERS.map((p) => ({ line: [[p.x, LANE - 2], [p.x, SHORE]] as [number, number][], w: 2.2 })),
    { line: [[-6, LANE + 2], [-6, 50]], w: 2 },
  ],
};
