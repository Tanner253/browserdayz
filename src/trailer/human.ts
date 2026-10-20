// Movement with somebody behind it, for the films from the twenty-first on (2026-10-19, the owner: "people like the high
// quality trailers. i just hate how unnatrual you make"). What made the earlier ones read as made by a machine, found in
// their own shot code (marketing/plan-x-media.html): a lens slid from A to B on one curve that stopped dead inside the
// shot, people moved at speeds nobody has, a "handheld" made of sine waves, a first-person view turned to the next
// waypoint. So here:
//  - `Wander`: smooth seeded noise of several octaves, with no beat a viewer can feel (the stuff of a hand and a breath);
//  - `Operator`: a lens somebody carries. It follows its subject through a spring (it lags, catches up, and overshoots a
//    little as a person reframing does), a moment late, never faster than its kind (on foot, in a car, a drone), with
//    the shake of the body holding it: a step when it walks, a breath when it stands;
//  - `Hand`: the first-person view as a hand on a mouse turns it. A look is one quick movement that overshoots and is put
//    right, begun a moment after there is something to look at; a moving thing is followed a little behind; at rest
//    the view keeps a hand's tremor.
//  - `Speeds`: how fast each body and lens went, frame by frame, held against the game's own (src/game/player.ts).
import * as THREE from 'three';
import type { CamPose } from './director';

const TAU = Math.PI * 2;
export const wrap = (a: number) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};
/** the yaw that looks from a to b, as the game reckons yaw (forward is -z at 0) */
export const yawTo = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
export const pitchTo = (a: THREE.Vector3, b: THREE.Vector3) => Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
const smooth = (x: number) => x * x * (3 - 2 * x);

/** Smooth noise in [-1, 1] from a seed: three octaves of value noise at frequencies that never line up. */
export class Wander {
  constructor(private seed: number, private hz = 1) {}
  private h(i: number) {
    let x = Math.imul((i | 0) ^ Math.imul(this.seed, 0x9e3779b1), 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return ((x >>> 0) / 4294967295) * 2 - 1;
  }
  private v(t: number) {
    const i = Math.floor(t), f = smooth(t - i);
    return this.h(i) * (1 - f) + this.h(i + 1) * f;
  }
  at(t: number) {
    const x = t * this.hz;
    return (this.v(x) + 0.5 * this.v(x * 2.13 + 17.3) + 0.25 * this.v(x * 4.41 + 41.9)) / 1.75;
  }
}

export interface OperatorKind {
  /** the fastest the lens is carried, metres a second, and how hard it can speed up or slow */
  maxV: number;
  maxA: number;
  /** how quickly it closes on where it wants to be, and on where it wants to look (a spring's natural frequency, Hz) */
  posHz: number;
  lookHz: number;
  /** under 1 it overshoots a little before settling, as somebody reframing does */
  damp: number;
  /** seconds between something moving and the lens answering it */
  react: number;
  /** the shake of the body holding it: radians of wander at rest */
  shake: number;
  /** whether it is carried on foot (a step in it when it moves) */
  walks: boolean;
}
/** somebody on foot with the camera at the shoulder */
export const ON_FOOT: OperatorKind = { maxV: 6.4, maxA: 6, posHz: 0.55, lookHz: 1.1, damp: 0.82, react: 0.18, shake: 0.0035, walks: true };
/** braced against something, a long lens: hardly a tremor, slow to turn */
export const BRACED: OperatorKind = { maxV: 2, maxA: 3, posHz: 0.4, lookHz: 0.7, damp: 0.9, react: 0.25, shake: 0.0012, walks: false };
/** out of the window of a car driven alongside */
export const FROM_A_CAR: OperatorKind = { maxV: 30, maxA: 7, posHz: 0.45, lookHz: 1.0, damp: 0.85, react: 0.15, shake: 0.005, walks: false };
/** a drone: steady, but it has mass, a top speed, and it leans into a turn */
export const DRONE: OperatorKind = { maxV: 15, maxA: 4, posHz: 0.3, lookHz: 0.6, damp: 0.95, react: 0.3, shake: 0.0008, walks: false };

/** A lens somebody carries: give it where it wants to be and what it wants to look at each frame; it gets there as a person would. */
export class Operator {
  p = new THREE.Vector3();
  v = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  private yv = 0;
  private pv = 0;
  private stride = 0;
  private fresh = true;
  private lastT = NaN;
  private past: { t: number; p: THREE.Vector3; l: THREE.Vector3 }[] = [];
  private w: Wander[];
  fov: number;
  constructor(public kind: OperatorKind, seed: number, fov = 45) {
    this.w = [0, 1, 2, 3, 4].map((k) => new Wander(seed * 7 + k, k < 3 ? 0.55 : 0.3));
    this.fov = fov;
  }
  /** start it standing here, looking there (or moving with a velocity), with no history */
  reset(p: THREE.Vector3, look: THREE.Vector3, v?: THREE.Vector3) {
    this.p.copy(p);
    this.v.copy(v ?? new THREE.Vector3());
    this.yaw = yawTo(p, look);
    this.pitch = pitchTo(p, look);
    this.yv = this.pv = 0;
    this.past.length = 0;
    this.fresh = false;
    this.lastT = NaN;
  }
  /** what it wanted a moment ago: a person answers what they saw, not what is */
  private late(t: number) {
    const want = t - this.kind.react, past = this.past;
    while (past.length > 2 && past[1].t <= want) past.shift();
    if (past.length < 2 || want <= past[0].t) return past[0];
    const a = past[0], b = past[1], k = Math.min(1, (want - a.t) / Math.max(1e-6, b.t - a.t));
    return { t: want, p: a.p.clone().lerp(b.p, k), l: a.l.clone().lerp(b.l, k) };
  }
  /** the lens this frame (t in seconds, rising; the time since the last call is the step) */
  update(t: number, wantP: THREE.Vector3, wantLook: THREE.Vector3): CamPose {
    if (this.fresh) this.reset(wantP, wantLook);
    const dt = Number.isNaN(this.lastT) ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    this.past.push({ t, p: wantP.clone(), l: wantLook.clone() });
    const k = this.kind, aim = this.late(t);
    if (dt > 0) {
      // the body: a spring toward where it wants to be, never faster than it can be carried
      const w = TAU * k.posHz;
      const a = aim.p.clone().sub(this.p).multiplyScalar(w * w).addScaledVector(this.v, -2 * k.damp * w);
      if (a.length() > k.maxA) a.setLength(k.maxA);
      this.v.addScaledVector(a, dt);
      if (this.v.length() > k.maxV) this.v.setLength(k.maxV);
      this.p.addScaledVector(this.v, dt);
      // the aim: a spring on the angles to the thing, so a far thing and a near one are turned to alike
      const wl = TAU * k.lookHz;
      const ty = yawTo(this.p, aim.l), tp = pitchTo(this.p, aim.l);
      this.yv += (wrap(ty - this.yaw) * wl * wl - 2 * k.damp * wl * this.yv) * dt;
      this.pv += ((tp - this.pitch) * wl * wl - 2 * k.damp * wl * this.pv) * dt;
      this.yaw = wrap(this.yaw + this.yv * dt);
      this.pitch += this.pv * dt;
    }
    // the shake: wander, more of it the faster the body moves, and a step in it when it is carried on foot
    const sp = Math.hypot(this.v.x, this.v.z), more = 1 + sp * 0.35;
    let bob = 0, sway = 0;
    if (k.walks && sp > 0.25) {
      // a stride of about 1.4 m at a walk to 2.2 m at a run, two footfalls to it
      this.stride += (dt * sp) / (1.3 + Math.min(1, sp / 6) * 0.9);
      const s = this.stride * TAU;
      const fade = Math.min(1, sp / 1.2);
      bob = Math.abs(Math.sin(s)) * 0.022 * fade * Math.min(1.6, 0.6 + sp / 4);
      sway = Math.sin(s * 0.5) * 0.004 * fade;
    }
    const breath = Math.sin(t * TAU * 0.24 + this.w[4].at(t) * 0.6) * 0.0012;
    const yaw = this.yaw + this.w[0].at(t) * k.shake * more + sway;
    const pitch = this.pitch + this.w[1].at(t) * k.shake * 0.8 * more + breath - bob * 0.15;
    const roll = this.w[2].at(t) * k.shake * 0.9 * more;
    const p = this.p.clone();
    p.y += bob - 0.011;
    const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    return { p, l: p.clone().addScaledVector(dir, 10), fov: this.fov + this.w[3].at(t * 0.4) * 0.15, roll };
  }
  /** how fast the lens itself is going, metres a second */
  get speed() { return this.v.length(); }
}

/** A target the view can look at: a world point, or a fixed heading. */
export type Gaze = THREE.Vector3 | (() => THREE.Vector3) | { yaw: number; pitch: number };
interface Look { at: number; to: Gaze; dur: number; over: number; y0: number; p0: number; follow: boolean }

/**
 * The first-person view as a hand on a mouse turns it. `look(t, to)` asks for a look at a thing from `t` seconds on: it
 * is begun a reaction later, made as one quick movement whose length grows with how far it turns (Fitts), overshoots
 * by a few hundredths and is put right. `follow` keeps the view on a moving thing a little behind it, as an eye
 * tracking it does. In between, a tremor and a slow drift.
 */
export class Hand {
  yaw = 0;
  pitch = 0;
  private looks: Look[] = [];
  private cur: Look | null = null;
  private tremor: Wander[];
  private sy = 0;
  private sp = 0;
  constructor(seed: number, public eye: () => THREE.Vector3, public react = 0.2) {
    this.tremor = [new Wander(seed * 13 + 1, 7), new Wander(seed * 13 + 2, 6.3), new Wander(seed * 13 + 3, 0.35), new Wander(seed * 13 + 4, 0.31)];
  }
  set(yaw: number, pitch: number) {
    this.yaw = this.sy = yaw;
    this.pitch = this.sp = pitch;
    this.looks.length = 0;
    this.cur = null;
  }
  /** look at `to` from `t` on (plus a reaction); `follow` stays on it after */
  look(t: number, to: Gaze, follow = false, react = this.react) {
    this.looks.push({ at: t + react, to, dur: 0, over: 0, y0: 0, p0: 0, follow });
    this.looks.sort((a, b) => a.at - b.at);
  }
  private angles(g: Gaze): [number, number] {
    if ('yaw' in g) return [g.yaw, g.pitch];
    const p = typeof g === 'function' ? g() : g, e = this.eye();
    return [yawTo(e, p), pitchTo(e, p)];
  }
  /** the view's yaw and pitch at t (call once a frame, in order) */
  update(t: number, dt: number): { yaw: number; pitch: number } {
    while (this.looks.length && this.looks[0].at <= t) {
      const l = this.looks.shift()!;
      const [ty, tp] = this.angles(l.to);
      const d = Math.hypot(wrap(ty - this.sy), tp - this.sp);
      l.y0 = this.sy;
      l.p0 = this.sp;
      l.dur = 0.13 + 0.1 * Math.log2(1 + d / 0.03);
      l.over = d > 0.08 ? 0.04 + Math.min(0.05, d * 0.02) : 0;
      this.cur = l;
    }
    const l = this.cur;
    if (l) {
      const [ty, tp] = this.angles(l.to);
      const u = (t - l.at) / l.dur;
      if (u < 1) {
        // the main movement (minimum jerk), aimed a little past the thing
        const s = u * u * u * (10 - 15 * u + 6 * u * u), go = 1 + l.over;
        this.sy = l.y0 + wrap(ty - l.y0) * go * s;
        this.sp = l.p0 + (tp - l.p0) * go * s;
      } else {
        // then put right, and held there (or kept on it, a little behind, if it moves)
        const k = 1 - Math.exp(-dt * (u < 1.6 ? 9 : l.follow ? 7 : 12));
        this.sy += wrap(ty - this.sy) * k;
        this.sp += (tp - this.sp) * k;
        if (!l.follow && u > 3) this.cur = null;
      }
    }
    // a hand on a mouse is never quite still
    this.yaw = this.sy + this.tremor[0].at(t) * 0.0009 + this.tremor[2].at(t) * 0.004;
    this.pitch = this.sp + this.tremor[1].at(t) * 0.0007 + this.tremor[3].at(t) * 0.0025;
    return { yaw: this.yaw, pitch: this.pitch };
  }
  /** whether a look is still under way or being held */
  get busy() { return !!this.cur || this.looks.length > 0; }
}

/** The fastest each named thing went in a shot, metres a second, from where it was frame by frame. */
export class Speeds {
  private last = new Map<string, { p: THREE.Vector3; t: number }>();
  private top = new Map<string, number>();
  /** frames of the same speed are averaged over this long, so a frame's rounding is not a speed */
  constructor(private over = 0.25) {}
  private seen = new Map<string, { p: THREE.Vector3; t: number }[]>();
  note(name: string, t: number, p: THREE.Vector3) {
    const s = (this.seen.get(name) ?? this.seen.set(name, []).get(name)!);
    s.push({ p: p.clone(), t });
    while (s.length > 2 && t - s[0].t > this.over) s.shift();
    if (s.length >= 2 && t - s[0].t >= this.over * 0.8) {
      const v = s[s.length - 1].p.distanceTo(s[0].p) / (t - s[0].t);
      this.top.set(name, Math.max(this.top.get(name) ?? 0, v));
    }
    this.last.set(name, { p: p.clone(), t });
  }
  /** what each went at most, and clear for the next shot */
  report(): string {
    const out = [...this.top].map(([n, v]) => `${n} ${v.toFixed(1)} m/s`).join(', ');
    this.top.clear();
    this.seen.clear();
    this.last.clear();
    return out || 'nothing moved';
  }
}
