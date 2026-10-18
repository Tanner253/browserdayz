// The army's field posts by the western roads (src/sim/posts.ts): each the pillbox model ("WW2 Field Bunker"), drawn and
// made solid triangle for triangle, as the one over Bunker 17's stair is (src/world/bunker.ts), on the ground the world
// levelled for it. Its floor is its own here (over the bunker's stair it is taken out: the pad is the floor there).
// What stands in it, and its places for things, are the map's (Buildings.plan).

import * as THREE from 'three';
import { assets } from '../core/assets';
import { physics } from '../core/physics';
import type { Atmosphere } from './atmosphere';
import { inMetres } from './bunker';
import { PILLBOX, postFoot, postYaw, type Post } from '../sim/posts';

const UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);

export class FieldPosts {
  readonly group = new THREE.Group();

  constructor(posts: (Post & { y: number })[], atmo: Atmosphere, scene: THREE.Scene) {
    if (!posts.length) return;
    this.group.name = 'field posts';
    scene.add(this.group);
    void assets.model(PILLBOX.model).then((model) => {
      model.updateMatrixWorld(true);
      // (the model's pieces once, in metres, each with its stuff made the world's: lit, fogged, seen from inside as from out)
      const kept = new Map<THREE.Material, THREE.MeshStandardMaterial>(), parts: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial; shadow: boolean }[] = [];
      model.traverse((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh) return;
        const from = src.material as THREE.MeshStandardMaterial;
        if (!kept.has(from)) {
          const m = atmo.register(from.clone()) as THREE.MeshStandardMaterial;
          m.side = THREE.DoubleSide;
          kept.set(from, m);
        }
        parts.push({ geo: inMetres(src), mat: kept.get(from)!, shadow: !/interior/i.test(from.name) });
      });
      const v = new THREE.Vector3();
      for (const p of posts) {
        const M = new THREE.Matrix4().compose(new THREE.Vector3(p.x, postFoot(p.y), p.z), new THREE.Quaternion().setFromAxisAngle(UP, postYaw(p)), ONE);
        for (const part of parts) {
          const mesh = new THREE.Mesh(part.geo, part.mat);
          mesh.matrix.copy(M);
          mesh.matrixAutoUpdate = false;
          mesh.castShadow = part.shadow;
          mesh.receiveShadow = true;
          this.group.add(mesh);
          // what stops a body and a bullet: the same triangles, where they stand in the world
          const P = part.geo.getAttribute('position'), verts = new Float32Array(P.count * 3);
          for (let i = 0; i < P.count; i++) {
            v.fromBufferAttribute(P, i).applyMatrix4(M);
            verts.set([v.x, v.y, v.z], i * 3);
          }
          const tris = part.geo.index ? new Uint32Array(part.geo.index.array) : Uint32Array.from({ length: P.count }, (_, i) => i);
          physics.addStatic(physics.R.ColliderDesc.trimesh(verts, tris), 'concrete', { x: 0, y: 0, z: 0 });
        }
      }
      this.group.updateMatrixWorld(true);
    }).catch(() => {});
  }
}
