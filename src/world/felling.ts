// Trees felled and standing again, as they are seen (2026-10-24, base building's first step; the rules are
// src/sim/gather.ts). A felled tree is taken out of the forest's own drawing (Vegetation.fell) and a copy of it falls
// where it stood, pivoting on its foot as a pole does, lands with a bounce, lies a moment and goes into the ground; a
// stump is left. When it grows back the stump goes and the tree is there again.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { extractParts } from '../core/gltf-utils';
import { TREE_KINDS } from '../sim/gather';
import type { Instance } from './worldgen';

/** what a blow that lands on a tree's trunk or a breakable rock struck: its number in the world's list */
export class TreeRef {
  constructor(public readonly i: number) {}
}
export class RockRef {
  constructor(public readonly i: number) {}
}

/** what of the forest's drawing this needs (src/world/vegetation.ts) */
interface Forest {
  fell(i: number, down: boolean): void;
  falling(i: number): { parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[]; matrix: THREE.Matrix4 } | null;
}

export const FALL = {
  /** a fall is drawn only for an eye this near: further off the tree is simply gone */
  seen: 160,
  /** seconds it lies after landing, and going into the ground, and how far it goes */
  rest: 3.5,
  sink: 1.4,
  deep: 7,
  /** the stump's width across (its roots and all), over the trunk's */
  stump: 1.5,
  most: 1024,
};

const UP = new THREE.Vector3(0, 1, 0);
const _r = new THREE.Matrix4(), _t = new THREE.Matrix4(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

interface Fall {
  i: number;
  meshes: THREE.InstancedMesh[];
  base: THREE.Matrix4;
  foot: THREE.Vector3;
  axis: THREE.Vector3;
  /** angle from upright, its speed, how far over it can go, and the pole's effective length */
  th: number;
  w: number;
  most: number;
  len: number;
  /** seconds since it landed (-1: still falling), and how deep it has gone */
  lay: number;
  sunk: number;
}

const footY = (t: Instance) => (t.lean ? t.lean[2] : t.y);

export class Felling {
  private falls: Fall[] = [];
  private stumps: THREE.InstancedMesh[] = [];
  private stumpAt = new Map<number, number>();
  private stumpBox = new THREE.Box3();
  private loading: Promise<void> | null = null;
  /** said when a tree begins to go, and when it lands */
  onSound: (at: THREE.Vector3, land: boolean) => void = () => {};

  constructor(private scene: THREE.Scene, private forest: Forest, private trees: Instance[]) {}

  /** the trees that are down when this game comes in: gone, a stump each */
  down(list: number[]) {
    for (const i of list) {
      this.gone.add(i);
      this.forest.fell(i, true);
      void this.stump(i, true);
    }
  }

  /** every tree standing again (another server, or none: src/game/modes.ts) */
  reset() {
    for (const i of [...this.gone]) this.grow(i);
  }

  /** the trees down now */
  private gone = new Set<number>();

  /** tree `i` has been felled, and falls toward `a` (a yaw): seen from `eye` */
  fell(i: number, a: number, eye: THREE.Vector3) {
    const t = this.trees[i];
    if (!t || this.gone.has(i)) return;
    this.gone.add(i);
    this.forest.fell(i, true);
    void this.stump(i, true);
    const foot = new THREE.Vector3(t.x, footY(t), t.z);
    if (eye.distanceTo(foot) > FALL.seen) return;
    const copy = this.forest.falling(i);
    if (!copy) return;
    const meshes = copy.parts.map((p) => {
      const m = new THREE.InstancedMesh(p.geometry, p.material, 1);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.setMatrixAt(0, copy.matrix);
      this.scene.add(m);
      return m;
    });
    const h = (TREE_KINDS[t.kind]?.height ?? 15) * t.scale;
    // (it goes over toward `a` about the line through its foot square to that)
    const axis = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    this.falls.push({ i, meshes, base: copy.matrix, foot, axis, th: 0.05, w: 0.12, most: Math.PI / 2 - 0.06, len: h * 0.62, lay: -1, sunk: 0 });
    this.onSound(foot, false);
  }

  /** tree `i` stands again */
  grow(i: number) {
    const k = this.falls.findIndex((f) => f.i === i);
    if (k >= 0) this.drop(k);
    this.gone.delete(i);
    this.forest.fell(i, false);
    void this.stump(i, false);
  }

  update(dt: number) {
    for (let k = this.falls.length - 1; k >= 0; k--) {
      const f = this.falls[k];
      if (f.lay < 0) {
        // a pole tipping over on its foot: it goes slowly at first and hits the ground fast
        f.w += ((3 * 9.8) / (2 * f.len)) * Math.sin(f.th) * dt;
        f.th += f.w * dt;
        if (f.th >= f.most) {
          f.th = f.most;
          if (f.w > 0.6) {
            if (f.w > 1) this.onSound(new THREE.Vector3().copy(f.axis).cross(UP).multiplyScalar(f.len).add(f.foot), true);
            f.w *= -0.18;
          } else {
            f.w = 0;
            f.lay = 0;
          }
        }
      } else {
        f.lay += dt;
        if (f.lay > FALL.rest) f.sunk = Math.min(FALL.deep, f.sunk + (dt / FALL.sink) * FALL.deep);
        if (f.lay > FALL.rest + FALL.sink) {
          this.drop(k);
          continue;
        }
      }
      _q.setFromAxisAngle(f.axis, f.th);
      _r.makeRotationFromQuaternion(_q);
      _t.makeTranslation(-f.foot.x, -f.foot.y, -f.foot.z);
      _m.makeTranslation(f.foot.x, f.foot.y - f.sunk, f.foot.z).multiply(_r).multiply(_t).multiply(f.base);
      for (const m of f.meshes) {
        m.setMatrixAt(0, _m);
        m.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private drop(k: number) {
    for (const m of this.falls[k].meshes) {
      this.scene.remove(m);
      m.dispose();
    }
    this.falls.splice(k, 1);
  }

  /** a stump where tree `i` stood (the Poly Haven stump, sized to the trunk), or none */
  private async stump(i: number, on: boolean) {
    if (!this.stumps.length) {
      this.loading ??= (async () => {
        const parts = extractParts(await assets.model('tree_stump_01'));
        for (const p of parts) {
          p.geometry.computeBoundingBox();
          this.stumpBox.union(p.geometry.boundingBox!);
        }
        this.stumps = parts.map((p) => {
          const m = new THREE.InstancedMesh(p.geometry, p.material, FALL.most);
          m.count = 0;
          m.castShadow = true;
          m.receiveShadow = true;
          m.frustumCulled = false;
          this.scene.add(m);
          return m;
        });
      })();
      await this.loading;
    }
    const had = this.stumpAt.get(i);
    if (on === (had !== undefined)) return;
    if (on) {
      const n = this.stumps[0].count;
      if (n >= FALL.most) return;
      const t = this.trees[i], size = this.stumpBox.getSize(new THREE.Vector3());
      const across = Math.max(0.3, 2 * Math.min(TREE_KINDS[t.kind]?.trunk ?? 0.3, 0.5) * t.scale * FALL.stump);
      const s = across / Math.max(0.01, Math.max(size.x, size.z));
      _m.compose(new THREE.Vector3(t.x, footY(t) - this.stumpBox.min.y * s - 0.05, t.z), _q.setFromAxisAngle(UP, t.rot), new THREE.Vector3(s, s, s));
      for (const m of this.stumps) {
        m.setMatrixAt(n, _m);
        m.count = n + 1;
        m.instanceMatrix.needsUpdate = true;
      }
      this.stumpAt.set(i, n);
    } else {
      // (the last stump is moved into the place of the one that goes)
      const last = this.stumps[0].count - 1;
      const lastTree = [...this.stumpAt].find(([, n]) => n === last)?.[0];
      for (const m of this.stumps) {
        m.getMatrixAt(last, _m);
        m.setMatrixAt(had!, _m);
        m.count = last;
        m.instanceMatrix.needsUpdate = true;
      }
      if (lastTree !== undefined) this.stumpAt.set(lastTree, had!);
      this.stumpAt.delete(i);
    }
  }
}
