// The canyon country's outcrops (the owner, 2026-10-16: "we need more rock outcroppings as well, but the mesh should
// blend"): rock where nature leaves it, from the coast kit's Namaqualand scans. Read off the world's own ground (the
// same on every machine): blocks and rubble fallen at the foot of a face, heaped toward it; a cliff jutting from a steep
// face to break its line; a ledge of rock on a lip and boulders sat on its edge; a line of rubble down a gully. In
// clusters, where a slow noise says so, and gaps between: never a lattice. Over the desert with its buttes and the
// ridge's two faces; not in the pass (its walls are dressed by its plan: src/sim/pass.ts rockPieces), nor on a road, a
// river, a town, Kalat, a start, a cave's mouth, or on the boulders the world already lies about (world.rocks). Each
// piece sunk to under the lowest ground round its foot, so that nothing of it floats; its material fades into the
// ground (src/world/rock-blend.ts). Drawn and made solid by a RockField (src/world/rock-field.ts).

import { hash2 } from '../core/noise';
import { caveMouths, type Pass } from '../sim/pass';
import type { FieldPiece } from './rock-field';
import { PLAN, SEA_LEVEL, WORLD_X0, WORLD_Z0, WORLD_Z1, heightAt, passLine, ridgeAt, type World } from './worldgen';

export const OUTCROPS = {
  /** metres between the points the ground is read at (each moved about within its cell) */
  grid: 7,
  /** how much of the country is in a cluster (the share of a slow noise over this), and its size in metres */
  cluster: 0.5,
  clusterSize: 85,
  /**
   * the most of each: pieces that jut from faces and ledges, fallen blocks, rubble (a backstop never reached: the
   * country is read north to south, and a cap reached would leave its south bare)
   */
  big: 500,
  medium: 2600,
  small: 5000,
  /** metres kept clear round a road's edge, a river's, a building, a mouth, a start, Kalat's middle */
  clear: { road: 4, river: 3, building: 22, mouth: 14, start: 35, kalat: 170, boulder: 3 },
};

/** how tall and long each piece is as it came (metres), for its size against the ground it stands in */
const SIZE: Record<string, { tall: number; long: number }> = {
  namaqualand_cliff_02: { tall: 7.2, long: 20.2 },
  namaqualand_cliff_01: { tall: 5, long: 8.3 },
  mountainside: { tall: 10.5, long: 10.2 },
  namaqualand_boulder_02: { tall: 0.9, long: 2.5 },
  namaqualand_boulder_03: { tall: 1.5, long: 2.4 },
  namaqualand_boulder_04: { tall: 1.9, long: 2.5 },
  namaqualand_boulder_05: { tall: 0.5, long: 1.4 },
};

/** the outcrops of a world: its ground read for faces, feet, lips and gullies (see the head of this file) */
export function outcropPieces(world: World, pass: Pass): FieldPiece[] {
  const H = world.heights, h = (x: number, z: number) => heightAt(H, x, z), O = OUTCROPS, G = O.grid;
  const out: FieldPiece[] = [], count = { big: 0, medium: 0, small: 0 };
  const seed = 9137, r = (a: number, b: number, k: number) => hash2(Math.round(a * 13), Math.round(b * 13), seed + k);
  // (a slow noise for where the clusters are: smooth, from a coarse net of hashes)
  const cluster = (x: number, z: number) => {
    const S = O.clusterSize, gx = x / S, gz = z / S, ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz), c = (a: number, b: number) => hash2(a, b, seed + 1);
    return (c(ix, iz) * (1 - sx) + c(ix + 1, iz) * sx) * (1 - sz) + (c(ix, iz + 1) * (1 - sx) + c(ix + 1, iz + 1) * sx) * sz;
  };
  // ---- what is to be kept clear, laid on a net of its own (8 m) once
  const N = 8, clearAt = new Set<number>(), key = (x: number, z: number) => Math.floor((x - WORLD_X0) / N) * 100003 + Math.floor((z - WORLD_Z0) / N);
  const mark = (x: number, z: number, rad: number) => {
    for (let dx = -rad; dx <= rad; dx += N / 2) for (let dz = -rad; dz <= rad; dz += N / 2) if (dx * dx + dz * dz <= rad * rad + N * N) clearAt.add(key(x + dx, z + dz));
  };
  // (a road's points are x, y, z)
  for (const rd of [world.road, ...(world.roads ?? [])]) for (let i = 0; i + 1 < rd.points.length / 3; i++) {
    const ax = rd.points[i * 3], az = rd.points[i * 3 + 2], bx = rd.points[i * 3 + 3], bz = rd.points[i * 3 + 5], len = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d <= len; d += N / 2) mark(ax + ((bx - ax) * d) / (len || 1), az + ((bz - az) * d) / (len || 1), rd.width / 2 + O.clear.road);
  }
  for (const rv of world.water?.rivers ?? []) for (const [x, z, , w] of rv.pts) mark(x, z, w / 2 + O.clear.river);
  for (const b of world.buildings) mark(b.x, b.z, O.clear.building);
  for (const m of caveMouths(pass)) mark(m.x, m.z, O.clear.mouth);
  for (const z of PLAN.starts.z) mark(PLAN.starts.x, z, O.clear.start);
  if (world.kalat) mark(world.kalat.x, world.kalat.z, O.clear.kalat);
  const boulders = new Set<number>();
  for (const b of world.rocks ?? []) boulders.add(Math.floor(b.x / O.clear.boulder) * 100003 + Math.floor(b.z / O.clear.boulder));
  const onBoulder = (x: number, z: number) => boulders.has(Math.floor(x / O.clear.boulder) * 100003 + Math.floor(z / O.clear.boulder));
  const lakeAt = (x: number, z: number) => (world.water?.lakes ?? []).some((l) => {
    let yes = false;
    for (let i = 0, j = l.outline.length - 1; i < l.outline.length; j = i++) {
      const [xi, zi] = l.outline[i], [xj, zj] = l.outline[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) yes = !yes;
    }
    return yes;
  });
  const free = (x: number, z: number) => !clearAt.has(key(x, z)) && !onBoulder(x, z) && h(x, z) > SEA_LEVEL + 1 && !lakeAt(x, z);
  // ---- a piece stood with its foot under the lowest ground round it (nothing of it floats), its share sunk further;
  // none whose reach is over what is kept clear (a cliff 20 m long stood 4 m off a road's edge would lie across it)
  const stand = (id: string, x: number, z: number, turn: number, scale: number, sink: number, tilt: [number, number] = [0, 0], small = false) => {
    const s = SIZE[id], rad = (s.long * scale) / 2;
    let low = h(x, z);
    for (let a = 0; a < 6; a++) {
      const px = x + Math.cos(a * 1.047) * rad * 0.7, pz = z + Math.sin(a * 1.047) * rad * 0.7;
      if (!small && !free(px, pz)) return;
      low = Math.min(low, h(px, pz));
    }
    out.push({ id, at: [x, low - sink * s.tall * scale, z], turn, tilt, scale, ...(small ? { small: true } : {}) });
  };
  const grade = (k: 'big' | 'medium' | 'small') => (count[k] < O[k] ? (count[k]++, true) : false);
  // ---- the country: from the desert's western edge (the beach's sand behind it) to the ridge's eastern foot
  const pz = passLine.total;
  for (let gz = WORLD_Z0 + 20; gz < WORLD_Z1 - 20; gz += G) {
    const [, , ef] = ridgeAt(gz);
    for (let gx = PLAN.barrier + 220; gx < ef + 25; gx += G) {
      const x = gx + (r(gx, gz, 2) - 0.5) * G * 0.9, z = gz + (r(gz, gx, 3) - 0.5) * G * 0.9;
      const c = cluster(x, z);
      if (c < 1 - O.cluster || !free(x, z)) continue;
      // (not in the pass: its walls and shelves are its plan's)
      const near = passLine.near(x, z);
      if (near.d < PLAN.pass.floor + 55 && near.along > -20 && near.along < pz + 20) continue;
      const y0 = h(x, z), gxs = (h(x + 2, z) - h(x - 2, z)) / 4, gzs = (h(x, z + 2) - h(x, z - 2)) / 4, slope = Math.hypot(gxs, gzs);
      // (round it: the highest and the lowest ground six metres off, and which way each lies; and the highest twelve off,
      // for a face's foot: read six off only, the foot was a band four metres wide that the net stepped over half the time)
      let hi = -1e9, lo = 1e9, hiA = 0, loA = 0, ring = 0, far = -1e9, farA = 0;
      for (let a = 0; a < 10; a++) {
        const ang = (a / 10) * Math.PI * 2, y = h(x + Math.cos(ang) * 6, z + Math.sin(ang) * 6), y2 = h(x + Math.cos(ang) * 12, z + Math.sin(ang) * 12);
        ring += y / 10;
        if (y > hi) { hi = y; hiA = ang; }
        if (y < lo) { lo = y; loA = ang; }
        if (y2 > far) { far = y2; farA = ang; }
      }
      const inCluster = (c - (1 - O.cluster)) / O.cluster, pick = r(x, z, 7);
      // a steep face: now and then a cliff jutting from it, its face downhill, a third of it in the slope
      if (slope > 1.1 && pick < 0.05 + 0.1 * inCluster && grade('big')) {
        const relief = Math.min(14, Math.max(4, hi - lo)), ids = ['namaqualand_cliff_02', 'namaqualand_cliff_01', 'mountainside'], id = ids[Math.floor(r(x, z, 9) * 3)];
        stand(id, x, z, Math.atan2(-gxs, -gzs), (relief / SIZE[id].tall) * (0.7 + r(z, x, 11) * 0.4), 0.33, [(r(x, z, 13) - 0.5) * 0.15, (r(z, x, 13) - 0.5) * 0.15]);
        continue;
      }
      if (slope > 0.45) {
        // a gully (the ground round it higher than it, on a slope): rubble strung down it
        if (ring - y0 > 0.9 && pick < 0.25 + 0.3 * inCluster) {
          const dx = -gxs / slope, dz = -gzs / slope;
          for (let k = 0; k < 3 + Math.floor(r(x, z, 15) * 4); k++) {
            if (!grade('small')) break;
            const t = k * (1.4 + r(k, x, 16) * 1.6);
            stand(r(k, z, 17) < 0.65 ? 'namaqualand_boulder_05' : 'namaqualand_boulder_02', x + dx * t + (r(k, x, 18) - 0.5) * 1.5, z + dz * t + (r(x, k, 18) - 0.5) * 1.5, r(k, x, 19) * 6.28, 0.35 + r(x, k, 20) * 0.6, 0.12, [(r(k, z, 21) - 0.5) * 0.5, (r(z, k, 21) - 0.5) * 0.5], true);
          }
        }
        continue;
      }
      // the foot of a face (level ground, high ground close by): fallen blocks, and rubble heaped toward the face
      const foot = hi - y0 > 3.5 || far - y0 > 7;
      if (foot && pick < 0.45 + 0.45 * inCluster) {
        if (hi - y0 <= 3.5) hiA = farA;
        const fx = Math.cos(hiA), fz = Math.sin(hiA);
        for (let k = 0; k < 1 + Math.floor(r(z, x, 22) * 3); k++) {
          if (!grade('medium')) break;
          const id = r(x, z, 23 + k) < 0.5 ? 'namaqualand_boulder_04' : 'namaqualand_boulder_03', along = (r(k, z, 44) - 0.5) * 7, toward = 1.5 + r(z, k, 45) * 3;
          stand(id, x + fx * toward - fz * along, z + fz * toward + fx * along, r(x, z, 24 + k) * 6.28, 1 + r(z, x, 25 + k) * 1.6, 0.18, [(r(x, z, 26 + k) - 0.5) * 0.4, (r(z, x, 26 + k) - 0.5) * 0.4]);
        }
        for (let k = 0; k < 1 + Math.floor(r(x, z, 27) * 3); k++) {
          if (!grade('small')) break;
          const ang = hiA + (r(k, x, 28) - 0.5) * 2.4, d = 0.5 + r(x, k, 29) * 4;
          stand(r(k, z, 30) < 0.6 ? 'namaqualand_boulder_05' : 'namaqualand_boulder_02', x + Math.cos(ang) * d, z + Math.sin(ang) * d, r(k, x, 31) * 6.28, 0.3 + r(x, k, 32) * 0.7, 0.15, [(r(k, z, 33) - 0.5) * 0.6, (r(z, k, 33) - 0.5) * 0.6], true);
        }
        continue;
      }
      // a lip (level ground, a drop close by): a ledge of rock leaning out over it, or boulders sat on its edge
      if (y0 - lo > 3.5 && pick < 0.2 + 0.35 * inCluster) {
        const ox = Math.cos(loA), oz = Math.sin(loA);
        if (r(x, z, 34) < 0.35 && grade('big')) stand('namaqualand_cliff_01', x + ox * 2, z + oz * 2, Math.atan2(ox, oz), 0.55 + r(z, x, 35) * 0.5, 0.45, [0.25 + r(x, z, 36) * 0.2, (r(z, x, 36) - 0.5) * 0.2]);
        else for (let k = 0; k < 1 + Math.floor(r(x, z, 37) * 3); k++) {
          if (!grade('medium')) break;
          stand(r(k, x, 38) < 0.5 ? 'namaqualand_boulder_03' : 'namaqualand_boulder_02', x + ox * (1 + r(k, z, 39) * 2) + (r(x, k, 40) - 0.5) * 3, z + oz * (1 + r(k, z, 39) * 2) + (r(k, x, 40) - 0.5) * 3, r(k, z, 41) * 6.28, 0.7 + r(z, k, 42) * 1, 0.2, [(r(k, x, 43) - 0.5) * 0.4, (r(x, k, 43) - 0.5) * 0.4]);
        }
      }
    }
  }
  return out;
}
