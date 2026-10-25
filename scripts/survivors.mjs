// Builds the survivors' bodies: public/assets/characters/body_{0..3}.glb, one for each survivor a player can be.
//
//   node scripts/survivors.mjs          all of them
//   node scripts/survivors.mjs 2        only body_2
//
// The owner, 2026-10-24: "we should make a higher quality player model and perhaps even variations"; and of the
// clothes the first ones wore: "those clothes items should be items we bring into the game". So each body is a
// survivor in a plain base layer (T-shirt and shorts, barefoot), and everything over it is a thing worn.
//
// Sources (assets-src/incoming/higgsfield/survivors/, gitignored): made in Higgsfield on 2026-10-25 from four faces
// drawn there, each edited down to the base layer with its hands open and its fingers spread, drawn again from behind,
// and made 3D by Meshy (multi-image, A-pose, rigged, 20k triangles). Meshy rigs a body on 24 bones and none in the
// hands, and every movement the game has is drawn for its own 65, fingers and all. So:
//
//   1. Its paint is made plain (evenOut), and the fingers are found on each hand and bound (fitHand), each finger's
//      first joint where the game's skeleton has it (rooted).
//   2. The body is carried onto the game's skeleton as the tactical suit is (scripts/suit.mjs, wearSuit): the
//      skeleton's limbs turned to lie along the body's, every point carried with the joints it hangs on, and bound
//      there. It keeps the game's skeleton, not its own: every clip, every gun grip and every hat in GEAR is made
//      for that one, so all four are that size (the woman too: her own build, the skeleton's height).
//
// What is written is the body alone, on the skeleton (no clips): the game puts it on a survivor's own bones by
// their names (src/game/survivors.ts).

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, unpartition, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { carry, markRegions } from './meshy.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
// (assets-src lives in the main checkout only: a session's worktree reads it from there)
const SRC_ROOT = existsSync(path.join(ROOT, 'assets-src')) ? path.join(ROOT, 'assets-src') : path.resolve(ROOT, '..', '..', '..', 'assets-src');
const SRC = path.join(SRC_ROOT, 'incoming', 'higgsfield', 'survivors');
const TEMPLATE = path.join(SRC_ROOT, 'characters', 'plain.glb');
const OUT = path.join(ROOT, 'public', 'assets', 'characters');
/** a colour or normal map at most this across (the owner's cap); what is only roughness, half */
const TEX = 2048;
const TEX_ROUGH = 1024;

/** the bodies, by the number a player picks */
const BODIES = ['body0_rigged.glb', 'body1_rigged.glb', 'body2_rigged.glb', 'body3_rigged.glb'];
const ONLY = process.argv.slice(2).map(Number);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

await fs.access(TEMPLATE).catch(() => {
  throw new Error('survivors: run "node scripts/build-character.mjs --infected" first (it makes assets-src/characters/plain.glb)');
});
for (const [n, file] of BODIES.entries()) {
  if (ONLY.length && !ONLY.includes(n)) continue;
  const { doc, node, hands, worn } = await carry({ io, template: TEMPLATE, src: await io.read(path.join(SRC, file)), fingers: true });
  const root = doc.getRoot();
  const regions = markRegions(doc, node);
  for (const m of root.listMaterials()) m.setName(`survivor_${n}`);
  await doc.transform(
    unpartition(),
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(baseColor|normal|emissive)Texture$/, resize: [TEX, TEX], quality: 90 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(metallicRoughness|occlusion)Texture$/, resize: [TEX_ROUGH, TEX_ROUGH], quality: 90 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const dest = path.join(OUT, `body_${n}.glb`);
  await io.write(dest, doc);
  const st = await fs.stat(dest);
  const triangles = root.listMeshes().reduce((k, m) => k + m.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  console.log(`${path.basename(dest)}  ${(st.size / 1048576).toFixed(2)} MB  ${Math.round(triangles)} triangles\n  hands: ${hands}\n  ${regions}\n  ${worn}`);
}
