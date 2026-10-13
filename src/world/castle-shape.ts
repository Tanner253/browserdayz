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

import { clipOut, cutPoly, inCut, kitBlocks, kitMatrix, kitPoint, kitSolids, KIT_TOWER } from '../sim/kit';
import { CASTLE, LOOSE, UNDER, castleGround, castleKit, castleParts, hatchLine, looseParts, moundTop, rough, towerRadius, type Apron, type Beam, type Body, type Box, type Vault, type Curtain, type Flight, type Loose, type Lump, type Mound, type Opening, type Paint, type Part, type Rail, type Slab, type Tower, type V3, type Wall } from '../sim/castle';

export type Quat = [number, number, number, number];
/** what a thing sounds like underfoot and when it is hit */
export type Surf = 'rock' | 'concrete' | 'wood' | 'metal';
/**
 * What stops a body: a block (its middle, half its size each way, how it is turned), a shape drawn tight round
 * some points, or ground given as heights on a grid (`heights[iz * (nx + 1) + ix]`). `feet`: it stops a body and
 * nothing else, as a stair and a rail do everywhere in the game.
 */
export type Solid =
  | { t: 'box'; c: V3; h: V3; q: Quat; feet: boolean; surface: Surf; name: string }
  | { t: 'hull'; pts: number[]; feet: boolean; surface: Surf; name: string }
  | { t: 'field'; x0: number; z0: number; nx: number; nz: number; cell: number; heights: Float32Array; surface: Surf; name: string };
/**
 * Triangles, three corners each: where, which way each faces, where on the picture, how light (red, green, blue),
 * and what the weather needs to know of it (`snow`, two numbers a corner: 1 if the sky is over it and 0 if a
 * floor, a roof or a tower's boards are; and how high it is over the foot of the wall or block it belongs to,
 * metres, 9 where that foot is not on a floor or the ground).
 */
export interface Skin { pos: number[]; nrm: number[]; uv: number[]; col: number[]; snow: number[] }
/** (`under`: what is of the lower levels, drawn only while somebody is near enough to see into them) */
export interface Shape { near: Record<Sheet, Skin>; under: Record<Sheet, Skin>; far: Skin; solids: Solid[] }

export const PAINTS: Paint[] = ['stone', 'ashlar', 'base', 'paving', 'timber', 'iron', 'rock', 'scree', 'earth', 'water'];
/** the things it is drawn in from near: every stuff that is of one picture is in one sheet, and a sheet is one thing to draw */
export type Sheet = 'stone' | 'base' | 'timber' | 'iron' | 'rock' | 'earth' | 'water';
export const SHEETS: Sheet[] = ['stone', 'base', 'timber', 'iron', 'rock', 'earth', 'water'];
/**
 * THE PICTURES: the ONE place they are chosen. A sheet is a picture set (its name is the set's name in the
 * manifest, public/assets/tex) and what is done to it to make it this stone (see `aged` in castle.ts):
 *   keep, lift, own, even   how much of the picture's own colour is kept, how far it is raised, the stone's own
 *                           colour, and how far the picture is drawn in toward that
 *   stones                  how many stones one turn of it has, across and up: no two are quite one tone ([0, 0]: none)
 * (Nothing is paler than mid-light grey: the game's noon sun on anything lighter is white, and a white wall has no
 * stones in it.) The two stone sets are Poly Haven's, CC0, fetched 2026-10-13 for this: `castle_wall_slates`, grey
 * coursed rubble in pale mortar, for everything that stands; `defense_wall`, dark small stone with lichen in it,
 * for the leaning bases, the cores of broken walls, the paving (it is a cobbled floor, seen from above), the
 * rubble, and all that is under the terrace. They are real stone and are left nearly as they came. (The third set
 * fetched, `medieval_blocks_06`, is warm travertine and is not used here.) Timber is the game's own
 * `weathered_planks`; the living rock is `aerial_rocks_02` with its moss greyed out; `earth` is whatever the
 * world's ground is drawn with, handed in by whoever stands the fort (and `rocks_ground_02` where nobody has).
 */
export const PICTURES: Record<Sheet, { tex: string | null; keep: number; lift: number; own: V3; even: number; stones: [number, number] }> = {
  stone: { tex: 'castle_wall_slates', keep: 0.42, lift: 0.8, own: [0.33, 0.33, 0.33], even: 0.12, stones: [7, 30] },
  base: { tex: 'defense_wall', keep: 0.8, lift: 1.5, own: [0.3, 0.3, 0.28], even: 0.12, stones: [0, 0] },
  timber: { tex: 'weathered_planks', keep: 0.8, lift: 1.7, own: [0.3, 0.24, 0.18], even: 0.3, stones: [8, 0] },
  iron: { tex: null, keep: 1, lift: 1, own: [0, 0, 0], even: 0, stones: [0, 0] },
  rock: { tex: 'aerial_rocks_02', keep: 0.3, lift: 0.8, own: [0.33, 0.33, 0.34], even: 0.3, stones: [0, 0] },
  earth: { tex: 'rocks_ground_02', keep: 1, lift: 1, own: [0.4, 0.36, 0.26], even: 0, stones: [0, 0] },
  // (the cistern's water has no picture: it is a dark sheet that the fires and the day shine in: see castle.ts)
  water: { tex: null, keep: 1, lift: 1, own: [0, 0, 0], even: 0, stones: [0, 0] },
};
/**
 * Each stuff: which sheet it is drawn in, how many metres one turn of the picture covers on it, and its own tone
 * beside the sheet's. (The keep is the walls' stone laid bigger and a shade paler: one picture, and not one wall.
 * The sets are 1024 dots a side: a turn of 2.6 m is a dot to 2.5 mm, which is as sharp as the game's other walls
 * at arm's length.)
 */
export const STUFF: Record<Paint, { sheet: Sheet; tile: number; tint: V3 }> = {
  stone: { sheet: 'stone', tile: 1.9, tint: [1, 1, 1] },
  ashlar: { sheet: 'stone', tile: 2.5, tint: [1.1, 1.09, 1.07] },
  base: { sheet: 'base', tile: 2.4, tint: [1, 1, 1] },
  paving: { sheet: 'stone', tile: 3.1, tint: [0.84, 0.84, 0.86] },
  scree: { sheet: 'base', tile: 3.2, tint: [1.3, 1.27, 1.2] },
  timber: { sheet: 'timber', tile: 1.6, tint: [1, 1, 1] },
  iron: { sheet: 'iron', tile: 1, tint: [1, 1, 1] },
  rock: { sheet: 'rock', tile: 4.5, tint: [1, 1, 1] },
  earth: { sheet: 'earth', tile: 5, tint: [1, 1, 1] },
  water: { sheet: 'water', tile: 1, tint: [1, 1, 1] },
};
/** metres to one turn of each picture */
export const TILE = Object.fromEntries(PAINTS.map((p) => [p, STUFF[p].tile])) as Record<Paint, number>;
/** from far off it is drawn with no picture at all (none is fetched for a fort nobody is near): the colour each stuff comes to */
const FAR_TINT: Record<Paint, V3> = { stone: [0.4, 0.385, 0.36], ashlar: [0.45, 0.43, 0.39], base: [0.26, 0.26, 0.245], paving: [0.31, 0.3, 0.28], timber: [0.2, 0.165, 0.13], iron: [0.05, 0.05, 0.05], rock: [0.4, 0.4, 0.4], scree: [0.33, 0.32, 0.3], earth: [0.4, 0.36, 0.26], water: [0.05, 0.06, 0.07] };
const SURF: Record<Paint, Surf> = { stone: 'concrete', ashlar: 'concrete', base: 'concrete', paving: 'concrete', timber: 'wood', iron: 'metal', rock: 'rock', scree: 'rock', earth: 'rock', water: 'rock' };

// ------------------------------------------------------------------ small sums

const UP: V3 = [0, 1, 0];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const rad = (deg: number) => (deg * Math.PI) / 180;
const norm360 = (a: number) => ((a % 360) + 360) % 360;
/** how far one direction is from another, degrees, 0..180 */
const apart = (a: number, b: number) => Math.abs(norm360(a - b + 180) - 180);
const hash = (i: number, j: number, s: number) => {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** numbers in order, with none twice */
const sorted = (xs: Iterable<number>, eps = 1e-4) => [...xs].sort((p, q) => p - q).filter((x, i, all) => i === 0 || x - all[i - 1] > eps);
/** what of the stretches `a` is in none of the stretches `b` */
const minus = (a: [number, number][], b: [number, number][]) => {
  const out: [number, number][] = [];
  for (const [lo, hi] of a) {
    let from = lo;
    for (const [p, q] of [...b].sort((m, n) => m[0] - n[0])) {
      if (q <= from || p >= hi) continue;
      if (p > from) out.push([from, p]);
      from = Math.max(from, q);
    }
    if (from < hi) out.push([from, hi]);
  }
  return out.filter(([p, q]) => q - p > 0.004);
};
/** How a thing is turned, from the three ways it lies (each of length one, square to one another, the third the first two's cross). */
export function quatOf(x: V3, y: V3, z: V3): Quat {
  const tr = x[0] + y[1] + z[2];
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4];
  }
  if (x[0] > y[1] && x[0] > z[2]) {
    const s = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2;
    return [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s];
  }
  if (y[1] > z[2]) {
    const s = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2;
    return [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s];
  }
  const s = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2;
  return [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s];
}
/** how much lighter the stone is toward the top of a wall: the foot of it is the weather side of a mountain */
const weather = (y: number) => 0.78 + 0.2 * Math.min(1, Math.max(0, 1 + y / 9));

/**
 * A slow unevenness through the air, 0..1, the same wherever it is asked: what makes one stretch of a wall a little
 * darker than the next, whichever way the wall faces. (A wall is one picture laid over and over; this is what
 * keeps the eye from finding where it comes round. It is put into the lightness of each corner, so a big flat
 * face is cut into pieces a pace or so across for it to show: see `quad`.)
 */
function clouds(p: V3): number {
  const at = (k: number, seed: number) => {
    const x = p[0] * k, y = p[1] * k, z = p[2] * k, i = Math.floor(x), j = Math.floor(y), l = Math.floor(z);
    const u = x - i, v = y - j, w = z - l, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v), c = w * w * (3 - 2 * w);
    const h = (di: number, dj: number, dl: number) => hash(i + di, (j + dj) * 57 + (l + dl) * 131, seed);
    const lo = (h(0, 0, 0) * (1 - a) + h(1, 0, 0) * a) * (1 - b) + (h(0, 1, 0) * (1 - a) + h(1, 1, 0) * a) * b;
    const hi = (h(0, 0, 1) * (1 - a) + h(1, 0, 1) * a) * (1 - b) + (h(0, 1, 1) * (1 - a) + h(1, 1, 1) * a) * b;
    return lo * (1 - c) + hi * c;
  };
  return at(0.42, 91) * 0.62 + at(1.15, 92) * 0.38;
}
/** how much of that there is on each stuff (the lightest of it over the darkest, less one) */
const MOTTLE: Record<Paint, number> = { stone: 0.36, ashlar: 0.36, base: 0.38, paving: 0.3, timber: 0.18, iron: 0, rock: 0.2, scree: 0.2, earth: 0, water: 0 };
/** a flat face is cut for it until no piece is longer than this: finely where the picture is plain (dressed blocks, paving), coarsely where it is busy; 0: not at all */
const PIECE: Record<Paint, number> = { stone: 2.3, ashlar: 2.3, base: 2.6, paving: 1.25, timber: 0, iron: 0, rock: 0, scree: 0, earth: 0, water: 0 };

/**
 * How far a point of the masonry stands off where the plan has it: a few centimetres, sideways, by a slow pattern.
 * Nothing a mason built eight hundred years ago is flat or plumb to the eye any more: a wall bellies, a tower is
 * not quite round. It goes by where the point is on the plan and by nothing else: so two faces that meet still
 * meet, and a wall's upright edges stay straight (its faces are cut into pieces of different heights side by side,
 * and a point half way up one piece's edge must stay on its neighbour's: moved by its height as well, every such
 * place opened as a crack). And never up or down: what is level to walk on stays level. (What stops a body is not
 * moved: it is the plan's.)
 */
function warp(p: V3, by: number): V3 {
  // (slow: a belly four or five metres long, which pieces of wall two metres long can follow; quicker than that and it is a wall of facets)
  const a = clouds([p[0] * 0.55 + 17, 0.5, p[2] * 0.55]) - 0.5, b = clouds([p[0] * 0.55, 41.5, p[2] * 0.55 + 9]) - 0.5;
  return [p[0] + a * 2.6 * by, p[1], p[2] + b * 2.6 * by];
}
/** how far, for each stuff, metres (none for what is sawn or forged, or is ground already) */
const WARP: Record<Paint, number> = { stone: 0.09, ashlar: 0.09, base: 0.1, paving: 0, timber: 0, iron: 0, rock: 0, scree: 0, earth: 0, water: 0 };

let towers: Tower[] | null = null;
/**
 * Whether the sky is over a place: 1 where snow can lie, 0 under the terrace, under the keep's roof (but not under
 * the corner of it that has fallen in) and under what is left of a tower's boards (but not in the well its stair
 * comes up through). Asked of a spot a hand's breadth off a face, the way the face looks.
 */
function sky(p: V3, n: V3): number {
  const x = p[0] + n[0] * 0.06, y = p[1] + n[1] * 0.06, z = p[2] + n[2] * 0.06, C = CASTLE, K = C.keep, T = C.tower;
  towers ??= castleParts().filter((q): q is Tower => q.t === 'tower');
  // (under the terrace, and in the foot of a tower: only where the vault fell in, and at the rent in the east wall)
  if (y < -0.04 && ((Math.abs(x) < C.hx + 0.3 && Math.abs(z) < C.hz + 0.3) || towers.some((tw) => Math.hypot(x - tw.cx, z - tw.cz) < towerRadius(y) - 0.02))) {
    const U = UNDER, D = U.cistern.drop, off = (x0: number, x1: number, z0: number, z1: number) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
    if ((x > U.bay.x0 - 0.2 && x < U.bay.x1 + 0.1 && z > U.bay.z0 && z < U.bay.z1) || (x > D.x0 && x < D.x1 && z > D.z0 && z < D.z1) || (x > U.x - 0.6 && z > U.rent.z0 && z < U.rent.z1)) return 1;
    // (under cover: what of the day comes in at each opening and is thrown about by the stone, less with every pace
    // from it: most under the holes in the terrace and at the rent, a little at the postern, the stair and the
    // gratings. Never as much as half: the snow knows by that what is under a roof.)
    const reach = (d: number, far: number, most: number) => most * Math.max(0, 1 - d / far) ** 1.6;
    let day = Math.max(reach(off(D.x0, D.x1, D.z0, D.z1), 9, 0.46), reach(off(U.bay.x0, U.crawl, U.bay.z0, U.bay.z1), 7.5, 0.46), reach(off(U.x - 0.2, U.x + 2, U.rent.z0, U.rent.z1), 7, 0.42), reach(off(-U.x - 1, -U.x, U.goat.z0, U.goat.z1), 4, 0.25), reach(off(U.stair.head, U.stair.open, U.stair.z - 0.5, U.stair.z + 0.5), 3, 0.16));
    for (const [gx, gz] of U.gratings) day = Math.max(day, reach(Math.hypot(x - gx, z - gz), 2.6, 0.2));
    return y < U.floor - 1 ? 0 : day;
  }
  if (x > K.x0 + 0.3 && x < K.x1 - 0.3 && z > K.z0 + 0.3 && z < K.z1 - 0.3 && y < K.roof - 0.2) {
    return x > K.fallen.x0 && z > K.fallen.z0 && y > K.floors[2] - 0.25 ? 1 : 0;
  }
  for (const tw of towers) {
    const dx = x - tw.cx, dz = z - tw.cz;
    if (dx * dx + dz * dz > (T.r - T.wall + 0.03) ** 2 || y > T.deck - 0.03 || y < -0.3) continue;
    const a = norm360((Math.atan2(dz, dx) * 180) / Math.PI), inWell = norm360((a - tw.well[0]) * Math.sign(tw.stair.sweep)) < Math.abs(tw.well[1] - tw.well[0]);
    return inWell || tw.rim[Math.floor(a / (360 / T.slots)) % T.slots] < T.deck ? 1 : 0;
  }
  return 1;
}

/** Whether the sky is over a place (see `sky`): for whoever lays snow on something of the fort that is not made here (the kit's walls). */
export const castleSky = (p: V3, n: V3): number => sky(p, n);

/**
 * How far a place on the terrace or on the keep's roof is from the nearest thing that stands on it (the parapet,
 * the keep, a tower; the wall round the roof), metres: snow lies deep against a wall and is blown and trodden thin
 * in the open. 9 anywhere else.
 */
function fromWall(p: V3): number {
  const C = CASTLE, K = C.keep, [x, y, z] = p;
  if (Math.abs(y - K.roof) < 0.05) return Math.max(0, Math.min(x - K.room.x0, K.room.x1 - x, z - K.room.z0, K.room.z1 - z));
  if (Math.abs(y) > 0.05 || Math.abs(x) > C.hx || Math.abs(z) > C.hz) return 9;
  const keep = Math.hypot(Math.max(K.x0 - x, 0, x - K.x1), Math.max(K.z0 - z, 0, z - K.z1));
  const tower = Math.hypot(Math.abs(x) - C.hx, Math.abs(z) - C.hz) - C.tower.r;
  // (the parapet is the kit's: a metre thick, its outer face where the fort's own was)
  return Math.max(0, Math.min(C.hx + C.parapet.thick / 2 - 1.06 - Math.abs(x), C.hz + C.parapet.thick / 2 - 1.06 - Math.abs(z), keep, tower));
}

type UV = [number, number];
/**
 * WHAT IS NEVER SEEN IS NOT DRAWN. The fort's own square blocks, as the rules say them (before the stone is bent):
 * a triangle that lies against one or inside one, with stone before it all the way across (asked at its middle and
 * toward each of its corners, a finger's breadth off its face), is left out: the end of a wall in another wall, the
 * foot of a block on the block under it, two floors edge to edge. No eye is ever in a block, so what one hides is
 * hidden from every eye. Two things are bent alike only if they are of stuffs bent by as much (see WARP): against
 * a block of another stuff a face is left out only where it is deep in it, further than the bending moves either.
 * `low`: the block is of the lower levels, which are not always drawn: it hides nothing that is drawn without them.
 */
interface Hide { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; by: number; low: boolean }
interface Hides { list: Hide[]; grid: Map<number, number[]>; count: number }
const HIDE_CELL = 2, hideKey = (x: number, z: number) => Math.floor(x / HIDE_CELL) * 4096 + Math.floor(z / HIDE_CELL);
function hidesOf(list: Hide[]): Hides {
  const grid = new Map<number, number[]>();
  list.forEach((b, i) => {
    for (let x = Math.floor(b.x0 / HIDE_CELL); x <= Math.floor(b.x1 / HIDE_CELL); x++) for (let z = Math.floor(b.z0 / HIDE_CELL); z <= Math.floor(b.z1 / HIDE_CELL); z++) {
      const k = x * 4096 + z, at = grid.get(k);
      if (at) at.push(i);
      else grid.set(k, [i]);
    }
  });
  return { list, grid, count: 0 };
}
/** Where triangles are put, for one stuff: it knows the size of that stuff's picture. */
class Out {
  /** @param mottle how much the tone wanders over it; @param cut big faces are cut into pieces no longer than this for that to show (0: they are not) */
  constructor(private s: Skin, private tile: number, private tint: V3, private mottle = 0, private cut = 0, private bent = 0, private hides: Hides | null = null, private low = false) {}
  /** whether a place has one of the fort's blocks all round it (see Hide) */
  private hid(q: V3): boolean {
    const H = this.hides!;
    for (const i of H.grid.get(hideKey(q[0], q[2])) ?? []) {
      const b = H.list[i], e = b.by === this.bent ? 0.004 : 0.26;
      if ((!b.low || this.low) && q[0] > b.x0 + e && q[0] < b.x1 - e && q[2] > b.z0 + e && q[2] < b.z1 - e && q[1] > b.y0 + 0.004 && q[1] < b.y1 - 0.004) return true;
    }
    return false;
  }
  /** the foot of what is being put now, if it stands on a floor or on the ground (null: it does not); and whether that is the ground */
  base: number | null = null;
  ground = false;
  /** what is being put now has a roof of its own over it */
  roofed = false;
  /** it is paving: a floor that is walked on */
  walked = false;
  private put(q: V3, n: V3, t: UV, tone: number) {
    // (snow drifts against the foot of a thing only where there is a floor for it to lie on: not at the foot of the
    // parapet's outer face, which is the top of the wall under it)
    const floor = this.ground || (Math.abs(q[0] + n[0] * 0.4) < CASTLE.hx + CASTLE.parapet.thick / 2 - 0.05 && Math.abs(q[2] + n[2] * 0.4) < CASTLE.hz + CASTLE.parapet.thick / 2 - 0.05);
    // (the second number: of an upright face, how high over its foot; of a floor that is walked on, how far from the nearest wall)
    this.s.snow.push(this.roofed ? 0 : sky(q, n), n[1] > 0.9 && this.walked ? fromWall(q) : this.base === null || !floor ? 9 : Math.max(0, q[1] - this.base));
    const k = tone * (this.mottle ? 1 - this.mottle / 2 + this.mottle * clouds(q) : 1), p = this.bent ? warp(q, this.bent) : q;
    this.s.pos.push(p[0], p[1], p[2]);
    this.s.nrm.push(n[0], n[1], n[2]);
    this.s.uv.push(t[0] / this.tile, t[1] / this.tile);
    this.s.col.push(this.tint[0] * k, this.tint[1] * k, this.tint[2] * k);
  }
  /**
   * A triangle, turned to face `out` whichever way round its corners were said. `t`: where each corner is on the
   * picture, in metres. `smooth`: the way each corner faces, where the thing is round and not flat.
   */
  tri(p: V3[], t: UV[], out: V3, tone: number | number[] = 1, smooth?: V3[]) {
    let g = cross(sub(p[1], p[0]), sub(p[2], p[0]));
    const twice = len(g);
    // (a triangle with no size: where an arch comes down to its jamb, or two cuts fall together)
    if (twice < 1e-7) return;
    let order = [0, 1, 2];
    if (dot(g, out) < 0) {
      order = [0, 2, 1];
      g = mul(g, -1);
    }
    const n = mul(g, 1 / twice);
    if (this.hides) {
      const mid: V3 = [(p[0][0] + p[1][0] + p[2][0]) / 3 + n[0] * 0.015, (p[0][1] + p[1][1] + p[2][1]) / 3 + n[1] * 0.015, (p[0][2] + p[1][2] + p[2][2]) / 3 + n[2] * 0.015];
      if (this.hid(mid) && p.every((c) => this.hid([mid[0] + (c[0] - mid[0]) * 0.85 + n[0] * 0.002, mid[1] + (c[1] - mid[1]) * 0.85 + n[1] * 0.002, mid[2] + (c[2] - mid[2]) * 0.85 + n[2] * 0.002]))) return void this.hides.count++;
    }
    for (const k of order) this.put(p[k], smooth ? smooth[k] : n, t[k], typeof tone === 'number' ? tone : tone[k]);
  }
  /** Four corners, in order round it. */
  quad(p: V3[], t: UV[], out: V3, tone: number | number[] = 1, smooth?: V3[], deep = 0): void {
    const e = len(sub(p[1], p[0])), f = len(sub(p[2], p[1]));
    if (this.cut && deep < 6 && Math.max(e, f) > this.cut) {
      // (in two across its longer way, and each half asked again)
      const [i0, i1, i2, i3] = e >= f ? [0, 1, 2, 3] : [1, 2, 3, 0], tones = typeof tone === 'number' ? [tone, tone, tone, tone] : tone;
      const mid = <T extends number[]>(a: T, b: T) => a.map((v, k) => (v + b[k]) / 2) as T, half = (a: number, b: number) => (a + b) / 2;
      const pa = mid(p[i0], p[i1]), pb = mid(p[i3], p[i2]), ta = mid(t[i0], t[i1]), tb = mid(t[i3], t[i2]);
      const na = smooth && unit(mid(smooth[i0], smooth[i1])), nb = smooth && unit(mid(smooth[i3], smooth[i2]));
      this.quad([p[i0], pa, pb, p[i3]], [t[i0], ta, tb, t[i3]], out, [tones[i0], half(tones[i0], tones[i1]), half(tones[i3], tones[i2]), tones[i3]], smooth && [smooth[i0], na!, nb!, smooth[i3]], deep + 1);
      this.quad([pa, p[i1], p[i2], pb], [ta, t[i1], t[i2], tb], out, [half(tones[i0], tones[i1]), tones[i1], tones[i2], half(tones[i3], tones[i2])], smooth && [na!, smooth[i1], smooth[i2], nb!], deep + 1);
      return;
    }
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) this.tri([p[a], p[b], p[c]], [t[a], t[b], t[c]], out, typeof tone === 'number' ? tone : [tone[a], tone[b], tone[c]], smooth && [smooth[a], smooth[b], smooth[c]]);
  }
}
const skin = (): Skin => ({ pos: [], nrm: [], uv: [], col: [], snow: [] });
/** where what is not seen is drawn */
const VOID = new Out(skin(), 1, [1, 1, 1]);
/** which way a picture of boards goes on a block: not at all (courses run level); along its length; across it */
type Grain = 0 | 1 | 2;

/** A block: its middle, the three ways it lies, half its size along each. */
function block(o: Out, c: V3, ax: V3[], h: V3, tone = 1, grain: Grain = 0) {
  if (o === VOID) return;
  const corner = (k: number[]): V3 => add(add(add(c, mul(ax[0], k[0] * h[0])), mul(ax[1], k[1] * h[1])), mul(ax[2], k[2] * h[2]));
  for (let f = 0; f < 3; f++) {
    let iu = (f + 1) % 3, iv = (f + 2) % 3;
    // (the picture's own up is the way that is nearer upright; of a board, the way the board runs)
    const turn = grain === 1 ? h[iu] > h[iv] : grain === 2 ? h[iu] < h[iv] : Math.abs(ax[iu][1]) > Math.abs(ax[iv][1]);
    if (turn) [iu, iv] = [iv, iu];
    for (const s of [-1, 1]) {
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
        const k = [0, 0, 0];
        k[f] = s;
        k[iu] = a;
        k[iv] = b;
        return corner(k);
      });
      o.quad(pts, pts.map((p): UV => [dot(p, ax[iu]), dot(p, ax[iv])]), mul(ax[f], s), tone);
    }
  }
}
const boxSolid = (c: V3, ax: V3[], h: V3, feet: boolean, surface: Surf, name: string): Solid => ({ t: 'box', c, h, q: quatOf(ax[0], ax[1], ax[2]), feet, surface, name });
/** the three ways a timber lies that runs from `a` to `b`: its depth, its width, its length */
function along(a: V3, b: V3): V3[] {
  const t = unit(sub(b, a)), side: V3 = Math.abs(t[1]) > 0.99 ? [1, 0, 0] : unit(cross(t, UP));
  return [cross(side, t), side, t];
}
function timber(o: Out, a: V3, b: V3, w: number, h: number, tone = 1) {
  block(o, mul(add(a, b), 0.5), along(a, b), [h / 2, w / 2, len(sub(b, a)) / 2], tone, 1);
}

// ------------------------------------------------------------------ the pieces

type Put = (s: Solid) => void;

function boxPart(p: Box, o: Out, put: Put) {
  const c = Math.cos(p.yaw ?? 0), s = Math.sin(p.yaw ?? 0), ax: V3[] = [[c, 0, -s], UP, [s, 0, c]];
  const mid: V3 = [(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, (p.z0 + p.z1) / 2], h: V3 = [(p.x1 - p.x0) / 2, (p.y1 - p.y0) / 2, (p.z1 - p.z0) / 2];
  block(o, mid, ax, h, p.tone, p.paint === 'timber' ? 1 : 0);
  put(boxSolid(mid, ax, h, p.body === 'feet', SURF[p.paint], p.name ?? 'block'));
}

function slabPart(p: Slab, o: Out, put: Put) {
  const [a, b, , d] = p.p;
  let n = unit(cross(sub(b, a), sub(d, a)));
  if (n[1] < 0) n = mul(n, -1);
  const x = unit(sub(b, a)), ax = [x, n, cross(x, n)];
  const mid = mul(add(add(p.p[0], p.p[1]), add(p.p[2], p.p[3])), 0.25), h: V3 = [len(sub(b, a)) / 2, p.thick / 2, len(sub(d, a)) / 2];
  const c = sub(mid, mul(n, p.thick / 2));
  // (boards lie across the way that is walked)
  block(o, c, ax, h, p.tone, p.paint === 'timber' ? 2 : 0);
  put(boxSolid(c, ax, h, p.body === 'feet', SURF[p.paint], p.name ?? 'slab'));
}

function beamPart(p: Beam, o: Out, put: Put) {
  timber(o, p.a, p.b, p.w, p.h, p.tone);
  put(boxSolid(mul(add(p.a, p.b), 0.5), along(p.a, p.b), [p.h / 2, p.w / 2, len(sub(p.b, p.a)) / 2], p.body === 'feet', SURF[p.paint], p.name ?? 'timber'));
}

/** how high a rail's top bar is over what it stands on, and how much higher than its line what stops a body goes */
const RAIL = { top: 0.93, mid: 0.5, over: 1.05 };
/**
 * Posts and two bars from `a` to `b`. What stops a body stands straight up from the line of it, whatever the
 * slope; and up a slope it is in short lengths, each no taller than the rail is there. (As one piece from the foot
 * of a flight to a pace over its head, the rail of the stair below stood as a wall nobody could see across the
 * floor above, where that floor lies over the stair's foot: found by walking it, not by looking.)
 */
function railRun(o: Out, put: Put, a: V3, b: V3, tone = 1, name = 'rail', under = 0) {
  const flat = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (flat < 0.05) return;
  const lift = (p: V3, y: number): V3 => [p[0], p[1] + y, p[2]];
  timber(o, lift(a, RAIL.top), lift(b, RAIL.top), 0.05, 0.07, tone);
  timber(o, lift(a, RAIL.mid), lift(b, RAIL.mid), 0.035, 0.05, tone);
  const posts = Math.max(1, Math.round(flat / 1.1)), dir: V3 = [(b[0] - a[0]) / flat, 0, (b[2] - a[2]) / flat], ax = [dir, UP, cross(dir, UP)];
  for (let k = 0; k <= posts; k++) {
    const p = add(a, mul(sub(b, a), k / posts));
    block(o, lift(p, RAIL.top / 2), ax, [0.03, RAIL.top / 2, 0.03], tone, 1);
  }
  const n = Math.max(1, Math.ceil(Math.abs(b[1] - a[1]) / 0.4));
  for (let k = 0; k < n; k++) {
    const p = add(a, mul(sub(b, a), k / n)), q = add(a, mul(sub(b, a), (k + 1) / n));
    const lo = Math.min(p[1], q[1]) - under, tall = Math.abs(q[1] - p[1]) + RAIL.over + under;
    put(boxSolid([(p[0] + q[0]) / 2, lo + tall / 2, (p[2] + q[2]) / 2], ax, [flat / n / 2 + 0.01, tall / 2, 0.03], true, 'wood', name));
  }
}

/** how thick the slope is that is walked on under a flight of steps: it lies along the fronts of the treads */
const SLOPE_HALF = 0.04;
/**
 * A flight: boards to look at, and one slope to walk on, laid from a tread before the first to a tread short of
 * the last, with the last tread level after it. (As every stair in the game is: see `flight` in buildings.ts. A
 * body goes up a bank and catches on steps.)
 */
function flightPart(p: Flight, o: Out, put: Put) {
  const dx = p.head[0] - p.foot[0], dz = p.head[2] - p.foot[2], L = Math.hypot(dx, dz), up = p.head[1] - p.foot[1];
  const f: V3 = [dx / L, 0, dz / L], r: V3 = [f[2], 0, -f[0]], n = Math.max(1, Math.round(up / 0.2)), rise = up / n, run = L / n, hw = p.w / 2;
  const P = (s: number, y: number, lat = 0): V3 => [p.foot[0] + f[0] * s + r[0] * lat, p.foot[1] + y, p.foot[2] + f[2] * s + r[2] * lat];
  const ax = [r, UP, f];
  for (let i = 0; i < n; i++) {
    // (of stone, each step is a block down to the floor; of boards, a tread on two strings)
    if (p.paint !== 'timber') block(o, P((i + 0.5) * run, ((i + 1) * rise) / 2), ax, [hw, ((i + 1) * rise) / 2, run / 2], p.tone);
    else block(o, P((i + 0.5) * run, (i + 1) * rise - 0.0225), ax, [hw, 0.0225, run / 2 + (i === n - 1 ? 0 : 0.015)], p.tone, 1);
  }
  if (p.paint === 'timber') for (const side of [-1, 1]) timber(o, P(0, rise / 2 - 0.12, side * (hw - 0.04)), P(L, up - rise / 2 - 0.12, side * (hw - 0.04)), 0.05, 0.2, (p.tone ?? 1) * 0.9);
  const z = unit(add(mul(f, L), mul(UP, up))), y = cross(z, r), from = P(-run, 0), to = P(L - run, up);
  put(boxSolid(sub(mul(add(from, to), 0.5), mul(y, SLOPE_HALF)), [r, y, z], [hw, SLOPE_HALF, Math.hypot(L, up) / 2], true, SURF[p.paint], p.name ?? 'stair'));
  put(boxSolid(P(L - run / 2, up - SLOPE_HALF), ax, [hw, SLOPE_HALF, run / 2 + 0.03], true, SURF[p.paint], p.name ?? 'stair'));
}

/** how tall a course of the stone is: a broken top steps down by so much */
const COURSE = 0.17;
/** how high an opening's head is at a place across it: level, or an arch that springs from its jambs. `t`: -1 at one jamb, 1 at the other */
const headAt = (y0: number, y1: number, halfWidth: number, arch: boolean | undefined, t: number, rise?: number) => {
  if (!arch) return y1;
  const r = archRise(y0, y1, halfWidth, rise), k = Math.min(1, Math.abs(t));
  return y1 - r * (1 - Math.sqrt(1 - k * k));
};
/** how high an arch stands from its springing to its crown: a half round, or as much of one as its height leaves room for, or what is said */
const archRise = (y0: number, y1: number, halfWidth: number, rise?: number) => Math.min(rise ?? Infinity, halfWidth, (y1 - y0) * 0.5);
/** as far up as a body is let through an arched opening: it is cut square, half way up the arch */
const squareHead = (o: { y0: number; y1: number; arch?: boolean; rise?: number }, halfWidth: number) => (o.arch ? o.y1 - archRise(o.y0, o.y1, halfWidth, o.rise) / 2 : o.y1);
/** how high an opening's foot is at a place across it: level, or (a hole where stones have gone) round as its head is */
const sillAt = (y0: number, y1: number, halfWidth: number, round: boolean | undefined, t: number) => (round ? y0 + y1 - headAt(y0, y1, halfWidth, true, t) : y0);
/** and as far down as a body is let through one that is round at the foot */
const squareSill = (o: { y0: number; y1: number; round?: boolean }, halfWidth: number) => (o.round ? o.y0 + Math.min(halfWidth, (o.y1 - o.y0) * 0.5) / 2 : o.y0);

function wallPart(w: Wall, o: Out, core: Out, put: Put, lod: number) {
  const [ax, az] = w.a, L = Math.hypot(w.b[0] - ax, w.b[1] - az), d: V3 = [(w.b[0] - ax) / L, 0, (w.b[1] - az) / L], out: V3 = [d[2], 0, -d[0]], half = w.thick / 2;
  const tops = typeof w.top === 'number' ? [w.top] : w.top, broken = tops.length > 1 && !lod, tone = w.tone ?? 1, ops = w.openings ?? [];
  const topAt = (u: number) => tops[Math.min(tops.length - 1, Math.floor((u / L) * tops.length))];
  const at = (u: number, y: number, s: number): V3 => [ax + d[0] * u + out[0] * s * half, y, az + d[2] * u + out[2] * s * half];
  // (the picture goes along it by where it stands: two lengths of one wall carry on from each other)
  const base = ax * d[0] + az * d[2], seed = Math.round(ax * 31 + az * 17 + L * 7);
  /** the openings there are at a place along it, lowest first: a door may have a doorway over it */
  const opsAt = (u: number) => ops.filter((p) => u > p.u0 && u < p.u1).sort((p, q) => p.y0 - q.y0);
  const head = (p: Opening, u: number) => headAt(p.y0, p.y1, (p.u1 - p.u0) / 2, p.arch, (u - (p.u0 + p.u1) / 2) / ((p.u1 - p.u0) / 2), p.rise);
  /** the way the underside of an opening's head faces at a place across it: down, and out along the wall as an arch comes down to its jamb */
  const soffit = (p: Opening, u: number): V3 => {
    if (!p.arch) return [0, -1, 0];
    const hw = (p.u1 - p.u0) / 2, t = Math.min(0.97, Math.max(-0.97, (u - (p.u0 + p.u1) / 2) / hw)), slope = (-archRise(p.y0, p.y1, hw, p.rise) * t) / (hw * Math.sqrt(1 - t * t));
    return unit([d[0] * slope, -1, d[2] * slope]);
  };
  const sill = (p: Opening, u: number) => sillAt(p.y0, p.y1, (p.u1 - p.u0) / 2, p.round, (u - (p.u0 + p.u1) / 2) / ((p.u1 - p.u0) / 2));

  // ---- what is seen. It is cut along its length wherever its top or an opening changes, and a broken top is cut
  // again between: no two stones of a ruin's top are at one height.
  const cuts = new Set<number>([0, L]);
  for (let k = 1; k < tops.length; k++) cuts.add((k * L) / tops.length);
  for (const p of ops) for (let k = 0, n = p.arch && !lod ? 8 : 1; k <= n; k++) cuts.add(p.u0 + ((p.u1 - p.u0) * k) / n);
  if (broken) for (let k = 1, n = Math.round(L / 0.42); k < n; k++) cuts.add((k * L) / n);
  const us = sorted([...cuts].filter((u) => u >= 0 && u <= L), 0.03);
  us[us.length - 1] = L;
  /** what stands in each length: [its foot at the near end, its foot at the far end, its top at the near end, at the far end] for each piece, lowest first */
  const cols = us.slice(0, -1).map((u0, i) => {
    const u1 = us[i + 1], mid = (u0 + u1) / 2;
    // (a broken top comes down from one height to the next a course at a time, where the two are not far apart: a
    // wall falls in slopes, and stands in steps only where a length of it has gone altogether)
    let top = topAt(mid);
    if (broken) {
      const g = (mid / L) * tops.length - 0.5, k = Math.max(0, Math.min(tops.length - 2, Math.floor(g))), t = Math.min(1, Math.max(0, g - k));
      if (Math.abs(tops[k + 1] - tops[k]) < 0.8) top = tops[k] + (tops[k + 1] - tops[k]) * t;
      top = Math.round((top - hash(i, seed, 3) * 0.2) / COURSE) * COURSE;
    }
    const spans: [number, number, number, number][] = [], over: (Opening | null)[] = [];
    let b0 = w.y0, b1 = w.y0, below: Opening | null = null;
    for (const p of opsAt(mid)) {
      const t0 = Math.min(sill(p, u0), top), t1 = Math.min(sill(p, u1), top);
      if (Math.max(t0, t1) > Math.max(b0, b1) + 0.01) {
        spans.push([b0, b1, Math.max(t0, b0), Math.max(t1, b1)]);
        over.push(below);
      }
      b0 = head(p, u0);
      b1 = head(p, u1);
      below = p;
    }
    if (top > Math.max(b0, b1) + 0.02) {
      spans.push([b0, b1, top, top]);
      over.push(below);
    }
    // (`over`: the opening each piece stands over, if it stands over one)
    return { u0, u1, spans, over };
  });
  /** how far round the underside of each opening's head the lengths before this one have come: the picture is laid round an arch, not let fall on it from above (and turned: its courses lie across the arch, one to each stone of its ring) */
  const round = new Map<Opening, number>();
  cols.forEach((c, ci) => {
    // (the rain runs off a sill and out of a gap between two merlons, and down the wall under it: darkest at the
    // top, and gone a man's height down. So a length of wall that stands lower than the length beside it is
    // stained from its top, and so is the wall under every opening.)
    const topOf = (k: number) => (cols[k] && cols[k].spans.length ? cols[k].spans[cols[k].spans.length - 1][2] : -Infinity);
    for (const [si, [b0, b1, t0, t1]] of c.spans.entries()) {
      const under = si < c.spans.length - 1, gap = !under && (topOf(ci - 1) > t0 + 0.5 || topOf(ci + 1) > t0 + 0.5) && c.u1 - c.u0 < 1.3;
      const wet = under ? 0.66 : gap ? 0.74 : 1, deep = Math.max(b0, t0 - (under ? 1.5 : 2.4)), bm = Math.max(b1, t1 - (under ? 1.5 : 2.4));
      for (const s of [1, -1]) {
        if (wet < 1 && deep > b0 + 0.05) {
          // (in two: the stained length of it, and the rest under that)
          o.quad([at(c.u0, b0, s), at(c.u1, b1, s), at(c.u1, bm, s), at(c.u0, deep, s)], [[base + c.u0, b0], [base + c.u1, b1], [base + c.u1, bm], [base + c.u0, deep]], mul(out, s), tone);
          o.quad([at(c.u0, deep, s), at(c.u1, bm, s), at(c.u1, t1, s), at(c.u0, t0, s)], [[base + c.u0, deep], [base + c.u1, bm], [base + c.u1, t1], [base + c.u0, t0]], mul(out, s), [tone, tone, tone * wet, tone * wet]);
          continue;
        }
        const pts = [at(c.u0, b0, s), at(c.u1, b1, s), at(c.u1, t1, s), at(c.u0, t0, s)];
        o.quad(pts, [[base + c.u0, b0], [base + c.u1, b1], [base + c.u1, t1], [base + c.u0, t0]], mul(out, s), wet < 1 ? [tone, tone, tone * wet, tone * wet] : tone);
      }
      // its top (a sill, where it is under an opening), and its underside where it is over one
      const face = (y0: number, y1: number, n: V3, k: number) => o.quad([at(c.u0, y0, -1), at(c.u1, y1, -1), at(c.u1, y1, 1), at(c.u0, y0, 1)], [[base + c.u0, -half], [base + c.u1, -half], [base + c.u1, half], [base + c.u0, half]], n, tone * k);
      // (a broken top shows what the wall is filled with)
      if (broken && t0 === c.spans[c.spans.length - 1][2]) core.quad([at(c.u0, t0, -1), at(c.u1, t1, -1), at(c.u1, t1, 1), at(c.u0, t0, 1)], [[base + c.u0, -half], [base + c.u1, -half], [base + c.u1, half], [base + c.u0, half]], UP, tone * 0.95);
      else face(t0, t1, UP, 0.94);
      const p = c.over[si];
      // (from far off an arch is one flat length, and faces down)
      if (p && p.arch && !lod) {
        const s0 = round.get(p) ?? 0, s1 = s0 + Math.hypot(c.u1 - c.u0, b1 - b0), n0 = soffit(p, c.u0), n1 = soffit(p, c.u1);
        round.set(p, s1);
        o.quad([at(c.u0, b0, -1), at(c.u1, b1, -1), at(c.u1, b1, 1), at(c.u0, b0, 1)], [[-half, base + p.u0 + s0], [-half, base + p.u0 + s1], [half, base + p.u0 + s1], [half, base + p.u0 + s0]], soffit(p, (c.u0 + c.u1) / 2), tone * 0.8, [n0, n1, n1, n0]);
      } else if (b0 > w.y0 + 0.005 || b1 > w.y0 + 0.005) face(b0, b1, [0, -1, 0], 0.8);
    }
  });
  // the ends of it, the jambs of its openings, and the steps of a broken top: wherever stone stands beside none
  for (let i = 0; i <= cols.length; i++) {
    const left = i > 0 ? cols[i - 1].spans.map(([, b, , t]): [number, number] => [b, t]) : [], right = i < cols.length ? cols[i].spans.map(([b, , t]): [number, number] => [b, t]) : [];
    const u = i < cols.length ? cols[i].u0 : L;
    for (const [side, list] of [[1, minus(left, right)], [-1, minus(right, left)]] as [number, [number, number][]][]) {
      for (const [lo, hi] of list) (broken ? core : o).quad([at(u, lo, -1), at(u, lo, 1), at(u, hi, 1), at(u, hi, -1)], [[-half, lo], [half, lo], [half, hi], [-half, hi]], mul(d, side), tone * 0.9);
    }
  }

  // ---- what stops a body: a block for each length between its openings and the steps of its top
  const hard = new Set<number>([0, L]);
  for (let k = 1; k < tops.length; k++) if (Math.abs(tops[k] - tops[k - 1]) > 0.25) hard.add((k * L) / tops.length);
  for (const p of ops) hard.add(p.u0).add(p.u1);
  const hs = sorted(hard, 0.01);
  for (let i = 0; i + 1 < hs.length; i++) {
    const u0 = hs[i], u1 = hs[i + 1], mid = (u0 + u1) / 2;
    // (over a length whose top is all at about one height: the highest of it)
    let top = -Infinity;
    for (let k = 0; k < tops.length; k++) if (((k + 1) * L) / tops.length > u0 + 0.01 && (k * L) / tops.length < u1 - 0.01) top = Math.max(top, tops[k]);
    const spans: [number, number][] = [];
    let lo0 = w.y0;
    for (const p of opsAt(mid)) {
      spans.push([lo0, Math.min(top, squareSill(p, (p.u1 - p.u0) / 2))]);
      lo0 = squareHead(p, (p.u1 - p.u0) / 2);
    }
    spans.push([lo0, top]);
    for (const [lo, hi] of spans) if (hi - lo > 0.05) put(boxSolid(at(mid, (lo + hi) / 2, 0), [d, UP, cross(d, UP)], [(u1 - u0) / 2, (hi - lo) / 2, half], false, SURF[w.paint], w.name ?? 'wall'));
  }
}

/** how deep a putlog hole is, half its size, and how dark the stain under it is at its top */
const PUTLOG = { deep: 0.22, half: 0.065, stain: 0.62 };
/**
 * A face of a wall with the square holes its builders left in it (where their poles went in), each a real pocket,
 * dark inside, and the wall under each one stained where the rain has run out of it: darkest at the hole and gone
 * by the next course of holes down. `at(u, v)` is the place on the face that is `u` along it and `v` up it,
 * `n` the way it faces there, `uv` where that is on the picture, `tone` how light the wall is at that height.
 * It is cut at `us` and `vs` (and round each hole); `top(u)`, where there is one, is as high as it still stands.
 */
function holedFace(o: Out, f: { at: (u: number, v: number) => V3; n: (u: number, v: number) => V3; uv: (u: number, v: number) => UV; tone: (v: number) => number; round?: boolean }, us0: number[], vs0: number[], holes: [number, number][], hu: number, top?: (u: number) => number) {
  const hv = PUTLOG.half, us = sorted([...us0, ...holes.flatMap(([u]) => [u - hu, u + hu])].filter((u) => u >= us0[0] - 1e-6 && u <= us0[us0.length - 1] + 1e-6), 1e-4), vs = sorted([...vs0, ...holes.flatMap(([, v]) => [v - hv, v + hv])].filter((v) => v >= vs0[0] - 1e-6 && v <= vs0[vs0.length - 1] + 1e-6), 1e-4);
  const holeAt = (u: number, v: number) => holes.some(([a, b]) => Math.abs(u - a) < hu && Math.abs(v - b) < hv);
  for (let i = 0; i + 1 < us.length; i++) {
    const u0 = us[i], u1 = us[i + 1], um = (u0 + u1) / 2, high = top ? top(um) : Infinity;
    for (let j = 0; j + 1 < vs.length; j++) {
      const v0 = vs[j], v1 = Math.min(vs[j + 1], high), vm = (v0 + vs[j + 1]) / 2;
      if (v1 - v0 < 0.01) continue;
      const c = [f.at(u0, v0), f.at(u1, v0), f.at(u1, v1), f.at(u0, v1)], t = [f.uv(u0, v0), f.uv(u1, v0), f.uv(u1, v1), f.uv(u0, v1)], n = f.n(um, vm);
      if (holeAt(um, vm)) {
        // the pocket: its four sides and its back
        const back = c.map((p) => sub(p, mul(n, PUTLOG.deep)));
        o.quad(back, t, n, 0.1);
        for (let k = 0; k < 4; k++) o.quad([c[k], c[(k + 1) % 4], back[(k + 1) % 4], back[k]], [t[k], t[(k + 1) % 4], t[(k + 1) % 4], t[k]], sub(mul(add(add(c[0], c[1]), add(c[2], c[3])), 0.25), mul(add(c[k], c[(k + 1) % 4]), 0.5)), 0.3);
        continue;
      }
      // (the stain: under a hole, down to the next cut)
      const wet = j + 2 < vs.length && holeAt(um, (vs[j + 1] + vs[j + 2]) / 2) ? PUTLOG.stain : 1, lo = f.tone(v0), hi = f.tone(v1);
      o.quad(c, t, n, [lo, lo, hi * wet, hi * wet], f.round ? [f.n(u0, v0), f.n(u1, v0), f.n(u1, v1), f.n(u0, v1)] : undefined);
    }
  }
}

/** a way through the foot of a wall, for a passage under the ground: where it is on the plan [x, z], and from how deep to how deep */
interface Gap { x: number; z: number; y0: number; y1: number }
function curtainPart(c: Curtain, o: Out, put: Put, lod: number, gaps: Gap[]) {
  const [ax, az] = c.a, L = Math.hypot(c.b[0] - ax, c.b[1] - az), d: V3 = [(c.b[0] - ax) / L, 0, (c.b[1] - az) / L], out: V3 = [d[2], 0, -d[0]];
  const k = Math.hypot(1, 1 / c.lean), n = unit([out[0], 1 / c.lean, out[2]]), tone = c.tone ?? 1;
  const at = (u: number, y: number): V3 => [ax + d[0] * u - (out[0] * y) / c.lean, y, az + d[2] * u - (out[2] * y) / c.lean];
  const base = ax * d[0] + az * d[2], sag = c.sag;
  // (it is cut along its length where a length of it has fallen out, and that length stands only as high as what is left of it: ragged, a little higher at its ends)
  const us = sorted([0, L, ...Array.from({ length: lod ? 0 : Math.ceil(L / 3.3) }, (_, j) => (L * j) / Math.ceil(L / 3.3)), ...(sag ? [sag[0], sag[1], ...Array.from({ length: 5 }, (_, j) => sag[0] + ((sag[1] - sag[0]) * (j + 1)) / 6)] : [])], 0.05);
  const topAt = (u: number) => (sag && u > sag[0] && u < sag[1] ? sag[2] + 0.5 * Math.abs((u - (sag[0] + sag[1]) / 2) / ((sag[1] - sag[0]) / 2)) ** 3 + hash(Math.round(u * 9), 3, 71) * 0.3 : 0);
  // (the builders' holes: a course of them every pace and three quarters down it, each course set off from the last; none where the hill has it)
  const holes: [number, number][] = [];
  if (!lod) for (let y = -1.3, r = 0; y > Math.max(c.y0 + 1, -8.6); y -= 1.75, r++) for (let u = 1.2 + (r % 2) * 1.2; u < L - 0.8; u += 2.4) if (y < topAt(u) - 0.5) holes.push([u, y]);
  const vs = lod ? [c.y0, 0.6] : sorted([c.y0, ...Array.from({ length: Math.ceil(-c.y0 / 2.6) }, (_, i) => (c.y0 * i) / Math.ceil(-c.y0 / 2.6)), 0.6], 0.05);
  holedFace(o, { at, n: () => n, uv: (u, y) => [base + u, y * k], tone: (y) => weather(y) * tone }, us, vs, holes, PUTLOG.half, topAt);
  const upIt = unit(sub(at(0, 1), at(0, 0)));
  // (what stops a body is a slab behind the face: nobody is ever behind it. Where a passage goes through its foot,
  // under the ground, it is left open for it; and where a length of it has fallen out, there is none above what is left.)
  const piece = (u0: number, u1: number, y0: number, y1: number) => void (u1 - u0 > 0.05 && y1 - y0 > 0.05 && put(boxSolid(sub(at((u0 + u1) / 2, (y0 + y1) / 2), mul(n, 0.3)), [d, upIt, cross(d, upIt)], [(u1 - u0) / 2, ((y1 - y0) * k) / 2, 0.3], false, 'concrete', c.name ?? 'curtain')));
  const through = gaps.map((g) => ({ u: (g.x - ax) * d[0] + (g.z - az) * d[2], off: (g.x - ax) * out[0] + (g.z - az) * out[2], g })).filter((q) => q.u > 0 && q.u < L && Math.abs(q.off + (q.g.y0 + q.g.y1) / 2 / c.lean) < 1.6);
  const ends = sorted([0, L, ...(sag ? [sag[0], sag[1]] : []), ...through.flatMap((q) => [q.u - 1.5, q.u + 1.5])].filter((u) => u >= 0 && u <= L), 0.01);
  for (let i = 0; i + 1 < ends.length; i++) {
    const u0 = ends[i], u1 = ends[i + 1], um = (u0 + u1) / 2, top = sag && um > sag[0] && um < sag[1] ? sag[2] : 0, q = through.find((t) => Math.abs(um - t.u) < 1.5);
    if (q) piece(u0, u1, Math.min(top, q.g.y1), top);
    piece(u0, u1, c.y0, q ? Math.min(top, q.g.y0) : top);
  }
}

/** a hatch's stairwell and its passage, for made ground to keep out of: its line (see `hatchLine`) and the ground it stands at */
interface Way { L: ReturnType<typeof hatchLine>; g: number }
/** the floor of a hatch's way at a spot within `by` of it, and whether it is open to the sky there (null: no hatch's way is there) */
function wayAt(ways: Way[], x: number, z: number, by: number): { floor: number; open: boolean } | null {
  const H = UNDER.hatch;
  for (const { L, g } of ways) {
    const ax = x - L.head[0], az = z - L.head[2], along = ax * L.d[0] + az * L.d[1], off = Math.abs(ax * L.r[0] + az * L.r[1]);
    if (along > -0.4 - by && along < H.run + 0.65 + by && off < H.wide / 2 + 0.45 + by) return { floor: g - H.drop, open: true };
    for (let k = 0; k + 1 < L.path.length; k++) {
      const a = L.path[k], b = L.path[k + 1], ex = b[0] - a[0], ez = b[2] - a[2], t = Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[2]) * ez) / (ex * ex + ez * ez)));
      // (its floor where it is nearest: a passage falls along its length, and what is clear over one end of it is in the other)
      if (Math.hypot(x - a[0] - ex * t, z - a[2] - ez * t) < H.wide / 2 + 0.45 + by) return { floor: a[1] + (b[1] - a[1]) * t - 0.1, open: false };
    }
  }
  return null;
}

function moundPart(m: Mound, o: Out, put: Put, lod: number, ground: (x: number, z: number) => number, ways: Way[]) {
  const nx = Math.round((m.x1 - m.x0) / m.cell), nz = Math.round((m.z1 - m.z0) / m.cell), W = nx + 1, step = lod ? 3 : 1;
  const H = new Float32Array(W * (nz + 1));
  for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
    let y = moundTop(m.kind, m.x0 + ix * m.cell, m.z0 + iz * m.cell);
    // (made ground gives way to a hatch: it is not in its stairwell; and over its passage it lies over the passage's
    // roof and nowhere lower. Not let down under the floor in the places where it would be in the way: a place let
    // down beside one that is not is a wall across the passage, which was found by walking into it.)
    const way = ways.length ? wayAt(ways, m.x0 + ix * m.cell, m.z0 + iz * m.cell, m.cell) : null;
    if (way) y = way.open ? Math.min(y, way.floor - 0.7) : Math.max(y, way.floor + UNDER.hatch.tall + 0.85);
    H[iz * W + ix] = y;
  }
  // (what is drawn: the same heights, but where the ground is said to be far under everything, which is how it is
  // kept out of a stair or from under a floor, its edge is drawn as a short skirt and not as a face thirty metres deep)
  const D = Float32Array.from(H);
  for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
    if (H[iz * W + ix] > -20) continue;
    let by = -Infinity;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const jx = ix + dx, jz = iz + dz;
      if (jx >= 0 && jx <= nx && jz >= 0 && jz <= nz && H[jz * W + jx] > -20) by = Math.max(by, H[jz * W + jx] - 0.9);
    }
    if (by > -Infinity) D[iz * W + ix] = by;
  }
  const P = (ix: number, iz: number): V3 => [m.x0 + ix * m.cell, D[iz * W + ix], m.z0 + iz * m.cell];
  const N = (ix: number, iz: number): V3 => {
    const x0 = Math.max(0, ix - 1), x1 = Math.min(nx, ix + 1), z0 = Math.max(0, iz - 1), z1 = Math.min(nz, iz + 1);
    return unit([-(D[iz * W + x1] - D[iz * W + x0]) / ((x1 - x0) * m.cell), 1, -(D[z1 * W + ix] - D[z0 * W + ix]) / ((z1 - z0) * m.cell)]);
  };
  const tone = (p: V3) => (m.tone ?? 1) * (0.84 + 0.32 * rough(p[0] * 0.35, p[2] * 0.35, 3));
  for (let iz = 0; iz + step <= nz; iz += step) {
    for (let ix = 0; ix + step <= nx; ix += step) {
      const q: [number, number][] = [[ix, iz], [ix + step, iz], [ix, iz + step], [ix + step, iz + step]], c = q.map(([i, j]) => P(i, j));
      // (nothing of it is drawn where the hill has it covered, or where it is said to be under a floor: see `moundTop`)
      if (Math.max(...c.map((p) => p[1] - ground(p[0], p[2]))) < -0.4 || Math.max(...c.map((p) => p[1])) < -20) continue;
      // (cut the way the ground itself is cut, corner to corner: what is stood on is what is seen)
      for (const [a, b, e] of [[0, 2, 1], [1, 2, 3]]) {
        const g = cross(sub(c[b], c[a]), sub(c[e], c[a]));
        // (the picture is laid on from whichever side sees the face most squarely: it does not run down a cliff in streaks)
        const flat = Math.abs(g[1]) > 0.72 * len(g), east = Math.abs(g[0]) > Math.abs(g[2]);
        const uv = (p: V3): UV => (flat ? [p[0], p[2]] : east ? [p[2], p[1]] : [p[0], p[1]]);
        // (round, where it is round: at a crest or the lip of a drop a corner faces the way its own face does)
        const face = unit(g[1] < 0 ? mul(g, -1) : g), smooth = [q[a], q[b], q[e]].map((k) => N(...k)).map((n) => (dot(n, face) < 0.5 ? face : n));
        o.tri([c[a], c[b], c[e]], [uv(c[a]), uv(c[b]), uv(c[e])], UP, [tone(c[a]), tone(c[b]), tone(c[e])], smooth);
      }
    }
  }
  put({ t: 'field', x0: m.x0, z0: m.z0, nx, nz, cell: m.cell, heights: H, surface: 'rock', name: m.name ?? 'mound' });
}

/**
 * The ground's own earth, laid over ground that has been cut away for something under it: in squares of two
 * metres, each corner at the height the ground has there (the ground as it was: see `castleCuts`), wherever a
 * square's middle is within reach of one of the pieces that were cut; none of it under the fort itself, which
 * hides what is cut there, and none over the hole that is left open. What stops a body is a thin shape under each square.
 */
function apronPart(p: Apron, o: Out, put: Put, ground: (x: number, z: number) => number) {
  const CELL = 2, C = CASTLE, fx = C.hx + C.parapet.thick / 2 + 0.9, fz = C.hz + C.parapet.thick / 2 + 0.9, all = p.wells.flat();
  const lo = (k: number) => Math.floor((Math.min(...all.map((q) => q[k])) - p.reach) / CELL) * CELL, hi = (k: number) => Math.ceil((Math.max(...all.map((q) => q[k])) + p.reach) / CELL) * CELL;
  const hole = cutPoly(p.hole, -1e3, 1e3);
  /** how far a spot is from a piece of the plan (0: in it) */
  const off = (poly: [number, number][], x: number, z: number) => {
    let inside = true, best = Infinity, sign = 0;
    for (let k = 0; k < poly.length; k++) {
      const [ax, az] = poly[k], [bx, bz] = poly[(k + 1) % poly.length], ex = bx - ax, ez = bz - az, turn = ex * (z - az) - ez * (x - ax);
      if (sign === 0) sign = Math.sign(turn);
      else if (turn * sign < 0) inside = false;
      const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
      best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
    }
    return inside ? 0 : best;
  };
  for (let x = lo(0); x < hi(0); x += CELL) for (let z = lo(1); z < hi(1); z += CELL) {
    if (Math.max(Math.abs(x), Math.abs(x + CELL)) < fx && Math.max(Math.abs(z), Math.abs(z + CELL)) < fz) continue;
    if (!p.wells.some((w) => off(w, x + CELL / 2, z + CELL / 2) < p.reach)) continue;
    for (const piece of clipOut([[x, 0, z], [x + CELL, 0, z], [x + CELL, 0, z + CELL], [x, 0, z + CELL]], hole)) {
      const pts = piece.map((v): V3 => [v[0], ground(v[0], v[2]) + 0.03, v[2]]);
      for (let k = 1; k + 1 < pts.length; k++) o.tri([pts[0], pts[k], pts[k + 1]], [pts[0], pts[k], pts[k + 1]].map((v): UV => [v[0], v[2]]), UP, p.tone ?? 1);
      put({ t: 'hull', pts: [...pts, ...pts.map((v): V3 => [v[0], v[1] - 0.5, v[2]])].flat(), feet: false, surface: 'rock', name: p.name ?? 'apron' });
    }
  }
}

function lumpPart(l: Lump, o: Out, put: Put, lod: number) {
  const tone = l.tone ?? 1, yaw = hash(l.seed, 1, 77) * Math.PI, cy = Math.cos(yaw), sy = Math.sin(yaw), ax: V3[] = [[cy, 0, -sy], UP, [sy, 0, cy]];
  if (l.blocky || lod) block(o, [l.x, l.y, l.z], ax, [l.rx, l.ry, l.rz], tone * (0.9 + 0.2 * hash(l.seed, 2, 77)));
  else {
    // a rock: a ball of a few flat faces, each corner pushed in or out by its own amount
    const A = 7, B = 4, pt = (i: number, j: number): V3 => {
      const lat = -Math.PI / 2 + (Math.PI * j) / B, lon = (2 * Math.PI * (i % A)) / A, k = j === 0 || j === B ? 0.8 : 0.62 + 0.62 * hash(i % A, j, l.seed);
      return [l.x + Math.cos(lat) * Math.cos(lon) * l.rx * k, l.y + Math.sin(lat) * l.ry * (j === B ? 0.75 + 0.4 * hash(9, 9, l.seed) : 1), l.z + Math.cos(lat) * Math.sin(lon) * l.rz * k];
    };
    for (let j = 0; j < B; j++) for (let i = 0; i < A; i++) {
      const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
      for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
        const p = [q[a], q[b], q[c]], g = cross(sub(p[1], p[0]), sub(p[2], p[0])), away = sub(mul(add(add(p[0], p[1]), p[2]), 1 / 3), [l.x, l.y, l.z]);
        const flat = Math.abs(g[1]) > 0.72 * len(g), east = Math.abs(g[0]) > Math.abs(g[2]);
        o.tri(p, p.map((v): UV => (flat ? [v[0], v[2]] : east ? [v[2], v[1]] : [v[0], v[1]])), away, tone * (0.82 + 0.3 * hash(i, j, l.seed + 5)));
      }
    }
  }
  const k = l.blocky ? 1 : 0.78;
  put(boxSolid([l.x, l.y, l.z], l.blocky ? ax : [[1, 0, 0], UP, [0, 0, 1]], [l.rx * k, l.ry * (l.blocky ? 1 : 0.9), l.rz * k], false, 'rock', l.name ?? 'rock'));
}

/**
 * The underside of a vault: half a round, in eight flat lengths from one wall to the other, cut along its length a
 * pace and a half at a time; left out where it has fallen. Seen from under it, and it stops nothing.
 */
function vaultPart(v: Vault, o: Out) {
  const [ax, az] = v.a, L = Math.hypot(v.b[0] - ax, v.b[1] - az), d: V3 = [(v.b[0] - ax) / L, 0, (v.b[1] - az) / L], side: V3 = [d[2], 0, -d[0]], half = v.wide / 2, rise = v.crown - v.spring, N = 8, tone = v.tone ?? 1;
  const at = (u: number, t: number): V3 => [ax + d[0] * u - side[0] * half * Math.cos(t), v.spring + rise * Math.sin(t) + ((v.lift ?? 0) * u) / L, az + d[2] * u - side[2] * half * Math.cos(t)];
  // (the way it faces at a place round it: in, and down)
  const face = (t: number): V3 => unit([(side[0] * Math.cos(t)) / half, -Math.sin(t) / rise, (side[2] * Math.cos(t)) / half]);
  const cuts = sorted([0, L, ...Array.from({ length: Math.ceil(L / 1.6) }, (_, k) => (L * k) / Math.ceil(L / 1.6)), ...(v.gone ?? []).flat()].filter((u) => u >= 0 && u <= L), 0.02);
  // (how far round it a place is, for the picture: the same stone as the walls, its courses running along the vault)
  const round: number[] = [0];
  for (let k = 1; k <= N; k++) round.push(round[k - 1] + len(sub(at(0, (Math.PI * k) / N), at(0, (Math.PI * (k - 1)) / N))));
  for (let i = 0; i + 1 < cuts.length; i++) {
    const u0 = cuts[i], u1 = cuts[i + 1], um = (u0 + u1) / 2;
    if ((v.gone ?? []).some(([g0, g1]) => um > g0 && um < g1)) continue;
    for (let k = 0; k < N; k++) {
      const t0 = (Math.PI * k) / N, t1 = (Math.PI * (k + 1)) / N;
      o.quad([at(u0, t0), at(u1, t0), at(u1, t1), at(u0, t1)], [[u0, round[k]], [u1, round[k]], [u1, round[k + 1]], [u0, round[k + 1]]], face((t0 + t1) / 2), tone, [face(t0), face(t0), face(t1), face(t1)]);
    }
  }
}

/** the boards a tower's floor is laid with stand this far over the paving (they lie on it, and are heard underfoot) */
export const TOWER_FLOOR = 0.06;

function towerPart(tw: Tower, stone: Out, wood: Out, dark: Out, put: Put, lod: number) {
  const T = CASTLE.tower, n = lod ? 20 : 48, rin = T.r - T.wall, tone = tw.tone ?? 1, tile = TILE.stone, seed = Math.round(tw.cx * 7 + tw.cz * 13);
  /** it is hollow under its boards, down to here (see `hollow`): a doorway is left in its foot, under its door, so high */
  const hollow = tw.hollow, DOOR = 2.2, doorHalf = (r: number) => (Math.asin(0.55 / r) * 180) / Math.PI;
  const P = (a: number, r: number, y: number): V3 => [tw.cx + Math.cos(rad(a)) * r, y, tw.cz + Math.sin(rad(a)) * r];
  const out = (a: number): V3 => [Math.cos(rad(a)), 0, Math.sin(rad(a))], round = (a: number): V3 => [-Math.sin(rad(a)), 0, Math.cos(rad(a))];
  const levels = (from: number, to: number, step: number) => {
    const k = Math.max(1, Math.ceil((from - to) / step));
    return Array.from({ length: k + 1 }, (_, i) => from + ((to - from) * i) / k);
  };

  // ---- under the terrace: a cone in bands, each with as many turns of the picture as fit its girth, and the
  // builders' holes in it as far down as the hill lets them be seen
  const kitFoot = -KIT_TOWER.top[0] * T.kit, seen = -9.4, ys = sorted([...levels(0, T.bend, lod ? 99 : 2.5), ...levels(T.bend, tw.foot, lod ? 99 : 3.3).slice(1), ...(lod ? [] : [seen, kitFoot + 0.05]), ...(hollow !== undefined && !lod ? [hollow, hollow + DOOR] : [])], 0.05).reverse();
  const leanAt = (y: number) => (y > T.bend ? 1 / T.lean : 1 / T.flare), cols = (k: number) => Array.from({ length: k + 1 }, (_, j) => (j * 360) / k);
  const pits: [number, number][] = [];
  if (!lod) for (let y = -1.3, r = 0; y > seen + 0.3; y -= 1.75, r++) for (let a = (r % 2) * 22.5; a < 359; a += 45) if (hollow === undefined || apart(a, tw.door) > 12 || y > hollow + DOOR + 0.3) pits.push([a, y]);
  // (from near the foot of a tower is the kit's round tower: see `castleKit`. This is what stands for it from far off.)
  let s0 = 0;
  // (and, from near, what is under the kit tower's own foot: the hill is lower than that on three sides)
  for (let i = 0; i + 1 < ys.length; i++) {
    if (!lod && ys[i] > kitFoot + 0.06) continue;
    const y0 = ys[i], y1 = ys[i + 1], r0 = towerRadius(y0), r1 = towerRadius(y1), s1 = s0 - Math.hypot(y0 - y1, r1 - r0), turns = Math.max(1, Math.round((Math.PI * (r0 + r1)) / TILE.base)), from = s0;
    // (the doorway in a hollow foot is left out of the band it is in)
    const door = hollow !== undefined && !lod && y1 >= hollow - 0.01 && y0 <= hollow + DOOR + 0.01, us = lod ? cols(n) : y0 <= seen + 0.01 ? cols(24) : cols(48);
    const band = (a0: number, a1: number) => holedFace(dark, {
      at: (a, y) => P(a, towerRadius(y), y),
      n: (a, y) => unit([Math.cos(rad(a)), leanAt(y), Math.sin(rad(a))]),
      uv: (a, y) => [(a / 360) * turns * TILE.base, from - ((y0 - y) / (y0 - y1)) * (from - s1)],
      tone: (y) => weather(y) * tone,
      round: true,
    }, us.filter((a) => a >= a0 - 1e-6 && a <= a1 + 1e-6), [y1, y0], pits.filter(([a, y]) => y < y0 && y > y1 && a > a0 && a < a1), 0.9);
    if (door) {
      const dh = doorHalf((r0 + r1) / 2), lo = Math.floor((norm360(tw.door) - dh) / 7.5) * 7.5, hi = Math.ceil((norm360(tw.door) + dh) / 7.5) * 7.5;
      band(0, lo);
      band(hi, 360);
    } else band(0, 360);
    s0 = s1;
  }
  if (hollow !== undefined && !lod) {
    // the round cellar in its foot: its wall, its floor, and the doorway through to the lower levels
    const top = -0.2, ro = towerRadius(hollow + DOOR / 2) + 0.05, dh = doorHalf(rin);
    for (let j = 0; j < 24; j++) {
      const a0 = j * 15, a1 = a0 + 15, inDoor = apart(a0 + 7.5, tw.door) < dh, lo = inDoor ? hollow + DOOR : hollow;
      dark.quad([P(a0, rin, lo), P(a1, rin, lo), P(a1, rin, top), P(a0, rin, top)], [[rad(a0) * rin, lo], [rad(a1) * rin, lo], [rad(a1) * rin, top], [rad(a0) * rin, top]], mul(out(a0 + 7.5), -1), tone * 0.8, [a0, a1, a1, a0].map((a) => mul(out(a), -1)));
      // (a finger over the galleries' own floor, which runs in under it)
      const pts = [P(0, 0, hollow + 0.02), P(a1, rin, hollow + 0.02), P(a0, rin, hollow + 0.02)];
      dark.tri(pts, pts.map((p): UV => [p[0], p[2]]), UP, tone * 0.8);
    }
    for (const side of [-1, 1]) dark.quad([P(tw.door + side * dh, rin, hollow), P(tw.door + side * doorHalf(ro), ro, hollow), P(tw.door + side * doorHalf(ro), ro, hollow + DOOR), P(tw.door + side * dh, rin, hollow + DOOR)], [[0, hollow], [ro - rin, hollow], [ro - rin, hollow + DOOR], [0, hollow + DOOR]], mul(round(tw.door), -side), tone * 0.75);
    dark.quad([P(tw.door - dh, rin, hollow + DOOR), P(tw.door + dh, rin, hollow + DOOR), P(tw.door + doorHalf(ro), ro, hollow + DOOR), P(tw.door - doorHalf(ro), ro, hollow + DOOR)], [[0, 0], [1.1, 0], [1.1, ro - rin], [0, ro - rin]], [0, -1, 0], tone * 0.7);
    const sill = [P(tw.door - dh, rin, hollow), P(tw.door + dh, rin, hollow), P(tw.door + doorHalf(ro), ro, hollow), P(tw.door - doorHalf(ro), ro, hollow)];
    dark.quad(sill, sill.map((p): UV => [p[0], p[2]]), UP, tone * 0.8);
  }

  // ---- over it: a drum, open to the sky, with a door to the terrace and windows; its top is what is left of a battlement
  type Hole = { a: number; w: number; y0: number; y1: number; arch: boolean; round?: boolean };
  const holes: Hole[] = lod ? [] : [{ a: tw.door, w: TOWER_DOOR.w, y0: 0, y1: TOWER_DOOR.h, arch: true }, ...tw.slits.map((s) => ({ a: s.a, w: SLIT_WIDE, y0: s.y0, y1: s.y1, arch: true })), ...(tw.lost ?? []).map((s) => ({ a: s.a, w: LOST_WIDE, y0: s.y0, y1: s.y1, arch: true, round: true }))];
  /** how far either side of its middle an opening reaches, at so far from the tower's own: its sides are square to the wall, not drawn to the tower's middle */
  const halfAt = (h: Hole, r: number) => (Math.asin(h.w / 2 / r) * 180) / Math.PI;
  const rimAt = (a: number) => {
    const k = Math.floor(norm360(a) / (360 / T.slots)) % T.slots;
    // (no two stones of a broken top are at one height: each half of a stub is a little under what the plan says)
    return tw.rim[k] - (!lod && k % 2 === 0 ? 0.24 * hash(Math.floor(norm360(a) / 7.5), seed, 5) : 0);
  };
  const columns = (r: number) => {
    const cuts = new Set<number>();
    for (let j = 0; j < n; j++) cuts.add((j * 360) / n);
    for (const h of holes) for (let k = 0; k <= 6; k++) cuts.add(norm360(h.a - halfAt(h, r) + (2 * halfAt(h, r) * k) / 6));
    const as = sorted(cuts, 0.05);
    return as.map((a0, i) => ({ a0, a1: i + 1 < as.length ? as[i + 1] : as[0] + 360 }));
  };
  for (const [r, s] of [[T.r, 1], [rin, -1]] as [number, number][]) {
    const turns = Math.max(1, Math.round((2 * Math.PI * r) / tile)), u = (a: number) => (a / 360) * turns * tile;
    for (const { a0, a1 } of columns(r)) {
      const mid = (a0 + a1) / 2, top = rimAt(mid), h = holes.find((q) => apart(mid, q.a) < halfAt(q, r));
      // (what stands in this length of it: under an opening as far as its foot or the wall's top, whichever is lower, and over it if the wall goes so high)
      const spans: [number, number, number, number][] = [];
      if (!h) spans.push([0, 0, top, top]);
      else {
        const t = (a: number) => (norm360(a - h.a + 180) - 180) / halfAt(h, r), head = (a: number) => headAt(h.y0, h.y1, h.w / 2, h.arch, t(a)), foot = (a: number) => Math.min(top, sillAt(h.y0, h.y1, h.w / 2, h.round, t(a)));
        if (Math.max(foot(a0), foot(a1)) > 0.01) spans.push([0, 0, foot(a0), foot(a1)]);
        if (top > Math.max(head(a0), head(a1)) + 0.02) spans.push([head(a0), head(a1), top, top]);
      }
      for (const [b0, b1, t0, t1] of spans) stone.quad([P(a0, r, b0), P(a1, r, b1), P(a1, r, t1), P(a0, r, t0)], [[u(a0), b0], [u(a1), b1], [u(a1), t1], [u(a0), t0]], mul(out(mid), s), tone * (s > 0 ? 1 : 0.86), [a0, a1, a1, a0].map((a) => mul(out(a), s)));
    }
  }
  // the top of the wall, and the faces of its stubs
  for (let j = 0; j < n; j++) {
    const a0 = (j * 360) / n, a1 = ((j + 1) * 360) / n, top = rimAt((a0 + a1) / 2), next = rimAt(a1 + 180 / n);
    const pts = [P(a0, rin, top), P(a1, rin, top), P(a1, T.r, top), P(a0, T.r, top)];
    stone.quad(pts, pts.map((p): UV => [p[0], p[2]]), UP, tone * 0.94);
    if (Math.abs(next - top) > 0.01) stone.quad([P(a1, rin, Math.min(top, next)), P(a1, T.r, Math.min(top, next)), P(a1, T.r, Math.max(top, next)), P(a1, rin, Math.max(top, next))], [[rin, Math.min(top, next)], [T.r, Math.min(top, next)], [T.r, Math.max(top, next)], [rin, Math.max(top, next)]], mul(round(a1), next < top ? 1 : -1), tone * 0.9);
  }
  if (!lod) for (const h of holes) {
    // the sides of each opening, its sill and its head, through the thickness of the wall
    const ho = halfAt(h, T.r), hi = halfAt(h, rin), rise = h.y1 - headAt(h.y0, h.y1, h.w / 2, h.arch, 1), foot = h.round ? h.y0 + rise : h.y0;
    // (nothing of it is left to line where the wall itself has come down past it)
    if (rimAt(h.a) < h.y1 + 0.05) continue;
    for (const side of [-1, 1]) stone.quad([P(h.a + side * ho, T.r, foot), P(h.a + side * hi, rin, foot), P(h.a + side * hi, rin, h.y1 - rise), P(h.a + side * ho, T.r, h.y1 - rise)], [[0, foot], [T.wall, foot], [T.wall, h.y1 - rise], [0, h.y1 - rise]], mul(round(h.a), -side), tone * 0.84);
    if (h.round) for (let k = 0; k < 6; k++) {
      const t0 = -1 + k / 3, t1 = -1 + (k + 1) / 3, h0 = sillAt(h.y0, h.y1, h.w / 2, true, t0), h1 = sillAt(h.y0, h.y1, h.w / 2, true, t1);
      stone.quad([P(h.a + t0 * ho, T.r, h0), P(h.a + t1 * ho, T.r, h1), P(h.a + t1 * hi, rin, h1), P(h.a + t0 * hi, rin, h0)], [[t0 * 0.3, 0], [t1 * 0.3, 0], [t1 * 0.3, T.wall], [t0 * 0.3, T.wall]], UP, tone * 0.8);
    }
    for (let k = 0; k < 6; k++) {
      const t0 = -1 + k / 3, t1 = -1 + (k + 1) / 3, h0 = headAt(h.y0, h.y1, h.w / 2, h.arch, t0), h1 = headAt(h.y0, h.y1, h.w / 2, h.arch, t1);
      stone.quad([P(h.a + t0 * ho, T.r, h0), P(h.a + t1 * ho, T.r, h1), P(h.a + t1 * hi, rin, h1), P(h.a + t0 * hi, rin, h0)], [[t0 * 0.4, 0], [t1 * 0.4, 0], [t1 * 0.4, T.wall], [t0 * 0.4, T.wall]], [0, -1, 0], tone * 0.78);
    }
    if (h.y0 > 0.01 && !h.round) stone.quad([P(h.a - ho, T.r, h.y0), P(h.a + ho, T.r, h.y0), P(h.a + hi, rin, h.y0), P(h.a - hi, rin, h.y0)], [[-0.4, 0], [0.4, 0], [0.4, T.wall], [-0.4, T.wall]], UP, tone * 0.9);
  }
  if (lod) return;

  // ---- what stops a body. Under the terrace, the cone itself (it bulges nowhere, so a shape drawn tight round
  // three rings of it is the cone); over it, the wall in lengths, left out where its openings are.
  // (A hollow foot is its wall in short lengths down to its cellar's floor, left out at the doorway, and the cone under that.)
  const hull: number[] = [];
  for (const y of [hollow ?? 0, T.bend, -KIT_TOWER.top[0] * T.kit, tw.foot]) for (let k = 0; k < 16; k++) hull.push(...P(k * 22.5, towerRadius(Math.min(y, -0.001)) / Math.cos(rad(11.25)), y));
  // (and the low ring of the kit's parapet that stands round the foot of the drum, outside the walls)
  if (!lod) for (let k = 0; k < 16; k++) {
    const a = (k + 0.5) * 22.5, c = P(a, (T.r + KIT_TOWER.ring.r1 * T.kit) / 2, 0.36);
    if (Math.abs(c[0]) > CASTLE.hx + CASTLE.parapet.thick / 2 - 1.5 || Math.abs(c[2]) > CASTLE.hz + CASTLE.parapet.thick / 2 - 1.5) put(boxSolid(c, [out(a), UP, cross(out(a), UP)], [(KIT_TOWER.ring.r1 * T.kit - T.r) / 2, 0.36, 0.75], false, 'concrete', tw.name ?? 'tower'));
  }
  put({ t: 'hull', pts: hull, feet: false, surface: 'concrete', name: tw.name ?? 'tower' });
  if (hollow !== undefined) {
    for (let k = 0; k < 32; k++) {
      const a0 = k * 11.25, a1 = a0 + 11.25, inDoor = apart(a0 + 5.625, tw.door) < 11.25, lo = inDoor ? hollow + DOOR : hollow, pts: number[] = [];
      for (const a of [a0, a1]) for (const y of [lo, 0]) for (const r of [rin, towerRadius(y) / Math.cos(rad(5.625))]) pts.push(...P(a, r, y));
      put({ t: 'hull', pts, feet: false, surface: 'concrete', name: tw.name ?? 'tower' });
    }
  }
  const rm = (T.r + rin) / 2, hard = new Set<number>();
  for (let k = 0; k < T.slots; k++) hard.add((k * 360) / T.slots);
  for (const h of holes) hard.add(norm360(h.a - halfAt(h, rm))).add(norm360(h.a + halfAt(h, rm)));
  const hs = sorted(hard, 0.5);
  hs.forEach((a0, i) => {
    const a1 = i + 1 < hs.length ? hs[i + 1] : hs[0] + 360, mid = (a0 + a1) / 2, h = holes.find((q) => apart(mid, q.a) < halfAt(q, rm));
    const top = tw.rim[Math.floor(norm360(mid) / (360 / T.slots)) % T.slots];
    for (const [lo, hi] of h ? [[0, Math.min(top, squareSill(h, h.w / 2))], [squareHead(h, h.w / 2), top]] : [[0, top]]) {
      if (hi - lo > 0.05) put(boxSolid(P(mid, rm, (lo + hi) / 2), [out(mid), UP, cross(out(mid), UP)], [T.wall / 2, (hi - lo) / 2, T.r * Math.tan(rad((a1 - a0) / 2)) + 0.01], false, 'concrete', tw.name ?? 'tower'));
    }
  });

  // ---- its floor: boards laid on the paving, with a riser where the door comes in
  const ring = (y: number, r0: number, r1: number, a0: number, a1: number, face: V3, k = 1) => {
    const pts = r0 > 0 ? [P(a0, r0, y), P(a1, r0, y), P(a1, r1, y), P(a0, r1, y)] : [P(0, 0, y), P(a1, r1, y), P(a0, r1, y)];
    // (boards across the way that is walked: the picture's own boards run up it)
    const uv = pts.map((p): UV => [p[0], p[2]]);
    if (r0 > 0) wood.quad(pts, uv, face, tone * k);
    else wood.tri(pts, uv, face, tone * k);
  };
  const disc = (name: string, y0: number, y1: number, r: number) => {
    const pts: number[] = [];
    for (const y of [y0, y1]) for (let k = 0; k < 16; k++) pts.push(...P(k * 22.5, r / Math.cos(rad(11.25)), y));
    put({ t: 'hull', pts, feet: false, surface: 'wood', name });
  };
  // (a hollow tower's boards have rotted through in the middle: a hole a body goes down)
  const hole = hollow !== undefined ? 1.05 : 0;
  for (let j = 0; j < 24; j++) {
    ring(TOWER_FLOOR, hole, rin, j * 15, (j + 1) * 15, UP);
    if (hole) {
      ring(TOWER_FLOOR - 0.06, hole, rin, j * 15, (j + 1) * 15, [0, -1, 0], 0.7);
      wood.quad([P(j * 15, hole, TOWER_FLOOR - 0.06), P(j * 15 + 15, hole, TOWER_FLOOR - 0.06), P(j * 15 + 15, hole, TOWER_FLOOR), P(j * 15, hole, TOWER_FLOOR)], [[0, 0], [0.27, 0], [0.27, 0.06], [0, 0.06]], mul(out(j * 15 + 7.5), -1), tone * 0.7);
      const pts: number[] = [];
      for (const a of [j * 15, j * 15 + 15]) for (const r of [hole, rin]) for (const y of [-0.2, TOWER_FLOOR]) pts.push(...P(a, r, y));
      put({ t: 'hull', pts, feet: false, surface: 'wood', name: 'tower floor' });
    }
  }
  {
    const half = halfAt(holes[0], rin) + 2;
    wood.quad([P(tw.door - half, rin, 0), P(tw.door + half, rin, 0), P(tw.door + half, rin, TOWER_FLOOR), P(tw.door - half, rin, TOWER_FLOOR)], [[0, 0], [1, 0], [1, TOWER_FLOOR], [0, TOWER_FLOOR]], out(tw.door), tone * 0.8);
  }
  if (!hole) disc('tower floor', -0.2, TOWER_FLOOR, rin);

  // ---- the stair round the inside of the wall, and the rail on its open side
  const S = tw.stair, sg = Math.sign(S.sweep), N = Math.round(T.deck / 0.2), da = S.sweep / N, rise = T.deck / N, ri = T.stairIn, ro = rin - 0.02, mid = (ri + ro) / 2;
  /** whether the wall still stands at a place round it, to bear a tread at this height */
  const borne = (a: number, y: number) => rimAt(a) > y + 0.15;
  /** whether enough of the wall stands over the boards for there to be a platform at all */
  let ringed = 0;
  for (let j = 0; j < 48; j++) if (rimAt(j * 7.5 + 3.75) >= T.deck && !(norm360((j * 7.5 + 3.75 - tw.well[0]) * sg) < Math.abs(tw.well[1] - tw.well[0]))) ringed++;
  const decked = ringed >= 14;
  for (let i = 0; i < N; i++) {
    const a0 = S.from + da * i, a1 = a0 + da, y = (i + 1) * rise, lap = sg * 0.6;
    if (!borne((a0 + a1) / 2, y)) continue;
    // (each tread laps the one under it; its boards lie across the way up)
    const top = [P(a0 - lap, ri, y), P(a1, ri, y), P(a1, ro, y), P(a0 - lap, ro, y)], am = (a0 + a1) / 2, uv = top.map((p): UV => [dot(p, round(am)), dot(p, out(am))]);
    wood.quad(top, uv, UP, tone);
    wood.quad(top.map((p): V3 => [p[0], p[1] - 0.05, p[2]]), uv, [0, -1, 0], tone * 0.8);
    for (const [a, face] of [[a0 - lap, -sg], [a1, sg]] as [number, number][]) wood.quad([P(a, ri, y - 0.05), P(a, ro, y - 0.05), P(a, ro, y), P(a, ri, y)], [[ri, 0], [ro, 0], [ro, 0.05], [ri, 0.05]], mul(round(a), face), tone * 0.85);
    wood.quad([P(a0 - lap, ri, y - 0.05), P(a1, ri, y - 0.05), P(a1, ri, y), P(a0 - lap, ri, y)], [[0, 0], [0.26, 0], [0.26, 0.05], [0, 0.05]], mul(out((a0 + a1) / 2), -1), tone * 0.85);
    // the string under its open edge
    timber(wood, P(a0, ri + 0.05, y - rise - 0.15), P(a1, ri + 0.05, y - 0.15), 0.06, 0.2, tone * 0.9);
  }
  // (the rail goes up with it as far as the platform lets it; from there the platform's own rail stands over the stair)
  const posts: V3[] = [];
  for (let i = 0; i < N && (i + 1) * rise + RAIL.top < T.deck - 0.12 && borne(S.from + da * (i + 2.5), (i + 3) * rise); i += 2) posts.push(P(S.from + da * (i + 0.5), ri + 0.04, (i + 1) * rise));
  for (let i = 0; i + 1 < posts.length; i++) railRun(wood, put, posts[i], posts[i + 1], tone, 'tower stair rail');
  // what is walked on: the slope under the treads, in short lengths round the wall, from a tread before the first
  // to a tread short of the last (a round stair is a twisted slope: each length of it is flat, and near enough)
  for (let j = 0; j < 2 * N; j++) {
    const am = S.from - da + (da / 2) * (j + 0.5), y = (T.deck * (j + 0.5)) / (2 * N), tilt = Math.atan(rise / 2 / (mid * rad(Math.abs(da) / 2)));
    if (!borne(am + da, y)) continue;
    const z = unit(add(mul(round(am), sg * Math.cos(tilt)), mul(UP, Math.sin(tilt)))), x = mul(out(am), sg), yy = cross(z, x);
    put(boxSolid(sub(P(am, mid, y), mul(yy, SLOPE_HALF)), [x, yy, z], [(rin - ri) / 2, SLOPE_HALF, rin * Math.tan(rad(Math.abs(da) / 4)) + 0.03], true, 'wood', 'tower stair'));
  }

  // ---- the platform under the rim: all of the round but the well the stair comes up in
  const D = T.deck, well0 = tw.well[0], wide = Math.abs(tw.well[1] - tw.well[0]), inWell = (a: number) => norm360((a - well0) * sg) < wide;
  // (a tower that has lost its wall has lost its platform: the head of its stair is all there is up there)
  if (!decked) {
    if (borne(tw.well[1] - da / 2, D - 0.3)) {
      const pts: number[] = [];
      for (const a of [tw.well[1] - da, tw.well[1] - da / 2, tw.well[1]]) for (const r of [ri, rin]) for (const y of [D - 0.1, D]) pts.push(...P(a, r, y));
      put({ t: 'hull', pts, feet: true, surface: 'wood', name: 'tower stair head' });
    }
    return;
  }
  for (let j = 0; j < 24; j++) for (const [y, face, k] of [[D, UP, 1], [D - 0.1, [0, -1, 0], 0.75]] as [number, V3, number][]) ring(y, 0, ri, j * 15, (j + 1) * 15, face, k);
  for (let j = 0; j < 48; j++) {
    const a0 = j * 7.5, a1 = a0 + 7.5;
    // (where the wall has come down the boards it bore have gone with it: the platform is ragged there, and open)
    if (rimAt(a0 + 3.75) < D) continue;
    if (inWell(a0 + 3.75)) {
      // (the edge of the boards, round the well)
      wood.quad([P(a0, ri, D - 0.1), P(a1, ri, D - 0.1), P(a1, ri, D), P(a0, ri, D)], [[0, 0], [0.15, 0], [0.15, 0.1], [0, 0.1]], out(a0 + 3.75), tone * 0.8);
      continue;
    }
    ring(D, ri, rin, a0, a1, UP);
    ring(D - 0.1, ri, rin, a0, a1, [0, -1, 0], 0.75);
  }
  wood.quad([P(well0, ri, D - 0.1), P(well0, rin, D - 0.1), P(well0, rin, D), P(well0, ri, D)], [[ri, 0], [rin, 0], [rin, 0.1], [ri, 0.1]], mul(round(well0), sg), tone * 0.8);
  // two joists under it, where no head comes up: across the middle square to the well, and along the side away from it
  const wc = well0 + (sg * wide) / 2;
  timber(wood, P(wc + 90, rin, D - 0.21), P(wc - 90, rin, D - 0.21), 0.18, 0.22, tone * 0.85);
  timber(wood, P(wc + 180 - 57, rin, D - 0.21), P(wc + 180 + 57, rin, D - 0.21), 0.18, 0.22, tone * 0.85);
  // what holds a body up there: the middle of it, and the ring in lengths; the last tread of the stair is one of them
  disc('tower platform', D - 0.1, D, ri + 0.02);
  for (let j = 0; j < 48; j++) {
    if (inWell(j * 7.5 + 3.75) || rimAt(j * 7.5 + 3.75) < D) continue;
    const pts: number[] = [];
    for (const a of [j * 7.5, j * 7.5 + 7.5]) for (const r of [ri, rin]) for (const y of [D - 0.1, D]) pts.push(...P(a, r, y));
    put({ t: 'hull', pts, feet: false, surface: 'wood', name: 'tower platform' });
  }
  {
    const pts: number[] = [];
    for (const a of [tw.well[1] - da, tw.well[1] - da / 2, tw.well[1]]) for (const r of [ri, rin]) for (const y of [D - 0.1, D]) pts.push(...P(a, r, y));
    put({ t: 'hull', pts, feet: true, surface: 'wood', name: 'tower stair head' });
  }
  // a rail along the open edge of the middle, over the stair, and one across the ring where the well begins.
  // (What stops a body goes down as well as up: whoever is on the last of the stair does not step in under the boards.)
  for (let k = 0, m = 4, each = (wide - Math.abs(da)) / m; k < m; k++) railRun(wood, put, P(well0 + sg * k * each, ri - 0.05, D), P(well0 + sg * (k + 1) * each, ri - 0.05, D), tone, 'tower platform rail', 1.3);
  railRun(wood, put, P(well0 - sg * 1.5, ri - 0.05, D), P(well0 - sg * 1.5, rin - 0.04, D), tone, 'tower platform rail');
}

/** a tower's door to the terrace, how wide its windows are, and how wide a hole where its stones have gone */
export const TOWER_DOOR = { w: 1.0, h: 2.1 };
export const SLIT_WIDE = 0.7;
export const LOST_WIDE = 0.62;

// ------------------------------------------------------------------ the whole of it

/** a piece that stands on the ground, at the height the ground is there */
function lifted(p: Part, g: number): Part {
  switch (p.t) {
    case 'box': return { ...p, y0: p.y0 + g, y1: p.y1 + g };
    case 'wall': return { ...p, y0: p.y0 + g, top: typeof p.top === 'number' ? p.top + g : p.top.map((t) => t + g), openings: p.openings?.map((o) => ({ ...o, y0: o.y0 + g, y1: o.y1 + g })) };
    case 'lump': return { ...p, y: p.y + g };
    default: return p;
  }
}

function emit(p: Part, of: (paint: Paint) => Out, solids: Solid[] | null, lod: number, ground: (x: number, z: number) => number, gaps: Gap[] = [], ways: Way[] = []) {
  const body: Body = p.body ?? 'all';
  const put: Put = (s) => void (solids && body !== 'none' && solids.push(s));
  const o = p.hidden ? VOID : of(p.paint);
  // (a wall that stands on another wall has no floor at its foot for snow to drift against: the upper shell of the keep)
  o.base = p.t === 'wall' && p.y0 > 0.1 && /^keep .* face$/.test(p.name ?? '') ? null : p.t === 'box' || p.t === 'wall' ? p.y0 : p.t === 'tower' ? 0 : p.t === 'lump' ? p.y - p.ry : p.t === 'flight' ? p.foot[1] : null;
  o.ground = !!p.sits || p.t === 'apron';
  o.roofed = !!p.roofed;
  o.walked = p.paint === 'paving';
  if (p.t === 'tower') of('timber').base = of('base').base = null;
  if (p.t === 'wall' && p.paint === 'stone') Object.assign(of('base'), { base: o.base, ground: o.ground, roofed: o.roofed });
  if (p.t === 'box' && p.name === 'footing') {
    // (the footing under a wall gives way to a hatch's passage where one goes through it, under the ground: it is
    // made in pieces round the passage)
    const through = gaps.filter((g) => g.x > p.x0 - 0.2 && g.x < p.x1 + 0.2 && g.z > p.z0 - 0.2 && g.z < p.z1 + 0.2);
    if (through.length) {
      const alongZ = p.z1 - p.z0 > p.x1 - p.x0, at = (g: Gap) => (alongZ ? g.z : g.x), lo = Math.min(...through.map(at)) - 1.1, hi = Math.max(...through.map(at)) + 1.1;
      const piece = (a: number, b: number, ya: number, yb: number) => void (b - a > 0.05 && yb - ya > 0.05 && boxPart(alongZ ? { ...p, z0: a, z1: b, y0: ya, y1: yb } : { ...p, x0: a, x1: b, y0: ya, y1: yb }, o, put));
      const [u0, u1] = alongZ ? [p.z0, p.z1] : [p.x0, p.x1];
      piece(u0, lo, p.y0, p.y1);
      piece(hi, u1, p.y0, p.y1);
      piece(lo, hi, through[0].y1, p.y1);
      piece(lo, hi, p.y0, through[0].y0);
      return;
    }
  }
  switch (p.t) {
    case 'box': return boxPart(p, o, put);
    case 'slab': return slabPart(p, o, put);
    case 'beam': return beamPart(p, o, put);
    case 'rail': return railRun(o, put, (p as Rail).a, p.b, p.tone, p.name);
    case 'flight': return flightPart(p, o, put);
    case 'wall': return wallPart(p, o, p.hidden || p.paint !== 'stone' ? o : of('base'), put, lod);
    case 'curtain': return curtainPart(p, o, put, lod, gaps);
    case 'tower': return towerPart(p, o, of('timber'), of('base'), put, lod);
    case 'mound': return moundPart(p, o, put, lod, ground, ways);
    case 'lump': return lumpPart(p, o, put, lod);
    case 'apron': return apronPart(p, o, put, ground);
    case 'vault': return vaultPart(p, o);
  }
}

/**
 * The fort as shapes, and the loose pieces of its grounds with it.
 * @param ground how high the ground is at a spot, over the terrace (the loose pieces stand on it)
 * @param loose the loose pieces, in the fort's own measure: where nobody has said, where the real ones stand
 * @param rock whether the rock the ramp leaves from is made (not where the mountain itself comes up to the ramp's foot)
 */
export function castleShape(ground: (x: number, z: number) => number = castleGround, loose: Loose[] = LOOSE, rock = true, tally?: Record<string, number>): Shape {
  const sheets = () => Object.fromEntries(SHEETS.map((p) => [p, skin()])) as Record<Sheet, Skin>;
  const near = sheets(), under = sheets(), far = skin(), solids: Solid[] = [];
  const all = [...castleParts().filter((p) => rock || !/outcrop|ramp head/.test(p.name ?? '')), ...loose.flatMap((l) => looseParts(l, ground(l.x, l.z)))].map((raw) => (raw.sits ? lifted(raw, ground(raw.sits[0], raw.sits[1])) : raw));
  // (the blocks that hide what lies against them: those that are seen, stop everything, and stand square to the fort)
  const hides = hidesOf(all.flatMap((p): Hide[] => (p.t === 'box' && !p.hidden && !p.yaw && p.paint !== 'water' && p.at !== 'far' && (p.body ?? 'all') === 'all' ? [{ x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1, z0: p.z0, z1: p.z1, by: WARP[p.paint], low: !!p.low }] : [])));
  const outs = (to: Record<Sheet, Skin>, low: boolean) => Object.fromEntries(PAINTS.map((p) => [p, new Out(to[STUFF[p].sheet], TILE[p], STUFF[p].tint, MOTTLE[p], PIECE[p], WARP[p], hides, low)])) as Record<Paint, Out>;
  const nears = outs(near, false), unders = outs(under, true);
  const fars = Object.fromEntries(PAINTS.map((p) => [p, new Out(far, 1, FAR_TINT[p], MOTTLE[p], 0, WARP[p])])) as Record<Paint, Out>;
  // (where each hatch's passage goes through the foot of a wall, half way between its ends)
  const gaps: Gap[] = loose.filter((l) => l.kind === 'hatch').flatMap((l) => {
    // (along the last eight metres of its passage, by the fort)
    const L = hatchLine(l, ground(l.x, l.z)), b = L.path[L.path.length - 1], a = L.path[L.path.length - 2], len = Math.hypot(a[0] - b[0], a[2] - b[2]), out: Gap[] = [];
    for (let d = 0.3; d <= Math.min(len, 8); d += 0.7) {
      const y = b[1] + ((a[1] - b[1]) * d) / len;
      out.push({ x: b[0] + ((a[0] - b[0]) * d) / len, z: b[2] + ((a[2] - b[2]) * d) / len, y0: y - 0.6, y1: y + UNDER.hatch.tall + 0.7 });
    }
    return out;
  });
  const ways: Way[] = loose.filter((l) => l.kind === 'hatch').map((l) => ({ L: hatchLine(l, ground(l.x, l.z)), g: ground(l.x, l.z) }));
  for (const p of all) {
    // (`tally`, for whoever asks what it costs: how many triangles each kind of piece is drawn with from near, by its name)
    const to = p.low ? under : near, was = tally ? SHEETS.reduce((t, s) => t + to[s].pos.length, 0) : 0;
    if (p.at !== 'far') emit(p, (paint) => (p.low ? unders : nears)[paint], solids, 0, ground, gaps, ways);
    if (tally) {
      const key = `${p.low ? 'under' : 'near'} ${p.t} ${p.name ?? ''}`;
      tally[key] = (tally[key] ?? 0) + (SHEETS.reduce((t, s) => t + to[s].pos.length, 0) - was) / 9;
    }
    if (p.at) emit(p, (paint) => fars[paint], null, 1, ground, gaps, ways);
  }
  // ---- the kit's pieces (the walls, the gatehouse, blocks of fallen wall): what stops a body, as the kit says; and
  // from far off a block for each block of theirs, less what has been broken out
  for (const k of kitSolids(castleKit())) solids.push(k.t === 'box' ? { ...k, feet: false, surface: 'concrete' } : { t: 'hull', pts: k.pts, feet: false, surface: 'concrete', name: k.name });
  for (const p of castleKit()) {
    const m = kitMatrix(p), sc = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : p.scale ?? [1, 1, 1];
    if (sc[0] < 0.3) continue;
    const ax = [0, 1, 2].map((k) => unit([m[k * 4], m[k * 4 + 1], m[k * 4 + 2]]));
    for (const b of kitBlocks(p.id) ?? []) {
      const c = kitPoint(m, [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2]);
      if ((p.cut ?? []).some((k) => inCut(k, c))) continue;
      fars.stone.base = null;
      block(fars.stone, c, ax, [((b[1] - b[0]) / 2) * sc[0], ((b[3] - b[2]) / 2) * sc[1], ((b[5] - b[4]) / 2) * sc[2]], 0.9);
    }
  }
  if (tally) tally['left out, never seen'] = hides.count;
  return { near, under, far, solids };
}
