// A floor that moves: a car on a line, that a body can walk about in while it goes (the owner, 2026-10-31: "players need to be able to move on the
// traincar like rust"). A body is moved as it always is, its walking judged against the car as if the car stood still; then all of that is carried
// as the car moves, past anything else, as a whole. So it walks, jumps and fights in the car at any speed, and the two are never out of step. The car
// is set in each fixed step, and drawn between two of them exactly as the body is, so neither shakes against the other.
// (The car is PLACED each step, never given a speed: Rapier's character controller drags a body along a floor that has one, by friction, on top of what
// is done here, and a body stood still walked itself up the car.)

import * as THREE from 'three';
import { WORLD_GROUPS, physics } from '../core/physics';
import { makeLine, onLine, runTime, runTo, type Line, type OnLine } from '../sim/train';

/** half the car inside, metres: across, along, and how tall */
export const CAR = { hw: 1.45, hl: 6.3, tall: 2.5, wall: 0.12 };
const UP = new THREE.Vector3(0, 1, 0);

export class TrainCar {
  readonly group = new THREE.Group();
  private body;
  private t = 0;
  private s0 = new THREE.Vector3();
  private s1 = new THREE.Vector3();
  private q0 = new THREE.Quaternion();
  private q1 = new THREE.Quaternion();
  private m0 = new THREE.Matrix4();
  private m1 = new THREE.Matrix4();
  /** what the car's last step did to whatever is carried: the old pose undone and the new one done */
  private carried = new THREE.Matrix4();
  private inverse = new THREE.Matrix4();
  private turned = 0;
  private yaw = 0;
  private v = new THREE.Vector3();
  private ONE = new THREE.Vector3(1, 1, 1);

  /** @param where the car's place at a moment, seconds on */
  constructor(scene: THREE.Scene, private where: (t: number) => OnLine) {
    const R = physics.R;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    const C = CAR, h = C.tall / 2, wall = C.wall;
    const solid = (hx: number, hy: number, hz: number, x: number, y: number, z: number) => {
      const c = physics.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setCollisionGroups(WORLD_GROUPS).setSolverGroups(WORLD_GROUPS), this.body);
      physics.tag(c, { surface: 'metal' });
    };
    solid(C.hw + wall, wall, C.hl + wall, 0, -wall, 0);
    solid(C.hw + wall, wall, C.hl + wall, 0, C.tall + wall, 0);
    solid(wall, h, C.hl + wall, -C.hw - wall, h, 0);
    solid(wall, h, C.hl + wall, C.hw + wall, h, 0);
    solid(C.hw, h, wall, 0, h, -C.hl - wall);
    solid(C.hw, h, wall, 0, h, C.hl + wall);
    this.set(where(0));
    this.s0.copy(this.s1);
    this.q0.copy(this.q1);
    this.m0.copy(this.m1);
    scene.add(this.group);
  }

  private set(p: OnLine) {
    this.s1.set(p.x, p.y, p.z);
    this.q1.setFromAxisAngle(UP, p.yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -p.pitch));
    this.yaw = p.yaw;
    this.m1.compose(this.s1, this.q1, this.ONE);
  }

  /** One fixed step, before anything that may stand in it moves. */
  step(h: number) {
    this.t += h;
    this.s0.copy(this.s1);
    this.q0.copy(this.q1);
    this.m0.copy(this.m1);
    const was = this.yaw;
    this.set(this.where(this.t));
    this.turned = this.yaw - was;
    this.inverse.copy(this.m0).invert();
    this.carried.copy(this.m1).multiply(this.inverse);
  }

  /** After whatever stands in it has moved: the car where this step put it. */
  placed() {
    this.body.setTranslation({ x: this.s1.x, y: this.s1.y, z: this.s1.z }, true);
    this.body.setRotation(this.q1, true);
  }

  /** where a point is in the car: across, up from its floor, along */
  local(p: { x: number; y: number; z: number }, out = new THREE.Vector3()) {
    return out.set(p.x, p.y, p.z).applyMatrix4(this.inverse.copy(this.m1).invert());
  }

  /** A body at `next` this step: carried with the car if it is in it. @returns how far it was turned with it, radians */
  carry = (next: { x: number; y: number; z: number }): number => {
    const C = CAR, l = this.v.set(next.x, next.y, next.z).applyMatrix4(this.inverse.copy(this.m0).invert());
    if (Math.abs(l.x) > C.hw + 0.3 || Math.abs(l.z) > C.hl + 0.3 || l.y < -0.5 || l.y > C.tall + 0.5) return 0;
    this.v.set(next.x, next.y, next.z).applyMatrix4(this.carried);
    next.x = this.v.x;
    next.y = this.v.y;
    next.z = this.v.z;
    return this.turned;
  };

  /** Drawn between its last two steps, as a body is. */
  draw(alpha: number) {
    this.group.position.lerpVectors(this.s0, this.s1, alpha);
    this.group.quaternion.slerpQuaternions(this.q0, this.q1, alpha);
  }

  dispose() {
    this.group.removeFromParent();
    physics.world.removeRigidBody(this.body);
  }
}

/** A plain car to judge the moving floor by: grey boxes, a line down the floor every metre, and windows' worth of gaps to see the ground go by. */
export function plainCar(car: TrainCar) {
  const C = CAR, grey = new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.8 }), red = new THREE.MeshStandardMaterial({ color: 0x8e3a2e, roughness: 0.7 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.castShadow = b.receiveShadow = true;
    car.group.add(b);
  };
  box(C.hw * 2 + 0.24, 0.12, C.hl * 2 + 0.24, 0, -0.06, 0, grey);
  box(C.hw * 2 + 0.24, 0.12, C.hl * 2 + 0.24, 0, C.tall + 0.06, 0, red);
  for (const s of [-1, 1]) {
    box(0.12, 1, C.hl * 2, s * (C.hw + 0.06), 0.5, 0, red);
    for (let z = -C.hl; z <= C.hl; z += 3.15) box(0.12, C.tall, 0.14, s * (C.hw + 0.06), C.tall / 2, z, grey);
    box(C.hw * 2, C.tall, 0.12, 0, C.tall / 2, s * (C.hl + 0.06), red);
  }
  for (let z = -C.hl + 0.5; z < C.hl; z += 1) box(C.hw * 2, 0.01, 0.06, 0, 0.005, z, red);
}

/** a test track high over the desert, clear of everything: a long straight, a bend, and a run back along it */
export function testRun(speed = 30, accel = 2.2): { line: Line; where: (t: number) => OnLine; time: number } {
  const y = 140, line = makeLine([[-3200, y, 300], [-2900, y, 300], [-2700, y, 300], [-2600, y, 330], [-2560, y, 420], [-2560, y, 700]]);
  return { line, where: (t) => onLine(line, runTo(line.length, speed, accel, t)), time: runTime(line.length, speed, accel) };
}
