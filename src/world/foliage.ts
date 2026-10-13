// Shader patches shared by every instanced foliage / prop material:
//  - wind: whole-plant sway (height-weighted) + leaf flutter
//  - LOD dithering: screen-space dissolve between LOD levels (no popping)
//  - translucency: sunlight bleeding through leaves when looking toward the sun

import * as THREE from 'three';
import type { ShaderPatch } from './atmosphere';
import { SNOW } from './worldgen';

export const wind = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector3(0.8, 0, 0.6).normalize() },
  uWindStrength: { value: 1.0 },
};

export interface FoliageOpts {
  /** metres of height over which sway reaches full amplitude */
  height?: number;
  /** sway amplitude in metres at the top */
  sway?: number;
  /** leaf flutter amplitude in metres (0 for bark / rocks) */
  flutter?: number;
  /** sunlight transmission strength (leaves) */
  translucency?: number;
  sunDir?: THREE.Vector3;
  sunColor?: THREE.Color;
  /**
   * Snow on it, where it stands above the snow line (SNOW in the world's generator; 2026-10-13: "snowcapped, with
   * snowy rocks and snowy tees"). 'leaf': boughs and fronds, laden nearly all over, the more the flatter they lie.
   * 'solid': bark and stone, on what faces the sky and not on what stands upright.
   */
  snow?: 'leaf' | 'solid';
}

/** where snow lies on what stands at `o` (a place in the world): the line is ragged over the ground, not level */
export const SNOW_LIES = /* glsl */ `
float snowLies(vec3 o) {
  float ragged = sin(o.x * 0.043) * 6.0 + sin(o.z * 0.057 + 1.3) * 6.0;
  return smoothstep(${SNOW.from.toFixed(1)}, ${SNOW.full.toFixed(1)}, o.y + ragged);
}`;
/** snow, as paint: what the ground's own is (src/world/terrain.ts) */
export const SNOW_PAINT = 'vec3(0.80, 0.83, 0.88)';

/** Returns per-material LOD fade uniform plus the shader patch. */
export function foliagePatch(opts: FoliageOpts): { patch: ShaderPatch; lod: { value: THREE.Vector4 } } {
  const lod = { value: new THREE.Vector4(-2, -1, 1e6, 1e6 + 1) };
  const height = opts.height ?? 10;
  const sway = opts.sway ?? 0;
  const flutter = opts.flutter ?? 0;
  const trans = opts.translucency ?? 0;
  const sd = opts.sunDir ?? new THREE.Vector3(0, 1, 0);
  const sc = opts.sunColor ?? new THREE.Color(1, 1, 1);
  const f = (n: number) => n.toFixed(5);

  const patch: ShaderPatch = (shader) => {
    Object.assign(shader.uniforms, wind, { uLod: lod });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uTime;
uniform vec3 uWindDir;
uniform float uWindStrength;
varying float vLodDist;
varying vec3 vFolWorld;
varying vec3 vFolOrigin;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
{
  vec3 instO = vec3(0.0);
  mat3 rot = mat3(1.0);
  #ifdef USE_INSTANCING
    instO = instanceMatrix[3].xyz;
    rot = mat3(instanceMatrix);
  #endif
  vec3 origin = (modelMatrix * vec4(instO, 1.0)).xyz;
  vFolOrigin = origin;
  vLodDist = distance(origin, cameraPosition);
  float phase = dot(origin.xz, vec2(0.071, 0.113));
  float h = clamp(position.y / ${f(height)}, 0.0, 1.5);
  // wind direction in instance-local space (instances only rotate about Y)
  vec3 lw = normalize(transpose(rot) * uWindDir);
  float gust = 0.65 + 0.35 * sin(uTime * 0.31 + phase * 0.5) * sin(uTime * 0.17 + phase);
  float s = ${f(sway)} * uWindStrength * gust * h * h;
  transformed += lw * s * (0.6 + 0.4 * sin(uTime * 1.1 + phase));
  transformed += cross(lw, vec3(0.0, 1.0, 0.0)) * s * 0.3 * sin(uTime * 1.7 + phase * 1.3);
  ${flutter > 0 ? `
  float fl = ${f(flutter)} * uWindStrength * (0.4 + h);
  float lp = dot(position, vec3(1.7, 2.3, 1.1));
  transformed += vec3(sin(uTime * 6.1 + lp), sin(uTime * 7.3 + lp * 1.3) * 0.6, cos(uTime * 5.7 + lp)) * fl;` : ''}
  vFolWorld = (modelMatrix * vec4(instO + rot * transformed, 1.0)).xyz;
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform vec4 uLod;
varying float vLodDist;
varying vec3 vFolWorld;
varying vec3 vFolOrigin;${opts.snow ? SNOW_LIES : ''}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        /* glsl */ `#include <clipping_planes_fragment>
{
  float vis = smoothstep(uLod.x, uLod.y, vLodDist) * (1.0 - smoothstep(uLod.z, uLod.w, vLodDist));
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (vis < 0.999 && vis <= ign) discard;
}`,
      );
    if (opts.snow) {
      // (after its own colour, its roughness and its metal have been read: snow is laid over all three. A pass that
      // draws depth alone has no such line, and is left as it is.)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <metalnessmap_fragment>',
        /* glsl */ `#include <metalnessmap_fragment>
{
  float lies = snowLies(vFolOrigin);
  if (lies > 0.0) {
    float up = dot(normalize(vNormal), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
    ${opts.snow === 'leaf' ? `
    float patchy = 0.5 + 0.5 * sin(vFolWorld.x * 3.1 + vFolWorld.y * 5.3) * sin(vFolWorld.z * 2.7 - vFolWorld.y * 4.1);
    float laid = lies * mix(0.5, 0.92, patchy) * (0.65 + 0.35 * abs(up));` : `
    float laid = lies * smoothstep(0.3, 0.7, up);`}
    diffuseColor.rgb = mix(diffuseColor.rgb, ${SNOW_PAINT}, laid);
    roughnessFactor = mix(roughnessFactor, 0.65, laid);
    metalnessFactor *= 1.0 - laid;
  }
}`,
      );
    }
    if (trans > 0) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
{
  vec3 Vw = normalize(cameraPosition - vFolWorld);
  float back = pow(max(dot(-Vw, vec3(${f(sd.x)}, ${f(sd.y)}, ${f(sd.z)})), 0.0), 3.0);
  reflectedLight.directDiffuse += diffuseColor.rgb * vec3(${f(sc.r)}, ${f(sc.g)}, ${f(sc.b)}) * (${f(trans)} * (0.25 + 1.6 * back)) * uDaylight;
}`,
      );
    }
  };
  return { patch, lod };
}

export function setLodFade(lod: { value: THREE.Vector4 }, fadeIn: [number, number] | null, fadeOut: [number, number] | null) {
  lod.value.set(fadeIn ? fadeIn[0] : -2, fadeIn ? fadeIn[1] : -1, fadeOut ? fadeOut[0] : 1e6, fadeOut ? fadeOut[1] : 1e6 + 1);
}
