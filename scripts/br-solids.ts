// Bakes the battle royale's walls for its server (2026-10-21): each map's solids as the game builds them
// (tools/br/br-solids.js, in the headless game), made simple (arena/br/solids.ts: every mesh a few boxes, rocks hulls,
// trunks cylinders) and written to arena/br/solids/<map>.bin.gz, which arena/br/match.ts lays into its own physics.
// Run again after any change to what stands on a map. Needs the dev page on 5173.
//   npx tsx scripts/br-solids.ts [map index ...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boxify, writeSolids } from '../arena/br/solids';
import { MAPS } from '../arena/br/rules';
import { SPOTS_FILE, spotsFile } from '../arena/br/loot';
import { assets } from '../src/core/assets';
import { Buildings } from '../src/world/buildings';
import { caveLootPoints } from '../src/world/caves-carved';
import { ruinLoot, ruinsPlan } from '../src/sim/ruins';
import { generateWorld, heightAt } from '../src/world/worldgen';

const ROOT = process.cwd();
const which = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : MAPS.map((_, k) => k);
fs.mkdirSync(path.join(ROOT, 'arena/br/solids'), { recursive: true });

// every place for a thing, planned as the game server plans them (server/world.ts, buildWorldData), with its step
{
  const at = ['dist/assets/manifest.json', 'public/assets/manifest.json'].map((p) => path.join(ROOT, p)).filter((p) => fs.existsSync(p)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (at) (assets as { manifest: unknown }).manifest = JSON.parse(fs.readFileSync(at, 'utf8'));
  const world = generateWorld(), b = new Buildings(world, null as never);
  b.plan();
  const ground = (x: number, z: number) => heightAt(world.heights, x, z);
  if (world.kalat) for (const { piece, place } of ruinsPlan(world.kalat)) b.lootPoints.push(...ruinLoot(piece, place, ground));
  b.lootPoints.push(...caveLootPoints());
  fs.writeFileSync(path.join(ROOT, SPOTS_FILE), spotsFile(b.lootPoints.map((p) => ({ x: p.x, y: p.y, z: p.z, tier: p.tier ?? 2 }))));
  console.log(`${b.lootPoints.length} places for things -> ${SPOTS_FILE}`);
}
for (const k of which) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'br-solids-'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'assets-src/_wf/me/play.mjs'), path.join(ROOT, 'tools/br/br-solids.js'), out, '640', '360', `http://localhost:5173/battleroyale?kills=${k}`], {
    cwd: ROOT, env: { ...process.env, PLAY_LIGHT: '1', PLAY_PORT: process.env.PLAY_PORT ?? '9362', PLAY_PRE: 'assets-src/_wf/me/still.js' }, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024,
  });
  fs.rmSync(out, { recursive: true, force: true });
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('{"n"'));
  if (!line) throw new Error(`map ${k}: nothing came back\n${(r.stdout ?? '').slice(-2000)}\n${(r.stderr ?? '').slice(-2000)}`);
  const got = JSON.parse(line) as { n: Record<string, number>; data: string };
  const raw = Buffer.from(got.data, 'base64'), f = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const boxes: number[] = [], hulls: Float32Array[] = [], cyl: number[] = [];
  let tris = 0, meshBoxes = 0;
  for (let i = 0; i < f.length; ) {
    const kind = f[i++];
    if (kind === 1) {
      const nv = f[i++], nt = f[i++], v = f.subarray(i, i + nv * 3), t = f.subarray(i + nv * 3, i + nv * 3 + nt * 3);
      i += nv * 3 + nt * 3;
      tris += nt;
      const b = boxify(v, t);
      meshBoxes += b.length / 10;
      for (const x of b) boxes.push(x);
    } else if (kind === 2) {
      for (let j = 0; j < 10; j++) boxes.push(f[i + j]);
      i += 10;
    } else if (kind === 3) {
      const n = f[i++];
      hulls.push(f.slice(i, i + n * 3));
      i += n * 3;
    } else if (kind === 4) {
      for (let j = 0; j < 9; j++) cyl.push(f[i + j]);
      i += 9;
    } else throw new Error(`map ${k}: a thing of kind ${kind} at ${i}`);
  }
  const file = path.join(ROOT, 'arena/br/solids', `${MAPS[k].id}.bin.gz`);
  fs.writeFileSync(file, writeSolids({ boxes: new Float32Array(boxes), hulls, cylinders: new Float32Array(cyl) }));
  console.log(`${MAPS[k].name}: ${got.n.mesh} meshes (${tris} triangles) became ${meshBoxes} boxes; with the ${got.n.box} boxes, ${got.n.hull} hulls and ${got.n.cylinder} cylinders the game has -> ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
