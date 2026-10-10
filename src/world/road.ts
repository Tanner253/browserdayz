// Asphalt ribbon draped over the terrain along the road spline. Edges are broken up
// with a noise mask (alpha-tested) so the road crumbles into the gravel shoulder.

import * as THREE from 'three';
import { assets } from '../core/assets';
import type { Atmosphere } from './atmosphere';
import { heightAt, type World } from './worldgen';

/** the asphalt is a ribbon laid just above the ground, so the two never fight for the same pixels */
const ROAD_LIFT = 0.035;

/**
 * How far the road surface stands above the ground under this spot (0 away from the road).
 * The ground is what things collide with: anything set down on the road is raised by this,
 * or a knife dropped there lies under the asphalt.
 */
export function roadLift(world: World, x: number, z: number): number {
  for (const road of [world.road, ...world.roads]) {
    const p = road.points, reach = road.width / 2 + 0.2;
    for (let i = 0; i < p.length / 3 - 1; i++) {
      const ax = p[i * 3], az = p[i * 3 + 2], dx = p[i * 3 + 3] - ax, dz = p[i * 3 + 5] - az;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < reach) return ROAD_LIFT + 0.006;
    }
  }
  return 0;
}

export function buildRoad(world: World, atmo: Atmosphere, scene: THREE.Scene) {
  // (the road, and whatever roads have been laid since: one ribbon each, of the one asphalt)
  let mat: THREE.MeshStandardMaterial | null = null;
  let firstMesh: THREE.Mesh | null = null;
  for (const road of [world.road, ...world.roads]) {
  const pts = road.points;
  const n = pts.length / 3;
  const W = road.width - 0.6;
  const ACROSS = 6;
  const TILE = 5;
  const pos: number[] = [];
  const uv: number[] = [];
  const edge: number[] = [];
  const idx: number[] = [];
  let along = 0;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3], z = pts[i * 3 + 2];
    const j0 = Math.max(0, i - 1), j1 = Math.min(n - 1, i + 1);
    const tx = pts[j1 * 3] - pts[j0 * 3], tz = pts[j1 * 3 + 2] - pts[j0 * 3 + 2];
    const tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl;
    if (i > 0) along += Math.hypot(x - pts[(i - 1) * 3], z - pts[(i - 1) * 3 + 2]);
    for (let k = 0; k <= ACROSS; k++) {
      const s = k / ACROSS - 0.5;
      const px = x + nx * s * W, pz = z + nz * s * W;
      pos.push(px, heightAt(world.heights, px, pz) + ROAD_LIFT, pz);
      uv.push((s + 0.5) * (W / TILE), along / TILE);
      edge.push(Math.abs(s) * 2);
    }
    if (i < n - 1) {
      for (let k = 0; k < ACROSS; k++) {
        const a = i * (ACROSS + 1) + k, b = a + 1, c = a + ACROSS + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  g.computeVertexNormals();

  if (!mat) {
  const t = assets.pbr('asphalt_02');
  mat = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    roughnessMap: t.armMap,
    aoMap: t.armMap,
    roughness: 1,
    metalness: 0,
    color: 0xd8d4cc,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    alphaTest: 0.5,
  });
  atmo.register(
    mat,
    (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aEdge;\nvarying float vEdge;\nvarying vec2 vRoadW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;\nvRoadW = position.xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vEdge;\nvarying vec2 vRoadW;\nfloat rh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }\nfloat rn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(rh(i),rh(i+vec2(1,0)),f.x), mix(rh(i+vec2(0,1)),rh(i+vec2(1,1)),f.x), f.y); }')
        .replace(
          '#include <alphatest_fragment>',
          `{
  float crumble = rn(vRoadW * 1.3) * 0.6 + rn(vRoadW * 4.1) * 0.4;
  float keep = 1.0 - smoothstep(0.78, 0.98, vEdge + (crumble - 0.5) * 0.35);
  if (keep < 0.5) discard;
  // dusty, faded edges
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.02, 0.92), smoothstep(0.55, 0.9, vEdge));
}`,
        );
    },
    'road',
  );
  }
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.name = 'road';
  scene.add(mesh);
  firstMesh ??= mesh;
  }
  return firstMesh!;
}
