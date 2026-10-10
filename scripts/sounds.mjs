// Recordings the game plays in place of sounds it used to make up: gunshots, a magazine
// going out and in, a slide racked.
//
//   node scripts/sounds.mjs        (npm run sounds)
//
// Sources, unpacked by hand into assets-src/sounds/ (gitignored):
//   snake/              "Snake's Authentic Gun Sounds" by Snake (f8studios.itch.io): free, may be
//                       used commercially, credit not required
//   firearm-library/    "The Free Firearm Sound Library" by Ben Jaszczak, Brian Nelson, Kevin
//                       Heras and Matthew Nanney (CC0)
//
// Each is cut to begin on the sound itself (a shot that starts a tenth of a second into its
// file is a shot that is late), let die away at its end, made one channel, brought to the
// rate given and to a common loudness, and written as 16-bit WAV into public/assets/sounds/.
// (There is no encoder on the machine these were made on, and they are short: about a
// megabyte in all.) What plays them is src/core/audio.ts; the names here are the names there.

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'assets-src', 'sounds');
const OUT = path.join(ROOT, 'public', 'assets', 'sounds');
const snake = (p) => path.join(SRC, 'snake', "Snake's Authentic Gun Sounds", p);
const lib = (p) => path.join(SRC, 'firearm-library', 'Prepared SFX Library', p);
const zed = (k) => path.join(SRC, 'zombies', 'zombies', `zombie-${k}.wav`);
/**
 * The infected: twenty-four recordings ("Zombies Sound Pack" by artisticdude, CC0, unpacked into
 * assets-src/sounds/zombies/), numbered and nothing more. Which is used for what was settled by
 * measuring them (whoever settled it cannot hear): the long low ones are what they do when they
 * are let alone, the long loud ones what they do when they are roused, the bright middling ones
 * the cry when they see somebody, the short ones a blow given or taken. Change the numbers here
 * if a growl turns out to be a scream, and run `npm run sounds`.
 */
const ZED = { groan: [16, 20, 1, 23], growl: [17, 18, 21, 15], alert: [8, 10, 12, 14], attack: [4, 3, 7, 2], hurt: [24, 5, 11, 13], die: [19, 9, 22, 6] };

/**
 *   src   – the recording
 *   side  – which of its two channels (both added together, if not given)
 *   takes – it holds several of the sound one after another: this many are cut out, each its own file (name, name_2, ...)
 *   len   – seconds kept of each (all of it, if not given)
 *   rate  – samples a second it is written at
 *   gain  – how loud against the rest (1: as loud as a recording can be)
 *   with  – other recordings laid under it, each begun where it begins:
 *             level – how loud against the first (1: as loud at its loudest)
 *             after – seconds of its beginning left out (it comes in over the next 40 ms): what follows the shot, without the shot
 *             low   – nothing of it above this many Hz
 *             die   – it dies away sooner than it did: to a third in this many seconds, and so on
 *   air   – how much is added to the top of it, above 3 kHz (1: as much again)
 *   press – how hard the loudest of it is pressed down, so that the rest of it comes up (0: not at all)
 */
const SOUNDS = {
  shot_rifle: { src: snake('Full Sound/7.62x54R/WAV/762x54r Single WAV.wav'), rate: 44100, gain: 1 },
  // A pistol recorded close and in the open is a snap fifteen thousandths of a second long and
  // then nothing: played as it is, beside a rifle that was made to be played in a game, it was
  // a click. (And its two microphones stood either side of the muzzle and disagree: added
  // together they cancel a third of each other.) So: the snap of the 9 mm from one microphone,
  // the weight of another pistol's shot under it, and under both the air after a rifle shot,
  // by whoever recorded the rifle. Then the top of it pressed down.
  shot_pistol: {
    src: lib('Walther PPQ/X_39P.wav'), side: 1, takes: 3, len: 1.5, rate: 44100, gain: 1, press: 1.4, air: 0.9,
    with: [
      { src: lib('Bersa/F_47P.wav'), side: 0, takes: 2, level: 0.6 },
      { src: snake('Full Sound/5.56/WAV/556 Single WAV.wav'), level: 0.65, after: 0.012, die: 0.3 },
    ],
  },
  shot_quiet: { src: snake('Full Sound/.22LR/WAV/22LR Single WAV.wav'), len: 0.9, rate: 44100, gain: 0.8 },
  rifle_mag_out: { src: snake('Reloads, Cycling & More/WAV/308 Magazine Part 1 WAV.wav'), rate: 32000, gain: 0.75 },
  rifle_mag_in: { src: snake('Reloads, Cycling & More/WAV/308 Magazine Part 2 WAV.wav'), rate: 32000, gain: 0.75 },
  pistol_mag_out: { src: snake('Reloads, Cycling & More/WAV/Angel Mag Reload Part 1 WAV.wav'), rate: 32000, gain: 0.7 },
  pistol_mag_in: { src: snake('Reloads, Cycling & More/WAV/Angel Mag Reload Part 2 WAV.wav'), rate: 32000, gain: 0.7 },
  rack: { src: snake('Reloads, Cycling & More/WAV/Semi 22LR Rack WAV.wav'), rate: 32000, gain: 0.75 },
  // The shotgun: a twelve bore recorded close (the library's Benelli Nova), and under it, as
  // under the pistol, the air after a rifle shot.
  shot_shotgun: {
    // (the gun itself, pressed hard; under it the bottom of the big rifle's shot, which is the thump a twelve bore
    // has in the chest; and the air after a rifle shot, left to ring a good while)
    src: lib('Nova/O_21P.wav'), side: 1, takes: 2, len: 2.2, rate: 44100, gain: 1, press: 1.6,
    with: [
      { src: snake('Full Sound/7.62x54R/WAV/762x54r Single WAV.wav'), level: 1.1, low: 520 },
      { src: snake('Full Sound/7.62x39/WAV/762x39 Single WAV.wav'), level: 0.75, after: 0.012, die: 0.55 },
    ],
  },
  // The big pistol: a .45 (the library's 1911), which is the heaviest pistol there is a
  // recording of, with the same air under it.
  shot_magnum: {
    src: lib('1911/A_42P.wav'), side: 1, takes: 2, len: 1.9, rate: 44100, gain: 1, press: 1.3, air: 0.5,
    // (and the bottom of the big rifle's shot under it, which is the weight a .50 has and a .45 has not)
    with: [
      { src: snake('Full Sound/7.62x54R/WAV/762x54r Single WAV.wav'), level: 0.95, low: 700 },
      { src: snake('Full Sound/7.62x39/WAV/762x39 Single WAV.wav'), level: 0.7, after: 0.012, die: 0.45 },
    ],
  },
  // a shell thumbed into a shotgun's tube
  shell_in: { src: snake('Reloads, Cycling & More/WAV/Pump Shell Load WAV.wav'), rate: 32000, gain: 0.8 },
};
for (const [kind, takes] of Object.entries(ZED)) takes.forEach((k, n) => (SOUNDS[`z_${kind}${n ? `_${n + 1}` : ''}`] = { src: zed(k), rate: 32000, gain: 0.9 }));

/** a .wav as one channel of numbers between -1 and 1: one of its channels, or all of them together */
async function readWav(file, side) {
  const b = await fs.readFile(file);
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') throw new Error(`${file}: not a WAV file`);
  let fmt = null, data = null;
  for (let at = 12; at + 8 <= b.length; ) {
    const id = b.toString('latin1', at, at + 4), size = b.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(at + 10), rate: b.readUInt32LE(at + 12), bits: b.readUInt16LE(at + 22) };
    if (id === 'data') data = b.subarray(at + 8, Math.min(b.length, at + 8 + size));
    at += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${file}: no sound in it`);
  const bytes = fmt.bits / 8, frames = Math.floor(data.length / (bytes * fmt.channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      if (side !== undefined && c !== Math.min(side, fmt.channels - 1)) continue;
      const o = (i * fmt.channels + c) * bytes;
      sum += bytes === 2 ? data.readInt16LE(o) / 32768 : bytes === 3 ? data.readIntLE(o, 3) / 8388608 : bytes === 4 ? data.readInt32LE(o) / 2147483648 : (data[o] - 128) / 128;
    }
    out[i] = side !== undefined ? sum : sum / fmt.channels;
  }
  return { rate: fmt.rate, x: out };
}

/** one sound cut out of a recording: from where it begins, at the rate asked for, its loudest moment at 1 */
function cutOut(x, rate, from, len, to) {
  const end = Math.min(x.length, len ? from + Math.round(len * rate) : x.length);
  const cut = resample(x.slice(from, end), rate, to);
  let peak = 0;
  for (const v of cut) peak = Math.max(peak, Math.abs(v));
  return cut.map((v) => v / (peak || 1));
}

/** how loud a stretch of it is, in decibels under as loud as can be */
function loud(x, rate, a, b) {
  let s = 0;
  const i0 = Math.round(a * rate), i1 = Math.min(x.length, Math.round(b * rate));
  for (let i = i0; i < i1; i++) s += x[i] * x[i];
  return (10 * Math.log10(s / Math.max(1, i1 - i0) + 1e-12)).toFixed(1);
}

/** where the sounds in it begin: the first sample of each that is loud, a breath before it */
function onsets(x, rate, many) {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const out = [];
  const loud = peak * (many ? 0.3 : 0.04), apart = rate * 0.9;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) < loud) continue;
    if (out.length && i - out[out.length - 1] < apart) continue;
    out.push(i);
  }
  // back to where it rises out of the quiet before it
  return out.map((i) => {
    let k = i;
    while (k > 0 && i - k < rate * 0.02 && Math.abs(x[k]) > peak * 0.02) k--;
    return Math.max(0, k - Math.round(rate * 0.002));
  });
}

function resample(x, from, to) {
  if (from === to) return x;
  // what the new rate cannot carry is taken out first, roughly: the mean of as many samples as go into one
  const n = Math.max(1, Math.round(from / to));
  let y = x;
  if (n > 1) {
    y = new Float32Array(x.length);
    let sum = 0;
    for (let i = 0; i < x.length; i++) {
      sum += x[i];
      if (i >= n) sum -= x[i - n];
      y[i] = sum / Math.min(n, i + 1);
    }
  }
  const out = new Float32Array(Math.floor((y.length * to) / from));
  for (let i = 0; i < out.length; i++) {
    const p = (i * from) / to, k = Math.floor(p), f = p - k;
    out[i] = y[k] * (1 - f) + (y[Math.min(y.length - 1, k + 1)] ?? 0) * f;
  }
  return out;
}

async function writeWav(file, x, rate) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + x.length * 2, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  await fs.writeFile(file, b);
}

await fs.mkdir(OUT, { recursive: true });
let total = 0;
const made = [];
for (const [name, cfg] of Object.entries(SOUNDS)) {
  const { rate, x } = await readWav(cfg.src, cfg.side);
  const starts = onsets(x, rate, (cfg.takes ?? 1) > 1).slice(0, cfg.takes ?? 1);
  if (!starts.length) throw new Error(`${name}: nothing loud in ${cfg.src}`);
  const under = [];
  for (const l of cfg.with ?? []) {
    const w = await readWav(l.src, l.side);
    const at = onsets(w.x, w.rate, (l.takes ?? 1) > 1).slice(0, l.takes ?? 1);
    if (!at.length) throw new Error(`${name}: nothing loud in ${l.src}`);
    under.push({ ...l, takes: at.map((from) => cutOut(w.x, w.rate, from, cfg.len, cfg.rate)) });
  }
  for (const [k, from] of starts.entries()) {
    let cut = cutOut(x, rate, from, cfg.len, cfg.rate);
    for (const l of under) {
      const y = l.takes[k % l.takes.length];
      if (y.length > cut.length) cut = Float32Array.from({ length: y.length }, (_, i) => cut[i] ?? 0);
      const skip = Math.round((l.after ?? 0) * cfg.rate), rise = Math.round(0.04 * cfg.rate);
      const a = l.low ? Math.exp((-2 * Math.PI * l.low) / cfg.rate) : 0;
      let low = 0;
      for (let i = 0; i < y.length; i++) {
        low = a * low + (1 - a) * y[i];
        if (i >= skip) cut[i] += low * l.level * (l.after ? Math.min(1, (i - skip) / rise) : 1) * (l.die ? Math.exp(-i / (l.die * cfg.rate)) : 1);
      }
    }
    if (cfg.air) {
      // what is above 3 kHz, and that much of it again
      const k = Math.exp((-2 * Math.PI * 3000) / cfg.rate);
      let low = 0;
      cut = cut.map((v) => {
        low = k * low + (1 - k) * v;
        return v + (v - low) * cfg.air;
      });
    }
    // (pressed: what is over the top of it is bent down, not cut off)
    if (cfg.press) cut = cut.map((v) => Math.tanh(v * cfg.press));
    let peak = 0;
    for (const v of cut) peak = Math.max(peak, Math.abs(v));
    const fade = Math.min(cut.length, Math.round(cfg.rate * 0.18));
    cut = cut.map((v, i) => (v / (peak || 1)) * 0.92 * cfg.gain * (i > cut.length - fade ? (cut.length - i) / fade : 1));
    const file = `${name}${k ? `_${k + 1}` : ''}.wav`;
    await writeWav(path.join(OUT, file), cut, cfg.rate);
    total += 44 + cut.length * 2;
    made.push(`${file} ${(cut.length / cfg.rate).toFixed(2)} s (began ${(from / rate).toFixed(3)} s into ${path.basename(cfg.src)}); loud ${loud(cut, cfg.rate, 0, 0.1)} dB in its first tenth of a second, ${loud(cut, cfg.rate, 0.1, 0.4)} over the next three`);
  }
}
console.log(made.join('\n'));
console.log(`${made.length} recordings, ${(total / 1024).toFixed(0)} KB`);
