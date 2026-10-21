// The wells as they stand in the world: a round brick wall, water a little way down it, two posts and a
// roof over a windlass, a bucket on its rope. Built of the same brick, plank and iron the houses are built of
// (the map's own materials), and solid: the wall and the posts stop a body and a shot.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../core/assets';
import { physics } from '../core/physics';
import { WELL, type Well } from '../sim/wells';
import type { Atmosphere } from './atmosphere';

/** a shape's picture laid on it so many times round and so many times up, so that a brick is the size of a brick */
function tiled<T extends THREE.BufferGeometry>(geo: T, u: number, v: number): T {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  return geo;
}

export function buildWells(wells: Well[], atmo: Atmosphere, scene: THREE.Object3D) {
  if (!wells.length) return;
  const of = (tex: string, o: THREE.MeshStandardMaterialParameters = {}) => {
    const t = assets.pbr(tex);
    return atmo.register(new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.armMap, aoMap: t.armMap, metalness: 0, ...o })) as THREE.MeshStandardMaterial;
  };
  const brick = of('red_brick_plaster_patch_02');
  const inside = of('red_brick_plaster_patch_02', { side: THREE.BackSide, color: 0x6f6a62 });
  const stone = of('dirty_concrete');
  const wood = of('weathered_planks');
  const iron = of('rusty_corrugated_iron', { metalnessMap: assets.pbr('rusty_corrugated_iron').armMap, metalness: 1 });
  const pail = atmo.register(new THREE.MeshStandardMaterial({ color: 0x5a5d5c, roughness: 0.55, metalness: 0.8, side: THREE.DoubleSide })) as THREE.MeshStandardMaterial;
  const rope = atmo.register(new THREE.MeshStandardMaterial({ color: 0x8a7a58, roughness: 1 })) as THREE.MeshStandardMaterial;
  const water = atmo.register(new THREE.MeshStandardMaterial({ color: 0x16242a, roughness: 0.06, metalness: 0.35, envMapIntensity: 1.8 })) as THREE.MeshStandardMaterial;
  const R = WELL.ring, T = 0.17, W = WELL.wall;
  // (Every well's parts of one paint are one thing, where they stand: a well was fifteen things to draw, and again in
  // every shadow map, for four hundred triangles.)
  const byPaint = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const part = new THREE.Object3D();
  for (const w of wells) {
    const group = new THREE.Object3D();
    group.position.set(w.x, w.y, w.z);
    group.rotation.y = w.rot;
    group.updateMatrix();
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
      part.position.set(x, y, z);
      part.rotation.set(rx, 0, rz);
      part.updateMatrix();
      if (!byPaint.has(m)) byPaint.set(m, []);
      byPaint.get(m)!.push(geo.applyMatrix4(part.matrix.premultiply(group.matrix)));
    };
    // the wall (it goes a little way into the ground, which is never quite level), its inside going down into the dark, and its cap
    add(tiled(new THREE.CylinderGeometry(R, R + 0.03, W + 0.3, 28, 1, true), 2.4, 0.5), brick, 0, (W - 0.3) / 2);
    add(tiled(new THREE.CylinderGeometry(R - T, R - T, W + 2.4, 28, 1, true), 2.2, 1.3), inside, 0, (W - 2.4) / 2);
    add(tiled(new THREE.RingGeometry(R - T, R + 0.05, 28, 1), 2, 2), stone, 0, W, 0, -Math.PI / 2);
    // the water: an arm's length down
    add(new THREE.CircleGeometry(R - T, 28), water, 0, W - 0.62, 0, -Math.PI / 2);
    // two posts, the beam between their heads, and a roof of two leaves over it
    for (const side of [-1, 1]) add(tiled(new THREE.BoxGeometry(0.13, 2.45, 0.13), 0.1, 1.2), wood, side * (R + 0.08), 1.225);
    add(tiled(new THREE.BoxGeometry(R * 2 + 0.5, 0.11, 0.11), 1.1, 0.1), wood, 0, 2.42);
    for (const side of [-1, 1]) add(tiled(new THREE.BoxGeometry(R * 2 + 0.95, 0.04, 0.98), 1.4, 0.5), iron, 0, 2.2, side * 0.4, side * 0.58);
    // the windlass: a drum across between the posts, its crank at one end, the rope down from it and the bucket on the rope
    add(tiled(new THREE.CylinderGeometry(0.075, 0.075, R * 2 + 0.1, 12), 0.3, 1), wood, 0, 1.72, 0, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 6), pail, R + 0.24, 1.62, 0);
    add(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 6), pail, R + 0.24 + 0.1, 1.47, 0, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.011, 0.011, 0.62, 5), rope, 0.12, 1.36, 0);
    add(new THREE.CylinderGeometry(0.15, 0.12, 0.27, 14, 1, true), pail, 0.12, 0.93, 0);
    add(new THREE.CircleGeometry(0.12, 14), pail, 0.12, 0.8, 0, -Math.PI / 2);
    physics.addStatic(physics.R.ColliderDesc.cylinder((W + 0.3) / 2, R + 0.03), 'concrete', { x: w.x, y: w.y + (W - 0.3) / 2, z: w.z });
    const c = Math.cos(w.rot), s = Math.sin(w.rot);
    for (const side of [-1, 1]) physics.addStatic(physics.R.ColliderDesc.cuboid(0.07, 1.23, 0.07), 'wood', { x: w.x + side * (R + 0.08) * c, y: w.y + 1.23, z: w.z - side * (R + 0.08) * s }, w.rot);
  }
  for (const [m, list] of byPaint) {
    const mesh = new THREE.Mesh(mergeGeometries(list, false)!, m);
    // (the water, the pail and its rope cast none: the shaft hides the one, the others are a thread in the shadow of
    // the frame, and each of these is every well on the map, drawn again in each of the sun's maps, 2026-10-18)
    mesh.castShadow = m !== water && m !== pail && m !== rope;
    // (the water takes no shadow)
    mesh.receiveShadow = m !== water;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'wells';
    scene.add(mesh);
  }
}
