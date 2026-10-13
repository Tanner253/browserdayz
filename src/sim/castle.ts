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
  /** the keep: its outside, the room inside its walls, its floors, its roof, the top of the wall round the roof, and the shell that is left of the storey over that */
  keep: { x0: -6.1, x1: 5.2, z0: -5.5, z1: 5.5, room: { x0: -3.7, x1: 2.8, z0: -3.4, z1: 3.4 }, floors: [0, 3, 5.85], roof: 8.7, band: 9.54, skin: 0.6 },
  /** the ground at the foot of each wall, under the terrace: what the real one measures */
  foot: { east: -5.8, west: -6.1, north: -7.3, south: -8 },
  /** how far off its smoke, lamps and shots matter: the whole of it and its grounds, from its middle */
  reach: 105,
};

export type V3 = [number, number, number];
/** what a part is made of: rubble limestone, the keep's squared blocks, paving, old timber, iron, living rock, loose stone */
export type Paint = 'stone' | 'ashlar' | 'paving' | 'timber' | 'iron' | 'rock' | 'scree';
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
export interface Opening { u0: number; u1: number; y0: number; y1: number; arch?: boolean }
/**
 * A wall that stands straight: along the ground from `a` to `b` (its middle line; the outside is on the left of
 * somebody walking it), from `y0` up to `top` (one height, or one for each of so many equal lengths of it, which
 * is a broken top), with openings said by how far along it they are.
 */
export interface Wall extends Common { t: 'wall'; a: [number, number]; b: [number, number]; y0: number; top: number | number[]; thick: number; openings?: Opening[] }
/** a wall that leans: its face only, from the line `a` to `b` at the terrace down to `y0`, out by a metre for every `lean` down */
export interface Curtain extends Common { t: 'curtain'; a: [number, number]; b: [number, number]; y0: number; lean: number }
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
  /** the stair round the inside of its wall: where it leaves the floor, and how far round it goes to the platform (degrees, signed) */
  stair: { from: number; sweep: number };
  /** the part of the way round that is open over the head of the stair: [from, to] in degrees, the way the stair goes */
  well: [number, number];
}
/** ground that is made: the rock the ramp starts from, the rubble under the breach. Its height is `moundTop`. */
export interface Mound extends Common { t: 'mound'; kind: 'outcrop' | 'fan'; x0: number; x1: number; z0: number; z1: number; cell: number }
/** a rock, or a fallen block: where its middle is, half its size each way, and the number it is shaped from */
export interface Lump extends Common { t: 'lump'; x: number; y: number; z: number; rx: number; ry: number; rz: number; seed: number; blocky?: boolean }
export type Part = Box | Slab | Beam | Rail | Flight | Wall | Curtain | Tower | Mound | Lump;

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
  if (y < -0.5 || y > 16) return false;
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
export const FAN = { foot: 6.5, head: -3.6, wide: 2.6, end: -6.6 };
const northFace = (y: number) => -CASTLE.hz - CASTLE.parapet.thick / 2 + Math.min(0, y) / CASTLE.lean;

/**
 * How high made ground stands at a spot, over the terrace. The rock: a level top where the ramp lands, a cliff to
 * the west of it (the ramp crosses that), steep sides, and a way up it from the east that a body can walk. The
 * rubble: a slope leant against the north wall that climbs along it from east to west and comes level with the
 * terrace under the breach.
 */
export function moundTop(kind: 'outcrop' | 'fan', x: number, z: number): number {
  if (kind === 'outcrop') {
    const O = OUTCROP;
    const west = Math.max(0, O.x0 - x), side = Math.max(0, O.z0 - z, z - O.z1), east = Math.max(0, x - O.x1);
    // (the way up from the east: a tongue of rock three metres wide, thirty degrees; off it the rock falls away)
    const off = Math.max(0, Math.abs(z - O.path) - 1.6) * smooth(0, 2, east);
    const fell = west * 2.3 + side * 1.9 + east * 0.6 + off * 1.3;
    const wild = (rough(x * 0.9, z * 0.9, 5) - 0.5) * Math.min(0.9, 0.08 + (west + side + off) * 0.5);
    return O.top - fell + wild;
  }
  const F = FAN, s = clamp01((F.foot - x) / (F.foot - F.head));
  let y = CASTLE.foot.north * (1 - s);
  // (past its foot and past its head it runs out)
  if (x > F.foot) y -= (x - F.foot) * 0.9;
  if (x < F.end) y -= (F.end - x) * 1.3;
  const edge = northFace(y) - F.wide, past = Math.max(0, edge - z);
  // (never quite level with the terrace: its head is a step under the paving it leads onto)
  return Math.min(-0.06, y - past * 1.05 + (rough(x * 1.7, z * 1.7, 9) - 0.5) * Math.min(0.5, 0.07 + past * 0.4));
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
/** how far round its stair a direction is, 0..1 from the floor to the platform (null: the stair does not pass there) */
export function stairShare(tw: Tower, a: number): number | null {
  const d = norm((a - tw.stair.from) * Math.sign(tw.stair.sweep));
  return d <= Math.abs(tw.stair.sweep) ? d / Math.abs(tw.stair.sweep) : null;
}

function tower(name: string, cx: number, cz: number, foot: number, rim: number, door: number, from: number, sweep: number, looks: number[], seed: number): Tower {
  const T = CASTLE.tower, tops: number[] = [];
  for (let k = 0; k < T.slots; k++) {
    const mid = (k + 0.5) * (360 / T.slots), toDoor = Math.abs(norm(mid - door + 180) - 180);
    // what is left of its battlement: a stub, a gap a rifle is laid in, a stub; and all of it lower on the side it has fallen in on
    let top = k % 2 === 0 ? rim - hash(k, seed, 1) * 0.35 : T.deck + 1.1 + hash(k, seed, 2) * 0.15;
    if (k % 2 === 0 && hash(k, seed, 3) < 0.25) top = rim - 0.9;
    if (toDoor < 40) top = Math.min(top, T.deck + 0.75 + hash(k, seed, 4) * 0.5);
    tops.push(Math.round(top * 100) / 100);
  }
  const tw: Tower = { t: 'tower', paint: 'stone', at: 'both', name, cx, cz, foot, rim: tops, door, slits: [], stair: { from, sweep }, well: [from + sweep - Math.sign(sweep) * 140, from + sweep] };
  for (const a of looks) {
    // (a window the stair passes low in front of is put up beside the stair, and is shot from there; one the stair
    // passes high over, or does not pass, is at the floor)
    const share = stairShare(tw, a), h = share === null ? 99 : share * T.deck;
    tw.slits.push(h >= 2.6 ? { a, y0: 0.75, y1: 2.15 } : { a, y0: h + 0.8, y1: h + 2.2 });
  }
  return tw;
}

// ------------------------------------------------------------------ the whole of it, piece by piece

let made: Part[] | null = null;
/** Every piece of the fort and of its grounds. (Worked out once: it is the same every time.) */
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
  box('paving', -ex, ex, -1.2, 0, -ez, ez, { name: 'terrace', at: 'both' });

  // ---- the leaning walls under it, tower to tower
  const low = -C.deep;
  parts.push({ t: 'curtain', paint: 'stone', at: 'both', name: 'north curtain', a: [-C.hx, -ez], b: [C.hx, -ez], y0: low, lean: C.lean });
  parts.push({ t: 'curtain', paint: 'stone', at: 'both', name: 'east curtain', a: [ex, -C.hz], b: [ex, C.hz], y0: low, lean: C.lean });
  parts.push({ t: 'curtain', paint: 'stone', at: 'both', name: 'south curtain', a: [C.hx, ez], b: [-C.hx, ez], y0: low, lean: C.lean });
  parts.push({ t: 'curtain', paint: 'stone', at: 'both', name: 'west curtain', a: [-ex, C.hz], b: [-ex, -C.hz], y0: low, lean: C.lean });

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
  const cuts: Record<Side, [number, number][]> = { n: [[C.breach.x0, C.breach.x1]], s: [], e: [[C.gate.z0 - 0.6, C.gate.z1 + 0.6]], w: [] };
  /** where the firing step runs (not through the gate, the breach, or the foot of the scaffold) */
  const steps: Record<Side, [number, number][]> = { n: [[C.breach.x1 + 0.3, 6.4]], s: [[-0.2, 6.4]], e: [[-6.4, C.gate.z0 - 0.9], [C.gate.z1 + 0.9, 6.4]], w: [[-6.4, 6.4]] };
  for (const side of ['n', 's', 'e', 'w'] as Side[]) {
    // (it runs a hand's breadth into the towers at each end)
    const end = (side === 'n' || side === 's' ? C.hx : C.hz) - T.r + 0.2, cut = cuts[side];
    const ports: [number, number][] = [];
    for (let k = 0; k < P.n; k++) {
      const mid = first + k * (P.merlon + P.gap) + P.merlon / 2;
      ports.push([mid - P.port.w / 2, mid + P.port.w / 2]);
      for (const [a, b] of spans(mid - P.merlon / 2, mid + P.merlon / 2, cut)) if (b - a > 0.5) along(side, 'stone', a, b, -half, half, P.sill, P.top, { name: `${side} merlon`, at: 'both' });
    }
    for (const [a, b] of spans(-end, end, cut)) {
      along(side, 'stone', a, b, -half, half, 0, P.port.y0, { name: `${side} parapet` });
      along(side, 'stone', a, b, -half, half, P.port.y1, P.sill, { name: `${side} parapet` });
      for (const [p, q] of spans(a, b, ports)) along(side, 'stone', p, q, -half, half, P.port.y0, P.port.y1, { name: `${side} parapet` });
      // (from far off it is one wall: its ports are not seen)
      along(side, 'stone', a, b, -half, half, 0, P.sill, { name: `${side} parapet`, at: 'far', body: 'none' });
    }
    for (const [a, b] of steps[side]) {
      along(side, 'stone', a, b, -half - S.top, -half, 0, S.h, { name: `${side} firing step`, tone: 0.92 });
      along(side, 'stone', a, b, -half - S.top - S.tread, -half - S.top, 0, S.h / 2, { name: `${side} firing step`, tone: 0.92 });
      // what is walked on going up to it: one slope from the paving to its edge, as under any stair
      const lip = half + S.top, toe = lip + 2 * S.tread;
      const at = (u: number, v: number, y: number): V3 => (side === 'n' ? [u, y, -C.hz + v] : side === 's' ? [u, y, C.hz - v] : side === 'e' ? [C.hx - v, y, u] : [-C.hx + v, y, u]);
      parts.push({ t: 'slab', paint: 'stone', hidden: true, body: 'feet', name: `${side} firing step`, p: [at(a, toe, 0), at(b, toe, 0), at(b, lip, S.h), at(a, lip, S.h)], thick: 0.08 });
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
  parts.push(tower('north-east tower', C.hx, -C.hz, -17, 6.6, 135, 165, 300, [22.5, 67.5, 202.5], 11));
  parts.push(tower('south-east tower', C.hx, C.hz, -20, 6.3, 225, 195, -300, [337.5, 292.5, 157.5], 12));
  parts.push(tower('south-west tower', -C.hx, C.hz, -20, 7.2, 315, 345, 300, [22.5, 172.5, 247.5], 13));
  parts.push(tower('north-west tower', -C.hx, -C.hz, -17, 6.9, 45, 15, -300, [337.5, 187.5, 112.5], 14));

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
  face('keep north face', [K.x0, K.z0 + sk / 2], [K.x1, K.z0 + sk / 2], [13.9, 14.4, 14.1, 13.6, 13.8, 13.2, 12.6, 12.9, 11.8, 10.9, 10.4, 10.1, 10.5], [{ u0: 5.2, u1: 6, y0: 3.9, y1: 5.2, arch: true }]);
  // (the entrance face: the small door, the doorway over it, and the two arched windows of the storey that is gone)
  face('keep east face', [K.x1 - sk / 2, K.z0 + sk], [K.x1 - sk / 2, K.z1 - sk], [10.3, 11.2, 11.9, 11.9, 11.7, 11.2, 11.5, 11.9, 11.9, 11.6, 10.9], [
    { u0: 4.4, u1: 5.4, y0: 0, y1: 1.9 }, { u0: 4.4, u1: 5.4, y0: F1, y1: 5.2, arch: true },
    { u0: 2.25, u1: 3.15, y0: B + 0.85, y1: B + 2.0, arch: true }, { u0: 6.65, u1: 7.55, y0: B + 0.85, y1: B + 2.0, arch: true },
  ]);
  // (the south face: low on the entrance side, with a way through it where the scaffold comes up, and tall to the west)
  face('keep south face', [K.x1, K.z1 - sk / 2], [K.x0, K.z1 - sk / 2], [10.5, 10.1, 10.6, 10.2, 10.4, 10.6, B, B, 11.4, 12.2, 12.8, 12.4, 13.1], [{ u0: 2.7, u1: 3.5, y0: 6.75, y1: 8.05, arch: true }]);
  // (the west face: the tallest of what is left)
  face('keep west face', [K.x0 + sk / 2, K.z1 - sk], [K.x0 + sk / 2, K.z0 + sk], [13.3, 12.7, 13.4, 13.8, 13.1, 13.6, 14.1, 13.7, 14.2, 13.9, 14.3], [
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
  mass('south', K.x0 + sk, K.x1 - sk, (u0, u1, y0, y1) => box('stone', u0, u1, y0, y1, R.z1, K.z1 - sk, { ...inner, name: 'keep south wall' }), [[1.4, 2.8, F2, 8.05]]);
  mass('east', R.z0, R.z1, (u0, u1, y0, y1) => box('stone', R.x1, K.x1 - sk, y0, y1, u0, u1, { ...inner, name: 'keep east wall' }), [[-0.5, 0.5, 0, 1.9], [-0.5, 0.5, F1, 5.2]]);
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
  const hall = 2.6 - opens(3.75, F1, F1 - 0.2), upper = -2.2 + opens(3.6, F2 - F1, F2 - F1 - 0.2), hatch = -1.7 + opens(3.6, K.roof - F2, K.roof - F2 - 0.35);
  floor('timber', F1, 0.2, [R.x0, R.x0 + 1, -1.15, hall], 'keep first floor');
  floor('timber', F2, 0.2, [upper, 1.4, R.z1 - 1, R.z1], 'keep second floor');
  floor('paving', K.roof, 0.35, [hatch, 1.9, R.z0, R.z0 + 1], 'keep roof');
  // the three flights, one to a storey, each along a different wall: nobody on one floor has the next stair at his back
  flight([R.x0 + 0.5, 0, 2.6], [R.x0 + 0.5, F1, -1.15], 1, { name: 'keep stair to the hall' });
  flight([-2.2, F1, R.z1 - 0.5], [1.4, F2, R.z1 - 0.5], 1, { name: 'keep stair to the upper room' });
  flight([-1.7, F2, R.z0 + 0.5], [1.9, K.roof, R.z0 + 0.5], 1, { name: 'keep stair to the roof' });
  // a rail round each hole, on the floor it is a hole in, as far along it as the stair's own rail has not yet come up
  // through the floor; and one up the open side of each flight
  rail([R.x0 + 1, F1, 0], [R.x0 + 1, F1, hall]);
  rail([R.x0 + 1, F1, hall], [R.x0, F1, hall]);
  rail([upper, F2, R.z1 - 1], [0.5, F2, R.z1 - 1]);
  rail([upper, F2, R.z1 - 1], [upper, F2, R.z1]);
  rail([hatch, K.roof, R.z0 + 1], [1, K.roof, R.z0 + 1]);
  rail([hatch, K.roof, R.z0 + 1], [hatch, K.roof, R.z0]);
  rail([R.x0 + 1, 0, 2.6], [R.x0 + 1, F1, -1.15]);
  rail([-2.2, F1, R.z1 - 1], [1.4, F2, R.z1 - 1]);
  rail([-1.7, F2, R.z0 + 1], [1.9, K.roof, R.z0 + 1]);
  // the roof: the slab between the walls, and the walls' own tops a pace higher all round it, with stone steps up to them
  flight([1.9, K.roof, 1.9], [R.x1, B, 1.9], 1.3, { paint: 'stone', name: 'roof steps east' });
  flight([-0.5, K.roof, 2.5], [-0.5, B, R.z1], 1.3, { paint: 'stone', name: 'roof steps south' });

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
  parts.push({ t: 'mound', paint: 'rock', at: 'both', name: 'outcrop', kind: 'outcrop', x0: 13.5, x1: 32, z0: -9.5, z1: 6.5, cell: 0.5 });
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
  for (const [x, z, y, post] of LAMPS) {
    box('iron', x - 0.13, x + 0.13, y - 0.28, y - 0.05, z - 0.13, z + 0.13, { name: 'cresset', body: 'none' });
    if (post) beam([x, y - post, z], [x, y - 0.28, z], 0.09, 0.09, { name: 'cresset post', body: 'all' });
  }

  // ---- the grounds: what is left of the village along the crest to the east, a wall by the rock, one down the south slope, and the rock's teeth
  for (const [k, sh] of SHELLS.entries()) {
    const c = Math.cos(sh.yaw), s = Math.sin(sh.yaw), w = sh.w / 2, d = sh.d / 2;
    const at = (lx: number, lz: number): [number, number] => [sh.x + lx * c + lz * s, sh.z - lx * s + lz * c];
    const sits: [number, number] = [sh.x, sh.z], name = `ruined house ${k + 1}`, o = { paint: 'stone' as Paint, tone: 0.9, sits, name, thick: 0.6, y0: -2.2, at: 'both' as const };
    /** a long wall's broken top, and a gable's: up to five metres in the middle of it, and never whole */
    const long = (seed: number) => Array.from({ length: 9 }, (_, i) => Math.round((0.7 + hash(i, seed, 21 + k) * 2.3) * 10) / 10);
    const gable = (seed: number) => Array.from({ length: 7 }, (_, i) => Math.round(Math.max(0.6, (2.4 + (1 - Math.abs(i - 3) / 3.5) * 2.6) * (hash(i, seed, 23 + k) < 0.25 ? 0.45 : 0.82 + hash(i, seed, 24 + k) * 0.18)) * 10) / 10);
    const door = { u0: sh.w * 0.4, u1: sh.w * 0.4 + 1.2, y0: -2.3, y1: 9 };
    parts.push({ t: 'wall', ...o, a: at(-w, -d + 0.3), b: at(w, -d + 0.3), top: long(1), openings: sh.door < 0 ? [door] : [{ u0: 2, u1: 2.9, y0: 0.9, y1: 2, arch: false }] });
    parts.push({ t: 'wall', ...o, a: at(w, d - 0.3), b: at(-w, d - 0.3), top: long(2), openings: sh.door > 0 ? [door] : [{ u0: 5.6, u1: 6.5, y0: 0.9, y1: 2, arch: false }] });
    parts.push({ t: 'wall', ...o, a: at(w - 0.3, -d + 0.6), b: at(w - 0.3, d - 0.6), top: gable(3) });
    parts.push({ t: 'wall', ...o, a: at(-w + 0.3, d - 0.6), b: at(-w + 0.3, -d + 0.6), top: gable(4) });
    // (stones of it, lying inside)
    for (let i = 0; i < 3; i++) {
      const [px, pz] = at((hash(i, k, 31) - 0.5) * (sh.w - 3), (hash(i, k, 32) - 0.5) * (sh.d - 3));
      lump(px, 0.12, pz, 0.28 + hash(i, k, 33) * 0.25, 0.2, 0.3, 80 + k * 5 + i, { paint: 'stone', blocky: true, sits: [px, pz], name: 'fallen block' });
    }
  }
  // the curved wall by the rock: what held the path up, on the side the ground falls away
  for (let k = 0; k < 4; k++) {
    const pt = (a: number): [number, number] => [20.5 + Math.cos((a * Math.PI) / 180) * 9.4, -2 + Math.sin((a * Math.PI) / 180) * 9.4];
    const a = pt(98 - k * 21), b = pt(98 - (k + 1) * 21);
    parts.push({ t: 'wall', paint: 'stone', tone: 0.85, at: 'both', name: 'curved wall', a, b, y0: -2, top: [1.1 + hash(k, 1, 41) * 1.3, 0.7 + hash(k, 2, 41) * 1.6, 1.2 + hash(k, 3, 41) * 1.1], thick: 0.7, sits: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
  }
  // the thin wall down the south slope, sixteen metres of it, in lengths that step down with the ground
  for (let k = 0; k < 7; k++) {
    const z0 = 15 + k * 2.4, z1 = z0 + 2.4;
    if (k === 3) continue;
    parts.push({ t: 'wall', paint: 'stone', tone: 0.85, at: 'both', name: 'wall down the slope', a: [22.6, z1], b: [22.6, z0], y0: -2.5, top: [1.2 + hash(k, 1, 43) * 1.4, 1.6 + hash(k, 2, 43) * 1.2], thick: 0.55, sits: [22.6, (z0 + z1) / 2] });
  }
  // grey teeth of rock along the crest, clear of the ways people go
  for (const [x, z, r, h] of TEETH) lump(x, h * 0.25, z, r, h, r * (0.7 + hash(Math.round(x), Math.round(z), 51) * 0.5), Math.round(x * 7 + z * 13), { sits: [x, z], at: 'both', name: 'rock tooth' });
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
  { kind: 'bunk', x: -3.2, z: -2.3, y: 5.85, yaw: Math.PI / 2, w: 1.95, d: 0.9 },
  { kind: 'bunk', x: -3.2, z: 2.2, y: 5.85, yaw: Math.PI / 2, w: 1.95, d: 0.9 },
  { kind: 'rack', x: 2.52, z: -0.6, y: 5.85, yaw: Math.PI / 2, w: 1.7, d: 0.45 },
  { kind: 'table', x: 0.4, z: 0.3, y: 5.85, yaw: Math.PI / 2, w: 1.6, d: 0.8 },
  // the store under the hall
  { kind: 'rack', x: 2.52, z: -2.2, y: 0, yaw: Math.PI / 2, w: 1.8, d: 0.45 },
  { kind: 'table', x: 0.6, z: 2.75, y: 0, yaw: 0, w: 1.8, d: 0.8 },
  // on the terrace by the fire, and in the lee of the keep
  { kind: 'bench', x: 3.2, z: -5.75, y: 0, yaw: 0, w: 2, d: 0.34 },
  { kind: 'table', x: -7.1, z: -1.5, y: 0, yaw: Math.PI / 2, w: 1.8, d: 0.8 },
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
  // by the fire on the north side of the terrace, and at the foot of the scaffold
  [5.6, -8.2, 2.3, 2.3],
  [-7.4, 8, 2.3, 2.3],
];

/** what is left of the village: where each house stood along the crest, how it is turned, its size, and which long side its door was on */
export const SHELLS: { x: number; z: number; yaw: number; w: number; d: number; door: number }[] = [
  { x: 47, z: 2.5, yaw: 0.14, w: 9, d: 7, door: -1 },
  { x: 58.5, z: -5.5, yaw: -0.2, w: 8.4, d: 6.6, door: 1 },
  { x: 69, z: 3, yaw: 0.1, w: 9.2, d: 7, door: -1 },
  { x: 80, z: -5, yaw: -0.08, w: 9, d: 7.2, door: 1 },
  { x: 91, z: 2.5, yaw: 0.22, w: 8.6, d: 6.8, door: -1 },
];

/** the rocks along the crest: [x, z, half its width, its height] */
export const TEETH: [number, number, number, number][] = [
  [27.5, -6.2, 1.1, 1.5], [30.5, 3.2, 1.4, 1.2], [34, -7.5, 0.9, 1.1], [37.5, 2.6, 1.2, 1.6], [40.5, -6.8, 1.5, 1.3], [44, -9.5, 1.0, 0.9],
  [52.5, 7.5, 1.3, 1.2], [63.5, -1.5, 0.9, 1.0], [74.5, 8.2, 1.2, 1.4], [85.5, 0.5, 1.0, 0.9], [97, -4, 1.4, 1.3],
  [16.5, -13.5, 1.2, 1.3], [15.8, 9.5, 1.0, 1.4], [-15.5, -12.5, 1.3, 1.5], [-16.5, 6.5, 1.1, 1.2], [-20, -4, 1.5, 1.8], [-24.5, -9, 1.0, 1.1],
  [-27, 2.5, 1.3, 1.0], [-32, -6.5, 1.6, 1.9], [-36.5, -1, 0.9, 1.0], [-41, -9.5, 1.2, 1.4], [-46, -3.5, 1.4, 1.2], [-52, -8, 1.0, 1.5], [-58, -2.5, 1.5, 1.3],
];

/** what is found in the fort and its grounds is of the map's fourth step: a rifleman's place, hard to come at and seen from everywhere */
export const CASTLE_TIER = 4;
export type CastleUsage = 'Military' | 'Hunting';
export interface CastleLoot {
  x: number;
  y: number;
  z: number;
  usage: CastleUsage[];
  building: string;
  floor: boolean;
  tier: typeof CASTLE_TIER;
  /** kept stocked with a gun (the rack in the upper room) */
  arms?: 'guns';
  surf?: { x: number; z: number; rot: number; hx: number; hz: number; clear: number };
}

/** where things lie, in the fort's own measure: [x, z, y, on the floor, what kind of place, on which piece of furniture (its place in FURNITURE)] */
function lootSpots(): { x: number; z: number; y: number; floor: boolean; usage: CastleUsage[]; on?: number; arms?: 'guns'; sits?: [number, number] }[] {
  const C = CASTLE, T = C.tower, out: ReturnType<typeof lootSpots> = [];
  const army: CastleUsage[] = ['Military'], hunt: CastleUsage[] = ['Hunting'];
  // on the furniture: along the top of each table, on a rack's middle shelf, on a bunk's lower bed
  FURNITURE.forEach((f, on) => {
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    const put = (lx: number, y: number, o: { arms?: 'guns' } = {}) => out.push({ x: f.x + lx * c, z: f.z - lx * s, y: f.y + y, floor: false, usage: army, on, ...o });
    if (f.kind === 'table') for (const lx of f.w > 2 ? [-0.75, 0, 0.75] : [-0.45, 0.45]) put(lx, 0.8);
    else if (f.kind === 'rack') {
      put(-0.4, 0.995, f.y > 5 ? { arms: 'guns' } : {});
      put(0.4, 0.995);
    } else if (f.kind === 'bunk') put(0, 0.46);
  });
  const fl = (x: number, z: number, y: number, usage = army) => out.push({ x, z, y, floor: true, usage });
  // the store, the hall, the upper room and the roof: on the boards and the paving
  fl(-1.5, -2.6, 0);
  fl(1.4, 0.4, 0);
  fl(-0.6, 2.2, 0);
  fl(-1.2, -2.5, 3);
  fl(1.9, -2.2, 3);
  fl(-2.6, 0.2, 5.85);
  fl(1.6, 1.5, 5.85);
  fl(-2.8, 2.4, C.keep.roof);
  fl(2, 2.9, C.keep.roof);
  fl(3.7, -1, C.keep.band);
  // each tower: under the stair on its floor, and up on its platform
  for (const tw of castleParts()) {
    if (tw.t !== 'tower') continue;
    const back = ((tw.door + 180) * Math.PI) / 180;
    fl(tw.cx + Math.cos(back) * 0.5, tw.cz + Math.sin(back) * 0.5, 0);
    fl(tw.cx, tw.cz, T.deck);
  }
  // the terrace: by the fire, and behind the keep
  fl(4.6, -6.6, 0);
  fl(-7.6, 3.4, 0);
  fl(7.6, 4.2, 0);
  // the ruined houses: a hunter's leavings, one or two to a house
  SHELLS.forEach((sh, k) => {
    const c = Math.cos(sh.yaw), s = Math.sin(sh.yaw);
    for (const [lx, lz] of k % 2 ? [[-2.4, 1.2]] : [[2.2, -1.1], [-2.6, 1.4]]) {
      const x = sh.x + lx * c + lz * s, z = sh.z - lx * s + lz * c;
      out.push({ x, z, y: 0.02, floor: true, usage: hunt, sits: [x, z] });
    }
  });
  return out;
}

/** where a thing off the shelf stands: [what, x, z, y, which way it is turned]. Crates and cases are searched, as they are anywhere. */
const STOOD: [string, number, number, number, number][] = [
  // the store: what an army left, and what was put by since
  ['wooden_military_crate', -3.05, -2.5, 0, Math.PI / 2], ['wooden_military_crate', -1.6, 3.05, 0, 0], ['wooden_crate_01', 2.3, 2.9, 0, 0.3], ['wooden_crate_01', 2.25, 2.85, 0.35, -0.2],
  ['Barrel_01', -0.4, -3, 0, 0], ['Barrel_01', 0.3, -3.02, 0, 1], ['barrel_03', 2.35, 0.9, 0, 2],
  // the upper room
  ['weapons_case', 0.2, -2, 5.85, 0.1], ['old_military_crate', 2.1, 2.2, 5.85, Math.PI / 2],
  // the roof: something to kneel behind
  ['wooden_crate_01', -2.9, -0.4, CASTLE.keep.roof, 1.4], ['Barrel_01', 2.3, 0.6, CASTLE.keep.roof, 0],
  // inside the gate: what was dragged across it, and did not stop anybody
  ['Barrel_01', 8.2, -4.4, 0, 0], ['Barrel_01', 8.75, -4.1, 0, 2], ['wooden_crate_01', 8.3, 0.9, 0, 0.5], ['crate_big', 7.9, 2.1, 0, 0.2],
  // a fire on the north side of the terrace, out of the wind off the gate
  ['stone_fire_pit', 4.3, -7.4, 0.19, 0],
];
/** and out on the grounds, each on the ground where it is: a fire in the second house, a crate in the fourth */
const STOOD_OUT: [string, number, number, number][] = [['stone_fire_pit', SHELLS[1].x - 0.6, SHELLS[1].z + 0.3, 0], ['wooden_crate_01', SHELLS[3].x + 2.2, SHELLS[3].z - 1.6, 0.8]];

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
export function castleLoot(p: Place, ground: GroundAt = assumed(p)): CastleLoot[] {
  return lootSpots().map((s) => {
    let [x, y, z] = castleAt(p, s.x, s.z, s.y);
    if (s.sits) y = ground(x, z) + s.y;
    const f = s.on === undefined ? null : FURNITURE[s.on];
    [x, y, z] = [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(z * 1000) / 1000];
    return {
      x, y: y + (s.floor ? 0.02 : 0.003), z, usage: s.usage, building: 'castle', floor: s.floor, tier: CASTLE_TIER,
      ...(s.arms ? { arms: s.arms } : {}),
      ...(f ? { surf: { x: castleAt(p, f.x, f.z)[0], z: castleAt(p, f.x, f.z)[2], rot: p.rot + f.yaw, hx: f.w / 2 - 0.08, hz: f.d / 2 - 0.06, clear: f.kind === 'table' ? 10 : 0.5 } } : {}),
    };
  });
}

/** What stands in it off the shelf, as the world's own list of such things has them. */
export function castleProps(p: Place, ground: GroundAt = assumed(p)): { kind: string; x: number; y: number; z: number; rot: number; scale: number; far?: number }[] {
  const out = STOOD.map(([kind, lx, lz, ly, rot]) => {
    const [x, y, z] = castleAt(p, lx, lz, ly);
    return { kind, x, y, z, rot: p.rot + rot, scale: 1, far: kind === 'stone_fire_pit' ? 140 : 90 };
  });
  for (const [kind, lx, lz, rot] of STOOD_OUT) {
    const [x, , z] = castleAt(p, lx, lz);
    out.push({ kind, x, y: ground(x, z) + (kind === 'stone_fire_pit' ? 0.19 : 0), z, rot: p.rot + rot, scale: 1, far: 140 });
  }
  return out;
}

/** Where its lights are, as places in the world. */
export function castleLamps(p: Place): V3[] {
  return LAMPS.map(([x, z, y]) => castleAt(p, x, z, y));
}

/**
 * Where the infected of the place live. They have the ruined village and the crest east of the rock, and they have
 * the store under the hall, where it is dark; they do not have the terrace, the towers or the roof, which are for
 * whoever holds the fort and whoever comes to take it.
 */
export function castleHomes(p: Place): { x: number; z: number; r: number; n: number; inside?: V3[] }[] {
  const [vx, , vz] = castleAt(p, 68, -1);
  return [{ x: vx, z: vz, r: 30, n: 5 }, { x: p.x, z: p.z, r: 6, n: 2, inside: [castleAt(p, -1.2, 0.6, 0), castleAt(p, 1.3, -1.6, 0), castleAt(p, -0.4, 2, 0)] }];
}
