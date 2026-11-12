// The arms at the things they do of their own: fists up on guard and a punch thrown from it, the hands at work on
// something that is not a weapon (food, a drink, a dressing), and the wheel's calls (a wave, a point, hands up). Laid
// over the body after its clips and its gun, each frame (see update.ts).

import * as THREE from 'three';
import { POSE, type Gesture, type Move } from './pose';
import { CUT, UP, _aimQ, _fwd, _head, _right, _v2, settle, type Avatar, type ArmRig } from '../avatar';
import { jabAt } from '../held-mocap';
import { MOCAP_HANDS } from '../mocap-switch';
import { PALM_BACK } from '../in-fist';
import { ITEMS, isBag } from '../../sim/items';

/**
 * Where a thing being used goes, from the head (ahead, up, right; metres): held before the chest, its top at the lips,
 * a bag held up over the shoulder; the left wrist with its forearm held out for a shot or a drip, and how far out
 * from that forearm's middle its skin is.
 */
const USE = { rest: [0.3, -0.42, 0.1], lips: [0.1, -0.03, 0], bag: [0.22, 0.1, 0.24], arm: [0.3, -0.27, 0.12], skin: 0.04 };

/** how much of a movement of the hands is left, if it was broken off: 1 until then */
const left = (m: { t: number; stop?: number } | null) => (m?.stop === undefined ? 1 : 1 - THREE.MathUtils.smoothstep(m.t, m.stop - CUT, m.stop));

export const gesturesMethods = {
  gestures(this: Avatar, dt: number, dead: boolean, using: boolean, ges: { kind: Gesture; t: number; dur: number; stop?: number } | null, mv: { kind: Move; t: number; dur: number; stop?: number } | null, pitch: number) {
      // --- bare hands: a guard, the left leading, and a punch thrown from it
      if (this.fistsT > 0.02 && this.armR && this.armL && this.neck.length) {
        let out = 0, wind = 0;
        if (this.punchT >= 0) {
          this.punchT += dt;
          const k = this.punchT / POSE.punch[0];
          if (k >= 1) this.punchT = -1;
          else {
            // the same shape as the first-person arms throw: drawn back, out fast, held, home slower
            wind = Math.sin(Math.PI * Math.min(1, k / 0.14));
            const go = THREE.MathUtils.clamp((k - 0.06) / 0.22, 0, 1);
            out = (1 - Math.pow(1 - go, 3)) * (1 - THREE.MathUtils.smootherstep(k, 0.42, 1));
            // (or the motion capture's jab: see src/game/mocap-switch.ts)
            if (MOCAP_HANDS) ({ out, wind } = jabAt(this.punchSide > 0 ? 1 : -1, k));
          }
        }
        const side = this.punchT >= 0 ? this.punchSide : 0;
        // the shoulder goes in behind the punch
        if (this.chest) this.turn(this.chest, UP, side * (side > 0 ? 0.38 : 0.26) * out - side * 0.08 * wind * (1 - out));
        settle(this.root);
        const aimQ = _aimQ.setFromAxisAngle(UP, this.yaw);
        const fwd = _fwd.set(0, 0, -1).applyQuaternion(aimQ);
        _right.set(1, 0, 0).applyQuaternion(aimQ);
        const head = this.neck[this.neck.length - 1].getWorldPosition(_head);
        const at = (f: number, u: number, r: number) => new THREE.Vector3().copy(head).addScaledVector(fwd, f).addScaledVector(UP, u).addScaledVector(_right, r);
        const dirOf = (f: number, u: number, r: number) => new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(UP, u).addScaledVector(_right, r);
        for (const s of [1, -1] as const) {
          const strike = s === side ? out : 0;
          // the right fist by the chin, the left a hand's length out in front of it
          const guard = s > 0 ? at(0.2, -0.2, 0.13) : at(0.3, -0.16, -0.11);
          const end = s > 0 ? at(0.64, -0.13, 0.02) : at(0.62, -0.11, -0.03);
          const to = guard.lerp(end, strike);
          if (s === side) to.addScaledVector(fwd, -0.05 * wind * (1 - out));
          // palms in toward each other in the guard; the fist turns over, palm down, as it goes out
          const F = dirOf(0.5, 0.8, -s * 0.2).lerp(dirOf(1, 0.1, -s * 0.15), strike);
          const N = dirOf(-0.3, -0.1, -s).lerp(dirOf(0, -1, -s * 0.2), strike);
          this.reach(s > 0 ? this.armR : this.armL, to, F, N, [1.7, 1.72, 1.74, 1.76], aimQ, this.fistsT);
        }
      }

      // --- hands busy with something that is not a weapon (and a saw at a log, a charge armed: what they hold stays in
      // the fist for those, so they are not `using`, but the arms are at the work all the same. Kept out of this, the saw
      // stood still in the hand while a log was sawn: the owner, 2026-10-26)
      if (ges && (using || ges.kind === 'saw' || ges.kind === 'arm') && this.armR && this.armL && this.neck.length) {
        settle(this.root);
        const aimQ = _aimQ.setFromAxisAngle(UP, this.yaw);
        const fwd = _fwd.set(0, 0, -1).applyQuaternion(aimQ);
        _right.set(1, 0, 0).applyQuaternion(aimQ);
        const head = this.neck[this.neck.length - 1].getWorldPosition(_head);
        // a point measured from the head: ahead of it, above it, to its right
        const at = (f: number, u: number, r: number) => new THREE.Vector3().copy(head).addScaledVector(fwd, f).addScaledVector(UP, u).addScaledVector(_right, r);
        const dirOf = (f: number, u: number, r: number) => new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(UP, u).addScaledVector(_right, r);
        const wgt = THREE.MathUtils.smoothstep(ges.t, 0, 0.3) * (1 - THREE.MathUtils.smoothstep(ges.t, ges.dur - 0.25, ges.dur)) * left(ges);
        // (No hand is sent further than its arm goes with a bend left in it. These places are measured from the head,
        // and crouched the head is further from the shoulders: the arms went out dead straight and stopped short.)
        const near = (to: THREE.Vector3, r: ArmRig) => {
          const from = r.arm.getWorldPosition(_v2), d = to.distanceTo(from), most = (r.la + r.lb) * 0.93;
          return d > most ? to.sub(from).multiplyScalar(most / d).add(from) : to;
        };
        // What is being used, in the right fist (useThing): the hand is set by where the thing is to be and which way
        // its top points, not the other way about. Everybody saw an empty fist bob to the chin before, 2026-11-11 (the
        // owner: "the first person as well as 3rd perosn interactions for som eitems are not looking very good, or
        // realistic").
        const thing = this.used?.fist.visible ? this.used : null, R = this.armR, L = this.armL;
        const use = thing ? ITEMS[thing.id]?.use : undefined;
        /** the right hand round the thing, its middle at `c`, its top along `u`, the fingers round it toward `f` */
        const palmed = (c: THREE.Vector3, u: THREE.Vector3, f: THREE.Vector3) => {
          u.normalize();
          const F = f.addScaledVector(u, -f.dot(u)).normalize(), N = new THREE.Vector3().crossVectors(u, F);
          const wrist = c.clone().addScaledVector(N, -(0.012 + thing!.size.x / 2)).addScaledVector(F, -PALM_BACK);
          this.reach(R, near(wrist, R), F, N, thing!.curl, aimQ, wgt);
        };
        /** the left forearm held out across the front, palm down, for the right to work on: its middle, and up off it */
        const forearm = () => {
          this.reach(L, near(at(USE.arm[0], USE.arm[1], USE.arm[2]), L), dirOf(0.35, -0.05, 1), dirOf(0, -1, 0), [0.35, 0.4, 0.45, 0.5], aimQ, wgt);
          const elbow = L.fore.getWorldPosition(new THREE.Vector3()), wrist = L.hand.getWorldPosition(new THREE.Vector3());
          const way = wrist.clone().sub(elbow).normalize(), up = UP.clone().addScaledVector(way, -UP.dot(way)).normalize();
          return { mid: elbow.lerp(wrist, 0.55), up };
        };
        const sip = MOCAP_HANDS && !thing && (ges.kind === 'eat' || ges.kind === 'drink') ? this.deeds?.get('drink') : undefined;
        if (sip) {
          // (on the motion capture: the arms and the chest of somebody drinking, a sip after a sip: see src/game/mocap-switch.ts)
          this.layer(sip, ges.t % sip.getClip().duration, wgt, 0);
        } else if (thing && (ges.kind === 'eat' || ges.kind === 'drink')) {
          // Up from the chest to the lips and back, once a bite or a gulp: a tin tipped to them, a bottle tipped up at
          // them, its top at the lips either way.
          const drink = ges.kind === 'drink', period = drink ? 1.6 : 1.1;
          const cyc = 0.5 - 0.5 * Math.cos((Math.max(0, ges.t - 0.3) / period) * Math.PI * 2);
          const m = THREE.MathUtils.smoothstep(cyc, 0, drink ? 0.6 : 0.8);
          const u = dirOf(0.15, 1, 0).lerp(drink ? dirOf(-0.85, -0.3, -0.1) : dirOf(-0.75, 0.65, -0.1), m).normalize();
          const lips = at(USE.lips[0], USE.lips[1], USE.lips[2]);
          const c = at(USE.rest[0], USE.rest[1], USE.rest[2]).lerp(lips.addScaledVector(u, -thing.size.y / 2), m);
          palmed(c, u, dirOf(1, 0.2 * m, -0.3));
        } else if (thing && ges.kind === 'bandage' && isBag(thing.id)) {
          // a bag held up over the shoulder to run into the left forearm held out
          forearm();
          palmed(at(USE.bag[0], USE.bag[1] + Math.sin(ges.t * 1.3) * 0.01, USE.bag[2]), UP.clone(), fwd.clone());
        } else if (thing && ges.kind === 'bandage' && use?.sound === 'inject') {
          // a shot into the left forearm held out: the injector stood on it, pressed, held while it empties, let go
          const f = forearm(), dur = ges.dur;
          const press = THREE.MathUtils.smoothstep(ges.t, 0.45, 0.7) * (1 - THREE.MathUtils.smoothstep(ges.t, dur - 0.5, dur - 0.25));
          palmed(f.mid.clone().addScaledVector(f.up, USE.skin + thing.size.y / 2 + 0.04 * (1 - press)), f.up.clone().negate(), fwd.clone());
        } else if (ges.kind === 'eat' || ges.kind === 'drink') {
          // up to the mouth and back down, once a bite or a gulp
          const period = ges.kind === 'eat' ? 0.95 : 1.25;
          const cyc = 0.5 - 0.5 * Math.cos((Math.max(0, ges.t - 0.3) / period) * Math.PI * 2);
          const m = ges.kind === 'drink' ? Math.pow(cyc, 0.6) : cyc;
          this.reach(this.armR, near(at(0.3, -0.36, 0.12).lerp(at(0.17, -0.06, 0.05), m), this.armR), dirOf(-0.2 * m, 0.8, -0.5), dirOf(-1, 0, -0.4), [1.0, 1.05, 1.1, 1.15], aimQ, wgt);
        } else if (ges.kind === 'saw') {
          // a log sawn at the feet: the left hand braced on it, the right and its saw drawn forward and back (the owner,
          // 2026-10-25: "sawing animation is moving the hand and arm forweward and backward with the saw attached")
          // (crouched over it: the head is under a metre up, the log's top a fifth of one)
          this.reach(this.armL, near(at(0.42, -0.72, -0.18), this.armL), dirOf(1, -0.3, 0.2), dirOf(0, -1, 0), [0.5, 0.55, 0.6, 0.65], aimQ, wgt);
          const r = at(0.5 + Math.sin((ges.t * Math.PI * 2) / 0.7) * 0.14, -0.62, 0.16);
          // (the fingers pointed down at the log: the blade runs on from them a little above, teeth to the wood)
          this.reach(this.armR, near(r, this.armR), dirOf(1, -0.95, 0), dirOf(-0.2, 0, -1), [1.4, 1.45, 1.5, 1.5], aimQ, wgt);
        } else if (ges.kind === 'arm') {
          // a charge armed in front of the chest: in the right hand, its keys pressed by the left's first finger a beat at
          // a time (the owner, 2026-10-25: "touching the c4 multiple times like input buttons")
          const r = near(at(0.34, -0.42, 0.08), this.armR);
          this.reach(this.armR, r, dirOf(0.5, 0.1, -1), dirOf(0, 1, 0), [1.0, 1.05, 1.1, 1.15], aimQ, wgt);
          const p = (ges.t % 0.34) / 0.34, down = Math.sin(Math.min(1, p / 0.5) * Math.PI);
          const l = r.clone().addScaledVector(UP, 0.09 - down * 0.03).addScaledVector(_right, -0.05 + Math.sin(ges.t * 3.1) * 0.02);
          this.reach(this.armL, near(l, this.armL), dirOf(0.35, -0.85, 0.4), dirOf(0.2, -0.6, 0.75), [0.05, 1.3, 1.4, 1.45], aimQ, wgt);
        } else {
          // both hands in front of the belly: the left held still, the right working round it
          const l = near(at(0.28, -0.4, -0.07), this.armL);
          this.reach(this.armL, l, dirOf(1, 0, 0.6), dirOf(0, 1, 0), [0.5, 0.55, 0.6, 0.65], aimQ, wgt);
          const a = ges.t * (ges.kind === 'bandage' ? 5.5 : 9);
          const r = l.clone().addScaledVector(_right, 0.08).addScaledVector(UP, 0.05 + Math.cos(a) * 0.045).addScaledVector(fwd, 0.02 + Math.sin(a) * 0.045);
          this.reach(this.armR, near(r, this.armR), dirOf(0.4, 0, -1), dirOf(0, -1, 0), [0.9, 0.95, 1, 1.05], aimQ, wgt);
        }
      }

      // --- a call from the wheel, or the hands kept up: the arms say it as well
      if (!dead && (mv || this.handsT > 0.02) && this.armR && this.armL && this.neck.length) {
        settle(this.root);
        const aimQ = _aimQ.setFromAxisAngle(UP, this.yaw);
        const fwd = _fwd.set(0, 0, -1).applyQuaternion(aimQ);
        _right.set(1, 0, 0).applyQuaternion(aimQ);
        const head = this.neck[this.neck.length - 1].getWorldPosition(_head);
        const at = (f: number, u: number, r: number) => new THREE.Vector3().copy(head).addScaledVector(fwd, f).addScaledVector(UP, u).addScaledVector(_right, r);
        const dirOf = (f: number, u: number, r: number) => new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(UP, u).addScaledVector(_right, r);
        const open: [number, number, number, number] = [0.12, 0.1, 0.12, 0.18];
        const R = this.armR, L = this.armL;
        const arm = (s: number) => (s > 0 ? R : L);
        // hands up beside the head, palms out, and kept there
        if (this.handsT > 0.02) {
          const tire = Math.sin(this.clock * 1.3) * 0.012;
          for (const s of [1, -1]) this.reach(arm(s), at(0.1, 0.2 + tire * s, s * 0.34), dirOf(0, 1, s * 0.12), dirOf(1, 0, 0), open, aimQ, this.handsT);
        }
        if (mv) {
          const k = mv.t;
          const wgt = THREE.MathUtils.smoothstep(k, 0, 0.22) * (1 - THREE.MathUtils.smoothstep(k, mv.dur - 0.3, mv.dur)) * (1 - this.handsT) * left(mv);
          if (mv.kind === 'wave') {
            // a hand up beside the head, waved from the elbow
            const s = Math.sin(k * 16);
            this.reach(R, at(0.14, 0.3, 0.33 + s * 0.11), dirOf(0, 1, s * 0.45), dirOf(1, 0, 0), open, aimQ, wgt);
          } else if (mv.kind === 'beckon') {
            // the whole arm over the head, swung wide and slow: made to be seen from a long way off
            const s = Math.sin(k * 10.5);
            this.reach(R, at(0.06, 0.46, 0.2 + s * 0.24), dirOf(0, 1, s * 0.6), dirOf(1, 0, 0), open, aimQ, wgt);
          } else if (mv.kind === 'distress') {
            // both arms over the head, crossing and parting
            const s = Math.sin(k * 11);
            for (const side of [1, -1]) this.reach(arm(side), at(0.06, 0.44, side * (0.24 + s * 0.2)), dirOf(0, 1, side * s * 0.5), dirOf(1, 0, 0), open, aimQ, wgt);
          } else if (mv.kind === 'palms') {
            // both hands shown, open and empty, in front of the shoulders
            const s = Math.sin(k * 9) * 0.02;
            for (const side of [1, -1]) this.reach(arm(side), at(0.3, -0.12 + s, side * 0.3), dirOf(0.2, 1, side * 0.15), dirOf(1, 0, 0), open, aimQ, wgt);
          } else if (mv.kind === 'point') {
            // the arm out straight the way they are looking, one finger along it
            const up = Math.sin(pitch);
            this.reach(R, at(0.6, -0.22 + up * 0.5, 0.2), dirOf(1, up, 0), dirOf(0, -1, 0), [0.05, 1.5, 1.6, 1.7], aimQ, wgt);
          } else if (mv.kind === 'nod' || mv.kind === 'shake') {
            // yes and no: the head, twice over (the hands left where they are)
            const headBone = this.neck[this.neck.length - 1];
            const s = Math.sin(k * (mv.kind === 'nod' ? 11 : 13));
            this.turn(headBone, mv.kind === 'nod' ? _right : UP, (mv.kind === 'nod' ? -0.24 : 0.36) * s * wgt);
          } else if (mv.kind === 'halt') {
            // wait: the right hand held up and out, palm to whoever it is said to
            this.reach(R, at(0.42, -0.04, 0.2), dirOf(0.15, 1, 0), dirOf(1, 0, 0), open, aimQ, wgt);
          } else if (mv.kind === 'down') {
            // get down: both hands out low, palms down, pressed down twice
            const s = Math.abs(Math.sin(k * 7)) * 0.07;
            for (const side of [1, -1]) this.reach(arm(side), at(0.34, -0.42 - s, side * 0.26), dirOf(1, 0, side * 0.15), dirOf(0, -1, 0), open, aimQ, wgt);
          } else if (mv.kind === 'back') {
            // behind you: the right thumb jerked back over the shoulder
            const s = Math.sin(k * 9) * 0.04;
            this.reach(R, at(0.08 + s, -0.02, 0.34), dirOf(-1, 0.35, 0.2), dirOf(0, 0, 1), [0.9, 1.4, 1.5, 1.6], aimQ, wgt);
          } else {
            // two fingers to the brow, and away
            const out = THREE.MathUtils.smoothstep(k, mv.dur * 0.45, mv.dur * 0.75);
            this.reach(R, at(0.13, 0.03, 0.17).lerp(at(0.34, 0.08, 0.36), out), dirOf(0.1, 0.5, -0.85).lerp(dirOf(0.6, 0.7, -0.2), out), dirOf(0.3, -0.9, 0), [0.1, 0.12, 1.4, 1.5], aimQ, wgt);
          }
        }
      }
  },
};
