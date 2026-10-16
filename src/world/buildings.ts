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
import { SHADOW_FRUSTA, type Atmosphere } from './atmosphere';
import { GAS, gasDepth, gasZone } from '../sim/gas';
import type { Tier } from '../sim/tiers';
import { BUILDING_FOOTPRINT, CELL, TOWN, WORLD_NX, WORLD_NZ, WORLD_X0, WORLD_Z0, bunkerPlace, heightAt, idx, type BuildingPlot, type Instance, type SiteKind, type World } from './worldgen';
import { bunkerAt, bunkerPlan, levelY } from '../sim/bunker';
import { wreckUnder } from '../sim/bridge';
import { castleLoot, castleProps } from '../sim/castle';
import { frameToWorld, planBasements, type RoomKind } from '../sim/basements';
import { buildBasement, roomVolume, type Kit } from './basement-build';
import { flatsPlan, hospitalLobbyPlan, hospitalPlan, hospitalWingPlan, policeCellsPlan, policeGaragePlan, policeHqPlan } from './big-buildings';

/** (`Gas` is not a kind of building: it is whatever stands under the gas, whatever else it is. See src/sim/gas.ts.) */
// (2026-10-13: "a specific type of loot is in specific types of buildings". A building that is FOR something is of
// that kind and no other: a clinic is not also a house, nor a shop, nor a shed a part of the village. They were,
// and a clinic's shelves held hats and tins, the shop's held hatchets and Kamenka's hospital held rifles. And a
// hospital is a kind of its own beside a clinic: "the small medical buildings should lean heavy on bandages and
// stims and less medkits and the hospital should be medkit abundant and lots of stims".)
export type Usage = 'Village' | 'Town' | 'Farm' | 'Industrial' | 'Military' | 'Hunting' | 'Medic' | 'Hospital' | 'Police' | 'Shop' | 'Gas' | 'Bunker' | 'East';

export interface LootPoint {
  x: number;
  y: number;
  z: number;
  usage: Usage[];
  building: string;
  /** on the floor (room for long items) rather than on furniture */
  floor: boolean;
  /** which step of the map it is on, 1 (the outskirts) to 5 (the bunker): see src/sim/tiers.ts. Said once every place has been made. */
  tier?: Tier;
  /**
   * kept stocked with something to fight with (see Economy), never left empty for long:
   * a firearm where firearms were kept (police, guard posts), any weapon elsewhere
   */
  arms?: 'guns' | 'any';
  /** this very thing is always here, put back a while after it is taken (the rifle on the hospital's roof, and its parts): see Economy */
  keeps?: string;
  /** the furniture surface this point sits on: world-space centre, yaw and usable half extents */
  surf?: { x: number; z: number; rot: number; hx: number; hz: number; /** free height above the surface */ clear: number };
}

/** what a basement's room keeps, by its kind (src/sim/basements.ts): a root cellar a village's, a vault the army's */
const CELLAR_USAGE: Record<RoomKind, Usage[]> = {
  stair: ['Village'], shaft: ['Village'], hall: ['Village'], root: ['Village', 'Farm'], closet: ['Village'], work: ['Industrial'],
  store: ['Farm', 'Village'], bunk: ['Military', 'Hunting'], vault: ['Military'],
};

/** props that are searched as containers (loot is inside, never lying on top) */
export const CRATE_KINDS = new Set(['wooden_crate_01', 'wooden_military_crate', 'old_military_crate', 'weapons_case']);
/**
 * Furniture that is searched as a crate is (2026-10-12: "the metal lockers found in the police station and the
 * medical station should be lootable and have inventories"): the steel cabinet with two doors that stands in the
 * headquarters and the hospital. Kept apart from the crates: a crate has no place for a thing on it, and these
 * are asked nothing of where places are, so that not one place on the map is other than it was.
 * (2026-10-13: and the steel locker the owner brought in, two lockers in one case, whose doors swing open while it
 * is searched: see HUNG in src/sim/crates.ts. It stands where the men's lockers were cabinets, in the headquarters
 * and over its cells, and where a locker belongs and there was none: a police station's hall, a barracks, a long
 * hut, the rooms the hospital's own people sat in.)
 */
export const SEARCHED_KINDS = new Set(['med_cabinet', 'steel_locker']);

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
/**
 * The two racks of angle iron and boards (2026-10-13, the owner's: "have we thoroughly gone through all the props
 * objects and made sure we used them to their fullest extent"), and where on each a thing can lie, measured on the
 * models by rays (assets-src/_wf/me/boards.mjs). `boards`: the top of each board over the rack's foot, lowest
 * first. `mid`, `half`: the middle of the part of a board that is clear, and how far that part reaches either way,
 * along the rack and into it (the narrow one is not stood about its frame's middle, a coil of rope lying at one
 * foot of it; and a brace crosses the back of both, so that the back third of a board is left alone). `clear`: the
 * room over a board before the next. `places`: how many things lie side by side on one board.
 *
 * A rack is stood in a building as anything is (Furn), and says which of its boards hold a thing (`on`). Those
 * places are not made where the building's others are: they come after every other place on the map (see
 * `racked`), since a place is known by its number and a new one anywhere else would renumber all that follow it.
 */
const RACKS: Record<string, { boards: number[]; mid: [number, number]; half: [number, number]; clear: number; places: number }> = {
  rack_small: { boards: [0.187, 0.724, 1.265, 1.824], mid: [0.08, 0.06], half: [0.42, 0.2], clear: 0.46, places: 1 },
  rack_wide: { boards: [0.183, 0.728, 1.256, 1.828], mid: [0, 0.06], half: [0.84, 0.2], clear: 0.46, places: 2 },
};
/** how high a bed's springs are over its feet, and how thick the mattress on them is: what is kept on a bed lies on that */
const BED = { springs: 0.49, mattress: 0.1 };
/** how far under its rim the lid of a water barrel is */
const BARREL_LID = 0.032;
/** furniture whose loot sits on the very top of the model (height taken from the model, not hand-typed) */
const TOP_SURFACE = new Set(['WoodenTable_01', 'painted_wooden_table', 'electric_stove', 'painted_wooden_cabinet', 'metal_office_desk', 'lab_counter', 'steel_table', 'surgical_trolley']);

export type MatKey =
  | 'plaster_ext' | 'brick_ext' | 'planks_ext' | 'planks' | 'int_plaster' | 'int_painted'
  | 'floor_wood' | 'floor_lino' | 'floor_concrete' | 'roof_iron' | 'roof_tiles' | 'concrete' | 'trim' | 'mattress' | 'glass'
  | 'ceiling' | 'ward_wall' | 'office_wall' | 'tile_wall' | 'steel' | 'bitumen' | 'cell_wall'
  | 'hosp_ext' | 'ochre_ext' | 'trim_white' | 'plinth' | 'cold_steel' | 'ward_dado' | 'office_dado' | 'tile_dado' | 'cell_dado' | 'lamp'
  | 'brick_red' | 'brick_white' | 'brick_rough' | 'plaster_grey' | 'plaster_yellow' | 'plaster_green' | 'planks_green' | 'planks_blue' | 'planks_brown'
  | 'roof_iron_clean' | 'roof_iron_green' | 'roof_iron_red' | 'roof_slate' | 'slab' | 'paving' | 'floor_garage';

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
  // (For the buildings of several floors, 2026-10-11. No new pictures: the ones there are, painted.)
  // a ceiling: whitewash gone grey
  ceiling: { tex: 'painted_plaster_wall', tile: 3.2, color: 0xcfcbbd, surface: 'plaster' },
  // a ward's walls: the pale green every such wall was painted
  ward_wall: { tex: 'painted_plaster_wall', tile: 2.4, color: 0xa9bba6, surface: 'plaster' },
  // an office's: cream
  office_wall: { tex: 'painted_plaster_wall', tile: 2.4, color: 0xcdc3a2, surface: 'plaster' },
  // where it is washed down (theatre, morgue, the cells' passage): cold and near white
  tile_wall: { tex: 'painted_plaster_wall', tile: 1.6, color: 0xc4cdcc, surface: 'plaster' },
  // a cell's: grey-blue to the height of a man
  cell_wall: { tex: 'damaged_plaster', tile: 2.2, color: 0x8f9aa3, surface: 'plaster' },
  // bars, vents, a tank, a mast
  // (painted steel: there is no picture of bare plate among the ones the game has)
  steel: { tex: 'painted_plaster_wall', tile: 1.2, color: 0x565d63, surface: 'metal' },
  // a flat roof's felt
  bitumen: { tex: 'bitumen', tile: 2.6, color: 0xb9b5ad, surface: 'concrete' },
  // (For the faces of the two big buildings, 2026-10-12: "the new buildings need more character ... everything is
  // too plain". What a public building of that country and those years was painted, on the plaster there is.)
  // a hospital's: pale yellow gone dull
  // (on the plain painted plaster: the mossy one is dark and green, and it came out the colour of a ditch; the
  // bare grey one is stained in great patches, and a wall of it painted yellow was spotted like a hide)
  hosp_ext: { tex: 'painted_plaster_wall', tile: 3.2, color: 0xfff0b4, surface: 'plaster' },
  // a police station's: ochre
  ochre_ext: { tex: 'painted_plaster_wall', tile: 3.2, color: 0xf6bb62, surface: 'plaster' },
  // what stands proud of such a wall, painted white once: bands, the surrounds of windows, pilasters
  trim_white: { tex: 'painted_plaster_wall', tile: 2.2, color: 0xe7e2d2, surface: 'plaster' },
  // the foot of the wall: rendered and painted grey
  plinth: { tex: 'grey_plaster_02', tile: 2.6, color: 0x9d9b93, surface: 'concrete' },
  // the lower part of an inside wall, in oil paint, to the height of a shoulder: what a ward, an office, a washed-down
  // room and a cell had
  ward_dado: { tex: 'painted_plaster_wall', tile: 2.4, color: 0x6e8f78, surface: 'plaster' },
  office_dado: { tex: 'painted_plaster_wall', tile: 2.4, color: 0x8b7a56, surface: 'plaster' },
  tile_dado: { tex: 'painted_plaster_wall', tile: 1.6, color: 0x93abb0, surface: 'plaster' },
  cell_dado: { tex: 'damaged_plaster', tile: 2.2, color: 0x596672, surface: 'plaster' },
  // the casing of the morgue's cold chambers: sheet steel, bare
  cold_steel: { tex: 'painted_plaster_wall', tile: 1.6, color: 0xc4c8ca, surface: 'metal' },
  // the box of a ceiling light, its tubes long dead
  lamp: { tex: 'painted_plaster_wall', tile: 1.2, color: 0xe8e8e0, surface: 'metal' },
  // (2026-10-12: "we need more texture variations for our hand made buildings so they dont all use the same
  // textures". Ten more pictures (scripts/assets.config.mjs), and what a house is faced and roofed with is its own:
  // see SKINS.)
  // brick: new and red, whitewashed, rendered and coming through
  brick_red: { tex: 'red_brick_03', tile: 2.4, surface: 'concrete' },
  brick_white: { tex: 'white_bricks', tile: 2.6, surface: 'concrete' },
  brick_rough: { tex: 'rough_plaster_brick_02', tile: 2.8, surface: 'concrete' },
  // plaster: bare, and distempered yellow or green
  plaster_grey: { tex: 'grey_plaster_02', tile: 3, surface: 'plaster' },
  // (the two painted ones on the plain plaster: the bare one's stains show through paint as spots)
  plaster_yellow: { tex: 'painted_plaster_wall', tile: 3, color: 0xf6e3a4, surface: 'plaster' },
  plaster_green: { tex: 'painted_plaster_wall', tile: 3, color: 0xc3d8b8, surface: 'plaster' },
  // boards: painted, as a village's houses are
  planks_green: { tex: 'weathered_plank_siding', tile: 2.4, color: 0x9fb592, surface: 'wood' },
  planks_blue: { tex: 'weathered_plank_siding', tile: 2.4, color: 0x9db3c4, surface: 'wood' },
  planks_brown: { tex: 'weathered_plank_siding', tile: 2.4, color: 0xc49a72, surface: 'wood' },
  // sheet iron not yet rusted through: bare, and painted
  roof_iron_clean: { tex: 'corrugated_iron', tile: 2, metal: true, surface: 'metal' },
  roof_iron_green: { tex: 'corrugated_iron', tile: 2, color: 0x7f9a7c, metal: true, surface: 'metal' },
  roof_iron_red: { tex: 'corrugated_iron', tile: 2, color: 0xa3604f, metal: true, surface: 'metal' },
  roof_slate: { tex: 'grey_roof_tiles_02', tile: 2.2, surface: 'concrete' },
  // the slabs of a wall round a yard; what is laid before a door; a garage's floor
  slab: { tex: 'concrete_panels', tile: 2.5, color: 0xb9b6ad, surface: 'concrete' },
  paving: { tex: 'concrete_tiles_02', tile: 1.6, surface: 'concrete' },
  floor_garage: { tex: 'garage_floor', tile: 3, surface: 'concrete' },
};
/**
 * What a building is faced and roofed with is one of several, chosen by its own number (and by no dice that
 * anything else is thrown with): two brick houses side by side are not the same brick. Not a building whose
 * outside is a model's, nor one that has a face of its own (see Dress).
 */
const SKINS: Partial<Record<MatKey, MatKey[]>> = {
  brick_ext: ['brick_ext', 'brick_red', 'brick_red', 'brick_white', 'brick_rough'],
  plaster_ext: ['plaster_ext', 'plaster_grey', 'plaster_grey', 'plaster_yellow', 'plaster_green'],
  planks_ext: ['planks_ext', 'planks_ext', 'planks_green', 'planks_blue', 'planks_brown'],
  roof_iron: ['roof_iron', 'roof_iron', 'roof_iron_clean', 'roof_iron_green', 'roof_iron_red'],
  roof_tiles: ['roof_tiles', 'roof_tiles', 'roof_slate'],
};
function reskin(bp: Blueprint, seed: number): Blueprint {
  if (bp.shell || bp.whole || bp.dress) return bp;
  const dice = new RNG(seed ^ 0x5c1a7), chosen = new Map<MatKey, MatKey>();
  const as = (key: MatKey): MatKey => {
    const list = SKINS[key];
    if (!list) return key;
    if (!chosen.has(key)) chosen.set(key, list[Math.floor(dice.next() * list.length) % list.length]);
    return chosen.get(key)!;
  };
  const outer = (walls: WallDef[]) => walls.map((wd) => (wd.side === 'inner' ? wd : { ...wd, ext: as(wd.ext) }));
  // (in this order always: the face, then the roof)
  const ext = as(bp.ext), walls = outer(bp.walls), upper = bp.upper ? { ...bp.upper, walls: outer(bp.upper.walls) } : undefined;
  return { ...bp, ext, walls, ...(upper ? { upper } : {}), roof: as(bp.roof) };
}
/** how high the oil paint goes up an inside wall */
const DADO = 1.45;
/** what is big enough, and plain enough, for its picture to be seen coming round again */
const MACRO = new Set<MatKey>(['plaster_ext', 'brick_ext', 'planks_ext', 'int_plaster', 'int_painted', 'floor_concrete', 'roof_iron', 'roof_tiles', 'concrete', 'ceiling', 'ward_wall', 'office_wall', 'tile_wall', 'cell_wall', 'bitumen', 'hosp_ext', 'ochre_ext', 'plinth', 'ward_dado', 'office_dado', 'tile_dado', 'cell_dado']);
/** a slow change of tone by where in the world a thing is (see `material`) */
const macroTone = (shader: { vertexShader: string; fragmentShader: string }) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vMacroW;')
    // (where in the world a point is: of a thing drawn as one line of a list, that is through its own line of it)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\nvMacroW = ( modelMatrix * instanceMatrix * vec4( position, 1.0 ) ).xyz;\n#else\nvMacroW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;\n#endif');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vMacroW;
float macroHash( vec3 p ) { return fract( sin( dot( p, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ); }
float macroNoise( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( macroHash( i ), macroHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ), mix( macroHash( i + vec3( 0.0, 1.0, 0.0 ) ), macroHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
    mix( mix( macroHash( i + vec3( 0.0, 0.0, 1.0 ) ), macroHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ), mix( macroHash( i + vec3( 0.0, 1.0, 1.0 ) ), macroHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ),
    f.z );
}`,
    )
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
{
  float macroT = macroNoise( vMacroW * 0.19 ) * 0.62 + macroNoise( vMacroW * 0.61 + 11.0 ) * 0.38;
  diffuseColor.rgb *= 0.86 + 0.28 * macroT;
}`,
    );
};

export interface Opening {
  a: number; // start along wall (building-local coordinate on the wall axis)
  b: number;
  bottom: number;
  top: number;
  /** (`grille`: bars from `bottom` to `top`, as a cell has: a body does not pass, the eye and a shot do) */
  kind: 'door' | 'window' | 'gap' | 'grille';
  /** a window boarded up from outside: planks nailed across it, and no glass left in it */
  boards?: boolean;
  /** a window with bars over it outside */
  bars?: boolean;
  /** it leads into another part of the same building (see Blueprint.joined), not out of doors: no step before it */
  join?: boolean;
}

/**
 * What the outside of a building has on it beside its walls: everything that makes a wall a face. All of it stands
 * a hair proud of the wall it is on, and no face of any of it lies in a face of anything else.
 */
export interface Dress {
  /** the foot of the wall: how high, and of what */
  plinth?: { h: number; key: MatKey };
  /** a band round the building at every floor, and one under the wall round the roof */
  bands?: MatKey;
  /** a lintel over every window and a sill under it */
  trim?: MatKey;
  /** flat piers up the face, from the plinth to the top: where along each side (the building's own x, or z for its ends), how wide */
  piers?: { front?: number[]; back?: number[]; left?: number[]; right?: number[]; w: number; key: MatKey };
  /** inside: which paint has which oil paint under it, to the height of a shoulder */
  dado?: Partial<Record<MatKey, MatKey>>;
}

export interface WallDef {
  side: 'front' | 'back' | 'left' | 'right' | 'inner';
  from?: [number, number];
  to?: [number, number];
  ext: MatKey;
  int: MatKey;
  openings: Opening[];
  /** added after the map's dice were cast: its doors are hung shut and throw none (a door's two throws moved every yard after them) */
  still?: boolean;
  /**
   * Stretches of an outside wall that another part of the same building stands against on this floor (the
   * building's own measure along the wall): the wall is there, and nothing of its face is put on them.
   */
  covered?: [number, number][];
}

export type Side = 'front' | 'back' | 'left' | 'right';

export interface Furn {
  id: string;
  x: number;
  z: number;
  rot: number;
  scale?: number;
  y?: number;
  /** a rack (see RACKS): the boards of it that a thing is kept on, counted from the lowest (0) */
  on?: number[];
}

/** A floor above the ground one: its own walls, what stands in it and what is found there (heights from its own floor). */
export interface Upper {
  h: number;
  int: MatKey;
  floor: MatKey;
  walls: WallDef[];
  furniture: Furn[];
  loot: [number, number, number][];
}

/** A straight flight of stairs along z: x0 to x1 wide, its foot at z = foot on the floor, its head at z = top on the floor above. */
export interface Stairs {
  x0: number;
  x1: number;
  foot: number;
  top: number;
}

/** A floor above the ground one, in a building of several (see Blueprint.levels). */
export interface Level extends Upper {
  /** what is kept on this floor, where that is not what the building at large is for */
  usage?: Usage[];
}

/**
 * A stairwell, the same on every floor: out from the floor along z to a landing half way up, and back beside
 * the way out to the floor above. `x0`..`x1` is how wide it is (each half flight a little under half of that);
 * `land` is the z at which the flights leave a floor and come to the next, `far` the z of the well's far end,
 * where the landing is. It goes from the ground to the roof, or only as far as the floor numbered `upTo` (1 is
 * the first above the ground).
 */
export interface Well {
  x0: number;
  x1: number;
  land: number;
  far: number;
  upTo?: number;
}

/** A flat roof that is walked on: a wall round its edge, and a room over the head of each stair. */
export interface Deck {
  /** how high the wall round the edge stands over the roof */
  parapet: number;
  /** how high the rooms on it are, and their walls (side 'inner': the roof has no sides of its own) */
  h: number;
  walls: WallDef[];
  /** the roof of each of those rooms */
  roofs: { x0: number; x1: number; z0: number; z1: number }[];
  /** plain shapes that stand on it (a vent, a tank, a mast): heights from the roof */
  boxes: { key: MatKey; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; soft?: boolean }[];
  furniture: Furn[];
  loot: [number, number, number][];
  usage?: Usage[];
  /** places on it that always hold a thing: which thing, and which of `loot` (by its x and z) */
  keeps?: { id: string; x: number; z: number }[];
  /** where the wall round its edge is left out: the way onto another roof beside it, or onto stairs outside */
  open?: { side: Side; a: number; b: number }[];
}

/**
 * Stairs of steel outside a wall, for getting out by: a landing at the door of every floor above the ground, and
 * between one landing and the next two half flights that turn on a landing of their own, the lower under the
 * upper. `at`: where along the wall the doors are (the building's own measure); `dir`: which way along the wall
 * the flights run from the doors (1: the way the measure grows); `floors`: how many floors above the ground have
 * a door onto it; `roof`: it goes on up to the roof (whose wall is left open there: see Deck.open).
 */
export interface Escape {
  side: Side;
  at: number;
  dir: 1 | -1;
  floors: number;
  roof?: boolean;
}

/** Shapes inside a floor that are not walls: bars, a counter, a plinth. Heights from that floor. */
export interface Fitting { key: MatKey; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; soft?: boolean; glass?: boolean }

export interface Blueprint {
  w: number;
  d: number;
  h: number;
  upper?: Upper;
  stairs?: Stairs;
  /**
   * The floors above the ground one, where there are more than one of them (or a roof that is walked on): then
   * `upper` and `stairs` are not used. With `wells` for the stairs between them and `deck` for the roof.
   */
  levels?: Level[];
  wells?: Well[];
  deck?: Deck;
  /** bars, counters and the like: by floor (0 is the ground) */
  fittings?: { level: number; list: Fitting[] }[];
  /** what its outside is called over its door: where the board hangs, and what it says */
  /** (`out`: how far before the wall, when it stands on something built out from it; `size`: how many times the usual board) */
  sign?: { x: number; y: number; text: string; sub: string; board?: string; ink?: string; out?: number; size?: number };
  /** what its outside has on it beside its walls (see Dress) */
  dress?: Dress;
  /**
   * The sides it has no wall on, because it is one part of a building of several and another part's wall is there
   * (2026-10-12: "i dont like the rigid box style we have, can we not come up with more creative layouts?"). A
   * building that is not one box is several of these stood against one another, their floors at one height: a
   * wing has no wall where it meets the block it is a wing of, its floors run on to that block's wall, and the way
   * between the two is a door in that wall (an Opening with `join`).
   */
  joined?: Side[];
  /** stairs of steel outside it (see Escape) */
  escapes?: Escape[];
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
          // a closet in the corner of the bedroom, a door on it: room for one to stand in with the door shut
          { side: 'inner', from: [1.4, -3.05], to: [1.4, -1.95], ext: 'int_plaster', int: 'int_painted', openings: [door(-2.9, -2.1)], still: true },
          { side: 'inner', from: [0.5, -1.85], to: [1.5, -1.85], ext: 'int_plaster', int: 'int_painted', openings: [] },
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
          // a closet in the corner of the bedroom, a door on it: room for one to stand in with the door shut
          { side: 'inner', from: [-2.6, -3.55], to: [-2.6, -2.45], ext: 'int_plaster', int: 'int_plaster', openings: [door(-3.4, -2.6)], still: true },
          { side: 'inner', from: [-2.7, -2.35], to: [-1.7, -2.35], ext: 'int_plaster', int: 'int_plaster', openings: [] },
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
          // (2026-10-13: a long rack against the back wall, under the high windows, with what was stored on it)
          { id: 'rack_wide', x: -1.6, z: -3.47, rot: 0, on: [1] },
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
          // ("the white shelves clip through the walls on the 2 store red birck buildings of kamenka", 2026-10-12.
          // Two things were wrong, both found by rays through the model's own file (assets-src/_wf/me/ray-at.mjs).
          // A thing is stood by its middle, so a shelf a quarter of a metre deep with its middle at 7.02 had its
          // back half in a wall whose inner face is at 7.038. And the walls at the two ends are mostly window: the
          // cabinet stood across one, and the shelf upstairs filled the metre between two, frame to frame. Each is
          // now against a stretch of wall with nothing in it: the shelf beside the front window, the cabinet on
          // the side wall of the back room, the shelf upstairs on the other side wall of the room over it.)
          { id: 'painted_wooden_cabinet', x: -1.9, z: -6.1, rot: Math.PI / 2 },
          { id: 'Shelf_01', x: -1.68, z: 6.9, rot: Math.PI },
          // upstairs
          { id: 'old_bed_frame', x: -1.6, z: -5.95, rot: 0, y: 3.294 },
          { id: 'old_bed_frame', x: 4.65, z: -4.3, rot: 0, y: 3.294 },
          { id: 'painted_wooden_cabinet', x: 0.78, z: 6.72, rot: Math.PI, y: 3.294 },
          { id: 'Shelf_01', x: 3.68, z: -6.2, rot: -Math.PI / 2, y: 3.294 },
        ],
        loot: [
          [0.3, 0.57, -5.6], [0.9, 0.57, -5.6], [-1.9, 1.2, -6.1], [-1.68, 0.44, 6.9], [-1.68, 1.24, 6.9],
          [2.6, 0.02, -6.3], [-1.4, 0.02, 1.7], [3.1, 0.02, 6.4],
          [-1.6, 3.774, -5.55], [4.65, 3.774, -3.9], [0.78, 4.494, 6.72], [3.68, 3.734, -6.2], [3.68, 4.534, -6.2],
          [-3.0, 3.314, -4.8], [0.3, 3.314, 3.1], [3.0, 3.314, 6.3],
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
          [-1.9, 0.371, -6.4], [3.6, 0.371, -5.9], [-1.4, 0.371, 3.1], [3.6, 0.371, 4.1],
          // (measured in the game, a ray down from each: its first floor is boards at two heights nine centimetres apart)
          [-0.9, 3.072, -6.4], [3.6, 2.982, -3.4], [-1.4, 2.982, -0.4], [3.1, 2.982, -0.9], [2.1, 3.072, 3.6], [3.6, 3.012, 6.6],
          // (These two lay on the decks on the roof, which nothing leads up to: "spawns loot on the roof but theres
          // no way to get to the roof", 2026-10-12. They are on the first floor now, where the model's own file says
          // there is floor at that height and a roof over it: assets-src/_wf/me/floor-at.mjs. Two places still, and
          // in the same turn, so that every place after them keeps its number.)
          [3.35, 2.982, -2.15], [-1.4, 2.982, 1.5],
        ],
        usage: ['Hunting', 'Industrial'],
      };
    case 'tent':
      // The army's tent (a download: `tent_military`), all of it the model's: canvas on a frame, one room, six
      // windows, and its doorway in the end that is this building's front. It has no floor but the ground. Cots
      // down one side, a table and the cases down the other. (Its walls lean in: nothing stands within half a
      // metre of them.)
      return {
        w: 6.3, d: 8.5, h: 2.2, ext: 'planks_ext', int: 'planks', floor: 'floor_wood', roof: 'roof_iron', roofType: 'flat',
        whole: { model: 'tent_military', lift: 0, surface: 'cloth', floors: [], doors: [] },
        walls: [],
        furniture: [
          { id: 'old_bed_frame', x: -1.55, z: -2.9, rot: 0 },
          { id: 'old_bed_frame', x: -1.55, z: -0.5, rot: 0 },
          { id: 'old_bed_frame', x: 1.55, z: -2.9, rot: 0 },
          { id: 'WoodenTable_01', x: 1.75, z: 0.3, rot: Math.PI / 2 },
          { id: 'weapons_case', x: 1.5, z: 2.2, rot: 0.25 },
        ],
        loot: [
          [-1.55, 0.5, -2.9], [-1.55, 0.5, -0.5], [1.55, 0.5, -2.9], [1.75, 0.57, 0.0], [1.75, 0.57, 0.6],
          [0, 0.02, -3.3], [-1.5, 0.02, 1.6], [0.1, 0.02, 0.4],
        ],
        usage: ['Military'],
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
          { id: 'Shelf_01', x: -3.73, z: 2.14, rot: Math.PI },
          { id: 'WoodenTable_01', x: -0.9, z: 1.5, rot: 0 },
          { id: 'painted_wooden_chair_01', x: -1.3, z: 2.02, rot: Math.PI },
          { id: 'painted_wooden_chair_01', x: -0.5, z: 0.9, rot: 0 },
          { id: 'weapons_case', x: 2.8, z: 1.9, rot: 0 },
          // the lobby
          { id: 'Shelf_01', x: 6.0, z: 0.66, rot: Math.PI },
          // the store room
          { id: 'steel_frame_shelves_01', x: 6.29, z: 1.64, rot: -Math.PI / 2, scale: 0.1 },
          { id: 'wooden_crate_01', x: 5.3, z: 1.95, rot: 0 },
          // (2026-10-13: a locker, on the pier between the third window and the fourth)
          { id: 'steel_locker', x: 1.16, z: 1.98, rot: Math.PI },
        ],
        loot: [
          [-5.95, 0.48, -0.85], [-4.35, 0.48, -0.85], [-2.75, 0.48, -0.85], [-1.15, 0.48, -0.85], [0.45, 0.48, -0.85], [2.05, 0.48, -0.85],
          [-6.26, 1.2, 1.2], [-3.73, 0.44, 2.09], [-3.73, 1.24, 2.09], [-1.2, 0.57, 1.5], [-0.6, 0.57, 1.5],
          [6.0, 0.44, 0.61], [6.0, 1.24, 0.61],
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
          { id: 'Shelf_01', x: -0.9, z: -1.26, rot: 0 },
          { id: 'wooden_crate_01', x: 1.15, z: -1.0, rot: 0.25 },
          // (2026-10-13: a rack down the wall that has no window in it)
          { id: 'rack_small', x: -1.47, z: 0.35, rot: Math.PI / 2, on: [2] },
        ],
        loot: [[-0.9, 0.44, -1.3], [-0.9, 1.24, -1.3], [1.15, 0.37, -1.0], [0.6, 0.02, 0.6]],
        usage: ['Farm', 'Industrial'],
      };
    case 'cabin':
      return {
        w: 6, d: 5, h: 2.6, ext: 'planks_ext', int: 'planks', floor: 'floor_wood', roof: 'roof_tiles', roofType: 'gable',
        walls: [
          { side: 'front', ext: 'planks_ext', int: 'planks', openings: [door(-0.5, 0.5)] },
          { side: 'back', ext: 'planks_ext', int: 'planks', openings: [win(-1.6, -0.6)] },
          { side: 'left', ext: 'planks_ext', int: 'planks', openings: [win(-0.5, 0.5)] },
          { side: 'right', ext: 'planks_ext', int: 'planks', openings: [win(0.2, 1.0)] },
          // a closet in the back corner, boarded off, a door on it: room for one to stand in with the door shut
          { side: 'inner', from: [-1.9, -2.3], to: [-1.9, -1.2], ext: 'planks', int: 'planks', openings: [door(-2.15, -1.35)], still: true },
          { side: 'inner', from: [-2.8, -1.1], to: [-1.8, -1.1], ext: 'planks', int: 'planks', openings: [] },
        ],
        furniture: [
          { id: 'old_bed_frame', x: 2.3, z: -1.3, rot: 0 },
          { id: 'WoodenTable_01', x: -1.5, z: 1.0, rot: Math.PI / 2 },
          { id: 'painted_wooden_chair_01', x: -0.8, z: 1.0, rot: -Math.PI / 2 },
          { id: 'wooden_bookshelf_worn', x: 0.6, z: -2.0, rot: 0 },
        ],
        // (the last of them is on the closet's floor)
        loot: [[2.3, 0.48, -0.9], [-1.5, 0.57, 0.7], [-1.5, 0.57, 1.3], [0.6, 0.56, -2.0], [0.6, 1.02, -2.0], [-2.4, 0.02, -1.75]],
        usage: ['Hunting'],
      };
    case 'flats':
      // (a block of four flats: see flatsPlan)
      return flatsPlan(ext, rng.chance(0.6) ? 'roof_tiles' : 'roof_iron', rng.chance(0.5) ? 'floor_wood' : 'floor_lino');
    case 'hospital':
      return hospitalPlan();
    case 'hospital_wing':
      return hospitalWingPlan();
    case 'hospital_lobby':
      return hospitalLobbyPlan();
    case 'police_hq':
      return policeHqPlan();
    case 'police_cells':
      return policeCellsPlan();
    case 'police_garage':
      return policeGaragePlan();
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
          // (2026-10-13: the men's lockers, in the hall against the armoury's wall)
          { id: 'steel_locker', x: 2.6, z: 1.6, rot: -Math.PI / 2 },
          { id: 'steel_locker', x: 2.6, z: 2.75, rot: -Math.PI / 2 },
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
          { id: 'Shelf_01', x: -2.2, z: 3.41, rot: Math.PI },
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
          [-2.2, 0.44, 3.36], [-2.2, 1.24, 3.36],
          [3.4, 0.81, 1.4], [4.4, 0.81, 1.4], [4.98, 0.56, -0.1], [4.98, 1.02, -0.1], [0.85, 1.2, -3.2],
          [2.6, 0.14, -3.28], [2.6, 0.74, -3.28], [2.6, 1.34, -3.28], [3.9, 0.14, -3.28], [3.9, 0.74, -3.28], [3.9, 1.34, -3.28],
          [5.03, 0.14, -2.2], [5.03, 0.74, -2.2], [5.03, 1.34, -2.2],
          [3.2, 0.02, -2.0], [-3.4, 0.02, 1.2], [0.3, 0.02, 1.8], [0.2, 0.02, -1.8],
        ],
        usage: ['Medic'],
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
          // (2026-10-14: "the white shelves sink into the walls, wherever we use them": a shelf is drawn by its middle, and these
          // and the shed's, the huts', the clinic's and the barracks' stood with their backs in the wall. Each now clear of it,
          // its places for things moved with it.)
          { id: 'Shelf_01', x: -2.4, z: -0.96, rot: 0 },
          { id: 'Shelf_01', x: -1.3, z: -0.96, rot: 0 },
          { id: 'Shelf_01', x: -0.2, z: -0.96, rot: 0 },
          { id: 'Shelf_01', x: 0.9, z: -0.96, rot: 0 },
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
          // (2026-10-13: a rack in the shop, in the corner by the window, and a long one in the stock room against
          // the wall the shop's shelves are the other side of, each with goods on it)
          { id: 'rack_small', x: 4.47, z: 2.62, rot: -Math.PI / 2, on: [1, 2] },
          { id: 'rack_wide', x: -2.3, z: -1.63, rot: Math.PI, on: [1] },
        ],
        loot: [
          [-2.4, 0.81, 0.3], [-1.4, 0.81, 0.3], [-0.35, 0.81, 0.3], [0.65, 0.81, 0.3],
          [-2.4, 0.44, -0.9], [-2.4, 1.24, -0.9], [-1.3, 1.24, -0.9], [-0.2, 0.44, -0.9], [0.9, 0.44, -0.9], [0.9, 1.24, -0.9],
          [-4.53, 0.14, -0.4], [-4.53, 0.74, -0.4], [-4.53, 1.34, -0.4],
          [4.53, 0.74, 0.0], [4.53, 1.34, 0.0], [4.53, 0.14, 1.3], [4.53, 0.74, 1.3],
          [2.3, 0.56, 2.1], [2.3, 1.02, 2.1],
          [1.0, 0.14, -3.03], [1.0, 0.74, -3.03], [2.3, 0.74, -3.03], [2.3, 1.34, -3.03],
          [-3.0, 0.02, 1.8], [0.6, 0.02, 2.3], [3.5, 0.02, -2.2], [-3.0, 0.02, -2.3],
        ],
        // (a shop is its own kind of place as well: food, drink and dressings are kept here before anywhere)
        usage: ['Shop'],
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
          { id: 'Shelf_01', x: -3.45, z: 2.91, rot: Math.PI },
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
          // (2026-10-13: the men's lockers, at the end of the room of beds, against the wall of the arms room)
          { id: 'steel_locker', x: 3.2, z: -0.6, rot: -Math.PI / 2 },
          { id: 'steel_locker', x: 3.2, z: -1.75, rot: -Math.PI / 2 },
        ],
        loot: [
          [5.0, 0.02, 0.3], [4.9, 0.02, -1.6],
          [-5.6, 0.48, -1.6], [-4.0, 0.48, -1.6], [-2.4, 0.48, -1.6], [-0.8, 0.48, -1.6], [0.8, 0.48, -1.6],
          [2.5, 1.2, -2.75], [-3.45, 0.44, 2.86], [-3.45, 1.24, 2.86], [-2.9, 0.57, 1.4], [-2.3, 0.57, 1.4],
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
          // (2026-10-13: a rack of parts at the back of the bay, between the window and the fuse box)
          { id: 'rack_small', x: -0.9, z: -2.97, rot: 0, on: [1, 2] },
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
          // The cupboard under the stairs: the corner under the landing, behind the boards the flight ends in, was a
          // nook open to the hall. A wall across the way into it, with a door: room for one to stand in with it shut.
          { side: 'inner', from: [3.2, -3.3], to: [3.2, -2.0], ext: 'int_plaster', int: 'int_painted', openings: [door(-3.15, -2.35)], still: true },
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
          // (The one that lay on the hall floor is in the cupboard now. No place is added: what the server keeps
          // between restarts goes by a place's number, and one more here would renumber every place after it.)
          [1.4, 0.67, -3.0], [1.4, 1.28, -3.0], [-0.42, 1.2, -1.4], [3.8, 0.02, -2.7], [-2.0, 0.02, 2.6],
        ],
        upper: {
          h: 2.6, int: 'int_painted', floor: 'floor_wood',
          walls: [
            { side: 'front', ext, int: 'int_painted', openings: [win(-3.7, -2.6), win(-0.6, 0.5), win(1.5, 2.6)] },
            { side: 'back', ext, int: 'int_painted', openings: [win(-3.5, -2.4), win(1.3, 2.4)] },
            { side: 'left', ext, int: 'int_painted', openings: [win(-0.6, 0.6)] },
            { side: 'right', ext, int: 'int_painted', openings: [win(-0.5, 0.6)] },
            // (The wall between the two rooms stood at 0.2: in the middle of the window over the front door, which is
            // from -0.6 to 0.5, and in the back one's frame. It stands clear of both now, a hand's breadth past the
            // front window's jamb; the back window has moved along its wall, and the near room's things with the wall.)
            { side: 'inner', from: [0.8, -3.3], to: [0.8, 3.3], ext: 'int_plaster', int: 'int_painted', openings: [door(-3.05, -2.15)] },
          ],
          furniture: [
            // (the far room: a bed in the corner, books, a table to sit at; nothing across the way in from the door)
            { id: 'old_bed_frame', x: -3.8, z: -2.1, rot: 0 },
            { id: 'wooden_bookshelf_worn', x: -4.02, z: 1.5, rot: Math.PI / 2 },
            { id: 'painted_wooden_cabinet', x: -1.5, z: 3.0, rot: Math.PI },
            { id: 'WoodenTable_01', x: -1.3, z: -0.3, rot: Math.PI / 2 },
            { id: 'painted_wooden_chair_01', x: -1.95, z: -0.3, rot: Math.PI / 2 },
            // (the near one, beside the stair well: the bed along the wall, a desk under the window, and room to walk between the bed and the rail)
            { id: 'old_bed_frame', x: 1.4, z: 0.2, rot: 0 },
            { id: 'Shelf_01', x: 1.04, z: 1.9, rot: Math.PI / 2 },
            { id: 'metal_office_desk', x: 2.25, z: 2.8, rot: Math.PI },
            { id: 'SchoolChair_01', x: 2.25, z: 1.95, rot: 0 },
          ],
          loot: [
            [-3.8, 0.48, -1.7], [-4.02, 0.67, 1.5], [-4.02, 1.28, 1.5], [-1.5, 1.2, 3.0], [-1.3, 0.57, -0.3],
            [1.4, 0.48, 0.5], [1.04, 0.94, 1.9], [1.04, 1.51, 1.9], [1.85, 0.81, 2.8], [2.65, 0.81, 2.8], [-2.4, 0.02, 1.0], [2.3, 0.02, -0.4], [3.8, 0.02, 2.7],
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

/** a door's two handles as one shape: one on each face of the leaf */
const HANDLES = mergeGeometries([new THREE.BoxGeometry(0.12, 0.03, 0.05).translate(0, 0, 0.05), new THREE.BoxGeometry(0.12, 0.03, 0.05).translate(0, 0, -0.05)], false)!;
/** how far off a door's handle is still drawn, metres: it is a finger's length of steel */
const HANDLE_SEEN = 45;

/**
 * Every door leaf of one size, and every door handle, drawn in one go (2026-10-12). Each leaf was a thing of its
 * own to draw, a box of twelve triangles, and its handle another: in Kamenka three hundred of the picture's nine
 * hundred draws were door leaves, and they were drawn again in each of the sun's shadow maps. The same boxes in the
 * same places with the same paint; a leaf is moved by writing where it is into its line of the one list.
 */
export class DoorBatch {
  private leaves = new Map<string, { mesh: THREE.InstancedMesh; n: number }>();
  private handles: THREE.InstancedMesh;
  private nHandles = 0;

  constructor(scene: THREE.Scene, doors: Door[], mat: THREE.Material, handleMat: THREE.Material) {
    const plain = doors.filter((d) => d.size);
    const count = new Map<string, number>();
    for (const d of plain) count.set(d.size!.join(), (count.get(d.size!.join()) ?? 0) + 1);
    for (const [key, n] of count) {
      const [w, h] = key.split(',').map(Number);
      const mesh = new THREE.InstancedMesh(boxGeo(0, w - 0.02, 0, h - 0.02, -0.025, 0.025, 1.2, new THREE.Matrix4()), mat, n);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.renderOrder = WALLS_FIRST;
      // (they stand all over the map: there is no one place to ask whether it is in sight)
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.name = `doors ${key}`;
      scene.add(mesh);
      this.leaves.set(key, { mesh, n: 0 });
    }
    this.handles = new THREE.InstancedMesh(HANDLES, handleMat, Math.max(1, plain.length));
    this.handles.frustumCulled = false;
    this.handles.matrixAutoUpdate = false;
    this.handles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.handles.name = 'door handles';
    scene.add(this.handles);
    for (const d of plain) {
      const l = this.leaves.get(d.size!.join())!;
      d.hang(this, l.mesh, l.n++, this.nHandles++);
    }
  }

  private static none = new THREE.Matrix4().makeScale(0, 0, 0);
  private static m = new THREE.Matrix4();

  /** a leaf is where its door's hinge now has it; its handle on it, if the handle is near enough to be drawn */
  place(d: Door, leaf: THREE.InstancedMesh, at: number, handle: number) {
    d.pivot.updateMatrix();
    leaf.setMatrixAt(at, d.pivot.matrix);
    leaf.instanceMatrix.needsUpdate = true;
    this.handles.setMatrixAt(handle, d.handleShown ? DoorBatch.m.makeTranslation(d.size![0] - 0.12, 1.0, 0).premultiply(d.pivot.matrix) : DoorBatch.none);
    this.handles.instanceMatrix.needsUpdate = true;
  }
}

export class Door {
  pivot = new THREE.Group();
  /** how wide and high its leaf is, if it is a door of the game's own making (a leaf out of a model is whatever it is) */
  size: [number, number] | null = null;
  /** whether its handles are near enough to be drawn (see HANDLE_SEEN) */
  handleShown = true;
  private drawn: { batch: DoorBatch; leaf: THREE.InstancedMesh; at: number; handle: number } | null = null;

  /** which line of which list its leaf and its handle are drawn from (see DoorBatch) */
  hang(batch: DoorBatch, leaf: THREE.InstancedMesh, at: number, handle: number) {
    this.drawn = { batch, leaf, at, handle };
    this.place();
  }

  private place() {
    if (this.drawn) this.drawn.batch.place(this, this.drawn.leaf, this.drawn.at, this.drawn.handle);
  }

  showHandle(on: boolean) {
    if (on === this.handleShown) return;
    this.handleShown = on;
    this.place();
  }

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

  constructor(world: THREE.Matrix4, width: number, height: number, _mat: THREE.Material, _handleMat: THREE.Material, public id: string, leaf?: { mesh: THREE.Object3D; surface: Surface }) {
    // pivot sits on the hinge edge; panel extends along +x
    world.decompose(this.pivot.position, this.baseQuat, new THREE.Vector3());
    this.pivot.quaternion.copy(this.baseQuat);
    if (leaf) {
      this.oneWay = true;
      this.swing = 1;
      this.pivot.add(leaf.mesh);
    } else {
      // (Its leaf and its handles are not things of their own: they are drawn with every other door's, see
      // DoorBatch. To the millimetre: a width worked out from a wall's two ends comes to 0.96 one time and
      // 0.9599999 the next, and those were two sizes of door.)
      this.size = [Math.round(width * 1000) / 1000, Math.round(height * 1000) / 1000];
    }
    // (Still but while it swings: its place in the world is made again only then (see `apply`). Five hundred hinges,
    // and what hangs on them, were each made again every frame, standing still: a third of all that was.)
    this.pivot.matrixAutoUpdate = false;
    this.pivot.updateMatrix();
    // (A door of the game's own making is drawn from DoorBatch, and its hinge holds nothing: it is not put in the
    // world (see `build`), where every frame's two walks over all there is went through four hundred of them. Its
    // place in the world is kept here; a bullet hole hung on it puts it in the world, see Effects.decal.)
    this.pivot.updateMatrixWorld();
    if (leaf) leaf.mesh.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
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
    // (a door of boards lets a round through: 2026-10-12, "wooden doors should be wall bangable". A leaf of steel does not.)
    physics.tag(this.collider, { surface: leaf?.surface ?? 'wood', owner: this, thin: !leaf });
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
    this.pivot.updateMatrix();
    this.pivot.updateMatrixWorld();
    this.place();
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
  /** the places on the boards of racks (see RACKS), kept by until every other place has been made: they go last */
  private racked: LootPoint[] = [];
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
    /** (said of the places every building has made, here; and of the racks' places, which come last of all, below) */
    const mark = (points: LootPoint[]) => {
      for (const p of points) if (gasDepth(gas, p.x, p.y, p.z) > GAS.breathe) p.usage = [...p.usage, 'Gas'];
      // and what is kept in Kamenka, the town in the east, is marked so too: it is stocked on its own (see `east` in the economy)
      for (const p of points) if (Math.hypot(p.x - TOWN.x, p.z - TOWN.z) < TOWN.stocked) p.usage = [...p.usage, 'East'];
      // And every place for a thing is told which step of the map it is on (src/sim/tiers.ts): the economy keeps each
      // sort of thing on the steps it belongs to. The second step is the village, the checkpoint, and the army's and
      // the trader's places; whatever is none of those, nor in Kamenka, nor under the gas, is the outskirts.
      const second = [
        { x: this.world.pois[0].x, z: this.world.pois[0].z, r: 125 },
        ...this.world.pois.filter((q) => /checkpoint/i.test(q.name)).map((q) => ({ x: q.x, z: q.z, r: 70 })),
        ...this.world.sites.filter((st) => st.kind === 'depot' || st.kind === 'market' || st.kind === 'tents').map((st) => ({ x: st.x, z: st.z, r: 60 })),
      ];
      for (const p of points) p.tier = p.usage.includes('Gas') ? 4 : p.usage.includes('East') ? 3 : second.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < q.r) ? 2 : 1;
    };
    mark(this.lootPoints);
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
        this.lootPoints.push({ x, y: wy + (floor ? 0.02 : 0.003), z, usage: ['Bunker'], building: 'bunker', floor, tier: 5, ...(surf ? { surf } : {}) });
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
    // And the places on the boards of the racks (RACKS): after every other place on the map, the bunker's too, so
    // that not one of those is renumbered. Each is of the kind its building is, and on the step of the map that
    // building stands on, as that building's other places are.
    mark(this.racked);
    this.lootPoints.push(...this.racked);
    // The leaves of the containers, one at each end: after every other door, so that none of those is renumbered.
    const lot = new RNG(4471);
    this.containers.forEach((it, n) => {
      const m = containerMatrix(it);
      const { hx, hz, h, leaf } = CONTAINER;
      const ends = [new THREE.Matrix4().makeTranslation(-hx, 0, hz - 0.015), new THREE.Matrix4().makeTranslation(hx, 0, -hz + 0.015).multiply(new THREE.Matrix4().makeRotationY(Math.PI))];
      ends.forEach((e, k) => this.doorSpecs.push({ m: m.clone().multiply(e), w: leaf, h, id: `container${n}_${k}`, open: lot.chance(0.5), swing: 1, leaf: it.kind === CONTAINER.blue ? 1 : 0 }));
    });
    // and what stands in the grounds of the two big buildings: after every other thing, so that none is renumbered
    this.planGrounds();
    // (and the fences of the village's back yards: shapes only, after everything)
    this.planYards();
    // And what lies about the jeep that went off the bridge (see `wreckUnder` in src/sim/bridge.ts): places for
    // things on the ground of the cleft, after every other place on the map, so that none of those is renumbered.
    // What an army's jeep carried, on the step of the map the town beside it is on.
    for (const b of this.world.bridges) for (const [x, z] of wreckUnder(b).spots) this.lootPoints.push({ x, y: heightAt(this.world.heights, x, z) + 0.02, z, usage: ['Military', 'Hunting'], building: 'wreck', floor: true, tier: 3 });
    // And about the helicopter that came down behind the fort (`World.wreck`: see MOUNTAIN.crest in the generator):
    // five places on the ground round it, each so far along it and so far to one side. What it was bringing the
    // garrison: an army's, of the fourth step, in the open under two of the fort's towers.
    const heli = this.world.wreck;
    if (heli) {
      for (const [along, across] of [[4.9, 2.7], [1.4, -3.2], [-2.6, 2.9], [-5.6, -1.9], [7.3, -1.1]]) {
        const x = heli.x + Math.sin(heli.rot) * along + Math.cos(heli.rot) * across, z = heli.z + Math.cos(heli.rot) * along - Math.sin(heli.rot) * across;
        this.lootPoints.push({ x, y: heightAt(this.world.heights, x, z) + 0.02, z, usage: ['Military', 'Hunting'], building: 'wreck', floor: true, tier: 4 });
      }
    }
    // And the fort on the mountain (src/sim/castle.ts): its places for things, on the steps of the map it says, and
    // what stands in it off the shelf. The last lot of all: nothing else on the map is renumbered for it.
    const fort = this.world.castle;
    if (fort) {
      // (the ground as it is seen: over the hatch's stairwell that is the height it had before it was let down)
      const ground = (x: number, z: number) => heightAt(this.world.surface, x, z);
      for (const q of castleLoot(fort, ground)) this.lootPoints.push(q);
      // (Two crates of its store stand one on the other. What is searched is told by where it stands over the ground
      // and not by how high: the upper of two such is set a hand's breadth askew, and is a box of its own.)
      const stood = new Set<string>();
      for (const q of castleProps(fort, ground)) {
        const searched = CRATE_KINDS.has(q.kind.split(/[#@]/)[0]) || SEARCHED_KINDS.has(q.kind.split(/[#@]/)[0]);
        while (searched && stood.has(`${Math.round(q.x * 10)}_${Math.round(q.z * 10)}`)) q.x += 0.11;
        stood.add(`${Math.round(q.x * 10)}_${Math.round(q.z * 10)}`);
        this.world.props.push(q);
      }
    }
    // And the basements under some of the houses and the storm cellars by some barns (src/sim/basements.ts): after
    // the fort, the last of all, so that not one place on the map is renumbered for them.
    this.planBasements(mark);
  }

  /**
   * The basements: what they are made of (src/world/basement-build.ts), what stands in them, and their places for
   * things, each of the kind its room is (a root cellar's is a village's, a vault's the army's), stocked apart from
   * the rest of the map (`cellar` in src/sim/economy.ts: as part of it, they stood empty), on the step of the
   * map its house is on, or one or two steps better down a hideaway, a vault or a second level. Kept on the world:
   * the ground is told where it is open, and the server who may be down there.
   */
  private planBasements(mark: (points: LootPoint[]) => void) {
    const list = planBasements(this.world);
    this.world.basements = list;
    const kit: Kit = {
      box: (M, key, x0, x1, y0, y1, z0, z1, solid = true) => {
        this.push(key, boxGeo(x0, x1, y0, y1, z0, z1, this.tile(key), M));
        if (solid) this.collider((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, M.clone().multiply(new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)), MATS[key].surface);
      },
      flight: (M, plot, st, y0, y1, key) => void this.flight(M, plot, st, y0, y1, undefined, key),
    };
    const points: LootPoint[] = [], better: number[] = [];
    for (const b of list) {
      buildBasement(this.world, b, kit);
      for (const r of b.rooms) if (r.kind !== 'stair') this.interiors.push(roomVolume(b, r));
      for (const t of b.things) {
        const [x, z] = frameToWorld(b, t.x, t.z);
        this.world.props.push({ kind: t.id, x, y: t.y, z, rot: b.rot + t.rot, scale: 1, far: 40 });
      }
      for (const s of b.spots) {
        const [x, z] = frameToWorld(b, s.x, s.z);
        points.push({ x, y: s.y, z, usage: CELLAR_USAGE[b.rooms[s.room].kind], building: 'cellar', floor: s.floor });
        better.push(b.better[s.room]);
      }
    }
    mark(points);
    points.forEach((p, i) => (p.tier = Math.min(4, (p.tier ?? 1) + better[i]) as Tier));
    this.lootPoints.push(...points);
  }

  /**
   * What stands in the grounds of the hospital and of the headquarters (2026-10-12: "the new buildings need more,
   * character to them. the surroundings are boring, the path to the hospital is boring, everything is too plain").
   * Round each a wall of concrete slabs with slabs gone; lamps; what was left lying when the place was given up.
   * The hospital's: a gateway on its drive with its name over it, the dead laid out in rows before its doors and
   * the cots they ran out of room for, the cars the wounded came in. (The ground itself, the drive and the trees
   * are the map's: see HOSPITAL_GROUNDS in worldgen.)
   *
   * Everything is given in the building's own measure: x along its front, z out from its middle the way it faces.
   * After every other thing that stands anywhere: nothing is renumbered. Nothing here is searched, burns or is lit
   * by hand.
   */
  private planGrounds() {
    const H = this.world.heights, UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1), Q = Math.PI / 2;
    for (const plot of this.world.buildings) {
      if (plot.type !== 'hospital' && plot.type !== 'police_hq') continue;
      const c = Math.cos(plot.rot), s = Math.sin(plot.rot);
      const out = (lx: number, lz: number): [number, number] => [plot.x + lx * c + lz * s, plot.z - lx * s + lz * c];
      const ground = (lx: number, lz: number) => heightAt(H, ...out(lx, lz));
      /** a frame stood at a spot: its x turned `turn` from the building's, its floor the ground there (or `y`) */
      const frame = (lx: number, lz: number, turn = 0, y?: number) => {
        const [x, z] = out(lx, lz);
        return new THREE.Matrix4().compose(new THREE.Vector3(x, y ?? heightAt(H, x, z), z), new THREE.Quaternion().setFromAxisAngle(UP, plot.rot + turn), ONE);
      };
      const box = (M: THREE.Matrix4, key: Exclude<MatKey, 'glass'>, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, solid = true) => {
        this.push(key, boxGeo(x0, x1, y0, y1, z0, z1, this.tile(key), M));
        if (solid) this.collider((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, M.clone().multiply(new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)), MATS[key].surface);
      };
      /** a thing off the shelf, stood on the ground (`far`: seen only from so near: what is small) */
      const stand = (kind: string, lx: number, lz: number, turn = 0, o: { far?: number; scale?: number; up?: number } = {}) => {
        const [x, z] = out(lx, lz);
        this.world.props.push({ kind, x, y: heightAt(H, x, z) + (o.up ?? 0), z, rot: plot.rot + turn, scale: o.scale ?? 1, ...(o.far ? { far: o.far } : {}) });
      };
      /**
       * A wall of concrete slabs from one spot to another: a slab every two and a half metres between posts, each
       * on two feet, each stood on the ground where it is. `gone`: the slabs that are not there (counted from the
       * first end); `down`: of those, the ones that lie on the ground by their places.
       */
      const wall = (ax: number, az: number, bx: number, bz: number, gone: number[] = [], down: number[] = []) => {
        const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 2.5)), w = len / n, dx = (bx - ax) / len, dz = (bz - az) / len;
        const turn = Math.atan2(-dz, dx);
        for (let k = 0; k < n; k++) {
          const mx = ax + dx * w * (k + 0.5), mz = az + dz * w * (k + 0.5);
          const y = Math.min(ground(mx, mz), ground(mx - dx * w * 0.5, mz - dz * w * 0.5), ground(mx + dx * w * 0.5, mz + dz * w * 0.5)) - 0.1;
          const M = frame(mx, mz, turn, y);
          // a post at its first end (and at the wall's last end): where a slab is gone its posts still stand
          box(M, 'concrete', -w / 2 - 0.1, -w / 2 + 0.1, 0, 2.5, -0.1, 0.1);
          if (k === n - 1) box(M, 'concrete', w / 2 - 0.1, w / 2 + 0.1, 0, 2.46, -0.1, 0.1);
          if (gone.includes(k)) {
            // (flat on the ground on the yard's side of its place, a corner on its neighbour's foot)
            if (down.includes(k)) {
              // (on the side of the wall the building is)
              const side = -dz * -mx + dx * -mz > 0 ? 1 : -1, fx = mx - dz * 1.5 * side, fz = mz + dx * 1.5 * side;
              this.push('slab', boxGeo(-w / 2 + 0.25, w / 2 - 0.05, 0, 0.1, -1.1, 1.1, this.tile('slab'), frame(fx, fz, turn + 0.14 * (k % 2 ? 1 : -1), ground(fx, fz) + 0.02)));
            }
            continue;
          }
          for (const fx of [-w * 0.3, w * 0.3]) box(M, 'concrete', fx - 0.16, fx + 0.16, 0, 0.24, -0.17, 0.17, false);
          box(M, 'slab', -w / 2 + 0.03, w / 2 - 0.03, 0.2, 2.38, -0.045, 0.045);
        }
      };
      const dice = new RNG(plot.seed ^ 0x67d5);

      if (plot.type === 'hospital') {
        // ---- the wall round it: along the backs of the houses on the street either side of the drive, down both
        // ends, along the back
        wall(-33.2, 20.7, -14.2, 20.7, [3], [3]);
        wall(9.6, 20.7, 29.2, 20.7, [5]);
        wall(-33.2, 20.7, -33.2, -15.4, [2, 9, 10], [2]);
        // (round the wing: out behind it and back, a slab gone opposite the door at its far end)
        wall(-33.2, -15.4, -20.6, -15.4, [2], [2]);
        wall(-20.6, -15.4, -20.6, -26.3);
        wall(-20.6, -26.3, 1.4, -26.3, [3, 4]);
        wall(1.4, -26.3, 1.4, -15.4, [1]);
        wall(1.4, -15.4, 9.3, -15.4);
        wall(15.7, -15.4, 29.2, -15.4);
        wall(29.2, -15.4, 29.2, 20.7, [3, 4, 10], [10]);

        // ---- the gateway, where the drive leaves the street between the two houses: two brick piers, a beam
        // across them with the name of the place stood on it, and the two leaves of the gate swung back
        {
          const G = frame(0, 40.4);
          for (const sx of [-1, 1]) {
            box(G, 'brick_ext', sx * 2.85 - 0.3, sx * 2.85 + 0.3, -0.5, 3.3, -0.3, 0.3);
            box(G, 'concrete', sx * 2.85 - 0.37, sx * 2.85 + 0.37, 3.3, 3.4, -0.37, 0.37, false);
            // a leaf: uprights between three rails, open inward along the drive's edge and not quite square to it
            const L = frame(sx * 2.5, 40.06, sx * 0.13 + Math.PI / 2);
            for (let k = 0; k <= 13; k++) this.push('steel', boxGeo(0.12 + k * 0.165 - 0.011, 0.12 + k * 0.165 + 0.011, 0.16, 1.92 - Math.abs(k - 6.5) * 0.012, -0.011, 0.011, this.tile('steel'), L));
            for (const y of [0.22, 1.02, 1.8]) this.push('steel', boxGeo(0.06, 2.32, y - 0.02, y + 0.02, -0.018, 0.018, this.tile('steel'), L));
            this.collider(1.13, 0.9, 0.03, L.clone().multiply(new THREE.Matrix4().makeTranslation(1.19, 1.0, 0)), 'metal');
          }
          box(G, 'steel', -2.55, 2.55, 3.1, 3.22, -0.06, 0.06, false);
          this.signs.push({ m: G.clone().multiply(new THREE.Matrix4().makeTranslation(0, 3.22 + 0.49, 0)), text: 'ГОРБОЛЬНИЦА', sub: 'KAMENKA TOWN HOSPITAL', board: '#e4e0d4', ink: '#8c1f1f', size: 1.5 });
        }

        // ---- lamps: on the drive, round its bend, along the far edge of it before the front, at its end, and on
        // the bare ground before the doors
        for (const [lx, lz, turn] of [[2.85, 33.5, Q], [3.4, 19.4, 0.9], [-10.2, 18.0, 0], [-20.4, 18.0, 0], [-31.5, 5.6, Q], [12.6, 19.0, 0], [23.3, 12.4, Q]] as [number, number, number][]) stand('street_lamp_01', lx, lz, turn);

        // ---- the drive was shut: one block still across half of it, the other pushed off into the verge
        stand('concrete_road_barrier', -1.75, 36.6, 0.08);
        stand('concrete_road_barrier', 2.5, 29.6, 1.35);
        stand('surgical_trolley', 1.1, 26.2, 0.7, { far: 110 });
        stand('trashbag', -2.6, 24.6, 1.1, { far: 110 });

        // ---- before the doors, east of the drive: the dead in rows under their sheets, the row they did not
        // finish; the cots put out when the wards were full; a line of blocks to keep the town back; a car left
        for (const [k, lx] of [8.0, 9.25, 10.5, 11.75, 13.0, 14.25].entries()) stand('covered_body', lx, 10.3 + (k % 2) * 0.12, Q + dice.range(-0.07, 0.07), { far: 130 });
        for (const lx of [8.0, 9.25, 10.5]) stand('covered_body', lx, 12.9, Q + dice.range(-0.07, 0.07), { far: 130 });
        stand('covered_body', 12.5, 13.3, 0.5, { far: 130 });
        for (const [lx, lz, turn] of [[17.2, 10.0, 0.04], [18.8, 10.15, -0.05], [20.4, 9.9, 0.08], [19.3, 13.2, 1.3]] as [number, number, number][]) stand('old_bed_frame', lx, lz, turn, { far: 130 });
        stand('ward_curtain', 16.2, 10.0, Q, { far: 130 });
        stand('surgical_trolley', 21.3, 11.9, 0.5, { far: 110 });
        stand('cardboard_box_01', 16.6, 12.6, 0.3, { far: 110 });
        stand('cardboard_box_01', 17.1, 13.2, 1.2, { far: 110 });
        for (const [lx, lz, turn] of [[6.9, 18.5, 0.05], [10.3, 18.7, -0.06], [16.2, 18.5, 0.1], [19.5, 18.2, -0.2]] as [number, number, number][]) stand('concrete_road_barrier', lx, lz, turn);
        stand('covered_car', 21.2, 15.4, 1.25);
        stand('barrel_03', 5.3, 16.8, 0.4);
        stand('trashbag', 6.0, 17.4, 2.0, { far: 110 });
        stand('trashbag', 4.7, 17.6, 0.3, { far: 110 });
        stand('old_tyre', 22.4, 9.2, 0.8, { up: 0.08, far: 110 });
        // benches against the front, either side of the doors
        for (const lx of [-8.0, -17.6, 8.0]) stand('hospital_bench', lx, 8.43, 0);

        // ---- west of the doors, between the drive and the front: a bed for flowers inside a kerb, gone to fern
        {
          const B = frame(0, 0, 0, plot.floorY);
          const [x0, x1, z0, z1] = [-21.6, -8.8, 10.0, 11.8];
          box(B, 'concrete', x0, x1, -0.3, 0.05, z0 - 0.12, z0, false);
          box(B, 'concrete', x0, x1, -0.3, 0.05, z1, z1 + 0.12, false);
          box(B, 'concrete', x0 - 0.12, x0, -0.3, 0.043, z0 - 0.12, z1 + 0.12, false);
          box(B, 'concrete', x1, x1 + 0.12, -0.3, 0.043, z0 - 0.12, z1 + 0.12, false);
          for (let lx = x0 + 1.2; lx < x1 - 0.6; lx += 2.3) stand('fern_02', lx - 0.4, 10.9 + dice.range(-0.15, 0.15), dice.range(0, 6.28), { scale: dice.range(0.75, 1.05), far: 110 });
        }

        // ---- the west end: the car that brought the last of them, by the door under the stairs outside; a cot and a
        // trolley left beside it (clear of the foot of those stairs)
        stand('covered_car', -28.7, 1.6, 0.06);
        stand('old_bed_frame', -24.9, 2.4, Q, { far: 130 });
        stand('surgical_trolley', -25.5, 3.7, 0.2, { far: 110 });
        // ---- behind: drums and a tyre by the boiler's door
        stand('barrel_03', 9.8, -9.3, 0);
        stand('barrel_03', 10.5, -9.8, 1);
        stand('old_tyre', 2.6, -9.4, 0.5, { up: 0.08, far: 110 });
        stand('trashbag', 6.2, -9.1, 0.7, { far: 110 });
      } else {
        // ---- the headquarters stands in a cut in the hill: a wall at the foot of the bank down both sides of its
        // main block and across the back of it. (Clear of the stairs outside each end, and of where its car stands.)
        wall(-21, 4.4, -21, -11.4, [3], [3]);
        wall(-21, -11.4, 21, -11.4, [5, 11], [11]);
        wall(21, -11.4, 21, 4.4, [2]);
        // lamps at the mouth of the yard between its wings; blocks in the street before it, set so that whatever
        // drove up had to slow down and turn
        stand('street_lamp_01', -4.1, 19.5, Q);
        stand('street_lamp_01', 4.1, 19.5, Q);
        stand('concrete_road_barrier', -1.9, 23.6, 0.12);
        stand('concrete_road_barrier', 1.9, 27.2, -0.1);
        // what was driven: one left half out of the garage
        stand('covered_car', 12.3, 20.9, 0.05);
        stand('hospital_bench', 3.2, 6.93, 0);
        stand('barrel_03', 9.7, 19.15, 0.3);
        stand('old_tyre', 9.4, 22.6, 0.8, { up: 0.08, far: 110 });
        // behind: drums, tyres, what was thrown out of the back door
        stand('barrel_03', -16.6, -9.7, 0);
        stand('barrel_03', -15.8, -10.2, 1.3);
        stand('old_tyre', -18.4, -7.2, 0.4, { up: 0.08, far: 110 });
        stand('old_tyre', -18.1, -6.5, 2.0, { up: 0.08, far: 110 });
        stand('crate_big', -18.6, 2.6, 0.2);
        stand('trashbag', 1.7, -7.7, 0.3, { far: 110 });
        stand('trashbag', 2.4, -8.2, 1.8, { far: 110 });
        stand('metal_trash_can@1', -2.0, -7.3, 0);
      }
    }
  }

  /**
   * A yard behind each house of the village, with a fence round it (2026-10-12: "make some fences yard behind
   * them etc. we dont have vault yet so we need to make sure the player can jump over backyard fences"). A jump
   * lifts the feet 0.73 m: the fence is 0.62 m to the top of its top board, three boards on posts, and is jumped.
   * Down both sides of the yard from the house's back corners and across the back, a panel every two metres or so,
   * each stood on the ground where it is; a way through left in the back, and a panel gone here and there. No
   * panel where anything is: another building, a street, a tree, a thing lying about, another yard's fence, or
   * ground that falls away under it. Nothing is added to what stands in the world, so nothing is renumbered.
   */
  private planYards() {
    const H = this.world.heights, village = this.world.pois[0], UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
    // (to the knee: a jump clears 0.73 m from level ground, and a yard's ground is seldom level. At 0.62 it was
    // not cleared from ground that fell away a hand's breadth before it.)
    const TOP = 0.5, tile = this.tile('planks');
    const roads = [this.world.road, ...this.world.roads];
    const offRoad = (x: number, z: number) => {
      let best = 1e9;
      for (const r of roads) {
        const p = r.points;
        for (let i = 0; i + 5 < p.length; i += 3) {
          const ax = p[i], az = p[i + 2], dx = p[i + 3] - ax, dz = p[i + 5] - az;
          if (Math.abs(ax - x) > 60 || Math.abs(az - z) > 60) continue;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
          best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t) - r.width / 2);
        }
      }
      return best;
    };
    const inBuilding = (x: number, z: number, but: BuildingPlot, margin: number) =>
      this.world.buildings.some((o) => {
        if (o === but) return false;
        const [w, d] = BUILDING_FOOTPRINT[o.type], dx = x - o.x, dz = z - o.z, c = Math.cos(o.rot), s = Math.sin(o.rot);
        return Math.abs(dx * c - dz * s) < w / 2 + margin && Math.abs(dx * s + dz * c) < d / 2 + margin;
      });
    const lying = this.world.props.filter((q) => !q.far);
    const laid: [number, number][] = [];
    /** the yards fenced so far: no later yard's fence is run through one of them */
    const yards: { plot: BuildingPlot; x0: number; x1: number; z0: number; z1: number }[] = [];
    const inYard = (x: number, z: number) =>
      yards.some((y) => {
        const dx = x - y.plot.x, dz = z - y.plot.z, c = Math.cos(y.plot.rot), s = Math.sin(y.plot.rot), lx = dx * c - dz * s, lz = dx * s + dz * c;
        return lx > y.x0 + 0.4 && lx < y.x1 - 0.4 && lz > y.z0 + 0.4 && lz < y.z1 - 0.4;
      });
    for (const plot of this.world.buildings) {
      if (!['house_small', 'house_brick', 'house_two', 'flats'].includes(plot.type) || Math.hypot(plot.x - village.x, plot.z - village.z) > 175) continue;
      const [w, d] = BUILDING_FOOTPRINT[plot.type], c = Math.cos(plot.rot), s = Math.sin(plot.rot), dice = new RNG(plot.seed ^ 0x9a2d);
      const out = (lx: number, lz: number): [number, number] => [plot.x + lx * c + lz * s, plot.z - lx * s + lz * c];
      const deep = plot.type === 'flats' ? 9 : 7 + Math.floor(dice.next() * 3), x0 = -w / 2 - 1.0, x1 = w / 2 + 1.0, zb = -d / 2 - deep;
      // (down one side, across the back, up the other)
      const runs: [number, number, number, number, boolean][] = [[x0, -d / 2 + 0.5, x0, zb, false], [x0, zb, x1, zb, true], [x1, zb, x1, -d / 2 + 0.5, false]];
      for (const [ax, az, bx, bz, back] of runs) {
        const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 2.1)), L = len / n, dx = (bx - ax) / len, dz = (bz - az) / len;
        const gate = back ? Math.floor(n / 2) : -1;
        for (let k = 0; k < n; k++) {
          // (its dice are thrown whether or not it is stood, so that one panel's fate is not another's)
          const gone = dice.next() < 0.08;
          if (k === gate || gone) continue;
          const [sx, sz] = out(ax + dx * L * k, az + dz * L * k), [ex, ez] = out(ax + dx * L * (k + 1), az + dz * L * (k + 1)), mx = (sx + ex) / 2, mz = (sz + ez) / 2;
          const ya = heightAt(H, sx, sz), yb = heightAt(H, ex, ez);
          if (Math.abs(ya - yb) > 0.45) continue;
          if ([[sx, sz], [mx, mz], [ex, ez]].some(([x, z]) => inBuilding(x, z, plot, 0.5) || offRoad(x, z) < 0.9)) continue;
          if (lying.some((q) => Math.hypot(q.x - mx, q.z - mz) < 0.95) || this.world.trees.some((q) => Math.hypot(q.x - mx, q.z - mz) < 1.2)) continue;
          if (laid.some(([x, z]) => Math.hypot(x - mx, z - mz) < 1.0) || inYard(mx, mz)) continue;
          laid.push([mx, mz]);
          // a frame at its first end: x along it, the ground under its lower end
          const turn = plot.rot + Math.atan2(-dz, dx);
          const F = new THREE.Matrix4().compose(new THREE.Vector3(sx, Math.min(ya, yb) - 0.04, sz), new THREE.Quaternion().setFromAxisAngle(UP, turn), ONE);
          for (const px of [0, L]) this.push('planks', boxGeo(px - 0.035, px + 0.035, 0, TOP + 0.1, -0.035, 0.035, tile, F));
          for (const [y0, y1] of [[0.1, 0.2], [0.26, 0.36], [0.42, TOP + 0.04]]) this.push('planks', boxGeo(0.02, L - 0.02, y0, y1, 0.036, 0.058, tile, F));
          this.collider(L / 2, (TOP + 0.04) / 2, 0.045, F.clone().multiply(new THREE.Matrix4().makeTranslation(L / 2, (TOP + 0.04) / 2, 0.01)), 'wood');
        }
      }
      yards.push({ plot, x0, x1, z0: zb, z1: -d / 2 });
    }
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
    const reach = Math.hypot(hx, hz) + 3;
    for (let ix = Math.floor((it.x - reach - WORLD_X0) / CELL); ix <= Math.ceil((it.x + reach - WORLD_X0) / CELL); ix++) {
      for (let iz = Math.floor((it.z - reach - WORLD_Z0) / CELL); iz <= Math.ceil((it.z + reach - WORLD_Z0) / CELL); iz++) {
        if (ix < 0 || iz < 0 || ix >= WORLD_NX || iz >= WORLD_NZ) continue;
        const dx = WORLD_X0 + ix * CELL - it.x, dz = WORLD_Z0 + iz * CELL - it.z;
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
      // the army's camp: a fire where the lane crosses, cases and drums about it, blocks across the way in past the tower
      tents: [['stone_fire_pit', 0, 0], ['weapons_case', 2.4, -1.6], ['wooden_military_crate', -2.6, 1.4], ['old_military_crate@0', 2.2, 14.5], ['Barrel_01', -3.2, -14], ['barrel_03', -4.1, -13.1], ['crate_big', 3.4, -15], ['concrete_road_barrier', -5, 31], ['concrete_road_barrier', 0, 32], ['concrete_road_barrier', 5, 31], ['old_tyre', -4, 13], ['dry_branches_medium_01', 4.5, 3]],
      // Kamenka: cars left in the street, what a shop and a workshop put out, and two containers in the yard behind
      // the workshop. (The way out of the town was shut with two blocks across the end of its street, where the road
      // stopped. The road goes on from there now (LOOP in the generator), and the blocks lie where they were dragged
      // to, either side of it.)
      town: [
        ['covered_car', 5.3, -36], ['covered_car', -5.4, 30], ['covered_car', 5.2, 78], ['covered_car', -5.3, -70],
        ['concrete_road_barrier', -6.3, 96.5, 0], ['concrete_road_barrier', 6.6, 99, 0],
        ['wooden_crate_01', 17, -51], ['cardboard_box_01', 16.2, -38.5], ['Barrel_01', 17.2, -37.5], ['metal_trash_can@1', 5.6, -6], ['trashbag', 5.9, -7.2],
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
    const bp = reskin(blueprint(plot.type, rng), plot.seed);
    const B = new THREE.Matrix4().compose(
      new THREE.Vector3(plot.x, plot.floorY, plot.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), plot.rot),
      new THREE.Vector3(1, 1, 1),
    );
    const { w, d, h } = bp;
    const hw = w / 2, hd = d / 2;
    const joined = new Set<Side>(bp.joined ?? []);
    /** what is left of lo..hi when the stretches in `cut` are taken out of it */
    const spans = (lo: number, hi: number, cut: [number, number][]) => {
      const out: [number, number][] = [];
      let from = lo;
      for (const [a, b] of cut.map(([p, q]) => [Math.min(p, q), Math.max(p, q)]).sort((p, q) => p[0] - q[0])) {
        if (a > from) out.push([from, Math.min(a, hi)]);
        from = Math.max(from, b);
      }
      if (from < hi) out.push([from, hi]);
      return out.filter(([a, b]) => b - a > 0.02);
    };
    /** how high the walls stand in all: one floor, two with the floor between them, or however many there are */
    const H = bp.levels ? bp.levels.reduce((sum, l) => sum + SLAB + l.h, h) : bp.upper ? h + SLAB + bp.upper.h : h;
    this.interiors.push({ x: plot.x, z: plot.z, hw: hw - T, hd: hd - T, rot: plot.rot, y0: plot.floorY - 0.2, y1: plot.floorY + H });

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
      // (where it has no wall of its own, its floor runs on to the middle of the wall that is there)
      addBox(bp.floor, joined.has('left') ? -hw - T * 0.5 : -hw + T * 0.5, joined.has('right') ? hw + T * 0.5 : hw - T * 0.5, -0.12, 0, joined.has('back') ? -hd - T * 0.5 : -hd + T * 0.5, joined.has('front') ? hd + T * 0.5 : hd - T * 0.5, B);
    }
    // (The ceiling under a pitched roof: it stops a body. It was a picture of a ceiling and nothing else, and a jump in
    // a room went up through it into the roof: "ceilings in our buildings need collision so when you jump your camera
    // doesnt clip through the ceiling ... on all buildings and the ceilings of all floors", 2026-10-11.)
    if (bp.roofType !== 'flat' && !bp.whole) addBox(bp.upper?.int ?? bp.int, -hw + T, hw - T, H, H + 0.08, -hd + T, hd - T, B);

    // walls: of one floor, whose foot is at y0 and which is h high
    const outside: { F: THREE.Matrix4; a: number; b: number; front: boolean }[] = [];
    const panes: { F: THREE.Matrix4; a: number; b: number; bottom: number; top: number; L: number }[] = [];
    /** @param under how high a wall between two rooms goes, when a floor is laid over it (the outside walls go on up past the floor's edge) */
    const raise = (walls: WallDef[], y0: number, tall: number, under = tall) => {
      for (const wd of walls) {
        if (wd.side !== 'inner' && joined.has(wd.side)) continue;
        // (a wall between rooms stops under the floor above: carried up through it, its top lay in the same plane as the boards and the two flickered through each other)
        const h = wd.side === 'inner' ? under : tall;
        let a: THREE.Vector2, b: THREE.Vector2;
        switch (wd.side) {
          case 'front': a = new THREE.Vector2(-hw, hd - T / 2); b = new THREE.Vector2(hw, hd - T / 2); break;
          case 'back': a = new THREE.Vector2(hw, -hd + T / 2); b = new THREE.Vector2(-hw, -hd + T / 2); break;
          // (a side wall runs between the front wall and the back one: where one of those is not built, to the edge)
          case 'left': a = new THREE.Vector2(-hw + T / 2, joined.has('back') ? -hd : -hd + T); b = new THREE.Vector2(-hw + T / 2, joined.has('front') ? hd : hd - T); break;
          case 'right': a = new THREE.Vector2(hw - T / 2, joined.has('front') ? hd : hd - T); b = new THREE.Vector2(hw - T / 2, joined.has('back') ? -hd : -hd + T); break;
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
        const cov = (wd.covered ?? []).map(([p, q]): [number, number] => [Math.min(axisCoord(p), axisCoord(q)), Math.max(axisCoord(p), axisCoord(q))]);
        const hidden = (at: number) => cov.some(([p, q]) => at > p && at < q);
        if (wd.side !== 'inner' && y0 === 0 && !bp.shell) {
          // a skirt of concrete where the wall meets the ground, broken at the doors
          let from = 0;
          const pl = bp.dress?.plinth;
          const skirt = (to: number) => {
            for (const [p, q] of spans(from, to, cov)) {
              if (q - p <= 0.05) continue;
              if (pl) addBox(pl.key, p, q, -0.1, pl.h, T / 2 + 0.002, T / 2 + 0.055, F, false);
              else addBox('concrete', p, q, -0.1, 0.26, T / 2, T / 2 + 0.04, F, false);
            }
          };
          for (const o of ops) {
            if (o.kind === 'window' || o.kind === 'grille') continue;
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
            if (o.kind === 'window' || o.kind === 'grille') continue;
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
          // (inside: the half of an outside wall that is the room's, and both halves of a wall between rooms)
          const dado = z1 <= 0 || wd.side === 'inner' ? bp.dress?.dado?.[key] : undefined;
          const part = (x0: number, x1: number, ya: number, yb: number) => {
            if (x1 - x0 < 0.001 || yb - ya < 0.001) return;
            if (drawn && dado && ya < DADO - 0.01) {
              // (one piece of wall in two paints: the lower stands on the floor, the upper on it)
              addBox(dado, x0, x1, ya, Math.min(yb, DADO), z0, z1, F);
              if (yb > DADO) addBox(key, x0, x1, DADO, yb, z0, z1, F);
            } else if (drawn) addBox(key, x0, x1, ya, yb, z0, z1, F);
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
            // (boarded up: its glass went long ago)
            if (rng.chance(0.7) && !o.boards) {
              this.push('glass', boxGeo(o.a + fw, o.b - fw, o.bottom, o.top - fw, -0.006, 0.006, 1, F));
            }
            if (wd.side !== 'inner' && !hidden((o.a + o.b) / 2)) {
              const tr = bp.dress?.trim;
              if (tr) {
                // a lintel over it and a sill under it, of the wall's own stuff painted: each a hair off the wall
                addBox(tr, o.a - 0.12, o.b + 0.12, o.top - 0.003, o.top + 0.17, T / 2 + 0.002, T / 2 + 0.05, F, false);
                addBox(tr, o.a - 0.1, o.b + 0.1, o.bottom - 0.125, o.bottom - 0.044, T / 2 + 0.002, T / 2 + 0.095, F, false);
              }
              if (o.boards) {
                // planks nailed across it from outside, none of them quite level, a gap between each and the next
                const tall = o.top - o.bottom, n = Math.max(3, Math.round(tall / 0.3)), tile = this.tile('planks');
                for (let k = 0; k < n; k++) {
                  const y = o.bottom + (tall * (k + 0.5)) / n, lean = (((k * 7 + Math.round(o.a * 10)) % 5) - 2) * 0.035, wide = 0.085 + ((k * 3) % 4) * 0.008;
                  const P = F.clone().multiply(new THREE.Matrix4().makeTranslation((o.a + o.b) / 2, y, T / 2 + 0.035 + (k % 2) * 0.012)).multiply(new THREE.Matrix4().makeRotationZ(lean));
                  this.push('planks', boxGeo(-(o.b - o.a) / 2 - 0.16, (o.b - o.a) / 2 + 0.16, -wide, wide, -0.011, 0.011, tile, P));
                }
                // (and they stop a shot, as boards do)
                this.collider((o.b - o.a) / 2, tall / 2, 0.012, F.clone().multiply(new THREE.Matrix4().makeTranslation((o.a + o.b) / 2, (o.bottom + o.top) / 2, T / 2 + 0.035)), 'wood');
              }
              if (o.bars) {
                const bars = Math.max(2, Math.round((o.b - o.a) / 0.14)), tile = this.tile('steel');
                for (let k = 1; k < bars; k++) {
                  const x = o.a + ((o.b - o.a) * k) / bars;
                  this.push('steel', boxGeo(x - 0.009, x + 0.009, o.bottom + 0.02, o.top - fw, T / 2 - 0.05, T / 2 - 0.032, tile, F));
                }
                for (const at of [o.bottom + 0.3, o.top - 0.35]) this.push('steel', boxGeo(o.a + fw, o.b - fw, at - 0.012, at + 0.012, T / 2 - 0.058, T / 2 - 0.05, tile, F));
              }
            }
            // windows block movement but not bullets
            const c = new THREE.Matrix4().makeTranslation((o.a + o.b) / 2, (o.bottom + o.top) / 2, 0);
            this.collider((o.b - o.a) / 2, (o.top - o.bottom) / 2, 0.05, F.clone().multiply(c), 'glass', GLASS_GROUPS);
          } else if (o.kind === 'grille') {
            // bars: an upright every hand's breadth and two rails across them
            const bars = Math.max(2, Math.round((o.b - o.a) / 0.115)), tile = this.tile('steel');
            for (let k = 1; k < bars; k++) {
              const x = o.a + ((o.b - o.a) * k) / bars;
              this.push('steel', boxGeo(x - 0.012, x + 0.012, o.bottom, o.top - fw, -0.012, 0.012, tile, F));
            }
            for (const at of [o.bottom + 0.4, o.top - 0.5]) this.push('steel', boxGeo(o.a + fw, o.b - fw, at - 0.016, at + 0.016, -0.02, 0.02, tile, F));
            const c = new THREE.Matrix4().makeTranslation((o.a + o.b) / 2, (o.bottom + o.top) / 2, 0);
            this.collider((o.b - o.a) / 2, (o.top - o.bottom) / 2, 0.04, F.clone().multiply(c), 'metal', GLASS_GROUPS);
          } else if (o.kind === 'door') {
            const hinge = F.clone().multiply(new THREE.Matrix4().makeTranslation(o.a + fw, 0, 0));
            this.doorSpecs.push({ m: hinge, w: o.b - o.a - fw * 2, h: o.top - fw, id: `${plot.id}_door${this.doorSpecs.length}`, open: wd.still ? false : rng.chance(0.35), swing: wd.still ? 1 : rng.chance(0.5) ? 1 : -1 });
          }
          // (a barn's open front has the same lip as a door)
          if (o.kind !== 'window' && o.kind !== 'grille' && wd.side !== 'inner' && y0 === 0 && !o.join) {
            this.doorstep(F, o.a, o.b);
            outside.push({ F, a: o.a, b: o.b, front: wd.side === 'front' });
          }
          if (o.kind === 'window' && wd.side !== 'inner' && !hidden((o.a + o.b) / 2)) panes.push({ F, a: o.a, b: o.b, bottom: o.bottom, top: o.top, L });
        }
      }
    };
    // (under a floor above, the walls go on up past the edge of it: the outside of the house is one wall from the ground to the roof)
    raise(bp.walls, 0, bp.upper || bp.levels ? h + SLAB : h, h);

    // --- a building of several floors, with a flat roof that is walked on (the hospital, the police headquarters)
    /** how high each floor is over the ground one: [0, the first above it, ...]; and the roof */
    const storeyY: number[] = [0];
    let roofY = 0;
    if (bp.levels) {
      const ups = bp.levels, wells = bp.wells ?? [], deck = bp.deck;
      let top = h;
      for (const l of ups) {
        storeyY.push(top + SLAB);
        top += SLAB + l.h;
      }
      roofY = top + SLAB;
      const x0i = joined.has('left') ? -hw : -hw + T, x1i = joined.has('right') ? hw : hw - T, z0i = joined.has('back') ? -hd : -hd + T, z1i = joined.has('front') ? hd : hd - T;
      /** the storeys a well climbs: storey s is the climb from floor s to the one above it (the last, to the roof) */
      const climbs = (wl: Well) => Math.min(wl.upTo ?? ups.length + 1, ups.length + 1);
      const lo = (wl: Well) => Math.min(wl.land, wl.far), hi = (wl: Well) => Math.max(wl.land, wl.far);
      /**
       * A floor, or the roof: from y0 up to y1, with a hole over every stairwell that comes up through it. Its
       * top is one stuff and its underside, which is the ceiling of the rooms below, another: two layers, one on
       * the other, and no face of either in a face of anything else.
       */
      const CEIL = 0.045;
      const slab = (topKey: MatKey, y0: number, y1: number, holes: Well[]) => {
        const xs = [...new Set([x0i, x1i, ...holes.flatMap((wl) => [wl.x0, wl.x1])])].sort((p, q) => p - q);
        const zs = [...new Set([z0i, z1i, ...holes.flatMap((wl) => [lo(wl), hi(wl)])])].sort((p, q) => p - q);
        const open = (x: number, z: number) => holes.some((wl) => x > wl.x0 && x < wl.x1 && z > lo(wl) && z < hi(wl));
        for (let j = 0; j + 1 < zs.length; j++) {
          let from = -1;
          for (let i = 0; i < xs.length; i++) {
            const solid = i + 1 < xs.length && !open((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2);
            if (solid && from < 0) from = i;
            if (solid || from < 0) continue;
            this.push(topKey, boxGeo(xs[from], xs[i], y0 + CEIL, y1, zs[j], zs[j + 1], this.tile(topKey), B));
            this.push('ceiling', boxGeo(xs[from], xs[i], y0, y0 + CEIL, zs[j], zs[j + 1], this.tile('ceiling'), B));
            this.collider((xs[i] - xs[from]) / 2, (y1 - y0) / 2, (zs[j + 1] - zs[j]) / 2, B.clone().multiply(new THREE.Matrix4().makeTranslation((xs[from] + xs[i]) / 2, (y0 + y1) / 2, (zs[j] + zs[j + 1]) / 2)), surf(topKey));
            from = -1;
          }
        }
      };
      ups.forEach((l, k) => {
        slab(l.floor, storeyY[k + 1] - SLAB, storeyY[k + 1], wells.filter((wl) => climbs(wl) > k));
        // (its outside walls go on up past the edge of the floor or the roof over it)
        raise(l.walls, storeyY[k + 1], l.h + SLAB, l.h);
      });
      slab(deck ? 'bitumen' : bp.roof, roofY - SLAB, roofY, wells.filter((wl) => climbs(wl) > ups.length));

      // the stairs: in each well, from every floor to the next, two half flights and the landing between them
      const LANDING = 1.45, GAP = 0.07;
      for (const wl of wells) {
        const dz = Math.sign(wl.far - wl.land), turn = wl.far - dz * LANDING, xm = (wl.x0 + wl.x1) / 2;
        const n = climbs(wl);
        for (let st = 0; st < n; st++) {
          const ya = storeyY[st], yb = st < ups.length ? storeyY[st + 1] : roofY, ym = (ya + yb) / 2;
          const out: Stairs = { x0: wl.x0, x1: xm - GAP, foot: wl.land, top: turn };
          const back: Stairs = { x0: xm + GAP, x1: wl.x1, foot: turn, top: wl.land };
          this.flight(B, plot.id, out, ya, ym, undefined, 'concrete');
          this.flight(B, plot.id, back, ym, yb, [xm, wl.land - dz * 1.3], 'concrete');
          // the landing: as thick as a floor, and it stops a shot
          addBox('concrete', wl.x0, wl.x1, ym - 0.16, ym, Math.min(turn, wl.far), Math.max(turn, wl.far), B);
          // Under each half flight, a slab along its slope: the backs of the steps are not seen from below, and
          // a shot does not go through a stair. (Its top lies along the feet of the risers, a hair under them.)
          for (const [f, y0, y1] of [[out, ya, ym], [back, ym, yb]] as [Stairs, number, number][]) {
            const up = y1 - y0, L = Math.abs(f.top - f.foot), fd = Math.sign(f.top - f.foot), tilt = Math.atan2(up, L), len = Math.hypot(up, L);
            const S = B.clone().multiply(new THREE.Matrix4().makeTranslation((f.x0 + f.x1) / 2, (y0 + y1) / 2, (f.foot + f.top) / 2)).multiply(new THREE.Matrix4().makeRotationX(-fd * tilt));
            const half = (f.x1 - f.x0) / 2, under = 0.13;
            // (a finger narrower than the flight each side: its sides lay in the plane of the treads' ends)
            this.push('concrete', boxGeo(-half + 0.008, half - 0.008, -under, -0.012, -len / 2 + 0.12, len / 2 - 0.12, this.tile('concrete'), S));
            this.collider(half, under / 2, len / 2 - 0.12, S.clone().multiply(new THREE.Matrix4().makeTranslation(0, -under / 2 - 0.012, 0)), 'concrete');
          }
          // (on the ground the space under the way out is walled in: there is nothing under it to walk into)
          if (st === 0) {
            for (let k = 1; k < 4; k++) {
              const za = wl.land + dz * (k / 4) * Math.abs(turn - wl.land), zb = wl.land + dz * ((k + 1) / 4) * Math.abs(turn - wl.land);
              const tall = (k / 4) * (ym - ya) - 0.14;
              if (tall > 0.05) this.collider((out.x1 - out.x0) / 2, tall / 2, Math.abs(zb - za) / 2, B.clone().multiply(new THREE.Matrix4().makeTranslation((out.x0 + out.x1) / 2, tall / 2, (za + zb) / 2)), 'concrete');
            }
            this.push('concrete', wedgeGeo(Math.abs(turn - wl.land), ym - ya - 0.13, 0.05, this.tile('concrete'), B.clone().multiply(new THREE.Matrix4().makeTranslation(out.x1 - 0.025, 0, wl.land)).multiply(new THREE.Matrix4().makeRotationY(dz < 0 ? Math.PI : 0))));
          }
          // a rail down the middle for each half flight, on its own side of the gap
          this.rail(B, out.x1 + 0.02, wl.land, out.x1 + 0.02, turn, ya, ym, 'steel');
          this.rail(B, back.x0 - 0.02, turn, back.x0 - 0.02, wl.land, ym, yb, 'steel');
        }
        // At the head of the well nothing goes on up: the side the next flight would have left by is open over
        // the one below, and is railed off.
        const headY = n <= ups.length ? storeyY[n] : roofY;
        this.rail(B, wl.x0, wl.land, xm, wl.land, headY, headY, 'steel');
      }

      // bars, counters, plinths: plain shapes on a floor
      for (const fl of bp.fittings ?? []) {
        for (const f of fl.list) {
          const y = storeyY[fl.level] ?? 0;
          if (f.glass) this.push('glass', boxGeo(f.x0, f.x1, y + f.y0, y + f.y1, f.z0, f.z1, 1, B));
          else addBox(f.key, f.x0, f.x1, y + f.y0, y + f.y1, f.z0, f.z1, B, !f.soft);
          if (f.glass) this.collider((f.x1 - f.x0) / 2, (f.y1 - f.y0) / 2, Math.max(0.04, (f.z1 - f.z0) / 2), B.clone().multiply(new THREE.Matrix4().makeTranslation((f.x0 + f.x1) / 2, y + (f.y0 + f.y1) / 2, (f.z0 + f.z1) / 2)), 'glass', GLASS_GROUPS);
        }
      }

      // What its face has on it (see Dress): a band round it at every floor and under the wall round its roof, and
      // piers up it. Each a hair off the wall, and each standing out a different distance from every other, so that
      // where two cross neither's face lies in the other's.
      const dr = bp.dress;
      if (dr) {
        const topY = roofY + (deck?.parapet ?? 0);
        // (`storey`: the floor whose walls it runs along the top of: not on a side that is not built, nor where
        // another part of the building stands against that floor; nor across a way left open in the wall round the roof)
        const storeys = [bp.walls, ...ups.map((l) => l.walls)];
        const round = (key: MatKey, y0: number, y1: number, out: number, storey: number | null) => {
          const cut = (side: Side): [number, number][] => (storey === null ? (deck?.open ?? []).filter((o) => o.side === side).map((o): [number, number] => [o.a, o.b]) : storeys[storey].find((q) => q.side === side)?.covered ?? []);
          if (!joined.has('front')) for (const [a, b] of spans(-hw - out, hw + out, cut('front'))) addBox(key, a, b, y0, y1, hd + 0.002, hd + out, B, false);
          if (!joined.has('back')) for (const [a, b] of spans(-hw - out, hw + out, cut('back'))) addBox(key, a, b, y0, y1, -hd - out, -hd - 0.002, B, false);
          if (!joined.has('left')) for (const [a, b] of spans(-hd - 0.002, hd + 0.002, cut('left'))) addBox(key, -hw - out, -hw - 0.002, y0, y1, a, b, B, false);
          if (!joined.has('right')) for (const [a, b] of spans(-hd - 0.002, hd + 0.002, cut('right'))) addBox(key, hw + 0.002, hw + out, y0, y1, a, b, B, false);
        };
        if (dr.bands) {
          for (let k = 1; k < storeyY.length; k++) round(dr.bands, storeyY[k] - SLAB - 0.04, storeyY[k] + 0.05, 0.062, k - 1);
          round(dr.bands, roofY - SLAB - 0.04, roofY + 0.05, 0.062, ups.length);
          if (deck) round(dr.bands, topY - 0.24, topY - 0.03, 0.088, null);
        }
        if (dr.piers) {
          const y0 = (dr.plinth?.h ?? 0.26) - 0.012, y1 = topY - 0.03, half = dr.piers.w / 2, out = 0.075, key = dr.piers.key;
          for (const x of dr.piers.front ?? []) addBox(key, x - half, x + half, y0, y1, hd + 0.002, hd + out, B, false);
          for (const x of dr.piers.back ?? []) addBox(key, x - half, x + half, y0, y1, -hd - out, -hd - 0.002, B, false);
          for (const z of dr.piers.left ?? []) addBox(key, -hw - out, -hw - 0.002, y0, y1, z - half, z + half, B, false);
          for (const z of dr.piers.right ?? []) addBox(key, hw + 0.002, hw + out, y0, y1, z - half, z + half, B, false);
        }
      }

      if (deck) {
        // the wall round the roof's edge: the outside walls carried on up, and a coping on them
        const p0 = roofY, p1 = roofY + deck.parapet;
        // (not on a side that is not built: the roof runs on there; and not across a way left open. The coping
        // overhangs at the building's corners and stops flush at an opening; a side's stops short of the front's
        // and the back's, so that the tops of two never lie in one plane over one another.)
        const gaps = (side: Side) => (deck.open ?? []).filter((o) => o.side === side).map((o): [number, number] => [o.a, o.b]);
        for (const [side, za, zb] of [['front', hd - T, hd], ['back', -hd, -hd + T]] as [Side, number, number][]) {
          if (joined.has(side)) continue;
          for (const [a, b] of spans(-hw, hw, gaps(side))) {
            addBox(bp.ext, a, b, p0, p1, za, zb, B);
            addBox('concrete', a - (a === -hw ? 0.05 : 0), b + (b === hw ? 0.05 : 0), p1, p1 + 0.07, za - 0.05, zb + 0.05, B, false);
          }
        }
        const zlo = joined.has('back') ? -hd : -hd + T, zhi = joined.has('front') ? hd : hd - T;
        for (const [side, xa, xb] of [['left', -hw, -hw + T], ['right', hw - T, hw]] as [Side, number, number][]) {
          if (joined.has(side)) continue;
          for (const [a, b] of spans(zlo, zhi, gaps(side))) {
            addBox(bp.ext, xa, xb, p0, p1, a, b, B);
            addBox('concrete', xa - 0.05, xb + 0.05, p1, p1 + 0.07, a === zlo && !joined.has('back') ? a + 0.05 : a, b === zhi && !joined.has('front') ? b - 0.05 : b, B, false);
          }
        }
        // what stands over each stair, and its roof
        raise(deck.walls, roofY, deck.h, deck.h);
        for (const r of deck.roofs) addBox('concrete', r.x0 - 0.18, r.x1 + 0.18, roofY + deck.h, roofY + deck.h + 0.16, r.z0 - 0.18, r.z1 + 0.18, B);
        for (const b of deck.boxes) addBox(b.key, b.x0, b.x1, roofY + b.y0, roofY + b.y1, b.z0, b.z1, B, !b.soft);
      }

      // Stairs of steel outside (see Escape). In a frame of its own: z along the wall the way the flights run
      // from the doors, x across it (out from the wall is x times `o`), the floor of the building at y = 0. Two
      // lanes, the inner against the wall. From each landing the way down leaves by the outer lane, turns on a
      // landing half way, and comes back by the inner to the landing below, under the flight it left by.
      for (const es of bp.escapes ?? []) {
        const along = es.side === 'left' || es.side === 'right';
        // (the middle of the doors, on the wall's outer face)
        const at = new THREE.Vector3(es.side === 'left' ? -hw : es.side === 'right' ? hw : es.at, 0, es.side === 'front' ? hd : es.side === 'back' ? -hd : es.at);
        const turn = along ? (es.dir > 0 ? 0 : Math.PI) : es.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        // (which way x is out: the frame's x, turned so, is +x of the building at 0, -z at a quarter turn, ...)
        const fx = new THREE.Vector3(Math.cos(turn), 0, -Math.sin(turn)), outV = new THREE.Vector3(es.side === 'left' ? -1 : es.side === 'right' ? 1 : 0, 0, es.side === 'front' ? 1 : es.side === 'back' ? -1 : 0);
        const o = Math.sign(fx.dot(outV)) || 1;
        const E = B.clone().multiply(new THREE.Matrix4().makeTranslation(at.x, 0, at.z)).multiply(new THREE.Matrix4().makeRotationY(turn));
        const lane = (k: 0 | 1): [number, number] => (o > 0 ? [0.04 + k * 0.99, 0.99 + k * 0.99] : [-0.99 - k * 0.99, -0.04 - k * 0.99]);
        const X0 = o > 0 ? 0.04 : -1.98, X1 = o > 0 ? 1.98 : -0.04, far = o > 0 ? X1 : X0, DOOR = 0.85, RUN = 2.4, TURN = 1.0, GROUND = -0.1;
        // the heights it stops at, from the ground up: the ground, each floor with a door, the roof
        const stops = [GROUND, ...storeyY.slice(1, 1 + es.floors), ...(es.roof ? [roofY] : [])];
        const plate = (z0: number, z1: number, y: number) => {
          addBox('steel', X0, X1, y - 0.05, y, z0, z1, E);
          // (a channel under its outer edge and its two ends)
          addBox('steel', far - 0.03, far + 0.03, y - 0.16, y - 0.05, z0, z1, E, false);
        };
        for (let k = 1; k < stops.length; k++) {
          const lower = stops[k - 1], upper = stops[k], mid = (lower + upper) / 2;
          plate(-DOOR, DOOR, upper);
          plate(DOOR + RUN, DOOR + RUN + TURN, mid);
          const [a0, a1] = lane(0), [b0, b1] = lane(1);
          this.flight(E, plot.id, { x0: b0, x1: b1, foot: DOOR + RUN, top: DOOR }, mid, upper, undefined, 'steel');
          this.flight(E, plot.id, { x0: a0, x1: a1, foot: DOOR, top: DOOR + RUN }, lower, mid, undefined, 'steel');
          // rails: round the landing at the doors (not the side the flights are on), down the outside of the upper
          // flight and between it and the lower, round the landing half way
          this.rail(E, far, -DOOR, far, DOOR, upper, upper, 'steel');
          // (begun a hand's breadth off the wall: its first post stood in the band round the building at that floor)
          this.rail(E, o > 0 ? X0 + 0.07 : X0, -DOOR, o > 0 ? X1 : X1 - 0.07, -DOOR, upper, upper, 'steel');
          this.rail(E, far, DOOR, far, DOOR + RUN, upper, mid, 'steel');
          this.rail(E, (o > 0 ? a1 : a0) + o * 0.005, DOOR, (o > 0 ? a1 : a0) + o * 0.005, DOOR + RUN, upper, mid, 'steel');
          this.rail(E, far, DOOR + RUN, far, DOOR + RUN + TURN, mid, mid, 'steel');
          this.rail(E, o > 0 ? X0 + 0.07 : X0, DOOR + RUN + TURN, o > 0 ? X1 : X1 - 0.07, DOOR + RUN + TURN, mid, mid, 'steel');
        }
        // what it stands on: posts from the ground to the rail of the highest landing, at its outer corners
        const topY = stops[stops.length - 1] + 0.93;
        for (const z of [-DOOR, DOOR, DOOR + RUN, DOOR + RUN + TURN]) addBox('steel', far - 0.04, far + 0.04, -0.5, z > DOOR ? topY - (stops[stops.length - 1] - stops[stops.length - 2]) / 2 : topY, z - 0.04, z + 0.04, E);
        const near = o > 0 ? X0 : X1;
        addBox('steel', near - 0.04, near + 0.04, -0.5, topY - (stops[stops.length - 1] - stops[stops.length - 2]) / 2, DOOR + RUN + TURN - 0.04, DOOR + RUN + TURN + 0.04, E);
      }
    }

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
      // (a hand's breadth short of the head of the rail that comes up the flight: the two bars ended in one another)
      this.rail(B, open + away * 0.035, st.foot + dz * run, open + away * 0.035, st.top - dz * 0.09, y1, y1);
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

    if (bp.sign) this.signs.push({ m: B.clone().multiply(new THREE.Matrix4().makeTranslation(bp.sign.x, bp.sign.y, hd + 0.03 + (bp.sign.out ?? 0))), text: bp.sign.text, sub: bp.sign.sub, board: bp.sign.board, ink: bp.sign.ink, size: bp.sign.size });
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
    } else if (!bp.levels) {
      addBox(bp.roof, -hw - 0.25, hw + 0.25, H, H + 0.22, -hd - 0.25, hd + 0.25, B);
    }

    // furniture: indoors, so it only has to be drawn from close by (through a window or the door).
    // A barn stands open at the front and shows its insides from further off.
    const indoorFar = plot.type === 'barn' || plot.type === 'garage' ? 95 : 46;
    const inst = (id: string, lx: number, lz: number, rot: number, scale = 1, y = 0) => {
      const p = new THREE.Vector3(lx, y, lz).applyMatrix4(B);
      // (A bed's frame is drawn as far off as its mattress is seen: the mattress is part of the building and is
      // there at any distance, and from the far end of a ward the frames were gone from under them. 2026-10-12:
      // "some of the props in the hospital are floating like the hospital bed tops".)
      this.world.props.push({ kind: id, x: p.x, y: p.y, z: p.z, rot: rot + plot.rot, scale, far: id === 'old_bed_frame' ? Math.max(indoorFar, 110) : indoorFar });
    };
    // what stands on a floor (whose own level is y0), and where things are found on it
    const stock = (furniture: Furn[], loot: [number, number, number][], y0: number, usage: Usage[] = bp.usage) => {
      for (const f of furniture) inst(f.id, f.x, f.z, f.rot, f.scale ?? 1, (f.y ?? 0) + y0);
      // A bed is a frame with a few wires across it and nothing on them: whatever was kept on one hung in the air
      // over the springs (59 places on the map). Each has a mattress, and what is kept on it lies on that.
      for (const f of furniture) {
        if (f.id !== 'old_bed_frame') continue;
        const M = new THREE.Matrix4().makeRotationY(f.rot).setPosition(f.x, (f.y ?? 0) + y0, f.z).premultiply(B);
        this.push('mattress', boxGeo(-0.38, 0.38, BED.springs, BED.springs + BED.mattress, -0.9, 0.9, this.tile('mattress'), M));
      }
      // A rack: a place (or two, side by side) on each of its boards that is said to hold a thing, on the clear
      // part of the board. Kept by: they are let into the list after every other place on the map. (None at the
      // trading post, where nothing is left lying: see `his`.)
      for (const f of furniture) {
        const rack = RACKS[f.id];
        if (!rack || !f.on || his) continue;
        const c = Math.cos(f.rot), s = Math.sin(f.rot), seg = rack.half[0] / rack.places;
        for (const b of f.on) {
          for (let k = 0; k < rack.places; k++) {
            const ox = rack.mid[0] - rack.half[0] + (2 * k + 1) * seg, oz = rack.mid[1];
            const p = new THREE.Vector3(f.x + ox * c + oz * s, rack.boards[b] + 0.003 + (f.y ?? 0) + y0, f.z - ox * s + oz * c).applyMatrix4(B);
            this.racked.push({ x: p.x, y: p.y, z: p.z, usage, building: plot.id, floor: false, surf: { x: p.x, z: p.z, rot: f.rot + plot.rot, hx: seg, hz: rack.half[1], clear: rack.clear } });
          }
        }
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
          this.lootPoints.push({ x: p.x, y: p.y, z: p.z, usage, building: plot.id, floor: true });
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
            x: p.x, y: p.y, z: p.z, usage, building: plot.id, floor: false,
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
    (bp.levels ?? []).forEach((l, k) => stock(l.furniture, l.loot, storeyY[k + 1], l.usage));
    if (bp.deck) {
      const firstUp = this.lootPoints.length;
      stock(bp.deck.furniture, bp.deck.loot, roofY, bp.deck.usage);
      // (the places on the roof that always hold a thing: each the nearest of the roof's places to where it is said to be)
      for (const k of bp.deck.keeps ?? []) {
        const at = new THREE.Vector3(k.x, roofY, k.z).applyMatrix4(B);
        const mine = this.lootPoints.slice(firstUp).filter((q) => !q.keeps);
        mine.sort((p, q) => Math.hypot(p.x - at.x, p.z - at.z) - Math.hypot(q.x - at.x, q.z - at.z));
        if (mine[0]) mine[0].keeps = k.id;
      }
    }

    // where a weapon is always to be found: on the floor first (anything fits there)
    if (plot.arms) {
      const mine = this.lootPoints.slice(firstPoint);
      const pick = [...mine.filter((p) => p.floor), ...mine.filter((p) => !p.floor)].slice(0, plot.arms);
      for (const p of pick) p.arms = plot.type === 'police' || plot.type === 'police_hq' || plot.type === 'guardpost' || plot.type === 'barracks' || plot.type === 'tent' ? 'guns' : 'any';
    }

    // yard clutter
    const later = this.world.buildings.indexOf(plot) >= this.world.buildings.findIndex((o) => o.type === 'hospital');
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
      // (Round a building built since the hospital, which is every one that stands close to others or is one part
      // of several: not where another building stands, nor against its wall, nor on what already lies in the next
      // yard. The buildings before that are left to their dice: what lies round them lies where it has always lain.)
      if (later && (this.world.buildings.some((o) => {
        if (o === plot) return false;
        const [ow, od] = BUILDING_FOOTPRINT[o.type], dx = p.x - o.x, dz = p.z - o.z, oc = Math.cos(o.rot), os = Math.sin(o.rot);
        return Math.abs(dx * oc - dz * os) < ow / 2 + 0.7 && Math.abs(dx * os + dz * oc) < od / 2 + 0.7;
      }) || this.world.props.some((q) => !q.far && Math.hypot(q.x - p.x, q.z - p.z) < 1.5))) continue;
      // never two things in the one spot
      if (placed.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1.15)) continue;
      placed.push(p);
      let kind = rng.pick(yard);
      // one can per placement (the source file has a clean and a rusty one)
      if (kind === 'metal_trash_can') {
        kind += rng.chance(0.5) ? '@0' : '@1';
        // (The cans are a pair, 1.8 m from end to end, and are turned any way: stood half a metre from a wall, one
        // of them was in it. They stand a full metre off, on the side they were on. No dice are thrown for this.)
        if (side === 0) lz = Math.min(lz, -hd - 1.05);
        else if (side === 1) lx = Math.min(lx, -hw - 1.05);
        else if (side === 2) lx = Math.max(lx, hw + 1.05);
        else lz = Math.max(lz, hd + 1.05);
        p.set(lx, 0, lz).applyMatrix4(B);
      }
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
  private flight(B: THREE.Matrix4, plot: string, st: Stairs, y0: number, y1: number, off?: [number, number], key: MatKey = 'planks') {
    const up = y1 - y0, dz = Math.sign(st.top - st.foot), L = Math.abs(st.top - st.foot);
    const N = Math.round(up / 0.2), rise = up / N, run = L / N;
    const tile = this.tile(key);
    for (let i = 0; i < N; i++) {
      const za = st.foot + dz * i * run, zb = st.foot + dz * (i + 1) * run;
      // (each tread overhangs the one under it; the last does not overhang the floor it comes up to, whose top is its own)
      const last = i === N - 1;
      this.push(key, boxGeo(st.x0, st.x1, y0 + (i + 1) * rise - 0.045, y0 + (i + 1) * rise, Math.min(za, zb) - (last && dz < 0 ? 0 : 0.015), Math.max(za, zb) + (last && dz > 0 ? 0 : 0.015), tile, B));
      this.push(key, boxGeo(st.x0 + 0.02, st.x1 - 0.02, y0 + i * rise, y0 + (i + 1) * rise - 0.045, Math.min(za, za + dz * 0.025), Math.max(za, za + dz * 0.025), tile, B));
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
  private signs: { m: THREE.Matrix4; text: string; sub: string; board?: string; ink?: string; size?: number }[] = [];

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
    // One shape for the sun's shadow maps (2026-10-12). Every wall, floor and roof of the map is one mesh for each
    // paint, forty-odd of them, and a shadow map takes no notice of paint: each was a thing to draw again in every
    // shadow map, ninety draws a frame for what one draw says. The same triangles, as one mesh that is drawn only
    // into the shadow maps (one for each way a paint's faces are turned for a shadow); the painted ones cast
    // nothing of their own. A paint with holes in it (none today) would go on casting for itself.
    {
      const casters = new Map<string, { side: THREE.Side; shadowSide: THREE.Side | null; shapes: THREE.BufferGeometry[]; of: THREE.Mesh[] }>();
      for (const mesh of group.children as THREE.Mesh[]) {
        const mat = mesh.material as THREE.Material;
        if (!mesh.castShadow || mat.transparent || mat.alphaTest > 0) continue;
        const k = `${mat.side}|${mat.shadowSide}`;
        if (!casters.has(k)) casters.set(k, { side: mat.side, shadowSide: mat.shadowSide, shapes: [], of: [] });
        const c = casters.get(k)!;
        c.shapes.push(new THREE.BufferGeometry().setAttribute('position', mesh.geometry.getAttribute('position')));
        c.of.push(mesh);
      }
      for (const c of casters.values()) {
        const shape = c.shapes.length > 1 ? mergeGeometries(c.shapes, false) : c.shapes[0];
        if (!shape) continue;
        const caster = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ side: c.side, shadowSide: c.shadowSide }));
        caster.castShadow = true;
        caster.receiveShadow = false;
        // (in the shadow maps and not in the view: three asks this of every pass it draws)
        caster.frustumCulled = true;
        caster.intersectsFrustum = (f) => SHADOW_FRUSTA.has(f);
        caster.matrixAutoUpdate = false;
        caster.name = 'buildings shadow';
        group.add(caster);
        for (const m of c.of) m.castShadow = false;
      }
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
      // (One face of it is the sign and the other five its edge: two things to draw, the edge and the face, where
      // each of the six faces was one, and again in every shadow map. The fifth face changes places with the sixth
      // so that the five of the edge come together.)
      const slab = new THREE.BoxGeometry(2.6 * (sg.size ?? 1), 0.65 * (sg.size ?? 1), 0.04), ix = slab.index!.array;
      for (let k = 0; k < 6; k++) [ix[24 + k], ix[30 + k]] = [ix[30 + k], ix[24 + k]];
      slab.clearGroups();
      slab.addGroup(0, 30, 0);
      slab.addGroup(30, 6, 1);
      const board = new THREE.Mesh(slab, [this.material('trim'), mat]);
      board.applyMatrix4(sg.m);
      board.castShadow = board.receiveShadow = true;
      scene.add(board);
    }

    const doorMat = this.material('planks', ' doors') as THREE.MeshStandardMaterial;
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
      // (a hinge that holds nothing is kept out of the world: see the Door's constructor)
      if (d.pivot.children.length) scene.add(d.pivot);
      this.doors.push(d);
    }
    new DoorBatch(scene, this.doors, doorMat, handleMat);
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
    // The outsides that are models, painted as the walls are (in the weather, and before what grows). (All the copies
    // of one model are drawn at one go, a piece of it at a time: the five shanty mansions were thirty things to draw
    // and are six, and every barrack, tent and house of one kind likewise. What is seen through stays a copy for each:
    // see src/core/one-draw.ts.)
    const painted = new Map<THREE.Material, THREE.Material>();
    const byModel = new Map<string, Buildings['shells']>();
    for (const sh of this.shells) {
      if (!byModel.has(sh.model)) byModel.set(sh.model, []);
      byModel.get(sh.model)!.push(sh);
    }
    for (const [model, list] of byModel) {
      void assets.model(model).then((src) => {
        src.updateMatrixWorld(true);
        const at = new THREE.Matrix4();
        src.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const paint = this.paintShell(painted, m.material as THREE.Material);
          if (paint.transparent || list.length === 1) {
            for (const sh of list) {
              const one = new THREE.Mesh(m.geometry, paint);
              one.matrixAutoUpdate = false;
              one.matrix.multiplyMatrices(sh.m, m.matrixWorld);
              one.castShadow = one.receiveShadow = true;
              one.renderOrder = WALLS_FIRST;
              one.name = m.name;
              scene.add(one);
            }
            return;
          }
          const many = new THREE.InstancedMesh(m.geometry, paint, list.length);
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
          // (drawn into a view, or a shadow map, when one of the copies is in it: the copies stand all over the map,
          // and the ball round all of them is in every one)
          const balls = list.map((sh, i) => {
            many.setMatrixAt(i, at.multiplyMatrices(sh.m, m.matrixWorld));
            return m.geometry.boundingSphere!.clone().applyMatrix4(at);
          });
          many.intersectsFrustum = (f) => balls.some((b) => f.intersectsSphere(b));
          many.computeBoundingSphere();
          many.matrixAutoUpdate = false;
          many.castShadow = many.receiveShadow = true;
          many.renderOrder = WALLS_FIRST;
          many.name = m.name;
          scene.add(many);
        });
        for (const sh of list) {
          if (!sh.solid) continue;
          // what stops a body and a shot is the model itself: every triangle of it, where it stands
          const verts: number[] = [], index: number[] = [], v = new THREE.Vector3();
          src.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            at.multiplyMatrices(sh.m, m.matrixWorld);
            const pos = m.geometry.getAttribute('position'), first = verts.length / 3;
            for (let i = 0; i < pos.count; i++) {
              v.fromBufferAttribute(pos, i).applyMatrix4(at);
              verts.push(v.x, v.y, v.z);
            }
            const ix = m.geometry.getIndex();
            if (ix) for (let i = 0; i < ix.count; i++) index.push(first + ix.getX(i));
            else for (let i = 0; i < pos.count; i++) index.push(first + i);
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

  /**
   * A model's paint, as the walls are painted: its colour and its relief, and no more of what the download says of
   * itself. (Its own word for how it shines, and the shade it has baked into it for the picture it was made for, made
   * the brick house black indoors, where there is no sun and that shade took all the light there was.) One for each
   * paint of the download, however many copies of the model there are.
   */
  private paintShell(painted: Map<THREE.Material, THREE.Material>, was: THREE.Material): THREE.Material {
    let mine = painted.get(was);
    if (mine) return mine;
    const src = was as THREE.MeshStandardMaterial;
    const made = new THREE.MeshStandardMaterial({ map: src.map, normalMap: src.normalMap, color: src.color, roughness: src.roughnessMap ? 0.9 : Math.max(0.6, src.roughness), metalness: 0, side: src.side, alphaTest: src.alphaTest, transparent: src.transparent, opacity: src.opacity });
    // (seen along a street, a wall is seen at a slant: sharp at a slant as it is face on)
    for (const t of [made.map, made.normalMap]) {
      if (!t) continue;
      t.anisotropy = assets.maxAnisotropy;
      t.needsUpdate = true;
    }
    made.name = src.name;
    // (which model's pictures these are, for when they are wanted at the size they came: see Assets.sharpen)
    made.userData.hi = src.userData.hi;
    this.atmo.register(made);
    painted.set(was, (mine = made));
    return mine;
  }

  private matCache = new Map<string, THREE.Material>();
  /** @param apart a paint of its own, the same in every way (the doors' leaves, drawn many times over, are not drawn with the walls' own: three chose a shader again each time it went from the one to the other) */
  private material(key: MatKey, apart = ''): THREE.Material {
    let m = this.matCache.get(key + apart);
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
    // (Walls, floors and roofs are one picture each, laid over and over: on a wall forty metres long the same stain
    // came round every three, in rows. A slow change of tone across the world, different at every place, is put over
    // the picture: the rows are not seen for it. "we are re-using the same textures too much", 2026-10-11.)
    if (key !== 'glass' && MACRO.has(key)) this.atmo.register(m, macroTone, 'macro');
    else this.atmo.register(m);
    this.matCache.set(key + apart, m);
    return m;
  }

  private handlesT = 0;
  update(dt: number, eye?: { x: number; z: number }) {
    for (const d of this.doors) d.update(dt);
    // (a door's handle is drawn where it can be seen: from across the street it is less than a pixel, and it was one more thing to draw for every door in sight)
    if (eye && (this.handlesT += dt) > 0.4) {
      this.handlesT = 0;
      for (const d of this.doors) if (d.size) d.showHandle((d.pivot.position.x - eye.x) ** 2 + (d.pivot.position.z - eye.z) ** 2 < HANDLE_SEEN * HANDLE_SEEN);
    }
  }
}

export type { Instance };
