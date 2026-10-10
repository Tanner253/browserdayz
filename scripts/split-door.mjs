// The bunker's door came as one shape, standing half open in its frame ("Old metal bunker
// door" by rakutin, CC BY 4.0, unpacked into assets-src/models/bunker_door/). To swing it, the
// leaf has to be a thing of its own:
//
//   node scripts/split-door.mjs
//   node scripts/packs.mjs bunker_gate_frame bunker_gate_leaf
//
// The shape is taken apart into its separate pieces (points that share no triangle with each
// other). The frame is the big ring that lies in the wall; the leaf is the slab that stands
// out of it at an angle, and whatever is fixed to that slab (the wheel, the bars, the bolts);
// the pins it turns on, and the keepers on the frame's other side, stay with the frame. The
// leaf's pieces are then turned back about the hinge until the door is shut, and the two are
// written as two shapes of one file, assets-src/models/bunker_door_split/scene.gltf, with a
// note of where the hinge is (hinge.json: centimetres, in the frame's own measure).

import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'assets-src', 'models', 'bunker_door');
const OUT = path.join(ROOT, 'assets-src', 'models', 'bunker_door_split');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(path.join(SRC, 'scene.gltf'));
const root = doc.getRoot();
const node = root.listNodes().find((n) => n.getMesh());
const W = node.getWorldMatrix();
const prim = node.getMesh().listPrimitives()[0];
const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), tan = prim.getAttribute('TANGENT');
const I = Array.from(prim.getIndices().getArray());
const n = pos.getCount();
const at = (a, i, w) => {
  const p = a.getElement(i, []);
  return [p[0] * W[0] + p[1] * W[4] + p[2] * W[8] + w * W[12], p[0] * W[1] + p[1] * W[5] + p[2] * W[9] + w * W[13], p[0] * W[2] + p[1] * W[6] + p[2] * W[10] + w * W[14]];
};
const len = (v) => Math.hypot(v[0], v[1], v[2]) || 1;
const P = [], N = [], T = [];
for (let i = 0; i < n; i++) {
  P.push(at(pos, i, 1));
  const q = at(nor, i, 0), l = len(q);
  N.push(q.map((v) => v / l));
  if (tan) {
    const t = at(tan, i, 0), tl = len(t);
    T.push([t[0] / tl, t[1] / tl, t[2] / tl, tan.getElement(i, [])[3]]);
  }
}

// ---- its separate pieces
const where = new Map(), up = [];
const find = (a) => {
  while (up[a] !== a) a = up[a] = up[up[a]];
  return a;
};
const id = P.map((p) => {
  const k = p.map((v) => Math.round(v * 20)).join(',');
  if (!where.has(k)) {
    where.set(k, up.length);
    up.push(up.length);
  }
  return where.get(k);
});
for (let t = 0; t < I.length; t += 3) {
  const a = find(id[I[t]]);
  up[find(id[I[t + 1]])] = a;
  up[find(id[I[t + 2]])] = a;
}
const pieces = new Map();
for (let i = 0; i < n; i++) {
  const r = find(id[i]);
  const c = pieces.get(r) ?? { lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9], points: [] };
  c.points.push(i);
  for (let k = 0; k < 3; k++) {
    c.lo[k] = Math.min(c.lo[k], P[i][k]);
    c.hi[k] = Math.max(c.hi[k], P[i][k]);
  }
  pieces.set(r, c);
}
const all = [...pieces.values()];
const size = (c) => c.hi.map((v, k) => v - c.lo[k]);
const vol = (c) => size(c).reduce((a, b) => a * b, 1);
// the frame: the widest of them; the slab: the biggest of the rest
const frame = all.reduce((a, b) => (size(b)[0] > size(a)[0] ? b : a));
const slab = all.filter((c) => c !== frame).reduce((a, b) => (vol(b) > vol(a) ? b : a));
// the hinge: the upright line the slab stands out from, at the end of it that is nearest the frame
// (the slab runs from there out and away: across the doorway one way, out of the wall the other)
const hx = slab.hi[0], hz = slab.lo[2];
const out = [slab.lo[0] - hx, slab.hi[2] - hz], wide = Math.hypot(out[0], out[1]);
const open = Math.atan2(out[1], -out[0]);
// a piece is the leaf's if it stands out from the wall with the slab: its middle clear of the hinge, and near the slab's own line
const leaf = new Set();
for (const c of all) {
  if (c === frame) continue;
  const mx = (c.lo[0] + c.hi[0]) / 2 - hx, mz = (c.lo[2] + c.hi[2]) / 2 - hz;
  const along = (mx * out[0] + mz * out[1]) / wide, off = Math.abs(mx * out[1] - mz * out[0]) / wide;
  // (the wheel and the handles stand a forearm off its face; the pins it turns on are at the hinge itself and stay,
  // and so does whatever stands no further out of the wall than the frame's own keepers do: those are the frame's)
  if (c === slab || (along > -6 && along < wide + 8 && off < 48 && Math.hypot(mx, mz) > 9 && c.hi[2] > frame.hi[2] + 25)) for (const i of c.points) leaf.add(i);
}
// ---- the leaf turned back until it lies in the doorway (about the hinge, by as much as it stands open)
const co = Math.cos(open), si = Math.sin(open);
const turn = (v, about) => {
  const x = v[0] - (about ? hx : 0), z = v[2] - (about ? hz : 0);
  return [x * co - z * si + (about ? hx : 0), v[1], x * si + z * co + (about ? hz : 0)];
};
// (a few loose bits were drawn hanging in the air beside the open leaf: turned back with it they are
// behind the door or over the top of it. Whatever ends up clear of the slab that way is left out altogether.)
const gone = new Set();
for (const c of all) {
  if (c === frame || c === slab || !leaf.has(c.points[0])) continue;
  const m = turn([(c.lo[0] + c.hi[0]) / 2, (c.lo[1] + c.hi[1]) / 2, (c.lo[2] + c.hi[2]) / 2], true);
  if (m[2] < hz - 14 || m[1] > slab.hi[1] + 4 || m[1] < slab.lo[1] - 12 || m[0] > hx + 6) for (const i of c.points) gone.add(i);
}
for (const i of leaf) {
  P[i] = turn(P[i], true);
  N[i] = turn(N[i], false);
  if (tan) T[i] = [...turn(T[i], false), T[i][3]];
}

// ---- written out: two shapes of one material, in the frame's measure
const buffer = root.listBuffers()[0];
const material = prim.getMaterial();
const scene = root.listScenes()[0];
for (const child of scene.listChildren()) scene.removeChild(child);
const make = (name, keep) => {
  const map = new Map(), order = [];
  const idx = [];
  for (let t = 0; t < I.length; t += 3) {
    if (leaf.has(I[t]) !== keep || gone.has(I[t])) continue;
    for (const v of [I[t], I[t + 1], I[t + 2]]) {
      if (!map.has(v)) {
        map.set(v, order.length);
        order.push(v);
      }
      idx.push(map.get(v));
    }
  }
  const acc = (type, list, width) => doc.createAccessor().setType(type).setBuffer(buffer).setArray(Float32Array.from(order.flatMap((v) => list(v).slice(0, width))));
  const p = doc.createPrimitive().setMaterial(material).setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(Uint32Array.from(idx)));
  p.setAttribute('POSITION', acc('VEC3', (v) => P[v], 3)).setAttribute('NORMAL', acc('VEC3', (v) => N[v], 3));
  if (tan) p.setAttribute('TANGENT', acc('VEC4', (v) => T[v], 4));
  for (const sem of prim.listSemantics()) {
    if (!/^TEXCOORD/.test(sem)) continue;
    const src = prim.getAttribute(sem);
    p.setAttribute(sem, doc.createAccessor().setType('VEC2').setBuffer(buffer).setArray(Float32Array.from(order.flatMap((v) => src.getElement(v, [])))));
  }
  scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(p)));
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const v of order) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], P[v][k]);
    hi[k] = Math.max(hi[k], P[v][k]);
  }
  return { tris: idx.length / 3, lo: lo.map((v) => +v.toFixed(1)), hi: hi.map((v) => +v.toFixed(1)) };
};
const F = make('Frame', false), L = make('Leaf', true);
node.getMesh().dispose();
node.dispose();
await fs.mkdir(OUT, { recursive: true });
await io.write(path.join(OUT, 'scene.gltf'), doc);
await fs.copyFile(path.join(SRC, 'license.txt'), path.join(OUT, 'license.txt'));
const note = { units: 'cm', hinge: [+hx.toFixed(1), +hz.toFixed(1)], stoodOpen: +((open * 180) / Math.PI).toFixed(1), frame: F, leaf: L };
await fs.writeFile(path.join(OUT, 'hinge.json'), JSON.stringify(note, null, 1));
console.log(JSON.stringify(note));
