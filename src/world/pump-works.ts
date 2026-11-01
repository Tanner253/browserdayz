// Bolotnaya's works (the plan: "wheels turn, water drops"): each valve's wheel turns as it is worked, and with each one the settling tank beside the pump house drains by a third,
// down to what lay under the water. Its wall is stood over the swamp's water; a stair up its side, a ladder down inside. Nothing here is the server's: it reads how the site stands.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { physics } from '../core/physics';
import { BOLOTNAYA } from '../sim/outposts';
import { SITES } from '../sim/sites';
import { townPoint } from '../sim/towns';
import type { Atmosphere } from './atmosphere';
import type { Line } from './bunker-deep';

/** the tank: its middle in the town's frame, half its length and width, its floor and the top of its wall (over the swamp's water at 17.3), and the water full and drained */
export const TANK = { at: [-4, -15] as [number, number], hx: 5, hz: 3.4, floor: 17.5, top: 19.2, full: 18.9, low: 17.56 };

export class PumpWorks {
  /** the ladder out of the tank */
  readonly ladder: Line;
  private all = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private water: THREE.Mesh;
  private level: number = TANK.full;
  private dressed = false;
  private concrete: THREE.MeshStandardMaterial;
  private turning = new Map<number, number>();

  constructor(atmo: Atmosphere, scene: THREE.Scene) {
    const [cx, cz] = townPoint(BOLOTNAYA, TANK.at[0], TANK.at[1]), T = TANK, reg = (m: THREE.MeshStandardMaterial) => atmo.register(m) as THREE.MeshStandardMaterial;
    this.concrete = reg(new THREE.MeshStandardMaterial({ color: 0xb0b0a8, roughness: 0.9 }));
    const steel = reg(new THREE.MeshStandardMaterial({ color: 0x4a504b, roughness: 0.55, metalness: 0.6 }));
    const red = reg(new THREE.MeshStandardMaterial({ color: 0x9e2c22, roughness: 0.6, metalness: 0.3 }));
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material = this.concrete, solid = true) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), uv = g.getAttribute('uv'), p = g.getAttribute('position'), n = g.getAttribute('normal');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (Math.abs(n.getX(i)) > 0.5 ? p.getZ(i) : p.getX(i)) * (0.4 / 1) * ((x1 - x0) > 0 ? 1 : 1), (Math.abs(n.getY(i)) > 0.5 ? p.getZ(i) : p.getY(i)) * 0.4);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(cx + (x0 + x1) / 2, (y0 + y1) / 2, cz + (z0 + z1) / 2);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.all.add(mesh);
      if (solid) physics.addStatic(physics.R.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2), 'concrete', { x: cx + (x0 + x1) / 2, y: (y0 + y1) / 2, z: cz + (z0 + z1) / 2 }, 0);
    };
    const W = 0.3, foot = T.floor - 2.4;
    box(-T.hx, T.hx, foot, T.floor, -T.hz, T.hz);
    box(-T.hx - W, T.hx + W, foot, T.top, -T.hz - W, -T.hz);
    box(-T.hx - W, T.hx + W, foot, T.top, T.hz, T.hz + W);
    box(-T.hx - W, -T.hx, foot, T.top, -T.hz, T.hz);
    box(T.hx, T.hx + W, foot, T.top, -T.hz, T.hz);
    // (steps up its south side, on to the wall's walk, and a ladder down inside)
    const steps = 9, rise = (T.top - 17.3) / steps;
    for (let k = 0; k < steps; k++) box(-1, 1, 17.3 + k * rise - 0.5, 17.3 + (k + 1) * rise, T.hz + W + (steps - 1 - k) * 0.34, T.hz + W + (steps - k) * 0.34);
    const lx = cx - 0.6, lz = cz + T.hz - 0.05;
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, T.top - T.floor + 0.2, 0.04), steel);
      rail.position.set(lx + s * 0.24, (T.top + T.floor) / 2, lz - 0.05);
      this.all.add(rail);
    }
    for (let y = T.floor + 0.3; y < T.top; y += 0.3) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.03), steel);
      rung.position.set(lx, y, lz - 0.05);
      this.all.add(rung);
    }
    this.ladder = { x: lx, z: lz, nx: 0, nz: -1, y0: T.floor, y1: T.top + 0.05 };
    // (the water in it, dark: it comes down as the valves go)
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(T.hx * 2, T.hz * 2).rotateX(-Math.PI / 2), reg(new THREE.MeshStandardMaterial({ color: 0x1a2a22, roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.9 })));
    this.water.position.set(cx, T.full, cz);
    this.all.add(this.water);
    // (each valve's wheel, on its stand's own: it turns while the valve does)
    SITES.bolotnaya.steps!.at.forEach((at, k) => {
      const rot = [2.09, 2.94, 0.95][k], [x, z] = townPoint(BOLOTNAYA, at[0], at[1]), y = groundOf(x, z) + 0.98, wheel = new THREE.Mesh(wheelShape(), red);
      wheel.position.set(x + Math.sin(rot) * 0.42, y, z + Math.cos(rot) * 0.42);
      wheel.rotation.y = rot;
      this.wheels.push(wheel);
      this.all.add(wheel);
    });
    this.all.visible = false;
    scene.add(this.all);
  }

  /** Once a frame. @param done how many valves have been turned @param spent all of them, and the room is open */
  update(dt: number, eye: THREE.Vector3, done: number, spent: boolean) {
    const [cx, cz] = townPoint(BOLOTNAYA, TANK.at[0], TANK.at[1]), far = Math.hypot(eye.x - cx, eye.z - cz);
    this.all.visible = far < 130;
    if (far > 130) return;
    if (!this.dressed) {
      this.dressed = true;
      const t = assets.pbr('concrete_block_wall');
      this.concrete.color.set(0xffffff);
      this.concrete.map = t.map;
      this.concrete.normalMap = t.normalMap;
      this.concrete.needsUpdate = true;
    }
    const want = spent ? TANK.low : TANK.full + (TANK.low - TANK.full) * (done / 3);
    this.level += (want - this.level) * Math.min(1, dt * 0.25);
    this.water.position.y = this.level;
    this.wheels.forEach((w, k) => {
      // (turned once and for all: it spins down over a few seconds from when its valve went)
      const on = k < done;
      const left = this.turning.get(k) ?? (on ? 5 : 0);
      if (on && left > 0) {
        w.rotateZ(dt * 4 * Math.min(1, left));
        this.turning.set(k, left - dt);
      }
      if (!on) this.turning.delete(k);
    });
  }
}

function wheelShape() {
  const g = new THREE.TorusGeometry(0.31, 0.022, 8, 24), a = new THREE.BoxGeometry(0.6, 0.03, 0.02), b = new THREE.BoxGeometry(0.03, 0.6, 0.02), h = new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10).rotateX(Math.PI / 2);
  const parts = [g, a, b, h].map((q) => (q.index ? q.toNonIndexed() : q));
  const total = parts.reduce((n, q) => n + q.getAttribute('position').count, 0), pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  let at = 0;
  for (const q of parts) {
    pos.set(q.getAttribute('position').array as Float32Array, at * 3);
    nor.set(q.getAttribute('normal').array as Float32Array, at * 3);
    at += q.getAttribute('position').count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/** how high the ground is at a point, told by the game when it has the map */
let groundOf: (x: number, z: number) => number = () => 17;
export const pumpGround = (at: (x: number, z: number) => number) => void (groundOf = at);
