// A layout of a kit's pieces (src/sim/kit.ts), as things to draw: every piece of the layout put into ONE shape for
// each of the kit's materials, so a whole fort of them is two or three things to draw however many pieces it has.
//
// Why one shape and not one copy of each piece drawn many times: a ruin is pieces with parts broken out of them,
// and a piece with a part broken out is no longer the piece. Here each triangle is stood where its piece stands
// and what a cut takes out of it is taken out; what is left goes into the one shape. A piece costs its triangles
// once for each time it is used (a length of wall is a thousand), which is little.
//
// RE-SKIN. A kit's materials can be given another set of pictures by name (`sets`), laid `repeat` times as often as
// the kit's own were: the same walls in grey slate for a mountain, in the kit's own warm stone for a desert, in
// brick or concrete for something else. A kit's own wall picture is a whole wall, foot to top, with its streaks of
// rain and its dirty foot painted in; another set laid on it is plain stone all the way up.
//
// THE LOOK OF STONE (`stoneLook`): one patch for any stone material, the kit's or anybody's own: its colour drawn
// toward grey and tinted, and snow laid on it where it faces the sky. Whoever makes the material registers it.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { breathe } from '../core/breathe';
import { clipOut, kitMatrix, type KitPiece, type V3 } from '../sim/kit';
import type { ShaderPatch } from './atmosphere';
import { SNOW_GROUND } from './ground';

export interface KitOptions {
  /** 1: the kit's far copy (fewer triangles, small pictures); unsaid, the kit as the world draws it */
  lod?: number;
  /** which copy the triangles are taken from, where that is not the copy the pictures are (1: the far copy's few triangles under the near copy's pictures, for a scan of a hundred thousand triangles that is stood many times) */
  shapes?: number;
  /** another set of pictures for a material of the kit, by the material's name: which set (the manifest's `textures`), and how many times as often it is laid as the kit's own picture was */
  sets?: Record<string, { set: string; repeat?: number }>;
  /** each material as it is made, for whoever stands the layout to dress and register: what comes back is drawn with */
  dress?: (mat: THREE.MeshStandardMaterial, name: string) => THREE.Material;
  /** two numbers kept with every corner, under this name (the fort: whether the sky is over it, and how high it is over its foot) */
  attr?: { name: string; of: (p: V3, n: V3) => [number, number] };
}

interface Part { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial; m: THREE.Matrix4 }
const parted = new WeakMap<THREE.Object3D, Map<string, Part[]>>();
/** the shapes a piece is made of, each said from the piece's own origin */
function partsOf(root: THREE.Object3D, id: string): Part[] {
  let known = parted.get(root);
  if (!known) parted.set(root, (known = new Map()));
  let parts = known.get(id);
  if (parts) return parts;
  const node = root.getObjectByName(id);
  if (!node) throw new Error(`the kit has no piece called ${id}`);
  root.updateMatrixWorld(true);
  const back = node.matrixWorld.clone().invert();
  parts = [];
  node.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) parts!.push({ geo: mesh.geometry, mat: mesh.material as THREE.MeshStandardMaterial, m: back.clone().multiply(mesh.matrixWorld) });
  });
  known.set(id, parts);
  return parts;
}

/**
 * The layout as meshes: one for each material that any of its pieces has. They are said in the layout's own
 * measure: whoever asks puts them in a group that is where the layout is. They cast no shadow and are not put in
 * any scene: that is the asker's to do.
 */
export async function kitMeshes(model: string, layout: KitPiece[], o: KitOptions = {}): Promise<{ meshes: THREE.Mesh[]; triangles: number }> {
  const root = await assets.model(model, o.shapes ?? o.lod ?? 0);
  // (the materials of the copy that is asked for, by name: the same as the shapes' own unless the shapes are another copy's)
  const paints = new Map<string, THREE.MeshStandardMaterial>();
  if (o.shapes !== undefined && o.shapes !== (o.lod ?? 0)) (await assets.model(model, o.lod ?? 0)).traverse((n) => {
    const m = (n as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if ((n as THREE.Mesh).isMesh && m) paints.set(m.name || 'stone', m);
  });
  const rows = new Map<string, { mat: THREE.MeshStandardMaterial; pos: number[]; nrm: number[]; uv: number[]; extra: number[] }>();
  const full = new THREE.Matrix4(), turnOnly = new THREE.Matrix3(), v = new THREE.Vector3(), n = new THREE.Vector3();
  for (const p of layout) {
    // (a piece to a helping: a layout of a dozen pieces is a tenth of a second of sums, and nothing is drawn the while if it is done in one go)
    await breathe();
    const stand = new THREE.Matrix4().fromArray(kitMatrix(p));
    for (const part of partsOf(root, p.id)) {
      const name = part.mat.name || 'stone';
      let row = rows.get(name);
      if (!row) rows.set(name, (row = { mat: paints.get(name) ?? part.mat, pos: [], nrm: [], uv: [], extra: [] }));
      const repeat = o.sets?.[name]?.repeat ?? 1;
      full.multiplyMatrices(stand, part.m);
      turnOnly.getNormalMatrix(full);
      const P = part.geo.getAttribute('position'), N = part.geo.getAttribute('normal'), U = part.geo.getAttribute('uv'), I = part.geo.getIndex();
      // (each corner once: where it stands, which way it faces, where it is on the picture)
      const corners: number[][] = [];
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(full);
        n.fromBufferAttribute(N, i).applyMatrix3(turnOnly).normalize();
        corners.push([v.x, v.y, v.z, n.x, n.y, n.z, U ? U.getX(i) * repeat : 0, U ? U.getY(i) * repeat : 0]);
      }
      const count = I ? I.count : P.count, cuts = p.cut ?? [];
      for (let t = 0; t < count; t += 3) {
        let polys: number[][][] = [[0, 1, 2].map((k) => corners[I ? I.getX(t + k) : t + k])];
        if (cuts.length) {
          // (only the cuts that could touch this triangle are tried on it)
          const a = polys[0][0], b = polys[0][1], c = polys[0][2], mx = (a[0] + b[0] + c[0]) / 3, my = (a[1] + b[1] + c[1]) / 3, mz = (a[2] + b[2] + c[2]) / 3;
          const reach = Math.max(Math.hypot(a[0] - mx, a[1] - my, a[2] - mz), Math.hypot(b[0] - mx, b[1] - my, b[2] - mz), Math.hypot(c[0] - mx, c[1] - my, c[2] - mz));
          for (const cut of cuts) {
            if (Math.hypot(cut.mid[0] - mx, cut.mid[1] - my, cut.mid[2] - mz) > cut.reach + reach) continue;
            polys = polys.flatMap((poly) => clipOut(poly, cut));
          }
        }
        for (const poly of polys) for (let k = 1; k + 1 < poly.length; k++) for (const q of [poly[0], poly[k], poly[k + 1]]) {
          row.pos.push(q[0], q[1], q[2]);
          row.nrm.push(q[3], q[4], q[5]);
          row.uv.push(q[6], q[7]);
          if (o.attr) row.extra.push(...o.attr.of([q[0], q[1], q[2]], [q[3], q[4], q[5]]));
        }
      }
    }
  }
  const meshes: THREE.Mesh[] = [];
  let triangles = 0;
  for (const [name, row] of rows) {
    if (!row.pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(row.pos), 3));
    const nrm = new Float32Array(row.nrm);
    // (a corner made where a cut crosses an edge faces between its two ends: brought back to length one)
    for (let i = 0; i < nrm.length; i += 3) {
      const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      nrm[i] /= l;
      nrm[i + 1] /= l;
      nrm[i + 2] /= l;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(row.uv), 2));
    if (o.attr) geo.setAttribute(o.attr.name, new THREE.BufferAttribute(new Float32Array(row.extra), 2));
    geo.computeBoundingSphere();
    const mat = row.mat.clone();
    mat.name = row.mat.name;
    const set = o.sets?.[name];
    if (set) {
      const t = assets.pbr(set.set);
      Object.assign(mat, { map: t.map, normalMap: t.normalMap, roughnessMap: t.armMap, metalnessMap: null, aoMap: t.armMap, roughness: 1, metalness: 0 });
      // (it is not the kit's own stone any more: the kit's own sharper pictures are not to be put back on it when the eye comes near)
      delete mat.userData.hi;
    }
    const mesh = new THREE.Mesh(geo, o.dress ? o.dress(mat, name) : mat);
    mesh.name = `${model}:${name}`;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    meshes.push(mesh);
    triangles += row.pos.length / 9;
  }
  return { meshes, triangles };
}

export interface StoneLook {
  /**
   * Of the sky's light, how much a stuff takes that is drawn with no picture: a picture of stone has its joints and
   * hollows in it, into which the sky does not see (the fort's own comes to 0.45 of it, taken all over); one flat
   * colour has none, and in shade it was twice as pale as the same wall with its picture on. The sun's own light is
   * not touched, as it is not by a picture's hollows. Unsaid: all of it.
   */
  hollows?: number;
  /** how much of the picture's own colour is kept (0 grey, 1 as it came), and what it is multiplied by after */
  keep?: number;
  tint?: [number, number, number];
  /** its light and dark drawn in toward this colour by so much (0: left as it is) */
  own?: [number, number, number];
  even?: number;
  /** how much snow lies: a number that may be changed at any time (0 none, 1 deep winter). Unsaid: none, and nothing of snow is in the shader */
  snow?: { value: number };
  /**
   * The name of two numbers kept with each corner. The first: how much of the day reaches it: 1 under the sky, and
   * under cover whatever comes in at the nearest opening (0 to about a half). Snow lies only where it is 1, and
   * the light of the sky and what the sky throws back is dimmed by it, so that a place under a roof is dark, each
   * place by itself and whoever is looking. The second: how high the corner is over its foot (or, of a floor, how
   * far from the nearest wall; 9: not said). Unsaid: the sky is over all of it.
   */
  attr?: string;
  /** rain has darkened the foot of what stands, by so much (needs `attr`) */
  damp?: number;
  /** snow lies thinner on it by so much (boards that are walked on, which it is trodden and blown off) */
  thin?: number;
}

/** snow, as paint: the ground's own (src/world/ground.ts: its one place), so that what lies on a wall and what lies at its foot are one snow */
const SNOW_PAINT = `vec3( ${SNOW_GROUND.colour.map((c) => c.toFixed(3)).join(', ')} )`;

/**
 * The look of stone, for any standard material. Colour only: nothing here moves a corner or reads a picture more.
 *
 * SNOW. It lies on what faces up under the sky: thick where it is level, thinning as a face steepens, with an
 * edge that is ragged at two sizes and never a line; drifted against the foot of whatever stands in the open,
 * and trodden thin in the open middle of a floor that is walked on (where the corners say how far a wall is). The
 * stone is dark and wet in a line along its edge; thin snow is blue-grey, deep snow near white, and none of it is
 * the white of paper: the sun and the sky's own shade do the rest, as on anything.
 */
export const stoneLook = (o: StoneLook): ShaderPatch => (shader) => {
  const f = (x: number) => x.toFixed(3), snow = o.snow;
  if (snow) shader.uniforms.uSnow = snow;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${o.attr ? `attribute vec2 ${o.attr};\nvarying vec2 vStoneAt;` : ''}\nvarying vec3 vStoneW;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${o.attr ? `vStoneAt = ${o.attr};` : ''}\nvStoneW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;`);
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
${snow ? 'uniform float uSnow;' : ''}
${o.attr ? 'varying vec2 vStoneAt;' : ''}
varying vec3 vStoneW;
// (a number for each square, with no sine in it: a sine of a big number is not the same on every card)
float stoneCell( vec2 c ) { vec3 q = fract( vec3( c.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
float stoneCloud( vec2 p ) { vec2 i = floor( p ), u = fract( p ); u = u * u * ( 3.0 - 2.0 * u ); return mix( mix( stoneCell( i ), stoneCell( i + vec2( 1.0, 0.0 ) ), u.x ), mix( stoneCell( i + vec2( 0.0, 1.0 ) ), stoneCell( i + vec2( 1.0, 1.0 ) ), u.x ), u.y ); }`,
    )
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
{
  float stoneGrey = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
  diffuseColor.rgb = mix( vec3( stoneGrey ), diffuseColor.rgb, ${f(o.keep ?? 1)} ) * vec3( ${(o.tint ?? [1, 1, 1]).map(f).join(', ')} );
  ${o.own && o.even ? `diffuseColor.rgb = mix( diffuseColor.rgb, vec3( ${o.own.map(f).join(', ')} ), ${f(o.even)} );` : ''}
}`,
    )
    .replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
{
  vec3 stoneN = normalize( vNormal );
  #ifdef DOUBLE_SIDED
    stoneN *= gl_FrontFacing ? 1.0 : -1.0;
  #endif
  float stoneUp = dot( stoneN, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) );
  vec2 stoneAt = ${o.attr ? 'vStoneAt' : 'vec2( 1.0, 9.0 )'};
  float stoneStands = 1.0 - smoothstep( 0.25, 0.6, abs( stoneUp ) );
  ${o.damp && o.attr ? `diffuseColor.rgb *= 1.0 - ${f(o.damp)} * ( 1.0 - smoothstep( 0.0, 0.5 + 0.5 * stoneCloud( vStoneW.xz * 0.7 + vStoneW.y ), stoneAt.y ) ) * stoneStands;` : ''}
  ${snow ? `if ( uSnow > 0.001 ) {
    // ragged at two sizes: drifts a few paces across, and an edge a hand across
    float wide = stoneCloud( vStoneW.xz * 0.42 + 7.3 ), mid = stoneCloud( vStoneW.xz * 1.7 + 3.1 ), fine = stoneCloud( vStoneW.xz * 6.3 + vStoneW.y * 3.0 );
    // how deep it lies at this place: the wind has had it in patches a few paces across, and smaller ones; and on a
    // floor that is walked on it is trodden away in the open and left deep by the walls
    float walked = step( 0.9, stoneUp ) * step( stoneAt.y, 8.5 );
    float deep = uSnow * 1.15 - ( 1.0 - wide ) * 0.5 - ( 1.0 - mid ) * 0.22 - ${f(o.thin ?? 0)} - walked * 0.5 * smoothstep( 0.5, 1.7, stoneAt.y + ( wide - 0.5 ) * 1.4 );
    float lies = smoothstep( 0.62 - 0.2 * uSnow, 0.95 - 0.1 * uSnow, stoneUp + ( wide - 0.5 ) * 0.3 + ( fine - 0.5 ) * 0.12 ) * smoothstep( 0.0, 0.4, deep + ( fine - 0.5 ) * 0.3 );
    // drifted against the foot of what stands in the open
    float drift = ( 1.0 - smoothstep( 0.0, ( 0.08 + 0.4 * uSnow ) * ( 0.4 + 1.2 * wide ), stoneAt.y ) ) * stoneStands * step( stoneAt.y, 8.5 );
    float laid = clamp( max( lies, drift * smoothstep( 0.0, 0.2, uSnow ) ), 0.0, 1.0 ) * smoothstep( 0.7, 0.98, stoneAt.x );
    // the stone is wet and dark in a line along the edge of it
    float wet = smoothstep( 0.02, 0.22, laid ) * ( 1.0 - smoothstep( 0.22, 0.6, laid ) );
    diffuseColor.rgb *= 1.0 - 0.38 * wet;
    roughnessFactor = mix( roughnessFactor, 0.45, wet * 0.7 );
    vec3 thin = vec3( 0.50, 0.56, 0.66 );
    diffuseColor.rgb = mix( diffuseColor.rgb, mix( thin, ${SNOW_PAINT}, smoothstep( 0.25, 0.85, laid ) ) * ( 0.84 + 0.1 * mid + 0.06 * fine ), smoothstep( 0.12, 0.7, laid ) );
    roughnessFactor = mix( roughnessFactor, 0.82, smoothstep( 0.3, 0.8, laid ) );
    metalnessFactor *= 1.0 - laid;
  }` : ''}
}`,
    );
  // (under cover the light of the sky, and what the sky throws back, come to so much and no more: the light of the fires is not touched)
  if (o.attr || o.hollows !== undefined) shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
{
  // (what comes in at a hole is thrown about by pale stone: near the hole there is more of it than its share of the sky alone)
  float stoneDay = ${o.attr ? 'mix( 0.05, 1.0, clamp( vStoneAt.x * 1.5, 0.0, 1.0 ) )' : '1.0'} * ${f(o.hollows ?? 1)};
  reflectedLight.indirectDiffuse *= stoneDay;
  reflectedLight.indirectSpecular *= stoneDay;
}`);
};
