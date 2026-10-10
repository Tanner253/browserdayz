// Where two faces of a building lie in one plane, facing the same way, over the same ground:
// the two are drawn turn and turn about and the wall flickers there ("z-fighting").
//
//   npx tsx scripts/overlap-audit.ts            every kind of building, the worst of each
//   npx tsx scripts/overlap-audit.ts house_two  one kind, every overlap
//   npx tsx scripts/overlap-audit.ts all 6      ... and faces up to 6 mm apart (those flicker from far off)
//
// One building of each kind is laid out as the game lays it and every piece it is made of is
// noted (Buildings.pieces). Each pair of pieces is then looked at triangle by triangle
// (src/dev/overlap.ts). What is printed is where the overlap is in the building's own measure
// (x across, y up, z along), which two things overlap there, and how much of them does.
//
// Two faces of one paint whose pattern runs on unbroken from one to the other show nothing,
// whichever is drawn (a window frame's corners are so): those are counted but not listed.
// It ends in failure if anything that shows is found in one plane with another.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { assets } from '../src/core/assets';
import { overlaps } from '../src/dev/overlap';
import { Buildings } from '../src/world/buildings';
import { generateWorld } from '../src/world/worldgen';

const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null;
const NEAR = (Number(process.argv[3]) || 0) / 1000;
(assets as { manifest: unknown }).manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'assets', 'manifest.json'), 'utf8'));
const world = generateWorld();
const b = new Buildings(world, null as never);
b.pieces = [];
b.plan();

type Noted = NonNullable<typeof b.pieces>[number];
const byKind = new Map<string, Noted[]>();
for (const q of b.pieces) (byKind.get(q.type) ?? byKind.set(q.type, []).get(q.type)!).push(q);

let total = 0, quiet = 0, same = 0;
for (const [kind, list] of byKind) {
  if (only && kind !== only) continue;
  const q0 = list[0];
  const inv = new THREE.Matrix4().compose(new THREE.Vector3(q0.x, q0.y, q0.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), q0.rot), new THREE.Vector3(1, 1, 1)).invert();
  // (what faces down into the ground, or lies under the floor, is seen by nobody)
  const all = overlaps(list.map((q) => ({ key: q.key, geo: q.geo.clone().applyMatrix4(inv) })), NEAR).filter((f) => !(f.n.y < -0.9 && f.at.y < 0.05) && f.at.y > -0.09);
  const seen = all.filter((f) => f.shows);
  total += seen.length;
  quiet += all.length - seen.length;
  same += seen.filter((f) => f.gap <= 0.0015).length;
  console.log(`${kind}: ${list.length} pieces, ${seen.length} overlaps that show${seen.length ? ` (${seen.reduce((s, f) => s + f.area, 0).toFixed(2)} m²)` : ''}, ${all.length - seen.length} that cannot`);
  for (const f of seen.slice(0, only ? 400 : 8)) console.log(`   ${f.area.toFixed(3)} m²  at x ${f.at.x.toFixed(2)} y ${f.at.y.toFixed(2)} z ${f.at.z.toFixed(2)}  facing ${[f.n.x, f.n.y, f.n.z].map((x) => x.toFixed(1)).join(',')}  ${f.a} + ${f.b}${f.gap > 0.0015 ? `  (${(f.gap * 1000).toFixed(0)} mm apart)` : ''}`);
}
console.log(`\n${total} overlaps that show (${same} of them in one plane), ${quiet} that cannot`);
process.exit(same ? 1 : 0);
