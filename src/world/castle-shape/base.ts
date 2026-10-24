// The fort's shape, its ground floor: what a shape is made of (sheets, paints, pictures), the little sums every part uses, the weathering and the sky on its stone, what hides what.
// (One part of castle-shape.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { type V3, type Paint, type Tower, CASTLE, castleParts, towerRadius, UNDER } from '../../sim/castle';

export type Quat = [number, number, number, number];

/** what a thing sounds like underfoot and when it is hit ('grass': it is the world's own ground, which says for itself what it is at each spot: the slabs under ground that was cut) */
export type Surf = 'rock' | 'concrete' | 'wood' | 'metal' | 'grass';

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
/** (`farOwn`: how many of the far shape's triangles, from its first, are the fort's own: those after them are blocks that stand for the kit's pieces, until the kit's own far copy has come) */
export interface Shape { near: Record<Sheet, Skin>; under: Record<Sheet, Skin>; far: Skin; farOwn: number; solids: Solid[] }

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
export const FAR_TINT: Record<Paint, V3> = { stone: [0.2, 0.198, 0.195], ashlar: [0.225, 0.22, 0.215], base: [0.15, 0.15, 0.146], paving: [0.195, 0.19, 0.188], timber: [0.2, 0.165, 0.13], iron: [0.05, 0.05, 0.05], rock: [0.4, 0.4, 0.4], scree: [0.33, 0.32, 0.3], earth: [0.4, 0.36, 0.26], water: [0.05, 0.06, 0.07] };

export const SURF: Record<Paint, Surf> = { stone: 'concrete', ashlar: 'concrete', base: 'concrete', paving: 'concrete', timber: 'wood', iron: 'metal', rock: 'rock', scree: 'rock', earth: 'rock', water: 'rock' };

// ------------------------------------------------------------------ small sums

export const UP: V3 = [0, 1, 0];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

export const unit = (a: V3): V3 => mul(a, 1 / (len(a) || 1));

export const rad = (deg: number) => (deg * Math.PI) / 180;

export const norm360 = (a: number) => ((a % 360) + 360) % 360;

/** how far one direction is from another, degrees, 0..180 */
export const apart = (a: number, b: number) => Math.abs(norm360(a - b + 180) - 180);

export const hash = (i: number, j: number, s: number) => {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** numbers in order, with none twice */
export const sorted = (xs: Iterable<number>, eps = 1e-4) => [...xs].sort((p, q) => p - q).filter((x, i, all) => i === 0 || x - all[i - 1] > eps);

/** what of the stretches `a` is in none of the stretches `b` */
export const minus = (a: [number, number][], b: [number, number][]) => {
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
export const weather = (y: number) => 0.78 + 0.2 * Math.min(1, Math.max(0, 1 + y / 9));

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
export const MOTTLE: Record<Paint, number> = { stone: 0.36, ashlar: 0.36, base: 0.38, paving: 0.3, timber: 0.18, iron: 0, rock: 0.2, scree: 0.2, earth: 0, water: 0 };

/** a flat face is cut for it until no piece is longer than this: finely where the picture is plain (dressed blocks, paving), coarsely where it is busy; 0: not at all */
export const PIECE: Record<Paint, number> = { stone: 2.3, ashlar: 2.3, base: 2.6, paving: 1.25, timber: 0, iron: 0, rock: 0, scree: 0, earth: 0, water: 0 };

/*
 * THE MASONRY IS LAID WHERE THE PLAN HAS IT. (It was bent a few centimetres sideways by a slow pattern, a wall
 * bellying as old stone does; every join of it then had to be cut along a lattice to stay closed, which was twice the
 * triangles, and laid flat it cannot be told from it: the owner, 2026-10-23, "fort should have no gaps", "we want to
 * make sure all new additions are performant". So what meets in the plan meets as drawn, and costs nothing for it.)
 */

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
    // (a room with windows and a door has some of the day in it; the upper room, whose corner is open to the sky, more)
    return x > K.fallen.x0 && z > K.fallen.z0 && y > K.floors[2] - 0.25 ? 1 : y > K.floors[2] - 0.25 ? 0.4 : 0.32;
  }
  for (const tw of towers) {
    const dx = x - tw.cx, dz = z - tw.cz;
    if (dx * dx + dz * dz > (T.r - T.wall + 0.03) ** 2 || y > T.deck - 0.03 || y < -0.3) continue;
    const a = norm360((Math.atan2(dz, dx) * 180) / Math.PI), inWell = norm360((a - tw.well[0]) * Math.sign(tw.stair.sweep)) < Math.abs(tw.well[1] - tw.well[0]);
    return inWell || tw.rim[Math.floor(a / (360 / T.slots)) % T.slots] < T.deck ? 1 : 0.25;
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

export type UV = [number, number];

/**
 * WHAT IS NEVER SEEN IS NOT DRAWN. The fort's own square blocks, as the rules say them (before the stone is bent):
 * a triangle that lies against one or inside one, with stone before it all the way across (asked at its middle and
 * toward each of its corners, a finger's breadth off its face), is left out: the end of a wall in another wall, the
 * foot of a block on the block under it, two floors edge to edge. No eye is ever in a block, so what one hides is
 * hidden from every eye.
 * `low`: the block is of the lower levels, which are not always drawn: it hides nothing that is drawn without them.
 */
export interface Hide { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; low: boolean }

interface Hides { list: Hide[]; grid: Map<number, number[]>; count: number }

const HIDE_CELL = 2, hideKey = (x: number, z: number) => Math.floor(x / HIDE_CELL) * 4096 + Math.floor(z / HIDE_CELL);

export function hidesOf(list: Hide[]): Hides {
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
export class Out {
  /** @param mottle how much the tone wanders over it; @param cut big faces are cut into pieces no longer than this for that to show (0: they are not) */
  constructor(private s: Skin, private tile: number, private tint: V3, private mottle = 0, private cut = 0, private hides: Hides | null = null, private low = false) {}
  /** whether one of the fort's blocks has a whole triangle in it (see Hide): its middle, and each corner a little out in front of the face */
  private hid(p: V3[], mid: V3, n: V3): boolean {
    const H = this.hides!;
    // (a corner may lie on the block's very edge: it is asked of the block grown by a millimetre)
    const inside = (b: Hide, q: V3, e: number) => q[0] > b.x0 + e && q[0] < b.x1 - e && q[2] > b.z0 + e && q[2] < b.z1 - e && q[1] > b.y0 + e && q[1] < b.y1 - e;
    // (all in ONE block: with each corner in some block, a floor's corner in one wall and the rest in the wall across
    // the corner, the strip of floor between the two was open: by the head of the keep's stair down, 2026-10-23)
    for (const i of H.grid.get(hideKey(mid[0], mid[2])) ?? []) {
      const b = H.list[i];
      if ((!b.low || this.low) && inside(b, mid, 0.004) && p.every((c) => inside(b, [c[0] + n[0] * 0.006, c[1] + n[1] * 0.006, c[2] + n[2] * 0.006], -0.001))) return true;
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
  /** where a rail's post has been stood already (see `railRun`) */
  posts = new Set<string>();
  private put(q: V3, n: V3, t: UV, tone: number) {
    // (snow drifts against the foot of a thing only where there is a floor for it to lie on: not at the foot of the
    // parapet's outer face, which is the top of the wall under it)
    const floor = this.ground || (Math.abs(q[0] + n[0] * 0.4) < CASTLE.hx + CASTLE.parapet.thick / 2 - 0.05 && Math.abs(q[2] + n[2] * 0.4) < CASTLE.hz + CASTLE.parapet.thick / 2 - 0.05);
    // (the second number: of an upright face, how high over its foot; of a floor that is walked on, how far from the nearest wall)
    this.s.snow.push(this.roofed ? 0 : sky(q, n), n[1] > 0.9 && this.walked ? fromWall(q) : this.base === null || !floor ? 9 : Math.max(0, q[1] - this.base));
    const k = tone * (this.mottle ? 1 - this.mottle / 2 + this.mottle * clouds(q) : 1);
    this.s.pos.push(q[0], q[1], q[2]);
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
      // (each corner itself: asked a sixth of the way in from each, a triangle whose corner stood out over the top of a
      // block by up to a sixth of it was left out whole, and a notch was open there into the wall: the keep's shell over
      // the walk round its roof, 2026-10-23)
      if (this.hid(p, mid, n)) return void this.hides.count++;
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

export const skin = (): Skin => ({ pos: [], nrm: [], uv: [], col: [], snow: [] });

/** where what is not seen is drawn */
export const VOID = new Out(skin(), 1, [1, 1, 1]);

/** which way a picture of boards goes on a block: not at all (courses run level); along its length; across it */
export type Grain = 0 | 1 | 2;
