// A thing to hit with, held by a body seen from outside (2026-10-25, the owner: "Make sure Melle weapons are properly
// rigged and animated"): the left hand on one held in both, and one looked over. Its blows, guard and draw are the
// body's deeds (src/game/avatar/deeds.ts, melee/cuts.ts), on the motion capture as every movement is.

import * as THREE from 'three';
import { spinOf } from '../held-mocap';
import type { Avatar } from '../avatar';

const _t = new THREE.Vector3(), _F = new THREE.Vector3(), _N = new THREE.Vector3(), _aq = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
/**
 * The left hand on something held in both: reached to where the thing's own grip says it closes (its pos, fingers and
 * palm, in the thing's space, as the right is laid in the fist), and closed round it. Whatever the right arm is doing,
 * a blow or a guard, the left goes with the thing. `w`: how much (none while it lies on the shoulder).
 */
export function holdLeft(a: Avatar, w: number) {
  const r = a.armL, held = a.inHand, g = held?.left, thing = held?.obj.children[0];
  if (!r || !g || !thing || w < 0.02) return;
  thing.updateWorldMatrix(true, false);
  _t.copy(g.pos).applyMatrix4(thing.matrixWorld);
  _F.copy(g.fingers).transformDirection(thing.matrixWorld);
  _N.copy(g.palm).transformDirection(thing.matrixWorld);
  a.reach(r, _t, _F, _N, g.curl, _aq.setFromAxisAngle(_up, a.yaw), w);
  a.curl(r, g.curl, r.hand.getWorldQuaternion(_aq));
}

const _hd = new THREE.Vector3(), _fw = new THREE.Vector3(), _rt = new THREE.Vector3(), _to = new THREE.Vector3(), _fi = new THREE.Vector3(), _pa = new THREE.Vector3(), _tq = new THREE.Quaternion();
/**
 * Something to hit with, looked over, as others see it (the `check` act a gun is looked over by): the fist brought up in
 * front of the face, its knuckles across, and the wrist turned to show one face of the thing and then the other, and
 * let back down. `k` how far through, `live` how much of it is left if it was broken off. As the first person's
 * (held-mocap.ts, lookOver).
 */
export function lookOverBody(a: Avatar, k: number, live: number) {
  const r = a.armR, held = a.inHand, s = THREE.MathUtils.smoothstep;
  const up = s(k, 0, 0.14) * (1 - s(k, 0.86, 1)) * live;
  if (!r || !held || up < 0.01 || !a.neck.length) return;
  // (a karambit is spun round the finger in its ring instead of turned over: held-mocap.ts spinOf)
  const over = held.spin ? 0 : s(k, 0.14, 0.32) - 2 * s(k, 0.42, 0.66) + s(k, 0.74, 0.88);
  if (held.spin) held.spin.rotation.x = spinOf(k);
  a.root.updateWorldMatrix(true, false);
  _aq.setFromAxisAngle(_up, a.yaw);
  _fw.set(0, 0, -1).applyQuaternion(_aq);
  _rt.set(1, 0, 0).applyQuaternion(_aq);
  a.neck[a.neck.length - 1].getWorldPosition(_hd);
  _to.copy(_hd).addScaledVector(_fw, 0.4).addScaledVector(_up, -0.2).addScaledVector(_rt, 0.06);
  // (the knuckles across to the left, the palm in toward the face: turned about the forearm, one way and the other)
  _tq.setFromAxisAngle(_fw, 1.1 * over);
  _fi.copy(_rt).negate().addScaledVector(_up, 0.3).applyQuaternion(_tq);
  _pa.copy(_fw).negate().applyQuaternion(_tq);
  a.reach(r, _to, _fi, _pa, held.curl, _aq, up);
  r.hand.updateWorldMatrix(true, false);
  a.curl(r, held.curl, r.hand.getWorldQuaternion(_tq));
}

/**
 * The guard with a thing in one fist (the right button), over the boxer's guard the body takes for it (melee/cuts.ts
 * GUARD): the fist up before the face and a little to the right, the thing raised across the face, its head up and over
 * to the left, the back of the hand and the edge out (the navigator, 2026-10-25: the hatchet "must stay in right hand
 * raised across"). `w`: how far up, less what a blow thrown from it has taken over.
 */
export function guardOne(a: Avatar, w: number) {
  const r = a.armR, held = a.inHand;
  if (!r || !held || w < 0.02 || !a.neck.length) return;
  a.root.updateWorldMatrix(true, false);
  _aq.setFromAxisAngle(_up, a.yaw);
  _fw.set(0, 0, -1).applyQuaternion(_aq);
  _rt.set(1, 0, 0).applyQuaternion(_aq);
  a.neck[a.neck.length - 1].getWorldPosition(_hd);
  _to.copy(_hd).addScaledVector(_fw, GUARD_ONE.ahead).addScaledVector(_up, GUARD_ONE.up).addScaledVector(_rt, GUARD_ONE.right);
  // (the fingers across to the left and down a little, the palm to the face: the haft through the fist leans up and over to the left)
  _fi.copy(_rt).negate().addScaledVector(_up, -GUARD_ONE.lean).normalize();
  _pa.copy(_fw).negate();
  a.reach(r, _to, _fi, _pa, held.curl, _aq, w);
  r.hand.updateWorldMatrix(true, false);
  a.curl(r, held.curl, r.hand.getWorldQuaternion(_tq));
  // (and the other fist up by the chin closed, as a boxer's is: the captured guard's hand was left open, fingers spread)
  const l = a.armL;
  if (l) a.curl(l, GUARD_FIST.map((c) => c * w) as [number, number, number, number], l.hand.getWorldQuaternion(_tq));
}
/** where that fist is from the head (metres ahead, up, to the right), and how far the thing in it leans over */
const GUARD_ONE = { ahead: 0.32, up: -0.16, right: 0.12, lean: 2.5 };
/** how far the empty hand's fingers close in that guard, first to little (radians) */
const GUARD_FIST: [number, number, number, number] = [1.35, 1.45, 1.5, 1.55];
