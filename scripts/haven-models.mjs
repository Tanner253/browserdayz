// Poly Haven models by themselves: `node scripts/haven-models.mjs <id> [<id> ...]` (add --force to make them again;
// --probe to only say how many triangles each would keep at a few sizes of error, to choose its `budget` by).
// Each id is one of MODELS in assets.config.mjs, which `npm run assets` builds with everything else; this does for
// the ones named what that run does for each (scripts/fetch-assets.mjs processModel: the same settings, the same
// files), writes them into the manifest and the credits where the whole run would, and nothing else. Then run
// `node scripts/tier-now.mjs` for the copy as it came (hi/) and the world's copy. (Written 2026-10-16 for the desert
// and the coast: `npm run assets` wrecks the manifest, and scripts/packs.mjs reads only downloads that are not Poly
// Haven's.)
//
// Sources go where the whole run puts them, assets-src/models/<id>/: set ASSETS_SRC to use another assets-src (a
// worktree has none of its own; the one in the main checkout is the one there is).

import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, textureCompress, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { MODELS } from './assets.config.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = process.env.ASSETS_SRC ? path.resolve(process.env.ASSETS_SRC) : path.join(ROOT, 'assets-src');
const OUT = path.join(ROOT, 'public', 'assets');
const FORCE = process.argv.includes('--force'), PROBE = process.argv.includes('--probe');
const UA = { headers: { 'User-Agent': 'dayz-web-slice-asset-pipeline/0.1' } };
const API = 'https://api.polyhaven.com';
const exists = (p) => fs.access(p).then(() => true, () => false);

async function get(url, as) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, UA);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return as === 'json' ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
}

async function download(url, dest, size) {
  if ((await exists(dest)) && (!size || (await fs.stat(dest)).size === size)) return;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, await get(url));
}

const countTris = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) n += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
  return Math.round(n);
};

/** scripts/fetch-assets.mjs `decimate`, line for line: about `target` triangles in all, the careful way first */
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

/** How many triangles are left when nothing may move further than `error` of the thing's size (what a budget is chosen by). */
function trisAt(doc, error) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = new Float32Array(prim.getAttribute('POSITION').getArray());
      const idx = prim.getIndices() ? new Uint32Array(prim.getIndices().getArray()) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      n += MeshoptSimplifier.simplify(idx, pos, 3, 3, error)[0].length / 3;
    }
  }
  return n;
}

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!ids.length) throw new Error('name the models (MODELS in scripts/assets.config.mjs)');
for (const id of ids) if (!MODELS[id]) throw new Error(`${id} is not in MODELS (scripts/assets.config.mjs)`);

const file = path.join(OUT, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
const credits = [];
for (const id of ids) {
  const cfg = MODELS[id];
  const files = await get(`${API}/files/${id}`, 'json');
  const g = files.gltf[cfg.res].gltf;
  const dir = path.join(SRC, 'models', id), gltfPath = path.join(dir, path.basename(g.url));
  await download(g.url, gltfPath, g.size);
  for (const [rel, f] of Object.entries(g.include || {})) await download(f.url, path.join(dir, rel), f.size);

  // `cutout`: a plant whose cards are cut out by a mask Poly Haven keeps as a picture of its own (its Alpha map) and
  // its glTF does not name: drawn without it, every card was a black square. The mask is put into the colour
  // picture's alpha, and what was to be blended is cut out at half (cheaper, and drawn in any order).
  const mask = cfg.cutout ? path.join(dir, 'textures', path.basename(files.Alpha[cfg.res].jpg.url)) : null;
  if (mask) await download(files.Alpha[cfg.res].jpg.url, mask, files.Alpha[cfg.res].jpg.size);
  const base = async () => {
    const doc = await io.read(gltfPath);
    await doc.transform(dedup(), prune(), weld());
    if (mask) {
      const alpha = await sharp(mask).greyscale().raw().toBuffer({ resolveWithObject: true });
      for (const m of doc.getRoot().listMaterials()) {
        if (m.getAlphaMode() !== 'BLEND' || !m.getBaseColorTexture()) continue;
        const t = m.getBaseColorTexture();
        if (!t.getExtras().cut) {
          // (the colour taken out bare first: sharp drops an alpha after joining one, whatever order it is asked in)
          const { width, height } = alpha.info;
          const rgb = await sharp(Buffer.from(t.getImage())).resize(width, height).removeAlpha().raw().toBuffer();
          const rgba = sharp(rgb, { raw: { width, height, channels: 3 } }).joinChannel(alpha.data, { raw: { width, height, channels: 1 } });
          t.setImage(new Uint8Array(await rgba.png().toBuffer())).setMimeType('image/png').setExtras({ cut: true });
        }
        m.setAlphaMode('MASK').setAlphaCutoff(0.5);
      }
    }
    return doc;
  };
  if (PROBE) {
    const doc = await base(), size = getBounds(doc.getRoot().listScenes()[0]);
    const span = Math.hypot(...size.max.map((v, k) => v - size.min[k]));
    const row = [0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01].map((e) => `${(e * span * 1000).toFixed(0)} mm: ${trisAt(doc, e)}`);
    console.log(`${id.padEnd(26)} ${countTris(doc)} as it came; ${row.join(', ')}`);
    continue;
  }

  // (the same stamp the whole run writes, so that it and this agree on whether a model is made as its settings say)
  const dest = path.join(OUT, 'models', `${id}.glb`), lodPath = path.join(OUT, 'models', `${id}_lod1.glb`), metaPath = path.join(dir, '_meta.json');
  const stamp = JSON.stringify({ tex: cfg.tex, budget: cfg.budget ?? null, far: cfg.far ?? null, isles: undefined, v: 2, ...(cfg.cutout ? { cutout: true } : {}) });
  let meta;
  if (!FORCE && (await exists(dest)) && (await exists(metaPath)) && (!cfg.far || (await exists(lodPath)))) {
    meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    if (meta.stamp !== stamp) meta = undefined;
  }
  if (!meta) {
    const doc = await base();
    const srcTris = countTris(doc), bounds = getBounds(doc.getRoot().listScenes()[0]);
    if (cfg.budget) decimate(doc, cfg.budget);
    const tris = countTris(doc);
    await doc.transform(prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex, cfg.tex], quality: 88 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await io.write(dest, doc);
    const lods = [];
    if (cfg.far) {
      const ld = await base();
      decimate(ld, cfg.far);
      const lodTris = countTris(ld);
      await ld.transform(prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], quality: 80 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
      await io.write(lodPath, ld);
      lods.push({ url: `assets/models/${id}_lod1.glb`, tris: lodTris });
    }
    meta = { stamp, srcTris, tris, min: bounds.min.map((v) => +v.toFixed(4)), max: bounds.max.map((v) => +v.toFixed(4)), lods };
    await fs.writeFile(metaPath, JSON.stringify(meta));
  }
  const st = await fs.stat(dest);
  const { stamp: _s, ...out } = meta;
  // (what the tiers step adds, `hi` and its weights, is kept until it is run again)
  const was = manifest.models[id] ?? {};
  manifest.models[id] = { url: `assets/models/${id}.glb`, tags: cfg.tags || [], bytes: st.size, ...out, ...(was.hi ? { hi: was.hi, hiBytes: was.hiBytes, hiCard: was.hiCard } : {}) };
  const info = await get(`${API}/info/${id}`, 'json');
  credits.push({ id, name: info.name, authors: Object.keys(info.authors || {}).join(', ') });
  console.log(`model ${id.padEnd(28)} ${String(meta.srcTris).padStart(7)} -> ${String(meta.tris).padStart(6)} tris${meta.lods[0] ? `, far ${String(meta.lods[0].tris).padStart(5)}` : ''}  ${(st.size / 1024).toFixed(0).padStart(6)} KB`);
}
if (!PROBE && ids.length) {
  manifest.generated = new Date().toISOString();
  await fs.writeFile(file, JSON.stringify(manifest, null, 1));
  // the credits: a row each in the table of what is public domain, among the other models in the order of their ids
  // (as the whole run writes them), the rows already there left as they are
  const cfile = path.join(ROOT, 'CREDITS.md');
  const text = await fs.readFile(cfile, 'utf8'), nl = text.includes('\r\n') ? '\r\n' : '\n', lines = text.split(nl);
  const row = (c) => `| model | [${c.name}](https://polyhaven.com/a/${c.id}) | ${c.authors} |`;
  const idOf = (l) => l.match(/polyhaven\.com\/a\/([^)]+)\)/)?.[1] ?? '';
  for (const c of credits.sort((a, b) => a.id.localeCompare(b.id))) {
    if (lines.some((l) => l.includes(`(https://polyhaven.com/a/${c.id})`))) continue;
    const first = lines.findIndex((l) => l.startsWith('| model |'));
    let at = first;
    while (at < lines.length && lines[at].startsWith('| model |') && idOf(lines[at]).localeCompare(c.id) < 0) at++;
    lines.splice(at, 0, row(c));
  }
  await fs.writeFile(cfile, lines.join(nl));
}
