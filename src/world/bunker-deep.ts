// Levels 2 and 3 as they are built and as they move (src/sim/bunker-deep.ts says where everything is). All that stands still is merged by what it is made of, so a level costs a few
// draws, not hundreds. Faces that meet are kept apart on purpose (the owner: "no gaps in the walls and no overlapping z index glitches on textures"): paint comes up off what it lies
// on, sills and step faces stop short of the floors they meet, and frames stand proud of their walls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../core/assets';
import { audio } from '../core/audio';
import { physics } from '../core/physics';
import { BUNKER, bunkerAt, bunkerPlan, levelY, type Place } from '../sim/bunker';
import { inMetres } from './bunker';
import { DEEP, ESCAPE, HALL3, VAULT_DOOR, WALL, deepAreaAt, middle, panes, type Box, type Flight, type Parting, type Rail, type Tank } from '../sim/bunker-deep';

/** a shipping container, as src/world/buildings.ts has it */
const CONTAINER = { id: 'container_shell', hx: 1.2, hz: 3, h: 2.2 };

/** what the place is built of */
export interface Stuffs { inside: THREE.Material; floor: THREE.Material; steel: THREE.Material; grey: THREE.Material; dark: THREE.Material; hazard: THREE.Material; outside: THREE.Material; mat: (m: THREE.MeshStandardMaterial) => THREE.MeshStandardMaterial }
export interface Line { x: number; z: number; nx: number; nz: number; y0: number; y1: number }

const PER = 2.6;

/** A box as a shape, painted by where it is: faces of two pieces that meet carry on into each other. */
function worldBox(r0: number, r1: number, f0: number, f1: number, y0: number, y1: number) {
  const g = new THREE.BoxGeometry(r1 - r0, y1 - y0, f1 - f0).translate((r0 + r1) / 2, (y0 + y1) / 2, (f0 + f1) / 2);
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const [u, v] = Math.abs(n.getX(i)) > 0.5 ? [p.getZ(i), p.getY(i)] : Math.abs(n.getY(i)) > 0.5 ? [p.getX(i), p.getZ(i)] : [p.getX(i), p.getY(i)];
    uv.setXY(i, u / PER, v / PER);
  }
  return g;
}

/**
 * What is in a tank, as the light comes through it: murk that is thick at the foot and thin at the head, and a shape hung in it with its lines going up. Wrapped round the tube, so
 * painted twice, a side each.
 */
function tankPaint() {
  const W = 512, H = 512, c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!, grad = g.createLinearGradient(0, 0, 0, H);
  for (const [at, col] of [[0, '#1c5c3e'], [0.25, '#3ca672'], [0.6, '#4cc48a'], [0.85, '#2a7a58'], [1, '#0e3224']] as [number, string][]) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  let s = 77;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 220; k++) {
    g.fillStyle = `rgba(${k % 3 ? '8,30,22' : '150,240,190'},${0.03 + rnd() * 0.05})`;
    g.beginPath();
    g.ellipse(rnd() * W, rnd() * H, 8 + rnd() * 34, 8 + rnd() * 60, 0, 0, Math.PI * 2);
    g.fill();
  }
  // (a body hung by its lines: head, shoulders, arms let down, legs, in the shade the murk gives it)
  for (const cx of [W * 0.25, W * 0.75]) {
    g.save();
    g.translate(cx, H * 0.5);
    g.filter = 'blur(7px)';
    g.fillStyle = 'rgba(6,20,16,0.62)';
    g.strokeStyle = 'rgba(6,20,16,0.62)';
    g.lineCap = 'round';
    g.beginPath();
    g.ellipse(0, -112, 15, 19, 0, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 34;
    g.beginPath();
    g.moveTo(0, -78);
    g.lineTo(0, 12);
    g.stroke();
    g.lineWidth = 13;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(side * 22, -78);
      g.quadraticCurveTo(side * 46, -28, side * 34, 22);
      g.stroke();
    }
    g.lineWidth = 17;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(side * 10, 16);
      g.lineTo(side * 15, 120);
      g.stroke();
    }
    g.lineWidth = 2.5;
    for (const x of [-9, 0, 11]) {
      g.beginPath();
      g.moveTo(x, -120);
      g.quadraticCurveTo(x * 2.4, -200, x * 1.4, -256);
      g.stroke();
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** a plate of a steel floor, tread pattern across it */
function deckPaint() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5a5e58';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16) {
    for (let x = (y / 16) % 2 ? 8 : 0; x < 128; x += 16) {
      g.fillStyle = '#747a72';
      g.save();
      g.translate(x + 8, y + 8);
      g.rotate((y / 16) % 2 ? 0.8 : -0.8);
      g.fillRect(-6, -1.4, 12, 2.8);
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

interface Leaf { mesh: THREE.Object3D; shut: THREE.Vector3; away: THREE.Vector3 }
interface Moving { at: THREE.Vector3; spec: Parting; leaves: Leaf[]; body: ReturnType<typeof physics.addStatic>[]; slide: number; was: boolean; level: number }

export class DeepWorks {
  /** the ladders of the deep levels, as src/game/building/ladders.ts takes them */
  readonly ladders: Line[] = [];
  private moving: Moving[] = [];
  private tanks: THREE.MeshStandardMaterial;
  private glow = 0;
  private disc = new THREE.Group();
  private discBody: ReturnType<typeof physics.addStatic> | null = null;
  private roll = 0;
  private rolled = false;
  private beacons: THREE.Object3D[] = [];
  private beaconOn = new THREE.Group();
  private glass: THREE.MeshStandardMaterial;
  private tread: THREE.MeshStandardMaterial;
  private water: THREE.MeshStandardMaterial;
  private pile = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private v = new THREE.Vector3();

  constructor(private P: Place, private s: Stuffs) {
    const murk = tankPaint();
    this.tanks = s.mat(new THREE.MeshStandardMaterial({ map: murk, emissive: new THREE.Color(1, 1, 1), emissiveMap: murk, emissiveIntensity: 0.06, roughness: 0.25 }));
    this.glass = s.mat(new THREE.MeshStandardMaterial({ color: 0xa8c8c4, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.17, depthWrite: false, side: THREE.DoubleSide }));
    const map = deckPaint();
    map.repeat.set(1, 1);
    this.tread = s.mat(new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.55 }));
    this.water = s.mat(new THREE.MeshStandardMaterial({ color: 0x0c1412, roughness: 0.06, metalness: 0.6, transparent: true, opacity: 0.86, depthWrite: true }));
  }

  private add(stuff: THREE.Material, g: THREE.BufferGeometry) {
    (this.pile.get(stuff) ?? this.pile.set(stuff, []).get(stuff)!).push(g.index ? g.toNonIndexed() : g);
  }
  /** what stops a body, where nothing is drawn for it */
  private solid(r0: number, r1: number, f0: number, f1: number, y0: number, y1: number, surface: 'concrete' | 'metal' = 'concrete') {
    const [x, y, z] = bunkerAt(this.P, (r0 + r1) / 2, (f0 + f1) / 2, (y0 + y1) / 2);
    return physics.addStatic(physics.R.ColliderDesc.cuboid((r1 - r0) / 2, (y1 - y0) / 2, (f1 - f0) / 2), surface, { x, y, z }, this.P.rot);
  }
  private box(r0: number, r1: number, f0: number, f1: number, y0: number, y1: number, m: THREE.Material, surface?: 'concrete' | 'metal') {
    this.add(m, worldBox(r0, r1, f0, f1, y0, y1));
    if (surface) this.solid(r0, r1, f0, f1, y0, y1, surface);
  }
  /** a slab, round a hole in it where it has one */
  private slab(a: Box, y0: number, y1: number, m: THREE.Material, H: Box | undefined) {
    if (!H) return this.box(a.r0, a.r1, a.f0, a.f1, y0, y1, m, 'concrete');
    this.box(a.r0, H.r0, a.f0, a.f1, y0, y1, m, 'concrete');
    this.box(H.r1, a.r1, a.f0, a.f1, y0, y1, m, 'concrete');
    this.box(H.r0, H.r1, a.f0, H.f0, y0, y1, m, 'concrete');
    this.box(H.r0, H.r1, H.f1, a.f1, y0, y1, m, 'concrete');
  }
  /** a bar from one point of the plan to another: [r, y, f] */
  private beam(a: [number, number, number], b: [number, number, number], w: number, h: number, m: THREE.Material) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
    const g = new THREE.BoxGeometry(w, h, len);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), B.clone().sub(A).normalize())).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.add(m, g);
  }

  private rail({ ra, fa, rb, fb, y }: Rail, Y: number) {
    const s = this.s.grey, top = Y + y;
    this.box(Math.min(ra, rb) - 0.03, Math.max(ra, rb) + 0.03, Math.min(fa, fb) - 0.03, Math.max(fa, fb) + 0.03, top + 1, top + 1.06, s);
    this.box(Math.min(ra, rb) - 0.02, Math.max(ra, rb) + 0.02, Math.min(fa, fb) - 0.02, Math.max(fa, fb) + 0.02, top + 0.52, top + 0.56, s);
    const len = Math.hypot(rb - ra, fb - fa), n = Math.max(1, Math.ceil(len / 2.2));
    for (let k = 0; k <= n; k++) {
      const r = ra + ((rb - ra) * k) / n, f = fa + ((fb - fa) * k) / n;
      this.box(r - 0.03, r + 0.03, f - 0.03, f + 0.03, top, top + 1, s);
    }
    this.solid(Math.min(ra, rb) - 0.05, Math.max(ra, rb) + 0.05, Math.min(fa, fb) - 0.05, Math.max(fa, fb) + 0.05, top, top + 1.1, 'metal');
  }

  private flight(q: Flight, Y: number) {
    const along = q.up[0] === 'r', sign = q.up[1] === '1' ? 1 : -1, n = Math.max(3, Math.ceil((q.y1 - q.y0) / 0.19)), rise = (q.y1 - q.y0) / n;
    const len = along ? q.r1 - q.r0 : q.f1 - q.f0, run = len / n, y0 = Y + q.y0, y1 = Y + q.y1;
    const low = sign > 0 ? (along ? q.r0 : q.f0) : along ? q.r1 : q.f1;
    const at = (t: number) => low + sign * t * len;
    for (let k = 0; k < n; k++) {
      const a = low + sign * k * run, b = a + sign * run, c0 = Math.min(a, b), c1 = Math.max(a, b), top = y0 + (k + 1) * rise;
      if (q.steel) {
        if (along) this.box(c0, c1, q.f0, q.f1, top - 0.05, top, this.tread);
        else this.box(q.r0, q.r1, c0, c1, top - 0.05, top, this.tread);
      } else if (along) this.box(c0, c1, q.f0, q.f1, y0, top, this.s.floor);
      else this.box(q.r0, q.r1, c0, c1, y0, top, this.s.floor);
    }
    // (the stringers and the handrail, each a bar up the slope)
    const hi = at(1), lo = at(0), sides = along ? [q.f0, q.f1] : [q.r0, q.r1];
    for (const c of sides) {
      const pt = (v: number, y: number): [number, number, number] => (along ? [v, y, c] : [c, y, v]);
      if (q.steel) this.beam(pt(lo, y0 - 0.08), pt(hi, y1 - 0.08), 0.06, 0.16, this.s.steel);
      this.beam(pt(lo, y0 + 1), pt(hi, y1 + 1), 0.05, 0.05, this.s.grey);
      for (const t of [0.02, 0.5, 0.98]) {
        const v = lo + (hi - lo) * t, y = y0 + (y1 - y0) * t;
        this.box(along ? v - 0.025 : c - 0.025, along ? v + 0.025 : c + 0.025, along ? c - 0.025 : v - 0.025, along ? c + 0.025 : v + 0.025, y, y + 1, this.s.grey);
      }
    }
    // (what is walked on: one slope, a foot does not catch on every edge)
    const P = this.P, w0 = along ? q.f0 : q.r0, w1 = along ? q.f1 : q.r1;
    const c = (v: number, w: number, y: number) => (along ? bunkerAt(P, v, w, y) : bunkerAt(P, w, v, y));
    const pts = [c(lo, w0, y0), c(lo, w1, y0), c(hi, w0, y1), c(hi, w1, y1), c(lo, w0, y0 - 0.3), c(lo, w1, y0 - 0.3), c(hi, w0, y1 - 0.3), c(hi, w1, y1 - 0.3)];
    physics.addStatic(physics.R.ColliderDesc.convexHull(new Float32Array(pts.flat()))!, q.steel ? 'metal' : 'concrete', { x: 0, y: 0, z: 0 }, 0);
  }

  private ladder(r: number, f: number, nr: number, nf: number, y0: number, y1: number) {
    const [x, , z] = bunkerAt(this.P, r, f), [ox, , oz] = bunkerAt(this.P, r + nr, f + nf), s = this.s.steel, tr = nf, tf = nr;
    for (const side of [-1, 1]) {
      const ar = r + tr * side * 0.24 + nr * 0.05, af = f + tf * side * 0.24 + nf * 0.05;
      this.box(ar - 0.02, ar + 0.02, af - 0.02, af + 0.02, y0, y1, s);
    }
    for (let y = y0 + 0.3; y < y1 - 0.05; y += 0.3) {
      const cr = r + nr * 0.05, cf = f + nf * 0.05, wr = Math.abs(tr) * 0.25 + 0.012, wf = Math.abs(tf) * 0.25 + 0.012;
      this.box(cr - wr, cr + wr, cf - wf, cf + wf, y - 0.012, y + 0.012, s);
    }
    this.ladders.push({ x, z, nx: ox - x, nz: oz - z, y0: this.P.y + y0, y1: this.P.y + y1 });
  }

  private tank(t: Tank, Y: number) {
    const y0 = Y + t.y0, y1 = Y + t.y1, R = t.rad, { steel, dark } = this.s, P = this.P;
    const round = (rad: number, a: number, b: number, m: THREE.Material, seg = 28, open = false) => this.add(m, new THREE.CylinderGeometry(rad, rad, b - a, seg, 1, open).translate(t.r, (a + b) / 2, t.f));
    round(R + 0.18, y0, y0 + 0.55, steel);
    round(R + 0.05, y0 + 0.55, y0 + 0.62, dark);
    const [x, y, z] = bunkerAt(P, t.r, t.f, (y0 + y1) / 2);
    if (t.broken) {
      // (it went: what is left of its wall stands round its foot, and its lid is gone)
      round(R, y0 + 0.62, y0 + 1.1, this.glass, 28, true);
      physics.addStatic(physics.R.ColliderDesc.cylinder(0.275, R + 0.18), 'metal', { x, y: y0 + 0.275, z });
      return;
    }
    round(R, y0 + 0.62, y1 - 0.42, this.glass, 28, true);
    round(R - 0.06, y0 + 0.64, y1 - 0.6, this.tanks, 28);
    round(R + 0.05, y1 - 0.42, y1 - 0.34, dark);
    round(R + 0.15, y1 - 0.34, y1, steel);
    for (const a of [0.4, 1.97, 3.54, 5.11]) {
      const br = t.r + Math.cos(a) * (R + 0.03), bf = t.f + Math.sin(a) * (R + 0.03);
      this.box(br - 0.05, br + 0.05, bf - 0.05, bf + 0.05, y0 + 0.55, y1 - 0.34, steel);
    }
    physics.addStatic(physics.R.ColliderDesc.cylinder((y1 - y0) / 2, R + 0.15), 'metal', { x, y, z });
  }

  /** the wall's way through given a steel frame, standing a finger proud of it each side */
  private frames(level: number, Y: number) {
    const d = DEEP[level], m = this.s.steel, W = WALL / 2 + 0.015;
    for (const [r, f, foot, high, half] of d.doors) {
      const y = Y + (foot ?? 0), h = high ?? 2.15, w = half ?? 0.95;
      if (h < 1.5 || h > 2.4 || w > 1) continue;
      const onR = deepAreaAt(level, r - 0.4, f) !== deepAreaAt(level, r + 0.4, f);
      for (const s of [-1, 1]) {
        if (onR) this.box(r - W, r + W, f + s * w - 0.05, f + s * w + 0.05, y, y + h + 0.05, m);
        else this.box(r + s * w - 0.05, r + s * w + 0.05, f - W, f + W, y, y + h + 0.05, m);
      }
      if (onR) this.box(r - W, r + W, f - w - 0.05, f + w + 0.05, y + h - 0.02, y + h + 0.06, m);
      else this.box(r - w - 0.05, r + w + 0.05, f - W, f + W, y + h - 0.02, y + h + 0.06, m);
    }
  }

  private moverAt(spec: Parting, level: number, Y: number, group: THREE.Object3D) {
    const { r, f, along, half } = spec, y = Y, high = 2.1, s = this.s, pane = spec.heavy ? s.grey : this.glass;
    const leafAt = (sign: number, w: number) => {
      const leaf = new THREE.Group(), thick = 0.05, wr = along === 'r' ? w / 2 : thick, wf = along === 'r' ? thick : w / 2;
      const g = new THREE.Mesh(new THREE.BoxGeometry(wr * 2, high, wf * 2), pane);
      g.position.y = high / 2;
      leaf.add(g);
      if (!spec.heavy) {
        const frame = (a: number, b: number, c0: number, c1: number) => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(along === 'r' ? a : 0.09, b, along === 'r' ? 0.09 : a), s.steel);
          m.position.set(along === 'r' ? c0 : 0, c1, along === 'r' ? 0 : c0);
          leaf.add(m);
        };
        frame(w, 0.08, 0, 0.04);
        frame(w, 0.08, 0, high - 0.04);
        frame(0.07, high, -w / 2 + 0.035, high / 2);
        frame(0.07, high, w / 2 - 0.035, high / 2);
      }
      const shut = new THREE.Vector3(along === 'r' ? r + (sign * w) / 2 : r, y, along === 'r' ? f : f + (sign * w) / 2);
      const go = sign || 1, away = shut.clone().add(new THREE.Vector3(along === 'r' ? go * (w - 0.1) : 0, 0, along === 'r' ? 0 : go * (w - 0.1)));
      leaf.position.copy(shut);
      group.add(leaf);
      return { mesh: leaf, shut, away };
    };
    const leaves = spec.heavy ? [leafAt(0, half * 2)] : [leafAt(-1, half), leafAt(1, half)];
    // (the wall over a wide pair of them, down to their head)
    if (!spec.heavy) {
      this.box(along === 'r' ? r - half : r - 0.15, along === 'r' ? r + half : r + 0.15, along === 'r' ? f - 0.15 : f - half, along === 'r' ? f + 0.15 : f + half, Y + high, Y + BUNKER.tall, s.inside);
    }
    const body = [this.solid(along === 'r' ? r - half : r - 0.06, along === 'r' ? r + half : r + 0.06, along === 'r' ? f - 0.06 : f - half, along === 'r' ? f + 0.06 : f + half, y, y + high, spec.heavy ? 'metal' : 'concrete')];
    const [x, wy, z] = bunkerAt(this.P, r, f, y + 1.2);
    this.moving.push({ at: new THREE.Vector3(x, wy, z), spec, leaves, body, slide: 0, was: false, level });
  }

  /** the round door: its plate, its frame, its track, and the door itself */
  private vault(Y: number, group: THREE.Object3D) {
    const V = VAULT_DOOR, cy = Y + V.y, { steel, dark, hazard } = this.s;
    // (the plate that makes a round hole of the square one in the wall)
    const hole = 2.34, half = 2.5, s = new THREE.Shape();
    s.moveTo(-half, -2.6);
    s.lineTo(half, -2.6);
    s.lineTo(half, half);
    s.lineTo(-half, half);
    s.closePath();
    const h = new THREE.Path();
    h.absarc(0, 0, hole, 0, Math.PI * 2, true);
    s.holes.push(h);
    this.add(steel, new THREE.ExtrudeGeometry(s, { depth: WALL + 0.06, bevelEnabled: false, curveSegments: 40 }).translate(V.r, cy, 6 - WALL / 2 - 0.03));
    this.add(dark, new THREE.TorusGeometry(hole + 0.08, 0.1, 10, 56).translate(V.r, cy, 6 - WALL / 2 - 0.06));
    this.solid(V.r - half, V.r - 1.98, 5.8, 6.2, Y + V.y - 2.6, cy + half, 'metal');
    this.solid(V.r + 1.98, V.r + half, 5.8, 6.2, Y + V.y - 2.6, cy + half, 'metal');
    this.solid(V.r - half, V.r + half, 5.8, 6.2, cy + 1.95, cy + half, 'metal');
    // (the sill the rim of it stands on, with hazard paint across it, and the track it runs along)
    this.box(V.r - 3, V.r + V.roll + 3, V.f + 0.06, V.f + 0.54, Y + HALL3.floor, Y + HALL3.floor + 0.012, dark);
    this.box(V.r - 3, V.r + V.roll + 3, V.f - 1.2, V.f - 0.72, Y + HALL3.floor, Y + HALL3.floor + 0.008, hazard);
    // (the door: a drum of plain steel until its model has come. It is the model's +z that looks out, at the hall; on rolling it turns)
    this.disc.position.set(V.r, cy, V.f);
    group.add(this.disc);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(V.rad, V.rad, 0.44, 48).rotateX(Math.PI / 2).translate(0, 0, 0.3), steel);
    this.disc.add(drum);
    void assets.model('vault_door').then((scene) => {
      scene.updateMatrixWorld(true);
      const kept = new Map<THREE.Material, THREE.MeshStandardMaterial>();
      scene.traverse((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh) return;
        const from = src.material as THREE.MeshStandardMaterial;
        // (the model's own word for its metal leaves it black with nothing to shine in down here)
        if (!kept.has(from)) kept.set(from, this.s.mat(Object.assign(from.clone() as THREE.MeshStandardMaterial, { metalness: 0.25, roughness: 0.7 })));
        const mesh = new THREE.Mesh(inMetres(src), kept.get(from)!);
        mesh.rotation.y = Math.PI;
        mesh.position.y = -V.rad;
        mesh.receiveShadow = true;
        this.disc.add(mesh);
      });
      this.disc.remove(drum);
    }).catch(() => {});
    this.discBody = this.solid(V.r - 2.2, V.r + 2.2, V.f + 0.06, V.f + 0.54, Y + HALL3.floor, cy + 2.2, 'metal');
    // (the beacons either side of it, dark until the breaker goes)
    this.beaconOn.visible = false;
    group.add(this.beaconOn);
    for (const side of [-1, 1]) {
      const lamp = new THREE.Group();
      lamp.position.set(V.r + side * 3.2, Y + HALL3.floor + 3.4, 5.72);
      const m = new THREE.MeshBasicMaterial({ color: 0xff7a18, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      for (const a of [0, Math.PI]) {
        const q = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.5).translate(1.7, 0, 0), m);
        q.rotation.y = a;
        lamp.add(q);
      }
      lamp.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb060 })));
      this.beacons.push(lamp);
      this.beaconOn.add(lamp);
    }
  }

  /** One deep level built into its group. */
  build(level: number, group: THREE.Group) {
    const d = DEEP[level], plan = bunkerPlan(level), Y = levelY(level), { inside, floor, steel, dark, outside } = this.s;
    for (const a of d.areas) {
      const low = Y + (a.y ?? 0), top = Y + (a.top ?? BUNKER.tall);
      this.slab(a, low - 0.3, low, floor, a.hole);
      this.slab(a, top, top + 0.3, inside, a.roofHole);
    }
    for (const w of plan.walls) this.box(w.r0, w.r1, w.f0, w.f1, Y + (w.y0 ?? 0), Y + (w.y1 ?? BUNKER.tall), inside, 'concrete');
    this.frames(level, Y);
    for (const q of d.decks) {
      const y = Y + q.y;
      this.box(q.r0, q.r1, q.f0, q.f1, y - 0.06, y, this.tread, 'metal');
      // (angle under its edges: a deck is carried on something)
      const wide = q.r1 - q.r0 > q.f1 - q.f0;
      for (const s of [0.1, 0.9]) {
        if (wide) this.box(q.r0, q.r1, q.f0 + (q.f1 - q.f0) * s - 0.05, q.f0 + (q.f1 - q.f0) * s + 0.05, y - 0.24, y - 0.06, steel);
        else this.box(q.r0 + (q.r1 - q.r0) * s - 0.05, q.r0 + (q.r1 - q.r0) * s + 0.05, q.f0, q.f1, y - 0.24, y - 0.06, steel);
      }
    }
    for (const q of d.flights) this.flight(q, Y);
    for (const q of d.rails) this.rail(q, Y);
    for (const q of d.masses) this.box(q.r0, q.r1, q.f0, q.f1, Y + q.y0, Y + q.y1, q.rough ? outside : floor, 'concrete');
    for (const t of d.tiers) {
      const deep = (t.f1 - t.f0) / t.rows, foot = Y + (d.areas.find((a) => a.r0 <= t.r0 && a.r1 >= t.r1 && a.f0 <= t.f0 && a.f1 >= t.f1)?.y ?? 0);
      for (let k = 0; k < t.rows; k++) {
        const top = Y - k * t.rise, f0 = t.to === 'f1' ? t.f0 + k * deep : t.f1 - (k + 1) * deep, f1 = f0 + deep;
        this.box(t.r0, t.aisle[0], f0, f1, foot, top, floor, 'concrete');
        this.box(t.aisle[1], t.r1, f0, f1, foot, top, floor, 'concrete');
      }
    }
    for (const q of d.ladders) this.ladder(q.r, q.f, q.nr, q.nf, Y + q.y0, Y + q.y1);
    for (const q of d.water) this.add(this.water, new THREE.PlaneGeometry(q.r1 - q.r0, q.f1 - q.f0).rotateX(-Math.PI / 2).translate((q.r0 + q.r1) / 2, Y + q.y, (q.f0 + q.f1) / 2));
    for (const t of d.tanks) this.tank(t, Y);
    // the glass: panes in their walls, mullions over them; and the floor over Level 3, in a grid of steel
    for (const p of panes(d)) {
      const y0 = Y + p.y0, y1 = Y + p.y1;
      if (p.axis === 'r') this.box(p.at - 0.02, p.at + 0.02, p.a, p.b, y0, y1, this.glass, 'concrete');
      else this.box(p.a, p.b, p.at - 0.02, p.at + 0.02, y0, y1, this.glass, 'concrete');
      const n = Math.max(1, Math.round((p.b - p.a) / 2.2));
      for (let k = 0; k <= n; k++) {
        const v = p.a + ((p.b - p.a) * k) / n;
        if (p.axis === 'r') this.box(p.at - 0.05, p.at + 0.05, v - 0.03, v + 0.03, y0, y1, steel);
        else this.box(v - 0.03, v + 0.03, p.at - 0.05, p.at + 0.05, y0, y1, steel);
      }
    }
    for (const q of d.floors) {
      const y = Y + q.y;
      this.box(q.r0, q.r1, q.f0, q.f1, y - 0.05, y - 0.012, this.glass, 'concrete');
      for (let r = q.r0; r <= q.r1 + 0.01; r += 2) this.box(r - 0.05, r + 0.05, q.f0, q.f1, y - 0.3, y + 0.008, steel);
      for (let f = q.f0 + (q.f1 - q.f0) / 3; f < q.f1 - 0.01; f += (q.f1 - q.f0) / 3) this.box(q.r0, q.r1, f - 0.04, f + 0.04, y - 0.3, y + 0.004, steel);
    }
    // what stands and stops a body
    for (const t of d.stood) {
      const e = assets.manifest.models[t.id.split('@')[0]], k = t.scale ?? 1, up = Y + (t.y ?? 0), c = Math.cos(t.rot), n = Math.sin(t.rot);
      if (t.id.startsWith(CONTAINER.id)) {
        const along = Math.abs(n) < 0.5, hr = along ? CONTAINER.hx : CONTAINER.hz, hf = along ? CONTAINER.hz : CONTAINER.hx;
        this.solid(t.r - hr, t.r + hr, t.f - hf, t.f + hf, up - 0.04, up + 0.06, 'metal');
        this.solid(t.r - hr, t.r + hr, t.f - hf, t.f + hf, up + CONTAINER.h - 0.04, up + CONTAINER.h, 'metal');
        if (along) for (const s of [-1, 1]) this.solid(t.r + s * hr - 0.04, t.r + s * hr + 0.04, t.f - hf, t.f + hf, up, up + CONTAINER.h, 'metal');
        else for (const s of [-1, 1]) this.solid(t.r - hr, t.r + hr, t.f + s * hf - 0.04, t.f + s * hf + 0.04, up, up + CONTAINER.h, 'metal');
        continue;
      }
      if (!t.solid || !e) continue;
      const mx = ((e.min[0] + e.max[0]) / 2) * k, mz = ((e.min[2] + e.max[2]) / 2) * k, hx = ((e.max[0] - e.min[0]) / 2) * k, hy = ((e.max[1] - e.min[1]) / 2) * k, hz = ((e.max[2] - e.min[2]) / 2) * k;
      const r = t.r + mx * c + mz * n, f = t.f - mx * n + mz * c, [x, y, z] = bunkerAt(this.P, r, f, up + hy);
      physics.addStatic(physics.R.ColliderDesc.cuboid(hx, hy, hz), 'metal', { x, y, z }, this.P.rot + t.rot);
    }
    for (const q of d.parting) this.moverAt(q, level, Y, group);
    if (level === 3) {
      this.vault(Y, group);
      this.crane(Y);
      const E = ESCAPE, H = E.half;
      // (the well up to the generator hall's floor, from the drift's roof)
      for (const s of [-1, 1]) {
        this.box(E.r + s * H - 0.1, E.r + s * H + 0.1, E.f - H - 0.1, E.f + H + 0.1, Y + 3, Y + E.high - 0.3, inside);
        this.box(E.r - H + 0.1, E.r + H - 0.1, E.f + s * H - 0.1, E.f + s * H + 0.1, Y + 3, Y + E.high - 0.3, inside);
      }
    }
    void dark;
    for (const [stuff, geos] of this.pile) {
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), stuff);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    this.pile.clear();
  }

  /** the crane over the great hall: two girders under its deck, its trolley, and the box left hanging from it */
  private crane(Y: number) {
    const { steel, dark, hazard } = this.s, f0 = -3.5, f1 = -2.5, y = Y + 1;
    for (const f of [f0, f1]) {
      this.box(-13, 13, f - 0.12, f + 0.12, y - 0.74, y - 0.68, steel);
      this.box(-13, 13, f - 0.03, f + 0.03, y - 0.68, y - 0.3, steel);
      this.box(-13, 13, f - 0.12, f + 0.12, y - 0.3, y - 0.24, steel);
    }
    // (it stands on the gallery's edge, on a truck each end that ran along a rail there)
    for (const s of [-1, 1]) {
      this.box(s * 13 - 0.16, s * 13 + 0.16, -3.8, -3.5, Y, y - 0.06, steel, 'metal');
      this.box(s * 13 - 0.16, s * 13 + 0.16, -2.5, -2.2, Y, y - 0.06, steel, 'metal');
      this.box(s * 13 - 0.2, s * 13 + 0.2, -4.5, -1.5, Y, Y + 0.18, hazard, 'metal');
    }
    // (the trolley, and the wires down to the box)
    this.box(2.2, 5.8, -3.65, -2.35, y + 0.02, y + 0.5, hazard);
    this.box(3.2, 4.8, -3.3, -2.7, y + 0.5, y + 0.86, dark);
    for (const r of [2.6, 5.4]) for (const f of [-3.6, -2.4]) this.beam([4 + (r - 4) * 0.2, y, -3 + (f + 3) * 0.2], [r, Y - 1.58, f], 0.03, 0.03, dark);
  }

  /** Once a frame. @param gate is this gate of the place open? @param power Level 2's plant is running @param alarm the vault's breaker has been thrown */
  update(dt: number, eye: THREE.Vector3, level: number, gate: (id: string) => boolean, power: boolean, alarm: boolean) {
    this.glow += ((power ? 1 : 0.06) - this.glow) * Math.min(1, dt * 0.5);
    this.tanks.emissiveIntensity = this.glow * 0.7;
    for (const m of this.moving) {
      if (m.level !== level) continue;
      const near = m.at.distanceTo(eye) < (m.spec.heavy ? 3 : 3.4), open = m.spec.gate ? gate(m.spec.gate) || (near && this.behind(m, eye)) : near;
      if (open !== m.was) {
        m.was = open;
        audio.lightGate(m.at, m.at.distanceTo(eye), open);
      }
      const want = open ? 1 : 0;
      if (m.slide === want) continue;
      m.slide = Math.min(1, Math.max(0, m.slide + ((open ? dt : -dt) / (m.spec.heavy ? 1.6 : 0.5))));
      for (const l of m.leaves) l.mesh.position.lerpVectors(l.shut, l.away, m.slide);
      for (const b of m.body) b.setEnabled(m.slide < 0.75);
    }
    if (level !== 3) return;
    this.beaconOn.visible = alarm;
    if (alarm) for (const [k, b] of this.beacons.entries()) b.rotation.y += dt * (k ? 4.2 : -4.2);
    const rolled = gate('vault');
    if (rolled !== this.rolled) {
      this.rolled = rolled;
      this.v.set(...bunkerAt(this.P, VAULT_DOOR.r, VAULT_DOOR.f, levelY(3) + VAULT_DOOR.y));
      audio.blastDoor(this.v, this.v.distanceTo(eye), rolled);
    }
    const want = rolled ? 1 : 0;
    if (this.roll !== want) {
      this.roll = Math.min(1, Math.max(0, this.roll + (rolled ? dt : -dt) / 9));
      const x = THREE.MathUtils.smoothstep(this.roll, 0, 1) * VAULT_DOOR.roll;
      this.disc.position.x = VAULT_DOOR.r + x;
      this.disc.rotation.z = -x / VAULT_DOOR.rad;
      this.discBody?.setEnabled(this.roll < 0.45);
    }
  }

  /** is the eye on the far side of a gate's door: the side it opens to without a card? */
  private behind(m: Moving, eye: THREE.Vector3) {
    const here = this.local(eye), spot = middle({ r0: m.spec.r, r1: m.spec.r, f0: m.spec.f, f1: m.spec.f });
    return m.spec.along === 'r' ? here[1] < spot[1] : here[0] < spot[0];
  }
  private local(v: THREE.Vector3): [number, number] {
    const dx = v.x - this.P.x, dz = v.z - this.P.z, c = Math.cos(this.P.rot), n = Math.sin(this.P.rot);
    return [dx * c - dz * n, dx * n + dz * c];
  }
}
