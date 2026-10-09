// Puts a suit of clothes that was made for another skeleton onto this game's.
//
// The suit ("Military tactical suit" by DanlyVostok: a jacket, trousers, boots and gloves, a
// balaclava'd head, a plate carrier, pouches, pads, a cap and a headset, each its own shape)
// hangs on a Mixamo skeleton, standing arms-down. The game's body is on another skeleton,
// arms straight out, with a longer back and shorter upper arms, and every movement the game
// has is drawn for that one. So the suit is brought to the skeleton, not the other way:
//
//   1. The game's skeleton has its arms and legs stood the way the suit's are: each limb bone
//      turned to lie along the suit's bone of the same name. Its joints are then where the
//      suit's joints ought to be, on a body of the game's proportions.
//   2. Every point of the suit is carried there. A point of a limb goes with the joints it
//      hangs on, and is stretched along a bone that is longer here than it was there. Nothing
//      is turned, so nothing is twisted or pinched by it.
//   3. The suit is bound to the game's skeleton as it stands in that pose (a second set of
//      bind matrices on the same bones). Whatever the bones then do, it follows.
//
// The trunk is not done bone by bone. An elbow is an elbow on any skeleton, but where along
// the back the joints of a spine are put, and where a collar bone starts, is each rigger's
// own choice: the two skeletons disagree by a hand's breadth, forward and back. Carried
// joint to joint the jacket was sheared into an S, chest out and shoulders hunched, and the
// arms hung inside it. So the trunk is carried whole, by the three places that do mean the
// same thing on both: the hip joints, the shoulder joints and the head. It is moved and
// stretched evenly between them, and its sides set out to this skeleton's width.
//
// What the game is given: `body` (what is always worn; its vertex colours say which of it is
// jacket, trousers, or leather: the `_TONE` attribute), `head`, `pads`, and what goes on and off with what is
// carried: `gear_plate`, `gear_pouches`, `gear_cap`, `gear_headset`.

import path from 'node:path';
import * as THREE from 'three';
import { mergeDocuments } from '@gltf-transform/functions';

/**
 * Mixamo's name for a joint, as Sketchfab writes it ("mixamorig:LeftArm_033") -> this game's.
 * @param prefix what stands before every joint's name in the file ('' when it was exported without one)
 */
export function ours(name, prefix = 'mixamorig:') {
  const m = name.startsWith(prefix) && name.slice(prefix.length).match(/^(Left|Right)?(.+?)_\d+$/);
  if (!m) return null;
  const side = m[1] === 'Left' ? '_l' : m[1] === 'Right' ? '_r' : '';
  const t = { Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'Head', Shoulder: 'clavicle', Arm: 'upperarm', ForeArm: 'lowerarm', Hand: 'hand', UpLeg: 'thigh', Leg: 'calf', Foot: 'foot', ToeBase: 'ball', Toe_End: 'ball_leaf' }[m[2]];
  if (t) return t + side;
  const f = m[2].match(/^Hand(Thumb|Index|Middle|Ring|Pinky)(\d)$/);
  return f ? `${f[1].toLowerCase()}_0${f[2]}${f[2] === '4' ? '_leaf' : ''}${side}` : null;
}

/** the bone a bone points along (and, for some, two joints that say which way round it is turned) */
function points(name) {
  const side = name.match(/_[lr]$/)?.[0] ?? '';
  const b = side ? name.slice(0, -2) : name;
  const to = { upperarm: 'lowerarm', lowerarm: 'hand', hand: 'middle_01', thigh: 'calf', calf: 'foot', foot: 'ball', ball: 'ball_leaf' }[b];
  if (to) return { to: to + side, across: b === 'lowerarm' || b === 'hand' ? [`pinky_01${side}`, `index_01${side}`] : null, stretch: b !== 'hand' };
  const f = b.match(/^(thumb|index|middle|ring|pinky)_0([123])$/);
  return f ? { to: `${f[1]}_0${+f[2] + 1}${f[2] === '3' ? '_leaf' : ''}${side}`, across: null, stretch: true } : null;
}

/** the bones of the trunk: what hangs on these is carried whole (see the top of this file) */
const TRUNK = /^(root|pelvis|spine_0[123]|neck_01|Head|clavicle_[lr])$/;

/** which shapes of the suit make which piece of the body; [what the shape is called, what it is of the body] */
const PIECES = {
  body: [[/^Mil_Suit_R5_Mil_Suit_R5_0$/, 'jacket'], [/^Mil_Suit_R5\.001_/, 'trousers'], [/^Mil_Suit_R5_Gloves_/, 'leather'], [/^Mil_Suit_R5\.002_/, 'leather']],
  head: [[/^[012]$/, null]],
  pads: [[/Pads_/, null]],
  gear_plate: [[/^3$/, null]],
  gear_pouches: [[/Puches/, null]],
  gear_cap: [[/^Cap_/, null]],
  gear_headset: [[/^4$/, null]],
};
const TONE = { jacket: [255, 0, 0, 255], trousers: [0, 255, 0, 255], leather: [0, 0, 255, 255] };
/**
 * A piece that is not where it is worn, moved to where it is (in the suit's own units, as it
 * was bound). The headset comes held a hand's length above the head it belongs on: its band
 * is brought down onto the crown of the cap and its cups to the ears.
 */
const MOVED = { gear_headset: [0, -250000, 0] };

const M4 = (a) => new THREE.Matrix4().fromArray(a);
const at = (m) => new THREE.Vector3().setFromMatrixPosition(m);

/**
 * The other way about: the SKELETON brought to the suit. wearSuit stretches a suit along every
 * bone that is longer on the game's skeleton than on its own, and what is painted on it is
 * stretched with it: a body whose thighs are a quarter shorter than the game's has the cloth
 * on them pulled a quarter longer. A body that is nobody's but its own (one of the infected:
 * nothing else is ever worn on its skeleton) keeps its own shape instead. Each joint of the
 * character's skeleton is moved to where the suit has that joint (at the suit's size brought
 * to this skeleton's height), the bones keep which way they turn, and every movement the
 * character has still plays: they are all turns of bones, and the one thing in them that is
 * a distance (how high the hips ride) is scaled to the new length of leg. Run before wearSuit,
 * which then finds nothing to stretch.
 * @returns what was done, for the build's last line
 */
export function fitSkeleton({ doc, bodyNode, suit, prefix = 'mixamorig:' }) {
  const sSkin = suit.getRoot().listSkins()[0];
  const sJoints = sSkin.listJoints();
  const ibm = sSkin.getInverseBindMatrices();
  const p = sJoints.map((_, k) => at(M4(ibm.getElement(k, [])).invert()));
  const sName = sJoints.map((j) => ours(j.getName(), prefix));
  const skin = bodyNode.getSkin();
  const joints = skin.listJoints();
  const jIndex = new Map(joints.map((j, i) => [j, i]));
  const byName = new Map(joints.map((j, i) => [j.getName(), i]));
  const r = joints.map((j) => at(M4(j.getWorldMatrix())));
  const parent = joints.map((j) => {
    for (let n = j.getParentNode(); n; n = n.getParentNode()) if (jIndex.has(n)) return jIndex.get(n);
    return -1;
  });
  const suitOf = new Map();
  sName.forEach((n, k) => n && byName.has(n) && suitOf.set(byName.get(n), k));
  const S = (n) => suitOf.get(byName.get(n));
  const scale = (r[byName.get('Head')].y - r[byName.get('foot_l')].y) / (p[S('Head')].y - p[S('foot_l')].y);
  // the ground under the suit: the lowest point of anything that hangs on its skeleton
  let floor = Infinity;
  for (const n of suit.getRoot().listNodes()) {
    if (!n.getMesh() || !n.getSkin()) continue;
    for (const prim of n.getMesh().listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i++) floor = Math.min(floor, pos.getElement(i, [])[1]);
    }
  }
  const depth = (i) => {
    let d = 0;
    for (let a = parent[i]; a >= 0; a = parent[a]) d++;
    return d;
  };
  const order = joints.map((_, i) => i).sort((a, b) => depth(a) - depth(b));
  // which way each bone is turned to lie as the suit's lies (as wearSuit works it out: it
  // goes by which way the bones point, which moving their ends along them does not change)
  const turn = joints.map(() => new THREE.Quaternion());
  for (const i of order) {
    const up = parent[i];
    const before = up < 0 ? new THREE.Quaternion() : turn[up];
    turn[i].copy(before);
    const k = suitOf.get(i), way = points(joints[i].getName());
    const c = way && byName.get(way.to), kc = c !== undefined ? suitOf.get(c) : undefined;
    if (k === undefined || kc === undefined) continue;
    const want = p[kc].clone().sub(p[k]);
    const has = r[c].clone().sub(r[i]);
    turn[i].premultiply(new THREE.Quaternion().setFromUnitVectors(has.clone().applyQuaternion(before).normalize(), want.clone().normalize()));
    if (way.across) {
      const [a, b] = way.across.map((n) => byName.get(n)), [sa, sb] = way.across.map(S);
      if (a === undefined || b === undefined || sa === undefined || sb === undefined) continue;
      const axis = want.clone().normalize();
      const from = r[b].clone().sub(r[a]).applyQuaternion(turn[i]).projectOnPlane(axis).normalize();
      const to = p[sb].clone().sub(p[sa]).projectOnPlane(axis).normalize();
      turn[i].premultiply(new THREE.Quaternion().setFromAxisAngle(axis, Math.atan2(new THREE.Vector3().crossVectors(from, to).dot(axis), from.dot(to))));
    }
  }
  // where each joint goes: from the joint above it that the suit has too, as far and which way the suit has it (stood back up the way this skeleton rests)
  const to = r.map((v) => v.clone());
  const moved = new Set();
  const hipsWas = joints[byName.get('pelvis')].getTranslation();
  for (const i of order) {
    const k = suitOf.get(i);
    // (the ends of fingers and toes carry nothing and were bound nowhere in particular: like any joint the suit has not, they go with the bone they hang on)
    if (k === undefined || joints[i].getName().includes('_leaf')) {
      if (parent[i] >= 0) to[i].copy(r[i]).sub(r[parent[i]]).add(to[parent[i]]);
      continue;
    }
    let up = parent[i];
    while (up >= 0 && suitOf.get(up) === undefined) up = parent[up];
    if (up < 0) to[i].set(r[i].x, (p[k].y - floor) * scale, r[i].z);
    else to[i].copy(p[k]).sub(p[suitOf.get(up)]).multiplyScalar(scale).applyQuaternion(turn[up].clone().invert()).add(to[up]);
    moved.add(i);
  }
  let most = 0;
  for (const i of order) {
    if (!moved.has(i)) continue;
    const above = joints[i].getParentNode();
    const local = to[i].clone().applyMatrix4(above ? M4(above.getWorldMatrix()).invert() : new THREE.Matrix4());
    most = Math.max(most, to[i].distanceTo(r[i]));
    joints[i].setTranslation(local.toArray());
  }
  // the one distance in its movements: how high the hips ride, which goes by the length of leg
  const hipsNow = joints[byName.get('pelvis')].getTranslation();
  const ride = Math.hypot(...hipsNow) / Math.hypot(...hipsWas);
  for (const a of doc.getRoot().listAnimations()) {
    for (const ch of a.listChannels()) {
      if (ch.getTargetPath() !== 'translation' || ch.getTargetNode() !== joints[byName.get('pelvis')]) continue;
      const out = ch.getSampler().getOutput();
      out.setArray(out.getArray().map((v) => v * ride));
    }
  }
  return `skeleton brought to it: ${moved.size} joints moved, the furthest ${(most * 100).toFixed(1)} cm, hips riding x${ride.toFixed(2)}`;
}

/**
 * @param doc      the character being built: its skeleton is the one the suit goes on
 * @param bodyNode the shape now on that skeleton (it and the other old shapes are taken out)
 * @param suit     what is put on, already read (otherwise it is read from `dir`); and for
 *                 anything other than the tactical suit: `pieces` (which of its shapes make
 *                 which shape of the body, as PIECES), `moved` (as MOVED) and `prefix` (see ours)
 * @returns what was done, for the build's last line
 */
export async function wearSuit({ doc, io, bodyNode, dir, old = [], suit: given, pieces = PIECES, moved: MOVED_ = MOVED, prefix = 'mixamorig:' }) {
  const suit = given ?? (await io.read(path.join(dir, 'scene.gltf')));
  const sRoot = suit.getRoot();
  const sSkin = sRoot.listSkins()[0];
  const sJoints = sSkin.listJoints();
  const ibm = sSkin.getInverseBindMatrices();
  // where each of its joints is when the suit stands as it was bound (its own units, about a million to the metre)
  const bind = sJoints.map((_, k) => M4(ibm.getElement(k, [])).invert());
  const p = bind.map(at);
  const sIndex = new Map(sJoints.map((j, k) => [j, k]));
  const sParent = sJoints.map((j) => {
    for (let n = j.getParentNode(); n; n = n.getParentNode()) if (sIndex.has(n)) return sIndex.get(n);
    return -1;
  });
  const sName = sJoints.map((j) => ours(j.getName(), prefix));

  const root = doc.getRoot();
  const skin = bodyNode.getSkin();
  const joints = skin.listJoints();
  const jIndex = new Map(joints.map((j, i) => [j, i]));
  const byName = new Map(joints.map((j, i) => [j.getName(), i]));
  const rest = joints.map((j) => M4(j.getWorldMatrix()));
  const r = rest.map(at);
  const parent = joints.map((j) => {
    for (let n = j.getParentNode(); n; n = n.getParentNode()) if (jIndex.has(n)) return jIndex.get(n);
    return -1;
  });
  // the suit's joint for each of the game's, and the nearest joint above that has one for those of the suit's that have none (a pad, a pouch)
  const suitOf = new Map();
  sName.forEach((n, k) => n && byName.has(n) && suitOf.set(byName.get(n), k));
  const mine = sJoints.map((_, k) => {
    for (let a = k; a >= 0; a = sParent[a]) if (sName[a] && byName.has(sName[a])) return a;
    return -1;
  });
  const S = (n) => suitOf.get(byName.get(n));
  if (p[S('ball_l')].z < p[S('foot_l')].z || p[S('upperarm_l')].x < p[S('upperarm_r')].x || p[S('Head')].y < p[S('pelvis')].y) throw new Error('suit: it does not stand the way this skeleton does (y up, facing +z, its left at +x)');
  // its size: head to ankle, against the game's
  const scale = (r[byName.get('Head')].y - r[byName.get('foot_l')].y) / (p[S('Head')].y - p[S('foot_l')].y);

  // ---- the trunk: where the hips, the shoulders and the head are on each, and how much wider this skeleton is there
  const O = (n) => r[byName.get(n)];
  const level = (l, rr) => {
    const half = Math.abs(p[S(l)].x - p[S(rr)].x) / 2;
    return { P: p[S(l)].clone().add(p[S(rr)]).multiplyScalar(0.5), Q: O(l).clone().add(O(rr)).multiplyScalar(0.5), half, out: Math.abs(O(l).x - O(rr).x) / 2 - half * scale };
  };
  const hips = level('thigh_l', 'thigh_r'), chest = level('upperarm_l', 'upperarm_r');
  const crown = { P: p[S('Head')].clone(), Q: O('Head').clone(), half: chest.half, out: 0 };
  const trunk = (v, out) => {
    const [lo, hi] = v.y <= chest.P.y ? [hips, chest] : [chest, crown];
    const t = THREE.MathUtils.clamp((v.y - lo.P.y) / (hi.P.y - lo.P.y), 0, 1);
    // each of the two places carries it as that place went; between them it goes part with each, which stretches it evenly
    out.copy(v).sub(lo.P).multiplyScalar(scale).add(lo.Q);
    out.lerp(v.clone().sub(hi.P).multiplyScalar(scale).add(hi.Q), t);
    // and its sides are set out (or in) to where this skeleton's hips and shoulders are
    const dx = v.x - THREE.MathUtils.lerp(lo.P.x, hi.P.x, t);
    out.x += Math.sign(dx) * THREE.MathUtils.lerp(lo.out, hi.out, t) * THREE.MathUtils.smoothstep(Math.abs(dx) / THREE.MathUtils.lerp(lo.half, hi.half, t), 0, 1);
    return out;
  };

  // ---- 1. the game's skeleton, its limbs stood as the suit's stand
  const order = joints.map((_, i) => i).sort((a, b) => depth(a) - depth(b));
  function depth(i) {
    let d = 0;
    for (let a = parent[i]; a >= 0; a = parent[a]) d++;
    return d;
  }
  const turn = joints.map(() => new THREE.Quaternion());
  const q = joints.map(() => new THREE.Vector3());
  const stretch = sJoints.map(() => ({ along: new THREE.Vector3(1, 0, 0), by: 1 }));
  const told = [];
  for (const i of order) {
    const up = parent[i];
    const before = up < 0 ? new THREE.Quaternion() : turn[up];
    q[i].copy(up < 0 ? r[i] : r[i].clone().sub(r[up]).applyQuaternion(before).add(q[up]));
    turn[i].copy(before);
    const k = suitOf.get(i), way = points(joints[i].getName());
    const c = way && byName.get(way.to), kc = c !== undefined ? suitOf.get(c) : undefined;
    if (k === undefined || kc === undefined) continue;
    const want = p[kc].clone().sub(p[k]);
    const has = r[c].clone().sub(r[i]);
    turn[i].premultiply(new THREE.Quaternion().setFromUnitVectors(has.clone().applyQuaternion(before).normalize(), want.clone().normalize()));
    if (way.across) {
      const [a, b] = way.across.map((n) => byName.get(n)), [sa, sb] = way.across.map(S);
      const axis = want.clone().normalize();
      const from = r[b].clone().sub(r[a]).applyQuaternion(turn[i]).projectOnPlane(axis).normalize();
      const to = p[sb].clone().sub(p[sa]).projectOnPlane(axis).normalize();
      turn[i].premultiply(new THREE.Quaternion().setFromAxisAngle(axis, Math.atan2(new THREE.Vector3().crossVectors(from, to).dot(axis), from.dot(to))));
    }
    if (way.stretch) {
      const by = THREE.MathUtils.clamp(has.length() / (want.length() * scale), 0.6, 1.7);
      stretch[k] = { along: want.clone().normalize(), by };
      if (!/_r$|_0[123]|ball|foot/.test(joints[i].getName())) told.push(`${joints[i].getName().replace(/_l$/, '')} x${by.toFixed(2)}`);
    }
  }
  // its bones as they are in that pose: turned about where they stand, and moved to where they went
  const posed = joints.map((_, i) => {
    const m = rest[i].clone().setPosition(0, 0, 0);
    return new THREE.Matrix4().makeRotationFromQuaternion(turn[i]).multiply(m).setPosition(q[i]);
  });

  // ---- 2. every point of the suit, carried from its joints to those
  const before = { nodes: new Set(root.listNodes()), meshes: new Set(root.listMeshes()), skins: new Set(root.listSkins()), anims: new Set(root.listAnimations()), scenes: new Set(root.listScenes()) };
  const materials = new Map();
  {
    const had = new Set(root.listMaterials());
    mergeDocuments(doc, suit);
    for (const m of root.listMaterials()) if (!had.has(m)) materials.set(m.getName(), m);
  }
  const carried = (k, v, out) => {
    const a = mine[k];
    if (a < 0) throw new Error(`suit: ${sJoints[k].getName()} carries part of it and is no bone of this skeleton`);
    if (TRUNK.test(sName[a])) return trunk(v, out);
    const st = stretch[a];
    const d = v.clone().sub(p[a]);
    d.addScaledVector(st.along, (st.by - 1) * d.dot(st.along));
    return out.copy(d).multiplyScalar(scale).add(q[byName.get(sName[a])]);
  };
  const drawn = sRoot.listNodes().filter((n) => n.getMesh());
  const made = {};
  const suitSkin = doc.createSkin('suit');
  for (const j of joints) suitSkin.addJoint(j);
  suitSkin.setSkeleton(skin.getSkeleton());
  const inverse = new Float32Array(joints.length * 16);
  posed.forEach((m, i) => inverse.set(m.clone().invert().elements, i * 16));
  suitSkin.setInverseBindMatrices(doc.createAccessor('suit_bind').setType('MAT4').setArray(inverse));
  // (at the top of the scene, which stands still: where a shape on a skeleton is drawn from is counted in by three.js)
  const home = root.listScenes()[0];
  let points_ = 0, faces = 0;
  for (const [piece, sources] of Object.entries(pieces)) {
    const P = [], N = [], T = [], UV = [], JI = [], JW = [], C = [], I = [];
    let material = null, tangents = true;
    for (const [re, tone] of sources) {
      for (const n of drawn.filter((d) => re.test(d.getMesh().getName()))) {
        for (const prim of n.getMesh().listPrimitives()) {
          const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), tan = prim.getAttribute('TANGENT'), uv = prim.getAttribute('TEXCOORD_0');
          const ji = prim.getAttribute('JOINTS_0'), jw = prim.getAttribute('WEIGHTS_0'), idx = prim.getIndices();
          material ??= materials.get(prim.getMaterial().getName());
          if (materials.get(prim.getMaterial().getName()) !== material) throw new Error(`suit: ${piece} is drawn with more than one material`);
          if (!tan) tangents = false;
          // a shape that hangs on one bone whole (the eyes): its points as that bone has them, said where the bone was bound
          let whole = -1, lift = null;
          if (!n.getSkin()) {
            for (let a = n.getParentNode(); a && whole < 0; a = a.getParentNode()) if (sIndex.has(a)) whole = sIndex.get(a);
            if (whole < 0) throw new Error(`suit: ${n.getName()} hangs on no bone`);
            lift = bind[whole].clone().multiply(M4(sJoints[whole].getWorldMatrix()).invert()).multiply(M4(n.getWorldMatrix()));
          }
          const base = P.length / 3, count = pos.getCount();
          const moved = new THREE.Vector3();
          const MOVED = MOVED_;
          const v = new THREE.Vector3(), nv = new THREE.Vector3(), tv = new THREE.Vector3(), out = new THREE.Vector3(), sum = new THREE.Vector3(), e = [], a = [], w = [];
          const linear = lift ? new THREE.Matrix3().setFromMatrix4(lift) : null;
          for (let i = 0; i < count; i++) {
            v.fromArray(pos.getElement(i, e));
            nv.fromArray(nor.getElement(i, e));
            if (tan) tv.fromArray(tan.getElement(i, e));
            const hand = tan ? e[3] : 1;
            if (MOVED[piece]) v.add(moved.fromArray(MOVED[piece]));
            if (lift) {
              v.applyMatrix4(lift);
              nv.applyMatrix3(linear).normalize();
              tv.applyMatrix3(linear).normalize();
            }
            if (whole >= 0) {
              a[0] = whole; a[1] = a[2] = a[3] = 0;
              w[0] = 1; w[1] = w[2] = w[3] = 0;
            } else {
              ji.getElement(i, a);
              jw.getElement(i, w);
            }
            // where it goes, and which of the game's bones it hangs on there (two of the suit's may be one of the game's)
            sum.set(0, 0, 0);
            const on = new Map();
            let total = 0, lead = 0;
            for (let c = 0; c < 4; c++) {
              if (!(w[c] > 0)) continue;
              sum.addScaledVector(carried(a[c], v, out), w[c]);
              total += w[c];
              if (w[c] > w[lead]) lead = c;
              const bone = byName.get(sName[mine[a[c]]]);
              on.set(bone, (on.get(bone) ?? 0) + w[c]);
            }
            if (!total) throw new Error(`suit: a point of ${piece} hangs on nothing`);
            sum.divideScalar(total);
            P.push(sum.x, sum.y, sum.z);
            // (a bone that was stretched leans what faces along it back toward its sides)
            const st = stretch[mine[a[lead]]];
            nv.addScaledVector(st.along, (1 / st.by - 1) * nv.dot(st.along)).normalize();
            N.push(nv.x, nv.y, nv.z);
            if (tan) {
              tv.addScaledVector(st.along, (st.by - 1) * tv.dot(st.along)).normalize();
              T.push(tv.x, tv.y, tv.z, hand);
            }
            uv.getElement(i, e);
            UV.push(e[0], e[1]);
            const four = [...on].sort((x, y) => y[1] - x[1]).slice(0, 4);
            const kept = four.reduce((s, x) => s + x[1], 0);
            for (let c = 0; c < 4; c++) {
              JI.push(four[c]?.[0] ?? 0);
              JW.push(four[c] ? four[c][1] / kept : 0);
            }
            C.push(...(tone ? TONE[tone] : [0, 0, 0, 255]));
          }
          const n3 = idx ? idx.getCount() : count;
          for (let i = 0; i < n3; i++) I.push(base + (idx ? idx.getScalar(i) : i));
        }
      }
    }
    if (!P.length) throw new Error(`suit: nothing of it is the ${piece}`);
    const prim = doc.createPrimitive()
      .setMaterial(material)
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(I)))
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(N)))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(UV)))
      .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint8Array(JI)))
      .setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(JW)));
    if (tangents) prim.setAttribute('TANGENT', doc.createAccessor().setType('VEC4').setArray(new Float32Array(T)));
    // (its own name, not a colour: three.js would paint the cloth with it)
    if (piece === 'body') prim.setAttribute('_TONE', doc.createAccessor().setType('VEC4').setNormalized(true).setArray(new Uint8Array(C)));
    const node = doc.createNode(piece).setMesh(doc.createMesh(piece).addPrimitive(prim)).setSkin(suitSkin);
    home.addChild(node);
    made[piece] = node;
    points_ += P.length / 3;
    faces += I.length / 3;
  }
  // every map of it is looked up with the one set of texture coordinates that was kept
  for (const m of materials.values()) {
    for (const info of [m.getBaseColorTextureInfo(), m.getNormalTextureInfo(), m.getMetallicRoughnessTextureInfo(), m.getOcclusionTextureInfo(), m.getEmissiveTextureInfo()]) info?.setTexCoord(0);
  }
  // what the merge brought along and is not wanted: the suit's own shapes, skeleton and movement
  for (const a of root.listAnimations()) {
    if (before.anims.has(a)) continue;
    // (its keys with it, or they stay in the file)
    for (const c of a.listChannels()) c.dispose();
    for (const sm of a.listSamplers()) sm.dispose();
    a.dispose();
  }
  for (const n of root.listNodes()) if (!before.nodes.has(n) && !Object.values(made).includes(n)) n.dispose();
  for (const m of root.listMeshes()) if (!before.meshes.has(m) && !Object.values(made).some((n) => n.getMesh() === m)) m.dispose();
  for (const s of root.listSkins()) if (!before.skins.has(s) && s !== suitSkin) s.dispose();
  for (const s of root.listScenes()) if (!before.scenes.has(s)) s.dispose();
  // and what was worn before
  for (const n of [bodyNode, ...old]) {
    n?.getMesh()?.dispose();
    n?.dispose();
  }
  const tall = (a, b) => (b.Q.y - a.Q.y) / ((b.P.y - a.P.y) * scale);
  return `suit: ${Object.keys(made).length} pieces, ${points_} points, ${faces} triangles, brought to ${(scale * 1e6).toFixed(3)} of its size (per million units). Trunk: hips to shoulders x${tall(hips, chest).toFixed(2)}, shoulders to head x${tall(chest, crown).toFixed(2)}, hips ${(hips.out * 200).toFixed(1)} cm wider, shoulders ${(chest.out * 200).toFixed(1)} cm wider. Limbs against the suit's: ${told.join(', ')}`;
}
