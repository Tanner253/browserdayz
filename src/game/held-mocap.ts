// First person on the motion capture (the owner, 2026-10-25: "hand animations where needed in first person"): what
// is held with no weapon pack of its own moves as the body everybody else sees moves, from the same movements. Their
// hands' paths are made by scripts/mocap.mjs (src/game/avatar/hands.json: each hand's place and turn from the head,
// frame by frame, in the eye's own measure: x to the right, y up, z back), fetched the first time they are wanted;
// until then the hand-made curves stand in. The framing of each thing in the picture stays the game's own: the paths
// say when a hand goes, how fast, and which way round, and by how much it leaves where it is held.

import * as THREE from 'three';

type Frame = [number, number, number, number, number, number, number];
type Track = { dur: number; r: Frame[]; l: Frame[]; e?: number[][]; s?: number[][]; mouth?: number[] };
let hands: Record<string, Track> | null = null;
let asked = false;
/** the paths, if they have come (asked for the first time this is called) */
function lib() {
  // (development: the hand-made curves, to see what was before)
  if (import.meta.env.DEV && (globalThis as { __oldHands?: boolean }).__oldHands) return null;
  if (!hands && !asked) {
    asked = true;
    void import('./avatar/hands.json').then((m) => (hands = m.default as unknown as Record<string, Track>)).catch(() => (asked = false));
  }
  return hands;
}
// (fetched a while after the game starts, off the way in, so that the first blow is already on them; at once when
// something to hit with is taken up: see meleeSoon)
if (typeof window !== 'undefined') setTimeout(() => void lib(), 10000);
/** the paths sent for now: something to hit with is in the hand */
export const meleeSoon = () => void lib();
/** the paths, when they have come (the sandbox waits for them) */
export const handsReady = () => import('./avatar/hands.json').then((m) => void (hands ??= m.default as unknown as Record<string, Track>));

const _q = new THREE.Quaternion();
/** where along a track `u` (0..1 of it) falls: the frame before, and how far on to the next */
function at(n: number, u: number): [number, number, number] {
  const f = THREE.MathUtils.clamp(u, 0, 1) * (n - 1), i = Math.min(n - 2, Math.floor(f));
  return [i, i + 1, f - i];
}

/**
 * A hand of a movement at a share `u` of it, as a move from where it is at `from` (a share too): how far it has gone
 * (`pos`, metres in the eye's measure) and how it has turned (`quat`, in the eye's measure). False until the paths have come.
 */
export function handMove(name: string, side: 'r' | 'l', u: number, from: number, pos: THREE.Vector3, quat: THREE.Quaternion): boolean {
  const t = lib()?.[name];
  if (!t) return false;
  const k = t[side], [a, b, w] = at(k.length, u), [a0, b0, w0] = at(k.length, from);
  const p = (i: number, j: number, s: number, o: THREE.Vector3) => o.set(k[i][0] + (k[j][0] - k[i][0]) * s, k[i][1] + (k[j][1] - k[i][1]) * s, k[i][2] + (k[j][2] - k[i][2]) * s);
  const q = (i: number, j: number, s: number, o: THREE.Quaternion) => o.set(k[i][3], k[i][4], k[i][5], k[i][6]).slerp(_q.set(k[j][3], k[j][4], k[j][5], k[j][6]), s);
  p(a, b, w, pos).sub(p(a0, b0, w0, new THREE.Vector3()));
  q(a, b, w, quat).multiply(q(a0, b0, w0, new THREE.Quaternion()).invert());
  return true;
}

/** how near the right hand is to the mouth at a share `u` of the drink, 0..1 (null until the paths have come) */
export function mouthAt(u: number): number | null {
  const m = lib()?.drink?.mouth;
  if (!m) return null;
  const [a, b, w] = at(m.length, u);
  return m[a] + (m[b] - m[a]) * w;
}

/** how long a movement takes as captured (null until the paths have come) */
export const lengthOf = (name: string) => lib()?.[name]?.dur ?? null;

/**
 * How far out a jab is at a share `u` of the game's punch (0 at the guard, 1 the arm out) and how far it is drawn back
 * first (0..1), from the right jab or the left. The game's punch lands 0.28 of the way through (see Weapons): the
 * jab's own moment of reaching out is put there, the drawing back before it and the coming home after as captured.
 */
export function jabAt(side: 1 | -1, u: number): { out: number; wind: number } | null {
  const t = lib()?.[side > 0 ? 'jabR' : 'jabL'];
  if (!t) return null;
  const k = side > 0 ? t.r : t.l, z0 = k[0][2];
  let far = 0;
  for (let i = 1; i < k.length; i++) if (k[i][2] < k[far][2]) far = i;
  const reach = Math.max(1e-3, z0 - k[far][2]), hit = far / (k.length - 1);
  const s = u < 0.28 ? (u / 0.28) * hit : hit + ((u - 0.28) / 0.72) * (1 - hit);
  const [a, b, w] = at(k.length, s), z = k[a][2] + (k[b][2] - k[a][2]) * w;
  // (and home by the end of the game's punch, wherever the jab had got to: the left is captured held out)
  const home = 1 - THREE.MathUtils.smootherstep(u, 0.6, 1);
  return { out: THREE.MathUtils.clamp((z0 - z) / reach, 0, 1) * home, wind: THREE.MathUtils.clamp(((z - z0) / reach) * 4, 0, 1) };
}

/**
 * The blow with something in the right fist (the slash, see scripts/mocap.mjs), at a share `u` of the game's own: it
 * lands 0.35 of the way through (see Weapons.actionTick), and the slash cuts 0.53 s into its 1.53. From part way up
 * the drawing back (a quick blow has no time for all of it) to where the cut is through. @returns seconds into the slash
 */
export function slashAt(u: number) {
  return u < 0.35 ? THREE.MathUtils.lerp(0.22, 0.53, u / 0.35) : THREE.MathUtils.lerp(0.53, 0.82, (u - 0.35) / 0.65);
}

// --- Melee (2026-10-25, the owner: "Make sure Melle weapons are properly rigged and animated"). Seen from its own eyes
// most of a blow passes outside the picture, so it is shown as the arm threw it: the arm, shoulder to fist, points the
// way the captured arm pointed (round and up from where it was as the blow landed, a share as far: the picture is
// narrow), from where it is held in the picture, and reaches and draws in as that arm did; the elbow likewise. The
// thing in the fist is held as the blow says it is held when it lands (the edge leading), and turns about that as the
// captured hand turned. (Moved by the hand's own path, the wind-up drew the fist into the face; turned from the
// capture's own start, an arm that began hanging at the side swung the thing out of the bottom of the picture; held
// exactly as the captured hand was, the wrist's roll had the head pointing back at the eye the moment it landed.)
// The movements whose arm is written, elbow and shoulder too: scripts/mocap-melee.json `arms`.

/** where the right shoulder is from the eye in the first-person picture (x right, y up, z behind), metres */
export const FP_SHOULDER = new THREE.Vector3(0.19, -0.27, 0.1);
/** and the middle of the chest: what a thing in both hands is swung about, so that both stay in front of the body */
export const FP_CHEST = new THREE.Vector3(0.05, -0.3, 0.1);
/** the nearest the fist comes to the eye, ahead of it (metres) */
const NEAREST = -0.32;

/**
 * One blow cut out of a captured movement: which (its name in scripts/mocap.mjs), from when it is drawn back (`from`), when the thing is through the
 * middle of the picture (`hit`) and when it has come home (`to`), seconds into the movement.
 *   reach – the share of the arm's swing shown (round, and up), from where it is as the blow lands
 *   at    – where the fist is as it lands: round to the left and up from where it rests, radians (by default a
 *           fifth of a turn round toward the middle of the picture)
 *   lands – how the thing is held as it lands: which way its head points and its edge faces (the eye's space, as a
 *           stance says it: see stanceQuat); as it rests, where none is said
 *   turn  – the share of the captured hand's turning about that
 */
export interface Cut {
  clip: string;
  from: number;
  hit: number;
  to: number;
  reach?: [number, number];
  at?: [number, number];
  lands?: { tip: [number, number, number]; edge: [number, number, number] };
  turn?: number;
}

export interface FpPose {
  /** which way the arm points from the shoulder, and the upper arm, in the picture (unit) */
  arm: THREE.Vector3;
  upper: THREE.Vector3;
  /** how much longer the arm reaches than when the blow lands (1: as long) */
  stretch: number;
  /** how the hand has turned since the blow landed, in the eye's space */
  turn: THREE.Quaternion;
  /** how much of the blow is shown (0 at rest, 1 in the middle of it) */
  w: number;
}

export const fpPose = (): FpPose => ({ arm: new THREE.Vector3(), upper: new THREE.Vector3(), stretch: 1, turn: new THREE.Quaternion(), w: 0 });

const _h = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Vector3(), _hh = new THREE.Vector3(), _sh = new THREE.Vector3(), _eh = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qh = new THREE.Quaternion(), _id = new THREE.Quaternion();
/** an angle brought within half a turn either way */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** a place along a row of places at a share `u` of it */
function placeAt(rows: number[][], u: number, out: THREE.Vector3) {
  const [a, b, w] = at(rows.length, u);
  return out.set(rows[a][0] + (rows[b][0] - rows[a][0]) * w, rows[a][1] + (rows[b][1] - rows[a][1]) * w, rows[a][2] + (rows[b][2] - rows[a][2]) * w);
}
/** how a hand is turned at a share `u` of its track, in the eye's measure */
function turnAt(k: Frame[], u: number, out: THREE.Quaternion) {
  const [a, b, w] = at(k.length, u);
  return out.set(k[a][3], k[a][4], k[a][5], k[a][6]).slerp(_q.set(k[b][3], k[b][4], k[b][5], k[b][6]), w);
}

/** a way, as round (to the right) and up from straight ahead, radians */
const roundOf = (d: THREE.Vector3) => Math.atan2(d.x, -d.z);
const upOf = (d: THREE.Vector3) => Math.asin(THREE.MathUtils.clamp(d.y / Math.max(1e-6, d.length()), -1, 1));
const wayOf = (round: number, up: number, out: THREE.Vector3) => out.set(Math.sin(round) * Math.cos(up), Math.sin(up), -Math.cos(round) * Math.cos(up));

/** whether a blow's movement is to hand (sent for, the first time it is asked) */
export const hasCut = (c: Cut | null | undefined): c is Cut => !!c && !!lib()?.[c.clip]?.e;

/**
 * Where a blow is at `u` of the way through the game's swing (0..1), the game counting it landed at `hitU`. The drawing
 * back is played from `from` to `hit` in the share of the swing before `hitU`, the rest after. It comes in from rest
 * over the first tenth and goes home over the last quarter, wherever the capture ended.
 * @param rest the arm and the upper arm as they rest in the picture (from the shoulder: see layOn)
 */
export function cutPose(c: Cut, u: number, hitU: number, rest: { arm: THREE.Vector3; upper: THREE.Vector3 }, out: FpPose): FpPose {
  const p = lib()![c.clip];
  const t = u < hitU ? THREE.MathUtils.lerp(c.from, c.hit, u / hitU) : THREE.MathUtils.lerp(c.hit, c.to, (u - hitU) / (1 - hitU));
  const T = t / p.dur, H = c.hit / p.dur;
  const [kr, ku] = c.reach ?? [0.5, 0.5];
  out.w = THREE.MathUtils.smoothstep(u, 0, 0.1) * (1 - THREE.MathUtils.smoothstep(u, 0.75, 1));
  placeAt(p.s!, T, _s);
  placeAt(p.r, T, _h).sub(_s);
  placeAt(p.e!, T, _e).sub(_s);
  placeAt(p.s!, H, _sh);
  placeAt(p.r, H, _hh).sub(_sh);
  placeAt(p.e!, H, _eh).sub(_sh);
  // The arm, round and up from where the captured arm was as the blow landed, a share as far, from where the fist is
  // put as it lands (the middle of the picture): so every blow lands where it is seen, however it was captured.
  const [ar, au] = c.at ?? [0.35, 0];
  wayOf(roundOf(rest.arm) - ar + wrap(roundOf(_h) - roundOf(_hh)) * kr, upOf(rest.arm) + au + (upOf(_h) - upOf(_hh)) * ku, out.arm);
  wayOf(roundOf(rest.upper) - ar + wrap(roundOf(_e) - roundOf(_eh)) * kr, upOf(rest.upper) + au + (upOf(_e) - upOf(_eh)) * ku, out.upper);
  out.stretch = _h.length() / Math.max(0.05, _hh.length());
  // (the hand's turn since the blow landed, a share of it: as the captured hand turned, whatever its fingers' frame)
  turnAt(p.r, T, _qa);
  turnAt(p.r, H, _qh);
  out.turn.copy(_qa).multiply(_qh.invert()).slerp(_id, 1 - (c.turn ?? 0.7));
  return out;
}

const _v = new THREE.Vector3(), _r = new THREE.Quaternion(), _l = new THREE.Quaternion();
const _sx = new THREE.Vector3(), _sy = new THREE.Vector3(), _sz = new THREE.Vector3(), _sm = new THREE.Matrix4();
/** a thing's turn from which way its head points (its own up) and its edge faces (its far side, -z), in the eye's space */
export function stanceQuat(s: { tip: readonly number[]; edge: readonly number[] }, out: THREE.Quaternion) {
  _sy.set(s.tip[0], s.tip[1], s.tip[2]).normalize();
  _sz.set(s.edge[0], s.edge[1], s.edge[2]);
  _sz.addScaledVector(_sy, -_sz.dot(_sy)).normalize().negate();
  _sx.crossVectors(_sy, _sz);
  return out.setFromRotationMatrix(_sm.makeBasis(_sx, _sy, _sz));
}
const _rest = { arm: new THREE.Vector3(), upper: new THREE.Vector3() };
/** A blow, from where the fist and the elbow rest in the picture and how the thing is held there. `two`: in both hands. */
export function layOn(c: Cut, u: number, hitU: number, pos: THREE.Vector3, quat: THREE.Quaternion, elbow: THREE.Vector3, at: FpPose, two = false) {
  const pivot = two ? FP_CHEST : FP_SHOULDER;
  const L = _rest.arm.copy(pos).sub(pivot).length(), Lu = _rest.upper.copy(elbow).sub(FP_SHOULDER).length();
  cutPose(c, u, hitU, _rest, at);
  pos.lerp(_v.copy(at.arm).multiplyScalar(L * at.stretch).add(pivot), at.w);
  // (never into the eye: an arm swung round past the side or up over the head stays in front of it, going out of the
  // top of the picture rather than over the eye; and the elbow under the eye: raised past it, the sleeve filled the picture)
  pos.z = Math.min(pos.z, NEAREST);
  elbow.lerp(_v.copy(at.upper).multiplyScalar(Lu).add(FP_SHOULDER), at.w);
  elbow.y = Math.min(elbow.y, -0.08);
  if (c.lands) stanceQuat(c.lands, _l);
  else _l.copy(quat);
  quat.slerp(_r.copy(at.turn).multiply(_l), at.w);
}

/**
 * Something to hit with, looked over (I, as a gun is: the owner, 2026-10-25, of the knives' finishes, "cool stuff"): brought
 * in toward the middle of the picture and a little nearer, turned to show one face, then over to show the other, and
 * home. A finish is what it shows off.
 */
export const LOOK = { dur: 2.4, at: [0.05, -0.105, -0.36] as const, turn: 1.25, tilt: -0.35 };
/** how far round its ring a thing hung by one is spun, `k` of the way through being looked over: two turns, eased in and out */
export const spinOf = (k: number) => -Math.PI * 4 * THREE.MathUtils.smootherstep(k, 0.22, 0.78);
const _lq = new THREE.Quaternion(), _le = new THREE.Euler(), _la = new THREE.Vector3();
/**
 * `k` of the way through being looked over, laid on where the fist, the thing and the elbow are. A thing hung by a ring
 * (`spin`: a karambit's, see meleeHeld) is not turned over in the fist but spun twice round the finger in it, as a
 * karambit is shown off (the owner's reference, CS:GO's), and caught.
 */
export function lookOver(k: number, pos: THREE.Vector3, quat: THREE.Quaternion, elbow: THREE.Vector3, spin?: THREE.Object3D | null) {
  const s = THREE.MathUtils.smoothstep, w = s(k, 0, 0.15) * (1 - s(k, 0.86, 1));
  if (spin) spin.rotation.x = spinOf(k);
  if (w <= 0) return;
  // (its one face, its other face, and back: round the eye's up, the head tipped toward the eye; a spun thing is held still)
  const yaw = spin ? 0 : LOOK.turn * (s(k, 0.1, 0.32) - 2 * s(k, 0.45, 0.68) + s(k, 0.78, 0.95));
  _lq.setFromEuler(_le.set(LOOK.tilt * w, yaw, 0.25 * yaw, 'YXZ'));
  _la.set(LOOK.at[0], LOOK.at[1], LOOK.at[2]);
  elbow.add(_v.copy(_la).sub(pos).multiplyScalar(w * 0.8));
  pos.lerp(_la, w);
  quat.premultiply(_lq);
}
