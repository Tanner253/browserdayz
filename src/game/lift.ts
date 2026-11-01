// The goods lift between Bunker 17's first two levels (the owner, 2026-10-31: a real cab, not a bar and a blink). Its floor is a floor that moves, run by the same clock as the
// train: it goes up and down by itself, so whoever is in it rides, together, and its gate at each level stands open only while it is there. A body in the cab is carried by
// what the floor did this step, as a body in the wagon is. Everything of it is said in the bunker's own measure.

import * as THREE from 'three';
import { audio } from '../core/audio';
import { WORLD_GROUPS, physics } from '../core/physics';
import { CAB, bunkerAt, bunkerLocal, levelY, liftAt, type Place } from '../sim/bunker';

const THICK = 0.08, GATE_HIGH = 2.4;

export class GoodsLift {
  private group = new THREE.Group();
  private body;
  private gates: { level: number; body: ReturnType<typeof physics.world.createCollider>; mesh: THREE.Group; up: number; was: boolean }[] = [];
  private y0 = 0;
  private y1 = 0;
  private t: number;
  private x: number;
  private z: number;
  private at = new THREE.Vector3();

  constructor(scene: THREE.Scene, private P: Place, private now: () => number, steel: THREE.Material) {
    const mid = (CAB.back + CAB.front) / 2, half = (CAB.front - CAB.back) / 2, h = P.rot / 2, turn = { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
    [this.x, , this.z] = bunkerAt(P, 0, mid);
    this.t = now();
    this.y1 = this.floorAt(this.t);
    this.y0 = this.y1;
    this.body = physics.world.createRigidBody(physics.R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.x, this.y1 - THICK, this.z).setRotation(turn));
    const floor = physics.world.createCollider(physics.R.ColliderDesc.cuboid(CAB.r, THICK, half).setCollisionGroups(WORLD_GROUPS).setSolverGroups(WORLD_GROUPS), this.body);
    physics.tag(floor, { surface: 'metal' });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(CAB.r * 2, THICK * 2, half * 2), steel);
    plate.rotation.y = P.rot;
    this.group.add(plate);
    // (the gate at each level, across the cab's open front: it lifts out of the way while the floor is there)
    for (const level of [1, 2]) {
      const [gx, gy, gz] = bunkerAt(P, 0, CAB.front - 0.05, levelY(level) + GATE_HIGH / 2);
      const c = physics.R.ColliderDesc.cuboid(CAB.r, GATE_HIGH / 2, 0.05).setTranslation(gx, gy, gz).setRotation(turn).setCollisionGroups(WORLD_GROUPS).setSolverGroups(WORLD_GROUPS);
      const body = physics.world.createCollider(c);
      physics.tag(body, { surface: 'metal' });
      const parts: THREE.BufferGeometry[] = [];
      for (let r = -CAB.r; r <= CAB.r + 0.01; r += 0.3) parts.push(new THREE.BoxGeometry(0.03, GATE_HIGH, 0.03).translate(r, 0, 0));
      for (const y of [-GATE_HIGH / 2 + 0.05, 0, GATE_HIGH / 2 - 0.05]) parts.push(new THREE.BoxGeometry(CAB.r * 2, 0.06, 0.05).translate(0, y, 0));
      const mesh = new THREE.Group();
      for (const g of parts) mesh.add(new THREE.Mesh(g, steel));
      mesh.position.set(gx, gy, gz);
      mesh.rotation.y = P.rot;
      this.group.add(mesh);
      this.gates.push({ level, body, mesh, up: 0, was: false });
    }
    scene.add(this.group);
  }

  private floorAt(t: number) {
    return this.P.y + levelY(1) + (levelY(2) - levelY(1)) * liftAt(t).y;
  }

  step(h: number) {
    this.t += h;
    const off = this.now() - this.t;
    this.t += Math.abs(off) > 3 ? off : Math.max(-0.02 * h, Math.min(0.02 * h, off));
    this.y0 = this.y1;
    this.y1 = this.floorAt(this.t);
  }

  placed() {
    this.body.setTranslation({ x: this.x, y: this.y1 - THICK, z: this.z }, true);
  }

  /** A body at `next` this step: carried with the floor if it is on it. Nothing is turned: the answer is always 0. */
  carry = (next: { x: number; y: number; z: number }): number => {
    const [r, f] = bunkerLocal(this.P, next.x, next.y, next.z);
    if (Math.abs(r) < CAB.r + 0.2 && f > CAB.back - 0.2 && f < CAB.front + 0.1 && next.y > this.y0 - 0.5 && next.y < this.y0 + 2.6) next.y += this.y1 - this.y0;
    return 0;
  };

  /** Once a frame: where it is drawn, its gates, and what is heard of them. */
  draw(dt: number, alpha: number, eye: THREE.Vector3) {
    const near = Math.hypot(eye.x - this.x, eye.z - this.z) < 45;
    this.group.visible = near;
    const now = liftAt(this.t), y = this.y0 + (this.y1 - this.y0) * alpha - THICK;
    this.group.children[0].position.set(this.x, y, this.z);
    for (const g of this.gates) {
      const open = now.stop === g.level && now.left > 1.2;
      if (open !== g.was) {
        g.was = open;
        // (heard from beside it and on its own level, and from nowhere else: it goes all day whether or not anybody is by. The owner, 2026-11-01: "i keep hearing doors open in
        // the bunker when im in lvl 1"; "the door creak sound keeps happening")
        const far = g.mesh.position.distanceTo(eye);
        if (far < 7) audio.lightGate(this.at.copy(g.mesh.position), far, open);
      }
      g.up = THREE.MathUtils.clamp(g.up + (open ? dt : -dt) / 1.1, 0, 1);
      g.body.setEnabled(g.up < 0.7);
      g.mesh.position.y = this.P.y + levelY(g.level) + GATE_HIGH / 2 + g.up * (GATE_HIGH - 0.2);
    }
  }

  /** how it stands for a body in its cab (null: there is none here). Between levels `left` says which way it is going: under 0, up. */
  cabFor(p: { x: number; y: number; z: number }) {
    const [r, f, h] = bunkerLocal(this.P, p.x, p.y, p.z);
    if (Math.abs(r) > CAB.r + 0.1 || f < CAB.back - 0.1 || f > CAB.front + 0.1 || h < levelY(2) - 1 || h > levelY(1) + 3.2) return null;
    const s = liftAt(this.t);
    return s.stop ? { stop: s.stop, left: s.left } : { stop: 0, left: s.y > liftAt(this.t - 0.1).y ? 1 : -1 };
  }

  /** how long until it moves, or stands */
  state() {
    return liftAt(this.t);
  }
}

