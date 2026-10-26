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
import { M4, at, carry, legJoints, markRegions, padTexture, plainHands, straightenLegs, suitWeights } from './meshy.mjs';

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
 * as the body is, scripts/meshy.mjs fitHand). A piece of one colour (`plain`) has its picture made that colour all
 * over at its own lightness, Meshy's leftovers painted out (see plainCloth). A piece whose body is grey as the body's
 * undershirt is (`grey`: the tactical shirt) keeps what is of that colour.
 */
const TOP = ['neck', 'face', 'chest', 'belly', 'hips', 'shoulder', 'upperArm', 'forearm', 'hand', 'thigh'];
const LEGS = ['belly', 'hips', 'thigh', 'aboveKnee', 'shin', 'foot'];
const FEET = ['shin', 'foot'];
const HANDS = ['forearm', 'hand'];
const JACKET = { parts: TOP, core: ['chest', 'upperArm'], covers: ['chest', 'belly', 'shoulder', 'upperArm', 'forearm'], peeks: ['chest', 'belly', 'shoulder', 'upperArm', 'forearm'] };
const TROUSERS = { parts: LEGS, core: ['thigh', 'shin'], covers: ['hips', 'thigh', 'aboveKnee', 'shin'], peeks: ['hips'] };
const BOOTS = { parts: FEET, core: ['foot'], covers: ['foot'], even: 8 };
const PIECES = {
  m65: { src: 'wear_m65.glb', body: 0, ...JACKET, plain: true, tex: 2048 },
  telogreika: { src: 'wear_telogreika.glb', body: 1, ...JACKET, plain: true, tex: 2048 },
  // (down over the hips, as the parka: all of it there is the hoodie but what is plainly the body's)
  hoodie: { src: 'wear_hoodie.glb', body: 1, ...JACKET, covers: [...JACKET.covers, 'hips'], peeks: [...JACKET.peeks, 'hips'], plain: true, tex: 2048 },
  flannel: { src: 'wear_flannel.glb', body: 3, ...JACKET, tex: 2048 },
  leather_jacket: { src: 'wear_leather_jacket.glb', body: 3, ...JACKET, plain: true, tex: 2048 },
  parka: { src: 'wear_parka.glb', body: 2, ...JACKET, parts: [...TOP, 'aboveKnee'], covers: [...JACKET.covers, 'hips', 'thigh'], peeks: [...JACKET.peeks, 'hips', 'thigh'], plain: true, tex: 2048 },
  field_pants: { src: 'wear_field_pants.glb', body: 0, ...TROUSERS, plain: true, tex: 2048 },
  jeans: { src: 'wear_jeans.glb', body: 1, ...TROUSERS, tex: 2048 },
  cargo_pants: { src: 'wear_cargo_pants.glb', body: 2, ...TROUSERS, plain: true, tex: 2048 },
  work_pants: { src: 'wear_work_pants.glb', body: 3, ...TROUSERS, tex: 2048 },
  combat_boots: { src: 'wear_combat_boots.glb', body: 0, ...BOOTS, tex: 1024 },
  work_boots: { src: 'wear_work_boots.glb', body: 1, ...BOOTS, tex: 1024 },
  hiking_boots: { src: 'wear_hiking_boots.glb', body: 2, ...BOOTS, tex: 1024 },
  // (their hands the skeleton's own, as the bodies' are (plainHands), a few millimetres over the skin, all of one colour;
  // the fingerless only over the palm and the fingers' first joints)
  leather_gloves: { src: 'wear_leather_gloves.glb', body: 2, parts: HANDS, core: ['hand'], covers: ['hand'], tex: 1024, fingers: true, hands: { lift: 0.003 } },
  fingerless: { src: 'wear_fingerless.glb', body: 0, parts: HANDS, core: ['hand'], covers: [], tex: 1024, fingers: true, hands: { lift: 0.003, bones: /^(hand|(thumb|index|middle|ring|pinky)_01)_[lr]$/ } },
  // (the basics every life begins in: src/sim/items.ts, CLOTHES)
  // (all of it over the chest, the belly and the shoulders is the shirt: white over the body's own grey shirt, it was
  // taken for the body there by its colour, and had holes)
  tshirt: { src: 'wear_tshirt.glb', body: 1, parts: TOP, core: ['chest'], covers: ['chest', 'belly', 'shoulder'], plain: 0.85, tex: 2048 },
  tracksuit_pants: { src: 'wear_tracksuit_pants.glb', body: 1, ...TROUSERS, tex: 2048 },
  // (and the skin Meshy left in its collar cut away: a pink sliver at the heel showed under a jeans hem)
  // (and nothing of it over the shin: a low shoe, and a sliver of the figure's calf left in it stretched from the heel up
  // the leg when the knee bent, the owner: "when player is crouched their left leg shows through their pants")
  trainers: { src: 'wear_trainers.glb', body: 1, ...BOOTS, parts: ['foot'], peeks: ['foot'], tex: 1024 },
  smock: { src: 'wear_smock.glb', body: 0, ...JACKET, plain: true, tex: 2048 },
  smock_pants: { src: 'wear_smock_pants.glb', body: 0, ...TROUSERS, plain: true, tex: 2048 },
  // (the more military gear the owner asked for, 2026-10-25, and the jackets and boots beside it)
  tactical_jacket: { src: 'wear_tactical_jacket.glb', body: 0, ...JACKET, plain: true, tex: 2048 },
  combat_shirt: { src: 'wear_combat_shirt.glb', body: 1, ...JACKET, grey: true, tex: 2048 },
  tracksuit_jacket: { src: 'wear_tracksuit_jacket.glb', body: 1, ...JACKET, tex: 2048 },
  winter_boots: { src: 'wear_winter_boots.glb', body: 0, ...BOOTS, tex: 1024 },
  // (the stab vest that takes the all-black one's place, the owner: "the stab vest I think needs a new model"; its
  // straps over the shoulders. All of it over the chest and the belly is the vest, painted its own colour: Meshy drew a
  // T-shirt at its sides, and cut away by its colour it left a hole from each armhole to the waist)
  stab_vest: { src: 'wear_stab_vest.glb', body: 0, parts: ['neck', 'chest', 'belly', 'hips', 'shoulder', 'upperArm'], core: ['chest', 'belly'], covers: ['chest', 'belly'], plain: true, grey: true, tex: 2048 },
  // (neck to ankle, over everything: there is no base layer to show through it)
  ghillie_suit: { src: 'wear_ghillie_suit.glb', body: 0, parts: [...new Set([...TOP, ...LEGS])], core: ['chest', 'thigh'], covers: [...JACKET.covers, ...TROUSERS.covers], tex: 2048 },
};
/** the bodies as Meshy made them (scripts/survivors.mjs) */
const BODIES = ['body0_rigged.glb', 'body1_rigged.glb', 'body2_rigged.glb', 'body3_rigged.glb'];
const ONLY = process.argv.slice(2);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const SUIT = await io.read(path.join(ROOT, 'public', 'assets', 'characters', 'survivor.glb'));

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

/**
 * A plain piece's picture made its own colour (the owner, 2026-10-25: "polish high quality consistency"): Meshy left
 * skin in a crease and blocks of shadow on the cloth (a grey patch stood on a T-shirt's back). What is far from the
 * piece's own colour, in hue or in lightness, is painted from the cloth about it; then every texel takes the piece's
 * own hue at its own lightness, so the folds and seams stay and nothing else does.
 * @param own the piece's colour, 0..1; @param least the darkest a fold of it is, against it (a white T-shirt's are
 * light: a grey patch on one's back was Meshy's paint, at two thirds of the shirt's lightness)
 */
async function plainCloth(prim, own, least = 0.45) {
  const tex = prim.getMaterial().getBaseColorTexture();
  const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H, luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const lo = Math.max(0.04, luma(...own)), hue = own.map((c) => c / lo);
  const good = Buffer.alloc(N), held = Buffer.alloc(N * 3);
  let bad = 0;
  for (let i = 0; i < N; i++) {
    const r = data[i * 3] / 255, g = data[i * 3 + 1] / 255, b = data[i * 3 + 2] / 255, L = Math.max(0.02, luma(r, g, b));
    // (how far it is from the piece's colour at its own lightness, in the picture's own units: a dark cloth's hue is
    // too unsteady to judge it by)
    const k = L / lo, off = Math.hypot(r - own[0] * k, g - own[1] * k, b - own[2] * k);
    // (a fold's shadow is half as light as the cloth, its top lit half again: kept)
    const ok = k > least && k < 1.6 && off < 0.12;
    if (!ok) bad++;
    good[i] = ok ? 255 : 0;
    if (ok) data.copy(held, i * 3, i * 3, i * 3 + 3);
  }
  // (what is around each texel, of the cloth only: the cloth blurred over the blurred share of it that is cloth)
  const raw = (buf, channels) => sharp(buf, { raw: { width: W, height: H, channels } }).blur(12).raw().toBuffer();
  const [sum, share] = await Promise.all([raw(held, 3), raw(good, 1)]);
  const out = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) {
    let r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    if (!good[i] && share[i] > 2) [r, g, b] = [0, 1, 2].map((c) => (sum[i * 3 + c] * 255) / share[i]);
    const k = Math.min(1.6, Math.max(least, luma(r, g, b) / 255 / lo));
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.max(0, Math.min(255, Math.round(own[c] * k * 255)));
  }
  tex.setImage(new Uint8Array(await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer())).setMimeType('image/png');
  return `plain: ${((bad / N) * 100).toFixed(1)}% of its picture painted from the cloth`;
}

/** the skeleton's own body, for the gloves' hands (see plainHands) */
const PLAIN = await io.read(TEMPLATE);
for (const [id, piece] of Object.entries(PIECES)) {
  if (ONLY.length && !ONLY.includes(id)) continue;
  const body = await carry({ io, template: TEMPLATE, src: await io.read(path.join(SRC, BODIES[piece.body])), fingers: true });
  markRegions(body.doc, body.node);
  // (the body's legs stood as the skeleton stands them, and the piece's alike: see straightenLegs)
  const legs = legJoints(body.node);
  straightenLegs(body.node, legs);
  // (weighted as the built body is, the old suit's, so the piece takes the same: see suitWeights)
  suitWeights(body.node, SUIT);
  // (on the skeleton made the shape of the body it was made on, as that body is: see fitProportions in scripts/meshy.mjs)
  const dressed = await carry({ io, template: TEMPLATE, src: await io.read(path.join(SRC, piece.src)), fingers: !!piece.fingers, fit: await io.read(path.join(SRC, BODIES[piece.body])) });
  straightenLegs(dressed.node, legs);
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
  const why = { part: new Array(14).fill(0), body: 0, shirt: 0, kept: 0, stretched: 0 };
  // (and not the body's own grey undershirt, which Meshy dressed every piece over: under a jacket's hem and over a pair
  // of trousers' waist it came with the piece, a white band at the hips under every top (the navigator, 2026-10-25).
  // Its colour is the body's over the chest; a piece of about that colour keeps it, as the T-shirt itself does.)
  const shirt = [0, 1, 2].map((ch) => {
    const v = B.C.flatMap((c, n) => (region.getScalar(n) === REGION.chest ? [c[ch]] : [])).sort((x, y) => x - y);
    return v[Math.floor(v.length / 2)];
  });
  // (only for what reaches the waist, where the undershirt was: a shoe's shadowed white is as grey as it)
  const notShirt = piece.grey || off(own, shirt) < 0.25 || !(parts.has(REGION.belly) || parts.has(REGION.hips));
  let keep = D.P.map((p, i) => {
    const n = near[i];
    if (n < 0 || !parts.has(region.getScalar(n))) return (why.part[n < 0 ? 0 : region.getScalar(n)]++, false);
    if (!notShirt && off(D.C[i], shirt) < 0.2 && off(D.C[i], own) > 0.2) return (why.shirt++, false);
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
  // (and a hole in it filled, however wide: a patch of fewer than four hundred places left out with the piece all round
  // it, where Meshy shaded the cloth as dark as the body under it. A T-shirt's back had one a hand across, 2026-10-25.
  // Over the trunk and the limbs only: the lips, the nails and the eyes are shells of their own, and were filled too.)
  {
    const seen = new Uint8Array(D.P.length), skin = new Set([REGION.scalp, REGION.face, REGION.neck, REGION.hand, REGION.foot]);
    const trunk = (i) => near[i] >= 0 && parts.has(region.getScalar(near[i])) && !skin.has(region.getScalar(near[i]));
    for (let s = 0; s < D.P.length; s++) {
      if (seen[s] || keep[s] || one[s] !== s || !trunk(s)) continue;
      const lot = [s];
      seen[s] = 1;
      let open = false;
      for (let h = 0; h < lot.length && lot.length < 400; h++) for (const j of next[lot[h]]) if (!seen[j] && !keep[j]) (trunk(j) ? ((seen[j] = 1), lot.push(j)) : (open = true));
      if (lot.length < 400 && !open) for (const p of lot) keep[p] = true;
    }
    keep = keep.map((k, i) => keep[one[i]]);
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
    // (the cut runs along the triangles, a saw's edge: each of its points is drawn halfway to the middle of its two
    // neighbours along it, three times, as it is made and as it rests alike)
    {
      const along = new Map();
      for (const [k, n] of edges) {
        if (n !== 1 || !(was.get(k) > 1)) continue;
        const [a, b] = k.split(',').map(Number);
        (along.get(a) ?? along.set(a, []).get(a)).push(b);
        (along.get(b) ?? along.set(b, []).get(b)).push(a);
      }
      const pos = D.prim.getAttribute('POSITION'), same = new Map();
      one.forEach((o, i) => (same.get(o) ?? same.set(o, []).get(o)).push(i));
      for (let r = 0; r < 3; r++) {
        const move = [];
        for (const [p, ns] of along) {
          if (ns.length !== 2) continue;
          const [a, b] = ns, made = pos.getElement(p, []), ma = pos.getElement(a, []), mb = pos.getElement(b, []);
          move.push([p, made.map((v, c) => v * 0.5 + (ma[c] + mb[c]) * 0.25), D.P[p].clone().multiplyScalar(0.5).addScaledVector(D.P[a], 0.25).addScaledVector(D.P[b], 0.25)]);
        }
        for (const [p, m, rest] of move) for (const i of same.get(p)) (pos.setElement(i, m), D.P[i].copy(rest));
      }
    }
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
    const shade = process.env.NOHEM ? [1, 1] : [0.8, 0.92], col = new Float32Array(uv.getCount() * 3).fill(1);
    for (let i = 0; i < uv.getCount(); i++) {
      const d = depth(i);
      if (d < shade.length) col.fill(shade[d], i * 3, i * 3 + 3);
    }
    D.prim.setAttribute('COLOR_0', dressed.doc.createAccessor().setType('VEC3').setArray(col));
  }
  // ---- which part of the body each of its points lies over (REGION): what is worn over it draws it in there (a
  // jacket's chest under a vest: Worn.under in src/game/survivors.ts)
  D.prim.setAttribute('_REGION', dressed.doc.createAccessor().setType('SCALAR').setArray(new Uint8Array(near.map((n) => (n >= 0 ? region.getScalar(n) : 0)))));
  // ---- each point's height over the ankle's joint nearest it (the body's own units): a trouser leg's (`_HEM`) goes in
  // below the top of what is worn on the foot with it, and a boot says how high its shaft comes (its material's `top`;
  // src/game/survivors.ts Worn.tuck). Tucked by the parts of the body under it, a hem went in in a sawtooth, torn along
  // it, and a boot's shaft drawn in under the trouser leg opened into strips as the ankle bent (the owner, 2026-10-26:
  // "the player models' feet do not look right where the legs meet the shoes"): now a trouser leg goes smoothly into the
  // shoe or the boot, as trousers are worn in boots
  let top = null;
  if (piece.parts.includes('shin')) {
    const feet = ['foot_l', 'foot_r'].map((n) => at(M4(body.node.getSkin().listJoints().find((j) => j.getName() === n).getWorldMatrix())));
    const over = D.P.map((p) => p.y - feet.reduce((m, f) => (Math.hypot(f.x - p.x, f.z - p.z) < Math.hypot(m.x - p.x, m.z - p.z) ? f : m)).y);
    if (piece.parts.includes('thigh')) D.prim.setAttribute('_HEM', dressed.doc.createAccessor().setType('SCALAR').setArray(new Float32Array(over)));
    else {
      // (a boot's top: as high as nine in ten of its points over the ankle that are kept)
      const kept = [...new Set(tris.flat())].map((i) => over[i]).sort((a, b) => a - b);
      top = +kept[Math.floor(kept.length * 0.9)].toFixed(4);
    }
  }
  // ---- the picture padded from the piece's own cloth: what lies between its islands on the picture was the body's
  // (skin, the shirt), and came in at every island's edge as pink and light slivers, nearer at a distance as the
  // picture is drawn smaller. Everything of the picture the piece does not cover takes the colour of the nearest cloth.
  await padTexture(D.prim, tris);
  const plain = piece.plain ? await plainCloth(D.prim, own, piece.plain === true ? undefined : piece.plain) : '';

  // ---- weighted as the skin under it is (the owner, 2026-10-25: "the player models are super buggy especially during
  // animations ... our previous player model was better with no stretching textures or distortions"). Meshy rigged the
  // dressed figure on its own: a sleeve weighted to the chest hung off a raised arm like a wing, and a shirt's back
  // stood off a bent spine. Each point takes the weights of the body's points nearest it (the body it was made on, by
  // distance), evened out over the cloth twice, so the cloth goes wherever the skin under it goes.
  {
    const bp = body.node.getMesh().listPrimitives()[0], bj = bp.getAttribute('JOINTS_0'), bw = bp.getAttribute('WEIGHTS_0');
    const names = dressed.node.getSkin().listJoints().map((j) => j.getName());
    const to = body.node.getSkin().listJoints().map((j) => names.indexOf(j.getName()));
    if (to.some((k) => k < 0)) throw new Error(`${id}: the body has a joint the piece has not`);
    const K = 6, ja = [], wa = [];
    /** the body's points nearest p, K of them, nearest first */
    const nearK = (p) => {
      const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), cz = Math.floor(p.z / CELL), got = [];
      for (let r = 1; r <= 5 && got.length < K; r++) {
        got.length = 0;
        for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) for (const i of grid.get(`${x},${y},${z}`) ?? []) got.push([i, B.P[i].distanceTo(p)]);
      }
      return got.sort((a, b) => a[1] - b[1]).slice(0, K);
    };
    const mine = [...new Set(tris.flat().map((i) => one[i]))], W = new Map();
    for (const i of mine) {
      const w = new Map();
      for (const [n, d] of nearK(D.P[i])) {
        const k = 1 / (d + 0.005) ** 2;
        bj.getElement(n, ja), bw.getElement(n, wa);
        for (let c = 0; c < 4; c++) if (wa[c] > 0) w.set(to[ja[c]], (w.get(to[ja[c]]) ?? 0) + wa[c] * k);
      }
      W.set(i, w);
    }
    // (a boot evened more: its shaft and its foot bent apart at the ankle and the leather between folded over itself, in dark
    // slashes, when the foot was pointed back crouching, the owner, 2026-10-26: "crouch walk animatiosn the anlkles are fucked")
    for (let pass = 0; pass < (piece.even ?? 2); pass++) {
      const was = new Map(W);
      for (const i of mine) {
        const ns = [...next[i]].filter((j) => was.has(j));
        if (!ns.length) continue;
        const w = new Map();
        const put = (m, f) => {
          const sum = [...m.values()].reduce((a, b) => a + b, 0) || 1;
          for (const [j, v] of m) w.set(j, (w.get(j) ?? 0) + (v / sum) * f);
        };
        put(was.get(i), 0.5);
        for (const j of ns) put(was.get(j), 0.5 / ns.length);
        W.set(i, w);
      }
    }
    const n = D.P.length, J = new Uint16Array(n * 4), V = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const w = W.get(one[i]);
      if (!w) continue;
      const top = [...w].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((a, [, v]) => a + v, 0) || 1;
      top.forEach(([j, v], c) => ((J[i * 4 + c] = j), (V[i * 4 + c] = v / sum)));
    }
    D.prim.setAttribute('JOINTS_0', dressed.doc.createAccessor().setType('VEC4').setArray(J));
    D.prim.setAttribute('WEIGHTS_0', dressed.doc.createAccessor().setType('VEC4').setArray(V));
  }

  // ---- every triangle wound as its points face (Meshy turned a few dozen of them inside out: drawn from both sides, the
  // cloth lit them as its own inside, a grey patch on a T-shirt's back and grey teeth at its sleeves)
  // (each triangle wound as its neighbours are, across every edge they share; each piece of cloth so wound turned to
  // face away from the body by the vote of all its triangles; and the normals made again from them. Meshy's own
  // normals pointed in under a work jacket's hem, and the cloth there shone white, 2026-10-25.)
  {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), out = new THREE.Vector3(), e = [];
    const edges = new Map();
    tris.forEach((t, k) => {
      for (let s = 0; s < 3; s++) {
        const u = one[t[s]], v = one[t[(s + 1) % 3]], key = u < v ? `${u},${v}` : `${v},${u}`;
        (edges.get(key) ?? edges.set(key, []).get(key)).push(k);
      }
    });
    const runs = (t, u, v) => t.some((x, s) => one[x] === u && one[t[(s + 1) % 3]] === v);
    const done = new Uint8Array(tris.length);
    let turned = 0;
    for (let seed = 0; seed < tris.length; seed++) {
      if (done[seed]) continue;
      const lot = [seed];
      done[seed] = 1;
      for (let h = 0; h < lot.length; h++) {
        const t = tris[lot[h]];
        for (let s = 0; s < 3; s++) {
          const u = one[t[s]], v = one[t[(s + 1) % 3]];
          for (const k of edges.get(u < v ? `${u},${v}` : `${v},${u}`)) {
            if (done[k]) continue;
            // (a neighbour wound the same way runs the shared edge the other way)
            if (runs(tris[k], u, v)) tris[k] = [tris[k][0], tris[k][2], tris[k][1]];
            done[k] = 1;
            lot.push(k);
          }
        }
      }
      let vote = 0;
      for (const k of lot) {
        const t = tris[k];
        a.copy(D.P[t[0]]);
        b.copy(D.P[t[1]]).sub(a);
        c.copy(D.P[t[2]]).sub(a);
        out.set(0, 0, 0);
        for (const i of t) if (near[i] >= 0) out.add(D.P[i]).sub(B.P[near[i]]);
        vote += Math.sign(b.cross(c).dot(out));
      }
      if (vote < 0) for (const k of lot) (tris[k] = [tris[k][0], tris[k][2], tris[k][1]]), turned++;
    }
    why.turned = turned;
    const pos = D.prim.getAttribute('POSITION'), sum = new Float64Array(D.P.length * 3);
    for (const t of tris) {
      a.fromArray(pos.getElement(t[0], e));
      b.fromArray(pos.getElement(t[1], e)).sub(a);
      c.fromArray(pos.getElement(t[2], e)).sub(a);
      b.cross(c);
      for (const i of t) for (let k = 0; k < 3; k++) sum[one[i] * 3 + k] += b.getComponent(k);
    }
    const N = new Float32Array(D.P.length * 3);
    for (let i = 0; i < D.P.length; i++) {
      const o = one[i] * 3, l = Math.hypot(sum[o], sum[o + 1], sum[o + 2]) || 1;
      for (let k = 0; k < 3; k++) N[i * 3 + k] = sum[o + k] / l;
    }
    D.prim.setAttribute('NORMAL', dressed.doc.createAccessor().setType('VEC3').setArray(N));
    D.prim.setAttribute('TANGENT', null);
  }

  // ---- how far it stands off the body over the chest and over the waist, front, back and each side, metres (at rest,
  // the body facing +z): what is hung over it is hung that much further out (hangFit in src/game/avatar/gear.ts). A
  // flannel shirt swallowed a chest rig hung at the skin, 2026-10-25 (the owner: "my body equipment and armor is
  // clipping through my body").
  let bulk = null;
  {
    const sk = body.node.getSkin().listJoints(), y = (n) => new THREE.Vector3().setFromMatrixPosition(M4(sk.find((j) => j.getName() === n).getWorldMatrix())).y;
    const mine = [...new Set(tris.flat())].map((i) => D.P[i]);
    const band = (h, pts) => pts.filter((p) => Math.abs(p.y - h) < 0.04 && Math.abs(p.x) < 0.21);
    const measure = (h, under) => {
      const g = band(h, mine), b = band(h, B.P.filter((p, n) => under(region.getScalar(n))));
      if (g.length < 20 || b.length < 20) return null;
      const G = new THREE.Box3().setFromPoints(g), S = new THREE.Box3().setFromPoints(b);
      return [G.max.z - S.max.z, S.min.z - G.min.z, (G.max.x - G.min.x - (S.max.x - S.min.x)) / 2].map((v) => +Math.max(0, v).toFixed(4));
    };
    // (the chest's skin at the chest; at the waist, all but the arms that hang there)
    const arms = [REGION.shoulder, REGION.upperArm, REGION.forearm, REGION.hand];
    const chest = measure(y('spine_03'), (r) => r === REGION.chest), waist = measure(y('pelvis'), (r) => !arms.includes(r));
    if (chest || waist) bulk = { ...(chest ? { chest } : {}), ...(waist ? { waist } : {}) };
  }

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
  // (a glove's hand all of its own colour: at the place on its picture of the point most like the colour it is, see own)
  if (piece.hands) {
    let at = 0, near = Infinity;
    for (const [i, j] of used) {
      const c = D.C[i], d = Math.hypot(c[0] - own[0], c[1] - own[1], c[2] - own[2]);
      if (d < near) (near = d), (at = j);
    }
    const flat = D.prim.getAttribute('TEXCOORD_0').getElement(at, []);
    console.log(`  ${plainHands(dressed.node, PLAIN, { ...piece.hands, flat })}`);
  }
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
    mat.setExtras({ light: +(sum / uv.getCount() / 255).toFixed(4), ...(bulk ? { bulk } : {}), ...(top !== null ? { top } : {}) });
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
  console.log(`${id}.glb  ${(st.size / 1048576).toFixed(2)} MB  ${tris.length} triangles of ${T.length}, ${used.size} points, light ${mat.getExtras().light}${bulk ? `, off the body ${JSON.stringify(bulk)}` : ''}${plain ? `, ${plain}` : ''}`);
}
