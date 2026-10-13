import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import fs from 'node:fs';
const m = JSON.parse(fs.readFileSync('public/assets/manifest.json', 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const id of process.argv.slice(2)) {
  const e = m.models[id];
  try {
    const doc = await io.read('public/' + e.file);
    const b = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
    const s = e.scale ?? 1;
    console.log(id.padEnd(24), 'file', e.file.split('/').pop(), 'scale', s, 'size', b.max.map((v, i) => ((v - b.min[i]) * s).toFixed(2)).join(' x '), 'min y', (b.min[1] * s).toFixed(2), JSON.stringify({ ...e, file: undefined, hi: undefined, lods: undefined }).slice(0, 160));
  } catch (err) { console.log(id, 'ERR', String(err.message).slice(0, 100)); }
}
