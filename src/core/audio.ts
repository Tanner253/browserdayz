// Procedural audio. Every sound is synthesised from noise + oscillators at runtime:
// no licensed sample packs, tiny download, and endless variation per shot/step.
// Positional sounds use HRTF panners; gunshots get an outdoor slap-back echo.

import type { Surface } from './physics';

type V3 = { x: number; y: number; z: number };

/**
 * How much of a loud sound comes back from round about: [in the open, under a roof]. Open
 * country answers once, quietly, and rumbles for a second; it is not a cave. With these a
 * rifle's echo is some 14 dB under the shot itself (it was 5), and a room has none.
 */
const WET = { tail: [0.15, 0.04], slap: [0.075, 0.01], room: [0, 0.4] } as const;

// What is called out from the wheel (src/sim/emotes.ts). There are no recordings in this
// game, and a voice is made the way everything else in it is: a buzz at the pitch of the
// throat, three resonances that move as the mouth does, breath for an H and hiss for an S.

/** where the mouth is for each sound: its three resonances, Hz */
const MOUTH: Record<string, [number, number, number]> = {
  i: [300, 2250, 2950], // bEAt
  I: [410, 1950, 2550], // bIt
  e: [490, 2050, 2650], // the start of hEY
  E: [600, 1800, 2500], // bEt
  a: [720, 1700, 2450], // bAt
  A: [760, 1180, 2550], // fAther, and the start of mY
  o: [540, 920, 2450], // the start of Over
  U: [410, 950, 2350], // and the end of it
  R: [480, 1320, 1650], // hER
  l: [360, 1050, 2750],
  r: [340, 1100, 1500],
  w: [300, 650, 2300],
  m: [270, 1050, 2300],
  n: [270, 1550, 2550],
  N: [270, 2050, 2650], // thaNks
};

/**
 * One sound of a word. m: the mouth; d: seconds; v: how much voice (1 unless said); h: breath
 * through the mouth; s: [pitch, level] of a hiss made at the teeth, which the mouth does not
 * shape; p: the mouth is shut for this long and opens with a puff at [pitch, level]; g:
 * seconds the mouth takes to get here from the sound before.
 */
interface Phone {
  m: string;
  d: number;
  v?: number;
  h?: number;
  s?: [number, number];
  p?: [number, number];
  g?: number;
}

/** each call: its sounds, and its tune as [how far through, pitch as a multiple of the speaker's own] */
const CALLS: Record<string, { say: Phone[]; tune: [number, number][] }> = {
  hey: {
    say: [{ m: 'e', d: 0.08, v: 0, h: 1 }, { m: 'e', d: 0.15 }, { m: 'i', d: 0.26, g: 0.2 }],
    tune: [[0, 1.2], [0.3, 1.5], [1, 0.82]],
  },
  here: {
    say: [{ m: 'o', d: 0.11 }, { m: 'U', d: 0.07, g: 0.07 }, { m: 'U', d: 0.055, v: 0.45, s: [3200, 0.1] }, { m: 'R', d: 0.13, g: 0.06 }, { m: 'I', d: 0.07, v: 0, h: 1 }, { m: 'I', d: 0.13 }, { m: 'R', d: 0.24, g: 0.16 }],
    tune: [[0, 1.35], [0.2, 1.2], [0.5, 1.1], [0.62, 1.55], [1, 0.85]],
  },
  help: {
    say: [{ m: 'E', d: 0.07, v: 0, h: 1 }, { m: 'E', d: 0.17 }, { m: 'l', d: 0.12, v: 0.8, g: 0.08 }, { m: 'l', d: 0.075, v: 0, p: [900, 0.5] }, { m: 'E', d: 0.06, v: 0, h: 0.5 }],
    tune: [[0, 1.3], [0.35, 1.6], [1, 1.05]],
  },
  friendly: {
    say: [{ m: 'r', d: 0.09, v: 0, s: [5200, 0.3] }, { m: 'r', d: 0.07, v: 0.8 }, { m: 'E', d: 0.14, g: 0.07 }, { m: 'n', d: 0.07, v: 0.5 }, { m: 'n', d: 0.035, v: 0.2, p: [3600, 0.22] }, { m: 'l', d: 0.07, v: 0.8 }, { m: 'i', d: 0.22, g: 0.08 }],
    tune: [[0, 1.2], [0.3, 1.5], [0.6, 1.15], [1, 0.95]],
  },
  omw: {
    say: [{ m: 'A', d: 0.13 }, { m: 'n', d: 0.07, v: 0.5 }, { m: 'm', d: 0.07, v: 0.5 }, { m: 'A', d: 0.1 }, { m: 'I', d: 0.1, g: 0.1 }, { m: 'w', d: 0.08, v: 0.7, g: 0.06 }, { m: 'e', d: 0.14, g: 0.07 }, { m: 'i', d: 0.2, g: 0.15 }],
    tune: [[0, 1.15], [0.15, 1.3], [0.45, 1.2], [0.7, 1.5], [1, 0.85]],
  },
  thanks: {
    say: [{ m: 'a', d: 0.085, v: 0, s: [6200, 0.13] }, { m: 'a', d: 0.2 }, { m: 'N', d: 0.09, v: 0.5 }, { m: 'N', d: 0.05, v: 0, p: [1900, 0.4] }, { m: 'N', d: 0.17, v: 0, s: [6500, 0.26] }],
    tune: [[0, 1.45], [0.35, 1.3], [1, 0.9]],
  },
};

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

/**
 * Recordings, played in place of sounds this file would otherwise make up (scripts/sounds.mjs
 * cuts them out of two free libraries of real guns): [name]: how many takes of it there are.
 * One take is played, any of them. Until they have arrived, and wherever one is missing, the
 * made-up sound is what is heard.
 */
const RECORDED: Record<string, number> = { punch: 5, blow: 5, hit_metal: 6, shot_rifle: 1, shot_pistol: 3, shot_quiet: 1, bolt: 1, rifle_mag_out: 1, rifle_mag_in: 1, pistol_mag_out: 1, pistol_mag_in: 1, rack: 1, shot_shotgun: 2, shot_magnum: 2, shell_in: 1, z_groan: 4, z_growl: 4, z_alert: 4, z_attack: 4, z_hurt: 4, z_die: 4 };
const bank = new Map<string, AudioBuffer[]>();
let fetched: Promise<void> | null = null;
/** Fetches the recordings, once. (They are kept apart from any one engine: the trailer renders its soundtrack on an engine of its own.) */
export function recordings(): Promise<void> {
  return (fetched ??= (async () => {
    // (decoding needs a context, and any will do: this one makes no sound)
    const dec = new OfflineAudioContext(1, 1, 44100);
    await Promise.all(
      Object.entries(RECORDED).flatMap(([name, takes]) =>
        Array.from({ length: takes }, async (_, k) => {
          try {
            const res = await fetch(`assets/sounds/${name}${k ? `_${k + 1}` : ''}.wav`);
            if (!res.ok) return;
            const buf = await dec.decodeAudioData(await res.arrayBuffer());
            bank.set(name, [...(bank.get(name) ?? []), buf]);
          } catch {
            // not there, or not sound: the made-up one stands in
          }
        }),
      ),
    );
  })());
}

export class AudioEngine {
  ctx!: AudioContext;
  private master!: GainNode;
  private sfx!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private echo!: DelayNode;
  private echoGain!: GainNode;
  /** small-room reverb: what a shot sounds like under a roof */
  private roomSend!: GainNode;
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
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8 * this.volume;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);

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
    this.reverbSend.gain.value = WET.tail[0];
    const revLP = ctx.createBiquadFilter();
    revLP.type = 'lowpass';
    revLP.frequency.value = 2400;
    this.reverbSend.connect(this.reverb).connect(revLP).connect(this.master);

    // valley slap-back echo for gunshots
    this.echo = ctx.createDelay(2);
    this.echo.delayTime.value = 0.62;
    const echoGain = (this.echoGain = ctx.createGain());
    echoGain.gain.value = WET.slap[0];
    const echoLP = ctx.createBiquadFilter();
    echoLP.type = 'lowpass';
    echoLP.frequency.value = 900;
    this.echo.connect(echoLP).connect(echoGain).connect(this.reverbSend);
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
    this.roomSend.gain.value = WET.room[0];
    this.roomSend.connect(room).connect(this.master);

    this.amb = ctx.createGain();
    this.ambLP = this.filter('lowpass', 18000, 0.5);
    this.amb.connect(this.ambLP).connect(this.master);

    this.startAmbience();
    this.ready = true;
  }

  /** player setting, 0..1 */
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ready) this.master.gain.setTargetAtTime(0.8 * this.volume, this.ctx.currentTime, 0.05);
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
    this.roomSend.gain.setTargetAtTime(WET.room[i], t, 0.25);
    this.reverbSend.gain.setTargetAtTime(WET.tail[i], t, 0.25);
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

  /** Output node: positional (HRTF) or direct. Distance also dulls the high end. */
  private out(pos?: V3, refDist = 4, rolloff = 1.2, distance = 0) {
    if (!pos) return this.sfx as AudioNode;
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
    lp.connect(p).connect(this.sfx);
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

  /** @param later it belongs to a reload and can be taken back before it is heard */
  private rec(name: string, to: AudioNode, at: number, gain = 1, rate = 1, later = false): boolean {
    const takes = bank.get(name);
    if (!this.ready || !takes?.length) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = takes[Math.floor(Math.random() * takes.length)];
    // (no two shots from one gun are the same pitch to a hair, and one take played over and over is heard as one take)
    src.playbackRate.value = (0.97 + Math.random() * 0.06) * rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(to);
    src.start(Math.max(at, this.ctx.currentTime));
    if (later) {
      const now = this.ctx.currentTime;
      this.ahead = this.ahead.filter((a) => a.at > now);
      this.ahead.push({ src, at });
    }
    return true;
  }

  // ------------------------------------------------------------ weapons

  /** @param voice a gun that is deeper and louder than its kind: its recording played that much slower and that much louder */
  gunshot(kind: 'rifle' | 'pistol', pos?: V3, distance = 0, intermediate = false, suppressed = false, voice?: { rate: number; gain: number; rec?: string }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + (distance > 0 ? distance / 343 : 0);
    if (suppressed) {
      // suppressed: a flat, dull snap and the action cycling; carries a fraction of the distance
      const o2 = this.out(pos, 5, 1.6, distance * 3);
      if (this.rec('shot_quiet', o2, t, pos ? 1.6 : 1.1)) return;
      const n = this.noise(t, 0.12);
      const f = this.filter('bandpass', 1300, 0.8);
      const g = ctx.createGain();
      this.env(g, t, 0.55, 0.002, 0.07);
      n.connect(f).connect(g).connect(o2);
      const th = ctx.createOscillator();
      th.frequency.setValueAtTime(180, t);
      th.frequency.exponentialRampToValueAtTime(70, t + 0.08);
      const tg = ctx.createGain();
      this.env(tg, t, 0.35, 0.002, 0.08);
      th.connect(tg).connect(o2);
      th.start(t);
      th.stop(t + 0.2);
      return;
    }
    const big = kind === 'rifle';
    // 7.62x39: sharper and shorter than the full-power Mosin round
    const mid = intermediate ? 0.72 : 1;
    let out = this.out(pos, big ? 12 : 8, 1, distance);
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
    const ref = big ? 12 : 8;
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
    // the klaxon: two notes, turn about, for as long as it moves
    for (let k = 0; k < 6; k++) {
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
    for (const [at, vol] of [[0.05, 1.6], [0.32, 1.2], [3.05, 2.2]]) {
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
    rg.gain.linearRampToValueAtTime(1.9, t + 0.6);
    rg.gain.setValueAtTime(1.9, t + 2.8);
    rg.gain.linearRampToValueAtTime(0.0001, t + 3.2);
    const shake = ctx.createOscillator();
    shake.frequency.value = 17;
    const sg = ctx.createGain();
    sg.gain.value = 0.7;
    shake.connect(sg).connect(rg.gain);
    run.connect(lp).connect(rg).connect(out);
    shake.start(t + 0.3);
    shake.stop(t + 3.3);
  }

  /** the hammer falling on nothing: it has to be heard over a fight */
  dryFire() {
    this.click(3800, 1.3, 0.022);
    this.click(1900, 0.7, 0.03, 0.012);
  }

  /** short metallic click (bolt, mag, hammer) */
  click(freq = 3000, vol = 0.4, dur = 0.02, delay = 0, pos?: V3) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    // somebody else's weapon: the same sound, from where they are
    const to = pos ? this.out(pos, 3, 1.2) : this.sfx;
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
  boltCycle(start = 0, pos?: V3) {
    if (this.ready) this.rec('bolt', pos ? this.out(pos, 2, 1.6) : this.sfx, this.ctx.currentTime + start, pos ? 1.1 : 0.95);
  }

  /** another player close by reloading: a magazine out and one in, from where they stand (it is not heard across a field) */
  reloadNear(pos: V3, dur: number, pistol: boolean) {
    if (!this.ready) return;
    const now = this.ctx.currentTime, kind = pistol ? 'pistol' : 'rifle';
    this.rec(`${kind}_mag_out`, this.out(pos, 2, 1.7), now + dur * (pistol ? 0.12 : 0.28), 1.1);
    this.rec(`${kind}_mag_in`, this.out(pos, 2, 1.7), now + dur * (pistol ? 0.48 : 0.62), 1.1);
  }

  /** @param long a rifle's magazine (a pistol's, if not) */
  magOut(delay = 0, long = false) {
    if (this.ready) this.rec(long ? 'rifle_mag_out' : 'pistol_mag_out', this.sfx, this.ctx.currentTime + delay, 0.95, 1, true);
  }

  magIn(delay = 0, long = false) {
    if (this.ready) this.rec(long ? 'rifle_mag_in' : 'pistol_mag_in', this.sfx, this.ctx.currentTime + delay, 0.95, 1, true);
  }

  /** a shell pushed into a shotgun's tube */
  shellIn(delay = 0) {
    if (this.ready && !this.rec('shell_in', this.sfx, this.ctx.currentTime + delay, 0.95, 1, true)) this.magIn(delay, false);
  }

  slideRack(delay = 0) {
    if (this.ready) this.rec('rack', this.sfx, this.ctx.currentTime + delay, 0.95, 1, true);
  }

  shellDrop(delay = 0.35) {
    if (!this.ready) return;
    for (let i = 0; i < 3; i++) this.click(5200 + Math.random() * 1500, 0.08 / (i + 1), 0.04, delay + i * 0.09 + Math.random() * 0.03);
  }

  /**
   * A bullet going past your head: the crack of a supersonic round and the zip of air
   * behind it. `pos` is the nearest point of its path, `miss` how close it came (metres).
   */
  whiz(pos: V3, miss: number, delay = 0, supersonic = true) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const near = Math.max(0, 1 - miss / 5);
    const out = this.out(pos, 2, 1);
    if (supersonic) {
      const c = this.noise(t, 0.03);
      const hp = this.filter('highpass', 3200);
      const cg = this.ctx.createGain();
      this.env(cg, t, 0.5 + near * 0.9, 0.0006, 0.02);
      c.connect(hp).connect(cg).connect(out);
    }
    const n = this.noise(t, 0.2);
    const f = this.filter('bandpass', 4200, 5);
    f.frequency.setValueAtTime(4600, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.16);
    const g = this.ctx.createGain();
    this.env(g, t, 0.18 + near * 0.35, 0.004, 0.15);
    n.connect(f).connect(g).connect(out);
  }

  /** your shot landed on somebody (a dry tick), or killed them (a heavier double) */
  hitTick(kill: boolean, head = false) {
    if (!this.ready) return;
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
      tick.connect(tg).connect(this.sfx);
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
        o.connect(g).connect(this.sfx);
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
    o.connect(g).connect(this.sfx);
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

  /** pushing off the ground */
  jump() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.gear(t, 0.09);
    const n = this.noise(t, 0.16);
    const f = this.filter('bandpass', 1100, 1.5);
    const g = this.ctx.createGain();
    this.env(g, t, 0.07, 0.03, 0.1);
    n.connect(f).connect(g).connect(this.sfx);
  }

  /** coming down: the feet, the weight behind them, and the kit catching up */
  land(surface: Surface | 'grass' | 'dirt' | 'gravel', speed: number) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, speed / 11);
    this.footstep(surface, 3 + k * 5);
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

  /** the last breath going out, and the body hitting the ground */
  death() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
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
  door(opening: boolean, pos: V3) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const out = this.out(pos, 3, 1.2);
    // (from where the door is, like the rest of it: with no place given, the click of every
    // door on the map was heard by everybody, at full strength, wherever they stood)
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
  footstep(surface: Surface | 'grass' | 'dirt' | 'gravel', speed: number, pos?: V3, carried = 0) {
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
      default: // grass: soft swish + muffled thud
        layer('highpass', 2500, 0.6, 0.16, 0.02, 0.12);
        layer('lowpass', 380, 1, 0.3, 0.006, 0.07);
    }
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

  ui(kind: 'pickup' | 'drop' | 'open' | 'close' | 'eat' | 'drink' | 'bandage' | 'inject' | 'move' | 'smoke') {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const rustle = (dur: number, freq: number, vol: number, at = 0) => {
      const n = this.noise(t + at, dur);
      const f = this.filter('bandpass', freq, 0.8);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.linearRampToValueAtTime(vol, t + at + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      n.connect(f).connect(g).connect(this.sfx);
    };
    switch (kind) {
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
          o.connect(g).connect(this.sfx);
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
      src.connect(f).connect(g).connect(this.sfx);
    }
    this.crackT -= dt;
    if (this.crackT <= 0) {
      // a crack: sharp, dry, and never at an even pace
      this.crackT = 0.07 + Math.random() * Math.random() * 0.9;
      const src = this.noise(t, 0.03);
      const f = this.filter('highpass', 1700 + Math.random() * 2200, 0.9);
      const g = ctx.createGain();
      this.env(g, t, (0.05 + Math.random() * 0.13) * near, 0.002, 0.018 + Math.random() * 0.03);
      src.connect(f).connect(g).connect(this.sfx);
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
    src.connect(f).connect(g).connect(this.sfx);
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

  zombie(pos: V3, distance: number, aggressive: boolean) {
    if (!this.ready || distance > 60) return;
    const t = this.ctx.currentTime;
    const out = this.out(pos, 3, 1.2, distance);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    const base = aggressive ? 140 : 95;
    o.frequency.setValueAtTime(base * (0.8 + Math.random() * 0.4), t);
    o.frequency.linearRampToValueAtTime(base * 0.6, t + 0.7);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 18 + Math.random() * 10;
    const lg = this.ctx.createGain();
    lg.gain.value = 25;
    lfo.connect(lg).connect(o.frequency);
    const f = this.filter('bandpass', aggressive ? 900 : 600, 2.5);
    const n = this.noise(t, 0.9);
    const nf = this.filter('bandpass', 1300, 1);
    const g = this.ctx.createGain();
    this.env(g, t, aggressive ? 0.5 : 0.25, 0.05, 0.8);
    o.connect(f).connect(g);
    n.connect(nf).connect(g);
    g.connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + 1);
    lfo.stop(t + 1);
  }

  // ------------------------------------------------------------ voices

  /**
   * The noises the infected make (src/game/infected.ts): a throat with nothing left behind
   * it. Each is one rough note bent through its length, with breath over it: low and long
   * when nothing is happening, a shriek when it has seen somebody, a snarl as the arms come
   * down.
   * @param seed which of them: each has its own pitch
   */
  infected(kind: 'groan' | 'growl' | 'alert' | 'attack' | 'hurt' | 'die', pos: V3, distance = 0, seed = 0) {
    if (!this.ready || distance > 140) return;
    const ctx = this.ctx;
    // [how long, how loud, the note at the start, in the middle and at the end (times its own pitch), how rough, how much breath, the mouth's two resonances]
    const V = {
      groan: [1.5, 0.3, 0.85, 0.95, 0.7, 14, 0.25, 480, 900],
      growl: [0.95, 0.5, 1.1, 1.3, 0.95, 31, 0.35, 560, 1100],
      alert: [0.9, 0.95, 1.7, 3.6, 2.4, 38, 0.6, 900, 2300],
      attack: [0.42, 0.8, 1.5, 2.3, 1.3, 44, 0.7, 760, 1800],
      hurt: [0.28, 0.6, 2.0, 1.5, 1.1, 30, 0.4, 700, 1500],
      die: [1.3, 0.6, 1.6, 1.0, 0.5, 18, 0.5, 520, 1000],
    }[kind];
    const [dur, loud, n0, n1, n2, rough, breath, f1, f2] = V;
    const pitch = 82 + ((seed * 37) % 34);
    const t = ctx.currentTime + 0.01 + distance / 343;
    const out = this.out(pos, kind === 'alert' ? 9 : 4, 1.15, distance);
    // a recording of one, where there is one (scripts/sounds.mjs says which is which): each of them a little higher or lower than the next
    if (this.rec(`z_${kind}`, out, t, { groan: 0.75, growl: 1.0, alert: 1.6, attack: 1.3, hurt: 1.1, die: 1.2 }[kind], 0.88 + ((seed * 37) % 24) / 100)) return;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(loud, t + Math.min(0.08, dur * 0.2));
    bus.gain.setValueAtTime(loud, t + dur * 0.55);
    bus.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    bus.connect(out);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(pitch * n0, t);
    osc.frequency.linearRampToValueAtTime(pitch * n1, t + dur * 0.4);
    osc.frequency.linearRampToValueAtTime(pitch * n2, t + dur);
    // the rattle in it: the note cut in and out a few dozen times a second
    const rattle = ctx.createOscillator();
    rattle.frequency.value = rough * (0.9 + Math.random() * 0.2);
    const depth = ctx.createGain();
    depth.gain.value = 0.45;
    const cut = ctx.createGain();
    cut.gain.value = 0.55;
    rattle.connect(depth).connect(cut.gain);
    osc.connect(cut);
    for (const [f, q, g] of [[f1, 4, 1], [f2, 6, 0.6]]) {
      const band = this.filter('bandpass', f, q);
      const lvl = ctx.createGain();
      lvl.gain.value = g;
      cut.connect(band).connect(lvl).connect(bus);
    }
    const air = this.noise(t, dur);
    const airBand = this.filter('bandpass', f2 * 1.2, 1.2);
    const airLvl = ctx.createGain();
    airLvl.gain.value = breath * 0.5;
    air.connect(airBand).connect(airLvl).connect(bus);
    osc.start(t);
    rattle.start(t);
    osc.stop(t + dur + 0.05);
    rattle.stop(t + dur + 0.05);
  }

  /**
   * Somebody calls out (see CALLS above, and src/sim/emotes.ts).
   * @param pos where they stand (their head); none for the player's own voice
   * @param voice whose voice, 0..1: from a low, broad one to a higher, thinner one
   */
  shout(id: string, pos?: V3, distance = 0, voice = 0.5) {
    const call = CALLS[id];
    if (!this.ready || !call) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.02 + distance / 343;
    const total = call.say.reduce((s, p) => s + p.d, 0);
    const end = t0 + total;
    const pitch = 108 + voice * 52;
    const size = 0.95 + voice * 0.11;
    // a node of this voice's own (see gunshot): out in the world from where they stand, or
    // straight to the ears, a little quieter, when it is your own
    const bus = ctx.createGain();
    bus.gain.value = pos ? 1 : 0.55;
    bus.connect(pos ? this.out(pos, 6, 1.1, distance) : this.sfx);
    // a raised voice carries a little way into the country as well
    const far = ctx.createGain();
    far.gain.value = 0.3 * (pos ? Math.pow(6 / (6 + Math.max(0, distance - 6)), 0.9) : 1);
    bus.connect(far);
    far.connect(this.reverbSend);
    far.connect(this.roomSend);

    // the throat: never quite steady, and rough with the effort of shouting
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    for (const [k, mul] of call.tune) {
      if (k === 0) osc.frequency.setValueAtTime(pitch * mul, t0);
      else osc.frequency.linearRampToValueAtTime(pitch * mul, t0 + k * total);
    }
    const waver = (hz: number, cents: number) => {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = cents;
      o.connect(g).connect(osc.detune);
      o.start(t0);
      o.stop(end + 0.3);
    };
    waver(5.4 + voice, 16);
    waver(29 + voice * 9, 9);
    const voiced = ctx.createGain();
    voiced.gain.value = 0;
    osc.connect(this.filter('lowpass', 3400, 0.5)).connect(voiced);
    // breath, through the same mouth
    const breath = ctx.createGain();
    breath.gain.value = 0;
    this.noise(t0, total + 0.15).connect(this.filter('bandpass', 1800, 0.4)).connect(breath);
    // the mouth: its three resonances side by side, each as loud as it should be (the upper two
    // are what tell an EE from an OO, and a shout has plenty of both). Every other one is
    // turned over, or they cancel each other in between.
    const mouth = [this.filter('bandpass', 500, 5), this.filter('bandpass', 1500, 8), this.filter('bandpass', 2500, 9)];
    const lips = ctx.createGain();
    lips.gain.value = 0.8;
    const low = this.filter('highpass', 130);
    low.connect(lips).connect(bus);
    mouth.forEach((f, i) => {
      const g = ctx.createGain();
      g.gain.value = [1, -0.62, 0.4][i];
      voiced.connect(f);
      breath.connect(f);
      f.connect(g).connect(low);
    });
    // hiss made at the teeth, and the puff as a shut mouth opens: neither is shaped by it
    const hissAt = this.filter('bandpass', 5000, 1.6);
    const hiss = ctx.createGain();
    hiss.gain.value = 0;
    this.noise(t0, total + 0.15).connect(hissAt).connect(hiss).connect(bus);
    const puffAt = this.filter('bandpass', 1500, 1.2);
    const puff = ctx.createGain();
    puff.gain.value = 0;
    this.noise(t0, total + 0.15).connect(puffAt).connect(puff).connect(bus);

    let t = t0;
    let was: number[] | null = null;
    for (const ph of call.say) {
      // (a shout opens the jaw: the lowest resonance sits higher than in talk)
      const to = MOUTH[ph.m].map((f, i) => f * size * (i ? 1 : 1.08));
      const glide = Math.min(ph.d, ph.g ?? 0.05);
      mouth.forEach((f, i) => {
        if (!was) f.frequency.setValueAtTime(to[i], t);
        else {
          f.frequency.setValueAtTime(was[i], t);
          f.frequency.linearRampToValueAtTime(to[i], t + glide);
        }
      });
      was = to;
      const v = ph.v ?? (ph.p ? 0 : 1);
      voiced.gain.setTargetAtTime(v, t, ph.p ? 0.006 : 0.014);
      breath.gain.setTargetAtTime(ph.p ? 0 : (ph.h ?? 0) * 1.5 + v * 0.05, t, 0.012);
      if (ph.s) hissAt.frequency.setValueAtTime(ph.s[0], t);
      hiss.gain.setTargetAtTime(ph.s ? ph.s[1] : 0, t, 0.012);
      t += ph.d;
      if (ph.p) {
        puffAt.frequency.setValueAtTime(ph.p[0], t);
        puff.gain.setValueAtTime(ph.p[1], t);
        puff.gain.setTargetAtTime(0, t + 0.004, 0.011);
      }
    }
    for (const g of [voiced, breath, hiss]) g.gain.setTargetAtTime(0, end, 0.03);
    osc.start(t0);
    osc.stop(end + 0.3);
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
    const out = this.out(pos, 14, 1, r);
    const tail = this.ctx.createGain();
    tail.gain.value = 0.5;
    out.connect(tail).connect(this.reverbSend);
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
    out.connect(pan).connect(this.sfx);
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

  /** A jeep running into something: tin, and the weight behind it. @param k how hard, 0..1 */
  crash(pos: V3, k: number) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this.out(pos, 8, 1.1);
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
    for (let i = 0; i < 3; i++) this.click(600 + Math.random() * 900, 0.12 + k * 0.2, 0.03, 0.05 + i * 0.07 + Math.random() * 0.04, pos);
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
      bed.connect(this.sfx);
      this.bunkerAir = { bed, on: false, nextT: 5, wind: this.ambience.wind?.gain.value ?? 0 };
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
    bus.connect(this.out(pos, 6, 0.9, r));
    const tail = ctx.createGain();
    tail.gain.value = 0.7;
    bus.connect(tail).connect(this.reverbSend);
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
    const out = this.out(pos, 6, 1, r);
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
