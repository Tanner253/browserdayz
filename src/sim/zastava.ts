// Zastava, the post at the pass's east mouth (2026-10-16, new, plan v5): where its buildings and what lies about them
// stand. Pure numbers, the same for the game and the server; in its own frame (x east, z south of its middle): the
// road west into the canyon runs along z = 0, the pass's mouth to the west, the river to the north. The parent lane's
// word: "a post at the canyon's east mouth is still a good idea if it fits": the pass is the only way west, so whoever
// goes west comes through here.
//
// How it is meant to be fought: a chicane of concrete slabs across the road (walk round it, or be shot from the booth
// and the barracks' windows); the roadhouse's rooms over the road look both ways along it; a watchtower on a knoll
// covers the mouth of the canyon; containers stacked as a barricade on the river side. The loot of a post (the booth,
// the barracks), and of a roadhouse.

import type { SlabRun, Town, TownGround, TownSpot } from './towns';
import type { TownThing } from './zavod';

const PI = Math.PI, Q = PI / 2;

/** where it is planned: at the pass's east mouth (about -2040, -446), the road through it running east and west */
export const ZASTAVA: Town = { name: 'Zastava', x: -2040, z: -446, pad: [62, 45], rot: 0 };

/** the knoll the watchtower stands on: [x, z, foot r, height, level top r] */
const KNOLL: [number, number, number, number, number] = [-34, 27, 13, 3, 4];

export function zastavaBuildings(): TownSpot[] {
  return [
    // the booth at the chicane, its door to the road
    { type: 'guardpost', x: -8, z: -8, rot: 0 },
    // the post's barracks on the river side, its front to the road
    { type: 'barracks', x: 22, z: -15, rot: 0 },
    // the roadhouse and its garage on the far side, their fronts to the road
    { type: 'tavern', x: 14, z: 16, rot: PI },
    { type: 'garage', x: 33, z: 15.5, rot: PI },
    // the watchtower on its knoll over the canyon's mouth
    { type: 'tower', x: KNOLL[0], z: KNOLL[1], rot: Q },
  ];
}

/** the chicane across the road (one run from each side, staggered), and the wall round the roadhouse's back yard */
export const ZASTAVA_SLABS: SlabRun[] = [
  { a: [-16, -13], b: [-16, 1.5] },
  { a: [-3, -1.5], b: [-3, 12] },
  { a: [2, 25], b: [44, 25], gone: [6, 7], down: [7] },
  { a: [44, 25], b: [44, 8] },
];

export function zastavaThings(): TownThing[] {
  const OR = 'container_shell@0', BL = 'container_shell@1';
  return [
    // the barricade on the river side, at the canyon end: two containers end to end, one on another
    { kind: OR, x: -30, z: -17, rot: Q }, { kind: BL, x: -30, z: -17, rot: Q, up: 2.2 }, { kind: BL, x: -23.5, z: -15.5, rot: Q + 0.08 },
    // the chicane's ends, and the road blocks pushed aside
    { kind: 'concrete_road_barrier', x: -16, z: 3.4, rot: 0.1 }, { kind: 'concrete_road_barrier', x: -3, z: -3.4, rot: -0.1 }, { kind: 'concrete_road_barrier', x: -22, z: 5.5, rot: 0.6 },
    // the post's stores by the barracks, the roadhouse's yard
    { kind: 'wooden_military_crate', x: 31.5, z: -12, rot: 0.2 }, { kind: 'wooden_military_crate', x: 31.8, z: -10.6, rot: 0 }, { kind: 'Barrel_01', x: 12.5, z: -11.5, rot: 0 },
    { kind: 'covered_car', x: 26, z: 3.5, rot: Q + 0.12 }, { kind: 'trashbag', x: 5.5, z: 22.5, rot: 0.5 }, { kind: 'old_tyre', x: 38, z: 22, rot: 0.3 },
    { kind: 'wooden_crate_01', x: 21.5, z: 22.5, rot: 1.2 },
  ];
}

/** the road through it, the yards before the post and round the roadhouse, the path up the knoll */
export const ZASTAVA_GROUND: TownGround = {
  yards: [[-14, -22, 34, -5], [2, 6, 44, 25]],
  lanes: [
    { line: [[-64, 0], [64, 0]], w: 7 },
    { line: [[-20, 4], [-30, 18]], w: 2 },
  ],
  mounds: [KNOLL],
};
