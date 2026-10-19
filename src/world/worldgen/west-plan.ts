// THE WEST'S PLAN: where everything of the new ground goes, as numbers, and the questions only those numbers answer.
// Plan v5 as the owner's client chose it (marketing/zona-plan-map3f.png), with the owner's "i think desert should be
// 2x size atleast" (map3h, 2026-10-16). West to east: a thin sea and its beach; a desert of dunes about 1.3 km across,
// a dry river's green line through it and the ruined town of Kalat; the RIDGE, sheer and the whole height of the map,
// one canyon pass through it ("players should be forced to go through the canyon chokepouint"), terraced, the area's
// best loot on its floor; the green land: the green river valley across its north running into the pass, Bunker 17
// on its south rim, Pokrov and the trader on the main road, Lipki and Ozerki by the forest lake, the swamp and its
// drowned hamlet in the low south-west; and today's valley opened onto it. Positions in world metres (x east, z
// south). The ground is west.ts and its parts (west-relief, west-water, west-towns); what is done to the square for
// it, opening.ts.

import { Simplex, clamp, lerp, smoothstep } from '../../core/noise';
import { CELL, SQUARE_HALF, SQUARE_RES, WORLD_SEED } from './places';
import type { Tier } from '../../sim/tiers';
import { TOWNS, type Town } from '../../sim/towns';

type P = [number, number];

export const PLAN = {
  /** where the square is opened (see `openness`): fully from the second z to the third, not at all past the first and the fourth */
  open: [-620, -460, 400, 560] as const,
  /** the opened green land rises from the valley's floor at the square's rim (west of this many metres, as -x) to its own level by the second */
  rise: [380, 1100] as const,
  /** the beach's inland edge (the shore is WEST.shore, about 125 m of sea: "make ocean take less map by 50%") */
  bands: { beach: -3645 },
  /** nobody walks or drives west of this (an invisible wall: see game.ts; the server holds poses to it too) */
  barrier: -3650,
  /**
   * the desert: its height over the sea at the beach's edge and at the ridge's foot, how high its dunes stand; the
   * buttes standing out of it before the ridge ([x, z, how far across their top, how high]); and how often a boulder
   * lies on it, at the foot of a face, on a bench of the ridge and on the pass's floor (one in so many square metres)
   */
  desert: {
    beach: -13, foot: -3, dunes: 9,
    buttes: [
      [-2560, -150, 40, 34], [-2650, 120, 28, 26], [-2580, 380, 55, 42], [-2780, 560, 35, 28], [-2700, -620, 45, 38], [-2880, 300, 22, 20], [-3050, -250, 30, 22], [-2520, 620, 25, 32],
      // (and the temples, standing out from the ridge's foot nearly as high as it)
      [-2475, -40, 26, 72], [-2490, 260, 30, 86], [-2470, 520, 22, 62], [-2480, -690, 28, 76],
    ] as [number, number, number, number][],
    boulders: { open: 20000, foot: 900, bench: 2500, pass: 1400 },
    /** how far east of the ridge's foot the desert's dry fringe reaches, and round the pass's east mouth from so far to so far */
    fringe: 130,
    mouth: [170, 330] as P,
  },
  /**
   * THE RIDGE between the green land and the desert, the whole height of the map: its feet and crest (x), how far
   * they wander (feet, crest), how high the crest stands and its peaks; an invisible wall along its crest but where
   * the pass goes through (`gap` either side of it), so nobody climbs over or walks round.
   */
  ridge: {
    west: -2420, east: -2085, crest: -2250, jag: [40, 18] as P, top: 110, peaks: 14, gap: 46,
    /** how far back the deepest of its side canyons cut into it */
    bays: 120,
    /** its west foot pushed out round the pass, a spur, so that the canyon's walls and the caves in them have rock to the mouth: how far, over what z either side of the pass */
    spur: [80, 70, 170] as [number, number, number],
    /** the beds of its rock, level (the heights between them, over the sea): each a bench of scree and a cliff over it */
    beds: [0, 13, 27, 40, 56, 70, 86, 100, 114, 132],
  },
  /**
   * THE PASS, the one way through the ridge, from its east mouth (the valley's end) to its west (the desert): its
   * floor's half width and height at either end; up each wall a riser to each shelf ([height over the floor, how deep,
   * how far the riser runs]), then the ridge's face (rise to the metre across); ramps between shelves (`side` 1: the
   * south wall, the left going west; -1: the north; `level` the riser it replaces: 0 the floor's to the first); the
   * river on the floor's north side, the road on its south; the area's best loot at the floor's middle.
   */
  pass: {
    line: [[-2030, -470], [-2110, -440], [-2190, -470], [-2270, -425], [-2350, -455], [-2440, -432], [-2510, -446]] as P[],
    floor: 20,
    floorY: [-4, -6.5] as P,
    shelves: [[8, 6, 2.5], [18, 6, 2.5], [30, 5, 3]] as [number, number, number][],
    face: 3.4,
    ramps: [
      { side: 1, level: 0, along: [60, 95] as P }, { side: 1, level: 0, along: [330, 365] as P }, { side: 1, level: 1, along: [150, 185] as P },
      { side: 1, level: 1, along: [420, 455] as P }, { side: 1, level: 2, along: [240, 275] as P },
      { side: -1, level: 0, along: [200, 235] as P }, { side: -1, level: 1, along: [290, 325] as P }, { side: -1, level: 2, along: [100, 135] as P },
      { side: -1, level: 2, along: [380, 415] as P },
    ],
    // (coast-kit's plan, src/sim/pass.ts, whose `t` is our `s`: the river 8 m off the middle toward the south wall, the
    // road beyond it on the dry floor before the hall's mouth at that wall's foot; the floor's loot cache on the other
    // side, north of the middle)
    river: { side: 8 },
    road: 16,
    loot: [-2270, -440] as P,
  },
  /**
   * THE GREEN RIVER VALLEY across the north of the green land, from a dip by today's map to the pass's mouth: its
   * line (straight past the brick works' quay), its floor's half width and its walls' height (both let wander), the
   * floor's height at the pass's mouth (it falls to it from its head), the land either side raised to its rims and let
   * down again over `rim`, its walls' steepness (rise to the metre across: walkable, and the cliffs at its bends), and
   * where it is wide enough for the brick works' bench ([x from, x to, half width]).
   */
  valley: {
    line: [[-780, -380], [-850, -455], [-905, -497], [-1000, -503], [-1100, -507], [-1350, -430], [-1650, -560], [-1880, -500], [-2030, -470]] as P[],
    floor: [20, 36] as P,
    walls: [20, 45] as P,
    mouth: -4,
    rim: [40, 340] as P,
    steep: [0.55, 2.1] as P,
    wide: [-1110, -890, 30] as [number, number, number],
    /** how far the brick works' bench stands over the river's floor */
    bench: 1.6,
  },
  /**
   * THE RIVER: down the valley, through the pass, and across the desert to the sea (`desert`, from the pass's west
   * mouth). How wide (at its head, in the pass, in the desert), how deep (at its head, from the valley's middle on),
   * how far its water lies under the floor it runs on, how far it wanders on the valley's floor, the desert's wadi
   * about it (its floor's half width, its banks' run), and where it is forded ([x, z, how far]).
   */
  river: {
    // (out of the pass's mouth down to the brick works' east end, along its quay, and on to the sea)
    desert: [[-2570, -440], [-2610, -385], [-2632, -335], [-2655, -306], [-2720, -302], [-2815, -304], [-2900, -330], [-3050, -385], [-3250, -415], [-3450, -425], [-3640, -425], [-3790, -424]] as P[],
    width: [5.5, 8, 9.5] as [number, number, number],
    depth: [0.45, 0.9] as P,
    under: 0.35,
    wander: 9,
    wadi: [16, 22] as P,
    // (Zavod's own lane over to its quay; and in the pass where each ramp up its north wall starts, by `west-water.ts`)
    fords: [[-2694, -302, 12]] as [number, number, number][],
  },
  /** the forest lake Ozerki fishes, north of it on the main road: its shore (straight along the village), how far under the village's bank its water lies, and its deepest */
  lake: {
    outline: [[-1360, -150], [-1320, -132], [-1180, -132], [-1140, -150], [-1132, -200], [-1150, -250], [-1200, -275], [-1260, -280], [-1320, -268], [-1355, -235], [-1366, -190]] as P[],
    under: 0.7,
    deep: 3.6,
  },
  /**
   * THE SWAMP in the low south-west of the green land: its shore, how far it is dug under the land it lies in, how
   * deep its water is over most of it, over its pools, and where the ground breaks the water (islands) or drops (pools).
   */
  swamp: {
    outline: [[-2035, 470], [-1985, 438], [-1900, 430], [-1800, 445], [-1700, 440], [-1655, 500], [-1650, 580], [-1668, 660], [-1700, 725], [-1790, 742], [-1880, 735], [-1965, 740], [-2030, 705], [-2042, 620], [-2038, 540]] as P[],
    dig: 0.6,
    shallow: [0.05, 0.6] as P,
    deep: 1.2,
    isle: 0.34,
    pool: 0.46,
  },
  /** KALAT, the ruined town (src/sim/ruins.ts), set down whole: its frame (its long axis north and south), and its land eased into the desert from so far to so far out of its top */
  kalat: { name: 'Kalat', x: -3215, z: 230, rot: Math.PI / 2, blend: [130, 210] as P, reach: 440 },
  /**
   * the towns where plan v5's ground sets them otherwise than their own data does (src/sim/towns.ts). Zastava, the post
   * at the pass's east mouth, on the green river valley's floor just out of it, east enough that its pad and the 40 m
   * its edge is eased over keep off the ridge's foot (~-2085: its plan's middle, -2040, levelled the pass's first shelves):
   * the road comes down to the floor past its west end (clear of its watchtower's knoll) and turns into the pass, the river
   * runs along its north side.
   */
  towns: { Zastava: { x: -1965, z: -452 } } as Record<string, { x?: number; z?: number; rot?: number }>,
  /** the loot steps of the new places (towns mid, the hamlets as villages; Kalat says its own, src/sim/ruins.ts) */
  // (west to east, worse to better: the owner, 2026-10-18: "kalat should be tier 2 loot zavo tier 2, the pass tier 3 pipki tier 3 mokroye tier 3 zalena tier 3 and kamenka tier 4 orlanoy tier 5 (not as dense as bunker, but still top tier loot, player should still want to go to bunker)"; Pokrov, Ozerki and Zastava between, as the plan put them)
  tiers: { Pokrov: 2, Lipki: 3, Zavod: 2, Ozerki: 3, Mokroye: 3, Zastava: 3 } as Record<string, Tier>,
  /**
   * The roads: the main one from the loop's west bend through the trader and Pokrov's lane, north-west to the pass's
   * mouth, through it beside the river (`pass`: so far south of its middle) and out across the desert past Kalat to the
   * beach; and its branches (each from a point of the main road, or the north gate's).
   */
  road: {
    // (along Ozerki's lane, past the trader, along Pokrov's lane; out of the pass south of the river, past Zavod's east end)
    east: [[-680, -61], [-1100, -80], [-1170, -90], [-1330, -90], [-1450, -62], [-1640, 10], [-1715, 34], [-1985, 34], [-2015, -60], [-2022, -250], [-2028, -400]] as P[],
    west: [[-2540, -390], [-2575, -330], [-2625, -280], [-2700, -240], [-2860, -150], [-2990, -60], [-3300, -50], [-3500, -10], [-3640, 25]] as P[],
    width: 6.5,
    /** from Pokrov's north gate (outside it) to the edge of the bunker's hollow, where its way out comes to it */
    bunker: [[-1908, -142], [-1870, -205], [-1760, -255], [-1640, -275], [-1533, -272]] as P[],
    /** to the north end of Lipki's lane, and Kalat's track */
    lipki: [[-1170, -90], [-1176, 60], [-1178, 180], [-1178, 246]] as P[],
    kalat: [[-2985, -58], [-2975, 100], [-2968, 230], [-2965, 326]] as P[],
    branch: 5,
    /** the steepest a road climbs, to the metre (the jeep's own limit is well over this), and how far its bed is laid out */
    steep: 0.08,
    bed: 12,
  },
  /** the trading post (TRADE_AT): about here, beside the main road; it stands `post` metres south of the road's line, its yard to the road */
  trade: { x: -1507, z: -15 },
  post: 48,
  /** the woods and the meadows: boxes (x0, x1, z0, z1), their edges let wander */
  pines: { x0: -2040, x1: -1550, z0: -430, z1: -250 },
  birches: { x0: -1430, x1: -823, z0: 199, z1: 699 },
  meadows: { x0: -1640, x1: -1450, z0: 232, z1: 620 },
  /** where fresh characters may also start: in the desert, along the ridge's foot, facing it */
  starts: { x: -2600, z: [-660, -200, 40, 280, 520, 700] },
};

/** how much of the square is opened at a z (0 to 1): see PLAN.open */
export function openness(z: number) {
  const o = PLAN.open;
  return smoothstep(o[0], o[1], z) * (1 - smoothstep(o[2], o[3], z));
}

/** the starts in the desert (after the square's own, which are as they were) */
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
  // (and the opened west of the square, where the old map's rounds and these meet)
  out.push({ x: -640, z: -80, r: 300 });
  return out;
}

/** the towns as the map has them: where their own data plans them, but where plan v5's ground asks otherwise (PLAN.towns) */
export const PLACED: Town[] = TOWNS.map((t) => ({ ...t, ...PLAN.towns[t.name] }));
/** the loot step of the new places: the towns by their own, the pass's floor high (Kalat's are its own): null outside them. For buildings.ts, which says each loot point's tier. */
export function westTier(x: number, z: number): Tier | null {
  for (const t of PLACED) {
    const c = Math.cos(t.rot), s = Math.sin(t.rot), dx = x - t.x, dz = z - t.z;
    if (Math.abs(dx * c - dz * s) <= t.pad[0] + 10 && Math.abs(dx * s + dz * c) <= t.pad[1] + 10) return PLAN.tiers[t.name] ?? 2;
  }
  if (nearLine(PLAN.pass.line, x, z).d < PLAN.pass.floor + 30) return 3;
  return null;
}

/** how far a spot is from a road's line (its points x, y, z), and the road's height there */
export function onLine(p: Float32Array, x: number, z: number): [number, number] {
  let d = Infinity, y = 0;
  for (let j = 0; j + 3 < p.length; j += 3) {
    const ex = p[j + 3] - p[j], ez = p[j + 5] - p[j + 2], t = clamp(((x - p[j]) * ex + (z - p[j + 2]) * ez) / (ex * ex + ez * ez || 1), 0, 1);
    const e = Math.hypot(x - p[j] - ex * t, z - p[j + 2] - ez * t);
    if (e < d) { d = e; y = p[j + 1] + (p[j + 4] - p[j + 1]) * t; }
  }
  return [d, y];
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

/** whether a spot is inside a closed line */
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
  const line = PLAN.road.east, x = PLAN.trade.x;
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
