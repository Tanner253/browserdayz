// The twenty-ninth film's song, "Friendly" (shots29.ts): hardbass, made here from nothing but oscillators and noise, as
// every score of these films is. 165 beats a minute, four on the floor, a bass on every off-beat and a hoover playing
// Korobeiniki (a Russian song of 1861, nobody's now): the music of the car parks of the country this map looks like. Two
// hooks are stopped dead by a gunshot; the last one comes in on one.
export const BPM29 = 165;
export const BEAT29 = 60 / BPM29;
export const BAR29 = BEAT29 * 4;

/** what each bar of the song is, in order */
export type Part29 = 'intro' | 'rise' | 'hook' | 'verse' | 'bridge' | 'hold' | 'final' | 'end';
export const SONG: Part29[] = [
  'intro', 'intro', 'intro', 'rise',
  'hook', 'hook', 'hook', 'hook', 'hook', 'hook', 'hook', 'hook',
  'verse', 'verse', 'verse', 'verse', 'verse', 'verse', 'verse', 'verse',
  'hook', 'hook', 'hook', 'hook', 'hook', 'hook', 'hook', 'hook',
  'bridge', 'bridge', 'bridge', 'bridge',
  'hold', 'hold',
  'final', 'final', 'final', 'final', 'end', 'end', 'end',
];
/** the shots that are in the song: seconds into it, each a crack and everything stopped for what is left of that bar */
export const stops: number[] = [];

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
// the tune, eight bars of it: [eighth of the bar, midi, eighths long]
const TUNE: [number, number, number][][] = [
  [[0, 76, 2], [2, 71, 1], [3, 72, 1], [4, 74, 2], [6, 72, 1], [7, 71, 1]],
  [[0, 69, 2], [2, 69, 1], [3, 72, 1], [4, 76, 2], [6, 74, 1], [7, 72, 1]],
  [[0, 71, 3], [3, 72, 1], [4, 74, 2], [6, 76, 2]],
  [[0, 72, 2], [2, 69, 2], [4, 69, 3]],
  [[1, 74, 2], [3, 77, 1], [4, 81, 2], [6, 79, 1], [7, 77, 1]],
  [[0, 76, 3], [3, 72, 1], [4, 76, 2], [6, 74, 1], [7, 72, 1]],
  [[0, 71, 2], [2, 71, 1], [3, 72, 1], [4, 74, 2], [6, 76, 2]],
  [[0, 72, 2], [2, 69, 2], [4, 69, 3]],
];
const ROOTS = [33, 33, 40, 33, 38, 36, 40, 33];
const CHORDS = [[57, 60, 64], [57, 60, 64], [56, 59, 64], [57, 60, 64], [57, 62, 65], [55, 60, 64], [56, 59, 64], [57, 60, 64]];

export function scoreMusic29(ctx: BaseAudioContext, out: AudioNode) {
  // ------------------------------------------------------------ the desk
  const master = ctx.createGain();
  master.gain.value = 0.62;
  const squeeze = ctx.createDynamicsCompressor();
  squeeze.threshold.value = -12;
  squeeze.knee.value = 6;
  squeeze.ratio.value = 5;
  squeeze.attack.value = 0.003;
  squeeze.release.value = 0.14;
  master.connect(squeeze).connect(out);
  const room = ctx.createConvolver();
  {
    const len = Math.floor(ctx.sampleRate * 1.4), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.6);
    }
    room.buffer = buf;
  }
  const wet = ctx.createGain();
  wet.gain.value = 0.16;
  room.connect(wet).connect(master);
  // all but the kick and the shots: pumped by the kick, and cut by a shot
  const pumped = ctx.createGain();
  const stopped = ctx.createGain();
  pumped.connect(stopped);
  stopped.connect(master);
  stopped.connect(room);
  // the kick has its own way in, so that a stop stops it too
  const drums = ctx.createGain();
  drums.connect(master);
  // a hard edge on the hoover, as a cheap keyboard through a cheap amplifier has
  const edge = ctx.createWaveShaper();
  {
    const c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 511.5 - 1) * 2.6;
      c[i] = Math.tanh(x);
    }
    edge.curve = c;
    edge.oversample = '2x';
  }
  const leadBus = ctx.createGain();
  leadBus.gain.value = 0.2;
  edge.connect(leadBus).connect(pumped);

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
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + a);
    g.exponentialRampToValueAtTime(0.0001, t + a + d);
  };

  // ------------------------------------------------------------ the players
  const kick = (t: number, v = 1) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.08);
    env(g.gain, t, 1.25 * v, 0.002, 0.24);
    o.connect(g).connect(drums);
    o.start(t);
    o.stop(t + 0.3);
    const c = noiseAt(t, 0.02), cf = ctx.createBiquadFilter(), cg = ctx.createGain();
    cf.type = 'highpass';
    cf.frequency.value = 2200;
    env(cg.gain, t, 0.3 * v, 0.001, 0.016);
    c.connect(cf).connect(cg).connect(drums);
    pumped.gain.setValueAtTime(0.35, t);
    pumped.gain.setTargetAtTime(1, t + 0.02, 0.06);
  };
  const clap = (t: number, v = 1) => {
    for (const [d, k] of [[0, 1], [0.011, 0.8], [0.022, 0.65]] as [number, number][]) {
      const s = noiseAt(t + d, 0.16), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'bandpass';
      f.frequency.value = 1500;
      f.Q.value = 0.9;
      env(g.gain, t + d, 0.5 * v * k, 0.001, d === 0.022 ? 0.13 : 0.025);
      s.connect(f).connect(g).connect(pumped);
    }
  };
  const hat = (t: number, v = 1, open = false) => {
    const s = noiseAt(t, 0.2), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'highpass';
    f.frequency.value = 8000;
    env(g.gain, t, 0.2 * v, 0.001, open ? 0.12 : 0.03);
    s.connect(f).connect(g).connect(pumped);
  };
  /** the off-beat bass: a short fat saw, the whole of the style */
  const bass = (t: number, midi: number, len: number, v = 1, open = 0.6) => {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass';
    f.Q.value = 7;
    f.frequency.setValueAtTime(260 + 1500 * open, t);
    f.frequency.exponentialRampToValueAtTime(190, t + len);
    env(g.gain, t, 0.36 * v, 0.003, len);
    for (const [det, type] of [[0, 'sawtooth'], [-11, 'sawtooth'], [1200, 'square']] as [number, OscillatorType][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz(midi);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + len + 0.04);
    }
    f.connect(g).connect(pumped);
  };
  /** the hoover: detuned saws sliding up into each note, an octave under them */
  const hoover = (t: number, midi: number, len: number, v = 1) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.012);
    g.gain.setValueAtTime(v, t + Math.max(0.02, len - 0.04));
    g.gain.linearRampToValueAtTime(0.0001, t + len);
    for (const [det, type] of [[-28, 'sawtooth'], [-9, 'sawtooth'], [11, 'sawtooth'], [27, 'sawtooth'], [-1200, 'square']] as [number, OscillatorType][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(hz(midi - 2), t);
      o.frequency.exponentialRampToValueAtTime(hz(midi), t + 0.03);
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(t + len + 0.03);
    }
    g.connect(edge);
  };
  /** a lone plucked string, for the morning on the beach */
  const pluck = (t: number, midi: number, len: number, v = 1) => {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass';
    f.frequency.value = hz(midi) * 2.6;
    f.Q.value = 0.9;
    env(g.gain, t, 0.3 * v, 0.002, Math.max(0.18, len));
    for (const det of [-5, 4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(midi);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + len + 0.2);
    }
    f.connect(g).connect(pumped);
    f.connect(g).connect(room);
  };
  const stab = (t: number, notes: number[], len: number, v = 1) => {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass';
    f.frequency.value = 3400;
    env(g.gain, t, 0.05 * v, 0.003, len);
    for (const n of notes) for (const det of [-14, 0, 14]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(n);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + len + 0.03);
    }
    f.connect(g).connect(pumped);
  };
  const rise = (t: number, len: number) => {
    const s = noiseAt(t, len), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(9000, t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + len);
    g.gain.linearRampToValueAtTime(0, t + len + 0.02);
    s.connect(f).connect(g).connect(master);
    for (let at = t, k = 0; at < t + len - 0.01; k++) {
      const left = (t + len - at) / len;
      clap(at, 0.3 + 0.7 * (1 - left));
      at += left > 0.5 ? BEAT29 / 2 : BEAT29 / 4;
    }
  };
  const impact = (t: number, v = 1) => {
    const s = noiseAt(t, 1.6), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'highpass';
    f.frequency.value = 3000;
    env(g.gain, t, 0.26 * v, 0.002, 1.2);
    s.connect(f).connect(g).connect(master);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.9);
    env(og.gain, t, 0.85 * v, 0.002, 1);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + 1.1);
  };

  // ------------------------------------------------------------ the arrangement, bar by bar
  let phrase = 0;
  SONG.forEach((part, b) => {
    const t0 = b * BAR29, was = SONG[b - 1], at8 = (e: number) => t0 + e * (BEAT29 / 2);
    if ((part === 'hook' || part === 'final') && was !== part) {
      impact(t0);
      phrase = 0;
    }
    const k = phrase++ % 8;
    if (part === 'intro') {
      // the tune alone, slow, with the wind (the game's) under it
      for (const [e, n, l] of TUNE[b]) pluck(at8(e), n - 12, l * (BEAT29 / 2) * 0.95, 1);
    } else if (part === 'rise') {
      rise(t0, BAR29);
      pluck(t0, 57, 0.5);
    } else if (part === 'hook' || part === 'final') {
      for (let beat = 0; beat < 4; beat++) {
        const t = t0 + beat * BEAT29;
        kick(t);
        hat(t + BEAT29 / 2, 1, true);
        if (beat % 2 === 1) clap(t);
      }
      for (let e = 1; e < 8; e += 2) bass(at8(e), ROOTS[k] + 12, BEAT29 * 0.44);
      for (const [e, n, l] of TUNE[k]) hoover(at8(e), n, l * (BEAT29 / 2) * 0.94, 1);
      if (part === 'final') for (const [e, n, l] of TUNE[k]) hoover(at8(e), n + 12, l * (BEAT29 / 2) * 0.94, 0.5);
      stab(at8(1), CHORDS[k], 0.14);
      stab(at8(5), CHORDS[k], 0.14);
    } else if (part === 'verse') {
      // the floor only, so that every word is heard
      for (let beat = 0; beat < 4; beat++) {
        const t = t0 + beat * BEAT29;
        kick(t, 0.9);
        hat(t + BEAT29 / 2, 0.7);
      }
      for (let e = 1; e < 8; e += 2) bass(at8(e), ROOTS[k % 4 === 2 ? 2 : 0] + 12, BEAT29 * 0.4, 0.85, 0.35);
      if (k % 2 === 1) clap(t0 + BEAT29 * 3, 0.8);
    } else if (part === 'bridge') {
      // half time and low: one word to a bar
      kick(t0, 1);
      kick(t0 + BEAT29 * 2, 0.9);
      bass(t0, ROOTS[(b - 28) % 2 ? 4 : 0] + 12, BAR29 * 0.42, 0.9, 0.2);
      bass(t0 + BEAT29 * 2, ROOTS[(b - 28) % 2 ? 4 : 0] + 12, BAR29 * 0.42, 0.7, 0.2);
    } else if (part === 'hold') {
      // nearly nothing: a clock ticking, and the last bar's air
      for (let beat = 0; beat < 4; beat++) hat(t0 + beat * BEAT29, 0.5);
    } else if (part === 'end' && was !== 'end') {
      impact(t0, 1);
      kick(t0, 1.2);
      stab(t0, [45, 57, 60, 64, 69], BAR29 * 1.2, 3);
      bass(t0, 33 + 12, BAR29, 1, 0.3);
      for (let beat = 0; beat < 4; beat++) kick(t0 + BAR29 + beat * BEAT29, 0.8);
    }
  });
  // ------------------------------------------------------------ the shots: a crack, and everything stopped until the next bar
  for (const t of stops) {
    const end = Math.ceil(t / BAR29 - 1e-6) * BAR29;
    stopped.gain.setValueAtTime(1, t - 0.002);
    stopped.gain.linearRampToValueAtTime(0, t + 0.004);
    stopped.gain.setValueAtTime(0, end - 0.004);
    stopped.gain.linearRampToValueAtTime(1, end);
    drums.gain.setValueAtTime(1, t - 0.002);
    drums.gain.linearRampToValueAtTime(0, t + 0.004);
    drums.gain.setValueAtTime(0, end - 0.004);
    drums.gain.linearRampToValueAtTime(1, end);
  }
  return SONG.length * BAR29 + 1;
}

/** the crack of a shot on the beat, over everything (the game's own gunshot is laid under it from where the gun is) */
export function crack(ctx: BaseAudioContext, out: AudioNode, t: number, v = 1) {
  const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 7);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = n;
  f.type = 'lowpass';
  f.frequency.value = 5200;
  g.gain.value = 1.1 * v;
  s.connect(f).connect(g).connect(out);
  s.start(t);
  const o = ctx.createOscillator(), og = ctx.createGain();
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.16);
  og.gain.setValueAtTime(1.1 * v, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(og).connect(out);
  o.start(t);
  o.stop(t + 0.32);
}
