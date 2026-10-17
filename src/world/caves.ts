// The pass's walls and its caves, drawn and made solid (the plan is src/sim/pass.ts). Not placed: the world's generator
// carves the pass; whoever lays the world in builds this once the ground is up:
//
//   const caves = new PassCaves(scene, atmo, pass, (x, z) => terrain.heightAt(x, z));
//   await caves.build({ carved });   // `carved` from the world's worker (carveCave), or left out to carve here in slices
//   caves.update(camera.position);                                   // each frame (cheap: it re-sorts only as the eye moves on)
//   under = Math.max(under, caves.dark(x, y, z));                      // with the bunker's and the cellars' dark
//
// Each cave is one carved surface of rock (src/world/cave-carve.ts), closed but for its mouths, its own collider the
// same surface: nothing between pieces to see the sky through or walk through. It is painted with the scanned rock's
// pictures from its three sides (no seams to stretch them) and the trail's gravel on its floors, shaded in its
// crevices. The pass's walls are dressed with the scanned cliffs, one set of instances for each model: the world's
// copy within NEAR metres of the eye, its far copy beyond. What stops a body at a wall piece is its own shape (its
// physics copy, scripts/phys-copies.mjs), made solid only within SOLID metres of the eye: the hull round a cliff face
// stood up to 2.9 m in front of the rock seen, an invisible wall on one level ray in five along the shelves.

import { CANYON_ROCK_TINT } from './ground';
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { assets } from '../core/assets';
import { physics } from '../core/physics';
import type { Atmosphere } from './atmosphere';
import { carving, type Carved } from './cave-carve';
import { CAVES, caveDark, galleries, passGround, rockPieces, type Gallery, type Pass, type RockPiece } from '../sim/pass';

/** metres from the eye within which a wall piece is drawn as the world's copy (its far copy beyond) */
const NEAR = 70;
/** metres the eye moves before the pieces are sorted again */
const RESORT = 12;
/** metres from the eye within which a wall piece is solid (and past which, with RESORT's margin, it is let go again) */
const SOLID = 60;
/** the rock's pictures, and how many metres each covers: the walls and roofs, and the floors */
const ROCK = { wall: 'cliff_side', wallSize: 3.4, floor: 'rocky_trail', floorSize: 2.2 };
/** milliseconds of carving to a frame, when it is carved here */
const SLICE = 6;

export class PassCaves {
  readonly group = new THREE.Group();
  readonly pieces: RockPiece[];
  /** the caves as carved (for numbers, and for the server or a cache to keep) */
  carved: Carved[] = [];
  private gs: Gallery[];
  private sets: { near: THREE.InstancedMesh[]; far: THREE.InstancedMesh[]; list: RockPiece[]; parts: { m: THREE.Matrix4 }[]; farParts: { m: THREE.Matrix4 }[] }[] = [];
  private sortedAt = new THREE.Vector3(Infinity, 0, 0);
  /** each model's physics copy (its corners and faces, as the model stands), and the pieces solid now */
  private shapes = new Map<string, { pos: Float32Array; index: Uint32Array }>();
  private solidNow = new Map<RockPiece, RAPIER.Collider>();

  constructor(
    private scene: THREE.Scene,
    private atmo: Atmosphere,
    readonly pass: Pass,
    /** the ground's height (the terrain's); the plan's own terraces if not given */
    private ground: (x: number, z: number) => number = (x, z) => passGround(pass, x, z),
  ) {
    this.pieces = rockPieces(pass);
    this.gs = galleries(pass);
    this.group.name = 'pass caves';
  }

  /** How dark it is at a point (0 to 1): for `atmo.cover.ground`, with the bunker's and the cellars'. */
  dark(x: number, y: number, z: number) {
    return caveDark(this.pass, x, y, z, this.gs);
  }

  async build(o: { solid?: boolean; carved?: Carved[] } = {}) {
    const byId = new Map<string, RockPiece[]>();
    for (const p of this.pieces) (byId.get(p.id) ?? byId.set(p.id, []).get(p.id)!).push(p);
    for (const [id, list] of byId) {
      const [near, far] = await Promise.all([assets.model(id, 0), assets.model(id, 1)]);
      const parts = this.partsOf(near), farParts = this.partsOf(far);
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
      this.sets.push({ near: mk(parts, true), far: mk(farParts, false), list, parts, farParts });
      if (o.solid !== false) this.shapes.set(id, this.shapeOf(await assets.model(id, 2)));
    }
    this.carved = o.carved ?? (await this.carveAll());
    const mat = this.rockMaterial();
    for (const k of this.carved) {
      const pos = new THREE.BufferAttribute(k.pos, 3), nor = new THREE.BufferAttribute(k.nor, 3), ao = new THREE.BufferAttribute(k.ao, 1);
      // (two meshes on the same points: the cave's own, which casts no shadow, the ground over it does; and the rock
      // round its mouths, which takes the ground's place there and so casts the ground's)
      for (const [index, casts] of [[k.index, false], [k.face, true]] as const) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', pos);
        geo.setAttribute('normal', nor);
        geo.setAttribute('aAo', ao);
        geo.setIndex(new THREE.BufferAttribute(index, 1));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = casts;
        mesh.receiveShadow = true;
        mesh.name = `cave ${CAVES[k.cave].name}${casts ? ' mouths' : ''}`;
        this.group.add(mesh);
      }
      if (o.solid !== false) {
        const all = new Uint32Array(k.index.length + k.face.length);
        all.set(k.index);
        all.set(k.face, k.index.length);
        physics.addStatic(physics.R.ColliderDesc.trimesh(k.pos, all, physics.R.TriMeshFlags.FIX_INTERNAL_EDGES), 'rock', { x: 0, y: 0, z: 0 });
      }
    }
    this.scene.add(this.group);
  }

  /** every cave carved here, a few milliseconds at a time between frames */
  private async carveAll() {
    const out: Carved[] = [];
    for (let ci = 0; ci < CAVES.length; ci++) {
      const it = carving(this.pass, ci, this.ground);
      let t = performance.now();
      for (;;) {
        const r = it.next();
        if (r.done) {
          out.push(r.value);
          break;
        }
        if (performance.now() - t > SLICE) {
          await new Promise((go) => setTimeout(go, 0));
          t = performance.now();
        }
      }
    }
    return out;
  }

  /**
   * The rock: its pictures laid from the three sides and blended by which way the rock faces (a carved surface has no
   * seams to lay one picture along), the gravel where it faces up; darker in its crevices (`aAo`, from the carving).
   * A side that hardly shows is not read at all (most of a wall reads one side, or two): with a cave filling a 1080p
   * screen the pictures cost the card 0.6 to 0.8 ms a frame read from all three sides (2026-10-16, an RTX 3070 Ti
   * laptop). Its roughness is the rock's own, even: its picture of it changed nothing seen in a cave.
   */
  private rockMaterial() {
    const tex = (id: string) => {
      const t = assets.manifest.textures[id];
      return { diff: assets.texture(t.diff, { srgb: true, repeat: true }), nor: assets.texture(t.nor, { repeat: true }) };
    };
    const wall = tex(ROCK.wall), floor = tex(ROCK.floor);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    this.atmo.register(mat, (shader) => {
      Object.assign(shader.uniforms, {
        tWall: { value: wall.diff }, tWallN: { value: wall.nor }, tFloor: { value: floor.diff }, tFloorN: { value: floor.nor },
        uRockSize: { value: new THREE.Vector2(ROCK.wallSize, ROCK.floorSize) },
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAo;\nvarying float vAo;\nvarying vec3 vRockPos;\nvarying vec3 vRockNor;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAo = aAo;\nvRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRockNor = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */ `#include <common>
          uniform sampler2D tWall, tWallN, tFloor, tFloorN;
          uniform vec2 uRockSize;
          varying float vAo;
          varying vec3 vRockPos;
          varying vec3 vRockNor;
          // (a picture read with its slopes given, so that it may be read or not, point by point)
          #define ROCK_READ( t, uv, d ) textureGrad( t, uv, d.xy, d.zw )`)
        .replace('#include <map_fragment>', /* glsl */ `
          vec3 rN = normalize(vRockNor), rB = pow(abs(rN), vec3(4.0));
          rB /= rB.x + rB.y + rB.z;
          vec2 uX = vRockPos.zy / uRockSize.x, uY = vRockPos.xz / uRockSize.x, uZ = vRockPos.xy / uRockSize.x, uF = vRockPos.xz / uRockSize.y;
          vec4 dX = vec4(dFdx(uX), dFdy(uX)), dY = vec4(dFdx(uY), dFdy(uY)), dZ = vec4(dFdx(uZ), dFdy(uZ)), dF = vec4(dFdx(uF), dFdy(uF));
          float onFloor = smoothstep(0.55, 0.85, rN.y);
          // (the sides that show: under 3 in 100 of the blend, not read, and the rest made whole again)
          vec3 use = step(vec3(0.03), rB);
          rB = rB * use / max(dot(rB, use), 1e-4);
          vec3 rockCol = vec3(0.0), tX = vec3(0.0, 0.0, 1.0), tY = tX, tZ = tX;
          if (use.x > 0.5) { rockCol += ROCK_READ(tWall, uX, dX).rgb * rB.x; tX = ROCK_READ(tWallN, uX, dX).xyz * 2.0 - 1.0; }
          if (use.z > 0.5) { rockCol += ROCK_READ(tWall, uZ, dZ).rgb * rB.z; tZ = ROCK_READ(tWallN, uZ, dZ).xyz * 2.0 - 1.0; }
          if (use.y > 0.5) {
            vec3 top = vec3(0.0), topN = vec3(0.0);
            if (onFloor < 0.99) { top += ROCK_READ(tWall, uY, dY).rgb * (1.0 - onFloor); topN += (ROCK_READ(tWallN, uY, dY).xyz * 2.0 - 1.0) * (1.0 - onFloor); }
            if (onFloor > 0.01) { top += ROCK_READ(tFloor, uF, dF).rgb * onFloor; topN += (ROCK_READ(tFloorN, uF, dF).xyz * 2.0 - 1.0) * onFloor; }
            rockCol += top * rB.y;
            tY = topN;
          }
          diffuseColor.rgb *= rockCol * mix(1.0, vAo, 0.6);`)
        .replace('#include <normal_fragment_maps>', /* glsl */ `{
          // (each side's picture's bumps brought into the world and blended: the "whiteout" blend)
          tX = vec3(tX.xy + rN.zy, abs(tX.z) * rN.x);
          tY = vec3(tY.xy + rN.xz, abs(tY.z) * rN.y);
          tZ = vec3(tZ.xy + rN.xy, abs(tZ.z) * rN.z);
          normal = normalize((viewMatrix * vec4(normalize(tX.zyx * rB.x + tY.xzy * rB.y + tZ.xyz * rB.z), 0.0)).xyz);
        }`)
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= vAo;\nreflectedLight.indirectSpecular *= vAo;');
    }, 'cave-rock');
    return mat;
  }

  /** a model's shapes, each with its place in the model, and its material made ready for the light */
  private partsOf(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const back = root.matrixWorld.clone().invert(), out: { geo: THREE.BufferGeometry; mat: THREE.Material; m: THREE.Matrix4 }[] = [];
    root.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      // (washed with the pass's beds' red, so that a piece stands in the wall and not on it: src/world/ground.ts)
      mat.color.multiply(new THREE.Color(...CANYON_ROCK_TINT));
      this.atmo.register(mat);
      out.push({ geo: mesh.geometry, mat, m: back.clone().multiply(mesh.matrixWorld) });
    });
    return out;
  }

  /** where a piece stands, as a matrix */
  private placeOf(p: RockPiece) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.tilt[0], p.turn, p.tilt[1], 'YXZ'));
    return new THREE.Matrix4().compose(new THREE.Vector3(...p.at), q, new THREE.Vector3(p.scale, p.scale, p.scale));
  }

  /** a physics copy's corners and faces, as the model stands (its parts brought into the model's own frame) */
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

  /** a wall piece made solid: its physics copy at its size, turned and stood where it is */
  private solidify(p: RockPiece) {
    const shape = this.shapes.get(p.id);
    if (!shape) return;
    const pos = shape.pos.map((v) => v * p.scale), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.tilt[0], p.turn, p.tilt[1], 'YXZ'));
    this.solidNow.set(p, physics.addStaticQuat(physics.R.ColliderDesc.trimesh(pos, shape.index), 'rock', { x: p.at[0], y: p.at[1], z: p.at[2] }, { x: q.x, y: q.y, z: q.z, w: q.w }));
  }

  /** Each frame: when the eye has moved on, which wall pieces are drawn near and which far, and which are solid. */
  update(eye: THREE.Vector3) {
    if (this.sortedAt.distanceToSquared(eye) < RESORT * RESORT) return;
    this.sortedAt.copy(eye);
    if (this.shapes.size) for (const p of this.pieces) {
      const d = Math.hypot(p.at[0] - eye.x, p.at[1] - eye.y, p.at[2] - eye.z), c = this.solidNow.get(p);
      if (!c && d < SOLID) this.solidify(p);
      else if (c && d > SOLID + 2 * RESORT) {
        physics.world.removeCollider(c, false);
        this.solidNow.delete(p);
      }
    }
    const m = new THREE.Matrix4();
    for (const set of this.sets) {
      let n = 0, f = 0;
      for (const p of set.list) {
        const place = this.placeOf(p);
        if (Math.hypot(p.at[0] - eye.x, p.at[1] - eye.y, p.at[2] - eye.z) < NEAR) {
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
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const c of this.solidNow.values()) physics.world.removeCollider(c, false);
    this.solidNow.clear();
  }
}
