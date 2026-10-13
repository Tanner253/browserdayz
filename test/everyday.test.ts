// Checks of the recordings of what a body does all day (src/core/audio.ts: EVERYDAY), of 2026-10-13. No network,
// no browser, and nothing is played: `npx tsx test/everyday.test.ts`.
//
// What was asked: "our sounds for drinking and doing basically everything can and should get rehauled", with
// recordings in place of what the game made up. Nobody who chose or levelled them could hear them. So what is
// held to here is worked out, as test/gunsound.test.ts works the guns out: from the files themselves, from the
// figures the engine plays them at, from the same sums it did to make up the sound each replaces, and from how a
// browser draws the squeeze on the way out. It says that every file is there and is what the others are, that a
// footstep sits well under a shot and is no louder than the one it replaces was, and that nothing begins late.
// What it cannot say is how any of it sounds: `?sounds` on the dev page is where that is heard.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BUS, EVERY, EVERYDAY, STEPS, STEP_GAIN, TAKEN, handling, madeUp } from '../src/core/audio';
import { ITEMS } from '../src/sim/items';

let n = 0;
const failed: string[] = [];
/** (every check is run and its figures printed, whether or not the one before it held: they are what is looked at when a level is set) */
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
const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-12));
const lin = (d: number) => Math.pow(10, d / 20);
const SR = 48000;
const SOUNDS = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'public', 'assets', 'sounds');
const fileOf = (name: string, k: number) => `${name}${k ? `_${k + 1}` : ''}`;

// ---- the recordings, as they are on the disk, at the engine's rate and played as fast as the engine plays them
const read = new Map<string, Float32Array>();
function wav(name: string, rate = 1): Float32Array {
  const key = `${name} ${rate}`;
  if (read.has(key)) return read.get(key)!;
  const b = fs.readFileSync(path.join(SOUNDS, `${name}.wav`));
  const from = b.readUInt32LE(24), frames = (b.length - 44) / 2;
  const out = new Float32Array(Math.floor((frames * SR) / (from * rate)));
  for (let i = 0; i < out.length; i++) {
    const p = (i * from * rate) / SR, k = Math.floor(p), f = p - k;
    const at = (j: number) => (j < frames ? b.readInt16LE(44 + j * 2) / 32768 : 0);
    out[i] = at(k) * (1 - f) + at(k + 1) * f;
  }
  read.set(key, out);
  return out;
}

// ---- sums
const peakOf = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
/** how loud its loudest tenth of a second is */
function loud(x: Float32Array): number {
  const w = SR / 10;
  let run = 0, best = 0;
  for (let i = 0; i < x.length; i++) {
    run += x[i] * x[i];
    if (i >= w) run -= x[i - w] * x[i - w];
    best = Math.max(best, run / w);
  }
  return Math.sqrt(best);
}
/** several sounds laid over one another: [the sound, how loud, seconds after the first] */
function mixed(...parts: [Float32Array, number, number?][]): Float32Array {
  const out = new Float32Array(Math.max(...parts.map(([x, , at = 0]) => x.length + Math.round(at * SR))));
  for (const [x, g, at = 0] of parts) {
    const o = Math.round(at * SR);
    for (let i = 0; i < x.length; i++) out[o + i] += x[i] * g;
  }
  return out;
}
/** a filter as a browser makes one (the Q of a low or a high pass is in decibels, of a band pass a plain number) */
function filtered(x: Float32Array, type: 'lowpass' | 'highpass' | 'bandpass', hz: number, q: number): Float32Array {
  const w = (2 * Math.PI * Math.min(hz, SR * 0.49)) / SR, c = Math.cos(w);
  const alpha = type === 'bandpass' ? Math.sin(w) / (2 * q) : Math.sin(w) / (2 * Math.pow(10, q / 20));
  const [b0, b1, b2] = type === 'lowpass' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : type === 'highpass' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [alpha, 0, -alpha];
  const a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha;
  const out = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}
/** the engine's noise: as loud as noise can be */
function hiss(len: number, seed: number): Float32Array {
  let s = seed;
  return Float32Array.from({ length: Math.round(len * SR) }, () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1);
}
/** a level that goes from point to point: along a curve of constant ratio ('exp', as `exponentialRampToValueAtTime`) or a straight line */
function shaped(x: Float32Array, points: [at: number, level: number, how?: 'line'][]): Float32Array {
  return x.map((v, i) => {
    const t = i / SR;
    let k = points.findIndex(([at]) => at > t);
    if (k === 0) return 0;
    if (k < 0) return v * points[points.length - 1][1];
    const [t0, v0] = points[k - 1], [t1, v1, how] = points[k], f = (t - t0) / (t1 - t0);
    return v * (how === 'line' ? v0 + (v1 - v0) * f : v0 * Math.pow(v1 / v0, f));
  });
}
/** the engine's `env`: up to a peak and away again */
const env = (x: Float32Array, peak: number, a: number, d: number) => shaped(x, [[0, 0.0001], [a, peak], [a + d, 0.0001]]);
/** a note that falls from one pitch to another, as the engine's thumps do */
function thump(from: number, to: number, over: number, len: number): Float32Array {
  const out = new Float32Array(Math.round(len * SR));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    phase += (2 * Math.PI * from * Math.pow(to / from, Math.min(1, i / SR / over))) / SR;
    out[i] = Math.sin(phase);
  }
  return out;
}

// ---- the way out, as a browser makes it (the same sums as test/gunsound.test.ts: see there)
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
/** How loud a sound comes out, [its loudest tenth of a second, its highest moment] in decibels under as loud as can be: the whole of it turned down by as much as the squeeze turns its highest moment down. */
function out(x: Float32Array): [number, number] {
  const p = peakOf(x), k = p > 0 ? comesOut(p) / p : 1;
  return [db(loud(x) * k), db(p * k)];
}

// ---- what the engine plays, by the same sums

/** one's own feet are a little to one side and then the other: what the nearer ear gets of them */
const SIDE = Math.sin((((0.14 + 1) / 2) * Math.PI) / 2);
const volOf = (speed: number) => Math.min(1, 0.15 + speed * 0.07) * 3.2;
const takes = (name: string) => Array.from({ length: EVERYDAY[name] }, (_, k) => fileOf(name, k));

/** a recorded step of one's own, as `step` plays it: each take of it */
function stepNow(surface: string, speed: number, vol = volOf(speed)): Float32Array[] {
  const [name, level, over, overLevel = 0] = STEPS[surface];
  const rate = 0.93 + Math.min(speed, 7) * 0.02, tone = Math.min(16000, 1400 + speed * 2600);
  return takes(name).map((f, k) => {
    const parts: [Float32Array, number, number?][] = [[wav(f, rate), vol * level * STEP_GAIN]];
    if (over) parts.push([wav(takes(over)[k % EVERYDAY[over]], rate), vol * overLevel * STEP_GAIN]);
    const x = filtered(mixed(...parts), 'lowpass', tone, 0.5);
    return mixed([x, SIDE], ...(surface === 'gravel' ? [[grit(vol, k), SIDE] as [Float32Array, number]] : []));
  });
}
/** one layer of a made-up step: hiss through a filter, up and away */
const layer = (type: 'lowpass' | 'highpass' | 'bandpass', hz: number, q: number, v: number, a: number, d: number, seed: number) => env(filtered(hiss(a + d + 0.02, seed), type, hz, q), v, a, d);
/** the grit of gravel, which is made up still */
const grit = (vol: number, seed: number) => mixed(...[0, 1, 2, 3, 4].map((i) => [layer('bandpass', 2500 + i * 700, 3, 0.18 * vol, 0.001, 0.03, 11 + seed * 7 + i), 1, i * 0.014] as [Float32Array, number, number]));
/** the step that was made up, before there was a recording */
function stepWas(surface: string, speed: number, seed = 3): Float32Array {
  const vol = volOf(speed);
  const parts: [Float32Array, number, number?][] =
    surface === 'wood' ? [[layer('bandpass', 320, 1.2, 1.7 * vol, 0.003, 0.07, seed), 1], [layer('bandpass', 1400, 3, 0.4 * vol, 0.002, 0.05, seed + 1), 1, 0.01]]
    : surface === 'gravel' || surface === 'rock' ? [[grit(vol, seed), 1], [layer('lowpass', 500, 1, 0.3 * vol, 0.004, 0.06, seed + 9), 1]]
    : surface === 'concrete' || surface === 'asphalt' ? [[layer('bandpass', 900, 1.2, 0.8 * vol, 0.002, 0.05, seed), 1], [layer('highpass', 4000, 1, 0.16 * vol, 0.001, 0.03, seed + 1), 1, 0.01]]
    : surface === 'metal' ? [[layer('bandpass', 1800, 8, 0.4 * vol, 0.002, 0.12, seed), 1]]
    : surface === 'dirt' ? [[layer('lowpass', 700, 1, 0.45 * vol, 0.006, 0.08, seed), 1]]
    : [[layer('highpass', 2500, 0.6, 0.16 * vol, 0.02, 0.12, seed), 1], [layer('lowpass', 380, 1, 0.3 * vol, 0.006, 0.07, seed + 1), 1]];
  return mixed([mixed(...parts), SIDE]);
}
/** the middle of how loud several takes come out, and the highest moment of any */
function middle(xs: Float32Array[]): [number, number] {
  const all = xs.map(out);
  return [all.reduce((s, [l]) => s + l, 0) / all.length, Math.max(...all.map(([, p]) => p))];
}
const wasSeeds = (f: (seed: number) => Float32Array) => middle([3, 17, 29, 41, 53].map(f));

const WALK = 1.8, RUN = 5.5, CROUCH = WALK * 0.4;
const rifle = out(mixed([wav('shot_rifle'), 2.5]))[0], pistol = out(mixed([wav('shot_pistol'), 2.2]))[0];
const row = (what: string, now: [number, number], was?: [number, number]) =>
  console.log(`      ${what.padEnd(44)} ${now[0].toFixed(1).padStart(6)} dB (top ${now[1].toFixed(1).padStart(5)})   ${was ? `was ${was[0].toFixed(1).padStart(6)} dB (top ${was[1].toFixed(1).padStart(5)})   ${(now[0] - was[0] >= 0 ? '+' : '') + (now[0] - was[0]).toFixed(1)}` : 'was silent'}`);
/** (what does not hold is gathered, so that the whole table is printed before any of it is said) */
const hold = (wrong: string[]) => assert.equal(wrong.join('; '), '');

console.log('The recordings of what a body does all day');

ok('every recording the engine asks for is on the disk, and is what the others are: one channel, 16 bits, not compressed', () => {
  let bytes = 0;
  for (const [name, count] of Object.entries(EVERYDAY)) {
    for (const f of takes(name)) {
      const b = fs.readFileSync(path.join(SOUNDS, `${f}.wav`));
      bytes += b.length;
      assert.equal(b.toString('latin1', 0, 4) + b.toString('latin1', 8, 16), 'RIFFWAVEfmt ', `${f} is not a WAV`);
      assert.deepEqual([b.readUInt16LE(20), b.readUInt16LE(22), b.readUInt16LE(34)], [1, 1, 16], `${f}: plain PCM, one channel, 16 bits`);
      assert.ok([32000, 44100].includes(b.readUInt32LE(24)), `${f}: at 32000 or 44100, as the rest are`);
      assert.ok((b.length - 44) / 2 / b.readUInt32LE(24) <= 1, `${f} is over a second long`);
    }
    // (and no more takes of it lying about than the engine knows of: one that is not asked for is never heard)
    assert.ok(!fs.existsSync(path.join(SOUNDS, `${fileOf(name, count)}.wav`)), `${name} has a take the engine does not ask for`);
  }
  console.log(`      ${Object.values(EVERYDAY).reduce((s, c) => s + c, 0)} files, ${bytes} bytes: fetched after the guns, once the sound is started`);
});

ok('none of them begins late: each is at a tenth of its loudest within 15 thousandths of a second', () => {
  for (const name of Object.keys(EVERYDAY)) {
    for (const f of takes(name)) {
      const x = wav(f), p = peakOf(x);
      const at = x.findIndex((v) => Math.abs(v) >= p * 0.1) / SR;
      assert.ok(at <= 0.015, `${f} begins ${at.toFixed(3)} s into its file`);
    }
  }
});

ok('every ground there is has a step, and no two takes of anything are the same sound', () => {
  for (const s of ['grass', 'dirt', 'gravel', 'rock', 'wood', 'metal', 'concrete', 'asphalt', 'flesh', 'foliage', 'glass', 'plaster', 'cloth', 'snow']) assert.ok(STEPS[s] && EVERYDAY[STEPS[s][0]] >= 3, `${s} has no recorded step`);
  for (const name of Object.keys(EVERYDAY)) {
    const seen = new Set(takes(name).map((f) => fs.readFileSync(path.join(SOUNDS, `${f}.wav`)).toString('base64')));
    assert.equal(seen.size, EVERYDAY[name], `${name}: two of its takes are one sound`);
  }
});

ok('a step sits well under a shot, and is as loud as the made-up step on grass was, whatever the ground: within 3 dB of it', () => {
  console.log(`      (a rifle shot of one's own comes out at ${rifle.toFixed(1)} dB, a pistol's at ${pistol.toFixed(1)}: the loudest tenth of a second of each)`);
  const wrong: string[] = [];
  for (const s of ['grass', 'dirt', 'concrete', 'asphalt', 'rock', 'gravel', 'wood', 'metal', 'snow']) {
    for (const [how, speed, under] of [['walking', WALK, 22], ['running', RUN, 17], ['crouched', CROUCH, 24]] as const) {
      const now = middle(stepNow(s, speed));
      row(`${s}, ${how}`, now, s === 'snow' ? undefined : wasSeeds((sd) => stepWas(s, speed, sd)));
      const grassWas = wasSeeds((sd) => stepWas('grass', speed, sd))[0];
      if (Math.abs(now[0] - grassWas) > 3) wrong.push(`${how} on ${s} is ${(now[0] - grassWas).toFixed(1)} dB off what a step on grass was`);
      if (now[0] > rifle - under || now[0] > pistol - under + 4) wrong.push(`${how} on ${s} comes out at ${now[0].toFixed(1)} dB: not ${under} dB under a rifle`);
    }
  }
  hold(wrong);
});

ok('a step is quieter crouched than walking, and walking than running, on every ground', () => {
  for (const s of Object.keys(STEPS)) {
    const [c, w, r] = [CROUCH, WALK, RUN].map((v) => middle(stepNow(s, v))[0]);
    assert.ok(c < w - 1.5 && w < r - 3, `${s}: crouched ${c.toFixed(1)}, walking ${w.toFixed(1)}, running ${r.toFixed(1)}`);
  }
});

ok('no take of a step is far off the others of its ground: within 4 dB of their middle', () => {
  for (const s of ['grass', 'dirt', 'concrete', 'wood', 'metal', 'snow']) {
    const each = stepNow(s, RUN).map((x) => out(x)[0]), mid = each.reduce((a, b) => a + b, 0) / each.length;
    for (const [k, l] of each.entries()) assert.ok(Math.abs(l - mid) <= 4, `take ${k + 1} of a step on ${s} is ${(l - mid).toFixed(1)} dB off the rest`);
  }
});

/** a landing, as `land` plays it: a step, the weight of the body, and the other foot */
const landNow = (surface: string, speed: number) => {
  const k = Math.min(1, speed / 11), s = 3 + k * 5, L = EVERY.land;
  return takes('thud').map((f, i) => mixed([stepNow(surface, s)[i % 3], 1], [wav(f, L.rate[0] + k * L.rate[1]), L.thud[0] + k * L.thud[1], 0.012], [stepNow(surface, s, Math.min(1, 0.36 + k * 0.35) * 3.2 * L.other)[(i + 1) % 3], 1, 0.03 + k * 0.02]));
};
const landWas = (surface: string, speed: number, seed: number) => {
  const k = Math.min(1, speed / 11);
  return mixed([stepWas(surface, 3 + k * 5, seed), 1], [env(thump(110, 42, 0.14, 0.25), 0.15 + k * 0.55, 0.003, 0.14), 1]);
};
ok('a landing is louder than a step and under a shot, louder from a height than from a hop, and within 2 dB of what it was', () => {
  const hop = middle(landNow('grass', 3.5)), high = middle(landNow('concrete', 9));
  const hopWas = wasSeeds((sd) => landWas('grass', 3.5, sd)), highWas = wasSeeds((sd) => landWas('concrete', 9, sd));
  row('landing from a hop, on grass', hop, hopWas);
  row('landing from a height, on concrete', high, highWas);
  assert.ok(hop[0] > middle(stepNow('grass', RUN))[0] && high[0] > hop[0] + 3 && high[0] < rifle - 7, 'a landing is out of its place');
  assert.ok(Math.abs(hop[0] - hopWas[0]) <= 2 && Math.abs(high[0] - highWas[0]) <= 2, 'a landing is not as loud as it was');
});

/** a thing handled, as `ui` plays it */
function handNow(kind: 'pickup' | 'drop' | 'move', id?: string): Float32Array[] {
  const made = handling(id), [name, level] = TAKEN[made], H = EVERY.hand;
  const [gain, rate] = H[kind];
  if (kind === 'drop' && made === 'gun') return takes('drop_gun').map((f) => mixed([wav(f), H.gun]));
  return takes(name).map((f, k) => mixed([wav(f, rate), gain * level, kind === 'pickup' ? 0.03 : 0], ...(kind !== 'drop' && made !== 'soft' ? [[wav(takes('step_soft')[k % 3], 1.3), gain * H.cloth] as [Float32Array, number]] : [])));
}
const rustle = (dur: number, hz: number, vol: number, seed: number) => shaped(filtered(hiss(dur, seed), 'bandpass', hz, 0.8), [[0, 0.0001], [dur * 0.3, vol, 'line'], [dur, 0.0001]]);
const handWas = (kind: 'pickup' | 'drop' | 'move', seed: number) =>
  kind === 'pickup' ? mixed([rustle(0.18, 2200, 0.25, seed), 1], [rustle(0.1, 900, 0.2, seed + 1), 1, 0.08]) : kind === 'drop' ? rustle(0.12, 600, 0.3, seed) : rustle(0.07, 1200, 0.12, seed);
ok('every thing there is has a way of being handled; a thing taken up is no louder than a running step, moved is quieter, and only a gun let fall is loud', () => {
  const by: Record<string, number> = {};
  for (const id of Object.keys(ITEMS)) by[handling(id)] = (by[handling(id)] ?? 0) + 1;
  console.log(`      of the ${Object.keys(ITEMS).length} things there are: ${Object.entries(by).map(([k, c]) => `${c} ${k}`).join(', ')}`);
  for (const made of Object.keys(TAKEN)) assert.ok(EVERYDAY[TAKEN[made as keyof typeof TAKEN][0]], `${made} has no recording`);
  assert.deepEqual(['ak', 'ammo_762', 'box_762', 'beans', 'bat', 'field_jacket', 'mag_ak', 'suppressor_556'].map((id) => handling(id)), ['gun', 'rounds', 'any', 'tin', 'wood', 'soft', 'heavy', 'metal']);
  const wrong: string[] = [], step = middle(stepNow('grass', RUN))[0];
  for (const kind of ['pickup', 'drop', 'move'] as const) {
    const was = wasSeeds((sd) => handWas(kind, sd));
    for (const [what, id] of [['something not said', undefined], ['a tin', 'beans'], ['a rifle', 'ak'], ['a magazine', 'mag_ak'], ['loose rounds', 'ammo_762'], ['a suppressor', 'suppressor_556'], ['a bat', 'bat'], ['a jacket', 'field_jacket']] as const) {
      const now = middle(handNow(kind, id));
      row(`${kind}: ${what}`, now, was);
      const gun = kind === 'drop' && id === 'ak';
      if (gun ? now[0] > rifle - 10 : now[0] > step + 1.5) wrong.push(`${kind} of ${what} comes out at ${now[0].toFixed(1)} dB`);
      // (put down, a thing is let be a little louder than the rustle was: it is the thing on the ground that is heard)
      if (!gun && Math.abs(now[0] - was[0]) > (kind === 'drop' ? 7 : 6)) wrong.push(`${kind} of ${what} is ${(now[0] - was[0]).toFixed(1)} dB off the rustle it replaces`);
      if (kind === 'move' && now[0] > middle(handNow('pickup', id))[0] - 3) wrong.push(`${what} is as loud moved as taken up`);
    }
  }
  hold(wrong);
});

ok('a body going down, a spade and a fire are as loud as they were (within 3 dB); a bone and a spade drawn out, which could hardly be heard, are 12 dB up at most', () => {
  const B = EVERY.body;
  const body = middle(takes('thud').map((f, k) => mixed([wav(f, 0.92), B.thud], [wav(takes('step_soft')[k % 3], 0.85), B.cloth, 0.01], [wav(takes('thud')[(k + 2) % 5], 1.25), B.after, 0.19])));
  const bodyWas = wasSeeds((sd) => mixed([shaped(filtered(hiss(1.1, sd), 'bandpass', 620, 1.6), [[0, 0.0001], [0.12, 0.2, 'line'], [1.05, 0.0001]]), 1], [env(thump(95, 38, 0.17, 0.35), 0.6, 0.004, 0.2), 1, 0.45]));
  const bone = middle(takes('snap').map((f) => mixed([wav(f, EVERY.snap[1]), EVERY.snap[0]])));
  const boneWas = wasSeeds((sd) => mixed([env(filtered(hiss(0.06, sd), 'bandpass', 260, 1.2), 0.5, 0.003, 0.07), 1], [env(filtered(hiss(0.06, sd), 'highpass', 2400, 0.8), 0.22, 0.001, 0.02), 1]));
  const digIn = middle(takes('dig').map((f) => mixed([wav(f), EVERY.dig.in]))), digOut = middle(takes('step_snow').map((f) => mixed([wav(f, EVERY.dig.out[1]), EVERY.dig.out[0]])));
  const digInWas = wasSeeds((sd) => landWas('dirt', 3.2, sd)), digOutWas = wasSeeds((sd) => stepWas('gravel', 1.4, sd));
  // (a fire two metres off; a crack of it is anything from a quarter to all of this)
  const near = 1 / (1 + 4 / 30), top = EVERY.crack[0] + EVERY.crack[1];
  const crack = middle(takes('fire_crack').map((f) => mixed([wav(f), top * near]))), crackWas = wasSeeds((sd) => env(filtered(hiss(0.05, sd), 'highpass', 2800, 0.9), 0.18 * near, 0.002, 0.033));
  row('your own body going down', body, bodyWas);
  row('a leg breaking', bone, boneWas);
  row('a spade going in', digIn, digInWas);
  row('a spade coming out', digOut, digOutWas);
  row('a fire: its loudest crack, two metres off', crack, crackWas);
  const wrong: string[] = [];
  for (const [what, now, was] of [['a body', body, bodyWas], ['a spade in', digIn, digInWas], ['a crack of the fire', crack, crackWas]] as const) if (Math.abs(now[0] - was[0]) > 3) wrong.push(`${what} comes out at ${now[0].toFixed(1)} dB, and was ${was[0].toFixed(1)}`);
  for (const [what, now, was] of [['a bone', bone, boneWas], ['a spade out', digOut, digOutWas]] as const) if (now[0] < was[0] || now[0] > was[0] + 12 || now[0] > rifle - 12) wrong.push(`${what} comes out at ${now[0].toFixed(1)} dB, and was ${was[0].toFixed(1)}`);
  hold(wrong);
});

ok('wood struck is a little under steel struck, and a car into a wall is as loud as it was (within 2 dB), harder louder', () => {
  const wood = middle(takes('hit_wood').map((f) => mixed([wav(f), EVERY.wood]))), steel = middle([0, 1, 2, 3, 4, 5].map((k) => mixed([wav(fileOf('hit_metal', k)), 1.5])));
  const woodWas = wasSeeds((sd) => env(filtered(hiss(0.2, sd), 'bandpass', 700, 3), 0.7 * 2.4, 0.001, 0.09));
  const C = EVERY.crash;
  const crash = (k: number) => middle(takes('crash_tin').map((f, i) => mixed([wav(f, 1.05 - k * 0.3), C.tin[0] + k * C.tin[1]], [wav(takes('thud')[i], 0.85), C.thud[0] + k * C.thud[1]], [wav(fileOf('hit_metal', i), 0.55), C.steel[0] + k * C.steel[1], 0.012])));
  const crashWas = (k: number) => wasSeeds((sd) => mixed([env(thump(95, 38, 0.16, 0.3), 0.5 + k * 0.5, 0.004, 0.22), 1], [env(filtered(hiss(0.35, sd), 'bandpass', 1100 + k * 900, 1.2), 0.25 + k * 0.55, 0.002, 0.12 + k * 0.2), 1]));
  row('a round or a blow on wood, where it lands', wood, woodWas);
  row('a round or a blow on steel, where it lands', steel);
  row('a car into something, gently, where it is', crash(0.2), crashWas(0.2));
  row('a car into something, hard, where it is', crash(1), crashWas(1));
  assert.ok(wood[0] < steel[0] && wood[0] > steel[0] - 6, 'wood struck is out of its place beside steel');
  assert.ok(Math.abs(crash(0.2)[0] - crashWas(0.2)[0]) <= 2 && Math.abs(crash(1)[0] - crashWas(1)[0]) <= 2 && crash(1)[0] > crash(0.2)[0] + 1.5, 'a car into a wall is not as loud as it was');
});

// ---- The engine itself, asked as the game asks it, with nothing under it that makes a sound.
//
// A browser's sound is stood in for by things that take every call and do nothing, and the files are read off the
// disk in place of being fetched: so the engine's own code runs here, and what it sets going is counted by its
// `heard`. This is where it is shown which recording each thing the game asks for starts, how loud and how fast,
// that no take is played twice running, and when the files are asked for. (It is not the game: that the game's own
// feet and hands reach these calls is read in src/game/, and was not watched happening. See the hand-back of
// 2026-10-13: the headless game's harness never starts the engine, and the run that was to watch it saw nothing.)

const { AudioEngine, recordings } = await import('../src/core/audio');
type Heard = { name: string; take: number; gain: number; rate: number };
const G = globalThis as unknown as Record<string, unknown>;
const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
/** anything of a browser's sound: it is connected to whatever it is told, started and stopped, and any figure of it can be set */
const thing = (): unknown => new Proxy({ connect: (to: unknown) => to, disconnect() {}, start() {}, stop() {} } as Record<string | symbol, unknown>, { get: (t, k) => (k in t ? t[k] : (t[k] = param())), set: (t, k, v) => ((t[k] = v), true) });
const context = () => new Proxy({ currentTime: 0, sampleRate: SR, destination: thing(), listener: {}, resume: async () => {}, createBuffer: (_c: number, len: number) => ({ length: len, getChannelData: () => new Float32Array(len) }) } as Record<string | symbol, unknown>, { get: (t, k) => (k in t ? t[k] : thing) });
/** what was asked for of the site, in the order it was asked, and how many were out at once */
const asked: string[] = [];
let out6 = 0, most = 0;
G.fetch = async (url: string) => {
  asked.push(url);
  most = Math.max(most, ++out6);
  await new Promise((r) => setTimeout(r, 1));
  out6--;
  const file = path.join(SOUNDS, path.basename(url));
  return fs.existsSync(file) ? { status: 200, ok: true, arrayBuffer: async () => fs.readFileSync(file).buffer } : { status: 404, ok: false };
};
G.OfflineAudioContext = class { decodeAudioData = async (b: ArrayBuffer) => ({ length: b.byteLength }); };
G.AudioContext = function () { return context(); };

const engine = new AudioEngine();
const nothingYet = asked.length;
engine.start();
await recordings();
const heard: Heard[] = [];
engine.heard = (name, take, gain, rate) => heard.push({ name, take, gain, rate });
/** what the engine sets going when it is asked for something, so many times over */
function sets(fn: (e: InstanceType<typeof AudioEngine>) => void, times = 1): Heard[] {
  heard.length = 0;
  for (let k = 0; k < times; k++) fn(engine);
  return heard.slice();
}
const said = (what: string, got: Heard[]) => {
  const names = [...new Set(got.map((h) => h.name))];
  console.log(`      ${what.padEnd(46)} ${names.map((nm) => { const of = got.filter((h) => h.name === nm); return `${nm} ×${of.length} (level ${Math.min(...of.map((h) => h.gain)).toFixed(2)}..${Math.max(...of.map((h) => h.gain)).toFixed(2)}, speed ${Math.min(...of.map((h) => h.rate)).toFixed(2)}..${Math.max(...of.map((h) => h.rate)).toFixed(2)})`; }).join(' + ') || 'no recording: made up'}`);
  return names;
};
const THERE = { x: 2, y: 0, z: -5.6 };

ok('nothing is asked for until the sound is started; then the guns, and only when all of those are in what a body does all day, six at a time and the feet first', () => {
  assert.equal(nothingYet, 0, 'a recording was fetched before the engine was started');
  const everyday = (u: string) => Object.keys(EVERYDAY).some((nm) => new RegExp(`/${nm}(_\\d+)?\\.wav$`).test(u));
  const first = asked.findIndex(everyday), files = Object.values(EVERYDAY).reduce((s, c) => s + c, 0);
  assert.ok(first > 0 && asked.slice(first).every(everyday) && !asked.slice(0, first).some(everyday), 'the two sets are asked for mixed together');
  assert.equal(asked.length - first, files, 'not every everyday recording was asked for, or one twice');
  assert.ok(asked.slice(first, first + 5).every((u) => /step_grass/.test(u)), 'the feet are not first');
  console.log(`      ${first} files first (the guns, the doors, the infected, the blows), all of them out at once; then ${files}, never more than 6 at once; ${most} was the most out at any moment`);
});

ok('a foot on each kind of ground starts the recording of that ground, never the same take twice running, each a little louder or quieter and higher or lower', () => {
  for (const s of ['grass', 'dirt', 'gravel', 'rock', 'wood', 'metal', 'concrete', 'asphalt', 'snow']) {
    const got = sets((e) => e.footstep(s as 'grass', RUN), 60);
    const [name, , over] = STEPS[s];
    assert.deepEqual(said(`60 running steps on ${s}`, got).sort(), [name, ...(over ? [over] : [])].sort());
    for (const nm of [name, ...(over ? [over] : [])]) {
      const of = got.filter((h) => h.name === nm);
      assert.equal(of.length, 60);
      assert.ok(of.every((h, i) => !i || h.take !== of[i - 1].take), `${nm}: the same take twice running`);
      assert.equal(new Set(of.map((h) => h.take)).size, EVERYDAY[nm], `${nm}: not every take of it was played in 60 steps`);
      const g0 = Math.min(...of.map((h) => h.gain)), g1 = Math.max(...of.map((h) => h.gain)), r0 = Math.min(...of.map((h) => h.rate)), r1 = Math.max(...of.map((h) => h.rate));
      assert.ok(g1 / g0 > 1.05 && g1 / g0 < 1.14 && r1 / r0 > 1.03 && r1 / r0 < 1.07, `${nm}: levels ${g0.toFixed(3)}..${g1.toFixed(3)}, speeds ${r0.toFixed(3)}..${r1.toFixed(3)}`);
    }
  }
  // (and somebody else's, from where they are: the same recording, as much louder as the made-up one was before the distance is taken off)
  const own = sets((e) => e.footstep('grass', RUN), 40), theirs = sets((e) => e.footstep('grass', RUN, THERE), 40);
  const mean = (hs: Heard[]) => hs.reduce((s, h) => s + h.gain, 0) / hs.length;
  said('40 of somebody else’s steps on grass', theirs);
  assert.ok(Math.abs(mean(theirs) / mean(own) - 5.5 / 3.2) < 0.06);
});

ok('everything else a body does starts what it should: a landing, a jump, a fall, a thing in the hand by what it is, a spade, a fire, a car', () => {
  const is = (what: string, fn: (e: InstanceType<typeof AudioEngine>) => void, want: string[], times = 1) => assert.deepEqual(said(what, sets(fn, times)).sort(), [...want].sort(), what);
  is('a jump off concrete', (e) => e.jump('concrete'), ['step_concrete']);
  is('a landing from a height on wood', (e) => e.land('wood', 9), ['step_wood', 'thud']);
  is('one’s own body going down', (e) => e.death(), ['thud', 'step_soft']);
  is('somebody else’s, six metres off', (e) => e.bodyFall(THERE, 6), ['thud', 'step_soft']);
  is('a leg breaking', (e) => e.snap(), ['snap']);
  for (const [id, want] of [[undefined, ['take_any', 'step_soft']], ['beans', ['take_tin', 'step_soft']], ['ak', ['take_heavy', 'step_soft']], ['ammo_762', ['take_rounds', 'step_soft']], ['bat', ['take_wood', 'step_soft']], ['suppressor_556', ['take_metal', 'step_soft']], ['field_jacket', ['step_soft']]] as const) {
    is(`taken up: ${id ?? 'not said what'}`, (e) => e.ui('pickup', undefined, id), [...want]);
    is(`moved: ${id ?? 'not said what'}`, (e) => e.ui('move', undefined, id), [...want]);
  }
  is('put down: a rifle', (e) => e.ui('drop', undefined, 'ak'), ['drop_gun']);
  is('put down: a tin', (e) => e.ui('drop', undefined, 'beans'), ['take_tin']);
  is('put down: not said what', (e) => e.ui('drop'), ['take_any']);
  is('a spade going in', (e) => e.dig(0), ['dig']);
  is('a spade coming out', (e) => e.dig(1), ['step_snow']);
  is('a fire two metres off, one beat of it', (e) => e.fire(1, 2), ['fire_crack']);
  is('wood struck', (e) => e.impact('wood', THERE, 6), ['hit_wood']);
  is('a car’s door', (e) => e.carDoor(THERE), ['latch', 'gate_slam']);
  is('a car into something', (e) => e.crash(THERE, 0.6), ['crash_tin', 'thud', 'hit_metal']);
  // (and what there is no recording of is still what it was: nothing recorded is started for it)
  for (const kind of ['eat', 'drink', 'bandage', 'inject', 'smoke', 'unbox', 'open', 'close'] as const) is(`${kind} (made up still)`, (e) => e.ui(kind), []);
});

ok('with `asBefore` on, as the `?sounds` page sets it for "old", none of them is started and the guns still are', () => {
  engine.asBefore = true;
  const got = sets((e) => {
    e.footstep('grass', RUN);
    e.land('wood', 9);
    e.death();
    e.ui('pickup', undefined, 'ak');
    e.ui('drop', undefined, 'ak');
    e.dig(0);
    e.snap();
    e.impact('wood', THERE, 6);
    e.crash(THERE, 0.6);
    e.carDoor(THERE);
    e.gunshot('rifle');
  });
  engine.asBefore = false;
  assert.deepEqual(got.map((h) => h.name), ['shot_rifle']);
});

console.log(`${n} checks passed${failed.length ? `, ${failed.length} did not` : ''}`);
if (failed.length) process.exit(1);
