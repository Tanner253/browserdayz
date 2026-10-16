// The new towns of the map three times over (2026-10-16): where each building stands, and the monastery's walls as
// pieces of the fort kit. Pure numbers, the same for the game and the server. The buildings are the game's own,
// drawn up for these places (src/world/town-plans.ts); the walls are the kit's (src/sim/kit.ts), re-skinned in white
// limewashed brick where they are drawn. The owner: "we are making new towns. we have assets in our repository for
// this, pieces where we can make anything we want. do not make boring houses. be creative".
//
// Each town has its own frame: x east and z south of its middle, as the world's, turned `rot` about the upright.

import type { BuildingType } from '../world/worldgen/layout';
import type { KitPiece } from './kit';
import { ZAVOD, ZAVOD_GROUND, ZAVOD_WALL, zavodBuildings, zavodThings, type TownThing } from './zavod';

export interface Town {
  name: string;
  /** its middle in the world */
  x: number;
  z: number;
  /** how far its pad of level ground reaches from the middle, each way (its own x and z) */
  pad: [number, number];
  rot: number;
}
/** a building of a town, in the town's frame: `rot` turns its front (+z of its own) toward (sin, cos) */
export interface TownSpot { type: BuildingType; x: number; z: number; rot: number; arms?: number }

const PI = Math.PI, Q = PI / 2;

/**
 * Pokrov: the white-walled monastery on the main west road, and the town outside its gate. The bunker road runs in
 * at the Holy Gate and out at the north gate: whoever holds the monastery holds the way to Bunker 17.
 */
export const POKROV: Town = { name: 'Pokrov', x: -1850, z: -30, pad: [135, 115], rot: 0 };
/** Lipki: the woodcutters' hamlet in the birch woods, its log houses round a green. */
export const LIPKI: Town = { name: 'Lipki', x: -1180, z: 350, pad: [80, 75], rot: 0 };

/** the monastery's outer wall line, in Pokrov's frame, round the way the kit's walls run (their outside on the right) */
export const POKROV_WALL: [number, number][] = [[-65, 20], [70, 20], [75, -60], [0, -95], [-80, -55]];
/** where along which side of POKROV_WALL its gates' middles are (metres from the side's first corner) */
const POKROV_GATES: { side: number; at: number }[] = [{ side: 0, at: 70 }, { side: 3, at: 49 }];
/** the sides whose middle a stair climbs to the wall-walk, from inside */
const POKROV_STAIRS = [1, 4];

export function pokrovBuildings(): TownSpot[] {
  return [
    // inside the walls: the cathedral's door to the west, the belfry beside it, the cells along the east wall
    { type: 'cathedral', x: 10, z: -38, rot: 0 },
    { type: 'belfry', x: 18, z: -56, rot: 0 },
    { type: 'cells', x: 58, z: -22, rot: -Q, arms: 1 },
    { type: 'refectory', x: -40, z: 0, rot: 0 },
    { type: 'abbot', x: 30, z: 2, rot: 0 },
    // outside: the tavern and the shops facing the road and the market at the gate
    { type: 'tavern', x: -28, z: 55, rot: PI },
    { type: 'merchant', x: 32, z: 54, rot: PI },
    { type: 'merchant', x: 50, z: 57, rot: PI },
    { type: 'smithy', x: -58, z: 58, rot: PI },
    { type: 'izba_two', x: 62, z: 88, rot: PI },
    { type: 'izba', x: -62, z: 88, rot: Q },
    { type: 'merchant', x: 18, z: 90, rot: 0 },
  ];
}

export function lipkiBuildings(): TownSpot[] {
  // round the green, each facing its middle; the way in from the north is left open
  const ring = (deg: number, type: BuildingType, r = 42): TownSpot => {
    const t = (deg * PI) / 180;
    return { type, x: r * Math.sin(t), z: -r * Math.cos(t), rot: -t };
  };
  return [
    { type: 'chapel', x: 0, z: 2, rot: -Q },
    ring(62, 'izba'), ring(118, 'izba'), ring(180, 'izba_two'), ring(242, 'izba'), ring(298, 'izba'),
    { type: 'sawmill', x: 54, z: 52, rot: PI * 0.8 },
    { type: 'tower', x: -72, z: -26, rot: Q },
    { type: 'tower', x: 70, z: -30, rot: -Q },
  ];
}

/** the kit's lengths (see progress/intake/CATALOGUE.md): a thin straight, its half, the gate, how deep a thin wall is */
const THIN = 14.82, HALF = 7.41, DEEP = 2.55, GATE_MID = 3.7;

/**
 * The monastery's walls as kit pieces, in Pokrov's frame, standing on y: each side filled with thin straights
 * (stretched a little along their length to fit it), a gate where there is one, a stair up from inside on two of
 * them, and a round tower at every corner over the joins.
 */
export function pokrovWalls(y: number): KitPiece[] {
  const out: KitPiece[] = [], W = POKROV_WALL;
  W.forEach(([px, pz], s) => {
    const [qx, qz] = W[(s + 1) % W.length], L = Math.hypot(qx - px, qz - pz);
    const dx = (qx - px) / L, dz = (qz - pz) / L, turn = Math.atan2(dx, dz);
    const at = (d: number): [number, number, number] => [px + dx * d, y, pz + dz * d];
    const gate = POKROV_GATES.find((g) => g.side === s);
    const spans: [number, number][] = gate ? [[0, gate.at - GATE_MID], [gate.at - GATE_MID + HALF, L]] : [[0, L]];
    if (gate) out.push({ id: 'fort_wall_thin_gate_01', at: at(gate.at - GATE_MID), turn, name: 'Pokrov gate' });
    for (const [a, b] of spans) {
      const len = b - a;
      if (len < 1) continue;
      const full = len >= HALF * 1.5, n = full ? Math.max(1, Math.round(len / THIN)) : 1, each = len / n;
      for (let k = 0; k < n; k++) out.push({ id: full ? 'fort_wall_thin_straight_01' : 'fort_wall_thin_straight_04', at: at(a + k * each), turn, scale: [1, 1, each / (full ? THIN : HALF)], name: 'Pokrov wall' });
    }
    if (POKROV_STAIRS.includes(s)) {
      // (behind the wall, in from its outer face by its depth: rising along the side to its walk)
      const [sx, , sz] = at(L / 2 - THIN / 2), ix = Math.cos(turn), iz = -Math.sin(turn);
      out.push({ id: 'fort_wall_stairs_straight_01', at: [sx + ix * DEEP, y, sz + iz * DEEP], turn, name: 'Pokrov stair' });
    }
    out.push({ id: 'fort_tower_round', at: [px, y, pz], turn, name: 'Pokrov tower' });
  });
  return out;
}

/**
 * The domes over Pokrov, in its frame: over which building's middle, how high over that building's floor the drum
 * stands (into its roof's ridge: a gable rises 0.32 of the building's depth over its walls), how big, and whether
 * it is gilt. The cathedral's great dome; the belfry's little one over its bells.
 */
export const POKROV_DOMES: { x: number; z: number; over: number; size: number; gilt: boolean }[] = [
  { x: 10, z: -38, over: 11.0, size: 1, gilt: false },
  { x: 18, z: -56, over: 21.4, size: 0.55, gilt: true },
];
/** and over Lipki's chapel */
export const LIPKI_DOMES: { x: number; z: number; over: number; size: number; gilt: boolean }[] = [{ x: 0, z: 2, over: 5.9, size: 0.38, gilt: false }];

/** a town as the world has set it down: where, and the height of its pad of level ground */
export interface PlacedTown { town: Town; padY: number }

/** the buildings of a town by its name */
export function townBuildings(t: Town): TownSpot[] {
  return t.name === POKROV.name ? pokrovBuildings() : t.name === LIPKI.name ? lipkiBuildings() : t.name === ZAVOD.name ? zavodBuildings() : [];
}

/** what lies about a town (containers, crates, drums), in its frame */
export function townThings(t: Town): TownThing[] {
  return t.name === ZAVOD.name ? zavodThings() : [];
}

/**
 * The ground a town has worn bare or laid down, in its frame: gravel yards (rectangles x0, z0, x1, z1) and trodden
 * lanes (lines, how wide). For whoever sets the town down, to paint it so and keep the grass off it.
 */
export interface TownGround { yards: [number, number, number, number][]; lanes: { line: [number, number][]; w: number }[] }
export function townGround(t: Town): TownGround {
  return t.name === ZAVOD.name ? ZAVOD_GROUND : { yards: [], lanes: [] };
}

/** a run of a wall of concrete slabs, from a to b: the slabs gone from it (counted from a), and of those the ones lying on the ground (World.slabs) */
export interface SlabRun { a: [number, number]; b: [number, number]; gone?: number[]; down?: number[] }

/** a town's walls of concrete slabs in the world, its runs moved from its frame */
export function placedSlabs(t: Town): SlabRun[] {
  const runs = t.name === ZAVOD.name ? ZAVOD_WALL : [];
  return runs.map((r) => ({ ...r, a: townPoint(t, ...r.a), b: townPoint(t, ...r.b) }));
}

/** every new town, as it is planned (where the world sets each down is the world's) */
export const TOWNS: Town[] = [POKROV, LIPKI, ZAVOD];

/** a town's walls in the world (only Pokrov has any) */
export function placedWalls(p: PlacedTown): KitPiece[] {
  if (p.town.name !== POKROV.name) return [];
  return pokrovWalls(p.padY).map((k) => {
    const [x, z] = townPoint(p.town, k.at[0], k.at[2]);
    return { ...k, at: [x, k.at[1], z], turn: (k.turn ?? 0) + p.town.rot };
  });
}

/** a town's domes in the world: the foot of each drum, how big, whether gilt (heights over the pad: its buildings' floors are 0.3 over it) */
export function placedDomes(p: PlacedTown): { x: number; y: number; z: number; size: number; gilt: boolean }[] {
  const list = p.town.name === POKROV.name ? POKROV_DOMES : p.town.name === LIPKI.name ? LIPKI_DOMES : [];
  return list.map((d) => {
    const [x, z] = townPoint(p.town, d.x, d.z);
    return { x, y: p.padY + 0.3 + d.over, z, size: d.size, gilt: d.gilt };
  });
}

/**
 * Whether somebody at a place is on the monastery's walls (on its walk, its parapet, its stairs) and so has
 * something under them: for the server, which asks of anybody high off the ground what they stand on. Within the
 * band from the wall's outer face to the inner edge of its stairs, and no higher than its merlons.
 */
export function onTownWall(placed: PlacedTown[] | undefined, x: number, y: number, z: number): boolean {
  for (const p of placed ?? []) {
    if (p.town.name !== POKROV.name || y < p.padY - 0.5 || y > p.padY + 9.5) continue;
    const c = Math.cos(p.town.rot), s = Math.sin(p.town.rot), dx = x - p.town.x, dz = z - p.town.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c, W = POKROV_WALL;
    for (let i = 0; i < W.length; i++) {
      const [ax, az] = W[i], [bx, bz] = W[(i + 1) % W.length], ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
      const t = Math.max(0, Math.min(1, ((lx - ax) * ex + (lz - az) * ez) / L2));
      // (inside is on the left of the way a side runs, its outside on the right: how far in from the outer face; the band reaches the wall's depth and its stair's, and a little outside it)
      const side = (ez * (lx - ax) - ex * (lz - az)) / Math.sqrt(L2);
      if (Math.hypot(lx - ax - ex * t, lz - az - ez * t) < 8 && side > -1 && side < DEEP + 3.6 + 0.5) return true;
    }
    // (and the round towers at the corners, their tops)
    for (const [ax, az] of W) if (Math.hypot(lx - ax, lz - az) < 8.2) return true;
  }
  return false;
}

/** a point of a town's own frame in the world */
export function townPoint(t: Town, lx: number, lz: number): [number, number] {
  const c = Math.cos(t.rot), s = Math.sin(t.rot);
  return [t.x + lx * c + lz * s, t.z - lx * s + lz * c];
}
