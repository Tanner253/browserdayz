// Gunplay: viewmodel (own scene/camera), procedural animation (equip, bob, sway,
// recoil springs, bolt cycling, reloads), ballistics with gravity + drag simulated
// in sub-steps against the physics world, zeroing, scope + iron sights, melee.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { physics, SHOT_GROUPS, type Surface } from '../core/physics';
import { CRACK, audio } from '../core/audio';
import type { Input } from '../core/input';
import { extractParts, type MeshPart } from '../core/gltf-utils';
import { ITEMS, isBag, capacityOf, chambered, fittedOf, handlingOf, hasMod, magFits, magRoom, nextMag, pieceShown, swapMag, type ItemInstance, type Slot, quietOf } from '../sim/items';
import { suppressorGeometry } from './procedural';
import { SLOT_ORDER, type PlayerInventory } from '../sim/inventory';
import type { Atmosphere } from '../world/atmosphere';
import type { Player } from './player';
import type { Effects } from './effects';
import { MuzzleFlash, muzzleArt } from './muzzle';
import { WeaponRig, liftPack } from './rig';
import { type Curl, FPArms, type Grips, type HandGrip, mixCurl } from './arms';
import type { Look } from './look';
import { MAX_STAMINA } from '../net/protocol';
import { GRAVITY, GUNS, QUIETED, SOUND, anywhereIn, coneOf, cooled, crackOf, damageKept, elevationFor, intervalOf, kickOf, scatterOf, shotOf, zeroOf } from '../sim/gunplay';
import type { ItemModels } from './loot';

import { ownHit } from '../sim/combat';
import { roundsSpent } from '../sim/powers';
export type HitZone = 'head' | 'torso' | 'legs' | 'arms';
/** damage multiplier per hit zone: bullets / melee */
const ZONE_MULT: Record<HitZone, [number, number]> = { head: [3.2, 1.6], torso: [1, 1], legs: [0.6, 0.7], arms: [0.6, 0.7] };
// ('live': a grenade with its pin out, in the one fist that is about to throw it: see LIVE)
export type UseKind = 'eat' | 'drink' | 'bandage' | 'inject' | 'smoke' | 'open' | 'swipe' | 'load' | 'unload' | 'unbox' | 'live' | 'drip';
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

/** Is its bolt worked by hand after every shot? (a rifle's is, unless the gun says it loads itself) */
function boltAction(id: string): boolean {
  const w = ITEMS[id]?.weapon;
  return !!w && (w.action ? w.action === 'bolt' : w.kind === 'rifle');
}

/**
 * Where what is fitted from another model sits on each gun, in the gun's own space (x toward
 * the muzzle, y up, z to its right; metres, from the gun's own origin), and how big it is
 * drawn. Set by eye, in the hands and on somebody else.
 *   dot   - the holographic sight: where its foot stands. On a pistol it rides the slide.
 *   light - the weapon light: how far along the gun it hangs, and where across it. How high is
 *           found: the underside of the gun at that place is what its top is set against (y
 *           here is added to that).
 */
const FIT: Record<string, { dot?: { at: [number, number, number]; size: number }; /** the Elcan, the AR-15's own magnified sight: where its foot stands on the rail */ elcan?: { at: [number, number, number]; size: number }; light?: { at: [number, number, number]; size: number; /** how high the gun's underside is where the light hangs (measured off the model: looked for there, where it is not said) */ under?: number; /** clamped to the gun's right side and not hung under it: `at` is then where its foot meets that side, at the height of its middle */ side?: boolean }; /** the foregrip, which is the AR-15's own taken off its rifle: where the middle of its top meets the rail under this gun */ grip?: { at: [number, number, number]; size: number }; /** magazines that are models of their own, not a piece of the gun's: which, where its top goes (hung by it), how big, and turned how far about the upright */ mags?: Record<string, { model: string; at: [number, number, number]; size: number; turn?: number }>; /** a suppressor out of a model of its own, screwed onto the mouth of the barrel */ can?: { model: string; size: number }; /** how far down its slide a pistol's barrel lies, as a share of the slide's height (0.42 where not said) */ bore?: number }> = {
  // (The undersides are measured off each model. Looked for by rule, the M9's was not found at
  // all and the other pistol's was its trigger guard: both lights hung in the air under the gun.)
  m9: { dot: { at: [0.045, 0.0835, 0.0035], size: 0.5 }, light: { at: [0.167, 0, 0.0035], size: 0.62, under: 0.046 } },
  // (the Colt: the sight on the flat of its slide ahead of its rear sight, the light under its dust cover ahead of the guard)
  colt: { dot: { at: [0.05, 0.094, 0], size: 0.5 }, light: { at: [0.135, 0, 0], size: 0.62 }, bore: 0.45 },
  // (under the end of the fore-stock: under the bare barrel ahead of it there is nothing to hang it on, and it hung in the air)
  mosin: { light: { at: [0.27, 0, -0.0145], size: 0.85, under: 0.02 } },
  benelli: { light: { at: [0.234, 0, -0.017], size: 0.95, under: -0.018 } },
  // (The AK: the sight on its top cover, behind its own rear sight, which it looks over; bigger than on a pistol,
  // a rifle's size. Its drum where its magazine goes, by the top of its tower. A drum's rounds lie along its
  // axle, so its flat faces look along the barrel, the one with the winding key to the front, and it stands out
  // either side of the rifle; it comes leaning, its foot forward, as the rifle's own magazine hangs.)
  // (And its light under the barrel, a hand's width ahead of the fore-end, clamped to the rod that lies there: the
  // hand that holds the rifle up has the fore-end itself.)
  ak: { dot: { at: [-0.095, 0.1062, 0.0012], size: 0.85 }, light: { at: [0.27, 0, 0.001], size: 0.85 }, mags: { drum_ak: { model: 'ak_drum', at: [-0.035, 0.0678, 0.0015], size: 1, turn: Math.PI / 2 } }, can: { model: 'rifle_suppressor', size: 1 } },
  // (the long magazine lies across its file, its foot to the back: turned a quarter, to hang along the gun with its foot forward)
  ar15: { mags: { mag_ar_60: { model: 'ar_mag_60', at: [-0.042, 0.0678, 0.0015], size: 1, turn: -Math.PI / 2 } }, elcan: { at: [-0.045, 0.0989, 0.0011], size: 1 } },
  // (The submachine gun: the sight on the rail along its top. Its light is on the rail down the right side of its
  // fore-end, high and well forward: hung under the fore-end, where it was first put by the figures alone, it was
  // inside the left hand, which holds the gun there. Looked at 2026-10-11.)
  // (And a foregrip, 2026-10-11, asked: "it can handle a grip and flashlight too since it has rails". It is on the
  // rail under the fore-end at its very front, ahead of the left hand, which holds the fore-end itself: a stop for
  // that hand, as is put on a gun this short. Further back it was inside the fist.)
  mpa: { dot: { at: [0.035, 0.082, -0.003], size: 0.8 }, light: { at: [0.197, 0.066, 0.025], size: 0.62, side: true }, grip: { at: [0.213, 0.021, -0.003], size: 0.65 } },
  // (the big pistol: under its barrel, ahead of the guard, as on the other two)
  deagle: { light: { at: [0.185, 0, 0.0035], size: 0.62 } },
};
/**
 * A gun looked over (I) that has no such movement drawn in its pack: how long it takes, when in that it is turned
 * from its one side to the other (a share of the whole), how long each turn takes, how far it is brought before the
 * eye (metres: right, up, toward), and how it is turned for each side (radians: muzzle up, muzzle to the left, top
 * to the left).
 */
const LOOK_OVER = {
  dur: 2.6, turn: 0.46, ease: 0.42,
  long: { at: [-0.035, 0.03, 0.02], first: [0.16, 0.36, -0.3], second: [0.2, -0.1, 0.42] },
  // (The AK's pack, which the AR-15 is held in too. Its sleeves end not far below the picture: turned top to the
  // right at all, the end of the left one came up into it. So it is only ever turned top to the left: a little, with
  // the muzzle up and across, and then well over.)
  auto: { at: [-0.02, 0, -0.03], first: [0.1, 0.17, 0.16], second: [0.08, -0.05, 0.36] },
};
/** the pieces of a gun that come from another model, and what has to be fitted for each to be there */
const EXTRA: Record<string, string> = { suppressor: 'suppressor_9', red_dot: 'red_dot', gun_light: 'gun_light' };

interface Bullet {
  /** someone else's bullet has already been heard going past */
  heard?: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  drag: number;
  damage: number;
  /** the speed it left the barrel at: what it does when it lands goes by how much of that it has left */
  v0: number;
  life: number;
  travelled: number;
  weapon: string;
  /** someone else's bullet: flies and lands for show, the shooter's own game decides what it hit */
  ghost?: boolean;
  /** fired through a suppressor (the sniper rifle's figures are not the same quieted: see RIFLE_HITS) */
  quiet?: boolean;
  /** whose it is, when it is somebody else's: it does not land on the body it came out of */
  from?: unknown;
  /** the thin thing it last went through (a curtain, a door of boards): its hole is made there once */
  through?: unknown;
}

const _toCam = new THREE.Vector3();
const _cardV = new THREE.Vector3();

/**
 * A shell's pellet: the line of its shot (one long), thrown somewhere in a round cone `across` radians wide
 * about that line, as likely in any part of it as in any other. (Each was thrown into a box, three numbers each
 * its own way: a pattern with corners to it, wider from corner to corner than from side to side, and not the
 * same shape fired north as fired north-east.)
 */
function strewn(line: THREE.Vector3, across: number): THREE.Vector3 {
  // (two ways square to the line and to each other: any two, a cone being round)
  const side = new THREE.Vector3(0, 1, 0);
  if (Math.abs(line.y) > 0.9) side.set(1, 0, 0);
  side.cross(line).normalize();
  const over = new THREE.Vector3().crossVectors(line, side);
  const off = Math.tan(anywhereIn(across, Math.random())), round = Math.random() * Math.PI * 2;
  return line.clone().addScaledVector(side, Math.cos(round) * off).addScaledVector(over, Math.sin(round) * off).normalize();
}

/** critically-damped-ish spring for procedural motion */
class Spring {
  v = new THREE.Vector3();
  x = new THREE.Vector3();
  constructor(public k = 160, public d = 16) {}
  step(dt: number, target = new THREE.Vector3()) {
    // Taken in steps short enough to stay stable. Taken whole, a tenth of a second (which is what a frame is
    // counted as when it hitches, or at ten frames a second on a hot laptop) is past what these springs bear:
    // each such step threw the gun further than the last, and it left the picture until the frames came back.
    const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = target.clone().sub(this.x).multiplyScalar(this.k).addScaledVector(this.v, -this.d);
      this.v.addScaledVector(a, h);
      this.x.addScaledVector(this.v, h);
    }
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
  /** a long gun with sights of its own to aim along when it has no optic (the shotgun): no cross is drawn over them */
  ownSights?: boolean;
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
  /** the lit marks of its sights: drawn only when the gun is at the eye */
  marks?: THREE.Object3D[];
  /** the rounds drawn in the mouth of its magazine, and of the fresh one of a reload: there when the magazine has that many (see `roundsOf`) */
  rounds?: { piece: THREE.Object3D; fresh: boolean; nth: number }[];
  /** everything on it that is only there with something fitted: [what is drawn, the attachment it goes with] */
  shown?: [THREE.Object3D, string][];
  /** aim position without an optic */
  adsIron?: THREE.Vector3;
  /** how far the gun is turned as it comes to the eye, where its pack holds it turned in at the hip: the line of its sights made the line of sight */
  aimRot?: THREE.Euler;
  /** the same with its own sight fitted, where that is squared another way (see `opticRot` in packGun) */
  aimRotOptic?: THREE.Euler;
  /**
   * Two guns, one in each hand (the akimbo packs: the owner, "akimbo weapons are shot with left and right click
   * controlling their respective hands"): the left one's flash and where its muzzle is (the right one's are `flash`
   * and `muzzle`), what of the pack moves with each hand as it fires, and how long since each fired.
   */
  twin?: { flash: MuzzleFlash; muzzle: THREE.Vector3; roots: { L: string[]; R: string[] }; shotT: { L: number; R: number } };
  /** the attachment that is its optic: with it on, `ads` is where the eye goes; without, `adsIron` */
  optic?: string;
  /** the front of its weapon light, in the body's space (the beam starts there) */
  lamp?: THREE.Vector3;
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
  /** a pistol in a pack whose bolt is its slide: the joint that is */
  slideOn?: string;
  /** its hammer, where that is let down when the slide is home (see HAMMER): the piece, where it turns (the space the piece is in), how far down */
  hammer?: { piece: THREE.Object3D; at: THREE.Vector3; down: number };
  /** arms of the pack's that are put elsewhere than they were drawn (see WeaponRig.reseat): the joint the gun's body follows, and for each arm where its hand goes on this gun and where its shoulder goes */
  reseat?: { body: string; L?: Reseat; R?: Reseat };
  /** the pack's own walk and run are played under it as it is carried (and the game's own swing of a carried gun is not) */
  gait?: boolean;
  /** what is fast to the gun whatever the hands are doing short of a reload (see WeaponRig.mix): the joint its body follows, and the joints of its magazine and the hand on its grip */
  fast?: { body: string; to: string[] };
}

type Reseat = { move?: THREE.Vector3; turn?: THREE.Quaternion; shoulder?: THREE.Vector3 };
type Action = { name: 'equip' | 'unequip' | 'bolt' | 'reload' | 'swing' | 'magswap' | 'use' | 'punch' | 'check'; t: number; dur: number; done?: () => void; data?: Record<string, number> };

/**
 * Where each pack is held from: the eye, in the pack's space as the pipeline turns it
 * (x right, y up, metres; the muzzle points away down -z). Tuned by eye, like every other
 * hip position here.
 */
const HELD = {
  sniper: new THREE.Vector3(0.14, -0.22, -0.36),
  m9: new THREE.Vector3(0.095, -0.135, -0.31),
  // (The AK's pack came with its own camera, 0.147 over its own origin, drawn for a wider picture than the game's:
  // put there, the rifle filled the right half of it. It is held a little lower, further off and to the right.)
  ak: new THREE.Vector3(0.05, -0.17, -0.12),
  // (the submachine gun's pack, by the same maker on the same arms: its own camera stands where the AK's does)
  smg: new THREE.Vector3(0.05, -0.17, -0.12),
  // (a pistol in those hands: a little nearer the middle and higher, where a pistol is held out)
  smgPistol: new THREE.Vector3(0.035, -0.16, -0.12),
  // (the Scorpion's pack, on arms of its own, its camera at its eye: held as the submachine gun is to begin with)
  // (nearer than the submachine gun's pack holds its gun: our arms, not the pack's, reach for it, and from where they hold the MPA)
  scorpion: new THREE.Vector3(0.05, -0.02, 0),
  mp7a1: new THREE.Vector3(0.05, -0.02, -0.1),
  aks74u: new THREE.Vector3(0.05, -0.02, 0.08),
  db12: new THREE.Vector3(0.05, -0.02, -0.05),
  // (that maker's packs stand their camera half a metre behind where they are put: as the sniper's)
  dual_smg: new THREE.Vector3(0, -0.02, -0.36),
  dual_mac10: new THREE.Vector3(0, -0.02, -0.36),
  dual_sawnoff: new THREE.Vector3(0, -0.04, -0.38),
  sniper50: new THREE.Vector3(0.14, -0.22, -0.36),
  barrett: new THREE.Vector3(0.14, -0.22, -0.36),
  vssk: new THREE.Vector3(0.14, -0.22, -0.36),
  m32: new THREE.Vector3(0.14, -0.22, -0.36),
  // (the knife's pack: the sniper's maker's, on the same arms, drawn for an eye a hand over the shoulders and a little ahead of them)
  knife: new THREE.Vector3(0, -0.16, -0.34),
  pitchfork: new THREE.Vector3(0.05, -0.02, -0.05),
};

/**
 * A pistol in the submachine gun's hands (2026-10-11: "this will apply to all pistols and smg's make sure that the
 * hand models match the weapons as best as possible"). That gun's magazine goes up its grip as a pistol's does, so
 * a pistol is put magazine on magazine and the gun hand is on its grip; each is then moved by what it took, looking,
 * to lay its own grip in that hand (the gun's own space: x toward the muzzle, y up, z to its right; metres; and
 * turned, radians). The other hand was drawn on the fore-end, a hand's length ahead of the grip, where a pistol has
 * nothing: it is brought back under the gun hand, round the front of the grip (`left`: from where it was drawn).
 */
const IN_SMG: Record<string, { /** how big it is drawn in these hands, of its own size: they are smaller than life, and the pistols were sized for another pair */ size: number; move: [number, number, number]; turn?: [number, number, number]; left: { move: [number, number, number]; turn?: [number, number, number] } }> = {
  m9: { size: 0.88, move: [0, 0, 0], left: { move: [-0.125, -0.065, 0.012] } },
  colt: { size: 1, move: [0, 0, 0], left: { move: [-0.125, -0.065, 0.012] } },
  deagle: { size: 0.85, move: [0, 0, 0], left: { move: [-0.125, -0.065, 0.012] } },
};
/**
 * The tops of that pack's arms, let down out of the picture (the eye's space: x right, y up, -z away; metres). Its
 * own camera stands a hand nearer the gun than the game's eye does: from the eye, the top of the left arm was a
 * shape in the bottom corner of the picture (the user's, 2026-10-11: "the shoulder of the left arm is showing").
 */
const SMG_SHOULDERS = { L: new THREE.Vector3(0.02, -0.13, 0.07), R: new THREE.Vector3(0.02, -0.05, 0.03) };
/**
 * How those guns are carried at a run by whoever is seen with one, as the pack's own run has them in the hands of
 * whoever holds one: muzzle up beside the gun shoulder, in the one hand, the other swinging free (see `carry` on
 * Grips). (The user's, 2026-10-11: "the animations should be seen by other players too yeah? like the way the user
 * is holding the gun when running".)
 */
const SMG_STAND = {
  // (it has no stock: held out in both hands in front of the chest, nearer than a rifle's grip is, and brought up to the eye from there)
  ready: { p: [0.03, -0.17, -0.37] as [number, number, number], r: [-0.22, 0, 0] as [number, number, number] },
  aim: { p: [0.035, 0.06, -0.37] as [number, number, number], r: [0, 0, 0] as [number, number, number] },
};
const SMG_CARRY = {
  pistol: { p: [0.2, -0.06, -0.2] as [number, number, number], r: [1.25, 0, 0] as [number, number, number], free: true },
  smg: { p: [0.2, -0.2, -0.22] as [number, number, number], r: [1.2, 0, 0] as [number, number, number], free: true },
};
/** a stroke of the spade when something is being buried or dug up, seconds */
const DIG_STROKE = 1.15;
/** how far back a pistol's slide stays when it has run dry, metres */
const SLIDE_LOCK = 0.03;
/**
 * A pistol whose hammer is drawn cocked: where it turns (the gun-alone file's own x and y, metres) and how far it
 * falls forward from there to lie down (radians about the gun's right). It lies down but while the slide is back:
 * for the moment of a shot, and for as long as the gun is empty. (2026-10-12: "the hammer is always cocked back".
 * The M9's stands out behind its slide; the Colt's is carried cocked, and is left so.)
 */
const HAMMER: Record<string, { at: [number, number]; down: number }> = { m9: { at: [0.003, 0.056], down: -0.7 } };
const _Z = new THREE.Vector3(0, 0, 1);

/**
 * A magazine where it sits in its gun, as a mark to set one gun on another by (the gun-alone file's space): the
 * middle of it front to back where the hand is round it (a little way down from its top: one that leans is further
 * back at its foot), its top, and the middle of its width.
 */
function magMark(parts: MeshPart[]): THREE.Vector3 | null {
  const pts: number[] = [];
  let top = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of parts) {
    if (!/^mag/.test(p.name)) continue;
    const P = p.geometry.getAttribute('position');
    for (let i = 0; i < P.count; i++) {
      pts.push(P.getX(i), P.getY(i));
      top = Math.max(top, P.getY(i));
      z0 = Math.min(z0, P.getZ(i));
      z1 = Math.max(z1, P.getZ(i));
    }
  }
  if (!pts.length) return null;
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i + 1] > top - 0.03 || pts[i + 1] < top - 0.055) continue;
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
  }
  return x0 <= x1 ? new THREE.Vector3((x0 + x1) / 2, top, (z0 + z1) / 2) : null;
}

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
 * A grenade with its pin out (see `cook` in game.ts), in the eye's space: in the right fist alone, the left having
 * come away with the pin, held up on the right and drawn back a little to be thrown. It is not held still: the
 * fist shakes, a little at first and more as the fuse runs down, which is what the hands say of how long is left
 * (the line under the crosshair says it in figures).
 *   at, turn – where it is, and how it is turned
 *   shake    – how far it shakes when the pin has just come out, and at the end of the fuse, metres
 *   stick    – a grenade on a handle, which is not held as a ball is. (It was: turned as the ball is, its head came
 *              down toward the eye and filled the corner of the picture, the fist somewhere up its handle. Looked
 *              at 2026-10-13.) It is stood up in the fist by the end of its handle, its head uppermost and leaning
 *              back over the shoulder, as a thing is held that is about to be thrown overarm. `at`, `turn`: where
 *              its middle is and how it is turned (it lies along its own z, its head toward +z). `grip`: how far
 *              along it from its middle the fist is (toward the handle's end). `fingers`: which way they point
 *              round the handle, in its own x and y. `fist`: how far behind the handle the wrist is, and how far
 *              to the palm's side of it. `curl`, `thumb`, `tuck`: how the fist is closed on it.
 *              `rest`, `restTurn`: before its cord is pulled, held as a thing to hit with is, by the end of its handle
 *              low on the right, head up and a little forward (the owner, 2026-10-15: "the stick grenade should be held
 *              like a melee weapon, hand around the base of the grenade. the wind up animation can be the wind up for
 *              the melee attack"): pulling the cord draws it from there up and back over the shoulder.
 */
export const LIVE = {
  at: [0.17, -0.075, -0.4] as [number, number, number],
  turn: [0.3, -0.35, -0.25] as [number, number, number],
  shake: [0.0012, 0.006] as [number, number],
  stick: {
    at: [0.19, -0.045, -0.47] as [number, number, number],
    turn: [-1.1, 0.12, -0.3] as [number, number, number],
    grip: -0.1,
    rest: [0.205, -0.085, -0.46] as [number, number, number],
    restTurn: [-1.5, 0.12, -0.28] as [number, number, number],
    fingers: [-0.45, 0.89] as [number, number],
    fist: [0.075, 0.03] as [number, number],
    curl: [1.1, 1.15, 1.2, 1.25] as [number, number, number, number],
    thumb: 0.8,
    tuck: 0.3,
  },
};

/**
 * A roll of dressing (the bandage, the splint tape), in the eye's space. It lies in the hollow of the left palm,
 * held up left of the middle and tipped to the eye; the right hand takes the end of it, draws a length off, goes
 * down out of the picture to where the wound is, and comes back for more.
 *
 * (It was held as the first aid kit is, which is a foot wide and whose movement this was made for: a hand under
 * the far edge of a box that was not there, with its fingers closed through a roll two inches across. Asked for:
 * "the bandage model and animation could be repositioned to sit in the hand better and not clip through it".)
 *   at, turn    – where the roll is, and how it is turned
 *   back, under – how far behind the roll's middle the left wrist is, and how far under its underside
 *   reach       – how far behind its fingertips the right wrist is, as they come down on the roll
 */
/**
 * Things drawn bigger in the hand than they are, or they are a speck at arm's length (the owner, 2026-10-14: "the
 * bandage item needs to be larger its too small in the hand"): the roll of dressing is a 4.5 cm reel of tape.
 */
const IN_HAND: Record<string, number> = { bandage: 1.8 };

/**
 * A roll of dressing in the left palm, and the right drawing lengths off it. A bag of blood or salt water being run
 * in is held the same way (the owner, 2026-10-14: "it should be the same hand positions as the bandage"; held up by
 * its edge and squeezed, the left hand was upside down and twisted).
 */
export const ROLL = {
  at: [-0.05, -0.088, -0.4] as [number, number, number],
  turn: [0.5, 0.3, -0.06] as [number, number, number],
  back: 0.085,
  under: 0.03,
  reach: 0.118,
  // A bag is flat: on fingers curled as round a roll it sank onto them (the owner: "the fingers crop through the bag,
  // any way we can lift the bag up higher so it appears to sit in the hand"). It is held up off the palm by `lift`,
  // on fingers nearly straight.
  bag: { lift: 0.035, curl: [0.12, 0.14, 0.16, 0.18] as [number, number, number, number] },
};

/**
 * A magazine being filled, in the eye's space. It stands in the left hand, left of the middle, its mouth up and
 * tipped to the right hand; the right brings a round up from low on the right, sets it on the mouth, presses it
 * down and slides it back under the lips, and goes for the next. One round to each turn of it: the press lands as
 * the turn ends, which is when the game counts the round in and the click is heard.
 *   rest, restTurn – held and not being filled: upright in the right fist, low on the right
 *   at, turn       – being filled: where it stands, and how it is turned
 *   away           – where the right hand takes the next round from
 *   down, back     – how far a round is pressed into the mouth, and slid back, metres
 */
/**
 * The hands on a magazine being filled (the owner, 2026-10-15: "the left hand should hold the magazine like a can of
 * beans maybe, and the wrist is too bent on the right hand making it looks weird, and wheres the bullet in between the
 * fingers of the right hand?").
 *   left  – round it as round a can: the palm on its left face, the fingers round its front edge, the thumb round its
 *           back. `at`: the wrist, toward its front (metres), up it (a share of its height), off its left face
 *           (metres); which way the fingers point and the palm faces, in the magazine's own space (x its front, z
 *           out of its right face)
 *   right – a round pinched between the thumb and the first finger, the wrist in line with the forearm: the pinch is
 *           `reach` along the fingers from the wrist and `under` the palm; which way they point, in the eye's space
 *   round – how much bigger the round is drawn in the fingers, and how far toward the eye of the pinch it sits
 */
export const FILL_HANDS = {
  left: { at: [-0.01, -0.2, 0.024], fingers: [1, 0.05, 0.3], palm: [0, 0, 1], curl: [1.15, 1.2, 1.25, 1.3] as Curl, thumb: 0.7 },
  right: { reach: 0.12, under: 0.022, fingers: [-0.72, 0.3, -0.62], palm: [-0.25, -0.75, 0.6], curl: [0.55, 0.85, 1.15, 1.25] as Curl, thumb: 0.95, tuck: 0.15 },
  round: { size: 1.3, ahead: 0.008 },
  // how much lower in the left hand the magazine sits than it was, the hands staying where they were: its mouth came
  // up through the right hand's fingers, where they are to be on top of it with the round (the owner, 2026-10-15:
  // "the solution is to reposition the height of the mag in the left hand")
  drop: 0.035,
};
// (development: the page's own copy of these, to be tried other ways without building again: assets-src/_wf/me/mag-pose.js;
// a script's own import of this file is another copy, and changing that changed nothing)
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __fill?: unknown }).__fill = FILL_HANDS;

export const LOAD = {
  rest: [0.105, -0.135, -0.42],
  restTurn: [0.22, -0.55, 0.1],
  at: [-0.045, -0.095, -0.36],
  // (a quarter turn about its height from how it was: its mouth runs away from the eye, the rounds' noses forward,
  // as a magazine is held to be filled; it was broadside on. The owner, 2026-10-15: "can we rotate the mag so that it
  // is properly facing the right way currently its horizontal to the body but it should be perpendicular")
  turn: [0.3, 0.42 + Math.PI / 2, -0.1],
  away: [0.19, -0.2, -0.37],
  down: 0.014,
  back: 0.02,
};

/**
 * A box of rounds being torn open, in the eye's space: held in the left hand before the chest, its flap pulled
 * back by the right in two tugs, and then tipped over into the right palm, cupped under it.
 *   at    – where the box is held
 *   palm  – where the right hand is cupped to take what comes out
 */
export const UNBOX = {
  at: [-0.035, -0.095, -0.4],
  palm: [0.08, -0.19, -0.38],
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

/** An injector taken into the hand and not yet used: where it is held (in the eye's space) and which way its nose points. */
export const READY = { at: [0.13, -0.115, -0.44] as [number, number, number], nose: [-0.35, 0.8, -0.5] as [number, number, number] };

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
const MELEE_STYLE: Record<string, MeleeStyle> = (() => {
  const styles: Record<string, MeleeStyle> = {
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
  // (as everybody else sees it: in both hands, as the bat, held up the shaft)
  pitchfork: {
    idle: { p: [0.13, -0.15, -0.4], tip: [-0.42, 0.84, -0.34], edge: [-0.3, -0.45, -0.84] },
    guard: { p: [0.21, -0.07, -0.4], tip: [-0.97, 0.2, -0.1], edge: [0.05, -0.1, -1] },
    strokes: [CUT, BACK],
    elbow: [0.34, -0.36, -0.18],
    two: true,
    grip: 0.3,
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
    // (the combat knife: three and a half centimetres of pommel, then eight of ribbed grip under the guard. The fist is on the middle of the grip.)
    grip: 0.075,
  },
  };
  // The shovel is held and swung as the bat is: in both hands, the left on the grip at its foot and the right a
  // hand's width up the shaft, carried back over the right shoulder, the same two strokes.
  styles.shovel = { ...styles.bat, grip: 0.2 };
  return styles;
})();
/**
 * The knife in the hands of whoever holds it (2026-10-13): not a still model with the arms reached out to it, as
 * everything else to hit with is, but its own pack's arms and its own movements (`knife` in WEAPON_PACKS: the
 * sniper's maker's, the same arms as are on a hatchet), played as they were drawn and at the pace they were drawn.
 * See `animateBlade`.
 *   blows  – the blows of a run, one after another: a cut across from the left, the cut that answers it from the
 *            right, and a thrust straight out. (The pack has a fourth, a stab down with the blade turned under the
 *            fist, `stab`: kept for a second kind of attack, if there is ever to be one.) Each is drawn back in a
 *            tenth of a second and is through the middle of the picture by 0.13 s, which is when the game counts
 *            a blow as landed (0.35 of the way through a swing of the knife's 0.42 s); each then carries on and
 *            comes home after the swing is over, and the next blow of a run sets out from wherever that had got to.
 *   skip   – seconds of a blow's drawing back that are left out, so that it lands when the game counts it: the
 *            thrust is drawn a thirtieth of a second longer in the drawing back than the cuts are
 *   join   – seconds over which one movement gives way to the next, where the next begins from another place
 *   breath – held: how much of the pack's own drift out and back is played (it is drawn as a straight line each
 *            way), and how many seconds to a breath
 *   guard  – put up to stop a blow: how far the hands are moved and turned from where they hold it (the eye's
 *            space: right, up, back, metres; nose up, nose left, roll, radians). The pack has no drawing of it.
 *   run    – and how they are let down at a run
 */
const BLADE = {
  blows: ['cutA', 'cutB', 'thrust'],
  skip: { thrust: 1 / 30 } as Record<string, number>,
  join: 0.06,
  breath: 0.7,
  every: 3.6,
  guard: { p: [-0.03, 0.09, 0.04] as [number, number, number], r: [0.05, 0.12, -0.4] as [number, number, number] },
  run: { p: [0.03, -0.09, 0.02] as [number, number, number], r: [-0.35, 0.25, 0.3] as [number, number, number] },
  /** a thing in its own pack whose guard is not the knife's: the pitchfork's shaft, turned as the knife is, swung across the whole picture */
  own: { pitchfork: { guard: { p: [0, 0.05, 0.03] as [number, number, number], r: [0.04, 0, -0.08] as [number, number, number] } } } as Record<string, { guard: { p: [number, number, number]; r: [number, number, number] } }>,
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
  rifle: new THREE.Vector3(0.06, 0.039, 0),
  /**
   * The hand under a rifle. The pack's own left hand holds it hard up against the magazine
   * (seen from its own eyes, that is where a hand is in the picture); on a body seen from
   * outside that is two fists together under the action. It goes a hand's breadth up the
   * fore-end, where a rifle is held.
   */
  fore: new THREE.Vector3(0.074, -0.006, 0.004),
};
/**
 * Where the forward hand holds each long gun, seen from outside (the owner, 2026-10-17: "the forward hand should be
 * holding the grip on applicable weapons", and of the AK: "the left hand is too far right and the thumb is clipping
 * through the other side of the gun"). A number: how far ahead of the gun hand's wrist the palm goes under the
 * fore-end, ahead of the magazine (the gun's own metres; the fore-end's underside there is found from its shape).
 * `post`: the middle of a vertical grip of its own (x, y), which the hand closes round. From each gun's own pieces.
 * (It was the pack's own left hand a hand's breadth on: two fists together under the action, slid back to the
 * magazine where the body's arms were too short, and its thumb through the far side.)
 */
const FORE: Record<string, number | { post: [number, number] }> = {
  ak: 0.28, ar15: 0.32, mosin: 0.315, benelli: 0.5, mpa: 0.18, aks74u: 0.3, barrett: 0.32, db12: 0.215, sniper50: 0.33, vssk: 0.23, scorpion: 0.28,
  // (the owner: "the 40mm gun has a vertical grip for us to use, like the ar15")
  m32: { post: [0.368, -0.078] }, mp7a1: { post: [0.16, 0] },
};
/**
 * The gun hand of the weapons pass's guns, seen from outside: its wrist where the AK's is from the middle of the
 * trigger (whose hold was looked at), so that the first finger lies on the trigger (the owner, 2026-10-17: "many are
 * off the trigger"). Found from the gun's own trigger; where it has none of its own, where it is (x, y). It was the
 * pack's own right hand, which on the M32, the Barrett and the MP7 was 5 to 8 cm ahead of the trigger.
 */
const TRIGGER_WRIST = new THREE.Vector3(-0.095, -0.005, 0.028);
const BY_TRIGGER: Record<string, true | [number, number]> = { barrett: true, m32: true, mp7a1: true, aks74u: true, sniper50: true, scorpion: true, vssk: [0.05, 0], db12: [0.03, -0.005] };
/**
 * A pair as everybody else sees it held: the gun twice, side by side this far apart (the gun's own metres, as far as
 * its pack's two hands are), each in its own fist, held out in front as two cans would be (the owner, 2026-10-17:
 * "gun in each hand, it would be like both hands are holding a can of soup or something, make it simple"). It
 * was the one gun in the right hand and the left hand at its side.
 */
const AKIMBO_GAP = 0.32;
/** the foregrip, the AR-15's own piece: the middle of it, where the hand closes round it when it is fitted */
const FOREGRIP_POST: Record<string, [number, number]> = { ar15: [0.126, 0.028] };
/** The forward hand: palm up under the fore-end at a point on its underside, its thumb along the near side; or closed round a vertical grip at its middle. */
function foreHold(at: THREE.Vector3, post: boolean): HandGrip {
  return post
    ? { pos: at.clone().add(new THREE.Vector3(-0.05, 0.014, -0.02)), fingers: new THREE.Vector3(0.9, -0.3, 0.3).normalize(), palm: new THREE.Vector3(0.15, -0.1, 1).normalize(), curl: [1.2, 1.25, 1.3, 1.3], thumb: 1 }
    : { pos: at.clone().add(new THREE.Vector3(-0.02, -0.032, -0.05)), fingers: new THREE.Vector3(0.35, 0.1, 0.93).normalize(), palm: new THREE.Vector3(0, 1, 0.1).normalize(), curl: [1.0, 1.05, 1.1, 1.15], thumb: 0.4 };
}
/**
 * How a body's two hands hold a pistol, seen from outside: where each wrist is on the gun (the M9's own measure:
 * x toward the muzzle, y up, z out to the right; metres) and how each finger is laid round it, joint by joint.
 *
 * Worked out from the hand and the gun, not by eye: the knuckles are 11 cm ahead of the wrist, so the wrist is
 * that far behind a point a finger's thickness in front of the front of the grip; it is as high as puts the
 * first finger level with the trigger; and as far out as lays the palm on the side of the grip and not in it.
 * The gun hand's first finger goes in to the trigger; its others go across the front of the grip and back along
 * its far side (closed as a fist closes, they went through it). The other hand is laid over those fingers from
 * the other side. (It was held by a wrist put where the gun's own first-person hands have theirs, which is a
 * different hand: 2 to 6 cm out, and through the grip.)
 */
const PISTOL_HOLD = {
  // (the gun 2.2 cm nearer the body and 2 cm nearer the ground in the hands than these were first worked out:
  // it stood high and forward of the fists, and the first finger was short of the trigger)
  // (and then half of that way back: at the full 2.2 and 2 cm the gun was too far into the hand)
  right: new THREE.Vector3(-0.045, 0.006, 0.066),
  left: new THREE.Vector3(-0.043, -0.012, -0.064),
  curl: {
    right: [[1.0, 0.45, 0.25], [1.45, 0.6, 1.0], [1.45, 0.6, 1.0], [1.45, 0.65, 1.0]] as Curl,
    left: [[1.3, 0.55, 0.9], [1.35, 0.55, 0.95], [1.4, 0.6, 1.0], [1.4, 0.65, 1.0]] as Curl,
  },
};
/**
 * The same on a pistol that is not the M9: how much further toward its muzzle (and up) its grip is, and how much
 * further out its two sides are (the right, and the left). The Desert Eagle's grip stands 2 cm further forward
 * and is a finger wider; the Pistol 43's 1.3 cm further forward and a little narrower. From the guns' own shapes.
 */
const SEAT_ON: Record<string, THREE.Vector3> = {
  deagle: new THREE.Vector3(0.019, -0.002, 0),
  colt: new THREE.Vector3(0.006, 0, 0),
};
const APART_ON: Record<string, [number, number]> = { deagle: [0.002, -0.0035], colt: [-0.003, 0.003] };
const NO_SEAT = new THREE.Vector3();
/**
 * Where the hands go to work a long gun, seen from outside (see `Grips.work`): from the guns' own shapes. The
 * sniper's bolt handle stands out of its right side a hand ahead of the grip, and its magazine hangs under it
 * ahead of the trigger; the shotgun is fed through the port under it, ahead of the guard.
 */
const WORK_ON: Record<string, Grips['work']> = {
  mosin: { bolt: new THREE.Vector3(-0.408, 0.036, 0.074), feed: new THREE.Vector3(-0.288, -0.091, -0.045) },
  benelli: { feed: new THREE.Vector3(-0.262, -0.088, -0.04), tube: true },
};
/** how far under the ears of the shotgun's front sight the top of its post is (the eye is put level with the post) */
const IRON_DROP = 0.004;
/** rifles that came with no sights of their own and are given plain ones: a post at the muzzle, a notch over the breech (see `Weapons.fitIrons`) */
const PLAIN_SIGHTS = new Set(['mosin', 'ar15']);
/**
 * The line of a gun's own sights, in the space of its own file (x along the barrel, y up, z to its right, metres):
 * the middle of its notch, at the height of the leaf either side of it, and the tip of its post. Measured off the
 * model by looking straight down on it. (The AK's: a leaf 16.5 mm wide with a notch 3 mm wide and 2 deep in the
 * back edge of it, and a post between two ears, its tip 3 mm lower than the leaf: as on the rifle itself, the
 * sights look a little down on the barrel.) A gun aimed by this line has its eye put on it, and is turned to it.
 */
const SIGHT_LINE: Record<string, { notch: [number, number, number]; post: [number, number, number]; /** nearer the eye than IRON_NEAR, aimed: a ring sight seen from where a notch is was a speck */ near?: number }> = {
  ak: { notch: [-0.0005, 0.1187, 0.00125], post: [0.3625, 0.1156, 0.001] },
  // (the submachine gun's: a block with a notch in it between two ears on the back of the receiver, and a post between two more at the front of it)
  mpa: { notch: [-0.046, 0.085, -0.0025], post: [0.122, 0.084, -0.003] },
  // (the Scorpion's: the middle of the ring of its rear drum, and the tip of the post between the ears of its hood,
  // level with each other; read off the file looking down its barrel, scripts/sight-profile.mjs)
  scorpion: { notch: [0.017, 0.1316, -0.0081], post: [0.258, 0.1316, -0.0083], near: 0.07 },
  // (the MP7's sights stay folded flat in its pack's hands, as on the gun itself until they are flipped up: the line
  // runs over the middle of the folded rear ring and the folded front hood, scripts/sight-profile.mjs and
  // progress/weapons/sight-in-hands.js)
  mp7a1: { notch: [-0.0957, 0.1382, -0.0076], post: [0.137, 0.1356, -0.0067] },
  // (the double barrel's: along the rib between its barrels, from over the breech to the bead at the muzzle)
  db12: { notch: [0.3, 0.1135, -0.0094], post: [0.96, 0.113, -0.0094] },
  // (the AKS-74U's as the AK's: the middle of the notch at the height of its leaf, the post's tip 3 mm lower)
  aks74u: { notch: [0.128, 0.1375, 0.0084], post: [0.368, 0.1344, 0.0085] },
};
/**
 * The middle of a holographic sight's window, from the middle of the box of the whole sight (the eye's space: across,
 * up; metres). The AR's mark stood a millimetre right of its window's middle and as much low: from the eye, the
 * window was off to one side of it. A player: "holo scope on the ar is not in the middle its kinda off center".
 */
const GLASS: Record<string, [number, number]> = { ar15: [-0.0012, 0.0008], mp7a1: [-0.0035, -0.0009] };
/** a gun whose own sight's lens is painted opaque into its picture: that piece's lens is cut away (see packGun) */
const LENS: Record<string, string> = { mp7a1: 'sight', m32: 'sight' };
/**
 * The faces of a tube sight that look along the barrel (x, the gun's own space) inside its ring, taken out: its
 * lens. The ring is found from those same faces over the lower two fifths of it (the mount under it has faces that
 * look along the barrel too): its middle is the middle of them, and its lens three quarters of the way out to the
 * furthest of them.
 */
function cutLens(geo: THREE.BufferGeometry): { at: THREE.Vector3; axis: THREE.Vector3 } | null {
  const P = geo.getAttribute('position'), idx = geo.getIndex();
  if (!idx) return null;
  geo.computeBoundingBox();
  const b = geo.boundingBox!, above = b.min.y + (b.max.y - b.min.y) * 0.4;
  const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  const facing: { i: number; x: number; y: number; z: number; n: THREE.Vector3 }[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(P, idx.getX(i));
    b2.fromBufferAttribute(P, idx.getX(i + 1));
    c.fromBufferAttribute(P, idx.getX(i + 2));
    n.crossVectors(b2.clone().sub(a), c.clone().sub(a)).normalize();
    m.copy(a).add(b2).add(c).divideScalar(3);
    if (Math.abs(n.x) > 0.85 && m.y > above) facing.push({ i, x: m.x, y: m.y, z: m.z, n: n.clone().multiplyScalar(Math.sign(n.x)) });
  }
  if (facing.length < 6) return null;
  let cy = facing.reduce((s, f) => s + f.y, 0) / facing.length, cz = facing.reduce((s, f) => s + f.z, 0) / facing.length;
  const out = Math.max(...facing.map((f) => Math.hypot(f.y - cy, f.z - cz))), r = out * 0.75;
  // (and the middle found again from the lens's own faces, twice: a knob on one side of the ring drew the first guess
  // to that side, and the eye looked into the tube at a slant)
  let lens = facing.filter((f) => Math.hypot(f.y - cy, f.z - cz) < r);
  for (let k = 0; k < 2 && lens.length; k++) {
    cy = lens.reduce((s, f) => s + f.y, 0) / lens.length;
    cz = lens.reduce((s, f) => s + f.z, 0) / lens.length;
    lens = facing.filter((f) => Math.hypot(f.y - cy, f.z - cz) < r * 0.9);
  }
  const gone = new Set(lens.map((f) => f.i));
  const kept: number[] = [];
  for (let i = 0; i < idx.count; i += 3) if (!gone.has(i)) kept.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  geo.setIndex(kept);
  // (where the glass was: the middle of its ring, halfway along the tube; and which way the tube looks, by its glass)
  return {
    at: new THREE.Vector3(lens.reduce((s, f) => s + f.x, 0) / Math.max(1, lens.length), cy, cz),
    axis: lens.reduce((s, f) => s.add(f.n), new THREE.Vector3()).normalize(),
  };
}
/** how much nearer the eye than at the hip the shotgun is held when aimed along its own sights (nearer than this and the fist on its grip is a dark shape across the bottom of the picture) */
const IRON_NEAR = 0.02;

/**
 * How big a rifle is drawn in somebody else's hands, of its own size, kept where it is at the
 * butt. The pack's rifle is long in the stock for the body that holds it (44 cm from butt to
 * trigger, against arms 48 cm from shoulder to wrist): at its full size the hand under it
 * could not reach the fore-end, and came back along the stock to the magazine. A tenth
 * smaller, with the body turned a little more side on (POSE.hold.blade), it reaches.
 */
const HELD_RIFLE = 0.9;

/**
 * Coming out of a sprint to shoot: how far down the gun may still be for a shot to go (a share
 * of the sprint pose), how long a trigger pulled before that is remembered, and how long after
 * the trigger or the sights the legs will not sprint. Seconds.
 */
const SPRINT_OUT = { up: 0.22, keep: 0.45, lock: 0.4 };
/** shots no further apart than this are one string: the kick of each goes by which shot of the string it is. Seconds. */
const STRING_GAP = 0.28;
/** how far up the sights are (`adsT`) before they steady a shot: at the eye, as near as makes no difference (a scope is looked through from here too) */
const SIGHTS_UP = 0.9;
/**
 * How fast the part of a kick that stays is given to the view, 1/s: most of it within a twentieth of a second.
 * (All of it went in on the frame of the shot: the picture jumped most of a degree at an AK's first round, where
 * a muzzle is thrown up fast and is still seen to go.)
 */
const RISE = 40;

/**
 * Where a gun that rides in another pack's hands sits in them, from where the fitting of the
 * one gun to the other left it (the gun's own space: x toward the muzzle, y up). Set by eye.
 */
const NUDGE = {
  deagle: new THREE.Vector3(0, 0, 0),
  benelli: new THREE.Vector3(0.08, -0.012, 0),
};

/**
 * How a gun sounds, where it is not how its kind does: the recording played slower (deeper)
 * and louder. Nobody has listened to these: they are set by what the guns are.
 */
const VOICE: Record<string, { rate: number; gain: number; rec?: string }> = {
  deagle: { rate: 0.86, gain: 1.5, rec: 'shot_magnum' },
  benelli: { rate: 0.9, gain: 1.5, rec: 'shot_shotgun' },
  // (each its own recording: a 7.62x39 and a 5.56, single shots)
  ak: { rate: 1, gain: 1.15, rec: 'shot_ak' },
  ar15: { rate: 1, gain: 1, rec: 'shot_ar' },
  // (a 9 mm out of a longer barrel: the pistol's recording, a little sharper)
  mpa: { rate: 1.06, gain: 1.05, rec: 'shot_pistol' },
  // (a .45: the pistol's recording, lower and a little louder)
  colt: { rate: 0.9, gain: 1.2 },
  // (the weapons pass's: the short AK its rifle's recording higher; the 9 mm and .45 guns the pistol's; the .50s and
  // the 12.7 the rifle's, deep; the shotguns the shotgun's)
  aks74u: { rate: 1.08, gain: 1.1, rec: 'shot_ak' },
  mp7a1: { rate: 1.12, gain: 1, rec: 'shot_pistol' },
  scorpion: { rate: 1.1, gain: 1, rec: 'shot_pistol' },
  dual_smg: { rate: 1.06, gain: 1.05, rec: 'shot_pistol' },
  dual_mac10: { rate: 0.92, gain: 1.15, rec: 'shot_pistol' },
  sniper50: { rate: 0.78, gain: 1.6, rec: 'shot_rifle' },
  barrett: { rate: 0.78, gain: 1.6, rec: 'shot_rifle' },
  vssk: { rate: 0.82, gain: 1.3, rec: 'shot_rifle' },
  db12: { rate: 0.9, gain: 1.5, rec: 'shot_shotgun' },
  dual_sawnoff: { rate: 0.95, gain: 1.5, rec: 'shot_shotgun' },
};
/** whose recordings a gun's magazine and bolt are heard with, where it has its own (see audio.magOut) */
const HANDLED: Record<string, 'ak' | 'ar'> = { ak: 'ak', ar15: 'ar' };

/** The lit mark of a holographic sight: its own light, whatever the hour, drawn over whatever is behind the glass. */
function reticleMaterial(src: THREE.Material): THREE.Material {
  // (the sight's own picture of its mark is red on flat grey, with nothing to say what is glass:
  // the red is what is lit, by how much redder than grey it is)
  return new THREE.ShaderMaterial({
    uniforms: { tMap: { value: (src as THREE.MeshStandardMaterial).map ?? null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tMap;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D( tMap, vUv );
        float lit = clamp( ( c.r - c.g ) * 2.2, 0.0, 1.0 );
        gl_FragColor = vec4( vec3( 1.0, 0.16, 0.08 ) * lit * 1.6, lit );
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
}

/** The middle of the foremost end of something hung in the hands (the mouth of its barrel), in the space its matrices are in now. */
function frontOf(obj: THREE.Object3D, within = 0.01): THREE.Vector3 | null {
  obj.updateWorldMatrix(true, true);
  const pts: number[] = [];
  let z0 = Infinity;
  const v = new THREE.Vector3();
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const P = mesh.geometry.getAttribute('position');
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld);
      pts.push(v.x, v.y, v.z);
      z0 = Math.min(z0, v.z);
    }
  });
  if (!pts.length) return null;
  const ring = new THREE.Box3();
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 2] < z0 + within) ring.expandByPoint(v.set(pts[i], pts[i + 1], pts[i + 2]));
  return ring.getCenter(new THREE.Vector3()).setZ(z0);
}

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

/**
 * The holographic sight, for a gun that has none of its own: the shotgun's, taken off it. (The pistols had
 * another model of one: a smaller-looking box whose window was a slab painted black. The shotgun's has glass
 * in it, and is the one that looks right, so it is the one they all carry.) Stood on its foot at the middle of
 * its length, looking along +x as it does on the shotgun, with the lit mark in its window: the mark's own
 * picture comes with the other model, which is read for that and nothing else.
 */
async function holoParts(): Promise<MeshPart[]> {
  const own = extractParts(await assets.model('benelli_m3'), (n) => n === 'sight');
  const mark = extractParts(await assets.model('holo_sight')).find((p) => /crosshair/i.test((p.material as THREE.Material).name));
  const box = new THREE.Box3();
  for (const p of own) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox!);
  }
  // (Across, its middle is the middle of its hood, the upper part of it, which is the same either side: its box is
  // not, with a knob on one side lower down. Nor is it where the shotgun's own middle is: it sat a finger's width
  // off the middle of a pistol's slide.)
  const mid = (box.min.x + box.max.x) / 2, tall = box.max.y - box.min.y;
  let z0 = Infinity, z1 = -Infinity;
  for (const p of own) {
    const P = p.geometry.getAttribute('position');
    for (let i = 0; i < P.count; i++) {
      if (P.getY(i) < box.min.y + tall * 0.62) continue;
      z0 = Math.min(z0, P.getZ(i));
      z1 = Math.max(z1, P.getZ(i));
    }
  }
  const across = Number.isFinite(z0) ? (z0 + z1) / 2 : 0;
  const parts: MeshPart[] = own.map((p) => ({ ...p, geometry: p.geometry.clone().translate(-mid, -box.min.y, -across) }));
  if (mark) parts.push({ name: 'reticle', owner: 'reticle', geometry: new THREE.PlaneGeometry(0.0085, 0.0085).rotateY(-Math.PI / 2).translate(0, tall * 0.7, 0), material: mark.material });
  return parts;
}

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
  /** how the aim comes back from a shot: a spring this near to dead-beat, which a push of v gets `RECOIL.peak` v / w out of before it turns (w its own rate) */
  private static RECOIL = { damp: 0.68, peak: 0.466 };
  /** what of the kicks so far stays and has not yet been given to the view, radians (x across to the right, y up): see RISE */
  private rise = new THREE.Vector2();
  private adsT = 0;
  private sprintT = 0;
  /** seconds for which a trigger pulled on the run is remembered: the shot goes when the gun has come up */
  private wantShot = 0;
  private airT = 0;
  private boltReady = true;
  /** the magazine a reload under way is putting in (which kind: the fresh one in the other hand is drawn as it) */
  private incoming: string | null = null;
  /** how many rounds are in the magazine that is on its way into the gun */
  private incomingRounds = 0;

  /**
   * The rounds drawn in the mouth of a magazine: the M9's top two, the row in the AR-15's. They are pieces of
   * their own in the gun's file, and were always there, in a magazine with nothing in it: "when the pistol is out
   * of empty and the slide is open i see bullets in the mag that do not exist" (2026-10-13). Found here by what
   * they are (a piece of the magazine no longer than a round, or painted as bullets), and numbered from the top.
   */
  private roundsOf(root: THREE.Object3D): NonNullable<VmModel['rounds']> {
    const found: { piece: THREE.Object3D; fresh: boolean; y: number }[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      let inMag = false, fresh = false;
      for (let q: THREE.Object3D | null = mesh; q; q = q.parent) {
        if (q.name === 'mag') inMag = true;
        if (q.userData.fresh) fresh = true;
      }
      if (!inMag) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!, size = box.getSize(new THREE.Vector3());
      const painted = /bullet|cartridge/i.test((mesh.material as THREE.Material | undefined)?.name ?? '');
      if (!painted && Math.max(size.x, size.y, size.z) > 0.035) return;
      found.push({ piece: mesh, fresh, y: Math.round(((box.max.y + box.min.y) / 2) * 400) });
    });
    const out: NonNullable<VmModel['rounds']> = [];
    for (const fresh of [false, true]) {
      const mine = found.filter((f) => f.fresh === fresh);
      // (a round's case and its bullet are two pieces at one height: the uppermost height is the first round)
      const heights = [...new Set(mine.map((f) => f.y))].sort((a, b) => b - a);
      for (const f of mine) out.push({ piece: f.piece, fresh, nth: heights.indexOf(f.y) + 1 });
    }
    return out;
  }
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
  /** the light of lamps on the hands and the gun: from over the eye, as strong and of the colour the game says (see Lamps.spill) */
  private handLamp: THREE.DirectionalLight;
  readonly lampSpill = new THREE.Color();
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
  /** Has this gun's pack a drawing of it being looked over? (Those that carry a walk of their own: the submachine gun's pack and the pistols held in its hands.) */
  private checkDrawn(m: VmModel) {
    return !!m.gait && !!m.rig?.has('check');
  }
  /** Is there a light on the gun in the hands? */
  get hasLamp(): boolean {
    return !!this.current?.lamp && hasMod(this.currentItem, 'gun_light');
  }
  /** Where the front of that light is, as a place in the world. */
  lampWorld(camera: THREE.PerspectiveCamera, out: THREE.Vector3): THREE.Vector3 {
    const m = this.current;
    const body = m?.body;
    if (!m?.lamp || !body?.parent) return out.copy(camera.position);
    m.root.updateWorldMatrix(true, true);
    return out.copy(this.toWorld(this.vmCamera.worldToLocal(body.localToWorld(out.copy(m.lamp))), camera));
  }

  get sightless() {
    return this.aiming && this.current?.kind === 'rifle' && !!this.current.adsIron && !this.current.ownSights && !(this.current.optic && hasMod(this.currentItem, this.current.optic));
  }
  hitMarker = 0;
  /** the last hit marker was a kill (HUD draws it red) */
  killMarker = false;
  /** the last hit was to the head */
  headMarker = false;
  onHit: (info: HitInfo) => void = () => {};
  onShot: (info: ShotInfo) => void = () => {};
  /** a grenade fired from a launcher (the M32): from the eye, along the way the gun points, which grenade */
  onLaunch: (origin: THREE.Vector3, dir: THREE.Vector3, w: string) => void = () => {};
  /** the hands started on something others can see: working the bolt, reloading (seconds it takes) */
  onAct: (act: 'bolt' | 'reload' | 'check' | 'stop', dur: number) => void = () => {};
  /** something the player is told: why R did nothing */
  onSay: (text: string, kind: 'info' | 'warn') => void = () => {};
  /** what is carried has changed (a magazine out of a pocket and into the gun, the old one back into a pocket) */
  onCarried: () => void = () => {};
  /** a magazine came out of the gun and there is no pocket for it: it is put down */
  onSpill: (item: ItemInstance) => void = () => {};
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
  /** what was asked for while something else was being drawn (undefined: nothing) */
  private wanted: ItemInstance | null | undefined = undefined;
  /** the guard button is down, with the fists or something to strike with in the hands */
  private guardHeld = false;
  /** which blow of the run this is, and when the last was struck (one soon after another comes back the other way) */
  private strokeN = 0;
  private strokeAt = -9;
  private punchHand = 0;
  // item being used in the hands (food, drink, bandage, ammo box)
  /**
   * How a pass card is held and put to a reader. In the eye's own measure (x right, y up, z
   * back toward the eye): where it is held up to be looked at and which way it lies there (its
   * length, and what its front faces), where it is put and which way it lies then, how far it
   * is pushed home, and how long each takes (seconds). In the card's own measure as it is held
   * (x across it, y out of its front, z back along it from the end that goes in): where the
   * wrist is, which way the fingers lie and the palm faces, and how the fingers and the thumb
   * are bent.
   */
  card = {
    show: [0.045, -0.032, -0.215], showAlong: [-0.5, 0.82, -0.22], showFace: [0.2, 0.3, 1],
    put: [0.14, -0.1, -0.37], putAlong: [0.5, 0.35, -0.8], putFace: [-0.2, 0.7, 0.7], push: 0.07,
    shown: 0.75, over: 0.5,
    // (In these big gloves a card its true size is a stamp: it is drawn a third larger in the hand than it lies on a shelf.)
    scale: 1.3,
    // (These gloves' fingers are bent as they come, the last two most: each is straightened by as much as lays it flat
    // behind the card, measured off the hand itself; and the hand is turned a little across the card, so that the thumb
    // lies over its near end and all but the last finger are behind it. The wrist is said before the card is made larger.)
    wrist: [-0.0315, -0.0215, 0.138], fingers: [0.247, -0.04, -0.968], palm: [0, 1, 0], curl: [-0.3, -0.42, -0.67, -0.95], fold: [1, 0.5, 1.3], thumb: 0.9, tuck: 0, spread: 0.3,
  };
  /**
   * `wait`: taken into the hand and not yet used (an injector: see `ready` in game.ts). `age` is how long it has
   * been in the hand, `t` how far into its use it is; `from` is where it was held when the use began.
   */
  private held: { root: THREE.Group; id: string; kind: UseKind; t: number; age: number; dur: number; size: THREE.Vector3; ending: number; wait?: boolean; from?: { pos: THREE.Vector3; quat: THREE.Quaternion }; /** seconds since it changed between being held and being worked on (it is carried over from where it was) */ fromT?: number; /** how many times over it has been worked on without being put down (a magazine: rounds) */ turns?: number; /** a round for the fingers, while a magazine is filled */ round?: THREE.Object3D; coal?: THREE.Mesh; puffs?: number; wispT?: number } | null = null;
  private heldCache = new Map<string, { root: THREE.Group; size: THREE.Vector3; round?: THREE.Object3D }>();
  private smoke: ReturnType<typeof cigarette> | null = null;
  private lowerT = 0;
  /** the hands are busy with something that is not a weapon (a wave, a dance): it is let down out of the way */
  stowed = false;
  /** an admin's power (src/sim/powers.ts): a shot takes no round out of the gun. The game's to say, on the server's word */
  endless = false;
  /**
   * The arena's: the gun empties and is reloaded, and the reload fills it from a reserve that never ends, with no
   * magazine to carry or fill (the owner: "in arena you should have to reload ... but theres unlimited ammo and you
   * dont haveto manually load your mags or inventory management, think lik eCOD or CS:GO"). An empty trigger reloads.
   */
  freeReload = false;
  /** lets the game resolve a collider owner to a damageable entity */
  resolveTarget: (owner: unknown) => Damageable | null = () => null;
  onSlungChange: (objs: THREE.Object3D[]) => void = () => {};

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
    this.handLamp = new THREE.DirectionalLight(0xffffff, 0);
    vmScene.add(this.handLamp);
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
    // The submachine gun and the three pistols, in the hands that came with the submachine gun (2026-10-11): the
    // AK's maker's, on the AK's arms. As with the AK, the pack's own drawing of its gun is put away and the gun
    // alone is hung on its joints, piece by piece. A pistol is hung there in its place: its frame on the body, its
    // magazine on the magazine (which goes up the grip of that gun too), and its slide on the bolt, which goes
    // back with a shot and is worked by the hand when the gun has run dry. (The pistols were held in the M9's own
    // pack until now: other arms, other gloves, and no way of looking the gun over.)
    const smgRide = { base: 'PBody_058', bolt: 'Rif_059', trigger: 'Trigger_060', mag: 'Pmag_061' };
    const smgOwn = ['Object_93', 'Object_94', 'Object_96'];
    const smgSpare: [string, string] = ['Pmag_2_062', smgRide.mag];
    const mpa = await this.packGun({ pack: 'smg', item: 'mpa', gun: 'smg', kind: 'auto', hip: HELD.smg, flashSize: 0.24, flash: mkFlash(), ownArms: true, square: true, strip: smgOwn, ride: smgRide, spare: smgSpare });
    mpa.reseat = { body: smgRide.base, L: { shoulder: SMG_SHOULDERS.L }, R: { shoulder: SMG_SHOULDERS.R } };
    mpa.gait = true;
    mpa.fast = { body: smgRide.base, to: [smgRide.mag, 'IK_Hand_Cntrl_R_037'] };
    if (mpa.grips) {
      mpa.grips.carry = SMG_CARRY.smg;
      mpa.grips.stand = SMG_STAND;
    }
    this.models.set('mpa', mpa);
    // The CZ Scorpion (2026-10-17, the weapons pass): a pack on arms of its own, played as it came; the gun alone hung
    // on its joints as the AK's is, the pack's own drawing of it put away.
    this.models.set('sniper50', await this.packGun({ pack: 'sniper50', item: 'sniper50', gun: 'sniper50', kind: 'rifle', hands: true, hip: HELD.sniper50, flashSize: 0.4, flash: mkFlash(), strip: [], ride: { base: 'base', scope: 'scope', boltrear: 'boltback', bolt: 'bolt', trigger: 'trigger', mag: 'mag', bullet: 'bullet' } }));
    // (the Barrett and the VSSK came with no movements: held in the .50's, on its pieces' nodes; their own bolts stand still, they load themselves)
    this.models.set('barrett', await this.packGun({ pack: 'sniper50', item: 'barrett', gun: 'barrett', kind: 'rifle', hands: true, hip: HELD.barrett, flashSize: 0.45, flash: mkFlash(), strip: [], ride: { base: 'base', scope: 'scope', mag: 'mag', bolt: 'base', trigger: 'trigger' } }));
    this.models.set('m32', await this.packGun({ pack: 'sniper50', item: 'm32', gun: 'm32', kind: 'rifle', hands: true, hip: HELD.m32, flashSize: 0.3, flash: mkFlash(), strip: [], ride: { base: 'base', cylinder: 'base', sight: 'base', trigger: 'trigger' } }));
    this.models.set('vssk', await this.packGun({ pack: 'sniper50', item: 'vssk', gun: 'vssk', kind: 'rifle', hands: true, hip: HELD.vssk, flashSize: 0.2, flash: mkFlash(), strip: [], ride: { base: 'base', scope: 'scope', mag: 'mag', bullet: 'mag' } }));
    // (a pair: the right hand's gun on its own nodes, the left's on the _2 nodes; each hand and its gun fire by themselves)
    this.models.set('dual_smg', await this.packGun({
      pack: 'dualsmg', item: 'dual_smg', gun: 'dualsmg', kind: 'auto', hands: true, hip: HELD.dual_smg, flashSize: 0.22, flash: mkFlash(), strip: [],
      ride: { base: 'base', bolt: 'bolt', trigger: 'trigger', mag: 'mag' },
      twin: { ride: { base: 'base_2', bolt: 'bolt_2', trigger: 'trigger_2', mag: 'mag_2' }, flash: mkFlash(), roots: { L: ['smg2Left', 'L_arm_01'], R: ['smg2Right', 'R_arm_025'] } },
    }));
    this.models.set('dual_mac10', await this.packGun({
      pack: 'dualsmg', item: 'dual_mac10', gun: 'dualmac', kind: 'auto', hands: true, hip: HELD.dual_mac10, flashSize: 0.22, flash: mkFlash(), strip: [],
      ride: { base: 'base', bolt: 'bolt', trigger: 'trigger', mag: 'mag', silencer: 'base' },
      twin: { ride: { base: 'base_2', bolt: 'bolt_2', trigger: 'trigger_2', mag: 'mag_2', silencer: 'base_2' }, flash: mkFlash(), roots: { L: ['smg2Left', 'L_arm_01'], R: ['smg2Right', 'R_arm_025'] } },
    }));
    this.models.set('dual_sawnoff', await this.packGun({
      pack: 'sawnoffs', item: 'dual_sawnoff', gun: 'sawnoffs', kind: 'rifle', hands: true, hip: HELD.dual_sawnoff, flashSize: 0.32, flash: mkFlash(), strip: [],
      ride: { base: 'base', trigger: 'trigger1', front: 'front', slug1: 'slug1', slug2: 'slug2' },
      twin: { ride: { base: 'base_2', trigger: 'trigger1_2', front: 'front_2', slug1: 'slug1_2', slug2: 'slug2_2' }, flash: mkFlash(), roots: { L: ['sawnoffL', 'L_arm_01'], R: ['sawnoffR', 'R_arm_025'] } },
    }));
    this.models.set('db12', await this.packGun({ pack: 'db12', item: 'db12', gun: 'db12', kind: 'rifle', hands: true, hip: HELD.db12, flashSize: 0.34, flash: mkFlash(), square: true, strip: [], ride: { base: 'stock_049', barrels: 'barrels_050', shells: 'shells_052' } }));
    this.models.get('db12')!.gait = true;
    // (it came with no pictures, its one paint a bare colour nearly black: lifted as the dark guns are it was still a
    // black cut-out. Painted a worn gunmetal here, its own paint and nobody else's: the name is Blender's default.)
    for (const o of [this.models.get('db12')!.root, this.models.get('db12')!.world]) o?.traverse((n) => {
      const mat = (n as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!mat?.isMeshStandardMaterial || mat.map || mat.userData.lifted) return;
      mat.userData.lifted = true;
      mat.color.setScalar(0.17);
      mat.metalness = 0.55;
      mat.roughness = Math.max(mat.roughness, 0.48);
      mat.envMapIntensity = 1.4;
    });
    const aksRide = { base: 'wpn_body_068', bolt: 'wpn_zatvor_069', trigger: 'wpn_trigger_070', mag: 'wpn_magazine_072' };
    this.models.set('aks74u', await this.packGun({ pack: 'aks74u', item: 'aks74u', gun: 'aks74u', kind: 'auto', hands: true, hip: HELD.aks74u, flashSize: 0.3, flash: mkFlash(), square: true, strip: [], ride: aksRide, spare: ['wpn_magazine_2_074', aksRide.mag] }));
    const mp7Ride = { base: 'body_0161', stock: 'stock_0162', foregrip: 'foregrip_0170', mag: 'mag_0167', bolt: 'bolt_handle_0172', trigger: 'trigger_0164', safety: 'fire_switch_0156', silencer: 'silencer_0173', sightF: 'front_scope_0174', sightR: 'back_scope_0175', sight: 'scope_0177' };
    const mp7 = await this.packGun({ pack: 'mp7a1', item: 'mp7a1', gun: 'mp7a1', kind: 'auto', hands: true, hip: HELD.mp7a1, flashSize: 0.22, flash: mkFlash(), square: true, strip: [], ride: mp7Ride });
    mp7.gait = true;
    this.models.set('mp7a1', mp7);
    const scorpRide = { base: 'Weapon_0725', bolt: 'Changing_handle_0726', trigger: 'Trigger_0728', safety: 'Firemode_0727', mag: 'Magazine_0730' };
    const scorpion = await this.packGun({ pack: 'scorpion', item: 'scorpion', gun: 'scorpion', kind: 'auto', hands: true, hip: HELD.scorpion, flashSize: 0.24, flash: mkFlash(), square: true, strip: ['Object_11', 'Object_19'], ride: scorpRide, spare: ['Magazine_2_0732', scorpRide.mag] });
    // (its own walk and run, and its own look over the gun on I)
    scorpion.gait = true;
    this.models.set('scorpion', scorpion);
    const smgMark = magMark(extractParts(await assets.model('smg')));
    const inSmg = async (item: string, gun: string, flashSize: number, more: Record<string, string> = {}) => {
      const mark = magMark(extractParts(await assets.model(gun)));
      const set = IN_SMG[item];
      const euler = (t?: [number, number, number]) => new THREE.Euler(...(t ?? [0, 0, 0]));
      const m = await this.packGun({
        pack: 'smg', item, gun, kind: 'pistol', hip: HELD.smgPistol, flashSize, flash: mkFlash(), ownArms: true, square: true, strip: smgOwn, spare: smgSpare,
        ride: { base: smgRide.base, slide: smgRide.bolt, mag: smgRide.mag, ...more },
        seat: { move: (smgMark && mark ? smgMark.clone().sub(mark.multiplyScalar(set.size)) : new THREE.Vector3()).add(new THREE.Vector3(...set.move)), turn: euler(set.turn), size: set.size },
      });
      m.slideOn = smgRide.bolt;
      m.reseat = { body: smgRide.base, L: { move: new THREE.Vector3(...set.left.move), turn: new THREE.Quaternion().setFromEuler(euler(set.left.turn)), shoulder: SMG_SHOULDERS.L }, R: { shoulder: SMG_SHOULDERS.R } };
      m.gait = true;
      m.fast = { body: smgRide.base, to: [smgRide.mag, 'IK_Hand_Cntrl_R_037'] };
      if (m.grips) m.grips.carry = SMG_CARRY.pistol;
      this.models.set(item, m);
    };
    await inSmg('m9', 'm9', 0.2, { hammer: smgRide.base, trigger: smgRide.base, stopper: smgRide.base });
    await inSmg('colt', 'colt_1911', 0.22, { hammer: smgRide.base });
    await inSmg('deagle', 'desert_eagle', 0.3);
    // And the shotgun, in the rifle's hands: every piece of it rides on the rifle's body (nothing
    // on it moves by itself), in place of the rifle and everything on the rifle.
    this.models.set('benelli', await this.packGun({
      pack: 'sniper', item: 'benelli', gun: 'benelli_m3', kind: 'rifle', hip: HELD.sniper, flashSize: 0.34, flash: mkFlash(), nudge: NUDGE.benelli,
      strip: ['base', 'scope', 'glass', 'boltrear', 'bolt', 'cheekrest', 'trigger', 'clip', 'bullet', 'silencer'],
      ride: { base: 'base', sight: 'base', silencer: 'base', forend: 'base' },
    }));

    // The two assault rifles, in the hands that came with the AK. That pack's gun is drawn on its skeleton with
    // the arms: here it is the rifle alone, in the pieces its joints move, each hung on its joint (so that a part
    // can be put on it and taken off, and the AR-15 held in the same hands the same way), and the pack's own
    // drawing of it is put away. Its second magazine, the fresh one of a reload, is left as the pack draws it.
    const akRide = { base: 'PBody_058', bolt: 'Rif_059', safety: 'Safety_061', trigger: 'Trigger_060', mag: 'Pmag_062' };
    this.models.set('ak', await this.packGun({ pack: 'ak', item: 'ak', gun: 'ak', kind: 'auto', hip: HELD.ak, flashSize: 0.3, flash: mkFlash(), ownArms: true, square: true, strip: ['Object_97', 'Object_99'], ride: akRide, spare: ['Pmag2_063', akRide.mag] }));
    this.models.set('ar15', await this.packGun({
      pack: 'ak', item: 'ar15', gun: 'ar15', kind: 'auto', hip: HELD.ak, flashSize: 0.28, flash: mkFlash(), ownArms: true, square: true, strip: ['Object_97', 'Object_99'],
      ride: { base: akRide.base, mag: akRide.mag, brake: akRide.base, silencer: akRide.base, sight: akRide.base, foregrip: akRide.base, light: akRide.base },
      spare: ['Pmag2_063', akRide.mag],
    }));

    // ---- melee weapons: held upright in the right hand
    for (const id of ['hatchet', 'machete', 'crowbar', 'bat', 'shovel', 'knife', 'pitchfork']) {
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
    // ---- the knife, for whoever holds it: its own pack, hands and all, moved by its own animation (see BLADE).
    // What was made of it just above is still what everybody else sees in its holder's fist. Its arms are the
    // sniper's arms under another paint: they are drawn in the one pair of sleeves and gloves every gun of that
    // maker's is drawn in, which are the ones on a hatchet too.
    const blade = this.models.get('knife'), bladeFp = assets.manifest.models.knife_fp;
    if (blade && bladeFp?.rig) {
      const rig = new WeaponRig(await assets.gltfOf('knife_fp'), bladeFp.rig, packMaterial);
      if (this.sleeves) rig.repaint(/arm/i, this.sleeves);
      blade.root = new THREE.Group();
      blade.root.add(rig.root);
      blade.rig = rig;
      blade.hip = HELD.knife;
    }
    // ---- the pitchfork, for whoever holds it: its pack's movements in our own arms, the fork hung on its node
    const fork = this.models.get('pitchfork');
    if (fork && assets.manifest.models.pitchfork_fp?.rig) {
      const m = await this.packGun({ pack: 'pitchfork', item: 'pitchfork', gun: 'pitchfork', kind: 'rifle', hands: true, hip: HELD.pitchfork, flashSize: 0.01, flash: mkFlash(), strip: [], ride: { base: 'pitchfork' } });
      fork.root = m.root;
      fork.rig = m.rig;
      fork.hip = HELD.pitchfork;
    }
  }

  /**
   * A gun out of a weapon pack.
   * @param o.pack the pack whose arms and movements it is held with
   * @param o.gun the gun-alone model shown in them, if it is not the pack's own (its `base`, `slide` and `mag` ride on the pack's)
   */
  private sleeves: THREE.Material | null = null;
  /** the same for the packs that came with arms of their own (the AK's and the submachine gun's: one pair) */
  private sleevesOwn: THREE.Material | null = null;
  /**
   * What is in the hands is drawn with its pictures at the size they came (see Assets.sharpen): the gun with the
   * arms that hold it, or the thing held. Everything else in the world is drawn with the world's own copies.
   */
  private sharpGun: { of: VmModel; as: string; drop: () => void } | null = null;
  private warmed = '';
  private sharpHeld: { of: THREE.Object3D; drop: () => void } | null = null;
  private sharpenHands() {
    // (What is carried to fight with, and the arms it is held in, are fetched ahead: so that the pictures are in
    // the browser's keeping when the gun comes up, and only have to be unpacked.)
    const carried = [this.inv.slots.primary, this.inv.slots.secondary, this.inv.slots.holster].map((it) => it?.id ?? '').join();
    if (carried !== this.warmed) {
      this.warmed = carried;
      for (const id of carried.split(',')) {
        if (!id) continue;
        assets.warm(ITEMS[id].model);
        assets.warm(this.models.get(id)?.rig ? (['mosin', 'benelli'].includes(id) ? 'sniper_fp' : 'ak_fp') : '');
      }
    }
    const m = this.current;
    // (and again when what is fitted to it changes: a part put on is fetched then, one taken off is let go of)
    const as = this.currentItem ? `${this.currentItem.uid}|${fittedOf(this.currentItem).join()}` : '';
    if ((this.sharpGun?.of ?? null) !== m || (m && this.sharpGun!.as !== as)) {
      const was = this.sharpGun;
      this.sharpGun = m ? { of: m, as, drop: assets.sharpen(m.root, true) } : null;
      // (the new hold taken before the old is let go: what both want is never dropped between them)
      was?.drop();
    }
    const h = this.held?.root ?? null;
    if ((this.sharpHeld?.of ?? null) !== h) {
      this.sharpHeld?.drop();
      this.sharpHeld = h ? { of: h, drop: assets.sharpen(h, true) } : null;
    }
  }
  /** the lit mark of a holographic sight: one material, whichever gun it is on */
  private reticle: THREE.Material | null = null;

  /**
   * @param o.strip the pack's own pieces that are taken off for the gun that rides in its place
   * @param o.ride which of the pack's pieces each piece of that gun rides on (so: moves with)
   * @param o.nudge where that gun sits in the pack's hands, from where the fitting of one gun to the other left it (the gun's own space)
   */
  private async packGun(o: { pack: string; item: string; gun?: string; kind: GunKind; /** held in our own arms (the AK's pair), the pack's own not drawn: ./hands-on.ts */ hands?: boolean; /** a second of the gun, in the left hand: its pieces on these nodes, its flash, and what of the pack moves with each hand */ twin?: { ride: Record<string, string>; flash: MuzzleFlash; roots: { L: string[]; R: string[] } }; hip: THREE.Vector3; flash: MuzzleFlash; flashSize: number; strip?: string[]; ride?: Record<string, string>; nudge?: THREE.Vector3; /** the pack's arms are its own, and not the one pair every other gun is held in */ ownArms?: boolean; /** the pack holds its gun turned in to the middle of the picture: at the eye it is squared to the line of sight */ square?: boolean; /** a second magazine: [the piece it is hung on, the piece it is hung by] */ spare?: [string, string]; /** where it sits in the pack's hands, from where the pack's own gun does (the gun's own space): only in the hands, the gun as others see it is not moved */ seat?: { move: THREE.Vector3; turn?: THREE.Euler; size?: number } }): Promise<VmModel> {
    /** a gun held at the shoulder in both hands (anything that is not a pistol) */
    const long = o.kind !== 'pistol';
    /** what the gun's own body is hung on in the pack (and so what is fitted to it) */
    const onBody = o.ride?.base ?? 'base';
    const entry = assets.manifest.models[`${o.pack}_fp`];
    const rig = new WeaponRig(await assets.gltfOf(`${o.pack}_fp`), entry.rig!, packMaterial);
    if (o.seat) rig.seatAt(o.seat.move, o.seat.turn, o.seat.size);
    // one pair of sleeves and gloves whatever is held: the first pack's (the packs are one maker's, on one pair of arms)
    const sleeves = rig.material(/arm/i);
    // (a pack by another maker has arms laid out its own way: another's sleeves are not painted on them)
    // (The AK's pack and the submachine gun's are one maker's on one pair of arms, painted with the very same
    // pictures: every gun held in either is held in the one pair's paint, not each in a copy of it. Three pictures
    // of four thousand pixels a side were on the card once for each pack.)
    if (o.ownArms) {
      if (this.sleevesOwn) rig.repaint(/arm/i, this.sleevesOwn);
      else if (sleeves) this.sleevesOwn = sleeves;
    } else if (this.sleeves) rig.repaint(/arm/i, this.sleeves);
    else if (sleeves) this.sleeves = sleeves;
    // (the owner, 2026-10-17: "the hands should not change depending on the gun")
    if (o.hands) rig.wear(await assets.gltfOf('smg_fp'), assets.manifest.models.smg_fp.rig!, HELD.smg.clone().sub(o.hip), SMG_SHOULDERS, o.hip, (m) => this.sleevesOwn ?? packMaterial(m));
    const aloneId = o.gun ?? o.pack;
    const holds = assets.manifest.models[aloneId].holds!;
    // the gun alone (x along the barrel, y up): what is seen of it in everybody else's hands
    const alone = extractParts(await assets.model(aloneId));
    const world = new THREE.Group();
    world.rotation.y = Math.PI / 2;
    const span = new THREE.Box3();
    const top = new THREE.Box3();
    const nudge = o.nudge ?? new THREE.Vector3();
    const shown: [THREE.Object3D, string][] = [];
    /** the lit marks of whatever sights it has: seen only with the eye behind the sight */
    const marks: THREE.Object3D[] = [];
    const shows = ITEMS[o.item].weapon?.shows ?? {};
    const hides = ITEMS[o.item].weapon?.hides ?? {};
    /** the attachment a piece of the gun's own model goes with, if it is only there with one */
    const modOf = (piece: string) => Object.keys(shows).find((mod) => shows[mod].includes(piece));
    for (const p of alone) {
      const piece = p.name.replace(/_\d+$/, '');
      const mesh = new THREE.Mesh(p.geometry, packMaterial(p.material));
      mesh.name = piece;
      mesh.castShadow = false;
      world.add(mesh);
      p.geometry.computeBoundingBox();
      if (piece === 'base' || piece === 'slide') span.union(p.geometry.boundingBox!);
      if (piece === 'slide' || (piece === 'base' && long)) top.union(p.geometry.boundingBox!);
    }
    // A sight whose lens is painted into the gun's own picture, opaque (the MP7's: a solid orange disc in the middle of
    // the picture when aimed through): the lens is cut out of its shape, the faces that look along the barrel inside
    // the ring of its tube, front and back; the lit mark is put where it was, as in any other sight's glass.
    const lensOf = LENS[o.item];
    let lens: { at: THREE.Vector3; axis: THREE.Vector3 } | null = null;
    for (const p of lensOf ? alone : []) if (p.name.replace(/_\d+$/, '') === lensOf) lens = cutLens(p.geometry) ?? lens;
    // the muzzle, in the gun's own space: the front of the barrel, at the height of the bore
    const bore = o.kind === 'pistol' ? top.max.y - (top.max.y - top.min.y) * (FIT[o.item]?.bore ?? 0.42) : THREE.MathUtils.lerp(span.min.y, span.max.y, 0.62);
    const mouth = new THREE.Vector3(span.max.x, bore, (span.min.z + span.max.z) / 2);
    if (long) {
      // (a rifle's body goes down to the bottom of its grip and its barrel lies along the top of
      // it: the mouth is the middle of the foremost ring of the barrel itself, not a share of the height)
      const ring = new THREE.Box3();
      const v = new THREE.Vector3();
      for (const p of alone) {
        if (p.name.replace(/_\d+$/, '') !== 'base') continue;
        const P = p.geometry.getAttribute('position');
        for (let i = 0; i < P.count; i++) if (v.fromBufferAttribute(P, i).x > span.max.x - 0.01) ring.expandByPoint(v);
      }
      if (!ring.isEmpty()) ring.getCenter(mouth).setX(span.max.x);
    }
    // Sights of its own for a rifle that came with none (the sniper: whoever made it meant it for a scope, and
    // with the scope off there was nothing to aim along but a cross drawn on the screen). A post at the muzzle
    // and a notch ahead of the breech, as the old rifle had. They are not out of a model: a blade and two small
    // blocks of steel made here, a few millimetres each, set on the barrel where its own shape is highest.
    let ironPost: THREE.Object3D | null = null;
    if (PLAIN_SIGHTS.has(o.item)) {
      // Where the gun's own top is under each of them is found by looking straight down on its shape there. (Not
      // from its points: a barrel is a few rings of them a long way apart, and the nearest ring to the notch was
      // the rail's, a finger higher than the barrel under it: the sights stood in the air over the gun.)
      const solids = alone.filter((p) => p.name.replace(/_\d+$/, '') === 'base').map((p) => new THREE.Mesh(p.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
      const down = new THREE.Raycaster();
      const topAt = (x: number, half = 0) => {
        let top = -Infinity;
        for (const dx of half ? [-half, 0, half] : [0]) {
          down.set(new THREE.Vector3(x + dx, span.max.y + 1, mouth.z), new THREE.Vector3(0, -1, 0));
          for (const solid of solids) for (const h of down.intersectObject(solid)) top = Math.max(top, h.point.y);
        }
        return top;
      };
      // The notch stands on the back end of the rail the scope goes on (the highest stretch of the gun's top,
      // about its middle: anywhere ahead of it and the rail itself would be in the way of the eye), and the
      // post on the barrel a finger back from its mouth, as tall as brings its tip level with the notch.
      const long = span.max.x - span.min.x;
      let peak = -Infinity, railBack = span.min.x + long * 0.56;
      for (let k = 0; k <= 60; k++) peak = Math.max(peak, topAt(span.min.x + long * (0.3 + (0.4 * k) / 60)));
      for (let k = 0; k <= 60; k++) {
        const x = span.min.x + long * (0.3 + (0.4 * k) / 60);
        if (topAt(x) > peak - 0.004) {
          railBack = x;
          break;
        }
      }
      const xr = railBack + 0.016, xf = span.max.x - 0.02;
      const rearTop = topAt(xr, 0.009), muzzleTop = topAt(xf, 0.006);
      if (Number.isFinite(muzzleTop) && Number.isFinite(rearTop)) {
        const line = Math.max(rearTop + 0.0085, muzzleTop + 0.011);
        const steel = new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.8, roughness: 0.5 });
        const block = (w: number, h: number, d: number, x: number, y0: number, z: number) => {
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), steel);
          mesh.position.set(x, y0 + h / 2, z);
          mesh.castShadow = false;
          return mesh;
        };
        const make = () => {
          const g = new THREE.Group();
          g.name = 'irons';
          // (at the muzzle: a band let into the top of the barrel, a tower on it, and the blade on that)
          g.add(block(0.018, 0.006, 0.014, xf, muzzleTop - 0.004, mouth.z));
          g.add(block(0.012, line - 0.006 - muzzleTop, 0.007, xf, muzzleTop + 0.001, mouth.z));
          const blade = block(0.005, 0.007, 0.0022, xf, line - 0.007, mouth.z);
          blade.name = 'post';
          g.add(blade);
          // (on the rail: a block let a little into its teeth, and the two ears of the notch)
          g.add(block(0.022, line - 0.0045 - rearTop + 0.002, 0.018, xr, rearTop - 0.002, mouth.z));
          for (const side of [-1, 1]) g.add(block(0.005, 0.0062, 0.0058, xr, line - 0.0045, mouth.z + side * 0.0056));
          return g;
        };
        world.add(make());
        const mine = make();
        mine.position.copy(nudge);
        rig.hang(mine, onBody);
        // (they are under the sight when one is on, where its mount stands: with it, they are put away)
        shown.push([mine, PLAIN_SIGHTS.has(o.item) && o.item !== 'mosin' ? '!red_dot' : '!pu_scope']);
        ironPost = mine.getObjectByName('post') ?? null;
      }
    }
    let suppressor: THREE.Object3D | undefined;
    if (o.kind === 'pistol' || ITEMS.suppressor_9.attach!.fits.includes(o.item)) {
      const steel = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.85, roughness: 0.55 });
      const far = new THREE.Mesh(suppressorGeometry(), steel);
      far.name = 'suppressor';
      far.position.copy(mouth);
      world.add(far);
      suppressor = new THREE.Mesh(suppressorGeometry(), steel);
      suppressor.position.copy(mouth);
      suppressor.visible = false;
      rig.hang(suppressor, onBody);
    }
    // (a gun that sits elsewhere in the hands than its fitting left it: every piece of it, and the mouth of its barrel)
    for (const c of world.children) c.position.add(nudge);
    mouth.add(nudge);
    if (suppressor) suppressor.position.copy(mouth);
    for (const c of world.children) if (c.name === 'suppressor') c.position.copy(mouth);
    /** the gun's own pieces as they are in the hands: by the name each has in its own file */
    const hung = new Map<string, THREE.Object3D>();
    const twinHung = new Map<string, THREE.Object3D>();
    if (o.gun) {
      rig.strip(o.strip ?? ['base', 'slide', 'mag', 'hammer', 'trigger', 'stopper', 'shell_1']);
      for (const [piece, on] of Object.entries(o.ride ?? { base: 'base', slide: 'slide', mag: 'mag' })) {
        const g = new THREE.Group();
        for (const c of world.children) if (c.name === piece) g.add(c.clone());
        if (!g.children.length) continue;
        rig.hang(g, on);
        hung.set(piece, g);
        const mod = modOf(piece);
        if (mod) shown.push([g, mod]);
        // (and a piece that comes off when something goes on in its place)
        const off = Object.keys(hides).find((m) => hides[m].includes(piece));
        if (off) shown.push([g, `!${off}`]);
      }
      // (the left hand's gun of a pair: the same pieces again, on that gun's own nodes, hung by where the right one's
      // stand: they are the right gun's pieces, put where the left gun is)
      for (const [piece, on] of Object.entries(o.twin?.ride ?? {})) {
        const g = new THREE.Group();
        for (const c of world.children) if (c.name === piece) g.add(c.clone());
        if (!g.children.length) continue;
        rig.hang(g, on, o.ride?.[piece] ?? on);
        twinHung.set(piece, g);
        const mod = modOf(piece);
        if (mod) shown.push([g, mod]);
      }
      // a second magazine, the fresh one of a reload: the same magazine, hung on its own joint as the first is on its
      // (there when the first is: with a drum in the gun, the fresh one is a drum, made below)
      if (o.spare && hung.has('mag')) {
        const again = hung.get('mag')!.clone();
        again.userData.fresh = true;
        rig.hang(again, o.spare[0], o.spare[1]);
        // (a gun whose magazine is always drawn: its fresh one is there for whichever magazine is coming)
        shown.push([again, modOf('mag') ?? '*']);
      }
    } else {
      // the pack's own gun: the pieces of it that are only there with something fitted
      for (const [mod, pieces] of Object.entries(shows)) for (const piece of pieces) {
        const n = rig.node(piece);
        if (n) shown.push([n, mod]);
      }
    }
    for (const piece of ITEMS[o.item].weapon?.never ?? []) rig.show(piece, false);

    // ---- what is fitted from another model: the holographic sight, the light
    const fit = FIT[o.item];
    let dotAt: THREE.Vector3 | null = null;
    let lamp: THREE.Vector3 | null = null;
    /** @param only the pieces of that model wanted, by name (all of it, where not said) */
    const fitted = async (name: string, modelId: string, at: [number, number, number], size: number, on: string, place: (obj: THREE.Object3D, box: THREE.Box3) => void, twin?: [string, string], only?: RegExp) => {
      const make = async () => {
        const obj = new THREE.Group();
        obj.name = name;
        for (const p of modelId === 'holo' ? await holoParts() : extractParts(await assets.model(modelId), only ? (n) => only.test(n) : undefined)) {
          const reticle = /crosshair/i.test((p.material as THREE.Material).name);
          const mesh = new THREE.Mesh(p.geometry, reticle ? reticleMaterial(p.material) : packMaterial(p.material));
          mesh.name = reticle ? 'reticle' : name;
          mesh.castShadow = false;
          if (reticle) {
            // (twice the size it was modelled, about its own middle: at arm's length it was a speck. And drawn last, over the glass.)
            this.reticle ??= mesh.material;
            p.geometry.computeBoundingBox();
            const mid = p.geometry.boundingBox!.getCenter(new THREE.Vector3());
            mesh.scale.setScalar(2);
            mesh.position.copy(mid).multiplyScalar(-1);
            mesh.renderOrder = 20;
          }
          obj.add(mesh);
        }
        obj.scale.setScalar(size);
        const box = new THREE.Box3().setFromObject(obj);
        obj.position.set(at[0], at[1], at[2]).add(nudge);
        place(obj, box);
        return obj;
      };
      // (the lit mark is for the eye behind the glass: on the gun as others see it, or lying on a shelf, there is none)
      const theirs = await make();
      theirs.getObjectByName('reticle')?.removeFromParent();
      world.add(theirs);
      const mine = await make();
      const mark = mine.getObjectByName('reticle');
      if (mark) marks.push(mark);
      rig.hang(mine, on);
      shown.push([mine, name]);
      // (and once more where the pack has a second of it: the fresh magazine of a reload)
      if (twin) {
        const again = await make();
        again.userData.fresh = true;
        rig.hang(again, twin[0], twin[1]);
        shown.push([again, name]);
      }
      return mine;
    };
    if (fit?.dot) {
      // (it stands on its foot: the model's own ground is the bottom of it)
      const dot = await fitted('red_dot', 'holo', fit.dot.at, fit.dot.size, o.kind === 'pistol' ? o.ride?.slide ?? 'slide' : onBody, () => {});
      const ret = dot.getObjectByName('reticle');
      if (ret) {
        rig.root.updateMatrixWorld(true);
        dotAt = new THREE.Box3().setFromObject(ret).getCenter(new THREE.Vector3());
      }
    }
    // (the Elcan stands on its foot on the rail, as the holographic sight does: looked through, it is a scope)
    if (fit?.elcan) await fitted('elcan', 'elcan', fit.elcan.at, fit.elcan.size, onBody, () => {});
    if (fit?.light) {
      // the underside of the gun where the light goes: the lowest of its body within a finger's width of that place along it
      let under = Infinity;
      const v = new THREE.Vector3();
      for (const p of alone) {
        const piece = p.name.replace(/_\d+$/, '');
        if (piece !== 'base' && piece !== 'forend') continue;
        const P = p.geometry.getAttribute('position');
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i);
          if (Math.abs(v.x - fit.light.at[0]) < 0.015 && Math.abs(v.z - fit.light.at[2]) < 0.02) under = Math.min(under, v.y);
        }
      }
      const side = !!fit.light.side;
      const at: [number, number, number] = side ? fit.light.at : [fit.light.at[0], (fit.light.under ?? (Number.isFinite(under) ? under : 0)) + fit.light.at[1] + 0.003, fit.light.at[2]];
      // (Hung by its top: the model stands on its own ground, so it is let down by its height. On a gun's side it
      // is turned a quarter about the gun's length, its top to the gun, and stood off by that same height.)
      const light = await fitted('gun_light', 'gun_light', at, fit.light.size, onBody, (obj, box) => {
        if (!side) return void (obj.position.y -= box.max.y - box.min.y);
        obj.rotation.x = -Math.PI / 2;
        obj.position.z += box.max.y - box.min.y;
      });
      rig.root.updateMatrixWorld(true);
      const lb = new THREE.Box3().setFromObject(light);
      lamp = new THREE.Vector3((lb.min.x + lb.max.x) / 2, (lb.min.y + lb.max.y) / 2, lb.min.z);
    }
    // (A gun whose light is a piece of its own, the AR-15: the beam starts at the front of that piece. It was never
    // looked for, so that rifle's light could be fitted and seen and never switched on.)
    if (!lamp) {
      const own = (shows.gun_light ?? []).map((piece) => rig.node(piece)).filter((n): n is THREE.Object3D => !!n);
      if (own.length) {
        rig.root.updateMatrixWorld(true);
        const lb = new THREE.Box3();
        for (const n of own) lb.expandByObject(n);
        if (!lb.isEmpty()) lamp = new THREE.Vector3((lb.min.x + lb.max.x) / 2, (lb.min.y + lb.max.y) / 2, lb.min.z);
      }
    }
    if (fit?.grip) {
      // (the piece lies where it hung on its own rifle: it is brought here by the middle of its top)
      await fitted('foregrip', 'ar15', fit.grip.at, fit.grip.size, onBody, (obj, box) => {
        obj.position.x -= (box.min.x + box.max.x) / 2;
        obj.position.y -= box.max.y;
        obj.position.z -= (box.min.z + box.max.z) / 2;
      }, undefined, /^foregrip/);
    }
    // A magazine that is a model of its own (a drum, a long one): hung where the gun's own magazine hangs, by its
    // top, and there when it is the one in the gun.
    for (const [mag, f] of Object.entries(fit?.mags ?? {})) {
      await fitted(mag, f.model, f.at, f.size, o.ride?.mag ?? 'mag', (obj, box) => {
        obj.rotation.y = f.turn ?? 0;
        obj.position.y -= box.max.y - box.min.y;
      }, o.spare);
    }
    // A suppressor that is a model of its own, on the mouth of the barrel: laid along it from there.
    if (fit?.can && long) {
      const quiet = Object.values(ITEMS).find((d) => d.attach?.quiet && d.attach.fits.includes(o.item) && d.model === fit.can!.model);
      if (quiet) await fitted(quiet.id, fit.can.model, [mouth.x - nudge.x, mouth.y - nudge.y, mouth.z - nudge.z], fit.can.size, onBody, (obj, box) => {
        // (it stands on its own ground with its length along x: its back end is put on the mouth, its middle on the bore)
        obj.position.x -= box.min.x;
        obj.position.y -= (box.min.y + box.max.y) / 2;
      });
    }
    // (the rifle as others see it held: smaller, from the butt. Its pieces are moved along it
    // so that, drawn smaller, the butt is where it was; the hands' places move with them.)
    const seen = new THREE.Vector3();
    if (long) {
      seen.x = span.min.x * (1 / HELD_RIFLE - 1);
      for (const c of world.children) c.position.x += seen.x;
      world.scale.setScalar(HELD_RIFLE);
    }
    // where the barrel ends on the gun as it is held, for the flash of a shot somebody else fires (see Avatar.muzzle)
    world.userData.muzzle = [mouth.x + seen.x, mouth.y, mouth.z];
    // where things are in the eye's space with the pack at rest and not yet moved to the hip
    // (of a gun that rides in the pack's hands: its own pieces, where they hang there)
    // (A pistol is measured without what has been fitted to it. A sight stood on the slide is not the slide: with
    // it counted, the eye of a pistol that had NO sight on was set level with the top of the sight's hood and to
    // one side by its knob, and the gun's own sights lay under the middle of the picture and beside it.)
    const fittedOn = long ? [] : shown.map(([obj]) => [obj, obj.parent] as const).filter(([, parent]) => !!parent);
    for (const [obj] of fittedOn) obj.removeFromParent();
    rig.root.updateMatrixWorld(true);
    const boxOf = (piece: string, fallback: string) => (hung.has(piece) ? new THREE.Box3().setFromObject(hung.get(piece)!) : rig.box(fallback));
    // (a rifle with no sight piece of its own is measured by its body)
    const sight = long ? (hung.has('sight') ? boxOf('sight', 'base') : hung.has('base') ? boxOf('base', 'base') : rig.box('glass')) : boxOf('slide', 'slide');
    const frame = boxOf('base', 'base');
    for (const [obj, parent] of fittedOn) parent!.add(obj);
    rig.root.updateMatrixWorld(true);
    const c = sight.getCenter(new THREE.Vector3());
    // A pack that holds its gun turned in toward the middle of the picture and leaning over (the AK's: a degree
    // and a half in, six over, which is how such things are drawn to look right from the hip). Brought to the eye
    // as it stood, its front sight was a finger to the left of its rear one, its notch sloped, and nothing lined
    // up. It is turned as it comes up by what stands it upright with its sights (or, of a gun whose sights are not
    // said, its barrel) on the line of sight; and the eye is put by where things are once it is turned.
    const aimRot = new THREE.Euler();
    let lineAt: THREE.Vector3 | null = null;
    if (o.square && hung.has('base')) {
      rig.rest();
      rig.root.updateMatrixWorld(true);
      const G = hung.get('base')!.matrixWorld;
      const line = SIGHT_LINE[o.item];
      const notch = line ? new THREE.Vector3(...line.notch).add(nudge).applyMatrix4(G) : null;
      const f = line ? new THREE.Vector3(...line.post).add(nudge).applyMatrix4(G).sub(notch!).normalize() : new THREE.Vector3(1, 0, 0).transformDirection(G);
      const u = new THREE.Vector3(0, 1, 0).transformDirection(G);
      const r = new THREE.Vector3().crossVectors(f, u).normalize();
      u.crossVectors(r, f);
      // (what takes its right, its up and its back to the eye's: the turn that undoes how it stands)
      aimRot.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f.clone().negate()).transpose());
      if (notch) lineAt = notch.applyEuler(aimRot);
    }
    // (and one that squares the tube of a sight of its own to the eye, for when that is fitted: the MP7's sight looks
    // a degree off its folded irons, and squared to them the eye looked into the tube at a slant)
    const opticRot = new THREE.Euler();
    if (o.square && lens && hung.has('sight')) {
      rig.rest();
      rig.root.updateMatrixWorld(true);
      const G = hung.get('sight')!.matrixWorld;
      const f = lens.axis.clone().transformDirection(G), u = new THREE.Vector3(0, 1, 0).transformDirection(G);
      const r = new THREE.Vector3().crossVectors(f, u).normalize();
      u.crossVectors(r, f);
      opticRot.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f.clone().negate()).transpose());
    }
    const squared = (v: THREE.Vector3) => v.clone().applyEuler(aimRot);
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.add(rig.root);
    root.add(body);
    // aimed: the sights on the middle of the picture, a hand's width nearer than from the hip.
    // (A pistol's: the eye level with the top of them, so that what is aimed at sits on the front
    // post. A centimetre higher and the shot went into the air over the gun, with nothing to say where.)
    let irons = long ? null : new THREE.Vector3(-c.x, -sight.max.y - 0.002, o.hip.z + 0.07);
    if (!long && o.square && hung.has('slide')) {
      // (A pistol in a pack that holds its gun turned in and leaning: the back of the top of its slide, where its
      // notch is, as it stands once it is squared to the eye. The box of a slide that leans is not its top.)
      const sb = new THREE.Box3();
      for (const p of alone) if (p.name.replace(/_\d+$/, '') === 'slide') sb.union(p.geometry.boundingBox!);
      const rear = squared(new THREE.Vector3(sb.min.x, sb.max.y, (sb.min.z + sb.max.z) / 2).add(nudge).applyMatrix4(hung.get('slide')!.matrixWorld));
      irons = new THREE.Vector3(-rear.x, -rear.y - 0.002, o.hip.z + 0.07);
    }
    // A gun in the rifle's hands with sights of its own (the shotgun: a post at the muzzle, a notch on the action)
    // is aimed along them as a pistol is: the eye level with the top of the post, and in line with it. (It was
    // aimed as the rifle is without its scope, from over the action: the sights lay under the middle of the
    // picture and what was shot at was nowhere near them.) The post stands between two ears at the muzzle, which
    // are the highest things there: it is in the middle of the gun, and a little lower than they are.
    let post: THREE.Vector3 | null = null;
    if (long && hung.has('base')) {
      const base = hung.get('base')!, v = new THREE.Vector3();
      base.updateWorldMatrix(true, true);
      base.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (!mesh.isMesh) return;
        const P = mesh.geometry.getAttribute('position');
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld);
          if (v.z < frame.min.z + 0.1 && (!post || v.y > post.y)) post = (post ?? new THREE.Vector3()).copy(v);
        }
      });
    }
    if (ironPost) {
      // (the plain sights it was given: their post is the post)
      const bx = new THREE.Box3().setFromObject(ironPost);
      post = new THREE.Vector3((bx.min.x + bx.max.x) / 2, bx.max.y, (bx.min.z + bx.max.z) / 2);
    }
    // (through a holographic sight: the eye on the lit mark, a hand and a half behind the glass)
    // (a gun in the rifle's hands with a holographic sight of its own: the mark is put in its glass, which is the upper part of it)
    // (a sight whose lens was cut out: the middle of the ring it was in, as the gun holds it)
    const lensRig = lens && hung.has('sight') ? lens.at.clone().add(nudge).applyMatrix4(hung.get('sight')!.matrixWorld) : null;
    const glassY = (lensRig ? lensRig.y : THREE.MathUtils.lerp(sight.min.y, sight.max.y, 0.7)) + (GLASS[o.item]?.[1] ?? 0);
    /** across: the middle of the glass, where the box of the whole sight, its knobs and its mount, is not that */
    const glassX = (lensRig ? lensRig.x : c.x) + (GLASS[o.item]?.[0] ?? 0);
    if (hung.has('sight') && this.reticle) {
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 0.014), this.reticle);
      mark.name = 'reticle';
      mark.renderOrder = 20;
      mark.position.set(glassX, glassY, (sight.min.z + sight.max.z) / 2);
      const holder = hung.get('sight')!;
      holder.updateWorldMatrix(true, false);
      mark.applyMatrix4(new THREE.Matrix4().copy(holder.matrixWorld).invert());
      holder.add(mark);
      marks.push(mark);
    }
    // (a rifle with a holographic sight stood on it from another model: the eye on its mark, as a pistol's)
    const glassAt = new THREE.Vector3(hung.size ? glassX : c.x, hung.size ? glassY : c.y, (sight.min.z + sight.max.z) / 2);
    const through = lensRig ? glassAt.clone().applyEuler(opticRot) : squared(glassAt);
    const lit = dotAt ? squared(dotAt) : null;
    const ads = long && !lit ? new THREE.Vector3(-through.x, -through.y, -sight.max.z - (hung.size ? 0.2 : 0.075)) : lit ? new THREE.Vector3(-lit.x, -lit.y, o.hip.z + (long ? 0.02 : 0.07)) : irons!;
    const fc = frame.getCenter(new THREE.Vector3());
    const tip = post ? squared(post as THREE.Vector3) : null;
    const mouthAt = long && hung.has('base') ? frontOf(hung.get('base')!) : null;
    if (suppressor) shown.push([suppressor, 'suppressor_9']);
    // the forward hand's place for whoever is seen holding it (see FORE): the fore-end's underside is looked for
    // straight up from under the gun, through every piece always on it (not the magazine, nor what comes with an attachment)
    const fore = long ? FORE[o.item] : undefined;
    let foreAt: THREE.Vector3 | null = null, foreOn: 'under' | 'post' = 'under';
    if (typeof fore === 'number') {
      const x = holds.right[0] + SEAT.rifle.x + fore;
      const up = new THREE.Raycaster(new THREE.Vector3(x, span.min.y - 1, mouth.z), new THREE.Vector3(0, 1, 0));
      let low = Infinity;
      for (const p of alone) {
        const piece = p.name.replace(/_\d+$/, '');
        if (modOf(piece) || /^(mag|bullet|shell)/.test(piece)) continue;
        for (const h of up.intersectObject(new THREE.Mesh(p.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })))) low = Math.min(low, h.point.y);
      }
      if (low < Infinity) foreAt = new THREE.Vector3(x, low, mouth.z);
    } else if (fore) [foreAt, foreOn] = [new THREE.Vector3(...fore.post, mouth.z), 'post'];
    const byTrigger = long ? BY_TRIGGER[o.item] : undefined;
    let triggerAt: THREE.Vector3 | null = Array.isArray(byTrigger) ? new THREE.Vector3(...byTrigger, mouth.z) : null;
    if (byTrigger === true) {
      const t = new THREE.Box3();
      for (const p of alone) if (p.name.replace(/_\d+$/, '') === 'trigger') t.union(p.geometry.boundingBox!);
      if (!t.isEmpty()) triggerAt = t.getCenter(new THREE.Vector3());
    }
    const m: VmModel = {
      root, kind: o.kind, flash: o.flash, body, rig, world, suppressor, brass: !!o.gun, shown, marks,
      hammer: HAMMER[o.item] && hung.has('hammer') ? { piece: hung.get('hammer')!, at: new THREE.Vector3(HAMMER[o.item].at[0], HAMMER[o.item].at[1], 0).add(nudge), down: HAMMER[o.item].down } : undefined,
      scope: rig.node('scope') ?? undefined,
      wrap: rig.node('cheekrest') ?? undefined,
      hip: o.hip.clone(),
      hipRot: new THREE.Euler(0, 0, 0),
      ads,
      optic: ITEMS[o.item].weapon?.optic ?? (long ? (hung.size ? 'red_dot' : 'pu_scope') : dotAt ? 'red_dot' : undefined),
      ownSights: !!post,
      lamp: lamp ?? undefined,
      // without its optic the eye goes along the top of the action (a pistol's: along its own sights)
      adsIron: ITEMS[o.item].weapon?.fixedSight ? undefined : long ? (lineAt ? new THREE.Vector3(-lineAt.x, -lineAt.y, o.hip.z + (SIGHT_LINE[o.item]?.near ?? IRON_NEAR)) : tip ? new THREE.Vector3(-(ironPost ? tip.x : mouthAt ? squared(mouthAt).x : fc.x), -tip.y + IRON_DROP, o.hip.z + IRON_NEAR) : new THREE.Vector3(-fc.x, -frame.max.y - 0.018, o.hip.z + 0.1)) : dotAt ? irons! : undefined,
      aimRot: o.square ? aimRot : undefined,
      aimRotOptic: lensRig && o.square ? opticRot : undefined,
      // (a rifle's: the mouth of the barrel itself. Three fifths of the way up its body is under the barrel.)
      muzzle: (long ? (hung.has('base') ? frontOf(hung.get('base')!) : rig.front('base')) : null) ?? new THREE.Vector3(fc.x, long ? THREE.MathUtils.lerp(frame.min.y, frame.max.y, 0.62) : c.y, frame.min.z),
      // For whoever is seen holding it. The hands start where the pack's own hands are, and are
      // then moved by what it took, looking close, to seat the body's hands on it: they are
      // bigger than the pack's and their wrists are further from their palms, so set down wrist
      // on wrist they held a pistol by the bottom of its grip, and a rifle a hand's breadth
      // behind its trigger. The first finger is kept nearly straight: it lies in the guard.
      grips: long
        ? {
            right: { pos: (triggerAt ? triggerAt.clone().add(TRIGGER_WRIST) : new THREE.Vector3(...holds.right).add(SEAT.rifle)).add(seen), fingers: new THREE.Vector3(0.75, -0.55, -0.3), palm: new THREE.Vector3(0.15, -0.1, -1), curl: [0.25, 1.2, 1.25, 1.3], thumb: 0.5 },
            left: foreAt ? foreHold(foreAt.clone().add(seen), foreOn === 'post') : { pos: new THREE.Vector3(...holds.left).add(SEAT.fore).add(seen), fingers: new THREE.Vector3(0.35, 0.1, 0.93), palm: new THREE.Vector3(0, 1, 0.1), curl: [1.0, 1.05, 1.1, 1.15], thumb: 0.4 },
            foregrip: FOREGRIP_POST[o.item] ? foreHold(new THREE.Vector3(...FOREGRIP_POST[o.item], mouth.z).add(seen), true) : undefined,
            work: WORK_ON[o.item],
          }
        : {
            right: { pos: PISTOL_HOLD.right.clone().add(SEAT_ON[o.item] ?? NO_SEAT).add(new THREE.Vector3(0, 0, APART_ON[o.item]?.[0] ?? 0)), fingers: new THREE.Vector3(0.9, -0.15, -0.3), palm: new THREE.Vector3(0.3, 0, -1), curl: PISTOL_HOLD.curl.right, thumb: 1.25 },
            left: { pos: PISTOL_HOLD.left.clone().add(SEAT_ON[o.item] ?? NO_SEAT).add(new THREE.Vector3(0, 0, APART_ON[o.item]?.[1] ?? 0)), fingers: new THREE.Vector3(0.85, -0.2, 0.35), palm: new THREE.Vector3(0, 0.4, 1), curl: PISTOL_HOLD.curl.left, thumb: 1.2 },
          },
    };
    // (a pair: each fist round its own gun's grip, the left the right's mirror; see AKIMBO_GAP)
    if (ITEMS[o.item].weapon?.akimbo && m.grips?.right) {
      const r = m.grips.right, half = AKIMBO_GAP / 2;
      m.grips = {
        right: { ...r, pos: r.pos.clone().setZ(r.pos.z + half) },
        left: { ...r, pos: r.pos.clone().setZ(2 * mouth.z - r.pos.z - half), fingers: r.fingers.clone().setZ(-r.fingers.z), palm: r.palm.clone().setZ(-r.palm.z) },
        // (out in front, pointing ahead, not a pistol's low ready with the muzzle at the ground: at the waist, and at the chest aimed)
        stand: { ready: { p: [0.03, -0.3, -0.42], r: [-0.15, 0, 0] }, aim: { p: [0.03, -0.08, -0.42], r: [0, 0, 0] } },
      };
    }
    // (the flash rides on the gun, so it goes where the barrel goes in the kick)
    o.flash.root.position.copy(m.muzzle);
    body.add(o.flash.root);
    if (o.twin) {
      rig.rest();
      rig.root.updateMatrixWorld(true);
      const tb = twinHung.get('base');
      const at = (tb ? frontOf(tb) : null) ?? m.muzzle.clone();
      o.twin.flash.root.position.copy(at);
      body.add(o.twin.flash.root);
      m.twin = { flash: o.twin.flash, muzzle: at, roots: o.twin.roots, shotT: { L: 9, R: 9 } };
    }
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

  /** What is slung on the back and not in the hands (two places: either, both or neither): each thing, and what is fitted to it. */
  slung(): [string, string[]][] {
    return [this.inv.slots.primary, this.inv.slots.secondary].filter((it): it is ItemInstance => !!it && it !== this.currentItem).map((it) => [it.id, fittedOf(it)]);
  }

  /** world-space models of what is slung on the back, for the avatar */
  slungModel(): THREE.Object3D[] {
    return this.slungOf(this.slung());
  }

  /** The same for anybody's back: by what their game says is on it. */
  slungOf(list: [string, string[]][]): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const [id, fitted] of list) {
      const m = this.models.get(id);
      if (m?.kind === 'melee') {
        // A thing to hit with is drawn standing on its handle, and a gun lying along its barrel: laid along the
        // same line as a gun, about its own middle, it is slung as a gun is (left as it stands, it stuck straight
        // out of the back).
        const body = this.worldModel(id);
        if (!body) continue;
        body.position.set(0, 0, 0);
        body.rotation.set(0, 0, 0);
        body.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(body);
        const lie = new THREE.Group();
        body.position.y = -(box.min.y + box.max.y) / 2;
        lie.add(body);
        lie.rotation.z = -Math.PI / 2;
        const held = new THREE.Group();
        held.add(lie);
        out.push(held);
        continue;
      }
      const obj = m?.world ? this.dressed(m, id, fitted) : m ? m.root.children[0] : null;
      if (obj) out.push(obj);
    }
    return out;
  }

  /** a pack's gun alone, with the pieces that go with what is fitted to it */
  private dressed(m: VmModel, id: string, mods: string[]): THREE.Object3D {
    const c = m.world!.clone();
    // (Plain sights are put away under the sight that stands where they do. A piece that is a thing of its own out
    // of another model, a drum or a suppressor or a long magazine, is named for that thing and is there when it is
    // fitted: it was asked of the gun's own pieces, which know nothing of it, and every AK anybody was seen
    // holding had its drum and its suppressor on.)
    const optic = PLAIN_SIGHTS.has(id) && id !== 'mosin' ? 'red_dot' : 'pu_scope';
    for (const piece of c.children) piece.visible = piece.name === 'irons' ? !mods.includes(optic) : EXTRA[piece.name] ? mods.includes(EXTRA[piece.name]) : ITEMS[piece.name]?.attach || ITEMS[piece.name]?.mag ? mods.includes(piece.name) : pieceShown(id, piece.name, mods);
    return c;
  }

  /** a copy of a weapon's body for showing in someone's hands in the world (third person) */
  worldModel(id: string, mods: string[] = []): THREE.Object3D | null {
    const m = this.models.get(id);
    if (!m) return null;
    if (m.world) {
      const c = this.dressed(m, id, mods);
      if (ITEMS[id]?.weapon?.akimbo) {
        const left = c.clone();
        for (const p of c.children) p.position.z += AKIMBO_GAP / 2;
        for (const p of [...left.children]) {
          p.position.z -= AKIMBO_GAP / 2;
          c.add(p);
        }
      }
      return c;
    }
    const src = m.body ?? m.root.children[0];
    const wasVisible = [m.scope, m.wrap, m.suppressor, m.mag].map((o) => o?.visible);
    if (m.scope) m.scope.visible = mods.includes('pu_scope') || !!ITEMS[id]?.weapon?.ownScope;
    if (m.wrap) m.wrap.visible = mods.includes('rifle_wrap');
    if (m.suppressor) m.suppressor.visible = mods.includes('suppressor_9');
    if (m.mag) m.mag.visible = true;
    const c = src.clone();
    [m.scope, m.wrap, m.suppressor, m.mag].forEach((o, i) => o && (o.visible = !!wasVisible[i]));
    return c;
  }

  /**
   * A gun with everything that is fitted to it, as it is seen in somebody's hands, for laying on the ground (see
   * `ItemModels.dressed`). Null for a gun that has no such copy of itself: an old one, whose own model shows what
   * it has on it.
   */
  lyingModel(id: string, mods: string[] = []): THREE.Object3D | null {
    const m = this.models.get(id);
    return m?.world ? this.dressed(m, id, mods) : null;
  }

  /** grip points of a weapon model (same ones the first-person arms use) */
  gripsOf(id: string, mods: string[] = []): Grips | null {
    const g = this.models.get(id)?.grips ?? null;
    return g?.foregrip && mods.includes('foregrip') ? { ...g, left: g.foregrip } : g;
  }

  private modes = new Map<string, FireMode>();
  fireMode(item: ItemInstance): FireMode {
    const def = ITEMS[item.id];
    return this.modes.get(item.uid) ?? def.weapon?.modes?.[0] ?? 'semi';
  }

  get busy() {
    return this.action !== null;
  }

  /** the hands are in the middle of something that has to be seen through: a reload, a blow */
  get working() {
    const n = this.action?.name;
    return n === 'reload' || n === 'magswap' || n === 'swing' || n === 'punch';
  }

  get equippedItem() {
    return this.currentItem;
  }

  /**
   * Are the hands empty? Nothing is held; or what was held is being put away with nothing to come out after
   * it (the pace picks up as the gun goes down, not a third of a second after: it is the key that is felt).
   */
  get handsEmpty() {
    return !this.currentItem || (this.action?.name === 'unequip' && this.action.data?.away === 1);
  }

  /** current weapon status for the HUD */
  status() {
    const it = this.currentItem;
    if (!it) return { name: 'Fists', ammo: null as null | { loaded: number; reserve: number; cap: number; mags?: number; bare?: boolean }, action: this.action?.name ?? null, mode: null as FireMode | null, zero: null as number | null };
    const def = ITEMS[it.id];
    if (!def.weapon) return { name: def.name, ammo: null as null | { loaded: number; reserve: number; cap: number; mags?: number; bare?: boolean }, action: this.action?.name ?? null, mode: null as FireMode | null, zero: null as number | null };
    // (a gun fed by a magazine: what its magazine holds, and what is in the others carried for it; the rounds loose in the pockets are not its to fire)
    const spare = def.weapon.mag ? this.magsFor(it) : null;
    return {
      name: def.name,
      ammo: spare
        ? { loaded: it.loaded ?? 0, reserve: spare.reduce((n, m) => n + (m.rounds ?? 0), 0), cap: magRoom(it), mags: spare.length, bare: !it.mag }
        : { loaded: it.loaded ?? 0, reserve: this.inv.count(def.weapon.ammo), cap: capacityOf(it) },
      action: this.action?.name ?? null,
      mode: def.weapon.modes ? this.fireMode(it) : null,
      // (the range its sights are set for, where that can be changed)
      zero: (GUNS[it.id]?.zero.length ?? 0) > 1 ? zeroOf(it.id, it.zero) : null,
    };
  }

  /** every magazine carried that goes into this gun */
  private magsFor(gun: ItemInstance): ItemInstance[] {
    const out: ItemInstance[] = [];
    for (const c of this.inv.containers) for (const p of c.items) if (magFits(p.item, gun)) out.push(p.item);
    return out;
  }

  /**
   * One magazine out and another in, when the hands have done it (see `swapMag` for what becomes of the rounds):
   * the new one out of its pocket, the old one into a pocket, or onto the ground if there is no room for it.
   */
  private changeMag(gun: ItemInstance, next: ItemInstance) {
    // (put down, handed over or emptied while the hands were at it)
    if (!this.inv.containerOf(next)) return;
    this.inv.remove(next);
    const out = swapMag(gun, next);
    const left = out ? this.inv.add(out) : null;
    if (left) this.onSpill(left);
    this.onCarried();
  }

  private start(name: Action['name'], dur: number, done?: () => void, data?: Record<string, number>) {
    this.action = { name, t: 0, dur, done, data };
  }

  /** What the body's own place holds is taken into the hands (null: the hands are emptied). */
  equip(slot: Slot | null) {
    this.take(slot ? this.inv.slots[slot] : null);
  }

  /**
   * Something carried is taken into the hands: off the back, out of the holster, or out of a pocket (null: the
   * hands are emptied). A gun or a thing to hit with is this code's to draw and work; anything else is held by
   * the game (see `ready` in game.ts), and here the hands are simply made free for it.
   */
  take(item: ItemInstance | null) {
    // (Asked for while another is still coming up, it waits for that: changed at once, the one half drawn was
    // gone and the next was there in a single frame.)
    if (this.action?.name === 'equip') {
      this.wanted = item;
      return;
    }
    this.wanted = undefined;
    if (this.action) return;
    const armed = (it: ItemInstance | null) => (it && (ITEMS[it.id].weapon || ITEMS[it.id].melee) ? it : null);
    const next = armed(item);
    if (next === this.currentItem) {
      // (the same gun, or still nothing that is this code's: only what the inventory says is held changes)
      this.inv.hold(item);
      return;
    }
    const swap = () => {
      if (this.current) this.vmRoot.remove(this.current.root);
      this.currentItem = next;
      this.inv.hold(item);
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
    if (this.current) this.start('unequip', 0.28, swap, { away: next ? 0 : 1 });
    else swap();
  }

  /** inventory changed under us (item dropped / moved) */
  validate() {
    const held = this.inv.held();
    const item = held && (ITEMS[held.id].weapon || ITEMS[held.id].melee) ? held : null;
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

  /**
   * The sights set for a longer range or a shorter (Page Up, Page Down, as it is done in DayZ): a click of the
   * drum, and the barrel points that much higher for the round to come down onto the mark at that distance. A
   * gun with one setting has no drum to turn.
   */
  setZero(item: ItemInstance, by: 1 | -1) {
    const steps = GUNS[item.id]?.zero;
    if (!steps || steps.length < 2) return;
    const at = steps.indexOf(zeroOf(item.id, item.zero));
    const next = steps[Math.max(0, Math.min(steps.length - 1, at + by))];
    if (next === zeroOf(item.id, item.zero)) return;
    item.zero = next;
    audio.click(3000, 0.3, 0.012);
    this.onSay(`Sights set for ${next} m`, 'info');
    this.onCarried();
  }

  update(dt: number, input: Input, camera: THREE.PerspectiveCamera, enabled: boolean) {
    if (this.wanted !== undefined && !this.action) {
      const next = this.wanted;
      this.wanted = undefined;
      this.take(next);
    }
    this.time += dt;
    this.selectorT = Math.max(0, this.selectorT - dt);
    // (what is left of the frame a gun comes ready in is kept for its next shot: see `cooled`)
    this.fireCooldown = cooled(this.fireCooldown, dt);
    this.twinCool.L = cooled(this.twinCool.L, dt);
    this.twinCool.R = cooled(this.twinCool.R, dt);
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    this.updateBullets(dt);
    this.updateBrass(dt);
    // (and a pair's other gun's: it was never let go out, the owner: "the left hand gun does not clean up the fire muzzle")
    for (const m of this.models.values()) {
      m.flash.update(dt);
      m.twin?.flash.update(dt);
    }

    if (enabled && !this.player.dead) {
      // (which thing each number key brings up is the game's to say: the keys are bound to things, see game.ts)
      if (input.pressed('KeyX')) this.take(null);
      // (the wheel breaks off a reload before it does anything else)
      if (input.wheel !== 0 && this.abortReload()) input.wheel = 0;
      if (input.wheel !== 0 && !this.aiming) this.cycle(input.wheel > 0 ? 1 : -1);
      if (input.pressed('KeyB') && this.currentItem) this.toggleMode(this.currentItem);
      if (this.currentItem && (input.pressed('PageUp') || input.pressed('PageDown'))) this.setZero(this.currentItem, input.pressed('PageUp') ? 1 : -1);
    }

    const m = this.current;
    const item = this.currentItem;
    const def = item ? ITEMS[item.id] : null;
    const p = this.player;

    // ----- aiming
    // (nor on hands and feet up a steep face: see Player.handsBusy)
    const canAim = enabled && !this.held && !!m && !p.sprinting && !p.handsBusy && (!this.action || this.action.name === 'bolt') && !p.dead;
    // (a pair is not aimed down sights: its right button is its right hand's trigger)
    this.aiming = canAim && input.held('Mouse2') && !def?.weapon?.akimbo;
    this.spread = def?.weapon && item ? this.spreadNow(item.id) : 0;
    p.aiming = this.aiming;
    // a handy gun is at the eye in a fifth of a second; a long heavy one takes twice that
    const hd = handlingOf(item) ?? { ergo: 80, weight: 0.5, recoil: 1 };
    const upIn = THREE.MathUtils.lerp(0.46, 0.17, THREE.MathUtils.clamp((hd.ergo - 30) / 60, 0, 1));
    this.adsT += ((this.aiming ? 1 : 0) - this.adsT) * (1 - Math.exp(-(3 / upIn) * (this.aiming ? 1 : 0.85) * dt));
    this.scoped = !!m && ((m.kind === 'rifle' && (hasMod(this.currentItem, 'pu_scope') || !!ITEMS[this.currentItem!.id]?.weapon?.ownScope)) || hasMod(this.currentItem, 'elcan')) && this.adsT > 0.9 && this.aiming;
    this.applyMods();
    this.sprintT += (((p.sprinting && p.moving > 0.4) || p.handsBusy ? 1 : 0) - this.sprintT) * (1 - Math.exp(-8 * dt));
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
    this.wantShot = Math.max(0, this.wantShot - dt);
    // (shots close together are one string, however the trigger was worked: a quarter of a second without one ends it)
    this.sinceShot += dt;
    if (this.sinceShot > STRING_GAP) this.burst = 0;
    if (enabled && !this.held && m && item && def && !p.dead) {
      if (def.weapon) {
        const auto = this.fireMode(item) === 'auto';
        // Nobody shoots on the run. Sprinting, the gun is down across the body: the trigger
        // (or the other button, for the sights) stops the sprint, and the shot goes when the
        // gun has come up, a fifth of a second later. While it is being fired there is no
        // breaking back into a sprint between shots.
        const up = this.sprintT < SPRINT_OUT.up;
        if (input.held('Mouse0') || input.held('Mouse2')) p.sprintLock = Math.max(p.sprintLock, SPRINT_OUT.lock);
        if (m.twin) {
          // (a pair: the left button the left hand's gun, the right button the right's, each at its own pace)
          for (const [s, button] of [['L', 'Mouse0'], ['R', 'Mouse2']] as const) {
            if (input.pressed(button) && up) this.tryFire(m, item, camera, true, s);
            else if (auto && input.held(button) && up) this.tryFire(m, item, camera, false, s);
          }
        } else if (input.pressed('Mouse0')) {
          if (up) this.tryFire(m, item, camera, true);
          else this.wantShot = SPRINT_OUT.keep;
        } else if (this.wantShot > 0 && up) {
          this.wantShot = 0;
          this.tryFire(m, item, camera, true);
        } else if (auto && input.held('Mouse0') && up) {
          this.tryFire(m, item, camera, false);
        }
        if (input.pressed('KeyR') && !this.action) this.reload(m, item);
        // looked over, where its pack has that drawn: the trigger, the sights or a reload ends it
        // (The pistols and the submachine gun have it drawn. The rifles and the shotgun have not: what the sniper's
        // pack calls by that name is the rifle put away and brought up again. Those are turned over in the hands
        // instead, one side and then the other: see LOOK_OVER. 2026-10-11, asked for the sniper and the shotgun.)
        if (input.pressed('KeyI') && !this.action && !this.aiming && this.sprintT < 0.2) {
          const dur = this.checkDrawn(m) ? m.rig!.seconds('check') : LOOK_OVER.dur;
          this.start('check', dur);
          this.onAct('check', dur);
        }
        if (this.action?.name === 'check' && (input.pressed('Mouse0') || input.held('Mouse2') || input.pressed('KeyR') || this.sprintT > 0.5)) {
          this.action = null;
          this.onAct('stop', 0);
        }
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
    if (a?.data?.back) {
      // (a magazine change broken off: the hands go back the way they came, five times as fast, and it is not done)
      a.t -= dt * 5;
      if (a.t <= 0) this.action = null;
    } else if (a) {
      a.t += dt;
      this.actionTick(a, m, item);
      if (a.t >= a.dur) {
        this.action = null;
        a.done?.();
      }
    }

    // ----- scope sway (applied to the aim, so bullets follow it)
    const tired = (1 + (1 - p.vitals.stamina / MAX_STAMINA) * 2.5) * p.shake;
    const heft = THREE.MathUtils.clamp((100 - hd.ergo) / 60, 0.25, 1.2);
    const armsK = 1 + Math.pow(1 - this.armStamina, 2) * 2.6;
    const swayAmp = (this.scoped ? 0.0035 : this.aiming ? 0.0022 : 0.0012) * tired * (this.breath.held ? 0.15 : 1) * (p.prone ? 0.38 : p.crouched ? 0.6 : 1) * (hasMod(item, 'rifle_wrap') ? 0.75 : 1) * armsK * (0.75 + heft * 0.5);
    const t = this.time;
    const breathSway = new THREE.Vector2(Math.sin(t * 0.9) * 0.7 + Math.sin(t * 2.1) * 0.3, Math.sin(t * 1.3 + 1) * 0.6 + Math.cos(t * 0.7) * 0.4).multiplyScalar(swayAmp);
    const rec = this.aimRecoil.step(dt);
    p.aimOffset.set(breathSway.x + rec.x, breathSway.y + rec.y);
    // The part of the kick that stays, given to the view a share at a time: all of it gets there, the last
    // hair of it in one piece. (Whoever has died has no view to be thrown.)
    if (p.dead) this.rise.set(0, 0);
    else if (this.rise.x !== 0 || this.rise.y !== 0) {
      const share = this.rise.lengthSq() < 1e-10 ? 1 : 1 - Math.exp(-RISE * dt);
      p.pitch += this.rise.y * share;
      p.yaw -= this.rise.x * share;
      this.rise.multiplyScalar(1 - share);
    }

    this.animate(dt, input, camera);
  }

  /** which shot of a string the last one was, and how long ago it went */
  private burst = 0;
  private sinceShot = 9;
  /**
   * How far off the line of sight the next shot can land, radians (the full width of the
   * cone). At the eye and still it is the gun's own figure; moving opens it, being off the
   * ground opens it wide, crouching closes it a little. The crosshair is drawn this wide.
   */
  spread = 0;

  private spreadNow(id: string): number {
    const p = this.player;
    // (sliding down a steep face, nothing is steadier than it is in the air)
    return coneOf(id, { aimed: this.adsT, moving: p.movingSmooth, air: !p.grounded || p.footing === 'slide', crouched: p.crouched, prone: p.prone, heat: this.burst });
  }

  /** how long until each gun of a pair can fire again (its own pace: half the pair's) */
  private twinCool = { L: 0, R: 0 };
  /** @param side the hand whose gun of a pair fires */
  private tryFire(m: VmModel, item: ItemInstance, camera: THREE.PerspectiveCamera, trigger: boolean, side?: 'L' | 'R') {
    if (this.action || (side ? this.twinCool[side] > 0 : this.fireCooldown > 0)) return;
    const def = ITEMS[item.id];
    if (!def.weapon) return;
    if ((item.loaded ?? 0) <= 0 || !this.boltReady) {
      // (in the arena an empty gun is reloaded at the trigger, as in CS:GO)
      if (this.freeReload && (item.loaded ?? 0) <= 0) return this.reload(m, item);
      if (trigger) audio.dryFire();
      if (side) this.twinCool[side] = 0.25;
      else this.fireCooldown = 0.25;
      return;
    }
    item.loaded = (item.loaded ?? 0) - roundsSpent(this.endless);
    const kind = def.weapon.kind;
    // (what it fires and how it kicks: see src/sim/gunplay.ts)
    const gun = GUNS[item.id];
    const b = shotOf(item.id);
    const interval = intervalOf(item.id);
    this.burst++;
    this.sinceShot = 0;
    const suppressed = quietOf(item);
    const v0 = b.muzzleVel * (suppressed ? QUIETED : 1);
    // From the eye, along the way the gun is pointing (on the eye's own line unless it is still catching up with a
    // turn), and lifted by what brings the round back down onto that line at the range its sights are set for.
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.lag.y, this.lag.x, 0, 'YXZ')).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    // Lifted toward the sky, not toward the top of the picture: leaning, the eye is rolled over, and lifted its
    // own way a round went up and to one side (a rifle set for 600 m landed most of a metre off at a full lean).
    // A round falls straight down, and what is set against that is straight up from the line of the shot.
    const lift = new THREE.Vector3(0, 1, 0).addScaledVector(dir, -dir.y);
    // (pointing straight up or down there is no such way: the eye's own, as it was)
    if (lift.lengthSq() < 1e-6) lift.copy(up);
    dir.addScaledVector(lift.normalize(), elevationFor(v0, b.drag, zeroOf(item.id, item.zero))).normalize();
    // Somewhere in the cone it can land in: anywhere across it, as likely near the edge as the middle of a ring
    // of the same width (so most land a little way off the middle, few on it and few at the edge). The two rifles
    // with a string to learn are drawn in toward its middle: see `scatterOf`.
    const spread = this.spreadNow(item.id);
    const off = scatterOf(item.id, spread, Math.random(), Math.random()), round = Math.random() * Math.PI * 2;
    dir.addScaledVector(right, Math.cos(round) * off).addScaledVector(up, Math.sin(round) * off).normalize();
    // (a launcher fires a grenade, not a bullet: it is flown and goes off where it strikes, see game.ts `onLaunch`)
    if (def.weapon.launches) this.onLaunch(camera.position.clone(), dir.clone(), def.weapon.launches);
    else this.onShot({ origin: camera.position.clone(), dir: dir.clone(), weapon: item.id, suppressed });
    // (a shell's pellets go out round the line of the shot, each its own way)
    for (let k = 0; k < (def.weapon.launches ? 0 : b.pellets); k++) {
      const d = b.cone ? strewn(dir, b.cone) : dir.clone();
      this.bullets.push({ pos: camera.position.clone(), vel: d.multiplyScalar(v0), drag: b.drag, damage: b.damage * (suppressed ? 0.9 : 1), v0, life: 4, travelled: 0, weapon: item.id, quiet: suppressed });
    }

    // The kick. What the shot does to the aim is the gun's own (and whoever is holding it: a knee, the ground,
    // the sights, tired arms, what is screwed on the muzzle): part of it throws the aim up and across and comes
    // back by itself, part of it stays and has to be pulled down. What is seen of the gun jumping is beside that.
    const big = !!gun?.heavy;
    const feel = handlingOf(item) ?? { ergo: 80, weight: 0.5, recoil: 1 };
    // (steadied by the sights when they are at the eye, not from the moment their button goes down: it was the button)
    const kick = kickOf(item.id, { shot: this.burst, crouched: this.player.crouched, prone: this.player.prone, aimed: this.adsT > SIGHTS_UP, arms: this.armStamina, ergo: feel.ergo, fitted: feel.recoil }, Math.random);
    this.aimRecoil.k = kick.back * kick.back;
    this.aimRecoil.d = 2 * Weapons.RECOIL.damp * kick.back;
    this.aimRecoil.v.y += (kick.up * kick.back) / Weapons.RECOIL.peak;
    this.aimRecoil.v.x -= (kick.across * kick.back) / Weapons.RECOIL.peak;
    // (the part that stays is owed to the view, and paid over the next twentieth of a second: see `rise`)
    this.rise.x += kick.stayAcross;
    this.rise.y += kick.stayUp;
    // (a pack's hands take the shot themselves: on top of that, half the kick the game gives a still model)
    const own = m.rig ? 0.5 : 1;
    this.kick.v.z += (gun?.jump ?? 1.6) * own;
    this.kick.v.y += (big ? 0.25 : 0.4) * own;
    this.kickRot.v.x += (big ? 9 : kind === 'auto' ? 5.5 : 7) * own;
    this.kickRot.v.z += (Math.random() - 0.5) * (big ? 3 : 2) * own;
    // (the light and the smoke of it are in the world: they come from where the barrel's end is seen to be)
    const flash = side === 'L' && m.twin ? m.twin.flash : m.flash;
    const muzzleWorld = flash.root.parent
      ? this.toWorld(this.vmCamera.worldToLocal(flash.root.getWorldPosition(new THREE.Vector3())), camera)
      : camera.position.clone().add(new THREE.Vector3(0.12, -0.1, -0.9).applyQuaternion(camera.quaternion));
    if (!suppressed) {
      flash.fire(FLAME[kind]);
    }
    // The smoke of one's own shot: a breath of it, thrown well ahead and gone in under a second. (It was what a
    // shot seen from across a field gives, five puffs that hang two seconds: held open, a rifle stood a bank of
    // fog on its own sights, and with a suppressor on, where no flash hides it and it comes from a hand nearer the
    // eye, nothing was to be seen through irons or glass.) Less of it down the sights, less again quieted, and a
    // string held open gives a puff to every other shot after its first two. It comes from the end of the can.
    const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const thin = gun?.auto && this.burst > 2 && this.burst % 2 === 0 ? 0 : (suppressed ? 0.3 : 0.8) * (gun?.auto ? 0.4 : 1) * THREE.MathUtils.lerp(1, 0.5, this.adsT);
    this.fx.muzzle(suppressed ? muzzleWorld.addScaledVector(ahead, kind === 'pistol' ? 0.13 : 0.19) : muzzleWorld, ahead, big || kind === 'auto', suppressed, 0, thin);
    audio.gunshot(kind === 'auto' ? 'rifle' : kind, undefined, 0, kind === 'auto', suppressed, VOICE[item.id], crackOf(v0));

    // (a pair: the hand that fired takes the shot by itself, at the pace of one gun of the two)
    if (side && m.twin) {
      m.twin.shotT[side] = 0;
      this.twinCool[side] += interval * 2;
      return;
    }
    m.shotT = 0;
    m.shotClip = m.rig?.has('fireLast') && (item.loaded ?? 0) === 0 ? 'fireLast' : 'fire';
    if (boltAction(item.id)) {
      this.boltReady = false;
      this.fireCooldown = interval;
      setTimeout(() => {
        if (this.current === m && !this.action) this.cycleBolt(m);
      }, m.rig ? 300 : 260);
    } else {
      // (added to what was left of this frame, which is nought or a little under: see `cooled`)
      this.fireCooldown += interval;
      this.slideKick = 1;
      // (a pack throws its own case)
      if (!m.rig || m.brass) this.eject(m, kind === 'rifle');
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
    // A gun fed by a magazine is given the fullest one carried of the kind that is in it (see nextMag), if that is
    // fuller than the one in it: the
    // old one goes back in a pocket with what is left in it, and the round in the chamber stays. Loose rounds do
    // not go into a gun: they go into a magazine, by hand. With no magazine to give it and nothing in its chamber,
    // one loose round is put there, which is one shot.
    let next: ItemInstance | null = null, single = false;
    // (the arena's: from a reserve that never ends, into the magazine that is in it; see freeReload)
    const free = this.freeReload;
    if (free && (item.loaded ?? 0) >= capacityOf(item)) return;
    if (def.weapon.mag && !free) {
      const mags = this.magsFor(item);
      next = nextMag(item, mags);
      if (!next && item.mag && mags.some((mg) => (mg.rounds ?? 0) > 0)) return void this.onSay('The magazine in it is the fullest you have', 'info');
      if (!next) {
        single = !chambered(item) && this.inv.count(def.weapon.ammo) > 0;
        if (!single) return void this.onSay(mags.length || item.mag ? 'No rounds in a magazine: hold one, and fill it from your loose rounds' : `No magazine for the ${def.name}: it fires what is in its chamber`, 'warn');
        this.onSay(mags.length || item.mag ? 'One round into the chamber: your magazines are empty' : 'One round into the chamber: it has no magazine', 'info');
      }
    }
    const fed = !!def.weapon.mag;
    this.incoming = free && fed ? item.mag ?? def.weapon.mag ?? null : next?.id ?? null;
    this.incomingRounds = free ? capacityOf(item) : next?.rounds ?? 0;
    /** what the hands have done when a magazine-fed gun's reload is over */
    const feed = () => {
      this.incoming = null;
      if (free) {
        item.loaded = capacityOf(item);
        this.onCarried();
      } else if (next) this.changeMag(item, next);
      else if (single && !chambered(item) && this.inv.take(def.weapon!.ammo, 1) === 1) {
        item.loaded = 1;
        this.onCarried();
      }
    };
    const need = capacityOf(item) - (item.loaded ?? 0);
    const have = free ? need : this.inv.count(def.weapon.ammo);
    if (!fed && (need <= 0 || have <= 0)) return;
    if (m.rig && def.weapon.tube) {
      // A tube under the barrel is fed a shell at a time: the gun is turned over, each shell
      // pushed in (and any of them may be the last: the trigger stops it there), and it is
      // brought back up.
      const n = Math.min(need, have);
      this.onAct('reload', 0.55 + n * 0.48 + 0.5);
      for (let k = 0; k < n; k++) audio.shellIn(0.55 + k * 0.48);
      this.start('reload', 0.55 + n * 0.48 + 0.5, () => {
        this.boltReady = true;
        this.dry.delete(item);
      }, { rounds: n, inserted: 0, stop: 0 });
      return;
    }
    if (m.rig) {
      // A pack's gun is fed by its magazine, and its hands do it at their own pace: out with
      // the old one, in with the new, and the slide or the bolt if the gun had run dry.
      const empty = m.kind !== 'rifle' && this.chamberEmpty && m.rig.has('reloadEmpty');
      const set = HANDLED[item.id];
      const clip = empty ? 'reloadEmpty' : 'reload';
      // (at very nearly the pace it was drawn at: hurried, the hands stop looking like hands)
      const whole = m.rig.seconds(clip) * (m.kind === 'pistol' ? 0.92 : 1);
      // A gun with no magazine in it has none to take out: the movement is begun where the hand goes for the fresh
      // one (the owner, 2026-10-15: "when a gun doesnt have a magazine, and you press R to put a magazine in, the
      // animation first plays a magazine being taken out ... we can skip the first part")
      const from = fed && !item.mag ? (m.kind === 'pistol' ? 0.22 : 0.38) : 0;
      const dur = whole * (1 - from), at = (part: number) => Math.max(0.02, whole * (part - from));
      // (one broken open and loaded by hand, the double barrel: its shells go in, there is no magazine to hear)
      if (!fed) for (const part of [0.42, 0.56]) audio.shellIn(at(part));
      else {
        if (!from) audio.magOut(whole * (m.kind === 'pistol' ? 0.12 : 0.28), m.kind !== 'pistol', set);
        audio.magIn(at(m.kind === 'pistol' ? (empty ? 0.36 : 0.48) : m.kind === 'auto' ? (empty ? 0.5 : 0.66) : 0.62), m.kind !== 'pistol', set);
        if (empty) audio.slideRack(at(m.kind === 'auto' ? 0.8 : 0.7), set);
      }
      this.onAct('reload', dur);
      this.start('magswap', dur, () => {
        if (fed) feed();
        else item.loaded = free ? capacityOf(item) : (item.loaded ?? 0) + this.inv.take(def.weapon!.ammo, capacityOf(item) - (item.loaded ?? 0));
        this.dry.delete(item);
        this.boltReady = true;
      }, { empty: empty ? 1 : 0, from });
      return;
    }
    if (m.kind === 'rifle' && !fed) {
      // open bolt, push rounds in one by one, close bolt
      const n = Math.min(need, have);
      // (a rifle with no pack of its own: it is heard as the others are, a magazine out and one in)
      audio.magOut(0.15, true);
      audio.magIn(0.55 + n * 0.48, true);
      this.onAct('reload', 0.55 + n * 0.48 + 0.5);
      this.start('reload', 0.55 + n * 0.48 + 0.5, () => {
        this.boltReady = true;
      }, { rounds: n, inserted: 0, stop: 0 });
    } else {
      const long = m.kind === 'auto';
      const locked = this.chamberEmpty;
      audio.magOut(long ? 0.25 : 0.1, long);
      audio.magIn(long ? 1.35 : 1.05, long);
      if (locked) audio.slideRack(long ? 1.9 : 1.55);
      const dur = long ? (locked ? 2.35 : 1.9) : locked ? 1.95 : 1.55;
      this.onAct('reload', dur);
      this.start('magswap', dur, () => {
        if (fed) feed();
        else item.loaded = free ? capacityOf(item) : (item.loaded ?? 0) + this.inv.take(def.weapon!.ammo, capacityOf(item) - (item.loaded ?? 0));
        this.dry.delete(item);
        this.boltReady = true;
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

  /**
   * A reload broken off (the wheel). Nothing is lost by it: a magazine is only counted out of the pockets when
   * it is home, so the change is simply undone; fed a round at a time, the rounds already in stay in and the
   * bolt is closed on them. The sounds that were still to come are not heard.
   * @returns whether there was a reload to break off
   */
  abortReload(): boolean {
    const a = this.action;
    if (!a || (a.name !== 'reload' && a.name !== 'magswap')) return false;
    if (a.data?.back || a.data?.stop) return true;
    audio.hush();
    if (a.name === 'reload') a.data!.stop = 1;
    else a.data = { ...(a.data ?? {}), back: 1 };
    this.onAct('stop', 0);
    return true;
  }

  /**
   * Show an item in the hands while it is being used; the weapon drops out of the way.
   * @param wait it is only taken into the hand: the same call without `wait` then uses it, from where it is held
   */
  beginUse(id: string, kind: UseKind, dur: number, wait = false) {
    this.guardHold = 0;
    this.guardT = 0;
    const h0 = this.held;
    // What is already in the hands stays in them: taken up to be used, worked on again (the next round into a
    // magazine), or let down to be held when the work is done. (Each of those brought it up from under the picture
    // afresh: a magazine being filled bobbed up from below for every round.)
    // (And a grenade whose pin has just come out is the grenade the hands were at: it goes from the two of them to
    // the one fist, and is not put away and brought up again.)
    const armed = kind === 'live' && h0?.kind !== 'live';
    if (h0 && h0.id === id && !h0.ending && (wait || h0.wait || h0.kind === kind || armed)) {
      if (!!h0.wait !== wait || armed) {
        // (carried over from where it is, if it has been anywhere yet: it is made at the eye itself)
        h0.from = h0.age > 0.05 ? { pos: h0.root.position.clone(), quat: h0.root.quaternion.clone() } : undefined;
        h0.fromT = 0;
        h0.turns = 0;
      } else if (!wait) h0.turns = (h0.turns ?? 0) + 1;
      h0.wait = wait;
      h0.kind = kind;
      if (!wait) {
        h0.t = 0;
        h0.dur = dur;
      }
      return;
    }
    if (kind === 'smoke') {
      // (not the packet: one out of it)
      const c = (this.smoke ??= cigarette());
      if (this.held) this.vmRoot.remove(this.held.root);
      this.held = { root: c.root, id, kind, t: 0, age: 0, dur, size: new THREE.Vector3(0.008, 0.008, 0.082), ending: 0, coal: c.coal, puffs: 0, wispT: 0 };
      this.vmRoot.add(c.root);
      return;
    }
    if (!this.itemModels) return;
    void this.itemModels.get(id).then(async (tpl) => {
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
        const big = IN_HAND[id] ?? 1;
        if (big !== 1) {
          obj.scale.multiplyScalar(big);
          size.multiplyScalar(big);
        }
        const mag = ITEMS[id].mag;
        let round: THREE.Object3D | undefined;
        if (mag) {
          // A magazine is stood on its end, its mouth uppermost and its broad side to the eye, as its picture in the
          // inventory is (whichever way its model lies: its longest side is its height, and the low end of that is
          // the end that goes into the gun).
          obj.position.y = -size.y / 2;
          const stood = new THREE.Group();
          stood.add(obj);
          const long = size.x > size.y && size.x >= size.z ? 'x' : size.z > size.y ? 'z' : 'y';
          if (long === 'z') {
            stood.rotation.x = Math.PI / 2;
            size.set(size.x, size.z, size.y);
          } else if (long === 'x') {
            stood.rotation.z = -Math.PI / 2;
            size.set(size.y, size.x, size.z);
          }
          const faced = new THREE.Group();
          faced.add(stood);
          if (size.z > size.x * 1.15) {
            faced.rotation.y = Math.PI / 2;
            size.set(size.z, size.y, size.x);
          }
          root.add(faced);
          // (and one of what goes in it, for the fingers that fill it: lying along the magazine, as it goes in)
          const one = (await this.itemModels!.get(mag.ammo)).group;
          let src: THREE.Mesh | null = null;
          one.traverse((o) => {
            if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh;
          });
          if (src) {
            const mesh = new THREE.Mesh((src as THREE.Mesh).geometry, plainMaterial((src as THREE.Mesh).material as THREE.Material));
            mesh.castShadow = false;
            mesh.geometry.computeBoundingBox();
            const bb = mesh.geometry.boundingBox!, sz = bb.getSize(new THREE.Vector3());
            mesh.position.copy(bb.getCenter(new THREE.Vector3())).multiplyScalar(-1);
            const lie = new THREE.Group();
            lie.add(mesh);
            if (sz.y > sz.x && sz.y >= sz.z) lie.rotation.z = -Math.PI / 2;
            else if (sz.z > sz.x) lie.rotation.y = Math.PI / 2;
            round = new THREE.Group();
            round.add(lie);
            round.visible = false;
            root.add(round);
          }
        } else {
          // long side points away from the camera so the hand wraps the narrow side
          if (size.x > size.z * 1.15) {
            obj.rotation.y = Math.PI / 2;
            size.set(size.z, size.y, size.x);
          }
          // (a bag of blood or salt water lies in the palm with its label the right way up to the one holding it)
          if (isBag(id)) obj.rotation.y += Math.PI;
          obj.position.y = -size.y / 2;
          root.add(obj);
        }
        h = { root, size, round };
        this.heldCache.set(id, h);
      }
      if (this.held) this.vmRoot.remove(this.held.root);
      this.held = { root: h.root, id, kind, t: 0, age: 0, dur, size: h.size, ending: 0, wait, round: h.round };
      // (not seen until it has been put where it goes: it is made at the eye itself)
      h.root.visible = false;
      this.vmRoot.add(h.root);
    });
  }

  endUse() {
    if (this.held && !this.held.ending) this.held.ending = 1e-4;
  }

  /**
   * Digging: a stroke of the spade, and the next when that one is done, for as long as this is called every frame.
   * It is the movement a thing is hit with, driven down at the ground in front of the feet, and hits nobody.
   * @returns true when a new stroke has just begun
   */
  dig(): boolean {
    if (this.action) return false;
    this.start('swing', DIG_STROKE, undefined, { hit: 1, dmg: 0, range: 0, stroke: 0, dig: 1 });
    this.onSwing(DIG_STROKE);
    return true;
  }
  /** how far through a stroke of the spade the hands are (0 when they are not digging) */
  get digStroke(): number {
    const a = this.action;
    return a?.name === 'swing' && a.data?.dig ? Math.min(1, a.t / a.dur) : 0;
  }
  /** the digging has stopped, done or broken off: the stroke in hand with it */
  endDig() {
    if (this.action?.name === 'swing' && this.action.data?.dig) this.action = null;
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
        if (this.freeReload || this.inv.take(def.weapon!.ammo, 1) === 1) {
          item.loaded = (item.loaded ?? 0) + 1;
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
          audio.blow(a.name === 'punch', pt, 1);
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
    if (m.scope) m.scope.visible = hasMod(it, 'pu_scope') || !!(it && ITEMS[it.id]?.weapon?.ownScope);
    if (m.wrap) m.wrap.visible = hasMod(it, 'rifle_wrap');
    if (m.suppressor) m.suppressor.visible = hasMod(it, 'suppressor_9');
    // (a piece said with a `!` is there when the part is NOT fitted: the plain sights a scope stands in the place of)
    // (The fresh magazine of a reload is there only while one is being changed, and is the kind that is going in:
    // at rest the pack parks it by the butt, under the eye, where a drum showed in the corner of the picture.)
    const fresh = this.action?.name === 'magswap' || this.action?.name === 'reload' ? this.incoming ?? it?.mag ?? null : null;
    for (const [obj, mod] of m.shown ?? []) obj.visible = obj.userData.fresh ? (mod === '*' ? !!fresh : mod === fresh) : mod.startsWith('!') ? !hasMod(it, mod.slice(1)) : hasMod(it, mod);
    for (const mark of m.marks ?? []) mark.visible = this.adsT > 0.75;
    // (the rounds seen in a magazine's mouth are there when the magazine has them: what is in the gun less the one in its chamber)
    if (m.rounds === undefined) m.rounds = m.rig ? this.roundsOf(m.root) : [];
    if (m.rounds.length) {
      const inMag = Math.max(0, (it?.loaded ?? 0) - (it && chambered(it) ? 1 : 0));
      for (const r of m.rounds) r.piece.visible = (r.fresh ? this.incomingRounds : inMag) >= r.nth;
    }
  }

  /**
   * Another player fired: their bullet flies in this world too, so you see and hear where it lands.
   * @param from the end of the barrel on the body that fired, and which way it points, where that body is seen
   */
  remoteShot(origin: THREE.Vector3, dir: THREE.Vector3, weaponId: string, suppressed: boolean, from?: { pos: THREE.Vector3; dir: THREE.Vector3 } | null, shooter?: unknown) {
    const kind = ITEMS[weaponId]?.weapon?.kind;
    if (!kind) return;
    const b = shotOf(weaponId);
    // The shot is reported from the shooter's eye, which in this world is inside their own
    // head hit zone: the bullet starts a forearm's length out, or it would land on them. (And it is known whose
    // it is, and passes through that body wherever it meets it: a forearm's length was not always enough. The
    // body is drawn a moment behind where its player is, so whoever fired stepping back, or leaning, or down at
    // their own feet, was hit by their own shot in everybody else's game: the blood was on them, and none on
    // whoever they had hit. "blood splatter is rendering at the player who is inflicting damage", 2026-10-12.)
    const out = dir.clone().normalize();
    // (as fast as it left where it was fired, which through a suppressor is slower: it lands where it landed
    // there, and a 9 mm that went by without a crack there goes by without one here)
    const v0 = b.muzzleVel * (suppressed ? QUIETED : 1);
    for (let k = 0; k < b.pellets; k++) {
      const d = b.cone ? strewn(out, b.cone) : out.clone();
      this.bullets.push({ pos: origin.clone().addScaledVector(out, 0.35), vel: d.multiplyScalar(v0), drag: b.drag, damage: 0, v0, life: 4, travelled: 0.35, weapon: weaponId, ghost: true, from: shooter });
    }
    const d = this.mainCam ? origin.distanceTo(this.mainCam.position) : 0;
    // The flash is at the end of their barrel. (It was put three fifths of a metre out from
    // their eye whatever they held: right for a pistol at arm's length, and for a rifle on top
    // of the scope, two fifths of a metre short of the muzzle.) Where the body is not to be
    // seen, a rifle's length out from the eye and a little under it.
    const seen = from && from.pos.distanceTo(origin) < 2.5 ? from : null;
    const at = seen ? seen.pos : origin.clone().addScaledVector(out, kind === 'pistol' ? 0.6 : 1).add(new THREE.Vector3(0, kind === 'pistol' ? 0 : -0.05, 0));
    this.fx.muzzle(at, seen ? seen.dir : out, kind !== 'pistol', suppressed, FLAME[kind]);
    audio.gunshot(kind === 'auto' ? 'rifle' : kind, origin, d, false, suppressed, VOICE[weaponId], crackOf(v0));
  }

  /**
   * The server confirmed our hit killed someone. Nothing is shown or sounded for it (2026-10-11, asked for: "there
   * is no feedback other than blood splatter on the target for if you hit them or not"): no mark on the sights and
   * no tick, for a hit or for a kill, on a player or one of the infected. What says a shot landed is what is seen
   * of it landing.
   */
  confirmKill() {}

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

  /** A wound that goes on hurting: what is held dips and rolls, as hands do when their owner catches a breath. The aim is not moved. */
  wince(k: number) {
    this.kickRot.v.z += (Math.random() - 0.5) * 9 * k;
    this.kickRot.v.x += 3.5 * k;
    this.kick.v.y -= 0.7 * k;
  }

  /**
   * We were hit: what is held jolts, and the aim is thrown, by half of what it was. (A hit of the ordinary kind
   * threw it two and a half degrees: whoever was hit first could not answer.)
   */
  flinch(k: number) {
    this.aimRecoil.v.y += 0.45 * k;
    this.aimRecoil.v.x += (Math.random() - 0.5) * 0.7 * k;
    this.kickRot.v.z += (Math.random() - 0.5) * 7 * k;
    this.kick.v.y -= 0.5 * k;
  }

  /** (a hit, by a round or a blow: nothing marks it, see confirmKill) */
  private markHit(killed: boolean, head = false) {
    void killed;
    void head;
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
      curl: base.curl.map((c, i) => mixCurl(c, to.curl?.[i] ?? c, w)) as HandGrip['curl'],
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
    const g = GRAVITY;
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
        let hit = physics.raycast(b.pos, dir, len, SHOT_GROUPS, b.ghost ? undefined : this.player.collider);
        // (somebody else's, and what it met is the body it came out of: on through it)
        for (let past = 0, k = 0; hit && b.from && hit.tag?.owner === b.from && k < 6; k++) {
          past = hit.toi + 0.04;
          if (past >= len) {
            hit = null;
            break;
          }
          const next = physics.raycast(b.pos.clone().addScaledVector(dir, past), dir, len - past, SHOT_GROUPS);
          hit = next ? { ...next, toi: next.toi + past } : null;
        }
        // What is thin lets a round through (2026-10-12: "the curtains and thin stuff needs to be wallbangable",
        // "wooden doors should be wall bangable"): a curtain, a door of boards. It leaves its hole there, and the
        // sound of it, and flies on.
        for (let k = 0; hit && hit.tag?.thin && k < 4; k++) {
          const thin = hit.collider;
          if (b.through !== thin) {
            const at = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
            this.fx.impact(hit.tag.surface, at, new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), true, (hit.tag.owner as { pivot?: THREE.Object3D } | undefined)?.pivot);
            audio.impact(hit.tag.surface, at, b.ghost ? at.distanceTo(this.mainCam?.position ?? at) : b.travelled + hit.toi);
            b.through = thin;
          }
          const past = hit.toi + 0.01;
          const next = past < len ? physics.raycast(b.pos.clone().addScaledVector(dir, past), dir, len - past, SHOT_GROUPS, thin) : null;
          hit = next ? { ...next, toi: next.toi + past } : null;
        }
        if (hit) {
          const pt = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
          const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
          const target = this.resolveTarget(hit.tag?.owner);
          const dist = b.travelled + hit.toi;
          if (target || hit.tag?.surface === 'flesh') {
            if (target && !b.ghost) {
              const zone = hit.tag?.zone ?? 'torso';
              // (by how much of its speed it has left: the same sum the server does from how far off it was)
              const kept = damageKept(speed / b.v0), dmg = ownHit(b.weapon, zone, !!b.quiet, kept) ?? b.damage * kept * ZONE_MULT[zone][0];
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
            // the nearest point of its path: in this step, or behind it already (a round fired from a few metres
            // off is past before it is first looked at)
            b.heard = true;
            const miss = toCam.addScaledVector(dir, -along).length();
            // A round faster than sound here drags its crack behind it in a cone, whatever it was fired through,
            // and that is heard further off than the zip of a slow one. It gets to the ear a moment after the
            // round is level with it (never later than sound takes to cross the gap, and sooner the nearer the
            // round is to the speed of sound), and from back along the path: from where the round was when it
            // made the part of the wave that gets there first.
            const mach = speed / SOUND, cone = mach > 1 ? Math.sqrt(mach * mach - 1) : 0;
            const back = cone ? Math.min(miss / cone, miss * 3) : 0;
            // (And before the muzzle there was no round to make it: level with whoever fires, or behind them,
            // nothing goes by. What is heard there is the shot. Without this, now that a crack is heard nine
            // metres off, every shot fired by somebody alongside would crack as well.)
            if (miss < (cone ? CRACK.far : 5) && b.travelled + along - back > 1) audio.whiz(_toCam.copy(b.pos).addScaledVector(dir, along - back), miss, cone ? (miss / SOUND) * (cone / mach) : 0, cone > 0);
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
    // (the hands and the gun are lit by the hour's light as the world is, and by what is over the eye)
    this.sunLight.intensity = this.atmo.sunNow * this.sunVis;
    this.sunLight.color.copy(this.atmo.sunTint);
    this.vmScene.environmentIntensity = this.atmo.skyNow * this.skyVis;
    // (and by the lamps about: down a bunker there is no other light on them)
    const glow = Math.max(this.lampSpill.r, this.lampSpill.g, this.lampSpill.b);
    this.handLamp.intensity = Math.min(2.6, glow * 4.2);
    if (glow > 0.001) this.handLamp.color.copy(this.lampSpill).multiplyScalar(1 / glow);
    this.handLamp.position.set(0, 0, 0.45).applyQuaternion(camera.quaternion);
    this.handLamp.position.y += 1;

    this.sharpenHands();
    // an item in use takes over the hands; whatever was held drops out of view
    // (down for as long as anything is in the hands: let up while the thing was still leaving, the gun was back
    // where it is held before it was shown again, and came into the picture in one frame)
    this.lowerT += ((this.stowed || this.held ? 1 : 0) - this.lowerT) * (1 - Math.exp(-(this.held ? 24 : 10) * dt));
    if (this.held) {
      this.lag.set(0, 0);
      this.animateHeld(dt);
      // A gun with hands of its own is seen to go down first, a tenth of a second of it, and what is taken out
      // is not shown until it has: gun and hands were gone on the very frame the thing was reached for.
      const sinking = !!m?.rig && this.lowerT < 0.88 && !!this.held && !this.held.ending;
      if (!sinking) {
        if (m) m.root.visible = false;
        return;
      }
      this.held!.root.visible = false;
    }
    if (!m) {
      this.lag.set(0, 0);
      this.animateFists(dt);
      return;
    }
    if (m.melee) {
      this.lag.set(0, 0);
      // (the knife has hands and movements of its own)
      if (m.rig) this.animateBlade(dt, m);
      else this.animateMelee(dt, m, m.melee);
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
    const adsPos = m.adsIron && !(m.optic && hasMod(this.currentItem, m.optic)) ? m.adsIron : m.ads;
    const pos = new THREE.Vector3().lerpVectors(m.hip, adsPos, ads);
    const rot = new THREE.Euler(0, 0, 0);

    // bob
    // (a pack with a walk of its own drawn: most of the swing is that, and only a little of this is laid over it)
    const amp = p.movingSmooth * (p.grounded ? 1 : 0) * (1 - ads * 0.8) * (m.gait ? 0.35 : 1);
    const ph = p.bobPhase;
    pos.x += Math.cos(ph) * 0.012 * amp;
    pos.y += -Math.abs(Math.sin(ph)) * 0.014 * amp;
    rot.z += Math.cos(ph) * 0.02 * amp;
    // idle breathing
    pos.y += Math.sin(this.time * 1.6) * 0.0018 * (1 - ads);
    // sprint pose
    // (a pack with a run of its own drawn carries the gun as that has it)
    const sp = m.gait ? 0 : this.sprintT;
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
    // looked over, with no drawing of it: the gun is brought up before the eye and turned, its near side and then its top
    if (a?.name === 'check' && !this.checkDrawn(m)) {
      const L = LOOK_OVER, s = THREE.MathUtils.smoothstep, half = a.dur * L.turn, how = m.kind === 'auto' ? L.auto : L.long;
      const first = s(a.t, 0, L.ease) * (1 - s(a.t, half, half + L.ease));
      const second = s(a.t, half, half + L.ease) * (1 - s(a.t, a.dur - L.ease, a.dur));
      pos.x += how.at[0] * (first + second);
      pos.y += how.at[1] * (first + second);
      pos.z += how.at[2] * (first + second);
      rot.x += how.first[0] * first + how.second[0] * second;
      rot.y += how.first[1] * first + how.second[1] * second;
      rot.z += how.first[2] * first + how.second[2] * second;
    }
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
      } else if (a.name === 'swing' && a.data?.dig) {
        // the spade: lifted a little, driven down into the ground ahead of the feet, levered back, and brought up
        // with what it holds
        const lift = THREE.MathUtils.smoothstep(k, 0, 0.14);
        const drive = THREE.MathUtils.smoothstep(k, 0.14, 0.32);
        const lever = THREE.MathUtils.smoothstep(k, 0.38, 0.62);
        const up = THREE.MathUtils.smoothstep(k, 0.66, 1);
        rot.x += (lift * 0.25 - drive * 1.25 + lever * 0.55) * (1 - up);
        rot.y += (drive * 0.12 - lever * 0.3) * (1 - up);
        pos.add(new THREE.Vector3(0.02 * drive - 0.05 * lever, 0.07 * lift - 0.2 * drive + 0.11 * lever, -0.1 * drive + 0.05 * lever).multiplyScalar(1 - up));
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
    // (and one held turned in at the hip is squared to the eye as it comes up)
    if (m.aimRot) {
      const turn = m.aimRotOptic && m.optic && hasMod(this.currentItem, m.optic) ? m.aimRotOptic : m.aimRot;
      rot.x += turn.x * ads;
      rot.y += turn.y * ads;
      rot.z += turn.z * ads;
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
      else if (a.name === 'reload' && rig.has('reload')) {
        // Shell by shell, with a movement drawn for changing a magazine: its first third turns
        // the gun over and brings the hand under it, and that hand goes in and out once for
        // every shell before the last third brings the gun back up.
        const t = a.t, end = a.dur - 0.5;
        const part = t < 0.55 ? 0.36 * (t / 0.55) : t > end ? THREE.MathUtils.lerp(0.62, 1, (t - end) / 0.5) : 0.36 + 0.26 * (0.5 - 0.5 * Math.cos((((t - 0.55) / 0.48) % 1) * Math.PI * 2));
        rig.pose('reload', part);
      }
      else if (a.name === 'magswap') {
        // (begun part way in when there was no magazine to take out: see `reload`)
        const from = a.data?.from ?? 0, kk = from + k * (1 - from);
        rig.pose(a.data?.empty ? 'reloadEmpty' : 'reload', kk);
        // (the pack's plain reload has the slide back for the middle of it, as if the gun had
        // run dry; with a round still in the chamber it stays shut)
        if (!a.data?.empty && m.kind === 'pistol') rig.still(m.slideOn ? [m.slideOn] : ['slide', 'stopper']);
        // (run dry, its slide is back until the hand has worked it, late in the movement)
        if (a.data?.empty && m.slideOn) rig.slide(m.slideOn, -SLIDE_LOCK * (1 - THREE.MathUtils.smoothstep(kk, 0.7, 0.76)));
      }
      else if (a.name === 'check' && this.checkDrawn(m)) rig.pose('check', k);
      else rig.rest();
      if (m.slideOn && this.chamberEmpty && a.name !== 'magswap') rig.slide(m.slideOn, -SLIDE_LOCK);
      this.cockHammer(m);
      this.reseat(m);
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
    // Carried: the pack's own walk under it, and its own run when the legs run (each drawn by itself, a stride to
    // a turn of it: they are mixed over whatever it stands in, by how much the legs are doing of each).
    if (m.gait && m.shotT >= len) {
      const p = this.player, stride = (((p.bobPhase / (Math.PI * 2)) % 1) + 1) % 1;
      const going = p.movingSmooth * (p.grounded ? 1 : 0);
      rig.mix('walk', stride, going * (1 - this.sprintT) * (1 - this.adsT * 0.85), m.fast);
      rig.mix('run', stride, this.sprintT, m.fast);
    }
    // (a pair: each hand and its gun fire by themselves, over the other standing as it was)
    if (m.twin) {
      for (const s of ['L', 'R'] as const) {
        m.twin.shotT[s] += dt;
        // (a pack that draws each hand's shot by itself, the sawn-offs: `fireL`, `fireR`; one that draws both at once: `fire`)
        const own = rig.has(`fire${s}`) ? `fire${s}` : shot, ownLen = rig.seconds(own);
        if (m.twin.shotT[s] < ownLen) rig.layer(own, m.twin.shotT[s] / ownLen, m.twin.roots[s]);
      }
    }
    // (a pistol on a pack with no drawing of a last shot: run dry, its slide stays back)
    if (m.slideOn && this.chamberEmpty && m.shotT >= len) rig.slide(m.slideOn, -SLIDE_LOCK);
    this.cockHammer(m);
    this.reseat(m);
  }

  /** A hammer that is let down (see HAMMER): back for the moment of a shot and while the gun is empty, down otherwise. */
  private cockHammer(m: VmModel) {
    const h = m.hammer;
    if (!h) return;
    const t = m.shotT ?? 9;
    // (the slide throws it back in a twentieth of a second, and it is down again in a tenth)
    const fired = t < 0.05 ? t / 0.05 : Math.max(0, 1 - (t - 0.05) / 0.09);
    const cock = Math.max(fired, this.chamberEmpty ? 1 : 0);
    h.piece.quaternion.setFromAxisAngle(_Z, h.down * (1 - cock));
    h.piece.position.copy(h.at).applyQuaternion(h.piece.quaternion).negate().add(h.at);
  }

  /** the pack's hands put where this gun has something for them to hold (see WeaponRig.reseat), and our own arms after a pack's (WeaponRig.wear): after the movement of the frame is set */
  private reseat(m: VmModel) {
    const r = m.reseat;
    if (r && m.rig) {
      if (r.L) m.rig.reseat('L', r.body, r.L);
      if (r.R) m.rig.reseat('R', r.body, r.R);
    }
    m.rig?.follow();
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

  /** the knife: the swing whose movement is being played, how long it has been simply held, and what it stood in last frame and is leaving (see `animateBlade`) */
  private bladeOf: Action | null = null;
  private bladeCalm = 9;
  private bladeNow: { clip: string; k: number } = { clip: 'idle', k: 0 };
  private bladeFrom: { clip: string; k: number; t: number } | null = null;

  /**
   * The knife (see BLADE): its pack's own hands and its own movements. Which movement it is in this frame and how
   * far through, and where the pair of hands is held from the eye: the walk, a run, the guard and what a blow that
   * landed sends back up the arm are laid over the pack's drawing by moving the whole of it, as a gun's are.
   */
  private animateBlade(dt: number, m: VmModel) {
    const rig = m.rig!, p = this.player, a = this.action;
    this.guardHold = Math.max(0, this.guardHold - dt);
    const want = this.guardHold > 0 && !p.dead && !(a && a.name === 'swing') ? 1 : 0;
    this.guardT += (want - this.guardT) * (1 - Math.exp(-(want ? 16 : 9) * dt));
    const g = this.guardT;
    // a blow begun: the next of the run, from its first frame
    m.shotT = (m.shotT ?? 9) + dt;
    if (a && a.name === 'swing' && a !== this.bladeOf) {
      this.bladeOf = a;
      m.shotClip = BLADE.blows[(a.data?.stroke ?? 0) % BLADE.blows.length];
      // (as far into it as the swing is, less what of its drawing back is left out)
      m.shotT = a.t + (BLADE.skip[m.shotClip] ?? 0);
      this.bladeFrom = { ...this.bladeNow, t: 0 };
    }
    const blow = m.shotClip && rig.has(m.shotClip) && m.shotT < rig.seconds(m.shotClip) ? m.shotClip : null;
    let clip: string, k: number;
    if (a && (a.name === 'equip' || a.name === 'unequip')) {
      // drawn, and put away: both hands come up from under the picture with it, and go down there
      clip = a.name === 'equip' ? 'draw' : 'stow';
      k = Math.min(1, a.t / a.dur);
      m.shotT = 9;
    } else if (blow) {
      clip = blow;
      k = m.shotT / rig.seconds(blow);
    } else {
      // Held: a slow breath. (The pack draws it as a straight line out and a straight line back in a second and a
      // third; its first half is the way out, so a part of that, eased over a few seconds, is the same drift at a
      // pace to live with. It begins from nothing after anything else, which all ends where this starts.)
      clip = 'idle';
      k = 0.5 * BLADE.breath * (0.5 - 0.5 * Math.cos((this.bladeCalm * Math.PI * 2) / BLADE.every)) * THREE.MathUtils.smoothstep(this.bladeCalm, 0, 0.6);
    }
    this.bladeCalm = clip === 'idle' ? this.bladeCalm + dt : 0;
    // One movement cut short by another (a second blow before the first has come home, the knife put away in the
    // middle of one) gives way to it over a moment: the next is not begun from where it was drawn to begin.
    // (Drawn, it comes up from under the picture whatever it was last seen doing.)
    if (clip !== this.bladeNow.clip) this.bladeFrom = clip === 'draw' ? null : { ...this.bladeNow, t: 0 };
    if (this.bladeFrom) {
      this.bladeFrom.t += dt;
      if (this.bladeFrom.t >= BLADE.join) this.bladeFrom = null;
    }
    if (this.bladeFrom) {
      rig.pose(this.bladeFrom.clip, this.bladeFrom.k);
      rig.mix(clip, k, THREE.MathUtils.smoothstep(this.bladeFrom.t / BLADE.join, 0, 1));
    } else rig.pose(clip, k);
    this.bladeNow.clip = clip;
    this.bladeNow.k = k;

    // where the pair of hands is: the walk, a run with it carried low, the guard, what the arms have just taken
    const busy = !!a || !!blow;
    const amp = p.movingSmooth * (p.grounded ? 1 : 0) * (1 - g * 0.5);
    const ph = p.bobPhase;
    const sp = busy ? 0 : this.sprintT * (1 - g);
    const kick = this.kick.step(dt);
    const kr = this.kickRot.step(dt);
    const G = (this.currentItem && BLADE.own[this.currentItem.id]?.guard) || BLADE.guard, R = BLADE.run;
    m.root.position.set(
      m.hip.x + Math.cos(ph) * 0.012 * amp + R.p[0] * sp + G.p[0] * g - p.strafe * 0.006,
      m.hip.y - Math.abs(Math.sin(ph)) * 0.016 * amp + R.p[1] * sp + G.p[1] * g + kick.y * 0.02 - this.lowerT * 0.4,
      m.hip.z + R.p[2] * sp + G.p[2] * g + kick.z * 0.06,
    );
    m.root.rotation.set(
      R.r[0] * sp + G.r[0] * g + Math.cos(ph) * 0.02 * amp + kr.x * 0.012 - this.lowerT * 0.7,
      R.r[1] * sp + G.r[1] * g,
      R.r[2] * sp + G.r[2] * g + Math.cos(ph) * 0.025 * amp + kr.z * 0.01 - p.strafe * 0.03,
    );
    m.root.visible = true;
    // (a pack brings its own arms)
    this.arms.update(null, null, this.vmCamera.quaternion, false);
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
    h.age += dt;
    if (!h.wait) h.t += dt;
    if (h.ending) h.ending += dt;
    const enter = THREE.MathUtils.smoothstep(h.age, 0, 0.3);
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
    /** a roll of dressing, not the kit (which is held and gone into another way: see HOLD.kit and ROLL) */
    const rolled = (h.kind === 'bandage' && Math.max(h.size.x, h.size.z) < 0.1) || h.kind === 'drip';
    /** a grenade on a handle in the hand, its cord not yet pulled: held as a thing to hit with is (see LIVE.stick.rest) */
    const stickRest = h.wait && h.kind !== 'live' && h.size.z > 0.2 && !!ITEMS[h.id]?.throw;
    const two = !h.wait && (h.kind === 'bandage' || h.kind === 'inject' || h.kind === 'open' || h.kind === 'load' || h.kind === 'unbox' || h.kind === 'drip' || (h.kind !== 'smoke' && Math.min(h.size.x, h.size.z) > 0.16));
    /** a magazine being filled: how far the right hand is from where it takes a round (0) to the magazine's mouth (1), how far the round is pressed in, and slid back */
    let fill: { reach: number; press: number; slide: number; has: boolean } | null = null;
    /** a box being torn open: how far its flap is being pulled, and how far it is tipped over to pour */
    let torn: { tug: number; pour: number } | null = null;
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
    } else if (h.kind === 'swipe') {
      // A card: held out to the reader beside the door, pushed home into its slot, held there a
      // moment while the reader makes up its mind, and let go of.
      // (It is looked at first: held up face on, between the thumb and the side of the first finger,
      // as a card is held by anybody who has to find which end goes in.)
      const C = this.card;
      const reach = THREE.MathUtils.smoothstep(t, C.shown, C.shown + C.over), push = THREE.MathUtils.smoothstep(t, C.shown + C.over + 0.04, C.shown + C.over + 0.22);
      const sway = Math.sin(t * 2.6) * 0.004 * (1 - reach);
      pos.set(C.show[0], C.show[1] + sway, C.show[2]).lerp(_cardV.set(C.put[0], C.put[1], C.put[2]), reach).addScaledVector(_cardV.set(C.putAlong[0], C.putAlong[1], C.putAlong[2]).normalize(), C.push * push);
      const turned = (along: number[], face: number[], out: THREE.Quaternion) => {
        // (as it is held the card lies along its own z, the end that goes in at -z, and its front is to its own y: see beginUse)
        const a = new THREE.Vector3(along[0], along[1], along[2]).normalize();
        const n = new THREE.Vector3(face[0], face[1], face[2]);
        n.addScaledVector(a, -n.dot(a)).normalize();
        return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(a, n), n, a.clone().negate()));
      };
      rot.setFromQuaternion(turned(C.showAlong, C.showFace, new THREE.Quaternion()).slerp(turned(C.putAlong, C.putFace, new THREE.Quaternion()), reach));
      h.root.scale.setScalar(C.scale);
    } else if (rolled && h.wait) {
      // A roll taken out and not yet used: in the right hand at rest, as anything small is.
    } else if (rolled) {
      // A roll (or a bag) in the left palm (see ROLL).
      pos.set(ROLL.at[0], ROLL.at[1] + (h.kind === 'drip' ? ROLL.bag.lift : 0) + Math.sin(t * 2.3) * 0.003, ROLL.at[2]);
      rot.set(ROLL.turn[0], ROLL.turn[1], ROLL.turn[2] + Math.sin(t * 1.7) * 0.02);
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
    } else if (h.kind === 'load' && h.wait) {
      // A magazine taken out and not being filled: upright in the right fist, low on the right, its mouth up.
      pos.set(LOAD.rest[0] + Math.sin(h.age * 1.3) * 0.002, LOAD.rest[1] + Math.sin(h.age * 1.9) * 0.003, LOAD.rest[2]);
      rot.set(LOAD.restTurn[0], LOAD.restTurn[1], LOAD.restTurn[2]);
    } else if (h.kind === 'load') {
      // Being filled. One turn to a round: the right hand comes away from the last one and takes the next (the
      // first third), brings it to the mouth, presses it down and slides it back, and the turn ends with it home.
      const k = THREE.MathUtils.clamp(t / Math.max(0.05, h.dur), 0, 1);
      const first = !h.turns;
      const off = first ? 0 : 1 - THREE.MathUtils.smoothstep(k, 0, 0.3);
      const reach = Math.max(off, THREE.MathUtils.smoothstep(k, 0.3, 0.72));
      const press = THREE.MathUtils.smoothstep(k, 0.7, 0.9), slide = THREE.MathUtils.smoothstep(k, 0.86, 1);
      fill = { reach, press: k < 0.3 ? 0 : press, slide: k < 0.3 ? 0 : slide, has: k >= 0.3 || first };
      // (it gives a little under the thumb)
      pos.set(LOAD.at[0], LOAD.at[1] - FILL_HANDS.drop - Math.sin(press * Math.PI) * 0.005, LOAD.at[2]);
      rot.set(LOAD.turn[0] + Math.sin(press * Math.PI) * 0.03, LOAD.turn[1], LOAD.turn[2]);
    } else if (h.kind === 'unbox' && !h.wait) {
      // A box of rounds: in the left hand before the chest; the right takes hold of its flap and pulls it back,
      // twice; then the box is tipped over into the right palm.
      const k = THREE.MathUtils.clamp(t / Math.max(0.05, h.dur), 0, 1);
      const pull = (a: number, b: number) => THREE.MathUtils.smoothstep(k, a, (a + b) / 2) * (1 - THREE.MathUtils.smoothstep(k, (a + b) / 2, b));
      const tug = pull(0.1, 0.34) + pull(0.36, 0.62);
      const pour = THREE.MathUtils.smoothstep(k, 0.66, 0.84);
      torn = { tug, pour };
      pos.set(UNBOX.at[0] + pour * 0.012, UNBOX.at[1] + sy * H.workBy[0] + pour * 0.04 - tug * 0.006, UNBOX.at[2] + sy * H.workBy[1]);
      rot.set(0.45 - tug * 0.14, 0.25, -pour * 1.25 + Math.sin(k * 40) * 0.012 * pour);
    } else if (h.kind === 'inject' && h.wait) {
      // Taken out and not yet used: upright in the right fist, low on the right, where a thing is held that is
      // about to be used. Nothing of the left hand: it has no part in this until the click.
      const R = READY;
      pos.set(R.at[0] + Math.sin(h.age * 1.3) * 0.002, R.at[1] + Math.sin(h.age * 1.9) * 0.003, R.at[2]);
      rot.setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(R.nose[0], R.nose[1], R.nose[2]).normalize()));
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
      const shown = seg(0.04, 0.4) * (1 - leave) * (1 - exit);
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
      if (h.from) {
        // (it was already in the hand: brought over from where it was held, not up from below again)
        const k = seg(0, 0.42);
        pos.lerpVectors(h.from.pos, pos, k);
        rot.setFromQuaternion(h.from.quat.clone().slerp(new THREE.Quaternion().setFromEuler(rot), k));
      }
    } else if (stickRest) {
      // A grenade on a handle, its cord not yet pulled: held as a thing to hit with is (see LIVE.stick.rest).
      const S = LIVE.stick;
      pos.set(S.rest[0] + Math.sin(h.age * 1.3) * 0.002, S.rest[1] + Math.sin(h.age * 1.9) * 0.003, S.rest[2]);
      rot.set(S.restTurn[0], S.restTurn[1], S.restTurn[2]);
    } else if (h.kind === 'live') {
      // A grenade with its pin out: up on the right in the one fist, and shaking the more the less of its fuse is left.
      const k = THREE.MathUtils.clamp(t / Math.max(0.05, h.dur), 0, 1);
      const s = THREE.MathUtils.lerp(LIVE.shake[0], LIVE.shake[1], k * k);
      // (a grenade on a handle is stood up in the fist, head uppermost: see LIVE.stick)
      const L = h.size.z > 0.2 ? LIVE.stick : LIVE;
      pos.set(L.at[0] + Math.sin(t * 37) * s, L.at[1] + Math.sin(t * 29 + 1) * s, L.at[2] + Math.sin(t * 23 + 2) * s * 0.5);
      rot.set(L.turn[0], L.turn[1], L.turn[2] + Math.sin(t * 31) * s * 6);
    } else {
      pos.set(H.work[0], H.work[1] + sy * H.workBy[0] + Math.sin(t * 9) * 0.004, H.work[2] + sy * H.workBy[1]);
      rot.set(0.45, 0.25 + Math.sin(t * 4.5) * 0.05, 0);
    }
    pos.y -= (1 - up) * 0.4;
    h.root.position.copy(pos);
    h.root.rotation.copy(rot);
    // (taken up to be worked on, or let down again: carried over from where it was, not put there)
    if (h.from && h.fromT !== undefined && h.kind !== 'inject') {
      h.fromT += dt;
      const k = THREE.MathUtils.smoothstep(h.fromT, 0, 0.26);
      h.root.position.lerpVectors(h.from.pos, pos, k);
      h.root.quaternion.copy(h.from.quat).slerp(new THREE.Quaternion().setFromEuler(rot), k);
      if (k >= 1) h.from = undefined;
    }
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
    // a card: by its near end, the fingers under it and the thumb laid on its face
    if (h.kind === 'swipe') {
      const C = this.card;
      right = { pos: new THREE.Vector3(C.wrist[0], C.wrist[1], C.wrist[2]), fingers: new THREE.Vector3(C.fingers[0], C.fingers[1], C.fingers[2]).normalize(), palm: new THREE.Vector3(C.palm[0], C.palm[1], C.palm[2]).normalize(), curl: C.curl as [number, number, number, number], fold: C.fold as [number, number, number], thumb: C.thumb, tuck: C.tuck, spread: C.spread };
    }
    // between the first two fingers, near the filter, the hand under it and its palm to the face
    if (drawn >= 0) right = { pos: new THREE.Vector3(-0.009, -0.168, 0.05), fingers: new THREE.Vector3(0, 0.97, -0.24), palm: new THREE.Vector3(0, 0.24, 0.97), curl: [0.08, 0.12, 1.0, 1.1], thumb: 0.55 };
    if (offered || (h.kind === 'inject' && h.wait)) {
      // Both hands are said in the eye's space and turned into the injector's own, which is what
      // the arms are posed in. The right is a fist round the barrel, thumb at the end that is
      // pressed: the barrel runs through the middle of it, so the wrist is set that far behind
      // it (set down beside the barrel, the fist closed on nothing next to it).
      const I = INJECT;
      const inv = h.root.quaternion.clone().invert();
      // (the fist is said as it lies on the barrel while the shot is given, and goes wherever the barrel goes:
      // held waiting, or on its way over, the barrel points another way and the fist with it)
      const given = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), I.down.clone().normalize()).invert();
      const up = I.down.clone().normalize().negate();
      const fingers = I.fingers.clone();
      fingers.addScaledVector(up, -fingers.dot(up)).normalize();
      const palm = new THREE.Vector3().crossVectors(up, fingers);
      const holdAt = up.clone().multiplyScalar(I.held).addScaledVector(fingers, -I.fist[0]).addScaledVector(palm, -I.fist[1]);
      right = { pos: holdAt.applyQuaternion(given), fingers: fingers.applyQuaternion(given), palm: palm.applyQuaternion(given), curl: I.curl, thumb: 0.85, tuck: 0.35 };
      const c = THREE.MathUtils.lerp(0.4, 1.3, offered?.clench ?? 0);
      left = !offered ? null : {
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
    if (rolled && !h.wait) {
      // on to the roll and away, once every second and a half: the fingertips come down on its near edge and draw
      // a length off it, then away low on the right to where it is wound on
      const k = (t % 1.5) / 1.5;
      const on = THREE.MathUtils.smoothstep(k, 0.02, 0.24) * (1 - THREE.MathUtils.smoothstep(k, 0.5, 0.74));
      const inv = h.root.quaternion.clone().invert();
      const away = new THREE.Vector3(0.2, -0.4, -0.3).sub(h.root.position).applyQuaternion(inv);
      // (The fingers come to it from the right, level, and the hand is that far behind their tips: beside the roll
      // and not over it. Brought down on it from above, the sleeve lay across the roll and hid it.)
      const fingers = new THREE.Vector3(-0.93, -0.24, -0.28).applyQuaternion(inv).normalize();
      const tips = new THREE.Vector3(h.size.x / 2 - 0.004 + Math.sin(t * 9) * 0.003 * on, h.size.y / 2 + 0.004, 0.006);
      right = { pos: away.lerp(tips.addScaledVector(fingers, -ROLL.reach), on), fingers, palm: new THREE.Vector3(-0.1, -0.8, 0.6).applyQuaternion(inv).normalize(), curl: [0.4 + on * 0.25, 0.55 + on * 0.25, 0.95, 1.05], thumb: 0.9, tuck: 0.25 };
      // (the left is under it, its palm up: the roll lies in the hollow of it, the fingers a little closed beyond)
      const bag = h.kind === 'drip';
      left = { pos: new THREE.Vector3(-0.012, -(h.size.y / 2 + ROLL.under + (bag ? ROLL.bag.lift : 0)), ROLL.back), fingers: new THREE.Vector3(0.14, 0.1, -0.98).normalize(), palm: new THREE.Vector3(0.05, 1, 0.05).normalize(), curl: bag ? ROLL.bag.curl : [0.42, 0.46, 0.5, 0.55], thumb: 0.45, spread: 0.2 };
    } else if (h.kind === 'bandage' && !rolled) {
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
    if (fill) {
      // The magazine in the left hand, by its lower half and from behind. The right is said in the eye's space
      // (where it takes a round) and in the magazine's own (its mouth), and goes between the two.
      const inv = h.root.quaternion.clone().invert();
      const away = new THREE.Vector3(LOAD.away[0], LOAD.away[1], LOAD.away[2]).sub(h.root.position).applyQuaternion(inv);
      const mouth = new THREE.Vector3(0.012 - fill.slide * LOAD.back, sy / 2 + 0.012 - fill.press * LOAD.down, 0.004);
      // (the right hand comes to it from the right as the forearm does, the round pinched at the thumb: the pinch is
      // where the round is to go, and the wrist is that far back along the fingers and off the palm; see FILL_HANDS)
      const R = FILL_HANDS.right, L = FILL_HANDS.left, P = FILL_HANDS.round;
      const fingers = new THREE.Vector3(...R.fingers).applyQuaternion(inv).normalize();
      const palm = new THREE.Vector3(...R.palm).applyQuaternion(inv);
      palm.addScaledVector(fingers, -palm.dot(fingers)).normalize();
      // (the right hand comes to where it came before the magazine was let down in the left: on top of its mouth now)
      const tip = away.clone().lerp(mouth.clone().add(new THREE.Vector3(0, FILL_HANDS.drop, 0).applyQuaternion(inv)), fill.reach);
      right = { pos: tip.clone().addScaledVector(fingers, -R.reach).addScaledVector(palm, -R.under), fingers, palm, curl: R.curl, thumb: R.thumb, tuck: R.tuck };
      left = { pos: new THREE.Vector3(L.at[0], sy * L.at[1] + FILL_HANDS.drop, -(h.size.z / 2 + L.at[2])), fingers: new THREE.Vector3(...L.fingers).normalize(), palm: new THREE.Vector3(...L.palm).normalize(), curl: L.curl, thumb: L.thumb };
      if (h.round) {
        // (the round rides in the pinch, a little toward the eye of it so that it is seen there, and is gone from
        // sight when it is home)
        h.round.visible = fill.has && fill.slide < 0.85;
        h.round.position.copy(tip).add(new THREE.Vector3(0, -0.004, P.ahead));
        h.round.scale.setScalar(P.size);
        h.round.rotation.set(0, 0, THREE.MathUtils.lerp(-0.35, 0, fill.reach));
      }
    } else if (h.round) h.round.visible = false;
    if (torn) {
      const inv = h.root.quaternion.clone().invert();
      const half = Math.min(h.size.x, h.size.z) / 2;
      // on the flap, at the near top edge, and lifting it; then away under the box, cupped, as it is tipped
      const flap = new THREE.Vector3(half * 0.2, sy / 2 + 0.02 + torn.tug * 0.03, h.size.z / 2 + 0.015 + torn.tug * 0.028);
      const cup = new THREE.Vector3(UNBOX.palm[0], UNBOX.palm[1], UNBOX.palm[2]).sub(h.root.position).applyQuaternion(inv);
      const p = torn.pour;
      right = {
        pos: flap.lerp(cup, p),
        fingers: new THREE.Vector3(-0.55, -0.6, -0.55).lerp(new THREE.Vector3(-0.55, 0.12, -0.82).applyQuaternion(inv), p).normalize(),
        palm: new THREE.Vector3(-0.2, -0.95, 0.2).lerp(new THREE.Vector3(-0.15, 0.97, 0.15).applyQuaternion(inv), p).normalize(),
        curl: [THREE.MathUtils.lerp(0.75, 0.4, p), THREE.MathUtils.lerp(0.8, 0.45, p), THREE.MathUtils.lerp(0.95, 0.5, p), THREE.MathUtils.lerp(1.0, 0.55, p)],
        thumb: THREE.MathUtils.lerp(0.9, 0.35, p),
        spread: 0.3 * p,
      };
      // (The left has it from underneath, on the flat of the hand, the fingers along its far side. Held by its
      // side as other things are, a box this size was behind the back of the glove and nothing of it was seen.)
      left = { pos: new THREE.Vector3(-half * 0.6, -sy / 2 - 0.028, 0.045), fingers: new THREE.Vector3(0.45, 0.12, -0.88).normalize(), palm: new THREE.Vector3(0.1, 0.99, 0.05).normalize(), curl: [0.45, 0.5, 0.55, 0.6], thumb: 0.35 };
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
    if ((h.kind === 'live' || stickRest) && h.size.z > 0.2) {
      // A fist round the end of its handle, the thumb's side toward its head. The handle runs through the middle of
      // the fist, so the wrist is set that far behind it and to the palm's side (as the fist round an injector is).
      const S = LIVE.stick;
      const up = new THREE.Vector3(0, 0, 1), fingers = new THREE.Vector3(S.fingers[0], S.fingers[1], 0).normalize();
      const palm = new THREE.Vector3().crossVectors(up, fingers);
      right = { pos: up.clone().multiplyScalar(S.grip).addScaledVector(fingers, -S.fist[0]).addScaledVector(palm, -S.fist[1]), fingers, palm, curl: S.curl, thumb: S.thumb, tuck: S.tuck };
    }
    this.arms.update(h.root, { right, left }, this.vmCamera.quaternion, true);
  }
}
