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
import * as THREE from 'three';
import { carry, headOf, legJoints, markRegions, padTexture, restPoints, plainHands, straightenLegs, suitWeights, waistOf } from './meshy.mjs';

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
/**
 * how tall each stands, metres: Mikhail, Pavel, Anya, Grigori (Meshy rigged all four 1.8 m tall; carried on legs of the
 * game's length they came out one height, the woman with the men). Said on the body (`stands`, with its `height` as
 * built), and the game draws it so (Avatar.proportion).
 */
const STANDS = [1.8, 1.82, 1.68, 1.76];
const ONLY = process.argv.slice(2).map(Number);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
/** the old suit, whose weights each body takes (suitWeights in scripts/meshy.mjs) */
const SUIT = await io.read(path.join(OUT, 'survivor.glb'));

/**
 * The base layer's cloth made clean (the navigator, 2026-10-25: the shorts "carry orange-red streaks that read as texture
 * faults up close"). Meshy's picture has slivers of skin in the shorts and the T-shirt: in every triangle of the body
 * that is cloth (grey at two of its corners, over the trunk, the upper arms and the thighs), what of the picture is
 * coloured (skin, and the orange streaks the shorts had) is painted over from the grey cloth around it, a ring at a time.
 */
async function cleanCloth(doc, node) {
  const prim = node.getMesh().listPrimitives()[0], tex = prim.getMaterial().getBaseColorTexture();
  const uv = prim.getAttribute('TEXCOORD_0'), region = prim.getAttribute('_REGION'), idx = prim.getIndices();
  const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = 4;
  const px = (s, t) => [Math.min(W - 1, Math.max(0, Math.round(s * (W - 1)))), Math.min(H - 1, Math.max(0, Math.round(t * (H - 1))))];
  const grey = (o) => Math.max(data[o], data[o + 1], data[o + 2]) - Math.min(data[o], data[o + 1], data[o + 2]) < 26;
  const skin = (o) => data[o] >= data[o + 1] && data[o] >= data[o + 2] && data[o] - Math.min(data[o + 1], data[o + 2]) > 28;
  const CLOTH = new Set([3, 4, 5, 6, 7, 10, 11]);
  // (Which triangles are cloth: grey at two corners, and then by the surface round them, five times over, so that a
  // patch of skin colour inside the cloth is cloth: Meshy drew the hands, hanging by the thighs in its picture, onto the
  // shorts' sides. A patch as wide as the leg below the hem stays skin.)
  const pos = prim.getAttribute('POSITION'), V = pos.getCount(), N3 = idx.getCount() / 3;
  const weld = new Map(), at = new Int32Array(V);
  for (let i = 0; i < V; i++) {
    const k = pos.getElement(i, []).map((v) => Math.round(v * 2e4)).join(',');
    if (!weld.has(k)) weld.set(k, weld.size);
    at[i] = weld.get(k);
  }
  const corner = (t) => [idx.getScalar(t * 3), idx.getScalar(t * 3 + 1), idx.getScalar(t * 3 + 2)];
  const byPoint = Array.from({ length: weld.size }, () => []);
  for (let t = 0; t < N3; t++) for (const i of corner(t)) byPoint[at[i]].push(t);
  let isCloth = new Uint8Array(N3);
  const within = new Uint8Array(N3);
  for (let t = 0; t < N3; t++) {
    const v = corner(t);
    within[t] = v.every((i) => CLOTH.has(region.getScalar(i))) ? 1 : 0;
    isCloth[t] = within[t] && v.filter((i) => grey((px(...uv.getElement(i, []))[1] * W + px(...uv.getElement(i, []))[0]) * C)).length >= 2 ? 1 : 0;
  }
  for (let pass = 0; pass < 5; pass++) {
    const was = isCloth.slice();
    for (let t = 0; t < N3; t++) {
      if (!within[t]) continue;
      let yes = 0, all = 0;
      for (const i of corner(t)) for (const u of byPoint[at[i]]) if (u !== t) (yes += was[u]), all++;
      if (all) isCloth[t] = yes * 2 > all ? 1 : was[t];
    }
  }
  const mask = new Uint8Array(W * H);
  let tris = 0;
  for (let t3 = 0; t3 < idx.getCount(); t3 += 3) {
    if (!isCloth[t3 / 3]) continue;
    const v = corner(t3 / 3);
    const P = v.map((i) => px(...uv.getElement(i, [])));
    tris++;
    // (every texel the triangle covers on the picture, and one more round it)
    const [x0, x1] = [Math.min(...P.map((p) => p[0])) - 1, Math.max(...P.map((p) => p[0])) + 1], [y0, y1] = [Math.min(...P.map((p) => p[1])) - 1, Math.max(...P.map((p) => p[1])) + 1];
    const [[ax, ay], [bx, by], [cx, cy]] = P, den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (!den) continue;
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
      const e = 1.5 / Math.max(1, Math.abs(den) ** 0.5);
      if (l1 >= -e && l2 >= -e && 1 - l1 - l2 >= -e) mask[y * W + x] = 1;
    }
  }
  // (the shirt's neckline is the shirt, whatever bone it hangs on: hidden under a top with the chest, or its collar
  // showed through a flannel's at the nape, 2026-10-25)
  for (let i = 0; i < uv.getCount(); i++) {
    if (region.getScalar(i) !== 2) continue;
    const [x, y] = px(...uv.getElement(i, [])), o = (y * W + x) * C;
    if (grey(o) && data[o] > 70) region.setScalar(i, 3);
  }
  // (and three texels round them: the shorts are made of needles of triangles, each drawn from a strip of the picture a
  // texel or two wide, and the picture's smoothing reads the skin beside the strip into it)
  for (let r = 0; r < 3; r++) {
    const grow = [];
    for (let k = 0; k < W * H; k++) {
      if (mask[k]) continue;
      const x = k % W, y = (k / W) | 0;
      if ((x > 0 && mask[k - 1] === 1) || (x < W - 1 && mask[k + 1] === 1) || (y > 0 && mask[k - W] === 1) || (y < H - 1 && mask[k + W] === 1)) grow.push(k);
    }
    for (const k of grow) mask[k] = 1;
  }
  // (painted over from the cloth beside it: each pass, a skin texel with cloth next to it takes their mean)
  let bad = [];
  for (let k = 0; k < W * H; k++) if (mask[k] && !grey(k * C)) bad.push(k);
  const fixed = bad.length;
  for (let pass = 0; pass < 40 && bad.length; pass++) {
    const left = [], took = [];
    for (const k of bad) {
      const x = k % W, y = (k / W) | 0, m = [0, 0, 0];
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const q = (y + dy) * W + x + dx;
        if ((dx || dy) && x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H && mask[q] === 1 && grey(q * C)) {
          for (let c = 0; c < 3; c++) m[c] += data[q * C + c];
          n++;
        }
      }
      if (n) took.push([k, m.map((c) => c / n)]);
      else left.push(k);
    }
    for (const [k, m] of took) for (let c = 0; c < 3; c++) data[k * C + c] = Math.round(m[c]);
    bad = left;
  }
  tex.setImage(new Uint8Array(await sharp(data, { raw: { width: W, height: H, channels: C } }).png().toBuffer())).setMimeType('image/png');
  return `cloth ${tris} triangles, ${fixed} skin texels painted over${bad.length ? `, ${bad.length} left` : ''}`;
}

await fs.access(TEMPLATE).catch(() => {
  throw new Error('survivors: run "node scripts/build-character.mjs --infected" first (it makes assets-src/characters/plain.glb)');
});
/** the skeleton's own body, for its hands (see plainHands) */
const PLAIN = await io.read(TEMPLATE);
for (const [n, file] of BODIES.entries()) {
  if (ONLY.length && !ONLY.includes(n)) continue;
  const { doc, node, hands, worn, proportions } = await carry({ io, template: TEMPLATE, src: await io.read(path.join(SRC, file)), fingers: true });
  const root = doc.getRoot();
  const regions = markRegions(doc, node);
  // (its legs stood as the skeleton stands them: see straightenLegs)
  const moved = straightenLegs(node, legJoints(node));
  // (weighted as the old suit is, not as Meshy rigged it: see suitWeights)
  const weighted = suitWeights(node, SUIT);
  console.log(`  ${plainHands(node, PLAIN)}`);
  // (the picture between its islands filled from them first: what lay there came in at every island's edge; then the
  // cloth mended, as its strips are narrower than what the filling shaves off an island's edge)
  {
    const prim = node.getMesh().listPrimitives()[0], idx = prim.getIndices(), tris = [];
    for (let t = 0; t < idx.getCount(); t += 3) tris.push([idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)]);
    await padTexture(prim, tris);
  }
  const cloth = await cleanCloth(doc, node);
  {
    const pos = node.getMesh().listPrimitives()[0].getAttribute('POSITION');
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pos.getCount(); i++) {
      const v = pos.getElement(i, [])[1];
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    // (and its head and chest against the joints that carry what is worn there, at rest, metres, facing +z: the game
    // hangs hats, vests and packs by these, against the old suit's (SUIT_FIT in src/game/avatar/gear.ts), Avatar.gearFit)
    const P = restPoints(node), region = node.getMesh().listPrimitives()[0].getAttribute('_REGION');
    const joint = (name) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(node.getSkin().listJoints().find((j) => j.getName() === name).getWorldMatrix()));
    const head = joint('Head'), sp = joint('spine_03');
    // (the hair that stands off the skull behind, Anya's bun, a part of its own (hair in REGION, src/sim/survivor.ts):
    // not drawn under what closes round the head (bareWorn in src/game/survivors.ts). The men's skulls reach 9 cm
    // behind the joint, her bun 13)
    let hair = 0;
    P.forEach((p, i) => {
      if (region.getScalar(i) <= 1 && p.z - head.z < -0.1) {
        region.setScalar(i, 14);
        hair++;
      }
    });
    if (hair) console.log(`body ${n}: ${hair} points of hair off the skull`);
    const skull = new THREE.Box3().setFromPoints(P.filter((p, i) => region.getScalar(i) <= 1));
    const chest = new THREE.Box3().setFromPoints(P.filter((p, i) => region.getScalar(i) === 3 && Math.abs(p.y - sp.y) < 0.04 && Math.abs(p.x) < 0.21));
    const r = (v) => +v.toFixed(4);
    const fit = { crown: r(skull.max.y - head.y), headZ: r((skull.min.z + skull.max.z) / 2 - head.z), headDepth: r(skull.max.z - skull.min.z), chestMin: r(chest.min.z - sp.z), chestMax: r(chest.max.z - sp.z), chestWidth: r(chest.max.x - chest.min.x), ...waistOf(node), ...headOf(node) };
    node.setExtras({ ...node.getExtras(), height: +(hi - lo).toFixed(4), stands: STANDS[n], fit });
  }
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
  console.log(`${path.basename(dest)}  ${(st.size / 1048576).toFixed(2)} MB  ${Math.round(triangles)} triangles\n  ${proportions}\n  hands: ${hands}\n  ${regions}
  ${moved}
  ${weighted}\n  ${cloth}\n  ${worn}`);
}
