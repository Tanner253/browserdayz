// Where snow lies: by height, OR BY PLACE. The whole rule, for everything that asks.
//
// Snow was decided by height alone (SNOW in the world's generator: none below `from`, all of the ground white above
// `full`, none on a cliff). Then the fort was moved down off the snow mountain to the valley's rim, far under the
// snow line, and the owner walked it and said (2026-10-13): "i want the area around the castle and
// leaidng up tot the castle snowy, even if its lower elevation than the snow cap elevation. the snow look on the
// castle was much nicer, with the snow tire paths you made and everything".
//
// So a place can be snowy too. A place is a PATCH: a round, or a length of a way with a round at each end, that
// ADDS METRES to the height that is compared with the snow line: all of them out to `core` metres from it, less and
// less over `soft` metres more, and nothing beyond. The ground there is not moved: it is reckoned as if it stood
// that much higher, by everything that asks where snow lies. So the rest of the rule holds in a patch as it holds
// on the mountain: the line is ragged (each reader's own raggedness is added as ever), nothing lies on a cliff,
// the grass thins under it, and where a patch's edge meets a hillside the snow comes further down the higher
// ground and stops sooner on the lower: a snow line coming down the hill, not a white disc.
//
// THE PATCHES ARE WORKED OUT FROM THE WORLD, when it is first asked of, and never written down as places: the fort
// (`world.castle`) with the ground about it, and every way that comes to the fort (`world.paths`: the cart track
// up to it from the end of the mountain road), told as a few straight lengths. Move the fort, or draw its track
// another way, and the snow goes with them. A world with no fort has no patch, and the rule is height alone.
//
// Who reads it: the ground's paint and its grass (src/world/terrain.ts), the kinds of ground (ground.ts), trees,
// ferns and rocks near and far (foliage.ts, vegetation.ts), the asphalt (road.ts), a blast's dust (the game's
// effects). In TS: `snowLift`. In a shader: SNOW_LIFT, with `snowUniforms` handed to the material. A shader that
// has the snippet and was never handed the uniforms reads no lift at all: the rule by height, as it was.
//
// (Nothing of the generator's is read here until a function is called: the generator may ask this file for the
// rule without the two files waiting on each other.)

import { CELL, SNOW, WORLD_RES, WORLD_SIZE, catmullRom, heightAt, type World } from './worldgen';

/** what of a world the snow is told from */
export type SnowWorld = Pick<World, 'castle' | 'paths' | 'surface' | 'road' | 'roads'>;

/** the most patches there are (the fort, and the lengths its ways are told as): a shader looks at each */
export const SNOW_PATCHES = 8;

/**
 * The snowy places.
 *   fort  – all of the lift for `core` metres from the fort's middle (its walls and the ground at their feet),
 *           and less and less of it over `soft` more
 *   way   – the same either side of a way to the fort
 *           THE SOFT EDGE IS LONG, AND THAT IS THE POINT OF IT. Level ground is all white where the lift is some
 *           four fifths of what it is at the core, and bare where it is little more than half: so the white ends
 *           between a third and a half of the way out along `soft`, and where exactly goes by the ground's own
 *           height there and by the reader's ragged line, as it does on the mountain. Over a short soft edge
 *           those count for nothing and the white ends on a ruled curve (tried at 75 m: from the air, a disc).
 *           Over this one a metre of height is a metre and a third of ground: the line breaks into tongues and
 *           islands, the bench the track runs along is white from the mountain's foot to the valley's brink, and
 *           the meadow beyond is not.
 *   over  – how far over the height at which all the ground is white the lowest ground of a patch is reckoned to
 *           stand: the most a reader's ragged line takes off, and a little
 *   wanders – nor is a patch's edge a ruled line before any of that: it lies so many metres further out here and
 *             nearer in there (three times this at the most), in lobes fifty metres long and lesser ones of seventeen
 *   fits  – a way is told as straight lengths that lie within so many metres of it (or as many as there is room for)
 *   reach – a way is the fort's if it comes within so many metres of the fort's middle, anywhere along it (the
 *           track comes to the gate, or goes round under the walls to it: wherever the fort is turned)
 *   joins – a way is driven if one end of it lies within so many metres of an end of a road
 */
export const SNOW_PLACE = {
  fort: { core: 60, soft: 150 },
  way: { core: 16, soft: 150 },
  over: 14,
  wanders: 5,
  fits: 3,
  reach: 90,
  joins: 12,
};

/**
 * The tyre ruts in the snow on a way that is driven (the cart track from the road's end to the gate). The mountain
 * road had them when the fort stood at its top ("the snow tire paths you made"): two lines the wheels kept open,
 * the road dark and wet in them. The track is not a strip of asphalt with an edge to measure from, so its ruts are
 * told by a picture laid over it (see `snowRuts`): how far across from its middle a spot is.
 *   gauge – each rut's middle, metres from the middle of the way (the road's own are at 0.93)
 *   wide  – a rut is all open to so far from its own middle, and closed by so far
 *   reach – the picture knows the way's middle to so far either side
 *   texel – metres to a point of the picture
 *   ends  – over so many metres at each end of the way the ruts come in and go out (at the road's end the
 *           asphalt's own ruts lead into them; at the gate the yard begins)
 */
export const RUTS = { gauge: 0.86, wide: [0.15, 0.4] as [number, number], reach: 3, texel: 0.25, ends: 4 };

/** a patch: from (ax, az) to (bx, bz), a round if they are one place; and the metres it adds */
export interface SnowPatch { ax: number; az: number; bx: number; bz: number; core: number; soft: number; lift: number }
export interface SnowPlaces {
  patches: SnowPatch[];
  /** a round that holds every patch to its last metre: outside it nothing is asked */
  bound: { x: number; z: number; r: number };
  /** the ways to the fort that are driven, each as the line its bed was laid on (the ruts are on these) */
  driven: [number, number][][];
}

const told = new WeakMap<object, SnowPlaces>();

/** the places of a world where snow lies whatever the height (worked out once for each world, and kept) */
export function snowPlaces(world: SnowWorld): SnowPlaces {
  const had = told.get(world);
  if (had) return had;
  const P = SNOW_PLACE, patches: SnowPatch[] = [], driven: [number, number][][] = [], C = world.castle;
  // (how many metres a spot of ground at this height is short of being white whatever a ragged line takes off it)
  const short = (y: number) => Math.max(0, SNOW.full + P.over - y);
  if (C) {
    if (short(C.y) > 0) patches.push({ ax: C.x, az: C.z, bx: C.x, bz: C.z, core: P.fort.core, soft: P.fort.soft, lift: short(C.y) });
    // The ways that come to it. Each is the line the world laid its bed on, and is told as a few straight
    // lengths: the fewest that lie within `fits` of it, and no more than there is room for.
    const ways = world.paths.filter((p) => p.length > 1 && p.some((q) => Math.hypot(q[0] - C.x, q[1] - C.z) < P.reach));
    const room = Math.max(1, Math.floor((SNOW_PATCHES - patches.length) / Math.max(1, ways.length)));
    const ends: [number, number][] = [];
    for (const r of [world.road, ...world.roads]) {
      const n = r.points.length / 3;
      if (n > 0) ends.push([r.points[0], r.points[2]], [r.points[n * 3 - 3], r.points[n * 3 - 1]]);
    }
    for (const way of ways) {
      const line = catmullRom(way, 2), cut = [0, line.length - 1];
      for (;;) {
        // (the point of the line that lies furthest from the length it is told by: that length is told as two)
        let worst = P.fits, at = -1, after = 0;
        for (let s = 0; s + 1 < cut.length; s++) {
          const [ax, az] = line[cut[s]], [bx, bz] = line[cut[s + 1]], dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
          for (let k = cut[s] + 1; k < cut[s + 1]; k++) {
            const t = Math.min(1, Math.max(0, ((line[k][0] - ax) * dx + (line[k][1] - az) * dz) / len2));
            const off = Math.hypot(line[k][0] - ax - dx * t, line[k][1] - az - dz * t);
            if (off > worst) { worst = off; at = k; after = s; }
          }
        }
        if (at < 0 || cut.length > room) break;
        cut.splice(after + 1, 0, at);
      }
      for (let s = 0; s + 1 < cut.length && patches.length < SNOW_PATCHES; s++) {
        // (by the lowest ground the length crosses: all of it is white)
        let low = Infinity;
        for (let k = cut[s]; k <= cut[s + 1]; k++) low = Math.min(low, heightAt(world.surface, line[k][0], line[k][1]));
        if (short(low) <= 0) continue;
        patches.push({ ax: line[cut[s]][0], az: line[cut[s]][1], bx: line[cut[s + 1]][0], bz: line[cut[s + 1]][1], core: P.way.core, soft: P.way.soft, lift: short(low) });
      }
      // (driven: it leaves a road's end. A foot path leaves nothing wheels came by.)
      if (ends.some((e) => Math.hypot(e[0] - way[0][0], e[1] - way[0][1]) < P.joins || Math.hypot(e[0] - way[way.length - 1][0], e[1] - way[way.length - 1][1]) < P.joins)) driven.push(line);
    }
  }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of patches) {
    x0 = Math.min(x0, p.ax, p.bx); x1 = Math.max(x1, p.ax, p.bx);
    z0 = Math.min(z0, p.az, p.bz); z1 = Math.max(z1, p.az, p.bz);
  }
  const bound = { x: 0, z: 0, r: 0 };
  if (patches.length) {
    bound.x = (x0 + x1) / 2;
    bound.z = (z0 + z1) / 2;
    for (const p of patches) bound.r = Math.max(bound.r, Math.max(Math.hypot(p.ax - bound.x, p.az - bound.z), Math.hypot(p.bx - bound.x, p.bz - bound.z)) + p.core + p.soft + WANDER_MOST * P.wanders);
  }
  const places = { patches, bound, driven };
  told.set(world, places);
  return places;
}

/**
 * How far out of true a patch's edge lies at a spot (see SNOW_PLACE.wanders): two long waves and two short ones,
 * no two of them running the same way. The shader's sum, number for number (WANDER is the same sum written for it).
 */
const wander = (x: number, z: number) => SNOW_PLACE.wanders * (Math.sin(x * 0.11 + z * 0.07) + Math.sin(z * 0.13 - x * 0.05 + 1.7) + 0.6 * Math.sin(x * 0.29 - z * 0.21 + 0.6) + 0.6 * Math.sin(z * 0.33 + x * 0.17 + 4.1));
const WANDER = 'sin(p.x * 0.11 + p.y * 0.07) + sin(p.y * 0.13 - p.x * 0.05 + 1.7) + 0.6 * sin(p.x * 0.29 - p.y * 0.21 + 0.6) + 0.6 * sin(p.y * 0.33 + p.x * 0.17 + 4.1)';
/** the most that sum comes to, either way, as a share of `wanders` */
const WANDER_MOST = 3.2;

/**
 * THE RULE BY PLACE: how many metres are added, at a spot, to the height that is compared with the snow line.
 * Nothing anywhere but in a patch. (`snowLift` in SNOW_LIFT is this, sum for sum.)
 */
export function snowLift(world: SnowWorld, x: number, z: number): number {
  const P = snowPlaces(world), qx = x - P.bound.x, qz = z - P.bound.z;
  if (qx * qx + qz * qz >= P.bound.r * P.bound.r) return 0;
  const out = wander(x, z);
  let lift = 0;
  for (const p of P.patches) {
    const pax = x - p.ax, paz = z - p.az, bax = p.bx - p.ax, baz = p.bz - p.az, len2 = bax * bax + baz * baz;
    const h = len2 > 0 ? Math.min(1, Math.max(0, (pax * bax + paz * baz) / len2)) : 0;
    const t = Math.min(1, Math.max(0, (Math.hypot(pax - bax * h, paz - baz * h) + out - p.core) / p.soft));
    lift = Math.max(lift, p.lift * (1 - t * t * (3 - 2 * t)));
  }
  return lift;
}

/**
 * THE RULE: how much snow lies on level ground at a spot of this height, 0 none to 1 all white: by its height, or
 * by its place. (No ragged line: whoever draws one adds its own to the height it hands in.)
 */
export function snowOn(world: SnowWorld, x: number, y: number, z: number): number {
  const t = Math.min(1, Math.max(0, (y + snowLift(world, x, z) - SNOW.from) / (SNOW.full - SNOW.from)));
  return t * t * (3 - 2 * t);
}

/**
 * The lift at every point of the world's net, for whoever reckons the whole ground at once (the kinds of ground,
 * the grass). Nothing if the world has no snowy place: then nothing need be added anywhere.
 */
export function snowNet(world: SnowWorld): Float32Array | null {
  const P = snowPlaces(world);
  if (!P.patches.length) return null;
  const N = WORLD_RES, half = WORLD_SIZE / 2, net = new Float32Array(N * N), { x, z, r } = P.bound;
  const ix0 = Math.max(0, Math.floor((x - r + half) / CELL)), ix1 = Math.min(N - 1, Math.ceil((x + r + half) / CELL));
  const iz0 = Math.max(0, Math.floor((z - r + half) / CELL)), iz1 = Math.min(N - 1, Math.ceil((z + r + half) / CELL));
  for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) net[iz * N + ix] = snowLift(world, -half + ix * CELL, -half + iz * CELL);
  return net;
}

const thinned = new WeakSet<object>();
/**
 * No grass through the snow, where the snow lies by place. The world's own grass is thinned by height when the
 * world is made (as the snow begins it thins, and is gone where the ground is white); this is the same sum with
 * the lift in it, done to the world's grass where there is any lift and nowhere else. Once for a world.
 */
export function snowThinsGrass(world: SnowWorld & Pick<World, 'grass' | 'heights'>): void {
  if (thinned.has(world)) return;
  thinned.add(world);
  const net = snowNet(world);
  if (!net) return;
  for (let i = 0; i < net.length; i++) {
    if (net[i] <= 0 || !world.grass[i]) continue;
    const t = Math.min(1, Math.max(0, (world.heights[i] + net[i] - (SNOW.from - 10)) / 18));
    world.grass[i] = Math.round(world.grass[i] * (1 - t * t * (3 - 2 * t)));
  }
}

/**
 * The picture the ruts are told by: over the ground the driven ways to the fort cross, at each point how far
 * across from the middle of the way it is (to the left less than nothing), which way "across" is there, and how
 * much of a rut there is so far along (nothing at the way's two ends). Four numbers a point, 0 to 255:
 *   across / (2 reach) + a half · the way across, x and z, each halved and a half added · how much.
 * `x`, `z`: the corner of the ground it covers; `wide`, `deep`: that ground's size (metres along x and along z).
 * Nothing if no way is driven.
 */
export function snowRuts(world: SnowWorld): { data: Uint8Array; w: number; h: number; x: number; z: number; wide: number; deep: number } | null {
  const lines = snowPlaces(world).driven;
  if (!lines.length) return null;
  const R = RUTS, pad = R.reach + 1;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const line of lines) for (const [x, z] of line) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
  // (a long way is told more coarsely: the picture is never more than a thousand points a side)
  const texel = Math.max(R.texel, (x1 - x0) / 1024, (z1 - z0) / 1024);
  const w = Math.ceil((x1 - x0) / texel), h = Math.ceil((z1 - z0) / texel), data = new Uint8Array(w * h * 4), best = new Float32Array(w * h).fill(1e9);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 255; data[i * 4 + 1] = data[i * 4 + 2] = 128; }
  for (const line of lines) {
    let whole = 0;
    const runs = line.map((q, k) => (k ? (whole += Math.hypot(q[0] - line[k - 1][0], q[1] - line[k - 1][1])) : 0));
    for (let s = 0; s + 1 < line.length; s++) {
      const [ax, az] = line[s], [bx, bz] = line[s + 1], dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz, len = Math.sqrt(len2);
      if (len < 1e-6) continue;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R.reach - x0) / texel)), i1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + R.reach - x0) / texel));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R.reach - z0) / texel)), j1 = Math.min(h - 1, Math.ceil((Math.max(az, bz) + R.reach - z0) / texel));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * texel, z = z0 + (j + 0.5) * texel, t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t), o = j * w + i;
        if (d >= best[o]) continue;
        best[o] = d;
        const run = runs[s] + len * t, side = (x - ax) * dz - (z - az) * dx > 0 ? 1 : -1;
        // (how much: nothing at the way's two ends; and nothing toward the picture's own edge, where a point that
        // knows the way lies beside one that does not, and what is read between the two is neither)
        const a = Math.min(1, Math.max(0, run / R.ends)), b = Math.min(1, Math.max(0, (whole - run) / R.ends)), c = Math.min(1, Math.max(0, (R.reach - 0.5 - d) / 0.7));
        data[o * 4] = Math.round(Math.min(1, Math.max(0, (side * d) / (2 * R.reach) + 0.5)) * 255);
        data[o * 4 + 1] = Math.round((dz / len) * 127.5 + 127.5);
        data[o * 4 + 2] = Math.round((-dx / len) * 127.5 + 127.5);
        data[o * 4 + 3] = Math.round(a * a * (3 - 2 * a) * b * b * (3 - 2 * b) * c * c * (3 - 2 * c) * 255);
      }
    }
  }
  return { data, w, h, x: x0, z: z0, wide: w * texel, deep: h * texel };
}

/**
 * The patches as the shaders are handed them: one object for every material that has SNOW_LIFT in it (a material
 * is handed them by `Object.assign(shader.uniforms, snowUniforms)`, or by spreading them into its own).
 *   uSnowA      each patch's two ends: x, z, x, z
 *   uSnowB      its core; its core and its soft edge together; the metres it adds; one over the square of its length
 *   uSnowBound  the round that holds them all: x, z, its radius squared; and how many patches there are
 * All nothing until a world is told (`tellSnow`), and for a world with no snowy place.
 */
export const snowUniforms = {
  uSnowA: { value: new Float32Array(SNOW_PATCHES * 4) },
  uSnowB: { value: new Float32Array(SNOW_PATCHES * 4) },
  uSnowBound: { value: new Float32Array(4) },
};

/** A world's snowy places told to the shaders. Whoever builds the world's ground says it, once. */
export function tellSnow(world: SnowWorld): SnowPlaces {
  const P = snowPlaces(world), A = snowUniforms.uSnowA.value, B = snowUniforms.uSnowB.value;
  A.fill(0);
  for (let i = 0; i < SNOW_PATCHES; i++) {
    const p = P.patches[i];
    // (a patch there is none of: its edge is told as a metre wide all the same, so that no sum divides by nothing)
    if (!p) { B.set([0, 1, 0, 0], i * 4); continue; }
    const len2 = (p.bx - p.ax) ** 2 + (p.bz - p.az) ** 2;
    A.set([p.ax, p.az, p.bx, p.bz], i * 4);
    B.set([p.core, p.core + p.soft, p.lift, len2 > 0 ? 1 / len2 : 0], i * 4);
  }
  snowUniforms.uSnowBound.value.set([P.bound.x, P.bound.z, P.bound.r * P.bound.r, P.patches.length]);
  return P;
}

/**
 * The rule by place, for a shader: `snowLift(p)` is the metres added at p (x and z in the world) to the height
 * that is compared with the snow line. Outside the round that holds the patches it is one subtraction and a
 * comparison; inside, a few sums and a smoothstep for each patch.
 */
export const SNOW_LIFT = /* glsl */ `
#define SNOW_PATCHES ${SNOW_PATCHES}
uniform vec4 uSnowA[SNOW_PATCHES];
uniform vec4 uSnowB[SNOW_PATCHES];
uniform vec4 uSnowBound;
float snowLift(vec2 p) {
  vec2 q = p - uSnowBound.xy;
  if (dot(q, q) >= uSnowBound.z) return 0.0;
  float wander = ${SNOW_PLACE.wanders.toFixed(1)} * (${WANDER});
  float lift = 0.0;
  for (int i = 0; i < SNOW_PATCHES; i++) {
    if (float(i) >= uSnowBound.w) break;
    vec4 a = uSnowA[i], b = uSnowB[i];
    vec2 pa = p - a.xy, ba = a.zw - a.xy;
    float d = length(pa - ba * clamp(dot(pa, ba) * b.w, 0.0, 1.0)) + wander;
    lift = max(lift, b.z * (1.0 - smoothstep(b.x, b.y, d)));
  }
  return lift;
}`;
