// The fort's pieces (src/sim/castle.ts) as shapes: the triangles each is drawn with, by what it is made of, from
// near and from far; and what of it stops a body and a shot. Plain numbers and nothing else: no drawing library
// and no physics, so that the same lines are checked by rule (test/castle.test.ts), drawn flat as a plan, and
// handed to the game (src/world/castle.ts).
//
// Everything is in the fort's own measure: x toward the gate, y above the terrace, z toward the steep side.
//
// How the pictures are laid on (their size is in TILE, metres to one turn of the picture). A course of stone runs
// level and is as tall as it is anywhere else: up a wall the picture goes by the height, up a leaning wall by the
// length of the lean, and along either by the metre. Round a tower it goes a whole number of times, so there is no
// seam; and since a tower is wider at its foot than at its head, the leaning part of it is done in bands a few
// courses tall, each with the number of turns that fits its own girth. A stone at the foot is the size of a stone
// at the top, to within a twelfth.

export { PAINTS, SHEETS, PICTURES, STUFF, TILE, quatOf, castleSky } from './castle-shape/base';
export type { Quat, Surf, Solid, Skin, Shape, Sheet } from './castle-shape/base';
export type { LidNet } from './castle-shape/ground-parts';
export { TOWER_FLOOR, TOWER_DOOR, SLIT_WIDE, LOST_WIDE } from './castle-shape/towers';
export { castleShape, castleShapeIn, castleShapeSteps } from './castle-shape/shape';
export type { Note } from './castle-shape/shape';
