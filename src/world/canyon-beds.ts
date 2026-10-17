// THE CANYON'S BEDS as a chunk of shader (the terrain's, src/world/terrain.ts, and any other rock of the canyon: the
// carved rock round the caves' mouths, rock-blend's face), so that where a piece meets the wall its beds run on into
// the wall's in the same colours at the same heights. World-space: give it the world position.
//
//   head of the fragment shader:  CANYON_BEDS_GLSL          uniforms:  ...canyonBedsUniforms()
//   the canyon picture's colour:  float bow; c *= canyonBeds(worldPos, bow);
//   its picture read where the terrain reads it on a face (bowed with the beds):  canyonFaceUv(worldPos, normal, bow) / KINDS.canyon.size

import { macroTexture } from './macro';

/** the beds' functions, reading the large noise from the sampler named `macro` */
export const canyonBedsGlsl = (macro: string) => /* glsl */ `
// THE CANYON'S BEDS (the owner: "like the grand canyon"; and of the first walls, "does not look natural"): its rock
// banded by height as sandstone lies, red, rust, buff and chocolate, each bed its own thickness and tone; the beds
// bowed by the large grain and the small, thicker in one stretch of wall than the next, so that no two cliffs show
// the same stripes and the rock's picture never reads as a wallpaper's repeat. A tint about 1 on the rock's own colour.
// The bow is the bowing, which the picture's own layers follow on a face. Fading out far off, where a bed is a pixel.
vec3 bedTone(float h) {
  return h < 0.3 ? vec3(1.14, 0.84, 0.72) : (h < 0.55 ? vec3(1.2, 1.0, 0.8) : (h < 0.78 ? vec3(1.16, 1.12, 1.04) : vec3(0.78, 0.66, 0.6)));
}
vec3 canyonBeds(vec3 P, out float bow) {
  // (the noise's slow swell only, read from its coarse copies: its finer octaves bent the rock picture's layers into
  // wood grain, a metre's bend every few metres)
  vec4 m1 = textureLod(${macro}, P.xz / 400.0 + 0.17, 4.0);
  float m2 = textureLod(${macro}, P.zx / 120.0 + 0.53, 3.0).r;
  bow = (m1.r - 0.5) * 18.0 + (m2 - 0.5) * 3.0 + P.x * 0.015;
  float thick = 2.6 + 3.6 * m1.g;
  float t = (P.y + bow) / thick, k = floor(t), f = t - k;
  vec3 a = bedTone(fract(sin(k * 12.9898) * 43758.5453)), b = bedTone(fract(sin((k + 1.0) * 12.9898) * 43758.5453));
  // (a bed's foot in the shade of the one over it, where a soft bed is worn back)
  vec3 c = mix(a, b, smoothstep(0.84, 1.0, f)) * (0.86 + 0.14 * smoothstep(0.0, 0.2, f));
  return mix(vec3(1.0), c, 1.0 - smoothstep(500.0, 1400.0, length(P - cameraPosition)));
}
// (where the terrain reads the canyon's picture on a face, before its size: across, along whichever of x and z the face
// looks along less, and down its height, bowed with the beds; the terrain blends the two by the face's turn)
vec2 canyonFaceUv(vec3 P, vec3 N, float bow) {
  return abs(N.x) > abs(N.z) ? vec2(P.z, -P.y - bow) : vec2(P.x, -P.y - bow);
}
`;

/** the chunk for another material's fragment shader, its sampler its own */
export const CANYON_BEDS_GLSL = `uniform sampler2D tCanyonMacro;\n${canyonBedsGlsl('tCanyonMacro')}`;

/** the uniforms CANYON_BEDS_GLSL reads: the terrain's own large noise (the very texture) */
export const canyonBedsUniforms = () => ({ tCanyonMacro: { value: macroTexture() } });
