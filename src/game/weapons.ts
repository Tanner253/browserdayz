// Gunplay: viewmodel (own scene/camera), procedural animation (equip, bob, sway,
// recoil springs, bolt cycling, reloads), ballistics with gravity + drag simulated
// in sub-steps against the physics world, zeroing, scope + iron sights, melee.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { physics, SHOT_GROUPS, type Surface } from '../core/physics';
import { audio } from '../core/audio';
import type { Input } from '../core/input';
import { extractParts } from '../core/gltf-utils';
import { ITEMS, capacityOf, handlingOf, hasMod, pieceShown, type ItemInstance, type Slot } from '../sim/items';
import { suppressorGeometry } from './procedural';
import { SLOT_ORDER, type PlayerInventory } from '../sim/inventory';
import type { Atmosphere } from '../world/atmosphere';
import type { Player } from './player';
import type { Effects } from './effects';
import { MuzzleFlash, muzzleArt } from './muzzle';
import { WeaponRig, liftPack } from './rig';
import { FPArms, type Grips, type HandGrip } from './arms';
import type { Look } from './look';
import { MAX_STAMINA } from '../net/protocol';
import type { ItemModels } from './loot';

export type HitZone = 'head' | 'torso' | 'legs';
/** damage multiplier per hit zone: bullets / melee */
const ZONE_MULT: Record<HitZone, [number, number]> = { head: [3.2, 1.6], torso: [1, 1], legs: [0.6, 0.7] };
export type UseKind = 'eat' | 'drink' | 'bandage' | 'inject' | 'smoke' | 'open';
const FIST = { damage: 14, range: 1.35, rate: 0.4, stamina: 5 };

export type FireMode = 'semi' | 'auto';
type GunKind = 'rifle' | 'pistol' | 'auto';

export interface Damageable {
  /** returns true if this hit killed the target */
  damage(amount: number, point: THREE.Vector3, dir: THREE.Vector3, zone: HitZone): boolean;
  readonly name: string;
}

/** a shot leaving the muzzle, for the network: other players hear it and see it land */
export interface ShotInfo {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  weapon: string;
  suppressed: boolean;
}

export interface HitInfo {
  /** the thing that was hit, so the game can report it to the server */
  victim: Damageable;
  weapon: string;
  target: string;
  zone: HitZone;
  damage: number;
  killed: boolean;
  distance: number;
  melee: boolean;
}

interface Ballistics {
  muzzleVel: number;
  drag: number; // quadratic drag coefficient (1/m)
  damage: number;
  zero: number; // metres
}

const BALLISTICS: Record<GunKind, Ballistics> = {
  rifle: { muzzleVel: 820, drag: 0.00072, damage: 95, zero: 100 },
  pistol: { muzzleVel: 350, drag: 0.0021, damage: 34, zero: 25 },
  auto: { muzzleVel: 715, drag: 0.0011, damage: 48, zero: 100 },
};

/** per-weapon handling: cyclic rate, recoil (camera kick in rad), hip spread */
const HANDLING: Record<GunKind, { interval: number; kickV: number; kickH: number; climb: number; spread: number; vmKick: number }> = {
  rifle: { interval: 0.2, kickV: 0.85, kickH: 0.35, climb: 0.012, spread: 0.022, vmKick: 3.2 },
  pistol: { interval: 0.13, kickV: 0.42, kickH: 0.2, climb: 0.006, spread: 0.03, vmKick: 1.6 },
  auto: { interval: 0.1, kickV: 0.3, kickH: 0.22, climb: 0.0062, spread: 0.035, vmKick: 1.35 },
};

interface Bullet {
  /** someone else's bullet has already been heard going past */
  heard?: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  drag: number;
  damage: number;
  life: number;
  travelled: number;
  weapon: string;
  /** someone else's bullet: flies and lands for show, the shooter's own game decides what it hit */
  ghost?: boolean;
}

const _toCam = new THREE.Vector3();

/** critically-damped-ish spring for procedural motion */
class Spring {
  v = new THREE.Vector3();
  x = new THREE.Vector3();
  constructor(public k = 160, public d = 16) {}
  step(dt: number, target = new THREE.Vector3()) {
    const a = target.clone().sub(this.x).multiplyScalar(this.k).addScaledVector(this.v, -this.d);
    this.v.addScaledVector(a, dt);
    this.x.addScaledVector(this.v, dt);
    return this.x;
  }
}

interface VmModel {
  root: THREE.Group;
  kind: GunKind | 'melee';
  hip: THREE.Vector3;
  /** hip-fire cant/convergence so the gun points in toward the crosshair */
  hipRot?: THREE.Euler;
  ads: THREE.Vector3;
  /** the object holding the weapon in its original model space (grip points live here) */
  body?: THREE.Object3D;
  /** something held to strike with: how it stands in the picture and how it is swung */
  melee?: MeleeStyle;
  grips?: Grips;
  muzzle: THREE.Vector3; // in root space
  bolt?: THREE.Group;
  boltSlide?: THREE.Group;
  slide?: THREE.Object3D;
  charging?: THREE.Object3D;
  selector?: THREE.Object3D;
  mag?: THREE.Object3D;
  round?: THREE.Object3D;
  flash: MuzzleFlash;
  /** attachment meshes, shown when the item has the mod */
  scope?: THREE.Object3D;
  wrap?: THREE.Object3D;
  suppressor?: THREE.Object3D;
  /** aim position without an optic */
  adsIron?: THREE.Vector3;
  /**
   * A weapon pack (see rig.ts): its own arms and its own gun, moved by its own animation.
   * Nothing here is reached out to with the game's arms, and none of the gun's pieces is
   * moved by hand below: a movement of the pack is asked for by name.
   */
  rig?: WeaponRig;
  /** the gun alone, as everybody else sees it held and as it hangs on a back (packs only: the others show `body`) */
  world?: THREE.Object3D;
  /** a gun riding in another pack's hands: the pack's own spent case is not its case, and the game throws one */
  brass?: boolean;
  /** seconds since it last fired, and which of the pack's movements that shot is */
  shotT?: number;
  shotClip?: string;
}

type Action = { name: 'equip' | 'unequip' | 'bolt' | 'reload' | 'swing' | 'magswap' | 'use' | 'punch'; t: number; dur: number; done?: () => void; data?: Record<string, number> };

/**
 * Where each pack is held from: the eye, in the pack's space as the pipeline turns it
 * (x right, y up, metres; the muzzle points away down -z). Tuned by eye, like every other
 * hip position here.
 */
const HELD = {
  sniper: new THREE.Vector3(0.14, -0.22, -0.36),
  m9: new THREE.Vector3(0.095, -0.135, -0.31),
};

/** A smoke: where it hangs between draws and where it is at the lips (the eye's space), how long before it is first lifted, and how long each draw takes. */
const SMOKE = {
  low: new THREE.Vector3(0.115, -0.105, -0.33),
  lips: new THREE.Vector3(0.012, -0.08, -0.215),
  lift: 0.35,
  every: (dur: number) => Math.max(1.3, (dur - 0.7) / 2),
};

/**
 * Something held to be eaten, drunk or opened, in the eye's space: where it is held ([x, y, z],
 * and how much further off for each metre of its width or height), where it is when it is at
 * the mouth, and how far it is tipped there. (Set by looking, at the angle the hands are seen
 * at now: what was here before was set for a wider one, and held everything under the bottom
 * of the picture. A tin being eaten from was the lid of a tin; no hand was to be seen.)
 */
export const HOLD = {
  rest: [0.09, -0.1, -0.46],
  restBy: [-0.25, -0.12, -0.45],
  mouth: [0.025, -0.075, -0.28],
  mouthBy: [-0.1, -0.3],
  tilt: { eat: 0.45, drink: 1.0 },
  /** something worked on with both hands (a box of rounds, a grenade's cord) */
  work: [0, -0.11, -0.46],
  workBy: [-0.2, -0.4],
  /** a first aid kit, open in the left hand: where, and how it is turned */
  kit: [-0.06, -0.14, -0.52],
  kitBy: [-0.15, -0.5],
  kitTurn: [0.2, 0.5, 0.05],
};

/**
 * An injection, in the eye's space. The left forearm stands up out of the bottom corner of the
 * picture, its fist made; the right fist brings the injector to it from the right, lying nearly
 * level so that it is seen from the side, and drives it in.
 *   elbow, wrist – where the left forearm lies
 *   palm         – which way the inside of that wrist is turned
 *   at, skin     – how far up the forearm from the wrist the shot goes in (0..1), and how far off the bone the sleeve is there
 *   down         – which way the injector's nose points
 *   hit          – when it lands, seconds (the sound, in game.ts, goes by the same clock)
 *   sunk         – how far it sinks into the sleeve
 *   held         – how far up the barrel from its middle the right fist is
 *   fingers      – which way that fist's fingers start out, before they close round the barrel
 *   fist         – [how far the wrist is behind the barrel along the fingers, how far the barrel's middle is off the palm]
 *   curl         – how far each finger closes
 * (Kept where the dev harness can reach it: every one of these was set by looking.)
 */
export const INJECT = {
  elbow: new THREE.Vector3(-0.22, -0.285, -0.38),
  wrist: new THREE.Vector3(-0.07, -0.025, -0.52),
  palm: new THREE.Vector3(0.7, 0, 0.7),
  at: 0.24,
  skin: 0.036,
  down: new THREE.Vector3(-0.86, -0.2, -0.47).normalize(),
  hit: 1.02,
  sunk: 0.005,
  held: 0.02,
  fingers: new THREE.Vector3(-0.1, 0.9, -0.4),
  fist: [0.07, 0.025] as [number, number],
  curl: [1.25, 1.3, 1.35, 1.4] as [number, number, number, number],
};

/** One cigarette: paper, filter, and the coal at the end of it. It lies along z, filter to the mouth (+z). */
function cigarette() {
  const root = new THREE.Group();
  const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.058, 12), new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.9 }));
  const filter = new THREE.Mesh(new THREE.CylinderGeometry(0.0041, 0.0041, 0.024, 12), new THREE.MeshStandardMaterial({ color: 0xb98344, roughness: 0.85 }));
  const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.0039, 0.0036, 0.006, 12), new THREE.MeshStandardMaterial({ color: 0x6f6b66, roughness: 1 }));
  const coal = new THREE.Mesh(new THREE.SphereGeometry(0.0036, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 0.5, 0.1), toneMapped: false }));
  for (const m of [paper, filter, ash]) m.rotation.x = Math.PI / 2;
  paper.position.z = -0.012;
  filter.position.z = 0.029;
  ash.position.z = -0.042;
  coal.position.z = -0.045;
  root.add(paper, filter, ash, coal);
  return { root, coal };
}

/** melee weapons whose model is drawn with its edge toward whoever holds it */
const EDGE_IN = new Set(['machete']);
/**
 * A tool in the fist: where the wrist is from the point of the handle that is held (to its
 * right, up it, toward the eye), how far the fingers close, and where the fist is held from
 * the eye.
 */
const MELEE = { wrist: [0.03, 0, 0.05] as [number, number, number], curl: [1.1, 1.15, 1.2, 1.2] as [number, number, number, number], hip: [0.2, -0.165, -0.42] as [number, number, number] };

/**
 * How something held to strike with stands in the picture: where the fist on it is (as the
 * eye has it: x to the right, y up, -z ahead, metres), which way its head points, and which
 * way its edge faces.
 */
type Stance = { p: [number, number, number]; tip: [number, number, number]; edge: [number, number, number] };
/**
 * A blow is swung with the arm, and the wrist is held firm: the forearm and what is in the
 * fist go round the elbow as one piece, and the elbow is carried by the shoulder. So a blow
 * is said as what the ARM does, a moment at a time: how far through the blow (it starts and
 * ends as the thing is held), how far the forearm is swung up (`pitch`) and across the body
 * (`yaw`, toward the left) from where it rests, in degrees, and where the shoulder has put
 * the elbow by then (`by`: right, up, back, metres from where it rests).
 */
type Stroke = { at: number; pitch: number; yaw: number; by: [number, number, number] }[];
/** how a kind of thing is held, how it is put up to stop a blow, the blows struck with it one after another, where the elbow rests, and whether it takes both hands */
interface MeleeStyle {
  idle: Stance;
  /**
   * Where it is carried when nothing is being done with it, if that is not where it is held
   * to strike from (a bat lies back on the shoulder). It is brought from there to `idle` as a
   * blow begins, and laid back there after: the blows themselves are all said from `idle`.
   */
  rest?: Stance;
  guard: Stance;
  strokes: Stroke[];
  elbow: [number, number, number];
  two: boolean;
  /** how far up from its butt the (right) hand closes round it, metres: the middle of the part that is made to be held */
  grip: number;
}
/**
 * A blow lands 0.35 of the way through it (see actionTick): by then the arm is thrown out in
 * front and the head is coming down through the middle of the picture. Before it, the
 * forearm is drawn up and back over the shoulder (or across the body, for the one that comes
 * back the other way); after it, it is carried on down and out of the picture, and brought home.
 */
const CUT: Stroke = [
  { at: 0.2, pitch: 55, yaw: -15, by: [0.02, 0.13, 0.06] },
  { at: 0.36, pitch: -24, yaw: 22, by: [-0.13, 0.11, -0.2] },
  { at: 0.55, pitch: -40, yaw: 34, by: [-0.15, 0.07, -0.17] },
];
const BACK: Stroke = [
  // (across the body, not back past the ear: what is in the fist would fill the picture)
  { at: 0.21, pitch: 10, yaw: 50, by: [-0.05, 0.02, -0.12] },
  { at: 0.36, pitch: 4, yaw: 0, by: [-0.06, 0.08, -0.22] },
  { at: 0.55, pitch: 12, yaw: -40, by: [0.02, 0.08, -0.14] },
];
// (The hands are drawn through a lens of 48 degrees: at arm's length the picture is 40 cm
// high. A fist more than 14 cm below the eye's own line is under the bottom of it.)
const MELEE_STYLE: Record<string, MeleeStyle> = {
  hatchet: {
    idle: { p: [0.16, -0.125, -0.42], tip: [-0.3, 0.84, -0.45], edge: [-0.25, -0.45, -0.86] },
    guard: { p: [0.1, -0.04, -0.4], tip: [-0.88, 0.46, -0.12], edge: [0.1, -0.1, -1] },
    strokes: [CUT, BACK],
    elbow: [0.33, -0.34, -0.2],
    two: false,
    // (its rubber grip is the lower twelve centimetres, under the collar)
    grip: 0.062,
  },
  machete: {
    idle: { p: [0.16, -0.135, -0.42], tip: [-0.34, 0.8, -0.5], edge: [-0.25, -0.5, -0.83] },
    guard: { p: [0.13, -0.05, -0.4], tip: [-0.93, 0.36, -0.1], edge: [0.1, -0.1, -1] },
    strokes: [CUT, BACK],
    elbow: [0.33, -0.35, -0.2],
    two: false,
    // (a long handle, twenty-eight centimetres of it: held at its middle)
    grip: 0.13,
  },
  crowbar: {
    idle: { p: [0.13, -0.15, -0.4], tip: [-0.4, 0.85, -0.34], edge: [-0.3, -0.45, -0.84] },
    guard: { p: [0.2, -0.07, -0.4], tip: [-0.97, 0.2, -0.1], edge: [0.05, -0.1, -1] },
    strokes: [CUT, BACK],
    elbow: [0.34, -0.36, -0.18],
    two: true,
    grip: 0.175,
  },
  bat: {
    idle: { p: [0.13, -0.15, -0.4], tip: [-0.42, 0.84, -0.34], edge: [-0.3, -0.45, -0.84] },
    // (carried, it lies back over the right shoulder: up the right of the picture and out of the top of it)
    rest: { p: [0.12, -0.13, -0.42], tip: [0.2, 0.86, 0.42], edge: [-0.3, -0.45, -0.84] },
    guard: { p: [0.21, -0.07, -0.4], tip: [-0.97, 0.2, -0.1], edge: [0.05, -0.1, -1] },
    strokes: [CUT, BACK],
    elbow: [0.34, -0.36, -0.18],
    two: true,
    // (the left hand above the knob, the right a hand's width up the tape)
    grip: 0.175,
  },
  knife: {
    idle: { p: [0.15, -0.12, -0.42], tip: [-0.2, 0.62, -0.76], edge: [-0.1, -0.75, -0.65] },
    guard: { p: [0.1, -0.05, -0.38], tip: [-0.8, 0.55, -0.2], edge: [0, -0.3, -0.95] },
    strokes: [
      // a cut across, and a stab straight out from the shoulder
      [
        { at: 0.2, pitch: 35, yaw: -12, by: [0.02, 0.08, 0.04] },
        { at: 0.36, pitch: -15, yaw: 22, by: [-0.1, 0.08, -0.18] },
        { at: 0.55, pitch: -35, yaw: 45, by: [-0.14, 0.02, -0.14] },
      ],
      [
        { at: 0.2, pitch: -10, yaw: 0, by: [0.02, 0, 0.14] },
        { at: 0.36, pitch: -30, yaw: 12, by: [-0.12, 0.08, -0.3] },
        { at: 0.52, pitch: -30, yaw: 12, by: [-0.12, 0.08, -0.27] },
      ],
    ],
    elbow: [0.32, -0.33, -0.2],
    two: false,
    grip: 0.062,
  },
};
const _sx = new THREE.Vector3(), _sy = new THREE.Vector3(), _sz = new THREE.Vector3(), _sm = new THREE.Matrix4();
const _mp = new THREE.Vector3(), _mv = new THREE.Vector3(), _mel = new THREE.Vector3(), _mel2 = new THREE.Vector3(), _mq = new THREE.Quaternion(), _mq2 = new THREE.Quaternion(), _mq3 = new THREE.Quaternion(), _me = new THREE.Euler();
/** a stance as a place and a turn: the thing's own up is toward its head, and its edge is on its far side (-z) */
function stanceQuat(s: Stance, out: THREE.Quaternion) {
  _sy.set(...s.tip).normalize();
  _sz.set(...s.edge);
  _sz.addScaledVector(_sy, -_sz.dot(_sy)).normalize().negate();
  _sx.crossVectors(_sy, _sz);
  return out.setFromRotationMatrix(_sm.makeBasis(_sx, _sy, _sz));
}

/** What seats the body's hands on a pack's gun (see `grips` in packGun), in the gun's own space: x toward the muzzle, y up. */
const SEAT = {
  pistol: new THREE.Vector3(0.034, 0.03, 0),
  rifle: new THREE.Vector3(0.05, 0.004, 0),
  /**
   * The hand under a rifle. The pack's own left hand holds it hard up against the magazine
   * (seen from its own eyes, that is where a hand is in the picture); on a body seen from
   * outside that is two fists together under the action. It goes a hand's breadth up the
   * fore-end, where a rifle is held.
   */
  fore: new THREE.Vector3(0.074, -0.006, 0.004),
};
/**
 * How big a rifle is drawn in somebody else's hands, of its own size, kept where it is at the
 * butt. The pack's rifle is long in the stock for the body that holds it (44 cm from butt to
 * trigger, against arms 48 cm from shoulder to wrist): at its full size the hand under it
 * could not reach the fore-end, and came back along the stock to the magazine. A tenth
 * smaller, with the body turned a little more side on (POSE.hold.blade), it reaches.
 */
const HELD_RIFLE = 0.9;

/** how long the flame at the muzzle is, metres */
const FLAME: Record<GunKind, number> = { pistol: 0.2, rifle: 0.42, auto: 0.3 };

/** A pack gun standing in the hands: how much of the pack's own idle sway is used, and seconds to a breath. */
const IDLE = { part: 0.22, every: 4.4 };

/** Clone a glTF material for the viewmodel scene (no CSM, no shared shader hooks). */
function plainMaterial(m: THREE.Material): THREE.Material {
  const c = m.clone() as THREE.MeshStandardMaterial;
  if (c.defines) {
    delete c.defines.USE_CSM;
    delete c.defines.CSM_CASCADES;
    delete c.defines.CSM_FADE;
  }
  c.onBeforeCompile = () => {};
  c.customProgramCacheKey = () => 'vm';
  c.envMapIntensity = 1;
  return c;
}

/** a weapon pack's material for the hands' own scene: plain, and lifted out of the dark (see liftPack) */
const packMaterial = (m: THREE.Material) => liftPack(plainMaterial(m));

export class Weapons {
  private vmRoot = new THREE.Group();
  private models = new Map<string, VmModel>();
  private current: VmModel | null = null;
  private currentItem: ItemInstance | null = null;
  private action: Action | null = null;
  private bullets: Bullet[] = [];
  private kick = new Spring(210, 19);
  private kickRot = new Spring(170, 15);
  private sway = new Spring(120, 14);
  private aimRecoil = new Spring(90, 13);
  private adsT = 0;
  private sprintT = 0;
  private airT = 0;
  private boltReady = true;
  /**
   * Guns that were shot dry and have not been fed since: a pistol's slide stays back, and its
   * next magazine ends with the slide being let go. Kept by the gun, not by whoever holds it:
   * kept as one flag it went from the pistol that ran dry to the next gun taken out, and a full
   * pistol was held with its slide open until something was reloaded to the end.
   */
  private dry = new WeakSet<ItemInstance>();
  private get chamberEmpty() {
    const it = this.currentItem;
    return !!it && (it.loaded ?? 0) === 0 && this.dry.has(it);
  }
  private set chamberEmpty(on: boolean) {
    const it = this.currentItem;
    if (!it) return;
    if (on) this.dry.add(it);
    else this.dry.delete(it);
  }
  private fireCooldown = 0;
  private breath = { held: false, t: 0 };
  /**
   * What is left in the arms, 0..1. Holding a gun up to the eye uses it (a heavy one faster,
   * and holding the breath faster still); with the gun down it comes back in a few seconds.
   * As it goes the sights wander more and the gun kicks harder.
   */
  armStamina = 1;
  /**
   * Where the gun is pointing, off the middle of the screen, radians (x to the left, y up).
   * A gun has weight: turn fast and it trails the eye, then swings on a little past it.
   * Shots go where the gun points, and the crosshair is drawn there.
   */
  lag = new THREE.Vector2();
  private time = 0;
  private sunLight: THREE.DirectionalLight;
  private sunVis = 1;
  private arms = new FPArms();
  private skyVis = 1;
  scoped = false;
  aiming = false;
  /**
   * Aimed, with nothing on the gun to aim by: the rifle without its scope has no sights of
   * its own, and the eye is laid along the top of it. The mark on the screen stays, to say
   * where that is.
   */
  get sightless() {
    return this.aiming && this.current?.kind === 'rifle' && !!this.current.adsIron && !hasMod(this.currentItem, 'pu_scope');
  }
  hitMarker = 0;
  /** the last hit marker was a kill (HUD draws it red) */
  killMarker = false;
  /** the last hit was to the head */
  headMarker = false;
  onHit: (info: HitInfo) => void = () => {};
  onShot: (info: ShotInfo) => void = () => {};
  /** the hands started on something others can see: working the bolt, reloading (seconds it takes) */
  onAct: (act: 'bolt' | 'reload', dur: number) => void = () => {};
  /** something hit a body (anyone's): where, which way it was travelling, and how hard (1 = a rifle round) */
  onFlesh: (owner: unknown, point: THREE.Vector3, dir: THREE.Vector3, power: number) => void = () => {};
  /** one of our own bullets landed on something that is not a body: what it belongs to, if anything */
  onStruck: (owner: unknown, weapon: string) => void = () => {};
  /** a punch or a melee swing has started */
  /** a punch has been thrown, or what is held swung (which takes this many seconds) */
  onSwing: (seconds?: number) => void = () => {};
  /** loot models, so consumables can be shown in the hands while they are used */
  itemModels: ItemModels | null = null;
  // bare hands: fists come up to punch (LMB) or guard (RMB) and drop again after a moment
  private fistAnchor = new THREE.Object3D();
  private guardT = 0;
  /** how far the fists on something carried at rest (see `rest` in MeleeStyle) have gone to where a blow is struck from, 0..1, and how far it is itself still laid back */
  private readyT = 0;
  private cockT = 1;
  private guardHold = 0;
  /** the guard button is down, with the fists or something to strike with in the hands */
  private guardHeld = false;
  /** which blow of the run this is, and when the last was struck (one soon after another comes back the other way) */
  private strokeN = 0;
  private strokeAt = -9;
  private punchHand = 0;
  // item being used in the hands (food, drink, bandage, ammo box)
  private held: { root: THREE.Group; kind: UseKind; t: number; dur: number; size: THREE.Vector3; ending: number; coal?: THREE.Mesh; puffs?: number; wispT?: number } | null = null;
  private heldCache = new Map<string, { root: THREE.Group; size: THREE.Vector3 }>();
  private smoke: ReturnType<typeof cigarette> | null = null;
  private lowerT = 0;
  /** the hands are busy with something that is not a weapon (a wave, a dance): it is let down out of the way */
  stowed = false;
  /** lets the game resolve a collider owner to a damageable entity */
  resolveTarget: (owner: unknown) => Damageable | null = () => null;
  onSlungChange: (obj: THREE.Object3D | null) => void = () => {};

  constructor(
    private vmScene: THREE.Scene,
    private vmCamera: THREE.PerspectiveCamera,
    private atmo: Atmosphere,
    private player: Player,
    private inv: PlayerInventory,
    private fx: Effects,
  ) {
    vmScene.add(vmCamera);
    vmCamera.add(this.vmRoot);
    this.vmRoot.add(this.fistAnchor);
    vmScene.environment = atmo.envMap;
    this.sunLight = new THREE.DirectionalLight(atmo.sunColor, atmo.sunIntensity);
    this.sunLight.position.copy(atmo.sunDir).multiplyScalar(10);
    vmScene.add(this.sunLight);
  }

  /** sleeves and hands of the first-person arms */
  setLook(look: Look) {
    this.arms.setLook(look);
  }

  async load() {
    await this.arms.load();
    this.vmRoot.add(this.arms.root);
    const art = await muzzleArt();
    const mkFlash = () => new MuzzleFlash(art);

    // ---- the guns that come as packs: arms, gun and every movement in one file
    this.models.set('mosin', await this.packGun({ pack: 'sniper', item: 'mosin', kind: 'rifle', hip: HELD.sniper, flashSize: 0.32, flash: mkFlash() }));
    this.models.set('m9', await this.packGun({ pack: 'm9', item: 'm9', kind: 'pistol', hip: HELD.m9, flashSize: 0.2, flash: mkFlash() }));
    // The Pistol 43 came with arms that are not its maker's to give. It is held in the other
    // pistol's hands and moved as that pistol is: its frame, slide and magazine ride on the
    // pack's, in place of the pack's own.
    this.models.set('p38', await this.packGun({ pack: 'm9', item: 'p38', gun: 'pistol_43', kind: 'pistol', hip: HELD.m9, flashSize: 0.2, flash: mkFlash() }));

    // ---- melee weapons: held upright in the right hand
    for (const id of ['hatchet', 'machete', 'crowbar', 'bat', 'knife']) {
      const def = ITEMS[id];
      const sc = await assets.model(def.model);
      const root = new THREE.Group();
      const body = new THREE.Group();
      const parts = extractParts(sc);
      const box = new THREE.Box3();
      for (const p of parts) {
        p.geometry.computeBoundingBox();
        box.union(p.geometry.boundingBox!);
      }
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      const longAxis = size.y >= size.x && size.y >= size.z ? 'y' : size.x >= size.z ? 'x' : 'z';
      for (const p of parts) {
        // bare steel with nothing around it to reflect draws as a black cut-out this close to
        // the eye: let a blade or an axe head take the light like worn metal does
        const mat = plainMaterial(p.material) as THREE.MeshStandardMaterial;
        mat.metalness = Math.min(mat.metalness, 0.45);
        mat.roughness = Math.max(mat.roughness, 0.5);
        const mesh = new THREE.Mesh(p.geometry, mat);
        mesh.position.set(-c.x, -box.min.y, -c.z);
        if (longAxis === 'x') {
          mesh.position.set(-box.min.x, -c.y, -c.z);
        }
        body.add(mesh);
      }
      // Which way the head faces. An axe's edge, a crowbar's claw: the side of the head that
      // stands furthest off the handle leads the swing, away from whoever holds it. Two of the
      // models are drawn the other way round and were held edge-first toward the face.
      if (longAxis === 'y') {
        const L = size.y;
        let hx = 0, hz = 0, n = 0, far = -1e9, near = 1e9;
        const each = (fn: (x: number, y: number, z: number) => void) => {
          for (const mesh of body.children as THREE.Mesh[]) {
            const P = mesh.geometry.getAttribute('position');
            for (let i = 0; i < P.count; i += 2) fn(P.getX(i) + mesh.position.x, P.getY(i) + mesh.position.y, P.getZ(i) + mesh.position.z);
          }
        };
        each((x, y, z) => {
          if (y < L * 0.3) {
            hx += x;
            hz += z;
            n++;
          }
        });
        hx /= Math.max(1, n);
        hz /= Math.max(1, n);
        each((_x, y, z) => {
          if (y > L * 0.72) {
            far = Math.max(far, z - hz);
            near = Math.min(near, z - hz);
          }
        });
        // toward +z is toward the eye: turn it about the handle so it faces out
        // (a machete's blade stands off its handle no more one way than the other, and this
        // one is drawn edge to the eye: it is turned because it is known to be)
        if ((far > -near * 1.3 && far > 0.03) || EDGE_IN.has(id)) {
          const turn = new THREE.Group();
          turn.position.set(hx, 0, hz);
          turn.rotation.y = Math.PI;
          for (const mesh of [...body.children]) {
            mesh.position.x -= hx;
            mesh.position.z -= hz;
            turn.add(mesh);
          }
          body.add(turn);
        }
      }
      if (longAxis === 'x') body.rotation.z = Math.PI / 2;
      if (longAxis === 'z') body.rotation.x = -Math.PI / 2;
      // Where along it the fist closes: a hand's width up from the butt of a long handle, the
      // middle of a short one. That point is what is held out in front: the fist is in the
      // picture whatever the length of the thing.
      const style = MELEE_STYLE[id];
      // Where along it the fist closes (the middle of the part of the handle that is made to
      // be held), and in both hands, where the left closes under the right.
      const held = style.grip;
      const under = style.two ? held - 0.105 : 0;
      body.position.y = -held;
      // (how it stands, and how it moves, is all in its style: see animateMelee)
      const holder = new THREE.Group();
      holder.add(body);
      root.add(holder);
      // The HANDLE in the middle of the fist, not the middle of the whole thing: an axe's head
      // and a crowbar's claw stand out to one side, and the middle of the lot is three and
      // four centimetres off the middle of the handle. Where the handle is, at the height the
      // hand closes round it, is found from its own points.
      root.updateMatrixWorld(true);
      const handleAt = (h: number) => {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        const v = new THREE.Vector3();
        root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const P = mesh.geometry.getAttribute('position');
          for (let i = 0; i < P.count; i++) {
            v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld);
            if (Math.abs(v.y - (h - held)) > 0.035) continue;
            x0 = Math.min(x0, v.x);
            x1 = Math.max(x1, v.x);
            z0 = Math.min(z0, v.z);
            z1 = Math.max(z1, v.z);
          }
        });
        return x0 <= x1 ? new THREE.Vector3((x0 + x1) / 2, h - held, (z0 + z1) / 2) : new THREE.Vector3(0, h - held, 0);
      };
      const mid = handleAt(held);
      holder.position.set(-mid.x, 0, -mid.z);
      root.updateMatrixWorld(true);
      // (the grips are said in the thing's own space: where the handle is there, at each hand)
      const inBody = (h: number) => body.worldToLocal(handleAt(h));
      const rightAt = inBody(held), leftAt = inBody(under);
      const flash = mkFlash();
      this.models.set(id, {
        root, kind: 'melee', flash, body, melee: style,
        grips: {
          // (the wrist stands off to the right of the handle and behind it: the palm is what is laid on it)
          // (a fist round the handle: the thumb comes over the fingers, not out along the handle)
          right: { pos: rightAt.add(new THREE.Vector3(MELEE.wrist[0], MELEE.wrist[1], MELEE.wrist[2])), fingers: new THREE.Vector3(-0.2, -0.3, -1), palm: new THREE.Vector3(-1, 0, 0), curl: MELEE.curl, thumb: 0.9, tuck: 0.9, shoulder: !!style.rest },
          left: style.two ? { pos: leftAt.add(new THREE.Vector3(-MELEE.wrist[0], MELEE.wrist[1], MELEE.wrist[2])), fingers: new THREE.Vector3(0.2, -0.3, -1), palm: new THREE.Vector3(1, 0, 0), curl: MELEE.curl, thumb: 0.9, tuck: 0.9 } : null,
        },
        // high enough that the fist on the handle is in the picture, not only the head
        hip: new THREE.Vector3(...MELEE.hip),
        ads: new THREE.Vector3(MELEE.hip[0] - 0.05, MELEE.hip[1] + 0.025, MELEE.hip[2]),
        muzzle: new THREE.Vector3(),
      });
    }
  }

  /**
   * A gun out of a weapon pack.
   * @param o.pack the pack whose arms and movements it is held with
   * @param o.gun the gun-alone model shown in them, if it is not the pack's own (its `base`, `slide` and `mag` ride on the pack's)
   */
  private sleeves: THREE.Material | null = null;

  private async packGun(o: { pack: string; item: string; gun?: string; kind: GunKind; hip: THREE.Vector3; flash: MuzzleFlash; flashSize: number }): Promise<VmModel> {
    const entry = assets.manifest.models[`${o.pack}_fp`];
    const rig = new WeaponRig(await assets.gltfOf(`${o.pack}_fp`), entry.rig!, packMaterial);
    // one pair of sleeves and gloves whatever is held: the first pack's (the packs are one maker's, on one pair of arms)
    const sleeves = rig.material(/arm/i);
    if (this.sleeves) rig.repaint(/arm/i, this.sleeves);
    else if (sleeves) this.sleeves = sleeves;
    const aloneId = o.gun ?? o.pack;
    const holds = assets.manifest.models[aloneId].holds!;
    // the gun alone (x along the barrel, y up): what is seen of it in everybody else's hands
    const alone = extractParts(await assets.model(aloneId));
    const world = new THREE.Group();
    world.rotation.y = Math.PI / 2;
    const span = new THREE.Box3();
    const top = new THREE.Box3();
    for (const p of alone) {
      const piece = p.name.replace(/_\d+$/, '');
      const mesh = new THREE.Mesh(p.geometry, packMaterial(p.material));
      mesh.name = piece;
      mesh.castShadow = false;
      world.add(mesh);
      p.geometry.computeBoundingBox();
      if (piece === 'base' || piece === 'slide') span.union(p.geometry.boundingBox!);
      if (piece === 'slide' || (piece === 'base' && o.kind === 'rifle')) top.union(p.geometry.boundingBox!);
    }
    // the muzzle, in the gun's own space: the front of the barrel, at the height of the bore
    const bore = o.kind === 'pistol' ? top.max.y - (top.max.y - top.min.y) * 0.42 : THREE.MathUtils.lerp(span.min.y, span.max.y, 0.62);
    const mouth = new THREE.Vector3(span.max.x, bore, (span.min.z + span.max.z) / 2);
    let suppressor: THREE.Object3D | undefined;
    if (o.kind === 'pistol') {
      const steel = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.85, roughness: 0.55 });
      const far = new THREE.Mesh(suppressorGeometry(), steel);
      far.name = 'suppressor';
      far.position.copy(mouth);
      world.add(far);
      suppressor = new THREE.Mesh(suppressorGeometry(), steel);
      suppressor.position.copy(mouth);
      suppressor.visible = false;
      rig.hang(suppressor, 'base');
    }
    if (o.gun) {
      rig.strip(['base', 'slide', 'mag', 'hammer', 'trigger', 'stopper', 'shell_1']);
      for (const piece of ['base', 'slide', 'mag']) {
        const g = new THREE.Group();
        for (const c of world.children) if (c.name === piece) g.add(c.clone());
        rig.hang(g, piece);
      }
    }
    for (const piece of ITEMS[o.item].weapon?.never ?? []) rig.show(piece, false);
    // (the rifle as others see it held: smaller, from the butt. Its pieces are moved along it
    // so that, drawn smaller, the butt is where it was; the hands' places move with them.)
    const seen = new THREE.Vector3();
    if (o.kind === 'rifle') {
      seen.x = span.min.x * (1 / HELD_RIFLE - 1);
      for (const c of world.children) c.position.x += seen.x;
      world.scale.setScalar(HELD_RIFLE);
    }
    // where things are in the eye's space with the pack at rest and not yet moved to the hip
    const sight = rig.box(o.kind === 'rifle' ? 'glass' : 'slide');
    const frame = rig.box('base');
    const c = sight.getCenter(new THREE.Vector3());
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.add(rig.root);
    root.add(body);
    // aimed: the sights on the middle of the picture, a hand's width nearer than from the hip.
    // (A pistol's: the eye level with the top of them, so that what is aimed at sits on the front
    // post. A centimetre higher and the shot went into the air over the gun, with nothing to say where.)
    const ads = o.kind === 'rifle' ? new THREE.Vector3(-c.x, -c.y, -sight.max.z - 0.075) : new THREE.Vector3(-c.x, -sight.max.y - 0.002, o.hip.z + 0.07);
    const fc = frame.getCenter(new THREE.Vector3());
    const m: VmModel = {
      root, kind: o.kind, flash: o.flash, body, rig, world, suppressor, brass: !!o.gun,
      scope: rig.node('scope') ?? undefined,
      wrap: rig.node('cheekrest') ?? undefined,
      hip: o.hip.clone(),
      hipRot: new THREE.Euler(0, 0, 0),
      ads,
      // without the scope the eye goes along the top of the action
      adsIron: o.kind === 'rifle' ? new THREE.Vector3(-fc.x, -frame.max.y - 0.018, o.hip.z + 0.1) : undefined,
      muzzle: new THREE.Vector3(fc.x, o.kind === 'rifle' ? THREE.MathUtils.lerp(frame.min.y, frame.max.y, 0.62) : c.y, frame.min.z),
      // For whoever is seen holding it. The hands start where the pack's own hands are, and are
      // then moved by what it took, looking close, to seat the body's hands on it: they are
      // bigger than the pack's and their wrists are further from their palms, so set down wrist
      // on wrist they held a pistol by the bottom of its grip, and a rifle a hand's breadth
      // behind its trigger. The first finger is kept nearly straight: it lies in the guard.
      grips: o.kind === 'rifle'
        ? {
            right: { pos: new THREE.Vector3(...holds.right).add(SEAT.rifle).add(seen), fingers: new THREE.Vector3(0.75, -0.55, -0.3), palm: new THREE.Vector3(0.15, -0.1, -1), curl: [0.25, 1.2, 1.25, 1.3], thumb: 0.5 },
            left: { pos: new THREE.Vector3(...holds.left).add(SEAT.fore).add(seen), fingers: new THREE.Vector3(0.35, 0.1, 0.93), palm: new THREE.Vector3(0, 1, 0.1), curl: [1.0, 1.05, 1.1, 1.15], thumb: 0.4 },
          }
        : {
            right: { pos: new THREE.Vector3(...holds.right).add(SEAT.pistol), fingers: new THREE.Vector3(0.9, -0.15, -0.3), palm: new THREE.Vector3(0.3, 0, -1), curl: [0.22, 1.25, 1.3, 1.35], thumb: 1.25 },
            left: { pos: new THREE.Vector3(...holds.left).add(SEAT.pistol), fingers: new THREE.Vector3(0.85, -0.2, 0.35), palm: new THREE.Vector3(0, 0.4, 1), curl: [1.05, 1.1, 1.15, 1.2], thumb: 1.2 },
          },
    };
    // (the flash rides on the gun, so it goes where the barrel goes in the kick)
    o.flash.root.position.copy(m.muzzle);
    body.add(o.flash.root);
    return m;
  }

  /** Compile every viewmodel shader up front so the first equip / first shot never stalls. */
  precompile(compile: (scene: THREE.Scene, camera: THREE.Camera) => void) {
    const added: THREE.Object3D[] = [];
    for (const m of this.models.values()) {
      if (!m.root.parent) {
        this.vmRoot.add(m.root);
        added.push(m.root);
      }
    }
    const hidden: THREE.Object3D[] = [];
    this.vmScene.traverse((o) => {
      if (!o.visible) {
        o.visible = true;
        hidden.push(o);
      }
    });
    compile(this.vmScene, this.vmCamera);
    hidden.forEach((o) => (o.visible = false));
    added.forEach((o) => this.vmRoot.remove(o));
  }

  /** world-space model of the long gun on the back (not in hands), for the avatar */
  slungModel(): THREE.Object3D | null {
    const it = [this.inv.slots.primary, this.inv.slots.secondary].find((i) => i && i !== this.currentItem);
    if (!it) return null;
    const m = this.models.get(it.id);
    if (m?.world) return this.dressed(m, it.id, it.mods ?? []);
    return m ? m.root.children[0] : null;
  }

  /** a pack's gun alone, with the pieces that go with what is fitted to it */
  private dressed(m: VmModel, id: string, mods: string[]): THREE.Object3D {
    const c = m.world!.clone();
    for (const piece of c.children) piece.visible = piece.name === 'suppressor' ? mods.includes('suppressor_9') : pieceShown(id, piece.name, mods);
    return c;
  }

  /** a copy of a weapon's body for showing in someone's hands in the world (third person) */
  worldModel(id: string, mods: string[] = []): THREE.Object3D | null {
    const m = this.models.get(id);
    if (!m) return null;
    if (m.world) return this.dressed(m, id, mods);
    const src = m.body ?? m.root.children[0];
    const wasVisible = [m.scope, m.wrap, m.suppressor, m.mag].map((o) => o?.visible);
    if (m.scope) m.scope.visible = mods.includes('pu_scope');
    if (m.wrap) m.wrap.visible = mods.includes('rifle_wrap');
    if (m.suppressor) m.suppressor.visible = mods.includes('suppressor_9');
    if (m.mag) m.mag.visible = true;
    const c = src.clone();
    [m.scope, m.wrap, m.suppressor, m.mag].forEach((o, i) => o && (o.visible = !!wasVisible[i]));
    return c;
  }

  /** grip points of a weapon model (same ones the first-person arms use) */
  gripsOf(id: string): Grips | null {
    return this.models.get(id)?.grips ?? null;
  }

  private modes = new Map<string, FireMode>();
  fireMode(item: ItemInstance): FireMode {
    const def = ITEMS[item.id];
    return this.modes.get(item.uid) ?? def.weapon?.modes?.[0] ?? 'semi';
  }

  get busy() {
    return this.action !== null;
  }

  get equippedItem() {
    return this.currentItem;
  }

  /** current weapon status for the HUD */
  status() {
    const it = this.currentItem;
    if (!it) return { name: 'Fists', ammo: null as null | { loaded: number; reserve: number; cap: number }, action: this.action?.name ?? null, mode: null as FireMode | null };
    const def = ITEMS[it.id];
    if (!def.weapon) return { name: def.name, ammo: null as null | { loaded: number; reserve: number; cap: number }, action: this.action?.name ?? null, mode: null as FireMode | null };
    return {
      name: def.name,
      ammo: { loaded: it.loaded ?? 0, reserve: this.inv.count(def.weapon.ammo), cap: capacityOf(it) },
      action: this.action?.name ?? null,
      mode: def.weapon.modes ? this.fireMode(it) : null,
    };
  }

  private start(name: Action['name'], dur: number, done?: () => void, data?: Record<string, number>) {
    this.action = { name, t: 0, dur, done, data };
  }

  /** switch the item in hands (null = holster) */
  equip(slot: Slot | null) {
    if (this.action && this.action.name !== 'equip') return;
    const next = slot ? this.inv.slots[slot] : null;
    if (next === this.currentItem) return;
    const swap = () => {
      if (this.current) this.vmRoot.remove(this.current.root);
      this.currentItem = next;
      this.inv.active = next ? slot : null;
      this.current = next ? this.models.get(next.id) ?? null : null;
      if (this.current) {
        this.vmRoot.add(this.current.root);
        this.boltReady = true;
        audio.equip(ITEMS[next!.id].weapon ? 'gun' : 'melee');
        // (a pack has its own way of coming up, and takes as long as that does)
        const rig = this.current.rig;
        this.start('equip', rig ? this.drawTime(rig) : 0.45);
        this.current.shotT = 9;
      } else {
        this.action = null;
      }
      this.onSlungChange(this.slungModel());
    };
    if (this.current) this.start('unequip', 0.28, swap);
    else swap();
  }

  /** inventory changed under us (item dropped / moved) */
  validate() {
    const slot = this.inv.active;
    const item = slot ? this.inv.slots[slot] : null;
    if (item !== this.currentItem) {
      if (this.current) this.vmRoot.remove(this.current.root);
      this.current = item ? this.models.get(item.id) ?? null : null;
      this.currentItem = item;
      if (this.current) this.vmRoot.add(this.current.root);
      this.action = null;
    }
    this.onSlungChange(this.slungModel());
  }

  /** mouse wheel: next / previous occupied slot (wraps through empty hands) */
  cycle(dir: 1 | -1) {
    if (this.action && this.action.name !== 'equip') return;
    const order: (Slot | null)[] = [...SLOT_ORDER, null];
    const cur = order.indexOf(this.inv.active);
    for (let k = 1; k <= order.length; k++) {
      const s = order[(cur + dir * k + order.length * 2) % order.length];
      if (s === null || this.inv.slots[s]) {
        this.equip(s);
        return;
      }
    }
  }

  toggleMode(item: ItemInstance) {
    const modes = ITEMS[item.id].weapon?.modes;
    if (!modes || modes.length < 2) return;
    const next = modes[(modes.indexOf(this.fireMode(item)) + 1) % modes.length];
    this.modes.set(item.uid, next);
    audio.click(3600, 0.35, 0.015);
    audio.click(2400, 0.25, 0.02, 0.04);
    this.selectorT = 0.25;
  }

  private selectorT = 0;

  update(dt: number, input: Input, camera: THREE.PerspectiveCamera, enabled: boolean) {
    this.time += dt;
    this.selectorT = Math.max(0, this.selectorT - dt);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    this.updateBullets(dt);
    this.updateBrass(dt);
    for (const m of this.models.values()) m.flash.update(dt);

    if (enabled && !this.player.dead) {
      if (input.pressed('Digit1')) this.equip('primary');
      if (input.pressed('Digit2')) this.equip('secondary');
      if (input.pressed('Digit3')) this.equip('holster');
      if (input.pressed('Digit4')) this.equip('melee');
      if (input.pressed('KeyX')) this.equip(null);
      if (input.wheel !== 0 && !this.aiming) this.cycle(input.wheel > 0 ? 1 : -1);
      if (input.pressed('KeyB') && this.currentItem) this.toggleMode(this.currentItem);
    }

    const m = this.current;
    const item = this.currentItem;
    const def = item ? ITEMS[item.id] : null;
    const p = this.player;

    // ----- aiming
    const canAim = enabled && !!m && !p.sprinting && (!this.action || this.action.name === 'bolt') && !p.dead;
    this.aiming = canAim && input.held('Mouse2');
    this.spread = def?.weapon ? this.spreadNow(def.weapon.kind) : 0;
    p.aiming = this.aiming;
    // a handy gun is at the eye in a fifth of a second; a long heavy one takes twice that
    const hd = handlingOf(item) ?? { ergo: 80, weight: 0.5, recoil: 1 };
    const upIn = THREE.MathUtils.lerp(0.46, 0.17, THREE.MathUtils.clamp((hd.ergo - 30) / 60, 0, 1));
    this.adsT += ((this.aiming ? 1 : 0) - this.adsT) * (1 - Math.exp(-(3 / upIn) * (this.aiming ? 1 : 0.85) * dt));
    this.scoped = !!m && m.kind === 'rifle' && hasMod(this.currentItem, 'pu_scope') && this.adsT > 0.9 && this.aiming;
    this.applyMods();
    this.sprintT += ((p.sprinting && p.moving > 0.4 ? 1 : 0) - this.sprintT) * (1 - Math.exp(-8 * dt));
    if (!enabled || p.dead || this.held || (def && !def.melee)) this.guardHeld = false;

    // ----- hold breath while aiming (Shift): steadier for a few seconds, and hard on the arms
    const wantBreath = this.aiming && this.adsT > 0.85 && input.held('ShiftLeft') && p.vitals.stamina > 5 && this.armStamina > 0.06;
    if (wantBreath) {
      this.breath.t += dt;
      p.vitals.stamina = Math.max(0, p.vitals.stamina - 9 * dt);
    } else this.breath.t = Math.max(0, this.breath.t - dt * 2);
    this.breath.held = wantBreath && this.breath.t < 6;
    // ----- the arms: tiring while the gun is up, resting while it is down
    // (down on a knee the elbow has somewhere to rest: the gun stays up half as long again)
    if (this.aiming && def?.weapon) this.armStamina = Math.max(0, this.armStamina - (0.028 + hd.weight * 0.011) * (this.breath.held ? 2.6 : 1) * (p.crouched ? 0.65 : 1) * dt);
    else this.armStamina = Math.min(1, this.armStamina + 0.3 * dt);

    // ----- trigger / actions
    if (enabled && m && item && def && !p.dead) {
      if (def.weapon) {
        const auto = this.fireMode(item) === 'auto';
        if (input.pressed('Mouse0')) {
          this.burst = 0;
          this.tryFire(m, item, camera, true);
        } else if (auto && input.held('Mouse0')) {
          this.tryFire(m, item, camera, false);
        }
        if (!input.held('Mouse0')) this.burst = 0;
        if (input.pressed('KeyR') && !this.action) this.reload(m, item);
      } else if (def.melee) {
        // put up across the body to stop a blow (the other button), or swung
        this.guardHeld = input.held('Mouse2') && !this.action;
        if (this.guardHeld) this.guardHold = 0.12;
        if (input.pressed('Mouse0') && !this.action && this.fireCooldown <= 0) this.swing(def.melee, camera);
      }
    } else if (enabled && !m && !p.dead && !this.held) {
      // bare hands
      this.guardHeld = input.held('Mouse2');
      if (input.held('Mouse2')) this.guardHold = 0.4;
      if (input.pressed('Mouse0') && !this.action && this.fireCooldown <= 0 && p.vitals.stamina > FIST.stamina) this.punch();
    }
    if (this.action && (input.pressed('Mouse0') || input.pressed('Mouse2')) && this.action.name === 'reload' && (this.action.data?.inserted ?? 0) > 0) {
      // interrupt rifle reload once at least one round is in
      this.action.data!.stop = 1;
    }

    // ----- action timeline
    const a = this.action;
    if (a) {
      a.t += dt;
      this.actionTick(a, m, item);
      if (a.t >= a.dur) {
        this.action = null;
        a.done?.();
      }
    }

    // ----- scope sway (applied to the aim, so bullets follow it)
    const tired = 1 + (1 - p.vitals.stamina / MAX_STAMINA) * 2.5;
    const heft = THREE.MathUtils.clamp((100 - hd.ergo) / 60, 0.25, 1.2);
    const armsK = 1 + Math.pow(1 - this.armStamina, 2) * 2.6;
    const swayAmp = (this.scoped ? 0.0035 : this.aiming ? 0.0022 : 0.0012) * tired * (this.breath.held ? 0.15 : 1) * (p.crouched ? 0.6 : 1) * (hasMod(item, 'rifle_wrap') ? 0.75 : 1) * armsK * (0.75 + heft * 0.5);
    const t = this.time;
    const breathSway = new THREE.Vector2(Math.sin(t * 0.9) * 0.7 + Math.sin(t * 2.1) * 0.3, Math.sin(t * 1.3 + 1) * 0.6 + Math.cos(t * 0.7) * 0.4).multiplyScalar(swayAmp);
    const rec = this.aimRecoil.step(dt);
    p.aimOffset.set(breathSway.x + rec.x, breathSway.y + rec.y);

    this.animate(dt, input, camera);
  }

  private burst = 0;
  /**
   * How far off the line of sight the next shot can land, radians (the full width of the
   * cone). Standing still it is the weapon's own figure; moving opens it, being off the
   * ground opens it wide, crouching closes it a little. The crosshair is drawn this wide.
   */
  spread = 0;

  private spreadNow(kind: GunKind): number {
    const p = this.player;
    const hd = HANDLING[kind];
    const move = p.movingSmooth;
    const air = p.grounded ? 0 : 1;
    const bloom = kind === 'auto' ? Math.min(Math.max(0, this.burst - 1), 8) * 0.0025 : 0;
    const hip = hd.spread * (1 + move * 1.3) * (p.crouched ? 0.75 : 1) + air * 0.035;
    const ads = 0.002 + move * 0.007 + air * 0.02;
    return THREE.MathUtils.lerp(hip, ads, this.adsT) + bloom;
  }

  private tryFire(m: VmModel, item: ItemInstance, camera: THREE.PerspectiveCamera, trigger: boolean) {
    if (this.action || this.fireCooldown > 0) return;
    const def = ITEMS[item.id];
    if (!def.weapon) return;
    if ((item.loaded ?? 0) <= 0 || !this.boltReady) {
      if (trigger) audio.dryFire();
      this.fireCooldown = 0.25;
      return;
    }
    item.loaded = (item.loaded ?? 0) - 1;
    const kind = def.weapon.kind;
    const b = BALLISTICS[kind];
    const hd = HANDLING[kind];
    this.burst++;
    // eye-origin shot with zeroing elevation (bullet crosses line of sight at the zero range),
    // along the way the gun is pointing: on the eye's own line unless it is still catching up with a turn
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.lag.y, this.lag.x, 0, 'YXZ')).applyQuaternion(camera.quaternion);
    const t0 = b.zero / b.muzzleVel;
    const elev = (0.5 * 9.81 * t0 * t0) / b.zero;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    dir.addScaledVector(up, elev).normalize();
    // hip fire is less precise, moving less still; sustained auto fire blooms
    const spread = this.spreadNow(kind);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    const suppressed = hasMod(item, 'suppressor_9');
    this.onShot({ origin: camera.position.clone(), dir: dir.clone(), weapon: item.id, suppressed });
    this.bullets.push({ pos: camera.position.clone(), vel: dir.multiplyScalar(b.muzzleVel * (suppressed ? 0.9 : 1)), drag: b.drag, damage: b.damage * (suppressed ? 0.9 : 1), life: 4, travelled: 0, weapon: item.id });

    // feel: recoil springs, camera kick, flash, sound. Auto fire climbs up and
    // drifts right, sawing left/right after the first few rounds.
    const big = kind === 'rifle';
    // (tired arms and an unhandy gun kick harder; what is screwed on the muzzle takes some of it)
    const feel = handlingOf(item) ?? { ergo: 80, weight: 0.5, recoil: 1 };
    const stance = (this.player.crouched ? 0.7 : 1) * (this.aiming ? 0.85 : 1) * feel.recoil * (1 + (1 - this.armStamina) * 0.5) * THREE.MathUtils.lerp(1.12, 0.92, feel.ergo / 100);
    const drift = kind === 'auto' ? (this.burst < 4 ? 0.12 : Math.sin(this.burst * 1.7) * 0.28) : (Math.random() - 0.5);
    // (a pack's hands take the shot themselves: on top of that, half the kick the game gives a still model)
    const own = m.rig ? 0.5 : 1;
    this.kick.v.z += hd.vmKick * own;
    this.kick.v.y += (big ? 0.25 : 0.4) * own;
    this.kickRot.v.x += (big ? 9 : kind === 'auto' ? 5.5 : 7) * own;
    this.kickRot.v.z += (Math.random() - 0.5) * (big ? 3 : 2) * own;
    this.aimRecoil.v.y += hd.kickV * stance;
    this.aimRecoil.v.x += drift * hd.kickH * stance;
    this.player.pitch += hd.climb * stance; // part of the kick stays: you have to pull down
    this.player.yaw -= drift * hd.climb * 0.35 * stance;
    const muzzleWorld = camera.position.clone().add(new THREE.Vector3(0.12, -0.1, -0.9).applyQuaternion(camera.quaternion));
    if (!suppressed) {
      m.flash.fire(FLAME[kind]);
    }
    this.fx.muzzle(muzzleWorld, new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), big || kind === 'auto', suppressed);
    audio.gunshot(kind === 'auto' ? 'rifle' : kind, undefined, 0, kind === 'auto', suppressed);

    m.shotT = 0;
    m.shotClip = m.rig?.has('fireLast') && (item.loaded ?? 0) === 0 ? 'fireLast' : 'fire';
    if (kind === 'rifle') {
      this.boltReady = false;
      this.fireCooldown = hd.interval;
      setTimeout(() => {
        if (this.current === m && !this.action) this.cycleBolt(m);
      }, m.rig ? 300 : 260);
    } else {
      this.fireCooldown = hd.interval;
      this.slideKick = 1;
      // (a pack throws its own case)
      if (!m.rig || m.brass) this.eject(m, false);
      audio.shellDrop();
      if ((item.loaded ?? 0) === 0) this.dry.add(item);
    }
  }

  private slideKick = 0;
  /**
   * How a bare fist is made and how the two are held up (the left's mirrored): which way the
   * hand runs and the palm faces, in the eye's space, and how far each finger and each of
   * its joints is closed. (Kept where the dev harness can reach it while looking: it took
   * looking to get a glove to read as a fist.)
   */
  fists = {
    // The hands stand up, knuckles to the sky, and the palms are turned most of the way round
    // to the face: what the eye sees of each is the row of closed fingers and the thumb laid
    // along the top of them, which is what says "fist". Seen from the back a gloved fist is a
    // stump. And they are not closed all the way: these are thick gloves, and a finger folded
    // as far as a bare one goes ends up inside itself.
    fingers: [0.12, 0.9, -0.4] as [number, number, number],
    palm: [0.55, -0.05, 0.83] as [number, number, number],
    curl: [1.3, 1.33, 1.36, 1.4] as [number, number, number, number],
    fold: [1.05, 1.0, 0.5] as [number, number, number],
    thumb: 0.9,
    tuck: 1,
  };

  // spent cases: thrown out of the action to the right, seen for the half second it takes them to leave the picture
  private brass: { mesh: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; life: number }[] = [];
  private brassGeo: Record<'short' | 'long', THREE.CylinderGeometry> | null = null;
  private brassMat: THREE.MeshStandardMaterial | null = null;

  private eject(m: VmModel, long: boolean) {
    this.brassGeo ??= { short: new THREE.CylinderGeometry(0.0048, 0.0048, 0.019, 8), long: new THREE.CylinderGeometry(0.0061, 0.0061, 0.053, 8) };
    this.brassMat ??= new THREE.MeshStandardMaterial({ color: 0xb8923e, metalness: 0.85, roughness: 0.36 });
    let b = this.brass.find((x) => x.life <= 0);
    if (!b) {
      if (this.brass.length >= 8) return;
      b = { mesh: new THREE.Mesh(this.brassGeo.short, this.brassMat), v: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 };
      b.mesh.castShadow = false;
      this.brass.push(b);
    }
    b.mesh.geometry = long ? this.brassGeo.long : this.brassGeo.short;
    // the port is on top of the action, a hand's width behind the weapon's middle
    b.mesh.position.copy(m.root.position).add(_toCam.set(0.012, long ? 0.062 : 0.068, long ? 0.2 : 0.05).applyEuler(m.root.rotation));
    b.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    // up and out to the right, slow enough to be seen leaving
    b.v.set(0.4 + Math.random() * 0.35, 1.0 + Math.random() * 0.5, -0.15 + Math.random() * 0.25);
    b.spin.set(8 + Math.random() * 14, Math.random() * 10, 6 + Math.random() * 12);
    b.life = 0.7;
    this.vmRoot.add(b.mesh);
  }

  private updateBrass(dt: number) {
    for (const b of this.brass) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.mesh.removeFromParent();
        continue;
      }
      b.v.y -= 9.81 * dt;
      b.mesh.position.addScaledVector(b.v, dt);
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      b.mesh.rotation.z += b.spin.z * dt;
    }
  }

  private cycleBolt(m: VmModel) {
    audio.boltCycle();
    audio.shellDrop(0.5);
    // (the pack's hand has further to go than a bolt moved by itself: a little longer)
    const dur = m.rig ? 0.95 : 0.78;
    this.start('bolt', dur, () => {
      this.boltReady = true;
    }, { out: 0 });
    this.onAct('bolt', dur);
  }

  private reload(m: VmModel, item: ItemInstance) {
    const def = ITEMS[item.id];
    if (!def.weapon) return;
    const need = capacityOf(item) - (item.loaded ?? 0);
    const have = this.inv.count(def.weapon.ammo);
    if (need <= 0 || have <= 0) return;
    if (m.rig) {
      // A pack's gun is fed by its magazine, and its hands do it at their own pace: out with
      // the old one, in with the new, and the slide or the bolt if the gun had run dry.
      const empty = m.kind === 'pistol' && this.chamberEmpty && m.rig.has('reloadEmpty');
      const clip = empty ? 'reloadEmpty' : 'reload';
      // (at very nearly the pace it was drawn at: hurried, the hands stop looking like hands)
      const dur = m.rig.seconds(clip) * (m.kind === 'pistol' ? 0.92 : 1);
      audio.magOut(dur * (m.kind === 'pistol' ? 0.12 : 0.28), m.kind !== 'pistol');
      audio.magIn(dur * (m.kind === 'pistol' ? (empty ? 0.36 : 0.48) : 0.62), m.kind !== 'pistol');
      if (empty) audio.slideRack(dur * 0.7);
      this.onAct('reload', dur);
      this.start('magswap', dur, () => {
        const got = this.inv.take(def.weapon!.ammo, capacityOf(item) - (item.loaded ?? 0));
        item.loaded = (item.loaded ?? 0) + got;
        this.dry.delete(item);
        this.boltReady = true;
      }, { empty: empty ? 1 : 0 });
      return;
    }
    if (m.kind === 'rifle') {
      // open bolt, push rounds in one by one, close bolt
      const n = Math.min(need, have);
      audio.click(2400, 0.45, 0.025);
      audio.click(1700, 0.5, 0.06, 0.15);
      this.onAct('reload', 0.55 + n * 0.48 + 0.5);
      this.start('reload', 0.55 + n * 0.48 + 0.5, () => {
        audio.click(2000, 0.5, 0.05);
        audio.click(2800, 0.45, 0.025, 0.18);
        this.boltReady = true;
      }, { rounds: n, inserted: 0, stop: 0 });
    } else {
      const long = m.kind === 'auto';
      const locked = this.chamberEmpty;
      audio.magOut(long ? 0.25 : 0.1, long);
      audio.magIn(long ? 1.35 : 1.05, long);
      if (locked) {
        if (long) {
          audio.click(1500, 0.55, 0.05, 1.85);
          audio.click(2200, 0.6, 0.04, 2.0);
        } else audio.slideRack(1.55);
      }
      const dur = long ? (locked ? 2.35 : 1.9) : locked ? 1.95 : 1.55;
      this.onAct('reload', dur);
      this.start('magswap', dur, () => {
        const got = this.inv.take(def.weapon!.ammo, capacityOf(item) - (item.loaded ?? 0));
        item.loaded = (item.loaded ?? 0) + got;
        this.dry.delete(item);
      });
    }
  }

  private punch() {
    this.fireCooldown = FIST.rate;
    this.guardHold = 2.6;
    this.punchHand = 1 - this.punchHand;
    this.player.vitals.stamina = Math.max(0, this.player.vitals.stamina - FIST.stamina);
    audio.whoosh();
    const dmg = FIST.damage + this.inv.wear('fist').reduce((a, b) => a + b, 0);
    this.start('punch', FIST.rate * 0.95, undefined, { hit: 0, dmg, range: FIST.range, hand: this.punchHand });
    this.onSwing();
  }

  /** Show an item in the hands while it is being used; the weapon drops out of the way. */
  beginUse(id: string, kind: UseKind, dur: number) {
    if (kind === 'smoke') {
      // (not the packet: one out of it)
      const c = (this.smoke ??= cigarette());
      if (this.held) this.vmRoot.remove(this.held.root);
      this.held = { root: c.root, kind, t: 0, dur, size: new THREE.Vector3(0.008, 0.008, 0.082), ending: 0, coal: c.coal, puffs: 0, wispT: 0 };
      this.vmRoot.add(c.root);
      return;
    }
    if (!this.itemModels) return;
    void this.itemModels.get(id).then((tpl) => {
      let h = this.heldCache.get(id);
      if (!h) {
        const root = new THREE.Group();
        const obj = tpl.group.clone();
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.material = plainMaterial(mesh.material as THREE.Material);
            mesh.castShadow = false;
          }
        });
        const size = tpl.size.clone();
        // long side points away from the camera so the hand wraps the narrow side
        if (size.x > size.z * 1.15) {
          obj.rotation.y = Math.PI / 2;
          size.set(size.z, size.y, size.x);
        }
        obj.position.y = -size.y / 2;
        root.add(obj);
        h = { root, size };
        this.heldCache.set(id, h);
      }
      if (this.held) this.vmRoot.remove(this.held.root);
      this.held = { root: h.root, kind, t: 0, dur, size: h.size, ending: 0 };
      // (not seen until it has been put where it goes: it is made at the eye itself)
      h.root.visible = false;
      this.vmRoot.add(h.root);
    });
  }

  endUse() {
    if (this.held && !this.held.ending) this.held.ending = 1e-4;
  }

  private swing(melee: NonNullable<(typeof ITEMS)[string]['melee']>, camera: THREE.PerspectiveCamera) {
    this.fireCooldown = melee.rate;
    this.player.vitals.stamina = Math.max(0, this.player.vitals.stamina - 6);
    // the heavier the thing, the lower and longer it cuts the air
    audio.whoosh(THREE.MathUtils.clamp((melee.rate - 0.4) / 0.45, 0, 1));
    this.strokeN = this.time - this.strokeAt < melee.rate + 0.7 ? this.strokeN + 1 : 0;
    this.strokeAt = this.time;
    this.start('swing', melee.rate * 0.9, undefined, { hit: 0, dmg: melee.damage, range: melee.range, stroke: this.strokeN });
    this.onSwing(melee.rate * 0.9);
    void camera;
  }

  private actionTick(a: Action, m: VmModel | null, item: ItemInstance | null) {
    if (a.name === 'reload' && m && item && a.data) {
      const def = ITEMS[item.id];
      // insert one round every 0.48 s after the bolt opens
      const due = Math.min(a.data.rounds, Math.max(0, Math.floor((a.t - 0.55) / 0.48) + 1));
      while (a.data.inserted < due && !a.data.stop) {
        if (this.inv.take(def.weapon!.ammo, 1) === 1) {
          item.loaded = (item.loaded ?? 0) + 1;
          audio.roundInsert();
        }
        a.data.inserted++;
      }
      if (a.data.stop && a.t < a.dur - 0.5) a.t = a.dur - 0.5;
    }
    if ((a.name === 'swing' || a.name === 'punch') && a.data && !a.data.hit && a.t > a.dur * (a.name === 'punch' ? 0.28 : 0.35)) {
      a.data.hit = 1;
      const cam = this.vmCamera.parent ? this.mainCam : null;
      if (!cam) return;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const hit = physics.raycast(cam.position, dir, a.data.range, SHOT_GROUPS, this.player.collider);
      if (hit) {
        const pt = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
        const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
        const target = this.resolveTarget(hit.tag?.owner);
        if (target) {
          const zone = hit.tag?.zone ?? 'torso';
          const dmg = a.data.dmg * ZONE_MULT[zone][1];
          const killed = target.damage(dmg, pt, dir, zone);
          this.markHit(killed);
          this.onHit({ victim: target, weapon: a.name === 'punch' ? 'fists' : this.currentItem?.id ?? 'fists', target: target.name, zone, damage: dmg, killed, distance: hit.toi, melee: true });
          const power = a.name === 'punch' ? 0.2 : 0.55;
          this.fx.bleed(pt, dir, power);
          this.onFlesh(hit.tag?.owner, pt, dir, power);
          audio.impact('flesh', pt, 1);
        } else {
          const s = (hit.tag?.surface ?? 'dirt') as Surface;
          this.fx.impact(s, pt, n, false);
          audio.impact(s, pt, 1);
        }
        // the blow lands: the view jolts
        this.kickRot.v.x -= 6;
        this.aimRecoil.v.y += a.name === 'punch' ? 0.25 : 0.4;
        this.aimRecoil.v.x += (Math.random() - 0.5) * 0.3;
      }
    }
  }

  mainCam: THREE.PerspectiveCamera | null = null;

  /**
   * A place in the hands' own picture, said as a place in the world (for smoke, which is in
   * the world). The hands are drawn through a narrower lens than the world is: what is at the
   * edge of one is not at the edge of the other unless that is allowed for.
   */
  private toWorld(v: THREE.Vector3, cam: THREE.PerspectiveCamera): THREE.Vector3 {
    const k = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(this.vmCamera.fov) / 2);
    return new THREE.Vector3(v.x * k, v.y * k, v.z).applyQuaternion(cam.quaternion).add(cam.position);
  }

  /** show or hide attachment meshes to match the item in hand */
  private applyMods() {
    const m = this.current;
    if (!m) return;
    const it = this.currentItem;
    if (m.scope) m.scope.visible = hasMod(it, 'pu_scope');
    if (m.wrap) m.wrap.visible = hasMod(it, 'rifle_wrap');
    if (m.suppressor) m.suppressor.visible = hasMod(it, 'suppressor_9');
  }

  /** Another player fired: their bullet flies in this world too, so you see and hear where it lands. */
  remoteShot(origin: THREE.Vector3, dir: THREE.Vector3, weaponId: string, suppressed: boolean) {
    const kind = ITEMS[weaponId]?.weapon?.kind;
    if (!kind) return;
    const b = BALLISTICS[kind];
    // The shot is reported from the shooter's eye, which in this world is inside their own
    // head hit zone: the bullet starts a forearm's length out, or it would land on them.
    const out = dir.clone().normalize();
    this.bullets.push({ pos: origin.clone().addScaledVector(out, 0.35), vel: out.clone().multiplyScalar(b.muzzleVel), drag: b.drag, damage: 0, life: 4, travelled: 0.35, weapon: weaponId, ghost: true });
    const d = this.mainCam ? origin.distanceTo(this.mainCam.position) : 0;
    this.fx.muzzle(origin.clone().addScaledVector(dir, 0.6), dir, kind !== 'pistol', suppressed, FLAME[kind]);
    audio.gunshot(kind === 'auto' ? 'rifle' : kind, origin, d, false, suppressed);
  }

  /** the server confirmed our hit killed someone */
  confirmKill() {
    this.hitMarker = 0.6;
    this.killMarker = true;
    audio.hitTick(true);
  }

  /** the ground came up: the weapon dips with the knees */
  landed(speed: number) {
    const k = Math.min(1, speed / 9);
    this.kick.v.y -= 0.9 + k * 2.6;
    this.kickRot.v.x -= 2 + k * 6;
  }

  /** we were hit: the view and the weapon jolt */
  /**
   * On guard: the fists up, or what is held to strike with brought across in front, and not
   * in the middle of a blow. A blow from in front of somebody on guard is stopped (see
   * INFECTED.guardArc).
   */
  get guarding(): boolean {
    return this.guardHeld && this.guardT > 0.55 && !this.action && !this.held && !this.player.dead;
  }

  /** a blow has come down on the guard: the arms take it */
  jolt() {
    this.kick.v.z += 1.6;
    this.kick.v.y -= 0.6;
    this.kickRot.v.x += 5;
    this.kickRot.v.z += (Math.random() - 0.5) * 6;
    this.aimRecoil.v.y += 0.2;
  }

  flinch(k: number) {
    this.aimRecoil.v.y += 0.9 * k;
    this.aimRecoil.v.x += (Math.random() - 0.5) * 1.4 * k;
    this.kickRot.v.z += (Math.random() - 0.5) * 7 * k;
    this.kick.v.y -= 0.5 * k;
  }

  private markHit(killed: boolean, head = false) {
    this.hitMarker = killed ? 0.5 : 0.25;
    this.killMarker = killed;
    this.headMarker = head;
    audio.hitTick(killed, head);
  }

  /**
   * Hands follow the work: during reloads and bolt cycles the base grips blend toward
   * the moving parts (magazine, bolt handle, slide), so the hands visibly do the action.
   */
  private actionGrips(m: VmModel): Grips | null {
    const g = m.grips;
    if (!g) return null;
    const a = this.action;
    if (!a) return g;
    const k = Math.min(1, a.t / a.dur);
    const smooth = (x0: number, x1: number) => THREE.MathUtils.smoothstep(k, x0, x1);
    const blend = (base: HandGrip, to: Partial<HandGrip>, w: number): HandGrip => ({
      pos: base.pos.clone().lerp(to.pos ?? base.pos, w),
      fingers: base.fingers.clone().lerp(to.fingers ?? base.fingers, w).normalize(),
      palm: base.palm.clone().lerp(to.palm ?? base.palm, w).normalize(),
      curl: base.curl.map((c, i) => THREE.MathUtils.lerp(c, to.curl?.[i] ?? c, w)) as HandGrip['curl'],
      thumb: THREE.MathUtils.lerp(base.thumb, to.thumb ?? base.thumb, w),
    });
    if (m.kind === 'pistol' && a.name === 'magswap' && g.left && m.mag) {
      // left hand strips the mag, drops out of view for a fresh one, seats it, re-grips
      const w = smooth(0.02, 0.18) * (1 - smooth(0.78, 0.95));
      const magPos = new THREE.Vector3(-0.035, -0.1 + m.mag.position.y, -0.01);
      const away = smooth(0.3, 0.42) * (1 - smooth(0.52, 0.66));
      magPos.y -= away * 0.25;
      magPos.z -= away * 0.08;
      const left = blend(g.left, { pos: magPos, fingers: new THREE.Vector3(0.2, 0.3, 0.93), palm: new THREE.Vector3(0, 1, 0), curl: [0.9, 0.95, 1, 1.05], thumb: 0.5 }, w);
      // empty gun: overhand rack of the slide at the end
      if (a.dur > 1.8) {
        const r = smooth(0.78, 0.86) * (1 - smooth(0.93, 1));
        const slidePos = new THREE.Vector3(-0.02 - 0.03 * smooth(0.84, 0.9), 0.1, 0.0);
        return { right: g.right, left: blend(left, { pos: slidePos, fingers: new THREE.Vector3(0.1, -0.3, 0.95), palm: new THREE.Vector3(0, -1, 0), curl: [1.0, 1.05, 1.1, 1.1], thumb: 0.7 }, r) };
      }
      return { right: g.right, left };
    }
    if (m.kind === 'rifle' && (a.name === 'bolt' || a.name === 'reload') && g.right && m.boltSlide && m.bolt) {
      // right hand leaves the grip to work the bolt handle (follows the animated bolt)
      const w = a.name === 'bolt' ? smooth(0.0, 0.14) * (1 - smooth(0.86, 1)) : smooth(0.0, 0.08) * (1 - smooth(0.94, 1));
      const handle = new THREE.Vector3(-0.235 + m.boltSlide.position.x, 0.04 + 0.02 * Math.sin(-m.bolt.rotation.x), 0.06 + 0.02 * Math.cos(-m.bolt.rotation.x));
      let pos = handle;
      if (a.name === 'reload' && a.data) {
        // between bolt open and close the thumb pushes rounds down into the magazine
        const feeding = a.t > 0.55 && a.t < a.dur - 0.5;
        if (feeding) {
          const local = ((a.t - 0.55) % 0.48) / 0.48;
          pos = new THREE.Vector3(-0.2, 0.09 - 0.03 * Math.sin(local * Math.PI), 0.035);
        }
      }
      const right = blend(g.right, { pos, fingers: new THREE.Vector3(0.6, -0.2, -0.75), palm: new THREE.Vector3(0, -0.4, -1), curl: [0.8, 0.9, 0.95, 1.0], thumb: 0.3 }, w);
      return { right, left: g.left };
    }
    return g;
  }

  private updateBullets(dt: number) {
    const g = 9.81;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      let remaining = dt;
      let dead = false;
      while (remaining > 0 && !dead) {
        const h = Math.min(remaining, 1 / 240);
        remaining -= h;
        const speed = b.vel.length();
        b.vel.addScaledVector(b.vel, -b.drag * speed * h);
        b.vel.y -= g * h;
        const step = b.vel.clone().multiplyScalar(h);
        const len = step.length();
        const dir = step.clone().divideScalar(len);
        // other players' bullets pass through nothing special: they stop on the world and on bodies alike
        const hit = physics.raycast(b.pos, dir, len, SHOT_GROUPS, b.ghost ? undefined : this.player.collider);
        if (hit) {
          const pt = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
          const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
          const target = this.resolveTarget(hit.tag?.owner);
          const dist = b.travelled + hit.toi;
          const energy = (speed * speed) / (BALLISTICS.rifle.muzzleVel * BALLISTICS.rifle.muzzleVel);
          if (target || hit.tag?.surface === 'flesh') {
            if (target && !b.ghost) {
              const zone = hit.tag?.zone ?? 'torso';
              const dmg = b.damage * Math.max(0.35, Math.min(1, energy * 1.6 + 0.4)) * ZONE_MULT[zone][0];
              const killed = target.damage(dmg, pt, dir, zone);
              this.markHit(killed, zone === 'head');
              this.onHit({ victim: target, weapon: b.weapon, target: target.name, zone, damage: dmg, killed, distance: dist, melee: false });
            }
            // a body: yours, somebody else's, or one lying on the ground
            const power = ITEMS[b.weapon]?.weapon?.kind === 'pistol' ? 0.6 : 1;
            const owner = hit.tag?.owner;
            this.fx.bleed(pt, dir, power, owner === this.player);
            this.onFlesh(owner, pt, dir, power);
            audio.impact('flesh', pt, b.ghost ? pt.distanceTo(this.mainCam?.position ?? pt) : dist);
          } else {
            const s = (hit.tag?.surface ?? 'dirt') as Surface;
            // doors swing: their holes are parented to the door
            const pivot = (hit.tag?.owner as { pivot?: THREE.Object3D } | undefined)?.pivot;
            this.fx.impact(s, pt, n, true, pivot);
            audio.impact(s, pt, b.ghost ? pt.distanceTo(this.mainCam?.position ?? pt) : dist);
            if (!b.ghost && hit.tag?.owner) this.onStruck(hit.tag.owner, b.weapon);
          }
          dead = true;
          break;
        }
        // somebody else's bullet going past your head: you hear the crack before you know where from
        if (b.ghost && !b.heard && this.mainCam && b.travelled > 6) {
          const toCam = _toCam.copy(this.mainCam.position).sub(b.pos);
          const along = toCam.dot(dir);
          if (along <= len) {
            // the nearest point of this step's path
            b.heard = true;
            const miss = toCam.addScaledVector(dir, -Math.max(0, along)).length();
            if (miss < 5) audio.whiz(_toCam.copy(b.pos).addScaledVector(dir, Math.max(0, along)), miss, 0, speed > 343);
          }
        }
        b.pos.add(step);
        b.travelled += len;
      }
      b.life -= dt;
      if (dead || b.life <= 0 || b.pos.y < -200) this.bullets.splice(i, 1);
    }
  }

  private animate(dt: number, input: Input, camera: THREE.PerspectiveCamera) {
    const m = this.current;
    this.vmCamera.quaternion.copy(camera.quaternion);
    this.vmCamera.position.set(0, 0, 0);
    this.vmCamera.updateMatrixWorld();
    const p = this.player;

    // viewmodel lighting: is the camera in sun shadow / under a roof?
    const eye = camera.position;
    const sunBlocked = physics.raycast(eye, this.atmo.sunDir, 120, SHOT_GROUPS, p.collider) !== null;
    const roof = physics.raycast(eye, { x: 0, y: 1, z: 0 }, 30, SHOT_GROUPS, p.collider) !== null;
    this.sunVis += ((sunBlocked ? 0.06 : 1) - this.sunVis) * (1 - Math.exp(-8 * dt));
    this.skyVis += ((roof ? 0.35 : 1) - this.skyVis) * (1 - Math.exp(-4 * dt));
    this.sunLight.intensity = this.atmo.sunIntensity * this.sunVis;
    this.vmScene.environmentIntensity = 0.9 * this.skyVis;

    // an item in use takes over the hands; whatever was held drops out of view
    this.lowerT += ((this.stowed || (this.held && !this.held.ending) ? 1 : 0) - this.lowerT) * (1 - Math.exp(-10 * dt));
    if (this.held) {
      if (m) m.root.visible = false;
      this.lag.set(0, 0);
      this.animateHeld(dt);
      return;
    }
    if (!m) {
      this.lag.set(0, 0);
      this.animateFists(dt);
      return;
    }
    if (m.melee) {
      this.lag.set(0, 0);
      this.animateMelee(dt, m, m.melee);
      return;
    }

    // springs
    const kick = this.kick.step(dt);
    const kr = this.kickRot.step(dt);
    // the gun has weight: it trails the eye through a turn and swings on a little after it. How far
    // goes by how fast the head is turning (not by how many frames that took), and by the gun.
    const feel = handlingOf(this.currentItem);
    const heft = feel ? THREE.MathUtils.clamp((100 - feel.ergo) / 60, 0.25, 1.2) : 0.6;
    this.sway.k = THREE.MathUtils.lerp(150, 85, heft / 1.2);
    this.sway.d = THREE.MathUtils.lerp(16, 12, heft / 1.2);
    const turn = dt > 1e-4 ? 0.000015 / dt : 0;
    const sw = this.sway.step(Math.min(dt, 0.05), new THREE.Vector3(input.mouseDX * turn, input.mouseDY * turn, 0).clampScalar(-0.06, 0.06));
    const trail = 4 * (1 - this.adsT * 0.7) * (0.7 + heft * 0.5);
    // (from the hip only a part of it reaches the shot: the rest is the arms, not the barrel. Through a scope the eye and the barrel are one.)
    const follow = feel && !this.scoped ? THREE.MathUtils.lerp(0.3, 1, this.adsT) : 0;
    this.lag.set(sw.x * trail * follow, sw.y * trail * follow);

    const ads = this.adsT;
    const adsPos = m.adsIron && !hasMod(this.currentItem, 'pu_scope') ? m.adsIron : m.ads;
    const pos = new THREE.Vector3().lerpVectors(m.hip, adsPos, ads);
    const rot = new THREE.Euler(0, 0, 0);

    // bob
    const amp = p.movingSmooth * (p.grounded ? 1 : 0) * (1 - ads * 0.8);
    const ph = p.bobPhase;
    pos.x += Math.cos(ph) * 0.012 * amp;
    pos.y += -Math.abs(Math.sin(ph)) * 0.014 * amp;
    rot.z += Math.cos(ph) * 0.02 * amp;
    // idle breathing
    pos.y += Math.sin(this.time * 1.6) * 0.0018 * (1 - ads);
    // sprint pose
    const sp = this.sprintT;
    pos.add(new THREE.Vector3(0.04, -0.06, 0.04).multiplyScalar(sp));
    rot.x += -0.25 * sp;
    rot.y += 0.65 * sp;
    rot.z += 0.35 * sp;
    // sway
    rot.y += sw.x * trail;
    rot.x += sw.y * trail;
    // sidestepping: the gun rolls and trails a little behind the move
    rot.z += p.strafe * -0.045 * (1 - ads * 0.6);
    pos.x += p.strafe * -0.006 * (1 - ads);
    // off the ground: it rides up a touch with the arms
    this.airT += ((p.grounded ? 0 : 1) - this.airT) * (1 - Math.exp(-7 * dt));
    pos.y += this.airT * 0.012 * (1 - ads);
    rot.x += this.airT * 0.05 * (1 - ads);

    // actions
    const a = this.action;
    if (m.rig) this.poseRig(m, dt);
    // (a pack with no drawing of its coming up is lifted into the picture the way a still model is)
    if (a && (!m.rig || ((a.name === 'equip' || a.name === 'unequip') && !m.rig.has('holster') && !m.rig.has('draw')))) {
      const k = Math.min(1, a.t / a.dur);
      const bell = Math.sin(k * Math.PI);
      if (a.name === 'equip') {
        const e = 1 - Math.pow(1 - k, 3);
        pos.y -= (1 - e) * 0.35;
        rot.x -= (1 - e) * 0.8;
      } else if (a.name === 'unequip') {
        pos.y -= k * k * 0.35;
        rot.x -= k * 0.8;
      } else if (a.name === 'bolt' && m.bolt && m.boltSlide) {
        // handle up (0-0.2), back (0.2-0.45), forward (0.45-0.7), down (0.7-0.9)
        const seg = (t0: number, t1: number) => THREE.MathUtils.smoothstep(k, t0, t1);
        const up = seg(0.05, 0.22) - seg(0.72, 0.9);
        const back = seg(0.22, 0.45) - seg(0.48, 0.7);
        if (k > 0.4 && a.data && !a.data.out) {
          a.data.out = 1;
          this.eject(m, true);
        }
        m.bolt.rotation.x = -up * 1.25;
        m.boltSlide.position.x = -back * 0.075;
        rot.z += bell * 0.28 * (1 - ads * 0.5);
        rot.x += bell * 0.05;
        pos.y -= bell * 0.015;
      } else if (a.name === 'reload') {
        const open = THREE.MathUtils.smoothstep(a.t, 0.1, 0.45) * (1 - THREE.MathUtils.smoothstep(a.t, a.dur - 0.45, a.dur - 0.1));
        if (m.bolt && m.boltSlide) {
          m.bolt.rotation.x = -open * 1.25;
          m.boltSlide.position.x = -Math.min(1, open * 1.4) * 0.075 * open;
        }
        const tilt = THREE.MathUtils.smoothstep(a.t, 0, 0.35) * (1 - THREE.MathUtils.smoothstep(a.t, a.dur - 0.35, a.dur));
        rot.z += tilt * 0.55;
        rot.x += tilt * 0.22;
        pos.add(new THREE.Vector3(-0.06, 0.03, 0.05).multiplyScalar(tilt));
        // a round slides into the action every 0.48 s
        if (m.round) {
          const local = (a.t - 0.55) % 0.48;
          m.round.visible = a.t > 0.55 && a.t < a.dur - 0.5 && local < 0.3;
          m.round.position.y = 0.05 - (local / 0.3) * 0.05;
        }
      } else if (a.name === 'magswap') {
        const long = m.kind === 'auto';
        const tilt = THREE.MathUtils.smoothstep(a.t, 0, 0.3) * (1 - THREE.MathUtils.smoothstep(a.t, a.dur - 0.3, a.dur));
        rot.z -= tilt * (long ? 0.6 : 0.45);
        rot.x += tilt * (long ? 0.18 : 0.3);
        pos.add(new THREE.Vector3(long ? -0.08 : -0.04, long ? 0.05 : 0.02, 0.06).multiplyScalar(tilt));
        if (m.mag) {
          const [o0, o1, i0, i1] = long ? [0.2, 0.55, 1.05, 1.35] : [0.1, 0.35, 0.75, 1.05];
          const out = THREE.MathUtils.smoothstep(a.t, o0, o1) * (1 - THREE.MathUtils.smoothstep(a.t, i0, i1));
          m.mag.position.y = -out * (long ? 0.24 : 0.18);
          // AK mags rock forward out of the well
          if (long && m.mag.children[0]) m.mag.children[0].rotation.z = out * 0.5;
          m.mag.visible = !(a.t > o1 && a.t < i0);
          if (!long && m.mag.children[0]) m.mag.children[0].visible = out > 0.04;
        }
        if (m.charging && long && a.dur > 2) {
          const pull = THREE.MathUtils.smoothstep(a.t, 1.8, 1.92) * (1 - THREE.MathUtils.smoothstep(a.t, 1.98, 2.08));
          m.charging.position.x = -pull * 0.085;
        }
      } else if (a.name === 'swing') {
        const wind = THREE.MathUtils.smoothstep(k, 0, 0.3);
        const strike = THREE.MathUtils.smoothstep(k, 0.3, 0.5);
        const recover = THREE.MathUtils.smoothstep(k, 0.55, 1);
        rot.x += (wind * 0.9 - strike * 2.0) * (1 - recover);
        rot.y += (wind * 0.4 - strike * 0.6) * (1 - recover);
        pos.add(new THREE.Vector3(-0.08 * strike, 0.08 * wind, -0.12 * strike).multiplyScalar(1 - recover));
      }
    } else {
      if (m.bolt) m.bolt.rotation.x = 0;
      if (m.boltSlide) m.boltSlide.position.x = 0;
      if (m.round) m.round.visible = false;
      if (m.mag) {
        m.mag.position.y = 0;
        if (m.mag.children[0] && m.kind === 'auto') m.mag.children[0].rotation.z = 0;
        m.mag.visible = true;
      }
    }

    // pistol slide: snaps back on fire, stays locked when empty
    this.slideKick = Math.max(0, this.slideKick - dt * 22);
    if (m.slide) {
      const back = this.chamberEmpty && (!a || a.name !== 'magswap' || a.t < a.dur - 0.35) ? 1 : this.slideKick;
      m.slide.position.x = -back * 0.028;
    }
    // AK bolt carrier: charging handle reciprocates with every shot
    if (m.charging && (!a || a.name !== 'magswap')) m.charging.position.x = -this.slideKick * 0.08;
    if (m.selector && this.currentItem) {
      const target = this.fireMode(this.currentItem) === 'auto' ? -0.012 : 0;
      m.selector.position.y += (target - m.selector.position.y) * (1 - Math.exp(-20 * dt));
    }

    if (m.hipRot) {
      rot.x += m.hipRot.x * (1 - ads);
      rot.y += m.hipRot.y * (1 - ads);
      rot.z += m.hipRot.z * (1 - ads);
    }

    // recoil
    pos.z += kick.z * 0.06;
    pos.y += kick.y * 0.02;
    rot.x += kr.x * 0.012;
    rot.z += kr.z * 0.01;

    // coming back up after using an item
    pos.y -= this.lowerT * 0.35;
    rot.x -= this.lowerT * 0.7;

    m.root.position.copy(pos);
    m.root.rotation.copy(rot);
    // scope view takes over once fully aimed down the PU scope
    m.root.visible = !this.scoped;
    // (a pack brings its own arms)
    if (m.rig) this.arms.update(null, null, this.vmCamera.quaternion, false);
    else this.arms.update(m.body ?? null, this.actionGrips(m), this.vmCamera.quaternion, !this.scoped);
  }

  /**
   * How a pack's gun comes up. A pistol's own drawing of it ends with the slide being racked,
   * a second and a half of it: right once, wrong every time a gun is changed. Its putting away
   * played backwards is the same lift without the rack.
   */
  private drawTime(rig: WeaponRig) {
    return rig.has('holster') ? rig.seconds('holster') * 1.15 : rig.has('draw') ? rig.seconds('draw') : 0.5;
  }

  /** A pack's gun: which of its movements it is in this frame, and how far through. */
  private poseRig(m: VmModel, dt: number) {
    const rig = m.rig!;
    const a = this.action;
    m.shotT = (m.shotT ?? 9) + dt;
    if (a) {
      const k = Math.min(1, a.t / a.dur);
      if (a.name === 'equip') rig.has('holster') ? rig.pose('holster', 1 - k) : rig.has('draw') ? rig.pose('draw', k) : rig.rest();
      else if (a.name === 'unequip') rig.has('holster') ? rig.pose('holster', k) : rig.has('draw') ? rig.pose('draw', 1 - k) : rig.rest();
      else if (a.name === 'bolt') rig.pose('bolt', k);
      else if (a.name === 'magswap') {
        rig.pose(a.data?.empty ? 'reloadEmpty' : 'reload', k);
        // (the pack's plain reload has the slide back for the middle of it, as if the gun had
        // run dry; with a round still in the chamber it stays shut)
        if (!a.data?.empty && m.kind === 'pistol') rig.still(['slide', 'stopper']);
      }
      else rig.rest();
      return;
    }
    const shot = m.shotClip ?? 'fire';
    const len = rig.seconds(shot);
    if (m.shotT < len) rig.pose(shot, m.shotT / len);
    // run dry, a pistol stays as its last shot left it: slide back
    else if (m.kind === 'pistol' && this.chamberEmpty && rig.has('fireLast')) rig.pose('fireLast', 1);
    // Standing with it: a slow breath. A pack's own drawing of this is a straight line out and a
    // straight line back once a second (the pistol tips seven degrees and comes back two
    // centimetres: it rocked like a chair). Its first half is the way out, so a part of that,
    // eased in and out over a few seconds, is the same movement at a size and a pace to live with.
    else if (rig.has('idle')) rig.pose('idle', 0.5 * IDLE.part * (0.5 - 0.5 * Math.cos((this.time * Math.PI * 2) / IDLE.every)) * (1 - this.adsT));
    else rig.rest();
  }

  /**
   * Something held to strike with. It stands the way its style says, and comes up across the
   * body on guard. A blow is the arm's doing: the forearm and the thing in the fist swing
   * round the elbow as one piece (the wrist is held firm, as it is in life), drawn back
   * slowly, brought through fast, carried on, and brought home.
   */
  private animateMelee(dt: number, m: VmModel, st: MeleeStyle) {
    const p = this.player;
    const a = this.action;
    this.guardHold = Math.max(0, this.guardHold - dt);
    const want = this.guardHold > 0 && !p.dead && !(a && a.name === 'swing') ? 1 : 0;
    this.guardT += (want - this.guardT) * (1 - Math.exp(-(want ? 16 : 9) * dt));
    const g = this.guardT;
    const pos = _mp.set(...st.idle.p);
    const quat = stanceQuat(st.idle, _mq);
    const elbow = _mel.set(...st.elbow);
    let pitch = 0, yaw = 0;
    // (The body's own drawn blow is not what is shown here: seen from its own eyes nearly all
    // of it passes outside the picture. The hands throw one made to be seen from the eye.)
    if (a && a.name === 'swing') {
      const k = Math.min(1, a.t / a.dur);
      const stroke = st.strokes[(a.data?.stroke ?? 0) % st.strokes.length];
      let i = 0;
      while (i < stroke.length && k >= stroke[i].at) i++;
      const from = i === 0 ? null : stroke[i - 1], to = i < stroke.length ? stroke[i] : null;
      const t0 = from?.at ?? 0, t1 = to?.at ?? 1;
      const u = THREE.MathUtils.clamp((k - t0) / (t1 - t0), 0, 1);
      // drawn back easing in and out; brought through gathering speed; carried on and brought home losing it
      const e = i === 0 ? THREE.MathUtils.smoothstep(u, 0, 1) : i === 1 ? u * u * (3 - 2 * u) * 0.35 + u * u * 0.65 : i === stroke.length ? THREE.MathUtils.smootherstep(u, 0, 1) : 1 - (1 - u) * (1 - u);
      const mix = (f: (s: Stroke[number]) => number) => THREE.MathUtils.lerp(from ? f(from) : 0, to ? f(to) : 0, e);
      pitch = mix((s) => s.pitch) * (Math.PI / 180);
      yaw = mix((s) => s.yaw) * (Math.PI / 180);
      elbow.x += mix((s) => s.by[0]);
      elbow.y += mix((s) => s.by[1]);
      elbow.z += mix((s) => s.by[2]);
    }
    {
      // The forearm as it rests, elbow to fist, and as it is swung: round and up from there.
      // What is in the fist turns exactly as the forearm does.
      const fore = _mv.copy(pos).sub(_mel2.set(...st.elbow));
      const len = fore.length();
      const round0 = Math.atan2(-fore.x, -fore.z), up0 = Math.asin(fore.y / len);
      const turned = (round: number, up: number, out: THREE.Quaternion) => out.setFromEuler(_me.set(up, round, 0, 'YXZ'));
      const swing = turned(round0 + yaw, up0 + pitch, _mq2).multiply(turned(round0, up0, _mq3).invert());
      pos.copy(fore.applyQuaternion(swing)).add(elbow);
      quat.premultiply(swing);
    }
    // Carried, it lies where its style rests it. For a blow the fists go at once to where it is
    // struck from; what is in them stays laid back while the arms are drawn up, and comes over
    // the top as they start down (the first blow of a run: one that comes back the other way
    // has it to hand before it is drawn across). It is laid back again as the arms come home.
    if (st.rest) {
      const swung = a && a.name === 'swing' ? Math.min(1, a.t / a.dur) : -1;
      this.readyT += ((swung >= 0 ? 1 : 0) - this.readyT) * (1 - Math.exp(-(swung >= 0 ? 24 : 7) * dt));
      if (swung < 0) this.cockT += (1 - this.cockT) * (1 - Math.exp(-7 * dt));
      else if (swung < 0.5) this.cockT = Math.min(this.cockT, 1 - ((a!.data?.stroke ?? 0) % st.strokes.length === 0 ? THREE.MathUtils.smoothstep(swung, 0.1, 0.34) : THREE.MathUtils.smoothstep(swung, 0, 0.12)));
      else this.cockT = Math.max(this.cockT, THREE.MathUtils.smoothstep(swung, 0.66, 1));
      if (this.readyT < 0.999) pos.lerp(_mv.set(...st.rest.p), 1 - this.readyT);
      if (this.cockT > 0.001) quat.slerp(stanceQuat(st.rest, _mq2), this.cockT);
    } else {
      this.readyT = 0;
      this.cockT = 1;
    }
    // on guard it is put across in front, whatever the arm was doing
    if (g > 0.001) {
      pos.lerp(_mv.set(...st.guard.p), g);
      quat.slerp(stanceQuat(st.guard, _mq2), g);
      elbow.lerp(_mv.set(st.elbow[0] + 0.03, st.elbow[1] + 0.02, st.elbow[2] + 0.02), g);
    }
    // the walk, the breath, and a run with it carried low
    const amp = p.movingSmooth * (p.grounded ? 1 : 0) * (1 - g * 0.5);
    const ph = p.bobPhase;
    const sp = this.sprintT * (a ? 0 : 1);
    const kick = this.kick.step(dt);
    const kr = this.kickRot.step(dt);
    _mv.set(Math.cos(ph) * 0.012 * amp + 0.03 * sp, -Math.abs(Math.sin(ph)) * 0.016 * amp + Math.sin(this.time * 1.6) * 0.002 - 0.09 * sp + kick.y * 0.02 - this.lowerT * 0.4, kick.z * 0.06);
    // brought up from below, and put away there
    let down = 0;
    if (a && (a.name === 'equip' || a.name === 'unequip')) {
      const k = Math.min(1, a.t / a.dur);
      down = a.name === 'equip' ? Math.pow(1 - k, 3) : k * k;
      _mv.y -= down * 0.4;
    }
    pos.add(_mv);
    elbow.add(_mv);
    // (what the arms have just taken: a blow landed, or one stopped)
    quat.premultiply(_mq2.setFromEuler(_me.set(-0.35 * sp + Math.cos(ph) * 0.02 * amp + kr.x * 0.012 - down * 0.9, 0.25 * sp, 0.3 * sp + Math.cos(ph) * 0.025 * amp + kr.z * 0.01, 'XYZ')));
    m.root.position.copy(pos);
    m.root.quaternion.copy(quat);
    m.root.visible = true;
    // The forearm lies from the elbow to the fist: said to the arms in the thing's own space,
    // which is where they are told everything. (The whole arm is drawn: thrown out at the end
    // of a blow, a forearm alone was a sleeve with a hole in the near end.)
    const grips = m.grips ?? null;
    if (grips?.right && m.body) {
      m.root.updateMatrixWorld(true);
      grips.right.elbow = m.body.worldToLocal((grips.right.elbow ?? new THREE.Vector3()).copy(elbow).applyMatrix4(this.vmCamera.matrixWorld));
    }
    this.arms.update(m.body ?? null, grips, this.vmCamera.quaternion, true, true);
  }

  /**
   * Bare hands, driven through the same arm IK as weapons: a boxer's guard that comes up to
   * punch or block, a jab from the left that leads and a cross from the right behind it.
   */
  private animateFists(dt: number) {
    const p = this.player;
    this.guardHold = Math.max(0, this.guardHold - dt);
    const want = this.guardHold > 0 && !p.dead ? 1 : 0;
    this.guardT += (want - this.guardT) * (1 - Math.exp(-(want ? 14 : 6) * dt));
    const g = this.guardT;
    if (g < 0.02) {
      this.arms.update(null, null, this.vmCamera.quaternion, false);
      return;
    }
    const bobA = p.movingSmooth * (p.grounded ? 1 : 0);
    const ph = p.bobPhase;
    const bob = new THREE.Vector3(Math.cos(ph) * 0.01 * bobA, -Math.abs(Math.sin(ph)) * 0.012 * bobA + Math.sin(this.time * 1.7) * 0.003, 0);
    const lerp3 = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);
    // the punch in the air: whose it is, how far out it is, and how far it is drawn back first
    let thrown = 0, out = 0, wind = 0;
    const a = this.action;
    if (a && a.name === 'punch' && a.data) {
      const k = Math.min(1, a.t / a.dur);
      thrown = a.data.hand ? 1 : -1;
      // Drawn back a touch, thrown fast (it lands at 0.28 of the way through, see the action
      // timeline), held a moment on the end of the arm and brought home slower than it went.
      wind = Math.sin(Math.PI * Math.min(1, k / 0.14));
      const go = THREE.MathUtils.clamp((k - 0.06) / 0.22, 0, 1);
      out = (1 - Math.pow(1 - go, 3)) * (1 - THREE.MathUtils.smootherstep(k, 0.42, 1));
    }
    const hand = (side: 1 | -1): HandGrip => {
      const strike = side === thrown ? out : 0;
      const down = new THREE.Vector3(side * 0.23, -0.58, -0.22);
      // orthodox stance: the left leads, the right sits back by the chin
      const guard = side > 0 ? new THREE.Vector3(0.14, -0.175, -0.4) : new THREE.Vector3(-0.125, -0.16, -0.46);
      // (where the wrist ends up: the fist is a hand's length on from it and the shoulders turn
      // behind it, and it is the fist that has to land on the middle of the picture)
      const end = side > 0 ? new THREE.Vector3(0.06, -0.085, -0.66) : new THREE.Vector3(-0.055, -0.08, -0.64);
      const pos = lerp3(lerp3(down, guard, g), end, strike).add(bob);
      if (side === thrown) pos.add(new THREE.Vector3(side * 0.015, -0.012, 0.035).multiplyScalar(wind * (1 - out)));
      // the other fist is drawn back and aside as the shoulders turn behind the punch: out of the way of what is being hit
      else if (thrown) pos.add(new THREE.Vector3(side * 0.04, -0.03, 0.05).multiplyScalar(out));
      // In the guard the fists stand up either side of the middle of the picture (see `fists`
      // for which way they are turned and why). Thrown, the fist turns over, palm down, and the
      // arm is seen along its length from behind.
      const F = this.fists;
      const fingers = lerp3(new THREE.Vector3(-side * F.fingers[0], F.fingers[1], F.fingers[2]), new THREE.Vector3(-side * 0.08, 0.2, -0.97), strike).normalize();
      const palm = lerp3(new THREE.Vector3(-side * F.palm[0], F.palm[1], F.palm[2]), new THREE.Vector3(-side * 0.22, -0.96, -0.1), strike).normalize();
      return { pos, fingers, palm, curl: F.curl, fold: F.fold, thumb: F.thumb, tuck: F.tuck };
    };
    this.kick.step(dt);
    const kr = this.kickRot.step(dt);
    this.fistAnchor.position.set(0, 0, 0);
    // the shoulders turn into it: more behind the cross than the jab
    this.fistAnchor.rotation.set(kr.x * 0.004, thrown * (thrown > 0 ? 0.07 : 0.05) * out, -thrown * 0.03 * out);
    // (the whole arm is drawn: thrown out with the forearm alone, a punch was a sleeve with a hole in the near end)
    this.arms.update(this.fistAnchor, { right: hand(1), left: hand(-1) }, this.vmCamera.quaternion, true, true);
  }

  /** Item in use: brought up from below, worked on (bites, sips, wraps), then put away. */
  private animateHeld(dt: number) {
    const h = this.held!;
    h.t += dt;
    if (h.ending) h.ending += dt;
    const enter = THREE.MathUtils.smoothstep(h.t, 0, 0.3);
    const exit = h.ending ? THREE.MathUtils.smoothstep(h.ending, 0, 0.22) : 0;
    const up = enter * (1 - exit);
    if (h.ending > 0.24) {
      this.vmRoot.remove(h.root);
      this.held = null;
      this.arms.update(null, null, this.vmCamera.quaternion, false);
      return;
    }
    const t = h.t;
    // bigger things are held a little further out so the hand and the item both stay in frame
    const sy = h.size.y;
    const wide = Math.min(h.size.x, h.size.z);
    const H = HOLD;
    const pos = new THREE.Vector3(H.rest[0] + wide * H.restBy[0], H.rest[1] + sy * H.restBy[1], H.rest[2] + sy * H.restBy[2]);
    const rot = new THREE.Euler(0, 0, 0);
    const two = h.kind === 'bandage' || h.kind === 'inject' || h.kind === 'open' || (h.kind !== 'smoke' && Math.min(h.size.x, h.size.z) > 0.16);
    // a smoke: how near the mouth it is (0 held low, 1 at the lips)
    let drawn = -1;
    // an injection: where the left hand is held out to take it (in the eye's space), and how far the shot has gone in
    let offered: { pos: THREE.Vector3; elbow: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3; clench: number } | null = null;
    if (h.kind === 'eat' || h.kind === 'drink') {
      // up to the mouth and back, once per bite / gulp
      const period = h.kind === 'eat' ? 0.95 : 1.25;
      const cyc = 0.5 - 0.5 * Math.cos((Math.max(0, t - 0.3) / period) * Math.PI * 2);
      const m = h.kind === 'drink' ? Math.pow(cyc, 0.6) : cyc;
      pos.lerp(new THREE.Vector3(H.mouth[0], H.mouth[1] + sy * H.mouthBy[0], H.mouth[2] + sy * H.mouthBy[1]), m * 0.92);
      rot.x = (h.kind === 'drink' ? H.tilt.drink : H.tilt.eat) * m;
      rot.z = -0.15 * m;
    } else if (h.kind === 'bandage') {
      // A kit, open in the left hand, low and to the left. The right goes into it, comes out
      // and goes down out of the picture to where the wound is, and comes back for more.
      // (It was a roll of dressing once, wound round and round: the kit, which is a foot
      // wide, was wound round and round in front of the face and filled half the picture.)
      const across = Math.max(h.size.x, h.size.z);
      pos.set(H.kit[0], H.kit[1] + sy * H.kitBy[0] + Math.sin(t * 2.3) * 0.004, H.kit[2] + across * H.kitBy[1]);
      rot.set(H.kitTurn[0], H.kitTurn[1], H.kitTurn[2] + Math.sin(t * 1.7) * 0.02);
    } else if (h.kind === 'smoke') {
      // Two draws on it. Each: up to the mouth (which is under the bottom of the picture: it
      // goes most of the way out of sight), held there while the coal brightens, and let down
      // again to hang from the fingers while the smoke is breathed out. The sounds, in
      // audio.ui, keep the same time.
      const every = SMOKE.every(h.dur);
      const w = Math.max(0, t - SMOKE.lift) / every;
      const k = w - Math.floor(w);
      drawn = w >= 2 ? 0 : THREE.MathUtils.smoothstep(k, 0, 0.2) * (1 - THREE.MathUtils.smoothstep(k, 0.58, 0.8));
      pos.lerpVectors(SMOKE.low, SMOKE.lips, drawn);
      rot.set(THREE.MathUtils.lerp(0.55, 0.1, drawn), THREE.MathUtils.lerp(-0.55, -0.1, drawn), THREE.MathUtils.lerp(0.15, 0, drawn));
      const coal = h.coal!.material as THREE.MeshBasicMaterial;
      const lit = 0.35 + 0.65 * THREE.MathUtils.smoothstep(k, 0.22, 0.4) * (1 - THREE.MathUtils.smoothstep(k, 0.55, 0.62)) * (w < 2 ? 1 : 0);
      coal.color.setRGB(0.5 + 4.2 * lit, 0.12 + 0.95 * lit, 0.03 + 0.12 * lit);
      // what comes off it: a thread from the coal all the while, and a breath of it after each draw
      const cam = this.mainCam;
      if (cam && enter > 0.9 && !exit) {
        const out = (v: THREE.Vector3) => this.toWorld(v, cam);
        h.wispT = (h.wispT ?? 0) - dt;
        if (h.wispT <= 0 && drawn < 0.5) {
          h.wispT = 0.16;
          this.fx.wisp(out(new THREE.Vector3(0, 0, -0.043).applyEuler(rot).add(pos)));
        }
        if (Math.floor(w + 0.14) > (h.puffs ?? 0) && w < 2.2) {
          h.puffs = Math.floor(w + 0.14);
          this.fx.muzzle(out(new THREE.Vector3(0, -0.075, -0.16)), new THREE.Vector3(0, -0.12, -1).applyQuaternion(cam.quaternion), true, true);
        }
      }
    } else if (h.kind === 'inject') {
      // The left forearm is stood up in the picture and its fist made. The right fist brings the
      // injector to it from the right, draws back and drives it in; the arm gives under it; it
      // is held there while it empties, and taken away. (What was here before aimed at where
      // the forearm would be if it lay level, and it does not: the shot was given to the air a
      // hand's breadth above the sleeve, and seen end on besides.)
      const seg = (a: number, b: number) => THREE.MathUtils.smoothstep(t, a, b);
      const I = INJECT;
      const down = I.down.clone().normalize();
      const leave = seg(h.dur - 0.3, h.dur - 0.02);
      const shown = seg(0.04, 0.4) * (1 - leave);
      // the blow landing: the arm goes with it and comes back
      const since = t - I.hit;
      const give = since > 0 ? Math.exp(-since * 11) * Math.cos(since * 17) * 0.012 : 0;
      const moved = new THREE.Vector3(0, -(1 - shown) * 0.34, 0).addScaledVector(down, give);
      const elbow = I.elbow.clone().add(moved), wrist = I.wrist.clone().add(moved);
      const along = wrist.clone().sub(elbow).normalize();
      const clench = seg(0.42, 0.8) * (1 - 0.6 * seg(I.hit + 0.4, I.hit + 0.9));
      offered = { pos: wrist, elbow, fingers: along, palm: I.palm, clench };
      // where it goes in: up the forearm from the wrist, on the side of the sleeve that is turned to the injector
      const out = down.clone().negate();
      out.addScaledVector(along, -out.dot(along)).normalize();
      const mark = wrist.clone().lerp(elbow, I.at).addScaledVector(out, I.skin);
      // how far off the sleeve its nose is: brought over, drawn back, driven in, held, taken away
      const drive = THREE.MathUtils.clamp((t - (I.hit - 0.1)) / 0.1, 0, 1);
      const away = seg(I.hit + 0.85, I.hit + 1.1);
      const gap = THREE.MathUtils.lerp(0.12, 0.06, seg(0.35, 0.72)) + 0.03 * seg(I.hit - 0.3, I.hit - 0.1) - (0.09 + I.sunk) * drive * drive + away * (0.11 + I.sunk);
      // (the spring going, a moment after it lands: the barrel jumps in the fist)
      const sprung = t - (I.hit + 0.12);
      const jump = sprung > 0 ? Math.exp(-sprung * 26) * 0.0035 : 0;
      const tremble = drive * (1 - away) * Math.sin(t * 33) * 0.0009;
      pos.copy(mark).addScaledVector(down, -(h.size.z / 2 + gap + jump + tremble));
      // (it comes in from low on the right, and goes back there)
      pos.add(new THREE.Vector3(0.05, -0.05, 0.03).multiplyScalar(1 - seg(0.25, 0.75) + away * 0.6));
      pos.y -= leave * 0.34;
      // (the model lies along z, nose to -z)
      rot.setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), down));
    } else {
      pos.set(H.work[0], H.work[1] + sy * H.workBy[0] + Math.sin(t * 9) * 0.004, H.work[2] + sy * H.workBy[1]);
      rot.set(0.45, 0.25 + Math.sin(t * 4.5) * 0.05, 0);
    }
    pos.y -= (1 - up) * 0.4;
    h.root.position.copy(pos);
    h.root.rotation.copy(rot);
    h.root.visible = true;
    const half = Math.min(h.size.x, h.size.z) / 2;
    const reach = Math.min(1, half / 0.06);
    const curl = THREE.MathUtils.lerp(1.25, 0.75, reach);
    const grip = (side: 1 | -1): HandGrip => ({
      pos: new THREE.Vector3(side * (half + 0.035), -h.size.y * 0.15, 0.055),
      fingers: new THREE.Vector3(-side * 0.35, 0.2, -0.9),
      palm: new THREE.Vector3(-side, 0, 0),
      curl: [curl, curl + 0.05, curl + 0.1, curl + 0.15],
      thumb: 0.5,
    });
    let right = grip(1);
    let left: HandGrip | null = two ? grip(-1) : null;
    // between the first two fingers, near the filter, the hand under it and its palm to the face
    if (drawn >= 0) right = { pos: new THREE.Vector3(-0.009, -0.168, 0.05), fingers: new THREE.Vector3(0, 0.97, -0.24), palm: new THREE.Vector3(0, 0.24, 0.97), curl: [0.08, 0.12, 1.0, 1.1], thumb: 0.55 };
    if (offered) {
      // Both hands are said in the eye's space and turned into the injector's own, which is what
      // the arms are posed in. The right is a fist round the barrel, thumb at the end that is
      // pressed: the barrel runs through the middle of it, so the wrist is set that far behind
      // it (set down beside the barrel, the fist closed on nothing next to it).
      const I = INJECT;
      const inv = h.root.quaternion.clone().invert();
      const up = I.down.clone().normalize().negate();
      const fingers = I.fingers.clone();
      fingers.addScaledVector(up, -fingers.dot(up)).normalize();
      const palm = new THREE.Vector3().crossVectors(up, fingers);
      const holdAt = up.clone().multiplyScalar(I.held).addScaledVector(fingers, -I.fist[0]).addScaledVector(palm, -I.fist[1]);
      right = { pos: holdAt.applyQuaternion(inv), fingers: fingers.applyQuaternion(inv), palm: palm.applyQuaternion(inv), curl: I.curl, thumb: 0.85, tuck: 0.35 };
      const c = THREE.MathUtils.lerp(0.4, 1.3, offered.clench);
      left = {
        pos: offered.pos.clone().sub(h.root.position).applyQuaternion(inv),
        elbow: offered.elbow.clone().sub(h.root.position).applyQuaternion(inv),
        fingers: offered.fingers.clone().applyQuaternion(inv),
        palm: offered.palm.clone().applyQuaternion(inv),
        curl: [c, c + 0.03, c + 0.06, c + 0.1],
        fold: [1.05, 1.0, 0.5],
        thumb: 0.6,
        tuck: 0.55 * offered.clench,
      };
    }
    if (h.kind === 'bandage') {
      // in and out of the kit, once every second and a half: over it with the fingers down, then away low on the right
      const k = (t % 1.5) / 1.5;
      const inKit = THREE.MathUtils.smoothstep(k, 0.02, 0.24) * (1 - THREE.MathUtils.smoothstep(k, 0.5, 0.74));
      const inv = h.root.quaternion.clone().invert();
      const away = new THREE.Vector3(0.2, -0.4, -0.3).sub(h.root.position).applyQuaternion(inv);
      const over = new THREE.Vector3(0.03 + Math.sin(t * 11) * 0.02 * inKit, h.size.y * 0.5 + 0.06, 0.05 + Math.cos(t * 7) * 0.015 * inKit);
      right = { pos: away.lerp(over, inKit), fingers: new THREE.Vector3(-0.45, -0.55, -0.7), palm: new THREE.Vector3(-0.1, -1, 0.1), curl: [0.5 + inKit * 0.3, 0.6 + inKit * 0.3, 0.75, 0.85], thumb: 0.7, spread: 0.55 };
      // (the left has the far edge of it, from underneath)
      left = { pos: new THREE.Vector3(-(h.size.x / 2 + 0.03), -h.size.y * 0.5 - 0.02, 0.07), fingers: new THREE.Vector3(0.55, 0.25, -0.8), palm: new THREE.Vector3(0.3, 0.95, 0), curl: [0.5, 0.55, 0.6, 0.65], thumb: 0.3 };
    }
    if (h.kind === 'open') {
      // left hand holds the box, right hand pries the latch on top
      const w = 0.5 + 0.5 * Math.sin(t * 6);
      right = {
        pos: new THREE.Vector3(half + 0.06, h.size.y * 0.5 + 0.035 + w * 0.02, 0.07),
        fingers: new THREE.Vector3(-0.75, -0.25, -0.6),
        palm: new THREE.Vector3(-0.2, -1, 0),
        curl: [0.5 + w * 0.3, 0.6 + w * 0.3, 0.9, 1.0],
        thumb: 0.4,
      };
    }
    this.arms.update(h.root, { right, left }, this.vmCamera.quaternion, true);
  }
}
