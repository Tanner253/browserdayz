// The trailer's score, written as code: one row per bar (the chord, and how hard the band
// plays it), in D minor at 128 beats a minute, so a bar is 1.875 s and every cut in shots.ts
// lands on a bar line. Everything is scheduled up front into the offline render.

import { BAR, BARS } from './shots';

const BEAT = BAR / 4;
export type Level = 'low' | 'pulse' | 'tick' | 'build' | 'tense' | 'drive' | 'full' | 'top' | 'bright' | 'end';
// [root (MIDI), minor?, how it is played]
const ROWS_1: [number, boolean, Level][] = [
  [38, true, 'low'], [38, true, 'low'], [34, false, 'low'], [33, false, 'low'],
  [38, true, 'pulse'], [38, true, 'pulse'], [34, false, 'pulse'], [36, false, 'pulse'],
  [31, true, 'build'], [33, false, 'build'],
  [38, true, 'full'], [34, false, 'full'],
  [38, true, 'tense'], [38, true, 'tense'], [38, true, 'tense'], [33, false, 'drive'],
  [41, false, 'full'], [36, false, 'full'], [38, true, 'full'], [34, false, 'full'],
  [38, true, 'tick'], [34, false, 'tick'], [41, false, 'tick'], [36, false, 'tick'],
  [41, false, 'bright'], [36, false, 'bright'],
  [38, true, 'top'], [34, false, 'top'], [41, false, 'top'], [36, false, 'top'], [38, true, 'top'], [34, false, 'top'], [41, false, 'top'], [36, false, 'top'],
  [34, false, 'top'], [36, false, 'top'], [38, true, 'top'], [33, false, 'top'],
  [38, true, 'end'], [38, true, 'end'],
];
/** moments in the picture the band hits, in seconds (bar lines unless said): the drop, the bullet landing, the tag cashed in */
const HITS_1: [number, number][] = [[10 * BAR, 1], [13 * BAR + 3.05, 1.1], [16 * BAR, 0.9], [24 * BAR + 0.45, 0.9], [26 * BAR, 1], [30 * BAR, 0.9], [34 * BAR, 1], [38 * BAR, 1.2]];
const RISERS_1: [number, number, number][] = [[3 * BAR, 4 * BAR, 0.35], [8 * BAR, 10 * BAR - BEAT * 0.5, 0.9], [13 * BAR + 0.9, 13 * BAR + 3.05, 0.5], [23 * BAR, 24 * BAR + 0.45, 0.6], [36 * BAR, 38 * BAR, 1]];

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** a cut's own score: one row per bar, the moments the band hits, and the rises into them */
export interface Arrangement {
  rows: [number, boolean, Level][];
  hits: [number, number][];
  risers: [number, number, number][];
}

export function scoreMusic(ctx: BaseAudioContext, out: AudioNode, arr?: Arrangement) {
  const ROWS = arr?.rows ?? ROWS_1, HITS = arr?.hits ?? HITS_1, RISERS = arr?.risers ?? RISERS_1;
  const master = ctx.createGain();
  master.gain.value = 0.5;
  // the last bar and a half fade out with the picture
  master.gain.setValueAtTime(0.5, (BARS - 0.6) * BAR);
  master.gain.linearRampToValueAtTime(0.0001, BARS * BAR);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 3;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  master.connect(comp).connect(out);
  // a hall for everything that is not the kick
  const hall = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 2.6);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  hall.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
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
  const kick = (t: number, v = 1) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const g = ctx.createGain();
    env(g, t, 1.1 * v, 0.002, 0.26);
    o.connect(g).connect(drums);
    o.start(t);
    o.stop(t + 0.35);
    nz(t, 0.02, 'highpass', 2500, 0.7, 0.25 * v, 0.001);
    duck.gain.setValueAtTime(0.42, t);
    duck.gain.linearRampToValueAtTime(1, t + 0.2);
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
  /** a stack of saws through a filter that opens and closes: bass, brass and strings are all this */
  const voice = (t: number, dur: number, midi: number, peak: number, o: { cut: number; open?: number; a?: number; r?: number; det?: number; type?: OscillatorType; to?: AudioNode; q?: number }) => {
    const g = ctx.createGain();
    const a = o.a ?? 0.01, r = o.r ?? 0.12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, Math.max(t + a, t + dur - r));
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
  const bell = (t: number, midi: number, v: number) => {
    for (const [mul, k] of [[1, 1], [2.76, 0.35], [5.4, 0.15]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = hz(midi) * mul;
      const g = ctx.createGain();
      env(g, t, 0.16 * v * k, 0.002, 0.7 / mul + 0.15);
      o.connect(g);
      g.connect(master);
      g.connect(wet);
      o.start(t);
      o.stop(t + 1.2);
    }
  };

  ROWS.forEach(([root, minor, level], bar) => {
    const t0 = bar * BAR;
    const third = minor ? 3 : 4;
    const tri = [root + 12, root + 12 + third, root + 19];
    const at = (beat: number) => t0 + beat * BEAT;
    // the two beats before the drop are left empty: the silence is the wind-up
    const gap = bar === 9 ? 3.5 : 4;
    const pad = (v: number, cut: number, up = 12) => tri.forEach((m) => voice(t0, BAR, m + up, v, { cut, a: 0.5, r: 0.5, det: 9 }));
    const bass = (v: number, cut: number, every = 0.5) => {
      for (let b = 0; b < gap; b += every) voice(at(b), BEAT * every * 0.86, root, v, { cut, open: cut * 3, det: 5, q: 2.5 });
    };
    const ostinato = (v: number, up = 24) => {
      const seq = [0, 2, 1, 2, 0, 2, 1, 2];
      for (let i = 0; i < gap * 4; i++) voice(at(i / 4), BEAT * 0.2, tri[seq[i % 8]] + up - 12, v * (i % 4 === 0 ? 1.25 : 0.85), { cut: 2600, open: 5200, a: 0.004, r: 0.05, to: duck });
    };
    // the tune: root up top, the third as a pickup, a long fifth; the answer climbs
    const tune = (v: number, up: number) => {
      const answer = bar % 2 === 1;
      const notes: [number, number, number][] = answer ? [[0, 1, tri[1] + 12], [1, 0.5, tri[2] + 12], [1.5, 2.4, tri[0] + 24]] : [[0, 1.5, tri[0] + 12], [1.5, 0.5, tri[1] + 12], [2, 1.9, tri[2] + 12]];
      for (const [b, d, m] of notes) {
        voice(at(b), BEAT * d, m + up, v, { cut: 1500, open: 4200, a: 0.03, r: 0.14, det: 11 });
        voice(at(b), BEAT * d, m + up - 12, v * 0.7, { cut: 1100, open: 2600, a: 0.03, r: 0.14, det: 8 });
      }
    };
    const four = (v: number) => { for (let b = 0; b < gap; b++) kick(at(b), v); };
    const back = (v: number) => { snare(at(1), v); if (gap > 3) snare(at(3), v); };
    const hats = (v: number, div: number) => { for (let i = 0; i < gap * div; i++) hat(at(i / div), v * (i % div === 0 ? 1 : 0.6), div === 2 && i % 2 === 1); };

    switch (level) {
      case 'low':
        pad(0.035, 700);
        voice(t0, BAR, root - 12, 0.2, { cut: 160, a: 0.6, r: 0.6, type: 'sine' });
        kick(at(0), 0.45);
        kick(at(1.5), 0.3);
        break;
      case 'pulse':
        pad(0.04, 1000);
        bass(0.13, 300);
        ostinato(0.03);
        kick(at(0), 0.8);
        kick(at(2), 0.7);
        hats(0.5, 2);
        if (bar === 7) for (let i = 0; i < 4; i++) tom(at(3 + i / 4), 150 - i * 12, 0.5 + i * 0.1);
        break;
      case 'tick':
        pad(0.045, 900 + (bar - 20) * 260);
        voice(t0, BAR, root, 0.16, { cut: 220, a: 0.2, r: 0.4, type: 'sine' });
        ostinato(0.03 + (bar - 20) * 0.006, 24);
        hats(0.55, 4);
        kick(at(0), 0.75);
        if (bar >= 22) kick(at(2), 0.6);
        if (bar === 23) for (let i = 0; i < 8; i++) snare(at(2 + i / 4), 0.2 + i * 0.07);
        break;
      case 'build':
        pad(0.05, 1100 + (bar - 8) * 600);
        bass(0.15, 380 + (bar - 8) * 200);
        for (let b = 0; b < gap; b++) {
          kick(at(b), 0.85);
          tom(at(b + 0.5), 110 + ((b + bar) % 3) * 22, 0.5);
        }
        if (bar === 9) for (let i = 0; i < 14; i++) snare(at(i / 4), 0.15 + i * 0.045);
        break;
      case 'tense':
        voice(t0, BAR, root - 12, 0.24, { cut: 140, a: 0.3, r: 0.5, type: 'sine' });
        // strings held high and thin, shaking
        for (let i = 0; i < 30; i++) voice(t0 + (i * BAR) / 30, BAR / 30 - 0.008, root + 43, 0.012, { cut: 5200, a: 0.006, r: 0.02, det: 7 });
        if (bar !== 14) {
          kick(at(0), 0.55);
          kick(at(0.75), 0.35);
          kick(at(2), 0.55);
          kick(at(2.75), 0.35);
        }
        break;
      case 'drive':
        pad(0.05, 1500);
        bass(0.16, 520);
        four(0.95);
        for (let i = 0; i < 12; i++) snare(at(1 + i / 4), 0.25 + i * 0.05);
        hats(0.7, 4);
        break;
      case 'full':
      case 'top': {
        const top = level === 'top';
        const last = bar >= 34;
        pad(0.05, top ? 2100 : 1700);
        bass(0.17, top ? 700 : 560);
        ostinato(top ? 0.04 : 0.032);
        tune(top ? 0.075 : 0.065, top ? 12 : 0);
        four(1);
        back(0.95);
        hats(top ? 0.85 : 0.7, 4);
        if (top) hat(at(0.5), 0.9, true);
        if (last) {
          // the last four bars run: snare on every eighth, then every sixteenth
          const div = bar >= 36 ? 4 : 2;
          for (let i = 0; i < 4 * div; i++) snare(at(i / div), 0.28 + (bar - 34) * 0.08 + (i / (4 * div)) * 0.15);
          for (let b = 0.5; b < 4; b++) kick(at(b), 0.7);
          tom(at(2), 120, 0.7);
          tom(at(3.5), 96, 0.8);
        }
        break;
      }
      case 'bright':
        pad(0.06, 2600);
        voice(t0, BAR, root, 0.18, { cut: 300, a: 0.05, r: 0.3, type: 'sine' });
        four(0.75);
        hats(0.6, 4);
        // coins: the chord, run up and down in bells
        for (let i = 0; i < 16; i++) bell(at(i / 4), tri[[0, 1, 2, 1][i % 4]] + 24 + (i % 8 >= 4 ? 12 : 0), 0.8);
        break;
      case 'end':
        if (bar === 38) {
          for (const m of [root - 12, root, root + 7, root + 12, root + 19, root + 24]) voice(t0, BAR * 2, m, 0.06, { cut: 1400, open: 5200, a: 0.01, r: 2.2, det: 10 });
          tom(at(0), 82, 1);
        }
        break;
    }
  });
  for (const [t, v] of HITS) boom(t, v);
  for (const [a, b2, v] of RISERS) riser(a, b2, v);
}
