// What a world is made of (World, Site, Instance, Solid, POI, Way, Worn): the types every part of the game reads it by.
// (One part of worldgen.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import type { Bridge } from '../../sim/bridge';
import type { FortPlace } from '../../sim/castle';
import type { BuildingPlot, SiteKind } from './layout';

/** A small place away from the village: a couple of buildings in a clearing. */
export interface Site {
  name: string;
  kind: SiteKind;
  x: number;
  z: number;
  /** which way its doors and yard face: out toward the edge of the map, where people arrive from */
  rot: number;
  /** built after the map was first made (see the end of generateWorld): nothing that was there before is moved for it */
  later?: boolean;
}

export interface Instance {
  kind: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  /** drawn only within this many metres (furniture indoors is invisible from across the map) */
  far?: number;
  /** how whatever draws it lays it to the ground it stands on: nose up, roll (radians), and how high its middle is then */
  lean?: [number, number, number];
}

/** Something big standing in the world that is neither a building to go into nor a prop off a shelf: a round thing of masonry or steel. */
export interface Solid {
  kind: 'stack' | 'tank';
  x: number;
  /** the ground it stands on */
  y: number;
  z: number;
  /** how far out from its middle it reaches, and how high it stands, metres */
  r: number;
  h: number;
}

export interface POI {
  name: string;
  x: number;
  z: number;
  radius: number;
}

/**
 * A way that is not a road: the points it is drawn through, [x, z] over the ground, and WHAT IT IS. `driven`: wheels
 * come by it (a cart track: two ruts in the snow and its bed worn the width of an axle); not driven, it is only
 * walked (a foot path: one trodden line, and no earth was ever moved for it). `faint`: few come by it (a broken
 * line on the map, and less of everything in the snow). No way is faint today: the snow and the maps know the word.
 */
export interface Way { line: [number, number][]; driven: boolean; faint?: boolean }

/**
 * Ground worn bare that is no way of its own: a place (`line` is one spot: carts turned there, or feet stood about)
 * or a few paces of trodden line (two spots and more: from a door to the way past it). Worn out to `r` metres from
 * it. `driven`: wheels were there, and it is rutted every which way; else it is trampled by feet alone.
 */
export interface Worn { line: [number, number][]; r: number; driven: boolean }

export interface World {
  heights: Float32Array;
  /** the ground as it is seen from above: `heights`, but for the roof of the bunker, which lies level with the ground about it over the hole the bunker stands in. What grows is drawn at this height. */
  surface: Float32Array;
  /** RGBA weights: grass, forest floor, rock, gravel */
  splat: Uint8Array;
  /** grass blade density 0..255 */
  grass: Uint8Array;
  road: { points: Float32Array; width: number };
  /** roads laid since: each a line of its own. (Never added to the first one's points: jeeps and street lamps are told off along those by number.) */
  roads: { points: Float32Array; width: number; /** a side street: its asphalt lies just under the road's where it leaves it, and breaks up at its far end */ side?: boolean; /** the road over a bridge: its two ends, on the deck. No asphalt is laid on the ground for it (see `bridges`) */ bridge?: boolean }[];
  /** the bridges the road goes over (see src/sim/bridge.ts): each is also a line of `roads` */
  bridges: Bridge[];
  /** ways that are not roads, each saying what it is (see `Way`): the cart track from the road's end to the ruined houses, and the foot path on from there to the fort's ramp. The maps draw them, and the snow lies along them and is rutted or trodden by what each is (src/world/snow.ts). */
  paths: Way[];
  /** ground worn bare that is no way of its own (see `Worn`): where the carts turned at the track's end, the apron before the fort's ramp, the few paces from each door to the way past it. Paint and wear only. */
  worn: Worn[];
  /** the helicopter that came down under the fort (see MOUNTAIN.wreck): the middle of it on the ground, and which way it lies. Null in a world that has none. */
  wreck: { x: number; y: number; z: number; rot: number } | null;
  /** lengths of low dry-stone wall (src/world/gatehouse.ts draws them, and says what each number is: `WallPiece`): the middle of each at its foot, which way it runs (about Y), how long, how high and how thick; and how it lies to the ground it stands on */
  walls: { x: number; y: number; z: number; yaw: number; long: number; high: number; thick: number; rise?: number; top?: number; down?: boolean }[];
  /** the fort on the valley's rim (see MOUNTAIN.castle): its middle, the height of its yard, and how it is turned, as src/sim/castle.ts wants a place said. Null in a world that has none. */
  castle: FortPlace | null;
  /** a ruined gatehouse across a road's end (src/world/gatehouse.ts): the road's end, on its surface, and which way the road was running there (about Y: at 0 it runs toward +z). Null in a world that has none: this one has none (the one there was stood under the mountain the fort has left). */
  gatehouse: { x: number; y: number; z: number; rot: number } | null;
  buildings: BuildingPlot[];
  trees: Instance[];
  rocks: Instance[];
  props: Instance[];
  pois: POI[];
  sites: Site[];
  /** the chimney and the tanks of the works */
  solids: Solid[];
  /** default spawn (first of the ring) */
  spawn: { x: number; z: number; yaw: number };
  /** fresh characters start at one of these, out on the edge of the map, facing inward */
  spawns: { x: number; z: number; yaw: number }[];
  /** every start of the ring as it was first laid, those nobody is set down at any more among them */
  spawnRing: { x: number; z: number; yaw: number }[];
}
