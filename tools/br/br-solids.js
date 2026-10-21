// The battle royale's walls for its server (2026-10-21): every solid the game itself stops a shot with on one map (the
// buildings' own triangles, walls, rocks, the fort, ruins, caves), as the game builds them, laid into one soup of
// triangles in world metres and handed back as base64 (scripts/br-solids.mjs writes arena/br/solids/<map>.bin.gz).
// Doors (they swing), glass, bushes, bodies and the ground itself (the server has the ground) are left out.
//   node assets-src/_wf/me/play.mjs tools/br/br-solids.js <out dir> 640 360 "http://localhost:5173/br?kills=<map>"
const { physics, G_WORLD } = await import('/src/core/physics.ts');
const { assets } = await import('/src/core/assets.ts');
await assets.idle();
await T.wait(4000);
const R = physics.R, verts = [], index = [], hulls = [], cyls = [];
const n = { trimesh: 0, cuboid: 0, hull: 0, cylinder: 0, skipped: 0, owned: 0, kinds: {} };
const put = (local, tris, t, q) => {
  const first = verts.length / 3, v = new T.THREE.Vector3(), qq = new T.THREE.Quaternion(q.x, q.y, q.z, q.w);
  for (let i = 0; i < local.length; i += 3) {
    v.set(local[i], local[i + 1], local[i + 2]).applyQuaternion(qq);
    verts.push(v.x + t.x, v.y + t.y, v.z + t.z);
  }
  for (const i of tris) index.push(first + i);
};
physics.world.forEachCollider((c) => {
  const body = c.parent();
  if (body && !body.isFixed()) return void n.skipped++;
  if (!(((c.collisionGroups() >>> 16) & 0xffff) & G_WORLD)) return void n.skipped++;
  if (physics.tagOf(c)?.owner) return void n.owned++;
  const s = c.shape, t = c.translation(), q = c.rotation();
  if (s.type === R.ShapeType.TriMesh) {
    n.trimesh++;
    put(s.vertices, s.indices, t, q);
  } else if (s.type === R.ShapeType.Cuboid) {
    n.cuboid++;
    const h = s.halfExtents, p = [];
    for (const z of [-1, 1]) for (const y of [-1, 1]) for (const x of [-1, 1]) p.push(x * h.x, y * h.y, z * h.z);
    put(p, [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3], t, q);
  } else if (s.type === R.ShapeType.ConvexPolyhedron && s.vertices) {
    // (a rock is a hull of points: handed over as its points in the world, for the server to make the hull of)
    n.hull++;
    const v = new T.THREE.Vector3(), qq = new T.THREE.Quaternion(q.x, q.y, q.z, q.w), pts = [];
    for (let i = 0; i < s.vertices.length; i += 3) {
      v.set(s.vertices[i], s.vertices[i + 1], s.vertices[i + 2]).applyQuaternion(qq);
      pts.push(v.x + t.x, v.y + t.y, v.z + t.z);
    }
    hulls.push(pts);
  } else if (s.type === R.ShapeType.Cylinder) {
    // (a tree's trunk: its middle, its turn, half its height and its radius)
    n.cylinder++;
    cyls.push(t.x, t.y, t.z, q.x, q.y, q.z, q.w, s.halfHeight, s.radius);
  } else {
    n.skipped++;
    n.kinds[s.type] = (n.kinds[s.type] ?? 0) + 1;
  }
});
// [corners, triangles, hulls, cylinders] then the corners (x y z), the triangles (three corners each), then each hull:
// its number of points and the points, then each cylinder: x y z, its turn (x y z w), half its height, its radius
const hullFloats = hulls.reduce((a, h) => a + 1 + h.length, 0);
const head = new Uint32Array([verts.length / 3, index.length / 3, hulls.length, cyls.length / 9]);
const buf = new Uint8Array(16 + verts.length * 4 + index.length * 4 + hullFloats * 4 + cyls.length * 4);
buf.set(new Uint8Array(head.buffer), 0);
buf.set(new Uint8Array(new Float32Array(verts).buffer), 16);
buf.set(new Uint8Array(new Uint32Array(index).buffer), 16 + verts.length * 4);
const hf = new Float32Array(hullFloats);
let at = 0;
for (const h of hulls) {
  hf[at++] = h.length / 3;
  hf.set(h, at);
  at += h.length;
}
buf.set(new Uint8Array(hf.buffer), 16 + verts.length * 4 + index.length * 4);
buf.set(new Uint8Array(new Float32Array(cyls).buffer), 16 + verts.length * 4 + index.length * 4 + hullFloats * 4);
let b64 = '';
for (let i = 0; i < buf.length; i += 0x8000) b64 += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
return JSON.stringify({ n, verts: verts.length / 3, tris: index.length / 3, data: btoa(b64) });
