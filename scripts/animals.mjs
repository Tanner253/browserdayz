// The animals' models (2026-10-23), brought in whole: skin, skeleton and the movements the game plays, which the props'
// way (scripts/props.mjs) throws away. `node scripts/animals.mjs <id> [<id> ...] [--force]`, then `node scripts/lean.mjs`.
//
// Each comes out standing on y = 0 about its own middle, nose toward -z (as a person faces), so many metres from nose
// to tail, its pictures at no more than 2048 a side (the owner: "2048 should be our max for new models"). Of the
// movements it came with, only those the game plays are kept, under the game's names for them (src/game/animals.ts:
// idle, graze, walk, trot, run, alert, rest, swipe, bite, roar, hit, death, drink); a download whose movements are one
// long take keeps the take, and the times it is cut at are written beside it in the manifest (`cuts`).
//
// Settings, ANIMAL_MODELS below:
//   dir    – its download, unpacked under assets-src/models/
//   len    – metres nose to tail
//   rot    – turns that put it upright and nose to -z, radians about x, then y, then z
//   clips  – { game name: what its own movement is called (a regular expression) }
//   cuts   – or: { game name: [from, to] seconds of its one take }
//   tex    – the most pixels a side of its pictures

import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, textureCompress, meshopt, getBounds, metalRough, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { creditOf } from './props.mjs';

export const ANIMAL_MODELS = {
  // (the deer that was on disk: one take of 17.5 s, cut where its movements change; a stand-in until the downloads)
  animal_stag: {
    dir: 'deer_creosine', len: 2.1, rot: [0, Math.PI, 0], tex: 1024,
    cuts: { run: [11.6, 12.6], graze: [1.4, 2.2], idle: [2.6, 3.9], alert: [6.8, 8.6], walk: [9.0, 10.6], trot: [10.8, 11.4] },
  },
};

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = process.env.ASSETS_SRC ?? path.join(ROOT, 'assets-src'), OUT = path.join(ROOT, 'public', 'assets');
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!ids.length) throw new Error('name what to build: ' + Object.keys(ANIMAL_MODELS).join(', '));
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const countTris = (doc) => Math.round(doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((a, p) => a + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0));
const quat = ([x, y, z]) => {
  // (turns about x, then y, then z, as one quaternion)
  const q = (ax, a) => [ax[0] * Math.sin(a / 2), ax[1] * Math.sin(a / 2), ax[2] * Math.sin(a / 2), Math.cos(a / 2)];
  const mul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  return mul(q([0, 0, 1], z), mul(q([0, 1, 0], y), q([1, 0, 0], x)));
};

const entries = {}, credits = [];
for (const id of ids) {
  const cfg = ANIMAL_MODELS[id];
  if (!cfg) throw new Error(`${id} is not an animal: ${Object.keys(ANIMAL_MODELS).join(', ')}`);
  const dir = path.join(SRC, 'models', cfg.dir);
  const doc = await io.read(path.join(dir, cfg.file ?? 'scene.gltf'));
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_materials_pbrSpecularGlossiness')) await doc.transform(metalRough());
  const root = doc.getRoot(), scene = root.listScenes()[0];
  const srcTris = countTris(doc);
  // the movements the game plays, under its names; the rest thrown away (keys and all)
  const anims = root.listAnimations(), kept = new Set();
  const drop = (a) => {
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  };
  let cuts;
  if (cfg.cuts) {
    if (!anims.length) throw new Error(`${id}: it has no movement to cut`);
    anims[0].setName('take');
    kept.add(anims[0]);
    cuts = cfg.cuts;
  } else {
    for (const [name, re] of Object.entries(cfg.clips ?? {})) {
      const a = anims.find((x) => !kept.has(x) && re.test(x.getName()));
      if (!a) throw new Error(`${id}: no movement of it is called ${re} (it has: ${anims.map((x) => x.getName()).join(', ')})`);
      a.setName(name);
      kept.add(a);
    }
  }
  for (const a of anims) if (!kept.has(a)) drop(a);
  // upright and nose to -z under one piece of its own, then to size and stood on the ground about its middle
  const top = doc.createNode(id);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    top.addChild(child);
  }
  scene.addChild(top);
  top.setRotation(quat(cfg.rot ?? [0, 0, 0]));
  let b = getBounds(scene);
  const s = cfg.len / (b.max[2] - b.min[2]);
  top.setScale([s, s, s]);
  b = getBounds(scene);
  top.setTranslation([-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2]);
  b = getBounds(scene);
  await doc.transform(dedup(), prune({ keepLeaves: false }), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex ?? 2048, cfg.tex ?? 2048], quality: 88 }), ...(process.env.ANIMAL_PLAIN ? [] : [meshopt({ encoder: MeshoptEncoder, level: 'medium' })]));
  const dest = path.join(OUT, 'models', `${id}.glb`);
  await io.write(dest, doc);
  const st = await fs.stat(dest);
  const clips = root.listAnimations().map((a) => a.getName());
  console.log(`animal ${id.padEnd(16)} ${srcTris} tris  ${(st.size / 1024).toFixed(0)} KB  ${b.max.map((v, k) => (v - b.min[k]).toFixed(2)).join(' x ')} m  [${clips.join(' ')}]`);
  entries[id] = { url: `assets/models/${id}.glb`, tags: ['animal'], bytes: st.size, tris: srcTris, min: b.min.map((v) => +v.toFixed(4)), max: b.max.map((v) => +v.toFixed(4)), lods: [], clips, ...(cuts ? { cuts } : {}) };
  credits.push({ id, ...(await creditOf(dir)), changes: `Kept whole with its skeleton and ${cuts ? 'its one take of movement (the game cuts it where its movements change)' : `the movements the game plays (${clips.join(', ')}), the others left out`}; turned nose to -z, scaled to ${cfg.len} m nose to tail and stood on the ground; textures re-encoded as WebP at no more than ${cfg.tex ?? 2048} a side; geometry compressed.` });
}

const file = path.join(OUT, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
Object.assign(manifest.models, entries);
manifest.generated = new Date().toISOString();
await fs.writeFile(file, JSON.stringify(manifest, null, 1));
const creditsPath = path.join(ROOT, 'CREDITS.md');
let text = await fs.readFile(creditsPath, 'utf8');
const nl = text.includes('\r\n') ? '\r\n' : '\n';
for (const c of credits) {
  if (!c.line) throw new Error(`${c.id}: no credit line in its licence`);
  if (text.includes(c.line)) continue;
  const at = text.indexOf(`${nl}- "Uaz-469"`);
  if (at < 0) throw new Error('CREDITS.md is not laid out as expected: add the credit by hand');
  text = `${text.slice(0, at)}${nl}- ${c.line}${nl}  Changes made: ${c.changes}${text.slice(at)}`;
  console.log(`${c.id}: credited in CREDITS.md`);
}
await fs.writeFile(creditsPath, text);
