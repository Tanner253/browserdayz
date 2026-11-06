// The thirtieth film's score ("The way down", shots30.ts): its own, written here, 96 beats a minute in D minor, bars of
// 2.5 s so every cut lands on one. It follows the shots' kinds (frame28's marks): a clock and a pulse at the door
// (dread), the pulse and a bass through the stops (tight, sneak), the tune and the whole band from the train on (march,
// tour), one chord on the cards (end). The owner on the first draft: "no music?". It had been a drone and a heartbeat
// under 100 Hz, which a phone or a laptop does not play: everything here that carries the tune is between 200 Hz and
// 4 kHz, and the low end only sits under it.

export const BPM30 = 96;
export const BEAT30 = 60 / BPM30;
export const BAR30 = BEAT30 * 4;

export interface Mark30 { at: number; len: number; kind: string; under?: boolean; hit?: boolean }

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
/** how much of the band each kind of shot has: clock, pulse, bass, drums, pad, tune */
const BAND: Record<string, [number, number, number, number, number, number]> = {
  dread: [1, 0.7, 0.35, 0, 0.5, 0],
  loot: [0.8, 0.85, 0.5, 0, 0.6, 0],
  sneak: [0.5, 0.9, 0.8, 0.55, 0.7, 0.6],
  tight: [0.5, 1, 1, 0.75, 0.75, 0.75],
  march: [0, 1, 1, 1, 0.9, 1],
  tour: [0, 1, 1, 1, 1, 1],
  end: [0, 0.4, 0.4, 0, 1, 0.6],
};
/** the four bars that go round: Dm, Bb, F, C; the bass's note, the pad's, and the pulse's (eighths) */
const ROUND: { root: number; pad: number[]; arp: number[] }[] = [
  { root: 38, pad: [57, 62, 65, 69], arp: [62, 65, 69, 74, 69, 65, 62, 65] },
  { root: 34, pad: [58, 62, 65, 70], arp: [58, 62, 65, 70, 65, 62, 58, 62] },
  { root: 41, pad: [57, 60, 65, 69], arp: [60, 65, 69, 72, 69, 65, 60, 65] },
  { root: 36, pad: [55, 60, 64, 67], arp: [60, 64, 67, 72, 67, 64, 60, 64] },
];
/** the tune over two rounds (eight bars): [beat in the eight bars, note, beats long] */
const TUNE: [number, number, number][] = [
  [0, 74, 1.5], [1.5, 77, 0.5], [2, 76, 1], [3, 74, 1], [4, 70, 2], [6, 69, 1], [7, 70, 1],
  [8, 72, 1.5], [9.5, 69, 0.5], [10, 72, 2], [12, 67, 2], [14, 69, 2],
  [16, 74, 1.5], [17.5, 77, 0.5], [18, 81, 1], [19, 79, 1], [20, 77, 2], [22, 74, 1], [23, 77, 1],
  [24, 76, 1.5], [25.5, 74, 0.5], [26, 72, 2], [28, 74, 4],
];

export function scoreMusic30(ctx: BaseAudioContext, out: AudioNode, marks: Mark30[], seconds: number) {
  const master = ctx.createGain();
  master.gain.value = 0.8;
  const press = ctx.createDynamicsCompressor();
  press.threshold.value = -18;
  press.ratio.value = 3.5;
  press.attack.value = 0.006;
  press.release.value = 0.18;
  master.connect(press).connect(out);
  // (a room: everything but the low end is sent to it)
  const room = ctx.createConvolver(), wet = ctx.createGain();
  {
    const n = Math.floor(ctx.sampleRate * 2.4), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    }
    room.buffer = b;
  }
  wet.gain.value = 0.3;
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
    return { b: BAND[m?.kind ?? 'dread'] ?? BAND.dread, under: !!m?.under, m };
  };
  const last = marks[marks.length - 1];

  const clockBus = bus(0.5), pulse = bus(0.34), bass = bus(0.42, false), drums = bus(0.62), pad = bus(0.2), tune = bus(0.3), hits = bus(0.6), wheels = bus(0.3);

  // ------------------------------------------------------------ the voices
  const env = (g: GainNode, t: number, peak: number, attack: number, hold: number, release: number) => {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.linearRampToValueAtTime(0, t + attack + hold + release);
  };
  const thump = (t: number, f0: number, f1: number, len: number, g: number, to: AudioNode) => {
    const o = ctx.createOscillator(), e = ctx.createGain();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + len * 0.5);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(g, t + 0.003);
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
  /** two saws a hair apart through a low-pass that opens on the note and closes */
  const saw = (t: number, f: number, len: number, g: number, cut: number, to: AudioNode, attack = 0.005, release = 0.1, open = 0, type: OscillatorType = 'sawtooth') => {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), fl = ctx.createBiquadFilter(), e = ctx.createGain();
    o.type = o2.type = type;
    o.frequency.value = f;
    o2.frequency.value = f * 1.005;
    fl.type = 'lowpass';
    fl.Q.value = 2;
    fl.frequency.setValueAtTime(cut + open, t);
    fl.frequency.exponentialRampToValueAtTime(cut, t + Math.min(len, 0.18));
    env(e, t, g, attack, Math.max(0, len - attack - release), release);
    o.connect(fl);
    o2.connect(fl);
    fl.connect(e).connect(to);
    o.start(t);
    o2.start(t);
    o.stop(t + len + 0.05);
    o2.stop(t + len + 0.05);
  };
  /** a bell for the tune: a sine and its bright partials, struck and let ring */
  const bell = (t: number, f: number, len: number, g: number) => {
    for (const [mul, share, decay] of [[1, 1, 1], [2, 0.35, 0.5], [3.01, 0.18, 0.3], [4.2, 0.08, 0.2]] as [number, number, number][]) {
      const o = ctx.createOscillator(), e = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f * mul;
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(g * share, t + 0.006);
      e.gain.exponentialRampToValueAtTime(0.0006, t + Math.max(0.3, len * 1.6) * decay + 0.15);
      o.connect(e).connect(tune);
      o.start(t);
      o.stop(t + len * 1.6 + 0.4);
    }
    // (and a saw under it, held, so the tune is a voice and not only a strike)
    saw(t, f, len * 0.95, g * 0.22, 2200, tune, 0.03, 0.15);
  };

  // ------------------------------------------------------------ bar by bar
  const bars = Math.ceil(seconds / BAR30);
  for (let k = 0; k < bars; k++) {
    const t0 = k * BAR30, R = ROUND[k % 4];
    for (let q = 0; q < 16; q++) {
      const t = t0 + (q * BEAT30) / 4;
      if (t > seconds - 0.05) break;
      const { b, under, m } = band(t), u = under ? 0.7 : 1;
      // (the last shot holds one chord, rung once below: nothing else under the card)
      if (m === last && m?.kind === 'end' && t >= last.at) continue;
      // the clock: a dry tick on each beat, the off-beat a softer tock (a pipe struck, far off)
      if (b[0] > 0 && q % 4 === 0) {
        hiss(t, 0.05, 0.9 * b[0] * u, 'bandpass', q % 8 === 0 ? 1700 : 1250, 6, clockBus);
        thump(t, q % 8 === 0 ? 220 : 180, 120, 0.12, 0.35 * b[0] * u, clockBus);
      }
      // the pulse: the chord broken in eighths, bright at the front of each note
      if (b[1] > 0 && q % 2 === 0) saw(t, hz(R.arp[q / 2]), BEAT30 / 2 - 0.03, 0.5 * b[1] * u, 900 + 900 * b[1], pulse, 0.004, 0.06, 1800, 'square');
      // the bass: the root in eighths, an octave lift on the last of each beat, its saw heard well above its sub
      if (b[2] > 0 && q % 2 === 0) {
        const n = R.root + (q % 4 === 2 && b[2] > 0.7 ? 12 : 0);
        saw(t, hz(n), BEAT30 / 2 - 0.02, 0.7 * b[2] * u, 700, bass, 0.004, 0.05, 1400);
        thump(t, hz(n - 12) * 1.02, hz(n - 12), BEAT30 / 2, 0.5 * b[2] * u, bass);
      }
      // drums: kick on the beat with a click to it, the snare on two and four, hats on the eighths, a tom fill every fourth bar
      if (b[3] > 0) {
        if (q % 4 === 0) {
          thump(t, 150, 50, 0.32, 1.1 * b[3] * u, drums);
          hiss(t, 0.02, 0.5 * b[3] * u, 'highpass', 2500, 0.7, drums);
        }
        if (q === 4 || q === 12) {
          hiss(t, 0.2, 0.9 * b[3] * u, 'bandpass', 2100, 0.9, drums);
          hiss(t, 0.12, 0.45 * b[3] * u, 'highpass', 6000, 0.7, drums);
          thump(t, 230, 170, 0.1, 0.45 * b[3] * u, drums);
        }
        if (q % 2 === 0) hiss(t, q % 4 === 2 ? 0.08 : 0.04, (q % 4 === 2 ? 0.4 : 0.25) * b[3] * u, 'highpass', 8500, 0.7, drums);
        if (b[3] >= 1 && k % 4 === 3 && q >= 12) thump(t, 260 - (q - 12) * 40, 110, 0.22, 0.6 * u, drums);
      }
      // the pad: the bar's chord, held, swelling in
      if (b[4] > 0 && q === 0) for (const n of R.pad) saw(t, hz(n), BAR30 + 0.06, 0.18 * b[4] * u, 1600 + 800 * b[4], pad, 0.45, 0.4);
    }
  }
  // the tune: from the first shot that has it, round and round, bar-true
  {
    const first = marks.find((m) => (BAND[m.kind] ?? BAND.dread)[5] > 0);
    if (first) {
      const start = Math.round(first.at / BAR30) * BAR30;
      for (let r = start; r < seconds; r += 8 * BAR30) {
        for (const [beat, n, len] of TUNE) {
          const t = r + beat * BEAT30;
          if (t > seconds - 0.1) break;
          const { b, under, m } = band(t);
          if (b[5] <= 0 || (m === last && t >= last.at)) continue;
          bell(t, hz(n), len * BEAT30, 0.42 * b[5] * (under ? 0.7 : 1));
        }
      }
    }
  }

  // ------------------------------------------------------------ the cuts that land: a low blow with a body to it, and the air after
  const braam = (t: number, g: number, len = 1.8) => {
    thump(t, 95, 38, len, 0.9 * g, hits);
    for (const n of [38, 45, 50]) {
      const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), e = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = hz(n);
      fl.type = 'lowpass';
      fl.Q.value = 3;
      fl.frequency.setValueAtTime(300, t);
      fl.frequency.exponentialRampToValueAtTime(2400, t + 0.12);
      fl.frequency.exponentialRampToValueAtTime(280, t + len);
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(0.32 * g, t + 0.02);
      e.gain.exponentialRampToValueAtTime(0.0008, t + len);
      o.connect(fl).connect(e).connect(hits);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    hiss(t, len * 0.8, 0.45 * g, 'lowpass', 3000, 0.5, hits);
  };
  for (const m of marks) if (m.hit) braam(m.at, 1);
  // risers into the train and into the cards: air rising through the bar before
  for (const [i, m] of marks.entries()) {
    if ((m.kind !== 'march' && m.kind !== 'end') || (i > 0 && marks[i - 1].kind === m.kind)) continue;
    const t = m.at - BAR30, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), e = ctx.createGain();
    s.buffer = noiseBuf;
    s.loop = true;
    fl.type = 'bandpass';
    fl.Q.value = 2.5;
    fl.frequency.setValueAtTime(400, t);
    fl.frequency.exponentialRampToValueAtTime(6000, m.at);
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(0.5, m.at - 0.02);
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
    fl.frequency.value = 420;
    e.gain.setValueAtTime(0, m.at);
    e.gain.linearRampToValueAtTime(0.9, m.at + 0.15);
    e.gain.setValueAtTime(0.9, m.at + m.len - 0.2);
    e.gain.linearRampToValueAtTime(0, m.at + m.len);
    s.connect(fl).connect(e).connect(wheels);
    s.start(m.at);
    s.stop(m.at + m.len + 0.05);
    for (let t = m.at + 0.11; t < m.at + m.len - 0.1; t += 0.62) {
      hiss(t, 0.09, 0.8, 'bandpass', 1100, 2, wheels);
      hiss(t + 0.13, 0.09, 0.6, 'bandpass', 950, 2, wheels);
    }
  }
  // the end: the last chord rung once, the blow under it, and everything let go
  if (last) {
    braam(last.at, 0.9, 3.2);
    for (const n of [50, 57, 62, 65, 69]) saw(last.at, hz(n), Math.min(last.len, 4.6), 0.16, 1500, pad, 0.02, 2.4);
    bell(last.at, hz(74), 3, 0.5);
  }
}
