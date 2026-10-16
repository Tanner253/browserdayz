// THE WORLD GROWN WEST (2026-10-16): the rectangle, and plan v2 on it.   npx tsx test/west.test.ts
// The owner: "from west to east itll be ocean, beach, desert, plains, mountains"; "open up the werst side of the map
// and rid the mountains if you must for good transition but leave the east vibes kamenka doesnt need to be touched".
// The east half of today's map is held to prints taken off the tree before the world grew (but for the hillside the
// bunker left, and the trading post's buildings, which went west): every field of the ground's net, and everything
// that stands on it. Then the west: the valley opened onto it, no crease at the seam, the green land, the sea, the
// paint, the woods, the roads and their grades, the bunker and the trader where they went, the plots level and
// clear, the canyon's walls, the Zona out to the barrier, the new starts; and the ground bodies stand on (Rapier's
// heightfield of the whole world) where `heightAt` says it is.
// (WEST_PRINT=1 prints the east half's prints instead of holding it to them: run so in a tree from before
// 2026-10-16, with a copy of this file, to take them again.)

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';
import * as WG from '../src/world/worldgen';
import { BUNKER } from '../src/sim/bunker';
import { generateWorld, heightAt, slopeAt, type World } from '../src/world/worldgen';

const SQ = 769, HALF = 768, CELL = 2;
const W = WG as unknown as Record<string, number> & typeof WG;
const NX = W.WORLD_NX ?? SQ, OX = W.WORLD_X0 === undefined ? 0 : (-HALF - W.WORLD_X0) / CELL, OZ = W.WORLD_Z0 === undefined ? 0 : (-HALF - W.WORLD_Z0) / CELL;
const WAS_B = ((WG as unknown as { BUNKER_WAS?: { x: number; z: number } }).BUNKER_WAS ?? WG.BUNKER_AT) as { x: number; z: number };
const WAS_T = { x: 200, z: -40 }, KEEP = 200;
/** the east half of the square (x 0 to 768), but the ground the bunker left: in the square's own order */
const east = (p: { x: number; z: number }) => p.x > 0 && p.x <= HALF && Math.abs(p.z) <= HALF && Math.hypot(p.x - WAS_B.x, p.z - WAS_B.z) > KEEP;
function half<T extends Float32Array | Uint8Array>(a: T, per = 1): T {
  const out = new (a.constructor as new (n: number) => T)((SQ - 384) * SQ * per);
  for (let iz = 0; iz < SQ; iz++) for (let ix = 385; ix < SQ; ix++) {
    if (!east({ x: -HALF + ix * CELL, z: -HALF + iz * CELL })) continue;
    for (let c = 0; c < per; c++) out[(iz * (SQ - 384) + ix - 384) * per + c] = a[((iz + OZ) * NX + ix + OX) * per + c];
  }
  return out;
}
const print = (v: ArrayBufferView | unknown) => {
  const h = createHash('sha256');
  if (ArrayBuffer.isView(v)) h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  else h.update(JSON.stringify(v));
  return h.digest('hex').slice(0, 16);
};
const roadsEast = (w: World) => [w.road, ...w.roads].map((r) => { const o: number[] = []; for (let i = 0; i < r.points.length; i += 3) if (r.points[i] > 0) o.push(r.points[i], r.points[i + 1], r.points[i + 2]); return o; }).filter((o) => o.length);

const t0 = performance.now();
const world: World = generateWorld();
const made = performance.now() - t0;
const prints = {
  heights: print(half(world.heights)),
  surface: print(half(world.surface)),
  splat: print(half(world.splat, 4)),
  grass: print(half(world.grass)),
  trees: print(world.trees.filter(east)),
  rocks: print(world.rocks.filter(east)),
  props: print(world.props.filter(east)),
  buildings: print(world.buildings.filter((b) => east(b) && Math.hypot(b.x - WAS_T.x, b.z - WAS_T.z) > 80)),
  spawns: print([world.spawns.filter(east), world.spawnRing]),
  roads: print(roadsEast(world)),
  rest: print([world.bridges, world.paths, world.worn, world.wreck, world.walls, world.gatehouse, world.castle, world.pois.filter((p) => east(p) && p.name !== BUNKER.name && p.name !== 'Trading Post'), world.sites.filter((p) => east(p) && p.kind !== 'bunker' && p.kind !== 'market'), world.solids]),
};
if (process.env.WEST_PRINT) {
  console.log(JSON.stringify(prints, null, 1));
  process.exit(0);
}
let checks = 0;
const ok = (what: string) => { checks++; console.log(`  ok  ${what}`); };

// --- the east half of today's map as it was (prints taken 2026-10-16 off f1d0ca0, the last tree with the square alone)
const WAS = {
  heights: '4fd34df70b1161bf', surface: '6465e5e0e9449e2b', splat: '5bfdf1b818379f3a', grass: '88229d83ee6f64b8', trees: 'ef7e372692c689f1', rocks: '8e6656ab18f30a00',
  props: 'a5d0512c8234be5a', buildings: '3f0394645ba713f3', spawns: 'a4dd04bfc4d1ef94', roads: 'a502efb5b853d34f', rest: 'c507af5c93c3db81',
};
for (const [k, v] of Object.entries(WAS)) assert.equal(prints[k as keyof typeof prints], v, `the east's ${k} are not what they were`);
ok(`the east of today's map as it was, to the byte (but within ${KEEP} m of where the bunker was): its ground, paint and grass, ${world.trees.filter(east).length} trees, ${world.rocks.filter(east).length} rocks, ${world.props.filter(east).length} props, ${world.buildings.filter(east).length} buildings, the roads, the fort, Kamenka (made in ${made.toFixed(0)} ms)`);

// --- the world's measures
const { WORLD_X0: X0, WORLD_X1: X1, WORLD_Z0: Z0, WORLD_Z1: Z1, WORLD_NZ: NZ, SEA_LEVEL: SEA, PLAN } = WG;
assert.equal(world.heights.length, NX * NZ);
assert.equal(world.splat.length, NX * NZ * 4);
assert.equal(world.grass.length, NX * NZ);
assert.ok(world.surface.length === NX * NZ, 'the surface is on the world\'s net');
assert.deepEqual([X0, X1, Z0, Z1, NX, NZ], [-3840, 768, -768, 768, 2305, 769]);
for (const t of [...world.trees, ...world.rocks, ...world.props, ...world.buildings]) assert.ok(WG.onWorld(t.x, t.z), `something stands off the world at ${t.x}, ${t.z}`);
ok('the world is 4608 m by 1536 m, x -3840 to 768 and z -768 to 768, on one net of 2305 by 769 samples');

const H = world.heights, at = (ix: number, iz: number) => H[iz * NX + ix];

// --- the west of today's map opened: no wall of hills between the valley and the green land along the main road
{
  let top = -Infinity;
  // (between the valley's own rim and the seam, about the main road and the pass: the rim's hills north of it and the
  // works' hill south of it are kept)
  for (let x = -760; x <= -470; x += 4) for (let z = -280; z <= 60; z += 4) top = Math.max(top, heightAt(H, x, z));
  assert.ok(top < 45, `the old rim still stands ${top.toFixed(0)} m high west of the valley`);
  const main = world.roads.reduce((a, b) => (b.points.length > a.points.length ? b : a)).points;
  let hi = -Infinity;
  for (let i = 0; i < main.length; i += 3) hi = Math.max(hi, main[i + 1]);
  assert.ok(hi < 40, `the main road climbs to ${hi.toFixed(0)} m`);
  const loop = world.roads.find((r) => r.points.length / 3 === 453)!.points;
  let lg = 0;
  for (let i = 3; i < loop.length; i += 3) if (loop[i] < -380) lg = Math.max(lg, Math.abs(loop[i + 1] - loop[i - 2]) / Math.hypot(loop[i] - loop[i - 3], loop[i + 2] - loop[i - 1]));
  assert.ok(lg <= 0.13, `the loop is ${lg.toFixed(3)} steep where it was laid again`);
  ok(`today's west opened: west of the valley along the main road nothing stands over ${top.toFixed(0)} m (the rim was 75-160), the main road never over ${hi.toFixed(0)} m, the loop laid again no steeper than ${(lg * 100).toFixed(1)}%`);
}

// --- the seam: the square's last column and the first of the new ground
{
  let crease = 0, inner = 0;
  for (let iz = 0; iz < NZ; iz++) {
    const a = at(OX - 2, iz), b = at(OX - 1, iz), c = at(OX, iz), d = at(OX + 1, iz), e = at(OX + 2, iz);
    crease = Math.max(crease, Math.abs(b - 2 * c + d));
    inner = Math.max(inner, Math.abs(c - 2 * d + e), Math.abs(a - 2 * b + c));
  }
  assert.ok(crease <= Math.max(0.6, inner * 1.25), `a crease at the seam: ${crease.toFixed(2)} m against ${inner.toFixed(2)} either side of it`);
  ok(`no crease at the seam: its bend ${crease.toFixed(2)} m where the ground either side bends ${inner.toFixed(2)}`);
}

// --- the green land, the sea
{
  const C = PLAN.canyon;
  const slopes: number[] = [];
  let lo = Infinity, hi = -Infinity;
  // (over the opened band, where the land is the green land; north and south of it the square's rims are kept, falling away)
  for (let x = -2600; x <= -1000; x += 8) for (let z = -440; z <= 380; z += 8) {
    if (WG.nearLine(C.line, x, z).d < 220) continue;
    const h = heightAt(H, x, z);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
    slopes.push(slopeAt(H, x, z));
  }
  slopes.sort((a, b) => a - b);
  const most = slopes[Math.floor(slopes.length * 0.98)];
  assert.ok(lo >= SEA + 5 && hi <= SEA + 90, `the green land runs ${(lo - SEA).toFixed(1)} to ${(hi - SEA).toFixed(1)} m over the sea`);
  // (the square's valley, measured so 2026-10-16: 2% of it steeper than 0.69: the green land is to be no rougher)
  assert.ok(most < 0.5, `the green land is not gentle: 2% of it steeper than ${most.toFixed(2)}`);
  ok(`green rolling land: ${(lo - SEA).toFixed(0)} to ${(hi - SEA).toFixed(0)} m over the sea, 98% of it under ${(Math.atan(most) * 57.3).toFixed(0)} degrees`);
  let shoreW = Infinity, shoreE = -Infinity, shallowest = -Infinity, beachSteep = 0, wet = 0;
  for (let iz = 0; iz < NZ; iz++) {
    let last = X0;
    for (let ix = 0; ix < OX; ix++) if (at(ix, iz) < SEA) last = X0 + ix * CELL;
    shoreW = Math.min(shoreW, last);
    shoreE = Math.max(shoreE, last);
    for (let ix = (last - X0) / CELL + 1; ix < OX; ix++) if (at(ix, iz) < SEA) wet++;
    shallowest = Math.max(shallowest, at(0, iz));
    for (let x = last - 30; x <= last + 50; x += 4) beachSteep = Math.max(beachSteep, slopeAt(H, x, Z0 + iz * CELL));
  }
  assert.ok(shoreW >= -3640 && shoreE <= -3540 && shallowest < SEA - 6 && beachSteep < 0.1 && wet === 0, `the shore from ${shoreW} to ${shoreE}, ${(SEA - shallowest).toFixed(1)} m deep at the edge, the beach ${beachSteep.toFixed(2)} steep, ${wet} spots under the sea inland`);
  ok(`a thin sea in the west: the shore between x ${shoreW} and ${shoreE} (${shoreW - X0} to ${shoreE - X0} m of water), the beach never steeper than ${(Math.atan(beachSteep) * 57.3).toFixed(1)} degrees, nothing under the sea inland; the barrier at x ${PLAN.barrier}`);
}

// --- the paint: green, drying west through steppe into the desert; the beach bare
{
  const B = PLAN.bands, s = world.splat;
  const share = (x0: number, x1: number) => {
    let n = 0, bare = 0, grass = 0, blades = 0;
    for (let iz = 0; iz < NZ; iz += 2) for (let ix = Math.max(0, Math.round((x0 - X0) / CELL)); ix < (x1 - X0) / CELL; ix += 2) {
      const i = iz * NX + ix;
      if (s[i * 4 + 2] > 100) continue;
      n++;
      bare += s[i * 4 + 3] / 255;
      grass += s[i * 4] / 255;
      if (world.grass[i] > 0) blades++;
    }
    return { bare: bare / n, grass: grass / n, blades: blades / n };
  };
  const green = share(B.green + 100, -1300), steppe = share(B.sand + 20, B.steppe - 20), desert = share(B.beach + 20, B.sand - 120);
  assert.ok(green.bare < 0.08 && green.blades > 0.85, `the green land is ${(green.bare * 100).toFixed(0)}% bare, grass grows on ${(green.blades * 100).toFixed(0)}%`);
  assert.ok(steppe.bare > 0.3 && steppe.bare < 0.85 && steppe.grass > 0.15, `the steppe is ${(steppe.bare * 100).toFixed(0)}% bare, ${(steppe.grass * 100).toFixed(0)}% grass`);
  assert.ok(desert.bare > 0.95, `the desert is only ${(desert.bare * 100).toFixed(0)}% bare`);
  let worst = 0;
  for (let i = 0; i < NX * NZ; i++) worst = Math.max(worst, Math.abs(s[i * 4] + s[i * 4 + 1] + s[i * 4 + 2] + s[i * 4 + 3] - 255));
  assert.ok(worst <= 2, `the paint does not add up: ${worst} of 255 out`);
  ok(`painted west to east: the desert ${(desert.bare * 100).toFixed(0)}% bare sand, the steppe ${(steppe.bare * 100).toFixed(0)}% bare to ${(steppe.grass * 100).toFixed(0)}% dry grass, the green land ${(green.bare * 100).toFixed(0)}% bare with grass growing on ${(green.blades * 100).toFixed(0)}%; the paint whole everywhere`);
}

// --- the woods, the meadows, the plots, the roads: what stands where
{
  const inB = (b: { x0: number; x1: number; z0: number; z1: number }, t: { x: number; z: number }, m = 0) => t.x > b.x0 + m && t.x < b.x1 - m && t.z > b.z0 + m && t.z < b.z1 - m;
  const pines = world.trees.filter((t) => inB(PLAN.pines, t, 80)), birches = world.trees.filter((t) => inB(PLAN.birches, t, 80)), meadow = world.trees.filter((t) => inB(PLAN.meadows, t, 40));
  assert.ok(pines.length > 1500 && pines.filter((t) => t.kind.startsWith('pine')).length / pines.length > 0.85, `the pine forest: ${pines.length} trees`);
  assert.ok(birches.length > 800 && birches.filter((t) => t.kind.startsWith('birch') || t.kind.startsWith('bush')).length / birches.length > 0.9, `the birch woods: ${birches.length} trees`);
  assert.ok(meadow.length < 5, `${meadow.length} trees in the flower meadows`);
  for (const p of PLAN.plots) {
    const on = [...world.trees, ...world.rocks, ...world.props].filter((t) => Math.abs(t.x - p.x) < p.w / 2 && Math.abs(t.z - p.z) < p.d / 2);
    assert.equal(on.length, 0, `${on.length} things on the ${p.name}'s plot`);
    let lo = Infinity, hi = -Infinity;
    for (let x = p.x - p.w / 2 + 12; x <= p.x + p.w / 2 - 12; x += 4) for (let z = p.z - p.d / 2 + 12; z <= p.z + p.d / 2 - 12; z += 4) { const h = heightAt(H, x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    assert.ok(hi - lo < 0.8, `the ${p.name}'s plot is ${(hi - lo).toFixed(2)} m out of level`);
  }
  const M = PLAN.monastery;
  assert.equal([...world.trees, ...world.rocks, ...world.props].filter((t) => WG.inside(M.wall, t.x, t.z) || WG.nearLine([...M.wall, M.wall[0]], t.x, t.z).d < M.clear).length, 0, 'something stands in or by the monastery\'s wall');
  ok(`the pine forest ${pines.length} trees, the birch woods ${birches.length}, the meadows ${meadow.length}; the plots (${PLAN.plots.map((p) => p.name).join(', ')}) level within 0.8 m and bare, the monastery's wall clear by ${M.clear} m`);
  const fresh = world.roads.slice(-4);
  for (const r of fresh) {
    const p = r.points;
    let steep = 0;
    for (let i = 3; i < p.length; i += 3) steep = Math.max(steep, Math.abs(p[i + 1] - p[i - 2]) / Math.hypot(p[i] - p[i - 3], p[i + 2] - p[i - 1]));
    assert.ok(steep <= PLAN.road.steep + 1e-3, `a new road ${steep.toFixed(3)} steep`);
    for (let i = 0; i < p.length; i += 3 * 5) assert.ok(Math.abs(heightAt(H, p[i], p[i + 2]) - p[i + 1]) < 0.35, `a new road ${Math.abs(heightAt(H, p[i], p[i + 2]) - p[i + 1]).toFixed(2)} m off its bed at ${p[i].toFixed(0)}, ${p[i + 2].toFixed(0)}`);
    for (const t of world.trees) {
      if (t.x > -400) continue;
      for (let i = 0; i < p.length; i += 3) if (Math.abs(t.x - p[i]) < 6 && Math.abs(t.z - p[i + 2]) < 6 && Math.hypot(t.x - p[i], t.z - p[i + 2]) < r.width / 2 + 1) assert.fail(`a tree on a road at ${t.x.toFixed(0)}, ${t.z.toFixed(0)}`);
    }
  }
  const [main, toBunker] = fresh;
  const near = (p: Float32Array, x: number, z: number) => { let d = Infinity; for (let i = 0; i < p.length; i += 3) d = Math.min(d, Math.hypot(p[i] - x, p[i + 2] - z)); return d; };
  assert.ok(near(main.points, -3513, 25) < 2 && near(toBunker.points, M.gates.south[0], M.gates.south[1]) < 4 && near(toBunker.points, M.gates.north[0], M.gates.north[1]) < 4, 'the roads miss their ends or the gates');
  ok(`four new roads (the main one ${((main.points.length / 3) * 4 / 1000).toFixed(1)} km to the beach, the way through the monastery's gates to the bunker, to the hamlet, to the canyon): none steeper than ${PLAN.road.steep * 100}%, each on its bed, no tree on any`);
}

// --- the bunker and the trading post where they went
{
  const b = WG.bunkerPlace(world)!;
  assert.ok(Math.hypot(b.x - WG.BUNKER_AT.x, b.z - WG.BUNKER_AT.z) < 0.01, 'the bunker is not where it went');
  assert.ok(world.sites.filter((s) => s.kind === 'bunker').length === 1 && world.pois.find((p) => p.name === BUNKER.name)!.x === WG.BUNKER_AT.x, 'the bunker\'s place and name are not with it');
  assert.ok(Math.hypot(b.x - world.castle!.x, b.z - world.castle!.z) > 2000, 'the bunker is near the fort');
  // (its pit dug under its roof, and the roof level with the ground about it)
  const pitH = heightAt(world.heights, b.x, b.z), roofH = heightAt(world.surface, b.x, b.z);
  assert.ok(roofH - pitH > BUNKER.depth - 0.5, `the bunker's pit is ${(roofH - pitH).toFixed(1)} m under its roof`);
  // (and the hillside it left as it was before it was cut: the ground, its trees, and no hole)
  const wasPit = heightAt(world.heights, WAS_B.x, WAS_B.z), wasRoof = heightAt(world.surface, WAS_B.x, WAS_B.z);
  assert.ok(Math.abs(wasRoof - wasPit) < 0.01 && world.trees.filter((t) => Math.hypot(t.x - WAS_B.x, t.z - WAS_B.z) < 60).length > 10, 'the old bunker\'s hillside is not given back');
  const post = world.sites.find((s) => s.kind === 'market')!, theirs = world.buildings.filter((q) => Math.hypot(q.x - post.x, q.z - post.z) < 60);
  assert.ok(Math.abs(post.x - WG.TRADE_AT.x) < 1 && theirs.length >= 3 && world.buildings.every((q) => Math.hypot(q.x - WAS_T.x, q.z - WAS_T.z) > 40), `the trading post: ${theirs.length} buildings by it`);
  ok(`the bunker in the pines at ${b.x}, ${b.z} (${Math.hypot(b.x - world.castle!.x, b.z - world.castle!.z).toFixed(0)} m from the fort), its pit ${(roofH - pitH).toFixed(1)} m under its roof; its old hillside given back; the trading post's ${theirs.length} buildings by the main road`);
}

// --- the canyon's walls
{
  const C = PLAN.canyon, walls: number[] = [];
  for (const t of [0.25, 0.4, 0.55, 0.7]) {
    // (across the canyon at a quarter, two fifths and so on of its length: the floor at its line, the top 50 m off it)
    const k = Math.floor(t * (C.line.length - 1)), [ax, az] = C.line[k], [bx, bz] = C.line[k + 1], u = t * (C.line.length - 1) - k;
    const x = ax + (bx - ax) * u, z = az + (bz - az) * u, l = Math.hypot(bx - ax, bz - az), px = -(bz - az) / l, pz = (bx - ax) / l;
    const floor = heightAt(H, x, z), top = Math.min(heightAt(H, x + px * 50, z + pz * 50), heightAt(H, x - px * 50, z - pz * 50));
    walls.push(top - floor);
  }
  assert.ok(walls.every((w) => w > 12 && w < 36), `the canyon's walls: ${walls.map((w) => w.toFixed(0)).join(', ')} m`);
  ok(`the canyon's walls ${walls.map((w) => w.toFixed(0)).join(', ')} m over its floor`);
}

// --- the Zona, the starts
{
  let out = 0;
  for (let x = -3500; x <= -700; x += 40) for (let z = -740; z <= 740; z += 40) if (!WG.inPlay(x, z)) out++;
  assert.equal(out, 0, `${out} spots of the new land outside the Zona`);
  assert.ok(!WG.inPlay(PLAN.barrier - 30, 0), 'the Zona reaches past the barrier');
  const west = world.spawns.filter((s) => s.x < -2000);
  assert.equal(west.length, PLAN.starts.z.length);
  assert.ok(west.every((s) => !PLAN.plots.some((p) => Math.abs(s.x - p.x) < p.w / 2 && Math.abs(s.z - p.z) < p.d / 2)), 'a start on a plot');
  ok(`the Zona over all the new land out to the barrier; ${west.length} new starts along x ${PLAN.starts.x}, the square's own as they were`);
}

// --- the ground bodies stand on: Rapier's heightfield of the whole world where the game lays it
await RAPIER.init();
const pw = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const f = WG.groundField(H);
pw.createCollider(RAPIER.ColliderDesc.heightfield(f.rows, f.cols, f.heights, f.scale).setTranslation(f.at.x, f.at.y, f.at.z));
pw.step();
let off = 0, n = 0;
for (let k = 0; k < 4000; k++) {
  // (off the net's lines: a ray straight down one of those is now and then let through by Rapier, on the square as anywhere)
  const x = X0 + 1.37 + ((k * 2654435761) % 4606), z = Z0 + 1.21 + ((k * 40503) % 1534) + (k % 7) * 0.13;
  const hit = pw.castRay(new RAPIER.Ray({ x, y: 500, z }, { x: 0, y: -1, z: 0 }), 1000, true);
  assert.ok(hit, `no ground under ${x}, ${z}`);
  off = Math.max(off, Math.abs(500 - hit!.timeOfImpact - heightAt(H, x, z)));
  n++;
}
assert.ok(off < 1e-3, `the ground bodies stand on is ${off.toFixed(4)} m off the ground's own`);
ok(`Rapier's heightfield of the world is the ground, east and west: ${n} spots, none more than ${(off * 1000).toFixed(2)} mm off`);

console.log(`\n${checks} checks passed`);
