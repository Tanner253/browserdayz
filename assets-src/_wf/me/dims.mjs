// How big the pictures of a model are, as they came and as they are shipped.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const arg of process.argv.slice(2)) {
  if (arg.endsWith('.glb')) {
    const doc = await io.read(arg);
    let tris = 0;
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
    console.log(path.basename(arg), `${(fs.statSync(arg).size / 1e6).toFixed(2)} MB, ${Math.round(tris)} triangles; pictures:`, doc.getRoot().listTextures().map((t) => `${t.getSize()?.join('x')} ${t.getMimeType().split('/')[1]}`).join(', '));
    continue;
  }
  for (const f of walk(arg)) {
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(f).toLowerCase())) continue;
    const m = await sharp(f).metadata();
    console.log(`${m.width}x${m.height}`, (fs.statSync(f).size / 1e6).toFixed(1) + ' MB', f.split(path.sep).slice(-3).join('/'));
  }
}
