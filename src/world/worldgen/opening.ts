// THE SQUARE OPENED TO THE WEST (2026-10-16, plan v2), done to the square when everything of it is made and before it
// is laid into the world (see `toWorld`, west.ts). The owner: "open up the werst side of the map and rid the mountains
// if you must for good transition but leave the east vibes kamenka doesnt need to be touched"; and of the bunker,
// "far enough to where it doesnt render with the castle". So:
//   - the bunker's hillside is given back as it was before the bunker was cut into it, and the bunker goes west;
//   - the trading post's buildings go west, to beside the main road (its yard is left a clearing);
//   - the ring of hills west of the valley comes down to the green land the west is (`openGround`), the works kept
//     in its cirque; the two roads over it are laid again on the ground as it now is;
//   - the small clutter of the west half is thinned.
// The square is made exactly as it always was before any of this: east of x 0 nothing else is touched, to the byte.

import { clamp, hash2, smoothstep, lerp, type Simplex } from '../../core/noise';
import { BUNKER } from '../../sim/bunker';
import { heightAt } from './ground';
import { TRADE_WAS } from './layout';
import { BUNKER_AT, BUNKER_WAS, CELL, EXPANSION, SQUARE_HALF, SQUARE_RES } from './places';
import { SNOW } from './layout';
import { openGround } from './west';
import { bed, movedPost, openness } from './west-plan';
import type { BuildingPlot } from './layout';
import type { Instance, POI, Site } from './types';

/** what the last stage needs of how the square was made (filled in by generateWorld as it goes) */
export interface Kept {
  /** the trading post's own buildings: their numbers, first and one past the last */
  trade: [number, number];
  /** the bunker's ground before it was cut and after, how far about it that reaches, and what it took away */
  bunker: { before: Float32Array | null; after: Float32Array | null; reach: number; taken: [Instance[], Instance][] };
}

export interface Square {
  heights: Float32Array;
  surface: Float32Array;
  splat: Uint8Array;
  grass: Uint8Array;
  /** how far each spot is from a road (generateWorld's `roadDist`: every road the square has) */
  roadDist: Float32Array;
  /** the road's width there (ROAD_W) */
  roadWidth: number;
  trees: Instance[];
  rocks: Instance[];
  props: Instance[];
  sites: Site[];
  pois: POI[];
  buildings: BuildingPlot[];
  roads: { points: Float32Array; width: number }[];
  /** the square's own paint rule for one sample of its net (generateWorld's `paint`) */
  paint: (ix: number, iz: number) => void;
  noise: [Simplex, Simplex, Simplex];
  kept: Kept;
}

/** the opening's numbers: where it begins east of the seam (x, metres), and how much the works' cirque is kept */
export const OPENING = {
  /** the hills come down from here west: not at all at the first, wholly by the second */
  from: [-380, -560] as const,
  /** the works and its cirque are kept whole within the first of its middle, lowered more and more to the second; and
   * about it the land comes down only to a broad hill, of this height at the first and none past the third: the works
   * in its hollow on top, and the loop able to come down off the high ground behind it */
  works: [EXPANSION.floor + EXPANSION.wall + 10, EXPANSION.floor + EXPANSION.wall + 60] as const,
  hill: { top: 72, r: [150, 470] as const },
  /** a road over the lowered ground: its rise at most, to the metre (the loop's own climb out of Kamenka is 0.13), how
   * far its bed is laid out to either side, and how steeply the ground falls from it where it stands over it (a spur)
   * and rises from it where it lies under (a bank) */
  steep: 0.12,
  bed: 12,
  fill: 0.35,
  cut: 0.6,
  /** the clutter thinned on the square's west half: kinds, how much of it is kept, and how far about a named place it is left */
  clutter: ['fern_02', 'dry_branches_medium_01', 'tree_stump_01', 'dead_tree_trunk', 'old_tyre'],
  keep: 0.45,
  places: 25,
};

/** how much the ground at a spot of the square is brought down to the green land (0 to 1) */
export function openingAt(x: number, z: number) {
  const w = smoothstep(-OPENING.from[0], -OPENING.from[1], -x) * openness(z);
  if (w <= 0) return 0;
  return w * smoothstep(OPENING.works[0], OPENING.works[1], Math.hypot(x - EXPANSION.x, z - EXPANSION.z));
}

export function openSquare(sq: Square): void {
  const N = SQUARE_RES, half = SQUARE_HALF, H = sq.heights, was = H.slice();
  const at = (ix: number, iz: number) => [-half + ix * CELL, -half + iz * CELL] as const;

  // 1. THE BUNKER'S HILLSIDE, as it was before the bunker was cut into it: what the bunker's own stage did to the
  // ground is undone (whatever was done there since is kept), and what it took away is put back.
  const B = sq.kept.bunker, R = B.reach;
  const near: number[] = [];
  if (B.before && B.after) {
    for (let iz = Math.max(0, Math.floor((BUNKER_WAS.z - R + half) / CELL)); iz <= Math.min(N - 1, Math.ceil((BUNKER_WAS.z + R + half) / CELL)); iz++)
      for (let ix = Math.max(0, Math.floor((BUNKER_WAS.x - R + half) / CELL)); ix <= Math.min(N - 1, Math.ceil((BUNKER_WAS.x + R + half) / CELL)); ix++) {
        const i = iz * N + ix, d = B.before[i] - B.after[i];
        if (d === 0) continue;
        H[i] += d;
        sq.surface[i] = H[i];
        near.push(i);
      }
  }
  const bunker = sq.sites.find((s) => s.kind === 'bunker'), bp = sq.pois.find((p) => p.name === BUNKER.name);
  if (bunker) Object.assign(bunker, { x: BUNKER_AT.x, z: BUNKER_AT.z, rot: Math.atan2(BUNKER_AT.face[0], BUNKER_AT.face[1]) });
  if (bp) Object.assign(bp, { x: BUNKER_AT.x, z: BUNKER_AT.z });

  // 2. THE TRADING POST: its buildings where they stood to its yard, about its new place (`movePost`, by the road).
  const post = sq.sites.find((s) => s.kind === 'market');
  if (post) {
    const c0 = Math.cos(post.rot), s0 = Math.sin(post.rot), to = movedPost();
    const c1 = Math.cos(to.rot), s1 = Math.sin(to.rot);
    for (let k = sq.kept.trade[0]; k < sq.kept.trade[1]; k++) {
      const b = sq.buildings[k], dx = b.x - TRADE_WAS.x, dz = b.z - TRADE_WAS.z;
      const right = dx * c0 - dz * s0, fwd = dx * s0 + dz * c0;
      Object.assign(b, { x: to.x + right * c1 + fwd * s1, z: to.z - right * s1 + fwd * c1, rot: b.rot - post.rot + to.rot });
    }
    Object.assign(post, { x: to.x, z: to.z, rot: to.rot });
    const pp = sq.pois.find((p) => p.name === post.name);
    if (pp) Object.assign(pp, { x: to.x, z: to.z });
  }

  // 3. THE WEST OPENED: the ground brought down to the green land wherever it stands above it, by `openingAt`.
  const iw0 = Math.ceil((OPENING.from[0] + half) / CELL);
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix <= iw0; ix++) {
    const [x, z] = at(ix, iz), w = openingAt(x, z);
    if (w <= 0) continue;
    const r = Math.hypot(x - EXPANSION.x, z - EXPANSION.z), o = openGround(sq.noise, x, z);
    const g = Math.max(o, lerp(o, OPENING.hill.top, Math.pow(1 - smoothstep(OPENING.hill.r[0], OPENING.hill.r[1], r), 1.3)));
    const i = iz * N + ix;
    if (H[i] > g) H[i] -= w * (H[i] - g);
  }
  // The roads over it laid again: the ground's own height along each, evened out over fifty metres of it, as much of
  // that as the ground was brought down there, nowhere steeper than OPENING.steep; and their beds brought to them. A
  // point of one that lies on another (the old road's first points are the loop's last) is given the other's height.
  const done: Float32Array[] = [];
  const order = sq.roads.filter((r) => { for (let i = 0; i < r.points.length; i += 3) if (openingAt(r.points[i], r.points[i + 2]) > 0) return true; return false; })
    .sort((a, b) => b.points.length - a.points.length);
  for (const r of order) {
    const p = r.points, n = p.length / 3;
    const w = Array.from({ length: n }, (_, k) => openingAt(p[k * 3], p[k * 3 + 2]));
    const raw = Array.from({ length: n }, (_, k) => heightAt(H, clamp(p[k * 3], -half, half), clamp(p[k * 3 + 2], -half, half)));
    const ys = raw.map((_, k) => {
      let sum = 0, c = 0;
      for (let j = -12; j <= 12; j++) { const q = 1 - Math.abs(j) / 13; sum += raw[clamp(k + j, 0, n - 1)] * q; c += q; }
      return lerp(p[k * 3 + 1], sum / c, w[k]);
    });
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 1; k < n; k++) if (w[k] > 0) { const m = OPENING.steep * Math.hypot(p[k * 3] - p[k * 3 - 3], p[k * 3 + 2] - p[k * 3 - 1]); ys[k] = clamp(ys[k], ys[k - 1] - m, ys[k - 1] + m); }
      for (let k = n - 2; k >= 0; k--) if (w[k] > 0) { const m = OPENING.steep * Math.hypot(p[k * 3] - p[k * 3 + 3], p[k * 3 + 2] - p[k * 3 + 5]); ys[k] = clamp(ys[k], ys[k + 1] - m, ys[k + 1] + m); }
    }
    for (let k = 0; k < n; k++) {
      if (w[k] <= 0) continue;
      let y = ys[k];
      for (const q of done) for (let j = 0; j < q.length; j += 3) if (Math.abs(q[j] - p[k * 3]) < 0.05 && Math.abs(q[j + 2] - p[k * 3 + 2]) < 0.05) y = q[j + 1];
      p[k * 3 + 1] = y;
    }
    done.push(p);
  }
  // (the beds: level with the road across it and its verges, eased into the ground over OPENING.bed beyond them; a spur
  // under the road where it stands over the lowered ground, but no higher than the ground was; banks taken back)
  for (const r of order) bed(H, r.points, r.width, OPENING.bed, openingAt, undefined, { fill: OPENING.fill, cut: OPENING.cut, cap: was });

  // 4. Painted again wherever the ground was moved: where the bunker was, by the square's own rule whole; on the lowered
  // west, by its rule for rock (by the slope as it is now: the old rim's faces are hillsides), the rest of what was
  // laid there (the woods' floor, a road's verge, a yard) kept as it was laid, and the grass as the rule grows it.
  const [n1, , n3] = sq.noise, S = sq.splat, G = sq.grass;
  for (let iz = 1; iz < N - 1; iz++) for (let ix = 1; ix <= iw0 && ix < N - 1; ix++) {
    const i = iz * N + ix;
    if (Math.abs(H[i] - was[i]) <= 0.05) continue;
    const [x, z] = at(ix, iz), slope = Math.hypot(H[i + 1] - H[i - 1], H[i + N] - H[i - N]) / (2 * CELL);
    const rock = slope < 0.39 ? 0 : clamp(smoothstep(0.5, 0.85, slope + 0.1 * n3.noise(x * 0.05, z * 0.05)), 0, 1);
    const r0 = S[i * 4 + 2] / 255, keep = r0 < 0.98 ? 1 / (1 - r0) : 0;
    const forest = (S[i * 4 + 1] / 255) * keep * (1 - rock), gravel = (S[i * 4 + 3] / 255) * keep * (1 - rock);
    const grassW = Math.max(0, 1 - rock - forest - gravel), sum = grassW + forest + rock + gravel || 1;
    S[i * 4] = Math.round((grassW / sum) * 255);
    S[i * 4 + 1] = Math.round((forest / sum) * 255);
    S[i * 4 + 2] = Math.round((rock / sum) * 255);
    S[i * 4 + 3] = Math.round((gravel / sum) * 255);
    let g = (grassW / sum + 0.45 * (forest / sum)) * (1 - smoothstep(0.2, 0.5, gravel / sum));
    if (sq.roadDist[i] < sq.roadWidth / 2 + 0.6) g = 0;
    g *= (0.75 + 0.25 * n1.noise(x * 0.08, z * 0.08)) * (1 - smoothstep(SNOW.from - 10, SNOW.from + 8, H[i]));
    G[i] = Math.round(clamp(g, 0, 1) * 255);
  }
  for (const i of near) sq.paint(i % N, Math.floor(i / N));
  for (const list of [sq.trees, sq.rocks, sq.props]) for (const t of list) {
    if (t.x > half || t.x < -half) continue;
    const d = heightAt(H, t.x, t.z) - heightAt(was, t.x, t.z);
    if (d !== 0) t.y += d;
  }
  if (sq.surface !== H) for (let i = 0; i < N * N; i++) if (H[i] !== was[i] && sq.surface[i] === was[i]) sq.surface[i] = H[i];
  // (and what the bunker took away put back, where it stood on the ground as it was: as it is again)
  for (const [list, t] of B.taken) list.push(t);

  // 5. THE CLUTTER of the west half thinned: of fern, branches, stumps, dead trunks and old tyres west of x 0 a little
  // under half is kept, and all of it at and about every named place.
  const kinds = new Set(OPENING.clutter);
  for (let k = sq.props.length - 1; k >= 0; k--) {
    const t = sq.props[k];
    if (t.x >= 0 || t.x < -half || !kinds.has(t.kind.split(/[#@]/)[0])) continue;
    if (sq.pois.some((q) => Math.hypot(q.x - t.x, q.z - t.z) < q.radius + OPENING.places)) continue;
    if (hash2(Math.round(t.x * 10), Math.round(t.z * 10), 515) > OPENING.keep) sq.props.splice(k, 1);
  }
}
