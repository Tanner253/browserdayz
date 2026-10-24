// npx tsx test/basement-wells.test.ts: the way down to every basement on the map is clear (the owner, 2026-10-23:
// "make sure no ground lootable containers are blocking basement entrances. currently some entrances have a cardboard
// box floating above the entrance etc.. preventing easy access"). The map planned as the server plans it; for each
// basement, nothing that stands out of doors and no place for a thing on the ground is on its open steps, round them,
// or before their head (WELL_CLEAR, clearWells: src/world/ways-out.ts), and what was slid off stands on the ground.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateWorld, heightAt, BUILDING_FOOTPRINT } from '../src/world/worldgen';
import { Buildings } from '../src/world/buildings';
import { assets } from '../src/core/assets';
import { worldToFrame } from '../src/sim/basements';
import { inWellWay } from '../src/world/ways-out';

const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8'));
(assets as { manifest: unknown }).manifest = manifest;
const world = generateWorld(), plan = new Buildings(world, null as never);
plan.plan();
const boxes = manifest.models as Record<string, { min: number[]; max: number[] }>;
const inHouse = (x: number, z: number) => world.buildings.some((o) => { const [w, d] = BUILDING_FOOTPRINT[o.type] ?? [0, 0], [lx, lz] = worldToFrame(o, x, z); return Math.abs(lx) < w / 2 && Math.abs(lz) < d / 2; });
const wells = world.basements ?? [];
assert.ok(wells.length > 10, `the map has its basements (${wells.length})`);
const found: string[] = [];
for (const b of wells) {
  const W = b.well, on = (x: number, z: number, r: number) => inWellWay(b, x, z, r);
  for (const p of world.props) {
    if (Math.abs(p.x - b.x) > 30 || Math.abs(p.z - b.z) > 30 || p.y < W.top - 1 || inHouse(p.x, p.z)) continue;
    const bx = boxes[p.kind.split(/[#@]/)[0]], r = bx ? (Math.min(bx.max[0] - bx.min[0], bx.max[2] - bx.min[2]) * (p.scale ?? 1)) / 2 : 0.3;
    if (on(p.x, p.z, r)) found.push(`${b.plot}: ${p.kind} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
  }
  for (const q of plan.lootPoints) if (!q.floor && Math.abs(q.x - b.x) < 30 && Math.abs(q.z - b.z) < 30 && q.y > W.top - 1 && !inHouse(q.x, q.z) && on(q.x, q.z, 0.2)) found.push(`${b.plot}: a place of ${q.building}'s at ${q.x.toFixed(1)}, ${q.z.toFixed(1)}`);
}
assert.equal(found.length, 0, `on or over the way down to a basement:\n  ${found.join('\n  ')}`);
console.log(`  ok  the way down to all ${wells.length} basements is clear (${plan.wellsCleared} slid off it)`);
// (and what was slid stands on the ground: the grounds of a house are near level, and it was moved by the ground's own rise)
const floating = world.props.filter((p) => !inHouse(p.x, p.z) && wells.some((b) => Math.hypot(p.x - b.x, p.z - b.z) < 14) && Math.abs(p.y - heightAt(world.heights, p.x, p.z)) > 0.25 && (p.far === undefined || p.far >= 50));
assert.equal(floating.length, 0, `off the ground by a basement: ${floating.map((p) => `${p.kind} ${(p.y - heightAt(world.heights, p.x, p.z)).toFixed(2)}`).join(', ')}`);
console.log('  ok  nothing about them stands off the ground');
console.log('basement-wells: all good');
