// NOTHING STANDS IN A WAY OUT: `npx tsx test/ways-out.test.ts`. (2026-10-19, the owner: "on the map cell AP has
// barrels blocking the door of the building".) The map as the server plans it (generateWorld, Buildings.plan): no
// drum, crate, bin or car outside a building stands in the way out of any of its outer doors or in its leaf's swing,
// the drums are as many as before, and a thing slid clear took what lay on it along. Nothing here opens a port.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateWorld } from '../src/world/worldgen';
import { BUILDING_FOOTPRINT } from '../src/world/worldgen/layout';
import { Buildings, blueprintOf } from '../src/world/buildings';
import { into, waysOf } from '../src/world/ways-out';
import { assets } from '../src/core/assets';
import { RNG } from '../src/core/noise';

let checks = 0;
const ok = (what: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`  ok  ${what}`);
};
const manifest = JSON.parse(fs.readFileSync('public/assets/manifest.json', 'utf8'));
(assets as { manifest: unknown }).manifest = manifest;
const world = generateWorld();
const plan = new Buildings(world, null as never);
plan.plan();

ok('no thing outside a building stands in the way out of a door or in its swing', () => {
  const inBuilding = (x: number, z: number) => world.buildings.some((o) => {
    const [w, d] = BUILDING_FOOTPRINT[o.type] ?? [0, 0], dx = x - o.x, dz = z - o.z, c = Math.cos(o.rot), s = Math.sin(o.rot);
    return Math.abs(dx * c - dz * s) < w / 2 - 0.05 && Math.abs(dx * s + dz * c) < d / 2 - 0.05;
  });
  const out = world.props.filter((p) => {
    const b = manifest.models[p.kind.split(/[#@]/)[0]];
    return b && (b.max[1] - b.min[1]) * (p.scale ?? 1) >= 0.25 && !(p.far !== undefined && p.far < 50) && !inBuilding(p.x, p.z);
  });
  const bad: string[] = [];
  for (const plot of world.buildings) {
    if (plot.type === 'tower') continue;
    for (const w of waysOf(plot, blueprintOf(plot.type, new RNG(plot.seed)))) {
      for (const p of out) if (Math.hypot(p.x - w.a[0], p.z - w.a[1]) < 8 && into(w, p, manifest.models[p.kind.split(/[#@]/)[0]])) bad.push(`${p.kind} at ${p.x.toFixed(1)},${p.z.toFixed(1)} before a door of ${plot.id}`);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(plan.waysCleared > 0 && plan.waysCleared < 60, `${plan.waysCleared} things slid clear`);
});

ok('the drums are all there, and every water barrel slid clear has its lid place with it', () => {
  assert.equal(world.props.filter((p) => p.kind === 'Barrel_01').length, 251);
  // (a place on a water barrel's lid lies at its middle: none is left hanging where a barrel was)
  const lids = world.props.filter((p) => p.kind === 'barrel_03' && p.far === undefined);
  for (const q of plan.lootPoints) if (!q.floor && q.surf && q.surf.hx === 0.17 && q.surf.hz === 0.17) assert.ok(lids.some((p) => Math.hypot(p.x - q.x, p.z - q.z) < 0.01), `a lid's place at ${q.x.toFixed(1)},${q.z.toFixed(1)} with no barrel under it`);
});

console.log(`ways out: ${checks} checks passed`);
