// The tenth film's score: an old fort in the snow, slow and grand. None of the bands of the other films is in it
// (no drum kit, no bass that jumps, nothing in sixteenths): a low drum at the pace of a slow march, voices held
// under a line for horns, and long cold notes where the film goes under the ground.
//
// Sixty beats to the minute: a beat is a second, and the film's twenty seconds are twenty beats. D minor, and at
// the end D major. The film says WHEN (shots10.ts hands over the moments its own shots make: when the lens goes
// under the ground, when it comes out into the night, when the last wide shot begins, when the address is up),
// and this file says what is played between them:
//
//   by day     from the first frame: the voices and the horns swell in from nothing over the first two beats (the
//              fort is first seen), over a soft stroke of the drum and a wash of cymbal. Then the march: the drum on
//              every beat, heavy and light by turns; the chords change every two beats (D minor, F, B flat, C);
//              the horns' line is one long note to a chord or two short ones (D . | F A | B flat . A | G .)
//   under      the drum stops and the voices with it. A low D that does not move, two high thin notes a fifth
//              apart that come and go, a far bell twice, and once a single soft stroke a long way off
//   by night   the drum comes back, soft and then less soft, a stroke a beat; low voices (G minor, then B flat);
//              the horns climb a note a beat (D, F, G) toward
//   the wide   the last wide shot: the air rises into it, a full stroke, and the whole band on the chord that
//              wants to go home (A major), the horns holding A in octaves
//   home       the address: one more stroke, a bell, and D major held by everybody and let die. The last half
//              second is silence.
//
// Everything is put into the film's offline render up front, as the other scores are. Nobody has heard it: its
// levels are set by the numbers the render prints (peak and loudness), not by ear.

export const BEAT10 = 1;

/** the moments of the film the score is written to, seconds */
export interface Marks10 {
  /** the lens goes under the ground */
  under: number;
  /** it comes out again, into the night */
  out: number;
  /** the last wide shot begins */
  wide: number;
  /** the address is up */
  home: number;
  /** the film ends */
  end: number;
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
/** a chord: its low note, the voices' notes, and what the horns play over it: [beats into it, note, how many beats long] */
interface Chord { root: number; voices: number[]; horn: [number, number, number][] }
// (D2 = 38, D3 = 50, D4 = 62)
const DAY: Chord[] = [
  { root: 38, voices: [50, 57, 62, 65], horn: [[0, 62, 2]] },
  { root: 41, voices: [53, 57, 60, 65], horn: [[0, 65, 1], [1, 69, 1]] },
  { root: 34, voices: [46, 53, 58, 62], horn: [[0, 70, 1.5], [1.5, 69, 0.5]] },
  { root: 36, voices: [48, 55, 60, 64], horn: [[0, 67, 2]] },
];
const NIGHT: Chord[] = [
  { root: 31, voices: [43, 50, 55, 58], horn: [] },
  { root: 34, voices: [46, 53, 58, 62], horn: [] },
];
/** the horns' climb by night, a note a beat (the last of them is held if there are more beats than notes) */
const CLIMB = [62, 65, 67];
const WIDE: Chord = { root: 33, voices: [45, 52, 57, 61, 64], horn: [] };
const HOME: Chord = { root: 26, voices: [50, 57, 62, 66, 69], horn: [] };

export function scoreMusic10(ctx: BaseAudioContext, out: AudioNode, marks: Marks10) {
  const q = (t: number) => Math.round(t / BEAT10) * BEAT10;
  const UNDER = q(marks.under), OUT = q(marks.out), WIDE_AT = q(marks.wide), HOME_AT = q(marks.home), END = marks.end;

  // ------------------------------------------------------------ the desk
  const master = ctx.createGain();
  const LEVEL = 0.62;
  master.gain.value = LEVEL;
  const squeeze = ctx.createDynamicsCompressor();
  squeeze.threshold.value = -14;
  squeeze.knee.value = 12;
  squeeze.ratio.value = 2.5;
  squeeze.attack.value = 0.01;
  squeeze.release.value = 0.3;
  master.connect(squeeze).connect(out);
  // (off before the very end, so the last frames are silent)
  master.gain.setValueAtTime(LEVEL, END - 0.75);
  master.gain.linearRampToValueAtTime(0, END - 0.45);

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  {
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  // a great stone room: noise dying away over three and a half seconds
  const hall = ctx.createConvolver();
  {
    const len = Math.floor(ctx.sampleRate * 3.6), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    hall.buffer = buf;
  }
  const hallIn = ctx.createGain(), hallOut = ctx.createGain();
  hallOut.gain.value = 0.5;
  hallIn.connect(hall).connect(hallOut).connect(master);
  const wet = (from: AudioNode, amount: number) => {
    const s = ctx.createGain();
    s.gain.value = amount;
    from.connect(s).connect(hallIn);
  };
  const tone = (type: OscillatorType, f: number, t: number, len: number, into: AudioNode) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.connect(into);
    o.start(Math.max(0, t));
    o.stop(t + len);
    return o;
  };
  const burst = (t: number, len: number, into: AudioNode, from = 0) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.connect(into);
    s.start(Math.max(0, t), Math.abs(from) % 1.6);
    s.stop(t + len + 0.05);
  };
  /** a level that comes up, is held, and goes: from `t`, up over `up` seconds to `peak`, held until `t + len`, gone `down` seconds after */
  const swellTo = (g: GainNode, t: number, peak: number, up: number, len: number, down: number) => {
    g.gain.setValueAtTime(0.0001, Math.max(0, t));
    g.gain.linearRampToValueAtTime(peak, t + up);
    g.gain.setValueAtTime(peak, Math.max(t + up, t + len));
    g.gain.linearRampToValueAtTime(0.0001, t + len + down);
  };

  // ------------------------------------------------------------ the band
  /** the drum: a big one, struck with a soft stick in a stone room. `low`: the heavy stroke, an octave under */
  const drum = (t: number, vel = 1, low = true) => {
    const f = hz(low ? 26 : 38), g = ctx.createGain();
    g.connect(master);
    wet(g, 0.6);
    tone('sine', f * 2.4, t, 1.3, g).frequency.exponentialRampToValueAtTime(f, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime((low ? 0.85 : 0.5) * vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (low ? 1.1 : 0.7));
    // (the skin: what a small speaker hears of it)
    const n = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = low ? 520 : 760;
    lp.connect(n).connect(master);
    wet(n, 0.5);
    burst(t, 0.1, lp, t * 3.1);
    n.gain.setValueAtTime(0.0001, t);
    n.gain.exponentialRampToValueAtTime(0.26 * vel, t + 0.003);
    n.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  };
  /**
   * Voices, held: to each note two saws a little apart, sung through the two bands a mouth open on "ah" lets
   * through, with the slow waver a held voice has. They come in over `up` seconds.
   */
  const voices = (t: number, notes: number[], len: number, vel = 1, up = 0.7, down = 0.9) => {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    lp.connect(g);
    g.connect(master);
    wet(g, 0.75);
    const mouth = ctx.createGain();
    for (const [f, qf, a] of [[640, 3, 1], [1120, 4, 0.55], [2500, 5, 0.16]]) {
      const bp = ctx.createBiquadFilter(), ga = ctx.createGain();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = qf;
      ga.gain.value = a;
      mouth.connect(bp).connect(ga).connect(lp);
    }
    const waver = ctx.createGain();
    waver.gain.value = 1;
    tone('sine', 4.6, t, len + down + 0.2, waver);
    notes.forEach((n, k) => {
      for (const cents of [-9, 8]) {
        const o = tone('sawtooth', hz(n) * Math.pow(2, cents / 1200), t, len + down + 0.2, mouth);
        // (each voice wavers by a few parts in a thousand, the higher the more)
        const depth = ctx.createGain();
        depth.gain.value = hz(n) * 0.003 * (1 + k * 0.15);
        waver.connect(depth).connect(o.frequency);
      }
    });
    swellTo(g, t, (0.36 * vel) / Math.sqrt(notes.length), up, len, down);
  };
  /** a horn, or four of them: saws behind a filter that opens as the note swells, with the octave under it */
  const horn = (t: number, midi: number, len: number, vel = 1, up = 0.14) => {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.9;
    lp.frequency.setValueAtTime(260, Math.max(0, t));
    lp.frequency.linearRampToValueAtTime(1500, t + up + 0.1);
    lp.frequency.linearRampToValueAtTime(950, t + len);
    lp.connect(g);
    g.connect(master);
    wet(g, 0.55);
    for (const cents of [-6, 5]) tone('sawtooth', hz(midi) * Math.pow(2, cents / 1200), t, len + 0.5, lp);
    const under = ctx.createGain();
    under.gain.value = 0.55;
    under.connect(lp);
    tone('sawtooth', hz(midi - 12), t, len + 0.5, under);
    swellTo(g, t, 0.105 * vel, up, len - 0.08, 0.3);
  };
  /** the basses: the chord's low note, bowed */
  const basses = (t: number, midi: number, len: number, vel = 1, up = 0.4) => {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    lp.connect(g).connect(master);
    wet(g, 0.3);
    for (const cents of [-7, 6]) tone('sawtooth', hz(midi) * Math.pow(2, cents / 1200), t, len + 0.8, lp);
    const s = ctx.createGain();
    s.gain.value = 0.9;
    s.connect(g);
    tone('sine', hz(midi), t, len + 0.8, s);
    swellTo(g, t, 0.2 * vel, up, len, 0.6);
  };
  /** the cold: a high thin note, two sines a hair apart, that comes and goes */
  const glass = (t: number, midi: number, len: number, vel = 1) => {
    const g = ctx.createGain();
    g.connect(master);
    wet(g, 0.9);
    for (const cents of [-4, 4]) tone('sine', hz(midi) * Math.pow(2, cents / 1200), t, len + 1, g);
    swellTo(g, t, 0.03 * vel, len * 0.5, len * 0.55, len * 0.45);
  };
  /** a bell: one sine bent by another. Far off (small, and all in the room) or near */
  const bell = (t: number, midi: number, vel = 1, len = 2.4, far = true) => {
    const f = hz(midi), g = ctx.createGain();
    g.connect(master);
    wet(g, far ? 1.2 : 0.6);
    const car = tone('sine', f, t, len + 0.1, g);
    const bend = ctx.createGain();
    bend.gain.setValueAtTime(f * 2.4, t);
    bend.gain.exponentialRampToValueAtTime(f * 0.04, t + 0.5);
    bend.connect(car.frequency);
    tone('sine', f * 3.51, t, len + 0.1, bend);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime((far ? 0.05 : 0.14) * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  };
  /** a low note that does not move: two saws behind a filter that breathes */
  const drone = (t: number, midi: number, len: number, vel = 1) => {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(110, t);
    lp.frequency.linearRampToValueAtTime(260, t + len * 0.5);
    lp.frequency.linearRampToValueAtTime(120, t + len);
    lp.connect(g).connect(master);
    wet(g, 0.4);
    for (const cents of [-10, 9]) tone('sawtooth', hz(midi) * Math.pow(2, cents / 1200), t, len + 0.8, lp);
    tone('sine', hz(midi - 12), t, len + 0.8, g);
    swellTo(g, t, 0.17 * vel, 0.8, len - 0.3, 0.7);
  };
  /** a cymbal rolled with soft sticks: the air rising toward a stroke, and gone with it */
  const roll = (from: number, to: number, vel = 1) => {
    const g = ctx.createGain(), bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(1800, Math.max(0, from));
    bp.frequency.exponentialRampToValueAtTime(6500, to);
    bp.connect(g).connect(master);
    wet(g, 0.5);
    burst(from, to - from + 0.9, bp, from * 0.31);
    g.gain.setValueAtTime(0.0001, Math.max(0, from));
    g.gain.exponentialRampToValueAtTime(0.11 * vel, to);
    g.gain.exponentialRampToValueAtTime(0.0001, to + 0.9);
  };

  // ------------------------------------------------------------ by day: from the first frame to where the lens goes under
  {
    // (the fort is first seen: everybody comes in from nothing, over a soft stroke and a wash)
    drum(0.02, 0.7);
    roll(-0.6, 0.35, 0.8);
    for (let b = 0, k = 0; b < UNDER; b += 2, k++) {
      const c = DAY[k % DAY.length], len = Math.min(2, UNDER - b) * BEAT10, first = b === 0;
      voices(b, c.voices, len, first ? 1 : 0.9, first ? 1.7 : 0.5);
      basses(b, c.root, len, 1, first ? 1.4 : 0.3);
      for (const [at, n, l] of c.horn) if (at < len) horn(b + at, n, Math.min(l, len - at), first ? 0.95 : 1, first ? 1.2 : 0.14);
    }
    // the march: from the second beat, a stroke a beat, heavy and light by turns
    for (let b = 2; b < UNDER; b++) drum(b, b % 2 === 0 ? 0.9 : 0.6, b % 2 === 0);
  }

  // ------------------------------------------------------------ under the ground: cold, and nearly nothing
  if (OUT > UNDER) {
    const len = OUT - UNDER;
    drone(UNDER - 0.3, 38, len + 0.3, 1);
    glass(UNDER + 0.4, 81, len * 0.55, 1);
    glass(UNDER + len * 0.35, 88, len * 0.6, 0.8);
    bell(UNDER + 1.5, 86, 1);
    if (len >= 4) bell(UNDER + len - 1.5, 81, 0.8);
    // (one stroke, a long way off: something shut, or somebody)
    if (len >= 3) drum(UNDER + Math.floor(len / 2) + 0.5, 0.22, false);
  }

  // ------------------------------------------------------------ by night: the drum again, and the horns climbing
  {
    const n = Math.max(0, WIDE_AT - OUT);
    for (let i = 0; i < n; i++) {
      const b = OUT + i, c = NIGHT[i === 0 ? 0 : 1], k = n > 1 ? i / (n - 1) : 1;
      drum(b, 0.5 + 0.35 * k, true);
      if (i > 0) drum(b + 0.5, 0.25 + 0.2 * k, false);
      if (i === 0 || i === 1) {
        const len = i === 0 ? 1 : n - 1;
        voices(b, c.voices, len, 0.75 + 0.2 * k, 0.5);
        basses(b, c.root, len, 0.9, 0.3);
      }
      const note = CLIMB[Math.min(i, CLIMB.length - 1)];
      if (i < CLIMB.length) horn(b, note, i === CLIMB.length - 1 ? n - i : 1, 0.8 + 0.2 * k);
    }
    if (n > 0) roll(WIDE_AT - Math.min(1.6, n), WIDE_AT, 1.1);
  }

  // ------------------------------------------------------------ the last wide shot: the whole band, on the chord that wants to go home
  if (HOME_AT > WIDE_AT) {
    const len = HOME_AT - WIDE_AT;
    drum(WIDE_AT, 1.1, true);
    drum(WIDE_AT, 0.7, false);
    for (let b = WIDE_AT + 1; b < HOME_AT; b++) drum(b, 0.7, false);
    voices(WIDE_AT, WIDE.voices, len, 1.15, 0.25);
    basses(WIDE_AT, WIDE.root, len, 1.15, 0.15);
    horn(WIDE_AT, 69, len, 1.1, 0.1);
    horn(WIDE_AT, 64, len, 0.8, 0.1);
    roll(HOME_AT - Math.min(0.9, len), HOME_AT, 0.9);
  }

  // ------------------------------------------------------------ home: the address
  {
    const len = END - HOME_AT - 0.5;
    drum(HOME_AT, 1.2, true);
    drum(HOME_AT, 0.8, false);
    bell(HOME_AT, 62, 1, 3, false);
    bell(HOME_AT + 0.02, 74, 0.6, 2.4, false);
    voices(HOME_AT, HOME.voices, len, 1.2, 0.12, 0.5);
    basses(HOME_AT, HOME.root + 12, len, 1.2, 0.08);
    horn(HOME_AT, 74, len, 1.05, 0.08);
    horn(HOME_AT, 66, len, 0.85, 0.08);
    horn(HOME_AT, 62, len, 0.8, 0.08);
  }
}

/** What the score is, beat by beat, in words: for whoever must judge by ear what nobody here has heard. */
export function describe10(marks: Marks10): string[] {
  const q = (t: number) => Math.round(t / BEAT10) * BEAT10;
  const U = q(marks.under), O = q(marks.out), W = q(marks.wide), H = q(marks.home), names = ['D minor', 'F', 'B flat', 'C'];
  const lines: string[] = [];
  for (let b = 0, k = 0; b < U; b += 2, k++) lines.push(`${b}-${Math.min(b + 2, U)} s  ${names[k % 4]}: voices, basses, horns${b === 0 ? ' (all swelling in from nothing; a soft stroke and a cymbal wash on the first frame)' : ''}; ${b === 0 ? 'no march yet' : 'the drum on each beat, heavy then light'}`);
  lines.push(`${U}-${O} s  under the ground: no drum, no voices; a low D held, two high thin notes (A, then E over it), a far bell at ${U + 1.5} s${O - U >= 4 ? ` and ${O - 1.5} s` : ''}, one soft far stroke at ${U + Math.floor((O - U) / 2) + 0.5} s`);
  lines.push(`${O}-${W} s  night: the drum again, a stroke a beat and growing; low voices (G minor, then B flat); the horns climb D, F, G, a note a beat; a cymbal roll into ${W} s`);
  lines.push(`${W}-${H} s  the last wide shot: a full stroke, everybody on A major, the horns holding A in octaves; a short roll into ${H} s`);
  lines.push(`${H}-${marks.end} s  the address: a stroke, a bell, D major held by voices, horns and basses, let die; silent from ${(marks.end - 0.45).toFixed(2)} s`);
  return lines;
}
