// THE WEST (2026-10-16): the square laid into the world's rectangle, and the ground of the two squares west of it.
// The owner: "from west to east itll be ocean, beach, desert, plains, mountains. We have the plains and mountains."
// The plan is plan v5 with the desert twice as big (west-plan.ts): a thin sea and its beach, a desert of dunes with a
// river's green line through it and the ruined town of Kalat, the ridge and its one pass, and the green land with the
// green river valley, the towns, the forest lake and the swamp. This file lays the ground in its order; its parts
// are west-relief.ts (desert, valley, ridge, pass), west-water.ts (river, lake, swamp) and west-towns.ts (the towns
// and Kalat); what is done to the square for it is opening.ts.
//
// Nothing of the square is touched here: its samples are copied as they are, and what is new has noise of its own.
// At the seam it is the square's own ground carried on (the same valley noise, and its rim where it is kept), and the
// square's last column met exactly, so there is no step and no crease.

import { Simplex, clamp, hash2, lerp, smoothstep } from '../../core/noise';
import { BUNKER } from '../../sim/bunker';
import { MOKROYE } from '../../sim/mokroye';
import { OZERKI } from '../../sim/ozerki';
import { ruinProps, ruinsPlan, type Place } from '../../sim/ruins';
import type { PlacedTown, SlabRun } from '../../sim/towns';
import type { Waters } from '../../sim/water';
import { ZAVOD } from '../../sim/zavod';
import { BUILDING_FOOTPRINT, SNOW, type BuildingPlot } from './layout';
import { CELL, SEA_LEVEL, SQUARE_HALF, SQUARE_RES, WORLD_NX, WORLD_NZ, WORLD_SEED, WORLD_X0, WORLD_Z0, WORLD_Z1 } from './places';
import { catmullRom, heightAt, slopeAt } from './ground';
import { PLACED, PLAN, bed, inBox, inside, movedPost, onLine, openness, outside } from './west-plan';
import { passFloor, passLine, ridgeAt, shapeRelief, valleyLine } from './west-relief';
import { carveRiver, cutLake, cutSwamp, lakeLevel, riverMask, riverWater } from './west-water';
import { fillTown, kalatSite, layKalat, layPad, offPad, padLevel, placed, placedTown, swampPad, townLocal } from './west-towns';
import { moundAt } from '../../sim/towns';
import type { Instance, POI, Site } from './types';

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
  /** the shore's line (x) and how far it wanders either way, slow and quick: the sea is the westmost 125 m or so */
  shore: -3715,
  wander: [18, 6] as const,
  /** the beach: its rise to the metre, how far it runs inland before the land rises off it, and how far it goes out under the water before the floor drops away */
  beach: 0.035,
  sand: 70,
  shelf: 40,
  /** how much deeper the floor goes past the shelf, and over how far (the sea is narrow: it is deep by the world's edge) */
  deep: 10,
  deepRun: 80,
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
/** the west's own, beside the fields: the towns, Kalat, the slab walls and the water */
export interface WestFields extends SquareFields {
  towns: PlacedTown[];
  kalat: Place;
  slabs: SlabRun[];
  water: Waters;
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
  /** the places (the bunker's is already where it is now: see opening.ts) and the named places of the maps (the new ones are added) */
  sites: Site[];
  pois: POI[];
  /** the trading post's own buildings, moved to its new place by opening.ts and set on its yard here */
  post: BuildingPlot[];
  /** every building: the towns' are added after all of them */
  buildings: BuildingPlot[];
  /** the roads there are: the new ones are added */
  roads: { points: Float32Array; width: number; side?: boolean }[];
  /** the square's three noises: its valley's shape and its paint's patches run on across the seam */
  noise: [Simplex, Simplex, Simplex];
}

/**
 * The square's fields laid into the world's, and the west made. The square's own arrays are left as they were; new
 * ones are given back. `surface` stays the same array as `heights` when it was.
 */
export function toWorld(sq: SquareFields, tools: WestTools): WestFields {
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
  const W = WEST, [n1, n2, n3] = tools.noise, p3 = new Simplex(tools.seed + 303);
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
      // (the desert takes over from the beach's edge to the ridge: west-relief.ts; out there the green land is not reckoned)
      const h = on <= 0 || x < ridgeAt(z)[0] - 60 ? shoreline(c, x, z) : on >= 1 ? land(x, z) : shoreline(c, x, z) * (1 - on) + land(x, z) * on;
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

  // THE DESERT, THE GREEN RIVER VALLEY, THE RIDGE AND THE PASS (west-relief.ts)
  const walls = shapeRelief(heights, net, W.seam, shores, W.sand, (c) => SEA_LEVEL + W.beach * c);

  // THE TOWNS' LEVELS, and the water beside two of them: each pad at the ground's middle height under it, but the
  // brick works on a bench a little over the river's floor; Ozerki's bank a little over its lake; the swamp's hamlet
  // under the swamp's water. Then each pad levelled (west-towns.ts).
  const padY = new Map(PLACED.map((t) => [t.name, padLevel(heights, net, t)]));
  const zavod = placedTown(ZAVOD.name), [bx, bz] = [zavod.x - Math.sin(zavod.rot) * 57, zavod.z + Math.cos(zavod.rot) * 57];
  padY.set(ZAVOD.name, heightAt(heights, bx, bz) + PLAN.valley.bench);
  const lake = lakeLevel(heights, net, PLAN.lake.outline);
  padY.set(OZERKI.name, lake + PLAN.lake.under);
  cutLake(heights, net, PLAN.lake.outline, lake, PLAN.lake.deep);
  const hamlet = placedTown(MOKROYE.name), swamp = cutSwamp(heights, net, (x, z) => offPad(hamlet, x, z) < 4);
  padY.set(MOKROYE.name, swampPad(swamp));
  for (const t of PLACED) layPad(heights, net, t, padY.get(t.name)!, t.name === OZERKI.name ? lake : undefined);

  // KALAT, on its own land in the desert
  const kalat = kalatSite(heights, net), kalatLand = layKalat(heights, net, kalat);

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

  // THE RIVER: its bed cut, and its water's line (west-water.ts)
  const river = riverWater(heights, net, (z) => shoreLine(z, tools.seed)), wetMask = riverMask(river, net);
  carveRiver(heights, net, river);
  const inWater = (x: number, z: number) => wetMask[clamp(Math.round((z - WORLD_Z0) / CELL), 0, NZ - 1) * NX + clamp(Math.round((x - WORLD_X0) / CELL), 0, NX - 1)] === 1;

  // (the ground as it is seen is the ground itself, out here, but under the bunker's roof)
  seen();

  // THE BUNKER on the valley's south rim (its place, BUNKER_AT, is the site opening.ts moved): at the foot of a knoll,
  // cut into it as it was into the old hillside (src/world/worldgen/generate.ts, the second expansion, by the same rule).
  const bunker = tools.sites.find((s) => s.kind === 'bunker');
  const yard: { x: number; z: number; rot: number }[] = [];
  // (its knoll is not let into the valley beside it)
  if (bunker) cutBunker(heights, surface, bunker, tools, yard, (x, z) => smoothstep(70, 140, valleyLine.near(x, z).d));

  // THE ROADS (PLAN.road): the main one from the loop's west bend through the trader and Pokrov, through the pass and
  // out across the desert to the beach, and its branches. Each lies on the ground evened out along it over fifty
  // metres, nowhere steeper than PLAN.road.steep, a branch from the main road's own height where it leaves it; and its
  // bed is laid into the ground.
  const loop = tools.roads.reduce((a, b) => (b.points.length > a.points.length ? b : a));
  const nearest = (p: Float32Array, x: number, z: number) => {
    let k = 0, d = Infinity;
    for (let j = 0; j < p.length; j += 3) { const e = Math.hypot(p[j] - x, p[j + 2] - z); if (e < d) { d = e; k = j; } }
    return k;
  };
  // (a road through a town lies exactly at its pad's own level; where it crosses the river, on the ford's bed)
  const onPad = (x: number, z: number) => PLACED.find((t) => { const [lx, lz] = townLocal(t, x, z); return Math.abs(lx) < t.pad[0] - 10 && Math.abs(lz) < t.pad[1] - 10; });
  const lay = (pts: [number, number][], from: { points: Float32Array; width: number } | null, width: number, side: boolean) => {
    const line = catmullRom(pts, 4), raw = line.map(([x, z]) => heightAt(heights, x, z)), nL = line.length;
    const ys = raw.map((_, k) => { let s = 0, c = 0; for (let j = -12; j <= 12; j++) { const q = 1 - Math.abs(j) / 13; s += raw[clamp(k + j, 0, nL - 1)] * q; c += q; } return s / c; });
    // (and a road leaves the one it leaves level with it: across that one's own bed and a little more, it is that
    // one's height, as its bed will be, laid after it)
    const held = line.map(([x, z], k) => {
      // (in the pass, on its floor)
      const p = passLine.near(x, z);
      if (p.d < PLAN.pass.floor - 2 && p.along > 2 && p.along < passLine.total - 2) { ys[k] = passFloor(p.along) + 0.05; return true; }
      const t = onPad(x, z);
      if (t) { const [lx, lz] = townLocal(t, x, z); ys[k] = padY.get(t.name)! + moundAt(t, lx, lz); }
      if (inWater(x, z)) { ys[k] = raw[k] + 0.04; return true; }
      if (!from) return !!t;
      const [d, y] = onLine(from.points, x, z), flat = k === 0 || d <= from.width / 2 + 6;
      if (flat) ys[k] = y;
      return !!t || flat;
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
  // (through the pass, so far south of its middle line as PLAN.pass.road says: the river is on the north side)
  const through: [number, number][] = [];
  for (let a = 0; a <= passLine.total; a += 32) { const p = passLine.at(a); through.push([p.x + p.tz * PLAN.pass.road, p.z - p.tx * PLAN.pass.road]); }
  const R = PLAN.road, start = nearest(loop.points, R.east[0][0], R.east[0][1]);
  const main = lay([[loop.points[start], loop.points[start + 2]], ...R.east.slice(1), ...through, ...R.west], loop, R.width, false);
  const branch = (pts: [number, number][]) => {
    const k = nearest(main.points, pts[0][0], pts[0][1]);
    return lay([[main.points[k], main.points[k + 2]], ...pts.slice(1)], main, R.branch, true);
  };
  const ways = [main, lay(R.bunker, null, R.branch, true), branch(R.lipki), branch(R.ozerki), branch(R.zavod), branch(R.kalat)];
  const preBed = heights.slice(), gap = new Float32Array(n).fill(1e9);
  // (the branches' beds first, and the main road's over them where they meet)
  for (const r of [...ways.slice(1), main]) bed(heights, r.points, r.width, R.bed, () => 1, net, { fill: 0.35, cut: 0.6, gap });
  // (and the loop's own over the main road's where it leaves it: the loop as the square laid it, about the junction only)
  {
    const jx = main.points[0], jz = main.points[2], lp = loop.points;
    let k0 = Infinity, k1 = -1;
    for (let k = 0; k < lp.length / 3; k++) if (Math.hypot(lp[k * 3] - jx, lp[k * 3 + 2] - jz) < 120) { k0 = Math.min(k0, k); k1 = k; }
    if (k1 > k0) bed(heights, lp.subarray(k0 * 3, k1 * 3 + 3), loop.width, R.bed, (x, z) => 1 - smoothstep(50, 90, Math.hypot(x - jx, z - jz)), net);
  }
  // (and the river's bed over the roads', where they ford it)
  carveRiver(heights, net, river);
  // (the ground as it is seen moved as the ground was by the beds: in the square's opened west too)
  if (own) for (let i = 0; i < n; i++) if (heights[i] !== preBed[i]) surface[i] += heights[i] - preBed[i];

  // THE TRADING POST'S BUILDINGS on their yard, by the rule they were first set by (generate.ts: `seat`, then `pad`):
  // each floor a little over the ground it covers, the ground under it and a pace round it brought to just below it,
  // and each building's own the last word a pace round it
  for (const b of tools.post) seatOn(heights, own ? surface : null, b);
  for (const b of tools.post) padOn(heights, own ? surface : null, b, 3.2, 2.2);

  // ---- WHAT STANDS IN THE WAY: of the square's own trees, rocks and props, those on a new road, a town's pad,
  // Kalat's land or under water go (and anything on ground moved under it is set on it again)
  const L = PLAN.lake.outline, S = PLAN.swamp.outline, LB = bounds(L), SB = bounds(S);
  const clear = (x: number, z: number, pad: number) =>
    gap[clamp(Math.round((z - WORLD_Z0) / CELL), 0, NZ - 1) * NX + clamp(Math.round((x - WORLD_X0) / CELL), 0, NX - 1)] < pad ||
    PLACED.some((t) => offPad(t, x, z) < 8 + pad) || kalatLand[clamp(Math.round((z - WORLD_Z0) / CELL), 0, NZ - 1) * NX + clamp(Math.round((x - WORLD_X0) / CELL), 0, NX - 1)] > 76 ||
    (inBounds(LB, x, z, 4) && outside(L, x, z) < 4) || (inBounds(SB, x, z, 0) && inside(S, x, z)) || inWater(x, z) || Math.hypot(x - post.x, z - post.z) < 40 + pad ||
    // (of the bunker, as its first place had it: what grows there stays but on its roof, in its hut and in its way out)
    yard.some((y) => {
      const dx = x - y.x, dz = z - y.z, r = dx * Math.cos(y.rot) - dz * Math.sin(y.rot), f = dx * Math.sin(y.rot) + dz * Math.cos(y.rot), P = BUNKER.pad;
      return (Math.abs(r) < P.r + 1 && f > P.back - 1 && f < P.front + 1) || (Math.abs(r) < 6.5 + pad && f > 7.5 && f < 23 + 40);
    });
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
  // meadows' bald patches), by its own noises so that its patches run on over the seam; the pine forest's, the birch
  // woods' and the valley's slopes' floors; the swamp's mud; west of the ridge's crest the desert's bare sand, but for
  // the river's green line through it; bare on the beach and under the sea; the roads' verges bare.
  const rimWood = (x: number, z: number) => (W.seam - x > W.woods[1] ? -1 : tools.forestMask(x, z) - 2 * smoothstep(W.woods[0], W.woods[1], W.seam - x));
  const banks = riverBanks(river, net);
  for (let iz = 0; iz < NZ; iz++) {
    const crest = ridgeAt(zOf(iz))[1];
    for (let ix = 0; ix < OX; ix++) {
      const x = xOf(ix), z = zOf(iz), i = iz * NX + ix, h = heights[i], c = x - shores[iz];
      // (the slope as `slopeAt` has it, read off the net's own samples: they are the heights it would read)
      const r = Math.min(ix + 1, NX - 1), l = Math.max(ix - 1, 0), u = Math.max(iz - 1, 0), dn = Math.min(iz + 1, NZ - 1);
      const slope = Math.hypot(heights[iz * NX + r] - heights[iz * NX + l], heights[dn * NX + ix] - heights[u * NX + ix]) / (2 * CELL);
      // (each noise asked only where it can tell)
      let rock = slope < 0.39 ? 0 : clamp(smoothstep(0.5, 0.85, slope + 0.1 * n3.noise(x * 0.05, z * 0.05)), 0, 1);
      const desert = 1 - smoothstep(crest - 20, crest + 20, x), bank = banks[i] / 255;
      let forest = desert >= 1 ? 0 : Math.max(smoothstep(-0.05, 0.25, rimWood(x, z)), pineWood(x, z), birchWood(x, z), walls[i] / 255 * 0.85);
      const marsh = inBounds(SB, x, z, 0) && inside(S, x, z) ? 1 : 0;
      forest = Math.max(forest, marsh * 0.55);
      const sand = c < W.sand - 25 ? 1 : c > W.sand + 27 ? 0 : 1 - smoothstep(W.sand - 25, W.sand + 15, c + 12 * p3.noise(x * 0.03, z * 0.03));
      // (the desert's sand, but for the river's banks: grass a few metres out from the water, and the floor of its trees)
      const dry = desert * (1 - bank);
      let bare = sand >= 1 || dry >= 1 ? 1 : Math.max(sand, dry, smoothstep(0.55, 0.75, n2.noise(x * 0.03, z * 0.03)) * 0.5 * (1 - forest) * (1 - dry));
      if (sand >= 1) rock = 0;
      forest *= (1 - rock) * (1 - dry);
      bare *= 1 - rock;
      const grassW = Math.max(0, 1 - rock - forest - bare), sum = grassW + forest + rock + bare || 1;
      splat[i * 4] = Math.round((grassW / sum) * 255);
      splat[i * 4 + 1] = Math.round((forest / sum) * 255);
      splat[i * 4 + 2] = Math.round((rock / sum) * 255);
      splat[i * 4 + 3] = Math.round((bare / sum) * 255);
      let g = grassW / sum + 0.45 * (forest / sum) + marsh * 0.5;
      g *= 1 - smoothstep(0.2, 0.5, bare);
      if (g > 0) g *= 0.75 + 0.25 * n1.noise(x * 0.08, z * 0.08);
      g *= 1 - smoothstep(SNOW.from - 10, SNOW.from + 8, h);
      grass[i] = Math.round(clamp(g, 0, 1) * 255);
    }
  }
  // (the roads' verges, in the square's opened west too: the gravel of a road's edge, and no grass on it)
  for (const r of ways) verges(splat, grass, r.points, r.width, net, p3);
  // (the bunker's own floor, as the bunker's stage leaves it: no grass in its hut or its yard)
  for (const y of yard) clearYard(grass, y);
  // (Kalat's land bare, as the desert is)
  for (let i = 0; i < n; i++) if (kalatLand[i] > 76) grass[i] = 0;

  // ---- THE TOWNS: their buildings, things and slab walls, and their yards and lanes painted (west-towns.ts)
  const towns: PlacedTown[] = [], slabs: SlabRun[] = [];
  for (const t of PLACED) {
    const y = padY.get(t.name)!;
    fillTown(t, y, net, { buildings: tools.buildings, props: tools.props, slabs, splat, grass });
    towns.push(placed(t, y));
    tools.pois.push({ name: t.name, x: t.x, z: t.z, radius: Math.round(Math.hypot(t.pad[0], t.pad[1])) });
  }
  // ---- KALAT: what lies about it, and its name on the maps
  const ground = (x: number, z: number) => heightAt(heights, x, z);
  for (const { piece, place } of ruinsPlan(kalat)) tools.props.push(...ruinProps(piece, place, ground));
  tools.pois.push({ name: PLAN.kalat.name, x: kalat.x, z: kalat.z, radius: 240 });

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
  // The pine forest, the birch woods and the valley's wooded slopes (the trees there are of the kinds the map has),
  // and a lone tree now and then in the green land between; none in the meadows. West of the ridge only the river's
  // green line, a few trees along its banks. In the swamp, drowned trunks standing in the water and bushes on its
  // islands. On a grid of its own, by hashes of its own.
  const MB = PLAN.meadows;
  for (let gz = WORLD_Z0 + 8; gz < WORLD_Z1 - 8; gz += STEP) {
    const east = ridgeAt(gz)[2] + 12;
    for (let gx = W.seam - 6; gx > W.barrier + 30; gx -= STEP) {
      const hx = hash2(Math.round(gx * 10), Math.round(gz * 10), seed + 61), hz = hash2(Math.round(gz * 10), Math.round(gx * 10), seed + 67);
      const x = gx + (hx - 0.5) * STEP * 0.9, z = gz + (hz - 0.5) * STEP * 0.9;
      const hv = hash2(Math.round(x * 7), Math.round(z * 7), seed + 63), s = hash2(Math.round(x), Math.round(z), 5), i = clamp(Math.round((z - WORLD_Z0) / CELL), 0, NZ - 1) * NX + clamp(Math.round((x - WORLD_X0) / CELL), 0, NX - 1);
      const y = heightAt(heights, x, z), rot = hx * Math.PI * 2, scale = 0.85 + hz * 0.35;
      if (inBounds(SB, x, z, 0) && inside(S, x, z)) {
        // (the swamp: none on the hamlet's ground, which is its own)
        if (offPad(hamlet, x, z) < 6) continue;
        if (y < swamp - 0.05 && hv < 0.035) tools.props.push({ kind: 'dead_tree_trunk', x, y: y - 0.1, z, rot, scale: 0.9 + hz * 0.5 });
        else if (y > swamp + 0.08 && hv < 0.12) tools.trees.push({ kind: s < 0.5 ? 'bush_a' : s < 0.8 ? 'bush_b' : 'birch_a', x, y, z, rot, scale });
        continue;
      }
      if (x < east) {
        // (west of the ridge: by the river only)
        const b = banks[i] / 255;
        if (b > 0.2 && b < 0.9 && hv < 0.05 && free(x, z)) tools.trees.push({ kind: s < 0.45 ? 'bush_a' : s < 0.7 ? 'bush_b' : s < 0.85 ? 'ash_a' : 'oak_a', x, y, z, rot, scale });
        continue;
      }
      const pw = pineWood(x, z), bw = birchWood(x, z), vw = walls[i] / 255;
      const meadow = x < MB.x0 - 70 || x > MB.x1 + 70 || z < MB.z0 - 70 || z > MB.z1 + 70 ? 0 : inBox(MB, x, z, 40, 20), lone = hv < 0.012 * (1 - meadow);
      const inPines = pw > 0.05 && hv < pw * 0.62, inBirches = !inPines && bw > 0.05 && hv < bw * 0.5, onSlope = !inPines && !inBirches && vw > 0.1 && hv < vw * 0.45;
      if (!inPines && !inBirches && !onSlope && !lone) continue;
      if (!free(x, z)) continue;
      let kind: string;
      if (inPines) kind = pw < 0.25 && s < 0.25 ? 'birch_a' : pines[Math.floor(s * pines.length)];
      else if (inBirches) kind = s < 0.42 ? 'birch_a' : s < 0.84 ? 'birch_b' : s < 0.92 ? 'bush_a' : 'bush_b';
      else if (onSlope) kind = s < 0.55 ? pines[Math.floor((s / 0.55) * pines.length)] : s < 0.8 ? 'birch_b' : 'bush_a';
      else kind = s < 0.4 ? 'oak_a' : s < 0.7 ? 'ash_a' : 'birch_a';
      tools.trees.push({ kind, x, y, z, rot, scale });
    }
  }
  return {
    heights, surface, splat, grass, towns, kalat, slabs,
    water: { lakes: [{ name: OZERKI.name, level: lake, outline: L }, { name: 'swamp', level: swamp, outline: S, swamp: true }], rivers: [{ name: 'the river', pts: river }] },
  };
}

/** the box a line round something lies in */
const bounds = (p: [number, number][]) => p.reduce((b, [x, z]) => [Math.min(b[0], x), Math.max(b[1], x), Math.min(b[2], z), Math.max(b[3], z)], [Infinity, -Infinity, Infinity, -Infinity]);
const inBounds = (b: number[], x: number, z: number, m: number) => x >= b[0] - m && x <= b[1] + m && z >= b[2] - m && z <= b[3] + m;

/** how near the river's water each sample is, as a green line through dry country: 255 at its edge, none 40 m out */
function riverBanks(river: [number, number, number, number][], net: { x0: number; z0: number; nx: number; nz: number }) {
  const out = new Uint8Array(net.nx * net.nz), reach = 40;
  for (let k = 0; k + 1 < river.length; k++) {
    const [ax, az, , aw] = river[k], [bx, bz, , bw] = river[k + 1], ex = bx - ax, ez = bz - az, len2 = ex * ex + ez * ez || 1;
    const ix0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - 6 - net.x0) / CELL)), ix1 = Math.min(net.nx - 1, Math.ceil((Math.max(ax, bx) + reach + 6 - net.x0) / CELL));
    const iz0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - 6 - net.z0) / CELL)), iz1 = Math.min(net.nz - 1, Math.ceil((Math.max(az, bz) + reach + 6 - net.z0) / CELL));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const x = net.x0 + ix * CELL, z = net.z0 + iz * CELL, t = clamp(((x - ax) * ex + (z - az) * ez) / len2, 0, 1);
      const d = Math.hypot(x - ax - ex * t, z - az - ez * t) - lerp(aw, bw, t) / 2;
      const v = Math.round(255 * (1 - smoothstep(6, reach, d)) * smoothstep(-1, 1.5, d));
      const i = iz * net.nx + ix;
      if (v > out[i]) out[i] = v;
    }
  }
  return out;
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

/** a building's floor set over the world's ground as generate.ts sets one over the square's, and its pad laid */
function seatOn(heights: Float32Array, surface: Float32Array | null, b: BuildingPlot) {
  const [w, d] = BUILDING_FOOTPRINT[b.type], c = Math.cos(b.rot), s = Math.sin(b.rot);
  let maxH = -1e9, sum = 0, cnt = 0;
  for (let lz = -d / 2; lz <= d / 2; lz += 1) for (let lx = -w / 2; lx <= w / 2; lx += 1) {
    const h = heightAt(heights, b.x + lx * c + lz * s, b.z - lx * s + lz * c);
    maxH = Math.max(maxH, h); sum += h; cnt++;
  }
  const avg = sum / cnt;
  b.floorY = Math.max(avg + 0.35, Math.min(maxH + 0.12, avg + 0.9));
  padOn(heights, surface, b, 6, 0.3);
}

/** the ground under a building and `margin` round it brought to a hand's breadth below its floor (generate.ts, `pad`) */
function padOn(heights: Float32Array, surface: Float32Array | null, b: BuildingPlot, margin: number, inner: number) {
  const [w, d] = BUILDING_FOOTPRINT[b.type], c = Math.cos(b.rot), s = Math.sin(b.rot), padY = b.floorY - 0.08;
  const R = Math.hypot(w, d) / 2 + margin + 2;
  const ix0 = Math.max(0, Math.floor((b.x - R - WORLD_X0) / CELL)), ix1 = Math.min(WORLD_NX - 1, Math.ceil((b.x + R - WORLD_X0) / CELL));
  const iz0 = Math.max(0, Math.floor((b.z - R - WORLD_Z0) / CELL)), iz1 = Math.min(WORLD_NZ - 1, Math.ceil((b.z + R - WORLD_Z0) / CELL));
  for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
    const x = WORLD_X0 + ix * CELL - b.x, z = WORLD_Z0 + iz * CELL - b.z;
    const lx = x * c - z * s, lz = x * s + z * c;
    const e = Math.hypot(Math.max(0, Math.abs(lx) - w / 2), Math.max(0, Math.abs(lz) - d / 2));
    const i = iz * WORLD_NX + ix, was = heights[i];
    heights[i] = lerp(was, padY, 1 - smoothstep(inner, margin, e));
    if (surface) surface[i] += heights[i] - was;
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
function cutBunker(heights: Float32Array, surface: Float32Array, site: Site, tools: WestTools, yard: { x: number; z: number; rot: number }[], knolled: (x: number, z: number) => number) {
  const B = BUNKER, NX = WORLD_NX, NZ = WORLD_NZ, [n1, n2, n3] = tools.noise;
  const bx = site.x, bz = site.z, rot = site.rot, ux = Math.sin(rot), uz = Math.cos(rot), R = B.floor + B.wall, X = B.reach;
  const span = (r: number, f: (x: number, z: number, i: number) => void, inset = 0) => {
    for (let iz = Math.max(inset, Math.floor((bz - r - WORLD_Z0) / CELL)); iz <= Math.min(NZ - 1 - inset, Math.ceil((bz + r - WORLD_Z0) / CELL)); iz++)
      for (let ix = Math.max(inset, Math.floor((bx - r - WORLD_X0) / CELL)); ix <= Math.min(NX - 1 - inset, Math.ceil((bx + r - WORLD_X0) / CELL)); ix++)
        f(WORLD_X0 + ix * CELL, WORLD_Z0 + iz * CELL, iz * NX + ix);
  };
  // the knoll it stands in the foot of: behind it, away from its mouth
  const kx = bx - ux * 70, kz = bz - uz * 70;
  span(170, (x, z, i) => { const d = Math.hypot(x - kx, z - kz) / 95; if (d < 1.8) heights[i] += 14 * Math.exp(-d * d * 1.6) * (0.85 + 0.3 * n1.noise(x * 0.02, z * 0.02)) * knolled(x, z); });
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
