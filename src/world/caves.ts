// The pass's walls and its caves, drawn and made solid (the plan is src/sim/pass.ts). Not placed: the world's generator
// carves the pass; whoever lays the world in builds this once the ground is up:
//
//   const caves = new PassCaves(scene, atmo, pass);  await caves.build();     // while loading
//   caves.update(camera.position);                                         // each frame (cheap: it re-sorts only as the eye moves on)
//   under = Math.max(under, caves.dark(x, y, z));                            // with the bunker's and the cellars' dark
//
// The rock pieces are the scanned cliffs, faces and boulders, one set of instances for each model: the world's copy
// within NEAR metres of the eye, its far copy beyond; a cave's lining only within LINING metres. Each gallery has a
// floor laid along it in the ground's own pictures, and round it a sleeve of dark, behind the rocks, so that what is
// seen between two of them is the dark of the rock and never the sky or the shelf outside. What stops a body: the
// plan's boxes (floors, roofs, walls, the rings at the bends), and round each wall piece the hull of its far copy.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { physics } from '../core/physics';
import type { Atmosphere } from './atmosphere';
import { caveDark, caveSolids, galleries, rockPieces, type Gallery, type Pass, type RockPiece } from '../sim/pass';

/** metres from the eye within which a wall piece is drawn as the world's copy (its far copy beyond) */
const NEAR = 70;
/** metres from the eye within which a cave's lining is drawn at all */
const LINING = 150;
/** metres the eye moves before the pieces are sorted again */
const RESORT = 12;
/** the ground's pictures a cave's floor is laid in: its galleries, and its halls */
const FLOOR = { tex: 'rocky_trail', size: 2.2 };

export class PassCaves {
  readonly group = new THREE.Group();
  readonly pieces: RockPiece[];
  private gs: Gallery[];
  private sets: { near: THREE.InstancedMesh[]; far: THREE.InstancedMesh[]; list: RockPiece[]; parts: { m: THREE.Matrix4 }[]; farParts: { m: THREE.Matrix4 }[] }[] = [];
  private sortedAt = new THREE.Vector3(Infinity, 0, 0);

  constructor(
    private scene: THREE.Scene,
    private atmo: Atmosphere,
    readonly pass: Pass,
  ) {
    this.pieces = rockPieces(pass);
    this.gs = galleries(pass);
    this.group.name = 'pass caves';
  }

  /** How dark it is at a point (0 to 1): for `atmo.cover.ground`, with the bunker's and the cellars'. */
  dark(x: number, y: number, z: number) {
    return caveDark(this.pass, x, y, z, this.gs);
  }

  async build(o: { solid?: boolean } = {}) {
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
      if (o.solid !== false) for (const p of list) if (!p.inside) this.hull(far, p);
    }
    this.floors();
    this.sleeves();
    if (o.solid !== false) this.solids();
    this.scene.add(this.group);
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

  /** the plan's boxes, made solid */
  private solids() {
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    for (const b of caveSolids(this.pass)) {
      q.setFromEuler(e.set(b.pitch ?? 0, b.rot, 0, 'YXZ'));
      physics.addStaticQuat(physics.R.ColliderDesc.cuboid(b.h[0], b.h[1], b.h[2]), 'rock', { x: b.c[0], y: b.c[1], z: b.c[2] }, { x: q.x, y: q.y, z: q.z, w: q.w });
    }
  }

  /** each gallery's floor, in the ground's own pictures, a strip along it (its bends a little wider) */
  private floors() {
    const t = assets.manifest.textures[FLOOR.tex], arm = assets.texture(t.arm, { repeat: true });
    const mat = new THREE.MeshStandardMaterial({ map: assets.texture(t.diff, { srgb: true, repeat: true }), normalMap: assets.texture(t.nor, { repeat: true }), roughnessMap: arm, aoMap: arm, metalness: 0 });
    this.atmo.register(mat);
    const pos: number[] = [], uv: number[] = [], index: number[] = [];
    for (const g of this.gs) {
      const ex = g.b[0] - g.a[0], ez = g.b[2] - g.a[2], run = Math.hypot(ex, ez), sx = ez / run, sz = -ex / run, o = pos.length / 3;
      // (each end carried a little past its node, so that two strips meet without a gap at a bend)
      const ax = g.a[0] - (ex / run) * g.wa * 0.5, az = g.a[2] - (ez / run) * g.wa * 0.5, bx = g.b[0] + (ex / run) * g.wb * 0.5, bz = g.b[2] + (ez / run) * g.wb * 0.5;
      for (const [x, y, z, w] of [[ax, g.a[1], az, g.wa], [bx, g.b[1], bz, g.wb]] as const) for (const k of [-0.5, 0.5]) {
        const px = x + sx * w * k * 1.1, pz = z + sz * w * k * 1.1;
        pos.push(px, y + 0.01, pz);
        uv.push(px / FLOOR.size, pz / FLOOR.size);
      }
      index.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'cave floors';
    this.group.add(mesh);
  }

  /** round each gallery, behind its rocks, the dark: a box seen from inside only */
  private sleeves() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x030303, side: THREE.BackSide });
    const geos: THREE.BufferGeometry[] = [];
    for (const g of this.gs) {
      const ex = g.b[0] - g.a[0], ez = g.b[2] - g.a[2], run = Math.hypot(ex, ez), rise = g.b[1] - g.a[1];
      const w = Math.max(g.wa, g.wb) + 4, h = Math.max(g.ha, g.hb) + 3.5, len = Math.hypot(run, rise) + Math.max(g.wa, g.wb);
      const box = new THREE.BoxGeometry(w, h, len);
      box.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3((g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2 + h / 2 - 1.2, (g.a[2] + g.b[2]) / 2),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.atan2(rise, run), Math.atan2(ex, ez), 0, 'YXZ')),
        new THREE.Vector3(1, 1, 1),
      ));
      geos.push(box.toNonIndexed());
    }
    const all = new THREE.BufferGeometry(), n = geos.reduce((s, q) => s + q.getAttribute('position').count, 0), arr = new Float32Array(n * 3);
    let o = 0;
    for (const q of geos) {
      arr.set(q.getAttribute('position').array as Float32Array, o);
      o += q.getAttribute('position').count * 3;
    }
    all.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mesh = new THREE.Mesh(all, mat);
    mesh.name = 'cave dark';
    this.group.add(mesh);
  }

  /** Each frame: when the eye has moved on, which pieces are drawn near and which far, and which linings at all. */
  update(eye: THREE.Vector3) {
    if (this.sortedAt.distanceToSquared(eye) < RESORT * RESORT) return;
    this.sortedAt.copy(eye);
    const m = new THREE.Matrix4();
    for (const set of this.sets) {
      let n = 0, f = 0;
      for (const p of set.list) {
        const d = Math.hypot(p.at[0] - eye.x, p.at[1] - eye.y, p.at[2] - eye.z), place = this.placeOf(p);
        if (p.inside ? d < LINING : d < NEAR) {
          set.near.forEach((mesh, i) => mesh.setMatrixAt(n, m.multiplyMatrices(place, set.parts[i].m)));
          n++;
        } else if (!p.inside) {
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
