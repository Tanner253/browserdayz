// A captured blow in first person (2026-10-25, the owner: "Make sure Melle weapons are properly rigged and animated"). The
// body throws it in third person; seen from its own eyes most of it passes outside the picture (the old `strike` did), so
// it is not shown as it is but as the eyes FELT it: from where the thing is held at rest in the picture, the hand goes
// as the captured hand went from where it started, a share as far, and turns as it turned. The elbow likewise. So both
// views throw one blow, with the capture's weight: the wind-up, the snap through, the follow-through.
// The paths are written by scripts/melee-paths.mjs (paths.json): each hand and elbow from the eyes, frame by frame.

import * as THREE from 'three';
import PATHS from './paths.json';

type Path = { fps: number; dur: number; rh: number[][]; re: number[][]; lh: number[][]; le: number[][]; head: number[][] };
const TABLE = PATHS as unknown as Record<string, Path>;

/**
 * One blow cut out of a captured movement: which, from when it is drawn back (`from`), when the thing is through the
 * middle of the picture (`hit`) and when it has come home (`to`), seconds into the movement. `reach` is the share of
 * the captured hand's travel shown (the picture is narrow: the whole of it puts the thing out of it), `turn` the share
 * of its turning, and `lean` how much of the head's own turning the picture takes.
 */
export interface Cut {
  clip: string;
  from: number;
  hit: number;
  to: number;
  reach?: number;
  turn?: number;
  lean?: number;
  /** turned to the left as a whole (radians): a blow captured from overhead thrown across instead */
  across?: number;
}

export interface FpPose {
  /** how far the hand has gone from where it started, and how it has turned, in the eyes' space (x right, y up, z behind) */
  move: THREE.Vector3;
  turn: THREE.Quaternion;
  elbow: THREE.Vector3;
  /** the head's own turn off the body, as nose up, nose left, roll (radians) */
  head: THREE.Vector3;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _q0 = new THREE.Quaternion(), _p0 = new THREE.Vector3(), _e0 = new THREE.Vector3(), _e1 = new THREE.Vector3(), _across = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

/** a row of the path at a time in seconds, between its frames */
function rowAt(rows: number[][], fps: number, t: number, out: THREE.Vector3, q?: THREE.Quaternion) {
  const f = THREE.MathUtils.clamp(t * fps, 0, rows.length - 1), i = Math.min(rows.length - 2, Math.floor(f)), u = f - i;
  const a = rows[i], b = rows[i + 1];
  out.set(a[0], a[1], a[2]).lerp(_b.set(b[0], b[1], b[2]), u);
  if (q) q.set(a[3], a[4], a[5], a[6]).slerp(_qb.set(b[3], b[4], b[5], b[6]), u);
  return out;
}

/** whether a captured movement is to hand */
export const hasCut = (c: Cut | undefined): c is Cut => !!c && !!TABLE[c.clip];

/**
 * Where a blow is at `u` of the way through the game's swing (0..1), the game counting it landed at `hitU`. The drawing
 * back is played from `from` to `hit` in the share of the swing before `hitU`, the rest after; the last fifth is eased
 * home to rest, wherever the capture ended.
 */
export function cutPose(c: Cut, u: number, hitU: number, out: FpPose): FpPose {
  const p = TABLE[c.clip];
  const t = u < hitU ? THREE.MathUtils.lerp(c.from, c.hit, u / hitU) : THREE.MathUtils.lerp(c.hit, c.to, (u - hitU) / (1 - hitU));
  const home = 1 - THREE.MathUtils.smoothstep(u, 0.8, 1);
  const reach = (c.reach ?? 0.7) * home, turn = (c.turn ?? 1) * home;
  rowAt(p.rh, p.fps, c.from, _p0, _q0);
  rowAt(p.rh, p.fps, t, _a, _qa);
  _across.setFromAxisAngle(_up, c.across ?? 0);
  out.move.copy(_a).sub(_p0).applyQuaternion(_across).multiplyScalar(reach);
  // (turned in the eyes' space: as the hand turned from how it started)
  out.turn.copy(_qa).multiply(_q0.invert()).premultiply(_across).multiply(_qb.copy(_across).invert());
  out.turn.slerp(_qb.identity(), 1 - turn);
  rowAt(p.re, p.fps, c.from, _e0);
  out.elbow.copy(rowAt(p.re, p.fps, t, _e1)).sub(_e0).applyQuaternion(_across).multiplyScalar(reach);
  const h = p.head[Math.round(THREE.MathUtils.clamp(t * p.fps, 0, p.head.length - 1))], h0 = p.head[Math.round(THREE.MathUtils.clamp(c.from * p.fps, 0, p.head.length - 1))];
  out.head.set(h[0] - h0[0], h[1] - h0[1], h[2] - h0[2]).multiplyScalar((c.lean ?? 0.25) * home);
  return out;
}
