// The canyon country's outcrops (src/world/outcrops.ts) on the world as made: as many as asked for and no more, none
// floating, none in the pass, the sea or a lake, and none whose reach lies over a road or a river. No ports, no page.
//   npx tsx test/outcrops.test.ts

import assert from 'node:assert/strict';
import { OUTCROPS, outcropPieces } from '../src/world/outcrops';
import { PLAN, SEA_LEVEL, generateWorld, heightAt, passLine, passPlan } from '../src/world/worldgen';

const world = generateWorld(), t0 = performance.now(), pieces = outcropPieces(world, passPlan), ms = performance.now() - t0;
const h = (x: number, z: number) => heightAt(world.heights, x, z);
// (a piece's reach: half its length as it came, at its scale; small pieces by their foot alone)
const LONG: Record<string, number> = { namaqualand_cliff_02: 20.2, namaqualand_cliff_01: 8.3, mountainside: 10.2, namaqualand_boulder_02: 2.5, namaqualand_boulder_03: 2.4, namaqualand_boulder_04: 2.5, namaqualand_boulder_05: 1.4 };
const reach = (p: (typeof pieces)[number]) => (p.small ? 0.3 : (LONG[p.id] * p.scale) / 2) * 0.7;
const segDist = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
};

const small = pieces.filter((p) => p.small).length;
assert.ok(pieces.length > 1500, `outcrops laid: ${pieces.length}`);
// (the caps a backstop never reached: the country is read north to south, and a cap reached leaves its south bare)
assert.ok(small < OUTCROPS.small && pieces.length - small < OUTCROPS.big + OUTCROPS.medium, `no cap reached: ${small} small, ${pieces.length - small} others`);
assert.ok(ms < 3000, `laid in ${ms.toFixed(0)} ms`);
for (const p of pieces) {
  const [x, y, z] = p.at, where = `${p.id} at ${x.toFixed(0)}, ${z.toFixed(0)}`;
  assert.ok(y <= h(x, z) + 1e-6, `${where}: its foot under the ground`);
  assert.ok(h(x, z) > SEA_LEVEL + 1, `${where}: out of the sea`);
  const near = passLine.near(x, z);
  assert.ok(!(near.d < PLAN.pass.floor + 40 && near.along > 0 && near.along < passLine.total), `${where}: not in the pass`);
  for (const rd of [world.road, ...world.roads]) for (let i = 0; i + 1 < rd.points.length / 3; i++) {
    const d = segDist(x, z, rd.points[i * 3], rd.points[i * 3 + 2], rd.points[i * 3 + 3], rd.points[i * 3 + 5]);
    assert.ok(d - reach(p) > rd.width / 2 + 0.5, `${where}: off the road (${(d - rd.width / 2).toFixed(1)} m from its edge, reach ${reach(p).toFixed(1)})`);
  }
  for (const rv of world.water?.rivers ?? []) for (const [rx, rz, , w] of rv.pts) assert.ok(Math.hypot(x - rx, z - rz) - reach(p) > w / 2, `${where}: out of the river`);
}
console.log(`outcrops: ${pieces.length} (${small} small) in ${ms.toFixed(0)} ms; all good`);
