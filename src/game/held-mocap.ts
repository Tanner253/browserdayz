// First person on the motion capture (the owner, 2026-10-25: "hand animations where needed in first person"): what
// is held with no weapon pack of its own moves as the body everybody else sees moves, from the same movements. Their
// hands' paths are made by scripts/mocap.mjs (src/game/avatar/hands.json: each hand's place and turn from the head,
// frame by frame, in the eye's own measure: x to the right, y up, z back). The framing of each thing in the picture
// stays the game's own: the paths say when a hand goes, how fast, and which way round, and by how much it leaves where
// it is held.

import * as THREE from 'three';
import HANDS from './avatar/hands.json';

type Frame = [number, number, number, number, number, number, number];
type Track = { dur: number; r: Frame[]; l: Frame[]; mouth?: number[] };
const lib = HANDS as unknown as Record<string, Track>;

const _q = new THREE.Quaternion();
/** where along a track `u` (0..1 of it) falls: the frame before, and how far on to the next */
function at(n: number, u: number): [number, number, number] {
  const f = THREE.MathUtils.clamp(u, 0, 1) * (n - 1), i = Math.min(n - 2, Math.floor(f));
  return [i, i + 1, f - i];
}

/**
 * A hand of a movement at a share `u` of it, as a move from where it is at `from` (a share too): how far it has gone
 * (`pos`, metres in the eye's measure) and how it has turned (`quat`, in the eye's measure).
 */
export function handMove(name: string, side: 'r' | 'l', u: number, from: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
  const k = lib[name][side], [a, b, w] = at(k.length, u), [a0, b0, w0] = at(k.length, from);
  const p = (i: number, j: number, s: number, o: THREE.Vector3) => o.set(k[i][0] + (k[j][0] - k[i][0]) * s, k[i][1] + (k[j][1] - k[i][1]) * s, k[i][2] + (k[j][2] - k[i][2]) * s);
  const q = (i: number, j: number, s: number, o: THREE.Quaternion) => o.set(k[i][3], k[i][4], k[i][5], k[i][6]).slerp(_q.set(k[j][3], k[j][4], k[j][5], k[j][6]), s);
  p(a, b, w, pos).sub(p(a0, b0, w0, new THREE.Vector3()));
  q(a, b, w, quat).multiply(q(a0, b0, w0, new THREE.Quaternion()).invert());
}

/** how near the right hand is to the mouth at a share `u` of the drink, 0..1 */
export function mouthAt(u: number): number {
  const m = lib.drink.mouth!, [a, b, w] = at(m.length, u);
  return m[a] + (m[b] - m[a]) * w;
}

/** how long a movement takes as captured, seconds */
export const lengthOf = (name: string) => lib[name].dur;

/**
 * How far out a jab is at a share `u` of the game's punch (0 at the guard, 1 the arm out) and how far it is drawn back
 * first (0..1), from the right jab or the left. The game's punch lands 0.28 of the way through (see Weapons): the
 * jab's own moment of reaching out is put there, the drawing back before it and the coming home after as captured.
 */
export function jabAt(side: 1 | -1, u: number): { out: number; wind: number } {
  const t = lib[side > 0 ? 'jabR' : 'jabL'], k = side > 0 ? t.r : t.l, z0 = k[0][2];
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
