// Bakes procedural trees (EZ-Tree, MIT) into game-ready GLBs with LODs.
//
//   node scripts/gen-trees.mjs
//
// Each variant produces public/assets/trees/<name>.glb (LOD0) and <name>_lod1.glb.
// The GLBs carry two meshes, "bark" and "leaves"; materials are built at runtime so
// the whole forest shares a handful of shader programs.
//
// LOD1 strategy: branches are meshopt-simplified; leaves keep every Nth card and
// scale it up around its attachment point so canopy coverage stays the same.
// Leaf normals are bent away from the crown centre, which gives foliage soft
// volumetric shading instead of flat card lighting.

import fs from 'node:fs/promises';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

// EZ-Tree eagerly creates textures at import; give three's ImageLoader a stub DOM.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {} }) };
const { Tree } = await import('@dgreenheck/ez-tree');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = path.join(ROOT, 'public', 'assets', 'trees');
const EZ = path.join(ROOT, 'node_modules', '@dgreenheck', 'ez-tree', 'src', 'lib', 'assets');

// name, preset, seed, target height (m), bark, leaf texture
const VARIANTS = [
  ['pine_a', 'Pine Medium', 101, 19, 'pine', 'pine'],
  ['pine_b', 'Pine Medium', 202, 17, 'pine', 'pine'],
  ['pine_c', 'Pine Large', 303, 24, 'pine', 'pine'],
  ['pine_d', 'Pine Small', 404, 13, 'pine', 'pine'],
  ['birch_a', 'Aspen Medium', 505, 16, 'birch', 'aspen'],
  ['birch_b', 'Aspen Medium', 606, 14, 'birch', 'aspen'],
  ['oak_a', 'Oak Medium', 707, 13, 'oak', 'oak'],
  ['ash_a', 'Ash Medium', 808, 15, 'oak', 'ash'],
  ['bush_a', 'Bush 1', 909, 2.2, 'oak', 'ash'],
  ['bush_b', 'Bush 2', 1010, 1.8, 'oak', 'aspen'],
];

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await fs.mkdir(OUT, { recursive: true });

function geomArrays(geo, scale) {
  const pos = Float32Array.from(geo.attributes.position.array, (v) => v * scale);
  const nrm = Float32Array.from(geo.attributes.normal.array);
  const uv = Float32Array.from(geo.attributes.uv.array);
  const idx = Uint32Array.from(geo.index.array);
  return { pos, nrm, uv, idx };
}

// Leaves are emitted as 4-vertex quads (two per leaf for "double" billboards).
function bendLeafNormals(g, center, amount) {
  for (let i = 0; i < g.pos.length; i += 3) {
    let dx = g.pos[i] - center[0], dy = (g.pos[i + 1] - center[1]) * 0.6, dz = g.pos[i + 2] - center[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    let nx = g.nrm[i] * (1 - amount) + dx * amount;
    let ny = g.nrm[i + 1] * (1 - amount) + (dy + 0.25) * amount;
    let nz = g.nrm[i + 2] * (1 - amount) + dz * amount;
    const nl = Math.hypot(nx, ny, nz) || 1;
    g.nrm[i] = nx / nl; g.nrm[i + 1] = ny / nl; g.nrm[i + 2] = nz / nl;
  }
}

function thinLeaves(g, quadsPerLeaf, keepEvery, grow) {
  const vertsPerLeaf = 4 * quadsPerLeaf;
  const leafCount = g.pos.length / 3 / vertsPerLeaf;
  const kept = [];
  for (let l = 0; l < leafCount; l += keepEvery) kept.push(l);
  const pos = new Float32Array(kept.length * vertsPerLeaf * 3);
  const nrm = new Float32Array(pos.length);
  const uv = new Float32Array(kept.length * vertsPerLeaf * 2);
  const idx = new Uint32Array(kept.length * quadsPerLeaf * 6);
  kept.forEach((l, k) => {
    const v0 = l * vertsPerLeaf;
    // attachment point = midpoint of the quad's bottom edge (verts 1 and 2)
    const ox = (g.pos[(v0 + 1) * 3] + g.pos[(v0 + 2) * 3]) / 2;
    const oy = (g.pos[(v0 + 1) * 3 + 1] + g.pos[(v0 + 2) * 3 + 1]) / 2;
    const oz = (g.pos[(v0 + 1) * 3 + 2] + g.pos[(v0 + 2) * 3 + 2]) / 2;
    for (let v = 0; v < vertsPerLeaf; v++) {
      const s = (v0 + v) * 3, d = (k * vertsPerLeaf + v) * 3;
      pos[d] = ox + (g.pos[s] - ox) * grow;
      pos[d + 1] = oy + (g.pos[s + 1] - oy) * grow;
      pos[d + 2] = oz + (g.pos[s + 2] - oz) * grow;
      nrm[d] = g.nrm[s]; nrm[d + 1] = g.nrm[s + 1]; nrm[d + 2] = g.nrm[s + 2];
      uv[(k * vertsPerLeaf + v) * 2] = g.uv[(v0 + v) * 2];
      uv[(k * vertsPerLeaf + v) * 2 + 1] = g.uv[(v0 + v) * 2 + 1];
    }
    for (let q = 0; q < quadsPerLeaf; q++) {
      const b = k * vertsPerLeaf + q * 4, o = (k * quadsPerLeaf + q) * 6;
      idx.set([b, b + 1, b + 2, b, b + 2, b + 3], o);
    }
  });
  return { pos, nrm, uv, idx };
}

function addMesh(doc, buffer, scene, name, g) {
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', g.pos))
    .setAttribute('NORMAL', acc('VEC3', g.nrm))
    .setAttribute('TEXCOORD_0', acc('VEC2', g.uv))
    .setIndices(acc('SCALAR', g.idx));
  const mesh = doc.createMesh(name).addPrimitive(prim);
  scene.addChild(doc.createNode(name).setMesh(mesh));
}

async function writeTree(file, bark, leaves, barkRatio) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  addMesh(doc, buffer, scene, 'bark', bark);
  addMesh(doc, buffer, scene, 'leaves', leaves);
  // simplify() would also collapse leaf cards, so only weld + simplify the bark node.
  if (barkRatio < 1) {
    const barkDoc = new Document();
    const bb = barkDoc.createBuffer();
    const bs = barkDoc.createScene();
    addMesh(barkDoc, bb, bs, 'bark', bark);
    await barkDoc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: barkRatio, error: 0.01 }));
    const p = barkDoc.getRoot().listMeshes()[0].listPrimitives()[0];
    const g = {
      pos: p.getAttribute('POSITION').getArray(),
      nrm: p.getAttribute('NORMAL').getArray(),
      uv: p.getAttribute('TEXCOORD_0').getArray(),
      idx: Uint32Array.from(p.getIndices().getArray()),
    };
    const doc2 = new Document();
    const b2 = doc2.createBuffer();
    const s2 = doc2.createScene();
    addMesh(doc2, b2, s2, 'bark', g);
    addMesh(doc2, b2, s2, 'leaves', leaves);
    await doc2.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await io.write(file, doc2);
    return g.idx.length / 3;
  }
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(file, doc);
  return bark.idx.length / 3;
}

const meta = {};
for (const [name, preset, seed, height, barkType, leafType] of VARIANTS) {
  const tree = new Tree();
  tree.loadPreset(preset);
  tree.options.seed = seed;
  tree.generate();
  const lg = tree.leavesMesh.geometry;
  lg.computeBoundingBox();
  const bb = lg.boundingBox;
  const scale = height / bb.max.y;
  const bark = geomArrays(tree.branchesMesh.geometry, scale);
  const leaves = geomArrays(lg, scale);
  const center = [((bb.min.x + bb.max.x) / 2) * scale, ((bb.min.y + bb.max.y) / 2) * scale, ((bb.min.z + bb.max.z) / 2) * scale];
  bendLeafNormals(leaves, center, 0.75);

  const quadsPerLeaf = tree.options.leaves.billboard === 'double' ? 2 : 1;
  const lod0Bark = await writeTree(path.join(OUT, `${name}.glb`), bark, leaves, 1);
  const leaves1 = thinLeaves(leaves, quadsPerLeaf, 3, 1.55);
  const lod1Bark = await writeTree(path.join(OUT, `${name}_lod1.glb`), bark, leaves1, 0.18);

  const radius = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * scale * 0.5;
  // trunk radius at the base, for the physics collider
  let trunk = 0;
  for (let i = 0; i < bark.pos.length; i += 3) {
    if (bark.pos[i + 1] < 0.3) trunk = Math.max(trunk, Math.hypot(bark.pos[i], bark.pos[i + 2]));
  }
  meta[name] = {
    url: `assets/trees/${name}.glb`,
    lod1: `assets/trees/${name}_lod1.glb`,
    height,
    radius: +radius.toFixed(2),
    trunkRadius: +trunk.toFixed(3),
    center: center.map((v) => +v.toFixed(2)),
    bark: barkType,
    leaf: leafType,
    alphaTest: tree.options.leaves.alphaTest,
    tris: { lod0: lod0Bark + leaves.idx.length / 3, lod1: lod1Bark + leaves1.idx.length / 3 },
  };
  console.log(`${name.padEnd(8)} ${preset.padEnd(13)} h=${height}m r=${radius.toFixed(1)}m trunk=${trunk.toFixed(2)}m tris lod0=${meta[name].tris.lod0} lod1=${meta[name].tris.lod1}`);
}

// Leaf cards (RGBA) and birch bark, re-encoded as webp.
for (const leaf of ['pine', 'aspen', 'oak', 'ash']) {
  await sharp(path.join(EZ, 'leaves', `${leaf}_color.png`)).webp({ quality: 90, alphaQuality: 100 }).toFile(path.join(OUT, `leaf_${leaf}.webp`));
}
for (const map of ['color', 'normal', 'roughness', 'ao']) {
  await sharp(path.join(EZ, 'bark', `birch_${map}_1k.jpg`)).webp({ quality: 88 }).toFile(path.join(OUT, `birch_${map}.webp`));
}

await fs.writeFile(path.join(OUT, 'trees.json'), JSON.stringify(meta, null, 1));
console.log('trees written to', OUT);
