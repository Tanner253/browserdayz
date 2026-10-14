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
// (the post that holds the fort above ground is another file's: its things and the places things lie in it join the fort's own here. Its lamps do not: it lights them itself, and they are no fires.)
import { postLoot, postProps } from './castle-post';
import { KIT_GATE, KIT_LEVELS, KIT_MERLON, KIT_TOWER, cutBox, cutRound, cutTurned, type Cut, type KitPiece } from './kit';

export type { Place };

export const CASTLE = {
  name: 'The Rocca',
  /** from its middle to the middle line of the east and west walls, and of the north and south ones: the towers stand where they cross */
  hx: 9.9,
  hz: 10,
  /** the wall under the terrace leans in: so many metres up for one metre in (the kit's walls: 0.94 m in 7.08, eighty-two degrees) */
  lean: 7.53,
  /** how far under the terrace the walls and the towers are built: the ground hides what it does not need */
  deep: 13,
  /** the wall round the terrace: its thickness, the sill of its gaps and the top of its merlons, a merlon and a gap, how many merlons a side, and the square port under each */
  parapet: { thick: 0.7, sill: 1.8, top: 2.9, merlon: 1.1, gap: 0.9, n: 7, port: { w: 0.8, y0: 0.95, y1: 1.7 } },
  /** the firing step along the inside of it: how high, how deep its top, and the tread of the one step up to it */
  step: { h: 0.55, top: 0.75, tread: 0.35 },
  /** the gap in the east parapet that is the gate, along z */
  gate: { z0: -2.85, z1: -0.35 },
  /** the ramp: its length, its width and how far its foot is under the terrace (ten degrees) */
  ramp: { len: 8, wide: 2.5, drop: 1.39 },
  /** the breach in the north parapet, along x (ours) */
  breach: { x0: -6.3, x1: -2.7 },
  /** the towers: across at the top, the thickness of the wall, the lean under the terrace and where it eases, the fighting platform, the inner edge of the stair; and how big the kit's round tower is made to be the foot of each (its platform is then level with the terrace, and a ring of its parapet stands round the foot of the drum) */
  tower: { r: 3.1, wall: 0.9, lean: 3.9, bend: -5.32, flare: 8, deck: 4.8, slots: 24, stairIn: 1.15, kit: 0.56, under: 0.7 },
  /** the keep: its outside, the room inside its walls, its floors, its roof, the top of the wall round the roof, the shell that is left of the storey over that, and the south-east corner of the roof that has fallen in with the walls over it (from there to the room's corner) */
  keep: { x0: -6.1, x1: 5.2, z0: -5.5, z1: 5.5, room: { x0: -3.7, x1: 2.8, z0: -3.4, z1: 3.4 }, floors: [0, 3, 5.85], roof: 8.7, band: 9.54, skin: 0.6, fallen: { x0: 1.3, z0: 2 } },
  /** the ground at the foot of each wall, under the terrace: what the real one measures */
  foot: { east: -5.8, west: -6.1, north: -7.3, south: -8 },
  /** how far off its smoke, lamps and shots matter: the whole of it and its grounds, from its middle */
  reach: 105,
};

/**
 * UNDER THE FORT: THE VAULTS (2026-10-13: "We should also build a robust basement or lower levels for the castle
 * and a cellar exit/entrance youd find outside a farm house like a tornado shelter ... we want dynamic map
 * gameplay"; and, of the design that followed: "figure out what the basement of this building will be ... lots of
 * good loot im presume? Imoress. Me." The design is the coordinator's brief, castle-character.md: this is its build.)
 *
 * The terrace stands six to eight metres over the ground, so there is a whole level between its paving and the
 * hill with no digging: its floor 3.8 m under the terrace. In four parts:
 *
 *   THE CISTERN, along the north side and in under the keep's north wall: a vault on a row of pillars, its floor a
 *   knee lower than the rest and under black water. It is the crossroads: the stair from the keep's store comes
 *   down to a door on it, the cellar in the foot of the north-west tower opens on its corner, the terrace walk has
 *   fallen into it by the breach (a drop, and the day comes down it), and the west and east sides run out of its ends.
 *   THE ARMOURY, the strongroom under the keep's store: one door, an iron grille on the south, standing ajar. A
 *   dead end on purpose: whoever goes in can be shut in.
 *   THE AID POST, along the south side: the old cells against the outer wall, and a ward where the side meets the east one.
 *   THE SALLY PORT, the east side: a stair down in a slot along the outer wall to 9.6 m under the terrace, and from
 *   its landing a passage out under the wall's foot, with two bends in it and a fallen length to crouch through,
 *   to a storm-cellar hatch in the old village (a loose piece: see LOOSE, 'hatch').
 *
 * And the west side joins the cistern to the aid post: past the stone of a bay of its vault that fell in (a slope
 * from the floor up to the terrace: the way in from above that is walked), by a way left along the keep's
 * foundation that is crouched through. So the four sides are a ring: two ways between any two parts but the armoury.
 * Out of the west side a POSTERN goes through the wall's foot to a landing and a stair down the outside of the wall.
 * The east wall has fallen out at one place to the floor (the RENT): a way in up its stone.
 */
export const UNDER = {
  /** its floor, and the underside of the terrace over it, under the terrace */
  floor: -3.8,
  roof: -1,
  /** the inner faces of its outer walls, from the fort's middle */
  x: 8.2,
  z: 8.3,
  /** the strongroom under the keep's store (before the slot of the stair is walled off it: see `armoury`) */
  mid: { x0: -3.7, x1: 3.2, z0: -3.4, z1: 3.4 },
  /** the cistern: how far east it reaches and the face of its south wall, how far its floor is under the rest, how far under the rest its water stands, and the hole in the terrace walk that fell into it */
  cistern: { x1: 5.2, z1: -4.2, deep: 0.4, water: -0.07, drop: { x0: -2.4, x1: 0.2, z0: -8.15, z1: -6.2 } },
  /** the armoury: the face, on its side, of the wall that shuts it off from the slot of the stair */
  armoury: { z0: -2.2 },
  /** the bay of the west vault that has fallen in (the hole in the terrace), and how far from the outer wall its stone lies: past that is the way that is crouched through */
  bay: { x0: -8.2, x1: -6.3, z0: -1.4, z1: 5.2 },
  crawl: -7.1,
  /** the postern: the doorway through the west wall's foot, along z */
  goat: { z0: -4.0, z1: -2.9 },
  /** the stair from the keep's store: along z, its head (at the terrace), its foot, and how far the store's floor is open over it */
  stair: { z: -2.9, head: -2.6, foot: 2.15, open: 1.4 },
  /** the stair down to the passage out: its slot in the east side's floor, its head and foot along z, the end of its landing, and how deep that is */
  postern: { x0: 7.1, x1: 8.2, head: -5.7, foot: 0.97, end: 2.05, deep: -9.6 },
  /** the length of the east wall that has fallen out, along z: wall, walk and all, down to the floor; and how far in its stone has spilt */
  rent: { z0: 3.3, z1: 5.7, in: 7.1 },
  /** gratings in the paving, each 0.9 m square: over the head of the sally port's stair, over the cistern, and in the store's floor over the armoury */
  gratings: [[7.2, -6], [1.9, -7.2], [0.3, 1.2]] as [number, number][],
  /** the hatch: how far its steps go down, over what length, how wide they and the passage are, how tall the passage, and how far from what is cut for them the earth laid over the cut ground reaches. (As far as lowering the squares they touch can disturb ground of two-metre squares, and that is not only where it is lowered: a corner next to a lowered one faces the hole and is painted as a cliff, and so is every square it is a corner of. Three squares out along each way of the grid, so five metres to the middle of the furthest square each way, and seven corner to corner.) */
  hatch: { drop: 3.2, run: 4.2, wide: 1.3, tall: 2.1, lid: 7.2 },
};
/** the cistern's arcade: the line it stands on, how thick it is, and each arch of it by how far along it is from the west wall (what is between two arches is a pier: the water's edge is drawn round each) */
export const ARCADE = { z: -6.25, thick: 0.5, arches: [[0.25, 1.95], [2.45, 4.35], [4.85, 6.75], [7.25, 9.15], [9.65, 11.55], [12.05, 13.15]] as [number, number][] };
/** where the passage to the hatch leaves the fort: [x, z] in the fort's own measure, its floor so far under the terrace */
export const POSTERN = { x: UNDER.postern.x1 + 0.25, z: 1.5, y: UNDER.postern.deep };

export type V3 = [number, number, number];
/** what a part is made of: the walls' coursed stone, the keep's (the same stone, laid bigger), the dark small stone of the leaning bases, the wall cores and everything under the terrace, paving, old timber, iron, living rock, loose stone, and the ground's own earth (laid over a hole cut in the ground) */
export type Paint = 'stone' | 'ashlar' | 'base' | 'paving' | 'timber' | 'iron' | 'rock' | 'scree' | 'earth' | 'water';
/** what a part stops: everything; a body and nothing else (a rail, the slope under a stair: a shot goes through); nothing */
export type Body = 'all' | 'feet' | 'none';

interface Common {
  paint: Paint;
  /** how light it is: 1 as the stone comes, less for what is weathered or in shadow */
  tone?: number;
  body?: Body;
  /** it stops what `body` says and is not seen */
  hidden?: boolean;
  /** drawn from far off as well as from near (`both`), or only from far off (`far`): left out, only from near */
  at?: 'both' | 'far';
  /** it stands on the ground at this spot [x, z], and its heights are over the ground there, not over the terrace */
  sits?: [number, number];
  /** which piece of the place it is: for whoever reads a plan of it */
  name?: string;
  /** of the lower levels: drawn with them, only while somebody is near enough to see into them */
  low?: boolean;
  /** it has a roof of its own over it (a passage under the ground): no snow lies on it */
  roofed?: boolean;
  /** it is not bent as the rest of its stuff is (hand-laid stone bellies a hand either way): what is set into a piece of the kit, which is straight, and would come out through its face */
  straight?: boolean;
}
/** a block, its sides square to the fort (or turned `yaw` about its own middle) */
export interface Box extends Common { t: 'box'; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; yaw?: number }
/** a board or a slab lying at any slope: the four corners of its top, in order round it, and how thick it is under them */
export interface Slab extends Common { t: 'slab'; p: [V3, V3, V3, V3]; thick: number }
/** a timber from one point to another: so wide and so deep */
export interface Beam extends Common { t: 'beam'; a: V3; b: V3; w: number; h: number }
/** a rail from one point to another: posts and two bars. A body does not go through it; a shot does */
export interface Rail extends Common { t: 'rail'; a: V3; b: V3 }
/** a straight flight: the middle of its foot on the floor below, the middle of the far edge of its last tread (which is level with the floor above), and its width */
export interface Flight extends Common { t: 'flight'; foot: V3; head: V3; w: number }
/** (`round`: a hole where stones have gone, round at its foot as at its head, not an opening a mason made; `rise`: how high an arch stands from where it springs to its crown: unsaid, a half round, or as much of one as its height leaves room for) */
export interface Opening { u0: number; u1: number; y0: number; y1: number; arch?: boolean; round?: boolean; rise?: number }
/**
 * A wall that stands straight: along the ground from `a` to `b` (its middle line; the outside is on the left of
 * somebody walking it), from `y0` up to `top` (one height, or one for each of so many equal lengths of it, which
 * is a broken top), with openings said by how far along it they are.
 */
export interface Wall extends Common { t: 'wall'; a: [number, number]; b: [number, number]; y0: number; top: number | number[]; thick: number; openings?: Opening[]; /** it stands over a way (its foot is in the air): its underside is seen, and is made. A wall that stands on something has none. */ soffit?: boolean; /** what stops a body follows every step of its top, not only the big ones: a low wall that somebody steps over at its low end (a hatch's kerb) */ stepped?: boolean }
/** a wall that leans: its face only, from the line `a` to `b` at the terrace down to `y0`, out by a metre for every `lean` down */
/** (`sag`: a length of it that has fallen out, from so far along it to so far, down to this height) */
export interface Curtain extends Common { t: 'curtain'; a: [number, number]; b: [number, number]; y0: number; lean: number; sag?: [number, number, number] }
/** a window of a tower: which way it looks (degrees: 0 east, 90 south), and from how high to how high */
export interface Slit { a: number; y0: number; y1: number }
export interface Tower extends Common {
  t: 'tower';
  cx: number;
  cz: number;
  /** how far under the terrace it is built */
  foot: number;
  /** the top of its wall, for each of `CASTLE.tower.slots` equal parts of the way round (the first begins due east and they go round by the south) */
  rim: number[];
  /** which way its door looks: into the terrace */
  door: number;
  slits: Slit[];
  /** holes right through its wall where stones have gone: somewhere to shoot from, and to be shot through */
  lost?: Slit[];
  /** it is hollow under the terrace too, down to here: a round cellar under a hole in its boards, with a doorway into the lower levels under its door */
  hollow?: number;
  /** the stair round the inside of its wall: where it leaves the floor, and how far round it goes to the platform (degrees, signed) */
  stair: { from: number; sweep: number };
  /** the part of the way round that is open over the head of the stair: [from, to] in degrees, the way the stair goes */
  well: [number, number];
}
/** ground that is made: the rock the ramp starts from, the rubble under the breach. Its height is `moundTop`. */
export interface Mound extends Common { t: 'mound'; kind: 'outcrop' | 'fan' | 'vault' | 'rent'; x0: number; x1: number; z0: number; z1: number; cell: number }
/**
 * The underside of a round roof of stone over a length of floor: along the plan from `a` to `b` (the middle line
 * of what it roofs), so wide; it springs from the walls either side at `spring` and its crown is at `crown`.
 * It is seen and stops nothing (the floor over it does that). `gone`: lengths of it that have fallen, [from, to] along it.
 * `lift`: how much higher it is at `b` than at `a` (over a passage that climbs).
 */
export interface Vault extends Common { t: 'vault'; a: [number, number]; b: [number, number]; wide: number; spring: number; crown: number; gone?: [number, number][]; lift?: number }
/** a rock, or a fallen block: where its middle is, half its size each way, and the number it is shaped from */
export interface Lump extends Common { t: 'lump'; x: number; y: number; z: number; rx: number; ry: number; rz: number; seed: number; blocky?: boolean }
/**
 * The ground's own earth laid over ground that has been cut away: everywhere within `reach` metres of any of the
 * pieces of the plan in `wells` (each its corners [x, z], in order round it) and outside the fort's own walls,
 * lying as the ground lay; and none of it over `hole`, which is open to the sky (a stairwell).
 */
/**
 * (`ways`: what is built under that ground and is a place to be, each by its plan and by the top of what is built
 * there, its roof: on a world's own net the earth under the ground is solid everywhere else, down past the cut,
 * and over each of these it is solid down to that top. See `FortLid`.)
 */
export interface Apron extends Common { t: 'apron'; wells: [number, number][][]; hole: [number, number][]; reach: number; ways?: { well: [number, number][]; top: number }[] }
export type Part = Box | Slab | Beam | Rail | Flight | Wall | Curtain | Tower | Mound | Lump | Apron | Vault;

// ------------------------------------------------------------------ where it is

/**
 * How much bigger than its own measure the fort is built (the owner, 2026-10-13: "the castle layout we had before
 * was AMAZINg and dynamic and perfect all i wanted was to scale it up by 20%"). ONE scale for the whole of it:
 * every length in this file and in the post's is in the fort's own measure, which is the plan as it was first
 * laid out, and all of it is set down in the world this much bigger: the kit, the door, the stone made here, the
 * lower levels, the passage out and the loose pieces of its grounds. So the PLAN is a fifth bigger: where things
 * are, and how long and how high walls, rooms, halls and vaults are. What is sized to a body is not: see `body`.
 */
export const CASTLE_SCALE = 1.2;
/**
 * A length that is a body's, said in the fort's own measure: so many metres IN THE WORLD, whatever the fort's
 * scale. Furniture, a parapet's sill and the step behind it, a rail, a rung: somebody is no taller in a fort a
 * fifth bigger. (Where the plan and a body pull apart, the body wins.)
 */
export const body = (metres: number) => metres / CASTLE_SCALE;
/** A spot in the fort's own measure, as a place in the world. */
export function castleAt(p: Place, x: number, z: number, y = 0): V3 {
  const c = Math.cos(p.rot), s = Math.sin(p.rot), S = CASTLE_SCALE;
  return [p.x + S * (x * c + z * s), p.y + S * y, p.z + S * (-x * s + z * c)];
}
/** A place in the world, in the fort's own measure: [x, z, above the terrace]. */
export function castleLocal(p: Place, wx: number, wy: number, wz: number): V3 {
  const dx = wx - p.x, dz = wz - p.z, c = Math.cos(p.rot), s = Math.sin(p.rot), S = CASTLE_SCALE;
  return [(dx * c - dz * s) / S, (dx * s + dz * c) / S, (wy - p.y) / S];
}
/** Whether a point is in the fort itself: on its terrace, in its keep or in one of its towers. */
export function inCastle(p: Place | null, wx: number, wy: number, wz: number): boolean {
  if (!p) return false;
  const [x, z, y] = castleLocal(p, wx, wy, wz), C = CASTLE, T = C.tower;
  if (y > 16) return false;
  // (under the terrace: its lower levels, inside their walls)
  if (y < -0.5) return y > UNDER.postern.deep - 0.6 && ((Math.abs(x) < UNDER.x + 0.5 && Math.abs(z) < UNDER.z + 0.5) || Math.hypot(Math.abs(x) - C.hx, Math.abs(z) - C.hz) < T.r - T.wall);
  if (Math.abs(x) < C.hx + C.parapet.thick / 2 && Math.abs(z) < C.hz + C.parapet.thick / 2) return true;
  return Math.hypot(Math.abs(x) - C.hx, Math.abs(z) - C.hz) < T.r;
}

// ------------------------------------------------------------------ the ground it assumes

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** a line through points [x, y], level beyond its ends */
const through = (pts: [number, number][], x: number) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let k = 1; k < pts.length; k++) if (x <= pts[k][0]) return pts[k - 1][1] + ((pts[k][1] - pts[k - 1][1]) * (x - pts[k - 1][0])) / (pts[k][0] - pts[k - 1][0]);
  return pts[pts.length - 1][1];
};
const hash = (i: number, j: number, s: number) => {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** a slow unevenness, 0..1, the same wherever it is asked */
export function rough(x: number, z: number, seed: number): number {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j, seed), b = hash(i + 1, j, seed), c = hash(i, j + 1, seed), d = hash(i + 1, j + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** the top of the ridge along its length: how high it is under the terrace, by how far east */
const CREST: [number, number][] = [[-150, -10], [-90, -5], [-50, -3], [-30, -4.5], [-13, -6.1], [0, -6.4], [13, -5.8], [30, -5.4], [42, -8], [60, -12], [90, -14.5], [120, -18], [210, -31]];
/** how much of the fort's own shelf there is at a point along the ridge: all of it under the fort, none thirty metres off */
const shelf = (x: number) => 1 - smooth(15, 34, Math.abs(x));

/**
 * The ground the fort is made for, as a height over the terrace (so: a negative number): a knife-edge ridge
 * running east and west, with a shelf on its top where the fort stands, a steep fall to the south and a less
 * steep one to the north, down to a shelf a footpath runs on. It is the brief for whoever shapes the mountain, and
 * the ground the fort is stood on when it is looked at by itself.
 */
export function castleGround(x: number, z: number): number {
  const k = shelf(x), top = through(CREST, x);
  // (away from the fort the ridge's top lies a little north of the fort's own middle line, as the real one's does)
  const dz = z + 3 * (1 - k);
  if (dz < 0) {
    // north: the foot of the wall is lower than the east one's; then thirty degrees, then forty, down to the path
    const flat = 7 + 9 * k, out = Math.max(0, -dz - flat);
    const fall = Math.min(out, 10) * 0.58 + Math.min(Math.max(out - 10, 0), 24) * 0.84 + Math.min(Math.max(out - 34, 0), 7) * 0.08 + Math.max(out - 41, 0) * 0.72;
    return top - 0.9 * k * smooth(0, flat * 0.6, -dz) - fall;
  }
  // south: under the fort it falls at close on sixty degrees, and at thirty-six from there down
  const flat = 6 + 6.6 * k, out = Math.max(0, dz - flat);
  return top - 1.6 * k * smooth(0, flat * 0.6, dz) - Math.min(out, 6) * 1.6 - Math.max(out - 6, 0) * 0.72;
}

/** the rock the ramp starts from: the level top of it, under the terrace, and where that top lies */
export const OUTCROP = { top: -CASTLE.ramp.drop - 0.01, x0: 17.3, x1: 24, z0: -4.7, z1: 1.5, path: -1.6 };
/** the slope of rubble under the breach: where its foot and its head are along the wall, and how wide the way up it is */
export const FAN = { foot: 5.2, head: -3.4, wide: 2.2, end: -6.4 };
const northFace = (y: number) => -CASTLE.hz - CASTLE.parapet.thick / 2 + Math.min(0, y) / CASTLE.lean;

/**
 * How high made ground stands at a spot, over the terrace. The rock: a level top where the ramp lands, a cliff to
 * the west of it (the ramp crosses that), steep sides, and a way up it from the east that a body can walk. The
 * rubble: a slope leant against the north wall that climbs along it from east to west and comes level with the
 * terrace under the breach.
 */
export function moundTop(kind: 'outcrop' | 'fan' | 'vault' | 'rent', x: number, z: number): number {
  if (kind === 'rent') {
    // the stone of the east wall where it fell out: highest where the wall stood, a little over the cellars' floor;
    // spilt a pace or two in over that floor; and outward in a slope a body walks, down to the hill, widening as it goes
    const R = UNDER.rent, wall = CASTLE.hx + 0.35, top = UNDER.floor + 0.45;
    let y = x < wall ? UNDER.floor + 0.03 + (top - UNDER.floor - 0.03) * clamp01((x - R.in) / (wall - R.in)) : top - (x - wall) * 0.55;
    // (it spreads as it goes down, and further to the south, where the hill falls away under it)
    // (north of it the stair down to the sally port and the passage out are close under: there it stands steep, as against the wall's broken end)
    const wide = Math.min(2.2, Math.max(0, x - wall - 0.6) * 0.55), north = Math.max(0, R.z0 + 0.1 - wide * 0.25 - z), south = Math.max(0, z - (R.z1 - 0.1 + wide));
    // (inside the wall's line it lies between the two ends of the wall that are left, and nowhere else: there it is
    // said to be at the underside of the floor, which hides it. Nothing of it anywhere is a drop: a drop in ground
    // that is made stands as a wall across whatever runs under it.)
    if (x < wall + 0.3 && north + south > 0.05) return UNDER.floor - 0.5;
    y -= north * 2.8 + south * 1.1;
    return y + (rough(x * 1.6, z * 1.6, 17) - 0.5) * 0.12 * clamp01((x - R.in) / 1.2);
  }
  if (kind === 'vault') {
    // the bay of the west vault that has fallen in: its stone lies in the gallery under it as a slope, from the
    // gallery's floor at the north end of the hole to the paving at the south end, and drops sheer behind that
    // under the vault that still stands. (The way down into the lower levels for whoever is on the terrace, and
    // the way up out of them.)
    // ITS HEAD IS AT THE EDGE OF THE PAVING, A STEP UNDER IT. (2026-10-14, played: "gaps at the top of the ramps and
    // stairs of the castle where they dont meet flush with the next level (specifically above the serach locker
    // where the broken path is to go up the next level". Its head was said a quarter of a metre short of the hole's
    // south edge and it fell away behind that at once: and a heap is made of squares of 0.3, none of whose rows was
    // at its head, so the row before it was the highest there was. Between that row and the paving lay a notch half
    // a metre across and over a metre deep, with the room of the locker seen down it. Now it comes up to the edge
    // itself (the heap's rows are counted from that edge: see where it is put), and its back is under the paving.)
    const B = UNDER.bay, from = B.z0 + 0.5, to = B.z1, t = clamp01((z - from) / (to - from));
    let y = UNDER.floor + (-0.07 - UNDER.floor) * t;
    // (behind its head it stands as sheer as a row of it lets it, under the vault that still stands: its foot is clear of the locker there)
    if (z > to + 1e-6) return UNDER.floor - 0.3;
    if (z < from) y -= (from - z) * 1.2;
    // (thirty-two degrees, and no rougher than a foot rides over: steeper, and whoever went down it would be carried)
    // (it lies against the outer wall: on the side of the keep's foundation a way is left past it, under the floor's own level there)
    if (x > UNDER.crawl) return UNDER.floor - 0.3;
    // (its last half pace is as even as the paving it comes to: the edge of it is one height all the way across)
    return Math.min(-0.07, y + (rough(x * 1.6, z * 1.6, 13) - 0.5) * 0.1 * Math.min(1, t * 5) * clamp01((to - z) / 0.6));
  }
  if (kind === 'outcrop') {
    const O = OUTCROP;
    // (steeper on the south than on the north: it is under the ground there before the hatch's stairwell and the line its passage takes)
    const west = Math.max(0, O.x0 - x), side = Math.max(0, O.z0 - z, (z - O.z1) * 1.7), east = Math.max(0, x - O.x1);
    // (the way up from the east: a tongue of rock three metres wide, thirty degrees; off it the rock falls away)
    const off = Math.max(0, Math.abs(z - O.path) - 1.6) * smooth(0, 2, east);
    const fell = west * 2.3 + side * 1.9 + east * 0.6 + off * 1.3;
    // (off its top and its way up it is broken rock: bedded in ledges half a pace deep, and no two alike)
    const out = west + side + off, wild = (rough(x * 0.9, z * 0.9, 5) - 0.5) * Math.min(1.5, 0.08 + out * 0.7) + (rough(x * 2.3, z * 2.3, 6) - 0.5) * Math.min(0.5, out * 0.4);
    const y = O.top - fell + wild, bed = Math.round(y / 0.55) * 0.55, k = Math.min(0.7, out * 0.8);
    return y + (bed - y) * k;
  }
  // (None of it is inside the north-west tower, which it runs out against: that tower's foot is hollow, and the
  // heap came through the wall of its cellar as a mound a man high, seen and stood on. There it is under the cellar's floor.)
  if (Math.hypot(x + CASTLE.hx, z + CASTLE.hz) < CASTLE.tower.r - 0.15) return UNDER.floor - 0.6;
  const F = FAN, s = clamp01((F.foot - x) / (F.foot - F.head));
  let y = CASTLE.foot.north * (1 - s);
  // (past its foot and past its head it runs out)
  if (x > F.foot) y -= (x - F.foot) * 0.9;
  if (x < F.end) y -= (F.end - x) * 1.3;
  const edge = northFace(y) - F.wide, past = Math.max(0, edge - z);
  // (never quite level with the terrace: its head is a step under the paving it leads onto)
  return Math.min(-0.06, y - past * 1.25 + (rough(x * 1.7, z * 1.7, 9) - 0.5) * Math.min(0.7, 0.07 + past * 0.5));
}

// ------------------------------------------------------------------ the towers

/** how far out a tower's wall is from its middle, at a height: plumb above the terrace, leaning under it, and nearly plumb again far down */
export function towerRadius(y: number): number {
  const T = CASTLE.tower, K = KIT_TOWER, k = T.kit, foot = -K.top[0] * k;
  if (y >= 0) return T.r;
  // (the kit's own: spread at its foot for two metres of its own height, then leaning in to its platform)
  const h = (y - foot) / k;
  if (h <= 0) return K.foot * k;
  if (h <= K.waist[0]) return (K.foot + ((K.waist[1] - K.foot) * h) / K.waist[0]) * k;
  return (K.waist[1] + ((K.top[1] - K.waist[1]) * (h - K.waist[0])) / (K.top[0] - K.waist[0])) * k;
}
const norm = (a: number) => ((a % 360) + 360) % 360;
/** how much of the way round a tower's platform is open over the head of its stair, degrees: from where the stair is two metres under the boards */
const WELL = 142.5;
/** how far round its stair a direction is, 0..1 from the floor to the platform (null: the stair does not pass there) */
export function stairShare(tw: Tower, a: number): number | null {
  const d = norm((a - tw.stair.from) * Math.sign(tw.stair.sweep));
  return d <= Math.abs(tw.stair.sweep) ? d / Math.abs(tw.stair.sweep) : null;
}

/**
 * @param fallen the part of the way round where its wall has fallen away nearly to the terrace: [from, to], degrees
 * @param stump it has come down on a slant: to `low` on the side it fell to (`toward`, degrees) and no higher than `high` anywhere
 */
function tower(name: string, cx: number, cz: number, foot: number, rim: number, door: number, sweep: number, looks: number[], seed: number, fallen?: [number, number], stump?: { toward: number; low: number; high: number }): Tower {
  const T = CASTLE.tower, tops: number[] = [];
  // The stair comes up on the side of the door. So the well it comes up in is over the door, on the side of the fort,
  // and the platform is whole all round the side of the field, which is the side it is fought from; and whoever
  // comes in at the door comes in under the head of the stair and crosses the floor to its foot.
  const from = door + Math.sign(sweep) * (WELL / 2 + 360 - Math.abs(sweep) - 3.75);
  for (let k = 0; k < T.slots; k++) {
    const mid = (k + 0.5) * (360 / T.slots), toDoor = Math.abs(norm(mid - door + 180) - 180);
    // what is left of its battlement: a stub, a gap a rifle is laid in, a stub; and all of it lower on the side it has fallen in on
    let top = k % 2 === 0 ? rim - hash(k, seed, 1) * 0.35 : T.deck + 1.1 + hash(k, seed, 2) * 0.15;
    if (k % 2 === 0 && hash(k, seed, 3) < 0.25) top = rim - 0.9;
    if (toDoor < 40) top = Math.min(top, T.deck + 0.75 + hash(k, seed, 4) * 0.5);
    // (a ruin: here and there a stub is gone altogether, to a course or two over the boards)
    if (hash(k, seed, 7) < 0.17) top = Math.min(top, T.deck + 0.35 + hash(k, seed, 8) * 0.4);
    if (stump) top = Math.min(top, stump.high - (stump.high - stump.low) * Math.pow(0.5 + 0.5 * Math.cos(((mid - stump.toward) * Math.PI) / 180), 0.8) + (hash(k, seed, 10) - 0.5) * 0.5);
    if (fallen) {
      // where a side of it has come down: lowest in the middle of the fall, and ragged up to what stands either side
      const span = norm(fallen[1] - fallen[0]), into = norm(mid - fallen[0]);
      if (into < span) top = Math.min(top, T.deck + 0.9 - (T.deck - 0.5) * Math.min(1, (Math.min(into, span - into) / (span / 2)) * 1.8) + hash(k, seed, 6) * 0.5);
    }
    tops.push(Math.round(top * 100) / 100);
  }
  const tw: Tower = { t: 'tower', paint: 'stone', at: 'both', name, cx, cz, foot, rim: tops, door, slits: [], stair: { from, sweep }, well: [from + sweep - Math.sign(sweep) * WELL, from + sweep] };
  for (const a of looks) {
    // (a window the stair passes low in front of is put up beside the stair, and is shot from there; one the stair
    // passes high over, or does not pass, is at the floor)
    const share = stairShare(tw, a), h = share === null ? 99 : share * T.deck;
    tw.slits.push(h >= 2.4 ? { a, y0: 0.75, y1: 2.15 } : { a, y0: h + 0.8, y1: h + 2.2 });
  }
  // Two holes where stones have gone, on the side of the field, each at the eye of whoever stands where the stair
  // is as it passes (or on the floor, where the stair is high overhead): clear of the door, the windows and each other.
  const out = (Math.atan2(cz, cx) * 180) / Math.PI;
  tw.lost = [];
  for (const off of [-56, 41]) {
    const a = norm(out + off + (hash(off, seed, 9) - 0.5) * 10), share = stairShare(tw, a), h = share === null || share * T.deck >= 2.4 ? 0 : share * T.deck, y0 = h + 1.2;
    const near = (b: number) => Math.abs(norm(a - b + 180) - 180) < 20;
    if (near(door) || tw.slits.some((q) => near(q.a)) || tops[Math.floor(a / (360 / T.slots)) % T.slots] < y0 + 1.1) continue;
    tw.lost.push({ a, y0, y1: y0 + 0.72 });
  }
  return tw;
}

// ------------------------------------------------------------------ the whole of it, piece by piece

let made: Part[] | null = null;
/** Every piece of the fort, its ramp, the rock the ramp leaves from and the rubble under the breach. (Worked out once: it is the same every time. The loose pieces of its grounds are apart: see `looseParts`.) */
export function castleParts(): Part[] {
  return (made ??= layOut());
}

/** the kit's wall as the fort stands it: how far its foot stands out from the face of its parapet, how deep it is at the foot, and how far along a side one length of it reaches either way from the middle */
const WALL = { out: 0.94, deep: 2.55, half: 7.41 };
/** the gatehouse: the kit's gate, made this big, stood on the east wall's top over the head of the ramp */
const GATEHOUSE = { scale: 0.63 };
/** the door in it: the castle door made this big; where its threshold is (how far in from the middle of the east wall's parapet), how wide a leaf is then, and how far the leaf that still hangs is swung in from shut (radians) */
const DOOR = { scale: 1.1, x: CASTLE.hx - 0.3, leaf: 1.1, swing: 0.95 };
/**
 * What is gone from the parapet of each side, along it (toward +x on the north and south walls, toward +z on the
 * others): [from, to, whether it is one whole merlon (its stump is left on the parapet) or a length of the parapet
 * itself, gone to the walk]. A merlon stands every 3.7 m, four to a side; the gatehouse stands where the east
 * wall's third was. A ruin falls from the top down: the walls under them all stand.
 */
function gaps(side: 'n' | 's' | 'e' | 'w'): [number, number, boolean][] {
  const M = KIT_MERLON;
  /** the merlon that is `k` along the kit's own piece, as the piece is stood on this side: the north and east walls run toward less */
  const merlon = (k: number): [number, number] => (side === 'n' || side === 'e' ? [WALL.half - M.from - k * M.every - M.long, WALL.half - M.from - k * M.every] : [-WALL.half + M.from + k * M.every, -WALL.half + M.from + k * M.every + M.long]);
  const one = (k: number): [number, number, boolean] => [merlon(k)[0], merlon(k)[1], true];
  if (side === 'n') return [[merlon(3)[0] - 0.02, merlon(2)[1] + 0.02, false], one(0)];
  if (side === 's') return [one(0), one(1)];
  if (side === 'e') return [one(3), [UNDER.rent.z1, merlon(0)[1] + 0.02, false]];
  return [one(2)];
}

/**
 * THE FORT'S STONE THAT IS THE KIT'S (2026-10-13): its four walls, the foot of each tower, and the gatehouse over
 * the ramp, as a layout of the fort kit's pieces (src/sim/kit.ts), in the fort's own measure [x, y over the
 * terrace, z]. Ruined with the kit: merlons and lengths of parapet broken out, the east wall broken out to the
 * cellars' floor where it fell (the rent), and blocks of the same wall lying where they came down. Everything
 * else of the fort is its own geometry (the keep, the drums of the towers, every floor and stair, the lower levels).
 * What stops a body for these is `kitSolids` of this list, but for the towers' feet, which have the fort's own.
 */
export function castleKit(): KitPiece[] {
  const C = CASTLE, U = UNDER, T = C.tower, ex = C.hx + C.parapet.thick / 2, ez = C.hz + C.parapet.thick / 2, xo = ex + WALL.out, zo = ez + WALL.out, y0 = -KIT_LEVELS.walk;
  const out: KitPiece[] = [];
  // WHERE A PARAPET IS GONE IT IS CUT FROM A HAIR OVER THE WALK'S TOP, AND THE WALK'S TOP IS LEFT. The kit's walk is at
  // 7.08486 in the piece's own measure (0.0049 here), and runs on under the parapet: cut from 0.004 it went with the
  // parapet, and nothing was drawn underfoot in the gate's passage or along the north wall's gap: the eye went down
  // the hollow wall to its footing. (It was cut so low to be rid of the parapet's underside, which lay in the walk's
  // very plane and flickered: that is taken out of the piece itself now, see `backedOut` in the kit.)
  const gone = 0.0055;
  /** the parapet of a side, cut where it is gone: across the whole of its thickness, from the walk up (a merlon: from the parapet's top up) */
  const top = (side: 'n' | 's' | 'e' | 'w'): Cut[] => gaps(side).map(([u0, u1, whole]) => {
    const lo = whole ? KIT_LEVELS.parapet - KIT_LEVELS.walk - 0.02 : gone;
    const cut = side === 'n' ? cutBox(u0, u1, lo, 4, -ez - 0.2, -ez + 1.3) : side === 's' ? cutBox(u0, u1, lo, 4, ez - 1.3, ez + 0.2) : side === 'e' ? cutBox(ex - 1.3, ex + 0.2, lo, 4, u0, u1) : cutBox(-ex - 0.2, -ex + 1.3, lo, 4, u0, u1);
    // WHAT IS BROKEN OFF LEAVES STONE, NOT A HOLE (see `KitCaps`). A merlon is one hollow skin with the parapet under
    // it: broken off, the parapet was a trough a forearm deep with the walk at the bottom of it; it is closed level
    // where it broke. A parapet gone to the walk has the walk under it: only its two broken ends are closed.
    return { ...cut, cap: whole ? ('all' as const) : ('upright' as const) };
  });
  const wall = 'fort_wall_thin_straight_01', gh = GATEHOUSE.scale, gz = (C.gate.z0 + C.gate.z1) / 2, g0 = gz + ((KIT_GATE.z0 + KIT_GATE.z1) / 2) * gh;
  out.push({ id: wall, name: 'north wall', at: [WALL.half, y0, -zo], turn: -Math.PI / 2, cut: top('n') });
  out.push({ id: wall, name: 'south wall', at: [-WALL.half, y0, zo], turn: Math.PI / 2, cut: top('s') });
  out.push({ id: wall, name: 'west wall', at: [-xo, y0, -WALL.half], turn: 0, cut: [...top('w'), cutBox(-xo - 0.3, -U.x + 0.1, U.floor - 0.02, U.floor + 2.07, U.goat.z0, U.goat.z1)] });
  // (the east wall: its parapet is gone under the gatehouse, which stands in its place; and a length of it fell out to the cellars' floor)
  out.push({ id: wall, name: 'east wall', at: [xo, y0, WALL.half], turn: Math.PI, cut: [...top('e'), cutBox(ex - 1.3, ex + 0.2, gone, 4, g0 - 7.41 * gh, g0), cutBox(U.x - 0.3, xo + 0.5, U.floor + 0.1, 4, U.rent.z0, U.rent.z1)] });
  // the gatehouse: its foot is the east wall's top; the sill across its passage is taken out, and the ramp's boards run through
  out.push({ id: 'fort_wall_thin_gate_01', name: 'gatehouse', at: [ex, 0, g0], turn: Math.PI, scale: gh, cut: [cutBox(ex - WALL.deep * gh - 0.1, ex + 0.2, -0.05, (KIT_GATE.sill + 0.06) * gh + 0.02, g0 - KIT_GATE.z1 * gh - 0.02, g0 - KIT_GATE.z0 * gh + 0.02)] });
  // the foot of each tower: the kit's round tower, its platform level with the terrace. Taken out of it: its middle
  // (the drum stands there, with its own floor), all of its top that is on the terrace's side of the walls, and,
  // of the hollow one, a doorway from its cellar to the lower levels.
  const px = ex + WALL.out - WALL.deep, pz = ez + WALL.out - WALL.deep;
  for (const tw of castleParts()) {
    if (tw.t !== 'tower') continue;
    // (the two that take its top off on the terrace's side are closed with stone where they go through it: the broken
    // ends of its ring of wall, and its top a hand under the terrace. Not the round one: the drum's own floor is there.)
    const cut: Cut[] = [cutRound(tw.cx, tw.cz, T.r - T.wall + 0.04, -0.06, 4), { ...(tw.cx > 0 ? cutBox(-60, px, -0.05, 4, -60, 60) : cutBox(-px, 60, -0.05, 4, -60, 60)), cap: 'all' }, { ...(tw.cz > 0 ? cutBox(-60, 60, -0.05, 4, -60, pz) : cutBox(-60, 60, -0.05, 4, -pz, 60)), cap: 'all' }];
    const d = (tw.door * Math.PI) / 180;
    // (as wide as the doorway's own lining and a hair more, 0.55 either side: wider, and beside the lining the foot was looked into. See the cellar in `towerSteps`.)
    if (tw.hollow !== undefined) cut.push(cutTurned(tw.cx + Math.cos(d) * 3.3, tw.cz + Math.sin(d) * 3.3, Math.PI / 2 - d, 1.9, 0.553, tw.hollow - 0.03, tw.hollow + 2.2));
    // (and nothing of the kit's foot is in the cellar, or within a hand of its wall, which bellies: a block of it stood out of the wall over the doorway)
    if (tw.hollow !== undefined) cut.push(cutRound(tw.cx, tw.cz, T.r - T.wall + 0.3, tw.hollow - 0.05, -0.055));
    out.push({ id: 'fort_tower_round', name: tw.name, at: [tw.cx, -KIT_TOWER.top[0] * T.kit, tw.cz], scale: T.kit, turn: (tw.cx * 7 + tw.cz * 3) * 0.1, cut, body: false });
    // ITS FOOTING: the same tower again under that one's foot, a little bigger (`under`), with everything of it over
    // that foot taken off: so its wall, at the size it has just under its platform, is where the upper one's foot is,
    // and from there it leans out and down eight metres more. The real hill falls away under the two towers on the
    // valley side to twelve metres under the terrace; a plain dark drum of the fort's own stood in the air there.
    const kf = -KIT_TOWER.top[0] * T.kit;
    out.push({ id: 'fort_tower_round', name: `${tw.name} footing`, at: [tw.cx, kf - KIT_TOWER.top[0] * T.under, tw.cz], scale: T.under, turn: (tw.cx * 3 - tw.cz * 5) * 0.1 + 1.3, cut: [cutBox(tw.cx - 9, tw.cx + 9, kf + 0.01, 8, tw.cz - 9, tw.cz + 9)], body: false });
  }
  // blocks of the wall, lying where they came down: under the rent, and under the breach
  const block = (x: number, z: number, y: number, turn: number, tilt: [number, number], scale: number) => void out.push({ id: 'fort_wall_thick_end_01', name: 'fallen wall', at: [x, y, z], turn, tilt, scale });
  block(12.6, U.rent.z1 + 1.5, moundTop('rent', 12.9, U.rent.z1 + 1.6) - 0.25, 0.5, [1.25, 0.2], 0.17);
  block(15.3, U.rent.z1 + 2.3, moundTop('rent', 15.5, U.rent.z1 + 2.2) - 0.3, 2.1, [-1.4, 0.35], 0.14);
  block(-1.6, -ez - 3.4, moundTop('fan', -1.2, -ez - 3.2) - 0.3, 1.2, [1.35, -0.3], 0.16);
  return out;
}

/** The door at the gate, as a layout of the castle door's own pieces: its frame in the passage, one leaf hung open inward against the passage's wall, one off its hinges and lying on the paving inside. */
export function castleDoor(): KitPiece[] {
  const C = CASTLE, s = DOOR.scale, gz = (C.gate.z0 + C.gate.z1) / 2, turn = Math.PI / 2;
  return [
    { id: 'large_castle_door_frame', at: [DOOR.x, 0, gz], turn, scale: s, body: false },
    // (the leaf whose hinge is on the south side, swung in until it lies along that wall of the passage)
    { id: 'large_castle_door_left', at: [DOOR.x, 1.165 * s, gz + 0.987 * s], turn: turn + DOOR.swing, scale: s, body: false },
    { id: 'large_castle_door_right', at: [DOOR.x - 2.3, 0.07, gz + 0.5], turn: 0.5, tilt: [Math.PI / 2, 0], scale: s, body: false },
  ];
}

/**
 * Scanned rock, as a layout of the rock face's one piece: round the rock the ramp leaves from, and under the north
 * and south walls where the hill falls away from their feet. Each is a sheet that leans back from its foot, its
 * face toward where it is turned to: it is bedded against the made rock and the footings, which are what stop a
 * body. `ground` is how high the ground is at a spot, over the terrace.
 */
export function castleRocks(ground: (x: number, z: number) => number = castleGround, rock = true): KitPiece[] {
  const C = CASTLE, O = OUTCROP, out: KitPiece[] = [], zo = C.hz + C.parapet.thick / 2 + WALL.out;
  /** one of them: where the middle of its foot is on the plan, which way it faces (degrees: 0 east, 90 south), how big, and how much steeper than it came it stands */
  const face = (x0: number, z0: number, toward: number, scale: number, steep = 0.3, sink = 0.25, proud = 1.5) => {
    // (it stands so far out from where it was asked for, the way it faces: it leans back, and what it leans on is behind its top, not its foot)
    const a = (toward * Math.PI) / 180, turn = Math.atan2(Math.cos(a), Math.sin(a)), x = x0 + Math.cos(a) * proud, z = z0 + Math.sin(a) * proud;
    // (not where the ground falls away before it: the world's own cliff is rock already, and a sheet stood at its lip hangs out over it in the air)
    if (ground(x, z) - Math.min(ground(x + Math.cos(a) * 4, z + Math.sin(a) * 4), ground(x + Math.cos(a) * 6.5, z + Math.sin(a) * 6.5)) > 4) return;
    // (its own origin is to one side of its middle: it is set so that its middle is where it was asked for)
    const off = -0.35 * scale;
    // (it stops a body as the rock it is: `KIT_ROCK` in the kit. It stopped nothing, and was walked through.)
    out.push({ id: 'rock_face_01', at: [x + Math.cos(turn) * off, ground(x, z) - sink * scale, z - Math.sin(turn) * off], turn, tilt: [steep, 0], scale });
  };
  if (rock) {
    face((O.x0 + O.x1) / 2, O.z1 + 0.6, 90, 1.5, 0.42);
    face((O.x0 + O.x1) / 2 + 0.6, O.z0 - 1.2, 270, 1.5, 0.42);
    face(O.x1 + 1.6, O.z0 - 0.4, 310, 1.3, 0.35);
    face(O.x1 + 1.6, O.z1 + 0.2, 50, 1.3, 0.35);
  }
  // (under the south wall only: under the north one the rubble of the breach lies along the whole of it, and that is walked)
  for (const x of [-4.4, 4.2]) face(x + 0.8, zo - 0.4, 90, 1.3, 0.5, 0.3, 1.9);
  return out;
}

function layOut(): Part[] {
  const C = CASTLE, P = C.parapet, K = C.keep, R = K.room, parts: Part[] = [];
  const box = (paint: Paint, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, o: Partial<Box> = {}) => void parts.push({ t: 'box', paint, x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0, y1, z0: Math.min(z0, z1), z1: Math.max(z0, z1), ...o });
  const beam = (a: V3, b: V3, w: number, h: number, o: Partial<Beam> = {}) => void parts.push({ t: 'beam', paint: 'timber', a, b, w, h, body: 'none', ...o });
  const rail = (a: V3, b: V3, o: Partial<Rail> = {}) => void parts.push({ t: 'rail', paint: 'timber', a, b, body: 'feet', ...o });
  const flight = (foot: V3, head: V3, w: number, o: Partial<Flight> = {}) => void parts.push({ t: 'flight', paint: 'timber', foot, head, w, body: 'feet', ...o });
  const lump = (x: number, y: number, z: number, rx: number, ry: number, rz: number, seed: number, o: Partial<Lump> = {}) => void parts.push({ t: 'lump', paint: 'rock', x, y, z, rx, ry, rz, seed, ...o });
  /** what is left of lo..hi when the stretches in `cut` are taken out of it */
  const spans = (lo: number, hi: number, cut: [number, number][]) => {
    const out: [number, number][] = [];
    let from = lo;
    for (const [a, b] of [...cut].sort((p, q) => p[0] - q[0])) {
      if (a > from) out.push([from, Math.min(a, hi)]);
      from = Math.max(from, b);
    }
    if (from < hi) out.push([from, hi]);
    return out.filter(([a, b]) => b - a > 0.02);
  };

  // ---- the terrace: one floor, from wall to wall, and the keep stands on it
  const ex = C.hx + P.thick / 2, ez = C.hz + P.thick / 2;
  const U = UNDER;
  /** a floor from corner to corner less the holes in it ([x0, x1, z0, z1] each), as blocks */
  const tiles = (x0: number, x1: number, z0: number, z1: number, holes: number[][]) => {
    const cutsOf = (lo: number, hi: number, k: number) => [...new Set([lo, hi, ...holes.flatMap((h) => [h[k], h[k + 1]])])].filter((v) => v >= lo && v <= hi).sort((p, q) => p - q);
    const xs = cutsOf(x0, x1, 0), zs = cutsOf(z0, z1, 2), out: number[][] = [];
    for (let j = 0; j + 1 < zs.length; j++) {
      let run: number[] | null = null;
      for (let i = 0; i + 1 < xs.length; i++) {
        const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
        if (holes.some((h) => cx > h[0] && cx < h[1] && cz > h[2] && cz < h[3])) run = null;
        else if (run) run[1] = xs[i + 1];
        else out.push((run = [xs[i], xs[i + 1], zs[j], zs[j + 1]]));
      }
    }
    return out;
  };
  // (its holes: the fallen bay, the stair down from the store, the gratings, and the corner of it that is under the hole in the north-west tower's boards)
  const DR = U.cistern.drop;
  // (THE CORNER UNDER THE NORTH-WEST TOWER: all of the paving that is inside the round of its cellar, and a hand more,
  // for the cellar's wall bellies. The paving ends at the inner faces of the kit's walls, and one hole said from the
  // walls' outer faces to 8.8 and 8.9 took nothing out of it: its corner stood in the cellar under the boards, a block
  // of stone a metre deep hung over the doorway. Three pieces, stepped round the cellar; none of them reaches out from
  // under the tower's own wall but at its door, where the tower's boards run on over them: see `towerSteps`.)
  const nwx = -C.hx, nwz = -C.hz;
  const holes = [[DR.x0, DR.x1, DR.z0, DR.z1], [U.x, ex, U.rent.z0, U.rent.z1], [U.bay.x0, U.bay.x1, U.bay.z0, U.bay.z1], [U.stair.head, U.stair.open, R.z0, R.z0 + 1], ...U.gratings.map(([x, z]) => [x - 0.45, x + 0.45, z - 0.45, z + 0.45]), [-ex, nwx + 1.94, -ez, nwz + 1.56], [-ex, nwx + 1.56, -ez, nwz + 1.94], [-ex, nwx + 1.76, -ez, nwz + 1.76]];
  // (as far as the inner face of the kit's walls: their own tops, level with it, are the rest)
  const px = ex + WALL.out - WALL.deep + 0.02, pz = ez + WALL.out - WALL.deep + 0.02;
  for (const [x0, x1, z0, z1] of tiles(-px, px, -pz, pz, holes)) box('paving', x0, x1, U.roof, 0, z0, z1, { name: 'terrace', at: 'both' });
  // a grating: bars a hand apart. A body goes over it; a shot goes through
  for (const [x, z] of U.gratings) {
    for (let k = -2; k <= 2; k++) beam([x - 0.47, -0.035, z + k * 0.19], [x + 0.47, -0.035, z + k * 0.19], 0.035, 0.05, { paint: 'iron', name: 'grating' });
    for (const k of [-1, 1]) beam([x + k * 0.3, -0.06, z - 0.47], [x + k * 0.3, -0.06, z + 0.47], 0.05, 0.03, { paint: 'iron', name: 'grating' });
    box('iron', x - 0.47, x + 0.47, -0.07, 0, z - 0.47, z + 0.47, { hidden: true, body: 'feet', name: 'grating' });
  }

  // ---- UNDER IT: THE VAULTS (see UNDER). All of it is `low`: drawn only while somebody is near enough to see into it.
  const lbox = (paint: Paint, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, o: Partial<Box> = {}) => box(paint, x0, x1, y0, y1, z0, z1, { low: true, ...o });
  const PS = U.postern, UF = U.floor, CI = U.cistern, CF = UF - CI.deep, G = U.goat, M = U.mid;
  // (every vault springs from its walls at one height, and every arch that carries one has its crown there: an arch that stood higher would be cut by the vault it carries)
  const SPRING = UF + 2.05;
  // its floors: the cistern's, a knee under the rest; and the rest (open over the stair down to the sally port)
  for (const [x0, x1, z0, z1] of tiles(-U.x - 0.4, CI.x1, -U.z - 0.4, CI.z1, [])) lbox('paving', x0, x1, CF - 0.5, CF, z0, z1, { name: 'cistern floor', tone: 0.7 });
  for (const [x0, x1, z0, z1] of tiles(-U.x - 0.4, U.x + 0.4, -U.z - 0.4, U.z + 0.4, [[-U.x - 0.4, CI.x1, -U.z - 0.4, CI.z1], [K.x0, CI.x1, CI.z1 - 0.01, CI.z1 + 0.1], [PS.x0, PS.x1, PS.head, PS.end]])) lbox('paving', x0, x1, UF - 0.5, UF, z0, z1, { name: 'undercroft floor', tone: 0.82 });
  // (Its edge along the cistern is inside the thickness of the keep's north foundation, not in the plane of that wall's
  // face; and no wall of the lower levels has a sill or a top in the plane of it: each either stands from under it
  // with its doorways cut from its own foot, or has a threshold a finger proud. Two faces in one plane are drawn
  // turn and turn about, and were seen to: 2026-10-13, "many textures are overlapping in the castle".)
  // its outer walls (each ends where the foot of a tower comes into the corner: that is the wall there). The west
  // one has the postern's doorway in it; the east one is gone where it fell out.
  const WE = 7.05;
  lbox('stone', -WE, WE, CF, U.roof, -U.z - 0.6, -U.z, { name: 'undercroft wall' });
  lbox('stone', -WE, WE, UF, U.roof, U.z, U.z + 0.6, { name: 'undercroft wall' });
  lbox('stone', -U.x - 0.6, -U.x, CF, U.roof, -WE, G.z0, { name: 'undercroft wall' });
  lbox('stone', -U.x - 0.6, -U.x, UF, U.roof, G.z1, WE, { name: 'undercroft wall' });
  lbox('stone', -U.x - 0.6, -U.x, UF + 2.05, U.roof, G.z0, G.z1, { name: 'undercroft wall' });
  lbox('stone', U.x, U.x + 0.6, UF, U.roof, -WE, U.rent.z0, { name: 'undercroft wall' });
  lbox('stone', U.x, U.x + 0.6, UF, U.roof, U.rent.z1, WE, { name: 'undercroft wall' });

  // THE CISTERN: its water, a row of pillars down the middle of it, and under the hole in the terrace walk the
  // stone that fell in, standing out of the water (somewhere to land, and to be seen landing)
  lbox('water', -U.x, CI.x1, CF + 0.02, UF + CI.water, -U.z, CI.z1, { name: 'water', body: 'none' });
  // (an arcade down the middle of it: five piers and the arches between them, which its two vaults spring from)
  parts.push({ t: 'wall', paint: 'stone', low: true, name: 'cistern arcade', a: [-U.x, ARCADE.z], b: [CI.x1, ARCADE.z], y0: CF, top: U.roof, thick: ARCADE.thick, openings: ARCADE.arches.map(([u0, u1]) => ({ u0, u1, y0: CF - 0.05, y1: SPRING, arch: true, rise: 0.55 })) });
  // THE VAULTS' ROOFS: a round roof of stone over each side and each aisle, springing from the walls a man's height
  // up; gone where the terrace over it has fallen in, and open under the gratings
  const vault = (a: [number, number], b: [number, number], wide: number, gone?: [number, number][]) => void parts.push({ t: 'vault', paint: 'stone', low: true, tone: 0.78, name: 'vault', a, b, wide, spring: SPRING, crown: U.roof - 0.02, gone });
  vault([-U.x, (-U.z - 6.5) / 2], [CI.x1, (-U.z - 6.5) / 2], U.z - 6.5, [[DR.x0 - 0.2 + U.x, DR.x1 + 0.2 + U.x], [1.9 - 0.5 + U.x, 1.9 + 0.5 + U.x]]);
  vault([-U.x, (-6.0 + CI.z1) / 2], [CI.x1, (-6.0 + CI.z1) / 2], CI.z1 + 6.0);
  vault([(CI.x1 + U.x) / 2, -U.z], [(CI.x1 + U.x) / 2, U.z], U.x - CI.x1, [[-6 - 0.5 + U.z, -6 + 0.5 + U.z]]);
  vault([-U.x, (K.z1 + U.z) / 2], [CI.x1, (K.z1 + U.z) / 2], U.z - K.z1);
  vault([(-U.x + K.x0) / 2, CI.z1], [(-U.x + K.x0) / 2, K.z1], K.x0 + U.x, [[U.bay.z0 - 0.15 - CI.z1, U.bay.z1 + 0.15 - CI.z1]]);
  // (the armoury: three, side by side, on arches from its two piers to its walls)
  vault([(M.x0 - 1.3) / 2, U.armoury.z0], [(M.x0 - 1.3) / 2, M.z1], -1.3 - M.x0);
  vault([-0.1, U.armoury.z0], [-0.1, M.z1], 2.4, [[1.2 - 0.5 - U.armoury.z0, 1.2 + 0.5 - U.armoury.z0]]);
  vault([(1.1 + M.x1) / 2, U.armoury.z0], [(1.1 + M.x1) / 2, M.z1], M.x1 - 1.1);
  for (const x of [-1.3, 1.1]) parts.push({ t: 'wall', paint: 'stone', low: true, name: 'armoury arch', a: [x, U.armoury.z0], b: [x, M.z1], y0: UF, top: U.roof, thick: 0.4, openings: [[0, 1 - 0.34 - U.armoury.z0], [1 + 0.34 - U.armoury.z0, M.z1 - U.armoury.z0]].map(([u0, u1]) => ({ u0, u1, y0: UF - 0.05, y1: SPRING, arch: true, rise: 0.5 })) });
  // (out of the water: where its floor meets the rest there is a step half way up, and what is walked on is one slope over it, as under any stair: at the door of the stair, and across its east and west ends)
  for (const [x0, x1, z0, z1, way] of [[2.2, 3.2, CI.z1 - 0.75, CI.z1, 'z'], [CI.x1 - 0.75, CI.x1, -U.z, CI.z1, 'x'], [-U.x, K.x0, CI.z1 - 0.75, CI.z1, 'z']] as [number, number, number, number, 'x' | 'z'][]) {
    if (way === 'z') lbox('base', x0, x1, CF, CF + CI.deep / 2, z1 - 0.38, z1, { name: 'cistern step', tone: 0.75 });
    else lbox('base', x1 - 0.38, x1, CF, CF + CI.deep / 2, z0, z1, { name: 'cistern step', tone: 0.75 });
    parts.push({ t: 'slab', paint: 'base', hidden: true, body: 'feet', low: true, name: 'cistern step', p: way === 'z' ? [[x0, CF, z0], [x1, CF, z0], [x1, UF, z1], [x0, UF, z1]] : [[x0, CF, z1], [x0, CF, z0], [x1, UF, z0], [x1, UF, z1]], thick: 0.08 });
  }
  for (const [x, z, r, h] of [[-1.3, -7.2, 0.62, 0.3], [-0.35, -6.75, 0.5, 0.36], [-1.75, -6.6, 0.42, 0.22], [-0.7, -7.75, 0.4, 0.2]]) lump(x, CF + h, z, r, h, r * 0.8, Math.round(600 + x * 13 - z * 7), { paint: 'stone', blocky: true, name: 'fallen walk', low: true });

  // THE POSTERN: a doorway from the west side through the wall's foot, lined with rough stone; outside it a landing,
  // and a stair of stone down along the foot of the wall to the hill (it is built down past the ground the fort
  // assumes: what the hill has of it, it hides)
  const gx = -ex - WALL.out * 0.55 - 0.1, gs0 = -ex - WALL.out - 1.25, gs1 = -ex - WALL.out - 0.2;
  box('base', gx, -U.x - 0.6, UF - 0.3, UF, G.z0 - 0.25, G.z1 + 0.25, { name: 'postern sill' });
  box('base', gx, -U.x - 0.6, UF, UF + 2.05, G.z0 - 0.25, G.z0, { name: 'postern jamb' });
  box('base', gx, -U.x - 0.6, UF, UF + 2.05, G.z1, G.z1 + 0.25, { name: 'postern jamb' });
  box('base', gx, -U.x - 0.6, UF + 2.05, UF + 2.4, G.z0 - 0.25, G.z1 + 0.25, { name: 'postern lintel' });
  box('base', gs0, gx, UF - 4.8, UF, G.z0 - 0.1, G.z1 + 0.1, { name: 'postern landing', at: 'both' });
  flight([(gs0 + gs1) / 2, UF - 4.8, G.z1 + 5.6], [(gs0 + gs1) / 2, UF, G.z1 + 0.1], gs1 - gs0, { paint: 'base', name: 'postern stair' });

  // THE RENT in the east wall: where a length of it fell out. What is left either side shows what a wall is filled
  // with; its stone lies in a slope from the floor down to the hill outside, and a little way in over that floor.
  for (const [z, side] of [[U.rent.z0, -1], [U.rent.z1, 1]]) parts.push({ t: 'wall', paint: 'base', tone: 0.85, at: 'both', name: 'broken wall end', a: [U.x + 0.6, z + side * 0.3], b: [ex + 0.9, z + side * 0.3], y0: UF - 0.5, top: [-0.05, -0.5, -1.3, -2.3, -3.2], thick: 0.6 });
  parts.push({ t: 'mound', paint: 'scree', at: 'both', name: 'fallen wall', kind: 'rent', x0: U.rent.in - 0.6, x1: 17.7, z0: PS.end + 0.35, z1: U.rent.z1 + 4.2, cell: 0.35 });
  for (let k = 0; k < 10; k++) {
    const x = 8.6 + hash(k, 1, 541) * 6.5, z = U.rent.z0 + 0.3 + hash(k, 2, 541) * (U.rent.z1 - U.rent.z0 - 0.6) + (hash(k, 6, 541) - 0.3) * Math.max(0, x - 11.5) * 0.5;
    lump(x, moundTop('rent', x, z) + 0.12, z, 0.3 + hash(k, 3, 541) * 0.35, 0.18 + hash(k, 4, 541) * 0.14, 0.26 + hash(k, 5, 541) * 0.26, 550 + k, { paint: 'stone', blocky: true, name: 'fallen stone', body: 'none', at: 'both' });
  }

  // THE ARMOURY: the keep's foundations are its walls. One door, on the south; the wall on the north is thin (the
  // cistern runs in under the keep there) and has the door of the stair in it; a wall shuts the stair's slot off.
  // (the north one stands in the cistern, from the cistern's floor: the door of the stair in it has a threshold, a finger
  // proud of the floor. The other three stand from just under the floor, and the south one's door is cut from its foot.)
  const arched = (u0: number, u1: number, y0: number): Opening => ({ u0, u1, y0, y1: UF + 2.15, arch: true });
  const found = (a: [number, number], b: [number, number], thick: number, openings: Opening[], y0 = UF - 0.02) => void parts.push({ t: 'wall', paint: 'stone', low: true, name: 'keep foundation', a, b, y0, top: U.roof, thick, openings });
  found([K.x0, (CI.z1 + M.z0) / 2], [K.x1, (CI.z1 + M.z0) / 2], M.z0 - CI.z1, [arched(2.25 - K.x0, 3.15 - K.x0, UF + 0.015)], CF);
  found([K.x1, (K.z1 + M.z1) / 2], [K.x0, (K.z1 + M.z1) / 2], K.z1 - M.z1, [arched(K.x1 + 0.5, K.x1 + 1.7, UF - 0.02)]);
  found([(K.x0 + M.x0) / 2, M.z1], [(K.x0 + M.x0) / 2, M.z0], M.x0 - K.x0, []);
  found([(K.x1 + M.x1) / 2, M.z0], [(K.x1 + M.x1) / 2, M.z1], K.x1 - M.x1, []);
  parts.push({ t: 'wall', paint: 'stone', low: true, name: 'armoury wall', a: [M.x0, U.armoury.z0 - 0.1], b: [M.x1, U.armoury.z0 - 0.1], y0: UF, top: U.roof, thick: 0.2 });
  // the stair from the keep's store, down its slot to the door on the cistern; a rail round the hole it comes up through, in the store
  flight([U.stair.foot, UF, U.stair.z], [U.stair.head, 0, U.stair.z], 1, { paint: 'base', name: 'stair to the undercroft', low: true });
  rail([U.stair.head + 0.45, 0, R.z0 + 1], [U.stair.open, 0, R.z0 + 1]);
  rail([U.stair.open, 0, R.z0 + 1], [U.stair.open, 0, R.z0]);
  // two piers in it; and its grille: iron bars on a frame, hung on the west jamb of its door and standing open into the room
  for (const [x, z] of [[-1.3, 1], [1.1, 1]]) lbox('stone', x - 0.32, x + 0.32, UF, U.roof, z - 0.32, z + 0.32, { name: 'pier' });
  {
    const hx = -1.68, hz = M.z1 + 0.22, swing = 0.27, long = 1.14, dir: [number, number] = [Math.sin(swing), -Math.cos(swing)], at = (k: number, y: number): V3 => [hx + dir[0] * k, y, hz + dir[1] * k];
    for (let k = 0; k <= 8; k++) beam(at((long * k) / 8, UF + 0.04), at((long * k) / 8, UF + 2.05), 0.028, 0.028, { paint: 'iron', name: 'grille', low: true });
    for (const y of [0.1, 1.05, 2.0]) beam(at(0, UF + y), at(long, UF + y), 0.035, 0.05, { paint: 'iron', name: 'grille', low: true });
    const mid = at(long / 2, 0);
    // (bars stop a body and not a shot)
    box('iron', mid[0] - long / 2, mid[0] + long / 2, UF, UF + 2.05, mid[2] - 0.03, mid[2] + 0.03, { hidden: true, body: 'feet', name: 'grille', yaw: Math.PI / 2 - swing, low: true });
  }

  // THE SALLY PORT's pier, and an arch across each side here and there: each bay between two of them is a vault
  lbox('stone', 5.55 - 0.32, 5.55 + 0.32, UF, U.roof, -1.6 - 0.32, -1.6 + 0.32, { name: 'pier' });
  const rib = (a: [number, number], b: [number, number]) => void parts.push({ t: 'wall', paint: 'stone', low: true, name: 'vault rib', a, b, y0: UF, top: U.roof, thick: 0.45, openings: [{ u0: 0.28, u1: Math.hypot(b[0] - a[0], b[1] - a[1]) - 0.28, y0: UF - 0.1, y1: U.roof - 0.3, arch: true }] });
  rib([-U.x, -2.6], [K.x0, -2.6]);
  // THE AID POST: three cells against the outer wall, each open to the passage under its own arch (a cot is seen
  // in each from the passage, and whoever is in one is seen), and the passage past them
  parts.push({ t: 'wall', paint: 'stone', low: true, name: 'cells', a: [-3.3, 6.9], b: [3.9, 6.9], y0: UF, top: U.roof, thick: 0.3, openings: [0, 1, 2].map((k) => ({ u0: 0.32 + k * 2.4, u1: 2.08 + k * 2.4, y0: UF - 0.05, y1: UF + 2, arch: true, rise: 0.45 })) });
  for (const x of [-3.3, -0.9, 1.5, 3.9]) lbox('stone', x - 0.13, x + 0.13, UF, U.roof, 7.05, U.z, { name: 'cells' });
  // (and an arch across the south side west of them, and one across the east side south of the stair: the bays of two long vaults)
  rib([-5.0, K.z1], [-5.0, U.z]);
  rib([K.x1, 2.6], [U.x, 2.6]);
  // the west side: the stone of its fallen bay, lying against the outer wall as it fell (seen from the terrace
  // through the hole it left); and a slab of the vault across the way that is left past it, to be crouched under
  // (its rows are counted from the south edge of the hole, where its head is: one of them is on that edge. See `moundTop`.)
  parts.push({ t: 'mound', paint: 'scree', name: 'fallen vault', kind: 'vault', x0: -U.x - 0.2, x1: U.crawl + 0.4, z0: U.bay.z1 - 24 * 0.3, z1: U.bay.z1 + 3 * 0.3, cell: 0.3 });
  for (let k = 0; k < 7; k++) {
    const x = -U.x + 0.3 + hash(k, 1, 501) * 0.7, z = U.bay.z0 + 0.9 + hash(k, 2, 501) * 3.6;
    lump(x, moundTop('vault', x, z) + 0.05, z, 0.24 + hash(k, 3, 501) * 0.2, 0.1, 0.2 + hash(k, 4, 501) * 0.16, 510 + k, { paint: 'stone', blocky: true, name: 'fallen stone', body: 'none' });
  }
  lbox('base', U.crawl + 0.15, K.x0, UF + 1.22, UF + 1.62, 0.9, 3.3, { name: 'fallen slab', tone: 0.9 });
  // the east side: the stair down to the passage out, in a slot along the outer wall, railed on the side's own side
  flight([(PS.x0 + PS.x1) / 2, PS.deep, PS.foot], [(PS.x0 + PS.x1) / 2, UF, PS.head], PS.x1 - PS.x0, { paint: 'base', name: 'stair to the passage out', low: true });
  // (each of its walls stops at the underside of the floor, whose edge is the lip of the slot; and the two long ones stop at the end one)
  lbox('base', PS.x0 - 0.25, PS.x0, PS.deep - 0.3, UF - 0.5, PS.head, PS.end, { name: 'passage stair wall' });
  lbox('base', PS.x1, PS.x1 + 0.25, PS.deep - 0.3, UF - 0.5, PS.head, POSTERN.z - 0.75, { name: 'passage stair wall' });
  lbox('base', PS.x1, PS.x1 + 0.25, PS.deep - 0.3, UF - 0.5, POSTERN.z + 0.75, PS.end, { name: 'passage stair wall' });
  lbox('base', PS.x1, PS.x1 + 0.25, PS.deep + U.hatch.tall, UF - 0.5, POSTERN.z - 0.75, POSTERN.z + 0.75, { name: 'passage stair wall' });
  lbox('base', PS.x0 - 0.25, PS.x1 + 0.25, PS.deep - 0.3, UF - 0.5, PS.end, PS.end + 0.25, { name: 'passage stair wall' });
  lbox('base', PS.x0, PS.x1, PS.deep - 0.3, PS.deep, PS.foot, PS.end, { name: 'passage landing' });
  // THE DOORWAY'S CASE, on the passage's side of it: a sill, a head and two jambs of stone, square to the fort, a pace
  // into the passage. The passage comes to this doorway at a slant (it is made to wherever the hatch is), and its
  // floor, its roof and its walls end square to ITS line: between their ends and the wall of the slot there was a
  // wedge open on one side, a hand to a foot wide, in the floor, the roof and the wall (2026-10-13: "the path
  // underground at the base of the stairs is bugged with panels ... missing"). The case stands a finger behind
  // the passage's own faces, and is what is seen wherever those stop short.
  {
    const x0 = PS.x1 - 0.02, x1 = PS.x1 + 0.25 + 0.75, z0 = POSTERN.z - 0.75, z1 = POSTERN.z + 0.75, tall = U.hatch.tall;
    lbox('base', x0, x1, PS.deep - 0.3, PS.deep - 0.005, z0 - 0.3, z1 + 0.3, { name: 'sally port doorway', tone: 0.78 });
    lbox('base', PS.x1 + 0.24, x1, PS.deep + tall + 0.008, PS.deep + tall + 0.32, z0 - 0.3, z1 + 0.3, { name: 'sally port doorway', tone: 0.78, body: 'none' });
    for (const [a, b] of [[z0 - 0.3, z0 - 0.02], [z1 + 0.02, z1 + 0.3]]) lbox('base', PS.x1 + 0.24, x1, PS.deep - 0.3, PS.deep + tall + 0.32, a, b, { name: 'sally port doorway', tone: 0.78, body: 'none' });
  }
  parts.push({ t: 'rail', paint: 'timber', body: 'feet', low: true, a: [PS.x0, UF, PS.head + 0.3], b: [PS.x0, UF, PS.end], name: 'passage stair rail' });
  parts.push({ t: 'rail', paint: 'timber', body: 'feet', low: true, a: [PS.x0, UF, PS.end], b: [PS.x1, UF, PS.end], name: 'passage stair rail' });
  // under the hole in the north-west tower's boards: what fell through, lying clear of the way from under the hole to the cellar's doorway
  for (const [dx, dz, r] of [[-0.45, -0.35, 0.5], [-0.35, 0.65, 0.36], [0.6, -0.6, 0.33]]) lump(-C.hx + dx, UF + 0.16, -C.hz + dz, r, 0.16, r * 0.8, 520 + Math.round(r * 100), { paint: 'timber', blocky: true, name: 'fallen boards', low: true });

  // ---- THE WALLS ARE THE KIT'S (see `castleKit`): a length of its thin wall on each side, tower to tower, its
  // walk level with the paving and its low thick parapet and merlons along the outside. What is made here is what
  // a ruin adds to them: the core of the wall where a merlon or a length of parapet has gone, and the stone that came down.
  type Side = 'n' | 's' | 'e' | 'w';
  /** a block said by how far along a wall it is (toward +x on the north and south walls, toward +z on the others), and how far out from the wall's middle line */
  const along = (side: Side, paint: Paint, u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, o: Partial<Box> = {}) => {
    if (side === 'n') box(paint, u0, u1, y0, y1, -C.hz - v1, -C.hz - v0, o);
    else if (side === 's') box(paint, u0, u1, y0, y1, C.hz + v0, C.hz + v1, o);
    else if (side === 'e') box(paint, C.hx + v0, C.hx + v1, y0, y1, u0, u1, o);
    else box(paint, -C.hx - v1, -C.hx - v0, y0, y1, u0, u1, o);
  };
  const half = P.thick / 2, faceIn = half - (KIT_MERLON.x1 - KIT_MERLON.x0), sill = KIT_LEVELS.parapet - KIT_LEVELS.walk;
  // (the kit's wall is seven metres from its walk to its foot, and on the north and the south the hill is lower than that: under each wall a footing of rough stone, a hand proud of the wall's foot, down into the ground)
  for (const side of ['n', 's', 'e', 'w'] as Side[]) along(side, 'base', -WALL.half, WALL.half, half + WALL.out - WALL.deep, half + WALL.out + 0.12, -C.deep, -KIT_LEVELS.walk + 0.04, { name: 'footing', tone: 0.8, at: 'both' });
  for (const side of ['n', 's', 'e', 'w'] as Side[]) {
    const seed = { n: 201, s: 202, e: 203, w: 204 }[side];
    for (const [u0, u1, whole] of gaps(side)) {
      // (where a merlon stood there is no top to the parapet under it: what shows is the wall's core, a course or two of it left)
      if (whole) {
        // (set a hand inside the kit's parapet on both its faces, and straight as the kit is: laid two fingers inside it and bent as rough stone is, it came out through the parapet's face and lay in the plane of it by turns)
        along(side, 'base', u0 + 0.04, u1 - 0.04, faceIn + 0.09, half - 0.09, sill - 0.3, sill + 0.04 + hash(Math.round(u0 * 7), seed, 1) * 0.22, { name: 'merlon stump', tone: 0.85, body: 'none', straight: true });
        continue;
      }
      // (a length of parapet gone to the walk: a broken end of it either side)
      for (const [a, b] of [[u0 - 0.28, u0 + 0.02], [u1 - 0.02, u1 + 0.28]]) if (!(side === 'e' && a > UNDER.rent.z0 - 0.4)) along(side, 'base', a, b, faceIn + 0.05, half - 0.05, 0.03, sill - 0.04 - hash(Math.round(a * 9), seed, 2) * 0.2, { name: 'broken parapet', tone: 0.85, straight: true });
    }
    // the stone of what is gone: flat on the paving inside (low enough to be walked over), and tumbled outside
    for (const [a, b, whole] of gaps(side)) for (let k = 0; k < (whole ? 2 : 5); k++) {
      const u = a + ((k + 0.5) / (whole ? 2 : 5)) * (b - a) + (hash(k, seed, 5) - 0.5) * 0.4, inside = k % 2 === 0, v = inside ? faceIn - 0.6 - hash(k, seed, 6) * 1.2 : half + WALL.out + 0.5 + hash(k, seed, 6) * 1.6;
      const [x, z] = side === 'n' ? [u, -C.hz - v] : side === 's' ? [u, C.hz + v] : side === 'e' ? [C.hx + v, u] : [-C.hx - v, u];
      // (none inside along the west wall, where the vault fell in; none in the way to a tower's door, or to the gate)
      // (and none over the hole in the north walk: what fell there went down it)
      if (inside && (side === 'w' || Math.abs(u) > 5.5 || (side === 'e' && u > C.gate.z0 - 1.2 && u < C.gate.z1 + 1.2) || (side === 'n' && u > DR.x0 - 0.7 && u < DR.x1 + 0.7))) continue;
      if (inside) lump(x, 0.11, z, 0.3 + hash(k, seed, 7) * 0.22, 0.11, 0.22 + hash(k, seed, 8) * 0.14, 400 + seed + k, { paint: 'stone', blocky: true, name: 'fallen stone' });
      else lump(x, 0.25, z, 0.45 + hash(k, seed, 7) * 0.45, 0.36, 0.36 + hash(k, seed, 8) * 0.3, 400 + seed + k, { paint: 'stone', blocky: true, sits: [x, z], name: 'fallen stone', body: 'none' });
    }
  }
  // one leaf of the gate hangs open against the passage's wall inside: what stops a body there (the leaf itself is the door's own model: see `castleDoor`)
  {
    // (half open: from its hinge on the south side of the passage it stands in toward the terrace, and the way past it is a pace and a half wide)
    const swing = DOOR.swing, hz = (C.gate.z0 + C.gate.z1) / 2 + 0.987 * DOOR.scale, cx = DOOR.x - Math.sin(swing) * DOOR.leaf * 0.48, cz = hz - Math.cos(swing) * DOOR.leaf * 0.48;
    box('timber', cx - DOOR.leaf * 0.48, cx + DOOR.leaf * 0.48, 0, 3, cz - 0.07, cz + 0.07, { name: 'gate leaf', hidden: true, yaw: swing - Math.PI / 2 });
  }

  // ---- the four towers. Each has a door to the terrace, a stair round the inside of its wall to a platform under
  // its rim, a window along each of the two walls it guards and one out over the ridge.
  parts.push(tower('north-east tower', C.hx, -C.hz, -17, 6.6, 135, 300, [22.5, 67.5, 202.5], 11));
  // (the south-east tower is a stump: it came down toward the field, on a slant, to a man's waist on that side and
  // not five metres on the other. A third shorter than its neighbours from anywhere; its stair goes up behind what
  // is left of its wall in plain sight, to a perch where its platform was.)
  parts.push(tower('south-east tower', C.hx, C.hz, -20, 6.3, 225, -300, [337.5, 292.5, 157.5], 12, undefined, { toward: 52, low: 1, high: 5.7 }));
  // (the south-west tower has lost its side to the field: its stair and what is left of its platform stand open to
  // the west, and whoever is on them is seen, and shot at, from the ridge)
  parts.push(tower('south-west tower', -C.hx, C.hz, -20, 7.2, 315, 300, [22.5, 172.5, 247.5], 13, [138, 236]));
  // (the north-west tower's boards have a hole in them, over a round cellar in its foot: a drop into the lower levels)
  parts.push({ ...tower('north-west tower', -C.hx, -C.hz, -17, 6.9, 45, -300, [337.5, 187.5, 112.5], 14), hollow: UNDER.floor });

  // ---- the keep. Its walls are over two metres thick: a shell of dressed stone outside, and the mass of the wall
  // behind it, with a deep recess at each window (a man stands in the recess to shoot from it).
  const sk = K.skin, [, F1, F2] = K.floors, split = 5.3;
  /** the shell of one face: `top` is what is left of the storey over the roof, a height for each of its equal lengths */
  const face = (name: string, a: [number, number], b: [number, number], top: number[], openings: Opening[]) => {
    parts.push({ t: 'wall', paint: 'ashlar', at: 'both', name, a, b, y0: 0, top: split, thick: sk, openings: openings.filter((o) => o.y1 <= split) });
    parts.push({ t: 'wall', paint: 'stone', at: 'both', name, a, b, y0: split, top, thick: sk, openings: openings.filter((o) => o.y0 >= split) });
  };
  const B = K.band;
  // (the north face: tall over the western two thirds of it, and broken low toward the entrance side)
  face('keep north face', [K.x0, K.z0 + sk / 2], [K.x1, K.z0 + sk / 2], [14.4, 14.1, 13.4, 12.2, 12.9, 11.3, 10.4, B + 0.5, B + 0.2, B + 0.35, B + 0.15, B + 0.3, B + 0.1], [{ u0: 5.2, u1: 6, y0: 3.9, y1: 5.2, arch: true }, { u0: 2.1, u1: 2.75, y0: 10.5, y1: 11.3, arch: true, round: true }]);
  // (the entrance face: the small door, the doorway over it, and the two arched windows of the storey that is gone)
  face('keep east face', [K.x1 - sk / 2, K.z0 + sk], [K.x1 - sk / 2, K.z1 - sk], [B + 0.3, 10.6, 12.4, 12.0, 10.8, B + 0.4, B + 0.2, 9.9, 8.6, 7.4, 6.7], [
    { u0: 4.4, u1: 5.4, y0: 0, y1: 1.9 }, { u0: 4.4, u1: 5.4, y0: F1, y1: 5.2, arch: true },
    { u0: 2.25, u1: 3.15, y0: B + 0.85, y1: B + 2.0, arch: true }, { u0: 6.65, u1: 7.55, y0: B + 0.85, y1: B + 2.0, arch: true },
  ]);
  // (the south face: low on the entrance side, with a way through it where the scaffold comes up, and tall to the west)
  face('keep south face', [K.x1, K.z1 - sk / 2], [K.x0, K.z1 - sk / 2], [6.6, 6.9, 7.7, 8.8, 10.4, 10.6, B, B, 11.4, 12.6, 13.4, 12.9, 13.6], [{ u0: 2.7, u1: 3.5, y0: 6.75, y1: 8.05, arch: true }, { u0: 9.0, u1: 9.7, y0: 10.2, y1: 11.0, arch: true, round: true }]);
  // (the west face: the tallest of what is left)
  face('keep west face', [K.x0 + sk / 2, K.z1 - sk], [K.x0 + sk / 2, K.z0 + sk], [13.3, 12.1, 13.4, 13.8, 11.6, 10.4, 12.9, 13.7, 14.2, 12.8, 14.3], [
    { u0: 1.6, u1: 2.3, y0: 10.9, y1: 11.8, arch: true, round: true },
    { u0: 6.8, u1: 7.6, y0: 3.9, y1: 5.2, arch: true }, { u0: 4.1, u1: 4.9, y0: 6.75, y1: 8.05, arch: true },
  ]);
  /** the mass of a wall behind its shell, from the terrace to the wall's top, less what is cut out of it: [from, to along it, from, to up it] */
  const mass = (name: string, lo: number, hi: number, put: (u0: number, u1: number, y0: number, y1: number) => void, holes: [number, number, number, number][]) => {
    const us = [...new Set([lo, hi, ...holes.flatMap((h) => [h[0], h[1]])])].sort((p, q) => p - q);
    for (let i = 0; i + 1 < us.length; i++) {
      const mid = (us[i] + us[i + 1]) / 2;
      const gone = holes.filter((h) => mid > h[0] && mid < h[1]).map((h): [number, number] => [h[2], h[3]]);
      for (const [y0, y1] of spans(0, B, gone)) put(us[i], us[i + 1], y0, y1);
    }
    void name;
  };
  const inner = { tone: 0.8 };
  mass('north', K.x0 + sk, K.x1 - sk, (u0, u1, y0, y1) => box('stone', u0, u1, y0, y1, K.z0 + sk, R.z0, { ...inner, name: 'keep north wall' }), [[-1.4, 0.4, F1, 5.3]]);
  mass('south', K.x0 + sk, K.x1 - sk, (u0, u1, y0, y1) => box('stone', u0, u1, y0, y1, R.z1, K.z1 - sk, { ...inner, name: 'keep south wall' }), [[1.4, 2.8, F2, 8.05], [K.fallen.x0 + 0.3, K.x1 - sk, 6.6, B]]);
  mass('east', R.z0, R.z1, (u0, u1, y0, y1) => box('stone', R.x1, K.x1 - sk, y0, y1, u0, u1, { ...inner, name: 'keep east wall' }), [[-0.5, 0.5, 0, 1.9], [-0.5, 0.5, F1, 5.2], [K.fallen.z0 + 0.3, R.z1, 6.6, B]]);
  mass('west', R.z0, R.z1, (u0, u1, y0, y1) => box('stone', K.x0 + sk, R.x0, y0, y1, u0, u1, { ...inner, name: 'keep west wall' }), [[-3.2, -1.4, F1, 5.3], [-0.5, 1.3, F2, 8.05]]);

  /** a floor across the room with a hole in it over a stair: its top at `y` */
  const floor = (paint: Paint, y: number, thick: number, hole: [number, number, number, number], name: string) => {
    const [hx0, hx1, hz0, hz1] = hole;
    for (const [x0, x1, z0, z1] of [[R.x0, R.x1, R.z0, hz0], [R.x0, R.x1, hz1, R.z1], [R.x0, hx0, hz0, hz1], [hx1, R.x1, hz0, hz1]]) if (x1 - x0 > 0.01 && z1 - z0 > 0.01) box(paint, x0, x1, y - thick, y, z0, z1, { name });
  };
  // the ground floor is the terrace's own paving. The first floor: the hall, come into by the doorway on the east.
  // (A floor is open over a stair from where a head would meet it: from where the stair is two metres under the
  // floor's own underside. Reckoned, and not judged by eye: a hole a pace too short is a stair nobody gets up.)
  const opens = (L: number, up: number, under: number) => Math.max(0, ((under - 2) * L) / up - L / Math.round(up / 0.2));
  const hall = 2.3 - opens(3.75, F1, F1 - 0.2), upper = -2.2 + opens(3.6, F2 - F1, F2 - F1 - 0.2), hatch = -1.7 + opens(3.6, K.roof - F2, K.roof - F2 - 0.35);
  floor('timber', F1, 0.2, [R.x0, R.x0 + 1, -1.45, hall], 'keep first floor');
  floor('timber', F2, 0.2, [upper, 1.4, R.z1 - 1, R.z1], 'keep second floor');
  // (the roof: all of it but the hatch over its stair, and the south-east corner, which came down with the corner of
  // the keep over it: the walls there stand a knee over the upper room's floor, and the room is open to the sky and the south)
  const gone = K.fallen;
  for (const [x0, x1, z0, z1] of [[R.x0, hatch, R.z0, R.z0 + 1], [1.9, R.x1, R.z0, R.z0 + 1], [R.x0, R.x1, R.z0 + 1, gone.z0], [R.x0, gone.x0, gone.z0, R.z1]]) box('paving', x0, x1, K.roof - 0.35, K.roof, z0, z1, { name: 'keep roof' });
  // the timbers each floor lies on, from wall to wall, clear of the well of its stair; and the roof's slab on its own
  for (let x = R.x0 + 1.25; x < R.x1 - 0.3; x += 1.05) beam([x, F1 - 0.31, R.z0], [x, F1 - 0.31, R.z1], 0.16, 0.22, { name: 'joist', tone: 0.85 });
  for (const z of [-2.9, -1.85, -0.8, 0.25, 1.3, 2.3]) beam([R.x0, F2 - 0.31, z], [R.x1, F2 - 0.31, z], 0.16, 0.22, { name: 'joist', tone: 0.85 });
  for (const z of [-2.25, -1.2, -0.15, 0.9]) beam([R.x0, K.roof - 0.46, z], [R.x1, K.roof - 0.46, z], 0.18, 0.22, { name: 'joist', tone: 0.85 });
  // (the two that bore the corner are broken off short of it, and stick out over the hole; what came down lies in the upper room)
  beam([R.x0, K.roof - 0.46, 1.95], [R.x1, K.roof - 0.46, 1.95], 0.18, 0.22, { name: 'joist', tone: 0.85 });
  beam([R.x0, K.roof - 0.46, 3], [gone.x0 + 0.9, K.roof - 0.55, 3], 0.18, 0.22, { name: 'joist', tone: 0.8 });
  beam([gone.x0 + 0.2, F2 + 0.12, 2.15], [R.x1 - 0.2, F2 + 1.5, 3.3], 0.18, 0.22, { name: 'fallen joist', tone: 0.75 });
  for (let k = 0; k < 7; k++) lump(gone.x0 + 0.3 + hash(k, 1, 301) * 1.05, F2 + 0.09, gone.z0 - 0.9 + hash(k, 2, 301) * 0.8, 0.24 + hash(k, 3, 301) * 0.18, 0.09, 0.2 + hash(k, 4, 301) * 0.12, 310 + k, { paint: 'stone', blocky: true, name: 'fallen roof' });
  // and what of that corner went outward lies in a heap at its foot, on the terrace: stone a man does not climb, and small stuff round it
  for (const [x, z, r, h] of [[5.75, 6.0, 0.5, 0.48], [6.35, 5.35, 0.42, 0.4], [5.6, 6.75, 0.38, 0.38], [5.9, 6.05, 0.36, 0.86]]) lump(x, h, z, r, h, r * 0.85, Math.round(x * 91 + z * 7), { paint: 'stone', blocky: true, name: 'fallen corner' });
  for (let k = 0; k < 6; k++) lump(5.45 + hash(k, 1, 305) * 1.1, 0.1, 5.75 + hash(k, 2, 305) * 1.1, 0.22 + hash(k, 3, 305) * 0.16, 0.1, 0.18 + hash(k, 4, 305) * 0.12, 330 + k, { paint: 'stone', blocky: true, name: 'fallen stone' });
  // the three flights, one to a storey, each along a different wall: nobody on one floor has the next stair at his back
  flight([R.x0 + 0.5, 0, 2.3], [R.x0 + 0.5, F1, -1.45], 1, { name: 'keep stair to the hall' });
  flight([-2.2, F1, R.z1 - 0.5], [1.4, F2, R.z1 - 0.5], 1, { name: 'keep stair to the upper room' });
  flight([-1.7, F2, R.z0 + 0.5], [1.9, K.roof, R.z0 + 0.5], 1, { name: 'keep stair to the roof' });
  // a rail round each hole, on the floor it is a hole in, as far along it as the stair's own rail has not yet come up
  // through the floor; and one up the open side of each flight
  rail([R.x0 + 1, F1, -0.3], [R.x0 + 1, F1, hall]);
  rail([R.x0 + 1, F1, hall], [R.x0, F1, hall]);
  rail([upper, F2, R.z1 - 1], [0.5, F2, R.z1 - 1]);
  rail([upper, F2, R.z1 - 1], [upper, F2, R.z1]);
  rail([hatch, K.roof, R.z0 + 1], [1, K.roof, R.z0 + 1]);
  rail([hatch, K.roof, R.z0 + 1], [hatch, K.roof, R.z0]);
  rail([R.x0 + 1, 0, 2.3], [R.x0 + 1, F1, -1.45]);
  rail([-2.2, F1, R.z1 - 1], [1.4, F2, R.z1 - 1]);
  rail([-1.7, F2, R.z0 + 1], [1.9, K.roof, R.z0 + 1]);
  // the roof: the slab between the walls, and the walls' own tops a pace higher all round it, with stone steps up to them
  flight([1.6, K.roof, 0.6], [R.x1, B, 0.6], 1.3, { paint: 'stone', name: 'roof steps east' });
  flight([-0.5, K.roof, 2.2], [-0.5, B, R.z1], 1.3, { paint: 'stone', name: 'roof steps south' });

  // the timber stair to the doorway, along the entrance face, and its landing over the small door
  const lx = K.x1;
  flight([lx + 0.52, 0, -4.9], [lx + 0.52, F1, -1.15], 0.95, { name: 'stair to the doorway' });
  box('timber', lx, lx + 1.55, F1 - 0.15, F1, -1.15, 1.25, { name: 'doorway landing' });
  rail([lx + 1, 0, -4.9], [lx + 1, F1, -1.15]);
  rail([lx + 1, F1, -1.15], [lx + 1.55, F1, -1.15]);
  rail([lx + 1.55, F1, -1.15], [lx + 1.55, F1, 1.25]);
  rail([lx + 1.55, F1, 1.25], [lx, F1, 1.25]);
  for (const z of [-1.07, 1.17]) beam([lx + 1.47, 0, z], [lx + 1.47, F1 - 0.15, z], 0.14, 0.14, { name: 'landing post', body: 'all' });
  beam([lx + 1.47, F1 - 0.24, -1.15], [lx + 1.47, F1 - 0.24, 1.25], 0.12, 0.18);

  // ---- the scaffold up the south face to the roof: three flights and three landings, and whoever climbs it is in plain sight
  const sx0 = -5.8, sx1 = -1.8, zi = K.z1 + 0.5, zo = K.z1 + 1.45, zs = K.z1 + 1.95, up = B / 3;
  flight([sx0, 0, zi], [sx1, up, zi], 0.9, { name: 'scaffold first flight' });
  flight([sx1, up, zo], [sx0, up * 2, zo], 0.9, { name: 'scaffold second flight' });
  flight([sx0, up * 2, zi], [sx1, B, zi], 0.9, { name: 'scaffold third flight' });
  box('timber', sx1, sx1 + 1, up - 0.12, up, K.z1, zs, { name: 'scaffold landing' });
  box('timber', sx0 - 1, sx0, up * 2 - 0.12, up * 2, K.z1, zs, { name: 'scaffold landing' });
  box('timber', sx1, sx1 + 1, B - 0.12, B, K.z1, zs, { name: 'scaffold head' });
  const mid = (zi + zo) / 2;
  rail([sx0, 0, mid], [sx1, up, mid]);
  rail([sx1, up, mid], [sx0, up * 2, mid]);
  rail([sx0, up * 2, mid], [sx1, B, mid]);
  rail([sx1, up, zs], [sx0, up * 2, zs]);
  for (const [x, y] of [[sx1 + 1, up], [sx0 - 1, up * 2], [sx1 + 1, B]] as [number, number][]) {
    rail([x, y, K.z1], [x, y, zs]);
    rail([x, y, zs], [x < -3 ? sx0 : sx1, y, zs]);
  }
  rail([sx1, B, mid], [sx1, B, zs]);
  for (const x of [sx0 - 0.93, -4.6, -3, sx1 + 0.93]) beam([x, 0, zs - 0.07], [x, B + 1, zs - 0.07], 0.13, 0.13, { name: 'scaffold post', body: 'all' });
  for (const x of [sx0 - 0.93, sx1 + 0.93]) beam([x, 0, K.z1 + 0.08], [x, B + 1, K.z1 + 0.08], 0.13, 0.13, { name: 'scaffold post' });
  for (const y of [up - 0.2, up * 2 - 0.2, B - 0.2]) beam([sx0 - 0.93, y, zs - 0.07], [sx1 + 0.93, y, zs - 0.07], 0.1, 0.16);
  beam([sx0 - 0.93, 0.2, zs - 0.07], [-4.6, up * 2 - 0.3, zs - 0.07], 0.08, 0.1);
  beam([sx1 + 0.93, 0.2, zs - 0.07], [-3, up * 2 - 0.3, zs - 0.07], 0.08, 0.1);

  // ---- the ramp: the one way in. A deck of boards on trestles from the rock to the gate, a rail each side.
  const gz0 = C.gate.z0 + 0.18, gz1 = C.gate.z1 - 0.18, run = Math.sqrt(C.ramp.len ** 2 - C.ramp.drop ** 2), rx = ex + run, ry = -C.ramp.drop;
  // ITS HEAD LIES ON THE EDGE OF THE WALL'S TOP, WHICH IS THE PASSAGE'S FLOOR. (2026-10-14, played: "gaps at the top of
  // the ramps ... where they dont meet flush with the next level". Its boards ran on under the gate at the terrace's
  // own height, 0.4 in from the wall's face; when the wall's top was left in the passage as its floor, that top lay
  // over them, and where it ended there was a lip a hand high across the head of the ramp, and a hand and more for a
  // foot. Now the boards end on the stone, where its level top ends, a finger over it.)
  const rh: V3 = [ex - 0.02, 0.008, 0];
  parts.push({ t: 'slab', paint: 'timber', at: 'both', name: 'ramp', p: [[rh[0], rh[1], gz0], [rx, ry, gz0], [rx, ry, gz1], [rh[0], rh[1], gz1]], thick: 0.12 });
  rail([ex, 0, gz0 + 0.05], [rx, ry, gz0 + 0.05], { name: 'ramp rail' });
  rail([ex, 0, gz1 - 0.05], [rx, ry, gz1 - 0.05], { name: 'ramp rail' });
  for (const s of [0.27, 0.52, 0.77]) {
    const x = ex + run * s, y = ry * s - 0.3;
    for (const z of [gz0 + 0.12, gz1 - 0.12]) beam([x, -10, z], [x, y, z], 0.2, 0.2, { name: 'ramp trestle', body: 'all', at: 'both' });
    beam([x, y - 0.1, gz0], [x, y - 0.1, gz1], 0.18, 0.2);
    beam([x, y - 0.5, gz0 + 0.12], [x, -4.6, gz1 - 0.12], 0.07, 0.14);
    beam([x, y - 0.5, gz1 - 0.12], [x, -4.6, gz0 + 0.12], 0.07, 0.14);
  }
  for (const z of [gz0 + 0.3, gz1 - 0.3]) beam([ex - 0.2, -0.24, z], [rx, ry - 0.24, z], 0.16, 0.22);

  // ---- the rock the ramp starts from, and the rocks on its top that whoever means to cross can wait behind
  const O = OUTCROP;
  parts.push({ t: 'mound', paint: 'rock', at: 'both', name: 'outcrop', kind: 'outcrop', x0: 15.5, x1: 32, z0: -9.5, z1: 4, cell: 0.5 });
  lump(20.2, O.top + 0.55, -4.1, 0.95, 0.85, 0.75, 31, { name: 'rock by the ramp head' });
  lump(19.3, O.top + 0.5, 1, 0.8, 0.8, 0.9, 32, { name: 'rock by the ramp head' });
  lump(23, O.top + 0.4, 0.7, 1.1, 0.7, 0.8, 33, { name: 'rock on the outcrop' });
  lump(22.6, O.top + 0.35, -4.3, 0.7, 0.6, 0.9, 34, { name: 'rock on the outcrop' });

  // ---- the rubble under the breach, and blocks of the wall that came down with it
  const F = FAN;
  parts.push({ t: 'mound', paint: 'scree', name: 'rubble', kind: 'fan', x0: F.end - 3, x1: F.foot + 4, z0: -22, z1: -10, cell: 0.5 });
  for (let k = 0; k < 9; k++) {
    const x = F.foot + 2 - k * 1.5 + hash(k, 3, 7) * 0.8, z = northFace(moundTop('fan', x, -12)) - F.wide - 0.9 - hash(k, 5, 7) * 2.2;
    lump(x, moundTop('fan', x, z) + 0.12, z, 0.3 + hash(k, 1, 7) * 0.3, 0.22 + hash(k, 2, 7) * 0.16, 0.3 + hash(k, 4, 7) * 0.25, 60 + k, { paint: 'stone', blocky: true, name: 'fallen block' });
  }

  // and two lengths of it that came down inside: something to kneel behind, either side of the way in
  lump(C.breach.x1 - 0.42, 0.36, -6.9, 0.6, 0.36, 0.4, 71, { paint: 'stone', blocky: true, name: 'fallen merlon' });
  lump(C.breach.x0 - 0.6, 0.33, -9.0, 0.55, 0.33, 0.42, 72, { paint: 'stone', blocky: true, name: 'fallen merlon' });

  // ---- what stands in the rooms, made of boards: tables, benches, a rack, bunks. (What is kept on each is in `castleLoot`.)
  // (A BODY'S, every one: each is the size it was in a fort a fifth smaller, at its place in this one. Said here in
  // metres of the world, as `FURNITURE` has them, and built `body(...)` of each.)
  for (const f of FURNITURE) {
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw), at = (lx: number, lz: number): [number, number] => [f.x + lx * c + lz * s, f.z - lx * s + lz * c], b = body, hw = b(f.w / 2), hd = b(f.d / 2);
    const slab = (y0: number, y1: number) => box('timber', f.x - hw, f.x + hw, f.y + b(y0), f.y + b(y1), f.z - hd, f.z + hd, { yaw: f.yaw, name: f.kind, body: y1 - y0 > 0.2 ? 'none' : 'all' });
    const leg = (lx: number, lz: number, h: number) => {
      const [px, pz] = at(b(lx), b(lz));
      beam([px, f.y, pz], [px, f.y + b(h), pz], b(0.07), b(0.07), { name: f.kind });
    };
    const whole = (h: number) => box('timber', f.x - hw, f.x + hw, f.y, f.y + b(h), f.z - hd, f.z + hd, { yaw: f.yaw, hidden: true, name: f.kind });
    if (f.kind === 'table') {
      slab(0.74, 0.8);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(sx * (f.w / 2 - 0.1), sz * (f.d / 2 - 0.1), 0.74);
      whole(0.8);
    } else if (f.kind === 'bench') {
      slab(0.4, 0.45);
      for (const sx of [-1, 1]) leg(sx * (f.w / 2 - 0.12), 0, 0.4);
      whole(0.45);
    } else if (f.kind === 'bunk') {
      for (const y of [0.4, 1.3]) slab(y, y + 0.06);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(sx * (f.w / 2 - 0.05), sz * (f.d / 2 - 0.05), 1.75);
      whole(1.36);
    } else {
      // a rack: two uprights and three shelves between them, a board at its back
      for (const y of [0.35, 0.95, 1.55]) slab(y, y + 0.045);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(sx * (f.w / 2 - 0.04), sz * (f.d / 2 - 0.04), 1.9);
      whole(1.9);
    }
  }

  // ---- a basket of iron for a fire at each place a light is kept, on a post or on a bracket from the wall
  // (six bars between a hoop at its lip and a smaller one at its foot, and a plate under the fire; on three legs
  // where it stands on a floor, and on a chain where it hangs. The fire in it is the game's own: see CastleSite.)
  for (const [x, z, y, post] of LAMPS) parts.push(...cresset(x, z, y, post, y < -0.5));

  return parts;
}

/**
 * A basket of iron for a fire: six bars between a hoop at its lip and a smaller one at its foot, and a plate under
 * the fire; on three legs where it stands on a floor (`post`: how long), and on a chain where it hangs. The fire
 * in it is the game's own: see CastleSite.
 */
function cresset(x: number, z: number, y: number, post: number, low = false): Part[] {
  const out: Part[] = [], lip = y - 0.04, foot = y - 0.32, at = (k: number, r: number, h: number): V3 => [x + Math.cos((k * Math.PI) / 3) * r, h, z + Math.sin((k * Math.PI) / 3) * r];
  const bar = (a: V3, b: V3, w: number, h: number) => void out.push({ t: 'beam', paint: 'iron', a, b, w, h, body: 'none', name: 'cresset', low });
  for (let k = 0; k < 6; k++) {
    bar(at(k, 0.1, foot), at(k, 0.17, lip), 0.022, 0.022);
    bar(at(k, 0.17, lip), at(k + 1, 0.17, lip), 0.022, 0.03);
    bar(at(k, 0.1, foot), at(k + 1, 0.1, foot), 0.02, 0.025);
  }
  out.push({ t: 'box', paint: 'iron', x0: x - 0.09, x1: x + 0.09, y0: foot - 0.015, y1: foot, z0: z - 0.09, z1: z + 0.09, name: 'cresset', body: 'none', low });
  if (post) {
    for (const k of [0.5, 2.5, 4.5]) bar(at(k, 0.34, y - post), at(k, 0.07, foot), 0.035, 0.035);
    out.push({ t: 'box', paint: 'iron', x0: x - 0.07, x1: x + 0.07, y0: y - post, y1: foot, z0: z - 0.07, z1: z + 0.07, hidden: true, name: 'cresset', low });
  } else bar([x, lip, z], [x, lip + 0.55, z], 0.015, 0.015);
  return out;
}

// ------------------------------------------------------------------ what stands in it

/** what is made of boards for the rooms: where its middle is on the floor (in the fort's own measure), which way it is turned, and its size (`w`, `d`: in metres of the world: it is a body's, and no bigger for the fort's being bigger) */
export const FURNITURE: { kind: 'table' | 'bench' | 'bunk' | 'rack'; x: number; z: number; y: number; yaw: number; w: number; d: number; /** a rack that always has a gun on it */ arms?: boolean; /** it is the aid post's: what lies on it is a dressing station's */ medic?: boolean }[] = [
  // the hall: a long table and its benches, a rack by the door
  { kind: 'table', x: 0.3, z: -0.4, y: 3, yaw: 0, w: 2.4, d: 0.9 },
  { kind: 'bench', x: 0.3, z: -1.25, y: 3, yaw: 0, w: 2.2, d: 0.32 },
  { kind: 'bench', x: 0.3, z: 0.45, y: 3, yaw: 0, w: 2.2, d: 0.32 },
  { kind: 'rack', x: 2.52, z: 2.2, y: 3, yaw: Math.PI / 2, w: 1.5, d: 0.45 },
  // the upper room: where they slept, and where the guns were kept
  { kind: 'bunk', x: -3.2, z: -1.6, y: 5.85, yaw: Math.PI / 2, w: 1.95, d: 0.9 },
  { kind: 'rack', x: 2.52, z: -0.6, y: 5.85, yaw: Math.PI / 2, w: 1.7, d: 0.45 },
  { kind: 'table', x: 0.4, z: 0.3, y: 5.85, yaw: Math.PI / 2, w: 1.6, d: 0.8 },
  // the armoury: racks of arms along three of its walls (each always has a gun on it), and a table of rounds
  // (deeper than a store's racks, by a hand: a rifle with a sight on it lies on its side along the shelf, and on a
  // shelf of 0.45 its butt hung over the front edge. Their backs are where they were, a hand from the wall.)
  { kind: 'rack', x: -3.36, z: 0.35, y: UNDER.floor, yaw: Math.PI / 2, w: 1.7, d: 0.57, arms: true },
  { kind: 'rack', x: -3.36, z: 2.4, y: UNDER.floor, yaw: Math.PI / 2, w: 1.7, d: 0.57, arms: true },
  { kind: 'rack', x: -1.6, z: -1.86, y: UNDER.floor, yaw: 0, w: 1.7, d: 0.57, arms: true },
  { kind: 'rack', x: 0.9, z: -1.86, y: UNDER.floor, yaw: 0, w: 1.7, d: 0.57, arms: true },
  { kind: 'rack', x: 2.86, z: 1.6, y: UNDER.floor, yaw: Math.PI / 2, w: 1.7, d: 0.57, arms: true },
  { kind: 'table', x: 1.4, z: -0.4, y: UNDER.floor, yaw: 0, w: 1.4, d: 0.8 },
  // the aid post: a dressing table in the ward, and one in the dispensary at the west end by the cabinet
  { kind: 'table', x: 7.75, z: 6.45, y: UNDER.floor, yaw: Math.PI / 2, w: 1.2, d: 0.7, medic: true },
  { kind: 'table', x: -6.6, z: 7.9, y: UNDER.floor, yaw: 0, w: 1.6, d: 0.7, medic: true },
  // the store under the hall
  { kind: 'rack', x: 2.52, z: -1.3, y: 0, yaw: Math.PI / 2, w: 1.5, d: 0.45 },
  { kind: 'table', x: 0.6, z: 2.75, y: 0, yaw: 0, w: 1.8, d: 0.8 },
  // on the terrace by the fire, and in the lee of the keep
  { kind: 'bench', x: 3.2, z: -5.75, y: 0, yaw: 0, w: 2, d: 0.34 },
  { kind: 'table', x: -7.1, z: -3.6, y: 0, yaw: Math.PI / 2, w: 1.8, d: 0.8 },
];

/** where a light is kept: [x, z, how high the fire of it is, how long a post it stands on (0: it hangs from a wall or a beam)] */
export const LAMPS: [number, number, number, number][] = [
  // inside the gate, on the pier
  [CASTLE.hx - 0.75, CASTLE.gate.z0 - 0.3, 2.5, 0],
  // on the corner of the landing before the doorway
  [CASTLE.keep.x1 + 1.47, 1.17, 4.55, 0],
  // the hall, and the store under it
  [-0.4, 0.3, 5.3, 0],
  [-0.6, -3.1, 2.3, 0],
  // by the fire on the north side of the terrace, and in the nook between the west wall and the south-west tower
  [5.6, -8.2, 2.3, 2.3],
  [-9.1, 7, 2.3, 2.3],
  // under the terrace, where the garrison was: in the armoury; outside its grille and in the ward of the aid post;
  // at the door of the stair from the store, on the cistern; at the foot of the stair down to the sally port. Dark between.
  [0, 2.1, UNDER.floor + 2.25, 0],
  [-2.9, 6.02, UNDER.floor + 2.25, 0],
  [5.5, 6.3, UNDER.floor + 2.25, 0],
  [3.95, -5.2, UNDER.floor + 2.2, 0],
  [(UNDER.postern.x0 + UNDER.postern.x1) / 2, UNDER.postern.foot + 0.75, UNDER.postern.deep + 2.05, 0],
];
/** where the lamps along a hatch's passage hang: at each of its bends, a head over its floor ([x, z, how high the fire is]) */
const passageLamps = (L: ReturnType<typeof hatchLine>): V3[] => (L.path.length > 3 ? L.path.slice(2, -1).map((q): V3 => [q[0], q[2], q[1] + 1.85]) : []);

// ------------------------------------------------------------------ the loose pieces of its grounds
//
// Round the real fort: the roofless shells of a village along the crest, a curved wall by the rock the ramp leaves
// from, a thin wall down the south slope, grey teeth of rock. None of them is part of the fort. Each is a thing by
// itself that stands on whatever ground it is put on (its foot goes three metres into it, so it meets ground that
// is not level), and whoever shapes the mountain sets each down where that ground suits: `LOOSE` is only where
// they stand when nobody has said, on the ground the fort assumes.

/**
 * A loose piece: which kind, which of its kind, where its middle is and how it is turned. (In the fort's own
 * measure here; `castleLoose` gives the same as places in the world, which is how the world's own list has them.)
 */
export interface Loose { kind: 'house' | 'curved wall' | 'long wall' | 'rock' | 'hatch'; n: number; x: number; z: number; rot: number }
/** the houses there are to choose from: how long, how deep, and which long side the door was on */
export const HOUSES: { w: number; d: number; door: number }[] = [{ w: 9, d: 7, door: -1 }, { w: 8.4, d: 6.6, door: 1 }, { w: 9.2, d: 7, door: -1 }, { w: 9, d: 7.2, door: 1 }, { w: 8.6, d: 6.8, door: -1 }];
/** how far into the ground a loose piece's foot goes */
const FOOTING = 3;

export const LOOSE: Loose[] = [
  // what is left of the village, along the crest to the east
  { kind: 'house', n: 0, x: 47, z: 2.5, rot: 0.14 }, { kind: 'house', n: 1, x: 60, z: -6.6, rot: -0.2 }, { kind: 'house', n: 2, x: 69, z: 3, rot: 0.1 }, { kind: 'house', n: 3, x: 80, z: -5, rot: -0.08 }, { kind: 'house', n: 4, x: 91, z: 2.5, rot: 0.22 },
  // the curved wall by the rock: what held the path up, on the side the ground falls away; and the thin wall down the south slope
  { kind: 'curved wall', n: 0, x: 20.5, z: -2, rot: 0 },
  { kind: 'long wall', n: 0, x: 22.6, z: 23.4, rot: 0 },
  // the storm-cellar hatch the sally port comes up at: in the old village, close behind the gable of its first
  // house from the fort, where nobody on the keep's roof, its wall top or a tower sees who goes down it. Its steps
  // go down northward, along the gable (the way it is turned: not turned, they go down toward the fort); the
  // passage is made from their foot to the fort, wherever it is set.
  // (a pace and a half from the first house's gable: at three quarters of a metre a body had no room to spare between that wall and the hatch's kerb)
  { kind: 'hatch', n: 0, x: 54, z: 1.6, rot: Math.PI },
  // grey teeth of rock, clear of the ways people go
  ...([[27.5, -6.2], [30.5, 3.2], [34, -7.5], [37.5, 2.6], [40.5, -6.8], [44, -9.5], [52.5, 7.5], [63.5, -1.5], [74.5, 8.2], [85.5, 0.5], [97, -4], [16.5, -13.5], [15.8, 9.5], [-15.5, -12.5], [-16.5, 6.5], [-20, -4], [-24.5, -9], [-27, 2.5], [-32, -6.5], [-36.5, -1]] as [number, number][]).map(([x, z], n): Loose => ({ kind: 'rock', n, x, z, rot: n * 1.7 })),
];

/** The pieces a loose piece is made of, where it stands (in the fort's own measure: each of them on the ground at its own spot). */
/**
 * The hatch and the passage to it, as plain figures: where its steps begin (at the ground) and end, the line the
 * passage takes from their foot to its end under the fort, and how long and how steep that is. `g`: the ground
 * at the hatch, over the terrace.
 */
export function hatchLine(l: { x: number; z: number; rot?: number }, g: number) {
  const H = UNDER.hatch, end: V3 = [POSTERN.x, POSTERN.y, POSTERN.z], far = Math.hypot(POSTERN.x - l.x, POSTERN.z - l.z);
  const u: [number, number] = [(POSTERN.x - l.x) / far, (POSTERN.z - l.z) / far], side: [number, number] = [u[1], -u[0]];
  // (a passage of any length bends twice: to one side before the hatch and to the other as it leaves the fort, so
  // that nobody sees, or shoots, along the whole of it. A short one runs straight.)
  const bends: [number, number][] = far < 18 ? [] : [[l.x + u[0] * Math.min(20, far * 0.45) - side[0] * 3.4, l.z + u[1] * Math.min(20, far * 0.45) - side[1] * 3.4], [POSTERN.x - u[0] * 7.6 + side[0] * 1.5, POSTERN.z - u[1] * 7.6 + side[1] * 1.5]];
  // (its steps go down the way it is turned, as a wall runs the way it is turned; not turned, toward the fort)
  const toward = bends[0] ?? [POSTERN.x, POSTERN.z], dl = Math.hypot(toward[0] - l.x, toward[1] - l.z), d: [number, number] = l.rot ? [Math.sin(l.rot), Math.cos(l.rot)] : [(toward[0] - l.x) / dl, (toward[1] - l.z) / dl];
  const head: V3 = [l.x - d[0] * 0.3, g, l.z - d[1] * 0.3], foot: V3 = [l.x + d[0] * (H.run - 0.3), g - H.drop, l.z + d[1] * (H.run - 0.3)];
  // (level for a pace at the foot of the steps: whoever comes off them is on a floor before it begins to climb)
  const LEVEL = 1.2, flat: [number, number][] = [[foot[0], foot[2]], [foot[0] + d[0] * LEVEL, foot[2] + d[1] * LEVEL], ...bends, [end[0], end[2]]], at = [0];
  for (let k = 1; k < flat.length; k++) at.push(at[k - 1] + Math.hypot(flat[k][0] - flat[k - 1][0], flat[k][1] - flat[k - 1][1]));
  const long = at[at.length - 1];
  return {
    /** the way its steps go down, and the way across them */
    d, r: [d[1], -d[0]] as [number, number],
    /** the head of its steps, at the ground; their foot; and the passage's end under the fort */
    head, foot, end,
    /** the middle line of the passage's floor, from the foot of the steps to its end: it falls or climbs evenly along its length */
    path: flat.map(([x, z], k): V3 => [x, foot[1] + ((end[1] - foot[1]) * Math.max(0, at[k] - LEVEL)) / (long - LEVEL), z]),
    /** how long the passage is, and how steep (rise over run, up toward the fort) */
    long, steep: (end[1] - foot[1]) / Math.max(1, long),
  };
}

/** The slot of the stair down to the sally port, on the plan: where the ground under the fort is taken away for it. */
const shaftWell = (): [number, number][] => {
  const PS = UNDER.postern;
  return [[PS.x0 - 0.5, PS.head - 0.3], [PS.x1 + 0.6, PS.head - 0.3], [PS.x1 + 0.6, PS.end + 0.6], [PS.x0 - 0.5, PS.end + 0.6]];
};
/** The stairwell of a hatch on the plan: its four corners [x, z], in order round it (the hole in the ground, kerb and all). */
export function hatchWell(l: { x: number; z: number; rot?: number }, g: number): [number, number][] {
  const H = UNDER.hatch, L = hatchLine(l, g), w = H.wide / 2 + 0.3;
  const at = (along: number, across: number): [number, number] => [L.head[0] + L.d[0] * along + L.r[0] * across, L.head[2] + L.d[1] * along + L.r[1] * across];
  return [at(-0.02, -w), at(H.run + 0.65, -w), at(H.run + 0.65, w), at(-0.02, w)];
}

/**
 * Every piece of the plan that a hatch's way is under the ground in, and how deep the ground must be taken there
 * (see `castleCuts`): its stairwell, and a strip along each straight length of its passage. In the fort's own measure.
 */
export function hatchWells(l: { x: number; z: number; rot?: number }, g: number): { well: [number, number][]; to: number }[] {
  const H = UNDER.hatch, L = hatchLine(l, g), out = [{ well: hatchWell(l, g), to: g - H.drop - 0.6 }];
  for (let k = 0; k + 1 < L.path.length; k++) {
    const a = L.path[k], b = L.path[k + 1], len = Math.hypot(b[0] - a[0], b[2] - a[2]), e = [(b[0] - a[0]) / len, (b[2] - a[2]) / len], w = H.wide / 2 + 0.85;
    const at = (p: V3, along: number, across: number): [number, number] => [p[0] + e[0] * along + e[1] * across, p[2] + e[1] * along - e[0] * across];
    out.push({ well: [at(a, -1.3, -w), at(b, 1.3, -w), at(b, 1.3, w), at(a, -1.3, w)], to: Math.min(a[1], b[1]) - 0.9 });
  }
  return out;
}

/**
 * @param g the ground where the piece stands, over the terrace (asked for the hatch, whose passage is made to its depth: the others stand on the ground piece by piece)
 * @param ground the ground at any spot, over the terrace (asked for the hatch, whose kerb stands on the ground all round its well): unsaid, level with `g`
 */
export function looseParts(l: Loose, g = castleGround(l.x, l.z), ground?: (x: number, z: number) => number): Part[] {
  const parts: Part[] = [], c = Math.cos(l.rot), s = Math.sin(l.rot);
  if (l.kind === 'hatch') {
    // A storm cellar's doorway: a low kerb of stone round a flight of steps into the ground, two leaves of boards
    // that sloped over it (one thrown back and lying, one fallen in on the steps: it stands open, and anybody may
    // go in or come out), and the passage from the foot of the steps to the stair under the fort's east wall.
    const H = UNDER.hatch, L = hatchLine(l, g), w = H.wide / 2, at = (p: V3, across: number, up = 0): V3 => [p[0] + L.r[0] * across, p[1] + up, p[2] + L.r[1] * across];
    const flat = (p: V3, across: number): [number, number] => [p[0] + L.r[0] * across, p[2] + L.r[1] * across];
    // (the stairwell is open to the sky as far as half a pace past the foot of the steps: whoever comes down them is on the level before his head is under stone)
    const back: V3 = [L.foot[0] + L.d[0] * 0.5, g, L.foot[2] + L.d[1] * 0.5];
    parts.push({ t: 'flight', paint: 'base', foot: L.foot, head: L.head, w: H.wide, body: 'feet', name: 'hatch steps' });
    // WHERE THE HILL FALLS AWAY FROM THE HEAD OF ITS STEPS, STEPS COME UP TO IT. The head is as high as the ground at
    // the hatch's own middle; set down on a hillside with its back to the rise (the world's is), the ground before the
    // head was a knee lower, and the top step stood out of the hill with nothing up to it (2026-10-14, played: "gaps
    // at the top of the ... stairs ... where they dont meet flush with the next level"). As many steps of its own
    // rise and going, outward and down, as bring their foot to the ground at its lowest across them.
    if (ground) {
      const n = Math.round(H.drop / 0.2), rise = H.drop / n, run = H.run / n;
      const out = (k: number): V3 => [L.head[0] - L.d[0] * k * run, g - k * rise, L.head[2] - L.d[1] * k * run];
      const low = (k: number) => Math.min(...[-w, 0, w].map((a) => ground(...flat(out(k), a))));
      let k = 0;
      if (low(1) < g - 0.1) for (k = 1; k < 9 && low(k) < g - k * rise - 0.02; k++);
      if (k > 0 && k < 9) parts.push({ t: 'flight', paint: 'base', foot: out(k), head: L.head, w: H.wide, body: 'feet', name: 'hatch stoop' });
    }
    // its two cheeks, a hand over the ground at the head of the steps and knee high at the back, and the wall across the back
    // (The cheeks run to the far face of the wall across the back, which stands between them; and the passage's own walls
    // and its roof begin there. Run past each other, a cheek and a wall of the passage were two faces in one plane at
    // the foot of the steps, and so were the back wall's ends and the cheeks outside: 2026-10-13, "the path underground
    // at the base of the stairs is bugged with panels and textures".)
    // (How far past the foot of the steps each cheek goes: to the far face of the back wall, 0.65; but on the inside of
    // the passage's first bend no further than that bend's corner, where the next length's wall takes over.)
    const reach = (side: number) => {
      if (L.path.length < 3) return 0.65;
      const p0 = L.path[0], p1 = L.path[1], p2 = L.path[2], l0 = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]), l1 = Math.hypot(p2[0] - p1[0], p2[2] - p1[2]);
      const e0 = [(p1[0] - p0[0]) / l0, (p1[2] - p0[2]) / l0], e1 = [(p2[0] - p1[0]) / l1, (p2[2] - p1[2]) / l1], turn = e0[0] * e1[1] - e0[1] * e1[0];
      const corner = l0 + (turn < 0 ? -side : side) * Math.tan(Math.acos(Math.min(1, Math.max(-1, e0[0] * e1[0] + e0[1] * e1[1]))) / 2) * w;
      return Math.max(0.2, Math.min(0.65, corner));
    };
    const far = (side: number): V3 => [L.foot[0] + L.d[0] * reach(side), g, L.foot[2] + L.d[1] * reach(side)];
    // (of the passage's own rough stone, all of it: two stuffs are each bent their own way, and where a cheek of one met a wall of the other edge to edge a gap opened between them, a finger wide here and a hand there)
    // THE KERB HOLDS THE HILL BACK ALL ROUND. A hatch may be set down on a hillside with its steps going down into
    // the rise (the world's is: the ground is two metres higher at the back of its well than at the head of its
    // steps). A kerb as high as the ground at the hatch's own middle then stood a metre and more under the ground
    // at the back, and between its top and the edge of the ground there was nothing: a dark slot round the well
    // (seen, 2026-10-13). So each length of each cheek, and the wall across the back, stands on the ground AS IT IS
    // WHERE THAT LENGTH IS: a foot over the highest of it at the head of the steps, knee high at the back.
    // (in ten lengths to a cheek, each half a pace: in five, on a hill, each stood near half a metre over the last)
    const gAt = (q: [number, number]) => (ground ? ground(q[0], q[1]) : g), RISE = [0.32, 0.32, 0.32, 0.32, 0.39, 0.46, 0.54, 0.62, 0.7, 0.78];
    for (const side of [-1, 1]) {
      const a = flat(side > 0 ? L.head : far(side), side * (w + 0.15)), b = flat(side > 0 ? far(side) : L.head, side * (w + 0.15)), up = side > 0 ? RISE : [...RISE].reverse();
      const top = up.map((t, k) => Math.max(...[0, 0.5, 1].map((f) => gAt([a[0] + ((b[0] - a[0]) * (k + f)) / up.length, a[1] + ((b[1] - a[1]) * (k + f)) / up.length]))) + t);
      parts.push({ t: 'wall', paint: 'base', tone: 0.92, name: 'hatch kerb', a, b, y0: g - H.drop - 0.3, top, thick: 0.3, stepped: true });
    }
    parts.push({ t: 'wall', paint: 'base', tone: 0.92, name: 'hatch kerb', a: flat(back, w), b: flat(back, -w), y0: g - H.drop + H.tall, top: Math.max(gAt(flat(back, w)), gAt(flat(back, 0)), gAt(flat(back, -w))) + 0.8, thick: 0.3, soffit: true });
    // the leaf that was thrown back, lying on the ground beside it (as the ground lies there); and the one that fell in, on the steps
    const mid: V3 = [(L.head[0] + L.foot[0]) / 2, g, (L.head[2] + L.foot[2]) / 2];
    const lie = (p: V3, across: number, up: number): V3 => [flat(p, across)[0], gAt(flat(p, across)) + up, flat(p, across)[1]];
    parts.push({ t: 'slab', paint: 'timber', tone: 0.8, body: 'none', name: 'hatch leaf', p: [lie(L.head, w + 0.45, 0.1), lie(back, w + 0.45, 0.16), lie(back, w + 1.15, 0.07), lie(L.head, w + 1.15, 0.05)], thick: 0.05 });
    parts.push({ t: 'slab', paint: 'timber', tone: 0.75, body: 'none', name: 'hatch leaf', p: [at(mid, -w + 0.05, -H.drop / 2 + 0.2), at(L.foot, -w + 0.08, 0.22), at(L.foot, -0.05, 0.4), at(mid, 0.02, -H.drop / 2 + 0.38)], thick: 0.05 });
    // the ground's own earth, laid over everything the world cuts for it (the stairwell, and a strip along the
    // passage: ground cannot be walked under where it has been walked through): it lies as the ground lay
    // (and what of the passage the earth must keep out of: each straight length of it out to the outer faces of its
    // walls and a hand more, as far past each end as its walls go round a bend, and up to the top of its roof)
    const ways = L.path.slice(0, -1).map((a0, k) => {
      const b0 = L.path[k + 1], len = Math.hypot(b0[0] - a0[0], b0[2] - a0[2]), e = [(b0[0] - a0[0]) / len, (b0[2] - a0[2]) / len], m = w + 0.3;
      const by = (q: V3, along: number, across: number): [number, number] => [q[0] + e[0] * along + e[1] * across, q[2] + e[1] * along - e[0] * across];
      return { well: [by(a0, -m, -m), by(b0, m, -m), by(b0, m, m), by(a0, -m, m)], top: Math.max(a0[1], b0[1]) + H.tall + 0.32 };
    });
    parts.push({ t: 'apron', paint: 'earth', name: 'hatch apron', wells: [shaftWell(), ...hatchWells(l, g).map((q) => q.well)], hole: hatchWell(l, g), reach: H.lid, ways });
    // the passage: a floor, a roof and two walls to each straight length of it, from the foot of the steps to the stair under the fort
    const o = { paint: 'base' as Paint, roofed: true, tone: 0.8 };
    for (const [x, z, y] of passageLamps(L)) parts.push(...cresset(x, z, y, 0).map((q) => ({ ...q, roofed: true })));
    const dirs = L.path.slice(0, -1).map((a0, k): [number, number] => {
      const b0 = L.path[k + 1], len = Math.hypot(b0[0] - a0[0], b0[2] - a0[2]);
      return [(b0[0] - a0[0]) / len, (b0[2] - a0[2]) / len];
    });
    /**
     * At the bend after length `k`: how far past the bend the wall on one side (`sgn`) is carried to meet its fellow
     * of the next length. On the outside of the bend that is on past it; on the inside it is short of it, by as much:
     * so the two lengths meet at a corner with no gap outside it and nothing standing in the way inside it.
     * (Measured to where the two walls' FACES ON THE PASSAGE meet. On the outside of a bend that is where their
     * middle lines meet, less a little, and each wall's end is in the other. On the inside the walls stand round a
     * corner of earth and the passage is on the outside of that corner: carried only to where their middle lines
     * meet, the two left a notch open between their ends, a hand wide, at every inside corner of the passage, and
     * through it the backs of both were seen. There each is carried to where their faces meet, which is further.)
     */
    const mitre = (k: number, sgn: number) => {
      if (k < 0 || k + 1 >= dirs.length) return 0;
      // (the side that is across at +1 is the inside of a bend that turns toward it, which is where `turn` is under nothing)
      const e0 = dirs[k], e1 = dirs[k + 1], turn = e0[0] * e1[1] - e0[1] * e1[0], out = turn < 0 ? -sgn : sgn;
      return out * Math.tan(Math.acos(Math.min(1, Math.max(-1, e0[0] * e1[0] + e0[1] * e1[1]))) / 2) * (out < 0 ? w : w + 0.125);
    };
    /** how far past a bend its floor and its roof go: as far as the wall on its outside */
    const past = (k: number) => Math.max(Math.abs(mitre(k, 1)), Math.abs(mitre(k, -1)));
    for (let k = 0; k + 1 < L.path.length; k++) {
      const a0 = L.path[k], b0 = L.path[k + 1], len = Math.hypot(b0[0] - a0[0], b0[2] - a0[2]), e = dirs[k], last = k + 2 === L.path.length;
      // (a place so far along it from one of its ends, on the line of its floor: which climbs)
      const on = (p: V3, by: number): V3 => [p[0] + e[0] * by, p[1] + (by * (b0[1] - a0[1])) / len, p[2] + e[1] * by];
      // (its floor and its roof reach as far past each bend as the outer wall does: the corner is floored and roofed. One length's lie a hair under the next's, so that where they overlap one of them is seen and not both at once.)
      const a = on(a0, k === 0 ? -0.2 : -past(k - 1)), b = on(b0, last ? 0.1 : past(k)), hair = (k % 2) * 0.004;
      const off = (p: V3, across: number, up = 0): V3 => [p[0] + e[1] * across, p[1] + up, p[2] - e[0] * across], plan = (p: V3, across: number): [number, number] => [p[0] + e[1] * across, p[2] - e[0] * across];
      parts.push({ t: 'slab', ...o, name: 'passage floor', p: [off(a, -w, -hair), off(b, -w, -hair), off(b, w, -hair), off(a, w, -hair)], thick: 0.3 });
      const m = k === 0 ? on(a0, 0.65) : a;
      parts.push({ t: 'slab', ...o, name: 'passage roof', p: [off(m, -w, H.tall + 0.3 + hair), off(b, -w, H.tall + 0.3 + hair), off(b, w, H.tall + 0.3 + hair), off(m, w, H.tall + 0.3 + hair)], thick: 0.3 });
      {
        // What is seen of its roof: a round one of the same rough stone from wall to wall, under the slabs; gone where
        // the slab came down. It keeps to the straight of each length: it stops short of the square of each bend,
        // which the flat slabs roof, and at each of its ends an arch of stone stands across the passage, the round's
        // own shape, closing what is between the round and the slabs. (Run on through the bends, two rounds crossed,
        // and each was seen from behind through the other; and at an end with no arch the hollow over the round was
        // looked into from the bend. Found by the check that looks every way from every pace of it.)
        const v0 = k === 0 ? 0.65 : past(k - 1) + w + 0.2, v1 = last ? len + 0.1 : len - past(k) - w - 0.2;
        if (v1 - v0 > 1.6) {
          const va = on(a0, v0), vb = on(a0, v1), down = len / 2 - v0;
          parts.push({ t: 'vault', ...o, tone: 0.72, name: 'passage vault', a: [va[0], va[2]], b: [vb[0], vb[2]], wide: 2 * w, spring: va[1] + H.tall - 0.62, crown: va[1] + H.tall - 0.01, lift: vb[1] - va[1], gone: L.path.length > 3 && k === 2 ? [[down - 1.25, down + 1.25]] : undefined });
          for (const p of last ? [va] : [va, vb]) parts.push({ t: 'wall', ...o, tone: 0.74, body: 'none', name: 'passage arch', a: plan(p, -w), b: plan(p, w), y0: p[1] - 0.05, top: p[1] + H.tall + 0.02, thick: 0.34, openings: [{ u0: 0, u1: 2 * w, y0: p[1] - 0.05, y1: p[1] + H.tall - 0.01, arch: true, rise: 0.61 }] });
        }
      }
      for (const sgn of [-1, 1]) {
        const from = on(a0, k === 0 ? reach(sgn) : -mitre(k - 1, sgn)), to = on(b0, last ? 0.1 : mitre(k, sgn));
        // (on the inside of the first bend the hatch's own cheek is the wall as far as the corner: there is none of the passage's to make)
        if ((to[0] - from[0]) * e[0] + (to[2] - from[2]) * e[1] < 0.05) continue;
        // (in pieces of three metres, each as high as its own roof and no higher: a length that climbs two metres had walls level with its upper end from end to end, and at its lower end they stood a metre out of the ground behind the hatch, where a walker was held by them)
        const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[2] - from[2]) / 3)), at = (t: number): V3 => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
        for (let i = 0; i < n; i++) {
          const p0 = at(i / n), p1 = at((i + 1) / n);
          parts.push({ t: 'wall', ...o, name: 'passage wall', a: plan(sgn > 0 ? p0 : p1, sgn * (w + 0.125)), b: plan(sgn > 0 ? p1 : p0, sgn * (w + 0.125)), y0: Math.min(p0[1], p1[1]) - 0.3, top: Math.max(p0[1], p1[1]) + H.tall + 0.3, thick: 0.25 });
        }
      }
      if (L.path.length > 3 && k === 2) {
        // half way along its middle length the roof has come down: a slab of it lies across the passage at a man's
        // chest, and whoever goes on goes on crouched
        // (it lies as the floor lies, which climbs: a hand of room over a crouched head at both its ends)
        const mid2: V3 = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2, (a0[2] + b0[2]) / 2], rise = ((b0[1] - a0[1]) / len) * 1.2, c0: V3 = [mid2[0] - e[0] * 1.2, mid2[1] - rise, mid2[2] - e[1] * 1.2], c1: V3 = [mid2[0] + e[0] * 1.2, mid2[1] + rise, mid2[2] + e[1] * 1.2];
        parts.push({ t: 'slab', ...o, tone: 0.7, name: 'fallen roof of the passage', p: [off(c0, -w, H.tall + 0.02), off(c1, -w, H.tall + 0.02), off(c1, w, H.tall + 0.02), off(c0, w, H.tall + 0.02)], thick: H.tall - 1.32 });
        for (const [by, across, r] of [[-1.5, -0.42, 0.24], [1.6, 0.44, 0.22], [-0.2, 0.5, 0.16]]) {
          const q = off(on(mid2, by), across);
          parts.push({ t: 'lump', paint: 'stone', x: q[0], y: q[1] + r * 0.5, z: q[2], rx: r, ry: r * 0.5, rz: r * 0.8, seed: Math.round(700 + by * 10), blocky: true, body: 'none', roofed: true, name: 'fallen stone' });
        }
      }
    }
    return parts;
  }
  const at = (lx: number, lz: number): [number, number] => [l.x + lx * c + lz * s, l.z - lx * s + lz * c];
  const wall = (a: [number, number], b: [number, number], top: number[], thick: number, name: string, openings?: Opening[]) => void parts.push({ t: 'wall', paint: 'stone', tone: 0.88, at: 'both', name, a, b, y0: -FOOTING, top, thick, openings, sits: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
  if (l.kind === 'house') {
    const k = l.n % HOUSES.length, sh = HOUSES[k], w = sh.w / 2, d = sh.d / 2, name = `ruined house ${k + 1}`;
    /** a long wall's broken top, and a gable's: up to five metres in the middle of it, and never whole */
    const long = (seed: number) => Array.from({ length: 9 }, (_, i) => Math.round((0.7 + hash(i, seed, 21 + k) * 2.3) * 10) / 10);
    const gable = (seed: number) => Array.from({ length: 7 }, (_, i) => Math.round(Math.max(0.6, (2.4 + (1 - Math.abs(i - 3) / 3.5) * 2.6) * (hash(i, seed, 23 + k) < 0.25 ? 0.45 : 0.82 + hash(i, seed, 24 + k) * 0.18)) * 10) / 10);
    // (the whole house stands at the height of the ground under its middle: its floor is level, as a house's is)
    const o = { t: 'wall' as const, paint: 'stone' as Paint, tone: 0.9, at: 'both' as const, name, thick: 0.6, y0: -FOOTING, sits: [l.x, l.z] as [number, number] };
    const door = { u0: sh.w * 0.4, u1: sh.w * 0.4 + 1.2, y0: -FOOTING - 0.1, y1: 9 };
    parts.push({ ...o, a: at(-w, -d + 0.3), b: at(w, -d + 0.3), top: long(1), openings: sh.door < 0 ? [door] : [{ u0: 2, u1: 2.9, y0: 0.9, y1: 2, arch: false }] });
    parts.push({ ...o, a: at(w, d - 0.3), b: at(-w, d - 0.3), top: long(2), openings: sh.door > 0 ? [door] : [{ u0: 5.6, u1: 6.5, y0: 0.9, y1: 2, arch: false }] });
    parts.push({ ...o, a: at(w - 0.3, -d + 0.6), b: at(w - 0.3, d - 0.6), top: gable(3) });
    parts.push({ ...o, a: at(-w + 0.3, d - 0.6), b: at(-w + 0.3, -d + 0.6), top: gable(4) });
    // (stones of it, lying inside)
    for (let i = 0; i < 3; i++) {
      const [px, pz] = at((hash(i, k, 31) - 0.5) * (sh.w - 3), (hash(i, k, 32) - 0.5) * (sh.d - 3));
      parts.push({ t: 'lump', paint: 'stone', x: px, y: 0.12, z: pz, rx: 0.28 + hash(i, k, 33) * 0.25, ry: 0.2, rz: 0.3, seed: 80 + k * 5 + i, blocky: true, sits: [px, pz], name: 'fallen block' });
    }
  } else if (l.kind === 'curved wall') {
    // four lengths of a round, nine metres out from its middle
    const pt = (a: number) => at(Math.cos((a * Math.PI) / 180) * 9.4, Math.sin((a * Math.PI) / 180) * 9.4);
    for (let k = 0; k < 4; k++) wall(pt(98 - k * 21), pt(98 - (k + 1) * 21), [1.1 + hash(k, 1, 41) * 1.3, 0.7 + hash(k, 2, 41) * 1.6, 1.2 + hash(k, 3, 41) * 1.1], 0.7, 'curved wall');
  } else if (l.kind === 'long wall') {
    // sixteen metres of it, in lengths that each stand at the height of the ground where they are, one of them gone
    for (let k = 0; k < 7; k++) if (k !== 3) wall(at(0, -8.4 + (k + 1) * 2.4), at(0, -8.4 + k * 2.4), [1.2 + hash(k, 1, 43) * 1.4, 1.6 + hash(k, 2, 43) * 1.2], 0.55, 'wall down the slope');
  } else {
    const r = 0.9 + hash(l.n, 1, 51) * 0.7, h = 0.9 + hash(l.n, 2, 51) * 1;
    parts.push({ t: 'lump', paint: 'rock', x: l.x, y: h * 0.25, z: l.z, rx: r, ry: h, rz: r * (0.7 + hash(l.n, 3, 51) * 0.5), seed: 300 + l.n * 7, sits: [l.x, l.z], at: 'both', name: 'rock tooth' });
  }
  return parts;
}

/** whether a spot (in the fort's own measure) is in the round cellar in the foot of a hollow tower */
const inCellar = (x: number, y: number, z: number) => y < -0.6 && castleParts().some((t) => t.t === 'tower' && t.hollow !== undefined && y > t.hollow - 0.4 && Math.hypot(x - t.cx, z - t.cz) < CASTLE.tower.r - CASTLE.tower.wall + 0.4);

/**
 * Whether a place is in the fort's lower levels, or in the passage out of them to a hatch: where a body is under
 * the terrace, and may be under the ground, by right. (The server's rule against being under the ground excuses
 * it, as it excuses the bunker: see `underCheck` in server/index.ts.)
 *
 * ONLY WHERE THERE IS A PLACE TO BE (2026-10-13). It is asked of where a body's feet are, and it says yes only in
 * what was built to be stood in: between a floor and the roof over it, inside the walls of it, with half a pace
 * and a step's height to spare and no more. It said yes anywhere under the fort's plan down to a metre under the
 * deepest floor, and a body sunk in the earth under the armoury, where nothing can reach it, was excused with the
 * rest. The places are: the lower levels themselves from their floor up (the cistern's is a knee lower); the slot of
 * the stair down to the sally port, from the stair's own slope up; the cellar in the hollow tower; the postern's
 * doorway and its landing; each hatch's steps, from their own slope up to the ground; and each straight length of
 * its passage, from its own floor (which climbs) to its roof.
 * @param ground the height of the world's ground at a spot, as it was before anything was cut for the fort (the passage is made to the hatch's depth)
 */
export function castleUnder(p: Place | null, wx: number, wy: number, wz: number, ground?: GroundAt, loose?: Loose[]): boolean {
  if (!p) return false;
  const [x, z, y] = castleLocal(p, wx, wy, wz), U = UNDER, H = U.hatch, PS = U.postern, CI = U.cistern;
  /** half a pace beyond a wall's face (every wall of it is thicker than that), and a step's height under a floor */
  const SIDE = 0.45, STEP = 0.6;
  if (y < -0.6 && Math.abs(x) < U.x + SIDE && Math.abs(z) < U.z + SIDE) {
    // (what is underfoot there: the slope of the stair down and its landing, in their slot; the cistern's floor; the floor)
    let floor = U.floor;
    if (x > PS.x0 - SIDE && z > PS.head - SIDE && z < PS.end + 0.25 + SIDE) floor = U.floor + (PS.deep - U.floor) * clamp01((z + SIDE - PS.head) / (PS.foot - PS.head));
    else if (x < CI.x1 + SIDE && z < CI.z1 + SIDE) floor = U.floor - CI.deep;
    if (y > floor - STEP) return true;
  }
  if (inCellar(x, y, z)) return true;
  // (the postern's doorway through the west wall's foot, and the landing outside it)
  if (y > U.floor - STEP && y < U.floor + 2.4 && x < -U.x + SIDE && x > -CASTLE.hx - CASTLE.parapet.thick / 2 - WALL.out - 1.25 - SIDE && z > U.goat.z0 - 0.1 - SIDE && z < U.goat.z1 + 0.1 + SIDE) return true;
  for (const l of looseLocal(p, loose ?? castleLoose(p))) {
    if (l.kind !== 'hatch') continue;
    const [hx, , hz] = castleAt(p, l.x, l.z), g = ground ? (ground(hx, hz) - p.y) / CASTLE_SCALE : castleGround(l.x, l.z), L = hatchLine(l, g);
    // (on its steps: how far along them from their head, and how far off their line; from the steps' own slope up to the ground)
    const ax = x - L.head[0], az = z - L.head[2], along = ax * L.d[0] + az * L.d[1], off = Math.abs(ax * L.r[0] + az * L.r[1]);
    // (the stairwell is open as far as half a pace past their foot: see `looseParts`)
    if (along > -0.5 && along < H.run + 0.5 + SIDE && off < H.wide / 2 + SIDE && y < g + 0.6 && y > g - H.drop * clamp01((along + SIDE) / H.run) - STEP) return true;
    // (in its passage: within its width of one of its straight lengths, between its floor there and its roof)
    for (let k = 0; k + 1 < L.path.length; k++) {
      const a = L.path[k], b = L.path[k + 1], ex = b[0] - a[0], ez = b[2] - a[2], t = clamp01(((x - a[0]) * ex + (z - a[2]) * ez) / (ex * ex + ez * ez)), floor = a[1] + (b[1] - a[1]) * t;
      if (Math.hypot(x - a[0] - ex * t, z - a[2] - ez * t) < H.wide / 2 + SIDE && y > floor - STEP && y < floor + H.tall + 0.4) return true;
    }
  }
  return false;
}

/**
 * How dark it is at a place for being under the fort: 0 in the open and anywhere above, 1 in the lower levels and
 * the passage, and less than that near where the day gets in (the fallen bay and the hole over the cistern most of
 * all, and the rent; the stair from the store, the gratings and the hole in the tower a little; the hatch's
 * steps). As the bunker's is: whoever draws the world puts out so much of the sun and the sky for an eye that is there.
 */
export function castleDark(p: Place | null, wx: number, wy: number, wz: number, ground?: GroundAt, loose?: Loose[]): number {
  if (!p || !castleUnder(p, wx, wy, wz, ground, loose)) return 0;
  const [x, z, y] = castleLocal(p, wx, wy, wz), U = UNDER, B = U.bay, D = U.cistern.drop;
  if (x < -U.x - 0.7) return inCellar(x, y, z) ? clamp01((-y - 0.8) / 1.4) * 0.75 : 0.3;
  if ((Math.abs(x) > U.x + 0.7 || Math.abs(z) > U.z + 0.7) && !inCellar(x, y, z)) {
    // in the passage: dark, but for the last of it under the hatch
    let near = Infinity;
    for (const l of looseLocal(p, loose ?? castleLoose(p))) if (l.kind === 'hatch') near = Math.min(near, Math.hypot(x - l.x, z - l.z));
    return clamp01((near - 1.5) / 5);
  }
  const deep = clamp01((-y - 0.8) / 1.4), off = (x0: number, x1: number, z0: number, z1: number) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
  let lit = 1 - clamp01(off(B.x0, B.x1, B.z0, B.z1) / 6);
  lit = Math.max(lit, 1 - clamp01(off(D.x0, D.x1, D.z0, D.z1) / 9));
  lit = Math.max(lit, 0.45 * (1 - clamp01(off(U.stair.head, U.stair.open, U.stair.z - 0.5, U.stair.z + 0.5) / 3.5)));
  lit = Math.max(lit, 1 - clamp01(off(U.x - 0.5, U.x + 2, U.rent.z0, U.rent.z1) / 6));
  lit = Math.max(lit, 0.6 * (1 - clamp01(off(-U.x - 1, -U.x, U.goat.z0, U.goat.z1) / 3)));
  for (const [gx, gz] of U.gratings) lit = Math.max(lit, 0.3 * (1 - clamp01(Math.hypot(x - gx, z - gz) / 2.5)));
  lit = Math.max(lit, 0.35 * (1 - clamp01(Math.hypot(x + CASTLE.hx, z + CASTLE.hz) / 3)));
  return deep * (1 - 0.8 * lit);
}

/**
 * What whoever shapes the mountain must do to the ground for the fort, and nothing else of the ground is touched.
 * One thing, for each piece of the plan this gives (`well`: its four corners in the world, [x, z]): the ground
 * LOWERED to `to` or under at every corner of every square of its grid that the piece touches (`squareTouches`
 * says which). They are: the slot of the stair down to the sally port, inside the walls; and for each hatch its
 * stairwell and a strip along each straight length of its passage. Ground is a skin with nothing under it: a body
 * goes through it only where it has been taken away, and a passage that leaves a place where it was taken away
 * meets it again a square further on, slanting down across its way. So it is taken away along the whole of what
 * is under the ground, as the bunker's is over the whole of its pit.
 *
 * What is lowered is covered. Inside the walls the fort covers it. Outside them the hatch lays the ground's own
 * earth over all of it, at the height the ground HAD (drawn with the ground's own paint: `earth`, to CastleSite)
 * out to `UNDER.hatch.lid` from each piece, which is as far as lowering those corners can disturb ground of
 * two-metre squares. So `ground`, here and wherever the fort is given it, is the ground AS IT WAS BEFORE this:
 * what the hatch stands at, what its earth lies at, and what everything of the fort's grounds stands on.
 *
 * Nothing is levelled. The lower levels themselves stand over the ground: only the ground under the terrace,
 * inside the walls, must be nowhere higher than the foot the fort assumes (`CASTLE.foot`: 5.8 m under the terrace
 * at the least), which is two metres under their floor.
 */
export function castleCuts(p: Place, ground?: GroundAt, loose?: Loose[]): { well: [number, number][]; to: number }[] {
  const PS = UNDER.postern, to = (q: [number, number][]) => q.map(([x, z]): [number, number] => [castleAt(p, x, z)[0], castleAt(p, x, z)[2]]);
  const U = UNDER, S = CASTLE_SCALE, out = [{ well: to(shaftWell()), to: p.y + S * (PS.deep - 0.9) }];
  for (const l of looseLocal(p, loose ?? castleLoose(p))) {
    if (l.kind !== 'hatch') continue;
    const [hx, , hz] = castleAt(p, l.x, l.z), g = ground ? (ground(hx, hz) - p.y) / CASTLE_SCALE : castleGround(l.x, l.z);
    for (const w of hatchWells(l, g)) out.push({ well: to(w.well), to: p.y + S * w.to });
  }
  // (And, last, the lower levels themselves, to under their floor. They are made to stand over the ground, inside
  // the fort's own base, and where the ground is as low as the fort assumes this lowers nothing: a cut is "to here
  // or under". On the side of the gate a hill may stand higher than their floor: there, and only there, it is let
  // down, and the fort's base covers it.)
  out.push({ well: to([[-(U.x + 0.7), -(U.z + 0.7)], [U.x + 0.7, -(U.z + 0.7)], [U.x + 0.7, U.z + 0.7], [-(U.x + 0.7), U.z + 0.7]]), to: p.y + S * (U.floor - U.cistern.deep - 0.75) });
  return out;
}
/** Whether a square of ground (its lowest corner [x, z] and its size, in the world) touches a four-cornered piece of the plan: for whoever makes the cut `castleCuts` asks for. */
export function squareTouches(well: [number, number][], x: number, z: number, size: number): boolean {
  // (two shapes with no dent in them are apart only if some side of one of them has all of the other beyond it)
  const sq: [number, number][] = [[x, z], [x + size, z], [x + size, z + size], [x, z + size]];
  for (const [a, b] of [[well, sq], [sq, well]]) for (let k = 0; k < a.length; k++) {
    const [px, pz] = a[k], [qx, qz] = a[(k + 1) % a.length], nx = qz - pz, nz = px - qx;
    const side = (pts: [number, number][]) => pts.map(([vx, vz]) => (vx - px) * nx + (vz - pz) * nz);
    const own = side(a), other = side(b);
    if (Math.max(...own) <= 1e-9 ? Math.min(...other) > 1e-9 : Math.max(...other) < -1e-9) return false;
  }
  return true;
}

/**
 * The fort's place as a world says it: where its middle is, how high its terrace, how it is turned; and, where the
 * world has set them down itself, what only the ground it stands on can say:
 *   loose  – its loose pieces, each where that ground suits (in the world: see `castleLoose`). Unsaid, they stand
 *            where the plan has them, on the ground the fort assumes.
 *   before – the open ground before its gate, where the garrison's dead stand ([x, z] in the world). Unsaid, the plan's.
 *   rock   – false: the ramp lands on ground of the land's own, and the rock it leaves from in the plan is not made
 *            (the owner, 2026-10-13: "get rid of the rocks near the front draw bridge ... make our own terrain").
 *   lid    – what its cuts left of the ground's own net (see `FortLid`). Unsaid: the fort lays earth of its own
 *            over what is cut, on squares of its own measure (the fort's own page, whose ground is laid square to it).
 */
export type FortPlace = Place & { loose?: Loose[]; before?: [number, number]; rock?: boolean; lid?: FortLid };

/**
 * ONE GROUND OVER WHAT IS CUT (the owner, 2026-10-13: "the ground also has overlapping textures and physics because
 * of the tunnel under ground"). The ground is let down under the fort's passage (`castleCuts`), and something must
 * be seen and stood on where it was. That is the ground ITSELF, on its own net: whoever draws the ground draws
 * every square listed here at the height it had (`seenGround`, in the world's generator), with the ground's own
 * snow, paint and grass, and the fort lays nothing over it. What the fort adds is only what the ground cannot do:
 *   - under each square listed, what stops a body: the ground's collider is a skin that is let down there, so the
 *     fort stands earth under each half of the square, its top exactly where the ground is drawn. SOLID EARTH: down
 *     past the cut (`low`: the lowest any corner of the square was let down to), so that there is no room under the
 *     ground that is not a room of the plan (measured, 2026-10-13: 92 m2 of standing room between a thin lid and
 *     the cut ground, beside the passage); and over the passage itself, down to the top of its roof;
 *   - in a square that is `open` (a hatch's stairwell opens in it), the ground draws nothing and the fort draws the
 *     square round the well, on the ground's own corners and cut corner to corner as the ground is.
 * `squares`: every square of the net (its lowest corner [x, z] in the world, `cell` metres a side) that has a corner
 * that was let down and is not wholly under the fort's own stone (`castleHides`).
 */
export interface FortLid { cell: number; squares: { x: number; z: number; open: boolean; low: number }[] }

/**
 * Whether a spot of the ground is under the fort's own stone or inside its walls, where nobody sees the ground:
 * within the outer faces of its walls (which lean: the face as it is at the height the ground has there; under
 * the kit's wall, the footing's) or of a tower's foot. A hand's breadth short of the face: what lies in the face
 * itself counts as seen.
 * @param wy how high the ground is there
 */
export function castleHides(p: Place, wx: number, wy: number, wz: number): boolean {
  const [x, z, y] = castleLocal(p, wx, wy, wz), C = CASTLE, SEEN = 0.12;
  const out = y < -KIT_LEVELS.walk ? WALL.out + 0.12 : Math.min(WALL.out, Math.max(0, -y) / C.lean);
  if (Math.abs(x) < C.hx + C.parapet.thick / 2 + out - SEEN && Math.abs(z) < C.hz + C.parapet.thick / 2 + out - SEEN) return true;
  return Math.hypot(Math.abs(x) - C.hx, Math.abs(z) - C.hz) < towerRadius(y) - SEEN;
}

/** Each hatch's stairwell as a hole in the world's ground: its four corners [x, z], in order round it, kerb and all. (Open to the sky: nothing of the ground is drawn or stood on over it.) */
export function castleOpen(p: FortPlace, loose?: Loose[]): [number, number][][] {
  return looseLocal(p, loose ?? castleLoose(p)).filter((l) => l.kind === 'hatch').map((l) => hatchWell(l, 0).map(([x, z]): [number, number] => [castleAt(p, x, z)[0], castleAt(p, x, z)[2]]));
}

/**
 * How far outside the fort's foot a spot of the world is, in metres (nothing or less: under it). Its foot is all
 * of the plan that stands on the ground: the walls and the towers' feet, the ramp and where it lands, the rubble
 * under the breach, the stone of the fallen wall, and the back door's landing and stair. For whoever must keep
 * the ground about it clear, or measure the land round it.
 */
export function castleFoot(p: Place, wx: number, wz: number): number {
  const [x, z] = castleLocal(p, wx, 0, wz), C = CASTLE, ex = C.hx + C.parapet.thick / 2 + WALL.out, ez = C.hz + C.parapet.thick / 2 + WALL.out, G = UNDER.goat;
  const rect = (x0: number, x1: number, z0: number, z1: number) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1)) + Math.min(0, Math.max(x0 - x, x - x1, z0 - z, z - z1));
  let d = rect(-ex - 0.12, ex + 0.12, -ez - 0.12, ez + 0.12);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) d = Math.min(d, Math.hypot(x - sx * C.hx, z - sz * C.hz) - towerRadius(C.foot.south));
  // (the ramp, and seven metres of the plan beyond its foot: where the rock's top was; the rubble; the fallen wall's stone; the back door)
  d = Math.min(d, rect(ex, OUTCROP.x1, OUTCROP.z0, OUTCROP.z1), rect(FAN.end - 3, FAN.foot + 2, -ez - FAN.wide - 5.5, -ez), rect(ex, 17.7, UNDER.postern.end + 0.35, UNDER.rent.z1 + 4.2), rect(-ex - 1.25, -ex, G.z0 - 0.1, G.z1 + 5.6));
  return d * CASTLE_SCALE;
}

/** The loose pieces as the world has them: where each stands in the world. (Where the world has not said, where the plan has them.) */
export function castleLoose(p: FortPlace): Loose[] {
  if (p.loose) return p.loose;
  return LOOSE.map((l) => {
    const [x, , z] = castleAt(p, l.x, l.z);
    return { ...l, x, z, rot: l.rot + p.rot };
  });
}
/** Loose pieces said by where they stand in the world, in the fort's own measure. */
export function looseLocal(p: Place, loose: Loose[]): Loose[] {
  return loose.map((l) => {
    const [x, z] = castleLocal(p, l.x, 0, l.z);
    return { ...l, x, z, rot: l.rot - p.rot };
  });
}

// WHAT IS KEPT HERE, AND ON WHICH STEP OF THE MAP. (The owner, asked: "refer to dayz and use common sense". The
// rules are over TYPES in src/sim/economy.ts: a thing has a kind of building it is kept in and a step it belongs to.)
//
// In DayZ a castle is no armoury: it is a hunter's and a wanderer's place, worth going to for where it stands, with
// a little of what is good in it. The army's stores and the gas are where the best is. So this is not a second
// Chemical Works: that would be the rifles' own step with no mask asked for, and nobody would go under the gas
// again. It is three steps in one place, and the way from the first to the last is up:
//   2  the ruined houses on the way to it: a hunter's leavings (Hunting). What a body can use on the climb.
//   3  the fort itself, from the gate to the hall: the terrace, the store under the hall, the hall, the floors of
//      the towers. What whoever held it lived on and fought with (Military): Kamenka's step, a submachine gun and
//      a vest, and far from Kamenka.
//   4  what is hardest to come at (Military), the rifles' own step: under the terrace, in the dark (the chamber
//      under the store, the cells at the far side of the galleries, the cellar in the foot of the north-west tower,
//      the landing of the passage out): twelve places, most of them behind the longest way round; and at the very
//      top, the rack in the upper room, which always has a gun on it, and the wall top over the roof.
// Its crates and cases are searched as crates are anywhere.
// (THE OWNER, 2026-10-13: "castle is T4 loot". Everything in and under the fort is of the fourth step now; the three
// steps above are how it was first laid out, and the ruined houses before its gate are still the hunter's second.)
export const CASTLE_TIERS = { grounds: 2, fort: 4, high: 4 } as const;
/** what is of the high step: whatever lies under the terrace; and above it, only what is said to be (the rack of guns, the wall top) */
const high = (y: number, top = false) => (y < -0.5 || top ? CASTLE_TIERS.high : CASTLE_TIERS.fort);
export type CastleUsage = 'Military' | 'Hunting' | 'Medic' | 'Hospital';
export interface CastleLoot {
  x: number;
  y: number;
  z: number;
  usage: CastleUsage[];
  building: string;
  floor: boolean;
  tier: 2 | 3 | 4;
  /** kept stocked with a gun (the rack in the upper room) */
  arms?: 'guns';
  surf?: { x: number; z: number; rot: number; hx: number; hz: number; clear: number };
}

/** where things lie, in the fort's own measure: [x, z, y, on the floor, what kind of place, on which piece of furniture (its place in FURNITURE)] */
function lootSpots(loose: Loose[]): { x: number; z: number; y: number; floor: boolean; usage: CastleUsage[]; tier: 2 | 3 | 4; on?: number; arms?: 'guns'; sits?: [number, number]; /** it is the hamlet's, before the gate, and not the fort's */ hamlet?: boolean }[] {
  const C = CASTLE, T = C.tower, out: ReturnType<typeof lootSpots> = [];
  const army: CastleUsage[] = ['Military'], hunt: CastleUsage[] = ['Hunting'];
  // on the furniture: along the top of each table, on a rack's middle shelf, on a bunk's lower bed
  FURNITURE.forEach((f, on) => {
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    // (so far along its board and so high on it, in metres of the world: the board is a body's, see `FURNITURE`)
    const put = (lx: number, y: number, o: { arms?: 'guns' } = {}) => out.push({ x: f.x + body(lx) * c, z: f.z - body(lx) * s, y: f.y + body(y), floor: false, usage: f.medic ? ['Medic', 'Hospital'] : army, tier: high(f.y, !!o.arms || (f.kind === 'rack' && f.y > 5)), on, ...o });
    if (f.kind === 'table') for (const lx of f.w > 2 ? [-0.75, 0, 0.75] : [-0.45, 0.45]) put(lx, 0.8);
    else if (f.kind === 'rack') {
      put(-0.4, 0.995, f.arms || f.y > 5 ? { arms: 'guns' } : {});
      put(0.4, 0.995);
    } else if (f.kind === 'bunk') put(0, 0.46);
  });
  const fl = (x: number, z: number, y: number, top = false, usage = army) => out.push({ x, z, y, floor: true, usage, tier: high(y, top) });
  // THE VAULTS. The armoury: on its floor by its cases (its racks and its table are above, with the furniture).
  const UF = UNDER.floor, medic: CastleUsage[] = ['Medic', 'Hospital'];
  fl(-2.3, -0.2, UF);
  fl(-0.5, 2.7, UF);
  fl(2.3, -0.9, UF);
  fl(-0.3, -1.1, UF);
  // the aid post: by the cot in each cell, and in the ward: what a dressing station had
  for (const x of [-2.1, 0.3, 2.7]) fl(x - 0.5, 7.2, UF, false, medic);
  fl(5.0, 6.95, UF, false, medic);
  fl(6.2, 6.4, UF, false, medic);
  fl(-7.3, 6.5, UF, false, medic);
  // the cellar under the tower; by the head of the sally port's stair, and on its landing
  fl(-C.hx - 0.9, -C.hz + 0.9, UF);
  fl(6.3, -7.3, UF);
  fl(UNDER.postern.x0 + 0.5, UNDER.postern.end - 0.45, UNDER.postern.deep);
  // the store, the hall, the upper room and the roof: on the boards and the paving
  fl(-1.5, -1.3, 0);
  fl(1.4, 0.4, 0);
  fl(-0.6, 2.2, 0);
  fl(-1.2, -2.5, 3);
  fl(1.9, -2.2, 3);
  fl(-2.6, 0.2, 5.85);
  fl(-0.9, 1.7, 5.85);
  fl(-2.8, 2.4, C.keep.roof);
  fl(-2, 2.7, C.keep.roof);
  fl(3.7, -1, C.keep.band, true);
  // each tower: under the stair on its floor, and up on its platform
  for (const tw of castleParts()) {
    if (tw.t !== 'tower') continue;
    const back = ((tw.door + 180) * Math.PI) / 180;
    fl(tw.cx + Math.cos(back) * 0.5, tw.cz + Math.sin(back) * 0.5, 0);
    fl(tw.cx, tw.cz, T.deck);
  }
  // the terrace: by the fire, and behind the keep
  fl(4.6, -6.6, 0);
  fl(-7.3, -5.6, 0);
  fl(5.9, 4.4, 0);
  // the ruined houses: a hunter's leavings, one or two to a house
  houses(loose).forEach((sh, k) => {
    const c = Math.cos(sh.rot), s = Math.sin(sh.rot);
    for (const [lx, lz] of k % 2 ? [[-2.4, 1.2]] : [[2.2, -1.1], [-2.6, 1.4]]) {
      const x = sh.x + lx * c + lz * s, z = sh.z - lx * s + lz * c;
      out.push({ x, z, y: 0.02, floor: true, usage: hunt, tier: CASTLE_TIERS.grounds, sits: [x, z], hamlet: true });
    }
  });
  return out;
}

/** where a thing off the shelf stands: [what, x, z, y, which way it is turned]. Crates and cases are searched, as they are anywhere. */
const STOOD: [string, number, number, number, number][] = [
  // the store: what an army left, and what was put by since
  // (each is the size it comes, in a fort a fifth bigger: what stands ON another is that other's own height over the floor, `body(...)`, and as far along it)
  ['wooden_military_crate', -1.2, 3.02, 0, 0], ['wooden_military_crate', 2.1, 2.95, 0, 0], ['wooden_crate_01', 2.1 + body(0.05), 2.95 - body(0.05), body(0.46), -0.2],
  ['barrel_03', -0.7, -1.9, 0, 0], ['barrel_03', 0, -1.92, 0, 1], ['barrel_03', 2.35, 0.9, 0, 2],
  // the chamber under the store, and the cells: what was worth keeping under a stone roof
  // the armoury: cases of arms, and boxes of rounds on its table
  // (each stood by its measure in the manifest: a case is 1.26 by 0.52, a crate 1.24 by 0.52; the way in at the grille is left clear)
  ['weapons_case', -2.3, -0.75, UNDER.floor, 0.25], ['weapons_case', 0.9, 2.98, UNDER.floor, 0], ['weapons_case', 0.9 + body(0.05), 2.98 - body(0.03), UNDER.floor + body(0.43), 0.12], ['wooden_military_crate', -0.3, -1.15, UNDER.floor, 0.1], ['wooden_military_crate', 2.42, 2.98, UNDER.floor, 0], ['wooden_military_crate', 2.3, -1.3, UNDER.floor, Math.PI / 2],
  // (on its table, whose middle is at 1.4, -0.4)
  ['ammo_box', 1.4 - body(0.35), -0.4 - body(0.1), UNDER.floor + body(0.8), 0.3], ['ammo_box', 1.4 - body(0.1), -0.4 + body(0.1), UNDER.floor + body(0.8), 1.2], ['ammo_box', 1.4 + body(0.35), -0.4 - body(0.05), UNDER.floor + body(0.8), -0.2],
  // the aid post: a cot in each cell and one in the ward, a cabinet, a box of dressings, a lamp on a stand
  // (a bed is 0.91 by 2.0: along the back wall of each cell, and of the ward; the cabinet is in the nook at the west end)
  ['old_bed_frame', -2.1, 7.82, UNDER.floor, Math.PI / 2], ['old_bed_frame', 0.3, 7.82, UNDER.floor, Math.PI / 2], ['old_bed_frame', 2.7, 7.82, UNDER.floor, Math.PI / 2], ['old_bed_frame', 5.05, 7.8, UNDER.floor, Math.PI / 2],
  ['med_cabinet', -7.9, 6.2, UNDER.floor, Math.PI / 2], ['medical_box', -1.35, 7.2, UNDER.floor, 0.4], ['medical_box', 5.7, 6.95, UNDER.floor, -0.3], ['medical_light', 6.1, 6.95, UNDER.floor, 0.6],
  // the upper room
  ['weapons_case', 0.2, -1.0, 5.85, 0.1],
  // the hall: a long case against its north wall
  ['old_military_crate', 1.75, -2.85, 3, 0],
  // the roof: something to kneel behind
  ['wooden_crate_01', -2.9, -0.4, CASTLE.keep.roof, 1.4], ['wooden_crate_01', 2.3, -1.2, CASTLE.keep.roof, 0.4],
  // inside the gate: drums of fuel dragged across it, which did not stop anybody (and which a shot sets off: whoever
  // comes in by the gate comes in past them), and what else was to hand
  ['Barrel_01', 7.75, -4.6, 0, 0], ['Barrel_01', 8.1, -4.0, 0, 2], ['wooden_crate_01', 8.0, 0.2, 0, 0.3], ['wooden_crate_01', 7.5, 2.3, 0, 0.1], ['wooden_crate_01', 7.5 - body(0.05), 2.3 + body(0.05), body(0.35), 0.6],
  // a fire on the north side of the terrace, out of the wind off the gate
  ['stone_fire_pit', 4.6, -7.75, body(0.19), 0],
];
/** and in the ruined houses, each on the ground where it is: a fire in the second there is, a crate in the fourth: [what, which house, across it, along it, turned] */
const STOOD_OUT: [string, number, number, number, number][] = [['stone_fire_pit', 1, -0.6, 0.3, 0], ['wooden_crate_01', 3, 2.2, -1.6, 0.8]];
const houses = (loose: Loose[]) => loose.filter((l) => l.kind === 'house');

/** the ground at a spot of the world, for whoever stands a thing on it: the world's own, where there is one; else what the fort assumes */
export type GroundAt = (wx: number, wz: number) => number;
const assumed = (p: Place): GroundAt => (wx, wz) => {
  const [x, z] = castleLocal(p, wx, 0, wz);
  return p.y + CASTLE_SCALE * castleGround(x, z);
};

/**
 * Every place a thing can lie, as places in the world. The same on the server and in every game: it is all in
 * the plan. @param ground the height of the world's ground at a spot (the ruined houses stand on it as it is)
 */
export function castleLoot(p: Place, ground: GroundAt = assumed(p), loose: Loose[] = castleLoose(p)): CastleLoot[] {
  // (what lies down there is found by a torch: 'Military' still, and of the high step)
  const own = lootSpots(looseLocal(p, loose)).map((s): CastleLoot => {
    let [x, y, z] = castleAt(p, s.x, s.z, s.y);
    if (s.sits) y = ground(x, z) + s.y;
    const f = s.on === undefined ? null : FURNITURE[s.on];
    [x, y, z] = [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(z * 1000) / 1000];
    return {
      x, y: y + (s.floor ? 0.02 : 0.003), z, usage: s.usage, building: s.hamlet ? 'hamlet' : 'castle', floor: s.floor, tier: s.tier,
      ...(s.arms ? { arms: s.arms } : {}),
      // (the board a thing lies on: the real top of the real thing, where it is drawn and as big as it is drawn)
      ...(f ? { surf: { x: castleAt(p, f.x, f.z)[0], z: castleAt(p, f.x, f.z)[2], rot: p.rot + f.yaw, hx: f.w / 2, hz: f.d / 2, clear: f.kind === 'table' ? 10 : 0.5 } } : {}),
    };
  });
  // (and the post's: each has a `room` the fort's own have not)
  return [...own, ...postLoot(p, ground, loose)];
}

/**
 * THE JEEP THAT BURNS BEFORE THE GATE, for good (the owner, 2026-10-14: "can we put a static burning jeep out front
 * of the draw bridge that eluminates light as well for night time, and heat"; and, seeing it stood with its nose to
 * the gate: "the car is rotated backwards, the front should be facing the road"). One of the garrison's own, hit as
 * it left: off the way on the side of the hill, where the top of the shoulder is broad, its nose down the track
 * toward the road and slewed a little off the track's line, as a car that stopped in a hurry. It is the game's own
 * jeep, burned out (`kind`: what a car that is blown up is left as), and what its fire is worth is src/sim/wreck-fire.ts.
 *
 * In the fort's own measure, as everything here is, so that it turns and moves with the fort: `x`, `z` its middle
 * (four metres of the world beyond the ramp's foot, and four and a half to the hill side of the middle line of the
 * way in, which is the gate's: the nearest of it is over three metres from that line); `rot` how it is turned (its
 * model's nose is toward its own -z: a quarter turn back, -PI / 2, puts that nose straight down the gate's line,
 * away from the fort, and it is slewed 13 degrees off that, toward the hill).
 * What is a car's own is in metres of the world, since a car is no bigger for the fort being a fifth bigger:
 * `wheels`, where they stand from its middle [half its track, half its wheelbase], and `sunk`. It stands LEVEL on the
 * lowest of the ground under its four wheels, as the world has that ground, and a hand in it.
 */
export const JEEP_WRECK = { kind: 'uaz_469', x: 21.5, z: -5.4, rot: -Math.PI / 2 + 0.227, wheels: [0.7, 1.27] as [number, number], sunk: 0.1 };
/** Where the burning jeep stands in the world: its middle at the foot of its wheels, and how it is turned (as the world's list of things has a turn). */
export function castleJeep(p: Place, ground: GroundAt = assumed(p)): { kind: string; x: number; y: number; z: number; rot: number } {
  const J = JEEP_WRECK, [x, , z] = castleAt(p, J.x, J.z), rot = p.rot + J.rot, c = Math.cos(rot), s = Math.sin(rot);
  let y = Infinity;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) y = Math.min(y, ground(x + sx * J.wheels[0] * c + sz * J.wheels[1] * s, z - sx * J.wheels[0] * s + sz * J.wheels[1] * c));
  return { kind: J.kind, x, y: y - J.sunk, z, rot };
}

/** What stands in it off the shelf, as the world's own list of such things has them. */
export function castleProps(p: Place, ground: GroundAt = assumed(p), loose: Loose[] = castleLoose(p)): { kind: string; x: number; y: number; z: number; rot: number; scale: number; far?: number }[] {
  const out = STOOD.map(([kind, lx, lz, ly, rot]) => {
    const [x, y, z] = castleAt(p, lx, lz, ly);
    return { kind, x, y, z, rot: p.rot + rot, scale: 1, far: kind === 'stone_fire_pit' ? 140 : 90 };
  });
  const hs = houses(loose);
  for (const [kind, k, lx, lz, rot] of STOOD_OUT) {
    const h = hs[k];
    if (!h) continue;
    const x = h.x + lx * Math.cos(h.rot) + lz * Math.sin(h.rot), z = h.z - lx * Math.sin(h.rot) + lz * Math.cos(h.rot);
    out.push({ kind, x, y: ground(x, z) + (kind === 'stone_fire_pit' ? 0.19 : 0), z, rot: h.rot + rot, scale: 1, far: 140 });
  }
  out.push(...postProps(p, ground, loose));
  // (And the jeep that burns before the gate, the last of all: no thing before it is renumbered. `far` nothing: it
  // is in the world's list for where it is and for what stops a body and a shot there, as any car stood about the
  // map is, and is drawn from no distance by whoever draws that list. It is drawn burnt, by src/game/wreck-fire.ts.)
  out.push({ ...castleJeep(p, ground), scale: 1, far: 0 });
  return out;
}

/** Where its lights are, as places in the world: its own, and one at each bend of a hatch's passage (`ground`, `loose`: as `castleLoot` has them). */
export function castleLamps(p: Place, ground?: GroundAt, loose?: Loose[]): V3[] {
  const out = LAMPS.map(([x, z, y]) => castleAt(p, x, z, y));
  for (const l of looseLocal(p, loose ?? castleLoose(p))) {
    if (l.kind !== 'hatch') continue;
    const [hx, , hz] = castleAt(p, l.x, l.z), g = ground ? (ground(hx, hz) - p.y) / CASTLE_SCALE : castleGround(l.x, l.z);
    for (const [x, z, y] of passageLamps(hatchLine(l, g))) out.push(castleAt(p, x, z, y));
  }
  return out;
}

/**
 * Where the infected of the place live: the ruined village, one to each of its houses; and four of the garrison's
 * dead on the open ground before the gate, where the way up comes to the foot of the ramp. They do not have the
 * terrace, the keep, the towers or the roof, which are for whoever holds the fort and whoever comes to take it.
 *
 * NOT THE LOWER LEVELS, for now (2026-10-13: "zombies spawn in the castle and get stuck and bugged in collision").
 * Four were stood in the aid post and about the galleries. One of the infected drifts in a straight line toward a
 * spot up to fifteen metres from the middle of where it lives, and gives up when it is stopped (src/game/infected.ts:
 * it finds doors only in the valley's houses and down the bunker). Under the fort every room is a few paces across
 * and the middle of their home was the fort's own middle, inside the keep's foundations: they walked into walls
 * for three seconds in every ten, and stood in doorways. They are put back down there when the horde is taught the
 * lower levels' doors as it was taught the bunker's (`bunkerLeg`); until then the dark is empty of them.
 */
/**
 * @param ground the height of the world's ground at a spot, and @param open whether a spot of the world is open ground
 *   by the world's own reckoning (its trees, its rocks, what it has built): given these, each home says the very
 *   PLACES its dead are stood at (`inside`), and they are stood nowhere else.
 *
 * WHY (2026-10-14, played: "zombies are getting stuck in the base of the building and surrounding buildings"). A home
 * was a round of six metres about a house's middle, and whoever stands them asks only the world whether a spot is
 * open: the world does not know the fort's walls. Run by the game's own rules for eight minutes each, of 144 stood
 * 39 were stood IN stone (in a house's wall, in a fallen block, in a rock: one of those can never move), 57 inside
 * a house's four walls, whose one way out is a doorway their legs do not look for, and 38 never got a pace from
 * where they were put. So: about each house, outside it, two paces off its walls; before the gate, on the open
 * ground; each place a pace and more clear of every stone of the plan (`castleClear`), level, and open by the world.
 */
export function castleHomes(p: FortPlace, loose: Loose[] = castleLoose(p), ground?: GroundAt, open?: (wx: number, wz: number) => boolean): { x: number; z: number; r: number; n: number; inside?: V3[] }[] {
  // (the open ground before the gate: where the world says it is, on the ground the fort has; else where the plan has it)
  const hs = houses(loose), [gx, , gz] = p.before ? [p.before[0], 0, p.before[1]] : castleAt(p, 36, -1.5);
  // (before the gate: clear of the rock the ramp leaves from, of the first house and of the hatch)
  const gate = { x: gx, z: gz, r: 5.5, n: 4 };
  // (the village's: one to each of its houses, as far as five, in it or close by its walls. As one round home as wide
  // as the village is long they were stood anywhere within thirty metres of its middle, and the saddle it stands on is
  // fifteen metres wide: two of the five were found on the valley face, seventeen metres under the street.)
  const homes: { x: number; z: number; r: number; n: number; inside?: V3[] }[] = [...hs.slice(0, 5).map((h) => ({ x: h.x, z: h.z, r: 6.5, n: 1 })), gate];
  if (!ground) return homes;
  const local = looseLocal(p, loose), mine = local.filter((l) => l.kind === 'house'), rock = p.rock !== false;
  // (and clear of whatever stands on its grounds off the shelf: a crate by a house, a wreck before the gate)
  const stood = castleProps(p, ground, loose);
  const at = (x: number, z: number): V3 | null => {
    if (!castleClear(local, x, z, rock)) return null;
    const [wx, , wz] = castleAt(p, x, z), y = ground(wx, wz);
    if (stood.some((q) => Math.hypot(q.x - wx, q.z - wz) < 3.4)) return null;
    // (level enough to stand on and to walk off, as the world asks of open ground)
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (Math.abs(ground(wx + dx, wz + dz) - y) > 0.9) return null;
    return open && !open(wx, wz) ? null : [wx, y, wz];
  };
  return homes.map((h, k) => {
    const spots: V3[] = [];
    if (k < homes.length - 1) {
      // about its house, outside it: two paces off the middle of each wall, off each corner, and between those
      const l = mine[k], sh = HOUSES[l.n % HOUSES.length], c = Math.cos(l.rot), s = Math.sin(l.rot), a = sh.w / 2 + 2.1, b = sh.d / 2 + 2.1;
      for (const [u, v] of [[a, 0], [-a, 0], [0, b], [0, -b], [a, b], [a, -b], [-a, b], [-a, -b], [a, b / 2], [a, -b / 2], [-a, b / 2], [-a, -b / 2], [a / 2, b], [-a / 2, b], [a / 2, -b], [-a / 2, -b]]) {
        const spot = at(l.x + u * c + v * s, l.z - u * s + v * c);
        if (spot) spots.push(spot);
      }
    } else {
      const [lx, lz] = castleLocal(p, h.x, 0, h.z);
      for (let u = -4; u <= 4.01; u += 1.6) for (let v = -4; v <= 4.01; v += 1.6) {
        const spot = Math.hypot(u, v) < 4.6 ? at(lx + u, lz + v) : null;
        if (spot) spots.push(spot);
      }
    }
    // (a home with nowhere clear about it keeps its round: the world's own asking is all there is for it)
    return spots.length >= 2 ? { ...h, inside: spots } : h;
  });
}

/**
 * Whether a spot of the fort's grounds, in its own measure, is clear of everything of the plan that stops a body, by a
 * body and a pace (`by`): the fort and what lies against its foot, the ramp and its trestles, every house (all of it:
 * its four walls and what is between them), every rock, wall and hatch of its grounds.
 */
export function castleClear(loose: Loose[], x: number, z: number, rock = true, by = 1.2): boolean {
  const C = CASTLE, ex = C.hx + C.parapet.thick / 2;
  // (the fort, its towers' feet, the stone fallen from it and the scanned rock under its walls)
  if (Math.abs(x) < C.hx + 6.5 && Math.abs(z) < C.hz + 6.5) return false;
  // (the ramp and what it stands on; and the rock it leaves from, where that is made, with the rocks on it)
  if (x > ex - 1 && x < ex + C.ramp.len + 1.5 && z > C.gate.z0 - by - 0.6 && z < C.gate.z1 + by + 0.6) return false;
  if (rock && x > 15.5 - by && x < 32 + by && z > -9.5 - by && z < 4 + by) return false;
  for (const l of loose) {
    const dx = x - l.x, dz = z - l.z, c = Math.cos(l.rot), s = Math.sin(l.rot), u = dx * c - dz * s, v = dx * s + dz * c;
    if (l.kind === 'house') {
      const sh = HOUSES[l.n % HOUSES.length];
      if (Math.abs(u) < sh.w / 2 + by && Math.abs(v) < sh.d / 2 + by) return false;
    } else if (l.kind === 'rock') {
      // (a rock is at most 1.6 across at its middle, and a corner of it 1.24 of that)
      if (Math.hypot(dx, dz) < 1.6 * 1.24 + by) return false;
    } else if (l.kind === 'long wall') {
      if (Math.abs(u) < 0.3 + by && Math.abs(v) < 8.4 + by) return false;
    } else if (l.kind === 'curved wall') {
      if (Math.abs(Math.hypot(dx, dz) - 9.4) < 0.4 + by) return false;
    } else {
      // (a hatch: its well and its kerb, along the way its steps go down, and the steps that come up to its head)
      const L = hatchLine(l, 0), ax = x - L.head[0], az = z - L.head[2], along = ax * L.d[0] + az * L.d[1], across = ax * L.r[0] + az * L.r[1];
      if (along > -2.6 - by && along < UNDER.hatch.run + 0.9 + by && Math.abs(across) < UNDER.hatch.wide / 2 + 0.45 + by) return false;
    }
  }
  return true;
}
