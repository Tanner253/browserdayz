import * as THREE from 'three';

/**
 * Things of one kind sorted into squares of the map, so that a frame's look at them starts from the squares in reach
 * and not from every one of them. The vegetation walked all 27,000 of its instances and all 21,000 tree cards on
 * every frame, to keep in the end the few hundred within a set's farthest level or inside the view; walked by
 * squares, whole squares out of reach or out of view are passed over and what is kept is exactly what was kept
 * before (every test on a single thing is still made on whatever is left).
 */
export class Cells {
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly h: number;
  /** where each square's things begin in `idx` (one more than there are squares: the end of the last) */
  readonly start: Uint32Array;
  /** the things' own numbers, square by square, in their own order within a square */
  readonly idx: Uint32Array;
  /** each square's things' extent: least and most x, y, z, and the largest `rad` among them */
  readonly box: Float64Array;

  /** @param pos x, y, z of each thing @param rad a size of each thing kept per square at its largest */
  constructor(pos: ArrayLike<number>, n: number, readonly size: number, rad?: ArrayLike<number>) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], z = pos[i * 3 + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    if (!n) x0 = z0 = x1 = z1 = 0;
    this.x0 = x0;
    this.z0 = z0;
    this.w = Math.floor((x1 - x0) / size) + 1;
    this.h = Math.floor((z1 - z0) / size) + 1;
    const cells = this.w * this.h;
    const of = new Uint32Array(n);
    this.start = new Uint32Array(cells + 1);
    for (let i = 0; i < n; i++) {
      of[i] = Math.floor((pos[i * 3 + 2] - z0) / size) * this.w + Math.floor((pos[i * 3] - x0) / size);
      this.start[of[i] + 1]++;
    }
    for (let k = 0; k < cells; k++) this.start[k + 1] += this.start[k];
    const fill = this.start.slice(0, cells);
    this.idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.idx[fill[of[i]]++] = i;
    this.box = new Float64Array(cells * 7);
    for (let k = 0; k < cells; k++) {
      const b = k * 7;
      this.box.set([Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity, 0], b);
      for (let j = this.start[k]; j < this.start[k + 1]; j++) {
        const i = this.idx[j], x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], bx = this.box;
        if (x < bx[b]) bx[b] = x;
        if (x > bx[b + 1]) bx[b + 1] = x;
        if (y < bx[b + 2]) bx[b + 2] = y;
        if (y > bx[b + 3]) bx[b + 3] = y;
        if (z < bx[b + 4]) bx[b + 4] = z;
        if (z > bx[b + 5]) bx[b + 5] = z;
        if (rad && rad[i] > bx[b + 6]) bx[b + 6] = rad[i];
      }
    }
  }

  /** the squares that could hold anything within `r` of (x, z) across the ground: the first and last column and row */
  span(x: number, z: number, r: number, out: Int32Array) {
    out[0] = Math.max(0, Math.floor((x - r - this.x0) / this.size));
    out[1] = Math.min(this.w - 1, Math.floor((x + r - this.x0) / this.size));
    out[2] = Math.max(0, Math.floor((z - r - this.z0) / this.size));
    out[3] = Math.min(this.h - 1, Math.floor((z + r - this.z0) / this.size));
  }

  /** how near (x, z) comes to square k's things across the ground, squared: never more than any one of them */
  near2(k: number, x: number, z: number) {
    const b = this.box, o = k * 7;
    const dx = Math.max(b[o] - x, 0, x - b[o + 1]), dz = Math.max(b[o + 4] - z, 0, z - b[o + 5]);
    return dx * dx + dz * dz;
  }
}

/** whether a box lies wholly inside the view (every corner on the inner side of all six planes) */
export function boxInside(f: THREE.Frustum, b: THREE.Box3) {
  for (const p of f.planes) {
    const n = p.normal;
    if (n.x * (n.x > 0 ? b.min.x : b.max.x) + n.y * (n.y > 0 ? b.min.y : b.max.y) + n.z * (n.z > 0 ? b.min.z : b.max.z) + p.constant < 0) return false;
  }
  return true;
}
