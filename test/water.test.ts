// Lakes and rivers as rules (src/sim/water.ts): where the water is and how deep, which way a river runs and how fast,
// and what wading does to a walker. No ports, no page.
//   npx tsx test/water.test.ts

import assert from 'node:assert/strict';
import { WADE, inside, tooDeep, waterAt, wading, type Waters } from '../src/sim/water';

// a bowl of ground, its floor 3 m under the lake's level at its middle; a river falling west along z = 300, a step in it
const ground = (x: number, z: number) => (Math.abs(z - 300) < 10 ? -2 + Math.abs(z - 300) * 0.3 - x * 0.01 : Math.hypot(x, z) * 0.05 - 3);
const waters: Waters = {
  lakes: [{ name: 'bowl', level: 0, outline: [[-60, -60], [60, -60], [60, 60], [-60, 60]] }],
  rivers: [{ name: 'creek', pts: [[200, 300, 0, 8], [100, 300, -1, 8], [96, 300, -1.6, 8], [0, 300, -2.6, 10]] }],
};

{
  assert.ok(inside(waters.lakes[0].outline, 10, 10) && !inside(waters.lakes[0].outline, 70, 0), 'inside an outline');
  const mid = waterAt(waters, 0, 0, ground)!;
  assert.equal(mid.kind, 'lake');
  assert.ok(Math.abs(mid.depth - 3) < 1e-9 && mid.surface === 0 && mid.flow[2] === 0, 'the lake at its middle');
  // (the bowl's ground rises to the level 60 m out: dry before the outline)
  assert.equal(waterAt(waters, 59.5, 30, ground), null, 'dry ground inside the outline is not water');
  assert.equal(waterAt(waters, 200, 0, ground), null, 'nowhere near water');
  console.log(`lake: 3 m deep at its middle, dry where its ground rises above it`);
}
{
  const up = waterAt(waters, 150, 300, ground)!, step = waterAt(waters, 98, 300, ground)!, low = waterAt(waters, 50, 300.5, ground)!;
  assert.equal(up.kind, 'river');
  assert.ok(Math.abs(up.surface + 0.5) < 1e-9, 'the surface between two points is straight between them');
  assert.ok(up.flow[0] < -0.99 && Math.abs(up.flow[1]) < 1e-9, 'it runs west, downstream');
  assert.ok(step.flow[2] > up.flow[2] * 2 && step.flow[2] <= WADE.fastest, 'faster at its step');
  assert.ok(low.depth > 0 && waterAt(waters, 50, 306, ground) === null, 'its banks are dry past its width');
  const edge = waterAt(waters, 150, 303.5, ground)!;
  assert.ok(edge.flow[2] < up.flow[2], 'slower toward its banks');
  console.log(`river: ${up.flow[2].toFixed(2)} m/s on the level stretch, ${step.flow[2].toFixed(2)} at the step, slower at the banks`);
}
{
  assert.equal(wading(0.1), 1, 'wet feet do not slow');
  let last = 1;
  for (let d = 0.2; d <= 1.2; d += 0.1) { assert.ok(wading(d) <= last + 1e-12, 'deeper is never faster'); last = wading(d); }
  assert.ok(Math.abs(wading(WADE.waist) - WADE.slowest) < 1e-9, 'at the waist, the slowest');
  assert.ok(!tooDeep(1.0) && tooDeep(1.4), 'deep water stops a walker');
  console.log(`wading: knee ${wading(0.5).toFixed(2)}, waist ${wading(0.95).toFixed(2)} of the pace on land; stopped past ${WADE.deep} m`);
}
console.log('water: all good');
