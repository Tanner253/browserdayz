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
// (`world.castle`) with the ground about it; every way that comes to the fort or joins one that does (`world.paths`:
// the cart track up from the end of the mountain road, a foot path on from the track's end), told as a few straight
// lengths; and the hillside from the fort up to where the mountain's own snow begins (the TONGUE: see SNOW_PLACE).
// Move the fort, or draw its ways another way, and the snow goes with them. A world with no fort has no patch, and
// the rule is height alone.
//
// AND WHAT A PLACE'S SNOW IS LIKE, which the ground's paint draws from one picture made here (`snowPicture`): the
// wheel ruts on a way that is driven and the trodden line on one that is walked; the fort's foot (a dark damp line
// at the stone, a drift in its lee, a scoured strip on the side the wind comes at); and the hollows of the ground,
// where the snow lies first along the place's lower edge.
//
// Who reads it: the ground's paint and its grass (src/world/terrain.ts), the kinds of ground (ground.ts), trees,
// ferns and rocks near and far (foliage.ts, vegetation.ts), the asphalt (road.ts), a blast's dust (the game's
// effects). In TS: `snowLift`. In a shader: SNOW_LIFT, with `snowUniforms` handed to the material. A shader that
// has the snippet and was never handed the uniforms reads no lift at all: the rule by height, as it was.
//
// (Nothing of the generator's is read here until a function is called: the generator may ask this file for the
// rule without the two files waiting on each other.)

import { hash2 } from '../core/noise';
import { castleFoot } from '../sim/castle';
import { CELL, SNOW, WORLD_NX, WORLD_NZ, WORLD_X0, WORLD_Z0, catmullRom, heightAt, type World } from './worldgen';

/**
 * What of a world the snow is told from. `worn`: ground worn bare that is no way of its own (where carts turned,
 * the apron before the fort's ramp, the few paces from a door to the way past it), if the world says any: a spot
 * or a line of spots, worn out to `r` metres from it, by wheels (`driven`) or by feet alone.
 */
export type SnowWorld = Pick<World, 'castle' | 'paths' | 'surface' | 'road' | 'roads'> & { worn?: { line: [number, number][]; r: number; driven: boolean }[] };

/** the most patches there are (the fort, the tongue, and the lengths its ways are told as): a shader looks at each */
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
 *   tongue – THE HILL BEHIND THE FORT. The place's snow lay as an apron on the shelf, with a band of bare brown
 *           hillside over it and the mountain's white caps over that (the judge of how the fort sits in the land,
 *           2026-10-13: "Carry the snow up the hill behind the fort until it joins the mountain's own: one tongue
 *           of winter from the peaks down to the shelf, which is also the reason there is snow here at all"). So
 *           one more length: from the fort's middle to the nearest ground that is white by its own height (looked
 *           for within `seeks` metres), and `into` metres on into it. The band was bare for being steep, not for
 *           being low: the hillside there stands at 45 to 55 degrees, and the rule lays no snow on a cliff. So on
 *           the tongue snow HOLDS on steeper ground than it does anywhere else: `holds` is taken off the upward
 *           part of the normal the rule asks for (0.74 for all of it: with this, a face of 55 degrees is white
 *           and one of 63 is rock). Fading out to its sides as its lift does.
 *   over  – how far over the height at which all the ground is white the lowest ground of a patch is reckoned to
 *           stand: the most a reader's ragged line takes off, and a little
 *   wanders – nor is a patch's edge a ruled line before any of that: it lies so many metres further out here and
 *             nearer in there (three times this at the most), in lobes fifty metres long and lesser ones of seventeen
 *   fits  – a way is told as straight lengths that lie within so many metres of it (or as many as there is room for)
 *   reach – a way is the fort's if it comes within so many metres of the fort's middle, anywhere along it (the
 *           track comes to the gate, or goes round under the walls to it: wherever the fort is turned); or if it
 *           joins a way that is the fort's
 *   joins – two ways join if an end of one lies within so many metres of the other; and a way is driven if one
 *           end of it lies within so many metres of an end of a road
 */
export const SNOW_PLACE = {
  fort: { core: 60, soft: 150 },
  way: { core: 16, soft: 150 },
  tongue: { core: 34, soft: 110, holds: 0.22, seeks: 320, into: 40 },
  over: 14,
  wanders: 5,
  fits: 3,
  reach: 90,
  joins: 12,
};

/**
 * THE LOWER EDGE OF A PLACE'S SNOW (the judge, 2026-10-13: "the season changes in one step: lush standing grass
 * runs to the edge of full snow. Give the lower edge a belt of 30 to 40 m: grass browned and flattened, snow in
 * hollows and on north-facing ground first, thinning to nothing"). Only at a place's own edge: where height alone
 * decides, on the mountain, nothing of this is reckoned and the line is as it was.
 *   hollow – ground that lies under the mean of the ground for twenty metres about it is reckoned so many metres
 *            higher for each `deep` metres it lies under (and a knoll as much lower): snow lies in the low places
 *            first, and the humps stand bare out of it
 *   north  – ground that faces north is reckoned so many metres higher for facing wholly north (no ground does:
 *            a bank of one in three is a third of this), and ground that faces south as much lower
 *   patchy – and so many metres higher or lower (half of it either way) by the paint's own pattern of a few
 *            metres across: on level open ground, where there is neither hollow nor shade, the last of the snow
 *            lies in patches all the same
 *   grass  – the standing grass thins from so many metres under the snow line (as the lifted height has it) and
 *            is gone by so many: sparse, and short for being sparse, through all of the belt
 */
export const BELT = { hollow: 12, deep: 1.2, north: 22, patchy: 14, grass: [36, 2] as [number, number] };

/**
 * THE SNOW AT THE FORT'S FOOT (the judge: "round the fort the snow is one even white to the very stone: no drift
 * on the lee side, no scoured strip on the valley side, no dark damp foot to a wall"). From the ground's side
 * only: the fort's own stone is its builder's. How far a spot is from the foot is the fort's own to say
 * (`castleFoot`, src/sim/castle.ts); which side is the lee is the land's: the wind comes up out of the valley,
 * from the way the ground falls away from the fort (`falls`, worked out from the heights about it).
 *   reach – the picture knows the foot to so far out
 *   half  – and covers so far from the fort's middle each way; `texel`: metres to a point of it
 *   damp  – at the stone the snow is gone and the ground dark and wet: all of that to the first figure, none by
 *           the second (the line is not ruled: the paint's slow pattern takes it in and out)
 *   drift – in the lee the snow is banked against the wall and covers the damp line: all of that to the first
 *           figure from the foot, none by the second
 *   scour – on the side the wind comes at, the ground shows through the snow in streaks drawn out down the wind:
 *           from the first figure, to the second
 */
export const FORT_SNOW = { reach: 12, half: 80, texel: 0.5, damp: [0.3, 1.3] as [number, number], drift: [1.2, 6.5] as [number, number], scour: [1.0, 9.0] as [number, number] };

/**
 * WHAT A WAY IS LIKE UNDER SNOW. A way says what it is: one that wheels come by (it leaves a road's end, or the
 * world says so) has two ruts and a faint trodden line between them; one that is only walked has the trodden line
 * and nothing else. The mountain road had ruts when the fort stood at its top ("the snow tire paths you made");
 * the first made for the track were ruled ribbons (the judge: "one width and one tone for 325 m, pale grey with a
 * dark line down the same edge of each, as on asphalt, though the bed is earth; and no sign that anybody walks
 * there"). So: the bed's own brown-grey shows in them, wet; their edges are ragged by a hand's width; every twenty
 * to forty metres they are drifted over for two to four; on a bend they splay (the wheels do not follow one
 * another round it); and between them is the line feet have trodden. Told by a picture laid over the ways (see
 * `snowPicture`): how far across from its middle a spot is, and what the way is there.
 *   gauge – each rut's middle, metres from the middle of the way (the road's own are at 0.93)
 *   wide  – a rut is all open to so far from its own middle, and closed by so far
 *   splay – on the sharpest bends a rut is so many times wider again, and the pair of them lies so far toward the
 *           inside of the bend; a bend of `bends[0]` metres' radius and less is the sharpest, one of `bends[1]`
 *           and more is no bend
 *   drifts – drifted over for so long [least, most], every so far [least, most] (metres along the way)
 *   trod  – the trodden line: half its width on a driven way, and on a walked one
 *   faint – on a way few come by (the world says which), so much of all of that
 *   worn  – ground worn bare that is no way of its own (`world.worn`: where carts turned, the apron before the
 *           fort's ramp, the paces from a door to the way past it) is trampled snow: pressed and grey, the earth
 *           through it in blots the size of a boot; so much of it gone at the most where feet alone went, and so
 *           much where wheels turned. `texel`: metres to a point of its picture
 *   reach – the picture knows the way's middle to so far either side
 *   texel – metres to a point of the picture
 *   ends  – over so many metres at each end of a way what is on it comes in and goes out (at the road's end the
 *           asphalt's own ruts lead into them)
 */
export const RUTS = {
  gauge: 0.86, wide: [0.09, 0.26] as [number, number], splay: [1.5, 0.22] as [number, number], bends: [8, 40] as [number, number],
  drifts: { long: [2, 4] as [number, number], every: [20, 40] as [number, number] }, trod: [0.14, 0.24] as [number, number], faint: 0.55, reach: 3, texel: 0.25, ends: 4,
  worn: { texel: 0.5, feet: 0.5, wheels: 0.85 },
};

/** a patch: from (ax, az) to (bx, bz), a round if they are one place; the metres it adds; and how much steeper ground holds snow on it */
export interface SnowPatch { ax: number; az: number; bx: number; bz: number; core: number; soft: number; lift: number; holds: number }
/** a way to the fort: the line its bed was laid on, whether wheels come by it, and whether few come by it at all */
export interface SnowWay { line: [number, number][]; driven: boolean; faint: boolean }
export interface SnowPlaces {
  patches: SnowPatch[];
  /** a round that holds every patch to its last metre: outside it nothing is asked */
  bound: { x: number; z: number; r: number };
  /** the ways to the fort, driven and walked */
  ways: SnowWay[];
  /** which way the ground falls away from the fort, a unit [x, z]: the wind comes up from there. Null if it falls no way, or there is no fort. */
  falls: [number, number] | null;
}

/**
 * A way as the world holds it. It says what it is (`Way` in the world's generator: its line, whether wheels come
 * by it, whether few come by it at all), and is believed. A way held as a bare line of [x, z], as every way once
 * was, is told from the roads: driven if it leaves a road's end.
 */
type HeldWay = [number, number][] | { line: [number, number][]; driven?: boolean; faint?: boolean };

/** how far a spot is from a line of points */
function offLine(line: [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (let s = 0; s + 1 < line.length; s++) {
    const [ax, az] = line[s], dx = line[s + 1][0] - ax, dz = line[s + 1][1] - az, len2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

const told = new WeakMap<object, SnowPlaces>();

/** the places of a world where snow lies whatever the height (worked out once for each world, and kept) */
export function snowPlaces(world: SnowWorld): SnowPlaces {
  const had = told.get(world);
  if (had) return had;
  const P = SNOW_PLACE, patches: SnowPatch[] = [], ways: SnowWay[] = [], C = world.castle;
  let falls: [number, number] | null = null;
  // (how many metres a spot of ground at this height is short of being white whatever a ragged line takes off it)
  const short = (y: number) => Math.max(0, SNOW.full + P.over - y);
  const H = (x: number, z: number) => heightAt(world.surface, x, z);
  if (C) {
    if (short(C.y) > 0) patches.push({ ax: C.x, az: C.z, bx: C.x, bz: C.z, core: P.fort.core, soft: P.fort.soft, lift: short(C.y), holds: 0 });
    // Which way the ground falls away from it: every way out from its middle, weighed by how far the ground has
    // fallen 60, 90 and 120 m off (and against, where it has risen).
    {
      let fx = 0, fz = 0;
      for (let a = 0; a < 16; a++) for (const r of [60, 90, 120]) {
        const ux = Math.cos((a * Math.PI) / 8), uz = Math.sin((a * Math.PI) / 8), fell = C.y - H(C.x + ux * r, C.z + uz * r);
        fx += ux * fell;
        fz += uz * fell;
      }
      const l = Math.hypot(fx, fz);
      if (l > 48 * 2) falls = [fx / l, fz / l];
    }
    // THE TONGUE: up the hill behind it to the mountain's own snow (see SNOW_PLACE.tongue). The nearest ground
    // that is white by its own height whatever a ragged line takes off it; none within reach, no tongue.
    if (short(C.y) > 0) {
      const T = P.tongue, N = WORLD_NX;
      let best = T.seeks, tx = 0, tz = 0;
      const ix0 = Math.max(0, Math.floor((C.x - T.seeks - WORLD_X0) / CELL)), ix1 = Math.min(N - 1, Math.ceil((C.x + T.seeks - WORLD_X0) / CELL));
      const iz0 = Math.max(0, Math.floor((C.z - T.seeks - WORLD_Z0) / CELL)), iz1 = Math.min(WORLD_NZ - 1, Math.ceil((C.z + T.seeks - WORLD_Z0) / CELL));
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        if (world.surface[iz * N + ix] < SNOW.full + P.over) continue;
        const d = Math.hypot(WORLD_X0 + ix * CELL - C.x, WORLD_Z0 + iz * CELL - C.z);
        if (d < best) { best = d; tx = WORLD_X0 + ix * CELL; tz = WORLD_Z0 + iz * CELL; }
      }
      if (best < T.seeks && best > 1) {
        const ux = (tx - C.x) / best, uz = (tz - C.z) / best, bx = tx + ux * T.into, bz = tz + uz * T.into;
        let low = C.y;
        for (let d = 0; d <= best + T.into; d += 4) low = Math.min(low, H(C.x + ux * d, C.z + uz * d));
        patches.push({ ax: C.x, az: C.z, bx, bz, core: T.core, soft: T.soft, lift: short(low), holds: T.holds });
      }
    }
    // THE WAYS that come to it, and the ways that join those. Each is the line the world laid its bed on.
    const held = (world.paths as unknown as HeldWay[]).map((w) => (Array.isArray(w) ? { pts: w, said: undefined as boolean | undefined, faint: false } : { pts: w.line, said: w.driven, faint: !!w.faint })).filter((w) => w.pts.length > 1);
    const mine = held.map((w) => w.pts.some((q) => Math.hypot(q[0] - C.x, q[1] - C.z) < P.reach));
    const touch = (a: [number, number][], b: [number, number][]) => [a[0], a[a.length - 1]].some((q) => offLine(b, q[0], q[1]) < P.joins) || [b[0], b[b.length - 1]].some((q) => offLine(a, q[0], q[1]) < P.joins);
    for (let again = true; again; ) {
      again = false;
      held.forEach((w, i) => {
        if (mine[i] || !held.some((v, j) => mine[j] && touch(w.pts, v.pts))) return;
        mine[i] = true;
        again = true;
      });
    }
    const ends: [number, number][] = [];
    for (const r of [world.road, ...world.roads]) {
      const n = r.points.length / 3;
      if (n > 0) ends.push([r.points[0], r.points[2]], [r.points[n * 3 - 3], r.points[n * 3 - 1]]);
    }
    for (let i = 0; i < held.length; i++) {
      if (!mine[i]) continue;
      const w = held[i].pts, a = w[0], b = w[w.length - 1];
      // (driven: the world says so, or it leaves a road's end. A foot path leaves nothing wheels came by.)
      const driven = held[i].said ?? ends.some((e) => Math.hypot(e[0] - a[0], e[1] - a[1]) < P.joins || Math.hypot(e[0] - b[0], e[1] - b[1]) < P.joins);
      ways.push({ line: catmullRom(w, 2), driven, faint: held[i].faint });
    }
    // Each is told as a few straight lengths: the fewest that lie within `fits` of it, and no more than its share
    // of the room there is (by how long it is; every way has one at the least, while there is room at all).
    const room = SNOW_PATCHES - patches.length, longs = ways.map((w) => w.line.reduce((s, q, k) => (k ? s + Math.hypot(q[0] - w.line[k - 1][0], q[1] - w.line[k - 1][1]) : 0), 0));
    const all = longs.reduce((s, v) => s + v, 0) || 1, share = ways.map((_, i) => (i < room ? Math.max(1, Math.floor((room * longs[i]) / all)) : 0));
    for (let spare = room - share.reduce((s, v) => s + v, 0); spare < 0; spare++) share[share.indexOf(Math.max(...share))]--;
    ways.forEach((way, i) => {
      if (!share[i]) return;
      const line = way.line, cut = [0, line.length - 1];
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
        if (at < 0 || cut.length > share[i]) break;
        cut.splice(after + 1, 0, at);
      }
      for (let s = 0; s + 1 < cut.length && patches.length < SNOW_PATCHES; s++) {
        // (by the lowest ground the length crosses: all of it is white)
        let low = Infinity;
        for (let k = cut[s]; k <= cut[s + 1]; k++) low = Math.min(low, H(line[k][0], line[k][1]));
        if (short(low) <= 0) continue;
        patches.push({ ax: line[cut[s]][0], az: line[cut[s]][1], bx: line[cut[s + 1]][0], bz: line[cut[s + 1]][1], core: P.way.core, soft: P.way.soft, lift: short(low), holds: 0 });
      }
    });
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
  const places = { patches, bound, ways, falls };
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
 * THE RULE BY PLACE, both parts of it at a spot: how many metres are added to the height that is compared with the
 * snow line; and how much is taken off the upward part of the normal that snow asks of the ground (the tongue: it
 * holds on steeper ground there). Nothing anywhere but in a patch. (`snowPlace` in SNOW_LIFT is this, sum for sum.)
 */
export function snowPlace(world: SnowWorld, x: number, z: number): [number, number] {
  const P = snowPlaces(world), qx = x - P.bound.x, qz = z - P.bound.z;
  if (qx * qx + qz * qz >= P.bound.r * P.bound.r) return [0, 0];
  const out = wander(x, z);
  let lift = 0, holds = 0;
  for (const p of P.patches) {
    const pax = x - p.ax, paz = z - p.az, bax = p.bx - p.ax, baz = p.bz - p.az, len2 = bax * bax + baz * baz;
    const h = len2 > 0 ? Math.min(1, Math.max(0, (pax * bax + paz * baz) / len2)) : 0;
    const t = Math.min(1, Math.max(0, (Math.hypot(pax - bax * h, paz - baz * h) + out - p.core) / p.soft)), f = 1 - t * t * (3 - 2 * t);
    lift = Math.max(lift, p.lift * f);
    holds = Math.max(holds, p.holds * f);
  }
  return [lift, holds];
}

/** the first part of the rule by place: the metres added at a spot to the height that is compared with the snow line */
export function snowLift(world: SnowWorld, x: number, z: number): number {
  return snowPlace(world, x, z)[0];
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
  const N = WORLD_NX, net = new Float32Array(N * WORLD_NZ), { x, z, r } = P.bound;
  const ix0 = Math.max(0, Math.floor((x - r - WORLD_X0) / CELL)), ix1 = Math.min(N - 1, Math.ceil((x + r - WORLD_X0) / CELL));
  const iz0 = Math.max(0, Math.floor((z - r - WORLD_Z0) / CELL)), iz1 = Math.min(WORLD_NZ - 1, Math.ceil((z + r - WORLD_Z0) / CELL));
  for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) net[iz * N + ix] = snowLift(world, WORLD_X0 + ix * CELL, WORLD_Z0 + iz * CELL);
  return net;
}

const thinned = new WeakSet<object>();
/**
 * No grass through the snow, where the snow lies by place; and sparse grass in the belt under it (see BELT.grass).
 * The world's own grass is thinned by height when the world is made (over the last ten metres under the snow line,
 * and gone where the ground is white). Here the same is done with the lift in it, and from much further under the
 * line: the grass of a place's lower edge stands thin and short for thirty or forty metres before the snow. Only
 * where there is lift, and by how much there is of it: where the lift runs out, so does this. Once for a world.
 */
export function snowThinsGrass(world: SnowWorld & Pick<World, 'grass' | 'heights'>): void {
  if (thinned.has(world)) return;
  thinned.add(world);
  const net = snowNet(world);
  if (!net) return;
  const sm = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < net.length; i++) {
    if (net[i] <= 0 || !world.grass[i]) continue;
    const h = world.heights[i] + net[i];
    // (the world's own thinning is in its grass already, by the height alone: what is done here is that sum with
    // the lift in it over that sum without, so that where the lift runs out nothing is done at all)
    const was = 1 - sm(SNOW.from - 10, SNOW.from + 8, world.heights[i]), is = 1 - sm(SNOW.from - 10, SNOW.from + 8, h);
    // (the belt's thinning: all of it where the lift is a dozen metres and more, none of it where there is no lift)
    const belt = 1 - sm(SNOW.from - BELT.grass[0], SNOW.from - BELT.grass[1], h) * sm(0, 12, net[i]);
    world.grass[i] = Math.round(world.grass[i] * (was > 0 ? is / was : 0) * belt);
  }
}

/**
 * THE PICTURE the ground's paint draws a place's snow from: four pictures in one, each over its own ground.
 *
 *   ways  – over the ways to the fort. At each point: how far across from the middle of the way it is (to the
 *           left less than nothing; on a bend, from where the wheels go, which is to the inside of it), as a share
 *           of twice RUTS.reach with a half added; how much the ruts splay there (a bend); whether the way is
 *           driven (1) or walked (0); and how much of anything there is so far along (nothing at a way's ends,
 *           and nothing where it is drifted over).
 *   fort  – about the fort. How far from its foot (as a share of FORT_SNOW.reach; all of it: further, or nowhere
 *           near); how much in the lee the spot is (1) or in the wind (0); and which way is out from the foot, x
 *           and z, each halved and a half added.
 *   belt  – over all the ground the places lift. How far under the mean of the ground about it a point lies (a
 *           hollow: more than a half) or over it (a knoll: less), `BELT.deep` metres being all of it either way.
 *   worn  – over the ground the world says is worn bare and is no way (`world.worn`), where a place's snow lies.
 *           How trampled a point is; and whether by wheels (1) or by feet alone (0).
 *
 * `box`: for each, the corner of the ground it covers and one over that ground's size, x and z; `at`: where in the
 * whole picture its own begins and how much of the whole it is, across and down (so a spot of the world is at
 * `at.xy + (spot - box.xy) * box.zw * at.zw`). A picture there is none of has a box of nothings. `wind`: the way
 * the wind blows at the fort (a unit x, z; nothing if the land falls no way from it).
 * Null in a world with no snowy place. Made once for a world, and kept.
 */
export interface SnowPicture { data: Uint8Array; w: number; h: number; box: Float32Array; at: Float32Array; wind: [number, number] }
const pictured = new WeakMap<object, SnowPicture>();
export function snowPicture(world: SnowWorld): SnowPicture | null {
  const had = pictured.get(world);
  if (had) return had;
  const made = makePicture(world);
  if (made) pictured.set(world, made);
  return made;
}
function makePicture(world: SnowWorld): SnowPicture | null {
  const P = snowPlaces(world), C = world.castle;
  if (!P.patches.length) return null;
  type Part = { w: number; h: number; data: Uint8Array; x: number; z: number; wide: number; deep: number } | null;
  const sm = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const wind: [number, number] = P.falls ? [-P.falls[0], -P.falls[1]] : [0, 0];

  // --- the ways
  let waysPart: Part = null;
  if (P.ways.length) {
    const R = RUTS, pad = R.reach + 1;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const way of P.ways) for (const [x, z] of way.line) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
    // (a long way is told more coarsely: the picture is never more than a thousand points a side)
    const texel = Math.max(R.texel, (x1 - x0) / 1024, (z1 - z0) / 1024);
    const w = Math.ceil((x1 - x0) / texel), h = Math.ceil((z1 - z0) / texel), data = new Uint8Array(w * h * 4), best = new Float32Array(w * h).fill(1e9);
    for (let i = 0; i < w * h; i++) data[i * 4] = 255;
    P.ways.forEach((way, n) => {
      const line = way.line;
      let whole = 0;
      const runs = line.map((q, k) => (k ? (whole += Math.hypot(q[0] - line[k - 1][0], q[1] - line[k - 1][1])) : 0));
      // How sharp the bend is at each point of the line, and to which side it turns: by the way it heads six metres
      // back against six metres on (the line's points are two metres apart), evened over a few points.
      const turn = line.map((q, k) => {
        const a = line[Math.max(0, k - 3)], b = line[Math.min(line.length - 1, k + 3)], ux = q[0] - a[0], uz = q[1] - a[1], vx = b[0] - q[0], vz = b[1] - q[1];
        const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
        if (lu < 1 || lv < 1) return 0;
        // (the angle turned through over half the way from a to b is one over the bend's radius; to the left more than nothing)
        return Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz) / ((lu + lv) / 2);
      });
      const bend = turn.map((_, k) => (turn[Math.max(0, k - 1)] + 2 * turn[k] + turn[Math.min(turn.length - 1, k + 1)]) / 4);
      // Where it is drifted over: so long, every so far, by numbers of the way's own that are the same every time.
      const drifts: [number, number][] = [];
      for (let at = hash2(n, 3, 811) * R.drifts.every[0] + 8, k = 0; at < whole - 6; k++) {
        drifts.push([at, (R.drifts.long[0] + (R.drifts.long[1] - R.drifts.long[0]) * hash2(n, k, 823)) / 2]);
        at += R.drifts.every[0] + (R.drifts.every[1] - R.drifts.every[0]) * hash2(n, k, 829);
      }
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
          // (which side of the way a spot is on: one side more than nothing, the other less)
          const run = runs[s] + len * t, side = (x - ax) * dz - (z - az) * dx > 0 ? 1 : -1, k = bend[s] + (bend[s + 1] - bend[s]) * t;
          const splay = sm(1 / R.bends[1], 1 / R.bends[0], Math.abs(k));
          // (the wheels cut the inside of a bend: the side the way turns toward, which is the side reckoned as
          // less than nothing when it turns the way `turn` counts as more)
          const across = side * d - (k > 0 ? -1 : 1) * R.splay[1] * splay;
          // (how much: nothing at the way's two ends; nothing where it is drifted over; and nothing toward the
          // picture's own edge, where a point that knows the way lies beside one that does not, and what is read
          // between the two is neither)
          let much = sm(0, R.ends, run) * sm(0, R.ends, whole - run) * sm(0, 0.7, R.reach - 0.5 - d) * (way.faint ? R.faint : 1);
          for (const [at, half] of drifts) much *= sm(half, half + 0.9, Math.abs(run - at));
          data[o * 4] = Math.round(Math.min(1, Math.max(0, across / (2 * R.reach) + 0.5)) * 255);
          data[o * 4 + 1] = Math.round(splay * 255);
          data[o * 4 + 2] = way.driven ? 255 : 0;
          data[o * 4 + 3] = Math.round(much * 255);
        }
      }
    });
    waysPart = { w, h, data, x: x0, z: z0, wide: w * texel, deep: h * texel };
  }

  // --- the fort's foot
  let fortPart: Part = null;
  if (C) {
    const F = FORT_SNOW, n = Math.round((2 * F.half) / F.texel), data = new Uint8Array(n * n * 4), x0 = C.x - F.half, z0 = C.z - F.half, e = 0.5;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = x0 + (i + 0.5) * F.texel, z = z0 + (j + 0.5) * F.texel, o = (j * n + i) * 4, foot = castleFoot(C, x, z);
      data[o] = 255; data[o + 1] = 128; data[o + 2] = data[o + 3] = 128;
      if (foot >= F.reach) continue;
      // (which way is out from the foot: the way the distance from it grows)
      const gx = castleFoot(C, x + e, z) - castleFoot(C, x - e, z), gz = castleFoot(C, x, z + e) - castleFoot(C, x, z - e), gl = Math.hypot(gx, gz) || 1;
      // (in the lee: out from the foot is down the wind; in the wind: out from it is up the wind. A wall the wind runs along is neither.)
      const lee = P.falls ? sm(-0.35, 0.45, (gx / gl) * wind[0] + (gz / gl) * wind[1]) : 0.5;
      data[o] = Math.round((Math.max(0, foot) / F.reach) * 254);
      data[o + 1] = Math.round(lee * 255);
      data[o + 2] = Math.round((gx / gl) * 127.5 + 127.5);
      data[o + 3] = Math.round((gz / gl) * 127.5 + 127.5);
    }
    fortPart = { w: n, h: n, data, x: x0, z: z0, wide: n * F.texel, deep: n * F.texel };
  }

  // --- the hollows of the lifted ground: against the mean of the ground for twenty metres about each point
  let beltPart: Part = null;
  {
    const N = WORLD_NX, NZ = WORLD_NZ, m = 12, { x, z, r } = P.bound;
    const ix0 = Math.max(0, Math.floor((x - r - WORLD_X0) / CELL)), ix1 = Math.min(N - 1, Math.ceil((x + r - WORLD_X0) / CELL));
    const iz0 = Math.max(0, Math.floor((z - r - WORLD_Z0) / CELL)), iz1 = Math.min(NZ - 1, Math.ceil((z + r - WORLD_Z0) / CELL));
    const w = ix1 - ix0 + 1, h = iz1 - iz0 + 1, W = w + 2 * m, Hh = h + 2 * m;
    // (the ground there and a margin about it, the edge of the world held on beyond it)
    let cur = new Float32Array(W * Hh);
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) cur[j * W + i] = world.surface[Math.min(NZ - 1, Math.max(0, iz0 - m + j)) * N + Math.min(N - 1, Math.max(0, ix0 - m + i))];
    const ground = cur;
    // (evened over six points either way, along the rows and down them, twice: a soft round mean)
    for (let pass = 0; pass < 4; pass++) {
      const next = new Float32Array(W * Hh), step = pass % 2 === 0 ? 1 : W, rows = pass % 2 === 0 ? Hh : W, len = pass % 2 === 0 ? W : Hh, row = pass % 2 === 0 ? W : 1;
      for (let a = 0; a < rows; a++) {
        const o = a * row;
        let sum = 0, count = 0;
        for (let b = 0; b <= Math.min(6, len - 1); b++) { sum += cur[o + b * step]; count++; }
        for (let b = 0; b < len; b++) {
          next[o + b * step] = sum / count;
          const out = b - 6, come = b + 7;
          if (out >= 0) { sum -= cur[o + out * step]; count--; }
          if (come < len) { sum += cur[o + come * step]; count++; }
        }
      }
      cur = next;
    }
    const data = new Uint8Array(w * h * 4);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const o = (j + m) * W + i + m, hollow = Math.min(1, Math.max(-1, (cur[o] - ground[o]) / BELT.deep));
      data[(j * w + i) * 4] = Math.round(hollow * 127 + 128);
    }
    // (a point of the picture is a point of the net: its ground begins half a square before the first of them)
    beltPart = { w, h, data, x: WORLD_X0 + (ix0 - 0.5) * CELL, z: WORLD_Z0 + (iz0 - 0.5) * CELL, wide: w * CELL, deep: h * CELL };
  }

  // --- ground worn bare that is no way of its own, where the place's snow lies: how trampled each point is (all
  // of it for the nearer half of the way out from the spot or the line, none at its edge), and whether by wheels
  let wornPart: Part = null;
  const worn = (world.worn ?? []).filter((n) => n.line.length > 0 && n.r > 0 && n.line.some((q) => snowLift(world, q[0], q[1]) > 0));
  if (worn.length) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const n of worn) for (const [x, z] of n.line) {
      x0 = Math.min(x0, x - n.r - 1.5); x1 = Math.max(x1, x + n.r + 1.5);
      z0 = Math.min(z0, z - n.r - 1.5); z1 = Math.max(z1, z + n.r + 1.5);
    }
    const texel = Math.max(RUTS.worn.texel, (x1 - x0) / 512, (z1 - z0) / 512), w = Math.ceil((x1 - x0) / texel), h = Math.ceil((z1 - z0) / texel), data = new Uint8Array(w * h * 4);
    for (const n of worn) {
      // (a spot is a line of one point twice over)
      const line = n.line.length > 1 ? n.line : [n.line[0], n.line[0]];
      let ax = Infinity, bx = -Infinity, az = Infinity, bz = -Infinity;
      for (const [x, z] of line) { ax = Math.min(ax, x); bx = Math.max(bx, x); az = Math.min(az, z); bz = Math.max(bz, z); }
      const i0 = Math.max(0, Math.floor((ax - n.r - x0) / texel)), i1 = Math.min(w - 1, Math.ceil((bx + n.r - x0) / texel)), j0 = Math.max(0, Math.floor((az - n.r - z0) / texel)), j1 = Math.min(h - 1, Math.ceil((bz + n.r - z0) / texel));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const much = Math.round((1 - sm(0.5 * n.r, n.r, offLine(line, x0 + (i + 0.5) * texel, z0 + (j + 0.5) * texel))) * 255), o = (j * w + i) * 4;
        if (much <= data[o]) continue;
        data[o] = much;
        data[o + 1] = n.driven ? 255 : 0;
      }
    }
    wornPart = { w, h, data, x: x0, z: z0, wide: w * texel, deep: h * texel };
  }

  // --- the four laid in one picture: the ways down the left of it; the fort, the belt and the worn ground down
  // the right; two points of nothing between any two (what is read between two points of one must not be half
  // the other)
  const parts = [waysPart, fortPart, beltPart, wornPart], gap = 2, lw = waysPart ? waysPart.w + gap : 0;
  const where: [number, number][] = [[0, 0]];
  let down = 0, rw = 0;
  for (const p of parts.slice(1)) {
    where.push([lw, down]);
    if (!p) continue;
    down += p.h + gap;
    rw = Math.max(rw, p.w);
  }
  const w = Math.max(lw + rw, 1), h = Math.max(waysPart?.h ?? 0, down - gap, 1);
  const data = new Uint8Array(w * h * 4), box = new Float32Array(16), at = new Float32Array(16);
  // (where no part is: a way's "far across", no splay, nothing of anything)
  for (let i = 0; i < w * h; i++) data[i * 4] = 255;
  parts.forEach((p, k) => {
    if (!p) return;
    const [px, py] = where[k];
    for (let j = 0; j < p.h; j++) data.set(p.data.subarray(j * p.w * 4, (j + 1) * p.w * 4), ((py + j) * w + px) * 4);
    box.set([p.x, p.z, 1 / p.wide, 1 / p.deep], k * 4);
    at.set([px / w, py / h, p.w / w, p.h / h], k * 4);
  });
  return { data, w, h, box, at, wind };
}

/**
 * The patches as the shaders are handed them: one object for every material that has SNOW_LIFT in it (a material
 * is handed them by `Object.assign(shader.uniforms, snowUniforms)`, or by spreading them into its own).
 *   uSnowA      each patch's two ends: x, z, x, z
 *   uSnowB      its core; its core and its soft edge together; the metres it adds; how much steeper ground holds snow on it
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
    A.set([p.ax, p.az, p.bx, p.bz], i * 4);
    B.set([p.core, p.core + p.soft, p.lift, p.holds], i * 4);
  }
  snowUniforms.uSnowBound.value.set([P.bound.x, P.bound.z, P.bound.r * P.bound.r, P.patches.length]);
  return P;
}

/**
 * The rule by place, for a shader. `snowPlace(p)` is both parts of it at p (x and z in the world): the metres
 * added to the height that is compared with the snow line, and how much is taken off the upward part of the normal
 * snow asks of the ground. `snowLift(p)` is the first alone. Outside the round that holds the patches it is one
 * subtraction and a comparison; inside, a few sums and a smoothstep for each patch.
 */
export const SNOW_LIFT = /* glsl */ `
#define SNOW_PATCHES ${SNOW_PATCHES}
uniform vec4 uSnowA[SNOW_PATCHES];
uniform vec4 uSnowB[SNOW_PATCHES];
uniform vec4 uSnowBound;
vec2 snowPlace(vec2 p) {
  vec2 q = p - uSnowBound.xy;
  if (dot(q, q) >= uSnowBound.z) return vec2(0.0);
  float wander = ${SNOW_PLACE.wanders.toFixed(1)} * (${WANDER});
  vec2 place = vec2(0.0);
  for (int i = 0; i < SNOW_PATCHES; i++) {
    if (float(i) >= uSnowBound.w) break;
    vec4 a = uSnowA[i], b = uSnowB[i];
    vec2 pa = p - a.xy, ba = a.zw - a.xy;
    float d = length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0)) + wander;
    place = max(place, b.zw * (1.0 - smoothstep(b.x, b.y, d)));
  }
  return place;
}
float snowLift(vec2 p) { return snowPlace(p).x; }`;
