// The survivor's body. Used for the local player (the shadow, the flight in from the menu, and
// the body you see when you look down) and for every other character in the world.
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
import { BEARD, HAIR_STYLES, MAX_WOUNDS, loadCharacter, lookFor, lookPatch, lookUniforms, setLookUniforms, type Look, type LookUniforms } from './look';

/** local player's full body: seen by the shadow cameras always, by the main camera only on the flight in from the menu */
export const AVATAR_LAYER = 2;
/** local player's first-person body (no head, no arms): main camera only, first person only */
export const FP_BODY_LAYER = 4;

/** the model stands 1.81 m with its eyes at 1.70 m; the game's eye height is 1.64 m */
export const BODY_SCALE = 0.965;

/** bones collapsed in the first-person body: the camera is the head, the viewmodel is the arms */
const FP_HIDDEN = new Set(['Head', 'upperarm_l', 'upperarm_r']);
/** how far the first-person body sits behind the eye so you look down at your chest, not into it */
const FP_BACK = 0.3;

/** the limbs a bloodstain can sit on: it goes on whichever is nearest the hit */
const WOUND_BONES: [string, string | null][] = [['pelvis', 'spine_01'], ['spine_01', 'spine_02'], ['spine_02', 'spine_03'], ['spine_03', 'neck_01'], ['neck_01', 'Head'], ['Head', null], ['upperarm_l', 'lowerarm_l'], ['upperarm_r', 'lowerarm_r'], ['lowerarm_l', 'hand_l'], ['lowerarm_r', 'hand_r'], ['thigh_l', 'calf_l'], ['thigh_r', 'calf_r'], ['calf_l', 'foot_l'], ['calf_r', 'foot_r'], ['foot_l', 'ball_l'], ['foot_r', 'ball_r']];

const CLIPS = ['idle', 'walk', 'run', 'crouchIdle', 'crouchWalk', 'jumpStart', 'jumpLoop', 'jumpLand', 'death', 'deathFront', 'deathSide', 'hit', 'hitHead'] as const;
type Clip = (typeof CLIPS)[number];
const STRIDES = ['walk', 'run', 'crouchWalk'] as const;
type Stride = (typeof STRIDES)[number];
/** the ways of going down: thrown onto the back, pitched onto the face, folded onto the side */
export const DEATHS = ['death', 'deathFront', 'deathSide'] as const;
/** where a body lies once it is down, from where it stood: metres ahead of its feet (negative = behind) and to its left */
export const DEATH_REST: [number, number][] = [[-0.85, 0], [0.9, 0], [0.05, 0.36]];

/** what the hands can be seen doing */
export type Gesture = 'bolt' | 'reload' | 'eat' | 'drink' | 'bandage' | 'open';

/**
 * Worn things that are drawn on the body. `p`, `r`, `s` place the item's model on the body
 * as it stands at rest (x to its right, y up, z behind it); the bone then carries it.
 */
const GEAR: Record<string, { bone: 'Head' | 'spine_03'; p: [number, number, number]; r: [number, number, number]; s: [number, number, number]; pack?: boolean }> = {
  boonie_hat: { bone: 'Head', p: [0, 1.672, -0.005], r: [0, 0, 0], s: [1.05, 1.05, 1.05] },
  life_vest: { bone: 'spine_03', p: [0, 1.22, -0.155], r: [Math.PI / 2, 0, 0], s: [0.6, 1.85, 0.52] },
  sack_pack: { bone: 'spine_03', p: [0, 1.0, 0.3], r: [0.08, 0, 0], s: [1, 1, 1], pack: true },
  suitcase: { bone: 'spine_03', p: [0, 0.92, 0.235], r: [0.06, 0, 0], s: [0.85, 0.85, 0.85], pack: true },
};
export const GEAR_SHOWN = new Set(Object.keys(GEAR));

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
  /**
   * Where in the stride a foot is set down (the other one half a stride later), read off the
   * clips: at a walk or a flat-out run, at the jog half way between them, and crouched. The
   * step is heard here and the view dips here, so the sound keeps time with the legs at any
   * speed: a sprint is longer strides, not many more of them. Stepping backwards the stride
   * runs the other way, and a foot is set down where going forwards it would be picked up.
   */
  plant: { fwd: [0.1, 0.165, 0], back: [0.375, 0.25, 0.285] },
  /** how far the back straightens while crouched, radians: brings the head up to where the crouched camera is */
  crouchLift: 0.37,
  /** how fast the death clip is played */
  deathRate: 1.15,
  /** the most the legs turn away from the chest when walking sideways, radians */
  maxTwist: 1.35,
  /** how much of the body a hit takes over at its peak */
  flinch: 0.75,
  /** landing: how much of the body the landing clip takes, and for how long (seconds) */
  landing: [0.8, 0.45] as [number, number],
  /** where in the landing clip the feet touch down, seconds */
  landFrom: 0,
  /** a jump: where in the take-off clip the feet leave the ground, and how long until the falling pose takes over (seconds) */
  jump: [0.04, 0.5] as [number, number],
  /** how long a blow with the right arm takes, seconds */
  swing: 0.42,
  /** a punch: how long it takes, and how long the fists stay up after one, seconds */
  punch: [0.38, 2.6] as [number, number],
  /** how much of the aim's pitch the neck and head add on top of the chest's lean */
  headPitch: 0.5,
  /** A weapon in the hands: where it sits from the shoulder pivot, and how the body takes it up. */
  hold: {
    /**
     * Three ways of holding each kind, blended by what the player is doing. `p` is where the
     * weapon's own origin sits from the point between the shoulders (x right, y up, z back),
     * `r` how it is turned from pointing down the aim: [nose up, nose left, roll], radians.
     *   ready: standing or walking, not aiming. Butt in the shoulder, muzzle dipped.
     *   aim:   sights up to the eye.
     *   carry: jogging or sprinting. A long gun goes across the chest, a pistol points at the ground.
     */
    long: {
      ready: { p: [0.065, -0.19, -0.65], r: [-0.16, 0, 0] },
      aim: { p: [0.05, 0.1, -0.6], r: [0, 0, 0] },
      carry: { p: [-0.07, -0.07, -0.34], r: [0.656, 0.88, 0] },
    } as Stances,
    pistol: {
      ready: { p: [0.05, -0.1, -0.32], r: [-0.25, 0, 0] },
      aim: { p: [0.035, 0.115, -0.44], r: [0, 0, 0] },
      carry: { p: [0.08, -0.24, -0.24], r: [-0.75, 0, 0] },
    } as Stances,
    /** the point the weapon hangs from, measured from midway between the shoulder joints: [up, back] */
    pivot: [0.04, -0.04] as [number, number],
    /** long guns: the chest turns this far off the aim, left shoulder leading, radians */
    blade: 0.5,
    /** and the left shoulder comes forward this much more */
    reach: 0.3,
    /** the most the left hand moves back along the stock toward the right when the grip is beyond its reach, metres */
    slide: 0.3,
  },
};

interface Stance {
  p: [number, number, number];
  r: [number, number, number];
}
type Stances = Record<'ready' | 'aim' | 'carry', Stance>;

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
const _w = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _head = new THREE.Vector3();
const _X = new THREE.Vector3(1, 0, 0);
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _euler = new THREE.Euler();
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
  private hitClip: 'hit' | 'hitHead' = 'hit';
  /** which way it goes down (index into DEATHS) */
  private deathClip: (typeof DEATHS)[number] = 'death';
  /** seconds since the feet left the ground in a jump (-1 = not jumping: a drop has no take-off) */
  private jumpT = -1;
  private gesture: { kind: Gesture; t: number; dur: number } | null = null;
  private gearRest = new Map<string, { bone: THREE.Object3D; inv: THREE.Matrix4 }>();
  private gearObjs: THREE.Object3D[] = [];
  /** a pack is worn: a slung weapon rides outside it */
  private packOut = 0;
  /** seconds since the feet came back down after being in the air (-1 = long ago) */
  private landT = -1;
  private wasAir = false;
  /** fastest it has fallen since leaving the ground (negative), and how hard the last landing was, 0..1 */
  private fallV = 0;
  private landK = 1;
  private clock = Math.random() * 10;
  /** where in the stride the legs are, 0..1: shared by every stepping clip so they blend in step */
  private phase = Math.random();
  /** a foot came down during the last update (see POSE.plant): the step that is heard */
  footfall = false;
  /** seconds since the last one */
  private sinceStep = 1;
  /** half strides gone by, counted from where a foot comes down: a whole number is passed as each one lands */
  private halves = 0;
  /** where a foot came down, and which way the legs were stepping, at the last update */
  private plantWas = 0;
  private dirWas = 0;
  /** legs turned away from the chest, radians */
  private twist = 0;
  private backing = false;
  private layerMask = 1;
  /** weapon in the hands: pivot (at the shoulders, pitches with the aim) > the model */
  private heldPivot = new THREE.Group();
  private held: { obj: THREE.Object3D; grips: Grips; long: boolean; base: THREE.Quaternion } | null = null;
  /** a one-handed weapon in the right fist */
  private inHand: { obj: THREE.Object3D; curl: [number, number, number, number] } | null = null;
  /** seconds into a swing of the right arm (-1 = not swinging) */
  private swingT = -1;
  // bare hands: seconds into a punch (-1 = none) and whose it is, how long the fists stay up, how far up they are
  private punchT = -1;
  private punchSide = -1;
  private fistsHold = 0;
  private fistsT = 0;
  // how far the weapon is up at the eye, and how far it is in its running carry, 0..1
  private aimT = 0;
  private carryT = 0;
  slung = new THREE.Group();
  private uniforms?: LookUniforms;
  /** the body mesh, and the bones a wound can be pinned to (index into its skeleton, and the bone it runs to) */
  private skin?: THREE.SkinnedMesh;
  private woundBones: [number, THREE.Object3D | undefined][] = [];
  private woundN = 0;
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
          this.skin = m;
        } else if (src.name.includes('Hair')) {
          // hair and eyebrows share this player's hair colour
          const mat = src.clone();
          atmo.register(mat);
          this.hairMats.push(mat);
          m.material = mat;
        } else {
          // the whites of the eyes are modelled paper white, which glows in a shaded face
          if (!src.userData.toned) {
            src.userData.toned = true;
            src.color.multiplyScalar(0.72);
            src.roughness = Math.max(src.roughness, 0.5);
          }
          atmo.register(src);
        }
        mats.set(m.name, m.material as THREE.Material);
      }
      o.layers.set(layer);
    });
    this.layerMask = model.layers.mask;
    if (this.skin) {
      const bones = this.skin.skeleton.bones;
      for (const [name, next] of WOUND_BONES) {
        const i = bones.findIndex((b) => b.name === name);
        if (i >= 0) this.woundBones.push([i, next ? bones.find((b) => b.name === next) : undefined]);
      }
    }
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
    // where the bones that carry gear are while the body stands at rest
    for (const name of ['Head', 'spine_03']) {
      const b = bone(name);
      if (b) this.gearRest.set(name, { bone: b, inv: b.matrixWorld.clone().invert() });
    }
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
    c.position.set(0.1, 0.04, 0.01 + this.packOut);
    this.slung.add(c);
  }

  /** Hat, vest, pack: whatever of it is drawn (see GEAR). The models are this body's to keep. */
  setGear(items: { id: string; obj: THREE.Object3D }[]) {
    for (const o of this.gearObjs) o.removeFromParent();
    this.gearObjs = [];
    this.packOut = 0;
    for (const { id, obj } of items) {
      const g = GEAR[id];
      const rest = g && this.gearRest.get(g.bone);
      if (!g || !rest) continue;
      obj.traverse((o) => {
        o.layers.mask = this.layerMask;
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = true;
      });
      const holder = new THREE.Group();
      holder.layers.mask = this.layerMask;
      holder.matrixAutoUpdate = false;
      holder.matrix.copy(rest.inv).multiply(_m1.compose(_a.set(...g.p), _q1.setFromEuler(_euler.set(g.r[0], g.r[1], g.r[2], 'XYZ')), _b.set(...g.s)));
      holder.add(obj);
      rest.bone.add(holder);
      this.gearObjs.push(holder);
      if (g.pack) this.packOut = 0.2;
    }
    for (const c of this.slung.children) c.position.z = 0.01 + this.packOut;
  }

  /**
   * Puts a weapon in the hands (null = empty hands). `obj` is the weapon body in its own
   * model space, the same space the grips are written in.
   */
  setHeld(obj: THREE.Object3D | null, grips: Grips | null, kind: 'rifle' | 'pistol' | 'auto' | 'melee' = 'rifle') {
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
      this.inHand = { obj: fist, curl: g.curl };
      return;
    }
    this.heldPivot.add(obj);
    this.held = { obj, grips, long: kind !== 'pistol', base: obj.quaternion.clone() };
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
    if (slide) {
      const A = r.arm.getWorldPosition(new THREE.Vector3());
      const reach = (r.la + r.lb) * 0.96;
      for (let moved = 0; moved < POSE.hold.slide && target.distanceTo(A) > reach; moved += 0.02) target.addScaledVector(slide, 0.02);
    }
    this.reach(r, target, grip.fingers.clone().applyQuaternion(wq), grip.palm.clone().applyQuaternion(wq), grip.curl, aimQ);
  }

  /**
   * Brings a hand to a point in the world: wrist at `target`, fingers along `F`, palm facing `N`.
   * @param w how much of it: below 1 the arm is only part of the way from where the clip had it
   */
  private reach(r: ArmRig, target: THREE.Vector3, F: THREE.Vector3, N: THREE.Vector3, curl: [number, number, number, number], aimQ: THREE.Quaternion, w = 1) {
    const before = w < 1 ? [r.arm.quaternion.clone(), r.fore.quaternion.clone(), r.hand.quaternion.clone()] : null;
    const A = r.arm.getWorldPosition(new THREE.Vector3());
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
      r.arm.updateMatrixWorld(true);
      r.hand.getWorldQuaternion(handWorld);
    }
    this.curl(r, curl.map((c) => c * w) as [number, number, number, number], handWorld);
  }

  /** close the fingers toward the palm, each by its own amount */
  private curl(r: ArmRig, curl: [number, number, number, number], handWorld: THREE.Quaternion) {
    const Lf = r.fingersLocal;
    const Lp = r.palmLocal.clone().sub(Lf.clone().multiplyScalar(r.palmLocal.dot(Lf))).normalize();
    const curlAxis = new THREE.Vector3().crossVectors(Lf, Lp).applyQuaternion(handWorld).normalize();
    r.fingers.forEach((chain, fi) => {
      const c = curl[fi];
      chain.forEach((bone, j) => this.turn(bone, curlAxis, c * (j === 0 ? 0.8 : j === 1 ? 1.1 : 0.8)));
    });
  }

  /**
   * Blood on the body where it was hit: it soaks whatever is within `size` metres of the
   * point, and stays on that limb as it moves. A bullet leaves a second, bigger one where it
   * came out.
   * @param dir the way the bullet or blade was travelling (world)
   */
  wound(point: THREE.Vector3, dir: THREE.Vector3, size = 0.08, through = false) {
    const skin = this.skin;
    if (!skin || !this.uniforms || !this.woundBones.length) return;
    const stain = (at: THREE.Vector3, r: number) => {
      // the nearest limb, measured to the line from its joint to the next
      let best = this.woundBones[0][0], bd = 1e9;
      for (const [i, child] of this.woundBones) {
        const a = _a.setFromMatrixPosition(skin.skeleton.bones[i].matrixWorld);
        let d = a.distanceTo(at);
        if (child) {
          const ab = _b.setFromMatrixPosition(child.matrixWorld).sub(a);
          const t = THREE.MathUtils.clamp(_w.copy(at).sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
          d = a.addScaledVector(ab, t).distanceTo(at);
        }
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      // world -> that bone -> where the bone stands at rest -> the mesh's own space
      const p = at.clone().applyMatrix4(_m1.copy(skin.skeleton.bones[best].matrixWorld).invert()).applyMatrix4(_m2.copy(skin.skeleton.boneInverses[best]).invert()).applyMatrix4(_m1.copy(skin.bindMatrix).invert());
      // the stain is measured in the mesh's units: the body is drawn a little smaller than it is modelled
      this.uniforms!.uWounds.value[this.woundN++ % MAX_WOUNDS].set(p.x, p.y, p.z, r / BODY_SCALE);
    };
    // the hit zones stand a little proud of the body: the wound is just inside them
    stain(point.clone().addScaledVector(dir, 0.05), size);
    if (through) stain(point.clone().addScaledVector(dir, 0.27), size * 1.35);
  }

  /** a new life: clean clothes */
  clearWounds() {
    this.woundN = 0;
    if (this.uniforms) for (const w of this.uniforms.uWounds.value) w.set(0, 0, 0, 0);
  }

  /**
   * A blow. With something in the right hand it is swung, overhand; with nothing a punch is
   * thrown from a guard, left and right in turn.
   * @param overhand swing the empty arm all the same (a throw)
   */
  swing(overhand = false) {
    if (overhand || this.inHand || this.held) {
      this.swingT = 0;
      return;
    }
    this.punchSide = -this.punchSide;
    this.punchT = 0;
    this.fistsHold = POSE.punch[1];
  }

  /** A shot or a blow landed: the body jolts (the head snaps back if that is where it landed). */
  hit(head = false) {
    this.hitT = 0;
    this.hitClip = head ? 'hitHead' : 'hit';
  }

  /** Which way it goes down the next time it dies: an index into DEATHS. */
  setDeath(variant: number) {
    this.deathClip = DEATHS[((variant % DEATHS.length) + DEATHS.length) % DEATHS.length];
  }

  /** A body that was already lying there when we arrived: no fall to watch. */
  layDown(variant = 0) {
    this.setDeath(variant);
    this.downT = 1e3;
  }

  /** The hands start on something: working the bolt, a reload, eating, dressing a wound. null stops it. */
  act(kind: Gesture | null, dur = 1) {
    this.gesture = kind ? { kind, t: 0, dur } : null;
  }

  /** Development: stand in one clip at one moment, nothing blended. */
  debugPose(clip: Clip, time: number) {
    for (const n of CLIPS) {
      this.actions[n].setEffectiveWeight(n === clip ? 1 : 0);
      if (n === clip) this.actions[n].time = Math.min(this.dur[n] - 1e-3, time);
    }
    this.mixer.update(0);
    for (const [from, to] of this.drive) {
      to.position.copy(from.position);
      to.quaternion.copy(from.quaternion);
    }
  }
  clipLength(clip: Clip) {
    return this.dur[clip];
  }

  private get plantAt() {
    const k = THREE.MathUtils.clamp((this.speed - POSE.walkTop) / (POSE.pace.run - POSE.walkTop), 0, 1);
    const [walk, jog, low] = this.backing ? POSE.plant.back : POSE.plant.fwd;
    // backwards nobody gets beyond a slow jog, and the feet are already landing as at one well before that
    const stand = walk + (jog - walk) * (this.backing ? Math.min(1, k * 4) : 4 * k * (1 - k));
    return stand + (low - stand) * this.crouchT;
  }

  /** the stride as an angle that passes a multiple of π each time a foot comes down: what the view bobs to */
  get stride() {
    return (this.phase - this.plantAt) * Math.PI * 2;
  }

  /**
   * @param firstPerson the body squares up to the look direction (it is what you see when you look down)
   * @param pitch aim pitch in radians: the chest and the held weapon follow it
   * @param grounded feet on the ground (false while jumping or falling)
   * @param aiming weapon up at the eye
   */
  update(dt: number, pos: THREE.Vector3, velocity: THREE.Vector3, facingYaw: number, crouched: boolean, dead: boolean, firstPerson = false, pitch = 0, grounded = true, aiming = false) {
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);
    const speedNow = Math.hypot(velocity.x, velocity.z);
    this.speed += (speedNow - this.speed) * ease(12);
    const speed = this.speed;
    const armed = !!this.held;
    if (this.gesture) {
      this.gesture.t += dt;
      if (this.gesture.t >= this.gesture.dur || dead) this.gesture = null;
    }
    const ges = this.gesture;
    // eating, drinking, dressing a wound: whatever was in the hands is put away for it
    const using = !!ges && ges.kind !== 'bolt' && ges.kind !== 'reload';
    const held = using ? null : this.held;
    // fists come up for a punch and stay up a while after it
    this.fistsHold = Math.max(0, this.fistsHold - dt);
    const fists = this.fistsHold > 0 && !dead && !armed && !this.inHand && !using;
    this.fistsT += ((fists ? 1 : 0) - this.fistsT) * ease(fists ? 14 : 6);
    if (!fists) this.punchT = -1;
    // face the movement direction when running unarmed, else the look direction (a punch goes where the eyes do)
    const free = !firstPerson && !armed && !fists;
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
    if (dead) this.downT = Math.min(this.dur[this.deathClip] - 1e-3, this.downT + dt * POSE.deathRate);
    else this.downT = 0;

    // --- how much of each clip
    const down = dead ? Math.min(1, this.downT / 0.15) : 0;
    // coming down from a jump or a drop, the knees give for a moment: a dip into the crouch
    const inAir = !grounded && !dead;
    if (this.wasAir && !inAir && this.airT > 0.45) {
      this.landT = 0;
      // a hop barely bends the knees; a drop from a roof folds the body right down
      this.landK = THREE.MathUtils.clamp(-this.fallV / 10, 0.28, 1);
    }
    this.fallV = inAir ? Math.min(this.fallV, velocity.y) : 0;
    // leaving the ground upward is a jump: it gets the push-off. Walking off an edge does not.
    if (!this.wasAir && inAir) this.jumpT = velocity.y > 1.5 ? 0 : -1;
    else if (!inAir) this.jumpT = -1;
    else if (this.jumpT >= 0) this.jumpT += dt;
    this.wasAir = inAir;
    let land = 0;
    if (this.landT >= 0) {
      this.landT += dt;
      if (this.landT > POSE.landing[1] || inAir) this.landT = -1;
      else land = POSE.landing[0] * this.landK * (1 - THREE.MathUtils.smoothstep(this.landT, POSE.landing[1] * 0.3, POSE.landing[1])) * (1 - down);
    }
    const bent = this.crouchT;
    const feet = (1 - this.airT) * (1 - down) * (1 - land);
    const stand = feet * (1 - bent);
    const duck = feet * bent;
    const air = this.airT * (1 - down) * (1 - land);
    const push = this.jumpT >= 0 ? 1 - THREE.MathUtils.smoothstep(this.jumpT, POSE.jump[1] * 0.4, POSE.jump[1]) : 0;
    const move = this.moveT;
    const runK = THREE.MathUtils.clamp((speed - POSE.walkTop) / (POSE.pace.run - POSE.walkTop), 0, 1);
    let hit = 0;
    const hitLen = this.dur[this.hitClip];
    if (this.hitT >= 0) {
      this.hitT += dt;
      if (this.hitT >= hitLen) this.hitT = -1;
      else hit = POSE.flinch * Math.sin((Math.PI * this.hitT) / hitLen) * (1 - down);
    }
    const rest = 1 - hit;
    const w: Record<Clip, number> = {
      idle: stand * (1 - move) * rest,
      walk: stand * move * (1 - runK) * rest,
      run: stand * move * runK * rest,
      crouchIdle: duck * (1 - move) * rest,
      crouchWalk: duck * move * rest,
      jumpStart: air * push * rest,
      jumpLoop: air * (1 - push) * rest,
      jumpLand: land * rest,
      death: 0,
      deathFront: 0,
      deathSide: 0,
      hit: this.hitClip === 'hit' ? hit : 0,
      hitHead: this.hitClip === 'hitHead' ? hit : 0,
    };
    w[this.deathClip] = down;
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
    // Twice a stride a foot comes down. Where in the stride that is moves with the pace, so
    // it is counted against where it is now: a change of pace that carries the place past the
    // legs is a foot landing too, and not one that goes unheard.
    let footfall = false;
    const plant = this.plantAt;
    if (stepping > 1e-3 && dirSign === this.dirWas) {
      const adv = (cadence / stepping) * dt * dirSign;
      this.phase = (((this.phase + adv) % 1) + 1) % 1;
      const at = this.halves + (adv - (plant - this.plantWas)) * 2;
      footfall = dirSign > 0 ? Math.floor(at) > Math.floor(this.halves) : Math.ceil(at) < Math.ceil(this.halves);
      this.halves = at;
    } else {
      // standing, in the air, or the legs have just turned to step the other way: count afresh
      if (stepping > 1e-3) this.phase = (((this.phase + (cadence / stepping) * dt * dirSign) % 1) + 1) % 1;
      this.halves = (this.phase - plant) * 2;
    }
    this.plantWas = plant;
    this.dirWas = dirSign;
    // (not two in a breath: the place moving the other way can bring the same foot past it twice)
    this.sinceStep += dt;
    this.footfall = footfall && stepping > 0.35 && speedNow > 0.5 && this.sinceStep > 0.25;
    if (this.footfall) this.sinceStep = 0;
    this.clock += dt;
    for (const n of CLIPS) {
      const a = this.actions[n];
      a.setEffectiveWeight(w[n]);
      if (n === 'death' || n === 'deathFront' || n === 'deathSide') a.time = Math.min(this.downT, this.dur[n] - 1e-3);
      else if (n === 'hit' || n === 'hitHead') a.time = Math.min(Math.max(0, this.hitT), this.dur[n] - 1e-3);
      else if (n === 'jumpStart') a.time = Math.min(this.dur[n] - 1e-3, POSE.jump[0] + Math.max(0, this.jumpT));
      else if (n === 'jumpLand') a.time = Math.min(this.dur[n] - 1e-3, POSE.landFrom + Math.max(0, this.landT));
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
    this.heldPivot.visible = !dead && !using;
    this.heldPivot.rotation.set(pitch, -this.twist, 0);
    this.aimT += ((aiming && !dead ? 1 : 0) - this.aimT) * ease(12);
    this.carryT += (THREE.MathUtils.smoothstep(speed, 2.6, 3.6) * (1 - this.aimT) - this.carryT) * ease(7);
    const carry = this.carryT * (1 - this.aimT);

    const lean = !dead && (held || Math.abs(pitch) > 0.02);
    const lift = POSE.crouchLift * this.crouchT;
    if (!dead && (lean || Math.abs(this.twist) > 0.003 || Math.abs(lift) > 0.003)) {
      this.root.updateMatrixWorld(true);
      // the legs have turned; from the waist up the body still faces the aim
      const n = this.spine.length;
      const aimQ = _aimQ.setFromAxisAngle(UP, this.yaw);
      _right.set(1, 0, 0).applyQuaternion(aimQ);
      // a long gun is held across the body: chest turned off the aim, left shoulder leading,
      // the head still looking down the barrel
      // (and square again for a run, the gun carried across the chest)
      const blade = held?.long ? POSE.hold.blade * (1 - carry) : 0;
      for (const b of this.spine) {
        this.turn(b, UP, (-this.twist - blade) / n);
        if (lift) this.turn(b, _right, lift / n);
      }
      if (blade) for (const b of this.neck) this.turn(b, UP, blade / this.neck.length);
      if (lean) {
        if (this.chest) this.turn(this.chest, _right, pitch * 0.45);
        // and the head goes the rest of the way: you can see where somebody is looking
        for (const b of this.neck) this.turn(b, _right, (pitch * POSE.headPitch) / this.neck.length);
        if (held && this.armR && this.armL) {
          // The weapon hangs from the shoulders, wherever the clips have taken them: down
          // into a crouch, up and down with each stride.
          const mid = this.armL.arm.getWorldPosition(_a).add(this.armR.arm.getWorldPosition(_b)).multiplyScalar(0.5);
          this.root.worldToLocal(mid);
          this.heldPivot.position.copy(_b.set(0, POSE.hold.pivot[0], POSE.hold.pivot[1]).applyAxisAngle(UP, -this.twist)).add(mid);
          const { obj, grips, long, base } = held;
          const set = long ? POSE.hold.long : POSE.hold.pistol;
          const wAim = this.aimT, wReady = 1 - wAim - carry;
          obj.position.set(0, 0, 0);
          for (const [s, w] of [[set.ready, wReady], [set.carry, carry], [set.aim, wAim]] as [Stance, number][]) {
            obj.position.x += s.p[0] * w;
            obj.position.y += s.p[1] * w;
            obj.position.z += s.p[2] * w;
          }
          const turned = (s: Stance, q: THREE.Quaternion) => q.setFromEuler(_euler.set(s.r[0], s.r[1], s.r[2], 'YXZ'));
          turned(set.ready, _qa);
          if (carry > 0.001) _qa.slerp(turned(set.carry, _qb), carry / Math.max(1e-4, 1 - wAim));
          if (wAim > 0.001) _qa.slerp(turned(set.aim, _qb), wAim);
          obj.quaternion.copy(_qa).multiply(base);
          // the hands at work on the weapon (grip points are in its own space: x toward the muzzle, y up)
          let gripR = grips.right, gripL = grips.left;
          if (ges) {
            const k = ges.t / ges.dur;
            const sm = (a: number, b: number) => THREE.MathUtils.smoothstep(k, a, b);
            if (long && gripR) {
              // the right hand leaves the grip for the bolt handle; the rifle rolls over to meet it
              const bolt = ges.kind === 'bolt';
              const off = bolt ? sm(0, 0.14) * (1 - sm(0.86, 1)) : sm(0, 0.08) * (1 - sm(0.94, 1));
              const back = bolt ? sm(0.22, 0.45) - sm(0.48, 0.7) : 0.5 + 0.5 * Math.sin(ges.t * 13);
              gripR = { ...gripR, pos: gripR.pos.clone().lerp(_w.set(-0.235 - back * 0.07, 0.065, 0.06), off) };
              obj.quaternion.multiply(_q1.setFromAxisAngle(_X, 0.32 * off));
            } else if (!long && gripL) {
              // a fresh magazine: the left hand goes down to the belt for it and comes back up under the grip
              const away = sm(0.1, 0.32) * (1 - sm(0.5, 0.78));
              gripL = { ...gripL, pos: gripL.pos.clone().add(_w.set(-0.02 * away, -0.3 * away, -0.06 * away)) };
              obj.quaternion.multiply(_q1.setFromAxisAngle(_X, -0.3 * sm(0, 0.15) * (1 - sm(0.8, 1))));
            }
          }
          this.heldPivot.updateMatrixWorld(true);
          // the leading shoulder comes forward to the gun
          if (blade && this.collarL) this.turn(this.collarL, UP, -POSE.hold.reach * (1 - carry));
          if (gripR) this.solveArm(this.armR, gripR, obj, aimQ);
          // the forward hand may sit further back along the stock than the first-person arms
          // have it: these arms are only so long
          if (gripL) this.solveArm(this.armL, gripL, obj, aimQ, gripR && !(ges && !long) ? _slide.set(0, 0, 1).applyQuaternion(_qa).applyQuaternion(this.heldPivot.getWorldQuaternion(_q1)) : undefined);
        }
      }
    }

    // --- the right arm on its own: a blow, and the fist closed round a handle
    if (!dead && this.armR && (this.swingT >= 0 || this.inHand)) {
      const r = this.armR;
      if (this.swingT >= 0) {
        this.swingT += dt;
        const u = this.swingT / POSE.swing;
        if (u >= 1) this.swingT = -1;
        else {
          // wound up behind the shoulder, then brought down across the body
          const wind = Math.sin(Math.PI * Math.min(1, u / 0.4)) * (u < 0.4 ? 1 : 0), strike = THREE.MathUtils.smoothstep(u, 0.3, 0.6) * (1 - THREE.MathUtils.smoothstep(u, 0.7, 1));
          this.root.updateMatrixWorld(true);
          _right.set(1, 0, 0).applyQuaternion(_aimQ.setFromAxisAngle(UP, this.yaw));
          this.turn(r.arm, _right, 1.5 * wind + 0.9 * strike);
          this.turn(r.fore, _right, 0.9 * wind + 0.2 * strike);
          this.turn(r.arm, UP, 0.5 * strike);
          if (this.chest) this.turn(this.chest, UP, 0.25 * strike - 0.15 * wind);
        }
      }
      if (this.inHand) {
        r.hand.updateWorldMatrix(true, false);
        this.curl(r, this.inHand.curl, r.hand.getWorldQuaternion(_qa));
      }
    }

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
        }
      }
      const side = this.punchT >= 0 ? this.punchSide : 0;
      // the shoulder goes in behind the punch
      if (this.chest) this.turn(this.chest, UP, side * (side > 0 ? 0.38 : 0.26) * out - side * 0.08 * wind * (1 - out));
      this.root.updateMatrixWorld(true);
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

    // --- hands busy with something that is not a weapon
    if (using && ges && this.armR && this.armL && this.neck.length) {
      this.root.updateMatrixWorld(true);
      const aimQ = _aimQ.setFromAxisAngle(UP, this.yaw);
      const fwd = _fwd.set(0, 0, -1).applyQuaternion(aimQ);
      _right.set(1, 0, 0).applyQuaternion(aimQ);
      const head = this.neck[this.neck.length - 1].getWorldPosition(_head);
      // a point measured from the head: ahead of it, above it, to its right
      const at = (f: number, u: number, r: number) => new THREE.Vector3().copy(head).addScaledVector(fwd, f).addScaledVector(UP, u).addScaledVector(_right, r);
      const dirOf = (f: number, u: number, r: number) => new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(UP, u).addScaledVector(_right, r);
      const wgt = THREE.MathUtils.smoothstep(ges.t, 0, 0.3) * (1 - THREE.MathUtils.smoothstep(ges.t, ges.dur - 0.25, ges.dur));
      if (ges.kind === 'eat' || ges.kind === 'drink') {
        // up to the mouth and back down, once a bite or a gulp
        const period = ges.kind === 'eat' ? 0.95 : 1.25;
        const cyc = 0.5 - 0.5 * Math.cos((Math.max(0, ges.t - 0.3) / period) * Math.PI * 2);
        const m = ges.kind === 'drink' ? Math.pow(cyc, 0.6) : cyc;
        this.reach(this.armR, at(0.3, -0.36, 0.12).lerp(at(0.17, -0.06, 0.05), m), dirOf(-0.2 * m, 0.8, -0.5), dirOf(-1, 0, -0.4), [1.0, 1.05, 1.1, 1.15], aimQ, wgt);
      } else {
        // both hands in front of the belly: the left held still, the right working round it
        const l = at(0.28, -0.4, -0.07);
        this.reach(this.armL, l, dirOf(1, 0, 0.6), dirOf(0, 1, 0), [0.5, 0.55, 0.6, 0.65], aimQ, wgt);
        const a = ges.t * (ges.kind === 'bandage' ? 5.5 : 9);
        const r = l.clone().addScaledVector(_right, 0.08).addScaledVector(UP, 0.05 + Math.cos(a) * 0.045).addScaledVector(fwd, 0.02 + Math.sin(a) * 0.045);
        this.reach(this.armR, r, dirOf(0.4, 0, -1), dirOf(0, -1, 0), [0.9, 0.95, 1, 1.05], aimQ, wgt);
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
