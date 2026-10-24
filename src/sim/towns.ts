// The new towns of the map three times over (2026-10-16): where each building stands, and the monastery's walls as
// pieces of the fort kit. Pure numbers, the same for the game and the server. The buildings are the game's own,
// drawn up for these places (src/world/town-plans.ts); the walls are the kit's (src/sim/kit.ts), re-skinned in white
// limewashed brick where they are drawn. The owner: "we are making new towns. we have assets in our repository for
// this, pieces where we can make anything we want. do not make boring houses. be creative".
//
// Each town has its own frame: x east and z south of its middle, as the world's, turned `rot` about the upright.

import type { BuildingType } from '../world/worldgen/layout';
import type { KitPiece } from './kit';
import { KNOLL, LIPKI, LIPKI_GROUND, lipkiBuildings, lipkiThings } from './lipki';
import { OZERKI, OZERKI_GROUND, OZERKI_WALKS, ozerkiBuildings, ozerkiThings } from './ozerki';
import { walkDecks, walkPieces, type WalkRun } from './walkways';
import { MOKROYE, MOKROYE_GROUND, MOKROYE_WALKS, mokroyeBuildings, mokroyePosts, mokroyeThings } from './mokroye';
import { POKROV_GROUND, POKROV_TERRACE, POKROV_TREES, pokrovBuildings, pokrovThings } from './pokrov';
import { ZAVOD, ZAVOD_GROUND, ZAVOD_WALL, zavodBuildings, zavodThings, type TownThing } from './zavod';
import { ZASTAVA, ZASTAVA_GROUND, ZASTAVA_SLABS, zastavaBuildings, zastavaThings } from './zastava';
import { DESERT_TOWNS, desertBuildings, desertGround, desertThings } from './desert';
import { TOWER_ROOM, towerCuts, wallCuts, type TowerPlace } from './pokrov-towers';

export { LIPKI };

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
export interface TownSpot { type: BuildingType; x: number; z: number; rot: number; arms?: number; /** its floor so high over the pad, where it does not stand on the ground (a boathouse on a pier) */ up?: number }


/**
 * Pokrov: the white-walled monastery on the main west road, and the town outside its gate. The bunker road runs in
 * at the Holy Gate and out at the north gate: whoever holds the monastery holds the way to Bunker 17.
 */
export const POKROV: Town = { name: 'Pokrov', x: -1850, z: -30, pad: [135, 115], rot: 0 };

/** the monastery's outer wall line, in Pokrov's frame, round the way the kit's walls run (their outside on the right) */
export const POKROV_WALL: [number, number][] = [[-65, 20], [70, 20], [75, -60], [0, -95], [-80, -55]];
/** where along which side of POKROV_WALL its gates' middles are (metres from the side's first corner) */
const POKROV_GATES: { side: number; at: number }[] = [{ side: 0, at: 70 }, { side: 3, at: 49 }];
/**
 * The sides whose middle a stair climbs to the wall-walk, from inside, and how far on from the middle its foot is.
 * The east one's foot was 0.8 m from the cells' north end, a gap to sidle into: on by 2.5 m, it has room before it.
 */
const POKROV_STAIRS: { side: number; on: number }[] = [{ side: 1, on: 2.5 }, { side: 4, on: 0 }];

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
    const stair = POKROV_STAIRS.find((q) => q.side === s);
    if (stair) {
      // (behind the wall, in from its outer face by its depth: rising along the side to its walk)
      const [sx, , sz] = at(L / 2 - THIN / 2 + stair.on), ix = Math.cos(turn), iz = -Math.sin(turn);
      out.push({ id: 'fort_wall_stairs_straight_01', at: [sx + ix * DEEP, y, sz + iz * DEEP], turn, name: 'Pokrov stair' });
    }
    out.push({ id: 'fort_tower_round', at: [px, y, pz], turn, name: 'Pokrov tower' });
  });
  return out;
}

/**
 * The domes over Pokrov, in its frame: over which building's middle, how high over that building's floor the drum
 * stands (into its roof's ridge: a gable rises 0.32 of the building's depth over its walls), how big, and whether
 * it is gilt. The cathedral's great dome, gilt as a cathedral's is; the belfry's little one over its bells.
 */
export const POKROV_DOMES: { x: number; z: number; over: number; size: number; gilt: boolean }[] = [
  // (the great one over the crossing, a small one along the nave's ridge to the west, one over each arm and the apse)
  { x: 12, z: -38, over: 16.0, size: 1.45, gilt: true },
  { x: -4.75, z: -38, over: 16.2, size: 0.72, gilt: false },
  { x: 12, z: -50.5, over: 12.4, size: 0.65, gilt: false },
  { x: 12, z: -25.5, over: 12.4, size: 0.65, gilt: false },
  { x: 30.75, z: -38, over: 11.6, size: 0.65, gilt: true },
  { x: 34, z: -58, over: 21.4, size: 0.55, gilt: true },
];
/** and over Lipki's chapel, on its knoll */
export const LIPKI_DOMES: { x: number; z: number; over: number; size: number; gilt: boolean }[] = [{ x: KNOLL.x, z: KNOLL.z, over: 5.9, size: 0.38, gilt: false }];

/** a town as the world has set it down: where, and the height of its pad of level ground */
export interface PlacedTown { town: Town; padY: number }

/** the buildings of a town by its name */
export function townBuildings(t: Town): TownSpot[] {
  return t.name === POKROV.name ? pokrovBuildings() : t.name === LIPKI.name ? lipkiBuildings() : t.name === ZAVOD.name ? zavodBuildings() : t.name === OZERKI.name ? ozerkiBuildings() : t.name === MOKROYE.name ? mokroyeBuildings() : t.name === ZASTAVA.name ? zastavaBuildings() : desertBuildings(t);
}

/** what lies about a town (containers, crates, drums), in its frame */
/** the trees a town has planted in it (only Pokrov's court has any): kind, where in its frame, how big */
export function townTrees(t: Town): [string, number, number, number][] {
  return t.name === POKROV.name ? POKROV_TREES : [];
}

export function townThings(t: Town): TownThing[] {
  return t.name === ZAVOD.name ? zavodThings() : t.name === LIPKI.name ? lipkiThings() : t.name === POKROV.name ? pokrovThings() : t.name === OZERKI.name ? ozerkiThings() : t.name === MOKROYE.name ? mokroyeThings() : t.name === ZASTAVA.name ? zastavaThings() : desertThings(t);
}

/**
 * The ground a town has worn bare, dug or raised, in its frame: gravel yards (rectangles x0, z0, x1, z1), trodden
 * lanes (lines, how wide), garden beds, knolls. For whoever sets the town down, to shape and paint it so and keep the
 * grass off it. (A building on a knoll stands on its top: its floor over the knoll's height, see moundAt.)
 */
export interface TownGround {
  yards: [number, number, number, number][];
  /** `dark`: no lamps stand along it (the monastery's court) */
  lanes: { line: [number, number][]; w: number; dark?: boolean }[];
  /** gardens' beds, dug (rectangles as yards): painted earth, no grass */
  beds?: [number, number, number, number][];
  /** ground raised (or sunk, a hollow: h below 0): a knoll's middle, how far its foot reaches, how high its top, how wide its level top (x, z, r, h, top) */
  mounds?: [number, number, number, number, number][];
  /**
   * Water over it (a swamp's, a drowned meadow): how high over the pad, its edge (the town's frame), and whether it is
   * a swamp. For the world's water (`world.water`, a Lake at the pad's height plus this).
   */
  water?: { level: number; outline: [number, number][]; swamp: boolean };
  /** ground raised level inside a line (x, z points), so high, its bank falling away over `out` metres round it */
  terraces?: { poly: [number, number][]; h: number; out: number }[];
}
export function townGround(t: Town): TownGround {
  return t.name === ZAVOD.name ? ZAVOD_GROUND : t.name === LIPKI.name ? LIPKI_GROUND : t.name === POKROV.name ? POKROV_GROUND : t.name === OZERKI.name ? OZERKI_GROUND : t.name === MOKROYE.name ? MOKROYE_GROUND : t.name === ZASTAVA.name ? ZASTAVA_GROUND : desertGround(t) ?? { yards: [], lanes: [] };
}

/** how far a point is outside a line round (0 inside it) */
function outside(poly: [number, number][], x: number, z: number): number {
  let inside = false, best = 1e9;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    const ex = bx - ax, ez = bz - az, u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(x - ax - ex * u, z - az - ez * u));
  }
  return inside ? 0 : best;
}

/** how high a town's knolls and terraces raise its ground at a point of its frame, over its pad */
export function moundAt(t: Town, lx: number, lz: number): number {
  let up = 0, down = 0;
  const g = townGround(t);
  for (const [x, z, r, h, top] of g.mounds ?? []) {
    const d = Math.hypot(lx - x, lz - z), k = Math.min(1, Math.max(0, (r - d) / (r - top))), e = h * k * k * (3 - 2 * k);
    // (the highest knoll there, and the deepest hollow)
    if (h > 0) up = Math.max(up, e);
    else down = Math.min(down, e);
  }
  for (const { poly, h, out } of g.terraces ?? []) {
    const d = outside(poly, lx, lz), k = Math.min(1, Math.max(0, 1 - d / out));
    up = Math.max(up, h * k * k * (3 - 2 * k));
  }
  return up + down;
}

/** a run of a wall of concrete slabs, from a to b: the slabs gone from it (counted from a), and of those the ones lying on the ground (World.slabs) */
export interface SlabRun { a: [number, number]; b: [number, number]; gone?: number[]; down?: number[] }

/** a room of a building the water stands in (coast-kit's Waters.rooms): its middle, its turn, half its size each way; `dry` for one the water must stay out of */
export interface WaterRoom { x: number; z: number; rot: number; hx: number; hz: number; dry?: boolean }

/**
 * The rooms of a town in water where the water stands inside (Mokroye's flooded houses and its sunk barn): each a
 * building whose floor lies under the town's water, its footprint (from `sizes`, the world's BUILDING_FOOTPRINT, given
 * by the caller: the footprints' file is the world's generator's and imports this one) turned with it. A building on
 * stilts or an island, its floor over the water, is none: marked dry, it would leave a hole in the water under it.
 */
export function placedRooms(p: PlacedTown, sizes: Partial<Record<BuildingType, [number, number]>>): WaterRoom[] {
  const water = townGround(p.town).water;
  if (!water) return [];
  return townBuildings(p.town).flatMap((s) => {
    const size = sizes[s.type], floor = s.up ?? moundAt(p.town, s.x, s.z) + 0.3;
    if (!size || floor >= water.level) return [];
    const [x, z] = townPoint(p.town, s.x, s.z);
    return [{ x, z, rot: p.town.rot + s.rot, hx: size[0] / 2, hz: size[1] / 2 }];
  });
}

/** a town's walls of concrete slabs in the world, its runs moved from its frame */
export function placedSlabs(t: Town): SlabRun[] {
  const runs = t.name === ZAVOD.name ? ZAVOD_WALL : t.name === ZASTAVA.name ? ZASTAVA_SLABS : [];
  return runs.map((r) => ({ ...r, a: townPoint(t, ...r.a), b: townPoint(t, ...r.b) }));
}

/** every new town, as it is planned (where the world sets each down is the world's) */
// (and the desert's three on its roads, 2026-10-18: src/sim/desert.ts. First: they are the map's own steps, and the
// map's own places come before every place apart in the list of places, see test/loot.test.ts)
export const TOWNS: Town[] = [...DESERT_TOWNS, POKROV, LIPKI, ZAVOD, OZERKI, MOKROYE, ZASTAVA];

/** a town's kit pieces that are not walkways: the stilts under Mokroye's house on stilts (on the pad at y) */
export function townPosts(t: Town, y: number): KitPiece[] {
  return t.name === MOKROYE.name ? mokroyePosts(y) : [];
}

/** a town's walkways of boards on posts (Ozerki's piers, Mokroye's boardwalks), in its frame */
export function townWalks(t: Town): WalkRun[] {
  return t.name === OZERKI.name ? OZERKI_WALKS : t.name === MOKROYE.name ? MOKROYE_WALKS : [];
}

/**
 * A town's pieces of a kit other than the fort's, in the world (its walkways, the pier kit's), a group to each run of
 * a walkway (and one for the posts): which kit, the pieces, what of them stops a body as boxes (middle, half size,
 * turn) turned with the town, and where the group is (its middle and how far it reaches), for drawing it near by itself.
 */
export function placedKits(p: PlacedTown): { kit: string; pieces: KitPiece[]; boxes: { c: [number, number, number]; h: [number, number, number]; rot: number }[]; x: number; z: number; r: number }[] {
  const runs = townWalks(p.town);
  if (!runs.length) return [];
  const move = (k: KitPiece): KitPiece => {
    const [x, z] = townPoint(p.town, k.at[0], k.at[2]);
    return { ...k, at: [x, k.at[1], z], turn: (k.turn ?? 0) + p.town.rot };
  };
  const boxes = walkDecks(runs, p.padY).map((b) => {
    const [x, z] = townPoint(p.town, b.c[0], b.c[2]);
    return { c: [x, b.c[1], z] as [number, number, number], h: b.h, rot: b.rot + p.town.rot };
  });
  const group = (pieces: KitPiece[], b: typeof boxes) => {
    const at = pieces.map((k) => k.at), x = at.reduce((s, q) => s + q[0], 0) / at.length, z = at.reduce((s, q) => s + q[2], 0) / at.length;
    return { kit: 'pier_kit', pieces, boxes: b, x, z, r: Math.max(...at.map((q) => Math.hypot(q[0] - x, q[2] - z))) + 4 };
  };
  const posts = townPosts(p.town, p.padY).map(move);
  return [
    ...runs.map((r, k) => group(walkPieces([r], p.padY, `${p.town.name} walkway`).map(move), [boxes[k]])),
    ...(posts.length ? [group(posts, [])] : []),
  ];
}

/**
 * Which way each corner tower's doorway faces, as turned from the way into the court from that corner (radians).
 * The north-east one's is turned along the south wall: the cells' south end stands three metres off its middle line.
 */
const POKROV_DOORS = [0, -0.3, 0, 0, 0];

/** Pokrov's corner towers in the world: where, how high their foot is, which way their doorway faces (see src/sim/pokrov-towers.ts) */
export function placedTowers(p: PlacedTown): TowerPlace[] {
  if (p.town.name !== POKROV.name) return [];
  const W = POKROV_WALL, foot = p.padY + POKROV_TERRACE.h;
  return W.map(([x, z], k) => {
    const [px, pz] = W[(k + W.length - 1) % W.length], [nx, nz] = W[(k + 1) % W.length];
    const a = Math.atan2(nz - z, nx - x), b = Math.atan2(pz - z, px - x), court = Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));
    const [wx, wz] = townPoint(p.town, x, z);
    // (the tower's piece is turned as its side is: see pokrovWalls. An angle on the plan of the town's frame is the world's less the town's turn.)
    return { x: wx, z: wz, foot, door: court + POKROV_DOORS[k] - p.town.rot, dir: 1 as const, turn: Math.atan2(nx - x, nz - z) + p.town.rot };
  });
}

/** a town's walls in the world (only Pokrov has any): the towers hollowed (they are made solid by their own plan), and the walls that run into them cut back there */
export function placedWalls(p: PlacedTown): KitPiece[] {
  if (p.town.name !== POKROV.name) return [];
  const towers = placedTowers(p);
  return pokrovWalls(p.padY + POKROV_TERRACE.h).map((k): KitPiece => {
    const [x, z] = townPoint(p.town, k.at[0], k.at[2]), placed: KitPiece = { ...k, at: [x, k.at[1], z], turn: (k.turn ?? 0) + p.town.rot };
    if (k.name === 'Pokrov tower') {
      const t = towers.find((w) => Math.hypot(w.x - x, w.z - z) < 0.01)!;
      return { ...placed, cut: towerCuts(t), body: false };
    }
    // (a wall's piece runs from where it stands along its side, as far as THIN, to the next tower's middle at most)
    const near = towers.filter((w) => Math.hypot(w.x - x, w.z - z) < THIN + 9);
    return k.name === 'Pokrov wall' && near.length ? { ...placed, cut: near.flatMap(wallCuts) } : placed;
  });
}

/** a town's domes in the world: the foot of each drum, how big, whether gilt (heights over the pad: its buildings' floors are 0.3 over it) */
export function placedDomes(p: PlacedTown): { x: number; y: number; z: number; size: number; gilt: boolean }[] {
  const list = p.town.name === POKROV.name ? POKROV_DOMES : p.town.name === LIPKI.name ? LIPKI_DOMES : [];
  return list.map((d) => {
    const [x, z] = townPoint(p.town, d.x, d.z);
    return { x, y: p.padY + moundAt(p.town, d.x, d.z) + 0.3 + d.over, z, size: d.size, gilt: d.gilt };
  });
}

/**
 * Whether somebody at a place is on the monastery's walls (on its walk, its parapet, its stairs, in or on a tower) and so has
 * something under them: for the server, which asks of anybody high off the ground what they stand on. Within the
 * band from the wall's outer face to the inner edge of its stairs, and no higher than its merlons.
 */
export function onTownWall(placed: PlacedTown[] | undefined, x: number, y: number, z: number): boolean {
  for (const p of placed ?? []) {
    const foot = p.padY + POKROV_TERRACE.h;
    if (p.town.name !== POKROV.name || y < foot - 0.5) continue;
    const c = Math.cos(p.town.rot), s = Math.sin(p.town.rot), dx = x - p.town.x, dz = z - p.town.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c, W = POKROV_WALL;
    // (the round towers at the corners: up their stairs, and on their tops to the battlements' height)
    for (const [ax, az] of W) if (Math.hypot(lx - ax, lz - az) < 8.2 && y < foot + TOWER_ROOM.top + 2.2) return true;
    if (y > foot + 9.5) continue;
    for (let i = 0; i < W.length; i++) {
      const [ax, az] = W[i], [bx, bz] = W[(i + 1) % W.length], ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
      const t = Math.max(0, Math.min(1, ((lx - ax) * ex + (lz - az) * ez) / L2));
      // (inside is on the left of the way a side runs, its outside on the right: how far in from the outer face; the band reaches the wall's depth and its stair's, and a little outside it)
      const side = (ez * (lx - ax) - ex * (lz - az)) / Math.sqrt(L2);
      if (Math.hypot(lx - ax - ex * t, lz - az - ez * t) < 8 && side > -1 && side < DEEP + 3.6 + 0.5) return true;
    }
  }
  return false;
}

/** whether a place is inside the monastery's walls (on the plan: at any height) */
export function inPokrovCourt(x: number, z: number): boolean {
  const c = Math.cos(POKROV.rot), s = Math.sin(POKROV.rot), dx = x - POKROV.x, dz = z - POKROV.z, lx = dx * c - dz * s, lz = dx * s + dz * c, W = POKROV_WALL;
  let inside = false;
  for (let i = 0, j = W.length - 1; i < W.length; j = i++) {
    const [xi, zi] = W[i], [xj, zj] = W[j];
    if (zi > lz !== zj > lz && lx < ((xj - xi) * (lz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** a point of a town's own frame in the world */
export function townPoint(t: Town, lx: number, lz: number): [number, number] {
  const c = Math.cos(t.rot), s = Math.sin(t.rot);
  return [t.x + lx * c + lz * s, t.z - lx * s + lz * c];
}
