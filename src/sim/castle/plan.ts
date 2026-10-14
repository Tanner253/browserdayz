// The fort's plan, its measures and words: where everything of it is (CASTLE, UNDER), what a part is, how its own measure is turned into the world's, its ground and its towers' girth.
// (One part of castle.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import type { Place } from '../bunker';
import { KIT_TOWER } from '../kit';

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

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

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

export const hash = (i: number, j: number, s: number) => {
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

export const northFace = (y: number) => -CASTLE.hz - CASTLE.parapet.thick / 2 + Math.min(0, y) / CASTLE.lean;

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
export function tower(name: string, cx: number, cz: number, foot: number, rim: number, door: number, sweep: number, looks: number[], seed: number, fallen?: [number, number], stump?: { toward: number; low: number; high: number }): Tower {
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
