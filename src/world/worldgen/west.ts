// THE WEST (2026-10-16): the square laid into the world's rectangle, and the ground of the two squares west of it.
// The owner: "from west to east itll be ocean, beach, desert, plains, mountains. We have the plains and mountains."
// And then, of how: "it should blend in a lot ... pretty water, no need to go into it or swim can put barrier on
// beach, but maybe dont give a lot of width of the map to the ocean ... desert is ugly the grass is prettier". The plan
// the owner said yes to (v2, west-plan.ts): the square opened west (opening.ts), green land of the square's own kind
// with a pine forest, birch woods and meadows, the bunker in the pines, the trading post and the main road on to the
// beach, ground kept level for a monastery town, a hamlet and two ruined towns, a small desert fading through steppe
// into the green, a canyon cut into the desert's tableland, a beach and a thin strip of sea.
//
// Nothing of the square is touched here: its samples are copied as they are, and what is new has noise of its own.
// At the seam it is the square's own ground carried on (the same valley noise, and its rim where it is kept), and the
// square's last column met exactly, so there is no step and no crease.

import { Simplex, clamp, hash2, lerp, smoothstep } from '../../core/noise';
import { BUNKER } from '../../sim/bunker';
import { SNOW } from './layout';
import { CELL, SEA_LEVEL, SQUARE_HALF, SQUARE_RES, WORLD_NX, WORLD_NZ, WORLD_SEED, WORLD_X0, WORLD_Z0, WORLD_Z1 } from './places';
import { catmullRom, heightAt, slopeAt } from './ground';
import { PLAN, bed, inBox, movedPost, nearLine, openness, outside } from './west-plan';
import type { Instance, Site } from './types';

/** the shape of the new ground, in metres west of the square's edge (`d`) or from the shore (`c`, + inland) */
export const WEST = {
  /** the square's west edge: the seam */
  seam: -SQUARE_HALF,
  /** where the square's rim is kept (north and south of the opening), it falls away over this, after a level top as wide as the square's own */
  fall: [10, 420] as const,
  /** the square's high country (its outer hills stand 85 m up) settles into the green land over this */
  settle: [0, 600] as const,
  /** the green land's middle over the sea (a little over the valley's floor), and how much of the square's ridges it keeps */
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
  /** nobody goes west of this: on the beach, the sea in sight (see PLAN.barrier) */
  barrier: PLAN.barrier,
};

const q1 = new Simplex(WORLD_SEED + 301), q2 = new Simplex(WORLD_SEED + 302);
/** the shore's line: the x at which the ground meets the sea, at a z (the world's own seed) */
export function shoreLine(z: number, seed = WORLD_SEED) {
  const [a, b] = seed === WORLD_SEED ? [q1, q2] : [new Simplex(seed + 301), new Simplex(seed + 302)];
  return WEST.shore + WEST.wander[0] * a.noise(z * 0.0021, 3.1) + WEST.wander[1] * b.noise(z * 0.011, 7.7);
}

/** the green land where the square is opened: the square's valley noise with a third of its ridges, rising from the valley's floor at the rim to its own level */
export function openGround(noise: [Simplex, Simplex, Simplex], x: number, z: number) {
  const [n1, n2, n3] = noise;
  return 16 * n1.fbm(x * 0.0024, z * 0.0024, 5) + 30 * WEST.ridges * n2.ridged(x * 0.0019 + 5, z * 0.0019 - 3, 4)
    + 5 * n2.fbm(x * 0.011 + 31.7, z * 0.011 - 12.1, 4) + 0.9 * n3.fbm(x * 0.06, z * 0.06, 3) + (SEA_LEVEL + WEST.level) * smoothstep(PLAN.rise[0], PLAN.rise[1], -x);
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
  /** the trees, rocks and props: the west's are added after all of the square's; the square's in the way of a new road or plot are taken away */
  trees: Instance[];
  rocks: Instance[];
  props: Instance[];
  /** the places (the bunker's is already where it is now: see opening.ts) */
  sites: Site[];
  /** the roads there are: the new ones are added */
  roads: { points: Float32Array; width: number; side?: boolean }[];
  /** the square's three noises: its valley's shape and its paint's patches run on across the seam */
  noise: [Simplex, Simplex, Simplex];
}

/**
 * The square's fields laid into the world's, and the west made. The square's own arrays are left as they were; new
 * ones are given back. `surface` stays the same array as `heights` when it was.
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
  const net = { x0: WORLD_X0, z0: WORLD_Z0, nx: NX, nz: NZ };
  const W = WEST, [n1, n2, n3] = tools.noise, p3 = new Simplex(tools.seed + 303), p4 = new Simplex(tools.seed + 304);
  const xOf = (ix: number) => WORLD_X0 + ix * CELL, zOf = (iz: number) => WORLD_Z0 + iz * CELL;

  // ---- THE GROUND
  /** how much of the rim's mountain a spot of the west is (`d` metres west of the seam), where the rim is kept */
  const mountain = (d: number, z: number) => {
    const west = 1 - smoothstep(W.fall[0], W.fall[1], d);
    // (the rims along the north and south edges, as the square has them, kept in part, and gone by the coast: the
    // beach runs to the edge of the world)
    const ns = (1 - smoothstep(10, 185, SQUARE_HALF - Math.abs(z))) * (1 - (1 - W.rims) * smoothstep(0, 600, d)) * smoothstep(W.shore + 250, W.shore + 900, W.seam - d);
    return 1 - (1 - west) * (1 - ns);
  };
  // The square's own valley noise, carried on: its slow swell and its outer ridges, and its lesser lie and roughness
  // (`quick`). The slow parts are reckoned every four metres and read between, a quarter of the work, but for the
  // first 120 m, where they are reckoned at every sample: there they are the square's own.
  const quick = (x: number, z: number) => 5 * n2.fbm(x * 0.011 + 31.7, z * 0.011 - 12.1, 4) + 0.9 * n3.fbm(x * 0.06, z * 0.06, 3);
  const PS = 4, PW = Math.ceil((W.seam - WORLD_X0) / PS) + 2, PH = Math.ceil((WORLD_Z1 - WORLD_Z0) / PS) + 2;
  const swellG = new Float32Array(PW * PH), ridgeG = new Float32Array(PW * PH);
  for (let j = 0; j < PH; j++) for (let i = 0; i < PW; i++) {
    const x = WORLD_X0 + i * PS, z = WORLD_Z0 + j * PS;
    swellG[j * PW + i] = 16 * n1.fbm(x * 0.0024, z * 0.0024, 5);
    ridgeG[j * PW + i] = 30 * n2.ridged(x * 0.0019 + 5, z * 0.0019 - 3, 4);
  }
  const slowAt = (x: number, z: number, d: number): [number, number] => {
    if (d < 120) return [16 * n1.fbm(x * 0.0024, z * 0.0024, 5), 30 * n2.ridged(x * 0.0019 + 5, z * 0.0019 - 3, 4)];
    const gx = clamp((x - WORLD_X0) / PS, 0, PW - 1.001), gz = clamp((z - WORLD_Z0) / PS, 0, PH - 1.001), i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, o = j * PW + i;
    const read = (g: Float32Array) => (g[o] * (1 - fx) + g[o + 1] * fx) * (1 - fz) + (g[o + PW] * (1 - fx) + g[o + PW + 1] * fx) * fz;
    return [read(swellG), read(ridgeG)];
  };
  /** the land: where the square is opened the green land (`openGround`), where its rim is kept the rim falling away into it */
  const land = (x: number, z: number) => {
    const d = W.seam - x, o = openness(z), [swell, ridge] = slowAt(x, z, d), q = quick(x, z);
    const open = swell + W.ridges * ridge + q + (SEA_LEVEL + W.level) * smoothstep(PLAN.rise[0], PLAN.rise[1], -x);
    if (o >= 1) return open;
    const s = smoothstep(W.settle[0], W.settle[1], d), m = mountain(d, z);
    const rim = swell + ridge * (1 - (1 - W.ridges) * s) + q + 85 * (1 - s) + (SEA_LEVEL + W.level) * s + (m > 0 ? tools.ringShape(x, z) * Math.pow(m, 1.15) : 0);
    return lerp(rim, open, o);
  };
  /** the beach and the sea floor, by the distance from the shore (+ inland) */
  const shoreline = (c: number, x: number, z: number) => {
    if (c > -W.shelf) return SEA_LEVEL + W.beach * c;
    const out = -W.shelf - c;
    return SEA_LEVEL - W.beach * W.shelf - W.deep * smoothstep(0, W.deepRun, out) + 0.6 * p3.noise(x * 0.01, z * 0.01) * smoothstep(0, 60, out);
  };
  const shores = Float64Array.from({ length: NZ }, (_, iz) => shoreLine(zOf(iz), tools.seed));
  // The ground, and the square's last column met: whatever the square's later stages did to it is taken up within
  // 80 m of the seam, so that the step is nothing and the slope carries on.
  for (let iz = 0; iz < NZ; iz++) {
    const z = zOf(iz), off = heights[iz * NX + OX] - land(W.seam, z), shore = shores[iz];
    for (let ix = 0; ix < OX; ix++) {
      const x = xOf(ix), c = x - shore, on = smoothstep(W.coast[0], W.coast[1], c);
      const h = on >= 1 ? land(x, z) : on <= 0 ? shoreline(c, x, z) : shoreline(c, x, z) * (1 - on) + land(x, z) * on;
      heights[iz * NX + ix] = h + off * (1 - smoothstep(0, 80, W.seam - x));
    }
  }
  // The square's ridges have knife edges where an octave of the noise goes through nothing (the square's own are
  // rounded off: see `soften`). Out here they are evened over the points about each, twice, from 60 m past the seam.
  for (let pass = 0; pass < 2; pass++) {
    const prev = heights.slice(0, NZ * NX);
    for (let iz = 1; iz < NZ - 1; iz++) for (let ix = 1; ix < OX - 1; ix++) {
      const w = 1 - smoothstep(60, 200, W.seam - xOf(ix));
      if (w >= 1) continue;
      const i = iz * NX + ix, mean = (prev[i - 1] + prev[i + 1] + prev[i - NX] + prev[i + NX]) * 0.125 + (prev[i - NX - 1] + prev[i - NX + 1] + prev[i + NX - 1] + prev[i + NX + 1]) * 0.0625 + prev[i] * 0.25;
      heights[i] = prev[i] * w + mean * (1 - w);
    }
  }
  // (what the square's own trees, rocks and props stood on before the west's places were made: they are set on the ground as it is after)
  const was = heights.slice();
  const seen = () => { if (own) for (let iz = 0; iz < NZ; iz++) surface.set(heights.subarray(iz * NX, iz * NX + OX), iz * NX); };

  // THE CANYON (PLAN.canyon): a winding dry valley cut into a tableland of the desert, from a mouth by the beach to
  // one onto the steppe. Its floor rises from just over the beach to the steppe's height; its walls stand 15 to 30 m
  // over it, in ledges, steep enough for a cave's mouth to be cut in them; the tableland they are the edges of goes
  // back into the land round it. (Its caves are a module of their own: they will open the ground where their mouths are.)
  const C = PLAN.canyon, cl = C.line, cEnd = cl[cl.length - 1], cStart = cl[0];
  const steppeY = heightAt(heights, cEnd[0] + 40, cEnd[1] + 40), mouthY = heightAt(heights, cStart[0], cStart[1]);
  {
    const box = cl.reduce((b, [x, z]) => [Math.min(b[0], x), Math.max(b[1], x), Math.min(b[2], z), Math.max(b[3], z)], [Infinity, -Infinity, Infinity, -Infinity]);
    const far = C.floor[1] + C.walls[1] / C.face + C.table[1];
    const ix0 = Math.max(0, Math.floor((box[0] - far - WORLD_X0) / CELL)), ix1 = Math.min(OX - 1, Math.ceil((box[1] + far - WORLD_X0) / CELL));
    const iz0 = Math.max(0, Math.floor((box[2] - far - WORLD_Z0) / CELL)), iz1 = Math.min(NZ - 1, Math.ceil((box[3] + far - WORLD_Z0) / CELL));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const x = xOf(ix), z = zOf(iz), { d, t } = nearLine(cl, x, z);
      if (d > far) continue;
      // (past either end it opens: its walls and its tableland given back to the land over 70 m)
      const ends = Math.min(Math.hypot(x - cStart[0], z - cStart[1]), Math.hypot(x - cEnd[0], z - cEnd[1]));
      const open = t <= 0.001 || t >= 0.999 ? smoothstep(0, 70, ends) : 0;
      const floorY = lerp(mouthY + 0.5, steppeY - 0.5, Math.pow(t, 1.3)) + 0.4 * p4.noise(x * 0.03, z * 0.03);
      const halfW = lerp(C.floor[0], C.floor[1], 0.5 + 0.5 * p4.noise(t * 9, 1.7));
      const wallH = lerp(C.walls[0], C.walls[1], 0.5 + 0.5 * p4.noise(t * 6 + 4, 2.3)) * (1 - open);
      const run = wallH / C.face, top = floorY + wallH + 2 * p4.fbm(x * 0.02, z * 0.02, 3);
      // (the walls in steps where the rock is harder: a ledge every few metres, and a face between)
      const u = clamp((d - halfW) / run, 0, 1), steps = u + 0.06 * Math.sin(u * Math.PI * 5);
      const cut = d <= halfW ? floorY : floorY + (top - floorY) * clamp(steps, 0, 1);
      // (and the tableland goes no further than the beach's inland edge: the sand runs on to the canyon's mouth)
      const beach = smoothstep(W.sand, W.sand + 90, x - shores[iz]);
      const table = (1 - smoothstep(halfW + run + C.table[0], halfW + run + C.table[1], d)) * beach;
      const i = iz * NX + ix, h = heights[i];
      heights[i] = d <= halfW + run ? lerp(h, cut, (1 - open * 0.999) * beach) : lerp(h, Math.max(h, top), table * (1 - open));
    }
  }

  // THE PLOTS (PLAN.plots), level and clear for what is to be built on them: each at the ground's own mean height
  // under it, eased into the land about it over 40 m.
  const plotY = PLAN.plots.map((p) => {
    let sum = 0, c = 0;
    for (let x = p.x - p.w / 2; x <= p.x + p.w / 2; x += 8) for (let z = p.z - p.d / 2; z <= p.z + p.d / 2; z += 8) { sum += heightAt(heights, x, z); c++; }
    return sum / c;
  });
  PLAN.plots.forEach((p, k) => {
    const E = 40, ix0 = Math.max(0, Math.floor((p.x - p.w / 2 - E - WORLD_X0) / CELL)), ix1 = Math.min(NX - 1, Math.ceil((p.x + p.w / 2 + E - WORLD_X0) / CELL));
    const iz0 = Math.max(0, Math.floor((p.z - p.d / 2 - E - WORLD_Z0) / CELL)), iz1 = Math.min(NZ - 1, Math.ceil((p.z + p.d / 2 + E - WORLD_Z0) / CELL));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const out = Math.max(Math.abs(xOf(ix) - p.x) - p.w / 2, Math.abs(zOf(iz) - p.z) - p.d / 2, 0), i = iz * NX + ix;
      heights[i] = lerp(plotY[k] + 0.15 * p4.noise(xOf(ix) * 0.05, zOf(iz) * 0.05), heights[i], smoothstep(0, E, out));
    }
  });

  // THE TRADING POST'S YARD (its buildings were moved to it: opening.ts), levelled as its first place was.
  const post = movedPost();
  {
    const R = 60, target = heightAt(heights, post.x, post.z);
    for (let iz = Math.max(0, Math.floor((post.z - R - WORLD_Z0) / CELL)); iz <= Math.min(NZ - 1, Math.ceil((post.z + R - WORLD_Z0) / CELL)); iz++)
      for (let ix = Math.max(0, Math.floor((post.x - R - WORLD_X0) / CELL)); ix <= Math.min(NX - 1, Math.ceil((post.x + R - WORLD_X0) / CELL)); ix++) {
        const x = xOf(ix), z = zOf(iz), d = Math.hypot(x - post.x, z - post.z);
        if (d > R) continue;
        const i = iz * NX + ix, w = 1 - smoothstep(22, R, d);
        heights[i] = lerp(heights[i], target + 0.35 * n3.fbm(x * 0.02, z * 0.02, 3) + (heights[i] - target) * 0.25, w);
      }
  }

  // (the ground as it is seen is the ground itself, out here, but under the bunker's roof)
  seen();

  // THE BUNKER, alone in the pines (its place, BUNKER_AT, is the site opening.ts moved): at the foot of a knoll, cut
  // into it as it was into the old hillside (src/world/worldgen/generate.ts, the second expansion, by the same rule).
  const bunker = tools.sites.find((s) => s.kind === 'bunker');
  const yard: { x: number; z: number; rot: number }[] = [];
  if (bunker) cutBunker(heights, surface, bunker, tools, yard);

  // THE ROADS (PLAN.road): the main one from the loop's west bend to the beach, and its branches. Each lies on the
  // ground evened out along it over fifty metres, nowhere steeper than PLAN.road.steep, a branch from the main road's
  // own height where it leaves it; and its bed is laid into the ground.
  const loop = tools.roads.reduce((a, b) => (b.points.length > a.points.length ? b : a));
  const nearest = (p: Float32Array, x: number, z: number) => {
    let k = 0, d = Infinity;
    for (let j = 0; j < p.length; j += 3) { const e = Math.hypot(p[j] - x, p[j + 2] - z); if (e < d) { d = e; k = j; } }
    return k;
  };
  // (a road through a plot lies exactly at the plot's own level, its gateways and all: those points are held there)
  const onPlot = (x: number, z: number) => PLAN.plots.findIndex((p) => Math.abs(x - p.x) < p.w / 2 - 10 && Math.abs(z - p.z) < p.d / 2 - 10);
  const lay = (pts: [number, number][], first: number | null, width: number, side: boolean) => {
    const line = catmullRom(pts, 4), raw = line.map(([x, z]) => heightAt(heights, x, z)), nL = line.length;
    const ys = raw.map((_, k) => { let s = 0, c = 0; for (let j = -12; j <= 12; j++) { const q = 1 - Math.abs(j) / 13; s += raw[clamp(k + j, 0, nL - 1)] * q; c += q; } return s / c; });
    // (and a branch leaves the main road level with it, across the main road's own bed and a little more)
    const held = line.map(([x, z], k) => {
      const q = onPlot(x, z);
      if (q >= 0) ys[k] = plotY[q];
      const flat = first !== null && Math.hypot(x - line[0][0], z - line[0][1]) <= (k === 0 || side ? PLAN.road.width / 2 + 6 : 0);
      if (flat) ys[k] = first!;
      return q >= 0 || flat;
    });
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 1; k < nL; k++) { if (held[k]) continue; const m = PLAN.road.steep * Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]); ys[k] = clamp(ys[k], ys[k - 1] - m, ys[k - 1] + m); }
      for (let k = nL - 2; k >= 0; k--) { if (held[k]) continue; const m = PLAN.road.steep * Math.hypot(line[k][0] - line[k + 1][0], line[k][1] - line[k + 1][1]); ys[k] = clamp(ys[k], ys[k + 1] - m, ys[k + 1] + m); }
    }
    const points = new Float32Array(nL * 3);
    line.forEach(([x, z], k) => points.set([x, ys[k], z], k * 3));
    const road = { points, width, ...(side ? { side: true } : {}) };
    tools.roads.push(road);
    return road;
  };
  const start = nearest(loop.points, PLAN.road.main[0][0], PLAN.road.main[0][1]);
  const main = lay([[loop.points[start], loop.points[start + 2]], ...PLAN.road.main.slice(1)], loop.points[start + 1], PLAN.road.width, false);
  const branch = (pts: [number, number][]) => {
    const k = nearest(main.points, pts[0][0], pts[0][1]);
    return lay([[main.points[k], main.points[k + 2]], ...pts.slice(1)], main.points[k + 1], PLAN.road.branch, true);
  };
  const ways = [main, branch(PLAN.road.bunker), branch(PLAN.road.hamlet), branch(PLAN.road.canyon)];
  const preBed = heights.slice(), gap = new Float32Array(n).fill(1e9);
  // (the branches' beds first, and the main road's over them where they meet)
  for (const r of [...ways.slice(1), main]) bed(heights, r.points, r.width, PLAN.road.bed, () => 1, net, { fill: 0.35, cut: 0.6, gap });
  // (the ground as it is seen moved as the ground was by the beds: in the square's opened west too)
  if (own) for (let i = 0; i < n; i++) if (heights[i] !== preBed[i]) surface[i] += heights[i] - preBed[i];

  // ---- WHAT STANDS IN THE WAY: of the square's own trees, rocks and props, those on a new road or plot go (and
  // anything on ground moved under it is set on it again)
  const M = PLAN.monastery;
  const clear = (x: number, z: number, pad: number) =>
    gap[clamp(Math.round((z - WORLD_Z0) / CELL), 0, NZ - 1) * NX + clamp(Math.round((x - WORLD_X0) / CELL), 0, NX - 1)] < pad ||
    PLAN.plots.some((p) => Math.abs(x - p.x) < p.w / 2 + pad && Math.abs(z - p.z) < p.d / 2 + pad) ||
    outside(M.wall, x, z) < M.clear || Math.hypot(x - post.x, z - post.z) < 40 + pad ||
    yard.some((y) => { const dx = x - y.x, dz = z - y.z, r = dx * Math.cos(y.rot) - dz * Math.sin(y.rot), f = dx * Math.sin(y.rot) + dz * Math.cos(y.rot); return Math.abs(r) < 30 && f > -36 && f < 60; });
  for (const list of [tools.trees, tools.rocks, tools.props]) {
    for (let k = list.length - 1; k >= 0; k--) {
      const t = list[k];
      if (t.x > -400) continue;
      if (clear(t.x, t.z, 3)) { list.splice(k, 1); continue; }
      const d = heightAt(heights, t.x, t.z) - heightAt(was, t.x, t.z);
      if (d !== 0) t.y += d;
    }
  }

  // ---- THE PAINT: green by the square's own rule (rock by slope, the rim's woods thinning down the fall, the
  // meadows' bald patches), by its own noises so that its patches run on over the seam; the pine forest's and the
  // birch woods' floors; drying west through steppe into the desert's bare sand, and bare on the beach and under the
  // sea (the paint's trodden ground, until the coast's own sand comes); the roads' verges bare.
  const B = PLAN.bands;
  // (the woods give out wholly by the end of the fall: a wood out here is at most some 1.9, and two less is none)
  const rimWood = (x: number, z: number) => (W.seam - x > W.woods[1] ? -1 : tools.forestMask(x, z) - 2 * smoothstep(W.woods[0], W.woods[1], W.seam - x));
  // (half as much again as bare: the steppe's dry grass; all bare by the desert's sand)
  const dryOf = (x: number) => 0.45 * smoothstep(-B.green, -B.steppe, -x) + 0.55 * smoothstep(-B.sand, -B.sand + 100, -x);
  for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < OX; ix++) {
    const x = xOf(ix), z = zOf(iz), i = iz * NX + ix, h = heights[i], c = x - shores[iz];
    // (the slope as `slopeAt` has it, read off the net's own samples: they are the heights it would read)
    const r = Math.min(ix + 1, NX - 1), l = Math.max(ix - 1, 0), u = Math.max(iz - 1, 0), dn = Math.min(iz + 1, NZ - 1);
    const slope = Math.hypot(heights[iz * NX + r] - heights[iz * NX + l], heights[dn * NX + ix] - heights[u * NX + ix]) / (2 * CELL);
    // (each noise asked only where it can tell)
    let rock = slope < 0.39 ? 0 : clamp(smoothstep(0.5, 0.85, slope + 0.1 * n3.noise(x * 0.05, z * 0.05)), 0, 1);
    let forest = Math.max(smoothstep(-0.05, 0.25, rimWood(x, z)), pineWood(x, z), birchWood(x, z));
    const sand = c < W.sand - 25 ? 1 : c > W.sand + 27 ? 0 : 1 - smoothstep(W.sand - 25, W.sand + 15, c + 12 * p3.noise(x * 0.03, z * 0.03));
    // (dry west of the green: the steppe's dry grass, then the desert's sand; their edges ragged)
    const dry = x > B.green + 60 ? 0 : clamp(dryOf(x + 50 * p4.noise(x * 0.004, z * 0.004)), 0, 1);
    let bare = sand >= 1 || dry >= 1 ? 1 : Math.max(sand, dry, smoothstep(0.55, 0.75, n2.noise(x * 0.03, z * 0.03)) * 0.5 * (1 - forest) * (1 - dry));
    if (sand >= 1) rock = 0;
    forest *= (1 - rock) * (1 - dry);
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
  // (the roads' verges, in the square's opened west too: the gravel of a road's edge, and no grass on it)
  for (const r of ways) verges(splat, grass, r.points, r.width, net, p3);
  // (the bunker's own floor, as the bunker's stage leaves it: no grass in its hut or its yard)
  for (const y of yard) clearYard(grass, y);

  // ---- THE TREES
  // The rim's woods down the fall, by the rule the square's own rim is planted by (its grid carried on west, its
  // hashes), thinning out as the woods give out. Nothing is planted on the square.
  const STEP = 6.2, seed = tools.seed, pines = ['pine_a', 'pine_b', 'pine_c', 'pine_d'];
  const free = (x: number, z: number) => !clear(x, z, 4) && slopeAt(heights, x, z) <= 1.05 && x > W.barrier + 30;
  for (let gz = -SQUARE_HALF + 10; gz < SQUARE_HALF - 10; gz += STEP) {
    for (let gx = -SQUARE_HALF + 10 - STEP; gx > W.seam - W.woods[1] - 20; gx -= STEP) {
      const hx = hash2(Math.round(gx * 10), Math.round(gz * 10), seed + 41);
      const hz = hash2(Math.round(gz * 10), Math.round(gx * 10), seed + 47);
      const x = gx + (hx - 0.5) * STEP * 0.9, z = gz + (hz - 0.5) * STEP * 0.9;
      if (x > W.seam - 0.5 || !free(x, z)) continue;
      const f = rimWood(x, z), hv = hash2(Math.round(x * 7), Math.round(z * 7), seed + 43);
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
  // The pine forest and the birch woods (the trees there are of the kinds the map has: the new forests' own come with
  // their models), and a lone tree now and then in the green land between; none in the meadows, the steppe or the
  // desert. On a grid of its own, by hashes of its own.
  for (let gz = WORLD_Z0 + 8; gz < WORLD_Z1 - 8; gz += STEP) {
    for (let gx = W.seam - 6; gx > B.steppe; gx -= STEP) {
      const hx = hash2(Math.round(gx * 10), Math.round(gz * 10), seed + 61), hz = hash2(Math.round(gz * 10), Math.round(gx * 10), seed + 67);
      const x = gx + (hx - 0.5) * STEP * 0.9, z = gz + (hz - 0.5) * STEP * 0.9;
      const hv = hash2(Math.round(x * 7), Math.round(z * 7), seed + 63), pw = pineWood(x, z), bw = birchWood(x, z);
      const mb = PLAN.meadows, meadow = x < mb.x0 - 70 || x > mb.x1 + 70 || z < mb.z0 - 70 || z > mb.z1 + 70 ? 0 : inBox(mb, x, z, 40, 20), lone = hv < 0.012 * (1 - meadow) * (1 - smoothstep(-B.green - 150, -B.steppe, -x));
      const inPines = pw > 0.05 && hv < pw * 0.62, inBirches = !inPines && bw > 0.05 && hv < bw * 0.5;
      if (!inPines && !inBirches && !lone) continue;
      if (!free(x, z)) continue;
      const y = heightAt(heights, x, z), s = hash2(Math.round(x), Math.round(z), 5);
      let kind: string;
      if (inPines) kind = pw < 0.25 && s < 0.25 ? 'birch_a' : pines[Math.floor(s * pines.length)];
      else if (inBirches) kind = s < 0.42 ? 'birch_a' : s < 0.84 ? 'birch_b' : s < 0.92 ? 'bush_a' : 'bush_b';
      else kind = s < 0.4 ? 'oak_a' : s < 0.7 ? 'ash_a' : 'birch_a';
      tools.trees.push({ kind, x, y, z, rot: hx * Math.PI * 2, scale: 0.85 + hz * 0.35 });
    }
  }
  return { heights, surface, splat, grass };
}

const wood = new Simplex(WORLD_SEED + 321);
/** how much of a spot is the pine forest (0 to 1), its edge let wander, and thinned in patches within */
function pineWood(x: number, z: number) {
  const b = PLAN.pines;
  if (x < b.x0 - 110 || x > b.x1 + 110 || z < b.z0 - 110 || z > b.z1 + 110) return 0;
  const m = inBox(b, x, z, 70, 35);
  return m <= 0 ? 0 : m * (0.65 + 0.35 * smoothstep(-0.4, 0.3, wood.fbm(x * 0.008, z * 0.008, 3)));
}
/** how much of a spot is the birch woods (0 to 1) */
function birchWood(x: number, z: number) {
  const b = PLAN.birches;
  if (x < b.x0 - 100 || x > b.x1 + 100 || z < b.z0 - 100 || z > b.z1 + 100) return 0;
  const m = inBox(b, x, z, 60, 30);
  return m <= 0 ? 0 : m * (0.55 + 0.45 * smoothstep(-0.3, 0.4, wood.fbm(x * 0.009 + 13, z * 0.009, 3)));
}

/** the gravel of a road's edge (as the square paints its road's, `paint`), and no grass on the road or within a step of it */
function verges(splat: Uint8Array, grass: Uint8Array, p: Float32Array, width: number, net: { x0: number; z0: number; nx: number; nz: number }, noise: Simplex) {
  const reach = width / 2 + 4;
  for (let k = 0; k + 1 < p.length / 3; k++) {
    const ax = p[k * 3], az = p[k * 3 + 2], bx = p[k * 3 + 3], bz = p[k * 3 + 5], ex = bx - ax, ez = bz - az, len2 = ex * ex + ez * ez || 1;
    const ix0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - net.x0) / CELL)), ix1 = Math.min(net.nx - 1, Math.ceil((Math.max(ax, bx) + reach - net.x0) / CELL));
    const iz0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - net.z0) / CELL)), iz1 = Math.min(net.nz - 1, Math.ceil((Math.max(az, bz) + reach - net.z0) / CELL));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const x = net.x0 + ix * CELL, z = net.z0 + iz * CELL, t = clamp(((x - ax) * ex + (z - az) * ez) / len2, 0, 1), d = Math.hypot(x - ax - ex * t, z - az - ez * t);
      if (d > reach) continue;
      const i = iz * net.nx + ix, g = 1 - smoothstep(width / 2 + 0.2, width / 2 + 2.4 + 1.2 * noise.noise(x * 0.2, z * 0.2), d);
      const has = splat[i * 4 + 3] / 255;
      if (g > has) {
        const rest = (1 - g) / Math.max(1e-3, 1 - has);
        for (let c = 0; c < 3; c++) splat[i * 4 + c] = Math.round(splat[i * 4 + c] * rest);
        splat[i * 4 + 3] = 255 - splat[i * 4] - splat[i * 4 + 1] - splat[i * 4 + 2];
      }
      if (d < width / 2 + 0.6) grass[i] = 0;
      else grass[i] = Math.round(grass[i] * (1 - smoothstep(0.2, 0.5, g)));
    }
  }
}

/** no grass in the bunker's hut nor in its yard (as its own stage leaves them) */
function clearYard(grass: Uint8Array, y: { x: number; z: number; rot: number }) {
  const B = BUNKER, c = Math.cos(y.rot), s = Math.sin(y.rot);
  for (let iz = Math.floor((y.z - 40 - WORLD_Z0) / CELL); iz <= Math.ceil((y.z + 40 - WORLD_Z0) / CELL); iz++)
    for (let ix = Math.floor((y.x - 40 - WORLD_X0) / CELL); ix <= Math.ceil((y.x + 40 - WORLD_X0) / CELL); ix++) {
      if (ix < 0 || iz < 0 || ix >= WORLD_NX || iz >= WORLD_NZ) continue;
      const dx = WORLD_X0 + ix * CELL - y.x, dz = WORLD_Z0 + iz * CELL - y.z, r = dx * c - dz * s, f = dx * s + dz * c;
      if (Math.abs(r) <= 3.8 && f >= B.hut.back - 1 && f <= B.court.front + 0.8) grass[iz * WORLD_NX + ix] = 0;
    }
}

/**
 * The bunker cut into the ground at its site, on the world's net, by the rule its first place was cut by (the second
 * expansion in generate.ts): a knoll for it to stand in the foot of, the floor levelled with the ground at its mouth,
 * the hillside behind cut back to a slope and let slump where it is steeper than a hillside holds, what stood in its
 * house, yard or way out taken away and what is left set on the ground again, and under its roof (which lies level
 * with the ground: `surface`) the ground dug out for its first level.
 */
function cutBunker(heights: Float32Array, surface: Float32Array, site: Site, tools: WestTools, yard: { x: number; z: number; rot: number }[]) {
  const B = BUNKER, NX = WORLD_NX, NZ = WORLD_NZ, [n1, n2, n3] = tools.noise;
  const bx = site.x, bz = site.z, rot = site.rot, ux = Math.sin(rot), uz = Math.cos(rot), R = B.floor + B.wall, X = B.reach;
  const span = (r: number, f: (x: number, z: number, i: number) => void, inset = 0) => {
    for (let iz = Math.max(inset, Math.floor((bz - r - WORLD_Z0) / CELL)); iz <= Math.min(NZ - 1 - inset, Math.ceil((bz + r - WORLD_Z0) / CELL)); iz++)
      for (let ix = Math.max(inset, Math.floor((bx - r - WORLD_X0) / CELL)); ix <= Math.min(NX - 1 - inset, Math.ceil((bx + r - WORLD_X0) / CELL)); ix++)
        f(WORLD_X0 + ix * CELL, WORLD_Z0 + iz * CELL, iz * NX + ix);
  };
  // the knoll it stands in the foot of: behind it, away from its mouth
  const kx = bx - ux * 70, kz = bz - uz * 70;
  span(170, (x, z, i) => { const d = Math.hypot(x - kx, z - kz) / 95; if (d < 1.8) heights[i] += 14 * Math.exp(-d * d * 1.6) * (0.85 + 0.3 * n1.noise(x * 0.02, z * 0.02)); });
  const before = heights.slice();
  const floorY = heightAt(before, bx + ux * (R - 6), bz + uz * (R - 6)) + 0.3;
  span(R, (x, z, i) => {
    const d = Math.hypot(x - bx, z - bz);
    if (d >= R) return;
    const wander = 7 * n2.fbm(x * 0.013 - 3, z * 0.013 + 11, 3) * smoothstep(B.floor - 10, B.floor - 3, d) * (1 - smoothstep(R - 14, R - 3, d));
    const t = clamp((d + wander - B.floor) / B.wall, 0, 1), w = 1 - (0.3 * smoothstep(0, 1, t) + 0.7 * t);
    const level = floorY + 0.3 * n3.fbm(x * 0.02 + 5, z * 0.02, 3) * smoothstep(36, 44, d);
    heights[i] = lerp(heights[i], level + (heights[i] - level) * 0.12 * t, w);
  });
  const soft = (a: number, b: number, k: number) => { const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); };
  span(X, (x, z, i) => {
    const d = Math.hypot(x - bx, z - bz);
    if (d <= B.floor || d >= X) return;
    const cone = floorY + (d - B.floor) * B.side * (0.88 + 0.24 * (0.5 + 0.5 * n1.noise(x * 0.019 + 3, z * 0.019 - 7))) + 1.6 * n3.fbm(x * 0.05, z * 0.05 + 9, 3);
    if (heights[i] <= cone - 4) return;
    const y = Math.min(heights[i], soft(heights[i], cone, 4));
    heights[i] = lerp(y, heights[i], smoothstep(X - 28, X, d));
  });
  for (let pass = 0; pass < 60; pass++)
    span(X, (x, z, i) => {
      const d = Math.hypot(x - bx, z - bz);
      if (d <= B.floor + 4 || d >= X - 2) return;
      const h = heights[i], lo = Math.min(heights[i - 1], heights[i + 1], heights[i - NX], heights[i + NX]);
      if (h - lo > 0.9 * CELL) heights[i] = lerp(h, lo + 0.9 * CELL, 0.5 * (1 - smoothstep(X - 70, X - 12, d)));
    }, 1);
  const local = (x: number, z: number): [number, number] => { const dx = x - bx, dz = z - bz; return [dx * Math.cos(rot) - dz * Math.sin(rot), dx * Math.sin(rot) + dz * Math.cos(rot)]; };
  for (const list of [tools.trees, tools.rocks, tools.props]) {
    for (let k = list.length - 1; k >= 0; k--) {
      const t = list[k];
      if (Math.hypot(t.x - bx, t.z - bz) > Math.max(R + 2, X)) continue;
      const [r, f] = local(t.x, t.z);
      if ((Math.abs(r) < 6.5 && f > 7.5 && f < 23) || slopeAt(heights, t.x, t.z) > 1.05) list.splice(k, 1);
      else t.y += heightAt(heights, t.x, t.z) - heightAt(before, t.x, t.z);
    }
  }
  // (that is the ground as it is seen: the roof lies level with it; under the roof the ground is dug out)
  span(X, (_x, _z, i) => { surface[i] = heights[i]; });
  span(R, (x, z, i) => { const [r, f] = local(x, z); if (Math.abs(r) <= B.pit.r && f >= B.pit.back && f <= B.pit.front) heights[i] = floorY - B.depth - 0.3; });
  yard.push({ x: bx, z: bz, rot });
}
