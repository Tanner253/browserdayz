// Questions of the ground's net: the height and slope at a point, the ground as it is drawn over the fort's cuts, a curve through points, and the evening and softening of a field.
// (One part of worldgen.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { clamp, smoothstep } from '../../core/noise';
import { CELL, SOFTEN, SQUARE_HALF, SQUARE_RES, WORLD_NX, WORLD_NZ, WORLD_X0, WORLD_Z0 } from './places';
import type { World } from './types';
import { BUNKER, type Place } from '../../sim/bunker';

// ------------------------------------------------------------------ helpers

/** a sample's number in the world's net (`iz` rows of WORLD_NX) */
export function idx(ix: number, iz: number) {
  return iz * WORLD_NX + ix;
}

/** a sample's number in the square's own net, on which the square is made (generateWorld, until it is laid into the world's) */
export function squareIdx(ix: number, iz: number) {
  return iz * SQUARE_RES + ix;
}

/** the square's net while it is made, and the world's after: a field of either is told by its length */
const SQUARE_N = SQUARE_RES * SQUARE_RES;
/** the square's corner in the world's net: its column and row */
const SQ_X = (-SQUARE_HALF - WORLD_X0) / CELL, SQ_Z = (-SQUARE_HALF - WORLD_Z0) / CELL;

/**
 * Height at a world position using the same triangulation as the physics heightfield. Reckoned from the square's
 * corner on either net, so that on the square every height is what it was before the world grew, to the last bit.
 */
export function heightAt(heights: Float32Array, x: number, z: number): number {
  const sq = heights.length === SQUARE_N, nx = sq ? SQUARE_RES : WORLD_NX, nz = sq ? SQUARE_RES : WORLD_NZ, ox = sq ? 0 : SQ_X, oz = sq ? 0 : SQ_Z;
  const gx = clamp((x + SQUARE_HALF) / CELL, sq ? 0 : -ox, SQUARE_RES - 1.0001 + (nx - SQUARE_RES - ox));
  const gz = clamp((z + SQUARE_HALF) / CELL, sq ? 0 : -oz, SQUARE_RES - 1.0001 + (nz - SQUARE_RES - oz));
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const i = (iz + oz) * nx + ix + ox;
  const h00 = heights[i];
  const h10 = heights[i + 1];
  const h01 = heights[i + nx];
  const h11 = heights[i + nx + 1];
  if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

/**
 * The ground as Rapier stands bodies on it: a heightfield of the world's net (its rows run along z and its columns
 * along x, read column by column), triangulated as `heightAt` reckons it, and laid with its middle at `at`.
 */
export function groundField(heights: Float32Array) {
  const field = new Float32Array(WORLD_NX * WORLD_NZ);
  for (let ix = 0; ix < WORLD_NX; ix++) for (let iz = 0; iz < WORLD_NZ; iz++) field[iz + ix * WORLD_NZ] = heights[idx(ix, iz)];
  return {
    rows: WORLD_NZ - 1,
    cols: WORLD_NX - 1,
    heights: field,
    scale: { x: (WORLD_NX - 1) * CELL, y: 1, z: (WORLD_NZ - 1) * CELL },
    at: { x: WORLD_X0 + ((WORLD_NX - 1) * CELL) / 2, y: 0, z: WORLD_Z0 + ((WORLD_NZ - 1) * CELL) / 2 },
  };
}

/** the nearest sample to a spot, clamped onto the world's net: [ix, iz] */
export function sampleOf(x: number, z: number): [number, number] {
  return [Math.min(WORLD_NX - 1, Math.max(0, Math.round((x - WORLD_X0) / CELL))), Math.min(WORLD_NZ - 1, Math.max(0, Math.round((z - WORLD_Z0) / CELL)))];
}

/**
 * THE GROUND AS IT IS DRAWN. `heights` is the ground a body stands on, let down where the fort's passage runs under
 * it; drawn as that, the cut was a trench with a second sheet of earth laid over it by the fort ("the ground also
 * has overlapping textures and physics because of the tunnel under ground"). So whoever draws the ground draws
 * this instead: every corner at `heights`, but those of the squares the fort was told of (`FortLid`), which are
 * drawn where the ground was before the cut: one sheet, the ground's own, with its own snow and paint. And of
 * each square of the net (by the number of its lowest corner) whether it is NOT drawn:
 *   1  a hatch's stairwell opens in it: the fort draws it, round the well;
 *   2  it is wholly under the fort's own stone, between a corner drawn where the ground was and the cut: it would
 *      slant down across the passage where that goes through the wall's foot, and nobody could see it but there.
 * `open` is null, and `heights` the world's own, in a world with nothing cut. The bunker's roof (`roof`: where it
 * stands, null in a world without it) lies level with the ground as it is seen over the hole dug for it, and the
 * ground under it is drawn as it is seen too: drawn as it is dug, it sloped down into the hole from a square outside
 * the roof and the roof's edge stood over a gap (the owner, 2026-10-19: "the ground around the bunker perimeiter does
 * not meet with the bunker top"), and from past the bunker's own drawing distance the hole showed. About its edge,
 * as far as a square that meets the edge reaches either side, the ground is drawn level with the roof's top: a
 * finger under it, the step was a dark line round the roof.
 */
export function seenGround(world: World, roof: Place | null = null): { heights: Float32Array; open: Uint8Array | null } {
  const lid = world.castle?.lid, N = WORLD_NX, roofed = underRoof(world, roof);
  if ((!lid || !lid.squares.length) && !roofed.length) return { heights: world.heights, open: null };
  const heights = world.heights.slice();
  for (const [i, h] of roofed) heights[i] = h;
  if (!lid || !lid.squares.length) return { heights, open: null };
  const open = new Uint8Array(world.heights.length), told = new Set<number>();
  for (const s of lid.squares) {
    const k = idx(Math.round((s.x - WORLD_X0) / CELL), Math.round((s.z - WORLD_Z0) / CELL));
    told.add(k);
    if (s.open) open[k] = 1;
    for (const i of [k, k + 1, k + N, k + N + 1]) heights[i] = world.surface[i];
  }
  for (const k of told) for (const i of [k, k + 1, k + N, k + N + 1]) {
    if (heights[i] === world.heights[i]) continue;
    for (const q of [i, i - 1, i - N, i - N - 1]) if (!told.has(q)) open[q] = 2;
  }
  return { heights, open };
}

/** the corners of the net under the bunker's roof and about its edge, and the height each is drawn at (see `seenGround`) */
function underRoof(world: World, roof: Place | null): [number, number][] {
  if (!roof) return [];
  const P = BUNKER.pad, c = Math.cos(roof.rot), n = Math.sin(roof.rot), top = roof.y + P.top, band = 2.9, out: [number, number][] = [];
  const reach = Math.hypot(P.r, Math.max(-P.back, P.front)) + band;
  const [x0, z0] = sampleOf(roof.x - reach, roof.z - reach), [x1, z1] = sampleOf(roof.x + reach, roof.z + reach);
  for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
    const i = idx(ix, iz), dx = WORLD_X0 + ix * CELL - roof.x, dz = WORLD_Z0 + iz * CELL - roof.z, r = dx * c - dz * n, f = dx * n + dz * c;
    // (how far inside the roof's edge, or outside it as a negative)
    const e = Math.abs(r) <= P.r && f >= P.back && f <= P.front ? Math.min(P.r - Math.abs(r), f - P.back, P.front - f) : -Math.hypot(Math.max(0, Math.abs(r) - P.r), Math.max(0, P.back - f, f - P.front));
    if (Math.abs(e) < band) out.push([i, Math.max(top, e >= 0 ? world.surface[i] : world.heights[i])]);
    else if (e > 0 && world.surface[i] !== world.heights[i]) out.push([i, world.surface[i]]);
  }
  return out;
}

export function slopeAt(heights: Float32Array, x: number, z: number): number {
  const e = CELL;
  const dx = heightAt(heights, x + e, z) - heightAt(heights, x - e, z);
  const dz = heightAt(heights, x, z + e) - heightAt(heights, x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

export function catmullRom(pts: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(segLen / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * A field of the grid evened out over the cells about each (`reach` cells either way, along and then across, twice
 * over), counting only the cells `has` says it is known on. A new field: the same as the old wherever it is not known.
 */
export function evenOut(field: Float32Array, has: (i: number) => boolean, reach: number): Float32Array {
  // (asked only while the square is made: on its net)
  const N = SQUARE_RES, known = new Uint8Array(N * N);
  let x0 = N, x1 = -1, z0 = N, z1 = -1;
  for (let i = 0; i < N * N; i++) {
    if (!has(i)) continue;
    known[i] = 1;
    const ix = i % N, iz = (i - ix) / N;
    x0 = Math.min(x0, ix);
    x1 = Math.max(x1, ix);
    z0 = Math.min(z0, iz);
    z1 = Math.max(z1, iz);
  }
  let cur = field.slice();
  for (let pass = 0; pass < 4; pass++) {
    const next = cur.slice(), along = pass % 2 === 0;
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const i = iz * N + ix;
        if (!known[i]) continue;
        let sum = 0, n = 0;
        for (let k = -reach; k <= reach; k++) {
          const jx = along ? ix + k : ix, jz = along ? iz : iz + k;
          if (jx < x0 || jx > x1 || jz < z0 || jz > z1 || !known[jz * N + jx]) continue;
          sum += cur[jz * N + jx];
          n++;
        }
        next[i] = sum / n;
      }
    }
    cur = next;
  }
  return cur;
}

/**
 * The knife edges of the open ground rounded off (2026-10-13). A ridge of the base ground is where an octave of its
 * noise goes through nothing, and the ground there met itself in a crease as sharp as a roof's: thirty degrees up
 * one side and thirty down the other with nothing between, and where two crossed in a meadow, an X of them forty
 * metres long. Each spot that stands off the line between its neighbours by more than SOFTEN.from is brought
 * toward the mean of them, more the sharper it is, a few times over: a ridge is still a ridge, with a round back.
 * Nothing else is moved: not ground that is not creased, not a hillside's own face (told by the lie of the land
 * about it, not by the crease), and not the mountains of the edge, which are meant to be sharp.
 * @param high how much of an edge mountain a place is, 0 to 1
 */
export function soften(heights: Float32Array, high: (x: number, z: number) => number): void {
  // (asked only while the square is made: on its net)
  const N = SQUARE_RES, half = SQUARE_HALF, R = 4;
  // the lie of the land: the fall of the ground evened over nine points either way
  const row = new Float32Array(N * N), even = new Float32Array(N * N);
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
    let sum = 0, n = 0;
    for (let k = Math.max(0, ix - R); k <= Math.min(N - 1, ix + R); k++, n++) sum += heights[iz * N + k];
    row[iz * N + ix] = sum / n;
  }
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
    let sum = 0, n = 0;
    for (let k = Math.max(0, iz - R); k <= Math.min(N - 1, iz + R); k++, n++) sum += row[k * N + ix];
    even[iz * N + ix] = sum / n;
  }
  const may = new Float32Array(N * N);
  for (let iz = 1; iz < N - 1; iz++) for (let ix = 1; ix < N - 1; ix++) {
    const i = iz * N + ix, fall = Math.hypot((even[i + 1] - even[i - 1]) / (2 * CELL), (even[i + N] - even[i - N]) / (2 * CELL));
    const open = 1 - smoothstep(SOFTEN.steep[0], SOFTEN.steep[1], fall);
    may[i] = open <= 0 ? 0 : open * (1 - smoothstep(SOFTEN.high[0], SOFTEN.high[1], high(-half + ix * CELL, -half + iz * CELL)));
  }
  for (let pass = 0; pass < SOFTEN.passes; pass++) {
    const was = heights.slice();
    for (let iz = 1; iz < N - 1; iz++) for (let ix = 1; ix < N - 1; ix++) {
      const i = iz * N + ix;
      if (may[i] <= 0) continue;
      const h = was[i], l = was[i - 1], r = was[i + 1], u = was[i - N], d = was[i + N];
      const sharp = Math.max(Math.abs(l - 2 * h + r), Math.abs(u - 2 * h + d), Math.abs(was[i - N - 1] - 2 * h + was[i + N + 1]) / 2, Math.abs(was[i - N + 1] - 2 * h + was[i + N - 1]) / 2);
      const w = may[i] * smoothstep(SOFTEN.from, SOFTEN.full, sharp);
      if (w > 0) heights[i] = h + ((l + r + u + d) / 4 - h) * 0.6 * w;
    }
  }
}
