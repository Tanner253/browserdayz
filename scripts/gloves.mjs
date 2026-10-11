// The tactical gloves, laid down as a pair of gloves lies (2026-10-12).
//
// As the pack has them they stand on their cuffs side by side, one with its palm to the eye and one with its
// back: the same glove twice, the second turned half round. On the ground, and in its picture, that was two
// gloves standing up like a pair of hands. Asked for: "the glove thats palm up is flipped over, and then sorta
// overlay the gloves, make our own custom model using whats there repositioning it slightly... flat like normal
// gloves irl".
//
// What this does to the model as the pipeline leaves it (scripts/packs.mjs, then the two copies of tiers.mjs):
//   - the glove that shows its palm is turned into the other hand's glove showing its back (mirrored front to
//     back: a pair is a left and a right, thumbs toward each other, and these were two of the same);
//   - each is turned a little, fingers apart, and the one is moved half over the other and a little above it;
//   - the pair is laid on its palms, cuffs toward the eye, and set on the ground about its own middle.
// Nothing is added and nothing taken away: the same points, the same pictures.
//
//   node scripts/gloves.mjs            both copies (public/assets/models/tactical_gloves.glb and hi/), and the manifest
// Run again after anything rebuilds the model. A copy already lying down is left as it is.

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, quantize } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const FILES = ['public/assets/models/tactical_gloves.glb', 'public/assets/models/hi/tactical_gloves.glb'].map((f) => path.join(ROOT, f));
/** how each glove is turned in its own plane (radians, fingers apart), and how far the one is brought over the other, metres */
const LAY = { turnOver: 0.26, turnUnder: -0.1, across: 0.088, above: 0.03, along: 0.016 };

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** @returns the model's size and lowest corner afterwards, or null if it was lying down already */
async function lay(file) {
  const doc = await io.read(file);
  await doc.transform(dequantize());
  const size = (pts) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of pts) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
    return { lo, hi };
  };
  let out = null;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const M = node.getWorldMatrix();
    const at = (v) => [M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14]];
    // (a direction: turned as the node is turned, and made a unit again whatever size the node made things)
    const way = (v) => {
      const d = [M[0] * v[0] + M[4] * v[1] + M[8] * v[2], M[1] * v[0] + M[5] * v[1] + M[9] * v[2], M[2] * v[0] + M[6] * v[1] + M[10] * v[2]];
      const l = Math.hypot(...d) || 1;
      return d.map((x) => x / l);
    };
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), tan = prim.getAttribute('TANGENT'), idx = prim.getIndices();
      const n = pos.getCount(), P = [], N = [], T = [], v = [];
      for (let i = 0; i < n; i++) {
        P.push(at(pos.getElement(i, v)));
        if (nor) N.push(way(nor.getElement(i, v)));
        if (tan) {
          tan.getElement(i, v);
          T.push([...way(v), v[3]]);
        }
      }
      const was = size(P);
      // (lying down already: lower than it is long)
      if (was.hi[1] - was.lo[1] < (was.hi[2] - was.lo[2]) * 0.9) return null;
      // which glove each point is of: they stand either side of the middle
      const over = P.map((p) => p[0] < 0);
      const mid = (flag) => {
        const b = size(P.filter((_, i) => over[i] === flag));
        return [(b.lo[0] + b.hi[0]) / 2, b.lo[1], (b.lo[2] + b.hi[2]) / 2];
      };
      const cA = mid(true), cB = mid(false);
      for (let i = 0; i < n; i++) {
        const a = over[i], c = a ? cA : cB, p = P[i];
        // the one that shows its palm: front to back, about its own middle (and so the other hand's glove)
        if (a) {
          p[2] = 2 * c[2] - p[2];
          if (N[i]) N[i][2] = -N[i][2];
          if (T[i]) {
            T[i][2] = -T[i][2];
            T[i][3] = -T[i][3];
          }
        }
        // turned a little in its own plane, about the middle of its cuff
        const t = a ? LAY.turnOver : LAY.turnUnder, co = Math.cos(t), si = Math.sin(t);
        const dx = p[0] - c[0], dy = p[1] - c[1];
        p[0] = c[0] + dx * co - dy * si;
        p[1] = c[1] + dx * si + dy * co;
        for (const d of [N[i], T[i]]) if (d) [d[0], d[1]] = [d[0] * co - d[1] * si, d[0] * si + d[1] * co];
        // and the one brought half over the other, a little above it and a little further up
        if (a) {
          p[0] += LAY.across;
          p[2] += LAY.above;
          p[1] += LAY.along;
        }
      }
      // (a glove turned front to back has its faces the other way round: each is given back the way it faced)
      if (idx) {
        const I = idx.getArray().slice();
        for (let i = 0; i + 2 < I.length; i += 3) if (over[I[i]]) [I[i + 1], I[i + 2]] = [I[i + 2], I[i + 1]];
        idx.setArray(I);
      }
      // laid on its palms: what faced the eye faces up, the fingers away
      const down = (d) => [d[0], d[2], -d[1]];
      const L = P.map(down), now = size(L);
      const off = [-(now.lo[0] + now.hi[0]) / 2, -now.lo[1], -(now.lo[2] + now.hi[2]) / 2];
      pos.setArray(new Float32Array(L.flatMap((p) => [p[0] + off[0], p[1] + off[1], p[2] + off[2]])));
      if (nor) nor.setArray(new Float32Array(N.flatMap(down)));
      if (tan) tan.setArray(new Float32Array(T.flatMap((d) => [...down(d), d[3]])));
      out = { size: [now.hi[0] - now.lo[0], now.hi[1] - now.lo[1], now.hi[2] - now.lo[2]], min: [now.lo[0] + off[0], 0, now.lo[2] + off[2]], max: [now.hi[0] + off[0], now.hi[1] - now.lo[1], now.hi[2] + off[2]] };
    }
    // (its points are where they are to be: the node says nothing more)
    node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    for (let p = node.getParentNode(); p; p = p.getParentNode()) p.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }));
  await io.write(file, doc);
  return out;
}

const manifestPath = path.join(ROOT, 'public/assets/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const file of FILES) {
  if (!fs.existsSync(file)) continue;
  const r = await lay(file);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (!r) {
    console.log(`${rel}: lying down already`);
    continue;
  }
  console.log(`${rel}: laid down, ${r.size.map((x) => x.toFixed(3)).join(' x ')} m, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  const e = manifest.models.tactical_gloves;
  if (rel.includes('/hi/')) e.hiBytes = fs.statSync(file).size;
  else {
    e.bytes = fs.statSync(file).size;
    e.min = r.min.map((x) => +x.toFixed(4));
    e.max = r.max.map((x) => +x.toFixed(4));
  }
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
