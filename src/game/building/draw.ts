// The bases as they are drawn and stood on (2026-10-24). The owner: "imagine 100's of bases on the map, how will we
// handle this without pickup a performance cost". So: one instanced draw for each kind of piece in each tier, however
// many bases there are (the server tells a game only the bases near it: server/build.ts); and what stops a body or a
// bullet made only for the pieces near the player, and taken away again when they go. A door's leaves are drawn the
// same way, a draw for each leaf of each kind, and swing in place: solid at every angle, held where they meet the
// player's own body (src/sim/build/doors.ts).

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { BODY_QUERY, physics } from '../../core/physics';
import type { Atmosphere } from '../../world/atmosphere';
import { PIECES } from '../../sim/build/pieces';
import { shapeOf, type Leaf, type Paint } from '../../sim/build/solids';
import { toWorld, worldYaw, type Base, type Piece } from '../../sim/build/snap';
import { DOOR } from '../../sim/build/doors';
import { clothGeometry, drawnAt, geometryOf, leafGeometry, paintFor, surfaceOf } from './look';

/** what a blow or a bullet that lands on a piece struck */
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

  constructor(private scene: THREE.Scene, private atmo: Atmosphere | null) {}

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
    if (s.solid.length || s.dress?.length) parts.push({ key: `${piece.k}:${s.paint ?? t}`, matrix: frame, slot: 0 });
    if (s.cloth) parts.push({ key: `${piece.k}:${s.cloth.paint}:C`, matrix: frame, slot: 0 });
    (s.leaves ?? []).forEach((l, i) => parts.push({ key: `${piece.k}:${l.paint ?? t}:L${i}`, matrix: new THREE.Matrix4(), slot: 0 }));
    // (a door already drawn keeps how far it stood open, and swings on from there)
    const d: Drawn = { parts, frame, at: new THREE.Vector3(x, y, z), colliders: null, a: was ? was.a : piece.open ? 1 : 0, leafCols: null, base, piece };
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

  /** where each of a door's leaves is at `d.a`, drawn and solid */
  private pose(d: Drawn) {
    const leaves = shapeOf(d.piece.k).leaves ?? [];
    const first = d.parts.length - leaves.length;
    leaves.forEach((l, i) => {
      _h.makeTranslation(l.hinge[0], l.hinge[1], l.hinge[2]).multiply(_m.makeRotationAxis(l.axis === 'y' ? _up : _x, angleAt(l, d.a)));
      d.parts[first + i].matrix.multiplyMatrices(d.frame, _h);
    });
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
      const geo = more?.startsWith('L') ? leafGeometry(kind, Number(more.slice(1)), paint) : more === 'C' ? clothGeometry(kind) : geometryOf(kind, paint);
      m = new THREE.InstancedMesh(geo, paintFor(paint, this.atmo), Math.max(16, Math.ceil(list.length * 1.5)));
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
