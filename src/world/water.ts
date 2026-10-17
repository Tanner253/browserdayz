// Lakes and rivers, drawn (the owner, 2026-10-16: "i want lakes and rivers as well in natural spots in the map since we
// now have water"). Where they are and how deep is src/sim/water.ts, from the world's `water`; this only draws them.
//
//   const water = new Waterways(scene, atmo, world.water, groundAt, { seaLevel });   // after atmo.init, while loading
//   water.update(dt, camera.position, camera);                                        // each frame
//   water.reach = drawDistance;
//
// A lake is the sea's own surface (src/world/ocean.ts) over the lake's box, in a calmer look (LAKE): coloured by the
// depth of the ground under it, small waves lapping its shore, and nothing past its outline. A river is a ribbon laid
// along its middle line at its water's height, in pieces of RIVER.piece metres (each out of view or out of reach is
// not drawn), a little wider than its water so that its edge is where the bank comes up through it. On it: ripples
// carried downstream at the river's own pace (faster where it falls), foam along its banks and white water where it
// falls in steps, the sky and the sun on it, the haze over it; and where it runs into a lake or the sea it thins away
// into that water, so that the two meet without a seam.

import * as THREE from 'three';
import type { Atmosphere } from './atmosphere';
import { Ocean, ROOMS_GLSL, roomsFor, sharedWaves, skyOf, type OceanLook } from './ocean';
import { WADE, inside, type River, type WaterRoom, type Waters } from '../sim/water';

/** A lake's look: calmer water than the sea's, greener and murkier, waves only lapping at its edge. */
export const LAKE: Partial<OceanLook> = {
  layers: [
    [9, 0, 0.5, 1],
    [3.1, 0.7, 0.3, 0.6],
    [31, -0.4, 0.9, 0.5],
  ],
  slope: 0.14,
  shallow: [0.06, 0.15, 0.11],
  deep: [0.008, 0.03, 0.03],
  murk: 0.42,
  foamDepth: 0.3,
  surf: { apart: 2.6, pace: 0.45, steep: 0.035, reach: 9, breaks: 4 },
  solid: 6,
  dim: 0.35,
  wash: 1.6,
  shallowFoam: 0.02,
  wet: 0.25,
};

/**
 * A swamp's look. The investor, 2026-10-16, of the lake test over a village's meadow: "a swamp area would be cool", and
 * of that picture: "the image attached is really good vibe for what a swamp might look like". So it is that lake's
 * look (its small waves, its foam lines at the water's edge and round what stands in it) made murkier and browner,
 * stiller, with duckweed drifting and gathering at the walls; the meadow's own grass stands up through it, and a low
 * mist lies over it at dusk and dawn (SWAMP_MIST).
 */
export const SWAMP: Partial<OceanLook> = {
  ...LAKE,
  slope: 0.09,
  shallow: [0.075, 0.08, 0.04],
  deep: [0.02, 0.028, 0.014],
  murk: 0.75,
  weed: 0.35,
  // (its scum a thin broken line round what stands out of it, brown and green: white, from 25 m up a swamp's many
  // shallow edges were sheets of it, snow (the polish survey, 2026-10-16))
  foam: 0.55,
  wash: 0.8,
  shallowFoam: 0,
  wet: 0.12,
  foamTint: [0.42, 0.4, 0.29],
  dim: 0.45,
};

/** The mist on a swamp: its sheets' heights over the water and how thick each is, at its thickest (dusk and dawn). */
export const SWAMP_MIST = { sheets: [0.25, 0.7, 1.3], thick: [0.55, 0.4, 0.22], day: 0.1 };

/** A river's look and how it is laid. */
export const RIVER = {
  /** metres between the points it is laid through along its way, and how many across it */
  step: 3,
  across: 9,
  /** metres either side past its water's edge that the ribbon reaches (under the bank, where the ground hides it) */
  margin: 3,
  /** metres of river to a piece: a piece is drawn or not as a whole */
  piece: 150,
  /** metres over which it thins away into a lake or the sea it runs into */
  fade: 28,
  shallow: [0.07, 0.13, 0.09] as [number, number, number],
  deep: [0.012, 0.035, 0.03] as [number, number, number],
  murk: 0.55,
  /** the steepest its ripples are, and how much steeper where it falls */
  slope: 0.2,
  /** a fall of this share (metres in a metre) and more is white water */
  white: 0.09,
};

export class Waterways {
  readonly group = new THREE.Group();
  readonly lakes: Ocean[] = [];
  private pieces: { mesh: THREE.Mesh; c: THREE.Vector3; r: number }[] = [];
  private mists: THREE.ShaderMaterial[] = [];
  private material: THREE.ShaderMaterial;
  private time = 0;
  private reachNow = Infinity;

  constructor(
    scene: THREE.Scene,
    private atmo: Atmosphere,
    waters: Waters,
    ground: (x: number, z: number) => number,
    o: { seaLevel?: number } = {},
  ) {
    for (const lake of waters.lakes) {
      const xs = lake.outline.map((p) => p[0]), zs = lake.outline.map((p) => p[1]);
      this.lakes.push(
        new Ocean(scene, atmo, {
          seaLevel: lake.level,
          x0: Math.min(...xs) - 6, x1: Math.max(...xs) + 6, z0: Math.min(...zs) - 6, z1: Math.max(...zs) + 6,
          tile: 128,
          cell: 2,
          depthAt: (x, z) => (inside(lake.outline, x, z) ? lake.level - ground(x, z) : -1),
          look: { ...(lake.swamp ? SWAMP : LAKE), cut: true },
          rooms: waters.rooms,
        }),
      );
      if (lake.swamp) this.mistOver(scene, lake.level, Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), waters.rooms);
    }
    const fog = scene.fog as THREE.FogExp2 | null, w = sharedWaves();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uWaves: { value: w.tex },
        uTime: { value: 0 },
        uSunDir: { value: atmo.sunDir },
        uSun: { value: new THREE.Color() },
        uSky: { value: 1 },
        envMap: { value: null },
        fogColor: { value: fog ? fog.color : new THREE.Color() },
        fogDensity: atmo.seconds,
      },
      defines: fog ? { USE_FOG: '', FOG_EXP2: '' } : {},
      vertexShader: RIVER_VERTEX,
      fragmentShader: riverFragment(w.slope),
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: true,
      fog: false,
      // (a hair nearer the eye than the lake or the sea it runs into, where the two lie at one height)
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    skyOf(atmo, this.material);
    const into = (x: number, z: number, y: number) =>
      (o.seaLevel !== undefined && y <= o.seaLevel + 0.3) || waters.lakes.some((l) => Math.abs(l.level - y) < 0.4 && inside(l.outline, x, z));
    for (const river of waters.rivers) for (const piece of riverPieces(river, ground, into)) {
      const mesh = new THREE.Mesh(piece, this.material);
      mesh.name = `river ${river.name ?? ''}`;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      piece.computeBoundingSphere();
      this.pieces.push({ mesh, c: piece.boundingSphere!.center, r: piece.boundingSphere!.radius });
    }
    this.group.name = 'rivers';
    scene.add(this.group);
  }

  /**
   * Mist over a swamp: sheets of it a little over the water, drifting, thickest at dusk and dawn, thinning toward the
   * swamp's edge and away from an eye that is in it (it is seen as a haze, never as a sheet). Each sheet is one square.
   */
  private mistOver(scene: THREE.Scene, level: number, x0: number, x1: number, z0: number, z1: number, rooms?: WaterRoom[]) {
    const fog = scene.fog as THREE.FogExp2 | null, inRooms = roomsFor(rooms, { x0, x1, z0, z1 }, level);
    const mist = new THREE.ShaderMaterial({
      defines: inRooms.defines,
      uniforms: { ...inRooms.uniforms, uWaves: { value: sharedWaves().tex }, uTime: { value: 0 }, uMist: { value: 0 }, uBox: { value: new THREE.Vector4() }, fogColor: { value: fog ? fog.color : new THREE.Color(0.6, 0.65, 0.7) } },
      vertexShader: /* glsl */ `
        attribute float aThick;
        varying vec3 vP;
        varying float vThick;
        void main() {
          vP = position;
          vThick = aThick;
          gl_Position = projectionMatrix * viewMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uWaves;
        uniform float uTime;
        uniform float uMist;
        uniform vec4 uBox;
        uniform vec3 fogColor;
        varying vec3 vP;
        varying float vThick;
        ${ROOMS_GLSL}
        void main() {
          vec2 p = vP.xz;
          // (none in a room: a room's air is its own)
          #ifdef SEA_ROOMS
            for ( int i = 0; i < SEA_ROOMS; i++ ) if ( fromRoom( i, p ) < 0.0 ) discard;
          #endif
          float n = texture2D( uWaves, p * 0.006 + vec2( uTime * 0.0035, uTime * 0.002 ) ).b * 0.6 + texture2D( uWaves, p * 0.019 - vec2( uTime * 0.006, 0.0 ) ).b * 0.4;
          float edge = smoothstep( 0.0, 30.0, min( min( p.x - uBox.x, uBox.z - p.x ), min( p.y - uBox.y, uBox.w - p.y ) ) );
          float a = uMist * vThick * smoothstep( 0.3, 0.75, n ) * edge * smoothstep( 1.5, 9.0, distance( cameraPosition, vP ) );
          gl_FragColor = vec4( fogColor * 1.15 * a, a );
        }`,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      fog: false,
    });
    const quads: number[] = [], thick: number[] = [];
    SWAMP_MIST.sheets.forEach((h, i) => {
      const y = level + h;
      for (const [x, z] of [[x0, z0], [x0, z1], [x1, z0], [x1, z0], [x0, z1], [x1, z1]]) {
        quads.push(x, y, z);
        thick.push(SWAMP_MIST.thick[i]);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(quads, 3));
    g.setAttribute('aThick', new THREE.Float32BufferAttribute(thick, 1));
    g.computeBoundingSphere();
    mist.uniforms.uBox.value.set(x0, z0, x1, z1);
    this.mists.push(mist);
    const mesh = new THREE.Mesh(g, mist);
    mesh.name = 'swamp mist';
    mesh.matrixAutoUpdate = false;
    // (after the water it lies over)
    mesh.renderOrder = 2;
    this.group.add(mesh);
    this.pieces.push({ mesh, c: g.boundingSphere!.center, r: g.boundingSphere!.radius });
  }

  /** tiles and pieces further than this from the eye are not drawn: the draw distance */
  get reach() {
    return this.reachNow;
  }
  set reach(m: number) {
    this.reachNow = m;
    for (const l of this.lakes) l.reach = m;
  }

  update(dt: number, eye: THREE.Vector3, camera?: THREE.Camera) {
    this.time += dt;
    for (const l of this.lakes) l.update(dt, eye, camera);
    const u = this.material.uniforms;
    u.uTime.value = this.time % 3600;
    u.uSun.value.copy(this.atmo.sunTint).multiplyScalar(this.atmo.sunNow);
    u.uSky.value = this.atmo.skyNow;
    if (!u.envMap.value) skyOf(this.atmo, this.material);
    // (a swamp's mist is thickest as the light comes and goes: night is 0 by day, 1 at night, between at dusk and dawn)
    const n = Math.min(1, Math.max(0, this.atmo.night)), thick = SWAMP_MIST.day + (1 - SWAMP_MIST.day) * Math.pow(Math.sin(Math.PI * Math.min(1, n * 1.25)), 0.7);
    for (const m of this.mists) {
      m.uniforms.uTime.value = this.time % 3600;
      m.uniforms.uMist.value = thick;
    }
    for (const p of this.pieces) p.mesh.visible = p.c.distanceTo(eye) - p.r < this.reachNow;
  }

  dispose() {
    for (const l of this.lakes) l.dispose();
    this.group.removeFromParent();
    for (const p of this.pieces) p.mesh.geometry.dispose();
    this.material.dispose();
    for (const m of this.mists) m.dispose();
  }
}

/**
 * A river laid as ribbons, a piece every RIVER.piece metres: its middle line taken smoothly through its points (its
 * height and width straight between them, so that a step stays a step), points every RIVER.step metres along and
 * RIVER.across across. Each point knows how deep the water is over the ground there, which way and how fast it runs,
 * how white it is (by how steeply it falls just above), and how much of it is drawn (thinning into the water it runs
 * into).
 */
export function riverPieces(river: River, ground: (x: number, z: number) => number, into: (x: number, z: number, y: number) => boolean): THREE.BufferGeometry[] {
  const P = river.pts;
  if (P.length < 2) return [];
  // the line taken smoothly through its points (Catmull-Rom on the ground's plane), sampled every RIVER.step metres
  const at = (k: number, t: number) => {
    const p0 = P[Math.max(0, k - 1)], p1 = P[k], p2 = P[k + 1], p3 = P[Math.min(P.length - 1, k + 2)];
    const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
    return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]), p1[2] + (p2[2] - p1[2]) * t, p1[3] + (p2[3] - p1[3]) * t];
  };
  const line: number[][] = [];
  for (let k = 0; k + 1 < P.length; k++) {
    const n = Math.max(1, Math.round(Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]) / RIVER.step));
    for (let s = 0; s < n; s++) line.push(at(k, s / n));
  }
  line.push([...P[P.length - 1]]);
  // along it: how far, which way, how steeply it falls, how white, how much of it is drawn
  const along = [0];
  for (let i = 1; i < line.length; i++) along.push(along[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = along[along.length - 1];
  const fadeStart = into(line[0][0], line[0][1], line[0][2]), fadeEnd = into(line[line.length - 1][0], line[line.length - 1][1], line[line.length - 1][2]);
  const N = line.length, way: [number, number][] = [], fall: number[] = [], white: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(N - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    way.push([dx / len, dz / len]);
    fall.push(Math.max(0, a[2] - b[2]) / len);
  }
  // (white below a fall as well as on it: carried on downstream, dying away over some fifteen metres)
  for (let i = 0, carried = 0; i < N; i++) {
    const here = Math.min(1, Math.max(0, (fall[i] - RIVER.white * 0.4) / (RIVER.white * 0.6)));
    carried = Math.max(here, carried * Math.exp(-(i ? along[i] - along[i - 1] : 0) / 15));
    white.push(carried);
  }
  // the pieces: each its points' rows, sharing its first row with the last of the one before
  const out: THREE.BufferGeometry[] = [], A = RIVER.across, per = Math.max(2, Math.round(RIVER.piece / RIVER.step));
  for (let i0 = 0; i0 < N - 1; i0 += per) {
    const i1 = Math.min(N - 1, i0 + per), rows = i1 - i0 + 1;
    const pos = new Float32Array(rows * A * 3), uv = new Float32Array(rows * A * 2), flow = new Float32Array(rows * A * 3), water = new Float32Array(rows * A * 4);
    for (let r = 0; r < rows; r++) {
      const i = i0 + r, [cx, cz, y, width] = line[i], [wx, wz] = way[i], half = width / 2 + RIVER.margin;
      const speed = Math.min(WADE.fastest, WADE.pace[0] + WADE.pace[1] * fall[i] * 100);
      // (into a lake or the sea it thins away over RIVER.fade; an end that runs into nothing, a spring, over a few metres)
      const shown = Math.min(1, along[i] / (fadeStart ? RIVER.fade : 6), (total - along[i]) / (fadeEnd ? RIVER.fade : 6));
      for (let k = 0; k < A; k++) {
        const u = -1 + (2 * k) / (A - 1), x = cx - wz * u * half, z = cz + wx * u * half, o = r * A + k;
        pos.set([x, y, z], o * 3);
        uv.set([u * (half / (width / 2)), along[i]], o * 2);
        flow.set([wx, wz, speed], o * 3);
        water.set([y - ground(x, z), white[i], shown, width], o * 4);
      }
    }
    const index: number[] = [];
    for (let r = 0; r + 1 < rows; r++) for (let k = 0; k + 1 < A; k++) {
      // (counter-clockwise seen from above: the ribbon is drawn from above only)
      const a = r * A + k, b = a + 1, c = a + A, d = c + 1;
      index.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aFlow', new THREE.BufferAttribute(flow, 3));
    g.setAttribute('aWater', new THREE.BufferAttribute(water, 4));
    g.setIndex(index);
    out.push(g);
  }
  return out;
}

const RIVER_VERTEX = /* glsl */ `
  #include <fog_pars_vertex>
  attribute vec3 aFlow;
  attribute vec4 aWater;
  varying vec3 vRiver;
  varying vec2 vUv;
  varying vec3 vFlow;
  varying vec4 vWater;
  void main() {
    vRiver = position;
    vUv = uv;
    vFlow = aFlow;
    vWater = aWater;
    #ifdef USE_FOG
      vFogWorldPos = position;
    #endif
    gl_Position = projectionMatrix * viewMatrix * vec4( position, 1.0 );
  }`;

const v3 = (v: [number, number, number]) => `vec3(${v.map((n) => n.toFixed(5)).join(', ')})`;

/** @param most the slope the wave picture's 127 stands for */
function riverFragment(most: number) {
  return /* glsl */ `
  uniform sampler2D uWaves;
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSun;
  uniform float uSky;
  varying vec3 vRiver;
  varying vec2 vUv;
  varying vec3 vFlow;
  varying vec4 vWater;
  #ifdef SEA_SKY
    uniform sampler2D envMap;
    #include <cube_uv_reflection_fragment>
  #endif
  #include <fog_pars_fragment>
  #ifndef USE_FOG
    uniform vec3 fogColor;
  #endif

  void main() {
    vec3 toEye = cameraPosition - vRiver;
    float dist = length( toEye );
    vec3 V = toEye / max( dist, 1e-4 );
    float distant = smoothstep( 30.0, 600.0, dist );
    float depth = vWater.x, white = vWater.y, shown = vWater.z, width = vWater.w;
    vec2 way = normalize( vFlow.xy ), side = vec2( -way.y, way.x );
    float pace = vFlow.z;
    // where on it, in metres: across it and along it
    vec2 q = vec2( vUv.x * width * 0.5, vUv.y );

    // ripples carried downstream at its pace, two sizes, one a little faster; rougher where it falls
    vec4 r1 = texture2D( uWaves, vec2( q.x, q.y - pace * uTime ) / 5.5 );
    vec4 r2 = texture2D( uWaves, vec2( q.x * 1.3 + 0.37, q.y - pace * 1.35 * uTime ) / 2.1 );
    vec2 s = ( ( r1.rg * 2.0 - 1.0 ) * 0.6 + ( r2.rg * 2.0 - 1.0 ) * 0.4 * ( 1.0 - 0.7 * distant ) ) * ${(RIVER.slope / most).toFixed(6)};
    s *= ( 0.5 + 0.5 * smoothstep( 0.0, 1.2, depth ) ) * ( 1.0 + 1.6 * white );
    vec2 sw = s.x * side + s.y * way;
    vec3 N = normalize( vec3( -sw.x, 1.0, -sw.y ) );

    float NdV = max( dot( N, V ), 0.0 );
    float F = 0.02 + 0.98 * pow( 1.0 - NdV, 5.0 );
    vec3 R = reflect( -V, N );
    R.y = abs( R.y );
    #ifdef SEA_SKY
      vec3 sky = textureCubeUV( envMap, R, 0.12 + 0.3 * distant ).rgb * uSky;
    #else
      vec3 sky = fogColor * mix( 1.0, 0.75, R.y );
    #endif
    // (low down, what a river shows is its banks, not the sky: they are not in the sky's picture, so its low sky is dimmed)
    sky *= 0.35 + 0.65 * smoothstep( 0.0, 0.6, R.y );
    float tight = mix( 1100.0, 90.0, distant );
    float glint = pow( max( dot( R, uSunDir ), 0.0 ), tight ) * ( tight + 2.0 ) * 0.159;
    vec3 spec = uSun * min( glint * F, 12.0 ) * step( 0.0, uSunDir.y );

    // the water itself: brown-green in the shallows, dark where deep, lit by the hour
    vec3 tint = mix( ${v3(RIVER.shallow)}, ${v3(RIVER.deep)}, 1.0 - exp( -max( depth, 0.0 ) * 0.5 ) );
    vec3 body = tint * ( fogColor * 0.9 + uSun * max( uSunDir.y, 0.0 ) * 0.12 );
    float murk = 1.0 - exp( -max( depth, 0.0 ) / max( V.y, 0.06 ) * ${RIVER.murk.toFixed(3)} );

    // foam: along the banks where it runs shallow over the stones, and white where it falls, carried downstream
    float net = texture2D( uWaves, vec2( q.x, q.y - pace * 1.1 * uTime ) / 1.7 ).a * 0.6 + r1.a * 0.4;
    float bank = 1.0 - smoothstep( 0.0, 0.22, depth );
    // (white water in streaks along the way it runs, not a sheet: the net drawn out downstream)
    float streak = texture2D( uWaves, vec2( q.x * 0.9, ( q.y - pace * 1.6 * uTime ) * 0.22 ) / 1.7 ).a;
    float cover = bank * 0.65 + white * ( 0.2 + 0.5 * streak );
    float foam = smoothstep( 1.0 - cover, 1.2 - cover, net ) * sqrt( cover ) * 0.85 * smoothstep( -0.05, 0.04, depth ) * ( 1.0 - 0.5 * distant );
    vec3 froth = vec3( 0.74, 0.77, 0.76 ) * ( fogColor * 1.1 + uSun * max( uSunDir.y, 0.0 ) * 0.4 );

    vec3 col = F * sky + spec + ( 1.0 - F ) * murk * body;
    float a = F + ( 1.0 - F ) * murk;
    col = mix( col, froth, foam );
    a = mix( a, 1.0, foam );
    // (thinning away into the lake or the sea it runs into; and nothing where the bank is over it)
    col *= shown;
    a *= shown;
    if ( depth < -0.3 ) discard;

    #ifdef USE_FOG
      vec3 rd = -V;
      float fogAmt = atmoFogAmount( cameraPosition, rd, dist );
      col = col * ( 1.0 - fogAmt ) + atmoFogColor( rd ) * fogAmt * a;
      #ifdef GAS_ZONE
        vec3 gasIs = gasAmount( cameraPosition, rd, dist );
        col = col * ( 1.0 - gasIs.x ) + gasColor( rd, gasIs.y, gasIs.z ) * gasIs.x * a;
      #endif
    #endif
    gl_FragColor = vec4( clamp( col, 0.0, 32.0 ), clamp( a, 0.0, 1.0 ) );
    if ( any( isnan( gl_FragColor ) ) ) gl_FragColor = vec4( 0.0 );
    #include <colorspace_fragment>
  }`;
}
