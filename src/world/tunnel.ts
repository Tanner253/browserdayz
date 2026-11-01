// The tunnel the train runs in (src/sim/train-line.ts for where). A concrete bore swept along the line with a rib every nine metres, a cable run along its wall and a lamp
// every 24 metres, its rails and sleepers in the same pieces: what makes the speed felt is what goes by. It is drawn only near the eye and only with the eye under the
// ground, a piece at a time, and it stops nobody: the wagon's own walls keep a body in it, and only the stations are solid. A lamp's pool is painted once, on a tile that
// repeats down the bore; the few lamps nearest the eye are real lights too, and sweep over whoever rides past them.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Atmosphere } from './atmosphere';
import { assets } from '../core/assets';
import { painted } from './bunker';
import { onLine } from '../sim/train';
import { BORE, LINE } from '../sim/train-line';

/** the bore, metres: half its width, the height of its crown over the rails, and of the springing of its arch */
const HALF = 3, CROWN = 5.4, SPRING = 2.6;
/** the rails lie this far under the line, which runs at the wagon's deck */
const RAIL = 1.4;
const RIB_EVERY = 9, RIB_LONG = 0.6, RIB_IN = 0.2;
const LAMP_EVERY = 16, LAMP_UP = 3.3;
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
/** the bore's opening, as the stations cut it out of their end walls: across, and up from the rails */
export const BORE_ARCH = SECTION.map(([x, y]) => [x, y]);
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
      lit.push(r.s / (LAMP_EVERY * 2), run / ROUND_IT);
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

/** the stone the track lies in, from wall to wall, the sleepers half in it (the bore itself is an arch, open underneath). Each half is lit from its own wall's foot, and they meet under the rails */
function bed(from: number, to: number): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], lit: number[] = [], idx: number[] = [], Y = -0.17;
  let rows = 0;
  for (let s = from; ; s = Math.min(to, s + 3)) {
    for (const [x, v] of [[-HALF, 0.04], [0, 0.04], [0, 0.96], [HALF, 0.96]]) {
      place(s, x, Y, pos);
      nor.push(0, 1, 0);
      uv.push(x / 2.5, s / 2.5);
      lit.push(s / (LAMP_EVERY * 2), v);
    }
    rows++;
    if (s >= to) break;
  }
  for (let j = 0; j + 1 < rows; j++) for (const i of [0, 2]) {
    const a = j * 4 + i, b = a + 1, d = a + 4, e = d + 1;
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

/** the sleepers between two distances: one box many times over */
function sleepers(from: number, to: number, timber: THREE.Material): THREE.InstancedMesh {
  const first = Math.ceil(from / SLEEPER_EVERY), n = Math.max(1, Math.ceil(to / SLEEPER_EVERY) - first);
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.13, 0.24), timber, n), m = new THREE.Matrix4(), q = new THREE.Quaternion(), at = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const p = onLine(LINE, (first + i) * SLEEPER_EVERY);
    mesh.setMatrixAt(i, m.compose(at.set(p.x, p.y - RAIL - 0.13, p.z), q.setFromAxisAngle(up, p.yaw), one));
  }
  mesh.matrixAutoUpdate = false;
  return mesh;
}

interface Piece { from: number; to: number; mesh: THREE.Group | null; x: number; y: number; z: number }
interface Stuff { wall: THREE.Material; bed: THREE.Material; iron: THREE.Material; timber: THREE.Material; bulb: THREE.Material }

export class Tunnel {
  private pieces: Piece[] = [];
  private all = new THREE.Group();
  private lamps: THREE.Vector3[] = [];
  private held = new THREE.Vector3();
  private ends: THREE.Mesh[] = [];
  /** its paints, made the first time anybody comes down here: most games never do */
  private stuff: Stuff | null = null;

  constructor(private atmo: Atmosphere, scene: THREE.Scene) {
    const L = LINE.length;
    for (let s = 0; s < L; s += PIECE) {
      const end = Math.min(L, s + PIECE), mid = onLine(LINE, (s + end) / 2);
      this.pieces.push({ from: s, to: end, mesh: null, x: mid.x, y: mid.y, z: mid.z });
    }
    for (let k = Math.ceil(BORE.from / LAMP_EVERY); k * LAMP_EVERY < BORE.to; k++) {
      const v: number[] = [];
      place(k * LAMP_EVERY, (k % 2 ? 1 : -1) * (HALF - 0.12), LAMP_UP, v);
      this.lamps.push(new THREE.Vector3(v[0], v[1], v[2]));
    }
    // (the bore shut with black where the drawing of it stops: the sky is behind that)
    const shut = new THREE.MeshBasicMaterial({ color: 0, side: THREE.DoubleSide });
    for (let k = 0; k < 2; k++) this.ends.push(new THREE.Mesh(new THREE.CircleGeometry(8, 16), shut));
    this.all.add(...this.ends);
    this.all.visible = false;
    scene.add(this.all);
  }

  private paints(): Stuff {
    const Nx = 256, Ny = 128, atmo = this.atmo;
    // (the pools of two lamps, one on each wall, on a tile that repeats every two lamps: v runs from the left foot of the wall over the crown to the right foot; and a
    // little over all of it, so that the stretch between two lamps is dim and not black)
    const glow = painted(Nx, Ny, (g) => {
      g.fillStyle = 'rgb(20, 18, 16)';
      g.fillRect(0, 0, Nx, Ny);
      g.globalCompositeOperation = 'lighter';
      const v = (LAMP_UP + 0.3) / ROUND_IT, R = Nx * 0.24;
      for (const [x, y] of [[0, Ny * (1 - v)], [Nx, Ny * (1 - v)], [Nx / 2, Ny * v]]) {
        const grad = g.createRadialGradient(x, y, 0, x, y, R);
        grad.addColorStop(0, 'rgb(255, 226, 170)');
        grad.addColorStop(0.3, 'rgb(150, 124, 86)');
        grad.addColorStop(0.7, 'rgb(40, 32, 22)');
        grad.addColorStop(1, 'rgb(0, 0, 0)');
        g.fillStyle = grad;
        g.fillRect(x - R, y - R, R * 2, R * 2);
      }
    }, 1, true);
    glow.channel = 1;
    const concrete = assets.pbr('dirty_concrete'), stone = assets.pbr('rocks_ground_02');
    return {
      bed: atmo.register(new THREE.MeshStandardMaterial({ map: stone.map, normalMap: stone.normalMap, roughnessMap: stone.armMap, roughness: 1, metalness: 0, side: THREE.DoubleSide, lightMap: glow, lightMapIntensity: 2.6 })),
      wall: atmo.register(new THREE.MeshStandardMaterial({ map: concrete.map, normalMap: concrete.normalMap, roughnessMap: concrete.armMap, roughness: 1, metalness: 0, lightMap: glow, lightMapIntensity: 2.6 })),
      iron: atmo.register(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.25, side: THREE.DoubleSide })),
      timber: atmo.register(new THREE.MeshStandardMaterial({ color: TIMBER, roughness: 0.9 })),
      bulb: atmo.register(new THREE.MeshStandardMaterial({ color: 0x2a2a26, emissive: new THREE.Color(1, 0.84, 0.56), emissiveIntensity: 4, roughness: 0.5 })),
    };
  }

  private build(p: Piece) {
    const u = (this.stuff ??= this.paints()), s = p.from, end = p.to, piece = new THREE.Group();
    const from = Math.max(s, BORE.from), to = Math.min(end, BORE.to), shell = to > from ? new THREE.Mesh(bore(from, to), u.wall) : null;
    if (shell) shell.matrixAutoUpdate = false;
    const floor = to > from ? new THREE.Mesh(bed(from, to), u.bed) : null;
    if (floor) {
      floor.matrixAutoUpdate = false;
      floor.receiveShadow = true;
      piece.add(floor);
    }
    const rail = (x: number): [number, number][] => [[x - 0.04, 0], [x - 0.04, 0.15], [x + 0.04, 0.15], [x + 0.04, 0]];
    const steel = mergeGeometries([
      bar(s, end, rail(-GAUGE), STEEL), bar(s, end, rail(GAUGE), STEEL),
      bar(s, end, [[HALF - 0.04, LAMP_UP - 0.5], [HALF - 0.04, LAMP_UP - 0.42], [HALF - 0.12, LAMP_UP - 0.42], [HALF - 0.12, LAMP_UP - 0.5], [HALF - 0.04, LAMP_UP - 0.5]], BLACK),
      bar(s, end, [[-HALF + 0.04, 1.5], [-HALF + 0.04, 1.58], [-HALF + 0.12, 1.58], [-HALF + 0.12, 1.5], [-HALF + 0.04, 1.5]], BLACK),
    ], false);
    const iron = new THREE.Mesh(steel, u.iron);
    iron.matrixAutoUpdate = false;
    const bulbs: THREE.BufferGeometry[] = [];
    for (let k = Math.ceil(from / LAMP_EVERY); k * LAMP_EVERY < to; k++) {
      const at = k * LAMP_EVERY, q = onLine(LINE, at), v: number[] = [];
      place(at, (k % 2 ? 1 : -1) * (HALF - 0.12), LAMP_UP, v);
      const b = new THREE.CapsuleGeometry(0.06, 0.34, 4, 8);
      b.rotateX(Math.PI / 2);
      b.rotateY(q.yaw);
      b.translate(v[0], v[1], v[2]);
      bulbs.push(b);
    }
    if (shell) piece.add(shell);
    piece.add(iron, sleepers(s, end, u.timber));
    if (bulbs.length) {
      const lights = new THREE.Mesh(mergeGeometries(bulbs, false), u.bulb);
      lights.matrixAutoUpdate = false;
      piece.add(lights);
    }
    p.mesh = piece;
    this.all.add(piece);
  }

  /** @param under the eye is under the ground @param lit a lamp is lit here */
  update(eye: THREE.Vector3, under: boolean, lit: (pos: THREE.Vector3, burn: number) => void) {
    this.all.visible = under;
    if (!under) return;
    let first = -1, last = -1, made = false;
    this.pieces.forEach((p, i) => {
      const far = Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z), near = far < DRAWN;
      // (one a frame, and ahead of being seen: a train brings a new one every three seconds or so)
      if (!p.mesh && !made && far < DRAWN + PIECE) {
        this.build(p);
        made = true;
      }
      if (p.mesh) p.mesh.visible = near;
      if (near && p.mesh) {
        if (first < 0) first = i;
        last = i;
      }
    });
    this.all.visible = first >= 0;
    if (first < 0) return;
    for (const [k, s] of [[0, first * PIECE], [1, Math.min(LINE.length, (last + 1) * PIECE)]] as const) {
      const p = onLine(LINE, s);
      this.ends[k].visible = s > BORE.from && s < BORE.to;
      this.ends[k].position.set(p.x, p.y, p.z);
      this.ends[k].rotation.y = p.yaw;
    }
    // (the lamp ahead of the eye and the ones either side of it: passing them is what lights the wagon, and lets go of it)
    for (const l of this.lamps) if (l.distanceToSquared(eye) < 34 * 34) lit(this.held.copy(l), 1);
  }
}
