// The supply drop that comes by helicopter (src/sim/airdrop.ts, server/index.ts `sendDrop`), of 2026-10-13.
//   npx tsx test/airdrop.test.ts            the rules, the sound's figures, the files: a few seconds
//   npx tsx test/airdrop.test.ts --server   and then the real server on a port of its own: about two minutes more
//                                            (nothing of it touches the real site: the one it is given is on this
//                                            machine, and says one thing only, that the test's first player is an admin)
//
// What was asked: "it should fly over the map to the airdrop location, and play the sound ... spawns edge of map.
// flies to spot, spawns airdrop after arriving to spot, stays there for a while then leaves flying to the edge of
// the map, proximity audio", "pitch it by distance", "the helicopter sound should be loud", and of the canopy
// "its opacity isnt solid tho we wanna make sure its not see through".
//
// What is held to here: a flight starts on the map's edge and ends on it, another way; it is over the place when
// its distance and its speed say; nothing can be opened before the crate is down; two games told the same flight
// have it in the same place at the same moment, one that joins half way through as well; it is clear of every
// hill. And the rotor, which nobody who set it could hear: how loud it is, how fast it is played and how much of
// its top is left at 0, 50, 150, 400 and 800 m, coming and going, worked out from the recording itself and from
// how a browser draws the squeeze on the way out (the sums of test/everyday.test.ts). What it cannot say is how
// any of it sounds: `?sounds` on the dev page is where that is heard.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import WebSocket from 'ws';
import { BUS, madeUp } from '../src/core/audio';
import { ORDERS } from '../src/net/orders';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { AIRDROP, EDGE, ROTOR, comesFrom, crateAt, flightTimes, heliAt, landed, lowest, planFlight, restAt, rotorAt, wayOut, ways, type Flight } from '../src/sim/airdrop';
import { CALL, pickDropSite } from '../src/sim/drops';
import { generateWorld, heightAt, WORLD_SIZE } from '../src/world/worldgen';

let n = 0;
const failed: string[] = [];
const ok = (name: string, fn: () => void) => {
  try {
    fn();
    n++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed.push(name);
    console.log(`  NOT OK  ${name}\n          ${(e as Error).message}`);
  }
};
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const near = (a: number, b: number, by: number, what: string) => assert.ok(Math.abs(a - b) <= by, `${what}: ${a} is not within ${by} of ${b}`);

console.log('The supply drop comes by helicopter');
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);
let seed = 20261013;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
/** many flights over the map as it is: to the places a drop is set down at, and to anywhere somebody might call one from */
const flights: Flight[] = [];
for (let i = 0; i < 300; i++) {
  const anywhere = () => {
    const x = (rnd() * 2 - 1) * (EDGE - 20), z = (rnd() * 2 - 1) * (EDGE - 20);
    return { x, y: ground(x, z), z };
  };
  const at = i % 3 === 2 ? anywhere() : pickDropSite(world, rnd);
  if (at) flights.push(planFlight(ground, at, `drop-${i}`, rnd));
}
const onEdge = (x: number, z: number) => Math.abs(Math.max(Math.abs(x), Math.abs(z)) - EDGE) < 0.01 && Math.abs(x) <= EDGE + 0.01 && Math.abs(z) <= EDGE + 0.01;
const spread = (name: string, of: (f: Flight) => number, unit = '') => {
  const c = flights.map(of).sort((a, b) => a - b);
  console.log(`      ${name.padEnd(46)} least ${c[0].toFixed(1)}${unit}, middle ${c[c.length >> 1].toFixed(1)}${unit}, most ${c[c.length - 1].toFixed(1)}${unit}`);
  return c;
};

ok(`it starts on the map's edge, a long way from the place (${flights.length} flights over the real map)`, () => {
  for (const f of flights) {
    assert.ok(onEdge(f.fx, f.fz), `${f.uid} appears at ${f.fx.toFixed(1)}, ${f.fz.toFixed(1)}, which is not on the edge`);
    const at0 = heliAt(f, 0);
    near(at0.x, f.fx, 1e-6, 'where it is at the start');
    near(at0.z, f.fz, 1e-6, 'where it is at the start');
    assert.equal(at0.phase, 'in');
    assert.equal(f.age, 0);
  }
  const c = spread('the way in', (f) => ways(f).in, ' m');
  // (not across a corner: from every place there is a way in of at least this much of the map's width)
  assert.ok(c[0] >= AIRDROP.wayIn * WORLD_SIZE, `a way in of only ${c[0].toFixed(0)} m`);
});

ok('it is over the place when its distance and its speed say, and holds there', () => {
  for (const f of flights) {
    const T = flightTimes(f), d = ways(f).in;
    // distance over speed, and half the time it takes to stop (it slows evenly to a stand over the place)
    near(T.arrive, d / AIRDROP.speed + AIRDROP.speed / (2 * AIRDROP.brake), 1e-6, 'when it arrives');
    const a = heliAt(f, T.arrive);
    near(a.x, f.x, 1e-6, 'where it holds');
    near(a.z, f.z, 1e-6, 'where it holds');
    near(a.y, f.hold, 1e-6, 'how high it holds');
    assert.equal(a.phase, 'hold');
    assert.equal(a.speed, 0);
    // a moment before, it is short of the place and still moving; half way through its stay it has not moved
    const b = heliAt(f, T.arrive - 2);
    assert.ok(Math.hypot(b.x - f.x, b.z - f.z) > 1 && b.speed > 0, 'it was there too soon');
    const c = heliAt(f, (T.arrive + T.leave) / 2);
    assert.deepEqual([c.x, c.y, c.z, c.phase], [f.x, f.hold, f.z, 'hold']);
    // it goes at its speed and no faster, and nowhere does it jump: a tenth of a second is never more than four metres
    let was = heliAt(f, 0);
    for (let t = 0.1; t < T.gone + 1; t += 0.1) {
      const now = heliAt(f, t), step = Math.hypot(now.x - was.x, now.y - was.y, now.z - was.z);
      assert.ok(now.speed <= AIRDROP.speed + 1e-9, `it goes ${now.speed} m/s`);
      // (over the ground at its speed; and coming down or climbing, never a dive: under sixteen metres a second)
      assert.ok(Math.hypot(now.x - was.x, now.z - was.z) <= AIRDROP.speed * 0.1 + 0.01 && Math.abs(now.y - was.y) <= 1.6, `${f.uid} jumps ${step.toFixed(2)} m at ${t.toFixed(1)} s`);
      assert.ok(Math.abs(now.vy) <= 16, `it sinks or climbs ${now.vy.toFixed(1)} m/s`);
      was = now;
    }
  }
  spread('over the place after', (f) => flightTimes(f).arrive, ' s');
});

ok('the crate leaves only once it is over the place, comes down at a parachute\'s pace, and nothing can be opened before it lands', () => {
  for (const f of flights) {
    const T = flightTimes(f);
    near(T.release, T.arrive + AIRDROP.settle, 1e-9, 'when the crate leaves');
    // until it has left the helicopter there is no crate
    for (const t of [0, T.arrive / 2, T.arrive, T.release - 0.01]) assert.equal(crateAt(f, t), null, `there is a crate at ${t.toFixed(1)} s`);
    let was = Infinity;
    for (let t = T.release; t < T.land; t += 0.05) {
      const c = crateAt(f, t)!;
      assert.ok(!c.landed && !landed(f, t), `it can be opened at ${t.toFixed(2)} s, ${(T.land - t).toFixed(2)} s before it is down`);
      assert.ok(c.y > f.y - 1e-9 && c.y <= was + 1e-9, 'it does not come down all the way');
      assert.deepEqual([c.x, c.z], [f.x, f.z]);
      // under its canopy it comes down at the pace said, and never faster than a thing falls
      if (t > T.opened) near(c.falling, AIRDROP.fall, 1e-9, 'its pace under the canopy');
      if (t > T.opened) assert.equal(c.open, 1);
      was = c.y;
    }
    // the canopy is open well before the ground
    assert.ok(T.opened < T.land - 5, `the canopy opens ${(T.land - T.opened).toFixed(1)} s before the ground`);
    const down = crateAt(f, T.land)!;
    assert.ok(down.landed && landed(f, T.land));
    assert.deepEqual([down.x, down.y, down.z], [f.x, f.y, f.z]);
    assert.deepEqual(down.swing, [0, 0]);
    near(down.spin, restAt(f.uid), 1e-9, 'which way round it stands');
    // just before, it is a hand's breadth over the place, hanging still
    const before = crateAt(f, T.land - 0.02)!;
    assert.ok(before.y - f.y < 0.2 && Math.abs(before.swing[0]) < 0.01 && Math.abs(before.swing[1]) < 0.01, 'it does not come to the ground where it lands');
    // and the canopy settles and is gone
    assert.equal(crateAt(f, T.land + AIRDROP.down + 0.1)!.settled, 1);
  }
  spread('the crate is in the air for', (f) => flightTimes(f).land - flightTimes(f).release, ' s');
  spread('FROM THE CALL TO THE CRATE ON THE GROUND', (f) => flightTimes(f).land, ' s');
});

ok('it stays a while after the crate has gone, then leaves another way and ends on the edge', () => {
  for (const f of flights) {
    const T = flightTimes(f);
    near(T.leave - T.release, AIRDROP.stay, 1e-9, 'how long it stays');
    assert.ok(T.leave > T.land || flightTimes(f).land - T.release > AIRDROP.stay, 'it leaves before the crate is down');
    const out = wayOut(f);
    assert.ok(onEdge(out.x, out.z), `${f.uid} leaves the map at ${out.x.toFixed(1)}, ${out.z.toFixed(1)}, which is not on the edge`);
    const end = heliAt(f, T.gone);
    assert.equal(end.phase, 'gone');
    near(end.x, out.x, 0.01, 'where it is when it is gone');
    near(end.z, out.z, 0.01, 'where it is when it is gone');
    assert.equal(heliAt(f, T.gone - 0.5).phase, 'out');
    // not the way it came: it turns by what the flight says, and never back along its own track
    assert.ok(Math.abs(f.turn) >= AIRDROP.turn[0] - 1e-9 && Math.abs(f.turn) <= AIRDROP.turn[1] + 1e-9, `it turns ${f.turn}`);
    const back = Math.atan2(f.fz - f.z, f.fx - f.x), goes = Math.atan2(end.vz, end.vx);
    const off = Math.abs(((goes - back + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    // (one that reaches the edge while still in its turn has turned less than it meant to)
    if (ways(f).out >= Math.abs(f.turn) * AIRDROP.arc) assert.ok(off > Math.PI - AIRDROP.turn[1] - 0.01, `it leaves ${((off * 180) / Math.PI).toFixed(0)} degrees off the way it came`);
    assert.ok(Math.hypot(out.x - f.fx, out.z - f.fz) > 1, 'it leaves where it came in');
    // it leans into the turn, to the side it turns to, and no further than it may; and flies level again after
    let most = 0;
    for (let t = T.leave; t < T.gone; t += 0.2) {
      const h = heliAt(f, t);
      assert.ok(Math.abs(h.bank) <= AIRDROP.bank + 1e-9 && (h.bank === 0 || Math.sign(h.bank) === Math.sign(f.turn)), `it leans ${h.bank}`);
      most = Math.max(most, Math.abs(h.bank));
    }
    if (ways(f).out > Math.abs(f.turn) * AIRDROP.arc + 50) assert.ok(most > 0.1, `it turns ${f.turn.toFixed(2)} without leaning`);
  }
  spread('gone after', (f) => flightTimes(f).gone, ' s');
});

ok('it is clear of every hill, all the way in and all the way out', () => {
  for (const f of flights) {
    const least = lowest(f, ground);
    assert.ok(least >= AIRDROP.clear - 0.5, `${f.uid} comes within ${least.toFixed(1)} m of the ground`);
    assert.ok(f.hold - f.y >= AIRDROP.hover - 1e-9 && f.high >= f.hold, 'it holds too low');
  }
  spread('it holds over the place by', (f) => f.hold - f.y, ' m');
  spread('it flies at (the ground goes up to 270)', (f) => f.high, ' m');
});

ok('two games told the same flight have it in the same place at the same moment; one that joins half way sees it where it is', () => {
  for (const f of flights.slice(0, 60)) {
    const T = flightTimes(f);
    // as it goes over the wire: written out, and read by each game for itself
    const said = JSON.stringify(f), one: Flight = JSON.parse(said), two: Flight = JSON.parse(said);
    // a third comes in `late` seconds after: the server tells it the same flight with how long it has been in the air
    const late = T.arrive * 0.6, three: Flight = JSON.parse(JSON.stringify({ ...f, age: Math.round(late * 100) / 100 }));
    assert.deepEqual(flightTimes(one), flightTimes(three));
    for (let t = 0; t <= T.gone + 2; t += 0.37) {
      assert.deepEqual(heliAt(one, t), heliAt(two, t));
      assert.deepEqual(crateAt(one, t), crateAt(two, t));
      // (the third game's own clock began when it was told: what it adds to that is how old the flight was then)
      // (its clock is not the first game's to the last bit, and need not be: the same place to a thousandth of a millimetre)
      if (t >= three.age) {
        const since = t - three.age, a = heliAt(three, three.age + since), b = heliAt(one, t), ca = crateAt(three, three.age + since), cb = crateAt(one, t);
        assert.equal(a.phase, b.phase);
        for (const key of ['x', 'y', 'z', 'heading', 'speed', 'bank', 'pitch'] as const) near(a[key], b[key], 1e-6, `the late joiner's ${key} at ${t.toFixed(2)} s`);
        assert.equal(ca === null, cb === null);
        if (ca && cb) for (const key of ['x', 'y', 'z', 'open', 'spin', 'settled'] as const) near(ca[key], cb[key], 1e-6, `the late joiner's crate ${key} at ${t.toFixed(2)} s`);
      }
    }
  }
});

ok('the words say which way it comes from; the orders have one that sends it; a call has no seconds of its own any more', () => {
  const f: Flight = { uid: 'x', fx: -EDGE, fz: -EDGE, x: 0, y: 0, z: 0, turn: 1, high: 200, hold: 90, age: 0 };
  assert.equal(comesFrom(f), 'NW');
  assert.equal(comesFrom({ ...f, fx: EDGE, fz: 0 }), 'E');
  assert.equal(comesFrom({ ...f, fx: 0, fz: EDGE }), 'S');
  const order = ORDERS.find((o) => o.name === 'airdrop');
  assert.ok(order?.admin, 'there is no /airdrop, or it is not an admin\'s alone');
  assert.equal('eta' in CALL, false);
});

// ------------------------------------------------------------------ the rotor, by its numbers
const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-12));
const lin = (d: number) => Math.pow(10, d / 20);
const SR = 48000, SOUNDS = path.join(ROOT, 'public', 'assets', 'sounds');
/** a recording as it lies on the disk, at the engine's rate, played `rate` times as fast */
function wav(name: string, rate = 1): Float32Array {
  const b = fs.readFileSync(path.join(SOUNDS, `${name}.wav`));
  const from = b.readUInt32LE(24), frames = (b.length - 44) / 2;
  const out = new Float32Array(Math.floor((frames * SR) / (from * rate)));
  for (let i = 0; i < out.length; i++) {
    const p = (i * from * rate) / SR, k = Math.floor(p), f = p - k;
    const at = (j: number) => (j < frames ? b.readInt16LE(44 + j * 2) / 32768 : 0);
    out[i] = at(k) * (1 - f) + at(k + 1) * f;
  }
  return out;
}
/** a low pass as a browser makes one (its Q is in decibels) */
function lowpass(x: Float32Array, hz: number, q: number): Float32Array {
  const w = (2 * Math.PI * Math.min(hz, SR * 0.49)) / SR, c = Math.cos(w), alpha = Math.sin(w) / (2 * Math.pow(10, q / 20));
  const b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2, a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha;
  const out = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}
const peakOf = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
/** how loud its loudest tenth of a second is */
function loud(x: Float32Array): number {
  const w = SR / 10;
  let run = 0, best = 0;
  for (let i = 0; i < x.length; i++) {
    run += x[i] * x[i];
    if (i >= w) run -= x[i - w] * x[i - w];
    if (i >= w - 1) best = Math.max(best, run / w);
  }
  return Math.sqrt(best);
}
// the way out, as a browser makes it (the same sums as test/everyday.test.ts and test/gunsound.test.ts: see there)
function squeeze(c: { threshold: number; knee: number; ratio: number }): (x: number) => number {
  const T = lin(c.threshold), at = lin(c.threshold + c.knee);
  const bend = (x: number, k: number) => (x < T ? x : T + (1 - Math.exp(-k * (x - T))) / k);
  const slope = (x: number, k: number) => (x < T ? 1 : (db(bend(x * 1.001, k)) - db(bend(x, k))) / (db(x * 1.001) - db(x)));
  let lo = 0.1, hi = 10000, k = 5;
  for (let i = 0; i < 15; i++) {
    if (slope(at, k) < 1 / c.ratio) hi = k;
    else lo = k;
    k = Math.sqrt(lo * hi);
  }
  const curve = (x: number) => (x < at ? bend(x, k) : lin(db(bend(at, k)) + (db(x) - c.threshold - c.knee) / c.ratio));
  const back = Math.pow(1 / curve(1), 0.6);
  return (x) => curve(x) * back;
}
const pressed = squeeze(BUS.squeeze), held = squeeze({ ...BUS.ceiling, knee: 0 });
const comesOut = (x: number) => held(pressed(x * BUS.master) / madeUp(BUS.ceiling));
/** how loud a sound comes out: [its loudest tenth of a second, its highest moment], decibels under as loud as can be */
function out(x: Float32Array): [number, number] {
  const p = peakOf(x), k = p > 0 ? comesOut(p) / p : 1;
  return [db(loud(x) * k), db(p * k)];
}
const scaled = (x: Float32Array, g: number) => x.map((v) => v * g);
/** the rotor as it comes out from so far off, the helicopter and the ear coming together so fast */
const rotorOut = (dist: number, closing: number, indoors = false, under = 0) => {
  const r = rotorAt(dist, closing, indoors, under);
  // (the recording goes round: twice over, so that the filter has settled and its loudest tenth is of the second round)
  const once = wav(ROTOR.rec, r.rate), twice = new Float32Array(once.length * 2);
  twice.set(once);
  twice.set(once, once.length);
  const y = scaled(lowpass(twice, r.cutoff, 0.5), r.gain).subarray(once.length);
  return { ...r, out: out(y) };
};
/** a rifle shot of one's own, and a step at a run on grass, as test/everyday.test.ts works them out: what the rotor is set against */
const RIFLE = out(scaled(wav('shot_rifle'), 2.5))[0], STEP_RUN = -29.6, STEP_WALK = -35.0;

ok('the rotor\'s recording is there, one channel, and joins its own beginning', () => {
  const b = fs.readFileSync(path.join(SOUNDS, `${ROTOR.rec}.wav`));
  assert.equal(b.toString('latin1', 0, 4), 'RIFF');
  assert.deepEqual([b.readUInt16LE(20), b.readUInt16LE(22), b.readUInt16LE(34)], [1, 1, 16], 'not one channel of 16 bits, uncompressed');
  // (the rate it came at: put to another, its end would no longer meet its beginning)
  assert.equal(b.readUInt32LE(24), 48000);
  const frames = (b.length - 44) / 2, at = (j: number) => b.readInt16LE(44 + j * 2) / 32768;
  let step = 0, most = 0;
  for (let i = 1; i < frames; i++) {
    step += Math.abs(at(i) - at(i - 1));
    most = Math.max(most, Math.abs(at(i) - at(i - 1)));
  }
  const join = Math.abs(at(0) - at(frames - 1));
  console.log(`      ${frames} samples, ${(frames / 48000).toFixed(3)} s; where its end meets its beginning it steps ${join.toFixed(4)}, where neighbours step ${(step / frames).toFixed(4)} on average and ${most.toFixed(3)} at most`);
  assert.ok(join <= (step / frames) * 2, 'its end does not meet its beginning: it would click every time round');
  // it is as loud at its end as at its beginning (nothing has been let die away), and has no silence in it
  const part = (a: number, z: number) => Math.sqrt(Array.from({ length: z - a }, (_, i) => at(a + i) ** 2).reduce((s, v) => s + v, 0) / (z - a));
  const tenth = Math.floor(frames / 10), first = part(0, tenth), last = part(frames - tenth, frames);
  assert.ok(Math.abs(db(first) - db(last)) < 2, `its first tenth is ${db(first).toFixed(1)} dB and its last ${db(last).toFixed(1)}`);
});

ok('the rotor is loud under the helicopter, falls away with distance, and is still there at the far side of the map', () => {
  console.log(`      (set against: a rifle shot of one's own ${RIFLE.toFixed(1)} dB, a step at a run ${STEP_RUN}, a step at a walk ${STEP_WALK}: the loudest tenth of a second of each as it comes out)`);
  console.log('      how far      level    against under it   played at (still / coming at 40 m/s / going)   nothing above   comes out (loudest tenth; highest moment)');
  const rows = [0, 50, 150, 400, 800, 1500].map((d) => ({ d, still: rotorOut(d, 0), coming: rotorOut(d, AIRDROP.speed), going: rotorOut(d, -AIRDROP.speed) }));
  for (const r of rows) {
    const s = r.still;
    console.log(`      ${String(r.d).padStart(5)} m    ${s.gain.toFixed(3).padStart(6)}    ${(db(s.gain / ROTOR.level)).toFixed(1).padStart(6)} dB        x${s.rate.toFixed(3)} / x${r.coming.rate.toFixed(3)} / x${r.going.rate.toFixed(3)}                    ${String(Math.round(s.cutoff)).padStart(5)} Hz     ${s.out[0].toFixed(1).padStart(6)} dB; ${s.out[1].toFixed(1).padStart(5)} dB   (coming ${r.coming.out[0].toFixed(1)}, going ${r.going.out[0].toFixed(1)})`);
  }
  const [at0, at50, at150, at400, at800, at1500] = rows.map((r) => r.still);
  // LOUD: under it and near it, the loudest thing there is after a shot or a blast
  assert.ok(at0.out[0] > RIFLE - 6 && at0.out[0] < RIFLE, `under it, it comes out at ${at0.out[0].toFixed(1)} dB against a rifle shot's ${RIFLE.toFixed(1)}`);
  assert.equal(at50.gain, at0.gain, 'it is not as loud at 50 m as right under it');
  // it drowns a step (at a run) within a few tens of metres, by more than fifteen decibels; and is still over one at 150 m, by ten
  assert.ok(at50.out[0] - STEP_RUN > 15);
  assert.ok(at150.out[0] < at50.out[0] && at150.out[0] - STEP_RUN > 10, `at 150 m it comes out at ${at150.out[0].toFixed(1)} dB`);
  // it is clearly heard across the valley: at 400 m as loud as somebody running beside you
  assert.ok(at400.out[0] > STEP_RUN - 1, `at 400 m it comes out at ${at400.out[0].toFixed(1)} dB`);
  // and is still there, faintly, at the far side of the map: no quieter than something moved in the pockets
  assert.ok(at800.out[0] > STEP_WALK - 3 && at1500.out[0] > -46, `at 800 m ${at800.out[0].toFixed(1)} dB, at 1500 m ${at1500.out[0].toFixed(1)}`);
  // it falls away all the way out: never louder further off
  for (let d = 0, was = Infinity; d <= ROTOR.far; d += 25) {
    const g = rotorAt(d).gain;
    assert.ok(g <= was + 1e-12, `it is louder at ${d} m than nearer`);
    was = g;
  }
  assert.equal(rotorAt(ROTOR.far).gain, 0);
  assert.ok(rotorAt(2170).gain > 0, 'from corner to corner of the map it is not heard at all');
  // it does not break the sound up: its highest moment comes out under as loud as can be, the squeeze and the ceiling having held it
  for (const r of rows) for (const v of [r.still, r.coming, r.going]) assert.ok(v.out[1] < -0.5, `its highest moment comes out at ${v.out[1].toFixed(2)} dB`);
});

ok('"pitch it by distance": lower and duller the further off; higher coming toward the ear, lower going away', () => {
  let rate = Infinity, top = Infinity;
  for (let d = 0; d <= 2000; d += 50) {
    const r = rotorAt(d);
    assert.ok(r.rate <= rate + 1e-12 && r.cutoff <= top + 1e-9, `at ${d} m it is higher or brighter than nearer`);
    rate = r.rate;
    top = r.cutoff;
  }
  assert.equal(rotorAt(0).rate, 1);
  near(rotorAt(ROTOR.pitchBy).rate, ROTOR.pitchFar, 1e-12, 'its pitch from far off');
  near(rotorAt(0).cutoff, ROTOR.dull[0], 1e-6, 'its top from near');
  near(rotorAt(ROTOR.dullBy).cutoff, ROTOR.dull[1], 1e-6, 'its top from far');
  for (const d of [0, 50, 150, 400, 800]) {
    const still = rotorAt(d).rate, coming = rotorAt(d, AIRDROP.speed).rate, going = rotorAt(d, -AIRDROP.speed).rate;
    // as a real one is: by the speed of sound over the speed of sound less its own
    near(coming / still, ROTOR.sound / (ROTOR.sound - AIRDROP.speed), 1e-12, 'coming');
    near(going / still, ROTOR.sound / (ROTOR.sound + AIRDROP.speed), 1e-12, 'going');
    assert.ok(coming > still && going < still);
    // (and that changes its pitch, not how loud it is)
    assert.equal(rotorAt(d, AIRDROP.speed).gain, rotorAt(d).gain);
  }
  // under a roof it is muffled, and down in the bunker nearly gone
  const open = rotorAt(150), roof = rotorAt(150, 0, true), deep = rotorAt(150, 0, true, 1);
  assert.ok(roof.gain < open.gain && roof.cutoff <= ROTOR.indoors[1] && deep.gain < roof.gain * 0.2 && deep.cutoff <= ROTOR.under[1]);
  console.log(`      at 150 m: in the open ${open.gain.toFixed(3)} and nothing above ${Math.round(open.cutoff)} Hz; under a roof ${roof.gain.toFixed(3)} and ${Math.round(roof.cutoff)} Hz; down in the bunker ${deep.gain.toFixed(3)} and ${Math.round(deep.cutoff)} Hz`);
});

ok('heard from the ground as it flies in, holds and goes: louder as it comes, higher coming than going', () => {
  // somebody standing 60 m from the place, for the whole of one flight
  const f = flights[0], T = flightTimes(f), ear = { x: f.x + 60, y: f.y + 1.7, z: f.z };
  const heard = (t: number) => {
    const h = heliAt(f, t), dx = h.x - ear.x, dy = h.y - ear.y, dz = h.z - ear.z, d = Math.hypot(dx, dy, dz);
    return { d, ...rotorAt(d, -(h.vx * dx + h.vy * dy + h.vz * dz) / d) };
  };
  const line = (name: string, t: number) => {
    const r = heard(t);
    console.log(`      ${name.padEnd(34)} ${t.toFixed(1).padStart(6)} s   ${r.d.toFixed(0).padStart(5)} m off   level ${r.gain.toFixed(3)}   played at x${r.rate.toFixed(3)}   nothing above ${Math.round(r.cutoff)} Hz`);
    return r;
  };
  const start = line('it appears on the edge', 0), mid = line('half way in', T.arrive / 2), over = line('holding over the place', T.release), going = line('ten seconds after it starts away', T.leave + 10), end = line('at the edge again', T.gone - 0.1);
  assert.ok(start.gain < mid.gain && mid.gain < over.gain && going.gain < over.gain && end.gain < going.gain);
  assert.ok(mid.rate > rotorAt(mid.d).rate && going.rate < rotorAt(going.d).rate && over.rate === rotorAt(over.d).rate);
  // nowhere in the flight does what is asked of the sound jump: a twentieth of a second is never a step anybody would hear
  let was = heard(0);
  for (let t = 0.05; t < T.gone; t += 0.05) {
    const now = heard(t);
    assert.ok(Math.abs(db(now.gain) - db(was.gain)) < 0.5 && Math.abs(now.rate / was.rate - 1) < 0.012, `at ${t.toFixed(2)} s it steps from x${was.rate.toFixed(3)} to x${now.rate.toFixed(3)}, ${db(was.gain).toFixed(2)} to ${db(now.gain).toFixed(2)} dB`);
    was = now;
  }
});

// ------------------------------------------------------------------ the canopy, as it is built
const glb = (file: string) => {
  const b = fs.readFileSync(path.join(ROOT, 'public', file));
  assert.equal(b.toString('latin1', 0, 4), 'glTF');
  const len = b.readUInt32LE(12), json = JSON.parse(b.toString('utf8', 20, 20 + len));
  const bin = b.subarray(20 + len + 8);
  return { json, picture: (i: number) => { const v = json.bufferViews[json.images[i].bufferView]; return bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength); } };
};
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'manifest.json'), 'utf8'));
const canopy = manifest.models.parachute;
const pictures: string[] = [];
if (canopy) {
  for (const file of [canopy.url, canopy.hi].filter(Boolean)) {
    const g = glb(file);
    for (let i = 0; i < g.json.images.length; i++) {
      const meta = await sharp(g.picture(i)).metadata();
      pictures.push(`${file} picture ${i}: ${meta.width}x${meta.height}${meta.hasAlpha ? ' WITH CLEARNESS IN IT' : ''}`);
    }
  }
}
ok('the canopy is built solid: not seen through, both faces of its cloth drawn, no clearness left in its pictures', () => {
  assert.ok(canopy, 'the manifest has no parachute');
  for (const file of [canopy.url, canopy.hi]) {
    const g = glb(file);
    assert.equal(g.json.materials.length, 1);
    const m = g.json.materials[0];
    // (a material that does not say how it is to be drawn is drawn solid: OPAQUE is what is meant by saying nothing)
    assert.ok(m.alphaMode === undefined || m.alphaMode === 'OPAQUE', `${file} is drawn ${m.alphaMode}`);
    assert.equal(m.doubleSided, true, `${file}: only one face of its cloth is drawn`);
    assert.ok((m.pbrMetallicRoughness.baseColorFactor ?? [1, 1, 1, 1])[3] === 1, 'its colour is turned clear');
    assert.equal(m.emissiveTexture, undefined, 'its black picture of light is still in it');
    assert.ok(!(g.json.extensionsUsed ?? []).includes('KHR_materials_transmission'));
  }
  assert.ok(pictures.length >= 6 && !pictures.some((p) => p.includes('CLEARNESS')), pictures.join('\n          '));
  // twelve metres from where its lines meet to the top of the canopy, 8.1 across, standing on the point its lines meet at
  assert.deepEqual([canopy.min[1], canopy.max[1]], [0, 12]);
  near(canopy.max[0] - canopy.min[0], 8.09, 0.02, 'how wide it is');
  assert.equal(canopy.tris, canopy.srcTris, 'triangles were taken out of it');
  console.log(`      ${canopy.tris} triangles (all it came with); the world's copy ${(canopy.bytes / 1024).toFixed(0)} KB, the copy at the size it came ${(canopy.hiBytes / 1024 / 1024).toFixed(1)} MB (not fetched: nobody is ever nearer it than the crate)`);
  for (const p of pictures) console.log(`      ${p}`);
});

// ------------------------------------------------------------------ the real server, players over the wire
if (process.argv.includes('--server')) {
  const PORT = 8163, SITE = 8164;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let k = 0;
  class Player {
    ws!: WebSocket;
    got: (S2C & { at: number })[] = [];
    id = 0;
    welcome!: Extract<S2C, { t: 'welcome' }>;
    constructor(public name: string, public key = `airdrop-test-key-${name}-${String(++k).padStart(20, '0')}`) {}
    async join(): Promise<boolean> {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      this.ws.on('message', (d, bin) => !bin && this.got.push({ ...(JSON.parse(String(d)) as S2C), at: Date.now() }));
      await new Promise<void>((done, fail) => {
        this.ws.once('open', () => done());
        this.ws.once('error', fail);
      });
      this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
      for (let i = 0; i < 160 && !this.got.some((m) => m.t === 'welcome'); i++) await sleep(50);
      const w = this.got.find((m) => m.t === 'welcome') as Extract<S2C, { t: 'welcome' }> | undefined;
      if (!w) return false;
      this.welcome = w;
      this.id = w.you;
      return true;
    }
    send(m: unknown) {
      if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
    }
    stand(x: number, y: number, z: number, yaw = 0) {
      this.send({ t: 's', p: [x, y, z, yaw, 0, 1], w: null, m: [] });
    }
    all<T extends S2C['t']>(t: T) {
      return this.got.filter((m) => m.t === t) as (Extract<S2C, { t: T }> & { at: number })[];
    }
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-airdrop-'));
  // the site, standing here: it answers the server's one question (who has a role) and nothing else
  const ann = new Player('Ann'), ben = new Player('Ben');
  const roles = { [createHash('sha256').update(`zona key ${ann.key}`).digest('hex').slice(0, 40)]: { role: 'admin', name: 'Ann', by: 'the test', at: 0 } };
  const site = http.createServer((req, res) => {
    const here = (req.url ?? '').startsWith('/api/admin');
    res.writeHead(here ? 200 : 404, { 'content-type': 'application/json' });
    res.end(here ? JSON.stringify({ ok: true, set: true, state: { roles, bans: [] } }) : '{}');
  });
  await new Promise<void>((done) => site.listen(SITE, '127.0.0.1', done));
  // (the first drop a second after somebody turns up; no wreck comes down, whose cargo is told of as a drop too)
  const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), SITE_URL: `http://127.0.0.1:${SITE}`, DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', DROP_FIRST_S: '1', DROP_EVERY_S: '900', CRASH_FIRST_S: '99999' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logged = '';
  server.stdout!.on('data', (d) => (logged += d));
  server.stderr!.on('data', (d) => (logged += d));
  let wrong: unknown = null;
  const held = (name: string) => {
    n++;
    console.log(`  ok  ${name}`);
  };
  try {
    console.log('The real server, players over the wire');
    for (let i = 0; i < 600 && !logged.includes('listening'); i++) await sleep(100);
    assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
    for (let i = 0; i < 100 && !logged.includes('lists read from the site'); i++) await sleep(100);
    assert.ok(await ann.join(), 'Ann was not let in');
    assert.deepEqual(ann.welcome.flights, [], 'a helicopter was in the air before anybody was there');
    // ---- a drop is announced: the helicopter, and no crate
    for (let i = 0; i < 300 && !ann.all('heli+').length; i++) await sleep(100);
    const said = ann.all('heli+')[0];
    assert.ok(said, `no helicopter was sent within thirty seconds:\n${logged.slice(-400)}`);
    const f = said.f, T = flightTimes(f);
    assert.equal(f.age, 0);
    assert.equal(f.by, undefined);
    assert.ok(onEdge(f.fx, f.fz), 'it does not appear on the edge');
    assert.ok(lowest(f, ground) >= AIRDROP.clear - 0.5, 'it is not clear of the ground');
    assert.equal(ann.all('drop+').length, 0, 'the crate was told of with the helicopter');
    held(`a drop is announced as a helicopter, from the ${comesFrom(f)}, ${ways(f).in.toFixed(0)} m out: over the place in ${T.arrive.toFixed(1)} s, the crate down in ${T.land.toFixed(1)}, gone in ${T.gone.toFixed(1)}`);
    // Ann goes and stands where it is to come down, and tries to open what is not there yet
    ann.stand(f.x + 1, f.y, f.z);
    await sleep(8000);
    // ---- somebody who comes in now is told of the flight, with how long it has been in the air
    assert.ok(await ben.join(), 'Ben was not let in');
    const late = ben.welcome.flights?.find((x) => x.uid === f.uid);
    assert.ok(late, 'somebody who joined while it was in the air was not told of it');
    const { age, ...rest } = late, { age: _a, ...first } = f;
    assert.deepEqual(rest, first, 'it was told differently to somebody who joined late');
    const truly = ((ben.got.find((m) => m.t === 'welcome')!.at) - said.at) / 1000;
    near(age, truly, 0.6, 'how long it had been in the air, as the late joiner was told');
    assert.equal((ben.welcome.drops ?? []).filter((d) => d.uid === f.uid).length, 0, 'the late joiner was told of a crate that is not down');
    // (the two games: each puts it where its own clock says, and they are within a helicopter's length of each other)
    const a = heliAt(f, truly), b = heliAt(late, age);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < AIRDROP.speed * 0.6, 'the late joiner has it somewhere else');
    held(`a late joiner is told of the flight: ${age.toFixed(2)} s old when ${truly.toFixed(2)} s had gone by, and so has it within ${Math.hypot(a.x - b.x, a.z - b.z).toFixed(1)} m of where the first has it`);
    // ---- nothing can be opened before it lands: asked for, right up to a second before, nothing answers
    while (Date.now() - said.at < (T.land - 1) * 1000) {
      ann.send({ t: 'copen', cid: f.uid });
      await sleep(500);
    }
    assert.equal(ann.all('drop+').filter((m) => m.d.uid === f.uid).length, 0, 'the crate was told of before it was down');
    assert.equal(ann.got.filter((m) => (m.t === 'cdata' || m.t === 'cbusy') && m.cid === f.uid).length, 0, 'it was opened in the air');
    // ---- and when it has landed, the crate is told of: the one the flight brought, where it was for
    for (let i = 0; i < 80 && !ann.all('drop+').some((m) => m.d.uid === f.uid); i++) await sleep(50);
    const down = ann.all('drop+').find((m) => m.d.uid === f.uid);
    assert.ok(down, 'the crate was never told of');
    near((down.at - said.at) / 1000, T.land, 0.6, 'when the crate was told of, against when the flight says it lands');
    assert.deepEqual([down.d.x, down.d.y, down.d.z], [f.x, f.y, f.z]);
    near(down.d.rot, restAt(f.uid), 1e-9, 'which way round it stands');
    assert.ok(ben.all('drop+').some((m) => m.d.uid === f.uid), 'the late joiner was not told of the crate');
    ann.send({ t: 'copen', cid: f.uid });
    for (let i = 0; i < 60 && !ann.got.some((m) => m.t === 'cdata' && m.cid === f.uid); i++) await sleep(50);
    const inside = ann.got.find((m) => m.t === 'cdata' && m.cid === f.uid) as Extract<S2C, { t: 'cdata' }> | undefined;
    assert.ok(inside && inside.items.length > 10, 'it is down, and cannot be opened');
    held(`the crate is told of only when it has landed: ${((down.at - said.at) / 1000).toFixed(2)} s after the helicopter appeared, where the flight says ${T.land.toFixed(2)}; opened then, it holds ${inside.items.length} things`);
    // ---- a drop called on a radio comes the same way
    ben.stand(120, ground(120, 80), 80, 0);
    await sleep(300);
    ben.send({ t: 'radio' });
    for (let i = 0; i < 60 && ann.all('heli+').length < 2; i++) await sleep(50);
    const called = ann.all('heli+')[1];
    assert.ok(called, `a call on a radio sent no helicopter:\n${logged.slice(-400)}`);
    assert.equal(called.f.by, ben.id);
    near(called.f.x, 120, 1e-6, 'where a called drop is for');
    // (in front of whoever called, and far enough off to be seen coming down: the furthest of the places tried that is open ground)
    const off = 80 - called.f.z;
    assert.ok([...CALL.out, CALL.ahead].some((d) => Math.abs(off - d) < 1e-6), `a called drop is for ${off.toFixed(2)} m in front of whoever called`);
    if (off > CALL.ahead + 1e-6) near(called.f.y, ground(120, called.f.z), 1e-3, 'a called drop is for the ground, where it is not at the caller\'s feet');
    assert.ok(onEdge(called.f.fx, called.f.fz));
    // (one aircraft: a second call is not answered)
    ann.send({ t: 'radio' });
    for (let i = 0; i < 40 && !ann.all('radio-').length; i++) await sleep(50);
    assert.ok(ann.all('radio-').length === 1 && ann.all('heli+').length === 2, 'a second call was answered');
    held(`a drop called on a radio comes the same way: from the ${comesFrom(called.f)}, down in ${flightTimes(called.f).land.toFixed(1)} s, ${off.toFixed(0)} m in front of whoever called`);
    // ---- an admin sends one now, to a place by its numbers; somebody who is not an admin cannot
    ben.send({ t: 'chat', text: '/airdrop 100 -200' });
    await sleep(600);
    assert.equal(ann.all('heli+').length, 2, 'somebody with no role sent the helicopter');
    ann.send({ t: 'chat', text: '/airdrop 100 -200' });
    for (let i = 0; i < 60 && ann.all('heli+').length < 3; i++) await sleep(50);
    const sent = ann.all('heli+')[2];
    assert.ok(sent, `an admin's /airdrop sent no helicopter: ${JSON.stringify(ann.all('sys').slice(-2))}`);
    assert.deepEqual([sent.f.x, sent.f.z, sent.f.by], [100, -200, undefined]);
    near(sent.f.y, ground(100, -200), 1e-6, 'the ground where an admin sent it');
    assert.ok(onEdge(sent.f.fx, sent.f.fz) && lowest(sent.f, ground) >= AIRDROP.clear - 0.5);
    assert.ok(ben.all('heli+').some((m) => m.f.uid === sent.f.uid), 'the others were not told of the one an admin sent');
    const told = ann.all('sys').map((m) => m.text).find((t) => /helicopter/i.test(t));
    assert.ok(told, 'the admin was told nothing');
    held(`an admin's /airdrop sends one to the map numbers given, and nobody else's does: "${told}"`);
    ann.ws.close();
    ben.ws.close();
  } catch (e) {
    wrong = e;
  } finally {
    server.kill();
    site.close();
    await sleep(300);
    rmSync(dir, { recursive: true, force: true });
  }
  if (wrong) {
    failed.push('the real server');
    console.log(`  NOT OK  the real server\n          ${(wrong as Error).message}`);
  }
}

if (failed.length) {
  console.log(`\n${failed.length} NOT OK: ${failed.join('; ')}`);
  process.exit(1);
}
console.log(`\n${n} checks hold`);
process.exit(0);
