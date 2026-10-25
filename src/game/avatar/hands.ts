// The hands: what is held (taken up, put away), the two-bone arms reaching for grips, fingers curled and thumbs laid.
// (Methods of Avatar cut out of avatar.ts whole on 2026-10-24, so that they can be read and worked on alone: put back on
// Avatar.prototype as the file loads. Nothing in them was changed but `this: Avatar` said as the first parameter.)

import * as THREE from 'three';
import { type Grips, type HandGrip, type Curl, bent } from '../arms';
import { POSE } from './pose';
import { meleeSoon } from '../held-mocap';
import { BODY_SCALE, EAGER, GUN_ELBOW, HOLD_GONE, THUMB_BESIDE, UP, _a, _b, _ca, _ch, _cq, _cq2, _k1, _k2, _k3, _k4, _k5, _kq, _m1, _m2, _q1, _q2, _q3, _qa, _qb, buttOf, settle, Avatar, type ArmRig } from '../avatar';

export const handsMethods = {
  /** @param now at once, already in the hands: for a scene that is cut to, where nobody sees it taken up */
  setHeld(this: Avatar, obj: THREE.Object3D | null, grips: Grips | null, kind: 'rifle' | 'pistol' | 'auto' | 'melee' = 'rifle', now = false) {
    // A gun in two hands is not changed for another thing in one frame: it is lowered first (update() does
    // that, and then takes this up). Only where it could be seen: a body not yet placed, or not drawn, has it at once.
    if (now) this.holdT = obj && grips && kind !== 'melee' ? 1 : 0;
    else if (this.held && this.placed && this.root.visible && this.holdT > HOLD_GONE) {
      this.nextHeld = { obj, grips, kind };
      return;
    } else if (this.inHand?.long && this.placed && this.root.visible && obj !== this.inHand.obj.children[0]) {
      // something long in the fist is put away over the shoulder first (melee/cuts.ts DRAW), then the next taken up
      if (this.deed?.way === 'stow' || this.carry('stow')) {
        this.nextHeld = { obj, grips, kind };
        return;
      }
    }
    this.nextHeld = null;
    this.takeUp(obj, grips, kind);
  },

  takeUp(this: Avatar, obj: THREE.Object3D | null, grips: Grips | null, kind: 'rifle' | 'pistol' | 'auto' | 'melee') {
    this.heldPivot.clear();
    this.held = null;
    this.inHand?.obj.removeFromParent();
    this.inHand = null;
    if (!obj || !grips) return;
    obj.traverse((o) => {
      o.layers.mask = this.layerMask;
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    if (kind === 'melee') {
      // (its blows' paths, and its movements: the guard's and the draw's are the first wanted)
      meleeSoon();
      this.deeds?.get('drawBack');
      // A hatchet, a bat: carried in the right fist, so it swings with the arm as the body
      // walks. The grip (wrist position, finger and palm directions in the weapon's own
      // space) is laid onto the hand's own frame.
      const r = this.armR, g = grips.right;
      if (!r || !g) return;
      // the grip is written in the weapon's own space: bring it out through the weapon's own
      // placement first, so it is right however the model happens to be turned
      obj.updateMatrix();
      const P = g.pos.clone().applyMatrix4(obj.matrix);
      const F = g.fingers.clone().applyQuaternion(obj.quaternion).normalize();
      const N = g.palm.clone().applyQuaternion(obj.quaternion);
      N.sub(F.clone().multiplyScalar(N.dot(F))).normalize();
      const Lf = r.fingersLocal;
      const Lp = r.palmLocal.clone().sub(Lf.clone().multiplyScalar(r.palmLocal.dot(Lf))).normalize();
      _m1.makeBasis(F, N, new THREE.Vector3().crossVectors(F, N));
      _m2.makeBasis(Lf, Lp, new THREE.Vector3().crossVectors(Lf, Lp));
      const fist = new THREE.Group();
      fist.quaternion.setFromRotationMatrix(_m2.multiply(_m1.transpose()));
      // the hand is a bone of a scaled body: the weapon keeps its own size
      const k = 1 / BODY_SCALE;
      fist.scale.setScalar(k);
      fist.position.copy(P).applyQuaternion(fist.quaternion).multiplyScalar(-k);
      fist.add(obj);
      r.hand.add(fist);
      // (carried on the back, not in a pocket: as long as a slung thing is, and drawn from there)
      const long = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).length() > 0.5;
      this.inHand = { obj: fist, curl: g.curl, shoulder: !!g.shoulder, left: grips.left, long, spin: obj.getObjectByName('spin') ?? null };
      if (long && this.placed && this.root.visible) this.carry('draw');
      Avatar.onDressed([obj]);
      return;
    }
    this.heldPivot.add(obj);
    Avatar.onDressed([obj]);
    // (a long gun is held by its butt: one with a way of its own of being stood with has no stock, and is held by where the butt of one would be)
    const b = kind !== 'pistol' ? buttOf(obj) : null;
    const butt = b && grips.stand ? b.at.clone().setX(b.at.x - POSE.hold.stockless / obj.scale.x) : (b?.at ?? null);
    this.held = { obj, grips, long: kind !== 'pistol', base: obj.quaternion.clone(), butt, sight: b ? [b.half * obj.scale.y, b.rise * obj.scale.y] : [0.045, 0.095] };
  },

  /**
   * A joint turned to face as it is told in the world. What hangs from it is not worked out again here: every
   * question asked of a joint in the world (getWorldPosition and the rest, worldToLocal) works out its chain first,
   * and the few places that read a joint's or a thing's matrix as it stands make it current first. Worked out here,
   * every turn of the spine put the whole upper body together again, each finger once for every joint above it:
   * posing a body cost a quarter to two fifths more (2026-10-20, found fighting the infected in the game; two bodies
   * made alike and posed the same way, one each way, came out the same to the last bit over six hundred frames of
   * walking, aiming, lying, sitting, dancing and dying, with gear and guns and as the infected).
   */
  setWorldQuat(this: Avatar, bone: THREE.Object3D, world: THREE.Quaternion) {
    const pq = bone.parent!.getWorldQuaternion(_q3);
    bone.quaternion.copy(pq.invert().multiply(world));
    if (EAGER()) bone.updateMatrixWorld(true);
    else bone.updateWorldMatrix(false, false);
  },

  /** turn a bone about a world axis */
  turn(this: Avatar, bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
    bone.getWorldQuaternion(_q2);
    _q2.premultiply(_q1.setFromAxisAngle(axis, angle));
    this.setWorldQuat(bone, _q2);
  },

  /** rotate a bone (in world space) so its child moves from `from` toward `to` */
  aim(this: Avatar, bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, origin: THREE.Vector3) {
    _a.copy(from).sub(origin).normalize();
    _b.copy(to).sub(origin).normalize();
    _q1.setFromUnitVectors(_a, _b);
    bone.getWorldQuaternion(_q2);
    _q2.premultiply(_q1);
    this.setWorldQuat(bone, _q2);
  },

  /** @param slide the way a hand may move along the weapon to come within reach (unit vector), if it may */
  solveArm(this: Avatar, r: ArmRig, grip: HandGrip, weapon: THREE.Object3D, aimQ: THREE.Quaternion, slide?: THREE.Vector3, w = 1) {
    weapon.updateWorldMatrix(true, false);
    const target = grip.pos.clone().applyMatrix4(weapon.matrixWorld);
    const wq = weapon.getWorldQuaternion(new THREE.Quaternion());
    if (slide) {
      const A = r.arm.getWorldPosition(new THREE.Vector3());
      const reach = (r.la + r.lb) * 0.96;
      for (let moved = 0; moved < POSE.hold.slide && target.distanceTo(A) > reach; moved += 0.02) target.addScaledVector(slide, 0.02);
    }
    // Which way the elbow goes is said by the chest: its own right (the line of the shoulders) and its own up (the
    // line of the back), so that bladed, leaning and bent over, "out and down" is still out from these ribs and
    // down this side. Lying down, down is the ground. (Handed on as `reach` takes it: by the aim.)
    const stock = !!this.held?.butt, mine = r === this.armR, pistol = !!this.held && !this.held.long;
    const e = _k4.copy(mine ? (stock ? GUN_ELBOW.stockR : pistol ? GUN_ELBOW.pistolR : GUN_ELBOW.r) : stock ? GUN_ELBOW.stockL : pistol ? GUN_ELBOW.pistolL : GUN_ELBOW.l);
    // (a long gun carried at a run is across a square chest: the elbows as they are for a gun out in front)
    if (stock) e.lerp(mine ? GUN_ELBOW.aimR : GUN_ELBOW.aimL, this.aimT * (1 - this.proneT)).lerp(mine ? GUN_ELBOW.r : GUN_ELBOW.l, this.carryT);
    const up = this.joints.neck && this.spine[0] ? this.joints.neck.getWorldPosition(_k5).sub(this.spine[0].getWorldPosition(_k2)).normalize().lerp(UP, this.proneT).normalize() : _k5.copy(UP);
    const out = this.armR && this.armL ? this.armR.arm.getWorldPosition(_k1).sub(this.armL.arm.getWorldPosition(_k2)) : _k1.set(1, 0, 0).applyQuaternion(aimQ);
    out.addScaledVector(up, -out.dot(up)).normalize();
    const toward = _k3.crossVectors(out, up).normalize().multiplyScalar(e.z).addScaledVector(out, e.x).addScaledVector(up, e.y).applyQuaternion(_kq.copy(aimQ).invert());
    this.reach(r, target, grip.fingers.clone().applyQuaternion(wq), grip.palm.clone().applyQuaternion(wq), grip.curl, aimQ, w, toward);
  },

  /**
   * Brings a hand to a point in the world: wrist at `target`, fingers along `F`, palm facing `N`.
   * @param w how much of it: below 1 the arm is only part of the way from where the clip had it
   */
  reach(this: Avatar, r: ArmRig, target: THREE.Vector3, F: THREE.Vector3, N: THREE.Vector3, curl: Curl, aimQ: THREE.Quaternion, w = 1, toward?: THREE.Vector3) {
    const before = w < 1 ? [r.arm.quaternion.clone(), r.fore.quaternion.clone(), r.hand.quaternion.clone()] : null;
    const A = r.arm.getWorldPosition(new THREE.Vector3());
    const toT = target.clone().sub(A);
    const la = r.la, lb = r.lb;
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(la - lb) + 1e-3, (la + lb) * 0.999);
    const dir = toT.normalize();
    const cosA = (la * la + d * d - lb * lb) / (2 * la * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pole = (toward ?? r.pole).clone().applyQuaternion(aimQ);
    const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const elbow = A.clone().addScaledVector(dir, la * cosA).addScaledVector(perp, la * sinA);
    const handPos = A.clone().addScaledVector(dir, d);
    this.aim(r.arm, r.fore.getWorldPosition(new THREE.Vector3()), elbow, A);
    const E = r.fore.getWorldPosition(new THREE.Vector3());
    this.aim(r.fore, r.hand.getWorldPosition(new THREE.Vector3()), handPos, E);
    // palm / finger orientation: map the hand's local frame onto the grip frame
    F.normalize();
    N.sub(F.clone().multiplyScalar(N.dot(F))).normalize();
    const Lf = r.fingersLocal;
    const Lp = r.palmLocal.clone().sub(Lf.clone().multiplyScalar(r.palmLocal.dot(Lf))).normalize();
    _m1.makeBasis(Lf, Lp, new THREE.Vector3().crossVectors(Lf, Lp));
    _m2.makeBasis(F, N, new THREE.Vector3().crossVectors(F, N));
    const handWorld = new THREE.Quaternion().setFromRotationMatrix(_m2.multiply(_m1.transpose()));
    this.setWorldQuat(r.hand, handWorld);
    if (before) {
      [r.arm, r.fore, r.hand].forEach((b, i) => {
        _qb.copy(b.quaternion);
        b.quaternion.copy(before[i]).slerp(_qb, w);
      });
      settle(r.arm);
      r.hand.getWorldQuaternion(handWorld);
    }
    this.curl(r, curl.map((c) => (typeof c === 'number' ? c * w : c.map((j) => j * w))) as Curl, handWorld);
  },

  /**
   * Lays the thumb against the first finger, wherever the movement and the grip have left
   * that. The movements this body was given were made for a hand drawn as a mitten: they close
   * the fingers and leave the thumb out straight, which on a hand with a real thumb is a
   * spike standing out of every fist. Done last, on both hands, every frame.
   */
  thumb(this: Avatar, r: ArmRig) {
    const first = r.fingers[0], little = r.fingers[3];
    if (r.thumb.length < 4 || first.length < 3 || !little.length) return;
    // Everything here is in the hand's own space, worked from the joints' own turns: nothing
    // of the world is read or brought up to date. (Done by where things are in the world it
    // cost a tenth of a millisecond a body, every body, every frame.)
    const hand = r.hand;
    const at = (b: THREE.Object3D) => {
      const p = new THREE.Vector3();
      for (let o: THREE.Object3D | null = b; o && o !== hand; o = o.parent) p.applyQuaternion(o.quaternion).add(o.position);
      return p;
    };
    const [t1, t2, t3, tip] = r.thumb;
    const p1 = at(first[0]), p2 = at(first[1]), p3 = at(first[2]);
    // out to the thumb's side of the hand: from the little finger's knuckle to the first's
    const side = p1.clone().sub(at(little[0])).normalize();
    // how far closed the first finger is: its first bone against its second (0 straight, 1 square to it or more)
    const closed = THREE.MathUtils.clamp(1 - _a.copy(p2).sub(p1).normalize().dot(_b.copy(p3).sub(p2).normalize()), 0, 1);
    // its pad: beside the first bone of that finger on an open hand, beside the middle one on a closed
    const pad = p1.clone().lerp(p2, 0.7).lerp(p2.clone().lerp(p3, 0.45), closed).addScaledVector(side, THUMB_BESIDE);
    const c = at(t1), l1 = t2.position.length(), l2 = t3.position.length(), l3 = tip.position.length();
    const knuckle = bent(c, pad, l1, (l2 + l3) * 0.92, side);
    const joint = bent(knuckle, pad, l2, l3, side);
    // each joint is turned, in the hand's space, so that the next lies where it should: `Q` is how the bone before it stands there
    const Q = _qa.identity();
    for (let o: THREE.Object3D | null = t1.parent; o && o !== hand; o = o.parent) Q.premultiply(o.quaternion);
    let from = c;
    for (const [bone, next, to] of [[t1, t2, knuckle], [t2, t3, joint], [t3, tip, pad]] as const) {
      const now = _a.copy(next.position).applyQuaternion(_q1.copy(Q).multiply(bone.quaternion)).normalize();
      const want = _b.copy(to).sub(from).normalize();
      // (turned in the hand's space, then said in the space of the bone it hangs from)
      const turn = _q2.setFromUnitVectors(now, want);
      bone.quaternion.copy(_q3.copy(Q).invert().multiply(turn).multiply(Q).multiply(bone.quaternion));
      Q.multiply(bone.quaternion);
      from = from.clone().add(_a.copy(next.position).applyQuaternion(Q));
    }
  },

  /** close the fingers toward the palm, each by its own amount */
  curl(this: Avatar, r: ArmRig, curl: Curl, handWorld: THREE.Quaternion) {
    const Lf = r.fingersLocal;
    const Lp = r.palmLocal.clone().sub(Lf.clone().multiplyScalar(r.palmLocal.dot(Lf))).normalize();
    const curlAxis = new THREE.Vector3().crossVectors(Lf, Lp).applyQuaternion(handWorld).normalize();
    // (the hand's own turn in the world as it stands, read once)
    const hand = r.hand.getWorldQuaternion(_ch);
    r.fingers.forEach((chain, fi) => {
      const c = curl[fi];
      if (!chain.length) return;
      // Each joint turned about the same line in the world, as `turn` did, worked out down the finger from the turns
      // alone: `turn` walked up the whole body twice for every joint (thirty a pair of hands, every frame for every
      // infected in sight). A turn about a line in the world is the same turn about that line seen from the joint's
      // parent: the parent's own turn in the world is carried down the finger as each joint is turned.
      const parent = chain[0].parent!;
      const pw = parent === r.hand ? _cq.copy(hand) : parent.getWorldQuaternion(_cq);
      chain.forEach((bone, j) => {
        // (one figure closes the whole finger as a fist closes; three say each joint, for a finger laid round something with a shape of its own)
        const a = typeof c === 'number' ? c * (j === 0 ? 0.8 : j === 1 ? 1.1 : 0.8) : c[j] ?? 0;
        _ca.copy(curlAxis).applyQuaternion(_cq2.copy(pw).invert());
        bone.quaternion.premultiply(_q1.setFromAxisAngle(_ca, a));
        pw.multiply(bone.quaternion);
      });
      settle(chain[0]);
    });
  },
};
