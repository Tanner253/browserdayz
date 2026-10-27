// The map's walls for the server (server/walls.ts): the game is opened offline in a headless page, every fixed solid it
// has is written out (scripts/solid-bake.page.js), and the parts are put together and packed into
// server/solids.bin.gz. Run again after anything that moves or changes a building, a rock or a prop: the server
// holds the print in the file against its own map and goes without walls if they differ.
//   node scripts/solid-bake.mjs        (the dev page must be running on 5173; --again leans the file there again)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { MeshoptSimplifier as S } from 'meshoptimizer';
import RAPIER from '@dimforge/rapier3d-compat';

const ROOT = path.resolve(import.meta.dirname, '..');
const file = path.join(ROOT, 'server/solids.bin.gz');
await S.ready;
await RAPIER.init();
// (--again: the file there is leaned again, without opening the page)
let raw;
if (process.argv.includes('--again')) raw = gunzipSync(fs.readFileSync(file));
else {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-bake-'));
  const run = spawnSync(process.execPath, [path.join(ROOT, 'assets-src/_wf/me/play.mjs'), path.join(ROOT, 'scripts/solid-bake.page.js'), out, '640', '360', 'http://localhost:5173/zona?server=http://127.0.0.1:9'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, PLAY_LIGHT: '1', PLAY_PORT: process.env.PLAY_PORT ?? '9341', PLAY_PRE: path.join(ROOT, 'assets-src/_wf/me/still.js') },
  });
  if (run.status !== 0) throw new Error(`the page run failed (${run.status})`);
  const parts = fs.readdirSync(out).filter((f) => f.endsWith('.part')).sort();
  if (!parts.length) throw new Error('the page wrote nothing');
  raw = Buffer.concat(parts.map((f) => fs.readFileSync(path.join(out, f))));
  fs.rmSync(out, { recursive: true, force: true });
}
raw = lean(raw);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, gzipSync(raw, { level: 9 }));
console.log(`${file}: ${(raw.length / 1e6).toFixed(1)} MB raw, ${(fs.statSync(file).size / 1e6).toFixed(1)} MB packed`);

/**
 * Each shape made faces, brought down to within LEAN metres of itself: a scanned rock of thirty thousand faces stops a
 * round as well at a few hundred. As it came, the whole map was 566 MB on a server of 2 GB, read in 11 s; and Rapier
 * keeps a hull at many times the cost of the same faces (2026-10-27). So every hull (the game's, and each boulder a
 * pickaxe works, flag 4: lumps of stone, where the canyon's walls and its caves' mouths keep their shapes) goes as the
 * faces of its hull.
 */
function lean(raw) {
  const LEAN = 0.05;
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), hl = dv.getUint32(8, true);
  let o = 12 + ((hl + 3) & ~3);
  const head = raw.subarray(0, o), shapes = [];
  for (let n = dv.getUint32(o, true), i = ((o += 4), 0); i < n; i++) {
    const kind = dv.getUint32(o, true), nv = dv.getUint32(o + 4, true), ni = dv.getUint32(o + 8, true);
    o += 12;
    const v = new Float32Array(raw.buffer.slice(raw.byteOffset + o, raw.byteOffset + o + nv * 12));
    o += nv * 12;
    const ix = ni ? new Uint32Array(raw.buffer.slice(raw.byteOffset + o, raw.byteOffset + o + ni * 4)) : null;
    o += ni * 4;
    shapes.push({ kind, v, ix });
  }
  const rest = Buffer.from(raw.subarray(o)), boulder = new Map();
  for (let n = rest.readUInt32LE(0), i = 0, p = 4; i < n; i++, p += 44) if (rest[p] === 4) {
    const k = rest.readUInt32LE(p + 32);
    boulder.set(k, (boulder.get(k) ?? true) && (rest[p + 1] & 4) !== 0);
  }
  const hw = new RAPIER.World({ x: 0, y: 0, z: 0 });
  let before = 0, after = 0, hulls = 0;
  for (const [k, s] of shapes.entries()) {
    before += s.ix ? s.ix.length / 3 : 0;
    let { v, ix } = s;
    if (s.kind === 5 || boulder.get(k)) {
      const desc = RAPIER.ColliderDesc.convexHull(v);
      if (!desc) continue;
      const c = hw.createCollider(desc);
      [v, ix] = [c.vertices(), c.indices()];
      hw.removeCollider(c, false);
      hulls++;
    }
    if (!ix?.length) continue;
    // (one surface to the simplifier: corners split for the drawing's sake joined by where they are)
    const weld = S.generatePositionRemap(v, 3);
    let [kept] = S.simplify(ix.map((q) => weld[q]), v, 3, 0, LEAN, ['ErrorAbsolute']);
    // (a sliver brought down to nothing is kept as it was)
    if (!kept.length) kept = new Uint32Array(ix);
    const [remap, count] = S.compactMesh(kept);
    const nvv = new Float32Array(count * 3);
    for (let q = 0; q < remap.length; q++) if (remap[q] !== 0xffffffff) nvv.set(v.subarray(q * 3, q * 3 + 3), remap[q] * 3);
    shapes[k] = { kind: 4, v: nvv, ix: kept };
    after += kept.length / 3;
  }
  hw.free();
  for (let n = rest.readUInt32LE(0), i = 0, p = 4; i < n; i++, p += 44) if (rest[p] === 5 && shapes[rest.readUInt32LE(p + 32)].kind === 4) rest[p] = 4;
  const out = [head, u32(shapes.length)];
  for (const s of shapes) out.push(u32(s.kind), u32(s.v.length / 3), u32(s.ix ? s.ix.length : 0), Buffer.from(s.v.buffer, s.v.byteOffset, s.v.byteLength), ...(s.ix ? [Buffer.from(s.ix.buffer, s.ix.byteOffset, s.ix.byteLength)] : []));
  out.push(rest);
  console.log(`faces brought to within ${LEAN} m: ${before} to ${after}, ${hulls} hulls among them`);
  return Buffer.concat(out);
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
