// Procedural buildings: walls with door/window cut-outs (two material layers),
// floors, ceilings, gable / shed / flat roofs, window frames + glass, hinged doors,
// hand-authored interior layouts with Poly Haven furniture, yard props and loot
// spawn points. All static geometry is merged per material for the whole map.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { assets } from '../core/assets';
import { physics, AJAR_GROUPS, BODY_QUERY, GLASS_GROUPS, WORLD_GROUPS, type Surface } from '../core/physics';
import { RNG } from '../core/noise';
import type { Atmosphere } from './atmosphere';
import { GAS, gasDepth, gasZone } from '../sim/gas';
import { BUILDING_FOOTPRINT, CELL, TOWN, WORLD_RES, WORLD_SIZE, bunkerPlace, heightAt, idx, type BuildingPlot, type Instance, type SiteKind, type World } from './worldgen';
import { bunkerAt, bunkerPlan, levelY } from '../sim/bunker';

/** (`Gas` is not a kind of building: it is whatever stands under the gas, whatever else it is. See src/sim/gas.ts.) */
export type Usage = 'Village' | 'Town' | 'Farm' | 'Industrial' | 'Military' | 'Hunting' | 'Medic' | 'Police' | 'Gas' | 'Bunker' | 'East';

export interface LootPoint {
  x: number;
  y: number;
  z: number;
  usage: Usage[];
  building: string;
  /** on the floor (room for long items) rather than on furniture */
  floor: boolean;
  /**
   * kept stocked with something to fight with (see Economy), never left empty for long:
   * a firearm where firearms were kept (police, guard posts), any weapon elsewhere
   */
  arms?: 'guns' | 'any';
  /** the furniture surface this point sits on: world-space centre, yaw and usable half extents */
  surf?: { x: number; z: number; rot: number; hx: number; hz: number; /** free height above the surface */ clear: number };
}

/** props that are searched as containers (loot is inside, never lying on top) */
export const CRATE_KINDS = new Set(['wooden_crate_01', 'wooden_military_crate', 'old_military_crate', 'weapons_case']);

/**
 * Walls and doors are drawn before anything that grows or lies about (trees, grass and props
 * sit at -10 and up, see LodSet): whatever a wall hides is then thrown out by the depth test
 * before it is shaded. Drawn after them, as they were, a room in the woods paid for every
 * tree behind its walls: a fifth of the frame inside the outlying houses, more on a hot GPU.
 */
const WALLS_FIRST = -20;

/** how far in from the model's edge items may sit: [along, deep] in metres; shelves have posts and a back panel */
const SURFACE_INSET: Record<string, [number, number]> = {
  Shelf_01: [0.07, 0.035],
  wooden_bookshelf_worn: [0.1, 0.07],
  steel_frame_shelves_01: [0.07, 0.05],
  old_bed_frame: [0.08, 0.1],
};
/** free height between one shelf board and the next */
const SHELF_CLEARANCE: Record<string, number> = { Shelf_01: 0.24, wooden_bookshelf_worn: 0.25, steel_frame_shelves_01: 0.46 };
/** top of each shelf board, measured from the models: hand-typed loot heights snap to the nearest one */
const SHELF_LEVELS: Record<string, number[]> = {
  Shelf_01: [0.14, 0.38, 0.66, 0.94, 1.22, 1.51, 1.79],
  wooden_bookshelf_worn: [0.11, 0.39, 0.67, 0.96, 1.28, 1.66],
  steel_frame_shelves_01: [0.13, 0.64, 1.15, 1.65],
};
/** how high a bed's springs are over its feet, and how thick the mattress on them is: what is kept on a bed lies on that */
const BED = { springs: 0.49, mattress: 0.1 };
/** how far under its rim the lid of a water barrel is */
const BARREL_LID = 0.032;
/** furniture whose loot sits on the very top of the model (height taken from the model, not hand-typed) */
const TOP_SURFACE = new Set(['WoodenTable_01', 'painted_wooden_table', 'electric_stove', 'painted_wooden_cabinet', 'metal_office_desk']);

type MatKey =
  | 'plaster_ext' | 'brick_ext' | 'planks_ext' | 'planks' | 'int_plaster' | 'int_painted'
  | 'floor_wood' | 'floor_lino' | 'floor_concrete' | 'roof_iron' | 'roof_tiles' | 'concrete' | 'trim' | 'mattress' | 'glass';

const MATS: Record<Exclude<MatKey, 'glass'>, { tex: string; tile: number; color?: number; metal?: boolean; surface: Surface }> = {
  plaster_ext: { tex: 'worn_mossy_plasterwall', tile: 3, surface: 'plaster' },
  brick_ext: { tex: 'red_brick_plaster_patch_02', tile: 2.6, surface: 'concrete' },
  planks_ext: { tex: 'weathered_plank_siding', tile: 2.4, surface: 'wood' },
  planks: { tex: 'weathered_planks', tile: 2, surface: 'wood' },
  int_plaster: { tex: 'damaged_plaster', tile: 2.6, surface: 'plaster' },
  int_painted: { tex: 'painted_plaster_wall', tile: 2.4, color: 0xbfb8a0, surface: 'plaster' },
  floor_wood: { tex: 'wood_floor_worn', tile: 2.2, surface: 'wood' },
  floor_lino: { tex: 'old_linoleum_flooring_01', tile: 1.6, surface: 'wood' },
  floor_concrete: { tex: 'concrete_floor_worn_001', tile: 3, surface: 'concrete' },
  roof_iron: { tex: 'rusty_corrugated_iron', tile: 2, metal: true, surface: 'metal' },
  roof_tiles: { tex: 'clay_roof_tiles_02', tile: 2.2, surface: 'concrete' },
  concrete: { tex: 'dirty_concrete', tile: 3, surface: 'concrete' },
  trim: { tex: 'weathered_planks', tile: 1.2, color: 0x9a8f7c, surface: 'wood' },
  // (what lies on a bed's springs: old ticking, the colour of it and no more)
  mattress: { tex: 'painted_plaster_wall', tile: 0.9, color: 0xaaa48d, surface: 'cloth' },
};

interface Opening {
  a: number; // start along wall (building-local coordinate on the wall axis)
  b: number;
  bottom: number;
  top: number;
  kind: 'door' | 'window' | 'gap';
}

interface WallDef {
  side: 'front' | 'back' | 'left' | 'right' | 'inner';
  from?: [number, number];
  to?: [number, number];
  ext: MatKey;
  int: MatKey;
  openings: Opening[];
}

interface Furn {
  id: string;
  x: number;
  z: number;
  rot: number;
  scale?: number;
  y?: number;
}

/** A floor above the ground one: its own walls, what stands in it and what is found there (heights from its own floor). */
interface Upper {
  h: number;
  int: MatKey;
  floor: MatKey;
  walls: WallDef[];
  furniture: Furn[];
  loot: [number, number, number][];
}

/** A straight flight of stairs along z: x0 to x1 wide, its foot at z = foot on the floor, its head at z = top on the floor above. */
interface Stairs {
  x0: number;
  x1: number;
  foot: number;
  top: number;
}

interface Blueprint {
  w: number;
  d: number;
  h: number;
  upper?: Upper;
  stairs?: Stairs;
  ext: MatKey;
  int: MatKey;
  floor: MatKey;
  roof: MatKey;
  roofType: 'gable' | 'shed' | 'flat';
  /**
   * Its outside is a model (walls, plinth, roof): none of that is made here, only what a model that is a
   * shell has not got. The inside faces of its walls, its floor and ceiling, glass, doors, and what stops a body.
   * `lift`: how far the model's own ground is under the floor. `ridge`, `eave`: how high over the floor the top of
   * its roof is, in the middle and at its edge, and `out`: how far from the middle that edge is.
   */
  shell?: { model: string; lift: number; ridge: number; eave: number; out: number };
  /**
   * It is ALL a model's, inside and out: rooms, floors, stairs. Nothing of it is made here but the ground under
   * it, doors hung in its doorways, and its places for things; what stops a body and a shot is the model's own
   * triangles (made when it is built). `lift`: how far the model's own ground is under its ground floor.
   * `floors`: how high each floor is over the ground one (a place for a thing at one of those heights lies on that
   * floor). `doors`: a leaf hung at [x, y, z] (its hinge, on the sill), turned `rot`, `w` wide and `h` high.
   */
  whole?: { model: string; lift: number; surface: Surface; floors: number[]; doors: { x: number; y: number; z: number; rot: number; w: number; h: number }[] };
  walls: WallDef[];
  furniture: Furn[];
  loot: [number, number, number][];
  usage: Usage[];
}

const T = 0.2; // wall thickness
/** how thick the floor between two storeys is */
const SLAB = 0.2;

const win = (a: number, b: number, bottom = 0.9, top = 2.05): Opening => ({ a, b, bottom, top, kind: 'window' });
const door = (a: number, b: number, top = 2.1): Opening => ({ a, b, bottom: 0, top, kind: 'door' });
const gap = (a: number, b: number, top = 2.1): Opening => ({ a, b, bottom: 0, top, kind: 'gap' });

function blueprint(type: BuildingPlot['type'], rng: RNG): Blueprint {
  const ext = rng.chance(0.5) ? 'plaster_ext' : 'brick_ext';
  switch (type) {
    case 'house_small':
      return {
        w: 8, d: 6.5, h: 2.8, ext, int: 'int_painted', floor: rng.chance(0.5) ? 'floor_wood' : 'floor_lino',
        roof: rng.chance(0.6) ? 'roof_tiles' : 'roof_iron', roofType: 'gable',
        walls: [
          { side: 'front', ext, int: 'int_painted', openings: [door(-2.1, -1.1), win(1.5, 2.6)] },
          { side: 'back', ext, int: 'int_painted', openings: [win(-2.6, -1.5), win(1.6, 2.7)] },
          { side: 'left', ext, int: 'int_painted', openings: [win(-0.6, 0.5)] },
          { side: 'right', ext, int: 'int_painted', openings: [win(-0.3, 0.8)] },
          { side: 'inner', from: [0.4, -3.05], to: [0.4, 3.05], ext: 'int_plaster', int: 'int_painted', openings: [door(-0.25, 0.7)] },
        ],
        furniture: [
          { id: 'electric_stove', x: -3.4, z: -2.68, rot: 0 },
          { id: 'painted_wooden_cabinet', x: -3.45, z: -1.7, rot: Math.PI / 2 },
          { id: 'WoodenTable_01', x: -1.7, z: -0.5, rot: 0 },
          { id: 'painted_wooden_chair_01', x: -1.5, z: 0.15, rot: Math.PI },
          { id: 'painted_wooden_chair_01', x: -2.3, z: -1.2, rot: 0.2 },
          { id: 'scandinavian_masonry_heater', x: -3.15, z: 2.3, rot: Math.PI / 2 },
          { id: 'old_bed_frame', x: 3.25, z: -2.0, rot: 0 },
          { id: 'wooden_bookshelf_worn', x: 3.48, z: 2.2, rot: -Math.PI / 2 },
          { id: 'Shelf_01', x: 1.0, z: 2.9, rot: Math.PI },
        ],
        loot: [
          [-3.4, 0.88, -2.68], [-3.45, 1.2, -1.7], [-1.9, 0.57, -0.5], [-1.3, 0.57, -0.5],
          [3.25, 0.48, -1.6], [3.45, 0.56, 2.2], [3.45, 1.02, 2.2], [1.0, 0.44, 2.92], [1.0, 1.24, 2.92],
          [-0.4, 0.02, 2.2], [2.0, 0.02, 0.5],
        ],
        usage: ['Village', 'Town'],
      };
    case 'house_brick':
      return {
        w: 10.5, d: 7.5, h: 2.9, ext: 'brick_ext', int: 'int_plaster', floor: 'floor_lino',
        roof: 'roof_iron', roofType: 'gable',
        walls: [
          { side: 'front', ext: 'brick_ext', int: 'int_plaster', openings: [win(-4.2, -3.0), door(-0.4, 0.6), win(3.0, 4.2)] },
          { side: 'back', ext: 'brick_ext', int: 'int_plaster', openings: [win(-4.0, -2.8), win(-0.6, 0.6), door(3.0, 4.0)] },
          { side: 'left', ext: 'brick_ext', int: 'int_plaster', openings: [win(-0.6, 0.6)] },
          { side: 'right', ext: 'brick_ext', int: 'int_plaster', openings: [win(0.4, 1.6)] },
          { side: 'inner', from: [-1.6, -3.55], to: [-1.6, 3.55], ext: 'int_plaster', int: 'int_plaster', openings: [door(0.55, 1.5)] },
          { side: 'inner', from: [2.0, -3.55], to: [2.0, 3.55], ext: 'int_plaster', int: 'int_plaster', openings: [door(-1.5, -0.55)] },
        ],
        furniture: [
          { id: 'old_bed_frame', x: -4.5, z: -2.45, rot: 0 },
          { id: 'painted_wooden_cabinet', x: -2.45, z: 3.2, rot: Math.PI },
          { id: 'wooden_bookshelf_worn', x: -4.76, z: 2.0, rot: Math.PI / 2 },
          { id: 'WoodenTable_01', x: 0.2, z: -0.9, rot: 0 },
          { id: 'painted_wooden_chair_01', x: 0.6, z: -0.25, rot: Math.PI },
          { id: 'painted_wooden_chair_01', x: -0.4, z: -1.6, rot: 0 },
          { id: 'Television_01', x: -1.2, z: 2.9, rot: Math.PI * 0.85 },
          { id: 'Shelf_01', x: 1.3, z: -3.4, rot: 0 },
          { id: 'electric_stove', x: 4.65, z: -3.18, rot: 0 },
          { id: 'steel_frame_shelves_01', x: 2.38, z: 2.5, rot: Math.PI / 2, scale: 0.1 },
          { id: 'scandinavian_masonry_heater', x: 4.35, z: 2.8, rot: -Math.PI / 2 },
        ],
        loot: [
          [-4.5, 0.48, -2.0], [-2.45, 1.2, 3.2], [-4.76, 0.56, 2.0], [-4.76, 1.02, 2.0],
          [0.0, 0.57, -0.9], [0.5, 0.57, -0.9], [1.3, 0.44, -3.45], [1.3, 1.24, -3.45],
          [4.65, 0.88, -3.18], [2.4, 0.14, 2.5], [2.4, 0.74, 2.5], [2.4, 1.34, 2.5],
          [-3.3, 0.02, 0.3], [3.4, 0.02, 0.6],
        ],
        usage: ['Village', 'Town'],
      };
    case 'barn':
      return {
        w: 12, d: 8, h: 4, ext: 'planks_ext', int: 'planks', floor: 'floor_concrete', roof: 'roof_iron', roofType: 'gable',
        walls: [
          { side: 'front', ext: 'planks_ext', int: 'planks', openings: [gap(-1.7, 1.7, 3.3)] },
          { side: 'back', ext: 'planks_ext', int: 'planks', openings: [win(-3, -2, 2.5, 3.3), win(2, 3, 2.5, 3.3)] },
          { side: 'left', ext: 'planks_ext', int: 'planks', openings: [win(-0.5, 0.5, 2.5, 3.3)] },
          { side: 'right', ext: 'planks_ext', int: 'planks', openings: [door(-2.6, -1.6)] },
        ],
        furniture: [
          { id: 'steel_frame_shelves_01', x: -4.2, z: -3.5, rot: 0, scale: 0.1 },
          { id: 'steel_frame_shelves_01', x: 4.2, z: -3.5, rot: 0, scale: 0.1 },
          { id: 'wooden_crate_01', x: -5.0, z: 2.6, rot: 0.3 },
          { id: 'wooden_crate_01', x: -4.4, z: 1.5, rot: -0.2 },
          { id: 'Barrel_01', x: 5.1, z: 3.1, rot: 0 },
          { id: 'barrel_03', x: 4.3, z: 3.2, rot: 1.2 },
          { id: 'old_tyre', x: 5.0, z: -0.6, rot: 0, y: 0.08 },
          ...(rng.chance(0.45) ? [{ id: 'covered_car', x: 0.2, z: 0.4, rot: 0.04 }] : []),
        ],
        loot: [
          [-4.2, 0.14, -3.5], [-4.2, 0.74, -3.5], [-4.2, 1.34, -3.5], [4.2, 0.14, -3.5], [4.2, 0.74, -3.5], [4.2, 1.34, -3.5],
          [-5.0, 0.37, 2.6], [-4.4, 0.37, 1.5], [-2.5, 0.02, -1.0], [2.8, 0.02, 1.8],
        ],
        usage: ['Farm', 'Industrial'],
      };
    case 'townhouse':
      // The brick block of two floors (a download: `house_interior` in scripts/assets.config.mjs), all of it the
      // model's: one room a floor in the shape of a cross, a stair that turns on itself, a balcony over the front
      // door. Measured from its file: floors at 0.18 and 3.474 over its own ground, doorways where the leaves hang.
      return {
        w: 11.32, d: 14.6, h: 3.1, ext: 'brick_ext', int: 'int_plaster', floor: 'floor_wood', roof: 'roof_iron', roofType: 'flat',
        whole: {
          model: 'house_interior', lift: 0.18, surface: 'concrete', floors: [3.294, 3.302],
          doors: [
            // (the front doorway is as wide as a pair of doors: a leaf hung on each jamb)
            { x: -3.88, y: 0, z: -3.346, rot: -Math.PI / 2, w: 0.915, h: 2.17 },
            { x: -3.88, y: 0, z: -1.504, rot: Math.PI / 2, w: 0.915, h: 2.17 },
            // the side door, and the one out onto the balcony
            { x: 3.873, y: 0, z: 4.956, rot: -Math.PI / 2, w: 1.05, h: 2.17 },
            { x: -3.88, y: 3.294, z: -4.508, rot: -Math.PI / 2, w: 1.05, h: 2.14 },
          ],
        },
        walls: [],
        furniture: [
          { id: 'WoodenTable_01', x: 0.6, z: -5.6, rot: 0 },
          { id: 'painted_wooden_chair_01', x: 0.2, z: -4.95, rot: Math.PI },
          { id: 'painted_wooden_chair_01', x: 1.0, z: -6.25, rot: 0 },
          { id: 'painted_wooden_cabinet', x: -1.4, z: -6.72, rot: 0 },
          { id: 'Shelf_01', x: -1.6, z: 7.02, rot: Math.PI },
          // upstairs
          { id: 'old_bed_frame', x: -1.6, z: -5.95, rot: 0, y: 3.294 },
          { id: 'old_bed_frame', x: 4.65, z: -4.3, rot: 0, y: 3.294 },
          { id: 'painted_wooden_cabinet', x: 0.78, z: 6.72, rot: Math.PI, y: 3.294 },
          { id: 'Shelf_01', x: -0.26, z: -7.02, rot: 0, y: 3.294 },
        ],
        loot: [
          [0.3, 0.57, -5.6], [0.9, 0.57, -5.6], [-1.4, 1.2, -6.72], [-1.6, 0.44, 6.97], [-1.6, 1.24, 6.97],
          [2.6, 0.02, -6.3], [-3.05, 0.02, -4.7], [4.6, 0.02, -4.5], [0.6, 0.02, -3.6], [-1.4, 0.02, 1.7], [0.2, 0.02, 3.1], [-1.3, 0.02, 4.7], [3.1, 0.02, 6.4],
          [-1.6, 3.774, -5.55], [4.65, 3.774, -3.9], [0.78, 4.494, 6.72], [-0.26, 3.734, -6.97], [-0.26, 4.534, -6.97],
          [2.6, 3.314, -6.3], [-3.0, 3.314, -4.8], [4.6, 3.314, -0.6], [0.6, 3.314, -3.6], [-1.4, 3.314, 1.7], [0.3, 3.314, 3.1], [-1.3, 3.314, 4.7], [3.0, 3.314, 6.3],
          [-4.85, 3.322, -1.6],
        ],
        usage: ['Town', 'Village'],
      };
    case 'shanty':
      // The plank house on piles (a download: `shanty_mansion`), all of it the model's: two rooms off the ground
      // with a way under between them, a floor over the whole, and decks on the roof. Its floors are 0.65, 3.35 and
      // 6.49 m over its own ground; it stands 0.3 m into the pad, so that the feet of its ramps are on the ground.
      return {
        w: 9.82, d: 15.8, h: 2.7, ext: 'planks_ext', int: 'planks', floor: 'floor_wood', roof: 'roof_iron', roofType: 'flat',
        whole: { model: 'shanty_mansion', lift: 0.3, surface: 'wood', floors: [0.351, 3.052, 2.962, 6.19, 6.08], doors: [] },
        walls: [],
        furniture: [],
        loot: [
          [-1.9, 0.371, -6.4], [1.6, 0.371, -6.4], [3.6, 0.371, -5.9], [0.1, 0.371, -5.4], [-1.4, 0.371, 3.1], [1.6, 0.371, 3.6], [3.6, 0.371, 4.1],
          // (measured in the game, a ray down from each: its first floor is boards at two heights nine centimetres apart)
          [-3.9, 2.992, -5.9], [-0.9, 3.072, -6.4], [2.1, 3.072, -5.9], [3.6, 2.982, -3.4], [-1.4, 2.982, -0.4], [1.6, 2.982, 0.6], [3.1, 2.982, -0.9], [-0.9, 3.072, 3.1], [2.1, 3.072, 3.6], [3.6, 3.012, 6.6],
          [3.6, 6.21, -3.4], [-1.9, 6.21, 0.1], [0.1, 6.1, 2.6],
        ],
        usage: ['Hunting', 'Village', 'Industrial'],
      };
    case 'hut': {
      // The long hut: a room of beds, and at the end the door is in, a lobby with a store room off it under the
      // one small high window. The openings are the model's own, to the millimetre (see `old_barrack` in
      // scripts/assets.config.mjs): where its picture of a window was there is a window, and a door where its door was.
      const four = [win(-5.549, -4.371, 0.833, 2.178), win(-3.1, -1.922, 0.833, 2.178), win(-0.651, 0.527, 0.833, 2.178), win(1.798, 2.977, 0.833, 2.178)];
      return {
        w: 13.52, d: 4.96, h: 2.3, ext: 'plaster_ext', int: 'int_plaster', floor: 'floor_wood', roof: 'roof_iron', roofType: 'gable',
        shell: { model: 'old_barrack', lift: 0.23, ridge: 3.33, eave: 2.22, out: 3.4 },
        walls: [
          { side: 'front', ext: 'plaster_ext', int: 'int_plaster', openings: [...four, win(4.248, 5.426, 1.711, 2.178)] },
          { side: 'back', ext: 'plaster_ext', int: 'int_plaster', openings: [...four, win(4.248, 5.426, 0.833, 2.178)] },
          { side: 'left', ext: 'plaster_ext', int: 'int_plaster', openings: [] },
          { side: 'right', ext: 'plaster_ext', int: 'int_plaster', openings: [door(-1.79, -0.913, 2.003)] },
          { side: 'inner', from: [3.6, -2.28], to: [3.6, 2.28], ext: 'int_plaster', int: 'int_plaster', openings: [door(-0.9, 0.0)] },
          { side: 'inner', from: [3.7, 0.9], to: [6.56, 0.9], ext: 'int_plaster', int: 'int_plaster', openings: [door(4.0, 4.9)] },
        ],
        furniture: [
          { id: 'old_bed_frame', x: -5.95, z: -1.25, rot: 0 },
          { id: 'old_bed_frame', x: -4.35, z: -1.25, rot: 0 },
          { id: 'old_bed_frame', x: -2.75, z: -1.25, rot: 0 },
          { id: 'old_bed_frame', x: -1.15, z: -1.25, rot: 0 },
          { id: 'old_bed_frame', x: 0.45, z: -1.25, rot: 0 },
          { id: 'old_bed_frame', x: 2.05, z: -1.25, rot: 0 },
          { id: 'painted_wooden_cabinet', x: -6.26, z: 1.2, rot: Math.PI / 2 },
          { id: 'Shelf_01', x: -3.73, z: 2.26, rot: Math.PI },
          { id: 'WoodenTable_01', x: -0.9, z: 1.5, rot: 0 },
          { id: 'painted_wooden_chair_01', x: -1.3, z: 2.02, rot: Math.PI },
          { id: 'painted_wooden_chair_01', x: -0.5, z: 0.9, rot: 0 },
          { id: 'weapons_case', x: 2.8, z: 1.9, rot: 0 },
          // the lobby
          { id: 'Shelf_01', x: 6.0, z: 0.78, rot: Math.PI },
          // the store room
          { id: 'steel_frame_shelves_01', x: 6.29, z: 1.64, rot: -Math.PI / 2, scale: 0.1 },
          { id: 'wooden_crate_01', x: 5.3, z: 1.95, rot: 0 },
        ],
        loot: [
          [-5.95, 0.48, -0.85], [-4.35, 0.48, -0.85], [-2.75, 0.48, -0.85], [-1.15, 0.48, -0.85], [0.45, 0.48, -0.85], [2.05, 0.48, -0.85],
          [-6.26, 1.2, 1.2], [-3.73, 0.44, 2.21], [-3.73, 1.24, 2.21], [-1.2, 0.57, 1.5], [-0.6, 0.57, 1.5],
          [6.0, 0.44, 0.73], [6.0, 1.24, 0.73],
          [6.29, 0.14, 1.64], [6.29, 0.74, 1.64], [6.29, 1.34, 1.64],
          [-2.0, 0.02, 0.3], [1.0, 0.02, 0.9], [-5.0, 0.02, 1.0], [4.6, 0.02, -0.6],
        ],
        usage: ['Military', 'Hunting'],
      };
    }
    case 'shed':
      return {
        w: 4, d: 3.2, h: 2.4, ext: 'planks_ext', int: 'planks', floor: 'floor_wood', roof: 'roof_iron', roofType: 'shed',
        walls: [
          { side: 'front', ext: 'planks_ext', int: 'planks', openings: [door(-0.5, 0.5)] },
          { side: 'back', ext: 'planks_ext', int: 'planks', openings: [] },
          { side: 'left', ext: 'planks_ext', int: 'planks', openings: [] },
          { side: 'right', ext: 'planks_ext', int: 'planks', openings: [win(-0.4, 0.4, 1.0, 1.8)] },
        ],
        furniture: [
          { id: 'Shelf_01', x: -0.9, z: -1.32, rot: 0 },
          { id: 'wooden_crate_01', x: 1.15, z: -1.0, rot: 0.25 },
        ],
        loot: [[-0.9, 0.44, -1.36], [-0.9, 1.24, -1.36], [1.15, 0.37, -1.0], [0.6, 0.02, 0.6]],
        usage: ['Farm', 'Industrial', 'Village'],
      };
    case 'cabin':
      return {
        w: 6, d: 5, h: 2.6, ext: 'planks_ext', int: 'planks', floor: 'floor_wood', roof: 'roof_tiles', roofType: 'gable',
        walls: [
          { side: 'front', ext: 'planks_ext', int: 'planks', openings: [door(-0.5, 0.5)] },
          { side: 'back', ext: 'planks_ext', int: 'planks', openings: [win(-1.6, -0.6)] },
          { side: 'left', ext: 'planks_ext', int: 'planks', openings: [win(-0.5, 0.5)] },
          { side: 'right', ext: 'planks_ext', int: 'planks', openings: [win(0.2, 1.0)] },
        ],
        furniture: [
          { id: 'old_bed_frame', x: 2.3, z: -1.3, rot: 0 },
          { id: 'WoodenTable_01', x: -1.5, z: 1.0, rot: Math.PI / 2 },
          { id: 'painted_wooden_chair_01', x: -0.8, z: 1.0, rot: -Math.PI / 2 },
          { id: 'wooden_bookshelf_worn', x: 0.6, z: -2.0, rot: 0 },
        ],
        loot: [[2.3, 0.48, -0.9], [-1.5, 0.57, 0.7], [-1.5, 0.57, 1.3], [0.6, 0.56, -2.0], [0.6, 1.02, -2.0], [-2.0, 0.02, -1.2]],
        usage: ['Hunting'],
      };
    case 'police':
      // lobby with the duty desk, a holding cell on the left, the armoury behind a door on the right
      return {
        w: 14, d: 9, h: 3.0, ext: 'brick_ext', int: 'int_painted', floor: 'floor_lino', roof: 'concrete', roofType: 'flat',
        walls: [
          { side: 'front', ext: 'brick_ext', int: 'int_painted', openings: [win(-6.0, -4.6), door(-0.6, 0.6), win(4.4, 5.8, 1.5, 2.1)] },
          { side: 'back', ext: 'brick_ext', int: 'int_painted', openings: [win(-1.4, -0.2, 1.5, 2.1), win(4.4, 5.6, 1.5, 2.1)] },
          { side: 'left', ext: 'brick_ext', int: 'int_painted', openings: [win(-0.6, 0.6, 1.5, 2.1)] },
          { side: 'right', ext: 'brick_ext', int: 'int_painted', openings: [] },
          { side: 'inner', from: [3.0, -4.3], to: [3.0, 4.3], ext: 'int_plaster', int: 'int_plaster', openings: [door(-1.9, -0.9)] },
          { side: 'inner', from: [-3.2, -4.3], to: [-3.2, 4.3], ext: 'int_plaster', int: 'int_plaster', openings: [door(1.2, 2.2)] },
        ],
        furniture: [
          // lobby
          { id: 'metal_office_desk', x: -0.2, z: -1.0, rot: 0 },
          { id: 'SchoolChair_01', x: 0.0, z: -1.9, rot: 0 },
          { id: 'Shelf_01', x: 1.7, z: -4.17, rot: 0 },
          { id: 'painted_wooden_cabinet', x: -1.9, z: -3.98, rot: 0 },
          { id: 'SchoolChair_01', x: -2.6, z: 3.4, rot: Math.PI / 2 },
          // armoury
          { id: 'steel_frame_shelves_01', x: 6.5, z: 0.6, rot: Math.PI / 2, scale: 0.1 },
          { id: 'steel_frame_shelves_01', x: 5.0, z: -4.02, rot: 0, scale: 0.1 },
          { id: 'weapons_case', x: 4.1, z: 3.75, rot: 0 },
          { id: 'weapons_case', x: 5.7, z: 3.75, rot: 0.05 },
          { id: 'metal_office_desk', x: 4.3, z: 0.9, rot: Math.PI / 2 },
          // holding cell
          { id: 'old_bed_frame', x: -6.25, z: -3.2, rot: 0 },
          { id: 'painted_wooden_chair_01', x: -4.0, z: 3.2, rot: 2.4 },
        ],
        loot: [
          [-0.7, 0.81, -1.0], [0.3, 0.81, -1.0],
          [1.7, 0.44, -4.2], [1.7, 1.24, -4.2], [-1.9, 1.2, -3.98],
          [6.5, 0.14, 0.2], [6.5, 0.14, 1.0], [6.5, 0.74, 0.2], [6.5, 0.74, 1.0], [6.5, 1.34, 0.2], [6.5, 1.34, 1.0],
          [4.6, 0.14, -4.02], [5.4, 0.14, -4.02], [4.6, 0.74, -4.02], [5.4, 0.74, -4.02], [4.6, 1.34, -4.02], [5.4, 1.34, -4.02],
          [4.3, 0.81, 0.5], [4.3, 0.81, 1.3],
          [5.2, 0.02, -1.6], [5.4, 0.02, 2.2], [4.0, 0.02, -2.9],
          [0.8, 0.02, 2.4], [-1.6, 0.02, 0.8], [-5.2, 0.02, 1.2], [-6.25, 0.48, -3.0],
        ],
        usage: ['Police'],
      };
    case 'clinic':
      // A feldsher's post. The waiting room and its desk inside the door; a ward of three beds
      // through the door on the left; the dispensary, which is where what a wound wants is
      // kept, behind the desk on the right.
      return {
        w: 11, d: 7.5, h: 2.9, ext: 'plaster_ext', int: 'int_painted', floor: 'floor_lino', roof: 'roof_iron', roofType: 'gable',
        walls: [
          { side: 'front', ext: 'plaster_ext', int: 'int_painted', openings: [win(-4.5, -3.3), door(1.4, 2.4), win(3.6, 4.8)] },
          { side: 'back', ext: 'plaster_ext', int: 'int_painted', openings: [win(-4.2, -3.2, 1.45, 2.1), win(-0.9, 0.1)] },
          { side: 'left', ext: 'plaster_ext', int: 'int_painted', openings: [win(-0.6, 0.6)] },
          { side: 'right', ext: 'plaster_ext', int: 'int_painted', openings: [win(0.9, 2.1)] },
          { side: 'inner', from: [-1.2, -3.55], to: [-1.2, 3.55], ext: 'int_plaster', int: 'int_painted', openings: [door(0.4, 1.4)] },
          { side: 'inner', from: [1.6, -3.55], to: [1.6, -0.8], ext: 'int_plaster', int: 'int_painted', openings: [] },
          { side: 'inner', from: [1.7, -0.9], to: [5.3, -0.9], ext: 'int_plaster', int: 'int_painted', openings: [door(1.9, 2.9)] },
        ],
        furniture: [
          // ward
          { id: 'old_bed_frame', x: -4.8, z: -2.5, rot: 0 },
          { id: 'old_bed_frame', x: -4.8, z: 1.7, rot: 0 },
          { id: 'old_bed_frame', x: -2.6, z: -2.5, rot: 0 },
          { id: 'painted_wooden_cabinet', x: -3.7, z: -3.2, rot: 0 },
          { id: 'Shelf_01', x: -2.2, z: 3.5, rot: Math.PI },
          { id: 'painted_wooden_chair_01', x: -3.5, z: 0.2, rot: 1.3 },
          // waiting room
          { id: 'metal_office_desk', x: 3.9, z: 1.4, rot: 0 },
          { id: 'SchoolChair_01', x: 3.9, z: 0.4, rot: 0 },
          { id: 'SchoolChair_01', x: -0.72, z: 2.2, rot: Math.PI / 2 },
          { id: 'SchoolChair_01', x: -0.72, z: 2.95, rot: Math.PI / 2 },
          { id: 'wooden_bookshelf_worn', x: 4.98, z: -0.1, rot: -Math.PI / 2 },
          { id: 'painted_wooden_cabinet', x: 0.85, z: -3.2, rot: 0 },
          // dispensary
          { id: 'steel_frame_shelves_01', x: 2.6, z: -3.28, rot: 0, scale: 0.1 },
          { id: 'steel_frame_shelves_01', x: 3.9, z: -3.28, rot: 0, scale: 0.1 },
          { id: 'steel_frame_shelves_01', x: 5.03, z: -2.2, rot: -Math.PI / 2, scale: 0.1 },
        ],
        loot: [
          [-4.8, 0.48, -2.1], [-4.8, 0.48, 2.1], [-2.6, 0.48, -2.1], [-3.7, 1.2, -3.2],
          [-2.2, 0.44, 3.45], [-2.2, 1.24, 3.45],
          [3.4, 0.81, 1.4], [4.4, 0.81, 1.4], [4.98, 0.56, -0.1], [4.98, 1.02, -0.1], [0.85, 1.2, -3.2],
          [2.6, 0.14, -3.28], [2.6, 0.74, -3.28], [2.6, 1.34, -3.28], [3.9, 0.14, -3.28], [3.9, 0.74, -3.28], [3.9, 1.34, -3.28],
          [5.03, 0.14, -2.2], [5.03, 0.74, -2.2], [5.03, 1.34, -2.2],
          [3.2, 0.02, -2.0], [-3.4, 0.02, 1.2], [0.3, 0.02, 1.8], [0.2, 0.02, -1.8],
        ],
        usage: ['Medic', 'Town'],
      };
    case 'store':
      // The village shop: two wide windows and the door between them, the counter across the
      // floor with the shelves behind it, and the stock room at the back with its own door out.
      return {
        w: 10, d: 7, h: 3.0, ext, int: 'int_painted', floor: 'floor_lino', roof: 'concrete', roofType: 'flat',
        walls: [
          { side: 'front', ext, int: 'int_painted', openings: [win(-4.2, -1.9, 0.8, 2.3), door(-0.6, 0.6), win(1.9, 4.2, 0.8, 2.3)] },
          { side: 'back', ext, int: 'int_plaster', openings: [door(-3.9, -2.9), win(-1.8, -0.8, 1.5, 2.1)] },
          { side: 'left', ext, int: 'int_painted', openings: [win(0.6, 1.8)] },
          { side: 'right', ext, int: 'int_painted', openings: [] },
          { side: 'inner', from: [-4.8, -1.2], to: [4.8, -1.2], ext: 'int_painted', int: 'int_plaster', openings: [door(2.6, 3.6)] },
        ],
        furniture: [
          { id: 'metal_office_desk', x: -1.9, z: 0.3, rot: 0 },
          { id: 'metal_office_desk', x: 0.15, z: 0.3, rot: 0 },
          { id: 'Shelf_01', x: -2.4, z: -1.08, rot: 0 },
          { id: 'Shelf_01', x: -1.3, z: -1.08, rot: 0 },
          { id: 'Shelf_01', x: -0.2, z: -1.08, rot: 0 },
          { id: 'Shelf_01', x: 0.9, z: -1.08, rot: 0 },
          { id: 'steel_frame_shelves_01', x: -4.53, z: -0.4, rot: Math.PI / 2, scale: 0.1 },
          { id: 'steel_frame_shelves_01', x: 4.53, z: 0.0, rot: -Math.PI / 2, scale: 0.1 },
          { id: 'steel_frame_shelves_01', x: 4.53, z: 1.3, rot: -Math.PI / 2, scale: 0.1 },
          { id: 'wooden_bookshelf_worn', x: 2.3, z: 2.1, rot: Math.PI / 2 },
          { id: 'wooden_crate_01', x: -3.9, z: 2.7, rot: 0.2 },
          { id: 'cardboard_box_01', x: -2.95, z: 2.85, rot: 0.5 },
          // stock room
          { id: 'steel_frame_shelves_01', x: 1.0, z: -3.03, rot: 0, scale: 0.1 },
          { id: 'steel_frame_shelves_01', x: 2.3, z: -3.03, rot: 0, scale: 0.1 },
          { id: 'wooden_crate_01', x: 4.1, z: -2.95, rot: 0.1 },
          { id: 'wooden_crate_01', x: -1.3, z: -2.95, rot: -0.15 },
          { id: 'cardboard_box_01', x: -0.3, z: -2.9, rot: 0.2 },
          { id: 'cardboard_box_01', x: -4.4, z: -1.9, rot: 1.4 },
        ],
        loot: [
          [-2.4, 0.81, 0.3], [-1.4, 0.81, 0.3], [-0.35, 0.81, 0.3], [0.65, 0.81, 0.3],
          [-2.4, 0.44, -1.02], [-2.4, 1.24, -1.02], [-1.3, 1.24, -1.02], [-0.2, 0.44, -1.02], [0.9, 0.44, -1.02], [0.9, 1.24, -1.02],
          [-4.53, 0.14, -0.4], [-4.53, 0.74, -0.4], [-4.53, 1.34, -0.4],
          [4.53, 0.74, 0.0], [4.53, 1.34, 0.0], [4.53, 0.14, 1.3], [4.53, 0.74, 1.3],
          [2.3, 0.56, 2.1], [2.3, 1.02, 2.1],
          [1.0, 0.14, -3.03], [1.0, 0.74, -3.03], [2.3, 0.74, -3.03], [2.3, 1.34, -3.03],
          [-3.0, 0.02, 1.8], [0.6, 0.02, 2.3], [3.5, 0.02, -2.2], [-3.0, 0.02, -2.3],
        ],
        usage: ['Town', 'Village'],
      };
    case 'barracks':
      // One long room of beds with a table to eat at, and at the end of it, behind a door, the
      // room where the arms were kept.
      return {
        w: 13, d: 6.5, h: 2.8, ext: 'brick_ext', int: 'int_plaster', floor: 'floor_concrete', roof: 'roof_iron', roofType: 'gable',
        walls: [
          { side: 'front', ext: 'brick_ext', int: 'int_plaster', openings: [win(-5.4, -4.2), win(-2.7, -1.5), door(-0.5, 0.5), win(1.5, 2.7), win(4.4, 5.6, 1.4, 2.1)] },
          { side: 'back', ext: 'brick_ext', int: 'int_plaster', openings: [win(-4.9, -3.9, 1.45, 2.1), win(-1.7, -0.7, 1.45, 2.1), win(4.4, 5.4, 1.5, 2.1)] },
          { side: 'left', ext: 'brick_ext', int: 'int_plaster', openings: [win(-0.5, 0.5)] },
          { side: 'right', ext: 'brick_ext', int: 'int_plaster', openings: [] },
          { side: 'inner', from: [3.6, -3.05], to: [3.6, 3.05], ext: 'int_plaster', int: 'int_plaster', openings: [door(0.6, 1.6)] },
        ],
        furniture: [
          { id: 'old_bed_frame', x: -5.6, z: -2.0, rot: 0 },
          { id: 'old_bed_frame', x: -4.0, z: -2.0, rot: 0 },
          { id: 'old_bed_frame', x: -2.4, z: -2.0, rot: 0 },
          { id: 'old_bed_frame', x: -0.8, z: -2.0, rot: 0 },
          { id: 'old_bed_frame', x: 0.8, z: -2.0, rot: 0 },
          { id: 'painted_wooden_cabinet', x: 2.5, z: -2.75, rot: 0 },
          { id: 'Shelf_01', x: -3.45, z: 3.03, rot: Math.PI },
          { id: 'WoodenTable_01', x: -2.6, z: 1.4, rot: 0 },
          { id: 'painted_wooden_chair_01', x: -2.9, z: 2.15, rot: Math.PI },
          { id: 'painted_wooden_chair_01', x: -2.2, z: 0.7, rot: 0 },
          { id: 'weapons_case', x: -5.95, z: 1.6, rot: Math.PI / 2 },
          // the arms room
          { id: 'steel_frame_shelves_01', x: 6.03, z: -2.0, rot: -Math.PI / 2, scale: 0.1 },
          { id: 'steel_frame_shelves_01', x: 6.03, z: -0.7, rot: -Math.PI / 2, scale: 0.1 },
          { id: 'metal_office_desk', x: 5.0, z: 2.35, rot: 0 },
          { id: 'SchoolChair_01', x: 5.0, z: 1.45, rot: 0 },
          { id: 'weapons_case', x: 4.7, z: -2.75, rot: 0 },
          { id: 'weapons_case', x: 4.0, z: -1.1, rot: Math.PI / 2 },
        ],
        loot: [
          [5.0, 0.02, 0.3], [4.9, 0.02, -1.6],
          [-5.6, 0.48, -1.6], [-4.0, 0.48, -1.6], [-2.4, 0.48, -1.6], [-0.8, 0.48, -1.6], [0.8, 0.48, -1.6],
          [2.5, 1.2, -2.75], [-3.45, 0.44, 2.98], [-3.45, 1.24, 2.98], [-2.9, 0.57, 1.4], [-2.3, 0.57, 1.4],
          [6.03, 0.14, -2.0], [6.03, 0.74, -2.0], [6.03, 1.34, -2.0], [6.03, 0.14, -0.7], [6.03, 0.74, -0.7], [6.03, 1.34, -0.7],
          [4.5, 0.81, 2.35], [5.5, 0.81, 2.35],
          [-0.4, 0.02, 1.6], [2.2, 0.02, 0.6], [-4.8, 0.02, 0.2],
        ],
        usage: ['Military'],
      };
    case 'garage':
      // A workshop: a bay a car is driven into, a bench and shelves down the other side
      return {
        w: 9, d: 7, h: 3.4, ext: 'concrete', int: 'concrete', floor: 'floor_concrete', roof: 'roof_iron', roofType: 'shed',
        walls: [
          { side: 'front', ext: 'concrete', int: 'concrete', openings: [gap(-3.7, -0.7, 2.8), door(1.7, 2.7)] },
          { side: 'back', ext: 'concrete', int: 'concrete', openings: [win(-2.9, -1.9, 1.7, 2.4), win(1.6, 2.6, 1.7, 2.4)] },
          { side: 'left', ext: 'concrete', int: 'concrete', openings: [win(-0.6, 0.6, 1.7, 2.4)] },
          { side: 'right', ext: 'concrete', int: 'concrete', openings: [win(1.4, 2.4, 1.7, 2.4)] },
        ],
        furniture: [
          ...(rng.chance(0.45) ? [{ id: 'covered_car', x: -2.2, z: 0.1, rot: 0.03 }] : []),
          { id: 'metal_office_desk', x: 3.2, z: -2.8, rot: 0 },
          { id: 'steel_frame_shelves_01', x: 4.03, z: -0.9, rot: -Math.PI / 2, scale: 0.1 },
          { id: 'steel_frame_shelves_01', x: 4.03, z: 0.35, rot: -Math.PI / 2, scale: 0.1 },
          { id: 'utility_box_01', x: 0.7, z: -3.05, rot: 0 },
          { id: 'barrel_03', x: 1.5, z: -2.9, rot: 0.6 },
          { id: 'Barrel_01', x: -4.0, z: 2.9, rot: 0 },
          // (two tyres, one on the other)
          { id: 'old_tyre', x: 3.85, z: 2.75, rot: 0.4, y: 0.08 },
          { id: 'old_tyre', x: 3.82, z: 2.78, rot: 1.5, y: 0.24 },
          { id: 'wooden_crate_01', x: 0.3, z: 2.6, rot: 0.2 },
          { id: 'wooden_ladder', x: -4.05, z: -2.2, rot: Math.PI / 2 },
        ],
        loot: [
          [2.7, 0.81, -2.8], [3.7, 0.81, -2.8],
          [4.03, 0.14, -0.9], [4.03, 0.74, -0.9], [4.03, 1.34, -0.9], [4.03, 0.14, 0.35], [4.03, 0.74, 0.35], [4.03, 1.34, 0.35],
          [-0.2, 0.02, -2.5], [1.4, 0.02, 0.8], [3.0, 0.02, 1.6], [-3.9, 0.02, -3.0],
        ],
        usage: ['Industrial'],
      };
    case 'house_two': {
      // Two floors: a kitchen and a hall below, the stairs up the right-hand wall from the
      // front of the hall to a landing at the back, and two rooms above.
      const floor: MatKey = rng.chance(0.5) ? 'floor_wood' : 'floor_lino';
      return {
        w: 9, d: 7, h: 2.8, ext, int: 'int_painted', floor, roof: rng.chance(0.6) ? 'roof_tiles' : 'roof_iron', roofType: 'gable',
        walls: [
          { side: 'front', ext, int: 'int_painted', openings: [win(-3.7, -2.6), door(-0.5, 0.5), win(1.4, 2.5)] },
          { side: 'back', ext, int: 'int_painted', openings: [win(-3.5, -2.4), win(-0.2, 0.9)] },
          { side: 'left', ext, int: 'int_painted', openings: [win(-0.6, 0.6)] },
          { side: 'right', ext, int: 'int_painted', openings: [] },
          { side: 'inner', from: [-0.9, -3.3], to: [-0.9, 3.3], ext: 'int_plaster', int: 'int_painted', openings: [door(0.9, 1.8)] },
        ],
        stairs: { x0: 3.3, x1: 4.3, foot: 1.9, top: -2.1 },
        furniture: [
          { id: 'electric_stove', x: -3.9, z: -2.95, rot: 0 },
          { id: 'painted_wooden_cabinet', x: -3.95, z: -1.9, rot: Math.PI / 2 },
          { id: 'WoodenTable_01', x: -2.7, z: 0.6, rot: 0 },
          { id: 'painted_wooden_chair_01', x: -2.5, z: 1.25, rot: Math.PI },
          { id: 'painted_wooden_chair_01', x: -3.3, z: -0.1, rot: 0.2 },
          { id: 'scandinavian_masonry_heater', x: -1.6, z: -2.6, rot: 0 },
          { id: 'Shelf_01', x: -4.05, z: 2.4, rot: Math.PI / 2 },
          { id: 'wooden_bookshelf_worn', x: 1.4, z: -3.0, rot: 0 },
          { id: 'painted_wooden_cabinet', x: -0.42, z: -1.4, rot: -Math.PI / 2 },
        ],
        loot: [
          [-3.9, 0.88, -2.95], [-3.95, 1.2, -1.9], [-2.9, 0.57, 0.6], [-2.5, 0.57, 0.6], [-4.05, 0.94, 2.4], [-4.05, 1.51, 2.4],
          [1.4, 0.67, -3.0], [1.4, 1.28, -3.0], [-0.42, 1.2, -1.4], [1.6, 0.02, 0.8], [-2.0, 0.02, 2.6],
        ],
        upper: {
          h: 2.6, int: 'int_painted', floor: 'floor_wood',
          walls: [
            { side: 'front', ext, int: 'int_painted', openings: [win(-3.7, -2.6), win(-0.6, 0.5), win(1.5, 2.6)] },
            { side: 'back', ext, int: 'int_painted', openings: [win(-3.5, -2.4), win(0.5, 1.6)] },
            { side: 'left', ext, int: 'int_painted', openings: [win(-0.6, 0.6)] },
            { side: 'right', ext, int: 'int_painted', openings: [win(-0.5, 0.6)] },
            { side: 'inner', from: [0.2, -3.3], to: [0.2, 3.3], ext: 'int_plaster', int: 'int_painted', openings: [door(-3.05, -2.15)] },
          ],
          furniture: [
            // (the far room: a bed in the corner, books, a table to sit at; nothing across the way in from the door)
            { id: 'old_bed_frame', x: -3.8, z: -2.1, rot: 0 },
            { id: 'wooden_bookshelf_worn', x: -4.02, z: 1.5, rot: Math.PI / 2 },
            { id: 'painted_wooden_cabinet', x: -1.5, z: 3.0, rot: Math.PI },
            { id: 'WoodenTable_01', x: -1.3, z: -0.3, rot: Math.PI / 2 },
            { id: 'painted_wooden_chair_01', x: -1.95, z: -0.3, rot: Math.PI / 2 },
            // (the near one, beside the stair well: the bed along the wall, a desk under the window, and room to walk between the bed and the rail)
            { id: 'old_bed_frame', x: 0.8, z: 0.2, rot: 0 },
            { id: 'Shelf_01', x: 0.44, z: 1.9, rot: Math.PI / 2 },
            { id: 'metal_office_desk', x: 1.7, z: 2.8, rot: Math.PI },
            { id: 'SchoolChair_01', x: 1.7, z: 1.95, rot: 0 },
          ],
          loot: [
            [-3.8, 0.48, -1.7], [-4.02, 0.67, 1.5], [-4.02, 1.28, 1.5], [-1.5, 1.2, 3.0], [-1.3, 0.57, -0.3],
            [0.8, 0.48, 0.5], [0.44, 0.94, 1.9], [0.44, 1.51, 1.9], [1.3, 0.81, 2.8], [2.1, 0.81, 2.8], [-2.4, 0.02, 1.0], [2.3, 0.02, -0.4], [3.8, 0.02, 2.7],
          ],
        },
        usage: ['Village', 'Town'],
      };
    }
    case 'guardpost':
    default:
      return {
        w: 4.4, d: 4.4, h: 2.6, ext: 'concrete', int: 'concrete', floor: 'floor_concrete', roof: 'concrete', roofType: 'flat',
        walls: [
          { side: 'front', ext: 'concrete', int: 'concrete', openings: [win(-2.0, -0.8, 1.1, 1.65), door(-0.5, 0.5), win(0.8, 2.0, 1.1, 1.65)] },
          { side: 'back', ext: 'concrete', int: 'concrete', openings: [win(-1.2, 1.2, 1.1, 1.65)] },
          { side: 'left', ext: 'concrete', int: 'concrete', openings: [win(-1.2, 1.2, 1.1, 1.65)] },
          { side: 'right', ext: 'concrete', int: 'concrete', openings: [win(-1.2, 1.2, 1.1, 1.65)] },
        ],
        furniture: [
          { id: 'metal_office_desk', x: 0, z: -1.6, rot: 0 },
          { id: 'SchoolChair_01', x: 0.2, z: -0.7, rot: Math.PI },
          { id: 'weapons_case', x: 1.35, z: 1.25, rot: Math.PI / 2 },
          { id: 'Shelf_01', x: -1.85, z: 0.6, rot: Math.PI / 2 },
        ],
        loot: [[-0.5, 0.81, -1.6], [0.5, 0.81, -1.6], [1.35, 0.48, 1.25], [-1.88, 0.44, 0.6], [-1.88, 1.24, 0.6], [-0.6, 0.02, 1.2]],
        usage: ['Military'],
      };
  }
}

// ------------------------------------------------------------------ geometry helpers

/** Box with UVs in metres (divided by tile), computed in the given frame so tiling is continuous. */
function boxGeo(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tile: number, frame: THREE.Matrix4) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    let u: number, v: number;
    if (ny > 0.5) { u = x; v = z; } else if (nx > 0.5) { u = z; v = y; } else { u = x; v = y; }
    uv.setXY(i, u / tile, v / tile);
  }
  g.applyMatrix4(frame);
  return g;
}

/**
 * @param paint where the wall's pattern is at the foot of it: `[along, at, up]`, the pattern running `along` (1 or -1)
 * times z from `at`, and starting `up` high. The gable carries on the courses of the wall it stands on.
 */
function prismGeo(halfBase: number, rise: number, thick: number, tile: number, frame: THREE.Matrix4, paint: [number, number, number] = [1, 0, 0]) {
  // triangle in the z/y plane, extruded along x
  const pts: [number, number][] = [[-halfBase, 0], [halfBase, 0], [0, rise]];
  const pos: number[] = [];
  const uvs: number[] = [];
  const x0 = -thick / 2, x1 = thick / 2;
  const tri = (a: number[], b: number[], c: number[]) => {
    pos.push(...a, ...b, ...c);
    for (const p of [a, b, c]) uvs.push((paint[0] * p[2] + paint[1]) / tile, (p[1] + paint[2]) / tile);
  };
  const P = (x: number, i: number) => [x, pts[i][1], pts[i][0]];
  // (each wound so that it faces out of the shape. They were wound the other way: the face seen from outside was the
  // far one, a wall's thickness back from the wall under it, and the edge of the ceiling lay in that face and flickered.)
  tri(P(x1, 0), P(x1, 2), P(x1, 1));
  tri(P(x0, 0), P(x0, 1), P(x0, 2));
  // sloped sides
  for (const [i, j] of [[1, 2], [2, 0]]) {
    tri(P(x0, i), P(x1, i), P(x1, j));
    tri(P(x0, i), P(x1, j), P(x0, j));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  g.applyMatrix4(frame);
  return g;
}

/**
 * Right-angled wedge that closes a side wall under a single-pitch roof: it runs from
 * z = 0 (no height) to z = len (full `rise`), `thick` wide along x.
 */
function wedgeGeo(len: number, rise: number, thick: number, tile: number, frame: THREE.Matrix4) {
  const pos: number[] = [];
  const uvs: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => {
    pos.push(...a, ...b, ...c);
    for (const p of [a, b, c]) uvs.push(p[2] / tile, p[1] / tile);
  };
  const x0 = -thick / 2, x1 = thick / 2;
  // outer faces (one each side), wound so both face outwards
  tri([x1, 0, 0], [x1, rise, len], [x1, 0, len]);
  tri([x0, 0, 0], [x0, 0, len], [x0, rise, len]);
  // the sloped top, in case the roof sheet ever sits proud of it
  tri([x0, 0, 0], [x0, rise, len], [x1, rise, len]);
  tri([x0, 0, 0], [x1, rise, len], [x1, 0, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  g.applyMatrix4(frame);
  return g;
}

// ------------------------------------------------------------------ containers

/**
 * A shipping container that can be gone into. Its shell is the pack's open one (2.4 m by 2.2 by 6, a leaf's
 * width left open at each end and the other half of the end plated), drawn with the props; what stops a body,
 * and the two leaves, which open and shut as doors do, are made here. `@0` is the orange one and `@1` the blue.
 */
export const CONTAINER = { id: 'container_shell', orange: 'container_shell@0', blue: 'container_shell@1', hx: 1.2, hz: 3, h: 2.2, leaf: 1.2 };

/** where a container stands, as it lies to the ground (the same as the props' pass draws it) */
export function containerMatrix(it: Instance) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot);
  if (it.lean) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(it.lean[0], 0, it.lean[1])));
  return new THREE.Matrix4().compose(new THREE.Vector3(it.x, it.lean ? it.lean[2] : it.y, it.z), q, new THREE.Vector3(1, 1, 1));
}

/** The picture the shell is painted from has two containers in it, the orange below the blue: this moves a shape from the one to the other. */
export function paintBlue(g: THREE.BufferGeometry) {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, 0.022 + (uv.getY(i) - 0.522) * 0.9776);
  uv.needsUpdate = true;
}

/** one leaf: hinge at x = 0, across to +x, painted as that half of the end is (the same picture inside as out) */
function containerLeaf(blue: boolean) {
  const g = new THREE.BoxGeometry(CONTAINER.leaf - 0.008, CONTAINER.h, 0.03);
  g.translate(CONTAINER.leaf / 2, CONTAINER.h / 2, 0);
  const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.001 + (pos.getX(i) / CONTAINER.leaf) * 0.187, 0.99 - (pos.getY(i) / CONTAINER.h) * 0.468);
  if (blue) paintBlue(g);
  return g;
}

// ------------------------------------------------------------------ doors

export class Door {
  pivot = new THREE.Group();
  body: RAPIER.RigidBody;
  open = false;
  angle = 0;
  private baseQuat = new THREE.Quaternion();
  private collider: RAPIER.Collider;
  private half: { x: number; y: number; z: number };
  /**
   * Whether it stops a body. Only a door that is shut and still does. One that is swinging
   * went through whoever was walking at it (the body is moved by hand and a moving door is
   * no obstacle to that until the two already overlap) and then held them fast for a second
   * or two; one standing open is a leaf sticking into the room to catch on. Shots, thrown
   * things and the eye are stopped by it at any angle.
   */
  private solid = true;

  /** a leaf that is hung outside what it shuts (a container's): it opens outward, whoever opens it and from where */
  private oneWay = false;

  constructor(world: THREE.Matrix4, width: number, height: number, mat: THREE.Material, handleMat: THREE.Material, public id: string, leaf?: { mesh: THREE.Object3D; surface: Surface }) {
    // pivot sits on the hinge edge; panel extends along +x
    world.decompose(this.pivot.position, this.baseQuat, new THREE.Vector3());
    this.pivot.quaternion.copy(this.baseQuat);
    if (leaf) {
      this.oneWay = true;
      this.swing = 1;
      this.pivot.add(leaf.mesh);
    } else {
      const panel = new THREE.Mesh(boxGeo(0, width - 0.02, 0, height - 0.02, -0.025, 0.025, 1.2, new THREE.Matrix4()), mat);
      panel.castShadow = panel.receiveShadow = true;
      panel.renderOrder = WALLS_FIRST;
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.05), handleMat);
      handle.position.set(width - 0.12, 1.0, 0.05);
      const handle2 = handle.clone();
      handle2.position.z = -0.05;
      this.pivot.add(panel, handle, handle2);
    }
    const R = physics.R;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(this.pivot.position.x, this.pivot.position.y, this.pivot.position.z)
        .setRotation(this.baseQuat),
    );
    this.half = { x: width / 2 - 0.02, y: height / 2, z: 0.03 };
    this.collider = physics.world.createCollider(
      R.ColliderDesc.cuboid(this.half.x, this.half.y, this.half.z).setTranslation(width / 2, height / 2, 0).setCollisionGroups(WORLD_GROUPS).setSolverGroups(WORLD_GROUPS),
      this.body,
    );
    physics.tag(this.collider, { surface: leaf?.surface ?? 'wood', owner: this });
  }

  /** shut, still, and nobody standing where the leaf is: then it is a wall. Otherwise bodies pass. */
  private settle() {
    const shut = !this.open && this.angle === 0 && this.vel === 0;
    let solid = shut;
    if (shut && !this.solid) {
      // it closed on somebody: they walk out of it before it holds anyone
      const R = physics.R;
      const at = this.collider.translation();
      const pad = new R.Cuboid(this.half.x + 0.02, this.half.y, this.half.z + 0.02);
      if (physics.world.intersectionWithShape(at, this.collider.rotation(), pad, undefined, BODY_QUERY) !== null) solid = false;
    }
    if (solid === this.solid) return;
    this.solid = solid;
    const g = solid ? WORLD_GROUPS : AJAR_GROUPS;
    this.collider.setCollisionGroups(g);
    this.collider.setSolverGroups(g);
  }

  /** +1 swings toward the door's local +z side, -1 toward -z */
  private swing = -1;
  private vel = 0;
  onMove: (opening: boolean) => void = () => {};

  /** DayZ-style: the door always swings away from whoever opens it. */
  toggle(from?: THREE.Vector3) {
    if (!this.open && from && !this.oneWay) {
      const inv = new THREE.Matrix4().compose(this.pivot.position, this.baseQuat, new THREE.Vector3(1, 1, 1)).invert();
      const local = from.clone().applyMatrix4(inv);
      this.swing = local.z > 0 ? -1 : 1;
    }
    this.open = !this.open;
    this.onMove(this.open);
  }

  /** another player moved the door: animate to that state */
  set(open: boolean, swing: number) {
    if (open && !this.open && !this.oneWay) this.swing = swing;
    this.open = open;
  }

  get swingDir() {
    return this.swing;
  }

  /** set state without animation (world load / restore) */
  setOpen(open: boolean, swing = -1) {
    this.open = open;
    if (!this.oneWay) this.swing = swing;
    this.angle = open ? this.target() : 0;
    this.vel = 0;
    this.apply(true);
    this.settle();
  }

  private target() {
    // rotation about +y by a positive angle moves the panel's free edge toward -z
    return this.open ? -this.swing * Math.PI * 0.55 : 0;
  }

  private apply(teleport = false) {
    const q = this.baseQuat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.angle));
    this.pivot.quaternion.copy(q);
    if (teleport) this.body.setRotation(q, true);
    else this.body.setNextKinematicRotation(q);
  }

  update(dt: number) {
    const target = this.target();
    const err = target - this.angle;
    if (Math.abs(err) < 1e-3 && Math.abs(this.vel) < 1e-3) {
      // at rest (a hair short of home counts as home)
      if (this.angle !== target || this.vel !== 0) {
        this.angle = target;
        this.vel = 0;
        this.apply();
      }
      if (!this.open && !this.solid) this.settle();
      return;
    }
    // damped spring: quick start, soft settle (no instant snap)
    this.vel += (err * 38 - this.vel * 10.5) * dt;
    this.vel = THREE.MathUtils.clamp(this.vel, -3.2, 3.2);
    this.angle += this.vel * dt;
    if (Math.abs(target - this.angle) < 0.002 && Math.abs(this.vel) < 0.05) {
      this.angle = target;
      this.vel = 0;
    }
    this.apply();
    this.settle();
  }
}

// ------------------------------------------------------------------ system

export class Buildings {
  lootPoints: LootPoint[] = [];
  doors: Door[] = [];
  /** interior volumes (world space OBB as center, half extents, rotation) for indoor lighting */
  interiors: { x: number; z: number; hw: number; hd: number; rot: number; y0: number; y1: number }[] = [];
  private geoms = new Map<MatKey, THREE.BufferGeometry[]>();

  constructor(private world: World, private atmo: Atmosphere) {}

  /** Generates layouts; pushes furniture / yard props into world.props so they get instanced. */
  plan() {
    for (const plot of this.world.buildings) {
      // (for scripts/overlap-audit.ts: every piece of the first building of each kind, as it is laid)
      if (this.pieces && !this.piecesOf.has(plot.type)) {
        this.piecesOf.add(plot.type);
        this.noting = { type: plot.type, x: plot.x, y: plot.floorY, z: plot.z, rot: plot.rot };
      }
      this.planBuilding(plot);
      this.noting = null;
    }
    this.planVillageProps();
    this.planSiteProps();
    // what is kept under the gas is marked so: there are things that lie nowhere else (see the economy)
    const gas = gasZone(this.world.pois, (x, z) => heightAt(this.world.heights, x, z));
    for (const p of this.lootPoints) if (gasDepth(gas, p.x, p.y, p.z) > GAS.breathe) p.usage = [...p.usage, 'Gas'];
    // and what is kept in Kamenka, the town in the east, is marked so too: it is stocked on its own (see `east` in the economy)
    for (const p of this.lootPoints) if (Math.hypot(p.x - TOWN.x, p.z - TOWN.z) < TOWN.stocked) p.usage = [...p.usage, 'East'];
    // The bunker: what stands in its rooms, and its places for things. After every other, so
    // that none of those is renumbered. Its places are of no kind of building: only what is
    // said to be kept in the bunker lies there.
    const at = bunkerPlace(this.world);
    if (at) {
      const plan = bunkerPlan(), Y = levelY();
      const point = (r: number, f: number, y: number, floor: boolean, surf?: LootPoint['surf']) => {
        const [x, wy, z] = bunkerAt(at, r, f, y);
        // (on the floor a thing lies a finger over it, as everywhere; on a table or a shelf it lies ON it: that
        // finger, and a mess table whose top was taken to be a metre up, had things hanging in the air over them)
        this.lootPoints.push({ x, y: wy + (floor ? 0.02 : 0.003), z, usage: ['Bunker'], building: 'bunker', floor, ...(surf ? { surf } : {}) });
      };
      for (const st of plan.stood) {
        const [x, y, z] = bunkerAt(at, st.r, st.f, Y + (st.y ?? 0));
        this.world.props.push({ kind: st.id, x, y, z, rot: st.rot + at.rot, scale: st.scale ?? 1, far: 46 });
        const e = assets.manifest.models[st.id];
        if (!st.on || !e || CRATE_KINDS.has(st.id)) continue;
        // where things are kept on it: on its top, or on each of its boards; two side by side where it is long enough
        const k = st.scale ?? 1;
        const [ix, iz] = SURFACE_INSET[st.id] ?? [0.05, 0.05];
        const hx = ((e.max[0] - e.min[0]) / 2) * k - ix, hz = ((e.max[2] - e.min[2]) / 2) * k - iz;
        const levels = SHELF_LEVELS[st.id];
        const c = Math.cos(st.rot), sn = Math.sin(st.rot);
        for (const h of st.on) {
          const ly = TOP_SURFACE.has(st.id) ? e.max[1] * k : levels ? levels.reduce((best, l) => (Math.abs(l - h) < Math.abs(best - h) ? l : best)) * k : h;
          const along = hx >= hz, n = (along ? hx : hz) > 0.62 ? 2 : 1, L = along ? hx : hz;
          for (let i = 0; i < n; i++) {
            const centre = -L + ((2 * i + 1) * L) / n;
            const ox = along ? centre : 0, oz = along ? 0 : centre;
            const r = st.r + ox * c + oz * sn, f = st.f - ox * sn + oz * c;
            const [sx, , sz] = bunkerAt(at, r, f);
            point(r, f, Y + (st.y ?? 0) + ly, false, { x: sx, z: sz, rot: st.rot + at.rot, hx: along ? L / n : hx, hz: along ? hz : L / n, clear: SHELF_CLEARANCE[st.id] ?? 10 });
          }
        }
      }
      for (const sp of plan.spots) point(sp.r, sp.f, sp.y, sp.floor);
    }
    // The leaves of the containers, one at each end: after every other door, so that none of those is renumbered.
    const lot = new RNG(4471);
    this.containers.forEach((it, n) => {
      const m = containerMatrix(it);
      const { hx, hz, h, leaf } = CONTAINER;
      const ends = [new THREE.Matrix4().makeTranslation(-hx, 0, hz - 0.015), new THREE.Matrix4().makeTranslation(hx, 0, -hz + 0.015).multiply(new THREE.Matrix4().makeRotationY(Math.PI))];
      ends.forEach((e, k) => this.doorSpecs.push({ m: m.clone().multiply(e), w: leaf, h, id: `container${n}_${k}`, open: lot.chance(0.5), swing: 1, leaf: it.kind === CONTAINER.blue ? 1 : 0 }));
    });
  }

  /** buildings whose outsides are models: which, and where each stands */
  private shells: { model: string; m: THREE.Matrix4; /** it is solid as it is drawn: every triangle of it stops a body, and sounds like this */ solid?: Surface }[] = [];

  /** the containers that stand about, in the order they were stood (their leaves are doors: see the end of `plan`) */
  containers: Instance[] = [];

  /**
   * A container is laid to the ground as a car is, but not let into it: it is gone into, and ground coming up
   * through its floor would be seen. It rests on the highest ground under it. And a crate is put in it, against
   * the wall at the plated half of one end, to be searched.
   */
  private standContainer(it: Instance) {
    const H = this.world.heights, c = Math.cos(it.rot), sn = Math.sin(it.rot);
    const at = (lx: number, lz: number) => heightAt(H, it.x + lx * c + lz * sn, it.z - lx * sn + lz * c);
    const { hx, hz } = CONTAINER;
    const f = at(0, hz), b = at(0, -hz), l = at(-hx, 0), r = at(hx, 0);
    const nose = -Math.atan2(f - b, 2 * hz), roll = Math.atan2(r - l, 2 * hx);
    const y = (f + b + l + r) / 4;
    let up = -Infinity;
    for (const lx of [-hx, 0, hx]) for (const lz of [-hz, -hz / 2, 0, hz / 2, hz]) up = Math.max(up, at(lx, lz) - (y + lx * Math.sin(roll) - lz * Math.sin(nose)));
    it.lean = [nose, roll, y + up];
    this.containers.push(it);
    // No grass in it, nor at the foot of its walls. (The map of where grass grows is coarse, a point every two
    // metres and the blades thinned between points: cleared any less far out, blades stood up through the floor.)
    const half = WORLD_SIZE / 2, reach = Math.hypot(hx, hz) + 3;
    for (let ix = Math.floor((it.x - reach + half) / CELL); ix <= Math.ceil((it.x + reach + half) / CELL); ix++) {
      for (let iz = Math.floor((it.z - reach + half) / CELL); iz <= Math.ceil((it.z + reach + half) / CELL); iz++) {
        if (ix < 0 || iz < 0 || ix >= WORLD_RES || iz >= WORLD_RES) continue;
        const dx = -half + ix * CELL - it.x, dz = -half + iz * CELL - it.z;
        if (Math.abs(dx * c - dz * sn) < hx + 2.7 && Math.abs(dx * sn + dz * c) < hz + 2.7) this.world.grass[idx(ix, iz)] = 0;
      }
    }
    const e = assets.manifest.models.wooden_crate_01;
    const deep = e ? e.max[2] - e.min[2] : 0.41, long = e ? e.max[0] - e.min[0] : 0.83;
    const p = new THREE.Vector3(hx - 0.04 - deep / 2 - 0.05, 0.02, hz - 0.05 - long / 2 - 0.5).applyMatrix4(containerMatrix(it));
    this.world.props.push({ kind: 'wooden_crate_01', x: p.x, y: p.y, z: p.z, rot: it.rot + Math.PI / 2, scale: 1 });
  }

  /** What stands in the yard of each outlying place: crates to search, and what makes it look lived in. */
  private planSiteProps() {
    const rng = new RNG(9173);
    const inBuilding = (x: number, z: number, pad: number) =>
      this.world.buildings.some((b) => {
        const [w, d] = BUILDING_FOOTPRINT[b.type];
        const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot);
        return Math.abs(dx * c - dz * s) < w / 2 + pad && Math.abs(dx * s + dz * c) < d / 2 + pad;
      });
    // [kind, right, forward] in the site's own frame (forward = the way its doors face)
    // (a container is also told which way it lies: its length to the site's forward, turned so much)
    const DRESSING: Record<SiteKind, [string, number, number, number?][]> = {
      lodge: [['stone_fire_pit', -3.5, 7], ['wooden_crate_01', 4, 6.5], ['Barrel_01', 5.2, 5.8], ['dry_branches_medium_01', -6, 9]],
      farm: [['wooden_crate_01', 2, 6], ['wooden_crate_01', 3.2, 6.6], ['old_tyre', -1, 7.5], ['barrel_03', 15, 6], ['covered_car', -14, -8]],
      post: [['concrete_road_barrier', -4, 9], ['concrete_road_barrier', 0, 10], ['concrete_road_barrier', 4, 9], ['weapons_case', 5.5, 3], ['weapons_case', 6.6, 1.2], ['Barrel_01', -4.5, -6]],
      yard: [['wooden_crate_01', -4, 8], ['wooden_crate_01', -5.4, 8.6], ['wooden_crate_01', 5, 9], ['Barrel_01', 7, 8], ['barrel_03', 7.9, 8.9], ['old_tyre', 2, 11], ['dry_branches_medium_01', -9, 11], [CONTAINER.orange, -18, 12, 0.3]],
      dacha: [['covered_car', 9, -6], ['wooden_crate_01', -7, 5], ['metal_trash_can@0', -6.2, 3.4], ['trashbag', -8, 3]],
      hamlet: [['wooden_crate_01', -6.5, 6], ['wooden_crate_01', -7.6, 6.8], ['metal_trash_can@1', 6.5, 5.2], ['trashbag', 7.6, 5.6], ['old_tyre', 3, 8.5], ['covered_car', 8.5, 9.5], ['stone_fire_pit', -3, -8], ['Barrel_01', -11, -14]],
      // the trading post: what he has not yet got indoors, a car under its sheet, and the way in marked off
      // (no crate that can be searched, and no barrel with something left on its lid: nothing here is for the taking)
      market: [['cardboard_box_01', -5, 6], ['cardboard_box_01', -6.1, 6.8], ['Barrel_01', 6.5, 5.5], ['Barrel_01', 7.7, 6.3], ['covered_car', -12.5, -3], ['concrete_road_barrier', -4, 12], ['concrete_road_barrier', 4, 12.6], ['old_tyre', 9.5, 8.5], ['trashbag', 8.6, -4], [CONTAINER.orange, -15.5, 9, 0.12], [CONTAINER.blue, 17.5, 5, Math.PI / 2 - 0.1], ['crate_big', 9.2, 2.2], ['crate_big', 10.4, 2.6]],
      depot: [[CONTAINER.blue, -24, 9, 0.08], [CONTAINER.orange, 25, 23, Math.PI / 2 + 0.1], ['crate_big', 9, 8], ['concrete_road_barrier', -5, 11.5], ['concrete_road_barrier', 0, 12.5], ['concrete_road_barrier', 5, 11.5], ['weapons_case', 5.5, 3.6], ['weapons_case', 6.7, 2], ['Barrel_01', -8, 5.5], ['Barrel_01', -8.9, 6.3], ['old_tyre', -12.5, 7.5], ['covered_car', -4, 8]],
      // The works (forward is the way in, the track coming up the middle of the yard). Blocks
      // across the gate with a lorry's width left between them; drums wherever drums were
      // filled, most of them the blue sort and a few that burn; the army's cases in front of
      // the office, where they were being loaded when it was left; and what a yard has.
      works: [
        ['concrete_road_barrier', -6.5, 74], ['concrete_road_barrier', -10.5, 75], ['concrete_road_barrier', 7.5, 76], ['concrete_road_barrier', 11.5, 77],
        ['weapons_case', -5.5, -37.5], ['weapons_case', -6.9, -36.2], ['weapons_case', 6.2, -38], ['wooden_military_crate', 8.4, -36.6], ['old_military_crate@0', -9.5, -38.4], ['old_military_crate@1', 10.8, -38.2],
        ['barrel_03', -22, 3], ['barrel_03', -21, 4.4], ['Barrel_01', -23.3, 4.3], ['barrel_03', -22.4, 15], ['barrel_03', -21.2, 16.2],
        ['barrel_03', 21.5, 28], ['Barrel_01', 22.7, 29.1], ['barrel_03', 20.9, 30.3], ['barrel_03', 22.2, 41], ['Barrel_01', 21, 42.2],
        ['barrel_03', -43, -31], ['barrel_03', -41.7, -30.2], ['Barrel_01', -43.4, -29.4], ['barrel_03', 44, -37], ['barrel_03', 45.2, -36],
        ['wooden_crate_01', 22.5, 1], ['wooden_crate_01', 23.8, 2.2], ['wooden_crate_01', -22, 31], ['wooden_crate_01', -21, 44],
        ['covered_car', -11, 22], ['covered_car', 12.5, -6], ['covered_car', 14, 50],
        ['utility_box_01', -25, 24], ['utility_box_01', 25.5, 15], ['metal_trash_can@1', 24.5, -8], ['trashbag', 25.6, -9.2], ['old_tyre', -17, 33], ['old_tyre', 16, 20], ['old_tyre', -14, -26],
      ],
      bunker: [],
      // Kamenka: cars left in the street, what a shop and a workshop put out, the way out of town shut with blocks,
      // and two containers in the yard behind the workshop
      town: [
        ['covered_car', 5.3, -36], ['covered_car', -5.4, 30], ['covered_car', 5.2, 78], ['covered_car', -5.3, -70],
        ['concrete_road_barrier', -2.2, 93.5, 0], ['concrete_road_barrier', 2.4, 94.5, 0],
        ['wooden_crate_01', 17, -51], ['cardboard_box_01', 16.2, -38.5], ['Barrel_01', 17.2, -37.5], ['metal_trash_can@1', 5.6, 2], ['trashbag', 5.9, 3.2],
        ['old_tyre', 17.5, 61], ['Barrel_01', 17.8, 72], ['barrel_03', 18.9, 73], ['weapons_case', 18.5, 22],
        [CONTAINER.orange, 27, 80, 0.15], [CONTAINER.blue, 24, -74, Math.PI / 2], ['crate_big', 22, 76], ['crate_big', 23.2, 77],
        ['metal_trash_can@0', -5.7, -14], ['trashbag', -6.4, 46], ['stone_fire_pit', -25, 24], ['dry_branches_medium_01', 26, 44],
        ['wooden_crate_01', -24, -27], ['Barrel_01', -25, 6], ['old_tyre', -23, 47], ['wooden_crate_01', 26, -14],
      ],
      // the squat: a fire, drums, what was dragged there
      squat: [['stone_fire_pit', 7.5, 13], ['Barrel_01', -7.5, 10], ['barrel_03', -8.4, 11.2], ['wooden_crate_01', 8, 9], ['old_tyre', 9, 4], ['dry_branches_medium_01', -5, 15], ['covered_car', -11, -2]],
      // the camp: containers, crates, a fire between the huts
      camp: [[CONTAINER.orange, 20, -12, 0.2], [CONTAINER.blue, -24, -2, Math.PI / 2 + 0.2], ['stone_fire_pit', 1, 4], ['wooden_crate_01', -3, 8], ['wooden_crate_01', -4.2, 8.8], ['Barrel_01', 4, -12], ['crate_big', 18, 2], ['old_tyre', -8, 16], ['dry_branches_medium_01', 6, 16]],
    };
    for (const st of this.world.sites) {
      const c = Math.cos(st.rot), s = Math.sin(st.rot);
      for (const [kind, right, fwd, turned] of DRESSING[st.kind]) {
        const x = st.x + right * c + fwd * s, z = st.z - right * s + fwd * c;
        const box = kind.startsWith(CONTAINER.id);
        if (inBuilding(x, z, kind === 'covered_car' ? 2.6 : box ? 3.3 : 1.1)) continue;
        // nor on top of what already lies in the yard
        const room = kind === 'covered_car' ? 3.2 : box ? 3.4 : 1.15;
        if (this.world.props.some((q) => !q.far && Math.hypot(q.x - x, q.z - z) < (q.kind.startsWith('covered_car') ? 3.2 : room))) continue;
        const turn = kind === 'concrete_road_barrier' ? st.rot + Math.atan2(right, 9) * 0.6 : kind === 'covered_car' ? st.rot + rng.range(-0.3, 0.3) : turned !== undefined ? st.rot + turned : rng.range(0, Math.PI * 2);
        const it: Instance = { kind, x, y: heightAt(this.world.heights, x, z) + (kind === 'old_tyre' ? 0.08 : 0), z, rot: turn, scale: 1 };
        this.world.props.push(it);
        if (box) this.standContainer(it);
      }
    }
  }

  /** set to an empty list before `plan()` to have every piece of one building of each kind noted in it (see scripts/overlap-audit.ts) */
  pieces: { type: string; x: number; y: number; z: number; rot: number; key: string; geo: THREE.BufferGeometry }[] | null = null;
  private piecesOf = new Set<string>();
  private noting: { type: string; x: number; y: number; z: number; rot: number } | null = null;

  private push(key: MatKey, g: THREE.BufferGeometry) {
    if (this.noting) this.pieces!.push({ ...this.noting, key, geo: g });
    if (!this.geoms.has(key)) this.geoms.set(key, []);
    this.geoms.get(key)!.push(g);
  }

  private tile(key: MatKey) {
    return key === 'glass' ? 1 : MATS[key].tile;
  }

  private collider(hx: number, hy: number, hz: number, m: THREE.Matrix4, surface: Surface, groups?: number) {
    if (!physics.world) return; // planning only (server): no collision world
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(p, q, s);
    physics.addStaticQuat(physics.R.ColliderDesc.cuboid(hx, hy, hz), surface, p, q, undefined, groups);
  }

  /**
   * Outside a doorway the ground lies a hand's breadth under the floor. A body's round foot rode
   * that lip like a steep bank and lost most of its pace for a few steps at every doorway.
   * An unseen ramp carries it up instead, from the ground half a pace out to the floor's edge
   * in the middle of the wall. It stops feet and nothing else: loot, grenades and bullets go
   * through it to the ground and the wall behind.
   * @param F the wall's frame (x along it, z outward), a..b the opening along x
   */
  private doorstep(F: THREE.Matrix4, a: number, b: number) {
    const DROP = 0.11, LEN = 0.6, HALF = 0.03;
    const tilt = Math.atan2(DROP, LEN);
    const m = new THREE.Matrix4()
      .makeTranslation((a + b) / 2, -DROP / 2 - HALF * Math.cos(tilt), LEN / 2 - HALF * Math.sin(tilt))
      .multiply(new THREE.Matrix4().makeRotationX(tilt));
    this.collider((b - a) / 2 + 0.3, HALF, Math.hypot(DROP, LEN) / 2, F.clone().multiply(m), 'wood', GLASS_GROUPS);
  }

  private planBuilding(plot: BuildingPlot) {
    if (plot.type === 'tower') return this.planTower(plot);
    const rng = new RNG(plot.seed);
    const firstPoint = this.lootPoints.length;
    const bp = blueprint(plot.type, rng);
    const B = new THREE.Matrix4().compose(
      new THREE.Vector3(plot.x, plot.floorY, plot.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), plot.rot),
      new THREE.Vector3(1, 1, 1),
    );
    const { w, d, h } = bp;
    const hw = w / 2, hd = d / 2;
    this.interiors.push({ x: plot.x, z: plot.z, hw: hw - T, hd: hd - T, rot: plot.rot, y0: plot.floorY - 0.2, y1: plot.floorY + (bp.upper ? h + SLAB + bp.upper.h : h) });

    // foundation + floor + ceiling
    const surf = (k: MatKey): Surface => (k === 'glass' ? 'glass' : MATS[k].surface);
    const addBox = (key: MatKey, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, frame: THREE.Matrix4, collide = true, groups?: number) => {
      this.push(key, boxGeo(x0, x1, y0, y1, z0, z1, this.tile(key), frame));
      if (collide) {
        const c = new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        this.collider((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, frame.clone().multiply(c), surf(key), groups);
      }
    };
    // (under a model, a finger inside its plinth: in the plane of that, the two flickered)
    const proud = bp.shell ? 0.06 : 0.08;
    if (bp.whole) {
      // (all of it is the model's: under it only a pad, for ground that falls away from its foot, as low as the model's own ground)
      addBox('concrete', -hw - 0.04, hw + 0.04, -1.4, -bp.whole.lift - 0.03, -hd - 0.04, hd + 0.04, B);
      this.shells.push({ model: bp.whole.model, m: B.clone().multiply(new THREE.Matrix4().makeTranslation(0, -bp.whole.lift, 0)), solid: bp.whole.surface });
      bp.whole.doors.forEach((dr, k) => {
        const hinge = B.clone().multiply(new THREE.Matrix4().makeTranslation(dr.x, dr.y, dr.z)).multiply(new THREE.Matrix4().makeRotationY(dr.rot));
        this.doorSpecs.push({ m: hinge, w: dr.w, h: dr.h, id: `${plot.id}_door${k}`, open: rng.chance(0.4), swing: rng.chance(0.5) ? 1 : -1 });
      });
    } else {
      addBox('concrete', -hw - proud, hw + proud, -1.4, -0.1, -hd - proud, hd + proud, B);
      addBox(bp.floor, -hw + T * 0.5, hw - T * 0.5, -0.12, 0, -hd + T * 0.5, hd - T * 0.5, B);
    }
    // (how high the walls stand in all: one floor, or two with the floor between them)
    const H = bp.upper ? h + SLAB + bp.upper.h : h;
    if (bp.roofType !== 'flat' && !bp.whole) addBox(bp.upper?.int ?? bp.int, -hw + T, hw - T, H, H + 0.08, -hd + T, hd - T, B, false);

    // walls: of one floor, whose foot is at y0 and which is h high
    const outside: { F: THREE.Matrix4; a: number; b: number; front: boolean }[] = [];
    const panes: { F: THREE.Matrix4; a: number; b: number; bottom: number; top: number; L: number }[] = [];
    /** @param under how high a wall between two rooms goes, when a floor is laid over it (the outside walls go on up past the floor's edge) */
    const raise = (walls: WallDef[], y0: number, tall: number, under = tall) => {
      for (const wd of walls) {
        // (a wall between rooms stops under the floor above: carried up through it, its top lay in the same plane as the boards and the two flickered through each other)
        const h = wd.side === 'inner' ? under : tall;
        let a: THREE.Vector2, b: THREE.Vector2;
        switch (wd.side) {
          case 'front': a = new THREE.Vector2(-hw, hd - T / 2); b = new THREE.Vector2(hw, hd - T / 2); break;
          case 'back': a = new THREE.Vector2(hw, -hd + T / 2); b = new THREE.Vector2(-hw, -hd + T / 2); break;
          case 'left': a = new THREE.Vector2(-hw + T / 2, -hd + T); b = new THREE.Vector2(-hw + T / 2, hd - T); break;
          case 'right': a = new THREE.Vector2(hw - T / 2, hd - T); b = new THREE.Vector2(hw - T / 2, -hd + T); break;
          default: a = new THREE.Vector2(...wd.from!); b = new THREE.Vector2(...wd.to!);
        }
        const dir = b.clone().sub(a);
        const L = dir.length();
        dir.normalize();
        // wall frame: x along wall, y up, z outward
        const W = new THREE.Matrix4().makeBasis(
          new THREE.Vector3(dir.x, 0, dir.y),
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(-dir.y, 0, dir.x),
        ).setPosition(a.x, y0, a.y);
        const F = B.clone().multiply(W);
        // openings are given in building-local coordinates on the wall's axis
        const axisCoord = (v: number) => {
          // project a building-local coordinate onto "distance from a"
          if (Math.abs(dir.x) > 0.5) return (v - a.x) * Math.sign(dir.x);
          return (v - a.y) * Math.sign(dir.y);
        };
        const ops = wd.openings
          .map((o) => {
            const p0 = axisCoord(o.a), p1 = axisCoord(o.b);
            return { ...o, a: Math.min(p0, p1), b: Math.max(p0, p1) };
          })
          .sort((x, y) => x.a - y.a);
        if (wd.side !== 'inner' && y0 === 0 && !bp.shell) {
          // a skirt of concrete where the wall meets the ground, broken at the doors
          let from = 0;
          const skirt = (to: number) => to - from > 0.05 && addBox('concrete', from, to, -0.1, 0.26, T / 2, T / 2 + 0.04, F, false);
          for (const o of ops) {
            if (o.kind === 'window') continue;
            skirt(o.a);
            from = o.b;
          }
          skirt(L);
        }
        {
          // a board along the foot of the wall indoors (on both faces of a wall between two rooms), broken at the doors
          let from = 0;
          const board = (to: number) => {
            if (to - from < 0.08) return;
            addBox('trim', from, to, 0, 0.085, -T / 2 - 0.014, -T / 2, F, false);
            if (wd.side === 'inner') addBox('trim', from, to, 0, 0.085, T / 2, T / 2 + 0.014, F, false);
          };
          for (const o of ops) {
            if (o.kind === 'window') continue;
            board(o.a);
            from = o.b;
          }
          board(L);
        }
        const layers: [MatKey, number, number][] = [
          [wd.int, -T / 2, 0],
          [wd.ext, 0, T / 2],
        ];
        for (const [key, z0, z1] of layers) {
          // (Where the outside is a model's, the outer half of the wall is there to stop a body and is not drawn. And
          // the inner half stands a hair back from each opening: its ends lay in the sides of the model's, and flickered.)
          const modelled = !!bp.shell && wd.side !== 'inner';
          const drawn = !(modelled && z1 > 0), e = modelled ? 0.006 : 0;
          const part = (x0: number, x1: number, ya: number, yb: number) => {
            if (x1 - x0 < 0.001 || yb - ya < 0.001) return;
            if (drawn) addBox(key, x0, x1, ya, yb, z0, z1, F);
            else this.collider((x1 - x0) / 2, (yb - ya) / 2, (z1 - z0) / 2, F.clone().multiply(new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (ya + yb) / 2, (z0 + z1) / 2)), surf(key));
          };
          let cur = 0;
          for (const o of ops) {
            if (o.a > cur) part(cur, o.a - e, 0, h);
            if (o.top < h) part(o.a - e, o.b + e, o.top + e, h);
            if (o.bottom > 0) part(o.a - e, o.b + e, 0, o.bottom - e);
            cur = o.b + e;
          }
          if (cur < L) part(cur, L, 0, h);
        }
        // frames, glass, doors
        for (const o of ops) {
          // (a model's doorway is as wide as it is: a thin frame, that the door left in it is one a body goes through)
          const fw = bp.shell && o.kind === 'door' && wd.side !== 'inner' ? 0.035 : 0.07;
          const fz0 = -T / 2 - 0.01, fz1 = T / 2 + 0.01;
          addBox('trim', o.a, o.a + fw, o.bottom, o.top, fz0, fz1, F, false);
          addBox('trim', o.b - fw, o.b, o.bottom, o.top, fz0, fz1, F, false);
          addBox('trim', o.a, o.b, o.top - fw, o.top, fz0, fz1, F, false);
          if (o.kind === 'window') {
            addBox('trim', o.a - 0.04, o.b + 0.04, o.bottom - 0.04, o.bottom + 0.02, fz0 - 0.04, fz1 + 0.06, F, false);
            addBox('trim', (o.a + o.b) / 2 - 0.025, (o.a + o.b) / 2 + 0.025, o.bottom, o.top, -0.03, 0.03, F, false);
            addBox('trim', o.a, o.b, (o.bottom + o.top) / 2 + 0.15, (o.bottom + o.top) / 2 + 0.2, -0.03, 0.03, F, false);
            if (rng.chance(0.7)) {
              this.push('glass', boxGeo(o.a + fw, o.b - fw, o.bottom, o.top - fw, -0.006, 0.006, 1, F));
            }
            // windows block movement but not bullets
            const c = new THREE.Matrix4().makeTranslation((o.a + o.b) / 2, (o.bottom + o.top) / 2, 0);
            this.collider((o.b - o.a) / 2, (o.top - o.bottom) / 2, 0.05, F.clone().multiply(c), 'glass', GLASS_GROUPS);
          } else if (o.kind === 'door') {
            const hinge = F.clone().multiply(new THREE.Matrix4().makeTranslation(o.a + fw, 0, 0));
            this.doorSpecs.push({ m: hinge, w: o.b - o.a - fw * 2, h: o.top - fw, id: `${plot.id}_door${this.doorSpecs.length}`, open: rng.chance(0.35), swing: rng.chance(0.5) ? 1 : -1 });
          }
          // (a barn's open front has the same lip as a door)
          if (o.kind !== 'window' && wd.side !== 'inner' && y0 === 0) {
            this.doorstep(F, o.a, o.b);
            outside.push({ F, a: o.a, b: o.b, front: wd.side === 'front' });
          }
          if (o.kind === 'window' && wd.side !== 'inner') panes.push({ F, a: o.a, b: o.b, bottom: o.bottom, top: o.top, L });
        }
      }
    };
    // (under a floor above, the walls go on up past the edge of it: the outside of the house is one wall from the ground to the roof)
    raise(bp.walls, 0, bp.upper ? h + SLAB : h, h);

    // --- the floor above, and the stairs to it
    if (bp.upper && bp.stairs) {
      const up = bp.upper, st = bp.stairs;
      const y1 = h + SLAB;
      const zmin = Math.min(st.top, st.foot), zmax = Math.max(st.top, st.foot), dz = Math.sign(st.top - st.foot);
      // the floor between the two: all of it but the well the stairs come up through
      const slab = (xa: number, xb: number, za: number, zb: number) => xb - xa > 0.02 && zb - za > 0.02 && addBox(up.floor, xa, xb, h, y1, za, zb, B);
      const x0i = -hw + T, x1i = hw - T, z0i = -hd + T, z1i = hd - T;
      slab(x0i, st.x0, z0i, z1i);
      slab(st.x1, x1i, z0i, z1i);
      slab(st.x0, st.x1, z0i, zmin);
      slab(st.x0, st.x1, zmax, z1i);
      const L = zmax - zmin, xc = (st.x0 + st.x1) / 2;
      // (off the head of them: onto the landing and round the end of the rail, into the room)
      const { rise, run } = this.flight(B, plot.id, st, 0, y1, [st.x1 > hw - T - 0.1 ? st.x0 - 0.8 : st.x1 + 0.8, st.top + dz * 0.6]);
      // under it the space is boarded in: solid to everything
      for (let k = 1; k < 4; k++) {
        const za = st.foot + dz * (k / 4) * L, zb = st.foot + dz * ((k + 1) / 4) * L;
        const top = (k / 4) * y1 - 0.12;
        this.collider((st.x1 - st.x0) / 2 - 0.02, top / 2, Math.abs(zb - za) / 2, B.clone().multiply(new THREE.Matrix4().makeTranslation(xc, top / 2, (za + zb) / 2)), 'wood');
      }
      // (which side of it is open to the room: the other is against a wall)
      const open = st.x1 > hw - T - 0.1 ? st.x0 : st.x1, away = open === st.x0 ? -1 : 1;
      this.push('planks', wedgeGeo(L, y1 - rise, 0.04, this.tile('planks'), B.clone().multiply(new THREE.Matrix4().makeTranslation(open, 0, st.foot)).multiply(new THREE.Matrix4().makeRotationY(dz < 0 ? Math.PI : 0))));
      // and its tall end, under the head of the flight, is boarded too: from behind, the
      // backs of the steps were seen, and the hollow under them
      this.push('planks', boxGeo(st.x0, st.x1, 0, h, Math.min(st.top, st.top + dz * 0.04), Math.max(st.top, st.top + dz * 0.04), this.tile('planks'), B));
      // rails: up the open side of the flight, and round the well on the floor above
      this.rail(B, open + away * 0.035, st.foot, open + away * 0.035, st.top, rise, y1);
      this.rail(B, open + away * 0.035, st.foot + dz * run, open + away * 0.035, st.top - dz * 0.02, y1, y1);
      this.rail(B, st.x0, st.foot + dz * run, st.x1, st.foot + dz * run, y1, y1);
      raise(up.walls, y1, up.h);
    }

    // --- what makes the outside of it a place somebody built
    const lived = plot.type === 'house_small' || plot.type === 'house_brick' || plot.type === 'house_two' || plot.type === 'cabin';
    // (dice of its own: nothing here may take a throw from the ones the yard is laid out with)
    const rq = new RNG(plot.seed ^ 0x51ed5);
    for (const o of outside) {
      // a step at each door
      addBox('concrete', o.a - 0.22, o.b + 0.22, -0.14, -0.012, T / 2, T / 2 + 0.72, o.F, false);
      if (!o.front || !(lived || plot.type === 'clinic' || plot.type === 'store')) continue;
      // and over the front one a little roof on two brackets
      const mid = (o.a + o.b) / 2, half = (o.b - o.a) / 2 + 0.42;
      const C = o.F.clone().multiply(new THREE.Matrix4().makeTranslation(mid, 2.3, T / 2)).multiply(new THREE.Matrix4().makeRotationX(0.3));
      this.push(bp.roof, boxGeo(-half, half, 0.02, 0.07, 0, 0.95, this.tile(bp.roof), C));
      for (const sx of [-1, 1]) {
        this.push('trim', boxGeo(sx * (half - 0.12) - 0.03, sx * (half - 0.12) + 0.03, -0.03, 0.02, 0, 0.9, this.tile('trim'), C));
        addBox('trim', mid + sx * (half - 0.12) - 0.03, mid + sx * (half - 0.12) + 0.03, 1.85, 2.3, T / 2, T / 2 + 0.05, o.F, false);
      }
    }
    if (lived && rq.chance(0.6)) {
      // shutters, hung open either side of each window
      for (const p of panes) {
        const wide = Math.min(0.42, (p.b - p.a) / 2);
        if (p.a - wide < 0.12 || p.b + wide > p.L - 0.12) continue;
        addBox('trim', p.a - wide, p.a - 0.03, p.bottom - 0.03, p.top + 0.03, T / 2 + 0.012, T / 2 + 0.042, p.F, false);
        addBox('trim', p.b + 0.03, p.b + wide, p.bottom - 0.03, p.top + 0.03, T / 2 + 0.012, T / 2 + 0.042, p.F, false);
      }
    }
    if (lived && bp.roofType === 'gable') {
      // a chimney, up through the slope from the stove's side of the house
      const cx = (rq.chance(0.5) ? -1 : 1) * hw * 0.42, cz = -hd * 0.3;
      const roofAt = H + d * 0.32 * (1 - Math.abs(cz) / hd);
      addBox('brick_ext', cx - 0.3, cx + 0.3, H + 0.1, roofAt + 0.85, cz - 0.3, cz + 0.3, B);
      addBox('concrete', cx - 0.36, cx + 0.36, roofAt + 0.85, roofAt + 0.92, cz - 0.36, cz + 0.36, B, false);
    }

    if (plot.type === 'police') {
      this.signs.push({ m: B.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.55, hd + 0.03)), text: 'ПОЛИЦИЯ', sub: 'POLICE' });
    }
    // (over their doors: a clinic's board is white with a red cross's red on it, a shop's is green)
    if (plot.type === 'clinic') this.signs.push({ m: B.clone().multiply(new THREE.Matrix4().makeTranslation(1.9, 2.5, hd + 0.03)), text: 'МЕДПУНКТ', sub: 'CLINIC', board: '#e4e0d4', ink: '#8c1f1f' });
    if (plot.type === 'store') this.signs.push({ m: B.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.64, hd + 0.03)), text: 'МАГАЗИН', sub: 'SHOP', board: '#2f4a33', ink: '#e8ebf0' });

    // roofs
    if (bp.whole) {
      // (the model's)
    } else if (bp.shell) {
      // The model's. Only what stops a body and a shot: a slab under each slope, and the two ends under them.
      const { ridge, eave, out } = bp.shell;
      const ang = Math.atan2(ridge - eave, out), len = Math.hypot(out, ridge - eave);
      for (const s of [1, -1]) {
        const R = B.clone().multiply(new THREE.Matrix4().makeTranslation(0, ridge, 0)).multiply(new THREE.Matrix4().makeRotationX(s * ang));
        this.collider(hw + 0.78, 0.06, len / 2, R.multiply(new THREE.Matrix4().makeTranslation(0, -0.06, (s * len) / 2)), 'metal');
      }
      for (const sx of [1, -1]) this.collider(T / 2, (ridge - H) / 4, hd * 0.7, B.clone().multiply(new THREE.Matrix4().makeTranslation(sx * (hw - T / 2), H + (ridge - H) / 4, 0)), 'plaster');
      this.shells.push({ model: bp.shell.model, m: B.clone().multiply(new THREE.Matrix4().makeTranslation(0, -bp.shell.lift, 0)) });
    } else if (bp.roofType === 'gable') {
      const rise = d * (plot.type === 'barn' ? 0.36 : 0.32);
      const ang = Math.atan2(rise, hd);
      const oh = 0.45;
      const slopeLen = hd / Math.cos(ang) + oh;
      for (const s of [1, -1]) {
        const R = B.clone()
          .multiply(new THREE.Matrix4().makeTranslation(0, H + rise + 0.02, 0))
          .multiply(new THREE.Matrix4().makeRotationX(s * ang));
        const z0 = s > 0 ? 0 : -slopeLen, z1 = s > 0 ? slopeLen : 0;
        addBox(bp.roof, -hw - oh, hw + oh, 0, 0.1, z0, z1, R);
      }
      // gable ends
      for (const sx of [1, -1]) {
        const G = B.clone().multiply(new THREE.Matrix4().makeTranslation(sx * (hw - T / 2), H, 0));
        this.push(bp.ext, prismGeo(hd, rise, T, this.tile(bp.ext), G, [-sx, hd - T, bp.upper ? bp.upper.h : h]));
      }
      // ridge cap
      addBox('trim', -hw - oh, hw + oh, H + rise + 0.02, H + rise + 0.14, -0.12, 0.12, B, false);
      this.eaves(B, hw, H + rise + 0.02, ang, slopeLen, oh);
    } else if (bp.roofType === 'shed') {
      // single pitch: highest over the door, falling to the back wall
      const rise = 0.55;
      const ang = Math.atan2(rise, d);
      const R = B.clone()
        .multiply(new THREE.Matrix4().makeTranslation(0, h + rise, hd))
        .multiply(new THREE.Matrix4().makeRotationX(-ang));
      addBox(bp.roof, -hw - 0.3, hw + 0.3, 0, 0.08, -(d / Math.cos(ang) + 0.35), 0.35, R);
      // the front wall carries on up to the high edge of the roof
      addBox(bp.ext, -hw, hw, h, h + rise, hd - T, hd, B, false);
      // and each side wall is closed by a wedge under the slope
      // (as far as the front wall and no further: run on to the front, its side lay in the end of that wall and the corner flickered)
      for (const sx of [1, -1]) {
        const G = B.clone().multiply(new THREE.Matrix4().makeTranslation(sx * (hw - T / 2), h, -hd));
        this.push(bp.ext, wedgeGeo(d - T, (rise * (d - T)) / d, T, this.tile(bp.ext), G));
      }
    } else {
      addBox(bp.roof, -hw - 0.25, hw + 0.25, H, H + 0.22, -hd - 0.25, hd + 0.25, B);
    }

    // furniture: indoors, so it only has to be drawn from close by (through a window or the door).
    // A barn stands open at the front and shows its insides from further off.
    const indoorFar = plot.type === 'barn' || plot.type === 'garage' ? 95 : 46;
    const inst = (id: string, lx: number, lz: number, rot: number, scale = 1, y = 0) => {
      const p = new THREE.Vector3(lx, y, lz).applyMatrix4(B);
      this.world.props.push({ kind: id, x: p.x, y: p.y, z: p.z, rot: rot + plot.rot, scale, far: indoorFar });
    };
    // what stands on a floor (whose own level is y0), and where things are found on it
    const stock = (furniture: Furn[], loot: [number, number, number][], y0: number) => {
      for (const f of furniture) inst(f.id, f.x, f.z, f.rot, f.scale ?? 1, (f.y ?? 0) + y0);
      // A bed is a frame with a few wires across it and nothing on them: whatever was kept on one hung in the air
      // over the springs (59 places on the map). Each has a mattress, and what is kept on it lies on that.
      for (const f of furniture) {
        if (f.id !== 'old_bed_frame') continue;
        const M = new THREE.Matrix4().makeRotationY(f.rot).setPosition(f.x, (f.y ?? 0) + y0, f.z).premultiply(B);
        this.push('mattress', boxGeo(-0.38, 0.38, BED.springs, BED.springs + BED.mattress, -0.9, 0.9, this.tile('mattress'), M));
      }

      // loot points: on the floor, or on the furniture surface underneath
      const local = (f: Furn, lx: number, lz: number): [number, number] => {
        const c = Math.cos(f.rot), s = Math.sin(f.rot);
        const dx = lx - f.x, dz = lz - f.z;
        return [c * dx - s * dz, s * dx + c * dz];
      };
      const bounds = (f: Furn) => {
        const e = assets.manifest.models[f.id];
        const k = f.scale ?? 1;
        return { hx: ((e.max[0] - e.min[0]) / 2) * k, hz: ((e.max[2] - e.min[2]) / 2) * k, top: e.max[1] * k };
      };
      const onFurniture = new Map<string, { f: Furn; ly: number; pts: [number, number][] }>();
      for (const [lx, ly, lz] of loot) {
        // (on the ground floor, or on one of the floors of a building that is a model's)
        if (ly < 0.1 || bp.whole?.floors.some((f) => Math.abs(ly - f) < 0.1)) {
          const p = new THREE.Vector3(lx, ly + y0, lz).applyMatrix4(B);
          this.lootPoints.push({ x: p.x, y: p.y, z: p.z, usage: bp.usage, building: plot.id, floor: true });
          continue;
        }
        const f = furniture.find((q) => {
          const [ox, oz] = local(q, lx, lz);
          const b = bounds(q);
          // (and on the floor the thing stands on: what is upstairs in a house that is a model's is not under what is said to lie upstairs)
          return Math.abs(ox) < b.hx + 0.12 && Math.abs(oz) < b.hz + 0.12 && ly > (q.y ?? 0) - 0.05 && ly < (q.y ?? 0) + 2.6;
        });
        if (!f || CRATE_KINDS.has(f.id)) continue;
        const key = `${furniture.indexOf(f)}:${ly}`;
        if (!onFurniture.has(key)) onFurniture.set(key, { f, ly, pts: [] });
        onFurniture.get(key)!.pts.push(local(f, lx, lz));
      }
      // several points on one surface share it side by side, so their items never overlap
      for (const { f, ly, pts } of onFurniture.values()) {
        const b = bounds(f);
        const [ix, iz] = SURFACE_INSET[f.id] ?? [0.05, 0.05];
        const HX = b.hx - ix, HZ = b.hz - iz;
        const along = HX >= HZ; // split along the longer side
        const L = along ? HX : HZ;
        pts.sort((p, q) => (along ? p[0] - q[0] : p[1] - q[1]));
        pts.forEach((_, i) => {
          const seg = L / pts.length;
          const centre = -L + (2 * i + 1) * seg;
          const ox = along ? centre : 0, oz = along ? 0 : centre;
          const c = Math.cos(f.rot), s = Math.sin(f.rot);
          const levels = SHELF_LEVELS[f.id];
          // (heights are from the floor the thing stands on: upstairs furniture said where it lay from the ground floor, and what was on it hung in the room below)
          const up = f.y ?? 0, lh = ly - up;
          const sy = levels ? levels.reduce((best, l) => (Math.abs(l - lh) < Math.abs(best - lh) ? l : best)) + 0.003 : lh;
          const p = new THREE.Vector3(f.x + ox * c + oz * s, (f.id === 'old_bed_frame' ? BED.springs + BED.mattress + 0.003 : TOP_SURFACE.has(f.id) ? b.top + 0.003 : sy) + up + y0, f.z - ox * s + oz * c).applyMatrix4(B);
          this.lootPoints.push({
            x: p.x, y: p.y, z: p.z, usage: bp.usage, building: plot.id, floor: false,
            surf: { x: p.x, z: p.z, rot: f.rot + plot.rot, hx: along ? seg : HX, hz: along ? HZ : seg, clear: SHELF_CLEARANCE[f.id] ?? 10 },
          });
        });
      }
    };
    // (at the trading post nothing is left lying for whoever walks in: what is there is the trader's, and is bought)
    // (his shop and his shed, that is: the bunkhouse along the yard is nobody's)
    const his = plot.type !== 'hut' && this.world.sites.some((st) => st.kind === 'market' && Math.hypot(st.x - plot.x, st.z - plot.z) < 40);
    stock(bp.furniture, his ? [] : bp.loot, 0);
    if (bp.upper) stock(bp.upper.furniture, bp.upper.loot, h + SLAB);

    // where a weapon is always to be found: on the floor first (anything fits there)
    if (plot.arms) {
      const mine = this.lootPoints.slice(firstPoint);
      const pick = [...mine.filter((p) => p.floor), ...mine.filter((p) => !p.floor)].slice(0, plot.arms);
      for (const p of pick) p.arms = plot.type === 'police' || plot.type === 'guardpost' || plot.type === 'barracks' ? 'guns' : 'any';
    }

    // yard clutter
    const yard = ['Barrel_01', 'barrel_03', 'wooden_crate_01', 'cardboard_box_01', 'metal_trash_can', 'old_tyre', 'trashbag', 'trashbag', 'cardboard_box_01'];
    const n = plot.type === 'guardpost' ? 1 : rng.int(2, 5);
    const placed: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const side = rng.int(0, 3);
      let lx: number, lz: number;
      if (side === 0) { lx = rng.range(-hw, hw); lz = -hd - rng.range(0.5, 1.4); }
      else if (side === 1) { lx = -hw - rng.range(0.5, 1.4); lz = rng.range(-hd, hd); }
      else if (side === 2) { lx = hw + rng.range(0.5, 1.4); lz = rng.range(-hd, hd); }
      else { lx = rng.chance(0.5) ? -hw + 0.6 : hw - 0.6; lz = hd + rng.range(0.6, 1.4); }
      const p = new THREE.Vector3(lx, 0, lz).applyMatrix4(B);
      // never two things in the one spot
      if (placed.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1.15)) continue;
      placed.push(p);
      let kind = rng.pick(yard);
      // one can per placement (the source file has a clean and a rusty one)
      if (kind === 'metal_trash_can') kind += rng.chance(0.5) ? '@0' : '@1';
      const gy = heightAt(this.world.heights, p.x, p.z) + (kind === 'old_tyre' ? 0.08 : 0);
      this.world.props.push({ kind, x: p.x, y: gy, z: p.z, rot: rng.range(0, Math.PI * 2), scale: 1 });
      if (kind === 'barrel_03') {
        // small things get left on top of a barrel (a water barrel: nothing is left on a
        // fuel drum, which may not be there in a minute)
        // (on its lid, which is let 3 cm down inside its rim: at the rim's height they hung over it)
        const top = assets.manifest.models[kind].max[1] - BARREL_LID;
        this.lootPoints.push({ x: p.x, y: gy + top + 0.003, z: p.z, usage: bp.usage, building: plot.id, floor: false, surf: { x: p.x, z: p.z, rot: 0, hx: 0.17, hz: 0.17, clear: 10 } });
      }
    }
    if ((plot.type === 'house_small' || plot.type === 'house_brick') && rng.chance(0.3)) {
      const p = new THREE.Vector3(hw + 2.6, 0, rng.range(-1, 1)).applyMatrix4(B);
      // (not parked on the bins)
      if (!placed.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 2.6)) this.world.props.push({ kind: 'covered_car', x: p.x, y: heightAt(this.world.heights, p.x, p.z), z: p.z, rot: plot.rot + rng.range(-0.15, 0.15), scale: 1 });
    }
    if (plot.type === 'cabin') {
      const p = new THREE.Vector3(-1.5, 0, hd + 3.2).applyMatrix4(B);
      this.world.props.push({ kind: 'stone_fire_pit', x: p.x, y: heightAt(this.world.heights, p.x, p.z), z: p.z, rot: 0, scale: 1 });
    }
  }

  /**
   * The stairs there are, for anything that has to find its way up or down by them: which
   * building, where each begins and ends, and a spot on the floor above that is clear of the
   * well and its rail (all in the world's space).
   */
  flights: { plot: string; foot: THREE.Vector3; head: THREE.Vector3; off: THREE.Vector3 }[] = [];

  /**
   * A flight of stairs from y0 up to y1: boards and risers to look at, and one slope to walk
   * on, laid along the fronts of the steps from a tread before the first to a tread short of
   * the last. A body goes up it as up a bank, with no step to catch its feet on; it stops
   * feet and nothing else.
   */
  private flight(B: THREE.Matrix4, plot: string, st: Stairs, y0: number, y1: number, off?: [number, number]) {
    const up = y1 - y0, dz = Math.sign(st.top - st.foot), L = Math.abs(st.top - st.foot);
    const N = Math.round(up / 0.2), rise = up / N, run = L / N;
    const tile = this.tile('planks');
    for (let i = 0; i < N; i++) {
      const za = st.foot + dz * i * run, zb = st.foot + dz * (i + 1) * run;
      // (each tread overhangs the one under it; the last does not overhang the floor it comes up to, whose top is its own)
      const last = i === N - 1;
      this.push('planks', boxGeo(st.x0, st.x1, y0 + (i + 1) * rise - 0.045, y0 + (i + 1) * rise, Math.min(za, zb) - (last && dz < 0 ? 0 : 0.015), Math.max(za, zb) + (last && dz > 0 ? 0 : 0.015), tile, B));
      this.push('planks', boxGeo(st.x0 + 0.02, st.x1 - 0.02, y0 + i * rise, y0 + (i + 1) * rise - 0.045, Math.min(za, za + dz * 0.025), Math.max(za, za + dz * 0.025), tile, B));
    }
    const tilt = Math.atan2(up, L), HALF = 0.04, xc = (st.x0 + st.x1) / 2;
    const ramp = new THREE.Matrix4()
      .makeTranslation(xc, y0 + up / 2 - HALF * Math.cos(tilt), (st.foot + st.top) / 2 - dz * run + dz * HALF * Math.sin(tilt))
      .multiply(new THREE.Matrix4().makeRotationX(-dz * tilt));
    this.collider((st.x1 - st.x0) / 2, HALF, Math.hypot(up, L) / 2, B.clone().multiply(ramp), 'wood', GLASS_GROUPS);
    // (and the last tread, level, from where the slope ends to the floor above: left open, whatever is found by looking straight down fell through it)
    this.collider((st.x1 - st.x0) / 2, HALF, run / 2 + 0.03, B.clone().multiply(new THREE.Matrix4().makeTranslation(xc, y1 - HALF, st.top - (dz * run) / 2)), 'wood', GLASS_GROUPS);
    const head = new THREE.Vector3(xc, y1, st.top + dz * 0.5).applyMatrix4(B);
    this.flights.push({ plot, foot: new THREE.Vector3(xc, y0, st.foot - dz * 0.7).applyMatrix4(B), head, off: off ? new THREE.Vector3(off[0], y1, off[1]).applyMatrix4(B) : head });
    return { rise, run };
  }

  /**
   * A rail from one point to another (level, or up a flight): posts and two bars, and a body
   * does not go through it or over it. (Nothing else is stopped: it is bars, and a bullet
   * goes between them. What stops a body stands straight up from the line of the rail,
   * whatever the slope: leant with the slope, as the bars are, the low end of it hung out
   * over the landing at the height of a head.)
   */
  private rail(B: THREE.Matrix4, xa: number, za: number, xb: number, zb: number, ya: number, yb: number, key: MatKey = 'trim') {
    const len = Math.hypot(xb - xa, zb - za, yb - ya), flat = Math.hypot(xb - xa, zb - za);
    const tile = this.tile(key);
    const turn = new THREE.Matrix4().makeRotationY(Math.atan2(xb - xa, zb - za));
    const bar = (up: number, half: number) => {
      const R = B.clone().multiply(new THREE.Matrix4().makeTranslation(xa, ya + up, za)).multiply(turn).multiply(new THREE.Matrix4().makeRotationX(-Math.atan2(yb - ya, flat)));
      this.push(key, boxGeo(-half, half, -half, half, 0, len, tile, R));
    };
    bar(0.93, 0.03);
    bar(0.47, 0.017);
    const posts = Math.max(1, Math.round(flat / 0.95));
    for (let k = 0; k <= posts; k++) {
      const u = k / posts;
      // (painted by where it stands in the building: where two rails meet, the post of each is there, and the two show as one)
      const px = xa + (xb - xa) * u, py = ya + (yb - ya) * u, pz = za + (zb - za) * u;
      this.push(key, boxGeo(px - 0.025, px + 0.025, py, py + 0.93, pz - 0.025, pz + 0.025, tile, B));
    }
    const tall = Math.abs(yb - ya) + 1;
    this.collider(0.03, tall / 2, flat / 2, B.clone().multiply(new THREE.Matrix4().makeTranslation((xa + xb) / 2, Math.min(ya, yb) + tall / 2, (za + zb) / 2)).multiply(turn), 'wood', GLASS_GROUPS);
  }

  /**
   * A watchtower: four legs, a flight up one side to a landing across the back, a second up
   * the other side to the platform, a boarded parapet round that and an iron roof over it.
   * From the top a rifle sees over every roof about it; and whoever is up there is seen
   * from everywhere.
   */
  private planTower(plot: BuildingPlot) {
    const B = new THREE.Matrix4().compose(new THREE.Vector3(plot.x, plot.floorY, plot.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), plot.rot), new THREE.Vector3(1, 1, 1));
    const first = this.lootPoints.length;
    const box = (key: MatKey, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, collide = true) => {
      this.push(key, boxGeo(x0, x1, y0, y1, z0, z1, this.tile(key), B));
      if (collide) this.collider((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, B.clone().multiply(new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)), key === 'roof_iron' ? 'metal' : 'wood');
    };
    // (E: half its width. IN, OUT: the near and far edges of a flight from the middle. F: how far along the side a flight runs either way.)
    const MID = 2.6, TOP = 5.2, ROOF = 7.5, E = 2.8, IN = 1.65, OUT = 2.65, F = 1.6, RIM = E - 0.11;
    // legs, and the beams that tie them
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('planks', sx * E - 0.11, sx * E + 0.11, -0.7, ROOF, sz * E - 0.11, sz * E + 0.11);
    for (const y of [MID - 0.16, TOP - 0.3]) {
      for (const s of [-1, 1]) {
        box('planks', -E, E, y, y + 0.14, s * E - 0.06, s * E + 0.06, false);
        box('planks', s * E - 0.06, s * E + 0.06, y, y + 0.14, -E, E, false);
      }
    }
    // braces: a cross of boards between the legs, under the landing on three sides and above it on all four
    const brace = (xa: number, za: number, xb: number, zb: number, ya: number, yb: number) => {
      const flat = Math.hypot(xb - xa, zb - za), len = Math.hypot(flat, yb - ya);
      const R = B.clone()
        .multiply(new THREE.Matrix4().makeTranslation(xa, ya, za))
        .multiply(new THREE.Matrix4().makeRotationY(Math.atan2(xb - xa, zb - za)))
        .multiply(new THREE.Matrix4().makeRotationX(-Math.atan2(yb - ya, flat)));
      // (to one side of the line between the legs: the board that crosses it runs the other way and so lies to the other side, against it)
      this.push('planks', boxGeo(0, 0.04, -0.06, 0.06, 0, len, this.tile('planks'), R));
    };
    for (const [y0, y1, front] of [[0.15, MID - 0.3, false], [MID + 0.1, TOP - 0.45, true]] as [number, number, boolean][]) {
      for (const s of [-1, 1]) {
        brace(s * E, -E, s * E, E, y0, y1);
        brace(s * E, E, s * E, -E, y0, y1);
        if (s < 0 || front) {
          brace(-E, s * E, E, s * E, y0, y1);
          brace(E, s * E, -E, s * E, y0, y1);
        }
      }
    }
    // up one side to the landing across the back, and up the other to the platform
    const a: Stairs = { x0: -OUT, x1: -IN, foot: F, top: -F }, b: Stairs = { x0: IN, x1: OUT, foot: -F, top: F };
    this.flight(B, plot.id, a, 0, MID);
    this.flight(B, plot.id, b, MID, TOP, [IN - 0.9, F + 0.6]);
    // the landing, railed on every side a body could go off it
    box('planks', -RIM, RIM, MID - 0.1, MID, -RIM, -F);
    this.rail(B, -RIM, -RIM, RIM, -RIM, MID, MID);
    this.rail(B, -IN, -F, IN, -F, MID, MID);
    this.rail(B, -RIM, -F, -RIM, -RIM, MID, MID);
    this.rail(B, RIM, -RIM, RIM, -F, MID, MID);
    // each flight between two rails
    this.rail(B, -RIM, F, -RIM, -F, 0.17, MID);
    this.rail(B, -IN + 0.035, F, -IN + 0.035, -F, 0.17, MID);
    this.rail(B, RIM, -F, RIM, F, MID + 0.17, TOP);
    this.rail(B, IN - 0.035, -F, IN - 0.035, F, MID + 0.17, TOP);
    // the platform: all of it but the well the second flight comes up through (which has a rail across its foot)
    box('planks', -E, b.x0, TOP - 0.14, TOP, -E, E);
    box('planks', b.x1, E, TOP - 0.14, TOP, -E, E);
    box('planks', b.x0, b.x1, TOP - 0.14, TOP, -E, b.foot);
    box('planks', b.x0, b.x1, TOP - 0.14, TOP, b.top - 0.02, E);
    this.rail(B, b.x0, b.foot, b.x1, b.foot, TOP, TOP);
    this.rail(B, IN - 0.035, -F, IN - 0.035, F - 0.35, TOP, TOP);
    // a parapet of boards, chest high, and a roof of iron on the legs
    for (const s of [-1, 1]) {
      box('planks_ext', -E, E, TOP, TOP + 1.05, s * E - 0.04, s * E + 0.04);
      box('planks_ext', s * E - 0.04, s * E + 0.04, TOP, TOP + 1.05, -E, E);
      box('trim', -E - 0.03, E + 0.03, TOP + 1.05, TOP + 1.1, s * E - 0.07, s * E + 0.07, false);
      box('trim', s * E - 0.07, s * E + 0.07, TOP + 1.05, TOP + 1.1, -E - 0.03, E + 0.03, false);
    }
    const R = B.clone().multiply(new THREE.Matrix4().makeTranslation(0, ROOF, 0)).multiply(new THREE.Matrix4().makeRotationX(0.09));
    this.push('roof_iron', boxGeo(-E - 0.45, E + 0.45, 0, 0.07, -E - 0.45, E + 0.45, this.tile('roof_iron'), R));
    this.collider(E + 0.45, 0.04, E + 0.45, R, 'metal');
    // what is kept up there: a case of arms, and whatever was left on the boards
    const at = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyMatrix4(B);
    const c = at(-1.9, TOP, -2.1);
    this.world.props.push({ kind: 'weapons_case', x: c.x, y: c.y, z: c.z, rot: plot.rot + Math.PI / 2, scale: 1 });
    for (const [lx, lz] of [[-0.2, -0.6], [-1.6, 1.4], [0.5, 2.0]]) {
      const p = at(lx, TOP + 0.02, lz);
      this.lootPoints.push({ x: p.x, y: p.y, z: p.z, usage: ['Military'], building: plot.id, floor: true });
    }
    if (plot.arms) for (const p of this.lootPoints.slice(first, first + plot.arms)) p.arms = 'guns';
  }

  /** The edges of a pitched roof: a board hung along each eave, and one down each slope at either end. */
  private eaves(B: THREE.Matrix4, hw: number, ridge: number, ang: number, slopeLen: number, oh: number) {
    const tile = this.tile('trim');
    for (const s of [1, -1]) {
      const R = B.clone().multiply(new THREE.Matrix4().makeTranslation(0, ridge, 0)).multiply(new THREE.Matrix4().makeRotationX(s * ang));
      // (against the end of the roof: through the last of it, its top lay in the roof's own and the two flickered along every eave)
      const z0 = s > 0 ? slopeLen : -slopeLen - 0.06;
      this.push('trim', boxGeo(-hw - oh, hw + oh, -0.17, 0.1, z0, z0 + 0.06, tile, R));
      // (the two boards down a gable cross at its peak: one of them is the thinner, so that no face of one lies in a face of the other)
      const half = s > 0 ? 0.03 : 0.022;
      for (const sx of [1, -1]) {
        const x = sx * (hw + oh);
        this.push('trim', boxGeo(x - half, x + half, -0.17, 0.12, s > 0 ? 0 : -slopeLen, s > 0 ? slopeLen : 0, tile, R));
      }
    }
  }

  /** (`leaf`: it is a container's leaf, of the orange one (0) or the blue (1), and not a door of boards) */
  doorSpecs: { m: THREE.Matrix4; w: number; h: number; id: string; open: boolean; swing: number; leaf?: number }[] = [];
  /** sign boards to hang (police station): world matrix of the board's centre, facing +z */
  private signs: { m: THREE.Matrix4; text: string; sub: string; board?: string; ink?: string }[] = [];

  private planVillageProps() {
    const rng = new RNG(4711);
    // street lamps along the road through the village
    const pts = this.world.road.points;
    let lastLamp = -1e9;
    for (let i = 0; i < pts.length / 3 - 1; i++) {
      const x = pts[i * 3], z = pts[i * 3 + 2];
      if (Math.hypot(x - 30, z - 10) > 95) continue;
      const along = i * 4;
      if (along - lastLamp < 36) continue;
      lastLamp = along;
      const nx = pts[i * 3 + 3] - x, nz = pts[i * 3 + 5] - z;
      const l = Math.hypot(nx, nz);
      const side = (i / 9) % 2 < 1 ? 1 : -1;
      const px = x + (-nz / l) * 4.4 * side, pz = z + (nx / l) * 4.4 * side;
      this.world.props.push({ kind: 'street_lamp_01', x: px, y: heightAt(this.world.heights, px, pz), z: pz, rot: Math.atan2(nx, nz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2), scale: 1 });
    }
    // military checkpoint dressing
    const camp = this.world.pois.find((p) => p.name === 'Military Checkpoint')!;
    for (let i = 0; i < 7; i++) {
      const a = -0.6 + i * 0.22;
      const px = camp.x + Math.cos(a) * 21, pz = camp.z + Math.sin(a) * 21;
      this.world.props.push({ kind: 'concrete_road_barrier', x: px, y: heightAt(this.world.heights, px, pz), z: pz, rot: -a, scale: 1 });
    }
    const crates: [number, number, string][] = [[6, 4, 'weapons_case'], [7.5, 6.5, 'weapons_case'], [4.5, 7, 'weapons_case'], [-3, 12, 'weapons_case']];
    for (const [ox, oz, kind] of crates) {
      const px = camp.x + ox, pz = camp.z + oz;
      const y = heightAt(this.world.heights, px, pz);
      const rot = rng.range(0, Math.PI);
      this.world.props.push({ kind, x: px, y, z: pz, rot, scale: 1 });
    }
    const cx = camp.x + 12, cz = camp.z + 2;
    this.world.props.push({ kind: 'covered_car', x: cx, y: heightAt(this.world.heights, cx, cz), z: cz, rot: 0.4, scale: 1 });
  }

  /** Builds merged meshes, colliders are already created during plan(). */
  build(scene: THREE.Scene) {
    const group = new THREE.Group();
    group.name = 'buildings';
    for (const [key, list] of this.geoms) {
      const merged = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.material(key));
      mesh.castShadow = key !== 'glass';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = `building:${key}`;
      mesh.renderOrder = key === 'glass' ? 2 : WALLS_FIRST;
      group.add(mesh);
    }
    scene.add(group);

    for (const sg of this.signs) {
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 256;
      const g = c.getContext('2d')!;
      g.fillStyle = sg.board ?? '#16305c';
      g.fillRect(0, 0, 1024, 256);
      g.strokeStyle = sg.ink ?? '#d9dde4';
      g.lineWidth = 10;
      g.strokeRect(14, 14, 996, 228);
      g.fillStyle = sg.ink ?? '#e8ebf0';
      g.textAlign = 'center';
      g.font = '700 132px "Arial Narrow", Arial, sans-serif';
      g.fillText(sg.text, 512, 150);
      g.font = '600 50px Arial, sans-serif';
      g.fillText(sg.sub, 512, 214);
      // weathering: streaks and chips
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(${40 + Math.random() * 60 | 0}, ${36 + Math.random() * 40 | 0}, 30, ${Math.random() * 0.16})`;
        const w = 2 + Math.random() * 10;
        g.fillRect(Math.random() * 1024, Math.random() * 256, w, w * (1 + Math.random() * 14));
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.25 });
      this.atmo.register(mat);
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.65, 0.04), [this.material('trim'), this.material('trim'), this.material('trim'), this.material('trim'), mat, this.material('trim')]);
      board.applyMatrix4(sg.m);
      board.castShadow = board.receiveShadow = true;
      scene.add(board);
    }

    const doorMat = this.material('planks') as THREE.MeshStandardMaterial;
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x3a3a38, metalness: 0.9, roughness: 0.45 });
    this.atmo.register(handleMat);
    // (a container's leaves: painted as the shell is, once that has come; not drawn from further off than the shell)
    const leaves: THREE.Mesh[] = [];
    const leafGeo = [containerLeaf(false), containerLeaf(true)];
    const hang = (blue: number) => {
      const mesh = new THREE.Mesh(leafGeo[blue], handleMat);
      mesh.castShadow = mesh.receiveShadow = true;
      leaves.push(mesh);
      const lod = new THREE.LOD();
      lod.addLevel(mesh, 0);
      lod.addLevel(new THREE.Object3D(), 345);
      return lod;
    };
    for (const s of this.doorSpecs) {
      const d = new Door(s.m, s.w, s.h, doorMat, handleMat, s.id, s.leaf === undefined ? undefined : { mesh: hang(s.leaf), surface: 'metal' });
      if (s.open) d.setOpen(true, s.swing);
      scene.add(d.pivot);
      this.doors.push(d);
    }
    if (leaves.length) {
      void assets.model(CONTAINER.id).then((model) => {
        let src: THREE.Material | undefined;
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) src = m.material as THREE.Material;
        });
        if (!src) return;
        const paint = src.clone();
        this.atmo.register(paint);
        for (const l of leaves) l.material = paint;
      });
    }
    // the outsides that are models: each a copy of its model, painted as the walls are (in the weather, and before what grows)
    const painted = new Map<THREE.Material, THREE.Material>();
    for (const sh of this.shells) {
      void assets.model(sh.model).then((src) => {
        const obj = src.clone();
        obj.applyMatrix4(sh.m);
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = m.receiveShadow = true;
          m.renderOrder = WALLS_FIRST;
          const was = m.material as THREE.Material;
          if (!painted.has(was)) {
            // Its colour and its relief, and no more of what the download says of itself. (Its own word for how it
            // shines, and the shade it has baked into it for the picture it was made for, made the brick house black
            // indoors, where there is no sun and that shade took all the light there was.)
            const src = was as THREE.MeshStandardMaterial;
            const mine = new THREE.MeshStandardMaterial({ map: src.map, normalMap: src.normalMap, color: src.color, roughness: src.roughnessMap ? 0.9 : Math.max(0.6, src.roughness), metalness: 0, side: src.side, alphaTest: src.alphaTest, transparent: src.transparent, opacity: src.opacity });
            mine.name = src.name;
            this.atmo.register(mine);
            painted.set(was, mine);
          }
          m.material = painted.get(was)!;
        });
        scene.add(obj);
        if (sh.solid) {
          // what stops a body and a shot is the model itself: every triangle of it, where it stands
          obj.updateMatrixWorld(true);
          const verts: number[] = [], index: number[] = [], v = new THREE.Vector3();
          obj.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const at = m.geometry.getAttribute('position'), first = verts.length / 3;
            for (let i = 0; i < at.count; i++) {
              v.fromBufferAttribute(at, i).applyMatrix4(m.matrixWorld);
              verts.push(v.x, v.y, v.z);
            }
            const ix = m.geometry.getIndex();
            if (ix) for (let i = 0; i < ix.count; i++) index.push(first + ix.getX(i));
            else for (let i = 0; i < at.count; i++) index.push(first + i);
          });
          physics.addStatic(physics.R.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(index)), sh.solid, { x: 0, y: 0, z: 0 });
        }
      });
    }
    // what of a container stops a body and a shot: its floor, its roof, its two sides, and the plated half of each end
    for (const it of this.containers) {
      const m = containerMatrix(it), q = new THREE.Quaternion().setFromRotationMatrix(m);
      const { hx, hz, h } = CONTAINER;
      for (const [cx, cy, cz, bx, by, bz] of [[0, -0.04, 0, hx, 0.06, hz], [0, h - 0.01, 0, hx, 0.03, hz], [-hx + 0.015, h / 2, 0, 0.03, h / 2, hz], [hx - 0.015, h / 2, 0, 0.03, h / 2, hz], [hx / 2, h / 2, hz - 0.015, hx / 2, h / 2, 0.03], [-hx / 2, h / 2, -hz + 0.015, hx / 2, h / 2, 0.03]]) {
        physics.addStaticQuat(physics.R.ColliderDesc.cuboid(bx, by, bz), 'metal', new THREE.Vector3(cx, cy, cz).applyMatrix4(m), q);
      }
    }
  }

  private matCache = new Map<MatKey, THREE.Material>();
  private material(key: MatKey): THREE.Material {
    let m = this.matCache.get(key);
    if (m) return m;
    if (key === 'glass') {
      m = new THREE.MeshStandardMaterial({ color: 0x1d2622, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false, envMapIntensity: 1.6 });
    } else {
      const def = MATS[key];
      const t = assets.pbr(def.tex);
      m = new THREE.MeshStandardMaterial({
        map: t.map,
        normalMap: t.normalMap,
        roughnessMap: t.armMap,
        aoMap: t.armMap,
        metalnessMap: def.metal ? t.armMap : null,
        metalness: def.metal ? 1 : 0,
        roughness: 1,
        color: def.color ?? 0xffffff,
      });
    }
    this.atmo.register(m);
    this.matCache.set(key, m);
    return m;
  }

  update(dt: number) {
    for (const d of this.doors) d.update(dt);
  }
}

export type { Instance };
