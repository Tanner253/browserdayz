// The bolt-hole's hatch, in the floor of the cellar beside the camp's far barracks (src/sim/bunker-wings.ts). It is on one circuit with the blast door: open that with a keycard and
// the bolts draw here too, and they shoot home together. So whoever opens the front door opens the back for anybody waiting down here. From under it the wheel always turns:
// nobody is shut in. Its lamp says how it stands.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { audio } from '../core/audio';
import { WORLD_GROUPS, physics } from '../core/physics';
import { bunkerAt, bunkerLocal, levelY, type Place } from '../sim/bunker';
import { BOLT, HALL_DEEP } from '../sim/bunker-wings';

const TILT = 1.9;

export class BoltHole {
  private group = new THREE.Group();
  private hinge = new THREE.Group();
  private body;
  private lamp: THREE.MeshBasicMaterial;
  private up = 0;
  private was = false;
  private at = new THREE.Vector3();
  /** the two ladders, as src/game/building/ladders.ts takes them: the one under the hatch, and the one from the cellar to the barracks */
  readonly lines: { x: number; z: number; nx: number; nz: number; y0: number; y1: number }[];

  /** @param H the hatch; @param Y the floor it lies in; @param ladders the ladders of it to give the game */
  constructor(scene: THREE.Scene, private P: Place, steel: THREE.Material, private H: { r: number; f: number; half: number } = BOLT.hatch, private Y = levelY(1), ladders = true) {
    const [x, y, z] = bunkerAt(P, H.r, H.f - H.half, Y), [cx, cy, cz] = bunkerAt(P, H.r, H.f, Y - 0.04), turn = P.rot / 2;
    this.hinge.position.set(x, y, z);
    this.hinge.rotation.y = P.rot;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(H.half * 2, 0.08, H.half * 2), steel);
    plate.position.set(0, -0.04, H.half);
    // (the owner, 2026-11-01: "the ladders stairs and hatches also need love": ribs across the lid, a hand wheel with its spokes and hub, hinges, and a painted frame set in the floor round it)
    const yellow = new THREE.MeshStandardMaterial({ color: 0xc69a1f, roughness: 0.7, metalness: 0.1 });
    const parts: THREE.BufferGeometry[] = [];
    for (const k of [-0.6, 0.6]) {
      parts.push(new THREE.BoxGeometry(H.half * 2 - 0.1, 0.03, 0.05).translate(0, 0.015, H.half * (1 + k)));
      parts.push(new THREE.BoxGeometry(0.05, 0.03, H.half * 2 - 0.1).translate(H.half * k, 0.015, H.half));
    }
    parts.push(new THREE.CylinderGeometry(0.05, 0.06, 0.06, 12).translate(0, 0.05, H.half));
    for (let a = 0; a < 3; a++) parts.push(new THREE.BoxGeometry(0.38, 0.016, 0.022).rotateY((a * Math.PI) / 3).translate(0, 0.06, H.half));
    for (const k of [-0.7, 0.7]) parts.push(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8).rotateZ(Math.PI / 2).translate(H.half * k, 0.01, 0));
    const ribs = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false), steel);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 8, 18), steel);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(0, 0.06, H.half);
    this.hinge.add(plate, ribs, wheel);
    this.group.add(this.hinge);
    const rim: THREE.BufferGeometry[] = [], R = H.half + 0.12;
    for (const [w, d, ox, oz] of [[R * 2, 0.12, 0, -H.half - 0.06], [R * 2, 0.12, 0, H.half + 0.06], [0.12, R * 2, -H.half - 0.06, 0], [0.12, R * 2, H.half + 0.06, 0]]) rim.push(new THREE.BoxGeometry(w, 0.024, d).translate(ox, 0.012, oz));
    const frame = new THREE.Mesh(mergeGeometries(rim.map((g) => g.toNonIndexed()), false), yellow);
    const [fx, fy, fz] = bunkerAt(P, H.r, H.f, Y);
    frame.position.set(fx, fy, fz);
    frame.rotation.y = P.rot;
    this.group.add(frame);
    this.lamp = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), this.lamp), [lx, ly, lz] = bunkerAt(P, H.r - H.half - 0.25, H.f - H.half - 0.2, Y + 0.5);
    dot.position.set(lx, ly, lz);
    this.group.add(dot);
    this.body = physics.world.createCollider(physics.R.ColliderDesc.cuboid(H.half, 0.04, H.half).setTranslation(cx, cy, cz).setRotation({ x: 0, y: Math.sin(turn), z: 0, w: Math.cos(turn) }).setCollisionGroups(WORLD_GROUPS).setSolverGroups(WORLD_GROUPS));
    physics.tag(this.body, { surface: 'metal' });
    this.group.visible = false;
    scene.add(this.group);
    const [rx, , rz] = bunkerAt(P, H.r, H.f + H.half - 0.14, 0), W = BOLT.trap, [tx, , tz] = bunkerAt(P, W.r, W.f + W.half - 0.14, 0), n = Math.sin(P.rot), c = Math.cos(P.rot);
    this.lines = !ladders ? [] : [{ x: rx, z: rz, nx: -n, nz: -c, y0: P.y + Y - HALL_DEEP, y1: P.y + Y + 0.05 }, { x: tx, z: tz, nx: -n, nz: -c, y0: P.y + Y, y1: P.y + Y + W.high + 0.05 }];
  }

  /** Once a frame. @param open the blast door stands open, or the wheel has been turned from below */
  update(dt: number, open: boolean, eye: THREE.Vector3) {
    const far = this.group.position.distanceTo(eye), [hx, hy, hz] = bunkerAt(this.P, this.H.r, this.H.f, this.Y), d = Math.hypot(hx - eye.x, hy - eye.y, hz - eye.z);
    void far;
    this.group.visible = d < 40;
    if (open !== this.was) {
      this.was = open;
      this.lamp.color.set(open ? 0x35ff6a : 0xff2a1a);
      // (the bolts, heard in the cellar and the drift and nowhere else)
      if (d < 9) audio.lightGate(this.at.set(hx, hy, hz), d, open);
    }
    this.up = THREE.MathUtils.clamp(this.up + (open ? dt : -dt) / 1.3, 0, 1);
    this.hinge.rotation.x = -this.up * TILT;
    this.body.setEnabled(this.up < 0.5);
  }

  /** what is said to whoever stands over it in the cellar */
  note(p: { x: number; y: number; z: number }, open: boolean) {
    const [r, f, h] = bunkerLocal(this.P, p.x, p.y, p.z);
    if (open || Math.hypot(r - this.H.r, f - this.H.f) > 1.6 || Math.abs(h - this.Y) > 1.5) return null;
    return '<small>Bolted from below. The lamp goes green when the blast door opens</small>';
  }
}
