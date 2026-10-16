// THE WEST (2026-10-16): the square laid into the world's rectangle, and the ground of the two squares west of it.
// The owner: "from west to east itll be ocean, beach, desert, plains, mountains. We have the plains and mountains."
// This is the ground only, a placeholder for what is to be built there (a desert, its canyon road and ruins, the
// coast): from the square's west rim the hills fall away westward into a broad dry plain some thirty metres above
// the sea, which comes down to a beach and a sea floor in the westmost seven hundred metres.
//
// Nothing of the square is touched: its samples are copied as they are, its trees and everything else keep their
// numbers, and the new ground has noise of its own. At the seam it is the square's own ground carried on (the same
// base and rim, and the square's last column met exactly), so there is no step and no crease.

import { Simplex, clamp, hash2, smoothstep } from '../../core/noise';
import { SNOW } from './layout';
import { CELL, SEA_LEVEL, SQUARE_HALF, SQUARE_RES, WORLD_NX, WORLD_NZ, WORLD_X0, WORLD_Z0, WORLD_Z1 } from './places';
import { heightAt, slopeAt } from './ground';
import type { Instance } from './types';

/** the shape of the new ground, in metres west of the square's edge (`d`) or from the shore (`c`, + inland) */
export const WEST = {
  /** the square's west edge: the seam */
  seam: -SQUARE_HALF,
  /** the rim's mountain falls away over this, after a level top as wide as the square's own */
  fall: [10, 420] as const,
  /** the square's base ground goes over into the plain over this */
  plain: [0, 560] as const,
  /** the plain's height over the sea (some fourteen metres over the valley's floor), and how much it rolls (long swells, and the lesser lie of it) */
  level: 30,
  swell: 8,
  lie: 2.5,
  /** the rims along the north and south edges are carried on into the plain, this much of them */
  rims: 0.45,
  /** the shore's line (x) and how far it wanders either way, slow and quick */
  shore: -3230,
  wander: [70, 18] as const,
  /** the beach's fall to the metre, and how far out it goes before the sea floor drops away */
  beach: 0.04,
  shelf: 60,
  /** how deep the sea floor goes below the shelf's edge, and over how far */
  deep: 24,
  deepRun: 450,
  /** the land comes down to the beach over this, inland of the shore */
  coast: [40, 340] as const,
  /** the woods of the rim give out over this */
  woods: [30, 430] as const,
};

export interface SquareFields {
  heights: Float32Array;
  surface: Float32Array;
  splat: Uint8Array;
  grass: Uint8Array;
}

export interface WestTools {
  seed: number;
  /** the square's base ground and its rim, as functions of a spot: carried on past the seam */
  base: (x: number, z: number) => number;
  ringShape: (x: number, z: number) => number;
  /** the square's woods (more than nothing: a wood), carried on past the seam and thinned out */
  forestMask: (x: number, z: number) => number;
  /** the trees: those of the rim's fall are added after all of the square's */
  trees: Instance[];
  /** the square's three noises, for the paint's patches to run on across the seam */
  noise: [Simplex, Simplex, Simplex];
}

/**
 * The square's fields laid into the world's, and the west ground made. The square's own arrays are left as they
 * were; new ones are given back. `surface` stays the same array as `heights` when it was.
 */
export function toWorld(sq: SquareFields, tools: WestTools): SquareFields {
  const N = SQUARE_RES, NX = WORLD_NX, NZ = WORLD_NZ, n = NX * NZ;
  // (the square in the world's net: from this column, and from row 0, since the two share their north edge)
  const OX = (-SQUARE_HALF - WORLD_X0) / CELL, OZ = (-SQUARE_HALF - WORLD_Z0) / CELL;
  const heights = new Float32Array(n), splat = new Uint8Array(n * 4), grass = new Uint8Array(n);
  const own = sq.surface !== sq.heights, surface = own ? new Float32Array(n) : heights;
  for (let iz = 0; iz < N; iz++) {
    const a = iz * N, b = (iz + OZ) * NX + OX;
    heights.set(sq.heights.subarray(a, a + N), b);
    if (own) surface.set(sq.surface.subarray(a, a + N), b);
    grass.set(sq.grass.subarray(a, a + N), b);
    splat.set(sq.splat.subarray(a * 4, (a + N) * 4), b * 4);
  }

  const p1 = new Simplex(tools.seed + 301), p2 = new Simplex(tools.seed + 302), p3 = new Simplex(tools.seed + 303);
  const W = WEST;
  /** how much of the rim's mountain a spot of the west is (`d` metres west of the seam) */
  const mountain = (d: number, z: number) => {
    const west = 1 - smoothstep(W.fall[0], W.fall[1], d);
    // (the rims along the north and south edges, as the square has them, kept in part across the plain, and gone
    // by the coast: the beach runs to the edge of the world)
    const ns = (1 - smoothstep(10, 185, SQUARE_HALF - Math.abs(z))) * (1 - (1 - W.rims) * smoothstep(0, 600, d)) * smoothstep(W.shore + 250, W.shore + 900, W.seam - d);
    return 1 - (1 - west) * (1 - ns);
  };
  // (the plain's swells and lie are slow: reckoned every four metres and read between, a quarter of the work, and
  // only its small roughness at every sample)
  const PS = 4, PW = Math.ceil((W.seam - WORLD_X0) / PS) + 2, PH = Math.ceil((WORLD_Z1 - WORLD_Z0) / PS) + 2, swells = new Float32Array(PW * PH);
  for (let j = 0; j < PH; j++) for (let i = 0; i < PW; i++) {
    const x = WORLD_X0 + i * PS, z = WORLD_Z0 + j * PS;
    swells[j * PW + i] = W.swell * p1.fbm(x * 0.0013, z * 0.0013, 3) + W.lie * p2.fbm(x * 0.006 + 17, z * 0.006 - 5, 3);
  }
  const plain = (x: number, z: number) => {
    const gx = clamp((x - WORLD_X0) / PS, 0, PW - 1.001), gz = clamp((z - WORLD_Z0) / PS, 0, PH - 1.001), i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, o = j * PW + i;
    const s = (swells[o] * (1 - fx) + swells[o + 1] * fx) * (1 - fz) + (swells[o + PW] * (1 - fx) + swells[o + PW + 1] * fx) * fz;
    return SEA_LEVEL + W.level + s + 0.25 * p3.noise(x * 0.05, z * 0.05);
  };
  // (the square's base and rim are dear to reckon, and a million and more samples are made here: each is asked
  // only where it is some of the ground)
  const land = (x: number, z: number) => {
    const d = W.seam - x, s = smoothstep(W.plain[0], W.plain[1], d), m = mountain(d, z);
    return (s < 1 ? tools.base(x, z) * (1 - s) : 0) + plain(x, z) * s + (m > 0 ? tools.ringShape(x, z) * Math.pow(m, 1.15) : 0);
  };
  const shoreAt = (z: number) => W.shore + W.wander[0] * p1.noise(z * 0.0021, 3.1) + W.wander[1] * p2.noise(z * 0.011, 7.7);
  /** the beach and the sea floor, by the distance from the shore (+ inland) */
  const shoreline = (c: number, x: number, z: number) => {
    if (c > -W.shelf) return SEA_LEVEL + W.beach * c;
    const out = -W.shelf - c;
    return SEA_LEVEL - W.beach * W.shelf - W.deep * smoothstep(0, W.deepRun, out) + 1.2 * p3.noise(x * 0.004, z * 0.004) * smoothstep(0, 100, out);
  };
  const ground = (x: number, z: number) => {
    const c = x - shoreAt(z), on = smoothstep(W.coast[0], W.coast[1], c);
    return on >= 1 ? land(x, z) : on <= 0 ? shoreline(c, x, z) : shoreline(c, x, z) * (1 - on) + land(x, z) * on;
  };

  // The ground, and the square's last column met: whatever the square's later stages did to it is taken up within
  // 80 m of the seam, so that the step is nothing and the slope carries on.
  for (let iz = 0; iz < NZ; iz++) {
    const z = WORLD_Z0 + iz * CELL, off = heights[iz * NX + OX] - land(W.seam, z);
    for (let ix = 0; ix < OX; ix++) {
      const x = WORLD_X0 + ix * CELL;
      heights[iz * NX + ix] = ground(x, z) + off * (1 - smoothstep(0, 80, W.seam - x));
    }
  }
  if (own) for (let iz = 0; iz < NZ; iz++) surface.set(heights.subarray(iz * NX, iz * NX + OX), iz * NX);

  // The paint: the square's rule for rock by slope, its woods thinning out down the fall, and then bare dry earth
  // (the paint's trodden ground, until the coast's own sand and the desert's pictures come), wholly so on the beach
  // and under the sea. Grass as the square has it where the woods and meadows still are, by the square's own
  // noises, so that its patches run on over the seam.
  const [n1, n2, n3] = tools.noise;
  // (the woods give out wholly by the end of the fall: a wood out here is at most some 1.9, and two less is none)
  const woodAt = (x: number, z: number) => (W.seam - x > W.woods[1] ? -1 : tools.forestMask(x, z) - 2 * smoothstep(W.woods[0], W.woods[1], W.seam - x));
  for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < OX; ix++) {
    const x = WORLD_X0 + ix * CELL, z = WORLD_Z0 + iz * CELL, i = iz * NX + ix, d = W.seam - x, h = heights[i];
    // (the slope as `slopeAt` has it, read off the net's own samples: they are the heights it would read)
    const r = Math.min(ix + 1, NX - 1), l = Math.max(ix - 1, 0), u = Math.max(iz - 1, 0), dn = Math.min(iz + 1, NZ - 1);
    const slope = Math.hypot(heights[iz * NX + r] - heights[iz * NX + l], heights[dn * NX + ix] - heights[u * NX + ix]) / (2 * CELL);
    // (each noise asked only where it can tell: rock on a slope near enough to steep, the ragged edge of the dry
    // country only in the fall, the meadows' bald patches only where it is not all bare already)
    let rock = slope < 0.39 ? 0 : clamp(smoothstep(0.5, 0.85, slope + 0.1 * n3.noise(x * 0.05, z * 0.05)), 0, 1);
    let forest = smoothstep(-0.05, 0.25, woodAt(x, z));
    const wet = h < SEA_LEVEL + 3 ? 1 : 0;
    // (dry by the end of the fall, its edge a ragged one; the meadows' bald patches as the square has them, before)
    const dry = d > 580 ? 1 : smoothstep(60, 520, d + 60 * p2.noise(x * 0.01, z * 0.01));
    let bare = wet || dry >= 1 ? 1 : Math.max(dry, smoothstep(0.55, 0.75, n2.noise(x * 0.03, z * 0.03)) * 0.5 * (1 - forest));
    if (wet) rock = 0;
    forest *= 1 - rock;
    bare *= 1 - rock;
    const grassW = Math.max(0, 1 - rock - forest - bare), sum = grassW + forest + rock + bare || 1;
    splat[i * 4] = Math.round((grassW / sum) * 255);
    splat[i * 4 + 1] = Math.round((forest / sum) * 255);
    splat[i * 4 + 2] = Math.round((rock / sum) * 255);
    splat[i * 4 + 3] = Math.round((bare / sum) * 255);
    let g = grassW / sum + 0.45 * (forest / sum);
    g *= 1 - smoothstep(0.2, 0.5, bare);
    if (g > 0) g *= 0.75 + 0.25 * n1.noise(x * 0.08, z * 0.08);
    g *= 1 - smoothstep(SNOW.from - 10, SNOW.from + 8, h);
    grass[i] = Math.round(clamp(g, 0, 1) * 255);
  }

  // The rim's woods down the fall, by the rule the square's own rim is planted by (its grid carried on west, its
  // hashes), thinning out as the woods give out. Nothing is planted on the square.
  const STEP = 6.2, seed = tools.seed, pines = ['pine_a', 'pine_b', 'pine_c', 'pine_d'];
  for (let gz = -SQUARE_HALF + 10; gz < SQUARE_HALF - 10; gz += STEP) {
    for (let gx = -SQUARE_HALF + 10 - STEP; gx > W.seam - W.woods[1] - 20; gx -= STEP) {
      const hx = hash2(Math.round(gx * 10), Math.round(gz * 10), seed + 41);
      const hz = hash2(Math.round(gz * 10), Math.round(gx * 10), seed + 47);
      const x = gx + (hx - 0.5) * STEP * 0.9, z = gz + (hz - 0.5) * STEP * 0.9;
      if (x > W.seam - 0.5) continue;
      const f = woodAt(x, z), hv = hash2(Math.round(x * 7), Math.round(z * 7), seed + 43);
      if (slopeAt(heights, x, z) > 1.05) continue;
      const y = heightAt(heights, x, z);
      if (y > SNOW.bare || (y > SNOW.thin && hv > 0.62 * (1 - smoothstep(SNOW.thin, SNOW.bare, y)) * 0.6)) continue;
      const high = y > SNOW.from - 6;
      if (f > 0.08) {
        if (hv > smoothstep(0.08, 0.3, f) * 0.62) continue;
        const edge = f < 0.2;
        let kind: string;
        if (!high && edge && hv < 0.3) kind = hv < 0.12 ? 'bush_a' : hv < 0.2 ? 'bush_b' : 'birch_a';
        else if (!high && hv < 0.08) kind = 'birch_b';
        else kind = pines[Math.floor(hash2(Math.round(x), Math.round(z), 5) * pines.length)];
        tools.trees.push({ kind, x, y, z, rot: hx * Math.PI * 2, scale: 0.85 + hz * 0.35 });
      } else if (!high && f > -0.25 && hv < 0.025) {
        tools.trees.push({ kind: hv < 0.01 ? 'oak_a' : hv < 0.018 ? 'ash_a' : 'birch_a', x, y, z, rot: hx * Math.PI * 2, scale: 0.9 + hz * 0.3 });
      } else if (!high && f > -0.15 && hv > 0.97) {
        tools.trees.push({ kind: hv > 0.985 ? 'bush_a' : 'bush_b', x, y, z, rot: hx * Math.PI * 2, scale: 0.8 + hz * 0.5 });
      }
    }
  }
  return { heights, surface, splat, grass };
}
