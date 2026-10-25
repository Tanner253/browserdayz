// Builds the survivors' bodies: public/assets/characters/body_{0..3}.glb, one for each survivor a player can be.
//
//   node scripts/survivors.mjs          all of them
//   node scripts/survivors.mjs 2        only body_2
//
// The owner, 2026-10-24: "we should make a higher quality player model and perhaps even variations"; and of the
// clothes the first ones wore: "those clothes items should be items we bring into the game". So each body is a
// survivor in a plain base layer (T-shirt and shorts, barefoot), and everything over it is a thing worn.
//
// Sources (assets-src/incoming/higgsfield/survivors/, gitignored): made in Higgsfield on 2026-10-25 from four faces
// drawn there, each edited down to the base layer with its hands open and its fingers spread, drawn again from behind,
// and made 3D by Meshy (multi-image, A-pose, rigged, 20k triangles). Meshy rigs a body on 24 bones and none in the
// hands, and every movement the game has is drawn for its own 65, fingers and all. So:
//
//   1. Its paint is made plain (evenOut), and the fingers are found on each hand and bound (fitHand), each finger's
//      first joint where the game's skeleton has it (rooted).
//   2. The body is carried onto the game's skeleton as the tactical suit is (scripts/suit.mjs, wearSuit): the
//      skeleton's limbs turned to lie along the body's, every point carried with the joints it hangs on, and bound
//      there. It keeps the game's skeleton, not its own: every clip, every gun grip and every hat in GEAR is made
//      for that one, so all four are that size (the woman too: her own build, the skeleton's height).
//
// What is written is the body alone, on the skeleton (no clips): the game puts it on a survivor's own bones by
// their names (src/game/survivors.ts).

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, unpartition, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { wearSuit, ours as suitName } from './suit.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
// (assets-src lives in the main checkout only: a session's worktree reads it from there)
const SRC_ROOT = existsSync(path.join(ROOT, 'assets-src')) ? path.join(ROOT, 'assets-src') : path.resolve(ROOT, '..', '..', '..', 'assets-src');
const SRC = path.join(SRC_ROOT, 'incoming', 'higgsfield', 'survivors');
const TEMPLATE = path.join(SRC_ROOT, 'characters', 'plain.glb');
const OUT = path.join(ROOT, 'public', 'assets', 'characters');
/** a colour or normal map at most this across (the owner's cap); what is only roughness, half */
const TEX = 2048;
const TEX_ROUGH = 1024;

/** the bodies, by the number a player picks */
const BODIES = ['body0_rigged.glb', 'body1_rigged.glb', 'body2_rigged.glb', 'body3_rigged.glb'];
const ONLY = process.argv.slice(2).map(Number);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const M4 = (a) => new THREE.Matrix4().fromArray(a);
const at = (m) => new THREE.Vector3().setFromMatrixPosition(m);

/** Meshy's bones by Mixamo's names, where they are not the same (its spine is numbered the other way up) */
const MIXAMO = { Spine02: 'Spine', Spine01: 'Spine1', Spine: 'Spine2', neck: 'Neck', head_end: 'HeadTop_End', headfront: 'HeadFront' };
const DIGITS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

/** how far from the wrist each finger's knuckle is, as a share of the hand's length to the longest fingertip */
const KNUCKLE = { index: 0.56, middle: 0.57, ring: 0.55, pinky: 0.51 };
/** where along a finger, knuckle (0) to tip (1), its middle and last joints are */
const MIDDLE = 0.45, LAST = 0.74;
const smooth = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);
/** how far a point is from the segment a..b, and how far along it, 0..1 (not held to that) */
function onSegment(p, a, b) {
  const ab = b.clone().sub(a), t = p.clone().sub(a).dot(ab) / Math.max(1e-12, ab.lengthSq());
  return { t, off: a.clone().addScaledVector(ab, THREE.MathUtils.clamp(t, 0, 1)).distanceTo(p) };
}

/**
 * Where the thumb and each finger begin: where the game's skeleton has them, once its hand is turned to lie as this
 * one does. wearSuit carries a point with the joint it hangs on, from where that joint is on the body to where it is
 * on the skeleton, and the skeleton keeps its own hand: the first joint of a thumb found two centimetres from where the
 * skeleton's is, and the thumb was carried two centimetres off the palm, torn from it. (The infected's statues began
 * their thumbs where the cop's skeleton does, for this.) Only the joints after the first follow the body's own fingers.
 * @param J the joints found, as the body stands, by name (changed in place)
 * @param ours the skeleton's joints at rest by name, and how much bigger it is than the body
 */
function rooted(J, ours, side) {
  const R = (n) => ours.rest.get(`${n}${side}`);
  const frame = (d, a) => {
    const x = d.clone().normalize(), y = a.clone().addScaledVector(x, -a.dot(x)).normalize();
    return new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y));
  };
  // (the hand's turn: as wearSuit turns it, along the middle finger and then about it to the line of the knuckles)
  const turn = frame(J.middle_01.clone().sub(J.hand), J.index_01.clone().sub(J.pinky_01)).multiply(frame(R('middle_01').clone().sub(R('hand')), R('index_01').clone().sub(R('pinky_01'))).invert());
  for (const r of ['thumb_01', 'index_01', 'middle_01', 'ring_01', 'pinky_01']) J[r] = R(r).clone().sub(R('hand')).applyMatrix4(turn).divideScalar(ours.scale).add(J.hand);
}

/**
 * One hand's fingers: where their joints are, and what each point of the hand hangs on (W, changed in place).
 *
 * Meshy draws a hand with its fingers joined at their roots, however far apart they were drawn: past the knuckles a
 * finger is a piece of its own for only its last half or two thirds. So nothing is measured from where they part.
 * The hand is laid along +x from its wrist. The thumb is the first thing to part from it going out along it. Past the
 * thumb's tip, what is left is the four fingers, apart or not, side by side: they are told apart by how far across
 * the hand each point is (four groups along the way they spread most, the first finger at the thumb's end). Each
 * finger is the line from where its group begins to its tip, and its knuckle is on that line where a hand's knuckles
 * are (KNUCKLE), until `rooted` moves it to the skeleton's. Every point of the hand then hangs on the bones of the
 * fingers it is beside, more the further out it is, and the rest of it on the hand.
 * @param J a bone's number by its name on this side ('hand', 'index_01', ...)
 * @returns the joints' places as the body stands, by name; and what was found, for the build's line
 */
function fitHand({ P, I, W, mine, u, wrist, elbow, sg, J, ours }) {
  // ---- laid out along +x (the right hand mirrored), the wrist at nought
  const along = new THREE.Quaternion().setFromUnitVectors(wrist.clone().sub(elbow).normalize(), new THREE.Vector3(sg, 0, 0));
  const lay = (p, q) => {
    const v = p.clone().sub(wrist).applyQuaternion(q);
    return v.setX(sg * v.x);
  };
  let Q = P.map((p, i) => (mine[i] ? lay(p, along) : null));
  const hand = Q.map((q) => !!q && q.x > -2 * u);
  // the surface, one number for all the points at one place (it is cut along the seams of its picture), and which are joined
  const key = new Map(), one = new Int32Array(P.length).fill(-1);
  Q.forEach((q, i) => {
    if (!hand[i]) return;
    const k = `${Math.round((P[i].x / u) * 400)},${Math.round((P[i].y / u) * 400)},${Math.round((P[i].z / u) * 400)}`;
    if (!key.has(k)) key.set(k, i);
    one[i] = key.get(k);
  });
  const next = new Map();
  for (let t = 0; t < I.length; t += 3) {
    const v = [one[I[t]], one[I[t + 1]], one[I[t + 2]]];
    if (v.some((x) => x < 0)) continue;
    for (let e = 0; e < 3; e++) {
      if (!next.has(v[e])) next.set(v[e], new Set());
      next.get(v[e]).add(v[(e + 1) % 3]).add(v[(e + 2) % 3]);
    }
  }
  const ids = [...next.keys()];
  const pieces = (keep) => {
    const seen = new Set(), out = [];
    for (const i of ids) {
      if (seen.has(i) || !keep(i)) continue;
      const piece = [i];
      seen.add(i);
      for (let h = 0; h < piece.length; h++) for (const j of next.get(piece[h])) if (!seen.has(j) && keep(j)) seen.add(j), piece.push(j);
      out.push(piece);
    }
    return out.filter((c) => c.length >= 8).sort((a, b) => b.length - a.length);
  };
  const tipX = () => Math.max(...ids.map((i) => Q[i].x));
  // ---- the thumb: the first thing to part from it, going out along it
  let len = tipX(), thumb = null, cut = 0;
  for (let c = 0.15; c < 0.7 && !thumb; c += 0.01) {
    const parts = pieces((i) => Q[i].x > c * len);
    if (parts.length >= 2) [thumb, cut] = [parts[1], c * len];
  }
  if (!thumb) throw new Error(`survivors: no thumb parts from the ${sg > 0 ? 'left' : 'right'} hand`);
  const mid = (list) => list.reduce((s, i) => s.add(Q[i]), new THREE.Vector3()).divideScalar(list.length);
  const thumbIds = new Set(thumb);
  const thumbBase = mid(thumb.filter((i) => Q[i].x < cut + 1.2 * u));
  const thumbTip = Q[thumb.reduce((m, i) => (Q[i].distanceToSquared(thumbBase) > Q[m].distanceToSquared(thumbBase) ? i : m), thumb[0])];
  const ta = thumbTip.clone().sub(thumbBase).normalize(), tl = thumbTip.distanceTo(thumbBase);
  const T = [thumbBase.clone().multiplyScalar(0.4), thumbBase.clone().addScaledVector(ta, -0.15 * tl), thumbBase.clone().addScaledVector(ta, 0.45 * tl), thumbTip.clone()];

  // ---- the fingers: what is left past the thumb's tip, in four across the hand
  const from = Math.max(thumbTip.x + 0.5 * u, 0.62 * len);
  const F = ids.filter((i) => Q[i].x > from && !thumbIds.has(i));
  // which way across the hand they lie side by side: the way their points spread most, square to the hand (Meshy's thumb
  // stands out in front of the palm, not beside it, so the thumb does not say), with the first finger at the thumb's end
  let yy = 0, yz = 0, zz = 0;
  const c = mid(F);
  for (const i of F) {
    const dy = Q[i].y - c.y, dz = Q[i].z - c.z;
    (yy += dy * dy), (yz += dy * dz), (zz += dz * dz);
  }
  const angle = 0.5 * Math.atan2(2 * yz, yy - zz);
  const across = new THREE.Vector3(0, Math.cos(angle), Math.sin(angle));
  if (thumbBase.clone().sub(c).dot(across) < 0) across.negate();
  const S = (i) => Q[i].dot(across);
  const zs = F.map(S).sort((a, b) => a - b);
  let centres = [1, 3, 5, 7].map((k) => zs[Math.floor((zs.length * k) / 8)]);
  const group = (z) => centres.reduce((b, c, k) => (Math.abs(z - c) < Math.abs(z - centres[b]) ? k : b), 0);
  for (let n = 0; n < 12; n++) {
    const sum = [0, 0, 0, 0], cnt = [0, 0, 0, 0];
    for (const i of F) (sum[group(S(i))] += S(i)), cnt[group(S(i))]++;
    centres = centres.map((c, k) => (cnt[k] ? sum[k] / cnt[k] : c));
  }
  let groupOf = (i) => group(S(i));
  // (a group left with next to nothing: the four are taken as four equal shares across the hand instead)
  if ([0, 1, 2, 3].some((k) => F.filter((i) => groupOf(i) === k).length < 5)) {
    const rank = new Map([...F].sort((x, y) => S(x) - S(y)).map((i, r) => [i, Math.min(3, Math.floor((r * 4) / F.length))]));
    groupOf = (i) => rank.get(i);
    centres = [0, 1, 2, 3];
  }
  const NAMES = ['index', 'middle', 'ring', 'pinky'];
  const order = [0, 1, 2, 3].sort((a, b) => centres[b] - centres[a]);
  const fingers = order.map((k, n) => {
    const own = F.filter((i) => groupOf(i) === k);
    const tip = Q[own.reduce((m, i) => (Q[i].x > Q[m].x ? i : m), own[0])].clone();
    // (where it begins: the nearest quarter of its points to the wrist)
    const root = mid([...own].sort((x, y) => Q[x].x - Q[y].x).slice(0, Math.max(3, Math.ceil(own.length / 4))));
    const a = tip.clone().sub(root).normalize();
    const knuckle = tip.clone().addScaledVector(a, -(tip.x - KNUCKLE[NAMES[n]] * len) / Math.max(0.2, a.x));
    const span = tip.distanceTo(knuckle);
    if (!(span >= 4 * u && span <= 12.5 * u)) throw new Error(`survivors: ${NAMES[n]} finger ${(span / u).toFixed(1)} cm long`);
    const J4 = [knuckle, knuckle.clone().lerp(tip, MIDDLE), knuckle.clone().lerp(tip, LAST), tip];
    return { name: NAMES[n], own: new Set(own), J4, bones: [1, 2, 3].map((j) => J(`${NAMES[n]}_0${j}`)) };
  });

  // ---- where each of them begins: where the game's skeleton has it (see `rooted`)
  const back = along.clone().invert();
  const home = (v) => v.clone().setX(sg * v.x).applyQuaternion(back).add(wrist);
  {
    const world = { hand: wrist.clone() };
    T.forEach((v, k) => (world[`thumb_0${k + 1}`] = home(v)));
    for (const f of fingers) f.J4.forEach((v, k) => (world[`${f.name}_0${k + 1}`] = home(v)));
    rooted(world, ours, sg > 0 ? '_l' : '_r');
    T[0] = lay(world.thumb_01, along);
    for (const f of fingers) f.J4[0] = lay(world[`${f.name}_01`], along);
  }

  // ---- what each point of the hand hangs on
  const thin = Math.max(u, [...thumb].reduce((s, i) => s + onSegment(Q[i], T[1], T[3]).off, 0) / thumb.length);
  const share = (q, i) => {
    const D = new Map();
    const add = (j, v) => v > 1e-4 && D.set(j, (D.get(j) ?? 0) + v);
    const mineF = fingers.findIndex((f) => f.own.has(i));
    // (the thumb hangs on the hand, as it was drawn: the game's skeleton begins its thumb a few centimetres from where
    // Meshy's stands out from the palm, and every way of hanging it on those bones tore it from the palm as it bent)
    if (!(thumbIds.has(i) && q.x > cut)) {
      const near = fingers.map((f) => 1 / (onSegment(q, f.J4[0], f.J4[3]).off ** 2 + (0.2 * u) ** 2));
      const all = near.reduce((a, b) => a + b, 0);
      fingers.forEach((f, n) => {
        const t = onSegment(q, f.J4[0], f.J4[3]).t;
        let m = near[n] / all;
        if (mineF >= 0) m = THREE.MathUtils.lerp(m, n === mineF ? 1 : 0, smooth(t, 0, 0.3));
        const w = m * smooth(t, -0.22, 0.04), w2 = smooth(t, MIDDLE - 0.07, MIDDLE + 0.07), w3 = smooth(t, LAST - 0.07, LAST + 0.07);
        add(f.bones[0], w * (1 - w2));
        add(f.bones[1], w * w2 * (1 - w3));
        add(f.bones[2], w * w2 * w3);
      });
    }
    const sum = [...D.values()].reduce((a, b) => a + b, 0);
    if (sum > 1) for (const [j, v] of D) D.set(j, v / sum);
    else add(J('hand'), 1 - sum);
    return D;
  };
  Q.forEach((q, i) => {
    if (!q || q.x < -4 * u) return;
    const h = smooth(q.x, -1.3 * u, 1.3 * u), sure = smooth(q.x, -4 * u, -2.2 * u);
    const out = new Map();
    for (const [j, v] of W[i]) out.set(j, v * (1 - sure));
    out.set(J('lowerarm'), (out.get(J('lowerarm')) ?? 0) + (1 - h) * sure);
    if (h > 0) for (const [j, v] of share(q, i)) out.set(j, (out.get(j) ?? 0) + v * h * sure);
    W[i] = out;
  });

  // ---- the joints, as the body stands
  const joints = {};
  T.forEach((v, k) => (joints[`thumb_0${k + 1}${k === 3 ? '_leaf' : ''}`] = home(v)));
  for (const f of fingers) f.J4.forEach((v, k) => (joints[`${f.name}_0${k + 1}${k === 3 ? '_leaf' : ''}`] = home(v)));
  const cm = (v) => (v / u).toFixed(1);
  return { joints, told: `hand ${cm(len)} cm, thumb ${cm(tl)} cm parting at ${cm(cut)}, fingers ${fingers.map((f) => cm(f.J4[0].distanceTo(f.J4[3]))).join(' ')} cm (${fingers.map((f) => f.own.size).join('/')} points past ${cm(from)})` };
}

/**
 * What Meshy paints a body with, made plain. Its picture is baked in a few hundred small islands, and each island came
 * with a roughness of its own and normals of its own along its edges: lit, the skin and the shirt were a patchwork
 * of shards. So the roughness is one for all of it, the normals are made one across the seams of the picture (the
 * normal map, baked against the old ones, goes with them), and the glow map (black, under a full glow) and any metal go.
 */
function evenOut(doc) {
  for (const m of doc.getRoot().listMaterials()) {
    m.setMetallicRoughnessTexture(null).setEmissiveTexture(null).setNormalTexture(null).setOcclusionTexture(null);
    m.setEmissiveFactor([0, 0, 0]).setMetallicFactor(0).setRoughnessFactor(0.75);
  }
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION'), idx = p.getIndices(), n = pos.getCount();
      const key = new Map(), one = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const k = pos.getElement(i, []).map((x) => Math.round(x * 20000)).join(',');
        if (!key.has(k)) key.set(k, i);
        one[i] = key.get(k);
      }
      // (each triangle's share by its area: its cross product unscaled)
      const sum = new Float64Array(n * 3), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (let t = 0; t < idx.getCount(); t += 3) {
        const v = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)];
        A.fromArray(pos.getElement(v[0], []));
        B.fromArray(pos.getElement(v[1], [])).sub(A);
        C.fromArray(pos.getElement(v[2], [])).sub(A);
        B.cross(C);
        for (const i of v) for (let k = 0; k < 3; k++) sum[one[i] * 3 + k] += B.getComponent(k);
      }
      const N = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const o = one[i] * 3, l = Math.hypot(sum[o], sum[o + 1], sum[o + 2]) || 1;
        for (let k = 0; k < 3; k++) N[i * 3 + k] = sum[o + k] / l;
      }
      p.getAttribute('NORMAL').setArray(N);
      p.setAttribute('TANGENT', null);
    }
  }
}

/**
 * A Meshy body with fingers: its bones renamed as Mixamo's (as wearSuit reads them, with no prefix), a finger's four
 * joints added under each hand where fitHand finds them, and every point of each hand hung on them.
 * @returns what was found, for the build's line
 */
function giveFingers(doc, ours) {
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices();
  const bind = joints.map((_, k) => M4(ibm.getElement(k, [])).invert());
  for (const j of joints) j.setName(`${MIXAMO[j.getName()] ?? j.getName()}_0`);
  // the new joints, numbered after Meshy's, each where a finger's bone might start until it is found
  const hands = { _l: joints.find((j) => j.getName() === 'LeftHand_0'), _r: joints.find((j) => j.getName() === 'RightHand_0') };
  const added = [];
  for (const [side, sg] of [['_l', 1], ['_r', -1]]) {
    const hand = hands[side], H = at(bind[joints.indexOf(hand)]);
    for (const d of DIGITS) {
      for (let k = 1; k <= 4; k++) {
        const node = doc.createNode(`${side === '_l' ? 'Left' : 'Right'}Hand${d}${k}_0`);
        hand.addChild(node);
        added.push({ node, at: H.clone().add(new THREE.Vector3(sg * 0.02 * k, 0, 0)) });
      }
    }
  }
  const all = [...joints, ...added.map((a) => a.node)];
  const binds = [...bind, ...added.map((a) => new THREE.Matrix4().setPosition(a.at))];
  const names = all.map((j) => suitName(j.getName(), ''));

  // ---- the shape: its points, triangles, and what each point hangs on (bone -> share)
  const node = root.listNodes().find((n) => n.getMesh() && n.getSkin());
  const prim = node.getMesh().listPrimitives()[0];
  const pos = prim.getAttribute('POSITION'), ji = prim.getAttribute('JOINTS_0'), jw = prim.getAttribute('WEIGHTS_0'), idx = prim.getIndices();
  const P = [], W = [], I = [];
  for (let i = 0; i < pos.getCount(); i++) {
    P.push(new THREE.Vector3().fromArray(pos.getElement(i, [])));
    const a = ji.getElement(i, []), w = jw.getElement(i, []), m = new Map();
    for (let c = 0; c < 4; c++) if (w[c] > 0) m.set(a[c], (m.get(a[c]) ?? 0) + w[c]);
    W.push(m);
  }
  for (let i = 0; i < idx.getCount(); i++) I.push(idx.getScalar(i));
  let top = -Infinity, floor = Infinity;
  for (const p of P) (top = Math.max(top, p.y)), (floor = Math.min(floor, p.y));
  const u = (top - floor) / 180;

  // ---- each hand, its fingers found and bound
  const told = [];
  for (const [side, sg] of [['_l', 1], ['_r', -1]]) {
    const wrist = at(binds[names.indexOf(`hand${side}`)]), elbow = at(binds[names.indexOf(`lowerarm${side}`)]);
    // (only the forearm and the hand: the thigh the hand hangs beside is not looked at)
    const J = (n) => names.indexOf(`${n}${side}`);
    const mine = W.map((m) => (m.get(J('hand')) ?? 0) + (m.get(J('lowerarm')) ?? 0) > 0.5);
    const { joints: at_, told: t } = fitHand({ P, I, W, mine, u, wrist, elbow, sg, J, ours: { rest: ours.rest, scale: ours.height / (at(binds[names.indexOf('Head')]).y - at(binds[names.indexOf('foot_l')]).y) } });
    told.push(`${side === '_l' ? 'left' : 'right'}: ${t}`);
    for (const [name, p] of Object.entries(at_)) binds[J(name)] = new THREE.Matrix4().setPosition(p);
  }

  // ---- written back: the new joints' places, and what every point hangs on
  const inv = new Float32Array(all.length * 16);
  binds.forEach((b, k) => inv.set(b.clone().invert().elements, k * 16));
  for (const a of added) skin.addJoint(a.node);
  added.forEach((a, k) => {
    const parent = at(binds[joints.indexOf(a.node.getParentNode())]);
    a.node.setTranslation(at(binds[joints.length + k]).sub(parent).toArray());
  });
  skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(inv));
  const JI = new Uint8Array(P.length * 4), JW = new Float32Array(P.length * 4);
  W.forEach((m, i) => {
    const four = [...m].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = four.reduce((s, x) => s + x[1], 0);
    four.forEach(([j, w], c) => {
      JI[i * 4 + c] = j;
      JW[i * 4 + c] = w / sum;
    });
  });
  prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(JI));
  prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(JW));
  node.getMesh().setName('survivor');
  for (const a of root.listAnimations()) {
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }
  return told.join('; ');
}

await fs.access(TEMPLATE).catch(() => {
  throw new Error('survivors: run "node scripts/build-character.mjs --infected" first (it makes assets-src/characters/plain.glb)');
});
for (const [n, file] of BODIES.entries()) {
  if (ONLY.length && !ONLY.includes(n)) continue;
  const suit = await io.read(path.join(SRC, file));
  const doc = await io.read(TEMPLATE);
  const root = doc.getRoot();
  const nodes = new Map(root.listNodes().map((x) => [x.getName(), x]));
  // the skeleton the body goes on, as it rests: its joints, and how tall it is from the foot to the head joint (as wearSuit measures)
  const rest = new Map(nodes.get('body').getSkin().listJoints().map((j) => [j.getName(), at(M4(j.getWorldMatrix()))]));
  const ours = { rest, height: rest.get('Head').y - rest.get('foot_l').y };
  evenOut(suit);
  const hands = giveFingers(suit, ours);
  const old = ['eyes', 'eyebrows', 'hair_buzzed', 'hair_parted', 'hair_long', 'hair_beard'].map((x) => nodes.get(x)).filter(Boolean);
  // (the toes lie as the foot lies: Meshy's toe bone has no end to lie along)
  const worn = await wearSuit({ doc, io, bodyNode: nodes.get('body'), old, suit, pieces: { survivor: [[/^survivor$/, null]] }, moved: {}, prefix: '', toes: false });
  // the body alone: no clips (the survivor's file has them), and no metal in skin and cotton
  for (const a of root.listAnimations()) {
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }
  for (const m of root.listMaterials()) m.setMetallicFactor(0).setName(`survivor_${n}`);
  await doc.transform(
    unpartition(),
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(baseColor|normal|emissive)Texture$/, resize: [TEX, TEX], quality: 90 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(metallicRoughness|occlusion)Texture$/, resize: [TEX_ROUGH, TEX_ROUGH], quality: 90 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const dest = path.join(OUT, `body_${n}.glb`);
  await io.write(dest, doc);
  const st = await fs.stat(dest);
  const triangles = root.listMeshes().reduce((k, m) => k + m.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  console.log(`${path.basename(dest)}  ${(st.size / 1048576).toFixed(2)} MB  ${Math.round(triangles)} triangles\n  hands: ${hands}\n  ${worn}`);
}
