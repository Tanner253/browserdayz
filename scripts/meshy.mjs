// What a body or a thing worn made by Meshy goes through to be on the game's skeleton (scripts/survivors.mjs, scripts/wear.mjs):
// its paint made plain, its bones named as Mixamo's, fingers found and bound, and the parts of a body marked.

import * as THREE from 'three';
import sharp from 'sharp';
import { ours as suitName, wearSuit } from './suit.mjs';

export const M4 = (a) => new THREE.Matrix4().fromArray(a);
export const at = (m) => new THREE.Vector3().setFromMatrixPosition(m);

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
export function evenOut(doc) {
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
export function giveFingers(doc, ours) {
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

/**
 * Which part of the body each point is (the `_REGION` attribute): what is worn over a part hides the skin there, so
 * that nothing pokes through (src/game/survivors.ts). The numbers are REGION's in src/sim/survivor.ts.
 * By the bone a point hangs on most, and for a limb how far down it, as the body is bound.
 * @returns how many points went to each, for the build's line
 */
export function markRegions(doc, node) {
  const skin = node.getSkin(), joints = skin.listJoints(), ibm = skin.getInverseBindMatrices();
  const J = new Map(joints.map((j, k) => [j.getName(), at(M4(ibm.getElement(k, [])).invert())]));
  const prim = node.getMesh().listPrimitives()[0];
  const pos = prim.getAttribute('POSITION'), ji = prim.getAttribute('JOINTS_0'), jw = prim.getAttribute('WEIGHTS_0');
  let top = -Infinity;
  for (let i = 0; i < pos.getCount(); i++) top = Math.max(top, pos.getElement(i, [])[1]);
  const head = J.get('Head');
  const along = (p, a, b) => {
    const A = J.get(a), ab = J.get(b).clone().sub(A);
    return p.clone().sub(A).dot(ab) / ab.lengthSq();
  };
  const R = new Uint8Array(pos.getCount()), count = new Array(14).fill(0);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.getCount(); i++) {
    p.fromArray(pos.getElement(i, []));
    const a = ji.getElement(i, []), w = jw.getElement(i, []);
    let lead = 0;
    for (let c = 1; c < 4; c++) if (w[c] > w[lead]) lead = c;
    const bone = joints[a[lead]].getName(), side = bone.match(/_[lr]$/)?.[0] ?? '', b = side ? bone.slice(0, -2) : bone;
    let r;
    // (the scalp: above the brow, and the back of the head down to the ears: what a cap covers)
    if (b === 'Head') r = p.y > head.y + 0.62 * (top - head.y) || (p.z < head.z - 0.04 && p.y > head.y + 0.35 * (top - head.y)) ? 0 : 1;
    else if (b === 'neck_01') r = 2;
    else if (/^(spine_0[23]|clavicle)$/.test(b)) r = 3;
    else if (b === 'spine_01') r = 4;
    else if (b === 'pelvis') r = 5;
    else if (b === 'upperarm') r = along(p, `upperarm${side}`, `lowerarm${side}`) < 0.5 ? 6 : 7;
    else if (b === 'lowerarm') r = 8;
    else if (b === 'thigh') r = along(p, `thigh${side}`, `calf${side}`) < 0.5 ? 10 : 11;
    else if (b === 'calf') r = 12;
    else if (b === 'foot' || b === 'ball') r = 13;
    else r = 9;
    R[i] = r;
    count[r]++;
  }
  prim.setAttribute('_REGION', doc.createAccessor().setType('SCALAR').setArray(R));
  return `regions ${count.join(' ')}`;
}

/**
 * A Meshy body's bones named as Mixamo's and its shape named for wearSuit, without fingers: for something worn, whose
 * hands are cut away (scripts/wear.mjs).
 */
export function plainBones(doc) {
  const root = doc.getRoot();
  for (const j of root.listSkins()[0].listJoints()) j.setName(`${MIXAMO[j.getName()] ?? j.getName()}_0`);
  root.listNodes().find((n) => n.getMesh() && n.getSkin()).getMesh().setName('survivor');
  for (const a of root.listAnimations()) {
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }
}

/**
 * A Meshy body or thing worn, carried onto the game's skeleton (scripts/suit.mjs, wearSuit) in a fresh copy of the
 * skeleton's file: its paint made plain, its fingers bound where it has them.
 * @param src the Meshy file, already read
 * @param fingers find and bind its fingers (a body); or not (a thing worn: its hands are cut away)
 * @returns the document, its one shape (`survivor`), and what was done, for the build's line
 */
/**
 * The game's skeleton given the body's own proportions (the owner, 2026-10-25: "The player models still dont look right
 * with stretched limbs and unrealistic proportions? We are not driving the survivor body from the skeleton bones which
 * are likely incomplete and inhuman are we?" We were: every body was stretched onto the old skeleton, its back 15% long,
 * its arms up to 16% short, its shoulders narrowed, and all four one height).
 *
 * Each bone is made as long as the body's own, along the way it already points (the clips turn bones; only the pelvis is
 * moved by them, and every pose is made for bones that point as these do). The legs are held to the game's length, the
 * whole body brought to that scale, so that the clips' hips stand the feet on the ground; the back, the neck, the
 * shoulders, the arms and the hips are the body's. The game puts the same lengths on a survivor's bones when the body is
 * put on (src/game/survivors.ts), and its clothes are bound to the body they were made on.
 * @param fit the Meshy rig whose joints say the proportions (the body itself, or for a piece, the body it was made on)
 */
function fitProportions(doc, fit) {
  const skin = doc.getRoot().listNodes().find((x) => x.getName() === 'body').getSkin(), joints = skin.listJoints();
  const node = new Map(joints.map((j) => [j.getName(), j]));
  const g = new Map(joints.map((j) => [j.getName(), at(M4(j.getWorldMatrix()))]));
  const fSkin = fit.getRoot().listSkins()[0], ibm = fSkin.getInverseBindMatrices(), m = new Map();
  fSkin.listJoints().forEach((j, k) => {
    const name = suitName(`${MIXAMO[j.getName()] ?? j.getName()}_0`, '');
    if (name) m.set(name, at(M4(ibm.getElement(k, [])).invert()));
  });
  const d = (P, a, b) => P.get(a).distanceTo(P.get(b));
  const leg = (P) => (d(P, 'thigh_l', 'calf_l') + d(P, 'calf_l', 'foot_l') + d(P, 'thigh_r', 'calf_r') + d(P, 'calf_r', 'foot_r')) / 2;
  const s = leg(g) / leg(m);
  const ratio = (a, b) => (s * d(m, a, b)) / d(g, a, b);
  const length = (name, k) => {
    const j = node.get(name);
    if (j) j.setTranslation(j.getTranslation().map((v) => v * k));
  };
  const said = {};
  const put = (names, k, label) => {
    for (const n of names) length(n, k);
    said[label] = +k.toFixed(3);
  };
  // The back by heights over the hip joints, not from the pelvis: Meshy's pelvis is a hand above its hip joints and
  // ours a little below them, and measured from it the back was read 15% short when it is 20% long (the game's
  // skeleton has a short trunk on long legs: carried onto it, every body's trunk was squashed by a fifth).
  const S = ratio('upperarm_l', 'upperarm_r');
  put(['clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r'], S, 'shoulders');
  const y = (P, n) => (n === 'hips' ? (P.get('thigh_l').y + P.get('thigh_r').y) / 2 : n === 'shoulders' ? (P.get('upperarm_l').y + P.get('upperarm_r').y) / 2 : P.get(n).y);
  const over = (P, n, k = 1) => (y(P, n) - y(P, 'hips')) * k;
  const lift = over(g, 'shoulders') - over(g, 'spine_03');
  const kBack = (over(m, 'shoulders', s) - lift * S + (y(g, 'hips') - y(g, 'pelvis'))) / (y(g, 'spine_03') - y(g, 'pelvis'));
  put(['spine_01', 'spine_02', 'spine_03'], kBack, 'back');
  const sp3 = kBack * (y(g, 'spine_03') - y(g, 'pelvis')) - (y(g, 'hips') - y(g, 'pelvis'));
  put(['neck_01'], (over(m, 'neck_01', s) - sp3) / (y(g, 'neck_01') - y(g, 'spine_03')), 'neck');
  put(['Head'], (over(m, 'Head', s) - over(m, 'neck_01', s)) / (y(g, 'Head') - y(g, 'neck_01')), 'head');
  for (const side of ['l', 'r']) {
    put([`lowerarm_${side}`], ratio(`upperarm_${side}`, `lowerarm_${side}`), `upperArm_${side}`);
    put([`hand_${side}`], ratio(`lowerarm_${side}`, `hand_${side}`), `forearm_${side}`);
    put([`calf_${side}`], ratio(`thigh_${side}`, `calf_${side}`), `thigh_${side}`);
    put([`foot_${side}`], ratio(`calf_${side}`, `foot_${side}`), `shin_${side}`);
  }
  put(['thigh_l', 'thigh_r'], ratio('thigh_l', 'thigh_r'), 'hips');
  return { said: `proportions ${JSON.stringify(said)} at x${s.toFixed(3)}`, scale: s };
}

/** a skinned shape's points as its skeleton stands at rest (THREE.Vector3[]) */
export function restPoints(node) {
  const skin = node.getSkin(), joints = skin.listJoints(), ibm = skin.getInverseBindMatrices();
  const M = joints.map((j, k) => M4(j.getWorldMatrix()).multiply(M4(ibm.getElement(k, []))));
  const prim = node.getMesh().listPrimitives()[0];
  const pos = prim.getAttribute('POSITION'), ji = prim.getAttribute('JOINTS_0'), jw = prim.getAttribute('WEIGHTS_0');
  const out = [], v = new THREE.Vector3();
  for (let i = 0; i < pos.getCount(); i++) {
    v.fromArray(pos.getElement(i, []));
    const a = ji.getElement(i, []), w = jw.getElement(i, []), o = new THREE.Vector3();
    for (let c = 0; c < 4; c++) if (w[c] > 0) o.addScaledVector(v.clone().applyMatrix4(M[a[c]]), w[c]);
    out.push(o);
  }
  return out;
}

/**
 * A carried body weighted as the old suit was (the owner, 2026-10-25: "our previous player model was better with no
 * stretching textures or distortions during animations and actions"). Meshy's own rig hung the chest off the
 * collarbones and the arms, a collar off the head and a hem off the thighs, and every bend pulled the skin with it.
 * The suit's body and head (public/assets/characters/survivor.glb), weighted by hand on this same skeleton, are laid
 * on this body's bones at rest (each point moved as its own bones moved, from the suit's rest to this one's); each
 * point of this body then takes the weights at the nearest place on the suit's surface (its head's for the scalp and
 * the face, its body's for the rest), between the corners of the triangle there, and those are evened over the skin twice. The hands keep their own, hung finger by finger (fitHand).
 * @param suit the suit's document; @param keep the regions (_REGION, markRegions) whose own weights stay
 * @returns a line for the build
 */
export function suitWeights(node, suit, keep = [9]) {
  const names = node.getSkin().listJoints().map((j) => j.getName());
  const here = new Map(node.getSkin().listJoints().map((j) => [j.getName(), M4(j.getWorldMatrix())]));
  // ---- the suit's skin, on this body's bones
  const T = [], W = [];
  for (const sn of suit.getRoot().listNodes().filter((n) => n.getSkin() && ['body', 'head'].includes(n.getName()))) {
    const sj = sn.getSkin().listJoints(), ibm = sn.getSkin().getInverseBindMatrices();
    const M = sj.map((j, k) => (here.get(j.getName()) ?? M4(j.getWorldMatrix())).clone().multiply(M4(ibm.getElement(k, []))));
    const to = sj.map((j) => names.indexOf(j.getName()));
    for (const prim of sn.getMesh().listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), ji = prim.getAttribute('JOINTS_0'), jw = prim.getAttribute('WEIGHTS_0'), idx = prim.getIndices();
      const base = W.length, v = new THREE.Vector3(), a = [], w = [];
      const P = [];
      for (let i = 0; i < pos.getCount(); i++) {
        v.fromArray(pos.getElement(i, []));
        ji.getElement(i, a), jw.getElement(i, w);
        const o = new THREE.Vector3(), m = new Map();
        for (let c = 0; c < 4; c++) if (w[c] > 0) (o.addScaledVector(v.clone().applyMatrix4(M[a[c]]), w[c]), to[a[c]] >= 0 && m.set(to[a[c]], (m.get(to[a[c]]) ?? 0) + w[c]));
        P.push(o);
        W.push(m);
      }
      for (let t = 0; t < idx.getCount(); t += 3) {
        const k = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)];
        T.push({ p: k.map((i) => P[i]), w: k.map((i) => base + i), head: sn.getName() === 'head' });
      }
    }
  }
  // ---- its triangles by where they lie, for the nearest of them to each of this body's points
  // (the head's for the scalp and the face, the body's for the rest: the suit's head is hung on Head down to its neck,
  // and a collar near it followed the head round)
  const CELL = 0.06, grids = [new Map(), new Map()], box = new THREE.Box3();
  T.forEach((t, k) => {
    const grid = grids[t.head ? 1 : 0];
    box.setFromPoints(t.p);
    for (let x = Math.floor(box.min.x / CELL); x <= Math.floor(box.max.x / CELL); x++) for (let y = Math.floor(box.min.y / CELL); y <= Math.floor(box.max.y / CELL); y++) for (let z = Math.floor(box.min.z / CELL); z <= Math.floor(box.max.z / CELL); z++) {
      const key = `${x},${y},${z}`;
      (grid.get(key) ?? grid.set(key, []).get(key)).push(k);
    }
  });
  const tri = new THREE.Triangle(), at = new THREE.Vector3(), bary = new THREE.Vector3();
  const prim = node.getMesh().listPrimitives()[0], region = prim.getAttribute('_REGION'), idx = prim.getIndices();
  const ji = prim.getAttribute('JOINTS_0'), jw = prim.getAttribute('WEIGHTS_0'), n = ji.getCount();
  // (and only above the Head joint: Meshy's rig hung the front of the neck on the head too)
  const P = restPoints(node), got = new Array(n).fill(null), chin = new THREE.Vector3().setFromMatrixPosition(here.get('Head')).y;
  let far = 0;
  for (let i = 0; i < n; i++) {
    if (keep.includes(region.getScalar(i))) continue;
    const p = P[i], cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), cz = Math.floor(p.z / CELL);
    const grid = grids[region.getScalar(i) <= 1 && p.y > chin ? 1 : 0];
    let best = null, bd = Infinity;
    for (let r = 0; r <= 4 && (!best || bd > (r * CELL) ** 2); r++) {
      for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !== r) continue;
        for (const k of grid.get(`${x},${y},${z}`) ?? []) {
          tri.set(...T[k].p).closestPointToPoint(p, at);
          const d = at.distanceToSquared(p);
          if (d < bd) (bd = d), (best = { k, at: at.clone() });
        }
      }
    }
    if (!best) continue;
    if (bd > 0.1 ** 2) far++;
    tri.set(...T[best.k].p).getBarycoord(best.at, bary);
    const m = new Map();
    T[best.k].w.forEach((wi, c) => {
      for (const [j, v] of W[wi]) m.set(j, (m.get(j) ?? 0) + v * bary.getComponent(c));
    });
    got[i] = m;
  }
  // ---- evened over the skin twice (each point half its own, half its neighbours'), the hands as they are
  const one = new Int32Array(n), first = new Map(), pos = prim.getAttribute('POSITION');
  for (let i = 0; i < n; i++) {
    const k = pos.getElement(i, []).map((x) => Math.round(x * 20000)).join(',');
    if (!first.has(k)) first.set(k, i);
    one[i] = first.get(k);
  }
  const next = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < idx.getCount(); t += 3) {
    const v = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)].map((i) => one[i]);
    for (const a of v) for (const b of v) if (a !== b) next[a].add(b);
  }
  const a = [], w = [];
  const own = (i) => {
    ji.getElement(i, a), jw.getElement(i, w);
    const m = new Map();
    for (let c = 0; c < 4; c++) if (w[c] > 0) m.set(a[c], (m.get(a[c]) ?? 0) + w[c]);
    return m;
  };
  let cur = got.map((m, i) => (i === one[i] ? m ?? own(i) : null));
  for (let pass = 0; pass < 2; pass++) {
    const was = cur;
    cur = was.map((m, i) => {
      if (!m || !got[i]) return m;
      const out = new Map();
      for (const [j, v] of m) out.set(j, v * 0.5);
      const ns = [...next[i]];
      for (const q of ns) for (const [j, v] of was[q] ?? []) out.set(j, (out.get(j) ?? 0) + (v * 0.5) / ns.length);
      return out;
    });
  }
  const J = new Uint16Array(n * 4), V = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const m = (got[i] && cur[one[i]]) || own(i);
    const top = [...m].sort((x, y) => y[1] - x[1]).slice(0, 4), sum = top.reduce((s, [, v]) => s + v, 0) || 1;
    top.forEach(([j, v], c) => ((J[i * 4 + c] = j), (V[i * 4 + c] = v / sum)));
  }
  prim.setAttribute('JOINTS_0', ji.clone().setArray(J)).setAttribute('WEIGHTS_0', jw.clone().setType('VEC4').setNormalized(false).setArray(V));
  return `weighted as the suit: ${got.filter(Boolean).length} points of ${n}, ${far} of them over 10 cm from it`;
}

export async function carry({ io, template, src, fingers, fit = src }) {
  const doc = await io.read(template);
  const root = doc.getRoot();
  // (the skeleton first made the body's shape: see fitProportions)
  const { said: proportions, scale } = fitProportions(doc, fit);
  const nodes = new Map(root.listNodes().map((x) => [x.getName(), x]));
  // the skeleton it goes on, as it rests: its joints, and how tall it is from the foot to the head joint (as wearSuit measures)
  const rest = new Map(nodes.get('body').getSkin().listJoints().map((j) => [j.getName(), at(M4(j.getWorldMatrix()))]));
  evenOut(src);
  const hands = fingers ? giveFingers(src, { rest, height: rest.get('Head').y - rest.get('foot_l').y }) : (plainBones(src), '');
  const old = ['eyes', 'eyebrows', 'hair_buzzed', 'hair_parted', 'hair_long', 'hair_beard'].map((x) => nodes.get(x)).filter(Boolean);
  // (the toes lie as the foot lies: Meshy's toe bone has no end to lie along)
  const worn = await wearSuit({ doc, io, bodyNode: nodes.get('body'), old, suit: src, pieces: { survivor: [[/^survivor$/, null]] }, moved: {}, prefix: '', toes: false, scale });
  // the shape alone: no clips (the survivor's file has them), and no metal in skin and cloth
  for (const a of root.listAnimations()) {
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }
  for (const m of root.listMaterials()) m.setMetallicFactor(0);
  return { doc, node: root.listNodes().find((x) => x.getName() === 'survivor'), hands, worn, proportions };
}

/** a primitive's colour picture filled out from the triangles it is drawn with: each texel they do not cover takes the colour of the nearest one they do */
export async function padTexture(prim, tris) {
  const tex = prim.getMaterial().getBaseColorTexture(), uv = prim.getAttribute('TEXCOORD_0');
  const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = 4, N = W * H;
  const done = new Uint8Array(N);
  const P = (i) => {
    const [s, t] = uv.getElement(i, []);
    return [s * W - 0.5, t * H - 0.5];
  };
  for (const tri of tris) {
    const [[ax, ay], [bx, by], [cx, cy]] = tri.map(P), den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - 1), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)) - 1), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)) + 1);
    if (!den) continue;
    const e = 0.75 / Math.max(1, Math.sqrt(Math.abs(den)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
      if (l1 >= -e && l2 >= -e && 1 - l1 - l2 >= -e) done[y * W + x] = 1;
    }
  }
  // (less the two outermost texels of every island: Meshy darkens an island's rim, and drawn smaller it showed as
  // dark cracks along every seam)
  for (let r = 0; r < 2; r++) {
    const rim = [];
    for (let k = 0; k < N; k++) {
      if (!done[k]) continue;
      const x = k % W, y = (k / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !done[k - 1] || !done[k + 1] || !done[k - W] || !done[k + W]) rim.push(k);
    }
    for (const k of rim) done[k] = 0;
  }
  // (out from them a ring at a time, each texel the mean of those beside it already done: typed rings, as a 4096
  // picture is sixteen million texels)
  let front = new Int32Array(N), nf = 0;
  for (let k = 0; k < N; k++) if (!done[k]) {
    const x = k % W, y = (k / W) | 0;
    if ((x > 0 && done[k - 1] === 1) || (x < W - 1 && done[k + 1] === 1) || (y > 0 && done[k - W] === 1) || (y < H - 1 && done[k + W] === 1)) (front[nf++] = k), (done[k] = 2);
  }
  let next = new Int32Array(N);
  const at = [0, 0, 0, 0];
  while (nf) {
    let nn = 0;
    // (first what each takes, from those done before this ring; then all of the ring is done at once)
    const took = new Uint8Array(nf * 3);
    for (let f2 = 0; f2 < nf; f2++) {
      const k = front[f2], x = k % W, y = (k / W) | 0;
      at[0] = x > 0 ? k - 1 : -1; at[1] = x < W - 1 ? k + 1 : -1; at[2] = y > 0 ? k - W : -1; at[3] = y < H - 1 ? k + W : -1;
      let r = 0, g = 0, bl = 0, n = 0;
      for (let e = 0; e < 4; e++) {
        const q = at[e];
        if (q < 0) continue;
        if (done[q] === 1) (r += data[q * C]), (g += data[q * C + 1]), (bl += data[q * C + 2]), n++;
        else if (!done[q]) (done[q] = 2), (next[nn++] = q);
      }
      if (n) (took[f2 * 3] = Math.round(r / n)), (took[f2 * 3 + 1] = Math.round(g / n)), (took[f2 * 3 + 2] = Math.round(bl / n));
    }
    for (let f2 = 0; f2 < nf; f2++) {
      const k = front[f2];
      data[k * C] = took[f2 * 3];
      data[k * C + 1] = took[f2 * 3 + 1];
      data[k * C + 2] = took[f2 * 3 + 2];
      done[k] = 1;
    }
    [front, next] = [next, front];
    nf = nn;
  }
  tex.setImage(new Uint8Array(await sharp(data, { raw: { width: W, height: H, channels: C } }).png().toBuffer())).setMimeType('image/png');
}
