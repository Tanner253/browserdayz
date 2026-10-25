// The two-copy step (scripts/tiers.mjs) run by itself, over the manifest as it stands: after `node scripts/packs.mjs`
// has made a thing whose pictures are bigger than the world's copies may be.   node scripts/tier-now.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { tierModels } from './tiers.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
// (ASSETS_SRC: the sources elsewhere, as for a worktree, which has no assets-src of its own)
const SRC = process.env.ASSETS_SRC ? path.resolve(process.env.ASSETS_SRC) : path.join(ROOT, 'assets-src'), OUT = path.join(ROOT, 'public', 'assets');
const file = path.join(OUT, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
const made = await tierModels(manifest.models, { SRC, OUT });
await fs.writeFile(file, JSON.stringify(manifest, null, 1));
console.log(made);
