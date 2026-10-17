// THE WEST'S RELIEF (plan v5 as the owner's client chose it, the desert made twice as big: "i think desert should be
// 2x size atleast", 2026-10-16, marketing/zona-plan-map3h.png): the desert's dunes from the beach to the ridge; the
// ridge itself, sheer and the whole height of the map; the green river valley across the north of the green land;
// and the pass, the one way through the ridge, with its terraces. The owner, of the pass: "players should be forced
// to go through the canyon chokepouint with both sides of the map canyon walls stretching to the skybox so they cant
// be walked around, and shelves that line the inside the canyon walls where cave entrences and exits are like
// terraces". Heights on the world's net, changed in place; the numbers are PLAN's (west-plan.ts).

import { Simplex, clamp, lerp, smoothstep } from '../../core/noise';
import { catmullRom } from './ground';
import { CELL, WORLD_SEED } from './places';
import { PLAN } from './west-plan';
import { PASS_SHAPE, caveMouths, galleries, passEdges, type Pass } from '../../sim/pass';

type P = [number, number];
export interface Net { x0: number; z0: number; nx: number; nz: number }

const r1 = new Simplex(WORLD_SEED + 331), r2 = new Simplex(WORLD_SEED + 332), r3 = new Simplex(WORLD_SEED + 333);

/** Where a spot lies by a line: how far from it (`d`), on which side and how far (`s`, + to the left of the way it runs: for a line running west, south), and how far along it (metres, and 0 to 1). */
export interface Along { d: number; s: number; along: number; t: number; k: number }

/** A line of points made smooth, with what is asked of it: the nearest point to a spot, quickly where a hint is given. */
export class Line {
  readonly pts: P[];
  readonly run: number[];
  readonly total: number;
  /** (`step` 0: the points as they are) */
  constructor(points: P[], step: number) {
    this.pts = step > 0 ? catmullRom(points, step) : points.slice();
    this.run = [0];
    for (let k = 1; k < this.pts.length; k++) this.run.push(this.run[k - 1] + Math.hypot(this.pts[k][0] - this.pts[k - 1][0], this.pts[k][1] - this.pts[k - 1][1]));
    this.total = this.run[this.run.length - 1];
  }
  /** the nearest point, over the segments from `k0` to `k1` (all of them if not said) */
  near(x: number, z: number, k0 = 0, k1 = this.pts.length - 2): Along {
    // (squared distances compared, the best one's worked out whole: this is asked of hundreds of thousands of samples)
    let bd = Infinity, bk = 0, bu = 0;
    for (let k = Math.max(0, k0), end = Math.min(this.pts.length - 2, k1); k <= end; k++) {
      const a = this.pts[k], b = this.pts[k + 1], ex = b[0] - a[0], ez = b[1] - a[1], len2 = ex * ex + ez * ez || 1;
      let u = ((x - a[0]) * ex + (z - a[1]) * ez) / len2;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const dx = x - a[0] - ex * u, dz = z - a[1] - ez * u, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; bk = k; bu = u; }
    }
    const a = this.pts[bk], b = this.pts[bk + 1], ex = b[0] - a[0], ez = b[1] - a[1], l = Math.sqrt(ex * ex + ez * ez) || 1;
    const qx = a[0] + ex * bu, qz = a[1] + ez * bu, along = this.run[bk] + bu * l;
    return { d: Math.sqrt(bd), s: ((x - qx) * ez - (z - qz) * ex) / l, along, t: along / this.total, k: bk };
  }
  /** the point at so far along, and the way the line runs there */
  at(along: number): { x: number; z: number; tx: number; tz: number } {
    const a = clamp(along, 0, this.total);
    let k = 0;
    while (k + 2 < this.pts.length && this.run[k + 1] < a) k++;
    const [ax, az] = this.pts[k], [bx, bz] = this.pts[k + 1], l = this.run[k + 1] - this.run[k] || 1, u = (a - this.run[k]) / l;
    return { x: ax + (bx - ax) * u, z: az + (bz - az) * u, tx: (bx - ax) / l, tz: (bz - az) / l };
  }
  /**
   * Every sample of a net within `reach` of the line, with where it lies by it. The nearest segment is found on a
   * coarse grid first (every eight metres) and only the segments about it are asked at each sample.
   */
  each(net: Net, reach: number, f: (i: number, x: number, z: number, a: Along) => void, xMax = Infinity) {
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const [x, z] of this.pts) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
    const ix0 = Math.max(0, Math.floor((bx0 - reach - net.x0) / CELL)), ix1 = Math.min(net.nx - 1, Math.ceil((Math.min(bx1 + reach, xMax) - net.x0) / CELL));
    const iz0 = Math.max(0, Math.floor((bz0 - reach - net.z0) / CELL)), iz1 = Math.min(net.nz - 1, Math.ceil((bz1 + reach - net.z0) / CELL));
    const G = 4, gw = Math.ceil((ix1 - ix0 + 1) / G) + 1, gh = Math.ceil((iz1 - iz0 + 1) / G) + 1, hint = new Int32Array(gw * gh);
    for (let gj = 0; gj < gh; gj++) for (let gi = 0; gi < gw; gi++) hint[gj * gw + gi] = this.near(net.x0 + (ix0 + gi * G) * CELL, net.z0 + (iz0 + gj * G) * CELL).k;
    const span = Math.ceil((G * CELL * 2) / Math.max(1, this.total / (this.pts.length - 1))) + 2;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const x = net.x0 + ix * CELL, z = net.z0 + iz * CELL, h0 = hint[Math.round((iz - iz0) / G) * gw + Math.round((ix - ix0) / G)];
      const a = this.near(x, z, h0 - span, h0 + span);
      if (a.d <= reach) f(iz * net.nx + ix, x, z, a);
    }
  }
}

// ------------------------------------------------------------------ the ridge

/** the ridge at a z: its west foot, its crest and its east foot (x), each wandering as worn rock does, in bays and spurs */
export function ridgeAt(z: number): [number, number, number] {
  const R = PLAN.ridge, [out, inner, outer] = R.spur, spur = out * (1 - smoothstep(inner, outer, Math.abs(z - PASS_Z)));
  return [
    R.west - spur + R.jag[0] * r1.fbm(z * 0.004, 1.3, 3) + 14 * r2.noise(z * 0.02, 3.3),
    R.crest + R.jag[1] * r1.fbm(z * 0.006, 7.1, 3),
    // (its east foot wanders less: Pokrov and the road north to the pass are close under it)
    R.east + R.jag[0] * 0.6 * r1.fbm(z * 0.004, 4.9, 3) + 8 * r2.noise(z * 0.02, 8.8),
  ];
}
/** the pass's middle z, about which the ridge's west foot stands out as a spur */
const PASS_Z = (PLAN.pass.line[0][1] + PLAN.pass.line[PLAN.pass.line.length - 1][1]) / 2;
/** how high the crest stands about a spot: a rough tableland, higher and lower along it */
function crestY(x: number, z: number) {
  const R = PLAN.ridge;
  return R.top + R.peaks * r2.fbm(z * 0.004, 3.3, 3) + 0.5 * R.peaks * r1.fbm(x * 0.01, z * 0.012, 2) + 4 * r3.fbm(x * 0.02, z * 0.02, 2);
}
/**
 * THE STRATA (the owner: "like the grand canyon"): the rock lies in level beds, the hard ones cliffs and the soft
 * ones slopes and benches between, at the same heights wherever they show, a ridge's face, the pass's walls or a
 * butte's. A height the land would have smooth is given back as it is with its beds weathered out: within each bed
 * the lower part a bench of scree, the upper a cliff, the line between them worn in and out.
 */
export function strata(y: number, x: number, z: number) {
  const B = PLAN.ridge.beds;
  if (y <= B[0]) return y;
  for (let k = 0; k + 1 < B.length; k++) {
    const lo = B[k], hi = B[k + 1];
    if (y > hi) continue;
    // (each bed its own: some most of them cliff, some most of them a slope of scree, as hard and soft rock lie)
    const t = (y - lo) / (hi - lo), worn = 0.2 * r3.fbm(x * 0.02 + k * 7.3, z * 0.02, 3), soft = 0.25 + 0.45 * ((k * 0.618 + 0.2) % 1);
    return lo + (hi - lo) * (0.3 * t + 0.7 * smoothstep(soft + worn, Math.min(0.97, soft + 0.32 + worn), t));
  }
  return y;
}
/**
 * How far the face is cut back into the ridge at a spot of it, metres: the gullies that run down every such face,
 * a few deep enough to be a bay with spurs either side of it, narrow at their foot and opening up the face.
 */
function gully(x: number, z: number, side: number) {
  const n = r2.ridged(z * 0.014 + 0.35 * r3.noise(x * 0.01, 3.1 + side), side > 0 ? 2.7 : 9.4, 3);
  // (and every few hundred metres a side canyon, cut far back into the ridge, its walls the beds' cliffs)
  const bay = r1.ridged(z * 0.0042 + 0.25 * r3.noise(x * 0.006, 8.8 + side), side > 0 ? 4.4 : 12.2, 2);
  return 46 * n ** 5 + 10 * r1.noise(z * 0.05, x * 0.05 + side * 4) ** 2 + PLAN.ridge.bays * bay ** 7;
}

/** the buttes and mesas standing out in the desert before the ridge: its strata standing alone, worn round */
function butte(x: number, z: number): number {
  let best = -Infinity;
  for (const [bx, bz, r, h] of PLAN.desert.buttes) {
    const dx = x - bx, dz = z - bz, d0 = Math.hypot(dx, dz);
    if (d0 > r * 2.6) continue;
    const a = Math.atan2(dz, dx), edge = r * (1 + 0.22 * r1.noise(Math.cos(a) * 1.3 + bx * 0.01, Math.sin(a) * 1.3 + bz * 0.01) + 0.08 * r2.noise(a * 3, bz));
    // (a flat top to its edge, its sides the beds' cliffs, and the scree it sheds round its foot)
    const u = (d0 - edge) / (r * 1.4);
    best = Math.max(best, h * (u <= 0 ? 1 : Math.max(0, 1 - u) ** 1.4) + 1.2 * r3.noise(x * 0.06, z * 0.06));
  }
  return best;
}

// ------------------------------------------------------------------ the pass

export const passLine = new Line(PLAN.pass.line as P[], 4);
/** the pass's floor at so far along it (from its east mouth): falling west, a hand's breadth of unevenness */
export function passFloor(along: number) {
  const F = PLAN.pass.floorY;
  return lerp(F[0], F[1], clamp(along / passLine.total, 0, 1)) + 0.2 * r3.noise(along * 0.03, 4.4);
}
/**
 * The pass as the coast kit's plan measures it (src/sim/pass.ts, with its caves): its middle line and its floor. Its
 * walls are carved to that plan's terraces (`passProfile`) by every cave's mouth (which opens in a riser) and stand
 * back from them elsewhere (`passWall`), its galleries kept under two metres of rock.
 */
export const passPlan: Pass = { line: passLine.pts, floor: (s: number) => passFloor(s) };
/**
 * Which of our ramps are cut: none over a cave (a ramp takes the riser down, and the shelf's edge with it) nor by a
 * mouth (which opens in a riser): each ramp's riser, sampled along it, kept 8 m off every gallery.
 */
const caveRuns = galleries(passPlan), mouths = caveMouths(passPlan);
const rampsCut = PLAN.pass.ramps.filter((r) => {
  const e = passEdges()[r.level], t = r.side * (e.foot + e.top) / 2;
  for (let a = r.along[0] - 10; a <= r.along[1] + 10; a += 3) {
    const p = passLine.at(a), x = p.x + p.tz * t, z = p.z - p.tx * t;
    if (mouths.some((m) => Math.hypot(m.x - x, m.z - z) < 14)) return false;
    for (const g of caveRuns) {
      const ex = g.b[0] - g.a[0], ez = g.b[2] - g.a[2], u = clamp(((x - g.a[0]) * ex + (z - g.a[2]) * ez) / (ex * ex + ez * ez || 1), 0, 1);
      if (Math.hypot(x - g.a[0] - ex * u, z - g.a[2] - ez * u) < Math.max(g.wa, g.wb) / 2 + 8) return false;
    }
  }
  return true;
});
/** how far the pass's floor reaches either side of its line (the plan's) */
export function passHalf(_along: number, _side: number) {
  return PASS_SHAPE.floor;
}
/**
 * THE WALLS AS BUILT (the owner, 2026-10-16, of the first: "i really appreciate the concept but you have to admit this
 * does not look natural and needs some serious help and smoothing"). The plan's terraces on a 2 m net are a step a
 * cell wide, its lip and foot a saw along every shelf. So each riser is a ramp no steeper than `steep`, its slope
 * coming in and going out smoothly over `round` metres at its foot and lip (smooth enough that the net's samples of
 * it do not zigzag along a wall that runs across them); the risers stand where the plan's do (the coast kit's rock
 * faces stand on them), a little further back up the wall to leave each shelf a flat between its rounded edges, and
 * wander across and the shelves up and down along the pass. The floor's edge on the south, where the road runs by
 * it, only ever back from it. By a cave's mouth (`keep`, 1) the wall is the plan's exactly, for each mouth opens in
 * the plan's riser and the carved rock round it is cut to that.
 */
const WALL = { round: 4.4, steep: 3, back: [0, 1.2, 2.2, 2.2], roadSide: 19.5, wander: 1.3, lift: 0.6, tread: 3.5 };
/** the rise under a slope coming in as smootherstep does, from 0 to 1 over u from 0 to 1 (and 1 on past it) */
const easedRise = (u: number) => (u <= 0 ? 0 : u >= 1 ? u - 0.5 : u * u * u * u * (u * (u - 3) + 2.5));
/** the rise of a ramp of run `r` whose slope comes in and goes out over `b`, 0 to 1, at `x` metres from where it starts (it is up at r + b) */
function rounded(x: number, r: number, b: number) {
  if (x <= 0) return 0;
  if (x >= r + b) return 1;
  return (b * (easedRise(x / b) - easedRise((x - r) / b))) / r;
}
/** how near the plan the walls are at a point (1 by a cave's mouth, nothing 11 m off) */
function passKeep(x: number, z: number) {
  let d = Infinity;
  for (const m of mouths) d = Math.min(d, Math.hypot(m.x - x, m.z - z));
  return 1 - smoothstep(5, 11, d);
}
/**
 * The least the ground may be cut to over a cave's gallery, standing back from the plan's: three metres of
 * rock over its roof, falling away either side no steeper than a riser (but by a mouth, where the plan's own wall is).
 */
function overCaves(x: number, z: number) {
  let need = -Infinity;
  for (const g of caveRuns) {
    const ex = g.b[0] - g.a[0], ez = g.b[2] - g.a[2], l2 = ex * ex + ez * ez || 1, len = Math.sqrt(l2), k = clamp(((x - g.a[0]) * ex + (z - g.a[2]) * ez) / l2, 0, 1);
    if ((g.aMouth && k * len < 6) || (g.bMouth && (1 - k) * len < 6)) continue;
    const d = Math.hypot(x - g.a[0] - ex * k, z - g.a[2] - ez * k), roof = lerp(g.a[1], g.b[1], k) + lerp(g.ha, g.hb, k);
    need = Math.max(need, roof + 3 - Math.max(0, d - lerp(g.wa, g.wb, k) / 2 - 3.5) * WALL.steep);
  }
  return need;
}
/**
 * One wall's risers at so far along, on a side (1: south, the left going west; -1: north): where each starts to rise
 * (metres across from the middle), its run, its rise, and the shelves' heights over the floor; then the face's start.
 */
export function passWall(side: number, along: number, keep = 0) {
  const E = passEdges(), b = lerp(WALL.round, 0.05, keep), out: { start: number; run: number; from: number; to: number }[] = [];
  const swing = (k: number) => WALL.wander * (0.75 * r2.noise(along / 30, k * 5.1 + side * 2.7) + 0.25 * r3.noise(along / 9, k * 3.3 + side * 1.9));
  let from = 0, end = -Infinity;
  for (let k = 0; k < E.length; k++) {
    const e = E[k], to = lerp(e.to + WALL.lift * r1.noise(along / 46, k * 7.3 + side * 3.1), e.to, keep);
    const run = lerp((to - from) / WALL.steep, e.top - e.foot, keep);
    let start = (e.foot + e.top) / 2 + WALL.back[k] + swing(k) - (run + b) / 2;
    if (k === 0 && side > 0) start = Math.max(start, WALL.roadSide);
    start = lerp(Math.max(start, end + 0.3), e.foot, keep);
    out.push({ start, run, from, to });
    end = start + run + b;
    from = to;
  }
  const last = E[E.length - 1];
  return { risers: out, round: b, face: lerp(Math.max(last.back + WALL.back[3] + swing(3) - b / 2, end + 0.3), last.back, keep) };
}
/**
 * The pass's ground across it, over its floor at `a` metres out from the floor's edge, on a side and so far along: the
 * walls as built (`passWall`); where a ramp of ours is (PLAN.pass.ramps, kept clear of the caves' mouths) a riser is
 * two, a tread between them climbing from the shelf below to the one above. Past the face's crest nothing is cut:
 * the ridge's own beds stand there.
 */
export function passRise(a: number, side: number, along: number, keep = 0): number {
  // (from the middle out: the lowest riser's rounded foot may begin on the floor)
  const t = PASS_SHAPE.floor + a, W = passWall(side, along, keep), b = W.round;
  let y = 0;
  W.risers.forEach((r, k) => {
    const rise = r.to - r.from, ramp = rampsCut.find((q) => q.side === side && q.level === k && along >= q.along[0] && along <= q.along[1]);
    if (!ramp) { y += rise * rounded(t - r.start, r.run, b); return; }
    // (the tread up the riser: its height along the ramp, its width coming in from nothing at either end)
    const u = (along - ramp.along[0]) / (ramp.along[1] - ramp.along[0]), lo = rise * u, tw = WALL.tread * smoothstep(0, 0.2, u) * smoothstep(1, 0.8, u);
    const s0 = r.start - (k ? tw / 2 : 0), rl = (r.run * lo) / rise;
    y += lo * rounded(t - s0, Math.max(rl, 0.05), b) + (rise - lo) * rounded(t - s0 - rl - tw, Math.max(r.run - rl, 0.05), b);
  });
  y += (b * easedRise((t - W.face) / b)) / PASS_SHAPE.face;
  return y >= PASS_SHAPE.crest - 0.01 ? Infinity : y;
}

// ------------------------------------------------------------------ the valley

export const valleyLine = new Line(PLAN.valley.line as P[], 6);
/** how much the valley bends at each of its points, and toward which side (+: its left) */
const bends = valleyLine.pts.map((_, k, pts) => {
  const a = pts[Math.max(0, k - 3)], b = pts[k], c = pts[Math.min(pts.length - 1, k + 3)];
  const t1 = [b[0] - a[0], b[1] - a[1]], t2 = [c[0] - b[0], c[1] - b[1]], l1 = Math.hypot(t1[0], t1[1]) || 1, l2 = Math.hypot(t2[0], t2[1]) || 1;
  // (the turn from one way to the next, per metre: + where it turns toward its left)
  return ((t1[0] * t2[1] - t1[1] * t2[0]) / (l1 * l2)) * (2 / (l1 + l2)) * -1;
});
/** the valley's floor at a part of the way along it (0 at its head, by today's map; 1 at the pass's mouth) */
export function valleyFloor(t: number, head: number) {
  return lerp(head, PLAN.valley.mouth, Math.pow(clamp(t, 0, 1), 0.85)) + 0.25 * r3.noise(t * 40, 9.9);
}
/** the valley floor's half width, at a part of the way along it */
function valleyHalf(t: number, x: number) {
  const V = PLAN.valley, w = lerp(V.floor[0], V.floor[1], 0.5 + 0.5 * r1.noise(t * 6, 2.2));
  // (wider where the brick works stands on its bench over the river)
  return x < V.wide[0] || x > V.wide[1] ? w : Math.max(w, V.wide[2]);
}
/** how high its walls stand over its floor: low at its head, and lower by the pass, where the road comes down into it */
function valleyWalls(t: number) {
  const V = PLAN.valley;
  return lerp(V.walls[0], V.walls[1], 0.5 + 0.5 * r2.noise(t * 4, 5.5)) * smoothstep(0, 0.12, t) * (1 - 0.45 * smoothstep(0.82, 1, t));
}

/**
 * The desert, the green river valley, the ridge and the pass, on the world's net (west of the seam only). `beach`:
 * the ground of the beach at a spot so far inland from the shore (+), as the coast lays it; `shores` the shore's x at
 * each row, `sand` how far inland the beach runs. Gives back how wooded each sample of the valley's slopes and rims
 * may be (0 to 255: none on its floor or its cliffs).
 */
export function shapeRelief(H: Float32Array, net: Net, seam: number, shores: Float64Array, sand: number, beach: (c: number) => number): Uint8Array {
  const walls = new Uint8Array(net.nx * net.nz);
  const { nx, nz } = net, D = PLAN.desert, xOf = (ix: number) => net.x0 + ix * CELL, zOf = (iz: number) => net.z0 + iz * CELL;
  const OX = Math.round((seam - net.x0) / CELL);

  // THE DESERT: from the beach's inland edge to the ridge's foot, falling a few metres all the way to the sea, in
  // dunes running across the wind (from the sea), their crests north and south, high in patches and low between;
  // flattened toward the beach and the ridge's foot.
  const feet = Array.from({ length: nz }, (_, iz) => ridgeAt(zOf(iz)));
  for (let iz = 0; iz < nz; iz++) {
    const z = zOf(iz), [w, , e] = feet[iz], edge = shores[iz] + sand;
    for (let ix = 0; ix < OX; ix++) {
      const x = xOf(ix);
      if (x >= e + 60) break;
      const c = x - shores[iz];
      if (c < sand) continue;
      const base = lerp(D.beach, D.foot, clamp((x - edge) / (w - edge), 0, 1));
      const patch = 0.35 + 0.65 * smoothstep(-0.2, 0.5, r1.fbm(x * 0.002, z * 0.002, 2));
      const crest = r2.ridged(x * 0.011 + 0.6 * r3.noise(x * 0.003, z * 0.003), z * 0.0035, 3);
      const dunes = D.dunes * patch * (crest - 0.3) * smoothstep(0, 120, c - sand) * (1 - smoothstep(-170, -50, x - w));
      let desert = lerp(beach(c), base + dunes, smoothstep(sand, sand + 80, c));
      // (and the buttes standing out of it, the ridge's beds alone: their strata the same heights as its)
      const b = butte(x, z);
      if (b > 0.5) desert = Math.max(desert, strata(base + b, x, z));
      const i = iz * nx + ix;
      // (under the ridge, the desert gives way to the green land it divides it from: hidden, but it is what the pass is cut through)
      H[i] = x <= w ? desert : lerp(desert, H[i], smoothstep(w, e, x));
    }
  }

  // THE GREEN RIVER VALLEY: from a dip at the head (by today's map) to the pass's mouth, its floor falling west,
  // grassy and 40 to 80 m across; its walls 20 to 45 m, sheer with outcrops on the outside of its bends and walkable
  // elsewhere, so that it can be got into and out of; the land either side raised to its rims and let down again.
  {
    const V = PLAN.valley, head = valleyLine.pts[0], headY = H[Math.round((head[1] - net.z0) / CELL) * nx + Math.round((head[0] - net.x0) / CELL)] - 2;
    const was = H.slice();
    valleyLine.each(net, 120 + V.rim[1], (i, x, z, a) => {
      // (east of the ridge only: west of it is the desert)
      if (x >= seam || x < feet[Math.round((z - net.z0) / CELL)][2]) return;
      const t = a.t, floorY = valleyFloor(t, headY), hw = valleyHalf(t, x), Hw = valleyWalls(t), land = was[i];
      // (the side of a bend that the water cuts into is a cliff; the inside of it a slope; outcrops here and there)
      const inner = Math.sign(a.s) === Math.sign(bends[a.k]), bend = smoothstep(0.0015, 0.006, Math.abs(bends[a.k]));
      const crag = clamp(bend * (inner ? 0.15 : 1) + 0.45 * smoothstep(0.3, 0.7, r3.noise(a.along * 0.012, a.s > 0 ? 1.5 : 6.5)), 0, 1);
      const run = Hw / lerp(V.steep[0], V.steep[1], crag), off = a.d - hw, top = Math.max(floorY + Hw, land);
      let h: number;
      if (off <= 0) h = floorY;
      else if (off < run) {
        const u = off / run;
        h = floorY + (top - floorY) * lerp(smoothstep(0, 1, u), clamp(u + 0.05 * Math.sin(u * Math.PI * 3), 0, 1), crag) + 1.5 * crag * r2.fbm(x * 0.06, z * 0.06, 2) * Math.sin(u * Math.PI);
      } else {
        const out = a.s > 0 ? V.rim[1] : V.rim[1] * 0.7;
        h = land + Math.max(0, floorY + Hw - land) * (1 - smoothstep(run + V.rim[0], run + out, off));
      }
      // (none of it on today's map: it comes in from a hundred metres west of the seam)
      H[i] = lerp(land, h, smoothstep(0, 100, seam - x));
      // (its slopes and rims wooded, but for its cliffs)
      if (off > 0 && off < run + 50) walls[i] = Math.round(255 * (1 - crag) * smoothstep(0, 100, seam - x));
    }, seam);
  }

  // THE RIDGE: from its foot on either side up its beds of rock to its crest, cliffs and benches, cut back by its
  // gullies into bays and spurs, over whatever was there, the whole height of the map.
  const footY = feet.map(([w, , e], iz) => {
    const row = iz * nx, at = (x: number) => H[row + clamp(Math.round((x - net.x0) / CELL), 0, nx - 1)];
    return [at(w), at(e)];
  });
  for (let iz = 0; iz < nz; iz++) {
    const z = zOf(iz), [w, cx, e] = feet[iz], [yw, ye] = footY[iz];
    for (let ix = Math.max(0, Math.floor((w - 4 - net.x0) / CELL)); ix <= Math.min(OX - 1, Math.ceil((e + 4 - net.x0) / CELL)); ix++) {
      const x = xOf(ix), west = x < cx, span = west ? cx - w : e - cx;
      // (how far into the ridge, from its foot to its crest: less where a gully cuts the face back)
      // (no further back than half way to the crest: it stands whole along its length, its one way through the pass)
      const u = ((west ? x - w : e - x) - Math.min(gully(x, z, west ? 1 : -1), 0.5 * span)) / span;
      if (u <= 0) continue;
      const base = west ? yw : ye, top = crestY(x, z), raw = base + (top - base) * Math.pow(smoothstep(0, 0.62, Math.min(u, 1)), 0.9);
      const i = iz * nx + ix;
      H[i] = Math.max(H[i], strata(raw, x, z) + 1.6 * r3.fbm(x * 0.07, z * 0.07, 2) * smoothstep(0.02, 0.1, u));
    }
  }

  // THE PASS: cut through the ridge on its line, its floor falling west, up each wall a riser to each of three shelves
  // and the ridge's face above them; no deeper than the ground is anywhere (past its mouths it is the valley's floor
  // and the desert's).
  // (out to where the plan's face meets its crest: past that the ridge's own beds)
  // (out to where the walls' face meets its crest: past that the ridge's own beds)
  const reach = passEdges().reduce((w, e) => Math.max(w, e.back), 0) + 10 + (PASS_SHAPE.crest - PASS_SHAPE.shelves[PASS_SHAPE.shelves.length - 1].up) * PASS_SHAPE.face + 6;
  passLine.each(net, reach, (i, x, z, a) => {
    const side = a.s >= 0 ? 1 : -1, y = passFloor(a.along) + passRise(Math.abs(a.s) - passHalf(a.along, side), side, a.along, passKeep(x, z));
    const cut = Math.max(y, overCaves(x, z));
    if (cut < H[i]) H[i] = cut;
  });
  return walls;
}

/** where the pass crosses the ridge's crest (z): the one gap in the wall along it */
let crossing: number | null = null;
function passCrossing() {
  if (crossing !== null) return crossing;
  let best = Infinity;
  for (const [x, z] of passLine.pts) { const d = Math.abs(x - ridgeAt(z)[1]); if (d < best) { best = d; crossing = z; } }
  return crossing!;
}
/**
 * The wall that cannot be seen along the ridge's crest (the owner's client: "both sides of the map canyon walls
 * stretching to the skybox so they cant be walked around"): its lengths, [ax, az, bx, bz], every `step` metres from the
 * world's north edge to its south, but none where the pass goes through.
 */
export function ridgeWall(z0: number, z1: number, step = 24): [number, number, number, number][] {
  const out: [number, number, number, number][] = [], zc = passCrossing(), gap = PLAN.ridge.gap;
  for (let z = z0; z < z1; z += step) {
    const b = Math.min(z + step, z1);
    if (b > zc - gap && z < zc + gap) continue;
    out.push([ridgeAt(z)[1], z, ridgeAt(b)[1], b]);
  }
  return out;
}
/** whether a spot is on the ridge's crest, where its wall stands (for the server, which holds nobody there) */
export function onRidgeWall(x: number, z: number) {
  if (x < PLAN.ridge.crest - 40 || x > PLAN.ridge.crest + 40) return false;
  return Math.abs(x - ridgeAt(z)[1]) < 2.5 && Math.abs(z - passCrossing()) >= PLAN.ridge.gap;
}

/** the pass's middle line and its floor, for whoever dresses its walls and digs its caves (src/sim/pass.ts); and the ramps cut between its shelves */
export function passData() {
  return { line: passLine.pts.map(([x, z], k) => [x, z, passFloor(passLine.run[k])] as [number, number, number]), floor: PLAN.pass.floor, shelves: PLAN.pass.shelves, ramps: rampsCut };
}
