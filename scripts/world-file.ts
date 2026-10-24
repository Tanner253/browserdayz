// npx tsx scripts/world-file.ts <out file>: the map made once, as the site is built, for the page to fetch instead of
// making it (src/world/world-file.ts says why and how it is kept). vite.config.ts runs it, naming the file after the
// map's worker: a worker of another build is another file, never one of the wrong map. Gzipped at the most, each grid
// laid out the way that packs smallest.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { generateWorld } from '../src/world/worldgen';
import { WORLD_NX } from '../src/world/worldgen/places';
import { withCaves } from '../src/world/caves-carved';
import { packWorld } from '../src/world/world-file';

const out = process.argv[2];
if (!out) throw new Error('npx tsx scripts/world-file.ts <out file>');
const t0 = performance.now();
const world = withCaves(generateWorld());
const t1 = performance.now();
const raw = packWorld(world, WORLD_NX, (b) => gzipSync(b, { level: 6 }).length);
const gz = gzipSync(raw, { level: 9 });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gz);
console.log(`world file ${out}: ${(gz.length / 1048576).toFixed(2)} MB (${(raw.length / 1048576).toFixed(1)} unpacked), made in ${((t1 - t0) / 1000).toFixed(0)} s, packed in ${((performance.now() - t1) / 1000).toFixed(1)} s`);
