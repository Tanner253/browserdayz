// Where the trader camp stands (the owner, 2026-10-25: "the trader zone must be moved from the red zone on the map away
// from the center of the map because this can be exploited": a safe spot inside the Zona). Out in the south-west desert,
// chosen by progress/crafting/camp-site.ts: 990 m clear of the Zona, 1,449 m from the map's middle, 28 m off the road
// south from Blokpost (250 m off, the nearest place), the ground flat to 0.63 m across 48 m. Nothing here imports
// anything, so that the base rules (src/sim/build/land.ts) and the camp (src/sim/camp.ts) may both read it.

/** the camp's yard: its middle */
export const CAMP_AT = { x: -2940, z: 360 };
/** how far from it no base is laid: its safe zone and a place's margin besides (src/sim/build/land.ts) */
export const CAMP_KEEP = 100;
