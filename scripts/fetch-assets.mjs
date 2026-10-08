// Asset pipeline: Poly Haven (CC0) -> web-ready assets.
//
//   node scripts/fetch-assets.mjs            fetch + process everything missing
//   node scripts/fetch-assets.mjs --force    reprocess everything
//
// Raw downloads are cached in assets-src/ (gitignored). Processed output lands in
// public/assets/{models,tex,hdri} along with manifest.json and CREDITS.md.

import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, textureCompress, meshopt, getBounds, transformMesh } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { HDRI, TEXTURES, MODELS, LOCAL_MODELS, WEAPON_PACKS } from './assets.config.mjs';
import { processWeaponPack } from './weapon-packs.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'assets-src');
const OUT = path.join(ROOT, 'public', 'assets');
const FORCE = process.argv.includes('--force');
const UA = { headers: { 'User-Agent': 'dayz-web-slice-asset-pipeline/0.1' } };
const API = 'https://api.polyhaven.com';

const exists = (p) => fs.access(p).then(() => true, () => false);

async function getJSON(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, UA);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
    }
  }
}

async function download(url, dest, size) {
  if (await exists(dest)) {
    const st = await fs.stat(dest);
    if (!size || st.size === size) return dest;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, UA);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      const buf = Buffer.from(await r.arrayBuffer());
      await fs.writeFile(dest, buf);
      return dest;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
}

async function pool(items, n, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

const credits = [];
async function credit(id, type) {
  const info = await getJSON(`${API}/info/${id}`);
  credits.push({ id, type, name: info.name, authors: Object.keys(info.authors || {}).join(', ') });
}

// ---------------------------------------------------------------- HDRI
async function processHDRI() {
  const files = await getJSON(`${API}/files/${HDRI.id}`);
  const out = {};
  for (const [key, res] of [['background', HDRI.res], ['env', HDRI.envRes]]) {
    const f = files.hdri[res].hdr;
    const dest = path.join(OUT, 'hdri', `${HDRI.id}_${res}.hdr`);
    await download(f.url, dest, f.size);
    out[key] = `assets/hdri/${HDRI.id}_${res}.hdr`;
  }
  await credit(HDRI.id, 'hdri');
  console.log(`hdri  ${HDRI.id}`);
  return out;
}

// ---------------------------------------------------------------- textures
async function processTexture(id) {
  const cfg = TEXTURES[id];
  const files = await getJSON(`${API}/files/${id}`);
  const maps = { diff: files.Diffuse, nor: files.nor_gl, arm: files.arm };
  const out = {};
  for (const [slot, entry] of Object.entries(maps)) {
    if (!entry) throw new Error(`${id} missing ${slot}`);
    const f = entry[cfg.res].jpg;
    const raw = path.join(SRC, 'tex', id, path.basename(f.url));
    await download(f.url, raw, f.size);
    const dest = path.join(OUT, 'tex', `${id}_${slot}.webp`);
    if (FORCE || !(await exists(dest))) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await sharp(raw)
        .resize(cfg.tex, cfg.tex, { fit: 'inside' })
        .webp({ quality: slot === 'diff' ? 86 : 92, effort: 5 })
        .toFile(dest);
    }
    out[slot] = `assets/tex/${id}_${slot}.webp`;
  }
  await credit(id, 'texture');
  console.log(`tex   ${id}`);
  return out;
}

// ---------------------------------------------------------------- models
let io;
async function getIO() {
  if (io) return io;
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  return io;
}

function countTris(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += idx ? idx.getCount() / 3 : prim.getAttribute('POSITION').getCount() / 3;
    }
  }
  return Math.round(tris);
}

/**
 * Reduce a model to about `target` triangles in total. First the careful way (edge
 * collapses that keep silhouettes and texture seams); scans whose surface is torn into
 * unconnected pieces will not collapse like that, so those fall back to clustering
 * vertices, which always reaches the target and is plenty for something seen from afar.
 */
function decimate(doc, target) {
  const before = countTris(doc);
  if (before <= target) return;
  const ratio = target / before;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION');
      const positions = new Float32Array(posAcc.getArray());
      const idxAcc = prim.getIndices();
      const indices = idxAcc ? new Uint32Array(idxAcc.getArray()) : Uint32Array.from({ length: posAcc.getCount() }, (_, i) => i);
      const want = Math.max(36, Math.floor((indices.length * ratio) / 3) * 3);
      if (indices.length <= want) continue;
      let [out] = MeshoptSimplifier.simplify(indices, positions, 3, want, 0.06);
      if (out.length > want * 1.35) [out] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, want, 0.6);
      if (out.length < 3) continue;
      // drop the vertices nothing refers to any more
      const [remap, unique] = MeshoptSimplifier.compactMesh(out);
      for (const semantic of prim.listSemantics()) {
        const acc = prim.getAttribute(semantic);
        const src = acc.getArray();
        const size = acc.getElementSize();
        const dst = new src.constructor(unique * size);
        for (let i = 0; i < remap.length; i++) {
          const j = remap[i];
          if (j === 0xffffffff) continue;
          for (let k = 0; k < size; k++) dst[j * size + k] = src[i * size + k];
        }
        prim.setAttribute(semantic, acc.clone().setArray(dst));
      }
      const idx = (idxAcc ? idxAcc.clone() : doc.createAccessor().setType('SCALAR')).setArray(unique > 65535 ? out : new Uint16Array(out));
      prim.setIndices(idx);
    }
  }
}

async function processModel(id) {
  const cfg = MODELS[id];
  const files = await getJSON(`${API}/files/${id}`);
  const g = files.gltf[cfg.res].gltf;
  const dir = path.join(SRC, 'models', id);
  const gltfPath = path.join(dir, path.basename(g.url));
  await download(g.url, gltfPath, g.size);
  for (const [rel, f] of Object.entries(g.include || {})) {
    await download(f.url, path.join(dir, rel), f.size);
  }

  const io = await getIO();
  const dest = path.join(OUT, 'models', `${id}.glb`);
  const lodPath = path.join(OUT, 'models', `${id}_lod1.glb`);
  // reprocess when the settings for this model change, not only when files are missing
  const stamp = JSON.stringify({ tex: cfg.tex, budget: cfg.budget ?? null, far: cfg.far ?? null, v: 2 });
  let meta;

  const metaPath = path.join(SRC, 'models', id, '_meta.json');
  if (!FORCE && (await exists(dest)) && (await exists(metaPath)) && (!cfg.far || (await exists(lodPath)))) {
    meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    if (meta.stamp !== stamp) meta = undefined;
  }
  if (!meta) {
    const base = async () => {
      const doc = await io.read(gltfPath);
      await doc.transform(dedup(), prune(), weld());
      return doc;
    };

    const doc = await base();
    const srcTris = countTris(doc);
    // the footprint comes from the untouched model, so it does not shift when the budget changes
    const bounds = getBounds(doc.getRoot().listScenes()[0]);
    if (cfg.budget) decimate(doc, cfg.budget);
    const tris = countTris(doc);
    await doc.transform(
      prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex, cfg.tex], quality: 88 }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await io.write(dest, doc);

    // the version drawn from a distance: a few hundred triangles and small textures
    const lods = [];
    if (cfg.far) {
      const ld = await base();
      decimate(ld, cfg.far);
      const lodTris = countTris(ld);
      await ld.transform(
        prune(),
        textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], quality: 80 }),
        meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
      );
      await io.write(lodPath, ld);
      lods.push({ url: `assets/models/${id}_lod1.glb`, tris: lodTris });
    }

    meta = {
      stamp,
      srcTris,
      tris,
      min: bounds.min.map((v) => +v.toFixed(4)),
      max: bounds.max.map((v) => +v.toFixed(4)),
      lods,
    };
    await fs.writeFile(metaPath, JSON.stringify(meta));
  }

  const st = await fs.stat(dest);
  await credit(id, 'model');
  const { stamp: _stamp, ...out } = meta;
  console.log(`model ${id.padEnd(28)} ${String(meta.srcTris).padStart(7)} -> ${String(meta.tris).padStart(6)} tris${meta.lods[0] ? `, far ${String(meta.lods[0].tris).padStart(5)}` : '           '}  ${(st.size / 1024).toFixed(0).padStart(6)} KB`);
  return { url: `assets/models/${id}.glb`, tags: cfg.tags || [], bytes: st.size, ...out };
}

// ---------------------------------------------------------------- models that are not Poly Haven's
const mat4 = {
  mul(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  },
  move: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
  scale: (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1],
  turnY: (a) => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1],
  point: (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]),
};

/** the corners of everything a node draws, where they stand under a matrix: [min, max] */
function boundsUnder(node, m) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      const p = mat4.point(m, pos.getElement(i, v));
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[k]);
        hi[k] = Math.max(hi[k], p[k]);
      }
    }
  }
  return [lo, hi];
}

const localCredits = [];
async function processLocal(id) {
  const cfg = LOCAL_MODELS[id];
  const dir = path.join(SRC, 'models', id);
  const gltfPath = path.join(dir, cfg.file);
  if (!(await exists(gltfPath))) throw new Error(`${id}: put its glTF download in assets-src/models/${id}/ (${cfg.file} is not there)`);
  localCredits.push({ id, ...cfg.credit });
  const io = await getIO();
  const dest = path.join(OUT, 'models', `${id}.glb`);
  const stamp = JSON.stringify({ tex: cfg.tex, scale: cfg.scale, turn: cfg.turn, v: 1 });
  const metaPath = path.join(dir, '_meta.json');
  let meta;
  if (!FORCE && (await exists(dest)) && (await exists(metaPath))) {
    meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    if (meta.stamp !== stamp) meta = undefined;
  }
  if (!meta) {
    const doc = await io.read(gltfPath);
    // (nothing is merged before the pieces are set in place: four wheels drawn from one shape must become four shapes)
    await doc.transform(prune(), weld());
    const srcTris = countTris(doc);
    const scene = doc.getRoot().listScenes()[0];
    const drawn = doc.getRoot().listNodes().filter((n) => n.getMesh());
    const wheels = drawn.filter((n) => /wheel/i.test(`${n.getName()} ${n.getParentNode()?.getName() ?? ''}`));
    if (wheels.length !== 4) throw new Error(`${id}: expected four wheels, found ${wheels.length}`);
    // To metres, nose toward -z: and then stood on y = 0 with the middle of its wheelbase at the origin.
    const turned = mat4.mul(mat4.turnY(cfg.turn ?? 0), mat4.scale(cfg.scale ?? 1));
    const at = wheels.map((n) => boundsUnder(n, mat4.mul(turned, n.getWorldMatrix())));
    const mid = [0, 2].map((k) => at.reduce((s, [lo, hi]) => s + (lo[k] + hi[k]) / 2, 0) / 4);
    const ground = Math.min(...at.map(([lo]) => lo[1]));
    const place = mat4.mul(mat4.move(-mid[0], -ground, -mid[1]), turned);
    const parts = [];
    for (const n of drawn) {
      const m = mat4.mul(place, n.getWorldMatrix());
      const mesh = n.getMesh();
      const label = `${n.getName()} ${n.getParentNode()?.getName() ?? ''}`;
      let name = /glass/i.test(label) ? 'glass' : /helm|steer/i.test(label) ? 'helm' : 'body';
      let centre = [0, 0, 0];
      if (wheels.includes(n)) {
        // a wheel turns about its own middle: its points are kept about that, and the middle is where its node stands
        const [lo, hi] = boundsUnder(n, m);
        centre = lo.map((v, k) => (v + hi[k]) / 2);
        name = `wheel_${centre[2] < 0 ? 'f' : 'r'}${centre[0] < 0 ? 'l' : 'r'}`;
      }
      if (mesh.listParents().filter((p) => p.propertyType === 'Node').length > 1) throw new Error(`${id}: ${name} shares its shape with another piece`);
      transformMesh(mesh, mat4.mul(mat4.move(-centre[0], -centre[1], -centre[2]), m));
      mesh.setName(name);
      parts.push(doc.createNode(name).setMesh(mesh).setTranslation(centre));
    }
    for (const child of scene.listChildren()) scene.removeChild(child);
    for (const n of drawn) n.setMesh(null);
    for (const p of parts) scene.addChild(p);
    await doc.transform(prune());
    const bounds = getBounds(scene);
    const tris = countTris(doc);
    await doc.transform(
      ...(cfg.small ? [textureCompress({ encoder: sharp, targetFormat: 'webp', pattern: cfg.small, resize: [64, 64], quality: 88 })] : []),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex, cfg.tex], quality: 88 }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await io.write(dest, doc);
    meta = { stamp, srcTris, tris, min: bounds.min.map((v) => +v.toFixed(4)), max: bounds.max.map((v) => +v.toFixed(4)), lods: [] };
    await fs.writeFile(metaPath, JSON.stringify(meta));
  }
  const st = await fs.stat(dest);
  const { stamp: _stamp, ...out } = meta;
  console.log(`model ${id.padEnd(28)} ${String(meta.srcTris).padStart(7)} -> ${String(meta.tris).padStart(6)} tris             ${(st.size / 1024).toFixed(0).padStart(6)} KB  (not Poly Haven: ${cfg.credit.author})`);
  return { url: `assets/models/${id}.glb`, tags: cfg.tags || [], bytes: st.size, ...out };
}

// ---------------------------------------------------------------- main
const t0 = Date.now();
await fs.mkdir(OUT, { recursive: true });

const hdri = await processHDRI();
const texIds = Object.keys(TEXTURES);
const texOut = await pool(texIds, 4, processTexture);
const modelIds = Object.keys(MODELS);
const modelOut = await pool(modelIds, 3, processModel);
const localIds = Object.keys(LOCAL_MODELS);
const localOut = await pool(localIds, 1, processLocal);
// the weapon packs: each makes the gun alone and (most of them) the pack whole, for first person
const packEntries = {};
for (const [id, cfg] of Object.entries(WEAPON_PACKS)) {
  const made = await processWeaponPack(id, cfg, { io: await getIO(), SRC, OUT, FORCE, exists, countTris });
  Object.assign(packEntries, made.entries);
  localCredits.push(made.credit);
}

const manifest = {
  generated: new Date().toISOString(),
  hdri,
  textures: Object.fromEntries(texIds.map((id, i) => [id, texOut[i]])),
  models: { ...Object.fromEntries([...modelIds.map((id, i) => [id, modelOut[i]]), ...localIds.map((id, i) => [id, localOut[i]])]), ...packEntries },
};
await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

credits.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
const md = [
  '# Asset credits',
  '',
  "Everything in the table below is CC0 (public domain): attribution is not required but is given anyway.",
  "What is not CC0 is listed first, with the credit its licence asks for.",
  "",
  ...(localCredits.length
    ? ['## Attribution required', '', ...localCredits.flatMap((c) => [`- ${c.line}`, `  Changes made: ${c.changes}`]), '', '## Public domain (CC0)', '']
    : []),
  "The player character is built by `npm run character` from two packs by",
  "[Quaternius](https://quaternius.com): the body, face and hair from Universal Base Characters and the",
  "animations from the Universal Animation Library. Its clothes, gloves and boots, its build and its",
  "standing pose are made by that script.",
  "",
  "Everything else is from [Poly Haven](https://polyhaven.com). Procedural trees are generated with",
  "[EZ-Tree](https://github.com/dgreenheck/ez-tree) (MIT, Daniel Greenheck).",
  '',
  '| Type | Asset | Authors |',
  '| --- | --- | --- |',
  ...credits.map((c) => `| ${c.type} | [${c.name}](https://polyhaven.com/a/${c.id}) | ${c.authors} |`),
  '',
];
await fs.writeFile(path.join(ROOT, 'CREDITS.md'), md.join('\n'));

const totalBytes = modelOut.reduce((s, m) => s + m.bytes, 0);
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(0)}s — models ${(totalBytes / 1048576).toFixed(1)} MB`);
