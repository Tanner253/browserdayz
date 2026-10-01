// Skinned survivor body with idle / walk / run blended by ground speed. Used for the
// local player (third-person view, shadow, and the body you see when you look down in
// first person) and for every other character in the world. A weapon in the hands is
// held with two-bone arm IK on the same grip points the first-person arms use, and the
// upper body leans with the aim pitch.

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { assets } from '../core/assets';
import type { Atmosphere } from '../world/atmosphere';
import type { Grips, HandGrip } from './arms';

/** local player's full body: seen by the shadow cameras always, by the main camera only in third person */
export const AVATAR_LAYER = 2;
/** local player's first-person body (no head, no arms): main camera only, first person only */
export const FP_BODY_LAYER = 4;

/** bones collapsed in the first-person body: the camera is the head, the viewmodel is the arms */
const FP_HIDDEN = new Set(['mixamorigHead', 'mixamorigLeftArm', 'mixamorigRightArm']);
/** how far the first-person body sits behind the eye so you look down at your chest, not into it */
const FP_BACK = 0.3;

interface ArmRig {
  arm: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  la: number;
  lb: number;
  fingersLocal: THREE.Vector3;
  palmLocal: THREE.Vector3;
  fingers: THREE.Bone[][];
  pole: THREE.Vector3;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();

export class Avatar {
  root = new THREE.Group();
  /** first-person body (only built for the local player) */
  fpRoot = new THREE.Group();
  private mixer!: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private yaw = 0;
  private spine?: THREE.Object3D;
  private chest?: THREE.Bone;
  private fpBones: [THREE.Object3D, THREE.Object3D, boolean][] = [];
  private armR?: ArmRig;
  private armL?: ArmRig;
  private layerMask = 1;
  /** weapon in the hands: pivot (at the shoulders, pitches with the aim) > the model */
  private heldPivot = new THREE.Group();
  private held: { obj: THREE.Object3D; grips: Grips } | null = null;
  slung = new THREE.Group();

  /**
   * @param layer render layer of the full body (0 = an ordinary object everyone sees)
   * @param firstPersonBody also build the headless, armless copy for the local first-person view
   */
  async load(atmo: Atmosphere, layer = AVATAR_LAYER, firstPersonBody = false) {
    const gltf = await assets.loadGLTF('assets/characters/soldier.glb');
    const model = SkeletonUtils.clone(gltf.scene) as THREE.Group;
    const mats = new Map<string, THREE.Material>();
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        // muted survivor palette instead of the stock sci-fi look
        const visor = mat.name.toLowerCase().includes('visor') || m.name.toLowerCase().includes('visor');
        if (visor) {
          mat.color.set(0x1a1c1a);
          mat.roughness = 0.35;
          atmo.register(mat);
        } else {
          mat.roughness = Math.max(0.75, mat.roughness);
          mat.metalness = 0;
          // desaturate the stock sci-fi armour into worn olive drab
          atmo.register(
            mat,
            (shader) => {
              shader.fragmentShader = shader.fragmentShader.replace(
                '#include <map_fragment>',
                `#include <map_fragment>
{
  float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(vec3(l), diffuseColor.rgb, 0.15) * vec3(0.5, 0.55, 0.4) * (0.35 + 0.5 * l);
}`,
              );
            },
            'avatar',
          );
        }
        m.material = mat;
        mats.set(m.name, mat);
      }
      o.layers.set(layer);
    });
    this.layerMask = model.layers.mask;
    this.root.add(model);
    this.heldPivot.position.set(0, 1.43, 0);
    this.root.add(this.heldPivot);
    this.spine = model.getObjectByName('mixamorigSpine2');
    this.chest = model.getObjectByName('mixamorigSpine1') as THREE.Bone | undefined;
    if (this.spine) this.spine.add(this.slung);

    // hand frames measured in the T-pose (palms down, arms out), like the first-person arms
    const tpose = gltf.animations.find((a) => a.name === 'TPose');
    if (tpose) {
      const tmp = new THREE.AnimationMixer(model);
      tmp.clipAction(tpose).play();
      tmp.update(0);
      this.root.updateMatrixWorld(true);
      this.armR = this.makeArm(model, 'Right', new THREE.Vector3(0.55, -1, 0.25));
      this.armL = this.makeArm(model, 'Left', new THREE.Vector3(-0.7, -1, 0.1));
      tmp.stopAllAction();
      tmp.uncacheRoot(model);
    }

    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      if (clip.name === 'TPose') continue;
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      a.setEffectiveWeight(clip.name === 'Idle' ? 1 : 0);
      a.play();
      this.actions[clip.name] = a;
    }
    // walk/run cycles share phase so blending doesn't stutter
    if (this.actions.Walk && this.actions.Run) this.actions.Run.syncWith(this.actions.Walk);

    if (firstPersonBody) {
      // A second copy of the rig that mirrors the animated one bone for bone, with the head
      // and arms shrunk to nothing: looking down shows your own chest, legs and feet walking.
      const fp = SkeletonUtils.clone(gltf.scene) as THREE.Group;
      const src = new Map<string, THREE.Object3D>();
      model.traverse((o) => {
        if ((o as THREE.Bone).isBone) src.set(o.name, o);
      });
      fp.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = true;
          m.frustumCulled = false;
          // the helmet visor has nothing left to sit on
          if (m.name.toLowerCase().includes('visor')) m.visible = false;
          m.material = mats.get(m.name) ?? m.material;
        }
        o.layers.set(FP_BODY_LAYER);
        const from = (o as THREE.Bone).isBone ? src.get(o.name) : undefined;
        if (from) this.fpBones.push([from, o, FP_HIDDEN.has(o.name)]);
      });
      this.fpRoot.add(fp);
    }
  }

  private makeArm(model: THREE.Object3D, side: 'Left' | 'Right', pole: THREE.Vector3): ArmRig | undefined {
    const B = (n: string) => model.getObjectByName(`mixamorig${side}${n}`) as THREE.Bone | undefined;
    const arm = B('Arm'), fore = B('ForeArm'), hand = B('Hand'), mid = B('HandMiddle1');
    if (!arm || !fore || !hand || !mid) return undefined;
    const pa = arm.getWorldPosition(new THREE.Vector3());
    const pf = fore.getWorldPosition(new THREE.Vector3());
    const ph = hand.getWorldPosition(new THREE.Vector3());
    const pm = mid.getWorldPosition(new THREE.Vector3());
    const hq = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
    const fingersLocal = pm.clone().sub(ph).normalize().applyQuaternion(hq);
    const palmLocal = new THREE.Vector3(0, -1, 0).applyQuaternion(hq).normalize();
    const fingers = ['Index', 'Middle', 'Ring', 'Pinky'].map((f) => [1, 2, 3].map((i) => B(`Hand${f}${i}`)).filter((b): b is THREE.Bone => !!b));
    return { arm, fore, hand, la: pa.distanceTo(pf), lb: pf.distanceTo(ph), fingersLocal, palmLocal, fingers, pole: pole.normalize() };
  }

  /** Puts a copy of the shouldered weapon on the back. */
  setSlung(obj: THREE.Object3D | null) {
    this.slung.clear();
    if (!obj) return;
    const c = obj.clone();
    c.traverse((o) => (o.layers.mask = this.layerMask));
    // soldier rig is in centimetres
    c.scale.setScalar(100);
    c.rotation.set(0.25, Math.PI / 2, Math.PI * 0.62);
    c.position.set(-10, 4, -17);
    this.slung.add(c);
  }

  /**
   * Puts a weapon in the hands (null = empty hands). `obj` is the weapon body in its own
   * model space, the same space the grips are written in.
   */
  setHeld(obj: THREE.Object3D | null, grips: Grips | null, kind: 'rifle' | 'pistol' | 'auto' | 'melee' = 'rifle') {
    this.heldPivot.clear();
    this.held = null;
    if (!obj || !grips || kind === 'melee') return;
    obj.traverse((o) => {
      o.layers.mask = this.layerMask;
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    // shouldered long gun, or a pistol pushed out in front of the face
    if (kind === 'pistol') obj.position.set(0.09, -0.04, -0.5);
    else obj.position.set(0.15, -0.085, -0.38);
    this.heldPivot.add(obj);
    this.held = { obj, grips };
  }

  private setWorldQuat(bone: THREE.Object3D, world: THREE.Quaternion) {
    const pq = bone.parent!.getWorldQuaternion(_q3);
    bone.quaternion.copy(pq.invert().multiply(world));
    bone.updateMatrixWorld(true);
  }

  /** rotate a bone (in world space) so its child moves from `from` toward `to` */
  private aim(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, origin: THREE.Vector3) {
    _a.copy(from).sub(origin).normalize();
    _b.copy(to).sub(origin).normalize();
    _q1.setFromUnitVectors(_a, _b);
    bone.getWorldQuaternion(_q2);
    _q2.premultiply(_q1);
    this.setWorldQuat(bone, _q2);
  }

  private solveArm(r: ArmRig, grip: HandGrip, weapon: THREE.Object3D, rootQ: THREE.Quaternion) {
    const target = grip.pos.clone().applyMatrix4(weapon.matrixWorld);
    const wq = weapon.getWorldQuaternion(new THREE.Quaternion());
    const A = r.arm.getWorldPosition(new THREE.Vector3());
    const toT = target.clone().sub(A);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(r.la - r.lb) + 1e-3, (r.la + r.lb) * 0.999);
    const dir = toT.normalize();
    const cosA = (r.la * r.la + d * d - r.lb * r.lb) / (2 * r.la * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pole = r.pole.clone().applyQuaternion(rootQ);
    const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const elbow = A.clone().addScaledVector(dir, r.la * cosA).addScaledVector(perp, r.la * sinA);
    const handPos = A.clone().addScaledVector(dir, d);
    this.aim(r.arm, r.fore.getWorldPosition(new THREE.Vector3()), elbow, A);
    const E = r.fore.getWorldPosition(new THREE.Vector3());
    this.aim(r.fore, r.hand.getWorldPosition(new THREE.Vector3()), handPos, E);
    // palm / finger orientation: map the hand's local frame onto the grip frame
    const F = grip.fingers.clone().applyQuaternion(wq).normalize();
    const N = grip.palm.clone().applyQuaternion(wq);
    N.sub(F.clone().multiplyScalar(N.dot(F))).normalize();
    const Lf = r.fingersLocal;
    const Lp = r.palmLocal.clone().sub(Lf.clone().multiplyScalar(r.palmLocal.dot(Lf))).normalize();
    _m1.makeBasis(Lf, Lp, new THREE.Vector3().crossVectors(Lf, Lp));
    _m2.makeBasis(F, N, new THREE.Vector3().crossVectors(F, N));
    const handWorld = new THREE.Quaternion().setFromRotationMatrix(_m2.multiply(_m1.transpose()));
    this.setWorldQuat(r.hand, handWorld);
    const curlAxis = new THREE.Vector3().crossVectors(Lf, Lp).applyQuaternion(handWorld).normalize();
    r.fingers.forEach((chain, fi) => {
      const c = grip.curl[fi];
      chain.forEach((bone, j) => {
        bone.getWorldQuaternion(_q2);
        _q2.premultiply(_q1.setFromAxisAngle(curlAxis, c * (j === 0 ? 0.8 : j === 1 ? 1.1 : 0.8)));
        this.setWorldQuat(bone, _q2);
      });
    });
  }

  /**
   * @param firstPerson the body squares up to the look direction (it is what you see when you look down)
   * @param pitch aim pitch in radians: the chest and the held weapon follow it
   */
  update(dt: number, pos: THREE.Vector3, velocity: THREE.Vector3, facingYaw: number, crouched: boolean, dead: boolean, firstPerson = false, pitch = 0) {
    const speed = Math.hypot(velocity.x, velocity.z);
    const armed = !!this.held;
    // face the movement direction when running unarmed, else the look direction
    let targetYaw = facingYaw;
    if (speed > 0.6 && !firstPerson && !armed) targetYaw = Math.atan2(velocity.x, velocity.z) + Math.PI;
    let d = targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-(firstPerson ? 40 : armed ? 18 : 10) * dt));
    this.root.position.copy(pos);
    // the rig faces -Z, the same convention as the camera
    this.root.rotation.set(dead ? Math.PI / 2 : 0, this.yaw, 0, 'YXZ');
    if (dead) this.root.position.y += 0.15;
    this.root.scale.set(1, crouched ? 0.72 : 1, 1);

    const walkW = THREE.MathUtils.clamp(speed / 1.8, 0, 1) * (1 - THREE.MathUtils.clamp((speed - 3) / 2.5, 0, 1));
    const runW = THREE.MathUtils.clamp((speed - 3) / 2.5, 0, 1);
    const idleW = 1 - THREE.MathUtils.clamp(speed / 1.8, 0, 1);
    const set = (n: string, w: number) => {
      const a = this.actions[n];
      if (a) a.setEffectiveWeight(THREE.MathUtils.lerp(a.getEffectiveWeight(), w, 1 - Math.exp(-12 * dt)));
    };
    set('Idle', idleW);
    set('Walk', walkW);
    set('Run', runW);
    if (this.actions.Walk) this.actions.Walk.timeScale = THREE.MathUtils.clamp(speed / 1.6, 0.6, 2.4);
    if (this.actions.Run) this.actions.Run.timeScale = THREE.MathUtils.clamp(speed / 5.2, 0.8, 1.3);
    this.mixer.update(dead ? 0 : dt);

    if (!dead && (this.held || Math.abs(pitch) > 0.02)) {
      this.root.updateMatrixWorld(true);
      const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
      // lean the chest with the aim
      if (this.chest) {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ);
        this.chest.getWorldQuaternion(_q2);
        _q2.premultiply(_q1.setFromAxisAngle(right, pitch * 0.45));
        this.setWorldQuat(this.chest, _q2);
      }
      if (this.held) {
        this.heldPivot.rotation.x = pitch;
        this.heldPivot.updateMatrixWorld(true);
        const { obj, grips } = this.held;
        if (grips.right && this.armR) this.solveArm(this.armR, grips.right, obj, rootQ);
        if (grips.left && this.armL) this.solveArm(this.armL, grips.left, obj, rootQ);
      }
    }
    this.heldPivot.visible = !dead;

    if (this.fpBones.length) {
      for (const [from, to, hidden] of this.fpBones) {
        to.position.copy(from.position);
        to.quaternion.copy(from.quaternion);
        if (hidden) to.scale.setScalar(0.0001);
        else to.scale.copy(from.scale);
      }
      this.fpRoot.position.set(pos.x + Math.sin(this.yaw) * FP_BACK, pos.y, pos.z + Math.cos(this.yaw) * FP_BACK);
      this.fpRoot.rotation.set(0, this.yaw, 0);
      this.fpRoot.scale.copy(this.root.scale);
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.fpRoot.removeFromParent();
    this.mixer?.stopAllAction();
  }
}
