// node assets-src/_wf/me/ray-at.mjs <model.glb> ox,oy,oz dx,dy,dz [ox,oy,oz dx,dy,dz ...] : how far along each ray the
// model is first met, and where, in the model's own metres. No game, no GPU. (A wall's inner face, from inside the room.)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [src, ...rest] = process.argv.slice(2);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src);
const tris = [];
for (const n of doc.getRoot().listNodes()) {
  const mesh = n.getMesh();
  if (!mesh) continue;
  const M = n.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
    if (!pos) continue;
    const P = [], v = [];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      P.push([M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14]]);
    }
    const count = idx ? idx.getCount() : pos.getCount();
    for (let i = 0; i + 2 < count; i += 3) tris.push([P[idx ? idx.getScalar(i) : i], P[idx ? idx.getScalar(i + 1) : i + 1], P[idx ? idx.getScalar(i + 2) : i + 2]]);
  }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Moller-Trumbore: the distance along the ray to the triangle, or null */
function hit(o, d, [a, b, c]) {
  const e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p);
  if (Math.abs(det) < 1e-12) return null;
  const t = sub(o, a), u = dot(t, p) / det;
  if (u < 0 || u > 1) return null;
  const q = cross(t, e1), v = dot(d, q) / det;
  if (v < 0 || u + v > 1) return null;
  const k = dot(e2, q) / det;
  return k > 1e-5 ? k : null;
}
console.log(`${tris.length} triangles`);
for (let i = 0; i + 1 < rest.length; i += 2) {
  const o = rest[i].split(',').map(Number), raw = rest[i + 1].split(',').map(Number), len = Math.hypot(...raw), d = raw.map((x) => x / len);
  let best = null;
  for (const t of tris) {
    const k = hit(o, d, t);
    if (k !== null && (best === null || k < best)) best = k;
  }
  console.log(`${rest[i]} -> ${rest[i + 1]}: ${best === null ? 'nothing' : `${best.toFixed(3)} m, at ${o.map((x, j) => (x + d[j] * best).toFixed(3)).join(', ')}`}`);
}
