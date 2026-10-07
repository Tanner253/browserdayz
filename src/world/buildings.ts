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
import { BUILDING_FOOTPRINT, heightAt, type BuildingPlot, type Instance, type SiteKind, type World } from './worldgen';

export type Usage = 'Village' | 'Town' | 'Farm' | 'Industrial' | 'Military' | 'Hunting' | 'Medic' | 'Police';

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
export const CRATE_KINDS = new Set(['wooden_crate_01', 'wooden_military_crate', 'old_military_crate']);

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
/** furniture whose loot sits on the very top of the model (height taken from the model, not hand-typed) */
const TOP_SURFACE = new Set(['WoodenTable_01', 'electric_stove', 'painted_wooden_cabinet', 'metal_office_desk']);

type MatKey =
  | 'plaster_ext' | 'brick_ext' | 'planks_ext' | 'planks' | 'int_plaster' | 'int_painted'
  | 'floor_wood' | 'floor_lino' | 'floor_concrete' | 'roof_iron' | 'roof_tiles' | 'concrete' | 'trim' | 'glass';

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

interface Blueprint {
  w: number;
  d: number;
  h: number;
  ext: MatKey;
  int: MatKey;
  floor: MatKey;
  roof: MatKey;
  roofType: 'gable' | 'shed' | 'flat';
  walls: WallDef[];
  furniture: Furn[];
  loot: [number, number, number][];
  usage: Usage[];
}

const T = 0.2; // wall thickness

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
          { id: 'old_tyre', x: 5.0, z: -0.6, rot: 0, y: 0.3 },
          ...(rng.chance(0.45) ? [{ id: 'covered_car', x: 0.2, z: 0.4, rot: 0.04 }] : []),
        ],
        loot: [
          [-4.2, 0.14, -3.5], [-4.2, 0.74, -3.5], [-4.2, 1.34, -3.5], [4.2, 0.14, -3.5], [4.2, 0.74, -3.5], [4.2, 1.34, -3.5],
          [-5.0, 0.37, 2.6], [-4.4, 0.37, 1.5], [-2.5, 0.02, -1.0], [2.8, 0.02, 1.8],
        ],
        usage: ['Farm', 'Industrial'],
      };
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
          { id: 'wooden_military_crate', x: 4.1, z: 3.75, rot: 0 },
          { id: 'wooden_military_crate', x: 5.7, z: 3.75, rot: 0.05 },
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
          { id: 'wooden_military_crate', x: 1.35, z: 1.25, rot: Math.PI / 2 },
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

function prismGeo(halfBase: number, rise: number, thick: number, tile: number, frame: THREE.Matrix4) {
  // triangle in the z/y plane, extruded along x
  const pts: [number, number][] = [[-halfBase, 0], [halfBase, 0], [0, rise]];
  const pos: number[] = [];
  const uvs: number[] = [];
  const x0 = -thick / 2, x1 = thick / 2;
  const tri = (a: number[], b: number[], c: number[]) => {
    pos.push(...a, ...b, ...c);
    for (const p of [a, b, c]) uvs.push(p[2] / tile, p[1] / tile);
  };
  const P = (x: number, i: number) => [x, pts[i][1], pts[i][0]];
  tri(P(x1, 0), P(x1, 1), P(x1, 2));
  tri(P(x0, 0), P(x0, 2), P(x0, 1));
  // sloped sides
  for (const [i, j] of [[1, 2], [2, 0]]) {
    tri(P(x0, i), P(x1, j), P(x1, i));
    tri(P(x0, i), P(x0, j), P(x1, j));
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

  constructor(world: THREE.Matrix4, width: number, height: number, mat: THREE.Material, handleMat: THREE.Material, public id: string) {
    // pivot sits on the hinge edge; panel extends along +x
    world.decompose(this.pivot.position, this.baseQuat, new THREE.Vector3());
    this.pivot.quaternion.copy(this.baseQuat);
    const panel = new THREE.Mesh(boxGeo(0, width - 0.02, 0, height - 0.02, -0.025, 0.025, 1.2, new THREE.Matrix4()), mat);
    panel.castShadow = panel.receiveShadow = true;
    panel.renderOrder = WALLS_FIRST;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.05), handleMat);
    handle.position.set(width - 0.12, 1.0, 0.05);
    const handle2 = handle.clone();
    handle2.position.z = -0.05;
    this.pivot.add(panel, handle, handle2);
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
    physics.tag(this.collider, { surface: 'wood', owner: this });
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
    if (!this.open && from) {
      const inv = new THREE.Matrix4().compose(this.pivot.position, this.baseQuat, new THREE.Vector3(1, 1, 1)).invert();
      const local = from.clone().applyMatrix4(inv);
      this.swing = local.z > 0 ? -1 : 1;
    }
    this.open = !this.open;
    this.onMove(this.open);
  }

  /** another player moved the door: animate to that state */
  set(open: boolean, swing: number) {
    if (open && !this.open) this.swing = swing;
    this.open = open;
  }

  get swingDir() {
    return this.swing;
  }

  /** set state without animation (world load / restore) */
  setOpen(open: boolean, swing = -1) {
    this.open = open;
    this.swing = swing;
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
    for (const plot of this.world.buildings) this.planBuilding(plot);
    this.planVillageProps();
    this.planSiteProps();
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
    const DRESSING: Record<SiteKind, [string, number, number][]> = {
      lodge: [['stone_fire_pit', -3.5, 7], ['wooden_crate_01', 4, 6.5], ['Barrel_01', 5.2, 5.8], ['dry_branches_medium_01', -6, 9]],
      farm: [['wooden_crate_01', 2, 6], ['wooden_crate_01', 3.2, 6.6], ['old_tyre', -1, 7.5], ['barrel_03', 15, 6], ['covered_car', -14, -8]],
      post: [['concrete_road_barrier', -4, 9], ['concrete_road_barrier', 0, 10], ['concrete_road_barrier', 4, 9], ['wooden_military_crate', 5.5, 3], ['old_military_crate@0', 6.6, 1.2], ['Barrel_01', -4.5, -6]],
      yard: [['wooden_crate_01', -4, 8], ['wooden_crate_01', -5.4, 8.6], ['wooden_crate_01', 5, 9], ['Barrel_01', 7, 8], ['barrel_03', 7.9, 8.9], ['old_tyre', 2, 11], ['dry_branches_medium_01', -9, 11]],
      dacha: [['covered_car', 9, -6], ['wooden_crate_01', -7, 5], ['metal_trash_can@0', -6.2, 3.4], ['trashbag', -8, 3]],
    };
    for (const st of this.world.sites) {
      const c = Math.cos(st.rot), s = Math.sin(st.rot);
      for (const [kind, right, fwd] of DRESSING[st.kind]) {
        const x = st.x + right * c + fwd * s, z = st.z - right * s + fwd * c;
        if (inBuilding(x, z, kind === 'covered_car' ? 2.6 : 1.1)) continue;
        // nor on top of what already lies in the yard
        const room = kind === 'covered_car' ? 3.2 : 1.15;
        if (this.world.props.some((q) => !q.far && Math.hypot(q.x - x, q.z - z) < (q.kind.startsWith('covered_car') ? 3.2 : room))) continue;
        const turn = kind === 'concrete_road_barrier' ? st.rot + Math.atan2(right, 9) * 0.6 : kind === 'covered_car' ? st.rot + rng.range(-0.3, 0.3) : rng.range(0, Math.PI * 2);
        this.world.props.push({ kind, x, y: heightAt(this.world.heights, x, z) + (kind === 'old_tyre' ? 0.08 : 0), z, rot: turn, scale: 1 });
      }
    }
  }

  private push(key: MatKey, g: THREE.BufferGeometry) {
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
    this.interiors.push({ x: plot.x, z: plot.z, hw: hw - T, hd: hd - T, rot: plot.rot, y0: plot.floorY - 0.2, y1: plot.floorY + h });

    // foundation + floor + ceiling
    const surf = (k: MatKey): Surface => (k === 'glass' ? 'glass' : MATS[k].surface);
    const addBox = (key: MatKey, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, frame: THREE.Matrix4, collide = true, groups?: number) => {
      this.push(key, boxGeo(x0, x1, y0, y1, z0, z1, this.tile(key), frame));
      if (collide) {
        const c = new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        this.collider((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, frame.clone().multiply(c), surf(key), groups);
      }
    };
    addBox('concrete', -hw - 0.08, hw + 0.08, -1.4, -0.1, -hd - 0.08, hd + 0.08, B);
    addBox(bp.floor, -hw + T * 0.5, hw - T * 0.5, -0.12, 0, -hd + T * 0.5, hd - T * 0.5, B);
    if (bp.roofType !== 'flat') addBox(bp.int, -hw + T, hw - T, h, h + 0.08, -hd + T, hd - T, B, false);

    // walls
    for (const wd of bp.walls) {
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
      ).setPosition(a.x, 0, a.y);
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
      const layers: [MatKey, number, number][] = [
        [wd.int, -T / 2, 0],
        [wd.ext, 0, T / 2],
      ];
      for (const [key, z0, z1] of layers) {
        let cur = 0;
        for (const o of ops) {
          if (o.a > cur) addBox(key, cur, o.a, 0, h, z0, z1, F);
          if (o.top < h) addBox(key, o.a, o.b, o.top, h, z0, z1, F);
          if (o.bottom > 0) addBox(key, o.a, o.b, 0, o.bottom, z0, z1, F);
          cur = o.b;
        }
        if (cur < L) addBox(key, cur, L, 0, h, z0, z1, F);
      }
      // frames, glass, doors
      for (const o of ops) {
        const fw = 0.07;
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
        if (o.kind !== 'window' && wd.side !== 'inner') this.doorstep(F, o.a, o.b);
      }
    }

    if (plot.type === 'police') {
      this.signs.push({ m: B.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.55, hd + 0.03)), text: 'ПОЛИЦИЯ', sub: 'POLICE' });
    }

    // roofs
    if (bp.roofType === 'gable') {
      const rise = d * (plot.type === 'barn' ? 0.36 : 0.32);
      const ang = Math.atan2(rise, hd);
      const oh = 0.45;
      const slopeLen = hd / Math.cos(ang) + oh;
      for (const s of [1, -1]) {
        const R = B.clone()
          .multiply(new THREE.Matrix4().makeTranslation(0, h + rise + 0.02, 0))
          .multiply(new THREE.Matrix4().makeRotationX(s * ang));
        const z0 = s > 0 ? 0 : -slopeLen, z1 = s > 0 ? slopeLen : 0;
        addBox(bp.roof, -hw - oh, hw + oh, 0, 0.1, z0, z1, R);
      }
      // gable ends
      for (const sx of [1, -1]) {
        const G = B.clone().multiply(new THREE.Matrix4().makeTranslation(sx * (hw - T / 2), h, 0));
        this.push(bp.ext, prismGeo(hd, rise, T, this.tile(bp.ext), G));
      }
      // ridge cap
      addBox('trim', -hw - oh, hw + oh, h + rise + 0.02, h + rise + 0.14, -0.12, 0.12, B, false);
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
      for (const sx of [1, -1]) {
        const G = B.clone().multiply(new THREE.Matrix4().makeTranslation(sx * (hw - T / 2), h, -hd));
        this.push(bp.ext, wedgeGeo(d, rise, T, this.tile(bp.ext), G));
      }
    } else {
      addBox(bp.roof, -hw - 0.25, hw + 0.25, h, h + 0.22, -hd - 0.25, hd + 0.25, B);
    }

    // furniture: indoors, so it only has to be drawn from close by (through a window or the door).
    // A barn stands open at the front and shows its insides from further off.
    const indoorFar = plot.type === 'barn' ? 95 : 46;
    const inst = (id: string, lx: number, lz: number, rot: number, scale = 1, y = 0) => {
      const p = new THREE.Vector3(lx, y, lz).applyMatrix4(B);
      this.world.props.push({ kind: id, x: p.x, y: p.y, z: p.z, rot: rot + plot.rot, scale, far: indoorFar });
    };
    for (const f of bp.furniture) inst(f.id, f.x, f.z, f.rot, f.scale ?? 1, f.y ?? 0);

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
    for (const [lx, ly, lz] of bp.loot) {
      if (ly < 0.1) {
        const p = new THREE.Vector3(lx, ly, lz).applyMatrix4(B);
        this.lootPoints.push({ x: p.x, y: p.y, z: p.z, usage: bp.usage, building: plot.id, floor: true });
        continue;
      }
      const f = bp.furniture.find((q) => {
        const [ox, oz] = local(q, lx, lz);
        const b = bounds(q);
        return Math.abs(ox) < b.hx + 0.12 && Math.abs(oz) < b.hz + 0.12;
      });
      if (!f || CRATE_KINDS.has(f.id)) continue;
      const key = `${bp.furniture.indexOf(f)}:${ly}`;
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
        const sy = levels ? levels.reduce((best, l) => (Math.abs(l - ly) < Math.abs(best - ly) ? l : best)) + 0.003 : ly;
        const p = new THREE.Vector3(f.x + ox * c + oz * s, TOP_SURFACE.has(f.id) ? b.top + 0.003 : sy, f.z - ox * s + oz * c).applyMatrix4(B);
        this.lootPoints.push({
          x: p.x, y: p.y, z: p.z, usage: bp.usage, building: plot.id, floor: false,
          surf: { x: p.x, z: p.z, rot: f.rot + plot.rot, hx: along ? seg : HX, hz: along ? HZ : seg, clear: SHELF_CLEARANCE[f.id] ?? 10 },
        });
      });
    }

    // where a weapon is always to be found: on the floor first (anything fits there)
    if (plot.arms) {
      const mine = this.lootPoints.slice(firstPoint);
      const pick = [...mine.filter((p) => p.floor), ...mine.filter((p) => !p.floor)].slice(0, plot.arms);
      for (const p of pick) p.arms = plot.type === 'police' || plot.type === 'guardpost' ? 'guns' : 'any';
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
      if (kind === 'Barrel_01' || kind === 'barrel_03') {
        // small things get left on top of a barrel
        const top = assets.manifest.models[kind].max[1];
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

  doorSpecs: { m: THREE.Matrix4; w: number; h: number; id: string; open: boolean; swing: number }[] = [];
  /** sign boards to hang (police station): world matrix of the board's centre, facing +z */
  private signs: { m: THREE.Matrix4; text: string; sub: string }[] = [];

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
    const crates: [number, number, string][] = [[6, 4, 'old_military_crate@0'], [7.5, 6.5, 'wooden_military_crate'], [4.5, 7, 'wooden_military_crate'], [-3, 12, 'old_military_crate@1']];
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
      g.fillStyle = '#16305c';
      g.fillRect(0, 0, 1024, 256);
      g.strokeStyle = '#d9dde4';
      g.lineWidth = 10;
      g.strokeRect(14, 14, 996, 228);
      g.fillStyle = '#e8ebf0';
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
    for (const s of this.doorSpecs) {
      const d = new Door(s.m, s.w, s.h, doorMat, handleMat, s.id);
      if (s.open) d.setOpen(true, s.swing);
      scene.add(d.pivot);
      this.doors.push(d);
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
