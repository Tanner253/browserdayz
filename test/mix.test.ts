// Checks of the volume controls (Settings, Audio), of 2026-10-13. No network, and nothing is played:
// `npx tsx test/mix.test.ts`.
//
// What was asked: "we need to add volume controls to the settings menu". There is the one volume there always was,
// and under it four groups, each a gain of its own in the engine (src/core/audio.ts, GROUPS): Effects, Voice,
// Ambience, Interface. Nobody who made them could hear them. So what is held to here is the engine's own wiring:
// a browser's sound is stood in for by things that remember what they were connected to and what they were set to,
// the engine is started on them as the game starts it, and every way out of it is walked from where a sound goes
// in to where it is heard. Held to:
//   - with every slider at 100 %, each way out is turned by exactly what it was before there were groups, to the
//     last digit, and passes through the same things in the same order (the squeeze and the ceiling last);
//   - a slider turns every way out of its own group by its share, once, and no way out of another's;
//   - each thing the game asks for is made on the group it belongs to;
//   - the calls said aloud, which are no sound of the engine's, are turned by Voice all the same;
//   - what is kept between visits is read back, and what was kept before any of this is read as it was.
// What it cannot say is how any of it sounds.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};

// ---- a browser's sound, stood in for: every thing remembers what it is, what it goes to and what it is set to
type Thing = Record<string | symbol, unknown> & { kind: string; outs: Thing[] };
class Param {
  constructor(public value: number) {}
  setValueAtTime(v: number) { this.value = v; return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  /** (where it ends: the figure a slider leaves a gain at is the one it is eased to) */
  setTargetAtTime(v: number) { this.value = v; return this; }
}
/** every connection made, in the order it was made */
const wired: [from: Thing, to: Thing][] = [];
const thing = (kind: string): Thing => {
  const t: Thing = { kind, outs: [], disconnect() {}, start() {}, stop() {} };
  t.connect = (to: unknown) => {
    // (to a figure of another thing, a wobble on its pitch or its level: no sound goes that way)
    if (!(to instanceof Param)) {
      t.outs.push(to as Thing);
      wired.push([proxy, to as Thing]);
    }
    return to;
  };
  // (any figure of it can be read and set: a gain's own is 1 until it is set, as a browser's is)
  const proxy: Thing = new Proxy(t, { get: (o, k) => (k in o ? o[k] : (o[k] = new Param(kind === 'gain' && k === 'gain' ? 1 : 0))), set: (o, k, v) => ((o[k] = v), true) });
  return proxy;
};
const SR = 8000;
class FakeContext {
  currentTime = 0;
  sampleRate = SR;
  destination = thing('destination');
  listener = {};
  resume = async () => {};
  createBuffer = (_c: number, len: number) => ({ length: len, duration: len / SR, getChannelData: () => new Float32Array(len) });
  constructor() {
    // (anything else it is asked to make is a thing of that kind)
    return new Proxy(this, { get: (o, k) => (k in o ? (o as unknown as Record<string | symbol, unknown>)[k] : typeof k === 'string' && k.startsWith('create') ? () => thing(k.slice(6).toLowerCase()) : undefined) });
  }
}
const G = globalThis as unknown as Record<string, unknown>;
const SOUNDS = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'public', 'assets', 'sounds');
G.fetch = async (url: string) => {
  const file = path.join(SOUNDS, path.basename(url));
  return fs.existsSync(file) ? { status: 200, ok: true, arrayBuffer: async () => new ArrayBuffer(8) } : { status: 404, ok: false };
};
G.OfflineAudioContext = class { decodeAudioData = async () => ({ length: SR, duration: 1 }); };
G.AudioContext = FakeContext;
// (the browser's speaking voice, for the calls: what it is asked to say, and how loud, is kept)
const spoken: { text: string; volume: number }[] = [];
G.SpeechSynthesisUtterance = class { volume = 1; pitch = 1; rate = 1; lang = ''; voice: unknown = null; constructor(public text: string) { spoken.push(this); } };
G.speechSynthesis = { pending: false, getVoices: () => [{ lang: 'en-GB' }], speak() {} };
// (and what a browser keeps between visits)
const kept = new Map<string, string>();
G.localStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };

const { AudioEngine, BUS, GROUPS, MIX, madeUp, recordings, share } = await import('../src/core/audio');
type Group = (typeof GROUPS)[number];
type Mix = Record<Group, number>;
const WET = { tail: [0.15, 0.04], slap: [0.075, 0.01], room: [0, 0.4] };

const fresh = () => {
  const e = new AudioEngine();
  e.start();
  // (looked into as a plain thing: the engine keeps these to itself, and a type that is both the engine and this is no type at all)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return e as unknown as { [k: string]: any; bus: Record<Group, Thing>; faders: Record<Group, Thing[]>; ctx: { destination: Thing } };
};
const engine = fresh();
await recordings();

/** every way from a thing to where sound is heard: the gains passed, in order, and what else is passed */
type Way = { gains: Thing[]; rest: string[] };
function ways(from: Thing, e = engine): Way[] {
  const out: Way[] = [];
  const walk = (t: Thing, gains: Thing[], rest: string[]) => {
    if (t === e.ctx.destination) return void out.push({ gains, rest });
    const g = t.kind === 'gain' ? [...gains, t] : gains, r = t.kind === 'gain' ? rest : [...rest, t.kind];
    for (const next of t.outs) walk(next, g, r);
  };
  walk(from, [], []);
  return out;
}
const level = (t: Thing) => (t.gain as Param).value;
/** what a way out turns a sound by, worked out as the sound meets its gains: one after another, in order */
const turned = (w: Way) => w.gains.reduce((p, g) => p * level(g), 1);
const trim = 1 / madeUp(BUS.ceiling);

/**
 * Where a sound goes in, by group, and each one's ways out AS THEY WERE before there were groups (read off the engine
 * as it stood on the morning of 2026-10-13): the gains it met, in order, and what else it passed through. `i` is 0 out
 * of doors and 1 under a roof.
 */
const INS: [group: Group, name: string, at: (e: typeof engine) => Thing, was: (i: number, master: number) => [gains: number[], rest: string[]][]][] = [
  ['fx', 'a sound of the world (sfx)', (e) => e.sfx, (_i, m) => [[[1, m, trim], ['dynamicscompressor', 'dynamicscompressor']]]],
  ['fx', 'what it sends to the hills (reverbSend)', (e) => e.reverbSend, (i, m) => [[[WET.tail[i], m, trim], ['convolver', 'biquadfilter', 'dynamicscompressor', 'dynamicscompressor']]]],
  ['fx', 'what it sends to the valley (echo)', (e) => e.echo, (i, m) => [
    [[WET.slap[i], WET.tail[i], m, trim], ['delay', 'biquadfilter', 'convolver', 'biquadfilter', 'dynamicscompressor', 'dynamicscompressor']],
    [[WET.slap[i], m, trim], ['delay', 'biquadfilter', 'dynamicscompressor', 'dynamicscompressor']],
  ]],
  ['fx', 'what it sends to the room (roomSend)', (e) => e.roomSend, (i, m) => [[[WET.room[i], m, trim], ['convolver', 'dynamicscompressor', 'dynamicscompressor']]]],
  ['voice', "another player's voice (voiceBus)", (e) => e.voiceBus() as unknown as Thing, (_i, m) => [[[m, trim], ['dynamicscompressor', 'dynamicscompressor']]]],
  ['ambience', 'a fire, a mask, the bunker, a bird (was sfx)', (e) => e.bus.ambience, (_i, m) => [[[1, m, trim], ['dynamicscompressor', 'dynamicscompressor']]]],
  ['ambience', 'the wind, the leaves, the insects (amb)', (e) => e.amb, (i, m) => [[[i ? 0.45 : 1, m, trim], ['biquadfilter', 'dynamicscompressor', 'dynamicscompressor']]]],
  ['ambience', 'what a crow or the bunker sends to the hills (was reverbSend)', (e) => e.ambSend, (i, m) => [[[WET.tail[i], m, trim], ['convolver', 'biquadfilter', 'dynamicscompressor', 'dynamicscompressor']]]],
  ['ui', "one's own hands, a shot landing (was sfx)", (e) => e.bus.ui, (_i, m) => [[[1, m, trim], ['dynamicscompressor', 'dynamicscompressor']]]],
];
const product = (gains: number[]) => gains.reduce((p, g) => p * g, 1);
const sorted = (ws: { turned: number; rest: string[] }[]) => ws.map((w) => `${w.rest.join('>')} x${w.turned}`).sort();

ok('with every slider at 100 %, every way out is turned by what it was before there were groups, to the last digit, through the same things in the same order: in the open and under a roof', () => {
  assert.deepEqual(MIX, { fx: 1, voice: 1, ambience: 1, ui: 1, vehicles: 1 }, 'a group does not start at full');
  for (const indoors of [false, true]) {
    engine.setEnvironment(indoors);
    for (const [, name, at, was] of INS) {
      const now = ways(at(engine)).map((w) => ({ turned: turned(w), rest: w.rest }));
      const then = was(indoors ? 1 : 0, BUS.master).map(([gains, rest]) => ({ turned: product(gains), rest }));
      // (compared as they are written out in full: seventeen digits, which is every one a number here has)
      assert.deepEqual(sorted(now), sorted(then), `${name}, ${indoors ? 'under a roof' : 'in the open'}`);
      for (const w of ways(at(engine))) assert.deepEqual(w.rest.slice(-2), ['dynamicscompressor', 'dynamicscompressor'], `${name} does not end in the squeeze and the ceiling`);
    }
  }
  engine.setEnvironment(false);
  console.log(`      a sound of the world, a voice, the wind and a pocket's rustle all come to the squeeze at ${BUS.master} of what they were made at, as before`);
});

ok('each way out passes one fader, of its own group, once; and the one volume, once', () => {
  const all = new Map<Thing, Group>();
  for (const g of GROUPS) for (const f of engine.faders[g]) all.set(f, g);
  assert.equal(all.size, 9, 'the faders are not the nine there should be (Effects 4, Voice 1, Ambience 2, Interface 1, Vehicles 1)');
  for (const [group, name, at] of INS) {
    for (const w of ways(at(engine))) {
      assert.deepEqual(w.gains.filter((g) => all.has(g)).map((g) => all.get(g)), [group], `${name}: the faders on its way out`);
      assert.equal(w.gains.filter((g) => g === engine.master).length, 1, `${name}: the one volume is not on its way out once`);
    }
  }
});

ok('a slider turns its own group by its share and no other; the one volume turns them all (the figures each ends at are printed)', () => {
  const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)), `${what}: ${a}, and should be ${b}`);
  const cases: [volume: number, mix: Mix][] = [
    [1, { fx: 0.5, voice: 1, ambience: 1, ui: 1 }],
    [1, { fx: 1, voice: 0.25, ambience: 1, ui: 1 }],
    [1, { fx: 1, voice: 1, ambience: 0, ui: 1 }],
    [1, { fx: 1, voice: 1, ambience: 1, ui: 0.63 }],
    [0.5, { fx: 0.3, voice: 0.8, ambience: 0.1, ui: 1 }],
    [0.25, { fx: 0, voice: 0, ambience: 0, ui: 0 }],
    [0, { fx: 1, voice: 1, ambience: 1, ui: 1, vehicles: 1 }],
    [1, { fx: 1, voice: 1, ambience: 1, ui: 1, vehicles: 1 }],
  ];
  console.log('      master  effects voice ambience interface   comes to the squeeze at (of what it was made at): effects  voice  ambience  interface');
  for (const [volume, mix] of cases) {
    engine.setVolume(volume);
    engine.setMix(mix);
    for (const [group, name, at, was] of INS) {
      const now = ways(at(engine)).map(turned).sort(), then = was(0, BUS.master).map(([gains]) => product(gains) * volume * mix[group]).sort();
      assert.equal(now.length, then.length, name);
      now.forEach((v, k) => near(v, then[k], `${name} at master ${volume}, ${group} ${mix[group]}`));
    }
    const at = (g: Group) => (level(engine.bus[g]) * level(engine.master)).toFixed(4);
    console.log(`      ${String(volume * 100).padStart(4)} %  ${GROUPS.map((g) => `${String(Math.round(mix[g] * 100)).padStart(5)} %`).join(' ')}       ${GROUPS.map((g) => at(g).padStart(8)).join(' ')}`);
  }
  // (back at full, what each fader is eased to is 1 itself)
  for (const g of GROUPS) for (const f of engine.faders[g]) assert.equal(level(f), 1, `${g} is not back at 1`);
  assert.equal(level(engine.master), BUS.master);
});

ok('a slider past its ends is held at them; one group moved leaves the others where they were; settings made before the sound is started are what it starts on', () => {
  assert.deepEqual([share(-1), share(0), share(0.37), share(1), share(7), share(NaN)], [0, 0, 0.37, 1, 1, 1]);
  engine.setMix({ ui: 4 });
  assert.equal(level(engine.bus.ui), 1);
  engine.setMix({ voice: -3 });
  assert.equal(level(engine.bus.voice), 0);
  assert.deepEqual([level(engine.bus.fx), level(engine.bus.ambience), level(engine.bus.ui)], [1, 1, 1]);
  engine.setMix({ voice: 1 });
  const late = new AudioEngine() as unknown as typeof engine;
  late.setVolume(0.5);
  late.setMix({ fx: 0.2, voice: 0.4, ambience: 0.6, ui: 0.8, vehicles: 0.3 });
  late.start();
  assert.equal(level(late.master), BUS.master * 0.5);
  assert.deepEqual(GROUPS.map((g) => late.faders[g].map(level)), [[0.2, 0.2, 0.2, 0.2], [0.4], [0.6, 0.6], [0.8], [0.3]]);
});

// ---- which group each thing the game asks for is made on: by what is connected, while it is made, to a fader
const HERE = { x: 0, y: 1.6, z: 0 }, THERE = { x: 3, y: 1, z: -4 };
function made(fn: (e: typeof engine) => void, e = engine): Group[] {
  const from = wired.length, on = new Map<Thing, Group>();
  for (const g of GROUPS) for (const f of e.faders[g]) on.set(f, g);
  fn(e);
  return [...new Set(wired.slice(from).map(([, to]) => on.get(to)).filter((g): g is Group => !!g))].sort();
}
const PRIV = engine as unknown as { ambience: { crowT: number; birdsT: number }; bunkerAir: { nextT: number } | null };

for (const asBefore of [false, true]) {
  ok(`each thing the game asks for is made on its own group (${asBefore ? 'the made-up sounds' : 'the recordings, where there are any'})`, () => {
    engine.asBefore = asBefore;
    const is = (what: string, want: Group[], fn: (e: typeof engine) => void) => assert.deepEqual(made(fn), want, what);
    // Effects: everything of the world
    is('a rifle fired', ['fx'], (e) => e.gunshot('rifle'));
    is("somebody else's rifle", ['fx'], (e) => e.gunshot('rifle', THERE, 40));
    is('a quieted pistol', ['fx'], (e) => e.gunshot('pistol', undefined, 0, false, true));
    is('a hammer on nothing', ['fx'], (e) => e.dryFire());
    is("a gun's own click (the selector, the light)", ['fx'], (e) => e.click(3600, 0.35, 0.015));
    is('a magazine out and in, the slide', ['fx'], (e) => { e.magOut(); e.magIn(); e.slideRack(); e.boltCycle(); e.shellIn(); e.shellDrop(); });
    is('a round going past', ['fx'], (e) => e.whiz(THERE, 0.5));
    is('a weapon brought up', ['fx'], (e) => e.equip('gun'));
    is('a step, a jump, a landing', ['fx'], (e) => { e.footstep('grass', 4); e.footstep('concrete', 4, THERE); e.jump('grass'); e.land('grass', 6); });
    is('a blast', ['fx'], (e) => e.explosion(THERE, 12));
    is('the bunker door', ['fx'], (e) => e.blastDoor(THERE, 10, true));
    is('a door, a locker', ['fx'], (e) => { e.door(true, THERE, 3); e.locker(true, THERE, 3); });
    // (a car's door is recordings and nothing else: with none on the disk it is nothing, and with them a vehicle's)
    assert.ok(made((e) => e.carDoor(THERE)).every((g) => g === 'vehicles'), 'a car door');
    is('a round on steel, a fist landing, a swing', ['fx'], (e) => { e.impact('metal', THERE, 5); e.blow(true, THERE, 2); e.whoosh(0.5); });
    is('a car into a wall', ['vehicles'], (e) => e.crash(THERE, 0.8));
    is("a jeep's engine", ['vehicles'], (e) => void e.engine());
    is('being hit, a bone going, dying, a body falling', ['fx'], (e) => { e.hurt(); e.hurt(THERE, 5); e.snap(); e.death(); e.bodyFall(THERE, 4); });
    is('breath and heart', ['fx'], (e) => { for (let k = 0; k < 40; k++) e.body(0.25, 0, 10, true, true); });
    is('a cough in the gas', ['fx'], (e) => e.cough());
    is('a spade', ['fx'], (e) => { e.dig(0); e.dig(1); });
    is('the infected', ['fx'], (e) => e.infected('alert', THERE, 10));
    is("somebody else's hands in their pockets, heard from where they stand", ['fx'], (e) => { e.ui('pickup', THERE, 'ak'); e.ui('inject', THERE); e.ui('unbox', THERE); });
    // Interface
    for (const kind of ['pickup', 'drop', 'open', 'close', 'eat', 'drink', 'bandage', 'inject', 'move', 'smoke', 'unbox', 'round', 'mag'] as const) is(`one's own hands: ${kind}`, ['ui'], (e) => e.ui(kind, undefined, 'ak'));
    is('a shot landing', ['ui'], (e) => e.hitTick(false));
    is('a shot landing on a head', ['ui'], (e) => e.hitTick(false, true));
    is('a shot that kills', ['ui'], (e) => e.hitTick(true));
    is("a gun's click after the pockets have been heard: the world's again", ['fx'], (e) => e.click());
    // Ambience
    is('a fire near by', ['ambience'], (e) => { for (let k = 0; k < 30; k++) e.fire(0.5, 3); });
    is('breath through a gas mask', ['ambience'], (e) => { for (let k = 0; k < 6; k++) e.mask(1, true); });
    is('a crow and a bird', ['ambience'], (e) => { PRIV.ambience.crowT = 0; PRIV.ambience.birdsT = 0; e.updateAmbience(0.1, HERE, false); });
    is("the bunker's hum", ['ambience'], (e) => { PRIV.bunkerAir = null; e.updateAmbience(0.1, HERE, true, false, 1); });
    for (let k = 0; k < 12; k++) is('a noise off in the bunker', ['ambience'], (e) => { PRIV.bunkerAir!.nextT = 0; e.updateAmbience(0.1, HERE, true, false, 1); });
    engine.updateAmbience(0.1, HERE, false, false, 0);
  });
}
engine.asBefore = false;

ok("a helicopter's rotor is a vehicle's: the Vehicles group (the owner, 2026-10-18: \"a volume slider for vehicles specifically\")", () => {
  const voice = engine.rotor?.();
  if (!voice) return void console.log('      (no rotor recording on the disk, or no rotor in this tree: not looked at)');
  assert.deepEqual(made((e) => void e.rotor()), ['vehicles']);
});

ok("another player's voice goes in at the Voice group, and nowhere else", () => {
  assert.equal(engine.voiceBus(), engine.bus.voice);
  assert.notEqual(engine.voiceBus(), engine.master);
  assert.equal(new AudioEngine().voiceBus(), null, 'a voice has somewhere to go before the sound is started');
});

ok('the calls said aloud are turned by Voice too: as loud as they were at 100 %, to the last digit; half at 50 %; not said at all at 0', () => {
  const said = (volume: number, voice: number, distance: number) => {
    engine.setVolume(volume);
    engine.setMix({ voice });
    spoken.length = 0;
    engine.shout('hey', distance ? THERE : undefined, distance, 0.5);
    return spoken.map((u) => u.volume);
  };
  // (as it was worked out before there were groups)
  const was = (volume: number, distance: number) => Math.max(0.08, Math.min(1, volume * 1.8 * (distance > 0 ? 1 / (1 + distance / 45) : 0.6)));
  for (const [volume, distance] of [[1, 0], [1, 12], [1, 90], [0.5, 0], [0.5, 30], [0.25, 200]]) {
    assert.deepEqual(said(volume, 1, distance), [was(volume, distance)], `at master ${volume}, ${distance} m off`);
    assert.deepEqual(said(volume, 0.5, distance), [was(volume, distance) * 0.5]);
    assert.deepEqual(said(volume, 0, distance), []);
  }
  assert.deepEqual(said(0, 1, 0), [], 'a call is said with the one volume off');
  engine.setVolume(1);
  engine.setMix({ voice: 1 });
});

// ---- what is kept between visits
const { loadMix, saveMix, loadGraphics, saveGraphics } = await import('../src/core/settings');
const { loadControls, AIM, SENS } = await import('../src/core/keys');

ok('the groups are kept between visits by themselves; nothing kept, or something damaged, is all of them at full', () => {
  kept.clear();
  assert.deepEqual(loadMix(), { fx: 1, voice: 1, ambience: 1, ui: 1, vehicles: 1 });
  saveMix({ fx: 0.3, voice: 0.85, ambience: 0, ui: 0.5, vehicles: 0.25 });
  assert.deepEqual(loadMix(), { fx: 0.3, voice: 0.85, ambience: 0, ui: 0.5, vehicles: 0.25 });
  assert.deepEqual([...kept.keys()], ['zona.mix'], 'they are kept under some other name, or with something else');
  kept.set('zona.mix', '{"fx":7,"voice":"loud","ambience":-1,"ui":0.4,"other":1}');
  // (and one kept before there was a Vehicles slider is that at full)
  assert.deepEqual(loadMix(), { fx: 1, voice: 1, ambience: 1, ui: 0.4, vehicles: 1 });
  kept.set('zona.mix', 'not this');
  assert.deepEqual(loadMix(), { fx: 1, voice: 1, ambience: 1, ui: 1, vehicles: 1 });
});

ok('the one volume is kept where it always was: each of the five steps it used to be is read as it was, and anywhere between them is kept now', () => {
  kept.clear();
  const base = loadGraphics();
  assert.equal(base.volume, 1);
  for (const v of [0, 0.25, 0.5, 0.75, 1, 0.63, 0.01]) {
    kept.set('zona.gfx', JSON.stringify({ ...base, volume: v }));
    assert.equal(loadGraphics().volume, v, `a volume of ${v} kept is not read back`);
  }
  for (const v of [1.5, -0.2, '0.5', null]) {
    kept.set('zona.gfx', JSON.stringify({ ...base, volume: v }));
    assert.equal(loadGraphics().volume, 1, `a volume of ${String(v)} kept is taken for one`);
  }
  saveGraphics({ ...base, volume: 0.42 });
  assert.equal(loadGraphics().volume, 0.42);
  // (and the rest of what is kept with it is untouched by a volume that is no longer one of five)
  assert.deepEqual({ ...loadGraphics(), volume: 1 }, base);
});

ok('the sensitivity while aiming is kept with the controls; controls kept before there was one are read as they were, with it at 1 (the game as it was)', () => {
  kept.clear();
  assert.deepEqual(loadControls(), { sens: 1, aim: 1, pad: false, padSens: 1, padInvert: false, keys: {} });
  kept.set('zona.controls.v1', '{"sens":1.85,"keys":{"KeyQ":"KeyZ"}}');
  assert.deepEqual(loadControls(), { sens: 1.85, aim: 1, pad: false, padSens: 1, padInvert: false, keys: { KeyQ: 'KeyZ' } });
  kept.set('zona.controls.v1', '{"sens":0.6,"aim":0.75,"keys":{}}');
  assert.deepEqual(loadControls(), { sens: 0.6, aim: 0.75, pad: false, padSens: 1, padInvert: false, keys: {} });
  for (const aim of [AIM.least - 0.01, AIM.most + 0.01, 'fast']) {
    kept.set('zona.controls.v1', JSON.stringify({ sens: 2, aim, keys: {} }));
    assert.deepEqual(loadControls(), { sens: 2, aim: 1, pad: false, padSens: 1, padInvert: false, keys: {} });
  }
  assert.ok(AIM.least > 0 && AIM.least <= 1 && AIM.most >= 1 && SENS.least <= 1 && SENS.most >= 1, 'the game as it was made is not on the sliders');
});

console.log(`\n${n} checks passed`);
process.exit(0);
