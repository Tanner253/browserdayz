// POKROV'S CORNER TOWERS CAN BE GONE INTO AND CLIMBED: `npx tsx test/pokrov-towers.test.ts`. (2026-10-19, the owner:
// "pokrov needs to have stairs on the insides of the corner towers and door", and "pokrov is missing all kinds of
// collisions".) What is laid out by numbers: that each doorway opens into the court clear of the walls and the
// buildings; that the stair climbs evenly to the platform with room for a head under the ceiling but at the hatch;
// that what stops a body is whole; that the server counts a body in or on a tower as standing on something; that the
// walls' two stairs stop a body. Walked with the real physics headless: progress/pokrov-towers/walk.js. No port.

import assert from 'node:assert/strict';
import { BUILDING_FOOTPRINT } from '../src/world/worldgen/layout';
import { POKROV, POKROV_WALL, onTownWall, placedTowers, placedWalls, townBuildings, townPoint } from '../src/sim/towns';
import { TOWER_ROOM as R, faceAt, noseAt, towerHatch, towerSolids, towerSteps } from '../src/sim/pokrov-towers';
import { kitSolids } from '../src/sim/kit';
import { towerInsides } from '../src/world/pokrov-towers';

let checks = 0;
const ok = (c: boolean, msg: string) => {
  assert.ok(c, msg);
  checks++;
};
const placed = { town: POKROV, padY: 12.3 }, towers = placedTowers(placed), W = POKROV_WALL, DEEP = 2.55;
/** a body's height, feet to crown */
const TALL = 1.72;
ok(towers.length === W.length, 'a tower at every corner');

for (const [k, t] of towers.entries()) {
  const c = Math.cos(t.door), s = Math.sin(t.door), at = (u: number, v: number): [number, number] => [t.x + c * u - s * v, t.z + s * u + c * v];
  // the doorway's mouth and two metres past it: inside both walls that meet at the tower by a body's width, and clear of every building by a metre
  for (let u = faceAt(0) - 0.2; u <= faceAt(0) + 2; u += 0.25) for (const v of [-R.door.half - 0.3, 0, R.door.half + 0.3]) {
    const [x, z] = at(u, v), lx = x - POKROV.x, lz = z - POKROV.z;
    for (const s0 of [(k + W.length - 1) % W.length, k]) {
      const [ax, az] = W[s0], [bx, bz] = W[(s0 + 1) % W.length], ex = bx - ax, ez = bz - az, L = Math.hypot(ex, ez);
      // (how far in from the side's outer line: inside is on the left of the way it runs)
      const inside = (ez * (lx - ax) - ex * (lz - az)) / L;
      ok(inside > DEEP + 0.3, `tower ${k}: the doorway's mouth is ${(inside - DEEP).toFixed(2)} m off the inner face of side ${s0}`);
    }
    for (const b of townBuildings(POKROV)) {
      const [w, d] = BUILDING_FOOTPRINT[b.type], [bx, bz] = townPoint(POKROV, b.x, b.z), cb = Math.cos(b.rot), sb = Math.sin(b.rot);
      const dx = x - bx, dz = z - bz, along = Math.abs(dx * cb - dz * sb), across = Math.abs(dx * sb + dz * cb);
      ok(along > w / 2 + 1 || across > d / 2 + 1, `tower ${k}: the doorway runs into the ${b.type}`);
    }
  }
  // the stair: even, to the platform, clear of the doorway at its foot, never over its own lower turns
  const steps = towerSteps(t), rise = R.top / R.steps, [h0, h1] = towerHatch(t);
  ok(steps.length === R.steps && Math.abs(steps[steps.length - 1].y - R.top) < 1e-9, `tower ${k}: the stair comes up to the platform`);
  ok(steps.every((st, i) => Math.abs(st.y - rise * (i + 1)) < 1e-9) && rise < 0.2 && rise > 0.17, `tower ${k}: the steps rise evenly, ${rise.toFixed(3)} m`);
  const going = (Math.abs(steps[0].a1 - steps[0].a0) * (R.stair + R.r)) / 2;
  ok(going > 0.28 && going < 0.36, `tower ${k}: a step's going on the walking line is ${going.toFixed(2)} m`);
  const across = (a: number, r: number) => Math.abs(-Math.cos(a) * r * s + Math.sin(a) * r * c);
  ok(across(steps[0].a0 - (steps[0].a1 - steps[0].a0), R.stair) > R.door.half + 0.6, `tower ${k}: the stair's foot is clear of the doorway`);
  ok(R.start + R.sweep < 2 * Math.PI - Math.asin(R.door.half / R.r), `tower ${k}: the stair does not come round over the doorway`);
  // (a head has room under the ceiling all the way up but at the hatch, through which it comes out on top: a body's
  // height, the character's skin, and as much again as its round crown rises past the platform's edge as it climbs)
  for (let i = 0; i <= 600; i++) {
    const a = steps[0].a0 + ((h0 - steps[0].a0) * i) / 600;
    ok(R.ceil - noseAt(t, a) > TALL + 0.03 + 0.35, `tower ${k}: a head hits the ceiling ${(R.ceil - noseAt(t, a)).toFixed(2)} m over the stair`);
  }
  ok(Math.abs(h1 - steps[steps.length - 1].a1) < 1e-9 && noseAt(t, h1) === R.top, `tower ${k}: the hatch ends at the stair's head, level with the platform`);
  // what stops a body is whole
  const solids = towerSolids(t);
  ok(solids.length > 150, `tower ${k}: ${solids.length} solids`);
  for (const sd of solids) ok(sd.t === 'hull' && sd.pts.length >= 12 && sd.pts.every(Number.isFinite), `tower ${k}: a solid of ${sd.t === 'hull' ? sd.pts.length / 3 : 0} points`);
  // the server: on the stair, in the room, on the top under the battlements' height; not over them
  const [mx, mz] = [t.x + Math.cos((h0 + h1) / 2) * 3.8, t.z + Math.sin((h0 + h1) / 2) * 3.8];
  ok(onTownWall([placed], mx, t.foot + noseAt(t, (h0 + h1) / 2), mz), `tower ${k}: the server knows the stair is under a body`);
  ok(onTownWall([placed], t.x + 2, t.foot + R.top + 1.6, t.z), `tower ${k}: the server knows the top is under a body`);
  ok(!onTownWall([placed], t.x + 2, t.foot + R.top + 4, t.z), `tower ${k}: nor is anybody held up 4 m over the top`);
}

// drawn: every corner a number, faces turned the way they were asked to
const inside = towerInsides(towers);
for (const [name, corners] of Object.entries(inside)) {
  ok(corners.length > 3000 && corners.length % 3 === 0, `${name}: ${corners.length / 3} triangles`);
  ok(corners.every((q) => q.length === 8 && q.every(Number.isFinite)), `${name}: every corner whole`);
}

// the walls' two stairs and every tower are made solid; the towers by their own plan, not the kit's one block
const pieces = placedWalls(placed);
ok(pieces.filter((p) => p.name === 'Pokrov tower').every((p) => p.body === false && (p.cut ?? []).length >= 2), 'the kit towers are cut and hollow');
for (const p of pieces.filter((q) => q.id === 'fort_wall_stairs_straight_01')) {
  // (two metres clear before its foot, across its width: the east one's foot was 0.8 m from the cells' north end)
  const t = p.turn ?? 0, sn = Math.sin(t), cs = Math.cos(t);
  for (let z = -2.6; z <= -0.6; z += 0.25) for (let x = 0; x <= 3.54; x += 0.5) {
    const wx = p.at[0] + x * cs + z * sn, wz = p.at[2] - x * sn + z * cs;
    for (const b of townBuildings(POKROV)) {
      const [w, d] = BUILDING_FOOTPRINT[b.type], [bx, bz] = townPoint(POKROV, b.x, b.z), cb = Math.cos(b.rot), sb = Math.sin(b.rot);
      const dx = wx - bx, dz = wz - bz;
      ok(Math.abs(dx * cb - dz * sb) > w / 2 + 0.3 || Math.abs(dx * sb + dz * cb) > d / 2 + 0.3, `the ${b.type} stands before a wall stair's foot`);
    }
  }
  const sd = kitSolids([p]);
  ok(sd.length === 4 && sd[0].t === 'hull', `a wall stair stops a body (${sd.length} solids)`);
  const ys = sd[0].t === 'hull' ? sd[0].pts.filter((_, i) => i % 3 === 1) : [];
  ok(Math.min(...ys) - p.at[1] > -0.01 && Math.max(...ys) - p.at[1] > 7, 'its flight from the ground to the walk');
}

console.log(`pokrov-towers: ${checks} checks passed`);
