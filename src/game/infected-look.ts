// Each of the infected dressed as no other of its kind is (2026-10-25, from the owner's AAA bar: "AAA crowds never
// repeat"): the clothes of the upper body, of the legs and the skin each tinted within what its kind allows, grime laid
// on in blotches, old blood where it was bitten, and the body a little taller or shorter, broader or narrower.
// Cheap by design: the bodies of a kind share VARIANTS paints (each a material the one shader of every infected
// serves: no shader is made for them), taken by number, so that the same one looks the same in every game. The size is
// each one's own, and costs nothing. Which of a body is which clothes or skin is in its points (scripts/infected.mjs).

import * as THREE from 'three';
import { MAX_WOUNDS, infectedUniforms, type InfectedUniforms } from './look';
import { KINDS, bodyOf, roll, type InfectedKind } from './infected-kinds';

/** the paints a kind's bodies share */
export const VARIANTS = 8;

/** How far the clothes' colour may be turned: its hue round the wheel by up to `turn` radians either way, its depth of colour by `deep`, its lightness by `light`. */
interface Cloth {
  turn: number;
  deep: [number, number];
  light: [number, number];
}
/** How far the skin may go: pulled toward one of `hues` (0..1 round the wheel) by up to `pull`, and how light. */
interface Skin {
  hues: [number, number];
  pull: number;
  light: [number, number];
}
/** what anybody might have been wearing that day (turned from what it is by up to a sixth of the wheel: browns go red or olive, never violet) */
const ANY: Cloth = { turn: 1.1, deep: [0.5, 1.35], light: [0.82, 1.18] };
const WORN: Cloth = { turn: 0.6, deep: [0.45, 1.15], light: [0.82, 1.12] };
/** a uniform is a uniform: only how worn and faded it is */
const ISSUED: Cloth = { turn: 0.12, deep: [0.55, 1.1], light: [0.78, 1.08] };
/** the rare three's are mostly their skin */
const FLESH: Cloth = { turn: 0.15, deep: [0.7, 1.15], light: [0.85, 1.05] };
/** the dead's skin: toward grey-green or jaundice, never alive; or bruised */
const DEAD: Skin = { hues: [0.12, 0.4], pull: 0.18, light: [0.82, 1.08] };
const BRUISED: Skin = { hues: [0.72, 0.9], pull: 0.16, light: [0.82, 1.04] };
const LOOKS_OF: Record<InfectedKind, { upper: Cloth; legs: Cloth; skin: Skin; blood: [number, number] }> = {
  villager: { upper: ANY, legs: ANY, skin: DEAD, blood: [0, 3] },
  babushka: { upper: ANY, legs: ANY, skin: DEAD, blood: [0, 3] },
  oldman: { upper: ANY, legs: WORN, skin: DEAD, blood: [0, 2] },
  worker: { upper: WORN, legs: WORN, skin: DEAD, blood: [0, 3] },
  conscript: { upper: ISSUED, legs: ISSUED, skin: DEAD, blood: [1, 4] },
  militia: { upper: ISSUED, legs: ISSUED, skin: DEAD, blood: [1, 3] },
  patient: { upper: WORN, legs: WORN, skin: BRUISED, blood: [1, 4] },
  // (a coat is white, whatever is done to the colour of anything else; scrubs are blue, green, teal or plum)
  nurse: { upper: WORN, legs: { turn: 1.3, deep: [0.8, 1.4], light: [0.7, 1.05] }, skin: DEAD, blood: [1, 4] },
  hazmat: { upper: ISSUED, legs: ISSUED, skin: BRUISED, blood: [0, 2] },
  bloated: { upper: FLESH, legs: WORN, skin: BRUISED, blood: [0, 2] },
  starved: { upper: FLESH, legs: WORN, skin: DEAD, blood: [0, 3] },
  burned: { upper: FLESH, legs: ISSUED, skin: { hues: [0, 0.08], pull: 0.1, light: [0.8, 1.05] }, blood: [0, 1] },
};

export interface InfectedLook {
  /** what its kind's bodies that share it are told apart by */
  key: string;
  u: InfectedUniforms;
  /** how many of the first wounds are old blood, laid on by `bleed` the first time a body of it is made */
  blood: number;
  bled: boolean;
  seed: number;
}

const LOOKS = new Map<string, InfectedLook>();
// (the colour turned in YIQ: its lightness and its colour apart, so a hue turned keeps how light the cloth is)
const TO_YIQ = new THREE.Matrix3().set(0.299, 0.587, 0.114, 0.596, -0.274, -0.322, 0.211, -0.523, 0.312);
const FROM_YIQ = TO_YIQ.clone().invert();
const _d = new THREE.Matrix3(), _c = new THREE.Color();
/** what a body's clothes' colour is turned by, `r` three numbers in 0..1 */
function turnOf(to: THREE.Matrix3, c: Cloth, r: () => number) {
  const a = (r() * 2 - 1) * c.turn, deep = c.deep[0] + (c.deep[1] - c.deep[0]) * r(), light = c.light[0] + (c.light[1] - c.light[0]) * r();
  _d.set(light, 0, 0, 0, deep * Math.cos(a), -deep * Math.sin(a), 0, deep * Math.sin(a), deep * Math.cos(a));
  to.copy(FROM_YIQ).multiply(_d).multiply(TO_YIQ);
}
/** what a body's skin is multiplied by, `r` three numbers in 0..1 */
function skinOf(to: THREE.Color, s: Skin, r: () => number) {
  _c.setHSL((s.hues[0] + (s.hues[1] - s.hues[0]) * r()) % 1, 1, 0.5);
  to.setRGB(1, 1, 1).lerp(_c, s.pull * r()).multiplyScalar(s.light[0] + (s.light[1] - s.light[0]) * r());
}

/** the look the `i`th one of a kind has: one of its kind's VARIANTS for its body (see bodyOf), made the first time it is wanted */
export function infectedLook(kind: InfectedKind, i: number): InfectedLook {
  const n = Math.floor(roll(i, 21) * VARIANTS), key = `look${n}`, id = `${bodyOf(kind, i).body}|${key}`;
  let look = LOOKS.get(id);
  if (look) return look;
  const seed = KINDS.indexOf(kind) * 131 + n * 17 + 5;
  let k = 0;
  const r = () => roll(seed, 40 + k++);
  const of = LOOKS_OF[kind], u = infectedUniforms();
  turnOf(u.uUpper.value, of.upper, r);
  turnOf(u.uLower.value, of.legs, r);
  skinOf(u.uSkin.value, of.skin, r);
  // grime: where it lies on the body and how thick
  u.uGrime.value.set(r() * 50, r() * 50, r() * 50, 0.1 + r() * 0.5);
  const blood = Math.min(MAX_WOUNDS - 2, of.blood[0] + Math.floor(r() * (of.blood[1] - of.blood[0] + 1)));
  look = { key, u, blood, bled: false, seed };
  LOOKS.set(id, look);
  return look;
}

/**
 * Old blood laid on a look, once, at points of the clothes of the first body made in it (`geometry`, as it rests):
 * stains a hand to a forearm across, where it was bitten and bled down itself. (The infected's bodies are in their mesh's
 * own measure, a metre a metre near enough: see Avatar.wound.)
 */
export function bleed(look: InfectedLook, geometry: THREE.BufferGeometry) {
  if (look.bled) return;
  look.bled = true;
  const pos = geometry.getAttribute('position'), tone = geometry.getAttribute('_tone');
  if (!pos || !look.blood) return;
  let k = 0;
  const r = () => roll(look.seed, 80 + k++);
  for (let w = 0, tries = 0; w < look.blood && tries < 200; tries++) {
    const v = Math.floor(r() * pos.count);
    // (on the clothes, not the face or the hands: those take their blood from what is done to them)
    if (tone && tone.getZ(v) > 0.5) continue;
    look.u.uWounds.value[w++].set(pos.getX(v), pos.getY(v), pos.getZ(v), 0.05 + r() * 0.09);
  }
}

/** a body's own size against its kind's: [across, up], up within six in a hundred, across within five */
export function sizeOf(kind: InfectedKind, i: number): [number, number] {
  const up = bodyOf(kind, i).height * (0.94 + roll(i, 22) * 0.12);
  return [up * (0.95 + roll(i, 23) * 0.1), up];
}
