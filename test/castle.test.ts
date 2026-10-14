// Checks of the fort on the mountain: its measurements against the real one's (src/sim/castle.ts), its shapes by
// numbers (src/world/castle-shape.ts: nothing drawn, nothing run), that a body has room on every stair, and that
// what lies in it lies somewhere a hand can reach. `npx tsx test/castle.test.ts`.

import assert from 'node:assert/strict';
import { KIT_LEVELS, KIT_MERLON, cutBox, inCut, kitMatrix, kitPoint, kitSolids } from '../src/sim/kit';
import { HOUSES, castleDoor, castleKit } from '../src/sim/castle';
import { CASTLE, CASTLE_SCALE, CASTLE_TIERS, FURNITURE, LOOSE, OUTCROP, POSTERN, UNDER, castleAt, castleCuts, castleDark, castleGround, castleHomes, castleLamps, castleLocal, castleLoose, castleLoot, castleParts, castleProps, castleUnder, hatchLine, hatchWell, inCastle, looseLocal, looseParts, moundTop, squareTouches, stairShare, towerRadius, type Flight, type Place, type Tower, type V3 } from '../src/sim/castle';
import { postProps } from '../src/sim/castle-post';
import { PAINTS, PICTURES, SHEETS, STUFF, castleShape, type Sheet, type Skin, type Solid } from '../src/world/castle-shape';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};
const within = (v: number, lo: number, hi: number, what: string) => assert.ok(v >= lo - 1e-9 && v <= hi + 1e-9, `${what}: ${v.toFixed(3)} is not in ${lo}..${hi}`);

const P: Place = { x: 310, y: 240, z: -415, rot: 0.7 };
const parts = castleParts(), shape = castleShape();
// (the flights of the fort, and the steps of its hatch: a loose piece, but its stair is a stair)
const towers = parts.filter((p): p is Tower => p.t === 'tower'), flights = [...parts, ...LOOSE.flatMap((l) => looseParts(l))].filter((p): p is Flight => p.t === 'flight');
const stump = (tw: Tower) => /south-east/.test(tw.name ?? '');
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
  // the towers: 5.4 to 6.3 across at the top; their feet are the kit's round tower, nine metres across at the ground
  // and seven where the drum stands on it; the walls are the kit's, leaning at eighty-two degrees
  within(towerRadius(0) * 2, 5.4, 6.3, 'a tower across at the top');
  within(towerRadius(C.foot.south) * 2, 8.6, 9.2, 'a tower across at the ground');
  within(towerRadius(-0.01) * 2, 6.9, 7.3, "a tower's foot across at the terrace");
  within((Math.atan(C.lean) * 180) / Math.PI, 81, 83.5, 'the lean of the walls');
  for (const tw of towers) {
    // (one of them is a stump: it came down on a slant, and stands a third lower than the others)
    if (stump(tw)) within(Math.max(...tw.rim), 4.4, 5.9, "the top of the stump's rim");
    else within(Math.max(...tw.rim), 6, 7.2, 'the top of a rim');
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
  // the walls are the kit's: one length of its wall to a side, its walk level with the paving, a parapet a pace
  // thick and knee high with merlons a man's chest high on it; the paving between it and the keep 2.4 to 3.4 m wide
  const kit = castleKit(), walls = kit.filter((p) => / wall$/.test(p.name ?? '') && p.id === 'fort_wall_thin_straight_01');
  assert.equal(walls.length, 4);
  for (const w of walls) {
    assert.ok(Math.abs(w.at[1] + KIT_LEVELS.walk) < 1e-9, `${w.name}: its walk is not level with the paving`);
    // (its two ends are in the feet of the towers it runs between)
    const m = kitMatrix(w);
    for (const end of [kitPoint(m, [1.3, KIT_LEVELS.walk, 0]), kitPoint(m, [1.3, KIT_LEVELS.walk, 14.82])]) assert.ok(towers.some((tw) => Math.hypot(end[0] - tw.cx, end[2] - tw.cz) < towerRadius(-0.01) - 0.3), `${w.name}: an end of it is not in a tower`);
    // (it is a ruin: something is broken out of its top, and at least one of its four merlons still stands whole)
    assert.ok((w.cut ?? []).length >= 1, `${w.name}: nothing is gone from it`);
    let stand = 0;
    for (let k = 0; k < 4; k++) if (!(w.cut ?? []).some((c) => [0.2, 1.1, 2.1].some((d) => inCut(c, kitPoint(m, [1.5, KIT_LEVELS.merlon - 0.3, KIT_MERLON.from + k * KIT_MERLON.every + d]))))) stand++;
    assert.ok(stand >= 1 && stand <= 3, `${w.name}: ${stand} of its merlons stand`);
  }
  for (const walk of [C.hx + C.parapet.thick / 2 - 1.06 - K.x1, K.x0 + C.hx + C.parapet.thick / 2 - 1.06, C.hz + C.parapet.thick / 2 - 1.06 - K.z1]) within(walk, 2.4, 4.4, 'the terrace walk');
  // the gatehouse stands on the east wall over the head of the ramp, and the door is in it
  const gate = kit.find((p) => p.id === 'fort_wall_thin_gate_01')!;
  assert.ok(gate && gate.at[1] === 0 && castleDoor().length === 3);
  // the ramp: eight metres long, two and a half wide, ten degrees, to a gap of two and a half metres
  assert.equal(C.ramp.len, 8);
  within((Math.asin(C.ramp.drop / C.ramp.len) * 180) / Math.PI, 9.5, 10.5, 'the slope of the ramp');
  within(C.gate.z1 - C.gate.z0, 2.4, 2.6, 'the gate');
  // (the kit can be cut: a block of a wall with a piece broken out of it is in pieces that are still inside it, and none of them in the cut)
  const cutWall = kitSolids([{ id: 'fort_wall_thin_straight_01', at: [0, 0, 0], cut: [cutBox(-1, 4, 2, 9, 5, 8)] }]), whole = kitSolids([{ id: 'fort_wall_thin_straight_01', at: [0, 0, 0] }]);
  assert.ok(cutWall.length > whole.length && cutWall.every((q) => q.t === 'box' && !(q.c[1] > 2.3 && q.c[2] > 5.3 && q.c[2] < 7.7)), `${cutWall.length} blocks of a cut wall, ${whole.length} of a whole one`);
  // the ground at the foot of each wall, under the terrace
  assert.deepEqual(C.foot, { east: -5.8, west: -6.1, north: -7.3, south: -8 });
});

ok('whoever holds the wall can fight from it: standing he sees over the parapet, crouched behind a merlon he is hidden', () => {
  const eye = { stood: 1.6, crouched: 1.05 }, sill = KIT_LEVELS.parapet - KIT_LEVELS.walk, top = KIT_LEVELS.merlon - KIT_LEVELS.walk;
  // (the kit's parapet is knee high between its merlons, and a merlon is to a man's chest: he shoots over the one and kneels behind the other)
  assert.ok(sill < eye.crouched - 0.2 && top > eye.crouched + 0.3 && top < eye.stood + 0.1);
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
      assert.ok(Math.abs(s.y1 - s.y0 - 1.4) < 0.01);
    }
    // one tower has lost a side nearly to the terrace, on the side of the field; one is a stump, down to a man's
    // waist on the side it fell to and under its own platform nearly all round; the others have wall all round their platforms
    const low = Math.min(...tw.rim);
    if (/south-west/.test(tw.name ?? '')) assert.ok(low < 2.2 && tw.rim.filter((t) => t < T.deck).length >= 4 && tw.rim.filter((t) => t > T.deck + 1).length >= 8, `${tw.name}: its side has not fallen (${low})`);
    else if (stump(tw)) assert.ok(low < 1.6 && tw.rim.filter((t) => t < T.deck).length >= 14 && Math.max(...tw.rim) < Math.max(...towers[0].rim) * 0.9, `${tw.name}: it is no stump (${low})`);
    else assert.ok(low > T.deck + 0.3, `${tw.name}: its platform has no wall at ${low}`);
    // and each has a hole or two where stones have gone, at the eye of whoever stands by it
    for (const g of tw.lost ?? []) assert.ok(g.y1 - g.y0 > 0.6 && g.y0 >= 1.1 && g.y1 < tw.rim[Math.floor(g.a / 15) % 24]);
  }
});

// ---- the shapes

const tris = (k: Skin) => k.pos.length / 9;
/** for each triangle of a skin: its size, whether its corners face the way it does, and how much the picture is stretched on it [least, most] */
function survey(k: Skin, tiles: number[], built = false) {
  let area = 0, off = 0, turned = 0, small = 0, bad = 0;
  for (let t = 0; t < tris(k); t++) {
    const p = [0, 1, 2].map((i) => k.pos.slice(t * 9 + i * 3, t * 9 + i * 3 + 3)), u = [0, 1, 2].map((i) => [k.uv[t * 6 + i * 2], k.uv[t * 6 + i * 2 + 1]]);
    if (![...p.flat(), ...u.flat(), ...k.col.slice(t * 9, t * 9 + 9), ...k.snow.slice(t * 6, t * 6 + 6)].every(Number.isFinite)) bad++;
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
    // (`built`: only what a mason laid. Loose stone lying on a slope has its picture laid on from above, and nobody finds a course in it to see stretched.)
    if (built && Math.abs(g[1]) / twice > 0.3 && Math.abs(g[1]) / twice < 0.9) continue;
    const E = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2], F = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2], G = e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2], det = E * G - F * F;
    const a = (du1 * du1 * G - 2 * du1 * du2 * F + du2 * du2 * E) / det, c = (dv1 * dv1 * G - 2 * dv1 * dv2 * F + dv2 * dv2 * E) / det, b = (du1 * dv1 * G - (du1 * dv2 + du2 * dv1) * F + du2 * dv2 * E) / det;
    const half = (a + c) / 2, d = Math.sqrt(Math.max(0, ((a - c) * (a - c)) / 4 + b * b)), most = Math.sqrt(half + d), least = Math.sqrt(Math.max(0, half - d));
    // (a sheet carries more than one stuff, each with its picture at its own size: a triangle is right if it is right at one of them)
    if (!tiles.some((tile) => most * tile <= 1.25 && least * tile >= 0.8)) off += twice / 2;
  }
  return { area, off, turned, small, bad };
}

/** the sizes the picture of a sheet is laid at: one for each stuff that is drawn on it */
const tilesOf = (p: Sheet) => PAINTS.filter((q) => STUFF[q].sheet === p).map((q) => STUFF[q].tile);

ok('its shapes are sound: every triangle has size, faces the way it says, and is a number', () => {
  for (const [where, skins] of [['near', shape.near], ['under', shape.under]] as [string, Record<Sheet, Skin>][]) for (const p of SHEETS) {
    const s = survey(skins[p], tilesOf(p));
    assert.deepEqual([s.bad, s.turned, s.small], [0, 0, 0], `${where} ${p}: ${s.bad} not numbers, ${s.turned} turned the wrong way, ${s.small} of no size`);
  }
  const f = survey(shape.far, [1]);
  assert.deepEqual([f.bad, f.turned, f.small], [0, 0, 0]);
  // every stuff is on a sheet, and every sheet but iron has a picture
  assert.ok(PAINTS.every((p) => SHEETS.includes(STUFF[p].sheet)));
  assert.deepEqual(SHEETS.filter((p) => !PICTURES[p].tex), ['iron', 'water']);
});

ok('the stone is not stretched: a course is as tall, and a stone as long, at the foot of a leaning tower as at its top', () => {
  // (all but the heads of arches, which are a sliver: under a hundredth of the masonry, and of the timber none at all)
  for (const p of ['stone', 'base', 'timber'] as const) {
    const s = survey(shape.near[p], tilesOf(p), true);
    assert.ok(s.off / s.area < 0.01, `${p}: ${((s.off / s.area) * 100).toFixed(2)} % of it is stretched by more than a quarter`);
  }
});

ok('it is cheap to draw: six things from near, as many again under the terrace while somebody is there, one from far', () => {
  const near = SHEETS.reduce((t, p) => t + tris(shape.near[p]), 0), under = SHEETS.reduce((t, p) => t + tris(shape.under[p]), 0);
  // (seven sheets: six of them from near, and the water with the rest of what is under the terrace)
  assert.ok(SHEETS.length <= 7 && SHEETS.every((p) => tris(shape.near[p]) > 0 || p === 'water') && tris(shape.under.water) > 0 && tris(shape.near.water) === 0);
  assert.ok(near < 70000, `${near} triangles from near`);
  assert.ok(under > 1500 && under < 9000, `${under} triangles under the terrace`);
  assert.ok(tris(shape.far) < 9000 && tris(shape.far) > 1500, `${tris(shape.far)} triangles from far`);
  // from far it is the same outline: as tall, and broken where it is broken (the stump is a stump from far off too)
  const top = (k: Skin, by: (x: number, z: number) => boolean = () => true) => k.pos.reduce((m, v, i) => (i % 3 === 1 && by(k.pos[i - 1], k.pos[i + 1]) ? Math.max(m, v) : m), -Infinity);
  const nearTop = (by?: (x: number, z: number) => boolean) => Math.max(...SHEETS.map((p) => top(shape.near[p], by)));
  assert.ok(Math.abs(top(shape.far) - nearTop()) < 0.3);
  for (const tw of towers) {
    const by = (x: number, z: number) => Math.hypot(x - tw.cx, z - tw.cz) < T.r + 0.3;
    assert.ok(Math.abs(top(shape.far, by) - nearTop(by)) < 0.4, `${tw.name}: from far its top is at ${top(shape.far, by).toFixed(1)}, from near at ${nearTop(by).toFixed(1)}`);
  }
});

ok('snow has somewhere to lie and somewhere it cannot: the sky is over the terrace and the wall tops, and not over anything under them', () => {
  // (the first of the two numbers each corner carries: 1 where the sky is over it)
  let open = 0, shut = 0, lit = 0;
  const k = shape.near.stone;
  for (let i = 0; i < k.pos.length / 3; i++) {
    const [x, y, z] = [k.pos[i * 3], k.pos[i * 3 + 1], k.pos[i * 3 + 2]];
    // the paving of the terrace, out in the open walk
    if (Math.abs(y) < 0.01 && k.nrm[i * 3 + 1] > 0.9 && Math.abs(x) < 9 && Math.abs(z) < 9 && (x < K.x0 - 0.5 || x > K.x1 + 0.5 || z < K.z0 - 0.5 || z > K.z1 + 0.5)) k.snow[i * 2] === 1 ? open++ : shut++;
  }
  assert.ok(open > 400 && shut === 0, `${open} corners of the paving under the sky, ${shut} not`);
  for (const p of SHEETS) {
    const u = shape.under[p];
    for (let i = 0; i < u.pos.length / 3; i++) {
      // (under cover a corner is told how much of the day reaches it, never as much as half: only what is under the sky is told 1)
      assert.ok(u.snow[i * 2] === 1 || u.snow[i * 2] < 0.5, 'a corner under cover is told too much of the day');
      if (u.snow[i * 2] < 0.9) continue;
      // (what of the lower levels the sky is over: under the bay of vault that fell in, under the hole in the walk over the cistern, and at the rent in the east wall)
      const [x, z] = [u.pos[i * 3], u.pos[i * 3 + 2]], B = UNDER.bay, R = UNDER.rent, D = UNDER.cistern.drop;
      assert.ok((x > B.x0 - 0.4 && x < B.x1 + 0.3 && z > B.z0 - 0.2 && z < B.z1 + 0.2) || (x > D.x0 - 0.2 && x < D.x1 + 0.2 && z > D.z0 - 0.2 && z < D.z1 + 0.2) || (x > UNDER.x - 0.8 && z > R.z0 - 0.2 && z < R.z1 + 0.2), `the sky is over ${x.toFixed(1)}, ${z.toFixed(1)} under the terrace`);
      lit++;
    }
  }
  assert.ok(lit > 0);
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
  // (but the hatch, which is dug: its kerb and its passage are made to the depth of the ground where it is set down)
  for (const l of LOOSE) for (const p of looseParts(l)) if (p.t === 'wall' && (l.kind !== 'hatch' || p.name === 'hatch kerb')) assert.ok(l.kind === 'hatch' ? p.y0 <= castleGround(l.x, l.z) - 1 : p.y0 <= -3 && !!p.sits, `${l.kind}: the foot of its ${p.name}`);
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
  // (a rock stops a body as the rock that is drawn, in pieces: 29 to a rock the fort makes, some 200 to a face of scanned
  // rock. Here, with every rock of the plan and six faces of scanned rock, that is the half of the number; where a world
  // has stood it, with its seven rocks and two faces, some 2,200 in all)
  assert.ok(shape.solids.length < 3200 && shape.solids.filter((s) => !/^rock/.test(s.name)).length < 2200, `${shape.solids.length} things to run into`);
  // a flight is a slope and a last tread, both for feet alone; nothing of a slope is steeper than legs go up
  const slopes = boxes.filter((s) => s.feet && /stair|steps|flight|scaffold/.test(s.name) && s.h[1] === 0.04);
  assert.ok(slopes.length >= flights.length * 2);
  for (const f of flights) {
    const run = Math.hypot(f.head[0] - f.foot[0], f.head[2] - f.foot[2]), up = f.head[1] - f.foot[1];
    within((Math.atan2(up, run) * 180) / Math.PI, 20, 42, `${f.name}: how steep`);
    within(up / Math.round(up / 0.2), 0.17, 0.215, `${f.name}: the height of a step`);
  }
  // the ground that is made (the rock, the rubble under the breach, the fallen vault, the stone of the fallen wall) is given as ground is
  assert.equal(shape.solids.filter((s) => s.t === 'field').length, 4);
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
  // (the fort's own: the post's places, which have a `room`, are its own file's to check)
  const loot = castleLoot(P).filter((l) => !('room' in l)), inside = loot.filter((l) => inCastle(P, l.x, l.y, l.z));
  // (2026-10-13, the owner's: what lies in the ruined houses before the gate is the hamlet's, by name, and not the fort's)
  assert.ok(castleLoot(P).length > loot.length && castleLoot(P).every((l) => l.building === 'castle' || l.building === 'hamlet'), 'the places of the post are not among the fort’s');
  assert.ok(inside.length >= 36 && loot.length - inside.length >= 5, `${inside.length} in the fort, ${loot.length - inside.length} in its grounds`);
  assert.ok(loot.every((l) => l.building === (inCastle(P, l.x, l.y, l.z) ? 'castle' : 'hamlet') && l.usage.length > 0));
  // three steps of the map in one place, and the way from the first to the last is up: the houses, the fort, what is high in it
  // (the high step is what is hardest to come at: everything under the terrace, in the dark; and at the very top
  // the rack of guns in the upper room and the wall top over the roof)
  const top = (l: { x: number; y: number; z: number }) => {
    const [x, , y] = castleLocal(P, l.x, l.y, l.z);
    // (a rack's shelf is a body's height over its floor, whatever the fort's scale: 0.995 m of the world)
    return y < -0.5 || (Math.abs(y - 5.85 - 0.995 / CASTLE_SCALE) < 0.02 && x > 2.2) || Math.abs(y - K.band) < 0.05;
  };
  for (const l of loot) assert.equal(l.tier, !inCastle(P, l.x, l.y, l.z) ? CASTLE_TIERS.grounds : top(l) ? CASTLE_TIERS.high : CASTLE_TIERS.fort, `a thing at ${castleLocal(P, l.x, l.y, l.z).map((v) => v.toFixed(1))}`);
  const high = loot.filter((l) => l.tier === CASTLE_TIERS.high), deep = high.filter((l) => l.y < P.y - 0.5);
  // (the vaults are the richest of it: the armoury, whose five racks always have a gun on them, and the aid post, which has what a dressing station had)
  const arms = loot.filter((l) => l.arms === 'guns'), medic = loot.filter((l) => l.usage.includes('Medic'));
  // (2026-10-13, the owner: "castle is T4 loot": the fort's own step is the high one now, so every place in it is of the high step; there were 30 to 38 when the fort's step was the third)
  assert.ok(CASTLE_TIERS.fort === CASTLE_TIERS.high && high.length === inside.length && deep.length >= 27 && arms.length === 6 && arms.filter((l) => l.y < P.y - 0.5).length === 5 && medic.length === 10, `${high.length} places of the high step, ${deep.length} of them under the terrace; ${arms.length} that always hold a gun; ${medic.length} of the aid post's`);
  assert.ok(deep.every((l) => castleUnder(P, l.x, l.y + 0.5, l.z)) && medic.every((l) => l.y < P.y - 0.5 && castleLocal(P, l.x, l.y, l.z)[1] > 5.5));
  assert.ok(inside.every((l) => l.usage.includes('Military') || l.usage.includes('Medic')) && loot.filter((l) => !inCastle(P, l.x, l.y, l.z)).every((l) => l.usage.includes('Hunting')));
  for (const l of inside) {
    const [x, z, y] = castleLocal(P, l.x, l.y, l.z);
    // (a hand's breadth over where it lies there is nothing: furniture stands in what stops a body, so the look is from just over it)
    for (const s of boxes) if (!s.feet && !/table|rack|bunk|bench/.test(s.name)) assert.ok(clear(s, [x, y + 0.12, z]) > 0.02, `a thing at ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)} is in the ${s.name}`);
    // (the board it lies on is a body's: so many metres of the world over its floor, and the thing within the board as it is drawn)
    if (l.surf) assert.ok(FURNITURE.some((f) => Math.abs(f.y + (f.kind === 'table' ? 0.8 : f.kind === 'rack' ? 0.995 : 0.46) / CASTLE_SCALE - y) < 0.01));
    if (l.surf) {
      const dx = l.x - l.surf.x, dz = l.z - l.surf.z, c = Math.cos(l.surf.rot), s = Math.sin(l.surf.rot);
      assert.ok(Math.abs(dx * c - dz * s) < l.surf.hx - 0.1 && Math.abs(dx * s + dz * c) < l.surf.hz + 1e-6, `a thing at ${x.toFixed(1)}, ${z.toFixed(1)} is off its board`);
    }
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
  const far = castleLoot(P, flat, moved).filter((l) => !('room' in l) && l.usage.includes('Hunting'));
  assert.ok(far.length >= 5 && far.every((l) => Math.abs(l.y - 77.04) < 0.01 && Math.hypot(l.x - P.x, l.z - P.z) > 300), 'what lies in the houses did not go with them');
  // (two things of the fort's own stand in the houses; what the post stood by them goes with them as well, and is its own file's to count)
  const gone = (list: { x: number; z: number }[]) => list.filter((p) => Math.hypot(p.x - P.x, p.z - P.z) > 300).length;
  assert.ok(gone(castleProps(P, flat, moved)) - gone(postProps(P, flat, moved)) === 2, `${gone(castleProps(P, flat, moved)) - gone(postProps(P, flat, moved))} things of the fort's own went with the houses`);
  const homes = castleHomes(P, moved);
  // (the infected of the fort itself have the dark under the terrace, and nothing over it)
  // (one of the village's to each house, and with the house wherever it is put; the garrison's are four, on the open ground
  // before the gate. None of them is given a place under the fort or in it: there they walked into walls. See `castleHomes`.)
  const gateHome = homes[homes.length - 1], village = homes.slice(0, -1);
  assert.ok(village.length === 5 && village.every((h) => h.n === 1 && h.r < 8 && Math.hypot(h.x - P.x, h.z - P.z) > 300) && gateHome.n === 4, 'the dead of the fort are not where they belong');
  assert.ok(homes.every((h) => !h.inside), 'one of the infected is given a place indoors');
  for (const h of castleHomes(P)) for (let a = 0; a < 16; a++) for (const r of [0, h.r * 0.5, h.r]) {
    // (wherever one of them is stood there is open ground: not in the fort, not under it, and no stone of the fort over the spot at a body's height)
    const x = h.x + Math.cos(a * 0.3927) * r, z = h.z + Math.sin(a * 0.3927) * r, [lx, lz] = castleLocal(P, x, 0, z), y = P.y + castleGround(lx, lz);
    // (but at the head of the hatch's steps, which is open ground with a way down in it: the first house's are by it)
    const hatch = LOOSE.find((l) => l.kind === 'hatch')!, byHatch = Math.hypot(lx - hatch.x, lz - hatch.z) < 4;
    assert.ok(!inCastle(P, x, y + 0.9, z) && (byHatch || !castleUnder(P, x, y + 0.2, z)), `one of the infected would be stood in the fort or under it, at ${lx.toFixed(1)}, ${lz.toFixed(1)}`);
  }
  // with no houses there is still the fort
  assert.equal(castleHomes(P, []).length, 1, 'with no houses there are still the four before the gate');
  assert.ok(castleLoot(P, flat, []).every((l) => inCastle(P, l.x, l.y, l.z)), 'with no houses a thing still lies outside the fort');
  // and the shapes follow: nothing of a house where the houses were, when there are none
  const bare = castleShape(castleGround, []);
  assert.ok(Math.max(...bare.near.stone.pos.filter((_, i) => i % 3 === 0)) < 30);
  // (nor of the hatch: with none set down there is no passage)
  // (two cuts are left: the slot of the stair down, and the lower levels' own plan, which lowers nothing where the hill is as low as the fort assumes)
  assert.ok(!bare.solids.some((q) => /hatch|passage (floor|roof|wall)$/.test((q as { name: string }).name)) && castleCuts(P, undefined, []).length === 2);
  assert.ok(castleShape(castleGround, [], false).near.rock.pos.length === 0);
});

ok('its fires and what stands in it are in it', () => {
  const lamps = castleLamps(P);
  // (its own, in it; and one at each bend of the passage out, which are under the ground on the way to the hatch)
  assert.ok(lamps.length >= 9 && lamps.every((l) => inCastle(P, ...l) || castleUnder(P, l[0], l[1] - 0.5, l[2])) && lamps.filter((l) => !inCastle(P, ...l)).length === 2, `${lamps.length} fires`);
  // (the fort's own: what the post stood is its own file's to check)
  const posts = new Set(postProps(P).map((q) => `${q.kind} ${q.x.toFixed(2)} ${q.y.toFixed(2)} ${q.z.toFixed(2)}`));
  assert.ok(posts.size > 0 && castleProps(P).length > posts.size, 'what the post stood is not among the fort’s things');
  const props = castleProps(P).filter((p) => !posts.has(`${p.kind} ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}`) && inCastle(P, p.x, p.y + 0.3, p.z));
  assert.ok(props.length >= 14, 'too few things stand in the fort');
  for (const p of props) {
    const [x, z, y] = castleLocal(P, p.x, p.y, p.z);
    for (const s of boxes) if (!s.feet && !/terrace|floor|roof/.test(s.name)) assert.ok(clear(s, [x, y + 0.3, z]) > 0.05, `the ${p.kind} at ${x.toFixed(1)}, ${z.toFixed(1)} stands in the ${s.name}`);
  }
});

// ---- under the terrace: THE VAULTS

/** whether a body with its feet at a spot is in the foot of a tower: a cone, or (the hollow one) a round wall with a doorway in it */
function inFoot(feet: V3) {
  const rin = T.r - T.wall;
  for (const tw of towers) {
    const r = Math.hypot(feet[0] - tw.cx, feet[2] - tw.cz), a = (Math.atan2(feet[2] - tw.cz, feet[0] - tw.cx) * 180) / Math.PI;
    for (let y = 0.34; y <= 1.43; y += 0.27) {
      const h = feet[1] + y;
      if (h > 0) continue;
      if (tw.hollow === undefined || h < tw.hollow) {
        if (r < towerRadius(h) + 0.29) return tw.name!;
      } else if (r > rin - 0.29 && r < towerRadius(h) + 0.29) {
        const off = Math.abs(((((a - tw.door) % 360) + 540) % 360) - 180), room = 11.25 - (Math.asin(Math.min(1, 0.29 / r)) * 180) / Math.PI;
        if (!(off < room && h + 0.29 < tw.hollow + 2.2)) return tw.name!;
      }
    }
  }
  return null;
}
const UF = UNDER.floor, PS = UNDER.postern, CI = UNDER.cistern, CELL = 0.15;
/** the blocks a body on the lower levels' floor could meet */
const lowBoxes = boxes.filter((q) => !q.feet && q.c[1] - Math.hypot(...q.h) < UF + 1.8 && q.c[1] + Math.hypot(...q.h) > UF && Math.abs(q.c[0]) < 16 && Math.abs(q.c[2]) < 16);
const free = [new Map<number, boolean>(), new Map<number, boolean>()];
/** whether a body can be on the lower levels' floor at a square of it: standing, or (`low`) crouched */
function stands(i: number, j: number, low: boolean) {
  const key = i * 4096 + j, known = free[low ? 1 : 0];
  let v = known.get(key);
  if (v === undefined) {
    const x = i * CELL, z = j * CELL, feet: V3 = [x, UF + 0.02, z];
    // (there is floor: inside the outer walls but for the slot of the stair down, and in the round cellar of the hollow tower)
    const floor = (Math.abs(x) < UNDER.x + 0.3 && Math.abs(z) < UNDER.z + 0.3 && !(x > PS.x0 - 0.3 && x < PS.x1 + 0.3 && z > PS.head - 0.1 && z < PS.end + 0.3)) || towers.some((tw) => tw.hollow !== undefined && Math.hypot(x - tw.cx, z - tw.cz) < T.r + 1.2);
    // (and where the stone of the fallen vault lies more than a step deep there is no floor to be on: that is the slope up to the terrace)
    const heaped = x > -UNDER.x - 0.2 && x < UNDER.crawl + 0.4 && z > UNDER.bay.z0 - 0.7 && z < UNDER.bay.z1 + 0.9 && moundTop('vault', x, z) > UF + 0.45;
    v = floor && !heaped && inFoot(feet) === null && !lowBoxes.some((q) => (low ? [0.34, 0.61, 0.82] : [0.34, 0.61, 0.88, 1.15, 1.42]).some((y) => clear(q, [x, feet[1] + y, z]) < 0.29));
    known.set(key, v);
  }
  return v;
}
/** every square of the floor a body can get to from a spot, with some of it shut (`shut`: a way that is tried without); `low`: crouching where it must */
function reach(from: [number, number], low: boolean, shut: (x: number, z: number) => boolean = () => false) {
  const start: [number, number] = [Math.round(from[0] / CELL), Math.round(from[1] / CELL)], seen = new Set<number>(), todo = [start];
  assert.ok(stands(start[0], start[1], low), `nobody can stand at ${from}`);
  seen.add(start[0] * 4096 + start[1]);
  while (todo.length) {
    const [i, j] = todo.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj, key = a * 4096 + b;
      if (seen.has(key) || !stands(a, b, low) || shut(a * CELL, b * CELL)) continue;
      seen.add(key);
      todo.push([a, b]);
    }
  }
  return (x: number, z: number, within = 0.2) => {
    for (let a = Math.floor((x - within) / CELL); a <= Math.ceil((x + within) / CELL); a++) for (let b = Math.floor((z - within) / CELL); b <= Math.ceil((z + within) / CELL); b++) if (seen.has(a * 4096 + b)) return true;
    return false;
  };
}
/** a spot in each of the four sides, which are a ring; and in each place that is off the ring */
const ROOMS: Record<string, [number, number]> = { 'the cistern': [-1, -5.1], 'the sally port': [6.45, -1.0], 'the aid post': [2, 5.95], 'the west side': [-7.2, -3.4] };
const ENDS: Record<string, [number, number]> = { 'the armoury': [0.3, 0.2], 'the nook past the fallen vault': [-7.2, 6.5], 'the cellar in the tower': [-C.hx - 0.9, -C.hz + 0.9], 'the first cell': [-2.1, 7.25], 'the second cell': [0.3, 7.25], 'the third cell': [2.7, 7.25], 'the foot of the stair from the store': [2.7, -2.9] };
/** the armoury's one door */
const GRILLE: [number, number, number, number] = [-1.9, -0.3, UNDER.mid.z1 - 0.1, K.z1 + 0.1];
const inBox = ([x0, x1, z0, z1]: [number, number, number, number]) => (x: number, z: number) => x > x0 && x < x1 && z > z0 && z < z1;

ok('the vaults: every part is come at on foot, the armoury by its one door, and nobody has to crouch but to pass the fallen vault', () => {
  const got = reach(ROOMS['the cistern'], false);
  // (standing: all of it but the west side south of its fallen vault, which is come at from the aid post)
  for (const [name, at] of [...Object.entries(ROOMS), ...Object.entries(ENDS)]) assert.ok(got(...at), `nobody gets from the cistern to ${name}`);
  // the head of the stair down to the sally port, the foot of the fallen vault, the rent in the east wall, the postern's doorway
  for (const [name, at] of [['the stair to the passage', [(PS.x0 + PS.x1) / 2, PS.head - 0.45]], ['the fallen vault', [-7.7, UNDER.bay.z0 - 0.3]], ['the rent', [UNDER.rent.in - 0.4, (UNDER.rent.z0 + UNDER.rent.z1) / 2]], ['the postern', [-UNDER.x + 0.4, (UNDER.goat.z0 + UNDER.goat.z1) / 2]]] as [string, [number, number]][]) assert.ok(got(...at), `nobody gets from the cistern to ${name}`);
  // every thing that lies down there lies within reach of somewhere a body stands (but what is on the landing of the passage, a level lower)
  for (const l of castleLoot(P)) {
    const [x, z, y] = castleLocal(P, l.x, l.y, l.z);
    if (y < -0.5 && y > UF - 0.5) assert.ok(got(x, z, 0.75), `nobody reaches the thing at ${x.toFixed(1)}, ${z.toFixed(1)}`);
  }
  // the armoury is a dead end on purpose: shut its grille and nobody is in it
  assert.ok(!reach(ROOMS['the cistern'], true, inBox(GRILLE))(...ENDS['the armoury']), 'the armoury has another way in');
  // and no other dead end is deeper than a room: from the far end of each, the ring is no more than ten metres off
  for (const [name, at] of Object.entries(ENDS)) assert.ok(Object.values(ROOMS).some((r) => Math.hypot(r[0] - at[0], r[1] - at[1]) < 10.5), name);
});

ok('the vaults are a ring: shut any one of its five narrows and the four sides are still joined; shut them all and they are not', () => {
  const ways: Record<string, [number, number, number, number]> = {
    "the cistern's east end": [CI.x1 - 0.25, CI.x1 + 0.25, -9, CI.z1 + 0.05], 'the south-east corner': [K.x1, 9, 5.05, 5.45], 'the south-west corner': [K.x0 - 0.45, K.x0 - 0.05, 5.45, 9],
    'the way past the fallen vault': [UNDER.crawl, K.x0 + 0.05, 1.6, 2.0], "the cistern's west end": [-9, K.x0 + 0.05, CI.z1 + 0.05, CI.z1 + 0.45],
  };
  for (const [name, box] of Object.entries(ways)) {
    const got = reach(ROOMS['the cistern'], true, inBox(box));
    for (const [room, at] of Object.entries(ROOMS)) assert.ok(got(...at), `with ${name} shut nobody gets from the cistern to ${room}`);
  }
  const alone = reach(ROOMS['the cistern'], true, (x, z) => Object.values(ways).some((b) => inBox(b)(x, z)));
  assert.ok(!alone(...ROOMS['the sally port']) && !alone(...ROOMS['the aid post']) && !alone(...ROOMS['the west side']));
  // (the way past the fallen vault is crouched through: standing, the west side is in two)
  assert.ok(!reach(ROOMS['the west side'], false, inBox(ways["the cistern's west end"]))(...ROOMS['the cistern']));
});

ok('the ways down and the ways out: a body has room down each of them, and all the way to the hatch in the village', () => {
  const body = (feet: V3, low = false) => {
    for (const q of boxes) {
      if (q.feet) continue;
      for (const y of low ? [0.34, 0.61, 0.82] : [0.34, 0.61, 0.88, 1.15, 1.42]) if (clear(q, [feet[0], feet[1] + y, feet[2]]) < 0.29) return q.name;
    }
    return inFoot(feet);
  };
  const line = (a: V3, b: V3, what: string, low = false) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    for (let d = 0; d <= len; d += 0.1) {
      const hit = body([a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len + 0.03, a[2] + ((b[2] - a[2]) * d) / len], low);
      assert.equal(hit, null, `${what}: a body ${d.toFixed(1)} m along is in the ${hit}`);
    }
  };
  // 1. the stair from the keep's store (its room on the stair itself is tried with every other flight's): to its head, and from its foot out by the door onto the cistern
  line([UNDER.stair.head - 0.6, 0, -1.6], [UNDER.stair.head - 0.5, 0, UNDER.stair.z], 'to the head of the stair in the store');
  line([2.7, UF, UNDER.stair.z], [2.7, UF, CI.z1 - 0.6], 'from the foot of the stair out onto the cistern');
  // 2. the bay of vault that fell in: its stone is a slope from the floor to the paving, open to the sky all the way, and no steeper than is walked
  const B = UNDER.bay, vx = (-UNDER.x + UNDER.crawl) / 2 - 0.05;
  within((Math.atan2(-0.07 - UF, B.z1 - (B.z0 + 0.5)) * 180) / Math.PI, 25, 33, 'the slope of the fallen vault, which is walked');
  // (its head is AT the south edge of the hole, a step under the paving, and it is gone from under the paving behind that: see the last check)
  within(moundTop('vault', vx, B.z1), -0.071, -0.069, 'the head of the fallen vault, at the edge of the paving');
  assert.ok(moundTop('vault', vx, B.z1 + 0.3) < UF, 'behind its head the fallen vault stands sheer');
  for (let z = B.z0 + 0.6; z < B.z1 - 0.3; z += 0.2) {
    const y = moundTop('vault', vx, z), next = moundTop('vault', vx, z + 0.2);
    assert.ok(Math.abs(next - y) / 0.2 < Math.tan((40 * Math.PI) / 180), `the fallen vault is too steep at ${z.toFixed(1)}`);
    assert.equal(fouls([vx, y + 0.05, z]), null);
  }
  within(moundTop('vault', vx, B.z1 - 0.3), -0.35, -0.05, 'the head of the fallen vault, under the paving');
  within(moundTop('vault', vx, B.z0 + 0.5), UF - 0.2, UF + 0.25, 'its foot, at the floor');
  assert.ok(moundTop('vault', UNDER.crawl + 0.3, 2) < UF, 'the stone of the fallen vault lies in the way past it');
  // 3. the hole in the boards of the north-west tower: a body goes down it into the cellar, and out by the cellar's doorway
  const nw = towers.find((tw) => tw.hollow !== undefined)!;
  assert.equal(nw.hollow, UF);
  for (let y = -0.4; y > UF + 0.5; y -= 0.2) assert.equal(fouls([nw.cx, y, nw.cz]), null, 'down the hole');
  const d = (nw.door * Math.PI) / 180;
  for (let r = 0.9; r < 4.6; r += 0.15) {
    const hit = body([nw.cx + Math.cos(d) * r, UF + 0.03, nw.cz + Math.sin(d) * r]);
    assert.equal(hit, null, `out of the cellar: a body ${r.toFixed(1)} m from its middle is in the ${hit}`);
  }
  // 4. the hole in the terrace walk over the cistern: a drop, clear from the paving to the water
  const D = CI.drop;
  for (let y = -0.3; y > UF - CI.deep + 0.9; y -= 0.2) assert.equal(fouls([D.x1 - 0.4, y, (D.z0 + D.z1) / 2 - 0.15]), null, 'down the hole in the walk');
  // 5. the rent in the east wall: up its stone from the hill and in over the floor
  const R = UNDER.rent, rz = (R.z0 + R.z1) / 2;
  for (let x = 16.6; x > R.in - 0.5; x -= 0.2) {
    const y = Math.max(UF, moundTop('rent', x, rz)), next = Math.max(UF, moundTop('rent', x - 0.2, rz));
    assert.ok(Math.abs(next - y) / 0.2 < Math.tan((40 * Math.PI) / 180), `the fallen wall is too steep at ${x.toFixed(1)}`);
    const hit = body([x, y + 0.2, rz]);
    assert.equal(hit, null, `through the rent: a body at ${x.toFixed(1)} is in the ${hit}`);
  }
  // (its foot is in the hill, and so are its sides, all round: it ends nowhere in the air, and nowhere is it a drop)
  const fan = parts.find((q) => q.t === 'mound' && q.kind === 'rent')!;
  if (fan.t === 'mound') {
    for (let k = 0; k <= 40; k++) for (const [x, z] of [[fan.x1, fan.z0 + ((fan.z1 - fan.z0) * k) / 40], [CASTLE.hx + 1.5 + ((fan.x1 - CASTLE.hx - 1.5) * k) / 40, fan.z0], [CASTLE.hx + 1.5 + ((fan.x1 - CASTLE.hx - 1.5) * k) / 40, fan.z1]]) assert.ok(moundTop('rent', x, z) < castleGround(x, z) + 0.15, `the fallen wall's stone ends in the air at ${x.toFixed(1)}, ${z.toFixed(1)}: ${(moundTop('rent', x, z) - castleGround(x, z)).toFixed(2)} m over the hill`);
    const [fx0, fx1, fz0, fz1] = [fan.x0, fan.x1, fan.z0, fan.z1];
    for (let fx = fx0; fx <= fx1; fx += 0.35) for (let fz = fz0; fz <= fz1; fz += 0.35) assert.ok(moundTop('rent', fx, fz) > UF - 6, 'a drop in the fallen wall');
  }
  // 6. the postern: through the west wall's foot onto its landing (its stair down is tried with every other flight's)
  const gz = (UNDER.goat.z0 + UNDER.goat.z1) / 2;
  line([-UNDER.x + 0.5, UF, gz], [-CASTLE.hx - 1.9, UF, gz], 'out by the postern');
  assert.ok(flights.some((f) => f.name === 'postern stair' && f.foot[1] < castleGround(f.foot[0], f.foot[2]) - 1), "the postern's stair does not go down into the hill");
  // 7. the sally port: down the stair to its landing, along the passage under the wall's foot and round its bends, to the foot of the hatch's steps
  const hatch = LOOSE.find((l) => l.kind === 'hatch')!, g = castleGround(hatch.x, hatch.z), L = hatchLine(hatch, g), H = UNDER.hatch, way = [...L.path].reverse();
  line([(PS.x0 + PS.x1) / 2, PS.deep, PS.foot + 0.2], [(PS.x0 + PS.x1) / 2, PS.deep, POSTERN.z], 'along the landing');
  line([(PS.x0 + PS.x1) / 2, PS.deep, POSTERN.z], [way[0][0] + 0.5, way[0][1], way[0][2]], 'out of the stairwell');
  // (crouched: half way a slab of the roof lies across it, to be gone under. Standing, it stops a body there and nowhere else.)
  for (let k = 0; k + 1 < way.length; k++) line(k === 0 ? [way[0][0] + 0.5, way[0][1], way[0][2]] : way[k], k + 2 === way.length ? [way[k + 1][0] - L.d[0] * 0.5, way[k + 1][1], way[k + 1][2] - L.d[1] * 0.5] : way[k + 1], `along the passage, its ${k + 1}th length from the fort`, true);
  assert.equal(way.length, 5, 'the passage has two bends in it, and a level pace at the foot of the steps');
  const mid: V3 = [(way[1][0] + way[2][0]) / 2, (way[1][1] + way[2][1]) / 2 + 0.03, (way[1][2] + way[2][2]) / 2];
  assert.equal(body(mid), 'fallen roof of the passage');
  assert.equal(body(mid, true), null);
  // (it is no steeper than a floor may be, and neither a cupboard nor a tunnel to another valley)
  assert.ok(Math.abs(L.steep) < 0.2 && L.long > 6 && L.long < 70, `the passage is ${L.long.toFixed(1)} m long and rises ${L.steep.toFixed(2)} in one`);
  assert.ok(Math.abs(L.head[1] - g) < 1e-9 && Math.abs(g - L.foot[1] - H.drop) < 1e-9);
  // what is under the ground by right is known for it: the vaults, the stair, the passage at each of its lengths, the steps; and nothing else is
  const under = (x: number, y: number, z: number) => castleUnder(P, ...castleAt(P, x, z, y));
  for (const [x, y, z] of [[0, UF + 0.9, 0], [6, UF + 0.9, 0], [-1, UF + 0.5, -6], [(PS.x0 + PS.x1) / 2, PS.deep + 0.9, 0], ...way.slice(0, -1).map((a, k): V3 => [(a[0] + way[k + 1][0]) / 2, (a[1] + way[k + 1][1]) / 2 + 0.9, (a[2] + way[k + 1][2]) / 2]), [L.foot[0], L.foot[1] + 0.9, L.foot[2]], [-CASTLE.hx - 0.4, UF + 0.9, gz]]) assert.ok(under(x, y, z), `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)} is not known to be under the fort`);
  for (const [x, y, z] of [[0, 0.9, 0], [7, 0.9, -7], [hatch.x + 6, g - 2, hatch.z - 9], [30, -8, -20], [0, -9, 20], [30, -9, 12]]) assert.ok(!under(x, y, z));
  assert.ok(!castleUnder(null, 0, 0, 0) && castleDark(null, 0, 0, 0) === 0);
  // it is dark down there, and less so where the day gets in; and not dark at all over the terrace
  const dark = (x: number, y: number, z: number) => castleDark(P, ...castleAt(P, x, z, y));
  assert.ok(dark(0.2, UF + 1.6, 1) > 0.75 && dark(-1, UF + 1.6, 6.2) > 0.9 && dark(-7.7, UF + 1.6, 2.5) < 0.35 && dark(7.4, UF + 1.6, rz) < 0.35 && dark(-1, UF + 1.2, -7) < 0.35 && dark(0, 1.6, 0) === 0 && dark(7, 1.6, -7) === 0);
  assert.ok(dark(mid[0], mid[1] + 1, mid[2]) > 0.9 && dark(L.foot[0], L.foot[1] + 1.6, L.foot[2]) < 0.6);
  // what the ground must have done to it: taken away under the slot of the stair, under the hatch's stairwell and along every length of its passage, and nowhere else
  // (and, last of them, the lower levels' own plan, to under their floor: it lowers nothing where the hill is as low as the fort assumes; see `castleCuts`)
  const cuts = castleCuts(P);
  assert.equal(cuts.length, 3 + way.length - 1);
  assert.ok(cuts[cuts.length - 1].to < P.y + CASTLE_SCALE * (UF - CI.deep - 0.5) && cuts[cuts.length - 1].to > P.y + CASTLE_SCALE * C.foot.east, 'the lower levels are cut for deeper than the foot the fort assumes');
  assert.ok(cuts.every((c) => c.well.length === 4) && cuts[0].to < P.y + PS.deep - 0.5 && cuts[1].to < P.y + g - H.drop);
  const lowered = (x: number, z: number) => cuts.some((c) => squareTouches(c.well, Math.floor(x / 2) * 2, Math.floor(z / 2) * 2, 2));
  for (const a of [...way, L.foot, [(L.foot[0] + L.head[0]) / 2, 0, (L.foot[2] + L.head[2]) / 2] as V3]) assert.ok(lowered(castleAt(P, a[0], a[2])[0], castleAt(P, a[0], a[2])[2]), 'the ground is not taken away over the way out');
  for (let k = 0; k + 1 < way.length; k++) for (let t = 0; t <= 1; t += 0.05) for (const side of [-0.7, 0.7]) {
    const e = [way[k + 1][0] - way[k][0], way[k + 1][2] - way[k][2]], len = Math.hypot(e[0], e[1]), x = way[k][0] + e[0] * t + (e[1] / len) * side, z = way[k][2] + e[1] * t - (e[0] / len) * side;
    assert.ok(lowered(castleAt(P, x, z)[0], castleAt(P, x, z)[2]), 'the ground is left standing in the passage');
  }
  assert.ok(!lowered(castleAt(P, hatch.x + 12, 9)[0], castleAt(P, hatch.x + 12, 9)[2]) && !lowered(castleAt(P, -20, 0)[0], castleAt(P, -20, 0)[2]));
  // the earth it lays over that reaches as far as lowering can disturb the ground (a square's corner to corner, twice)
  assert.ok(H.lid >= 2 * Math.SQRT2 * 2);
  // and nothing else that is made stands in its stairwell or in its passage: not the rock, not the fallen wall's stone, not anything of the old village
  const clearOf = (px: number, pz: number, floor: number, open: boolean, where: string) => {
    for (const f of shape.solids) {
      if (f.t !== 'field' || px < f.x0 || px > f.x0 + f.nx * f.cell || pz < f.z0 || pz > f.z0 + f.nz * f.cell) continue;
      const y = f.heights[Math.round((pz - f.z0) / f.cell) * (f.nx + 1) + Math.round((px - f.x0) / f.cell)];
      assert.ok(open ? y < floor - 0.3 : y < floor - 0.25 || y > floor + H.tall + 0.35, `the ${f.name} is in the way of the hatch ${where} (${y.toFixed(1)} where the floor is ${floor.toFixed(1)})`);
    }
    for (const q of boxes) if (/curved wall|rock tooth|wall down the slope|ruined house|ramp trestle/.test(q.name)) assert.ok(clear(q, [px, floor + (open ? 2.5 : 1), pz]) > 0.3, `the ${q.name} stands in the hatch's way ${where}`);
  };
  for (let k = 0; k <= 16; k++) for (const side of [-0.6, 0, 0.6]) clearOf(L.head[0] + L.d[0] * (H.run + 0.5) * (k / 16) + L.r[0] * side, L.head[2] + L.d[1] * (H.run + 0.5) * (k / 16) + L.r[1] * side, g - H.drop, true, 'on its steps');
  for (let k = 0; k + 1 < way.length; k++) for (let t = 0; t <= 1; t += 0.04) for (const side of [-0.6, 0, 0.6]) {
    const e = [way[k + 1][0] - way[k][0], way[k + 1][2] - way[k][2]], len = Math.hypot(e[0], e[1]);
    clearOf(way[k][0] + e[0] * t + (e[1] / len) * side, way[k][2] + e[1] * t - (e[0] / len) * side, way[k][1] + (way[k + 1][1] - way[k][1]) * t, false, `in its passage, ${k + 1}th length from the fort`);
  }
});

ok('the passage out is under the ground all its length: nothing of it stands out of the hill between the walls and the hatch', () => {
  // (its second length climbs two metres: walls level with its upper end from end to end stood a metre out of the
  // ground behind the hatch, and a walker was held by them, 2026-10-13)
  for (const q of boxes) {
    if (!/^passage (wall|roof|floor)$/.test(q.name)) continue;
    const [qx, qy, qz, qw] = q.q;
    for (let i = -1; i <= 1; i += 0.25) for (let k = -1; k <= 1; k += 0.25) {
      const v = [i * q.h[0], q.h[1], k * q.h[2]], t = [2 * (qy * v[2] - qz * v[1]), 2 * (qz * v[0] - qx * v[2]), 2 * (qx * v[1] - qy * v[0])];
      const p = [q.c[0] + v[0] + qw * t[0] + qy * t[2] - qz * t[1], q.c[1] + v[1] + qw * t[1] + qz * t[0] - qx * t[2], q.c[2] + v[2] + qw * t[2] + qx * t[1] - qy * t[0]];
      // (under the fort itself it is under the terrace, not under the hill)
      if (Math.abs(p[0]) < C.hx + 1.6 && Math.abs(p[2]) < C.hz + 1.6) continue;
      assert.ok(p[1] < castleGround(p[0], p[2]) - 0.2, `the ${q.name} at ${p[0].toFixed(1)}, ${p[2].toFixed(1)} stands ${(p[1] - castleGround(p[0], p[2])).toFixed(2)} m over the ground`);
    }
  }
});

ok('under the fort a body is excused only where there is a place to be: in a room, on a stair, in the passage; never in the earth beside one', () => {
  const at = (x: number, z: number, y: number) => castleUnder(P, ...castleAt(P, x, z, y));
  const U = UNDER, CF = UF - CI.deep, hatch = LOOSE.find((l) => l.kind === 'hatch')!, g = castleGround(hatch.x, hatch.z), L = hatchLine(hatch, g);
  // ---- it is: wherever a body can stand on the lower levels' floor (in the cistern its feet are on the cistern's), feet and head
  let stood = 0;
  for (let i = Math.round(-14 / CELL); i <= Math.round(10 / CELL); i++) for (let j = Math.round(-14 / CELL); j <= Math.round(10 / CELL); j++) {
    if (!stands(i, j, true)) continue;
    // (inside the walls, or inside the round of the hollow tower's cellar: `stands` asks only what stops a body, and outside the tower's foot nothing does)
    if (!(Math.abs(i * CELL) < U.x + 0.3 && Math.abs(j * CELL) < U.z + 0.3) && !towers.some((tw) => tw.hollow !== undefined && Math.hypot(i * CELL - tw.cx, j * CELL - tw.cz) < T.r - T.wall)) continue;
    stood++;
    const x = i * CELL, z = j * CELL, floor = x < CI.x1 && z < CI.z1 && Math.abs(x) < U.x && Math.abs(z) < U.z ? CF : UF;
    assert.ok(at(x, z, floor + 0.02) && at(x, z, floor + 1.1), `a body standing at ${x.toFixed(2)}, ${z.toFixed(2)} is not excused`);
  }
  assert.ok(stood > 3000, `only ${stood} squares of floor were asked about`);
  for (const [name, [x, z]] of [...Object.entries(ROOMS), ...Object.entries(ENDS)]) assert.ok(at(x, z, UF + 0.02), `${name} is not a place`);
  // (on the stair from the store to the cistern's door, from a step under the terrace down: nearer the terrace than that a body is over the ground, and nobody asks)
  for (let t = 0.2; t <= 1; t += 0.1) {
    const x = U.stair.head + (U.stair.foot - U.stair.head) * t, y = UF * t;
    assert.ok(y > -0.6 || at(x, U.stair.z, y + 0.02), `on the stair from the store, ${(-y).toFixed(1)} m down`);
  }
  // (down the stair to the sally port, on its landing, and through the doorway to the passage)
  for (let z = PS.head; z <= PS.end; z += 0.25) {
    const y = z < PS.foot ? UF + ((PS.deep - UF) * (z - PS.head)) / (PS.foot - PS.head) : PS.deep;
    for (const x of [PS.x0 + 0.3, (PS.x0 + PS.x1) / 2, PS.x1 - 0.3]) assert.ok(at(x, z, y + 0.02) && at(x, z, y + 1.1), `on the stair to the sally port at z ${z.toFixed(2)}`);
  }
  assert.ok(at(POSTERN.x, POSTERN.z, POSTERN.y + 0.02) && at(POSTERN.x - 0.4, POSTERN.z, POSTERN.y + 0.02), 'in the sally port\'s doorway');
  // (all along the passage, on its floor, at its walls and standing; and down the hatch's steps)
  for (let k = 0; k + 1 < L.path.length; k++) for (let t = 0; t <= 1; t += 0.05) {
    const a = L.path[k], b = L.path[k + 1], len = Math.hypot(b[0] - a[0], b[2] - a[2]), e = [(b[0] - a[0]) / len, (b[2] - a[2]) / len], y = a[1] + (b[1] - a[1]) * t;
    for (const side of [-0.34, 0, 0.34]) assert.ok(at(a[0] + (b[0] - a[0]) * t + e[1] * side, a[2] + (b[2] - a[2]) * t - e[0] * side, y + 0.02) && at(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t, y + 1.1), `in the passage, length ${k + 1}, ${(t * 100).toFixed(0)} % along`);
  }
  for (let t = 0.4; t <= 1; t += 0.1) for (const side of [-0.34, 0, 0.34]) assert.ok(at(L.head[0] + (L.foot[0] - L.head[0]) * t + L.r[0] * side, L.head[2] + (L.foot[2] - L.head[2]) * t + L.r[1] * side, g - U.hatch.drop * t + 0.02), `on the hatch's steps, ${(t * 100).toFixed(0)} % down`);
  assert.ok(at(-U.x - 0.3, (U.goat.z0 + U.goat.z1) / 2, UF + 0.02) && at(-C.hx - 1.6, (U.goat.z0 + U.goat.z1) / 2, UF + 0.02), 'in the postern\'s doorway, and on its landing');
  // ---- it is not: in the earth. Under each floor, by a metre and by three
  for (const [name, [x, z]] of [...Object.entries(ROOMS), ...Object.entries(ENDS)]) for (const d of [1.2, 3, 5.5]) assert.ok(!at(x, z, (name === 'the cistern' ? CF : UF) - d), `${d} m under the floor of ${name} is excused`);
  // (under the landing of the stair down, and under its steps; beside its slot at the landing's depth, which is the earth between the slot and the cistern's side)
  assert.ok(!at((PS.x0 + PS.x1) / 2, PS.end - 0.3, PS.deep - 1.2) && !at((PS.x0 + PS.x1) / 2, PS.head + 1, UF - 2.5), 'under the stair to the sally port');
  assert.ok(!at(PS.x0 - 1.2, 0, PS.deep + 0.5) && !at(0, 0, PS.deep + 0.5) && !at(-5, 6, PS.deep + 0.5) && !at(4, -7, PS.deep + 0.5), 'in the earth under the lower levels, at the depth of the sally port');
  // (and outside the walls: between the fort and the hatch, anywhere that is not the passage: beside it, over its roof, under its floor)
  for (let k = 0; k + 1 < L.path.length; k++) {
    const a = L.path[k], b = L.path[k + 1], len = Math.hypot(b[0] - a[0], b[2] - a[2]), e = [(b[0] - a[0]) / len, (b[2] - a[2]) / len], y = (a[1] + b[1]) / 2, mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2;
    // (the last length runs in under the fort itself: beside it there is the fort's own lower level, which is a place)
    const out = Math.abs(mx) > C.hx + 3 || Math.abs(mz) > C.hz + 3;
    if (len > 3 && out) for (const side of [-1.5, 1.5, -3, 3]) assert.ok(!at(mx + e[1] * side, mz - e[0] * side, y + 0.5), `${Math.abs(side)} m to the side of the passage's length ${k + 1} is excused`);
    // (its first length is a pace of level floor at the foot of the steps, half of it under the open stairwell: over that there is no roof)
    if (out && len > 3) assert.ok(!at(mx, mz, y + U.hatch.tall + 0.9), `over the roof of the passage's length ${k + 1}`);
    if (out) assert.ok(!at(mx, mz, y - 1.2), `under the floor of the passage's length ${k + 1}`);
  }
  // (nor anywhere else about the place: under the terrace's paving outside the walls' plan, under the village, at any depth)
  for (const [x, z] of [[14, 0], [0, 14], [-14, 5], [30, -8], [47, 2.5], [60, -6.6], [54, 12]]) for (const y of [-4, -8, -12, -16]) assert.ok(!at(x, z, y), `in the earth at ${x}, ${z}, ${-y} m under the terrace`);
  // (and it is the same however the ground is asked for, and with no hatch there is no passage to be in)
  assert.ok(castleUnder(P, ...castleAt(P, L.path[2][0], L.path[2][2], L.path[2][1] + 0.5)) && !castleUnder(P, ...castleAt(P, L.path[2][0], L.path[2][2], L.path[2][1] + 0.5), undefined, []), 'the passage is a place with no hatch set down');
  assert.ok(!castleUnder(null, 0, 0, 0));
});

ok('the way underground is closed: from no place in the passage, at the foot of the hatch\'s steps or on the stair down is anything seen but its own floor, walls and roof', () => {
  // (2026-10-13: "the path underground at the base of the stairs is bugged with panels and textures missing". What
  // would have caught it: an eye is put every pace along the way, and looks every way. Each line of sight must end
  // on the FACE of something of the fort's, near by. One that ends on nothing has gone out through a hole; one
  // that ends on the back of a face is looking at a thing from inside it, or through where a panel should be.
  // Where the way is open by design, a lid is laid for the looking: over the hatch's well at the ground, across
  // the doorway between the passage and the stair's slot, and over the slot at the floor of the lower levels.)
  const hatch = LOOSE.find((l) => l.kind === 'hatch')!, g = castleGround(hatch.x, hatch.z), L = hatchLine(hatch, g), H = UNDER.hatch;
  type T3 = [V3, V3, V3];
  const tris: T3[] = [], lids: T3[] = [];
  const box = { x0: Math.min(...L.path.map((q) => q[0])) - 5, x1: Math.max(...L.path.map((q) => q[0])) + 5, z0: Math.min(...L.path.map((q) => q[2]), PS.head) - 5, z1: Math.max(...L.path.map((q) => q[2]), PS.end, hatch.z) + 5 };
  for (const skins of [shape.near, shape.under]) for (const p of SHEETS) {
    const k = skins[p];
    for (let i = 0; i + 8 < k.pos.length; i += 9) {
      const t: T3 = [[k.pos[i], k.pos[i + 1], k.pos[i + 2]], [k.pos[i + 3], k.pos[i + 4], k.pos[i + 5]], [k.pos[i + 6], k.pos[i + 7], k.pos[i + 8]]];
      if (t.every((q) => q[0] < box.x0 || q[0] > box.x1 || q[2] < box.z0 || q[2] > box.z1 || q[1] > 0.5)) continue;
      // (only what is about the way itself: within five metres of its line, on the plan, or about the stair's slot)
      if (!t.some((q) => (q[0] > PS.x0 - 3 && q[0] < PS.x1 + 3 && q[2] > PS.head - 3 && q[2] < PS.end + 3) || L.path.some((a, k) => {
        const b = L.path[k + 1] ?? [L.head[0], 0, L.head[2]], ex = b[0] - a[0], ez = b[2] - a[2], u = Math.min(1, Math.max(0, ((q[0] - a[0]) * ex + (q[2] - a[2]) * ez) / (ex * ex + ez * ez || 1)));
        return Math.hypot(q[0] - a[0] - ex * u, q[2] - a[2] - ez * u) < 5;
      }))) continue;
      // (the earth laid over the cut ground is not of the passage: it is the lid of the world, and the well is open through it)
      if (p !== 'earth') tris.push(t);
    }
  }
  const quad = (q: V3[]) => void lids.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
  quad(hatchWell(hatch, g).map(([x, z]): V3 => [x, g + 0.02, z]));
  quad([[PS.x1 + 0.12, PS.deep - 0.2, POSTERN.z - 1], [PS.x1 + 0.12, PS.deep - 0.2, POSTERN.z + 1], [PS.x1 + 0.12, PS.deep + H.tall + 0.4, POSTERN.z + 1], [PS.x1 + 0.12, PS.deep + H.tall + 0.4, POSTERN.z - 1]]);
  quad([[PS.x0 - 0.4, UF - 0.02, PS.head - 0.6], [PS.x1 + 0.4, UF - 0.02, PS.head - 0.6], [PS.x1 + 0.4, UF - 0.02, PS.end + 0.4], [PS.x0 - 0.4, UF - 0.02, PS.end + 0.4]]);
  /** where a line of sight ends: how far off, and whether on the face of what it meets (a lid counts as a face from either side) */
  const look = (o: V3, d: V3, list: T3[], lid: boolean) => {
    let best = Infinity, front = false;
    for (const [a, b, c] of list) {
      const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const px = d[1] * e2[2] - d[2] * e2[1], py = d[2] * e2[0] - d[0] * e2[2], pz = d[0] * e2[1] - d[1] * e2[0], det = e1[0] * px + e1[1] * py + e1[2] * pz;
      if (Math.abs(det) < 1e-12) continue;
      const tx = o[0] - a[0], ty = o[1] - a[1], tz = o[2] - a[2], u = (tx * px + ty * py + tz * pz) / det;
      if (u < -1e-6 || u > 1 + 1e-6) continue;
      const qx = ty * e1[2] - tz * e1[1], qy = tz * e1[0] - tx * e1[2], qz = tx * e1[1] - ty * e1[0], v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
      if (v < -1e-6 || u + v > 1 + 1e-6) continue;
      const t = (e2[0] * qx + e2[1] * qy + e2[2] * qz) / det;
      if (t > 1e-4 && t < best) (best = t), (front = lid || det > 0);
    }
    return { far: best, front };
  };
  const dirs: V3[] = Array.from({ length: 180 }, (_, k) => {
    const y = 1 - (2 * (k + 0.5)) / 180, r = Math.sqrt(1 - y * y), a = k * 2.399963;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
  const eyes: [string, V3][] = [];
  for (let k = 0; k + 1 < L.path.length; k++) {
    const a = L.path[k], b = L.path[k + 1], len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    for (let u = k === 0 ? 0.3 : 0; u <= len; u += 0.75) for (const up of [0.45, 1.5]) {
      // (not under the slab of the roof that has come down, which is gone under crouched: an eye a man's height up there is in the slab)
      if (up > 1 && L.path.length > 3 && k === 2 && Math.abs(u - len / 2) < 1.6) continue;
      eyes.push([`the passage, length ${k + 1}, ${u.toFixed(1)} m along, ${up} m up`, [a[0] + ((b[0] - a[0]) * u) / len, a[1] + ((b[1] - a[1]) * u) / len + up, a[2] + ((b[2] - a[2]) * u) / len]]);
    }
  }
  // (at the foot of the hatch's steps and on them; and down the stair to the sally port and on its landing)
  // (from where a head is under the ground: higher up the steps it is in the open)
  for (const t of [0.6, 0.8, 0.98]) eyes.push([`the hatch's steps, ${(t * 100).toFixed(0)} % down`, [L.head[0] + (L.foot[0] - L.head[0]) * t, g - H.drop * t + 1.5, L.head[2] + (L.foot[2] - L.head[2]) * t]]);
  // (from where a head is under the lower levels' floor: higher up the stair it is in the east side's own room)
  for (let z = PS.head + 2.2; z <= PS.end - 0.3; z += 0.75) eyes.push([`the stair to the sally port at z ${z.toFixed(1)}`, [(PS.x0 + PS.x1) / 2, (z < PS.foot ? UF + ((PS.deep - UF) * (z - PS.head)) / (PS.foot - PS.head) : PS.deep) + 1.5, z]]);
  let seen = 0;
  for (const [where, o] of eyes) {
    // (what is near enough to matter, once for each eye)
    const near = tris;
    for (const d of dirs) {
      const lid = look(o, d, lids, true), hit = look(o, d, near, false);
      seen++;
      if (lid.far < hit.far) continue;
      assert.ok(hit.far < 60, `from ${where} a line of sight toward ${d.map((v) => v.toFixed(2))} ends on nothing: a hole`);
      assert.ok(hit.front, `from ${where} a line of sight toward ${d.map((v) => v.toFixed(2))} ends, ${hit.far.toFixed(2)} m off, on the back of a face: a panel is missing, or it is seen from inside`);
    }
  }
  assert.ok(eyes.length > 120 && seen > 20000, `only ${eyes.length} eyes looked`);
  // (and every face made has a picture: every sheet but the iron and the water)
  for (const p of SHEETS) assert.ok(p === 'iron' || p === 'water' || !!PICTURES[p].tex, `the ${p} sheet has no picture`);
});

// ---- where a way up meets the next level (2026-10-14, played: "gaps at the top of the ramps and stairs of the castle
// where they dont meet flush with the next level"). Asked straight down, every centimetre, across each joint.
const fields = shape.solids.filter((s): s is Extract<Solid, { t: 'field' }> => s.t === 'field');
/** the top of what stops a body under a spot, no higher than `from`: blocks (rails left out) and made ground */
function standsAt(x: number, z: number, from: number, deep = 0.9): number | null {
  const near = boxes.filter((s) => !/rail/.test(s.name) && Math.hypot(s.c[0] - x, s.c[2] - z) < Math.hypot(...s.h) + 0.01);
  let best: number | null = null;
  for (let y = from; y > from - deep; y -= 0.004) if (near.some((s) => clear(s, [x, y, z]) === 0)) { best = y; break; }
  for (const f of fields) {
    const u = (x - f.x0) / f.cell, v = (z - f.z0) / f.cell, i = Math.floor(u), j = Math.floor(v);
    if (i < 0 || j < 0 || i >= f.nx || j >= f.nz) continue;
    // (cut corner to corner as it is drawn)
    const H = (a: number, b: number) => f.heights[b * (f.nx + 1) + a], fu = u - i, fv = v - j;
    const y = fu + fv <= 1 ? H(i, j) + (H(i + 1, j) - H(i, j)) * fu + (H(i, j + 1) - H(i, j)) * fv : H(i + 1, j + 1) + (H(i, j + 1) - H(i + 1, j + 1)) * (1 - fu) + (H(i + 1, j) - H(i + 1, j + 1)) * (1 - fv);
    if (y <= from + 1e-6 && y > from - deep && (best === null || y > best)) best = y;
  }
  return best;
}
/** every face of the fort's own that looks up, by the half-metre square it is over */
const lookingUp = new Map<number, number[][]>();
for (const part of [shape.near, shape.under]) for (const s of SHEETS) {
  if (s === 'water') continue;
  const Q = part[s].pos;
  for (let i = 0; i < Q.length; i += 9) {
    const t = Q.slice(i, i + 9);
    if ((t[5] - t[2]) * (t[6] - t[0]) - (t[3] - t[0]) * (t[8] - t[2]) <= 1e-9) continue;
    for (let a = Math.floor(Math.min(t[0], t[3], t[6]) * 2); a <= Math.floor(Math.max(t[0], t[3], t[6]) * 2); a++) for (let b = Math.floor(Math.min(t[2], t[5], t[8]) * 2); b <= Math.floor(Math.max(t[2], t[5], t[8]) * 2); b++) {
      const k = a * 4096 + b, at = lookingUp.get(k);
      if (at) at.push(t);
      else lookingUp.set(k, [t]);
    }
  }
}
/** the top of what is drawn under a spot, no higher than `from` */
function drawnAt(x: number, z: number, from: number, deep = 0.9): number | null {
  let best: number | null = null;
  for (const t of lookingUp.get(Math.floor(x * 2) * 4096 + Math.floor(z * 2)) ?? []) {
    const d = (t[5] - t[8]) * (t[0] - t[6]) + (t[6] - t[3]) * (t[2] - t[8]), u = ((t[5] - t[8]) * (x - t[6]) + (t[6] - t[3]) * (z - t[8])) / d, v = ((t[8] - t[2]) * (x - t[6]) + (t[0] - t[6]) * (z - t[8])) / d;
    if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
    const y = u * t[1] + v * t[4] + (1 - u - v) * t[7];
    if (y <= from + 1e-6 && y > from - deep && (best === null || y > best)) best = y;
  }
  return best;
}
ok('every way up meets the level it comes to: nothing is open where a tread, a deck or a slope ends, and there is no step there but the plan\'s', () => {
  interface End { name: string; J: V3; dir: [number, number]; w: number; way: (t: number) => number; wayX: (t: number) => number; on?: (t: number) => number; tol: number; slack: number; drawn: boolean }
  const ends: End[] = [];
  for (const f of flights) {
    const dx = f.head[0] - f.foot[0], dz = f.head[2] - f.foot[2], L = Math.hypot(dx, dz), up = f.head[1] - f.foot[1], k = Math.max(1, Math.round(up / 0.2)), rise = up / k, run = L / k, d: [number, number] = [dx / L, dz / L];
    // (stone is bent a hand either way on the plan, and its treads' edges with it; boards are not)
    const slack = f.paint === 'timber' ? 0.03 : 0.14, hatch = f.name === 'hatch steps';
    // (the head of the hatch's steps is at the ground, which is the hill's and is asked where a world has it; a stair built down into the hill has no foot)
    if (!hatch) ends.push({ name: `the head of the ${f.name}`, J: f.head, dir: d, w: f.w, way: (t) => -Math.floor(t / run) * rise, wayX: (t) => (t < run ? 0 : -((t - run) * rise) / run), tol: 0.02, slack, drawn: true });
    if (castleGround(f.foot[0], f.foot[2]) < f.foot[1] + 0.25) ends.push({ name: `the foot of the ${f.name}`, J: f.foot, dir: [-d[0], -d[1]], w: f.w, way: (t) => (Math.floor(t / run) + 1) * rise, wayX: (t) => ((t + run) * rise) / run, on: (t) => Math.max(0, ((run - t) * rise) / run), tol: 0.02, slack, drawn: !hatch });
  }
  // the ramp: its head on the edge of the wall's top (the kit's: what stops a body there is asked, and the boards' own height against the walk's), its foot on the rock
  const ramp = parts.find((p) => p.t === 'slab' && p.name === 'ramp') as unknown as { p: V3[] }, [ra, rb, , rd] = ramp.p, rl = Math.hypot(rb[0] - ra[0], rb[2] - ra[2]), rs = (ra[1] - rb[1]) / rl, rz = (ra[2] + rd[2]) / 2;
  // (the kit's walk is at 7.08486 in the piece's own measure, and the piece is set down by `KIT_LEVELS.walk`)
  within(ra[1] - (7.08486 - KIT_LEVELS.walk), 0, 0.008, 'the ramp\'s boards at their head, over the top of the wall they end on');
  ends.push({ name: 'the head of the ramp', J: [ra[0], ra[1], rz], dir: [-1, 0], w: Math.abs(rd[2] - ra[2]), way: (t) => -t * rs, wayX: (t) => -t * rs, tol: 0.035, slack: 0.03, drawn: false });
  ends.push({ name: 'the foot of the ramp', J: [rb[0], rb[1], rz], dir: [1, 0], w: Math.abs(rd[2] - ra[2]), way: (t) => t * rs, wayX: (t) => t * rs, tol: 0.03, slack: 0.03, drawn: true });
  // the stone of the fallen vault: up it to the edge of the paving, a step under it
  const B = UNDER.bay, vs = (-0.07 - UNDER.floor) / (B.z1 - B.z0 - 0.5);
  ends.push({ name: 'the head of the fallen vault', J: [(B.x0 + UNDER.crawl) / 2 - 0.1, 0, B.z1], dir: [0, 1], w: (UNDER.crawl - B.x0) * 0.8, way: (t) => -0.07 - t * vs, wayX: (t) => -0.07 - t * vs, tol: 0.065, slack: 0.03, drawn: true });
  let asked = 0;
  for (const e of ends) for (const lat of [-0.3, 0, 0.3]) for (const [what, top, way, on] of [['drawn', drawnAt, e.way, () => 0], ['what stops a body', standsAt, e.wayX, e.on ?? (() => 0)]] as [string, typeof drawnAt, (t: number) => number, (t: number) => number][]) {
    if (what === 'drawn' && !e.drawn) continue;
    let open = 0, most = 0;
    for (let i = -45; i <= 45; i++) {
      const s = i / 100, x = e.J[0] + e.dir[0] * s + e.dir[1] * lat * e.w, z = e.J[2] + e.dir[1] * s - e.dir[0] * lat * e.w;
      const wants = [s - e.slack, s - e.slack / 2, s, s + e.slack / 2, s + e.slack].map((q) => (q < 0 ? way(-q) : on(q)));
      const y = top(x, z, e.J[1] + Math.max(...wants) + 0.4), off = y === null ? -9 : wants.map((w) => y - e.J[1] - w).sort((p, q) => Math.abs(p) - Math.abs(q))[0];
      asked++;
      if (off < -0.09) { open++; most = Math.max(most, open); } else { open = 0; assert.ok(Math.abs(off) <= e.tol + 1e-6, `${e.name}: ${what} is ${(off * 100).toFixed(1)} cm off where the plan has it, ${i} cm past its end`); }
    }
    assert.ok(most <= 1, `${e.name}: nothing is ${what === 'drawn' ? 'drawn' : 'there to stand on'} for ${most} cm across its end`);
  }
  // (twelve heads and ten feet of thirteen flights, the ramp's two ends, the fallen vault's head: 25 ends, each asked on three lines, drawn and stood on)
  assert.ok(ends.length === 25 && asked > 12000, `${ends.length} ends, ${asked} places asked`);
});

ok('the dead of the place are stood where they can walk away: at places said, outside every house, a pace clear of every stone', () => {
  // (2026-10-14, played: "zombies are getting stuck in the base of the building and surrounding buildings". Stood by a
  // round of six metres about each house, on the world's word alone, and run by the game's own rules: of 144, 39 were
  // IN stone and 57 inside a house's four walls; 38 never got a pace away. Stood at these places: none, none, none.)
  const ground = (wx: number, wz: number) => { const [lx, lz] = castleLocal(P, wx, 0, wz); return P.y + CASTLE_SCALE * castleGround(lx, lz); };
  const homes = castleHomes(P, undefined, ground), local = looseLocal(P, castleLoose(P)), rocks = local.filter((l) => l.kind === 'rock');
  assert.equal(homes.length, 6);
  assert.equal(homes.reduce((a, h) => a + h.n, 0), 9, 'as many of them as there were');
  let places = 0;
  for (const h of homes) {
    // (on the knife-edge the fort assumes, a house on the ridge's own crest has few level places about it; where a world has stood it, eleven and more)
    assert.ok(h.inside && h.inside.length >= 2, `a home of the fort's dead has ${h.inside?.length ?? 0} places said for it`);
    for (const [wx, wy, wz] of h.inside!) {
      const [lx, lz, ly] = castleLocal(P, wx, wy, wz);
      places++;
      assert.ok(Math.abs(ly - castleGround(lx, lz)) < 1e-6, 'one of them is stood off the ground');
      // (within reach of its home: a house's are about that house, the gate's on the ground before the gate)
      assert.ok(Math.hypot(wx - h.x, wz - h.z) < 11, 'one of them is stood away from where it lives');
      assert.equal(fouls([lx, ly, lz]), null, `one of them is stood in stone, at ${lx.toFixed(1)}, ${lz.toFixed(1)}`);
      // (nothing of the fort within a pace of it at a body's height, any way round: it can walk off whichever way it turns)
      for (let a = 0; a < 8; a++) assert.equal(fouls([lx + Math.cos(a * 0.7854) * 0.8, ly, lz + Math.sin(a * 0.7854) * 0.8]), null, `one of them is stood against stone, at ${lx.toFixed(1)}, ${lz.toFixed(1)}`);
      for (const l of local) {
        const dx = lx - l.x, dz = lz - l.z, c = Math.cos(l.rot), s = Math.sin(l.rot), sh = HOUSES[l.n % HOUSES.length];
        if (l.kind === 'house') assert.ok(Math.abs(dx * c - dz * s) > sh.w / 2 + 1 || Math.abs(dx * s + dz * c) > sh.d / 2 + 1, 'one of them is stood in a house, or against its wall');
      }
      assert.ok(rocks.every((r) => Math.hypot(lx - r.x, lz - r.z) > 3), 'one of them is stood against a rock');
      assert.ok(!inCastle(P, wx, wy + 0.9, wz) && Math.abs(lx) > C.hx + 6 || Math.abs(lz) > C.hz + 6, 'one of them is stood at the fort\'s foot');
    }
  }
  assert.ok(places >= 20, `${places} places in all`);
  // (and with nobody to say how the ground lies, a home is the round it was: whoever only counts them asks so)
  assert.ok(castleHomes(P).every((h) => !h.inside));
});

ok('a rock stops a body as the rock that is drawn: every face of it is a piece of what stops, and the scanned rock is not walked through', () => {
  // (2026-10-14, played: "rocks outside the building dont clip right with collision": one block to a rock, 0.78 of its radii, whatever its corners)
  const rocks = [...parts, ...LOOSE.flatMap((l) => looseParts(l))].filter((p) => p.t === 'lump' && !p.blocky && (p.body ?? 'all') !== 'none');
  const hulls = shape.solids.filter((s): s is Extract<Solid, { t: 'hull' }> => s.t === 'hull');
  assert.ok(rocks.length >= 10, `${rocks.length} rocks`);
  for (const name of new Set(rocks.map((r) => r.name ?? 'rock'))) {
    const mine = hulls.filter((h) => h.name === name), of = rocks.filter((r) => (r.name ?? 'rock') === name).length;
    // (its foot in the ground as one piece; the band over that, seven faces of four corners; over its middle seven faces each drawn as two, each of the two a piece; seven at its top: 29 pieces, each some of its faces and its middle)
    assert.equal(mine.length, of * 29, `${name}: ${mine.length} pieces for ${of} rocks`);
    assert.ok(mine.every((h) => h.pts.length >= 12), `${name}: a piece is not a face and a middle`);
    assert.equal(boxes.filter((b) => b.name === name).length, 0, `${name} still stops a body with a block`);
  }
  // the scanned rock: its face in pieces along it, each no bigger than a pace, for every face of it that stands
  const faces = hulls.filter((h) => h.name === 'rock_face_01');
  // (some two hundred pieces to a face; of the six places for one, those are made where the ground does not fall away before it)
  assert.ok(faces.length >= 2 * 180 && faces.length <= 6 * 240 && faces.length % 206 === 0, `${faces.length} pieces of scanned rock`);
  for (const h of faces) {
    const xs = h.pts.filter((_, i) => i % 3 === 0), ys = h.pts.filter((_, i) => i % 3 === 1), zs = h.pts.filter((_, i) => i % 3 === 2);
    assert.ok(Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)) < 2.2, 'a piece of scanned rock is bigger than its square');
  }
});

console.log(`castle: ${n} checks passed`);
