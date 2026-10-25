// The body's steps, on motion capture (the owner, 2026-10-25: "rehaul our body movement ... so that the game feels much
// more high quality"; "we want tarkov quality military animations realism"). The movements are Higgsfield's library
// carried onto our skeleton (scripts/mocap.mjs: public/assets/characters/moves.glb, their paces in moves.json). Every
// loop starts on the left heel, so the ways of a gait blend in step: the legs go the way the body goes while the body
// faces its aim. A gait drawn only ahead and back (the walks, the sprint, the limp) is turned at the hips to go to a
// side, the chest turned back to the aim (see Avatar's twist).
// How fast the legs turn over and how long each step is share out the difference between the body's pace and the one
// the movement was captured at (`warp`, laid on the legs after the mixer: see Avatar's stride): the feet stay put.

import * as THREE from 'three';
import { assets } from '../../core/assets';
import TABLE from './moves.json';

type Way = 'F' | 'B' | 'L' | 'R' | 'FL' | 'FR' | 'BL' | 'BR';
/** each way against the way the body faces, radians, to its right */
const AT: Record<Way, number> = { F: 0, FR: Math.PI / 4, R: Math.PI / 2, BR: (3 * Math.PI) / 4, B: Math.PI, BL: (-3 * Math.PI) / 4, L: -Math.PI / 2, FL: -Math.PI / 4 };
/** a step of a gait: what the legs play, and what the body above them does where that is another movement's */
type Step = [Way, string, string?];
/**
 * The gaits. The walks and the crouch step to a side as the old clips did, ahead with the hips turned toward it: the
 * library's standing side step is a crouched one, and stood up it was a bow-legged cross-step, and its crouched ones,
 * stretched to the game's pace, lunged (the owner, 2026-10-25, of the rifle's beside the old: "This one looks good, the
 * most recent images in chat dont look as good as this one"). The jog has no
 * side steps: it runs the nearest of its ways and is turned at the hips the rest (no more than to a corner), as
 * somebody runs across: two corners blended half each jogged on the spot.
 */
const GAITS = {
  walk: [['F', 'walkF'], ['B', 'walkB']],
  aim: [['F', 'aimF'], ['B', 'aimB']],
  jog: [['F', 'jogF'], ['FL', 'jogFL'], ['FR', 'jogFR'], ['BL', 'jogBL'], ['BR', 'jogBR']],
  crouch: [['F', 'crouchF'], ['B', 'crouchB']],
  sprint: [['F', 'sprint']],
  sprintGun: [['F', 'sprintGun']],
  limp: [['F', 'limpF'], ['B', 'limpB']],
} satisfies Record<string, Step[]>;
type GaitName = keyof typeof GAITS;
/** the gaits drawn only ahead (and back): they are turned at the hips to go to a side, by as much as this at most
 * (the walks and the crouch as far as the old clips' hips went, POSE.maxTwist; flat out and limping, as far as a waist goes) */
const TURNED = new Map<GaitName, number>([['walk', 1.35], ['aim', 1.35], ['crouch', 1.35], ['sprint', 1.1], ['sprintGun', 1.1], ['limp', 1.1]]);
/** the gaits run the nearest way and turned the rest */
const NEAREST = new Set<GaitName>(['jog']);

/** where the legs leave off and the body above them begins, by bone */
const LEGS = /^(pelvis|thigh|calf|foot|ball)_?/;
const parts = new Map<string, THREE.AnimationClip>();
/** a movement's legs alone, or what is above them alone (made once, and shared by every body) */
function part(clip: THREE.AnimationClip, legs: boolean) {
  const name = `${clip.name}.${legs ? 'legs' : 'upper'}`;
  let p = parts.get(name);
  if (!p) parts.set(name, (p = new THREE.AnimationClip(name, clip.duration, clip.tracks.filter((t) => LEGS.test(t.name) === legs))));
  return p;
}

/** the movements' file: fetched once, the first body's making waits for it (see make.ts) */
export const MOVE_FILE = 'assets/characters/moves.glb';
let lib: Promise<THREE.AnimationClip[]> | null = null;
export const moveClips = () => (lib ??= assets.loadGLTF(MOVE_FILE).then((g) => g.animations));
type Paces = Record<string, { way?: string; gait?: string; pace?: number; dur: number }>;
const PACE = TABLE as Paces;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Gait {
  /** where in the stride the legs are, 0..1: 0 the left heel coming down, about a half the right */
  phase = Math.random();
  /** a foot came down during the last update */
  footfall = false;
  /** how much longer the steps are than captured (1: as captured), and how much of the body is stepping */
  warp = 1;
  share = 0;
  /** the legs turned from the chest, for a gait drawn only ahead, radians (to the body's left, as Avatar's twist) */
  twist = 0;
  /** the way gone against the way faced, to the right, radians (eased) */
  private way = 0;
  private acts = new Map<string, THREE.AnimationAction>();
  private w = new Map<string, number>();
  /** each gait's turn of the hips, and how much of the body it had, this update */
  private turns = 0;
  private turnW = 0;
  /** a gait run its nearest way: which way that is now, and how much of each way is still in it (eased across a change) */
  private near = new Map<GaitName, { at: Way; k: Map<Way, number> }>();
  /** a gait turned to a side: whether it is stepping back, and how much of it is (eased across a change) */
  private back = new Map<GaitName, { on: boolean; k: number }>();
  constructor(mixer: THREE.AnimationMixer, clips: THREE.AnimationClip[]) {
    const byName = new Map(clips.map((c) => [c.name, c]));
    for (const steps of Object.values(GAITS) as Step[][]) {
      for (const [, legs, upper] of steps) {
        for (const n of upper ? [legs, upper] : [legs]) {
          if (this.acts.has(n)) continue;
          const [base, half] = n.split('.');
          const clip = byName.get(base);
          if (!clip) throw new Error(`moves.glb has no "${base}"`);
          const a = mixer.clipAction(half ? part(clip, half === 'legs') : clip);
          // (scrubbed by hand, as every clip of the body is)
          a.timeScale = 0;
          a.setEffectiveWeight(0);
          a.play();
          this.acts.set(n, a);
        }
      }
    }
  }

  /** how much of each way of a gait, for going `at` radians to the right of the way faced */
  private ways(gait: GaitName, at: number, share: number, dt: number) {
    const steps = GAITS[gait] as Step[];
    if (NEAREST.has(gait)) {
      // the nearest way, held until another is nearer by a good margin (it does not flicker across the side), the
      // ways it leaves eased out over a fifth of a second
      let n = this.near.get(gait);
      if (!n) this.near.set(gait, (n = { at: 'F', k: new Map() }));
      let best = n.at;
      for (const s of steps) if (Math.abs(wrap(AT[s[0]] - at)) < Math.abs(wrap(AT[best] - at)) - 0.26) best = s[0];
      n.at = best;
      let sum = 0;
      for (const s of steps) {
        const k = (n.k.get(s[0]) ?? 0) + ((s[0] === best ? 1 : 0) - (n.k.get(s[0]) ?? 0)) * (1 - Math.exp(-12 * dt));
        n.k.set(s[0], k);
        sum += k;
      }
      if (share < 1e-4) return;
      for (const s of steps) {
        const k = (n.k.get(s[0]) ?? 0) / Math.max(1e-4, sum);
        if (k < 1e-3) continue;
        this.add(s, share * k);
        this.turns += share * k * -wrap(at - AT[s[0]]);
      }
      this.turnW += share;
      return;
    }
    const most = TURNED.get(gait);
    if (most !== undefined) {
      // ahead or back, the hips turned the rest of the way: back once a little behind the side, ahead again a little
      // before it (as the old clips did: half of each at the side is stepped on the spot), eased over a sixth of a second
      const back = steps.find((s) => s[0] === 'B');
      let b = this.back.get(gait);
      if (!b) this.back.set(gait, (b = { on: false, k: 0 }));
      if (back && (b.on ? Math.abs(at) < 1.4 : Math.abs(at) > 1.75)) b.on = !b.on;
      b.k += ((b.on ? 1 : 0) - b.k) * (1 - Math.exp(-12 * dt));
      if (share < 1e-4) return;
      this.add(steps[0], share * (1 - b.k));
      if (back) this.add(back, share * b.k);
      this.turns += share * THREE.MathUtils.clamp(-(b.on ? wrap(at - Math.PI) : at), -most, most);
      this.turnW += share;
      return;
    }
    if (share < 1e-4) return;
    this.turnW += share;
    // the two ways either side of it, each by how near
    let lo: Step = steps[0], hi: Step = steps[0], dlo = -Infinity, dhi = Infinity;
    for (const s of steps) {
      const d = wrap(AT[s[0]] - at);
      if (d <= 0 && d > dlo) { dlo = d; lo = s; }
      if (d >= 0 && d < dhi) { dhi = d; hi = s; }
    }
    if (lo === hi || dhi - dlo < 1e-4) return this.add(lo, share);
    const k = -dlo / (dhi - dlo);
    this.add(lo, share * (1 - k));
    this.add(hi, share * k);
  }

  private add(s: Step, k: number) {
    if (k < 1e-4) return;
    this.w.set(s[1], (this.w.get(s[1]) ?? 0) + k);
    if (s[2]) this.w.set(s[2], (this.w.get(s[2]) ?? 0) + k);
  }

  /**
   * @param speed over the ground, m/s
   * @param rel the way gone against the way faced, radians to the LEFT (as Avatar's velYaw - yaw)
   * @param stand how much of the body is standing and on the move; `crouch` crouched and on the move (the old clips'
   *   walk + run, and crouched walk, with everything that takes from them taken)
   * @param gun how far a gun is up in the hands, 0..1; `limp` how much of a broken leg
   */
  step(dt: number, speed: number, rel: number, stand: number, crouch: number, gun: number, limp: number) {
    this.w.clear();
    this.turns = this.turnW = 0;
    const ease = 1 - Math.exp(-8 * dt);
    if (speed > 0.3) this.way += wrap(-rel - this.way) * ease;
    const at = this.way;
    // standing: a walk (empty handed or behind a gun, or a limp), a jog, flat out
    const jog = THREE.MathUtils.smoothstep(speed, 2.2, 3.0) * (1 - limp), flat = THREE.MathUtils.smoothstep(speed, 5.0, 5.8);
    const walk = stand * (1 - jog);
    this.ways('limp', at, walk * limp, dt);
    this.ways('walk', at, walk * (1 - limp) * (1 - gun), dt);
    this.ways('aim', at, walk * (1 - limp) * gun, dt);
    this.ways('jog', at, stand * jog * (1 - flat), dt);
    this.ways('sprint', at, stand * jog * flat * (1 - gun), dt);
    this.ways('sprintGun', at, stand * jog * flat * gun, dt);
    this.ways('crouch', at, crouch, dt);
    // the hips turned, by each gait that turns them, for as much of the body as it has
    this.twist = this.turnW > 1e-3 ? this.turns / this.turnW : 0;
    // the pace and the length of a stride, as captured, over all of it (by the legs)
    let w = 0, pace = 0, len = 0;
    for (const [n, k] of this.w) {
      if (n.endsWith('.upper')) continue;
      const p = PACE[n.split('.')[0]];
      w += k;
      pace += k * (p.pace ?? 1);
      len += k * (p.pace ?? 1) * p.dur;
    }
    this.share = w;
    const was = this.phase;
    if (w > 1e-3) {
      pace /= w;
      len /= w;
      // the difference shared out between the steps' length and their number (to the root of it each, within what a
      // stride stretches to), so that a body twice the captured pace takes steps half as long again and as many more
      this.warp = THREE.MathUtils.clamp(Math.sqrt(Math.max(0.05, speed) / pace), 0.8, 1.42);
      this.phase = (this.phase + (dt * speed) / (len * this.warp)) % 1;
    } else this.warp = 1;
    // (the left heel at 0, the right about a half: a foot is down each time a half is passed)
    this.footfall = w > 0.35 && speed > 0.5 && Math.floor(this.phase * 2) !== Math.floor(was * 2);
    for (const [n, a] of this.acts) {
      a.setEffectiveWeight(this.w.get(n) ?? 0);
      a.time = this.phase * a.getClip().duration;
    }
  }

  /** its weights off for a moment, a clip being laid over the body alone (see Avatar.layer): the next step sets them again */
  mute() {
    for (const a of this.acts.values()) a.setEffectiveWeight(0);
  }

  /** none of it: the body lies, sits, is dead, or someone else's movement is played on it */
  rest() {
    this.share = 0;
    this.twist = 0;
    this.footfall = false;
    for (const a of this.acts.values()) a.setEffectiveWeight(0);
  }
}

/** a leg, hip to ankle */
export interface Leg { thigh: THREE.Object3D; calf: THREE.Object3D; foot: THREE.Object3D }
const _h = new THREE.Vector3(), _k = new THREE.Vector3(), _f = new THREE.Vector3(), _t = new THREE.Vector3();
const _d = new THREE.Vector3(), _s = new THREE.Vector3(), _n = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _fq = new THREE.Quaternion();
/** a bone turned (in the world) so that what lies `from` it lies `to` */
function swing(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  _q.setFromUnitVectors(_a.copy(from).normalize(), _b.copy(to).normalize());
  bone.getWorldQuaternion(_q2).premultiply(_q);
  bone.quaternion.copy(bone.parent!.getWorldQuaternion(_fq.clone()).invert().multiply(_q2));
  bone.updateWorldMatrix(false, true);
}

/**
 * Each step made `s` times as long along the way gone (`way`, a level unit in the world): each foot put out from under
 * its own hip along it by that much, and its leg worked out again to reach it, the knee bent to the side it was bent
 * to, the foot turned as it was. The movements were captured at a pace of their own: stepped faster and no longer, a
 * body going twice as fast as its movement took steps twice as quick and as short as they were, its feet sliding.
 * (From its own hip, not the middle of the hips: stepping sideways, the width of the hips is not a step, and stretched
 * it bowed the legs and crossed them the more.)
 */
export function stretch(legs: Leg[], way: THREE.Vector3, s: number) {
  for (const L of legs) {
    L.thigh.getWorldPosition(_h);
    L.calf.getWorldPosition(_k);
    L.foot.getWorldPosition(_f);
    L.foot.getWorldQuaternion(_fq);
    const turn = _fq.clone(), la = _k.distanceTo(_h), lb = _f.distanceTo(_k);
    _t.copy(_f).addScaledVector(way, _n.copy(_f).sub(_h).dot(way) * (s - 1));
    const d = Math.max(0.05, Math.min(_t.distanceTo(_h), (la + lb) * 0.999));
    _d.copy(_t).sub(_h).normalize();
    _s.copy(_k).sub(_h);
    _s.addScaledVector(_d, -_s.dot(_d));
    if (_s.lengthSq() < 1e-8) continue;
    _s.normalize();
    const x = (la * la - lb * lb + d * d) / (2 * d), h = Math.sqrt(Math.max(0, la * la - x * x));
    const knee = _n.copy(_h).addScaledVector(_d, x).addScaledVector(_s, h);
    swing(L.thigh, _a.copy(_k).sub(_h), _b.copy(knee).sub(_h));
    L.calf.getWorldPosition(_k);
    L.foot.getWorldPosition(_f);
    swing(L.calf, _a.copy(_f).sub(_k), _b.copy(_t).sub(_k));
    L.foot.quaternion.copy(L.foot.parent!.getWorldQuaternion(_q2).invert().multiply(turn));
    L.foot.updateWorldMatrix(false, true);
  }
}
