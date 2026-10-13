// The ninth film's score, and none of the other three bands in it.
//
// The first seven films were one band (saws through filters over a drum on every beat, 128 to the minute); the
// third had its own in C minor; the eighth was slow and made of bells. This one is written as a film is scored:
// it changes with what is on the screen. 120 beats to the minute, a bar of two seconds, E minor.
//
//   card     a low note held, three notes of the tune on a piano, the air rising
//   dread    the bunker: a drone, a heart beating, high strings that do not settle
//   sneak    the watcher: plucked strings on tiptoe, a plucked bass, fingers snapped on two and four, a clock
//   dig      the spade: a low drum on every beat, the bass in eighths, more of everything each bar
//   loot     what was in the case: bells going up, and the air rising to the bar after
//   groove   the dance: a drum on every beat, hands clapped, a bass that jumps octaves, chords stabbed off the beat
//   tour     the tune: half-time drums, strings in short eighths, the piano over them (Em, C, G, D)
//   tight    a fight indoors, the range: the same strings in sixteenths, the drum in threes and twos
//   board    the tune with brass under it and the drums whole
//   paid     the same, in the major (G, D, Em, C), an octave up
//   next     the drums gone: the piano alone over a held chord, and the air rising
//   sting    one blow, and a heart
//   end      a blow, the chord left ringing, the tune's last three notes
//
// The film says which bar is which (shots9.ts builds the list of rows from its own shots, so the two cannot come
// apart). Everything is scheduled up front into the film's offline render, as the others are. Nobody has heard
// it: its levels are set by the numbers the render prints (peak and loudness), not by ear.

export const BPM9 = 120;
export const BEAT9 = 60 / BPM9;
export const BAR9 = BEAT9 * 4;

export type Kind9 = 'card' | 'dread' | 'sneak' | 'dig' | 'loot' | 'groove' | 'tour' | 'tight' | 'board' | 'paid' | 'next' | 'sting' | 'end';
export interface Row9 {
  kind: Kind9;
  /** a blow as the bar begins (the picture changes to another part of the film), and how hard */
  hit?: number;
  /** the air rising through its second half toward the next bar */
  lift?: number;
  /** how far into its part this bar is, 0 to 1: more is played as a part goes on */
  build?: number;
  /** quieter: something on the screen is to be heard over it (a spade, a door, a shot) */
  under?: boolean;
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const STEP = BEAT9 / 4;

// E minor: the four bars of the tune, each with its low note, its chord and what the piano plays over it (eighths)
interface Bar { root: number; chord: number[]; tune: [number, number, number?][] }
const E = 40, C = 36, G = 43, D = 38;
const MINOR: Bar[] = [
  { root: E, chord: [52, 55, 59], tune: [[0, 71], [2, 76], [3, 79], [6, 78]] },
  { root: C, chord: [48, 52, 55], tune: [[0, 76], [2, 79], [4, 76], [6, 72]] },
  { root: G, chord: [50, 55, 59], tune: [[0, 74], [2, 79], [3, 83], [6, 81]] },
  { root: D, chord: [50, 54, 57], tune: [[0, 78], [2, 81], [4, 78], [6, 74], [7, 76]] },
];
// (the same tune turned to the major for the money: G, D, Em, C)
const MAJOR: Bar[] = [
  { root: G, chord: [50, 55, 59], tune: [[0, 74], [2, 79], [3, 83], [6, 81]] },
  { root: D, chord: [50, 54, 57], tune: [[0, 78], [2, 81], [4, 86], [6, 81]] },
  { root: E, chord: [52, 55, 59], tune: [[0, 79], [2, 83], [3, 88], [6, 86]] },
  { root: C, chord: [48, 52, 55], tune: [[0, 84], [2, 79], [4, 76], [6, 79], [7, 83]] },
];

export function scoreMusic9(ctx: BaseAudioContext, out: AudioNode, rows: Row9[]) {
  const SECONDS = rows.length * BAR9;
  // ------------------------------------------------------------ the desk
  const master = ctx.createGain();
  // (the first whole render came out at +2.1 dB before the film's ceiling and -15.2 dB on average: a little more of it)
  const LEVEL = 0.6;
  master.gain.value = LEVEL;
  const squeeze = ctx.createDynamicsCompressor();
  squeeze.threshold.value = -15;
  squeeze.knee.value = 10;
  squeeze.ratio.value = 3;
  squeeze.attack.value = 0.006;
  squeeze.release.value = 0.22;
  master.connect(squeeze).connect(out);
  // (off at the very end, so the last frame is silent)
  master.gain.setValueAtTime(LEVEL, SECONDS - 0.6);
  master.gain.linearRampToValueAtTime(0, SECONDS - 0.02);
  // (and brought down under the bars where the picture has something of its own to be heard)
  rows.forEach((r, i) => {
    const before = rows[i - 1]?.under ?? false;
    if (!!r.under === before) return;
    const t = Math.max(0.02, i * BAR9);
    master.gain.setValueAtTime(before ? LEVEL * 0.6 : LEVEL, t - 0.02);
    master.gain.linearRampToValueAtTime(r.under ? LEVEL * 0.6 : LEVEL, t + 0.12);
  });

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  {
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  // a hall: noise dying away
  const hall = ctx.createConvolver();
  {
    const len = Math.floor(ctx.sampleRate * 2.8), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    hall.buffer = buf;
  }
  const hallIn = ctx.createGain(), hallOut = ctx.createGain();
  hallOut.gain.value = 0.42;
  hallIn.connect(hall).connect(hallOut).connect(master);
  // an echo a dotted eighth long, each time duller
  const echo = ctx.createDelay(1), echoBack = ctx.createGain(), echoDull = ctx.createBiquadFilter(), echoIn = ctx.createGain();
  echo.delayTime.value = STEP * 3;
  echoBack.gain.value = 0.3;
  echoDull.type = 'lowpass';
  echoDull.frequency.value = 2400;
  echoIn.connect(echo).connect(echoDull).connect(echoBack).connect(echo);
  echoDull.connect(master);

  const env = (g: GainNode, t: number, peak: number, attack: number, len: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + len);
  };
  const burst = (t: number, len: number, into: AudioNode, from = 0) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.connect(into);
    s.start(t, from % 1.6, len + 0.05);
    s.stop(t + len + 0.05);
  };
  const tone = (type: OscillatorType, f: number, t: number, len: number, into: AudioNode) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.connect(into);
    o.start(t);
    o.stop(t + len);
    return o;
  };
  const wet = (from: AudioNode, hallAmt: number, echoAmt = 0) => {
    if (hallAmt) {
      const s = ctx.createGain();
      s.gain.value = hallAmt;
      from.connect(s).connect(hallIn);
    }
    if (echoAmt) {
      const s = ctx.createGain();
      s.gain.value = echoAmt;
      from.connect(s).connect(echoIn);
    }
  };

  // ------------------------------------------------------------ the band
  const kick = (t: number, vel = 1) => {
    const g = ctx.createGain();
    g.connect(master);
    const o = tone('sine', 140, t, 0.4, g);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.1);
    env(g, t, 0.95 * vel, 0.003, 0.32);
    const c = ctx.createGain(), hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2200;
    hp.connect(c).connect(master);
    burst(t, 0.012, hp, t);
    env(c, t, 0.22 * vel, 0.001, 0.014);
  };
  /** a big low drum, with the room it is struck in */
  const taiko = (t: number, vel = 1, midi = 33) => {
    const g = ctx.createGain();
    g.connect(master);
    wet(g, 0.5);
    const o = tone('sine', hz(midi) * 2.2, t, 0.7, g);
    o.frequency.exponentialRampToValueAtTime(hz(midi), t + 0.09);
    env(g, t, 0.8 * vel, 0.004, 0.55);
    const n = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(n).connect(master);
    burst(t, 0.08, lp, t * 3);
    env(n, t, 0.3 * vel, 0.002, 0.07);
  };
  const snare = (t: number, vel = 1, far = 0.35) => {
    const g = ctx.createGain(), bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.7;
    bp.connect(g);
    g.connect(master);
    wet(g, far);
    burst(t, 0.16, bp, t * 5);
    env(g, t, 0.5 * vel, 0.002, 0.16);
    const b = ctx.createGain();
    b.connect(master);
    tone('sine', 190, t, 0.09, b).frequency.exponentialRampToValueAtTime(140, t + 0.07);
    env(b, t, 0.28 * vel, 0.002, 0.07);
  };
  /** hands clapped: three bursts a hair apart */
  const clap = (t: number, vel = 1) => {
    const g = ctx.createGain(), bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 1.1;
    bp.connect(g);
    g.connect(master);
    wet(g, 0.3);
    for (const d of [0, 0.012, 0.026]) burst(t + d, 0.1, bp, (t + d) * 9);
    env(g, t, 0.42 * vel, 0.002, 0.15);
  };
  /** fingers snapped */
  const snap = (t: number, vel = 1) => {
    const g = ctx.createGain(), bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2300;
    bp.Q.value = 4;
    bp.connect(g);
    g.connect(master);
    wet(g, 0.45);
    burst(t, 0.03, bp, t * 7);
    env(g, t, 0.36 * vel, 0.001, 0.045);
  };
  const hat = (t: number, vel = 1, open = false) => {
    const g = ctx.createGain(), hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = open ? 6400 : 8200;
    hp.connect(g).connect(master);
    burst(t, open ? 0.2 : 0.03, hp, t * 0.37);
    env(g, t, 0.13 * vel, 0.001, open ? 0.17 : 0.028);
  };
  /** a clock: a dry tick, and every other one a shade lower */
  const tick = (t: number, vel = 1, low = false) => {
    const g = ctx.createGain();
    g.connect(master);
    tone('sine', low ? 1500 : 1900, t, 0.03, g);
    env(g, t, 0.1 * vel, 0.001, 0.02);
  };
  /** a heart: two soft blows */
  const heart = (t: number, vel = 1) => {
    for (const [d, v] of [[0, 1], [0.21, 0.7]]) {
      const g = ctx.createGain();
      g.connect(master);
      tone('sine', 62, t + d, 0.22, g).frequency.exponentialRampToValueAtTime(38, t + d + 0.14);
      env(g, t + d, 0.6 * vel * v, 0.006, 0.18);
    }
  };
  /** the low note: a sine with a little of the octave over it, so that a small speaker says it too */
  const sub = (t: number, midi: number, len: number, vel = 1) => {
    const g = ctx.createGain(), shape = ctx.createWaveShaper();
    const curve = new Float32Array(257);
    for (let i = 0; i < 257; i++) curve[i] = Math.tanh(((i - 128) / 128) * 2);
    shape.curve = curve;
    shape.connect(g).connect(master);
    tone('sine', hz(midi), t, len + 0.12, shape);
    const up = ctx.createGain();
    up.gain.value = 0.2;
    up.connect(shape);
    tone('triangle', hz(midi) * 2, t, len + 0.12, up);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4 * vel, t + 0.01);
    g.gain.setValueAtTime(0.4 * vel, t + Math.max(0.02, len - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.1);
  };
  /** a string plucked with a finger: bright for an instant, then only the note, then nothing */
  const pluck = (t: number, midi: number, vel = 1, pan = 0, len = 0.2) => {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter(), p = ctx.createStereoPanner();
    lp.type = 'lowpass';
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(hz(midi) * 7, t);
    lp.frequency.exponentialRampToValueAtTime(hz(midi) * 1.4, t + 0.09);
    p.pan.value = pan;
    lp.connect(g).connect(p).connect(master);
    wet(p, 0.4, 0.14);
    tone('triangle', hz(midi), t, len + 0.1, lp);
    const s = ctx.createGain();
    s.gain.value = 0.35;
    s.connect(lp);
    tone('sawtooth', hz(midi), t, len + 0.1, s);
    env(g, t, 0.24 * vel, 0.002, len);
  };
  /** a bass with a string as thick as a finger: the note drops into place, and dies quickly */
  const upright = (t: number, midi: number, vel = 1, len = 0.34) => {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.12);
    lp.connect(g).connect(master);
    const o = tone('triangle', hz(midi) * 1.06, t, len + 0.1, lp);
    o.frequency.exponentialRampToValueAtTime(hz(midi), t + 0.03);
    tone('sine', hz(midi), t, len + 0.1, lp);
    env(g, t, 0.5 * vel, 0.004, len);
  };
  /** a bass slapped: a saw behind a filter that snaps open and shut */
  const slap = (t: number, midi: number, len: number, vel = 1) => {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 7;
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + Math.min(0.16, len));
    lp.connect(g).connect(master);
    tone('sawtooth', hz(midi), t, len + 0.05, lp);
    tone('square', hz(midi) * 0.5, t, len + 0.05, lp);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2 * vel, t + 0.004);
    g.gain.setValueAtTime(0.2 * vel, t + Math.max(0.01, len - 0.03));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.02);
  };
  /** a chord struck short, off the beat */
  const stab = (t: number, notes: number[], vel = 1, len = 0.11) => {
    const g = ctx.createGain(), bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 0.9;
    bp.connect(g);
    g.connect(master);
    wet(g, 0.25, 0.2);
    for (const n of notes) for (const cents of [-7, 6]) tone('sawtooth', hz(n) * Math.pow(2, cents / 1200), t, len + 0.05, bp);
    env(g, t, (0.2 * vel) / Math.sqrt(notes.length), 0.003, len);
  };
  /** strings bowed short: one note of the eighths (or sixteenths) that run under the tune */
  const stacc = (t: number, midi: number, vel = 1, pan = 0) => {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter(), p = ctx.createStereoPanner();
    lp.type = 'lowpass';
    lp.frequency.value = 1900;
    p.pan.value = pan;
    lp.connect(g).connect(p).connect(master);
    wet(p, 0.3);
    for (const cents of [-9, 0, 8]) tone('sawtooth', hz(midi) * Math.pow(2, cents / 1200), t, 0.2, lp);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07 * vel, t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
  };
  /** strings held: two saws to a note, a little apart, behind a filter that opens */
  const strings = (t: number, notes: number[], len: number, vel = 1, open = 1500) => {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(380, t);
    lp.frequency.linearRampToValueAtTime(open, t + len * 0.75);
    lp.Q.value = 0.6;
    lp.connect(g);
    g.connect(master);
    wet(g, 0.5);
    for (const n of notes) for (const cents of [-8, 7]) tone('sawtooth', hz(n) * Math.pow(2, cents / 1200), t, len + 0.7, lp);
    const peak = (0.075 * vel) / Math.sqrt(notes.length);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(0.8, len * 0.4));
    g.gain.setValueAtTime(peak, t + len);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.6);
  };
  /** brass: the same, brighter, and it speaks at once */
  const brass = (t: number, notes: number[], len: number, vel = 1) => {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.4;
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(2300, t + 0.16);
    lp.frequency.exponentialRampToValueAtTime(1100, t + len);
    lp.connect(g);
    g.connect(master);
    wet(g, 0.45);
    for (const n of notes) for (const cents of [-5, 5]) tone('sawtooth', hz(n) * Math.pow(2, cents / 1200), t, len + 0.3, lp);
    const peak = (0.1 * vel) / Math.sqrt(notes.length);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.07);
    g.gain.setValueAtTime(peak * 0.8, t + len - 0.1);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.25);
  };
  /** a piano, near enough: the note and three of its overtones, each dying faster than the one under it */
  const piano = (t: number, midi: number, vel = 1, len = 1.4, pan = 0) => {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(master);
    wet(p, 0.5, 0.22);
    const f = hz(midi);
    [[1, 1, 1], [2.001, 0.42, 0.6], [3.003, 0.2, 0.4], [4.01, 0.1, 0.28]].forEach(([k, a, d]) => {
      const g = ctx.createGain();
      g.connect(p);
      tone('sine', f * k, t, len * d + 0.1, g);
      env(g, t, 0.2 * vel * a, 0.004, len * d);
    });
    // (the hammer)
    const h = ctx.createGain(), hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = f * 5;
    hp.connect(h).connect(p);
    burst(t, 0.012, hp, t * 11);
    env(h, t, 0.05 * vel, 0.001, 0.012);
  };
  /** a bell: one sine bent by another */
  const bell = (t: number, midi: number, vel = 1, len = 1.1, pan = 0) => {
    const f = hz(midi), g = ctx.createGain(), p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(master);
    wet(p, 0.4, 0.4);
    const car = tone('sine', f, t, len + 0.1, g);
    const bend = ctx.createGain();
    bend.gain.setValueAtTime(f * 2.2, t);
    bend.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.3);
    bend.connect(car.frequency);
    tone('sine', f * 3.01, t, len + 0.1, bend);
    env(g, t, 0.12 * vel, 0.002, len);
  };
  /** a low note that does not move: two saws behind a filter that breathes */
  const drone = (t: number, midi: number, len: number, vel = 1) => {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(120, t);
    lp.frequency.linearRampToValueAtTime(340, t + len * 0.5);
    lp.frequency.linearRampToValueAtTime(140, t + len);
    lp.connect(g).connect(master);
    for (const cents of [-12, 11]) tone('sawtooth', hz(midi) * Math.pow(2, cents / 1200), t, len + 0.3, lp);
    tone('sine', hz(midi - 12), t, len + 0.3, g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2 * vel, t + 0.5);
    g.gain.setValueAtTime(0.2 * vel, t + len - 0.2);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.25);
  };
  /** high strings that shake: notes a tone apart, each trembling at its own speed */
  const shiver = (t: number, notes: number[], len: number, vel = 1) => {
    const g = ctx.createGain(), bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.5;
    bp.connect(g);
    g.connect(master);
    wet(g, 0.6);
    notes.forEach((n, k) => {
      const a = ctx.createGain();
      a.gain.value = 0.5;
      a.connect(bp);
      tone('sawtooth', hz(n), t, len + 0.3, a);
      const trem = ctx.createGain();
      trem.gain.value = 0.5;
      trem.connect(a.gain);
      tone('sine', 9 + k * 1.7, t, len + 0.3, trem);
    });
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime((0.05 * vel) / Math.sqrt(notes.length), t + len * 0.5);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.2);
  };
  /** a blow where the picture changes: a sine falling out of hearing, and a crash closing down over it */
  const blow = (t: number, vel = 1) => {
    const g = ctx.createGain();
    g.connect(master);
    wet(g, 0.5);
    tone('sine', 80, t, 1.5, g).frequency.exponentialRampToValueAtTime(29, t + 1.1);
    env(g, t, 0.8 * vel, 0.004, 1.3);
    const n = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5000, t);
    lp.frequency.exponentialRampToValueAtTime(230, t + 1.1);
    lp.connect(n);
    n.connect(master);
    wet(n, 0.6);
    burst(t, 1.2, lp, t);
    env(n, t, 0.28 * vel, 0.003, 1.1);
  };
  /** a horn as wide as the sky, for where the film names itself */
  const braam = (t: number, midi: number, len: number, vel = 1) => {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter(), shape = ctx.createWaveShaper();
    const curve = new Float32Array(257);
    for (let i = 0; i < 257; i++) curve[i] = Math.tanh(((i - 128) / 128) * 3);
    shape.curve = curve;
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.exponentialRampToValueAtTime(1500, t + 0.25);
    lp.frequency.exponentialRampToValueAtTime(380, t + len);
    shape.connect(lp).connect(g).connect(master);
    wet(g, 0.5);
    const mix = ctx.createGain();
    mix.gain.value = 0.3;
    mix.connect(shape);
    for (const [n, cents] of [[midi, -14], [midi, 13], [midi + 7, -6], [midi + 12, 5], [midi - 12, 0]]) tone('sawtooth', hz(n) * Math.pow(2, cents / 1200), t, len + 0.2, mix);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * vel, t + 0.05);
    g.gain.setValueAtTime(0.3 * vel, t + len * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.15);
  };
  /** the air rising toward a blow */
  const rise = (from: number, to: number, vel = 1) => {
    const g = ctx.createGain(), bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(260, from);
    bp.frequency.exponentialRampToValueAtTime(7000, to);
    bp.connect(g).connect(master);
    for (let t = from; t < to; t += 1.5) burst(t, Math.min(1.55, to - t), bp, t * 0.31);
    g.gain.setValueAtTime(0.0001, from);
    g.gain.exponentialRampToValueAtTime(0.18 * vel, to - 0.02);
    g.gain.linearRampToValueAtTime(0.0001, to);
    const s = ctx.createGain();
    s.connect(master);
    tone('sine', 200, from, to - from, s).frequency.exponentialRampToValueAtTime(1300, to);
    s.gain.setValueAtTime(0.0001, from);
    s.gain.exponentialRampToValueAtTime(0.045 * vel, to - 0.02);
    s.gain.linearRampToValueAtTime(0.0001, to);
  };

  // ------------------------------------------------------------ the bars
  // (how many bars of its own kind have gone before each: the tune and its chords go round in fours within a part)
  const nth = rows.map((r, i) => {
    let k = 0;
    for (let j = i - 1; j >= 0 && sameBand(rows[j].kind, r.kind); j--) k++;
    return k;
  });
  rows.forEach(({ kind, hit, lift, build = 0 }, i) => {
    const t0 = i * BAR9, at = (step: number) => t0 + step * STEP, n = nth[i];
    const major = kind === 'paid', bar = (major ? MAJOR : MINOR)[n % 4];
    const tune = (vel: number, up = 0) => bar.tune.forEach(([s, m, l]) => piano(at(s * 2), m + up, vel * (s % 2 ? 0.8 : 1), l ?? 1.5, s % 2 ? 0.25 : -0.25));
    if (hit) blow(t0, hit);
    if (lift) rise(t0 + BEAT9 * 2, t0 + BAR9, lift);
    if (kind === 'card') {
      drone(t0, 28, BAR9 - 0.2, 0.9);
      strings(t0, [52, 59, 64], BAR9 - 0.1, 1.1, 1700);
      if (n === 0) braam(t0, 28, 1.6, 0.8);
      // (the first three notes of the tune, alone)
      if (n % 2 === 0) [[0, 71], [4, 76], [6, 79]].forEach(([s, m]) => piano(at(s * 2), m, 1.1, 2.2));
      else [[0, 78], [4, 76]].forEach(([s, m]) => piano(at(s * 2), m, 1, 2.4));
      for (let k = 0; k < 4; k++) tick(at(k * 4), 0.6, k % 2 === 1);
    } else if (kind === 'dread') {
      drone(t0, 28, BAR9 - 0.05, 1);
      heart(at(0), 0.9);
      heart(at(8), 0.75);
      shiver(t0, n % 2 ? [76, 77, 83] : [75, 76, 82], BAR9, 0.8 + build * 0.6);
      if (n % 2 === 1) piano(at(4), 52, 0.7, 2.6);
      if (n % 2 === 0) bell(at(10), 64, 0.5, 1.8, 0.3);
      for (let k = 0; k < 4; k++) tick(at(k * 4), 0.35, k % 2 === 1);
    } else if (kind === 'sneak') {
      // (on tiptoe: the bass on one and the three-and, plucked strings between, fingers on two and four)
      const walk = [bar.root, bar.root + 7, bar.root + 10, bar.root + 12];
      upright(at(0), walk[0], 1);
      upright(at(6), walk[1], 0.8);
      upright(at(10), walk[2], 0.85);
      if (n % 2) upright(at(14), walk[3], 0.7);
      snap(at(4), 0.9);
      snap(at(12), 1);
      for (let s = 0; s < 16; s += 2) tick(at(s), s % 4 ? 0.3 : 0.5, s % 4 !== 0);
      const up = [0, 3, 7, 10, 12, 10, 7, 3];
      [2, 3, 7, 9, 11, 14].forEach((s, k) => pluck(at(s), bar.root + 24 + up[(k + n * 3) % 8], 0.75 + build * 0.3, k % 2 ? 0.4 : -0.4));
      if (build > 0.5) hat(at(15), 0.5, true);
      if (n % 4 === 3) piano(at(8), bar.tune[1][1], 0.6, 1.2);
      drone(t0, bar.root - 12, BAR9 - 0.1, 0.35);
    } else if (kind === 'dig') {
      // (the spade: a low drum on each beat, the bass in eighths under it, more each bar)
      for (let b = 0; b < 4; b++) taiko(at(b * 4), b ? 0.7 : 1, 31);
      if (build > 0.3) for (const s of [6, 14]) taiko(at(s), 0.45, 38);
      for (let s = 0; s < 16; s += 2) sub(at(s), bar.root - (s % 4 ? 0 : 12), STEP * 1.6, 0.55 + build * 0.3);
      for (let s = 0; s < 16; s += build > 0.6 ? 1 : 2) stacc(at(s), bar.root + 12 + (s % 8 === 6 ? 3 : 0), 0.6 + build * 0.7, s % 2 ? 0.3 : -0.3);
      strings(t0, bar.chord, BAR9 - 0.1, 0.6 + build * 0.7, 900 + build * 1500);
      if (build > 0.45) for (let s = 2; s < 16; s += 4) hat(at(s), 0.6);
      if (build > 0.75) for (let k = 0; k < 8; k++) snare(at(12) + k * STEP * 0.5, 0.25 + k * 0.05, 0.2);
    } else if (kind === 'loot') {
      strings(t0, [bar.chord[0], bar.chord[1], bar.chord[2], bar.chord[0] + 14], BAR9 - 0.1, 1.2, 2600);
      sub(t0, bar.root - 12, BAR9 * 0.8, 0.7);
      [0, 3, 7, 12, 15, 19, 24, 27].forEach((s, k) => bell(at(k * 2), bar.root + 24 + s, 0.9 - k * 0.04, 1.4, k % 2 ? 0.4 : -0.4));
      for (let s = 0; s < 16; s += 4) tick(at(s), 0.5, s % 8 !== 0);
    } else if (kind === 'groove') {
      // (the dance: nobody in this film has earned a rest more)
      for (let b = 0; b < 4; b++) kick(at(b * 4), b ? 0.9 : 1);
      clap(at(4), 1);
      clap(at(12), 1);
      for (let b = 0; b < 4; b++) hat(at(b * 4 + 2), 0.9, true);
      for (let s = 0; s < 16; s++) if (s % 4 !== 2) hat(at(s), s % 2 ? 0.35 : 0.55);
      const r = bar.root, riff: [number, number, number][] = [[0, r, 2], [3, r + 12, 1], [4, r, 1], [6, r + 12, 1], [7, r + 10, 1], [8, r, 2], [11, r + 12, 1], [12, r + 7, 1], [14, r + 10, 1], [15, r + 12, 1]];
      for (const [s, m, l] of riff) slap(at(s), m, STEP * l * 0.85, 1);
      for (const s of [2, 6, 10, 14]) stab(at(s), bar.chord.map((m) => m + 12), s === 6 || s === 14 ? 1 : 0.75);
      sub(at(0), r - 12, STEP * 3, 0.6);
      sub(at(8), r - 12, STEP * 3, 0.5);
      if (n % 2 === 1) for (const [s, m] of [[8, 0], [10, 3], [12, 7], [14, 10]]) bell(at(s), r + 36 + m, 0.7, 0.5, 0.2);
      if (n === 0) braam(t0, r - 12, 0.9, 0.5);
    } else if (kind === 'tour' || kind === 'board' || kind === 'paid') {
      const full = kind !== 'tour';
      // half-time: the drum on one (and a push before three), the snare on three
      kick(at(0), 1);
      kick(at(6), 0.7);
      if (full) kick(at(10), 0.8);
      snare(at(8), full ? 1.05 : 0.85, 0.45);
      if (full) for (const s of [0, 12]) taiko(at(s), 0.55, 33);
      for (let s = 0; s < 16; s += 2) hat(at(s), s % 4 ? 0.5 : 0.75);
      if (full) for (let s = 1; s < 16; s += 2) hat(at(s), 0.28);
      if (n % 4 === 3) for (let k = 0; k < 4; k++) snare(at(14) + k * STEP * 0.5, 0.3 + k * 0.08, 0.2);
      sub(at(0), bar.root - 12, STEP * 5, 0.95);
      sub(at(6), bar.root - 12, STEP * 3, 0.8);
      sub(at(10), bar.root - 12, STEP * 5, 0.9);
      // the strings in short eighths: the chord's notes in turn, low
      const run = [bar.chord[0], bar.chord[2], bar.chord[1], bar.chord[2], bar.chord[0], bar.chord[2], bar.chord[1] + 12, bar.chord[2]];
      run.forEach((m, k) => stacc(at(k * 2), m, 0.8 + (full ? 0.25 : 0), k % 2 ? 0.35 : -0.35));
      strings(t0, bar.chord, BAR9 - 0.12, full ? 1 : 0.75, full ? 2400 : 1500);
      if (full) brass(t0, [bar.chord[0] - 12, bar.chord[0], bar.chord[2]], BAR9 - 0.2, major ? 1.1 : 0.9);
      // (the tune comes in on a part's third bar, so that a part of two bars is only its ground)
      if (full || n >= 2 || build > 0.4) tune(full ? 1.05 : 0.9, major ? 0 : 0);
      if (major) bar.chord.forEach((m, k) => bell(at(k * 4 + 2), m + 24, 0.55, 0.8, k % 2 ? 0.4 : -0.4));
    } else if (kind === 'tight') {
      // threes and twos: 3 + 3 + 2, twice
      for (const s of [0, 3, 6, 8, 11, 14]) kick(at(s), s === 0 || s === 8 ? 1 : 0.75);
      snare(at(4), 0.8, 0.25);
      snare(at(12), 0.9, 0.25);
      for (let s = 0; s < 16; s++) hat(at(s), s % 4 === 0 ? 0.8 : s % 2 ? 0.35 : 0.55);
      for (const s of [0, 3, 6, 8, 11, 14]) sub(at(s), bar.root - 12, STEP * 1.7, 0.85);
      for (let s = 0; s < 16; s++) stacc(at(s), bar.chord[s % 3] + (s % 8 === 7 ? 12 : 0), 0.6 + build * 0.4, s % 2 ? 0.3 : -0.3);
      strings(t0, [bar.chord[0], bar.chord[2]], BAR9 - 0.12, 0.7, 1300);
      if (n % 2 === 1) taiko(at(14), 0.8, 31);
    } else if (kind === 'next') {
      strings(t0, [bar.chord[0], bar.chord[1], bar.chord[2], bar.chord[0] + 12], BAR9 - 0.1, 1.2, 2000);
      sub(t0, bar.root - 12, BAR9 * 0.85, 0.7);
      tune(1.1);
      for (let s = 0; s < 16; s += 4) tick(at(s), 0.45, s % 8 !== 0);
    } else if (kind === 'sting') {
      drone(t0, 28, BAR9 - 0.05, 1.1);
      heart(at(0), 1);
      heart(at(8), 0.9);
      shiver(t0, [76, 77, 83], BAR9, 1.2);
      if (n === 0) piano(at(2), 52, 0.9, 3);
    } else if (kind === 'end') {
      if (n === 0) {
        braam(t0, 28, 1.8, 0.9);
        kick(t0, 1);
        taiko(t0, 1, 28);
      }
      sub(t0, 28, BAR9 * 0.8, n ? 0.6 : 1);
      strings(t0, [52, 55, 59, 64], BAR9 - 0.2, n ? 1 : 1.4, 2800);
      if (n === 0) [[0, 71], [4, 76], [6, 79]].forEach(([s, m]) => piano(at(s * 2), m, 1.2, 2.6));
      else if (n === 1) [[0, 78], [4, 76]].forEach(([s, m]) => piano(at(s * 2), m, 1.1, 3));
      else piano(t0, 64, 1, 3.4);
    }
  });
}

/** whether two bars are of one part of the music: the tune goes on from one into the other */
function sameBand(a: Kind9, b: Kind9) {
  const band = (k: Kind9) => (k === 'tour' || k === 'board' ? 'tune' : k);
  return band(a) === band(b);
}
