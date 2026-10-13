// The shape of each piece of the ruined town, worked out from its parts (src/sim/ruins.ts): what is drawn, as
// triangles joined by what they are painted with, and what stops a body, as plain boxes, hulls and sheets. No
// pictures and no physics here: src/world/ruins.ts paints the one and makes the other solid, and a test can count
// both without a screen (test/ruins.test.ts).
//
// A wall is drawn from the lengths it is cut into (`wallLengths`): two faces, a top, and an end wherever the next
// length is lower or there is a way through. Its faces are not flat: every corner of every length is pushed in or
// out a little by where it is, the same for whichever length asks, so that a wall of rubble has the lumps of one
// and no length shows as a slab.

import * as THREE from 'three';
import { hash, rough, ruinBase, ruinParts, wallLengths, type Beam, type Body, type Flight, type Floor, type Heap, type Length, type Lump, type Paint, type Part, type Piece, type Rail, type Slab, type V2, type V3, type Wall } from '../sim/ruins';

/** what a thing sounds and marks like when it is trodden on or hit */
export type Ground = 'rock' | 'dirt' | 'gravel' | 'wood';
/** `far`: it is big enough to be part of the piece as it is drawn from far off, and is of this paint */
export type Solid =
  | { k: 'box'; x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number; body: Body; ground: Ground; far?: Paint }
  | { k: 'hull'; pts: number[]; body: Body; ground: Ground; far?: Paint }
  | { k: 'sheet'; verts: number[]; index: number[]; body: Body; ground: Ground; far?: Paint };
/** which of two materials a part is drawn with: everything of stone and of earth is one, timber the other */
export type Stuff = 'masonry' | 'timber';
export interface Drawn { stuff: Stuff; near: boolean; geometry: THREE.BufferGeometry; tris: number }
export interface Shape { drawn: Drawn[]; solids: Solid[] }

/**
 * What each paint is: THE ONE PLACE the town's pictures are chosen. A picture of the game's, the colour it is
 * washed with (more than 1 lightens it), how many metres of wall or floor one repeat of it covers, and the colour
 * the picture comes to taken all together (what the town is painted with from far off, where it has no pictures).
 *   stone  – rubble limestone in pale mortar: `medieval_blocks_06` (Poly Haven, CC0), warm pitted stones in heavy
 *            mortar, washed half way to the grey of stone the sun has bleached.
 *   core   – the heart of a wall, on its broken top and ends: earth rammed with stones, tan. `rocks_ground_02`,
 *            which the ground of the map is already made of.
 *   earth  – trodden ground with stones in it: floors of courts, heaps of fallen stone, sand against a wall.
 *   paving – what is walked on along a wall's top and through a gate: the same, paler.
 *   timber – old boards: `weathered_planks`, which every house of the map has loaded already.
 * (Tried and taken out: plain tan for the heart of a wall, which read as boxes nobody had painted; stained plaster
 * for floors, which read as a screed laid last year; render with brick showing for the stone, which was dark.)
 */
export const PAINTS: Record<Paint, { tex: string; tint: V3; tile: number; mean: V3 }> = {
  stone: { tex: 'medieval_blocks_06', tint: [1.3, 1.36, 1.44], tile: 2.3, mean: [0.297, 0.191, 0.114] },
  core: { tex: 'rocks_ground_02', tint: [1.75, 1.5, 1.14], tile: 2.4, mean: [0.154, 0.111, 0.058] },
  earth: { tex: 'rocks_ground_02', tint: [1.5, 1.38, 1.16], tile: 2.4, mean: [0.154, 0.111, 0.058] },
  paving: { tex: 'rocks_ground_02', tint: [1.62, 1.5, 1.3], tile: 2.4, mean: [0.154, 0.111, 0.058] },
  timber: { tex: 'weathered_planks', tint: [1.25, 1.12, 0.95], tile: 1.7, mean: [0.08, 0.056, 0.043] },
};
/** metres of wall or floor to one repeat of each picture */
export const TILE = Object.fromEntries(Object.entries(PAINTS).map(([k, v]) => [k, v.tile])) as Record<Paint, number>;
/** a point's colour is kept in a byte for each of red, green and blue: this is what the brightest byte stands for (the material it is drawn with is made that much brighter) */
export const BRIGHT = 2.9;
const GROUND: Record<Paint, Ground> = { stone: 'rock', core: 'rock', earth: 'dirt', paving: 'rock', timber: 'wood' };
/** how far apart the lines are, up a wall, at which its face is pushed in or out */
const ROW = 1.25;
/** a colour a point is washed with: one for a whole face, or one for each of its corners */
type Wash = number | V3 | V3[];
const washOf = (w: Wash, k: number): number | V3 => (Array.isArray(w) && Array.isArray(w[0]) ? (w as V3[])[k] : (w as number | V3));
/** sand, as it lies against the foot of a wall; and what runs down a wall from its top */
const SAND: V3 = [1.2, 1.09, 0.9], STREAK: V3 = [0.62, 0.6, 0.56];
/** the tan of a wall's heart, where its facing has come away */
const BARE: V3 = [1.2, 1.02, 0.78];

/** the points of everything that is drawn with one material, three to a face */
class Store {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  /** @param dry nothing is kept: for when only what stops a body is wanted */
  constructor(readonly dry: boolean) {}
  /**
   * Kept small, for there are a hundred thousand faces of it: a point's normal in four bytes, its colour in three
   * and which of the two pictures it is painted with (stone, or earth) in a fourth; no list of which points make
   * which face (they are in order). Twenty-eight bytes a point.
   */
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry(), n = this.pos.length / 3, nor = new Int8Array(n * 4), col = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) nor[i * 4 + k] = Math.round(this.nor[i * 3 + k] * 127);
      for (let k = 0; k < 4; k++) col[i * 4 + k] = Math.round(Math.min(1, this.col[i * 4 + k]) * 255);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 4, true));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4, true));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** one paint's way into a store: its faces go in washed with its colour and laid at its picture's size */
class Buf {
  private tint: V3;
  private layer: number;
  readonly tile: number;
  constructor(private store: Store, paint: Paint) {
    this.tint = PAINTS[paint].tint;
    this.tile = PAINTS[paint].tile;
    this.layer = paint === 'stone' || paint === 'timber' ? 0 : 1;
  }
  /** a point of the face, lit or shaded a little by where it is: no two stretches of a wall are one tone */
  private put(p: V3, n: V3, u: number, v: number, lift: number | V3 = 1) {
    const t = (0.78 + 0.36 * rough(p[0] * 0.19 + p[1] * 0.27, p[2] * 0.19 - p[1] * 0.21, 3)) / BRIGHT, c = typeof lift === 'number' ? [lift, lift, lift] : lift, S = this.store;
    S.pos.push(p[0], p[1], p[2]);
    S.nor.push(n[0], n[1], n[2]);
    S.uv.push(u / this.tile, v / this.tile);
    S.col.push(t * c[0] * this.tint[0], t * c[1] * this.tint[1], t * c[2] * this.tint[2], this.layer);
  }
  /** three points, anticlockwise as seen from outside; `uv` says where on the picture each is, in metres (left out: by where it is in the world, on whichever plane the face lies nearest) */
  tri(a: V3, b: V3, c: V3, uv?: [V2, V2, V2], lift: Wash = 1) {
    if (this.store.dry) return;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l;
    ny /= l;
    nz /= l;
    const n: V3 = [nx, ny, nz];
    const flat = (p: V3): V2 => (Math.abs(ny) > 0.7 ? [p[0], p[2]] : Math.abs(nx) > Math.abs(nz) ? [p[2], p[1]] : [p[0], p[1]]);
    const [ta, tb, tc] = uv ?? [flat(a), flat(b), flat(c)];
    this.put(a, n, ta[0], ta[1], washOf(lift, 0));
    this.put(b, n, tb[0], tb[1], washOf(lift, 1));
    this.put(c, n, tc[0], tc[1], washOf(lift, 2));
  }
  quad(a: V3, b: V3, c: V3, d: V3, uv?: [V2, V2, V2, V2], lift: Wash = 1) {
    const pick = (i: number, j: number, k: number): Wash => (Array.isArray(lift) && Array.isArray(lift[0]) ? [(lift as V3[])[i], (lift as V3[])[j], (lift as V3[])[k]] : lift);
    this.tri(a, b, c, uv && [uv[0], uv[1], uv[2]], pick(0, 1, 2));
    this.tri(a, c, d, uv && [uv[0], uv[2], uv[3]], pick(0, 2, 3));
  }
  /** a block from its eight corners: the four of its foot in order round it, and the four over them */
  block(f: [V3, V3, V3, V3], t: [V3, V3, V3, V3], foot = false) {
    for (let k = 0; k < 4; k++) {
      const j = (k + 1) % 4;
      this.quad(f[k], f[j], t[j], t[k]);
    }
    this.quad(t[0], t[1], t[2], t[3]);
    if (foot) this.quad(f[3], f[2], f[1], f[0]);
  }
}

class Bufs {
  private stores = new Map<string, Store>();
  private all = new Map<string, Buf>();
  constructor(readonly dry = false) {}
  /** (timber is small and is all inside: it is drawn only from near, whatever is asked) */
  get(paint: Paint, near = false): Buf {
    const stuff: Stuff = paint === 'timber' ? 'timber' : 'masonry', far = !near && stuff !== 'timber', key = `${paint}|${far ? 0 : 1}`;
    let b = this.all.get(key);
    if (!b) {
      const at = `${stuff}|${far ? 0 : 1}`;
      let store = this.stores.get(at);
      if (!store) this.stores.set(at, (store = new Store(this.dry)));
      this.all.set(key, (b = new Buf(store, paint)));
    }
    return b;
  }
  drawn(): Drawn[] {
    return [...this.stores].filter(([, b]) => b.pos.length).map(([key, b]) => ({ stuff: key.split('|')[0] as Stuff, near: key.endsWith('1'), geometry: b.geometry(), tris: b.pos.length / 9 }));
  }
}

const smooth01 = (t: number) => {
  const v = Math.min(1, Math.max(0, t));
  return v * v * (3 - 2 * v);
};
/** the heights between two at which a wall's face has a line of corners */
const rows = (a: number, b: number): number[] => {
  const out: number[] = [];
  for (let k = Math.ceil((a + 0.3) / ROW); k * ROW < b - 0.3; k++) out.push(k * ROW);
  return out;
};
/** what is left of the stretches `a` when the stretches `b` are taken out of them */
function less(a: [number, number][], b: [number, number][]): [number, number][] {
  let out = a;
  for (const [lo, hi] of b) {
    const next: [number, number][] = [];
    for (const [p, q] of out) {
      if (hi <= p + 1e-4 || lo >= q - 1e-4) next.push([p, q]);
      else {
        if (lo > p + 1e-4) next.push([p, lo]);
        if (hi < q - 1e-4) next.push([hi, q]);
      }
    }
    out = next;
  }
  return out;
}

function wallShape(piece: Piece, w: Wall, B: Bufs, solids: Solid[]) {
  const L = wallLengths(w);
  if (!L.length) return;
  const paint = w.paint ?? 'stone', face = B.get(paint, w.near), top = B.get(w.cap ?? (w.ruin ? 'core' : paint), w.near);
  // where each stretch between two points begins and ends along the wall
  const n = w.pts.length, spans = w.closed ? n : n - 1, from: number[] = [0];
  for (let i = 0; i < spans; i++) from.push(from[i] + Math.hypot(w.pts[(i + 1) % n][0] - w.pts[i][0], w.pts[(i + 1) % n][1] - w.pts[i][1]));
  const seed = w.ruin?.seed ?? Math.round(w.pts[0][0] * 7 + w.pts[0][1] * 13), broken = !!w.ruin && w.ruin.bite > 0, amp = Math.min(0.09, w.thick * 0.08);
  /** a broken wall of stone has lost its facing in patches: it is hollowed a hand's breadth there, and the tan of its heart shows through */
  const worn = broken && w.thick >= 0.9 && paint === 'stone';
  const patch = (s: number, y: number, side: number) => rough(s * 0.31 + side * 17.3, y * 0.31, seed + 9);
  /** which way is out of the wall at a corner of a length (at a turn of the wall: the way the two faces' meeting points) and how far out that corner is of the wall's middle */
  const outward = (len: Length, end: 0 | 1, side: 1 | -1): [number, number, number] => {
    const l = end ? len.l1 : len.l0, r = end ? len.r1 : len.r0, q = side > 0 ? l : r, ox = q[0] - (l[0] + r[0]) / 2, oz = q[1] - (l[1] + r[1]) / 2, ol = Math.hypot(ox, oz) || 1;
    return [ox / ol, oz / ol, ol];
  };
  /** what the wall's face meets at its foot there: a floor of the piece, or the ground it is built for (null: neither) */
  const feet = new Map<string, number | null>();
  const base = (len: Length, end: 0 | 1, side: 1 | -1): number | null => {
    const s = end ? len.s1 : len.s0, key = `${side}|${s.toFixed(3)}`;
    let b = feet.get(key);
    if (b === undefined) {
      const q = side > 0 ? (end ? len.l1 : len.l0) : end ? len.r1 : len.r0, [ox, oz] = outward(len, end, side);
      b = ruinBase(piece, q[0] + ox * 0.5, q[1] + oz * 0.5, Math.max(...len.solids.map((q3) => q3[2]), w.foot) + 0.1);
      if (b !== null && b < w.foot + 0.3) b = null;
      feet.set(key, b);
    }
    return b;
  };
  /**
   * A corner of a length: on its left or right face, at its start or its end, at a height. Pushed in or out by
   * where it is (not at all at a turn of the wall, where two faces meet); back where the facing has gone; out at
   * the foot of a wall that is battered; and, along a broken top, a little up or down.
   */
  const P = (len: Length, end: 0 | 1, side: 1 | -1, y: number, cap = false): V3 => {
    const q = side > 0 ? (end ? len.l1 : len.l0) : end ? len.r1 : len.r0, s = end ? len.s1 : len.s0, [ox, oz, ol] = outward(len, end, side);
    const fade = smooth01(Math.min(s - from[len.span], from[len.span + 1] - s) / 0.7);
    let k = amp * fade * (rough(s * 0.62 + side * 31.7, y * 0.62, seed) - 0.5) * 2;
    if (worn) k -= 0.1 * fade * smooth01((patch(s, y, side) - 0.64) / 0.1);
    if (w.batter) {
      const b = base(len, end, side);
      if (b !== null) k += w.batter * Math.min(1, Math.max(0, (b + 2.8 - y) / 2.8)) ** 1.5 * (ol / (w.thick / 2));
    }
    return [q[0] + ox * k, cap && broken ? y + (rough(s * 1.4 + side * 3.3, 7.7, seed) - 0.5) * 0.16 : y, q[1] + oz * k];
  };
  /** the colour a point of a face is washed with: sand to a knee's height over its foot, bleached at its very top, and streaked dark under that where the wet has run */
  const wash = (len: Length, end: 0 | 1, side: 1 | -1, y: number, t: number): V3 => {
    const b = base(len, end, side), s = end ? len.s1 : len.s0, c: V3 = [1, 1, 1];
    const run = hash(Math.round(s * 1.7), side + 5, seed), streak = run > 0.5 ? ((run - 0.5) / 0.5) * (1 - smooth01((t - y) / 2.4)) * smooth01((t - y) / 0.25 + 0.4) : 0;
    const sand = b === null ? 0 : (1 - smooth01((y - b) / 1.0)) * 0.85, pale = 0.12 * (1 - smooth01((t - y) / 0.5));
    const bare = worn ? smooth01((patch(s, y, side) - 0.58) / 0.14) * 0.8 : 0;
    for (let k = 0; k < 3; k++) c[k] = (1 + (STREAK[k] - 1) * streak * 0.9) * (1 + (SAND[k] - 1) * sand) * (1 + (BARE[k] - 1) * bare) * (1 + pale);
    return c;
  };
  if (!w.hidden && !B.dry) {
    L.forEach((len, k) => {
      for (const [f0, f1, t] of len.solids) {
        for (const side of [1, -1] as const) {
          // the heights at which this face has a line of corners: every so often, and where its colour turns (over its foot, under its top)
          const b0 = base(len, 0, side), b1 = base(len, 1, side), low = Math.max(f0, f1);
          const at = [...rows(low, t), t - 0.45, t - 1.3, ...(b0 !== null && b1 !== null ? [Math.max(b0, b1) + 0.45, Math.max(b0, b1) + 1.05] : [])].filter((y) => y > low + 0.2 && y < t - 0.2).sort((p, q) => p - q);
          const ys = [...at.filter((y, i) => i === 0 || y - at[i - 1] > 0.22), t];
          let a = f0, b = f1;
          for (const y of ys) {
            const up = y === t, p0 = P(len, 0, side, a), p1 = P(len, 1, side, b), p2 = P(len, 1, side, y, up), p3 = P(len, 0, side, y, up);
            const uv: [V2, V2, V2, V2] = [[len.s0, a], [len.s1, b], [len.s1, y], [len.s0, y]], col = [wash(len, 0, side, a, t), wash(len, 1, side, b, t), wash(len, 1, side, y, t), wash(len, 0, side, y, t)];
            if (side < 0) face.quad(p0, p1, p2, p3, uv, col);
            else face.quad(p0, p3, p2, p1, [uv[0], uv[3], uv[2], uv[1]], [col[0], col[3], col[2], col[1]]);
            a = b = y;
          }
          // sand drifted against its foot, where it stands in open ground or on a floor: deeper here, none there
          const door = len.solids.length > 1 || (b0 !== null && Math.min(f0, f1) > b0 + 0.3);
          if (b0 !== null && b1 !== null && !door && t > Math.max(b0, b1) + 0.3) {
            const deep = (s: number) => Math.max(0, 0.62 * rough(s * 0.23 + side * 5.1, 3.3, seed + 4) - 0.14), h0 = deep(len.s0), h1 = deep(len.s1);
            if (h0 + h1 > 0.02) {
              const [ox0, oz0] = outward(len, 0, side), [ox1, oz1] = outward(len, 1, side), q0 = P(len, 0, side, b0 + h0), q1 = P(len, 1, side, b1 + h1);
              const r0: V3 = [q0[0] + ox0 * (0.45 + h0 * 2.4), b0 - 0.3, q0[2] + oz0 * (0.45 + h0 * 2.4)], r1: V3 = [q1[0] + ox1 * (0.45 + h1 * 2.4), b1 - 0.3, q1[2] + oz1 * (0.45 + h1 * 2.4)];
              const sandy = B.get('earth', true);
              if (side < 0) sandy.quad(q0, r0, r1, q1, undefined, SAND);
              else sandy.quad(q0, q1, r1, r0, undefined, SAND);
            }
          }
        }
        top.quad(P(len, 0, 1, t, true), P(len, 0, -1, t, true), P(len, 1, -1, t, true), P(len, 1, 1, t, true), undefined, 1.08);
        if (Math.max(f0, f1) > w.foot + 0.01) face.quad(P(len, 0, 1, f0), P(len, 1, 1, f1), P(len, 1, -1, f1), P(len, 0, -1, f0), undefined, 0.72);
        // a stone or two left lying along a broken top
        if (broken && w.thick >= 0.6 && hash(k, 31, seed) < 0.24) {
          const mx = (len.l0[0] + len.l1[0] + len.r0[0] + len.r1[0]) / 4, mz = (len.l0[1] + len.l1[1] + len.r0[1] + len.r1[1]) / 4, big = 0.1 + 0.16 * hash(k, 32, seed);
          lumpShape({ t: 'lump', x: mx, y: t + big * 0.5, z: mz, rx: big * 1.3, ry: big * 0.6, rz: big, yaw: hash(k, 33, seed) * 3, seed: seed + k, near: true, body: 'none' }, B, solids);
        }
      }
      // its ends: against the length before it and the one after, whatever of the one the other does not cover
      const next = k + 1 < L.length ? L[k + 1] : w.closed ? L[0] : null, prev = k > 0 ? L[k - 1] : w.closed ? L[L.length - 1] : null;
      const mine1 = len.solids.map(([, f1, t]): [number, number] => [f1, t]), mine0 = len.solids.map(([f0, , t]): [number, number] => [f0, t]);
      const end = (at: 0 | 1, open: [number, number][]) => {
        for (const [lo, hi] of open) {
          const ys = [lo, ...rows(lo, hi), hi];
          for (let j = 0; j + 1 < ys.length; j++) {
            const capped = j + 2 === ys.length && len.solids.some((q) => Math.abs(q[2] - hi) < 1e-6);
            const a = P(len, at, 1, ys[j]), b = P(len, at, 1, ys[j + 1], capped), c = P(len, at, -1, ys[j + 1], capped), d = P(len, at, -1, ys[j]);
            const uv: [V2, V2, V2, V2] = [[0, ys[j]], [0, ys[j + 1]], [w.thick, ys[j + 1]], [w.thick, ys[j]]];
            // (a broken end shows the wall's heart; the side of a doorway is dressed stone)
            const into = hi - lo > 2.6 || !w.ruin ? face : top;
            if (at) into.quad(a, b, c, d, uv, 0.9);
            else into.quad(d, c, b, a, [uv[3], uv[2], uv[1], uv[0]], 0.9);
          }
        }
      };
      end(1, less(mine1, next ? next.solids.map(([f0, , t]): [number, number] => [f0, t]) : []));
      end(0, less(mine0, prev ? prev.solids.map(([, f1, t]): [number, number] => [f1, t]) : []));
    });
  }
  // what stops a body: a box for every run of lengths that stand as high as one another
  const body = w.body ?? 'all', ground = GROUND[paint];
  if (body === 'none') return;
  let run: Length[] = [];
  const flush = () => {
    if (!run.length) return;
    const a = run[0], b = run[run.length - 1];
    let c0: V2 = [(a.l0[0] + a.r0[0]) / 2, (a.l0[1] + a.r0[1]) / 2], c1: V2 = [(b.l1[0] + b.r1[0]) / 2, (b.l1[1] + b.r1[1]) / 2];
    const dl = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) || 1, d: V2 = [(c1[0] - c0[0]) / dl, (c1[1] - c0[1]) / dl];
    // (at a turn of the wall the box runs on by half the wall's thickness, into the stretch it meets: no gap at the corner)
    const turn = (s: number, span: number, start: boolean) => Math.abs(s - from[start ? span : span + 1]) < 1e-6 && (w.closed || (start ? span > 0 : span < spans - 1));
    const on = Math.min(w.thick / 2, 0.95);
    if (turn(a.s0, a.span, true)) c0 = [c0[0] - d[0] * on, c0[1] - d[1] * on];
    if (turn(b.s1, b.span, false)) c1 = [c1[0] + d[0] * on, c1[1] + d[1] * on];
    const len = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
    a.solids.forEach(([f0, f1], j) => {
      const lo = Math.min(f0, f1) > w.foot + 0.01 ? (f0 + f1) / 2 : w.foot, hi = run.reduce((sum, q) => sum + q.solids[j][2], 0) / run.length;
      if (hi - lo < 0.04) return;
      solids.push({ k: 'box', x: (c0[0] + c1[0]) / 2, y: (lo + hi) / 2, z: (c0[1] + c1[1]) / 2, hx: len / 2, hy: (hi - lo) / 2, hz: w.thick / 2, yaw: Math.atan2(-d[1], d[0]), body, ground, ...(!w.near && !w.hidden && w.thick >= 0.75 && hi - Math.max(lo, w.foot) >= 0.8 ? { far: paint } : {}) });
    });
    run = [];
  };
  const same = (a: Length, b: Length) => a.span === b.span && a.solids.length === b.solids.length && Math.abs(a.s1 - b.s0) < 1e-6 && a.solids.every(([f0, f1, t], j) => Math.abs(f0 - b.solids[j][0]) < 0.02 && Math.abs(f1 - b.solids[j][1]) < 0.02 && Math.abs(f0 - f1) < 0.02 && Math.abs(run[0].solids[j][2] - b.solids[j][2]) <= 0.26 && Math.abs(t - b.solids[j][2]) <= 0.26);
  for (const len of L) {
    if (!len.solids.length) {
      flush();
      continue;
    }
    if (run.length && !same(run[run.length - 1], len)) flush();
    run.push(len);
  }
  flush();
}

function floorShape(f: Floor, B: Bufs, solids: Solid[]) {
  const ring = [f.pts, ...(f.holes ?? [])], all = ring.flat();
  const faces = THREE.ShapeUtils.triangulateShape(f.pts.map(([x, z]) => new THREE.Vector2(x, z)), (f.holes ?? []).map((h) => h.map(([x, z]) => new THREE.Vector2(x, z))));
  const paint = f.paint ?? 'earth', buf = B.get(paint, f.near), verts: number[] = [], index: number[] = [];
  for (const [x, z] of all) verts.push(x, f.y, z);
  for (const [i, j, k] of faces) {
    const a = all[i], b = all[j], c = all[k];
    // (whichever way round it came, it is laid face up)
    const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0, [p, q] = up ? [b, c] : [c, b];
    if (!f.hidden) buf.tri([a[0], f.y, a[1]], [p[0], f.y, p[1]], [q[0], f.y, q[1]]);
    if (!f.hidden && f.under) buf.tri([a[0], f.y - f.under, a[1]], [q[0], f.y - f.under, q[1]], [p[0], f.y - f.under, p[1]], undefined, 0.7);
    index.push(i, up ? j : k, up ? k : j);
  }
  // boards have edges: round the floor and round every hole in it
  if (!f.hidden && f.under) {
    for (const r of ring) {
      let area = 0;
      for (let i = 0; i < r.length; i++) area += r[i][0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * r[i][1];
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length], lo = f.y - f.under;
        const q: [V3, V3, V3, V3] = [[a[0], lo, a[1]], [b[0], lo, b[1]], [b[0], f.y, b[1]], [a[0], f.y, a[1]]];
        // (the outline's edge faces out, a hole's faces into the hole)
        if (area > 0 === (r === f.pts)) buf.quad(q[1], q[0], q[3], q[2], undefined, 0.85);
        else buf.quad(q[0], q[1], q[2], q[3], undefined, 0.85);
      }
    }
  }
  if ((f.body ?? 'all') !== 'none') solids.push({ k: 'sheet', verts, index, body: f.body ?? 'all', ground: GROUND[paint], ...(!f.under && !f.hidden && !f.near ? { far: paint } : {}) });
}

function slabShape(s: Slab, B: Bufs, solids: Solid[]) {
  const t = s.p, f = t.map(([x, y, z]) => [x, y - s.thick, z] as V3) as [V3, V3, V3, V3];
  // (the corners may be given either way round: it is drawn so that its top is seen from above)
  const up = (t[1][2] - t[0][2]) * (t[2][0] - t[0][0]) - (t[1][0] - t[0][0]) * (t[2][2] - t[0][2]) > 0;
  const T = (up ? t : [t[3], t[2], t[1], t[0]]) as [V3, V3, V3, V3], F = (up ? f : [f[3], f[2], f[1], f[0]]) as [V3, V3, V3, V3];
  if (!s.hidden) B.get(s.paint ?? 'paving', s.near).block(F, T, true);
  if ((s.body ?? 'all') !== 'none') solids.push({ k: 'hull', pts: [...t, ...f].flat(), body: s.body ?? 'all', ground: GROUND[s.paint ?? 'paving'], ...(!s.hidden && s.thick >= 0.4 ? { far: s.paint ?? 'paving' } : {}) });
}

function flightShape(f: Flight, B: Bufs, solids: Solid[]) {
  const dx = f.head[0] - f.foot[0], dz = f.head[2] - f.foot[2], run = Math.hypot(dx, dz), rise = f.head[1] - f.foot[1];
  const d: V2 = [dx / run, dz / run], p: V2 = [-d[1] * (f.w / 2), d[0] * (f.w / 2)], n = Math.max(1, Math.round(rise / 0.19)), tread = run / n, step = rise / n;
  const paint = f.paint ?? 'stone', buf = B.get(paint, f.near), timber = paint === 'timber';
  const at = (a: number, side: number, y: number): V3 => [f.foot[0] + d[0] * a + p[0] * side, y, f.foot[2] + d[1] * a + p[1] * side];
  const box = (a0: number, a1: number, y0: number, y1: number, into = buf, half = 1) => into.block([at(a0, half, y0), at(a1, half, y0), at(a1, -half, y0), at(a0, -half, y0)], [at(a0, half, y1), at(a1, half, y1), at(a1, -half, y1), at(a0, -half, y1)], timber);
  if (!f.hidden) {
    for (let i = 0; i < n; i++) {
      const y = f.foot[1] + (i + 1) * step;
      // of stone every step stands on the ground under it; of timber it is a board, a little over the one below
      if (timber) box(i * tread - 0.02, (i + 1) * tread + 0.02, y - 0.05, y);
      else box(i * tread, (i + 1) * tread, f.base ?? f.foot[1] - 0.5, y);
    }
    if (timber) {
      // the two strings it is hung between
      const lean = step / tread;
      for (const side of [-1, 1]) {
        const s0 = Math.max(side, side * (1 - 0.14 / f.w)), s1 = Math.min(side, side * (1 - 0.14 / f.w));
        const A = (a: number, s: number, y: number) => at(a, s, f.foot[1] + (a + tread) * lean + y);
        buf.block([A(-tread * 0.6, s0, -0.3), A(run, s0, -0.3), A(run, s1, -0.3), A(-tread * 0.6, s1, -0.3)], [A(-tread * 0.6, s0, -0.06), A(run, s0, -0.06), A(run, s1, -0.06), A(-tread * 0.6, s1, -0.06)], true);
      }
    }
  }
  // what is walked on: one slope along the fronts of the steps, level over the last of them. A body goes up it as
  // up a bank, with no step to catch a foot on. Of stone it is solid to its foot; of timber it is a board's thickness.
  const body = f.body ?? 'all', lo = (y: number) => (timber ? y - 0.09 : f.base ?? f.foot[1] - 0.5);
  const pts: V3[] = [];
  for (const side of [-1, 1]) {
    pts.push(at(-tread, side, f.foot[1]), at(run - tread, side, f.head[1]), at(run, side, f.head[1]));
    pts.push(at(-tread, side, lo(f.foot[1])), at(run - tread, side, lo(f.head[1])), at(run, side, lo(f.head[1])));
  }
  if (body !== 'none') solids.push({ k: 'hull', pts: pts.flat(), body, ground: GROUND[paint] });
}

function heapShape(piece: Piece, h: Heap, B: Bufs, solids: Solid[]) {
  const buf = B.get(h.paint ?? 'earth', h.near), SECT = 16, RINGS = [0, 0.16, 0.36, 0.58, 0.8, 1], c = Math.cos(h.yaw ?? 0), s = Math.sin(h.yaw ?? 0);
  /** what the heap lies on at a spot: a floor of the piece or the ground it is built for. On a slope a heap goes down it: it does not hang in the air on the low side. */
  const under = (x: number, z: number) => ruinBase(piece, x, z, h.y + 0.7) ?? h.y, top = h.y + h.h, rise = top - under(h.x, h.z);
  /** how much of its height the heap has at a share of the way out from its middle, a given way round: sure near the top, where it is walked over; shoulders and hollows lower down */
  const share = (r: number, k: number, ring: number) => (1 - r ** 1.45) * (ring <= 2 ? 0.94 + 0.1 * hash(k, ring + 9, h.seed) : 0.74 + 0.42 * hash(k, ring + 9, h.seed));
  const at = (ring: number, k: number): V3 => {
    const r = RINGS[ring], a = (k / SECT) * Math.PI * 2, wob = ring ? 0.8 + 0.4 * rough(k * 0.9, ring * 1.7, h.seed) : 0;
    const lx = Math.cos(a) * r * h.rx * wob, lz = Math.sin(a) * r * h.rz * wob, x = h.x + lx * c + lz * s, z = h.z - lx * s + lz * c;
    return [x, ring === 0 ? top : ring === RINGS.length - 1 ? under(x, z) - 0.45 : under(x, z) + rise * share(r, k, ring), z];
  };
  const verts: number[] = [], index: number[] = [];
  const tri = (a: V3, b: V3, q: V3) => {
    buf.tri(a, q, b);
    const i = verts.length / 3;
    verts.push(...a, ...q, ...b);
    index.push(i, i + 1, i + 2);
  };
  for (let k = 0; k < SECT; k++) {
    const j = (k + 1) % SECT;
    tri(at(0, 0), at(1, k), at(1, j));
    for (let ring = 1; ring + 1 < RINGS.length; ring++) {
      tri(at(ring, k), at(ring + 1, k), at(ring + 1, j));
      tri(at(ring, k), at(ring + 1, j), at(ring, j));
    }
  }
  // the stones in it: half sunk in the earth of it, the bigger lower down, where they rolled
  const stones = Math.round(4 + h.rx * h.rz * 0.9);
  for (let k = 0; k < stones; k++) {
    const a = hash(k, 41, h.seed) * Math.PI * 2, r = 0.12 + 0.72 * hash(k, 42, h.seed), big = 0.1 + 0.24 * hash(k, 43, h.seed) * (0.5 + r);
    const lx = Math.cos(a) * r * h.rx, lz = Math.sin(a) * r * h.rz;
    const sx = h.x + lx * c + lz * s, sz = h.z - lx * s + lz * c;
    lumpShape({ t: 'lump', x: sx, y: under(sx, sz) + rise * (1 - r ** 1.45) * 0.9 + big * 0.15, z: sz, rx: big * 1.25, ry: big * 0.7, rz: big, yaw: hash(k, 44, h.seed) * 3, seed: h.seed + k * 7, near: true, body: 'none' }, B, solids);
  }
  if ((h.body ?? 'all') !== 'none') solids.push({ k: 'sheet', verts, index, body: h.body ?? 'all', ground: 'gravel', ...(h.rx * h.rz >= 14 ? { far: 'earth' as Paint } : {}) });
}

function lumpShape(l: Lump, B: Bufs, solids: Solid[]) {
  const c = Math.cos(l.yaw), s = Math.sin(l.yaw), tilt = (hash(1, 2, l.seed) - 0.5) * 0.5;
  const at = (i: number, j: number, k: number): V3 => {
    // (no corner of it square: each is knocked in or out by its own amount)
    const q = 0.78 + 0.3 * hash(i + 2 * j + 4 * k, 5, l.seed), x = i * l.rx * q, z = k * l.rz * q, y = j * l.ry * (0.8 + 0.3 * hash(i + 3 * k, 6, l.seed)) + x * tilt;
    return [l.x + x * c + z * s, l.y + y, l.z - x * s + z * c];
  };
  B.get(l.paint ?? 'stone', l.near).block([at(-1, -1, -1), at(-1, -1, 1), at(1, -1, 1), at(1, -1, -1)], [at(-1, 1, -1), at(-1, 1, 1), at(1, 1, 1), at(1, 1, -1)]);
  if ((l.body ?? 'none') !== 'none') solids.push({ k: 'box', x: l.x, y: l.y, z: l.z, hx: l.rx * 0.9, hy: l.ry * 0.95, hz: l.rz * 0.9, yaw: l.yaw, body: l.body!, ground: 'rock' });
}

function beamShape(b: Beam, B: Bufs, solids: Solid[]) {
  const d = new THREE.Vector3(b.b[0] - b.a[0], b.b[1] - b.a[1], b.b[2] - b.a[2]), len = d.length();
  d.normalize();
  const side = Math.abs(d.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(side, d).normalize();
  const at = (along: number, s: number, u: number): V3 => [b.a[0] + d.x * along + side.x * s * (b.w / 2) + up.x * u * (b.h / 2), b.a[1] + d.y * along + side.y * s * (b.w / 2) + up.y * u * (b.h / 2), b.a[2] + d.z * along + side.z * s * (b.w / 2) + up.z * u * (b.h / 2)];
  const f: [V3, V3, V3, V3] = [at(0, -1, -1), at(0, 1, -1), at(len, 1, -1), at(len, -1, -1)], t: [V3, V3, V3, V3] = [at(0, -1, 1), at(0, 1, 1), at(len, 1, 1), at(len, -1, 1)];
  if (!b.hidden) B.get(b.paint ?? 'timber', b.near).block(f, t, true);
  if ((b.body ?? 'none') !== 'none') solids.push({ k: 'hull', pts: [...f, ...t].flat(), body: b.body!, ground: 'wood' });
}

function railShape(r: Rail, B: Bufs, solids: Solid[]) {
  const flat = Math.hypot(r.b[0] - r.a[0], r.b[2] - r.a[2]), posts = Math.max(1, Math.round(flat / 1.1));
  const mid = (u: number, up: number): V3 => [r.a[0] + (r.b[0] - r.a[0]) * u, r.a[1] + (r.b[1] - r.a[1]) * u + up, r.a[2] + (r.b[2] - r.a[2]) * u];
  for (let k = 0; k <= posts; k++) beamShape({ t: 'beam', a: mid(k / posts, 0), b: mid(k / posts, 0.95), w: 0.07, h: 0.07, body: 'none', near: r.near }, B, solids);
  for (const [up, w] of [[0.9, 0.07], [0.48, 0.05]]) beamShape({ t: 'beam', a: mid(0, up), b: mid(1, up), w, h: w, body: 'none', near: r.near }, B, solids);
  // (what stops a body stands straight up from the line of the rail; a shot goes between its bars)
  solids.push({ k: 'box', x: (r.a[0] + r.b[0]) / 2, y: (r.a[1] + r.b[1]) / 2 + 0.5, z: (r.a[2] + r.b[2]) / 2, hx: flat / 2, hy: 0.5 + Math.abs(r.b[1] - r.a[1]) / 2, hz: 0.04, yaw: Math.atan2(-(r.b[2] - r.a[2]), r.b[0] - r.a[0]), body: 'feet', ground: 'wood' });
}

function partShape(piece: Piece, p: Part, B: Bufs, solids: Solid[]) {
  if (p.t === 'wall') wallShape(piece, p, B, solids);
  else if (p.t === 'floor') floorShape(p, B, solids);
  else if (p.t === 'slab') slabShape(p, B, solids);
  else if (p.t === 'flight') flightShape(p, B, solids);
  else if (p.t === 'heap') heapShape(piece, p, B, solids);
  else if (p.t === 'lump') lumpShape(p, B, solids);
  else if (p.t === 'beam') beamShape(p, B, solids);
  else railShape(p, B, solids);
}

const shapes = new Map<Piece, Shape>(), stops = new Map<Piece, Solid[]>();
/** A piece's shape worked out a little at a time: so many milliseconds of it, then whatever `rest` waits for (a frame of the game), and so on. For a piece that is first wanted while the game is played. */
export async function ruinShapeInTurns(piece: Piece, rest: () => Promise<void>, ms = 5): Promise<Shape> {
  let s = shapes.get(piece);
  if (s) return s;
  const B = new Bufs(), solids: Solid[] = [];
  let t = performance.now();
  for (const p of ruinParts(piece)) {
    partShape(piece, p, B, solids);
    if (performance.now() - t < ms) continue;
    await rest();
    t = performance.now();
  }
  await rest();
  shapes.set(piece, (s = { drawn: B.drawn(), solids }));
  return s;
}
/** A piece's shape, in the piece's own measure: what is drawn of it (by what it is drawn with, and by whether it is seen only from near) and what stops a body. (Worked out once.) */
export function ruinShape(piece: Piece): Shape {
  let s = shapes.get(piece);
  if (!s) {
    const B = new Bufs(), solids: Solid[] = [];
    for (const p of ruinParts(piece)) partShape(piece, p, B, solids);
    shapes.set(piece, (s = { drawn: B.drawn(), solids }));
  }
  return s;
}
/** Only what stops a body in a piece: for when the piece is not yet near enough to be drawn in full (and for a server, which draws nothing). */
export function ruinSolids(piece: Piece): Solid[] {
  let s = shapes.get(piece)?.solids ?? stops.get(piece);
  if (!s) {
    const B = new Bufs(true);
    s = [];
    for (const p of ruinParts(piece)) partShape(piece, p, B, s);
    stops.set(piece, s);
  }
  return s;
}
