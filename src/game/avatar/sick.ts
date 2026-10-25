// The infected's own way of going: feet kept on the ground, the sick gait.
// (Methods of Avatar cut out of avatar.ts whole on 2026-10-24, so that they can be read and worked on alone: put back on
// Avatar.prototype as the file loads. Nothing in them was changed but `this: Avatar` said as the first parameter.)

import * as THREE from 'three';
import { CLAW, UP, _aimQ, _fwd, _head, _q1, _q2, _q3, _qa, _qb, _right, _v1, _v2, _v3, settle, settleDown, strikeShare, type Avatar } from '../avatar';

export const sickMethods = {
  /** a turn about a world axis that leaves the bones below it to be brought up to date later, all at once */
  lean(this: Avatar, bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
    bone.getWorldQuaternion(_q2).premultiply(_q1.setFromAxisAngle(axis, angle));
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(_q3).invert().multiply(_q2));
  },

  /**
   * The infected stand on their feet. Their movements were drawn for other legs than each of
   * these bodies has, and the lean laid over them tips the hips: left alone, the feet hang a
   * hand's breadth off the ground with their toes down. So the whole body is let down (or
   * lifted) until the nearer ankle is as high as it was made to be; and a foot that is down is
   * laid the way it was made to lie, heel and toe on the ground. A foot in the air mid-stride
   * is left to the movement.
   */
  plant(this: Avatar, dt: number) {
    const pelvis = this.joints.pelvis;
    if (!pelvis || this.soles.length < 2) return;
    settle(this.root);
    const ground = this.root.position.y;
    let gap = Infinity;
    for (const s of this.soles) gap = Math.min(gap, s.foot.getWorldPosition(_v1).y - ground - s.high);
    // (it comes to its feet over a few frames, not at once: the nearer foot changes as it walks)
    this.sunk += (THREE.MathUtils.clamp(gap, -0.15, 0.3) - this.sunk) * (1 - Math.exp(-14 * dt));
    const up = pelvis.parent!.getWorldScale(_v2).y || 1;
    _v1.set(0, -this.sunk / up, 0).applyQuaternion(pelvis.parent!.getWorldQuaternion(_q3).invert());
    pelvis.position.add(_v1);
    settleDown(pelvis);
    for (const s of this.soles) {
      const at = s.foot.getWorldPosition(_v1), off = at.y - ground - s.high;
      const down = 1 - THREE.MathUtils.smoothstep(off, 0.03, 0.14);
      if (down < 0.02) continue;
      // (and its toes lie on it as they were made: bent up by a movement drawn for a boot, a bare foot is a claw)
      s.ball.quaternion.slerp(s.toe, down);
      // How the foot would lie if the body stood here just as it was made, turned about to point the way this
      // foot points over the ground: that is how a foot that is down lies. (Level, and on the flat of its sole:
      // neither tipped onto its toes nor rolled onto its edge.)
      const made = _q2.copy(this.modelRoot.getWorldQuaternion(_q1)).multiply(s.made);
      const here = s.foot.getWorldQuaternion(_q3);
      const now = _v2.copy(s.ball.position).applyQuaternion(here), was = _v3.copy(s.ball.position).applyQuaternion(made);
      if (Math.hypot(now.x, now.z) < 1e-5 || Math.hypot(was.x, was.z) < 1e-5) continue;
      made.premultiply(_qa.setFromAxisAngle(UP, Math.atan2(now.x, now.z) - Math.atan2(was.x, was.z)));
      here.slerp(made, down);
      s.foot.quaternion.copy(s.foot.parent!.getWorldQuaternion(_qb).invert().multiply(here));
      settleDown(s.foot);
    }
  },

  /**
   * The carriage of the infected, laid over whatever movement is playing: the back bent,
   * the head hung over to one side and rolling, and once it is roused the arms held out at
   * whoever it is after and thrown at them when it strikes.
   */
  sicken(this: Avatar, dt: number) {
    const s = this.sick!;
    const t = this.clock + s.seed;
    const aimQ = _aimQ.setFromAxisAngle(UP, this.yaw);
    const fwd = _fwd.set(0, 0, -1).applyQuaternion(aimQ);
    _right.set(1, 0, 0).applyQuaternion(aimQ);
    const side = s.seed % 2 < 1 ? 1 : -1;
    const slack = 1 - s.roused;
    // At a walk it limps: once a stride the hips roll over the bad leg and the back goes with them.
    const going = THREE.MathUtils.clamp(this.speed / 0.5, 0, 1) * slack;
    const limp = Math.sin(this.phase * Math.PI * 2) * going;
    // Standing it is never still: a slow sway, and every few seconds something goes through it.
    const sway = Math.sin(t * 0.83) * 0.035 + Math.sin(t * 1.9) * 0.02;
    const jerk = Math.pow(Math.max(0, Math.sin(t * 0.61 + s.seed)), 40) * Math.sin(t * 31) * 0.1;
    const pelvis = this.joints.pelvis;
    if (pelvis) {
      this.lean(pelvis, fwd, side * (0.05 + limp * 0.12));
      this.lean(pelvis, UP, side * 0.1 * slack + limp * 0.09);
    }
    // (about its right, a turn the positive way tips the body back: forward is the other)
    for (const b of this.spine) this.lean(b, _right, -(0.1 + 0.03 * s.roused + 0.03 * going) + sway * 0.4);
    if (this.spine[1]) this.lean(this.spine[1], fwd, side * 0.08 - limp * 0.08 + sway + jerk);
    const head = this.neck[this.neck.length - 1];
    if (head) {
      this.lean(head, fwd, side * (0.32 - 0.14 * s.roused) + Math.sin(t * 0.7) * 0.08 + jerk * 2);
      this.lean(head, _right, 0.22 * s.roused - 0.12);
    }
    // The hands are not fists: the fingers hang half closed, and are hooked when it is after
    // somebody. (Whatever the movement playing has done with them is put aside first.)
    for (const r of [this.armR, this.armL]) r?.fingers.forEach((chain, f) => chain.forEach((b, j) => b.quaternion.copy(r.open[f][j])));
    // one arm hangs, the other is carried bent and jumps when the rest of it does
    const carried = side > 0 ? this.armL : this.armR;
    if (carried && slack > 0.02) this.lean(carried.fore, _right, (0.5 + jerk * 3) * slack);
    // (a blow is the library's drawing of one, laid over the body before this: the arms are left to it while it lasts)
    const strike = 0;
    let given = 0;
    if (s.claw >= 0) {
      s.claw += dt;
      const k = s.claw / CLAW;
      if (k >= 1) s.claw = -1;
      else given = strikeShare(k);
    }
    const w = s.roused * 0.9 * (1 - given);
    if (w < 0.02 || !this.armR || !this.armL || !head) {
      for (const r of [this.armR, this.armL]) if (r) this.curl(r, [0.5, 0.58, 0.66, 0.74], r.hand.getWorldQuaternion(_qa));
      return;
    }
    settle(this.root);
    const from = head.getWorldPosition(_head);
    const at = (f: number, u: number, r: number) => new THREE.Vector3().copy(from).addScaledVector(fwd, f).addScaledVector(UP, u).addScaledVector(_right, r);
    const dirOf = (f: number, u: number, r: number) => new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(UP, u).addScaledVector(_right, r);
    for (const sd of [1, -1] as const) {
      // one arm higher than the other, both groping; in the blow they go up together and come down in front of the chest
      const uneven = sd === side ? 0.07 : -0.05;
      const grope = Math.sin(t * 3.1 + sd) * 0.03;
      const out = at(0.42 + grope, -0.2 + uneven, sd * 0.2);
      const to = strike < 0 ? out.lerp(at(0.24, 0.16, sd * 0.24), -strike * 2) : out.lerp(at(0.5, -0.5, sd * 0.1), strike);
      const F = dirOf(1, -0.25 - Math.max(0, strike) * 0.8, -sd * 0.1);
      const N = dirOf(-0.2, -1, -sd * 0.15);
      this.reach(sd > 0 ? this.armR : this.armL, to, F, N, [0.5, 0.58, 0.66, 0.74], aimQ, w);
    }
  },
};
