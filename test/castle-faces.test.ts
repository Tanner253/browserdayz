// ONE FACE TO A PLACE: nothing of the fort is drawn twice in one plane. `npx tsx test/castle-faces.test.ts`.
//
// (2026-10-13: "there is overlapping textures on the walls of the castles too etc.. please make sure the castle
// does not have overlapping textures".) Two faces within a millimetre of one plane that share area and are both
// drawn toward one side are drawn turn and turn about, and flicker. Counted here over everything of the fort that is
// drawn from near, as the game makes it: the kit's pieces and the door's as they are stood and cut (their triangles
// read from the models themselves), the fort's own shapes, and what the army's post makes by hand. INSIDE one piece
// and BACK TO BACK are counted: a count that skipped both said nothing while the kit's parapets lay back to back on
// its walks, 170 m2 of it. A place is a pair of things with 100 cm2 or more in one plane, in metres of the world.

import assert from 'node:assert/strict';
import path from 'node:path';
import { NodeIO, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { KitCaps, backedOut, kitMatrix, kitPoint, standTriangles, type KitPiece } from '../src/sim/kit';
import { CASTLE_SCALE, castleDoor, castleKit } from '../src/sim/castle';
import { postMade } from '../src/sim/castle-post';
import { SHEETS, castleShape } from '../src/world/castle-shape';
import { postShape } from '../src/world/castle-post-shape';

const S = CASTLE_SCALE, EXACT = 0.001, PLACE = 0.01;
interface Thing { name: string; post: boolean; two: boolean }
const things: Thing[] = [], P: number[] = [], of: number[] = [];
const tri = (t: number, p: ArrayLike<number>, from = 0) => {
  for (let k = 0; k < 9; k++) P.push(p[from + k] * S);
  of.push(t);
};

// ---- the kit's pieces and the door's, stood as src/world/kit.ts stands them
const mul4 = (a: number[], b: number[]) => {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
let dropped = 0, laid = 0;
async function kit(file: string, layout: KitPiece[]) {
  await MeshoptDecoder.ready;
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(path.join(process.cwd(), 'public/assets/models', file));
  const find = (n: Node, id: string): Node | null => (n.getName() === id ? n : n.listChildren().reduce<Node | null>((got, k) => got ?? find(k, id), null));
  for (const p of layout) {
    const top = doc.getRoot().listScenes().flatMap((s) => s.listChildren()).reduce<Node | null>((got, k) => got ?? find(k, p.id), null);
    assert.ok(top, `the model ${file} has no piece ${p.id}`);
    const m = kitMatrix(p);
    // (from the piece's own origin: its own place in the model is not applied, its children's are)
    const walk = (n: Node, own: number[]) => {
      for (const prim of n.getMesh()?.listPrimitives() ?? []) {
        const at = prim.getAttribute('POSITION')!, index = prim.getIndices(), mat = prim.getMaterial(), v = [0, 0, 0], pts: number[][] = [];
        for (let i = 0; i < at.getCount(); i++) {
          at.getElement(i, v);
          pts.push([own[0] * v[0] + own[4] * v[1] + own[8] * v[2] + own[12], own[1] * v[0] + own[5] * v[1] + own[9] * v[2] + own[13], own[2] * v[0] + own[6] * v[1] + own[10] * v[2] + own[14]]);
        }
        const idx = index ? Array.from(index.getArray()!) : pts.map((_, i) => i), flat = new Float64Array(idx.length * 3);
        idx.forEach((i, k) => flat.set(pts[i], k * 3));
        const two = !!mat?.getDoubleSided(), backs = two ? backedOut(flat) : null, t = things.push({ name: `${p.name ?? p.id} [${mat?.getName() ?? ''}]`, post: false, two }) - 1;
        dropped += backs?.size ?? 0;
        let q: number[] = [];
        // (a corner as the kit has it: where it is, and room for the way it faces and where it is on the picture, which nothing here asks)
        const stood = pts.map((c) => [...kitPoint(m, [c[0], c[1], c[2]]), 0, 0, 0, 0, 0]);
        if (caps.wanted) caps.take(stood, idx, 'stone');
        standTriangles(stood, idx, p.cut ?? [], backs, (c) => {
          q.push(c[0], c[1], c[2]);
          if (q.length === 9) {
            tri(t, q);
            q = [];
          }
        });
      }
      for (const k of n.listChildren()) walk(k, mul4(own, k.getMatrix()));
    };
    // (and what is laid across its cuts where they open it: drawn in the kit's own stuff, so from both sides)
    const caps = new KitCaps(p.cut ?? []);
    walk(top, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    if (!caps.wanted) continue;
    const t = things.push({ name: `what closes the cuts of the ${p.name ?? p.id}`, post: false, two: true }) - 1;
    let q: number[] = [];
    caps.put((_, c) => {
      q.push(c[0], c[1], c[2]);
      if (q.length === 9) {
        tri(t, q);
        laid++;
        q = [];
      }
    });
  }
}
await kit('fort_kit.glb', castleKit());
await kit('large_castle_door.glb', castleDoor());
const kitTriangles = of.length;

// ---- the fort's own shapes (water is seen through, and is nobody's face), and what the post makes by hand
const shape = castleShape();
for (const [set, low] of [[shape.near, false], [shape.under, true]] as const) for (const s of SHEETS) {
  if (s === 'water') continue;
  const t = things.push({ name: `the fort's own ${s}${low ? ' (lower levels)' : ''}`, post: false, two: false }) - 1;
  for (let k = 0; k < set[s].pos.length; k += 9) tri(t, set[s].pos, k);
}
const ownTriangles = of.length - kitTriangles, skins = postShape(postMade());
for (const s of ['hard', 'cloth', 'net', 'glow'] as const) {
  const t = things.push({ name: `the post's ${s}`, post: true, two: s === 'cloth' || s === 'net' }) - 1;
  for (let k = 0; k < skins[s].pos.length; k += 9) tri(t, skins[s].pos, k);
}

// ---- every two triangles in one plane that share area
const n = of.length, ng = new Float64Array(n * 3), lo = new Float64Array(n * 3), hi = new Float64Array(n * 3), cells = new Map<number, number[]>();
const key = (x: number, y: number, z: number) => ((x + 1024) * 2048 + y + 1024) * 2048 + z + 1024;
for (let i = 0; i < n; i++) {
  const o = i * 9, ux = P[o + 3] - P[o], uy = P[o + 4] - P[o + 1], uz = P[o + 5] - P[o + 2], vx = P[o + 6] - P[o], vy = P[o + 7] - P[o + 1], vz = P[o + 8] - P[o + 2];
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z);
  if (l < 2e-6) continue;
  ng.set([x / l, y / l, z / l], i * 3);
  for (let k = 0; k < 3; k++) {
    lo[i * 3 + k] = Math.min(P[o + k], P[o + 3 + k], P[o + 6 + k]) - EXACT;
    hi[i * 3 + k] = Math.max(P[o + k], P[o + 3 + k], P[o + 6 + k]) + EXACT;
  }
  for (let cx = Math.floor(lo[i * 3]); cx <= Math.floor(hi[i * 3]); cx++) for (let cy = Math.floor(lo[i * 3 + 1]); cy <= Math.floor(hi[i * 3 + 1]); cy++) for (let cz = Math.floor(lo[i * 3 + 2]); cz <= Math.floor(hi[i * 3 + 2]); cz++) {
    const k = key(cx, cy, cz), at = cells.get(k);
    if (at) at.push(i);
    else cells.set(k, [i]);
  }
}
const clip = (poly: number[][], a: number[], b: number[]) => {
  const out: number[][] = [], side = (p: number[]) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) out.push([p[0] + ((q[0] - p[0]) * sp) / (sp - sq), p[1] + ((q[1] - p[1]) * sp) / (sp - sq)]);
  }
  return out;
};
const areaOf = (poly: number[][]) => poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0) / 2;
const found = new Map<string, { a: number; b: number; area: number; at: number[]; back: boolean }>();
for (const [ck, list] of cells) {
  const cz = (ck % 2048) - 1024, cy = (Math.floor(ck / 2048) % 2048) - 1024, cx = Math.floor(ck / 4194304) - 1024;
  for (let p = 0; p < list.length; p++) {
    const i = list[p], nx = ng[i * 3], ny = ng[i * 3 + 1], nz = ng[i * 3 + 2], o = i * 9;
    for (let q = p + 1; q < list.length; q++) {
      const j = list[q], dot = nx * ng[j * 3] + ny * ng[j * 3 + 1] + nz * ng[j * 3 + 2];
      if (dot < 0.9994 && dot > -0.9994) continue;
      // (back to back they are seen together only where one of them is drawn from both sides)
      if (dot < 0 && !things[of[i]].two && !things[of[j]].two) continue;
      const mx = Math.max(lo[i * 3], lo[j * 3]), my = Math.max(lo[i * 3 + 1], lo[j * 3 + 1]), mz = Math.max(lo[i * 3 + 2], lo[j * 3 + 2]);
      if (mx > Math.min(hi[i * 3], hi[j * 3]) || my > Math.min(hi[i * 3 + 1], hi[j * 3 + 1]) || mz > Math.min(hi[i * 3 + 2], hi[j * 3 + 2])) continue;
      // (a pair is asked once: in the square its common corner is in)
      if (Math.floor(mx) !== cx || Math.floor(my) !== cy || Math.floor(mz) !== cz) continue;
      const oj = j * 9, d = nx * P[o] + ny * P[o + 1] + nz * P[o + 2];
      if (Math.min(Math.abs(nx * P[oj] + ny * P[oj + 1] + nz * P[oj + 2] - d), Math.abs(nx * P[oj + 3] + ny * P[oj + 4] + nz * P[oj + 5] - d), Math.abs(nx * P[oj + 6] + ny * P[oj + 7] + nz * P[oj + 8] - d)) > EXACT) continue;
      // both laid flat in the first one's plane: what the two have in common
      let ux = P[o + 3] - P[o], uy = P[o + 4] - P[o + 1], uz = P[o + 5] - P[o + 2];
      const ul = Math.hypot(ux, uy, uz);
      ux /= ul; uy /= ul; uz /= ul;
      const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
      const flat = (b: number) => [(P[b] - P[o]) * ux + (P[b + 1] - P[o + 1]) * uy + (P[b + 2] - P[o + 2]) * uz, (P[b] - P[o]) * vx + (P[b + 1] - P[o + 1]) * vy + (P[b + 2] - P[o + 2]) * vz];
      const mine = [flat(o), flat(o + 3), flat(o + 6)];
      let poly = [flat(oj), flat(oj + 3), flat(oj + 6)];
      if (areaOf(poly) < 0) poly.reverse();
      for (let e = 0; e < 3 && poly.length; e++) poly = clip(poly, mine[e], mine[(e + 1) % 3]);
      const ar = poly.length > 2 ? Math.abs(areaOf(poly)) : 0;
      if (ar < 1e-4) continue;
      const c = poly.reduce((s, v) => [s[0] + v[0] / poly.length, s[1] + v[1] / poly.length], [0, 0]), at = [P[o] + ux * c[0] + vx * c[1], P[o + 1] + uy * c[0] + vy * c[1], P[o + 2] + uz * c[0] + vz * c[1]];
      if (Math.abs(ng[j * 3] * (at[0] - P[oj]) + ng[j * 3 + 1] * (at[1] - P[oj + 1]) + ng[j * 3 + 2] * (at[2] - P[oj + 2])) > EXACT) continue;
      const [a, b] = of[i] <= of[j] ? [of[i], of[j]] : [of[j], of[i]];
      const id = `${a}:${b}:${[nx, ny, nz].map((v) => Math.round(Math.abs(v) * 12)).join(',')}:${Math.round((d * (nx + ny + nz >= 0 ? 1 : -1)) / 0.3)}`;
      const f = found.get(id);
      if (f) f.area += ar;
      else found.set(id, { a, b, area: ar, at, back: dot < 0 });
    }
  }
}
const places = [...found.values()].filter((f) => f.area >= PLACE).sort((p, q) => q.area - p.area);
const say = (f: (typeof places)[number]) => `${(f.area * 1e4).toFixed(0)} cm2 ${f.back ? 'back to back' : 'the same way'} at x ${(f.at[0] / S).toFixed(2)} y ${(f.at[1] / S).toFixed(2)} z ${(f.at[2] / S).toFixed(2)}: ${things[f.a].name}${f.a === f.b ? ' on itself' : ' on ' + things[f.b].name}`;
const fort = places.filter((f) => !things[f.a].post && !things[f.b].post), post = places.filter((f) => things[f.a].post || things[f.b].post);
console.log(`  ${kitTriangles} triangles of the kit and the door (${dropped} of the kit's lay back to back on another and are cut back), ${ownTriangles} of the fort's own, ${n - kitTriangles - ownTriangles} of the post`);

assert.ok(dropped > 300, `the kit's parapets and tower rings lie back to back on what they stand on, and are to be cut back: ${dropped} were`);
console.log('  ok  the faces of the kit that lay back to back on the walks, the platforms and the footings are cut back');
// (what a cut opens is closed: the four broken merlons' troughs, the broken ends of the parapets and of the towers' rings)
assert.ok(laid > 300, `stone is to be laid across the cuts that open the kit's pieces: ${laid} triangles were`);
console.log(`  ok  stone is laid across the cuts that open the kit's pieces (${laid} triangles), and none of it in the plane of anything`);
assert.equal(fort.length, 0, `${fort.length} places where two faces of the fort are in one plane:\n${fort.slice(0, 12).map(say).join('\n')}`);
console.log("  ok  no two faces of the kit, the door or the fort's own are in one plane anywhere (inside a piece and back to back counted)");
// (what the post makes by hand: two that nobody sees: the undersides of the duckboards and of a fallen merlon, both
// on the terrace, and the edges of two groundsheets that meet. They are not to grow.)
assert.ok(post.length <= 2, `${post.length} places where a face of the post is in one plane with another (two are known, and are not seen):\n${post.map(say).join('\n')}`);
console.log(`  ok  of the post, no more than the two that are known and not seen (${post.length}${post.length ? ': ' + post.map(say).join('; ') : ''})`);
console.log('4 passed');
