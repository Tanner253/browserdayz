// The wall, floor and roof pictures by themselves: `node scripts/textures.mjs [<id> ...]` (add --force to make
// them again). Each id is one of TEXTURES in assets.config.mjs, which `npm run assets` fetches with everything
// else; this fetches only the ones named (or, with none named, only those the manifest does not have yet) from
// Poly Haven, makes them the size the game uses, and writes them into the manifest and the credits where the
// whole run would. Nothing else is fetched or rebuilt.

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { TEXTURES } from './assets.config.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'assets-src'), OUT = path.join(ROOT, 'public', 'assets');
const FORCE = process.argv.includes('--force');
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

const manifestFile = path.join(OUT, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
const named = process.argv.slice(2).filter((a) => !a.startsWith('--'));
for (const id of named) if (!TEXTURES[id]) throw new Error(`${id} is not in TEXTURES (scripts/assets.config.mjs)`);
const ids = named.length ? named : Object.keys(TEXTURES).filter((id) => !manifest.textures[id]);
if (!ids.length) console.log('every picture in TEXTURES is in the manifest already');

const credits = [];
let fetched = 0;
for (const id of ids) {
  const cfg = TEXTURES[id];
  const files = await get(`${API}/files/${id}`, 'json');
  const maps = { diff: files.Diffuse, nor: files.nor_gl, arm: files.arm };
  const out = {};
  for (const [slot, entry] of Object.entries(maps)) {
    if (!entry) throw new Error(`${id} has no ${slot}`);
    const f = entry[cfg.res].jpg;
    const raw = path.join(SRC, 'tex', id, path.basename(f.url));
    if (!(await exists(raw)) || (await fs.stat(raw)).size !== f.size) {
      await fs.mkdir(path.dirname(raw), { recursive: true });
      await fs.writeFile(raw, await get(f.url));
      fetched += f.size;
    }
    const dest = path.join(OUT, 'tex', `${id}_${slot}.webp`);
    if (FORCE || !(await exists(dest))) {
      await sharp(await fs.readFile(raw)).resize(cfg.tex, cfg.tex, { fit: 'inside' }).webp({ quality: slot === 'diff' ? 86 : 92, effort: 5 }).toFile(dest);
    }
    out[slot] = `assets/tex/${id}_${slot}.webp`;
  }
  manifest.textures[id] = out;
  const info = await get(`${API}/info/${id}`, 'json');
  credits.push({ id, name: info.name, authors: Object.keys(info.authors || {}).join(', ') });
  console.log(`tex   ${id}`);
}
if (ids.length) {
  await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 1));
  // the credits: a row each in the table of what is public domain, among the other pictures, in the order of their names
  const file = path.join(ROOT, 'CREDITS.md');
  const lines = (await fs.readFile(file, 'utf8')).split('\n');
  const row = (c) => `| texture | [${c.name}](https://polyhaven.com/a/${c.id}) | ${c.authors} |`;
  const has = (c) => lines.some((l) => l.includes(`(https://polyhaven.com/a/${c.id})`));
  const first = lines.findIndex((l) => l.startsWith('| texture |'));
  let last = first;
  while (last + 1 < lines.length && lines[last + 1].startsWith('| texture |')) last++;
  const rows = [...lines.slice(first, last + 1), ...credits.filter((c) => !has(c)).map(row)].sort((a, b) => a.localeCompare(b));
  lines.splice(first, last - first + 1, ...rows);
  await fs.writeFile(file, lines.join('\n'));
  console.log(`${ids.length} pictures; ${(fetched / 1048576).toFixed(1)} MB fetched`);
}
