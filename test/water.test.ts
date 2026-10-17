// Lakes and rivers as rules (src/sim/water.ts): where the water is and how deep, which way a river runs and how fast,
// and what wading does to a walker. No ports, no page.
//   npx tsx test/water.test.ts

import assert from 'node:assert/strict';
import { WADE, fromRoom, inside, riverBank, tooDeep, waterAt, wading, type Waters } from '../src/sim/water';

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
{
  // the river's banks, for a green line through dry country: how far from its water's edge
  const dry = riverBank(waters, 150, 300 + 4 + 10)!, wet = riverBank(waters, 150, 300)!;
  assert.ok(Math.abs(dry - 10) < 1e-9 && wet < 0, 'distance from the edge of a river');
  assert.equal(riverBank(waters, 150, 400), null, 'out of reach of any river');
  console.log(`banks: 10 m out of the water read as ${dry.toFixed(1)}, its middle as ${wet.toFixed(1)}`);
}
// ---- rooms in the water: a dry one keeps it out, a flooded one under a roof keeps it
{
  const ground = () => -0.6;
  const hamlet: Waters = {
    lakes: [{ name: 'flooded', level: 0, outline: [[-40, -40], [40, -40], [40, 40], [-40, 40]], swamp: true }],
    rivers: [],
    rooms: [
      { x: 10, z: 5, rot: 0.5, hx: 4, hz: 3, dry: true },
      { x: -12, z: -8, rot: -0.3, hx: 5, hz: 3.25 },
    ],
  };
  const dry = hamlet.rooms![0], wet = hamlet.rooms![1];
  assert.ok(fromRoom(dry, 10, 5) < 0 && Math.abs(fromRoom(dry, 10 + Math.cos(0.5) * 4, 5 - Math.sin(0.5) * 4)) < 1e-9, 'a room measured from its walls, turned as the wells are');
  assert.equal(waterAt(hamlet, 10, 5, ground), null, 'no water in a dry room');
  assert.equal(waterAt(hamlet, 10 + Math.cos(0.5) * 3.8, 5 - Math.sin(0.5) * 3.8, ground), null, 'none in it up to its wall');
  assert.ok(waterAt(hamlet, 10 + Math.cos(0.5) * 4.3, 5 - Math.sin(0.5) * 4.3, ground)?.depth === 0.6, 'water outside its wall');
  assert.ok(waterAt(hamlet, -12, -8, ground)?.depth === 0.6, 'water in a flooded room');
  void wet;
  console.log('rooms: none in a dry room up to its wall, water outside it and in a flooded one');
}
console.log('water: all good');
