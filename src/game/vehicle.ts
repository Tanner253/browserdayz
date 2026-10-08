// The jeep as it is in one game: a body on four sprung wheels, driven here or shown as
// somebody else drives it.
//
// It is built the way Halo's Warthog is described in public (a rigid body carried on a few
// sprung points, each with its own grip along and across, pushed by the ones that touch the
// ground): long soft springs that let it lean and bounce, a low heavy middle so it comes
// down on its wheels, a rear that lets go before the front does, and a hand on it in the
// air. The springs and the tyres are Rapier's ray-cast vehicle; everything that decides how
// it feels (the engine, the brakes, the steering, the grip of each kind of ground, the air)
// is here, in DRIVE, and can be tuned while the game runs (the dev harness shows it as T.drive).
//
// One game works out how each jeep moves: the driver's, or the last driver's until it has
// rolled to a stop. Everywhere else it is a body moved to where that game says it is, a
// little in the past, like the other players.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { physics, groups, G_PLAYER, G_WORLD, SOLID_GROUPS, type Surface } from '../core/physics';
import { JEEP, RIDE_HEIGHT, type VState } from '../sim/vehicles';

export type Ground = 'asphalt' | 'gravel' | 'grass' | 'dirt' | 'rock';

export const DRIVE = {
  mass: 1650,
  /** the tub: half its width, height and length, and how round its edges are */
  hull: [0.86, 0.36, 1.98, 0.16] as [number, number, number, number],
  /** the roof: half its width, thickness and length, and where its middle is (up, back) */
  roof: [0.74, 0.04, 1.12, 1.15, 0.72] as [number, number, number, number, number],
  /** the weight sits this far below the middle of the tub (it is what brings it down on its wheels) */
  low: 0.34,
  /** how hard it is to turn over, to pitch and to spin, against a plain box of its size */
  inertia: [1.25, 1.0, 1.9] as [number, number, number],
  /** wheels: half the track, half the wheelbase, radius */
  track: 0.72,
  base: 1.19,
  radius: 0.39,
  /** springs: length unloaded, how far they move either way, stiffness, damping going in and coming out */
  rest: 0.36,
  travel: 0.26,
  stiff: 21,
  comp: 1.5,
  relax: 2.7,
  maxForce: 90000,
  /** the engine: push at a standstill (newtons), and the fastest it will go on each kind of ground (m/s) */
  force: 9800,
  top: { asphalt: 22, gravel: 19.5, grass: 17.5, dirt: 16, rock: 14 } as Record<Ground, number>,
  /** backwards: the fastest, and how much of the engine */
  reverse: [7.5, 0.6] as [number, number],
  /** what the ground itself takes off, m/s² */
  roll: { asphalt: 0.18, gravel: 0.4, grass: 0.55, dirt: 0.65, rock: 0.6 } as Record<Ground, number>,
  /** how hard the tyres hold on each */
  grip: { asphalt: 1.22, gravel: 1.05, grass: 1.0, dirt: 0.95, rock: 1.05 } as Record<Ground, number>,
  /** the rear holds this much of what the front does: it is the rear that steps out */
  rear: 0.9,
  /**
   * How much it leans in a turn, against what its height and weight would really make it
   * (Rapier's own wheels push the body sideways almost through its middle, and a jeep that
   * corners flat as a tray looks like a toy), and the hardest cornering, m/s², that goes on
   * leaning it further. Without that second number it can be rolled on a level road with the
   * steering alone, which is a jeep nobody wants to drive: it goes over on a bank or a rock,
   * not on a bend.
   */
  lean: [1.25, 6.5] as [number, number],
  /** brakes: m/s² they can take off, how much of it at the front, and what the engine alone takes off */
  brake: 9.5,
  bias: 0.62,
  coast: 0.85,
  /** nobody at the wheel: it is left in gear */
  parked: 3.2,
  /** the handbrake: the rear wheels lock and hold this much less */
  hand: 0.42,
  /** steering: lock at a crawl and at speed (radians), the speed at which it is down to the second, how fast the wheel is turned and let go (rad/s) */
  steer: [0.6, 0.15] as [number, number],
  steerAt: 21,
  steerRate: [2.3, 4.2] as [number, number],
  /** in the air: how hard it can be turned (rad/s²: nose round, nose up and down), and how hard it is pulled level */
  air: [1.3, 1.1, 3.4] as [number, number, number],
  /** what still turns it (1/s), on the ground and off it */
  spin: [0.35, 0.9] as [number, number],
  /** a knock of more than this many m/s in one step is a crash */
  crash: 3.2,
};

export interface Controls {
  /** -1 (back) .. 1 */
  throttle: number;
  /** -1 (left) .. 1 */
  steer: number;
  hand: boolean;
}

/** render jeeps driven elsewhere this far in the past: long enough that the report after the one being drawn has nearly always come */
const INTERP_DELAY = 140;
const CHASSIS_GROUPS = groups(G_WORLD, G_WORLD | G_PLAYER);

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

interface Snap {
  t: number;
  s: VState;
}

export class Jeep {
  body!: RAPIER.RigidBody;
  colliders: RAPIER.Collider[] = [];
  private ctrl!: RAPIER.DynamicRayCastVehicleController;
  /** what is drawn: the body, and the four wheels (front left, front right, rear left, rear right) */
  readonly root = new THREE.Group();
  readonly wheels: THREE.Object3D[] = [];
  /** where it is drawn this frame (between two steps of the simulation, or two reports from elsewhere) */
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly vel = new THREE.Vector3();
  /** along its own nose, m/s (backwards is negative) */
  speed = 0;
  /** how far the front wheels are turned (radians, left is positive) and how hard it is being driven (-1..1) */
  steer = 0;
  throttle = 0;
  /** wheels on the ground */
  grounded = 0;
  /** what most of its wheels are on */
  ground: Ground = 'grass';
  /** how sideways it is going, 0..1: what the tyres sound and look like */
  slide = 0;
  hp = JEEP.hp;
  fuel = JEEP.tank;
  seats: (number | null)[] = [null, null, null, null];
  /** whose game moves it: this one ('sim'), another ('follow'), or nobody's (it stands where it is) */
  mode: 'sim' | 'follow' | 'parked' = 'parked';
  /** burned out */
  wreck = false;
  /** whose game moves it, as the server has it (a player's number; null: nobody's) */
  sim: number | null = null;
  /** it hit something: how hard (m/s lost in one step) */
  onCrash: (hard: number) => void = () => {};
  private prevPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private post = new THREE.Vector3();
  private hasPost = false;
  private snaps: Snap[] = [];
  /**
   * How far the clock of the game that is moving it is behind this one's, by the quickest
   * report yet (null: none heard), and the same as it is used: eased toward that, so that a
   * better reckoning moves the jeep's whole past a little over a second and not all at once.
   */
  private clock: number | null = null;
  private clockUsed = 0;
  private spinAngle = [0, 0, 0, 0];
  private susp = [0, 0, 0, 0];
  private hard: THREE.Vector3[] = [];
  /** seconds it has been all but still (see atRest) */
  private still = 0;

  constructor(public i: number, private groundAt: (x: number, z: number) => Ground) {}

  /** @param visual the model: its body, and four wheels each turning about its own middle (in the order of `wheels`) */
  build(scene: THREE.Scene, s: VState, visual: { body: THREE.Object3D; wheels: THREE.Object3D[] }) {
    const R = physics.R, D = DRIVE;
    const [hx, hy, hz, round] = D.hull;
    const w = hx * 2, h = hy * 2, l = hz * 2;
    const m = D.mass / 12;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(s[0], s[1], s[2])
        .setRotation({ x: s[3], y: s[4], z: s[5], w: s[6] })
        .setAdditionalMassProperties(
          D.mass,
          { x: 0, y: -D.low, z: 0 },
          { x: m * (h * h + l * l) * D.inertia[1], y: m * (w * w + l * l) * D.inertia[2], z: m * (w * w + h * h) * D.inertia[0] },
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setCanSleep(true),
    );
    const add = (desc: RAPIER.ColliderDesc) => {
      const c = physics.world.createCollider(desc.setDensity(0).setCollisionGroups(CHASSIS_GROUPS).setSolverGroups(CHASSIS_GROUPS).setFriction(0.35).setRestitution(0.05), this.body);
      physics.tag(c, { surface: 'metal', owner: this });
      this.colliders.push(c);
    };
    add(R.ColliderDesc.roundCuboid(hx - round, hy - round, hz - round, round));
    // the roof: what it lies on when it is on its back, and what keeps the rain off. Between
    // it and the tub there is nothing: whoever sits in it can be seen, and shot.
    add(R.ColliderDesc.cuboid(D.roof[0], D.roof[1], D.roof[2]).setTranslation(0, D.roof[3], D.roof[4]));

    this.ctrl = physics.world.createVehicleController(this.body);
    this.ctrl.indexUpAxis = 1;
    this.ctrl.setIndexForwardAxis = 2;
    // the top of each spring: the wheel hangs a spring's length under it, less what the weight takes up
    const top = D.radius - RIDE_HEIGHT + D.rest - 9.81 / (4 * D.stiff);
    for (let i = 0; i < 4; i++) {
      const at = new THREE.Vector3(i % 2 ? D.track : -D.track, top, i < 2 ? -D.base : D.base);
      this.hard.push(at);
      // (an axle pointing to its right: with the ground's own up, that makes forward -z)
      this.ctrl.addWheel(at, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, D.rest, D.radius);
      this.susp[i] = D.rest - 9.81 / (4 * D.stiff);
    }
    this.tune();

    this.root.add(visual.body);
    for (const wheel of visual.wheels) {
      this.wheels.push(wheel);
      this.root.add(wheel);
    }
    scene.add(this.root);
    this.pos.set(s[0], s[1], s[2]);
    this.quat.set(s[3], s[4], s[5], s[6]);
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.draw(0);
  }

  /** the springs, as DRIVE has them now */
  tune() {
    const D = DRIVE;
    for (let i = 0; i < 4; i++) {
      this.ctrl.setWheelSuspensionRestLength(i, D.rest);
      this.ctrl.setWheelMaxSuspensionTravel(i, D.travel);
      this.ctrl.setWheelSuspensionStiffness(i, D.stiff);
      this.ctrl.setWheelSuspensionCompression(i, D.comp);
      this.ctrl.setWheelSuspensionRelaxation(i, D.relax);
      this.ctrl.setWheelMaxSuspensionForce(i, D.maxForce);
      this.ctrl.setWheelRadius(i, D.radius);
    }
  }

  setMode(mode: Jeep['mode']) {
    if (mode === this.mode) return;
    const R = physics.R;
    this.mode = mode;
    this.hasPost = false;
    this.still = 0;
    if (mode === 'sim') {
      this.body.setBodyType(R.RigidBodyType.Dynamic, true);
      this.body.setLinvel(this.vel, true);
    } else {
      this.body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
      this.snaps.length = 0;
      this.clock = null;
      if (mode === 'parked') this.vel.set(0, 0, 0);
    }
  }

  /** where it is and how it is moving, as it is told to everybody else */
  state(): VState {
    const t = this.body.translation(), r = this.body.rotation(), v = this.mode === 'sim' ? this.body.linvel() : this.vel;
    const n = (x: number, k = 1000) => Math.round(x * k) / k;
    return [n(t.x), n(t.y), n(t.z), n(r.x, 1e4), n(r.y, 1e4), n(r.z, 1e4), n(r.w, 1e4), n(v.x, 100), n(v.y, 100), n(v.z, 100), n(this.steer, 100), n(this.throttle, 100)];
  }

  /** put it somewhere, at once (it was stood up again, or this is the first that is known of it) */
  place(s: VState) {
    this.body.setTranslation({ x: s[0], y: s[1], z: s[2] }, true);
    this.body.setRotation({ x: s[3], y: s[4], z: s[5], w: s[6] }, true);
    this.vel.set(s[7], s[8], s[9]);
    if (this.mode === 'sim') {
      this.body.setLinvel(this.vel, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.steer = s[10];
    this.throttle = s[11];
    this.pos.set(s[0], s[1], s[2]);
    this.quat.set(s[3], s[4], s[5], s[6]);
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.snaps.length = 0;
    this.clock = null;
    this.hasPost = false;
  }

  /**
   * A report of it from the game that is moving it.
   * @param at when it was true, by that game's clock
   * @param now when it got here, by this one's
   */
  push(s: VState, at: number, now: number) {
    if (this.mode === 'sim') return;
    // Each report is placed by when it happened, not by when it arrived: the quickest one yet
    // says how the two clocks stand, and the rest are late by however long they were held up.
    // (The reckoning is let drift up a little with every report, so a quick one long ago does
    // not hold it for ever against two clocks that run at slightly different rates.)
    const est = now - at;
    if (this.clock === null || Math.abs(est - this.clock) > 400) {
      this.clock = this.clockUsed = est;
      this.snaps.length = 0;
    } else this.clock = Math.min(est, this.clock + 0.02);
    const last = this.snaps[this.snaps.length - 1];
    // (kept by the other game's clock: see update)
    if (last && at <= last.t) return;
    this.snaps.push({ t: at, s });
    if (this.snaps.length > 16) this.snaps.shift();
  }

  /**
   * One step of the simulation, taken before the world's own: the engine, the brakes, the
   * steering and the springs, if this game is the one moving it.
   */
  step(h: number, c: Controls | null) {
    const b = this.body;
    const t = b.translation(), rot = b.rotation();
    this.prevPos.set(t.x, t.y, t.z);
    this.prevQuat.set(rot.x, rot.y, rot.z, rot.w);
    if (this.mode !== 'sim') return;
    const D = DRIVE, ctrl = this.ctrl;
    const lv = b.linvel();
    // What the last step did to it that the springs and the engine did not: it ran into something.
    if (this.hasPost) {
      const hard = Math.hypot(lv.x - this.post.x, lv.y - this.post.y + 9.81 * h, lv.z - this.post.z);
      if (hard > D.crash) this.onCrash(hard);
    }
    _q.copy(this.prevQuat);
    _f.set(0, 0, -1).applyQuaternion(_q);
    _u.set(0, 1, 0).applyQuaternion(_q);
    _r.set(1, 0, 0).applyQuaternion(_q);
    const v = lv.x * _f.x + lv.y * _f.y + lv.z * _f.z;
    const side = lv.x * _r.x + lv.y * _r.y + lv.z * _r.z;
    const flat = Math.hypot(lv.x, lv.z);
    this.speed = v;

    // --- what the wheels stand on
    let on = 0, top = 0, roll = 0;
    const tally: Partial<Record<Ground, number>> = {};
    const grips = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      if (!ctrl.wheelIsInContact(i)) {
        grips[i] = D.grip.grass;
        continue;
      }
      const at = ctrl.wheelContactPoint(i);
      const owner = physics.tagOf(ctrl.wheelGroundObject(i));
      // (the ground itself is one sheet: what kind it is under this wheel is the map's to say)
      const g: Ground = !owner || owner.surface === 'grass' ? (at ? this.groundAt(at.x, at.z) : 'grass') : owner.surface === 'rock' ? 'rock' : 'asphalt';
      on++;
      top += D.top[g];
      roll += D.roll[g];
      grips[i] = D.grip[g];
      tally[g] = (tally[g] ?? 0) + 1;
    }
    this.grounded = on;
    if (on) {
      top /= on;
      roll /= on;
      this.ground = (Object.keys(tally) as Ground[]).sort((a, z) => tally[z]! - tally[a]!)[0];
    } else top = D.top.grass;

    // --- the wheel in the driver's hands
    const thr = c && this.fuel > 0 && !this.wreck ? THREE.MathUtils.clamp(c.throttle, -1, 1) : 0;
    const lock = THREE.MathUtils.lerp(D.steer[0], D.steer[1], THREE.MathUtils.smoothstep(Math.abs(v), 2, D.steerAt));
    const want = c ? -THREE.MathUtils.clamp(c.steer, -1, 1) * lock : 0;
    const back = Math.abs(want) < Math.abs(this.steer) || Math.sign(want) !== Math.sign(this.steer);
    const turn = (back ? D.steerRate[1] : D.steerRate[0]) * h;
    this.steer += THREE.MathUtils.clamp(want - this.steer, -turn, turn);
    this.throttle = thr;

    // --- the engine and the brakes
    let drive = 0, brake = 0;
    if (thr > 0) {
      if (v > -1) drive = thr * D.force * Math.max(0, 1 - Math.pow(Math.max(0, v) / top, 2));
      else brake = thr;
    } else if (thr < 0) {
      if (v > 1) brake = -thr;
      else drive = thr * D.force * D.reverse[1] * Math.max(0, 1 - Math.pow(Math.max(0, -v) / D.reverse[0], 2));
    }
    const hand = !!c?.hand;
    // nobody driving, it is held where it stands; somebody driving and off the pedals, it rolls on against the engine
    const idle = c ? D.coast : D.parked;
    const hold = c && Math.abs(v) > 0.6 ? idle : c ? D.brake * 0.5 : D.parked;
    for (let i = 0; i < 4; i++) {
      const rear = i >= 2;
      const share = (rear ? 1 - D.bias : D.bias) / 2;
      // (the brakes are told how much they may take off in one step, as an impulse)
      let stop = brake > 0 ? brake * D.brake * share : drive ? 0 : hold / 4;
      if (hand && rear) stop = D.brake;
      ctrl.setWheelBrake(i, stop * D.mass * h);
      ctrl.setWheelEngineForce(i, hand && rear ? 0 : drive / 4);
      ctrl.setWheelSteering(i, rear ? 0 : this.steer);
      ctrl.setWheelFrictionSlip(i, grips[i] * (rear ? D.rear * (hand ? D.hand : 1) : 1));
    }
    if (thr || hand || Math.abs(want - this.steer) > 1e-3) b.wakeUp();

    // --- the ground it rolls over, and the air it goes through
    if (on && flat > 0.4) {
      const drag = (roll * (on / 4) + 0.0011 * flat * flat) * h;
      const k = Math.max(0, 1 - drag / flat);
      b.setLinvel({ x: lv.x * k, y: lv.y, z: lv.z * k }, false);
    }
    const av = b.angvel();
    if (!on) {
      // In the air it can still be steered a little, and it is pulled toward level: it is
      // meant to come down on its wheels.
      const steerIn = c ? -THREE.MathUtils.clamp(c.steer, -1, 1) : 0;
      const pitchIn = c ? THREE.MathUtils.clamp(c.throttle, -1, 1) : 0;
      _v.crossVectors(_u, UP).multiplyScalar(D.air[2]);
      _v.addScaledVector(UP, steerIn * D.air[0]).addScaledVector(_r, -pitchIn * D.air[1]);
      const k = Math.exp(-D.spin[1] * h);
      b.setAngvel({ x: (av.x + _v.x * h) * k, y: (av.y + _v.y * h) * k, z: (av.z + _v.z * h) * k }, true);
    } else {
      const k = Math.exp(-D.spin[0] * h);
      b.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, false);
    }
    this.slide = on ? THREE.MathUtils.clamp((Math.abs(side) - 1.2) / 5, 0, 1) * THREE.MathUtils.clamp(flat / 5, 0, 1) : 0;
    if (hand && on && Math.abs(v) > 3) this.slide = Math.max(this.slide, 0.6);

    ctrl.updateVehicle(h, undefined, SOLID_GROUPS, (col) => col.parent()?.handle !== b.handle);
    let across = 0;
    for (let i = 0; i < 4; i++) {
      this.susp[i] = ctrl.wheelSuspensionLength(i) ?? this.susp[i];
      across += ctrl.wheelSideImpulse(i) ?? 0;
    }
    // the tyres hold it at the ground and its weight is above them: it leans out of the turn
    if (across) {
      const most = D.mass * D.lean[1] * h;
      const k = THREE.MathUtils.clamp(across, -most, most) * (RIDE_HEIGHT - D.low) * (D.lean[0] - 0.1);
      b.applyTorqueImpulse({ x: -_f.x * k, y: -_f.y * k, z: -_f.z * k }, true);
    }
    const after = b.linvel();
    this.post.set(after.x, after.y, after.z);
    this.hasPost = true;
    // (burning what is in the tank: flat out for a minute is JEEP.burn litres)
    if (thr) this.fuel = Math.max(0, this.fuel - (Math.abs(thr) * JEEP.burn * h) / 60);
    const quiet = flat < 0.15 && Math.abs(lv.y) < 0.15 && Math.hypot(av.x, av.y, av.z) < 0.1;
    this.still = quiet ? this.still + h : 0;
  }

  /** another game has taken over moving it: what the last one said no longer places it */
  forget() {
    this.snaps.length = 0;
    this.clock = null;
  }

  /** it has rolled to a stop and stayed there: whoever was moving it can let it be */
  get atRest() {
    return this.still > 1;
  }

  /** on its side or its back, and not going anywhere */
  get over() {
    _u.set(0, 1, 0).applyQuaternion(this.quat);
    return _u.y < 0.35 && this.vel.lengthSq() < 4;
  }

  /** stood back on its wheels where it lies, facing the way it was */
  flip() {
    _f.set(0, 0, -1).applyQuaternion(this.quat);
    // (on its roof the nose points the way it did; on its nose or tail, take any way)
    const yaw = Math.hypot(_f.x, _f.z) > 0.2 ? Math.atan2(-_f.x, -_f.z) : 0;
    const t = this.body.translation();
    const hit = physics.raycast({ x: t.x, y: t.y + 3, z: t.z }, { x: 0, y: -1, z: 0 }, 12, SOLID_GROUPS, this.colliders[0]);
    const y = (hit && physics.tagOf(hit.collider)?.owner !== this ? hit.point.y : t.y - 0.6) + RIDE_HEIGHT + 0.25;
    this.place([t.x, y, t.z, 0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2), 0, 0, 0, 0, 0]);
  }

  /**
   * Once a frame, after the simulation: where it is drawn. A jeep moved here is drawn between
   * its last two steps; one moved elsewhere, between the two reports either side of a moment ago.
   */
  update(dt: number, now: number, alpha: number) {
    if (this.mode === 'sim') {
      const t = this.body.translation(), r = this.body.rotation(), v = this.body.linvel();
      this.pos.lerpVectors(this.prevPos, _v.set(t.x, t.y, t.z), alpha);
      this.quat.slerpQuaternions(this.prevQuat, _q.set(r.x, r.y, r.z, r.w), alpha);
      this.vel.set(v.x, v.y, v.z);
    } else if (this.mode === 'follow' && this.snaps.length && this.clock !== null) {
      this.clockUsed += (this.clock - this.clockUsed) * (1 - Math.exp(-3 * dt));
      const at = now - INTERP_DELAY - this.clockUsed;
      const s = this.snaps;
      let a = s[0], b = s[s.length - 1];
      for (let i = s.length - 1; i > 0; i--) {
        if (s[i - 1].t <= at) {
          a = s[i - 1];
          b = s[i];
          break;
        }
      }
      // (a little beyond the last report rather than a stop and a start every time one is late)
      const k = b.t > a.t ? THREE.MathUtils.clamp((at - a.t) / (b.t - a.t), 0, 1.6) : 1;
      const tele = Math.hypot(b.s[0] - this.pos.x, b.s[2] - this.pos.z) > 25;
      this.pos.set(a.s[0] + (b.s[0] - a.s[0]) * k, a.s[1] + (b.s[1] - a.s[1]) * k, a.s[2] + (b.s[2] - a.s[2]) * k);
      _q.set(a.s[3], a.s[4], a.s[5], a.s[6]);
      _q2.set(b.s[3], b.s[4], b.s[5], b.s[6]);
      if (tele) this.quat.copy(_q2);
      else this.quat.slerpQuaternions(_q, _q2, Math.min(1.2, k)).normalize();
      this.vel.set(b.s[7], b.s[8], b.s[9]);
      this.steer += (b.s[10] - this.steer) * (1 - Math.exp(-14 * dt));
      this.throttle = b.s[11];
      this.body.setNextKinematicTranslation(this.pos);
      this.body.setNextKinematicRotation(this.quat);
      _f.set(0, 0, -1).applyQuaternion(this.quat);
      this.speed = this.vel.dot(_f);
      _r.set(1, 0, 0).applyQuaternion(this.quat);
      this.slide = THREE.MathUtils.clamp((Math.abs(this.vel.dot(_r)) - 1.2) / 5, 0, 1);
    } else if (this.mode === 'parked') {
      this.speed = 0;
      this.slide = 0;
      this.throttle = 0;
    }
    this.draw(dt);
  }

  private draw(dt: number) {
    const D = DRIVE;
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i], at = this.hard[i];
      if (this.mode !== 'sim' && dt > 0) {
        // not sprung here: each wheel is simply let down onto whatever is under it
        _v.copy(at).applyQuaternion(this.quat).add(this.pos);
        _d.set(0, -1, 0).applyQuaternion(this.quat);
        const hit = physics.world.castRay(new physics.R.Ray(_v, _d), D.rest + D.radius, true, undefined, SOLID_GROUPS, undefined, this.body);
        const len = hit ? THREE.MathUtils.clamp(hit.timeOfImpact - D.radius, D.rest - D.travel, D.rest) : D.rest;
        this.susp[i] += (len - this.susp[i]) * (1 - Math.exp(-18 * dt));
      }
      const rear = i >= 2;
      this.spinAngle[i] = (this.spinAngle[i] + (this.speed / D.radius) * dt) % (Math.PI * 2);
      w.position.set(at.x, at.y - this.susp[i], at.z);
      w.rotation.set(-this.spinAngle[i], rear ? 0 : this.steer, 0, 'YXZ');
    }
  }

  /** a point given in its own frame (x to its right, y up, z back), as it is drawn */
  point(x: number, y: number, z: number, out: THREE.Vector3) {
    return out.set(x, y, z).applyQuaternion(this.quat).add(this.pos);
  }

  /** which way its nose points, as a yaw (0 looks down -z) */
  get yaw() {
    _f.set(0, 0, -1).applyQuaternion(this.quat);
    return Math.atan2(-_f.x, -_f.z);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.root);
    for (const c of this.colliders) physics.tags.delete(c.handle);
    physics.world.removeVehicleController(this.ctrl);
    physics.world.removeRigidBody(this.body);
  }
}

/** every surface the game knows, as one of the five the tyres do */
export function groundOf(s: Surface | string): Ground {
  return s === 'asphalt' || s === 'concrete' ? 'asphalt' : s === 'gravel' ? 'gravel' : s === 'dirt' ? 'dirt' : s === 'rock' ? 'rock' : 'grass';
}
