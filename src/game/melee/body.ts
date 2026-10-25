// A captured blow on a body, seen from outside (2026-10-25, the owner: "Make sure Melle weapons are properly rigged and
// animated"). Higgsfield's library carried onto our skeleton (scripts/mocap.mjs) is laid over the body's upper half as
// the body's own `layer` lays a clip: the chest, the arms and the head take it, as far as LAID shares them, and the legs
// go on with whatever the steps were doing. The movement is not on the body's mixer: its own tracks are read at the
// moment wanted, so a blow costs nothing while none is being thrown.
// The same blow is thrown in first person (fp.ts), cut the same way (cuts.ts).

import * as THREE from 'three';
import { assets } from '../../core/assets';
import type { Cut } from './fp';
import type { Avatar } from '../avatar';

/** the captured blows, as one file of movements on our skeleton */
export const MELEE_FILE = 'assets/characters/melee.glb';
let lib: Promise<Map<string, THREE.AnimationClip>> | null = null;
let ready: Map<string, THREE.AnimationClip> | null = null;
/** fetched the first time something to hit with is taken up, not with the body */
export const meleeClips = () =>
  (lib ??= assets
    .loadGLTF(MELEE_FILE)
    .then((g) => (ready = new Map(g.animations.map((c) => [c.name, c]))))
    .catch(() => (ready = new Map())));

/** one bone the blow turns: the body's own, how much of the blow it takes, and its track in the movement */
interface Taken {
  bone: THREE.Object3D;
  share: number;
  read: THREE.Interpolant;
  /** the lowest the blow turns: it is set to face, from the body's root, the way the movement has it face */
  seam: boolean;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
/** a turn's track read at any moment, turned smoothly between its frames */
const reader = (t: THREE.KeyframeTrack) => new THREE.QuaternionLinearInterpolant(t.times, t.values, 4, new Float32Array(4));

export class BodyBlow {
  /** the blow being thrown: its cut, seconds into it, and how long the game gives it */
  private now: { cut: Cut; t: number; dur: number; hitU: number; taken: Taken[]; pelvis: THREE.Interpolant | null } | null = null;
  private made = new Map<string, Taken[]>();
  /** what stands between the body's root and its hips, as it rests (it does not move) */
  private above: THREE.Quaternion | null = null;
  constructor(
    private root: THREE.Object3D,
    private laid: [THREE.Object3D, THREE.Object3D, number, number][],
  ) {}

  /** whether its file has this blow (it is fetched the first time any is asked for) */
  static has(clip: string) {
    if (!ready) void meleeClips();
    return !!ready?.has(clip);
  }

  /** A blow begins: `dur` seconds of the game's, counted landed at `hitU` of them. */
  start(cut: Cut, dur: number, hitU = 0.35) {
    const clip = ready?.get(cut.clip);
    if (!clip) return false;
    let taken = this.made.get(cut.clip);
    if (!taken) {
      const tracks = new Map(clip.tracks.filter((t) => t.name.endsWith('.quaternion')).map((t) => [t.name.slice(0, -'.quaternion'.length), t]));
      taken = [];
      let seam = true;
      for (const [, to, share, low] of this.laid) {
        const tr = tracks.get(to.name);
        if (low || !tr) continue;
        taken.push({ bone: to, share, read: reader(tr), seam });
        seam = false;
      }
      this.made.set(cut.clip, taken);
    }
    const hips = clip.tracks.find((t) => t.name === 'pelvis.quaternion');
    this.now = { cut, t: 0, dur, hitU, taken, pelvis: hips ? reader(hips) : null };
    return true;
  }

  stop() {
    this.now = null;
  }

  get busy() {
    return !!this.now;
  }

  /** On in its time, and laid over the body as the mixer has just left it. */
  update(dt: number) {
    const n = this.now;
    if (!n) return;
    n.t += dt;
    const u = n.t / n.dur;
    if (u >= 1) {
      this.now = null;
      return;
    }
    const c = n.cut;
    const at = u < n.hitU ? THREE.MathUtils.lerp(c.from, c.hit, u / n.hitU) : THREE.MathUtils.lerp(c.hit, c.to, (u - n.hitU) / (1 - n.hitU));
    // (in over a tenth of the blow, out over its last quarter: as the library's own blow is laid)
    const w = THREE.MathUtils.smoothstep(u, 0, 0.1) * (1 - THREE.MathUtils.smoothstep(u, 0.74, 1));
    for (const k of n.taken) {
      const v = k.read.evaluate(at);
      _q.set(v[0], v[1], v[2], v[3]);
      if (k.seam && n.pelvis) {
        // The movement turns its hips as it pleases (a blow is thrown side-on); these hips are the steps'. So the
        // lowest bone it turns is set to face, from the body's root, the way it does in the movement.
        const p = n.pelvis.evaluate(at);
        const parent = k.bone.parent!;
        this.above ??= this.root.getWorldQuaternion(_q3).invert().multiply(parent.parent!.getWorldQuaternion(_q2)).clone();
        const want = _q2.copy(this.above).multiply(_q3.set(p[0], p[1], p[2], p[3])).multiply(_q);
        const have = this.root.getWorldQuaternion(_q3).invert().multiply(parent.getWorldQuaternion(new THREE.Quaternion()));
        _q.copy(have.invert().multiply(want));
      }
      k.bone.quaternion.slerp(_q, w * k.share);
    }
  }
}

const _t = new THREE.Vector3(), _F = new THREE.Vector3(), _N = new THREE.Vector3(), _aq = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
/**
 * The left hand on something held in both: reached to where the thing's own grip says it closes (its pos, fingers and
 * palm, in the thing's space, as the right is laid in the fist), and closed round it. Whatever the right arm is doing,
 * a blow or a guard, the left goes with the thing. `w`: how much (none while it lies on the shoulder).
 */
export function holdLeft(a: Avatar, w: number) {
  const r = a.armL, held = a.inHand, g = held?.left, thing = held?.obj.children[0];
  if (!r || !g || !thing || w < 0.02) return;
  thing.updateWorldMatrix(true, false);
  _t.copy(g.pos).applyMatrix4(thing.matrixWorld);
  _F.copy(g.fingers).transformDirection(thing.matrixWorld);
  _N.copy(g.palm).transformDirection(thing.matrixWorld);
  a.reach(r, _t, _F, _N, g.curl, _aq.setFromAxisAngle(_up, a.yaw), w);
  a.curl(r, g.curl, r.hand.getWorldQuaternion(_aq));
}
