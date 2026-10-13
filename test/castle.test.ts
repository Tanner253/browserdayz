// Checks of the fort on the mountain: its measurements against the real one's (src/sim/castle.ts), its shapes by
// numbers (src/world/castle-shape.ts: nothing drawn, nothing run), that a body has room on every stair, and that
// what lies in it lies somewhere a hand can reach. `npx tsx test/castle.test.ts`.

import assert from 'node:assert/strict';
import { CASTLE, CASTLE_TIERS, FURNITURE, LOOSE, OUTCROP, castleAt, castleGround, castleHomes, castleLamps, castleLocal, castleLoose, castleLoot, castleParts, castleProps, inCastle, looseLocal, looseParts, moundTop, stairShare, towerRadius, type Flight, type Place, type Tower, type V3 } from '../src/sim/castle';
import { PAINTS, TILE, castleShape, type Skin, type Solid } from '../src/world/castle-shape';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};
const within = (v: number, lo: number, hi: number, what: string) => assert.ok(v >= lo - 1e-9 && v <= hi + 1e-9, `${what}: ${v.toFixed(3)} is not in ${lo}..${hi}`);

const P: Place = { x: 310, y: 240, z: -415, rot: 0.7 };
const parts = castleParts(), shape = castleShape();
const towers = parts.filter((p): p is Tower => p.t === 'tower'), flights = parts.filter((p): p is Flight => p.t === 'flight');
const C = CASTLE, K = C.keep, T = C.tower;

ok('a spot in the fort is the same spot in the world and back, however the fort is turned', () => {
  for (const [x, z, y] of [[0, 0, 0], [9.9, -10, 4.8], [-37, 12, -6]]) {
    const [wx, wy, wz] = castleAt(P, x, z, y), back = castleLocal(P, wx, wy, wz);
    assert.ok(Math.hypot(back[0] - x, back[1] - z, back[2] - y) < 1e-9);
  }
  assert.ok(inCastle(P, ...castleAt(P, 7, -8, 1)) && inCastle(P, ...castleAt(P, C.hx, C.hz, 5)) && !inCastle(P, ...castleAt(P, 20, 0, 0)) && !inCastle(null, 0, 0, 0));
});

ok('it is the size the real one was measured to be', () => {
  // four round towers at the corners of a near-square, their middles about twenty metres apart
  assert.equal(towers.length, 4);
  for (const a of towers) for (const b of towers) {
    const d = Math.hypot(a.cx - b.cx, a.cz - b.cz);
    if (d > 0 && d < 25) within(d, 19.4, 21.9, 'tower to tower');
  }
  // the towers: ten metres across where the ground meets them, 5.4 to 6.3 across at the top, leaning at about 75 degrees under the terrace
  within(towerRadius(0) * 2, 5.4, 6.3, 'a tower across at the top');
  within(towerRadius(C.foot.south) * 2, 9.6, 10.6, 'a tower across at the ground');
  within((Math.atan(T.lean) * 180) / Math.PI, 74, 76.5, "the lean of a tower's wall");
  within((Math.atan(C.lean) * 180) / Math.PI, 74, 76, 'the lean of the curtain');
  for (const tw of towers) {
    within(Math.max(...tw.rim), 6, 7.2, 'the top of a rim');
    within(Math.max(...tw.rim) - tw.foot, 22.5, 28, 'a tower from footing to rim');
    within(T.wall, 0.8, 1.1, 'the thickness of its wall');
  }
  // the keep: 11 to 11.3 m a side, its roof 8.7 m up, its highest stub 14.4
  within(K.x1 - K.x0, 11, 11.3, 'the keep east to west');
  within(K.z1 - K.z0, 11, 11.3, 'the keep north to south');
  assert.equal(K.roof, 8.7);
  const stubs = parts.flatMap((p) => (p.t === 'wall' && /^keep .* face$/.test(p.name ?? '') && typeof p.top !== 'number' ? p.top : []));
  assert.equal(Math.max(...stubs), 14.4);
  within(K.room.x1 - K.room.x0, 6, 6.8, 'the roof east to west');
  within(K.room.z1 - K.room.z0, 6, 6.8, 'the roof north to south');
  within(K.x1 - K.skin - K.room.x1, 1.7, 2.6, 'the wall at the roof, less its shell');
  // the parapet: sill 1.8, merlons to 2.9, seven a side each 1.1 wide with 0.9 between; the walk 3.4 to 4.3 wide
  assert.deepEqual([C.parapet.sill, C.parapet.top, C.parapet.merlon, C.parapet.gap, C.parapet.n, C.parapet.thick], [1.8, 2.9, 1.1, 0.9, 7, 0.7]);
  for (const side of ['n', 's', 'e', 'w']) {
    const whole = parts.filter((p) => p.t === 'box' && p.name === `${side} merlon`);
    assert.ok(whole.length >= 5 && whole.length <= 7, `${side}: ${whole.length} merlons`);
  }
  for (const walk of [C.hx - C.parapet.thick / 2 - K.x1, K.x0 + C.hx - C.parapet.thick / 2, C.hz - C.parapet.thick / 2 - K.z1]) within(walk, 3.4, 4.4, 'the terrace walk');
  // the ramp: eight metres long, two and a half wide, ten degrees, to a gap of two and a half metres
  assert.equal(C.ramp.len, 8);
  within((Math.asin(C.ramp.drop / C.ramp.len) * 180) / Math.PI, 9.5, 10.5, 'the slope of the ramp');
  within(C.gate.z1 - C.gate.z0, 2.4, 2.6, 'the gate');
  // the ground at the foot of each wall, under the terrace
  assert.deepEqual(C.foot, { east: -5.8, west: -6.1, north: -7.3, south: -8 });
});

ok('whoever holds the parapet can fight from it: over the sill from the step, through the ports from the paving', () => {
  const eye = { stood: 1.6, crouched: 1.05 }, S = C.step, port = C.parapet.port;
  // from the paving the sill is over a man's eyes; from the step he sees over it and is under the merlons' tops; crouched on the step he is hidden
  assert.ok(eye.stood < C.parapet.sill && S.h + eye.stood > C.parapet.sill + 0.25 && S.h + eye.stood < C.parapet.top && S.h + eye.crouched < C.parapet.sill);
  // and a port is at the eye of a man standing on the paving
  assert.ok(port.y0 < eye.stood - 0.2 && port.y1 > eye.stood + 0.05);
  // every tower's platform is whole on the side of the field: the stair comes up on the side of the door
  for (const tw of towers) {
    const out = (Math.atan2(tw.cz, tw.cx) * 180) / Math.PI, sg = Math.sign(tw.stair.sweep), inWell = (a: number) => ((((a - tw.well[0]) * sg) % 360) + 360) % 360 < Math.abs(tw.well[1] - tw.well[0]);
    for (let a = out - 100; a <= out + 100; a += 5) assert.ok(!inWell(a), `${tw.name}: the well is open toward the field at ${a}`);
    assert.ok(inWell(tw.door), `${tw.name}: the stair does not come up over its door`);
    // a window along each wall it guards and one over the field; each can be stood at (on the floor, or on the stair where the stair is in front of it)
    assert.equal(tw.slits.length, 3);
    for (const s of tw.slits) {
      const share = stairShare(tw, s.a), h = share === null ? 99 : share * T.deck, stand = s.y0 < 1 ? 0 : h;
      assert.ok(stand + eye.stood > s.y0 + 0.2 && stand + eye.stood < s.y1 - 0.1, `${tw.name}: nobody sees out of the window at ${s.a}`);
      assert.ok(s.y1 < Math.min(...tw.rim) && Math.abs(s.y1 - s.y0 - 1.4) < 0.01);
    }
  }
});

// ---- the shapes

const tris = (k: Skin) => k.pos.length / 9;
/** for each triangle of a skin: its size, whether its corners face the way it does, and how much the picture is stretched on it [least, most] */
function survey(k: Skin, tile: number) {
  let area = 0, off = 0, turned = 0, small = 0, bad = 0;
  for (let t = 0; t < tris(k); t++) {
    const p = [0, 1, 2].map((i) => k.pos.slice(t * 9 + i * 3, t * 9 + i * 3 + 3)), u = [0, 1, 2].map((i) => [k.uv[t * 6 + i * 2] * tile, k.uv[t * 6 + i * 2 + 1] * tile]);
    if (![...p.flat(), ...u.flat(), ...k.col.slice(t * 9, t * 9 + 9)].every(Number.isFinite)) bad++;
    const e1 = p[1].map((v, c) => v - p[0][c]), e2 = p[2].map((v, c) => v - p[0][c]);
    const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], twice = Math.hypot(g[0], g[1], g[2]);
    if (twice < 1e-7) {
      small++;
      continue;
    }
    for (let i = 0; i < 3; i++) {
      const nn = k.nrm.slice(t * 9 + i * 3, t * 9 + i * 3 + 3);
      if (Math.abs(Math.hypot(nn[0], nn[1], nn[2]) - 1) > 1e-3) bad++;
      if ((nn[0] * g[0] + nn[1] * g[1] + nn[2] * g[2]) / twice < 0.2) turned++;
    }
    area += twice / 2;
    const du1 = u[1][0] - u[0][0], dv1 = u[1][1] - u[0][1], du2 = u[2][0] - u[0][0], dv2 = u[2][1] - u[0][1];
    // (one spot of the picture on the whole of it: the dark of a putlog hole)
    if (Math.abs(du1 * dv2 - du2 * dv1) < 1e-9) continue;
    const E = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2], F = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2], G = e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2], det = E * G - F * F;
    const a = (du1 * du1 * G - 2 * du1 * du2 * F + du2 * du2 * E) / det, c = (dv1 * dv1 * G - 2 * dv1 * dv2 * F + dv2 * dv2 * E) / det, b = (du1 * dv1 * G - (du1 * dv2 + du2 * dv1) * F + du2 * dv2 * E) / det;
    const half = (a + c) / 2, d = Math.sqrt(Math.max(0, ((a - c) * (a - c)) / 4 + b * b)), most = Math.sqrt(half + d), least = Math.sqrt(Math.max(0, half - d));
    if (most > 1.25 || least < 0.8) off += twice / 2;
  }
  return { area, off, turned, small, bad };
}

ok('its shapes are sound: every triangle has size, faces the way it says, and is a number', () => {
  for (const p of PAINTS) {
    const s = survey(shape.near[p], TILE[p]);
    assert.deepEqual([s.bad, s.turned, s.small], [0, 0, 0], `${p}: ${s.bad} not numbers, ${s.turned} turned the wrong way, ${s.small} of no size`);
  }
  const f = survey(shape.far, TILE.stone);
  assert.deepEqual([f.bad, f.turned, f.small], [0, 0, 0]);
});

ok('the stone is not stretched: a course is as tall, and a stone as long, at the foot of a leaning tower as at its top', () => {
  // (all but the heads of arches, which are a sliver: under a hundredth of the masonry, and of the timber none at all)
  for (const p of ['stone', 'ashlar', 'paving', 'timber'] as const) {
    const s = survey(shape.near[p], TILE[p]);
    assert.ok(s.off / s.area < 0.01, `${p}: ${((s.off / s.area) * 100).toFixed(2)} % of it is stretched by more than a quarter`);
  }
});

ok('it is cheap to draw: seven things from near, one from far', () => {
  const near = PAINTS.reduce((t, p) => t + tris(shape.near[p]), 0);
  assert.ok(PAINTS.every((p) => tris(shape.near[p]) > 0));
  assert.ok(near < 48000, `${near} triangles from near`);
  assert.ok(tris(shape.far) < 6000 && tris(shape.far) > 1500, `${tris(shape.far)} triangles from far`);
  // from far it is the same outline: as tall and as wide
  const top = (k: Skin) => k.pos.reduce((m, v, i) => (i % 3 === 1 ? Math.max(m, v) : m), -Infinity);
  assert.ok(Math.abs(top(shape.far) - Math.max(...PAINTS.map((p) => top(shape.near[p])))) < 0.3);
});

ok('its walls and its towers go down past the ground it assumes, by three metres and more', () => {
  for (const tw of towers) for (let a = 0; a < 360; a += 15) {
    const r = towerRadius(tw.foot) - 0.2, x = tw.cx + Math.cos((a * Math.PI) / 180) * r, z = tw.cz + Math.sin((a * Math.PI) / 180) * r;
    // (under the terrace itself there is no ground to meet)
    if (Math.abs(x) < C.hx && Math.abs(z) < C.hz) continue;
    assert.ok(castleGround(x, z) - tw.foot > 3, `${tw.name} at ${a}: its foot is ${(castleGround(x, z) - tw.foot).toFixed(1)} m under the ground`);
  }
  for (const [x, z] of [[0, -C.hz - 2.5], [0, C.hz + 2.5], [C.hx + 2.5, 5], [-C.hx - 2.5, 0]]) assert.ok(castleGround(x, z) + C.deep > 3, `the curtain at ${x}, ${z}`);
  // and every loose piece stands three metres into whatever it is put on
  for (const l of LOOSE) for (const p of looseParts(l)) if (p.t === 'wall') assert.ok(p.y0 <= -3 && p.sits);
});

// ---- what stops a body

const boxes = shape.solids.filter((s): s is Extract<Solid, { t: 'box' }> => s.t === 'box');
/** how far a point is from a block (0: in it) */
function clear(s: Extract<Solid, { t: 'box' }>, p: V3) {
  const [qx, qy, qz, qw] = s.q, d = [p[0] - s.c[0], p[1] - s.c[1], p[2] - s.c[2]];
  // (turned back the way the block is turned)
  const tx = 2 * (-qy * d[2] + qz * d[1]), ty = 2 * (-qz * d[0] + qx * d[2]), tz = 2 * (-qx * d[1] + qy * d[0]);
  const l = [d[0] + qw * tx + (-qy * tz + qz * ty), d[1] + qw * ty + (-qz * tx + qx * tz), d[2] + qw * tz + (-qx * ty + qy * tx)];
  return Math.hypot(...l.map((v, i) => Math.max(0, Math.abs(v) - s.h[i])));
}
/** a body: a round of 0.3 m, 1.72 m tall, its feet at a spot. What of the fort it is in, if anything (not what only stops feet: that is what it stands on) */
function fouls(feet: V3) {
  for (const s of boxes) {
    if (s.feet) continue;
    for (let y = 0.34; y <= 1.43; y += 0.27) if (clear(s, [feet[0], feet[1] + y, feet[2]]) < 0.29) return s.name;
  }
  return null;
}

ok('what stops a body is sound: every block has size and is turned by a turn, every stair has its slope', () => {
  for (const s of boxes) {
    assert.ok(s.h.every((v) => v > 0 && Number.isFinite(v)) && Math.abs(Math.hypot(...s.q) - 1) < 1e-6 && s.c.every(Number.isFinite), `${s.name}: ${s.h}`);
  }
  assert.ok(shape.solids.length < 1500, `${shape.solids.length} things to run into`);
  // a flight is a slope and a last tread, both for feet alone; nothing of a slope is steeper than legs go up
  const slopes = boxes.filter((s) => s.feet && /stair|steps|flight|scaffold/.test(s.name) && s.h[1] === 0.04);
  assert.ok(slopes.length >= flights.length * 2);
  for (const f of flights) {
    const run = Math.hypot(f.head[0] - f.foot[0], f.head[2] - f.foot[2]), up = f.head[1] - f.foot[1];
    within((Math.atan2(up, run) * 180) / Math.PI, 20, 42, `${f.name}: how steep`);
    within(up / Math.round(up / 0.2), 0.17, 0.215, `${f.name}: the height of a step`);
  }
  // the ground that is made (the rock, the rubble) is given as ground is
  assert.equal(shape.solids.filter((s) => s.t === 'field').length, 2);
});

ok('a body has room on every stair of the keep, from the floor below to the floor above', () => {
  for (const f of flights) {
    const dx = f.head[0] - f.foot[0], dz = f.head[2] - f.foot[2], L = Math.hypot(dx, dz), up = f.head[1] - f.foot[1], run = L / Math.round(up / 0.2);
    // (the slope begins a tread before the foot and comes level a tread before the head; a round foot rides a little over it)
    for (let s = -run - 0.25; s <= L + 0.6; s += 0.1) {
      const y = f.foot[1] + Math.min(up, Math.max(0, ((s + run) / L) * up)), lift = s > -run && s < L - run ? 0.08 : 0.01;
      const hit = fouls([f.foot[0] + (dx / L) * s, y + lift, f.foot[2] + (dz / L) * s]);
      assert.equal(hit, null, `${f.name}: a body ${(s + run).toFixed(1)} m up it is in the ${hit}`);
    }
  }
});

ok("a body has room on every tower's stair, under its platform and through its well; and through its door", () => {
  const rm = (T.stairIn + T.r - T.wall) / 2, hulls = shape.solids.filter((s): s is Extract<Solid, { t: 'hull' }> => s.t === 'hull' && s.name === 'tower platform' && s.pts.length === 24);
  for (const tw of towers) {
    const sg = Math.sign(tw.stair.sweep), tread = tw.stair.sweep / Math.round(T.deck / 0.2);
    for (let a = -Math.abs(tread); a <= Math.abs(tw.stair.sweep); a += 2) {
      const ang = ((tw.stair.from + sg * a) * Math.PI) / 180, y = T.deck * Math.min(1, Math.max(0, (a + Math.abs(tread)) / Math.abs(tw.stair.sweep)));
      const feet: V3 = [tw.cx + Math.cos(ang) * rm, y + 0.08, tw.cz + Math.sin(ang) * rm];
      assert.equal(fouls(feet), null, `${tw.name}: a body ${a} degrees up its stair is in the wall`);
      // and the boards of the platform are over its head, or it is in the well
      for (const h of hulls) {
        // (a length of the platform, from above, is four corners: is any of the body under it?)
        const q = [0, 2, 6, 4].map((k) => [h.pts[k * 3], h.pts[k * 3 + 2]]);
        let off = -Infinity;
        for (let k = 0; k < 4; k++) {
          const [ax, az] = q[k], [bx, bz] = q[(k + 1) % 4], l = Math.hypot(bx - ax, bz - az);
          off = Math.max(off, Math.abs(((bx - ax) * (feet[2] - az) - (bz - az) * (feet[0] - ax)) / l) * (Math.sign((bx - ax) * (feet[2] - az) - (bz - az) * (feet[0] - ax)) === Math.sign((bx - ax) * (q[(k + 2) % 4][1] - az) - (bz - az) * (q[(k + 2) % 4][0] - ax)) ? -1 : 1));
        }
        if (off < 0.3 && y < T.deck - 0.3) assert.ok(h.pts[1] - feet[1] > 1.72, `${tw.name}: a head meets the platform ${a} degrees up the stair (${(h.pts[1] - feet[1]).toFixed(2)} m of room)`);
      }
    }
    // through the door, from the terrace to the middle of the floor
    const d = (tw.door * Math.PI) / 180;
    for (let r = T.r + 0.8; r >= 0; r -= 0.15) assert.equal(fouls([tw.cx + Math.cos(d) * r, 0.1, tw.cz + Math.sin(d) * r]), null, `${tw.name}: its door is not clear ${r.toFixed(2)} m out`);
  }
});

ok('the ways in are open: the gate from the ramp, the two doors of the keep, the breach from its rubble, the scaffold onto the wall', () => {
  const line = (a: V3, b: V3, what: string) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    for (let s = 0; s <= len; s += 0.1) {
      const hit = fouls([a[0] + ((b[0] - a[0]) * s) / len, a[1] + ((b[1] - a[1]) * s) / len + 0.02, a[2] + ((b[2] - a[2]) * s) / len]);
      assert.equal(hit, null, `${what}: a body ${s.toFixed(1)} m along is in the ${hit}`);
    }
  };
  const gz = (C.gate.z0 + C.gate.z1) / 2, rampFoot = C.hx + C.parapet.thick / 2 + Math.sqrt(C.ramp.len ** 2 - C.ramp.drop ** 2);
  line([rampFoot, -C.ramp.drop + 0.1, gz], [C.hx + 0.4, 0.1, gz], 'up the ramp');
  line([C.hx + 0.4, 0.1, gz], [C.hx - 2.5, 0.1, gz], 'through the gate');
  line([K.x1 + 1.5, 0.1, 0], [K.room.x1 - 1, 0.1, 0], 'the small door of the keep');
  line([K.x1 + 0.8, K.floors[1] + 0.02, 0], [K.room.x1 - 1, K.floors[1] + 0.02, 0], 'the doorway of the hall');
  line([-4.5, 0, -C.hz - 2], [-4.5, 0.1, -C.hz + 2.5], 'through the breach');
  line([-1.3, K.band + 0.02, K.z1 + 1], [-1.3, K.band + 0.02, K.room.z1 - 0.6], 'from the scaffold onto the keep');
  // the rock's top is where the ramp lands, and is level there
  for (const [x, z] of [[rampFoot + 0.5, gz], [rampFoot + 2.5, gz - 1], [rampFoot + 4, gz + 1]]) within(moundTop('outcrop', x, z), OUTCROP.top - 0.1, OUTCROP.top + 0.1, 'the rock at the foot of the ramp');
});

// ---- what is in it

ok('what lies in it lies where a hand can reach: on a floor, on a table, on a shelf, never in a wall', () => {
  const loot = castleLoot(P), inside = loot.filter((l) => inCastle(P, l.x, l.y, l.z));
  assert.ok(inside.length >= 36 && loot.length - inside.length >= 5, `${inside.length} in the fort, ${loot.length - inside.length} in its grounds`);
  assert.ok(loot.every((l) => l.building === 'castle' && l.usage.length > 0));
  // three steps of the map in one place, and the way from the first to the last is up: the houses, the fort, what is high in it
  for (const l of loot) assert.equal(l.tier, !inCastle(P, l.x, l.y, l.z) ? CASTLE_TIERS.grounds : l.y - P.y >= 4.5 ? CASTLE_TIERS.high : CASTLE_TIERS.fort);
  const high = loot.filter((l) => l.tier === CASTLE_TIERS.high);
  assert.ok(high.length >= 12 && high.length <= 18 && high.some((l) => l.arms === 'guns'), `${high.length} places of the high step`);
  assert.equal(loot.filter((l) => l.arms === 'guns').length, 1);
  assert.ok(inside.every((l) => l.usage.includes('Military')) && loot.filter((l) => !inCastle(P, l.x, l.y, l.z)).every((l) => l.usage.includes('Hunting')));
  for (const l of inside) {
    const [x, z, y] = castleLocal(P, l.x, l.y, l.z);
    // (a hand's breadth over where it lies there is nothing: furniture stands in what stops a body, so the look is from just over it)
    for (const s of boxes) if (!s.feet && !/table|rack|bunk|bench/.test(s.name)) assert.ok(clear(s, [x, y + 0.12, z]) > 0.02, `a thing at ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)} is in the ${s.name}`);
    if (l.surf) assert.ok(FURNITURE.some((f) => Math.abs(f.y + (f.kind === 'table' ? 0.8 : f.kind === 'rack' ? 0.995 : 0.46) - y) < 0.01));
  }
  // no two in one place
  for (let i = 0; i < loot.length; i++) for (let j = i + 1; j < loot.length; j++) assert.ok(Math.hypot(loot[i].x - loot[j].x, loot[i].y - loot[j].y, loot[i].z - loot[j].z) > 0.3);
});

ok('its loose pieces go where they are put, and what is theirs goes with them', () => {
  const loose = castleLoose(P), back = looseLocal(P, loose);
  back.forEach((l, i) => assert.ok(Math.hypot(l.x - LOOSE[i].x, l.z - LOOSE[i].z) < 1e-9 && Math.abs(l.rot - LOOSE[i].rot) < 1e-9));
  assert.equal(loose.filter((l) => l.kind === 'house').length, 5);
  // the houses moved a long way off, on ground of the world's own: their things and their dead go with them
  const moved = loose.map((l) => (l.kind === 'house' ? { ...l, x: l.x + 400, z: l.z - 250 } : l)), flat = () => 77;
  const far = castleLoot(P, flat, moved).filter((l) => l.usage.includes('Hunting'));
  assert.ok(far.length >= 5 && far.every((l) => Math.abs(l.y - 77.04) < 0.01 && Math.hypot(l.x - P.x, l.z - P.z) > 300));
  assert.ok(castleProps(P, flat, moved).filter((p) => Math.hypot(p.x - P.x, p.z - P.z) > 300).length === 2);
  const homes = castleHomes(P, moved);
  assert.ok(homes.length === 2 && Math.hypot(homes[0].x - P.x, homes[0].z - P.z) > 300 && homes[1].inside!.every((s) => inCastle(P, ...s)));
  // with no houses there is still the fort
  assert.equal(castleHomes(P, []).length, 1);
  assert.ok(castleLoot(P, flat, []).every((l) => inCastle(P, l.x, l.y, l.z)));
  // and the shapes follow: nothing of a house where the houses were, when there are none
  const bare = castleShape(castleGround, []);
  assert.ok(Math.max(...bare.near.stone.pos.filter((_, i) => i % 3 === 0)) < 30);
  assert.ok(castleShape(castleGround, [], false).near.rock.pos.length === 0);
});

ok('its fires and what stands in it are in it', () => {
  const lamps = castleLamps(P);
  assert.ok(lamps.length >= 5 && lamps.every((l) => inCastle(P, ...l)));
  const props = castleProps(P).filter((p) => inCastle(P, p.x, p.y + 0.3, p.z));
  assert.ok(props.length >= 14);
  for (const p of props) {
    const [x, z, y] = castleLocal(P, p.x, p.y, p.z);
    for (const s of boxes) if (!s.feet && !/terrace|floor|roof/.test(s.name)) assert.ok(clear(s, [x, y + 0.3, z]) > 0.05, `the ${p.kind} at ${x.toFixed(1)}, ${z.toFixed(1)} stands in the ${s.name}`);
  }
});

console.log(`castle: ${n} checks passed`);
