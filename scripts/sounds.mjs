// Recordings the game plays in place of sounds it used to make up: gunshots, the bolt, a
// magazine going out and in, a slide racked.
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

/**
 *   src   – the recording
 *   takes – it holds several of the sound one after another: this many are cut out, each its own file (name, name_2, ...)
 *   len   – seconds kept of each (all of it, if not given)
 *   rate  – samples a second it is written at
 *   gain  – how loud against the rest (1: as loud as a recording can be)
 */
const SOUNDS = {
  shot_rifle: { src: snake('Full Sound/7.62x54R/WAV/762x54r Single WAV.wav'), rate: 44100, gain: 1 },
  shot_pistol: { src: lib('Walther PPQ/X_39P.wav'), takes: 3, len: 1.3, rate: 44100, gain: 1 },
  shot_quiet: { src: snake('Full Sound/.22LR/WAV/22LR Single WAV.wav'), len: 0.9, rate: 44100, gain: 0.8 },
  bolt: { src: snake('Reloads, Cycling & More/WAV/Mosin Bolt Cycle WAV.wav'), rate: 32000, gain: 0.8 },
  rifle_mag_out: { src: snake('Reloads, Cycling & More/WAV/308 Magazine Part 1 WAV.wav'), rate: 32000, gain: 0.75 },
  rifle_mag_in: { src: snake('Reloads, Cycling & More/WAV/308 Magazine Part 2 WAV.wav'), rate: 32000, gain: 0.75 },
  pistol_mag_out: { src: snake('Reloads, Cycling & More/WAV/Angel Mag Reload Part 1 WAV.wav'), rate: 32000, gain: 0.7 },
  pistol_mag_in: { src: snake('Reloads, Cycling & More/WAV/Angel Mag Reload Part 2 WAV.wav'), rate: 32000, gain: 0.7 },
  rack: { src: snake('Reloads, Cycling & More/WAV/Semi 22LR Rack WAV.wav'), rate: 32000, gain: 0.75 },
};

/** a .wav as one channel of numbers between -1 and 1 */
async function readWav(file) {
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
      const o = (i * fmt.channels + c) * bytes;
      sum += bytes === 2 ? data.readInt16LE(o) / 32768 : bytes === 3 ? data.readIntLE(o, 3) / 8388608 : bytes === 4 ? data.readInt32LE(o) / 2147483648 : (data[o] - 128) / 128;
    }
    out[i] = sum / fmt.channels;
  }
  return { rate: fmt.rate, x: out };
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
  const { rate, x } = await readWav(cfg.src);
  const starts = onsets(x, rate, (cfg.takes ?? 1) > 1).slice(0, cfg.takes ?? 1);
  if (!starts.length) throw new Error(`${name}: nothing loud in ${cfg.src}`);
  for (const [k, from] of starts.entries()) {
    const to = Math.min(x.length, cfg.len ? from + Math.round(cfg.len * rate) : x.length);
    let cut = resample(x.slice(from, to), rate, cfg.rate);
    let peak = 0;
    for (const v of cut) peak = Math.max(peak, Math.abs(v));
    const fade = Math.min(cut.length, Math.round(cfg.rate * 0.18));
    cut = cut.map((v, i) => (v / (peak || 1)) * 0.92 * cfg.gain * (i > cut.length - fade ? (cut.length - i) / fade : 1));
    const file = `${name}${k ? `_${k + 1}` : ''}.wav`;
    await writeWav(path.join(OUT, file), cut, cfg.rate);
    total += 44 + cut.length * 2;
    made.push(`${file} ${(cut.length / cfg.rate).toFixed(2)} s (began ${(from / rate).toFixed(3)} s into ${path.basename(cfg.src)})`);
  }
}
console.log(made.join('\n'));
console.log(`${made.length} recordings, ${(total / 1024).toFixed(0)} KB`);
