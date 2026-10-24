// The bases as they are drawn and stood on (2026-10-24). The owner: "imagine 100's of bases on the map, how will we
// handle this without pickup a performance cost". So: one instanced draw for each kind of piece in each tier, however
// many bases there are (the server tells a game only the bases near it: server/build.ts); and what stops a body or a
// bullet made only for the pieces near the player, and taken away again when they go.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { physics } from '../../core/physics';
import type { Atmosphere } from '../../world/atmosphere';
import { PIECES, type Tier } from '../../sim/build/pieces';
import { shapeOf } from '../../sim/build/solids';
import { toWorld, worldYaw, type Base, type Piece } from '../../sim/build/snap';
import { SURFACE, drawnAt, dressOf, flagPaint, geometryOf, paintsOf } from './look';

/** kinds whose dress is drawn apart, in a paint of its own (the claim's flag) */
const CLOTH = new Set(['claim']);

/** what a blow or a bullet that lands on a piece struck */
export class PieceRef {
  constructor(readonly b: number, readonly p: number) {}
}

export const NEAR = {
  /** colliders made for pieces this near the player, and taken away past the second */
  solid: 250,
  gone: 300,
};

const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);

interface Drawn {
  key: string;
  matrix: THREE.Matrix4;
  /** where it stands in the world, for the colliders' nearness */
  at: THREE.Vector3;
  colliders: RAPIER.Collider[] | null;
  base: Base;
  piece: Piece;
}

export class BaseDraw {
  private meshes = new Map<string, THREE.InstancedMesh>();
  private drawn = new Map<string, Drawn>();
  private dirty = new Set<string>();
  private solidT = 0;

  constructor(private scene: THREE.Scene, private atmo: Atmosphere | null) {}

  private id = (b: number, p: number) => `${b}:${p}`;

  /** a piece laid or changed (its tier, where it is) */
  put(base: Base, piece: Piece) {
    const id = this.id(base.id, piece.id), key = `${piece.k}:${drawnAt(piece.k, piece.t)}${CLOTH.has(piece.k) ? ':cloth' : ''}`;
    const was = this.drawn.get(id);
    if (was) {
      this.dirty.add(was.key);
      this.unsolid(was);
    }
    const [x, y, z] = toWorld(base, piece.x, piece.y, piece.z);
    _q.setFromAxisAngle(_up, worldYaw(base, piece.r));
    const matrix = new THREE.Matrix4().compose(_p.set(x, y, z), _q, _one);
    this.drawn.set(id, { key, matrix, at: new THREE.Vector3(x, y, z), colliders: null, base, piece });
    this.dirty.add(key);
    // (made at once if near: what was just laid is stood on straight away)
    this.solidT = 0;
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
      this.dirty.add(d.key);
      this.drawn.delete(this.id(b, p));
    }
  }

  /** every piece of a base out of the world (gone, or far off) */
  forget(b: number) {
    for (const [id, d] of [...this.drawn]) if (d.base.id === b) this.remove(b, [Number(id.split(':')[1])]);
  }

  clear() {
    for (const d of this.drawn.values()) this.unsolid(d);
    for (const d of this.drawn.values()) this.dirty.add(d.key);
    this.drawn.clear();
  }

  /** the piece a collider is (a blow, an aim) */
  pieceOf(ref: PieceRef): Drawn | undefined {
    return this.drawn.get(this.id(ref.b, ref.p));
  }

  update(dt: number, eye: THREE.Vector3) {
    for (const key of this.dirty) this.rebuild(key);
    this.dirty.clear();
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

  private rebuild(key: string) {
    const list = [...this.drawn.values()].filter((d) => d.key === key);
    let m = this.meshes.get(key);
    if (!m || m.instanceMatrix.count < list.length) {
      if (m) {
        this.scene.remove(m);
        m.dispose();
        const f = m.userData.cloth as THREE.InstancedMesh | undefined;
        if (f) {
          this.scene.remove(f);
          f.dispose();
        }
      }
      const [kind, t, cloth] = key.split(':');
      m = new THREE.InstancedMesh(geometryOf(kind, Number(t) as Tier, !cloth), paintsOf(this.atmo)[Number(t)], Math.max(16, Math.ceil(list.length * 1.5)));
      m.castShadow = m.receiveShadow = true;
      m.name = `base:${key}`;
      this.scene.add(m);
      this.meshes.set(key, m);
      // (and its cloth, beside it: one more draw for the kind, as many as there are)
      const dress = cloth && dressOf(kind);
      if (dress) {
        const f = new THREE.InstancedMesh(dress, flagPaint(this.atmo), m.instanceMatrix.count);
        f.castShadow = true;
        f.name = `base:${key}:flag`;
        this.scene.add(f);
        m.userData.cloth = f;
      }
    }
    list.forEach((d, i) => m!.setMatrixAt(i, d.matrix));
    m.count = list.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.visible = list.length > 0;
    const f = m.userData.cloth as THREE.InstancedMesh | undefined;
    if (f) {
      list.forEach((d, i) => f.setMatrixAt(i, d.matrix));
      f.count = list.length;
      f.instanceMatrix.needsUpdate = true;
      f.computeBoundingSphere();
      f.visible = list.length > 0;
    }
  }

  private solid(d: Drawn) {
    const shape = shapeOf(d.piece.k), surface = SURFACE[drawnAt(d.piece.k, d.piece.t)];
    const owner = new PieceRef(d.base.id, d.piece.id);
    _q.setFromAxisAngle(_up, worldYaw(d.base, d.piece.r));
    const q = { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
    d.colliders = shape.solid.map((s) => {
      if ('box' in s) {
        const [cx, cy, cz, sx, sy, sz] = s.box;
        _p.set(cx, cy, cz).applyQuaternion(_q).add(d.at);
        return physics.addStaticQuat(physics.R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2), surface, { x: _p.x, y: _p.y, z: _p.z }, q, owner);
      }
      const pts = 'prism' in s ? s.prism.flatMap(([x, z]) => [x, s.y0, z, x, s.y1, z]) : s.hull.flat();
      const desc = physics.R.ColliderDesc.convexHull(new Float32Array(pts));
      return desc ? physics.addStaticQuat(desc, surface, { x: d.at.x, y: d.at.y, z: d.at.z }, q, owner) : null;
    }).filter((c): c is RAPIER.Collider => !!c);
  }

  private unsolid(d: Drawn) {
    for (const c of d.colliders ?? []) physics.world.removeCollider(c, false);
    d.colliders = null;
  }

  /** how many pieces are drawn, and how many stand solid (for a test's word) */
  get counts() {
    let solid = 0;
    for (const d of this.drawn.values()) if (d.colliders) solid++;
    return { drawn: this.drawn.size, solid, draws: [...this.meshes.values()].filter((m) => m.visible).length };
  }
}

export { PIECES };
