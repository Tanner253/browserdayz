// node scripts/sky-phone.mjs: the sky a phone is sent (the owner, 2026-10-23: "we can use a weaker sky for phone yeah").
// A phone drew the 4k sky at half its size each way, every four points averaged as they came (src/world/atmosphere.ts
// `halve`), after fetching all twenty megabytes of it and unpacking them: some 130 MB of the page at once, in the game.
// This makes that same half-size picture once, here, the same way (three's own reading of the file, the same average
// of the same half floats), and writes it as a Radiance file of its own: what a phone draws is what it drew, to the
// file's own precision (one part in 255 of a point's brightest colour), from a file a quarter of the size.
import fs from 'node:fs';
import { DataUtils, HalfFloatType } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const SRC = 'public/assets/hdri/kloofendal_48d_partly_cloudy_puresky_4k.hdr';
const OUT = SRC.replace('_4k.hdr', '_2k.hdr');

const file = fs.readFileSync(SRC);
const loader = new HDRLoader().setDataType(HalfFloatType);
const sky = loader.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const { data, width, height } = sky;

// (the phone's own average, as atmosphere.ts makes it)
const w = width >> 1, h = height >> 1, half = new Uint16Array(w * h * 4);
const light = DataUtils.fromHalfFloat, toHalf = DataUtils.toHalfFloat;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const a = (y * 2 * width + x * 2) * 4, b = a + 4, c = a + width * 4, d = c + 4, o = (y * w + x) * 4;
    for (let k = 0; k < 3; k++) half[o + k] = toHalf((light(data[a + k]) + light(data[b + k]) + light(data[c + k]) + light(data[d + k])) / 4);
    half[o + 3] = data[a + 3];
  }
}

// (written for three's reading of it: a colour is its byte times 2^(e-128) / 255, so each byte is the colour's share
// of the brightest one's power of two, rounded)
const rgbe = new Uint8Array(w * h * 4);
for (let i = 0; i < w * h; i++) {
  const r = light(half[i * 4]), g = light(half[i * 4 + 1]), b = light(half[i * 4 + 2]);
  const v = Math.max(r, g, b);
  if (!(v > 1e-30)) continue;
  let e = Math.ceil(Math.log2(v));
  if (Math.round((v * 255) / 2 ** e) > 255) e++;
  const s = 255 / 2 ** e;
  rgbe[i * 4] = Math.round(r * s);
  rgbe[i * 4 + 1] = Math.round(g * s);
  rgbe[i * 4 + 2] = Math.round(b * s);
  rgbe[i * 4 + 3] = e + 128;
}

// (each row run-length packed, a channel at a time, as Radiance writes them)
const out = [];
const put = (...b) => { for (const x of b) out.push(x); };
const MIN_RUN = 4;
function channel(row) {
  const n = row.length;
  let cur = 0;
  while (cur < n) {
    let beg = cur, run = 0, oldRun = 0;
    while (run < MIN_RUN && beg < n) {
      beg += run;
      oldRun = run;
      run = 1;
      while (beg + run < n && run < 127 && row[beg] === row[beg + run]) run++;
    }
    if (oldRun > 1 && oldRun === beg - cur) {
      put(128 + oldRun, row[cur]);
      cur = beg;
    }
    while (cur < beg) {
      const k = Math.min(128, beg - cur);
      put(k);
      for (let j = 0; j < k; j++) put(row[cur + j]);
      cur += k;
    }
    if (run >= MIN_RUN) {
      put(128 + run, row[beg]);
      cur += run;
    }
  }
}
const row = new Uint8Array(w);
for (let y = 0; y < h; y++) {
  put(2, 2, w >> 8, w & 255);
  for (let k = 0; k < 4; k++) {
    for (let x = 0; x < w; x++) row[x] = rgbe[(y * w + x) * 4 + k];
    channel(row);
  }
}
const head = Buffer.from(`#?RADIANCE\n# ${SRC.split('/').pop()} at half its size each way (scripts/sky-phone.mjs)\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'latin1');
const bytes = Buffer.concat([head, Buffer.from(out)]);

// (read back as the phone will read it, and held to the average it stands for)
const back = loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
if (back.width !== w || back.height !== h) throw new Error(`read back ${back.width}x${back.height}, not ${w}x${h}`);
let worst = 0;
for (let i = 0; i < w * h; i++) {
  const m = Math.max(light(half[i * 4]), light(half[i * 4 + 1]), light(half[i * 4 + 2]));
  if (!(m > 0)) continue;
  for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(light(back.data[i * 4 + k]) - light(half[i * 4 + k])) / m);
}
if (worst > 1 / 255) throw new Error(`read back off by ${worst} of a point's brightest colour`);
fs.writeFileSync(OUT, bytes);
console.log(`${OUT}: ${w}x${h}, ${(bytes.length / 1048576).toFixed(2)} MB (from ${(file.length / 1048576).toFixed(2)}); read back within ${(worst * 255).toFixed(3)}/255 of the phone's average`);
