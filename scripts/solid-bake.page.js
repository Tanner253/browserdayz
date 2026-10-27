// Run in the game's page by scripts/solid-bake.mjs (through play.mjs, offline, in development): every fixed solid
// the game has, the canyon's rocks made solid wherever the eye is, written out for the server (server/walls.ts reads
// it). Left out: the ground (the server has its heights), anything on a body (doors, cars, players), glass, and
// whatever has an owner that can change it (a tree felled, a drum blown up, furniture), but for the rocks.
const { physics, G_WORLD, G_FOLIAGE } = await import('/src/core/physics.ts');
const { RockField } = await import('/src/world/rock-field.ts');
const { RockRef } = await import('/src/world/felling.ts');
const { wallsPrint } = await import('/src/sim/walls-print.ts');

for (const f of RockField.made) f.solidAll();
const R = physics.R, T = R.ShapeType;
const SURFACES = ['grass', 'dirt', 'gravel', 'rock', 'wood', 'metal', 'concrete', 'asphalt', 'flesh', 'foliage', 'glass', 'plaster', 'cloth'];
const KIND = { cuboid: 0, ball: 1, capsule: 2, cylinder: 3, trimesh: 4, convex: 5, cone: 6 };

const pieces = [], shapes = [], shapeAt = new Map(), skipped = {};
const skip = (why) => (skipped[why] = (skipped[why] ?? 0) + 1);
const hashOf = (arrs) => {
  let h = 2166136261;
  for (const a of arrs) {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    h = Math.imul(h ^ b.length, 16777619);
    for (let i = 0; i < b.length; i += 3) h = Math.imul(h ^ b[i], 16777619);
  }
  return `${h >>> 0}:${arrs.map((a) => a.length).join(',')}`;
};
const meshOf = (kind, v, ix) => {
  const key = `${kind}|${hashOf(ix ? [v, ix] : [v])}`;
  let n = shapeAt.get(key);
  if (n === undefined) {
    n = shapes.length;
    shapes.push({ kind, v: new Float32Array(v), ix: ix ? new Uint32Array(ix) : null });
    shapeAt.set(key, n);
  }
  return n;
};

physics.world.forEachCollider((c) => {
  if (c.parent()) return skip('on a body');
  if (c.isSensor() || !c.isEnabled()) return skip('sensor or off');
  const member = c.collisionGroups() >>> 16;
  if (!(member & (G_WORLD | G_FOLIAGE))) return skip('not world');
  const tag = physics.tags.get(c.handle);
  if (tag?.owner && !(tag.owner instanceof RockRef)) return skip(`owned ${tag.owner.constructor?.name ?? '?'}`);
  const st = c.shapeType();
  let kind, a = 0, b = 0, d = 0;
  if (st === T.Cuboid) [kind, a, b, d] = [KIND.cuboid, c.halfExtents().x, c.halfExtents().y, c.halfExtents().z];
  else if (st === T.RoundCuboid) {
    const r = c.roundRadius();
    [kind, a, b, d] = [KIND.cuboid, c.halfExtents().x + r, c.halfExtents().y + r, c.halfExtents().z + r];
  } else if (st === T.Ball) [kind, a] = [KIND.ball, c.radius()];
  else if (st === T.Capsule) [kind, a, b] = [KIND.capsule, c.halfHeight(), c.radius()];
  else if (st === T.Cylinder) [kind, a, b] = [KIND.cylinder, c.halfHeight(), c.radius()];
  else if (st === T.Cone) [kind, a, b] = [KIND.cone, c.halfHeight(), c.radius()];
  else if (st === T.TriMesh) [kind, a] = [KIND.trimesh, meshOf(KIND.trimesh, c.vertices(), c.indices())];
  else if (st === T.ConvexPolyhedron) [kind, a] = [KIND.convex, meshOf(KIND.convex, c.vertices(), null)];
  else return skip(`shape ${st}`);
  const flags = (tag?.thin ? 1 : 0) | (!(member & G_WORLD) ? 2 : 0) | (tag?.owner ? 4 : 0);
  const t = c.translation(), q = c.rotation();
  pieces.push({ kind, flags, surf: Math.max(0, SURFACES.indexOf(tag?.surface ?? 'concrete')), t: [t.x, t.y, t.z], q: [q.x, q.y, q.z, q.w], p: [a, b, d] });
});

// the file: 'ZSOL', version, the header's length and the header (JSON), then the shapes, then the pieces
const header = new TextEncoder().encode(JSON.stringify({ v: 1, made: new Date().toISOString(), print: wallsPrint((__game.world ?? __game.s.world).buildings), pieces: pieces.length, shapes: shapes.length, skipped }));
const hlen = (header.length + 3) & ~3;
let size = 12 + hlen + 4 + 4 + pieces.length * 44;
for (const s of shapes) size += 12 + s.v.byteLength + (s.ix ? s.ix.byteLength : 0);
const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
let o = 0;
u8.set([90, 83, 79, 76], 0);
dv.setUint32(4, 1, true);
dv.setUint32(8, header.length, true);
u8.set(header, 12);
o = 12 + hlen;
dv.setUint32(o, shapes.length, true);
o += 4;
let tris = 0;
for (const s of shapes) {
  dv.setUint32(o, s.kind, true);
  dv.setUint32(o + 4, s.v.length / 3, true);
  dv.setUint32(o + 8, s.ix ? s.ix.length : 0, true);
  o += 12;
  for (const x of s.v) (dv.setFloat32(o, x, true), (o += 4));
  if (s.ix) for (const x of s.ix) (dv.setUint32(o, x, true), (o += 4));
}
dv.setUint32(o, pieces.length, true);
o += 4;
for (const p of pieces) {
  dv.setUint8(o, p.kind);
  dv.setUint8(o + 1, p.flags);
  dv.setUint8(o + 2, p.surf);
  o += 4;
  for (const x of [...p.t, ...p.q]) (dv.setFloat32(o, x, true), (o += 4));
  if (p.kind === KIND.trimesh || p.kind === KIND.convex) {
    dv.setUint32(o, p.p[0], true);
    dv.setUint32(o + 4, 0, true);
    dv.setUint32(o + 8, 0, true);
    if (p.kind === KIND.trimesh) tris += shapes[p.p[0]].ix.length / 3;
  } else for (let i = 0; i < 3; i++) dv.setFloat32(o + i * 4, p.p[i], true);
  o += 12;
}
// (in parts: one message to the shell is kept under a few megabytes)
const PART = 3 << 20;
let parts = 0;
for (let at = 0; at < size; at += PART, parts++) {
  const part = u8.subarray(at, Math.min(size, at + PART));
  let s = '';
  for (let i = 0; i < part.length; i += 0x8000) s += String.fromCharCode.apply(null, part.subarray(i, i + 0x8000));
  window.__save(JSON.stringify({ name: `solids-${String(parts).padStart(3, '0')}.part`, b64: btoa(s) }));
}
return { bytes: size, parts, pieces: pieces.length, shapes: shapes.length, tris, skipped, print: wallsPrint((__game.world ?? __game.s.world).buildings) };
