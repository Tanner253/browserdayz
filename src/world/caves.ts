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
// copy within NEAR metres of the eye, its far copy beyond; round each wall piece the hull of its far copy.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { physics } from '../core/physics';
import type { Atmosphere } from './atmosphere';
import { carving, type Carved } from './cave-carve';
import { CAVES, caveDark, galleries, passGround, rockPieces, type Gallery, type Pass, type RockPiece } from '../sim/pass';

/** metres from the eye within which a wall piece is drawn as the world's copy (its far copy beyond) */
const NEAR = 70;
/** metres the eye moves before the pieces are sorted again */
const RESORT = 12;
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
      if (o.solid !== false) for (const p of list) this.hull(far, p);
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
   */
  private rockMaterial() {
    const tex = (id: string) => {
      const t = assets.manifest.textures[id];
      return { diff: assets.texture(t.diff, { srgb: true, repeat: true }), nor: assets.texture(t.nor, { repeat: true }), arm: assets.texture(t.arm, { repeat: true }) };
    };
    const wall = tex(ROCK.wall), floor = tex(ROCK.floor);
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    this.atmo.register(mat, (shader) => {
      Object.assign(shader.uniforms, {
        tWall: { value: wall.diff }, tWallN: { value: wall.nor }, tWallR: { value: wall.arm },
        tFloor: { value: floor.diff }, tFloorN: { value: floor.nor }, tFloorR: { value: floor.arm },
        uRockSize: { value: new THREE.Vector2(ROCK.wallSize, ROCK.floorSize) },
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAo;\nvarying float vAo;\nvarying vec3 vRockPos;\nvarying vec3 vRockNor;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAo = aAo;\nvRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRockNor = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */ `#include <common>
          uniform sampler2D tWall, tWallN, tWallR, tFloor, tFloorN, tFloorR;
          uniform vec2 uRockSize;
          varying float vAo;
          varying vec3 vRockPos;
          varying vec3 vRockNor;`)
        .replace('#include <map_fragment>', /* glsl */ `
          vec3 rN = normalize(vRockNor), rB = pow(abs(rN), vec3(4.0));
          rB /= rB.x + rB.y + rB.z;
          vec2 uX = vRockPos.zy / uRockSize.x, uY = vRockPos.xz / uRockSize.x, uZ = vRockPos.xy / uRockSize.x, uF = vRockPos.xz / uRockSize.y;
          float onFloor = smoothstep(0.55, 0.85, rN.y);
          vec3 cWall = texture2D(tWall, uX).rgb * rB.x + texture2D(tWall, uY).rgb * rB.y + texture2D(tWall, uZ).rgb * rB.z;
          diffuseColor.rgb *= mix(cWall, texture2D(tFloor, uF).rgb, onFloor) * mix(1.0, vAo, 0.6);`)
        .replace('#include <roughnessmap_fragment>', /* glsl */ `
          float rW = texture2D(tWallR, uX).g * rB.x + texture2D(tWallR, uY).g * rB.y + texture2D(tWallR, uZ).g * rB.z;
          float roughnessFactor = roughness * mix(rW, texture2D(tFloorR, uF).g, onFloor);`)
        .replace('#include <normal_fragment_maps>', /* glsl */ `{
          // (each side's picture's bumps brought into the world and blended: the "whiteout" blend)
          vec3 tX = texture2D(tWallN, uX).xyz * 2.0 - 1.0, tY = texture2D(tWallN, uY).xyz * 2.0 - 1.0, tZ = texture2D(tWallN, uZ).xyz * 2.0 - 1.0;
          tY = mix(tY, texture2D(tFloorN, uF).xyz * 2.0 - 1.0, onFloor);
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

  /** what stops a body at a wall piece: the hull of its far copy's corners, a few of them */
  private hull(far: THREE.Object3D, p: RockPiece) {
    const m = this.placeOf(p), pts: number[] = [], v = new THREE.Vector3();
    far.updateMatrixWorld(true);
    far.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute('position');
      const step = Math.max(1, Math.floor(pos.count / 300));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(m);
        pts.push(v.x, v.y, v.z);
      }
    });
    const desc = physics.R.ColliderDesc.convexHull(new Float32Array(pts));
    if (desc) physics.addStaticQuat(desc, 'rock', { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
  }

  /** Each frame: when the eye has moved on, which wall pieces are drawn near and which far. */
  update(eye: THREE.Vector3) {
    if (this.sortedAt.distanceToSquared(eye) < RESORT * RESORT) return;
    this.sortedAt.copy(eye);
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
  }
}
