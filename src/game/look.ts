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

// worn outdoor clothing: nothing brighter than it would be after a month in the woods
const JACKETS = [0x4b5235, 0x5a4a36, 0x2f3b4a, 0x4d4f4c, 0x6b3f2a, 0x33452f, 0x232527, 0x7a6a4c, 0x5a2e30, 0x3d4f57, 0x6a6048, 0x2b3327];
const TROUSERS = [0x2c3644, 0x6b5f47, 0x3d4430, 0x2a2b2d, 0x4a3b2c, 0x555a5c, 0x343d33];
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

export interface LookUniforms {
  tLook: { value: THREE.Texture };
  uJacket: { value: THREE.Color };
  uTrousers: { value: THREE.Color };
  uSkin: { value: THREE.Color };
}

export function lookUniforms(): LookUniforms {
  const tLook = assets.texture(MASK_URL);
  // glTF texture coordinates: the image is not flipped
  tLook.flipY = false;
  return { tLook: { value: tLook }, uJacket: { value: new THREE.Color(1, 1, 1) }, uTrousers: { value: new THREE.Color(1, 1, 1) }, uSkin: { value: new THREE.Color(1, 1, 1) } };
}

export function setLookUniforms(u: LookUniforms, look: Look) {
  u.uJacket.value.copy(look.jacket).multiplyScalar(CLOTH_GAIN);
  u.uTrousers.value.copy(look.trousers).multiplyScalar(CLOTH_GAIN);
  u.uSkin.value.copy(look.skin);
}

/** Shader patch for the body material (it must have a colour map). */
export function lookPatch(shader: { uniforms: Record<string, THREE.IUniform>; fragmentShader: string }, u: LookUniforms) {
  Object.assign(shader.uniforms, u);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform sampler2D tLook;\nuniform vec3 uJacket;\nuniform vec3 uTrousers;\nuniform vec3 uSkin;')
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
{
  vec3 lk = texture2D(tLook, vMapUv).rgb;
  vec3 tint = mix(uSkin, vec3(1.0), min(1.0, lk.r + lk.g + lk.b));
  tint = mix(tint, uJacket, lk.r);
  tint = mix(tint, uTrousers, lk.g);
  diffuseColor.rgb *= tint;
}`,
    );
}
