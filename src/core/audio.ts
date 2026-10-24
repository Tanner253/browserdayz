// Procedural audio. Every sound is synthesised from noise + oscillators at runtime:
// no licensed sample packs, tiny download, and endless variation per shot/step.
// Positional sounds use HRTF panners; gunshots get an outdoor slap-back echo.

import type { Surface } from './physics';
import { EMOTE } from '../sim/emotes';
import { alarmShare, alarmTop } from '../sim/heard';
import { ITEMS } from '../sim/items';

type V3 = { x: number; y: number; z: number };
/** how a gun sounds where it is not as its kind does: its recording, played so much slower (deeper) and louder; and a
 * quieted shot of its own, at its own level against the .22's (see gunshot) */
export interface Voice { rate: number; gain: number; rec?: string; quiet?: string; quietGain?: number; /** its rounds slower than sound: no crack, quieted or going by */ subsonic?: true; /** how much further than a rifle's it carries before its distance tells (the .50s: their boom holds) */ reach?: number }

/**
 * How much of a loud sound comes back from round about: [in the open, under a roof]. Open
 * country answers once, quietly, and rumbles for a second; it is not a cave. With these a
 * rifle's echo is some 14 dB under the shot itself (it was 5), and a room has none.
 */
const WET = { tail: [0.15, 0.04], slap: [0.075, 0.01], room: [0, 0.4] } as const;

/**
 * The last of the way out: everything heard is turned down by `master`, pressed by `squeeze` when it is loud, and
 * then held under `ceiling`. (Kept here in figures so that how loud the guns come out can be worked out without
 * hearing them: test/gunsound.test.ts does.)
 *
 * The ceiling was not there. A shot of one's own goes into the squeeze well over as loud as a loudspeaker can
 * be asked to go, and what the squeeze let through of the biggest was still over it: the very top of the
 * shotgun's shot was cut off flat, and so was a shot's with anything else loud at the same moment, which a crack
 * close by now is. Nothing that came out under 0.9 of as loud as can be is touched by the ceiling (a footstep, a
 * voice, a door); what is over that is held there, a little under as loud as can be, whatever is heard at once.
 */
export const BUS = {
  master: 0.8,
  squeeze: { threshold: -10, knee: 12, ratio: 4, attack: 0.002, release: 0.25 },
  ceiling: { threshold: -2, ratio: 20, attack: 0.002, release: 0.06 },
};
/** what a squeeze with no knee to it adds back by itself, as browsers make them: the 0.6th power of what it takes off the loudest there can be */
export const madeUp = (c: { threshold: number; ratio: number }) => Math.pow(10, (-c.threshold * (1 - 1 / c.ratio) * 0.6) / 20);

/**
 * The four groups a player turns up and down by themselves (Settings, Audio; 2026-10-13: "we need to add volume
 * controls to the settings menu"), all of them under the one volume that turns everything. A group is a gain of
 * its own between its sounds and `master`, so the squeeze and the ceiling after it still hold whatever is made of
 * them. At 1, as all four are until a player moves one, such a gain changes nothing: the game sounds as it did
 * before there were any (test/mix.test.ts walks the engine's wiring and holds it to that).
 *   fx        Effects: everything of the world. Guns and what comes back of them from the hills and the walls,
 *             blasts, steps, bodies, doors, cars, the helicopter, the infected, one's own breath and heart.
 *             A NEW SOUND OF THE WORLD IS EFFECTS BY DOING NOTHING: `this.sfx` is the group itself, and
 *             `this.out(pos)` ends in it.
 *   voice     other players talking (src/game/voice.ts, by `voiceBus`), and the calls said aloud (`speak`)
 *   ambience  the wind, the leaves, the insects, birds and crows, a fire burning near by, breath through a gas
 *             mask, the bunker's hum and the noises it makes off in the dark
 *   ui        Interface: one's own hands in the pockets (`ui`), and the tick of a shot landing (`hitTick`)
 *   vehicles  the jeeps' engines, horns, doors and crashes, and the helicopters' rotors (the owner, 2026-10-18: "we
 *             shoudl add a volume slider for vehicles specifically")
 */
export const GROUPS = ['fx', 'voice', 'ambience', 'ui', 'vehicles'] as const;
export type Group = (typeof GROUPS)[number];
export type Mix = Record<Group, number>;
export const MIX: Mix = { fx: 1, voice: 1, ambience: 1, ui: 1, vehicles: 1 };
/** what a slider at `v` turns its group by: the share itself, 0..1, as the one volume has always been */
export const share = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1);

/**
 * A shot through a suppressor (2026-10-13: "suprressed shots are too quiet ... we want it to be more realistic").
 * Each pair is [a round slower than sound, a rifle's round]: see `gunshot` for why they differ.
 *
 * A suppressor takes some thirty decibels off the blast at the muzzle, which leaves a rifle as loud as a
 * hammer on steel at arm's length, and does nothing to the round. It was played a quarter as loud as an open
 * shot at the ears of whoever fired (12 dB under it and more, over its first tenth of a second), with nothing
 * coming back from round about; and to anybody else it fell away faster than an open shot does and had lost
 * all its top by 150 m. Now it is between a third and a half as loud as the open shot (it cannot be as far under
 * it as it is in life: the loudest and the quietest thing here are not a hundred decibels apart); a little of it
 * comes back from the hills and the walls; there is the thump of the gas under it; and from somebody else's gun
 * it falls away as an open shot does and no faster, from two fifths of an open shot's level. A quieted rifle
 * 150 m off is as loud as an open one 400 m off, with half its top still on it; a quieted 9 mm is a third less
 * at any distance, and is a thud past 220 m, where the rifle is one past 290.
 * (All of this is worked out and none of it heard: test/gunsound.test.ts has the sums.)
 */
export const QUIET = {
  /** how loud its recording is played at the ears of whoever fired; and from somebody else's gun, before the distance is taken off */
  own: [1.5, 1.75],
  far: [1.65, 2.4],
  /** the recording slowed: a rifle's is deeper */
  rate: [1, 0.86],
  /** the thump under it, as a share of the recording's level */
  thump: 0.26,
  /** how much goes to the hills and the walls (an open rifle's is 0.9) */
  send: [0.18, 0.35],
  /** how it falls away from somebody else's gun (see `out`: an open rifle's is 12 and 1), and how fast it loses its top next to an open shot */
  ref: 6,
  rolloff: 1,
  dull: [2, 1.5],
};

/**
 * The crack of a round going by faster than sound (2026-10-13: "bullet snaps are not loud enough near the player
 * when being shot at from a silence and unsilenced gun").
 *
 * It is the round's own shock wave, made all the way down its flight, and a suppressor does nothing to it: a
 * yard from a rifle bullet's path it is some 150 decibels, not far under what the shot is to whoever fired it,
 * and far louder than the report that comes after it from a hundred metres off. It falls away slowly, by the
 * three-quarter power of the distance. In life it is still heard a hundred metres off the path; here it is let
 * die by nine, so that a crack says a round came close.
 */
export const CRACK = {
  /** within this of the ear it is as loud as it gets, and by this it is gone: metres */
  near: 1.5,
  far: 9,
  /** how loud at its loudest (a sniper rifle's shot at the ears of whoever fired is 2.3) */
  peak: 2,
  /** when it is at its loudest, when it has fallen to half, and when it is gone: seconds from its start */
  shape: [0.0004, 0.008, 0.12],
  /** the same wave off the ground, a moment after: how much of it comes back, and how high the ear is, metres */
  ground: 0.6,
  ear: 1.6,
  /** how much goes to the hills and the walls */
  send: 0.3,
};
/** how loud the crack of a round is that came within `miss` metres of the ear */
export function crackLevel(miss: number): number {
  if (!(miss < CRACK.far)) return 0;
  const spread = Math.min(1, Math.pow(CRACK.near / Math.max(miss, 1e-3), 0.75));
  const s = Math.max(0, (miss - CRACK.far / 2) / (CRACK.far / 2));
  return CRACK.peak * spread * (1 - s * s * (3 - 2 * s));
}

/** A jeep's engine, running: told every frame where it is and what it is doing, until it is stopped. */
export interface EngineVoice {
  /**
   * @param rpm engine speed
   * @param load how hard it is being driven, 0..1
   * @param speed over the ground, m/s
   * @param slide how sideways the tyres are going, 0..1
   * @param road on a made road (tyres sing; off it they rumble)
   * @param inside heard from the seats, not from the verge
   */
  set(pos: V3, rpm: number, load: number, speed: number, slide: number, road: boolean, inside: boolean): void;
  stop(): void;
}

/** A car's horn and siren (Audio.horn): where the car is, and which of the two are sounding. */
export interface HornVoice {
  set(pos: V3, horn: boolean, siren: boolean): void;
  stop(): void;
}

/**
 * A helicopter's rotor, turning (src/game/airdrop.ts): told every frame where it is and how it is to be heard, until
 * it is stopped. How loud it is at what distance, how fast it is played and how much of its top comes through are
 * said by whoever holds it (ROTOR in src/sim/airdrop.ts), not worked out here.
 */
export interface RotorVoice {
  /** @param gain how loud  @param rate how fast the recording is played  @param cutoff nothing of it above this many Hz */
  set(pos: V3, gain: number, rate: number, cutoff: number): void;
  stop(): void;
}

/**
 * Recordings, played in place of sounds this file would otherwise make up (scripts/sounds.mjs
 * cuts them out of two free libraries of real guns): [name]: how many takes of it there are.
 * One take is played, any of them. Until they have arrived, and wherever one is missing, the
 * made-up sound is what is heard: but for the infected (z_), who have no made-up voice any more
 * and are silent until theirs is there.
 */
const RECORDED: Record<string, number> = { punch: 5, blow: 5, hit_metal: 6, shot_rifle: 1, shot_pistol: 3, shot_quiet: 1, bolt: 1, rifle_mag_out: 1, rifle_mag_in: 1, pistol_mag_out: 1, pistol_mag_in: 1, mag_round: 1, rack: 1, shot_ak: 1, shot_ar: 1, ak_mag_out: 1, ak_mag_in: 1, ak_rack: 1, ar_mag_out: 1, ar_mag_in: 1, ar_rack: 1, shot_shotgun: 2, shot_magnum: 2, shell_in: 1, z_groan: 4, z_growl: 4, z_alert: 4, z_attack: 4, z_hurt: 4, z_die: 4, door_open: 1, door_creak: 2, door_close: 2, gate_open: 1, gate_close: 1, gate_slam: 1, shot_scorpion: 3, shot_ppsh: 3, shot_aks: 3, shot_db12: 2, shot_sawnoff: 2, shot_barrett: 1, shot_50: 1, shot_vssk: 1, shot_mac10: 1, shot_mp7: 1, shot_m32: 1, shot_deagle: 1, pump: 1, casing: 1, uzi_mag_out: 1, uzi_mag_in: 1, uzi_rack: 1, bullet_crack: 5, drink: 1, door_opened: 1, door_shut: 1, metal_creak: 1 };
/**
 * Recordings of what a body does all day (2026-10-13: "our sounds for drinking and doing basically everything can
 * and should get rehauled"): feet by what is under them, a thing taken up or put down by what it is made of, a
 * spade, a fire, a bone, a car's door (scripts/sounds.mjs, the second half of it, says what each is cut from).
 * They are asked for only once the first set is all here, a few at a time and the feet first, so that a gun is
 * never kept waiting by a footstep; until one has come, the made-up sound it replaces is what is heard.
 * (Nobody who chose them could hear them: `?sounds` on the dev page plays each beside what it replaces.)
 */
export const EVERYDAY: Record<string, number> = { step_grass: 5, step_concrete: 5, step_wood: 5, step_soft: 3, step_metal: 5, step_snow: 5, thud: 5, take_any: 5, take_heavy: 5, take_metal: 5, take_tin: 5, take_wood: 5, take_rounds: 4, drop_gun: 3, hit_wood: 5, dig: 5, fire_crack: 4, snap: 2, latch: 1, crash_tin: 3 };

/**
 * Feet, by what is under them: [the recording, how loud against a step on grass, a second recording laid over it,
 * and how loud that is]. Hard ground is all one recording (concrete); packed earth is the soft one (a foot on
 * carpet: a dull pat with no slap in it); steel is a step on something hard with a plate struck lightly over it.
 * Gravel is a hard step too, and the grit of it is still made up over that (see `footstep`): nobody has recorded any.
 * Snow is here for when there is some (2026-10-13: a snowy mountain is planned; no ground says 'snow' yet).
 */
export const STEPS: Record<string, [name: string, level: number, over?: string, overLevel?: number]> = {
  grass: ['step_grass', 1], foliage: ['step_grass', 0.8], dirt: ['step_soft', 0.8], cloth: ['step_soft', 0.65], flesh: ['step_soft', 0.65],
  concrete: ['step_concrete', 1.1], asphalt: ['step_concrete', 1.1], plaster: ['step_concrete', 1.1], rock: ['step_concrete', 1.1], glass: ['step_concrete', 1.1], gravel: ['step_concrete', 0.9],
  wood: ['step_wood', 0.67], metal: ['step_concrete', 0.9, 'step_metal', 0.3], snow: ['step_snow', 0.52],
};
/**
 * How loud a recorded step is played, against how loud the made-up one was told to be. Set so that a step on grass
 * comes out as loud as the made-up one did (which is what has been played with), and the other grounds beside it:
 * at a run some 19 dB under a rifle shot of one's own over their loudest tenth of a second, walking 25, crouched
 * 27. (Worked out, not heard: test/everyday.test.ts has the sums, and prints every level.)
 */
export const STEP_GAIN = 0.3;
/**
 * How loud and how fast the rest of them are played. Each was set beside the made-up sound it replaces (the test
 * prints both): as loud as that was, but for a bone, a spade drawn out and wood struck, which could hardly be
 * heard and now can.
 */
export const EVERY = {
  /** a landing: the weight of the body [from a hop, and how much more from as far as a body can fall], how fast it is played [the same], and the other foot against the first */
  land: { thud: [0.1, 0.36], rate: [1.1, -0.2], other: 0.8 },
  /** a body going down: its weight, its clothes, and what follows (an arm, the head); and somebody else's against one's own, before the distance is taken off */
  body: { thud: 0.46, cloth: 0.46, after: 0.2, other: 1.7 },
  /** a thing handled, [how loud, how fast]: taken up, put down, moved; the hand on cloth with it, as a share of it; a gun let fall; and somebody else's hands against one's own */
  hand: { pickup: [0.27, 1.06], drop: [0.25, 0.86], move: [0.09, 1.15], cloth: 0.55, gun: 0.3, other: 1.4 },
  /** a bone, [how loud, how fast] */
  snap: [0.37, 0.82],
  /** a spade: going in, and coming out [how loud, how fast] */
  dig: { in: 0.32, out: [0.1, 0.78] },
  /** a crack of a fire, at the fire: [the quietest, and how much louder the loudest] */
  crack: [0.08, 0.24],
  /** wood struck (steel struck is 1.5) */
  wood: 1.2,
  /** a car into something, each [gently, and how much more at its hardest]: sheet steel giving, the weight behind it, steel struck */
  crash: { tin: [0.34, 0.4], thud: [0.3, 0.3], steel: [0.2, 0.4] },
} as const;

/** what a thing in the hand is made of, as far as the ear can tell: which recording it is taken up and put down with */
export type Handling = 'any' | 'heavy' | 'metal' | 'tin' | 'wood' | 'rounds' | 'soft' | 'gun';
const HANDLED: Record<string, Handling> = {
  // by what kind of thing it is ...
  weapon: 'gun', magazine: 'heavy', attachment: 'metal', melee: 'heavy', food: 'tin', drink: 'any', medical: 'soft', clothing: 'soft', tool: 'any', misc: 'any', stash: 'any',
  // ... and the ones that are not what the rest of their kind are
  bat: 'wood', apple: 'any', flask: 'tin', stim: 'any', stim_stamina: 'any', stim_combat: 'any', firstaid: 'any', helmet_k63: 'heavy', helmet_m1: 'heavy', gasmask: 'any',
  jerrycan: 'tin', grenade: 'heavy', frag: 'heavy', radio: 'heavy', dogtag: 'metal', flashlight: 'metal', stash_kit: 'heavy', black_bag: 'soft',
};
/** the recording a thing is handled with: [which, how loud against the rest] (`step_soft` is cloth: a hand on it, as a foot on carpet) */
export const TAKEN: Record<Handling, [name: string, level: number]> = { any: ['take_any', 1], heavy: ['take_heavy', 1], gun: ['take_heavy', 1.15], metal: ['take_metal', 0.7], tin: ['take_tin', 1.1], wood: ['take_wood', 1.1], rounds: ['take_rounds', 0.8], soft: ['step_soft', 0.9] };
export function handling(id?: string): Handling {
  const d = id ? ITEMS[id] : undefined;
  if (!d) return 'any';
  // (loose rounds are brass on brass; a box of them is card)
  if (d.category === 'ammo') return d.open ? 'any' : 'rounds';
  return HANDLED[d.id] ?? HANDLED[d.category] ?? 'any';
}

const bank = new Map<string, AudioBuffer[]>();
/** which take each recording in the bank is, counted from 0 (they arrive in any order) */
const takeOf = new WeakMap<AudioBuffer, number>();
let fetched: Promise<void> | null = null;
/** Fetches the recordings, once. (They are kept apart from any one engine: the trailer renders its soundtrack on an engine of its own.) */
export function recordings(): Promise<void> {
  return (fetched ??= (async () => {
    // (decoding needs a context, and any will do: this one makes no sound)
    const dec = new OfflineAudioContext(1, 1, 44100);
    const one = async (name: string, k: number) => {
      // (asked for three times before it is given up: one that failed once on a bad line is not lost for the whole game)
      for (let go = 0; go < 3; go++) {
        try {
          const res = await fetch(`assets/sounds/${name}${k ? `_${k + 1}` : ''}.wav`);
          if (res.status === 404) return;
          if (!res.ok) throw new Error(String(res.status));
          const buf = await dec.decodeAudioData(await res.arrayBuffer());
          takeOf.set(buf, k);
          bank.set(name, [...(bank.get(name) ?? []), buf]);
          return;
        } catch {
          // not there yet, or not sound: again in a while, and then the made-up one stands in
          await new Promise((r) => setTimeout(r, 1500 * (go + 1)));
        }
      }
    };
    await Promise.all(Object.entries(RECORDED).flatMap(([name, takes]) => Array.from({ length: takes }, (_, k) => one(name, k))));
    // and then what a body does all day, six at a time, in the order they are written above
    const rest = Object.entries(EVERYDAY).flatMap(([name, takes]) => Array.from({ length: takes }, (_, k) => [name, k] as const));
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (let job = rest.shift(); job; job = rest.shift()) await one(job[0], job[1]);
      }),
    );
  })());
}

const lateAsked = new Map<string, Promise<void>>();
/**
 * Fetches one recording, once, when it is first wanted and not with the rest: the rotor of the helicopter that
 * brings a supply drop (when one is first in the air) and the police car's siren (when one is first driven or heard).
 * Each is a quarter of a megabyte that most games never need.
 */
function lateRecording(name: string): Promise<void> {
  let asked = lateAsked.get(name);
  if (!asked)
    lateAsked.set(
      name,
      (asked = (async () => {
        const dec = new OfflineAudioContext(1, 1, 44100);
        for (let go = 0; go < 3 && !bank.has(name); go++) {
          try {
            const res = await fetch(`assets/sounds/${name}.wav`);
            if (!res.ok) throw new Error(String(res.status));
            const buf = await dec.decodeAudioData(await res.arrayBuffer());
            takeOf.set(buf, 0);
            bank.set(name, [buf]);
          } catch {
            // not there, or a bad line: again in a while (and after the third time, it is silent)
            await new Promise((r) => setTimeout(r, 1500 * (go + 1)));
          }
        }
      })()),
    );
  return asked;
}
export const rotorRecording = () => lateRecording('rotor');
export const sirenRecording = () => lateRecording('siren');

/** how loud the siren's recording is played: as loud as the made-up wail it replaced */
const SIREN_GAIN = 0.4;

export class AudioEngine {
  ctx!: AudioContext;
  private master!: GainNode;
  /** Effects (see GROUPS): where every sound of the world goes, straight or from a place (`out`). A new one hangs here. */
  private sfx!: GainNode;
  /** the four groups' own gains (`fx` is `sfx` itself) */
  private bus!: Record<Group, GainNode>;
  /**
   * Every gain a group's slider turns: its own, and for Effects and Ambience their ways in to what comes back from
   * the hills and the walls as well (that is one thing shared between them, and comes back under `master`: so it
   * is what is sent to it that is turned).
   */
  private faders!: Record<Group, GainNode[]>;
  private mix: Mix = { ...MIX };
  /** where a sound made in the ears, and not at a place, goes: Effects, but for what is made within `of` */
  private ears!: GainNode;
  private reverb!: ConvolverNode;
  /** Effects' way in to what comes back from the hills (turned with Effects), and Ambience's (a crow, the bunker); `tail` is how much of either comes back, out of doors and in */
  private reverbSend!: GainNode;
  private ambSend!: GainNode;
  private tail!: GainNode;
  /** Effects' way in to the valley's one slap back (turned with Effects) */
  private echo!: GainNode;
  private echoGain!: GainNode;
  /** small-room reverb: what a shot sounds like under a roof (Effects' way in, turned with Effects; `roomLevel` is how much of a room there is) */
  private roomSend!: GainNode;
  private roomLevel!: GainNode;
  /** everything that is "the outdoors": dulled and turned down when you step inside */
  private amb!: GainNode;
  private ambLP!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  private ambience: { wind?: GainNode; leaves?: GainNode; insects?: GainNode; birdsT: number; crowT: number; indoors?: boolean; forest?: boolean } = { birdsT: 3, crowT: 20 };
  private volume = 1;
  private indoors = false;
  // the body: breathing when out of breath, heartbeat when badly hurt
  private breathT = 0;
  private breathIn = true;
  private maskT = 0;
  private maskIn = true;
  private fireT = 0;
  private crackT = 0;
  private heartT = 0;
  private stepSide = 1;
  ready = false;

  /** Must be called from a user gesture. */
  start() {
    if (this.ready) {
      void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    void recordings();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = BUS.squeeze.threshold;
    comp.knee.value = BUS.squeeze.knee;
    comp.ratio.value = BUS.squeeze.ratio;
    comp.attack.value = BUS.squeeze.attack;
    comp.release.value = BUS.squeeze.release;
    // the ceiling: a second squeeze, as hard as they are made, that only the very loudest reaches (see BUS)
    const top = ctx.createDynamicsCompressor();
    top.threshold.value = BUS.ceiling.threshold;
    top.knee.value = 0;
    top.ratio.value = BUS.ceiling.ratio;
    top.attack.value = BUS.ceiling.attack;
    top.release.value = BUS.ceiling.release;
    // (a squeeze turns everything up by itself to make good what it takes off: this one's is taken back before
    // it, so that what never reaches it comes out as loud as it went in)
    const trim = ctx.createGain();
    trim.gain.value = 1 / madeUp(BUS.ceiling);
    this.master = ctx.createGain();
    this.master.gain.value = BUS.master * this.volume;
    this.master.connect(comp).connect(trim).connect(top).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    // the groups (see GROUPS): Effects is `sfx` itself, as it has always been; the other three are gains beside it
    const group = () => {
      const g = ctx.createGain();
      g.connect(this.master);
      return g;
    };
    this.bus = { fx: this.sfx, voice: group(), ambience: group(), ui: group(), vehicles: group() };
    this.ears = this.sfx;

    // white noise source buffer (2 s)
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // outdoor reverb: diffuse decaying noise impulse
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        ch[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3.2) * (t < 0.02 ? t / 0.02 : 1);
      }
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.ambSend = ctx.createGain();
    this.tail = ctx.createGain();
    this.tail.gain.value = WET.tail[0];
    const revLP = ctx.createBiquadFilter();
    revLP.type = 'lowpass';
    revLP.frequency.value = 2400;
    this.reverbSend.connect(this.tail);
    this.ambSend.connect(this.tail);
    this.tail.connect(this.reverb).connect(revLP).connect(this.master);

    // valley slap-back echo for gunshots
    this.echo = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.62;
    const echoGain = (this.echoGain = ctx.createGain());
    echoGain.gain.value = WET.slap[0];
    const echoLP = ctx.createBiquadFilter();
    echoLP.type = 'lowpass';
    echoLP.frequency.value = 900;
    this.echo.connect(delay).connect(echoLP).connect(echoGain).connect(this.tail);
    echoGain.connect(this.master);

    // a room: short, bright, close reflections. Silent until you are under a roof.
    const room = ctx.createConvolver();
    const rl = Math.floor(ctx.sampleRate * 0.35);
    const rir = ctx.createBuffer(2, rl, ctx.sampleRate);
    // a few hard early reflections off the walls, then a quick diffuse tail. The reflections
    // come at uneven moments: evenly spaced they are a note, and the room rings like a pipe.
    const early: [number, number][] = [[0.007, 0.8], [0.0125, -0.65], [0.019, 0.55], [0.0275, -0.45], [0.037, 0.35], [0.049, -0.27], [0.064, 0.2]];
    for (let c = 0; c < 2; c++) {
      const ch = rir.getChannelData(c);
      for (let i = 0; i < rl; i++) {
        const t = i / ctx.sampleRate;
        ch[i] = (Math.random() * 2 - 1) * Math.exp(-t * 16) * (t < 0.004 ? t / 0.004 : 1) * 0.5;
      }
      for (const [at, v] of early) ch[Math.floor(ctx.sampleRate * at * (c ? 1.13 : 1))] += v;
    }
    room.buffer = rir;
    this.roomSend = ctx.createGain();
    this.roomLevel = ctx.createGain();
    this.roomLevel.gain.value = WET.room[0];
    this.roomSend.connect(this.roomLevel).connect(room).connect(this.master);

    this.amb = ctx.createGain();
    this.ambLP = this.filter('lowpass', 18000, 0.5);
    this.amb.connect(this.ambLP).connect(this.bus.ambience);

    this.faders = { fx: [this.sfx, this.reverbSend, this.echo, this.roomSend], voice: [this.bus.voice], ambience: [this.bus.ambience, this.ambSend], ui: [this.bus.ui], vehicles: [this.bus.vehicles] };
    for (const g of GROUPS) for (const f of this.faders[g]) f.gain.value = this.mix[g];

    this.startAmbience();
    this.ready = true;
  }

  /** an ad has the screen (src/ui/adsense.ts): the game is silent until it gives it back, the player's volume untouched */
  quiet(on: boolean) {
    if (this.ready) this.master.gain.setTargetAtTime(on ? 0 : BUS.master * this.volume, this.ctx.currentTime, 0.05);
  }

  /** player setting, 0..1 */
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ready) this.master.gain.setTargetAtTime(BUS.master * this.volume, this.ctx.currentTime, 0.05);
  }

  /** the four groups, each 0..1 (Settings, Audio): heard at once, eased as the one volume is. One that is where it was is not touched. */
  setMix(m: Partial<Mix>) {
    for (const g of GROUPS) {
      const v = m[g];
      if (v === undefined || share(v) === this.mix[g]) continue;
      this.mix[g] = share(v);
      if (this.ready) for (const f of this.faders[g]) f.gain.setTargetAtTime(this.mix[g], this.ctx.currentTime, 0.05);
    }
  }

  /** What `make` makes in the ears is that group's, and not Effects' (the pockets' sounds are made of the same clicks a gun's are). */
  private of(group: Group, make: () => void) {
    const was = this.ears;
    this.ears = this.bus[group];
    try {
      make();
    } finally {
      this.ears = was;
    }
  }

  /**
   * Under a roof or out in the open. Indoors a shot is a hard, close slap with no valley
   * echo, and the wind and the birds are on the other side of a wall.
   */
  setEnvironment(indoors: boolean) {
    if (!this.ready || indoors === this.indoors) return;
    this.indoors = indoors;
    const t = this.ctx.currentTime;
    const i = indoors ? 1 : 0;
    this.roomLevel.gain.setTargetAtTime(WET.room[i], t, 0.25);
    this.tail.gain.setTargetAtTime(WET.tail[i], t, 0.25);
    this.echoGain.gain.setTargetAtTime(WET.slap[i], t, 0.25);
    this.ambLP.frequency.setTargetAtTime(indoors ? 900 : 18000, t, 0.4);
    this.amb.gain.setTargetAtTime(indoors ? 0.45 : 1, t, 0.4);
  }

  setListener(pos: V3, fwd: V3, up: V3) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    // plain value writes: scheduling an automation event on 9 params every frame
    // piles up timeline events in the audio engine the longer the game runs
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x;
      l.forwardY.value = fwd.y;
      l.forwardZ.value = fwd.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    }
  }

  // ------------------------------------------------------------ primitives

  private noise(t0: number, dur: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    src.start(t0, Math.random() * 1.5, dur + 0.05);
    return src;
  }

  private env(g: GainNode, t0: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /** Output node: positional (HRTF) or direct. Distance also dulls the high end. @param to the group it is of: Effects, unless said */
  private out(pos?: V3, refDist = 4, rolloff = 1.2, distance = 0, to: AudioNode = this.sfx) {
    if (!pos) return to;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDist;
    p.rolloffFactor = rolloff;
    p.maxDistance = 2000;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    const lp = this.filter('lowpass', Math.max(700, 18000 - distance * 40));
    lp.connect(p).connect(to);
    return lp as AudioNode;
  }

  /**
   * Plays a recording, if it is here.
   * @param to where it goes (a place in the world, or straight to the ears)
   * @param at when, on the context's clock
   * @returns whether it did: if not, the caller makes the sound up as it used to
   */
  /** what a reload has set to be heard later in it: taken back if the reload is broken off (see hush) */
  private ahead: { src: AudioBufferSourceNode; at: number }[] = [];

  /**
   * A reload is broken off: the magazine that was to go in, the shells not yet pushed home and the slide are
   * not heard. (They are all set going when the reload begins.) What has already begun is left to finish:
   * a sound cut short is a click.
   */
  hush() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    for (const a of this.ahead) {
      if (a.at <= now + 0.02) continue;
      try {
        a.src.stop();
      } catch {
        // (never started, or already over)
      }
    }
    this.ahead = [];
  }

  /**
   * For hearing a recording beside what it replaced (the `?sounds` page sets it): while it is on, the recordings of
   * what a body does all day (EVERYDAY) are passed over, and the made-up sound that stood there before is played.
   */
  asBefore = false;
  /** Told of every recording as it is set going: its name, which take, how loud, how fast (the `?sounds` page lists them, and a check counts by them). */
  heard: ((name: string, take: number, gain: number, rate: number) => void) | null = null;
  /** the take of each recording that was played last: it is not the one played next */
  private lastTake = new Map<string, AudioBuffer>();

  /** whether a recording of what a body does all day is here to be played */
  private has(name: string): boolean {
    return this.ready && !this.asBefore && !!bank.get(name)?.length;
  }

  /**
   * One take of a recording, as it lies on the disk, straight to the ears: for the `?sounds` page.
   * @returns whether there is such a take
   */
  audition(name: string, take: number, gain = 1): boolean {
    const buf = bank.get(name)?.find((b) => takeOf.get(b) === take);
    if (!this.ready || !buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.sfx);
    src.start();
    this.heard?.(name, take, gain, 1);
    return true;
  }

  /**
   * @param later it belongs to a reload and can be taken back before it is heard
   * @param vary a sound heard over and over (a step, a thing picked up): never the take that was played last, and each a little louder or quieter than the one before
   */
  private rec(name: string, to: AudioNode, at: number, gain = 1, rate = 1, later = false, vary = false): boolean {
    const takes = bank.get(name);
    if (!this.ready || !takes?.length || (this.asBefore && name in EVERYDAY)) return false;
    const src = this.ctx.createBufferSource();
    let take = takes[Math.floor(Math.random() * takes.length)];
    if (vary) {
      if (takes.length > 1 && take === this.lastTake.get(name)) take = takes[(takes.indexOf(take) + 1 + Math.floor(Math.random() * (takes.length - 1))) % takes.length];
      this.lastTake.set(name, take);
      gain *= 0.94 + Math.random() * 0.12;
    }
    src.buffer = take;
    // (no two shots from one gun are the same pitch to a hair, and one take played over and over is heard as one take)
    src.playbackRate.value = (0.97 + Math.random() * 0.06) * rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(to);
    src.start(Math.max(at, this.ctx.currentTime));
    this.heard?.(name, takeOf.get(take) ?? 0, gain, src.playbackRate.value);
    if (later) {
      const now = this.ctx.currentTime;
      this.ahead = this.ahead.filter((a) => a.at > now);
      this.ahead.push({ src, at });
    }
    return true;
  }

  // ------------------------------------------------------------ weapons

  /**
   * @param voice a gun that is deeper and louder than its kind: its recording played that much slower and that much louder
   * @param sonic through a suppressor: how much of a crack its round makes, 0 (slower than sound when it leaves: none) .. 1 (a rifle's)
   */
  /** @param left how much of it is left past its distance's own fall-off (src/sim/heard.ts heardShare): 1 near, toward nothing at the edge of where it is heard */
  gunshot(kind: 'rifle' | 'pistol', pos?: V3, distance = 0, intermediate = false, suppressed = false, voice?: Voice, sonic = kind === 'rifle' ? 1 : 0, left = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    // (what is left of it at the edge of where it is heard: in front of where it is placed in the world)
    const fade = (to: AudioNode) => {
      if (!pos || left >= 1) return to;
      const g = ctx.createGain();
      g.gain.value = left;
      g.connect(to);
      return g;
    };
    const t = ctx.currentTime + (distance > 0 ? distance / 343 : 0);
    if (suppressed) {
      // Through a suppressor: a hard flat crack with a thump under it, and still a shot (see QUIET). What the
      // suppressor cannot quiet is the round, and one faster than sound cracks all the way down its flight: that
      // is most of what is heard of a quieted rifle, by whoever fires it and more by anybody to one side, so it is
      // louder, deeper and carries further than a 9 mm, which quieted is slower than sound and has no crack at all.
      const mix = (a: number[]) => a[0] + (a[1] - a[0]) * Math.min(1, Math.max(0, sonic));
      let o2 = fade(this.out(pos, QUIET.ref, QUIET.rolloff, distance * mix(QUIET.dull)));
      if (!pos) {
        // (a node of its own, as an open shot has below: what goes to the hills is tapped from it and from nothing else)
        const own = ctx.createGain();
        own.connect(this.sfx);
        o2 = own;
      }
      // (a little of it comes back from the hills and the walls: it had none, and was a sound in no place at all)
      const back = ctx.createGain();
      back.gain.value = mix(QUIET.send) * (pos ? Math.pow(QUIET.ref / (QUIET.ref + Math.max(0, distance - QUIET.ref)), 0.75) : 1);
      o2.connect(back);
      back.connect(this.reverbSend);
      back.connect(this.echo);
      back.connect(this.roomSend);
      const level = mix(pos ? QUIET.far : QUIET.own);
      // The thump: the gas, let out slowly. It comes up a hundredth of a second behind the crack, as it does, so
      // the two are never at their loudest together.
      const th = ctx.createOscillator();
      th.frequency.setValueAtTime(150, t);
      th.frequency.exponentialRampToValueAtTime(55, t + 0.1);
      const tg = ctx.createGain();
      // (a gun quieted by build with its own recording keeps its thump as low as that is: the VSSK's would else be the loudest of it)
      this.env(tg, t, level * QUIET.thump * (voice?.quiet ? Math.min(1, (voice.quietGain ?? 1) * 4) : 1), 0.01, 0.17);
      th.connect(tg).connect(o2);
      th.start(t);
      th.stop(t + 0.26);
      // (a gun with a quieted shot of its own plays that, at its own level: the VSSK, a 12.7 mm, is no .22)
      if (voice?.quiet ? this.rec(voice.quiet, o2, t, level * (voice.quietGain ?? 1), 1) : this.rec('shot_quiet', o2, t, level, mix(QUIET.rate))) return;
      // (until the recording has come: a made-up snap in its place)
      const n = this.noise(t, 0.12);
      const f = this.filter('bandpass', 1300, 0.8);
      const g = ctx.createGain();
      this.env(g, t, 0.5 * level, 0.002, 0.07);
      n.connect(f).connect(g).connect(o2);
      return;
    }
    const big = kind === 'rifle';
    // 7.62x39: sharper and shorter than the full-power Mosin round
    const mid = intermediate ? 0.72 : 1;
    const reach = voice?.reach ?? 1;
    let out = fade(this.out(pos, (big ? 12 : 8) * reach, 1, distance / reach));
    if (!pos) {
      // your own shot plays into a node of its own. What goes to the hills is tapped from
      // here, and tapping the shared one sent every other sound in the game there as well,
      // for good: one more helping with each shot fired, until a footstep rang like a cave.
      const own = ctx.createGain();
      own.connect(this.sfx);
      out = own;
    }
    const send = ctx.createGain();
    // the echo off the hills is taken before the sound is placed in space: it has to fall off
    // with distance by itself, or a shot across the valley rings as loud as your own
    const ref = (big ? 12 : 8) * reach;
    const fall = pos ? Math.pow(ref / (ref + Math.max(0, distance - ref)), 0.75) : 1;
    send.gain.value = (big ? 0.9 : 0.6) * fall;
    out.connect(send);
    send.connect(this.reverbSend);
    send.connect(this.echo);
    send.connect(this.roomSend);

    // a recording of the real thing, where there is one: it goes the way the made-up one went (placed, dulled by distance, sent to the hills)
    // (A pistol is a few decibels under a rifle and over sooner: scripts/sounds.mjs says what
    // it is made of, and why it was a click before.)
    if (this.rec(voice?.rec ?? (big ? 'shot_rifle' : 'shot_pistol'), out, t, (big ? 2.5 * mid : 2.2) * (voice?.gain ?? 1), voice?.rate ?? 1)) return;

    // 1. supersonic crack / mechanical transient
    const crack = this.noise(t, 0.05);
    const ch = this.filter('highpass', big ? 2200 : 3000);
    const cg = ctx.createGain();
    this.env(cg, t, big ? 1.6 : 1.1, 0.0008, 0.035);
    crack.connect(ch).connect(cg).connect(out);

    // 2. muzzle blast: broadband noise burst, low-passed with a falling cutoff
    const blast = this.noise(t, 0.6);
    const bl = this.filter('lowpass', big ? 3800 : 5200, 0.9);
    bl.frequency.setValueAtTime(big ? 3800 : 5200, t);
    bl.frequency.exponentialRampToValueAtTime(big ? 260 : 520, t + (big ? 0.35 : 0.22));
    const bg = ctx.createGain();
    this.env(bg, t, (big ? 2.2 : 1.4) * mid, 0.002, (big ? 0.55 : 0.3) * mid);
    blast.connect(bl).connect(bg).connect(out);

    // 3. sub-bass thump
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(big ? 95 : 140, t);
    o.frequency.exponentialRampToValueAtTime(big ? 38 : 60, t + 0.18);
    const og = ctx.createGain();
    this.env(og, t, (big ? 1.8 : 0.9) * mid, 0.002, (big ? 0.32 : 0.16) * mid);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.6);
  }

  /**
   * The bunker's door: a klaxon, the bolts thrown, and three seconds of steel on a track.
   * Loud: it is meant to be heard from across the valley. (Made up, like the rest of what
   * this file makes up: nobody has recorded one.)
   */
  blastDoor(pos: V3, distance: number, opening: boolean) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + distance / 343;
    const out = this.out(pos, 16, 0.85, distance * 0.6);
    // A steel door, recorded: drawn open or pushed to as it begins to move, and slammed home as it stops, each
    // slowed to the weight of this one. With those there is no klaxon (it was the made-up part of it, and what was
    // heard across the whole map) and the grinding under them is half what it was.
    const real = this.rec(opening ? 'gate_open' : 'gate_close', out, t + 0.05, 2.6, 0.8);
    if (real) {
      this.rec('gate_slam', out, t + 2.95, 2.8, 0.72);
      // (and its hinges complaining as it goes)
      this.rec('metal_creak', out, t + 0.4, 1.4, 0.8);
    }
    // the klaxon: two notes, turn about, for as long as it moves (only until the recordings have come)
    for (let k = 0; k < (real ? 0 : 6); k++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = k % 2 ? 392 : 523;
      const f = this.filter('bandpass', 900, 1.2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + k * 0.5);
      g.gain.linearRampToValueAtTime(0.9, t + k * 0.5 + 0.04);
      g.gain.setValueAtTime(0.9, t + k * 0.5 + 0.4);
      g.gain.linearRampToValueAtTime(0.0001, t + k * 0.5 + 0.48);
      o.connect(f).connect(g).connect(out);
      o.start(t + k * 0.5);
      o.stop(t + k * 0.5 + 0.5);
    }
    // the bolts, at the start; and the stop it comes up against, at the end
    for (const [at, vol] of real ? [] : [[0.05, 1.6], [0.32, 1.2], [3.05, 2.2]]) {
      // (a recording of steel struck, played at half its speed: an octave down, and twice as long in dying.
      // Until the recordings have come, the made-up thump.)
      if (this.rec('hit_metal', out, t + at, vol * 1.5, 0.5)) continue;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(opening ? 120 : 95, t + at);
      o.frequency.exponentialRampToValueAtTime(38, t + at + 0.2);
      const g = ctx.createGain();
      this.env(g, t + at, vol, 0.004, 0.3);
      o.connect(g).connect(out);
      o.start(t + at);
      o.stop(t + at + 0.6);
      const n = this.noise(t + at, 0.08);
      const nf = this.filter('highpass', 1800);
      const ng = ctx.createGain();
      this.env(ng, t + at, vol * 0.5, 0.002, 0.06);
      n.connect(nf).connect(ng).connect(out);
    }
    // the door itself: a low grinding, with a rattle in it
    const run = this.noise(t + 0.3, 2.9);
    const lp = this.filter('lowpass', 420, 2);
    lp.frequency.setValueAtTime(opening ? 300 : 520, t + 0.3);
    lp.frequency.linearRampToValueAtTime(opening ? 520 : 300, t + 3.1);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t + 0.3);
    rg.gain.linearRampToValueAtTime(real ? 0.9 : 1.9, t + 0.6);
    rg.gain.setValueAtTime(real ? 0.9 : 1.9, t + 2.8);
    rg.gain.linearRampToValueAtTime(0.0001, t + 3.2);
    const shake = ctx.createOscillator();
    shake.frequency.value = 17;
    const sg = ctx.createGain();
    sg.gain.value = real ? 0.3 : 0.7;
    shake.connect(sg).connect(rg.gain);
    run.connect(lp).connect(rg).connect(out);
    shake.start(t + 0.3);
    shake.stop(t + 3.3);
  }

  /**
   * Bunker 17's alarm, heard by everybody on the map as its door opens or shuts (the owner, 2026-10-19: "the bunker
   * door when opened should blare a siren for the whole map ... same with the bunker door close alarm"; the klaxon
   * that was it went with the door's recordings on 2026-10-10). Opening, a motor siren's wail: two notes a third
   * apart wound up, let down and up again twice, and run down. Shutting, a dive alarm's whoop, eight times. Made up:
   * nobody has recorded one for us. How loud and how dull it is are the distance's (src/sim/heard.ts); the panner
   * only says which way.
   * @param pos where it is heard from, on the line to the door (brought near: see the bunker's onMove)
   * @param distance how far off the door is
   * @returns how loud it is played here (for checks)
   */
  alarm(pos: V3, distance: number, opening: boolean): number {
    if (!this.ready) return 0;
    const ctx = this.ctx;
    const t = ctx.currentTime + distance / 343;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.rolloffFactor = 0;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    p.connect(this.sfx);
    const gain = 0.45 * alarmShare(distance);
    const level = ctx.createGain();
    level.gain.value = gain;
    const far = this.filter('lowpass', alarmTop(distance));
    level.connect(far).connect(p);
    // (and the hills give a little of it back)
    const back = ctx.createGain();
    back.gain.value = 0.3;
    far.connect(back).connect(this.reverbSend);
    // the horn's mouth: driven hard, its lowest and its hiss taken off
    const shape = ctx.createWaveShaper();
    const curve = new Float32Array(257);
    for (let i = 0; i < 257; i++) curve[i] = Math.tanh(((i - 128) / 128) * 2.2);
    shape.curve = curve;
    const env = ctx.createGain();
    env.gain.value = 0;
    shape.connect(this.filter('highpass', 160)).connect(this.filter('lowpass', 3600)).connect(env).connect(level);
    const notes = [1, opening ? 1.2 : 1.5].map((k, n) => {
      const o = ctx.createOscillator();
      o.type = n ? 'square' : 'sawtooth';
      const g = ctx.createGain();
      g.gain.value = n ? 0.35 : 0.6;
      o.connect(g).connect(shape);
      return [o, k] as const;
    });
    /** the lower note's pitch at a moment, the upper's with it */
    const at = (when: number, hz: number, ramp: 'set' | 'lin' | 'exp') => {
      for (const [o, k] of notes) {
        const f = o.frequency;
        if (ramp === 'set') f.setValueAtTime(hz * k, t + when);
        else if (ramp === 'lin') f.linearRampToValueAtTime(hz * k, t + when);
        else f.exponentialRampToValueAtTime(hz * k, t + when);
      }
    };
    const loud = (when: number, v: number, ramp: 'set' | 'lin') => (ramp === 'set' ? env.gain.setValueAtTime(v, t + when) : env.gain.linearRampToValueAtTime(v, t + when));
    let end: number;
    if (opening) {
      // wound up from nothing, held, let down to a growl and up again, twice, and left to run down
      at(0, 80, 'set');
      loud(0, 0, 'set');
      at(2.2, 440, 'exp');
      loud(1.6, 1, 'lin');
      let w = 2.2;
      for (let k = 0; k < 3; k++) {
        at((w += 1.4), 450, 'lin');
        loud(w, 1, 'set');
        if (k === 2) break;
        at((w += 1.6), 250, 'exp');
        loud(w, 0.7, 'lin');
        at((w += 1.0), 440, 'exp');
        loud(w, 1, 'lin');
      }
      at((end = w + 3.4), 60, 'exp');
      loud(end, 0, 'lin');
    } else {
      // a whoop a second: up through an octave and a half, cut short
      for (let k = 0; k < 8; k++) {
        const w = k * 1.0;
        at(w, 260, 'set');
        at(w + 0.72, 760, 'exp');
        loud(w, 0, 'set');
        loud(w + 0.03, 1, 'lin');
        loud(w + 0.72, 1, 'set');
        loud(w + 0.8, 0, 'lin');
      }
      end = 8;
    }
    for (const [o] of notes) {
      o.start(t);
      o.stop(t + end + 0.1);
    }
    return gain;
  }

  /** the hammer falling on nothing: it has to be heard over a fight */
  dryFire() {
    this.click(3800, 1.3, 0.022);
    this.click(1900, 0.7, 0.03, 0.012);
  }

  /** short metallic click (bolt, mag, hammer) */
  click(freq = 3000, vol = 0.4, dur = 0.02, delay = 0, pos?: V3, bus?: AudioNode) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    // somebody else's weapon: the same sound, from where they are (and a vehicle's on the vehicles' fader)
    const to = pos ? this.out(pos, 3, 1.2, 0, bus) : this.ears;
    if (pos) vol *= 1.6;
    const n = this.noise(t, dur + 0.03);
    const f = this.filter('bandpass', freq * (0.9 + Math.random() * 0.2), 6);
    const g = this.ctx.createGain();
    this.env(g, t, vol, 0.0008, dur);
    n.connect(f).connect(g).connect(to);
    const ring = this.ctx.createOscillator();
    ring.type = 'triangle';
    ring.frequency.value = freq * 0.71;
    const rg = this.ctx.createGain();
    this.env(rg, t, vol * 0.15, 0.001, dur * 2.5);
    ring.connect(rg).connect(to);
    ring.start(t);
    ring.stop(t + dur * 3 + 0.05);
  }

  // A bolt worked, a magazine changed, a slide racked: these are recordings and nothing else.
  // (They used to be made up out of clicks, and the made-up ones stood in wherever a recording
  // was missing: there is no made-up one now.)

  /**
   * The sniper's bolt worked: a recording of one. Heard by whoever works it, and by anybody within a few paces
   * (`pos`). It was once heard forty metres off, after every shot from every rifle about, and was taken out for
   * that; it is back for the rifle's own hands, and close by.
   */
  boltCycle(start = 0, pos?: V3, rec: 'bolt' | 'pump' = 'bolt') {
    if (this.ready) this.rec(rec, pos ? this.out(pos, 2, 1.6) : this.sfx, this.ctx.currentTime + start, pos ? 1.1 : 0.95);
  }

  /** another player close by reloading: a magazine out and one in, from where they stand (it is not heard across a field) */
  reloadNear(pos: V3, dur: number, pistol: boolean) {
    if (!this.ready) return;
    const now = this.ctx.currentTime, kind = pistol ? 'pistol' : 'rifle';
    this.rec(`${kind}_mag_out`, this.out(pos, 2, 1.7), now + dur * (pistol ? 0.12 : 0.28), 1.1);
    this.rec(`${kind}_mag_in`, this.out(pos, 2, 1.7), now + dur * (pistol ? 0.48 : 0.62), 1.1);
  }

  /**
   * @param long a rifle's magazine (a pistol's, if not)
   * @param set a gun with recordings of its own being handled ('ak', 'ar'): they are what is heard, if they have come
   */
  magOut(delay = 0, long = false, set?: string) {
    if (!this.ready) return;
    if (set && this.rec(`${set}_mag_out`, this.sfx, this.ctx.currentTime + delay, 0.95, 1, true)) return;
    this.rec(long ? 'rifle_mag_out' : 'pistol_mag_out', this.sfx, this.ctx.currentTime + delay, 0.95, 1, true);
  }

  magIn(delay = 0, long = false, set?: string) {
    if (!this.ready) return;
    if (set && this.rec(`${set}_mag_in`, this.sfx, this.ctx.currentTime + delay, 0.95, 1, true)) return;
    this.rec(long ? 'rifle_mag_in' : 'pistol_mag_in', this.sfx, this.ctx.currentTime + delay, 0.95, 1, true);
  }

  /** a shell pushed into a shotgun's tube */
  shellIn(delay = 0) {
    if (this.ready && !this.rec('shell_in', this.sfx, this.ctx.currentTime + delay, 0.95, 1, true)) this.magIn(delay, false);
  }

  slideRack(delay = 0, set?: string) {
    if (!this.ready) return;
    if (set && this.rec(`${set}_rack`, this.sfx, this.ctx.currentTime + delay, 0.95, 1, true)) return;
    this.rec('rack', this.sfx, this.ctx.currentTime + delay, 0.95, 1, true);
  }

  shellDrop(delay = 0.35) {
    if (!this.ready) return;
    // (a recording of a spent case landing, when it has come; until then three made-up ticks)
    if (this.rec('casing', this.sfx, this.ctx.currentTime + delay, 0.32, 0.92 + Math.random() * 0.16, true, true)) return;
    for (let i = 0; i < 3; i++) this.click(5200 + Math.random() * 1500, 0.08 / (i + 1), 0.04, delay + i * 0.09 + Math.random() * 0.03);
  }

  /**
   * A bullet going past your head: the crack of a round faster than sound, and the zip of air behind any round
   * that comes close. `pos` is where on its path it is heard from, `miss` how close it came (metres).
   *
   * The crack (see CRACK) was a tick: five thousandths of a second of hiss with nothing in it under 3 kHz, half
   * as loud as a shot at its loudest, and nothing at all past five metres. It is the whole of a crack now, from
   * 1 kHz up, as loud at its loudest as a rifle is to whoever fires it; it rings on for a few hundredths of a
   * second, as it does over open ground, and comes a second time off the ground. A slow round has none of this:
   * its zip is as it was.
   */
  whiz(pos: V3, miss: number, delay = 0, supersonic = true) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    // (placed, and no more than placed: how loud each part of it is at this distance is said here, by `miss`)
    const out = this.out(pos, 30, 1);
    const level = supersonic ? crackLevel(miss) : 0;
    if (level > 0) {
      const back = ctx.createGain();
      back.gain.value = CRACK.send;
      out.connect(back);
      back.connect(this.reverbSend);
      back.connect(this.roomSend);
      const bounce = Math.hypot(miss, 2 * CRACK.ear);
      const waves: [after: number, peak: number][] = [[0, level], [(bounce - miss) / 343, level * CRACK.ground * Math.pow(miss / bounce, 0.75)]];
      for (const [after, peak] of waves) {
        if (peak < 0.01) continue;
        // (a recording of a round's crack going by, where they have come; the made-up one until then)
        if (this.rec('bullet_crack', out, t + after, peak * 1.1, 0.95 + Math.random() * 0.1, false, true)) continue;
        const c = this.noise(t + after, CRACK.shape[2]);
        const hp = this.filter('highpass', 1000);
        const cg = ctx.createGain();
        // up at once, half of the way down in eight thousandths of a second, and the rest of it over the next tenth
        cg.gain.setValueAtTime(0.0001, t + after);
        cg.gain.exponentialRampToValueAtTime(peak, t + after + CRACK.shape[0]);
        cg.gain.exponentialRampToValueAtTime(peak * 0.5, t + after + CRACK.shape[1]);
        cg.gain.exponentialRampToValueAtTime(0.0001, t + after + CRACK.shape[2]);
        c.connect(hp).connect(cg).connect(out);
      }
    }
    // the zip: heard within five metres, and as loud as it was (it fell away from two metres, by the placing of it)
    const near = Math.max(0, 1 - miss / 5);
    if (near <= 0) return;
    const n = this.noise(t, 0.2);
    const f = this.filter('bandpass', 4200, 5);
    f.frequency.setValueAtTime(4600, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.16);
    const g = ctx.createGain();
    this.env(g, t, (0.18 + near * 0.35) * Math.min(1, 2 / Math.max(miss, 1e-3)), 0.004, 0.15);
    n.connect(f).connect(g).connect(out);
  }

  /** your shot landed on somebody (a dry tick), or killed them (a heavier double) */
  hitTick(kill: boolean, head = false) {
    // (it is no sound of the world: the interface's, with the click that is part of it)
    if (this.ready) this.of('ui', () => this.landed(kill, head));
  }
  private landed(kill: boolean, head: boolean) {
    if (!kill) {
      // a dry tick you can pick out under your own gunfire
      const t0 = this.ctx.currentTime;
      const tick = this.ctx.createOscillator();
      tick.type = 'triangle';
      tick.frequency.setValueAtTime(1750, t0);
      tick.frequency.exponentialRampToValueAtTime(1250, t0 + 0.035);
      const tg = this.ctx.createGain();
      tg.gain.setValueAtTime(0.85, t0);
      tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
      tick.connect(tg).connect(this.ears);
      tick.start(t0);
      tick.stop(t0 + 0.09);
      this.click(2600, 0.5, 0.012);
      // a head shot rings: you know it before you see them drop
      if (head) {
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = 2350;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g).connect(this.ears);
        o.start(t);
        o.stop(t + 0.24);
      }
      return;
    }
    const t = this.ctx.currentTime;
    this.click(1300, 0.3, 0.02);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(190, t + 0.03);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.2);
    const g = this.ctx.createGain();
    this.env(g, t + 0.03, 0.4, 0.004, 0.2);
    o.connect(g).connect(this.ears);
    o.start(t + 0.03);
    o.stop(t + 0.3);
  }

  /** a weapon coming up into the hands: sling and cloth, then metal settling */
  equip(kind: 'gun' | 'melee' | 'hands') {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const n = this.noise(t, 0.22);
    const f = this.filter('bandpass', 1700, 0.7);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    n.connect(f).connect(g).connect(this.sfx);
    if (kind === 'gun') {
      this.click(2300, 0.16, 0.02, 0.1);
      this.click(1500, 0.14, 0.03, 0.17);
    } else if (kind === 'melee') this.click(3800, 0.1, 0.03, 0.12);
  }

  /** kit shifting on the body with every step: louder the more you carry */
  private gear(t: number, vol: number) {
    const n = this.noise(t, 0.09);
    const f = this.filter('bandpass', 2600 + Math.random() * 1400, 1.2);
    const g = this.ctx.createGain();
    this.env(g, t, vol, 0.012, 0.06);
    n.connect(f).connect(g).connect(this.sfx);
  }

  /**
   * A recorded foot on the ground (see STEPS), if the recording has come.
   * @param speed over the ground, m/s: a foot set down slowly is lower and has no slap in it
   * @param vol how loud, as the made-up step is told
   * @param after seconds from now
   * @returns whether there was one to play: if not, the caller makes the step up as it used to
   */
  private step(surface: string, speed: number, vol: number, to: AudioNode, after = 0): boolean {
    const [name, level, over, overLevel = 0] = STEPS[surface] ?? STEPS.grass;
    if (!this.has(name)) return false;
    const t = this.ctx.currentTime + after;
    const tone = this.filter('lowpass', Math.min(16000, 1400 + speed * 2600), 0.5);
    tone.connect(to);
    const rate = 0.93 + Math.min(speed, 7) * 0.02;
    this.rec(name, tone, t, vol * level * STEP_GAIN, rate, false, true);
    if (over) this.rec(over, tone, t, vol * overLevel * STEP_GAIN, rate, false, true);
    return true;
  }

  /** pushing off the ground @param surface what the feet push off */
  jump(surface: Surface | 'grass' | 'dirt' | 'gravel' | 'snow' = 'grass') {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.gear(t, 0.09);
    // (the feet leaving it: a step on whatever is under them, quietly. Until the recordings have come, a made-up scuff.)
    if (this.step(surface, 2, 0.8, this.sfx)) return;
    const n = this.noise(t, 0.16);
    const f = this.filter('bandpass', 1100, 1.5);
    const g = this.ctx.createGain();
    this.env(g, t, 0.07, 0.03, 0.1);
    n.connect(f).connect(g).connect(this.sfx);
  }

  /** coming down: the feet, the weight behind them, and the kit catching up */
  land(surface: Surface | 'grass' | 'dirt' | 'gravel' | 'snow', speed: number) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, speed / 11);
    this.footstep(surface, 3 + k * 5);
    // Recorded: the other foot a moment after the first, and the weight of the body behind them, which is a
    // soft heavy thing struck. (Until they have come, the made-up thump.)
    if (this.rec('thud', this.sfx, t + 0.012, EVERY.land.thud[0] + k * EVERY.land.thud[1], EVERY.land.rate[0] + k * EVERY.land.rate[1], false, true)) {
      this.step(surface, 3 + k * 5, Math.min(1, 0.36 + k * 0.35) * 3.2 * EVERY.land.other, this.sfx, 0.03 + k * 0.02);
      this.gear(t + 0.03, 0.06 + k * 0.12);
      return;
    }
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = this.ctx.createGain();
    this.env(g, t, 0.15 + k * 0.55, 0.003, 0.14);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.25);
    this.gear(t + 0.03, 0.06 + k * 0.12);
  }

  /**
   * A body going down, recorded: its weight on the ground, its clothes, and a moment after the rest of it (an arm,
   * the head). @returns whether the recordings were there
   */
  private fallen(to: AudioNode, at: number, level: number): boolean {
    if (!this.rec('thud', to, at, EVERY.body.thud * level, 0.92, false, true)) return false;
    this.rec('step_soft', to, at + 0.01, EVERY.body.cloth * level, 0.85, false, true);
    this.rec('thud', to, at + 0.17 + Math.random() * 0.05, EVERY.body.after * level, 1.25, false, true);
    return true;
  }

  /** Somebody else's body going down, heard from where it falls (their own is `death`). */
  bodyFall(pos: V3, distance = 0) {
    if (!this.ready || distance > 40) return;
    this.fallen(this.out(pos, 3, 1.3, distance), this.ctx.currentTime + 0.45 + distance / 343, EVERY.body.other);
  }

  /** the last breath going out, and the body hitting the ground */
  death() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // (Recorded, it is the body alone: the breath was a voice made up out of hiss, and made-up voices are gone
    // from this game. Until the recordings have come, both as they were.)
    if (this.fallen(this.sfx, t + 0.45, 1)) return;
    const n = this.noise(t, 1.1);
    const f = this.filter('bandpass', 620, 1.6);
    f.frequency.setValueAtTime(760, t);
    f.frequency.exponentialRampToValueAtTime(330, t + 1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
    n.connect(f).connect(g).connect(this.sfx);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(95, t + 0.45);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.62);
    const og = this.ctx.createGain();
    this.env(og, t + 0.45, 0.6, 0.004, 0.2);
    o.connect(og).connect(this.sfx);
    o.start(t + 0.45);
    o.stop(t + 0.8);
  }

  /**
   * Call every frame. Out of breath: you hear yourself breathing, faster and louder the
   * emptier the lungs. Badly hurt: your own pulse.
   */
  body(dt: number, stamina: number, health: number, alive: boolean, bleeding = false) {
    if (!this.ready || !alive) return;
    const ctx = this.ctx;
    const tired = Math.max(0, Math.min(1, (48 - stamina) / 48));
    if (tired > 0.04) {
      this.breathT -= dt;
      if (this.breathT <= 0) {
        const inhale = this.breathIn;
        this.breathIn = !inhale;
        const cycle = 1.7 - tired * 0.95;
        this.breathT = cycle * (inhale ? 0.45 : 0.55);
        const t = ctx.currentTime;
        const dur = this.breathT * 0.82;
        const n = this.noise(t, dur);
        const f = this.filter('bandpass', inhale ? 2100 : 1050, inhale ? 1.1 : 0.8);
        const g = ctx.createGain();
        const peak = (0.035 + tired * 0.11) * (inhale ? 0.8 : 1);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + dur * (inhale ? 0.55 : 0.2));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        n.connect(f).connect(g).connect(this.sfx);
      }
    } else {
      this.breathT = 0;
      this.breathIn = true;
    }
    // an open wound: the pulse is there from the start, quiet, and grows as the health goes
    const hurt = Math.max(bleeding ? 0.22 : 0, Math.min(1, (36 - health) / 36));
    if (hurt > 0) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 1.0 - hurt * 0.38;
        const t = ctx.currentTime;
        for (const [at, f0, v] of [[0, 62, 1], [0.17, 50, 0.7]] as const) {
          const o = ctx.createOscillator();
          o.frequency.setValueAtTime(f0, t + at);
          o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + at + 0.1);
          const g = ctx.createGain();
          this.env(g, t + at, (0.2 + hurt * 0.4) * v, 0.006, 0.11);
          o.connect(g).connect(this.sfx);
          o.start(t + at);
          o.stop(t + at + 0.2);
        }
      }
    }
  }

  // ------------------------------------------------------------ world

  /** latch click + hinge creak (opening) or a soft thud (closing) */
  /**
   * An animal heard (src/sim/animal-calls.ts, and its own movements: src/game/animals.ts): its recording,
   * assets/sounds/animal_<name>.wav, fetched when one is first heard, from where it was, as late as sound takes to come
   * and dulled with the distance as a shot is. Silent where there is no recording.
   */
  animalCall(name: string, pos: V3, distance: number, gain = 1, waited = false) {
    if (!this.ready) return;
    const buf = bank.get(`animal_${name}`)?.[0];
    if (!buf) {
      // (the first is heard once it is here, if that is soon)
      if (!waited) {
        const asked = performance.now();
        void lateRecording(`animal_${name}`).then(() => performance.now() - asked < 1500 && this.animalCall(name, pos, distance, gain, true));
      }
      return;
    }
    const src = this.ctx.createBufferSource(), level = this.ctx.createGain();
    src.buffer = buf;
    level.gain.value = gain;
    src.connect(level).connect(this.out(pos, 10, 1, distance, this.bus.ambience));
    src.start(this.ctx.currentTime + distance / 343);
  }

  door(opening: boolean, pos: V3, distance = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // From where the door is, and a thing of the room it is in: all of it at an arm's length, a fifth of it across
    // the room, a twentieth across a yard, and duller the further off. (It was given to fall away as a gunshot
    // does, and the recordings are as loud as recordings are: a door thirty metres off was a door at your elbow.
    // Reported 2026-10-10: "too loud, and not in proximity to its source".)
    const out = this.out(pos, 1.6, 2.4, distance * 6);
    // Recordings of a wooden door, where they have come: opened (the handle, and its hinge a moment after, quietly),
    // or swung to and shut. Until then, the made-up click, creak and thud.
    // (Shut, it is the same recording as opened, a little lower: asked for 2026-10-10, the recording of one
    // being shut not being liked.)
    // (the owner's own recording of a wooden door, 2026-10-17, its opening and its shutting apart: "add sound for door
    // open close as well"; the earlier ones, until it has come)
    if (opening ? this.rec('door_opened', out, t, 0.8) : this.rec('door_shut', out, t + 0.04, 0.7)) return;
    if (opening ? this.rec('door_open', out, t, 0.7) : this.rec('door_open', out, t + 0.12, 0.7, 0.92)) {
      if (opening) this.rec('door_creak', out, t + 0.14, 0.22);
      return;
    }
    this.click(opening ? 1400 : 900, 0.4, 0.04, 0, pos);
    if (opening) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      const f0 = 160 + Math.random() * 120;
      o.frequency.setValueAtTime(f0, t + 0.05);
      o.frequency.linearRampToValueAtTime(f0 * 1.35, t + 0.35);
      o.frequency.linearRampToValueAtTime(f0 * 0.9, t + 0.7);
      const wob = this.ctx.createOscillator();
      wob.frequency.value = 11 + Math.random() * 6;
      const wg = this.ctx.createGain();
      wg.gain.value = f0 * 0.08;
      wob.connect(wg).connect(o.frequency);
      const f = this.filter('bandpass', 1100, 4);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + 0.05);
      g.gain.linearRampToValueAtTime(0.22, t + 0.18);
      g.gain.linearRampToValueAtTime(0.12, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      o.connect(f).connect(g).connect(out);
      o.start(t + 0.05);
      wob.start(t + 0.05);
      o.stop(t + 0.85);
      wob.stop(t + 0.85);
    } else {
      const n = this.noise(t + 0.35, 0.15);
      const f = this.filter('lowpass', 380, 1);
      const g = this.ctx.createGain();
      this.env(g, t + 0.35, 0.7, 0.003, 0.12);
      n.connect(f).connect(g).connect(out);
      this.click(700, 0.35, 0.05, 0.38, pos);
    }
  }

  /**
   * A steel locker's doors: pulled open, or swung to and shut (src/game/lockers.ts). The recordings of the steel
   * door there are, played quicker for a door a tenth of that one's weight, and quietly: a thing of the room it is
   * in, as a house's door is. Shut, the sound is of the leaves meeting the frame, which is when the swing ends.
   * (Until the recordings have come, a house's door.)
   * @param swing how long the leaves take to swing, seconds
   */
  locker(opening: boolean, pos: V3, distance = 0, swing = 0.5) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const out = this.out(pos, 1.6, 2.4, distance * 6);
    if (opening ? this.rec('gate_open', out, t, 0.5, 1.5) : this.rec('gate_slam', out, t + swing * 0.85, 0.42, 1.6)) {
      if (opening) this.rec('metal_creak', out, t + 0.05, 0.28, 1.3);
      return;
    }
    this.door(opening, pos, distance);
  }

  /**
   * A blow landing on a body: a fist, or something heavier swung. A recording of one; until they have come, the
   * thud a round makes in flesh.
   */
  blow(fist: boolean, pos: V3, distance: number) {
    if (!this.ready) return;
    if (!this.rec(fist ? 'punch' : 'blow', this.out(pos, 3, 1.3, distance), this.ctx.currentTime, fist ? 1.5 : 1.7)) this.impact('flesh', pos, distance);
  }

  impact(surface: Surface, pos: V3, distance: number) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const out = this.out(pos, 3, 1.3, distance);
    // (steel struck is a recording of steel struck: a car's door, a drum, a locker. Until they have come, the made-up ring.)
    if (surface === 'metal' && this.rec('hit_metal', out, t, 1.5)) return;
    // (and wood struck is a recording of wood struck: a door, a crate, a fence, a round or an axe into any of them)
    if (surface === 'wood' && this.rec('hit_wood', out, t, EVERY.wood, 1, false, true)) return;
    const n = this.noise(t, 0.2);
    let f: BiquadFilterNode;
    let peak = 0.7;
    let dec = 0.08;
    switch (surface) {
      case 'metal': {
        f = this.filter('bandpass', 2600 + Math.random() * 1600, 12);
        peak = 0.9;
        dec = 0.4;
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = 1800 + Math.random() * 1400;
        const og = this.ctx.createGain();
        this.env(og, t, 0.25, 0.001, 0.5);
        o.connect(og).connect(out);
        o.start(t);
        o.stop(t + 0.6);
        break;
      }
      case 'wood':
        f = this.filter('bandpass', 700, 3);
        dec = 0.09;
        break;
      case 'concrete':
      case 'rock':
      case 'plaster':
      case 'asphalt':
        f = this.filter('bandpass', 1800, 1.5);
        dec = 0.06;
        break;
      case 'flesh':
        f = this.filter('lowpass', 600, 1);
        peak = 1.0;
        dec = 0.12;
        break;
      case 'glass':
        f = this.filter('highpass', 3500, 1);
        dec = 0.3;
        break;
      default:
        f = this.filter('lowpass', 900, 0.8);
        peak = 0.6;
        dec = 0.1;
    }
    const g = this.ctx.createGain();
    this.env(g, t, peak * 2.4, 0.001, dec);
    n.connect(f).connect(g).connect(out);
  }

  /** @param carried weight on the player's back (own steps only): the kit shifts with each one */
  footstep(surface: Surface | 'grass' | 'dirt' | 'gravel' | 'snow' | 'water', speed: number, pos?: V3, carried = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const vol = Math.min(1, 0.15 + speed * 0.07) * (pos ? 5.5 : 3.2);
    let out = this.out(pos, 4, 1.1);
    if (!pos) {
      // your own feet: one a little to the left, the next a little to the right
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = 0.14 * (this.stepSide = -this.stepSide);
      pan.connect(this.sfx);
      out = pan;
      if (speed > 2.4) this.gear(t + 0.02, Math.min(0.1, 0.012 + carried * 0.004 + speed * 0.004));
    }
    const layer = (type: BiquadFilterType, freq: number, q: number, v: number, a: number, d: number, at = 0) => {
      const n = this.noise(t + at, a + d + 0.02);
      const f = this.filter(type, freq * (0.85 + Math.random() * 0.3), q);
      const g = this.ctx.createGain();
      this.env(g, t + at, v * vol, a, d);
      n.connect(f).connect(g).connect(out);
    };
    // A recording of a foot on that kind of ground, where it has come (see STEPS). Until then, and for the grit of
    // gravel under the boot, which nobody has recorded, the made-up one below.
    if (this.step(surface, speed, vol, out)) {
      if (surface === 'gravel') for (let i = 0; i < 5; i++) layer('bandpass', 2500 + i * 700, 3, 0.18, 0.001, 0.03, i * 0.014);
      return;
    }
    switch (surface) {
      case 'wood':
        layer('bandpass', 320, 1.2, 1.7, 0.003, 0.07);
        layer('bandpass', 1400, 3, 0.4, 0.002, 0.05, 0.01);
        break;
      case 'gravel':
      case 'rock':
        for (let i = 0; i < 5; i++) layer('bandpass', 2500 + i * 700, 3, 0.18, 0.001, 0.03, i * 0.014);
        layer('lowpass', 500, 1, 0.3, 0.004, 0.06);
        break;
      case 'concrete':
      case 'asphalt':
        layer('bandpass', 900, 1.2, 0.8, 0.002, 0.05);
        layer('highpass', 4000, 1, 0.16, 0.001, 0.03, 0.01);
        break;
      case 'metal':
        layer('bandpass', 1800, 8, 0.4, 0.002, 0.12);
        break;
      case 'dirt':
        layer('lowpass', 700, 1, 0.45, 0.006, 0.08);
        break;
      case 'water':
        // (a foot going in and coming out: the slap of it, the slosh after, and the drops falling back)
        layer('lowpass', 600, 0.8, 0.7, 0.004, 0.16);
        layer('bandpass', 1500, 1.4, 0.45, 0.012, 0.22, 0.03);
        for (let i = 0; i < 4; i++) layer('bandpass', 2600 + Math.random() * 2400, 6, 0.1, 0.001, 0.025, 0.12 + Math.random() * 0.18);
        break;
      default: // grass: soft swish + muffled thud
        layer('highpass', 2500, 0.6, 0.16, 0.02, 0.12);
        layer('lowpass', 380, 1, 0.3, 0.006, 0.07);
    }
  }

  /**
   * A body dragged a pull along the ground on its front: cloth and kit scraping over what it lies on, softer than a
   * step and longer. Somebody else's comes from where they are and dies away sooner than their steps would.
   */
  crawl(surface: Surface | 'grass' | 'dirt' | 'gravel' | 'snow', pos?: V3) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const out = this.out(pos, 3, 1.4);
    // (a third of what it was: long drags, two and a third a second at a full crawl, came to three times the sound of
    // walking. The owner, 2026-10-14: walking quieter than running, crouched than walking, prone than crouched.)
    const vol = pos ? 0.4 : 0.26;
    const drag = (type: BiquadFilterType, freq: number, q: number, v: number, a: number, d: number, at = 0) => {
      const n = this.noise(t + at, a + d + 0.02);
      const f = this.filter(type, freq * (0.85 + Math.random() * 0.3), q);
      const g = this.ctx.createGain();
      this.env(g, t + at, v * vol, a, d);
      n.connect(f).connect(g).connect(out);
    };
    switch (surface) {
      case 'wood':
        drag('bandpass', 600, 1.5, 0.35, 0.08, 0.3);
        break;
      case 'gravel':
      case 'rock':
        drag('bandpass', 2600, 1.2, 0.3, 0.06, 0.32);
        drag('lowpass', 500, 1, 0.2, 0.05, 0.25, 0.05);
        break;
      case 'concrete':
      case 'asphalt':
        drag('bandpass', 1800, 1, 0.3, 0.07, 0.3);
        break;
      case 'metal':
        drag('bandpass', 2200, 4, 0.25, 0.05, 0.3);
        break;
      case 'dirt':
        drag('lowpass', 900, 0.8, 0.4, 0.08, 0.32);
        break;
      default: // grass, snow: a long swish and the body's weight in it
        drag('highpass', 1800, 0.5, 0.22, 0.1, 0.35);
        drag('lowpass', 420, 1, 0.22, 0.08, 0.3, 0.04);
    }
    // (and the cloth and what is carried, rubbing)
    drag('bandpass', 3800, 2, 0.1, 0.04, 0.2, 0.06);
  }

  /**
   * Arm cutting through the air (punches, swings).
   * @param weight 0 = a fist, 1 = a bat or a crowbar: lower, longer and louder
   * @param pos somebody else's swing, heard from where they stand
   */
  whoosh(weight = 0, pos?: V3) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const len = 0.18 + weight * 0.1;
    const n = this.noise(t, len + 0.04);
    const f = this.filter('bandpass', 500, 1.4);
    const top = 1500 - weight * 550;
    f.frequency.setValueAtTime(350 - weight * 110, t);
    f.frequency.exponentialRampToValueAtTime(top, t + len * 0.5);
    f.frequency.exponentialRampToValueAtTime(top / 3, t + len);
    const g = this.ctx.createGain();
    this.env(g, t, 0.36 + weight * 0.22, len * 0.3, len * 0.7);
    n.connect(f).connect(g).connect(pos ? this.out(pos, 2, 1.5) : this.sfx);
  }

  /**
   * A grenade going off. Close, it is a crack and a blow to the chest; far off, a dull thump
   * and the hills answering.
   * @param drum a fuel drum rather than a grenade: the steel tearing, and the fuel going up after it
   */
  explosion(pos: V3, distance: number, drum = false) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + distance / 343;
    const out = this.out(pos, 14, 1, distance);
    const fall = Math.pow(14 / (14 + Math.max(0, distance - 14)), 0.75);
    const send = ctx.createGain();
    send.gain.value = 1.1 * fall;
    out.connect(send);
    send.connect(this.reverbSend);
    send.connect(this.echo);
    send.connect(this.roomSend);
    const crack = this.noise(t, 0.08);
    const ch = this.filter('highpass', 1800);
    const cg = ctx.createGain();
    this.env(cg, t, 2.2, 0.001, 0.06);
    crack.connect(ch).connect(cg).connect(out);
    const body = this.noise(t, 1.4);
    const bl = this.filter('lowpass', 2600, 0.8);
    bl.frequency.setValueAtTime(2600, t);
    bl.frequency.exponentialRampToValueAtTime(120, t + 0.9);
    const bg = ctx.createGain();
    this.env(bg, t, 3, 0.004, 1.2);
    body.connect(bl).connect(bg).connect(out);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(78, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.7);
    const og = ctx.createGain();
    this.env(og, t, 2.6, 0.003, 0.9);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 1.2);
    if (!drum) return;
    // the drum itself: a struck, hollow ring that drops as it tears open
    const ring = this.noise(t, 0.7);
    const rf = this.filter('bandpass', 520, 9);
    rf.frequency.setValueAtTime(560, t);
    rf.frequency.exponentialRampToValueAtTime(240, t + 0.55);
    const rg = ctx.createGain();
    this.env(rg, t, 3.2, 0.002, 0.55);
    ring.connect(rf).connect(rg).connect(out);
    // and the fuel: a slower, softer rush of flame behind the bang
    const rush = this.noise(t + 0.06, 1.7);
    const wf = this.filter('lowpass', 900, 0.6);
    wf.frequency.setValueAtTime(1400, t + 0.06);
    wf.frequency.exponentialRampToValueAtTime(180, t + 1.5);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.0001, t + 0.06);
    wg.gain.exponentialRampToValueAtTime(1.5, t + 0.3);
    wg.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    rush.connect(wf).connect(wg).connect(out);
  }

  /**
   * What the hands are heard doing. One's own, in the ears; somebody else's from where they are, and only close
   * to: these are small sounds, lost within a room's length (who is near enough to be told at all is the game's
   * to say: see RemotePlayer.act).
   * @param pos somebody else's hands: where they are
   * @param what the thing taken up, put down or moved (an item's id), where the caller knows it: a tin is not
   *   heard as a rifle is. Not known, it is heard as anything is.
   */
  ui(kind: 'pickup' | 'drop' | 'open' | 'close' | 'eat' | 'drink' | 'bandage' | 'inject' | 'move' | 'smoke' | 'unbox' | 'round' | 'mag', pos?: V3, what?: string) {
    if (!this.ready) return;
    // (one's own hands are the interface's to turn down; somebody else's, heard from where they stand, are the world's)
    if (pos) this.hands(kind, pos, what);
    else this.of('ui', () => this.hands(kind, undefined, what));
  }
  private hands(kind: Parameters<AudioEngine['ui']>[0], pos?: V3, what?: string) {
    const t = this.ctx.currentTime;
    const to = pos ? this.out(pos, 1.2, 2.2) : (this.ears as AudioNode);
    if (kind === 'pickup' || kind === 'drop' || kind === 'move') {
      // Recordings, where they have come: the thing itself by what it is made of (see HANDLED), and with it the
      // hand on cloth: closing on it as it is taken, or the pocket it is moved to. Put down, it is lower and a
      // little louder, and a gun let go clatters. (Until they have come, the made-up rustles below.)
      const made = handling(what), [name, level] = TAKEN[made], near = pos ? EVERY.hand.other : 1;
      const [gain, rate] = EVERY.hand[kind];
      if (kind === 'drop' && made === 'gun' && this.rec('drop_gun', to, t, EVERY.hand.gun * near, 1, false, true)) return;
      if (this.rec(name, to, t + (kind === 'pickup' ? 0.03 : 0), gain * level * near, rate, false, true)) {
        if (kind !== 'drop' && made !== 'soft') this.rec('step_soft', to, t, gain * EVERY.hand.cloth * near, 1.3, false, true);
        return;
      }
    }
    // (a drink, recorded: the gulps, and not the "ahh" after them)
    if (kind === 'drink' && this.rec('drink', to, t, pos ? EVERY.hand.other : 0.9, 1, false, true)) return;
    const rustle = (dur: number, freq: number, vol: number, at = 0) => {
      const n = this.noise(t + at, dur);
      const f = this.filter('bandpass', freq, 0.8);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.linearRampToValueAtTime(vol, t + at + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      n.connect(f).connect(g).connect(to);
    };
    switch (kind) {
      case 'unbox':
        // a card box of rounds torn open: the flap, the tray drawn out, and the brass shifting in it
        rustle(0.22, 1300, 0.22);
        rustle(0.3, 2600, 0.16, 0.2);
        for (let i = 0; i < 5; i++) this.click(4200 + i * 300, 0.1, 0.012, 0.5 + i * 0.07, pos);
        rustle(0.18, 900, 0.18, 0.95);
        break;
      case 'round':
        // a round pushed into a magazine against its spring: a recording, or until it has come a click of brass on steel
        if (!this.rec('mag_round', to, t, pos ? 1.3 : 0.9, 1.12)) {
          this.click(3100, 0.3, 0.014, 0, pos);
          this.click(1700, 0.22, 0.03, 0.035, pos);
        }
        break;
      case 'mag':
        // a magazine seated in a gun by hand, with no reload about it
        if (!this.rec('pistol_mag_in', to, t, pos ? 1.1 : 0.8)) this.click(1900, 0.45, 0.05, 0, pos);
        break;
      case 'pickup':
        rustle(0.18, 2200, 0.25);
        rustle(0.1, 900, 0.2, 0.08);
        break;
      case 'drop':
        rustle(0.12, 600, 0.3);
        break;
      case 'open':
        for (let i = 0; i < 6; i++) rustle(0.05, 3500 + i * 150, 0.07, i * 0.035);
        break;
      case 'close':
        rustle(0.15, 1500, 0.15);
        break;
      case 'eat':
        for (let i = 0; i < 4; i++) rustle(0.08, 900, 0.25, i * 0.22);
        break;
      case 'drink':
        for (let i = 0; i < 4; i++) {
          const o = this.ctx.createOscillator();
          o.frequency.setValueAtTime(320, t + i * 0.25);
          o.frequency.exponentialRampToValueAtTime(180, t + i * 0.25 + 0.12);
          const g = this.ctx.createGain();
          this.env(g, t + i * 0.25, 0.12, 0.01, 0.12);
          o.connect(g).connect(to);
          o.start(t + i * 0.25);
          o.stop(t + i * 0.25 + 0.2);
        }
        break;
      case 'bandage':
        for (let i = 0; i < 5; i++) rustle(0.14, 1800, 0.15, i * 0.3);
        break;
      case 'inject':
        // it lands on the sleeve, the spring goes, and what it drives hisses home (in time with the hands: weapons.ts, INJECT)
        rustle(0.09, 700, 0.3, 0.03);
        this.click(2600, 0.2, 0.015, 0.045);
        this.click(1500, 0.36, 0.03, 0.16);
        this.click(900, 0.22, 0.05, 0.175);
        rustle(0.5, 5200, 0.075, 0.2);
        break;
      case 'move':
        rustle(0.07, 1200, 0.12);
        break;
      case 'smoke':
        // the lighter, and then twice over: a long draw in, a longer breath out (in time with the hand: see weapons.ts, SMOKE)
        this.click(3600, 0.3, 0.02, 0.08);
        this.click(2500, 0.16, 0.03, 0.14);
        for (const at of [0.7, 2.35]) {
          rustle(0.55, 2400, 0.07, at);
          rustle(0.8, 900, 0.1, at + 0.85);
        }
        break;
    }
  }

  /**
   * Being hit: the blow landing, and the grunt it knocks out of you.
   * @param pos somebody else being hit: their grunt, from where they are, when the sound gets here
   */
  /** a bone going: one dull crack, your own */
  snap() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // (a recording of wood breaking, a little slowed, which is what a bone has always been on film. Until it has come, the made-up crack.)
    if (this.rec('snap', this.sfx, t, EVERY.snap[0], EVERY.snap[1], false, true)) return;
    const src = this.noise(t, 0.06);
    const lo = this.filter('bandpass', 260, 1.2), hi = this.filter('highpass', 2400, 0.8);
    const g = ctx.createGain(), gh = ctx.createGain();
    this.env(g, t, 0.5, 0.003, 0.07);
    this.env(gh, t, 0.22, 0.001, 0.02);
    src.connect(lo).connect(g).connect(this.sfx);
    src.connect(hi).connect(gh).connect(this.sfx);
  }

  /**
   * A fire burning near by: the hiss of it, and wood cracking in it.
   * @param distance metres to the nearest one that is alight (-1 = none near enough to hear)
   */
  fire(dt: number, distance: number) {
    if (!this.ready || distance < 0 || distance > 26) {
      this.fireT = 0.2;
      this.crackT = 0.3;
      return;
    }
    const ctx = this.ctx, t = ctx.currentTime;
    const near = 1 / (1 + (distance * distance) / 30);
    this.fireT -= dt;
    if (this.fireT <= 0) {
      // the hiss: one breath of it after another, each laid over the end of the last
      this.fireT = 0.9;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.start(t, Math.random());
      src.stop(t + 1.5);
      const f = this.filter('bandpass', 420 + Math.random() * 120, 0.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.034 * near, t + 0.45);
      g.gain.linearRampToValueAtTime(0.0001, t + 1.45);
      src.connect(f).connect(g).connect(this.bus.ambience);
    }
    this.crackT -= dt;
    if (this.crackT <= 0) {
      // a crack: sharp, dry, and never at an even pace
      this.crackT = 0.07 + Math.random() * Math.random() * 0.9;
      // (a recording of wood cracking, each a good deal higher or lower than the last: no two logs split alike.
      // Until they have come, the made-up tick. The hiss under them is made up still: there is no recording of a fire.)
      if (this.rec('fire_crack', this.bus.ambience, t, (EVERY.crack[0] + Math.random() * EVERY.crack[1]) * near, 0.7 + Math.random() * 0.7, false, true)) return;
      const src = this.noise(t, 0.03);
      const f = this.filter('highpass', 1700 + Math.random() * 2200, 0.9);
      const g = ctx.createGain();
      this.env(g, t, (0.05 + Math.random() * 0.13) * near, 0.002, 0.018 + Math.random() * 0.03);
      src.connect(f).connect(g).connect(this.bus.ambience);
    }
  }

  /** a cough: your own, the gas coming back up */
  cough(hard = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // two or three barks of breath, each a burst of air through a tight throat
    const n = 2 + (Math.random() < 0.45 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.16 + Math.random() * 0.06);
      const src = this.noise(at, 0.15);
      const lo = this.filter('bandpass', 480 + Math.random() * 140, 2.4), hi = this.filter('bandpass', 1450 + Math.random() * 350, 3);
      const g = ctx.createGain();
      this.env(g, at, (0.42 - i * 0.09) * hard, 0.012, 0.12);
      src.connect(lo).connect(g);
      src.connect(hi).connect(g);
      g.connect(this.sfx);
    }
  }

  /** breath through a gas mask, in the gas: drawn in through the filter, let out through the valve */
  mask(dt: number, on: boolean) {
    if (!this.ready || !on) {
      this.maskT = 0.4;
      return;
    }
    this.maskT -= dt;
    if (this.maskT > 0) return;
    const inhale = this.maskIn;
    this.maskIn = !inhale;
    this.maskT = inhale ? 1.5 : 1.9;
    const ctx = this.ctx, t = ctx.currentTime, dur = inhale ? 1.15 : 1.3;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    const f = this.filter('bandpass', inhale ? 1500 : 620, inhale ? 1.4 : 1.0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(inhale ? 0.05 : 0.07, t + dur * (inhale ? 0.6 : 0.18));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.bus.ambience);
  }

  hurt(pos?: V3, distance = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    if (pos) {
      const t = ctx.currentTime + distance / 343;
      const out = this.out(pos, 3, 1.3, distance);
      const pitch = 100 + Math.random() * 40;
      const v = ctx.createOscillator();
      v.type = 'sawtooth';
      v.frequency.setValueAtTime(pitch * 1.25, t);
      v.frequency.exponentialRampToValueAtTime(pitch * 0.8, t + 0.24);
      const f1 = this.filter('bandpass', 620, 5);
      const f2 = this.filter('bandpass', 1150, 6);
      const vg = ctx.createGain();
      this.env(vg, t, 1.0, 0.015, 0.22);
      v.connect(f1).connect(vg);
      v.connect(f2).connect(vg);
      vg.connect(out);
      v.start(t);
      v.stop(t + 0.32);
      return;
    }
    const t = ctx.currentTime;
    // the blow
    const th = ctx.createOscillator();
    th.frequency.setValueAtTime(120, t);
    th.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    const tg = ctx.createGain();
    this.env(tg, t, 0.5, 0.002, 0.1);
    th.connect(tg).connect(this.sfx);
    th.start(t);
    th.stop(t + 0.2);
    // the grunt: a voiced buzz shaped by two formants, falling in pitch, with breath on top
    const pitch = 105 + Math.random() * 30;
    const v = ctx.createOscillator();
    v.type = 'sawtooth';
    v.frequency.setValueAtTime(pitch * 1.25, t + 0.02);
    v.frequency.exponentialRampToValueAtTime(pitch * 0.8, t + 0.26);
    const f1 = this.filter('bandpass', 620, 5);
    const f2 = this.filter('bandpass', 1150, 6);
    const vg = ctx.createGain();
    this.env(vg, t + 0.02, 0.5, 0.015, 0.22);
    v.connect(f1).connect(vg);
    v.connect(f2).connect(vg);
    vg.connect(this.sfx);
    v.start(t + 0.02);
    v.stop(t + 0.32);
    const n = this.noise(t + 0.02, 0.24);
    const nf = this.filter('bandpass', 1500, 1);
    const ng = ctx.createGain();
    this.env(ng, t + 0.02, 0.09, 0.02, 0.2);
    n.connect(nf).connect(ng).connect(this.sfx);
  }

  // ------------------------------------------------------------ voices

  /**
   * The noises the infected make (src/game/infected.ts): recordings (scripts/sounds.mjs says which is which),
   * low and long when nothing is happening, a shriek when it has seen somebody, a snarl as the arms come down.
   * There is no made-up voice behind them: until the recordings have arrived, an infected is silent.
   * @param seed which of them: each a little higher or lower than the next
   */
  infected(kind: 'groan' | 'growl' | 'alert' | 'attack' | 'hurt' | 'die', pos: V3, distance = 0, seed = 0) {
    if (!this.ready || distance > 140) return;
    const t = this.ctx.currentTime + 0.01 + distance / 343;
    const out = this.out(pos, kind === 'alert' ? 9 : 4, 1.15, distance);
    this.rec(`z_${kind}`, out, t, { groan: 0.75, growl: 1.0, alert: 1.6, attack: 1.3, hurt: 1.1, die: 1.2 }[kind], 0.88 + ((seed * 37) % 24) / 100);
  }

  /**
   * A call said in words by the browser's own speaking voice (the same caller has the same voice and pitch every
   * time, by their name), quieter the further off and late by as long as sound takes to arrive.
   * @returns whether it will be said: not where there is no such voice, nor while one call is already waiting
   *   behind another (three people shouting at once are not said one after the other, long after)
   */
  /** where a player's voice goes (src/game/voice.ts): the Voice group (see GROUPS), and so with everything else that is heard, under the one volume */
  voiceBus(): AudioNode | null {
    return this.ready ? this.bus.voice : null;
  }

  private speak(words: string, distance: number, voice: number): boolean {
    const synth = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;
    // (not while a film's soundtrack is being made from the list of what was heard: that is not this machine's to say aloud)
    if (!words || !synth || typeof SpeechSynthesisUtterance === 'undefined' || !(this.ctx instanceof AudioContext) || this.volume <= 0 || this.mix.voice <= 0 || synth.pending) return false;
    const voices = synth.getVoices().filter((v) => /^en/i.test(v.lang));
    if (!voices.length) return false;
    const u = new SpeechSynthesisUtterance(words);
    u.voice = voices[Math.min(voices.length - 1, Math.floor(voice * voices.length))];
    u.lang = u.voice.lang;
    u.pitch = 0.7 + voice * 0.6;
    u.rate = 1.25;
    // (Somebody else's call is as loud as this voice goes until they are a good way off: at twelve metres it was
    // half, and nobody near heard it over anything. The browser's voice has no more to give than all of it.)
    // (It is not sound of this engine's and passes through no gain of it: the Voice group's share is taken off it here.)
    u.volume = Math.max(0.08, Math.min(1, this.volume * 1.8 * (distance > 0 ? 1 / (1 + distance / 45) : 0.6))) * this.mix.voice;
    setTimeout(() => synth.speak(u), Math.min(400, (distance / 343) * 1000));
    return true;
  }

  /**
   * Somebody calls out (src/sim/emotes.ts): the words, said by the browser's speaking voice. (There was a voice
   * made up out of a buzz and three resonances under them, and before them: it is gone.)
   * @param pos where they stand; none for the player's own voice
   * @param voice whose voice, 0..1: the same caller has the same one every time
   */
  shout(id: string, _pos?: V3, distance = 0, voice = 0.5) {
    if (!this.ready) return;
    this.speak(EMOTE[id]?.say ?? '', distance, voice);
  }

  // ------------------------------------------------------------ ambience

  private startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.filter('bandpass', 500, 0.5);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 260;
    lfo.connect(lg).connect(f.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.045;
    const glfo = ctx.createOscillator();
    glfo.frequency.value = 0.11;
    const glg = ctx.createGain();
    glg.gain.value = 0.025;
    glfo.connect(glg).connect(g.gain);
    src.connect(f).connect(g).connect(this.amb);
    src.start();
    lfo.start();
    glfo.start();
    this.ambience.wind = g;

    // leaves: a brighter hiss that comes and goes with the gusts, loud only among trees
    const lsrc = ctx.createBufferSource();
    lsrc.buffer = this.noiseBuf;
    lsrc.loop = true;
    lsrc.playbackRate.value = 0.7;
    const lf = this.filter('bandpass', 3400, 0.6);
    const gust = ctx.createGain();
    gust.gain.value = 0.55;
    const gl = ctx.createOscillator();
    gl.frequency.value = 0.083;
    const glg2 = ctx.createGain();
    glg2.gain.value = 0.45;
    gl.connect(glg2).connect(gust.gain);
    const leaves = ctx.createGain();
    leaves.gain.value = 0.006;
    lsrc.connect(lf).connect(gust).connect(leaves).connect(this.amb);
    lsrc.start();
    gl.start();
    this.ambience.leaves = leaves;

    // insects: a thin, pulsing trill that sits under everything out in the grass
    const ins = ctx.createOscillator();
    ins.type = 'sine';
    ins.frequency.value = 5400;
    const trem = ctx.createGain();
    trem.gain.value = 0.5;
    const tl = ctx.createOscillator();
    tl.type = 'square';
    tl.frequency.value = 31;
    const tlg = ctx.createGain();
    tlg.gain.value = 0.5;
    tl.connect(tlg).connect(trem.gain);
    const swell = ctx.createGain();
    swell.gain.value = 0.5;
    const sl = ctx.createOscillator();
    sl.frequency.value = 0.19;
    const slg = ctx.createGain();
    slg.gain.value = 0.5;
    sl.connect(slg).connect(swell.gain);
    const insects = ctx.createGain();
    insects.gain.value = 0.0045;
    ins.connect(trem).connect(swell).connect(insects).connect(this.amb);
    ins.start();
    tl.start();
    sl.start();
    this.ambience.insects = insects;
  }

  /** a crow somewhere off in the trees */
  private crow(listener: V3) {
    const a = Math.random() * Math.PI * 2;
    const r = 60 + Math.random() * 90;
    const pos = { x: listener.x + Math.cos(a) * r, y: listener.y + 14 + Math.random() * 12, z: listener.z + Math.sin(a) * r };
    const out = this.out(pos, 14, 1, r, this.bus.ambience);
    const tail = this.ctx.createGain();
    tail.gain.value = 0.5;
    out.connect(tail).connect(this.ambSend);
    const t0 = this.ctx.currentTime;
    const caws = 2 + Math.floor(Math.random() * 3);
    const pitch = 400 + Math.random() * 90;
    for (let i = 0; i < caws; i++) {
      const t = t0 + i * (0.33 + Math.random() * 0.08);
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(pitch * 1.12, t);
      o.frequency.linearRampToValueAtTime(pitch * 0.86, t + 0.2);
      const rasp = this.ctx.createOscillator();
      rasp.frequency.value = 58;
      const rg = this.ctx.createGain();
      rg.gain.value = pitch * 0.22;
      rasp.connect(rg).connect(o.frequency);
      const f = this.filter('bandpass', 1500, 2.2);
      const g = this.ctx.createGain();
      this.env(g, t, 0.34, 0.02, 0.2);
      o.connect(f).connect(g).connect(out);
      o.start(t);
      rasp.start(t);
      o.stop(t + 0.3);
      rasp.stop(t + 0.3);
    }
  }

  /**
   * Call each frame: occasional birdsong and crows from random directions.
   * @param forest among trees (leaves in the wind) rather than out in the open (insects in the grass)
   */
  /**
   * A car's horn, and a police car's siren (src/game/horns.ts): one voice to a car, told every frame where it is and
   * which of the two are going. The horn is two notes a third apart, square and driven hard through a narrow mouth, as
   * a car's is (the police car's higher); the siren a recording (`siren`, scripts/sounds.mjs), looped, and silent
   * until it has come. Both carry far.
   */
  horn(police: boolean): HornVoice | null {
    if (!this.ready) return null;
    const ctx = this.ctx;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = 10;
    pan.rolloffFactor = 0.9;
    pan.maxDistance = 2000;
    pan.connect(this.bus.vehicles);
    const hornG = ctx.createGain(), sirenG = ctx.createGain();
    hornG.gain.value = 0;
    sirenG.gain.value = 0;
    // the horn
    const shape = ctx.createWaveShaper();
    const curve = new Float32Array(257);
    for (let i = 0; i < 257; i++) curve[i] = Math.tanh(((i - 128) / 128) * 3);
    shape.curve = curve;
    const mouth = this.filter('bandpass', police ? 1100 : 900, 1.3);
    const oscs = (police ? [466, 587] : [392, 494]).map((f) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      o.connect(g).connect(shape);
      o.start();
      return o;
    });
    shape.connect(mouth).connect(hornG).connect(pan);
    sirenG.connect(pan);
    // the siren, begun once it is first wanted and its recording is here
    let wail: AudioBufferSourceNode | null = null;
    let live = true;
    const ease = (g: GainNode, to: number) => g.gain.setTargetAtTime(to, ctx.currentTime, 0.012);
    return {
      set: (pos, horn, siren) => {
        if (!live) return;
        pan.positionX.value = pos.x;
        pan.positionY.value = pos.y;
        pan.positionZ.value = pos.z;
        ease(hornG, horn ? 0.55 : 0);
        if (siren && !wail) {
          const buf = bank.get('siren')?.[0];
          if (!buf) void sirenRecording();
          else {
            wail = ctx.createBufferSource();
            wail.buffer = buf;
            wail.loop = true;
            wail.connect(sirenG);
            wail.start();
          }
        }
        ease(sirenG, siren && wail ? SIREN_GAIN : 0);
      },
      stop: () => {
        if (!live) return;
        live = false;
        ease(hornG, 0);
        ease(sirenG, 0);
        const end = ctx.currentTime + 0.15;
        for (const o of [...oscs, ...(wail ? [wail] : [])]) o.stop(end);
        setTimeout(() => pan.disconnect(), 300);
      },
    };
  }

  /**
   * A jeep's engine. Four cylinders: two bangs to every turn of the crank, which is the note;
   * a rougher one an octave under it, which is the body; and the tyres and the wind, which
   * are all that is left of it from far off downwind. One of these per running jeep.
   */
  engine(): EngineVoice | null {
    if (!this.ready) return null;
    const ctx = this.ctx;
    const pan = ctx.createPanner();
    pan.panningModel = 'equalpower';
    pan.distanceModel = 'inverse';
    pan.refDistance = 7;
    pan.rolloffFactor = 1.15;
    pan.maxDistance = 2000;
    const out = ctx.createGain();
    out.gain.value = 0;
    const lp = this.filter('lowpass', 700, 0.9);
    const shape = ctx.createWaveShaper();
    const curve = new Float32Array(257);
    for (let i = 0; i < 257; i++) curve[i] = Math.tanh(((i - 128) / 128) * 2.4);
    shape.curve = curve;
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    const voices: [OscillatorType, number, number][] = [['sawtooth', 1, 0.55], ['square', 0.5, 0.5], ['sawtooth', 2.01, 0.16], ['triangle', 1.5, 0.2]];
    const oscs = voices.map(([type, , gain]) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(mix);
      o.start();
      return o;
    });
    mix.connect(shape).connect(lp).connect(out);
    // the tyres on the ground
    const road = ctx.createBufferSource();
    road.buffer = this.noiseBuf;
    road.loop = true;
    const roadBP = this.filter('bandpass', 420, 0.6);
    const roadG = ctx.createGain();
    roadG.gain.value = 0;
    road.connect(roadBP).connect(roadG).connect(out);
    road.start();
    // and across it
    const skid = ctx.createBufferSource();
    skid.buffer = this.noiseBuf;
    skid.loop = true;
    skid.playbackRate.value = 1.3;
    const skidBP = this.filter('bandpass', 1500, 5);
    const skidG = ctx.createGain();
    skidG.gain.value = 0;
    skid.connect(skidBP).connect(skidG).connect(out);
    skid.start();
    out.connect(pan).connect(this.bus.vehicles);
    let live = true;
    let level = 0;
    return {
      set: (pos, rpm, load, speed, slide, onRoad, inside) => {
        if (!live) return;
        pan.positionX.value = pos.x;
        pan.positionY.value = pos.y;
        pan.positionZ.value = pos.z;
        const f = (rpm / 60) * 2;
        voices.forEach(([, mul], i) => (oscs[i].frequency.value = f * mul));
        // open the throttle and it brightens before it gets louder
        lp.frequency.value = 260 + rpm * 0.2 + load * 900;
        level += (1 - level) * 0.08;
        out.gain.value = level * (inside ? 0.5 : 0.85) * (0.34 + load * 0.3 + Math.min(0.2, rpm / 20000));
        roadG.gain.value = Math.min(0.5, speed / 30) * (onRoad ? 0.5 : 0.85);
        roadBP.frequency.value = onRoad ? 520 + speed * 18 : 260 + speed * 9;
        skidG.gain.value = slide * (onRoad ? 0.5 : 0.22);
        skidBP.frequency.value = onRoad ? 1450 + slide * 300 : 700;
        skidBP.Q.value = onRoad ? 5 : 0.8;
      },
      stop: () => {
        if (!live) return;
        live = false;
        const t = ctx.currentTime;
        out.gain.setTargetAtTime(0, t, 0.12);
        for (const o of oscs) o.stop(t + 0.6);
        road.stop(t + 0.6);
        skid.stop(t + 0.6);
        setTimeout(() => out.disconnect(), 800);
      },
    };
  }

  /**
   * A helicopter's rotor: the recording of one, played round and round (it is made to join its own beginning), from a
   * place in the world. The panner says only which side it is on: how loud it is from how far is said every frame by
   * whoever holds the voice. It hangs on `sfx`, where every sound of the world goes (a gun, a jeep, a step): so it is
   * under the same volume as they are, and goes out through the same squeeze and the same ceiling, which is what
   * keeps as loud a thing as this from breaking the sound up.
   * @returns nothing until the sound is started and the recording has come (it is sent for when first asked): ask again
   */
  rotor(): RotorVoice | null {
    const buf = bank.get('rotor')?.[0];
    if (this.ready && !buf) void rotorRecording();
    if (!this.ready || !buf) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = this.filter('lowpass', 12000, 0.5);
    const out = ctx.createGain();
    out.gain.value = 0;
    const pan = ctx.createPanner();
    pan.panningModel = 'equalpower';
    // (as loud at any distance, as far as the panner goes)
    pan.distanceModel = 'inverse';
    pan.rolloffFactor = 0;
    // (it comes up from nothing over a third of a second, however near it is when it is first heard: one ramp, set once)
    const come = ctx.createGain();
    come.gain.setValueAtTime(0, ctx.currentTime);
    come.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.35);
    src.connect(lp).connect(out).connect(come).connect(pan).connect(this.bus.vehicles);
    // (anywhere in its round: two of them in the air at once are not one sound twice as loud)
    src.start(0, Math.random() * buf.duration);
    this.heard?.('rotor', 0, 1, 1);
    let live = true;
    // (Eased here, by the clock, and written plainly: a level set afresh every frame is a staircase and is heard as
    // one, and an automation event on three params every frame piles up in the audio engine, as the listener's did.)
    let level = 0, rate = 1, top = 12000, was = ctx.currentTime, first = true;
    return {
      set: (pos, gain, speed, cutoff) => {
        if (!live) return;
        const k = first ? 1 : 1 - Math.exp(-Math.max(0, ctx.currentTime - was) / 0.09);
        was = ctx.currentTime;
        pan.positionX.value = pos.x;
        pan.positionY.value = pos.y;
        pan.positionZ.value = pos.z;
        level += (gain - level) * k;
        rate += (speed - rate) * k;
        top += (cutoff - top) * k;
        first = false;
        // (half as loud as it was, every helicopter, flown or flying by: the owner, 2026-10-17, "the helicopter sound is
        // too loud when people are driving it can we reduce by 50% across the board")
        out.gain.value = level * 0.5;
        src.playbackRate.value = rate;
        lp.frequency.value = top;
      },
      stop: () => {
        if (!live) return;
        live = false;
        const t = ctx.currentTime;
        come.gain.cancelScheduledValues(t);
        come.gain.setTargetAtTime(0, t, 0.25);
        src.stop(t + 1.5);
        setTimeout(() => pan.disconnect(), 1800);
      },
    };
  }

  /** A jeep running into something: tin, and the weight behind it. @param k how hard, 0..1 */
  crash(pos: V3, k: number) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this.out(pos, 8, 1.1, 0, this.bus.vehicles);
    // Recorded: sheet steel giving, the weight behind it, and the steel struck that a round on a car's door has
    // already, an octave down for a thing that size. (Until they have come, the made-up thud and rattle.)
    const C = EVERY.crash;
    if (this.rec('crash_tin', out, t, C.tin[0] + k * C.tin[1], 1.05 - k * 0.3, false, true)) {
      this.rec('thud', out, t, C.thud[0] + k * C.thud[1], 0.85, false, true);
      this.rec('hit_metal', out, t + 0.012, C.steel[0] + k * C.steel[1], 0.55);
      return;
    }
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(95, t);
    thud.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const tg = ctx.createGain();
    this.env(tg, t, 0.5 + k * 0.5, 0.004, 0.22);
    thud.connect(tg).connect(out);
    thud.start(t);
    thud.stop(t + 0.3);
    const n = this.noise(t, 0.35);
    const bp = this.filter('bandpass', 1100 + k * 900, 1.2);
    const ng = ctx.createGain();
    this.env(ng, t, 0.25 + k * 0.55, 0.002, 0.12 + k * 0.2);
    n.connect(bp).connect(ng).connect(out);
    // something loose in it rattles on after
    for (let i = 0; i < 3; i++) this.click(600 + Math.random() * 900, 0.12 + k * 0.2, 0.03, 0.05 + i * 0.07 + Math.random() * 0.04, pos, this.bus.vehicles);
  }

  /**
   * Somebody going through what holds things, heard by whoever is near (the owner, 2026-10-17: "opening an inventory
   * to loot it should make noise to nearby players"): a lid or a door let go, then hands among what is in it.
   * @param hard a crate, a locker, a piece of furniture; else cloth and straps: a body, a pack, a case
   */
  rummage(pos: V3, hard: boolean) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, out = this.out(pos, 2.5, 1.5), [gain] = EVERY.hand.pickup, near = EVERY.hand.other;
    // (until the recordings have come, the rustle the game's own pockets make)
    if (!this.has('take_any')) return this.hands('open', pos);
    if (hard) this.rec('latch', out, t, 0.6, 1.1, false, true);
    else this.rec('step_soft', out, t, gain * near, 0.85, false, true);
    for (let i = 0; i < 3; i++) this.rec(i === 1 ? (hard ? 'take_metal' : 'step_soft') : 'take_any', out, t + 0.3 + i * 0.34 + Math.random() * 0.12, gain * near, 0.95 + Math.random() * 0.1, false, true);
  }

  /**
   * A car's door, as somebody gets in or out: the catch let go, and the door pulled to behind them. Heard from
   * where the car is, by whoever is within a yard's length of it. Recordings and nothing else: a car's door had
   * no sound before there were any, and has none until they have come.
   */
  carDoor(pos: V3) {
    if (!this.has('latch')) return;
    const t = this.ctx.currentTime, out = this.out(pos, 2.5, 1.6, 0, this.bus.vehicles);
    this.rec('latch', out, t, 0.8, 0.9, false, true);
    // (the steel door the bunker and the lockers have, quicker: a door a twentieth of that one's weight)
    this.rec('gate_slam', out, t + 0.42, 0.6, 1.3);
  }

  /**
   * A spade at work: driven into the ground, and lifted out with what it has loosened, which is the crunch of a
   * foot in snow played low (earth sliding off a blade: the nearest thing there is a recording of). Until they
   * have come, what it was: a made-up landing, and a made-up step on gravel.
   * @param part 0 as it goes in, 1 as it comes out
   */
  dig(part: 0 | 1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (part === 0) {
      if (!this.rec('dig', this.sfx, t, EVERY.dig.in, 1, false, true)) this.land('dirt', 3.2);
    } else if (!this.rec('step_snow', this.sfx, t, EVERY.dig.out[0], EVERY.dig.out[1], false, true)) this.footstep('gravel', 1.4);
  }

  /** the hum of the bunker (made when somebody first goes down), whether it is sounding, and how long until the place next makes a noise of its own */
  private bunkerAir: { bed: GainNode; on: boolean; nextT: number; wind: number } | null = null;

  /**
   * Down the bunker there are no birds: a low hum under everything, and now and then the place
   * itself, off in the dark: steel taking the strain, something knocked over far away, the
   * weight of the hill, water. @param under how far underground the ear is, 0..1
   */
  private bunkerAmbience(dt: number, listener: V3, under: number) {
    const ctx = this.ctx, t = ctx.currentTime, on = under > 0.5;
    if (!this.bunkerAir) {
      if (!on) return;
      const bed = ctx.createGain();
      bed.gain.value = 0;
      // two low notes a little apart, which beat against each other slowly, one an octave over them, and the air in the ducts
      for (const [f, g] of [[46, 0.5], [49.4, 0.45], [92.7, 0.1]]) {
        const o = ctx.createOscillator();
        o.frequency.value = f;
        const lvl = ctx.createGain();
        lvl.gain.value = g;
        o.connect(lvl).connect(bed);
        o.start();
      }
      const air = ctx.createBufferSource();
      air.buffer = this.noiseBuf;
      air.loop = true;
      const lvl = ctx.createGain();
      lvl.gain.value = 0.5;
      air.connect(this.filter('lowpass', 150, 0.6)).connect(lvl).connect(bed);
      air.start();
      bed.connect(this.bus.ambience);
      this.bunkerAir ={ bed, on: false, nextT: 5, wind: this.ambience.wind?.gain.value ?? 0 };
    }
    const B = this.bunkerAir;
    if (on !== B.on) {
      B.on = on;
      B.bed.gain.setTargetAtTime(on ? 0.1 : 0, t, 1.4);
      // (the wind, the leaves and whatever sings in the grass are left at the top of the stair)
      if (on) B.wind = this.ambience.wind?.gain.value ?? B.wind;
      this.ambience.wind?.gain.setTargetAtTime(on ? 0 : B.wind, t, 1.2);
      if (on) {
        this.ambience.leaves?.gain.setTargetAtTime(0, t, 1.2);
        this.ambience.insects?.gain.setTargetAtTime(0, t, 1.2);
      } else this.ambience.forest = undefined;
    }
    if (!on || (B.nextT -= dt) > 0) return;
    B.nextT = 6 + Math.random() * 13;
    const a = Math.random() * Math.PI * 2, r = 7 + Math.random() * 16;
    const pos = { x: listener.x + Math.cos(a) * r, y: listener.y + Math.random() * 1.5, z: listener.z + Math.sin(a) * r };
    const bus = ctx.createGain();
    bus.connect(this.out(pos, 6, 0.9, r, this.bus.ambience));
    const tail = ctx.createGain();
    tail.gain.value = 0.7;
    bus.connect(tail).connect(this.ambSend);
    const t0 = t + 0.05, k = Math.random();
    if (k < 0.42) {
      // steel taking the strain: a low rasp that climbs and falls back, rung through what it is fixed to
      const dur = 1.3 + Math.random() * 1.6, f0 = 48 + Math.random() * 30;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, t0);
      for (let s = 1; s <= 6; s++) o.frequency.linearRampToValueAtTime(f0 * (1 + 0.5 * Math.sin((s / 6) * Math.PI) + (Math.random() - 0.5) * 0.25), t0 + (dur * s) / 6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + dur * 0.25);
      g.gain.setValueAtTime(0.5, t0 + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      for (const [f, q, lv] of [[380 + Math.random() * 120, 22, 1], [1050 + Math.random() * 300, 28, 0.55], [2300 + Math.random() * 500, 30, 0.25]]) {
        const lvl = ctx.createGain();
        lvl.gain.value = lv;
        o.connect(this.filter('bandpass', f, q)).connect(lvl).connect(g);
      }
      g.connect(bus);
      o.start(t0);
      o.stop(t0 + dur + 0.1);
    } else if (k < 0.7) {
      // something knocked or dropped, a long way off: a blow, and the note of whatever was struck (once, or twice)
      const n = Math.random() < 0.4 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const at = t0 + i * (0.22 + Math.random() * 0.2), ring = 0.5 + Math.random() * 0.9;
        const hit = ctx.createGain();
        this.env(hit, at, 0.5, 0.004, 0.09);
        this.noise(at, 0.1).connect(this.filter('bandpass', 600 + Math.random() * 900, 3)).connect(hit).connect(bus);
        for (const f of [310 + Math.random() * 260, 870 + Math.random() * 700]) {
          const o = ctx.createOscillator();
          o.frequency.value = f;
          const g = ctx.createGain();
          this.env(g, at, 0.22, 0.004, ring);
          o.connect(g).connect(bus);
          o.start(at);
          o.stop(at + ring + 0.1);
        }
      }
    } else if (k < 0.88) {
      // the weight of the hill on the roof: a note at the bottom of hearing that sinks
      const dur = 2.6 + Math.random() * 2, f0 = 58 + Math.random() * 14;
      for (const [m, lv] of [[1, 0.9], [2.02, 0.25]]) {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(f0 * m, t0);
        o.frequency.exponentialRampToValueAtTime(f0 * m * 0.72, t0 + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(lv, t0 + dur * 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(bus);
        o.start(t0);
        o.stop(t0 + dur + 0.1);
      }
    } else {
      // water, somewhere: a few drops
      const n = 2 + Math.floor(Math.random() * 4);
      let at = t0;
      for (let i = 0; i < n; i++) {
        const o = ctx.createOscillator();
        const f = 900 + Math.random() * 900;
        o.frequency.setValueAtTime(f * 1.6, at);
        o.frequency.exponentialRampToValueAtTime(f, at + 0.04);
        const g = ctx.createGain();
        this.env(g, at, 0.12, 0.003, 0.09);
        o.connect(g).connect(bus);
        o.start(at);
        o.stop(at + 0.2);
        at += 0.35 + Math.random() * 0.8;
      }
    }
  }

  updateAmbience(dt: number, listener: V3, indoors: boolean, forest = false, under = 0) {
    if (!this.ready) return;
    this.setEnvironment(indoors);
    this.bunkerAmbience(dt, listener, under);
    if (under > 0.5) return;
    // only schedule a fade when the surroundings change, not every frame
    if (forest !== this.ambience.forest) {
      this.ambience.forest = forest;
      const t = this.ctx.currentTime;
      this.ambience.leaves?.gain.setTargetAtTime(forest ? 0.03 : 0.006, t, 2.5);
      this.ambience.insects?.gain.setTargetAtTime(forest ? 0.0015 : 0.0045, t, 2.5);
    }
    this.ambience.crowT -= dt;
    if (this.ambience.crowT <= 0) {
      this.ambience.crowT = 28 + Math.random() * 55;
      if (!indoors) this.crow(listener);
    }
    this.ambience.birdsT -= dt;
    if (this.ambience.birdsT > 0) return;
    this.ambience.birdsT = 2 + Math.random() * 6;
    const a = Math.random() * Math.PI * 2;
    const r = 20 + Math.random() * 50;
    const pos = { x: listener.x + Math.cos(a) * r, y: listener.y + 8 + Math.random() * 10, z: listener.z + Math.sin(a) * r };
    const out = this.out(pos, 6, 1, r, this.bus.ambience);
    const t0 = this.ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 5);
    const base = 2400 + Math.random() * 2400;
    for (let i = 0; i < notes; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.08);
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      const f0 = base * (0.85 + Math.random() * 0.3);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 1.35 : 0.72), t + 0.07);
      const g = this.ctx.createGain();
      this.env(g, t, indoors ? 0.02 : 0.06, 0.008, 0.07);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.12);
    }
  }
}

export const audio = new AudioEngine();
