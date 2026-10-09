// Things out of downloaded packs, built by themselves: `node scripts/packs.mjs <id> [<id> ...]`
// (add --force to build them again whatever has changed). Each id is one of LOCAL_MODELS or
// WEAPON_PACKS in assets.config.mjs, which `npm run assets` builds with everything else; this
// builds only the ones named, asks nothing of the network, and writes them into the manifest
// and the credits where the whole run would.

import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { LOCAL_MODELS, WEAPON_PACKS } from './assets.config.mjs';
import { processProp } from './props.mjs';
import { processWeaponPack } from './weapon-packs.mjs';

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!ids.length) throw new Error('name what to build: ' + [...Object.keys(LOCAL_MODELS), ...Object.keys(WEAPON_PACKS)].join(', '));
const FORCE = process.argv.includes('--force');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'assets-src'), OUT = path.join(ROOT, 'public', 'assets');
const exists = (p) => fs.access(p).then(() => true, () => false);
const countTris = (doc) => {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
  return Math.round(tris);
};
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const tools = { io, SRC, OUT, exists, countTris };

const entries = {}, credits = [];
for (const id of ids) {
  if (!(id in LOCAL_MODELS) && !(id in WEAPON_PACKS)) throw new Error(`${id} is neither a local model nor a weapon pack`);
  if (!(id in LOCAL_MODELS)) continue;
  const made = await processProp(id, LOCAL_MODELS[id], { ...tools, FORCE });
  entries[id] = made.entry;
  credits.push(made.credit);
}
// (a gun held in another pack's hands is fitted to that pack's gun: every pack is gone through in
// order, and the ones not named are read back from what was made of them before)
for (const [id, cfg] of Object.entries(WEAPON_PACKS)) {
  const wanted = ids.includes(id);
  if (!wanted && !ids.some((x) => WEAPON_PACKS[x]?.fit?.to === id)) continue;
  const made = await processWeaponPack(id, cfg, { ...tools, FORCE: FORCE && wanted });
  if (!wanted) continue;
  Object.assign(entries, made.entries);
  credits.push(made.credit);
}

const file = path.join(OUT, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
Object.assign(manifest.models, entries);
// (asset addresses carry the manifest's date: moved on, so no browser keeps an old one)
manifest.generated = new Date().toISOString();
await fs.writeFile(file, JSON.stringify(manifest, null, 1));

const creditsPath = path.join(ROOT, 'CREDITS.md');
let text = await fs.readFile(creditsPath, 'utf8');
const nl = text.includes('\r\n') ? '\r\n' : '\n';
for (const c of credits) {
  if (text.includes(c.line)) {
    // (one download, several things out of it: what was done to each is said on a line of its own)
    if (c.changes && !text.includes(c.changes)) {
      const at = text.indexOf(nl, text.indexOf(c.line));
      const end = text.indexOf(nl, at + nl.length);
      text = `${text.slice(0, end)}${nl}  Also: ${c.changes}${text.slice(end)}`;
      console.log(`${c.id}: added to its download's credit`);
    }
    continue;
  }
  const at = text.indexOf(`${nl}- "Uaz-469"`);
  if (at < 0) throw new Error('CREDITS.md is not laid out as expected: add the credit by hand');
  text = `${text.slice(0, at)}${nl}- ${c.line}${nl}  Changes made: ${c.changes}${text.slice(at)}`;
  console.log(`${c.id}: credited in CREDITS.md`);
}
await fs.writeFile(creditsPath, text);
