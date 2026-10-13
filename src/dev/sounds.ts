// Development only: `?sounds` on the dev page (http://localhost:5173/?sounds). Not the game: a page to hear its
// sounds on, for whoever can hear. Whoever chose the recordings could not, and chose them by their names and
// their figures; this is where somebody says yes or no to each by ear.
//
//   - every sound a body makes all day, as the game plays it now, beside what it was before there was a recording
//     of it ("new" and "old"), and each take of each recording alone, and the file in the library it was cut from
//   - every sound that is still made up, for want of a recording
//   - every file of the libraries in assets-src/sounds, with its figures, to find something better in
//   - how loud each comes out, worked out and not heard: `Measure` (or `await SOUNDS.measure()` from a console)
//     plays each into a soundtrack nobody listens to, through the same squeeze and ceiling as the game, and reads
//     its level off that. (It is a few hundred soundtracks, and takes a machine with nothing else to do a minute or
//     two. The same levels are worked out without a browser by `npx tsx test/everyday.test.ts`.)
//
// The verdicts are kept in this browser, and `Copy the verdicts` puts them on the clipboard as words.
// Never part of the built site: src/main.ts asks for this file only on a development build.

import { AudioEngine, EVERYDAY, audio, recordings, rotorRecording } from '../core/audio';
import { AIRDROP, ROTOR, rotorAt } from '../sim/airdrop';

type Play = (a: AudioEngine) => void;
interface Row {
  group: string;
  name: string;
  /** what plays now: the recordings it is made of, in the game's own names */
  recs: string[];
  /** what it was before: '' if it made no sound at all */
  was: string;
  play: Play;
  /** it goes on for a while (a fire): played for this many seconds by calling `play` every frame */
  runs?: number;
}

/** a place six metres in front of the ear, a little to the right: where "somebody else" stands on this page */
const THERE = { x: 2, y: 0, z: -5.6 };
const NEAR = { x: 1, y: 0, z: -2.8 };

/** the library file each take of each recording was cut from (scripts/sounds.mjs is where that is decided) */
const k5 = (kind: string) => [0, 1, 2, 3, 4].map((n) => `kenney-impact/Audio/${kind}_00${n}.ogg`);
const c = (...names: string[]) => names.map((n) => `cc0-wood-metal/${n}.ogg`);
const FROM: Record<string, string[]> = {
  step_grass: k5('footstep_grass'), step_concrete: k5('footstep_concrete'), step_snow: k5('footstep_snow'), step_metal: k5('impactPlate_light'),
  step_soft: ['kenney-impact/Audio/footstep_carpet_000.ogg', 'kenney-impact/Audio/footstep_carpet_001.ogg', 'kenney-impact/Audio/footstep_carpet_003.ogg'],
  step_wood: k5('footstep_wood').map((f, n) => `${f} + ${c('wood_hit_05', 'wood_hammer_02', 'wood_hit_08', 'wood_hit_07', 'wood_misc_08')[n]}`),
  thud: k5('impactSoft_heavy'), take_any: k5('impactGeneric_light'), take_heavy: k5('impactMetal_medium'), take_metal: k5('impactMetal_light'), take_tin: k5('impactTin_medium'), take_wood: k5('impactWood_light'),
  take_rounds: c('keys_01', 'keys_04', 'keys_05', 'keys_06'),
  drop_gun: [c('metal_falling_01')[0], `${c('wood_falling_03')[0]} + ${c('metal_hit_03')[0]}`, `${c('wood_falling_01')[0]} + ${c('metal_sheet_05')[0]}`],
  hit_wood: c('wood_hit_03', 'wood_hit_04', 'wood_hit_07', 'wood_hit_08', 'wood_hit_01'), dig: k5('impactMining'), fire_crack: c('wood_cracking_01', 'wood_cracking_02', 'wood_cracking_03', 'wood_cracking_04'),
  snap: c('wood_breaking_01', 'wood_breaking_02'), latch: c('lock_open_01'), crash_tin: c('metal_sheet_03', 'metal_sheet_06', 'metal_sheet_01'),
  // (it lies in assets-src itself, not under sounds/)
  rotor: ['../854493__qubodup__uh60-black-hawk-helicopter-hover-loop-1.wav'],
};

/**
 * The rotor of the helicopter that brings a supply drop (2026-10-13), as the game plays it from so far off: how
 * loud, how fast and how dull are ROTOR's in src/sim/airdrop.ts, and nobody who set them could hear it.
 * @param at seconds into what is heard -> [metres off, m/s it and the ear are coming together, metres to the right of the ear]
 */
const heli = (secs: number, at: (t: number) => [number, number, number]): Play => (a) => {
  const v = a.rotor();
  if (!v) return;
  const began = performance.now();
  const put = () => {
    const t = (performance.now() - began) / 1000, [dist, closing, right] = at(t), r = rotorAt(dist, closing);
    // (ahead of the ear and above it, and to one side by as much as is said)
    const flat = Math.sqrt(Math.max(0, dist * dist - right * right)) * 0.7;
    v.set({ x: right, y: flat, z: -flat }, r.gain, r.rate, r.cutoff);
    return t < secs;
  };
  put();
  const tick = () => (put() ? void requestAnimationFrame(tick) : v.stop());
  requestAnimationFrame(tick);
};
const heliAt = (dist: number, closing = 0) => heli(6, () => [dist, closing, dist * 0.3]);
/** a whole pass: in a straight line from 800 m off on the left, 90 m over the ear, and away to the right */
const PASS = heli(40, (t) => {
  const along = AIRDROP.speed * (t - 20), dist = Math.hypot(along, ROTOR.near);
  return [dist, -(AIRDROP.speed * along) / dist, along];
});

const WALK = 1.8, RUN = 5.5, CROUCH = WALK * 0.4;
const feet = (ground: string, recs: string[], was: string): Row[] =>
  ([['walking', WALK], ['running', RUN], ['crouched', CROUCH]] as const).map(([how, speed]) => ({ group: 'Feet', name: `${ground}, ${how}`, recs, was, play: (a) => a.footstep(ground as 'grass', speed) }));
const hand = (kind: 'pickup' | 'drop' | 'move', what: string | undefined, label: string, recs: string[]): Row => ({ group: kind === 'pickup' ? 'A thing taken up' : kind === 'drop' ? 'A thing put down' : 'A thing moved in the pockets', name: label, recs, was: 'a made-up rustle, the same for everything', play: (a) => a.ui(kind, undefined, what) });

const ROWS: Row[] = [
  ...feet('grass', ['step_grass'], 'made up: a swish and a thud'),
  ...feet('dirt', ['step_soft'], 'made up: a low thud'),
  ...feet('concrete', ['step_concrete'], 'made up: a knock and a tick'),
  ...feet('asphalt', ['step_concrete'], 'made up: the same as concrete'),
  ...feet('rock', ['step_concrete'], 'made up: the same as gravel'),
  ...feet('gravel', ['step_concrete'], 'made up: grit and a thud (the grit is made up still)'),
  ...feet('wood', ['step_wood'], 'made up: a low knock'),
  ...feet('metal', ['step_concrete', 'step_metal'], 'made up: a ring'),
  ...feet('snow', ['step_snow'], '').slice(0, 2),
  { group: 'Feet', name: 'somebody else running on grass, six metres off', recs: ['step_grass'], was: 'made up', play: (a) => a.footstep('grass', RUN, THERE) },
  { group: 'Feet', name: 'somebody else walking on concrete, six metres off', recs: ['step_concrete'], was: 'made up', play: (a) => a.footstep('concrete', WALK, THERE) },
  { group: 'Feet', name: 'a jump, off grass', recs: ['step_grass'], was: 'a made-up scuff', play: (a) => a.jump('grass') },
  { group: 'Feet', name: 'a jump, off concrete', recs: ['step_concrete'], was: 'a made-up scuff', play: (a) => a.jump('concrete') },
  { group: 'Feet', name: 'landing from a hop, on grass', recs: ['step_grass', 'thud'], was: 'a made-up step and thump', play: (a) => a.land('grass', 3.5) },
  { group: 'Feet', name: 'landing from a height, on concrete', recs: ['step_concrete', 'thud'], was: 'a made-up step and thump', play: (a) => a.land('concrete', 9) },
  { group: 'Feet', name: 'landing from a height, on wood', recs: ['step_wood', 'thud'], was: 'a made-up step and thump', play: (a) => a.land('wood', 9) },

  { group: 'The body', name: 'your own body going down', recs: ['thud', 'step_soft'], was: 'a made-up last breath and a thump (the breath is gone: it was a made-up voice)', play: (a) => a.death() },
  { group: 'The body', name: "somebody else's body going down, six metres off", recs: ['thud', 'step_soft'], was: '', play: (a) => a.bodyFall(THERE, 6) },
  { group: 'The body', name: 'a leg breaking', recs: ['snap'], was: 'a made-up crack', play: (a) => a.snap() },

  hand('pickup', undefined, 'something, not said what (from the pockets screen)', ['take_any', 'step_soft']),
  hand('pickup', 'beans', 'a tin of beans', ['take_tin', 'step_soft']),
  hand('pickup', 'ak', 'a rifle', ['take_heavy', 'step_soft']),
  hand('pickup', 'mag_ak', 'a magazine', ['take_heavy', 'step_soft']),
  hand('pickup', 'ammo_762', 'loose rounds', ['take_rounds', 'step_soft']),
  hand('pickup', 'box_762', 'a box of rounds', ['take_any', 'step_soft']),
  hand('pickup', 'suppressor_556', 'a suppressor', ['take_metal', 'step_soft']),
  hand('pickup', 'bat', 'a bat', ['take_wood', 'step_soft']),
  hand('pickup', 'field_jacket', 'a jacket', ['step_soft']),
  hand('pickup', 'bandage', 'a bandage', ['step_soft']),
  hand('pickup', 'jerrycan', 'a jerrycan', ['take_tin', 'step_soft']),
  hand('drop', undefined, 'something, not said what', ['take_any']),
  hand('drop', 'ak', 'a rifle', ['drop_gun']),
  hand('drop', 'm9', 'a pistol', ['drop_gun']),
  hand('drop', 'beans', 'a tin of beans', ['take_tin']),
  hand('drop', 'ammo_762', 'loose rounds', ['take_rounds']),
  hand('drop', 'shovel', 'a shovel', ['take_heavy']),
  hand('drop', 'field_jacket', 'a jacket', ['step_soft']),
  hand('move', undefined, 'something, not said what (every move on the pockets screen)', ['take_any', 'step_soft']),
  hand('move', 'beans', 'a tin of beans', ['take_tin', 'step_soft']),
  hand('move', 'ammo_762', 'loose rounds', ['take_rounds', 'step_soft']),

  { group: 'Work', name: 'a spade going in', recs: ['dig'], was: 'a made-up landing on dirt', play: (a) => a.dig(0) },
  { group: 'Work', name: 'a spade coming out with what it lifted', recs: ['step_snow'], was: 'a made-up step on gravel', play: (a) => a.dig(1) },
  { group: 'Work', name: 'a fire, two metres off (ten seconds)', recs: ['fire_crack'], was: 'made-up ticks over a made-up hiss (the hiss is made up still)', play: (a) => a.fire(1 / 60, 2), runs: 10 },
  { group: 'Work', name: 'a round or a blow on wood, two metres off', recs: ['hit_wood'], was: 'a made-up knock', play: (a) => a.impact('wood', NEAR, 3) },

  { group: 'A car', name: 'a door, as somebody gets in or out, three metres off', recs: ['latch', 'gate_slam'], was: '', play: (a) => a.carDoor(NEAR) },
  { group: 'A car', name: 'into something, gently, six metres off', recs: ['crash_tin', 'thud', 'hit_metal'], was: 'a made-up thud and rattle', play: (a) => a.crash(THERE, 0.2) },
  { group: 'A car', name: 'into something, hard, six metres off', recs: ['crash_tin', 'thud', 'hit_metal'], was: 'a made-up thud and rattle', play: (a) => a.crash(THERE, 1) },
  // (six seconds of each; it is LOUD under it, as was asked. The last is forty seconds: all of a pass, the pitch falling as it goes over)
  { group: 'The helicopter that brings a supply drop', name: 'holding right overhead, 90 m up', recs: ['rotor'], was: '', play: heliAt(ROTOR.near) },
  { group: 'The helicopter that brings a supply drop', name: 'holding, 150 m off', recs: ['rotor'], was: '', play: heliAt(150) },
  { group: 'The helicopter that brings a supply drop', name: '400 m off, coming at 40 m/s', recs: ['rotor'], was: '', play: heliAt(400, AIRDROP.speed) },
  { group: 'The helicopter that brings a supply drop', name: '400 m off, going away at 40 m/s', recs: ['rotor'], was: '', play: heliAt(400, -AIRDROP.speed) },
  { group: 'The helicopter that brings a supply drop', name: '800 m off, coming', recs: ['rotor'], was: '', play: heliAt(800, AIRDROP.speed) },
  { group: 'The helicopter that brings a supply drop', name: '1500 m off: the far side of the map', recs: ['rotor'], was: '', play: heliAt(1500) },
  { group: 'The helicopter that brings a supply drop', name: 'a whole pass: from 800 m, 90 m over the ear, and away (40 s)', recs: ['rotor'], was: '', play: PASS },
];

/** what is still made up, for want of a recording: heard here as the game makes it */
const MADE_UP: [name: string, need: string, play: Play, runs?: number][] = [
  ['eating', 'a tin opened, a spoon in it, chewing', (a) => a.ui('eat')],
  ['drinking', 'a cap unscrewed, swallows from a bottle', (a) => a.ui('drink')],
  ['a jerrycan emptied into the tank, a bottle filled at a well', 'liquid poured, a pump handle', (a) => a.ui('drink')],
  ['bandaging', 'cloth torn, a dressing wound on', (a) => a.ui('bandage')],
  ['an injection', 'an auto-injector: cap, spring, hiss', (a) => a.ui('inject')],
  ['a smoke', 'a lighter struck, a draw, a breath out', (a) => a.ui('smoke')],
  ['a box of rounds opened', 'card torn, brass shifting in a tray', (a) => a.ui('unbox')],
  ['the pockets opened, a map unfolded, a deal done', 'a zip, a pack rummaged in, paper', (a) => a.ui('open')],
  ['the pockets closed', 'a zip, a flap', (a) => a.ui('close')],
  ['kit shifting on the body at a run (under every running step)', 'webbing and cloth at a run', (a) => a.footstep('grass', RUN, undefined, 20)],
  ['a weapon brought up', 'a sling, cloth, a gun settling in the hands', (a) => a.equip('gun')],
  ['a swing: a fist', 'an arm through the air', (a) => a.whoosh(0)],
  ['a swing: a bat', 'a bat through the air', (a) => a.whoosh(1)],
  ['being hit: the blow and your own grunt', 'a man grunting (several)', (a) => a.hurt()],
  ["somebody else's grunt, six metres off", 'the same', (a) => a.hurt(THERE, 6)],
  ['out of breath (eight seconds)', 'a man breathing hard, in and out', (a) => a.body(1 / 60, 0, 100, true), 8],
  ['badly hurt: your own pulse (six seconds)', 'a heartbeat', (a) => a.body(1 / 60, 100, 10, true), 6],
  ['a cough, in the gas', 'a man coughing (several)', (a) => a.cough()],
  ['breathing through a gas mask (eight seconds)', 'breath through a respirator', (a) => a.mask(1 / 60, true), 8],
  ['a grenade, forty metres off', 'an explosion, near and far', (a) => a.explosion({ x: 10, y: 0, z: -39 }, 40)],
  ['a fuel drum going up, forty metres off', 'a drum bursting, fuel catching', (a) => a.explosion({ x: 10, y: 0, z: -39 }, 40, true)],
  ['a round passing close', 'a bullet crack and its whine', (a) => a.whiz(NEAR, 1.5)],
  ['a round into concrete, earth or flesh, two metres off', 'bullet strikes by what is struck; glass breaking', (a) => a.impact('concrete', NEAR, 3)],
  ['your shot landing (the tick)', 'a hit marker, if one is wanted recorded at all', (a) => a.hitTick(false)],
  ['an empty gun', 'a hammer falling on nothing', (a) => a.dryFire()],
  ['spent cases on the ground', 'brass falling on earth and on concrete', (a) => a.shellDrop(0)],
  ['a torch switched on, a part fitted to a gun', 'a switch, a part clicked onto a rail', (a) => a.click(2400, 0.25, 0.012)],
  ['the wind, leaves, insects, birds and crows (they began with the page)', 'a wood by day, a field at night, wind in open country: each a loop', () => {}],
];

const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-9));

/**
 * How loud something comes out: it is played into a soundtrack nobody hears, on an engine of its own (as the
 * trailer's is made), and its level read off that. The wind and the insects are left out of it.
 * @param old the made-up sound in place of the recording
 * @returns its highest moment and its loudest tenth of a second, in decibels under as loud as can be, and what was played
 */
async function render(play: Play, old: boolean, seconds = 1.6) {
  // (It is played half a second in. A squeeze that has only just been made is still shut, and opens over its first
  // tenths of a second: a footstep played at the very start came out twenty-five decibels under what it is.)
  const SR = 48000, WARM = 0.5, off = new OfflineAudioContext(2, Math.ceil((WARM + seconds) * SR), SR);
  const W = window as unknown as { AudioContext: unknown };
  const Real = W.AudioContext;
  W.AudioContext = function () { return off; };
  const eng = new AudioEngine();
  try { eng.start(); } finally { W.AudioContext = Real; }
  (eng as unknown as { amb: GainNode }).amb.gain.value = 0;
  eng.asBefore = old;
  const used: string[] = [];
  eng.heard = (name, take, gain, rate) => used.push(`${name}${take ? `_${take + 1}` : ''} ×${gain.toFixed(2)} @${rate.toFixed(2)}`);
  void off.suspend(Math.round((WARM * SR) / 128) * 128 / SR).then(() => {
    play(eng);
    void off.resume();
  });
  const buf = await off.startRendering();
  let peak = 0, best = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch), w = SR / 10;
    let run = 0;
    for (let i = 0; i < d.length; i++) {
      peak = Math.max(peak, Math.abs(d[i]));
      run += d[i] * d[i];
      if (i >= w) run -= d[i - w] * d[i - w];
      best = Math.max(best, run / w);
    }
  }
  return { peak: db(peak), loud: db(Math.sqrt(best)), used };
}

/** the same thing several times over (it is a different take each time, at a different pitch): the middle of them */
async function level(play: Play, old: boolean, times = 3) {
  const all: Awaited<ReturnType<typeof render>>[] = [];
  for (let k = 0; k < times; k++) all.push(await render(play, old));
  const mean = all.reduce((s, r) => s + r.loud, 0) / all.length;
  return { peak: +Math.max(...all.map((r) => r.peak)).toFixed(1), loud: +mean.toFixed(1), used: [...new Set(all.flatMap((r) => r.used.map((u) => u.split(' ')[0].replace(/_\d+$/, ''))))] };
}

/** what the page's figures are set against: a rifle and a pistol at the ears of whoever fires, and a door at arm's length */
const MARKS: [string, Play][] = [
  ['a rifle shot, your own', (a) => a.gunshot('rifle')],
  ['a pistol shot, your own', (a) => a.gunshot('pistol')],
  ['a rifle shot, a hundred metres off', (a) => a.gunshot('rifle', { x: 0, y: 0, z: -100 }, 100)],
  ['a door opened at arm’s length', (a) => a.door(true, { x: 0, y: 0, z: -1 }, 1)],
  ['a punch landing, a metre off', (a) => a.blow(true, { x: 0, y: 0, z: -1 }, 1)],
  ['a magazine pushed home', (a) => a.magIn(0, true)],
];

export interface Measured { group: string; name: string; now: { peak: number; loud: number; used: string[] }; before: { peak: number; loud: number } | null }
async function measure(times = 3, say?: (done: number, of: number) => void): Promise<Measured[]> {
  await recordings();
  await rotorRecording();
  const out: Measured[] = [];
  const all: [string, string, Play, boolean][] = [...MARKS.map(([n, p]) => ['Set against', n, p, false] as [string, string, Play, boolean]), ...ROWS.map((r) => [r.group, r.name, r.play, !!r.was] as [string, string, Play, boolean])];
  for (const [group, name, play, was] of all) {
    // (something that goes on, like a fire, is one beat of it here: its hiss and one crack)
    const once: Play = name.startsWith('a fire') ? (a) => a.fire(1, 2) : play;
    out.push({ group, name, now: await level(once, false, times), before: was ? await level(once, true, times) : null });
    say?.(out.length, all.length);
  }
  return out;
}

// ------------------------------------------------------------------ the page

const CSS = `
#snd{position:fixed;inset:0;overflow:auto;background:#14171a;color:#dfe6ea;font:13px/1.45 system-ui,sans-serif;padding:18px 26px 80px;z-index:99999}
#snd h1{font-size:20px;margin:0 0 4px} #snd h2{font-size:15px;margin:26px 0 6px;color:#f0c674;border-bottom:1px solid #333;padding-bottom:3px}
#snd p{margin:4px 0;color:#9aa7ad;max-width:1100px} #snd table{border-collapse:collapse;width:100%} #snd td,#snd th{padding:3px 8px 3px 0;vertical-align:top;text-align:left;border-bottom:1px solid #22272b}
#snd th{color:#7d8a91;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
#snd button{font:inherit;color:#dfe6ea;background:#2a3238;border:1px solid #3b464d;border-radius:4px;padding:2px 9px;margin:0 3px 2px 0;cursor:pointer}
#snd button:hover{background:#38444c} #snd button.new{background:#274a32;border-color:#3a7049} #snd button.old{background:#4a3a27;border-color:#70573a}
#snd button.lib{background:none;border-color:#2c353b;color:#8fb6c9;font-size:11px;padding:1px 6px}
#snd button.on{outline:2px solid #f0c674} #snd .dim{color:#7d8a91;font-size:12px} #snd .num{font:12px/1.4 ui-monospace,monospace;white-space:nowrap}
#snd #log{position:fixed;right:14px;bottom:10px;width:430px;max-height:150px;overflow:hidden;background:#0d0f11e6;border:1px solid #333;border-radius:6px;padding:6px 10px;font:11px/1.5 ui-monospace,monospace;color:#9fd3a8;pointer-events:none}
#snd input{font:inherit;background:#0d0f11;color:#dfe6ea;border:1px solid #3b464d;border-radius:4px;padding:3px 8px;width:260px}
#snd .bar{position:sticky;top:-18px;background:#14171a;padding:8px 0;z-index:2;border-bottom:1px solid #333}
`;

interface Cat { file: string; lib: string; secs: number; ch: number; rate: number; peak: number; loud: number; lufs: number; centre: number; top: number; up: number; down: number; events: number; env: string; guess: string }

export async function soundsPage() {
  // (the game's own page is under this one: its loading card is put away, and its watch on the start told all is well)
  document.getElementById('loading')?.classList.add('done');
  const boot = (window as unknown as { __boot?: { done: boolean } }).__boot;
  if (boot) boot.done = true;
  document.title = 'ZONA: sounds (dev)';
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'snd';
  document.body.appendChild(root);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, into: HTMLElement, text = '', cls = '') => {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    if (cls) e.className = cls;
    into.appendChild(e);
    return e;
  };

  el('h1', root, 'ZONA: every sound a body makes, old beside new');
  el('p', root, 'Whoever chose these recordings cannot hear. They were chosen by what their makers called them and by their figures. Green is what the game plays now; brown is what it played before (made up from hiss and tones as it went); the numbered buttons are each take of a recording alone, as it lies on the disk; the blue ones are the library files they were cut from, untouched. Say yes or no to each, then copy the verdicts.');
  const bar = el('div', root, '', 'bar');
  const startB = el('button', bar, 'Start the sound', 'new');
  const measureB = el('button', bar, 'Measure how loud each comes out');
  const copyB = el('button', bar, 'Copy the verdicts');
  const state = el('span', bar, ' the sound is not started: press Start (a browser will not play a note until it is asked to by hand)', 'dim');
  const log = el('div', root);
  log.id = 'log';
  const lines: string[] = [];
  const say = (text: string) => {
    lines.push(text);
    while (lines.length > 8) lines.shift();
    log.textContent = lines.join('\n');
    log.style.whiteSpace = 'pre';
  };

  let going = false;
  const start = async () => {
    if (going) return;
    going = true;
    audio.start();
    audio.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
    audio.heard = (name, take, gain, rate) => say(`${name}${take ? `_${take + 1}` : ''}.wav   level ${gain.toFixed(2)}   speed ${rate.toFixed(2)}`);
    state.textContent = ' fetching the recordings…';
    await recordings();
    await rotorRecording();
    state.textContent = ` ${Object.values(EVERYDAY).reduce((s, n) => s + n, 0)} recordings of everyday things are here. The wind and the insects you hear are the game's own, made up.`;
    startB.textContent = 'The sound is on';
  };
  startB.onclick = () => void start();

  const verdicts: Record<string, string> = (() => {
    try { return JSON.parse(localStorage.getItem('zona-sounds') ?? '{}') as Record<string, string>; } catch { return {}; }
  })();
  const keep = () => localStorage.setItem('zona-sounds', JSON.stringify(verdicts));
  const verdict = (cell: HTMLElement, key: string) => {
    const bs = (['yes', 'no', 'unsure'] as const).map((v) => {
      const b = el('button', cell, v);
      b.onclick = () => {
        verdicts[key] = verdicts[key] === v ? '' : v;
        keep();
        paint();
      };
      return [v, b] as const;
    });
    const paint = () => bs.forEach(([v, b]) => b.classList.toggle('on', verdicts[key] === v));
    paint();
  };
  copyB.onclick = () => {
    const text = Object.entries(verdicts).filter(([, v]) => v).map(([k, v]) => `${v.toUpperCase().padEnd(7)} ${k}`).sort().join('\n') || 'no verdicts yet';
    void navigator.clipboard?.writeText(text);
    say('copied:\n' + text.split('\n').slice(0, 5).join('\n'));
  };

  /** runs something that goes on (a fire) for so many seconds, by the frame */
  const keepOn = (play: Play, secs: number, old: boolean) => {
    const until = performance.now() + secs * 1000;
    const tick = () => {
      audio.asBefore = old;
      play(audio);
      audio.asBefore = false;
      if (performance.now() < until) requestAnimationFrame(tick);
    };
    tick();
  };
  const press = async (play: Play, old: boolean, runs?: number) => {
    await start();
    if (runs) return keepOn(play, runs, old);
    audio.asBefore = old;
    try { play(audio); } finally { audio.asBefore = false; }
  };
  /** a file of the libraries, untouched, straight from assets-src (which only the dev page can reach) */
  const raw = (file: string) => {
    for (const f of file.split(' + ')) void new Audio(`/assets-src/sounds/${f.split('/').map(encodeURIComponent).join('/')}`).play().catch(() => say(`could not play ${f}`));
  };

  const cells = new Map<string, HTMLElement>();
  let group = '', table: HTMLTableElement | null = null;
  for (const r of ROWS) {
    if (r.group !== group) {
      group = r.group;
      el('h2', root, group);
      table = el('table', root);
      const head = el('tr', table);
      for (const h of ['what', 'hear it', 'each take alone, and the library file under it', 'how loud (now / before)', 'verdict']) el('th', head, h);
    }
    const tr = el('tr', table!);
    const what = el('td', tr);
    el('div', what, r.name);
    el('div', what, `now: ${r.recs.join(' + ')}  ·  before: ${r.was || 'no sound at all'}`, 'dim');
    const hear = el('td', tr);
    el('button', hear, 'new', 'new').onclick = () => void press(r.play, false, r.runs);
    if (r.was) el('button', hear, 'old', 'old').onclick = () => void press(r.play, true, r.runs);
    const takes = el('td', tr);
    for (const name of r.recs) {
      const line = el('div', takes);
      el('span', line, `${name} `, 'dim');
      const n = EVERYDAY[name] ?? 1;
      for (let k = 0; k < n; k++) {
        el('button', line, String(k + 1)).onclick = async () => {
          await start();
          if (!audio.audition(name, k, 0.7)) say(`${name} take ${k + 1} is not here`);
        };
        const from = FROM[name]?.[k];
        if (from) {
          const b = el('button', line, 'lib', 'lib');
          b.title = from;
          b.onclick = () => raw(from);
        }
      }
    }
    cells.set(`${r.group}|${r.name}`, el('td', tr, '', 'num'));
    verdict(el('td', tr), `${r.group}: ${r.name}`);
  }

  el('h2', root, 'Still made up, for want of a recording');
  el('p', root, 'None of the libraries on this machine has any of these. Each is heard here as the game makes it now; the second column is what to look for.');
  const mt = el('table', root);
  for (const [name, need, play, runs] of MADE_UP) {
    const tr = el('tr', mt);
    el('td', tr, name);
    el('td', tr, need, 'dim');
    el('button', el('td', tr), 'hear it', 'old').onclick = () => void press(play, false, runs);
  }

  el('h2', root, 'Set against');
  const st = el('table', root);
  for (const [name, play] of MARKS) {
    const tr = el('tr', st);
    el('td', tr, name);
    el('button', el('td', tr), 'hear it').onclick = () => void press(play, false);
    cells.set(`Set against|${name}`, el('td', tr, '', 'num'));
  }

  measureB.onclick = async () => {
    measureB.disabled = true;
    const got = await measure(3, (d, n) => (measureB.textContent = `Measuring… ${d}/${n}`));
    for (const m of got) {
      const cell = cells.get(`${m.group}|${m.name}`);
      if (cell) cell.textContent = `${m.now.loud.toFixed(1)} dB (top ${m.now.peak.toFixed(1)})${m.before ? `  /  ${m.before.loud.toFixed(1)} dB (top ${m.before.peak.toFixed(1)})` : ''}`;
    }
    measureB.textContent = 'Measured: the loudest tenth of a second of each, in dB under as loud as can be';
    measureB.disabled = false;
  };

  // ---- the libraries themselves
  el('h2', root, 'Every file of the libraries (assets-src/sounds)');
  const note = el('p', root, 'Each as it came, with its figures: seconds, how loud, where its weight lies (Hz), how fast it comes up and dies (s), and a guess at its shape made from those. The "misc" and "tools" files of the wood and metal pack are named for nothing: if one of them is a zip, a rustle or a switch, say which.');
  let cat: Cat[] = [];
  try {
    cat = (await (await fetch('/assets-src/sounds/catalogue.json')).json()) as Cat[];
  } catch {
    note.textContent = 'The catalogue (assets-src/sounds/catalogue.json) is not on this machine: it is made from the libraries, which are not in the repository.';
  }
  if (cat.length) {
    const find = el('input', root);
    find.placeholder = 'find: footstep, keys, misc, wood…';
    const lt = el('table', root);
    const draw = () => {
      lt.textContent = '';
      const head = el('tr', lt);
      for (const h of ['file', '', 's', 'top dB', 'loud dB', 'LUFS', 'weight Hz', 'up s', 'down s', 'shape', 'a guess from the figures', 'what is it?']) el('th', head, h);
      const q = find.value.toLowerCase();
      for (const r of cat.filter((x) => !q || x.file.toLowerCase().includes(q)).slice(0, q ? 400 : 60)) {
        const tr = el('tr', lt);
        el('td', tr, r.file, 'dim');
        el('button', el('td', tr), 'play', 'lib').onclick = () => raw(r.file);
        for (const v of [r.secs.toFixed(2), r.peak, r.loud, r.lufs, r.centre, r.up, r.down, r.env]) el('td', tr, String(v), 'num');
        el('td', tr, r.guess, 'dim');
        const said = el('input', el('td', tr));
        said.style.width = '150px';
        said.value = verdicts[`lib ${r.file}`] ?? '';
        said.onchange = () => {
          verdicts[`lib ${r.file}`] = said.value;
          keep();
        };
      }
      if (!q) el('td', el('tr', lt), `the first 60 of ${cat.length}: type to find the rest`, 'dim');
    };
    find.oninput = draw;
    draw();
  }

  (window as unknown as Record<string, unknown>).SOUNDS = { measure, render, rows: ROWS, audio, recordings: () => recordings().then(rotorRecording) };
}
