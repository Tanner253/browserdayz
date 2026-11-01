// The goods lift between Bunker 17's first two levels (the owner, 2026-10-31: a real cab, not a bar and a blink). Its floor is a floor that moves, run by the same clock as the
// train: it goes up and down by itself, so whoever is in it rides, together, and its gate at each level stands open only while it is there. A body in the cab is carried by
// what the floor did this step, as a body in the wagon is. Everything of it is said in the bunker's own measure.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { audio } from '../core/audio';
import { WORLD_GROUPS, physics } from '../core/physics';
import { CAB, bunkerAt, bunkerLocal, levelY, liftAt, type Place } from '../sim/bunker';

const THICK = 0.08, GATE_HIGH = 2.4;

const paint = (register: <T extends THREE.Material>(m: T) => T, map: THREE.Texture | null, roughness: number, metalness: number) => register(new THREE.MeshStandardMaterial({ map, roughness, metalness }));
const canvas = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, u = 1, v = 1) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(u, v);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
/** tread plate: worn grey steel, rows of raised bars, and the dirt of a working floor */
const steelPlate = () => canvas(128, 128, (g) => {
  g.fillStyle = '#5c605c';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    g.save();
    g.translate(x * 16 + 8, y * 16 + 8);
    g.rotate((x + y) % 2 ? 0.8 : -0.8);
    g.fillStyle = '#7a7e78';
    g.fillRect(-6, -1.6, 12, 3.2);
    g.fillStyle = '#3e423e';
    g.fillRect(-6, 1.2, 12, 0.8);
    g.restore();
  }
  for (let k = 0; k < 90; k++) {
    g.fillStyle = `rgba(${40 + (k % 5) * 12}, ${28 + (k % 4) * 8}, 18, 0.12)`;
    g.fillRect((k * 53) % 128, (k * 29) % 128, 3 + (k % 11), 2 + (k % 7));
  }
}, 2, 2);
/** the yellow and black at the edge of a thing that moves */
const hazard = () => canvas(128, 32, (g) => {
  g.fillStyle = '#c69a1f';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#191a18';
  for (let x = -32; x < 128; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 32);
    g.lineTo(x + 48, 0);
    g.lineTo(x + 32, 0);
    g.closePath();
    g.fill();
  }
}, 3, 1);

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

  private cab = new THREE.Group();
  /** where its lamp hangs now */
  readonly lamp = new THREE.Vector3();

  /** @param register how a paint of it is told to the day and the dark */
  constructor(scene: THREE.Scene, private P: Place, private now: () => number, steel: THREE.Material, register: <T extends THREE.Material>(m: T) => T) {
    const mid = (CAB.back + CAB.front) / 2, half = (CAB.front - CAB.back) / 2, h = P.rot / 2, turn = { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
    [this.x, , this.z] = bunkerAt(P, 0, mid);
    this.t = now();
    this.y1 = this.floorAt(this.t);
    this.y0 = this.y1;
    this.body = physics.world.createRigidBody(physics.R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.x, this.y1 - THICK, this.z).setRotation(turn));
    const floor = physics.world.createCollider(physics.R.ColliderDesc.cuboid(CAB.r, THICK, half).setCollisionGroups(WORLD_GROUPS).setSolverGroups(WORLD_GROUPS), this.body);
    physics.tag(floor, { surface: 'metal' });
    // (the cab, all of it riding with the floor: a plate of chequered steel, a frame and half-height sides of sheet, wire over them, a lamp in its roof, the pendant it is run from, and the
    // ropes it hangs on. The owner, 2026-11-01: "the elevator seems low quality")
    const cab = this.cab, W = CAB.r, H = 2.5, sheet = paint(register, steelPlate(), 0.5, 0.45), frame = paint(register, null, 0.6, 0.4), mark = paint(register, hazard(), 0.7, 0.1);
    frame.color.set(0x4a4f4a);
    const put = (m: THREE.Material, g: THREE.BufferGeometry) => cab.add(new THREE.Mesh(g, m));
    put(sheet, new THREE.BoxGeometry(W * 2, THICK * 2, half * 2));
    put(mark, new THREE.BoxGeometry(W * 2 - 0.1, 0.012, 0.16).translate(0, THICK + 0.008, half - 0.1));
    const posts: THREE.BufferGeometry[] = [];
    for (const [x, z] of [[-W + 0.05, -half + 0.05], [W - 0.05, -half + 0.05], [-W + 0.05, half - 0.05], [W - 0.05, half - 0.05]]) posts.push(new THREE.BoxGeometry(0.1, H, 0.1).translate(x, H / 2, z));
    for (const y of [1.1, H]) {
      for (const x of [-W + 0.05, W - 0.05]) posts.push(new THREE.BoxGeometry(0.06, 0.08, half * 2).translate(x, y, 0));
      posts.push(new THREE.BoxGeometry(W * 2, 0.08, 0.06).translate(0, y, -half + 0.05));
    }
    posts.push(new THREE.BoxGeometry(W * 2, 0.08, 0.06).translate(0, H, half - 0.05));
    posts.push(new THREE.BoxGeometry(W * 2, 0.14, 0.14).translate(0, H + 0.1, 0));
    for (let x = -W + 0.3; x < W - 0.1; x += 0.3) posts.push(new THREE.CylinderGeometry(0.008, 0.008, H - 1.15, 4).translate(x, (H + 1.1) / 2, -half + 0.05));
    for (const s of [-1, 1]) for (let z = -half + 0.3; z < half - 0.1; z += 0.3) posts.push(new THREE.CylinderGeometry(0.008, 0.008, H - 1.15, 4).translate(s * (W - 0.05), (H + 1.1) / 2, z));
    put(frame, mergeGeometries(posts.map((g) => (g.index ? g.toNonIndexed() : g)), false));
    const sides: THREE.BufferGeometry[] = [new THREE.BoxGeometry(W * 2 - 0.1, 1, 0.02).translate(0, 0.6, -half + 0.05)];
    for (const s of [-1, 1]) sides.push(new THREE.BoxGeometry(0.02, 1, half * 2 - 0.1).translate(s * (W - 0.05), 0.6, 0));
    put(sheet, mergeGeometries(sides.map((g) => g.toNonIndexed()), false));
    // (the ropes, up out of sight, and the sheave's guard over them)
    for (const x of [-0.16, 0.16]) put(frame, new THREE.CylinderGeometry(0.02, 0.02, 22, 6).translate(x, H + 11, 0));
    // (its lamp, and the pendant by the opening)
    const lit = new THREE.MeshBasicMaterial({ color: 0xffe6b4 });
    put(frame, new THREE.BoxGeometry(0.7, 0.05, 0.22).translate(0, H - 0.06, -0.4));
    put(lit, new THREE.BoxGeometry(0.62, 0.02, 0.15).translate(0, H - 0.095, -0.4));
    put(frame, new THREE.BoxGeometry(0.16, 0.3, 0.07).translate(W - 0.14, 1.32, half - 0.3));
    put(new THREE.MeshBasicMaterial({ color: 0x46d060 }), new THREE.SphereGeometry(0.02, 8, 6).translate(W - 0.14, 1.4, half - 0.26));
    put(new THREE.MeshBasicMaterial({ color: 0xd8402c }), new THREE.SphereGeometry(0.02, 8, 6).translate(W - 0.14, 1.3, half - 0.26));
    cab.rotation.y = P.rot;
    this.group.add(cab);
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
    this.cab.position.set(this.x, y, this.z);
    // (its lamp, while anybody is near enough to see it)
    this.lamp.set(this.x, y + 2.2, this.z);
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

