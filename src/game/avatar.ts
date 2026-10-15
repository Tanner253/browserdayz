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
import { breathe, Line } from '../core/breathe';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { Atmosphere } from '../world/atmosphere';
import { type Curl, bent, type Grips, type HandGrip } from './arms';
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

const CLIPS = ['idle', 'walk', 'run', 'crouchIdle', 'crouchWalk', 'jumpStart', 'jumpLoop', 'jumpLand', 'death', 'deathFront', 'deathSide', 'hit', 'hitHead', 'dance', 'sit', 'armed', 'strike', 'proneDown', 'crawl'] as const;
type Clip = (typeof CLIPS)[number];
const STRIDES = ['walk', 'run', 'crouchWalk'] as const;
type Stride = (typeof STRIDES)[number];
/** the ways of going down: thrown onto the back, pitched onto the face, folded onto the side */
export const DEATHS = ['death', 'deathFront', 'deathSide'] as const;
/** where a body lies once it is down, from where it stood: metres ahead of its feet (negative = behind) and to its left */
export const DEATH_REST: [number, number][] = [[-0.85, 0], [0.9, 0], [0.05, 0.36]];

/** what the hands can be seen doing */
export type Gesture = 'bolt' | 'reload' | 'eat' | 'drink' | 'bandage' | 'open' | 'check';
/** from the wheel (src/sim/emotes.ts): what the arms do with a call, and what the body keeps up until told otherwise */
export type Move = NonNullable<Emote['move']>;
export type Hold = NonNullable<Emote['hold']>;
/**
 * Lying down. There is no drawing of it in the library: it is the last moment of the fall forward (face down,
 * feet where the body stood), with the head and the chest brought up off the ground and the gun held out in
 * front from the shoulders. Set by looking.
 *   back    – how far the body is put back along the way it faces, so that where the player is, is its chest
 *             (and for the player's own body, its head: the eyes are there)
 *   up      – how far the whole of it is lifted: the drawing lies with its bones on the ground, and a chest is thicker than that
 *   chest, head – how far each is turned up off the ground, radians
 *   pivot   – where the gun hangs from the middle of the shoulders: up, and (negative) forward
 *   knee    – how far a knee is drawn out to the side at each pull of a crawl, radians
 */
// (chest and head were 0.2 and 0.95 for the old lying pose, which lay face down: the owner's lying down of
// 2026-10-14 (proneDown) lies with the head up already, and on top of it the head looked straight up at the sky.
// "when prone the users head looks very odd from 3rd person like looking straight up")
export const PRONE = { back: 1.2, backOwn: 1.62, up: 0.1, chest: 0, head: 0.12, pivot: [0.1, -0.3] as [number, number], knee: 0.5 };
/** sat on the ground: how far the hips come down from the chair the sitting was drawn on, and how nearly straight the legs are laid (set by looking) */
export const SIT = { drop: 0.4, legs: 0.92 };
/**
 * Sat in a low car (the police car). The library's sitting is on a chair, which is a jeep's bench: upright, the
 * shins straight down, the body a little forward. A car's seat is a hand over its floor and its roof is a head
 * over the seat, so each seat says how it is sat in: `legs`, how nearly straight the knees (as for sitting on the
 * ground, and for the same reason); `knees`, how far the thighs are lifted (radians); `back`, how far the body
 * lies back from the waist, against the seat (radians). In front the legs go out under the dashboard to the
 * pedals. Behind there is a third of a metre of floor and a roof lower than a sat body is tall: the knees are up,
 * the feet under them, and the body lies back along the seat, which is laid back as far itself. Set, with the
 * seats (SEAT_CAR in garage.ts), by measuring every point of the body's skin against the car: none under its
 * floor, none through its roof.
 */
export interface SeatPose {
  legs: number;
  knees: number;
  back: number;
}
export const CAR_SIT: { front: SeatPose; back: SeatPose } = { front: { legs: 0.85, knees: 0, back: 0.2 }, back: { legs: 0, knees: 0.43, back: 0.87 } };

/** where a thing that is worn sits on the body (see GEAR) */
type Worn = { bone: 'Head' | 'spine_03'; p: [number, number, number]; r: [number, number, number]; s: [number, number, number]; pack?: boolean };
/**
 * The gas mask on the head: the GP-5, a rubber hood over the whole of it, a little larger than life so that the
 * head is inside it. Its model lies on its back, eyepieces up and crown toward -z (scripts/assets.config.mjs lays
 * it so, and leaves out the hose and the filter can it came with): it is stood up and turned to face the way the
 * body faces. (Where it sits is where it sat from the day it was first worn until 2026-10-13, to the millimetre:
 * worked out again for the model as it is built now, by laying the old hood and the new one over each other.)
 */
const MASK: Worn = { bone: 'Head', p: [0.0007, 1.5772, 0.1298], r: [-Math.PI / 2, Math.PI, 0], s: [1.1, 1.1, 1.1] };
/**
 * Worn things that are drawn on the body. `p`, `r`, `s` place the item's model on the body
 * as it stands at rest (x to its right, y up, z behind it); the bone then carries it.
 */
export const GEAR: Record<string, Worn> = {
  // (the one backpack at two sizes: its straps are toward the body as its model comes, so it is not turned)
  // (the day pack is the camping pack made small: higher on the back, and nearer it)
  sack_pack: { bone: 'spine_03', p: [0, 1.0, 0.137], r: [0.05, 0, 0], s: [1, 1, 1], pack: true },
  camping_pack: { bone: 'spine_03', p: [0, 0.9, 0.2], r: [0.05, 0, 0], s: [1, 1, 1], pack: true },
  suitcase: { bone: 'spine_03', p: [0, 0.87, 0.215], r: [0.05, 0, 0], s: [1, 1, 1], pack: true },
  // (the helmet: its brow is toward +x as its model stands, so it is turned a quarter round)
  boonie_hat: { bone: 'Head', p: [0, 1.593, 0.035], r: [0, Math.PI / 2, 0], s: [1, 1, 1] },
  // (the K6-3: its brow is toward -z as its model stands, the way a body faces. It comes down over the ears and the nape.)
  // (2026-10-13, its visor down. The model stands 27 mm taller on its visor's lower edge and its middle is 19 mm
  // further back, so the same place on the head is said otherwise; and the helmet is 2 cm further forward on the
  // head than it was. It sat with the brow of its shell against the forehead and 5 cm of air behind the skull, and
  // the face stood 3 cm proud of the brow: a visor let down in front of that brow went through the nose and the
  // chin. Here there is a centimetre of air at the forehead and at the back of the skull alike, and a centimetre
  // between the tip of the nose and the visor's plate.)
  helmet_k63: { bone: 'Head', p: [0, 1.5229, -0.0107], r: [0, 0, 0], s: [1, 1, 1] },
  // (vests that are things of their own, hung on the chest: the plate carrier is not one of these, it is part of the suit)
  // (Fitted by measure, 2026-10-10: rays cast at the body and at each vest from front and from behind at eleven
  // heights, and the size, lean and place found that leave a finger or two of air on both sides and no more. As
  // they were first put on, the two vests stood a hand off the back and over the shoulders.)
  chest_rig: { bone: 'spine_03', p: [0, 1.0, 0.03], r: [-0.045, Math.PI, 0], s: [1.0, 0.9, 1.08] },
  soft_vest: { bone: 'spine_03', p: [0, 1.0, -0.014], r: [0.15, 0, 0], s: [1.0, 0.92, 1.05] },
  armor_vest: { bone: 'spine_03', p: [0, 1.0, -0.014], r: [0.15, 0, 0], s: [1.0, 0.88, 1.1] },
  heavy_armor: { bone: 'spine_03', p: [0, 0.95, 0.07], r: [-0.18, Math.PI, 0], s: [1.2, 1.02, 1.15] },
  // (the cap and the soft hat: their bands at the brow. The cap's peak is toward +z as its model lies, so it is turned round.)
  patrol_cap: { bone: 'Head', p: [0, 1.64, 0.01], r: [0, Math.PI, 0], s: [1, 1, 1] },
  fishermans_hat: { bone: 'Head', p: [0, 1.66, 0.0], r: [0, 0, 0], s: [1, 1, 1] },
  // (the steel pot: its brow is toward -z, as the K6-3's is. It is a smaller helmet than the other two, as it was made.)
  helmet_m1: { bone: 'Head', p: [0, 1.62, 0.012], r: [0, 0, 0], s: [1, 1, 1] },
  // (the gas mask: see MASK)
  gasmask: MASK,
};

/**
 * A gas mask as it is worn. The GP-5 lay on a table with its hose and its filter can, one stiff piece with it, and
 * they were cut off here each time it was put on; they are left out where the model is built now, so the mask is
 * worn as it lies and nothing is cut. (Kept because the game and the figure in the inventory both ask for it by name.)
 */
export function facepiece(obj: THREE.Object3D) {
  return obj;
}

/**
 * A helmet worn over the mask. The mask is a hood, a centimetre and more of rubber and air over the whole head, and
 * a helmet is made to sit on a head: left as they are the two pass through each other, the hood standing out
 * through the steel wherever the steel is nearer the head than the hood is. A real hood goes UNDER a helmet, and a
 * helmet over one rides a little higher: that is what is drawn. `nudge` moves the helmet while a mask is under it.
 * `keep` says what of the mask stays, as flat cuts in the body's resting frame (the frame GEAR is written in):
 * [nx, ny, nz, d], kept where nx x + ny y + nz z is no more than d. What the helmet covers is left out, cut clean
 * along a line the helmet's own edge hides.
 * (Measured, 2026-10-13, against the head as the game stands it: every place where the surface of the one went
 * through the surface of the other, and of those the ones that can be seen from outside.)
 */
export const OVER_MASK: Record<string, { keep: [number, number, number, number][]; nudge?: [number, number, number] }> = {
  // (The steel pot is the smallest of the helmets and sits a finger off the head: the hood filled it and came
  // through it all round, at 1,338 places that could be seen. With a mask under it it rides a centimetre higher,
  // and the hood is cut along the pot's edge, which is all but flat and four centimetres higher at the brow than at
  // the nape: 3 mm below the edge, in the shadow of the brim. Higher, the hood lay in the thickness of the steel
  // at the brow. Nothing of either goes through the other.)
  helmet_m1: { keep: [[0, 1, 0.147, 1.6505]], nudge: [0, 0.01, 0] },
  // (The Combat Helmet's brow is turned in until it all but touches the forehead: the hood stood out through it
  // above the eyepieces. With a mask under it it rides a centimetre higher and 12 mm forward, and the hood is
  // inside it everywhere above its edge. Nothing is cut: the hood meets it only where its ear pieces and the
  // rails at its temples press on the rubber.)
  boonie_hat: { keep: [], nudge: [0, 0.01, -0.012] },
  // (The K6-3's visor stays down over a mask: "keep the visor down", 2026-10-13. Its plate stands a centimetre off
  // the lips and the hood's muzzle is a centimetre and a half of rubber over them: as the two sat, the muzzle lay in
  // the thickness of the plate's lower four centimetres, at 108 places that could be seen. With a mask under it
  // the helmet sits a centimetre further forward, and the plate is clear of the hood. The valve needs nothing: it
  // leaves the hood under the chin, three centimetres below the visor's lower edge, and hangs in front of the
  // collar where it always hung; the eyepieces come behind the middle of the glass. So far forward, the back of the
  // hood stood out through the shell's lower edge at the nape: the hood is cut there, 4 mm up inside that edge, on a
  // slant that rises to above the brow in front, so that nothing of the face is cut. What still meets the hood is
  // the helmet's own chin strap and its buckle, which hang inside it at the jaw, where a bare head has them
  // against the cheek. Tipping the hood chin-in instead, 5 degrees, cleared the plate as well, and put the bridge
  // of the nose through the rubber between the eyepieces.)
  helmet_k63: { keep: [[0, 1, 0.86, 1.634]], nudge: [0, 0, -0.01] },
};

/** shapes already cut (see `under`): by the shape they were cut from and where */
const CUTS = new Map<string, THREE.BufferGeometry>();

/**
 * A shape with whatever of it is beyond any of these flat cuts left out: a triangle that lies across one is cut
 * along it, so the edge that is left is a clean line and not the saw's edge that leaving whole triangles out
 * gives. Cuts are [nx, ny, nz, d] in the shape's own frame: kept where n.p is no more than d.
 */
function cut(geo: THREE.BufferGeometry, cuts: number[][]): THREE.BufferGeometry {
  const key = `${geo.uuid}|${cuts.map((c) => c.map((x) => x.toFixed(5)).join()).join('|')}`;
  const had = CUTS.get(key);
  if (had) return had;
  const names = Object.keys(geo.attributes), attrs = names.map((n) => geo.attributes[n]);
  const at = attrs.map((_, i) => attrs.slice(0, i).reduce((s, a) => s + a.itemSize, 0)), wide = attrs.reduce((s, a) => s + a.itemSize, 0);
  const pos = at[names.indexOf('position')];
  const index = geo.index, count = index ? index.count : attrs[0].count;
  const corner = (i: number) => {
    const v = new Float32Array(wide);
    attrs.forEach((a, k) => {
      for (let c = 0; c < a.itemSize; c++) v[at[k] + c] = a.getComponent(i, c);
    });
    return v;
  };
  const out: number[] = [];
  for (let t = 0; t + 2 < count; t += 3) {
    let poly: Float32Array[] = [0, 1, 2].map((j) => corner(index ? index.getX(t + j) : t + j));
    for (const [nx, ny, nz, d] of cuts) {
      const off = (v: Float32Array) => nx * v[pos] + ny * v[pos + 1] + nz * v[pos + 2] - d;
      const next: Float32Array[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], da = off(a), db = off(b);
        if (da <= 0) next.push(a);
        if (da <= 0 !== db <= 0) {
          const u = da / (da - db), mid = new Float32Array(wide);
          for (let c = 0; c < wide; c++) mid[c] = a[c] + (b[c] - a[c]) * u;
          next.push(mid);
        }
      }
      poly = next;
      if (poly.length < 3) break;
    }
    for (let i = 1; i + 1 < poly.length; i++) for (const v of [poly[0], poly[i], poly[i + 1]]) for (let c = 0; c < wide; c++) out.push(v[c]);
  }
  const made = new THREE.BufferGeometry();
  const n = out.length / wide;
  names.forEach((name, k) => {
    const a = new Float32Array(n * attrs[k].itemSize);
    for (let i = 0; i < n; i++) for (let c = 0; c < attrs[k].itemSize; c++) a[i * attrs[k].itemSize + c] = out[i * wide + at[k] + c];
    made.setAttribute(name, new THREE.BufferAttribute(a, attrs[k].itemSize));
  });
  made.computeBoundingSphere();
  CUTS.set(key, made);
  return made;
}

/**
 * A mask as it is under a helmet: every piece of it cut where the helmet says (see OVER_MASK).
 * @param place where the mask's model is put on the body at rest (what GEAR says of it, as one turn and move)
 */
function under(mask: THREE.Object3D, place: THREE.Matrix4, keep: number[][]) {
  mask.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // (where the piece is in the mask's model, whatever the model hangs on just now)
    _m2.identity();
    for (let p: THREE.Object3D | null = mesh; p; p = p === mask ? null : p.parent) {
      p.updateMatrix();
      _m2.premultiply(p.matrix);
    }
    // (a cut said in the body's frame, said again in the piece's own: n.(M p) = (M' n).p + n.t)
    const e = _m2.premultiply(place).elements;
    mesh.geometry = cut(mesh.geometry, keep.map(([nx, ny, nz, d]) => [nx * e[0] + ny * e[1] + nz * e[2], nx * e[4] + ny * e[5] + nz * e[6], nx * e[8] + ny * e[9] + nz * e[10], d - (nx * e[12] + ny * e[13] + nz * e[14])]));
  });
}

/**
 * Where a worn thing is put on the body as it stands at rest, when these things are worn together (itself among
 * them): what GEAR says of it as one turn and move, a helmet over a mask where OVER_MASK moves it. And the thing
 * itself is made ready to be worn with the others: a mask cut under a helmet.
 * Null for a thing that is not hung on the body. (`setGear` dresses a body with this; so does whoever dresses one
 * by itself, the portrait in the inventory: a body dressed by GEAR alone had a hood through its helmet.)
 */
export function placeWorn(id: string, obj: THREE.Object3D, ids: string[], into = new THREE.Matrix4()): THREE.Matrix4 | null {
  const g = GEAR[id];
  if (!g) return null;
  const helmet = ids.some((other) => GEAR[other] === MASK) ? ids.map((other) => OVER_MASK[other]).find((h) => !!h) : undefined;
  const nudge = helmet && helmet === OVER_MASK[id] ? helmet.nudge : undefined;
  into.compose(_a.set(g.p[0] + (nudge?.[0] ?? 0), g.p[1] + (nudge?.[1] ?? 0), g.p[2] + (nudge?.[2] ?? 0)), _q1.setFromEuler(_euler.set(g.r[0], g.r[1], g.r[2], 'XYZ')), _b.set(...g.s));
  if (helmet && g === MASK && helmet.keep.length) under(obj, into, helmet.keep);
  return into;
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
  /** going down to lie (`proneDown`): the seconds of it over which the body comes down (its hips: crouched to 0.55, on the ground by 1.25), and how fast it is played back to get up */
  lie: [0.55, 1.25] as [number, number],
  rise: 1.25,
  /** metres crawled to one whole loop of `crawl` (it is drawn on the spot) */
  crawlStride: 0.9,
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
    // (A long gun with a stock is not put by `p` at the ready or aimed, but by its butt: see `butt`. `p` is for one
    // whose butt is not known. At the ready its muzzle is down 18 degrees, a low ready, and a little in toward the
    // other hand; it was 9. Further down and the gun hand is in the pouches of a plate carrier.)
    long: {
      ready: { p: [0.065, -0.19, -0.65], r: [-0.32, 0.06, 0] },
      aim: { p: [0.05, 0.1, -0.6], r: [0, 0, 0] },
      carry: { p: [-0.07, -0.07, -0.34], r: [0.656, 0.88, 0] },
    } as Stances,
    /**
     * A long gun with a stock is held by its butt, in the pocket of the firing shoulder. Where the middle of its
     * butt goes from the right shoulder's joint, by the chest's own right, up and back (as the upper back carries
     * them: a chest turned off the aim has its shoulder somewhere else than the aim's right), metres:
     *   ready: in the pocket, where the chest's front meets the shoulder (the jacket there is 14 cm in front of the joint);
     *   aim:   raised, the foot of the butt still in the pocket and the sights up toward the eye's line. The gun is
     *          to the firing side of the head, not under the eye: a head in a helmet with its visor down is not laid on a stock;
     *   prone: lying, the butt at the top of the shoulder, the gun out along the ground.
     * (The gun's own origin was put, for every long gun alike, on the middle line of a chest turned 43 degrees off the
     * aim. That stood an AK's butt 23 cm to the LEFT of the right shoulder, 9 cm inside the plate carrier, and a
     * sniper rifle's 13 cm inside it, and the right arm went across the chest to the grip, nearly straight: 10 cm
     * of the upper arm and of the forearm inside the vest. The user's, 2026-10-13: "the arm clips into the body",
     * "in real life the stock would be against the shoulder".)
     */
    butt: { ready: [0, 0.025, -0.143], aim: [0.03, 0.09, -0.125], prone: [-0.02, 0.1, -0.07] } as Record<'ready' | 'aim' | 'prone', [number, number, number]>,
    /**
     * A long gun with no stock (the submachine gun) is held the same way, by where the butt of a stock this long
     * would be, metres: both hands on it in front of the firing shoulder. (It was held out on the middle line of
     * the bladed chest as a rifle's origin was: 10 to 13 cm of the right arm inside the body, and 4 cm of the gun
     * inside a lowered visor when aimed. Squaring the chest to it instead left the forward hand 14 cm short.)
     */
    stockless: 0.18,
    /**
     * Aimed, a long gun is not left at the shoulder with the head upright beside it (the user's, 2026-10-13: "looks
     * bad, like not ADS", "the head needs to tilt towards the gun slightly as well like youre lining up sights"):
     * its sights are put in front of the right eye, and the head is brought to the gun.
     *   eye:     where the right eye is, in the body's resting frame as the head carries it (x right, y up, z behind);
     *   x:       how far outside the eye the gun's middle line is at the least;
     *   jaw:     and how far out from the middle of the head, where the head tips about: the stock stands upright
     *            beside the jaw and the head is tipped over it, which is what brings the eye to the sights;
     *   plate:   the same under a visor that is down, where there is no cheek to lay on the stock: further out,
     *            so that the stock, which is lower there, runs clear of the chest it is bladed across;
     *   beside:  how far outside whatever is worn on the cheek (a mask's rubber) the gun's line is, if that is further;
     *   front:   how far in front of the body's own upright line the chest's front is where the butt then rests, by
     *            the collar bone (in the resting frame, as the upper back carries it), and `slope`: how much
     *            further forward it is for each metre lower the butt rests;
     *   tilt, nod: the head laid over toward the stock, and nodded (radians);
     *   crane, drop: the neck craned to the gun (toward it, and forward: metres), and DOWN by whatever brings the
     *            eye level with the gun's sights, `drop` at the most. The gun is not carried up to an upright head: it
     *            stays at the height the shoulder holds it at, its comb about level with the chin of somebody
     *            standing straight, and the head comes down and over to it;
     *   shrug:   the firing shoulder hunched up to the butt, radians;
     *   body:    how much of that tilt is the upper chest's, the rest the neck's and the head's: it is the body that
     *            leans into the gun, not a head bent over on a stiff neck (the user's, 2026-10-13: "the head is not
     *            tilted enough it doesnt look like the model is aiming down sights");
     *   lean:    the chest leant in to the gun, radians;
     *   visored: how much of the head's part is done under a visor that is down. A stock cannot be laid on a
     *            cheek that is behind a steel plate: it goes under the plate's lower edge and the sights stand in
     *            front of the plate, as high as that lets them (see `faceGear`).
     */
    cheek: { eye: [0.032, 1.64, -0.075] as [number, number, number], x: 0, jaw: 0.05, plate: 0.1, beside: 0.025, front: 0.09, slope: 0.5, tilt: 0.35, body: 0.3, nod: 0.12, crane: [0.03, 0.04] as [number, number], drop: 0.07, shrug: 0.18, lean: 0.09, visored: 0.4 },
    /** aimed, the chest is turned this far off the aim (less than at the ready: the right shoulder comes round to the gun), the left shoulder comes this far forward, and the right this far */
    bladeAim: 0.6,
    reachAim: 0.75,
    reachRight: 0.6,
    /** how far both shoulders come forward to a pistol, radians (see GUN_ELBOW.pistolR) */
    protract: 0.14,
    // (A pistol at the ready and carried was a hand's width nearer the chest and off to the right: the left arm
    // went through the chest to get to it. In front of the middle of the body, at arm's length less a bend.)
    // (Held too high, as the rifles were (the owner, 2026-10-14: "This pistol actually needs to be lowered, like the
    // rifles needed before"; "no arm in the body, weapon positioned and held tilted when ads like real life"): at
    // the ready it is a low ready, both hands out at the belt, the muzzle down at the ground ahead; aimed, it stays
    // a little under the eye with the arms out and the head comes forward and down to the sights (`sighted`).)
    pistol: {
      // (And lower again, out at the belt, the muzzle further down, with the elbows down along the ribs and not out to
      // the sides: the owner, 2026-10-14: "the arms and shoulders look weird in 3rd person when holding the pistol
      // not ADS ... the shoulder profile looks too narrow when holding weapon in front". See GUN_ELBOW.pistolR.)
      ready: { p: [0.03, -0.4, -0.46], r: [-0.72, 0, 0] },
      // (At the eye it was 44 cm out: 6 cm further than the gun hand can reach and 10 further than the other. The
      // hands stopped short of it, behind its grip, wherever on it they were told to hold, and the pistol stood in
      // front of the fists that were meant to be round it. It is within reach, with a bend left in the elbows.)
      aim: { p: [0.035, 0.06, -0.39], r: [0, 0, 0] },
      carry: { p: [0.03, -0.42, -0.43], r: [-0.85, 0, 0] },
    } as Stances,
    /**
     * Aimed, a pistol is brought into the eye's line by the head and not up to it: the chest a little forward over
     * the arms, the head nodded down and pushed forward, so the eye sits behind the sights (radians, metres).
     */
    sighted: { lean: 0.08, nod: 0.2, forward: 0.03, down: 0.035 },
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
    /** how much of an arm's length a hand on a gun may be from its shoulder: past that the gun is brought in to the hands */
    within: 0.95,
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
// (for `curl`: a finger's parent's turn in the world carried down it, its inverse, and the line turned about seen from the parent)
const _cq = new THREE.Quaternion(), _cq2 = new THREE.Quaternion(), _ch = new THREE.Quaternion(), _ca = new THREE.Vector3();
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
const _Z = new THREE.Vector3(0, 0, 1);
/** below this much of a hold the gun is as good as out of the hands (see `holdT`) */
const HOLD_GONE = 0.06;
/** seconds the hands are given to come away from something broken off */
const CUT = 0.2;
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _euler = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
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
const _k6 = new THREE.Vector3(), _k7 = new THREE.Vector3(), _k8 = new THREE.Vector3();
const _k1 = new THREE.Vector3(), _k2 = new THREE.Vector3(), _k3 = new THREE.Vector3(), _k4 = new THREE.Vector3(), _k5 = new THREE.Vector3();
const _kq = new THREE.Quaternion(), _kr = new THREE.Quaternion();
/** the middle of each kind of long gun's butt (see `buttOf`), by the biggest of the gun's shapes */
const BUTTS = new WeakMap<THREE.BufferGeometry, Butt>();
/** a gun's butt, in the gun's own space: its middle, half its height, and how far over its middle the gun's top is where the eye is put (its sights) */
type Butt = { at: THREE.Vector3; half: number; rise: number };
/**
 * The middle of the butt of a gun, in the gun's own space (it lies along its own x, muzzle at +x): the middle of
 * the rearmost centimetre and a half of whatever of it is shown. Found once for each kind of gun.
 */
function buttOf(obj: THREE.Object3D): Butt | null {
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
const SOLE_UNDER = new Map<string, number>();

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Avatar {
  root = restWhileHidden(new THREE.Group());
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
  /** (`stop`: when it is to be over, if it was broken off: the hands are given a moment to come away) */
  private gesture: { kind: Gesture; t: number; dur: number; stop?: number } | null = null;
  private move: { kind: Move; t: number; dur: number; stop?: number } | null = null;
  private hold: Hold | null = null;
  // how far into the dance, and how far up the hands are, 0..1
  private danceT = 0;
  /** lying down (Z): asked for, how far gone, and the clock of the crawl; and the two thighs */
  /** how high the ground is at a place: what a body lying down lies to (the game says: see game.ts) */
  static ground: ((x: number, z: number) => number) | null = null;
  private prone = false;
  private proneT = 0;
  private crawl = 0;
  /** seconds into going down (`proneDown`): forward while lying is asked for, back while getting up; and how much of a crawl */
  private lieT = 0;
  private crawlK = 0;
  private crawlAt = 0;
  private thighs: THREE.Bone[] = [];
  /** how far sat down on the ground, 0..1; and the knees, with how each lies when the leg is straight */
  private groundT = 0;
  private knees: [THREE.Bone, THREE.Quaternion][] = [];
  /** in a seat, and how far into sitting the body has got */
  private seated = false;
  private seatT = 0;
  /** how the seat sat in is sat in: as the library drew it on a bench at knee height (the jeep), or a low car's way (see CAR_SIT) */
  private seatHow: SeatPose | null = null;
  private handsT = 0;
  private gearRest = new Map<string, { bone: THREE.Object3D; inv: THREE.Matrix4 }>();
  private gearObjs: THREE.Object3D[] = [];
  /** a pack is worn: a slung weapon rides outside it */
  private packOut = 0;
  /** seconds since the feet came back down after being in the air (-1 = long ago) */
  private landT = -1;
  private wasAir = false;
  /** seconds off the ground */
  private airFor = 0;
  /** fastest it has fallen since leaving the ground (negative), and how hard the last landing was, 0..1 */
  private fallV = 0;
  private landK = 1;
  private clock = Math.random() * 10;
  /** where in the stride the legs are, 0..1: shared by every stepping clip so they blend in step */
  private phase = Math.random();
  /** a foot came down during the last update (see POSE.plant): the step that is heard */
  footfall = false;
  /** crawling, an arm pulled the body along during the last update: the drag that is heard (two to a loop of `crawl`) */
  pull = false;
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
  private held: { obj: THREE.Object3D; grips: Grips; long: boolean; base: THREE.Quaternion; butt: THREE.Vector3 | null; sight: [number, number] } | null = null;
  /** what is worn on the head that a stock brought to the cheek goes round (see `faceGear`), and the gear it was found for */
  private face: { under: number | null; cheek: number } = { under: null, cheek: 0 };
  private faceOf: THREE.Object3D[] | null = null;
  private collarR?: THREE.Bone;
  /**
   * How much the hands are on the gun they hold, 0..1. They come off it to use something, to wave, to sit, and
   * when it is changed for another, and go back onto it, over a fifth of a second, the gun going down toward
   * the belt and coming up from it. (They left it and found it in a single frame: half a metre in one step.)
   */
  private holdT = 0;
  /** what is to be in the hands once what is in them now has been lowered */
  private nextHeld: { obj: THREE.Object3D | null; grips: Grips | null; kind: 'rifle' | 'pistol' | 'auto' | 'melee' } | null = null;
  /** a one-handed weapon in the right fist */
  private inHand: { obj: THREE.Object3D; curl: Curl; shoulder: boolean } | null = null;
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
  /** where the middle of the head as drawn is, on the Head bone (its own frame); null: a hand's breadth up it (see `frame`) */
  private headMid: THREE.Vector3 | null = null;
  /** the same, for each body's file: worked out once */
  private static headMids = new Map<string, THREE.Vector3 | null>();
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
  /** bodies are made one at a time, a person's before one of the infected's: see `make` */
  private static line = new Line();
  /**
   * A body has been made: what gets it ready to be drawn before it is handed to whoever asked for it (the game
   * sets this: Renderer.ready, and its pictures sent). `kind` is what bodies are alike by: the first of a kind is
   * waited for, and the rest are drawn with what was made for it.
   */
  static onMade: (parts: THREE.Object3D[], kind: string) => Promise<void> = async () => {};

  load(atmo: Atmosphere, layer = AVATAR_LAYER, firstPersonBody = false, look: Look = lookFor(''), file: BodyFile = 'survivor') {
    return Avatar.line.take(file === 'survivor', () => this.make(atmo, layer, firstPersonBody, look, file));
  }

  private async make(atmo: Atmosphere, layer: number, firstPersonBody: boolean, look: Look, file: BodyFile) {
    const gltf = await loadCharacter(file);
    // (A body is made over several frames, a part in each: see ../core/breathe.ts. In one go it was 25 to 30 ms
    // every time one of the infected or another player came near, and all sixty-odd of the infected at once on
    // coming into the game. Nothing of it is in the world until it is whole: whoever asked for it puts it there
    // when this is done.)
    await breathe();
    const model = SkeletonUtils.clone(gltf.scene) as THREE.Group;
    await breathe();
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
    // (turned to where it faces first, and then tipped to the ground it lies on, if it lies)
    this.root.rotation.order = 'YXZ';
    this.root.add(this.heldPivot);

    this.spine = ['spine_01', 'spine_02', 'spine_03'].map(bone).filter((b): b is THREE.Bone => !!b);
    this.chest = bone('spine_02');
    this.neck = ['neck_01', 'Head'].map(bone).filter((b): b is THREE.Bone => !!b);
    this.joints = { head: bone('Head') ?? undefined, neck: bone('neck_01') ?? undefined, pelvis: bone('pelvis') ?? undefined };
    this.headMid = Avatar.headMidOf(file, this.skin);
    // (as the body rests, before anything has moved it, a leg is straight)
    this.knees = ['calf_l', 'calf_r'].map(bone).filter((b): b is THREE.Bone => !!b).map((b) => [b, b.quaternion.clone()]);
    this.thighs = ['thigh_l', 'thigh_r'].map(bone).filter((b): b is THREE.Bone => !!b);
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
    this.collarR = bone('clavicle_r');
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
    await breathe();
    const driver = SkeletonUtils.clone(gltf.scene) as THREE.Group;
    await breathe();
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
      // (the infected's files have no lying down or crawling, and they never do either: a copy of the fall stands in)
      const own = gltf.animations.find((c) => c.name === name);
      const clip = own ?? (name === 'proneDown' || name === 'crawl' ? gltf.animations.find((c) => c.name === 'deathFront')?.clone() : undefined);
      if (!clip) throw new Error(`character has no "${name}" clip`);
      await breathe();
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
      await breathe();
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
    await Avatar.onMade(firstPersonBody ? [this.root, this.fpRoot] : [this.root], `${file}|${firstPersonBody ? 'own' : ''}`).catch(() => {});
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

  /**
   * Puts copies of what is slung on the back there: the first with its muzzle up over the left shoulder, flat
   * against the back, and a second crossing it, up over the right.
   */
  setSlung(objs: THREE.Object3D[] | THREE.Object3D | null) {
    this.slung.clear();
    const list = !objs ? [] : Array.isArray(objs) ? objs : [objs];
    list.slice(0, 2).forEach((obj, k) => {
      const c = obj.clone();
      c.traverse((o) => (o.layers.mask = this.layerMask));
      c.rotation.set(0.25, -Math.PI / 2, Math.PI * (k ? 0.38 : 0.62));
      c.position.set(k ? -0.1 : 0.1, 0.04, 0.01 + this.packOut + k * 0.045);
      c.userData.over = k * 0.045;
      this.slung.add(c);
    });
  }

  /** Hat, vest, pack: whatever of it is drawn (see GEAR). The models are this body's to keep. */
  setGear(items: { id: string; obj: THREE.Object3D }[]) {
    for (const o of this.gearObjs) o.removeFromParent();
    this.gearObjs = [];
    this.packOut = 0;
    for (const p of this.pieces.values()) p.visible = false;
    const ids = items.map(({ id }) => id);
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
      // (a helmet over a mask: the mask goes under it, cut where the helmet covers it, and the helmet may sit a
      // little otherwise for it: see OVER_MASK)
      placeWorn(id, obj, ids, _m1);
      holder.matrix.copy(rest.inv).multiply(_m1);
      holder.add(obj);
      rest.bone.add(holder);
      this.gearObjs.push(holder);
      if (g.pack) this.packOut = 0.2;
    }
    for (const c of this.slung.children) c.position.z = 0.01 + this.packOut + (c.userData.over ?? 0);
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

  /** @param now at once, already in the hands: for a scene that is cut to, where nobody sees it taken up */
  setHeld(obj: THREE.Object3D | null, grips: Grips | null, kind: 'rifle' | 'pistol' | 'auto' | 'melee' = 'rifle', now = false) {
    // A gun in two hands is not changed for another thing in one frame: it is lowered first (update() does
    // that, and then takes this up). Only where it could be seen: a body not yet placed, or not drawn, has it at once.
    if (now) this.holdT = obj && grips && kind !== 'melee' ? 1 : 0;
    else if (this.held && this.placed && this.root.visible && this.holdT > HOLD_GONE) {
      this.nextHeld = { obj, grips, kind };
      return;
    }
    this.nextHeld = null;
    this.takeUp(obj, grips, kind);
  }

  private takeUp(obj: THREE.Object3D | null, grips: Grips | null, kind: 'rifle' | 'pistol' | 'auto' | 'melee') {
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
    // (a long gun is held by its butt: one with a way of its own of being stood with has no stock, and is held by where the butt of one would be)
    const b = kind !== 'pistol' ? buttOf(obj) : null;
    const butt = b && grips.stand ? b.at.clone().setX(b.at.x - POSE.hold.stockless / obj.scale.x) : (b?.at ?? null);
    this.held = { obj, grips, long: kind !== 'pistol', base: obj.quaternion.clone(), butt, sight: b ? [b.half * obj.scale.y, b.rise * obj.scale.y] : [0.045, 0.095] };
  }

  /**
   * What is worn on the head that a stock brought to the cheek has to go round, measured off the worn things
   * themselves in the body's resting frame as the head carries it (once for each change of gear):
   *   under: the lowest point of anything that stands off the face beside the cheek or out in front of it (a
   *          visor that is down, a filter at the cheek): a stock goes under that, and null if there is none;
   *   cheek: how far out anything lying ON the cheek comes (a mask's rubber): a stock goes beside that.
   * (Called with the body's places in the world up to date.)
   */
  private faceGear() {
    if (this.faceOf === this.gearObjs) return this.face;
    this.faceOf = this.gearObjs;
    const rest = this.gearRest.get('Head'), eye = POSE.hold.cheek.eye[1];
    let under = Infinity, cheek = 0;
    if (rest) {
      _m1.multiplyMatrices(rest.bone.matrixWorld, rest.inv).invert();
      for (const holder of this.gearObjs) {
        if (holder.parent !== rest.bone) continue;
        holder.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const P = m.geometry.getAttribute('position');
          _m2.multiplyMatrices(_m1, m.matrixWorld);
          for (let i = 0; i < P.count; i++) {
            const { x, y, z } = _k6.fromBufferAttribute(P, i).applyMatrix4(_m2);
            if (y > eye || y < eye - 0.2 || z > 0 || z < -0.25 || x < 0.045 || x > 0.2) continue;
            if (x > 0.1 || z < -0.135) under = Math.min(under, y);
            else if (y > eye - 0.12 && y < eye - 0.03 && z < -0.01) cheek = Math.max(cheek, x);
          }
        });
      }
    }
    this.face = { under: under < Infinity ? under : null, cheek };
    return this.face;
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
  private solveArm(r: ArmRig, grip: HandGrip, weapon: THREE.Object3D, aimQ: THREE.Quaternion, slide?: THREE.Vector3, w = 1) {
    const target = grip.pos.clone().applyMatrix4(weapon.matrixWorld);
    const wq = weapon.getWorldQuaternion(new THREE.Quaternion());
    if (slide) {
      const A = r.arm.getWorldPosition(new THREE.Vector3());
      const reach = (r.la + r.lb) * 0.96;
      for (let moved = 0; moved < POSE.hold.slide && target.distanceTo(A) > reach; moved += 0.02) target.addScaledVector(slide, 0.02);
    }
    // Which way the elbow goes is said by the chest: its own right (the line of the shoulders) and its own up (the
    // line of the back), so that bladed, leaning and bent over, "out and down" is still out from these ribs and
    // down this side. Lying down, down is the ground. (Handed on as `reach` takes it: by the aim.)
    const stock = !!this.held?.butt, mine = r === this.armR, pistol = !!this.held && !this.held.long;
    const e = _k4.copy(mine ? (stock ? GUN_ELBOW.stockR : pistol ? GUN_ELBOW.pistolR : GUN_ELBOW.r) : stock ? GUN_ELBOW.stockL : pistol ? GUN_ELBOW.pistolL : GUN_ELBOW.l);
    // (a long gun carried at a run is across a square chest: the elbows as they are for a gun out in front)
    if (stock) e.lerp(mine ? GUN_ELBOW.aimR : GUN_ELBOW.aimL, this.aimT * (1 - this.proneT)).lerp(mine ? GUN_ELBOW.r : GUN_ELBOW.l, this.carryT);
    const up = this.joints.neck && this.spine[0] ? this.joints.neck.getWorldPosition(_k5).sub(this.spine[0].getWorldPosition(_k2)).normalize().lerp(UP, this.proneT).normalize() : _k5.copy(UP);
    const out = this.armR && this.armL ? this.armR.arm.getWorldPosition(_k1).sub(this.armL.arm.getWorldPosition(_k2)) : _k1.set(1, 0, 0).applyQuaternion(aimQ);
    out.addScaledVector(up, -out.dot(up)).normalize();
    const toward = _k3.crossVectors(out, up).normalize().multiplyScalar(e.z).addScaledVector(out, e.x).addScaledVector(up, e.y).applyQuaternion(_kq.copy(aimQ).invert());
    this.reach(r, target, grip.fingers.clone().applyQuaternion(wq), grip.palm.clone().applyQuaternion(wq), grip.curl, aimQ, w, toward);
  }

  /**
   * Brings a hand to a point in the world: wrist at `target`, fingers along `F`, palm facing `N`.
   * @param w how much of it: below 1 the arm is only part of the way from where the clip had it
   */
  private reach(r: ArmRig, target: THREE.Vector3, F: THREE.Vector3, N: THREE.Vector3, curl: Curl, aimQ: THREE.Quaternion, w = 1, toward?: THREE.Vector3) {
    const before = w < 1 ? [r.arm.quaternion.clone(), r.fore.quaternion.clone(), r.hand.quaternion.clone()] : null;
    const A = r.arm.getWorldPosition(new THREE.Vector3());
    const toT = target.clone().sub(A);
    const la = r.la, lb = r.lb;
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(la - lb) + 1e-3, (la + lb) * 0.999);
    const dir = toT.normalize();
    const cosA = (la * la + d * d - lb * lb) / (2 * la * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pole = (toward ?? r.pole).clone().applyQuaternion(aimQ);
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
    this.curl(r, curl.map((c) => (typeof c === 'number' ? c * w : c.map((j) => j * w))) as Curl, handWorld);
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
  private curl(r: ArmRig, curl: Curl, handWorld: THREE.Quaternion) {
    const Lf = r.fingersLocal;
    const Lp = r.palmLocal.clone().sub(Lf.clone().multiplyScalar(r.palmLocal.dot(Lf))).normalize();
    const curlAxis = new THREE.Vector3().crossVectors(Lf, Lp).applyQuaternion(handWorld).normalize();
    // (the hand's own turn in the world as it stands, read once)
    const hand = r.hand.getWorldQuaternion(_ch);
    r.fingers.forEach((chain, fi) => {
      const c = curl[fi];
      if (!chain.length) return;
      // Each joint turned about the same line in the world, as `turn` did, worked out down the finger from the turns
      // alone: `turn` walked up the whole body twice for every joint (thirty a pair of hands, every frame for every
      // infected in sight). A turn about a line in the world is the same turn about that line seen from the joint's
      // parent: the parent's own turn in the world is carried down the finger as each joint is turned.
      const parent = chain[0].parent!;
      const pw = parent === r.hand ? _cq.copy(hand) : parent.getWorldQuaternion(_cq);
      chain.forEach((bone, j) => {
        // (one figure closes the whole finger as a fist closes; three say each joint, for a finger laid round something with a shape of its own)
        const a = typeof c === 'number' ? c * (j === 0 ? 0.8 : j === 1 ? 1.1 : 0.8) : c[j] ?? 0;
        _ca.copy(curlAxis).applyQuaternion(_cq2.copy(pw).invert());
        bone.quaternion.premultiply(_q1.setFromAxisAngle(_ca, a));
        pw.multiply(bone.quaternion);
      });
      chain[0].updateMatrixWorld(true);
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
    // (broken off, the hands are not put back where they were in one frame: see `stop`)
    if (kind) this.gesture = { kind, t: 0, dur };
    else if (this.gesture && this.gesture.stop === undefined) this.gesture.stop = this.gesture.t + CUT;
  }

  /** A call from the wheel: what the arms do with it (a wave, a point). null drops them. */
  emote(kind: Move | null, dur = 1.5) {
    if (kind) this.move = { kind, t: 0, dur };
    else if (this.move && this.move.stop === undefined) this.move.stop = this.move.t + CUT;
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
    // (the middle of the head as this body draws it; where that is not known, the joint is at the base of the skull
    // and the middle of the head is a hand's breadth up it)
    if (this.headMid) head.copy(this.headMid).applyMatrix4(j.head.matrixWorld);
    else head.setFromMatrixPosition(j.head.matrixWorld).addScaledVector(_a.setFromMatrixColumn(j.head.matrixWorld, 1).normalize(), 0.097);
    neck.setFromMatrixPosition(j.neck.matrixWorld);
    pelvis.setFromMatrixPosition(j.pelvis.matrixWorld);
    return true;
  }

  /**
   * Where the middle of the head as a body draws it is, on its Head bone: the middle of every point of its mesh that
   * hangs mostly on the head, as it was bound. For the infected, whose heads are their own shapes on fitted skeletons:
   * the hand's breadth up the bone that fits the player's own head put the ball that is shot at 4 to 8 cm off theirs,
   * and a shot at the far side of a head went past it (the owner, 2026-10-14: "sometimes i shoot the zombie in the
   * head but it doesnt register"; "the zombies head collisiosn does not actualyl fit perfectly on their head"). The
   * player's body has its head as a piece of its own, and keeps the hand's breadth.
   */
  private static headMidOf(file: string, skin: THREE.SkinnedMesh | undefined): THREE.Vector3 | null {
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

  /** Lying down, or up again. */
  setProne(on: boolean) {
    this.prone = on;
  }

  /** Sitting in a jeep's seat (whoever seats it puts it there and turns it with the jeep: see Garage.seatBody). */
  setSeat(on: boolean, how: SeatPose | null = null) {
    this.seated = on;
    if (on) this.seatHow = how;
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
      if (this.gesture.t >= Math.min(this.gesture.dur, this.gesture.stop ?? Infinity) || dead) this.gesture = null;
    }
    const ges = this.gesture;
    if (this.move) {
      this.move.t += dt;
      if (this.move.t >= Math.min(this.move.dur, this.move.stop ?? Infinity) || dead) this.move = null;
    }
    const mv = this.move;
    this.danceT += ((this.hold === 'dance' && !dead ? 1 : 0) - this.danceT) * ease(7);
    this.groundT += ((this.hold === 'sit' && !dead ? 1 : 0) - this.groundT) * ease(5);
    // Lying down is the movement made for it, at its own pace, from a crouch: from standing too (the owner, 2026-10-14:
    // "we should play the crouch to prone even if proning from standing"); getting up is the same, back. Moving the
    // while, it is hurried, so that a body is never drawn kneeling where the player already crawls or runs. `proneT`
    // is how far down it has come: what the place it lies at, the hands on a gun and the eyes go by.
    const lieEnd = this.dur.proneDown - 1e-3;
    if (!dead) this.lieT = this.prone ? Math.min(lieEnd, this.lieT + dt * (speedNow > 0.3 ? 2 : 1)) : Math.max(0, this.lieT - dt * (speedNow > 1 ? 3 : POSE.rise));
    this.proneT = dead ? this.proneT - this.proneT * ease(6) : THREE.MathUtils.smoothstep(this.lieT, POSE.lie[0], POSE.lie[1]);
    this.crawlK += ((this.prone && !dead && this.lieT >= lieEnd && speedNow > 0.15 ? 1 : 0) - this.crawlK) * ease(8);
    this.handsT += ((this.hold === 'surrender' && !dead ? 1 : 0) - this.handsT) * ease(9);
    // eating, drinking, dressing a wound, waving, dancing: whatever was in the hands is put away for it
    this.seatT += ((this.seated && !dead ? 1 : 0) - this.seatT) * ease(9);
    // (and sat in a jeep it is slung)
    const using = (!!ges && ges.kind !== 'bolt' && ges.kind !== 'reload' && ges.kind !== 'check') || !!mv || this.danceT > 0.25 || this.handsT > 0.25 || this.seatT > 0.25 || this.groundT > 0.25;
    // (the hands come off a gun and go back onto it over a fifth of a second, and one gun is lowered before the next is taken up)
    const busy = (!!ges && ges.kind !== 'bolt' && ges.kind !== 'reload' && ges.kind !== 'check') || !!mv || this.hold !== null || this.seated;
    const wantHold = !!this.held && !busy && !dead && !this.nextHeld;
    if (!this.placed) this.holdT = wantHold ? 1 : 0;
    else this.holdT += ((wantHold ? 1 : 0) - this.holdT) * ease(wantHold ? 11 : dead ? 26 : 16);
    if (this.nextHeld && this.holdT <= HOLD_GONE) {
      const n = this.nextHeld;
      this.nextHeld = null;
      this.takeUp(n.obj, n.grips, n.kind);
    }
    const hold = this.held && this.holdT > 0.004 ? this.holdT : 0;
    const held = hold ? this.held : null;
    /** how much of a movement of the hands is left, if it was broken off: 1 until then */
    const left = (m: { t: number; stop?: number } | null) => (m?.stop === undefined ? 1 : 1 - THREE.MathUtils.smoothstep(m.t, m.stop - CUT, m.stop));
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
    // (killed lying down, a body is down already: it does not stand up to fall)
    if (dead && this.downT === 0 && this.proneT > 0.5) {
      this.deathClip = 'deathFront';
      this.downT = this.dur.deathFront;
    }
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
    // (Known by going up in the first moments off the ground, not on the first frame of it: another player's
    // rise comes smoothed and is not yet there on that frame, so their jumps never had the push-off.)
    this.airFor = inAir ? this.airFor + dt : 0;
    if (inAir && this.jumpT < 0 && this.airFor < 0.15 && velocity.y > 1.5) this.jumpT = 0;
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
      proneDown: 0,
      crawl: 0,
      sit: 0,
      armed: 0,
      strike: 0,
    };
    // sat down (in a seat, or on the ground), sitting is all of it but the flinch
    const st = Math.max(this.seatT, this.groundT) * (1 - down);
    if (st > 0) {
      for (const n of CLIPS) if (n !== 'hit' && n !== 'hitHead') w[n] *= 1 - st;
      w.sit = st * rest;
    }
    w[this.deathClip] = down;
    // lying down, alive: going down (its last moment is how the body lies) or crawling, and everything else gives way
    // to it, from the first moment of it (it begins in a crouch); `pr` is how far down the body is
    const pr = this.proneT * (1 - down), lying = Math.min(1, this.lieT / 0.15) * (1 - down);
    if (lying > 0.001) {
      for (const n of CLIPS) if (n !== 'hit' && n !== 'hitHead') w[n] *= 1 - lying;
      w.proneDown += lying * (1 - this.crawlK);
      w.crawl += lying * this.crawlK;
    }
    // (the crawl keeps time with the ground: a pull of the arms for so much of it, backwards when going backwards)
    const pulled = this.crawlAt;
    this.crawlAt = (((this.crawlAt + (dt * speedNow * dirSign) / POSE.crawlStride) % 1) + 1) % 1;
    this.pull = this.crawlK > 0.5 && speedNow > 0.15 && Math.floor(pulled * 2) !== Math.floor(this.crawlAt * 2);
    // --- and where in each. One stride clock for every stepping clip, so the same foot is
    // down in all of them and a blend of two is still a step.
    const rate: Record<Stride, number> = {
      walk: THREE.MathUtils.clamp(Math.min(speed, POSE.walkTop) / POSE.pace.walk, 0.6, 2.1),
      run: THREE.MathUtils.clamp(speed / POSE.pace.run, 1, 1.2),
      // (to 4.8: the hurried crouch is 3.3 m/s, and at 2.8 the legs crept at 1.9 under a body going nearly twice that)
      crouchWalk: THREE.MathUtils.clamp(speed / POSE.pace.crouchWalk, 0.6, 4.8),
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
      if (n === 'proneDown') a.time = this.lieT;
      else if (n === 'crawl') a.time = this.crawlAt * this.dur[n];
      else if (n === 'death' || n === 'deathFront' || n === 'deathSide') a.time = Math.min(this.downT, this.dur[n] - 1e-3);
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
    // Sat on the ground. The library's sitting is on a chair: the legs are laid out straight in front instead of
    // going down to a floor that is not there, and the hips are let down to the ground (below, with the body's place).
    const onGround = this.groundT * (1 - down);
    // (and in a low car, the same: see CAR_SIT)
    const how = this.seatHow, inCar = how ? this.seatT * (1 - down) : 0;
    const legs = Math.max(onGround * SIT.legs, inCar * (how?.legs ?? 0));
    if (legs > 0.001) for (const [knee, straight] of this.knees) knee.quaternion.slerp(straight, legs);
    if (how && inCar > 0.001) {
      // (about the body's own line from side to side, wherever it has been turned: forward of it goes up, up goes back)
      this.root.updateMatrixWorld(true);
      _right.setFromMatrixColumn(this.root.matrixWorld, 0).normalize();
      if (how.knees) for (const t of this.thighs) if (t) this.turn(t, _right, how.knees * inCar);
      if (how.back) {
        for (const b of this.spine) this.turn(b, _right, (how.back * inCar) / this.spine.length);
        // (and the head comes up again most of the way: the eyes are on the road, not the roof)
        for (const b of this.neck) this.turn(b, _right, (-how.back * 0.6 * inCar) / this.neck.length);
      }
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
    this.root.position.y -= SIT.drop * onGround;
    this.root.rotation.set(0, this.yaw + this.twist, 0);
    if (pr > 0.001) {
      // (the body lies forward of its feet: it is put back so that where the player is, is its chest)
      this.crawl += speed * dt * 2.4;
      const going = Math.min(1, speed / 0.5) * pr * (1 - this.crawlK);
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), back = (firstPerson ? PRONE.backOwn : PRONE.back) * pr;
      this.root.position.x += sy * back;
      this.root.position.z += cy * back;
      // It lies ON the ground, and to the ground: its feet on the ground where they are, its head on the ground
      // where that is, tipped to one side as the ground is. (Laid level at the height of the middle of it, on a
      // hillside one end of it was under the grass and the other in the air.) Under a roof, on a floor that is
      // not the ground's, a floor is level.
      let tip = 0, roll = 0;
      const G = Avatar.ground;
      if (G && Math.abs(G(pos.x, pos.z) - pos.y) < 0.3) {
        const x = this.root.position.x, z = this.root.position.z, feet = G(x, z);
        tip = Math.atan2(G(x - sy * 1.6, z - cy * 1.6) - feet, 1.6);
        const mx = x - sy * 0.9, mz = z - cy * 0.9;
        roll = Math.atan2(G(mx + cy * 0.3, mz - sy * 0.3) - G(mx - cy * 0.3, mz + sy * 0.3), 0.6);
        this.root.position.y += (feet - this.root.position.y) * pr;
      }
      this.root.position.y += PRONE.up * pr;
      this.root.rotation.set(tip * pr, this.yaw + this.twist + Math.sin(this.crawl) * 0.05 * going, roll * pr);
    }
    this.heldPivot.visible = !dead && hold > 0.1;
    // (and what is in the fist is put away as a gun is, while the hands are at something else)
    if (this.inHand) this.inHand.obj.visible = !using;
    this.heldPivot.rotation.set(pitch, -this.twist, 0);
    this.aimT += ((aiming && !dead ? 1 : 0) - this.aimT) * ease(12);
    this.carryT += (THREE.MathUtils.smoothstep(speed, 2.6, 3.6) * (1 - this.aimT) - this.carryT) * ease(7);
    const carry = this.carryT * (1 - this.aimT);

    // Dying, what is laid over the clips goes as the clips go: the turn of the waist, the lean, the look up or
    // down and the arms on a gun are let go over the tenth of a second the fall takes to come in. (They were all
    // dropped on the first frame of it, while the body was still nine tenths standing.)
    const alive = 1 - down, gone = dead && alive < 0.001;
    const lean = !gone && (held || Math.abs(pitch) > 0.02);
    const lift = POSE.crouchLift * this.crouchT * alive;
    const over = gone ? 0 : this.leanT * alive;
    // (leaning, the hips go a little the same way: the head ends up where the eyes of whoever is leaning are)
    if (over) this.root.position.addScaledVector(_right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), over * POSE.leanHips);
    if (!gone && (lean || Math.abs(this.twist) > 0.003 || Math.abs(lift) > 0.003 || Math.abs(over) > 0.003 || pr > 0.003)) {
      this.root.updateMatrixWorld(true);
      // the legs have turned; from the waist up the body still faces the aim
      const n = this.spine.length;
      const aimQ = _aimQ.setFromAxisAngle(UP, this.yaw);
      _right.set(1, 0, 0).applyQuaternion(aimQ);
      // a long gun is held across the body: chest turned off the aim, left shoulder leading,
      // the head still looking down the barrel
      // (and square again for a run, the gun carried across the chest)
      // (aimed, a gun with a butt has the chest come round to it a little: see POSE.hold.cheek)
      const weld = held?.butt ? this.aimT * (1 - pr) : 0;
      const blade = held?.long ? THREE.MathUtils.lerp(POSE.hold.blade, POSE.hold.bladeAim, weld) * (1 - carry) * hold : 0;
      // (the legs' turn and the blade are two turns of the one waist: together they are no more than it can turn.
      // Stepping one way with a long gun they came to 120 degrees.)
      const waist = THREE.MathUtils.clamp(-this.twist - blade, -POSE.maxTwist, POSE.maxTwist) * alive;
      const bladed = (-waist - this.twist) * alive;
      _fwd.set(0, 0, -1).applyQuaternion(aimQ);
      for (const b of this.spine) {
        this.turn(b, UP, waist / n);
        if (lift) this.turn(b, _right, lift / n);
        // leaning out: over from the waist, about the line the body is facing along
        if (over) this.turn(b, _fwd, (over * POSE.leanAngle) / n);
      }
      // (the head stays level: it is the eyes that are being put round the corner)
      if (over) for (const b of this.neck) this.turn(b, _fwd, (-over * POSE.leanAngle * 0.55) / this.neck.length);
      if (Math.abs(bladed) > 1e-4) for (const b of this.neck) this.turn(b, UP, bladed / this.neck.length);
      // Aiming a long gun, the head goes to the gun: the chest leant in, the neck craned toward the stock, the
      // head tipped to it and down, as somebody lining up sights. Less of it under a visor that is down.
      const welded = weld * hold * (1 - carry) * alive;
      if (welded > 0.002 && this.neck.length && held && this.armR) {
        const c = POSE.hold.cheek, g = this.faceGear(), k = welded * (g.under !== null ? c.visored : 1), neck = this.neck[0];
        // The upper body leans into the gun: the chest in and over toward it, the firing shoulder rolled forward
        // and hunched up to the butt.
        if (this.chest) this.turn(this.chest, _right, -c.lean * welded);
        this.turn(this.spine[this.spine.length - 1], _fwd, c.tilt * k * c.body);
        if (this.collarR) {
          this.turn(this.collarR, UP, POSE.hold.reachRight * welded);
          this.turn(this.collarR, _fwd, -c.shrug * welded);
        }
        // The head is laid over onto the stock and nodded,
        for (const b of this.neck) this.turn(b, _fwd, (c.tilt * k * (1 - c.body)) / this.neck.length);
        this.turn(this.neck[this.neck.length - 1], _right, -c.nod * k);
        // and the neck is craned to the gun: toward it, forward, and down until the eye is level with the sights
        // (the butt is where the shoulder will hold it: see the hold, below).
        const chest = this.gearRest.get('spine_03'), face = this.gearRest.get('Head');
        if (neck.parent && chest && face) {
          const up = _k7.set(0, 1, 0).applyQuaternion(this.heldPivot.getWorldQuaternion(_kr)), a = POSE.hold.butt.aim;
          const butt = this.armR.arm.getWorldPosition(_k8).add(_k6.set(a[0], a[1], a[2]).applyQuaternion(_kr.setFromRotationMatrix(_m1.multiplyMatrices(chest.bone.matrixWorld, chest.inv))));
          _m1.multiplyMatrices(face.bone.matrixWorld, face.inv);
          let over = _k6.set(c.eye[0], c.eye[1], c.eye[2]).applyMatrix4(_m1).sub(butt).dot(up) - held.sight[1];
          // (under a visor that is down, only until its lower edge is on the top of the stock)
          if (g.under !== null) over = Math.min(over, _k6.set(c.plate, g.under, -0.1).applyMatrix4(_m1).sub(butt).dot(up) - held.sight[0] - 0.006);
          neck.getWorldPosition(_k6).addScaledVector(_right, c.crane[0] * k).addScaledVector(_fwd, c.crane[1] * k).addScaledVector(up, -THREE.MathUtils.clamp(over, 0, c.drop) * welded);
          neck.position.copy(neck.parent.worldToLocal(_k6));
          neck.updateMatrixWorld(true);
        }
      }
      // Aiming a pistol, the head goes to the sights the same way, without a stock to lay it on: forward and down.
      const sighted = held && !held.long ? this.aimT * (1 - pr) * hold * (1 - carry) * alive : 0;
      if (sighted > 0.002 && this.neck.length) {
        const c = POSE.hold.sighted, neck = this.neck[0];
        if (this.chest) this.turn(this.chest, _right, -c.lean * sighted);
        this.turn(this.neck[this.neck.length - 1], _right, -c.nod * sighted);
        if (neck.parent) {
          neck.getWorldPosition(_k6).addScaledVector(_fwd, c.forward * sighted).addScaledVector(UP, -c.down * sighted);
          neck.position.copy(neck.parent.worldToLocal(_k6));
          neck.updateMatrixWorld(true);
        }
      }
      if (pr > 0.003) {
        // lying: the chest a little up on the elbows and the head up off the ground, the eyes on what is ahead;
        // and crawling, one knee and then the other drawn out to the side
        if (this.chest) this.turn(this.chest, _right, PRONE.chest * pr);
        for (const b of this.neck) this.turn(b, _right, (PRONE.head * pr) / this.neck.length);
        const pull = Math.sin(this.crawl) * PRONE.knee * Math.min(1, speed / 0.5) * pr * (1 - this.crawlK);
        if (this.thighs[0] && pull > 0) this.turn(this.thighs[0], UP, pull);
        if (this.thighs[1] && pull < 0) this.turn(this.thighs[1], UP, pull);
      }
      if (lean) {
        // (lying, the chest is on the ground and stays there: the head does all of the looking up and down, as far as
        // a neck goes, so that somebody prone is seen to look where they look)
        if (this.chest) this.turn(this.chest, _right, pitch * 0.45 * alive * (1 - pr));
        // and the head goes the rest of the way: you can see where somebody is looking
        const look = THREE.MathUtils.lerp(pitch * POSE.headPitch, THREE.MathUtils.clamp(pitch * 0.85, -0.5, 0.6), pr);
        for (const b of this.neck) this.turn(b, _right, (look * alive) / this.neck.length);
        if (held && this.armR && this.armL) {
          // The weapon hangs from the shoulders, wherever the clips have taken them: down
          // into a crouch, up and down with each stride.
          const mid = this.armL.arm.getWorldPosition(_a).add(this.armR.arm.getWorldPosition(_b)).multiplyScalar(0.5);
          this.root.worldToLocal(mid);
          // (lying, it is held out in front of the shoulders and a little over them, not hung below them)
          this.heldPivot.position.copy(_b.set(0, THREE.MathUtils.lerp(POSE.hold.pivot[0], PRONE.pivot[0], pr), THREE.MathUtils.lerp(POSE.hold.pivot[1], PRONE.pivot[1], pr)).applyAxisAngle(UP, -this.twist)).add(mid);
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
          const kind = long ? POSE.hold.long : POSE.hold.pistol;
          // (a gun with a way of its own of being stood with, or carried at a run: a submachine gun out in front of the chest; that or a pistol muzzle up in the gun hand)
          const set = grips.stand ? { ...kind, ...grips.stand } : kind;
          const carried: Stance = grips.carry ?? set.carry;
          const wAim = this.aimT, wReady = 1 - wAim - carry;
          const turned = (s: Stance, q: THREE.Quaternion) => q.setFromEuler(_euler.set(s.r[0], s.r[1], s.r[2], 'YXZ'));
          // A long gun with a stock is held by its butt (see POSE.hold.butt): in the pocket of the right shoulder,
          // wherever the chest has taken that. Its muzzle is dipped at the ready; less the further down the eyes
          // already are, and not at all lying down (it would be in the ground).
          const butt = held.butt, chest = butt && this.gearRest.get('spine_03');
          const level = (1 - pr) * THREE.MathUtils.clamp(1 + Math.min(0, pitch) / 0.8, 0, 1);
          const ready: Stance = chest ? { p: set.ready.p, r: [set.ready.r[0] * level, set.ready.r[1] * level, set.ready.r[2]] } : set.ready;
          if (butt && chest) {
            this.heldPivot.updateWorldMatrix(false, false);
            _kq.setFromRotationMatrix(_m1.multiplyMatrices(chest.bone.matrixWorld, chest.inv));
            this.armR.arm.getWorldPosition(_k1);
          }
          /** where a stance puts the gun's own origin, from the pivot: by its butt if it has one (at `world`, if that is said), by `p` if not */
          const put = (s: Stance, to: [number, number, number] | null, at: THREE.Vector3, world?: THREE.Vector3) => {
            if (!butt || !chest || !to) return at.set(s.p[0], s.p[1], s.p[2]);
            const lie = POSE.hold.butt.prone;
            if (world) at.copy(world);
            else at.set(to[0] + (lie[0] - to[0]) * pr, to[1] + (lie[1] - to[1]) * pr, to[2] + (lie[2] - to[2]) * pr).applyQuaternion(_kq).add(_k1);
            return this.heldPivot.worldToLocal(at).sub(_k2.copy(butt).multiply(obj.scale).applyQuaternion(turned(s, _kr).multiply(base)));
          };
          put(ready, POSE.hold.butt.ready, _k3);
          put(set.aim, POSE.hold.butt.aim, _k4);
          const face = butt && chest && wAim > 0.001 && pr < 0.999 ? this.gearRest.get('Head') : undefined;
          if (face && chest) {
            // Aimed, the gun is put under the eye: its butt at the height the shoulder holds it at (or as high as
            // a stock passes under what is worn in front of the cheek, if that is lower), in line with the right
            // eye, which the head has been brought down and over to it for, and back along the aim to the chest's
            // front, where the butt rests.
            // (Worked in the aim's own frame, the pivot's: x to the aim's right, y up, z back. The gun stands
            // upright in that; the head is tipped in it.)
            const c = POSE.hold.cheek, g = this.faceGear(), [half, rise] = held.sight;
            _m1.multiplyMatrices(face.bone.matrixWorld, face.inv);
            const eye = this.heldPivot.worldToLocal(_k6.set(c.eye[0], c.eye[1], c.eye[2]).applyMatrix4(_m1));
            const a = POSE.hold.butt.aim, high = this.heldPivot.worldToLocal(_k7.set(a[0], a[1], a[2]).applyQuaternion(_kq).add(_k1)).y;
            const mid = this.heldPivot.worldToLocal(face.bone.getWorldPosition(_k7));
            const out = Math.max(g.under !== null ? c.plate : c.jaw, g.cheek ? g.cheek + c.beside : 0);
            const line = _k8.set(Math.max(eye.x + c.x, mid.x + out), Math.min(high, eye.y - rise), eye.z), eyeY = eye.y;
            // (under a visor: no higher than its lower edge lets the top of the butt pass, where the gun's line is)
            if (g.under !== null) line.y = Math.min(line.y, this.heldPivot.worldToLocal(_k6.set(line.x - mid.x, g.under, -0.1).applyMatrix4(_m1)).y - half - 0.006);
            // and back along the aim to the chest's front, where the butt rests
            const front = _k6.set(0, 0, -1).applyQuaternion(_kq).applyQuaternion(this.heldPivot.getWorldQuaternion(_kr).invert());
            // (a butt held lower than the collar bone, under a visor, rests further down the chest, which stands further forward there)
            const lower = Math.max(0, eyeY - line.y - 0.1) * c.slope;
            const chestAt = this.heldPivot.worldToLocal(_k7.set(0, 1.45, -c.front - lower).applyMatrix4(_m1.multiplyMatrices(chest.bone.matrixWorld, chest.inv)));
            line.z += chestAt.sub(line).dot(front) / Math.min(-0.3, front.z);
            _k4.lerp(put(set.aim, POSE.hold.butt.aim, _k7, this.heldPivot.localToWorld(line)), 1 - pr);
          }
          obj.position.set(0, 0, 0).addScaledVector(_k3, wReady).addScaledVector(_k5.set(carried.p[0], carried.p[1], carried.p[2]), carry).addScaledVector(_k4, wAim);
          turned(ready, _qa);
          if (carry > 0.001) _qa.slerp(turned(carried, _qb), carry / Math.max(1e-4, 1 - wAim));
          if (wAim > 0.001) _qa.slerp(turned(set.aim, _qb), wAim);
          if (hold < 1) {
            // being put away, or taken up: down toward the belt, its muzzle tipped to the ground
            const away = 1 - THREE.MathUtils.smoothstep(hold, 0, 1);
            obj.position.y -= 0.24 * away;
            obj.position.z += 0.1 * away;
            _qa.multiply(_qb.setFromAxisAngle(_X, -0.7 * away));
          }
          obj.quaternion.copy(_qa).multiply(base);
          // the hands at work on the weapon (grip points are in its own space: x toward the muzzle, y up)
          let gripR = grips.right, gripL = grips.left;
          if (ges) {
            const k = ges.t / ges.dur;
            const sm = (a: number, b: number) => THREE.MathUtils.smoothstep(k, a, b);
            const live = left(ges);
            const work = grips.work;
            if (ges.kind === 'check') {
              // Looked over: brought up in front of the chest with its muzzle lifted, turned over to show one side
              // and then the other, and let back down. Both hands stay on it and turn with it.
              const up = sm(0, 0.14) * (1 - sm(0.86, 1)) * live;
              const over = (sm(0.14, 0.32) - sm(0.42, 0.66) * 2 + sm(0.74, 0.88)) * live;
              obj.position.y += 0.07 * up;
              obj.position.z += 0.04 * up;
              obj.quaternion.multiply(_q1.setFromAxisAngle(_Z, 0.45 * up)).multiply(_q2.setFromAxisAngle(_X, 0.85 * over));
            } else if (long && ges.kind === 'bolt' && gripR && work?.bolt) {
              // The right hand leaves the grip for the bolt handle: up with it, back, home, and down. The rifle
              // rolls a little to meet the hand. (It was sent to where the old rifle's bolt was, which on these
              // is further up the gun than the arm is long: the arm went out straight and stopped there.)
              const off = sm(0, 0.16) * (1 - sm(0.84, 1)) * live;
              const lift = sm(0.16, 0.3) - sm(0.7, 0.84), back = sm(0.3, 0.48) - sm(0.52, 0.7);
              gripR = { ...gripR, pos: gripR.pos.clone().lerp(_w.copy(work.bolt).add(_v1.set(-0.085 * back, 0.03 * lift, -0.012 * lift)), off) };
              obj.quaternion.multiply(_q1.setFromAxisAngle(_X, 0.2 * off));
            } else if (long && ges.kind === 'reload' && gripL && work?.feed) {
              // The forward hand leaves the fore-end to feed the gun, and the gun is rolled over to it.
              const t = ges.t, end = ges.dur;
              let at: number;
              if (work.tube) {
                // a shell at a time into the tube: the hand in under the port as each goes home, and away for the next
                at = THREE.MathUtils.smoothstep(t, 0.08, 0.5) * (1 - THREE.MathUtils.smoothstep(t, end - 0.5, end - 0.08));
                // (in, and away between shells only while there are shells going in: eased, at both ends of the loading)
                const fed = THREE.MathUtils.smoothstep(t, 0.3, 0.55) * (1 - THREE.MathUtils.smoothstep(t, end - 0.67, end - 0.42));
                const push = 1 - fed * (0.5 - 0.5 * Math.cos(((t - 0.55) / 0.48) * Math.PI * 2));
                _w.copy(work.feed).add(_v1.set(0.035 * push - 0.03 * (1 - push), 0.02 * push - 0.075 * (1 - push), -0.035 * (1 - push)));
              } else {
                // a magazine: the hand to it, down and away with the old one to the belt, back up with the new, and home
                at = sm(0.06, 0.24) * (1 - sm(0.8, 0.97));
                const away = sm(0.28, 0.42) * (1 - sm(0.48, 0.62));
                _w.copy(work.feed).add(_v1.set(-0.06 * away, -0.26 * away, -0.07 * away));
              }
              at *= live;
              gripL = { ...gripL, pos: gripL.pos.clone().lerp(_w, at) };
              obj.quaternion.multiply(_q1.setFromAxisAngle(_X, (work.tube ? 0.34 : 0.18) * at));
            } else if (!long && gripL) {
              // a fresh magazine: the left hand goes down to the belt for it and comes back up under the grip
              // (to the belt at its own side: 30 cm straight down from the gun is further than the arm is long, and
              // the way there is through the ribs)
              const away = sm(0.1, 0.32) * (1 - sm(0.5, 0.78)) * live;
              gripL = { ...gripL, pos: gripL.pos.clone().add(_w.set(-0.05 * away, -0.19 * away, -0.13 * away)) };
              obj.quaternion.multiply(_q1.setFromAxisAngle(_X, -0.3 * sm(0, 0.15) * (1 - sm(0.8, 1)) * live));
            }
          }
          this.heldPivot.updateMatrixWorld(true);
          // (both shoulders drawn a little forward to a pistol held out in front, as shoulders are when the arms reach
          // ahead of the chest: without it, from behind, the arms went in front of a back as narrow as the chest, and
          // the shoulders looked pinched; see GUN_ELBOW.pistolR)
          if (!long) {
            if (this.collarL) this.turn(this.collarL, UP, -POSE.hold.protract * hold);
            if (this.collarR) this.turn(this.collarR, UP, POSE.hold.protract * hold);
          }
          // the leading shoulder comes forward to the gun
          if (blade && this.collarL) this.turn(this.collarL, UP, -THREE.MathUtils.lerp(POSE.hold.reach, POSE.hold.reachAim, weld) * (1 - carry) * hold);
          // A gun is held no further out than the hands that hold it can reach. The stances are said from the
          // shoulders of a body standing still; crouched, in the air, looking down and at a run the shoulders are
          // somewhere else, and a hand sent past the end of its arm stops short of the gun: a pistol was left 2 to
          // 12 cm out in front of the fists. It is brought in toward the shoulders until both hands of a pistol, and
          // the gun hand of a long gun (whose other hand slides), are on it with a bend left in the elbow.
          for (let pass = 0; pass < 3; pass++) {
            const far = (grip: HandGrip | null, r: ArmRig) => (grip ? _a.copy(grip.pos).applyMatrix4(obj.matrixWorld).distanceTo(r.arm.getWorldPosition(_b)) - (r.la + r.lb) * POSE.hold.within : 0);
            const over = Math.max(far(grips.right, this.armR), long ? 0 : far(grips.left, this.armL));
            if (over <= 0.001) break;
            const back = this.armL.arm.getWorldPosition(_a).add(this.armR.arm.getWorldPosition(_b)).multiplyScalar(0.5).sub(obj.getWorldPosition(_w));
            // (aimed, hardly downward at all: the sights stay at the eye)
            back.y *= 1 - 0.8 * this.aimT;
            this.heldPivot.position.add(back.normalize().multiplyScalar(Math.min(0.1, over * 1.2)).applyQuaternion(_q1.copy(this.root.quaternion).invert()));
            this.heldPivot.updateMatrixWorld(true);
          }
          if (gripR) this.solveArm(this.armR, gripR, obj, aimQ, undefined, hold);
          // the forward hand may sit further back along the stock than the first-person arms
          // have it: these arms are only so long
          // (a gun carried in the one hand at a run: the other is let go of it by as much as it is carried so, and swings as the body runs)
          if (gripL) this.solveArm(this.armL, gripL, obj, aimQ, gripR && !(ges && !long) ? _slide.set(0, 0, 1).applyQuaternion(_qa).applyQuaternion(this.heldPivot.getWorldQuaternion(_q1)) : undefined, hold * (grips.carry?.free ? 1 - carry : 1));
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
      if (this.inHand && !using) {
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
      const wgt = THREE.MathUtils.smoothstep(ges.t, 0, 0.3) * (1 - THREE.MathUtils.smoothstep(ges.t, ges.dur - 0.25, ges.dur)) * left(ges);
      // (No hand is sent further than its arm goes with a bend left in it. These places are measured from the head,
      // and crouched the head is further from the shoulders: the arms went out dead straight and stopped short.)
      const near = (to: THREE.Vector3, r: ArmRig) => {
        const from = r.arm.getWorldPosition(_v2), d = to.distanceTo(from), most = (r.la + r.lb) * 0.93;
        return d > most ? to.sub(from).multiplyScalar(most / d).add(from) : to;
      };
      if (ges.kind === 'eat' || ges.kind === 'drink') {
        // up to the mouth and back down, once a bite or a gulp
        const period = ges.kind === 'eat' ? 0.95 : 1.25;
        const cyc = 0.5 - 0.5 * Math.cos((Math.max(0, ges.t - 0.3) / period) * Math.PI * 2);
        const m = ges.kind === 'drink' ? Math.pow(cyc, 0.6) : cyc;
        this.reach(this.armR, near(at(0.3, -0.36, 0.12).lerp(at(0.17, -0.06, 0.05), m), this.armR), dirOf(-0.2 * m, 0.8, -0.5), dirOf(-1, 0, -0.4), [1.0, 1.05, 1.1, 1.15], aimQ, wgt);
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
      // Lying down, the body that is seen from its own eyes lies where the body lies: behind them, on the ground
      // and tipped to it. (It was left where a standing body is, a step behind the eyes and upright in its
      // bones' lying pose: a back and a pair of shoulders on the ground in front of the face.)
      const lying = dead ? 0 : this.proneT;
      if (lying > 0.001) {
        this.fpRoot.position.lerp(this.root.position, lying);
        this.fpRoot.rotation.order = 'YXZ';
        this.fpRoot.rotation.copy(this.root.rotation);
      }
      // (And it is not drawn on the way down or the way up: going down, the body fell forward through the eyes
      // and hung in front of them for the half second it took. Lying, it is all behind them, and is drawn again:
      // whoever looks back along themselves sees their own legs.)
      this.fpRoot.visible = lying < 0.02 || lying > 0.97;
      this.fpRoot.scale.copy(this.root.scale);
    }
  }

  /**
   * Drawn faintly, or as anybody is: a vanished admin, as another admin sees them. Each piece is given a faint
   * copy of its own paint (the paints are shared between bodies, and are not touched), and its own back again
   * after. Asked again while it is faint, it catches whatever has been put on or taken up since.
   */
  setGhost(on: boolean) {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const solid = m.userData.solid as THREE.Material | THREE.Material[] | undefined;
      if (on && !solid) {
        m.userData.solid = m.material;
        const faint = (x: THREE.Material) => {
          const c = x.clone();
          c.transparent = true;
          c.opacity = 0.38;
          c.depthWrite = false;
          return c;
        };
        m.material = Array.isArray(m.material) ? m.material.map(faint) : faint(m.material);
        m.castShadow = false;
      } else if (!on && solid) {
        for (const x of Array.isArray(m.material) ? m.material : [m.material]) x.dispose();
        m.material = solid;
        delete m.userData.solid;
        m.castShadow = true;
      }
    });
  }

  dispose() {
    this.root.removeFromParent();
    this.fpRoot.removeFromParent();
    this.mixer?.stopAllAction();
    for (const m of this.hairMats) m.dispose();
  }
}
