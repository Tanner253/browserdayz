// Checks of how loud the guns are heard (src/core/audio.ts), of 2026-10-13. No network, and nothing is played:
// `npx tsx test/gunsound.test.ts`.
//
// What was asked: "suprressed shots are too quiet, and bullet snaps are not loud enough near the player when being
// shot at from a silence and unsilenced gun, we want it to be more realistic". Nobody who set these could hear
// them. So what is held to here is worked out: from the recordings themselves (how loud each is, measured off its
// file), from the figures the engine plays them at, from the same sums it does to make up a crack or a thump, and
// from how a browser draws the squeeze on the way out. What it cannot say is how any of it sounds.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BUS, CRACK, QUIET, crackLevel, madeUp } from '../src/core/audio';
import { QUIETED, SOUND, crackOf, shotOf } from '../src/sim/gunplay';
import { ITEMS } from '../src/sim/items';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};
const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-12));
const lin = (d: number) => Math.pow(10, d / 20);
const SR = 48000;

// ---- the recordings, as they are on the disk
const SOUNDS = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'public', 'assets', 'sounds');
const read = new Map<string, Float32Array>();
function wav(name: string, rate = 1): Float32Array {
  const key = `${name} ${rate}`;
  if (!read.has(key)) read.set(key, load(name, rate));
  return read.get(key)!;
}
function load(name: string, rate: number): Float32Array {
  const b = fs.readFileSync(path.join(SOUNDS, `${name}.wav`));
  const from = b.readUInt32LE(24), frames = (b.length - 44) / 2;
  // (at the engine's rate, and played slower or faster as the engine plays it)
  const out = new Float32Array(Math.floor((frames * SR) / (from * rate)));
  for (let i = 0; i < out.length; i++) {
    const p = (i * from * rate) / SR, k = Math.floor(p), f = p - k;
    const at = (j: number) => (j < frames ? b.readInt16LE(44 + j * 2) / 32768 : 0);
    out[i] = at(k) * (1 - f) + at(k + 1) * f;
  }
  return out;
}
const peaks = new WeakMap<Float32Array, number>();
const peakOf = (x: Float32Array) => {
  if (!peaks.has(x)) peaks.set(x, x.reduce((m, v) => Math.max(m, Math.abs(v)), 0));
  return peaks.get(x)!;
};
/** how loud its first tenth of a second is (the measure scripts/sounds.mjs sets the recordings by) */
function loud(x: Float32Array, a = 0, b = 0.1): number {
  let s = 0;
  const i0 = Math.round(a * SR), i1 = Math.round(b * SR);
  for (let i = i0; i < i1; i++) s += (x[i] ?? 0) ** 2;
  return Math.sqrt(s / (i1 - i0));
}
const scaled = (x: Float32Array, k: number) => x.map((v) => v * k);
const mixed = (...xs: Float32Array[]) => Float32Array.from({ length: Math.max(...xs.map((x) => x.length)) }, (_, i) => xs.reduce((s, x) => s + (x[i] ?? 0), 0));

// ---- what the engine makes up, made here by the same sums
/** a gain that goes from one level to the next along a curve of constant ratio, as `exponentialRampToValueAtTime` does: [seconds, level] */
function ramped(points: [number, number][], len: number): Float32Array {
  const out = new Float32Array(Math.round(len * SR));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let k = points.findIndex(([at]) => at > t);
    if (k < 0) k = points.length;
    if (k === 0) out[i] = 0;
    else if (k === points.length) out[i] = points[k - 1][1];
    else {
      const [t0, v0] = points[k - 1], [t1, v1] = points[k];
      out[i] = v0 * Math.pow(v1 / v0, (t - t0) / (t1 - t0));
    }
  }
  return out;
}
/** noise with nothing in it under `hz` (the engine's own is as loud as noise can be, and filtered the same way) */
function hiss(hz: number, len: number, seed: number): Float32Array {
  let s = seed;
  const dice = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const w = (2 * Math.PI * hz) / SR, alpha = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w);
  const b0 = (1 + c) / 2 / (1 + alpha), b1 = -(1 + c) / (1 + alpha), a1 = (-2 * c) / (1 + alpha), a2 = (1 - alpha) / (1 + alpha);
  const out = new Float32Array(Math.round(len * SR));
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < out.length; i++) {
    const x = dice(), y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}
const shaped = (x: Float32Array, points: [number, number][]) => {
  const gain = ramped(points, x.length / SR);
  return x.map((v, i) => v * gain[i]);
};
const delayed = (x: Float32Array, by: number) => Float32Array.from({ length: x.length + Math.round(by * SR) }, (_, i) => x[i - Math.round(by * SR)] ?? 0);
/** the crack of a round that came within `miss` metres, as `whiz` makes it: the wave, and the wave off the ground */
function crackOfRound(miss: number, seed = 7): Float32Array {
  const level = crackLevel(miss), bounce = Math.hypot(miss, 2 * CRACK.ear);
  const [up, half, gone] = CRACK.shape;
  const wave = (peak: number, sd: number) => (peak < 0.01 ? new Float32Array(1) : shaped(hiss(1000, gone, sd), [[0, 0.0001], [up, peak], [half, peak * 0.5], [gone, 0.0001]]));
  return mixed(wave(level, seed), delayed(wave(level * CRACK.ground * Math.pow(miss / bounce, 0.75), seed + 1), (bounce - miss) / SOUND));
}
/** and as it was made before: a tick, placed so that it fell away from two metres */
function crackAsItWas(miss: number, seed = 7): Float32Array {
  if (miss >= 5) return new Float32Array(1);
  const peak = (0.5 + Math.max(0, 1 - miss / 5) * 0.9) * Math.min(1, 2 / miss);
  return shaped(hiss(3200, 0.05, seed), [[0, 0.0001], [0.0006, peak], [0.0206, 0.0001]]);
}
/** a shot through a suppressor as `gunshot` makes it: the recording, and the thump under it */
function quietShot(level: number, sonic: number): Float32Array {
  const rate = QUIET.rate[0] + (QUIET.rate[1] - QUIET.rate[0]) * sonic;
  const thump = new Float32Array(Math.round(0.26 * SR));
  const env = ramped([[0, 0.0001], [0.01, level * QUIET.thump], [0.18, 0.0001]], 0.26);
  let phase = 0;
  for (let i = 0; i < thump.length; i++) {
    phase += (2 * Math.PI * 150 * Math.pow(55 / 150, Math.min(1, i / SR / 0.1))) / SR;
    thump[i] = Math.sin(phase) * env[i];
  }
  return mixed(scaled(wav('shot_quiet', rate), level), thump);
}
const between = (a: number[], sonic: number) => a[0] + (a[1] - a[0]) * sonic;

// ---- what an open shot is played at: `gunshot` in src/core/audio.ts (2.5 a rifle, 2.2 a pistol, 0.72 of it for an
// automatic in the hands of whoever fires, full to `ref` metres and then falling as one over the distance) and
// VOICE in src/game/weapons.ts (which recording, and how much louder)
const OPEN: Record<string, { rec: string; own: number; far: number; ref: number }> = {
  mosin: { rec: 'shot_rifle', own: 2.5, far: 2.5, ref: 12 },
  ak: { rec: 'shot_ak', own: 2.5 * 0.72 * 1.15, far: 2.5 * 1.15, ref: 12 },
  ar15: { rec: 'shot_ar', own: 2.5 * 0.72, far: 2.5, ref: 12 },
  mpa: { rec: 'shot_pistol', own: 2.5 * 0.72 * 1.05, far: 2.5 * 1.05, ref: 12 },
  benelli: { rec: 'shot_shotgun', own: 2.5 * 1.5, far: 2.5 * 1.5, ref: 12 },
  m9: { rec: 'shot_pistol', own: 2.2, far: 2.2, ref: 8 },
  colt: { rec: 'shot_pistol', own: 2.2 * 1.2, far: 2.2 * 1.2, ref: 8 },
  deagle: { rec: 'shot_magnum', own: 2.2 * 1.5, far: 2.2 * 1.5, ref: 8 },
  mp7a1: { rec: 'shot_pistol', own: 2.5 * 0.72, far: 2.5, ref: 12 },
  dual_mac10: { rec: 'shot_pistol', own: 2.5 * 0.72 * 1.15, far: 2.5 * 1.15, ref: 12 },
};
/** how much of a sound placed in the world is left at a distance (`out` in the engine: the panner's own sum) */
const placed = (ref: number, rolloff: number, d: number) => ref / (ref + rolloff * (Math.max(d, ref) - ref));
/** above this nothing of it is left at that distance, Hz (`out` again) */
const top = (d: number, dull: number) => Math.max(700, 18000 - d * dull * 40);
/** the guns a suppressor goes on, and how much of a crack each one's round still makes through it */
const quieted = Object.values(ITEMS).filter((d) => d.attach?.quiet).flatMap((d) => d.attach!.fits);
const sonicOf = (id: string) => crackOf(shotOf(id).muzzleVel * QUIETED);
/** what a quieted shot was played at, before: one level for every gun, falling away faster than an open shot and duller */
const WAS = { own: 1.1, far: 1.6, ref: 5, rolloff: 1.6, dull: 3 };

// ---- the way out, as a browser makes it. The curve of a squeeze below its threshold is a straight line and above
// its knee a straight line (in decibels); between the two it is the browser's to draw, and Chrome, Safari and
// Firefox all draw it with the one piece of code, which is this. What a squeeze adds back by itself is in the
// standard. This is where a steady sound comes out: a squeeze looks six thousandths of a second ahead, so the
// front of a shot is caught too, but how exactly it rides one is not worked out here.
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
/** how loud something comes out that went in so loud (1: as loud as a loudspeaker can be asked to go; over it, its top is cut off), and how loud it came out before there was a ceiling */
const comesOut = (x: number) => held(pressed(x * BUS.master) / madeUp(BUS.ceiling));
const cameOut = (x: number) => pressed(x * BUS.master);

ok('a crack is at its loudest within a yard and a half, and dies away smoothly to nothing by nine metres', () => {
  assert.equal(crackLevel(0), CRACK.peak);
  assert.equal(crackLevel(CRACK.near), CRACK.peak);
  assert.ok(CRACK.near === 1.5 && CRACK.far >= 8 && CRACK.far <= 10);
  let nearer = crackLevel(0);
  for (let m = 0.05; m <= 12; m += 0.05) {
    const now = crackLevel(m);
    assert.ok(now <= nearer + 1e-12, `it is louder at ${m.toFixed(2)} m than nearer`);
    assert.ok(nearer - now < CRACK.peak * 0.03, `it falls ${(nearer - now).toFixed(3)} in five centimetres at ${m.toFixed(2)} m: a step`);
    nearer = now;
  }
  assert.ok(crackLevel(3) > CRACK.peak * 0.5 && crackLevel(5) > CRACK.peak * 0.3, 'it is gone too soon');
  assert.ok(crackLevel(CRACK.far - 0.25) > 0 && crackLevel(CRACK.far - 0.25) < CRACK.peak * 0.01, 'it does not die away to nothing: it stops');
  assert.equal(crackLevel(CRACK.far), 0);
  assert.equal(crackLevel(50), 0);
  // (and at every distance it was heard at before, it is louder than it was: by half as much again and more)
  for (let m = 0.2; m < 5; m += 0.2) {
    const was = (0.5 + (1 - m / 5) * 0.9) * Math.min(1, 2 / m);
    assert.ok(crackLevel(m) > was * 1.4, `at ${m.toFixed(1)} m it was ${was.toFixed(2)} and is ${crackLevel(m).toFixed(2)}`);
  }
});

ok('a crack close by is the loudest thing whoever is shot at hears: louder than the report that comes after it', () => {
  const crack = crackOfRound(1), was = crackAsItWas(1);
  const report = (id: string, d: number) => scaled(wav(OPEN[id].rec), OPEN[id].far * placed(OPEN[id].ref, 1, d));
  console.log(`      a crack at 1 m: at its loudest ${peakOf(crack).toFixed(2)} (it was ${peakOf(was).toFixed(2)}), ${db(loud(crack)).toFixed(1)} dB over its first tenth of a second (it was ${db(loud(was)).toFixed(1)})`);
  for (const d of [25, 50, 100, 200, 400]) console.log(`      an AK's report from ${d} m: at its loudest ${peakOf(report('ak', d)).toFixed(2)}, ${db(loud(report('ak', d))).toFixed(1)} dB`);
  assert.ok(db(loud(crack)) > db(loud(was)) + 10 && peakOf(crack) > peakOf(was) * 1.3, 'it carries no more than the tick it was');
  // (louder at its loudest than a rifle's report from twenty metres, and than all of the report from fifty; from a hundred, twice over)
  for (const id of ['ak', 'ar15', 'mosin']) {
    assert.ok(peakOf(crack) > peakOf(report(id, 20)), `${id}: its report from 20 m is sharper than the crack`);
    assert.ok(loud(crack) > loud(report(id, 60)), `${id}: its report from 60 m is louder than the crack`);
    assert.ok(loud(crack) > loud(report(id, 120)) * 2, `${id}: its report from 120 m is half as loud as the crack, or more`);
  }
  // (and whatever the gun was fired through: a quieted rifle's report from fifty metres is a tenth of it)
  const hushed = scaled(quietShot(QUIET.far[1], 1), placed(QUIET.ref, QUIET.rolloff, 50));
  assert.ok(loud(crack) > loud(hushed) * 4, 'a quieted report from 50 m is not far under the crack');
  // (it is not louder than a shot of one's own)
  assert.ok(peakOf(crack) <= OPEN.mosin.own * peakOf(wav('shot_rifle')) * 1.02 && loud(crack) < loud(scaled(wav('shot_ar'), OPEN.ar15.own)), 'a crack is louder than firing a rifle');
  // (further off it is less: at five metres under half, and still more than the whole of it was at one)
  assert.ok(loud(crackOfRound(5)) < loud(crack) * 0.5 && loud(crackOfRound(5)) > loud(was));
});

ok('through a suppressor a shot is still a shot: louder than it was, and never as loud as an open one', () => {
  assert.deepEqual([...quieted].sort(), ['a91', 'ak', 'ar15', 'benelli', 'colt', 'deagle', 'dual_mac10', 'm9', 'mosin', 'mp7a1', 'mpa']);
  // (a 9 mm or a .45 from a pistol is slower than sound once quieted, and has no crack; a rifle's round has all of its own)
  assert.ok(sonicOf('m9') === 0 && sonicOf('colt') === 0 && sonicOf('mosin') === 1 && sonicOf('ak') === 1 && sonicOf('ar15') === 1);
  assert.ok(sonicOf('mpa') > 0 && sonicOf('mpa') < 0.2 && sonicOf('benelli') < 0.3);
  for (const id of quieted) {
    // (the 9A-91 is quieted with a recording of its own, the VSSK's, not the can every other gun shares)
    if (id === 'a91') continue;
    const open = scaled(wav(OPEN[id].rec), OPEN[id].own);
    const now = quietShot(between(QUIET.own, sonicOf(id)), sonicOf(id)), was = scaled(wav('shot_quiet'), WAS.own);
    const under = db(loud(open)) - db(loud(now)), wasUnder = db(loud(open)) - db(loud(was));
    console.log(`      ${id.padEnd(8)} at the ears of whoever fires: open ${db(loud(open)).toFixed(1)} dB (at its loudest ${peakOf(open).toFixed(2)}); quieted ${db(loud(now)).toFixed(1)} dB (${peakOf(now).toFixed(2)}), ${under.toFixed(1)} under it; it was ${db(loud(was)).toFixed(1)} dB (${peakOf(was).toFixed(2)}), ${wasUnder.toFixed(1)} under`);
    assert.ok(db(loud(now)) > db(loud(was)) + 3, `${id}: quieted, it is no louder than it was`);
    assert.ok(under > 5, `${id}: quieted it is ${under.toFixed(1)} dB under the open shot: as good as open`);
    assert.ok(peakOf(now) < peakOf(open) * 0.9, `${id}: quieted it is as loud at its loudest as open`);
    // (and what follows the shot is far under an open shot's: it has no long roar)
    assert.ok(db(loud(open, 0.1, 0.4)) - db(loud(now, 0.1, 0.4)) > 8, `${id}: quieted, it rings on as an open shot does`);
  }
  // (the rifles are no longer a quarter as loud as open, which is what was too quiet: under half, and over a third)
  for (const id of ['ak', 'ar15']) {
    const under = db(loud(scaled(wav(OPEN[id].rec), OPEN[id].own))) - db(loud(quietShot(between(QUIET.own, 1), 1)));
    assert.ok(under < 9, `${id}: quieted it is ${under.toFixed(1)} dB under open`);
  }
  // (a quieted rifle is louder than a quieted 9 mm, and deeper; and each sends less to the hills than any open shot does)
  assert.ok(loud(quietShot(QUIET.own[1], 1)) > loud(quietShot(QUIET.own[0], 0)) * 1.15 && QUIET.rate[1] < QUIET.rate[0]);
  assert.ok(QUIET.send[1] < 0.6 * 0.75 && QUIET.send[0] < QUIET.send[1]);
});

ok('and it is heard as far off as it would be: a rifle plainly at a hundred and fifty metres, a 9 mm less', () => {
  const quiet = (sonic: number, d: number) => between(QUIET.far, sonic) * peakOf(wav('shot_quiet')) * placed(QUIET.ref, QUIET.rolloff, d);
  const was = (d: number) => WAS.far * peakOf(wav('shot_quiet')) * placed(WAS.ref, WAS.rolloff, d);
  const open = (id: string, d: number) => OPEN[id].far * peakOf(wav(OPEN[id].rec)) * placed(OPEN[id].ref, 1, d);
  for (const d of [10, 25, 50, 100, 150, 300]) console.log(`      from ${String(d).padStart(3)} m, at its loudest: a quieted rifle ${quiet(1, d).toFixed(3)} (nothing of it above ${top(d, QUIET.dull[1])} Hz), a quieted 9 mm ${quiet(0, d).toFixed(3)} (${top(d, QUIET.dull[0])} Hz); either was ${was(d).toFixed(3)} (${top(d, WAS.dull)} Hz); an open rifle ${open('mosin', d).toFixed(3)}, an open 9 mm ${open('m9', d).toFixed(3)} (${top(d, 1)} Hz)`);
  for (let d = 1; d <= 600; d += 1) {
    assert.ok(quiet(0, d) < quiet(1, d) * 0.75, `at ${d} m a quieted 9 mm is as loud as a quieted rifle`);
    assert.ok(quiet(0, d) > was(d) && quiet(1, d) > was(d) * 1.4, `at ${d} m it is quieter than it was`);
    for (const id of ['mosin', 'ak', 'ar15']) assert.ok(quiet(1, d) < open(id, d) * 0.8 && (d < 12 || quiet(1, d) < open(id, d) * 0.45), `at ${d} m a quieted rifle is as loud as an open ${id}`);
    assert.ok(quiet(0, d) < open('m9', d) * 0.65 && (d < 8 || quiet(0, d) < open('m9', d) * 0.45), `at ${d} m a quieted 9 mm is as loud as an open one`);
  }
  // (plainly heard: a quieted rifle at 150 m is as loud as an open one at 400 m, which nobody misses; well over
  // twice what it was at a hundred, and with most of its top still on it, where it had none left past 144 m)
  assert.ok(quiet(1, 150) > open('mosin', 420) && quiet(1, 100) > was(100) * 2.5);
  assert.ok(top(150, QUIET.dull[1]) >= 8000 && top(150, WAS.dull) === 700);
  // (a 9 mm less: under three quarters of the rifle anywhere, but half as loud again as it was; and it has lost more of its top)
  assert.ok(quiet(0, 50) > was(50) * 1.5 && quiet(0, 100) > was(100) * 1.5 && top(150, QUIET.dull[0]) < top(150, QUIET.dull[1]) && top(150, QUIET.dull[0]) >= 5000);
  // (and neither carries as an open shot does: there is nothing of the 9 mm but a thud past 220 m, nor of the rifle past 300, where an open shot has a third of its top yet)
  assert.equal(top(220, QUIET.dull[0]), 700);
  assert.equal(top(300, QUIET.dull[1]), 700);
  assert.ok(top(300, 1) > 5000);
});

ok('nothing is cut off at the top: what comes out is under as loud as can be, whatever is heard at once', () => {
  // (the ceiling takes back what it adds by itself, and what never reaches it comes out as it did)
  for (const x of [0.01, 0.1, 0.5, 1, 1 / BUS.master]) assert.ok(Math.abs(db(comesOut(x)) - db(cameOut(x))) < 0.02, `something that goes in at ${x} comes out changed`);
  // (what is louder by this change, each by itself; and the loudest things there were, which went over)
  const shotQuiet = peakOf(wav('shot_quiet'));
  const loudest: [string, number][] = [
    ['a crack within a yard and a half', peakOf(crackOfRound(1))],
    ['a crack, at the most its noise can come to', CRACK.peak * 1.25],
    ['a quieted rifle, one\'s own', peakOf(quietShot(QUIET.own[1], 1))],
    ['a quieted rifle, one\'s own, if crack and thump fell together', QUIET.own[1] * (shotQuiet + QUIET.thump)],
    ['a quieted rifle at one\'s elbow', QUIET.far[1] * (shotQuiet + QUIET.thump)],
    ['an open AK, one\'s own', OPEN.ak.own * peakOf(wav('shot_ak'))],
    ['the sniper rifle, one\'s own', OPEN.mosin.own * peakOf(wav('shot_rifle'))],
    ['the shotgun, one\'s own', OPEN.benelli.own * peakOf(wav('shot_shotgun'))],
    ['a crack, one\'s own sniper rifle and an AK at one\'s elbow, all at once', CRACK.peak * 1.25 + OPEN.mosin.own * 0.92 + OPEN.ak.far * 0.92],
  ];
  for (const [what, x] of loudest) {
    console.log(`      ${what}: goes in at ${x.toFixed(2)} (${db(x * BUS.master).toFixed(1)} dB over as loud as can be, after the master); comes out ${db(comesOut(x)).toFixed(2)} dB (it would have, without the ceiling, ${db(cameOut(x)).toFixed(2)})`);
    assert.ok(db(comesOut(x)) < -0.5, `${what}: comes out ${db(comesOut(x)).toFixed(2)} dB`);
  }
  // (which is why there is a ceiling: the biggest guns' own shots came out over the top, and so would a crack with a shot)
  assert.ok(cameOut(OPEN.benelli.own * 0.92) > 1 && cameOut(OPEN.mosin.own * 0.92) > 1);
  // (and nothing that could ever be asked of it comes out over: ten shots at once do not)
  for (let x = 0.05; x < 40; x *= 1.07) assert.ok(comesOut(x) < 0.97, `something that goes in at ${x.toFixed(1)} comes out at ${comesOut(x).toFixed(3)}`);
  // (what the crack and the quieted shot are by themselves would not have gone over even without it)
  assert.ok(cameOut(peakOf(crackOfRound(1))) < 1.01 && cameOut(peakOf(quietShot(QUIET.own[1], 1))) < 1);
});

console.log(`\n${n} checks passed`);
