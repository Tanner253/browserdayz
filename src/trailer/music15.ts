// The fifteenth film's score ("Emotes", shots15.ts): club music, made here from nothing but oscillators and noise, as
// every score of these films is. The owner, 2026-10-15: "dance music, hype". A minor, Am F C G, 128 beats to the
// minute, four on the floor: a filtered opening on Balloon, a rise, a drop of a bar to each dance, a short break,
// the last drop with the whole cast, and a hit to end on.
export const BPM15 = 128;
export const BEAT15 = 60 / BPM15;
export const BAR15 = BEAT15 * 4;

/** what each bar of the film is, in order (see shots15.ts) */
export type Part15 = 'intro' | 'rise' | 'drop' | 'break' | 'final' | 'end';
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
// Am, F, C, G: the low note and the chord of each, a bar apiece
const ROOTS = [45, 41, 48, 43];
const CHORDS = [[57, 60, 64], [57, 60, 65], [55, 60, 64], [55, 59, 62]];
// the hook over the drops: [eighth of the bar, midi, eighths long], two bars of it
const HOOK: [number, number, number][][] = [
  [[0, 76, 1], [1, 76, 1], [3, 74, 1], [4, 72, 2], [6, 74, 1], [7, 76, 1]],
  [[0, 77, 2], [3, 76, 1], [4, 74, 2], [6, 72, 1], [7, 71, 1]],
];

export function scoreMusic15(ctx: BaseAudioContext, out: AudioNode, bars: Part15[]) {
  const END = bars.length * BAR15 + 3;
  // ------------------------------------------------------------ the desk
  const master = ctx.createGain();
  master.gain.value = 0.55;
  const squeeze = ctx.createDynamicsCompressor();
  squeeze.threshold.value = -14;
  squeeze.knee.value = 6;
  squeeze.ratio.value = 4;
  squeeze.attack.value = 0.004;
  squeeze.release.value = 0.18;
  master.connect(squeeze).connect(out);
  // a room: noise that dies away, as an impulse
  const room = ctx.createConvolver();
  {
    const len = Math.floor(ctx.sampleRate * 2.2), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    room.buffer = buf;
  }
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  room.connect(wet).connect(master);
  // everything but the kick ducks under it (the pump of a dance record)
  const pumped = ctx.createGain();
  pumped.connect(master);
  pumped.connect(room);
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

  // ------------------------------------------------------------ the players
  const kick = (t: number, v = 1) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    env(g.gain, t, 1.15 * v, 0.002, 0.38);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.45);
    // a click on its front
    const c = noiseAt(t, 0.02), cf = ctx.createBiquadFilter(), cg = ctx.createGain();
    cf.type = 'highpass';
    cf.frequency.value = 2500;
    env(cg.gain, t, 0.25 * v, 0.001, 0.015);
    c.connect(cf).connect(cg).connect(master);
    // the pump
    pumped.gain.setValueAtTime(0.3, t);
    pumped.gain.setTargetAtTime(1, t + 0.03, 0.09);
  };
  const clap = (t: number, v = 1) => {
    for (const [d, k] of [[0, 1], [0.012, 0.8], [0.024, 0.65]] as [number, number][]) {
      const s = noiseAt(t + d, 0.2), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'bandpass';
      f.frequency.value = 1300;
      f.Q.value = 0.9;
      env(g.gain, t + d, 0.5 * v * k, 0.001, d === 0.024 ? 0.17 : 0.03);
      s.connect(f).connect(g).connect(pumped);
    }
  };
  const hat = (t: number, v = 1, open = false) => {
    const s = noiseAt(t, 0.3), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'highpass';
    f.frequency.value = 7500;
    env(g.gain, t, 0.22 * v, 0.001, open ? 0.16 : 0.035);
    s.connect(f).connect(g).connect(pumped);
  };
  const bass = (t: number, midi: number, len: number, v = 1, open = 0.5) => {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(220 + 1400 * open, t);
    f.frequency.exponentialRampToValueAtTime(180, t + len);
    env(g.gain, t, 0.32 * v, 0.004, len);
    for (const [det, type] of [[0, 'sawtooth'], [-9, 'sawtooth'], [-1200, 'sine']] as [number, OscillatorType][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz(midi);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    f.connect(g).connect(pumped);
  };
  /** a chord of seven saws a note, spread: held (a pad) or short (a stab) */
  const chord = (t: number, notes: number[], len: number, v = 1, cutoff = 4200) => {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.Q.value = 1.2;
    const a = len > 1 ? 0.25 : 0.004;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06 * v, t + a);
    g.gain.setValueAtTime(0.06 * v, t + Math.max(a, len - 0.08));
    g.gain.linearRampToValueAtTime(0, t + len);
    for (const n of notes) for (const det of [-22, -13, -6, 0, 6, 13, 22]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(n);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    f.connect(g).connect(pumped);
  };
  const lead = (t: number, midi: number, len: number, v = 1) => {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(5200, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + len);
    env(g.gain, t, 0.1 * v, 0.003, len * 0.95);
    for (const [det, type] of [[0, 'square'], [12, 'sawtooth'], [1200, 'sine']] as [number, OscillatorType][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz(midi);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    f.connect(g).connect(pumped);
  };
  /** the air rising over a stretch, with a snare rolling faster toward its end, and the kick gone for its last bar */
  const rise = (t: number, len: number) => {
    const s = noiseAt(t, len), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(9000, t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + len);
    g.gain.linearRampToValueAtTime(0, t + len + 0.02);
    s.connect(f).connect(g).connect(master);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(880, t + len);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.05, t + len);
    og.gain.linearRampToValueAtTime(0, t + len + 0.02);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + len + 0.05);
    // the roll: quarters, then eighths, then sixteenths
    for (let k = 0, at = t; at < t + len - 0.01; k++) {
      const left = (t + len - at) / len, step = left > 0.5 ? BEAT15 : left > 0.25 ? BEAT15 / 2 : BEAT15 / 4;
      clap(at, 0.35 + 0.65 * (1 - left));
      at += step;
    }
  };
  /** the blow at a drop: a crash and the floor falling away under it */
  const impact = (t: number) => {
    const s = noiseAt(t, 2), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'highpass';
    f.frequency.value = 3000;
    env(g.gain, t, 0.3, 0.002, 1.6);
    s.connect(f).connect(g).connect(master);
    s.connect(f).connect(g).connect(room);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 1.2);
    env(og.gain, t, 0.9, 0.002, 1.3);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + 1.4);
  };

  // ------------------------------------------------------------ the arrangement, bar by bar
  bars.forEach((part, b) => {
    const t0 = b * BAR15, k = b % 4, was = bars[b - 1];
    const lastOfRise = part === 'rise' && bars[b + 1] !== 'rise';
    if ((part === 'drop' || part === 'final') && was !== part) impact(t0);
    for (let beat = 0; beat < 4; beat++) {
      const t = t0 + beat * BEAT15;
      if (part === 'intro') {
        if (b >= 2) kick(t, 0.8);
        hat(t + BEAT15 / 2, 0.6);
      } else if (part === 'rise') {
        if (!lastOfRise) kick(t, 0.9);
      } else if (part === 'drop' || part === 'final') {
        kick(t);
        hat(t + BEAT15 / 2, 1, beat % 2 === 1);
        hat(t + BEAT15 / 4, 0.35);
        hat(t + (BEAT15 * 3) / 4, 0.35);
        if (beat % 2 === 1) clap(t);
      } else if (part === 'break') {
        if (beat % 2 === 0) kick(t, 0.85);
        if (beat % 2 === 1) clap(t, 0.8);
        hat(t + BEAT15 / 2, 0.7);
      }
    }
    if (part === 'rise' && was !== 'rise') rise(t0, bars.slice(b).findIndex((p) => p !== 'rise') * BAR15);
    // the pad: through the opening and the rise, its filter opening as they go
    if (part === 'intro' || part === 'rise') chord(t0, CHORDS[k], BAR15, 1.4, part === 'intro' ? 500 + b * 260 : 1600 + (b % 2) * 900);
    // the bass: on every off-beat eighth from the drops on; in the opening, a held low note once the kick is in
    if (part === 'drop' || part === 'final' || part === 'break') for (let e = 0; e < 8; e++) bass(t0 + e * (BEAT15 / 2) + (e % 2 ? 0 : BEAT15 / 4), ROOTS[k] + (e === 7 ? 7 : 0), BEAT15 * 0.42, 1, part === 'break' ? 0.25 : 0.6);
    else if (part === 'intro' && b >= 2) bass(t0, ROOTS[k], BAR15 * 0.9, 0.6, 0.1);
    // the stabs: the chord on the off-beats of the drops
    if (part === 'drop' || part === 'final') for (let e = 0; e < 8; e++) if (e % 2 === 1 || e === 0) chord(t0 + e * (BEAT15 / 2), CHORDS[k], BEAT15 * 0.3, 0.9);
    // the hook: over the last drop, and every other pair of bars of the first
    if (part === 'final' || (part === 'drop' && Math.floor(b / 2) % 2 === 1)) for (const [e, n, l] of HOOK[b % 2]) lead(t0 + e * (BEAT15 / 2), n, l * (BEAT15 / 2) * 0.9);
    // the end: one hit of everything, and the room ringing after it
    if (part === 'end' && was !== 'end') {
      impact(t0);
      kick(t0, 1.2);
      chord(t0, [57, 60, 64, 69], BAR15 * 1.5, 1.6, 3000);
      bass(t0, 33, BAR15, 1, 0.3);
    }
  });
  return END;
}
