// Things that are not from Poly Haven and are neither vehicles nor weapon packs: a vest, a
// crate, a syringe lifted out of a pack of arms. Each comes out the way a Poly Haven model
// does: standing on y = 0 about its own middle, in metres, in one file.
//
// Settings (scripts/assets.config.mjs, LOCAL_MODELS):
//   dir    – the folder under assets-src/models/ its download was unpacked into (its id, if not given)
//   only   – of everything the download draws, the pieces whose names match are kept
//   size   – how long its longest side comes out, metres (or `scale`: what brings it to metres)
//   rot    – turns that stand it upright, radians about x, then y, then z
//   tex    – its textures are brought down to this many pixels a side
//   metal, rough – for a material that says nothing about either (glTF then calls it bare metal)
//   budget – about how many triangles it is brought down to (a download drawn for a close-up may have a hundred thousand)
//   small  – textures whose names match are flat colour: kept tiny
//   pair   – it is a left and a right, worn a body's width apart (gloves, boots): they are brought together to lie side by side
//   cut    – only a part of it is wanted, and the download does not have that part as a piece of its own (a helmet on a
//            statue cast in one): `{ tall, keep(x, y, z) }`. The whole download is stood `tall` metres high about its own
//            middle, feet on the ground, and what `keep` says yes to, of every corner of a triangle, is kept. Or
//            `{ tall, drop(a, b, c) }`: a triangle is taken out when `drop` says yes to its three corners ([x, y, z] each)
//   plain  – its glint map is left out (a thing seen small, whose map is mostly of what was cut away): `metal`, `rough` say what it is instead
//   both   – it is a shell, seen from inside as well as out
//   dye    – its colour picture is turned to another colour: `{ hue, saturation, brightness }`, as sharp's `modulate`
//            takes them (degrees round the wheel, and a multiple of each of the others). One download, two things:
//            a bag of blood, and the same bag with salt water in it
//   bare   – of its pictures only its colour and its relief are kept: the game paints it with those two and nothing else
//            (a building hung whole: see `whole:` in src/world/buildings.ts), so the others are so many megabytes nobody sees
//   solid  – a material of it that came to be drawn see-through (BLEND) and is not glass to be seen through. `true`: it is
//            drawn solid, and the alpha of its colour picture is thrown away (a mask whose eyepieces are nine parts in ten
//            solid as they came). A number: it is cut out where that alpha is under it and solid everywhere else (a sight
//            whose one material is also the clear lid over its fibre: the lid goes, the lens stays)
//   flat   – materials whose names match have their relief map left out (a download that gave its colour picture as its relief)
//   pivot  – a piece of the download (a node, by name) whose own origin is put at x = 0, z = 0 in place of the model's middle:
//            a door, which is then turned about its hinge by turning the model about y
//   hung   – pieces of it that the game turns on their hinges while the rest of it stands still (a locker's doors):
//            `{ door_l: /^DoorL/, ... }`, each a name and the pieces of the download (nodes, by name) that are that
//            piece. Each comes out as a piece of the file called `<id>_<name>`, whose own origin is where the
//            download's piece had its own (the line of its hinges, at its foot), with its shapes under it; what is
//            not hung is stood as ever. One file, so that the doors are painted with the case's own pictures
//   isles  – what is done to parts of it that are not pieces of their own but islands of the one mesh (triangles that
//            share no point with the rest of it): `{ tall, drop, swing, glass }`. With `tall`, the whole download
//            is stood that many metres high about its own middle, feet on the ground, as for a cut, and everything is
//            said in those metres; without it, in the file's own measures. An island is told to each rule as its box
//            ([x, y, z] its least and its most, as it came) and how many triangles it has.
//            `drop(lo, hi, tris)`: the islands it says yes to are left out (the hose and the filter can of a gas mask
//            that is wanted alone).
//            `swing`: parts that the download drew one way and are wanted another (a visor drawn raised that is
//            wanted down, a strap left hanging out that is wanted tucked in), each `{ pick(lo, hi, tris), at, axis,
//            angle, move, ease }`: the islands `pick` says yes to are turned `angle` radians about the line through
//            `at` along `axis` (the way a screw goes in along it), and then moved by `move`: by all of it where
//            `ease(x, y, z)` of a point as it stands once turned says 1, by none of it where it says 0, and in
//            between by so much (a visor brought up to the eyes whose lugs stay on their bolts: its sides are sloped
//            a little, and nothing is torn).
//            `glass(lo, hi, tris)`: the islands that are to be seen through, of a thing whose one material came
//            see-through (BLEND) for the sake of two panes: those keep the material, and every other triangle is
//            given a copy of it that is drawn solid. (Left as it came, the whole of a helmet was drawn as glass is:
//            after everything else, none of it hiding any other part of it, and its picture in a pocket was a ghost.)
// A piece on a skeleton is taken as the skeleton holds it when nothing is moving.

import fs from 'node:fs/promises';
import path from 'node:path';
import { prune, weld, simplify, textureCompress, meshopt, getBounds, transformMesh, metalRough } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { standSkin, mul, move, scaleBy } from './weapon-packs.mjs';

const about = {
  x: (a) => [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1],
  y: (a) => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1],
  z: (a) => [Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
};

/** The credit a Sketchfab download asks for, word for word out of the licence that came in it. */
export async function creditOf(dir) {
  const text = (await fs.readFile(path.join(dir, 'license.txt'), 'utf8')).replace(/\r/g, '');
  const field = (name) => text.match(new RegExp(`\\* ${name}:\\s*(.+)`))?.[1].trim();
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.startsWith('This work is based on'));
  return { name: field('title'), url: field('source'), author: field('author')?.replace(/\s*\(http.*\)$/, ''), licence: field('license type'), line };
}

/**
 * Keeps of a shape only the triangles all three of whose corners `keep` says yes to, and of
 * its points only those still used (what a file says its size is, is read off its points).
 * @returns how many triangles are left
 */
function keepOf(doc, prim, keep, drop) {
  const pos = prim.getAttribute('POSITION'), n = pos.getCount();
  const idx = prim.getIndices();
  const index = idx ? idx.getArray() : Uint32Array.from({ length: n }, (_, i) => i);
  const ok = new Uint8Array(n), v = [];
  for (let i = 0; i < n; i++) {
    pos.getElement(i, v);
    ok[i] = keep(v[0], v[1], v[2]) ? 1 : 0;
  }
  const map = new Int32Array(n).fill(-1), out = [];
  let m = 0;
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    if (!(ok[a] && ok[b] && ok[c])) continue;
    if (drop && drop(pos.getElement(a, []), pos.getElement(b, []), pos.getElement(c, []))) continue;
    for (const i of [a, b, c]) {
      if (map[i] < 0) map[i] = m++;
      out.push(map[i]);
    }
  }
  for (const sem of prim.listSemantics()) {
    const acc = prim.getAttribute(sem), size = acc.getElementSize(), src = acc.getArray();
    const dst = new src.constructor(m * size);
    for (let i = 0; i < n; i++) if (map[i] >= 0) for (let e = 0; e < size; e++) dst[map[i] * size + e] = src[i * size + e];
    prim.setAttribute(sem, acc.clone().setArray(dst));
  }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(m > 65535 ? new Uint32Array(out) : new Uint16Array(out)));
  return out.length / 3;
}

/**
 * The islands of a shape: its triangles gathered by which of them share a point (points that are in one place are
 * one point here, whatever else is said of them: a seam in a picture is not a tear).
 * @param to puts a point of the file into the measures the rules are said in
 * @returns `P`, every point in those measures; `index`; `list`, the islands ({ lo, hi, tris }); `of(i)`, the island a point is of
 */
function islesOf(prim, to) {
  const pos = prim.getAttribute('POSITION'), n = pos.getCount();
  const idx = prim.getIndices();
  const index = idx ? idx.getArray() : Uint32Array.from({ length: n }, (_, i) => i);
  const P = new Float64Array(n * 3), v = [];
  for (let i = 0; i < n; i++) P.set(to(pos.getElement(i, v)), i * 3);
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < n * 3; i += 3) {
    lo = Math.min(lo, P[i]);
    hi = Math.max(hi, P[i]);
  }
  // (as near as a ten-thousandth of how tall it is, is the same place)
  const TOL = Math.max(1e-9, (hi - lo) * 1e-4);
  const place = new Map(), weld = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(P[i * 3] / TOL)},${Math.round(P[i * 3 + 1] / TOL)},${Math.round(P[i * 3 + 2] / TOL)}`;
    if (!place.has(key)) place.set(key, place.size);
    weld[i] = place.get(key);
  }
  const parent = Int32Array.from({ length: place.size }, (_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = find(weld[index[t]]);
    parent[find(weld[index[t + 1]])] = a;
    parent[find(weld[index[t + 2]])] = a;
  }
  const islands = new Map();
  for (let t = 0; t + 2 < index.length; t += 3) {
    const root = find(weld[index[t]]);
    const isle = islands.get(root) ?? islands.set(root, { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], tris: 0 }).get(root);
    isle.tris++;
    for (let k = 0; k < 3; k++) {
      for (let e = 0; e < 3; e++) {
        const q = P[index[t + k] * 3 + e];
        isle.lo[e] = Math.min(isle.lo[e], q);
        isle.hi[e] = Math.max(isle.hi[e], q);
      }
    }
  }
  return { P, index, list: [...islands.values()], of: (i) => islands.get(find(weld[i])) };
}

/**
 * Keeps of a shape only the triangles `keep` says yes to (told which triangle it is, counting from 0), and of its
 * points only those still used.
 */
function keepTris(doc, prim, keep) {
  const n = prim.getAttribute('POSITION').getCount();
  const idx = prim.getIndices();
  const index = idx ? idx.getArray() : Uint32Array.from({ length: n }, (_, i) => i);
  const map = new Int32Array(n).fill(-1), out = [];
  let m = 0;
  for (let t = 0; t + 2 < index.length; t += 3) {
    if (!keep(t / 3)) continue;
    for (const i of [index[t], index[t + 1], index[t + 2]]) {
      if (map[i] < 0) map[i] = m++;
      out.push(map[i]);
    }
  }
  for (const sem of prim.listSemantics()) {
    const acc = prim.getAttribute(sem), size = acc.getElementSize(), src = acc.getArray();
    const dst = new src.constructor(m * size);
    for (let i = 0; i < n; i++) if (map[i] >= 0) for (let e = 0; e < size; e++) dst[map[i] * size + e] = src[i * size + e];
    prim.setAttribute(sem, acc.clone().setArray(dst));
  }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(m > 65535 ? new Uint32Array(out) : new Uint16Array(out)));
}

/**
 * Turns and moves the islands of a shape that `parts` pick (see `isles` in the settings at the top of this file).
 * @param land the shape's islands (see `islesOf`): each one picked is marked with the part that picked it
 * @param back puts a point said in the rules' measures back into the file's
 * @returns how many islands were moved
 */
function swingOf(prim, land, parts, back) {
  const { P } = land;
  let moved = 0;
  for (const part of parts) {
    let mine = 0;
    for (const isle of land.list) {
      if (isle.part || !part.pick(isle.lo, isle.hi, isle.tris)) continue;
      isle.part = part;
      mine++;
    }
    if (!mine) throw new Error(`a part to be swung picks no island: ${part.pick}`);
    moved += mine;
  }
  const pos = prim.getAttribute('POSITION'), n = pos.getCount();
  const nor = prim.getAttribute('NORMAL'), tan = prim.getAttribute('TANGENT');
  const outP = Float32Array.from(pos.getArray()), outN = nor && Float32Array.from(nor.getArray()), outT = tan && Float32Array.from(tan.getArray());
  const size = tan?.getElementSize() ?? 4;
  for (let i = 0; i < n; i++) {
    const part = land.of(i)?.part;
    if (!part) continue;
    // (a turn about a line: what is along the line stays, what is across it goes round)
    const l = Math.hypot(...(part.axis ?? [1, 0, 0])), u = (part.axis ?? [1, 0, 0]).map((c) => c / l), c = Math.cos(part.angle ?? 0), s = Math.sin(part.angle ?? 0);
    const turn = (q) => {
      const d = u[0] * q[0] + u[1] * q[1] + u[2] * q[2];
      return [q[0] * c + (u[1] * q[2] - u[2] * q[1]) * s + u[0] * d * (1 - c), q[1] * c + (u[2] * q[0] - u[0] * q[2]) * s + u[1] * d * (1 - c), q[2] * c + (u[0] * q[1] - u[1] * q[0]) * s + u[2] * d * (1 - c)];
    };
    const at = part.at ?? [0, 0, 0];
    const p = turn([P[i * 3] - at[0], P[i * 3 + 1] - at[1], P[i * 3 + 2] - at[2]]).map((q, e) => q + at[e]);
    const w = part.move ? (part.ease ? Math.max(0, Math.min(1, part.ease(p[0], p[1], p[2]))) : 1) : 0;
    const now = back(p.map((q, e) => q + w * (part.move?.[e] ?? 0)));
    for (let e = 0; e < 3; e++) outP[i * 3 + e] = now[e];
    for (const [out, wide] of [[outN, 3], [outT, size]]) {
      if (!out) continue;
      const t = turn([out[i * wide], out[i * wide + 1], out[i * wide + 2]]);
      for (let e = 0; e < 3; e++) out[i * wide + e] = t[e];
    }
  }
  prim.setAttribute('POSITION', pos.clone().setArray(outP));
  if (outN) prim.setAttribute('NORMAL', nor.clone().setArray(outN));
  if (outT) prim.setAttribute('TANGENT', tan.clone().setArray(outT));
  return moved;
}

/**
 * Does to the islands of every shape in a file what `isles` says (see the settings at the top of this file). The
 * shapes are taken as they are in the file: where its pieces are moved or turned by their nodes, whoever calls
 * this puts those moves into the shapes first (as `processProp` does).
 * @returns how many islands were left out, swung, and kept as glass
 */
export function islesIn(doc, isles) {
  let to = (v) => v, back = (v) => v;
  if (isles.tall) {
    const b0 = getBounds(doc.getRoot().listScenes()[0]);
    const k = isles.tall / (b0.max[1] - b0.min[1]), cx = (b0.min[0] + b0.max[0]) / 2, cz = (b0.min[2] + b0.max[2]) / 2;
    to = (v) => [(v[0] - cx) * k, (v[1] - b0.min[1]) * k, (v[2] - cz) * k];
    back = (v) => [v[0] / k + cx, v[1] / k + b0.min[1], v[2] / k + cz];
  }
  const done = { dropped: 0, swung: 0, glass: 0 };
  const solid = new Map();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      let land = islesOf(prim, to);
      if (isles.drop) {
        const gone = new Set(land.list.filter((isle) => isles.drop(isle.lo, isle.hi, isle.tris)));
        if (gone.size === land.list.length) throw new Error('every island of a shape would be left out');
        if (gone.size) {
          const { index, of } = land;
          keepTris(doc, prim, (t) => !gone.has(of(index[t * 3])));
          land = islesOf(prim, to);
          done.dropped += gone.size;
        }
      }
      // (which islands are glass is said of them as they came: asked before anything is moved)
      const panes = new Set(isles.glass ? land.list.filter((isle) => isles.glass(isle.lo, isle.hi, isle.tris)) : []);
      if (isles.swing) done.swung += swingOf(prim, land, isles.swing, back);
      if (panes.size && panes.size < land.list.length) {
        const { index, of } = land;
        const paint = prim.getMaterial();
        if (!solid.has(paint)) solid.set(paint, paint.clone().setName(`${paint.getName()}_solid`).setAlphaMode('OPAQUE'));
        const pane = prim.clone();
        mesh.addPrimitive(pane);
        keepTris(doc, pane, (t) => panes.has(of(index[t * 3])));
        keepTris(doc, prim, (t) => !panes.has(of(index[t * 3])));
        prim.setMaterial(solid.get(paint));
        done.glass += panes.size;
      }
    }
  }
  return done;
}

/** @returns its manifest entry and its credit */
export async function processProp(id, cfg, { io, SRC, OUT, FORCE, exists, countTris }) {
  const dir = path.join(SRC, 'models', cfg.dir ?? id);
  const gltfPath = path.join(dir, cfg.file ?? 'scene.gltf');
  if (!(await exists(gltfPath))) throw new Error(`${id}: put its glTF download in assets-src/models/${cfg.dir ?? id}/ (${cfg.file ?? 'scene.gltf'} is not there)`);
  // (a licence that asks for no credit line, Sketchfab's own: the model's settings give the one it is credited with)
  // (a credit written out in full needs no licence beside the download: a model made for us, as the Higgsfield ones)
  const credit = { id, ...(cfg.credit?.line ? {} : await creditOf(dir)), changes: cfg.changes, ...(cfg.credit ?? {}) };
  if (!credit.line) throw new Error(`${id}: its licence asks for no credit line this script knows how to read (${credit.licence}): look at ${path.join(dir, 'license.txt')}`);
  const dest = path.join(OUT, 'models', `${id}.glb`);
  const stamp = JSON.stringify({ ...cfg, only: cfg.only?.source, small: cfg.small?.source, flat: cfg.flat?.source, pivot: cfg.pivot?.source, hung: cfg.hung && Object.entries(cfg.hung).map(([name, re]) => `${name}: ${re.source}`).join(), cut: cfg.cut ? `${cfg.cut.tall}: ${cfg.cut.keep} ${cfg.cut.drop}` : undefined, isles: cfg.isles ? JSON.stringify(cfg.isles, (_k, v) => (typeof v === 'function' ? String(v) : v)) : undefined, v: 6 });
  const metaPath = path.join(dir, `_meta_${id}.json`);
  let meta;
  if (!FORCE && (await exists(dest)) && (await exists(metaPath))) {
    meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    if (meta.stamp !== stamp) meta = undefined;
  }
  if (!meta) {
    const doc = await io.read(gltfPath);
    // (A download whose materials are written the old way, as diffuse and gloss, is put into the way the game
    // reads them: left as it came, it is drawn with no texture at all, the colour of plaster.)
    if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_materials_pbrSpecularGlossiness')) await doc.transform(metalRough());
    await doc.transform(weld());
    const root = doc.getRoot(), scene = root.listScenes()[0];
    const srcTris = countTris(doc);
    const label = (n) => `${n.getName()} ${n.getMesh().getName()} ${n.getMesh().listPrimitives().map((p) => p.getMaterial()?.getName() ?? '').join(' ')}`;
    const drawn = root.listNodes().filter((n) => n.getMesh() && (!cfg.only || cfg.only.test(label(n))));
    if (!drawn.length) throw new Error(`${id}: nothing it draws matches ${cfg.only}`);
    // (where the piece it is to turn about stands, read before anything is moved)
    const hinge = cfg.pivot && root.listNodes().find((n) => cfg.pivot.test(n.getName()));
    if (cfg.pivot && !hinge) throw new Error(`${id}: no piece of it is named ${cfg.pivot}`);
    let pivot = hinge?.getWorldTranslation();
    // (and of what is hung: which of the pieces drawn each is, and where the origin of the first of them stands)
    const hung = Object.entries(cfg.hung ?? {}).map(([name, re]) => {
      const mine = drawn.map((n, i) => (re.test(n.getName()) ? i : -1)).filter((i) => i >= 0);
      if (!mine.length) throw new Error(`${id}: no piece of it is named ${re}`);
      return { name, mine, at: drawn[mine[0]].getWorldTranslation() };
    });
    const meshes = [];
    for (const n of drawn) {
      const mesh = n.getMesh();
      if (mesh.listParents().filter((p) => p.propertyType === 'Node').length > 1) throw new Error(`${id}: ${n.getName()} shares its shape with another piece`);
      if (n.getSkin()) {
        for (const s of standSkin(n)) {
          s.prim.getAttribute('POSITION').setArray(s.P);
          if (s.N) s.prim.getAttribute('NORMAL').setArray(s.N);
          if (s.T) s.prim.getAttribute('TANGENT').setArray(s.T);
          for (const sem of ['JOINTS_0', 'WEIGHTS_0', 'JOINTS_1', 'WEIGHTS_1']) s.prim.setAttribute(sem, null);
        }
      } else transformMesh(mesh, n.getWorldMatrix());
      meshes.push(mesh);
    }
    for (const child of scene.listChildren()) scene.removeChild(child);
    for (const n of root.listNodes()) n.setMesh(null).setSkin(null);
    // (a movement thrown away whole leaves its keys behind in the file unless they are thrown away first)
    for (const a of root.listAnimations()) {
      for (const c of a.listChannels()) c.dispose();
      for (const sm of a.listSamplers()) sm.dispose();
      a.dispose();
    }
    for (const s of root.listSkins()) s.dispose();
    const stood = meshes.map((mesh, i) => doc.createNode(meshes.length > 1 ? `${id}_${i}` : id).setMesh(mesh.setName(id)));
    for (const node of stood) scene.addChild(node);
    if (cfg.cut) {
      // the whole of it stood so many metres tall about its own middle: the rule is said in those metres
      const b0 = getBounds(scene);
      const k = cfg.cut.tall / (b0.max[1] - b0.min[1]), cx = (b0.min[0] + b0.max[0]) / 2, cz = (b0.min[2] + b0.max[2]) / 2;
      let left = 0;
      for (const mesh of meshes) {
        for (const prim of mesh.listPrimitives()) {
          const at = (v) => [(v[0] - cx) * k, (v[1] - b0.min[1]) * k, (v[2] - cz) * k];
          const n = keepOf(doc, prim, (x, y, z) => !cfg.cut.keep || cfg.cut.keep(...at([x, y, z])), cfg.cut.drop && ((a, b, c) => cfg.cut.drop(at(a), at(b), at(c))));
          if (!n) mesh.removePrimitive(prim);
          left += n;
        }
      }
      for (const node of scene.listChildren()) if (!node.getMesh().listPrimitives().length) scene.removeChild(node.setMesh(null));
      if (!left) throw new Error(`${id}: the cut keeps nothing`);
    }
    if (cfg.isles) {
      const done = islesIn(doc, cfg.isles);
      console.log(`      ${id}: of its islands ${done.dropped} left out, ${done.swung} swung, ${done.glass} kept as glass`);
    }
    if (cfg.pair) {
      // each half by which side of the middle it is on; moved in until a finger's width is left between them
      let left = Infinity, right = -Infinity;
      const each = (fn) => {
        for (const mesh of meshes) for (const prim of mesh.listPrimitives()) {
          const pos = prim.getAttribute('POSITION'), v = [];
          for (let i = 0; i < pos.getCount(); i++) fn(pos, i, pos.getElement(i, v));
        }
      };
      // (the middle of the two, wherever the download happens to stand)
      let lo = Infinity, hi = -Infinity;
      each((_p, _i, v) => {
        lo = Math.min(lo, v[0]);
        hi = Math.max(hi, v[0]);
      });
      const mid = (lo + hi) / 2;
      each((_p, _i, v) => {
        if (v[0] > mid) left = Math.min(left, v[0]);
        else right = Math.max(right, v[0]);
      });
      const gap = (hi - lo) * 0.03;
      each((pos, i, v) => pos.setElement(i, [v[0] > mid ? v[0] - left + gap / 2 : v[0] - right - gap / 2, v[1], v[2]]));
    }
    // upright, then to size, then stood on the ground about its own middle
    const [rx, ry, rz] = cfg.rot ?? [0, 0, 0];
    const R = mul(about.z(rz), mul(about.y(ry), about.x(rx)));
    for (const mesh of meshes) transformMesh(mesh, R);
    if (pivot) pivot = [0, 1, 2].map((r) => R[r] * pivot[0] + R[4 + r] * pivot[1] + R[8 + r] * pivot[2]);
    const b = getBounds(scene);
    const s = cfg.scale ?? cfg.size / Math.max(...b.max.map((v, k) => v - b.min[k]));
    const M = mul(scaleBy(s), move(-(pivot?.[0] ?? (b.min[0] + b.max[0]) / 2), -b.min[1], -(pivot?.[2] ?? (b.min[2] + b.max[2]) / 2)));
    for (const mesh of meshes) transformMesh(mesh, M);
    // What is hung is put under a piece of its own, whose origin is where its hinges are now that the whole has been
    // turned, sized and stood: its shapes are said from there. (A piece with a shape is given a measure of its own
    // when the file is packed, and its origin with it: so the hinge is a piece with no shape, and the shapes are
    // pieces under it.)
    for (const h of hung) {
      const p = [0, 1, 2].map((r) => R[r] * h.at[0] + R[4 + r] * h.at[1] + R[8 + r] * h.at[2]);
      const at = [0, 1, 2].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r]);
      const hinge = doc.createNode(`${id}_${h.name}`).setTranslation(at);
      scene.addChild(hinge);
      h.mine.forEach((i, k) => {
        if (!scene.listChildren().includes(stood[i])) return;
        scene.removeChild(stood[i]);
        transformMesh(meshes[i], move(-at[0], -at[1], -at[2]));
        // (its shape is called by the same name: what reads the file tells its pieces apart by either)
        hinge.addChild(stood[i].setName(`${id}_${h.name}_${k}`).setMesh(meshes[i].setName(`${id}_${h.name}`)));
      });
    }
    const inUse =new Set(meshes.flatMap((mesh) => mesh.listPrimitives().map((p) => p.getMaterial())));
    // (What a material that is left out was painted with goes with it. A material's extensions are things of their own
    // in the file: one left behind when its material is cleared away kept its pictures in the file, the glint of a
    // door in the file of the stove it was taken off, where nothing drew them and the card's budget counted them.)
    for (const m of root.listMaterials()) {
      if (inUse.has(m)) continue;
      for (const e of m.listExtensions()) if (e.listParents().every((p) => p.propertyType !== 'Material' || !inUse.has(p))) e.dispose();
    }
    for (const m of root.listMaterials()) {
      if (cfg.flat?.test(m.getName())) m.setNormalTexture(null);
      if (cfg.solid !== undefined && inUse.has(m) && m.getAlphaMode() === 'BLEND') {
        if (cfg.solid === true) {
          m.setAlphaMode('OPAQUE').setBaseColorFactor(m.getBaseColorFactor().map((v, k) => (k < 3 ? v : 1)));
          const t = m.getBaseColorTexture();
          if (t && !t.getExtras().solid) {
            t.setImage(new Uint8Array(await sharp(Buffer.from(t.getImage())).removeAlpha().png().toBuffer())).setMimeType('image/png');
            t.setExtras({ ...t.getExtras(), solid: true });
          }
        } else m.setAlphaMode('MASK').setAlphaCutoff(cfg.solid);
      }
      if (cfg.both) m.setDoubleSided(true);
      if (cfg.plain || cfg.bare) m.setMetallicRoughnessTexture(null);
      if (cfg.bare) {
        m.setOcclusionTexture(null);
        m.setEmissiveTexture(null);
      }
      if (cfg.dye) {
        const t = m.getBaseColorTexture();
        if (t && !t.getExtras().dyed) {
          t.setImage(new Uint8Array(await sharp(Buffer.from(t.getImage())).modulate(cfg.dye).png().toBuffer())).setMimeType('image/png');
          t.setExtras({ ...t.getExtras(), dyed: true });
        }
      }
      // (a model that came as bare colour, lighter than the thing is: its colour darkened by this much)
      if (cfg.shade !== undefined) m.setBaseColorFactor(m.getBaseColorFactor().map((v, k) => (k < 3 ? v * cfg.shade : v)));
      // (a model that came polished as a mirror where it is metal: its metal map toned down by this much, the factor
      // scaling the map, so what of it is no metal stays none)
      if (cfg.metalBy !== undefined) m.setMetallicFactor(m.getMetallicFactor() * cfg.metalBy);
      if (m.getMetallicRoughnessTexture()) continue;
      if (cfg.metal !== undefined) m.setMetallicFactor(cfg.metal);
      if (cfg.rough !== undefined) m.setRoughnessFactor(cfg.rough);
    }
    await doc.transform(prune());
    if (cfg.budget && countTris(doc) > cfg.budget * 1.15) {
      await MeshoptSimplifier.ready;
      await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: cfg.budget / countTris(doc), error: 0.02 }), prune());
    }
    const bounds = getBounds(scene);
    const tris = countTris(doc);
    const side = cfg.tex ?? 1024;
    await doc.transform(
      ...(cfg.small ? [textureCompress({ encoder: sharp, targetFormat: 'webp', pattern: cfg.small, resize: [64, 64], quality: 88 })] : []),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [side, side], quality: 88 }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await io.write(dest, doc);
    meta = { stamp, srcTris, tris, min: bounds.min.map((v) => +v.toFixed(4)), max: bounds.max.map((v) => +v.toFixed(4)), lods: [] };
    await fs.writeFile(metaPath, JSON.stringify(meta));
  }
  const st = await fs.stat(dest);
  const { stamp: _stamp, ...out } = meta;
  const size = out.max.map((v, k) => (v - out.min[k]).toFixed(2)).join(' x ');
  console.log(`model ${id.padEnd(28)} ${String(meta.srcTris).padStart(7)} -> ${String(meta.tris).padStart(6)} tris             ${(st.size / 1024).toFixed(0).padStart(6)} KB  (${credit.author}; ${size} m)`);
  return { entry: { url: `assets/models/${id}.glb`, tags: cfg.tags || [], bytes: st.size, ...out }, credit };
}
