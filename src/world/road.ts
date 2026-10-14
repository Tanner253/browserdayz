// Asphalt ribbon draped over the terrain along the road spline. Edges are broken up
// with a noise mask (alpha-tested) so the road crumbles into the gravel shoulder.

import * as THREE from 'three';
import { assets } from '../core/assets';
import type { Atmosphere } from './atmosphere';
import { heightAt, type World } from './worldgen';
import { buildBridges } from './bridge';
import { buildWreck } from './crest';
import { buildDrystone, buildGatehouse } from './gatehouse';
import { SNOW_LIES, SNOW_PAINT, snowUniforms } from './foliage';

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
  // (the road over a bridge is the bridge's own to draw: there is no ground under it to lay asphalt on)
  if ((road as { bridge?: boolean }).bridge) continue;
  const pts = road.points;
  const n = pts.length / 3;
  const W = road.width - 0.6;
  // A side street's asphalt begins under the edge of the road's (see the village's streets in worldgen): it lies a
  // finger's breadth lower, so that where the two overlap they are not two faces in one plane. And it does not stop
  // dead at its far end: its last metres break up into the gravel, as its edges do.
  const side = !!(road as { side?: boolean }).side;
  const lift = side ? ROAD_LIFT - 0.014 : ROAD_LIFT;
  let whole = 0;
  for (let i = 1; i < n; i++) whole += Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 2] - pts[i * 3 - 1]);
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
      pos.push(px, heightAt(world.heights, px, pz) + lift, pz);
      uv.push((s + 0.5) * (W / TILE), along / TILE);
      edge.push(side ? Math.max(Math.abs(s) * 2, 1 - (whole - along) / 4.5) : Math.abs(s) * 2);
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
      // (snow lies on it by place as well as by height: the mountain road's last metres, where the track to the fort leaves it)
      Object.assign(shader.uniforms, snowUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aEdge;\nvarying float vEdge;\nvarying vec2 vRoadW;\nvarying vec3 vRoadP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;\nvRoadW = position.xz;\nvRoadP = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vEdge;\nvarying vec2 vRoadW;\nvarying vec3 vRoadP;' + SNOW_LIES + '\nfloat rh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }\nfloat rn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(rh(i),rh(i+vec2(1,0)),f.x), mix(rh(i+vec2(0,1)),rh(i+vec2(1,1)),f.x), f.y); }')
        .replace(
          '#include <alphatest_fragment>',
          `{
  float crumble = rn(vRoadW * 1.3) * 0.6 + rn(vRoadW * 4.1) * 0.4;
  float keep = 1.0 - smoothstep(0.78, 0.98, vEdge + (crumble - 0.5) * 0.35);
  if (keep < 0.5) discard;
  // dusty, faded edges
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.02, 0.92), smoothstep(0.55, 0.9, vEdge));
  // Snow lies on it where it lies on the ground beside it (the mountain road climbs over the snow line): all over
  // its edges, and thinner in the two tracks wheels have kept open, where the asphalt shows dark and wet.
  // Along the lower edge of a snowy PLACE (src/world/snow.ts) the ground's own line is broken up over thirty or
  // forty metres, by a pattern this shader has not got: reckoned by its own, the asphalt lay white through bare
  // ground for the length of that belt. So there the road is the last thing the snow lies on, as a road is: it
  // is reckoned a dozen metres lower than it stands (all that the ground's ragged line can take off), and is dark
  // and wet through the belt and white where the ground about it is all white. Nothing of this where no place is.
  vec2 roadPlace = snowPlace(vRoadP.xz);
  float lies = snowLies(vRoadP + vec3(0.0, -12.0 * smoothstep(0.0, 10.0, roadPlace.x), 0.0));
  if (lies > 0.0) {
    float track = 1.0 - smoothstep(0.07, 0.2, abs(vEdge - 0.38) + (crumble - 0.5) * 0.08);
    float laid = lies * (1.0 - 0.72 * track * (1.0 - 0.6 * smoothstep(0.75, 1.0, lies)));
    diffuseColor.rgb = mix(diffuseColor.rgb * mix(1.0, 0.72, lies * track), ${SNOW_PAINT}, laid);
  }
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
  // and the bridges the road goes over: their decks, piers and railings, and what is solid of them
  buildBridges(world, atmo, scene);
  // and the ruined gatehouse the mountain road stops at
  if (world.gatehouse) buildGatehouse(world.gatehouse, atmo, scene);
  // and what stands on the crest over it: the old village's low walls, and the helicopter behind the fort
  buildDrystone(world.walls, atmo, scene);
  buildWreck(world, scene);
  return firstMesh!;
}
