// The thirtieth film's score ("The way down", shots30.ts): its own, written here, 96 beats a minute in D minor, bars of
// 2.5 s so every cut lands on one. It follows the shots' kinds (frame28's marks): a drone and a heartbeat at the door
// (dread), ticks by torchlight, a bass that drives through the stops (tight, sneak), the whole band from the train on
// (march, tour), one chord on the cards (end). The train's wheels and the hits on the cuts are part of it. Nobody has
// heard it: its levels are set by the numbers the render prints.

export const BPM30 = 96;
export const BEAT30 = 60 / BPM30;
export const BAR30 = BEAT30 * 4;

export interface Mark30 { at: number; len: number; kind: string; under?: boolean; hit?: boolean }

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
/** how much of the band each kind of shot has: drone, heart, ticks, bass, drums, pad, stabs */
const BAND: Record<string, [number, number, number, number, number, number, number]> = {
  dread: [1, 1, 0, 0, 0, 0.25, 0],
  loot: [0.8, 0.6, 0.6, 0, 0, 0.35, 0],
  sneak: [0.8, 0, 0.8, 0.7, 0.35, 0.5, 0],
  tight: [0.8, 0, 0.9, 1, 0.6, 0.6, 0],
  march: [0.7, 0, 1, 1, 1, 0.8, 0.8],
  tour: [0.7, 0, 1, 1, 1, 1, 1],
  end: [0.9, 0, 0, 0, 0, 0.9, 0],
};
/** the four bars that go round: Dm, Bb, F, C (roots, and the pad's notes) */
const ROUND: { root: number; pad: number[] }[] = [
  { root: 38, pad: [50, 53, 57, 62] },
  { root: 34, pad: [50, 53, 58, 62] },
  { root: 41, pad: [48, 53, 57, 60] },
  { root: 36, pad: [48, 52, 55, 60] },
];

export function scoreMusic30(ctx: BaseAudioContext, out: AudioNode, marks: Mark30[], seconds: number) {
  const master = ctx.createGain();
  master.gain.value = 0.55;
  const press = ctx.createDynamicsCompressor();
  press.threshold.value = -16;
  press.ratio.value = 3;
  press.attack.value = 0.01;
  press.release.value = 0.2;
  master.connect(press).connect(out);
  // (a small room: everything but the sub is sent to it)
  const room = ctx.createConvolver(), wet = ctx.createGain();
  {
    const n = Math.floor(ctx.sampleRate * 2.2), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    room.buffer = b;
  }
  wet.gain.value = 0.22;
  room.connect(wet).connect(master);
  const bus = (gain: number, toRoom = true) => {
    const g = ctx.createGain();
    g.gain.value = gain;
    g.connect(master);
    if (toRoom) g.connect(room);
    return g;
  };
  const noiseBuf = (() => {
    const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  })();
  const markAt = (t: number) => marks.find((m) => t >= m.at - 1e-6 && t < m.at + m.len - 1e-6) ?? marks[marks.length - 1];
  const band = (t: number) => {
    const m = markAt(t);
    const b = BAND[m?.kind ?? 'dread'] ?? BAND.dread;
    return { b, under: !!m?.under, m };
  };

  // ------------------------------------------------------------ the parts
  const drone = bus(0.32, false), pad = bus(0.16), heart = bus(0.55, false), ticks = bus(0.09), bass = bus(0.3, false), drums = bus(0.5), stabs = bus(0.13), hits = bus(0.6), wheels = bus(0.22);

  /** the drone: a low D held all the way, its level following the shots */
  {
    const lvl = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    lvl.gain.value = 0;
    for (const [f, type, g] of [[hz(26), 'sine', 0.8], [hz(38), 'sawtooth', 0.22], [hz(38) * 1.004, 'sawtooth', 0.22], [hz(45), 'sine', 0.18]] as [number, OscillatorType, number][]) {
      const o = ctx.createOscillator(), e = ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      e.gain.value = g;
      o.connect(e).connect(lp);
      o.start(0);
      o.stop(seconds + 0.1);
    }
    lp.connect(lvl).connect(drone);
    for (let t = 0; t < seconds; t += BEAT30) {
      const { b, under } = band(t);
      lvl.gain.setTargetAtTime(b[0] * (under ? 0.7 : 1), t, 0.4);
    }
    lvl.gain.setTargetAtTime(0, seconds - 1.2, 0.3);
  }

  const thump = (t: number, f0: number, f1: number, len: number, g: number, to: AudioNode) => {
    const o = ctx.createOscillator(), e = ctx.createGain();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + len * 0.6);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(g, t + 0.004);
    e.gain.exponentialRampToValueAtTime(0.0008, t + len);
    o.connect(e).connect(to);
    o.start(t);
    o.stop(t + len + 0.05);
  };
  const hiss = (t: number, len: number, g: number, type: BiquadFilterType, f: number, q: number, to: AudioNode, attack = 0.002) => {
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), e = ctx.createGain();
    s.buffer = noiseBuf;
    fl.type = type;
    fl.frequency.value = f;
    fl.Q.value = q;
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(g, t + attack);
    e.gain.exponentialRampToValueAtTime(0.0008, t + len);
    s.connect(fl).connect(e).connect(to);
    s.start(t, Math.random() * 1.5);
    s.stop(t + len + 0.05);
  };
  const saw = (t: number, f: number, len: number, g: number, cut: number, to: AudioNode, attack = 0.01, release = 0.12, sweep = 0) => {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), fl = ctx.createBiquadFilter(), e = ctx.createGain();
    o.type = o2.type = 'sawtooth';
    o.frequency.value = f;
    o2.frequency.value = f * 1.006;
    fl.type = 'lowpass';
    fl.frequency.setValueAtTime(cut + sweep, t);
    fl.frequency.exponentialRampToValueAtTime(cut, t + Math.min(len, 0.25));
    fl.Q.value = 1.2;
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(g, t + attack);
    e.gain.setValueAtTime(g, t + Math.max(attack, len - release));
    e.gain.linearRampToValueAtTime(0, t + len);
    o.connect(fl);
    o2.connect(fl);
    fl.connect(e).connect(to);
    o.start(t);
    o2.start(t);
    o.stop(t + len + 0.05);
    o2.stop(t + len + 0.05);
  };

  // ------------------------------------------------------------ bar by bar
  const bars = Math.ceil(seconds / BAR30);
  for (let k = 0; k < bars; k++) {
    const t0 = k * BAR30, R = ROUND[k % 4];
    for (let q = 0; q < 16; q++) {
      const t = t0 + (q * BEAT30) / 4;
      if (t > seconds - 0.05) break;
      const { b, under, m } = band(t), u = under ? 0.55 : 1, last = m && t > m.at + m.len - BEAT30 * 0.6 && m === marks[marks.length - 1];
      if (last) continue;
      // the heart: lub-dub on the bar's first beat and its third
      if (b[1] > 0 && (q === 0 || q === 8)) {
        thump(t, 70, 42, 0.32, 0.9 * b[1] * u, heart);
        thump(t + 0.19, 64, 40, 0.28, 0.6 * b[1] * u, heart);
      }
      // ticks: eighths, the off ones softer
      if (b[2] > 0 && q % 2 === 0) hiss(t, 0.035, (q % 4 === 0 ? 0.9 : 0.55) * b[2] * u, 'highpass', 7000, 0.7, ticks);
      // the bass: sixteenths on the root, the last of each beat an octave up
      if (b[3] > 0) saw(t, hz(R.root - 12 + (q % 4 === 3 ? 12 : 0)), BEAT30 / 4 - 0.01, 0.9 * b[3] * u, 240, bass, 0.004, 0.04, 900);
      // drums: a kick on each beat, the snare on two and four once the band is whole, a fill of toms every second bar's end
      if (b[4] > 0) {
        if (q % 4 === 0) thump(t, 140, 46, 0.34, 1.1 * b[4] * u, drums);
        if (b[4] >= 1 && (q === 4 || q === 12)) {
          hiss(t, 0.22, 0.75 * u, 'bandpass', 1900, 0.8, drums);
          thump(t, 210, 150, 0.12, 0.35 * u, drums);
        }
        if (b[4] >= 1 && k % 2 === 1 && q >= 13) thump(t, 170 - (q - 13) * 30, 70, 0.25, 0.55 * u, drums);
        if (b[4] >= 1 && q % 2 === 1) hiss(t, 0.05, 0.25 * u, 'highpass', 8000, 0.7, drums);
      }
      // the pad: the bar's chord, held, swelling in
      if (b[5] > 0 && q === 0) for (const n of R.pad) saw(t, hz(n), BAR30 + 0.05, 0.22 * b[5] * u, 1100, pad, 0.5, 0.4);
      // stabs: the chord, short and bright, on the bar's first beat and the and of two
      if (b[6] > 0 && (q === 0 || q === 6)) for (const n of R.pad) saw(t, hz(n + 12), 0.28, 0.3 * b[6] * u, 1800, stabs, 0.005, 0.1, 2600);
    }
  }

  // ------------------------------------------------------------ the cuts that land: a low blow and the air after it
  for (const m of marks) {
    if (!m.hit) continue;
    thump(m.at, 90, 30, 1.6, 1, hits);
    hiss(m.at, 1.4, 0.5, 'lowpass', 2400, 0.5, hits);
  }
  // risers into the train and into the cards: air rising through the bar before
  for (const m of marks) {
    if (m.kind !== 'march' && m.kind !== 'end') continue;
    if (marks.indexOf(m) > 0 && marks[marks.indexOf(m) - 1].kind === m.kind) continue;
    const t = m.at - BAR30, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), e = ctx.createGain();
    s.buffer = noiseBuf;
    s.loop = true;
    fl.type = 'bandpass';
    fl.Q.value = 2.5;
    fl.frequency.setValueAtTime(300, t);
    fl.frequency.exponentialRampToValueAtTime(5200, m.at);
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(0.35, m.at - 0.02);
    e.gain.linearRampToValueAtTime(0, m.at + 0.03);
    s.connect(fl).connect(e).connect(hits);
    s.start(t);
    s.stop(m.at + 0.1);
  }
  // the train's wheels: its weight under everything, and the rail joints going by
  for (const m of marks) {
    if (m.kind !== 'march') continue;
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), e = ctx.createGain();
    s.buffer = noiseBuf;
    s.loop = true;
    fl.type = 'lowpass';
    fl.frequency.value = 180;
    e.gain.setValueAtTime(0, m.at);
    e.gain.linearRampToValueAtTime(1.2, m.at + 0.15);
    e.gain.setValueAtTime(1.2, m.at + m.len - 0.2);
    e.gain.linearRampToValueAtTime(0, m.at + m.len);
    s.connect(fl).connect(e).connect(wheels);
    s.start(m.at);
    s.stop(m.at + m.len + 0.05);
    for (let t = m.at + 0.11; t < m.at + m.len - 0.1; t += 0.62) {
      hiss(t, 0.09, 0.7, 'bandpass', 900, 2, wheels);
      hiss(t + 0.13, 0.09, 0.55, 'bandpass', 800, 2, wheels);
    }
  }
  // the end: the last chord rung once, and the drone let go
  {
    const m = marks[marks.length - 1];
    if (m) {
      thump(m.at, 80, 28, 3, 0.9, hits);
      for (const n of [38, 50, 53, 57, 62]) saw(m.at, hz(n), Math.min(m.len, 4.5), n === 38 ? 0.3 : 0.16, 900, pad, 0.02, 2.2);
    }
  }
}
