// The sixteenth film's score ("This week in ZONA", shots16.ts): a trailer's, made here from nothing but oscillators and
// noise, as every score of these films is. The owner, 2026-10-15: "make sure its powerful marketing / We need new
// music". Its own, not another film's: D minor over Dm B♭ Gm A (the A major, the harmonic minor's, for the pull back
// home), 140 beats to the minute in half time, the weight in the low end: a braam on the card, taiko under the
// controller, the drop on the emotes with an 808 and rolling hats and a brass hook, the bot check dark and ticking, a
// rise into the numbers, and one blow to end on.
export const BPM16 = 140;
export const BEAT16 = 60 / BPM16;
export const BAR16 = BEAT16 * 4;

/** what each bar of the film is, in order (see shots16.ts) */
export type Part16 = 'open' | 'pulse' | 'drop' | 'tense' | 'lift' | 'end';
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
// Dm, B♭, Gm, A: the low note and the chord of each, a bar apiece
const ROOTS = [38, 34, 31, 33];
const CHORDS = [[62, 65, 69], [62, 65, 70], [62, 67, 70], [61, 64, 69]];
// the ostinato: sixteenths over each chord (offsets into the chord, an octave up where 3)
const OSTINATO = [0, 1, 2, 3, 2, 1, 0, 2, 0, 1, 2, 3, 2, 1, 2, 1];
// the hook over the drop: [sixteenth of the bar, midi, sixteenths long], four bars of it
const HOOK: [number, number, number][][] = [
  [[0, 74, 3], [3, 72, 1], [4, 74, 4], [10, 77, 2], [12, 76, 4]],
  [[0, 74, 3], [3, 72, 1], [4, 70, 6], [12, 69, 2], [14, 70, 2]],
  [[0, 70, 3], [3, 69, 1], [4, 67, 4], [10, 70, 2], [12, 74, 4]],
  [[0, 73, 6], [6, 74, 2], [8, 76, 4], [12, 73, 4]],
];

export function scoreMusic16(ctx: BaseAudioContext, out: AudioNode, bars: Part16[]) {
  const END = bars.length * BAR16 + 3.5;
  // ------------------------------------------------------------ the desk
  const master = ctx.createGain();
  master.gain.value = 0.5;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16;
  glue.knee.value = 8;
  glue.ratio.value = 4.5;
  glue.attack.value = 0.006;
  glue.release.value = 0.22;
  master.connect(glue).connect(out);
  // a hall: noise that dies away slowly, as an impulse
  const hall = ctx.createConvolver();
  {
    const len = Math.floor(ctx.sampleRate * 3.4), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    hall.buffer = buf;
  }
  const wet = ctx.createGain();
  wet.gain.value = 0.26;
  hall.connect(wet).connect(master);
  // everything above the low end ducks a little under the drums
  const bus = ctx.createGain();
  bus.connect(master);
  bus.connect(hall);
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  {
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const noiseAt = (t: number, dur: number) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
    return s;
  };
  const env = (g: AudioParam, t: number, peak: number, a: number, d: number) => {
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + a);
    g.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  // a soft clip, for the 808's growl
  const grit = ctx.createWaveShaper();
  {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4);
    }
    grit.curve = curve;
  }
  const low = ctx.createGain();
  low.gain.value = 0.9;
  grit.connect(low).connect(master);

  // ------------------------------------------------------------ the players
  const duck = (t: number, k = 0.45) => {
    bus.gain.setValueAtTime(k, t);
    bus.gain.setTargetAtTime(1, t + 0.02, 0.12);
  };
  /** a big drum: a taiko's body, low and long, with the skin's slap on its front */
  const taiko = (t: number, v = 1, pitch = 1) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(120 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(48 * pitch, t + 0.3);
    env(g.gain, t, 1.0 * v, 0.003, 0.7);
    o.connect(g).connect(master);
    o.connect(g).connect(hall);
    o.start(t);
    o.stop(t + 0.8);
    const s = noiseAt(t, 0.12), f = ctx.createBiquadFilter(), sg = ctx.createGain();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.7;
    env(sg.gain, t, 0.45 * v, 0.001, 0.09);
    s.connect(f).connect(sg).connect(master);
    duck(t, 0.6);
  };
  const kick = (t: number, v = 1) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.09);
    env(g.gain, t, 1.2 * v, 0.002, 0.32);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.4);
    duck(t);
  };
  const snare = (t: number, v = 1) => {
    const s = noiseAt(t, 0.3), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.6;
    env(g.gain, t, 0.55 * v, 0.001, 0.22);
    s.connect(f).connect(g).connect(bus);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    env(og.gain, t, 0.35 * v, 0.001, 0.1);
    o.connect(og).connect(bus);
    o.start(t);
    o.stop(t + 0.15);
  };
  const hat = (t: number, v = 1) => {
    const s = noiseAt(t, 0.1), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'highpass';
    f.frequency.value = 8200;
    env(g.gain, t, 0.16 * v, 0.001, 0.028);
    s.connect(f).connect(g).connect(bus);
  };
  /** the clock: a dry tick, high and short, for the bot check */
  const tick = (t: number, v = 1) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 2400;
    env(g.gain, t, 0.05 * v, 0.0005, 0.012);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.03);
  };
  /** an 808: a sine that falls to its note, through the growl */
  const sub = (t: number, midi: number, len: number, v = 1, glideFrom = 0) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    if (glideFrom) {
      o.frequency.setValueAtTime(hz(glideFrom), t);
      o.frequency.exponentialRampToValueAtTime(hz(midi), t + 0.12);
    } else o.frequency.setValueAtTime(hz(midi), t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.75 * v, t + 0.006);
    g.gain.setValueAtTime(0.75 * v, t + Math.max(0.01, len - 0.12));
    g.gain.linearRampToValueAtTime(0, t + len);
    o.connect(g).connect(grit);
    o.start(t);
    o.stop(t + len + 0.05);
  };
  /** the braam: low saws, many and spread, through a filter that opens and shuts, a horn's blare made of nothing */
  const braam = (t: number, midi: number, len: number, v = 1) => {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 0.35);
    f.frequency.exponentialRampToValueAtTime(260, t + len);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * v, t + 0.08);
    g.gain.setValueAtTime(0.16 * v, t + len * 0.6);
    g.gain.linearRampToValueAtTime(0, t + len);
    for (const oct of [0, 12, -12]) for (const det of [-18, -7, 0, 7, 18]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(midi + oct);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    f.connect(g).connect(master);
    g.connect(hall);
  };
  /** strings held: five saws a note through a soft filter, swelling in */
  const strings = (t: number, notes: number[], len: number, v = 1, cutoff = 2400) => {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045 * v, t + Math.min(0.5, len * 0.4));
    g.gain.setValueAtTime(0.045 * v, t + len * 0.85);
    g.gain.linearRampToValueAtTime(0, t + len);
    for (const n of notes) for (const det of [-12, -5, 0, 5, 12]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(n);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    f.connect(g).connect(bus);
  };
  /** a pluck: one short note, bright and gone */
  const pluck = (t: number, midi: number, v = 1) => {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(4200, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.14);
    env(g.gain, t, 0.07 * v, 0.002, 0.16);
    for (const [det, type] of [[0, 'sawtooth'], [7, 'square']] as [number, OscillatorType][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz(midi);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + 0.2);
    }
    f.connect(g).connect(bus);
  };
  /** the hook's voice: a brass made of saws, with a little bend into each note */
  const brass = (t: number, midi: number, len: number, v = 1) => {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(3600, t + 0.08);
    f.frequency.exponentialRampToValueAtTime(1500, t + len);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11 * v, t + 0.04);
    g.gain.setValueAtTime(0.1 * v, t + Math.max(0.05, len - 0.06));
    g.gain.linearRampToValueAtTime(0, t + len);
    for (const det of [-9, 0, 9]) for (const oct of [0, -12]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(hz(midi + oct - 0.6), t);
      o.frequency.linearRampToValueAtTime(hz(midi + oct), t + 0.06);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    f.connect(g).connect(bus);
  };
  /** air rising over a stretch, a snare rolling faster toward its end */
  const rise = (t: number, len: number) => {
    const s = noiseAt(t, len), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass';
    f.Q.value = 1.6;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(10000, t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + len);
    g.gain.linearRampToValueAtTime(0, t + len + 0.02);
    s.connect(f).connect(g).connect(master);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(73, t);
    o.frequency.exponentialRampToValueAtTime(587, t + len);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.045, t + len);
    og.gain.linearRampToValueAtTime(0, t + len + 0.02);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + len + 0.05);
    for (let at = t; at < t + len - 0.01; ) {
      const left = (t + len - at) / len, step = left > 0.5 ? BEAT16 / 2 : left > 0.2 ? BEAT16 / 4 : BEAT16 / 8;
      snare(at, 0.25 + 0.7 * (1 - left));
      at += step;
    }
  };
  /** a breath drawn in before a blow: noise swelling backwards into it */
  const suck = (t: number, len: number) => {
    const s = noiseAt(t - len, len), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t - len);
    f.frequency.exponentialRampToValueAtTime(6000, t);
    g.gain.setValueAtTime(0.0001, t - len);
    g.gain.exponentialRampToValueAtTime(0.4, t - 0.01);
    g.gain.linearRampToValueAtTime(0, t);
    s.connect(f).connect(g).connect(master);
  };
  /** the blow: a crash, the floor falling away under it, and the hall ringing */
  const impact = (t: number, v = 1) => {
    const s = noiseAt(t, 2.4), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'highpass';
    f.frequency.value = 2400;
    env(g.gain, t, 0.3 * v, 0.002, 2);
    s.connect(f).connect(g).connect(master);
    s.connect(f).connect(g).connect(hall);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(80, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 1.6);
    env(og.gain, t, 1.0 * v, 0.002, 1.7);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + 1.8);
    taiko(t, 1.1 * v, 0.8);
  };

  // ------------------------------------------------------------ the arrangement, bar by bar
  bars.forEach((part, b) => {
    const t0 = b * BAR16, k = b % 4, was = bars[b - 1], next = bars[b + 1];
    const into = bars.slice(0, b).filter((p) => p === part).length;
    const s16 = BEAT16 / 4;
    if (part === 'open') {
      // the card: a braam on the first beat, the drums answering, and the air drawn into what comes
      if (was !== 'open') {
        braam(t0, ROOTS[0] + 12, BAR16 * 1.6, 1.2);
        taiko(t0, 1.2, 0.85);
        sub(t0, ROOTS[0], BAR16 * 1.4, 0.8);
      }
      taiko(t0 + BEAT16 * 2.5, 0.7);
      taiko(t0 + BEAT16 * 3, 0.85);
      if (next !== 'open') {
        for (let e = 0; e < 4; e++) taiko(t0 + BEAT16 * 3.5 + e * (BEAT16 / 8), 0.4 + e * 0.15, 1.2);
        suck(t0 + BAR16, BEAT16 * 2);
      }
    } else if (part === 'pulse') {
      // the controller: the ostinato over the chords, taiko on one and the and of three, the hats coming in
      for (let e = 0; e < 16; e++) {
        const n = CHORDS[k][OSTINATO[e] % 3] + (OSTINATO[e] === 3 ? 12 : 0);
        pluck(t0 + e * s16, n, e % 4 === 0 ? 1.1 : 0.8);
      }
      taiko(t0, 1);
      taiko(t0 + BEAT16 * 2.5, 0.75);
      if (into >= 1) for (let e = 0; e < 8; e++) hat(t0 + e * (BEAT16 / 2), e % 2 ? 0.6 : 0.9);
      if (into >= 2) snare(t0 + BEAT16 * 2, 0.8);
      sub(t0, ROOTS[k], BAR16 * 0.95, 0.65);
      strings(t0, CHORDS[k], BAR16, 0.8, 1200 + into * 300);
      if (next !== 'pulse') {
        rise(t0 + BEAT16 * 2, BEAT16 * 2);
        suck(t0 + BAR16, BEAT16);
      }
    } else if (part === 'drop') {
      // the emotes: half time, the 808 under it, hats rolling, the hook in brass
      if (was !== 'drop') {
        impact(t0);
        braam(t0, ROOTS[k] + 12, BAR16 * 0.9, 0.9);
      }
      kick(t0);
      kick(t0 + BEAT16 * 1.5, 0.85);
      kick(t0 + BEAT16 * 2.75, 0.7);
      snare(t0 + BEAT16 * 2, 1.1);
      for (let e = 0; e < 16; e++) {
        // (rolls: a run of thirty-seconds into the last beat of every other bar)
        if (b % 2 === 1 && e >= 12) {
          hat(t0 + e * s16, 0.8);
          hat(t0 + e * s16 + s16 / 2, 0.6);
        } else if (e % 2 === 0 || e === 7 || e === 15) hat(t0 + e * s16, e % 4 === 0 ? 1 : 0.65);
      }
      sub(t0, ROOTS[k], BEAT16 * 1.4, 1, was !== 'drop' ? ROOTS[k] + 12 : 0);
      sub(t0 + BEAT16 * 1.5, ROOTS[k], BEAT16 * 1.2, 0.9);
      sub(t0 + BEAT16 * 2.75, ROOTS[k] + (k === 3 ? 7 : 3), BEAT16 * 1.2, 0.85, ROOTS[k]);
      strings(t0, CHORDS[k], BAR16, 1.1, 3200);
      for (const [e, n, l] of HOOK[into % 4]) brass(t0 + e * s16, n, l * s16 * 0.95, 1);
    } else if (part === 'tense') {
      // the bot check: the floor drops out, the clock ticks, the drums are few and far apart
      if (was !== 'tense') {
        taiko(t0, 1.1, 0.7);
        braam(t0, ROOTS[0] + 12, BAR16 * 0.8, 0.7);
      }
      for (let e = 0; e < 16; e++) tick(t0 + e * s16, e % 4 === 0 ? 1.4 : 0.8);
      taiko(t0 + (into % 2 ? BEAT16 * 2 : 0), 0.8, 0.9);
      if (into >= 2) kick(t0 + BEAT16 * 3.5, 0.6);
      sub(t0, ROOTS[k], BAR16 * 0.98, 0.6);
      // low strings, the minor's darker side
      strings(t0, [CHORDS[k][0] - 12, CHORDS[k][1] - 12], BAR16, 1.2, 900 + into * 150);
      for (let e = 0; e < 8; e++) pluck(t0 + e * (BEAT16 / 2), CHORDS[k][e % 2 ? 1 : 0] - 12, 0.7);
    } else if (part === 'lift') {
      // the numbers: everything rising together into the last blow
      if (was !== 'lift') rise(t0, bars.slice(b).findIndex((p) => p !== 'lift') * BAR16);
      strings(t0, CHORDS[k].map((n) => n + 12), BAR16, 1.2, 2000 + into * 1400);
      for (let e = 0; e < 16; e++) pluck(t0 + e * s16, CHORDS[k][OSTINATO[e] % 3] + 12, 0.7 + into * 0.15);
      taiko(t0, 0.9);
      sub(t0, ROOTS[k], BAR16, 0.7);
      if (next !== 'lift') suck(t0 + BAR16, BEAT16 * 1.5);
    } else if (part === 'end' && was !== 'end') {
      // the end: one blow of everything on the home chord, and the hall ringing after it
      impact(t0, 1.2);
      kick(t0, 1.3);
      braam(t0, ROOTS[0] + 12, BAR16 * 2.4, 1.3);
      strings(t0, [50, 57, 62, 65, 69], BAR16 * 2.6, 1.6, 2600);
      sub(t0, ROOTS[0], BAR16 * 2, 1, ROOTS[0] + 12);
      taiko(t0 + BEAT16 * 2, 0.8);
      taiko(t0 + BEAT16 * 3, 0.9);
      taiko(t0 + BAR16, 1.1, 0.8);
    }
  });
  return END;
}
