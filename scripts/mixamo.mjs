// A movement read off a body on a Mixamo skeleton (as Sketchfab hands them over) and carried onto this game's
// skeleton, bone by bone: each bone turned from how it stands at rest by what the other's is turned by from how
// that stands at rest. Made for the infected (scripts/zombies.mjs, where these were first written), and used too
// for the player's own lying down and crawling (scripts/build-character.mjs).
import * as THREE from 'three';
import { ours } from './suit.mjs';

const FPS = 30;
const M4 = (a) => new THREE.Matrix4().fromArray(a);

// ---------------------------------------------------------------- a skeleton, as it was bound

export function rigOf(doc, prefix = '') {
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices();
  const bind = joints.map((_, k) => M4(ibm.getElement(k, [])).invert());
  const index = new Map(joints.map((j, k) => [j, k]));
  const parent = joints.map((j) => {
    for (let n = j.getParentNode(); n; n = n.getParentNode()) if (index.has(n)) return index.get(n);
    return -1;
  });
  const name = joints.map((j) => ours(j.getName(), prefix));
  const at = (n) => new THREE.Vector3().setFromMatrixPosition(bind[name.indexOf(n)]);
  return { skin, joints, bind, index, parent, name, at };
}

// ---------------------------------------------------------------- the cop's running, and another's standing, on the game's skeleton

/**
 * How every bone of a body with one movement in its file is turned from where it was bound,
 * frame by frame, and where its hips go.
 * @param prefix what stands before every joint's name in the file (see ours)
 * @param onTheSpot a run: whatever way it drifts over its length is taken out, so it loops where it stands
 */
export function runOf(cop, prefix = '', onTheSpot = true) {
  const rig = rigOf(cop, prefix);
  const { joints, bind, parent } = rig;
  const n = joints.length;
  const order = joints.map((_, i) => i).sort((a, b) => depth(a) - depth(b));
  function depth(i) {
    let d = 0;
    for (let a = parent[i]; a >= 0; a = parent[a]) d++;
    return d;
  }
  const restT = joints.map((j) => new THREE.Vector3(...j.getTranslation())), restQ = joints.map((j) => new THREE.Quaternion(...j.getRotation())), restS = joints.map((j) => new THREE.Vector3(...j.getScale()));
  const top = order[0];
  // What stands above the skeleton in the file: whatever leaves its first bone where that was
  // bound, or (a file whose first "bone" is a bare knot bound nowhere) what the file itself
  // has above it. Whichever of the two stands the rest of it where it was bound.
  const aboves = [bind[top].clone().multiply(new THREE.Matrix4().compose(restT[top], restQ[top], restS[top]).invert())];
  if (joints[top].getParentNode()) aboves.push(M4(joints[top].getParentNode().getWorldMatrix()));
  let above = aboves[0];
  // (a file may hang a bone on its parent bone by way of something that is no bone: an
  // "armature" a hundredth the size, say. Whatever stands between the two is counted in.)
  const between = joints.map((j, i) => {
    const m = new THREE.Matrix4();
    if (parent[i] < 0) return m;
    for (let a = j.getParentNode(); a && a !== joints[parent[i]]; a = a.getParentNode()) m.premultiply(M4(a.getMatrix()));
    return m;
  });
  const pose = (Q, T) => {
    const W = new Array(n);
    for (const i of order) {
      const local = new THREE.Matrix4().compose(T[i], Q[i], restS[i]);
      W[i] = (parent[i] < 0 ? above.clone() : W[parent[i]].clone().multiply(between[i])).multiply(local);
    }
    return W;
  };
  // is the pose in the file the pose it was bound in? (It has to be, for "turned from where it was bound" to mean anything.)
  const tall = new THREE.Vector3().setFromMatrixPosition(bind[rig.name.indexOf('Head')]).y;
  let off = Infinity;
  for (const candidate of aboves) {
    above = candidate;
    const still = pose(restQ, restT);
    let worst = 0;
    // (the ends of the fingers and the top of the head carry nothing and were bound nowhere in particular: they are not asked)
    for (let i = 0; i < n; i++) if (rig.name[i] && !rig.name[i].includes('_leaf')) worst = Math.max(worst, new THREE.Vector3().setFromMatrixPosition(still[i]).distanceTo(new THREE.Vector3().setFromMatrixPosition(bind[i])));
    if (worst < off) off = worst;
    if (worst <= tall * 0.02) break;
  }
  if (off > tall * 0.02) throw new Error(`zombies: a body does not stand in its file as it was bound (out by ${((off / tall) * 100).toFixed(1)}% of its height)`);

  const anim = cop.getRoot().listAnimations()[0];
  const tracks = new Map();
  let dur = 0;
  for (const ch of anim.listChannels()) {
    const i = rig.index.get(ch.getTargetNode());
    if (i === undefined) continue;
    const s = ch.getSampler(), t = s.getInput().getArray(), v = s.getOutput().getArray();
    dur = Math.max(dur, t[t.length - 1]);
    tracks.set(`${i}:${ch.getTargetPath()}`, { t, v });
  }
  const sample = (tr, time, size) => {
    const { t, v } = tr;
    let k = 0;
    while (k < t.length - 2 && t[k + 1] <= time) k++;
    const u = THREE.MathUtils.clamp((time - t[k]) / Math.max(1e-6, t[k + 1] - t[k]), 0, 1);
    const a = Array.from(v.subarray(k * size, k * size + size)), b = Array.from(v.subarray((k + 1) * size, (k + 1) * size + size));
    return size === 4 ? new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b), u) : new THREE.Vector3(...a).lerp(new THREE.Vector3(...b), u);
  };
  const frames = Math.round(dur * FPS);
  const hips = rig.name.indexOf('pelvis');
  const turned = [], moved = [];
  const _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const rot = (m) => {
    const q = new THREE.Quaternion();
    m.decompose(_p, q, _s);
    return q;
  };
  const boundQ = bind.map(rot), hipsAt = new THREE.Vector3().setFromMatrixPosition(bind[hips]);
  for (let f = 0; f <= frames; f++) {
    const time = (f / frames) * dur;
    const Q = restQ.map((q, i) => (tracks.has(`${i}:rotation`) ? sample(tracks.get(`${i}:rotation`), time, 4) : q));
    const T = restT.map((p, i) => (i === hips && tracks.has(`${i}:translation`) ? sample(tracks.get(`${i}:translation`), time, 3) : p));
    const W = pose(Q, T);
    turned.push(W.map((m, i) => rot(m).multiply(boundQ[i].clone().invert())));
    moved.push(new THREE.Vector3().setFromMatrixPosition(W[hips]).sub(hipsAt));
  }
  // (it runs on the spot: whatever way it drifts over the two seconds is taken out)
  const drift = onTheSpot ? moved[frames].clone().sub(moved[0]) : new THREE.Vector3();
  moved.forEach((m, f) => m.addScaledVector(drift, -f / frames));
  const mean = moved.reduce((s, m) => s.add(m), new THREE.Vector3()).divideScalar(moved.length);
  for (const m of moved) {
    m.x -= mean.x;
    m.z -= mean.z;
  }
  return { rig, dur, frames, turned, moved, hipsHigh: hipsAt.y };
}

const ID = new THREE.Quaternion();
/** one of the character's movements (`run`, unless another is named) made the one that was read */
export function giveRun(doc, run, clip = 'run') {
  const root = doc.getRoot();
  const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const parentOf = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
  const mine = run.rig.name.map((nm, k) => [k, nm && !nm.includes('_leaf') && nodes.get(nm)]).filter(([, node]) => node);
  const depth = (n) => {
    let d = 0;
    for (let p = parentOf.get(n); p; p = parentOf.get(p)) d++;
    return d;
  };
  mine.sort((a, b) => depth(a[1]) - depth(b[1]));
  const restQ = (n) => new THREE.Quaternion(...n.getRotation());
  const restWorld = new Map();
  const worldRest = (n) => {
    if (!n) return new THREE.Quaternion();
    if (!restWorld.has(n)) restWorld.set(n, worldRest(parentOf.get(n)).clone().multiply(restQ(n)));
    return restWorld.get(n);
  };
  const mapped = new Map(mine.map(([k, node]) => [node, k]));
  const out = new Map(mine.map(([, node]) => [node, new Float32Array((run.frames + 1) * 4)]));
  // "Turned from where it was bound" carries a movement between two bodies that were bound
  // standing the SAME way. One bound with its arms hanging (most are) on this skeleton, which
  // rests with them straight out, would hold them out sideways all through. So each limb bone
  // is first laid the way the other body's lay when it was bound: along the same line.
  const NEXT = { clavicle: 'upperarm', upperarm: 'lowerarm', lowerarm: 'hand', thigh: 'calf', calf: 'foot' };
  const at = (n) => new THREE.Vector3().setFromMatrixPosition(M4(n.getWorldMatrix()));
  const laid = new Map();
  for (const [, node] of mine) {
    const m = node.getName().match(/^(.+?)(_[lr])$/);
    const next = m && NEXT[m[1]] && m[1] + m[2] && NEXT[m[1]] + m[2];
    const to = next && nodes.get(next);
    if (!to || !run.rig.name.includes(next)) continue;
    const here = at(to).sub(at(node)).normalize(), there = run.rig.at(next).sub(run.rig.at(node.getName())).normalize();
    // (a few degrees is the two riggers' taste, and is left alone)
    if (here.angleTo(there) > 0.14) laid.set(node, new THREE.Quaternion().setFromUnitVectors(here, there));
  }
  // (a hand lies as its forearm does)
  for (const s of ['_l', '_r']) if (laid.has(nodes.get(`lowerarm${s}`)) && nodes.get(`hand${s}`)) laid.set(nodes.get(`hand${s}`), laid.get(nodes.get(`lowerarm${s}`)));
  // (and the fingers, where the other body says which way its lie (rig.dir, scripts/emotes.mjs): first as the hand is
  // laid, so a finger keeps its roll on the hand, then along the other's)
  if (run.rig.dir) {
    for (const [, node] of mine) {
      const there = run.rig.dir(node.getName()), kid = there && node.listChildren()[0];
      if (!kid) continue;
      const hand = laid.get(nodes.get(`hand${node.getName().slice(-2)}`)) ?? ID;
      const here = at(kid).sub(at(node)).normalize().applyQuaternion(hand);
      laid.set(node, new THREE.Quaternion().setFromUnitVectors(here, there).multiply(hand));
    }
  }
  const pelvis = nodes.get('pelvis');
  const hip = new Float32Array((run.frames + 1) * 3);
  const scale = (pelvis.getWorldMatrix()[13]) / run.hipsHigh;
  const aboveHips = worldRest(parentOf.get(pelvis)).clone().invert();
  for (let f = 0; f <= run.frames; f++) {
    const now = new Map();
    const world = (n) => {
      if (!n) return new THREE.Quaternion();
      if (now.has(n)) return now.get(n);
      const k = mapped.get(n);
      // a bone the cop has: turned from its rest by what the cop's is turned by. One it has not: as it rests on the bone above.
      const q = k !== undefined ? run.turned[f][k].clone().multiply(laid.get(n) ?? ID).multiply(worldRest(n)) : world(parentOf.get(n)).clone().multiply(restQ(n));
      now.set(n, q);
      return q;
    };
    for (const [, node] of mine) {
      const local = world(parentOf.get(node)).clone().invert().multiply(world(node)).normalize();
      out.get(node).set([local.x, local.y, local.z, local.w], f * 4);
    }
    const d = run.moved[f].clone().multiplyScalar(scale).applyQuaternion(aboveHips);
    const t = pelvis.getTranslation();
    hip.set([t[0] + d.x, t[1] + d.y, t[2] + d.z], f * 3);
  }
  for (const a of root.listAnimations()) {
    if (a.getName() !== clip) continue;
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }
  const anim = doc.createAnimation(clip);
  const times = doc.createAccessor().setType('SCALAR').setArray(Float32Array.from({ length: run.frames + 1 }, (_, f) => (f / run.frames) * run.dur));
  const add = (node, what, type, values) => {
    const s = doc.createAnimationSampler().setInput(times).setOutput(doc.createAccessor().setType(type).setArray(values)).setInterpolation('LINEAR');
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(what).setSampler(s));
  };
  for (const [node, values] of out) add(node, 'rotation', 'VEC4', values);
  add(pelvis, 'translation', 'VEC3', hip);
  return `${mine.length} bones, ${run.dur.toFixed(2)} s`;
}
