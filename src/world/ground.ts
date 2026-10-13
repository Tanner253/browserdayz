// What the ground is, place by place: the kinds of ground there are, and how much of each lies at every point of
// the world's net. (2026-10-13: "we need natural ground ... there different forest floor textures for us to use as
// well, we could make different kinds of forest with different tre types".)
//
// Nothing here is said by the world's generator, and nothing here changes it. The generator says four things of a
// point (grass, forest floor, rock, bare: `world.splat`), where every tree stands and of what kind, where the roads
// run and how high the ground is. This reads those and says twelve things: which grass, which forest floor under
// which trees, earth trodden bare or the gravel of a road's shoulder, stony ground or rock. So a new kind of ground
// is a line in KINDS and a rule in layGround, and the map is not touched.
//
// The pictures are Poly Haven's (scripts/assets.config.mjs TEXTURES); how they are drawn is src/world/terrain.ts.

import { Simplex } from '../core/noise';
import { CELL, SNOW, WORLD_RES, WORLD_SIZE, type World } from './worldgen';

/** what a footstep or a bullet is told the ground is (the four the game has sounds for) */
export type Sound = 'grass' | 'dirt' | 'rock' | 'gravel';

export interface Kind {
  /** its picture set (TEXTURES in scripts/assets.config.mjs) */
  tex: string;
  /** metres to a repeat: the size the picture is in life */
  size: number;
  /** what its colour is multiplied by, so that the kinds sit together as one country's ground */
  tint: [number, number, number];
  sound: Sound;
  /**
   * From far off each kind is also laid large, which is what gives distant ground a grain: this many times its own
   * size, as a share (0.27 unless said: nearly four times). Rock is laid much larger still, so that from across the
   * valley a face has crags and not a flat colour.
   */
  far?: number;
  /** on a steep face it is laid by the face's own direction, not from above (rock, and the stones under it) */
  sided?: boolean;
  /** its relief is soft and fine (grass, needles, moss): held at half the size, which is not seen and is a quarter of the memory */
  quiet?: boolean;
}

/** The kinds, in the order they are held in (four to a picture of weights: see layGround). */
export const KINDS = {
  // meadow: lush in the hollows and round the gardens, turf over most of it, dry on the knolls and toward the snow
  lush: { tex: 'leafy_grass', size: 2.0, tint: [0.78, 0.96, 0.62], sound: 'grass', quiet: true },
  turf: { tex: 'grass_ground', size: 2.5, tint: [1.45, 1.78, 1.25], sound: 'grass', quiet: true },
  dry: { tex: 'withered_grass', size: 2.0, tint: [0.6, 0.71, 0.5], sound: 'grass', quiet: true },
  // the thin grass and fallen twigs of a wood's edge and of the gaps in it
  edge: { tex: 'forrest_ground_01', size: 2.0, tint: [0.76, 0.86, 0.7], sound: 'grass', quiet: true },
  // forest floors: needles under pine, leaves under birch, oak and ash, moss in the damp shade, dark earth in the hollows
  // ('dirt' is what the game takes for being in the forest: its birds and its hush)
  needle: { tex: 'forrest_ground_03', size: 2.0, tint: [0.62, 0.61, 0.56], sound: 'dirt', quiet: true },
  leaf: { tex: 'dry_decay_leaves', size: 2.0, tint: [1.12, 1.4, 1.45], sound: 'dirt' },
  moss: { tex: 'forest_leaves_02', size: 3.0, tint: [0.62, 0.8, 0.7], sound: 'dirt', quiet: true },
  earth: { tex: 'forest_ground_06', size: 2.1, tint: [1.1, 1.1, 1.1], sound: 'dirt', quiet: true },
  // the trodden earth of a track, a yard, a camp (it answers as gravel did: a yard is not the forest)
  trodden: { tex: 'dry_mud_field_001', size: 3.0, tint: [1.5, 1.46, 1.38], sound: 'gravel' },
  // the metalling along a road's edge
  gravel: { tex: 'rocks_ground_02', size: 2.0, tint: [0.86, 0.84, 0.8], sound: 'gravel' },
  // stony ground: slopes too steep for turf and not steep enough to be a face, and what has come down off a face to lie at its foot
  stony: { tex: 'rocky_trail', size: 2.0, tint: [0.56, 0.59, 0.6], sound: 'gravel', sided: true, far: 0.13 },
  // the rock of a steep face (a rock face photographed square on: the air photograph of fifty metres that was laid
  // here six metres wide smeared down every face it was on)
  rock: { tex: 'rock_face_03', size: 2.7, tint: [0.72, 1.0, 1.42], sound: 'rock', sided: true, far: 0.09 },
} satisfies Record<string, Kind>;

/**
 * SNOW ON THE GROUND, in one place, for whatever else snow lies on to match (the fort on the mountain, its rocks):
 * the colour it is from far off (as light, before the hour's light falls on it), and the picture it is given close
 * to, laid this many metres to a repeat. Where it lies is the world's to say (SNOW in src/world/worldgen.ts); how
 * it is drawn on the ground is src/world/terrain.ts.
 */
export const SNOW_GROUND = { tex: 'snow_02', size: 2.0, colour: [0.8, 0.83, 0.88] as [number, number, number], rough: 0.62 };

export type KindName = keyof typeof KINDS;
export const KIND_NAMES = Object.keys(KINDS) as KindName[];
/** each kind's place in the order */
export const KIND_AT = Object.fromEntries(KIND_NAMES.map((k, i) => [k, i])) as Record<KindName, number>;

export interface Ground {
  /** how much of each kind lies at each point of the net, 0 to 255, summing to 255: four kinds to an RGBA picture, in KINDS' order */
  weights: Uint8Array[];
  /** the kind there is most of at each point of the net (its place in KINDS) */
  top: Uint8Array;
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A field of the net evened out over `reach` points either way, twice over (near enough a soft round blur). */
function evened(field: Float32Array, reach: number): Float32Array {
  const N = WORLD_RES;
  let cur = field;
  for (let pass = 0; pass < 4; pass++) {
    const next = new Float32Array(N * N);
    // (a running sum along each row, then along each column: `step` is one point on along it)
    const step = pass % 2 === 0 ? 1 : N, row = pass % 2 === 0 ? N : 1;
    for (let a = 0; a < N; a++) {
      const o = a * row;
      let sum = 0, count = 0;
      for (let b = 0; b <= Math.min(reach, N - 1); b++) { sum += cur[o + b * step]; count++; }
      for (let b = 0; b < N; b++) {
        next[o + b * step] = sum / count;
        const out = b - reach, come = b + reach + 1;
        if (out >= 0) { sum -= cur[o + out * step]; count--; }
        if (come < N) { sum += cur[o + come * step]; count++; }
      }
    }
    cur = next;
  }
  return cur;
}

/** every how many points of the net a slow pattern is reckoned (it is read between them) */
const COARSE = 4;
/** A slow pattern over the whole net, reckoned at every fourth point each way: `at` reads it anywhere between. */
function slow(fn: (x: number, z: number) => number) {
  const M = Math.ceil((WORLD_RES - 1) / COARSE) + 1, half = WORLD_SIZE / 2, data = new Float32Array(M * M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) data[j * M + i] = fn(-half + i * COARSE * CELL, -half + j * COARSE * CELL);
  return (ix: number, iz: number) => {
    const i = ix >> 2, j = iz >> 2, fx = (ix & 3) / COARSE, fz = (iz & 3) / COARSE, o = j * M + i;
    const a = data[o], b = data[o + 1] ?? a, c = data[o + M] ?? a, d = data[o + M + 1] ?? a;
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  };
}

/** The ground of a world, kind by kind. A quarter of a second's reckoning or so, done once when the ground is built. */
export function layGround(world: World): Ground {
  const N = WORLD_RES, n = N * N, half = WORLD_SIZE / 2;
  const H = world.heights, S = world.splat;
  const cell = (x: number) => Math.round((x + half) / CELL);

  // --- hollows and knolls: the ground against the mean of the ground for some twenty metres about it
  const mean = evened(H, 6);
  // --- what stands over it: pine, and broadleaf (a bush is a little of that). Under the crown itself, for the litter
  // a lone tree sheds on grass; and spread over a dozen metres (`pineWood`, `broadWood`), for what kind of wood a
  // place is in: a forest's floor is needles or leaves from trunk to trunk, not a ring round each.
  const pine = new Float32Array(n), broad = new Float32Array(n);
  for (const t of world.trees) {
    const isPine = t.kind.startsWith('pine'), bush = t.kind.startsWith('bush');
    const R = (bush ? 2.2 : isPine ? 5.2 : 5.6) * t.scale, amount = bush ? 0.5 : 1, field = isPine ? pine : broad;
    const x0 = Math.max(0, cell(t.x - R)), x1 = Math.min(N - 1, cell(t.x + R)), z0 = Math.max(0, cell(t.z - R)), z1 = Math.min(N - 1, cell(t.z + R));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const dx = -half + ix * CELL - t.x, dz = -half + iz * CELL - t.z, q = 1 - (dx * dx + dz * dz) / (R * R);
      if (q > 0) field[iz * N + ix] += amount * q * q;
    }
  }
  const pineWood = evened(pine, 3), broadWood = evened(broad, 3);
  // --- how far from the edge of a road's asphalt (under it: less than nothing)
  const road = new Float32Array(n).fill(99);
  const roads: World['roads'] = [world.road, ...world.roads];
  for (const r of roads) {
    if (r.bridge) continue;
    const p = r.points, reach = r.width / 2 + 5;
    for (let k = 0; k + 1 < p.length / 3; k++) {
      const ax = p[k * 3], az = p[k * 3 + 2], bx = p[k * 3 + 3], bz = p[k * 3 + 5], ex = bx - ax, ez = bz - az, len2 = ex * ex + ez * ez || 1;
      const x0 = Math.max(0, cell(Math.min(ax, bx) - reach)), x1 = Math.min(N - 1, cell(Math.max(ax, bx) + reach));
      const z0 = Math.max(0, cell(Math.min(az, bz) - reach)), z1 = Math.min(N - 1, cell(Math.max(az, bz) + reach));
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
        const x = -half + ix * CELL, z = -half + iz * CELL, t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / len2));
        const qx = x - ax - ex * t, qz = z - az - ez * t, d = Math.sqrt(qx * qx + qz * qz) - r.width / 2;
        if (d < road[iz * N + ix]) road[iz * N + ix] = d;
      }
    }
  }
  // (the floor of the works is half hard standing: lorries, and whatever leaked)
  const works = world.sites.find((s) => s.kind === 'works');
  // --- where there is a rock face, and so where what comes down off one lies: within a few metres of a face
  const faces = new Float32Array(n);
  for (let iz = 1; iz < N - 1; iz++) for (let ix = 1; ix < N - 1; ix++) {
    const i = iz * N + ix, gx = (H[i + 1] - H[i - 1]) / (2 * CELL), gz = (H[i + N] - H[i - N]) / (2 * CELL);
    faces[i] = (S[i * 4 + 2] / 255) * smooth(0.7, 1.0, Math.sqrt(gx * gx + gz * gz));
  }
  const nearFace = evened(faces, 2);

  const n1 = new Simplex(7001), n2 = new Simplex(7002), n3 = new Simplex(7003);
  // (slow patterns, each some tens of metres to a hundred across: which grass, and where the moss is)
  const wide = slow((x, z) => n1.fbm(x * 0.011, z * 0.011, 3));
  const mid = slow((x, z) => n2.noise(x * 0.027, z * 0.027));
  const patch = slow((x, z) => n3.noise(x * 0.021, z * 0.021) * 0.5 + 0.5);
  // (the sun stands in the south-east of the sky all day: a slope that falls away from it is the damp side of a hill)
  const sunX = 0.8, sunZ = 0.6;
  const weights = [new Uint8Array(n * 4), new Uint8Array(n * 4), new Uint8Array(n * 4)], top = new Uint8Array(n);
  const K = KIND_AT, w = new Float32Array(KIND_NAMES.length);
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const i = iz * N + ix, x = -half + ix * CELL, z = -half + iz * CELL;
      const g = S[i * 4] / 255, f = S[i * 4 + 1] / 255, r = S[i * 4 + 2] / 255, v = S[i * 4 + 3] / 255;
      const h = H[i];
      const gx = (H[iz * N + Math.min(ix + 1, N - 1)] - H[iz * N + Math.max(ix - 1, 0)]) / (2 * CELL);
      const gz = (H[Math.min(iz + 1, N - 1) * N + ix] - H[Math.max(iz - 1, 0) * N + ix]) / (2 * CELL);
      const slope = Math.sqrt(gx * gx + gz * gz);
      // (a hollow or a knoll is a couple of metres under or over the mean about it)
      const hollow = Math.min(1, Math.max(0, (mean[i] - h) / 2.2)), knoll = Math.min(1, Math.max(0, (h - mean[i]) / 2.2));
      // (it falls toward -gradient: shaded when that is away from the sun)
      const shade = Math.min(1, Math.max(0, (gx * sunX + gz * sunZ) * 2.2));
      const P = pine[i], B = broad[i], cover = Math.min(1, P + B), pines = P / (P + B + 1e-3);
      const PW = pineWood[i], BW = broadWood[i], wood = PW + BW, pineShare = PW / (wood + 1e-3);
      const m1 = wide(ix, iz), m2 = mid(ix, iz), m3 = patch(ix, iz);
      w.fill(0);

      // bare ground: gravel along a road, trodden earth where it is wholly bare, and at its thin edges and in the
      // meadow's bald patches no more than dry grass
      const shoulder = 1 - smooth(0.6, 3.4, road[i]);
      const bare = smooth(0.42, 0.7, v);
      w[K.gravel] = v * shoulder;
      w[K.trodden] = v * (1 - shoulder) * bare;
      w[K.dry] = v * (1 - shoulder) * (1 - bare);
      if (w[K.trodden] > 0.01) {
        // A yard is not swept, nor dry all over. Small stones lie about it in drifts and gather along its edges,
        // where feet and wheels have pushed them; and there are darker places where the water stands after rain.
        const strewn = Math.max(smooth(0.05, 0.6, n2.noise(x * 0.07 + 9, z * 0.07 - 4)) * 0.45, (1 - smooth(0.62, 0.97, v)) * 0.65);
        const stood = smooth(0.2, 0.62, n3.noise(x * 0.085 - 31, z * 0.085 + 12)) * 0.6 * (1 - strewn);
        w[K.stony] += w[K.trodden] * strewn;
        w[K.earth] += w[K.trodden] * stood;
        w[K.trodden] *= 1 - strewn - stood;
      }
      if (works && (x - works.x) * (x - works.x) + (z - works.z) * (z - works.z) < 10000) {
        const hard = smooth(-0.25, 0.35, n2.noise(x * 0.05 + 40, z * 0.05 - 17)) * 0.75;
        w[K.gravel] += w[K.trodden] * hard;
        w[K.trodden] *= 1 - hard;
      }

      // grass: three of them, by how wet the place is (a hollow is, a knoll is not, and a slow pattern of its own
      // over a hundred metres says the rest), drying toward the snow line
      const wet = 0.5 * (hollow - knoll) + 0.75 * m1 + 0.2 * m2;
      const high = smooth(SNOW.from - 28, SNOW.from - 4, h);
      const lush = smooth(0.15, 0.5, wet - high), dry = smooth(0.15, 0.5, -wet + high * 1.3);
      let grass = g;
      // what stands over grass sheds on it: litter under the crown, thinning out through twiggy grass into the meadow
      const litter = smooth(0.3, 0.95, cover) * 0.78, twigs = smooth(0.04, 0.4, cover) * (1 - litter) * 0.65;
      w[K.needle] += grass * litter * pines;
      w[K.leaf] += grass * litter * (1 - pines);
      w[K.edge] += grass * twigs;
      grass *= 1 - litter - twigs;
      w[K.lush] += grass * lush;
      w[K.dry] += grass * dry;
      w[K.turf] += grass * Math.max(0, 1 - lush - dry);

      // forest floor: by what stands over it; where nothing does (a gap, the wood's edge) twiggy grass; moss on the
      // damp side of a hill and in hollows, and in the deepest of those bare dark earth
      const open = 1 - smooth(0.02, 0.16, wood);
      const floor = f * (1 - open);
      const dark = smooth(0.6, 1, hollow) * 0.7;
      const mossy = smooth(0.45, 0.9, hollow * 0.7 + shade * 0.45 + m3 * 0.45) * 0.8 * (1 - dark);
      w[K.edge] += f * open;
      w[K.earth] += floor * dark;
      w[K.moss] += floor * mossy;
      w[K.needle] += floor * (1 - dark - mossy) * pineShare;
      w[K.leaf] += floor * (1 - dark - mossy) * (1 - pineShare);

      // rock: a face where it is steeper than a man walks up, stony ground below that; and at the foot of a face
      // (near one, and lower than the ground about it) what would be grass or litter is half scree
      const face = smooth(0.7, 1.0, slope);
      const scree = smooth(0.05, 0.3, nearFace[i]) * smooth(-0.2, 0.9, mean[i] - h) * (1 - face) * 0.7;
      if (scree > 0.01) {
        for (let k = 0; k <= K.earth; k++) {
          w[K.stony] += w[k] * scree;
          w[k] *= 1 - scree;
        }
      }
      w[K.rock] += r * face;
      w[K.stony] += r * (1 - face);

      let sum = 0, best = 0;
      for (let k = 0; k < w.length; k++) {
        sum += w[k];
        if (w[k] > w[best]) best = k;
      }
      top[i] = best;
      const to = 255 / (sum || 1);
      for (let k = 0; k < w.length; k++) weights[k >> 2][i * 4 + (k & 3)] = Math.round(w[k] * to);
    }
  }
  return { weights, top };
}
