// A field of scanned rocks, drawn and made solid: the pass's walls and cave mouths (src/world/caves.ts) and the canyon
// country's outcrops (src/world/outcrops.ts). One set of instances for each model: its world copy within `near` metres
// of the eye and its far copy beyond, a small piece always its far copy (rubble a pace across is not the 30,000
// triangles of a boulder's world copy) and none past `smallReach`, any other none past `seen` times its size (the far
// copies are 1,200 to 6,000 triangles, and with all drawn the rock was 5.5 million triangles of a frame in the pass,
// 2026-10-16: a boulder three metres long is 20 pixels high at 210 m), each shrunk away over the last fifth of its
// reach so that none pops. Each piece solid only within `solid` metres of the eye: a cliff by its physics copy
// (scripts/phys-copies.mjs), a boulder by the hull of its far copy, rubble not at all (it is walked over, as in DayZ).
// Its material fades into the ground where it meets it (src/world/rock-blend.ts).

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { assets } from '../core/assets';
import { physics } from '../core/physics';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { SHADOW_FRUSTA, type Atmosphere } from './atmosphere';
import { blendPatch, type BlendHole } from './rock-blend';
import type { ShaderPatch } from './atmosphere';
import type { RockPiece } from '../sim/pass';

/** a piece of a field: `small`, rubble (its far copy always, drawn only near, never solid) */
export interface FieldPiece extends RockPiece {
  small?: boolean;
}

export interface FieldOptions {
  name: string;
  /** metres from the eye within which a piece is drawn as its world copy */
  near?: number;
  /** metres from the eye past which a small piece is not drawn at all */
  smallReach?: number;
  /** metres from the eye, for each metre of its size, past which any other piece is not drawn */
  seen?: number;
  /** metres from the eye within which a piece is solid */
  solid?: number;
  /** the terrain's heights, for the rock to fade into the ground (src/world/rock-blend.ts); and the level ground's kind */
  heightTex?: THREE.Texture;
  flat?: Parameters<typeof blendPatch>[1];
  /** a wash over the rock's own colour (the canyon's red: src/world/ground.ts CANYON_ROCK_TINT) */
  tint?: [number, number, number];
  /** holes opened in the ground among the pieces, floored lower than it (the caves' mouths: see BlendHole) */
  holes?: BlendHole[];
}

/** metres the eye moves before the pieces are sorted again */
const RESORT = 12;

interface Set {
  id: string;
  list: FieldPiece[];
  near: THREE.InstancedMesh[];
  far: THREE.InstancedMesh[];
  /** the near pieces' shadows, cast by their far copies: in the shadow maps only */
  shade: THREE.InstancedMesh[];
  /** the pieces drawn near and far since the last sort, and of those, what was in sight when last written */
  nearNow: FieldPiece[];
  farNow: FieldPiece[];
  shown: number;
  parts: { m: THREE.Matrix4 }[];
  farParts: { m: THREE.Matrix4 }[];
  /** triangles of one piece's world copy and far copy */
  nearTris: number;
  farTris: number;
  /** the model's size as it came (its longest side, metres) */
  size: number;
}

export class RockField {
  readonly group = new THREE.Group();
  /** what was drawn at the last sort: pieces and triangles near and far (for the numbers) */
  readonly drawn = { near: 0, far: 0, nearTris: 0, farTris: 0 };
  private sets: Set[] = [];
  /** each model's physics copy (corners and faces as the model stands), or its far copy's corners for a hull */
  private shapes = new Map<string, { pos: Float32Array; index?: Uint32Array }>();
  private solidNow = new Map<FieldPiece, RAPIER.Collider>();
  private sortedAt = new THREE.Vector3(Infinity, 0, 0);
  /** the eye the pieces in sight are reckoned from (none: every piece in reach is drawn) */
  camera: THREE.Camera | null = null;
  private placed = new Map<FieldPiece, THREE.Matrix4>();
  private toSolid: FieldPiece[] = [];
  private hulls = new Map<string, Float32Array>();
  private frustum = new THREE.Frustum();
  private pv = new THREE.Matrix4();
  private ball = new THREE.Sphere();
  private m = new THREE.Matrix4();
  /** each piece's place in its model's list (what is in sight is said by these) */
  private idx = new Map<FieldPiece, number>();
  private o: Required<Omit<FieldOptions, 'heightTex' | 'tint' | 'flat' | 'holes'>> & FieldOptions;

  constructor(
    private scene: THREE.Scene,
    private atmo: Atmosphere,
    readonly pieces: FieldPiece[],
    o: FieldOptions,
  ) {
    this.o = { near: 70, smallReach: 160, seen: 70, solid: 60, ...o };
    this.group.name = o.name;
  }

  async build(o: { solid?: boolean } = {}) {
    const byId = new Map<string, FieldPiece[]>();
    for (const p of this.pieces) (byId.get(p.id) ?? byId.set(p.id, []).get(p.id)!).push(p);
    for (const [id, list] of byId) {
      const entry = assets.manifest.models[id], big = list.some((p) => !p.small);
      const [near, far] = await Promise.all([big ? assets.model(id, 0) : Promise.resolve(null), assets.model(id, 1)]);
      const size = Math.max(...entry.max.map((v, i) => v - entry.min[i]));
      const parts = near ? this.partsOf(near, size) : [], farParts = this.partsOf(far, size);
      const mk = (ps: { geo: THREE.BufferGeometry; mat: THREE.Material; m: THREE.Matrix4 }[], shade = false) =>
        ps.map((q) => {
          const mesh = new THREE.InstancedMesh(q.geo, q.mat, list.length);
          mesh.count = 0;
          mesh.receiveShadow = !shade;
          mesh.castShadow = shade;
          mesh.name = `rock ${id}${shade ? ' shadow' : ''}`;
          if (shade) {
            // (in the shadow maps and not in the view: three asks this of every pass it draws)
            mesh.intersectsFrustum = (f) => SHADOW_FRUSTA.has(f);
          } else mesh.frustumCulled = false; // (each piece is looked at against the view instead: see cull)
          this.group.add(mesh);
          return mesh;
        });
      const tris = (ps: { geo: THREE.BufferGeometry }[]) => ps.reduce((s, q) => s + (q.geo.index ? q.geo.index.count : q.geo.getAttribute('position').count) / 3, 0);
      // (A near piece's shadow is its far copy's: 1,200 to 6,000 triangles for its 30,000 to 52,000, drawn into each of the
      // sun's three maps, where the difference is less than a texel; the rock was 3 of the 5 to 7 million triangles of a
      // frame in the pass, and the card fell behind on those frames, 2026-10-19.)
      list.forEach((q, i) => this.idx.set(q, i));
      this.sets.push({ id, list, near: mk(parts), far: mk(farParts), shade: parts.length ? mk(farParts, true) : [], nearNow: [], farNow: [], shown: -1, parts, farParts, nearTris: tris(parts), farTris: tris(farParts), size });
      if (o.solid !== false && list.some((p) => !p.small)) {
        // (a cliff by its physics copy: a hull round one stood metres in front of the rock seen; a boulder is round enough for its hull)
        this.shapes.set(id, entry.lods.length > 1 ? this.shapeOf(await assets.model(id, 2)) : { pos: this.shapeOf(far).pos });
      }
    }
    this.scene.add(this.group);
  }

  /** a model's shapes, each with its place in the model, and its material made ready (washed, fading into the ground) */
  private partsOf(root: THREE.Object3D, size: number) {
    root.updateMatrixWorld(true);
    const back = root.matrixWorld.clone().invert(), out: { geo: THREE.BufferGeometry; mat: THREE.Material; m: THREE.Matrix4 }[] = [];
    root.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      if (this.o.tint) mat.color.multiply(new THREE.Color(...this.o.tint));
      const fade = fadePatch(size * this.o.seen, this.o.smallReach);
      if (this.o.heightTex) {
        const b = blendPatch(this.o.heightTex, this.o.flat, this.o.holes);
        this.atmo.register(mat, (sh) => (b.patch(sh), fade(sh)), `${b.key}+fade`);
      } else this.atmo.register(mat, fade, 'rock-fade');
      out.push({ geo: mesh.geometry, mat, m: back.clone().multiply(mesh.matrixWorld) });
    });
    return out;
  }

  /** a model's corners and faces, as the model stands (its parts brought into the model's own frame) */
  private shapeOf(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const back = root.matrixWorld.clone().invert(), pos: number[] = [], index: number[] = [], v = new THREE.Vector3();
    root.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = back.clone().multiply(mesh.matrixWorld), at = mesh.geometry.getAttribute('position'), o = pos.length / 3, ix = mesh.geometry.getIndex();
      for (let i = 0; i < at.count; i++) {
        v.fromBufferAttribute(at, i).applyMatrix4(m);
        pos.push(v.x, v.y, v.z);
      }
      if (ix) for (let i = 0; i < ix.count; i++) index.push(o + ix.getX(i));
      else for (let i = 0; i < at.count; i++) index.push(o + i);
    });
    return { pos: new Float32Array(pos), index: new Uint32Array(index) };
  }

  /** where a piece stands, as a matrix (worked out once a piece) */
  private placeOf(p: FieldPiece) {
    let m = this.placed.get(p);
    if (!m) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.tilt[0], p.turn, p.tilt[1], 'YXZ'));
      this.placed.set(p, (m = new THREE.Matrix4().compose(new THREE.Vector3(...p.at), q, new THREE.Vector3(p.scale, p.scale, p.scale))));
    }
    return m;
  }

  /** a boulder's hull as a few points: its far copy's corners round which the hull lies, worked out once a model */
  private hullOf(id: string, pos: Float32Array) {
    let h = this.hulls.get(id);
    if (!h) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < pos.length; i += 3) pts.push(new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]));
      const hull = new ConvexHull().setFromPoints(pts), out: number[] = [], seen = new Set<THREE.Vector3>();
      for (const f of hull.faces) {
        let e = f.edge;
        do {
          const at = e.head().point;
          if (!seen.has(at)) {
            seen.add(at);
            out.push(at.x, at.y, at.z);
          }
          e = e.next;
        } while (e !== f.edge);
      }
      this.hulls.set(id, (h = out.length >= 12 ? new Float32Array(out) : pos));
    }
    return h;
  }

  /** a piece made solid: its shape at its size, turned and stood where it is */
  private solidify(p: FieldPiece) {
    const shape = this.shapes.get(p.id);
    if (!shape || p.small) return;
    const pos = (shape.index ? shape.pos : this.hullOf(p.id, shape.pos)).map((v) => v * p.scale), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.tilt[0], p.turn, p.tilt[1], 'YXZ'));
    const desc = shape.index ? physics.R.ColliderDesc.trimesh(pos, shape.index) : physics.R.ColliderDesc.convexHull(pos);
    if (desc) this.solidNow.set(p, physics.addStaticQuat(desc, 'rock', { x: p.at[0], y: p.at[1], z: p.at[2] }, { x: q.x, y: q.y, z: q.z, w: q.w }));
  }

  /** Each frame: when the eye has moved on, which pieces are drawn near, far or not at all, and which are to be solid; one made solid; what is in sight drawn. */
  update(eye: THREE.Vector3) {
    if (this.sortedAt.distanceToSquared(eye) >= RESORT * RESORT) this.sort(eye);
    // (one piece made solid a frame, the nearest first: a few dozen at once as the eye came into the pass, a hull worked
    // out of thousands of corners for each, was 7 to 17 ms of a frame every twelve metres, 2026-10-19)
    const p = this.toSolid.shift();
    if (p && !this.solidNow.has(p) && Math.hypot(p.at[0] - eye.x, p.at[1] - eye.y, p.at[2] - eye.z) < this.o.solid) this.solidify(p);
    this.cull();
  }

  private sort(eye: THREE.Vector3) {
    this.sortedAt.copy(eye);
    this.toSolid.length = 0;
    if (this.shapes.size) {
      const want: [FieldPiece, number][] = [];
      for (const p of this.pieces) {
        if (p.small) continue;
        const d = Math.hypot(p.at[0] - eye.x, p.at[1] - eye.y, p.at[2] - eye.z), c = this.solidNow.get(p);
        if (!c && d < this.o.solid) want.push([p, d]);
        else if (c && d > this.o.solid + 2 * RESORT) {
          physics.world.removeCollider(c, false);
          this.solidNow.delete(p);
        }
      }
      want.sort((a, b) => a[1] - b[1]);
      for (const [p] of want) this.toSolid.push(p);
    }
    const m = this.m, D = this.drawn;
    D.near = D.far = D.nearTris = D.farTris = 0;
    for (const set of this.sets) {
      set.nearNow.length = set.farNow.length = 0;
      for (const p of set.list) {
        const d = Math.hypot(p.at[0] - eye.x, p.at[1] - eye.y, p.at[2] - eye.z);
        if (d > (p.small ? this.o.smallReach : Math.max(this.o.smallReach, set.size * p.scale * this.o.seen))) continue;
        if (!p.small && d < this.o.near && set.near.length) set.nearNow.push(p);
        else set.farNow.push(p);
      }
      // (every near piece's shadow, in sight or not: a shadow from behind the eye falls in front of it)
      set.nearNow.forEach((p, k) => set.shade.forEach((mesh, i) => mesh.setMatrixAt(k, m.multiplyMatrices(this.placeOf(p), set.farParts[i].m))));
      for (const mesh of set.shade) {
        mesh.count = set.nearNow.length;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
      set.shown = -1;
      D.near += set.nearNow.length;
      D.far += set.farNow.length;
      D.nearTris += set.nearNow.length * set.nearTris;
      D.farTris += set.farNow.length * set.farTris;
    }
  }

  /**
   * Each frame, the pieces in sight drawn and no others (2026-10-19): each list was looked at against the view as one
   * ball round all of it, every near piece within 45 m in it, and the ones behind the eye were drawn at 30,000 to
   * 52,000 triangles each. Each piece is looked at as a ball a third again its size and three metres more, so that
   * none comes into sight late; the lists are written again only when what is in sight has changed.
   */
  private cull() {
    const cam = this.camera, m = this.m, ball = this.ball;
    if (cam) {
      cam.updateMatrixWorld();
      this.frustum.setFromProjectionMatrix(this.pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    }
    for (const set of this.sets) {
      // (what is in sight, said as one number: written again only when it changes)
      let sig = 0, k = 0;
      const seen = (p: FieldPiece) => {
        if (!cam) return true;
        ball.center.set(p.at[0], p.at[1], p.at[2]);
        ball.radius = set.size * p.scale * 0.75 * 1.33 + 3;
        return this.frustum.intersectsSphere(ball);
      };
      const near: FieldPiece[] = [], far: FieldPiece[] = [];
      for (const p of set.nearNow) if (seen(p)) { near.push(p); sig = (sig * 31 + (++k) * 7 + this.idx.get(p)!) | 0; }
      for (const p of set.farNow) if (seen(p)) { far.push(p); sig = (sig * 37 + (++k) * 11 + this.idx.get(p)! * 3) | 0; }
      sig = (sig * 41 + near.length * 1009 + far.length) | 0;
      if (sig === set.shown) continue;
      set.shown = sig;
      near.forEach((p, n) => set.near.forEach((mesh, i) => mesh.setMatrixAt(n, m.multiplyMatrices(this.placeOf(p), set.parts[i].m))));
      far.forEach((p, n) => set.far.forEach((mesh, i) => mesh.setMatrixAt(n, m.multiplyMatrices(this.placeOf(p), set.farParts[i].m))));
      for (const [meshes, count] of [[set.near, near.length], [set.far, far.length]] as const) for (const mesh of meshes) {
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const c of this.solidNow.values()) physics.world.removeCollider(c, false);
    this.solidNow.clear();
  }
}

/**
 * A piece shrunk away toward the end of its reach (as RockField.update reckons it: `perMetre` times its size, its scale
 * read off its instance, and never short of `least`), over the last fifth, into its own foot: let go there at once, it
 * popped. Shrunk, not dithered: a shader that may throw a pixel away costs every pixel of it the card's early test of
 * what is nearer, and the pass's walls fill the screen.
 */
function fadePatch(perMetre: number, least: number): ShaderPatch {
  return (shader) => {
    shader.uniforms.uFieldReach = { value: new THREE.Vector2(perMetre, least) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform vec2 uFieldReach;').replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      #ifdef USE_INSTANCING
        {
          float reach = max( uFieldReach.y, uFieldReach.x * length( instanceMatrix[0].xyz ) );
          transformed *= smoothstep( reach, reach * 0.8, distance( ( modelMatrix * instanceMatrix[3] ).xyz, cameraPosition ) );
        }
      #endif`,
    );
  };
}
