// Deterministic world generation. Produces the heightfield, terrain splat weights,
// road, building plots and every vegetation / prop instance from a single seed.
// Pure data, no rendering: the server can run this exact code to agree with clients
// on collision and spawn points.

export { WORLD_SEED, OLD_HALF, SQUARE_HALF, SQUARE_RES, WORLD_X0, WORLD_X1, WORLD_Z0, WORLD_Z1, WORLD_NX, WORLD_NZ, SEA_LEVEL, onWorld, onSquare, CELL, PLAY_RADIUS, EXPANSION, BUNKER_AT, TOWN, kamenkaQ, KAMENKA, eastRoad, PASS, LOOP, MOUNTAIN } from './worldgen/places';
export { worldWithoutMountain, mountainLine, doorRoad, loopLine, loopFence, PEAK, SNOW, OUTLYING, NO_START, PLAY_FIRST, PLAY_AREAS, bunkerPlace, inPlay, playOutline, HOSPITAL_AT, HOSPITAL_GROUNDS, POLICE_PARTS, hospitalDrive, VILLAGE_STREETS, SERVICES, BUILDING_FOOTPRINT, TRADE_AT, ARMY_CAMP } from './worldgen/layout';
export type { BuildingType, BuildingPlot, SiteKind } from './worldgen/layout';
export type { Site, Instance, Solid, POI, Way, Worn, World } from './worldgen/types';
export { idx, sampleOf, groundField, heightAt, seenGround, slopeAt, catmullRom } from './worldgen/ground';
export { WEST, shoreLine } from './worldgen/west';
export { generateWorld, generateWorldSoftly } from './worldgen/generate';
