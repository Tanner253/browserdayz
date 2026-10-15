// generateWorld: the whole map made from its seed, stage by stage (see the index below). One function, kept whole: its stages share some fifty locals.
// (One part of worldgen.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)
//
// THE STAGES, in the order they run (line numbers in this file: read only the stage you need):
//     76  base heightfield
//    115  road
//    124  outlying places
//    170  soften settlements
//    193  road
//    264  building plots
//    420  masks
//    497  splat + grass
//    548  vegetation
//    674  what was built later
//    858  the first expansion
//   1020  the second expansion
//   1131  the third expansion
//   1452  a second clinic and a second shop in the village
//   1523  the district hospital
//   1634  the village laid out as a place is
//   1884  the fourth expansion

import { Simplex, RNG, smoothstep, lerp, clamp, hash2 } from '../../core/noise';
import { BUNKER } from '../../sim/bunker';
import { type Bridge, wreckUnder } from '../../sim/bridge';
import { type FortPlace, castleFoot, CASTLE, CASTLE_SCALE, castleAt, castleLocal, castleLoose, HOUSES, castleJeep, castleCuts, squareTouches, castleOpen, castleHides } from '../../sim/castle';
import { BUNKER_AT, CELL, EDGE_ROUND, EXPANSION, KAMENKA, LOOP, MOUNTAIN, OLD_HALF, PASS, TOWN, WORLD_RES, WORLD_SEED, WORLD_SIZE, eastRoad, kamenkaQ } from './places';
import { ARMY_CAMP, BUILDING_FOOTPRINT, HOSPITAL_AT, HOSPITAL_GROUNDS, NO_START, OLD_ROAD, OUTLYING, PEAK, POLICE_PARTS, SERVICES, SNOW, TRADE_AT, VILLAGE_STREETS, doorRoad, hospitalDrive, leftOut, loopLine, offLine, peakOf, type BuildingPlot, type BuildingType, type SiteKind } from './layout';
import type { Instance, POI, Site, Solid, World, Worn } from './types';
import { catmullRom, evenOut, heightAt, idx, slopeAt, soften } from './ground';

// ------------------------------------------------------------------ generation

export function generateWorld(seed = WORLD_SEED): World {
  const run = worldStages(seed);
  for (;;) {
    const s = run.next();
    if (s.done) return s.value;
  }
}

/**
 * generateWorld a stage at a time, with `between` awaited after each: the page goes on answering while the map is
 * made (all in one, it was three and a half seconds of a page that answered nothing; the owner, 2026-10-14: "sometimes
 * makes chrome say page is unresponsive"). The same stages in the same order: the same world.
 */
export async function generateWorldSoftly(between: () => Promise<unknown>, seed = WORLD_SEED): Promise<World> {
  const run = worldStages(seed);
  for (;;) {
    const s = run.next();
    if (s.done) return s.value;
    await between();
  }
}

/** the map made from its seed, giving way between its stages (each named) */
function* worldStages(seed: number): Generator<string, World, void> {
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

  yield 'base heightfield';
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
  // The country the map was grown by is the top of the old valley's rim, and by the rule above it runs on level
  // to the edge of the ground and stops. It is to be what the old map was: a bowl. Mountains stand all along the
  // new edge, a long slope a wood can stand on, all the way round. None of it is felt inside the old square, so the
  // old ground is the old ground. (The town has a valley of its own besides: see the east country, at the end.)
  /** how much of a mountain a spot of that country is: nothing 185 m in from the new edge, all of one at it, and nothing at all on the old ground */
  const edgeOf = (x: number, z: number) => {
    // (How far out, by whichever of the two it is further out by; and where the two are within EDGE_ROUND of each
    // other, a little more, so that the one goes over into the other in a curve. It was the greater of the two and
    // nothing else, which is a square: its corners ran out to the corners of the map as four dead straight creases,
    // one of them a straight cliff behind the mountain road's hairpin. Nothing further than EDGE_ROUND from those
    // lines is moved by it.)
    const ax = Math.abs(x), az = Math.abs(z), apart = Math.abs(ax - az);
    const e = Math.max(ax, az) + (apart < EDGE_ROUND ? ((EDGE_ROUND - apart) * (EDGE_ROUND - apart)) / (4 * EDGE_ROUND) : 0);
    // (in the north-east the slope begins at the old edge itself: all of the new ground there is the mountain's)
    return e <= OLD_HALF ? 0 : (1 - smoothstep(10, lerp(185, PEAK.run, peakOf(x, z)), half - e)) * smoothstep(0, 64, e - OLD_HALF);
  };
  const ringShape = (x: number, z: number) => {
    const m = edgeOf(x, z);
    return m <= 0 ? 0 : Math.pow(m, 1.15) * (48 + 26 * (0.5 + 0.5 * n1.noise(x * 0.012 + 5, z * 0.012 - 9))) * lerp(1, PEAK.lift, peakOf(x, z));
  };
  const heights = new Float32Array(N * N);
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      heights[idx(ix, iz)] = base(-half + ix * CELL, -half + iz * CELL) + ringShape(-half + ix * CELL, -half + iz * CELL);
    }
  }
  soften(heights, edgeOf);

  yield 'road';
  // --- road: its line is needed early, so nothing else is put in its way
  const path2 = catmullRom(OLD_ROAD, 4);
  const roadGap = (x: number, z: number) => {
    let best = 1e9;
    for (const [px, pz] of path2) best = Math.min(best, Math.hypot(px - x, pz - z));
    return best;
  };

  yield 'outlying places';
  // --- outlying places. New characters start on a ring out at the map's edge with nothing
  // in their hands: a ring of small places sits just inside it, one within a short run of
  // every start, and a few more lie between there and the village.
  const MID = { x: VILLAGE.x * 0.5, z: VILLAGE.z * 0.5 };
  const sites: Site[] = [];
  /** @param at exactly here, and nowhere looked for */
  const place = (name: string, kind: SiteKind, angle: number, radii: number[], offRoad = 48, later = false, at?: { x: number; z: number }) => {
    // the most level spot near where it is wanted, clear of the road and of its neighbours
    let best: { x: number; z: number; cost: number } | null = at ? { x: at.x, z: at.z, cost: 0 } : null;
    if (at) radii = [];
    for (const r of radii) {
      for (const da of [0, -0.05, 0.05, -0.1, 0.1]) {
        const x = MID.x + Math.cos(angle + da) * r, z = MID.z + Math.sin(angle + da) * r;
        if (Math.abs(x) > OLD_HALF - 90 || Math.abs(z) > OLD_HALF - 90) continue;
        if (roadGap(x, z) < offRoad) continue;
        if (pois.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius + 60)) continue;
        // level where the buildings stand, and no bank to climb on the way in
        let lo = 1e9, hi = -1e9, lo2 = 1e9, hi2 = -1e9;
        for (let k = 0; k < 9; k++) {
          const h = base(x + Math.cos(k * 0.7) * (k ? 22 : 0), z + Math.sin(k * 0.7) * (k ? 22 : 0));
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
          const far = base(x + Math.cos(k * 0.7) * 48, z + Math.sin(k * 0.7) * 48);
          lo2 = Math.min(lo2, far);
          hi2 = Math.max(hi2, far);
        }
        const cost = hi - lo + 0.6 * Math.max(hi2 - base(x, z), base(x, z) - lo2) + Math.abs(da) * 20;
        if (!best || cost < best.cost) best = { x, z, cost };
      }
    }
    if (!best) return;
    sites.push({ name, kind, x: best.x, z: best.z, rot: Math.atan2(best.x - MID.x, best.z - MID.z), ...(later ? { later } : {}) });
    pois.push({ name, x: best.x, z: best.z, radius: 40 });
  };
  // just inside the ring of starting points (see the spawns below: three of them to each place)
  const OUTER: [string, SiteKind][] = [
    ["Forester's Lodge", 'lodge'], ['Kamenka Farm', 'farm'], ['South Ranger Post', 'post'], ['Old Sawmill', 'yard'],
    ["Trapper's Camp", 'lodge'], ['Berezovo Dacha', 'dacha'], ['North Ranger Post', 'post'], ['Lugovoe Farm', 'farm'],
  ];
  OUTER.forEach(([name, kind], j) => place(name, kind, ((3 * j + 1) / 24) * Math.PI * 2 + 0.13, [305, 295, 315, 285, 325, 275]));
  // and half way in, where the hills have nothing else
  place('Kolkhoz Yard', 'yard', 1.31, [190, 175, 205, 160]);
  place('Field Depot', 'post', 4.36, [185, 170, 200, 215]);
  place('Quarry Dacha', 'dacha', 5.24, [190, 205, 175, 220]);

  yield 'soften settlements';
  // --- soften settlements (village plateau, camp clearing)
  const flattenArea = (cx: number, cz: number, inner: number, outer: number, bumpy: number) => {
    const target = base(cx, cz);
    // (only the cells the disc can reach: the same result, and no walk of the whole grid for each place)
    for (let iz = Math.max(0, Math.floor((cz - outer + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((cz + outer + half) / CELL)); iz++) {
      for (let ix = Math.max(0, Math.floor((cx - outer + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((cx + outer + half) / CELL)); ix++) {
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
  for (const st of sites) flattenArea(st.x, st.z, 20, 60, 0.35);

  yield 'road';
  // --- road: spline through the village, height profile smoothed along its length
  // (The road runs 28 m past where the map once ended. Its height out there was read at that edge, the nearest
  // ground there was: it still is, to the same fraction of a cell, or the road's last 60 m would stand a metre off.)
  const atOldEdge = (v: number) => clamp(v, -OLD_HALF, OLD_HALF - 0.0001 * CELL);
  const sampled = path2.map(([x, z]) => heightAt(heights, atOldEdge(x), atOldEdge(z)));
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

  yield 'building plots';
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
  const addBuilding = (type: BuildingType, x: number, z: number, rot: number, arms = 0) => {
    const [w, d] = BUILDING_FOOTPRINT[type];
    const r = Math.hypot(w, d) / 2;
    for (const b of blocked) if (Math.hypot(b.x - x, b.z - z) < b.r + r + 2.5) return false;
    if (roadNearest(x, z).d < r + ROAD_W / 2 + 2) return false;
    blocked.push({ x, z, r });
    buildings.push({ id: `${type}_${buildings.length}`, type, x, z, rot, floorY: 0, seed: Math.floor(rng.next() * 1e9), ...(arms ? { arms } : {}) });
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
    addBuilding('police', x + px * off, z + pz * off, Math.atan2(-px, -pz), 5);
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
  addBuilding('guardpost', CAMP.x + 8, CAMP.z - 10, Math.PI * 0.75, 1);
  addBuilding('guardpost', CAMP.x - 12, CAMP.z + 10, Math.PI * 1.75, 1);
  addBuilding('barn', CAMP.x - 6, CAMP.z - 14, Math.PI * 0.25);
  // hunter's cabin
  addBuilding('cabin', CABIN.x, CABIN.z, Math.PI * 0.6, 1);
  addBuilding('shed', CABIN.x + 9, CABIN.z - 5, Math.PI * 0.6);
  // outlying places: [type, right, forward, turn] in the site's own frame (forward = out
  // toward the map's edge). The first building of each is where a weapon is always left.
  const LAYOUT: Record<SiteKind, [BuildingType, number, number, number][]> = {
    lodge: [['cabin', 0, -2, 0], ['shed', 9, 2, -0.5]],
    farm: [['house_small', -6, -3, 0], ['barn', 10, -2, -0.35], ['shed', -15, 6, 0.6]],
    post: [['guardpost', 0, -2, 0], ['shed', -8, 2, 0.4]],
    yard: [['barn', 0, -4, 0], ['shed', -12, 3, 0.5], ['shed', 12, 4, -0.5]],
    dacha: [['house_brick', 0, -3, 0], ['shed', 11, 4, -0.4]],
    // a shop between two houses, a barn and a shed behind
    hamlet: [['store', 0, 0, 0], ['house_small', -14.5, 0.5, 0.12], ['house_brick', 16, 0, -0.1], ['barn', -4, -17, 0.2], ['shed', 13, -13.5, -0.4]],
    // the army's: a barracks, a workshop for its vehicles, a post on the way in
    depot: [['barracks', 0, -3, 0], ['garage', -16.5, -1, 0.22], ['guardpost', 13.5, 3.5, -0.3], ['shed', 12.5, -12.5, -0.5]],
    // the trading post: the trader's shop, and his store shed behind it
    // (and a bunkhouse beside the trader's yard, its door to the way in)
    market: [['store', 0, 0, 0], ['shed', 13.5, -12, -0.4], ['hut', -30, 3, -Math.PI / 2]],
    // (laid out by hand where they are built: see the east country, at the end)
    town: [],
    squat: [],
    camp: [],
    // The army's camp: four tents, two a side of a lane with their doors to it, and a watchtower at the lane's
    // end looking back down it. (A tent turned a quarter round lies with its length across the lane.)
    tents: [['tent', 7.75, -7.5, -Math.PI / 2], ['tent', -7.75, -7.5, Math.PI / 2], ['tent', 7.75, 7.5, -Math.PI / 2], ['tent', -7.75, 7.5, Math.PI / 2], ['tower', 0, 25, Math.PI]],
    // (laid out where it is made, at the end: see the first expansion)
    works: [],
    // (nothing stands on it that is a building of the map's: what is there is made in world/bunker.ts)
    bunker: [],
  };
  for (const st of sites) {
    const c = Math.cos(st.rot), sn = Math.sin(st.rot);
    LAYOUT[st.kind].forEach(([type, right, fwd, turn], i) => {
      // local +Z is a building's front, and the site's "forward": a turn about Y by its rot
      addBuilding(type, st.x + right * c + fwd * sn, st.z - right * sn + fwd * c, st.rot + turn, i === 0 ? 1 : 0);
    });
  }

  // Level ground under and around each building, and record floor heights. The floor sits
  // just above the highest ground it covers; the ground everywhere under it and for a pace
  // around it is brought to a hand's breadth below the floor, cut down or filled up, so every
  // doorway is a sill to walk over whichever way the slope runs. (A quarter-metre step was
  // enough to stop a body that came at the door a little off its line.)
  const pad = (b: BuildingPlot, margin: number, inner: number) => {
    const [w, d] = BUILDING_FOOTPRINT[b.type];
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const padY = b.floorY - 0.08;
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
        const i = idx(ix, iz);
        heights[i] = lerp(heights[i], padY, 1 - smoothstep(inner, margin, e));
      }
    }
  };
  const seat = (b: BuildingPlot) => {
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
    // on a slope the floor need not clear the very highest corner: the ground there is cut down to it
    b.floorY = Math.max(avg + 0.35, Math.min(maxH + 0.12, avg + 0.9));
    pad(b, 6, 0.3);
  };
  for (const b of buildings) seat(b);
  // a neighbour's wide skirt may have dragged the ground at this one's walls: the last word
  // on the ground a pace around each building is its own
  for (const b of buildings) pad(b, 3.2, 2.2);

  yield 'masks';
  // --- masks
  /** the floor of the expansion, once it has been cut (nothing, while the map is made as it first was) */
  let cleared: { x: number; z: number; r: number } | null = null;
  /** Kamenka's valley is made (see the east country, at the end): nothing, while the map is made as it first was */
  let valley = false;
  /** how much of the rim's height a spot is at: none on the floor, a steady climb to the crest, and down again outside */
  const rimOf = (q: number) => {
    const up = clamp((q - 1.15) / (KAMENKA.crest - 1.15), 0, 1);
    return (0.55 * up + 0.45 * smoothstep(0, 1, up)) * (1 - smoothstep(KAMENKA.crest, KAMENKA.foot, q));
  };
  const forestMask = (x: number, z: number) => {
    let f = n2.fbm(x * 0.0055 + 70, z * 0.0055 - 40, 4) * 0.9 + 0.12 * n3.noise(x * 0.04, z * 0.04);
    const r = Math.hypot(x, z);
    f += 0.35 * smoothstep(260, 420, r); // dense forest on the outer hills hides the map edge
    if (cleared) f -= 1.1 * (1 - smoothstep(cleared.r - 16, cleared.r + 8, Math.hypot(x - cleared.x, z - cleared.z)));
    f -= 0.9 * (1 - smoothstep(85, 140, Math.hypot(x - VILLAGE.x, z - VILLAGE.z)));
    f -= 0.8 * (1 - smoothstep(35, 60, Math.hypot(x - CAMP.x, z - CAMP.z)));
    f -= 0.8 * (1 - smoothstep(10, 22, Math.hypot(x - CABIN.x, z - CABIN.z)));
    for (const st of sites) {
      const d = Math.hypot(x - st.x, z - st.z);
      if (d < 34) f -= 0.85 * (1 - smoothstep(20, 34, d));
    }
    // The country the map was grown by: woods and open hillside by turns. (The old rule, carried on outward,
    // is one unbroken wood to the edge.) Nothing of this is felt inside the old square.
    const out = Math.max(Math.abs(x), Math.abs(z)) - OLD_HALF;
    if (out > 0) {
      let g = n2.fbm(x * 0.0042 + 40, z * 0.0042 - 23, 3) * 1.15 - 0.1 + 0.12 * n3.noise(x * 0.04, z * 0.04);
      // (the mountains at the edge and the hills round the town are wooded, as the old rim is: the open ground is between them)
      g += 0.75 * edgeOf(x, z);
      g -= 1.0 * (1 - smoothstep(70, 105, Math.hypot(x - TOWN.x, z - TOWN.z)));
      for (const o of OUTLYING) g -= 0.9 * (1 - smoothstep(22, 40, Math.hypot(x - o.x, z - o.z)));
      f = lerp(f, g, smoothstep(0, 60, out));
    }
    // Kamenka's valley, once it is made (and not before: the old map is planted and strewn by this rule as it always
    // was). Wooded all the way up its rim and over, a clearing here and there, and the floor of it the town's.
    if (valley) {
      const q = kamenkaQ(x, z);
      if (q < KAMENKA.foot) {
        const wood = 0.12 + 0.5 * rimOf(q) + 0.42 * n2.fbm(x * 0.006 - 11, z * 0.006 + 29, 3) - 1.3 * (1 - smoothstep(1.0, 1.3, q));
        f = lerp(f, wood, 1 - smoothstep(3.0, KAMENKA.foot, q));
      }
    }
    return f;
  };
  // (Asked of every cell of the ground, twice: with the map grown and a hundred and twenty buildings on it that was
  // most of the eight seconds the map took to make. The buildings are sorted into squares of 32 m, and only those
  // of the square asked about are tried: the same answer. Sorted again whenever one has been added.)
  const SQ = 32, nearby = new Map<number, BuildingPlot[]>();
  let sorted = -1;
  const square = (x: number, z: number) => Math.floor((x + half) / SQ) * 4096 + Math.floor((z + half) / SQ);
  const insideBuilding = (x: number, z: number, pad: number) => {
    if (sorted !== buildings.length) {
      nearby.clear();
      for (const b of buildings) {
        // (as far as its corners reach, and the widest margin anybody asks with)
        const r = Math.hypot(...BUILDING_FOOTPRINT[b.type]) / 2 + 8;
        for (let qx = Math.floor((b.x - r + half) / SQ); qx <= Math.floor((b.x + r + half) / SQ); qx++)
          for (let qz = Math.floor((b.z - r + half) / SQ); qz <= Math.floor((b.z + r + half) / SQ); qz++) {
            const k = qx * 4096 + qz;
            if (!nearby.has(k)) nearby.set(k, []);
            nearby.get(k)!.push(b);
          }
      }
      sorted = buildings.length;
    }
    for (const b of nearby.get(square(x, z)) ?? []) {
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      const dx = x - b.x, dz = z - b.z;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      if (Math.abs(lx) < w / 2 + pad && Math.abs(lz) < d / 2 + pad) return true;
    }
    return false;
  };

  yield 'splat + grass';
  // --- splat + grass
  const splat = new Uint8Array(N * N * 4);
  const grass = new Uint8Array(N * N);
  const paint = (ix: number, iz: number) => {
    {
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
      // (the floor of the works: years of lorries, and whatever leaked. Nothing has grown back.)
      if (cleared) gravel = Math.max(gravel, (1 - smoothstep(cleared.r - 30, cleared.r - 6, Math.hypot(x - cleared.x, z - cleared.z) + 9 * n3.noise(x * 0.05, z * 0.05))) * 0.88);
      for (const st of sites) {
        const d = Math.hypot(x - st.x, z - st.z);
        // trodden bare in the middle, with a short ragged edge: a wide half-and-half band shows
        // the gravel's pale stones through the grass as a lattice of dots
        if (d < 18) gravel = Math.max(gravel, (1 - smoothstep(7.5, 12.5, d + 3.5 * n3.noise(x * 0.15, z * 0.15))) * 0.92);
      }
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
      // (no grass through the snow: it thins as the snow begins and is gone where the ground is white)
      g *= 1 - smoothstep(SNOW.from - 10, SNOW.from + 8, heights[i]);
      grass[i] = Math.round(clamp(g, 0, 1) * 255);
    }
  };
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) paint(ix, iz);

  yield 'vegetation';
  // --- vegetation
  const trees: Instance[] = [];
  const rocks: Instance[] = [];
  const props: Instance[] = [];
  const TREE_STEP = 6.2;
  const pines = ['pine_a', 'pine_b', 'pine_c', 'pine_d'];
  for (let gz = -OLD_HALF + 4; gz < OLD_HALF - 4; gz += TREE_STEP) {
    for (let gx = -OLD_HALF + 4; gx < OLD_HALF - 4; gx += TREE_STEP) {
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

  // The country the map was grown by is planted by the same rule, on a grid of its own: after every tree there
  // was, so that none of those is moved or renumbered.
  for (let gz = -half + 10; gz < half - 10; gz += TREE_STEP) {
    for (let gx = -half + 10; gx < half - 10; gx += TREE_STEP) {
      if (Math.abs(gx) < OLD_HALF - 4 && Math.abs(gz) < OLD_HALF - 4) continue;
      const hx = hash2(Math.round(gx * 10), Math.round(gz * 10), seed + 41);
      const hz = hash2(Math.round(gz * 10), Math.round(gx * 10), seed + 47);
      const x = gx + (hx - 0.5) * TREE_STEP * 0.9;
      const z = gz + (hz - 0.5) * TREE_STEP * 0.9;
      if (Math.abs(x) <= OLD_HALF + 0.5 && Math.abs(z) <= OLD_HALF + 0.5) continue;
      const f = forestMask(x, z);
      const hv = hash2(Math.round(x * 7), Math.round(z * 7), seed + 43);
      const i = idx(Math.round((x + half) / CELL), Math.round((z + half) / CELL));
      if (roadDist[i] < ROAD_W / 2 + 4 || slopeAt(heights, x, z) > 1.05) continue;
      const y = heightAt(heights, x, z);
      // (the tree line: where the snow lies nothing grows but pine, the wood thins as it climbs, and the top is bare)
      const high = y > SNOW.from - 6;
      if (y > SNOW.bare || (y > SNOW.thin && hv > 0.62 * (1 - smoothstep(SNOW.thin, SNOW.bare, y)) * 0.6)) continue;
      if (f > 0.08) {
        const edge = f < 0.2;
        // (two trees in three of what the old rule would plant: there is a third again as much ground out here)
        if (hv > smoothstep(0.08, 0.3, f) * 0.62) continue;
        let kind: string;
        if (!high && edge && hv < 0.3) kind = hv < 0.12 ? 'bush_a' : hv < 0.2 ? 'bush_b' : 'birch_a';
        else if (!high && hv < 0.08) kind = 'birch_b';
        else kind = pines[Math.floor(hash2(Math.round(x), Math.round(z), 5) * pines.length)];
        trees.push({ kind, x, y, z, rot: hx * Math.PI * 2, scale: 0.85 + hz * 0.35 });
      } else if (high) {
        // (no oak, ash, birch or bush up where the snow lies)
      } else if (f > -0.25 && hv < 0.025) {
        trees.push({ kind: hv < 0.01 ? 'oak_a' : hv < 0.018 ? 'ash_a' : 'birch_a', x, y, z, rot: hx * Math.PI * 2, scale: 0.9 + hz * 0.3 });
      } else if (f > -0.15 && hv > 0.97) {
        trees.push({ kind: hv > 0.985 ? 'bush_a' : 'bush_b', x, y, z, rot: hx * Math.PI * 2, scale: 0.8 + hz * 0.5 });
      }
    }
  }

  // forest debris, rocks, ferns
  const rockKinds = ['rock_moss_set_01', 'rock_moss_set_02'];
  for (let k = 0; k < 2600; k++) {
    const x = rng.range(-OLD_HALF + 20, OLD_HALF - 20);
    const z = rng.range(-OLD_HALF + 20, OLD_HALF - 20);
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

  // spawn ring: out in the forest on the edge of the map, each start a short run from one
  // of the outlying places. The best of everything is a long walk further in.
  const spawns: { x: number; z: number; yaw: number }[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2 + 0.13;
    for (const r of [365, 360, 370, 355, 375, 350, 380, 345, 385, 395]) {
      const x = VILLAGE.x * 0.5 + Math.cos(a) * r, z = VILLAGE.z * 0.5 + Math.sin(a) * r;
      if (Math.abs(x) > OLD_HALF - 60 || Math.abs(z) > OLD_HALF - 60) continue;
      // reasonably level ground
      const h0 = heightAt(heights, x, z);
      const steep = Math.max(Math.abs(heightAt(heights, x + 3, z) - h0), Math.abs(heightAt(heights, x, z + 3) - h0), Math.abs(heightAt(heights, x - 3, z) - h0), Math.abs(heightAt(heights, x, z - 3) - h0));
      if (steep > 1.2) continue;
      // nobody starts inside a tree or wedged against a rock
      if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2.6) || rocks.some((t) => Math.hypot(t.x - x, t.z - z) < 2.4) || props.some((t) => Math.hypot(t.x - x, t.z - z) < 1.6)) continue;
      // facing the nearest place to find something to fight with (or the village, failing that)
      let to = { x: VILLAGE.x, z: VILLAGE.z }, near = 220;
      for (const st of sites) {
        const d = Math.hypot(st.x - x, st.z - z);
        if (d < near) { near = d; to = st; }
      }
      spawns.push({ x, z, yaw: Math.atan2(-(to.x - x), -(to.z - z)) });
      break;
    }
  }
  // (the first of them that anybody is still set down at is the one told to whoever asks for one: see `starts`, at the end)

  yield 'what was built later';
  // --- what was built later: a clinic, a shop and a workshop in the village, a barracks at
  // the checkpoint, a workshop at each yard, and two new places half way in.
  //
  // Everything above this line is the map as it first was, and stays exactly that: the same
  // trees and stones, the same places to start, the same jeeps, every building where it was
  // and numbered as it was (what is kept between restarts goes by those numbers). What follows
  // is laid over it. It takes nothing from the dice the map was thrown with (it has its own),
  // and where it needs ground it levels that ground and clears it, and leaves the road alone.
  {
    const firstLater = buildings.length;
    const before = heights.slice();
    const rng2 = new RNG(seed + 4242);
    const cell = (x: number, z: number) => idx(clamp(Math.round((x + half) / CELL), 0, N - 1), clamp(Math.round((z + half) / CELL), 0, N - 1));
    const addLater = (type: BuildingType, x: number, z: number, rot: number, arms = 0, gap = 4) => {
      const [w, d] = BUILDING_FOOTPRINT[type];
      const r = Math.hypot(w, d) / 2;
      // (among the old buildings, a little further from its neighbours than they are from each other: a car may be parked beside a house)
      for (const b of blocked) if (Math.hypot(b.x - x, b.z - z) < b.r + r + gap) return false;
      if (roadNearest(x, z).d < r + ROAD_W / 2 + 2.5 || trackDist[cell(x, z)] < r + 3) return false;
      blocked.push({ x, z, r });
      buildings.push({ id: `${type}_${buildings.length}`, type, x, z, rot, floorY: 0, seed: Math.floor(rng2.next() * 1e9), ...(arms ? { arms } : {}) });
      return true;
    };
    // on the village street, as near the middle of it as there is room: its door to the road
    const onStreet = (type: BuildingType, back: number) => {
      const order = path2
        .map((p, i) => ({ i, d: Math.hypot(p[0] - VILLAGE.x, p[1] - VILLAGE.z) }))
        .filter((q) => q.d < 104 && q.i < path2.length - 1)
        .sort((a, b) => a.d - b.d);
      for (const { i } of order) {
        const [x, z] = path2[i], [nx, nz] = path2[i + 1];
        const tl = Math.hypot(nx - x, nz - z);
        const px = -(nz - z) / tl, pz = (nx - x) / tl;
        const off = back + BUILDING_FOOTPRINT[type][1] / 2 + ROAD_W / 2;
        for (const side of [1, -1]) if (addLater(type, x + px * off * side, z + pz * off * side, Math.atan2(-px * side, -pz * side))) return true;
      }
      return false;
    };
    onStreet('clinic', 9);
    onStreet('store', 8);
    onStreet('garage', 11);
    // the checkpoint's barracks: on the far side of the yard from the way in, its door to the yard
    for (const [ox, oz] of [[-3, 27], [-29, -5], [-27, 22], [27, 17]] as [number, number][]) {
      if (addLater('barracks', CAMP.x + ox, CAMP.z + oz, Math.atan2(-ox, -oz), 2)) break;
    }
    // a workshop beside each yard's barn
    for (const st of sites) {
      if (st.kind !== 'yard') continue;
      const c = Math.cos(st.rot), sn = Math.sin(st.rot);
      addLater('garage', st.x + 20 * c - 7 * sn, st.z - 20 * sn - 7 * c, st.rot - 0.45);
    }
    // the two new places: well back from the road, which the levelling of them must not reach
    const firstSite = sites.length;
    place('Sosnovka', 'hamlet', 3.93, [230, 215, 245, 200, 260], 78, true);
    place('Motor Pool', 'depot', 0.85, [205, 190, 220, 235, 175], 78, true);
    const laterSites = sites.slice(firstSite);
    const lay = (st: (typeof sites)[number]) => {
      const target = before[cell(st.x, st.z)];
      const R = 60;
      for (let iz = Math.max(0, Math.floor((st.z - R + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((st.z + R + half) / CELL)); iz++) {
        for (let ix = Math.max(0, Math.floor((st.x - R + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((st.x + R + half) / CELL)); ix++) {
          const x = -half + ix * CELL, z = -half + iz * CELL;
          const d = Math.hypot(x - st.x, z - st.z);
          if (d > R) continue;
          const i = idx(ix, iz);
          // (not the road's bed nor a track's, nor the ground a pace round a building that is already there)
          const w = (1 - smoothstep(22, R, d)) * smoothstep(16, 30, roadDist[i]) * smoothstep(8, 16, trackDist[i]);
          const local = target + 0.35 * n3.fbm(x * 0.02, z * 0.02, 3) + (heights[i] - target) * 0.25;
          heights[i] = lerp(heights[i], local, w);
        }
      }
      const c = Math.cos(st.rot), sn = Math.sin(st.rot);
      LAYOUT[st.kind].forEach(([type, right, fwd, turn], i) => {
        addLater(type, st.x + right * c + fwd * sn, st.z - right * sn + fwd * c, st.rot + turn, i === 0 ? (st.kind === 'depot' ? 2 : st.kind === 'market' ? 0 : 1) : 0, 2.5);
      });
    };
    for (const st of laterSites) lay(st);
    // Later still: houses of two floors. (Whatever is added goes here, after everything above:
    // each building is numbered by where it comes in the list, and what is kept between
    // restarts goes by those numbers.)
    onStreet('house_two', 10);
    onStreet('house_two', 12);
    for (const st of laterSites) {
      if (st.kind !== 'hamlet') continue;
      const c = Math.cos(st.rot), sn = Math.sin(st.rot);
      for (const [right, fwd] of [[-17, -14], [19, -12], [-21, 8], [22, 10], [0, -22], [-27, -19], [28, -17], [-29, 13], [29, 15], [0, -31], [0, 31], [-34, 0], [34, 0]]) {
        if (addLater('house_two', st.x + right * c + fwd * sn, st.z - right * sn + fwd * c, st.rot + (right > 0 ? -0.4 : 0.4), 1, 2.5)) break;
      }
    }
    // and a watchtower: over the checkpoint's yard, and over the motor pool
    for (const [ox, oz] of [[17, -19], [-19, -21], [21, 4], [-23, 8], [6, 26], [-8, -27]] as [number, number][]) {
      if (addLater('tower', CAMP.x + ox, CAMP.z + oz, Math.atan2(-ox, -oz), 1, 2)) break;
    }
    for (const st of laterSites) {
      if (st.kind !== 'depot') continue;
      const c = Math.cos(st.rot), sn = Math.sin(st.rot);
      for (const [right, fwd] of [[21, 12], [-22, 11], [20, -16], [-21, -15], [0, 24]]) {
        if (addLater('tower', st.x + right * c + fwd * sn, st.z - right * sn + fwd * c, st.rot + Math.PI, 1, 2)) break;
      }
    }
    // And later again, the trading post, out on its own in the east meadow (see src/sim/trade.ts). It comes
    // after every building there was, so that none of them is renumbered.
    {
      const first = sites.length;
      place('Trading Post', 'market', 0, [], 0, true, TRADE_AT);
      for (const st of sites.slice(first)) {
        lay(st);
        laterSites.push(st);
      }
    }
    // And the long huts (see `hut` in buildings.ts), where men were quartered: one behind the depot's barracks,
    // its door to the shed, and one beside the track from the checkpoint up to the works, its door to the
    // checkpoint. After everything, as above. (The one by the trader's yard is in his place's own layout.)
    {
      const depot = sites.find((st) => st.kind === 'depot');
      if (depot) {
        const c = Math.cos(depot.rot), sn = Math.sin(depot.rot);
        addLater('hut', depot.x - 6 * c - 21 * sn, depot.z + 6 * sn - 21 * c, depot.rot, 0, 2.5);
      }
      const up = Math.hypot(EXPANSION.x - CAMP.x, EXPANSION.z - CAMP.z), ux = (EXPANSION.x - CAMP.x) / up, uz = (EXPANSION.z - CAMP.z) / up;
      for (const side of [1, -1]) if (addLater('hut', CAMP.x + ux * 46 - uz * 18 * side, CAMP.z + uz * 46 + ux * 18 * side, Math.atan2(uz, -ux), 0, 2.5)) break;
      // And in the village, one of each of the buildings that were downloaded whole, behind its street: the brick
      // block south of the road with its door to it, the plank house and a long hut north of it.
      addLater('townhouse', 44, -28, Math.PI / 2, 0, 2.5);
      addLater('shanty', 14, 50, Math.PI, 0, 2.5);
      addLater('hut', 46, 50, 0, 0, 2.5);
    }
    // And the army's camp (2026-10-10), in a clearing of the wood south of the west road. After everything, as
    // above: none of what was there is renumbered.
    {
      const first = sites.length;
      place(ARMY_CAMP.name, 'tents', 0, [], 0, true, ARMY_CAMP);
      for (const st of sites.slice(first)) {
        lay(st);
        laterSites.push(st);
      }
    }
    const added = buildings.slice(firstLater);
    for (const b of added) seat(b);
    // (the last word on the ground a pace round a building is its own: said again for the new ones,
    // and for any old one a new one's skirt could have reached)
    const reach = (b: BuildingPlot) => Math.hypot(...BUILDING_FOOTPRINT[b.type]) / 2;
    for (const b of buildings) if (added.some((n) => n === b || Math.hypot(n.x - b.x, n.z - b.z) < reach(n) + reach(b) + 9.5)) pad(b, 3.2, 2.2);

    // what grew or lay where something now stands goes; a new place is a clearing, thinned as
    // the first ones were; and whatever is left stands on the ground as it is now
    const inAdded = (x: number, z: number, margin: number) =>
      added.some((b) => {
        const [w, d] = BUILDING_FOOTPRINT[b.type];
        const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot);
        return Math.abs(dx * c - dz * s) < w / 2 + margin && Math.abs(dx * s + dz * c) < d / 2 + margin;
      });
    const nearLater = (x: number, z: number, r: number) => laterSites.some((st) => Math.hypot(st.x - x, st.z - z) < r);
    const keepTree = (t: Instance) => {
      if (inAdded(t.x, t.z, 4)) return false;
      if (!nearLater(t.x, t.z, 34)) return true;
      // (the same rule the trees were planted by, with the clearing now in it)
      const f = forestMask(t.x, t.z);
      const hv = hash2(Math.round(t.x * 7), Math.round(t.z * 7), seed + 3);
      if (f > 0.08) return hv <= smoothstep(0.08, 0.3, f) * 0.92;
      return (f > -0.25 && hv < 0.025) || (f > -0.15 && hv > 0.97);
    };
    const settle = (list: Instance[], keep: (t: Instance) => boolean) => {
      for (let k = list.length - 1; k >= 0; k--) {
        const t = list[k];
        if (!keep(t)) list.splice(k, 1);
        else t.y += heightAt(heights, t.x, t.z) - heightAt(before, t.x, t.z);
      }
    };
    settle(trees, keepTree);
    settle(rocks, (t) => !inAdded(t.x, t.z, 2.5) && !nearLater(t.x, t.z, 26));
    settle(props, (t) => !inAdded(t.x, t.z, 2.5) && !nearLater(t.x, t.z, 26));
    // and the ground is painted again wherever any of this reaches
    const again = new Set<number>();
    const mark = (cx: number, cz: number, R: number) => {
      for (let iz = Math.max(0, Math.floor((cz - R + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((cz + R + half) / CELL)); iz++)
        for (let ix = Math.max(0, Math.floor((cx - R + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((cx + R + half) / CELL)); ix++) again.add(iz * N + ix);
    };
    for (const st of laterSites) mark(st.x, st.z, 64);
    for (const b of added) mark(b.x, b.z, 22);
    for (const k of again) paint(k % N, Math.floor(k / N));
  }

  yield 'the first expansion';
  // --- the first expansion: the Chemical Works, in a cirque cut into the hills behind the
  // checkpoint (see EXPANSION). Laid over everything above, by the same rule as what was
  // built later: its own dice, nothing that was there before moved or renumbered, and the
  // ground only touched where it stands and along the track that goes up to it.
  const solids: Solid[] = [];
  {
    const E = EXPANSION;
    const first = buildings.length;
    const before = heights.slice();
    const rng3 = new RNG(seed + 7001);
    const cell = (x: number, z: number) => idx(clamp(Math.round((x + half) / CELL), 0, N - 1), clamp(Math.round((z + half) / CELL), 0, N - 1));
    // the way in: from the works toward the checkpoint (the site's "forward"), and what is to the right of that
    const inl = Math.hypot(CAMP.x - E.x, CAMP.z - E.z);
    const ux = (CAMP.x - E.x) / inl, uz = (CAMP.z - E.z) / inl;
    const rot = Math.atan2(ux, uz);
    const at = (right: number, fwd: number): [number, number] => [E.x + right * Math.cos(rot) + fwd * Math.sin(rot), E.z - right * Math.sin(rot) + fwd * Math.cos(rot)];

    // 1. the cirque: a level floor, and the hillside brought down to it all round. Toward the
    // checkpoint the hillside is already as low as the floor: that side is the way in.
    let low = 1e9;
    for (let d = E.floor; d < inl - 40; d += 4) low = Math.min(low, heightAt(before, E.x + ux * d, E.z + uz * d));
    const floorY = low + E.level;
    const R = E.floor + E.wall;
    for (let iz = Math.max(0, Math.floor((E.z - R + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((E.z + R + half) / CELL)); iz++) {
      for (let ix = Math.max(0, Math.floor((E.x - R + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((E.x + R + half) / CELL)); ix++) {
        const x = -half + ix * CELL, z = -half + iz * CELL;
        const d = Math.hypot(x - E.x, z - E.z);
        if (d >= R) continue;
        // (the foot of the wall wanders in and out by a dozen metres: drawn with a compass, it is a crater)
        const wander = 13 * n2.fbm(x * 0.011 + 9, z * 0.011 - 4, 3) * smoothstep(E.floor - 26, E.floor - 6, d) * (1 - smoothstep(R - 22, R - 4, d));
        const t = clamp((d + wander - E.floor) / E.wall, 0, 1);
        // (mostly a straight run up, eased at its foot and its head: eased all the way, the middle of it is a cliff)
        const w = 1 - (0.3 * smoothstep(0, 1, t) + 0.7 * t);
        const i = idx(ix, iz);
        const level = floorY + 0.35 * n3.fbm(x * 0.02, z * 0.02, 3);
        // a little of the hillside's own shape is left in the wall, so it is not a turned bowl
        heights[i] = lerp(heights[i], level + (heights[i] - level) * 0.12 * t, w);
      }
    }

    // 2. the track up to it from the checkpoint: out of the far side of the checkpoint's
    // yard, across the dip and up through the mouth, to the middle of the works' own yard
    const side = (k: number): [number, number] => [-uz * k, ux * k];
    const leg = inl - 30 - 12;
    const ctrl: [number, number][] = [0, 0.3, 0.5, 0.68, 1].map((f, k) => {
      const d = 30 + leg * f, [sx, sz] = side([0, 13, -10, 0, 0][k]);
      return [CAMP.x - ux * d + sx, CAMP.z - uz * d + sz] as [number, number];
    });
    const track = catmullRom(ctrl, 4);
    const raw = track.map(([x, z]) => heightAt(heights, x, z));
    const ys = raw.map((_, i) => {
      let s = 0, c = 0;
      for (let k = -9; k <= 9; k++) {
        const w = 1 - Math.abs(k) / 10;
        s += raw[clamp(i + k, 0, raw.length - 1)] * w;
        c += w;
      }
      return s / c;
    });
    const newDist = new Float32Array(N * N).fill(1e9), newH = new Float32Array(N * N);
    rasterLine(track, ys, 9, newDist, newH);
    for (let i = 0; i < N * N; i++) {
      if (newDist[i] >= 9) continue;
      const x = -half + (i % N) * CELL, z = -half + Math.floor(i / N) * CELL;
      // (not the checkpoint's own yard, nor the ground a building there stands on)
      const w = (1 - smoothstep(1.8, 9, newDist[i])) * 0.85 * smoothstep(24, 34, Math.hypot(x - CAMP.x, z - CAMP.z));
      heights[i] = lerp(heights[i], newH[i], w);
      if (newDist[i] < trackDist[i]) {
        trackDist[i] = newDist[i];
        trackH[i] = newH[i];
      }
    }

    // 3. the place itself
    cleared = { x: E.x, z: E.z, r: E.floor };
    sites.push({ name: E.name, kind: 'works', x: E.x, z: E.z, rot, later: true });
    pois.push({ name: E.name, x: E.x, z: E.z, radius: 74 });
    // the chimney and the tanks: stood first, so that no building is put where one is
    const stand = (kind: Solid['kind'], right: number, fwd: number, r: number, h: number) => {
      const [x, z] = at(right, fwd);
      solids.push({ kind, x, y: heightAt(heights, x, z), z, r, h });
      blocked.push({ x, z, r: r + 1.5 });
    };
    stand('stack', 5, -70, 2.1, 46);
    stand('tank', -50, -40, 4.4, 6.6);
    stand('tank', -39, -57, 4.4, 6.6);
    stand('tank', -60, -24, 3.6, 8.2);
    stand('tank', 51, -45, 4.4, 6.6);
    // [type, right, forward, turn, weapons kept]: forward is toward the way in, and a building's own front is turned from that
    const PLAN: [BuildingType, number, number, number, number][] = [
      // the office at the back of the yard, its door to it; the guard's block and a tower beside it
      ['barracks', 0, -46, 0, 2],
      ['house_two', 25, -43, -0.35, 0],
      ['tower', -23, -41, 0.5, 1],
      // down the left of the track: a store, a workshop, a shed
      ['barn', -31, 37, Math.PI / 2, 0],
      ['garage', -32, 9, Math.PI / 2, 0],
      ['shed', -30, -15, 1.25, 0],
      // down the right of it: a workshop, the works' own sick bay, a shed
      ['garage', 31, 36, -Math.PI / 2, 0],
      ['clinic', 33, 7, -Math.PI / 2, 0],
      ['shed', 31, -19, -1.2, 0],
      // and the gate: a post either side of the way in
      ['guardpost', -10, 63, 0, 1],
      ['guardpost', 11, 66, 0, 1],
    ];
    for (const [type, right, fwd, turn, arms] of PLAN) {
      const [x, z] = at(right, fwd);
      const [w, d] = BUILDING_FOOTPRINT[type];
      const r = Math.hypot(w, d) / 2;
      if (blocked.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + r + 2.5) || newDist[cell(x, z)] < r + 2.5) continue;
      blocked.push({ x, z, r });
      buildings.push({ id: `${type}_${buildings.length}`, type, x, z, rot: rot + turn, floorY: 0, seed: Math.floor(rng3.next() * 1e9), ...(arms ? { arms } : {}) });
    }
    const added = buildings.slice(first);
    for (const b of added) seat(b);
    for (const b of added) pad(b, 3.2, 2.2);
    for (const s of solids) s.y = heightAt(heights, s.x, s.z);

    // 4. what grew or lay there: nothing on the floor, nothing on the track, nothing left
    // hanging on a face too steep to stand on; the rest stands on the ground as it now is
    const inAdded = (x: number, z: number, margin: number) =>
      added.some((b) => {
        const [w, d] = BUILDING_FOOTPRINT[b.type];
        const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot);
        return Math.abs(dx * c - dz * s) < w / 2 + margin && Math.abs(dx * s + dz * c) < d / 2 + margin;
      });
    const settle = (list: Instance[], keep: (t: Instance, d: number) => boolean) => {
      for (let k = list.length - 1; k >= 0; k--) {
        const t = list[k];
        const d = Math.hypot(t.x - E.x, t.z - E.z);
        if (d > R + 2 && newDist[cell(t.x, t.z)] > 12) continue;
        if (!keep(t, d)) list.splice(k, 1);
        else t.y += heightAt(heights, t.x, t.z) - heightAt(before, t.x, t.z);
      }
    };
    settle(trees, (t, d) => {
      if (newDist[cell(t.x, t.z)] < 4 || inAdded(t.x, t.z, 4) || solids.some((s) => Math.hypot(s.x - t.x, s.z - t.z) < s.r + 3)) return false;
      if (d >= R) return true;
      if (slopeAt(heights, t.x, t.z) > 1.05) return false;
      // (the same rule the trees were planted by, with the floor of the works now a clearing in it)
      const f = forestMask(t.x, t.z);
      const hv = hash2(Math.round(t.x * 7), Math.round(t.z * 7), seed + 3);
      if (f > 0.08) return hv <= smoothstep(0.08, 0.3, f) * 0.92;
      return (f > -0.25 && hv < 0.025) || (f > -0.15 && hv > 0.97);
    });
    const loose = (t: Instance, d: number) => newDist[cell(t.x, t.z)] >= 3 && !inAdded(t.x, t.z, 2.5) && d > E.floor + 4 && (d >= R || slopeAt(heights, t.x, t.z) < 1.2);
    settle(rocks, loose);
    settle(props, loose);

    // 5. and the ground is painted again wherever any of this reaches
    const again = new Set<number>();
    const mark = (cx: number, cz: number, r: number) => {
      for (let iz = Math.max(0, Math.floor((cz - r + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((cz + r + half) / CELL)); iz++)
        for (let ix = Math.max(0, Math.floor((cx - r + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((cx + r + half) / CELL)); ix++) again.add(iz * N + ix);
    };
    mark(E.x, E.z, R + 6);
    for (const [x, z] of track) mark(x, z, 13);
    for (const k of again) paint(k % N, Math.floor(k / N));
  }

  yield 'the second expansion';
  // --- the second expansion: the bunker (see src/sim/bunker.ts), in a hollow cut into the
  // foot of the hills straight across the map from the works. By the same rule: nothing that
  // was there before is moved or renumbered, and the ground is touched only where it stands.
  // Its mouth opens straight onto the valley floor: there is no track to it.
  /** the ground as it is seen from above, where that is not the ground there is (over the bunker) */
  let surface: Float32Array | null = null;
  {
    const B = BUNKER;
    const before = heights.slice();
    const bx = BUNKER_AT.x, bz = BUNKER_AT.z, bl = Math.hypot(bx, bz);
    // the way out of it: back toward the middle of the map
    const ux = -bx / bl, uz = -bz / bl;
    const rot = Math.atan2(ux, uz);
    const R = B.floor + B.wall;
    // level with the valley floor at its mouth
    const floorY = heightAt(before, bx + ux * (R - 6), bz + uz * (R - 6)) + 0.3;
    for (let iz = Math.max(0, Math.floor((bz - R + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((bz + R + half) / CELL)); iz++) {
      for (let ix = Math.max(0, Math.floor((bx - R + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((bx + R + half) / CELL)); ix++) {
        const x = -half + ix * CELL, z = -half + iz * CELL;
        const d = Math.hypot(x - bx, z - bz);
        if (d >= R) continue;
        const wander = 7 * n2.fbm(x * 0.013 - 3, z * 0.013 + 11, 3) * smoothstep(B.floor - 10, B.floor - 3, d) * (1 - smoothstep(R - 14, R - 3, d));
        const t = clamp((d + wander - B.floor) / B.wall, 0, 1);
        const w = 1 - (0.3 * smoothstep(0, 1, t) + 0.7 * t);
        const i = idx(ix, iz);
        // (dead level under and about the pad: a slab is laid on it)
        const level = floorY + 0.3 * n3.fbm(x * 0.02 + 5, z * 0.02, 3) * smoothstep(36, 44, d);
        heights[i] = lerp(heights[i], level + (heights[i] - level) * 0.12 * t, w);
      }
    }
    // And the hillside behind is cut back to a slope (see `side` and `reach` in src/sim/bunker.ts): wherever the
    // ground stands above a cone that rises from the edge of the level floor, it is brought down to it, rounded
    // into the hill where the two meet, and let go again toward the far edge of the reach. Nothing is raised.
    {
      const soft = (a: number, b: number, k: number) => {
        const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
        return lerp(b, a, h) - k * h * (1 - h);
      };
      const X = B.reach;
      for (let iz = Math.max(0, Math.floor((bz - X + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((bz + X + half) / CELL)); iz++) {
        for (let ix = Math.max(0, Math.floor((bx - X + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((bx + X + half) / CELL)); ix++) {
          const x = -half + ix * CELL, z = -half + iz * CELL;
          const d = Math.hypot(x - bx, z - bz);
          if (d <= B.floor || d >= X) continue;
          const i = idx(ix, iz);
          // (not ruled: a little steeper here, a little less there, as a hillside is)
          const cone = floorY + (d - B.floor) * B.side * (0.88 + 0.24 * (0.5 + 0.5 * n1.noise(x * 0.019 + 3, z * 0.019 - 7))) + 1.6 * n3.fbm(x * 0.05, z * 0.05 + 9, 3);
          if (heights[i] <= cone - 4) continue;
          const y = Math.min(heights[i], soft(heights[i], cone, 4));
          heights[i] = lerp(y, heights[i], smoothstep(X - 28, X, d));
        }
      }
      // (And what is left steeper than a hillside holds, where the cut meets the hill as it stood and along the
      // old wall's flanks, is let slump: a cell that stands over its neighbours by more than a walkable slope
      // comes down toward them. Down only, and only here.)
      for (let pass = 0; pass < 60; pass++) {
        for (let iz = Math.max(1, Math.floor((bz - X + half) / CELL)); iz <= Math.min(N - 2, Math.ceil((bz + X + half) / CELL)); iz++) {
          for (let ix = Math.max(1, Math.floor((bx - X + half) / CELL)); ix <= Math.min(N - 2, Math.ceil((bx + X + half) / CELL)); ix++) {
            const x = -half + ix * CELL, z = -half + iz * CELL;
            const d = Math.hypot(x - bx, z - bz);
            if (d <= B.floor + 4 || d >= X - 2) continue;
            const i = idx(ix, iz), h = heights[i];
            const lo = Math.min(heights[i - 1], heights[i + 1], heights[i - N], heights[i + N]);
            // (less and less toward the far edge of the reach, and nothing at it: the hill beyond is not moved, and
            // ground let down beside ground that is not would be a step)
            if (h - lo > 0.9 * CELL) heights[i] = lerp(h, lo + 0.9 * CELL, 0.5 * (1 - smoothstep(X - 70, X - 12, d)));
          }
        }
      }
    }
    sites.push({ name: B.name, kind: 'bunker', x: bx, z: bz, rot, later: true });
    pois.push({ name: B.name, x: bx, z: bz, radius: 40 });
    const local = (x: number, z: number): [number, number] => {
      const dx = x - bx, dz = z - bz;
      return [dx * Math.cos(rot) - dz * Math.sin(rot), dx * Math.sin(rot) + dz * Math.cos(rot)];
    };
    // What grew or lay there stays: it is the foot of a wooded hill, and is to look like nothing else. (It was cleared
    // to bare gravel, forty metres across, with a slab in the middle of it: a place nobody could miss.) Only what would
    // stand in the house, in its yard or in the way out of it goes, and what was left hanging on the cut hillside.
    for (const list of [trees, rocks, props]) {
      for (let k = list.length - 1; k >= 0; k--) {
        const t = list[k];
        const d = Math.hypot(t.x - bx, t.z - bz);
        if (d > Math.max(R + 2, B.reach)) continue;
        const [r, f] = local(t.x, t.z);
        if ((Math.abs(r) < 6.5 && f > 7.5 && f < 23) || slopeAt(heights, t.x, t.z) > 1.05) list.splice(k, 1);
        else t.y += heightAt(heights, t.x, t.z) - heightAt(before, t.x, t.z);
      }
    }
    // The ground is painted again where any of this reaches, as the hillside about it is painted: grass, and the
    // floor of a wood. Grass grows on all of it but the house's own floor and its yard.
    const P = Math.max(R, B.reach) + 6;
    for (let iz = Math.max(0, Math.floor((bz - P + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((bz + P + half) / CELL)); iz++)
      for (let ix = Math.max(0, Math.floor((bx - P + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((bx + P + half) / CELL)); ix++) {
        // (where the ground was moved, and a little about it: the rest is as it was painted)
        if (Math.hypot(-half + ix * CELL - bx, -half + iz * CELL - bz) > R + 6 && Math.abs(heights[idx(ix, iz)] - before[idx(ix, iz)]) < 0.02) continue;
        paint(ix, iz);
        const [r, f] = local(-half + ix * CELL, -half + iz * CELL);
        if (Math.abs(r) <= 3.8 && f >= B.hut.back - 1 && f <= B.court.front + 0.8) grass[idx(ix, iz)] = 0;
      }
    // That is the ground as it is seen (`surface`): the roof of the place lies level with it and is drawn as it is
    // (see BunkerSite), grass and all. Under that roof the ground itself is dug out, for the first level to stand in.
    surface = heights.slice();
    for (let iz = Math.max(0, Math.floor((bz - R + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((bz + R + half) / CELL)); iz++)
      for (let ix = Math.max(0, Math.floor((bx - R + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((bx + R + half) / CELL)); ix++) {
        const [r, f] = local(-half + ix * CELL, -half + iz * CELL);
        if (Math.abs(r) <= B.pit.r && f >= B.pit.back && f <= B.pit.front) heights[idx(ix, iz)] = floorY - B.depth - 0.3;
      }
  }

  yield 'the third expansion';
  // --- the third expansion (2026-10-10): the east country. The map grown to 1536 m gave a ring of upland
  // round the old one (planted above). Here the road is carried on out of the valley and a town is built on it,
  // Kamenka, of the buildings that were downloaded whole; and two places stand far out in the ring. By the
  // rule of the others: own dice, everything after what there was, and nothing inside the old square touched
  // (the road is picked up where it used to run off the ground, 28 m outside it).
  const roads: World['roads'] = [];
  {
    const T = TOWN;
    const rng4 = new RNG(seed + 9001);
    const first = buildings.length;
    const before = heights.slice();
    const cell = (x: number, z: number) => idx(clamp(Math.round((x + half) / CELL), 0, N - 1), clamp(Math.round((z + half) / CELL), 0, N - 1));

    // 1. level ground: for the town, and for each of the two places
    // The town's is a valley of its own (see kamenkaQ), as the old map lies in one. Its rim is raised: on the new
    // ground east and south of the town, where it runs up into the mountains of the edge, and on the old map's
    // hill west and north of it, where there was nothing but the hill. A way is left through it where the road
    // comes over from the old valley, wide enough that its sides are slopes and not walls. And its floor is level.
    valley = true;
    const through: [number, number][] = [...path2.filter(([x]) => x > 360), ...eastRoad()];
    // (And a second way is left through it where the road goes on out of the far end of the street: see LOOP. A
    // narrower one: sixty metres to either side, and the rim stands whole beyond. East of the street's end the rim
    // is all there is between the town and the edge of the ground.)
    const doorWay = catmullRom(doorRoad(), 4);
    const fromRoad = (x: number, z: number) => {
      let best = 1e9;
      for (let k = 0; k < through.length - 1; k++) {
        const [ax, az] = through[k], dx = through[k + 1][0] - ax, dz = through[k + 1][1] - az;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
      }
      return best;
    };
    const floorY = base(T.x, T.z), REACH = 345;
    for (let iz = Math.max(0, Math.floor((T.z - REACH + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((T.z + REACH + half) / CELL)); iz++) {
      for (let ix = Math.max(0, Math.floor((T.x - REACH + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((T.x + REACH + half) / CELL)); ix++) {
        const x = -half + ix * CELL, z = -half + iz * CELL, q = kamenkaQ(x, z);
        if (q >= KAMENKA.foot) continue;
        const i = idx(ix, iz);
        // (as high as a wood is tall three times over, and not the same height twice; where the mountains of the edge
        // already stand, whichever of the two is the higher)
        const crest = 38 + 16 * (0.5 + 0.5 * n1.noise(x * 0.011 - 7, z * 0.011 + 3)) + 5 * n3.fbm(x * 0.03, z * 0.03, 3);
        // (Inside the valley the rim is the only hill there is: the mountains of the edge begin again at its crest.
        // Left standing under it, they came down to the very edge of the floor east of the town, as a bare wall.)
        const edge = ringShape(x, z);
        heights[i] += Math.max(rimOf(q) * crest * smoothstep(18, 115, fromRoad(x, z)) * smoothstep(14, 62, offLine(doorWay, x, z)), edge * smoothstep(1.7, KAMENKA.crest, q)) - edge;
        const level = 1 - smoothstep(1.0, 1.32, q);
        if (level > 0) heights[i] = lerp(heights[i], floorY + 0.3 * n3.fbm(x * 0.02, z * 0.02, 3), level);
      }
    }
    for (const o of OUTLYING) flattenArea(o.x, o.z, 24, 52, 0.4);

    // 2. the road: on from its old end, round to the line of the town's street, down that, and away off the far
    // edge of the ground as the old one went off the old edge
    const ul = Math.hypot(T.street[0], T.street[1]), ux = T.street[0] / ul, uz = T.street[1] / ul;
    const rot = Math.atan2(ux, uz);
    const line = catmullRom(eastRoad(), 4);
    const raw = line.map(([x, z]) => heightAt(heights, x, z));
    const ys = raw.map((_, i) => {
      let sum = 0, c = 0;
      for (let k = -12; k <= 12; k++) {
        const w = 1 - Math.abs(k) / 13;
        sum += raw[clamp(i + k, 0, raw.length - 1)] * w;
        c += w;
      }
      return sum / c;
    });
    // The way over (see PASS): one even climb, from where the old road leaves the floor of its valley to where this
    // one comes onto the floor of the town's. The old road's last stretch is the first of it: its line is as it
    // was, point for point, and only its height is new.
    const i0 = path2.findIndex(([x]) => x >= PASS.from), j1 = line.findIndex(([x, z]) => kamenkaQ(x, z) <= 1);
    const way: [number, number][] = [...path2.slice(i0), ...line.slice(1, j1 + 1)];
    const run = [0];
    for (let k = 1; k < way.length; k++) run.push(run[k - 1] + Math.hypot(way[k][0] - way[k - 1][0], way[k][1] - way[k - 1][1]));
    // (it eases into the climb and out of it, over a twelfth of its length at each end)
    const ease = (t: number) => {
      const e = 0.08, v = 1 / (1 - e);
      return t < e ? (v * t * t) / (2 * e) : t > 1 - e ? 1 - (v * (1 - t) * (1 - t)) / (2 * e) : v * (t - e / 2);
    };
    const wy = run.map((r) => lerp(smooth[i0], raw[j1], ease(r / run[run.length - 1])));
    for (let k = i0; k < path2.length; k++) {
      smooth[k] = wy[k - i0];
      roadPts[k * 3 + 1] = wy[k - i0];
    }
    for (let j = 0; j <= j1; j++) ys[j] = wy[path2.length - 1 - i0 + j];
    // From there on it lies on the town's floor (its height taken from the floor alone: the hill behind it is no
    // part of it), and is a road: nowhere steeper than eight in a hundred. (Left to follow the ground it went up
    // the hill at the end of the street at one in four.) Where the ground is steeper it is cut into it, or banked up.
    for (let j = j1 + 1; j < line.length; j++) {
      let sum = 0, c = 0;
      for (let k = -12; k <= 12; k++) {
        const w = 1 - Math.abs(k) / 13;
        sum += raw[clamp(j + k, j1, raw.length - 1)] * w;
        c += w;
      }
      ys[j] = sum / c;
    }
    for (const from of [j1 + 1, line.length - 2]) {
      const dir = from === j1 + 1 ? 1 : -1;
      for (let i = from; i > j1 && i < line.length; i += dir) {
        const most = 0.08 * Math.hypot(line[i][0] - line[i - dir][0], line[i][1] - line[i - dir][1]);
        ys[i] = clamp(ys[i], ys[i - dir] - most, ys[i - dir] + most);
      }
    }
    // The hill is cut down to the way where it stands above it, and the ground banked up to it where it lies
    // below: level across for the road and its verges, and from there the sides stand as a wooded hillside
    // does, and are rounded off into the hill at the top of the cutting and the foot of the bank.
    const wd = new Float32Array(N * N).fill(1e9), wh = new Float32Array(N * N);
    rasterLine(way, wy, PASS.reach, wd, wh);
    const least = (a: number, b: number, k: number) => {
      const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
      return lerp(b, a, h) - k * h * (1 - h);
    };
    const back = [way[1][0] - way[0][0], way[1][1] - way[0][1]];
    // (How high the road is, for the laying back of the hill: not the height of the nearest of it, which is one thing
    // on one side of a line and another on the other wherever the road bends. Inside the bend above the town that was
    // a step of thirteen metres, a hundred metres from the road. Far from the road it is that height evened out over
    // the ground about.)
    const ws = evenOut(wh, (i) => wd[i] < PASS.reach, 15);
    for (let i = 0; i < N * N; i++) {
      const d = wd[i];
      if (d >= PASS.reach) continue;
      const x = -half + (i % N) * CELL, z = -half + Math.floor(i / N) * CELL;
      // (nothing behind where it begins: the road there is the old road, at its own height)
      if ((x - way[0][0]) * back[0] + (z - way[0][1]) * back[1] < 0) continue;
      // (the sides are not ruled: a little steeper here, a little less there)
      const uneven = 0.86 + 0.28 * (0.5 + 0.5 * n1.noise(x * 0.021 + 11, z * 0.021 - 5));
      const off = Math.max(0, d - PASS.bed) * PASS.side * uneven;
      // (The cutting, laid back: see PASS. A gentle rise for `open` metres and a hillside beyond; and the ground of it
      // heaves a little, as a wood's floor does, so that there is something to lie behind.)
      const out = Math.max(0, d - PASS.bed);
      // (Not the mountains of the map's edge: where those begin the hill is taken back no further than a verge's
      // width, and stands over it as steeply as a mountain does. Laid back, they were let down to a bank at the very
      // edge of the ground.)
      const lay = lerp(Math.min(out, PASS.open) * PASS.bench + Math.max(0, out - PASS.open) * PASS.lay, Math.min(out, PASS.keep) * PASS.bench + Math.max(0, out - PASS.keep) * PASS.wall, smoothstep(0.05, 0.3, edgeOf(x, z))) * uneven + 2.4 * n2.fbm(x * 0.027 - 4, z * 0.027 + 8, 3) * smoothstep(PASS.bed + 6, 42, d);
      const bed = wh[i] - 0.08, round = Math.min(3, off * 0.5) + 1e-6;
      // (and never less than it was taken back before it was laid back at all)
      let y = least(heights[i], Math.min(bed + off, lerp(wh[i], ws[i], smoothstep(12, 50, d)) - 0.08 + lay), Math.min(3, Math.max(0, lay) * 0.5) + 1e-6);
      y = -least(-y, off - bed, round);
      // (the verges, as along every road)
      y = lerp(y, bed, 1 - smoothstep(ROAD_W * 0.5 + 0.5, 16, d));
      // (and at the far edge of all this the hill is the hill again, whatever it took to get there)
      heights[i] = lerp(y, heights[i], smoothstep(PASS.reach - 20, PASS.reach, d));
      if (d < 16 && d <= roadDist[i] + 0.01) roadH[i] = wh[i];
    }
    const nd = new Float32Array(N * N).fill(1e9), nh = new Float32Array(N * N);
    rasterLine(line, ys, 16, nd, nh);
    for (let i = 0; i < N * N; i++) {
      if (nd[i] >= 16) continue;
      // (along the way over the verges are made already)
      if (wd[i] > nd[i] + 1) heights[i] = lerp(heights[i], nh[i] - 0.08, 1 - smoothstep(ROAD_W * 0.5 + 0.5, 16, nd[i]));
      if (nd[i] < roadDist[i]) {
        roadDist[i] = nd[i];
        roadH[i] = nh[i];
      }
    }
    const pts2 = new Float32Array(line.length * 3);
    line.forEach(([x, z], i) => pts2.set([x, ys[i], z], i * 3));
    roads.push({ points: pts2, width: ROAD_W });

    // 3. what is built. [type, right, forward, turn, weapons kept]: forward is down the street, away from the valley.
    // The brick blocks have their doors in their west walls (turn 0 on the right of the street, half a turn on the
    // left); everything else has its door in its front (a quarter turn to face the street).
    const Q = Math.PI / 2;
    const lay2 = (cx: number, cz: number, r: number, plan: [BuildingType, number, number, number, number][]) => {
      for (const [type, right, fwd, turn, arms] of plan) {
        const x = cx + right * Math.cos(r) + fwd * Math.sin(r), z = cz - right * Math.sin(r) + fwd * Math.cos(r);
        const [w, d] = BUILDING_FOOTPRINT[type];
        blocked.push({ x, z, r: Math.hypot(w, d) / 2 });
        buildings.push({ id: `${type}_${buildings.length}`, type, x, z, rot: r + turn, floorY: 0, seed: Math.floor(rng4.next() * 1e9), ...(arms ? { arms } : {}) });
      }
    };
    // (The downloaded buildings are most of it: eight of the brick blocks, three of the plank houses, four of the long
    // huts, in a town of twenty-six. The plank house and whatever has its door in its front face the street with a
    // quarter turn; the brick block's door is in its west wall.)
    lay2(T.x, T.z, rot, [
      // down the right of the street
      ['townhouse', 11.2, -62, 0, 0],
      ['store', 10.5, -44, -Q, 0],
      ['townhouse', 11.2, -27, 0, 0],
      ['shanty', 15.6, -9, -Q, 0],
      ['townhouse', 11.2, 10, 0, 0],
      ['police', 11.5, 30, -Q, 1],
      ['townhouse', 11.2, 49, 0, 0],
      ['garage', 10.5, 66, -Q, 0],
      // down the left of it
      ['clinic', -10.75, -62, Q, 0],
      ['townhouse', -11.2, -44, Math.PI, 0],
      ['townhouse', -11.2, -24, Math.PI, 0],
      ['hut', -9.6, -2, -Q, 0],
      ['townhouse', -11.2, 17, Math.PI, 0],
      ['shanty', -15.6, 37, Q, 0],
      ['townhouse', -11.2, 55, Math.PI, 0],
      ['house_two', -10.5, 72, Q, 0],
      // and behind them, either side
      ['hut', 36, -50, -Q, 0],
      ['shed', 30, -30, -Q, 0],
      ['shed', 31, 6, -Q, 0],
      ['barn', 38, 30, -Q, 0],
      ['hut', 36, 62, -Q, 0],
      ['hut', -34, -44, Q, 0],
      ['house_brick', -36, -12, Q, 0],
      ['house_small', -35, 14, Q, 0],
      ['barn', -38, 36, Q, 0],
      ['shanty', -42, 60, Q, 0],
    ]);
    sites.push({ name: T.name, kind: 'town', x: T.x, z: T.z, rot, later: true });
    pois.push({ name: T.name, x: T.x, z: T.z, radius: 95 });
    const OUT_PLAN: Record<'squat' | 'camp', [BuildingType, number, number, number, number][]> = {
      squat: [['shanty', 0, 0, 0, 0]],
      camp: [['hut', -10, -6, 0, 0], ['hut', 12, 8, Q, 0], ['shed', -14, 12, 0.4, 0]],
    };
    for (const o of OUTLYING) {
      lay2(o.x, o.z, o.rot, OUT_PLAN[o.kind]);
      sites.push({ name: o.name, kind: o.kind, x: o.x, z: o.z, rot: o.rot, later: true });
      pois.push({ name: o.name, x: o.x, z: o.z, radius: 40 });
    }
    const added = buildings.slice(first);
    for (const b of added) seat(b);
    for (const b of added) pad(b, 3.2, 2.2);
    // (and once more, close in: they stand five metres apart down the street, and a neighbour's skirt reached the next one's wall)
    for (const b of added) pad(b, 2.0, 1.6);

    // 4. What grows in the valley. Everything that grew there is taken up, the old map's trees on that hill too (it
    // is another hill now), and it is planted again by the rule as it is there now: the rim wooded, the floor the town's.
    const inAdded = (x: number, z: number, margin: number) =>
      added.some((b) => {
        const [w, d] = BUILDING_FOOTPRINT[b.type];
        const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), sn = Math.sin(b.rot);
        return Math.abs(dx * c - dz * sn) < w / 2 + margin && Math.abs(dx * sn + dz * c) < d / 2 + margin;
      });
    for (let k = trees.length - 1; k >= 0; k--) {
      const t = trees[k];
      if (kamenkaQ(t.x, t.z) < KAMENKA.foot || (!(Math.abs(t.x) <= OLD_HALF && Math.abs(t.z) <= OLD_HALF) && OUTLYING.some((o) => Math.hypot(t.x - o.x, t.z - o.z) < 24))) trees.splice(k, 1);
      else if (OUTLYING.some((o) => Math.hypot(t.x - o.x, t.z - o.z) < 62)) t.y = heightAt(heights, t.x, t.z);
    }
    for (let gz = T.z - REACH; gz < T.z + REACH; gz += TREE_STEP) {
      for (let gx = T.x - REACH; gx < T.x + REACH; gx += TREE_STEP) {
        const hx = hash2(Math.round(gx * 10), Math.round(gz * 10), seed + 51);
        const hz = hash2(Math.round(gz * 10), Math.round(gx * 10), seed + 57);
        const x = gx + (hx - 0.5) * TREE_STEP * 0.9, z = gz + (hz - 0.5) * TREE_STEP * 0.9;
        if (kamenkaQ(x, z) >= KAMENKA.foot || Math.abs(x) > half - 8 || Math.abs(z) > half - 8) continue;
        const i = cell(x, z);
        if (roadDist[i] < ROAD_W / 2 + 4 || trackDist[i] < 3 || inAdded(x, z, 4) || slopeAt(heights, x, z) > 1.05) continue;
        const f = forestMask(x, z), hv = hash2(Math.round(x * 7), Math.round(z * 7), seed + 53), y = heightAt(heights, x, z);
        if (f > 0.08) {
          if (hv > smoothstep(0.08, 0.3, f) * 0.85) continue;
          let kind: string;
          if (f < 0.2 && hv < 0.4) kind = hv < 0.16 ? 'bush_a' : hv < 0.27 ? 'bush_b' : 'birch_a';
          else if (hv < 0.11) kind = 'birch_b';
          else kind = pines[Math.floor(hash2(Math.round(x), Math.round(z), 5) * pines.length)];
          trees.push({ kind, x, y, z, rot: hx * Math.PI * 2, scale: 0.85 + hz * 0.35 });
        } else if (f > -0.25 && hv < 0.025) {
          trees.push({ kind: hv < 0.01 ? 'oak_a' : hv < 0.018 ? 'ash_a' : 'birch_a', x, y, z, rot: hx * Math.PI * 2, scale: 0.9 + hz * 0.3 });
        } else if (f > -0.15 && hv > 0.97) {
          trees.push({ kind: hv > 0.985 ? 'bush_a' : 'bush_b', x, y, z, rot: hx * Math.PI * 2, scale: 0.8 + hz * 0.5 });
        }
      }
    }
    // and what lay on that hill: gone from the floor and the road, and the rest on the ground as it is now
    for (const list of [rocks, props]) {
      for (let k = list.length - 1; k >= 0; k--) {
        const t = list[k], q = kamenkaQ(t.x, t.z);
        if (q >= KAMENKA.foot) continue;
        if (q < 1.25 || roadDist[cell(t.x, t.z)] < ROAD_W / 2 + 2 || inAdded(t.x, t.z, 2.5)) list.splice(k, 1);
        else t.y += heightAt(heights, t.x, t.z) - heightAt(before, t.x, t.z);
      }
    }

    // and along the way over, west of that hill: whatever grew or lay where the ground was cut or banked stands on
    // the ground as it is now
    for (const list of [trees, rocks, props]) {
      for (let k = list.length - 1; k >= 0; k--) {
        const t = list[k], i = cell(t.x, t.z);
        if (wd[i] >= PASS.reach || kamenkaQ(t.x, t.z) < KAMENKA.foot) continue;
        if (wd[i] < ROAD_W / 2 + 2) list.splice(k, 1);
        else t.y += heightAt(heights, t.x, t.z) - heightAt(before, t.x, t.z);
      }
    }

    // 5. rocks and what lies in the woods, over all the new country: dice of their own
    const rockKinds2 = ['rock_moss_set_01', 'rock_moss_set_02'];
    for (let k = 0; k < 1500; k++) {
      const x = rng4.range(-half + 14, half - 14), z = rng4.range(-half + 14, half - 14);
      const roll = rng4.next(), turn = rng4.range(0, 6.28), size = rng4.next(), which = rng4.int(0, 5), set = rng4.pick(rockKinds2);
      if (Math.abs(x) <= OLD_HALF + 2 && Math.abs(z) <= OLD_HALF + 2) continue;
      if (roadDist[cell(x, z)] < ROAD_W / 2 + 2 || insideBuilding(x, z, 2) || kamenkaQ(x, z) < 1.25 || OUTLYING.some((o) => Math.hypot(x - o.x, z - o.z) < 20)) continue;
      const f = forestMask(x, z), y = heightAt(heights, x, z), slope = slopeAt(heights, x, z);
      if (f > 0.1) {
        if (roll < 0.45) props.push({ kind: 'fern_02', x, y, z, rot: turn, scale: 0.8 + size * 0.5 });
        else if (roll < 0.6) rocks.push({ kind: `${set}#${which}`, x, y: y - 0.15, z, rot: turn, scale: 0.6 + size * 0.8 });
        else if (roll < 0.68) props.push({ kind: 'dry_branches_medium_01', x, y, z, rot: turn, scale: 0.8 + size * 0.4 });
        else if (roll < 0.74) props.push({ kind: 'tree_stump_01', x, y: y - 0.05, z, rot: turn, scale: 0.8 + size * 0.4 });
        else if (roll < 0.79) props.push({ kind: 'dead_tree_trunk', x, y: y - 0.05, z, rot: turn, scale: 0.9 + size * 0.4 });
      } else if (slope > 0.35 && roll < 0.5) {
        rocks.push({ kind: roll < 0.1 ? 'boulder_01' : `${set}#${which}`, x, y: y - 0.25, z, rot: turn, scale: 1 + size * 1.2 });
      } else if (roll < 0.04 && f > -0.2) {
        rocks.push({ kind: `${set}#${which}`, x, y: y - 0.1, z, rot: turn, scale: 0.4 + size * 0.5 });
      }
    }

    // 6. and the ground is painted again wherever any of this reaches (and is the ground that is seen, there)
    const again = new Set<number>();
    const mark = (cx: number, cz: number, r: number) => {
      for (let iz = Math.max(0, Math.floor((cz - r + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((cz + r + half) / CELL)); iz++)
        for (let ix = Math.max(0, Math.floor((cx - r + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((cx + r + half) / CELL)); ix++) again.add(iz * N + ix);
    };
    for (let iz = Math.max(0, Math.floor((T.z - REACH + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((T.z + REACH + half) / CELL)); iz++)
      for (let ix = Math.max(0, Math.floor((T.x - REACH + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((T.x + REACH + half) / CELL)); ix++)
        if (kamenkaQ(-half + ix * CELL, -half + iz * CELL) < KAMENKA.foot + 0.05) again.add(iz * N + ix);
    for (const o of OUTLYING) mark(o.x, o.z, 62);
    for (const [x, z] of line) mark(x, z, 19);
    for (const [x, z] of way) mark(x, z, PASS.reach + 3);
    for (const b of added) mark(b.x, b.z, 24);
    for (const k of again) {
      paint(k % N, Math.floor(k / N));
      if (surface) surface[k] = heights[k];
    }
  }

  yield 'a second clinic and a second shop in the village';
  // --- a second clinic and a second shop in the village (2026-10-11). Asked: "we should space out the police
  // station from the store from the medical clinic, theyre all right next to eachother, i think if we spaced them
  // out it would be more meaningful to their specific loot pools", and, when the first ones were moved to do it:
  // "why remove the house entirely instead of just add more ... maintaining both locations". So the first stand
  // where they stood, and there is another of each: the clinic at the east end of the village street and the shop
  // at the west end, a hundred and more metres from the police station and from one another. They come after
  // every building there is, so that none is renumbered; they take nothing from anybody's dice (they have their
  // own), and the ground is levelled under them and cleared as it was for the first.
  {
    const first = buildings.length;
    const before = heights.slice();
    const rng5 = new RNG(seed + 6161);
    const cell = (x: number, z: number) => idx(clamp(Math.round((x + half) / CELL), 0, N - 1), clamp(Math.round((z + half) / CELL), 0, N - 1));
    const reach = (type: BuildingType) => Math.hypot(...BUILDING_FOOTPRINT[type]) / 2;
    const free = (type: BuildingType, x: number, z: number) => {
      const r = reach(type);
      if (buildings.some((b) => Math.hypot(b.x - x, b.z - z) < reach(b.type) + r + 5)) return false;
      return roadNearest(x, z).d >= r + ROAD_W / 2 + 2.5 && trackDist[cell(x, z)] >= r + 3 && slopeAt(heights, x, z) < 0.22;
    };
    // at one end of the village street, as near `SERVICES.out` metres from its middle as there is room: its door to the road
    const atEnd = (type: BuildingType, back: number, east: boolean) => {
      const order = path2
        .map((q, i) => ({ i, d: Math.hypot(q[0] - VILLAGE.x, q[1] - VILLAGE.z) }))
        .filter((q) => q.d > SERVICES.from && q.d < SERVICES.to && q.i < path2.length - 1 && path2[q.i][0] > VILLAGE.x === east)
        .sort((a, b) => Math.abs(a.d - SERVICES.out) - Math.abs(b.d - SERVICES.out));
      for (const { i } of order) {
        const [x, z] = path2[i], [nx, nz] = path2[i + 1];
        const tl = Math.hypot(nx - x, nz - z);
        const px = -(nz - z) / tl, pz = (nx - x) / tl;
        const off = back + BUILDING_FOOTPRINT[type][1] / 2 + ROAD_W / 2;
        for (const side of [1, -1]) {
          const bx = x + px * off * side, bz = z + pz * off * side;
          if (!free(type, bx, bz)) continue;
          buildings.push({ id: `${type}_${buildings.length}`, type, x: bx, z: bz, rot: Math.atan2(-px * side, -pz * side), floorY: 0, seed: Math.floor(rng5.next() * 1e9) });
          return true;
        }
      }
      return false;
    };
    atEnd('clinic', 9, true);
    atEnd('store', 8, false);
    const added = buildings.slice(first);
    for (const b of added) seat(b);
    for (const b of buildings) if (added.some((n) => n === b || Math.hypot(n.x - b.x, n.z - b.z) < reach(n.type) + reach(b.type) + 9.5)) pad(b, 3.2, 2.2);
    // what grew or lay where one now stands goes, and what is left about it stands on the ground as it is now
    const inAdded = (x: number, z: number, margin: number) =>
      added.some((b) => {
        const [w, d] = BUILDING_FOOTPRINT[b.type];
        const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), sn = Math.sin(b.rot);
        return Math.abs(dx * c - dz * sn) < w / 2 + margin && Math.abs(dx * sn + dz * c) < d / 2 + margin;
      });
    for (const list of [trees, rocks, props]) {
      for (let k = list.length - 1; k >= 0; k--) {
        const t = list[k];
        if (!added.some((b) => Math.hypot(b.x - t.x, b.z - t.z) < 30)) continue;
        if (inAdded(t.x, t.z, list === trees ? 4 : 2.5)) list.splice(k, 1);
        else t.y += heightAt(heights, t.x, t.z) - heightAt(before, t.x, t.z);
      }
    }
    // and the ground is painted again wherever this reaches
    const again = new Set<number>();
    for (const b of added)
      for (let iz = Math.max(0, Math.floor((b.z - 24 + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((b.z + 24 + half) / CELL)); iz++)
        for (let ix = Math.max(0, Math.floor((b.x - 24 + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((b.x + 24 + half) / CELL)); ix++) again.add(iz * N + ix);
    for (const k of again) {
      paint(k % N, Math.floor(k / N));
      if (surface) surface[k] = heights[k];
    }
  }

  yield 'the district hospital';
  // --- the district hospital, in Kamenka (2026-10-11): three floors and a roof, the biggest building there is
  // (src/world/big-buildings.ts). It stands on the east edge of the town's floor, behind the right-hand row of the
  // street, its long front to the street and its door opposite the way through between the plank house and the
  // brick block. After every building there was: none is renumbered. The ground under it is the floor's, level
  // already; what grew or lay there goes.
  {
    const before = heights.slice();
    const rng6 = new RNG(seed + 7373);
    const cell = (x: number, z: number) => idx(clamp(Math.round((x + half) / CELL), 0, N - 1), clamp(Math.round((z + half) / CELL), 0, N - 1));
    const [sx, sz] = TOWN.street, street = Math.atan2(sx, sz);
    const inTown = (right: number, along: number): [number, number] => [TOWN.x + right * sz + along * sx, TOWN.z - right * sx + along * sz];
    const [hx, hz] = inTown(HOSPITAL_AT.right, HOSPITAL_AT.along);
    const hosp: BuildingPlot = { id: `hospital_${buildings.length}`, type: 'hospital', x: hx, z: hz, rot: street - Math.PI / 2, floorY: 0, seed: Math.floor(rng6.next() * 1e9) };
    buildings.push(hosp);
    const reach = (type: BuildingType) => Math.hypot(...BUILDING_FOOTPRINT[type]) / 2;
    seat(hosp);

    // Its grounds (see HOSPITAL_GROUNDS). `out`: from its own measure to the map's; `own`: the other way.
    const G = HOSPITAL_GROUNDS, hc = Math.cos(hosp.rot), hs = Math.sin(hosp.rot), padY = hosp.floorY - 0.08;
    const out = (lx: number, lz: number): [number, number] => [hosp.x + lx * hc + lz * hs, hosp.z - lx * hs + lz * hc];
    const own = (x: number, z: number): [number, number] => [(x - hosp.x) * hc - (z - hosp.z) * hs, (x - hosp.x) * hs + (z - hosp.z) * hc];
    const R = reach('hospital') + 34;
    const cells = (fn: (i: number, x: number, z: number) => void) => {
      for (let iz = Math.max(0, Math.floor((hosp.z - R + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((hosp.z + R + half) / CELL)); iz++)
        for (let ix = Math.max(0, Math.floor((hosp.x - R + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((hosp.x + R + half) / CELL)); ix++) fn(iz * N + ix, -half + ix * CELL, -half + iz * CELL);
    };
    // the yard
    /** how far a spot (in the hospital's measure) is outside the yard: 0 in it */
    const offYard = (lx: number, lz: number) => Math.min(...G.yard.map(([x0, x1, z0, z1]) => Math.hypot(Math.max(0, x0 - lx, lx - x1), Math.max(0, z0 - lz, lz - z1))));
    cells((i, x, z) => {
      const e = offYard(...own(x, z));
      if (e < G.ease) heights[i] = lerp(heights[i], padY, 1 - smoothstep(0, G.ease, e));
    });
    const stood: BuildingPlot[] = [hosp];
    // its other parts: after it in the list, on its floor's level
    for (const [type, lx, lz] of G.parts) {
      const [x, z] = out(lx, lz);
      const q: BuildingPlot = { id: `${type}_${buildings.length}`, type, x, z, rot: hosp.rot, floorY: hosp.floorY, seed: Math.floor(rng6.next() * 1e9) };
      buildings.push(q);
      pad(q, 6, 0.3);
      stood.push(q);
    }
    // what stood in the way of it, stood again (each is the building it was, in the place of the list it had)
    for (const [id, lx, lz, turn] of G.moved) {
      const q = buildings.find((o) => o.id === id);
      if (!q) throw new Error(`the hospital's grounds name ${id}, and there is no such building`);
      [q.x, q.z] = out(lx, lz);
      q.rot = hosp.rot + turn;
      seat(q);
      stood.push(q);
    }
    // the drive: its height the street's where it leaves it, and the yard's from the backs of the houses on
    const line = hospitalDrive(ROAD_W).map(([lx, lz]) => out(lx, lz));
    const streetY = roadH[cell(line[0][0], line[0][1])];
    let gone = 0;
    const ys = line.map(([x, z], i) => {
      if (i) gone += Math.hypot(x - line[i - 1][0], z - line[i - 1][1]);
      return lerp(streetY, padY + 0.08, smoothstep(1, 17, gone));
    });
    const dd = new Float32Array(N * N).fill(1e9), dh = new Float32Array(N * N);
    rasterLine(line, ys, 10, dd, dh);
    cells((i) => {
      if (dd[i] >= 8) return;
      // (not the street's own bed, where the drive leaves it)
      const w = (1 - smoothstep(G.drive / 2 + 0.4, 8, dd[i])) * smoothstep(ROAD_W / 2 - 0.4, ROAD_W / 2 + 1.2, roadDist[i]);
      heights[i] = lerp(heights[i], dh[i] - 0.08, w);
    });
    for (const b of buildings) if (stood.some((n) => n === b || Math.hypot(n.x - b.x, n.z - b.z) < reach(n.type) + reach(b.type) + 9.5)) pad(b, 3.2, 2.2);
    cells((i) => {
      if (dd[i] >= 10) return;
      // (a drive narrower than the road: the ground is painted by how far a spot is from a road as wide as that one)
      const d = dd[i] + (ROAD_W - G.drive) / 2;
      if (d < roadDist[i]) {
        roadDist[i] = d;
        roadH[i] = dh[i];
      }
    });
    {
      const pts = new Float32Array(line.length * 3);
      line.forEach(([x, z], i) => pts.set([x, heightAt(heights, x, z) + 0.08, z], i * 3));
      roads.push({ points: pts, width: G.drive, side: true });
    }
    // bare ground, painted as a track is
    for (const [ax, az, bx, bz] of G.bare) rasterLine([out(ax, az), out(bx, bz)], null, 4, trackDist, trackH);

    const inStood = (x: number, z: number, margin: number) =>
      stood.some((b) => {
        const [w, d] = BUILDING_FOOTPRINT[b.type];
        const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), sn = Math.sin(b.rot);
        return Math.abs(dx * c - dz * sn) < w / 2 + margin && Math.abs(dx * sn + dz * c) < d / 2 + margin;
      });
    // what grew or lay in the yard goes; what is left about it stands on the ground as it is now
    for (const list of [trees, rocks, props]) {
      for (let k = list.length - 1; k >= 0; k--) {
        const t = list[k];
        if (Math.hypot(hosp.x - t.x, hosp.z - t.z) > R) continue;
        if (inStood(t.x, t.z, list === trees ? 4 : 2.5) || offYard(...own(t.x, t.z)) < (list === trees ? 2 : 0.5) || dd[cell(t.x, t.z)] < G.drive / 2 + (list === trees ? 3 : 1.5)) list.splice(k, 1);
        else t.y += heightAt(heights, t.x, t.z) - heightAt(before, t.x, t.z);
      }
    }
    for (const [lx, lz] of G.trees) {
      const [x, z] = out(lx, lz);
      trees.push({ kind: 'birch_a', x, y: heightAt(heights, x, z), z, rot: rng6.next() * Math.PI * 2, scale: 0.9 + rng6.next() * 0.3 });
    }
    cells((i, x, z) => {
      paint(Math.round((x + half) / CELL), Math.round((z + half) / CELL));
      if (surface) surface[i] = heights[i];
    });
  }

  yield 'the village laid out as a place is';
  // --- the village laid out as a place is (2026-10-12). Asked: "we will need to make the building layout in the
  // village more tightly packed i presume, or add some cross streets like a real city would have. we should really
  // take some time here with the map layout and ensure high quality, the buildings are all facing the proper way
  // etc... think about natural city look, realistic."
  //
  // What there was: the road, a row of houses either side of it fifteen and twenty metres back, and behind them
  // barns, sheds and three downloaded buildings dropped by the dice and turned any way at all. What there is:
  //   - the houses of the two rows stand seven metres from the road's edge, each with its door to it;
  //   - two side streets leave the road at a right angle. The one in the middle of the village crosses it, between
  //     the clinic and the brick house to the north and between the police station's yard and the shop to the
  //     south; the one at its west end goes south only. A lane of bare earth joins their far ends behind the
  //     houses, so that the south of the village is a block with a way all round it;
  //   - everything that stood behind the rows stands on one of those streets, its door to it;
  //   - the police headquarters (src/world/big-buildings.ts) stands across the far end of the middle street,
  //     looking back up it to the road: the last building of the village, and the last of all.
  // Nothing is renumbered: every building is the one it was, in the place of the list it had, with its own dice.
  // It is only stood somewhere else, and so what is kept in it is kept there. (The ground where one stood is
  // left level, as a yard is.) This block comes after everything, and takes nothing from anybody's dice.
  {
    const before = heights.slice();
    const rng7 = new RNG(seed + 8282);
    const LANE = VILLAGE_STREETS.width;
    // the road, by how far along it a spot is from the village's middle (east is on)
    let mid = 0;
    path2.forEach(([x, z], i) => {
      if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < Math.hypot(path2[mid][0] - VILLAGE.x, path2[mid][1] - VILLAGE.z)) mid = i;
    });
    const run = path2.map(() => 0);
    for (let i = mid + 1; i < path2.length; i++) run[i] = run[i - 1] + Math.hypot(path2[i][0] - path2[i - 1][0], path2[i][1] - path2[i - 1][1]);
    for (let i = mid - 1; i >= 0; i--) run[i] = run[i + 1] - Math.hypot(path2[i][0] - path2[i + 1][0], path2[i][1] - path2[i + 1][1]);
    /** the road at `s` metres along: where, how high, and which way it runs (a unit) */
    const at = (s: number) => {
      let i = mid;
      while (i < path2.length - 2 && run[i + 1] < s) i++;
      while (i > 0 && run[i] > s) i--;
      const t = clamp((s - run[i]) / (run[i + 1] - run[i] || 1), 0, 1);
      const tx = path2[i + 1][0] - path2[i][0], tz = path2[i + 1][1] - path2[i][1], tl = Math.hypot(tx, tz) || 1;
      return { x: lerp(path2[i][0], path2[i + 1][0], t), z: lerp(path2[i][1], path2[i + 1][1], t), y: lerp(smooth[i], smooth[i + 1], t), tx: tx / tl, tz: tz / tl };
    };

    // 1. the side streets. Each arm is a road of its own that begins under the edge of the road's asphalt (the two
    // ribbons never cross: two faces in one plane flicker) and ends where its last plot does.
    const laneDist = new Float32Array(N * N).fill(1e9), laneH = new Float32Array(N * N);
    const frames = new Map<string, { x: number; z: number; ex: number; ez: number; dx: number; dz: number }>();
    for (const [name, st] of Object.entries(VILLAGE_STREETS.streets)) {
      const j = at(st.s);
      // (south of the road is to the left of the way it runs)
      const dx = -j.tz, dz = j.tx;
      frames.set(name, { x: j.x, z: j.z, ex: j.tx, ez: j.tz, dx, dz });
      for (const [len, sign] of [[st.north, -1], [st.south, 1]] as [number, number][]) {
        if (len <= 0) continue;
        const from = ROAD_W / 2 - 1.1, n = Math.ceil((len - from) / 4);
        const line: [number, number][] = [];
        for (let k = 0; k <= n; k++) {
          const t = sign * (from + ((len - from) * k) / n);
          line.push([j.x + dx * t, j.z + dz * t]);
        }
        // its height: the ground's along it, evened out, from the road's own where it leaves it; nowhere steeper
        // than one in ten
        const raw = line.map(([x, z]) => heightAt(heights, x, z));
        const ys = raw.map((_, i) => {
          let sum = 0, c = 0;
          for (let k = -4; k <= 4; k++) {
            const w = 1 - Math.abs(k) / 5;
            sum += raw[clamp(i + k, 0, raw.length - 1)] * w;
            c += w;
          }
          return sum / c;
        });
        ys[0] = j.y;
        ys[1] = lerp(j.y, ys[1], 0.5);
        for (let i = 1; i < ys.length; i++) {
          const most = 0.1 * Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
          ys[i] = clamp(ys[i], ys[i - 1] - most, ys[i - 1] + most);
        }
        rasterLine(line, ys, 12, laneDist, laneH);
        const pts = new Float32Array(line.length * 3);
        line.forEach(([x, z], i) => pts.set([x, ys[i], z], i * 3));
        roads.push({ points: pts, width: LANE, side: true });
      }
    }
    /** the bed of the side streets, cut or banked: level across, and the verge eased into the ground over `to` metres */
    const bed = (to: number) => {
      for (let i = 0; i < N * N; i++) {
        if (laneDist[i] >= to) continue;
        // (not the road's own bed, where a street leaves it)
        const w = (1 - smoothstep(LANE / 2 + 0.4, to, laneDist[i])) * smoothstep(ROAD_W / 2 - 0.4, ROAD_W / 2 + 1.2, roadDist[i]);
        heights[i] = lerp(heights[i], laneH[i] - 0.08, w);
      }
    };
    bed(9);

    // 2. the lane behind the houses: bare earth, from the foot of the one street to the other
    const backLane: [number, number][] = [];
    {
      const a = frames.get('west')!, b = frames.get('middle')!, t = VILLAGE_STREETS.streets.west.south;
      const from: [number, number] = [a.x + a.dx * t, a.z + a.dz * t], to: [number, number] = [b.x + b.dx * t - b.ex * (LANE / 2 - 0.5), b.z + b.dz * t - b.ez * (LANE / 2 - 0.5)];
      const len = Math.hypot(to[0] - from[0], to[1] - from[1]), n = Math.ceil(len / 4);
      for (let k = 0; k <= n; k++) backLane.push([lerp(from[0], to[0], k / n), lerp(from[1], to[1], k / n)]);
    }
    const backDist = new Float32Array(N * N).fill(1e9), backH = new Float32Array(N * N);
    {
      const raw = backLane.map(([x, z]) => heightAt(heights, x, z));
      const ys = raw.map((_, i) => {
        let sum = 0, c = 0;
        for (let k = -3; k <= 3; k++) {
          const w = 1 - Math.abs(k) / 4;
          sum += raw[clamp(i + k, 0, raw.length - 1)] * w;
          c += w;
        }
        return sum / c;
      });
      rasterLine(backLane, ys, 8, backDist, backH);
      for (let i = 0; i < N * N; i++) {
        if (backDist[i] >= 8) continue;
        heights[i] = lerp(heights[i], backH[i], (1 - smoothstep(1.5, 8, backDist[i])) * 0.7 * smoothstep(LANE / 2, LANE / 2 + 2, laneDist[i]));
        if (backDist[i] < trackDist[i]) trackDist[i] = backDist[i];
      }
    }

    // 3. where everything stands. [which building, on what, how far along it, how far its front is from the edge]
    //   N, S        the road: its north side, its south side; along = metres along the road from the village's middle
    //   <street>E/W a side street: its east side, its west; along = metres from the road (south is on, north is back)
    const moved: BuildingPlot[] = [];
    /** how high the street is where each stands on it */
    const level = new Map<BuildingPlot, number>();
    const cellOf = (x: number, z: number) => idx(clamp(Math.round((x + half) / CELL), 0, N - 1), clamp(Math.round((z + half) / CELL), 0, N - 1));
    const stand = (b: BuildingPlot, cx: number, cz: number, fx: number, fz: number, off: number, lvl: number) => {
      level.set(b, lvl);
      // (the brick block's door is in its west wall: it is its west wall that looks at the street)
      const side = b.type === 'townhouse';
      const depth = BUILDING_FOOTPRINT[b.type][side ? 0 : 1];
      b.x = cx - fx * (off + depth / 2);
      b.z = cz - fz * (off + depth / 2);
      b.rot = side ? Math.atan2(fz, -fx) : Math.atan2(fx, fz);
      moved.push(b);
    };
    const built = VILLAGE_STREETS.more.map(([type]): BuildingPlot => {
      const b: BuildingPlot = { id: `${type}_${buildings.length}`, type, x: 0, z: 0, rot: 0, floorY: 0, seed: Math.floor(rng7.next() * 1e9) };
      buildings.push(b);
      return b;
    });
    for (const [k, [id, on, along, back]] of [...VILLAGE_STREETS.plots, ...VILLAGE_STREETS.more].entries()) {
      const b = k < VILLAGE_STREETS.plots.length ? buildings.find((q) => q.id === id) : built[k - VILLAGE_STREETS.plots.length];
      if (!b) throw new Error(`the village's plan names ${id}, and there is no such building`);
      if (on === 'N' || on === 'S') {
        const p = at(along), k = on === 'S' ? 1 : -1;
        // (its front looks back at the road)
        stand(b, p.x - p.tz * k * (ROAD_W / 2), p.z + p.tx * k * (ROAD_W / 2), p.tz * k, -p.tx * k, back, p.y);
      } else if (on.endsWith('Head') || on.endsWith('Foot')) {
        // (across the end of a side street, its front to the street: as the headquarters stands at the middle one's foot)
        const name = on.slice(0, -4), f = frames.get(name)!, st = VILLAGE_STREETS.streets[name], k = on.endsWith('Foot') ? 1 : -1;
        const end = k > 0 ? st.south : -st.north, t = end + k * back;
        stand(b, f.x + f.dx * t, f.z + f.dz * t, -f.dx * k, -f.dz * k, 0, laneH[cellOf(f.x + f.dx * end, f.z + f.dz * end)]);
      } else {
        const f = frames.get(on.slice(0, -1))!, k = on.endsWith('E') ? 1 : -1;
        stand(b, f.x + f.dx * along + f.ex * k * (LANE / 2), f.z + f.dz * along + f.ez * k * (LANE / 2), -f.ex * k, -f.ez * k, back, laneH[cellOf(f.x + f.dx * along, f.z + f.dz * along)]);
      }
    }
    // and the headquarters, across the foot of the middle street
    {
      const f = frames.get('middle')!, t = VILLAGE_STREETS.streets.middle.south + VILLAGE_STREETS.forecourt;
      const b: BuildingPlot = { id: `police_hq_${buildings.length}`, type: 'police_hq', x: 0, z: 0, rot: 0, floorY: 0, seed: Math.floor(rng7.next() * 1e9), arms: 6 };
      buildings.push(b);
      const foot = VILLAGE_STREETS.streets.middle.south;
      stand(b, f.x + f.dx * t, f.z + f.dz * t, -f.dx, -f.dz, 0, laneH[cellOf(f.x + f.dx * foot, f.z + f.dz * foot)]);
    }
    sorted = -1;
    // Each stands a step above its street, whatever the ground did there: where the ground climbs away from the
    // street it is cut back behind the house, as a builder does, and the way from the street to the door is level.
    // (Stood on the ground as it lay, a house seven metres from the road was two metres above it, up a bank.)
    for (const b of moved) {
      const [w, d] = BUILDING_FOOTPRINT[b.type], c = Math.cos(b.rot), sn = Math.sin(b.rot);
      let sum = 0, cnt = 0;
      for (let lz = -d / 2; lz <= d / 2; lz += 1) for (let lx = -w / 2; lx <= w / 2; lx += 1) {
        sum += heightAt(heights, b.x + lx * c + lz * sn, b.z - lx * sn + lz * c);
        cnt++;
      }
      const lvl = level.get(b)!;
      b.floorY = clamp(sum / cnt + 0.35, lvl + 0.3, lvl + 0.6);
      // (the headquarters in a yard of its own: level for a few paces all round it, and the bank beyond an easy one)
      if (b.type === 'police_hq') pad(b, 16, 5);
      else pad(b, 6, 0.3);
    }
    // The headquarters' other two parts, either side of the yard the street runs into (see POLICE_PARTS): after it
    // in the list, on its floor's level.
    const hq = buildings.find((b) => b.type === 'police_hq')!;
    const ofHq = (b: BuildingPlot) => b.type === 'police_hq' || POLICE_PARTS.some(([type]) => type === b.type);
    for (const [type, lx, lz] of POLICE_PARTS) {
      const qc = Math.cos(hq.rot), qs = Math.sin(hq.rot);
      const q: BuildingPlot = { id: `${type}_${buildings.length}`, type, x: hq.x + lx * qc + lz * qs, z: hq.z - lx * qs + lz * qc, rot: hq.rot, floorY: hq.floorY, seed: Math.floor(rng7.next() * 1e9) };
      buildings.push(q);
      pad(q, 9, 3);
      moved.push(q);
    }
    const reach = (type: BuildingType) => Math.hypot(...BUILDING_FOOTPRINT[type]) / 2;
    for (const b of buildings) if (!ofHq(b) && moved.some((n) => n === b || Math.hypot(n.x - b.x, n.z - b.z) < reach(n.type) + reach(b.type) + 9.5)) pad(b, 3.2, 2.2);
    // (a house's skirt reaches the street beside it: the street is level across, whatever stands by it)
    bed(LANE / 2 + 1.6);
    for (const b of moved) if (!ofHq(b)) pad(b, 2.0, 1.6);
    // (and the yard between the headquarters' wings is the headquarters' level, to which the street comes up)
    for (const b of moved) if (ofHq(b) && b !== hq) pad(b, 6, 2.5);
    for (let i = 0; i < N * N; i++) {
      if (laneDist[i] >= 12) continue;
      // (a street narrower than the road: the ground is painted by how far a spot is from a road as wide as that one)
      const d = laneDist[i] + (ROAD_W - LANE) / 2;
      if (d < roadDist[i]) {
        roadDist[i] = d;
        roadH[i] = laneH[i];
      }
    }
    for (const r of roads) {
      if (!r.side) continue;
      for (let i = 0; i < r.points.length / 3; i++) r.points[i * 3 + 1] = heightAt(heights, r.points[i * 3], r.points[i * 3 + 2]) + 0.08;
    }
    // (the headquarters' ground is bare, as a yard is that cars stood in: the yard between its wings, the ground
    // before the garage's doors, down its sides, behind it)
    {
      const qc = Math.cos(hq.rot), qs = Math.sin(hq.rot);
      const o = (lx: number, lz: number): [number, number] => [hq.x + lx * qc + lz * qs, hq.z - lx * qs + lz * qc];
      for (const [ax, az, bx, bz] of [[-3.4, 7, -3.4, 18], [-1.2, 7, -1.2, 18], [1.2, 7, 1.2, 18], [3.4, 7, 3.4, 18], [5, 20, 15, 20], [5, 22, 15, 22], [-17.4, 6, -17.4, -9], [17.4, 6, 17.4, -9], [-17.4, -9.2, 17.4, -9.2]]) rasterLine([o(ax, az), o(bx, bz)], null, 4, trackDist, trackH);
    }

    // 4. what grew or lay where a building or a street now is goes; the rest stands on the ground as it is now
    const inMoved = (x: number, z: number, margin: number) =>
      moved.some((b) => {
        const [w, d] = BUILDING_FOOTPRINT[b.type];
        const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), sn = Math.sin(b.rot);
        return Math.abs(dx * c - dz * sn) < w / 2 + margin && Math.abs(dx * sn + dz * c) < d / 2 + margin;
      });
    const R = VILLAGE_STREETS.reach;
    for (const list of [trees, rocks, props]) {
      for (let k = list.length - 1; k >= 0; k--) {
        const t = list[k];
        if (Math.abs(t.x - VILLAGE.x) > R || Math.abs(t.z - VILLAGE.z) > R) continue;
        const i = idx(clamp(Math.round((t.x + half) / CELL), 0, N - 1), clamp(Math.round((t.z + half) / CELL), 0, N - 1));
        // (a fire ring or a fuel drum is told by its place in the list: none is taken up, and the plan keeps clear of them)
        if (/^(stone_fire_pit|Barrel_01)/.test(t.kind)) t.y += heightAt(heights, t.x, t.z) - heightAt(before, t.x, t.z);
        else if (inMoved(t.x, t.z, list === trees ? 4 : 2.5) || laneDist[i] < LANE / 2 + (list === trees ? 3.5 : 1.8) || backDist[i] < (list === trees ? 3 : 2)) list.splice(k, 1);
        else t.y += heightAt(heights, t.x, t.z) - heightAt(before, t.x, t.z);
      }
    }
    for (let iz = Math.max(0, Math.floor((VILLAGE.z - R + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((VILLAGE.z + R + half) / CELL)); iz++)
      for (let ix = Math.max(0, Math.floor((VILLAGE.x - R + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((VILLAGE.x + R + half) / CELL)); ix++) {
        paint(ix, iz);
        if (surface) surface[iz * N + ix] = heights[iz * N + ix];
      }
  }

  yield 'the fourth expansion';
  // --- the fourth expansion (2026-10-13): the road made a loop (see LOOP). On out of the far end of Kamenka's
  // street, over a cleft on a bridge, west along the high ground south of the valley, round behind the works and
  // north along the high ground west of it, and down into the valley again by a second pass, onto the old road's
  // west end. By the rule of the others: its own dice, after everything, nothing renumbered. Of the old map it
  // moves the ground the west pass is cut through (the old road's first points keep their places and are given new
  // heights, as its last were for the first pass) and the ground under the road where it rounds the works; and
  // nothing else (see `loopFence`).
  const bridges: Bridge[] = [];
  let gatehouse: World['gatehouse'] = null;
  let castle: World['castle'] = null;
  const paths: World['paths'] = [], worns: World['worn'] = [];
  let wreck: World['wreck'] = null;
  const walls: World['walls'] = [];
  {
    const before = heights.slice();
    const rng8 = new RNG(seed + 9393);
    const cell = (x: number, z: number) => idx(clamp(Math.round((x + half) / CELL), 0, N - 1), clamp(Math.round((z + half) / CELL), 0, N - 1));
    const L = loopLine(), K = LOOP;
    const least = (a: number, b: number, k: number) => {
      const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
      return lerp(b, a, h) - k * h * (1 - h);
    };
    /** how far along a line each of its points is */
    const runOf = (line: [number, number][]) => {
      const run = [0];
      for (let k = 1; k < line.length; k++) run.push(run[k - 1] + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]));
      return run;
    };
    /**
     * How high a road lies along a line: the ground's own height, evened out along it (a road is cut a little and
     * banked a little: fifty metres of it at a time), from the height it begins at, and at its end too where that is
     * said; nowhere steeper than `most`.
     */
    const laid = (line: [number, number][], most: number, first: number, last?: number) => {
      const raw = line.map(([x, z]) => heightAt(heights, x, z));
      const ys = raw.map((_, i) => {
        let sum = 0, c = 0;
        for (let k = -12; k <= 12; k++) {
          const w = 1 - Math.abs(k) / 13;
          sum += raw[clamp(i + k, 0, raw.length - 1)] * w;
          c += w;
        }
        return sum / c;
      });
      ys[0] = first;
      if (last !== undefined) ys[ys.length - 1] = last;
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 1; i < ys.length - (last !== undefined ? 1 : 0); i++) {
          const m = most * Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
          ys[i] = clamp(ys[i], ys[i - 1] - m, ys[i - 1] + m);
        }
        for (let i = ys.length - 2; i > 0; i--) {
          const m = most * Math.hypot(line[i][0] - line[i + 1][0], line[i][1] - line[i + 1][1]);
          ys[i] = clamp(ys[i], ys[i + 1] - m, ys[i + 1] + m);
        }
      }
      return ys;
    };

    // 1. How high the road lies. Out of the town it climbs from the street's own height to the bridge's; along the
    // shelf it rises and falls with the land; and the west pass is one even fall, from the shelf to where the old
    // road comes onto the valley's floor.
    const street = roads[0].points, doorY = laid(L.door, K.steep.door, street[street.length - 2], K.deck);
    const shelfY = laid(L.main.slice(0, L.west + 1), K.steep.shelf, K.deck);
    const run = runOf(L.main), footI = L.main.length - 1 - L.old;
    const top = shelfY[L.west], whole = run[run.length - 1] - run[L.west];
    // (it eases into the fall at its head over a tenth of its length; at its foot the old road is already falling as fast)
    const ease = (t: number) => {
      const e = 0.1, v = 1 / (1 - e / 2);
      return t < e ? (v * t * t) / (2 * e) : v * (t - e / 2);
    };
    const mainY = L.main.map((_, i) => (i <= L.west ? shelfY[i] : lerp(top, smooth[footI], ease((run[i] - run[L.west]) / whole))));
    // (the old road's first points: each where it was, at its new height)
    for (let k = 0; k < footI; k++) {
      smooth[k] = mainY[L.old + k];
      roadPts[k * 3 + 1] = mainY[L.old + k];
    }

    // 2. The ground brought to it. Level across for the road and its verges; where the ground stands over the road
    // it is taken back from it, gently and then as a hillside (`banks`, by how far along the line a spot is); where
    // it lies under the road it is banked up. And nothing behind where a line begins, or beyond where it ends, where
    // it is said to stop there (`stops`): at the end of Kamenka's street, and where the old road comes onto the
    // valley's floor, the ground beyond is as it was. (At the bridge the banks are rounded off about the road's end.)
    type Banks = { reach: number; open: number; bench: number; lay: number; side: number; /** on the mountains of the map's edge: how far the hill is taken back, and how steeply it stands over that (unsaid: as the passes have it) */ keep?: number; wall?: number };
    // (the mountains of the map's edge are not laid back: see PASS)
    const lay = (line: [number, number][], ys: number[], banks: (run: number) => Banks, most: number, stops: [boolean, boolean], leave?: (i: number) => number) => {
      const dist = new Float32Array(N * N).fill(1e9), hh = new Float32Array(N * N), rr = new Float32Array(N * N), runs = runOf(line), whole = runs[runs.length - 1];
      // (How far each spot is from the line, and the line's height and how far along it the nearest point of it is:
      // one walk of the ground for the three, and no distance worked out in full for a piece of the line that is
      // plainly further off than one before it (told by the squares, with a millionth to spare). It was `rasterLine`
      // twice over, and with the slumping below it was a third of the time the whole map takes to make, on every
      // load and every start of the server: each spot within `most` of a line as long as these is asked about by
      // forty of its pieces. Found by an independent reading, 2026-10-13. The ground it makes is the same to the
      // last figure: what is nearest is told as it was, by the same sum in the same order.)
      {
        for (let s = 0; s < line.length - 1; s++) {
          const [ax, az] = line[s], [bx, bz] = line[s + 1];
          const ix0 = Math.max(0, Math.floor((Math.min(ax, bx) - most + half) / CELL)), ix1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + most + half) / CELL));
          const iz0 = Math.max(0, Math.floor((Math.min(az, bz) - most + half) / CELL)), iz1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + most + half) / CELL));
          const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
          for (let iz = iz0; iz <= iz1; iz++) {
            const z = -half + iz * CELL;
            for (let ix = ix0; ix <= ix1; ix++) {
              const x = -half + ix * CELL;
              const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
              const ex = x - (ax + dx * t), ez = z - (az + dz * t);
              const i = idx(ix, iz), was = dist[i];
              if (ex * ex + ez * ez > was * was * 1.000001) continue;
              const d = Math.hypot(ex, ez);
              if (d < was) {
                dist[i] = d;
                hh[i] = lerp(ys[s], ys[s + 1], t);
                rr[i] = lerp(runs[s], runs[s + 1], t);
              }
            }
          }
        }
      }
      // (the road's height far from it is that evened out over the ground about: see the first pass)
      const soft = evenOut(hh, (i) => dist[i] < most, 15);
      const a = line[0], b = line[line.length - 1], fwd = [line[1][0] - a[0], line[1][1] - a[1]], on = [b[0] - line[line.length - 2][0], b[1] - line[line.length - 2][1]];
      for (let i = 0; i < N * N; i++) {
        const d = dist[i];
        if (d >= most) continue;
        const x = -half + (i % N) * CELL, z = -half + Math.floor(i / N) * CELL;
        // (and toward a place it stops at, less and less of the ground beside it is moved: none at the line drawn
        // across the road there, where moved ground would stand against ground that is not as a step)
        const ahead = ((x - a[0]) * fwd[0] + (z - a[1]) * fwd[1]) / Math.hypot(fwd[0], fwd[1]), short = ((b[0] - x) * on[0] + (b[1] - z) * on[1]) / Math.hypot(on[0], on[1]);
        // (asked only of the ground about that end of it: a line that comes round on itself has ground far along it
        // that lies behind where it began)
        const first = stops[0] && rr[i] < 70, last = stops[1] && rr[i] > whole - 70;
        if ((first && ahead < 0) || (last && short < 0)) continue;
        const all = (first ? smoothstep(0, 40, ahead) : 1) * (last ? smoothstep(0, 40, short) : 1);
        const B = banks(rr[i]);
        if (d >= B.reach) continue;
        const uneven = 0.86 + 0.28 * (0.5 + 0.5 * n1.noise(x * 0.021 + 11, z * 0.021 - 5));
        const out = Math.max(0, d - PASS.bed);
        const keep = B.keep ?? PASS.keep, wall = B.wall ?? PASS.wall;
        const cut = lerp(Math.min(out, B.open) * B.bench + Math.max(0, out - B.open) * B.lay, Math.min(out, keep) * B.bench + Math.max(0, out - keep) * wall, smoothstep(0.05, 0.3, edgeOf(x, z))) * uneven + 2.4 * n2.fbm(x * 0.027 - 4, z * 0.027 + 8, 3) * smoothstep(PASS.bed + 6, 42, d);
        const off = out * B.side * uneven, bed = hh[i] - 0.08;
        let y = least(heights[i], lerp(hh[i], soft[i], smoothstep(12, 50, d)) - 0.08 + cut, Math.min(3, Math.max(0, cut) * 0.5) + 1e-6);
        y = -least(-y, off - bed, Math.min(3, off * 0.5) + 1e-6);
        y = lerp(y, bed, 1 - smoothstep(ROAD_W * 0.5 + 0.5, 16, d));
        // (and nothing of it inside the bowl of the works, whose wall is the works' own: the road passes along its lip)
        const bowl = smoothstep(EXPANSION.floor + EXPANSION.wall - 4, EXPANSION.floor + EXPANSION.wall + 8, Math.hypot(x - EXPANSION.x, z - EXPANSION.z));
        // (nor of whatever it is told to leave alone: the bed of a road it leaves, which is that road's)
        heights[i] = lerp(heights[i], lerp(y, heights[i], smoothstep(B.reach - 20, B.reach, d)), Math.max(all, 1 - smoothstep(ROAD_W * 0.5 + 0.5, 16, d)) * bowl * (leave ? leave(i) : 1));
        if (d < 16 && d <= roadDist[i] + 0.01) {
          roadDist[i] = d;
          roadH[i] = hh[i];
        }
      }
      return dist;
    };
    const doorDist = lay(L.door, doorY, () => K.banks.door, K.banks.door.reach, [true, false]);
    // (the shelf road widens into the pass over a hundred metres about its head)
    const pass: Banks = { reach: PASS.reach, open: PASS.open, bench: PASS.bench, lay: PASS.lay, side: PASS.side };
    const mix = (w: number): Banks => ({ reach: lerp(K.banks.shelf.reach, pass.reach, w), open: lerp(K.banks.shelf.open, pass.open, w), bench: lerp(K.banks.shelf.bench, pass.bench, w), lay: lerp(K.banks.shelf.lay, pass.lay, w), side: lerp(K.banks.shelf.side, pass.side, w) });
    const mainDist = lay(L.main, mainY, (r) => mix(smoothstep(run[L.west] - 60, run[L.west] + 40, r)), PASS.reach, [false, true]);

    // 3. The cleft (see LOOP.cleft): the ground cut down to a bed that falls from the foot of each hill to the
    // bridge, its sides a bank that is walked down everywhere but under the bridge itself, where they stand steeper
    // between the two banks the bridge springs from.
    const A = L.door[L.door.length - 1], Bz = K.bridge, span = Math.hypot(Bz[0] - A[0], Bz[1] - A[1]), bux = (Bz[0] - A[0]) / span, buz = (Bz[1] - A[1]) / span;
    const C = K.cleft, cleftLines: [number, number][][] = [];
    const cleftDist = new Float32Array(N * N).fill(1e9), cleftH = new Float32Array(N * N);
    {
      for (const way of [C.line, ...C.ways]) {
        // (the bed's height along it: between the heights said, by how far along it a point is)
        const xz = way.map(([x, z]) => [x, z] as [number, number]), line = catmullRom(xz, 4);
        const at = runOf(xz), cr = runOf(line), scale = at[at.length - 1] / cr[cr.length - 1];
        const bedY = cr.map((r) => {
          const q = r * scale;
          let k = 1;
          while (k < at.length - 1 && at[k] < q) k++;
          return lerp(way[k - 1][2], way[k][2], clamp((q - at[k - 1]) / (at[k] - at[k - 1] || 1), 0, 1));
        });
        rasterLine(line, bedY, C.reach, cleftDist, cleftH);
        cleftLines.push(line);
      }
      // (far from a bed its height is evened out over the ground about, as a road's is: between the cleft's head and
      // a gully beside it the nearer of the two was one height on one side of a line and another on the other)
      const soft = evenOut(cleftH, (i) => cleftDist[i] < C.reach, 9);
      for (let i = 0; i < N * N; i++) {
        const d = cleftDist[i];
        if (d >= C.reach) continue;
        const x = -half + (i % N) * CELL, z = -half + Math.floor(i / N) * CELL;
        // how far up or down the cleft from the bridge's own line this is
        const under = 1 - smoothstep(C.near[0], C.near[1], Math.abs((x - A[0]) * -buz + (z - A[1]) * bux));
        const uneven = lerp(0.9 + 0.2 * (0.5 + 0.5 * n1.noise(x * 0.031 - 3, z * 0.031 + 17)), 1, under);
        // (its bed is the bed of something that ran here: stones and hollows, a hand or two deep)
        const cap = lerp(cleftH[i], soft[i], smoothstep(5, 26, d) * (1 - under)) + Math.max(0, d - C.bed) * lerp(C.side, C.under, under) * uneven + 0.4 * n3.fbm(x * 0.09, z * 0.09 + 4, 3) * (1 - under * 0.5);
        if (heights[i] <= cap - 2.5) continue;
        heights[i] = lerp(least(heights[i], cap, lerp(2.5, 0.6, under)), heights[i], smoothstep(C.reach - 10, C.reach, d));
      }
    }

    // 4. The lay-by (see LOOP.layby): the ground beside the road, toward the works, level with the road.
    const layDist = new Float32Array(N * N).fill(1e9);
    /** where it is: its middle, and which way the road runs beside it (a unit) */
    const layAt = (() => {
      const Y = K.layby;
      let near = 1;
      for (let k = 1; k < L.main.length - 1; k++) if (Math.hypot(L.main[k][0] - Y.at[0], L.main[k][1] - Y.at[1]) < Math.hypot(L.main[near][0] - Y.at[0], L.main[near][1] - Y.at[1])) near = k;
      const tx = L.main[near + 1][0] - L.main[near - 1][0], tz = L.main[near + 1][1] - L.main[near - 1][1], tl = Math.hypot(tx, tz);
      // (to the side of the road the works is on)
      const side = Math.sign((EXPANSION.x - L.main[near][0]) * (-tz / tl) + (EXPANSION.z - L.main[near][1]) * (tx / tl)) || 1;
      return { x: L.main[near][0] + (-tz / tl) * side * Y.off, z: L.main[near][1] + (tx / tl) * side * Y.off, tx: tx / tl, tz: tz / tl, side, y: mainY[near] - 0.08 };
    })();
    {
      const Y = K.layby, R = Y.long;
      for (let iz = Math.max(0, Math.floor((layAt.z - R + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((layAt.z + R + half) / CELL)); iz++)
        for (let ix = Math.max(0, Math.floor((layAt.x - R + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((layAt.x + R + half) / CELL)); ix++) {
          const x = -half + ix * CELL - layAt.x, z = -half + iz * CELL - layAt.z, i = idx(ix, iz);
          const e = Math.hypot(Math.max(0, Math.abs(x * layAt.tx + z * layAt.tz) - Y.long / 2), Math.max(0, Math.abs(x * -layAt.tz + z * layAt.tx) - Y.wide / 2));
          layDist[i] = e;
          // (not the road's own bed; and not the wall of the works, which begins at its far edge)
          if (e < 6) heights[i] = lerp(heights[i], layAt.y, (1 - smoothstep(0.5, 6, e)) * smoothstep(ROAD_W / 2 - 0.4, ROAD_W / 2 + 1.2, mainDist[i]) * smoothstep(EXPANSION.floor + EXPANSION.wall - 2, EXPANSION.floor + EXPANSION.wall + 6, Math.hypot(x + layAt.x - EXPANSION.x, z + layAt.z - EXPANSION.z)));
          // (worn bare, as a place cars pull off onto is: painted as a track)
          if (e < 1.5 && e < trackDist[i]) trackDist[i] = e;
        }
    }

    // 5. What grew or lay there. Gone from the road, from the lay-by and from under the bridge, and from any face
    // of the cleft too steep to hold it; everything else stands on the ground as it is now.
    const underDeck = (x: number, z: number, margin: number) => {
      const along = (x - A[0]) * bux + (z - A[1]) * buz;
      return along > -margin && along < span + margin && Math.abs((x - A[0]) * -buz + (z - A[1]) * bux) < ROAD_W / 2 + margin;
    };
    for (const list of [trees, rocks, props]) {
      const clear = list === trees ? ROAD_W / 2 + 4 : ROAD_W / 2 + 2;
      for (let k = list.length - 1; k >= 0; k--) {
        const t = list[k], i = cell(t.x, t.z);
        // (and no tree between the lay-by and the works: it is there for what is seen from it)
        const view = list === trees && Math.hypot(t.x - layAt.x, t.z - layAt.z) < 34 && (t.x - layAt.x) * (EXPANSION.x - layAt.x) + (t.z - layAt.z) * (EXPANSION.z - layAt.z) > 0;
        if (doorDist[i] < clear || mainDist[i] < clear || layDist[i] < 2 || view || underDeck(t.x, t.z, list === trees ? 5 : 2) || (cleftDist[i] < C.reach && slopeAt(heights, t.x, t.z) > 1.05)) list.splice(k, 1);
        else {
          const moved = heightAt(heights, t.x, t.z) - heightAt(before, t.x, t.z);
          if (moved) t.y += moved;
        }
      }
    }

    // 6. Rocks: on the hillsides the two passes and the door were laid back into, and in the cleft. (Trees are cover
    // that is walked through; a rock is cover that stops a round.) After every rock there was.
    const kinds = ['rock_moss_set_01', 'rock_moss_set_02'];
    const strew = (line: [number, number][], from: number, to: number, n: number, near: number, far: number, big: number) => {
      for (let k = 0; k < n; k++) {
        const j = rng8.int(from, to), [px, pz] = line[j], [qx, qz] = line[Math.min(line.length - 1, j + 1)], l = Math.hypot(qx - px, qz - pz) || 1;
        const out = (rng8.chance(0.5) ? 1 : -1) * rng8.range(near, far), turn = rng8.range(0, 6.28), size = rng8.next(), which = rng8.int(0, 5), set = rng8.pick(kinds), boulder = rng8.chance(big);
        const x = px - ((qz - pz) / l) * out, z = pz + ((qx - px) / l) * out, i = cell(x, z);
        if (Math.abs(x) > half - 12 || Math.abs(z) > half - 12 || roadDist[i] < ROAD_W / 2 + 2.5 || trackDist[i] < 3 || layDist[i] < 3 || insideBuilding(x, z, 3) || underDeck(x, z, 1.5)) continue;
        if (slopeAt(heights, x, z) > 0.9 || rocks.some((q) => Math.hypot(q.x - x, q.z - z) < 4)) continue;
        const y = heightAt(heights, x, z);
        rocks.push(boulder ? { kind: 'boulder_01', x, y: y - 0.3, z, rot: turn, scale: 1.2 + size * 1.3 } : { kind: `${set}#${which}`, x, y: y - 0.2, z, rot: turn, scale: 0.8 + size * 0.9 });
      }
    };
    // the first pass, where it is a cutting (its bank up from the valley's floor is as it was)
    const way1: [number, number][] = [...path2.filter(([x]) => x >= 400), ...catmullRom(eastRoad(), 4).slice(1, 14)];
    strew(way1, 0, way1.length - 2, 110, 9, PASS.open + 25, 0.35);
    strew(L.door, 4, L.door.length - 6, 46, 9, 70, 0.35);
    strew(L.main, L.west, L.main.length - 6, 120, 9, PASS.open + 25, 0.35);
    strew(cleftLines[0], 2, cleftLines[0].length - 3, 40, 0, 30, 0.5);
    // (And four stones in the bed right under the bridge: something to wait behind there, and a supply drop is not
    // set down from the sky on ground with a stone on it, as it would be on the one level place the deck is over.)
    for (const [dx, dz, size, turn] of [[-1.8, -2.4, 1.5, 0.4], [2.4, -2.1, 1.9, 2.1], [-2.2, 2.5, 2.1, 4.0], [2.6, 2.3, 1.4, 5.2]]) {
      const x = C.line[3][0] + dx, z = C.line[3][1] + dz;
      rocks.push({ kind: 'boulder_01', x, y: heightAt(heights, x, z) - 0.3, z, rot: turn, scale: size });
    }

    // 7. And the ground is painted again wherever any of this reaches (and is the ground that is seen, there).
    for (let i = 0; i < N * N; i++) {
      if (!(doorDist[i] < K.banks.door.reach + 4 || mainDist[i] < PASS.reach + 4 || cleftDist[i] < C.reach + 4 || layDist[i] < 10)) continue;
      // (where the ground was moved, where the road or its verge is, and a little about: the rest is as it was painted)
      if (Math.abs(heights[i] - before[i]) < 0.02 && doorDist[i] > 22 && mainDist[i] > 22 && layDist[i] > 10) continue;
      paint(i % N, Math.floor(i / N));
      if (surface) surface[i] = heights[i];
    }

    // 8. The road itself: a line out of the town to the bridge, the bridge, and a line from the bridge to the old
    // road's first point (from which the old road is the way, as it always was).
    const points = (line: [number, number][], ys: number[], n: number) => {
      const pts = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) pts.set([line[i][0], ys[i], line[i][1]], i * 3);
      return pts;
    };
    roads.push({ points: points(L.door, doorY, L.door.length), width: ROAD_W });
    roads.push({ points: new Float32Array([A[0], K.deck, A[1], Bz[0], K.deck, Bz[1]]), width: ROAD_W, bridge: true });
    roads.push({ points: points(L.main, mainY, L.old + 1), width: ROAD_W });
    bridges.push({ ax: A[0], ay: K.deck, az: A[1], bx: Bz[0], by: K.deck, bz: Bz[1] });

    // 9. What was left along it, of the things the game has: blocks either side of the road before each end of the
    // bridge, where it was once shut; the lay-by's own blocks along its lip, a car pulled off into it and a tyre; a
    // car run onto the verge where the shelf road comes round behind the works; and in the cleft, under the gap in
    // the bridge's railing, the jeep that made it, on its roof (what it carried lies about it: see `wreckUnder`, and
    // the places for things that Buildings.plan() adds after every other). After every thing there was.
    const stand = (kind: string, x: number, z: number, rot: number, lean?: [number, number, number]) => props.push({ kind, x, y: heightAt(heights, x, z), z, rot, scale: 1, ...(lean ? { lean: [lean[0], lean[1], heightAt(heights, x, z) + lean[2]] as [number, number, number] } : {}) });
    /** a spot beside the road: so far along a line (its point's number), so far to its right, and which way the road runs there */
    const beside = (line: [number, number][], i: number, right: number): [number, number, number] => {
      const [px, pz] = line[clamp(i - 1, 0, line.length - 1)], [qx, qz] = line[clamp(i + 1, 0, line.length - 1)], l = Math.hypot(qx - px, qz - pz) || 1;
      return [line[i][0] - ((qz - pz) / l) * right, line[i][1] + ((qx - px) / l) * right, Math.atan2(qx - px, qz - pz)];
    };
    for (const [line, i] of [[L.door, L.door.length - 5], [L.main, 4]] as [[number, number][], number][]) {
      for (const [right, turn] of [[5.1, 0.5], [-5.3, -0.35]]) {
        const [x, z, way] = beside(line, i, right);
        stand('concrete_road_barrier', x, z, way + Math.PI / 2 + turn);
      }
    }
    {
      const Y = K.layby, way = Math.atan2(layAt.tx, layAt.tz);
      // (along the road, and out toward the works)
      const at = (along: number, out: number): [number, number] => [layAt.x + layAt.tx * along - layAt.tz * layAt.side * out, layAt.z + layAt.tz * along + layAt.tx * layAt.side * out];
      for (const along of [-10.5, -3.5, 3.5, 10.5]) stand('concrete_road_barrier', ...at(along, Y.wide / 2 - 0.9), way + (along > 9 ? 0.25 : along < -9 ? -0.2 : 0.04));
      stand('covered_car', ...at(-7, -1.5), way + 0.12);
      props.push({ kind: 'old_tyre', x: at(5.5, 1.2)[0], y: heightAt(heights, ...at(5.5, 1.2)) + 0.08, z: at(5.5, 1.2)[1], rot: 1.1, scale: 1 });
    }
    {
      const [x, z, way] = beside(L.main, Math.round(L.west * 0.585), 5.4);
      stand('covered_car', x, z, way + 0.3);
    }
    for (const b of bridges) {
      const w = wreckUnder(b);
      stand('uaz_469', w.x, w.z, w.rot, [0.16, 2.62, 2.05]);
      props.push({ kind: 'old_tyre', x: w.x + 2.9, y: heightAt(heights, w.x + 2.9, w.z - 0.8) + 0.08, z: w.z - 0.8, rot: 0.4, scale: 1 });
    }

    // 10. The mountain road, the cart track from its end and the fort's place on the rim (see MOUNTAIN). After
    // everything above, and by the same rules. Of the old map it moves a little of the bench the fort stands on and
    // the track crosses: nothing built, nothing kept and no start is on that ground.
    if (!leftOut.mountain) {
      const M = MOUNTAIN, was = heights.slice(), roadWas = roadDist.slice();
      // where it leaves the pass: its first point is on the pass road, and it begins beside that road's asphalt, at
      // that road's own height there
      let from = { d: 1e9, x: 0, y: 0, z: 0, tx: 1, tz: 0 };
      for (const pts of [roadPts, roads[0].points]) for (let i = 0; i < pts.length / 3 - 1; i++) {
        const d = Math.hypot(pts[i * 3] - M.road[0][0], pts[i * 3 + 2] - M.road[0][1]);
        if (d < from.d) from = { d, x: pts[i * 3], y: pts[i * 3 + 1], z: pts[i * 3 + 2], tx: pts[i * 3 + 3] - pts[i * 3], tz: pts[i * 3 + 5] - pts[i * 3 + 2] };
      }
      const tl = Math.hypot(from.tx, from.tz), sideOf = Math.sign((M.road[1][0] - from.x) * (-from.tz / tl) + (M.road[1][1] - from.z) * (from.tx / tl)) || 1;
      const begin: [number, number] = [from.x + (-from.tz / tl) * sideOf * (ROAD_W / 2 - 1.1), from.z + (from.tx / tl) * sideOf * (ROAD_W / 2 - 1.1)];
      const line = catmullRom([begin, ...M.road.slice(1)], 4), end = line[line.length - 1];
      // (it stops on the ground as the ground is there: its last height is the ground's own, less a hand: see `sinks`)
      const ys = laid(line, M.steep, from.y, heightAt(heights, end[0], end[1]) + 0.08 - M.sinks);
      // (level with the pass road for its first paces: it is that road's verge it crosses)
      for (let i = 1; i < 4; i++) ys[i] = Math.min(ys[i], from.y + 0.02 * i);
      for (let i = 4; i < ys.length; i++) {
        const most = M.steep * Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
        ys[i] = clamp(ys[i], ys[i - 1] - most, ys[i - 1] + most);
      }
      const mtDist = lay(line, ys, () => M.banks, M.banks.reach, [true, true], (i) => smoothstep(ROAD_W / 2 + 1, 14, roadWas[i]));
      // The road runs out (see MOUNTAIN.end). Left as it was laid, its banks stopped dead at a line drawn across its
      // end, a step in the hillside either side of the asphalt. Over its last metres less and less of the ground
      // beside it is the road's, and at that line all of it is the ground that was. (Not its bed, which is level
      // across to its end: the track takes that on from there.)
      const ex = end[0] - line[line.length - 2][0], ez = end[1] - line[line.length - 2][1], el = Math.hypot(ex, ez);
      for (let i = 0; i < N * N; i++) {
        if (mtDist[i] >= M.banks.reach) continue;
        const short = ((end[0] - (-half + (i % N) * CELL)) * ex + (end[1] - (-half + Math.floor(i / N) * CELL)) * ez) / el;
        if (short >= 0 && short < M.end) heights[i] = lerp(was[i], heights[i], Math.max(smoothstep(0, M.end, short), 1 - smoothstep(ROAD_W / 2 + 1, ROAD_W / 2 + 7, mtDist[i])));
      }
      // And along its last sixty metres, where it is the foreground of every look back from the track, the brows and
      // feet of its banks are rounded and the corners of its bed's end with them: what the road moved there is evened
      // over a few metres, three times (the banks as they were laid meet the bed and the hillside on ruled lines,
      // and the bed stopped square against ground that was not moved: a step of two metres at the corner on the
      // mountain's side). Not its bed, which is level across as it was; and not the ground itself, whose own shape
      // is left as it is.
      {
        const back = M.eased, x0 = Math.floor((end[0] - back - 34 + half) / CELL), x1 = Math.ceil((end[0] + back + 34 + half) / CELL), z0 = Math.floor((end[1] - back - 34 + half) / CELL), z1 = Math.ceil((end[1] + back + 34 + half) / CELL);
        for (let pass = 0; pass < 3; pass++) {
          const src = heights.slice();
          for (let iz = z0; iz <= z1; iz++)
            for (let ix = x0; ix <= x1; ix++) {
              const i = idx(ix, iz), x = -half + ix * CELL, z = -half + iz * CELL, d = Math.hypot(x - end[0], z - end[1]), short = ((end[0] - x) * ex + (end[1] - z) * ez) / el;
              // (about its end, all round; and beside it for so far back, from the edge of its bed out to thirty metres)
              const w = Math.max((1 - smoothstep(7, 13, d)) * (short >= 0 ? smoothstep(ROAD_W / 2 - 0.4, ROAD_W / 2 + 1.6, mtDist[i]) : 1), mtDist[i] < 30 && short >= 0 ? (1 - smoothstep(back - 20, back, short)) * smoothstep(ROAD_W / 2 + 0.6, ROAD_W / 2 + 3, mtDist[i]) * (1 - smoothstep(22, 30, mtDist[i])) : 0);
              if (w <= 0) continue;
              const even = (g: Float32Array) => (g[i] * 4 + (g[i - 1] + g[i + 1] + g[i - N] + g[i + N]) * 2 + g[i - N - 1] + g[i - N + 1] + g[i + N - 1] + g[i + N + 1]) / 16;
              heights[i] = lerp(src[i], was[i] + even(src) - even(was), w);
            }
        }
      }

      // The fort's place (see MOUNTAIN.castle). It stands on its own terrace, as it was first laid out: its walls and
      // its towers go down past the bench to their own footings, and NO EARTH IS MOVED UNDER IT OR ROUND IT: no pad,
      // no bank, no levelled yard. Its gate looks down the road's last stretch, and its ramp comes down onto the
      // shoulder that is made before it of the hill's own foot (below): nothing else of the ground is touched for it.
      const F = M.castle, fort: FortPlace = { x: F.x, y: F.terrace, z: F.z, rot: F.rot, loose: F.loose.map((l) => ({ ...l })), before: F.before, rock: false };
      castle = fort;
      // (named on the map by the name the place has in the valley: the fort's own file has the name of the fort it was measured from)
      pois.push({ name: F.name, x: F.x, z: F.z, radius: 40 });
      /** how far outside the fort's foot a spot of the world is, metres (nothing or less: under a wall, a tower, the ramp, the rubble or the back door's stair) */
      const footOf = (x: number, z: number) => castleFoot(fort, x, z);
      const fortD = new Float32Array(N * N).fill(1e9);
      {
        const R = 96, ix0 = Math.max(1, Math.floor((F.x - R + half) / CELL)), ix1 = Math.min(N - 2, Math.ceil((F.x + R + half) / CELL)), iz0 = Math.max(1, Math.floor((F.z - R + half) / CELL)), iz1 = Math.min(N - 2, Math.ceil((F.z + R + half) / CELL));
        for (let iz = iz0; iz <= iz1; iz++)
          for (let ix = ix0; ix <= ix1; ix++) {
            const i = idx(ix, iz), d = footOf(-half + ix * CELL, -half + iz * CELL);
            fortD[i] = d;
          }
      }
      // THE SHOULDER (see MOUNTAIN.shoulder): the hill's foot run out to where the ramp comes down, and the way up
      // it. Made before the ramp's foot is trimmed and before the track is laid: both are laid on it as on any
      // ground. ONLY EVER RAISED; and every spot it raises is told to `made` (by how much), for whoever paints after.
      const made = new Float32Array(N * N);
      {
        const SH = M.shoulder, C = CASTLE, S = CASTLE_SCALE, run = Math.sqrt(C.ramp.len ** 2 - C.ramp.drop ** 2), x0 = C.hx + C.parapet.thick / 2, gz = (C.gate.z0 + C.gate.z1) / 2;
        const [fx, , fz] = castleAt(fort, x0 + run, gz), [qx, , qz] = castleAt(fort, x0 + run - SH.past / S, gz), level = F.terrace - S * C.ramp.drop - 0.18, old = heights.slice();
        // (its crest: the track's own line, and on over the ramp's foot to where its top ends before the gate)
        const crest: [number, number][] = [...catmullRom(M.track.line, 2), [fx, fz], [qx, qz]], n = crest.length, runs = runOf(crest), L = runs[n - 1];
        // How high its top is along the way: the height the boards come down to before the gate, and from there back
        // down the way as steeply as a cart is drawn up and no steeper, until that is the ground as the ground is.
        const raw = crest.map(([x, z]) => heightAt(old, x, z)), p = raw.slice();
        p[n - 1] = level;
        for (let k = n - 2; k >= 0; k--) p[k] = L - runs[k] <= SH.level + SH.past ? level : Math.max(raw[k], p[k + 1] - SH.steep * (runs[k + 1] - runs[k]));
        for (let pass = 0; pass < 3; pass++) {
          const src = p.slice();
          for (let k = 1; k < n - 1; k++) if (L - runs[k] > SH.past + 3) p[k] = Math.max(raw[k] - 0.3, (src[k - 1] + 2 * src[k] + src[k + 1]) / 4);
        }
        // (how much of it there is along the way: none where the way lies on the ground as it is, none on the road's own bank)
        const lift = p.map((v, k) => Math.max(0, v - raw[k])), fade = lift.map((_, k) => smoothstep(0.05, 0.9, Math.max(...lift.slice(Math.max(0, k - 3), k + 4))) * smoothstep(SH.from, SH.from + 12, runs[k]));
        const k0 = Math.max(0, runs.findIndex((r) => r >= SH.from - 2));
        let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
        for (let k = k0; k < n; k++) {
          bx0 = Math.min(bx0, crest[k][0]); bx1 = Math.max(bx1, crest[k][0]);
          bz0 = Math.min(bz0, crest[k][1]); bz1 = Math.max(bz1, crest[k][1]);
        }
        // (the last of its crest: past it, toward the gate, a spot is told by how far past and how far to the side of that line)
        const [ax, az] = crest[n - 2], ll = Math.hypot(qx - ax, qz - az) || 1, ux = (qx - ax) / ll, uz = (qz - az) / ll;
        for (let iz = Math.max(1, Math.floor((bz0 - SH.reach + half) / CELL)); iz <= Math.min(N - 2, Math.ceil((bz1 + SH.reach + half) / CELL)); iz++)
          for (let ix = Math.max(1, Math.floor((bx0 - SH.reach + half) / CELL)); ix <= Math.min(N - 2, Math.ceil((bx1 + SH.reach + half) / CELL)); ix++) {
            const x = -half + ix * CELL, z = -half + iz * CELL, i = idx(ix, iz);
            // the nearest of its crest: how far off, on which side (toward the valley, or toward the hill), how far along, how high its top there
            let d = 1e9, r = 0, top = 0, much = 0, deep = 0, valley = true;
            for (let k = k0; k < n - 1; k++) {
              const [px, pz] = crest[k], dx = crest[k + 1][0] - px, dz = crest[k + 1][1] - pz, t = clamp(((x - px) * dx + (z - pz) * dz) / (dx * dx + dz * dz || 1), 0, 1), e = Math.hypot(x - px - dx * t, z - pz - dz * t);
              if (e >= d) continue;
              d = e; r = lerp(runs[k], runs[k + 1], t); top = lerp(p[k], p[k + 1], t); much = lerp(fade[k], fade[k + 1], t); deep = lerp(lift[k], lift[k + 1], t);
              valley = (x - px) * dz - (z - pz) * dx > 0;
            }
            const past = Math.max(0, (x - qx) * ux + (z - qz) * uz);
            if (past > 0) {
              const side = -(x - qx) * uz + (z - qz) * ux;
              d = Math.abs(side); valley = side < 0; top = level; much = fade[n - 1]; deep = lift[n - 1]; r = L;
            }
            if (much <= 0) continue;
            let want: number, far: number;
            if (valley) {
              // (its top, a little crowned, wider where it stands high over the bench and no wider than the way where it is low; its brow; its
              // flank down to the bench, steeper here and less steep there; and round its end before the gate, where it falls toward the wall)
              const wide = lerp(SH.top[0], SH.top[1], smoothstep(6, 30, L - r) * smoothstep(1.5, 5, deep)) * (0.78 + 0.22 * (1 + n1.noise(r * 0.05 + 3.3, 7.7))), fall = lerp(SH.fall[0], SH.fall[1], 0.5 + 0.5 * n2.noise(r * 0.045 + 9.1, 8.3));
              const out = Math.max(0, d - wide), dist = Math.hypot(out, past), k = dist > 0 ? (fall * out + SH.north * past) / (out + past) : fall;
              far = Math.max(d, dist);
              want = top - 0.012 * Math.min(d, wide) ** 2 - k * (Math.sqrt(dist * dist + SH.round ** 2) - SH.round) + SH.ragged * n3.noise(x * 0.07 + 1.9, z * 0.07) * Math.min(1, dist / 8);
            } else {
              // (toward the hill it rises a little and runs into the hillside; before the gate it falls toward the wall as the rest of its end does)
              far = past;
              want = top + SH.hill * d - SH.north * (Math.sqrt(past * past + 2.25) - 1.5) + 0.15 * n3.noise(x * 0.08 - 4.4, z * 0.08 + 2.2) * Math.min(1, d / 6);
            }
            // (raised to it where it stands over the ground that was; left where the ground stands over it; and the hollow of the join between the two rounded)
            const t = want - old[i], c = SH.soft, g = t <= -c ? 0 : t >= c ? t : ((t + c) * (t + c)) / (4 * c);
            const up = much * (1 - smoothstep(SH.reach - 10, SH.reach, far)) * g;
            if (up < 0.002) continue;
            heights[i] = old[i] + up;
            made[i] = up;
          }
      }
      // THE RAMP'S FOOT. The ramp is the plan's: so long, and its foot so far under the terrace. The shoulder's top
      // is made to the height that foot comes down to. Here it is trimmed to the boards: under them the ground is let
      // down to clear them, at their foot and a pace beyond it is brought to the height they come down to, and from
      // there it runs out into the shoulder over a few paces. By `foot` metres at the very most, and nowhere else.
      {
        const C = CASTLE, S = CASTLE_SCALE, run = Math.sqrt(C.ramp.len ** 2 - C.ramp.drop ** 2), x0 = C.hx + C.parapet.thick / 2, gz = (C.gate.z0 + C.gate.z1) / 2, hw = (C.gate.z1 - C.gate.z0) / 2, [fx, , fz] = castleAt(fort, x0 + run, gz), as = heights.slice();
        for (let iz = Math.floor((fz - 18 + half) / CELL); iz <= Math.ceil((fz + 18 + half) / CELL); iz++)
          for (let ix = Math.floor((fx - 18 + half) / CELL); ix <= Math.ceil((fx + 18 + half) / CELL); ix++) {
            const i = idx(ix, iz), [lx, lz] = castleLocal(fort, -half + ix * CELL, 0, -half + iz * CELL), u = lx - x0, side = Math.max(0, Math.abs(lz - gz) - hw);
            if (u < 0.9 || u > run + 4.5 || side > 3) continue;
            const b = as[i], level = F.terrace - S * C.ramp.drop - 0.18, deck = F.terrace - (S * C.ramp.drop * Math.min(u, run)) / run;
            // (under the boards: only ever let down; at their foot, to their height; beyond it, back to the land's own)
            const want = u < run - 1.4 ? Math.min(b, deck - lerp(0.3, 0.8, smoothstep(1.4, 4, run - u))) : u <= run + 0.7 ? level : lerp(level, b, smoothstep(0.7, 4.5, u - run));
            heights[i] = clamp(lerp(b, want, 1 - smoothstep(0.4, 3, side)), b - F.foot, b + F.foot);
          }
      }

      // The cart track (see MOUNTAIN.track): laid on the ground as the ground is, evened along itself as a way that
      // has been driven is. Level across its bed; its banks are the ground brought to it over a few metres. Neither
      // its bed nor its banks keep one width.
      const T = M.track, track = catmullRom(T.line, 2), tDist = new Float32Array(N * N).fill(1e9);
      {
        // How high it lies: the ground's own height under it, evened over a few paces only (a cart's wheels wear
        // a hump down and a hollow fills; they do not build a causeway: the roads' own rule evens fifty metres at
        // a time, and stood this bed a metre and a half over a dip), nowhere steeper than a cart is drawn up, and
        // with no sudden change in its climb. It begins at the road's end, at the road's height; where it ends,
        // between the houses, its bed is the ground's own height and runs out into it.
        const raw = track.map(([x, z]) => heightAt(heights, x, z)), runs = runOf(track);
        const ty = raw.map((_, k) => {
          const n = T.evens;
          let sum = 0, c = 0;
          for (let q = -n; q <= n; q++) {
            const w = 1 - Math.abs(q) / (n + 1);
            sum += raw[clamp(k + q, 0, raw.length - 1)] * w;
            c += w;
          }
          return sum / c;
        });
        ty[0] = raw[0];
        ty[ty.length - 1] = raw[raw.length - 1];
        for (let pass = 0; pass < 5; pass++) {
          for (let again = 0; again < 2; again++) {
            const src = ty.slice();
            for (let k = 1; k < ty.length - 1; k++) ty[k] = (src[k - 1] + 2 * src[k] + src[k + 1]) / 4;
          }
          // (the least climb that still comes to each end, and the most: between the two, as the ground has it)
          for (let k = 1; k < ty.length - 1; k++) ty[k] = clamp(ty[k], ty[k - 1] - T.steep * (runs[k] - runs[k - 1]), ty[k - 1] + T.steep * (runs[k] - runs[k - 1]));
          for (let k = ty.length - 2; k > 0; k--) ty[k] = clamp(ty[k], ty[k + 1] - T.steep * (runs[k + 1] - runs[k]), ty[k + 1] + T.steep * (runs[k + 1] - runs[k]));
        }
        // (and its brows and its feet rounded once more: no sudden change in its climb)
        for (let again = 0; again < 3; again++) {
          const src = ty.slice();
          for (let k = 2; k < ty.length - 1; k++) ty[k] = (src[k - 1] + 2 * src[k] + src[k + 1]) / 4;
        }
        const tH = new Float32Array(N * N), tR = new Float32Array(N * N), tS = new Int8Array(N * N), most = T.reach, moved = new Float32Array(N * N);
        for (let s = 0; s < track.length - 1; s++) {
          const [ax, az] = track[s], [bx, bz] = track[s + 1], dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
          for (let iz = Math.max(0, Math.floor((Math.min(az, bz) - most - 4 + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((Math.max(az, bz) + most + 4 + half) / CELL)); iz++)
            for (let ix = Math.max(0, Math.floor((Math.min(ax, bx) - most - 4 + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((Math.max(ax, bx) + most + 4 + half) / CELL)); ix++) {
              const x = -half + ix * CELL, z = -half + iz * CELL, t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1), d = Math.hypot(x - (ax + dx * t), z - (az + dz * t)), i = idx(ix, iz);
              if (d >= tDist[i]) continue;
              tDist[i] = d;
              tH[i] = lerp(ty[s], ty[s + 1], t);
              tR[i] = lerp(runs[s], runs[s + 1], t);
              tS[i] = (x - ax) * dz - (z - az) * dx > 0 ? 1 : -1;
            }
        }
        for (let i = 0; i < N * N; i++) {
          const d = tDist[i];
          if (d >= most) continue;
          const r = tR[i], bed = lerp(T.bed[0], T.bed[1], 0.5 + 0.5 * n1.noise(r * 0.085 + 4.2, 11.7)), bank = lerp(T.bank[0], T.bank[1], 0.5 + 0.5 * n2.noise(r * 0.06 - 8.1, 3.9 + tS[i] * 5.3));
          // Its banks: beside the bed the ground stands no higher over it than a bank of that slope would, and lies
          // no lower under it. Where the ground was already within that, which is most of the way, it is not moved.
          // (Not the road's own last metres, where it begins. Where it ends, between the houses, its bed ends at the
          // ground's own height, and its banks round its end are the same few metres of ground eased to it: no yard is levelled there.)
          // (Along the hill's foot, from where it turns north, the hill stands over it as the hill stands: only the
          // edge of its bed is eased into the slope. A bank of a cart's own laid back into that hillside is a
          // cutting fifteen metres wide.)
          const out = Math.max(0, d - bed), b = heights[i], hill = smoothstep(T.hill.from, T.hill.from + 16, r);
          let by = clamp(b, tH[i] - bank * out, tH[i] + lerp(bank, Math.max(bank, T.hill.bank), hill) * out) - b;
          // (and nothing of the hill is taken more than a few paces from the bed's edge, however steep it stands there)
          if (by < 0) by *= 1 - hill * smoothstep(2, 5, out);
          moved[i] = by * (1 - smoothstep(most - 5, most, d)) * smoothstep(0, 2, r) * smoothstep(0, 3, fortD[i]);
          // (trodden bare: the paint's own edge wanders half a metre and fades)
          if (d < T.worn + 1.6) trackDist[i] = Math.min(trackDist[i], Math.max(0, d - (T.worn - 1.4)));
        }
        // (the tops and feet of its banks rounded: what was moved is evened over a few metres, twice; not its bed)
        for (let pass = 0; pass < 2; pass++) {
          const src = moved.slice();
          for (let i = N + 1; i < N * N - N - 1; i++) {
            if (tDist[i] >= most + 4 || tDist[i] < T.bed[0]) continue;
            const even = (src[i] * 4 + (src[i - 1] + src[i + 1] + src[i - N] + src[i + N]) * 2 + src[i - N - 1] + src[i - N + 1] + src[i + N - 1] + src[i + N + 1]) / 16;
            moved[i] = lerp(src[i], even, smoothstep(T.bed[0], T.bed[1] + 1, tDist[i]));
          }
        }
        for (let i = 0; i < N * N; i++) if (moved[i]) heights[i] += moved[i];
      }
      // WHAT IS WALKED (see MOUNTAIN.foot): the lane from the track to the three houses off the way, and the few
      // paces from each house's door to the nearest of the ways. Each a trodden line and nothing else: the
      // ground's paint and no more. NO EARTH IS MOVED for any of them.
      const footD = new Float32Array(N * N).fill(1e9), houses = castleLoose(fort).filter((l) => l.kind === 'house'), foots: [number, number][][] = [];
      const turnAt = track[track.length - 1], worn: Worn[] = [];
      {
        const none = new Float32Array(N * N), way = catmullRom(M.foot.line, 2), doors: [number, number][][] = [];
        for (const h of houses) {
          // (its door, in the wall as the wall stands: the houses are a fifth bigger than their own measure, as the fort is)
          const sh = HOUSES[h.n], c = Math.cos(h.rot), s = Math.sin(h.rot), lx = (-sh.w / 2 + sh.w * 0.4 + 0.6) * CASTLE_SCALE, lz = ((sh.door * sh.d) / 2) * CASTLE_SCALE, door: [number, number] = [h.x + lx * c + lz * s, h.z - lx * s + lz * c];
          let to = track[0];
          for (const q of [...track, ...way]) if (Math.hypot(q[0] - door[0], q[1] - door[1]) < Math.hypot(to[0] - door[0], to[1] - door[1])) to = q;
          const far = Math.hypot(to[0] - door[0], to[1] - door[1]), t = Math.min(1, M.foot.doors / (far || 1));
          doors.push([door, [lerp(door[0], to[0], t), lerp(door[1], to[1], t)]]);
        }
        foots.push(way, ...doors);
        // (how worn each is: the path bare for a pace's width, a door's line less)
        for (const [lines, thin] of [[[way], 0.5], [doors, 0.9]] as [[number, number][][], number][]) {
          const d = new Float32Array(N * N).fill(1e9);
          for (const q of lines) rasterLine(q, null, 6, d, none);
          for (let i = 0; i < N * N; i++) {
            if (d[i] < 6) footD[i] = Math.min(footD[i], d[i]);
            if (d[i] < 2.2) trackDist[i] = Math.min(trackDist[i], d[i] + thin);
          }
        }
        for (const q of doors) worn.push({ line: q, r: 0.9, driven: false });
        /** ground worn bare about a spot: all of it out to `r` metres along `ux, uz` and `across` metres the other way, less a ragged edge */
        const bare = (x: number, z: number, r: number, across = r, ux = 1, uz = 0) => {
          const R = Math.max(r, across) + 2.5;
          for (let iz = Math.floor((z - R + half) / CELL); iz <= Math.ceil((z + R + half) / CELL); iz++)
            for (let ix = Math.floor((x - R + half) / CELL); ix <= Math.ceil((x + R + half) / CELL); ix++) {
              const dx = -half + ix * CELL - x, dz = -half + iz * CELL - z, d = Math.hypot((dx * ux + dz * uz) / r, (-dx * uz + dz * ux) / across) * Math.min(r, across) + 1.1 * n3.noise(ix * 0.7, iz * 0.7);
              if (d < Math.min(r, across) + 0.1) trackDist[idx(ix, iz)] = Math.min(trackDist[idx(ix, iz)], Math.max(0, d - (Math.min(r, across) - 2.3)));
            }
        };
        // (Where the track leaves the road's end the ground is worn in a splay nine metres wide: carts turned
        // there every way. Paint only: no earth is moved at the mouth.)
        const mx = (end[0] + track[4][0]) / 2 + 1.2, mz = (end[1] + track[4][1]) / 2 - 1.2;
        bare(mx, mz, 5.5);
        worn.push({ line: [[mx, mz]], r: 5.5, driven: true });
        // THE TURNING PLACE (see MOUNTAIN.track.turn): where the track ends before the gate, on the shoulder's top,
        // trampled and rutted. A cart's length longer along the track than across it, and set `aside` toward the
        // hill, where the top is broad: a cart stood beside the way there, clear of the ramp's foot.
        {
          const [px, pz] = track[track.length - 4], l = Math.hypot(turnAt[0] - px, turnAt[1] - pz) || 1, ux = (turnAt[0] - px) / l, uz = (turnAt[1] - pz) / l;
          const cx = turnAt[0] - ux * 1.2 - uz * T.aside, cz = turnAt[1] - uz * 1.2 + ux * T.aside;
          bare(cx, cz, T.turn + 1.2, T.turn, ux, uz);
          worn.push({ line: [[cx, cz]], r: T.turn, driven: true });
        }
        // (and where the lane ends between the three houses, where the track once did: trodden from one doorstep to the other)
        {
          const [lx, lz] = way[way.length - 1];
          bare(lx, lz, M.foot.yard);
          worn.push({ line: [[lx, lz]], r: M.foot.yard, driven: false });
        }
        // THE APRON before the ramp's foot (see MOUNTAIN.foot.apron): out from the foot along the ramp's own line.
        {
          const C = CASTLE, x0 = C.hx + C.parapet.thick / 2 + Math.sqrt(C.ramp.len ** 2 - C.ramp.drop ** 2), gz = (C.gate.z0 + C.gate.z1) / 2, A = M.foot.apron;
          const [ax, , az] = castleAt(fort, x0 + A.out / CASTLE_SCALE, gz), [bx, , bz] = castleAt(fort, x0, gz), l = Math.hypot(ax - bx, az - bz) || 1;
          bare(ax, az, A.half[0], A.half[1], (ax - bx) / l, (az - bz) / l);
          worn.push({ line: [[ax, az]], r: (A.half[0] + A.half[1]) / 2, driven: false });
        }
        // (and round the jeep that burns before the gate the snow is melted to wet ground: see castleJeep)
        {
          const j = castleJeep(fort);
          worn.push({ line: [[j.x, j.z]], r: 2.6, driven: false });
        }
      }

      // What grew or lay there: gone from the road, the track and the fort's place, from the houses along the track
      // and the ways to their doors, from the foot path and where the helicopter lies, and from between the track
      // and the gate; the rest stands on the ground as it is now.
      const inHouse = (x: number, z: number, pad: number) => houses.some((h) => {
        const c = Math.cos(h.rot), s = Math.sin(h.rot), dx = x - h.x, dz = z - h.z;
        return Math.abs(dx * c - dz * s) < HOUSES[h.n].w / 2 + pad && Math.abs(dx * s + dz * c) < HOUSES[h.n].d / 2 + pad;
      });
      // (the gate: in the middle of the gap in the wall at the head of the ramp)
      const gateAt = castleAt(fort, CASTLE.hx, (CASTLE.gate.z0 + CASTLE.gate.z1) / 2);
      // THE FIELD OF FIRE (see MOUNTAIN.felled): how far inside the felled wedge a spot is, metres (nothing or less:
      // outside it). Its sides and its far end are no ruled lines: they lie a few metres in and out, as a wood's edge does.
      const W = M.felled, wl = Math.hypot(W.to[0], W.to[1]), wx = W.to[0] / wl, wz = W.to[1] / wl;
      const felledAt = (x: number, z: number) => {
        const s = (x - W.from[0]) * wx + (z - W.from[1]) * wz, side = Math.abs(-(x - W.from[0]) * wz + (z - W.from[1]) * wx);
        return Math.min(s, W.long + W.ragged * n2.noise(x * 0.05 + 7.3, z * 0.05) - s, lerp(W.half[0], W.half[1], s / 90) + W.ragged * n3.noise(x * 0.06, z * 0.06) - side);
      };
      // (what is left of a felled tree, by a row of numbers of its own: set down when the rest is done)
      const rngF = new RNG(seed + 4423), left: Instance[] = [];
      for (const list of [trees, rocks, props]) {
        const clear = list === trees ? ROAD_W / 2 + 3.5 : ROAD_W / 2 + 2;
        for (let k = list.length - 1; k >= 0; k--) {
          const t = list[k], i = cell(t.x, t.z);
          // (a tree, in the way of the fort from where it is looked at as somebody comes in: see MOUNTAIN.seen)
          const hides = list === trees && M.seen.some(([sx, sz, wide = 2.5]) => {
            const dx = gateAt[0] - sx, dz = gateAt[2] - sz, u = clamp(((t.x - sx) * dx + (t.z - sz) * dz) / (dx * dx + dz * dz), 0, 1);
            return Math.hypot(t.x - (sx + dx * u), t.z - (sz + dz * u)) < 3.5 + wide * u;
          });
          // (how far from the track, the foot path and the fort it stands is measured from where it stands, not from the corner of the ground's net nearest it)
          const onTrack = tDist[i] < 12 && offLine(track, t.x, t.z) < (list === trees ? T.bed[1] + 2.4 : T.bed[1] + 1), onFoot = footD[i] < 5 && foots.some((q) => offLine(q, t.x, t.z) < 1.2);
          const atFort = footOf(t.x, t.z) < (list === trees ? F.clear : 2.5), atWreck = Math.hypot(t.x - M.wreck.x, t.z - M.wreck.z) < 7.5;
          const atTurn = Math.hypot(t.x - turnAt[0], t.z - turnAt[1]) < T.turn + (list === trees ? 3 : 1.5);
          if (mtDist[i] < clear || onTrack || atFort || onFoot || atTurn || atWreck || hides || inHouse(t.x, t.z, list === trees ? 2.5 : 1)) {
            list.splice(k, 1);
            continue;
          }
          // (a tree in the wedge: felled, but for a bush, which hides no wall, and the few left standing alone. Of the
          // felled, some left a stump and a few are a dead trunk still on its roots: on the ground as it is now)
          if (list === trees && !t.kind.startsWith('bush') && felledAt(t.x, t.z) > 0) {
            const roll = rngF.next() * 100, size = rngF.next();
            if (roll >= W.stands) {
              list.splice(k, 1);
              const y = heightAt(heights, t.x, t.z) - 0.05;
              if (roll < W.stands + W.trunks) left.push({ kind: 'dead_tree_trunk', x: t.x, y, z: t.z, rot: t.rot, scale: 0.9 + size * 0.4 });
              else if (roll < W.stands + W.trunks + W.stumps) left.push({ kind: 'tree_stump_01', x: t.x, y, z: t.z, rot: t.rot, scale: 0.8 + size * 0.4 });
              continue;
            }
          }
          const moved = heightAt(heights, t.x, t.z) - heightAt(was, t.x, t.z);
          if (moved) t.y += moved;
        }
      }
      props.push(...left);
      // (the firs by the hatch: set down after the ground round the fort was cleared, which would have taken them; last of the trees)
      F.firs.forEach(([x, z, kind, scale], k) => void trees.push({ kind, x, y: heightAt(heights, x, z), z, rot: 0.9 + k * 2.1, scale }));
      // What is set down about the place. A row of numbers of its own, the same every time: nothing else on the map
      // is told off differently for it.
      {
        const rngC = new RNG(seed + 4411), H = (x: number, z: number) => heightAt(heights, x, z);
        // The helicopter: on the hillside under the valley wall, where the wall's top looks down on it.
        wreck = { x: M.wreck.x, y: H(M.wreck.x, M.wreck.z), z: M.wreck.z, rot: M.wreck.rot };
        // THE DRY-STONE WALLS (see MOUNTAIN.walls, MOUNTAIN.wall): walls a farmer built and nobody has mended since.
        // Each is a row of spots a pace apart along its line, and at each spot the ground's height and how high the
        // wall stands over it there: that changes slowly along the wall and never by a step, comes down on a slant
        // to a course or two where it has fallen, and to nothing where a way that is walked goes through it and at
        // an end that is no house's. A length is what lies between two spots: its foot lies to the ground from one
        // to the other and its top from one height to the other, so that neither is a stair.
        const Q = M.wall, walked = foots.slice(0, 1);
        // (where the last wall ended and how high it stood there: one that begins at that spot turns a corner, and begins at that height)
        let ended: { x: number; z: number; high: number } | null = null;
        for (const [ax, az, bx, bz] of M.walls) {
          const long = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(long / Q.step)), phase = rngC.range(0, 40), thick = rngC.range(Q.thick[0], Q.thick[1]);
          // (where it has fallen: the middle of each such stretch, metres along it, and half its length)
          const fallen: [number, number][] = [];
          for (let s = rngC.range(Q.falls[0] * 0.5, Q.falls[1]); s < long - 2; s += rngC.range(Q.falls[0], Q.falls[1])) fallen.push([s, rngC.range(Q.gap[0], Q.gap[1]) / 2]);
          // (its far end, if no other wall begins there: it runs out)
          const free = !M.walls.some((o) => Math.hypot(o[0] - bx, o[1] - bz) < 0.5);
          const spots = Array.from({ length: n + 1 }, (_, k) => {
            const s = (k / n) * long, x = lerp(ax, bx, k / n), z = lerp(az, bz, k / n);
            let high = lerp(Q.high[0], Q.high[1], 0.5 + 0.5 * n1.noise(s * 0.16 + phase, phase * 1.7)) + 0.07 * n3.noise(s * 1.9 + phase, 4.4);
            for (const [at, halfGap] of fallen) high = Math.min(high, lerp(0.24 + 0.1 * n3.noise(s * 0.9, phase), high, smoothstep(halfGap - 0.3, halfGap + 1, Math.abs(s - at))));
            if (free) high *= smoothstep(-0.2, 1.8, long - s);
            if (ended && Math.hypot(ended.x - ax, ended.z - az) < 0.5) high = lerp(ended.high, high, smoothstep(0, 2.4, s));
            const off = Math.min(...walked.map((q) => offLine(q, x, z)));
            return { x, z, g: H(x, z), high: high * smoothstep(1.3, 2.6, off) };
          });
          ended = { x: bx, z: bz, high: spots[n].high };
          for (let k = 0; k < n; k++) {
            const a = spots[k], b = spots[k + 1], high = (a.high + b.high) / 2;
            if (high < 0.1) continue;
            walls.push({ x: (a.x + b.x) / 2, y: (a.g + b.g) / 2, z: (a.z + b.z) / 2, yaw: Math.atan2(-(bz - az), bx - ax), long: long / n, high, thick: thick * (high < 0.45 ? 1.25 : 1), rise: b.g - a.g, top: b.high - a.high, down: high < 0.45 });
          }
        }
      }
      for (let i = 0; i < N * N; i++) {
        if (!(mtDist[i] < M.banks.reach + 4 || tDist[i] < 16 || fortD[i] < 50 || footD[i] < 6 || made[i] > 0 || made[i - 1] > 0 || made[i + 1] > 0 || made[i - N] > 0 || made[i + N] > 0)) continue;
        if (Math.abs(heights[i] - was[i]) < 0.02 && mtDist[i] > 22 && tDist[i] > 8 && footD[i] > 5) continue;
        paint(i % N, Math.floor(i / N));
        // (the ground that is seen: as the ground is. Where the fort's cuts are made, below, it stays as it is here.)
        if (surface) surface[i] = heights[i];
      }
      // What the fort asks to be cut (`castleCuts`): the ground let down out of its lower levels, the stairwell of its
      // hatch and a strip along the whole passage between them. LAST OF ALL: after everything that shapes this ground
      // (nothing laid later can fill it in again), after the ground is painted (the fort lays earth back over the cut
      // with the ground's own paint, and what is painted there must be the ground that was, not the floor of a
      // trench), and after everything is set down (what stands over the passage stands on the ground that is seen,
      // not in the cut). The ground the fort is told of (`surface`, where the lid lies) is the ground as all of that
      // left it.
      {
        const asItIs = heights.slice(), down = new Set<number>();
        for (const cut of castleCuts(fort, (x, z) => heightAt(asItIs, x, z))) {
          const xs = cut.well.map((q) => q[0]), zs = cut.well.map((q) => q[1]);
          for (let iz = Math.floor((Math.min(...zs) + half) / CELL); iz <= Math.floor((Math.max(...zs) + half) / CELL); iz++)
            for (let ix = Math.floor((Math.min(...xs) + half) / CELL); ix <= Math.floor((Math.max(...xs) + half) / CELL); ix++) {
              if (!squareTouches(cut.well, -half + ix * CELL, -half + iz * CELL, CELL)) continue;
              for (const i of [idx(ix, iz), idx(ix + 1, iz), idx(ix, iz + 1), idx(ix + 1, iz + 1)]) {
                if (heights[i] > cut.to && surface) {
                  surface[i] = asItIs[i];
                  down.add(i);
                }
                heights[i] = Math.min(heights[i], cut.to);
              }
            }
        }
        // WHAT IS SEEN AND STOOD ON WHERE IT WAS LET DOWN IS THE GROUND ITSELF (`FortLid`, in the fort's own file;
        // `seenGround`, below). Every square with a corner that was let down is told to the fort, but those wholly
        // under its own stone: asked at the square's corners and at a few spots within it, at the height the ground
        // had. (And the ground the fort is told of is exactly the ground as it was at every corner of every such
        // square, not only at the corners let down: where the mountain's shaping moved a corner by under two
        // centimetres it was not told to `surface`, and a lid laid by one height over ground drawn by the other is
        // two surfaces again.)
        if (surface && down.size) {
          const wells = castleOpen(fort), squares: { x: number; z: number; open: boolean; low: number }[] = [], had = new Set<number>();
          for (const i of [...down].sort((a, b) => a - b)) for (const k of [i, i - 1, i - N, i - N - 1]) {
            if (had.has(k)) continue;
            had.add(k);
            for (const c of [k, k + 1, k + N, k + N + 1]) if (!down.has(c)) surface[c] = asItIs[c];
            const x = -half + (k % N) * CELL, z = -half + Math.floor(k / N) * CELL;
            let seen = false;
            for (let a = 0; a <= 4 && !seen; a++) for (let b = 0; b <= 4 && !seen; b++) seen = !castleHides(fort, x + (a * CELL) / 4, heightAt(asItIs, x + (a * CELL) / 4, z + (b * CELL) / 4), z + (b * CELL) / 4);
            if (seen) squares.push({ x, z, open: wells.some((w) => squareTouches(w, x, z, CELL)), low: Math.min(heights[k], heights[k + 1], heights[k + N], heights[k + N + 1]) });
          }
          fort.lid = { cell: CELL, squares };
        }
      }
      // (a lesser road: a street's asphalt, which lies under the edge of the pass road's where it leaves it and breaks up where it stops)
      roads.push({ points: points(line, ys, line.length), width: M.wide, side: true });
      // (the ways that are not roads, each saying what it is: the track is driven, the lane to the houses is walked)
      paths.push({ line: T.line, driven: true }, { line: M.foot.line, driven: false });
      worns.push(...worn);
    }
  }

  // Where anybody starts. The ring of starts was laid before there was a bunker, or a town in the east: nobody
  // is now set down by the bunker (the last place on the map and the best), nor between the valley and the town.
  // The ring itself is kept as it was first made (`spawnRing`), for whatever tells the old map by it.
  const starts = spawns.filter((sp) => Math.hypot(sp.x - BUNKER_AT.x, sp.z - BUNKER_AT.z) > NO_START.bunker && Math.hypot(sp.x - TOWN.gate.x, sp.z - TOWN.gate.z) > NO_START.gate && Math.hypot(sp.x - TOWN.x, sp.z - TOWN.z) > NO_START.town);

  return {
    heights,
    surface: surface ?? heights,
    splat,
    grass,
    road: { points: roadPts, width: ROAD_W },
    roads,
    bridges,
    paths,
    worn: worns,
    wreck,
    walls,
    gatehouse,
    castle,
    buildings,
    trees,
    rocks,
    props,
    pois,
    sites,
    solids,
    spawn: starts[0],
    spawns: starts,
    spawnRing: spawns,
  };
}
