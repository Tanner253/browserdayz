// Things that are not from Poly Haven and are neither vehicles nor weapon packs: a vest, a
// crate, a syringe lifted out of a pack of arms. Each comes out the way a Poly Haven model
// does: standing on y = 0 about its own middle, in metres, in one file.
//
// Settings (scripts/assets.config.mjs, LOCAL_MODELS):
//   dir    – the folder under assets-src/models/ its download was unpacked into (its id, if not given)
//   only   – of everything the download draws, the pieces whose names match are kept
//   size   – how long its longest side comes out, metres (or `scale`: what brings it to metres)
//   rot    – turns that stand it upright, radians about x, then y, then z
//   tex    – its textures are brought down to this many pixels a side
//   metal, rough – for a material that says nothing about either (glTF then calls it bare metal)
//   budget – about how many triangles it is brought down to (a download drawn for a close-up may have a hundred thousand)
//   small  – textures whose names match are flat colour: kept tiny
//   pair   – it is a left and a right, worn a body's width apart (gloves, boots): they are brought together to lie side by side
//   cut    – only a part of it is wanted, and the download does not have that part as a piece of its own (a helmet on a
//            statue cast in one): `{ tall, keep(x, y, z) }`. The whole download is stood `tall` metres high about its own
//            middle, feet on the ground, and what `keep` says yes to, of every corner of a triangle, is kept
//   plain  – its glint map is left out (a thing seen small, whose map is mostly of what was cut away): `metal`, `rough` say what it is instead
//   both   – it is a shell, seen from inside as well as out
// A piece on a skeleton is taken as the skeleton holds it when nothing is moving.

import fs from 'node:fs/promises';
import path from 'node:path';
import { prune, weld, simplify, textureCompress, meshopt, getBounds, transformMesh } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { standSkin, mul, move, scaleBy } from './weapon-packs.mjs';

const about = {
  x: (a) => [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1],
  y: (a) => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1],
  z: (a) => [Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
};

/** The credit a Sketchfab download asks for, word for word out of the licence that came in it. */
export async function creditOf(dir) {
  const text = (await fs.readFile(path.join(dir, 'license.txt'), 'utf8')).replace(/\r/g, '');
  const field = (name) => text.match(new RegExp(`\\* ${name}:\\s*(.+)`))?.[1].trim();
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.startsWith('This work is based on'));
  return { name: field('title'), url: field('source'), author: field('author')?.replace(/\s*\(http.*\)$/, ''), licence: field('license type'), line };
}

/**
 * Keeps of a shape only the triangles all three of whose corners `keep` says yes to, and of
 * its points only those still used (what a file says its size is, is read off its points).
 * @returns how many triangles are left
 */
function keepOf(doc, prim, keep) {
  const pos = prim.getAttribute('POSITION'), n = pos.getCount();
  const idx = prim.getIndices();
  const index = idx ? idx.getArray() : Uint32Array.from({ length: n }, (_, i) => i);
  const ok = new Uint8Array(n), v = [];
  for (let i = 0; i < n; i++) {
    pos.getElement(i, v);
    ok[i] = keep(v[0], v[1], v[2]) ? 1 : 0;
  }
  const map = new Int32Array(n).fill(-1), out = [];
  let m = 0;
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    if (!(ok[a] && ok[b] && ok[c])) continue;
    for (const i of [a, b, c]) {
      if (map[i] < 0) map[i] = m++;
      out.push(map[i]);
    }
  }
  for (const sem of prim.listSemantics()) {
    const acc = prim.getAttribute(sem), size = acc.getElementSize(), src = acc.getArray();
    const dst = new src.constructor(m * size);
    for (let i = 0; i < n; i++) if (map[i] >= 0) for (let e = 0; e < size; e++) dst[map[i] * size + e] = src[i * size + e];
    prim.setAttribute(sem, acc.clone().setArray(dst));
  }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(m > 65535 ? new Uint32Array(out) : new Uint16Array(out)));
  return out.length / 3;
}

/** @returns its manifest entry and its credit */
export async function processProp(id, cfg, { io, SRC, OUT, FORCE, exists, countTris }) {
  const dir = path.join(SRC, 'models', cfg.dir ?? id);
  const gltfPath = path.join(dir, cfg.file ?? 'scene.gltf');
  if (!(await exists(gltfPath))) throw new Error(`${id}: put its glTF download in assets-src/models/${cfg.dir ?? id}/ (${cfg.file ?? 'scene.gltf'} is not there)`);
  const credit = { id, ...(await creditOf(dir)), changes: cfg.changes };
  if (!credit.line) throw new Error(`${id}: its licence asks for no credit line this script knows how to read (${credit.licence}): look at ${path.join(dir, 'license.txt')}`);
  const dest = path.join(OUT, 'models', `${id}.glb`);
  const stamp = JSON.stringify({ ...cfg, only: cfg.only?.source, small: cfg.small?.source, cut: cfg.cut ? `${cfg.cut.tall}: ${cfg.cut.keep}` : undefined, v: 6 });
  const metaPath = path.join(dir, `_meta_${id}.json`);
  let meta;
  if (!FORCE && (await exists(dest)) && (await exists(metaPath))) {
    meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    if (meta.stamp !== stamp) meta = undefined;
  }
  if (!meta) {
    const doc = await io.read(gltfPath);
    await doc.transform(weld());
    const root = doc.getRoot(), scene = root.listScenes()[0];
    const srcTris = countTris(doc);
    const label = (n) => `${n.getName()} ${n.getMesh().getName()} ${n.getMesh().listPrimitives().map((p) => p.getMaterial()?.getName() ?? '').join(' ')}`;
    const drawn = root.listNodes().filter((n) => n.getMesh() && (!cfg.only || cfg.only.test(label(n))));
    if (!drawn.length) throw new Error(`${id}: nothing it draws matches ${cfg.only}`);
    const meshes = [];
    for (const n of drawn) {
      const mesh = n.getMesh();
      if (mesh.listParents().filter((p) => p.propertyType === 'Node').length > 1) throw new Error(`${id}: ${n.getName()} shares its shape with another piece`);
      if (n.getSkin()) {
        for (const s of standSkin(n)) {
          s.prim.getAttribute('POSITION').setArray(s.P);
          if (s.N) s.prim.getAttribute('NORMAL').setArray(s.N);
          if (s.T) s.prim.getAttribute('TANGENT').setArray(s.T);
          for (const sem of ['JOINTS_0', 'WEIGHTS_0', 'JOINTS_1', 'WEIGHTS_1']) s.prim.setAttribute(sem, null);
        }
      } else transformMesh(mesh, n.getWorldMatrix());
      meshes.push(mesh);
    }
    for (const child of scene.listChildren()) scene.removeChild(child);
    for (const n of root.listNodes()) n.setMesh(null).setSkin(null);
    // (a movement thrown away whole leaves its keys behind in the file unless they are thrown away first)
    for (const a of root.listAnimations()) {
      for (const c of a.listChannels()) c.dispose();
      for (const sm of a.listSamplers()) sm.dispose();
      a.dispose();
    }
    for (const s of root.listSkins()) s.dispose();
    meshes.forEach((mesh, i) => scene.addChild(doc.createNode(meshes.length > 1 ? `${id}_${i}` : id).setMesh(mesh.setName(id))));
    if (cfg.cut) {
      // the whole of it stood so many metres tall about its own middle: the rule is said in those metres
      const b0 = getBounds(scene);
      const k = cfg.cut.tall / (b0.max[1] - b0.min[1]), cx = (b0.min[0] + b0.max[0]) / 2, cz = (b0.min[2] + b0.max[2]) / 2;
      let left = 0;
      for (const mesh of meshes) {
        for (const prim of mesh.listPrimitives()) {
          const n = keepOf(doc, prim, (x, y, z) => cfg.cut.keep((x - cx) * k, (y - b0.min[1]) * k, (z - cz) * k));
          if (!n) mesh.removePrimitive(prim);
          left += n;
        }
      }
      for (const node of scene.listChildren()) if (!node.getMesh().listPrimitives().length) scene.removeChild(node.setMesh(null));
      if (!left) throw new Error(`${id}: the cut keeps nothing`);
    }
    if (cfg.pair) {
      // each half by which side of the middle it is on; moved in until a finger's width is left between them
      let left = Infinity, right = -Infinity;
      const each = (fn) => {
        for (const mesh of meshes) for (const prim of mesh.listPrimitives()) {
          const pos = prim.getAttribute('POSITION'), v = [];
          for (let i = 0; i < pos.getCount(); i++) fn(pos, i, pos.getElement(i, v));
        }
      };
      // (the middle of the two, wherever the download happens to stand)
      let lo = Infinity, hi = -Infinity;
      each((_p, _i, v) => {
        lo = Math.min(lo, v[0]);
        hi = Math.max(hi, v[0]);
      });
      const mid = (lo + hi) / 2;
      each((_p, _i, v) => {
        if (v[0] > mid) left = Math.min(left, v[0]);
        else right = Math.max(right, v[0]);
      });
      const gap = (hi - lo) * 0.03;
      each((pos, i, v) => pos.setElement(i, [v[0] > mid ? v[0] - left + gap / 2 : v[0] - right - gap / 2, v[1], v[2]]));
    }
    // upright, then to size, then stood on the ground about its own middle
    const [rx, ry, rz] = cfg.rot ?? [0, 0, 0];
    const R = mul(about.z(rz), mul(about.y(ry), about.x(rx)));
    for (const mesh of meshes) transformMesh(mesh, R);
    const b = getBounds(scene);
    const s = cfg.scale ?? cfg.size / Math.max(...b.max.map((v, k) => v - b.min[k]));
    const M = mul(scaleBy(s), move(-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2));
    for (const mesh of meshes) transformMesh(mesh, M);
    for (const m of root.listMaterials()) {
      if (cfg.both) m.setDoubleSided(true);
      if (cfg.plain) m.setMetallicRoughnessTexture(null);
      if (m.getMetallicRoughnessTexture()) continue;
      if (cfg.metal !== undefined) m.setMetallicFactor(cfg.metal);
      if (cfg.rough !== undefined) m.setRoughnessFactor(cfg.rough);
    }
    await doc.transform(prune());
    if (cfg.budget && countTris(doc) > cfg.budget * 1.15) {
      await MeshoptSimplifier.ready;
      await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: cfg.budget / countTris(doc), error: 0.02 }), prune());
    }
    const bounds = getBounds(scene);
    const tris = countTris(doc);
    const side = cfg.tex ?? 1024;
    await doc.transform(
      ...(cfg.small ? [textureCompress({ encoder: sharp, targetFormat: 'webp', pattern: cfg.small, resize: [64, 64], quality: 88 })] : []),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [side, side], quality: 88 }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await io.write(dest, doc);
    meta = { stamp, srcTris, tris, min: bounds.min.map((v) => +v.toFixed(4)), max: bounds.max.map((v) => +v.toFixed(4)), lods: [] };
    await fs.writeFile(metaPath, JSON.stringify(meta));
  }
  const st = await fs.stat(dest);
  const { stamp: _stamp, ...out } = meta;
  const size = out.max.map((v, k) => (v - out.min[k]).toFixed(2)).join(' x ');
  console.log(`model ${id.padEnd(28)} ${String(meta.srcTris).padStart(7)} -> ${String(meta.tris).padStart(6)} tris             ${(st.size / 1024).toFixed(0).padStart(6)} KB  (${credit.author}; ${size} m)`);
  return { entry: { url: `assets/models/${id}.glb`, tags: cfg.tags || [], bytes: st.size, ...out }, credit };
}
