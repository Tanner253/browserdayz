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
import type { Atmosphere } from './atmosphere';
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
      const mk = (ps: { geo: THREE.BufferGeometry; mat: THREE.Material; m: THREE.Matrix4 }[], shadow: boolean) =>
        ps.map((q) => {
          const mesh = new THREE.InstancedMesh(q.geo, q.mat, list.length);
          mesh.count = 0;
          mesh.castShadow = shadow;
          mesh.receiveShadow = true;
          mesh.name = `rock ${id}`;
          this.group.add(mesh);
          return mesh;
        });
      const tris = (ps: { geo: THREE.BufferGeometry }[]) => ps.reduce((s, q) => s + (q.geo.index ? q.geo.index.count : q.geo.getAttribute('position').count) / 3, 0);
      this.sets.push({ id, list, near: mk(parts, true), far: mk(farParts, false), parts, farParts, nearTris: tris(parts), farTris: tris(farParts), size });
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

  /** where a piece stands, as a matrix */
  private placeOf(p: FieldPiece) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.tilt[0], p.turn, p.tilt[1], 'YXZ'));
    return new THREE.Matrix4().compose(new THREE.Vector3(...p.at), q, new THREE.Vector3(p.scale, p.scale, p.scale));
  }

  /** a piece made solid: its shape at its size, turned and stood where it is */
  private solidify(p: FieldPiece) {
    const shape = this.shapes.get(p.id);
    if (!shape || p.small) return;
    const pos = shape.pos.map((v) => v * p.scale), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.tilt[0], p.turn, p.tilt[1], 'YXZ'));
    const desc = shape.index ? physics.R.ColliderDesc.trimesh(pos, shape.index) : physics.R.ColliderDesc.convexHull(pos);
    if (desc) this.solidNow.set(p, physics.addStaticQuat(desc, 'rock', { x: p.at[0], y: p.at[1], z: p.at[2] }, { x: q.x, y: q.y, z: q.z, w: q.w }));
  }

  /** Each frame: when the eye has moved on, which pieces are drawn near, far or not at all, and which are solid. */
  update(eye: THREE.Vector3) {
    if (this.sortedAt.distanceToSquared(eye) < RESORT * RESORT) return;
    this.sortedAt.copy(eye);
    if (this.shapes.size) for (const p of this.pieces) {
      if (p.small) continue;
      const d = Math.hypot(p.at[0] - eye.x, p.at[1] - eye.y, p.at[2] - eye.z), c = this.solidNow.get(p);
      if (!c && d < this.o.solid) this.solidify(p);
      else if (c && d > this.o.solid + 2 * RESORT) {
        physics.world.removeCollider(c, false);
        this.solidNow.delete(p);
      }
    }
    const m = new THREE.Matrix4(), D = this.drawn;
    D.near = D.far = D.nearTris = D.farTris = 0;
    for (const set of this.sets) {
      let n = 0, f = 0;
      for (const p of set.list) {
        const d = Math.hypot(p.at[0] - eye.x, p.at[1] - eye.y, p.at[2] - eye.z);
        if (d > (p.small ? this.o.smallReach : Math.max(this.o.smallReach, set.size * p.scale * this.o.seen))) continue;
        const place = this.placeOf(p);
        if (!p.small && d < this.o.near && set.near.length) {
          set.near.forEach((mesh, i) => mesh.setMatrixAt(n, m.multiplyMatrices(place, set.parts[i].m)));
          n++;
        } else {
          set.far.forEach((mesh, i) => mesh.setMatrixAt(f, m.multiplyMatrices(place, set.farParts[i].m)));
          f++;
        }
      }
      for (const [meshes, count] of [[set.near, n], [set.far, f]] as const) for (const mesh of meshes) {
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
      D.near += n;
      D.far += f;
      D.nearTris += n * set.nearTris;
      D.farTris += f * set.farTris;
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
