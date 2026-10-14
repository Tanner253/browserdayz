// The fort's shape: the one-plane pass (faces of two parts in one plane: which one is drawn).
// (One part of castle-shape.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { type Cut, clipOut } from '../../sim/kit';
import type { V3 } from '../../sim/castle';
import { cross, dot, len, mul, skin, sub, unit, type Skin } from './base';

// ------------------------------------------------------------------ the whole of it

/** a piece that stands on the ground, at the height the ground is there */
/**
 * ONE FACE TO A PLACE (2026-10-13: "please make sure the castle does not have overlapping textures"). The fort is
 * laid out of blocks, and blocks meet flush: a wall's side in the plane of the next wall's, a floor's top level with
 * the top of the wall it runs into, two rails' posts at one corner, a post's head in the top of its beam. Two faces
 * that look the same way out of one plane are drawn turn and turn about, and flicker. So as each piece is made,
 * every triangle of it is asked against all that were made before it: where one of those lies in its plane (within
 * `ONE_PLANE`), looking the same way, that much of the new one is cut away, and what was there first is all that is
 * drawn there. What is left of it is then itself there for those that come after (and for the rest of its own
 * piece: a piece can lie on itself). Nothing that is seen is lost by it: what is cut away has the same stuff, or
 * stone for stone, in its very place.
 *
 * The lower levels are not always drawn (see `Shape.under`), and are never drawn without the rest: so a face of
 * theirs gives way to any, and no face of the rest gives way to one of theirs.
 */
const ONE_PLANE = 0.0011;

interface Face { n: V3; d: number; p: [V3, V3, V3]; cut: Cut | null; lo: V3; hi: V3; low: boolean; seen: number }

export class Faces {
  private cells = new Map<number, Face[]>();
  private asked = 0;
  private static row(k: Skin, i: number): number[] {
    return [k.pos[i * 3], k.pos[i * 3 + 1], k.pos[i * 3 + 2], k.nrm[i * 3], k.nrm[i * 3 + 1], k.nrm[i * 3 + 2], k.uv[i * 2], k.uv[i * 2 + 1], k.col[i * 3], k.col[i * 3 + 1], k.col[i * 3 + 2], k.snow[i * 2], k.snow[i * 2 + 1]];
  }
  private static push(k: Skin, r: number[]) {
    const l = Math.hypot(r[3], r[4], r[5]) || 1;
    k.pos.push(r[0], r[1], r[2]);
    k.nrm.push(r[3] / l, r[4] / l, r[5] / l);
    k.uv.push(r[6], r[7]);
    k.col.push(r[8], r[9], r[10]);
    k.snow.push(r[11], r[12]);
  }
  private static area(poly: number[][]): number {
    let s = 0;
    for (let k = 1; k + 1 < poly.length; k++) s += len(cross(sub(poly[k] as unknown as V3, poly[0] as unknown as V3), sub(poly[k + 1] as unknown as V3, poly[0] as unknown as V3)));
    return s / 2;
  }
  /** what of a flat piece is inside all of some sides (`clipOut` gives what is outside any of them) */
  private static within(poly: number[][], planes: Cut['planes']): number[][] {
    let rest = poly;
    for (const [nx, ny, nz, d] of planes) {
      const side = rest.map((v) => nx * v[0] + ny * v[1] + nz * v[2] - d), into: number[][] = [];
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i], b = rest[(i + 1) % rest.length], sa = side[i], sb = side[(i + 1) % rest.length];
        if (sa <= 0) into.push(a);
        if (sa > 0 !== sb > 0) into.push(a.map((v, k) => v + ((b[k] - v) * sa) / (sa - sb)));
      }
      rest = into;
      if (rest.length < 3) return [];
    }
    return rest;
  }
  /**
   * The faces are kept by which way they look and where they are: which of the six ways along x, y and z each looks
   * most nearly, how far along that way it is (a hand's breadths: two in one plane are at one depth), and where
   * across it (squares of two metres). So a triangle is asked only against the few that could be in its plane.
   */
  private static keys(n: V3, lo: number[], hi: number[], both: boolean): number[] {
    const out: number[] = [], most = Math.max(Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2]));
    for (let ax = 0; ax < 3; ax++) {
      // (kept under the way it looks most nearly; asked under every way it looks nearly as much, for one that looks between two)
      if (Math.abs(n[ax]) < most - (both ? 0.05 : 0) || (!both && out.length)) continue;
      const size = [2, 2, 2];
      size[ax] = 0.25;
      const side = (ax * 2 + (n[ax] < 0 ? 1 : 0)) * 2048;
      for (let x = Math.floor(lo[0] / size[0]); x <= Math.floor(hi[0] / size[0]); x++) for (let y = Math.floor(lo[1] / size[1]); y <= Math.floor(hi[1] / size[1]); y++) for (let z = Math.floor(lo[2] / size[2]); z <= Math.floor(hi[2] / size[2]); z++) out.push(((side + x + 1024) * 2048 + y + 1024) * 2048 + z + 1024);
    }
    return out;
  }
  /** a face as a cut: upright to it through its three sides, each looking away from the third corner (worked out for the few that are ever asked) */
  private static sides(f: Face): Cut {
    return (f.cut ??= { planes: Faces.round(f.p, f.n), mid: [0, 0, 0], reach: 0 });
  }
  private static round(p: V3[], n: V3): Cut['planes'] {
    const planes: Cut['planes'] = [];
    for (let e = 0; e < 3; e++) {
      const a = p[e], b = p[(e + 1) % 3], c = p[(e + 2) % 3];
      let s = unit(cross(sub(b, a), n));
      if (dot(s, sub(c, a)) > 0) s = mul(s, -1);
      planes.push([s[0], s[1], s[2], dot(s, a)]);
    }
    return planes;
  }
  /** whether all of a triangle is beyond one of another's sides: the two then have nothing in common (so of two that only meet along an edge, which is nearly every two that are asked) */
  private static apart(sides: Cut['planes'], p: V3[]): boolean {
    for (const [x, y, z, d] of sides) if (x * p[0][0] + y * p[0][1] + z * p[0][2] - d > -1e-6 && x * p[1][0] + y * p[1][1] + z * p[1][2] - d > -1e-6 && x * p[2][0] + y * p[2][1] + z * p[2][2] - d > -1e-6) return true;
    return false;
  }
  /** a triangle that is drawn is there for those that come after */
  private add(a: V3, b: V3, c: V3, n: V3, low: boolean) {
    const lo: V3 = [Math.min(a[0], b[0], c[0]) - ONE_PLANE, Math.min(a[1], b[1], c[1]) - ONE_PLANE, Math.min(a[2], b[2], c[2]) - ONE_PLANE], hi: V3 = [Math.max(a[0], b[0], c[0]) + ONE_PLANE, Math.max(a[1], b[1], c[1]) + ONE_PLANE, Math.max(a[2], b[2], c[2]) + ONE_PLANE];
    const f: Face = { n, d: dot(n, a), p: [a, b, c], cut: null, lo, hi, low, seen: 0 };
    for (const k of Faces.keys(n, lo, hi, false)) {
      const at = this.cells.get(k);
      if (at) at.push(f);
      else this.cells.set(k, [f]);
    }
  }
  /**
   * The triangles of a skin from its `from`th on (those of the piece just made): each cut back to what no earlier
   * face has in its plane, and then there for the next. Returns how many triangles the skin has after it.
   */
  take(k: Skin, from: number, low: boolean): number {
    const count = k.pos.length / 9;
    let out: Skin | null = null, first = count;
    const P = k.pos;
    for (let t = from; t < count; t++) {
      // (nearly every triangle has nothing in its plane: its corners are not put in rows until something is)
      const o = t * 9, a: V3 = [P[o], P[o + 1], P[o + 2]], b: V3 = [P[o + 3], P[o + 4], P[o + 5]], c: V3 = [P[o + 6], P[o + 7], P[o + 8]];
      const g = cross(sub(b, a), sub(c, a)), twice = len(g);
      if (twice < 1e-7) {
        // (a triangle of no size is nobody's face)
        if (out) for (let q = 0; q < 3; q++) Faces.push(out, Faces.row(k, t * 3 + q));
        continue;
      }
      const n = mul(g, 1 / twice), id = ++this.asked;
      const lo = [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2])], hi = [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])];
      let pieces: number[][][] | null = null, cut = false, mine: Cut['planes'] | null = null;
      search: for (const key of Faces.keys(n, lo, hi, true)) {
        const cell = this.cells.get(key);
        if (!cell) continue;
        for (const f of cell) {
          if (f.seen === id) continue;
          f.seen = id;
          if ((f.low && !low) || dot(n, f.n) < 0.9994) continue;
          if (lo[0] > f.hi[0] || hi[0] < f.lo[0] || lo[1] > f.hi[1] || hi[1] < f.lo[1] || lo[2] > f.hi[2] || hi[2] < f.lo[2]) continue;
          // (two that look the same way and are a hand apart are in one plane nowhere: no triangle is more than a few metres long)
          if (Math.abs(dot(f.n, a) - f.d) > 0.3) continue;
          if (Faces.apart((mine ??= Faces.round([a, b, c], n)), f.p)) continue;
          pieces ??= [[Faces.row(k, t * 3), Faces.row(k, t * 3 + 1), Faces.row(k, t * 3 + 2)]];
          const sides = Faces.sides(f), next: number[][][] = [];
          for (const piece of pieces) {
            // (only what of it is over the other, and in its plane where it is over it)
            const over = Faces.within(piece, sides.planes);
            if (over.length < 3 || Faces.area(over) < 1e-6 || Math.abs(over.reduce((s, v) => s + dot(f.n, v as unknown as V3), 0) / over.length - f.d) > ONE_PLANE) next.push(piece);
            else {
              cut = true;
              next.push(...clipOut(piece, sides));
            }
          }
          pieces = next;
          if (!pieces.length) break search;
        }
      }
      if (!cut || !pieces) {
        // (as it was made)
        if (out) for (let q = 0; q < 3; q++) Faces.push(out, Faces.row(k, t * 3 + q));
        this.add(a, b, c, n, low);
        continue;
      }
      if (!out) {
        out = skin();
        first = t;
      }
      for (const piece of pieces) {
        // (a strip a hair wide is the sums' own error, where two faces met under it)
        if (Faces.area(piece) <= 1e-4 * Math.max(...piece.map((v, q) => len(sub(piece[(q + 1) % piece.length] as unknown as V3, v as unknown as V3))))) continue;
        for (let q = 1; q + 1 < piece.length; q++) {
          // (three corners of a piece in a line are a triangle of no size: nothing to draw)
          if (Faces.area([piece[0], piece[q], piece[q + 1]]) < 1e-6) continue;
          for (const r of [piece[0], piece[q], piece[q + 1]]) Faces.push(out, r);
          this.add(piece[0].slice(0, 3) as V3, piece[q].slice(0, 3) as V3, piece[q + 1].slice(0, 3) as V3, n, low);
        }
      }
    }
    if (out) {
      k.pos.length = k.nrm.length = k.col.length = first * 9;
      k.uv.length = k.snow.length = first * 6;
      // (not as one spread: a tower's sheet is more numbers than a call can be handed)
      for (const key of ['pos', 'nrm', 'uv', 'col', 'snow'] as const) for (const v of out[key]) k[key].push(v);
    }
    return k.pos.length / 9;
  }
}
