// Builds the infected: public/assets/characters/zombie_<kind>.glb, one body for each kind of them.
//
//   node scripts/infected.mjs              all of them
//   node scripts/infected.mjs villager     only that one
//
// The owner, 2026-10-25: "our zombies models need to be completley redone ... higgsfield can give us way better dyanmic
// zombies and meshes and models for the zombies to be extremely scary and realistic and uncanny valley we also need lots
// of variations". Twelve kinds, each drawn in Higgsfield front and back in an A-pose and made 3D by Meshy
// (multi-image, rigged, about 18k triangles): assets-src/incoming/higgsfield/zombies/<kind>_rigged.glb (gitignored;
// the pictures and their job numbers are in progress/zombies). The plan the owner said yes to: marketing/plan-zombies.html.
//
// Each is carried onto the game's 65 bones as the survivors are (scripts/survivors.mjs): its paint made plain and its
// fingers found and bound there (evenOut, giveFingers), then the skeleton fitted to the body (fitSkeleton: the joints
// moved to where this body has them, never the body stretched to the joints) and the body bound to it (wearSuit).
//
// Many are about at once, so each file holds the body twice on the one skeleton: `body` as it was made, and
// `body_far`, the same points drawn with a fifth of the triangles and a small picture, for whoever is past FAR_FROM
// (src/game/avatar). The far one shares the near one's points: it costs its triangles and its picture, nothing else.

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, unpartition, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { wearSuit, fitSkeleton } from './suit.mjs';
import { MIXAMO, evenOut, giveFingers } from './survivors.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
// (assets-src lives in the main checkout only: a session's worktree reads it from there)
const SRC_ROOT = existsSync(path.join(ROOT, 'assets-src')) ? path.join(ROOT, 'assets-src') : path.resolve(ROOT, '..', '..', '..', 'assets-src');
const SRC = path.join(SRC_ROOT, 'incoming', 'higgsfield', 'zombies');
const TEMPLATE = path.join(SRC_ROOT, 'characters', 'plain.glb');
const OUT = path.join(ROOT, 'public', 'assets', 'characters');
/** the near body's picture at most this across (the owner's cap), the far one's this */
const TEX = 2048;
const TEX_FAR = 512;
/** the far body's share of the near one's triangles */
const FAR_SHARE = 0.22;

const KINDS = ['villager', 'babushka', 'oldman', 'worker', 'conscript', 'militia', 'patient', 'nurse', 'hazmat', 'bloated', 'starved', 'burned'];
const ONLY = process.argv.slice(2);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const M4 = (a) => new THREE.Matrix4().fromArray(a);
const at = (m) => new THREE.Vector3().setFromMatrixPosition(m);

/**
 * The far body: a node beside `body` on the same skin, drawing the same points with fewer triangles, painted from a
 * small copy of the body's picture.
 * (Meshy's picture is cut into hundreds of islands, each with points of its own along its edges, and the simplifier
 * will not cross an edge with nothing beyond it: it stopped at half. So it is brought down on the shape alone, every
 * place one point, and each corner of what is kept then takes whichever of that place's points lies, in the picture,
 * nearest the other two corners' points: the triangle is painted from one island where it can be.)
 */
async function giveFar(doc, body) {
  const near = body.getMesh().listPrimitives()[0];
  const P = new Float32Array(near.getAttribute('POSITION').getArray()), UV = near.getAttribute('TEXCOORD_0').getArray();
  const I = new Uint32Array(near.getIndices().getArray());
  // (the places in a buffer of their own: given the picture's points beside them, the simplifier still took every place
  // with two points for a seam, and kept them all)
  const place = new Map(), one = new Uint32Array(P.length / 3), copies = [], U = [];
  for (let i = 0; i < one.length; i++) {
    const k = `${P[i * 3]},${P[i * 3 + 1]},${P[i * 3 + 2]}`;
    if (!place.has(k)) {
      place.set(k, copies.length);
      copies.push([]);
      U.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    }
    one[i] = place.get(k);
    copies[one[i]].push(i);
  }
  const [kept] = MeshoptSimplifier.simplify(I.map((i) => one[i]), new Float32Array(U), 3, Math.floor((I.length * FAR_SHARE) / 3) * 3, 0.05, []);
  const uv = (i) => [UV[i * 2], UV[i * 2 + 1]];
  const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const out = new Uint32Array(kept.length);
  for (let t = 0; t < kept.length; t += 3) {
    const c = [0, 1, 2].map((k) => copies[kept[t + k]]);
    let best = Infinity;
    for (const a of c[0]) for (const b of c[1]) for (const d of c[2]) {
      const s = apart(uv(a), uv(b)) + apart(uv(b), uv(d)) + apart(uv(d), uv(a));
      if (s < best) (best = s), (out[t] = a), (out[t + 1] = b), (out[t + 2] = d);
    }
  }
  const far = near.clone().setIndices(doc.createAccessor().setType('SCALAR').setArray(out).setBuffer(near.getIndices().getBuffer()));
  const mat = near.getMaterial().clone().setName(`${near.getMaterial().getName()}_far`);
  const tex = mat.getBaseColorTexture();
  if (tex) {
    const small = await sharp(Buffer.from(tex.getImage())).resize(TEX_FAR, TEX_FAR).png().toBuffer();
    mat.setBaseColorTexture(doc.createTexture(`${tex.getName()}_far`).setImage(new Uint8Array(small)).setMimeType('image/png'));
  }
  far.setMaterial(mat);
  const node = doc.createNode('body_far').setMesh(doc.createMesh('body_far').addPrimitive(far)).setSkin(body.getSkin());
  node.setTranslation(body.getTranslation()).setRotation(body.getRotation()).setScale(body.getScale());
  for (const parent of body.listParents()) if (parent.propertyType === 'Node' || parent.propertyType === 'Scene') parent.addChild(node);
  return `far ${out.length / 3} of ${I.length / 3} triangles`;
}

await fs.access(TEMPLATE).catch(() => {
  throw new Error('infected: run "node scripts/build-character.mjs --infected" first (it makes assets-src/characters/plain.glb)');
});
for (const kind of KINDS) {
  if (ONLY.length && !ONLY.includes(kind)) continue;
  const file = path.join(SRC, `${kind}_rigged.glb`);
  if (!existsSync(file)) {
    console.log(`${kind}: no ${path.relative(SRC_ROOT, file)} yet`);
    continue;
  }
  let suit = await io.read(file);
  const doc = await io.read(TEMPLATE);
  const root = doc.getRoot();
  const nodes = new Map(root.listNodes().map((x) => [x.getName(), x]));
  // (the skeleton as it rests, as giveFingers wants it: where the game's fingers start, at the game's height)
  const rest = new Map(nodes.get('body').getSkin().listJoints().map((j) => [j.getName(), at(M4(j.getWorldMatrix()))]));
  const ours = { rest, height: rest.get('Head').y - rest.get('foot_l').y };
  evenOut(suit);
  let hands;
  try {
    hands = giveFingers(suit, ours);
    // (and a finding that cannot be a hand is not taken: the Villager's thumb "parted" 2.9 cm from the wrist and a
    // finger was 4 cm long, the rags of its torn sleeve taken for them, and they curled into a lump at the elbow. On
    // the hands that were found right, every thumb parts 8 cm or more out and no finger is under 6.)
    const parts = [...hands.matchAll(/parting at ([\d.]+)/g)].map((m) => +m[1]);
    const lengths = [...hands.matchAll(/fingers ([\d. ]+) cm/g)].flatMap((m) => m[1].trim().split(/\s+/).map(Number));
    if (parts.some((x) => x < 6) || lengths.some((x) => x < 6)) throw new Error(`not a hand: ${hands}`);
  } catch (e) {
    // (Fingers drawn held together are not told apart: the survivors were drawn with theirs spread, these mostly
    // were not. Such a hand is kept whole on the hand's bone, in the curl it was modelled with, as the hazmat's
    // always was. Its bones named as giveFingers names them, on a fresh copy: the one it gave up on is half done.)
    suit = await io.read(file);
    evenOut(suit);
    for (const j of suit.getRoot().listSkins()[0].listJoints()) j.setName(`${MIXAMO[j.getName()] ?? j.getName()}_0`);
    suit.getRoot().listNodes().find((n) => n.getMesh() && n.getSkin()).getMesh().setName('survivor');
    for (const a of suit.getRoot().listAnimations()) a.dispose();
    hands = `kept whole (${e.message})`;
  }
  const old = ['eyes', 'eyebrows', 'hair_buzzed', 'hair_parted', 'hair_long', 'hair_beard'].map((x) => nodes.get(x)).filter(Boolean);
  // (the skeleton to the body, not the body to the skeleton; the toes lie as the foot lies: Meshy's toe bone has no end to lie along)
  const fitted = fitSkeleton({ doc, bodyNode: nodes.get('body'), suit, prefix: '', toes: false });
  const worn = await wearSuit({ doc, io, bodyNode: nodes.get('body'), old, suit, pieces: { body: [[/^survivor$/, null]] }, moved: {}, prefix: '', toes: false });
  // the body alone: its movements are every kind's, in one file (scripts/mocap-infected.mjs, src/game/infected-moves.ts)
  for (const a of root.listAnimations()) {
    for (const c of a.listChannels()) c.dispose();
    for (const x of a.listSamplers()) x.dispose();
    a.dispose();
  }
  for (const m of root.listMaterials()) m.setMetallicFactor(0).setName(`zombie_${kind}`);
  const far = await giveFar(doc, root.listNodes().find((n) => n.getName() === 'body'));
  await doc.transform(
    unpartition(),
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColorTexture$/, resize: [TEX, TEX], quality: 90 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const dest = path.join(OUT, `zombie_${kind}.glb`);
  await io.write(dest, doc);
  const st = await fs.stat(dest);
  const triangles = (name) => root.listNodes().find((n) => n.getName() === name)?.getMesh()?.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0) ?? 0;
  console.log(`${path.basename(dest)}  ${(st.size / 1048576).toFixed(2)} MB  ${Math.round(triangles('body'))} triangles, ${far}\n  hands: ${hands}\n  ${fitted}\n  ${worn}`);
}
