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
export const VARIANTS = 16;

/** How far the clothes' colour may be turned: its hue round the wheel by up to `turn` radians either way, its depth of colour by `deep`, its lightness by `light`. */
interface Cloth {
  turn: number;
  deep: [number, number];
  light: [number, number];
}
/** How far the skin may go: pulled toward one of its `casts` (hues, 0..1 round the wheel) by between `pull`'s two, and how light. */
interface Skin {
  casts: number[];
  pull: [number, number];
  light: [number, number];
}
/** what anybody might have been wearing that day (turned from what it is by up to a sixth of the wheel: browns go red or olive, never violet) */
const ANY: Cloth = { turn: 1.1, deep: [0.5, 1.35], light: [0.82, 1.18] };
const WORN: Cloth = { turn: 0.6, deep: [0.45, 1.15], light: [0.82, 1.12] };
/** a uniform is a uniform: only how worn and faded it is */
const ISSUED: Cloth = { turn: 0.12, deep: [0.55, 1.1], light: [0.78, 1.08] };
/** the rare three's are mostly their skin */
const FLESH: Cloth = { turn: 0.15, deep: [0.7, 1.15], light: [0.85, 1.05] };
/**
 * The dead's skin, one cast of several: sallow, jaundiced, grey-green, ashen blue, livid; never alive. Each far enough
 * from the next that two of one body side by side are two people at two metres (the navigator, 2026-10-25: two nurses
 * "are clones"; and again, "faces are still one woman three times").
 */
const DEAD: Skin = { casts: [0.06, 0.14, 0.3, 0.56, 0.8], pull: [0.25, 0.55], light: [0.62, 1.04] };
const BRUISED: Skin = { casts: [0.7, 0.8, 0.9, 0.56], pull: [0.25, 0.5], light: [0.64, 1.02] };
/** what hair the dead have, dulled: near black, dark brown, brown, auburn, dirty blonde, grey */
const HAIR: [number, number, number][] = [[0.17, 0.14, 0.12], [0.33, 0.24, 0.17], [0.48, 0.35, 0.22], [0.55, 0.28, 0.16], [0.7, 0.58, 0.38], [0.58, 0.57, 0.55]];
const GREYS: [number, number, number][] = [[0.58, 0.57, 0.55], [0.76, 0.75, 0.72], [0.66, 0.64, 0.6]];
/** what is dark on these heads is a helmet, a peaked cap, a hood or what the fire left: not hair */
const NO_HAIR = new Set(['conscript', 'conscript2', 'militia', 'hazmat', 'burned']);
/** a mask, or what the fire left: no mouth to be dark with feeding */
const NO_FACE = new Set(['hazmat', 'burned']);
/** the grime: mud, soot, or old dried muck */
const GRIME: [number, number, number][] = [[0.52, 0.44, 0.34], [0.42, 0.41, 0.4], [0.48, 0.38, 0.31]];
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
  burned: { upper: FLESH, legs: ISSUED, skin: { casts: [0, 0.04, 0.08], pull: [0.03, 0.12], light: [0.8, 1.05] }, blood: [0, 1] },
};

export interface InfectedLook {
  /** what its kind's bodies that share it are told apart by */
  key: string;
  u: InfectedUniforms;
  /** how many of the first wounds are old blood, laid on by `bleed` the first time a body of it is made */
  blood: number;
  bled: boolean;
  seed: number;
  /** it has fed: blood at the mouth, laid by `bleed` */
  fed: boolean;
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
  _c.setHSL(s.casts[Math.floor(r() * s.casts.length)], 1, 0.5);
  to.setRGB(1, 1, 1).lerp(_c, s.pull[0] + (s.pull[1] - s.pull[0]) * r()).multiplyScalar(s.light[0] + (s.light[1] - s.light[0]) * r());
}

/** the look the `i`th one of a kind has: one of its kind's VARIANTS for its body (see bodyOf), made the first time it is wanted */
export function infectedLook(kind: InfectedKind, i: number): InfectedLook {
  const n = Math.floor(roll(i, 21) * VARIANTS), key = `look${n}`, id = `${bodyOf(kind, i).body}|${key}`;
  let look = LOOKS.get(id);
  if (look) return look;
  const seed = KINDS.indexOf(kind) * 131 + n * 17 + 5;
  let k = 0;
  const r = () => roll(seed, 40 + k++);
  const of = LOOKS_OF[kind], u = infectedUniforms(), body = bodyOf(kind, i).body;
  turnOf(u.uUpper.value, of.upper, r);
  turnOf(u.uLower.value, of.legs, r);
  skinOf(u.uSkin.value, of.skin, r);
  u.uMottle.value = 0.15 + r() * 0.75;
  // grime: where it lies on the body, how thick, and what it is
  u.uGrime.value.set(r() * 50, r() * 50, r() * 50, 0.2 + r() * 0.65);
  u.uGrimeTint.value.setRGB(...GRIME[Math.floor(r() * GRIME.length)]);
  // (the old go grey)
  const hairs = kind === 'babushka' || kind === 'oldman' ? GREYS : HAIR;
  if (!NO_HAIR.has(body)) u.uHair.value.set(...hairs[Math.floor(r() * hairs.length)], 0.9);
  const blood = Math.min(MAX_WOUNDS - 3, of.blood[0] + Math.floor(r() * (of.blood[1] - of.blood[0] + 1)));
  // (and half of them have fed: the mouth and chin dark with it; not behind a mask, nor what the fire left)
  look = { key, u, blood, bled: false, seed, fed: !NO_FACE.has(body) && r() < 0.5 };
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
  if (!pos) return;
  // (where the hair begins: a hand below the top of the head, the brow; the hair at the back comes down to it as well)
  let top = -Infinity;
  if (tone) {
    for (let v = 0; v < pos.count; v++) if (tone.getZ(v) > 0.5 && pos.getY(v) > top) top = pos.getY(v);
    if (top > -Infinity) look.u.uHairFrom.value = top - 0.13;
  }
  let k = 0;
  const r = () => roll(look.seed, 80 + k++);
  let w = 0;
  for (let tries = 0; w < look.blood && tries < 200; tries++) {
    const v = Math.floor(r() * pos.count);
    // (on the clothes, not the face or the hands: those take their blood from what is done to them)
    if (tone && tone.getZ(v) > 0.5) continue;
    look.u.uWounds.value[w++].set(pos.getX(v), pos.getY(v), pos.getZ(v), 0.05 + r() * 0.09);
  }
  look.blood = w;
  if (!look.fed || !tone || top === -Infinity) return;
  // The mouth: the foremost of the skin a hand and a half to two hands under the top of the head. Which way is the
  // front is told by the feet, whose toes stand out ahead of the body more than the heels do behind it.
  let low = Infinity, all = 0, feet = 0, nFeet = 0;
  for (let v = 0; v < pos.count; v++) low = Math.min(low, pos.getY(v));
  for (let v = 0; v < pos.count; v++) {
    all += pos.getZ(v);
    if (pos.getY(v) < low + 0.04) (feet += pos.getZ(v)), nFeet++;
  }
  const ahead = nFeet && feet / nFeet > all / pos.count ? 1 : -1;
  let mouth = -1;
  for (let v = 0; v < pos.count; v++) {
    const y = pos.getY(v);
    if (tone.getZ(v) < 0.5 || y > top - 0.16 || y < top - 0.25) continue;
    if (mouth < 0 || pos.getZ(v) * ahead > pos.getZ(mouth) * ahead) mouth = v;
  }
  if (mouth < 0) return;
  look.u.uWounds.value[look.blood++].set(pos.getX(mouth), pos.getY(mouth) - 0.01, pos.getZ(mouth), 0.045 + r() * 0.03);
}

/** a body's own size against its kind's: [across, up], up within six in a hundred, across within five */
export function sizeOf(kind: InfectedKind, i: number): [number, number] {
  const up = bodyOf(kind, i).height * (0.94 + roll(i, 22) * 0.12);
  return [up * (0.95 + roll(i, 23) * 0.1), up];
}
