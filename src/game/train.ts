// The train: an open wagon on the line, with a shunter coupled to it, that a body can walk about in while it goes (the owner, 2026-10-31: "players need to be able to move
// on the traincar like rust"). A body is moved as it always is, its walking judged against the wagon as if the wagon stood still; then all of that is carried as the wagon
// moves, past anything else, as a whole. So it walks, jumps and fights in there at any speed, and the two are never out of step. Each is set in each fixed step and drawn
// between two of them exactly as a body is, so neither shakes against the other.
// (A vehicle is PLACED each step, never given a speed: Rapier's character controller drags a body along a floor that has one, by friction, on top of what is done here, and
// a body stood still walked itself up the car.)

import * as THREE from 'three';
import { assets } from '../core/assets';
import { audio, type TrainVoice } from '../core/audio';
import { GLASS_GROUPS, WORLD_GROUPS, physics } from '../core/physics';
import type { OnLine } from '../sim/train';
import { RIM, ROUND, RUN, onTheLine, shunterAt, trainAt, wagonAt } from '../sim/train-line';

/** the inside of the wagon, metres from its middle and its deck: half across, half along; and how far the bars over its sides reach up (nothing to see: the tunnel has no walls to stop a body) */
export const CAR = { hw: 1.42, hl: 6.35, over: 3.6, wall: 0.14 };
/** what a wagon's deck stands over the rails, and the shunter's size inside its box */
const DECK = 1.4, SHUNTER = { hx: 1.55, tall: 4.2, hz: 4.7 };
/** the steps inside the wagon, up to its side, that you come in and go out by: three at a third of the side's height, on the platform's side */
const STEPS = 3, STEP_DEEP = 0.36, STEP_WIDE = 0.9;
/** near enough to see it: the two are loaded, and drawn, only then */
const SEEN = 340;
const UP = new THREE.Vector3(0, 1, 0), ACROSS = new THREE.Vector3(1, 0, 0), ONE = new THREE.Vector3(1, 1, 1), _q = new THREE.Quaternion();

/** one vehicle on the line */
class OnRails {
  readonly group = new THREE.Group();
  readonly body;
  private s0 = new THREE.Vector3();
  private s1 = new THREE.Vector3();
  private q0 = new THREE.Quaternion();
  private q1 = new THREE.Quaternion();
  m0 = new THREE.Matrix4();
  m1 = new THREE.Matrix4();
  yaw = 0;

  constructor(scene: THREE.Scene, p: OnLine) {
    this.body = physics.world.createRigidBody(physics.R.RigidBodyDesc.kinematicPositionBased());
    this.set(p);
    this.s0.copy(this.s1);
    this.q0.copy(this.q1);
    this.m0.copy(this.m1);
    scene.add(this.group);
  }

  private set(p: OnLine) {
    this.s1.set(p.x, p.y, p.z);
    this.q1.setFromAxisAngle(UP, p.yaw).multiply(_q.setFromAxisAngle(ACROSS, -p.pitch));
    this.yaw = p.yaw;
    this.m1.compose(this.s1, this.q1, ONE);
  }

  step(p: OnLine) {
    this.s0.copy(this.s1);
    this.q0.copy(this.q1);
    this.m0.copy(this.m1);
    this.set(p);
  }

  placed() {
    this.body.setTranslation({ x: this.s1.x, y: this.s1.y, z: this.s1.z }, true);
    this.body.setRotation(this.q1, true);
  }

  draw(alpha: number) {
    this.group.position.lerpVectors(this.s0, this.s1, alpha);
    this.group.quaternion.slerpQuaternions(this.q0, this.q1, alpha);
  }

  box(hx: number, hy: number, hz: number, x: number, y: number, z: number, groups = WORLD_GROUPS) {
    const c = physics.world.createCollider(physics.R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setCollisionGroups(groups).setSolverGroups(groups), this.body);
    physics.tag(c, { surface: 'metal' });
    return c;
  }
}

export class TrainCar {
  readonly wagon: OnRails;
  readonly shunter: OnRails;
  private t: number;
  /** what the wagon's last step did to whatever is carried: the old pose undone and the new one done */
  private carried = new THREE.Matrix4();
  private inverse = new THREE.Matrix4();
  private turned = 0;
  private v = new THREE.Vector3();
  private gate;
  private loading = false;
  private voice: TrainVoice | null = null;
  private was = { s: 0, stop: 0, braking: false, hooted: false };
  private clock = 0;
  /** what the rails do to whoever rides: a slow lean, and a knock at each joint, in radians and metres */
  readonly ride = { roll: 0, bump: 0 };

  /** @param now the shared clock, seconds */
  constructor(scene: THREE.Scene, private now: () => number) {
    this.t = now();
    this.wagon = new OnRails(scene, wagonAt(this.t));
    this.shunter = new OnRails(scene, shunterAt(this.t));
    const C = CAR, w = this.wagon, wall = C.wall, h = RIM / 2, up = (C.over - RIM) / 2, top = RIM + up;
    w.box(C.hw + wall, wall, C.hl + wall, 0, -wall, 0);
    for (const s of [-1, 1]) {
      w.box(wall / 2, h, C.hl + wall, s * (C.hw + wall / 2), h, 0);
      w.box(C.hw, h, wall / 2, 0, h, s * (C.hl + wall / 2));
      w.box(C.hw, up, wall / 2, 0, top, s * (C.hl + wall / 2), GLASS_GROUPS);
    }
    w.box(wall / 2, up, C.hl + wall, C.hw + wall / 2, top, 0, GLASS_GROUPS);
    // (the side the platforms stand on, the -x of the line going to Level 3: open over the steps, and shut across them while the train moves)
    const gap = STEP_WIDE, long = (C.hl - gap) / 2;
    for (const s of [-1, 1]) w.box(wall / 2, up, long + wall, -C.hw - wall / 2, top, s * (gap + long + wall), GLASS_GROUPS);
    this.gate = w.box(wall / 2, up, gap, -C.hw - wall / 2, top, 0, GLASS_GROUPS);
    for (let k = 1; k <= STEPS; k++) {
      const high = (RIM * (STEPS + 1 - k)) / (STEPS + 1), x = -C.hw + STEP_DEEP * (k - 0.5);
      w.box(STEP_DEEP / 2, high / 2, STEP_WIDE, x, high / 2, 0);
    }
    this.shunter.box(SHUNTER.hx, SHUNTER.tall / 2, SHUNTER.hz, 0, SHUNTER.tall / 2 - DECK, 0);
  }

  private async load() {
    this.loading = true;
    const [wagon, shunter] = await Promise.all([assets.model('gondola_wagon'), assets.model('diesel_shunter')]);
    const set = (m: THREE.Object3D, on: OnRails, turn: number) => {
      const c = m.clone();
      c.rotation.y = turn;
      c.position.y = -DECK;
      on.group.add(c);
    };
    // (their long way is their x, and the line's is z; the shunter's cab end faces the wagon)
    set(wagon, this.wagon, Math.PI / 2);
    set(shunter, this.shunter, Math.PI / 2);
    // (the steps, of the plate such things are welded up from)
    const plate = assets.pbr('rusty_corrugated_iron'), iron = new THREE.MeshStandardMaterial({ map: plate.map, normalMap: plate.normalMap, roughness: 0.8, metalness: 0.4 });
    for (let k = 1; k <= STEPS; k++) {
      const high = (RIM * (STEPS + 1 - k)) / (STEPS + 1), c = new THREE.Mesh(new THREE.BoxGeometry(STEP_DEEP, high, STEP_WIDE * 2), iron);
      c.position.set(-CAR.hw + STEP_DEEP * (k - 0.5), high / 2, 0);
      c.castShadow = c.receiveShadow = true;
      this.wagon.group.add(c);
    }
  }

  /** One fixed step, before anything that may stand in it moves. The clock is eased to, never jumped to, unless it is far out: a jump would throw whoever is aboard. */
  step(h: number) {
    this.t += h;
    const off = this.now() - this.t;
    this.t += Math.abs(off) > 3 ? off : Math.max(-0.02 * h, Math.min(0.02 * h, off));
    const was = this.wagon.yaw, w = this.wagon;
    w.step(wagonAt(this.t));
    this.shunter.step(shunterAt(this.t));
    this.turned = w.yaw - was;
    this.inverse.copy(w.m0).invert();
    this.carried.copy(w.m1).multiply(this.inverse);
    this.gate.setEnabled(trainAt(this.t).stop < 0);
  }

  /** After whatever stands in it has moved: each where this step put it. */
  placed() {
    this.wagon.placed();
    this.shunter.placed();
  }

  /** A body at `next` this step: carried with the wagon if it is in it. @returns how far it was turned with it, radians */
  carry = (next: { x: number; y: number; z: number }): number => {
    const C = CAR, l = this.v.set(next.x, next.y, next.z).applyMatrix4(this.inverse.copy(this.wagon.m0).invert());
    if (Math.abs(l.x) > C.hw + 0.3 || Math.abs(l.z) > C.hl + 0.3 || l.y < -0.5 || l.y > C.over + 0.5) return 0;
    this.v.set(next.x, next.y, next.z).applyMatrix4(this.carried);
    next.x = this.v.x;
    next.y = this.v.y;
    next.z = this.v.z;
    return this.turned;
  };

  /** which way is up off the deck, for a body at this spot in the wagon; null anywhere else */
  deck = (at: { x: number; y: number; z: number }) => {
    const C = CAR, l = this.v.set(at.x, at.y, at.z).applyMatrix4(this.inverse.copy(this.wagon.m0).invert());
    if (Math.abs(l.x) > C.hw || Math.abs(l.z) > C.hl || l.y < -0.5 || l.y > 2.2) return null;
    const e = this.wagon.m0.elements;
    return { x: e[4], y: e[5], z: e[6] };
  };

  /** the train as it is told to whoever is on the line */
  line(p: { x: number; y: number; z: number }) {
    const n = trainAt(this.t), c = ((this.t % ROUND) + ROUND) % ROUND;
    return { stop: n.stop, left: n.left, bound: c < ROUND / 2 ? 1 : 0, t: this.t, aboard: this.aboard(p) !== null };
  }

  /** where it is in its round now: standing, and how long for */
  state() {
    return trainAt(this.t);
  }

  /** What is heard of it and what it does to whoever rides it, once a frame. */
  feel(dt: number, eye: THREE.Vector3) {
    const now = trainAt(this.t), v = dt > 0 ? Math.min(RUN.speed, Math.abs(now.s - this.was.s) / dt) : 0, far = this.wagon.group.position.distanceTo(eye), onIt = this.aboard(eye) !== null;
    this.was.s = now.s;
    this.clock += dt * (v / 6);
    const k = v / RUN.speed;
    this.ride.roll = onIt ? (Math.sin(this.clock * 0.9) * 0.006 + Math.sin(this.clock * 2.3) * 0.002) * k : 0;
    this.ride.bump = onIt ? Math.sin(this.clock * 5.1) * Math.sin(this.clock * 1.7) * 0.012 * k : 0;
    const heard = onTheLine(eye.x, eye.y, eye.z) && far < 320;
    if (!heard) {
      this.voice?.stop();
      this.voice = null;
    } else {
      this.voice ??= audio.train();
      if (this.voice) {
        // (nothing ahead of the eye but the bore, aboard: it comes from all round)
        this.voice.set(onIt ? eye : this.wagon.group.position, v, onIt ? 0.5 : 0.7 / (1 + far / 16), onIt ? 5200 : Math.max(900, 5200 - far * 30), dt);
        if (now.stop >= 0 && now.left < 3 && !this.was.hooted) {
          this.was.hooted = true;
          this.voice.horn();
        }
        const braking = now.stop < 0 && now.left < RUN.speed / RUN.accel * 0.6;
        if (braking !== this.was.braking) {
          this.was.braking = braking;
          this.voice.brake(braking);
        }
      }
    }
    if (now.stop !== this.was.stop) {
      this.was.stop = now.stop;
      this.was.hooted = false;
    }
  }

  /** Drawn between its last two steps, as a body is. */
  draw(alpha: number, eye: THREE.Vector3) {
    const near = this.wagon.group.position.distanceToSquared(eye) < SEEN * SEEN;
    this.wagon.group.visible = this.shunter.group.visible = near;
    if (near && !this.loading) void this.load();
    this.wagon.draw(alpha);
    this.shunter.draw(alpha);
  }

  /** where a point is in the wagon: across, up from its deck, along */
  local(p: { x: number; y: number; z: number }, out = new THREE.Vector3()) {
    return out.set(p.x, p.y, p.z).applyMatrix4(this.inverse.copy(this.wagon.m1).invert());
  }

  /** where a body is in the wagon, to be told to others so that they see it there and not trailing behind (null: it is not aboard) */
  aboard(p: { x: number; y: number; z: number }): [number, number, number] | null {
    const l = this.local(p, this.v), C = CAR;
    if (Math.abs(l.x) > C.hw + 0.3 || Math.abs(l.z) > C.hl + 0.3 || l.y < -0.5 || l.y > C.over + 0.5) return null;
    return [Math.round(l.x * 100) / 100, Math.round(l.y * 100) / 100, Math.round(l.z * 100) / 100];
  }

  /** a point in the wagon, in the world */
  world(l: { x: number; y: number; z: number }, out = new THREE.Vector3()) {
    return out.set(l.x, l.y, l.z).applyMatrix4(this.wagon.m1);
  }
}
