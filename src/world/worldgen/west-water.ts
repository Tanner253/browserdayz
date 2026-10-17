// THE WEST'S WATER (2026-10-16): the owner, "i want lakes and rivers as well in natural spots in the map since we now
// have water". One river, rising at the head of the green river valley by today's map, down the valley's floor,
// through the pass along its north side, and across the desert in a shallow wadi with a green line on its banks, to
// the sea; the lake Ozerki fishes, north of Lipki; and the swamp in the green land's low south-west. Their beds are
// cut here into the world's net; what the water is (its levels, its shores, its line) is given back as `Waters`
// (src/sim/water.ts), which draws it and wades in it.

import { Simplex, clamp, lerp, smoothstep } from '../../core/noise';
import { catmullRom } from './ground';
import { CELL, SEA_LEVEL, WORLD_SEED } from './places';
import { PLAN, inside, outside } from './west-plan';
import { Line, passLine, valleyLine, type Net } from './west-relief';

type P = [number, number];
const w1 = new Simplex(WORLD_SEED + 341), w2 = new Simplex(WORLD_SEED + 342);

/** a river: its line, upstream to downstream, with the water's height and width at each point (src/sim/water.ts) */
export type RiverPts = [x: number, z: number, surface: number, width: number][];

/** the ground's height at a spot of a net (the nearest sample) */
const sample = (H: Float32Array, net: Net, x: number, z: number) => H[clamp(Math.round((z - net.z0) / CELL), 0, net.nz - 1) * net.nx + clamp(Math.round((x - net.x0) / CELL), 0, net.nx - 1)];

/**
 * The river's line: down the valley (a little to and fro on its floor, but straight past the brick works' quay), on
 * to the north side of the pass's floor over the last of it, along the pass, and out across the desert to the sea.
 */
export function riverLine(): { pts: P[]; part: number[] } {
  const R = PLAN.river, out: P[] = [], part: number[] = [];
  // (the left of the way it runs, as `Along.s` has it: for a line running west, south)
  const left = (tx: number, tz: number): P => [tz, -tx];
  // (the valley's: its own line, off its middle by up to a third of its floor)
  for (let k = 0; k < valleyLine.pts.length; k += 2) {
    const along = valleyLine.run[k], a = valleyLine.at(along), [nx, nz] = left(a.tx, a.tz);
    const still = PLAN.valley.wide[0] <= a.x && a.x <= PLAN.valley.wide[1] ? 0 : 1;
    const wander = R.wander * w1.noise(along * 0.006, 1.7) * still * smoothstep(0, 120, along);
    // (and over its last 90 m, over to the pass's north side, where the pass takes it on)
    const over = PLAN.pass.river.side;
    const s = lerp(wander, over, smoothstep(valleyLine.total - 90, valleyLine.total, along));
    out.push([a.x + nx * s, a.z + nz * s]);
    part.push(0);
  }
  for (let k = 2; k < passLine.pts.length; k += 2) {
    const a = passLine.at(passLine.run[k]), [nx, nz] = left(a.tx, a.tz), s = PLAN.pass.river.side;
    out.push([a.x + nx * s, a.z + nz * s]);
    part.push(1);
  }
  const last = out[out.length - 1];
  for (const p of catmullRom([last, ...(R.desert as P[])], 6).slice(1)) {
    out.push(p);
    part.push(2);
  }
  return { pts: out, part };
}

/**
 * The river's water: in the valley and the pass a little under the floor it runs on; in the desert falling evenly
 * from the pass's mouth to the sea. Never uphill: each point's water is no higher than the one before it.
 */
export function riverWater(H: Float32Array, net: Net, shoreAt: (z: number) => number): RiverPts {
  const R = PLAN.river, { pts, part } = riverLine(), n = pts.length;
  const run = [0];
  for (let k = 1; k < n; k++) run.push(run[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const firstDesert = part.indexOf(2), mouth = run[firstDesert - 1];
  const out: RiverPts = [];
  for (let k = 0; k < n; k++) {
    const [x, z] = pts[k], width = part[k] === 0 ? lerp(R.width[0], R.width[1], run[k] / mouth) : part[k] === 1 ? R.width[1] : R.width[2];
    let y: number;
    if (part[k] < 2) {
      // (the floor about it: the lowest of the samples across where it runs)
      let low = Infinity;
      for (const dx of [-2, 0, 2]) for (const dz of [-2, 0, 2]) low = Math.min(low, sample(H, net, x + dx, z + dz));
      y = low - R.under;
    } else {
      const from = out[firstDesert - 1][2], shore = shoreAt(z), t = clamp((pts[firstDesert - 1][0] - x) / (pts[firstDesert - 1][0] - shore), 0, 1);
      y = x < shore ? SEA_LEVEL - 0.05 : lerp(from, SEA_LEVEL + 0.12, t);
    }
    if (k > 0) y = Math.min(y, out[k - 1][2] - 0.0015 * (run[k] - run[k - 1]));
    out.push([x, z, y, width]);
  }
  return out;
}

/**
 * The river's bed cut into the ground: a channel under the water, deepest in its middle (a ford's shallower), its
 * banks a slope up to the floor; in the desert a wadi about it as well, its floor a little over the water and its
 * sides easing up into the sand. (Cut again after the roads' beds, so that a ford is the river's and not the road's.)
 */
export function carveRiver(H: Float32Array, net: Net, out: RiverPts) {
  const R = PLAN.river, { part } = riverLine(), n = out.length, pts = out.map(([x, z]) => [x, z] as P);
  const run = [0];
  for (let k = 1; k < n; k++) run.push(run[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const mouth = run[part.indexOf(2) - 1];
  const line = new Line(pts, 0), W = R.wadi;
  const depth = (k: number) => (part[k] === 0 ? lerp(R.depth[0], R.depth[1], run[k] / mouth) : R.depth[1]);
  line.each(net, Math.max(W[0] + W[1], R.width[2] / 2 + 6), (i, x, z, a) => {
    const k = clamp(a.k, 0, n - 2), u = clamp((a.along - run[k]) / (run[k + 1] - run[k] || 1), 0, 1);
    const y = lerp(out[k][2], out[k + 1][2], u), w = lerp(out[k][3], out[k + 1][3], u), dp = lerp(depth(k), depth(k + 1), u) * (1 - fordAt(x, z));
    // (its banks a few metres up to the floor it runs on: no further, so that it cuts nothing of the walls beside it)
    let bed = a.d < w / 2 ? y - dp * (1 - 0.6 * (2 * a.d / w) ** 2) - 0.06 : a.d < w / 2 + 4 ? y - 0.1 + (a.d - w / 2) * 0.55 : Infinity;
    if (part[k] === 2) bed = Math.min(bed, a.d < W[0] ? y + 0.45 + 0.15 * w2.noise(x * 0.05, z * 0.05) : y + 0.45 + (a.d - W[0]) * (2.4 / W[1]) + 0.05 * (a.d - W[0]) ** 1.5);
    if (bed < H[i]) H[i] = bed;
  });
}

/** which samples of a net are the river's, its water and a few metres either side of it (1) */
export function riverMask(river: RiverPts, net: Net, more = 3) {
  const out = new Uint8Array(net.nx * net.nz);
  for (let k = 0; k + 1 < river.length; k++) {
    const [ax, az, , aw] = river[k], [bx, bz, , bw] = river[k + 1], ex = bx - ax, ez = bz - az, len2 = ex * ex + ez * ez || 1, r = Math.max(aw, bw) / 2 + more;
    const ix0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - net.x0) / CELL)), ix1 = Math.min(net.nx - 1, Math.ceil((Math.max(ax, bx) + r - net.x0) / CELL));
    const iz0 = Math.max(0, Math.floor((Math.min(az, bz) - r - net.z0) / CELL)), iz1 = Math.min(net.nz - 1, Math.ceil((Math.max(az, bz) + r - net.z0) / CELL));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const x = net.x0 + ix * CELL, z = net.z0 + iz * CELL, t = clamp(((x - ax) * ex + (z - az) * ez) / len2, 0, 1);
      if (Math.hypot(x - ax - ex * t, z - az - ez * t) < lerp(aw, bw, t) / 2 + more) out[iz * net.nx + ix] = 1;
    }
  }
  return out;
}

/** where the river is forded (a part of its depth taken off): where a path crosses it, shallow enough to wade */
function fordAt(x: number, z: number) {
  let f = 0;
  for (const [fx, fz, r] of PLAN.river.fords) f = Math.max(f, 1 - smoothstep(r * 0.5, r, Math.hypot(x - fx, z - fz)));
  return f * 0.45;
}

/** the level a lake lies at in the land: a little under the ground round its shore, on the low side of the middle (the land falls across it: the low side is banked up) */
export function lakeLevel(H: Float32Array, net: Net, shore: P[]) {
  const round: number[] = [];
  for (let k = 0; k < shore.length; k++) {
    const [ax, az] = shore[k], [bx, bz] = shore[(k + 1) % shore.length], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 4);
    for (let j = 0; j < n; j++) round.push(sample(H, net, ax + ((bx - ax) * j) / n, az + ((bz - az) * j) / n));
  }
  round.sort((a, b) => a - b);
  return round[Math.floor(round.length * 0.3)] - 0.3;
}

/**
 * A lake's bed under its level, inside its shore: shelving from the shore, deepest in its middle; and the land about
 * it held at least a little over the water, so it lies in a basin and spills nowhere.
 */
export function cutLake(H: Float32Array, net: Net, shore: P[], level: number, deepest: number) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of shore) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const E = 30;
  for (let iz = Math.max(0, Math.floor((z0 - E - net.z0) / CELL)); iz <= Math.min(net.nz - 1, Math.ceil((z1 + E - net.z0) / CELL)); iz++)
    for (let ix = Math.max(0, Math.floor((x0 - E - net.x0) / CELL)); ix <= Math.min(net.nx - 1, Math.ceil((x1 + E - net.x0) / CELL)); ix++) {
      const x = net.x0 + ix * CELL, z = net.z0 + iz * CELL, i = iz * net.nx + ix;
      if (inside(shore, x, z)) {
        const e = edgeIn(shore, x, z);
        H[i] = level - Math.min(deepest, 0.8 + e * 0.09) + 0.3 * w1.noise(x * 0.04, z * 0.04);
      } else {
        const e = outside(shore, x, z);
        if (e < E) H[i] = Math.max(H[i], lerp(level + 0.1, H[i], smoothstep(4, E, e)));
      }
    }
}
/** how far inside a shore a spot is */
function edgeIn(shore: P[], x: number, z: number) {
  let d = Infinity;
  for (let k = 0; k < shore.length; k++) {
    const [ax, az] = shore[k], [bx, bz] = shore[(k + 1) % shore.length], ex = bx - ax, ez = bz - az, u = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1), 0, 1);
    d = Math.min(d, Math.hypot(x - ax - ex * u, z - az - ez * u));
  }
  return d;
}

/**
 * The swamp: a shallow basin dug a little under the land about it, water over nearly all of it at one level (a few
 * centimetres to a hand over the knee), hummocks and islands just over the water, a few deeper pools nobody needs to
 * cross; its banks easing up into the land. `keep`: a spot left to whoever sets the hamlet down there (its own islands
 * and hollows). Gives back the water's level.
 */
export function cutSwamp(H: Float32Array, net: Net, keep: (x: number, z: number) => boolean): number {
  const S = PLAN.swamp, shore = S.outline as P[];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of shore) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  // (its level: a little under the land it lies in, on the whole)
  let sum = 0, c = 0;
  for (let x = x0; x <= x1; x += 8) for (let z = z0; z <= z1; z += 8) if (inside(shore, x, z)) { sum += sample(H, net, x, z); c++; }
  const level = sum / c - S.dig, E = 35;
  for (let iz = Math.max(0, Math.floor((z0 - E - net.z0) / CELL)); iz <= Math.min(net.nz - 1, Math.ceil((z1 + E - net.z0) / CELL)); iz++)
    for (let ix = Math.max(0, Math.floor((x0 - E - net.x0) / CELL)); ix <= Math.min(net.nx - 1, Math.ceil((x1 + E - net.x0) / CELL)); ix++) {
      const x = net.x0 + ix * CELL, z = net.z0 + iz * CELL, i = iz * net.nx + ix;
      if (inside(shore, x, z)) {
        if (keep(x, z)) continue;
        const e = edgeIn(shore, x, z), n = w2.fbm(x * 0.028, z * 0.028, 3);
        let y = level - lerp(S.shallow[0], S.shallow[1], smoothstep(-0.3, 0.4, w1.fbm(x * 0.05 + 3, z * 0.05, 2)));
        if (n > S.isle) y = level + lerp(0.1, 0.55, smoothstep(S.isle, S.isle + 0.25, n));
        else if (n < -S.pool) y = level - lerp(S.shallow[1], S.deep, smoothstep(S.pool, S.pool + 0.2, -n));
        H[i] = lerp(level - 0.04, y, smoothstep(0, 12, e));
      } else {
        const e = outside(shore, x, z);
        if (e < E) H[i] = H[i] > level ? lerp(level + 0.06, H[i], smoothstep(0, E, e)) : level + 0.06 + e * 0.02;
      }
    }
  return level;
}
