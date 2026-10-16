// THE WEST'S PLAN (plan v2, the owner's yes 2026-10-16: marketing/zona-plan-map3b.png): where everything of the
// new ground goes, as numbers, and the questions only those numbers answer. The owner: "for the map i think it should
// blend in a lot ... desert is ugly the grass is prettier we can make new forests and biomes ... good map design
// common sense dynamic gameplay and unique is what we are looking for." West to east: a thin sea, the beach, a small
// desert fading through steppe into green land, the green land with a pine forest, birch woods and flower meadows,
// a monastery town and a hamlet on the main road, and today's valley opened onto it. Positions in world metres (x
// east, z south). What is drawn of it is west.ts; what is done to the square for it, opening.ts.

import { Simplex, clamp, lerp, smoothstep } from '../../core/noise';
import { CELL, SQUARE_HALF, SQUARE_RES, WORLD_SEED } from './places';
import type { Tier } from '../../sim/tiers';

type P = [number, number];

export const PLAN = {
  /** where the square is opened (see `openness`): fully from the second z to the third, not at all past the first and the fourth */
  open: [-620, -460, 400, 560] as const,
  /** the opened green land rises from the valley's floor at the square's rim (west of this many metres, as -x) to its own level by the second */
  rise: [380, 1100] as const,
  /** the bands of ground, by x: the beach's inland edge, the desert's, the steppe's, and where the green is whole */
  bands: { beach: -3520, sand: -3230, steppe: -2920, green: -2610 },
  /** nobody walks or drives west of this (an invisible wall: see game.ts; the server holds poses to it too) */
  barrier: -3525,
  /** the roads: the main one from the loop's west bend to the beach, and its branches (`via`: through the monastery's gates) */
  road: {
    main: [[-680, -61], [-1173, -81], [-1840, 5], [-2507, -28], [-3173, 32], [-3513, 25]] as P[],
    width: 6.5,
    /** the way to the bunker: off the main road, in by the monastery's south gate and out by its north, on to the bunker's yard */
    bunker: [[-1845, 8], [-1845, -10], [-1868, -56], [-1894, -103], [-1925, -260], [-1966, -420]] as P[],
    /** to the hamlet, and to the canyon's mouth (its first point joins the main road) */
    hamlet: [[-1173, -81], [-1176, 120], [-1180, 290]] as P[],
    canyon: [[-3007, 20], [-3007, -5], [-3022, -120], [-3040, -235]] as P[],
    branch: 5,
    /** the steepest a road climbs, to the metre (the jeep's own limit is well over this), and how far its bed is laid out */
    steep: 0.08,
    bed: 12,
  },
  /** the trading post (TRADE_AT): about here, beside the main road; it stands `post` metres south of the road's line, its yard to the road */
  trade: { x: -1507, z: -15 },
  post: 48,
  /** ground kept level and clear for what is to be built (the parent's modules): middles, sizes (x, z) and what they are */
  plots: [
    { name: 'Pokrov', kind: 'town', x: -1850, z: -30, w: 260, d: 220, tier: 3 as Tier },
    { name: 'hamlet', kind: 'hamlet', x: -1180, z: 350, w: 120, d: 120, tier: 2 as Tier },
    { name: 'ruined town', kind: 'ruins', x: -3345, z: 180, w: 190, d: 180, tier: 4 as Tier },
    { name: 'ruined village', kind: 'ruins', x: -3150, z: 450, w: 130, d: 130, tier: 4 as Tier },
  ],
  /** the monastery's outer wall (world, round it) and the town outside it: nothing grows or lies within 12 m of the wall, nor in the town */
  monastery: {
    wall: [[-1915, -10], [-1780, -10], [-1775, -90], [-1850, -125], [-1930, -85]] as P[],
    gates: { south: [-1845, -10] as P, north: [-1894, -103] as P, wide: 3.5 },
    clear: 12,
    town: { x0: -1960, x1: -1740, z0: 15, z1: 80 },
  },
  /** the canyon: its line from the mouth by the beach to the one onto the steppe; its floor's half width, its walls' height and run */
  canyon: {
    line: [[-3473, -635], [-3405, -600], [-3345, -530], [-3262, -488], [-3196, -400], [-3118, -318], [-3040, -235]] as P[],
    floor: [12, 18] as const,
    walls: [15, 30] as const,
    /** the walls' fall, to the metre across: steep enough for a cave's mouth to be cut in them */
    face: 1.9,
    /** how far out from the walls' top the tableland it is cut into reaches, and over how much it goes back into the land */
    table: [70, 170] as const,
  },
  /** the woods and the meadows: boxes (x0, x1, z0, z1), their edges let wander */
  pines: { x0: -2373, x1: -1507, z0: -701, z1: -268 },
  birches: { x0: -1440, x1: -823, z0: 199, z1: 699 },
  meadows: { x0: -2107, x1: -1540, z0: 232, z1: 532 },
  /** where fresh characters may also start: along the green land's west edge, facing into it (east) */
  starts: { x: -2600, z: [-600, -360, -120, 120, 360, 600] },
};

/** how much of the square is opened at a z (0 to 1): see PLAN.open */
export function openness(z: number) {
  const o = PLAN.open;
  return smoothstep(o[0], o[1], z) * (1 - smoothstep(o[2], o[3], z));
}

/** the starts along the green land's west edge (after the square's own, which are as they were) */
export function westStarts() {
  return PLAN.starts.z.map((z) => ({ x: PLAN.starts.x, z, yaw: -Math.PI / 2 }));
}

/**
 * The Zona over the new land, out to the barrier: rounds, as the Zona is made of (see PLAY_AREAS). A column along the
 * barrier, close enough together that its edge is near enough straight (eight metres in and out), and six large
 * ones over the rest, from the opened rim of the valley west; their edges to the north and south lie off the world.
 */
export function westZona(): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  const R = 260;
  for (let z = -780; z <= 780; z += 130) out.push({ x: PLAN.barrier + R, z, r: R });
  for (const x of [-1250, -2050, -2850]) for (const z of [-390, 390]) out.push({ x, z, r: 700 });
  return out;
}

/** the loot tier of the new places (towns mid, the hamlet as a village, ruins and caves high): null outside them. For buildings.ts, which says each loot point's tier. */
export function westTier(x: number, z: number): Tier | null {
  for (const p of PLAN.plots) if (Math.abs(x - p.x) <= p.w / 2 + 10 && Math.abs(z - p.z) <= p.d / 2 + 10) return p.tier;
  const C = PLAN.canyon;
  if (nearLine(C.line, x, z).d < C.floor[1] + 30) return 4;
  return null;
}

/** how far a spot is from a line of points, and how far along it (0 at its first point, 1 at its last) */
export function nearLine(line: P[], x: number, z: number) {
  let best = { d: Infinity, t: 0 }, run = 0;
  const lens = line.slice(1).map((p, k) => Math.hypot(p[0] - line[k][0], p[1] - line[k][1])), whole = lens.reduce((a, b) => a + b, 0);
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, az] = line[k], [bx, bz] = line[k + 1], ex = bx - ax, ez = bz - az, len2 = ex * ex + ez * ez || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len2)), d = Math.hypot(x - ax - ex * u, z - az - ez * u);
    if (d < best.d) best = { d, t: (run + u * lens[k]) / whole };
    run += lens[k];
  }
  return best;
}

/** whether a spot is inside a closed line (the monastery's wall) */
export function inside(poly: P[], x: number, z: number) {
  let n = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) n = !n;
  }
  return n;
}

/** how far a spot is outside a closed line (0 inside) */
export function outside(poly: P[], x: number, z: number) {
  if (inside(poly, x, z)) return 0;
  return nearLine([...poly, poly[0]], x, z).d;
}

const e1 = new Simplex(WORLD_SEED + 311);
/** how much of a box a spot is in (0 to 1), its edges let wander by `wander` metres either way */
export function inBox(b: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number, wander = 60, soft = 30) {
  const n = wander * e1.fbm(x * 0.006, z * 0.006, 3);
  const d = Math.min(x - b.x0, b.x1 - x, z - b.z0, b.z1 - z) + n;
  return smoothstep(-soft, soft, d);
}

/** where the trading post goes, and which way it faces: on the south side of the main west road, its yard to the road */
export function movedPost() {
  const line = PLAN.road.main, x = PLAN.trade.x;
  // (the road's line at the post's x, as straight lines between its points: near enough for where a yard goes)
  let z = PLAN.trade.z;
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, az] = line[k], [bx, bz] = line[k + 1];
    if ((x - ax) * (x - bx) <= 0) z = az + ((x - ax) / (bx - ax || 1)) * (bz - az);
  }
  return { x, z: z + PLAN.post, rot: Math.PI };
}

/**
 * A road's bed on a field of heights (the square's, or the world's: told by `net`): level with the road across it
 * and its verges (half its width and a metre and a half), eased into the ground over `reach` beyond them, as much as
 * `much` says at each spot (1: all of it). Where the road stands over the ground the ground comes up to it as a spur
 * does, falling away from it no steeper than `fill` (and never above `cap`, the ground as it was, where that is
 * given); where it lies under the ground the banks are taken back to no steeper than `cut` (where `much` is more than
 * nothing). `gap`, if given: how far each spot is from the edge of a road (least of all the roads laid on it).
 */
export function bed(H: Float32Array, p: Float32Array, width: number, reach: number, much: (x: number, z: number) => number,
  net = { x0: -SQUARE_HALF, z0: -SQUARE_HALF, nx: SQUARE_RES, nz: SQUARE_RES }, o: { fill?: number; cut?: number; cap?: Float32Array; gap?: Float32Array } = {}) {
  const { x0, z0, nx, nz } = net, edge = width / 2 + 1.5, fill = o.fill ?? Infinity, cut = o.cut ?? Infinity;
  const height = (x: number, z: number) => H[clamp(Math.round((z - z0) / CELL), 0, nz - 1) * nx + clamp(Math.round((x - x0) / CELL), 0, nx - 1)];
  // (each spot's distance from the nearest point of the road, and the road's height there: over the road's own box)
  const fars: number[] = [];
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (let k = 0; k + 1 < p.length / 3; k++) {
    const off = Math.max(Math.abs(p[k * 3 + 1] - height(p[k * 3], p[k * 3 + 2])), Math.abs(p[k * 3 + 4] - height(p[k * 3 + 3], p[k * 3 + 5])));
    const far = edge + Math.min(160, Math.max(reach, off / Math.min(fill, cut) + 4));
    fars.push(far);
    bx0 = Math.min(bx0, p[k * 3] - far, p[k * 3 + 3] - far); bx1 = Math.max(bx1, p[k * 3] + far, p[k * 3 + 3] + far);
    bz0 = Math.min(bz0, p[k * 3 + 2] - far, p[k * 3 + 5] - far); bz1 = Math.max(bz1, p[k * 3 + 2] + far, p[k * 3 + 5] + far);
  }
  const ox = Math.max(0, Math.floor((bx0 - x0) / CELL)), oz = Math.max(0, Math.floor((bz0 - z0) / CELL));
  const bw = Math.min(nx - 1, Math.ceil((bx1 - x0) / CELL)) - ox + 1, bh = Math.min(nz - 1, Math.ceil((bz1 - z0) / CELL)) - oz + 1;
  if (bw <= 0 || bh <= 0) return;
  const dist = new Float32Array(bw * bh).fill(Infinity), ry = new Float32Array(bw * bh);
  for (let k = 0; k + 1 < p.length / 3; k++) {
    const ax = p[k * 3], ay = p[k * 3 + 1], az = p[k * 3 + 2], bx = p[k * 3 + 3], by = p[k * 3 + 4], bz = p[k * 3 + 5], far = fars[k];
    const ex = bx - ax, ez = bz - az, len2 = ex * ex + ez * ez || 1;
    const ix0 = Math.max(ox, Math.floor((Math.min(ax, bx) - far - x0) / CELL)), ix1 = Math.min(ox + bw - 1, Math.ceil((Math.max(ax, bx) + far - x0) / CELL));
    const iz0 = Math.max(oz, Math.floor((Math.min(az, bz) - far - z0) / CELL)), iz1 = Math.min(oz + bh - 1, Math.ceil((Math.max(az, bz) + far - z0) / CELL));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const x = x0 + ix * CELL, z = z0 + iz * CELL, t = clamp(((x - ax) * ex + (z - az) * ez) / len2, 0, 1);
      const d = Math.hypot(x - ax - ex * t, z - az - ez * t), j = (iz - oz) * bw + (ix - ox);
      if (d <= far && d < dist[j]) { dist[j] = d; ry[j] = ay + (by - ay) * t; }
    }
  }
  for (let j = 0; j < bw * bh; j++) {
    const d = dist[j];
    if (d === Infinity) continue;
    const ix = ox + (j % bw), iz = oz + Math.floor(j / bw), i = iz * nx + ix, y = ry[j];
    const x = x0 + ix * CELL, z = z0 + iz * CELL, m = much(x, z), w = m * (1 - smoothstep(edge, edge + reach, d));
    if (w > 0) H[i] = lerp(H[i], y - 0.02, w);
    const past = Math.max(0, d - edge);
    if (fill < Infinity) { const floor = Math.min(y - 0.02 - fill * past, o.cap ? o.cap[i] : Infinity); if (H[i] < floor) H[i] = floor; }
    if (cut < Infinity && m > 0) { const ceil = y + cut * past; if (H[i] > ceil) H[i] = lerp(H[i], ceil, m); }
    if (o.gap) o.gap[i] = Math.min(o.gap[i], d - width / 2);
  }
}
