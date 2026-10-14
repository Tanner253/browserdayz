// Checks of the jeep that burns before the fort's gate (src/sim/wreck-fire.ts; where it stands is the fort's to say,
// `JEEP_WRECK` and `castleJeep` in src/sim/castle.ts): that it is where the plan says however the fort is turned,
// and sits on the ground it is given; that in the world as it is made it is one of the things that stop a body,
// clear of the way in, and is nothing else (no crate, no fireplace, no drum of fuel); and that it is lit and warm.
// No network, nothing drawn: `npx tsx test/wreck-fire.test.ts`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assets } from '../src/core/assets';
import { barrelSpots } from '../src/sim/barrels';
import { CASTLE, CASTLE_SCALE, JEEP_WRECK, castleAt, castleFoot, castleJeep, castleLocal, castleProps, type Place } from '../src/sim/castle';
import { FIRE, fireSpots, restsBy } from '../src/sim/fires';
import { openGround } from '../src/sim/infected';
import { JEEP } from '../src/sim/vehicles';
import { WRECK_FIRE, burnedBy, hullGap, warmedBy, wreckLocal, wreckSpot } from '../src/sim/wreck-fire';
import { Buildings, CRATE_KINDS, SEARCHED_KINDS } from '../src/world/buildings';
import { MOUNTAIN, catmullRom, generateWorld, heightAt } from '../src/world/worldgen';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};
const within = (v: number, lo: number, hi: number, what: string) => assert.ok(v >= lo - 1e-9 && v <= hi + 1e-9, `${what}: ${v.toFixed(3)} is not in ${lo}..${hi}`);

const C = CASTLE, S = CASTLE_SCALE, J = JEEP_WRECK, W = WRECK_FIRE;
/** the fort stood anywhere, turned any way */
const places: Place[] = [{ x: 310, y: 240, z: -415, rot: 0 }, { x: 310, y: 240, z: -415, rot: 0.7 }, { x: -80, y: 55, z: 12, rot: -1.309 }, { x: 537, y: 100, z: -371, rot: 2.9 }, { x: 0, y: 0, z: 0, rot: Math.PI }, { x: 44, y: 9, z: 700, rot: -3.05 }];
/** the middle line of the way in (the gate's own, out from the foot of the ramp), and where that foot is: the fort's own measure */
const gateZ = (C.gate.z0 + C.gate.z1) / 2, footX = C.hx + C.parapet.thick / 2 + Math.sqrt(C.ramp.len ** 2 - C.ramp.drop ** 2);
/** the model it is drawn with: half its width and half its length as it is drawn, metres (what stops a body is a little less: WRECK_FIRE.hull) */
const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'public/assets/manifest.json'), 'utf8')) as { models: Record<string, { min: number[]; max: number[] }> };
const model = manifest.models[J.kind];
assert.ok(model, `the game has no model called ${J.kind}`);
const half = [(model.max[0] - model.min[0]) / 2, (model.max[2] - model.min[2]) / 2];
/** its four corners as it is drawn, in the fort's own measure, for a fort that is not turned */
const corners = (): [number, number][] => {
  const c = Math.cos(J.rot), s = Math.sin(J.rot);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]): [number, number] => [J.x + (a * half[0] * c + b * half[1] * s) / S, J.z + (-a * half[0] * s + b * half[1] * c) / S]);
};

ok('it is the game`s own jeep, and stands in the plan a little before the foot of the ramp, to one side of the way in and clear of it, its nose down the way toward the road', () => {
  assert.equal(J.kind, JEEP.model);
  // (a little before the foot of the ramp: its nearest corner a pace or two beyond it, its furthest no more than a dozen metres)
  const xs = corners().map((q) => (q[0] - footX) * S), zs = corners().map((q) => Math.abs(q[1] - gateZ) * S);
  within(Math.min(...xs), 1, 8, 'metres from the ramp`s foot to the nearest of it');
  within(Math.max(...xs), 4, 12, 'metres from the ramp`s foot to the furthest of it');
  // (three to five metres clear: from the middle line of the way to the nearest of it; and beside a way as wide as
  // the ramp there is a pace and a half of open ground before it yet)
  within(Math.min(...zs), 3, 5, 'metres from the middle line of the way to the nearest of it');
  within(Math.min(...zs) - (C.ramp.wide * S) / 2, 1.5, 4, 'metres of clear ground between the edge of the way and the nearest of it');
  // (all of it on the one side: none of it over the way's middle line)
  assert.ok(corners().every((q) => Math.sign(q[1] - gateZ) === Math.sign(J.z - gateZ)));
  // Its nose (the model's is toward its own -z: the pipeline turns it so, and the garage drives it that way) is down
  // the way toward the road, AWAY from the fort ("the car is rotated backwards, the front should be facing the
  // road"), and slewed a little off the way's line, toward the hill: not straight along it, and nowhere near across it.
  const nose = [-Math.sin(J.rot), -Math.cos(J.rot)];
  assert.ok(nose[0] > 0.9, 'its nose is not down the way, away from the fort');
  assert.ok(Math.sign(nose[1]) === Math.sign(J.z - gateZ), 'it is slewed toward the way, not toward the hill');
  within((Math.acos(nose[0]) * 180) / Math.PI, 5, 25, 'degrees it is slewed off the way');
});

ok('it is where the plan says however the fort is turned, and is turned with it', () => {
  for (const P of places) {
    const flat = () => P.y - 2, j = castleJeep(P, flat), [lx, lz] = castleLocal(P, j.x, j.y, j.z);
    assert.ok(Math.hypot(lx - J.x, lz - J.z) < 1e-9, `turned ${P.rot}, it is at ${lx.toFixed(3)}, ${lz.toFixed(3)} of the plan`);
    assert.ok(Math.abs(j.rot - P.rot - J.rot) < 1e-12);
    assert.deepEqual([j.x, j.z], [castleAt(P, J.x, J.z)[0], castleAt(P, J.x, J.z)[2]]);
    // its nose, a metre ahead of its middle, is where the plan has it too: further from the fort, down the way, and on the side of the hill
    const [nx, nz] = castleLocal(P, j.x - Math.sin(j.rot), 0, j.z - Math.cos(j.rot));
    assert.ok(nx > J.x + 0.9 / S && Math.sign(nz - J.z) === Math.sign(J.z - gateZ), `turned ${P.rot}, its nose points the wrong way`);
    // and the fire with it: the heart of it is in its cabin, over its middle line
    const w = wreckSpot(P, flat), h = wreckLocal(w, ...w.heart);
    assert.ok(Math.hypot(h[0] - W.heart[0], h[1] - W.heart[1], h[2] - W.heart[2]) < 1e-9);
  }
  // (and it is the last of the fort's things, the only one of its kind: nothing before it is renumbered for it)
  const props = castleProps(places[1]);
  assert.deepEqual(props.map((q) => q.kind === J.kind).lastIndexOf(true), props.length - 1);
  assert.equal(props.filter((q) => q.kind === J.kind).length, 1);
  assert.deepEqual({ ...props[props.length - 1] }, { ...castleJeep(places[1]), scale: 1, far: 0 });
});

ok('it sits level on the lowest of the ground under its four wheels, a hand in it, whatever that ground is and however the fort is turned', () => {
  // ground said in the fort's own measure: a slope that falls away from the fort and across the way, and a hollow under one wheel
  const sunk: number[] = [];
  for (const P of places) {
    const ground = (wx: number, wz: number) => {
      const [x, z] = castleLocal(P, wx, 0, wz);
      return P.y - 1.5 - 0.11 * (x - J.x) * S + 0.06 * (z - J.z) * S - (Math.hypot(x - J.x - 1, z - J.z + 0.4) < 0.5 ? 0.3 : 0);
    };
    const j = castleJeep(P, ground), c = Math.cos(j.rot), s = Math.sin(j.rot);
    const wheels = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ground(j.x + a * J.wheels[0] * c + b * J.wheels[1] * s, j.z - a * J.wheels[0] * s + b * J.wheels[1] * c));
    assert.ok(Math.abs(j.y - (Math.min(...wheels) - J.sunk)) < 1e-9);
    // (no wheel is over the ground: each is a hand in it at the least)
    for (const g of wheels) assert.ok(g - j.y >= J.sunk - 1e-9);
    sunk.push(j.y - P.y);
  }
  // (the same ground under it, the same seat: its wheels are told off turned as the fort is)
  for (const v of sunk) assert.ok(Math.abs(v - sunk[0]) < 1e-9, `it sits ${v.toFixed(4)} under the terrace in one place and ${sunk[0].toFixed(4)} in another`);
  within(J.sunk, 0.06, 0.14, 'a hand');
  // (its wheels are where the model's are: a metre and a half apart and two and a half between the axles)
  within(J.wheels[0], 0.6, 0.8, 'half its track');
  within(J.wheels[1], 1.15, 1.4, 'half its wheelbase');
});

// ---- in the world as it is made (the game and the server both make it so: see server/world.ts)
(assets as unknown as { manifest: unknown }).manifest = manifest;
const world = generateWorld();
new Buildings(world, null as never).plan();
const P = world.castle!;
assert.ok(P, 'the world has no fort');
const seen = (x: number, z: number) => heightAt(world.surface, x, z);
const spot = wreckSpot(P, seen);
/** its four corners in the world, as it stops a body (`k` 1) or as it is drawn */
const cornersIn = (hx: number, hz: number): [number, number][] => {
  const c = Math.cos(spot.rot), s = Math.sin(spot.rot);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]): [number, number] => [spot.x + a * hx * c + b * hz * s, spot.z - a * hx * s + b * hz * c]);
};

ok('it is in the world`s list of things, once, where the fort says, of a kind the world makes solid: it stops a body and a shot', () => {
  const mine = world.props.filter((q) => q.kind === J.kind && Math.hypot(q.x - spot.x, q.z - spot.z) < 0.01);
  assert.equal(mine.length, 1, `${mine.length} jeeps of the world's stand where the fort's burns`);
  const it = mine[0];
  assert.ok(Math.abs(it.y - spot.y) < 1e-9 && Math.abs(it.rot - spot.rot) < 1e-9, 'the world has it higher or turned otherwise than it is drawn');
  // (drawn from no distance by whoever draws that list: it is drawn burnt, by the game's own hand)
  assert.equal(it.far, 0);
  assert.equal(it.scale, 1);
  // What stands in the world's list is solid by its kind (SOLID in src/world/vegetation.ts: the box of its model,
  // a little shrunk, on its foot and turned as it is): a jeep is one of those kinds, as the one under the bridge is.
  const solid = /^\s*uaz_469: \['metal', ([\d.]+)\],/m.exec(readFileSync(path.join(process.cwd(), 'src/world/vegetation.ts'), 'utf8'));
  assert.ok(solid, 'the world no longer makes a jeep in its list of things solid');
  // (and what is asked here of how near it somebody is, is that box)
  within(W.hull[0], half[0] * Number(solid[1]) - 0.02, half[0] * Number(solid[1]) + 0.02, 'half the width of what stops a body');
  within(W.hull[2], half[1] * Number(solid[1]) - 0.02, half[1] * Number(solid[1]) + 0.02, 'half the length of what stops a body');
  within(W.hull[1], model.max[1] - 0.02, model.max[1] + 0.02, 'the height of what stops a body');
  assert.ok(hullGap(spot, spot.x, spot.z) === 0 && Math.abs(hullGap(spot, ...cornersIn(W.hull[0] + 1, 0)[1]) - 1) < 1e-9);
});

ok('and it is nothing else: not searched, not lit, not blown up, not driven', () => {
  assert.ok(!CRATE_KINDS.has(J.kind) && !SEARCHED_KINDS.has(J.kind));
  assert.ok(!fireSpots(world.props).some((q) => Math.hypot(q.x - spot.x, q.z - spot.z) < 6), 'a fireplace stands at it');
  assert.ok(!barrelSpots(world.props).some((q) => Math.hypot(q.x - spot.x, q.z - spot.z) < 6), 'a drum of fuel stands at it');
  // (the only other jeep in the world's list is the one that went off the bridge)
  assert.equal(world.props.filter((q) => q.kind === J.kind).length, 1 + world.bridges.length);
});

ok('the ground the world has there takes it: near level under its wheels, open, nothing else stood on it, and the way in is clear', () => {
  const c = Math.cos(spot.rot), s = Math.sin(spot.rot);
  const wheels = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => seen(spot.x + a * J.wheels[0] * c + b * J.wheels[1] * s, spot.z - a * J.wheels[0] * s + b * J.wheels[1] * c));
  // (level as it stands, no wheel is more than knee deep in the ground: on a steeper place it must be moved in the plan)
  within(Math.max(...wheels) - Math.min(...wheels), 0, 0.5, 'metres between the highest and the lowest ground under its wheels');
  assert.ok(Math.abs(Math.min(...wheels) - J.sunk - spot.y) < 1e-9);
  // nothing grows or lies in it, and nothing else of the world's list stands in it
  for (const [what, list, room] of [['tree', world.trees, 3], ['rock', world.rocks, 3], ['thing', world.props.filter((q) => Math.hypot(q.x - spot.x, q.z - spot.z) > 0.01), 3]] as [string, { x: number; z: number }[], number][])
    assert.ok(!list.some((q) => Math.hypot(q.x - spot.x, q.z - spot.z) < room), `a ${what} stands in the burning jeep`);
  // it is outside the fort's foot (of which the ground where the ramp lands is a part: it stands beside that), and before its gate
  within(castleFoot(P, spot.x, spot.z), 0.5, 30, 'metres from the fort`s foot');
  within((castleLocal(P, spot.x, 0, spot.z)[0] - C.hx) * S, 8, 30, 'metres out from the gate wall');
  // the infected are not stood in it (the garrison's dead live on the ground before the gate)
  assert.equal(openGround(world, spot.x, spot.z), false);
  // and the way in as the world has it, the track's last lengths to the foot of the ramp: no corner of it within
  // three metres of the way's middle line, nor within a pace and a half of the edge of a way as wide as the ramp
  const track = catmullRom(MOUNTAIN.track.line, 4).slice(-40), foot = castleAt(P, footX, gateZ), way: [number, number][] = [...track, [foot[0], foot[2]]];
  let near = Infinity;
  for (const [x, z] of cornersIn(half[0], half[1])) for (let k = 0; k + 1 < way.length; k++) {
    const [ax, az] = way[k], [bx, bz] = way[k + 1], l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1, t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
    near = Math.min(near, Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t));
  }
  within(near, 3, 6, 'metres from the middle line of the way in to the nearest of it');
  within(near - (C.ramp.wide * S) / 2, 1.5, 4.5, 'metres of clear ground between the edge of the way in and the nearest of it');
});

ok('it is lit: its lamp hangs clear of its roof, and its light reaches the ramp, the gate`s arch and the faces of both gate towers, about 25 m', () => {
  const L = W.light, lamp: [number, number, number] = [spot.heart[0], spot.heart[1] + L.up, spot.heart[2]];
  within(L.reach, 22, 30, 'metres its light reaches');
  assert.ok(lamp[1] - spot.y > W.hull[1] + 0.5, 'its lamp is in its roof');
  // (the heart of the fire is in the cabin: inside what stops a body, over its floor and under its roof)
  const h = wreckLocal(spot, ...spot.heart);
  assert.ok(Math.abs(h[0]) < W.hull[0] && Math.abs(h[2]) < W.hull[2] && h[1] > 0.8 && h[1] < W.hull[1]);
  const far = (x: number, z: number, y: number) => { const q = castleAt(P, x, z, y); return Math.hypot(q[0] - lamp[0], q[1] - lamp[1], q[2] - lamp[2]); };
  const T = C.tower, face = (cz: number) => { const d = Math.hypot(J.x - C.hx, J.z - cz); return far(C.hx + ((J.x - C.hx) / d) * T.r, cz + ((J.z - cz) / d) * T.r, 1.5); };
  const lit: [string, number][] = [['the foot of the ramp', far(footX, gateZ, -C.ramp.drop)], ['the head of the ramp', far(C.hx, gateZ, 0)], ['the gate`s arch', far(C.hx + 0.4, gateZ, 2.4)], ['the face of the gate tower on its side', face(Math.sign(J.z) * C.hz)], ['the face of the gate tower across the way', face(-Math.sign(J.z) * C.hz)]];
  // (every one of them well inside its reach: the furthest of them, the tower across the way, has a quarter of the way to go)
  for (const [what, d] of lit) assert.ok(d < L.reach * 0.75, `${what} is ${d.toFixed(1)} m from its lamp, and that reaches ${L.reach}`);
  within(Math.max(...lit.map((q) => q[1])), 15, 23, 'metres to the furthest of what it must light');
  // (and it is a big fire's light: many times a campfire's lamp, which is 9, and not a floodlight)
  within(L.strength, 40, 140, 'how strong its lamp is');
  // its own from dusk, as the fort's fire baskets are lit; and seen lit from further off than a campfire is (48 m)
  assert.ok(L.dusk[0] >= 0.25 && L.dusk[1] > L.dusk[0] && L.dusk[1] <= 0.7 && L.from > 60);
});

ok('it is warm: whoever stands by it is resting by a fire, by the campfire`s own rule and reach, and not through a floor', () => {
  // at its side, a pace off its hull: warm, and not in the flames
  const at = (right: number, back: number, up = 0): [number, number, number] => {
    const c = Math.cos(spot.rot), s = Math.sin(spot.rot);
    return [spot.x + right * c + back * s, seen(spot.x, spot.z) + up, spot.z - right * s + back * c];
  };
  for (const side of [-1, 1]) {
    assert.ok(warmedBy(spot, ...at(side * (W.hull[0] + 1), 0)) && !burnedBy(spot, ...at(side * (W.hull[0] + 1), 0)));
    assert.ok(warmedBy(spot, ...at(side * (W.hull[0] + 2), 0.8)));
  }
  // at its nose and at its tail, a pace off
  assert.ok(warmedBy(spot, ...at(0, -W.hull[2] - 1)) && warmedBy(spot, ...at(0, W.hull[2] + 0.8)));
  // the reach is the campfire's, from the middle of the fire, to the centimetre
  const [hx, , hz] = W.heart;
  assert.ok(warmedBy(spot, ...at(hx + FIRE.warm - 0.05, hz)) && !warmedBy(spot, ...at(hx + FIRE.warm + 0.05, hz)));
  assert.equal(warmedBy(spot, ...at(2, 0)), restsBy({ x: spot.heart[0], y: spot.y, z: spot.heart[2] }, ...at(2, 0)));
  assert.ok(!warmedBy(spot, ...at(2, 0, 3)) && !warmedBy(spot, ...at(2, 0, -3)), 'it warms through a floor');
  // (and nobody on the way in is warmed by it without leaving the way)
  const [wx, , wz] = castleAt(P, J.x, gateZ);
  assert.ok(!warmedBy(spot, wx, seen(wx, wz), wz));
});

ok('and whoever is in its flames is burned: against its hull and nowhere else, a hurt every so often that kills in seconds and not at a touch', () => {
  const B = W.burn, c = Math.cos(spot.rot), s = Math.sin(spot.rot), g = seen(spot.x, spot.z);
  const at = (right: number, back: number): [number, number] => [spot.x + right * c + back * s, spot.z - right * s + back * c];
  // a body is a third of a metre thick: pressed to its side its middle is that far off the hull, and it burns
  assert.ok(burnedBy(spot, at(W.hull[0] + 0.33, 0.5)[0], g, at(W.hull[0] + 0.33, 0.5)[1]));
  assert.ok(burnedBy(spot, at(0.2, -W.hull[2] - 0.33)[0], g, at(0.2, -W.hull[2] - 0.33)[1]));
  // a short pace off it, it does not
  assert.ok(!burnedBy(spot, at(W.hull[0] + 0.9, 0.5)[0], g, at(W.hull[0] + 0.9, 0.5)[1]));
  within(B.reach, 0.36, 0.6, 'metres from its hull the flames reach');
  // nor from well over its roof, nor from under the ground
  assert.ok(!burnedBy(spot, spot.x, spot.y + W.hull[1] + B.over + 0.5, spot.z) && !burnedBy(spot, spot.x, spot.y - 2, spot.z));
  within(100 / B.harm, 4, 15, 'seconds in its flames that kill');
  within(B.harm * B.every, 2, 12, 'health taken at a time');
  // (and it does far more harm than its warmth does good: nobody mends in it)
  assert.ok(B.harm > FIRE.heal * 5);
});

console.log(`\n${n} checks passed`);
