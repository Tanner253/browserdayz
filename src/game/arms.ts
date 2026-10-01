// First-person arms. The arm/hand geometry is cut out of the animated survivor
// (Mixamo skeleton: 3-joint fingers + thumb) and posed every frame with analytic
// two-bone IK so the hands sit on the weapon's grip points, with palm orientation and
// finger curl per hand. Because the targets live in weapon space, hands follow every
// bob, recoil kick, bolt cycle and reload animation automatically.

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { assets } from '../core/assets';

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

export class FPArms {
  root = new THREE.Group();
  private model!: THREE.Object3D;
  private bones = new Map<string, THREE.Bone>();
  private rest = new Map<THREE.Bone, { p: THREE.Vector3; q: THREE.Quaternion }>();
  private right!: Arm;
  private left!: Arm;
  private meshes: THREE.SkinnedMesh[] = [];

  async load() {
    const gltf = await assets.loadGLTF('assets/characters/soldier.glb');
    this.model = SkeletonUtils.clone(gltf.scene);
    // the rig faces -Z like the camera; head sits just behind the eye
    // viewmodel cheat: shoulders a little ahead of and below the eye so elbows bend naturally
    this.model.position.set(0, -1.6, -0.06);
    // the survivor rig has oversized gauntlets; scale the whole arm rig down a touch
    this.model.scale.multiplyScalar(0.84);
    this.root.add(this.model);

    this.model.traverse((o) => {
      const b = o as THREE.Bone;
      if (b.isBone) this.bones.set(b.name.replace('mixamorig', ''), b);
    });

    // T-pose from the bundled clip gives a known rest (palms down, arms out)
    const tpose = gltf.animations.find((a) => a.name === 'TPose');
    if (tpose) {
      const mixer = new THREE.AnimationMixer(this.model);
      mixer.clipAction(tpose).play();
      mixer.update(0);
      mixer.stopAllAction();
    }
    for (const b of this.bones.values()) this.rest.set(b, { p: b.position.clone(), q: b.quaternion.clone() });

    // keep only the arm + hand triangles of the body mesh
    this.model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      if (sm.name.toLowerCase().includes('visor')) {
        sm.visible = false;
        return;
      }
      const armSet = new Set<number>();
      sm.skeleton.bones.forEach((b, i) => {
        // forearms + hands only: upper arms sit right against the lens and read as blobs
        if (/(Left|Right)(ForeArm|Hand)/.test(b.name)) armSet.add(i);
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
      // per-vertex glove mask: 1 where the hand bones dominate
      const handSet = new Set<number>();
      sm.skeleton.bones.forEach((bn, i) => {
        if (/Hand/.test(bn.name)) handSet.add(i);
      });
      const glove = new Float32Array(si.count);
      for (let v = 0; v < si.count; v++) glove[v] = handSet.has(dominant(v)) ? 1 : 0;
      g.setAttribute('aGlove', new THREE.BufferAttribute(glove, 1));
      sm.geometry = g;
      sm.frustumCulled = false;
      sm.castShadow = false;
      const mat = (sm.material as THREE.MeshStandardMaterial).clone();
      mat.roughness = Math.max(0.7, mat.roughness);
      mat.metalness = 0;
      if (mat.defines) {
        delete mat.defines.USE_CSM;
        delete mat.defines.CSM_CASCADES;
        delete mat.defines.CSM_FADE;
      }
      // olive sleeves + dark leather gloves instead of the stock sci-fi armour
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aGlove;\nvarying float vGlove;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlove = aGlove;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vGlove;')
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
{
  // keep the armour's surface detail only as light/dark variation
  float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  float detail = 0.6 + 0.7 * l;
  vec3 sleeve = vec3(0.17, 0.19, 0.12);
  vec3 glove = vec3(0.10, 0.085, 0.07);
  diffuseColor.rgb = mix(sleeve, glove, smoothstep(0.3, 0.7, vGlove)) * detail;
}`,
          )
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.85, 0.55, vGlove);');
      };
      mat.customProgramCacheKey = () => 'fp-arms';
      sm.material = mat;
      this.meshes.push(sm);
    });

    this.right = this.makeArm('Right', new THREE.Vector3(0.75, -1, 0.35), new THREE.Vector3(0.26, -0.4, 0.12));
    this.left = this.makeArm('Left', new THREE.Vector3(-0.9, -0.8, 0.15), new THREE.Vector3(-0.22, -0.36, -0.12));
    this.root.visible = false;
  }

  private makeArm(side: 'Left' | 'Right', pole: THREE.Vector3, shoulder: THREE.Vector3): Arm {
    const B = (n: string) => this.bones.get(side + n)!;
    const arm = B('Arm'), fore = B('ForeArm'), hand = B('Hand');
    this.resetPose();
    this.model.updateMatrixWorld(true);
    const pa = arm.getWorldPosition(new THREE.Vector3());
    const pf = fore.getWorldPosition(new THREE.Vector3());
    const ph = hand.getWorldPosition(new THREE.Vector3());
    const pm = B('HandMiddle1').getWorldPosition(new THREE.Vector3());
    // hand frame in its own local space, measured in the T-pose (palms face down)
    const hq = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
    const rootDown = new THREE.Vector3(0, -1, 0).applyQuaternion(this.model.getWorldQuaternion(new THREE.Quaternion()));
    const fingersLocal = pm.clone().sub(ph).normalize().applyQuaternion(hq);
    const palmLocal = rootDown.applyQuaternion(hq).normalize();
    const fingers = ['Index', 'Middle', 'Ring', 'Pinky'].map((f) => [1, 2, 3].map((i) => B(`Hand${f}${i}`)).filter(Boolean));
    const thumb = [1, 2, 3].map((i) => B(`HandThumb${i}`)).filter(Boolean);
    return { arm, fore, hand, la: pa.distanceTo(pf), lb: pf.distanceTo(ph), lh: pm.distanceTo(ph), fingersLocal, palmLocal, fingers, thumb, pole: pole.normalize(), shoulder };
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
    a.thumb.forEach((bone, j) => {
      bone.getWorldQuaternion(_q2);
      _q2.premultiply(_q1.setFromAxisAngle(F, grip.thumb * (j === 0 ? 0.6 : 0.4)));
      this.setWorldQuat(bone, _q2);
    });
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
