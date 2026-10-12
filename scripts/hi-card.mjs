// What each model's full-size copy weighs on the graphics card once its pictures are unpacked there (megabytes:
// four bytes a pixel, and a third again for the smaller copies the card makes of each), written into the manifest as
// `hiCard`. The game keeps what is sharp at any one time within a budget of this (src/game/near.ts): a picture of
// four thousand pixels a side is 85 MB there, and a room full of things with ten such each was more than a card of
// eight gigabytes had left.
//   node scripts/hi-card.mjs            the manifest brought up to date
//   node scripts/hi-card.mjs <id> 2048  that model's full-size pictures made no bigger than 2048 a side first
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const file = path.join(ROOT, 'public/assets/manifest.json');
const m = JSON.parse(fs.readFileSync(file, 'utf8'));
const [, , only, capArg] = process.argv;
if (only && capArg) {
  const cap = Number(capArg), e = m.models[only];
  if (!e?.hi) throw new Error(`${only} has no full-size copy`);
  const f = path.join(ROOT, 'public', e.hi), doc = await io.read(f);
  const was = Math.max(0, ...doc.getRoot().listTextures().map((t) => Math.max(...(t.getSize() ?? [0, 0]))));
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cap, cap], quality: 92 }));
  await io.write(f, doc);
  e.hiBytes = fs.statSync(f).size;
  console.log(`${only}: its full-size pictures were ${was} a side, now no more than ${cap}; the file is ${(e.hiBytes / 1048576).toFixed(1)} MB`);
}
let all = 0;
for (const [id, e] of Object.entries(m.models)) {
  if (!e.hi) continue;
  const doc = await io.read(path.join(ROOT, 'public', e.hi));
  const mb = doc.getRoot().listTextures().reduce((s, t) => { const [w, h] = t.getSize() ?? [0, 0]; return s + (w * h * 4 * 4) / 3 / 1048576; }, 0);
  e.hiCard = Math.round(mb);
  all += e.hiCard;
}
fs.writeFileSync(file, JSON.stringify(m, null, 1));
console.log(`hiCard written for ${Object.values(m.models).filter((e) => e.hi).length} models; all of them sharp at once would be ${all} MB`);
