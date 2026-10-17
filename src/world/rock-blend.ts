// Rock that meets the ground without a seam (the owner, 2026-10-16: "the mesh should blend i dont like the clipping").
// A scanned rock's own material, made so that within a metre of the ground under it (the terrain's own height, read as
// the terrain is drawn: the same triangles) it fades into the ground's own picture there: the canyon's layered rock on
// a face, scree or sand on the level, its edge broken by noise, its facing bent to the ground's, its gloss gone. So a
// piece stands in the ground and not on it, and no hard line runs round its foot. Shared: the pass's walls and cave
// mouths (src/world/caves.ts), the canyon country's outcrops (src/world/outcrops.ts), the world's boulders.
//
//   rockBlend(atmo, terrain.heightTex, material)           // instead of atmo.register(material)
//   rockBlend(atmo, terrain.heightTex, material, 'dune')   // a piece on sand: the level ground is the dunes' picture

import * as THREE from 'three';
import { assets } from '../core/assets';
import type { Atmosphere } from './atmosphere';
import { KINDS } from './ground';
import { worldUniforms } from './terrain';
import { CELL } from './worldgen';

export const BLEND = {
  /** metres over the ground over which a rock fades into it */
  reach: 0.9,
  /** metres either way its edge is broken by noise */
  edge: 0.45,
};

/** the ground a rock fades into on a face, and on the level: the ground's own kinds (src/world/ground.ts) */
type Flat = 'grit' | 'dune' | 'beach' | 'stony' | 'cracked';

const ready = new Map<string, Record<string, THREE.IUniform>>();
function uniformsFor(heightTex: THREE.Texture, flat: Flat) {
  const key = `${heightTex.uuid}:${flat}`;
  let u = ready.get(key);
  if (u) return u;
  const tex = (id: string) => assets.texture(assets.manifest.textures[id].diff, { srgb: true, repeat: true });
  const face = KINDS.canyon, level = KINDS[flat];
  u = {
    ...worldUniforms(),
    tBlendH: { value: heightTex },
    tBlendFace: { value: tex(face.tex) },
    tBlendLevel: { value: tex(level.tex) },
    uBlendSize: { value: new THREE.Vector4(face.size, level.size, BLEND.reach, BLEND.edge) },
    uBlendFaceTint: { value: new THREE.Vector3(...face.tint) },
    uBlendLevelTint: { value: new THREE.Vector3(...level.tint) },
  };
  ready.set(key, u);
  return u;
}

/** A rock's material made to fade into the ground where it meets it (see the head of this file). Returns it. */
export function rockBlend(atmo: Atmosphere, heightTex: THREE.Texture, mat: THREE.MeshStandardMaterial, flat: Flat = 'grit') {
  const u = uniformsFor(heightTex, flat);
  atmo.register(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBlendPos;')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          {
            vec4 bp = vec4( transformed, 1.0 );
            #ifdef USE_INSTANCING
              bp = instanceMatrix * bp;
            #endif
            vBlendPos = ( modelMatrix * bp ).xyz;
          }`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${BLEND_GLSL}`)
        .replace(
          '#include <map_fragment>',
          /* glsl */ `#include <map_fragment>
          // the ground under the point, which way it faces, and how far over it the point is (its edge broken)
          float bGround = blendGround( vBlendPos.xz );
          vec3 bN = normalize( vec3( blendGround( vBlendPos.xz - vec2( 1.0, 0.0 ) ) - blendGround( vBlendPos.xz + vec2( 1.0, 0.0 ) ), 2.0, blendGround( vBlendPos.xz - vec2( 0.0, 1.0 ) ) - blendGround( vBlendPos.xz + vec2( 0.0, 1.0 ) ) ) );
          float bBreak = ( blendNoise( vBlendPos.xz * 1.3 + vBlendPos.y * 0.7 ) * 0.65 + blendNoise( vBlendPos.xz * 4.1 - vBlendPos.y ) * 0.35 - 0.5 ) * 2.0 * uBlendSize.w;
          float bK = ( 1.0 - smoothstep( 0.0, uBlendSize.z, vBlendPos.y - bGround + bBreak ) ) * step( -4.0, vBlendPos.y - bGround );
          // (the ground's own picture there: the canyon's rock on a face of more than some 44 degrees, laid along the
          // face as the ground lays it; else the level's, laid from above)
          vec2 bAlong = abs( bN.x ) > abs( bN.z ) ? vBlendPos.zy : vBlendPos.xy;
          vec3 bFace = texture2D( tBlendFace, bAlong / uBlendSize.x ).rgb * uBlendFaceTint;
          vec3 bLevel = texture2D( tBlendLevel, vBlendPos.xz / uBlendSize.y ).rgb * uBlendLevelTint;
          diffuseColor.rgb = mix( diffuseColor.rgb, groundKnee( mix( bLevel, bFace, smoothstep( 0.76, 0.66, bN.y ) ) ), bK );`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.95, bK );')
        .replace(
          '#include <normal_fragment_maps>',
          '#include <normal_fragment_maps>\nnormal = normalize( mix( normal, normalize( ( viewMatrix * vec4( bN, 0.0 ) ).xyz ), bK * 0.85 ) );',
        );
    },
    `rock-blend:${flat}`,
  );
  return mat;
}

/**
 * The ground's pictures held down as the terrain holds them (src/world/terrain.ts: a scan's pale stones over 0.34 of
 * white kept to a fifth of their rise): a picture of the ground laid on anything else, and not held so, reads as a
 * pale patch where it meets the ground itself (the carved mouths did, 2026-10-16).
 */
export const GROUND_KNEE = /* glsl */ `
  vec3 groundKnee( vec3 c ) {
    float l = dot( c, vec3( 0.299, 0.587, 0.114 ) );
    return c * ( l < 0.34 ? 1.0 : ( 0.34 + ( l - 0.34 ) * 0.22 ) / max( l, 1e-4 ) );
  }
`;

const BLEND_GLSL = /* glsl */ `
  ${GROUND_KNEE}
  uniform sampler2D tBlendH, tBlendFace, tBlendLevel;
  uniform vec4 uWorld;
  uniform vec2 uWorldRes;
  uniform vec4 uBlendSize;
  uniform vec3 uBlendFaceTint, uBlendLevelTint;
  varying vec3 vBlendPos;
  float blendH( ivec2 c ) {
    c = clamp( c, ivec2( 0 ), ivec2( uWorldRes ) - 1 );
    return texelFetch( tBlendH, c, 0 ).r;
  }
  // (the same triangles as the ground's mesh and its collider: src/world/grass.ts terrainH)
  float blendGround( vec2 p ) {
    vec2 g = ( p - uWorld.xy ) / ${CELL.toFixed(4)};
    vec2 i = floor( g ), f = g - i;
    ivec2 c = ivec2( i );
    float h00 = blendH( c ), h10 = blendH( c + ivec2( 1, 0 ) ), h01 = blendH( c + ivec2( 0, 1 ) ), h11 = blendH( c + ivec2( 1, 1 ) );
    if ( f.x + f.y <= 1.0 ) return h00 + ( h10 - h00 ) * f.x + ( h01 - h00 ) * f.y;
    return h11 + ( h01 - h11 ) * ( 1.0 - f.x ) + ( h10 - h11 ) * ( 1.0 - f.y );
  }
  float blendHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float blendNoise( vec2 p ) {
    vec2 i = floor( p ), f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( blendHash( i ), blendHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( blendHash( i + vec2( 0.0, 1.0 ) ), blendHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
  }
`;
