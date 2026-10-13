// The steel cabinet came as three shapes ("Metal Cabinet (Low Poly)" by Berk Gedik, CC BY 4.0, unpacked into
// assets-src/models/metal_cabinet_low_poly/): the case of two lockers side by side, their two doors as one shape,
// and the handles and hinges of both as another. To swing a door it has to be a thing of its own:
//
//   node scripts/split-locker.mjs
//   (then the model is built from what this writes: `steel_locker` in scripts/assets.config.mjs)
//
// Each shape is taken apart into its separate pieces (points that share no triangle with each other). Of the doors'
// shape there are two, a leaf each. Of the handles' and hinges' there are eight: a piece that stands at the edge a
// leaf is hung by is a hinge, and stays with the case; the others are that leaf's handle and its lock, and go with
// it. Each leaf is hung on the line of its own hinges, which for both is its right-hand edge as one stands before
// it: these are two lockers, not a cupboard with a pair of doors.
//
// The right-hand leaf came standing a hand's breadth open. It is the left-hand one, point for point, moved one
// locker along and turned: it is turned back by as much, about the same line, and its handle with it, so that a
// leaf that has not been turned is a leaf that is shut.
//
// Written as three shapes of one file, assets-src/models/metal_cabinet_split/scene.gltf: `Body`, and `DoorL` and
// `DoorR`, each of those two a piece whose own origin is on the line of its hinges at the cabinet's foot (the
// builder keeps that: `hung` in scripts/props.mjs). And a note of what was found (hinge.json, metres).

import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'assets-src', 'models', 'metal_cabinet_low_poly');
const OUT = path.join(ROOT, 'assets-src', 'models', 'metal_cabinet_split');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(path.join(SRC, 'scene.gltf'));
const root = doc.getRoot();
const len = (v) => Math.hypot(v[0], v[1], v[2]) || 1;

/** a shape as it stands in the file's own space: its points, what is said of each, its triangles, and its separate pieces */
function shapeOf(paint) {
  const node = root.listNodes().find((n) => n.getMesh()?.listPrimitives()[0].getMaterial()?.getName() === paint);
  if (!node) throw new Error(`no shape painted ${paint}`);
  const W = node.getWorldMatrix(), prim = node.getMesh().listPrimitives()[0];
  const at = (a, i, w) => {
    const p = a.getElement(i, []);
    return [p[0] * W[0] + p[1] * W[4] + p[2] * W[8] + w * W[12], p[0] * W[1] + p[1] * W[5] + p[2] * W[9] + w * W[13], p[0] * W[2] + p[1] * W[6] + p[2] * W[10] + w * W[14]];
  };
  const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), tan = prim.getAttribute('TANGENT'), uv = prim.getAttribute('TEXCOORD_0');
  const n = pos.getCount(), P = [], N = [], T = [], U = [];
  for (let i = 0; i < n; i++) {
    P.push(at(pos, i, 1));
    const q = at(nor, i, 0), l = len(q);
    N.push(q.map((v) => v / l));
    if (tan) {
      const t = at(tan, i, 0), tl = len(t);
      T.push([t[0] / tl, t[1] / tl, t[2] / tl, tan.getElement(i, [])[3]]);
    }
    U.push(uv.getElement(i, []));
  }
  const I = Array.from(prim.getIndices().getArray());
  // its separate pieces
  const where = new Map(), up = [];
  const find = (a) => {
    while (up[a] !== a) a = up[a] = up[up[a]];
    return a;
  };
  const id = P.map((p) => {
    const k = p.map((v) => Math.round(v * 2000)).join(',');
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
    const c = pieces.get(r) ?? { lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9], points: new Set() };
    c.points.add(i);
    for (let k = 0; k < 3; k++) {
      c.lo[k] = Math.min(c.lo[k], P[i][k]);
      c.hi[k] = Math.max(c.hi[k], P[i][k]);
    }
    pieces.set(r, c);
  }
  return { paint, material: prim.getMaterial(), P, N, T, U, I, pieces: [...pieces.values()] };
}

const body = shapeOf('Dolap'), doors = shapeOf('Kapak'), fittings = shapeOf('Kulp_Mentese');
const mid = (c, k) => (c.lo[k] + c.hi[k]) / 2;
if (doors.pieces.length !== 2) throw new Error(`the doors are ${doors.pieces.length} pieces, not two leaves`);
const [leafL, leafR] = [...doors.pieces].sort((a, b) => mid(a, 0) - mid(b, 0));

// ---- the right-hand leaf is the left-hand one, moved and turned: by how much
const ptsL = [...leafL.points], ptsR = [...leafR.points];
if (ptsL.length !== ptsR.length) throw new Error('the two leaves are not the same shape');
const mean = (pts, k) => pts.reduce((s, i) => s + doors.P[i][k], 0) / pts.length;
const cl = [mean(ptsL, 0), mean(ptsL, 2)], cr = [mean(ptsR, 0), mean(ptsR, 2)];
let dot = 0, cross = 0;
ptsL.forEach((i, k) => {
  const ax = doors.P[i][0] - cl[0], az = doors.P[i][2] - cl[1], bx = doors.P[ptsR[k]][0] - cr[0], bz = doors.P[ptsR[k]][2] - cr[1];
  dot += ax * bx + az * bz;
  cross += ax * bz - az * bx;
});
const ajar = Math.atan2(cross, dot), co = Math.cos(ajar), si = Math.sin(ajar);
let off = 0;
ptsL.forEach((i, k) => {
  const ax = doors.P[i][0] - cl[0], az = doors.P[i][2] - cl[1];
  off = Math.max(off, Math.hypot(ax * co - az * si + cr[0] - doors.P[ptsR[k]][0], ax * si + az * co + cr[1] - doors.P[ptsR[k]][2], doors.P[i][1] - doors.P[ptsR[k]][1]));
});
if (off > 0.0005) throw new Error(`the right-hand leaf is not the left-hand one turned: ${off.toFixed(4)} m out`);

// ---- the hinges, and the line each leaf is hung on: a fitting at the edge of a leaf that is not its free edge
/** the two lockers of the case, by their own boxes: how far one is from the other */
const cases = body.pieces.filter((c) => c.hi[1] - c.lo[1] > 1.5).sort((a, b) => mid(a, 0) - mid(b, 0));
if (cases.length !== 2) throw new Error(`the case is ${cases.length} lockers, not two`);
const pitch = mid(cases[1], 0) - mid(cases[0], 0);
// (the fittings of the left-hand leaf are as they were made: those at its right-hand edge are its hinges)
const leftOnes = fittings.pieces.filter((c) => mid(c, 0) < 0);
const hingesL = leftOnes.filter((c) => Math.abs(mid(c, 0) - leafL.hi[0]) < 0.03);
if (hingesL.length !== 2) throw new Error(`${hingesL.length} hinges on the left-hand leaf`);
const lineL = [hingesL.reduce((s, c) => s + mid(c, 0), 0) / 2, hingesL.reduce((s, c) => s + mid(c, 2), 0) / 2];
const lineR = [lineL[0] + pitch, lineL[1]];
const hinges = new Set(), handleL = new Set(), handleR = new Set();
for (const c of fittings.pieces) {
  const left = mid(c, 0) < 0;
  const atHinge = Math.abs(mid(c, 0) - (left ? lineL[0] : lineR[0])) < 0.03;
  for (const i of c.points) (atHinge ? hinges : left ? handleL : handleR).add(i);
}

// ---- the right-hand leaf and its handle turned back until they are shut: the turn undone, about the line that
// leaves the leaf exactly one locker along from the left-hand one
// (R = Rot(ajar)(L - cl) + cr, and shut it is S = L + pitch: so S = Rot(-ajar)(R - cr) + cl + pitch)
const shut = (v, point) => {
  const x = v[0] - (point ? cr[0] : 0), z = v[2] - (point ? cr[1] : 0);
  return [x * co + z * si + (point ? cl[0] + pitch : 0), v[1], -x * si + z * co + (point ? cl[1] : 0)];
};
for (const [shape, pts] of [[doors, leafR.points], [fittings, handleR]]) {
  for (const i of pts) {
    shape.P[i] = shut(shape.P[i], true);
    shape.N[i] = shut(shape.N[i], false);
    if (shape.T.length) shape.T[i] = [...shut(shape.T[i], false), shape.T[i][3]];
  }
}
const foot = Math.min(...body.P.map((p) => p[1]));

// ---- written out: three shapes, each of one or two paints
const buffer = root.listBuffers()[0];
const scene = root.listScenes()[0];
for (const child of scene.listChildren()) scene.removeChild(child);
/** @param parts [shape, which of its points] for each paint of it; @param origin where its own origin is put */
const make = (name, parts, origin = [0, 0, 0]) => {
  const mesh = doc.createMesh(name);
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  let tris = 0;
  for (const [shape, keep] of parts) {
    const map = new Map(), order = [], idx = [];
    for (let t = 0; t < shape.I.length; t += 3) {
      if (!keep.has(shape.I[t])) continue;
      for (const v of [shape.I[t], shape.I[t + 1], shape.I[t + 2]]) {
        if (!map.has(v)) {
          map.set(v, order.length);
          order.push(v);
        }
        idx.push(map.get(v));
      }
    }
    const acc = (type, list) => doc.createAccessor().setType(type).setBuffer(buffer).setArray(Float32Array.from(order.flatMap(list)));
    const p = doc.createPrimitive().setMaterial(shape.material).setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(Uint32Array.from(idx)));
    p.setAttribute('POSITION', acc('VEC3', (v) => shape.P[v].map((x, k) => x - origin[k]))).setAttribute('NORMAL', acc('VEC3', (v) => shape.N[v])).setAttribute('TEXCOORD_0', acc('VEC2', (v) => shape.U[v]));
    if (shape.T.length) p.setAttribute('TANGENT', acc('VEC4', (v) => shape.T[v]));
    mesh.addPrimitive(p);
    tris += idx.length / 3;
    for (const v of order) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], shape.P[v][k]);
      hi[k] = Math.max(hi[k], shape.P[v][k]);
    }
  }
  scene.addChild(doc.createNode(name).setTranslation(origin).setMesh(mesh));
  return { tris, lo: lo.map((v) => +v.toFixed(4)), hi: hi.map((v) => +v.toFixed(4)) };
};
const all = (shape) => new Set(shape.P.keys());
const B = make('Body', [[body, all(body)], [fittings, hinges]]);
const L = make('DoorL', [[doors, leafL.points], [fittings, handleL]], [lineL[0], foot, lineL[1]]);
const R = make('DoorR', [[doors, leafR.points], [fittings, handleR]], [lineR[0], foot, lineR[1]]);
for (const n of root.listNodes()) if (!n.getMesh() && !n.listChildren().length) n.dispose();
for (const n of root.listNodes()) if (!scene.listChildren().includes(n)) n.dispose();
for (const m of root.listMeshes()) if (!m.listParents().some((p) => p.propertyType === 'Node')) m.dispose();
await fs.mkdir(OUT, { recursive: true });
await io.write(path.join(OUT, 'scene.gltf'), doc);
await fs.copyFile(path.join(SRC, 'license.txt'), path.join(OUT, 'license.txt'));
const r4 = (v) => +v.toFixed(4);
const note = {
  units: 'm, in the download\'s own space (its middle at 0, 0, 0)',
  cameAjar: +((-ajar * 180) / Math.PI).toFixed(2),
  pitch: r4(pitch),
  hingeL: lineL.map(r4), hingeR: lineR.map(r4),
  body: B, doorL: L, doorR: R,
};
await fs.writeFile(path.join(OUT, 'hinge.json'), JSON.stringify(note, null, 1));
console.log(JSON.stringify(note));
