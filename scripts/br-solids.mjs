// Bakes the battle royale's walls for its server (2026-10-21): each map's solids as the game builds them
// (tools/br/br-solids.js, in the headless game), written to arena/br/solids/<map>.bin.gz, which arena/br/match.ts lays
// into its own physics so that a shot through a house is stopped there. Run again after any change to what stands on
// a map. Needs the dev page on 5173.   node scripts/br-solids.mjs [map index ...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const MAPS = ['desert', 'middle', 'village'];
const which = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [0, 1, 2];
fs.mkdirSync(path.join(ROOT, 'arena/br/solids'), { recursive: true });
for (const k of which) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'br-solids-'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'assets-src/_wf/me/play.mjs'), path.join(ROOT, 'tools/br/br-solids.js'), out, '640', '360', `http://localhost:5173/br?kills=${k}`], {
    cwd: ROOT, env: { ...process.env, PLAY_LIGHT: '1', PLAY_PORT: process.env.PLAY_PORT ?? '9362', PLAY_PRE: 'assets-src/_wf/me/still.js' }, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024,
  });
  fs.rmSync(out, { recursive: true, force: true });
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('{"n"'));
  if (!line) throw new Error(`map ${k}: no solids came back\n${(r.stdout ?? '').slice(-2000)}\n${(r.stderr ?? '').slice(-2000)}`);
  const got = JSON.parse(line);
  const file = path.join(ROOT, 'arena/br/solids', `${MAPS[k]}.bin.gz`);
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(got.data, 'base64'), { level: 9 }));
  console.log(`${MAPS[k]}: ${got.tris} triangles, ${got.verts} corners (${JSON.stringify(got.n)}) -> ${(fs.statSync(file).size / 1048576).toFixed(1)} MB`);
}
