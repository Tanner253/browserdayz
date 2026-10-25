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

/**
 * The guard held with something to hit with (the right button): the library's two-handed parry stood at the moment the
 * weapon is up across the face, and its seconds into the movement. (Its one-handed parry raises the shield arm, not the
 * weapon's: a one-handed thing is put up across the face as well, the left hand behind it.)
 */
const PARRY = { one: { clip: 'Two_Handed_Parry', at: 0.6 }, two: { clip: 'Two_Handed_Parry', at: 0.6 } };

export class BodyBlow {
  /** the blow being thrown: its cut, seconds into it, and how long the game gives it */
  private now: { cut: Cut; t: number; dur: number; hitU: number; taken: Taken[]; pelvis: THREE.Interpolant | null } | null = null;
  private made = new Map<string, { taken: Taken[]; pelvis: THREE.Interpolant | null }>();
  /** what stands between the body's root and its hips, as it rests (it does not move) */
  private above: THREE.Quaternion | null = null;
  /** how far up the guard is, 0..1 */
  private guardT = 0;
  constructor(
    private root: THREE.Object3D,
    private laid: [THREE.Object3D, THREE.Object3D, number, number][],
  ) {}

  /** whether its file has this blow (it is fetched the first time any is asked for) */
  static has(clip: string) {
    if (!ready) void meleeClips();
    return !!ready?.has(clip);
  }

  /** a movement's tracks for the bones a blow turns (made once for each) */
  private tracksOf(name: string) {
    const clip = ready?.get(name);
    if (!clip) return null;
    let m = this.made.get(name);
    if (!m) {
      const tracks = new Map(clip.tracks.filter((t) => t.name.endsWith('.quaternion')).map((t) => [t.name.slice(0, -'.quaternion'.length), t]));
      const taken: Taken[] = [];
      let seam = true;
      for (const [, to, share, low] of this.laid) {
        const tr = tracks.get(to.name);
        if (low || !tr) continue;
        taken.push({ bone: to, share, read: reader(tr), seam });
        seam = false;
      }
      const hips = tracks.get('pelvis');
      this.made.set(name, (m = { taken, pelvis: hips ? reader(hips) : null }));
    }
    return m;
  }

  /** A blow begins: `dur` seconds of the game's, counted landed at `hitU` of them. */
  start(cut: Cut, dur: number, hitU = 0.35) {
    const m = this.tracksOf(cut.clip);
    if (!m) return false;
    this.now = { cut, t: 0, dur, hitU, ...m };
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
    this.lay(n.taken, n.pelvis, at, THREE.MathUtils.smoothstep(u, 0, 0.1) * (1 - THREE.MathUtils.smoothstep(u, 0.74, 1)));
  }

  /**
   * The guard, up or coming down, laid as a blow is (a blow thrown from it goes over it). The fists' guard is the
   * body's own (see update.ts): with something in the fist it is this.
   * @param two in both hands
   */
  guard(up: boolean, two: boolean, dt: number) {
    this.guardT += ((up ? 1 : 0) - this.guardT) * (1 - Math.exp(-(up ? 14 : 8) * dt));
    if (this.guardT < 0.01 || this.now) return;
    const p = PARRY[two ? 'two' : 'one'], m = this.tracksOf(p.clip);
    if (m) this.lay(m.taken, m.pelvis, p.at, this.guardT);
  }

  /** a movement at a moment laid over the body's upper half, `w` of the way */
  private lay(taken: Taken[], pelvis: THREE.Interpolant | null, at: number, w: number) {
    for (const k of taken) {
      const v = k.read.evaluate(at);
      _q.set(v[0], v[1], v[2], v[3]);
      if (k.seam && pelvis) {
        // The movement turns its hips as it pleases (a blow is thrown side-on); these hips are the steps'. So the
        // lowest bone it turns is set to face, from the body's root, the way it does in the movement.
        const p = pelvis.evaluate(at);
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

const _hd = new THREE.Vector3(), _fw = new THREE.Vector3(), _rt = new THREE.Vector3(), _to = new THREE.Vector3(), _fi = new THREE.Vector3(), _pa = new THREE.Vector3(), _tq = new THREE.Quaternion();
/**
 * Something to hit with, looked over, as others see it (the `check` act a gun is looked over by): the fist brought up in
 * front of the face, its knuckles across, and the wrist turned to show one face of the thing and then the other, and
 * let back down. `k` how far through, `live` how much of it is left if it was broken off. As the first person's
 * (fp.ts, lookOver).
 */
export function lookOverBody(a: Avatar, k: number, live: number) {
  const r = a.armR, held = a.inHand, s = THREE.MathUtils.smoothstep;
  const up = s(k, 0, 0.14) * (1 - s(k, 0.86, 1)) * live;
  if (!r || !held || up < 0.01 || !a.neck.length) return;
  const over = s(k, 0.14, 0.32) - 2 * s(k, 0.42, 0.66) + s(k, 0.74, 0.88);
  a.root.updateWorldMatrix(true, false);
  _aq.setFromAxisAngle(_up, a.yaw);
  _fw.set(0, 0, -1).applyQuaternion(_aq);
  _rt.set(1, 0, 0).applyQuaternion(_aq);
  a.neck[a.neck.length - 1].getWorldPosition(_hd);
  _to.copy(_hd).addScaledVector(_fw, 0.4).addScaledVector(_up, -0.2).addScaledVector(_rt, 0.06);
  // (the knuckles across to the left, the palm in toward the face: turned about the forearm, one way and the other)
  _tq.setFromAxisAngle(_fw, 1.1 * over);
  _fi.copy(_rt).negate().addScaledVector(_up, 0.3).applyQuaternion(_tq);
  _pa.copy(_fw).negate().applyQuaternion(_tq);
  a.reach(r, _to, _fi, _pa, held.curl, _aq, up);
  r.hand.updateWorldMatrix(true, false);
  a.curl(r, held.curl, r.hand.getWorldQuaternion(_tq));
}
