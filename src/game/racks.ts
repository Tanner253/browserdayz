// Gun racks that show what stands in them (the owner, 2026-10-17: "renders guns on the 3d model that are in its
// inventory"): each rack's long guns stood in its cups, butt down, each its own model as it lies in the world, and
// its pistols and pairs laid on its shelves. Only the racks near the eye have theirs drawn. What each holds is said by
// the server online (`racks` in the welcome, then 'rack'), and by the rack's own contents offline (RACKS, rackShows).

import * as THREE from 'three';
import { ITEMS } from '../sim/items';
import type { ItemModels } from './loot';

/**
 * Where things stand in a rack, in its own space (metres; its front is +z, its floor y 0): the cups the long guns stand
 * in, left to right, each [x, z] with the height their butts rest at; and its shelves, each [x, y, z], one small gun to a
 * shelf. How far back a long gun leans against the holder over it (radians).
 */
export interface RackPlan { cups: [number, number][]; cupY: number; shelves: [number, number, number][]; lean: number }

/** drawn within this many metres, put away beyond the second */
const NEAR = 28, FAR = 36;

interface Rack {
  at: THREE.Vector3;
  rot: number;
  ids: string[];
  /** what is drawn for it now, and of what (its ids, joined); the drawing in hand, if one is being made */
  group: THREE.Group | null;
  drawn: string;
  making: boolean;
}

const _box = new THREE.Box3();

export class GunRacks {
  private racks = new Map<string, Rack>();
  /** how each sort is turned to stand, worked out once: the turn that stands it butt down with its side to the front */
  private stand = new Map<string, THREE.Quaternion>();

  constructor(private scene: THREE.Scene, private models: ItemModels, private plan: RackPlan) {}

  /** a rack in the world, by its crate's id: where it stands and which way it faces */
  add(cid: string, x: number, y: number, z: number, rot: number) {
    if (!this.racks.has(cid)) this.racks.set(cid, { at: new THREE.Vector3(x, y, z), rot, ids: [], group: null, drawn: '', making: false });
  }

  has(cid: string) {
    return this.racks.has(cid);
  }

  /** what stands in it now (see rackShows) */
  show(cid: string, ids: readonly string[]) {
    const r = this.racks.get(cid);
    if (r) r.ids = [...ids];
  }

  update(eye: THREE.Vector3) {
    for (const r of this.racks.values()) {
      const d2 = r.at.distanceToSquared(eye);
      if (d2 > FAR * FAR) {
        if (r.group) this.putAway(r);
        continue;
      }
      if (d2 < NEAR * NEAR && !r.making && r.drawn !== r.ids.join(',')) void this.draw(r);
    }
  }

  private putAway(r: Rack) {
    r.group?.removeFromParent();
    r.group = null;
    r.drawn = '';
  }

  private async draw(r: Rack) {
    r.making = true;
    const ids = [...r.ids], g = new THREE.Group();
    g.position.copy(r.at);
    g.rotation.y = r.rot;
    try {
      const long = ids.filter((id) => standsUp(id)).slice(0, this.plan.cups.length);
      const small = ids.filter((id) => !standsUp(id)).slice(0, this.plan.shelves.length);
      for (const [k, id] of long.entries()) {
        const obj = await this.stood(id);
        if (!obj) continue;
        const [x, z] = this.plan.cups[k];
        // (stood on its butt in the cup, leaning back a little against the holder over it)
        _box.setFromObject(obj);
        const pivot = new THREE.Group();
        pivot.position.set(x, this.plan.cupY, z);
        pivot.rotation.x = -this.plan.lean;
        obj.position.set(-(_box.min.x + _box.max.x) / 2, -_box.min.y, -(_box.min.z + _box.max.z) / 2);
        pivot.add(obj);
        g.add(pivot);
      }
      for (const [k, id] of small.entries()) {
        const tpl = await this.models.get(id);
        const obj = tpl.group.clone();
        const [x, y, z] = this.plan.shelves[k];
        // (laid on the board as it lies on the ground: across it if it fits that way, else front to back)
        const across = Math.max(tpl.size.x, tpl.size.z) <= 0.36;
        if (across === tpl.size.z > tpl.size.x) obj.rotation.y = Math.PI / 2;
        obj.updateMatrixWorld(true);
        _box.setFromObject(obj);
        obj.position.set(x - (_box.min.x + _box.max.x) / 2, y - _box.min.y, z - (_box.min.z + _box.max.z) / 2);
        g.add(obj);
      }
    } finally {
      r.making = false;
    }
    // (what was asked for may have changed while it was being made: drawn as asked, and made again next time if not)
    this.putAway(r);
    g.updateMatrixWorld(true);
    this.scene.add(g);
    r.group = g;
    r.drawn = ids.join(',');
  }

  /**
   * One of a sort stood upright: its length up, its butt down, the side it lies on turned to the front. Which end is
   * its butt is found from its own shape: the stock is the taller end, the muzzle the thinner one.
   */
  private async stood(id: string): Promise<THREE.Object3D | null> {
    const tpl = await this.models.get(id);
    const obj = tpl.group.clone();
    let q = this.stand.get(id);
    if (!q) {
      // (it lies grounded: its length along x or z, the side it lies on up)
      const alongX = tpl.size.x >= tpl.size.z;
      const L = alongX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const S = new THREE.Vector3(0, 1, 0);
      const butt = buttEnd(tpl.group, alongX);
      // length to +y (butt down), the lying side to +z (the front), and the third to make a turn of it
      const up = L.clone().multiplyScalar(butt > 0 ? -1 : 1);
      const third = new THREE.Vector3().crossVectors(up, S);
      const m = new THREE.Matrix4().makeBasis(third, up, S).invert();
      q = new THREE.Quaternion().setFromRotationMatrix(m);
      this.stand.set(id, q);
    }
    obj.quaternion.copy(q);
    obj.updateMatrixWorld(true);
    return obj;
  }
}

/** the long guns stand in the cups; pistols and pairs lie on the shelves */
function standsUp(id: string) {
  const d = ITEMS[id];
  return !!d?.weapon && d.slot === 'long' && !d.weapon.akimbo;
}

/**
 * Which end of a gun lying grounded is its butt: +1 the far end of its length, -1 the near. The end whose last sixth is
 * the bigger across (its height by its width) is the stock: a barrel's end is the thinnest thing on a gun.
 */
function buttEnd(group: THREE.Object3D, alongX: boolean): number {
  let lo = Infinity, hi = -Infinity;
  const pts: [number, number, number][] = [];
  const v = new THREE.Vector3();
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    const to = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const step = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(to);
      const a = alongX ? v.x : v.z;
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
      pts.push([a, v.y, alongX ? v.z : v.x]);
    }
  });
  const cut = (hi - lo) / 6, ends = [[Infinity, -Infinity, Infinity, -Infinity], [Infinity, -Infinity, Infinity, -Infinity]];
  for (const [a, y, w] of pts) {
    const e = a < lo + cut ? ends[0] : a > hi - cut ? ends[1] : null;
    if (!e) continue;
    e[0] = Math.min(e[0], y);
    e[1] = Math.max(e[1], y);
    e[2] = Math.min(e[2], w);
    e[3] = Math.max(e[3], w);
  }
  const across = (e: number[]) => Math.max(0, e[1] - e[0]) * Math.max(0, e[3] - e[2]);
  return across(ends[1]) >= across(ends[0]) ? 1 : -1;
}

/** the rack's cups and shelves (see RackPlan), read off its shape (progress/rack-plan/rack-shape.mjs): four cups across
 * its gun bay, a little forward, their holders 1.55 m up at its back; boards down the column on its left */
export const RACK_PLAN: RackPlan = {
  cups: [[-0.12, 0.1], [0.12, 0.1], [0.32, 0.1], [0.56, 0.1]],
  cupY: 0.07,
  shelves: [[-0.5, 0.555, 0], [-0.5, 0.925, 0], [-0.5, 1.265, 0], [-0.5, 0.125, 0]],
  lean: 0.2,
};
