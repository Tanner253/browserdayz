// Builds the balaclava as it is worn on each survivor: public/assets/characters/wear/balaclava_<body>.glb
//
//   node scripts/balaclava.mjs
//
// The owner, 2026-10-25: "the facemask is not looking good, should cover face like our old player model does, we had a
// green face mask on our old player model". It is that mask: the old suit's own head, a soldier in a green knitted
// balaclava with only the eyes showing (public/assets/characters/survivor.glb, `head`). A shell from Higgsfield hung on
// the head stood off the face and showed the forehead.
//
//   1. The suit's head stood at its rest and set on each body's: sized to the body's head across, its skull's top on
//      the body's (headOf in scripts/meshy.mjs: where the hats sit, so a hat sits on it as on the head).
//   2. Its neck drawn down past the collar and laid on the body (the owner, 2026-10-25: "needs to go down into the chest
//      more with it falling behind the shirt, so theres no gap ... a floating head look"): the bodies' necks are longer
//      than the suit's, so all of it under the chin is stretched down to below the neck joint, and from the chin down it
//      comes onto the skin, a few millimetres out, under whatever top is worn over it.
//   3. Above that, pushed out wherever the body under it that is still drawn would come through, the push evened over
//      the knit (the scalp, face and hair are hidden under it).
//   4. Weighted as the skin under it is (as the clothes are, scripts/wear.mjs), so it bends at the neck as the neck does.
//
// Its knit is one material, coloured as the item's colour says (src/game/survivors.ts, clothPatch); the eyes and the
// skin round them another (`own`), never coloured. Not drawn in first person (`head`): the camera is inside it.
import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { M4, headOf, restPoints } from './meshy.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const CHAR = path.join(ROOT, 'public', 'assets', 'characters');
/** the regions of a body hidden under it (REGION in src/sim/survivor.ts): scalp, face, neck, hair */
const UNDER = new Set([0, 1, 2, 14]);
/** how far clear of what is drawn of the body it stays, in the body's own units (its file's: about 0.88 m to one) */
const CLEAR = 0.005;
/** how far under the neck joint its hem goes, into the chest under a top (the same units) */
const HEM = 0.06;
/** where under the Head joint it begins to come onto the body (the chin), and where it lies on it wholly */
const CHIN = 0.045, ON = 0.085;
/** how far off the skin it lies there, over the throat (hidden under it); and how far under the skin of the chest, so
 * that it is behind any top and goes into the bare skin at the base of the neck */
const SKIN = 0.003, TUCKED = 0.002;
/** and how much further from the eye that part is drawn (the game's metres): a top stands off the neck at its collar,
 * and the knit stood over it as a bib; drawn back, any top near it is drawn over it (see backPatch) */
const BACK = 0.05;

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const jointAt = (node, name) => {
  const joints = node.getSkin().listJoints();
  return new THREE.Vector3().setFromMatrixPosition(M4(joints.find((j) => j.getName() === name).getWorldMatrix()));
};
/** across the head, its points over the Head joint by 3 cm or more */
const across = (pts, J) => {
  const b = new THREE.Box3().setFromPoints(pts.filter((p) => p.y - J.y > 0.03));
  return b.max.x - b.min.x;
};

// ---- the suit's head at rest: its points, normals, picture coordinates and triangles
const suit = await io.read(path.join(CHAR, 'survivor.glb'));
const sn = suit.getRoot().listNodes().find((n) => n.getName() === 'head');
const sp = sn.getMesh().listPrimitives()[0];
const SP = restPoints(sn), SJ = jointAt(sn, 'Head'), STop = headOf(sn);
/** a skinned shape's normals as its skeleton stands at rest (as restPoints its points) */
const restNormals = (node) => {
  const skin = node.getSkin(), ibm = skin.getInverseBindMatrices(), prim = node.getMesh().listPrimitives()[0];
  const M = skin.listJoints().map((j, k) => M4(j.getWorldMatrix()).multiply(M4(ibm.getElement(k, []))));
  const nor = prim.getAttribute('NORMAL'), ji = prim.getAttribute('JOINTS_0'), jw = prim.getAttribute('WEIGHTS_0');
  return Array.from({ length: nor.getCount() }, (_, i) => {
    const n = new THREE.Vector3().fromArray(nor.getElement(i, [])), a = ji.getElement(i, []), w = jw.getElement(i, []), o = new THREE.Vector3();
    for (let c = 0; c < 4; c++) if (w[c] > 0) o.addScaledVector(n.clone().transformDirection(M[a[c]]), w[c]);
    return o.normalize();
  });
};
const SN = restNormals(sn);
const UV = sp.getAttribute('TEXCOORD_0'), IDX = sp.getIndices().getArray();
const smat = sp.getMaterial(), base = smat.getBaseColorTexture();
const SW = across(SP, SJ);

// ---- the knit and the eyes told apart by the picture under each triangle: the knit is one grey-green
const pic = await sharp(Buffer.from(base.getImage())).raw().toBuffer({ resolveWithObject: true });
const texel = (u, v) => {
  const { data, info } = pic, o = (Math.min(info.height - 1, Math.round(v * (info.height - 1))) * info.width + Math.min(info.width - 1, Math.round(u * (info.width - 1)))) * info.channels;
  return [data[o], data[o + 1], data[o + 2]];
};
const knitTris = [], eyeTris = [];
{
  // (the knit's colour: the middle of the picture's upper half, which is all knit)
  const cs = [];
  for (let k = 0; k < 400; k++) cs.push(texel(0.1 + 0.04 * (k % 20), 0.05 + 0.03 * Math.floor(k / 20)));
  const knit = [0, 1, 2].map((c) => cs.map((x) => x[c]).sort((a, b) => a - b)[200]);
  const e = [];
  for (let t = 0; t < IDX.length; t += 3) {
    let u = 0, v = 0;
    for (let s = 0; s < 3; s++) UV.getElement(IDX[t + s], e), (u += e[0] / 3), (v += e[1] / 3);
    const c = texel(u, v), far = Math.hypot(c[0] - knit[0], c[1] - knit[1], c[2] - knit[2]);
    (far > 45 ? eyeTris : knitTris).push(IDX[t], IDX[t + 1], IDX[t + 2]);
  }
  console.log(`knit ${knit}: ${knitTris.length / 3} triangles of knit, ${eyeTris.length / 3} of the eyes and the skin round them`);
}
// (each point's neighbours on the mask, for evening out over it)
const next = SP.map(() => new Set());
for (let t = 0; t < IDX.length; t += 3) for (let s = 0; s < 3; s++) next[IDX[t + s]].add(IDX[t + ((s + 1) % 3)]).add(IDX[t + ((s + 2) % 3)]);
// (and the same place's other copies, split where the picture is: moved and weighted as one)
const same = new Map();
SP.forEach((p, i) => {
  const key = `${Math.round(p.x * 2e4)},${Math.round(p.y * 2e4)},${Math.round(p.z * 2e4)}`;
  (same.get(key) ?? same.set(key, []).get(key)).push(i);
});
for (const group of same.values()) for (const i of group) for (const j of group) if (i !== j) for (const k of next[j]) next[i].add(k);

for (let b = 0; b < 4; b++) {
  const doc = await io.read(path.join(CHAR, `body_${b}.glb`));
  const node = doc.getRoot().listNodes().find((n) => n.getName() === 'survivor');
  const bp = node.getMesh().listPrimitives()[0], reg = bp.getAttribute('_REGION'), bj = bp.getAttribute('JOINTS_0'), bw = bp.getAttribute('WEIGHTS_0');
  const BP = restPoints(node), BJ = jointAt(node, 'Head'), BTop = headOf(node);
  const scalp = BP.filter((_, i) => reg.getScalar(i) === 0 || reg.getScalar(i) === 1);
  const k = across(scalp, BJ) / SW;
  // ---- 1. the suit's head on this one's: sized across, its skull's top on this one's
  const from = new THREE.Vector3(STop.topX, STop.crown, STop.topZ).add(SJ), to = new THREE.Vector3(BTop.topX, BTop.crown, BTop.topZ).add(BJ);
  const P = SP.map((p) => p.clone().sub(from).multiplyScalar(k).add(to));
  const knit = knitTris, eyes = eyeTris;
  // ---- 2. its neck down to under the neck joint, and on the body from the chin down
  const chin = BJ.y - CHIN, hem = jointAt(node, 'neck_01').y - HEM, low = Math.min(...P.map((p) => p.y));
  const stretch = (chin - hem) / (chin - low);
  for (const p of P) if (p.y < chin) p.y = chin - (chin - p.y) * stretch;
  // (onto the body's surface itself, its nearest place on its triangles: its points are few over the chest, a hand apart,
  // and laid by the nearest of them the knit stood off the chest over a T-shirt's collar)
  const BN = restNormals(node), BI = bp.getIndices().getArray(), tris = [];
  for (let t = 0; t < BI.length; t += 3) {
    const c = [BI[t], BI[t + 1], BI[t + 2]];
    if (c.some((i) => reg.getScalar(i) === 14) || c.every((i) => BP[i].y > chin + 0.03 || BP[i].y < hem - 0.06)) continue;
    const tri = new THREE.Triangle(BP[c[0]], BP[c[1]], BP[c[2]]), n = tri.getNormal(new THREE.Vector3());
    // (turned out, as the skin's own normals there are)
    if (n.dot(BN[c[0]].clone().add(BN[c[1]]).add(BN[c[2]])) < 0) n.negate();
    tris.push({ tri, n, c, box: new THREE.Box3().setFromPoints([BP[c[0]], BP[c[1]], BP[c[2]]]) });
  }
  const tucked = new Uint8Array(P.length), q = new THREE.Vector3(), at = new THREE.Vector3();
  const onto = P.map((p, i) => {
    const t = Math.min(1, Math.max(0, (chin - p.y) / (ON - CHIN)));
    if (!t) return null;
    let near = null, best = Infinity;
    for (const s of tris) {
      if (s.box.distanceToPoint(p) >= Math.sqrt(best)) continue;
      s.tri.closestPointToPoint(p, q);
      const d = q.distanceToSquared(p);
      if (d < best) (best = d), (near = s), at.copy(q);
    }
    // (out over the throat, hidden under it; in under the skin of the chest and the shoulders, which a top hides and draws
    // over: by the corner of the triangle nearest)
    const corner = near.c.reduce((a, c) => (BP[c].distanceToSquared(at) < BP[a].distanceToSquared(at) ? c : a));
    const off = UNDER.has(reg.getScalar(corner)) ? SKIN : -TUCKED;
    if (off < 0 && t > 0.5) tucked[i] = 1;
    return at.clone().addScaledVector(near.n, off).sub(p).multiplyScalar(t * t * (3 - 2 * t));
  });
  // (the move evened over the knit, so the line where it comes onto the body is not seen)
  for (let pass = 0; pass < 2; pass++) {
    const was = onto.map((v) => v?.clone() ?? null);
    P.forEach((_, i) => {
      if (!was[i]) return;
      const ns = [...next[i]].filter((j) => was[j]), m = was[i].clone().multiplyScalar(0.5);
      for (const j of ns) m.addScaledVector(was[j], 0.5 / ns.length);
      if (ns.length) onto[i] = m;
    });
  }
  P.forEach((p, i) => onto[i] && p.add(onto[i]));
  // ---- 3. above that, clear of what is drawn of the body under it
  const cut = chin, shown = BP.map((p, i) => (UNDER.has(reg.getScalar(i)) ? null : p)).filter((p) => p && p.y > cut - 0.05);
  const push = P.map((p, i) => {
    let most = 0;
    if (onto[i]) return 0;
    for (const q of shown) {
      const d = q.clone().sub(p);
      if (d.lengthSq() > 0.0012) continue;
      const out = d.dot(SN[i]), side = d.addScaledVector(SN[i], -out).length();
      if (side < 0.012) most = Math.max(most, out + CLEAR);
    }
    return most;
  });
  for (let pass = 0; pass < 3; pass++) {
    const was = push.slice();
    P.forEach((_, i) => {
      const ns = [...next[i]];
      if (ns.length) push[i] = Math.max(was[i], 0.5 * was[i] + (0.5 * ns.reduce((a, j) => a + was[j], 0)) / ns.length);
    });
  }
  P.forEach((p, i) => p.addScaledVector(SN[i], push[i]));
  const used = new Set([...knit, ...eyes]), pushed = push.filter((v, i) => v > 1e-4 && used.has(i));
  // ---- 4. weighted as the skin under it: the six nearest of the body's points, evened over the knit twice
  const ja = [], wa = [], W = P.map((p) => {
    const near = BP.map((q, n) => [n, q.distanceToSquared(p)]).sort((x, y) => x[1] - y[1]).slice(0, 6), w = new Map();
    for (const [n, d2] of near) {
      const f = 1 / (Math.sqrt(d2) + 0.005) ** 2;
      bj.getElement(n, ja), bw.getElement(n, wa);
      for (let c = 0; c < 4; c++) if (wa[c] > 0) w.set(ja[c], (w.get(ja[c]) ?? 0) + wa[c] * f);
    }
    return w;
  });
  for (let pass = 0; pass < 2; pass++) {
    const was = W.slice();
    P.forEach((_, i) => {
      const w = new Map(), put = (m, f) => {
        const sum = [...m.values()].reduce((a, v) => a + v, 0) || 1;
        for (const [j, v] of m) w.set(j, (w.get(j) ?? 0) + (v / sum) * f);
      };
      const ns = [...next[i]];
      put(was[i], ns.length ? 0.5 : 1);
      for (const j of ns) put(was[j], 0.5 / ns.length);
      W[i] = w;
    });
  }
  const J = new Uint16Array(P.length * 4), V = new Float32Array(P.length * 4);
  W.forEach((w, i) => {
    const top = [...w].sort((x, y) => y[1] - x[1]).slice(0, 4), sum = top.reduce((a, [, v]) => a + v, 0) || 1;
    top.forEach(([j, v], c) => ((J[i * 4 + c] = j), (V[i * 4 + c] = v / sum)));
  });

  // ---- the piece, on this body's skeleton at rest (its points as they stand, so its joints' inverses as they stand)
  const skin = node.getSkin(), ibm = skin.getInverseBindMatrices(), inv = new THREE.Matrix4();
  skin.listJoints().forEach((j, n) => ibm.setElement(n, inv.copy(M4(j.getWorldMatrix())).invert().toArray()));
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array);
  const pos = acc('VEC3', new Float32Array(P.flatMap((p) => p.toArray()))), nor = acc('VEC3', new Float32Array(SN.flatMap((n) => n.toArray())));
  const uv = acc('VEC2', new Float32Array(SP.flatMap((_, i) => UV.getElement(i, [])))), jnt = acc('VEC4', J), wgt = acc('VEC4', V);
  // (the face's, and the chest's where it goes in under a top: drawn back there)
  const region = acc('SCALAR', tucked.map((v) => (v ? 3 : 1)));
  const tex = (t, name) => t && doc.createTexture(name).setImage(t.getImage()).setMimeType(t.getMimeType());
  const own = (name, extras) =>
    doc
      .createMaterial(name)
      .setBaseColorTexture(tex(base, `${name}_base`))
      .setNormalTexture(tex(smat.getNormalTexture(), `${name}_normal`))
      .setMetallicRoughnessTexture(tex(smat.getMetallicRoughnessTexture(), `${name}_mr`))
      .setRoughnessFactor(smat.getRoughnessFactor())
      .setMetallicFactor(smat.getMetallicFactor())
      .setExtras(extras);
  // (how light the knit is drawn, on average: a colour put on it keeps its folds; see clothPatch)
  let sum = 0;
  for (const i of knit) {
    const [u, v] = UV.getElement(i, []), c = texel(u, v);
    sum += (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  }
  const mesh = doc.createMesh('wear');
  for (const [tris, mat] of [
    [knit, own('wear_balaclava', { light: +(sum / knit.length).toFixed(4), head: true, back: BACK })],
    [eyes, own('wear_balaclava_eyes', { light: 0.4, own: true, head: true })],
  ]) {
    const prim = doc.createPrimitive().setMaterial(mat).setIndices(acc('SCALAR', new Uint32Array(tris)));
    for (const [s, a] of [['POSITION', pos], ['NORMAL', nor], ['TEXCOORD_0', uv], ['JOINTS_0', jnt], ['WEIGHTS_0', wgt], ['_REGION', region]]) prim.setAttribute(s, a);
    mesh.addPrimitive(prim);
  }
  node.getMesh().dispose();
  node.setMesh(mesh).setName('wear');
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 88 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const dest = path.join(CHAR, 'wear', `balaclava_${b}.glb`);
  await io.write(dest, doc);
  console.log(`balaclava_${b}.glb  ${((await fs.stat(dest)).size / 1048576).toFixed(2)} MB  ${(k * 100).toFixed(1)}% of the suit's size, its neck ${(stretch * 100).toFixed(0)}% as long, pushed out at ${pushed.length} points (most ${(Math.max(0, ...pushed) * 1000).toFixed(1)} mm)`);
}
