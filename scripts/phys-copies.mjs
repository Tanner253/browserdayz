// A copy of a rock piece for what stops a body at it: `<id>_phys.glb`, its shape alone (no pictures, no normals) at a
// few thousand triangles at most, made from its far copy by collapsing the edges that change its shape least
// (meshoptimizer), never further than ERROR of its own size. Kept as its second lighter copy (`lods[1]`: loaded as
// assets.model(id, 2)) and used by src/world/caves.ts for the pass's wall pieces near the eye.
//
// Why (2026-10-16, measured on the pass's shelves): the hull of a cliff face round its far copy stood up to 2.9 m in
// front of the rock that is seen, an invisible wall on one level ray in five; the far copies themselves, one collider
// each for all 217 pieces, would be a million triangles of physics.
//
//   node scripts/phys-copies.mjs <id> ...      (namaqualand_cliff_02 mountainside namaqualand_cliff_01)
import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { flatten, join, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

/** the most it may go from its own shape, as a share of its size; and the fewest triangles it is taken down to */
const ERROR = 0.003;
const FEWEST = 600;

const ids = process.argv.slice(2);
if (!ids.length) throw new Error('node scripts/phys-copies.mjs <id> ...');
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const OUT = path.join(ROOT, 'public', 'assets'), file = path.join(OUT, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
const countTris = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) n += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
  return Math.round(n);
};
for (const id of ids) {
  const entry = manifest.models[id];
  if (!entry?.lods?.[0]) throw new Error(`${id}: no far copy to make it from`);
  const doc = await io.read(path.join(OUT, '..', entry.lods[0].url));
  // the shape alone: every piece of it one, no pictures, nothing but where its corners are
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    prim.setMaterial(null);
    for (const sem of prim.listSemantics()) if (sem !== 'POSITION') prim.setAttribute(sem, null);
  }
  await doc.transform(flatten(), join({ keepNamed: false }), weld(), prune());
  const before = countTris(doc), size = Math.hypot(...entry.max.map((v, i) => v - entry.min[i]));
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, FEWEST / before), error: ERROR, lockBorder: false }), prune());
  doc.getRoot().listExtensionsUsed().forEach((e) => e.dispose());
  const url = `assets/models/${id}_phys.glb`;
  await io.write(path.join(OUT, '..', url), doc);
  const tris = countTris(doc), bytes = (await fs.stat(path.join(OUT, '..', url))).size;
  entry.lods = [entry.lods[0], { url, tris }];
  console.log(`${id}: ${before} -> ${tris} triangles, held to ${(ERROR * size * 100).toFixed(1)} cm of its ${size.toFixed(1)} m, ${(bytes / 1024).toFixed(0)} KB`);
}
await fs.writeFile(file, JSON.stringify(manifest, null, 1));
