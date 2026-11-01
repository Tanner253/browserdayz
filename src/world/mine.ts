// The Old Mine as it is built (src/sim/mine.ts for what and where): rough rock round its incline, its drift, its galleries and its hoist room, one mesh for all of it, with plain
// boxes behind that surface to stop a body, and a post for each timber set. It lies in the plateau: drawn with the eye in it or at either portal. The rock is pushed outward from
// the room the plan gives, never in, so what is walked is what the plan says. Each portal has a gate of bars on hinges, that opens with the yellow pass and to a hand from inside.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { physics } from '../core/physics';
import { noise3 } from './cave-carve';
import type { Atmosphere } from './atmosphere';
import { concretePaint, painted } from './bunker';
import { audio } from '../core/audio';
import { MINE, inMine, mineFloor } from '../sim/mine';

/** how far the rock lies out from the plan at most, metres; the cell of its surface; and how often a lamp hangs */
const ROUGH = 0.5, CELL = 0.9, LAMP_EVERY = 13;
/** a lamp's painted pool: how far it reaches, metres, and how strongly it is laid on */
const POOL = 9, GLOW = 2.4;

/** a stretch of rock, from one corner to the other, its inside to `n` (bumped away from it) */
function face(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, n: THREE.Vector3): THREE.BufferGeometry {
  const w = a.distanceTo(b), h = a.distanceTo(c), nw = Math.max(1, Math.round(w / CELL)), nh = Math.max(1, Math.round(h / CELL));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], p = new THREE.Vector3();
  for (let j = 0; j <= nh; j++) for (let i = 0; i <= nw; i++) {
    p.copy(a).lerp(b, i / nw).addScaledVector(c.clone().sub(a), j / nh);
    // (nothing at its edges: there it meets the next face, and a seam there let the sky in)
    const edge = Math.min(1, Math.min(i, nw - i, j, nh - j) / 2);
    const bump = (noise3(p.x * 0.33, p.y * 0.33, p.z * 0.33) * 0.7 + noise3(p.x * 0.9, p.y * 0.9, p.z * 0.9) * 0.3 + 0.5) * ROUGH * edge;
    p.addScaledVector(n, -Math.max(0, bump));
    pos.push(p.x, p.y, p.z);
    uv.push((i / nw) * w * 0.25, (j / nh) * h * 0.25);
  }
  for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
    const q = i + j * (nw + 1), r = q + 1, s = q + nw + 1, t = s + 1;
    idx.push(q, t, r, q, s, t);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class MineSite {
  private all = new THREE.Group();
  private lamps: { pos: THREE.Vector3; k: number }[] = [];
  private gates: { hinge: THREE.Group; way: number; body: ReturnType<typeof physics.addStatic>; at: THREE.Vector3; swing: number; wide: boolean }[] = [];
  private gated = new THREE.Group();
  private clock = 0;

  constructor(atmo: Atmosphere, scene: THREE.Scene) {
    const M = MINE, Y0 = M.y, Y1 = M.y + M.tall, Z = M.z, H = M.hall, parts: THREE.BufferGeometry[] = [];
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => physics.addStatic(physics.R.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2), 'rock', { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 }, 0);
    /** a room of it, walls on the sides asked for (a side left out is open to the next) */
    const room = (x0: number, x1: number, z0: number, z1: number, tall: number, sides: { n?: [number, number][]; s?: [number, number][]; w?: boolean; e?: boolean }) => {
      const top = Y0 + tall;
      parts.push(face(v(x0, Y0, z0), v(x1, Y0, z0), v(x0, Y0, z1), v(0, 1, 0)), face(v(x0, top, z1), v(x1, top, z1), v(x0, top, z0), v(0, -1, 0)));
      box(x0, x1, Y0 - 1, Y0, z0 - 1, z1 + 1);
      box(x0, x1, top, top + 1, z0 - 1, z1 + 1);
      for (const [a, b] of sides.n ?? []) {
        parts.push(face(v(b, Y0, z0), v(a, Y0, z0), v(b, top, z0), v(0, 0, 1)));
        box(a, b, Y0, top, z0 - 1, z0);
      }
      for (const [a, b] of sides.s ?? []) {
        parts.push(face(v(a, Y0, z1), v(b, Y0, z1), v(a, top, z1), v(0, 0, -1)));
        box(a, b, Y0, top, z1, z1 + 1);
      }
      if (sides.w) {
        parts.push(face(v(x0, Y0, z0), v(x0, Y0, z1), v(x0, top, z0), v(1, 0, 0)));
        box(x0 - 1, x0, Y0, top, z0, z1);
      }
      if (sides.e) {
        parts.push(face(v(x1, Y0, z1), v(x1, Y0, z0), v(x1, top, z1), v(-1, 0, 0)));
        box(x1, x1 + 1, Y0, top, z0, z1);
      }
    };
    const h0 = H.x - H.hx, h1 = H.x + H.hx, z0 = Z - M.half, z1 = Z + M.half, Fall = M.fall, f0 = Fall.x - Fall.half, f1 = Fall.x + Fall.half;
    /** a wall along the way from x a to x b, cut where a gallery leaves it on this side */
    const cut = (a: number, b: number, side: number): [number, number][] => {
      const out: [number, number][] = [];
      let at = a;
      for (const g of M.galleries.filter((q) => q.side === side && q.x > a && q.x < b).sort((p, q) => p.x - q.x)) {
        out.push([at, g.x - g.half]);
        at = g.x + g.half;
      }
      out.push([at, b]);
      return out;
    };
    // (the drift west of the fall, the fall, on to the hoist room, and on to the east portal)
    room(M.x0, f0, z0, z1, M.tall, { n: cut(M.x0, f0, -1), s: cut(M.x0, f0, 1) });
    room(f0, f1, z0, z1, Fall.tall, { n: [[f0, f1]], s: [[f0, f1]] });
    room(f1, h0, z0, z1, M.tall, { n: cut(f1, h0, -1), s: cut(f1, h0, 1) });
    room(h1, M.east.x, z0, z1, M.tall, { n: cut(h1, M.east.x, -1), s: cut(h1, M.east.x, 1) });
    room(h0, h1, Z - H.hz, Z + H.hz, M.tall + 1.4, { n: [[h0, h1]], s: [[h0, h1]] });
    // (the fall's two faces, from the top of the way under it to the drift's roof)
    for (const [x, n] of [[f0, -1], [f1, 1]] as const) {
      parts.push(n < 0 ? face(v(x, Y0 + Fall.tall, z0), v(x, Y0 + Fall.tall, z1), v(x, Y1, z0), v(-1, 0, 0)) : face(v(x, Y0 + Fall.tall, z1), v(x, Y0 + Fall.tall, z0), v(x, Y1, z1), v(1, 0, 0)));
      box(x - (n < 0 ? 0 : 0), x + 0.01, Y0 + Fall.tall, Y1, z0, z1);
    }
    box(f0, f1, Y0 + Fall.tall, Y1, z0, z1);
    // (the galleries, each a blind end)
    for (const g of M.galleries) {
      const a0 = g.side > 0 ? z1 : z0 - g.long, a1 = g.side > 0 ? z1 + g.long : z0, end = g.side > 0 ? { s: [[g.x - g.half, g.x + g.half]] as [number, number][] } : { n: [[g.x - g.half, g.x + g.half]] as [number, number][] };
      room(g.x - g.half, g.x + g.half, a0, a1, M.tall, { ...end, w: true, e: true });
    }
    // (the incline, from the west portal up to the drift: four long faces, and what stops a body on each)
    {
      const x0 = M.west.x, x1 = M.x0, y0 = M.west.y, y1 = M.y, t = M.tall, c = (x: number, y: number, z: number) => [x, y, z];
      parts.push(face(v(x0, y0, z0), v(x1, y1, z0), v(x0, y0, z1), v(0, 1, 0)), face(v(x0, y0 + t, z1), v(x1, y1 + t, z1), v(x0, y0 + t, z0), v(0, -1, 0)));
      parts.push(face(v(x1, y1, z0), v(x0, y0, z0), v(x1, y1 + t, z0), v(0, 0, 1)), face(v(x0, y0, z1), v(x1, y1, z1), v(x0, y0 + t, z1), v(0, 0, -1)));
      for (const lift of [0, t]) {
        const low = lift ? 0 : -0.8, high = lift ? 0.8 : 0;
        const hull = [c(x0, y0 + lift + low, z0 - 1), c(x0, y0 + lift + low, z1 + 1), c(x1, y1 + lift + low, z0 - 1), c(x1, y1 + lift + low, z1 + 1), c(x0, y0 + lift + high, z0 - 1), c(x0, y0 + lift + high, z1 + 1), c(x1, y1 + lift + high, z0 - 1), c(x1, y1 + lift + high, z1 + 1)];
        physics.addStatic(physics.R.ColliderDesc.convexHull(new Float32Array(hull.flat()))!, lift ? 'rock' : 'rock', { x: 0, y: 0, z: 0 }, 0);
      }
      box(x0, x1, y0 - 1, y1 + t + 1, z0 - 1, z0);
      box(x0, x1, y0 - 1, y1 + t + 1, z1, z1 + 1);
    }
    // (the hoist room's two end walls, either side of the drift's mouth, and the lip over each mouth)
    for (const [x, side] of [[h0, 1], [h1, -1]] as const) {
      for (const [a, b] of [[Z - H.hz, z0], [z1, Z + H.hz]]) {
        const top = Y0 + M.tall + 1.4;
        parts.push(side > 0 ? face(v(x, Y0, a), v(x, Y0, b), v(x, top, a), v(1, 0, 0)) : face(v(x, Y0, b), v(x, Y0, a), v(x, top, b), v(-1, 0, 0)));
        box(x - (side > 0 ? 1 : 0), x + (side > 0 ? 0 : 1), Y0, top, a, b);
      }
      parts.push(side > 0 ? face(v(x, Y1, z0), v(x, Y1, z1), v(x, Y1 + 1.4, z0), v(1, 0, 0)) : face(v(x, Y1, z1), v(x, Y1, z0), v(x, Y1 + 1.4, z1), v(-1, 0, 0)));
    }
    // (lamps down the drift on a wire, one in the hoist room: each a bulb, and its pool of light painted once on a plan of the mine and laid over
    // the rock, as the bunker's is: only the few lamps nearest the eye are real lights, and those light what stands in the drift)
    const lamps: [number, number, number][] = [];
    for (let x = M.west.x + 6, k = 0; x < M.east.x - 2; x += LAMP_EVERY, k++) {
      if (Math.abs(x - Fall.x) < Fall.half + 0.6) continue;
      const y = mineFloor(x) + M.tall - 0.35 + (Math.abs(x - H.x) < H.hx ? 1.2 : 0);
      lamps.push([x, y, Z]);
      this.lamps.push({ pos: new THREE.Vector3(x, y, Z), k });
    }
    for (const g of M.galleries) {
      const z = Z + g.side * (M.half + g.long - 5);
      lamps.push([g.x, Y1 - 0.35, z]);
      this.lamps.push({ pos: new THREE.Vector3(g.x, Y1 - 0.35, z), k: this.lamps.length });
    }
    const X0 = M.west.x, span = M.east.x - X0, deep = 50, Nx = 2048, Nz = 256, Z0 = Z - deep / 2;
    const glow = painted(Nx, Nz, (g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, Nx, Nz);
      g.globalCompositeOperation = 'lighter';
      for (const [x, , z] of lamps) {
        const px = ((x - X0) / span) * Nx, r = (POOL / span) * Nx, grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
        grad.addColorStop(0, 'rgb(255, 214, 150)');
        grad.addColorStop(0.3, 'rgb(150, 116, 76)');
        grad.addColorStop(0.7, 'rgb(46, 34, 22)');
        grad.addColorStop(1, 'rgb(0, 0, 0)');
        g.save();
        g.translate(px, (1 - (z - Z0) / deep) * Nz);
        // (a plan of 280 m by 50: its pools are round in metres, not in pixels)
        g.scale(1, (Nz / deep) / (Nx / span));
        g.fillStyle = grad;
        g.fillRect(-r, -r, r * 2, r * 2);
        g.restore();
      }
    }, 1, false);
    glow.channel = 1;
    const map = concretePaint(3301, [96, 80, 64]);
    const rock = atmo.register(new THREE.MeshStandardMaterial({ map, roughness: 0.97, metalness: 0, lightMap: glow, lightMapIntensity: GLOW })) as THREE.MeshStandardMaterial;
    const merged = mergeGeometries(parts, false), at = merged.getAttribute('position'), plan = new Float32Array(at.count * 2);
    for (let i = 0; i < at.count; i++) {
      plan[i * 2] = (at.getX(i) - X0) / span;
      plan[i * 2 + 1] = (at.getZ(i) - Z0) / deep;
    }
    merged.setAttribute('uv1', new THREE.BufferAttribute(plan, 2));
    const walls = new THREE.Mesh(merged, rock);
    walls.receiveShadow = true;
    walls.matrixAutoUpdate = false;
    this.all.add(walls);

    // (the posts of the timber sets stop a body; the cap over them is out of reach)
    for (let x = M.west.x + 4; x < M.east.x - 2; x += M.sets) {
      if (Math.abs(x - H.x) < H.hx + 1 || Math.abs(x - Fall.x) < Fall.half + 1.2) continue;
      for (const s of [-1, 1]) physics.addStatic(physics.R.ColliderDesc.cuboid(0.16, 1.6, 0.16), 'wood', { x, y: mineFloor(x) + 1.6, z: Z + s * 1.48 }, 0);
    }
    // (the gates: two leaves of bars on hinges in each portal)
    const steel = atmo.register(new THREE.MeshStandardMaterial({ color: 0x3c3a36, roughness: 0.6, metalness: 0.5 })) as THREE.MeshStandardMaterial;
    for (const [x, side] of [[M.west.x + 0.2, 1], [M.east.x - 0.2, -1]] as const) {
      const y = mineFloor(x), at = new THREE.Vector3(x, y + 1.2, Z);
      for (const s of [-1, 1]) {
        const hinge = new THREE.Group(), w = M.half - 0.02, h = M.tall - 0.1, bars: THREE.BufferGeometry[] = [];
        hinge.position.set(x, y, Z + s * M.half);
        for (let k = 0.14; k < w; k += 0.2) bars.push(new THREE.CylinderGeometry(0.018, 0.018, h, 6).translate(0, h / 2, -s * k));
        for (const b of [0.2, 1.3, h - 0.2]) bars.push(new THREE.BoxGeometry(0.05, 0.07, w).translate(0, b, (-s * w) / 2));
        for (const q of [-s * 0.04, -s * (w - 0.04)]) bars.push(new THREE.BoxGeometry(0.05, h, 0.06).translate(0, h / 2, q));
        hinge.add(new THREE.Mesh(mergeGeometries(bars.map((g) => (g.index ? g.toNonIndexed() : g)), false), steel));
        this.gates.push({ hinge, way: s * side, body: physics.addStatic(physics.R.ColliderDesc.cuboid(0.05, h / 2, w / 2), 'metal', { x, y: y + h / 2, z: Z + s * (M.half - w / 2) }, 0), at, swing: 0, wide: false });
        this.gated.add(hinge);
      }
    }
    scene.add(this.gated);
    const bulb = atmo.register(new THREE.MeshStandardMaterial({ color: 0x2a2a26, emissive: new THREE.Color(1, 0.8, 0.5), emissiveIntensity: 3, roughness: 0.5 }));
    const bulbs: THREE.BufferGeometry[] = [];
    for (const [x, y, z] of lamps) bulbs.push(new THREE.SphereGeometry(0.07, 8, 6).translate(x, y, z));
    const lights = new THREE.Mesh(mergeGeometries(bulbs, false), bulb);
    lights.matrixAutoUpdate = false;
    this.all.add(lights);
    this.all.visible = false;
    scene.add(this.all);
  }

  /** Once a frame. @param open the yellow pass has been shown */
  update(dt: number, eye: THREE.Vector3, lit: (pos: THREE.Vector3, burn: number) => void, open = false) {
    const M = MINE, at = Math.min(Math.hypot(eye.x - M.west.x, eye.z - M.z), Math.hypot(eye.x - M.east.x, eye.z - M.z)), on = inMine(eye.x, eye.y, eye.z) || at < 60;
    this.all.visible = on;
    this.gated.visible = at < 90 || on;
    if (!on) return;
    // (from inside, a bar: nobody is shut in)
    for (const [k, g] of this.gates.entries()) {
      const wide = open || (inMine(eye.x, eye.y, eye.z) && g.at.distanceTo(eye) < 3.2), want = wide ? 1 : 0;
      if (wide !== g.wide) {
        g.wide = wide;
        // (the one sound for the pair)
        if (!(k % 2)) audio.lightGate(g.at, g.at.distanceTo(eye), wide);
      }
      if (g.swing === want) continue;
      g.swing = Math.min(1, Math.max(0, g.swing + (wide ? dt : -dt) / 1.5));
      g.hinge.rotation.y = g.way * g.swing * 1.75;
      g.body.setEnabled(g.swing < 0.5);
    }
    this.clock += dt;
    for (const l of this.lamps) lit(l.pos, 0.82 + Math.sin(this.clock * 1.7 + l.k * 2.1) * 0.12);
  }
}
