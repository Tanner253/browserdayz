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

export type { Place };

export const CASTLE = {
  name: 'The Rocca',
  /** from its middle to the middle line of the east and west walls, and of the north and south ones: the towers stand where they cross */
  hx: 9.9,
  hz: 10,
  /** the wall under the terrace leans in: so many metres up for one metre in (75 degrees) */
  lean: 3.75,
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
  /** the towers: across at the top, the thickness of the wall, the lean under the terrace and where it eases, the fighting platform, and the inner edge of the stair */
  tower: { r: 3.1, wall: 0.9, lean: 3.9, bend: -7.4, flare: 8, deck: 4.8, slots: 24, stairIn: 1.15 },
  /** the keep: its outside, the room inside its walls, its floors, its roof, the top of the wall round the roof, the shell that is left of the storey over that, and the south-east corner of the roof that has fallen in with the walls over it (from there to the room's corner) */
  keep: { x0: -6.1, x1: 5.2, z0: -5.5, z1: 5.5, room: { x0: -3.7, x1: 2.8, z0: -3.4, z1: 3.4 }, floors: [0, 3, 5.85], roof: 8.7, band: 9.54, skin: 0.6, fallen: { x0: 1.3, z0: 2 } },
  /** the ground at the foot of each wall, under the terrace: what the real one measures */
  foot: { east: -5.8, west: -6.1, north: -7.3, south: -8 },
  /** how far off its smoke, lamps and shots matter: the whole of it and its grounds, from its middle */
  reach: 105,
};

/**
 * UNDER THE FORT (2026-10-13: "We should also build a robust basement or lower levels for the castle and a cellar
 * exit/entrance youd find outside a farm house like a tornado shelter ... we want dynamic map gameplay").
 *
 * The terrace stands six to eight metres over the ground, so there is a whole level between its paving and the
 * hill with no digging: the UNDERCROFT, its floor 3.8 m under the terrace. Under the keep's store is a chamber;
 * round it, under the terrace walk, four vaulted galleries meet at the corners, where the feet of the towers bulge
 * into them: the north one a cistern, the east one cellars, the south one a passage of cells, the west one broken
 * in two where a bay of its vault has fallen in. Chamber, north, east and south make a ring, and the chamber has
 * a door to each of the three: there are two ways between any two of them.
 *
 * Between the levels: a stone stair down from the keep's store into the chamber; the fallen bay, whose stone lies
 * as a slope from the west gallery's floor up to the paving (down or up, in the open, under the west wall where
 * the parapet is down); and a hole in the boards of the north-west tower, over a round cellar in its foot with a
 * doorway to the galleries (down only: it is a drop). Gratings in the paving are shot down through, and up.
 *
 * And the way out: from the east gallery a stair goes down along the outer wall to 9.6 m under the terrace, under
 * the ground, and a passage leaves it eastward under the wall's foot to a storm-cellar hatch out on the hill: a
 * loose piece (see LOOSE: 'hatch'), set down wherever the ground suits, the passage made to wherever it is.
 */
export const UNDER = {
  /** its floor, and the underside of the terrace over it, under the terrace */
  floor: -3.8,
  roof: -1,
  /** the inner faces of its outer walls, from the fort's middle */
  x: 8.2,
  z: 8.3,
  /** the chamber under the keep's store */
  mid: { x0: -3.7, x1: 3.2, z0: -3.4, z1: 3.4 },
  /** the bay of the west gallery's vault that has fallen in: the hole in the terrace */
  bay: { x0: -8.2, x1: -6.3, z0: -1.4, z1: 5.2 },
  /** the stair from the keep's store: along z, its head (at the terrace), its foot, and how far the store's floor is open over it */
  stair: { z: -2.9, head: -2.6, foot: 2.15, open: 1.4 },
  /** the stair down to the passage out: its slot in the east gallery's floor, its head and foot along z, the end of its landing, and how deep that is */
  postern: { x0: 7.1, x1: 8.2, head: -5.7, foot: 0.97, end: 2.05, deep: -9.6 },
  /** the length of the east wall that has fallen out, along z: wall, walk and all, down to the cellars' floor; and how far in its stone has spilt */
  rent: { z0: 3.3, z1: 5.7, in: 7.1 },
  /** gratings in the paving, each 0.9 m square: over the north-east corner, over the cistern, and in the store's floor */
  gratings: [[7.2, -6], [1.9, -7.2], [0.3, 1.2]] as [number, number][],
  /** the hatch: how far its steps go down, over what length, how wide they and the passage are, how tall the passage, and how far from its stairwell the earth laid over the cut ground reaches (as far as ground of two-metre squares can be disturbed by lowering the squares the stairwell touches: twice a square's corner to corner) */
  hatch: { drop: 3.2, run: 4.2, wide: 1.3, tall: 2.1, lid: 5.7 },
};
/** where the passage to the hatch leaves the fort: [x, z] in the fort's own measure, its floor so far under the terrace */
export const POSTERN = { x: UNDER.postern.x1 + 0.25, z: 1.5, y: UNDER.postern.deep };

export type V3 = [number, number, number];
/** what a part is made of: the walls' coursed stone, the keep's (the same stone, laid bigger), the dark small stone of the leaning bases, the wall cores and everything under the terrace, paving, old timber, iron, living rock, loose stone, and the ground's own earth (laid over a hole cut in the ground) */
export type Paint = 'stone' | 'ashlar' | 'base' | 'paving' | 'timber' | 'iron' | 'rock' | 'scree' | 'earth';
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
/** (`round`: a hole where stones have gone, round at its foot as at its head, not an opening a mason made) */
export interface Opening { u0: number; u1: number; y0: number; y1: number; arch?: boolean; round?: boolean }
/**
 * A wall that stands straight: along the ground from `a` to `b` (its middle line; the outside is on the left of
 * somebody walking it), from `y0` up to `top` (one height, or one for each of so many equal lengths of it, which
 * is a broken top), with openings said by how far along it they are.
 */
export interface Wall extends Common { t: 'wall'; a: [number, number]; b: [number, number]; y0: number; top: number | number[]; thick: number; openings?: Opening[] }
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
/** a rock, or a fallen block: where its middle is, half its size each way, and the number it is shaped from */
export interface Lump extends Common { t: 'lump'; x: number; y: number; z: number; rx: number; ry: number; rz: number; seed: number; blocky?: boolean }
/**
 * The ground's own earth laid round a hole in the ground: a skirt from the edge of the hole (`inner`: its four
 * corners, in order round it, level) out `reach` metres, where it comes down or up to whatever the ground is there.
 */
export interface Apron extends Common { t: 'apron'; inner: [V3, V3, V3, V3]; reach: number }
export type Part = Box | Slab | Beam | Rail | Flight | Wall | Curtain | Tower | Mound | Lump | Apron;

// ------------------------------------------------------------------ where it is

/** A spot in the fort's own measure, as a place in the world. */
export function castleAt(p: Place, x: number, z: number, y = 0): V3 {
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  return [p.x + x * c + z * s, p.y + y, p.z - x * s + z * c];
}
/** A place in the world, in the fort's own measure: [x, z, above the terrace]. */
export function castleLocal(p: Place, wx: number, wy: number, wz: number): V3 {
  const dx = wx - p.x, dz = wz - p.z, c = Math.cos(p.rot), s = Math.sin(p.rot);
  return [dx * c - dz * s, dx * s + dz * c, wy - p.y];
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
    const wide = Math.min(2.2, Math.max(0, x - wall - 0.6) * 0.55), off = Math.max(0, R.z0 + 0.1 - wide * 0.7 - z, z - (R.z1 - 0.1 + wide));
    // (inside the wall's line it lies between the two ends of the wall that are left, and nowhere else: there it is
    // said to be far under everything, the passage out and its stair with the rest)
    if (x < wall + 0.3 && off > 0.05) return -30;
    y -= off * 1.1;
    return y + (rough(x * 1.6, z * 1.6, 17) - 0.5) * 0.12 * clamp01((x - R.in) / 1.2);
  }
  if (kind === 'vault') {
    // the bay of the west vault that has fallen in: its stone lies in the gallery under it as a slope, from the
    // gallery's floor at the north end of the hole to the paving at the south end, and drops sheer behind that
    // under the vault that still stands. (The way down into the lower levels for whoever is on the terrace, and
    // the way up out of them.)
    const B = UNDER.bay, from = B.z0 + 0.5, to = B.z1 - 0.25, t = clamp01((z - from) / (to - from));
    let y = UNDER.floor + (-0.07 - UNDER.floor) * t;
    if (z > to) y -= (z - to) * 5;
    if (z < from) y -= (from - z) * 1.2;
    // (thirty-two degrees, and no rougher than a foot rides over: steeper, and whoever went down it would be carried)
    return Math.min(-0.07, y + (rough(x * 1.6, z * 1.6, 13) - 0.5) * 0.1 * Math.min(1, t * 5) * (z > to ? 0 : 1));
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
  const T = CASTLE.tower;
  if (y >= 0) return T.r;
  if (y >= T.bend) return T.r - y / T.lean;
  return T.r - T.bend / T.lean + (T.bend - y) / T.flare;
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
  const holes = [[U.x, ex, U.rent.z0, U.rent.z1], [U.bay.x0, U.bay.x1, U.bay.z0, U.bay.z1], [U.stair.head, U.stair.open, R.z0, R.z0 + 1], ...U.gratings.map(([x, z]) => [x - 0.45, x + 0.45, z - 0.45, z + 0.45]), [-ex, -8.8, -ez, -8.9]];
  for (const [x0, x1, z0, z1] of tiles(-ex, ex, -ez, ez, holes)) box('paving', x0, x1, U.roof, 0, z0, z1, { name: 'terrace', at: 'both' });
  // a grating: bars a hand apart. A body goes over it; a shot goes through
  for (const [x, z] of U.gratings) {
    for (let k = -2; k <= 2; k++) beam([x - 0.47, -0.035, z + k * 0.19], [x + 0.47, -0.035, z + k * 0.19], 0.035, 0.05, { paint: 'iron', name: 'grating' });
    for (const k of [-1, 1]) beam([x + k * 0.3, -0.06, z - 0.47], [x + k * 0.3, -0.06, z + 0.47], 0.05, 0.03, { paint: 'iron', name: 'grating' });
    box('iron', x - 0.47, x + 0.47, -0.07, 0, z - 0.47, z + 0.47, { hidden: true, body: 'feet', name: 'grating' });
  }

  // ---- UNDER IT (see UNDER). All of it is `low`: drawn only while somebody is near enough to see into it.
  const lbox = (paint: Paint, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, o: Partial<Box> = {}) => box(paint, x0, x1, y0, y1, z0, z1, { low: true, ...o });
  const PS = U.postern, UF = U.floor;
  // its floor (open over the stair down to the passage out), and its outer walls
  for (const [x0, x1, z0, z1] of tiles(-U.x - 0.4, U.x + 0.4, -U.z - 0.4, U.z + 0.4, [[PS.x0, PS.x1, PS.head, PS.end]])) lbox('base', x0, x1, UF - 0.5, UF, z0, z1, { name: 'undercroft floor', tone: 0.82 });
  // (each ends where the foot of a tower comes into the corner: that is the wall there)
  const WE = 7.05;
  lbox('base', -WE, WE, UF, U.roof, -U.z - 0.6, -U.z, { name: 'undercroft wall' });
  lbox('base', -WE, WE, UF, U.roof, U.z, U.z + 0.6, { name: 'undercroft wall' });
  lbox('base', -U.x - 0.6, -U.x, UF, U.roof, -WE, WE, { name: 'undercroft wall' });
  lbox('base', U.x, U.x + 0.6, UF, U.roof, -WE, U.rent.z0, { name: 'undercroft wall' });
  lbox('base', U.x, U.x + 0.6, UF, U.roof, U.rent.z1, WE, { name: 'undercroft wall' });
  // THE RENT in the east wall: where a length of it fell out. What is left either side shows what a wall is filled
  // with; its stone lies in a slope from the cellars' floor down to the hill outside, and a little way in over
  // that floor. (A second way in, for whoever finds it: up two metres of loose stone, into the dark.)
  for (const [z, side] of [[U.rent.z0, -1], [U.rent.z1, 1]]) parts.push({ t: 'wall', paint: 'base', tone: 0.85, at: 'both', name: 'broken wall end', a: [U.x, z + side * 0.3], b: [ex + 0.9, z + side * 0.3], y0: UF - 0.5, top: [-0.05, -0.5, -1.3, -2.3, -3.2], thick: 0.6 });
  parts.push({ t: 'mound', paint: 'scree', at: 'both', name: 'fallen wall', kind: 'rent', x0: U.rent.in - 0.6, x1: 17.7, z0: U.rent.z0 - 3.6, z1: U.rent.z1 + 4.2, cell: 0.35 });
  for (let k = 0; k < 10; k++) {
    const x = 8.6 + hash(k, 1, 541) * 6.5, z = U.rent.z0 + 0.3 + hash(k, 2, 541) * (U.rent.z1 - U.rent.z0 - 0.6) + (hash(k, 6, 541) - 0.3) * Math.max(0, x - 11.5) * 0.5;
    lump(x, moundTop('rent', x, z) + 0.12, z, 0.3 + hash(k, 3, 541) * 0.35, 0.18 + hash(k, 4, 541) * 0.14, 0.26 + hash(k, 5, 541) * 0.26, 550 + k, { paint: 'stone', blocky: true, name: 'fallen stone', body: 'none', at: 'both' });
  }
  // the keep's foundations: four walls round the chamber under its store, with a door to the north, the east and the south galleries
  const M = U.mid, arched = (u0: number, u1: number): Opening => ({ u0, u1, y0: UF, y1: UF + 2.15, arch: true });
  const found = (a: [number, number], b: [number, number], thick: number, openings: Opening[]) => void parts.push({ t: 'wall', paint: 'base', low: true, name: 'keep foundation', a, b, y0: UF, top: U.roof, thick, openings });
  found([K.x0, (K.z0 + M.z0) / 2], [K.x1, (K.z0 + M.z0) / 2], M.z0 - K.z0, [arched(2.25 - K.x0, 3.15 - K.x0)]);
  found([K.x1, (K.z1 + M.z1) / 2], [K.x0, (K.z1 + M.z1) / 2], K.z1 - M.z1, [arched(K.x1 + 0.5, K.x1 + 1.7)]);
  found([(K.x0 + M.x0) / 2, M.z1], [(K.x0 + M.x0) / 2, M.z0], M.x0 - K.x0, []);
  found([(K.x1 + M.x1) / 2, M.z0], [(K.x1 + M.x1) / 2, M.z1], K.x1 - M.x1, [arched(-0.6 - M.z0, 0.6 - M.z0)]);
  // the stair from the keep's store, down into the chamber; a rail round the hole it comes up through, in the store
  flight([U.stair.foot, UF, U.stair.z], [U.stair.head, 0, U.stair.z], 1, { paint: 'base', name: 'stair to the undercroft', low: true });
  rail([U.stair.head + 0.45, 0, R.z0 + 1], [U.stair.open, 0, R.z0 + 1]);
  rail([U.stair.open, 0, R.z0 + 1], [U.stair.open, 0, R.z0]);
  // two piers in the chamber, and one in the east gallery: something to stand behind
  for (const [x, z] of [[-1.3, 1], [1.1, 1], [5.55, -1.6]]) lbox('base', x - 0.32, x + 0.32, UF, U.roof, z - 0.32, z + 0.32, { name: 'pier' });
  // an arch across each gallery here and there: each bay between two of them is a vault
  const rib = (a: [number, number], b: [number, number]) => void parts.push({ t: 'wall', paint: 'base', low: true, name: 'vault rib', a, b, y0: UF, top: U.roof, thick: 0.45, openings: [{ u0: 0.28, u1: Math.hypot(b[0] - a[0], b[1] - a[1]) - 0.28, y0: UF - 0.1, y1: U.roof - 0.3, arch: true }] });
  rib([-4.2, -U.z], [-4.2, K.z0]);
  rib([4.6, -U.z], [4.6, K.z0]);
  rib([-3.6, K.z1], [-3.6, U.z]);
  rib([4.2, K.z1], [4.2, U.z]);
  rib([-U.x, -2.6], [K.x0, -2.6]);
  // the south gallery: three cells against the outer wall, each with its doorway, and the passage past them
  parts.push({ t: 'wall', paint: 'base', low: true, name: 'cells', a: [-3, 7], b: [3.6, 7], y0: UF, top: U.roof, thick: 0.3, openings: [0, 1, 2].map((k) => ({ u0: 0.65 + k * 2.2, u1: 1.55 + k * 2.2, y0: UF, y1: UF + 2 })) });
  for (const x of [-3, -0.8, 1.4, 3.6]) lbox('base', x - 0.13, x + 0.13, UF, U.roof, 7.15, U.z, { name: 'cells' });
  // the north gallery: the cistern. A kerb to step over, and what water is left in it, dark and still
  for (const [x0, x1, z0, z1] of [[-2.3, 4.1, -6.95, -6.7], [-2.3, -2.05, -U.z, -6.95], [3.85, 4.1, -U.z, -6.95]]) lbox('base', x0, x1, UF, UF + 0.26, z0, z1, { name: 'cistern kerb' });
  lbox('iron', -2.05, 3.85, UF + 0.02, UF + 0.05, -U.z, -6.95, { name: 'water', body: 'none' });
  // the west gallery: the stone of its fallen bay, lying as it fell (seen from the terrace through the hole it left)
  parts.push({ t: 'mound', paint: 'scree', name: 'fallen vault', kind: 'vault', x0: -U.x - 0.2, x1: K.x0 + 0.1, z0: U.bay.z0 - 0.7, z1: U.bay.z1 + 0.9, cell: 0.3 });
  for (let k = 0; k < 7; k++) {
    const x = -U.x + 0.35 + hash(k, 1, 501) * 1.4, z = U.bay.z0 + 0.9 + hash(k, 2, 501) * 3.6;
    lump(x, moundTop('vault', x, z) + 0.05, z, 0.24 + hash(k, 3, 501) * 0.2, 0.1, 0.2 + hash(k, 4, 501) * 0.16, 510 + k, { paint: 'stone', blocky: true, name: 'fallen stone', body: 'none' });
  }
  // the east gallery: the stair down to the passage out, in a slot along the outer wall, railed on the gallery's side
  flight([(PS.x0 + PS.x1) / 2, PS.deep, PS.foot], [(PS.x0 + PS.x1) / 2, UF, PS.head], PS.x1 - PS.x0, { paint: 'base', name: 'stair to the passage out', low: true });
  lbox('base', PS.x0 - 0.25, PS.x0, PS.deep - 0.3, UF - 0.5, PS.head, PS.end + 0.25, { name: 'passage stair wall' });
  lbox('base', PS.x1, PS.x1 + 0.25, PS.deep - 0.3, UF, PS.head, POSTERN.z - 0.75, { name: 'passage stair wall' });
  lbox('base', PS.x1, PS.x1 + 0.25, PS.deep - 0.3, UF, POSTERN.z + 0.75, PS.end + 0.25, { name: 'passage stair wall' });
  lbox('base', PS.x1, PS.x1 + 0.25, PS.deep + U.hatch.tall, UF, POSTERN.z - 0.75, POSTERN.z + 0.75, { name: 'passage stair wall' });
  lbox('base', PS.x0 - 0.25, PS.x1 + 0.25, PS.deep - 0.3, UF, PS.end, PS.end + 0.25, { name: 'passage stair wall' });
  lbox('base', PS.x0, PS.x1, PS.deep - 0.3, PS.deep, PS.foot, PS.end, { name: 'passage landing' });
  parts.push({ t: 'rail', paint: 'timber', body: 'feet', low: true, a: [PS.x0, UF, PS.head + 0.3], b: [PS.x0, UF, PS.end], name: 'passage stair rail' });
  parts.push({ t: 'rail', paint: 'timber', body: 'feet', low: true, a: [PS.x0, UF, PS.end], b: [PS.x1, UF, PS.end], name: 'passage stair rail' });
  // under the hole in the north-west tower's boards: what fell through, lying clear of the way from under the hole to the cellar's doorway
  for (const [dx, dz, r] of [[-0.45, -0.35, 0.5], [-0.35, 0.65, 0.36], [0.6, -0.6, 0.33]]) lump(-C.hx + dx, UF + 0.16, -C.hz + dz, r, 0.16, r * 0.8, 520 + Math.round(r * 100), { paint: 'timber', blocky: true, name: 'fallen boards', low: true });

  // ---- the leaning walls under it, tower to tower
  // (the two that meet at the hollow tower stop in the thickness of its wall: they do not go on through its cellar)
  const low = -C.deep, shy = 2.5;
  parts.push({ t: 'curtain', paint: 'base', at: 'both', name: 'north curtain', a: [-C.hx + shy, -ez], b: [C.hx, -ez], y0: low, lean: C.lean });
  parts.push({ t: 'curtain', paint: 'base', at: 'both', name: 'east curtain', a: [ex, -C.hz], b: [ex, C.hz], y0: low, lean: C.lean, sag: [UNDER.rent.z0 + C.hz, UNDER.rent.z1 + C.hz, UNDER.floor + 0.1] });
  parts.push({ t: 'curtain', paint: 'base', at: 'both', name: 'south curtain', a: [C.hx, ez], b: [-C.hx, ez], y0: low, lean: C.lean });
  parts.push({ t: 'curtain', paint: 'base', at: 'both', name: 'west curtain', a: [-ex, C.hz], b: [-ex, -C.hz + shy], y0: low, lean: C.lean });

  // ---- the parapet: a wall to the sill, a square port under every merlon, and the firing step along the inside of it
  type Side = 'n' | 's' | 'e' | 'w';
  /** a block said by how far along a wall it is (toward +x on the north and south walls, toward +z on the others), and how far out from the wall's middle line */
  const along = (side: Side, paint: Paint, u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, o: Partial<Box> = {}) => {
    if (side === 'n') box(paint, u0, u1, y0, y1, -C.hz - v1, -C.hz - v0, o);
    else if (side === 's') box(paint, u0, u1, y0, y1, C.hz + v0, C.hz + v1, o);
    else if (side === 'e') box(paint, C.hx + v0, C.hx + v1, y0, y1, u0, u1, o);
    else box(paint, -C.hx - v1, -C.hx - v0, y0, y1, u0, u1, o);
  };
  const T = C.tower, half = P.thick / 2, S = C.step;
  const first = -(P.n * P.merlon + (P.n - 1) * P.gap) / 2;
  /** what is left out of each wall: the gate and its two piers, the breach */
  const cuts: Record<Side, [number, number][]> = { n: [[C.breach.x0, C.breach.x1]], s: [], e: [[C.gate.z0 - 0.6, C.gate.z1 + 0.6], [UNDER.rent.z0, UNDER.rent.z1]], w: [] };
  /** where the firing step runs (not through the gate, the breach, or the foot of the scaffold) */
  const steps: Record<Side, [number, number][]> = { n: [[C.breach.x1 + 0.3, 6.4]], s: [[-0.2, 6.4]], e: [[-6.4, C.gate.z0 - 0.9], [C.gate.z1 + 0.9, UNDER.rent.z0 - 0.25]], w: [[-6.4, 6.4]] };
  // What is left of it. The real one's merlons are all there; ours is a ruin, and a ruin falls from the top down:
  // of every merlon, about half stand, a fifth are stumps and the rest are gone to the sill; and whole lengths of
  // the wall are down to a man's knee, where its stone lies on the paving under it and down the slope outside.
  // (Each length that is down opens a view out and a shot in: nobody behind it is covered standing.)
  /** the lengths of each wall's parapet that are down: [from, to along it, how low in the middle] */
  const DOWN: Record<Side, [number, number, number][]> = { n: [[C.breach.x1 - 0.2, 2.6, 0.4]], s: [[-6.4, -2.4, 0.8]], e: [[0.4, UNDER.rent.z0, 0.3], [UNDER.rent.z1, 7, 0.45]], w: [[-0.6, 5.5, 0.3]] };
  /** two merlons of each wall that do stand, whatever the rest have come to: no side of it is bare */
  const STANDS: Record<Side, number[]> = { n: [2, 6], s: [3, 5], e: [0, 4], w: [0, 1] };
  for (const side of ['n', 's', 'e', 'w'] as Side[]) {
    // (it runs a hand's breadth into the towers at each end)
    const end = (side === 'n' || side === 's' ? C.hx : C.hz) - T.r + 0.2, cut = cuts[side], seed = { n: 201, s: 202, e: 203, w: 204 }[side];
    const CELL = 0.25;
    /** how high it stands at a place along the wall */
    const topAt = (u: number, i: number) => {
      const k = Math.floor((u - first) / (P.merlon + P.gap)), merlon = k >= 0 && k < P.n && u - first - k * (P.merlon + P.gap) < P.merlon, fate = STANDS[side].includes(k) ? 0 : hash(k, seed, 1);
      let top = !merlon || fate > 0.72 ? P.sill : fate > 0.5 ? P.sill + 0.25 + hash(k, seed, 2) * 0.5 : P.top;
      for (const [a, b, lowTo] of DOWN[side]) {
        if (u <= a || u >= b) continue;
        const into = Math.min(1, (Math.min(u - a, b - u) / ((b - a) / 2)) * 1.7);
        top = Math.min(top, P.sill + 0.2 - (P.sill + 0.2 - lowTo) * into + (hash(i, seed, 3) - 0.5) * 0.3);
      }
      return Math.max(0.2, Math.round(top * 100) / 100);
    };
    const ports: [number, number][] = [];
    for (let k = 0; k < P.n; k++) ports.push([first + k * (P.merlon + P.gap) + P.merlon / 2 - P.port.w / 2, first + k * (P.merlon + P.gap) + P.merlon / 2 + P.port.w / 2]);
    for (const [a, b] of spans(-end, end, cut)) {
      // (said the way a wall is said: along it with the outside on the left. On the south and the west that is backward.)
      const back = side === 's' || side === 'w', i0 = Math.round((a + end) / CELL), i1 = Math.round((b + end) / CELL);
      const tops = Array.from({ length: i1 - i0 }, (_, i) => topAt(-end + (i0 + i + 0.5) * CELL, i0 + i));
      const at = (u: number): [number, number] => (side === 'n' ? [u, -C.hz] : side === 's' ? [u, C.hz] : side === 'e' ? [C.hx, u] : [-C.hx, u]);
      const openings = ports.filter(([p, q]) => p > a + 0.1 && q < b - 0.1).map(([p, q]) => ({ u0: back ? b - q : p - a, u1: back ? b - p : q - a, y0: P.port.y0, y1: P.port.y1 }));
      parts.push({ t: 'wall', paint: 'stone', at: 'both', name: `${side} parapet`, a: at(back ? b : a), b: at(back ? a : b), y0: 0, top: back ? tops.reverse() : tops, thick: P.thick, openings });
    }
    for (const [a, b] of steps[side]) {
      along(side, 'stone', a, b, -half - S.top, -half, 0, S.h, { name: `${side} firing step`, tone: 0.92 });
      along(side, 'stone', a, b, -half - S.top - S.tread, -half - S.top, 0, S.h / 2, { name: `${side} firing step`, tone: 0.92 });
      // what is walked on going up to it: one slope from the paving to its edge, as under any stair
      const lip = half + S.top, toe = lip + 2 * S.tread;
      const at = (u: number, v: number, y: number): V3 => (side === 'n' ? [u, y, -C.hz + v] : side === 's' ? [u, y, C.hz - v] : side === 'e' ? [C.hx - v, y, u] : [-C.hx + v, y, u]);
      parts.push({ t: 'slab', paint: 'stone', hidden: true, body: 'feet', name: `${side} firing step`, p: [at(a, toe, 0), at(b, toe, 0), at(b, lip, S.h), at(a, lip, S.h)], thick: 0.08 });
    }
    // the stone of each length that is down: flat on the paving inside (low enough to be walked over), and tumbled outside
    for (const [a, b] of DOWN[side]) for (let k = 0; k < 5; k++) {
      const u = a + ((k + 0.5) / 5) * (b - a) + (hash(k, seed, 5) - 0.5) * 0.4, inside = k % 2 === 0, v = inside ? -(half + S.top + 2 * S.tread + 0.5 + hash(k, seed, 6) * 0.9) : half + 0.5 + hash(k, seed, 6) * 1.6;
      const [x, z] = side === 'n' ? [u, -C.hz - v] : side === 's' ? [u, C.hz + v] : side === 'e' ? [C.hx + v, u] : [-C.hx - v, u];
      // (none inside along the west wall, where the vault fell in; and none in the way to a tower's door)
      if (inside && (side === 'w' || Math.abs(u) > 5.5)) continue;
      if (inside) lump(x, 0.11, z, 0.3 + hash(k, seed, 7) * 0.22, 0.11, 0.22 + hash(k, seed, 8) * 0.14, 400 + seed + k, { paint: 'stone', blocky: true, name: 'fallen stone' });
      else lump(x, 0.25, z, 0.45 + hash(k, seed, 7) * 0.45, 0.36, 0.36 + hash(k, seed, 8) * 0.3, 400 + seed + k, { paint: 'stone', blocky: true, sits: [x, z], name: 'fallen stone', body: 'none' });
    }
  }
  // the gate: a pier each side of it, a head taller than the merlons
  for (const [a, b] of [[C.gate.z0 - 0.6, C.gate.z0], [C.gate.z1, C.gate.z1 + 0.6]]) along('e', 'stone', a, b, -half - 0.1, half + 0.1, 0, P.top + 0.4, { name: 'gate pier', at: 'both' });
  // and one leaf of the gate that hung there, pushed back against the wall inside and left
  beam([C.hx - 0.5, 1.02, C.gate.z1 + 0.75], [C.hx - 0.5, 1.02, C.gate.z1 + 2.95], 0.09, 2.0, { name: 'gate leaf', body: 'all' });
  // the breach: the stumps of the wall at each end of it
  along('n', 'stone', C.breach.x0, C.breach.x0 + 0.35, -half, half, 0, 1.0, { name: 'breach stump' });
  along('n', 'stone', C.breach.x1 - 0.3, C.breach.x1, -half, half, 0, 0.75, { name: 'breach stump' });

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
  parts.push({ t: 'slab', paint: 'timber', at: 'both', name: 'ramp', p: [[ex - 0.4, 0, gz0], [rx, ry, gz0], [rx, ry, gz1], [ex - 0.4, 0, gz1]], thick: 0.12 });
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
  lump(C.breach.x1 + 0.9, 0.36, -8.1, 0.62, 0.36, 0.4, 71, { paint: 'stone', blocky: true, name: 'fallen merlon' });
  lump(C.breach.x0 - 0.6, 0.33, -9.0, 0.55, 0.33, 0.42, 72, { paint: 'stone', blocky: true, name: 'fallen merlon' });

  // ---- what stands in the rooms, made of boards: tables, benches, a rack, bunks. (What is kept on each is in `castleLoot`.)
  for (const f of FURNITURE) {
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw), at = (lx: number, lz: number): [number, number] => [f.x + lx * c + lz * s, f.z - lx * s + lz * c];
    const slab = (y0: number, y1: number, hw: number, hd: number) => box('timber', f.x - hw, f.x + hw, f.y + y0, f.y + y1, f.z - hd, f.z + hd, { yaw: f.yaw, name: f.kind, body: y1 - y0 > 0.2 ? 'none' : 'all' });
    const leg = (lx: number, lz: number, h: number) => {
      const [px, pz] = at(lx, lz);
      beam([px, f.y, pz], [px, f.y + h, pz], 0.07, 0.07, { name: f.kind });
    };
    if (f.kind === 'table') {
      slab(0.74, 0.8, f.w / 2, f.d / 2);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(sx * (f.w / 2 - 0.1), sz * (f.d / 2 - 0.1), 0.74);
      box('timber', f.x - f.w / 2, f.x + f.w / 2, f.y, f.y + 0.8, f.z - f.d / 2, f.z + f.d / 2, { yaw: f.yaw, hidden: true, name: f.kind });
    } else if (f.kind === 'bench') {
      slab(0.4, 0.45, f.w / 2, f.d / 2);
      for (const sx of [-1, 1]) leg(sx * (f.w / 2 - 0.12), 0, 0.4);
      box('timber', f.x - f.w / 2, f.x + f.w / 2, f.y, f.y + 0.45, f.z - f.d / 2, f.z + f.d / 2, { yaw: f.yaw, hidden: true, name: f.kind });
    } else if (f.kind === 'bunk') {
      for (const y of [0.4, 1.3]) slab(y, y + 0.06, f.w / 2, f.d / 2);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(sx * (f.w / 2 - 0.05), sz * (f.d / 2 - 0.05), 1.75);
      box('timber', f.x - f.w / 2, f.x + f.w / 2, f.y, f.y + 1.36, f.z - f.d / 2, f.z + f.d / 2, { yaw: f.yaw, hidden: true, name: f.kind });
    } else {
      // a rack: two uprights and three shelves between them, a board at its back
      for (const y of [0.35, 0.95, 1.55]) slab(y, y + 0.045, f.w / 2, f.d / 2);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(sx * (f.w / 2 - 0.04), sz * (f.d / 2 - 0.04), 1.9);
      box('timber', f.x - f.w / 2, f.x + f.w / 2, f.y, f.y + 1.9, f.z - f.d / 2, f.z + f.d / 2, { yaw: f.yaw, hidden: true, name: f.kind });
    }
  }

  // ---- a basket of iron for a fire at each place a light is kept, on a post or on a bracket from the wall
  // (six bars between a hoop at its lip and a smaller one at its foot, and a plate under the fire; on three legs
  // where it stands on a floor, and on a chain where it hangs. The fire in it is the game's own: see CastleSite.)
  for (const [x, z, y, post] of LAMPS) {
    const lip = y - 0.04, foot = y - 0.32, at = (k: number, r: number, h: number): V3 => [x + Math.cos((k * Math.PI) / 3) * r, h, z + Math.sin((k * Math.PI) / 3) * r];
    const iron = { paint: 'iron' as Paint, name: 'cresset' };
    for (let k = 0; k < 6; k++) {
      beam(at(k, 0.1, foot), at(k, 0.17, lip), 0.022, 0.022, iron);
      beam(at(k, 0.17, lip), at(k + 1, 0.17, lip), 0.022, 0.03, iron);
      beam(at(k, 0.1, foot), at(k + 1, 0.1, foot), 0.02, 0.025, iron);
    }
    box('iron', x - 0.09, x + 0.09, foot - 0.015, foot, z - 0.09, z + 0.09, { name: 'cresset', body: 'none' });
    if (post) {
      for (const k of [0.5, 2.5, 4.5]) beam(at(k, 0.34, y - post), at(k, 0.07, foot), 0.035, 0.035, iron);
      box('iron', x - 0.07, x + 0.07, y - post, foot, z - 0.07, z + 0.07, { hidden: true, name: 'cresset' });
    } else beam([x, lip, z], [x, lip + 0.55, z], 0.015, 0.015, iron);
  }

  return parts;
}

// ------------------------------------------------------------------ what stands in it

/** what is made of boards for the rooms: where its middle is on the floor, which way it is turned, and its size */
export const FURNITURE: { kind: 'table' | 'bench' | 'bunk' | 'rack'; x: number; z: number; y: number; yaw: number; w: number; d: number }[] = [
  // the hall: a long table and its benches, a rack by the door
  { kind: 'table', x: 0.3, z: -0.4, y: 3, yaw: 0, w: 2.4, d: 0.9 },
  { kind: 'bench', x: 0.3, z: -1.25, y: 3, yaw: 0, w: 2.2, d: 0.32 },
  { kind: 'bench', x: 0.3, z: 0.45, y: 3, yaw: 0, w: 2.2, d: 0.32 },
  { kind: 'rack', x: 2.52, z: 2.2, y: 3, yaw: Math.PI / 2, w: 1.5, d: 0.45 },
  // the upper room: where they slept, and where the guns were kept
  { kind: 'bunk', x: -3.2, z: -1.6, y: 5.85, yaw: Math.PI / 2, w: 1.95, d: 0.9 },
  { kind: 'rack', x: 2.52, z: -0.6, y: 5.85, yaw: Math.PI / 2, w: 1.7, d: 0.45 },
  { kind: 'table', x: 0.4, z: 0.3, y: 5.85, yaw: Math.PI / 2, w: 1.6, d: 0.8 },
  // the chamber under the store: a rack against its west wall, a table under the lamp
  { kind: 'rack', x: -3.42, z: 0.9, y: UNDER.floor, yaw: Math.PI / 2, w: 1.7, d: 0.45 },
  { kind: 'table', x: -0.1, z: 2.3, y: UNDER.floor, yaw: 0, w: 1.4, d: 0.8 },
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
  // under the terrace: one in the chamber under the store, one where the east gallery meets the south. The rest of it is dark.
  [-0.1, 2.2, UNDER.floor + 2.25, 0],
  [6.6, 5.6, UNDER.floor + 2.2, 0],
];

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
  { kind: 'house', n: 0, x: 47, z: 2.5, rot: 0.14 }, { kind: 'house', n: 1, x: 58.5, z: -5.5, rot: -0.2 }, { kind: 'house', n: 2, x: 69, z: 3, rot: 0.1 }, { kind: 'house', n: 3, x: 80, z: -5, rot: -0.08 }, { kind: 'house', n: 4, x: 91, z: 2.5, rot: 0.22 },
  // the curved wall by the rock: what held the path up, on the side the ground falls away; and the thin wall down the south slope
  { kind: 'curved wall', n: 0, x: 20.5, z: -2, rot: 0 },
  { kind: 'long wall', n: 0, x: 22.6, z: 23.4, rot: 0 },
  // the storm-cellar hatch the passage from under the fort comes up at: in the lee of the rock the ramp leaves from,
  // inside the curve of the old wall, out of sight of the gate and under the eye of the south-east tower. (It is not
  // turned by whoever sets it down: it faces away from the fort, whose passage comes straight to it.)
  { kind: 'hatch', n: 0, x: 21.5, z: 5.6, rot: 0 },
  // grey teeth of rock, clear of the ways people go
  ...([[27.5, -6.2], [30.5, 3.2], [34, -7.5], [37.5, 2.6], [40.5, -6.8], [44, -9.5], [52.5, 7.5], [63.5, -1.5], [74.5, 8.2], [85.5, 0.5], [97, -4], [16.5, -13.5], [15.8, 9.5], [-15.5, -12.5], [-16.5, 6.5], [-20, -4], [-24.5, -9], [-27, 2.5], [-32, -6.5], [-36.5, -1]] as [number, number][]).map(([x, z], n): Loose => ({ kind: 'rock', n, x, z, rot: n * 1.7 })),
];

/** The pieces a loose piece is made of, where it stands (in the fort's own measure: each of them on the ground at its own spot). */
/**
 * The hatch and the passage to it, as plain figures: where its steps begin (at the ground) and end, where the
 * passage ends under the fort, how the whole of it runs, and how deep. `g`: the ground at the hatch, over the terrace.
 */
export function hatchLine(l: { x: number; z: number }, g: number) {
  const H = UNDER.hatch, dx = POSTERN.x - l.x, dz = POSTERN.z - l.z, far = Math.hypot(dx, dz), d: [number, number] = [dx / far, dz / far];
  return {
    /** the way it runs, from the hatch toward the fort, and the way across it */
    d, r: [d[1], -d[0]] as [number, number],
    /** the head of its steps, at the ground; their foot; and the passage's end under the fort */
    head: [l.x - d[0] * 0.3, g, l.z - d[1] * 0.3] as V3,
    foot: [l.x + d[0] * (H.run - 0.3), g - H.drop, l.z + d[1] * (H.run - 0.3)] as V3,
    end: [POSTERN.x, POSTERN.y, POSTERN.z] as V3,
    /** how long the passage is, and how steep (rise over run, up toward the fort) */
    long: far - H.run + 0.3, steep: (POSTERN.y - (g - H.drop)) / Math.max(1, far - H.run + 0.3),
  };
}

/** The stairwell of a hatch on the plan: its four corners [x, z], in order round it (the hole in the ground, kerb and all). */
export function hatchWell(l: { x: number; z: number }, g: number): [number, number][] {
  const H = UNDER.hatch, L = hatchLine(l, g), w = H.wide / 2 + 0.3;
  const at = (along: number, across: number): [number, number] => [L.head[0] + L.d[0] * along + L.r[0] * across, L.head[2] + L.d[1] * along + L.r[1] * across];
  return [at(-0.02, -w), at(H.run + 0.65, -w), at(H.run + 0.65, w), at(-0.02, w)];
}

/** @param g the ground where the piece stands, over the terrace (asked for the hatch, whose passage is made to its depth: the others stand on the ground piece by piece) */
export function looseParts(l: Loose, g = castleGround(l.x, l.z)): Part[] {
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
    // its two cheeks, a hand over the ground at the head of the steps and knee high at the back, and the wall across the back
    for (const side of [-1, 1]) parts.push({ t: 'wall', paint: 'stone', tone: 0.9, name: 'hatch kerb', a: flat(side > 0 ? L.head : back, side * (w + 0.15)), b: flat(side > 0 ? back : L.head, side * (w + 0.15)), y0: g - H.drop - 0.3, top: (side > 0 ? [0.14, 0.3, 0.46, 0.62, 0.78] : [0.78, 0.62, 0.46, 0.3, 0.14]).map((t) => g + t), thick: 0.3 });
    parts.push({ t: 'wall', paint: 'stone', tone: 0.9, name: 'hatch kerb', a: flat(back, w + 0.3), b: flat(back, -w - 0.3), y0: g - H.drop + H.tall, top: g + 0.8, thick: 0.3 });
    // the leaf that was thrown back, lying on the ground beside it; and the one that fell in, on the steps
    const mid: V3 = [(L.head[0] + L.foot[0]) / 2, g, (L.head[2] + L.foot[2]) / 2];
    parts.push({ t: 'slab', paint: 'timber', tone: 0.8, body: 'none', name: 'hatch leaf', p: [at(L.head, w + 0.45, 0.1), at(back, w + 0.45, 0.16), at(back, w + 1.15, 0.07), at(L.head, w + 1.15, 0.05)], thick: 0.05 });
    parts.push({ t: 'slab', paint: 'timber', tone: 0.75, body: 'none', name: 'hatch leaf', p: [at(mid, -w + 0.05, -H.drop / 2 + 0.2), at(L.foot, -w + 0.08, 0.22), at(L.foot, -0.05, 0.4), at(mid, 0.02, -H.drop / 2 + 0.38)], thick: 0.05 });
    // the ground's own earth, laid round it: the hole the world cuts for the steps is bigger than they are, and
    // this covers it, level at the stairwell's edge and coming to the ground as it is at its own rim
    const well = hatchWell(l, g);
    parts.push({ t: 'apron', paint: 'earth', name: 'hatch apron', inner: well.map(([x, z]): V3 => [x, g, z]) as [V3, V3, V3, V3], reach: H.lid });
    // the passage: a floor, a roof and two walls, from the foot of the steps to the stair under the fort
    const from: V3 = [L.foot[0] - L.d[0] * 0.2, L.foot[1], L.foot[2] - L.d[1] * 0.2], to: V3 = [L.end[0] + L.d[0] * 0.1, L.end[1], L.end[2] + L.d[1] * 0.1], o = { paint: 'base' as Paint, roofed: true, tone: 0.8 };
    parts.push({ t: 'slab', ...o, name: 'passage floor', p: [at(from, -w), at(to, -w), at(to, w), at(from, w)], thick: 0.3 });
    const mouth: V3 = [L.foot[0] + L.d[0] * 0.35, L.foot[1], L.foot[2] + L.d[1] * 0.35];
    parts.push({ t: 'slab', ...o, name: 'passage roof', p: [at(mouth, -w, H.tall + 0.3), at(to, -w, H.tall + 0.3), at(to, w, H.tall + 0.3), at(mouth, w, H.tall + 0.3)], thick: 0.3 });
    const lo = Math.min(from[1], to[1]) - 0.3, hi = Math.max(from[1], to[1]) + H.tall + 0.3;
    for (const side of [-1, 1]) parts.push({ t: 'wall', ...o, name: 'passage wall', a: flat(side > 0 ? from : to, side * (w + 0.125)), b: flat(side > 0 ? to : from, side * (w + 0.125)), y0: lo, top: hi, thick: 0.25 });
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
 * @param ground the height of the world's ground at a spot (the passage is made to the hatch's depth)
 */
export function castleUnder(p: Place | null, wx: number, wy: number, wz: number, ground?: GroundAt, loose?: Loose[]): boolean {
  if (!p) return false;
  const [x, z, y] = castleLocal(p, wx, wy, wz), U = UNDER;
  if (y < -0.6 && y > U.postern.deep - 1 && Math.abs(x) < U.x + 0.7 && Math.abs(z) < U.z + 0.7) return true;
  if (inCellar(x, y, z)) return true;
  for (const l of looseLocal(p, loose ?? castleLoose(p))) {
    if (l.kind !== 'hatch') continue;
    const [hx, , hz] = castleAt(p, l.x, l.z), g = (ground ? ground(hx, hz) : p.y + castleGround(l.x, l.z)) - p.y, L = hatchLine(l, g);
    // (how far along the way from the head of the steps to the passage's end, and how far off it)
    const ax = x - L.head[0], az = z - L.head[2], along = ax * L.d[0] + az * L.d[1], off = Math.abs(ax * L.r[0] + az * L.r[1]), all = L.long + U.hatch.run;
    if (along > -0.5 && along < all + 1.5 && off < U.hatch.wide / 2 + 0.9 && y < g + 0.6 && y > Math.min(L.foot[1], L.end[1]) - 1) return true;
  }
  return false;
}

/**
 * How dark it is at a place for being under the fort: 0 in the open and anywhere above, 1 in the lower levels and
 * the passage, and less than that near where the day gets in (the fallen bay most of all; the stair from the store,
 * the gratings and the hole in the tower a little; the hatch's steps). As the bunker's is: whoever draws the world
 * puts out so much of the sun and the sky for an eye that is there.
 */
export function castleDark(p: Place | null, wx: number, wy: number, wz: number, ground?: GroundAt, loose?: Loose[]): number {
  if (!p || !castleUnder(p, wx, wy, wz, ground, loose)) return 0;
  const [x, z, y] = castleLocal(p, wx, wy, wz), U = UNDER, B = U.bay;
  if ((Math.abs(x) > U.x + 0.7 || Math.abs(z) > U.z + 0.7) && !inCellar(x, y, z)) {
    // in the passage: dark, but for the last of it under the hatch
    let near = Infinity;
    for (const l of looseLocal(p, loose ?? castleLoose(p))) if (l.kind === 'hatch') near = Math.min(near, Math.hypot(x - l.x, z - l.z));
    return clamp01((near - 1.5) / 5);
  }
  const deep = clamp01((-y - 0.8) / 1.4), off = (x0: number, x1: number, z0: number, z1: number) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
  let lit = 1 - clamp01(off(B.x0, B.x1, B.z0, B.z1) / 6);
  lit = Math.max(lit, 0.45 * (1 - clamp01(off(U.stair.head, U.stair.open, U.stair.z - 0.5, U.stair.z + 0.5) / 3.5)));
  lit = Math.max(lit, 1 - clamp01(off(U.x - 0.5, U.x + 2, U.rent.z0, U.rent.z1) / 6));
  for (const [gx, gz] of U.gratings) lit = Math.max(lit, 0.3 * (1 - clamp01(Math.hypot(x - gx, z - gz) / 2.5)));
  lit = Math.max(lit, 0.35 * (1 - clamp01(Math.hypot(x + CASTLE.hx, z + CASTLE.hz) / 3)));
  return deep * (1 - 0.8 * lit);
}

/**
 * What whoever shapes the mountain must do to the ground for the fort, and nothing else of the ground is touched.
 * For each hatch, one thing: the ground LOWERED to `to` or under at every corner of every square of its grid that
 * the stairwell's rectangle (`well`: its four corners in the world, [x, z]) touches, so that no ground, drawn or
 * solid, is left in the stairwell. (`ground` here is the ground as it was BEFORE that: the hatch stands at the
 * height it had.) Nothing is levelled. The earth the hatch lays round itself (drawn with the ground's own paint,
 * `UNDER.hatch.lid` out from the stairwell, which is as far as lowering those corners can disturb ground of
 * two-metre squares) covers what was lowered and comes to the ground as it is at its rim.
 *
 * The lower levels themselves stand over the ground and need nothing cut: only that the ground under the terrace,
 * inside the walls, is nowhere higher than the foot the fort assumes (`CASTLE.foot`: 5.8 m under the terrace at
 * the least), which is over a metre under the cellars' floor. The passage runs under the ground and needs nothing
 * cut either: only that the ground over its line is nowhere lower than a metre and a half under the hatch's own.
 */
export function castleCuts(p: Place, ground?: GroundAt, loose?: Loose[]): { well: [number, number][]; to: number }[] {
  return looseLocal(p, loose ?? castleLoose(p)).filter((l) => l.kind === 'hatch').map((l) => {
    const [hx, , hz] = castleAt(p, l.x, l.z), gw = ground ? ground(hx, hz) : p.y + castleGround(l.x, l.z);
    return { well: hatchWell(l, gw - p.y).map(([x, z]): [number, number] => [castleAt(p, x, z)[0], castleAt(p, x, z)[2]]), to: gw - UNDER.hatch.drop - 0.6 };
  });
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

/** The loose pieces as the world has them: where each stands in the world, when nobody has said otherwise. */
export function castleLoose(p: Place): Loose[] {
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
export const CASTLE_TIERS = { grounds: 2, fort: 3, high: 4 } as const;
/** what is of the high step: whatever lies under the terrace; and above it, only what is said to be (the rack of guns, the wall top) */
const high = (y: number, top = false) => (y < -0.5 || top ? CASTLE_TIERS.high : CASTLE_TIERS.fort);
export type CastleUsage = 'Military' | 'Hunting';
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
function lootSpots(loose: Loose[]): { x: number; z: number; y: number; floor: boolean; usage: CastleUsage[]; tier: 2 | 3 | 4; on?: number; arms?: 'guns'; sits?: [number, number] }[] {
  const C = CASTLE, T = C.tower, out: ReturnType<typeof lootSpots> = [];
  const army: CastleUsage[] = ['Military'], hunt: CastleUsage[] = ['Hunting'];
  // on the furniture: along the top of each table, on a rack's middle shelf, on a bunk's lower bed
  FURNITURE.forEach((f, on) => {
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    const put = (lx: number, y: number, o: { arms?: 'guns' } = {}) => out.push({ x: f.x + lx * c, z: f.z - lx * s, y: f.y + y, floor: false, usage: army, tier: high(f.y, !!o.arms || (f.kind === 'rack' && f.y > 5)), on, ...o });
    if (f.kind === 'table') for (const lx of f.w > 2 ? [-0.75, 0, 0.75] : [-0.45, 0.45]) put(lx, 0.8);
    else if (f.kind === 'rack') {
      put(-0.4, 0.995, f.y > 5 ? { arms: 'guns' } : {});
      put(0.4, 0.995);
    } else if (f.kind === 'bunk') put(0, 0.46);
  });
  const fl = (x: number, z: number, y: number, top = false) => out.push({ x, z, y, floor: true, usage: army, tier: high(y, top) });
  // under the terrace: the chamber, the three cells, the cistern's end, the cellar under the tower, the landing of the passage out
  const UF = UNDER.floor;
  fl(-2.4, 2.6, UF);
  fl(0.2, -0.9, UF);
  for (const x of [-1.9, 0.3, 2.9]) fl(x, 7.75, UF);
  fl(-3.4, -7.4, UF);
  fl(-C.hx - 0.9, -C.hz + 0.9, UF);
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
      out.push({ x, z, y: 0.02, floor: true, usage: hunt, tier: CASTLE_TIERS.grounds, sits: [x, z] });
    }
  });
  return out;
}

/** where a thing off the shelf stands: [what, x, z, y, which way it is turned]. Crates and cases are searched, as they are anywhere. */
const STOOD: [string, number, number, number, number][] = [
  // the store: what an army left, and what was put by since
  ['wooden_military_crate', -1.2, 3.02, 0, 0], ['wooden_military_crate', 2.1, 2.95, 0, 0], ['wooden_crate_01', 2.15, 2.9, 0.46, -0.2],
  ['barrel_03', -0.7, -1.9, 0, 0], ['barrel_03', 0, -1.92, 0, 1], ['barrel_03', 2.35, 0.9, 0, 2],
  // the chamber under the store, and the cells: what was worth keeping under a stone roof
  ['weapons_case', -3.1, -1.6, UNDER.floor, Math.PI / 2], ['old_military_crate', 1.9, 2.7, UNDER.floor, 0], ['wooden_military_crate', 2.5, 7.75, UNDER.floor, 0],
  // the upper room
  ['weapons_case', 0.2, -1.0, 5.85, 0.1],
  // the hall: a long case against its north wall
  ['old_military_crate', 1.75, -2.85, 3, 0],
  // the roof: something to kneel behind
  ['wooden_crate_01', -2.9, -0.4, CASTLE.keep.roof, 1.4], ['wooden_crate_01', 2.3, -1.2, CASTLE.keep.roof, 0.4],
  // inside the gate: drums of fuel dragged across it, which did not stop anybody (and which a shot sets off: whoever
  // comes in by the gate comes in past them), and what else was to hand
  ['Barrel_01', 7.75, -4.6, 0, 0], ['Barrel_01', 8.1, -4.0, 0, 2], ['wooden_crate_01', 8.0, 0.2, 0, 0.3], ['wooden_crate_01', 7.5, 2.3, 0, 0.1], ['wooden_crate_01', 7.45, 2.35, 0.35, 0.6],
  // a fire on the north side of the terrace, out of the wind off the gate
  ['stone_fire_pit', 4.6, -7.75, 0.19, 0],
];
/** and in the ruined houses, each on the ground where it is: a fire in the second there is, a crate in the fourth: [what, which house, across it, along it, turned] */
const STOOD_OUT: [string, number, number, number, number][] = [['stone_fire_pit', 1, -0.6, 0.3, 0], ['wooden_crate_01', 3, 2.2, -1.6, 0.8]];
const houses = (loose: Loose[]) => loose.filter((l) => l.kind === 'house');

/** the ground at a spot of the world, for whoever stands a thing on it: the world's own, where there is one; else what the fort assumes */
export type GroundAt = (wx: number, wz: number) => number;
const assumed = (p: Place): GroundAt => (wx, wz) => {
  const [x, z] = castleLocal(p, wx, 0, wz);
  return p.y + castleGround(x, z);
};

/**
 * Every place a thing can lie, as places in the world. The same on the server and in every game: it is all in
 * the plan. @param ground the height of the world's ground at a spot (the ruined houses stand on it as it is)
 */
export function castleLoot(p: Place, ground: GroundAt = assumed(p), loose: Loose[] = castleLoose(p)): CastleLoot[] {
  // (what lies down there is found by a torch: 'Military' still, and of the high step)
  return lootSpots(looseLocal(p, loose)).map((s) => {
    let [x, y, z] = castleAt(p, s.x, s.z, s.y);
    if (s.sits) y = ground(x, z) + s.y;
    const f = s.on === undefined ? null : FURNITURE[s.on];
    [x, y, z] = [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(z * 1000) / 1000];
    return {
      x, y: y + (s.floor ? 0.02 : 0.003), z, usage: s.usage, building: 'castle', floor: s.floor, tier: s.tier,
      ...(s.arms ? { arms: s.arms } : {}),
      ...(f ? { surf: { x: castleAt(p, f.x, f.z)[0], z: castleAt(p, f.x, f.z)[2], rot: p.rot + f.yaw, hx: f.w / 2 - 0.08, hz: f.d / 2 - 0.06, clear: f.kind === 'table' ? 10 : 0.5 } } : {}),
    };
  });
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
  return out;
}

/** Where its lights are, as places in the world. */
export function castleLamps(p: Place): V3[] {
  return LAMPS.map(([x, z, y]) => castleAt(p, x, z, y));
}

/**
 * Where the infected of the place live. They have the ruined village, and they have the lower levels, where it is
 * dark (three of them, in the galleries); they do not have the terrace, the keep, the towers or the roof, which are
 * for whoever holds the fort and whoever comes to take it.
 */
export function castleHomes(p: Place, loose: Loose[] = castleLoose(p)): { x: number; z: number; r: number; n: number; inside?: V3[] }[] {
  // (they have the dark under the terrace: the cistern, the passage by the cells, the east gallery)
  const UF = UNDER.floor, hs = houses(loose), store = { x: p.x, z: p.z, r: 9, n: 3, inside: [castleAt(p, 0.8, -6.1, UF), castleAt(p, -2.2, 6.2, UF), castleAt(p, 6.2, 0.8, UF), castleAt(p, -7.1, -4.2, UF)] };
  if (!hs.length) return [store];
  const vx = hs.reduce((t, h) => t + h.x, 0) / hs.length, vz = hs.reduce((t, h) => t + h.z, 0) / hs.length;
  return [{ x: vx, z: vz, r: Math.max(12, ...hs.map((h) => Math.hypot(h.x - vx, h.z - vz) + 8)), n: Math.min(5, hs.length) }, store];
}
