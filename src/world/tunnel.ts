// The tunnel the train runs in (src/sim/train-line.ts for where). A concrete bore swept along the line with a rib every nine metres, a cable run along its wall and a lamp
// every 24 metres, its rails and sleepers in the same pieces: what makes the speed felt is what goes by. It is drawn only near the eye and only with the eye under the
// ground, a piece at a time, and it stops nobody: the wagon's own walls keep a body in it, and only the stations are solid. A lamp's pool is painted once, on a tile that
// repeats down the bore; the few lamps nearest the eye are real lights too, and sweep over whoever rides past them.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Atmosphere } from './atmosphere';
import { concretePaint, painted } from './bunker';
import { onLine } from '../sim/train';
import { LINE } from '../sim/train-line';

/** the bore, metres: half its width, the height of its crown over the rails, and of the springing of its arch */
const HALF = 3, CROWN = 5.4, SPRING = 2.6;
/** the rails lie this far under the line, which runs at the wagon's deck */
const RAIL = 1.4;
const RIB_EVERY = 9, RIB_LONG = 0.6, RIB_IN = 0.2;
const LAMP_EVERY = 24, LAMP_UP = 3.3;
const PIECE = 120, DRAWN = 300;
const SLEEPER_EVERY = 0.75, GAUGE = 0.76;

/** the bore's section, from the floor on the left, over the crown, to the floor on the right: [across, up, the way in across, the way in up] */
const SECTION: number[][] = (() => {
  const out: number[][] = [[-HALF, -0.3, 1, 0], [-HALF, SPRING, 1, 0]];
  const n = 10, ry = CROWN - SPRING;
  for (let i = 1; i < n; i++) {
    const a = Math.PI * (1 - i / n), x = Math.cos(a) * HALF, y = Math.sin(a) * ry, l = Math.hypot(x / (HALF * HALF), y / (ry * ry));
    out.push([x, SPRING + y, -(x / (HALF * HALF)) / l, -(y / (ry * ry)) / l]);
  }
  out.push([HALF, SPRING, -1, 0], [HALF, -0.3, -1, 0]);
  return out;
})();
const ROUND_IT = SECTION.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - SECTION[i - 1][0], p[1] - SECTION[i - 1][1]) : 0), 0);

/** a point of the bore: `x` across and `y` over the rails, at `s` along the line */
function place(s: number, x: number, y: number, out: number[]) {
  const p = onLine(LINE, s), c = Math.cos(p.yaw), n = Math.sin(p.yaw);
  out.push(p.x + c * x, p.y - RAIL + y, p.z - n * x);
}

/** the bore between two distances */
function bore(from: number, to: number): THREE.BufferGeometry {
  const rings: { s: number; in: number }[] = [];
  const first = Math.floor(from / RIB_EVERY);
  for (let k = first; k * RIB_EVERY < to; k++) {
    const r = k * RIB_EVERY, h = RIB_LONG / 2;
    for (const [s, inset] of [[r - h - 0.02, 0], [r - h, RIB_IN], [r + h, RIB_IN], [r + h + 0.02, 0], [r + 3, 0], [r + 6, 0]] as const) if (s >= from && s <= to) rings.push({ s, in: inset });
  }
  if (!rings.length || rings[0].s > from) rings.unshift({ s: from, in: 0 });
  if (rings[rings.length - 1].s < to) rings.push({ s: to, in: 0 });
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], lit: number[] = [], idx: number[] = [], N = SECTION.length;
  for (const r of rings) {
    const p = onLine(LINE, r.s), c = Math.cos(p.yaw), n = Math.sin(p.yaw);
    let run = 0;
    SECTION.forEach((q, i) => {
      if (i) run += Math.hypot(q[0] - SECTION[i - 1][0], q[1] - SECTION[i - 1][1]);
      place(r.s, q[0] + q[2] * r.in, q[1] + q[3] * r.in, pos);
      nor.push(c * q[2], q[3], -n * q[2]);
      uv.push(run / 4, r.s / 4);
      lit.push(r.s / LAMP_EVERY, run / ROUND_IT);
    });
  }
  for (let j = 0; j + 1 < rings.length; j++) for (let i = 0; i + 1 < N; i++) {
    const a = j * N + i, b = a + 1, d = a + N, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(lit, 2));
  g.setIndex(idx);
  return g;
}

/** a bar along the line, of a section given as points round it, between two distances: a rail, or the cable run */
function bar(from: number, to: number, section: [number, number][], color: THREE.Color): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], idx: number[] = [], N = section.length;
  let count = 0;
  for (let s = from; ; s = Math.min(to, s + 3)) {
    for (const [x, y] of section) {
      place(s, x, y, pos);
      col.push(color.r, color.g, color.b);
    }
    count++;
    if (s >= to) break;
  }
  for (let j = 0; j + 1 < count; j++) for (let i = 0; i + 1 < N; i++) {
    const a = j * N + i, b = a + 1, d = a + N, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

const STEEL = new THREE.Color(0.34, 0.33, 0.32), BLACK = new THREE.Color(0.03, 0.03, 0.03), TIMBER = new THREE.Color(0.14, 0.1, 0.07);

/** the sleepers between two distances */
function sleepers(from: number, to: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let s = Math.ceil(from / SLEEPER_EVERY) * SLEEPER_EVERY; s < to; s += SLEEPER_EVERY) {
    const p = onLine(LINE, s), g = new THREE.BoxGeometry(2.3, 0.13, 0.24);
    g.rotateY(p.yaw);
    g.translate(p.x, p.y - RAIL - 0.13, p.z);
    const n = g.getAttribute('position').count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([TIMBER.r, TIMBER.g, TIMBER.b], i * 3);
    g.deleteAttribute('uv');
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g.toNonIndexed());
  }
  return mergeGeometries(parts, false);
}

export class Tunnel {
  private pieces: { mesh: THREE.Group; x: number; y: number; z: number }[] = [];
  private all = new THREE.Group();
  private lamps: THREE.Vector3[] = [];
  private held = new THREE.Vector3();

  constructor(atmo: Atmosphere, scene: THREE.Scene) {
    const L = LINE.length, Nx = 64, Ny = 128;
    // (one lamp's pool on the bore's wall, on a tile that repeats every LAMP_EVERY metres: v runs from the left foot of the wall over the crown to the right foot)
    const glow = painted(Nx, Ny, (g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, Nx, Ny);
      const y = Ny * (1 - (LAMP_UP + 0.3) / ROUND_IT);
      for (const wrap of [0, Nx]) {
        const grad = g.createRadialGradient(wrap, y, 0, wrap, y, Nx * 0.42);
        grad.addColorStop(0, 'rgb(255, 226, 170)');
        grad.addColorStop(0.3, 'rgb(150, 124, 86)');
        grad.addColorStop(0.7, 'rgb(40, 32, 22)');
        grad.addColorStop(1, 'rgb(0, 0, 0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, Nx, Ny);
      }
    }, 1, true);
    glow.channel = 1;
    const wall = atmo.register(new THREE.MeshStandardMaterial({ map: concretePaint(4177, [120, 118, 112]), roughness: 0.96, metalness: 0, lightMap: glow, lightMapIntensity: 2.2 }));
    const iron = atmo.register(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.25, side: THREE.DoubleSide }));
    const bulb = atmo.register(new THREE.MeshStandardMaterial({ color: 0x2a2a26, emissive: new THREE.Color(1, 0.84, 0.56), emissiveIntensity: 4, roughness: 0.5 }));

    for (let s = 0; s < L; s += PIECE) {
      const end = Math.min(L, s + PIECE), piece = new THREE.Group();
      const shell = new THREE.Mesh(bore(s, end), wall);
      shell.matrixAutoUpdate = false;
      const rail = (x: number): [number, number][] => [[x - 0.04, 0], [x - 0.04, 0.15], [x + 0.04, 0.15], [x + 0.04, 0]];
      const steel = mergeGeometries([
        bar(s, end, rail(-GAUGE), STEEL), bar(s, end, rail(GAUGE), STEEL), sleepers(s, end),
        bar(s, end, [[HALF - 0.04, LAMP_UP - 0.5], [HALF - 0.04, LAMP_UP - 0.36], [HALF - 0.16, LAMP_UP - 0.36], [HALF - 0.16, LAMP_UP - 0.5], [HALF - 0.04, LAMP_UP - 0.5]], BLACK),
        bar(s, end, [[-HALF + 0.04, 1.5], [-HALF + 0.04, 1.62], [-HALF + 0.14, 1.62], [-HALF + 0.14, 1.5], [-HALF + 0.04, 1.5]], BLACK),
      ], false);
      const iron1 = new THREE.Mesh(steel, iron);
      iron1.matrixAutoUpdate = false;
      const bulbs: THREE.BufferGeometry[] = [];
      for (let k = Math.ceil(s / LAMP_EVERY); k * LAMP_EVERY < end; k++) {
        const at = k * LAMP_EVERY, p = onLine(LINE, at), v: number[] = [];
        place(at, -HALF + 0.12, LAMP_UP, v);
        this.lamps.push(new THREE.Vector3(v[0], v[1], v[2]));
        const b = new THREE.CapsuleGeometry(0.06, 0.34, 4, 8);
        b.rotateX(Math.PI / 2);
        b.rotateY(p.yaw);
        b.translate(v[0], v[1], v[2]);
        bulbs.push(b);
      }
      piece.add(shell, iron1);
      if (bulbs.length) {
        const lights = new THREE.Mesh(mergeGeometries(bulbs, false), bulb);
        lights.matrixAutoUpdate = false;
        piece.add(lights);
      }
      piece.visible = false;
      const mid = onLine(LINE, (s + end) / 2);
      this.pieces.push({ mesh: piece, x: mid.x, y: mid.y, z: mid.z });
      this.all.add(piece);
    }
    // (the two ends shut with black until the stations stand there: the sky is behind them)
    const shut = new THREE.MeshBasicMaterial({ color: 0, side: THREE.DoubleSide });
    for (const s of [0, L]) {
      const p = onLine(LINE, s), end = new THREE.Mesh(new THREE.CircleGeometry(8, 16), shut);
      end.position.set(p.x, p.y, p.z);
      end.rotation.y = p.yaw;
      this.all.add(end);
    }
    this.all.visible = false;
    scene.add(this.all);
  }

  /** @param under the eye is under the ground @param lit a lamp is lit here */
  update(eye: THREE.Vector3, under: boolean, lit: (pos: THREE.Vector3, burn: number) => void) {
    this.all.visible = under;
    if (!under) return;
    let any = false;
    for (const p of this.pieces) {
      const near = Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z) < DRAWN;
      p.mesh.visible = near;
      any ||= near;
    }
    this.all.visible = any;
    if (!any) return;
    // (the lamp ahead of the eye and the ones either side of it: passing them is what lights the wagon, and lets go of it)
    for (const l of this.lamps) if (l.distanceToSquared(eye) < 34 * 34) lit(this.held.copy(l), 1);
  }
}
