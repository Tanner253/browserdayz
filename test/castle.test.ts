// Checks of the fort on the mountain: its measurements against the real one's (src/sim/castle.ts), its shapes by
// numbers (src/world/castle-shape.ts: nothing drawn, nothing run), that a body has room on every stair, and that
// what lies in it lies somewhere a hand can reach. `npx tsx test/castle.test.ts`.

import assert from 'node:assert/strict';
import { KIT_LEVELS, KIT_MERLON, cutBox, inCut, kitMatrix, kitPoint, kitSolids } from '../src/sim/kit';
import { castleDoor, castleKit } from '../src/sim/castle';
import { CASTLE, CASTLE_TIERS, FURNITURE, LOOSE, OUTCROP, POSTERN, UNDER, castleAt, castleCuts, castleDark, castleGround, castleHomes, castleLamps, castleLocal, castleLoose, castleLoot, castleParts, castleProps, castleUnder, hatchLine, inCastle, looseLocal, looseParts, moundTop, squareTouches, stairShare, towerRadius, type Flight, type Place, type Tower, type V3 } from '../src/sim/castle';
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
  assert.ok(shape.solids.length < 2200, `${shape.solids.length} things to run into`);
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
  assert.ok(castleLoot(P).length > loot.length && castleLoot(P).every((l) => l.building === 'castle'), 'the places of the post are not among the fort’s');
  assert.ok(inside.length >= 36 && loot.length - inside.length >= 5, `${inside.length} in the fort, ${loot.length - inside.length} in its grounds`);
  assert.ok(loot.every((l) => l.building === 'castle' && l.usage.length > 0));
  // three steps of the map in one place, and the way from the first to the last is up: the houses, the fort, what is high in it
  // (the high step is what is hardest to come at: everything under the terrace, in the dark; and at the very top
  // the rack of guns in the upper room and the wall top over the roof)
  const top = (l: { x: number; y: number; z: number }) => {
    const [x, , y] = castleLocal(P, l.x, l.y, l.z);
    return y < -0.5 || (Math.abs(y - 5.85 - 0.995) < 0.02 && x > 2.2) || Math.abs(y - K.band) < 0.05;
  };
  for (const l of loot) assert.equal(l.tier, !inCastle(P, l.x, l.y, l.z) ? CASTLE_TIERS.grounds : top(l) ? CASTLE_TIERS.high : CASTLE_TIERS.fort, `a thing at ${castleLocal(P, l.x, l.y, l.z).map((v) => v.toFixed(1))}`);
  const high = loot.filter((l) => l.tier === CASTLE_TIERS.high), deep = high.filter((l) => l.y < P.y - 0.5);
  // (the vaults are the richest of it: the armoury, whose five racks always have a gun on them, and the aid post, which has what a dressing station had)
  const arms = loot.filter((l) => l.arms === 'guns'), medic = loot.filter((l) => l.usage.includes('Medic'));
  assert.ok(high.length >= 30 && high.length <= 38 && deep.length >= 27 && arms.length === 6 && arms.filter((l) => l.y < P.y - 0.5).length === 5 && medic.length === 10, `${high.length} places of the high step, ${deep.length} of them under the terrace; ${arms.length} that always hold a gun; ${medic.length} of the aid post's`);
  assert.ok(deep.every((l) => castleUnder(P, l.x, l.y + 0.5, l.z)) && medic.every((l) => l.y < P.y - 0.5 && castleLocal(P, l.x, l.y, l.z)[1] > 5.5));
  assert.ok(inside.every((l) => l.usage.includes('Military') || l.usage.includes('Medic')) && loot.filter((l) => !inCastle(P, l.x, l.y, l.z)).every((l) => l.usage.includes('Hunting')));
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
  const far = castleLoot(P, flat, moved).filter((l) => !('room' in l) && l.usage.includes('Hunting'));
  assert.ok(far.length >= 5 && far.every((l) => Math.abs(l.y - 77.04) < 0.01 && Math.hypot(l.x - P.x, l.z - P.z) > 300), 'what lies in the houses did not go with them');
  // (two things of the fort's own stand in the houses; what the post stood by them goes with them as well, and is its own file's to count)
  const gone = (list: { x: number; z: number }[]) => list.filter((p) => Math.hypot(p.x - P.x, p.z - P.z) > 300).length;
  assert.ok(gone(castleProps(P, flat, moved)) - gone(postProps(P, flat, moved)) === 2, `${gone(castleProps(P, flat, moved)) - gone(postProps(P, flat, moved))} things of the fort's own went with the houses`);
  const homes = castleHomes(P, moved);
  // (the infected of the fort itself have the dark under the terrace, and nothing over it)
  assert.ok(homes.length === 2 && Math.hypot(homes[0].x - P.x, homes[0].z - P.z) > 300 && homes[1].n === 4 && homes[1].inside!.every((s) => inCastle(P, ...s) && castleUnder(P, s[0], s[1] + 0.9, s[2])), 'the dead of the fort are not where they belong');
  // with no houses there is still the fort
  assert.equal(castleHomes(P, []).length, 1);
  assert.ok(castleLoot(P, flat, []).every((l) => inCastle(P, l.x, l.y, l.z)), 'with no houses a thing still lies outside the fort');
  // and the shapes follow: nothing of a house where the houses were, when there are none
  const bare = castleShape(castleGround, []);
  assert.ok(Math.max(...bare.near.stone.pos.filter((_, i) => i % 3 === 0)) < 30);
  // (nor of the hatch: with none set down there is no passage)
  assert.ok(!bare.solids.some((q) => /hatch|passage (floor|roof|wall)$/.test((q as { name: string }).name)) && castleCuts(P, undefined, []).length === 1);
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
  within((Math.atan2(-0.07 - UF, B.z1 - 0.25 - (B.z0 + 0.5)) * 180) / Math.PI, 25, 33, 'the slope of the fallen vault, which is walked');
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
  const cuts = castleCuts(P);
  assert.equal(cuts.length, 2 + way.length - 1);
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

console.log(`castle: ${n} checks passed`);
