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
import { bent, type Grips, type HandGrip } from './arms';
import { BEARD, HAIR_STYLES, MAX_WOUNDS, loadCharacter, lookFor, lookPatch, lookUniforms, setLookUniforms, stainPatch, suitPatch, type BodyFile, type Look, type LookUniforms } from './look';
import type { Emote } from '../sim/emotes';
import { INFECTED } from '../sim/infected';

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

const CLIPS = ['idle', 'walk', 'run', 'crouchIdle', 'crouchWalk', 'jumpStart', 'jumpLoop', 'jumpLand', 'death', 'deathFront', 'deathSide', 'hit', 'hitHead', 'dance', 'sit', 'armed', 'strike'] as const;
type Clip = (typeof CLIPS)[number];
const STRIDES = ['walk', 'run', 'crouchWalk'] as const;
type Stride = (typeof STRIDES)[number];
/** the ways of going down: thrown onto the back, pitched onto the face, folded onto the side */
export const DEATHS = ['death', 'deathFront', 'deathSide'] as const;
/** where a body lies once it is down, from where it stood: metres ahead of its feet (negative = behind) and to its left */
export const DEATH_REST: [number, number][] = [[-0.85, 0], [0.9, 0], [0.05, 0.36]];

/** what the hands can be seen doing */
export type Gesture = 'bolt' | 'reload' | 'eat' | 'drink' | 'bandage' | 'open';
/** from the wheel (src/sim/emotes.ts): what the arms do with a call, and what the body keeps up until told otherwise */
export type Move = NonNullable<Emote['move']>;
export type Hold = NonNullable<Emote['hold']>;

/**
 * Worn things that are drawn on the body. `p`, `r`, `s` place the item's model on the body
 * as it stands at rest (x to its right, y up, z behind it); the bone then carries it.
 */
export const GEAR: Record<string, { bone: 'Head' | 'spine_03'; p: [number, number, number]; r: [number, number, number]; s: [number, number, number]; pack?: boolean }> = {
  // (the one backpack at two sizes: its straps are toward the body as its model comes, so it is not turned)
  sack_pack: { bone: 'spine_03', p: [0, 0.97, 0.2], r: [0.05, 0, 0], s: [1, 1, 1], pack: true },
  suitcase: { bone: 'spine_03', p: [0, 0.87, 0.215], r: [0.05, 0, 0], s: [1, 1, 1], pack: true },
  // (the hood of it alone: see `facepiece`. As its model lies, the crown is toward -x and the eyepieces look along +z)
  // (the helmet: its brow is toward +x as its model stands, so it is turned a quarter round)
  boonie_hat: { bone: 'Head', p: [0, 1.593, 0.035], r: [0, Math.PI / 2, 0], s: [1, 1, 1] },
  // (a hood over the whole head, a little larger than life so the head and what is on it are inside it)
  gasmask: { bone: 'Head', p: [0.1155, 1.141, -0.04], r: [0, Math.PI, -Math.PI / 2], s: [1.1, 1.1, 1.1] },
};

/** how far along the gas mask's model (its own x, metres) the hood and its valve end and the hose begins */
const MASK_HOSE = -0.215;
/**
 * A gas mask as it is worn: the hood and its valve. The hose and the filter can it lies with
 * on a table are left off: they are one stiff piece with it, and on a head that turns they
 * would stand out of it like a handle.
 */
export function facepiece(obj: THREE.Object3D) {
  obj.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone();
    const P = g.getAttribute('position');
    const keep = new Uint8Array(P.count);
    for (let i = 0; i < P.count; i++) keep[i] = v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld).x < MASK_HOSE ? 1 : 0;
    const index = g.index ? Array.from(g.index.array) : Array.from({ length: P.count }, (_, i) => i);
    const kept: number[] = [];
    for (let i = 0; i + 2 < index.length; i += 3) if (keep[index[i]] && keep[index[i + 1]] && keep[index[i + 2]]) kept.push(index[i], index[i + 1], index[i + 2]);
    g.setIndex(kept);
    mesh.geometry = g;
  });
  return obj;
}
/**
 * Worn things that are part of the body itself: pieces of the suit (scripts/suit.mjs), on its
 * skeleton and cut to it, that are there or not. [what is worn]: the pieces it shows.
 */
export const WORN: Record<string, string[]> = {
  life_vest: ['gear_plate', 'gear_pouches'],
};
export const GEAR_SHOWN = new Set([...Object.keys(GEAR), ...Object.keys(WORN)]);

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
  /** leaning out (Q, E): how far over the body goes from the waist up, radians, and how far the hips go with it, metres */
  leanAngle: 0.64,
  leanHips: 0.1,
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
    /** where the head is from that same point with the body standing, which is what `aim` was set for: [up, back] */
    eye: [0.146, -0.028] as [number, number],
    /** long guns: the chest turns this far off the aim, left shoulder leading, radians (at 0.5 the left hand could not reach a rifle's fore-end) */
    blade: 0.75,
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

/** how near the eye a hand has to be for its thumb to be worth laying, metres */
const THUMB_SEEN = 16;

/** how long the infected's blow takes from the arms going up to their coming back, seconds */
/** how long one of the infected's lunges takes (see src/sim/infected.ts) */
const CLAW = INFECTED.lunge;
/**
 * How the infected get about. Their walk is the game's own, at whatever pace they are going;
 * their run is another body's, drawn to another length with several strides in it, so it is
 * not stepped in time with the walk (which played it at better than twice its pace): above
 * `from` metres a second it is faded in over the walk, all of it by `to`, and it keeps its
 * own time, at the pace it was drawn for (`pace`, metres a second) or as near as `give` lets it be.
 */
// (Measured on the body: a foot on the ground goes back under it at about 2.3 m/s as the clip
// was drawn. Played at that pace under a body going 3.3, the feet slid a metre a second.)
const SICK_GAIT = { from: 1.9, to: 2.7, pace: 2.3, give: [0.8, 1.5] };
/** how far through it the blow lands */
const CLAW_HIT = INFECTED.windup / CLAW;

/**
 * The blow the animation library draws (`strike`): the arm is drawn up and back until 0.3 s
 * into it, comes down through whatever is in front at 0.43 s, hangs there, and is home by
 * 1.1 s. A blow in the game lands a share `hit` of the way through its own time (0.35 for a
 * player's, see Weapons.actionTick), so the drawing is run at whatever pace puts its 0.43 s
 * there.
 * @param u how far through the blow, 0..1
 */
export function strikeAt(u: number, hit = 0.35): number {
  return u < hit ? THREE.MathUtils.lerp(0.07, 0.43, u / hit) : THREE.MathUtils.lerp(0.43, 1.1, (u - hit) / (1 - hit));
}
/** how much of the body is given over to it: taken up quickly at the start, handed back over the last quarter */
export const strikeShare = (u: number) => THREE.MathUtils.smoothstep(u, 0, 0.1) * (1 - THREE.MathUtils.smoothstep(u, 0.74, 1));
/** how much of a clip laid over the body each bone takes: all of it from the chest out, less at the waist and the head, none below the waist (unless the legs are given over too) */
const LAID: [RegExp, number][] = [
  [/^spine_01$/, 0.55], [/^spine_02$/, 0.85], [/^spine_03$/, 1], [/^neck_01$/, 0.6], [/^Head$/, 0.35],
  [/^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/, 1],
];

/** how far the middle of the thumb lies from the middle of the finger it is laid against, metres */
const THUMB_BESIDE = 0.02;

/**
 * A bat carried on the shoulder: where the right wrist is from the head (ahead of it, above it,
 * to its right, metres), and which way the fingers and the palm of that hand are turned (the
 * same three: ahead, up, right).
 */
const SHOULDER = {
  at: [0.2, -0.42, 0.21] as [number, number, number],
  fingers: [0.93, 0.36, 0] as [number, number, number],
  // (turned a little up as well as in: the bat leans out over the shoulder, clear of the ear)
  palm: [0, 0.14, -1] as [number, number, number],
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
  /** how each joint of each finger is turned on an open hand (the body at rest) */
  open: THREE.Quaternion[][];
  /** from its root out; the last is only the tip */
  thumb: THREE.Bone[];
  pole: THREE.Vector3;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
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
/** how far under its ankle a body's sole is (in the foot's own measure), by the file it was made from and the side */
const SOLE_UNDER = new Map<string, number>();

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
  /** the same pairs, with how much of a clip laid over the body each takes (see LAID) and whether it is below the waist (2: the hips themselves) */
  private laid: [THREE.Object3D, THREE.Object3D, number, 0 | 1 | 2][] = [];
  /** the two skeletons' own roots: a bone's turn is compared between them from there */
  private driverRoot!: THREE.Object3D;
  private modelRoot!: THREE.Object3D;
  /** a blow with something in the fist: seconds into it (-1 none), and how long it takes */
  private strikeT = -1;
  private strikeDur = 0.6;
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
  private move: { kind: Move; t: number; dur: number } | null = null;
  private hold: Hold | null = null;
  // how far into the dance, and how far up the hands are, 0..1
  private danceT = 0;
  /** in a seat, and how far into sitting the body has got */
  private seated = false;
  private seatT = 0;
  private handsT = 0;
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
  /** leaning out to one side, -1 (left) .. 1 (right): the body from the waist up goes over, the feet stay */
  private leanT = 0;
  /** the joints a shot is judged by (see frame) */
  private joints: { head?: THREE.Bone; neck?: THREE.Bone; pelvis?: THREE.Bone } = {};
  /** the feet of a body that is to be kept standing on them (the infected): its ankles as it was made, and how far it is let down just now */
  private soles: { foot: THREE.Bone; ball: THREE.Bone; /** how high its ankle is over its sole, as it was made */ high: number; /** how the foot lies, as it was made (in the body's own space) */ made: THREE.Quaternion; /** how its toes lie on the foot, as it was made */ toe: THREE.Quaternion }[] = [];
  private sunk = 0;
  private backing = false;
  private layerMask = 1;
  /** weapon in the hands: pivot (at the shoulders, pitches with the aim) > the model */
  private heldPivot = new THREE.Group();
  private held: { obj: THREE.Object3D; grips: Grips; long: boolean; base: THREE.Quaternion } | null = null;
  /** a one-handed weapon in the right fist */
  private inHand: { obj: THREE.Object3D; curl: [number, number, number, number]; shoulder: boolean } | null = null;
  /** how far what is in the fist has been laid back on the shoulder (see `shoulder` in HandGrip), 0..1 */
  private shoulderT = 0;
  /** seconds into a swing of the right arm (-1 = not swinging) */
  private swingT = -1;
  // bare hands: seconds into a punch (-1 = none) and whose it is, how long the fists stay up, how far up they are
  private punchT = -1;
  private punchSide = -1;
  private fistsHold = 0;
  private fistsT = 0;
  /** where one of the infected is in its run, seconds */
  private sickRun = 0;
  /** on guard: the fists are up (and what is in the right one with them) for as long as this is set */
  guarding = false;
  /** on a broken leg (see src/sim/injury.ts): it is seen in how they go */
  limping = false;
  private limpT = 0;
  // how far the weapon is up at the eye, and how far it is in its running carry, 0..1
  private aimT = 0;
  private carryT = 0;
  slung = new THREE.Group();
  private uniforms?: LookUniforms;
  /** the body mesh, and the bones a wound can be pinned to (index into its skeleton, and the bone it runs to) */
  private skin?: THREE.SkinnedMesh;
  private woundBones: [number, THREE.Object3D | undefined][] = [];
  /** the pieces of the suit that are there only when what they are is worn */
  private pieces = new Map<string, THREE.Object3D>();
  private woundN = 0;
  private hair: (THREE.Object3D | undefined)[] = [];
  private beard?: THREE.Object3D;
  private hairMats: THREE.MeshStandardMaterial[] = [];

  /**
   * @param layer render layer of the full body (0 = an ordinary object everyone sees)
   * @param firstPersonBody also build the headless, armless copy for the local first-person view
   * @param look clothes, skin and hair (see setLook)
   * @param file which body (see BodyFile)
   */
  async load(atmo: Atmosphere, layer = AVATAR_LAYER, firstPersonBody = false, look: Look = lookFor(''), file: BodyFile = 'survivor') {
    const gltf = await loadCharacter(file);
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
    // where each shape's points are among the body shape's (worked out below, once the body shape is known)
    const rests: [THREE.SkinnedMesh, THREE.Matrix4][] = [];
    const rest = (m: THREE.SkinnedMesh) => {
      const r = new THREE.Matrix4();
      if (m.isSkinnedMesh) rests.push([m, r]);
      return r;
    };
    // the suit, or the plain body the game had before it (the character build can still make either)
    const suit = !!model.getObjectByName('pads');
    const zombie = file !== 'survivor';
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        if (m.isSkinnedMesh) m.frustumCulled = false;
        const src = m.material as THREE.MeshStandardMaterial;
        if (zombie) {
          // one of the infected: painted as it came, and bloodied by what is done to it
          const mat = src.clone(), at = rest(m);
          atmo.register(mat, (shader) => stainPatch(shader, uniforms, at), 'zombie');
          m.material = mat;
          if (m.name === 'body') this.skin = m;
        } else if (suit) {
          // every piece of it takes this body's stains; the cloth takes its colours as well
          const mat = src.clone(), at = rest(m);
          atmo.register(mat, (shader) => suitPatch(shader, uniforms, at), 'suit');
          m.material = mat;
          if (m.name === 'body') this.skin = m;
          if (m.name.startsWith('gear_')) {
            this.pieces.set(m.name, m);
            m.visible = false;
          }
        } else if (m.name === 'body') {
          const mat = src.clone(), at = rest(m);
          atmo.register(mat, (shader) => lookPatch(shader, uniforms, at), 'survivor');
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
      // A file's shapes are each packed into a box of their own, and the unpacking is folded
      // into where each one's bones are said to have been bound. From one shape's numbers to
      // the body shape's is therefore: out through its own first bone, in through the body's.
      const body = this.skin, into = new THREE.Matrix4().copy(body.skeleton.boneInverses[0]).multiply(body.bindMatrix).invert();
      for (const [m, r] of rests) r.copy(into).multiply(m.skeleton.boneInverses[0]).multiply(m.bindMatrix);
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
    this.joints = { head: bone('Head') ?? undefined, neck: bone('neck_01') ?? undefined, pelvis: bone('pelvis') ?? undefined };
    // The infected's feet, as each body was MADE standing (see `plant`): which way the foot lies, how its toes lie
    // on it, and how high its ankle is over its sole. Not as its skeleton rests: these bodies wear a skeleton
    // that was brought to them, which rests as the game's own body stands and not as they do, and a foot laid
    // as the skeleton rests stood on its toes. What a body was made as is in what its shape is bound by.
    if (file !== 'survivor') {
      model.updateMatrixWorld(true);
      const skinned: THREE.SkinnedMesh[] = [];
      model.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
      });
      const sk = skinned[0]?.skeleton;
      this.soles = [];
      for (const side of ['l', 'r']) {
        const foot = bone(`foot_${side}`), ball = bone(`ball_${side}`);
        const fi = sk && foot ? sk.bones.indexOf(foot) : -1, bi = sk && ball ? sk.bones.indexOf(ball) : -1;
        if (!foot || !ball || !sk || fi < 0 || bi < 0) continue;
        const toFoot = sk.boneInverses[fi];
        const made = new THREE.Quaternion(), toes = new THREE.Quaternion();
        _m1.copy(toFoot).invert().decompose(_v1, made, _v2);
        _m1.copy(sk.boneInverses[bi]).invert().decompose(_v1, toes, _v2);
        // (how far under the ankle the sole is: the lowest of everything that hangs on the foot and its toes.
        // The same for every body made from one file: measured once.)
        const key = `${file}:${side}`;
        let low = SOLE_UNDER.get(key);
        if (low === undefined) {
          const down = _v3.set(0, -1, 0).applyQuaternion(_q1.copy(made).invert());
          low = 0;
          for (const m of skinned) {
            const P = m.geometry.getAttribute('position') as THREE.BufferAttribute, J = m.geometry.getAttribute('skinIndex'), W = m.geometry.getAttribute('skinWeight');
            const mf = m.skeleton.bones.indexOf(foot), mb = m.skeleton.bones.indexOf(ball);
            for (let i = 0; i < P.count; i++) {
              let w = 0;
              for (let c = 0; c < 4; c++) {
                const j = J.getComponent(i, c);
                if (j === mf || j === mb) w += W.getComponent(i, c);
              }
              if (w < 0.6) continue;
              low = Math.max(low, _v1.fromBufferAttribute(P, i).applyMatrix4(m.bindMatrix).applyMatrix4(toFoot).dot(down));
            }
          }
          SOLE_UNDER.set(key, low);
        }
        this.soles.push({ foot, ball, high: low * foot.getWorldScale(_v1).y, made, toe: made.clone().invert().multiply(toes) });
      }
    }
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
      if (!from) return;
      this.drive.push([from, o]);
      this.laid.push([from, o, LAID.find(([re]) => re.test(o.name))?.[1] ?? 0, o.name === 'pelvis' ? 2 : /^(thigh|calf|foot|ball)_/.test(o.name) ? 1 : 0]);
    });
    this.driverRoot = driver;
    this.modelRoot = model;
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
    const thumb = ['thumb_01', 'thumb_02', 'thumb_03', 'thumb_04_leaf'].map(B).filter((b): b is THREE.Bone => !!b);
    return { arm, fore, hand, la: pa.distanceTo(pf), lb: pf.distanceTo(ph), fingersLocal: fingersW.applyQuaternion(hq), palmLocal: palmW.applyQuaternion(hq), fingers, open: fingers.map((chain) => chain.map((b) => b.quaternion.clone())), thumb, pole: pole.normalize() };
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
    for (const p of this.pieces.values()) p.visible = false;
    for (const { id, obj } of items) {
      for (const name of WORN[id] ?? []) {
        const p = this.pieces.get(name);
        if (p) p.visible = true;
      }
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
  /**
   * Where the end of the barrel in its hands is, in the world, and which way the barrel
   * points: for the flash of a shot. Null if it holds no gun, or one whose barrel is not known.
   */
  muzzle(pos = new THREE.Vector3(), dir = new THREE.Vector3()): { pos: THREE.Vector3; dir: THREE.Vector3 } | null {
    const obj = this.held?.obj, at = obj?.userData.muzzle as number[] | undefined;
    if (!obj || !at || !this.root.visible) return null;
    obj.updateWorldMatrix(true, false);
    pos.set(at[0], at[1], at[2]).applyMatrix4(obj.matrixWorld);
    // (the gun lies along its own x)
    dir.set(at[0] + 1, at[1], at[2]).applyMatrix4(obj.matrixWorld).sub(pos).normalize();
    return { pos, dir };
  }

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
      this.inHand = { obj: fist, curl: g.curl, shoulder: !!g.shoulder };
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

  /**
   * Lays the thumb against the first finger, wherever the movement and the grip have left
   * that. The movements this body was given were made for a hand drawn as a mitten: they close
   * the fingers and leave the thumb out straight, which on a hand with a real thumb is a
   * spike standing out of every fist. Done last, on both hands, every frame.
   */
  private thumb(r: ArmRig) {
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
      // world -> that bone -> where the bone stands at rest -> the body shape's own space
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
  swing(overhand = false, seconds = 0.62) {
    if (this.inHand && !overhand) {
      // something in the fist to strike with: the blow the library draws
      this.strikeT = 0;
      this.strikeDur = seconds;
      return;
    }
    if (overhand || this.held) {
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

  /** where the game is being looked at from: bodies spend less on what cannot be seen from there (set each frame by the game) */
  static readonly eye = new THREE.Vector3();

  /**
   * One of the infected: how it carries itself. `roused` is how far it is after somebody
   * (0 slack and shambling, 1 arms out and coming); `claw` is the blow it is throwing (seconds
   * into it, -1 none); `seed` keeps one from swaying in time with the next.
   */
  sick: { roused: number; claw: number; seed: number } | null = null;

  /** The infected strike: both arms brought down on whoever is in front of them. */
  claw() {
    if (this.sick) this.sick.claw = 0;
  }

  /** a turn about a world axis that leaves the bones below it to be brought up to date later, all at once */
  private lean(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
    bone.getWorldQuaternion(_q2).premultiply(_q1.setFromAxisAngle(axis, angle));
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(_q3).invert().multiply(_q2));
  }

  /**
   * The infected stand on their feet. Their movements were drawn for other legs than each of
   * these bodies has, and the lean laid over them tips the hips: left alone, the feet hang a
   * hand's breadth off the ground with their toes down. So the whole body is let down (or
   * lifted) until the nearer ankle is as high as it was made to be; and a foot that is down is
   * laid the way it was made to lie, heel and toe on the ground. A foot in the air mid-stride
   * is left to the movement.
   */
  private plant(dt: number) {
    const pelvis = this.joints.pelvis;
    if (!pelvis || this.soles.length < 2) return;
    this.root.updateMatrixWorld(true);
    const ground = this.root.position.y;
    let gap = Infinity;
    for (const s of this.soles) gap = Math.min(gap, s.foot.getWorldPosition(_v1).y - ground - s.high);
    // (it comes to its feet over a few frames, not at once: the nearer foot changes as it walks)
    this.sunk += (THREE.MathUtils.clamp(gap, -0.15, 0.3) - this.sunk) * (1 - Math.exp(-14 * dt));
    const up = pelvis.parent!.getWorldScale(_v2).y || 1;
    _v1.set(0, -this.sunk / up, 0).applyQuaternion(pelvis.parent!.getWorldQuaternion(_q3).invert());
    pelvis.position.add(_v1);
    pelvis.updateWorldMatrix(false, true);
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
      s.foot.updateWorldMatrix(false, true);
    }
  }

  /**
   * The carriage of the infected, laid over whatever movement is playing: the back bent,
   * the head hung over to one side and rolling, and once it is roused the arms held out at
   * whoever it is after and thrown at them when it strikes.
   */
  private sicken(dt: number) {
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
    this.root.updateMatrixWorld(true);
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

  /** A call from the wheel: what the arms do with it (a wave, a point). null drops them. */
  emote(kind: Move | null, dur = 1.5) {
    this.move = kind ? { kind, t: 0, dur } : null;
  }

  /** Dancing, standing with the hands up, or neither. */
  setHold(hold: Hold | null) {
    this.hold = hold;
  }

  /**
   * Where the body is, in the world, as it stands this frame: the middle of the head, the
   * base of the neck and the hips. Whatever is to be hit is hung on these, so that a shot at
   * the head that is seen is a shot at the head that counts, whatever the body is doing.
   * @returns false until the body has been loaded
   */
  frame(head: THREE.Vector3, neck: THREE.Vector3, pelvis: THREE.Vector3): boolean {
    const j = this.joints;
    if (!j.head || !j.neck || !j.pelvis) return false;
    j.head.updateWorldMatrix(true, false);
    // (the joint is at the base of the skull: the middle of the head is a hand's breadth up it)
    head.setFromMatrixPosition(j.head.matrixWorld).addScaledVector(_a.setFromMatrixColumn(j.head.matrixWorld, 1).normalize(), 0.097);
    neck.setFromMatrixPosition(j.neck.matrixWorld);
    pelvis.setFromMatrixPosition(j.pelvis.matrixWorld);
    return true;
  }

  /** Sitting in a jeep's seat (whoever seats it puts it there and turns it with the jeep: see Garage.seatBody). */
  setSeat(on: boolean) {
    this.seated = on;
  }

  /** Leaning out to one side: -1 all the way left, 1 all the way right, 0 upright. */
  setLean(lean: number) {
    this.leanT = THREE.MathUtils.clamp(lean, -1, 1);
  }

  /**
   * One clip at one moment, laid over the body as the others have left it: the chest, the
   * arms and the head take it (see LAID), and the legs go on with what they were doing.
   * @param legs 0..1: how far the hips and legs are given over to it as well (the whole body lunges)
   */
  private layer(clip: Clip, time: number, weight: number, legs = 0) {
    if (weight <= 0.001) return;
    for (const n of CLIPS) this.actions[n].setEffectiveWeight(n === clip ? 1 : 0);
    this.actions[clip].time = THREE.MathUtils.clamp(time, 0, this.dur[clip] - 1e-3);
    this.mixer.update(0);
    // The clip turns its hips as it pleases (a blow is thrown side-on). When the hips are not
    // given over to it, the lowest bone that is has to end up facing the way the CLIP has it
    // face, not that way again from wherever these hips are: so that one is set by where it
    // points from the root, and the ones above it follow from there as the clip has them.
    let seam = legs < 0.999;
    for (const [from, to, share, low] of this.laid) {
      const k = weight * (low ? legs : Math.max(share, legs));
      if (k <= 0.001) continue;
      if (seam && !low) {
        seam = false;
        this.driverRoot.updateWorldMatrix(true, true);
        this.modelRoot.updateWorldMatrix(true, false);
        to.parent!.updateWorldMatrix(true, false);
        const want = this.driverRoot.getWorldQuaternion(_q1).invert().multiply(from.getWorldQuaternion(_q2));
        const have = this.modelRoot.getWorldQuaternion(_q3).invert().multiply(to.parent!.getWorldQuaternion(_q2));
        to.quaternion.slerp(have.invert().multiply(want), k);
        continue;
      }
      to.quaternion.slerp(from.quaternion, k);
      if (low === 2) to.position.lerp(from.position, k);
    }
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
    if (this.move) {
      this.move.t += dt;
      if (this.move.t >= this.move.dur || dead) this.move = null;
    }
    const mv = this.move;
    this.danceT += ((this.hold === 'dance' && !dead ? 1 : 0) - this.danceT) * ease(7);
    this.handsT += ((this.hold === 'surrender' && !dead ? 1 : 0) - this.handsT) * ease(9);
    // eating, drinking, dressing a wound, waving, dancing: whatever was in the hands is put away for it
    this.seatT += ((this.seated && !dead ? 1 : 0) - this.seatT) * ease(9);
    // (and sat in a jeep it is slung)
    const using = (!!ges && ges.kind !== 'bolt' && ges.kind !== 'reload') || !!mv || this.danceT > 0.25 || this.handsT > 0.25 || this.seatT > 0.25;
    const held = using ? null : this.held;
    // fists come up for a punch and stay up a while after it; and on guard they are up, with whatever is in them
    this.fistsHold = Math.max(0, this.fistsHold - dt);
    const fists = ((this.fistsHold > 0 && !this.inHand) || (this.guarding && this.strikeT < 0)) && !dead && !armed && !using;
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
    const runK = this.sick ? THREE.MathUtils.smoothstep(speed, SICK_GAIT.from, SICK_GAIT.to) : THREE.MathUtils.clamp((speed - POSE.walkTop) / (POSE.pace.run - POSE.walkTop), 0, 1);
    if (this.sick) this.sickRun += dt * THREE.MathUtils.clamp(speed / SICK_GAIT.pace, SICK_GAIT.give[0], SICK_GAIT.give[1]);
    let hit = 0;
    const hitLen = this.dur[this.hitClip];
    if (this.hitT >= 0) {
      this.hitT += dt;
      if (this.hitT >= hitLen) this.hitT = -1;
      else hit = POSE.flinch * Math.sin((Math.PI * this.hitT) / hitLen) * (1 - down);
    }
    const rest = 1 - hit;
    // the dance takes the place of standing and walking; nobody dances crouched or in the air
    const dn = this.danceT;
    const w: Record<Clip, number> = {
      idle: stand * (1 - move) * (1 - dn) * rest,
      walk: stand * move * (1 - runK) * (1 - dn) * rest,
      run: stand * move * runK * (1 - dn) * rest,
      dance: stand * dn * rest,
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
      sit: 0,
      armed: 0,
      strike: 0,
    };
    // sat down, sitting is all of it but the flinch
    const st = this.seatT * (1 - down);
    if (st > 0) {
      for (const n of CLIPS) if (n !== 'hit' && n !== 'hitHead') w[n] *= 1 - st;
      w.sit = st * rest;
    }
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
      // (the infected's run keeps its own time: see SICK_GAIT)
      if (this.sick && n === 'run') continue;
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
      else if (n === 'run' && this.sick) a.time = this.sickRun % this.dur[n];
      else if (n === 'walk' || n === 'run' || n === 'crouchWalk') a.time = ((this.phase + POSE.offset[n]) % 1) * this.dur[n];
      else a.time = this.clock % this.dur[n];
    }
    this.mixer.update(0);
    for (const [from, to] of this.drive) {
      to.position.copy(from.position);
      to.quaternion.copy(from.quaternion);
    }

    // --- a blow with something in the fist, or one of the infected's: the library's drawing of one, laid over all that
    if (this.strikeT >= 0) {
      this.strikeT += dt;
      const u = this.strikeT / this.strikeDur;
      if (u >= 1 || dead) this.strikeT = -1;
      else this.layer('strike', strikeAt(u), strikeShare(u));
    }
    if (this.sick && this.sick.claw >= 0 && !dead) {
      // (it throws its whole body after its arm: the lunge is the clip's own)
      const u = this.sick.claw / CLAW;
      this.layer('strike', strikeAt(u, CLAW_HIT), strikeShare(u), 1);
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
    const over = dead ? 0 : this.leanT;
    // (leaning, the hips go a little the same way: the head ends up where the eyes of whoever is leaning are)
    if (over) this.root.position.addScaledVector(_right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), over * POSE.leanHips);
    if (!dead && (lean || Math.abs(this.twist) > 0.003 || Math.abs(lift) > 0.003 || Math.abs(over) > 0.003)) {
      this.root.updateMatrixWorld(true);
      // the legs have turned; from the waist up the body still faces the aim
      const n = this.spine.length;
      const aimQ = _aimQ.setFromAxisAngle(UP, this.yaw);
      _right.set(1, 0, 0).applyQuaternion(aimQ);
      // a long gun is held across the body: chest turned off the aim, left shoulder leading,
      // the head still looking down the barrel
      // (and square again for a run, the gun carried across the chest)
      const blade = held?.long ? POSE.hold.blade * (1 - carry) : 0;
      _fwd.set(0, 0, -1).applyQuaternion(aimQ);
      for (const b of this.spine) {
        this.turn(b, UP, (-this.twist - blade) / n);
        if (lift) this.turn(b, _right, lift / n);
        // leaning out: over from the waist, about the line the body is facing along
        if (over) this.turn(b, _fwd, (over * POSE.leanAngle) / n);
      }
      // (the head stays level: it is the eyes that are being put round the corner)
      if (over) for (const b of this.neck) this.turn(b, _fwd, (-over * POSE.leanAngle * 0.55) / this.neck.length);
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
          // Aimed, the sights come up to the eye, and the stances say where that is from the
          // shoulders of somebody standing: the head a hand and a half above them. Crouched,
          // the back is bent, and the head is forward of the shoulders and hardly above them:
          // the gun was held a hand's breadth over the top of it. It goes where the head has gone.
          if (this.joints.head && this.aimT > 0.001) {
            const head = this.root.worldToLocal(this.joints.head.getWorldPosition(_w));
            this.heldPivot.position.y += (head.y - mid.y - POSE.hold.eye[0]) * this.aimT;
            this.heldPivot.position.z += (head.z - mid.z - POSE.hold.eye[1]) * this.aimT;
          }
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

    // --- a bat, carried: laid back over the right shoulder, the fist on it in front of the chest
    {
      const laid = !!this.inHand?.shoulder && !dead && !using && this.strikeT < 0 && this.swingT < 0 && this.fistsT < 0.02;
      this.shoulderT += ((laid ? 1 : 0) - this.shoulderT) * ease(laid ? 6 : 14);
      if (this.shoulderT > 0.02 && this.inHand && this.armR && this.neck.length) {
        this.root.updateMatrixWorld(true);
        const aimQ = _aimQ.setFromAxisAngle(UP, this.yaw);
        const fwd = _fwd.set(0, 0, -1).applyQuaternion(aimQ);
        _right.set(1, 0, 0).applyQuaternion(aimQ);
        const head = this.neck[this.neck.length - 1].getWorldPosition(_head);
        const dirOf = (f: number, u: number, r: number) => new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(UP, u).addScaledVector(_right, r);
        // (the knuckles forward and a little up, the palm in toward the chest: what is in the fist
        // stands out of the thumb's side of it, up and back, and comes down on the shoulder)
        const to = new THREE.Vector3().copy(head).addScaledVector(fwd, SHOULDER.at[0]).addScaledVector(UP, SHOULDER.at[1]).addScaledVector(_right, SHOULDER.at[2]);
        this.reach(this.armR, to, dirOf(...SHOULDER.fingers), dirOf(...SHOULDER.palm), this.inHand.curl, aimQ, this.shoulderT);
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

    // --- a call from the wheel, or the hands kept up: the arms say it as well
    if (!dead && (mv || this.handsT > 0.02) && this.armR && this.armL && this.neck.length) {
      this.root.updateMatrixWorld(true);
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
        const wgt = THREE.MathUtils.smoothstep(k, 0, 0.22) * (1 - THREE.MathUtils.smoothstep(k, mv.dur - 0.3, mv.dur)) * (1 - this.handsT);
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
        } else {
          // two fingers to the brow, and away
          const out = THREE.MathUtils.smoothstep(k, mv.dur * 0.45, mv.dur * 0.75);
          this.reach(R, at(0.13, 0.03, 0.17).lerp(at(0.34, 0.08, 0.36), out), dirOf(0.1, 0.5, -0.85).lerp(dirOf(0.6, 0.7, -0.2), out), dirOf(0.3, -0.9, 0), [0.1, 0.12, 1.4, 1.5], aimQ, wgt);
        }
      }
    }

    if (this.sick && !dead && this.downT <= 0) {
      this.sicken(dt);
      this.plant(dt);
    }
    // on a broken leg: once a stride the hips drop over it and the back goes after them
    this.limpT += ((this.limping && !dead ? 1 : 0) - this.limpT) * ease(5);
    if (this.limpT > 0.02 && !this.sick && this.downT <= 0) {
      const aimQ = _aimQ.setFromAxisAngle(UP, this.yaw);
      const fwd = _fwd.set(0, 0, -1).applyQuaternion(aimQ);
      _right.set(1, 0, 0).applyQuaternion(aimQ);
      const going = THREE.MathUtils.clamp(this.speed / 0.5, 0, 1) * this.limpT;
      // (down on the bad side for half of each stride, and quickly off it again)
      const drop = Math.max(0, Math.sin(this.phase * Math.PI * 2)) * going;
      const pelvis = this.joints.pelvis;
      if (pelvis) {
        this.lean(pelvis, fwd, 0.05 * this.limpT + drop * 0.21);
        this.lean(pelvis, UP, drop * 0.09);
      }
      for (const b of this.spine) this.lean(b, _right, -(0.04 * this.limpT + drop * 0.05));
      if (this.spine[1]) this.lean(this.spine[1], fwd, -drop * 0.13);
      const head = this.neck[this.neck.length - 1];
      if (head) this.lean(head, fwd, -drop * 0.08);
    }
    // (a thumb is not seen from across the street, nor on the body the eye is in)
    if (!firstPerson && this.root.position.distanceToSquared(Avatar.eye) < THUMB_SEEN * THUMB_SEEN) {
      if (this.armR) this.thumb(this.armR);
      if (this.armL) this.thumb(this.armL);
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
