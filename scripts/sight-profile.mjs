// The top of a gun-alone file seen from the side (node scripts/sight-profile.mjs <id> [piece] [step mm]): for each
// slice along the barrel, the highest point near its middle line and how wide the gun is there. Where its sights
// stand (a notch, a post) is read off this, for SIGHT_LINE in src/game/weapons.ts: aligned by the file, not by eye.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [id, piece = 'base', stepMm = '5'] = process.argv.slice(2);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(`public/assets/models/hi/${id}.glb`).catch(() => io.read(`public/assets/models/${id}.glb`));
const pts = [];
for (const n of doc.getRoot().listNodes()) {
  if (n.getName() !== piece || !n.getMesh()) continue;
  const M = n.getWorldMatrix();
  for (const p of n.getMesh().listPrimitives()) {
    const a = p.getAttribute('POSITION'), v = [0, 0, 0];
    for (let i = 0; i < a.getCount(); i++) {
      a.getElement(i, v);
      pts.push([0, 1, 2].map((r) => M[r] * v[0] + M[4 + r] * v[1] + M[8 + r] * v[2] + M[12 + r]));
    }
  }
}
let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
const zc = (lo[2] + hi[2]) / 2, step = +stepMm / 1000;
// (`x0:x1` in place of a step: the stretch from x0 to x1 looked at down the barrel, half a millimetre a character)
if (stepMm.includes(':')) {
  const [x0, x1] = stepMm.split(':').map(Number);
  const s = pts.filter((p) => p[0] >= x0 && p[0] <= x1);
  const zs = s.map((p) => p[2]), top = Math.max(...s.map((p) => p[1])), W = 90, H = 60, z0 = (Math.min(...zs) + Math.max(...zs)) / 2 - (W / 2) * 0.0005;
  const grid = Array.from({ length: H }, () => Array(W).fill(' '));
  for (const p of s) { const c = Math.round((p[2] - z0) / 0.0005), r = Math.round((top - p[1]) / 0.0005); if (c >= 0 && c < W && r >= 0 && r < H) grid[r][c] = '#'; }
  console.log(`x ${x0}..${x1}: columns from z ${z0.toFixed(4)}, rows down from y ${top.toFixed(4)}, 0.5 mm each`);
  console.log(grid.map((r) => '|' + r.join('')).join(String.fromCharCode(10)));
  process.exit(0);
}
console.log(`${id}/${piece}: ${pts.length} points, x ${lo[0].toFixed(3)}..${hi[0].toFixed(3)} y ${lo[1].toFixed(3)}..${hi[1].toFixed(3)} z ${lo[2].toFixed(4)}..${hi[2].toFixed(4)} (middle ${zc.toFixed(4)})`);
for (let x = lo[0]; x < hi[0]; x += step) {
  const s = pts.filter((p) => p[0] >= x && p[0] < x + step);
  if (!s.length) continue;
  const top = Math.max(...s.map((p) => p[1]));
  const mid = s.filter((p) => Math.abs(p[2] - zc) < 0.0015);
  const midTop = mid.length ? Math.max(...mid.map((p) => p[1])) : NaN;
  // (across the top 4 mm: how wide it is, and where its middle is: a notch shows as a gap, a post as a narrow band)
  const near = s.filter((p) => p[1] > top - 0.004);
  const zs = near.map((p) => p[2]);
  console.log(`x ${(x + step / 2).toFixed(3)}  top ${top.toFixed(4)}  middle-line top ${midTop.toFixed(4)}  top 4mm z ${Math.min(...zs).toFixed(4)}..${Math.max(...zs).toFixed(4)}`);
}
