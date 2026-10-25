// A captured blow in first person (2026-10-25, the owner: "Make sure Melle weapons are properly rigged and animated"). The
// body throws it in third person; seen from its own eyes most of it passes outside the picture (the old `strike` did), so
// it is not shown as it is but as the arm threw it: the arm, shoulder to fist, points the way the captured arm pointed
// (round and up from straight ahead, a share as far: the picture is narrow), from where it is held at rest in the
// picture, and reaches and draws in as that arm did; the elbow likewise. The thing in the fist is held as the blow says
// it is held when it lands (the edge leading), and turns about that as the captured hand turned. So both views throw
// one blow, with the capture's weight: the wind-up out of the top of the picture, the snap through the middle, the
// follow-through out of the far side. (Moved by the hand's own path, the wind-up drew the fist into the face; turned
// from the capture's own start, an arm that began hanging at the side swung the thing out of the bottom of the
// picture; held exactly as the captured hand was, the wrist's roll through the blow had the head pointing back at the
// eye the moment it landed.)
// The paths are written by scripts/melee-paths.mjs (paths.json): each hand, elbow and shoulder from the eyes, and which
// way each hand's fingers and palm face.

import * as THREE from 'three';
import PATHS from './paths.json';

type Path = { fps: number; dur: number; rh: number[][]; re: number[][]; rs: number[][]; rf: number[][]; lh: number[][]; le: number[][]; ls: number[][]; lf: number[][]; head: number[][] };
const TABLE = PATHS as unknown as Record<string, Path>;

/** where the right shoulder is from the eye in the first-person picture (x right, y up, z behind), metres */
export const FP_SHOULDER = new THREE.Vector3(0.19, -0.27, 0.1);
/** the nearest the fist comes to the eye, ahead of it (metres) */
const NEAREST = -0.32;

/**
 * One blow cut out of a captured movement: which, from when it is drawn back (`from`), when the thing is through the
 * middle of the picture (`hit`) and when it has come home (`to`), seconds into the movement.
 *   reach – the share of the arm's swing shown (round, and up), from where it is as the blow lands
 *   at    – where the fist is as it lands: round to the left and up from where it rests, radians (by default a
 *           fifth of a turn round toward the middle of the picture)
 *   lands – how the thing is held as it lands: which way its head points and its edge faces (the eye's space, as a
 *           stance says it: see stanceQuat); as it rests, where none is said
 *   turn  – the share of the captured hand's turning about that
 *   lean  – how much of the head's turning the picture takes
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
  lean?: number;
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
  /** the head's own turn off the body, as nose up, nose left, roll (radians) */
  head: THREE.Vector3;
}

export const fpPose = (): FpPose => ({ arm: new THREE.Vector3(), upper: new THREE.Vector3(), stretch: 1, turn: new THREE.Quaternion(), w: 0, head: new THREE.Vector3() });

const _h = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Vector3(), _b = new THREE.Vector3(), _hh = new THREE.Vector3(), _sh = new THREE.Vector3(), _eh = new THREE.Vector3();
/** an angle brought within half a turn either way */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const _f = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix4(), _qa = new THREE.Quaternion(), _qh = new THREE.Quaternion(), _id = new THREE.Quaternion();

/** a row of the path at a time in seconds, between its frames */
function rowAt(rows: number[][], fps: number, t: number, out: THREE.Vector3) {
  const f = THREE.MathUtils.clamp(t * fps, 0, rows.length - 1), i = Math.min(rows.length - 2, Math.floor(f)), u = f - i;
  const a = rows[i], b = rows[i + 1];
  return out.set(a[0], a[1], a[2]).lerp(_b.set(b[0], b[1], b[2]), u);
}

/** how a hand is turned at a time (its fingers and palm, laid as a frame), in the eye's space */
function handAt(rows: number[][], fps: number, t: number, out: THREE.Quaternion) {
  const f = THREE.MathUtils.clamp(t * fps, 0, rows.length - 1), i = Math.min(rows.length - 2, Math.floor(f)), u = f - i;
  const a = rows[i], b = rows[i + 1];
  const F = _f.set(a[0], a[1], a[2]).lerp(_b.set(b[0], b[1], b[2]), u).normalize();
  const N = _n.set(a[3], a[4], a[5]).lerp(_b.set(b[3], b[4], b[5]), u);
  N.addScaledVector(F, -N.dot(F)).normalize();
  return out.setFromRotationMatrix(_m.makeBasis(F, N, _b.crossVectors(F, N)));
}

/** a way, as round (to the right) and up from straight ahead, radians */
const roundOf = (d: THREE.Vector3) => Math.atan2(d.x, -d.z);
const upOf = (d: THREE.Vector3) => Math.asin(THREE.MathUtils.clamp(d.y / Math.max(1e-6, d.length()), -1, 1));
const wayOf = (round: number, up: number, out: THREE.Vector3) => out.set(Math.sin(round) * Math.cos(up), Math.sin(up), -Math.cos(round) * Math.cos(up));

/** whether a captured movement is to hand */
export const hasCut = (c: Cut | undefined): c is Cut => !!c && !!TABLE[c.clip];

/**
 * Where a blow is at `u` of the way through the game's swing (0..1), the game counting it landed at `hitU`. The drawing
 * back is played from `from` to `hit` in the share of the swing before `hitU`, the rest after. It comes in from rest
 * over the first tenth and goes home over the last quarter, wherever the capture ended.
 * @param rest the arm and the upper arm as they rest in the picture (from the shoulder: see layOn)
 */
export function cutPose(c: Cut, u: number, hitU: number, rest: { arm: THREE.Vector3; upper: THREE.Vector3 }, out: FpPose): FpPose {
  const p = TABLE[c.clip];
  const t = u < hitU ? THREE.MathUtils.lerp(c.from, c.hit, u / hitU) : THREE.MathUtils.lerp(c.hit, c.to, (u - hitU) / (1 - hitU));
  const [kr, ku] = c.reach ?? [0.5, 0.5];
  out.w = THREE.MathUtils.smoothstep(u, 0, 0.1) * (1 - THREE.MathUtils.smoothstep(u, 0.75, 1));
  rowAt(p.rs, p.fps, t, _s);
  rowAt(p.rh, p.fps, t, _h).sub(_s);
  rowAt(p.re, p.fps, t, _e).sub(_s);
  rowAt(p.rs, p.fps, c.hit, _sh);
  rowAt(p.rh, p.fps, c.hit, _hh).sub(_sh);
  rowAt(p.re, p.fps, c.hit, _eh).sub(_sh);
  // The arm, round and up from where the captured arm was as the blow landed, a share as far, from where the fist is
  // put as it lands (the middle of the picture): so every blow lands where it is seen, however it was captured.
  const [ar, au] = c.at ?? [0.35, 0];
  wayOf(roundOf(rest.arm) - ar + wrap(roundOf(_h) - roundOf(_hh)) * kr, upOf(rest.arm) + au + (upOf(_h) - upOf(_hh)) * ku, out.arm);
  wayOf(roundOf(rest.upper) - ar + wrap(roundOf(_e) - roundOf(_eh)) * kr, upOf(rest.upper) + au + (upOf(_e) - upOf(_eh)) * ku, out.upper);
  out.stretch = _h.length() / Math.max(0.05, _hh.length());
  // (the hand's turn since the blow landed, a share of it)
  handAt(p.rf, p.fps, t, _qa);
  handAt(p.rf, p.fps, c.hit, _qh);
  out.turn.copy(_qa).multiply(_qh.invert()).slerp(_id, 1 - (c.turn ?? 0.7));
  const h = p.head[Math.round(THREE.MathUtils.clamp(t * p.fps, 0, p.head.length - 1))], h0 = p.head[Math.round(THREE.MathUtils.clamp(c.from * p.fps, 0, p.head.length - 1))];
  out.head.set(h[0] - h0[0], h[1] - h0[1], h[2] - h0[2]).multiplyScalar((c.lean ?? 0.25) * out.w);
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
/** A blow, from where the fist and the elbow rest in the picture and how the thing is held there. */
export function layOn(c: Cut, u: number, hitU: number, pos: THREE.Vector3, quat: THREE.Quaternion, elbow: THREE.Vector3, at: FpPose) {
  const L = _rest.arm.copy(pos).sub(FP_SHOULDER).length(), Lu = _rest.upper.copy(elbow).sub(FP_SHOULDER).length();
  cutPose(c, u, hitU, _rest, at);
  pos.lerp(_v.copy(at.arm).multiplyScalar(L * at.stretch).add(FP_SHOULDER), at.w);
  // (never into the eye: an arm swung round past the side or up over the head stays in front of it and under it, and
  // the elbow under the eye: raised past it, the sleeve filled the picture)
  pos.z = Math.min(pos.z, NEAREST);
  pos.y = Math.min(pos.y, 0.12);
  elbow.lerp(_v.copy(at.upper).multiplyScalar(Lu).add(FP_SHOULDER), at.w);
  elbow.y = Math.min(elbow.y, -0.08);
  if (c.lands) stanceQuat(c.lands, _l);
  else _l.copy(quat);
  quat.slerp(_r.copy(at.turn).multiply(_l), at.w);
}
