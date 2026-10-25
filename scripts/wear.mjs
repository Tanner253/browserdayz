// Builds the things a survivor wears, as they are drawn on the body: public/assets/characters/wear/<id>.glb.
//
//   node scripts/wear.mjs            all of them
//   node scripts/wear.mjs m65        only that one
//
// The owner, 2026-10-24: "i like the clothes they have on. but i want to make them items to be looted on the ground
// like dayz". Each piece is drawn in Higgsfield on one of the survivors in their base layer (scripts/survivors.mjs),
// the rest of them left bare, front and back, and made 3D by Meshy, rigged, in the same A-pose. So it is cut to the
// body it was made on, and fits it:
//
//   1. That body and the dressed one are both carried onto the game's skeleton (scripts/meshy.mjs, carry) and stood
//      at the skeleton's rest, where every point of the one can be laid against the other.
//   2. What of the dressed one is the body again (as near it as a centimetre and a bit, and as like it in colour: the
//      skin, the base layer showing below a hem) is cut away; and what lies over parts of the body the piece does not
//      cover (`parts`: REGION in src/sim/survivor.ts). What is left is the piece, bound as Meshy bound it.
//
// On the other bodies it is worn as cut; the skin under it is hidden there (src/game/survivors.ts), so nothing pokes
// through. Its colours and camouflages are its one picture made another colour in the game.

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, unpartition, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { M4, carry, markRegions } from './meshy.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
// (assets-src lives in the main checkout only: a session's worktree reads it from there)
const SRC_ROOT = existsSync(path.join(ROOT, 'assets-src')) ? path.join(ROOT, 'assets-src') : path.resolve(ROOT, '..', '..', '..', 'assets-src');
const SRC = path.join(SRC_ROOT, 'incoming', 'higgsfield', 'survivors');
const TEMPLATE = path.join(SRC_ROOT, 'characters', 'plain.glb');
const OUT = path.join(ROOT, 'public', 'assets', 'characters', 'wear');
const REGION = { scalp: 0, face: 1, neck: 2, chest: 3, belly: 4, hips: 5, shoulder: 6, upperArm: 7, forearm: 8, hand: 9, thigh: 10, aboveKnee: 11, shin: 12, foot: 13 };

/**
 * Each piece: its Meshy file, the body it was made on, the parts of the body it can be over (`parts`) and those it
 * surely covers (`core`: its own colour is learnt there), and its picture's size.
 */
const PIECES = {
  m65: { src: 'wear_m65.glb', body: 0, parts: ['neck', 'face', 'chest', 'belly', 'hips', 'shoulder', 'upperArm', 'forearm', 'hand', 'thigh'], core: ['chest', 'upperArm'], tex: 2048 },
};
/** the bodies as Meshy made them (scripts/survivors.mjs) */
const BODIES = ['body0_rigged.glb', 'body1_rigged.glb', 'body2_rigged.glb', 'body3_rigged.glb'];
const ONLY = process.argv.slice(2);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** a carried shape's points as its skeleton stands at rest, each with its colour off its picture (0..1) */
async function laid(node) {
  const skin = node.getSkin(), joints = skin.listJoints(), ibm = skin.getInverseBindMatrices();
  const M = joints.map((j, k) => M4(j.getWorldMatrix()).multiply(M4(ibm.getElement(k, []))));
  const prim = node.getMesh().listPrimitives()[0];
  const pos = prim.getAttribute('POSITION'), ji = prim.getAttribute('JOINTS_0'), jw = prim.getAttribute('WEIGHTS_0'), uv = prim.getAttribute('TEXCOORD_0');
  const tex = prim.getMaterial().getBaseColorTexture();
  const { data, info } = await sharp(Buffer.from(tex.getImage())).raw().toBuffer({ resolveWithObject: true });
  const P = [], C = [], v = new THREE.Vector3(), out = new THREE.Vector3();
  for (let i = 0; i < pos.getCount(); i++) {
    v.fromArray(pos.getElement(i, []));
    const a = ji.getElement(i, []), w = jw.getElement(i, []);
    out.set(0, 0, 0);
    for (let c = 0; c < 4; c++) if (w[c] > 0) out.addScaledVector(v.clone().applyMatrix4(M[a[c]]), w[c]);
    P.push(out.clone());
    const [s, t] = uv.getElement(i, []);
    const x = Math.min(info.width - 1, Math.max(0, Math.round(s * (info.width - 1)))), y = Math.min(info.height - 1, Math.max(0, Math.round(t * (info.height - 1))));
    const o = (y * info.width + x) * info.channels;
    C.push([data[o] / 255, data[o + 1] / 255, data[o + 2] / 255]);
  }
  return { P, C, prim };
}

for (const [id, piece] of Object.entries(PIECES)) {
  if (ONLY.length && !ONLY.includes(id)) continue;
  const body = await carry({ io, template: TEMPLATE, src: await io.read(path.join(SRC, BODIES[piece.body])), fingers: true });
  markRegions(body.doc, body.node);
  const dressed = await carry({ io, template: TEMPLATE, src: await io.read(path.join(SRC, piece.src)), fingers: false });
  const B = await laid(body.node), D = await laid(dressed.node);
  const region = body.node.getMesh().listPrimitives()[0].getAttribute('_REGION');

  // ---- the body's points by where they are, to find the nearest of them to each point of the dressed one
  const CELL = 0.03, grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  B.P.forEach((p, i) => {
    const k = key(p.x, p.y, p.z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const nearest = (p) => {
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), cz = Math.floor(p.z / CELL);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= 4 && (best < 0 || r <= 2); r++) {
      for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
        for (const i of grid.get(`${x},${y},${z}`) ?? []) {
          const d = B.P[i].distanceToSquared(p);
          if (d < bd) [best, bd] = [i, d];
        }
      }
    }
    return [best, Math.sqrt(bd)];
  };
  // ---- what colour the piece is: the middle of the colours of what lies over the parts it surely covers
  const parts = new Set(piece.parts.map((p) => REGION[p])), core = new Set(piece.core.map((p) => REGION[p]));
  const near = D.P.map((p) => nearest(p)[0]);
  const own = [0, 1, 2].map((ch) => {
    const v = near.flatMap((n, i) => (n >= 0 && core.has(region.getScalar(n)) ? [D.C[i][ch]] : [])).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  });
  // a point is the piece where it is nearer the piece's colour than the colour of the body under it (the skin at a cuff or
  // a collar, the shorts below a hem), and over a part the piece can be over
  const off = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const why = { part: new Array(14).fill(0), body: 0, kept: 0 };
  let keep = D.P.map((p, i) => {
    const n = near[i];
    if (n < 0 || !parts.has(region.getScalar(n))) return (why.part[n < 0 ? 0 : region.getScalar(n)]++, false);
    if (off(D.C[i], own) >= off(D.C[i], B.C[n])) return (why.body++, false);
    return (why.kept++, true);
  });
  if (process.env.WHY) console.log(JSON.stringify({ own: own.map((c) => +c.toFixed(3)), ...why }));

  // ---- evened out over the surface (a point's neighbours outvote it, twice), then the triangles all of whose points are kept.
  // (The surface as one: Meshy cuts it apart along every seam of its picture, a few hundred islands, so the points at
  // one place are taken as one point for which is next to which.)
  const idx = D.prim.getIndices(), T = [];
  for (let t = 0; t < idx.getCount(); t += 3) T.push([idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)]);
  const first = new Map(), one = D.P.map((p, i) => {
    const k = `${Math.round(p.x * 5000)},${Math.round(p.y * 5000)},${Math.round(p.z * 5000)}`;
    if (!first.has(k)) first.set(k, i);
    return first.get(k);
  });
  const next = D.P.map(() => new Set());
  for (const t of T) {
    const [a, b, c] = t.map((i) => one[i]);
    next[a].add(b).add(c), next[b].add(a).add(c), next[c].add(a).add(b);
  }
  // (a place is kept if its first point is: the points at one place decide together)
  keep = keep.map((k, i) => keep[one[i]]);
  for (let pass = 0; pass < 2; pass++) {
    const was = keep;
    keep = keep.map((k, i) => {
      const n = next[one[i]];
      return n.size ? [...n].filter((j) => was[j]).length * 2 > n.size : k;
    });
  }
  let tris = T.filter((t) => t.every((i) => keep[i]));
  // (and no crumbs: a piece of it apart from the rest, of fewer than fifty triangles, is cut away too)
  {
    const of = new Map();
    tris.forEach((t, k) => t.forEach((i) => (of.has(one[i]) ? of.get(one[i]).push(k) : of.set(one[i], [k]))));
    const seen = new Uint8Array(tris.length), lots = [];
    for (let s = 0; s < tris.length; s++) {
      if (seen[s]) continue;
      const lot = [s];
      seen[s] = 1;
      for (let h = 0; h < lot.length; h++) for (const i of tris[lot[h]]) for (const k of of.get(one[i])) if (!seen[k]) (seen[k] = 1), lot.push(k);
      lots.push(lot);
    }
    tris = lots.filter((l) => l.length >= 50).flat().map((k) => tris[k]);
  }

  // ---- the piece: only its own points, in the order they are first used
  const prim = D.prim, used = new Map();
  for (const t of tris) for (const i of t) if (!used.has(i)) used.set(i, used.size);
  for (const s of prim.listSemantics()) {
    const a = prim.getAttribute(s), n = a.getElementSize(), Kind = a.getArray().constructor, out = new Kind(used.size * n), e = [];
    for (const [i, j] of used) out.set(a.getElement(i, e), j * n);
    prim.setAttribute(s, dressed.doc.createAccessor().setType(a.getType()).setNormalized(a.getNormalized()).setArray(out));
  }
  prim.setIndices(dressed.doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(tris.flat().map((i) => used.get(i)))));
  dressed.node.setName('wear').getMesh().setName('wear');
  const mat = prim.getMaterial().setName(`wear_${id}`).setDoubleSided(true);
  // (how light its picture is where it is drawn, on average: a colour put on it is laid on in proportion to this, so that
  // its folds and wear stay as they are; see src/game/survivors.ts)
  {
    const { data, info } = await sharp(Buffer.from(mat.getBaseColorTexture().getImage())).raw().toBuffer({ resolveWithObject: true });
    const uv = prim.getAttribute('TEXCOORD_0'), e = [];
    let sum = 0;
    for (let i = 0; i < uv.getCount(); i++) {
      const [s, t] = uv.getElement(i, e), o = (Math.round(t * (info.height - 1)) * info.width + Math.round(s * (info.width - 1))) * info.channels;
      sum += 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    }
    mat.setExtras({ light: +(sum / uv.getCount() / 255).toFixed(4) });
  }
  await dressed.doc.transform(
    unpartition(),
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColorTexture$/, resize: [piece.tex, piece.tex], quality: 88 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await fs.mkdir(OUT, { recursive: true });
  const dest = path.join(OUT, `${id}.glb`);
  await io.write(dest, dressed.doc);
  const st = await fs.stat(dest);
  console.log(`${id}.glb  ${(st.size / 1048576).toFixed(2)} MB  ${tris.length} triangles of ${T.length}, ${used.size} points, light ${mat.getExtras().light}`);
}
