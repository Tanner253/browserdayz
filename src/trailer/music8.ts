// The eighth film's score, and nothing of the other seven in it.
//
// They were all one band at one speed: saws through filters over a four-to-the-floor drum at 128 beats a minute,
// in A or C minor. This one is slower and heavier, and made of other things: 96 beats a minute with the snare on
// the third beat (so it walks at half its speed), a low sine that slides into its notes, bells made by one sine
// bending another, a soft pad under them, and dry ticking hats. D minor. Twelve bars of 2.5 s: thirty seconds.
//
// It is written to the film (shots8.ts), which was cut again at the pace things are done at in the game (the first
// cut was thirty seconds and everything in it was hurried: "the entire video is too fast"): eighteen bars of 2.5 s,
// forty-five seconds.
//   1       the card: a swell, a clock ticking, a rise
//   2-7     the four guns: the beat, the bells
//   8-9     a gun looked over: the drums stop, the bells go on alone
//   10-12   rounds by hand: only the hats and one low note to a bar, so that every click of brass is heard
//   13-14   mending: the same, fuller; then the beat comes back under a roll
//   15      the car: everything, and a growling bass under it
//   16-17   the guns fired
//   18      where it is played: one blow, and the chord left ringing
//
// Everything is scheduled up front into the film's offline render, as the others are. Nobody has heard it:
// its levels are set by the numbers the render prints (peak and loudness), not by ear.

export const BPM8 = 96;
export const BEAT8 = 60 / BPM8;
export const BAR8 = BEAT8 * 4;
export const BARS8 = 18;
export const SECONDS8 = BARS8 * BAR8;

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const STEP = BEAT8 / 4;

type Kind = 'card' | 'beat' | 'alone' | 'hands' | 'roll' | 'full' | 'end';
interface Row {
  root: number;
  minor: boolean;
  kind: Kind;
  /** a blow as the bar begins (where the picture changes to another part of the sheet), and how hard */
  hit?: number;
  /** the air rising through its second half toward the next bar */
  lift?: number;
  /** every other bar of the beat: one kick fewer, and an open hat for the stutter */
  odd?: boolean;
  /** the quiet bars, a little fuller (mending) */
  up?: boolean;
}
// D minor: D2 38, G2 43, A1 33, Bb1 34, C2 36
const D = 38, G = 43, A = 33, Bb = 34, C = 36;
const row = (root: number, kind: Kind, o: Partial<Row> = {}): Row => ({ root, minor: root === D || root === G, kind, ...o });
const ROWS: Row[] = [
  row(D, 'card'),
  row(D, 'beat', { hit: 1 }), row(D, 'beat', { odd: true }), row(Bb, 'beat', { hit: 0.6 }), row(C, 'beat', { odd: true }), row(D, 'beat', { hit: 0.6 }), row(A, 'beat', { odd: true, lift: 0.8 }),
  row(D, 'alone', { hit: 0.55 }), row(Bb, 'alone', { lift: 0.6 }),
  row(G, 'hands'), row(D, 'hands'), row(A, 'hands', { lift: 0.8 }),
  row(Bb, 'hands', { hit: 0.5, up: true }), row(C, 'roll'),
  row(D, 'full', { hit: 1.1 }),
  row(Bb, 'full', { hit: 0.7 }), row(C, 'full', { lift: 1 }),
  row(D, 'end'),
];
if (ROWS.length !== BARS8) throw new Error('the score is not as long as the film');

export function scoreMusic8(ctx: BaseAudioContext, out: AudioNode) {
  // ------------------------------------------------------------ the desk
  const master = ctx.createGain();
  // (the first take came out at +4.8 dB before the film's ceiling, -10 dB on average: brought down so that the
  // ceiling is leant on by the gunfire alone, and the hands are heard over the band)
  master.gain.value = 0.6;
  const squeeze = ctx.createDynamicsCompressor();
  squeeze.threshold.value = -16;
  squeeze.knee.value = 10;
  squeeze.ratio.value = 3.2;
  squeeze.attack.value = 0.006;
  squeeze.release.value = 0.2;
  master.connect(squeeze).connect(out);
  // (and off at the very end, so the last frame is silent)
  master.gain.setValueAtTime(0.6, SECONDS8 - 0.5);
  master.gain.linearRampToValueAtTime(0, SECONDS8 - 0.02);

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  {
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  // a room: noise dying away, for the snare, the bells and the blows
  const room = ctx.createConvolver();
  {
    const len = Math.floor(ctx.sampleRate * 2.2), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
    }
    room.buffer = buf;
  }
  const roomIn = ctx.createGain(), roomOut = ctx.createGain();
  roomOut.gain.value = 0.5;
  roomIn.connect(room).connect(roomOut).connect(master);
  // an echo three sixteenths long, each time duller
  const echo = ctx.createDelay(1), echoBack = ctx.createGain(), echoDull = ctx.createBiquadFilter(), echoIn = ctx.createGain();
  echo.delayTime.value = STEP * 3;
  echoBack.gain.value = 0.36;
  echoDull.type = 'lowpass';
  echoDull.frequency.value = 2600;
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
    s.start(t, from, len + 0.05);
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

  // ------------------------------------------------------------ the band
  const kick = (t: number, vel = 1) => {
    const g = ctx.createGain();
    g.connect(master);
    const o = tone('sine', 150, t, 0.42, g);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    env(g, t, 0.95 * vel, 0.003, 0.36);
    const c = ctx.createGain(), hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    hp.connect(c).connect(master);
    burst(t, 0.01, hp, 0.3);
    env(c, t, 0.25 * vel, 0.001, 0.012);
  };
  /** the low note: a sine that slides into place, with a little of the octave over it so that a small speaker says it too */
  const low = (t: number, midi: number, len: number, vel = 1, from = 0) => {
    const g = ctx.createGain(), shape = ctx.createWaveShaper();
    const curve = new Float32Array(257);
    for (let i = 0; i < 257; i++) curve[i] = Math.tanh(((i - 128) / 128) * 2.2);
    shape.curve = curve;
    shape.connect(g).connect(master);
    const f = hz(midi), o = tone('sine', from ? hz(midi + from) : f, t, len + 0.12, shape);
    if (from) o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    const up = ctx.createGain();
    up.gain.value = 0.22;
    up.connect(shape);
    const o2 = tone('triangle', from ? hz(midi + from) * 2 : f * 2, t, len + 0.12, up);
    if (from) o2.frequency.exponentialRampToValueAtTime(f * 2, t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42 * vel, t + 0.008);
    g.gain.setValueAtTime(0.42 * vel, t + Math.max(0.02, len - 0.06));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.1);
  };
  const snare = (t: number, vel = 1, wet = 0.4) => {
    const g = ctx.createGain(), bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.7;
    bp.connect(g);
    g.connect(master);
    const send = ctx.createGain();
    send.gain.value = wet;
    g.connect(send).connect(roomIn);
    // (three, a hair apart: hands, not a machine)
    for (const d of [0, 0.011, 0.023]) burst(t + d, 0.12, bp, d * 7);
    env(g, t, 0.5 * vel, 0.002, 0.17);
    const b = ctx.createGain();
    b.connect(master);
    tone('sine', 196, t, 0.09, b).frequency.exponentialRampToValueAtTime(150, t + 0.07);
    env(b, t, 0.3 * vel, 0.002, 0.07);
  };
  const hat = (t: number, vel = 1, open = false) => {
    const g = ctx.createGain(), hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = open ? 6200 : 7800;
    hp.connect(g).connect(master);
    burst(t, open ? 0.2 : 0.035, hp, (t * 0.37) % 1.5);
    env(g, t, 0.15 * vel, 0.001, open ? 0.18 : 0.03);
  };
  /** a dry knock, like a knuckle on a stock */
  const knock = (t: number, vel = 1) => {
    const g = ctx.createGain();
    g.connect(master);
    tone('sine', 1150, t, 0.05, g).frequency.exponentialRampToValueAtTime(820, t + 0.03);
    env(g, t, 0.16 * vel, 0.001, 0.035);
  };
  /** a bell: one sine bent by another three times its pitch, the bend dying before the note does */
  const bell = (t: number, midi: number, vel = 1, len = 0.9, pan = 0) => {
    const f = hz(midi), g = ctx.createGain(), p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(master);
    const send = ctx.createGain(), far = ctx.createGain();
    send.gain.value = 0.45;
    far.gain.value = 0.3;
    p.connect(send).connect(echoIn);
    p.connect(far).connect(roomIn);
    const car = tone('sine', f, t, len + 0.1, g);
    const bend = ctx.createGain();
    bend.gain.setValueAtTime(f * 2.4, t);
    bend.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.28);
    bend.connect(car.frequency);
    tone('sine', f * 3.01, t, len + 0.1, bend);
    env(g, t, 0.15 * vel, 0.002, len);
  };
  /** a chord held under everything: two saws to a note, a little apart, behind a filter that opens */
  const pad = (t: number, notes: number[], len: number, vel = 1, open = 1500) => {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(420, t);
    lp.frequency.linearRampToValueAtTime(open, t + len * 0.8);
    lp.Q.value = 0.6;
    lp.connect(g);
    g.connect(master);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    g.connect(send).connect(roomIn);
    for (const n of notes) for (const cents of [-8, 7]) tone('sawtooth', hz(n) * Math.pow(2, cents / 1200), t, len + 0.7, lp);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime((0.07 * vel) / Math.sqrt(notes.length), t + Math.min(0.9, len * 0.45));
    g.gain.setValueAtTime((0.07 * vel) / Math.sqrt(notes.length), t + len);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.65);
  };
  /** the growl under the last two bars: two saws a fifth of a tone apart behind a filter that breathes */
  const growl = (t: number, midi: number, len: number, vel = 1) => {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.exponentialRampToValueAtTime(620, t + len * 0.5);
    lp.frequency.exponentialRampToValueAtTime(200, t + len);
    lp.connect(g).connect(master);
    for (const cents of [-16, 15]) tone('sawtooth', hz(midi + 12) * Math.pow(2, cents / 1200), t, len + 0.05, lp);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * vel, t + 0.012);
    g.gain.setValueAtTime(0.16 * vel, t + len - 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.03);
  };
  /** a blow where the picture changes: a sine falling out of hearing, and a crash closing down over it */
  const blow = (t: number, vel = 1) => {
    const g = ctx.createGain();
    g.connect(master);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    g.connect(send).connect(roomIn);
    tone('sine', 82, t, 1.5, g).frequency.exponentialRampToValueAtTime(30, t + 1.1);
    env(g, t, 0.8 * vel, 0.004, 1.3);
    const n = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.exponentialRampToValueAtTime(240, t + 1.1);
    lp.connect(n);
    n.connect(master);
    const far = ctx.createGain();
    far.gain.value = 0.6;
    n.connect(far).connect(roomIn);
    burst(t, 1.2, lp);
    env(n, t, 0.3 * vel, 0.003, 1.1);
  };
  /** the air rising toward a blow */
  const rise = (from: number, to: number, vel = 1) => {
    const g = ctx.createGain(), bp = ctx.createBiquadFilter(), len = to - from;
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(260, from);
    bp.frequency.exponentialRampToValueAtTime(7200, to);
    bp.connect(g).connect(master);
    for (let t = from; t < to; t += 1.6) burst(t, Math.min(1.7, to - t), bp, (t * 0.31) % 0.3);
    g.gain.setValueAtTime(0.0001, from);
    g.gain.exponentialRampToValueAtTime(0.2 * vel, to - 0.02);
    g.gain.linearRampToValueAtTime(0.0001, to);
    const s = ctx.createGain();
    s.connect(master);
    tone('sine', 220, from, len, s).frequency.exponentialRampToValueAtTime(1320, to);
    s.gain.setValueAtTime(0.0001, from);
    s.gain.exponentialRampToValueAtTime(0.05 * vel, to - 0.02);
    s.gain.linearRampToValueAtTime(0.0001, to);
  };

  // ------------------------------------------------------------ the twelve bars
  /** what the bells play over a bar's low note, in eighths: semitones above it (an octave up) */
  const TUNE = (minor: boolean) => (minor ? [12, 19, 24, 27, 24, 19, 26, 19] : [12, 19, 24, 28, 24, 19, 26, 19]);
  ROWS.forEach(({ root, minor, kind, hit, lift, odd, up }, i) => {
    const t0 = i * BAR8, at = (step: number) => t0 + step * STEP, third = minor ? 3 : 4;
    const tune = TUNE(minor);
    const bells = (vel: number, up = 0, every = 1) => tune.forEach((n, k) => k % every === 0 && bell(at(k * 2), root + n + up, vel * (k % 2 ? 0.75 : 1), 0.8, k % 2 ? 0.35 : -0.35));
    if (kind === 'card') {
      pad(t0, [root + 12, root + 12 + third, root + 19], BAR8 - 0.1, 1.2, 2200);
      for (let k = 0; k < 8; k++) knock(at(k * 2), 0.5 + k * 0.07);
      low(t0, root, BAR8 * 0.9, 0.7);
      rise(t0 + BEAT8 * 1.5, t0 + BAR8, 1);
    } else if (kind === 'beat') {
      if (hit) blow(t0, hit);
      for (const s of odd ? [0, 6, 10] : [0, 6, 10, 14]) kick(at(s), s ? 0.85 : 1);
      low(at(0), root, STEP * 5, 1);
      low(at(6), root, STEP * 3, 0.85);
      low(at(10), root, STEP * 5, 0.95, 12);
      snare(at(8), 1);
      for (let s = 0; s < 16; s += 2) hat(at(s), s % 4 ? 0.7 : 1);
      hat(at(3), 0.4);
      hat(at(11), 0.4);
      // (a stutter into the next bar, every other one)
      if (!odd) for (let k = 0; k < 6; k++) hat(at(13) + (k * STEP) / 2, 0.45 + k * 0.08);
      else hat(at(14), 0.9, true);
      bells(0.9);
      pad(t0, [root + 12, root + 19], BAR8 - 0.15, 0.7, 1100);
      if (lift) rise(t0 + BEAT8 * 2, t0 + BAR8, lift);
    } else if (kind === 'alone') {
      if (hit) blow(t0, hit);
      pad(t0, [root + 12, root + 12 + third, root + 19, root + 22], BAR8 - 0.1, 1.3, 1900);
      low(t0, root, BAR8 * 0.85, 0.8);
      bells(1.1, 12, 1);
      if (lift) rise(t0 + BEAT8 * 2.5, t0 + BAR8, lift);
    } else if (kind === 'hands') {
      if (hit) blow(t0, hit);
      kick(at(0), 0.9);
      low(at(0), root, STEP * 6, 0.9, 5);
      for (let s = 0; s < 16; s += 2) hat(at(s), s % 4 ? 0.45 : 0.6);
      knock(at(4), 0.9);
      knock(at(12), 0.9);
      knock(at(14), 0.5);
      pad(t0, up ? [root + 12, root + 12 + third, root + 19] : [root + 12, root + 19], BAR8 - 0.15, up ? 0.9 : 0.6, up ? 1500 : 900);
      bells(up ? 0.7 : 0.5, 0, up ? 2 : 4);
      if (lift) {
        snare(at(8), 0.5, 0.6);
        rise(t0 + BEAT8 * 2, t0 + BAR8 - STEP, lift);
      }
    } else if (kind === 'roll') {
      blow(t0, 0.8);
      kick(at(0));
      kick(at(6), 0.85);
      low(at(0), root, STEP * 6, 1);
      low(at(8), root + 2, STEP * 7, 1, 0);
      snare(at(8), 0.9);
      for (let s = 0; s < 12; s += 2) hat(at(s), 0.8);
      bells(1, 0, 1);
      // the roll: sixteenths, then twice as fast, louder all the way
      for (let k = 0; k < 4; k++) snare(at(12) + k * STEP * 0.5, 0.3 + k * 0.06, 0.2);
      for (let k = 0; k < 8; k++) snare(at(14) + k * STEP * 0.25, 0.5 + k * 0.06, 0.2);
      rise(t0 + BEAT8 * 2, t0 + BAR8, 1.1);
      pad(t0, [root + 12, root + 16, root + 19], BAR8 - 0.1, 1, 2400);
    } else if (kind === 'full') {
      if (hit) blow(t0, hit);
      for (const s of [0, 3, 6, 10, 12]) kick(at(s), s === 3 ? 0.7 : 1);
      snare(at(8), 1.1);
      snare(at(15), 0.45, 0.2);
      for (let s = 0; s < 16; s++) hat(at(s), s % 4 === 0 ? 1 : s % 2 ? 0.45 : 0.75);
      hat(at(6), 0.9, true);
      low(at(0), root, STEP * 3, 1);
      low(at(3), root, STEP * 3, 0.85);
      low(at(6), root, STEP * 4, 0.9);
      low(at(10), root, STEP * 2, 0.9, 12);
      low(at(12), root + (lift ? 2 : 0), STEP * 4, 1);
      growl(at(0), root, STEP * 6, 1);
      growl(at(6), root, STEP * 4, 0.9);
      growl(at(10), root + (lift ? 2 : 0), STEP * 6, 1);
      bells(1, 12);
      pad(t0, [root + 12, root + 12 + third, root + 19], BAR8 - 0.12, 1, 2600);
      if (lift) rise(t0 + BEAT8 * 2, t0 + BAR8, lift);
    } else {
      blow(t0, 1.2);
      kick(t0, 1);
      low(t0, root, BAR8 * 0.7, 1);
      pad(t0, [root + 12, root + 15, root + 19, root + 24], BAR8 - 0.9, 1.5, 3000);
      [0, 7, 12, 15, 19, 24].forEach((n, k) => bell(t0 + k * STEP, root + 12 + n, 1.2 - k * 0.08, 2.2, k % 2 ? 0.4 : -0.4));
    }
  });
}
