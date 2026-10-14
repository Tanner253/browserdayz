// The fort on the mountain: four round towers at the corners of a near-square, a square keep in the middle of it,
// a paved terrace all round between the two, and one way in, over a timber ramp from a rock on the east. It is
// built from the measurements of a real one (Rocca Calascio, in the Abruzzo) and from nothing else of it: every
// stone here is laid by rule, in this file, as plain numbers.
//
// What is the real fort's: the plan and its sizes, the lean of the walls, the heights, the ramp, the broken rims,
// the keep's doorway three metres up with a small door under it, the roof with its hatch and its stubs of a lost
// storey. What is ours, because a place that is fought over needs it: the firing step along the parapet (the real
// sill is 1.8 m over the terrace and nobody sees over it), the square ports raised to be shot through from that
// step, the floors, stairs and fighting platforms inside the keep and the towers, the scaffold up the keep's south
// face to its roof, and a breach in the north wall with a slope of rubble up to it (the real walls are whole).
//
// Rules and layout only: no drawing here. The game builds it from `castleParts()` (src/world/castle.ts); the server
// wants `castleLoot`, `castleProps` and `castleHomes`. Everything is said in the fort's own measure: `x` metres
// toward the gate (east, when it is not turned), `z` metres toward the steep side (south), `y` metres above the
// terrace, which is the one level floor of the whole place and the height a `Place` gives.

import type { Place } from './bunker';

export { CASTLE, UNDER, ARCADE, POSTERN, CASTLE_SCALE, body, castleAt, castleLocal, inCastle, rough, castleGround, OUTCROP, FAN, moundTop, towerRadius, stairShare } from './castle/plan';
export type { V3, Paint, Body, Box, Slab, Beam, Rail, Flight, Opening, Wall, Curtain, Slit, Tower, Mound, Vault, Lump, Apron, Part } from './castle/plan';
export { castleParts, castleKit, castleDoor, castleRocks, FURNITURE, LAMPS } from './castle/parts';
export { CASTLE_TIERS, castleLoot, JEEP_WRECK, castleJeep, castleProps, castleLamps, castleHomes, castleClear } from './castle/loot';
export type { CastleUsage, CastleLoot, GroundAt } from './castle/loot';
export { HOUSES, LOOSE, hatchLine, hatchWell, hatchWells, looseParts } from './castle/loose';
export type { Loose } from './castle/loose';
export { castleUnder, castleDark, castleCuts, squareTouches, castleHides, castleOpen, castleFoot, castleLoose, looseLocal } from './castle/ask';
export type { FortPlace, FortLid } from './castle/ask';

export type { Place };
