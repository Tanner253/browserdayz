// What a survivor looks like: jacket and trouser colours, skin, hair. Everything is derived
// from the player's name, so every client draws the same person without the server having
// to say anything about it.
//
// The character's texture has its clothes painted in neutral grey. A second texture marks
// which texels are jacket (red), trousers (green) and boots (blue); the body material
// multiplies the grey by this player's colours there, and the skin tone everywhere else.

import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { assets } from '../core/assets';

const CHARACTER_URL = 'assets/characters/survivor.glb';
const MASK_URL = 'assets/characters/survivor_mask.webp';

let character: Promise<GLTF> | null = null;

/**
 * The character file, parsed once and kept for good: every body in the world is a copy of
 * it, sharing its geometry and textures, however late that player walks in.
 */
export function loadCharacter(): Promise<GLTF> {
  return (character ??= assets.loadGLTF(CHARACTER_URL));
}

export const HAIR_STYLES = ['hair_buzzed', 'hair_parted', 'hair_long'] as const;
export const BEARD = 'hair_beard';

export interface Look {
  jacket: THREE.Color;
  trousers: THREE.Color;
  /** multiplied into the skin */
  skin: THREE.Color;
  hairColor: THREE.Color;
  /** index into HAIR_STYLES, or -1 for a shaved head */
  hair: number;
  beard: boolean;
}

// Field clothing: olive, coyote, ranger green, field grey, khaki, black. (There were a rust,
// a maroon, a teal and two blues among these when the body wore a civilian's jacket. On a
// soldier's suit they were a tracksuit. There are as many colours as there were, so nobody's
// other looks change with it.)
const JACKETS = [0x4b5235, 0x5a4a36, 0x3a3f45, 0x4d4f4c, 0x5c4a34, 0x33452f, 0x232527, 0x7a6a4c, 0x54563c, 0x454a3a, 0x6a6048, 0x2b3327];
const TROUSERS = [0x3a3d38, 0x6b5f47, 0x3d4430, 0x2a2b2d, 0x4a3b2c, 0x555a5c, 0x343d33];
const SKIN = [0xffffff, 0xfff1e6, 0xe2cdbf, 0xb9957f, 0x8a6a57, 0x5e4538];
const HAIR = [0x17120e, 0x2b1d14, 0x4a3221, 0x6e5235, 0x8d7448, 0x7c7a76, 0x5c2a17];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  // a few rounds more: names that differ in one letter should not look alike
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}

export function lookFor(seed: string): Look {
  let h = hash(seed || 'survivor');
  const pick = (n: number) => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return Math.floor((h / 4294967296) * n);
  };
  const jacket = pick(JACKETS.length);
  const trousers = pick(TROUSERS.length);
  const skin = pick(SKIN.length);
  const hairColor = pick(HAIR.length);
  const style = pick(HAIR_STYLES.length + 1);
  const beard = pick(5) < 2;
  return {
    jacket: new THREE.Color(JACKETS[jacket]),
    trousers: new THREE.Color(TROUSERS[trousers]),
    skin: new THREE.Color(SKIN[skin]),
    hairColor: new THREE.Color(HAIR[hairColor]),
    hair: style < HAIR_STYLES.length ? style : -1,
    beard,
  };
}

/** the painted cloth is a mid grey: this brings a colour multiplied into it back up to itself */
const CLOTH_GAIN = 1.85;

/** how many bloodstains one body can carry at once (the oldest is painted over) */
export const MAX_WOUNDS = 8;

export interface LookUniforms {
  /** bloodstains: where on the body at rest (xyz) and how big (w, 0 = none) */
  uWounds: { value: THREE.Vector4[] };
  tLook: { value: THREE.Texture };
  uJacket: { value: THREE.Color };
  uTrousers: { value: THREE.Color };
  uSkin: { value: THREE.Color };
}

export function lookUniforms(): LookUniforms {
  const tLook = assets.texture(MASK_URL);
  // glTF texture coordinates: the image is not flipped
  tLook.flipY = false;
  return { uWounds: { value: Array.from({ length: MAX_WOUNDS }, () => new THREE.Vector4(0, 0, 0, 0)) }, tLook: { value: tLook }, uJacket: { value: new THREE.Color(1, 1, 1) }, uTrousers: { value: new THREE.Color(1, 1, 1) }, uSkin: { value: new THREE.Color(1, 1, 1) } };
}

export function setLookUniforms(u: LookUniforms, look: Look) {
  u.uJacket.value.copy(look.jacket).multiplyScalar(CLOTH_GAIN);
  u.uTrousers.value.copy(look.trousers).multiplyScalar(CLOTH_GAIN);
  u.uSkin.value.copy(look.skin);
}

/** what every body's material is told about bloodstains: declared with the rest, worked out after the colour map */
const WOUND_DECL = `uniform vec4 uWounds[${MAX_WOUNDS}];\nfloat woundK;`;
const WOUND_CODE = `
  woundK = 0.0;
  // a ragged edge, so a stain is a blot and not a disc
  float rag = sin(vRest.x * 211.0 + vRest.y * 97.0) * sin(vRest.y * 173.0 - vRest.z * 131.0) * 0.16 + sin(vRest.x * 61.0 - vRest.z * 83.0 + vRest.y * 47.0) * 0.12;
  for (int i = 0; i < ${MAX_WOUNDS}; i++) {
    vec4 wd = uWounds[i];
    if (wd.w > 0.0) woundK = max(woundK, 1.0 - smoothstep(0.5, 1.0, distance(vRest, wd.xyz) / wd.w + rag));
  }
  // soaked through in the middle, thinner and brighter at the edge
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.22, 0.01, 0.007), vec3(0.085, 0.004, 0.003), smoothstep(0.35, 1.0, woundK)), min(1.0, woundK * 1.25) * 0.94);`;

type Shader = { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string };

// A stain is a small sphere fixed to the body as it stands at rest: whatever skin or cloth
// is inside it is soaked. The vertex position before skinning is that rest position, so a
// stain moves with the limb it is on at no cost.
function stained(shader: Shader, vertexDecl: string, vertexCode: string, fragmentDecl: string, tint: string) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vRest;\n${vertexDecl}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\nvRest = position;\n${vertexCode}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vRest;\n${fragmentDecl}\n${WOUND_DECL}`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, woundK);')
    .replace('#include <map_fragment>', `#include <map_fragment>\n{\n${tint}\n${WOUND_CODE}\n}`);
}

/** Shader patch for the body material of the plain body (it must have a colour map): clothes by the mask texture. */
export function lookPatch(shader: Shader, u: LookUniforms) {
  Object.assign(shader.uniforms, u);
  stained(shader, '', '', 'uniform sampler2D tLook;\nuniform vec3 uJacket;\nuniform vec3 uTrousers;\nuniform vec3 uSkin;', `
  vec3 lk = texture2D(tLook, vMapUv).rgb;
  vec3 tint = mix(uSkin, vec3(1.0), min(1.0, lk.r + lk.g + lk.b));
  tint = mix(tint, uJacket, lk.r);
  tint = mix(tint, uTrousers, lk.g);
  diffuseColor.rgb *= tint;`);
}

/**
 * What the suit's cloth is, on average, as light. A player's own colour is put in its place:
 * the weave, the seams and the wear stay, and the olive becomes that colour. (The uniforms
 * carry CLOTH_GAIN, which the painted grey of the plain body needed; it is taken off here.)
 */
const SUIT_CLOTH = [0.0818, 0.0744, 0.0435].map((v) => (1 / (v * CLOTH_GAIN)).toFixed(3)).join(', ');
/** how far toward the player's colour it goes: all the way looked dyed */
const SUIT_OWN = '0.7';

/**
 * Shader patch for every material of the suit (scripts/suit.mjs). Which of the body shape is
 * jacket and which trousers is said point by point (`_tone`: red, green); the other pieces
 * have no such thing and keep their own colour.
 */
export function suitPatch(shader: Shader, u: LookUniforms) {
  Object.assign(shader.uniforms, { uWounds: u.uWounds, uJacket: u.uJacket, uTrousers: u.uTrousers });
  stained(shader, 'attribute vec4 _tone;\nvarying vec3 vTone;', 'vTone = _tone.rgb;', 'uniform vec3 uJacket;\nuniform vec3 uTrousers;\nvarying vec3 vTone;', `
  vec3 own = mix(vec3(1.0), uJacket * vec3(${SUIT_CLOTH}), vTone.r * ${SUIT_OWN});
  own = mix(own, uTrousers * vec3(${SUIT_CLOTH}), vTone.g * ${SUIT_OWN});
  diffuseColor.rgb *= own;`);
}
