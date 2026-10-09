// The combat helmet, built by itself: `node scripts/helmet.mjs` (add --force to build it
// again whatever has changed). It is one of the things in LOCAL_MODELS (assets.config.mjs)
// and `npm run assets` builds it with the rest; this builds only it, asks nothing of the
// network, and writes it into the manifest and the credits where the whole run would.

import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { LOCAL_MODELS } from './assets.config.mjs';
import { processProp } from './props.mjs';

const ID = 'combat_helmet';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'assets-src'), OUT = path.join(ROOT, 'public', 'assets');
const exists = (p) => fs.access(p).then(() => true, () => false);
const countTris = (doc) => {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
  return Math.round(tris);
};
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const made = await processProp(ID, LOCAL_MODELS[ID], { io, SRC, OUT, FORCE: process.argv.includes('--force'), exists, countTris });

const file = path.join(OUT, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
manifest.models[ID] = made.entry;
// (asset addresses carry the manifest's date: moved on, so no browser keeps an old one)
manifest.generated = new Date().toISOString();
await fs.writeFile(file, JSON.stringify(manifest, null, 1));

const creditsPath = path.join(ROOT, 'CREDITS.md');
const credits = await fs.readFile(creditsPath, 'utf8');
if (!credits.includes(made.credit.line)) {
  const nl = credits.includes('\r\n') ? '\r\n' : '\n';
  const at = credits.indexOf(`${nl}- "Uaz-469"`);
  if (at < 0) throw new Error('CREDITS.md is not laid out as expected: add the credit by hand');
  await fs.writeFile(creditsPath, `${credits.slice(0, at)}${nl}- ${made.credit.line}${nl}  Changes made: ${made.credit.changes}${credits.slice(at)}`);
  console.log('credited in CREDITS.md');
}
