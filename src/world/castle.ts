// The fort on the mountain, as it is drawn and as it stops a body. What it is and where everything in it lies is
// in src/sim/castle.ts (the server knows it too); its shapes are worked out in src/world/castle-shape.ts, as plain
// numbers, and its pictures are chosen there (PICTURES); here they are given their stone and timber, stood in the
// world and made solid.
//
// WHAT IT COSTS, AND WHEN. Nobody pays for a fort they never go to (2026-10-13: "make sure those new textures we
// downloaded wont cause major performance issues"):
//   - from further off than NEAR it is one thing to draw, a lighter shape of the same broken outline with no
//     picture on it at all, each corner coloured as what it stands for. That, and what stops a body, is all that
//     is made when the fort is stood in the world;
//   - its pictures (two sets of stone, and the rock's) are asked for the first time an eye comes within ASK of
//     it, long before they are wanted, with nothing waiting on them. They are put on the card as they come, in
//     spare time (see `texture` in src/core/assets.ts). Until every one has come, the far shape goes on being drawn;
//   - its walls, the feet of its towers and its gatehouse are the fort kit's pieces, and its gate the castle
//     door's (src/world/kit.ts): those two models are asked for at the same time, and not before;
//   - then its own shapes are made and got ready ahead of being seen (shaders written, each part drawn once off
//     the picture: the renderer's `ready`, handed in), and only then put in the world: six things to draw, one for
//     each sheet of stuff, and a seventh drawn only into the sun's shadow maps;
//   - what is under the terrace is another few, drawn only while an eye is within UNDER_SEEN of the fort's middle.

import * as THREE from 'three';
import { GLASS_GROUPS, WORLD_GROUPS, physics } from '../core/physics';
import { assets } from '../core/assets';
import { breathe } from '../core/breathe';
import { SHADOW_FRUSTA, type Atmosphere, type ShaderPatch } from './atmosphere';
import { ARCADE, CASTLE, CASTLE_SCALE, LAMPS, UNDER, castleAt, castleLocal, castleUnder, castleDoor, castleKit, castleLamps, castleLoose, castleRocks, looseLocal, type GroundAt, type Loose, type Place } from '../sim/castle';
import { PICTURES, SHEETS, castleShapeSteps, castleSky, type Shape, type Sheet, type Skin, type Solid } from './castle-shape';
import { kitMeshes, stoneLook, type StoneLook } from './kit';
import { PostSite } from './castle-post';

/** how far from its middle the eye may be, over the ground, for the fort's own shapes to be drawn: beyond, the lighter ones */
const NEAR = 330;
/** and how far off its pictures are sent for: they have the time it takes to walk from here to NEAR to come */
const ASK = 380;
/** how near its middle an eye must be for what is under the terrace to be drawn at all (and then only if it is in it, or where it can be seen into: see `seesUnder`) */
const UNDER_SEEN = 90;
/** how near an eye may come before all of it must be made (it is made between frames from the start of the game: this is for an eye that begins near it) */
const MADE_BY = 460;
/** the far shape is flat colour: so much of the sky's light it takes, as the stone's picture does with its hollows (the occlusion of `castle_wall_slates`, taken all over: see `hollows` in kit.ts) */
const FAR_HOLLOWS = 0.45;
/** how far off the kit's far copy is sent for: until it comes, blocks stand for the kit's pieces from far off */
const FAR_KIT = 900;
/** how much snow lies on it where nobody has said: the mountain it is made for is over the snow line, and not at its top */
export const SNOW_ON_THE_MOUNTAIN = 0;
/** a cresset's fire: the colour of its light, how far that carries, and how big its flames are beside a campfire's */
export const CRESSET = { colour: new THREE.Color(1, 0.62, 0.3), reach: 11, size: 0.26 };

/**
 * THE KIT'S STONE, AS THIS FORT HAS IT: the one place its colour is said. The kit comes as warm brown stone; this
 * fort stands on a grey mountain over the snow line, so so much of the stone's own colour is taken out (`keep`)
 * and what is left is turned a little cold (`tint`). The fort's own stone (PICTURES, in castle-shape.ts) is graded
 * to sit beside it.
 */
export const KIT_STONE: Record<string, StoneLook> = {
  fort_wall: { keep: 0.6, tint: [1.02, 1.02, 1.03] },
  fort_trim: { keep: 0.5, tint: [0.97, 0.98, 1.0] },
  fort_plaster: { keep: 0.45, tint: [0.9, 0.93, 0.98] },
};
/** the scanned rock: as it came it is rust and green; on this mountain it is grey */
const ROCK_STONE: StoneLook = { keep: 0.45, tint: [0.92, 0.95, 1.0] };
/** the fort's own sheets in the same look: the picture's colour kept so much, raised, and evened toward the stone's own (see PICTURES) */
const own = (p: { keep: number; lift: number; own: [number, number, number]; even: number }): StoneLook => ({ keep: p.keep, tint: [p.lift, p.lift, p.lift], own: p.own, even: p.even, damp: 0.22 });

/**
 * What the stone and the water under the terrace are told, each frame, of the day over them: the way to the sun (in
 * the fort's own measure, and in the world's), the sun's light as it comes down a hole in the terrace, how much the
 * sky's light has been turned down for the eye (as a number to turn it up again by), and how bright the sky is.
 */
interface Day { sunL: { value: THREE.Vector3 }; sunW: { value: THREE.Vector3 }; sun: { value: THREE.Color }; eye: { value: number }; sky: { value: number } }

const f3 = (v: number) => v.toFixed(3);
/**
 * THE SUN DOWN A HOLE, for a shader: whether the line from a place under the terrace to the sun goes out through
 * the hole in the north walk or through the bay of the west vault that fell (through the terrace's whole thickness:
 * it must pass the mouth at the top and the mouth underneath). One sum, no shadow map: the patch of sun moves over
 * the wall and the water as the day goes, and is there whatever is drawn round it.
 */
const SHAFT = (() => {
  const U = UNDER, D = U.cistern.drop, B = U.bay;
  return `
uniform vec3 uCastleSunL;
uniform vec3 uCastleSunW;
uniform vec3 uCastleSun;
uniform float uCastleEye;
const vec4 castleHole = vec4( ${f3(D.x0)}, ${f3(D.z0)}, ${f3(D.x1)}, ${f3(D.z1)} );
const vec4 castleBay = vec4( ${f3(B.x0)}, ${f3(B.z0)}, ${f3(B.x1)}, ${f3(B.z1)} );
float castleIn( vec2 q, vec4 b ) {
  return smoothstep( b.x - 0.07, b.x + 0.07, q.x ) * ( 1.0 - smoothstep( b.z - 0.07, b.z + 0.07, q.x ) ) * smoothstep( b.y - 0.07, b.y + 0.07, q.y ) * ( 1.0 - smoothstep( b.w - 0.07, b.w + 0.07, q.y ) );
}
float castleShaft( vec3 p ) {
  vec3 s = uCastleSunL;
  if ( s.y < 0.08 || p.y > ${f3(U.roof - 0.02)} ) return 0.0;
  vec2 a = p.xz + s.xz * ( ( ${f3(U.roof)} - p.y ) / s.y ), b = p.xz - s.xz * ( p.y / s.y );
  // (the hole in the walk lights the cistern and nothing beyond its walls; and what a pier of its arcade stands
  // between and the sun is in that pier's shadow: the line to the sun must cross the arcade's line under one of its arches)
  float hole = castleIn( a, castleHole ) * castleIn( b, castleHole ) * step( p.z, ${f3(U.cistern.z1 + 0.3)} ) * step( p.x, ${f3(U.cistern.x1 + 0.3)} );
  if ( hole > 0.0 && abs( s.z ) > 0.0001 ) {
    float t = ( ${f3(ARCADE.z)} - p.z ) / s.z;
    vec3 q = p + s * t;
    if ( t > 0.0 && q.y < ${f3(U.roof)} ) {
      float open = 0.0;
${ARCADE.arches.map(([u0, u1]) => `      open = max( open, step( ${f3(u0 - U.x)}, q.x ) * step( q.x, ${f3(u1 - U.x)} ) );`).join('\n')}
      hole *= open * step( q.y, ${f3(U.floor + 2.05)} );
    }
  }
  // (the bay of the west vault that fell lights the west side under it, and no further)
  float bay = castleIn( a, castleBay ) * castleIn( b, castleBay ) * step( p.x, ${f3(CASTLE.keep.x0 + 0.2)} );
  return max( hole, bay );
}`;
})();

/**
 * The fort's stone lit as it stands, not as the eye does. The sky's light is turned down for the whole picture
 * when the eye goes under a roof (the atmosphere's `cover`); stone that knows its own cover, corner by corner (see
 * `stoneLook`), is turned up again by as much, so a wall is as light or as dark from inside as from outside. And
 * the sun that comes down a hole in the terrace lies on what it reaches (SHAFT).
 */
const underLight = (day: Day): ShaderPatch => (shader) => {
  Object.assign(shader.uniforms, { uCastleSunL: day.sunL, uCastleSunW: day.sunW, uCastleSun: day.sun, uCastleEye: day.eye });
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCastleP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCastleP = position;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vCastleP;${SHAFT}`)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  float shaft = castleShaft( vCastleP );
  if ( shaft > 0.0 ) {
    vec3 sunV = normalize( ( viewMatrix * vec4( uCastleSunW, 0.0 ) ).xyz );
    reflectedLight.directDiffuse += shaft * saturate( dot( normal, sunV ) ) * uCastleSun * BRDF_Lambert( material.diffuseColor );
  }
}`)
    .replace('#include <aomap_fragment>', `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= uCastleEye;
reflectedLight.indirectSpecular *= uCastleEye;`);
};
const both = (a: ShaderPatch, b: ShaderPatch): ShaderPatch => (shader) => { a(shader); b(shader); };

/**
 * The cistern's water: a dark sheet, nearly still, a knee deep, and seen into a little from over it. It shows what
 * is over it: the sky where that is the hole in the walk, the vault as the day finds it elsewhere; more of both the
 * lower the eye looks along it. Slow ripples turn the way it faces a little, so that what it shows (and a fire's
 * light on it) breaks and moves. Where the sun comes down the hole it lights what is in the water; and it is paler
 * in a hand's breadth along every wall and pier, where the scum lies. (Colour and the way it faces only: one flat face.)
 */
const still = (time: { value: number }, place: Place, day: Day): ShaderPatch => (shader) => {
  const U = UNDER, C = U.cistern, c = Math.cos(place.rot), s = Math.sin(place.rot), level = U.floor + C.water;
  // (the piers of its arcade: what is left of that line between its arches)
  const ends = [0, ...ARCADE.arches.flat(), C.x1 + U.x], piers = Array.from({ length: ends.length / 2 }, (_, k) => [ends[2 * k] - U.x, ends[2 * k + 1] - U.x]);
  Object.assign(shader.uniforms, { uWaterT: time, uWaterSky: day.sky, uCastleSunL: day.sunL, uCastleSunW: day.sunW, uCastleSun: day.sun, uCastleEye: day.eye });
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWaterW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
uniform float uWaterT;
uniform float uWaterSky;
varying vec3 vWaterW;${SHAFT}
// (a way in the world, in the fort's own measure: the fort is turned)
vec2 castleTurn( vec2 v ) { return vec2( v.x * ${f3(c)} - v.y * ${f3(s)}, v.x * ${f3(s)} + v.y * ${f3(c)} ); }
vec2 waterLean( vec2 w ) {
  float t = uWaterT;
  return vec2( sin( w.x * 2.1 + t * 0.55 ) + 0.6 * sin( w.x * 5.3 - w.y * 3.1 + t * 0.9 ) + 0.35 * sin( w.x * 11.0 + w.y * 8.3 - t * 1.3 ), sin( w.y * 2.6 - t * 0.47 ) + 0.6 * sin( w.y * 4.7 + w.x * 2.9 + t * 0.8 ) + 0.35 * sin( w.y * 12.1 - w.x * 7.4 + t * 1.1 ) ) * 0.045;
}
float waterShore( vec2 w ) {
  float d = min( min( w.x + ${f3(U.x)}, ${f3(C.x1)} - w.x ), min( w.y + ${f3(U.z)}, ${f3(C.z1)} - w.y ) );
${piers.map(([x0, x1]) => `  d = min( d, length( max( abs( w - vec2( ${f3((x0 + x1) / 2)}, ${f3(ARCADE.z)} ) ) - vec2( ${f3((x1 - x0) / 2)}, ${f3(ARCADE.thick / 2)} ), 0.0 ) ) );`).join('\n')}
  return d;
}`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
vec2 waterAt = castleTurn( vWaterW.xz - vec2( ${f3(place.x)}, ${f3(place.z)} ) );
vec2 waterTilt = waterLean( waterAt );
normal = normalize( ( viewMatrix * vec4( waterTilt.x, 1.0, waterTilt.y, 0.0 ) ).xyz );`)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  // (what it shows is found with a third of its ripples: at all of them the hole in the walk came back as a pale shape
  // like spilt milk, which nobody could read as a hole)
  vec3 toEye = normalize( cameraPosition - vWaterW ), up = normalize( vec3( waterTilt.x, 1.0, waterTilt.y ) ), back = reflect( -toEye, normalize( vec3( waterTilt.x * 0.3, 1.0, waterTilt.y * 0.3 ) ) );
  // (what it shows is the roof over it, a pace or two further on. Where that is the hole in the walk: the sides of
  // the hole, a metre of stone with the day on it; and the sky only where the line goes out of the top of the hole as well)
  vec2 along = castleTurn( back.xz ) / max( back.y, 0.05 );
  vec2 over = waterAt + along * ${f3(U.roof - level)}, out2 = waterAt + along * ${f3(-level)};
  float off = length( max( max( castleHole.xy - over, over - castleHole.zw ), 0.0 ) ), off2 = length( max( max( castleHole.xy - out2, out2 - castleHole.zw ), 0.0 ) );
  vec3 stone = vec3( 0.21, 0.2, 0.19 ) * ( 0.02 + 0.55 * pow( max( 0.0, 1.0 - off / 9.0 ), 1.6 ) );
  float mouth = 1.0 - smoothstep( 0.0, 0.45, off );
  vec3 seen = mix( stone, vec3( 0.3, 0.31, 0.33 ), mouth );
  seen = mix( seen, vec3( 0.8, 0.9, 1.05 ) * 0.75, mouth * ( 1.0 - smoothstep( 0.0, 0.45, off2 ) ) ) * uWaterSky;
  float glance = 0.03 + 0.97 * pow( 1.0 - saturate( dot( toEye, up ) ), 5.0 );
  totalEmissiveRadiance += seen * glance;
  // (the sun down the hole: the water is not clear, and what is in it is lit)
  totalEmissiveRadiance += castleShaft( vec3( waterAt.x, ${f3(level)}, waterAt.y ) ) * uCastleSun * vec3( 0.007, 0.011, 0.009 );
  // (the scum along the stone, and how far it is seen into: least where the eye looks along it)
  float scum = 1.0 - smoothstep( 0.0, 0.16, waterShore( waterAt ) + 0.03 * sin( waterAt.x * 9.0 + waterAt.y * 7.0 ) );
  reflectedLight.directDiffuse *= 1.0 + 2.5 * scum;
  diffuseColor.a = mix( 0.85, 1.0, max( glance, scum * 0.6 ) );
}`);
};

/**
 * The day coming down through the holes in the terrace (over the cistern, and where the west vault fell in): a
 * faint beam under each, in the dust of the place. Drawn over everything else and added to it, so it costs nothing
 * of the light's own sums; it is as bright as the day and leans as the sun does (CastleSite sets both). In the
 * fort's own measure, made standing straight.
 */
function shaftsOf(): THREE.Mesh {
  const pos: number[] = [], col: number[] = [], U = UNDER, D = U.cistern.drop;
  const quad = (p: number[][], c: number[]) => { for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...p[k]); col.push(c[k], c[k], c[k]); } };
  /** the beam: the four sides of a shaft from the hole down to what it lights, brighter at its top */
  const beam = (x0: number, x1: number, z0: number, z1: number, top: number, foot: number, most: number) => {
    const a = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], spread = 0.12;
    for (let k = 0; k < 4; k++) {
      const [px, pz] = a[k], [qx, qz] = a[(k + 1) % 4], mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, out = (v: number, m: number) => v + Math.sign(v - m) * spread;
      quad([[px, top, pz], [qx, top, qz], [out(qx, mx), foot, out(qz, mz)], [out(px, mx), foot, out(pz, mz)]], [most, most, 0, 0]);
    }
  };
  // (each in five, one inside another: it is thickest in its middle, and has no one edge)
  for (const k of [0, 0.18, 0.36, 0.54, 0.72]) {
    // (a pace and a half of it under the mouth of the hole, dying away: the light it becomes is on the stone and the water, where the sun's own sum puts it)
    beam(D.x0 + k, D.x1 - k, D.z0 + k, D.z1 - k, U.roof + 0.9, U.roof - 1.5, 0.01);
    // (the fallen vault: down its length)
    beam(U.bay.x0 + k * 0.6, U.crawl - k * 0.6, U.bay.z0 + 2.4 + k, U.bay.z1 - k, U.roof + 0.9, U.roof - 1.5, 0.007);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.78, 0.86, 1.0), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: true }));
  mesh.name = 'castle:shafts';
  mesh.matrixAutoUpdate = false;
  // (it leans with the sun: where it was made is not where it is drawn)
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

/** a skin as the card wants it: plain rows of numbers, and nothing kept that is not needed */
interface Packed { pos: Float32Array; nrm: Float32Array; uv: Float32Array; col: Float32Array; snow: Float32Array }
const pack = (k: Skin): Packed => ({ pos: new Float32Array(k.pos), nrm: new Float32Array(k.nrm), uv: new Float32Array(k.uv), col: new Float32Array(k.col), snow: new Float32Array(k.snow) });
function geometry(k: Packed): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(k.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(k.nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(k.uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(k.col, 3));
  g.setAttribute('aSnow', new THREE.BufferAttribute(k.snow, 2));
  g.computeBoundingSphere();
  return g;
}

export interface CastleOptions {
  /** how high the world's ground is at a spot (the loose pieces stand on it): unsaid, the ground the fort assumes */
  ground?: GroundAt;
  /** the loose pieces of its grounds, where each stands in the world: unsaid, where the real ones stand (see `castleLoose`) */
  loose?: Loose[];
  /** false where the mountain itself comes up to the foot of the ramp: the rock it leaves from is not made */
  rock?: boolean;
  /** how much snow lies on it, 0 none to 1 deep winter: unsaid, what the mountain it is made for has */
  snow?: number;
  /** what the world's ground is drawn with (the terrain's `lid`): the earth laid round the hatch, over the hole cut for its steps, is drawn with the same */
  earth?: THREE.Material;
  /** gets a thing ready to be drawn before it is put in the world (the renderer's `ready`): unsaid, its first frame pays for it */
  ready?: (o: THREE.Object3D) => Promise<unknown>;
  /** a fire in each cresset, of the game's own flames: where, and how big beside a campfire. What comes back has its `strength` set every frame. Unsaid: the light of them, and no flame */
  fire?: (at: THREE.Vector3, size: number) => { strength: number };
}

export class CastleSite {
  /** how much of it there is to draw and to run into: for whoever asks what it costs */
  readonly counts = { near: 0, under: 0, far: 0, kit: 0, draws: 0, farDraws: 2, solids: 0 };
  /** what making it cost, in thousandths of a second: as the game started (`boot`); after that, between frames, in all (`after`) and in how many goes; the longest of those goes; and how long after the start the last of it was made (0: not yet) */
  readonly timing = { boot: 0, after: 0, goes: 0, longest: 0, madeAt: 0 };
  private born = performance.now();
  /** 'far': only its far shape is made; 'asked': its pictures are on their way; 'near': all of it is on the card */
  state: 'far' | 'asked' | 'near' = 'far';
  /** everything of it that is drawn */
  readonly group = new THREE.Group();
  /** the army's post in it and on it, which is made and drawn by its own file */
  readonly post: PostSite;
  private near = new THREE.Group();
  private under = new THREE.Group();
  private far: THREE.Mesh;
  /** what stands for the kit's pieces from far off: blocks, and then the kit's own far copy when that has come */
  private farKit = new THREE.Group();
  private farAsked = false;
  private skins: { near: Record<Sheet, Packed>; under: Record<Sheet, Packed> } | null = null;
  /** the rest of it being made, a piece at a time, after what is seen from far (null: it is all made). See `make`. */
  private making: Generator<void, void, void> | null = null;
  private sets: (ReturnType<typeof assets.pbr> | null)[] = [];
  private fires: THREE.Vector3[];
  private flames: { strength: number }[] = [];
  /** the fort's own flame in each lantern, where whoever stands the fort gives it none of the game's (see CastleOptions.fire): a small bright shape, enough to say the lantern is lit */
  private own: THREE.Mesh[] = [];
  private clock = 0;
  /** seconds, for the water's slow ripples */
  private time = { value: 0 };
  /** the day over what is under the terrace, as its stone and its water are told it each frame */
  private day: Day = { sunL: { value: new THREE.Vector3(0, 1, 0) }, sunW: { value: new THREE.Vector3(0, 1, 0) }, sun: { value: new THREE.Color(0, 0, 0) }, eye: { value: 1 }, sky: { value: 1 } };
  /** the day coming down the holes in the terrace: a lit patch under each and a faint beam, by day (see `shaftsOf`) */
  private shafts = shaftsOf();
  /** whether the kit's two models have come */
  private kitHere = false;
  /** the materials of the kit's pieces and the door, once made: theirs are the pictures that are sharper close to (see src/game/near.ts) */
  readonly sharp: THREE.Material[] = [];
  private snowU = { value: SNOW_ON_THE_MOUNTAIN };
  /** How much snow lies on it: 0 the bare fort, anywhere; 1 deep winter. (Colour only: it may be changed at any time, and costs nothing to change.) */
  get snow() {
    return this.snowU.value;
  }
  set snow(v: number) {
    this.snowU.value = Math.min(1, Math.max(0, v));
  }

  constructor(readonly place: Place, private atmo: Atmosphere, scene: THREE.Scene, private o: CastleOptions = {}) {
    const P = place, ground = o.ground;
    if (o.snow !== undefined) this.snow = o.snow;
    // (Here, as the game starts: only what is seen from far off, and the earth over the cut ground. The rest of it is
    // made afterwards a piece at a time, between frames: see `make`.)
    const steps = castleShapeSteps(
      ground ? (x, z) => { const [wx, , wz] = castleAt(P, x, z); return (ground(wx, wz) - P.y) / CASTLE_SCALE; } : undefined,
      looseLocal(P, o.loose ?? castleLoose(P)),
      o.rock !== false,
    );
    const shape = steps.next().value as Shape;
    this.counts.far = shape.far.pos.length / 9;

    const all = this.group;
    all.name = 'castle';
    all.position.set(P.x, P.y, P.z);
    all.rotation.y = P.rot;
    // (the whole of it a fifth bigger than its own measure: see CASTLE_SCALE)
    all.scale.setScalar(CASTLE_SCALE);
    all.updateMatrix();
    all.matrixAutoUpdate = false;
    // from far off: one shape, no picture, coloured corner by corner; aged and snowed on as the near one is, so it is the same fort
    const plain = atmo.register(new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: true }), stoneLook({ snow: this.snowU, attr: 'aSnow', hollows: FAR_HOLLOWS }), 'castle far');
    const far = pack(shape.far), cut = (from: number, to: number): Packed => ({ pos: far.pos.subarray(from * 9, to * 9), nrm: far.nrm.subarray(from * 9, to * 9), uv: far.uv.subarray(from * 6, to * 6), col: far.col.subarray(from * 9, to * 9), snow: far.snow.subarray(from * 6, to * 6) });
    this.far = new THREE.Mesh(geometry(cut(0, shape.farOwn)), plain);
    this.far.name = 'castle:far';
    this.far.matrixAutoUpdate = false;
    const blocks = new THREE.Mesh(geometry(cut(shape.farOwn, this.counts.far)), plain);
    blocks.name = 'castle:far blocks';
    blocks.matrixAutoUpdate = false;
    this.farKit.add(blocks);
    this.farKit.matrixAutoUpdate = false;
    all.add(this.far, this.farKit);
    if (o.earth && shape.near.earth.pos.length) {
      // (the earth laid over what the world cut for the sally port: it is drawn from the first and from any distance, with the ground's own paint, or the cut would be seen)
      const lid = new THREE.Mesh(geometry(pack(shape.near.earth)), o.earth);
      lid.name = 'castle:earth';
      lid.receiveShadow = true;
      lid.matrixAutoUpdate = false;
      all.add(lid);
      this.counts.draws++;
    }
    this.near.visible = this.under.visible = false;
    this.fires = castleLamps(P, ground, o.loose).map(([x, y, z]) => new THREE.Vector3(x, y - 0.26, z));
    scene.add(all);
    all.updateMatrixWorld(true);

    this.post = new PostSite(place, atmo, scene, { ground: o.ground, loose: o.loose, snow: this.snowU, ready: o.ready });
    this.making = this.make(steps, shape);
    this.timing.boot = performance.now() - this.born;
    void this.makeBetweenFrames();
  }

  /**
   * THE REST OF IT, made a piece at a time: its own shapes from near and under the terrace, each sheet of them put
   * in rows of plain numbers for the card, and everything of it that stops a body and a shot. It stops after each
   * piece (a part of the fort; a sheet; forty blocks), so that whoever turns it can stop when a frame has had its share.
   */
  private *make(steps: Generator<Shape | undefined, Shape, void>, shape: Shape): Generator<void, void, void> {
    for (let r = steps.next(); !r.done; r = steps.next()) yield;
    const near = {} as Record<Sheet, Packed>, under = {} as Record<Sheet, Packed>;
    for (const s of SHEETS) {
      near[s] = pack(shape.near[s]);
      under[s] = pack(shape.under[s]);
      this.counts.near += shape.near[s].pos.length / 9;
      this.counts.under += shape.under[s].pos.length / 9;
      yield;
    }
    // ---- what stops a body and a shot
    if (physics.world) for (let i = 0; i < shape.solids.length; i++) {
      this.solid(shape.solids[i]);
      if (i % 40 === 39) yield;
    }
    this.counts.solids = shape.solids.length;
    this.skins = { near, under };
    this.making = null;
  }

  /** It is made between frames, a couple of thousandths of a second of it at a time (see `breathe`): begun as the game starts, done long before anybody has walked to the mountain. */
  private async makeBetweenFrames() {
    while (this.making) {
      await breathe();
      const m = this.making, t0 = performance.now();
      while (m && performance.now() - t0 < 2) if (m.next().done) break;
      this.went(performance.now() - t0);
    }
  }

  /**
   * All that is left of it is made now, in one go. For whoever cannot wait: somebody set down by the fort before it
   * was made (a player who left the game there and has come back to it; an admin's leap), who must have its floors
   * under him at once; and a page that stands a body in it from the first.
   */
  finish() {
    const m = this.making, t0 = performance.now();
    if (!m) return;
    while (!m.next().done);
    this.went(performance.now() - t0);
  }
  /** a go at making it took so long */
  private went(ms: number) {
    const t = this.timing;
    t.after += ms;
    t.goes++;
    t.longest = Math.max(t.longest, ms);
    if (!this.making && !t.madeAt) t.madeAt = performance.now() - this.born;
  }

  /** Its pictures are sent for. (Nothing waits on them: they come when they come.) */
  private ask() {
    this.state = 'asked';
    this.sets = SHEETS.map((s) => (PICTURES[s].tex && !(s === 'earth' && this.o.earth) ? assets.pbr(PICTURES[s].tex!) : null));
    void Promise.all([assets.model('fort_kit'), assets.model('large_castle_door'), assets.model('rock_face_01'), assets.model('rock_face_01', 1)]).then(() => void (this.kitHere = true));
  }

  /** The kit's far copy is sent for, and stood in place of the blocks when it has come: from far off the fort then has the kit's own outline, merlons and all. */
  private async askFar() {
    this.farAsked = true;
    const kit = await kitMeshes('fort_kit', castleKit().filter((p) => (typeof p.scale === 'number' ? p.scale : 1) >= 0.3), {
      lod: 1,
      attr: { name: 'aSnow', of: (p, n) => [castleSky(p, n), 9] },
      dress: (m, name) => this.atmo.register(m, stoneLook({ ...(KIT_STONE[name] ?? {}), snow: this.snowU, attr: 'aSnow' }), `castle far kit ${name}`),
    }).catch(() => null);
    if (!kit) return;
    const hold = new THREE.Group();
    hold.applyMatrix4(this.group.matrixWorld);
    hold.add(...kit.meshes);
    hold.updateMatrixWorld(true);
    await this.o.ready?.(hold).catch(() => {});
    for (const b of [...this.farKit.children]) {
      this.farKit.remove(b);
      (b as THREE.Mesh).geometry.dispose();
    }
    this.farKit.add(...kit.meshes);
    this.farKit.updateMatrixWorld(true);
    this.counts.far = this.far.geometry.getAttribute('position').count / 3 + kit.triangles;
    this.counts.farDraws = 1 + kit.meshes.length;
  }

  /**
   * Whether an eye can see anything of the lower levels: it is in them (or in the passage out), or it is where it
   * can look down a hole in the terrace (the nearer the hole the lower the eye may be: from the keep's roof the
   * water is seen from thirty metres), or it is outside before the rent in the east wall or before the postern.
   */
  private seesUnder(eye: THREE.Vector3): boolean {
    const P = this.place;
    if (castleUnder(P, eye.x, eye.y, eye.z, this.o.ground, this.o.loose)) return true;
    const [x, z, y] = castleLocal(P, eye.x, eye.y, eye.z), U = UNDER, D = U.cistern.drop, B = U.bay, h = Math.max(1.7, y);
    /**
     * Down a hole in the terrace, which is a metre thick: a line of sight that comes to the hole's near edge from so
     * far off and so high goes down by its height in that distance, and must go down a metre while it is over the
     * hole. So the hole is seen into from no further than its width the way the eye looks, times the eye's height
     * (and a pace and a half for a head put forward, or an eye that looks along the hole's corner to corner).
     */
    const down = (x0: number, x1: number, z0: number, z1: number) => {
      const d = Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1)), ux = (x0 + x1) / 2 - x, uz = (z0 + z1) / 2 - z, l = Math.hypot(ux, uz) || 1;
      return d < 1.5 + Math.min((x1 - x0) / Math.max(1e-3, Math.abs(ux / l)), (z1 - z0) / Math.max(1e-3, Math.abs(uz / l))) * h;
    };
    if (y > -1.2) {
      if (down(D.x0, D.x1, D.z0, D.z1) || down(B.x0, B.x1, B.z0, B.z1) || down(U.stair.head, U.stair.open, U.stair.z - 0.5, U.stair.z + 0.5)) return true;
      if (U.gratings.some(([gx, gz]) => down(gx - 0.45, gx + 0.45, gz - 0.45, gz + 0.45))) return true;
    }
    // (the hollow tower: down its well, and through the door of its cellar)
    if (Math.hypot(x + CASTLE.hx, z + CASTLE.hz) < CASTLE.tower.r + 3) return true;
    if (x > U.x - 1 && Math.abs(z - (U.rent.z0 + U.rent.z1) / 2) < 2.5 + 0.8 * (x - U.x)) return true;
    return x < -U.x + 1 && Math.abs(z - (U.goat.z0 + U.goat.z1) / 2) < 2 + 0.7 * (-x - U.x);
  }

  /** Whether every picture sent for has come. */
  private come() {
    return this.kitHere && this.sets.every((t) => !t || (!!t.map.image && !!t.normalMap.image && !!t.armMap.image));
  }

  /** Its own shapes are made, got ready to be drawn, and put in the world. */
  private async build() {
    const k = this.skins!, mats = {} as Record<Sheet, THREE.Material>;
    this.skins = null;
    SHEETS.forEach((s, i) => {
      const t = this.sets[i];
      if (s === 'earth' && this.o.earth) return void (mats[s] = this.o.earth);
      if (s === 'water') return void (mats[s] = this.atmo.register(new THREE.MeshStandardMaterial({ color: 0x0c1418, roughness: 0.16, metalness: 0, envMapIntensity: 0, transparent: true, depthWrite: false }), still(this.time, this.place, this.day), 'castle water'));
      const m = new THREE.MeshStandardMaterial(t ? { map: t.map, normalMap: t.normalMap, roughnessMap: t.armMap, aoMap: t.armMap, roughness: 1, metalness: 0, vertexColors: true } : { color: 0x2a2826, roughness: 0.62, metalness: 0.6, vertexColors: true });
      mats[s] = this.atmo.register(m, both(stoneLook({ ...(t ? own(PICTURES[s]) : {}), snow: this.snowU, attr: 'aSnow', thin: s === 'timber' ? 0.3 : 0 }), underLight(this.day)), `castle ${s}`);
    });
    const cast: THREE.BufferGeometry[] = [];
    const stand = (to: THREE.Group, name: string, of: Record<Sheet, Packed>) => {
      for (const s of SHEETS) {
        if (!of[s].pos.length || (s === 'earth' && this.o.earth)) continue;
        const mesh = new THREE.Mesh(geometry(of[s]), mats[s]);
        mesh.name = `${name}:${s}`;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        to.add(mesh);
        // (iron throws no shadow: a cresset's bars and a rail's are thinner than one square of the sun's map)
        if (to === this.near && s !== 'iron') cast.push(mesh.geometry);
        this.counts.draws++;
      }
    };
    // (made a part at a time, between frames: see `breathe`)
    await breathe();
    stand(this.near, 'castle', k.near);
    await breathe();
    stand(this.under, 'castle under', k.under);
    this.under.add(this.shafts);
    // the kit's pieces, each material of them one thing to draw; the snow lies on them as on the rest (each corner is asked whether the sky is over it)
    const kit = await kitMeshes('fort_kit', castleKit(), {
      attr: { name: 'aSnow', of: (p, n) => [castleSky(p, n), 9] },
      dress: (m, name) => this.atmo.register(m, both(stoneLook({ ...(KIT_STONE[name] ?? {}), snow: this.snowU, attr: 'aSnow' }), underLight(this.day)), `castle kit ${name}`),
    });
    const door = await kitMeshes('large_castle_door', castleDoor(), { dress: (m, name) => this.atmo.register(m, undefined, `castle door ${name}`) });
    // scanned rock round the rock the ramp leaves from and under the walls: the far copy's few triangles, the model's own pictures
    const ground = this.o.ground, P = this.place;
    const rocks = await kitMeshes('rock_face_01', castleRocks(ground ? (x, z) => { const [wx, , wz] = castleAt(P, x, z); return (ground(wx, wz) - P.y) / CASTLE_SCALE; } : undefined, this.o.rock !== false), {
      shapes: 1,
      attr: { name: 'aSnow', of: () => [1, 9] },
      dress: (m, name) => this.atmo.register(m, stoneLook({ ...ROCK_STONE, snow: this.snowU, attr: 'aSnow' }), `castle rock ${name}`),
    });
    for (const mesh of [...kit.meshes, ...door.meshes, ...rocks.meshes]) {
      this.near.add(mesh);
      // (nor the door: it stands under the gatehouse, which shades it, and its fallen leaf lies flat on the paving)
      if (!door.meshes.includes(mesh)) cast.push(mesh.geometry);
      this.sharp.push(mesh.material as THREE.Material);
      this.counts.draws++;
    }
    this.counts.kit = kit.triangles + door.triangles + rocks.triangles;
    await breathe();
    // One shape for the sun's shadow maps, as the buildings have: a shadow map takes no notice of stuff, and six
    // things drawn again into each of three maps is eighteen where three will do.
    {
      const n = cast.reduce((t, g) => t + g.getAttribute('position').count, 0), pos = new Float32Array(n * 3);
      let at = 0;
      for (const g of cast) {
        pos.set(g.getAttribute('position').array as Float32Array, at);
        at += g.getAttribute('position').count * 3;
      }
      const shadow = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
      shadow.computeBoundingSphere();
      const caster = new THREE.Mesh(shadow, new THREE.MeshBasicMaterial({ shadowSide: THREE.DoubleSide }));
      caster.castShadow = true;
      caster.matrixAutoUpdate = false;
      caster.intersectsFrustum = (f) => SHADOW_FRUSTA.has(f);
      caster.name = 'castle shadow';
      this.near.add(caster);
    }
    // (got ready where it will stand, but not yet in the world: its first frame there then costs what any other does)
    const hold = new THREE.Group();
    hold.applyMatrix4(this.group.matrixWorld);
    hold.add(this.near, this.under);
    hold.updateMatrixWorld(true);
    this.near.visible = this.under.visible = true;
    await this.o.ready?.(hold).catch(() => {});
    this.near.visible = this.under.visible = false;
    this.group.add(this.near, this.under);
    this.group.updateMatrixWorld(true);
    if (this.o.fire) this.flames = this.fires.map((at) => Object.assign(this.o.fire!(at, CRESSET.size), { strength: 0 }));
    else {
      // (brighter than white: it is the one thing in a vault that is a light, and the glare round it comes of that)
      const shape = new THREE.ConeGeometry(0.05, 0.19, 7), paint = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.5, 0.38) });
      shape.translate(0, 0.02, 0);
      this.own = this.fires.map((at, k) => {
        const flame = new THREE.Mesh(shape, paint), low = k < LAMPS.length ? LAMPS[k][2] < -0.5 : true;
        flame.position.copy(this.group.worldToLocal(at.clone()));
        flame.visible = false;
        flame.name = 'castle:flame';
        (low ? this.under : this.near).add(flame);
        return flame;
      });
    }
    this.state = 'near';
  }

  private solid(s: Solid) {
    const P = this.place, R = physics.R, turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), P.rot);
    const at = (x: number, y: number, z: number) => { const [wx, wy, wz] = castleAt(P, x, z, y); return { x: wx, y: wy, z: wz }; };
    if (s.t === 'box') {
      physics.addStaticQuat(R.ColliderDesc.cuboid(s.h[0] * CASTLE_SCALE, s.h[1] * CASTLE_SCALE, s.h[2] * CASTLE_SCALE), s.surface, at(s.c[0], s.c[1], s.c[2]), turn.clone().multiply(new THREE.Quaternion(s.q[0], s.q[1], s.q[2], s.q[3])), undefined, s.feet ? GLASS_GROUPS : WORLD_GROUPS);
    } else if (s.t === 'hull') {
      const pts = new Float32Array(s.pts.length);
      for (let i = 0; i < s.pts.length; i += 3) {
        const w = at(s.pts[i], s.pts[i + 1], s.pts[i + 2]);
        pts.set([w.x, w.y, w.z], i);
      }
      const desc = R.ColliderDesc.convexHull(pts);
      if (desc) physics.addStaticQuat(desc, s.surface, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, undefined, s.feet ? GLASS_GROUPS : WORLD_GROUPS);
    } else {
      // (ground, given as the ground itself is: so that the legs' rule for steep ground holds on it, as on any hillside)
      const W = s.nx + 1, hcm = new Float32Array(W * (s.nz + 1));
      for (let ix = 0; ix <= s.nx; ix++) for (let iz = 0; iz <= s.nz; iz++) hcm[iz + ix * (s.nz + 1)] = s.heights[iz * W + ix];
      physics.addStatic(R.ColliderDesc.heightfield(s.nz, s.nx, hcm, { x: s.nx * s.cell * CASTLE_SCALE, y: CASTLE_SCALE, z: s.nz * s.cell * CASTLE_SCALE }), s.surface, at(s.x0 + (s.nx * s.cell) / 2, 0, s.z0 + (s.nz * s.cell) / 2), P.rot);
    }
  }

  /**
   * Each frame: which shapes of it are drawn, and its fires.
   * @param night how dark it is, 0 by day to 1 at night
   * @param lit told of each fire that is alight now, and how brightly (0..1); the post's lamps say their colour and reach as well, a fire leaves them to the caller (CRESSET)
   */
  update(dt: number, eye: THREE.Vector3, night: number, lit: (pos: THREE.Vector3, burn: number, colour?: THREE.Color, reach?: number) => void) {
    this.post.update(dt, eye, night, lit);
    const P = this.place, off = Math.hypot(eye.x - P.x, eye.z - P.z);
    // (somebody is near and it is not all made yet: it is made now, one long frame of it, which is better than a body through its floor)
    if (this.making && off < MADE_BY) this.finish();
    if (this.state === 'far' && off < ASK) this.ask();
    if (this.state === 'asked' && this.skins && this.come()) void this.build();
    const near = this.state === 'near' && off < NEAR;
    this.near.visible = near;
    if (!this.farAsked && off < FAR_KIT) void this.askFar();
    this.far.visible = this.farKit.visible = !near;
    const under = near && off < UNDER_SEEN && this.seesUnder(eye);
    this.under.visible = under;
    this.clock += dt;
    this.time.value = this.clock;
    // the day under the terrace: where the sun is by the fort's own measure, what of it comes down a hole (all of
    // it that the eye's cover has put out: what the cover leaves is the sun's own, shadows and all), and how much the
    // sky's light is to be turned up again on stone that knows its own cover
    // (the eye's cover is kept under the fort's own name by a page that has only the fort, and with the bunker's under `ground` by the game)
    const cover = this.atmo.cover.castle ?? this.atmo.cover.ground, sun = this.atmo.sunDir, cs = Math.cos(P.rot), sn = Math.sin(P.rot), D = this.day;
    D.sunW.value.copy(sun);
    D.sunL.value.set(sun.x * cs - sun.z * sn, sun.y, sun.x * sn + sun.z * cs);
    D.sun.value.copy(this.atmo.sunTint).multiplyScalar(this.atmo.sunIntensity * this.atmo.daylight.value * (1 - (cover?.sun ?? 1)));
    D.eye.value = 1 / Math.max(0.005, cover?.sky ?? 1);
    D.sky.value = this.atmo.daylight.value;
    // (the shafts of day are as bright as the day is, lean as the sun does, and are gone when it is low)
    const up = D.sunL.value.y, kx = up > 0.2 ? D.sunL.value.x / up : 0, kz = up > 0.2 ? D.sunL.value.z / up : 0, from = -0.5;
    (this.shafts.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - night * 1.6) * Math.min(1, Math.max(0, (up - 0.25) / 0.2));
    this.shafts.matrix.set(1, kx, 0, -kx * from, 0, 1, 0, 0, 0, kz, 1, -kz * from, 0, 0, 0, 1);
    this.shafts.matrixWorldNeedsUpdate = true;
    // (its fires are lit as the light goes; and those under the terrace burn by day as well: it is always night there)
    const dusk = Math.min(1, Math.max(0, (night - 0.3) / 0.3));
    this.fires.forEach((pos, k) => {
      // (and those are not lit for an eye that cannot see into the place: a light costs every stone it reaches)
      const low = pos.y < P.y - 0.5, burn = near ? (low ? (under ? 1 : 0) : dusk) : 0;
      if (this.flames[k]) this.flames[k].strength = burn;
      if (this.own[k]) {
        this.own[k].visible = burn > 0.02;
        this.own[k].scale.set(0.8 + 0.2 * burn, (0.75 + 0.35 * Math.sin(this.clock * 11 + k * 1.7) ** 2) * burn, 0.8 + 0.2 * burn);
      }
      // (under a vault a fire is a pace from the stone it lights: it is told at little more than half, or the stone by it is white)
      if (burn > 0 && off < 90) lit(pos, burn * (low ? 0.5 : 1) * (0.8 + 0.2 * Math.sin(this.clock * 9 + k * 2.1)));
    });
  }
}
