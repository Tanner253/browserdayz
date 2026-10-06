// The survivor's body. Used for the local player (third-person view, shadow, and the body
// you see when you look down in first person) and for every other character in the world.
//
// Standing, walking, jogging, sprinting, crouching, falling and dying are clips blended by
// what the character is doing. On top of the clips: the legs turn toward the way the feet
// are travelling while the chest stays on the aim, a weapon in the hands is held with
// two-bone arm IK on the same grip points the first-person arms use, and the upper body
// leans with the aim pitch.

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { Atmosphere } from '../world/atmosphere';
import type { Grips, HandGrip } from './arms';
import { BEARD, HAIR_STYLES, loadCharacter, lookFor, lookPatch, lookUniforms, setLookUniforms, type Look, type LookUniforms } from './look';

/** local player's full body: seen by the shadow cameras always, by the main camera only in third person */
export const AVATAR_LAYER = 2;
/** local player's first-person body (no head, no arms): main camera only, first person only */
export const FP_BODY_LAYER = 4;

/** the model stands 1.81 m with its eyes at 1.70 m; the game's eye height is 1.64 m */
export const BODY_SCALE = 0.965;

/** bones collapsed in the first-person body: the camera is the head, the viewmodel is the arms */
const FP_HIDDEN = new Set(['Head', 'upperarm_l', 'upperarm_r']);
/** how far the first-person body sits behind the eye so you look down at your chest, not into it */
const FP_BACK = 0.3;

const CLIPS = ['idle', 'walk', 'run', 'crouchIdle', 'crouchWalk', 'jumpLoop', 'death', 'hit'] as const;
type Clip = (typeof CLIPS)[number];
const STRIDES = ['walk', 'run', 'crouchWalk'] as const;
type Stride = (typeof STRIDES)[number];

/** Live-tunable numbers for how the clips are played (the dev harness exposes them as T.pose). */
export const POSE = {
  /** ground each stepping clip covers when played as drawn, m/s (how fast its planted foot travels back) */
  pace: { walk: 1.08, run: 6.1, crouchWalk: 0.69 } as Record<Stride, number>,
  /**
   * The walk is a stroll and the run a flat-out run, with nothing drawn in between. Up to
   * this speed the walk is simply played faster; beyond it the run is mixed in, so a jog is
   * half of each and a sprint is the run as drawn. Either way the feet keep pace with the ground.
   */
  walkTop: 2.1,
  /** where in each stepping clip the left foot is furthest forward, as a fraction of the clip: lines the cycles up */
  offset: { walk: 0, run: 0.95, crouchWalk: 0 } as Record<Stride, number>,
  /** how far the back straightens while crouched, radians: brings the head up to where the crouched camera is */
  crouchLift: 0.37,
  /** how fast the death clip is played */
  deathRate: 1.15,
  /** the most the legs turn away from the chest when walking sideways, radians */
  maxTwist: 1.35,
  /** how much of the body a hit takes over at its peak */
  flinch: 0.75,
  /** A weapon in the hands: where it sits from the shoulder pivot, and how the body takes it up. */
  hold: {
    long: [0.065, -0.06, -0.635] as [number, number, number],
    pistol: [0.06, 0.02, -0.42] as [number, number, number],
    /** long guns: the chest turns this far off the aim, left shoulder leading, radians */
    blade: 0.5,
    /** and the left shoulder comes forward this much more */
    reach: 0.3,
    /** the most the left hand moves back along the stock toward the right when the grip is beyond its reach, metres */
    slide: 0.3,
  },
};

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
const _aimQ = new THREE.Quaternion();
const _right = new THREE.Vector3();
const _slide = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Avatar {
  root = new THREE.Group();
  /** first-person body (only built for the local player) */
  fpRoot = new THREE.Group();
  private mixer!: THREE.AnimationMixer;
  private actions = {} as Record<Clip, THREE.AnimationAction>;
  private dur = {} as Record<Clip, number>;
  /**
   * The clips play on a skeleton nobody sees, and the visible one copies it every frame
   * before anything is posed on top. (The mixer does not rewrite a bone whose animated
   * value has not changed, so posing the animated skeleton itself would pile up.)
   */
  private drive: [THREE.Object3D, THREE.Object3D][] = [];
  private fpBones: [THREE.Object3D, THREE.Object3D, boolean][] = [];
  private yaw = 0;
  /** false until the first update: a body that appears is already facing its way, not turning to it */
  private placed = false;
  private spine: THREE.Bone[] = [];
  private chest?: THREE.Bone;
  private neck: THREE.Bone[] = [];
  private collarL?: THREE.Bone;
  private armR?: ArmRig;
  private armL?: ArmRig;
  // how far into each state the body is, 0..1
  private crouchT = 0;
  private airT = 0;
  private moveT = 0;
  private speed = 0;
  /** seconds into the death clip (0 = on its feet) */
  private downT = 0;
  /** seconds into the flinch from a hit (-1 = none) */
  private hitT = -1;
  private clock = Math.random() * 10;
  /** where in the stride the legs are, 0..1: shared by every stepping clip so they blend in step */
  private phase = Math.random();
  /** legs turned away from the chest, radians */
  private twist = 0;
  private backing = false;
  private layerMask = 1;
  /** weapon in the hands: pivot (at the shoulders, pitches with the aim) > the model */
  private heldPivot = new THREE.Group();
  private held: { obj: THREE.Object3D; grips: Grips; long: boolean } | null = null;
  slung = new THREE.Group();
  private uniforms?: LookUniforms;
  private hair: (THREE.Object3D | undefined)[] = [];
  private beard?: THREE.Object3D;
  private hairMats: THREE.MeshStandardMaterial[] = [];

  /**
   * @param layer render layer of the full body (0 = an ordinary object everyone sees)
   * @param firstPersonBody also build the headless, armless copy for the local first-person view
   * @param look clothes, skin and hair (see setLook)
   */
  async load(atmo: Atmosphere, layer = AVATAR_LAYER, firstPersonBody = false, look: Look = lookFor('')) {
    const gltf = await loadCharacter();
    const model = SkeletonUtils.clone(gltf.scene) as THREE.Group;
    // the model faces +Z; everything in the game (and the camera) faces -Z
    const rig = new THREE.Group();
    rig.rotation.y = Math.PI;
    rig.scale.setScalar(BODY_SCALE);
    rig.add(model);
    this.root.add(rig);
    this.root.rotation.order = 'YXZ';
    this.root.updateMatrixWorld(true);
    const bone = (n: string) => model.getObjectByName(n) as THREE.Bone | undefined;

    // hair is modelled where the head is at rest: hang every style on the head bone, show one
    const head = bone('Head');
    const hang = (name: string) => {
      const o = model.getObjectByName(name);
      if (o && head) head.attach(o);
      return o;
    };
    this.hair = HAIR_STYLES.map(hang);
    this.beard = hang(BEARD);

    this.uniforms = lookUniforms();
    const uniforms = this.uniforms;
    const mats = new Map<string, THREE.Material>();
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        if (m.isSkinnedMesh) m.frustumCulled = false;
        const src = m.material as THREE.MeshStandardMaterial;
        if (m.name === 'body') {
          const mat = src.clone();
          atmo.register(mat, (shader) => lookPatch(shader, uniforms), 'survivor');
          m.material = mat;
        } else if (src.name.includes('Hair')) {
          // hair and eyebrows share this player's hair colour
          const mat = src.clone();
          atmo.register(mat);
          this.hairMats.push(mat);
          m.material = mat;
        } else atmo.register(src);
        mats.set(m.name, m.material as THREE.Material);
      }
      o.layers.set(layer);
    });
    this.layerMask = model.layers.mask;
    this.heldPivot.position.set(0, 1.43, 0);
    this.heldPivot.rotation.order = 'YXZ';
    this.root.add(this.heldPivot);

    this.spine = ['spine_01', 'spine_02', 'spine_03'].map(bone).filter((b): b is THREE.Bone => !!b);
    this.chest = bone('spine_02');
    this.neck = ['neck_01', 'Head'].map(bone).filter((b): b is THREE.Bone => !!b);
    this.collarL = bone('clavicle_l');
    // a shouldered weapon rides on the upper back: placed where it should be on the standing
    // body, then handed to the spine so it follows every lean and step
    this.slung.position.set(0, 1.3, 0.16);
    this.root.add(this.slung);
    this.root.updateMatrixWorld(true);
    bone('spine_03')?.attach(this.slung);

    // hand frames measured at rest (a T-pose), like the first-person arms
    this.armR = this.makeArm(model, 'r', new THREE.Vector3(0.55, -1, 0.25));
    this.armL = this.makeArm(model, 'l', new THREE.Vector3(-0.7, -1, 0.1));

    // the unseen skeleton the clips play on
    const driver = SkeletonUtils.clone(gltf.scene) as THREE.Group;
    const src = new Map<string, THREE.Object3D>();
    driver.traverse((o) => {
      if ((o as THREE.Bone).isBone) src.set(o.name, o);
    });
    model.traverse((o) => {
      const from = (o as THREE.Bone).isBone ? src.get(o.name) : undefined;
      if (from) this.drive.push([from, o]);
    });
    this.mixer = new THREE.AnimationMixer(driver);
    for (const name of CLIPS) {
      const clip = gltf.animations.find((c) => c.name === name);
      if (!clip) throw new Error(`character has no "${name}" clip`);
      const a = this.mixer.clipAction(clip);
      // every clip is scrubbed by hand: see update()
      a.timeScale = 0;
      a.setEffectiveWeight(name === 'idle' ? 1 : 0);
      a.play();
      this.actions[name] = a;
      this.dur[name] = clip.duration;
    }

    if (firstPersonBody) {
      // A second copy of the rig that mirrors the animated one bone for bone, with the head
      // and arms shrunk to nothing: looking down shows your own chest, legs and feet walking.
      const fp = SkeletonUtils.clone(gltf.scene) as THREE.Group;
      const shown = new Map<string, THREE.Object3D>();
      model.traverse((o) => {
        if ((o as THREE.Bone).isBone) shown.set(o.name, o);
      });
      fp.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = true;
          m.frustumCulled = false;
          // nothing above the neck: the face and hair would only ever be seen from inside
          if (m.name === 'body') m.material = mats.get('body') ?? m.material;
          else m.visible = false;
        }
        o.layers.set(FP_BODY_LAYER);
        const from = (o as THREE.Bone).isBone ? shown.get(o.name) : undefined;
        if (from) this.fpBones.push([from, o, FP_HIDDEN.has(o.name)]);
      });
      const fpRig = new THREE.Group();
      fpRig.rotation.y = Math.PI;
      fpRig.scale.setScalar(BODY_SCALE);
      fpRig.add(fp);
      this.fpRoot.add(fpRig);
    }
    this.setLook(look);
  }

  /** Dresses the body: jacket and trouser colours, skin tone, hair. */
  setLook(look: Look) {
    if (this.uniforms) setLookUniforms(this.uniforms, look);
    this.hair.forEach((h, i) => h && (h.visible = i === look.hair));
    if (this.beard) this.beard.visible = look.beard;
    for (const m of this.hairMats) m.color.copy(look.hairColor);
  }

  private makeArm(model: THREE.Object3D, side: 'l' | 'r', pole: THREE.Vector3): ArmRig | undefined {
    const B = (n: string) => model.getObjectByName(`${n}_${side}`) as THREE.Bone | undefined;
    const arm = B('upperarm'), fore = B('lowerarm'), hand = B('hand'), mid = B('middle_01'), index = B('index_01'), pinky = B('pinky_01');
    if (!arm || !fore || !hand || !mid || !index || !pinky) return undefined;
    const at = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3());
    const pa = at(arm), pf = at(fore), ph = at(hand);
    const hq = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
    const fingersW = at(mid).sub(ph).normalize();
    // which way the palm faces, from the hand's own shape: across the knuckles, index to pinky
    const palmW = new THREE.Vector3().crossVectors(fingersW, at(pinky).sub(at(index))).normalize();
    if (side === 'l') palmW.negate();
    const fingers = ['index', 'middle', 'ring', 'pinky'].map((f) => [1, 2, 3].map((i) => B(`${f}_0${i}`)).filter((b): b is THREE.Bone => !!b));
    return { arm, fore, hand, la: pa.distanceTo(pf), lb: pf.distanceTo(ph), fingersLocal: fingersW.applyQuaternion(hq), palmLocal: palmW.applyQuaternion(hq), fingers, pole: pole.normalize() };
  }

  /** Puts a copy of the shouldered weapon on the back. */
  setSlung(obj: THREE.Object3D | null) {
    this.slung.clear();
    if (!obj) return;
    const c = obj.clone();
    c.traverse((o) => (o.layers.mask = this.layerMask));
    // muzzle up over the left shoulder, flat against the back
    c.rotation.set(0.25, -Math.PI / 2, Math.PI * 0.62);
    c.position.set(0.1, 0.04, 0.01);
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
    this.heldPivot.add(obj);
    this.held = { obj, grips, long: kind !== 'pistol' };
  }

  private setWorldQuat(bone: THREE.Object3D, world: THREE.Quaternion) {
    const pq = bone.parent!.getWorldQuaternion(_q3);
    bone.quaternion.copy(pq.invert().multiply(world));
    bone.updateMatrixWorld(true);
  }

  /** turn a bone about a world axis */
  private turn(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
    bone.getWorldQuaternion(_q2);
    _q2.premultiply(_q1.setFromAxisAngle(axis, angle));
    this.setWorldQuat(bone, _q2);
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

  /** @param slide the way a hand may move along the weapon to come within reach (unit vector), if it may */
  private solveArm(r: ArmRig, grip: HandGrip, weapon: THREE.Object3D, aimQ: THREE.Quaternion, slide?: THREE.Vector3) {
    const target = grip.pos.clone().applyMatrix4(weapon.matrixWorld);
    const wq = weapon.getWorldQuaternion(new THREE.Quaternion());
    const A = r.arm.getWorldPosition(new THREE.Vector3());
    if (slide) {
      const reach = (r.la + r.lb) * 0.96;
      for (let moved = 0; moved < POSE.hold.slide && target.distanceTo(A) > reach; moved += 0.02) target.addScaledVector(slide, 0.02);
    }
    const toT = target.clone().sub(A);
    const la = r.la, lb = r.lb;
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(la - lb) + 1e-3, (la + lb) * 0.999);
    const dir = toT.normalize();
    const cosA = (la * la + d * d - lb * lb) / (2 * la * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pole = r.pole.clone().applyQuaternion(aimQ);
    const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const elbow = A.clone().addScaledVector(dir, la * cosA).addScaledVector(perp, la * sinA);
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
      chain.forEach((bone, j) => this.turn(bone, curlAxis, c * (j === 0 ? 0.8 : j === 1 ? 1.1 : 0.8)));
    });
  }

  /** A shot or a blow landed: the body jolts. */
  hit() {
    this.hitT = 0;
  }

  /** A body that was already lying there when we arrived: no fall to watch. */
  layDown() {
    this.downT = 1e3;
  }

  /**
   * @param firstPerson the body squares up to the look direction (it is what you see when you look down)
   * @param pitch aim pitch in radians: the chest and the held weapon follow it
   * @param grounded feet on the ground (false while jumping or falling)
   */
  update(dt: number, pos: THREE.Vector3, velocity: THREE.Vector3, facingYaw: number, crouched: boolean, dead: boolean, firstPerson = false, pitch = 0, grounded = true) {
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);
    const speedNow = Math.hypot(velocity.x, velocity.z);
    this.speed += (speedNow - this.speed) * ease(12);
    const speed = this.speed;
    const armed = !!this.held;
    // face the movement direction when running unarmed, else the look direction
    const free = !firstPerson && !armed;
    const velYaw = Math.atan2(-velocity.x, -velocity.z);
    const targetYaw = free && speedNow > 0.6 ? velYaw : facingYaw;
    if (this.placed) this.yaw += wrap(targetYaw - this.yaw) * ease(firstPerson ? 40 : armed ? 18 : 10);
    else this.yaw = targetYaw;
    this.placed = true;

    // --- which way the legs point. Squared up to the aim, walking sideways or backwards
    // would slide the feet across the ground: the hips turn toward the way of travel instead
    // (stepping in reverse when that is behind), and the spine turns the chest back.
    let twistTo = 0;
    let dirSign = 1;
    if (!free && !dead && speedNow > 0.4) {
      const rel = wrap(velYaw - this.yaw);
      const side = Math.abs(rel);
      if (this.backing ? side < 1.4 : side > 1.75) this.backing = !this.backing;
      twistTo = THREE.MathUtils.clamp(this.backing ? wrap(rel + Math.PI) : rel, -POSE.maxTwist, POSE.maxTwist) * Math.min(1, speedNow / 1.2);
      if (this.backing) dirSign = -1;
    } else this.backing = false;
    this.twist += (twistTo - this.twist) * ease(9);

    this.crouchT += ((crouched && !dead ? 1 : 0) - this.crouchT) * ease(10);
    this.airT += ((grounded || dead ? 0 : 1) - this.airT) * ease(9);
    this.moveT += (THREE.MathUtils.smoothstep(speed, 0.12, 0.8) - this.moveT) * ease(14);
    if (dead) this.downT = Math.min(this.dur.death - 1e-3, this.downT + dt * POSE.deathRate);
    else this.downT = 0;

    // --- how much of each clip
    const down = dead ? Math.min(1, this.downT / 0.15) : 0;
    const feet = (1 - this.airT) * (1 - down);
    const stand = feet * (1 - this.crouchT);
    const duck = feet * this.crouchT;
    const move = this.moveT;
    const runK = THREE.MathUtils.clamp((speed - POSE.walkTop) / (POSE.pace.run - POSE.walkTop), 0, 1);
    let hit = 0;
    if (this.hitT >= 0) {
      this.hitT += dt;
      if (this.hitT >= this.dur.hit) this.hitT = -1;
      else hit = POSE.flinch * Math.sin((Math.PI * this.hitT) / this.dur.hit) * (1 - down);
    }
    const rest = 1 - hit;
    const w: Record<Clip, number> = {
      idle: stand * (1 - move) * rest,
      walk: stand * move * (1 - runK) * rest,
      run: stand * move * runK * rest,
      crouchIdle: duck * (1 - move) * rest,
      crouchWalk: duck * move * rest,
      jumpLoop: this.airT * (1 - down) * rest,
      death: down,
      hit,
    };
    // --- and where in each. One stride clock for every stepping clip, so the same foot is
    // down in all of them and a blend of two is still a step.
    const rate: Record<Stride, number> = {
      walk: THREE.MathUtils.clamp(Math.min(speed, POSE.walkTop) / POSE.pace.walk, 0.6, 2.1),
      run: THREE.MathUtils.clamp(speed / POSE.pace.run, 1, 1.2),
      crouchWalk: THREE.MathUtils.clamp(speed / POSE.pace.crouchWalk, 0.6, 2.8),
    };
    let cadence = 0, stepping = 0;
    for (const n of STRIDES) {
      cadence += (w[n] * rate[n]) / this.dur[n];
      stepping += w[n];
    }
    if (stepping > 1e-3) this.phase = (((this.phase + (cadence / stepping) * dt * dirSign) % 1) + 1) % 1;
    this.clock += dt;
    for (const n of CLIPS) {
      const a = this.actions[n];
      a.setEffectiveWeight(w[n]);
      if (n === 'death') a.time = this.downT;
      else if (n === 'hit') a.time = Math.max(0, this.hitT);
      else if (n === 'walk' || n === 'run' || n === 'crouchWalk') a.time = ((this.phase + POSE.offset[n]) % 1) * this.dur[n];
      else a.time = this.clock % this.dur[n];
    }
    this.mixer.update(0);
    for (const [from, to] of this.drive) {
      to.position.copy(from.position);
      to.quaternion.copy(from.quaternion);
    }

    this.root.position.copy(pos);
    this.root.rotation.set(0, this.yaw + this.twist, 0);
    this.heldPivot.visible = !dead;
    this.heldPivot.rotation.set(pitch, -this.twist, 0);
    if (this.held) this.held.obj.position.fromArray(this.held.long ? POSE.hold.long : POSE.hold.pistol);

    const lean = !dead && (this.held || Math.abs(pitch) > 0.02);
    const lift = POSE.crouchLift * this.crouchT;
    if (!dead && (lean || Math.abs(this.twist) > 0.003 || Math.abs(lift) > 0.003)) {
      this.root.updateMatrixWorld(true);
      // the legs have turned; from the waist up the body still faces the aim
      const n = this.spine.length;
      const aimQ = _aimQ.setFromAxisAngle(UP, this.yaw);
      _right.set(1, 0, 0).applyQuaternion(aimQ);
      // a long gun is held across the body: chest turned off the aim, left shoulder leading,
      // the head still looking down the barrel
      const blade = this.held?.long ? POSE.hold.blade : 0;
      for (const b of this.spine) {
        this.turn(b, UP, (-this.twist - blade) / n);
        if (lift) this.turn(b, _right, lift / n);
      }
      if (blade) {
        for (const b of this.neck) this.turn(b, UP, blade / this.neck.length);
        if (this.collarL) this.turn(this.collarL, UP, -POSE.hold.reach);
      }
      if (lean) {
        if (this.chest) this.turn(this.chest, _right, pitch * 0.45);
        if (this.held) {
          this.heldPivot.updateMatrixWorld(true);
          const { obj, grips } = this.held;
          if (grips.right && this.armR) this.solveArm(this.armR, grips.right, obj, aimQ);
          // the forward hand may sit further back along the stock than the first-person arms have it
          if (grips.left && this.armL) this.solveArm(this.armL, grips.left, obj, aimQ, grips.right ? _slide.set(0, 0, 1).applyQuaternion(this.heldPivot.getWorldQuaternion(_q1)) : undefined);
        }
      }
    }

    if (this.fpBones.length) {
      for (const [from, to, hidden] of this.fpBones) {
        to.position.copy(from.position);
        to.quaternion.copy(from.quaternion);
        if (hidden) to.scale.setScalar(0.0001);
        else to.scale.copy(from.scale);
      }
      this.fpRoot.position.set(pos.x + Math.sin(this.yaw) * FP_BACK, pos.y, pos.z + Math.cos(this.yaw) * FP_BACK);
      this.fpRoot.rotation.set(0, this.yaw + this.twist, 0);
      this.fpRoot.scale.copy(this.root.scale);
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.fpRoot.removeFromParent();
    this.mixer?.stopAllAction();
    for (const m of this.hairMats) m.dispose();
  }
}
