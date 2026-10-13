// Development-only measure of how a gun is held by a body seen from outside (window.ST), beside the
// harness that drives the game (window.T). Loaded by hand in a dev page:
//   const ST = (await import('/src/dev/stance.ts')).default
//
// T.arms() tries a few points along each arm against a box round the torso's own skin. This asks
// the question the eye asks: how far is each upper arm, each forearm, each hand and the gun inside
// the body AS IT IS DRESSED, in the pose it is in this frame. The body's shape is taken off what is
// drawn of it: every point of its skin that hangs on the hips, the back, the neck and the collar
// bones (the jacket, the belt and its pouches, and the plate carrier, which is part of the suit),
// and every vest and pack that is a thing of its own on the back (GEAR). Their faces are covered
// with points a centimetre apart and the outermost of them, every two centimetres up the body and
// every five degrees round it, is the body's outside there. That is a fair capsule fitted to what
// is worn, not the worn things' own faces: a hollow between two pouches counts as filled, which is
// right for an arm (it cannot go there either). The arms are not capsules at all: they are the
// points of the sleeves, the pads and the gloves themselves, and the gun is its own points.
//
// A depth is how far a point would have to be moved to be outside. An arm hanging at a side reads
// 1 to 3 cm (cloth on cloth, and pouches on the belt): see `ST.base()` for what this body reads
// with nothing in its hands. The top two fifths of an upper arm are left out: they are in the
// shoulder, where an arm belongs.
//
// The head is a second shape made the same way, round the head's own line: its skin (the hood),
// and whatever hangs on it, a helmet with its visor as it is worn, a mask. `helm` is how deep the
// gun is in that, and `armH` how deep the worst of either arm is: a rifle at the eye has to clear
// a visor that is down.
// Never loaded in production builds.

import * as THREE from 'three';

type Any = Record<string, any>;
const W = window as unknown as Any;
// (the harness is asked for when it is wanted, not when this is read: the bench that runs with no game stands its own in)
const T = new Proxy({}, { get: (_, k) => W.T[k] }) as Any;

/** how thick a slice of the body is, how many ways round it is asked, and how far apart the points laid on its faces are (metres) */
const SLAB = 0.02, BINS = 72, GRID = 0.011;
/** what of the skin is the body an arm can be inside of */
const TORSO = /^(pelvis|spine_0[123]|neck_01|clavicle_[lr])$/;
const PARTS = ['ru', 'rf', 'rh', 'lu', 'lf', 'lh'] as const;
type Part = (typeof PARTS)[number];
const partOf = (bone: string): Part | null => {
  const m = /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)(?:_0\d(?:_leaf)?)?_([lr])$/.exec(bone);
  return m ? ((m[2] + (m[1] === 'upperarm' ? 'u' : m[1] === 'lowerarm' ? 'f' : 'h')) as Part) : null;
};

/** which points of a shape are the torso's and which each part of each arm's (the same for every body made from the shape) */
interface Sorted {
  torso: Uint8Array;
  tris: Uint32Array;
  /** the faces that are the head's own */
  head: Uint32Array;
  parts: Record<Part, Uint32Array>;
}
const sortedOf = new WeakMap<THREE.BufferGeometry, Sorted>();
function sort(m: THREE.SkinnedMesh): Sorted {
  const had = sortedOf.get(m.geometry);
  if (had) return had;
  const P = m.geometry.getAttribute('position'), J = m.geometry.getAttribute('skinIndex'), Wt = m.geometry.getAttribute('skinWeight');
  const names = m.skeleton.bones.map((b) => b.name), isTorso = names.map((n) => TORSO.test(n)), part = names.map(partOf);
  const headBone = names.indexOf('Head'), onHead = new Uint8Array(P.count);
  const torso = new Uint8Array(P.count), lists = Object.fromEntries(PARTS.map((p) => [p, [] as number[]])) as Record<Part, number[]>;
  for (let i = 0; i < P.count; i++) {
    let t = 0;
    const w: Partial<Record<Part, number>> = {};
    for (let c = 0; c < 4; c++) {
      const j = J.getComponent(i, c), x = Wt.getComponent(i, c);
      if (isTorso[j]) t += x;
      if (j === headBone && x >= 0.6) onHead[i] = 1;
      const p = part[j];
      if (p) w[p] = (w[p] ?? 0) + x;
    }
    if (t >= 0.6) torso[i] = 1;
    for (const p of PARTS) if ((w[p] ?? 0) >= 0.5) lists[p].push(i);
  }
  const index = m.geometry.index, n = index ? index.count : P.count, tris: number[] = [], head: number[] = [];
  for (let k = 0; k + 2 < n; k += 3) {
    const a = index ? index.getX(k) : k, b = index ? index.getX(k + 1) : k + 1, c = index ? index.getX(k + 2) : k + 2;
    if (torso[a] && torso[b] && torso[c]) tris.push(a, b, c);
    if (onHead[a] && onHead[b] && onHead[c]) head.push(a, b, c);
  }
  const made: Sorted = { torso, tris: Uint32Array.from(tris), head: Uint32Array.from(head), parts: Object.fromEntries(PARTS.map((p) => [p, Uint32Array.from(lists[p])])) as Record<Part, Uint32Array> };
  sortedOf.set(m.geometry, made);
  return made;
}

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _b = new THREE.Vector3();
/** where every point of a skinned shape is in the world, as its bones stand this moment */
function skinned(m: THREE.SkinnedMesh): Float32Array {
  const P = m.geometry.getAttribute('position'), J = m.geometry.getAttribute('skinIndex'), Wt = m.geometry.getAttribute('skinWeight');
  const sk = m.skeleton, mats = sk.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, sk.boneInverses[i]).multiply(m.bindMatrix).elements);
  const after = _m.multiplyMatrices(m.matrixWorld, m.bindMatrixInverse).elements;
  const out = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    let X = 0, Y = 0, Z = 0;
    for (let c = 0; c < 4; c++) {
      const w = Wt.getComponent(i, c);
      if (!w) continue;
      const e = mats[J.getComponent(i, c)];
      X += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
      Y += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
      Z += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
    }
    out[i * 3] = after[0] * X + after[4] * Y + after[8] * Z + after[12];
    out[i * 3 + 1] = after[1] * X + after[5] * Y + after[9] * Z + after[13];
    out[i * 3 + 2] = after[2] * X + after[6] * Y + after[10] * Z + after[14];
  }
  return out;
}

const shown = (o: THREE.Object3D | null, upTo: THREE.Object3D) => {
  for (let p = o; p && p !== upTo.parent; p = p.parent) if (!p.visible) return false;
  return true;
};
const boneOf = (a: Any, n: string): THREE.Object3D => {
  let b: THREE.Object3D | null = null;
  a.root.traverse((o: THREE.Object3D) => void ((o as THREE.Bone).isBone && o.name === n && !b && (b = o)));
  return b!;
};
const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

/** The outside of a dressed body, or of its head, in one pose: see the top of the file. */
class Shape {
  /** where its line starts (the hips, or the bottom of the skull), and its own up, right and forward */
  P0: THREE.Vector3;
  U: THREE.Vector3;
  Rt: THREE.Vector3;
  Fw: THREE.Vector3;
  private k0 = 0;
  private n = 0;
  private cx!: Float32Array;
  private cf!: Float32Array;
  private has!: Uint8Array;
  private rad!: Float32Array;
  /** points laid on its faces: up, right, forward of the hips */
  private pts: number[] = [];

  constructor(from: THREE.Vector3, up: THREE.Vector3, right: THREE.Vector3) {
    this.P0 = from.clone();
    this.U = up.clone().normalize();
    this.Rt = right.clone();
    this.Rt.addScaledVector(this.U, -this.Rt.dot(this.U)).normalize();
    this.Fw = new THREE.Vector3().crossVectors(this.U, this.Rt);
  }

  /** every face of a thing that is one stiff piece (a vest, a pack, a helmet) */
  thing(holder: THREE.Object3D) {
    holder.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !shown(m, holder)) return;
      const P = m.geometry.getAttribute('position'), p = new Float32Array(P.count * 3);
      for (let i = 0; i < P.count; i++) _v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld).toArray(p, i * 3);
      const index = m.geometry.index, n = index ? index.count : P.count;
      for (let k = 0; k + 2 < n; k += 3) this.face(p, index ? index.getX(k) : k, index ? index.getX(k + 1) : k + 1, index ? index.getX(k + 2) : k + 2);
    });
  }

  private put(x: number, y: number, z: number) {
    const dx = x - this.P0.x, dy = y - this.P0.y, dz = z - this.P0.z;
    this.pts.push(dx * this.U.x + dy * this.U.y + dz * this.U.z, dx * this.Rt.x + dy * this.Rt.y + dz * this.Rt.z, dx * this.Fw.x + dy * this.Fw.y + dz * this.Fw.z);
  }

  /** a face, covered with points no further apart than GRID */
  face(p: ArrayLike<number>, a: number, b: number, c: number) {
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2], bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2], cx = p[c * 3], cy = p[c * 3 + 1], cz = p[c * 3 + 2];
    const long = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - bx, cy - by, cz - bz), Math.hypot(ax - cx, ay - cy, az - cz));
    const n = Math.min(60, Math.max(1, Math.ceil(long / GRID)));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n, w = 1 - u - v;
      this.put(ax * w + bx * u + cx * v, ay * w + by * u + cy * v, az * w + bz * u + cz * v);
    }
  }

  /** once every face is in: the outermost point each way round, slice by slice */
  close() {
    const p = this.pts;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      lo = Math.min(lo, p[i]);
      hi = Math.max(hi, p[i]);
    }
    this.k0 = Math.floor(lo / SLAB);
    this.n = Math.floor(hi / SLAB) - this.k0 + 1;
    const n = this.n, box = new Float32Array(n * 4).fill(NaN);
    for (let i = 0; i < p.length; i += 3) {
      const k = Math.floor(p[i] / SLAB) - this.k0, x = p[i + 1], f = p[i + 2];
      if (!(box[k * 4] <= x)) box[k * 4] = x;
      if (!(box[k * 4 + 1] >= x)) box[k * 4 + 1] = x;
      if (!(box[k * 4 + 2] <= f)) box[k * 4 + 2] = f;
      if (!(box[k * 4 + 3] >= f)) box[k * 4 + 3] = f;
    }
    this.cx = new Float32Array(n);
    this.cf = new Float32Array(n);
    this.has = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      if (Number.isNaN(box[k * 4])) continue;
      this.has[k] = 1;
      this.cx[k] = (box[k * 4] + box[k * 4 + 1]) / 2;
      this.cf[k] = (box[k * 4 + 2] + box[k * 4 + 3]) / 2;
    }
    this.rad = new Float32Array(n * BINS);
    for (let i = 0; i < p.length; i += 3) {
      const k = Math.floor(p[i] / SLAB) - this.k0, x = p[i + 1] - this.cx[k], f = p[i + 2] - this.cf[k];
      const b = this.bin(x, f), r = Math.hypot(x, f);
      if (r > this.rad[k * BINS + b]) this.rad[k * BINS + b] = r;
    }
    // (a way round with no point in it, between two that have: as far out as they are)
    for (let k = 0; k < n; k++) {
      if (!this.has[k]) continue;
      const row = this.rad.subarray(k * BINS, (k + 1) * BINS), was = Float32Array.from(row);
      for (let b = 0; b < BINS; b++) {
        if (was[b]) continue;
        let l = 0, r = 0, dl = 0, dr = 0;
        for (let d = 1; d <= 4 && !l; d++) if (was[(b - d + BINS) % BINS]) (l = was[(b - d + BINS) % BINS]), (dl = d);
        for (let d = 1; d <= 4 && !r; d++) if (was[(b + d) % BINS]) (r = was[(b + d) % BINS]), (dr = d);
        if (l && r) row[b] = (l * dr + r * dl) / (dl + dr);
      }
    }
    this.pts = [];
    return this;
  }

  private bin(x: number, f: number) {
    return Math.min(BINS - 1, Math.floor(((Math.atan2(x, f) + Math.PI) / (2 * Math.PI)) * BINS));
  }

  /** how far inside the body a point of the world is, metres: 0 outside it. `where` is given how high it is over the hips and which way round (degrees: 0 in front, 90 the body's right) */
  depth(x: number, y: number, z: number, where?: { up: number; round: number }): number {
    const dx = x - this.P0.x, dy = y - this.P0.y, dz = z - this.P0.z;
    const h = dx * this.U.x + dy * this.U.y + dz * this.U.z, X = dx * this.Rt.x + dy * this.Rt.y + dz * this.Rt.z, F = dx * this.Fw.x + dy * this.Fw.y + dz * this.Fw.z;
    const k = Math.floor(h / SLAB) - this.k0;
    if (k < 0 || k >= this.n || !this.has[k]) return 0;
    const lx = X - this.cx[k], lf = F - this.cf[k], r = Math.hypot(lx, lf), b = this.bin(lx, lf), R = this.rad[k * BINS + b];
    if (r >= R) return 0;
    if (where) {
      where.up = h;
      where.round = (Math.atan2(lx, lf) * 180) / Math.PI;
    }
    // the nearest way out: straight outward, or up, down or round to anywhere the body is no further out than this
    let best = R - r;
    for (let dk = -10; dk <= 10; dk++) {
      const kk = k + dk;
      const dh = dk === 0 ? 0 : dk > 0 ? (kk + this.k0) * SLAB - h : h - (kk + this.k0 + 1) * SLAB;
      if (dh >= best) continue;
      if (kk < 0 || kk >= this.n || !this.has[kk]) {
        best = dh;
        continue;
      }
      for (let db = -14; db <= 14; db++) {
        if (!dk && !db) continue;
        const bb = (b + db + BINS) % BINS, R2 = this.rad[kk * BINS + bb];
        const ang = db ? ((bb + 0.5) / BINS) * 2 * Math.PI - Math.PI : Math.atan2(lx, lf), rr = R2 <= r ? r : R2;
        const d = Math.hypot(this.cx[kk] + rr * Math.sin(ang) - X, this.cf[kk] + rr * Math.cos(ang) - F, dh);
        if (d < best) best = d;
      }
    }
    return best;
  }

  /** how far out the body is at a height over the hips, each of four ways: for looking at what was measured */
  girth(up: number) {
    const k = Math.floor(up / SLAB) - this.k0;
    if (k < 0 || k >= this.n || !this.has[k]) return null;
    const out = (deg: number) => +(this.rad[k * BINS + Math.min(BINS - 1, Math.floor(((deg + 180) / 360) * BINS))] * 100).toFixed(1);
    return { front: out(0), right: out(90), back: out(179), left: out(-90), mid: [+(this.cx[k] * 100).toFixed(1), +(this.cf[k] * 100).toFixed(1)] };
  }
}

const r1 = (x: number) => Math.round(x * 10) / 10;

const ST = {
  /** the outside of a body as it stands and as it is dressed this moment */
  shape(a: Any): Shape {
    a.root.updateMatrixWorld(true);
    const hips = at(boneOf(a, 'pelvis'));
    const s = new Shape(hips, at(boneOf(a, 'neck_01')).sub(hips), at(boneOf(a, 'upperarm_r')).sub(at(boneOf(a, 'upperarm_l'))));
    a.root.traverse((o: THREE.Object3D) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !shown(m, a.root)) return;
      const so = sort(m);
      if (!so.tris.length) return;
      const p = skinned(m);
      for (let k = 0; k < so.tris.length; k += 3) s.face(p, so.tris[k], so.tris[k + 1], so.tris[k + 2]);
    });
    // (a vest or a pack that is a thing of its own: whatever of what is worn hangs on the back and not the head)
    for (const holder of (a.gearObjs ?? []) as THREE.Object3D[]) if (holder.parent?.name === 'spine_03') s.thing(holder);
    return s.close();
  },

  /** the outside of its head as it is this moment: the hood, and the helmet (its visor as it is worn) and the mask on it */
  head(a: Any): Shape {
    a.root.updateMatrixWorld(true);
    const bone = boneOf(a, 'Head'), rest = a.gearRest?.get('Head');
    // (the head's own up and right: as the body stood at rest, carried by the head's bone)
    const M = rest ? new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, rest.inv) : bone.matrixWorld;
    const s = new Shape(at(bone), new THREE.Vector3(0, 1, 0).transformDirection(M), new THREE.Vector3(1, 0, 0).transformDirection(M));
    a.root.traverse((o: THREE.Object3D) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !shown(m, a.root)) return;
      const so = sort(m);
      if (!so.head.length) return;
      const p = skinned(m);
      for (let k = 0; k < so.head.length; k += 3) s.face(p, so.head[k], so.head[k + 1], so.head[k + 2]);
    });
    for (const holder of (a.gearObjs ?? []) as THREE.Object3D[]) if (holder.parent?.name === 'Head') s.thing(holder);
    return s.close();
  },

  /**
   * One body, this frame. Centimetres: how deep the worst point of each part of each arm is in the dressed body
   * (`ru` the right upper arm, `lf` the left forearm, `rh` the right hand), and of the gun (`gun`, with `gunAt`:
   * how far along the gun from its butt that point is). Then how the gun is held: `butt`, where the middle of its
   * butt is from the right shoulder's joint ([to the body's right, up, forward], as the chest stands); `elbowR` and
   * `elbowL`, how far each upper arm is out from hanging straight down the body's side ([out to its own side,
   * forward], degrees); `ext`, how much of each arm's length is used (1 is dead straight); `miss`, how far each
   * hand is from where the gun says it is held. And against the head with what is on it: `helm`, how deep the gun
   * is in the helmet, its visor, the mask or the head itself (`helmAt`: how far along the gun from its butt, and
   * how far over the head's bone and which way round that is); `armH`, how deep the worst of either arm is in it
   * (`armHAt`: which part).
   */
  measure(a: Any, shape: Shape = ST.shape(a), head: Shape = ST.head(a)) {
    const out: Any = {};
    const worst: Record<string, number> = Object.fromEntries(PARTS.map((p) => [p, 0]));
    const where: Any = {};
    const w = { up: 0, round: 0 };
    let armH = 0, armHAt = '';
    a.root.traverse((o: THREE.Object3D) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !shown(m, a.root)) return;
      const so = sort(m);
      if (!PARTS.some((p) => so.parts[p].length)) return;
      const p = skinned(m);
      for (const part of PARTS) {
        const side = part[0], upper = part[1] === 'u';
        const S = upper ? at(boneOf(a, `upperarm_${side}`)) : null, E = upper ? at(boneOf(a, `lowerarm_${side}`)).sub(S!) : null, len2 = E ? E.lengthSq() : 1;
        for (const i of so.parts[part]) {
          const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
          // (the top two fifths of an upper arm are in the shoulder)
          if (upper && ((x - S!.x) * E!.x + (y - S!.y) * E!.y + (z - S!.z) * E!.z) / len2 < 0.4) continue;
          const d = shape.depth(x, y, z, w);
          if (d > worst[part]) {
            worst[part] = d;
            where[part] = [Math.round(w.up * 100), Math.round(w.round)];
          }
          const dh = head.depth(x, y, z);
          if (dh > armH) (armH = dh), (armHAt = part);
        }
      }
    });
    for (const p of PARTS) out[p] = r1(worst[p] * 100);
    out.where = where;
    out.armH = r1(armH * 100);
    if (armH) out.armHAt = armHAt;
    const obj = a.held?.obj as THREE.Object3D | undefined;
    if (obj && a.holdT > 0.5) {
      // the gun: its own points, and its butt (the gun lies along its own x, muzzle at +x)
      obj.updateWorldMatrix(true, true);
      const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
      let deep = 0, deepAt = 0, minX = Infinity, maxX = -Infinity, helm = 0, helmAt = 0;
      const hw = { up: 0, round: 0 }, hAt = { up: 0, round: 0 };
      const butt = new THREE.Vector3(), buttN = { n: 0 };
      const pts: number[] = [];
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !shown(m, obj)) return;
        const P = m.geometry.getAttribute('position');
        for (let i = 0; i < P.count; i++) {
          _v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
          _b.copy(_v).applyMatrix4(inv);
          pts.push(_v.x, _v.y, _v.z, _b.x);
          minX = Math.min(minX, _b.x);
          maxX = Math.max(maxX, _b.x);
        }
      });
      for (let i = 0; i < pts.length; i += 4) {
        const d = shape.depth(pts[i], pts[i + 1], pts[i + 2]);
        if (d > deep) (deep = d), (deepAt = pts[i + 3] - minX);
        const dh = head.depth(pts[i], pts[i + 1], pts[i + 2], hw);
        if (dh > helm) (helm = dh), (helmAt = pts[i + 3] - minX), (hAt.up = hw.up), (hAt.round = hw.round);
        if (pts[i + 3] < minX + 0.012) {
          butt.x += pts[i];
          butt.y += pts[i + 1];
          butt.z += pts[i + 2];
          buttN.n++;
        }
      }
      out.gun = r1(deep * 100);
      out.gunAt = Math.round(deepAt * 100);
      out.gunLen = Math.round((maxX - minX) * 100);
      out.helm = r1(helm * 100);
      if (helm) out.helmAt = [Math.round(helmAt * 100), Math.round(hAt.up * 100), Math.round(hAt.round)];
      if (buttN.n) {
        butt.multiplyScalar(1 / buttN.n).sub(at(boneOf(a, 'upperarm_r')));
        out.butt = [r1(butt.dot(shape.Rt) * 100), r1(butt.dot(shape.U) * 100), r1(butt.dot(shape.Fw) * 100)];
      }
      for (const [side, grip, r] of [['R', a.held.grips.right, a.armR], ['L', a.held.grips.left, a.armL]] as [string, Any, Any][]) {
        if (grip && r && !a.gesture) out['miss' + side] = r1(grip.pos.clone().applyMatrix4(obj.matrixWorld).distanceTo(at(r.hand)) * 100);
      }
    }
    for (const [side, r, sgn] of [['R', a.armR, 1], ['L', a.armL, -1]] as [string, Any, number][]) {
      if (!r) continue;
      const S = at(r.arm), E = at(r.fore).sub(S), H = at(r.hand);
      out['ext' + side] = Math.round((S.distanceTo(H) / (r.la + r.lb)) * 100) / 100;
      const down = -E.dot(shape.U);
      out['elbow' + side] = [Math.round((Math.atan2(E.dot(shape.Rt) * sgn, down) * 180) / Math.PI), Math.round((Math.atan2(E.dot(shape.Fw), down) * 180) / Math.PI)];
    }
    return out;
  },

  /** every state a gun is held in: what `T.lineup` and `Avatar.update` are told, and how many moments of a stride or of a reload are tried */
  STATES: [
    ['stand, at ease', {}],
    ['walk', { speed: 1.6, phases: 8 }],
    ['jog', { speed: 3.4, phases: 8 }],
    ['sprint', { speed: 6.2, phases: 8 }],
    ['crouch', { crouch: true }],
    ['crouch-walk', { crouch: true, speed: 1.4, phases: 8 }],
    ['prone', { prone: true }],
    ['prone, aiming', { prone: true, aim: true }],
    ['aim level', { aim: true }],
    ['aim 45 up', { aim: true, pitch: 0.785 }],
    ['aim 45 down', { aim: true, pitch: -0.785 }],
    ['look 45 up', { pitch: 0.785 }],
    ['look 45 down', { pitch: -0.785 }],
    ['crouch, aiming', { crouch: true, aim: true }],
    ['walk, aiming', { speed: 1.6, aim: true, phases: 8 }],
    ['lean left', { lean: -1 }],
    ['lean right', { lean: 1 }],
    ['lean left, aiming', { lean: -1, aim: true }],
    ['lean right, aiming', { lean: 1, aim: true }],
    ['reload', { act: 'reload', actDur: 2.4, phases: 10 }],
  ] as [string, Any][],

  /** one body put in a state and left to settle in it (a second and a half of its own time) */
  pose(a: Any, st: Any, secs = 1.5) {
    const face = Math.PI, speed = st.speed ?? 0, dir = st.dir ?? 0;
    const vel = new THREE.Vector3(-Math.sin(face + dir) * speed, 0, -Math.cos(face + dir) * speed);
    a.__pos ??= a.root.position.clone();
    a.setLean(st.lean ?? 0);
    a.setProne(!!st.prone);
    a.act(null);
    a.gesture = null;
    const go = (dt: number) => a.update(dt, a.__pos, vel, face, !!st.crouch, false, false, st.pitch ?? 0, !st.air, !!st.aim);
    for (let k = 0; k < Math.round(secs * 60); k++) go(1 / 60);
    /** the same state at one moment of its stride, or of what its hands are doing (0..1) */
    return (u: number) => {
      if (st.act) {
        a.act(st.act, st.actDur ?? 2);
        a.gesture.t = u * (st.actDur ?? 2);
      } else a.phase = u;
      go(0);
      a.root.updateMatrixWorld(true);
    };
  },

  /**
   * The table: every kind of gun, in every state, bare, in the heavy kit (the K6-3 with its visor as it is worn, the
   * plate carrier, the rucksack), in the Combat Helmet over an armoured vest, and in a gas mask alone. One line for
   * each, with the worst of each part over the moments of that state that were tried (centimetres), and the moment
   * the whole was worst at.
   */
  async table(o: { guns?: string[]; kits?: Record<string, string[]>; states?: string[] } = {}) {
    const guns = o.guns ?? ['ak', 'ar15', 'mosin', 'mpa', 'benelli', 'm9'];
    const kits = o.kits ?? { bare: [], heavy: ['helmet_k63', 'life_vest', 'suitcase'], combat: ['boonie_hat', 'armor_vest'], mask: ['gasmask'] };
    const rows: Any[] = [];
    for (const [kit, gear] of Object.entries(kits)) {
      for (const gun of guns) {
        await T.lineup({ n: 1, view: 'front', weapon: gun, gear });
        const a = T.row[0] as Any;
        a.__pos = a.root.position.clone();
        for (const [name, st] of ST.STATES) {
          if (o.states && !o.states.includes(name)) continue;
          const at = ST.pose(a, st), n = st.phases ?? 1;
          const row: Any = { kit, weapon: gun, state: name, worst: 0 };
          for (let i = 0; i < n; i++) {
            at(n > 1 ? (i + (st.act ? 0.5 : 0)) / n : a.phase);
            const m = ST.measure(a);
            for (const k of [...PARTS, 'gun', 'helm', 'armH']) if ((m[k] ?? 0) > (row[k] ?? -1)) row[k] = m[k] ?? 0;
            if ((m.helm ?? 0) >= (row.helm ?? 0) && m.helmAt) row.helmAt = m.helmAt;
            if ((m.armH ?? 0) >= (row.armH ?? 0) && m.armHAt) row.armHAt = m.armHAt;
            const top = Math.max(...[...PARTS, 'gun'].map((k) => m[k] ?? 0));
            if (top >= row.worst) {
              row.worst = top;
              row.at = i;
              row.how = { butt: m.butt, elbowR: m.elbowR, elbowL: m.elbowL, extR: m.extR, extL: m.extL, missR: m.missR, missL: m.missL, where: m.where, gunAt: m.gunAt };
            }
          }
          rows.push(row);
        }
      }
    }
    return rows;
  },

  /**
   * Everything that is drawn of a body this moment, as bare triangles in the world (nine numbers each), and whose
   * each is: its skin piece by piece, each thing it wears, and what is in its hands (`held`). For drawing a pose
   * where there is no graphics card to draw it with (assets-src/_wf/me/stance-bench.mts).
   */
  soup(a: Any) {
    a.root.updateMatrixWorld(true);
    const names: string[] = [], own: number[] = [], p: number[] = [];
    const owner = (n: string) => (names.includes(n) ? names.indexOf(n) : names.push(n) - 1);
    const stiff = (top: THREE.Object3D, name: string) => {
      const k = owner(name);
      top.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !shown(m, top)) return;
        const P = m.geometry.getAttribute('position'), index = m.geometry.index, n = index ? index.count : P.count;
        for (let i = 0; i + 2 < n; i += 3) {
          for (let j = 0; j < 3; j++) _v.fromBufferAttribute(P, index ? index.getX(i + j) : i + j).applyMatrix4(m.matrixWorld).toArray(p, p.length);
          own.push(k);
        }
      });
    };
    a.root.traverse((o: THREE.Object3D) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !shown(m, a.root)) return;
      const k = owner(m.name), q = skinned(m), index = m.geometry.index, n = index ? index.count : q.length / 3;
      for (let i = 0; i + 2 < n; i += 3) {
        for (let j = 0; j < 3; j++) {
          const v = index ? index.getX(i + j) : i + j;
          p.push(q[v * 3], q[v * 3 + 1], q[v * 3 + 2]);
        }
        own.push(k);
      }
    });
    ((a.gearObjs ?? []) as THREE.Object3D[]).forEach((holder, i) => stiff(holder, `worn${i}`));
    if (a.held?.obj && a.holdT > 0.5) stiff(a.held.obj, 'held');
    return { names, own, p };
  },

  /** what a body reads with nothing in its hands, standing and walking: the cloth-on-cloth an arm at a side always has */
  async base(gear: string[] = []) {
    await T.lineup({ n: 1, view: 'front', gear });
    const a = T.row[0] as Any;
    const out: Any = {};
    for (const [name, st] of [['stand', {}], ['walk', { speed: 1.6, phases: 8 }]] as [string, Any][]) {
      const at = ST.pose(a, st), n = st.phases ?? 1, row: Any = {};
      for (let i = 0; i < n; i++) {
        at(n > 1 ? i / n : a.phase);
        const m = ST.measure(a);
        for (const k of PARTS) row[k] = Math.max(row[k] ?? 0, m[k]);
      }
      out[name] = row;
    }
    return out;
  },
};

W.ST = ST;
export default ST;
