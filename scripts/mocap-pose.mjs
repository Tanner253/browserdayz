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

/**
 * A movement stooped: the chest bent forward from the hips by `angle` (radians, a third at each joint of the spine), the
 * head and the upper arms turned back by as much, so that the eyes are where they looked and the arms hang and swing
 * as they did. The walk's upper body laid over the crouch's legs (src/game/avatar/gait.ts), as a body crouched carries
 * its chest.
 */
export function stoop(doc, sk, name, angle) {
  const clip = readClip(doc, sk, name), { Q, T } = frameOf(clip), n = clip.frames + 1;
  const S = ['spine_01', 'spine_02', 'spine_03'].map(sk.index), back = ['neck_01', 'upperarm_l', 'upperarm_r'].map(sk.index);
  const side = new THREE.Vector3(1, 0, 0);
  const turnWorld = (f, i, q) => {
    const W = sk.pose(Q[f], T[f]);
    Q[f][i] = rotOf(W[sk.parent[i]]).invert().multiply(q.clone().multiply(rotOf(W[i]))).normalize();
  };
  for (let f = 0; f < n; f++) {
    for (const i of S) turnWorld(f, i, new THREE.Quaternion().setFromAxisAngle(side, angle / S.length));
    for (const i of back) turnWorld(f, i, new THREE.Quaternion().setFromAxisAngle(side, -angle));
  }
  writeClip(doc, clip, Q, T, clip.dur);
}

/**
 * A movement stood still with its soles flat on the ground: each foot laid as it lies at rest, turned only about the up
 * as the movement turns it, its ankle as high as it stands at rest (the heel on the ground, the ball too), and the leg
 * worked out again to reach it, the knee bent the way it was. The library's calm idle stood rocked back 21 degrees on
 * its heels, the ball of the foot 3.5 cm off the ground and the heel 2 cm into it: the owner, 2026-10-25, "The feet".
 * With `soft` (radians), the hips raised (by one height for the whole of it, so it keeps its own rise and fall) until
 * the knees are bent that far on the whole: stood flat, the idle's knees were bent a third of a right angle and more, a
 * half-crouch and not a body at ease (the navigator, 2026-10-25).
 */
export function flat(doc, sk, name, { soft = null } = {}) {
  const clip = readClip(doc, sk, name), { Q, T } = frameOf(clip), n = clip.frames + 1;
  const rest = sk.pose([], null), UP = new THREE.Vector3(0, 1, 0);
  const parentQ = (W, i) => rotOf(W[sk.parent[i]]);
  if (soft !== null) {
    // how high each hip joint stands over its foot laid flat, with its knee bent `soft`: the hips raised the mean of
    // what that asks of each frame's lower leg
    const P = sk.index('pelvis');
    let up = 0;
    for (let f = 0; f < n; f++) {
      const W = sk.pose(Q[f], T[f]);
      let need = Infinity;
      for (const s of ['l', 'r']) {
        const [a, b, c] = ['thigh', 'calf', 'foot'].map((x) => sk.index(`${x}_${s}`));
        const la = posOf(rest[b]).distanceTo(posOf(rest[a])), lb = posOf(rest[c]).distanceTo(posOf(rest[b]));
        const d = Math.sqrt(la * la + lb * lb + 2 * la * lb * Math.cos(soft)), hip = posOf(W[a]), foot = posOf(W[c]).setY(posOf(rest[c]).y);
        const flatWay = Math.hypot(hip.x - foot.x, hip.z - foot.z);
        need = Math.min(need, foot.y + Math.sqrt(Math.max(0, d * d - flatWay * flatWay)) - hip.y);
      }
      up += need / n;
    }
    for (let f = 0; f < n; f++) {
      const W = sk.pose(Q[f], T[f]);
      T[f] = T[f].clone().add(new THREE.Vector3(0, up, 0).applyQuaternion(parentQ(W, P).invert()).divide(new THREE.Vector3().setFromMatrixScale(W[sk.parent[P]])));
    }
  }
  const aim = (f, i, from, toward, kid) => {
    const W = sk.pose(Q[f], T[f]);
    const now = posOf(W[kid]).sub(posOf(W[i])).normalize(), want = toward.clone().sub(from).normalize();
    Q[f][i] = parentQ(W, i).invert().multiply(new THREE.Quaternion().setFromUnitVectors(now, want).multiply(rotOf(W[i]))).normalize();
  };
  for (const s of ['l', 'r']) {
    const [a, b, c, ball] = ['thigh', 'calf', 'foot', 'ball'].map((x) => sk.index(`${x}_${s}`));
    const la = posOf(rest[b]).distanceTo(posOf(rest[a])), lb = posOf(rest[c]).distanceTo(posOf(rest[b]));
    const restToe = posOf(rest[ball]).sub(posOf(rest[c])).setY(0).normalize(), restTurn = rotOf(rest[c]), high = posOf(rest[c]).y;
    for (let f = 0; f < n; f++) {
      let W = sk.pose(Q[f], T[f]);
      // (which way the foot points now, about the up: the toe's way along the ground)
      const toe = posOf(W[ball]).sub(posOf(W[c])).setY(0).normalize();
      const yaw = Math.atan2(new THREE.Vector3().crossVectors(restToe, toe).y, restToe.dot(toe));
      const hip = posOf(W[a]), to = posOf(W[c]).setY(high);
      const d = Math.min(hip.distanceTo(to), (la + lb) * 0.999), along = to.clone().sub(hip).normalize();
      const bend = posOf(W[b]).sub(hip.clone().add(to).multiplyScalar(0.5));
      const side = bend.addScaledVector(along, -bend.dot(along)).normalize();
      const x = (la * la - lb * lb + d * d) / (2 * d), h = Math.sqrt(Math.max(0, la * la - x * x));
      const knee = hip.clone().addScaledVector(along, x).addScaledVector(side, h);
      aim(f, a, hip, knee, b);
      W = sk.pose(Q[f], T[f]);
      aim(f, b, posOf(W[b]), to, c);
      W = sk.pose(Q[f], T[f]);
      Q[f][c] = parentQ(W, c).invert().multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw).multiply(restTurn)).normalize();
    }
  }
  writeClip(doc, clip, Q, T, clip.dur);
}

/**
 * A movement's shoulders let down and its arms hung at the sides: each collarbone turned down until the shoulder stands
 * over the top of the spine, on the whole, `drop` metres under where it rests (by one turn for the whole of it, so it
 * keeps its own rise and fall), the upper arm kept hanging the way it hung, then brought `inward` (radians) toward the
 * body. The library's idle and walks carry the shoulders 4 to 10 cm up toward the ears as captured, the arms hung out
 * from the body: the owner, 2026-10-25, "survivors in this image look like their shoulders are all bunched up".
 */
export function relax(doc, sk, name, { drop = 0, inward = 0 } = {}) {
  const clip = readClip(doc, sk, name), { Q, T } = frameOf(clip), n = clip.frames + 1;
  const rest = sk.pose([], null), C = sk.index('spine_03'), FWD = new THREE.Vector3(0, 0, 1);
  const parentQ = (W, i) => rotOf(W[sk.parent[i]]);
  const aim = (f, i, from, toward, kid) => {
    const W = sk.pose(Q[f], T[f]);
    const now = posOf(W[kid]).sub(posOf(W[i])).normalize(), want = toward.clone().sub(from).normalize();
    Q[f][i] = parentQ(W, i).invert().multiply(new THREE.Quaternion().setFromUnitVectors(now, want).multiply(rotOf(W[i]))).normalize();
  };
  for (const [s, out] of [['l', 1], ['r', -1]]) {
    const [K, U, L] = ['clavicle', 'upperarm', 'lowerarm'].map((x) => sk.index(`${x}_${s}`));
    const restRise = posOf(rest[U]).y - posOf(rest[C]).y;
    // (how far up the shoulder rides on the whole, over where it rests and what is asked)
    let over = 0;
    for (let f = 0; f < n; f++) {
      const W = sk.pose(Q[f], T[f]);
      over += (posOf(W[U]).y - posOf(W[C]).y - restRise + drop) / n;
    }
    if (over <= 0 && !inward) continue;
    for (let f = 0; f < n; f++) {
      let W = sk.pose(Q[f], T[f]);
      const arm = posOf(W[L]).sub(posOf(W[U]));
      if (over > 0) aim(f, K, posOf(W[K]), posOf(W[U]).add(new THREE.Vector3(0, -over, 0)), U);
      W = sk.pose(Q[f], T[f]);
      // (the upper arm hung as it was, and turned in toward the body: about the body's front, the left one to its right)
      arm.applyAxisAngle(FWD, -out * inward);
      const shoulder = posOf(W[U]);
      aim(f, U, shoulder, shoulder.clone().add(arm), L);
    }
  }
  writeClip(doc, clip, Q, T, clip.dur);
}

/**
 * A loop's planted feet laid flat: each foot turned, about its ankle, toward how it lies at rest (its own way about the
 * up kept), by how near its ankle is to the lowest it goes in the loop (all of it within 3 cm of that, none from 8 cm).
 * As captured, the walks and the crouch put the foot down and stood on it toes up, 17 to 23 degrees, the ball of it 8
 * cm off the ground: the owner, 2026-10-25, "players feet still dont sit flat on the ground it seems they like to make
 * the toes point up".
 */
export function plant(doc, sk, name) {
  const clip = readClip(doc, sk, name), { Q, T } = frameOf(clip), n = clip.frames + 1;
  const rest = sk.pose([], null), UP = new THREE.Vector3(0, 1, 0);
  for (const s of ['l', 'r']) {
    const [c, ball] = ['foot', 'ball'].map((x) => sk.index(`${x}_${s}`));
    const restToe = posOf(rest[ball]).sub(posOf(rest[c])).setY(0).normalize(), restTurn = rotOf(rest[c]);
    let low = Infinity;
    for (let f = 0; f < n; f++) low = Math.min(low, posOf(sk.pose(Q[f], T[f])[c]).y);
    for (let f = 0; f < n; f++) {
      const W = sk.pose(Q[f], T[f]), y = posOf(W[c]).y - low;
      const w = 1 - THREE.MathUtils.smoothstep(y, 0.03, 0.08);
      if (w < 1e-3) continue;
      const toe = posOf(W[ball]).sub(posOf(W[c])).setY(0).normalize();
      const flatQ = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(new THREE.Vector3().crossVectors(restToe, toe).y, restToe.dot(toe))).multiply(restTurn);
      Q[f][c] = rotOf(W[sk.parent[c]]).invert().multiply(rotOf(W[c]).slerp(flatQ, w)).normalize();
    }
  }
  writeClip(doc, clip, Q, T, clip.dur);
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
 * With `ref`, a lower movement stood up too: the hips raised to the height `ref` carries them at, and the chest
 * brought up to lean as that one's does. What comes of it is the same steps, taken standing and facing ahead.
 * With `head`, the body let down (or raised) until its head is that high on the whole, the chest leaning as it did:
 * a crouch as low as the game's own, whose eye is a crouched body's eye (see EYE_CROUCH in src/game/player.ts). What
 * is shot at on a body is where its head is drawn: a crouch drawn higher than the eye stood up out of cover.
 */
export function reshape(doc, sk, name, { keep = 0, ref = null, head = null } = {}) {
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
  // (no higher than leaves every leg a bend, a straight one locks and pops; but 5 cm whatever, a trailing foot's heel
  // coming up as it pushes off, as a heel does)
  let up = ref ? oh - hy : 0;
  if (head !== null) {
    const HEAD = sk.index('Head');
    let hh = 0;
    for (let f = 0; f < n; f++) hh += posOf(sk.pose(Q[f], T[f])[HEAD]).y / n;
    up = head - hh;
  }
  for (let f = 0; f < n; f++) {
    const W = sk.pose(Q[f], T[f]);
    legs.forEach(([a], k) => {
      const hip = posOf(W[a]), foot = feet[f][k].at, most = (len[k][0] + len[k][1]) * 0.985;
      // the most the hip can rise over this foot: where its distance comes to `most`
      const flat = Math.hypot(hip.x - foot.x, hip.z - foot.z), rise = Math.sqrt(Math.max(0, most * most - flat * flat)) - (hip.y - foot.y);
      if (ref || up > 0) up = Math.min(up, Math.max(rise, 0.05));
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

/**
 * Which way a loop really goes, and how fast, as it is once made (a library movement's name does not always say which
 * way its steps go: its 'Walk_Left_with_Gun' steps to the right): read from whichever toe is the lower, the one down,
 * travelling back under the hips (a walk's: a run's feet are both off the ground a while, and read short).
 * @returns m/s along the ground, and degrees to the body's left of its front
 */
export function goes(doc, sk, name) {
  const clip = readClip(doc, sk, name), P = sk.index('pelvis'), n = clip.frames;
  const at = [];
  for (let f = 0; f <= n; f++) {
    const W = sk.pose(clip.qAt(f), clip.tAt(f)), p = posOf(W[P]).setY(0);
    at.push(['ball_l', 'ball_r'].map((b) => posOf(W[sk.index(b)]).sub(p)));
  }
  const way = new THREE.Vector3();
  let frames = 0;
  for (let f = 0; f < n; f++) {
    const k = at[f][0].y < at[f][1].y ? 0 : 1;
    if ((at[f + 1][0].y < at[f + 1][1].y ? 0 : 1) !== k) continue;
    way.add(at[f][k].clone().sub(at[f + 1][k]).setY(0));
    frames++;
  }
  return { pace: +(way.length() / Math.max(1e-6, (frames * clip.dur) / n)).toFixed(3), deg: Math.round((Math.atan2(way.x, way.z) * 180) / Math.PI) };
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
