// First-person arms. The forearm and hand geometry is cut out of the survivor's body
// (3-joint fingers + thumb) and posed every frame with analytic
// two-bone IK so the hands sit on the weapon's grip points, with palm orientation and
// finger curl per hand. Because the targets live in weapon space, hands follow every
// bob, recoil kick, bolt cycle and reload animation automatically.

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { loadCharacter, lookPatch, lookUniforms, setLookUniforms, type Look } from './look';

/** A hand placement in weapon (model) space: wrist position, finger direction, palm normal. */
export interface HandGrip {
  pos: THREE.Vector3;
  fingers: THREE.Vector3;
  palm: THREE.Vector3;
  /** curl (radians) per joint for [index, middle, ring, pinky]; thumb separately */
  curl: [number, number, number, number];
  thumb: number;
  /** 0..1: fold the thumb across the curled fingers (a closed fist) */
  tuck?: number;
}

export interface Grips {
  right: HandGrip | null;
  left: HandGrip | null;
}

interface Arm {
  arm: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  la: number;
  lb: number;
  /** wrist to middle knuckle */
  lh: number;
  fingersLocal: THREE.Vector3;
  palmLocal: THREE.Vector3;
  fingers: THREE.Bone[][]; // [index, middle, ring, pinky] each 3 joints
  thumb: THREE.Bone[];
  /** toward the thumb side of the hand, in the hand's own space */
  radialLocal: THREE.Vector3;
  pole: THREE.Vector3; // elbow hint in camera space
  /** virtual shoulder in camera space (upper arms are not rendered, so this is free) */
  shoulder: THREE.Vector3;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();

/** the arms are a little smaller than life: at this distance from the lens full size fills the screen */
const ARM_SCALE = 0.86;

export class FPArms {
  root = new THREE.Group();
  private model!: THREE.Object3D;
  private bones = new Map<string, THREE.Bone>();
  private rest = new Map<THREE.Bone, { p: THREE.Vector3; q: THREE.Quaternion }>();
  private right!: Arm;
  private left!: Arm;
  private meshes: THREE.SkinnedMesh[] = [];
  private uniforms = lookUniforms();

  async load() {
    const gltf = await loadCharacter();
    this.model = SkeletonUtils.clone(gltf.scene);
    // the model faces +Z, the camera -Z; its head sits just behind the eye
    this.model.rotation.y = Math.PI;
    this.model.position.set(0, -1.6, 0.06);
    this.model.scale.multiplyScalar(ARM_SCALE);
    this.root.add(this.model);

    this.model.traverse((o) => {
      const b = o as THREE.Bone;
      if (b.isBone) this.bones.set(b.name, b);
    });
    // the model is stored at rest in a T-pose: arms out, palms down
    for (const b of this.bones.values()) this.rest.set(b, { p: b.position.clone(), q: b.quaternion.clone() });

    // keep only the forearm + hand triangles of the body mesh
    this.model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!(o as THREE.Mesh).isMesh) return;
      if (!sm.isSkinnedMesh || sm.name !== 'body') {
        sm.visible = false;
        return;
      }
      const armSet = new Set<number>();
      sm.skeleton.bones.forEach((b, i) => {
        // upper arms sit right against the lens and read as blobs
        if (/^(lowerarm|hand|index|middle|ring|pinky|thumb)_/.test(b.name)) armSet.add(i);
      });
      const g = sm.geometry.clone();
      const si = g.getAttribute('skinIndex');
      const sw = g.getAttribute('skinWeight');
      const dominant = (v: number) => {
        let best = 0, bi = -1;
        for (let k = 0; k < 4; k++) {
          const w = sw.getComponent(v, k);
          if (w > best) {
            best = w;
            bi = si.getComponent(v, k);
          }
        }
        return bi;
      };
      const src = g.index!.array;
      const keep: number[] = [];
      for (let t = 0; t < src.length; t += 3) {
        if (armSet.has(dominant(src[t])) && armSet.has(dominant(src[t + 1])) && armSet.has(dominant(src[t + 2]))) keep.push(src[t], src[t + 1], src[t + 2]);
      }
      g.setIndex(keep);
      sm.geometry = g;
      sm.frustumCulled = false;
      sm.castShadow = false;
      // the same jacket sleeves and skin as this player's body
      const mat = (sm.material as THREE.MeshStandardMaterial).clone();
      const uniforms = this.uniforms;
      mat.onBeforeCompile = (shader) => lookPatch(shader, uniforms);
      mat.customProgramCacheKey = () => 'fp-arms';
      sm.material = mat;
      this.meshes.push(sm);
    });

    this.right = this.makeArm('r', new THREE.Vector3(0.75, -1, 0.35), new THREE.Vector3(0.26, -0.4, 0.12));
    this.left = this.makeArm('l', new THREE.Vector3(-0.9, -0.8, 0.15), new THREE.Vector3(-0.22, -0.36, -0.12));
    this.root.visible = false;
  }

  /** Sleeves and skin of this player (see look.ts). */
  setLook(look: Look) {
    setLookUniforms(this.uniforms, look);
  }

  private makeArm(side: 'l' | 'r', pole: THREE.Vector3, shoulder: THREE.Vector3): Arm {
    const B = (n: string) => this.bones.get(`${n}_${side}`)!;
    const arm = B('upperarm'), fore = B('lowerarm'), hand = B('hand');
    this.resetPose();
    this.model.updateMatrixWorld(true);
    const at = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3());
    const pa = at(arm), pf = at(fore), ph = at(hand), pm = at(B('middle_01'));
    // hand frame in its own local space: along the fingers, and out of the palm (from the
    // hand's own shape: across the knuckles, index to pinky)
    const hq = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
    const fingersW = pm.clone().sub(ph).normalize();
    const palmW = new THREE.Vector3().crossVectors(fingersW, at(B('pinky_01')).sub(at(B('index_01')))).normalize();
    if (side === 'l') palmW.negate();
    const radialLocal = at(B('index_01')).sub(at(B('pinky_01'))).normalize().applyQuaternion(hq);
    const fingersLocal = fingersW.applyQuaternion(hq);
    const palmLocal = palmW.applyQuaternion(hq);
    const fingers = ['index', 'middle', 'ring', 'pinky'].map((f) => [1, 2, 3].map((i) => B(`${f}_0${i}`)).filter(Boolean));
    // the last entry is only the thumb's tip, to aim the last joint at
    const thumb = [1, 2, 3].map((i) => B(`thumb_0${i}`)).filter(Boolean);
    const tip = B('thumb_04_leaf');
    if (tip) thumb.push(tip);
    return { radialLocal, arm, fore, hand, la: pa.distanceTo(pf), lb: pf.distanceTo(ph), lh: pm.distanceTo(ph), fingersLocal, palmLocal, fingers, thumb, pole: pole.normalize(), shoulder };
  }

  private resetPose() {
    // forEach avoids allocating an [entry] tuple per bone every frame
    this.rest.forEach((r, b) => {
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
    });
  }

  /** rotate a bone (in world space) so its child moves from `from` toward `to` */
  private aim(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3, origin: THREE.Vector3) {
    _v1.copy(from).sub(origin).normalize();
    _v2.copy(to).sub(origin).normalize();
    _q1.setFromUnitVectors(_v1, _v2);
    bone.getWorldQuaternion(_q2);
    _q2.premultiply(_q1);
    this.setWorldQuat(bone, _q2);
  }

  private setWorldQuat(bone: THREE.Bone, world: THREE.Quaternion) {
    const pq = bone.parent!.getWorldQuaternion(_q3);
    bone.quaternion.copy(pq.invert().multiply(world));
    bone.updateMatrixWorld(true);
  }

  private solve(a: Arm, grip: HandGrip, weapon: THREE.Object3D, camQ: THREE.Quaternion) {
    weapon.updateMatrixWorld(true);
    // move the shoulder joint to its camera-space anchor
    const target = grip.pos.clone().applyMatrix4(weapon.matrixWorld);
    const sw = this.root.localToWorld(a.shoulder.clone());
    // upper arms are never drawn, so slide the virtual shoulder in when the grip is out
    // of reach: the hand always lands on the gun and the forearm keeps its entry angle
    const reach = (a.la + a.lb) * 0.93;
    if (sw.distanceTo(target) > reach) sw.sub(target).setLength(reach).add(target);
    a.arm.position.copy(a.arm.parent!.worldToLocal(sw));
    a.arm.updateMatrixWorld(true);
    const wq = weapon.getWorldQuaternion(new THREE.Quaternion());
    const A = a.arm.getWorldPosition(new THREE.Vector3());
    // two-bone IK: elbow on the plane spanned by shoulder->target and the pole hint
    const toT = target.clone().sub(A);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a.la - a.lb) + 1e-3, (a.la + a.lb) * 0.999);
    const dir = toT.normalize();
    const cosA = (a.la * a.la + d * d - a.lb * a.lb) / (2 * a.la * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pole = a.pole.clone().applyQuaternion(camQ);
    const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const elbow = A.clone().addScaledVector(dir, a.la * cosA).addScaledVector(perp, a.la * sinA);
    const handPos = A.clone().addScaledVector(dir, d);

    this.aim(a.arm, a.fore.getWorldPosition(_v3).clone(), elbow, A);
    const E = a.fore.getWorldPosition(new THREE.Vector3());
    this.aim(a.fore, a.hand.getWorldPosition(_v3).clone(), handPos, E);

    // palm / finger orientation: map the hand's local frame onto the grip frame
    const F = grip.fingers.clone().applyQuaternion(wq).normalize();
    const N = grip.palm.clone().applyQuaternion(wq);
    N.sub(F.clone().multiplyScalar(N.dot(F))).normalize();
    const Lf = a.fingersLocal, Lp = a.palmLocal.clone().sub(a.fingersLocal.clone().multiplyScalar(a.palmLocal.dot(a.fingersLocal))).normalize();
    _m1.makeBasis(Lf, Lp, new THREE.Vector3().crossVectors(Lf, Lp));
    _m2.makeBasis(F, N, new THREE.Vector3().crossVectors(F, N));
    const handWorld = new THREE.Quaternion().setFromRotationMatrix(_m2.multiply(_m1.transpose()));
    this.setWorldQuat(a.hand, handWorld);

    // finger curl toward the palm
    // rotating the finger direction about (fingers x palm) swings fingertips toward the palm side
    const curlAxis = new THREE.Vector3().crossVectors(Lf, Lp).applyQuaternion(handWorld).normalize();
    a.fingers.forEach((chain, fi) => {
      const c = grip.curl[fi];
      chain.forEach((bone, j) => {
        const ang = c * (j === 0 ? 0.8 : j === 1 ? 1.1 : 0.8);
        bone.getWorldQuaternion(_q2);
        _q2.premultiply(_q1.setFromAxisAngle(curlAxis, ang));
        this.setWorldQuat(bone, _q2);
      });
    });
    // The thumb is laid out from the hand's own shape rather than turned from wherever the
    // rig leaves it: out to the side of the index finger, swung toward the palm by the grip,
    // each joint a little further round and a little more along the fingers.
    {
      const Fh = Lf.clone().applyQuaternion(handWorld), Nh = Lp.clone().applyQuaternion(handWorld);
      const R = a.radialLocal.clone().applyQuaternion(handWorld);
      R.sub(Fh.clone().multiplyScalar(R.dot(Fh))).sub(Nh.clone().multiplyScalar(R.dot(Nh))).normalize();
      for (let j = 0; j < a.thumb.length - 1; j++) {
        const along = 0.95 - j * 0.22, round = grip.thumb * (1.1 + j * 0.5);
        const want = Fh.clone().multiplyScalar(Math.cos(along)).addScaledVector(R, Math.sin(along) * Math.cos(round)).addScaledVector(Nh, Math.sin(along) * Math.sin(round));
        const o = a.thumb[j].getWorldPosition(new THREE.Vector3());
        this.aim(a.thumb[j], a.thumb[j + 1].getWorldPosition(new THREE.Vector3()), o.clone().add(want), o);
      }
    }
    if (grip.tuck) {
      // closed fist: bend the thumb over the front of the curled fingers
      const wrist = a.hand.getWorldPosition(new THREE.Vector3());
      const target = wrist.clone().addScaledVector(F, a.lh * 0.92).addScaledVector(N, a.lh * 0.5);
      for (let j = 0; j < a.thumb.length - 1; j++) {
        const o = a.thumb[j].getWorldPosition(new THREE.Vector3());
        const child = a.thumb[j + 1].getWorldPosition(new THREE.Vector3());
        const to = child.clone().lerp(target, grip.tuck * (j === 0 ? 0.75 : 1));
        this.aim(a.thumb[j], child, to, o);
      }
    }
  }

  /** Pose the arms onto `weapon` (the object whose local space the grips are written in). */
  update(weapon: THREE.Object3D | null, grips: Grips | null, camQ: THREE.Quaternion, visible: boolean) {
    this.root.visible = visible && !!weapon && !!grips;
    if (!this.root.visible || !weapon || !grips) return;
    this.resetPose();
    this.model.updateMatrixWorld(true);
    // arms not holding anything drop out of view
    if (grips.right) this.solve(this.right, grips.right, weapon, camQ);
    else this.hide(this.right);
    if (grips.left) this.solve(this.left, grips.left, weapon, camQ);
    else this.hide(this.left);
  }

  private hide(a: Arm) {
    // fold the arm down behind the camera
    a.arm.getWorldQuaternion(_q2);
    a.arm.getWorldPosition(_v3);
    const down = new THREE.Vector3(0, -1, 0.4).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
    this.aim(a.arm, a.fore.getWorldPosition(new THREE.Vector3()), _v3.clone().add(down), _v3);
  }
}
