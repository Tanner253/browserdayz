// Inside the Kupol's dome (the plan: "go inside, dish turns when breakers go, floodlights"). The model is the shell; all this is drawn inside it when the eye is near: a stair up from its
// door over the slope it stands on, the control floor, a ladder through a hatch, and under the dome itself the dish on its pedestal. When the last breaker goes the dish comes round,
// and each breaker lights a floodlight in the yard. What is walked is what stands here: the dome's own box is not solid (src/world/vegetation.ts), this ring of wall is.
// A hatchway on the west side of the deck lets out on to the catwalk round the dome, the highest place to stand for kilometres, and there is nowhere to go from it but back in.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../core/assets';
import { GLASS_GROUPS, physics } from '../core/physics';
import { inMetres } from './bunker';
import type { Atmosphere } from './atmosphere';
import type { Line } from './bunker-deep';

/** where it all is: its middle, how high its tower's foot, its control floor and roof, the floor under the dome and the dome's radius; the door's half width */
export const DOME = { x: 720, z: -540, foot: 212.9, door: 217.6, floor: 221.6, roof: 224.1, deck: 224.4, r: 5.3, inner: 7, half: 1 };
/** the catwalk: how far out it reaches, the height of its rail, and the hatchway on to it, where it is round the dome (from +z, as the ring of wall is told), its half width and height */
const WALK = { out: 8.7, rail: 1.05, at: -Math.PI / 2, half: 0.62, high: 2.15 };
/** the floodlights, one to a breaker: where each stands over the yard */
const FLOODS: [number, number, number][] = [[708, 225, -548], [732, 225, -552], [720, 226, -518]];

export class KupolInside {
  /** its ladder, as src/game/building/ladders.ts takes it */
  readonly ladder: Line;
  private all = new THREE.Group();
  /** what is seen from outside: the catwalk */
  private outer = new THREE.Group();
  private dish = new THREE.Group();
  private fill = new THREE.AmbientLight(0xfff0dc, 0);
  private lamps: { pos: THREE.Vector3; on: THREE.MeshBasicMaterial }[] = [];
  private spin = 0;
  private dressed = false;
  private wall: THREE.MeshStandardMaterial;
  private plain: THREE.MeshStandardMaterial;

  constructor(atmo: Atmosphere, scene: THREE.Scene) {
    const D = DOME, reg = (m: THREE.MeshStandardMaterial) => atmo.register(m) as THREE.MeshStandardMaterial;
    this.wall = reg(new THREE.MeshStandardMaterial({ color: 0xc8c8c4, roughness: 0.9, side: THREE.BackSide }));
    this.plain = reg(new THREE.MeshStandardMaterial({ color: 0xc8c8c4, roughness: 0.9 }));
    const steel = reg(new THREE.MeshStandardMaterial({ color: 0x4c524e, roughness: 0.55, metalness: 0.6 }));
    const skin = reg(new THREE.MeshStandardMaterial({ color: 0xc9cdc9, roughness: 0.8, flatShading: true, side: THREE.BackSide }));
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x = D.x, y = 0, z = D.z) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.receiveShadow = true;
      this.all.add(mesh);
      return mesh;
    };
    const solid = (hx: number, hy: number, hz: number, x: number, y: number, z: number, rot = 0, surface: 'concrete' | 'metal' = 'concrete') => physics.addStatic(physics.R.ColliderDesc.cuboid(hx, hy, hz), surface, { x, y, z }, rot);
    // (the tower's wall, a ring of boxes, the door left out of it on the north; what the wall looks like from inside)
    const n = 40;
    for (let k = 0; k < n; k++) {
      const a = ((k + 0.5) / n) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
      if (Math.abs(Math.atan2(s, -c)) < 0.2 && false) continue;
      const north = Math.abs(a - Math.PI) < 0.24, x = D.x + s * (D.r + 0.3), z = D.z + c * (D.r + 0.3), hw = ((D.r + 0.6) * Math.PI) / n + 0.02;
      if (north) {
        // (over the door only)
        solid(hw, (D.roof - D.door - 3) / 2, 0.3, x, D.door + 3 + (D.roof - D.door - 3) / 2, z, a);
        continue;
      }
      solid(hw, (D.roof - D.foot) / 2, 0.3, x, (D.foot + D.roof) / 2, z, a);
    }
    const tall = D.roof - D.door, round = new THREE.CylinderGeometry(D.r, D.r, tall, 44, 1, true).translate(0, D.door + tall / 2, 0);
    const uv = round.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 10, uv.getY(i) * 2);
    add(round, this.wall);
    // (the control floor over the slope, with the stairwell cut out of it; the roof over it, the hatch cut out of that)
    const disc = (r: number, hole: [number, number, number, number]) => {
      const s = new THREE.Shape();
      s.absarc(0, 0, r, 0, Math.PI * 2, false);
      const h = new THREE.Path(), [x0, x1, z0, z1] = hole;
      h.moveTo(x0, z0);
      h.lineTo(x0, z1);
      h.lineTo(x1, z1);
      h.lineTo(x1, z0);
      h.closePath();
      s.holes.push(h);
      const g = new THREE.ShapeGeometry(s, 44).rotateX(Math.PI / 2);
      const p = g.getAttribute('position'), q = g.getAttribute('uv');
      for (let i = 0; i < p.count; i++) q.setXY(i, p.getX(i) / 2.5, p.getZ(i) / 2.5);
      return g;
    };
    const well: [number, number, number, number] = [-1, 1, -5.3, 0.3], hatch: [number, number, number, number] = [3.2, 4.4, -0.6, 0.6];
    add(disc(D.r, well), this.plainFloor(reg), D.x, D.floor);
    const lid = disc(D.r, hatch);
    add(lid, this.plain, D.x, D.roof);
    add(disc(D.inner, hatch).rotateX(Math.PI), steel, D.x, D.deck);
    for (const [hx, cx, hz, cz] of [[(D.r - 1) / 2, -(D.r + 1) / 2, D.r, 0], [(D.r - 1) / 2, (D.r + 1) / 2, D.r, 0], [1, 0, (D.r - 0.3) / 2, (D.r + 0.3) / 2]]) solid(hx, 0.2, hz, D.x + cx, D.floor - 0.2, D.z + cz);
    // (the deck of steel under the dome, round its hatch)
    for (const [hx, cx, hz, cz] of [[(D.inner + 3.2) / 2, (3.2 - D.inner) / 2, D.inner, 0], [(D.inner - 4.4) / 2, (D.inner + 4.4) / 2, D.inner, 0], [0.6, 3.8, (D.inner - 0.6) / 2, (D.inner + 0.6) / 2], [0.6, 3.8, (D.inner - 0.6) / 2, -(D.inner + 0.6) / 2]]) solid(hx, 0.15, hz, D.x + cx, D.deck - 0.15, D.z + cz, 0, 'metal');
    // (the stair up from the door over the slope)
    const steps = 21, run = 5.6, z0 = D.z - 5.3;
    for (let k = 0; k < steps; k++) add(new THREE.BoxGeometry(2, 0.05, run / steps + 0.03), steel, D.x, D.door + ((k + 1) * (D.floor - D.door)) / steps - 0.025, z0 + ((k + 0.5) * run) / steps);
    const ramp = [[-1, D.door - 0.3, z0], [1, D.door - 0.3, z0], [-1, D.floor - 0.3, z0 + run], [1, D.floor - 0.3, z0 + run], [-1, D.door, z0], [1, D.door, z0], [-1, D.floor, z0 + run], [1, D.floor, z0 + run]].map(([x, y, z]) => [D.x + x, y, z]);
    physics.addStatic(physics.R.ColliderDesc.convexHull(new Float32Array(ramp.flat()))!, 'metal', { x: 0, y: 0, z: 0 }, 0);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.06, D.floor - D.door + 1, run + 0.1), steel, D.x + s * 1.03, (D.door + D.floor) / 2 + 0.4, z0 + run / 2);
      solid(0.05, (D.floor - D.door + 2) / 2, run / 2, D.x + s * 1.03, (D.door + D.floor) / 2 + 0.5, z0 + run / 2, 0, 'metal');
    }
    // (the ladder through the hatch, leaning on its far edge)
    const lx = D.x + 4.36, top = D.deck + 0.05;
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.04, top - D.floor, 0.04), steel, lx - 0.05, (D.floor + top) / 2, D.z + s * 0.24);
    for (let y = D.floor + 0.3; y < top - 0.1; y += 0.3) add(new THREE.BoxGeometry(0.03, 0.03, 0.5), steel, lx - 0.05, y, D.z);
    this.ladder = { x: lx, z: D.z, nx: -1, nz: 0, y0: D.floor, y1: top };
    // (the dome from inside, its panels flat as they are from outside; the wall that keeps a body on the deck)
    // (the panels where the hatchway goes through it are left out)
    const sn = Math.sin(WALK.at), cs = Math.cos(WALK.at), ball = new THREE.IcosahedronGeometry(D.inner, 3), pts = ball.getAttribute('position'), kept: number[] = [];
    for (let i = 0; i < pts.count; i += 3) {
      const mx = (pts.getX(i) + pts.getX(i + 1) + pts.getX(i + 2)) / 3, my = (pts.getY(i) + pts.getY(i + 1) + pts.getY(i + 2)) / 3, mz = (pts.getZ(i) + pts.getZ(i + 1) + pts.getZ(i + 2)) / 3;
      if (mx * sn + mz * cs > 0 && Math.abs(mx * cs - mz * sn) < WALK.half + 0.3 && my + 3.4 < WALK.high + 0.3) continue;
      for (let j = 0; j < 3; j++) kept.push(pts.getX(i + j), pts.getY(i + j), pts.getZ(i + j));
    }
    const shell = new THREE.BufferGeometry();
    shell.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
    shell.computeVertexNormals();
    add(shell, skin, D.x, D.deck + 3.4);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      if (Math.abs(Math.sin((a - WALK.at) / 2)) < 0.02) continue;
      solid(1, 2, 0.15, D.x + Math.sin(a) * (D.inner - 0.3), D.deck + 2, D.z + Math.cos(a) * (D.inner - 0.3), a, 'metal');
    }
    // (the hatchway: a short tunnel of steel through the dome's skin, a body's width, and a plate round each end of it)
    const at = (r: number, side: number, y: number) => new THREE.Vector3(D.x + sn * r + cs * side, y, D.z + cs * r - sn * side);
    const plate = (r0: number, r1: number, s0: number, s1: number, y0: number, y1: number, into: THREE.BufferGeometry[]) => {
      const c = at((r0 + r1) / 2, (s0 + s1) / 2, (y0 + y1) / 2);
      into.push(new THREE.BoxGeometry(s1 - s0, y1 - y0, r1 - r0).rotateY(WALK.at).translate(c.x, c.y, c.z));
    };
    const frame: THREE.BufferGeometry[] = [], Hw = WALK.half, Y0 = D.deck, Y1 = D.deck + WALK.high;
    for (const s of [-1, 1]) {
      plate(6.5, 7.75, s * Hw, s * (Hw + 0.08), Y0, Y1 + 0.08, frame);
      for (const r of [6.5, 7.75]) plate(r, r + 0.04, s * Hw, s * (Hw + 0.34), Y0, Y1 + 0.34, frame);
      solid(0.65, 1.2, 0.04, ...(at(7.1, s * (Hw + 0.04), D.deck + 1.2).toArray() as [number, number, number]), WALK.at + Math.PI / 2, 'metal');
      // (the ring of wall takes up again on either side of it, and nobody gets between the walk and the dome's skin)
      solid(0.22, 2, 0.15, ...(at(6.7, s * 0.84, D.deck + 2).toArray() as [number, number, number]), WALK.at, 'metal');
      solid(0.3, 1.5, 0.05, ...(at(7.25, s * 0.92, D.deck + 1.5).toArray() as [number, number, number]), WALK.at, 'metal');
    }
    plate(6.5, 7.75, -Hw - 0.08, Hw + 0.08, Y1, Y1 + 0.08, frame);
    for (const r of [6.5, 7.75]) plate(r, r + 0.04, -Hw - 0.34, Hw + 0.34, Y1, Y1 + 0.34, frame);
    const door = new THREE.Mesh(mergeGeometries(frame, false), steel);
    door.matrixAutoUpdate = false;
    this.outer.add(door);
    solid(Hw + 0.1, 0.2, 0.62, ...(at(7.12, 0, Y1 + 0.2).toArray() as [number, number, number]), WALK.at, 'metal');
    // (the walk itself, of steel on brackets, round the whole of the dome; its rail stops a body and lets a shot by)
    const n2 = 40, walk: THREE.BufferGeometry[] = [], inner = D.inner - 0.1, mid = (inner + WALK.out) / 2, wide = (WALK.out - inner) / 2, R = WALK.out - 0.04;
    const flat = new THREE.RingGeometry(inner, WALK.out, 64, 1).rotateX(-Math.PI / 2);
    const under = new THREE.RingGeometry(inner, WALK.out, 64, 1).rotateX(Math.PI / 2).translate(0, -0.08, 0);
    const lip = new THREE.CylinderGeometry(WALK.out, WALK.out, 0.08, 64, 1, true).translate(0, -0.04, 0);
    walk.push(flat, under, lip);
    for (const y of [0.55, WALK.rail]) walk.push(new THREE.TorusGeometry(R, 0.024, 6, 72).rotateX(Math.PI / 2).translate(0, y, 0));
    for (let k = 0; k < n2; k++) {
      const a = (k / n2) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      walk.push(new THREE.CylinderGeometry(0.02, 0.02, WALK.rail, 6).translate(s * R, WALK.rail / 2, c * R));
      if (k % 2) continue;
      // (a bracket back to the collar under it)
      const from = new THREE.Vector3(s * 7.3, -1.2, c * 7.3), to = new THREE.Vector3(s * (R - 0.1), -0.06, c * (R - 0.1)), len = from.distanceTo(to);
      const arm = new THREE.CylinderGeometry(0.035, 0.035, len, 6);
      arm.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
      arm.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
      walk.push(arm);
    }
    const parts = walk.map((g) => {
      const q = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k);
      return q;
    });
    const ring = new THREE.Mesh(mergeGeometries(parts, false), reg(new THREE.MeshStandardMaterial({ color: 0x565c58, roughness: 0.6, metalness: 0.45, side: THREE.DoubleSide })));
    ring.position.set(D.x, D.deck, D.z);
    ring.updateMatrix();
    ring.matrixAutoUpdate = false;
    ring.castShadow = ring.receiveShadow = true;
    this.outer.add(ring);
    scene.add(this.outer);
    for (let k = 0; k < n2; k++) {
      const a = ((k + 0.5) / n2) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a), half = (Math.PI * R) / n2 + 0.08;
      solid(half, 0.08, wide, D.x + s * mid, D.deck - 0.08, D.z + c * mid, a, 'metal');
      // (the dome's model stops nothing: this does, at its skin, but for the hatchway)
      if (Math.abs(Math.sin((a - WALK.at) / 2)) > 0.09) solid(half, 1.5, 0.05, D.x + s * 7.25, D.deck + 1.5, D.z + c * 7.25, a, 'metal');
      const turn = a / 2;
      physics.addStaticQuat(physics.R.ColliderDesc.cuboid(half, 0.7, 0.04), 'metal', { x: D.x + s * R, y: D.deck + 0.7, z: D.z + c * R }, { x: 0, y: Math.sin(turn), z: 0, w: Math.cos(turn) }, undefined, GLASS_GROUPS);
    }
    // (the dish, on its pedestal: it is the model that turns)
    this.dish.position.set(D.x, D.deck, D.z);
    this.all.add(this.dish);
    void assets.model('radar_dish').then((m) => {
      m.updateMatrixWorld(true);
      const kept = new Map<THREE.Material, THREE.MeshStandardMaterial>();
      m.traverse((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh) return;
        const from = src.material as THREE.MeshStandardMaterial;
        if (!kept.has(from)) kept.set(from, reg(Object.assign(from.clone() as THREE.MeshStandardMaterial, { metalness: 0.3, roughness: 0.65 })));
        this.dish.add(new THREE.Mesh(inMetres(src), kept.get(from)!));
      });
    }).catch(() => {});
    solid(1.1, 2, 1.1, D.x, D.deck + 2, D.z, 0, 'metal');
    // (the floodlights: a head on a mast, dark until its breaker goes)
    for (const [x, y, z] of FLOODS) {
      const on = new THREE.MeshBasicMaterial({ color: 0x1a1a18 });
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.3), on), back = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.2), steel);
      head.position.set(x, y, z);
      back.position.set(x, y, z - Math.sign(z - D.z) * 0.2);
      head.lookAt(D.x, D.floor, D.z);
      back.lookAt(D.x, D.floor, D.z);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, y - 212, 8), steel);
      mast.position.set(x, 212 + (y - 212) / 2, z);
      scene.add(head, back, mast);
      this.lamps.push({ pos: new THREE.Vector3(x, y - 1, z), on });
    }
    this.all.visible = false;
    scene.add(this.all, this.fill);
  }

  private floorMat: THREE.MeshStandardMaterial | null = null;
  private plainFloor(reg: (m: THREE.MeshStandardMaterial) => THREE.MeshStandardMaterial) {
    return (this.floorMat ??= reg(new THREE.MeshStandardMaterial({ color: 0xc8c8c4, roughness: 0.85, side: THREE.DoubleSide })));
  }

  /** Once a frame. @param done how many breakers have been thrown @param spent they all have */
  update(dt: number, eye: THREE.Vector3, done: number, spent: boolean, lit: (pos: THREE.Vector3, burn: number, far: number) => void) {
    const D = DOME, far = Math.hypot(eye.x - D.x, eye.z - D.z);
    this.all.visible = far < 45;
    this.outer.visible = far < 500;
    if (far > 200) return;
    this.lamps.forEach((l, k) => {
      const on = k < done;
      l.on.color.set(on ? 0xfff2d0 : 0x1a1a18);
      if (on) lit(l.pos, 1, 34);
    });
    if (far > 45) return;
    if (!this.dressed) {
      this.dressed = true;
      const dress = (m: THREE.MeshStandardMaterial, id: string) => {
        const t = assets.pbr(id);
        m.color.set(0xffffff);
        m.map = t.map;
        m.normalMap = t.normalMap;
        m.roughnessMap = t.armMap;
        m.needsUpdate = true;
      };
      dress(this.wall, 'concrete_block_wall');
      dress(this.plain, 'white_rough_plaster');
      if (this.floorMat) dress(this.floorMat, 'anti_slip_concrete');
    }
    const inside = far < D.inner && eye.y > D.door && eye.y < D.deck + 11;
    this.fill.intensity += ((inside ? 0.34 : 0) - this.fill.intensity) * Math.min(1, dt * 3);
    if (inside) lit(new THREE.Vector3(D.x + 1, eye.y > D.deck ? D.deck + 8 : D.roof - 0.3, D.z - 1), 1, 14);
    // (it comes round when the last breaker goes, slowly, as a thing of that weight does)
    this.spin += ((spent ? 0.35 : 0) - this.spin) * Math.min(1, dt * 0.4);
    this.dish.rotation.y += this.spin * dt;
  }
}
