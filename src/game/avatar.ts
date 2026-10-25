// The survivor's body. Used for the local player (the shadow, the flight in from the menu, and
// the body you see when you look down) and for every other character in the world.
//
// Standing, walking, jogging, sprinting, crouching, falling and dying are clips blended by
// what the character is doing. On top of the clips: the legs turn toward the way the feet
// are travelling while the chest stays on the aim, a weapon in the hands is held with
// two-bone arm IK on the same grip points the first-person arms use, and the upper body
// leans with the aim pitch.

import * as THREE from 'three';
import { restWhileHidden } from '../core/gltf-utils';
import { Line } from '../core/breathe';
import 'three/addons/utils/SkeletonUtils.js';
import '../world/atmosphere';
import type { Atmosphere } from '../world/atmosphere';
import './arms';
import type { Grips, Curl } from './arms';
import './look';
import type { LookUniforms } from './look';
import { assets } from '../core/assets';
import { INFECTED } from '../sim/infected';
import { keepBones } from '../core/bones';
import { WornTag } from './worn-tag';
import { Wardrobe } from './survivors';
import { DEATHS, POSE, type Clip, type Gesture, type Hold, type Move, type SeatPose } from './avatar/pose';
import './avatar/gear';
import { makeMethods } from './avatar/make';
import { dressMethods } from './avatar/dress';
import { handsMethods } from './avatar/hands';
import { woundsMethods } from './avatar/wounds';
import { actsMethods } from './avatar/acts';
import { sickMethods } from './avatar/sick';
import { updateMethods } from './avatar/update';
import { gesturesMethods } from './avatar/gestures';
import type { Gait, Leg } from './avatar/gait';
import type { Deeds, Deed, Stay } from './avatar/deeds';

export { DEATHS, DEATH_REST, PRONE, SIT, CAR_SIT, POSE } from './avatar/pose';
export type { Gesture, Move, Hold, SeatPose } from './avatar/pose';
export { GEAR, facepiece, OVER_MASK, placeWorn, WORN, GEAR_SHOWN } from './avatar/gear';

keepBones();

/** local player's full body: seen by the shadow cameras always, by the main camera only on the flight in from the menu */
export const AVATAR_LAYER = 2;

/** local player's first-person body (no head, no arms): main camera only, first person only */
export const FP_BODY_LAYER = 4;

/** the model stands 1.81 m with its eyes at 1.70 m; the game's eye height is 1.64 m */
export const BODY_SCALE = 0.965;

/** how far from its hips a body can reach, metres, however it is bent: what it is judged in sight by (see Avatar.make) */
export const BODY_REACH = 2.5;

/** (development: a turned joint's branch worked out again at once, as it was, to measure the difference: see setWorldQuat) */
export const EAGER = () => import.meta.env.DEV && !!(globalThis as { __eagerTurn?: boolean }).__eagerTurn;

/** a joint moved: it is brought up to date, and what hangs from it when next asked for (see setWorldQuat) */
export const settle = (o: THREE.Object3D) => (EAGER() ? o.updateMatrixWorld(true) : o.updateWorldMatrix(false, false));

export const settleDown = (o: THREE.Object3D) => o.updateWorldMatrix(false, EAGER());

/** what a bone does when its turn changes: nothing (see Avatar.load) */
export const unread = () => {};

/** bones collapsed in the first-person body: the camera is the head, the viewmodel is the arms */
export const FP_HIDDEN = new Set(['Head', 'upperarm_l', 'upperarm_r']);

/** how far the first-person body sits behind the eye so you look down at your chest, not into it */
export const FP_BACK = 0.3;

/** the limbs a bloodstain can sit on: it goes on whichever is nearest the hit */
export const WOUND_BONES: [string, string | null][] = [['pelvis', 'spine_01'], ['spine_01', 'spine_02'], ['spine_02', 'spine_03'], ['spine_03', 'neck_01'], ['neck_01', 'Head'], ['Head', null], ['upperarm_l', 'lowerarm_l'], ['upperarm_r', 'lowerarm_r'], ['lowerarm_l', 'hand_l'], ['lowerarm_r', 'hand_r'], ['thigh_l', 'calf_l'], ['thigh_r', 'calf_r'], ['calf_l', 'foot_l'], ['calf_r', 'foot_r'], ['foot_l', 'ball_l'], ['foot_r', 'ball_r']];

/** how near the eye a hand has to be for its thumb to be worth laying, metres */
export const THUMB_SEEN = 16;

/** how long the infected's blow takes from the arms going up to their coming back, seconds */
/** how long one of the infected's lunges takes (see src/sim/infected.ts) */
export const CLAW = INFECTED.lunge;

/**
 * How the infected get about. Their walk is the game's own, at whatever pace they are going;
 * their run is another body's, drawn to another length with several strides in it, so it is
 * not stepped in time with the walk (which played it at better than twice its pace): above
 * `from` metres a second it is faded in over the walk, all of it by `to`, and it keeps its
 * own time, at the pace it was drawn for (`pace`, metres a second) or as near as `give` lets it be.
 */
// (Measured on the body: a foot on the ground goes back under it at about 2.3 m/s as the clip
// was drawn. Played at that pace under a body going 3.3, the feet slid a metre a second.)
export const SICK_GAIT = { from: 1.9, to: 2.7, pace: 2.3, give: [0.8, 1.5] };

/** how far through it the blow lands */
export const CLAW_HIT = INFECTED.windup / CLAW;

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
export const LAID: [RegExp, number][] = [
  [/^spine_01$/, 0.55], [/^spine_02$/, 0.85], [/^spine_03$/, 1], [/^neck_01$/, 0.6], [/^Head$/, 0.35],
  [/^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/, 1],
];

/** how far the middle of the thumb lies from the middle of the finger it is laid against, metres */
export const THUMB_BESIDE = 0.02;

/**
 * A bat carried on the shoulder: where the right wrist is from the head (ahead of it, above it,
 * to its right, metres), and which way the fingers and the palm of that hand are turned (the
 * same three: ahead, up, right).
 */
export const SHOULDER = {
  at: [0.2, -0.42, 0.21] as [number, number, number],
  fingers: [0.93, 0.36, 0] as [number, number, number],
  // (turned a little up as well as in: the bat leans out over the shoulder, clear of the ear)
  palm: [0, 0.14, -1] as [number, number, number],
};

/**
 * A torch, carried: the fist before the chest and out to the right, the forearm up, the torch standing in it and leaning a
 * little out, so its flame is at the shoulder's height and clear of the body (the navigator, of one held at the hip: "he
 * looks like his jacket is on fire ... Hold it as DayZ and Rust do"). From the head, as SHOULDER: forward, up, right.
 */
export const RAISE = {
  at: [0.4, -0.44, 0.32] as [number, number, number],
  fingers: [0.92, -0.18, -0.34] as [number, number, number],
  palm: [0.1, 0.12, -1] as [number, number, number],
};

export interface ArmRig {
  arm: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  la: number;
  lb: number;
  /** the reach as the skeleton was made, before a body's own lengths (see Avatar.proportion) */
  la0?: number;
  lb0?: number;
  fingersLocal: THREE.Vector3;
  palmLocal: THREE.Vector3;
  fingers: THREE.Bone[][];
  /** how each joint of each finger is turned on an open hand (the body at rest) */
  open: THREE.Quaternion[][];
  /** from its root out; the last is only the tip */
  thumb: THREE.Bone[];
  pole: THREE.Vector3;
}

export const _a = new THREE.Vector3();

export const _b = new THREE.Vector3();

export const _q1 = new THREE.Quaternion();

export const _q2 = new THREE.Quaternion();

export const _q3 = new THREE.Quaternion();

// (for `curl`: a finger's parent's turn in the world carried down it, its inverse, and the line turned about seen from the parent)
export const _cq = new THREE.Quaternion(), _cq2 = new THREE.Quaternion(), _ch = new THREE.Quaternion(), _ca = new THREE.Vector3();

export const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

export const _m1 = new THREE.Matrix4();

export const _m2 = new THREE.Matrix4();

export const _aimQ = new THREE.Quaternion();

export const _right = new THREE.Vector3();

export const _slide = new THREE.Vector3();

export const _w = new THREE.Vector3();

export const _fwd = new THREE.Vector3();

export const _head = new THREE.Vector3();

export const _X = new THREE.Vector3(1, 0, 0);

export const _Z = new THREE.Vector3(0, 0, 1);

/** below this much of a hold the gun is as good as out of the hands (see `holdT`) */
export const HOLD_GONE = 0.06;

/** seconds the hands are given to come away from something broken off */
export const CUT = 0.2;

export const _qa = new THREE.Quaternion();

export const _qb = new THREE.Quaternion();

export const _euler = new THREE.Euler();

export const UP = new THREE.Vector3(0, 1, 0);

/** the emote pack's movements on the player's skeleton (scripts/emotes.mjs): fetched the first time one is wanted, and kept */
let emoteLib: Promise<Map<string, THREE.AnimationClip>> | null = null;

export const emoteClips = () => (emoteLib ??= assets.loadGLTF('assets/characters/emotes.glb').then((g) => new Map(g.animations.map((c) => [c.name, c]))));

/**
 * Which way each elbow points with both hands on a gun: out from the body and down, the right a little forward.
 * (They pointed where they do for everything else an arm reaches to, nearly straight down and the right one
 * back: with a gun held in front of the chest that drew the upper arms in through the ribs, 7 to 9 cm of the left
 * one inside the chest with a pistol at the ready or carried at a jog, 6 of the right with a rifle. No more of an
 * arm is inside the body now than of one hanging at its side: measured over the stand, the walk, the jog, the
 * sprint, the crouch and the aim, level, up and down, with each kind of gun. See T.arms in the dev harness.)
 */
// (2026-10-13: said from how the chest stands, not from the aim: x out to the body's own right along the line of
// its shoulders, y up, z behind it. Under a chest turned off the aim, "out to the aim's right" was forward of the
// right ribs and across the left ones. `stockR` and `stockL` are for a gun whose butt is in the shoulder: the firing
// elbow down and out from the ribs, the other under the gun and a little out. Measured WITH what is worn, by
// `ST` in src/dev/stance.ts: the first measure was against the bare body, and a plate carrier is 3 cm thicker.)
export const GUN_ELBOW = {
  r: new THREE.Vector3(1.2, -0.75, -0.1), l: new THREE.Vector3(-1.3, -0.85, 0.05),
  stockR: new THREE.Vector3(0.9, -0.5, -0.3), stockL: new THREE.Vector3(-0.5, -0.85, 0.05),
  // (aimed: the firing elbow down and close, the other under the gun)
  aimR: new THREE.Vector3(0.55, -0.8, -0.2), aimL: new THREE.Vector3(-0.35, -0.9, 0.05),
  // (a pistol, held at the belt or out at the eye: the elbows down along the ribs and only a little out. Pointed out
  // to the sides as for a long gun held in front, the forearms lay level across the chest and the shoulders were
  // drawn in: "the arms and shoulders look weird in 3rd person when holding the pistol not ADS")
  pistolR: new THREE.Vector3(1.2, -1, -0.05), pistolL: new THREE.Vector3(-1.2, -1, 0.05),
};

export const _k6 = new THREE.Vector3(), _k7 = new THREE.Vector3(), _k8 = new THREE.Vector3();

export const _k1 = new THREE.Vector3(), _k2 = new THREE.Vector3(), _k3 = new THREE.Vector3(), _k4 = new THREE.Vector3(), _k5 = new THREE.Vector3();

export const _kq = new THREE.Quaternion(), _kr = new THREE.Quaternion();

/** the middle of each kind of long gun's butt (see `buttOf`), by the biggest of the gun's shapes */
const BUTTS = new WeakMap<THREE.BufferGeometry, Butt>();

/** a gun's butt, in the gun's own space: its middle, half its height, and how far over its middle the gun's top is where the eye is put (its sights) */
type Butt = { at: THREE.Vector3; half: number; rise: number };

/**
 * The middle of the butt of a gun, in the gun's own space (it lies along its own x, muzzle at +x): the middle of
 * the rearmost centimetre and a half of whatever of it is shown. Found once for each kind of gun.
 */
export function buttOf(obj: THREE.Object3D): Butt | null {
  obj.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const parts: [THREE.BufferAttribute, THREE.Matrix4][] = [];
  const big = { shape: null as THREE.BufferGeometry | null, n: 0 };
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (let p: THREE.Object3D | null = o; p && p !== obj; p = p.parent) if (!p.visible) return;
    const P = m.geometry.getAttribute('position') as THREE.BufferAttribute;
    parts.push([P, new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)]);
    if (P.count > big.n) {
      big.n = P.count;
      big.shape = m.geometry;
    }
  });
  const key = big.shape;
  if (!key) return null;
  const had = BUTTS.get(key);
  if (had) return had;
  let back = Infinity;
  for (const [P, M] of parts) for (let i = 0; i < P.count; i++) back = Math.min(back, _k1.fromBufferAttribute(P, i).applyMatrix4(M).x);
  const box = new THREE.Box3();
  for (const [P, M] of parts) for (let i = 0; i < P.count; i++) if (_k1.fromBufferAttribute(P, i).applyMatrix4(M).x < back + 0.015) box.expandByPoint(_k1);
  const at = box.getCenter(new THREE.Vector3()).setX(back);
  // (its sights: the top of it between a hand and three hands in front of the butt, where the eye is brought to it)
  let top = at.y;
  for (const [P, M] of parts) for (let i = 0; i < P.count; i++) if (_k1.fromBufferAttribute(P, i).applyMatrix4(M).x > back + 0.12 && _k1.x < back + 0.5) top = Math.max(top, _k1.y);
  const butt = { at, half: (box.max.y - box.min.y) / 2, rise: top - at.y };
  BUTTS.set(key, butt);
  return butt;
}

/** how far under its ankle a body's sole is (in the foot's own measure), by the file it was made from and the side */
export const SOLE_UNDER = new Map<string, number>();

/**
 * Everything a body wears drawn by the body's own skeleton (2026-10-20, found playing the game through with a crowd
 * about: every frame the graphics card was sent each worn piece's bones apart, seven skeletons a body, at about a
 * sixth of a millisecond each, which with twenty players in sight was most of a frame). A piece's bones are the body's
 * own; only how its shape is unpacked (its box: a scale and a shift) is folded into its own copy of them. Laid into
 * the piece's bind matrix instead, it is the body's skeleton that moves it, and each body's bones go to the card once.
 * What is drawn is the same: the piece's bind is checked to be the body's times one fixed matrix on every bone, and
 * a piece that is not is left as it was.
 */
export function shareSkeleton(model: THREE.Object3D, body: THREE.SkinnedMesh) {
  const own = body.skeleton, bodyBind = (i: number) => _m2.copy(own.boneInverses[i]).multiply(body.bindMatrix);
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || m === body || m.skeleton === own) return;
    const sk = m.skeleton;
    if (sk.bones.length !== own.bones.length || !sk.bones.every((b, i) => b === own.bones[i])) return;
    // (the fixed matrix: out through the piece's first bone, in through the body's)
    const r = bodyBind(0).clone().invert().multiply(_m1.copy(sk.boneInverses[0]).multiply(m.bindMatrix));
    for (let i = 0; i < sk.bones.length; i++) {
      const a = _m1.copy(sk.boneInverses[i]).multiply(m.bindMatrix).elements, b = bodyBind(i).multiply(r).elements;
      for (let k = 0; k < 16; k++) if (Math.abs(a[k] - b[k]) > 1e-4) return;
    }
    m.bind(own, body.bindMatrix.clone().multiply(r));
    sk.dispose();
    // (its bounds as now bound: the same place, worked out again)
    m.computeBoundingBox();
    m.computeBoundingSphere();
  });
}

export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** the infected's shared paints, a kind and a piece each, while they are unhurt (see Avatar.own), and the wounds they show: none */
export const CLEAN = new Map<string, THREE.Material>();

export class Avatar {
  root = restWhileHidden(new THREE.Group());
  /** first-person body (only built for the local player) */
  fpRoot = new THREE.Group();
  mixer!: THREE.AnimationMixer;
  actions = {} as Record<Clip, THREE.AnimationAction>;
  dur = {} as Record<Clip, number>;
  /**
   * The clips play on a skeleton nobody sees, and the visible one copies it every frame
   * before anything is posed on top. (The mixer does not rewrite a bone whose animated
   * value has not changed, so posing the animated skeleton itself would pile up.)
   */
  drive: [THREE.Object3D, THREE.Object3D][] = [];
  /** the same pairs, with how much of a clip laid over the body each takes (see LAID) and whether it is below the waist (2: the hips themselves) */
  laid: [THREE.Object3D, THREE.Object3D, number, 0 | 1 | 2][] = [];
  /** the two skeletons' own roots: a bone's turn is compared between them from there */
  driverRoot!: THREE.Object3D;
  modelRoot!: THREE.Object3D;
  /** a blow with something in the fist: seconds into it (-1 none), and how long it takes */
  strikeT = -1;
  strikeDur = 0.6;
  fpBones: [THREE.Object3D, THREE.Object3D, boolean][] = [];
  yaw = 0;
  /** false until the first update: a body that appears is already facing its way, not turning to it */
  placed = false;
  spine: THREE.Bone[] = [];
  chest?: THREE.Bone;
  neck: THREE.Bone[] = [];
  collarL?: THREE.Bone;
  armR?: ArmRig;
  armL?: ArmRig;
  // how far into each state the body is, 0..1
  crouchT = 0;
  airT = 0;
  moveT = 0;
  speed = 0;
  /** seconds into the death clip (0 = on its feet) */
  downT = 0;
  /** seconds into the flinch from a hit (-1 = none) */
  hitT = -1;
  hitClip: 'hit' | 'hitHead' = 'hit';
  /** which way it goes down (index into DEATHS) */
  deathClip: (typeof DEATHS)[number] = 'death';
  /** seconds since the feet left the ground in a jump (-1 = not jumping: a drop has no take-off) */
  jumpT = -1;
  /** (`stop`: when it is to be over, if it was broken off: the hands are given a moment to come away) */
  gesture: { kind: Gesture; t: number; dur: number; stop?: number } | null = null;
  move: { kind: Move; t: number; dur: number; stop?: number } | null = null;
  hold: Hold | null = null;
  // how far into the dance, and how far up the hands are, 0..1
  danceT = 0;
  /** one of the emote pack's movements, danced in place of the body's own dance (see `setClip`): how far into it */
  emo: { id: string; act: THREE.AnimationAction | null; t: number; once: boolean } | null = null;
  emoActs = new Map<string, THREE.AnimationAction>();
  emoLoading = false;
  /** one of them played once has come to its end: whoever set it takes the dance off */
  emoteOver = false;
  /** lying down (Z): asked for, how far gone, and the clock of the crawl; and the two thighs */
  /** how high the ground is at a place: what a body lying down lies to (the game says: see game.ts) */
  static ground: ((x: number, z: number) => number) | null = null;
  prone = false;
  proneT = 0;
  crawl = 0;
  /** seconds into going down (`proneDown`): forward while lying is asked for, back while getting up; and how much of a crawl */
  lieT = 0;
  crawlK = 0;
  crawlAt = 0;
  thighs: THREE.Bone[] = [];
  /** how far sat down on the ground, 0..1; and the knees, with how each lies when the leg is straight */
  groundT = 0;
  knees: [THREE.Bone, THREE.Quaternion][] = [];
  /** in a seat, and how far into sitting the body has got */
  seated = false;
  seatT = 0;
  /** how the seat sat in is sat in: as the library drew it on a bench at knee height (the jeep), or a low car's way (see CAR_SIT) */
  seatHow: SeatPose | null = null;
  handsT = 0;
  gearRest = new Map<string, { bone: THREE.Object3D; inv: THREE.Matrix4 }>();
  gearObjs: THREE.Object3D[] = [];
  /** a pack is worn: a slung weapon rides outside it */
  packOut = 0;
  /** seconds since the feet came back down after being in the air (-1 = long ago) */
  landT = -1;
  wasAir = false;
  /** seconds off the ground */
  airFor = 0;
  /** fastest it has fallen since leaving the ground (negative), and how hard the last landing was, 0..1 */
  fallV = 0;
  landK = 1;
  clock = Math.random() * 10;
  /** where in the stride the legs are, 0..1: shared by every stepping clip so they blend in step */
  phase = Math.random();
  /** a foot came down during the last update (see POSE.plant): the step that is heard */
  footfall = false;
  /** crawling, an arm pulled the body along during the last update: the drag that is heard (two to a loop of `crawl`) */
  pull = false;
  /** seconds since the last one */
  sinceStep = 1;
  /** half strides gone by, counted from where a foot comes down: a whole number is passed as each one lands */
  halves = 0;
  /** where a foot came down, and which way the legs were stepping, at the last update */
  plantWas = 0;
  dirWas = 0;
  /** legs turned away from the chest, radians */
  twist = 0;
  /** face down in a free fall (the battle royale's, src/game/br/mode.ts fly): the pitch, about the body's own side, laid
   * over its turn after that is set afresh each update (set on the root from outside, it was put back upright every frame) */
  dive = 0;
  /** leaning out to one side, -1 (left) .. 1 (right): the body from the waist up goes over, the feet stay */
  leanT = 0;
  /** the joints a shot is judged by (see frame) */
  joints: { head?: THREE.Bone; neck?: THREE.Bone; pelvis?: THREE.Bone } = {};
  /** the feet of a body that is to be kept standing on them (the infected): its ankles as it was made, and how far it is let down just now */
  soles: { foot: THREE.Bone; ball: THREE.Bone; /** how high its ankle is over its sole, as it was made */ high: number; /** how the foot lies, as it was made (in the body's own space) */ made: THREE.Quaternion; /** how its toes lie on the foot, as it was made */ toe: THREE.Quaternion }[] = [];
  sunk = 0;
  backing = false;
  layerMask = 1;
  /** the mask it is drawn in when it is seen: layerMask is 0 while it is veiled */
  seenMask = 1;
  /** weapon in the hands: pivot (at the shoulders, pitches with the aim) > the model */
  heldPivot = new THREE.Group();
  held: { obj: THREE.Object3D; grips: Grips; long: boolean; base: THREE.Quaternion; butt: THREE.Vector3 | null; sight: [number, number] } | null = null;
  /** what is worn on the head that a stock brought to the cheek goes round (see `faceGear`), and the gear it was found for */
  face: { under: number | null; cheek: number } = { under: null, cheek: 0 };
  faceOf: THREE.Object3D[] | null = null;
  collarR?: THREE.Bone;
  /**
   * How much the hands are on the gun they hold, 0..1. They come off it to use something, to wave, to sit, and
   * when it is changed for another, and go back onto it, over a fifth of a second, the gun going down toward
   * the belt and coming up from it. (They left it and found it in a single frame: half a metre in one step.)
   */
  holdT = 0;
  /** what is to be in the hands once what is in them now has been lowered */
  nextHeld: { obj: THREE.Object3D | null; grips: Grips | null; kind: 'rifle' | 'pistol' | 'auto' | 'melee' } | null = null;
  /** a one-handed weapon in the right fist */
  inHand: { obj: THREE.Object3D; curl: Curl; shoulder: boolean; raise: boolean } | null = null;
  /** how far what is in the fist has been laid back on the shoulder (see `shoulder` in HandGrip), 0..1 */
  shoulderT = 0;
  /** how far a torch is held up (0 at the side, 1 up: RAISE) */
  raiseT = 0;
  /** seconds into a swing of the right arm (-1 = not swinging) */
  swingT = -1;
  // bare hands: seconds into a punch (-1 = none) and whose it is, how long the fists stay up, how far up they are
  punchT = -1;
  punchSide = -1;
  fistsHold = 0;
  fistsT = 0;
  /** where one of the infected is in its run, seconds */
  sickRun = 0;
  /** on guard: the fists are up (and what is in the right one with them) for as long as this is set */
  guarding = false;
  /** on a broken leg (see src/sim/injury.ts): it is seen in how they go */
  limping = false;
  /** the steps on motion capture (src/game/avatar/gait.ts), and the legs they are stretched on; none for the infected, who keep their own */
  gait?: Gait;
  legs: Leg[] = [];
  /** the rest of a survivor's motion capture (src/game/avatar/deeds.ts); a performance done once (seconds into it), and one kept up */
  deeds?: Deeds;
  deed: { name: Deed; t: number; dur: number; legs: number; k: number; from: number; to: number } | null = null;
  stay: { name: Stay; t: number; rate: number } | null = null;
  stayT = 0;
  stayWas: Stay | null = null;
  limpT = 0;
  // how far the weapon is up at the eye, and how far it is in its running carry, 0..1
  aimT = 0;
  carryT = 0;
  slung = new THREE.Group();
  uniforms?: LookUniforms;
  /** the body mesh, and the bones a wound can be pinned to (index into its skeleton, and the bone it runs to) */
  skin?: THREE.SkinnedMesh;
  /** where the middle of the head as drawn is, on the Head bone (its own frame); null: a hand's breadth up it (see `frame`) */
  headMid: THREE.Vector3 | null = null;
  /** the same, for each body's file: worked out once */
  static headMids = new Map<string, THREE.Vector3 | null>();
  woundBones: [number, THREE.Object3D | undefined][] = [];
  /** the pieces of the suit that are there only when what they are is worn */
  pieces = new Map<string, THREE.Object3D>();
  woundN = 0;
  hair: (THREE.Object3D | undefined)[] = [];
  beard?: THREE.Object3D;
  hairMats: THREE.MeshStandardMaterial[] = [];

  /**
   * @param layer render layer of the full body (0 = an ordinary object everyone sees)
   * @param firstPersonBody also build the headless, armless copy for the local first-person view
   * @param look clothes, skin and hair (see setLook)
   * @param file which body (see BodyFile)
   */
  /** bodies are made one at a time, a person's before one of the infected's: see `make` */
  static line = new Line();
  /**
   * A body has been made: what gets it ready to be drawn before it is handed to whoever asked for it (the game
   * sets this: Renderer.ready, and its pictures sent). `kind` is what bodies are alike by: the first of a kind is
   * waited for, and the rest are drawn with what was made for it.
   */
  static onMade: (parts: THREE.Object3D[], kind: string) => Promise<void> = async () => {};
  /**
   * Something has been put on a body (worn, slung, taken up): it is drawn from this frame, and got ready for the
   * other lighting behind it, so that the lamps wait for it when they come on or go off (the game sets this:
   * Renderer.ready). Nothing put on a body was: at the first lamp of a night your own arms, body, knife, lamp and
   * sight had their shaders made in the one frame, 0.8 to 1.8 s each, six seconds in all (2026-10-18).
   */
  static onDressed: (parts: THREE.Object3D[]) => void = () => {};

  /** the dog tag at the breastbone: steel, gold on a VIP, or none (see WornTag) */
  tag: WornTag | null = null;
  /** which survivor this is, and what they wear over their skin (src/game/survivors.ts) */
  readonly wardrobe = new Wardrobe();
  /** how much taller than the skeleton as made this survivor stands (see Avatar.proportion) */
  stature = 1;

  /** the atmosphere an infected's shared paints were made with, for its own when it is first hit */
  paintAtmo: Atmosphere | null = null;
  owned = false;

  /** where the game is being looked at from: bodies spend less on what cannot be seen from there (set each frame by the game) */
  static readonly eye = new THREE.Vector3();

  /**
   * One of the infected: how it carries itself. `roused` is how far it is after somebody
   * (0 slack and shambling, 1 arms out and coming); `claw` is the blow it is throwing (seconds
   * into it, -1 none); `seed` keeps one from swaying in time with the next.
   */
  sick: { roused: number; claw: number; seed: number } | null = null;

  /**
   * Where the middle of the head as a body draws it is, on its Head bone: the middle of every point of its mesh that
   * hangs mostly on the head, as it was bound. For the infected, whose heads are their own shapes on fitted skeletons:
   * the hand's breadth up the bone that fits the player's own head put the ball that is shot at 4 to 8 cm off theirs,
   * and a shot at the far side of a head went past it (the owner, 2026-10-14: "sometimes i shoot the zombie in the
   * head but it doesnt register"; "the zombies head collisiosn does not actualyl fit perfectly on their head"). The
   * player's body has its head as a piece of its own, and keeps the hand's breadth.
   */
  static headMidOf(file: string, skin: THREE.SkinnedMesh | undefined): THREE.Vector3 | null {
    if (Avatar.headMids.has(file)) return Avatar.headMids.get(file)!;
    let mid: THREE.Vector3 | null = null;
    const bones = skin?.skeleton.bones ?? [], hi = bones.findIndex((b) => b.name === 'Head');
    if (skin && hi >= 0 && file !== 'survivor') {
      const geo = skin.geometry, pos = geo.getAttribute('position'), si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
      const inv = skin.skeleton.boneInverses[hi], v = new THREE.Vector3(), sum = new THREE.Vector3();
      let n = 0;
      for (let i = 0; i < pos.count; i++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === hi) w += sw.getComponent(i, k);
        if (w < 0.5) continue;
        sum.add(v.fromBufferAttribute(pos, i).applyMatrix4(skin.bindMatrix).applyMatrix4(inv));
        n++;
      }
      // (a body with too little on its head to tell by keeps the hand's breadth)
      if (n >= 200) mid = sum.divideScalar(n);
    }
    Avatar.headMids.set(file, mid);
    return mid;
  }

  get plantAt() {
    // (on motion capture every loop starts on the left heel)
    if (this.gait) return 0;
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
}

// The methods that live in avatar/ (see each file there): TypeScript is told of them here, and they are put back on
// the class as it had them, not enumerable. (Cut out on 2026-10-14 so that avatar.ts can be read in pieces.)
type Methods<T> = { [K in keyof T]: T[K] extends (this: Avatar, ...a: infer A) => infer R ? (...a: A) => R : never };
export interface Avatar {
  load: Methods<typeof makeMethods>['load'];
  make: Methods<typeof makeMethods>['make'];
  veil: Methods<typeof makeMethods>['veil'];
  setLook: Methods<typeof makeMethods>['setLook'];
  makeArm: Methods<typeof makeMethods>['makeArm'];
  proportion: Methods<typeof dressMethods>['proportion'];
  setSlung: Methods<typeof dressMethods>['setSlung'];
  setGear: Methods<typeof dressMethods>['setGear'];
  wearTag: Methods<typeof dressMethods>['wearTag'];
  muzzle: Methods<typeof dressMethods>['muzzle'];
  setHeld: Methods<typeof handsMethods>['setHeld'];
  takeUp: Methods<typeof handsMethods>['takeUp'];
  faceGear: Methods<typeof dressMethods>['faceGear'];
  setWorldQuat: Methods<typeof handsMethods>['setWorldQuat'];
  turn: Methods<typeof handsMethods>['turn'];
  aim: Methods<typeof handsMethods>['aim'];
  solveArm: Methods<typeof handsMethods>['solveArm'];
  reach: Methods<typeof handsMethods>['reach'];
  thumb: Methods<typeof handsMethods>['thumb'];
  curl: Methods<typeof handsMethods>['curl'];
  wound: Methods<typeof woundsMethods>['wound'];
  own: Methods<typeof woundsMethods>['own'];
  clearWounds: Methods<typeof woundsMethods>['clearWounds'];
  swing: Methods<typeof actsMethods>['swing'];
  hit: Methods<typeof actsMethods>['hit'];
  claw: Methods<typeof actsMethods>['claw'];
  lean: Methods<typeof sickMethods>['lean'];
  plant: Methods<typeof sickMethods>['plant'];
  sicken: Methods<typeof sickMethods>['sicken'];
  setDeath: Methods<typeof actsMethods>['setDeath'];
  layDown: Methods<typeof actsMethods>['layDown'];
  act: Methods<typeof actsMethods>['act'];
  emote: Methods<typeof actsMethods>['emote'];
  setClip: Methods<typeof actsMethods>['setClip'];
  loadEmote: Methods<typeof actsMethods>['loadEmote'];
  setHold: Methods<typeof actsMethods>['setHold'];
  frame: Methods<typeof actsMethods>['frame'];
  setProne: Methods<typeof actsMethods>['setProne'];
  setSeat: Methods<typeof actsMethods>['setSeat'];
  setLean: Methods<typeof actsMethods>['setLean'];
  layer: Methods<typeof actsMethods>['layer'];
  perform: Methods<typeof actsMethods>['perform'];
  pickUp: Methods<typeof actsMethods>['pickUp'];
  setStay: Methods<typeof actsMethods>['setStay'];
  debugPose: Methods<typeof actsMethods>['debugPose'];
  clipLength: Methods<typeof actsMethods>['clipLength'];
  update: Methods<typeof updateMethods>['update'];
  gestures: Methods<typeof gesturesMethods>['gestures'];
  setGhost: Methods<typeof makeMethods>['setGhost'];
  dispose: Methods<typeof makeMethods>['dispose'];
}
for (const part of [makeMethods, dressMethods, handsMethods, woundsMethods, actsMethods, sickMethods, updateMethods, gesturesMethods]) {
  for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(part))) Object.defineProperty(Avatar.prototype, name, { ...d, enumerable: false });
}
