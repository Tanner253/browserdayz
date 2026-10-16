// THE WEST (2026-10-16): the square laid into the world's rectangle, and the ground of the two squares west of it.
// The owner: "from west to east itll be ocean, beach, desert, plains, mountains. We have the plains and mountains."
// And then, of how: "it should blend in a lot ... pretty water, no need to go into it or swim can put barrier on
// beach, but maybe dont give a lot of width of the map to the ocean ... we have a lot of room to expand the green land
// too towards the ocean, desert is ugly the grass is prettier". So this is the ground only, a placeholder for what is
// to be built there: from the square's west rim the hills fall away into green rolling country of the square's own
// kind, which comes down to a beach and a thin strip of sea at the world's west edge. (A desert, smaller, comes later.)
//
// Nothing of the square is touched: its samples are copied as they are, its trees and everything else keep their
// numbers, and what is new has noise of its own. At the seam it is the square's own ground carried on (the same
// valley noise and rim, and the square's last column met exactly), so there is no step and no crease.

import { Simplex, clamp, hash2, smoothstep } from '../../core/noise';
import { SNOW } from './layout';
import { CELL, SEA_LEVEL, SQUARE_HALF, SQUARE_RES, WORLD_NX, WORLD_NZ, WORLD_SEED, WORLD_X0, WORLD_Z0, WORLD_Z1 } from './places';
import { heightAt, slopeAt } from './ground';
import type { Instance } from './types';

/** the shape of the new ground, in metres west of the square's edge (`d`) or from the shore (`c`, + inland) */
export const WEST = {
  /** the square's west edge: the seam */
  seam: -SQUARE_HALF,
  /** the rim's mountain falls away over this, after a level top as wide as the square's own */
  fall: [10, 420] as const,
  /** the square's high country (its outer hills stand 85 m up) settles into the green land over this */
  settle: [0, 600] as const,
  /** the green land's middle over the sea (about the square's valley floor, a little higher), and how much of the square's ridges it keeps */
  level: 26,
  ridges: 0.35,
  /** the rims along the north and south edges are carried on across it, this much of them, and gone by the coast */
  rims: 0.45,
  /** the shore's line (x) and how far it wanders either way, slow and quick: the sea is the westmost 250 m or so */
  shore: -3590,
  wander: [18, 6] as const,
  /** the beach: its rise to the metre, how far it runs inland before the land rises off it, and how far it goes out under the water before the floor drops away */
  beach: 0.035,
  sand: 70,
  shelf: 40,
  /** how much deeper the floor goes past the shelf, and over how far */
  deep: 10,
  deepRun: 160,
  /** the land comes up off the beach over this (from the shore, inland) */
  coast: [70, 330] as const,
  /** the woods of the rim give out over this */
  woods: [30, 430] as const,
  /**
   * where a barrier would stand to keep players out of the sea (the owner: "no need to go into it or swim can put
   * barrier on beach"): this many metres out from the shore line (`shoreLine`), where the water is about a metre deep
   */
  barrier: 30,
};

const q1 = new Simplex(WORLD_SEED + 301), q2 = new Simplex(WORLD_SEED + 302);
/** the shore's line: the x at which the ground meets the sea, at a z (the world's own seed) */
export function shoreLine(z: number, seed = WORLD_SEED) {
  const [a, b] = seed === WORLD_SEED ? [q1, q2] : [new Simplex(seed + 301), new Simplex(seed + 302)];
  return WEST.shore + WEST.wander[0] * a.noise(z * 0.0021, 3.1) + WEST.wander[1] * b.noise(z * 0.011, 7.7);
}

export interface SquareFields {
  heights: Float32Array;
  surface: Float32Array;
  splat: Uint8Array;
  grass: Uint8Array;
}

export interface WestTools {
  seed: number;
  /** the square's rim, as a function of a spot: carried on past the seam */
  ringShape: (x: number, z: number) => number;
  /** the square's woods (more than nothing: a wood), carried on past the seam and thinned out */
  forestMask: (x: number, z: number) => number;
  /** the trees: those of the rim's fall are added after all of the square's */
  trees: Instance[];
  /** the square's three noises: its valley's shape and its paint's patches run on across the seam */
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

  const W = WEST, [n1, n2, n3] = tools.noise, p3 = new Simplex(tools.seed + 303);
  /** how much of the rim's mountain a spot of the west is (`d` metres west of the seam) */
  const mountain = (d: number, z: number) => {
    const west = 1 - smoothstep(W.fall[0], W.fall[1], d);
    // (the rims along the north and south edges, as the square has them, kept in part, and gone by the coast: the
    // beach runs to the edge of the world)
    const ns = (1 - smoothstep(10, 185, SQUARE_HALF - Math.abs(z))) * (1 - (1 - W.rims) * smoothstep(0, 600, d)) * smoothstep(W.shore + 250, W.shore + 900, W.seam - d);
    return 1 - (1 - west) * (1 - ns);
  };
  // The square's own valley noise, carried on: its slow swell and its outer ridges (`slow`), and its lesser lie and
  // roughness (`quick`). At the seam this and the rim are exactly the square's ground as it was first laid. The slow
  // part is reckoned every four metres and read between, a quarter of the work, but for the first 120 m.
  const slow = (x: number, z: number, d: number) =>
    16 * n1.fbm(x * 0.0024, z * 0.0024, 5) + 30 * n2.ridged(x * 0.0019 + 5, z * 0.0019 - 3, 4) * (1 - (1 - W.ridges) * smoothstep(W.settle[0], W.settle[1], d));
  const quick = (x: number, z: number) => 5 * n2.fbm(x * 0.011 + 31.7, z * 0.011 - 12.1, 4) + 0.9 * n3.fbm(x * 0.06, z * 0.06, 3);
  const PS = 4, PW = Math.ceil((W.seam - WORLD_X0) / PS) + 2, PH = Math.ceil((WORLD_Z1 - WORLD_Z0) / PS) + 2, slows = new Float32Array(PW * PH);
  for (let j = 0; j < PH; j++) for (let i = 0; i < PW; i++) {
    const x = WORLD_X0 + i * PS, z = WORLD_Z0 + j * PS;
    slows[j * PW + i] = slow(x, z, W.seam - x);
  }
  const slowAt = (x: number, z: number, d: number) => {
    if (d < 120) return slow(x, z, d);
    const gx = clamp((x - WORLD_X0) / PS, 0, PW - 1.001), gz = clamp((z - WORLD_Z0) / PS, 0, PH - 1.001), i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, o = j * PW + i;
    return (slows[o] * (1 - fx) + slows[o + 1] * fx) * (1 - fz) + (slows[o + PW] * (1 - fx) + slows[o + PW + 1] * fx) * fz;
  };
  const land = (x: number, z: number) => {
    const d = W.seam - x, s = smoothstep(W.settle[0], W.settle[1], d), m = mountain(d, z);
    return slowAt(x, z, d) + quick(x, z) + 85 * (1 - s) + (SEA_LEVEL + W.level) * s + (m > 0 ? tools.ringShape(x, z) * Math.pow(m, 1.15) : 0);
  };
  /** the beach and the sea floor, by the distance from the shore (+ inland) */
  const shoreline = (c: number, x: number, z: number) => {
    if (c > -W.shelf) return SEA_LEVEL + W.beach * c;
    const out = -W.shelf - c;
    return SEA_LEVEL - W.beach * W.shelf - W.deep * smoothstep(0, W.deepRun, out) + 0.6 * p3.noise(x * 0.01, z * 0.01) * smoothstep(0, 60, out);
  };
  const shores = Float64Array.from({ length: NZ }, (_, iz) => shoreLine(WORLD_Z0 + iz * CELL, tools.seed));

  // The ground, and the square's last column met: whatever the square's later stages did to it is taken up within
  // 80 m of the seam, so that the step is nothing and the slope carries on.
  for (let iz = 0; iz < NZ; iz++) {
    const z = WORLD_Z0 + iz * CELL, off = heights[iz * NX + OX] - land(W.seam, z), shore = shores[iz];
    for (let ix = 0; ix < OX; ix++) {
      const x = WORLD_X0 + ix * CELL, c = x - shore, on = smoothstep(W.coast[0], W.coast[1], c);
      const h = on >= 1 ? land(x, z) : on <= 0 ? shoreline(c, x, z) : shoreline(c, x, z) * (1 - on) + land(x, z) * on;
      heights[iz * NX + ix] = h + off * (1 - smoothstep(0, 80, W.seam - x));
    }
  }
  // The square's ridges have knife edges where an octave of the noise goes through nothing (the square's own are
  // rounded off: see `soften`). Out here they are evened over the points about each, twice, from 60 m from the seam
  // on, so that the seam is the square's ground and the green land's ridges have round backs.
  for (let pass = 0; pass < 2; pass++) {
    const was = heights.slice(0, NZ * NX);
    for (let iz = 1; iz < NZ - 1; iz++) for (let ix = 1; ix < OX - 1; ix++) {
      const w = 1 - smoothstep(60, 200, W.seam - (WORLD_X0 + ix * CELL));
      if (w >= 1) continue;
      const i = iz * NX + ix, mean = (was[i - 1] + was[i + 1] + was[i - NX] + was[i + NX]) * 0.125 + (was[i - NX - 1] + was[i - NX + 1] + was[i + NX - 1] + was[i + NX + 1]) * 0.0625 + was[i] * 0.25;
      heights[i] = was[i] * w + mean * (1 - w);
    }
  }
  if (own) for (let iz = 0; iz < NZ; iz++) surface.set(heights.subarray(iz * NX, iz * NX + OX), iz * NX);

  // The paint: green, by the square's own rule (rock by slope, its woods thinning out down the fall and meadow
  // beyond, the meadows' bald patches), and by its own noises, so that its patches run on over the seam. Bare on the
  // beach and under the sea (the paint's trodden ground, until the coast's own sand comes).
  // (the woods give out wholly by the end of the fall: a wood out here is at most some 1.9, and two less is none)
  const woodAt = (x: number, z: number) => (W.seam - x > W.woods[1] ? -1 : tools.forestMask(x, z) - 2 * smoothstep(W.woods[0], W.woods[1], W.seam - x));
  for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < OX; ix++) {
    const x = WORLD_X0 + ix * CELL, z = WORLD_Z0 + iz * CELL, i = iz * NX + ix, h = heights[i], c = x - shores[iz];
    // (the slope as `slopeAt` has it, read off the net's own samples: they are the heights it would read)
    const r = Math.min(ix + 1, NX - 1), l = Math.max(ix - 1, 0), u = Math.max(iz - 1, 0), dn = Math.min(iz + 1, NZ - 1);
    const slope = Math.hypot(heights[iz * NX + r] - heights[iz * NX + l], heights[dn * NX + ix] - heights[u * NX + ix]) / (2 * CELL);
    // (each noise asked only where it can tell: rock on a slope near enough to steep)
    let rock = slope < 0.39 ? 0 : clamp(smoothstep(0.5, 0.85, slope + 0.1 * n3.noise(x * 0.05, z * 0.05)), 0, 1);
    let forest = smoothstep(-0.05, 0.25, woodAt(x, z));
    // (the beach and the sea floor, its edge a ragged one)
    const sand = c < W.sand - 25 ? 1 : c > W.sand + 27 ? 0 : 1 - smoothstep(W.sand - 25, W.sand + 15, c + 12 * p3.noise(x * 0.03, z * 0.03));
    let bare = sand >= 1 ? 1 : Math.max(sand, smoothstep(0.55, 0.75, n2.noise(x * 0.03, z * 0.03)) * 0.5 * (1 - forest));
    if (sand >= 1) rock = 0;
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
