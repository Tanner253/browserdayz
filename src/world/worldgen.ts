// Deterministic world generation. Produces the heightfield, terrain splat weights,
// road, building plots and every vegetation / prop instance from a single seed.
// Pure data, no rendering: the server can run this exact code to agree with clients
// on collision and spawn points.

export { WORLD_SEED, OLD_HALF, WORLD_SIZE, WORLD_RES, CELL, PLAY_RADIUS, EXPANSION, BUNKER_AT, TOWN, kamenkaQ, KAMENKA, eastRoad, PASS, LOOP, MOUNTAIN } from './worldgen/places';
export { worldWithoutMountain, mountainLine, doorRoad, loopLine, loopFence, PEAK, SNOW, OUTLYING, NO_START, PLAY_FIRST, PLAY_AREAS, bunkerPlace, inPlay, playOutline, HOSPITAL_AT, HOSPITAL_GROUNDS, POLICE_PARTS, hospitalDrive, VILLAGE_STREETS, SERVICES, BUILDING_FOOTPRINT, TRADE_AT, ARMY_CAMP } from './worldgen/layout';
export type { BuildingType, BuildingPlot, SiteKind } from './worldgen/layout';
export type { Site, Instance, Solid, POI, Way, Worn, World } from './worldgen/types';
export { idx, heightAt, seenGround, slopeAt, catmullRom } from './worldgen/ground';
export { generateWorld, generateWorldSoftly } from './worldgen/generate';
