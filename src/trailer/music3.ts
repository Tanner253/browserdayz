// The third trailer's score. Same band as the first two (music.ts): saws through filters,
// noise for drums, all scheduled up front into the offline render; 128 beats a minute, so a
// bar is 1.875 s. This one runs eighty bars and tells a story, so it is written as one: wind
// and a heartbeat, a rifle shot into silence, a warm tune for two people who have decided
// to trust each other, a march, a fight, bells for the money, nothing at all for the walk
// before the betrayal, the tune again in the low strings, and then a long clean run under
// the part that explains how the money works, before everything comes back for the end.
// C minor.

import { BAR } from './shots';

export const BARS3 = 80;
const BEAT = BAR / 4;

type Kind = 'air' | 'chase' | 'dread' | 'void' | 'warm' | 'march' | 'build' | 'war' | 'hold' | 'tense' | 'tick' | 'bells' | 'lament' | 'slam' | 'tech' | 'top' | 'end';
interface Row {
  root: number;
  minor: boolean;
  kind: Kind;
  /** 1..4: how much of the band plays (tech, top) */
  lvl?: number;
  /** snare roll over the bar; drums out from this beat on; toms into the next bar */
  roll?: boolean;
  stop?: number;
  toms?: boolean;
}
const Cm = 36, Ab = 32, Eb = 39, Bb = 34, G = 31, Fm = 29;
const r = (root: number, kind: Kind, o: Partial<Row> = {}): Row => ({ root, minor: root === Cm || root === Fm, kind, ...o });

const ROWS: Row[] = [
  // 0 the valley; 2 the chase; 4.5 cornered; 6.5 the shot
  r(Cm, 'air'), r(Cm, 'air'),
  r(Cm, 'chase'), r(Ab, 'chase'), r(Cm, 'chase', { lvl: 2 }), r(G, 'dread'), r(G, 'dread'), r(Cm, 'void'),
  // 8 friends
  r(Cm, 'warm'), r(Ab, 'warm'), r(Eb, 'warm', { lvl: 2 }), r(Bb, 'warm', { lvl: 2 }),
  // 12 the spoils, the road
  r(Cm, 'march'), r(Ab, 'march'), r(Eb, 'march', { lvl: 2 }), r(G, 'march', { lvl: 2, roll: true }),
  // 16 the station, the map, the wait for them
  r(Cm, 'build'), r(Ab, 'build', { lvl: 2 }), r(G, 'build', { lvl: 3, roll: true, stop: 3.5 }),
  // 19 the fight
  r(Cm, 'war'), r(Ab, 'war'), r(Eb, 'war'), r(Bb, 'war'), r(Cm, 'war', { lvl: 2 }), r(Ab, 'war', { lvl: 2 }), r(Eb, 'war', { lvl: 2, stop: 2 }),
  // 26 the drum: held breath, then the floor goes
  r(G, 'hold'), r(Cm, 'war', { lvl: 2, toms: true }),
  // 28 the one who got in
  r(Cm, 'tense'), r(Ab, 'tense'), r(G, 'tense', { lvl: 2 }),
  // 31 what they are carrying; 33 the clock
  r(Ab, 'warm', { lvl: 2 }), r(Bb, 'warm', { lvl: 2 }),
  r(Cm, 'tick'), r(Ab, 'tick', { lvl: 2 }), r(G, 'tick', { lvl: 3, roll: true }),
  // 36 paid
  r(Eb, 'bells'), r(Bb, 'bells'), r(Cm, 'bells', { lvl: 0 }),
  // 39 the walk, the shot
  r(Cm, 'void'), r(Cm, 'void', { lvl: 2 }), r(Cm, 'void', { lvl: 3 }),
  // 42 the price
  r(Cm, 'lament'), r(Ab, 'lament'), r(Fm, 'lament', { lvl: 2 }), r(G, 'lament', { lvl: 2 }), r(G, 'dread'),
  // 47 the name (it lands half a bar earlier: see HITS)
  r(Cm, 'slam'),
  // 48 how the money works
  r(Cm, 'tech', { lvl: 1 }), r(Ab, 'tech', { lvl: 1 }), r(Eb, 'tech', { lvl: 1 }), r(Bb, 'tech', { lvl: 1 }),
  r(Cm, 'tech', { lvl: 2 }), r(Ab, 'tech', { lvl: 2 }), r(Eb, 'tech', { lvl: 2 }), r(Bb, 'tech', { lvl: 2 }),
  r(Cm, 'tech', { lvl: 3 }), r(Ab, 'tech', { lvl: 3 }), r(Eb, 'tech', { lvl: 3 }), r(Bb, 'tech', { lvl: 3 }),
  r(Cm, 'tech', { lvl: 4 }), r(Ab, 'tech', { lvl: 4 }), r(Eb, 'tech', { lvl: 4 }), r(G, 'tech', { lvl: 4, roll: true }),
  // 64 what is coming
  r(Cm, 'top'), r(Ab, 'top'), r(Eb, 'top'), r(Bb, 'top'), r(Cm, 'top', { lvl: 2 }), r(Ab, 'top', { lvl: 2 }), r(Eb, 'top', { lvl: 2 }), r(G, 'top', { lvl: 2, toms: true }),
  // 72 everything at once
  r(Ab, 'top', { lvl: 3 }), r(Bb, 'top', { lvl: 3 }), r(Cm, 'top', { lvl: 4 }), r(G, 'top', { lvl: 4, roll: true }),
  // 76 the name again
  r(Cm, 'end'), r(Cm, 'end'), r(Cm, 'end'), r(Cm, 'end'),
];

/** the moments the band hits (seconds, how hard): the rifle, the door, the drum, the money, the betrayal, the name */
export const HITS3: [number, number][] = [
  [0.05, 0.5], [6.5 * BAR + 0.78, 1.15], [16 * BAR, 0.7], [19 * BAR, 1], [26.5 * BAR + 0.42, 1.35], [28 * BAR, 0.55], [36 * BAR + 0.62, 0.9],
  [41 * BAR + 0.6, 1.2], [46.5 * BAR, 1.4], [48 * BAR, 0.5], [64 * BAR, 1], [72 * BAR, 1], [76 * BAR, 1.35],
];
const RISERS: [number, number, number][] = [
  [4.5 * BAR, 6.5 * BAR + 0.74, 0.7], [14.5 * BAR, 16 * BAR, 0.45], [17.5 * BAR, 19 * BAR - BEAT * 0.5, 0.9], [25.5 * BAR, 26.5 * BAR + 0.4, 0.75], [34.5 * BAR, 36 * BAR + 0.6, 0.6],
  [44.5 * BAR, 46.5 * BAR, 1], [62 * BAR, 64 * BAR, 0.9], [70.5 * BAR, 72 * BAR, 0.7], [74 * BAR, 76 * BAR, 1],
];

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export function scoreMusic3(ctx: BaseAudioContext, out: AudioNode) {
  const master = ctx.createGain();
  master.gain.value = 0.5;
  // the last bar fades out with the picture
  master.gain.setValueAtTime(0.5, (BARS3 - 1.2) * BAR);
  master.gain.linearRampToValueAtTime(0.0001, BARS3 * BAR);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 3;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  master.connect(comp).connect(out);
  // a hall for everything that is not the kick
  const hall = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 3.1);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  let s = 424242;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 2.4);
  }
  hall.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.24;
  wet.connect(hall).connect(master);
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  {
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
  }
  // everything tonal ducks under the kick
  const duck = ctx.createGain();
  duck.connect(master);
  duck.connect(wet);
  const drums = ctx.createGain();
  drums.connect(master);

  const env = (g: GainNode, t: number, peak: number, a: number, d: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  const nz = (t: number, dur: number, type: BiquadFilterType, f: number, q: number, peak: number, a: number, to: AudioNode = drums) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    fl.Q.value = q;
    const g = ctx.createGain();
    env(g, t, peak, a, dur);
    src.connect(fl).connect(g).connect(to);
    src.start(t, rnd() * 1.2, dur + a + 0.05);
    return fl;
  };
  const kick = (t: number, v = 1, pump = true) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const g = ctx.createGain();
    env(g, t, 1.1 * v, 0.002, 0.26);
    o.connect(g).connect(drums);
    o.start(t);
    o.stop(t + 0.35);
    nz(t, 0.02, 'highpass', 2500, 0.7, 0.25 * v, 0.001);
    if (pump) {
      duck.gain.setValueAtTime(0.42, t);
      duck.gain.linearRampToValueAtTime(1, t + 0.2);
    }
  };
  /** a heart: two soft thumps, the second lighter */
  const heart = (t: number, v = 1) => {
    for (const [dt, k] of [[0, 1], [0.21, 0.62]] as const) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(74, t + dt);
      o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.14);
      const g = ctx.createGain();
      env(g, t + dt, 0.95 * v * k, 0.006, 0.24);
      o.connect(g).connect(drums);
      o.start(t + dt);
      o.stop(t + dt + 0.4);
    }
  };
  const snare = (t: number, v = 1) => {
    nz(t, 0.16, 'bandpass', 1900, 0.8, 0.7 * v, 0.001);
    nz(t, 0.2, 'highpass', 5200, 0.6, 0.3 * v, 0.001, wet);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(230, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const g = ctx.createGain();
    env(g, t, 0.5 * v, 0.001, 0.1);
    o.connect(g).connect(drums);
    o.start(t);
    o.stop(t + 0.15);
  };
  /** hands: three quick bursts of noise */
  const clap = (t: number, v = 1) => {
    for (const dt of [0, 0.011, 0.024]) nz(t + dt, 0.09, 'bandpass', 1500, 1.1, 0.42 * v, 0.001);
    nz(t, 0.18, 'highpass', 3800, 0.6, 0.16 * v, 0.001, wet);
  };
  const hat = (t: number, v = 1, open = false) => nz(t, open ? 0.22 : 0.035, 'highpass', 7800, 0.8, 0.16 * v, 0.001);
  const tom = (t: number, f: number, v = 1) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    const g = ctx.createGain();
    env(g, t, 0.8 * v, 0.003, 0.35);
    o.connect(g);
    g.connect(drums);
    g.connect(wet);
    o.start(t);
    o.stop(t + 0.5);
  };
  /** the floor dropping out: a long sub fall and a wash of noise */
  const boom = (t: number, v = 1) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(92, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.1);
    const g = ctx.createGain();
    env(g, t, 1.25 * v, 0.004, 1.5);
    o.connect(g).connect(drums);
    o.start(t);
    o.stop(t + 1.8);
    const f = nz(t, 1.6, 'lowpass', 9000, 0.5, 0.5 * v, 0.002, wet);
    f.frequency.setValueAtTime(9000, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 1.4);
    nz(t, 0.9, 'highpass', 6000, 0.5, 0.22 * v, 0.002);
  };
  const riser = (t0: number, t1: number, v: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.6;
    f.frequency.setValueAtTime(260, t0);
    f.frequency.exponentialRampToValueAtTime(7200, t1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.42 * v, t1);
    g.gain.setValueAtTime(0.0001, t1 + 0.005);
    src.connect(f).connect(g);
    g.connect(master);
    g.connect(wet);
    src.start(t0);
    src.stop(t1 + 0.05);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t0);
    o.frequency.exponentialRampToValueAtTime(440, t1);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.09 * v, t1);
    og.gain.setValueAtTime(0.0001, t1 + 0.005);
    const of = ctx.createBiquadFilter();
    of.type = 'lowpass';
    of.frequency.value = 1800;
    o.connect(of).connect(og).connect(wet);
    o.start(t0);
    o.stop(t1 + 0.05);
  };
  /** wind over the valley: noise through a filter that wanders */
  const windOver = (t0: number, dur: number, v: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.7;
    for (let k = 0; k <= 8; k++) f.frequency.linearRampToValueAtTime(380 + 420 * Math.abs(Math.sin(k * 1.9 + t0)), t0 + (dur * k) / 8 + 0.001);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.11 * v, t0 + dur * 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g);
    g.connect(master);
    g.connect(wet);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  };
  /** a stack of saws through a filter that opens and closes: bass, brass and strings are all this */
  const voice = (t: number, dur: number, midi: number, peak: number, o: { cut: number; open?: number; a?: number; r?: number; det?: number; type?: OscillatorType; to?: AudioNode; q?: number }) => {
    const g = ctx.createGain();
    const a = o.a ?? 0.01, rel = o.r ?? 0.12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, Math.max(t + a, t + dur - rel));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = o.q ?? 0.9;
    f.frequency.setValueAtTime(o.open ?? o.cut, t);
    f.frequency.exponentialRampToValueAtTime(o.cut, t + Math.min(dur, 0.35));
    for (const d of o.det ? [-o.det, o.det] : [0]) {
      const osc = ctx.createOscillator();
      osc.type = o.type ?? 'sawtooth';
      osc.frequency.value = hz(midi);
      osc.detune.value = d;
      osc.connect(f);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
    f.connect(g).connect(o.to ?? duck);
  };
  const bell = (t: number, midi: number, v: number, long = 1) => {
    for (const [mul, k] of [[1, 1], [2.76, 0.35], [5.4, 0.15]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = hz(midi) * mul;
      const g = ctx.createGain();
      env(g, t, 0.16 * v * k, 0.002, (0.7 / mul + 0.15) * long);
      o.connect(g);
      g.connect(master);
      g.connect(wet);
      o.start(t);
      o.stop(t + 1.4 * long);
    }
  };

  ROWS.forEach((row, bar) => {
    const { root, minor, kind } = row;
    const lvl = row.lvl ?? 1;
    const t0 = bar * BAR;
    const third = minor ? 3 : 4;
    const tri = [root + 12, root + 12 + third, root + 19];
    const at = (beat: number) => t0 + beat * BEAT;
    // drums fall silent from this beat on (the silence is the wind-up)
    const gap = row.stop ?? 4;
    const pad = (v: number, cut: number, up = 12, a = 0.5) => tri.forEach((m) => voice(t0, BAR, m + up, v, { cut, a, r: 0.5, det: 9 }));
    const sub = (v: number) => voice(t0, BAR, root - 12, v, { cut: 150, a: 0.5, r: 0.6, type: 'sine' });
    const bass = (v: number, cut: number, every = 0.5) => {
      for (let b = 0; b < gap; b += every) voice(at(b), BEAT * every * 0.86, root, v, { cut, open: cut * 3, det: 5, q: 2.5 });
    };
    const ostinato = (v: number, up = 24, div = 4) => {
      const seq = [0, 2, 1, 2, 0, 2, 1, 2];
      for (let i = 0; i < gap * div; i++) voice(at(i / div), BEAT * (0.8 / div), tri[seq[i % 8]] + up - 12, v * (i % div === 0 ? 1.25 : 0.85), { cut: 2600, open: 5200, a: 0.004, r: 0.05, to: duck });
    };
    // the tune: root up top, the third as a pickup, a long fifth; the answer climbs
    const tune = (v: number, up: number, soft = false) => {
      const answer = bar % 2 === 1;
      const notes: [number, number, number][] = answer ? [[0, 1, tri[1] + 12], [1, 0.5, tri[2] + 12], [1.5, 2.4, tri[0] + 24]] : [[0, 1.5, tri[0] + 12], [1.5, 0.5, tri[1] + 12], [2, 1.9, tri[2] + 12]];
      for (const [b, d, m] of notes) {
        voice(at(b), BEAT * d, m + up, v, { cut: soft ? 900 : 1500, open: soft ? 1600 : 4200, a: soft ? 0.09 : 0.03, r: 0.14, det: 11 });
        voice(at(b), BEAT * d, m + up - 12, v * 0.7, { cut: soft ? 700 : 1100, open: soft ? 1200 : 2600, a: soft ? 0.09 : 0.03, r: 0.14, det: 8 });
      }
    };
    const four = (v: number) => { for (let b = 0; b < gap; b++) kick(at(b), v); };
    const back = (v: number) => { if (gap > 1) snare(at(1), v); if (gap > 3) snare(at(3), v); };
    const hats = (v: number, div: number) => { for (let i = 0; i < gap * div; i++) hat(at(i / div), v * (i % div === 0 ? 1 : 0.6), div === 2 && i % 2 === 1); };
    const shake = (v: number, n = 30) => { for (let i = 0; i < n; i++) voice(t0 + (i * BAR) / n, BAR / n - 0.008, root + 43, v, { cut: 5200, a: 0.006, r: 0.02, det: 7 }); };
    const roll = (from = 0, v0 = 0.14, v1 = 0.75) => { const n = Math.round((gap - from) * 4); for (let i = 0; i < n; i++) snare(at(from + i / 4), v0 + ((v1 - v0) * i) / Math.max(1, n - 1)); };

    switch (kind) {
      case 'air':
        // nothing but the place: wind, a low note, and three notes of the tune from far off
        windOver(t0, BAR * 1.2, 1);
        sub(0.2);
        pad(0.02, 520, 12, 0.9);
        if (bar % 2 === 0) [tri[2] + 12, tri[1] + 12, tri[0] + 12].forEach((m, i) => bell(at(1 + i * 0.75), m, 0.5, 1.6));
        break;
      case 'chase':
        // somebody running for their life: the heart, strings shaking, a drum that will not settle
        sub(0.22);
        shake(0.009 + lvl * 0.004);
        for (let b = 0; b < 4; b += lvl > 1 ? 0.75 : 1) heart(at(b), 0.8);
        for (const b of [1.5, 3.5]) tom(at(b), 96 + ((bar * 7) % 3) * 16, 0.45);
        pad(0.03, 800 + bar * 90);
        break;
      case 'dread':
        // time slows: one long cold chord, the heart alone
        sub(0.26);
        shake(0.012, 22);
        tri.forEach((m) => voice(t0, BAR, m + 24, 0.014, { cut: 2400, a: 0.4, r: 0.4, det: 14 }));
        heart(at(0), 0.9);
        heart(at(2), 0.9);
        break;
      case 'void':
        // after a shot, and before one: almost nothing
        voice(t0, BAR, root - 12, 0.2 + lvl * 0.03, { cut: 110, a: 0.3, r: 0.8, type: 'sine' });
        if (lvl === 1) bell(at(1), tri[0] + 24, 0.55, 2.2);
        if (lvl >= 2) for (let b = 0; b < 4; b += lvl === 3 ? 1 : 2) heart(at(b), 0.75 + lvl * 0.08);
        if (lvl >= 2) tri.slice(0, 2).forEach((m) => voice(t0, BAR, m + 25, 0.008 * lvl, { cut: 3000, a: 0.8, r: 0.3, det: 18 }));
        break;
      case 'warm':
        // two people who have decided to trust each other: the tune, quietly, over a soft pulse
        pad(0.05, 1300 + lvl * 250, 12, 0.35);
        voice(t0, BAR, root, 0.17, { cut: 240, a: 0.08, r: 0.4, type: 'sine' });
        tune(0.05 + lvl * 0.008, 0, true);
        for (let i = 0; i < 8; i++) bell(at(i / 2), tri[[0, 2, 1, 2][i % 4]] + 24, 0.34 + (i % 4 === 0 ? 0.18 : 0), 0.8);
        kick(at(0), 0.5);
        kick(at(2.5), 0.38);
        if (lvl > 1) hats(0.32, 2);
        break;
      case 'march':
        pad(0.045, 1300);
        bass(0.14, 340 + lvl * 90);
        tune(0.045, 0, true);
        kick(at(0), 0.85);
        kick(at(2), 0.8);
        if (lvl > 1) kick(at(3.5), 0.5);
        for (const b of [1, 1.5, 3]) tom(at(b), 110 + ((b * 2 + bar) % 3) * 20, 0.5);
        hats(0.45, lvl > 1 ? 4 : 2);
        if (row.roll) roll(2);
        break;
      case 'build':
        pad(0.05, 1000 + lvl * 500);
        bass(0.15, 340 + lvl * 160);
        ostinato(0.024 + lvl * 0.006);
        for (let b = 0; b < gap; b++) {
          kick(at(b), 0.85);
          if (b + 0.5 < gap) tom(at(b + 0.5), 110 + ((b + bar) % 3) * 22, 0.5);
        }
        if (row.roll) roll(0, 0.15, 0.8);
        break;
      case 'war': {
        const big = lvl > 1;
        pad(0.05, big ? 2100 : 1700);
        bass(0.17, big ? 700 : 560);
        ostinato(big ? 0.04 : 0.032);
        tune(big ? 0.075 : 0.065, big ? 12 : 0);
        four(1);
        back(0.95);
        hats(big ? 0.85 : 0.7, 4);
        if (big && gap > 1) hat(at(0.5), 0.9, true);
        if (row.toms) for (let i = 0; i < 6; i++) tom(at(2.5 + i / 4), 150 - i * 11, 0.5 + i * 0.08);
        break;
      }
      case 'hold':
        // the sights settle on the drum: strings held high and thin, nothing under them
        sub(0.24);
        shake(0.014);
        heart(at(0), 0.85);
        heart(at(1), 0.9);
        // (the blast itself is one of the hits; what is left of the bar rings)
        break;
      case 'tense':
        sub(0.24);
        shake(0.012);
        kick(at(0), 0.55);
        kick(at(0.75), 0.35);
        kick(at(2), 0.55);
        kick(at(2.75), 0.35);
        if (lvl > 1) {
          bass(0.13, 420);
          for (let i = 0; i < 8; i++) snare(at(2 + i / 4), 0.16 + i * 0.05);
        }
        break;
      case 'tick':
        // the clock: one bright note on every eighth, the band creeping in under it
        pad(0.04, 800 + lvl * 380);
        voice(t0, BAR, root, 0.16, { cut: 220, a: 0.2, r: 0.4, type: 'sine' });
        ostinato(0.024 + lvl * 0.008, 24);
        for (let i = 0; i < 8; i++) nz(at(i / 2), 0.03, 'bandpass', i % 2 ? 2600 : 3400, 9, 0.5, 0.001);
        hats(0.5, 4);
        kick(at(0), 0.75);
        if (lvl >= 2) kick(at(2), 0.6);
        if (lvl >= 3) for (let b = 1; b < 4; b += 2) kick(at(b), 0.5);
        if (row.roll) roll(2, 0.18, 0.7);
        break;
      case 'bells':
        if (lvl === 0) {
          // the last of it, dying away as he walks off
          pad(0.035, 1200);
          for (let i = 0; i < 4; i++) bell(at(i), tri[[0, 1, 2, 1][i]] + 24, 0.5 - i * 0.09, 1.5);
          break;
        }
        pad(0.06, 2600);
        voice(t0, BAR, root, 0.18, { cut: 300, a: 0.05, r: 0.3, type: 'sine' });
        four(0.75);
        hats(0.6, 4);
        clap(at(1), 0.7);
        clap(at(3), 0.7);
        // coins: the chord, run up and down in bells
        for (let i = 0; i < 16; i++) bell(at(i / 4), tri[[0, 1, 2, 1][i % 4]] + 24 + (i % 8 >= 4 ? 12 : 0), 0.8);
        break;
      case 'lament':
        // the tune again, low and slow, for the one on the ground
        sub(0.24);
        tri.forEach((m) => voice(t0, BAR, m, 0.05, { cut: 520 + lvl * 160, a: 0.6, r: 0.6, det: 10 }));
        tune(0.04 + lvl * 0.012, -12, true);
        bell(at(0), tri[0] + 12, 0.7, 2.4);
        if (lvl > 1) {
          heart(at(0), 0.7);
          heart(at(2), 0.7);
          shake(0.007);
        }
        break;
      case 'slam':
        // (the hit and the chord land half a bar before this one starts: see below)
        break;
      case 'tech': {
        // how the money works: clean, even, going somewhere
        pad(0.04 + lvl * 0.004, 1200 + lvl * 320);
        ostinato(0.022 + lvl * 0.006, 24, 4);
        voice(t0, BAR, root, 0.15, { cut: 230, a: 0.03, r: 0.3, type: 'sine' });
        four(0.62 + lvl * 0.07);
        if (lvl >= 2) hats(0.4 + lvl * 0.08, 4);
        if (lvl >= 2) for (let b = 0.5; b < gap; b++) voice(at(b), BEAT * 0.42, root + 12, 0.11, { cut: 420 + lvl * 90, open: 1500, det: 5, q: 2.2 });
        if (lvl >= 3) {
          clap(at(1), 0.75);
          clap(at(3), 0.75);
        }
        if (lvl >= 4) tune(0.06, 12);
        else if (bar % 4 === 3) for (let i = 0; i < 4; i++) bell(at(2 + i / 2), tri[i % 3] + 24, 0.5, 1);
        if (row.roll) roll(1, 0.14, 0.8);
        break;
      }
      case 'top': {
        const run = lvl >= 3;
        pad(0.05, 2100);
        bass(0.17, 700);
        ostinato(0.04);
        tune(0.075, lvl >= 2 ? 12 : 0);
        if (lvl >= 2) tune(0.03, 24);
        four(1);
        back(0.95);
        hats(0.85, 4);
        hat(at(0.5), 0.9, true);
        if (lvl >= 2) hat(at(2.5), 0.9, true);
        if (run) {
          // the last four bars run: snare on every eighth, then every sixteenth
          const div = lvl >= 4 ? 4 : 2;
          for (let i = 0; i < 4 * div; i++) snare(at(i / div), 0.26 + (lvl - 3) * 0.1 + (i / (4 * div)) * 0.18);
          for (let b = 0.5; b < 4; b++) kick(at(b), 0.7);
          tom(at(2), 120, 0.7);
          tom(at(3.5), 96, 0.8);
        }
        if (row.toms) for (let i = 0; i < 8; i++) tom(at(2 + i / 4), 160 - i * 9, 0.45 + i * 0.07);
        break;
      }
      case 'end':
        if (bar === 76) {
          for (const m of [root - 12, root, root + 7, root + 12, root + 15, root + 19, root + 24]) voice(t0, BAR * 3.6, m, 0.055, { cut: 1300, open: 5200, a: 0.01, r: 3.4, det: 10 });
          tom(at(0), 82, 1);
          [tri[2] + 12, tri[1] + 12, tri[0] + 12].forEach((m, i) => bell(at(4 + i * 1.5), m, 0.6, 2.2));
        }
        break;
    }
  });

  // the name, half a bar early: every voice the band has, on one chord, and then nothing
  {
    const t = 46.5 * BAR;
    for (const m of [Cm - 12, Cm, Cm + 7, Cm + 12, Cm + 15, Cm + 19, Cm + 24, Cm + 31]) voice(t, BAR * 1.45, m, 0.06, { cut: 1500, open: 6200, a: 0.006, r: 1.6, det: 12 });
    tom(t, 78, 1);
    snare(t, 0.9);
  }
  for (const [t, v] of HITS3) boom(t, v);
  for (const [a, b2, v] of RISERS) riser(a, b2, v);
}
