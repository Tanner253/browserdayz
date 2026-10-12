// A second, far lighter copy of every heavy thing that lies on the ground or is driven: `<id>_lod1.glb`, drawn when
// the thing is some metres off (see ItemModels.getFar in src/game/loot.ts). The model itself is left exactly as it
// is and is what is drawn up close: this is the same shape with fewer triangles and smaller pictures, made by
// collapsing the edges that change its outline least (meshoptimizer), never further than `error` of its own size.
//
// Why (2026-10-12, measured): nineteen boxes of pistol rounds in sight of the police headquarters were 1.7 million
// triangles a frame (one box is 69,000, the .45's 151,000), drawn again for every shadow; and the first sight of
// each sort of thing stopped the game while its 100,000 triangles were laid out. A box of rounds six metres off is
// forty pixels across.
//
//   node scripts/lods.mjs [--force] [id ...]      (also run at the end of scripts/fetch-assets.mjs)
import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, prune, weld, simplify, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

/** what gets one: what lies about to be picked up, and what is driven. (Not furniture, buildings or trees: those have their own.) */
const WANTS = (entry) => (entry.tags ?? []).some((t) => t === 'loot' || t === 'weapon' || t === 'vehicle') && !(entry.tags ?? []).includes('viewmodel');
/** lighter than this it is light enough as it is */
const HEAVY = 2500;
/** how many triangles to aim at, and how big its pictures: a thing in the hand's reach, and a car */
const AIM = { loot: { tris: 1600, tex: 256 }, vehicle: { tris: 14000, tex: 512 } };
/** how far from its own shape it may go, as a share of its size: tried in turn until it is light enough */
const ERRORS = [0.004, 0.01, 0.02, 0.04, 0.07];
const V = 2;

const countTris = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) n += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
  return Math.round(n);
};

export async function farModels(models, { OUT, force = false, only = null, log = console.log }) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  let made = 0, kept = 0;
  for (const [id, entry] of Object.entries(models)) {
    if (only && !only.includes(id)) continue;
    const ours = entry.lods?.[0]?.far === V;
    if (!WANTS(entry) || entry.tris < HEAVY || (entry.lods?.length && !entry.lods[0].far)) continue;
    const src = path.join(OUT, '..', entry.url), dest = path.join(OUT, 'models', `${id}_lod1.glb`);
    const st = await fs.stat(src);
    const stamp = `${st.size}:${Math.round(st.mtimeMs)}`;
    if (!force && ours && entry.lods[0].of === stamp && (await fs.stat(dest).catch(() => null))) {
      kept++;
      continue;
    }
    const aim = (entry.tags ?? []).includes('vehicle') ? AIM.vehicle : AIM.loot;
    const named = (entry.tags ?? []).some((t) => t === 'weapon' || t === 'vehicle');
    let doc, tris = entry.tris;
    try {
    for (const error of ERRORS) {
      doc = await io.read(src);
      // (A thing that is many small pieces, a box of fifty rounds, is made one piece first: each piece by itself
      // is held to a share of its OWN size, which for a round is a hair, and nothing of it could be let go. A gun
      // keeps its pieces: they are told apart by name when it lies there with this fitted and that not.)
      if (!named) await doc.transform(dedup(), flatten(), join({ keepNamed: false }));
      await doc.transform(dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.01, aim.tris / entry.tris), error, lockBorder: false }));
      tris = countTris(doc);
      if (tris <= aim.tris * 1.6) break;
    }
    await doc.transform(prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [aim.tex, aim.tex], quality: 84 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await io.write(dest, doc);
    const bytes = (await fs.stat(dest)).size;
    entry.lods = [{ url: `assets/models/${id}_lod1.glb`, tris, far: V, of: stamp }];
    made++;
    log(`far ${id.padEnd(30)} ${String(entry.tris).padStart(7)} -> ${String(tris).padStart(6)} triangles, ${(bytes / 1024).toFixed(0)} KB`);
    } catch (e) {
      // (one that cannot be made lighter is drawn as it is, as it was before there were any of these)
      log(`far ${id.padEnd(30)} NOT MADE: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { made, kept };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
  const OUT = path.join(ROOT, 'public', 'assets'), file = path.join(OUT, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  const args = process.argv.slice(2), ids = args.filter((a) => !a.startsWith('--'));
  const r = await farModels(manifest.models, { OUT, force: args.includes('--force'), only: ids.length ? ids : null });
  await fs.writeFile(file, JSON.stringify(manifest, null, 1));
  console.log(`${r.made} made, ${r.kept} as they were`);
}
