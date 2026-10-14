// Shader patches shared by every instanced foliage / prop material:
//  - wind: whole-plant sway (height-weighted) + leaf flutter
//  - LOD dithering: screen-space dissolve between LOD levels (no popping)
//  - translucency: sunlight bleeding through leaves when looking toward the sun

import * as THREE from 'three';
import type { ShaderPatch } from './atmosphere';
import { SNOW_LIFT, snowUniforms } from './snow';
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
  /**
   * WHERE IT MEETS THE GROUND, for a thing seated in it (src/world/seat.ts; with `snow: 'solid'`): [how far over
   * its lowest point the ground meets it, its model's own measure; how high snow is drifted against it, metres].
   * The owner (2026-10-14): "half floating disconnected from the ground oobjects dont look good". A thing that
   * stands in the ground is damp and dark at its foot, and where snow lies the snow is banked against it: no hard
   * line between a brown stump and white ground. Painted from how high over its own foot a point of it is, which
   * its model says: nothing is asked of the ground, and nothing more is drawn.
   */
  foot?: [number, number];
}

/**
 * Where snow lies on what stands at `o` (a place in the world): the line is ragged over the ground, not level. By
 * its height, or by its place (src/world/snow.ts: about the fort and along the track to it the ground is reckoned
 * higher than it stands). A material that has this in its shader is handed `snowUniforms` with it; one that is not
 * reads the rule by height alone.
 */
export const SNOW_LIES = /* glsl */ `${SNOW_LIFT}
float snowLies(vec3 o) {
  float ragged = sin(o.x * 0.043) * 6.0 + sin(o.z * 0.057 + 1.3) * 6.0;
  return smoothstep(${SNOW.from.toFixed(1)}, ${SNOW.full.toFixed(1)}, o.y + ragged + snowLift(o.xz));
}`;
export { snowUniforms };
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
  // (a number of the material's own, not written into the shader: every stone has its own, and they are one program)
  const foot = opts.foot && opts.snow === 'solid' ? { value: new THREE.Vector2(opts.foot[0], opts.foot[1]) } : null;
  const footPars = foot ? '\nuniform vec2 uFoot;\nvarying float vFolOver;' : '';

  const patch: ShaderPatch = (shader) => {
    Object.assign(shader.uniforms, wind, { uLod: lod }, opts.snow ? snowUniforms : null, foot ? { uFoot: foot } : null);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uTime;
uniform vec3 uWindDir;
uniform float uWindStrength;
varying float vLodDist;
varying vec3 vFolWorld;
varying vec3 vFolOrigin;${footPars}`,
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
  vFolWorld = (modelMatrix * vec4(instO + rot * transformed, 1.0)).xyz;${foot ? `
  // (metres over where the ground meets it, up its own height: its size in the world is in how it is set down)
  vFolOver = (position.y - uFoot.x) * length(rot[1]);` : ''}
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform vec4 uLod;
varying float vLodDist;
varying vec3 vFolWorld;
varying vec3 vFolOrigin;${footPars}${opts.snow ? SNOW_LIES : ''}`,
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
  float lies = snowLies(vFolOrigin);${foot ? `
  // Its foot (see \`foot\`): damp and dark for a hand or two up from the ground, by a ragged line and not a ruled one.
  float footRag = 0.5 + 0.5 * sin(vFolWorld.x * 9.1 + vFolWorld.z * 7.3) * sin(vFolWorld.z * 11.7 - vFolWorld.x * 5.3);
  diffuseColor.rgb *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.12 + 0.22 * footRag, vFolOver));` : ''}
  if (lies > 0.0) {
    float up = dot(normalize(vNormal), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
    ${opts.snow === 'leaf' ? `
    float patchy = 0.5 + 0.5 * sin(vFolWorld.x * 3.1 + vFolWorld.y * 5.3) * sin(vFolWorld.z * 2.7 - vFolWorld.y * 4.1);
    float laid = lies * mix(0.5, 0.92, patchy) * (0.65 + 0.35 * abs(up));` : `
    float laid = lies * smoothstep(0.3, 0.7, up);`}${foot ? `
    // (and where snow lies it is drifted against that foot, whichever way the foot faces)
    laid = max(laid, lies * (1.0 - smoothstep(0.0, uFoot.y * (0.45 + 1.1 * footRag), vFolOver)));` : ''}
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
