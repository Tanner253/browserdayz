// The bases as they are drawn and stood on (2026-10-24). The owner: "imagine 100's of bases on the map, how will we
// handle this without pickup a performance cost". So: one instanced draw for each kind of piece in each tier, however
// many bases there are (the server tells a game only the bases near it: server/build.ts); and what stops a body or a
// bullet made only for the pieces near the player, and taken away again when they go. A door's leaves are drawn the
// same way, a draw for each leaf of each kind, and swing in place: solid at every angle, held where they meet the
// player's own body (src/sim/build/doors.ts).

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../../core/assets';
import { GLASS_GROUPS, BODY_QUERY, physics } from '../../core/physics';
import type { Atmosphere } from '../../world/atmosphere';
import { PIECES } from '../../sim/build/pieces';
import { shapeOf, type Leaf, type Paint } from '../../sim/build/solids';
import { toWorld, worldYaw, type Base, type Piece } from '../../sim/build/snap';
import { DOOR } from '../../sim/build/doors';
import { clothGeometry, drawnAt, geometryOf, leafGeometry, paintFor, surfaceOf } from './look';
import { PieceModels } from './models';
import { ClaimFlags } from './flags';

/** what a blow or a bullet that lands on a piece struck */
/**
 * A piece's own drawing, a hair off where it stands: by its number, a millimetre or two along each of its own lines and
 * up, and a shade smaller about its middle. No two pieces' faces then lie in one plane where they meet or overlap (two
 * walls' tops at a corner, two foundations' edges, a wall's face along its neighbour's), so none of them flicker against
 * each other (the owner, 2026-10-25: "building meshes and foundations and walls and things seem to overlap at the seams
 * causing visual glitches"). Its solids and its leaves are where it stands.
 */
const SEAM = { step: 0.0012, shrink: 0.0005 };
const _seam = new THREE.Matrix4(), _seamS = new THREE.Matrix4();
function seamless(frame: THREE.Matrix4, id: number) {
  const a = id % 3, b = Math.floor(id / 3) % 3, c = Math.floor(id / 9) % 4;
  _seam.makeTranslation((a - 1) * SEAM.step, c * SEAM.step, (b - 1) * SEAM.step);
  const k = 1 - SEAM.shrink * (1 + ((a + b + c) % 3));
  return frame.clone().multiply(_seam).multiply(_seamS.makeScale(k, k, k));
}

export class PieceRef {
  constructor(readonly b: number, readonly p: number) {}
}

export const NEAR = {
  /** colliders made for pieces this near the player, and taken away past the second */
  solid: 250,
  gone: 300,
};

const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0), _x = new THREE.Vector3(1, 0, 0);
const _m = new THREE.Matrix4(), _h = new THREE.Matrix4();

/** one thing drawn of a piece: the piece itself, or one of its leaves; `slot` its place in its kind's instanced draw */
interface Part {
  key: string;
  matrix: THREE.Matrix4;
  slot: number;
}

interface Drawn {
  parts: Part[];
  /** a lock fitted to it, as it is seen (kept where it is by `pose`, on its leaf if it has one) */
  lock: Part | null;
  /** where it stands in the world (its frame's matrix), for the colliders' nearness */
  frame: THREE.Matrix4;
  at: THREE.Vector3;
  colliders: RAPIER.Collider[] | null;
  /** a door: how far its leaves stand open (0 shut, 1 open), and each leaf's colliders */
  a: number;
  leafCols: RAPIER.Collider[][] | null;
  base: Base;
  piece: Piece;
}

/** a leaf's turn at `a` of the way open (eased: quick to start, soft to stop) */
const angleAt = (l: Leaf, a: number) => l.open * a * a * (3 - 2 * a);

export class BaseDraw {
  private meshes = new Map<string, THREE.InstancedMesh>();
  private drawn = new Map<string, Drawn>();
  private dirty = new Set<string>();
  /** the doors part way between shut and open */
  private moving = new Set<Drawn>();
  private solidT = 0;
  /** a door swung by somebody (its first move), and one held by the player's own body */
  onSwing: (b: Base, p: Piece, at: THREE.Vector3) => void = () => {};
  /** each kind of lock as it is fitted, out of its item's own model (null while that loads) */
  private locks = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] } | null>();

  /** the pieces drawn from models (src/game/building/models.ts) */
  readonly models: PieceModels;
  /** each claim's pole and flag (src/game/building/flags.ts), stood again each second */
  readonly flags: ClaimFlags;
  private flagT = 0;

  constructor(private scene: THREE.Scene, private atmo: Atmosphere | null) {
    this.models = new PieceModels(atmo, (kind) => this.remodel(kind));
    this.flags = new ClaimFlags(scene, atmo);
  }

  /** a kind's model come: what of it was drawn as its solids, drawn again */
  private remodel(kind: string) {
    for (const [key, m] of [...this.meshes]) {
      if (!key.startsWith(`${kind}:`)) continue;
      this.scene.remove(m);
      m.dispose();
      this.meshes.delete(key);
      this.dirty.add(key);
    }
  }

  /**
   * A key lock's or a code lock's model (`key_lock`, `code_lock`), fitted as the lock is at a piece's `lockAt`: its
   * back plate flat on the leaf at z 0, about its own middle, its front out along +z and its bolt toward the leaf's
   * free edge. (The models face +x, their back plates at -x. The navigator, 2026-10-25: "Mount it at your door's
   * lockAt with its back plate flat on the leaf, the bolt toward the frame. On the ground and in hand it's the same
   * model.")
   */
  private lockModel(k: string) {
    if (!this.locks.has(k)) {
      this.locks.set(k, null);
      void assets.model(`${k}_lock`).then((root) => {
        root.updateMatrixWorld(true);
        const meshes: THREE.Mesh[] = [];
        root.traverse((o) => void ((o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh)));
        const parts = meshes.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld));
        const geo = parts.length === 1 ? parts[0] : mergeGeometries(parts, true)!;
        geo.rotateY(-Math.PI / 2).computeBoundingBox();
        const b = geo.boundingBox!;
        geo.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.min.z).computeBoundingSphere();
        // (its own copy of the paint, put in the world's light as the ground's things are: src/game/loot.ts seenParts)
        const mats = meshes.map((m) => (m.material as THREE.Material).clone());
        for (const m of mats) this.atmo?.register(m);
        this.locks.set(k, { geo, mat: mats.length === 1 ? mats[0] : mats });
        this.dirty.add(`__lock:steel:${k}`);
      }, () => {});
    }
    return this.locks.get(k) ?? null;
  }

  private id = (b: number, p: number) => `${b}:${p}`;

  /** a piece laid or changed (its tier, where it is, whether it stands open) */
  put(base: Base, piece: Piece) {
    const id = this.id(base.id, piece.id);
    const was = this.drawn.get(id);
    if (was) {
      for (const q of was.parts) this.dirty.add(q.key);
      this.unsolid(was);
      this.moving.delete(was);
    }
    const [x, y, z] = toWorld(base, piece.x, piece.y, piece.z);
    _q.setFromAxisAngle(_up, worldYaw(base, piece.r));
    const frame = new THREE.Matrix4().compose(_p.set(x, y, z), _q, _one);
    // (a draw for the piece in its paint, one for what of it is in a paint of its own, and one for each leaf)
    const s = shapeOf(piece.k), t = drawnAt(piece.k, piece.t), parts: Part[] = [];
    const body = seamless(frame, piece.id);
    if (s.solid.length || s.dress?.length) parts.push({ key: `${piece.k}:${s.paint ?? t}`, matrix: body, slot: 0 });
    if (s.cloth) parts.push({ key: `${piece.k}:${s.cloth.paint}:C`, matrix: body, slot: 0 });
    // (its lock, if one is fitted: before the leaves, which are always the last of its parts)
    const lock: Part | null = piece.lock && s.lockAt ? { key: `__lock:steel:${piece.lock.k}`, matrix: new THREE.Matrix4(), slot: 0 } : null;
    if (lock) parts.push(lock);
    (s.leaves ?? []).forEach((l, i) => parts.push({ key: `${piece.k}:${l.paint ?? t}:L${i}`, matrix: new THREE.Matrix4(), slot: 0 }));
    // (a door already drawn keeps how far it stood open, and swings on from there)
    const d: Drawn = { parts, lock, frame, at: new THREE.Vector3(x, y, z), colliders: null, a: was ? was.a : piece.open ? 1 : 0, leafCols: null, base, piece };
    this.pose(d);
    if (d.a !== (piece.open ? 1 : 0)) this.moving.add(d);
    this.drawn.set(id, d);
    for (const q of parts) this.dirty.add(q.key);
    // (made at once if near: what was just laid is stood on straight away)
    this.solidT = 0;
  }

  /** a door's leaves told to swing to where its piece now says (open or shut) */
  swing(b: number, p: number) {
    const d = this.drawn.get(this.id(b, p));
    if (!d || d.a === (d.piece.open ? 1 : 0)) return;
    this.moving.add(d);
    this.onSwing(d.base, d.piece, d.at);
  }

  /** a whole base (told whole, or read again) */
  setBase(base: Base) {
    this.forget(base.id);
    for (const p of base.pieces.values()) this.put(base, p);
  }

  remove(b: number, ids: number[]) {
    for (const p of ids) {
      const d = this.drawn.get(this.id(b, p));
      if (!d) continue;
      this.unsolid(d);
      this.moving.delete(d);
      for (const q of d.parts) this.dirty.add(q.key);
      this.drawn.delete(this.id(b, p));
    }
  }

  /** every piece of a base out of the world (gone, or far off) */
  forget(b: number) {
    for (const [id, d] of [...this.drawn]) if (d.base.id === b) this.remove(b, [Number(id.split(':')[1])]);
  }

  clear() {
    this.flags.clear();
    for (const d of this.drawn.values()) this.unsolid(d);
    for (const d of this.drawn.values()) for (const q of d.parts) this.dirty.add(q.key);
    this.drawn.clear();
    this.moving.clear();
  }

  /** the piece a collider is (a blow, an aim) */
  pieceOf(ref: PieceRef): Drawn | undefined {
    return this.drawn.get(this.id(ref.b, ref.p));
  }

  update(dt: number, eye: THREE.Vector3) {
    for (const key of this.dirty) this.rebuild(key);
    this.dirty.clear();
    this.models.tick(dt);
    if ((this.flagT -= dt) <= 0) {
      this.flagT = 1;
      this.flags.sync(new Set([...this.drawn.values()].filter((d) => d.piece.k === 'claim').map((d) => d.base)));
    }
    this.flags.update(dt);
    for (const d of this.moving) this.step(d, dt);
    // (the colliders, twice a second: made for what has come near, taken away from what is far)
    this.solidT -= dt;
    if (this.solidT > 0) return;
    this.solidT = 0.5;
    for (const d of this.drawn.values()) {
      const far = d.at.distanceTo(eye);
      if (!d.colliders && far < NEAR.solid) this.solid(d);
      else if (d.colliders && far > NEAR.gone) this.unsolid(d);
    }
  }

  /** the pieces near a place made solid now, not at the next half second: whoever is stood there stands on them from the first frame */
  solidNear(at: THREE.Vector3) {
    for (const d of this.drawn.values()) if (!d.colliders && d.at.distanceTo(at) < NEAR.solid) this.solid(d);
  }

  /** where each of a door's leaves is at `d.a`, drawn and solid */
  private pose(d: Drawn) {
    const s = shapeOf(d.piece.k), leaves = s.leaves ?? [];
    const first = d.parts.length - leaves.length;
    leaves.forEach((l, i) => {
      _h.makeTranslation(l.hinge[0], l.hinge[1], l.hinge[2]).multiply(_m.makeRotationAxis(l.axis === 'y' ? _up : _x, angleAt(l, d.a)));
      d.parts[first + i].matrix.multiplyMatrices(d.frame, _h);
    });
    if (d.lock && s.lockAt) {
      const on = s.lockAt.leaf !== undefined ? d.parts[first + s.lockAt.leaf].matrix : d.frame, [x, y, z] = s.lockAt.at;
      _h.makeTranslation(x, y, z);
      if (s.lockAt.up) _h.multiply(_m.makeRotationX(-Math.PI / 2));
      d.lock.matrix.multiplyMatrices(on, _h);
    }
  }

  /** a door's leaves on toward where it is going, unless the player's own body is where they would be */
  private step(d: Drawn, dt: number) {
    const to = d.piece.open ? 1 : 0, was = d.a;
    d.a = to > d.a ? Math.min(1, d.a + dt / DOOR.swing) : Math.max(0, d.a - dt / DOOR.swing);
    this.pose(d);
    if (d.leafCols && this.blocked(d)) {
      // (it stops on the body, and holds there until the way is clear)
      d.a = was;
      this.pose(d);
      return;
    }
    this.placeLeaves(d);
    if (d.a === to) {
      this.moving.delete(d);
      for (const q of d.parts.slice(d.parts.length - (shapeOf(d.piece.k).leaves?.length ?? 0))) this.meshes.get(q.key)?.computeBoundingSphere();
    }
  }

  /** whether the player's body is where a door's leaves now are */
  private blocked(d: Drawn) {
    const leaves = shapeOf(d.piece.k).leaves ?? [], first = d.parts.length - leaves.length;
    return leaves.some((l, i) => l.solid.some((s) => {
      if (!('box' in s)) return false;
      const [cx, cy, cz, sx, sy, sz] = s.box;
      d.parts[first + i].matrix.decompose(_s, _q, _p);
      _p.set(cx, cy, cz).applyMatrix4(d.parts[first + i].matrix);
      return physics.world.intersectionWithShape(_p, _q, new physics.R.Cuboid(sx / 2, sy / 2, sz / 2), undefined, BODY_QUERY) !== null;
    }));
  }

  /** a door's leaves, as `pose` left them, put where they are drawn and where they stop things */
  private placeLeaves(d: Drawn) {
    const leaves = shapeOf(d.piece.k).leaves ?? [], first = d.parts.length - leaves.length;
    leaves.forEach((l, i) => {
      const q = d.parts[first + i], m = this.meshes.get(q.key);
      if (m && q.slot < m.count) {
        m.setMatrixAt(q.slot, q.matrix);
        m.instanceMatrix.needsUpdate = true;
      }
      const cols = d.leafCols?.[i];
      if (!cols) return;
      q.matrix.decompose(_s, _q, _p);
      l.solid.forEach((s, k) => {
        if (!('box' in s) || !cols[k]) return;
        _p.set(s.box[0], s.box[1], s.box[2]).applyMatrix4(q.matrix);
        cols[k].setTranslation({ x: _p.x, y: _p.y, z: _p.z });
        cols[k].setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
      });
    });
  }

  private rebuild(key: string) {
    const list: Part[] = [];
    for (const d of this.drawn.values()) for (const q of d.parts) if (q.key === key) list.push(q);
    let m = this.meshes.get(key);
    if (!m || m.instanceMatrix.count < list.length) {
      if (m) {
        this.scene.remove(m);
        m.dispose();
      }
      const [kind, name, more] = key.split(':'), paint = (/^\d$/.test(name) ? Number(name) : name) as Paint;
      // (a lock is drawn once its model is in: lockModel marks it to be drawn again then)
      const lock = kind === '__lock' ? this.lockModel(more) : null;
      if (kind === '__lock' && !lock) return;
      // (a piece drawn from its model, src/game/building/models.ts: as its solids until the model has come)
      const look = lock ? null : this.models.get(kind, more ?? '');
      if (look === 'hide') return;
      const geo = lock ? lock.geo : look ? look.geo : more?.startsWith('L') ? leafGeometry(kind, Number(more.slice(1)), paint) : more === 'C' ? clothGeometry(kind) : geometryOf(kind, paint);
      // (a leaf with ironwork is two groups, its paint and its iron: see leafGeometry)
      const mat = lock ? lock.mat : look ? look.mat : geo.groups.length > 1 ? [paintFor(paint, this.atmo), paintFor('iron', this.atmo)] : paintFor(paint, this.atmo);
      m = new THREE.InstancedMesh(geo, mat, Math.max(16, Math.ceil(list.length * 1.5)));
      m.castShadow = m.receiveShadow = true;
      m.name = `base:${key}`;
      this.scene.add(m);
      this.meshes.set(key, m);
    }
    list.forEach((q, i) => {
      q.slot = i;
      m!.setMatrixAt(i, q.matrix);
    });
    m.count = list.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.visible = list.length > 0;
  }

  private solid(d: Drawn) {
    const s = shapeOf(d.piece.k), t = drawnAt(d.piece.k, d.piece.t), surface = surfaceOf(s.paint ?? t);
    const owner = new PieceRef(d.base.id, d.piece.id);
    _q.setFromAxisAngle(_up, worldYaw(d.base, d.piece.r));
    const q = { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
    d.colliders = s.solid.map((s) => {
      if ('box' in s) {
        const [cx, cy, cz, sx, sy, sz] = s.box;
        _p.set(cx, cy, cz).applyQuaternion(_q).add(d.at);
        return physics.addStaticQuat(physics.R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2), surface, { x: _p.x, y: _p.y, z: _p.z }, q, owner);
      }
      const pts = 'prism' in s ? s.prism.flatMap(([x, z]) => [x, s.y0, z, x, s.y1, z]) : s.hull.flat();
      const desc = physics.R.ColliderDesc.convexHull(new Float32Array(pts));
      return desc ? physics.addStaticQuat(desc, surface, { x: d.at.x, y: d.at.y, z: d.at.z }, q, owner) : null;
    }).filter((c): c is RAPIER.Collider => !!c);
    // (the slopes stairs are walked up on: felt by a body alone, never drawn)
    for (const w of s.walk ?? []) {
      if (!('hull' in w)) continue;
      const desc = physics.R.ColliderDesc.convexHull(new Float32Array(w.hull.flat()));
      const c = desc ? physics.addStaticQuat(desc, surface, { x: d.at.x, y: d.at.y, z: d.at.z }, q, owner, GLASS_GROUPS) : null;
      if (c) d.colliders.push(c);
    }
    // (each leaf a box or more, put where the leaf now is)
    d.leafCols = (s.leaves ?? []).map((l) => l.solid.map((b) => ('box' in b ? physics.addStaticQuat(physics.R.ColliderDesc.cuboid(b.box[3] / 2, b.box[4] / 2, b.box[5] / 2), surfaceOf(l.paint ?? t), { x: 0, y: 0, z: 0 }, q, owner) : null)).filter((c): c is RAPIER.Collider => !!c));
    if (d.leafCols.length) this.placeLeaves(d);
  }

  private unsolid(d: Drawn) {
    for (const c of d.colliders ?? []) physics.world.removeCollider(c, false);
    for (const c of (d.leafCols ?? []).flat()) physics.world.removeCollider(c, false);
    d.colliders = null;
    d.leafCols = null;
  }

  /** how many pieces are drawn, and how many stand solid (for a test's word) */
  get counts() {
    let solid = 0;
    for (const d of this.drawn.values()) if (d.colliders) solid++;
    return { drawn: this.drawn.size, solid, draws: [...this.meshes.values()].filter((m) => m.visible).length, moving: this.moving.size };
  }

  /** how far a door stands open, 0 to 1 (a test's word) */
  openness(b: number, p: number) {
    return this.drawn.get(this.id(b, p))?.a ?? null;
  }
}

export { PIECES };
