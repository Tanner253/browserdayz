// Lays a model of something crumpled flat on the ground: turned so that the way it is thinnest (the least spread of its
// points) is up. For cloth made from a picture (Tripo), which comes standing at whatever slant it was drawn.
//
//   node scripts/lay-flat.mjs <in.glb> <out.glb>
//
// Writes the turn into the scene's root nodes; scripts/props.mjs then sizes it and stands it on the ground as any model.

import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [src, dest] = process.argv.slice(2);
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const pts = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = new THREE.Matrix4().fromArray(node.getWorldMatrix());
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), v = new THREE.Vector3();
    for (let i = 0; i < pos.getCount(); i++) pts.push(v.fromArray(pos.getElement(i, [])).applyMatrix4(m).clone());
  }
}
// the spread of its points, and the way it is least (Jacobi on the 3x3 covariance)
const mean = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
for (const p of pts) {
  const d = [p.x - mean.x, p.y - mean.y, p.z - mean.z];
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b];
}
const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], A = C.map((r) => r.slice());
for (let sweep = 0; sweep < 50; sweep++) {
  for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(A[p][q]) < 1e-12) continue;
    const th = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]), c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) {
      const akp = A[k][p], akq = A[k][q];
      A[k][p] = c * akp - s * akq;
      A[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = A[p][k], aqk = A[q][k];
      A[p][k] = c * apk - s * aqk;
      A[q][k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = V[k][p], vkq = V[k][q];
      V[k][p] = c * vkp - s * vkq;
      V[k][q] = s * vkp + c * vkq;
    }
  }
}
const least = [0, 1, 2].sort((a, b) => A[a][a] - A[b][b])[0];
const thin = new THREE.Vector3(V[0][least], V[1][least], V[2][least]).normalize();
if (thin.y < 0) thin.negate();
const turn = new THREE.Quaternion().setFromUnitVectors(thin, new THREE.Vector3(0, 1, 0));
const scene = doc.getRoot().listScenes()[0];
const holder = doc.createNode('flat').setRotation(turn.toArray());
for (const n of scene.listChildren()) {
  scene.removeChild(n);
  holder.addChild(n);
}
scene.addChild(holder);
await io.write(dest, doc);
console.log(`${dest}: turned ${(thin.angleTo(new THREE.Vector3(0, 1, 0)) * 57.3).toFixed(0)} degrees to lie flat`);
