// A blast: a grenade, a drum of fuel, a car going up.
//
// It was one heap of round blobs, all thrown in the same frame: twenty to fifty lights added one over another
// (which this game's picture is finished into cream, whatever colour they are said in), forty dark puffs, and a
// lamp that was on for a tenth of a second and then off. 2026-10-13, of a burning police car: "The explosion puff
// itself should be replaced with particles from the particle pack ... or we can make our own explosion fx".
//
// Now it is made in layers, each on its own clock, and nothing but the flash is there at full strength in the
// frame it comes:
//   the flash      – a glow and a star of rays, there at once and gone in a fourteenth of a second
//   the fireball   – photographs of fire (see FIREBALL), each swelling, rising, boiling and cooling: what is
//                    brightest in a picture burns longest, and the rest of it goes to soot
//   the smoke      – puffs out of Kenney's Particle Pack, dark at their hearts, lit by the fire while there is
//                    one and by the sky after, turning and thinning; for fuel, a black column that stands for seconds
//   the dust       – rolled out along the ground, the colour of that ground, and a ring of it laid flat
//   the thrown ground – "Bomb Crack_Ground_00" by paulyang (CC BY 4.0), an owner's download: 1,381 pieces of
//                    ground thrown up and out and landing, painted as the ground the blast was on (see Thrown)
//   sparks, a spray of clods, embers; the ground left burnt; a light that dies away; a shake that comes with the sound
//
// The flash, fire, smoke, dust and sparks are ONE draw, every card of every blast in it sorted from the furthest
// to the nearest, each laid on as a body that hides what is behind it with its light added over (the way the
// flames of a fire are: src/game/flames.ts, whose colour for fire this uses), soft where it meets its floor,
// thinned by the air and the gas between it and the eye, and let go as the eye comes into it. The thrown ground
// is one more draw, however many blasts are throwing it; the burnt ground one more.
//
// Far off, or with two blasts already going, a blast is made of fewer things (see `tier`). In a room, it is kept
// in the room (see `room`).

import * as THREE from 'three';
import { assets } from '../core/assets';
import { TOUCH } from '../core/device';
import { physics, SOLID_GROUPS } from '../core/physics';
import type { Atmosphere } from '../world/atmosphere';
import { ART as FLAMES_ART, LOOK as FLAME, ripple, type Fire, type Flames } from './flames';

/**
 * THE FIREBALL'S PICTURES: the one place that says where they come from and how many there are.
 *
 * As it stands they are stills: five of the photographs that came with the campfire (the same sheet the flames of
 * a fire are drawn from, so nothing more is fetched or held), each ball of a blast one of them for its whole life,
 * pushed about from inside so that it boils.
 *
 * To put a FILMED explosion in their place (a flipbook: its frames set out in a grid, read left to right and top
 * to bottom), change this and nothing else:
 *   sheet  – the picture's address
 *   film   – { cols, rows, frames }: every ball then plays the film once over its life, each frame melted into
 *            the next (the shader is handed both and how far between them it is)
 *   many   – a film is a whole explosion to a card where a still is one lick of it: 0.3 of the cards is plenty
 * `stills` is then not read. The colour is made the same way for either (from how hot each point of the picture
 * is: see the shader), so a film need only be bright where it burns and clear where it does not.
 */
export const FIREBALL = {
  sheet: FLAMES_ART.sheet,
  /** stills: where on the sheet each is, as pixels of a sheet `size` a side: left, top, right, bottom */
  size: 1024,
  stills: [
    [784, 123, 1009, 321], // a ball of fire rolling up on its stalk: most of every fireball is this
    [787, 536, 1012, 800], // a round ball of it
    [137, 158, 540, 525], // a hot yellow heart
    [786, 330, 1010, 528], // a net of thin flame: what a ball leaves as it goes
    [550, 328, 775, 526], // red rags of flame: the same
  ] as [number, number, number, number][],
  film: null as null | { cols: number; rows: number; frames: number },
  many: 1,
};

/** the sheet of puffs, clods, streaks and rings: which tile is which (scripts/blast.mjs sets them out in this order, and blast.json says so again) */
const TILES = ['smoke_04', 'smoke_05', 'smoke_06', 'smoke_07', 'smoke_08', 'smoke_02', 'dirt_01', 'dirt_02', 'dirt_03', 'trace_01', 'fire_01', 'scorch_03', 'scorch_01', 'smoke_10', 'circle_05', 'circle_01'];
const T = { puffs: [0, 1, 2, 3, 4, 5], clods: [6, 7, 8], streak: 9, embers: 10, burn: 11, rays: 12, ring: 13, dot: 14, hoop: 15 };
const ART = { sheet: 'assets/fx/blast.webp', figures: 'assets/fx/blast.json', thrown: 'assets/fx/burst.bin' };
type Rect = [number, number, number, number];
const tile = (i: number): Rect => [(i % 4) / 4, Math.floor(i / 4) / 4, ((i % 4) + 1) / 4, (Math.floor(i / 4) + 1) / 4];

export type BlastKind = 'grenade' | 'frag' | 'drum' | 'vehicle';
/** what a blast can be standing on, as far as what it throws and what dust it raises go */
export type Ground = 'grass' | 'dirt' | 'rock' | 'gravel' | 'asphalt' | 'concrete' | 'snow' | 'wood' | 'metal' | 'other';

/** cards drawn at once, of all blasts together (a car going up is about a hundred) */
const MOST = 400;
/** blasts throwing ground at once */
const THROWS = 4;
/** burnt patches kept on the ground: the oldest goes when there are more (six to a blast); and each fades out after its
 * time, as blood does (MARK_LIFE, src/game/effects.ts: "explosive black powder residue left behind needs to be cleaned up") */
const BURNS = 60;
const BURN_LIFE = 120, BURN_FADE = 30;
/** the wind smoke leans with, metres a second (the same that a fire's smoke leans with: src/game/effects.ts) */
const WIND = { x: 0.45, z: 0.28 };

/**
 * How much of a blast is made, by how far off it is: all of it within `full` metres; out to `some`, half the
 * cards, no sparks or spray and a third of the thrown ground (and the same for a third blast while two are going,
 * however near); beyond, the flash, a few balls of fire and its smoke; past `none`, nothing (the air has it).
 */
const TIER = { full: 70, some: 220, none: 900, thrownTo: 95, atOnce: 2 };

/**
 * What each kind of blast is. Lengths are metres and are HALF the width of a card unless said; times are seconds.
 *   flash   – half the width of the glow as it comes and as it goes
 *   fire    – n balls of fire, each from r[0] to r[1], living life[0] to life[1]; thrown `out` and `rise` (m/s),
 *             lifted by `lift` (m/s²); born over the first `over` seconds; `heat` at birth (1 is a flame; over 1, whiter)
 *   smoke   – n puffs, r, life, thrown `out` and `up` (m/s), `lift`; how dark at first and how pale as they thin
 *             (0 black, 1 white); `lit`: how much of the fire's light is on them, dying over `litFor`; born `over`
 *   column  – for fuel: n more puffs fed in over `over` seconds from over the fire, climbing at `up` m/s for `life`
 *   dust    – n puffs rolled out along the ground to `reach`
 *   ring, shock – how far out the ring of dust rolls, and the thin quick ring: [how far, how long]
 *   spray, embers – cards of clods, and of embers; sparks: n, how fast, how long
 *   thrown  – the ground it throws: `size` of the download's own (which throws 4 m up and 2.5 to 8 m out)
 *   burn    – how wide the ground is left burnt (the whole width)
 *   light   – the lamp: `flash` strong at the first, gone in `fast`; then `ball` strong while the fireball lasts (`ballFor`)
 *   shake   – how hard the view is shaken, at the blast itself
 *   flames  – for fuel: little fires left burning on the ground for a few seconds
 */
const KIND = {
  // (a frag's and a 40 mm round's: their fire half again as big and twice as long, lit while it lasts. At a fifth of a
  // second it was gone before it was seen: the owner, 2026-10-19, "m32 explosion and maybe grenades are missing the fire")
  grenade: {
    flash: [1.5, 2.5],
    fire: { n: 11, r: [0.45, 1.9], life: [0.45, 0.75], out: 5, rise: 3, lift: 1, over: 0.08, heat: 1.7 },
    smoke: { n: 9, r: [0.55, 2.7], life: [3.0, 4.4], out: 3.2, up: [3.5, 7.5], lift: 0.9, dark: 0.11, pale: 0.21, lit: 0.28, litFor: 0.14, over: [0.03, 0.15] },
    column: null as null | { n: number; r: number[]; life: number[]; up: number; over: number[]; from: number },
    dust: { n: 10, reach: 5, r: [0.45, 1.5], life: [1.5, 2.5] },
    ring: 4.2, shock: [4, 0.13],
    spray: 3, embers: 2, sparks: { n: 14, speed: [11, 26], life: [0.22, 0.6] },
    thrown: 0.7, burn: 2.0,
    light: { flash: 260, fast: 0.2, ball: 70, ballFor: 0.5, reach: 30, color: [1, 0.72, 0.4] },
    shake: 0.02, flames: 0,
  },
  // (the frag: the grenade's twice over, every length doubled and more of everything to fill it, as its blast reaches
  // twice as far: the owner, 2026-10-19, "regular grenades t4-5 and do 2x damage and 2x blast radius and 2x explosion size")
  frag: {
    flash: [3.0, 5.0],
    fire: { n: 18, r: [0.9, 3.8], life: [0.55, 0.9], out: 10, rise: 6, lift: 2, over: 0.1, heat: 1.7 },
    smoke: { n: 14, r: [1.1, 5.4], life: [3.6, 5.2], out: 6.4, up: [5, 11], lift: 1.6, dark: 0.11, pale: 0.21, lit: 0.32, litFor: 0.2, over: [0.03, 0.2] },
    column: null as null | { n: number; r: number[]; life: number[]; up: number; over: number[]; from: number },
    dust: { n: 16, reach: 10, r: [0.9, 3.0], life: [1.8, 3.0] },
    ring: 8.4, shock: [8, 0.16],
    spray: 5, embers: 3, sparks: { n: 22, speed: [16, 36], life: [0.3, 0.8] },
    thrown: 1.4, burn: 4.0,
    light: { flash: 420, fast: 0.24, ball: 110, ballFor: 0.7, reach: 60, color: [1, 0.72, 0.4] },
    shake: 0.035, flames: 0,
  },
  drum: {
    flash: [2.0, 3.4],
    fire: { n: 14, r: [0.55, 2.2], life: [0.75, 1.3], out: 3.4, rise: 3.6, lift: 2.2, over: 0.22, heat: 1.6 },
    smoke: { n: 12, r: [0.8, 3.4], life: [3.2, 5.2], out: 2.8, up: [3.2, 6.2], lift: 1.5, dark: 0.022, pale: 0.09, lit: 0.45, litFor: 0.36, over: [0.1, 0.6] },
    column: { n: 12, r: [1.0, 3.9], life: [6.5, 9], up: 2.4, over: [0.5, 3.2], from: 2.2 },
    dust: { n: 12, reach: 6.5, r: [0.5, 1.8], life: [1.6, 2.8] },
    ring: 6, shock: [6, 0.16],
    spray: 4, embers: 3, sparks: { n: 18, speed: [10, 24], life: [0.3, 0.8] },
    thrown: 1.0, burn: 3.2,
    light: { flash: 420, fast: 0.25, ball: 110, ballFor: 1.4, reach: 42, color: [1, 0.62, 0.3] },
    shake: 0.03, flames: 3,
  },
  vehicle: {
    flash: [2.4, 4.0],
    fire: { n: 18, r: [0.7, 2.7], life: [0.85, 1.45], out: 4.0, rise: 4.0, lift: 2.4, over: 0.28, heat: 1.6 },
    smoke: { n: 14, r: [0.9, 3.9], life: [3.6, 5.6], out: 3.2, up: [3.4, 6.6], lift: 1.6, dark: 0.018, pale: 0.08, lit: 0.5, litFor: 0.4, over: [0.1, 0.7] },
    column: { n: 14, r: [1.1, 4.4], life: [7, 10], up: 2.5, over: [0.6, 3.6], from: 2.6 },
    dust: { n: 12, reach: 7.5, r: [0.55, 2.0], life: [1.7, 3.0] },
    ring: 7, shock: [7, 0.18],
    spray: 4, embers: 4, sparks: { n: 26, speed: [10, 28], life: [0.35, 1.0] },
    thrown: 1.1, burn: 4.2,
    light: { flash: 520, fast: 0.28, ball: 140, ballFor: 1.6, reach: 48, color: [1, 0.6, 0.28] },
    shake: 0.036, flames: 0,
  },
};

/**
 * A drum's blast and a car's are drawn so much bigger than the figures above (2026-10-13: "exploding barrels should
 * have larger explosion SFX ... Cars should also have larger explosion SFX size (maybe 15% for each)"): everything
 * that is a size or a reach, and how fast it throws itself out, so that it is the same blast, larger.
 */
const BIGGER = 1.15;
for (const k of [KIND.drum, KIND.vehicle]) {
  const by = (a: number[]) => a.forEach((v, i) => (a[i] = v * BIGGER));
  by(k.flash);
  by(k.fire.r);
  k.fire.out *= BIGGER; k.fire.rise *= BIGGER; k.fire.lift *= BIGGER;
  by(k.smoke.r); by(k.smoke.up);
  k.smoke.out *= BIGGER; k.smoke.lift *= BIGGER;
  if (k.column) { by(k.column.r); k.column.up *= BIGGER; k.column.from *= BIGGER; }
  k.dust.reach *= BIGGER; by(k.dust.r);
  k.ring *= BIGGER; k.shock[0] *= BIGGER;
  k.thrown *= BIGGER; k.burn *= BIGGER;
  k.light.reach *= BIGGER;
}

/** the dust a blast raises off each kind of ground, and what its spray of clods is the colour of (as light sent back: 1 is white) */
const DUST: Record<Ground, [number, number]> = {
  grass: [0x6f6448, 0x2a2318], dirt: [0x6a5a44, 0x2a2016], rock: [0x8d877c, 0x4a4640], gravel: [0x8a8070, 0x46413a], asphalt: [0x5a5856, 0x1c1b1a],
  concrete: [0xa09a90, 0x56524c], snow: [0xcfd5dc, 0xb8bec6], wood: [0x8a6a48, 0x3a2a1a], metal: [0x707070, 0x1a1a1a], other: [0x777060, 0x2c2a26],
};

/**
 * What the thrown ground is painted with: pictures the game has already, by their names in the manifest, a
 * layer each (the last is plain white, for snow). The first four are the ground's own four, with the tints the
 * ground gives them (src/world/terrain.ts): a clod thrown out of the grass is that grass.
 */
const PAINTS = ['leafy_grass', 'brown_mud_leaves_01', 'aerial_rocks_02', 'rocks_ground_02', 'asphalt_02', 'concrete_floor_worn_001', 'rusty_corrugated_iron'];
const PAINT_PX = 512;
/** for each ground: the layer and tint of the top of a piece, the layer and tint of what was under it, and how many metres a picture is laid over */
const THROWN: Partial<Record<Ground, { top: number; tint: number[]; side: number; under: number[]; lay: number }>> = {
  grass: { top: 0, tint: [0.74, 0.97, 0.53], side: 1, under: [0.5, 0.44, 0.36], lay: 1.6 },
  dirt: { top: 1, tint: [0.85, 0.93, 0.73], side: 1, under: [0.5, 0.44, 0.36], lay: 1.5 },
  rock: { top: 2, tint: [0.9, 0.98, 0.8], side: 3, under: [0.7, 0.69, 0.66], lay: 3.0 },
  gravel: { top: 3, tint: [0.82, 0.85, 0.69], side: 3, under: [0.6, 0.58, 0.54], lay: 1.3 },
  asphalt: { top: 4, tint: [1, 1, 1], side: 3, under: [0.55, 0.53, 0.5], lay: 2.0 },
  concrete: { top: 5, tint: [1, 1, 1], side: 3, under: [0.75, 0.74, 0.72], lay: 2.0 },
  snow: { top: 7, tint: [0.8, 0.83, 0.88], side: 7, under: [0.62, 0.65, 0.7], lay: 2.0 },
  // (a car throws itself: plate and panel, burnt black)
  metal: { top: 6, tint: [0.1, 0.085, 0.075], side: 6, under: [0.05, 0.045, 0.04], lay: 1.2 },
};
/** the thrown ground: seconds it lies where it fell, seconds it then takes to sink into the ground, and how far it sinks (of the size it is thrown at) */
const LIES = { for: 4, sinks: 2.5, by: 0.3 };
/**
 * Where the thrown ground comes down. The download lands every piece on one level floor; the game's ground is
 * not one. Round each blast the ground is looked for at `n` by `n` places, out to `out` of the furthest the pieces
 * go, and how far each stands over or under the blast's own slope is kept: a piece comes down by as much as the
 * ground does where it is bound for (read between the four places nearest).
 */
const LAND = { n: 9, out: 0.75 };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <X>(a: X[]) => a[Math.floor(Math.random() * a.length)];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _DOWN = { x: 0, y: -1, z: 0 };

/** one card of a blast */
interface Card {
  live: boolean;
  of: Blast | null;
  /** seconds yet before it is there at all; how long it has been; how long it lasts */
  wait: number;
  age: number;
  life: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  /** how fast it is slowed; how fast it falls (less than nothing: it rises); how much of the wind it takes */
  drag: number;
  fall: number;
  wind: number;
  /** half its width as it comes and as it goes, how soon it is nearly as big as it gets (1 evenly; 3 at once, then slowly), and its height over its width */
  r0: number;
  r1: number;
  swell: number;
  tall: number;
  turn: number;
  spin: number;
  /** 0 faces the eye; 1 a streak along the way it flies (`long`: seconds of its flight it is as long as); 2 lies flat on ground that faces `n` */
  lies: 0 | 1 | 2;
  long: number;
  n: THREE.Vector3;
  rect: Rect;
  /** it is one of the fireball's pictures (and which, where they are stills) */
  fire: boolean;
  /** its colour as it comes and as it goes, how much of it there is at its most, the seconds it comes in over, and the share of its life from which it goes */
  c0: number[];
  c1: number[];
  a: number;
  in: number;
  out: number;
  /** how much of it is light and not body (a spark is all light) */
  glow: number;
  /** how thick its picture is read (1 as it is; more, and its thin parts are solid: a clod) and how dark its heart is against its edge */
  thick: number;
  heart: number;
  /** fire: its heat as it comes and as it goes. Smoke: how much of the fire's light is on it, and the seconds that takes to die */
  h0: number;
  h1: number;
  /** nothing of it is drawn under this height, and it comes in over this much above it */
  floor: number;
  soft: number;
  own: number;
  /** how far from the eye it is, squared: what the cards are put in order by */
  far: number;
}

interface Blast {
  kind: BlastKind;
  /** where it went off, the ground under it (if any is near), and the way that ground faces */
  at: THREE.Vector3;
  foot: THREE.Vector3;
  up: THREE.Vector3;
  grounded: boolean;
  ground: Ground;
  age: number;
  tier: 0 | 1 | 2;
  /**
   * What stands round it: each wall near it as a place on the wall and the way the wall faces (toward the blast).
   * Nothing of the blast is let through one. `roofed`: there is a roof over it, at `top`. `room`: the most a card
   * of it may be, half its width: half the narrowest way between two walls, or half the height of the room.
   */
  walls: { q: THREE.Vector3; n: THREE.Vector3 }[];
  roofed: boolean;
  top: number;
  room: number;
  /** seconds until its sound reaches the eye, and the view is shaken */
  heard: number;
  shake: number;
  /** the little fires it left: each with when it catches, burns and dies */
  fires: { fire: Fire; from: number; to: number; most: number }[];
  /** which of the throws is its (-1: none) */
  throw: number;
  /** when nothing of it is left */
  over: number;
}

/**
 * The fog and the gas, as the game's own lit things take them, for something that reckons them at its corners
 * and not at every point: the same lines (src/world/atmosphere.ts writes them into three.js for everything
 * else), with the one thing in them that only a point of the picture knows taken out.
 */
export function airGlsl(): string {
  // (nor the camera's matrix, which the fog's lines ask for in a picture's points and three.js gives every vertex
  // shader already: asked twice, no smoke, dust, spark or flame was drawn from 2026-10-18 on, each a shader that
  // would not build, and every shot that raised dust drew with one (found 2026-10-19 hunting a lost picture))
  return THREE.ShaderChunk.fog_pars_fragment.replace('varying vec3 vFogWorldPos;', '').replace('uniform mat4 projectionMatrix;', '').replace(/gl_FragCoord/g, 'vec4( 0.5 )');
}
/** `vAir`: what the air adds (rgb) and how much of the thing is left (a), reckoned at `world` */
export const AIR_AT = /* glsl */ `
  #ifdef USE_FOG
  {
    vec3 airRay = world - cameraPosition;
    float airFar = length( airRay );
    vec3 airDir = airRay / max( airFar, 1e-4 );
    float lost = atmoFogAmount( cameraPosition, airDir, airFar );
    vAir = vec4( atmoFogColor( airDir ) * lost, 1.0 - lost );
    #ifdef GAS_ZONE
      vec3 gasIs = gasAmount( cameraPosition, airDir, airFar );
      vAir = vec4( vAir.rgb * ( 1.0 - gasIs.x ) + gasColor( airDir, gasIs.y, gasIs.z ) * gasIs.x, vAir.a * ( 1.0 - gasIs.x ) );
    #endif
  }
  #else
    vAir = vec4( 0.0, 0.0, 0.0, 1.0 );
  #endif`;

const CARD_VERT = () => /* glsl */ `
  attribute vec3 iMid;
  attribute vec4 iShape;
  attribute vec4 iAxis;
  attribute vec4 iRect;
  attribute vec4 iRect2;
  attribute vec4 iTint;
  attribute vec4 iKind;
  attribute vec4 iMore;
  uniform vec3 uSun;
  varying vec2 vOn;
  varying vec4 vRect;
  varying vec4 vRect2;
  varying vec4 vTint;
  varying vec4 vKind;
  varying vec4 vMore;
  varying vec2 vHalf;
  varying vec4 vAir;
  // x: how far over its floor this point is; y: how lit by the sky and the sun; z: 1 where the picture is pushed about from inside
  varying vec3 vAt;
  ${airGlsl()}
  void main() {
    vec3 toEye = cameraPosition - iMid;
    float far = length( toEye );
    vec3 eye = toEye / max( far, 1e-4 );
    vec3 right, up;
    float near = 1.0, rolls = 0.0;
    if ( iAxis.w < 0.5 ) {
      // facing the eye, turned about the line to it
      vec3 ref = abs( eye.y ) > 0.98 ? vec3( 1.0, 0.0, 0.0 ) : vec3( 0.0, 1.0, 0.0 );
      vec3 r0 = normalize( cross( ref, eye ) ), u0 = cross( eye, r0 );
      float c = cos( iShape.z ), s = sin( iShape.z );
      right = ( r0 * c + u0 * s ) * iShape.x;
      up = ( u0 * c - r0 * s ) * iShape.y;
      // (as the eye comes into it, it is let go: a card that fills the whole picture is a wall, and is paid for point by point)
      float big = max( iShape.x, iShape.y );
      near = smoothstep( 0.3 * big, 0.3 * big + max( 0.7, 0.6 * big ), far );
      rolls = 1.0;
    } else if ( iAxis.w < 1.5 ) {
      // a streak: as long as it is said, and turned about its own length to face the eye
      up = iAxis.xyz;
      right = normalize( cross( up, eye ) + vec3( 1e-5, 0.0, 0.0 ) ) * iShape.x;
      near = smoothstep( 0.2, 0.9, far );
    } else {
      // laid on ground that faces iAxis
      vec3 n = iAxis.xyz;
      vec3 t = normalize( cross( n, vec3( 0.0, 0.0, 1.0 ) ) ), b = cross( t, n );
      float c = cos( iShape.z ), s = sin( iShape.z );
      right = ( t * c + b * s ) * iShape.x;
      up = ( b * c - t * s ) * iShape.y;
    }
    vec3 off = right * position.x + up * position.y;
    vec3 world = iMid + off;
    vec3 way = off / max( length( off ), 1e-4 );
    vOn = position.xy;
    vRect = iRect;
    vRect2 = iRect2;
    vTint = vec4( iTint.rgb, iTint.a * near );
    vKind = iKind;
    vMore = iMore;
    vHalf = vec2( length( right ), length( up ) );
    // (lit from above and from the sun's side: what makes a flat puff a round one)
    vAt = vec3( world.y - iShape.w, iAxis.w > 1.5 ? 1.0 : 0.8 + 0.22 * way.y + 0.3 * max( dot( way, uSun ), 0.0 ), rolls );
    ${AIR_AT}
    gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
  }`;

const CARD_FRAG = /* glsl */ `
  uniform sampler2D tSheet;
  uniform sampler2D tFire;
  uniform sampler2D tRipple;
  uniform float uTime;
  uniform float uDaylight;
  varying vec2 vOn;
  varying vec4 vRect;
  varying vec4 vRect2;
  varying vec4 vTint;
  varying vec4 vKind;
  varying vec4 vMore;
  varying vec2 vHalf;
  varying vec4 vAir;
  varying vec3 vAt;
  void main() {
    float fade = vTint.a;
    if ( vMore.w > 0.0 ) fade *= smoothstep( 0.0, vMore.w, vAt.x );
    if ( fade < 0.003 ) discard;
    vec2 on = vOn * 0.5 + 0.5;
    float fire = step( 0.5, vKind.x ), own = vKind.w;
    // A picture is a still. What moves in it is where each point of the card reads it from: pushed about by a
    // pattern that runs through it (fast through fire, which boils; slowly through smoke, which rolls), fixed
    // in metres, so that a card that swells shows more of the pattern and is not the same picture stretched.
    vec2 at = vOn * vHalf;
    float runs = uTime * mix( 0.42, 2.3, fire );
    vec2 a = texture2D( tRipple, at * 0.5 + vec2( own * 3.7, own * 5.3 - runs * 0.5 ) ).rg - 0.5;
    vec2 b = texture2D( tRipple, at * 1.5 + vec2( own * 9.1 + runs * 0.3, own * 2.9 - runs * 0.9 ) ).gr - 0.5;
    vec2 push = ( a * 0.2 + b * 0.08 ) * min( 0.5 + 0.35 * max( vHalf.x, vHalf.y ), 1.3 ) * vAt.z * mix( 0.8, 1.0, fire );
    vec2 from = on + push / ( 2.0 * max( vHalf, vec2( 0.01 ) ) );
    float edge = smoothstep( 0.0, 0.08, from.x ) * smoothstep( 0.0, 0.08, 1.0 - from.x ) * smoothstep( 0.0, 0.08, from.y ) * smoothstep( 0.0, 0.08, 1.0 - from.y );
    edge = mix( 1.0, edge, vAt.z );
    vec2 q = clamp( from, 0.0, 1.0 );
    vec3 body, light = vec3( 0.0 );
    float alpha, covers;
    if ( fire > 0.5 ) {
      vec4 t = texture2D( tFire, vec2( mix( vRect.x, vRect.z, q.x ), mix( vRect.w, vRect.y, q.y ) ) );
      if ( vMore.x > 0.002 ) t = mix( t, texture2D( tFire, vec2( mix( vRect2.x, vRect2.z, q.x ), mix( vRect2.w, vRect2.y, q.y ) ) ), vMore.x );
      // What the photograph gives is how HOT each point is and how yellow; the colour is made from those two for
      // the curve this game's picture is finished by (src/game/flames.ts: LOOK). A ball of fire cools: vKind.z is
      // its heat, over 1 at the first (whiter than a flame), 1 a flame, and falling: as it falls only what is
      // brightest in the picture still burns, and the rest of it is soot with a dull red in it.
      float hot = max( t.r, max( t.g, t.b ) );
      float thin = smoothstep( 0.02, 0.5, hot );
      float heat = smoothstep( 0.03, 0.75, dot( t.rgb, vec3( 0.3, 0.6, 0.1 ) ) );
      // (A photograph a hand wide, drawn as a ball of fire five metres across, is smooth where fire is not: a
      // finer run of the same pattern, fixed in metres as the push is, breaks its heat up into the small
      // dark and bright of a thing that is boiling.)
      float grain = texture2D( tRipple, at * 2.9 + vec2( own * 4.1 + runs * 0.2, own * 7.7 - runs * 1.2 ) ).r;
      heat = clamp( heat * ( 0.66 + 0.68 * grain ), 0.0, 1.0 );
      float warm = min( vKind.z, 1.0 );
      float cold = ( 1.0 - warm ) * 1.3;
      float burns = smoothstep( cold - 0.25, cold + 0.05, heat );
      // (and as it cools what still burns is redder, dimmer and thinner: yellow, then orange, then a dull red)
      float red = mix( ${FLAME.red[0].toFixed(3)}, ${FLAME.red[1].toFixed(3)}, heat ) * max( vKind.z, 1.0 ) * mix( 0.5, 1.0, warm );
      vec3 flame = vec3( red, red * min( t.g / max( t.r, 0.001 ), 0.62 ) * ${FLAME.green.toFixed(3)} * mix( 0.5, 1.0, warm ), red * ${FLAME.blue.toFixed(3)} );
      vec3 soot = vec3( 0.045, 0.036, 0.03 ) * uDaylight + vec3( 0.3, 0.05, -0.02 ) * heat * warm;
      body = mix( soot, flame, burns );
      alpha = t.a * edge * fade * mix( 0.3, 1.0, thin ) * smoothstep( 0.02, 0.24, t.a ) * mix( 0.6, 1.0, max( warm, 1.0 - burns ) );
      light = body * ${FLAME.glow.toFixed(3)} * burns;
      covers = alpha;
    } else {
      float d = texture2D( tSheet, vec2( mix( vRect.x, vRect.z, q.x ), mix( vRect.w, vRect.y, q.y ) ) ).r;
      alpha = clamp( d * vMore.y, 0.0, 1.0 ) * edge * fade;
      float dense = smoothstep( 0.15, 0.85, d );
      // smoke and dust: as bright as the hour, lit from above and from the sun's side, dark at the heart; and
      // while there is a fire in it, lit by that from inside
      body = vTint.rgb * mix( 1.0, vMore.z, dense ) * uDaylight * vAt.y + vec3( 1.0, 0.36, -0.07 ) * vKind.z * ( 0.12 + 0.88 * dense * dense );
      // (what is all light, a spark or the flash, is its own colour whatever the hour, and hides nothing)
      body = mix( body, vTint.rgb, vKind.y );
      covers = alpha * ( 1.0 - vKind.y );
    }
    if ( alpha < 0.003 ) discard;
    // (the air between: a body is lost into it, and a light is only dimmed by it)
    vec3 seen = mix( body * vAir.a + vAir.rgb, body * vAir.a, fire > 0.5 ? 0.0 : vKind.y );
    gl_FragColor = vec4( seen * alpha + light * vAir.a * alpha, covers );
  }`;

/**
 * The thrown ground.
 *
 * The download is 1,416 pieces, each moved by keys of its own. Baked (scripts/blast.mjs), it is one shape, every
 * point of it knowing which piece it is of, and a table: a row a piece, two places a frame (where the piece is
 * and whether it is there yet; how it is turned), thirty frames a second for three seconds, as the download has
 * them. The shader reads the two frames either side of the moment and goes between them: nothing is reckoned for
 * it here but a clock. Each blast that throws is one more copy of the shape in the same draw, with its own
 * place, clock, size, paint and room.
 *
 * It is thrown about the way the ground faces (on a slope it lands on the slope). It is not solid: where a wall
 * stands in its way, the pieces bound that way are drawn in toward the blast so that they come down at the wall's
 * foot and not through it (eight ways round are looked along, and a piece takes what its own way allows); under a
 * roof they are held under it. It lands on the ground as the ground is (see LAND), and when it has lain a few
 * seconds it sinks into it.
 */
const THROWN_PARS = /* glsl */ `
  attribute vec2 aUv;
  attribute vec2 aWho;
  attribute vec4 iAt;
  attribute vec4 iHow;
  attribute vec4 iUp;
  attribute vec4 iPaint;
  attribute vec3 iTop;
  attribute vec3 iSide;
  attribute vec4 iReachA;
  attribute vec4 iReachB;
  uniform sampler2D tMotion;
  uniform sampler2D tThrownLand;
  // x: frames, y: pieces, z: a point of the shape is this many metres at the most (its numbers run to one), w: frames a second
  uniform vec4 uThrown;
  // where a point's place on its picture runs from and to; how far out and how high the download throws
  uniform vec4 uThrownUv;
  varying vec3 vThrownUv;
  varying vec3 vThrownTint;
  vec3 thrownTurn( vec4 q, vec3 v ) { return v + 2.0 * cross( q.xyz, cross( q.xyz, v ) + q.w * v ); }`;
const THROWN_VERT = /* glsl */ `
  vec3 transformed;
  {
    int piece = int( aWho.x + 0.5 );
    float fr = clamp( iAt.w * uThrown.w, 0.0, uThrown.x - 1.001 );
    int f0 = int( floor( fr ) );
    float w = fr - float( f0 );
    vec4 pA = texelFetch( tMotion, ivec2( f0 * 2, piece ), 0 ), qA = texelFetch( tMotion, ivec2( f0 * 2 + 1, piece ), 0 );
    vec4 pB = texelFetch( tMotion, ivec2( f0 * 2 + 2, piece ), 0 ), qB = texelFetch( tMotion, ivec2( f0 * 2 + 3, piece ), 0 );
    vec4 pEnd = texelFetch( tMotion, ivec2( int( uThrown.x - 1.0 ) * 2, piece ), 0 );
    float size = iHow.x;
    // which pieces: the biggest come first in the table, and a blast far off throws only so many of them
    float there = mix( pA.w, pB.w, w ) * step( aWho.x + 0.5, iHow.y * uThrown.y ) * smoothstep( 0.0, 0.07, iAt.w );
    vec3 p = mix( pA.xyz, pB.xyz, w );
    vec3 own = thrownTurn( normalize( mix( qA, qB, w ) ), position * uThrown.z * there );
    // turned about the upright, each blast its own way: no two throw the same heap
    float cy = cos( iUp.w ), sy = sin( iUp.w );
    vec2 lands = vec2( pEnd.x * cy + pEnd.z * sy, -pEnd.x * sy + pEnd.z * cy );
    // how far its own way is open (eight ways round, and between two of them a share of each)
    float sector = ( atan( lands.x, lands.y ) / 6.2831853 + 0.5 ) * 8.0;
    int s0 = int( floor( sector ) ) % 8, s1 = ( s0 + 1 ) % 8;
    float open = mix( s0 < 4 ? iReachA[ s0 ] : iReachB[ s0 - 4 ], s1 < 4 ? iReachA[ s1 ] : iReachB[ s1 - 4 ], fract( sector ) );
    float held = min( 1.0, max( open - 0.15, 0.05 ) / max( length( lands ) * size, 0.01 ) );
    float under = min( 1.0, max( iHow.w - 0.2, 0.05 ) / ( uThrownUv.w * size ) );
    vec3 at = vec3( ( p.x * cy + p.z * sy ) * held, p.y * under, ( -p.x * sy + p.z * cy ) * held ) * size;
    // the ground where it is bound for, over or under the blast's own slope: taken on as it flies
    vec2 g = clamp( lands * held / ( uThrownUv.z * ${LAND.out.toFixed(2)} ) * 0.5 + 0.5, 0.0, 1.0 ) * ${(LAND.n - 1).toFixed(1)};
    ivec2 g0 = min( ivec2( floor( g ) ), ivec2( ${LAND.n - 2} ) );
    vec2 gw = g - vec2( g0 );
    float ground = mix(
      mix( texelFetch( tThrownLand, ivec2( g0.y * ${LAND.n} + g0.x, gl_InstanceID ), 0 ).r, texelFetch( tThrownLand, ivec2( g0.y * ${LAND.n} + g0.x + 1, gl_InstanceID ), 0 ).r, gw.x ),
      mix( texelFetch( tThrownLand, ivec2( ( g0.y + 1 ) * ${LAND.n} + g0.x, gl_InstanceID ), 0 ).r, texelFetch( tThrownLand, ivec2( ( g0.y + 1 ) * ${LAND.n} + g0.x + 1, gl_InstanceID ), 0 ).r, gw.x ), gw.y );
    at.y += ground * smoothstep( 0.0, 0.45, iAt.w / ( uThrown.x / uThrown.w ) );
    own = vec3( own.x * cy + own.z * sy, own.y, -own.x * sy + own.z * cy ) * size;
    at += own;
    at.y -= iHow.z;
    vec3 n = iUp.xyz;
    vec3 t = normalize( cross( n, vec3( 0.0, 0.0, 1.0 ) ) ), b = cross( t, n );
    transformed = iAt.xyz + t * at.x + n * at.y + b * at.z;
    float side = aWho.y;
    vThrownUv = vec3( mix( vec2( uThrownUv.x ), vec2( uThrownUv.y ), aUv ) * mix( iPaint.z, iPaint.w, side ), mix( iPaint.x, iPaint.y, side ) );
    // (no two pieces quite the same shade)
    vThrownTint = mix( iTop, iSide, side ) * ( 0.82 + 0.36 * fract( aWho.x * 0.61803 ) );
  }`;
const THROWN_FRAG = /* glsl */ `
  {
    vec3 paint = texture( tThrownPaint, vThrownUv ).rgb;
    // (held down as the ground holds its own pictures down: src/world/terrain.ts)
    float lum = dot( paint, vec3( 0.299, 0.587, 0.114 ) );
    paint *= ( lum < 0.34 ? lum : 0.34 + ( lum - 0.34 ) * 0.22 ) / max( lum, 1e-4 );
    diffuseColor.rgb *= paint * vThrownTint;
  }`;

export class Blasts {
  /** every card of every blast, in one draw */
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  /** the ground they throw, in one draw */
  readonly thrown: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshStandardMaterial>;
  /** the ground they leave burnt */
  readonly burnt: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  /**
   * The light of whatever blast is brightest just now, for whoever has a lamp to give it (Effects has one, which
   * a shot's flash wants too: the brighter of the two has it). `strength` is nothing when no blast is lit.
   */
  readonly glow = { at: new THREE.Vector3(), color: new THREE.Color(), strength: 0, reach: 30 };
  /**
   * How far the view is thrown off by blasts just now, radians: for whoever holds the camera to add to where it
   * looks, every frame. It comes when the sound does (the blast's distance at 343 m/s), and is over in a third
   * of a second.
   */
  readonly shake = { pitch: 0, yaw: 0, roll: 0 };
  /**
   * What the ground is at a place, for whoever knows (the world does: its roads, its four grounds, its snow).
   * Not told, a blast on open ground throws grass.
   * @param up how much of the way the ground there faces is upward
   */
  groundAt: ((x: number, y: number, z: number, up: number) => Ground) | null = null;
  /**
   * How far what is SEEN of the open ground at a place stands over what stops a body there, metres: the road is a
   * ribbon laid a few centimetres over the ground, and what was put on the ground under it (the burnt patch, the
   * pieces that had come down) lay under the asphalt, out of sight. For whoever knows, as `groundAt` is.
   */
  liftAt: ((x: number, z: number) => number) | null = null;
  private lift(hit: { tag?: { surface: string } } | null, x: number, z: number) {
    return hit?.tag?.surface === 'grass' ? (this.liftAt?.(x, z) ?? 0) : 0;
  }

  private cards: Card[] = [];
  private blasts: Blast[] = [];
  private order: Card[] = [];
  private clock = 0;
  private time = { value: 0 };
  /** seconds since the game began, for the burnt ground (which is there long after the cards' own clock has come round) */
  private since = { value: 0 };
  private attrs: THREE.InstancedBufferAttribute[];
  private mid: Float32Array;
  private shape: Float32Array;
  private axis: Float32Array;
  private rect: Float32Array;
  private rect2: Float32Array;
  private tint: Float32Array;
  private kind: Float32Array;
  private more: Float32Array;
  /** frames yet for which one card of no size, one piece of ground and one burnt patch are drawn: what they are drawn with is put on the graphics card then, and not in the frame of the first blast */
  private warming = 4;
  private sheetHere = false;
  /** the throws: which blast each is of (null: free), and its clock */
  private throws: { of: Blast | null; t: number; size: number; pace: number }[] = [];
  private throwAttrs: Record<string, THREE.InstancedBufferAttribute> = {};
  private thrownHere = false;
  private figures: { frames: number; pieces: number; big: number; fps: number; uv: number[]; out: number; up: number; seconds: number } | null = null;
  /** how the ground stands round each throw: a row a throw (see LAND) */
  private land = new THREE.DataTexture(new Float32Array(LAND.n * LAND.n * THROWS), LAND.n * LAND.n, THROWS, THREE.RedFormat, THREE.FloatType);
  private thrownU = { tMotion: { value: null as THREE.Texture | null }, tThrownLand: { value: null as THREE.Texture | null }, tThrownPaint: { value: null as THREE.Texture | null }, uThrown: { value: new THREE.Vector4(2, 1, 0, 30) }, uThrownUv: { value: new THREE.Vector4(0, 1, 8, 4.2) } };
  private burns = 0;
  private burnMark: THREE.InstancedBufferAttribute;
  private fetched = false;

  constructor(scene: THREE.Scene, atmo: Atmosphere, private flames: Flames) {
    for (let i = 0; i < MOST; i++) {
      this.cards.push({ live: false, of: null, wait: 0, age: 0, life: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), drag: 0, fall: 0, wind: 0, r0: 1, r1: 1, swell: 1, tall: 1, turn: 0, spin: 0, lies: 0, long: 0, n: new THREE.Vector3(0, 1, 0), rect: [0, 0, 1, 1], fire: false, c0: [1, 1, 1], c1: [1, 1, 1], a: 1, in: 0, out: 0.5, glow: 0, thick: 1, heart: 1, h0: 0, h1: 0, floor: -1e5, soft: 0, own: 0, far: 0 });
    }
    const fog = scene.fog as THREE.FogExp2 | null;

    // ---- the cards
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const attr = (name: string, wide: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(MOST * wide), wide);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    this.attrs = [attr('iMid', 3), attr('iShape', 4), attr('iAxis', 4), attr('iRect', 4), attr('iRect2', 4), attr('iTint', 4), attr('iKind', 4), attr('iMore', 4)];
    [this.mid, this.shape, this.axis, this.rect, this.rect2, this.tint, this.kind, this.more] = this.attrs.map((a) => a.array as Float32Array);
    geo.instanceCount = 0;
    const pattern = new THREE.DataTexture(ripple(), 64, 64, THREE.RGBAFormat);
    pattern.wrapS = pattern.wrapT = THREE.RepeatWrapping;
    pattern.magFilter = pattern.minFilter = THREE.LinearFilter;
    pattern.needsUpdate = true;
    const sheet = { value: null as THREE.Texture | null };
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tSheet: sheet,
        // (the fireball's pictures: the flames' own sheet, as the flames have it, unless FIREBALL says another)
        tFire: FIREBALL.sheet === FLAMES_ART.sheet ? this.flames.mesh.material.uniforms.tSheet : { value: null },
        tRipple: { value: pattern },
        uTime: this.time,
        uDaylight: atmo.daylight,
        uSun: { value: atmo.sunDir },
        fogColor: { value: fog ? fog.color : new THREE.Color(0.6, 0.66, 0.72) },
        fogDensity: atmo.seconds,
      },
      defines: fog ? { USE_FOG: '', FOG_EXP2: '' } : {},
      vertexShader: CARD_VERT(),
      fragmentShader: CARD_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // (what a card gives is its colour already times how much of it there is, with its light on top: so the one draw both hides and adds)
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    // (after a fire's flames, which are 4, and the old puffs, which are 5: a blast is over whatever was burning there)
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);

    // ---- the thrown ground: made here with nothing in it, so that its shader is written with the world's; its shape and its table come later
    const tgeo = new THREE.InstancedBufferGeometry();
    tgeo.setAttribute('position', new THREE.BufferAttribute(new Int16Array(9), 3, true));
    tgeo.setAttribute('aUv', new THREE.BufferAttribute(new Uint16Array(6), 2, true));
    tgeo.setAttribute('aWho', new THREE.BufferAttribute(new Uint16Array(6), 2));
    tgeo.setIndex([0, 1, 2]);
    for (const [name, wide] of [['iAt', 4], ['iHow', 4], ['iUp', 4], ['iPaint', 4], ['iTop', 3], ['iSide', 3], ['iReachA', 4], ['iReachB', 4]] as [string, number][]) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(THROWS * wide), wide);
      a.setUsage(THREE.DynamicDrawUsage);
      tgeo.setAttribute(name, a);
      this.throwAttrs[name] = a;
    }
    tgeo.instanceCount = 1;
    for (let i = 0; i < THROWS; i++) {
      this.throws.push({ of: null, t: 0, size: 1, pace: 1 });
      this.throwAttrs.iUp.setXYZW(i, 0, 1, 0, 0);
    }
    const blank = new THREE.DataTexture(new Uint16Array(16), 4, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    blank.needsUpdate = true;
    this.thrownU.tMotion.value = blank;
    this.land.magFilter = this.land.minFilter = THREE.NearestFilter;
    this.land.needsUpdate = true;
    this.thrownU.tThrownLand.value = this.land;
    const white = new THREE.DataArrayTexture(new Uint8Array(4).fill(255), 1, 1, 1);
    white.colorSpace = THREE.SRGBColorSpace;
    white.needsUpdate = true;
    this.thrownU.tThrownPaint.value = white;
    const tmat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0, flatShading: true, side: THREE.DoubleSide });
    atmo.register(tmat, (shader) => {
      Object.assign(shader.uniforms, this.thrownU);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${THROWN_PARS}`).replace('#include <begin_vertex>', THROWN_VERT);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray tThrownPaint;\nvarying vec3 vThrownUv;\nvarying vec3 vThrownTint;')
        .replace('#include <map_fragment>', THROWN_FRAG);
    }, 'blast-thrown');
    this.thrown = new THREE.Mesh(tgeo, tmat);
    this.thrown.frustumCulled = false;
    this.thrown.receiveShadow = true;
    scene.add(this.thrown);

    // ---- the ground left burnt: patches out of the same sheet, each laid on its own ground, coming in over a moment
    const bmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const now = this.since;
    atmo.register(bmat, (shader) => {
      shader.uniforms.tBurnSheet = sheet;
      shader.uniforms.uBurnNow = now;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 iMark;\nuniform float uBurnNow;\nvarying vec3 vBurn;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvBurn = vec3( iMark.xy + vec2( uv.x, 1.0 - uv.y ) * 0.25, iMark.w * smoothstep( 0.0, 0.4, uBurnNow - iMark.z ) * ( 1.0 - smoothstep( ${(BURN_LIFE - BURN_FADE).toFixed(1)}, ${BURN_LIFE.toFixed(1)}, uBurnNow - iMark.z ) ) );`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tBurnSheet;\nvarying vec3 vBurn;')
        .replace('#include <map_fragment>', 'diffuseColor = vec4( 0.016, 0.014, 0.012, clamp( texture2D( tBurnSheet, vBurn.xy ).r * 1.7, 0.0, 1.0 ) * vBurn.z );');
    }, 'blast-burnt');
    const bgeo = new THREE.PlaneGeometry(1, 1);
    this.burnMark = new THREE.InstancedBufferAttribute(new Float32Array(BURNS * 4), 4);
    bgeo.setAttribute('iMark', this.burnMark);
    this.burnt = new THREE.InstancedMesh(bgeo, bmat, BURNS);
    this.burnt.count = 1;
    this.burnt.setMatrixAt(0, new THREE.Matrix4().makeScale(0, 0, 0));
    this.burnt.frustumCulled = false;
    this.burnt.receiveShadow = true;
    this.burnt.renderOrder = 3;
    scene.add(this.burnt);

    // The sheet is small and is sent for now; the thrown ground (2.8 MB) and its paints once the game is running.
    void this.fetchSheet(sheet).catch((e) => console.warn('the blast sheet did not come:', e));
  }

  private async picture(rel: string) {
    const r = await fetch(assets.url(rel));
    if (!r.ok) throw new Error(`${r.status} for ${rel}`);
    return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }

  private async fetchSheet(sheet: { value: THREE.Texture | null }) {
    const t = new THREE.Texture((await this.picture(ART.sheet)) as unknown as HTMLImageElement);
    // (one number a point: white where a thing is. Kept as one, it is a quarter of what the same picture is in colour.)
    t.format = THREE.RedFormat;
    t.flipY = false;
    t.premultiplyAlpha = false;
    t.colorSpace = THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    sheet.value = t;
    this.sheetHere = true;
    this.warming = Math.max(this.warming, 3);
    if (FIREBALL.sheet !== FLAMES_ART.sheet) {
      const f = new THREE.Texture((await this.picture(FIREBALL.sheet)) as unknown as HTMLImageElement);
      f.flipY = false;
      f.premultiplyAlpha = false;
      f.colorSpace = THREE.SRGBColorSpace;
      f.generateMipmaps = true;
      f.minFilter = THREE.LinearMipmapLinearFilter;
      f.magFilter = THREE.LinearFilter;
      f.needsUpdate = true;
      this.mesh.material.uniforms.tFire.value = f;
      this.warming = Math.max(this.warming, 3);
    }
  }

  /** The thrown ground and what it is painted with: sent for once, a few seconds after the game is seen to be running. */
  private async fetchThrown() {
    const figures = (await (await fetch(assets.url(ART.figures))).json()) as { sheet: { tiles: string[] }; burst: NonNullable<Blasts['figures']> & { points: number; at: Record<string, [number, number]> } };
    if (figures.sheet.tiles.join() !== TILES.join()) console.warn('the blast sheet is not set out as src/game/blast.ts has it: run scripts/blast.mjs, or put TILES right');
    const f = figures.burst;
    const got = await fetch(assets.url(ART.thrown));
    if (!got.ok) throw new Error(`${got.status} for ${ART.thrown}`);
    const bin = await got.arrayBuffer();
    const list = <A>(name: string, make: new (b: ArrayBuffer, from: number, n: number) => A) => new make(bin, f.at[name][0], f.at[name][1]);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(list('pos', Int16Array), 3, true));
    geo.setAttribute('aUv', new THREE.BufferAttribute(list('uv', Uint16Array), 2, true));
    geo.setAttribute('aWho', new THREE.BufferAttribute(list('who', Uint16Array), 2));
    geo.setIndex(new THREE.BufferAttribute(list('index', Uint16Array), 1));
    for (const [name, a] of Object.entries(this.throwAttrs)) geo.setAttribute(name, a);
    geo.instanceCount = 0;
    const motion = new THREE.DataTexture(list('motion', Uint16Array), f.frames * 2, f.pieces, THREE.RGBAFormat, THREE.HalfFloatType);
    motion.magFilter = motion.minFilter = THREE.NearestFilter;
    motion.generateMipmaps = false;
    motion.needsUpdate = true;
    // its paints: each of the game's own pictures drawn small into a layer, and a layer of plain white after them
    const layers = PAINTS.length + 1, px = PAINT_PX;
    const data = new Uint8Array(px * px * 4 * layers).fill(255);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    for (const [i, name] of PAINTS.entries()) {
      const rel = assets.manifest.textures[name]?.diff;
      if (!rel) continue;
      const img = await this.picture(rel);
      ctx.clearRect(0, 0, px, px);
      ctx.drawImage(img, 0, 0, px, px);
      data.set(ctx.getImageData(0, 0, px, px).data, i * px * px * 4);
      img.close();
      // (a picture a turn: this is nobody's to wait for)
      await new Promise((r) => setTimeout(r, 30));
    }
    const paint = new THREE.DataArrayTexture(data, px, px, layers);
    paint.format = THREE.RGBAFormat;
    paint.type = THREE.UnsignedByteType;
    paint.wrapS = paint.wrapT = THREE.RepeatWrapping;
    paint.minFilter = THREE.LinearMipmapLinearFilter;
    paint.magFilter = THREE.LinearFilter;
    paint.generateMipmaps = true;
    paint.anisotropy = 4;
    paint.colorSpace = THREE.SRGBColorSpace;
    paint.needsUpdate = true;
    paint.onUpdate = () => {
      (paint.image as { data: Uint8Array | null }).data = null;
    };
    // (Put on the graphics card in two helpings, each in frames nothing else is asked of: the paints first, then
    // the shape and its table. `warming` has one piece of no size drawn for a few frames, which is what sends them.)
    this.thrownU.tThrownPaint.value = paint;
    this.thrownHere = true;
    this.warming = Math.max(this.warming, 3);
    await new Promise((r) => setTimeout(r, 500));
    const was = this.thrown.geometry;
    this.thrown.geometry = geo;
    was.dispose();
    this.thrownU.tMotion.value = motion;
    this.thrownU.uThrown.value.set(f.frames, f.pieces, f.big, f.fps);
    this.thrownU.uThrownUv.value.set(f.uv[0], f.uv[1], f.out, f.up);
    this.warming = Math.max(this.warming, 3);
    await new Promise((r) => setTimeout(r, 300));
    this.figures = f;
  }

  /** how many cards are drawn, how many blasts are going, and how many are throwing ground: for whoever measures */
  get counts() {
    return { cards: this.mesh.geometry.instanceCount, blasts: this.blasts.length, throws: this.throws.filter((t) => t.of).length, live: this.cards.filter((c) => c.live).length };
  }

  // ------------------------------------------------------------------ a blast is set off

  /**
   * @param at where it went off
   * @param eye where it is seen from: how much of it is made goes by how far off that is
   */
  go(at: THREE.Vector3, kind: BlastKind, eye: THREE.Vector3) {
    const far = at.distanceTo(eye);
    if (far > TIER.none) return;
    const K = KIND[kind];
    const busy = this.blasts.filter((b) => b.tier === 0 && b.age < 2).length;
    const tier: 0 | 1 | 2 = far > TIER.some ? 2 : far > TIER.full || busy >= TIER.atOnce ? 1 : 0;
    const b: Blast = { kind, at: at.clone(), foot: at.clone(), up: new THREE.Vector3(0, 1, 0), grounded: false, ground: 'other', age: 0, tier, walls: [], roofed: false, top: Infinity, room: Infinity, heard: far / 343, shake: K.shake / (1 + (far / 14) ** 2), fires: [], throw: -1, over: 0 };
    this.under(b);
    if (tier < 2) this.roomOf(b);
    this.blasts.push(b);
    // how many of each thing, and how big a room lets it be
    const share = tier === 0 ? 1 : tier === 1 ? 0.5 : 0.28;
    const many = (n: number) => Math.max(1, Math.round(n * share));
    const room = Math.max(0.6, b.room);
    const fit = (r: number) => Math.min(r, room);
    const low = b.roofed ? Math.min(1, (b.top - at.y) / 4.5) : 1;
    const floor = b.grounded ? b.foot.y : -1e5;
    const dust = DUST[b.ground];
    const col = (hex: number, k = 1) => {
      const c = new THREE.Color(hex);
      return [c.r * k, c.g * k, c.b * k];
    };
    const grey = (k: number) => [k, k * 0.97, k * 0.93];
    const heart = new THREE.Vector3(at.x, at.y + 0.25, at.z);
    const any = () => new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();

    // ---- the flash: there at once, and gone
    this.card(b, { p: heart, r0: K.flash[0], r1: fit(K.flash[1]), life: 0.075, tile: T.dot, c0: [5, 3.5, 1.7], c1: [3, 1.5, 0.45], a: 1, in: 0, out: 0.15, glow: 1, thick: 1.3, floor, soft: 0.3 });
    if (tier < 2) this.card(b, { p: heart, r0: K.flash[0] * 0.9, r1: fit(K.flash[1] * 1.25), life: 0.06, tile: T.rays, turn: rnd(0, 6.3), c0: [6, 4, 1.8], c1: [3, 1.5, 0.45], a: 0.9, in: 0, out: 0.1, glow: 1, thick: 1.6, floor, soft: 0.3 });

    // ---- the fireball
    const F = K.fire;
    const balls = Math.max(1, Math.round(many(F.n) * FIREBALL.many));
    for (let i = 0; i < balls; i++) {
      const way = any();
      way.y = Math.abs(way.y) * 0.8 + 0.15;
      const late = i < 2 ? 0 : rnd(0, F.over), last = i / balls > 0.72;
      // (most are the rolling ball; the last few, a little later, are the rags it leaves)
      const still = last ? pick([3, 4]) : pick([0, 0, 0, 1, 1, 2]);
      this.card(b, {
        p: heart.clone().addScaledVector(way, rnd(0.05, 0.45) * F.r[0] * 2), v: way.clone().multiplyScalar(rnd(0.45, 1) * F.out * low * (last ? 0.5 : 1)).setY(way.y * F.out * 0.4 + rnd(0.5, 1) * F.rise * low),
        wait: late, life: rnd(F.life[0], F.life[1]), drag: 2.6, fall: -F.lift * low,
        r0: F.r[0] * rnd(0.8, 1.2), r1: fit(F.r[1] * rnd(0.75, 1.15) * (tier ? 1.25 : 1) * (last ? 0.8 : 1)), swell: 2.4, tall: still === 0 ? 0.9 : 1,
        turn: still === 0 ? rnd(-0.5, 0.5) : rnd(0, 6.3), spin: rnd(-0.5, 0.5),
        still, fire: true, a: 1, in: 0.03, out: 0.45, h0: F.heat * rnd(0.9, 1.1), h1: 0, floor, soft: 0.25,
      });
    }

    // ---- the smoke the fire turns into
    const S = K.smoke;
    for (let i = 0, n = many(S.n); i < n; i++) {
      const way = any();
      way.y = Math.abs(way.y);
      const dark = S.dark * rnd(0.8, 1.3);
      this.card(b, {
        p: heart.clone().addScaledVector(way, rnd(0.1, 0.5)), v: new THREE.Vector3(way.x * S.out * rnd(0.4, 1), rnd(S.up[0], S.up[1]) * (0.35 + 0.65 * way.y) * low, way.z * S.out * rnd(0.4, 1)),
        wait: rnd(S.over[0], S.over[1]), life: rnd(S.life[0], S.life[1]), drag: 2.2, fall: -S.lift * low, wind: 0.5,
        r0: S.r[0] * rnd(0.8, 1.2), r1: fit(S.r[1] * rnd(0.8, 1.2) * (tier ? 1.3 : 1)), swell: 2.6, turn: rnd(0, 6.3), spin: rnd(-0.45, 0.45),
        tile: pick(T.puffs), c0: grey(dark), c1: grey(S.pale), a: 0.9, in: 0.1, out: 0.3, thick: 1.7, heart: 0.45, h0: S.lit * rnd(0.7, 1.1), h1: S.litFor, floor, soft: 0.5,
      });
    }
    // ---- for fuel, the black column that stands over it
    const C = K.column;
    if (C && !b.roofed) {
      for (let i = 0, n = many(C.n); i < n; i++) {
        const dark = S.dark * rnd(0.8, 1.4);
        this.card(b, {
          p: new THREE.Vector3(at.x + rnd(-0.5, 0.5), at.y + C.from * rnd(0.6, 1.1), at.z + rnd(-0.5, 0.5)), v: new THREE.Vector3(rnd(-0.4, 0.4), C.up * rnd(0.85, 1.2), rnd(-0.4, 0.4)),
          wait: C.over[0] + ((i + Math.random()) / n) * (C.over[1] - C.over[0]), life: rnd(C.life[0], C.life[1]), drag: 0.42, fall: -0.55, wind: 0.8,
          r0: C.r[0] * rnd(0.85, 1.2), r1: C.r[1] * rnd(0.85, 1.2), swell: 1.4, turn: rnd(0, 6.3), spin: rnd(-0.3, 0.3),
          tile: pick(T.puffs), c0: grey(dark), c1: grey(S.pale * 1.3), a: 0.86, in: 0.5, out: 0.35, thick: 2.0, heart: 0.4, h0: 0.35, h1: 0.6, floor, soft: 0.5,
        });
      }
    }

    // ---- what the ground gives: only where there is ground under it
    if (b.grounded) {
      const D = K.dust, up = b.up, lift = b.foot.clone().addScaledVector(up, 0.1);
      const flat = new THREE.Vector3(1, 0, 0).cross(up).normalize(), other = new THREE.Vector3().crossVectors(up, flat);
      const reach = Math.min(D.reach, room * 1.6);
      for (let i = 0, n = many(D.n); i < n; i++) {
        const a = ((i + Math.random()) / n) * Math.PI * 2, out = flat.clone().multiplyScalar(Math.cos(a)).addScaledVector(other, Math.sin(a));
        // (thrown fast and slowed hard: it is out at its reach in half a second, and hangs there)
        this.card(b, {
          p: lift.clone().addScaledVector(out, 0.35).addScaledVector(up, 0.25), v: out.multiplyScalar(reach * 2.6 * rnd(0.7, 1.05)).addScaledVector(up, rnd(0.3, 1.1)),
          wait: rnd(0, 0.04), life: rnd(D.life[0], D.life[1]), drag: 2.8, fall: -0.15, wind: 0.3,
          r0: D.r[0], r1: fit(D.r[1] * rnd(0.8, 1.25)), swell: 2, turn: rnd(0, 6.3), spin: rnd(-0.5, 0.5),
          tile: pick(T.puffs), c0: col(dust[0], rnd(0.75, 0.95)), c1: col(dust[0], 1.05), a: 0.5, in: 0.05, out: 0.25, thick: 1.5, heart: 0.8, floor: b.foot.y - 0.3, soft: 0.45,
        });
      }
      if (tier === 0) {
        // the ring of dust, laid on the ground, and the thin quick ring ahead of it
        this.card(b, { p: lift, lies: 2, n: up, r0: 0.5, r1: Math.min(K.ring, room * 1.5), swell: 2.2, life: 0.9, turn: rnd(0, 6.3), spin: 0.25, tile: T.ring, c0: col(dust[0], 0.9), c1: col(dust[0], 1.05), a: 0.55, in: 0.03, out: 0.2, thick: 1.6, heart: 0.85 });
        this.card(b, { p: lift, lies: 2, n: up, r0: 0.4, r1: Math.min(K.shock[0], room * 1.5), swell: 1.2, life: K.shock[1] * 1.35, tile: T.hoop, c0: [0.85, 0.83, 0.78], c1: [0.85, 0.83, 0.78], a: 0.15, in: 0.015, out: 0.35, thick: 1.4 });
      }
    }

    // ---- sparks, and a burst of embers
    if (tier === 0) {
      const P = K.sparks;
      for (let i = 0; i < P.n; i++) {
        const way = any();
        way.y = Math.abs(way.y) * 0.9 + 0.05;
        this.card(b, {
          p: heart.clone(), v: way.multiplyScalar(rnd(P.speed[0], P.speed[1]) * (b.roofed ? 0.6 : 1)), life: rnd(P.life[0], P.life[1]), drag: 1.5, fall: 9.8,
          lies: 1, long: 0.022, r0: rnd(0.022, 0.04), r1: 0.012, tile: T.streak, c0: [7, 3.8, 1.2], c1: [3, 1, 0.15], a: 1, in: 0, out: 0.5, glow: 1, thick: 2.5,
        });
      }
      for (let i = 0; i < K.embers; i++) {
        this.card(b, { p: heart.clone().add(any().multiplyScalar(0.3)), v: any().multiplyScalar(2).setY(rnd(1, 3)), life: rnd(0.25, 0.38), drag: 2, r0: 0.4, r1: fit(rnd(0.9, 1.3) * K.fire.r[1]), swell: 2, turn: rnd(0, 6.3), tile: T.embers, c0: [3.2, 1.5, 0.35], c1: [2, 0.6, 0.06], a: 0.6, in: 0.015, out: 0.3, glow: 1, thick: 2.2 });
      }
    }

    // ---- the ground thrown; or, where it is not (too far off for pieces to be seen, every throw taken, a floor
    // that is not ground), a spray of clods out of the sheet, thrown up and falling back
    const thrown = b.grounded && far < TIER.thrownTo && this.throwGround(b, tier === 0 ? 1 : 0.34);
    if (b.grounded && !thrown && tier < 2 && b.ground !== 'wood' && b.ground !== 'other') {
      for (let i = 0; i < K.spray; i++) {
        const way = any();
        this.card(b, {
          p: b.foot.clone().addScaledVector(b.up, 0.4), v: new THREE.Vector3(way.x * 3.5, rnd(5, 8.5) * low, way.z * 3.5), life: rnd(0.9, 1.3), drag: 0.9, fall: 9.8,
          r0: 0.3, r1: fit(rnd(1.4, 2.1) * (kind === 'grenade' ? 1 : 1.3)), swell: 1.5, turn: rnd(0, 6.3), spin: rnd(-1.2, 1.2),
          tile: pick(T.clods), c0: col(dust[1], 1.6), c1: col(dust[1], 1.6), a: 0.85, in: 0.04, out: 0.55, thick: 3.5, floor: b.foot.y - 0.2, soft: 0.3,
        });
      }
    }
    if (b.grounded && tier < 2) this.burn(b, K.burn);
    if (K.flames && b.grounded && tier < 2 && !b.roofed) {
      // (never so many at once that the flames of everything else are crowded out of their one draw: a row of drums going up leaves six, not twenty)
      const burning = this.blasts.reduce((n, x) => n + x.fires.length, 0);
      for (let i = 0, n = burning >= 6 ? 0 : tier || burning >= 3 ? 1 : K.flames; i < n; i++) {
        const a = rnd(0, 6.3), r = rnd(0.2, 1.7);
        const g = physics.raycast({ x: b.foot.x + Math.cos(a) * r, y: b.foot.y + 1, z: b.foot.z + Math.sin(a) * r }, _DOWN, 2.5, SOLID_GROUPS);
        if (!g || g.toi < 0.02 || g.normal.y < 0.6) continue;
        const fire = this.flames.add(new THREE.Vector3(g.point.x, g.point.y + this.lift(g, g.point.x, g.point.z), g.point.z), { size: i ? rnd(0.28, 0.6) : rnd(0.7, 0.95), smoke: 0.3, turn: rnd(0, 6.3) });
        fire.lean.set(WIND.x * 0.14, 0, WIND.z * 0.14);
        b.fires.push({ fire, from: rnd(0.25, 0.5), to: rnd(3.2, 4.4), most: rnd(0.7, 1) });
      }
    }
    b.over = Math.max(1, ...this.cards.filter((c) => c.live && c.of === b).map((c) => c.wait + c.life), ...b.fires.map((f) => f.to + 0.5));
  }

  /** what is under a blast: the ground it stands on, the way it faces and what it is */
  private under(b: Blast) {
    const at = b.at;
    // (from the blast itself, and from round about it: what went off may still be standing in the way of its own middle)
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1.8, 0], [-1.8, 0], [0, 1.8], [0, -1.8]]) {
      const g = physics.raycast({ x: at.x + dx, y: at.y + 0.35, z: at.z + dz }, _DOWN, 2.6, SOLID_GROUPS);
      if (!g || g.toi < 0.05 || g.normal.y < 0.55) continue;
      // (a car is not standing on itself: its own roof and bonnet are not the ground under it)
      if (b.kind === 'vehicle' && g.tag?.surface === 'metal') continue;
      b.grounded = true;
      b.up.set(g.normal.x, g.normal.y, g.normal.z).normalize();
      // (the ground under the blast's own middle, on the slope found: the look may have been taken to one side)
      b.foot.set(at.x, g.point.y + (b.up.x * dx + b.up.z * dz) / b.up.y + this.lift(g, at.x, at.z), at.z);
      const s = g.tag?.surface ?? 'other';
      // (the open ground is all one thing to what stops a body; whoever made the world says which ground it is)
      if (s === 'grass') b.ground = this.groundAt?.(at.x, b.foot.y, at.z, b.up.y) ?? 'grass';
      else b.ground = s === 'dirt' || s === 'rock' || s === 'gravel' || s === 'asphalt' || s === 'concrete' || s === 'wood' || s === 'metal' ? s : s === 'plaster' ? 'concrete' : 'other';
      return;
    }
  }

  /**
   * What stands round a blast: the walls near it eight ways round, and the roof over it if there is one. A card
   * faces the eye and has no thickness, and what stands in the world hides only the part of it that is behind:
   * a ball of fire three metres across set off at the foot of a house was a ball of fire in the room behind the
   * wall, and smoke set off in a room hung outside its walls. So each card is kept on the blast's side of every
   * wall near it (see `update`), and in a room no card is bigger than the room.
   */
  private roomOf(b: Blast) {
    // (A car goes up from inside itself: looked from there, its own roof was the roof of a room half a metre high,
    // and its whole blast was kept in its cab. Its room is looked for from over its own roof.)
    const from = { x: b.at.x, y: b.at.y + (b.kind === 'vehicle' ? 2.3 : 0.3), z: b.at.z };
    const look = (x: number, y: number, z: number, most: number) => physics.raycast(from, { x, y, z }, most, SOLID_GROUPS);
    let roof = look(0, 1, 0, 9);
    // (And a look that begins inside something, a drum, finds it at once and at no distance: taken again from over it.)
    if (roof && roof.toi < 0.05) {
      from.y += 1.5;
      roof = look(0, 1, 0, 9);
    }
    if (roof && roof.toi >= 0.05) {
      b.roofed = true;
      b.top = from.y + roof.toi;
      b.walls.push({ q: new THREE.Vector3(from.x, b.top, from.z), n: new THREE.Vector3(0, -1, 0) });
    }
    const open: number[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
      const hit = look(x, 0, z, 8);
      open.push(Infinity);
      // (what faces upward is the ground rising, not a wall)
      if (!hit || hit.toi < 0.05 || hit.normal.y > 0.5) continue;
      const n = new THREE.Vector3(hit.normal.x, 0, hit.normal.z).normalize();
      if (n.x * x + n.z * z > 0) n.negate();
      const q = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
      // A wall, or only something standing there: a trunk, a post, a crate, a fence a metre high? A wall is found
      // again a pace to either side and a man's height up; anything less is not one, and smoke goes round it.
      const off = (from.x - q.x) * n.x + (from.z - q.z) * n.z, toward = { x: -n.x, y: 0, z: -n.z };
      const again = (dx: number, dy: number, dz: number) => {
        const g = physics.raycast({ x: from.x + dx, y: from.y + dy, z: from.z + dz }, toward, off + 0.4, SOLID_GROUPS);
        return !!g && Math.abs(g.toi - off) < 0.4;
      };
      if (!again(-n.z * 1.1, 0, n.x * 1.1) || !again(n.z * 1.1, 0, -n.x * 1.1) || !again(0, 1.6, 0)) continue;
      open[k] = hit.toi;
      // (two looks that found the same wall say it once)
      if (!b.walls.some((w) => w.n.dot(n) > 0.97 && Math.abs(w.n.dot(q) - w.n.dot(w.q)) < 0.3)) b.walls.push({ q, n });
    }
    let gap = Infinity;
    for (let k = 0; k < 4; k++) gap = Math.min(gap, open[k] + open[k + 4]);
    b.room = Math.min(gap, b.roofed ? b.top - (b.grounded ? b.foot.y : b.at.y - 1) : Infinity) / 2;
  }

  /** One card of a blast, taken from those not in use (or, with none left, from the one nearest its end). */
  private card(b: Blast, o: Partial<Omit<Card, 'p' | 'v' | 'n' | 'rect'>> & { p: THREE.Vector3; v?: THREE.Vector3; n?: THREE.Vector3; tile?: number; still?: number }) {
    let c = this.cards.find((x) => !x.live);
    if (!c) {
      let least = Infinity;
      for (const x of this.cards) {
        const left = x.wait + x.life - x.age;
        if (left < least) {
          least = left;
          c = x;
        }
      }
    }
    if (!c) return;
    c.live = true;
    c.of = b;
    c.wait = o.wait ?? 0;
    c.age = 0;
    c.life = o.life ?? 1;
    c.p.copy(o.p);
    if (o.v) c.v.copy(o.v);
    else c.v.set(0, 0, 0);
    c.drag = o.drag ?? 0;
    c.fall = o.fall ?? 0;
    c.wind = o.wind ?? 0;
    c.r0 = o.r0 ?? 1;
    c.r1 = o.r1 ?? c.r0;
    c.swell = o.swell ?? 1;
    c.tall = o.tall ?? 1;
    c.turn = o.turn ?? 0;
    c.spin = o.spin ?? 0;
    c.lies = o.lies ?? 0;
    c.long = o.long ?? 0;
    if (o.n) c.n.copy(o.n);
    c.fire = !!o.fire;
    if (c.fire) {
      const s = FIREBALL.stills[o.still ?? 0], k = FIREBALL.size;
      c.rect = FIREBALL.film ? [0, 0, 1, 1] : [s[0] / k, s[1] / k, s[2] / k, s[3] / k];
    } else c.rect = tile(o.tile ?? T.dot);
    c.c0 = o.c0 ?? [1, 1, 1];
    c.c1 = o.c1 ?? c.c0;
    c.a = o.a ?? 1;
    c.in = o.in ?? 0;
    c.out = o.out ?? 0.5;
    c.glow = o.glow ?? 0;
    c.thick = o.thick ?? 1;
    c.heart = o.heart ?? 1;
    c.h0 = o.h0 ?? 0;
    c.h1 = o.h1 ?? 0;
    c.floor = o.floor ?? -1e5;
    c.soft = o.soft ?? 0;
    c.own = Math.random();
  }

  /** A blast throws the ground it is on: one of the throws is made its own. @returns whether it does */
  private throwGround(b: Blast, share: number) {
    const f = this.figures;
    // (a car throws itself, whatever it stands on. A wooden floor, glass, cloth: nothing is thrown that was not ground.)
    const paint = THROWN[b.kind === 'vehicle' ? 'metal' : b.ground];
    if (!f || !paint) return false;
    const i = this.throws.findIndex((t) => !t.of);
    if (i < 0) return false;
    // (in a room: smaller, and fewer)
    const inside = b.roofed;
    const size = KIND[b.kind].thrown * (inside ? 0.45 : 1);
    const t = this.throws[i];
    t.of = b;
    t.t = 0;
    t.size = size;
    // (smaller, it is quicker: what is thrown half as high is up and down in seven tenths of the time)
    t.pace = 1 / Math.sqrt(size);
    b.throw = i;
    const A = this.throwAttrs, up = b.up, turn = rnd(0, 6.2832);
    A.iAt.setXYZW(i, b.foot.x, b.foot.y, b.foot.z, 0);
    A.iHow.setXYZW(i, size, share * (inside ? 0.5 : 1), 0, b.roofed ? b.top - b.foot.y : 1e4);
    A.iUp.setXYZW(i, up.x, up.y, up.z, turn);
    A.iPaint.setXYZW(i, paint.top, paint.side, 5 / paint.lay, 5 / (paint.lay * 0.8));
    A.iTop.setXYZ(i, paint.tint[0], paint.tint[1], paint.tint[2]);
    A.iSide.setXYZ(i, paint.under[0], paint.under[1], paint.under[2]);
    // how far each of eight ways round is open, along the ground (the same eight the shader reads: see THROWN_VERT)
    const flat = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 0, 1)).normalize(), other = new THREE.Vector3().crossVectors(flat, up);
    const from = b.foot.clone().addScaledVector(up, 0.4), most = f.out * size + 0.6, open: number[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8 - 0.5) * Math.PI * 2;
      const way = flat.clone().multiplyScalar(Math.sin(a)).addScaledVector(other, Math.cos(a));
      // (a look that begins inside what went up finds it at no distance: that is not a wall in the way)
      const hit = physics.raycast(from, way, most, SOLID_GROUPS);
      open.push(hit && hit.toi > 0.05 ? hit.toi : 1e4);
    }
    A.iReachA.setXYZW(i, open[0], open[1], open[2], open[3]);
    A.iReachB.setXYZW(i, open[4], open[5], open[6], open[7]);
    for (const a of Object.values(A)) a.needsUpdate = true;
    // and how the ground stands round it (see LAND): looked for from over the blast's own slope, straight down onto it
    const reach = f.out * size * LAND.out, into = { x: -up.x, y: -up.y, z: -up.z }, rows = this.land.image.data as Float32Array, G = LAND.n;
    for (let gz = 0; gz < G; gz++) {
      for (let gx = 0; gx < G; gx++) {
        const x = ((gx / (G - 1)) * 2 - 1) * reach, z = ((gz / (G - 1)) * 2 - 1) * reach;
        const from = { x: b.foot.x + flat.x * x + other.x * z + up.x * 2.5, y: b.foot.y + flat.y * x + other.y * z + up.y * 2.5, z: b.foot.z + flat.z * x + other.z * z + up.z * 2.5 };
        const hit = physics.raycast(from, into, 6, SOLID_GROUPS);
        // (No ground found under a place: what falls there falls out of sight. And the middle is the blast's own
        // foot: a drum that has just gone up may still be found standing there, and is not ground.)
        rows[i * G * G + gz * G + gx] = gx * 2 === G - 1 && gz * 2 === G - 1 && b.kind !== 'vehicle' ? 0 : hit ? 2.5 - hit.toi + this.lift(hit, hit.point.x, hit.point.z) : -3.5;
      }
    }
    this.land.needsUpdate = true;
    return true;
  }

  /** The ground left burnt: a patch under the blast and smaller ones round it, each on the ground under itself and lying as that lies. */
  private burn(b: Blast, wide: number) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), z = new THREE.Vector3(0, 0, 1), s = new THREE.Vector3(), n = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      const a = (i / 5) * Math.PI * 2 + rnd(0, 0.6), r = i ? wide * rnd(0.22, 0.36) : 0;
      const g = physics.raycast({ x: b.foot.x + Math.cos(a) * r, y: b.foot.y + 0.8, z: b.foot.z + Math.sin(a) * r }, _DOWN, 3, SOLID_GROUPS);
      if (!g || g.toi <= 0.02 || g.normal.y < 0.5) continue;
      n.set(g.normal.x, g.normal.y, g.normal.z);
      // (smaller on a slope: a wide flat patch on ground that curves lifts off it at its edges)
      const size = wide * (i ? rnd(0.4, 0.55) : 0.72) * (n.y > 0.97 ? 1 : 0.7);
      q.setFromUnitVectors(z, n).multiply(new THREE.Quaternion().setFromAxisAngle(z, rnd(0, 6.3)));
      m.compose(p.set(g.point.x, g.point.y + this.lift(g, g.point.x, g.point.z), g.point.z).addScaledVector(n, 0.005 + i * 0.0012), q, s.setScalar(size));
      const k = this.burns++ % BURNS, cell = tile(i % 3 === 1 ? T.rays : T.burn);
      this.burnt.setMatrixAt(k, m);
      this.burnMark.setXYZW(k, cell[0], cell[1], this.since.value, i ? rnd(0.55, 0.85) : 0.95);
    }
    this.burnt.count = Math.min(BURNS, Math.max(this.burnt.count, this.burns));
    this.burnt.instanceMatrix.needsUpdate = true;
    this.burnMark.needsUpdate = true;
  }

  // ------------------------------------------------------------------ every frame

  /** @param eye where the picture is drawn from */
  update(dt: number, eye: THREE.Vector3) {
    this.clock += dt;
    this.time.value = this.clock % 4096;
    this.since.value = this.clock;
    // (burnt ground gone out of sight shrunk to nothing, so that the card draws none of it: once a second)
    if (Math.floor(this.clock) !== Math.floor(this.clock - dt)) {
      const mark = this.burnMark.array as Float32Array, mats = this.burnt.instanceMatrix.array as Float32Array;
      let changed = false;
      for (let k = 0; k < this.burnt.count; k++) {
        if (mark[k * 4 + 3] === 0 || this.clock - mark[k * 4 + 2] < BURN_LIFE) continue;
        mark[k * 4 + 3] = 0;
        mats.fill(0, k * 16, k * 16 + 16);
        changed = true;
      }
      if (changed) {
        this.burnt.instanceMatrix.needsUpdate = true;
        this.burnMark.needsUpdate = true;
      }
    }
    // (Not on a phone: the thrown ground is 2.8 MB to fetch and 14 MB on the graphics card with its paints, and a
    // phone has little of that to spare. A blast there throws the spray of clods out of the sheet instead.)
    if (!this.fetched && this.clock > 3 && !TOUCH) {
      this.fetched = true;
      void this.fetchThrown().catch((e) => console.warn('the thrown ground did not come:', e));
    }
    // ---- the blasts themselves: their light, their shake, the fires they left
    const glow = this.glow, shake = this.shake;
    glow.strength = 0;
    shake.pitch = shake.yaw = shake.roll = 0;
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i], K = KIND[b.kind], L = K.light;
      b.age += dt;
      const lit = L.flash * Math.max(0, 1 - b.age / L.fast) ** 2 + (L.ball ? L.ball * smooth(0, 0.1, b.age) * (1 - smooth(L.ballFor * 0.35, L.ballFor, b.age)) : 0);
      // (only a blast near enough to light something the eye can see has the lamp)
      if (lit > glow.strength && b.at.distanceToSquared(eye) < (L.reach * 3) ** 2) {
        glow.strength = lit;
        glow.reach = L.reach;
        glow.color.setRGB(L.color[0], L.color[1], L.color[2]);
        glow.at.set(b.at.x, b.at.y + 0.6 + Math.min(b.age, 1.2) * (L.ball ? 2.2 : 0), b.at.z);
        if (b.roofed) glow.at.y = Math.min(glow.at.y, b.top - 0.3);
      }
      const felt = b.age - b.heard;
      if (felt > 0 && felt < 0.35) {
        const k = b.shake * (1 - felt / 0.35) ** 2;
        shake.pitch += Math.sin(felt * 61 + i) * k;
        shake.yaw += Math.sin(felt * 47 + 1.3 + i * 2) * k * 0.6;
        shake.roll += Math.sin(felt * 53 + 2.1 + i * 3) * k * 0.5;
      }
      for (const f of b.fires) f.fire.strength = f.most * smooth(f.from, f.from + 0.6, b.age) * (1 - smooth(f.to - 1.2, f.to, b.age));
      if (b.age > b.over) {
        for (const f of b.fires) this.flames.remove(f.fire);
        this.blasts.splice(i, 1);
      }
    }

    // ---- the cards
    const order = this.order;
    order.length = 0;
    for (const c of this.cards) {
      if (!c.live) continue;
      if (c.wait > 0) {
        c.wait -= dt;
        continue;
      }
      c.age += dt;
      if (c.age >= c.life) {
        c.live = false;
        continue;
      }
      c.v.y -= c.fall * dt;
      if (c.wind) {
        c.v.x += (WIND.x - c.v.x) * Math.min(1, c.wind * dt);
        c.v.z += (WIND.z - c.v.z) * Math.min(1, c.wind * dt);
      }
      const slow = Math.exp(-c.drag * dt);
      // (the wind is not slowed away: a puff comes to rest in the air, and the air is moving)
      c.v.x = WIND.x * c.wind + (c.v.x - WIND.x * c.wind) * slow;
      c.v.z = WIND.z * c.wind + (c.v.z - WIND.z * c.wind) * slow;
      c.v.y *= slow;
      c.p.addScaledVector(c.v, dt);
      c.turn += c.spin * dt;
      // kept on the blast's side of every wall near it: what comes to a wall, or to the roof, stops there and spreads along it
      const walls = c.of?.walls;
      if (walls?.length && c.lies !== 2) {
        const r = c.lies === 1 ? 0.05 : Math.min(this.size(c), c.of!.room) * 0.8;
        for (const w of walls) {
          const d = (c.p.x - w.q.x) * w.n.x + (c.p.y - w.q.y) * w.n.y + (c.p.z - w.q.z) * w.n.z;
          if (d >= r) continue;
          c.p.addScaledVector(w.n, r - d);
          const into = c.v.dot(w.n);
          if (into < 0) c.v.addScaledVector(w.n, -into * 1.15);
        }
      }
      // (a spark that has come to the ground is out)
      if (c.lies === 1 && c.of?.grounded && c.p.y < c.of.foot.y - 0.5 && c.v.y < 0) {
        c.live = false;
        continue;
      }
      c.far = c.p.distanceToSquared(eye);
      order.push(c);
    }
    // the furthest first: a near card is drawn over a far one behind it
    order.sort((a, b) => b.far - a.far);
    let n = 0;
    const film = FIREBALL.film;
    for (const c of order) {
      if (n >= MOST) break;
      const u = c.age / c.life, a3 = n * 3, a4 = n * 4;
      const r = this.size(c);
      const shows = c.a * (c.in > 0 ? smooth(0, c.in, c.age) : 1) * (1 - smooth(c.out, 1, u));
      if (shows <= 0.003) continue;
      this.mid[a3] = c.p.x; this.mid[a3 + 1] = c.p.y; this.mid[a3 + 2] = c.p.z;
      this.shape[a4] = r; this.shape[a4 + 1] = r * c.tall; this.shape[a4 + 2] = c.turn; this.shape[a4 + 3] = c.floor;
      if (c.lies === 1) {
        // as long as the way it has come in `long` seconds (and never shorter than it is wide)
        const long = Math.max(c.long, (r * 2) / Math.max(c.v.length(), 0.01)) * 0.5;
        this.axis[a4] = c.v.x * long; this.axis[a4 + 1] = c.v.y * long; this.axis[a4 + 2] = c.v.z * long;
      } else {
        this.axis[a4] = c.n.x; this.axis[a4 + 1] = c.n.y; this.axis[a4 + 2] = c.n.z;
      }
      this.axis[a4 + 3] = c.lies;
      let mix = 0;
      if (c.fire && film) {
        // the film: the frame this moment falls in, the one after it, and how far between the two it is
        const x = u * (film.frames - 1), k = Math.min(film.frames - 2, Math.floor(x));
        mix = x - k;
        for (const [to, f] of [[this.rect, k], [this.rect2, k + 1]] as [Float32Array, number][]) {
          const cx = f % film.cols, cy = Math.floor(f / film.cols);
          to[a4] = cx / film.cols; to[a4 + 1] = cy / film.rows; to[a4 + 2] = (cx + 1) / film.cols; to[a4 + 3] = (cy + 1) / film.rows;
        }
      } else {
        this.rect.set(c.rect, a4);
        this.rect2.set(c.rect, a4);
      }
      this.tint[a4] = c.c0[0] + (c.c1[0] - c.c0[0]) * u; this.tint[a4 + 1] = c.c0[1] + (c.c1[1] - c.c0[1]) * u; this.tint[a4 + 2] = c.c0[2] + (c.c1[2] - c.c0[2]) * u; this.tint[a4 + 3] = shows;
      this.kind[a4] = c.fire ? 1 : 0;
      this.kind[a4 + 1] = c.glow;
      // fire: its heat, falling quickest at first. Smoke: the fire's light on it, dying away
      this.kind[a4 + 2] = c.fire ? c.h1 + (c.h0 - c.h1) * (1 - u) ** 1.6 : c.h1 > 0 ? c.h0 * Math.exp(-c.age / c.h1) : 0;
      this.kind[a4 + 3] = c.own;
      this.more[a4] = mix; this.more[a4 + 1] = c.thick; this.more[a4 + 2] = c.heart; this.more[a4 + 3] = c.soft;
      n++;
    }

    // ---- the throws
    let throws = 0;
    const A = this.throwAttrs, f = this.figures;
    for (let i = 0; i < THROWS; i++) {
      const t = this.throws[i];
      if (!t.of || !f) continue;
      t.t += dt;
      const flown = f.seconds / t.pace, sunk = smooth(flown + LIES.for, flown + LIES.for + LIES.sinks, t.t);
      if (t.t > flown + LIES.for + LIES.sinks) {
        t.of = null;
        // (a throw that is over is one of no pieces)
        A.iHow.setY(i, 0);
      } else {
        A.iAt.setW(i, t.t * t.pace);
        A.iHow.setZ(i, sunk * LIES.by * Math.max(t.size, 0.6) + sunk * 0.25);
        throws = i + 1;
      }
      A.iAt.needsUpdate = true;
      A.iHow.needsUpdate = true;
    }

    // ---- what is drawn (and, while the pictures are still to be put on the card, one of each with no size)
    const warm = this.warming > 0 && (this.sheetHere || this.thrownHere || this.clock < 1);
    if (warm) this.warming--;
    if (!n && warm) {
      this.mid.fill(0, 0, 3);
      this.shape.fill(0, 0, 4);
      this.tint.fill(0, 0, 4);
      n = 1;
    }
    const geo = this.mesh.geometry, was = geo.instanceCount;
    geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n || was) {
      for (const a of this.attrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
    if (!throws && warm) {
      A.iHow.setXYZW(0, 0, 0, 0, 1);
      A.iUp.setXYZW(0, 0, 1, 0, 0);
      A.iHow.needsUpdate = A.iUp.needsUpdate = true;
      throws = 1;
    }
    this.thrown.geometry.instanceCount = throws;
    this.thrown.visible = throws > 0;
    this.burnt.visible = this.burns > 0 || warm;
  }

  /** half the width of a card at this moment of its life */
  private size(c: Card) {
    const u = Math.min(1, c.age / c.life);
    return c.r0 + (c.r1 - c.r0) * (1 - (1 - u) ** c.swell);
  }
}
