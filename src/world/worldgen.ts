// Deterministic world generation. Produces the heightfield, terrain splat weights,
// road, building plots and every vegetation / prop instance from a single seed.
// Pure data, no rendering: the server can run this exact code to agree with clients
// on collision and spawn points.

import { RNG, Simplex, hash2, clamp, lerp, smoothstep } from '../core/noise';

export const WORLD_SEED = 1337;
export const WORLD_SIZE = 1024; // metres, square, centred on the origin
export const WORLD_RES = 513; // height samples per side
export const CELL = WORLD_SIZE / (WORLD_RES - 1); // 2 m
export const PLAY_RADIUS = 400;

export type BuildingType = 'house_small' | 'house_brick' | 'barn' | 'shed' | 'cabin' | 'guardpost' | 'police';

/** footprint (x = width, z = depth) in metres, used for terrain pads + spacing */
export const BUILDING_FOOTPRINT: Record<BuildingType, [number, number]> = {
  house_small: [8, 6.5],
  house_brick: [10.5, 7.5],
  barn: [12, 8],
  shed: [4, 3.2],
  cabin: [6, 5],
  guardpost: [4.4, 4.4],
  police: [14, 9],
};

export interface BuildingPlot {
  id: string;
  type: BuildingType;
  x: number;
  z: number;
  rot: number; // radians about Y; local +Z is the front (door side)
  floorY: number;
  seed: number;
}

export interface Instance {
  kind: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  /** drawn only within this many metres (furniture indoors is invisible from across the map) */
  far?: number;
}

export interface POI {
  name: string;
  x: number;
  z: number;
  radius: number;
}

export interface World {
  heights: Float32Array;
  /** RGBA weights: grass, forest floor, rock, gravel */
  splat: Uint8Array;
  /** grass blade density 0..255 */
  grass: Uint8Array;
  road: { points: Float32Array; width: number };
  buildings: BuildingPlot[];
  trees: Instance[];
  rocks: Instance[];
  props: Instance[];
  pois: POI[];
  /** default spawn (first of the ring) */
  spawn: { x: number; z: number; yaw: number };
  /** fresh characters start at one of these, out on the edge of the map, facing inward */
  spawns: { x: number; z: number; yaw: number }[];
}

// ------------------------------------------------------------------ helpers

export function idx(ix: number, iz: number) {
  return iz * WORLD_RES + ix;
}

/** Height at a world position using the same triangulation as the physics heightfield. */
export function heightAt(heights: Float32Array, x: number, z: number): number {
  const gx = clamp((x + WORLD_SIZE / 2) / CELL, 0, WORLD_RES - 1.0001);
  const gz = clamp((z + WORLD_SIZE / 2) / CELL, 0, WORLD_RES - 1.0001);
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const h00 = heights[idx(ix, iz)];
  const h10 = heights[idx(ix + 1, iz)];
  const h01 = heights[idx(ix, iz + 1)];
  const h11 = heights[idx(ix + 1, iz + 1)];
  if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

export function slopeAt(heights: Float32Array, x: number, z: number): number {
  const e = CELL;
  const dx = heightAt(heights, x + e, z) - heightAt(heights, x - e, z);
  const dz = heightAt(heights, x, z + e) - heightAt(heights, x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

function catmullRom(pts: [number, number][], step: number): [number, number][] {
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

// ------------------------------------------------------------------ generation

export function generateWorld(seed = WORLD_SEED): World {
  const N = WORLD_RES;
  const half = WORLD_SIZE / 2;
  const n1 = new Simplex(seed);
  const n2 = new Simplex(seed + 1);
  const n3 = new Simplex(seed + 2);
  const rng = new RNG(seed + 99);

  const VILLAGE = { x: 30, z: 10 };
  const CAMP = { x: -175, z: 175 };
  const CABIN = { x: 235, z: -195 };

  const pois: POI[] = [
    { name: 'Zelenaya Dolina', x: VILLAGE.x, z: VILLAGE.z, radius: 110 },
    { name: 'Military Checkpoint', x: CAMP.x, z: CAMP.z, radius: 45 },
    { name: "Hunter's Cabin", x: CABIN.x, z: CABIN.z, radius: 30 },
  ];

  // --- base heightfield
  const base = (x: number, z: number) => {
    const r = Math.hypot(x, z) + n3.fbm(x * 0.004, z * 0.004, 3) * 40;
    let h = 16 * n1.fbm(x * 0.0024, z * 0.0024, 5);
    h += 5 * n2.fbm(x * 0.011 + 31.7, z * 0.011 - 12.1, 4);
    h += 0.9 * n3.fbm(x * 0.06, z * 0.06, 3);
    h += 30 * n2.ridged(x * 0.0019 + 5, z * 0.0019 - 3, 4) * smoothstep(180, 420, r);
    h += 85 * Math.pow(smoothstep(370, 540, r), 1.6);
    return h;
  };
  const heights = new Float32Array(N * N);
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      heights[idx(ix, iz)] = base(-half + ix * CELL, -half + iz * CELL);
    }
  }

  // --- soften settlements (village plateau, camp clearing)
  const flattenArea = (cx: number, cz: number, inner: number, outer: number, bumpy: number) => {
    const target = base(cx, cz);
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const x = -half + ix * CELL;
        const z = -half + iz * CELL;
        const d = Math.hypot(x - cx, z - cz);
        if (d > outer) continue;
        const w = 1 - smoothstep(inner, outer, d);
        const i = idx(ix, iz);
        const local = target + bumpy * n3.fbm(x * 0.02, z * 0.02, 3) + (heights[i] - target) * 0.25;
        heights[i] = lerp(heights[i], local, w);
      }
    }
  };
  flattenArea(VILLAGE.x, VILLAGE.z, 70, 130, 1.4);
  flattenArea(CAMP.x, CAMP.z, 30, 70, 0.4);
  flattenArea(CABIN.x, CABIN.z, 10, 30, 0.5);

  // --- road: spline through the village, height profile smoothed along its length
  const ctrl: [number, number][] = [
    [-540, -150], [-380, -110], [-250, -70], [-130, -25], [-40, 4], [VILLAGE.x, 12],
    [110, 30], [190, 70], [300, 140], [420, 190], [540, 230],
  ];
  const path2 = catmullRom(ctrl, 4);
  const sampled = path2.map(([x, z]) => heightAt(heights, x, z));
  const smooth = sampled.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = -12; k <= 12; k++) {
      const j = clamp(i + k, 0, sampled.length - 1);
      const w = 1 - Math.abs(k) / 13;
      s += sampled[j] * w;
      c += w;
    }
    return s / c;
  });
  const roadPts = new Float32Array(path2.length * 3);
  path2.forEach(([x, z], i) => roadPts.set([x, smooth[i], z], i * 3));
  const ROAD_W = 6.5;

  // camp access track (dirt only, no asphalt)
  const trackPath = catmullRom([[-60, 2], [-90, 50], [-130, 110], [CAMP.x + 20, CAMP.z - 25]], 4);
  const cabinTrack = catmullRom([[150, 48], [190, -40], [215, -130], [CABIN.x - 6, CABIN.z + 12]], 4);

  // rasterise distance-to-polyline (and target height) into the grid
  const roadDist = new Float32Array(N * N).fill(1e9);
  const roadH = new Float32Array(N * N);
  const trackDist = new Float32Array(N * N).fill(1e9);
  const trackH = new Float32Array(N * N);
  const rasterLine = (pts: [number, number][], ys: number[] | null, influence: number, dist: Float32Array, hOut: Float32Array) => {
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s];
      const [bx, bz] = pts[s + 1];
      const minX = Math.min(ax, bx) - influence, maxX = Math.max(ax, bx) + influence;
      const minZ = Math.min(az, bz) - influence, maxZ = Math.max(az, bz) + influence;
      const ix0 = Math.max(0, Math.floor((minX + half) / CELL)), ix1 = Math.min(N - 1, Math.ceil((maxX + half) / CELL));
      const iz0 = Math.max(0, Math.floor((minZ + half) / CELL)), iz1 = Math.min(N - 1, Math.ceil((maxZ + half) / CELL));
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz || 1;
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = -half + ix * CELL, z = -half + iz * CELL;
          const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
          const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
          const i = idx(ix, iz);
          if (d < dist[i]) {
            dist[i] = d;
            hOut[i] = ys ? lerp(ys[s], ys[s + 1], t) : 0;
          }
        }
      }
    }
  };
  rasterLine(path2, smooth, 16, roadDist, roadH);
  const trackYs = (p: [number, number][]) => p.map(([x, z]) => heightAt(heights, x, z));
  rasterLine(trackPath, trackYs(trackPath), 8, trackDist, trackH);
  rasterLine(cabinTrack, trackYs(cabinTrack), 8, trackDist, trackH);

  for (let i = 0; i < N * N; i++) {
    if (roadDist[i] < 16) {
      const w = 1 - smoothstep(ROAD_W * 0.5 + 0.5, 16, roadDist[i]);
      // road bed sits slightly below the asphalt ribbon so the ribbon never z-fights
      heights[i] = lerp(heights[i], roadH[i] - 0.08, w);
    }
    if (trackDist[i] < 8) {
      const w = (1 - smoothstep(1.5, 8, trackDist[i])) * 0.7;
      heights[i] = lerp(heights[i], trackH[i], w);
    }
  }

  // --- building plots
  const buildings: BuildingPlot[] = [];
  const blocked: { x: number; z: number; r: number }[] = [];
  const roadNearest = (x: number, z: number) => {
    let best = 1e9, bi = 0;
    for (let i = 0; i < path2.length; i++) {
      const d = Math.hypot(path2[i][0] - x, path2[i][1] - z);
      if (d < best) { best = d; bi = i; }
    }
    return { d: best, i: bi };
  };
  const addBuilding = (type: BuildingType, x: number, z: number, rot: number) => {
    const [w, d] = BUILDING_FOOTPRINT[type];
    const r = Math.hypot(w, d) / 2;
    for (const b of blocked) if (Math.hypot(b.x - x, b.z - z) < b.r + r + 2.5) return false;
    if (roadNearest(x, z).d < r + ROAD_W / 2 + 2) return false;
    blocked.push({ x, z, r });
    buildings.push({ id: `${type}_${buildings.length}`, type, x, z, rot, floorY: 0, seed: Math.floor(rng.next() * 1e9) });
    return true;
  };

  // police station: dead centre of the village, on the main road. The best loot on the map.
  {
    let ci = 0, cd = 1e9;
    path2.forEach(([x, z], i) => {
      const d = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
      if (d < cd) { cd = d; ci = i; }
    });
    const [x, z] = path2[ci];
    const [nx, nz] = path2[ci + 1];
    const tl = Math.hypot(nx - x, nz - z);
    const px = -(nz - z) / tl, pz = (nx - x) / tl;
    const off = 9 + BUILDING_FOOTPRINT.police[1] / 2 + ROAD_W / 2;
    addBuilding('police', x + px * off, z + pz * off, Math.atan2(-px, -pz));
  }

  // village: houses facing the road on both sides
  const villageTypes: BuildingType[] = ['house_small', 'house_brick', 'house_small', 'house_brick', 'shed', 'house_small', 'barn'];
  let vi = 0;
  for (let i = 0; i < path2.length - 1; i += 1) {
    const [x, z] = path2[i];
    if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) > 105) continue;
    if (i % 5 !== 0) continue;
    const [nx, nz] = path2[i + 1];
    const tx = nx - x, tz = nz - z;
    const tl = Math.hypot(tx, tz);
    const px = -tz / tl, pz = tx / tl; // left normal
    for (const side of [1, -1]) {
      if (!rng.chance(0.62)) continue;
      const type = villageTypes[vi++ % villageTypes.length];
      const [, depth] = BUILDING_FOOTPRINT[type];
      const off = (type === 'barn' ? 22 : type === 'shed' ? 18 : 14) + depth / 2 + rng.range(0, 3);
      const bx = x + px * off * side + tx / tl * rng.range(-3, 3);
      const bz = z + pz * off * side + tz / tl * rng.range(-3, 3);
      // face the road: local +Z points back toward the road
      const rot = Math.atan2(-px * side, -pz * side);
      addBuilding(type, bx, bz, rot + rng.range(-0.06, 0.06));
    }
  }
  // a second row of sheds/barns behind the houses
  for (let k = 0; k < 10; k++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(45, 85);
    addBuilding(rng.chance(0.5) ? 'shed' : 'barn', VILLAGE.x + Math.cos(a) * rr, VILLAGE.z + Math.sin(a) * rr, rng.range(0, Math.PI * 2));
  }
  // military checkpoint
  addBuilding('guardpost', CAMP.x + 8, CAMP.z - 10, Math.PI * 0.75);
  addBuilding('guardpost', CAMP.x - 12, CAMP.z + 10, Math.PI * 1.75);
  addBuilding('barn', CAMP.x - 6, CAMP.z - 14, Math.PI * 0.25);
  // hunter's cabin
  addBuilding('cabin', CABIN.x, CABIN.z, Math.PI * 0.6);
  addBuilding('shed', CABIN.x + 9, CABIN.z - 5, Math.PI * 0.6);

  // flatten pads under each building and record floor heights
  for (const b of buildings) {
    const [w, d] = BUILDING_FOOTPRINT[b.type];
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    let maxH = -1e9, sumH = 0, cnt = 0;
    for (let lz = -d / 2; lz <= d / 2; lz += 1) {
      for (let lx = -w / 2; lx <= w / 2; lx += 1) {
        const wx = b.x + lx * c + lz * s;
        const wz = b.z - lx * s + lz * c;
        const h = heightAt(heights, wx, wz);
        maxH = Math.max(maxH, h);
        sumH += h;
        cnt++;
      }
    }
    const avg = sumH / cnt;
    b.floorY = Math.max(avg + 0.35, maxH + 0.12);
    const padY = b.floorY - 0.25;
    const margin = 5;
    const R = Math.hypot(w, d) / 2 + margin + 2;
    const ix0 = Math.max(0, Math.floor((b.x - R + half) / CELL)), ix1 = Math.min(N - 1, Math.ceil((b.x + R + half) / CELL));
    const iz0 = Math.max(0, Math.floor((b.z - R + half) / CELL)), iz1 = Math.min(N - 1, Math.ceil((b.z + R + half) / CELL));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = -half + ix * CELL - b.x, z = -half + iz * CELL - b.z;
        const lx = x * c - z * s;
        const lz = x * s + z * c;
        const ex = Math.max(0, Math.abs(lx) - w / 2), ez = Math.max(0, Math.abs(lz) - d / 2);
        const e = Math.hypot(ex, ez);
        const wgt = 1 - smoothstep(0.3, margin, e);
        const i = idx(ix, iz);
        // only pull terrain down inside the footprint, blend outside
        const target = e <= 0.3 ? Math.min(heights[i], padY) : padY;
        heights[i] = lerp(heights[i], target, wgt);
      }
    }
  }

  // --- masks
  const forestMask = (x: number, z: number) => {
    let f = n2.fbm(x * 0.0055 + 70, z * 0.0055 - 40, 4) * 0.9 + 0.12 * n3.noise(x * 0.04, z * 0.04);
    const r = Math.hypot(x, z);
    f += 0.35 * smoothstep(260, 420, r); // dense forest on the outer hills hides the map edge
    f -= 0.9 * (1 - smoothstep(85, 140, Math.hypot(x - VILLAGE.x, z - VILLAGE.z)));
    f -= 0.8 * (1 - smoothstep(35, 60, Math.hypot(x - CAMP.x, z - CAMP.z)));
    f -= 0.8 * (1 - smoothstep(10, 22, Math.hypot(x - CABIN.x, z - CABIN.z)));
    return f;
  };
  const insideBuilding = (x: number, z: number, pad: number) => {
    for (const b of buildings) {
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      const dx = x - b.x, dz = z - b.z;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      if (Math.abs(lx) < w / 2 + pad && Math.abs(lz) < d / 2 + pad) return true;
    }
    return false;
  };

  // --- splat + grass
  const splat = new Uint8Array(N * N * 4);
  const grass = new Uint8Array(N * N);
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const x = -half + ix * CELL, z = -half + iz * CELL;
      const i = idx(ix, iz);
      const slope = slopeAt(heights, x, z);
      const f = forestMask(x, z);
      let rock = smoothstep(0.5, 0.85, slope + 0.1 * n3.noise(x * 0.05, z * 0.05));
      let forest = smoothstep(-0.05, 0.25, f);
      let gravel = Math.max(
        1 - smoothstep(ROAD_W / 2 + 0.2, ROAD_W / 2 + 2.4 + 1.2 * n3.noise(x * 0.2, z * 0.2), roadDist[i]),
        (1 - smoothstep(1.2, 2.6 + n3.noise(x * 0.3, z * 0.3), trackDist[i])) * 0.95,
      );
      if (insideBuilding(x, z, 1.5 + n3.noise(x * 0.3, z * 0.3))) gravel = Math.max(gravel, 0.9);
      const campD = Math.hypot(x - CAMP.x, z - CAMP.z);
      gravel = Math.max(gravel, (1 - smoothstep(18, 32, campD)) * 0.75);
      // patchy dirt in meadows
      gravel = Math.max(gravel, smoothstep(0.55, 0.75, n2.noise(x * 0.03, z * 0.03)) * 0.5 * (1 - forest));
      rock = clamp(rock, 0, 1);
      forest *= 1 - rock;
      gravel *= 1 - rock;
      let grassW = Math.max(0, 1 - rock - forest - gravel);
      const sum = grassW + forest + rock + gravel || 1;
      splat[i * 4] = Math.round((grassW / sum) * 255);
      splat[i * 4 + 1] = Math.round((forest / sum) * 255);
      splat[i * 4 + 2] = Math.round((rock / sum) * 255);
      splat[i * 4 + 3] = Math.round((gravel / sum) * 255);

      let g = grassW / sum + 0.45 * (forest / sum);
      g *= 1 - smoothstep(0.2, 0.5, gravel);
      if (roadDist[i] < ROAD_W / 2 + 0.6) g = 0;
      if (insideBuilding(x, z, 0.4)) g = 0;
      g *= 0.75 + 0.25 * n1.noise(x * 0.08, z * 0.08);
      grass[i] = Math.round(clamp(g, 0, 1) * 255);
    }
  }

  // --- vegetation
  const trees: Instance[] = [];
  const rocks: Instance[] = [];
  const props: Instance[] = [];
  const TREE_STEP = 6.2;
  const pines = ['pine_a', 'pine_b', 'pine_c', 'pine_d'];
  for (let gz = -half + 4; gz < half - 4; gz += TREE_STEP) {
    for (let gx = -half + 4; gx < half - 4; gx += TREE_STEP) {
      const hx = hash2(Math.round(gx * 10), Math.round(gz * 10), seed);
      const hz = hash2(Math.round(gz * 10), Math.round(gx * 10), seed + 7);
      const x = gx + (hx - 0.5) * TREE_STEP * 0.9;
      const z = gz + (hz - 0.5) * TREE_STEP * 0.9;
      const f = forestMask(x, z);
      const hv = hash2(Math.round(x * 7), Math.round(z * 7), seed + 3);
      const i = idx(Math.round((x + half) / CELL), Math.round((z + half) / CELL));
      if (roadDist[i] < ROAD_W / 2 + 4 || trackDist[i] < 3) continue;
      if (insideBuilding(x, z, 4)) continue;
      const y = heightAt(heights, x, z);
      if (f > 0.08) {
        // forest interior is pine, edges are birch + bushes
        const edge = f < 0.2;
        const density = smoothstep(0.08, 0.3, f);
        if (hv > density * 0.92) continue;
        let kind: string;
        if (edge && hv < 0.45) kind = hv < 0.18 ? 'bush_a' : hv < 0.3 ? 'bush_b' : 'birch_a';
        else if (hv < 0.12) kind = 'birch_b';
        else kind = pines[Math.floor(hash2(Math.round(x), Math.round(z), 5) * pines.length)];
        trees.push({ kind, x, y, z, rot: hx * Math.PI * 2, scale: 0.85 + hz * 0.35 });
      } else if (f > -0.25 && hv < 0.025) {
        // lone trees in meadows / village gardens
        const kind = hv < 0.01 ? 'oak_a' : hv < 0.018 ? 'ash_a' : 'birch_a';
        trees.push({ kind, x, y, z, rot: hx * Math.PI * 2, scale: 0.9 + hz * 0.3 });
      } else if (f > -0.15 && hv > 0.97) {
        trees.push({ kind: hv > 0.985 ? 'bush_a' : 'bush_b', x, y, z, rot: hx * Math.PI * 2, scale: 0.8 + hz * 0.5 });
      }
    }
  }

  // forest debris, rocks, ferns
  const rockKinds = ['rock_moss_set_01', 'rock_moss_set_02'];
  for (let k = 0; k < 2600; k++) {
    const x = rng.range(-half + 20, half - 20);
    const z = rng.range(-half + 20, half - 20);
    const f = forestMask(x, z);
    const i = idx(Math.round((x + half) / CELL), Math.round((z + half) / CELL));
    if (roadDist[i] < ROAD_W / 2 + 2 || trackDist[i] < 2 || insideBuilding(x, z, 2)) continue;
    const y = heightAt(heights, x, z);
    const slope = slopeAt(heights, x, z);
    const roll = rng.next();
    if (f > 0.1) {
      if (roll < 0.45) props.push({ kind: 'fern_02', x, y, z, rot: rng.range(0, 6.28), scale: rng.range(0.8, 1.3) });
      else if (roll < 0.6) rocks.push({ kind: `${rng.pick(rockKinds)}#${rng.int(0, 5)}`, x, y: y - 0.15, z, rot: rng.range(0, 6.28), scale: rng.range(0.6, 1.4) });
      else if (roll < 0.68) props.push({ kind: 'dry_branches_medium_01', x, y, z, rot: rng.range(0, 6.28), scale: rng.range(0.8, 1.2) });
      else if (roll < 0.74) props.push({ kind: 'tree_stump_01', x, y: y - 0.05, z, rot: rng.range(0, 6.28), scale: rng.range(0.8, 1.2) });
      else if (roll < 0.79) props.push({ kind: 'dead_tree_trunk', x, y: y - 0.05, z, rot: rng.range(0, 6.28), scale: rng.range(0.9, 1.3) });
    } else if (slope > 0.35 && roll < 0.5) {
      rocks.push({ kind: roll < 0.1 ? 'boulder_01' : `${rng.pick(rockKinds)}#${rng.int(0, 5)}`, x, y: y - 0.25, z, rot: rng.range(0, 6.28), scale: rng.range(1, 2.2) });
    } else if (roll < 0.04 && f > -0.2) {
      rocks.push({ kind: `${rng.pick(rockKinds)}#${rng.int(0, 5)}`, x, y: y - 0.1, z, rot: rng.range(0, 6.28), scale: rng.range(0.4, 0.9) });
    }
  }

  // spawn ring: out in the forest on the edge of the map, looking toward the village.
  // Everything worth having is a walk inward from here.
  const spawns: { x: number; z: number; yaw: number }[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2 + 0.13;
    for (const r of [400, 385, 415, 370, 430]) {
      const x = VILLAGE.x * 0.5 + Math.cos(a) * r, z = VILLAGE.z * 0.5 + Math.sin(a) * r;
      if (Math.abs(x) > half - 60 || Math.abs(z) > half - 60) continue;
      // reasonably level ground
      const h0 = heightAt(heights, x, z);
      const steep = Math.max(Math.abs(heightAt(heights, x + 3, z) - h0), Math.abs(heightAt(heights, x, z + 3) - h0), Math.abs(heightAt(heights, x - 3, z) - h0), Math.abs(heightAt(heights, x, z - 3) - h0));
      if (steep > 1.2) continue;
      spawns.push({ x, z, yaw: Math.atan2(-(VILLAGE.x - x), -(VILLAGE.z - z)) });
      break;
    }
  }
  const spawn = spawns[0];

  return {
    heights,
    splat,
    grass,
    road: { points: roadPts, width: ROAD_W },
    buildings,
    trees,
    rocks,
    props,
    pois,
    spawn,
    spawns,
  };
}
