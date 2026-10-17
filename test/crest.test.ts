// The ridge's wall that cannot be seen (src/game/game.ts) over the pass's caves (src/sim/pass.ts caveSpansUnder,
// wallParts), on the world as made: the long way goes under the crest, and the wall cuts through no gallery, starts
// under the ground over each one (no gap to slip through over the crest), and a body in a cave under it is somewhere
// the server lets it be (server/index.ts onMap: on the crest only in a cave). No ports, no page.
//   npx tsx test/crest.test.ts

import assert from 'node:assert/strict';
import { CAVES, caveSpansUnder, galleries, wallParts } from '../src/sim/pass';
import { inCave } from '../src/world/caves-carved';
import { WORLD_Z0, WORLD_Z1, generateWorld, heightAt, onRidgeWall, passPlan, ridgeWall } from '../src/world/worldgen';

const world = generateWorld(), H = (x: number, z: number) => heightAt(world.heights, x, z), gs = galleries(passPlan);
let raised = 0, under = 0, checked = 0;
for (const [ax, az, bx, bz] of ridgeWall(WORLD_Z0, WORLD_Z1)) {
  const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
  const parts = wallParts(L, caveSpansUnder(passPlan, ax, az, bx, bz, gs), -400, 0.6);
  // (the wall is 1.2 m thick: a body, 0.3 m round, meets it 0.9 m from its middle line)
  const partAt = (u: number) => parts.find((p) => u >= p.from && u <= p.to);
  for (const g of gs)
    for (let i = 0; i <= 40; i++) {
      const k = i / 40, w = g.wa + (g.wb - g.wa) * k, h = g.ha + (g.hb - g.ha) * k, run = Math.hypot(g.b[0] - g.a[0], g.b[2] - g.a[2]);
      for (const across of [-0.5, -0.25, 0, 0.25, 0.5])
        for (const up of [0.2, 1, 1.8, h]) {
          const x = g.a[0] + (g.b[0] - g.a[0]) * k + ((g.b[2] - g.a[2]) / run) * w * across, z = g.a[2] + (g.b[2] - g.a[2]) * k - ((g.b[0] - g.a[0]) / run) * w * across;
          const y = g.a[1] + (g.b[1] - g.a[1]) * k + up, dx = x - ax, dz = z - az, u = dx * ux + dz * uz, d = Math.abs(dx * uz - dz * ux);
          if (d > 0.9 || u < -0.6 || u > L + 0.6) continue;
          checked++;
          const p = partAt(u);
          assert.ok(p && y < p.foot, `${CAVES[g.cave].name}: the crest's wall through it at ${x.toFixed(0)}, ${y.toFixed(1)}, ${z.toFixed(0)} (its foot ${p?.foot.toFixed(1)})`);
          // (and the server lets a body be there: on the crest, in a cave)
          if (up < 2 && onRidgeWall(x, z)) {
            under++;
            assert.ok(inCave(x, y, z), `${CAVES[g.cave].name}: a body under the crest at ${x.toFixed(0)}, ${z.toFixed(0)} is in its cave`);
          }
        }
    }
  for (const p of parts) {
    if (p.foot <= -400) continue;
    raised++;
    // (the ground over a raised stretch, and a little either side of the wall, is over its foot: no gap at the surface)
    for (let u = p.from; u <= p.to; u += 0.5)
      for (const side of [-0.9, 0, 0.9]) {
        const x = ax + ux * u + uz * side, z = az + uz * u - ux * side;
        assert.ok(H(x, z) > p.foot, `the crest's wall over a cave: a gap ${(H(x, z) - p.foot).toFixed(1)} m at ${x.toFixed(0)}, ${z.toFixed(0)}`);
      }
  }
}
assert.ok(raised > 0 && checked > 0, `the long way goes under the crest: ${raised} stretches of its wall raised, ${checked} points of galleries by it`);
console.log(`crest: ${raised} stretches raised over the caves, ${checked} points of galleries by the wall, ${under} of them under the crest; all good`);
