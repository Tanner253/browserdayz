// node assets-src/_wf/me/floor-at.mjs <model.glb> <from y> x,z [x,z ...] : what a ray straight down from that height
// first meets at each place, in the model's own metres (and what is over the place, a ray straight up). No game, no GPU.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [src, fromY, ...places] = process.argv.slice(2);
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
/** where a vertical line through (x, z) crosses each triangle: the heights */
function crossings(x, z) {
  const out = [];
  for (const [a, b, c] of tris) {
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, w = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    if (u < 0 || w < 0 || u + w > 1) continue;
    out.push(u * a[1] + w * b[1] + (1 - u - w) * c[1]);
  }
  return out.sort((p, q) => p - q);
}
const y0 = Number(fromY);
console.log(`${tris.length} triangles`);
for (const p of places) {
  const [x, z] = p.split(',').map(Number);
  const ys = crossings(x, z), below = ys.filter((y) => y <= y0).pop(), above = ys.find((y) => y > y0);
  console.log(`${x}, ${z}: floor ${below === undefined ? 'none' : below.toFixed(3)}   over it ${above === undefined ? 'open sky' : above.toFixed(3)}   all ${ys.map((y) => y.toFixed(2)).join(' ')}`);
}
