// Builds the things a survivor wears, as they are drawn on the body: public/assets/characters/wear/<id>.glb.
//
//   node scripts/wear.mjs            all of them
//   node scripts/wear.mjs m65        only that one
//
// The owner, 2026-10-24: "i like the clothes they have on. but i want to make them items to be looted on the ground
// like dayz". Each piece is drawn in Higgsfield on one of the survivors in their base layer (scripts/survivors.mjs),
// the rest of them left bare, front and back, and made 3D by Meshy, rigged, in the same A-pose. So it is cut to the
// body it was made on, and fits it:
//
//   1. That body and the dressed one are both carried onto the game's skeleton (scripts/meshy.mjs, carry) and stood
//      at the skeleton's rest, where every point of the one can be laid against the other.
//   2. What lies over parts of the body the piece cannot be over is cut away (`parts`: REGION in src/sim/survivor.ts);
//      and at its edges (the parts it does not wholly cover, `covers`) what is as like the body under it in colour as
//      it is like the piece (the skin at a cuff, the shorts below a hem). Over the parts it covers, only what is far
//      more like the body than the piece, where the piece is unlike the body there, and only where the base layer can
//      show (`peeks`: under a red shirt's hem, a T-shirt hem over a waistband; not down a leg, where faded denim is as
//      light as skin). A grey hoodie over the grey base layer was cut to lace by colour alone.
//   3. Where Meshy joined a sleeve to the side (a loose sleeve hanging against it), the skin it made between them is
//      stretched far more than the rest when the arm is raised: those triangles are cut away.
//   What is left is the piece, bound as Meshy bound it.
//
// On the other bodies it is worn as cut; the skin under it is hidden there (src/game/survivors.ts), so nothing pokes
// through. Its colours and camouflages are its one picture made another colour in the game.

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, unpartition, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { M4, carry, markRegions, padTexture } from './meshy.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
// (assets-src lives in the main checkout only: a session's worktree reads it from there)
const SRC_ROOT = existsSync(path.join(ROOT, 'assets-src')) ? path.join(ROOT, 'assets-src') : path.resolve(ROOT, '..', '..', '..', 'assets-src');
const SRC = path.join(SRC_ROOT, 'incoming', 'higgsfield', 'survivors');
const TEMPLATE = path.join(SRC_ROOT, 'characters', 'plain.glb');
const OUT = path.join(ROOT, 'public', 'assets', 'characters', 'wear');
const REGION = { scalp: 0, face: 1, neck: 2, chest: 3, belly: 4, hips: 5, shoulder: 6, upperArm: 7, forearm: 8, hand: 9, thigh: 10, aboveKnee: 11, shin: 12, foot: 13 };

/**
 * Each piece: its Meshy file, the body it was made on, the parts of the body it can be over (`parts`) and those it
 * surely covers (`core`: its own colour is learnt there; `covers`: all of it there is the piece, as the item's own
 * `hides` in src/sim/items/wear.ts), and its picture's size. Gloves have fingers (`fingers`: bound to the finger bones
 * as the body is, scripts/meshy.mjs fitHand).
 */
const TOP = ['neck', 'face', 'chest', 'belly', 'hips', 'shoulder', 'upperArm', 'forearm', 'hand', 'thigh'];
const LEGS = ['belly', 'hips', 'thigh', 'aboveKnee', 'shin', 'foot'];
const FEET = ['shin', 'foot'];
const HANDS = ['forearm', 'hand'];
const JACKET = { parts: TOP, core: ['chest', 'upperArm'], covers: ['chest', 'belly', 'shoulder', 'upperArm', 'forearm'], peeks: ['chest', 'belly', 'shoulder', 'upperArm', 'forearm'] };
const TROUSERS = { parts: LEGS, core: ['thigh', 'shin'], covers: ['hips', 'thigh', 'aboveKnee', 'shin'], peeks: ['hips'] };
const BOOTS = { parts: FEET, core: ['foot'], covers: ['foot'] };
const PIECES = {
  m65: { src: 'wear_m65.glb', body: 0, ...JACKET, tex: 2048 },
  telogreika: { src: 'wear_telogreika.glb', body: 1, ...JACKET, tex: 2048 },
  hoodie: { src: 'wear_hoodie.glb', body: 1, ...JACKET, tex: 2048 },
  flannel: { src: 'wear_flannel.glb', body: 3, ...JACKET, tex: 2048 },
  leather_jacket: { src: 'wear_leather_jacket.glb', body: 3, ...JACKET, tex: 2048 },
  parka: { src: 'wear_parka.glb', body: 2, ...JACKET, parts: [...TOP, 'aboveKnee'], covers: [...JACKET.covers, 'hips'], tex: 2048 },
  field_pants: { src: 'wear_field_pants.glb', body: 0, ...TROUSERS, tex: 2048 },
  jeans: { src: 'wear_jeans.glb', body: 1, ...TROUSERS, tex: 2048 },
  cargo_pants: { src: 'wear_cargo_pants.glb', body: 2, ...TROUSERS, tex: 2048 },
  work_pants: { src: 'wear_work_pants.glb', body: 3, ...TROUSERS, tex: 2048 },
  combat_boots: { src: 'wear_combat_boots.glb', body: 0, ...BOOTS, tex: 1024 },
  work_boots: { src: 'wear_work_boots.glb', body: 1, ...BOOTS, tex: 1024 },
  hiking_boots: { src: 'wear_hiking_boots.glb', body: 2, ...BOOTS, tex: 1024 },
  leather_gloves: { src: 'wear_leather_gloves.glb', body: 2, parts: HANDS, core: ['hand'], covers: ['hand'], tex: 1024, fingers: true },
  fingerless: { src: 'wear_fingerless.glb', body: 0, parts: HANDS, core: ['hand'], covers: [], tex: 1024, fingers: true },
  // (the basics every life begins in: src/sim/items.ts, CLOTHES)
  tshirt: { src: 'wear_tshirt.glb', body: 1, parts: TOP, core: ['chest'], covers: ['chest', 'belly', 'shoulder'], peeks: ['chest', 'belly', 'shoulder'], tex: 2048 },
  tracksuit_pants: { src: 'wear_tracksuit_pants.glb', body: 1, ...TROUSERS, tex: 2048 },
  trainers: { src: 'wear_trainers.glb', body: 1, ...BOOTS, tex: 1024 },
  smock: { src: 'wear_smock.glb', body: 0, ...JACKET, tex: 2048 },
  smock_pants: { src: 'wear_smock_pants.glb', body: 0, ...TROUSERS, tex: 2048 },
  // (neck to ankle, over everything: there is no base layer to show through it)
  ghillie_suit: { src: 'wear_ghillie_suit.glb', body: 0, parts: [...new Set([...TOP, ...LEGS])], core: ['chest', 'thigh'], covers: [...JACKET.covers, ...TROUSERS.covers], tex: 2048 },
};
/** the bodies as Meshy made them (scripts/survivors.mjs) */
const BODIES = ['body0_rigged.glb', 'body1_rigged.glb', 'body2_rigged.glb', 'body3_rigged.glb'];
const ONLY = process.argv.slice(2);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** a carried shape's points as its skeleton stands at rest, each with its colour off its picture (0..1) */
async function laid(node) {
  const skin = node.getSkin(), joints = skin.listJoints(), ibm = skin.getInverseBindMatrices();
  const M = joints.map((j, k) => M4(j.getWorldMatrix()).multiply(M4(ibm.getElement(k, []))));
  const prim = node.getMesh().listPrimitives()[0];
  const pos = prim.getAttribute('POSITION'), ji = prim.getAttribute('JOINTS_0'), jw = prim.getAttribute('WEIGHTS_0'), uv = prim.getAttribute('TEXCOORD_0');
  const tex = prim.getMaterial().getBaseColorTexture();
  const { data, info } = await sharp(Buffer.from(tex.getImage())).raw().toBuffer({ resolveWithObject: true });
  const P = [], C = [], v = new THREE.Vector3(), out = new THREE.Vector3();
  for (let i = 0; i < pos.getCount(); i++) {
    v.fromArray(pos.getElement(i, []));
    const a = ji.getElement(i, []), w = jw.getElement(i, []);
    out.set(0, 0, 0);
    for (let c = 0; c < 4; c++) if (w[c] > 0) out.addScaledVector(v.clone().applyMatrix4(M[a[c]]), w[c]);
    P.push(out.clone());
    const [s, t] = uv.getElement(i, []);
    const x = Math.min(info.width - 1, Math.max(0, Math.round(s * (info.width - 1)))), y = Math.min(info.height - 1, Math.max(0, Math.round(t * (info.height - 1))));
    const o = (y * info.width + x) * info.channels;
    C.push([data[o] / 255, data[o + 1] / 255, data[o + 2] / 255]);
  }
  return { P, C, prim };
}

for (const [id, piece] of Object.entries(PIECES)) {
  if (ONLY.length && !ONLY.includes(id)) continue;
  const body = await carry({ io, template: TEMPLATE, src: await io.read(path.join(SRC, BODIES[piece.body])), fingers: true });
  markRegions(body.doc, body.node);
  // (on the skeleton made the shape of the body it was made on, as that body is: see fitProportions in scripts/meshy.mjs)
  const dressed = await carry({ io, template: TEMPLATE, src: await io.read(path.join(SRC, piece.src)), fingers: !!piece.fingers, fit: await io.read(path.join(SRC, BODIES[piece.body])) });
  const B = await laid(body.node), D = await laid(dressed.node);
  const region = body.node.getMesh().listPrimitives()[0].getAttribute('_REGION');

  // ---- the body's points by where they are, to find the nearest of them to each point of the dressed one
  const CELL = 0.03, grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  B.P.forEach((p, i) => {
    const k = key(p.x, p.y, p.z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const nearest = (p) => {
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), cz = Math.floor(p.z / CELL);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= 4 && (best < 0 || r <= 2); r++) {
      for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
        for (const i of grid.get(`${x},${y},${z}`) ?? []) {
          const d = B.P[i].distanceToSquared(p);
          if (d < bd) [best, bd] = [i, d];
        }
      }
    }
    return [best, Math.sqrt(bd)];
  };
  // ---- what colour the piece is: the middle of the colours of what lies over the parts it surely covers
  const parts = new Set(piece.parts.map((p) => REGION[p])), core = new Set(piece.core.map((p) => REGION[p])), covers = new Set(piece.covers.map((p) => REGION[p])), peeks = new Set((piece.peeks ?? []).map((p) => REGION[p]));
  const near = D.P.map((p) => nearest(p)[0]);
  const own = [0, 1, 2].map((ch) => {
    const v = near.flatMap((n, i) => (n >= 0 && core.has(region.getScalar(n)) ? [D.C[i][ch]] : [])).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  });
  // a point is the piece where it is nearer the piece's colour than the colour of the body under it (the skin at a cuff or
  // a collar, the shorts below a hem), and over a part the piece can be over
  const off = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const why = { part: new Array(14).fill(0), body: 0, kept: 0, stretched: 0 };
  let keep = D.P.map((p, i) => {
    const n = near[i];
    if (n < 0 || !parts.has(region.getScalar(n))) return (why.part[n < 0 ? 0 : region.getScalar(n)]++, false);
    if (covers.has(region.getScalar(n)) ? peeks.has(region.getScalar(n)) && off(own, B.C[n]) > 0.3 && off(D.C[i], B.C[n]) * 2 < off(D.C[i], own) : off(D.C[i], own) >= off(D.C[i], B.C[n])) return (why.body++, false);
    return (why.kept++, true);
  });

  // ---- evened out over the surface (a point's neighbours outvote it, twice), then the triangles all of whose points are kept.
  // (The surface as one: Meshy cuts it apart along every seam of its picture, a few hundred islands, so the points at
  // one place are taken as one point for which is next to which.)
  const idx = D.prim.getIndices(), T = [];
  for (let t = 0; t < idx.getCount(); t += 3) T.push([idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)]);
  const first = new Map(), one = D.P.map((p, i) => {
    const k = `${Math.round(p.x * 5000)},${Math.round(p.y * 5000)},${Math.round(p.z * 5000)}`;
    if (!first.has(k)) first.set(k, i);
    return first.get(k);
  });
  const next = D.P.map(() => new Set());
  for (const t of T) {
    const [a, b, c] = t.map((i) => one[i]);
    next[a].add(b).add(c), next[b].add(a).add(c), next[c].add(a).add(b);
  }
  // (a place is kept if its first point is: the points at one place decide together)
  keep = keep.map((k, i) => keep[one[i]]);
  for (let pass = 0; pass < 2; pass++) {
    const was = keep;
    keep = keep.map((k, i) => {
      const n = next[one[i]];
      return n.size ? [...n].filter((j) => was[j]).length * 2 > n.size : k;
    });
  }
  // (and closed, three rings out and three back: a notch or a hole in it, where the cloth was in shadow as dark as the
  // shorts under it, is filled, and its edge stays where it was. The M65's hem was torn so, 2026-10-25.)
  {
    const CLOSE = 3, inPart = near.map((n) => n >= 0 && parts.has(region.getScalar(n)));
    let shut = keep.slice();
    for (let r = 0; r < CLOSE; r++) {
      const was = shut;
      shut = shut.map((k, i) => k || (inPart[i] && [...next[one[i]]].some((j) => was[j])));
    }
    for (let r = 0; r < CLOSE; r++) {
      const was = shut;
      shut = shut.map((k, i) => k && [...next[one[i]]].every((j) => was[j]));
    }
    keep = keep.map((k, i) => k || shut[i]);
  }
  let tris = T.filter((t) => t.every((i) => keep[i]));
  // (the skin Meshy made between a sleeve and the side: how much longer a triangle's longest edge is at rest, arms out,
  // than as it was made, arms down, against how much longer they are on the whole; four times is no cloth's)
  {
    const pos = D.prim.getAttribute('POSITION'), a = new THREE.Vector3(), b = new THREE.Vector3();
    const made = (i, j) => a.fromArray(pos.getElement(i, [])).distanceTo(b.fromArray(pos.getElement(j, [])));
    const long = (t, d) => Math.max(d(t[0], t[1]), d(t[1], t[2]), d(t[2], t[0]));
    const ratio = tris.map((t) => long(t, (i, j) => D.P[i].distanceTo(D.P[j])) / Math.max(1e-9, long(t, made)));
    const usual = [...ratio].sort((x, y) => x - y)[Math.floor(ratio.length / 2)];
    const was = tris.length;
    tris = tris.filter((t, k) => ratio[k] < usual * +(process.env.STRETCH ?? 4));
    why.stretched = was - tris.length;
  }
  if (process.env.WHY) console.log(JSON.stringify({ own: own.map((c) => +c.toFixed(3)), ...why }));
  // (and no crumbs: a piece of it apart from the rest, of fewer than fifty triangles, is cut away too)
  {
    const of = new Map();
    tris.forEach((t, k) => t.forEach((i) => (of.has(one[i]) ? of.get(one[i]).push(k) : of.set(one[i], [k]))));
    const seen = new Uint8Array(tris.length), lots = [];
    for (let s = 0; s < tris.length; s++) {
      if (seen[s]) continue;
      const lot = [s];
      seen[s] = 1;
      for (let h = 0; h < lot.length; h++) for (const i of tris[lot[h]]) for (const k of of.get(one[i])) if (!seen[k]) (seen[k] = 1), lot.push(k);
      lots.push(lot);
    }
    tris = lots.filter((l) => l.length >= 50).flat().map((k) => tris[k]);
  }

  // ---- a clean hem (the navigator, 2026-10-25: the M65's hem and the flannel's collar showed "a ragged, light,
  // torn-looking rim"): Meshy painted skin and shirt on the piece's edges, and the cut kept a sliver of it. The two
  // rings of points nearest the cut take their place on the picture from the ring inside them (the rim is drawn with the
  // cloth beside it), and are shaded a little darker, as a turned hem is.
  const HEM = 2;
  const ring = new Map();
  {
    // (an edge of the cut is one that is open now and was not in the whole model: Meshy's model is open along many of
    // its picture's seams, a hair apart, and those are not the cut)
    const count = (list) => {
      const edges = new Map();
      for (const t of list) for (let e = 0; e < 3; e++) {
        const a = one[t[e]], b = one[t[(e + 1) % 3]], k = a < b ? `${a},${b}` : `${b},${a}`;
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
      return edges;
    };
    const was = count(T), edges = count(tris);
    let front = [];
    for (const [k, n] of edges) if (n === 1 && was.get(k) > 1) for (const p of k.split(',').map(Number)) if (!ring.has(p)) (ring.set(p, 0), front.push(p));
    const near = new Map();
    for (const t of tris) for (const i of t) for (const j of t) if (one[i] !== one[j]) (near.get(one[i]) ?? near.set(one[i], new Set()).get(one[i])).add(one[j]);
    for (let d = 1; d <= HEM; d++) {
      const next = [];
      for (const p of front) for (const q of near.get(p) ?? []) if (!ring.has(q)) (ring.set(q, d), next.push(q));
      front = next;
    }
  }
  {
    const uv = D.prim.getAttribute('TEXCOORD_0'), by = new Map();
    for (const t of tris) for (const i of t) for (const j of t) if (i !== j) (by.get(i) ?? by.set(i, new Set()).get(i)).add(j);
    const depth = (i) => ring.get(one[i]) ?? HEM + 1;
    for (let d = HEM - 1; d >= 0; d--) {
      for (const [i, js] of by) {
        if (depth(i) !== d) continue;
        const inner = [...js].filter((j) => depth(j) > d);
        if (!inner.length) continue;
        const m = [0, 0];
        for (const j of inner) {
          const [s, t] = uv.getElement(j, []);
          m[0] += s / inner.length;
          m[1] += t / inner.length;
        }
        uv.setElement(i, m);
      }
    }
    const shade = [0.62, 0.84], col = new Float32Array(uv.getCount() * 3).fill(1);
    for (let i = 0; i < uv.getCount(); i++) {
      const d = depth(i);
      if (d < shade.length) col.fill(shade[d], i * 3, i * 3 + 3);
    }
    D.prim.setAttribute('COLOR_0', dressed.doc.createAccessor().setType('VEC3').setArray(col));
  }
  // ---- the picture padded from the piece's own cloth: what lies between its islands on the picture was the body's
  // (skin, the shirt), and came in at every island's edge as pink and light slivers, nearer at a distance as the
  // picture is drawn smaller. Everything of the picture the piece does not cover takes the colour of the nearest cloth.
  await padTexture(D.prim, tris);

  // ---- the piece: only its own points, in the order they are first used
  const prim = D.prim, used = new Map();
  for (const t of tris) for (const i of t) if (!used.has(i)) used.set(i, used.size);
  for (const s of prim.listSemantics()) {
    const a = prim.getAttribute(s), n = a.getElementSize(), Kind = a.getArray().constructor, out = new Kind(used.size * n), e = [];
    for (const [i, j] of used) out.set(a.getElement(i, e), j * n);
    prim.setAttribute(s, dressed.doc.createAccessor().setType(a.getType()).setNormalized(a.getNormalized()).setArray(out));
  }
  prim.setIndices(dressed.doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(tris.flat().map((i) => used.get(i)))));
  dressed.node.setName('wear').getMesh().setName('wear');
  const mat = prim.getMaterial().setName(`wear_${id}`).setDoubleSided(true);
  // (how light its picture is where it is drawn, on average: a colour put on it is laid on in proportion to this, so that
  // its folds and wear stay as they are; see src/game/survivors.ts)
  {
    const { data, info } = await sharp(Buffer.from(mat.getBaseColorTexture().getImage())).raw().toBuffer({ resolveWithObject: true });
    const uv = prim.getAttribute('TEXCOORD_0'), e = [];
    let sum = 0;
    for (let i = 0; i < uv.getCount(); i++) {
      const [s, t] = uv.getElement(i, e), o = (Math.round(t * (info.height - 1)) * info.width + Math.round(s * (info.width - 1))) * info.channels;
      sum += 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    }
    mat.setExtras({ light: +(sum / uv.getCount() / 255).toFixed(4) });
  }
  await dressed.doc.transform(
    unpartition(),
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColorTexture$/, resize: [piece.tex, piece.tex], quality: 88 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await fs.mkdir(OUT, { recursive: true });
  const dest = path.join(OUT, `${id}.glb`);
  await io.write(dest, dressed.doc);
  const st = await fs.stat(dest);
  console.log(`${id}.glb  ${(st.size / 1048576).toFixed(2)} MB  ${tris.length} triangles of ${T.length}, ${used.size} points, light ${mat.getExtras().light}`);
}
