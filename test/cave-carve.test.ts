// The caves carved out of the rock (src/world/cave-carve.ts), on the plan's own terraces: each cave one closed surface
// (open only round a mouth, where the terrain's own ground meets it), its faces toward the air, the room each gallery
// promises always free, no rock face standing out of the ground away from a mouth, and how long it takes. No ports.
//   npx tsx test/cave-carve.test.ts

import assert from 'node:assert/strict';
import { CARVE, carveCave, caveField } from '../src/world/cave-carve';
import { CAVES, CAVE_MARGIN, caveAt, caveMouths, galleries, passAt, passGround, passOf, passWorld } from '../src/sim/pass';

const pass = passOf(() => 40);
const ground = (x: number, z: number) => passGround(pass, x, z);
const mouths = caveMouths(pass);
const nearMouth = (x: number, z: number, more: number) =>
  mouths.some((m) => {
    const dx = x - m.x, dz = z - m.z, c = Math.cos(m.rot), sn = Math.sin(m.rot);
    return Math.abs(dx * c - dz * sn) < m.hx + more && Math.abs(dx * sn + dz * c) < m.hz + more;
  });

// ---- where on the pass a point is, back from the world
{
  const w = passWorld(pass, 210, -13, 0), at = passAt(pass, w[0], w[2]);
  assert.ok(Math.abs(at.s - 210) < 0.01 && Math.abs(at.t + 13) < 0.01, 'passAt undoes passWorld');
}

let tris = 0, ms = 0;
for (const [ci, c] of CAVES.entries()) {
  const carved = carveCave(pass, ci, ground), f = caveField(pass, ci, ground), k = { ...carved, index: Uint32Array.from([...carved.index, ...carved.face]) };
  const n = k.pos.length / 3, nt = k.index.length / 3;
  // (a short cave's mouths are a third of it: each opens its riser 2.5 m out and a metre past its flare either side)
  assert.ok(carved.face.length > 0 && carved.face.length < carved.index.length / 3, `${c.name}: its mouths' faces apart`);
  tris += nt;
  ms += k.ms;
  assert.ok(nt > 500, `${c.name}: carved`);
  // closed: every edge shared by two faces, but round a mouth's face
  const uses = new Map<string, number>();
  for (let q = 0; q < k.index.length; q += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
    const i = k.index[q + a], j = k.index[q + b], key = i < j ? `${i},${j}` : `${j},${i}`;
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  let open = 0, many = 0;
  for (const [key, u] of uses) {
    if (u > 2) many++;
    if (u !== 1) continue;
    const i = Number(key.split(',')[0]);
    assert.ok(nearMouth(k.pos[i * 3], k.pos[i * 3 + 2], CARVE.margin + 2 * CARVE.cell), `${c.name}: open only round a mouth (an open edge at ${[...k.pos.slice(i * 3, i * 3 + 3)].map((v) => v.toFixed(1))})`);
    open++;
  }
  assert.ok(many <= nt * 0.002, `${c.name}: ${many} edges shared by more than two faces`);
  // its faces toward the air
  let wrong = 0;
  for (let q = 0; q < k.index.length; q += 3) {
    const [a, b, d] = [k.index[q], k.index[q + 1], k.index[q + 2]].map((i) => [k.pos[i * 3], k.pos[i * 3 + 1], k.pos[i * 3 + 2]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const fn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], i = k.index[q];
    if (fn[0] * k.nor[i * 3] + fn[1] * k.nor[i * 3 + 1] + fn[2] * k.nor[i * 3 + 2] < 0) wrong++;
  }
  assert.ok(wrong <= nt * 0.01, `${c.name}: ${wrong} of ${nt} faces turned away from the air`);
  // the room each gallery promises: its floor to its height, across most of its width, all air (sampled along it)
  for (const g of galleries(pass).filter((q) => q.cave === ci)) for (let i = 0; i <= 10; i++) {
    const t = i / 10, x = g.a[0] + (g.b[0] - g.a[0]) * t, y = g.a[1] + (g.b[1] - g.a[1]) * t, z = g.a[2] + (g.b[2] - g.a[2]) * t;
    const w = g.wa + (g.wb - g.wa) * t, h = g.ha + (g.hb - g.ha) * t, ex = g.b[0] - g.a[0], ez = g.b[2] - g.a[2], run = Math.hypot(ex, ez);
    for (const across of [-0.3, 0, 0.3]) for (const up of [0.15, 1, Math.min(1.8, h - 0.3)]) {
      const px = x + (ez / run) * w * across, pz = z - (ex / run) * w * across;
      assert.ok(f.caveAir(f.segs, px, y + up, pz) < 0, `${c.name}: room at ${(t * 100).toFixed(0)}% along, ${up} m up, ${across} across`);
    }
  }
  // no rock face out of the ground away from a mouth: every point of it well under the ground
  let out = 0;
  for (let i = 0; i < n; i++) {
    const x = k.pos[i * 3], y = k.pos[i * 3 + 1], z = k.pos[i * 3 + 2];
    if (!nearMouth(x, z, CARVE.margin + 1) && y > ground(x, z) - 0.5) out++;
  }
  assert.equal(out, 0, `${c.name}: ${out} points of it at the ground away from its mouths`);
  // every hollow of it a body may stand in is in the cave for whatever holds nobody under the ground (CAVE_MARGIN):
  // each point of its own rock, 0.3 m out into the air, under the ground there and within a body's height of the floor
  // (at 0.6 m the hall's carved walls stood 1.7 m past it, and a body in a hollow of them was lifted out after 2 s and
  // its tags voided; up by the roof, where a high gallery meets a lower, nobody stands)
  let lost = 0;
  const gs = galleries(pass);
  for (const q of new Set(carved.index)) {
    const x = k.pos[q * 3], y = k.pos[q * 3 + 1], z = k.pos[q * 3 + 2], nx = k.nor[q * 3], ny = k.nor[q * 3 + 1], nz = k.nor[q * 3 + 2];
    const s = f.field(x + nx * 0.3, y + ny * 0.3, z + nz * 0.3) < 0 ? 0.3 : -0.3, ax = x + nx * s, ay = y + ny * s, az = z + nz * s;
    const under = caveAt(pass, ax, ay, az, gs, 12);
    if (ay < ground(ax, az) - 1.1 && (!under || ay - under.floor < 2.2) && !caveAt(pass, ax, ay, az, gs, CAVE_MARGIN)) lost++;
  }
  assert.equal(lost, 0, `${c.name}: ${lost} points of its air out of the cave's measure`);
  assert.ok([...k.ao].every((a) => a >= 0.15 && a <= 1), 'shading in range');
  console.log(`${c.name}: ${nt} faces, ${n} points, ${open} open edges round its mouths, ${many} shared by more than two, ${wrong} turned, ${k.samples} samples, ${k.ms.toFixed(0)} ms`);
}
console.log(`carved: ${tris} faces in all, ${ms.toFixed(0)} ms`);
console.log('cave carve: all good');
