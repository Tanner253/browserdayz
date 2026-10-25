// A worn piece (public/assets/characters/wear/<id>.glb, scripts/wear.mjs) as a thing of its own: its skin let go and its
// points left where the body's rest put them, for a model of it lying on the ground (the stab vest, 2026-10-25, which
// had none but the black vest it took the place of).
//
//   node scripts/unskin.mjs <in.glb> <out.glb>
//
// Then scripts/lay-flat.mjs lays it down, and scripts/packs.mjs brings it in as any model.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { restPoints } from './meshy.mjs';

const [src, dest] = process.argv.slice(2);
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const root = doc.getRoot(), scene = root.listScenes()[0];
for (const node of root.listNodes()) {
  if (!node.getSkin()) continue;
  const prim = node.getMesh().listPrimitives()[0];
  const P = restPoints(node);
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(P.flatMap((p) => [p.x, p.y, p.z])));
  prim.setAttribute('POSITION', pos);
  // (the normals are the rest's too near enough: the pieces are made in the pose they rest in)
  for (const a of ['JOINTS_0', 'WEIGHTS_0', '_REGION']) prim.setAttribute(a, null);
  const mesh = node.getMesh();
  node.setSkin(null).setMesh(null);
  scene.addChild(doc.createNode(`${node.getName()}_ground`).setMesh(mesh));
}
// (the skeleton goes with the skin)
for (const n of scene.listChildren()) if (!n.getMesh()) scene.removeChild(n);
for (const s of root.listSkins()) s.dispose();
await doc.transform(prune());
// (written plain: the import reads its sources without the decoder)
for (const e of root.listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression') e.dispose();
await io.write(dest, doc);
console.log(`${dest}: unskinned`);
