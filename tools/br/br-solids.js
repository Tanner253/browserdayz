// The battle royale's walls, as the game builds them (2026-10-21), handed back raw, one thing at a time, for
// scripts/br-solids.ts to make simple shapes of (arena/br/solids.ts): every solid the game stops a shot with on one map
// (the buildings' triangles, walls, fences, the fort, rocks, trunks). Doors (they swing), glass, bushes, bodies and the
// ground itself (the server has the ground) are left out.
//   node assets-src/_wf/me/play.mjs tools/br/br-solids.js <out dir> 640 360 "http://localhost:5173/battleroyale?kills=<map>"
// The stream, as floats: for each thing its kind, then 1 (a mesh): corners, triangles, the corners (x y z), the
// triangles (three corners each); 2 (a box): x y z, half sizes, turn (x y z w); 3 (a hull): points, the points; 4 (a
// cylinder): x y z, turn (x y z w), half its height, its radius. All in the world's metres.
const { physics, G_WORLD } = await import('/src/core/physics.ts');
const { assets } = await import('/src/core/assets.ts');
await assets.idle();
await T.wait(4000);
const R = physics.R, out = [];
const n = { mesh: 0, box: 0, hull: 0, cylinder: 0, skipped: 0, owned: 0 };
const v = new T.THREE.Vector3(), qq = new T.THREE.Quaternion();
const world = (local, t, q) => {
  qq.set(q.x, q.y, q.z, q.w);
  const pts = [];
  for (let i = 0; i < local.length; i += 3) {
    v.set(local[i], local[i + 1], local[i + 2]).applyQuaternion(qq);
    pts.push(v.x + t.x, v.y + t.y, v.z + t.z);
  }
  return pts;
};
const push = (a) => {
  for (const x of a) out.push(x);
};
physics.world.forEachCollider((c) => {
  const body = c.parent();
  if (body && !body.isFixed()) return void n.skipped++;
  if (!(((c.collisionGroups() >>> 16) & 0xffff) & G_WORLD)) return void n.skipped++;
  if (physics.tagOf(c)?.owner) return void n.owned++;
  const s = c.shape, t = c.translation(), q = c.rotation();
  if (s.type === R.ShapeType.TriMesh) {
    n.mesh++;
    out.push(1, s.vertices.length / 3, s.indices.length / 3);
    push(world(s.vertices, t, q));
    push(s.indices);
  } else if (s.type === R.ShapeType.Cuboid) {
    n.box++;
    out.push(2, t.x, t.y, t.z, s.halfExtents.x, s.halfExtents.y, s.halfExtents.z, q.x, q.y, q.z, q.w);
  } else if (s.type === R.ShapeType.ConvexPolyhedron && s.vertices) {
    n.hull++;
    out.push(3, s.vertices.length / 3);
    push(world(s.vertices, t, q));
  } else if (s.type === R.ShapeType.Cylinder) {
    n.cylinder++;
    out.push(4, t.x, t.y, t.z, q.x, q.y, q.z, q.w, s.halfHeight, s.radius);
  } else n.skipped++;
});
const buf = new Uint8Array(new Float32Array(out).buffer);
let b64 = '';
for (let i = 0; i < buf.length; i += 0x8000) b64 += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
return JSON.stringify({ n, floats: out.length, data: btoa(b64) });
