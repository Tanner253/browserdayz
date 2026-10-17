// Zavod, the brick works by the river (2026-10-16): where its buildings and what lies about them stand. Pure
// numbers, the same for the game and the server. The owner: "we want dyanmic gampelaty and the towns should feel
// fresh with different types of environemnts". In Zavod's own frame (x east, z south of its middle, as the world's;
// turned `rot` about the upright): the river along its south edge, the road in from the bridge at its south-east
// corner, up to the gate in the works' fence.
//
// How it is meant to be fought: the flats' roof (reached only by the fire escape up its back) looks down into the
// yard; the hall's roof (two steel stairs at its ends) looks back; between them the yard of containers is a maze of
// corners; the wall round the works is concrete slabs (as the factories of Chernarus have) with a gate on the road,
// two gaps to flank by and slabs fallen here and there; the quay under the bank is low cover along the river.

import type { SlabRun, Town, TownGround, TownSpot } from './towns';

const PI = Math.PI, Q = PI / 2;

export const ZAVOD: Town = { name: 'Zavod', x: -2550, z: 280, pad: [95, 75], rot: 0 };

export function zavodBuildings(): TownSpot[] {
  return [
    { type: 'works_hall', x: -5, z: -32, rot: 0 },
    { type: 'works_office', x: 38, z: -30, rot: 0 },
    // (outside the fence to the west, its front to the yard, its fire escape on the far side)
    { type: 'zavod_flats', x: -66, z: -2, rot: Q },
  ];
}

/** A thing lying about the town, in its frame: which, where, its turn, and how high its foot is over the pad (a container stacked on another). */
export interface TownThing { kind: string; x: number; z: number; rot: number; up?: number }

/** the containers' two paints (see CONTAINER in src/world/buildings.ts) */
const OR = 'container_shell@0', BL = 'container_shell@1';
/** how tall a container is: the one stacked on it stands so high */
const BOX_H = 2.2;

export function zavodThings(): TownThing[] {
  const box = (x: number, z: number, rot: number, kind = OR, up = 0): TownThing => ({ kind, x, z, rot, up });
  return [
    // the yard: rows of containers between the gate and the hall, some two high, with ways between them that turn
    box(-26, -6, Q), box(-26, -6, Q, BL, BOX_H), box(-26, 2.6, Q + 0.04, BL),
    box(-12, -12, 0.02), box(-9.4, -12, 0, BL), box(-9.4, -12, 0, OR, BOX_H),
    box(-2, 2, Q - 0.05, BL), box(5.5, 1.6, Q), box(5.5, 1.6, Q, BL, BOX_H),
    box(16, -10, 0.1), box(23, -4, Q + 0.2, BL),
    box(30, 8, 0.0), box(32.6, 8, 0.0, BL), box(32.6, 8, 0.0, OR, BOX_H),
    // what was being loaded: crates by the hall's garages, drums, tyres, a road block at the gate
    { kind: 'crate_big', x: -11, z: -21.5, rot: 0.2 }, { kind: 'crate_big', x: -9.8, z: -21.0, rot: 0.1 }, { kind: 'wooden_crate_01', x: -8.4, z: -21.8, rot: 1.4 },
    { kind: 'Barrel_01', x: 14.6, z: -21.4, rot: 0 }, { kind: 'barrel_03', x: 15.4, z: -20.6, rot: 0.6 }, { kind: 'Barrel_01', x: 16.3, z: -21.5, rot: 0 },
    { kind: 'old_tyre', x: 20.5, z: -17.2, rot: 0.3 }, { kind: 'old_tyre', x: -18.2, z: 9.0, rot: 1.1 },
    { kind: 'concrete_road_barrier', x: 14.5, z: 21.5, rot: 0.15 }, { kind: 'concrete_road_barrier', x: 25.5, z: 21.8, rot: -0.1 },
    { kind: 'covered_car', x: 44, z: -14, rot: PI + 0.2 },
    // the quay: what came off the boats
    { kind: 'wooden_crate_01', x: -4, z: 37.2, rot: 0.1 }, { kind: 'wooden_crate_01', x: -2.8, z: 37.8, rot: 1.6 }, { kind: 'Barrel_01', x: 8, z: 37.5, rot: 0 }, { kind: 'crate_big', x: 14, z: 37.0, rot: 0.3 },
    // by the flats: what the people of the flats left outside
    { kind: 'trashbag', x: -59.5, z: 9.5, rot: 0.4 }, { kind: 'metal_trash_can@0', x: -59.6, z: 11.2, rot: Q }, { kind: 'old_tyre', x: -73.5, z: 6.0, rot: 0.2 },
  ];
}

/**
 * The works' wall of concrete slabs round the yard, in Zavod's frame: each run from a to b, the slabs gone from it
 * (counted from a) and of those the ones lying on the ground. The gate on the road (south side, x 15 to 25) and two
 * gaps (the west side by the flats, the north side behind the hall) are where there is none.
 */
export const ZAVOD_WALL: SlabRun[] = [
  { a: [-40, 22], b: [15, 22], gone: [6, 7], down: [7] }, { a: [25, 22], b: [56, 22] },
  { a: [56, 22], b: [56, -52], gone: [12], down: [12] },
  { a: [56, -52], b: [34, -52] }, { a: [26, -52], b: [-40, -52], gone: [19], down: [] },
  { a: [-40, -52], b: [-40, -6] }, { a: [-40, 2], b: [-40, 22], gone: [5], down: [5] },
];

/** the yard inside the fence gravelled, the road from the bridge to the gate, the way from the flats to the gap, the quay's apron */
export const ZAVOD_GROUND: TownGround = {
  yards: [[-40, -52, 56, 22], [-12, 30, 34, 42]],
  lanes: [
    { line: [[20, 22], [20, 50], [32, 66], [60, 74]], w: 7 },
    { line: [[-40, -2], [-56, -2]], w: 3 },
    { line: [[-62, 12], [-62, 30], [-30, 34], [-12, 36]], w: 3 },
  ],
};
