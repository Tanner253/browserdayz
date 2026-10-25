// The player's skeleton posed frame by frame from a movement in its file, and three things done to a movement there
// (for scripts/mocap.mjs): started where the left heel comes down, so that movements of different ways blend in step;
// stood up out of a crouch, its feet kept where they were stepped; and trimmed to the part of it that is wanted.
import * as THREE from 'three';

const V = (a) => new THREE.Vector3(...a), Q = (a) => new THREE.Quaternion(...a);

export function skeleton(doc) {
  const root = doc.getRoot();
  const J = root.listSkins()[0].listJoints();
  const at = new Map(J.map((j, i) => [j, i]));
  const parent = J.map((j) => (at.has(j.getParentNode()) ? at.get(j.getParentNode()) : -1));
  const order = J.map((_, i) => i).sort((a, b) => depth(a) - depth(b));
  function depth(i) {
    let d = 0;
    for (let p = parent[i]; p >= 0; p = parent[p]) d++;
    return d;
  }
  const restT = J.map((j) => V(j.getTranslation())), restQ = J.map((j) => Q(j.getRotation())), restS = J.map((j) => V(j.getScale()));
  const above = J.map((j, i) => (parent[i] < 0 ? new THREE.Matrix4().fromArray(j.getParentNode()?.getWorldMatrix() ?? new THREE.Matrix4().toArray()) : null));
  const index = (n) => J.findIndex((j) => j.getName() === n);
  /** every joint's place and turn in the file, from each joint's own turn (and the hips' place) */
  const pose = (q, pelvisT) => {
    const W = new Array(J.length);
    const P = index('pelvis');
    for (const i of order) {
      const local = new THREE.Matrix4().compose(i === P && pelvisT ? pelvisT : restT[i], q[i] ?? restQ[i], restS[i]);
      W[i] = (parent[i] < 0 ? above[i].clone() : W[parent[i]].clone()).multiply(local);
    }
    return W;
  };
  return { J, parent, restT, restQ, index, pose };
}

/** a movement of the file as frames: each joint's turn (or null: as it rests) and the hips' place */
export function readClip(doc, sk, name) {
  const anim = doc.getRoot().listAnimations().find((a) => a.getName() === name);
  let times = null;
  const rot = new Map();
  let hips = null;
  for (const c of anim.listChannels()) {
    const s = c.getSampler(), t = s.getInput().getArray(), v = s.getOutput().getArray(), i = sk.J.indexOf(c.getTargetNode());
    if (t.length <= 2) continue;
    times = t;
    if (c.getTargetPath() === 'rotation') rot.set(i, { c, v });
    else if (c.getTargetPath() === 'translation') hips = { c, v };
  }
  const frames = times.length - 1, dur = times[frames];
  const qAt = (f) => sk.J.map((_, i) => (rot.has(i) ? Q(rot.get(i).v.subarray(f * 4, f * 4 + 4)) : null));
  const tAt = (f) => V(hips.v.subarray(f * 3, f * 3 + 3));
  return { anim, rot, hips, frames, dur, qAt, tAt };
}

/** frames written back: `Q[f][i]` the turns, `T[f]` the hips' place, at `dur` seconds over them all */
export function writeClip(doc, clip, Q, T, dur) {
  const n = Q.length;
  const times = doc.createAccessor().setType('SCALAR').setArray(Float32Array.from({ length: n }, (_, f) => (f / (n - 1)) * dur));
  for (const [i, { c }] of clip.rot) {
    const v = new Float32Array(n * 4);
    for (let f = 0; f < n; f++) v.set([Q[f][i].x, Q[f][i].y, Q[f][i].z, Q[f][i].w], f * 4);
    c.getSampler().setInput(times).setOutput(doc.createAccessor().setType('VEC4').setArray(v));
  }
  const v = new Float32Array(n * 3);
  for (let f = 0; f < n; f++) v.set([T[f].x, T[f].y, T[f].z], f * 3);
  clip.hips.c.getSampler().setInput(times).setOutput(doc.createAccessor().setType('VEC3').setArray(v));
  // (the hands' constant turns keep their two keys, at the new length)
  for (const c of clip.anim.listChannels()) {
    const s = c.getSampler();
    if (s.getInput().getCount() === 2) s.setInput(doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, dur])));
  }
}

const frameOf = (clip) => {
  const Q = [], T = [];
  for (let f = 0; f <= clip.frames; f++) {
    Q.push(clip.qAt(f));
    T.push(clip.tAt(f));
  }
  return { Q, T };
};

/** which way is the body's left in the file (+1: +x) */
export function leftOf(sk) {
  const W = sk.pose([], null);
  return Math.sign(new THREE.Vector3().setFromMatrixPosition(W[sk.index('thigh_l')]).x);
}

/** the way a movement goes, in the file: the body faces +z */
export function wayOf(dir, left) {
  const v = new THREE.Vector3();
  if (dir.includes('F')) v.z += 1;
  if (dir.includes('B')) v.z -= 1;
  if (dir.includes('L')) v.x += left;
  if (dir.includes('R')) v.x -= left;
  return v.normalize();
}

/**
 * A loop made to start where the left foot is furthest out the way the body goes: its heel coming down. Every loop
 * of every way starts there, so two blended are in step (a step forward and a step to the side make one to the
 * corner, and not a shuffle).
 */
export function heelFirst(doc, sk, name, way) {
  const clip = readClip(doc, sk, name);
  const { Q, T } = frameOf(clip);
  const L = sk.index('ball_l'), P = sk.index('pelvis'), n = clip.frames;
  let best = 0, far = -Infinity;
  for (let f = 0; f < n; f++) {
    const W = sk.pose(Q[f], T[f]);
    const s = new THREE.Vector3().setFromMatrixPosition(W[L]).sub(new THREE.Vector3().setFromMatrixPosition(W[P])).dot(way);
    if (s > far) { far = s; best = f; }
  }
  const q2 = [], t2 = [];
  for (let f = 0; f < n; f++) {
    q2.push(Q[(f + best) % n]);
    t2.push(T[(f + best) % n]);
  }
  q2.push(q2[0]);
  t2.push(t2[0]);
  writeClip(doc, clip, q2, t2, clip.dur);
  return best / n;
}

/** part of a movement done once: from `a` to `b` seconds */
export function trim(doc, sk, name, a, b) {
  const clip = readClip(doc, sk, name);
  const { Q, T } = frameOf(clip);
  const fa = Math.max(0, Math.round((a / clip.dur) * clip.frames)), fb = Math.min(clip.frames, Math.round((b / clip.dur) * clip.frames));
  writeClip(doc, clip, Q.slice(fa, fb + 1), T.slice(fa, fb + 1), ((fb - fa) / clip.frames) * clip.dur);
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const posOf = (m) => new THREE.Vector3().setFromMatrixPosition(m);
const rotOf = (m) => {
  const q = new THREE.Quaternion();
  m.decompose(_p, q, _s);
  return q;
};

/** how far a line across the body (left to right) is turned about the upright from how it lies at rest, radians */
function yawOf(W, rest, a, b) {
  const now = posOf(W[b]).sub(posOf(W[a])).setY(0).normalize(), was = posOf(rest[b]).sub(posOf(rest[a])).setY(0).normalize();
  return Math.atan2(new THREE.Vector3().crossVectors(was, now).y, was.dot(now));
}

/**
 * A movement squared to the front: its chest turned to face ahead, its hips as far as `keep` leaves them (0: square,
 * 1: as they were), the feet left where it stepped them (each leg worked out again to reach its foot, its knee bent the
 * way it was) and turned half way back with the hips. Most of the library is done side-on, an archer's walk, a stance
 * with a gun at the hip: a chest that is not to the front is not behind the gun the arms hold up, and a body turned to
 * one side cannot be blended with one turned to the other.
 * With `ref`, a crouched movement stood up too: the hips raised to the height `ref` carries them at, and the chest
 * brought up to lean as that one's does. What comes of it is the same steps, taken standing and facing ahead: the
 * library steps sideways only crouched, and a gun held up is walked sideways standing, facing the aim.
 */
export function reshape(doc, sk, name, { keep = 0, ref = null } = {}) {
  const clip = readClip(doc, sk, name), other = readClip(doc, sk, ref ?? name);
  const { Q, T } = frameOf(clip);
  const n = clip.frames + 1;
  const P = sk.index('pelvis'), S = ['spine_01', 'spine_02', 'spine_03'].map(sk.index), NECK = sk.index('neck_01');
  const legs = ['l', 'r'].map((s) => ['thigh', 'calf', 'foot'].map((b) => sk.index(`${b}_${s}`)));
  const [TL, TR, CL, CR] = ['thigh_l', 'thigh_r', 'upperarm_l', 'upperarm_r'].map(sk.index);
  const rest = sk.pose([], null), len = legs.map(([a, b, c]) => [posOf(rest[b]).distanceTo(posOf(rest[a])), posOf(rest[c]).distanceTo(posOf(rest[b]))]);
  const parentQ = (W, i) => rotOf(W[sk.parent[i]]);
  const turnWorld = (f, i, q) => {
    const W = sk.pose(Q[f], T[f]);
    Q[f][i] = parentQ(W, i).invert().multiply(q.clone().multiply(rotOf(W[i]))).normalize();
  };
  const UP = new THREE.Vector3(0, 1, 0);
  // where the feet were stepped, and how they were turned, before anything is moved
  const feet = [];
  for (let f = 0; f < n; f++) {
    const W = sk.pose(Q[f], T[f]);
    feet.push(legs.map(([a, b, c]) => ({ at: posOf(W[c]), turn: rotOf(W[c]), bend: posOf(W[b]).sub(posOf(W[a]).add(posOf(W[c])).multiplyScalar(0.5)) })));
  }
  // squared: the hips turned back to the front by as much as they are turned on the whole, the chest the rest of its way
  let hips = 0, chest = 0;
  for (let f = 0; f < n; f++) {
    const W = sk.pose(Q[f], T[f]);
    hips += yawOf(W, rest, TL, TR) / n;
    chest += yawOf(W, rest, CL, CR) / n;
  }
  const turn = hips * (1 - keep);
  for (let f = 0; f < n; f++) {
    turnWorld(f, P, new THREE.Quaternion().setFromAxisAngle(UP, -turn));
    for (const i of S) turnWorld(f, i, new THREE.Quaternion().setFromAxisAngle(UP, -(chest - turn) / S.length));
  }
  // how high the other carries the hips, and how far its chest leans forward (in the file the body faces +z)
  const lean = (W) => {
    const d = posOf(W[NECK]).sub(posOf(W[S[0]]));
    return Math.atan2(d.z, d.y);
  };
  let hy = 0, ly = 0, oh = 0, ol = 0;
  for (let f = 0; f <= other.frames; f++) {
    const W = sk.pose(other.qAt(f), other.tAt(f));
    oh += posOf(W[P]).y / (other.frames + 1);
    ol += lean(W) / (other.frames + 1);
  }
  for (let f = 0; f < n; f++) {
    const W = sk.pose(Q[f], T[f]);
    hy += posOf(W[P]).y / n;
    ly += lean(W) / n;
  }
  // (no higher than leaves every leg a bend: a straight one locks and pops)
  let up = ref ? oh - hy : 0;
  for (let f = 0; f < n; f++) {
    const W = sk.pose(Q[f], T[f]);
    legs.forEach(([a], k) => {
      const hip = posOf(W[a]), foot = feet[f][k].at, most = (len[k][0] + len[k][1]) * 0.985;
      // the most the hip can rise over this foot: where its distance comes to `most`
      const flat = Math.hypot(hip.x - foot.x, hip.z - foot.z), rise = Math.sqrt(Math.max(0, most * most - flat * flat)) - (hip.y - foot.y);
      if (ref) up = Math.min(up, rise);
    });
  }
  const tilt = ref ? ol - ly : 0;
  // (the feet turned half way back with the hips: a side step opens the feet, but not side-on)
  const toes = new THREE.Quaternion().setFromAxisAngle(UP, -turn * 0.5);
  for (let f = 0; f < n; f++) {
    const W0 = sk.pose(Q[f], T[f]);
    // the hips up (in the hips' parent's own measure)
    T[f] = T[f].clone().add(new THREE.Vector3(0, up, 0).applyQuaternion(parentQ(W0, P).invert()).divide(new THREE.Vector3().setFromMatrixScale(W0[sk.parent[P]])));
    // the chest up, a third at each joint of the spine, about the body's side
    for (const i of S) turnWorld(f, i, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt / S.length));
    // each leg to its foot: thigh toward the knee, shin toward the ankle, the foot turned as it was (and back a little)
    legs.forEach(([a, b, c], k) => {
      let W = sk.pose(Q[f], T[f]);
      const hip = posOf(W[a]), to = feet[f][k].at, [la, lb] = len[k];
      const d = Math.min(hip.distanceTo(to), (la + lb) * 0.999);
      const along = _a.copy(to).sub(hip).normalize();
      const bend = feet[f][k].bend.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(UP, -turn));
      const side = _b.copy(bend).addScaledVector(along, -bend.dot(along)).normalize();
      const x = (la * la - lb * lb + d * d) / (2 * d), h = Math.sqrt(Math.max(0, la * la - x * x));
      const knee = hip.clone().addScaledVector(along, x).addScaledVector(side, h);
      const aim = (i, from, toward, kid) => {
        W = sk.pose(Q[f], T[f]);
        const now = posOf(W[kid]).sub(posOf(W[i])).normalize(), want = _c.copy(toward).sub(from).normalize();
        const world = new THREE.Quaternion().setFromUnitVectors(now, want).multiply(rotOf(W[i]));
        Q[f][i] = parentQ(W, i).invert().multiply(world).normalize();
      };
      aim(a, hip, knee, b);
      aim(b, knee, to, c);
      W = sk.pose(Q[f], T[f]);
      Q[f][c] = parentQ(W, c).invert().multiply(toes.clone().multiply(feet[f][k].turn)).normalize();
    });
  }
  writeClip(doc, clip, Q, T, clip.dur);
  return { up: +up.toFixed(3), tilt: +tilt.toFixed(3), turned: +turn.toFixed(3), chest: +chest.toFixed(3) };
}

/** how far a movement has the hips and the chest turned from the front, on the whole, radians (to the body's left: +) */
export function facing(doc, sk, name) {
  const clip = readClip(doc, sk, name), rest = sk.pose([], null);
  const [TL, TR, CL, CR] = ['thigh_l', 'thigh_r', 'upperarm_l', 'upperarm_r'].map(sk.index);
  let hips = 0, chest = 0;
  for (let f = 0; f <= clip.frames; f++) {
    const W = sk.pose(clip.qAt(f), clip.tAt(f));
    hips += yawOf(W, rest, TL, TR) / (clip.frames + 1);
    chest += yawOf(W, rest, CL, CR) / (clip.frames + 1);
  }
  return { hips: +hips.toFixed(2), chest: +chest.toFixed(2) };
}
