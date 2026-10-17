// THE SEA off the west coast (2026-10-16: "from west to east itll be ocean, beach, desert, plains, mountains"). Not yet
// laid in the world: the world says where the sea is and how deep (`depthAt`), this draws it.
//
//   const sea = new Ocean(scene, atmo, { seaLevel, x0, x1, z0, z1, depthAt });   // after atmo.init, while loading
//   sea.update(dt, camera.position, camera);                                       // each frame
//   sea.reach = drawDistance;                                                      // tiles further off are not drawn
//
// What it is: a flat surface at the sea level, laid in tiles of TILE metres (two triangles each), so that a tile out
// of the view or out of reach is not drawn at all, and what is behind a hill is stopped by the hill before its shader
// runs (the shallows are drawn after everything solid, see-through; deep water solid and first, so that the sea
// floor under it is never painted: OCEAN.solid). Its shader, per point of the screen:
//   waves   three layers of one picture of a wind sea (src/world/ocean-waves.ts), each its own size, way and pace;
//           the shallows calmer, and the finest layer let go with distance (it is a shimmer there, not waves)
//   sky     the sky's own light reflected (the same light everything else is lit by: the scene's environment), more
//           of it the flatter the eye looks across the water, as a real sea is (Fresnel)
//   sun     the glint, sharp near and spread far off (from far, many small glints are one wide one), as bright as the
//           hour's sun: the moon's at night
//   depth   the water is clear: over a sand bar the sand is seen, a little drowned in sea-green; deep water is dark
//           blue-green, and is seen into less the flatter it is looked across. (The ground under it is the ground,
//           drawn: the sea is laid over it, see-through by how much water there is in the way.)
//   foam    at the water's edge, rolling in in lines toward the beach, broken into a net; a few caps out to sea
//   air     the game's own haze and gas over it (src/world/atmosphere.ts), as over everything else
//
//   surf    breakers rolling in to the beach, parallel to it wherever it runs (laid along each point's distance from
//           the water's edge, ocean-waves.ts shoreField): their faces catch the light, the low sun shows green through
//           them, they break white near the shore, and the wash runs up the sand as each one comes in
//
// It is only to be looked at (the owner, 2026-10-16: "we want pretty water, no need to go into it or swim can put
// barrier on beach"; the sea's depth in play is for an ocean update later). So NOT DONE, on purpose: wading,
// swimming, boats, the view from under it (it is drawn from above only). Nor: waves that move the surface itself (no
// swell on the skyline), the bend of what is seen through the water, shadows on it, lamps lighting it.

import * as THREE from 'three';
import type { Atmosphere } from './atmosphere';
import { depthGrid, oceanTiles, shallowestIn, shoreField, waveMap, type Rect } from './ocean-waves';
import type { WaterRoom } from '../sim/water';

export interface OceanOptions extends Rect {
  /** the height of the water's surface */
  seaLevel: number;
  /** how deep the water is at a point: the sea level less the ground's height there (below 0 on land) */
  depthAt: (x: number, z: number) => number;
  /** metres a side of a tile (TILE) */
  tile?: number;
  /** metres between the points the depth is read at (4: the sea's colour is soft; a wider sea is read more coarsely) */
  cell?: number;
  /** of the picture the waves are drawn from: how much the card filters it at a slant (8) */
  anisotropy?: number;
  /**
   * Metres to carry the sea on past the rectangle's sides, as open deep water, so that from a hill the sea runs to the
   * skyline and has no far edge (from 60 m up, 2.5 km of it had an edge the haze did not hide). Laid in tiles of
   * BEYOND_TILE, always solid; its colour is the rectangle's edge's, carried on. The rectangle itself stays as narrow
   * as the coast needs: its depths are read finely. Only open-sea sides: what is beyond is drawn over nothing.
   */
  beyond?: { west?: number; east?: number; north?: number; south?: number };
  /** another look than the sea's (a lake: LAKE in src/world/water.ts), and `cut`: no water where `depthAt` is under -0.4 */
  look?: Partial<OceanLook> & { cut?: boolean };
  /** the buildings and rooms standing in it (see WaterRoom): none drawn in a dry one, still and dark under a roof */
  rooms?: WaterRoom[];
}

/** the most rooms one water takes (a flooded hamlet's buildings, a room or a few each): the nearest to its middle */
export const MOST_ROOMS = 32;

/** A water's rooms within its box, as its shaders take them: their uniforms, and the define that turns them on. */
export function roomsFor(rooms: WaterRoom[] | undefined, r: Rect) {
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const near = (rooms ?? [])
    .filter((q) => {
      const reach = Math.hypot(q.hx, q.hz);
      return q.x + reach > r.x0 && q.x - reach < r.x1 && q.z + reach > r.z0 && q.z - reach < r.z1;
    })
    .sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))
    .slice(0, MOST_ROOMS);
  return {
    defines: near.length ? { SEA_ROOMS: String(near.length) } : {},
    uniforms: {
      uRoomA: { value: near.map((q) => new THREE.Vector4(q.x, q.z, Math.cos(q.rot), Math.sin(q.rot))) },
      uRoomB: { value: near.map((q) => new THREE.Vector4(q.hx, q.hz, q.dry ? 1 : 0, 0)) },
    },
  };
}

/** The rooms in a shader: how far outside room i's walls a point is (under 0 inside), as fromRoom in src/sim/water.ts. */
export const ROOMS_GLSL = /* glsl */ `
  #ifdef SEA_ROOMS
    uniform vec4 uRoomA[ SEA_ROOMS ];
    uniform vec4 uRoomB[ SEA_ROOMS ];
    float fromRoom( int i, vec2 p ) {
      vec2 d = p - uRoomA[ i ].xy;
      vec2 q = abs( vec2( d.x * uRoomA[ i ].z - d.y * uRoomA[ i ].w, d.x * uRoomA[ i ].w + d.y * uRoomA[ i ].z ) ) - uRoomB[ i ].xy;
      return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 );
    }
  #endif`;

/** metres a side of the tiles of open sea past the rectangle (few: what is drawn of them is a strip at the skyline) */
export const BEYOND_TILE = 2048;

/** metres a side of a tile: big enough to be few, small enough that what is out of view is mostly left out */
export const TILE = 256;

/** The sea's look, in one place. */
export const OCEAN = {
  /** the way the wind blows (+x is east, toward the land: waves come in from the open sea) */
  wind: [1, 0.18] as [number, number],
  /** the three layers of waves: metres to a repeat of the picture, how far round from the wind (radians), metres a second, how much of it */
  layers: [
    [23, 0, 1.6, 1],
    [7.3, 0.62, 0.9, 0.6],
    [97, -0.35, 3.2, 0.8],
  ] as [number, number, number, number][],
  /** the steepest slope of the sea, all three layers at their highest together */
  slope: 0.42,
  /** what the water is coloured as it is seen into: in the shallows and in deep water (as light, before the hour's light on it) */
  shallow: [0.07, 0.22, 0.2] as [number, number, number],
  deep: [0.004, 0.026, 0.06] as [number, number, number],
  /** how quickly the water hides what is under it, per metre looked through */
  murk: 0.3,
  /** foam: down to how deep at the water's edge */
  foamDepth: 1.6,
  /**
   * The breakers: metres between them, metres a second they come in at, how steep their faces are, how far out from
   * the water's edge they are seen, and where they break (metres from the edge): as a wind sea comes onto a beach.
   */
  surf: { apart: 11, pace: 2.4, steep: 0.16, reach: 90, breaks: 38 },
  /**
   * A tile all of whose water is deeper than this is drawn solid and before the ground: nothing of the sea floor shows
   * through that much water (looked straight down, 99 parts in 100 of it are hidden), and the floor under it is then
   * never painted. Filling half the picture with water costs as much whatever the water's shader does (measured
   * 2026-10-16: a shader of one flat colour cost the same as the whole sea), so this is where the cost is saved.
   */
  solid: 15,
  /** duckweed and scum on still water, in patches and thickest by the edges (a swamp's: 0 on the sea) */
  weed: 0,
  /** how much of the foam there is (a swamp has next to none), and how much the low sky in it is dimmed (what still water in a wood shows low down is its banks, not the sky: they are not in the sky's picture) */
  foam: 1,
  dim: 0,
};

export type OceanLook = typeof OCEAN;

let waves: { tex: THREE.DataTexture; slope: number } | null = null;
/** The picture every water's waves are drawn from: made once (some 25 ms), the sea, lakes and rivers all reading it. */
export function sharedWaves(anisotropy = 8) {
  if (waves) return waves;
  const w = waveMap(), tex = new THREE.DataTexture(w.data, w.res, w.res, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return (waves = { tex, slope: w.slope });
}

/**
 * Gives water materials the sky's own light to reflect, once the atmosphere has made it (in Atmosphere.init: water made
 * before it waits for it): its picture, and what three works out for its own materials from the same picture
 * (WebGLProgram generateCubeUVSize). The materials share one `envMap` uniform. Says whether it was done.
 */
export function skyOf(atmo: Atmosphere, ...mats: THREE.ShaderMaterial[]) {
  const env = atmo.envMap as THREE.Texture | undefined;
  if (!env || mats[0].uniforms.envMap.value === env) return !!env;
  const h = (env.image as { height: number }).height, maxMip = Math.log2(h) - 2;
  mats[0].uniforms.envMap.value = env;
  for (const m of mats) {
    Object.assign(m.defines, {
      SEA_SKY: '',
      ENVMAP_TYPE_CUBE_UV: '',
      CUBEUV_TEXEL_WIDTH: (1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16))).toFixed(10),
      CUBEUV_TEXEL_HEIGHT: (1 / h).toFixed(10),
      CUBEUV_MAX_MIP: maxMip.toFixed(1),
    });
    m.needsUpdate = true;
  }
  return true;
}

const vec3 = (v: [number, number, number]) => `vec3(${v.map((n) => n.toFixed(5)).join(', ')})`;

export class Ocean {
  /** what it draws: a tile each */
  readonly group = new THREE.Group();
  /** tiles further than this from the eye (across the ground) are not drawn: the draw distance */
  reach = Infinity;
  /** the shallows', seen through; and deep water's, solid (see OCEAN.solid). One set of uniforms between them. */
  readonly material: THREE.ShaderMaterial;
  readonly solid: THREE.ShaderMaterial;
  private tiles: { mesh: THREE.Mesh; r: Rect; box: THREE.Box3 }[] = [];
  private frustum = new THREE.Frustum();
  private seen = new THREE.Matrix4();
  private waves: THREE.DataTexture;
  private depthTex: THREE.DataTexture;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private atmo: Atmosphere,
    o: OceanOptions,
  ) {
    const rect: Rect = { x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1 };
    const g = depthGrid(rect, o.cell ?? 4, o.depthAt), shore = shoreField(g);
    // Each point: how deep, how far from the water's edge, and the way out from it (as half floats: read between points
    // by the card, which it will do with these and not with whole floats).
    const half = new Uint16Array(g.data.length * 4), H = THREE.DataUtils.toHalfFloat;
    for (let i = 0; i < g.data.length; i++) {
      half[i * 4] = H(Math.max(-60, Math.min(60, g.data[i])));
      half[i * 4 + 1] = H(shore.dist[i]);
      half[i * 4 + 2] = H(shore.ax[i]);
      half[i * 4 + 3] = H(shore.az[i]);
    }
    this.depthTex = new THREE.DataTexture(half, g.nx, g.nz, THREE.RGBAFormat, THREE.HalfFloatType);
    this.depthTex.magFilter = this.depthTex.minFilter = THREE.LinearFilter;
    this.depthTex.wrapS = this.depthTex.wrapT = THREE.ClampToEdgeWrapping;
    this.depthTex.needsUpdate = true;

    const w = sharedWaves(o.anisotropy);
    this.waves = w.tex;

    const fog = scene.fog as THREE.FogExp2 | null, L: OceanLook = { ...OCEAN, ...o.look }, rooms = roomsFor(o.rooms, rect);
    const uniforms = {
      ...rooms.uniforms,
      uWaves: { value: this.waves },
      uDepth: { value: this.depthTex },
      // (where the depth grid's first point is, less half a cell, and one over its width and length: a point's place in it)
      uDepthMap: { value: new THREE.Vector4(g.x0 - g.cell / 2, g.z0 - g.cell / 2, 1 / (g.cell * g.nx), 1 / (g.cell * g.nz)) },
      uTime: { value: 0 },
      uSunDir: { value: atmo.sunDir },
      uSun: { value: new THREE.Color() },
      uSky: { value: 1 },
      envMap: { value: null },
      // (the hour's air, the very object the haze has, and the seconds gone by: see Atmosphere.seconds)
      fogColor: { value: fog ? fog.color : new THREE.Color() },
      fogDensity: atmo.seconds,
    };
    const made = (solid: boolean) =>
      new THREE.ShaderMaterial({
        uniforms,
        defines: { ...(fog ? { USE_FOG: '', FOG_EXP2: '' } : {}), ...(solid ? { SEA_SOLID: '' } : {}), ...(o.look?.cut ? { SEA_CUT: '' } : {}), ...rooms.defines },
        vertexShader: VERTEX,
        fragmentShader: fragment(w.slope, L),
        transparent: !solid,
        premultipliedAlpha: true,
        depthWrite: true,
        fog: false,
      });
    this.material = made(false);
    this.solid = made(true);
    this.useSky();

    // one flat square, laid in the plane of the ground; each tile is it, stretched to its own size
    const square = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    // (the open sea past the rectangle: a strip each side it is asked for, the west and east ones the full length)
    const b = o.beyond ?? {}, Z0 = rect.z0 - (b.north ?? 0), Z1 = rect.z1 + (b.south ?? 0);
    const open = [
      b.west && { x0: rect.x0 - b.west, x1: rect.x0, z0: Z0, z1: Z1 },
      b.east && { x0: rect.x1, x1: rect.x1 + b.east, z0: Z0, z1: Z1 },
      b.north && { x0: rect.x0, x1: rect.x1, z0: Z0, z1: rect.z0 },
      b.south && { x0: rect.x0, x1: rect.x1, z0: rect.z1, z1: Z1 },
    ].filter((r): r is Rect => !!r);
    const laid = [...oceanTiles(rect, o.tile ?? TILE).map((r) => ({ r, solid: shallowestIn(g, r) > L.solid })), ...open.flatMap((s) => oceanTiles(s, BEYOND_TILE).map((r) => ({ r, solid: true })))];
    for (const { r, solid } of laid) {
      const mesh = new THREE.Mesh(square, solid ? this.solid : this.material);
      // (deep water before anything else solid: the ground under it is then hidden before it is painted)
      if (solid) mesh.renderOrder = -1;
      mesh.position.set((r.x0 + r.x1) / 2, o.seaLevel, (r.z0 + r.z1) / 2);
      mesh.scale.set(r.x1 - r.x0, 1, r.z1 - r.z0);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.name = solid ? 'sea (deep)' : 'sea';
      this.group.add(mesh);
      this.tiles.push({ mesh, r, box: new THREE.Box3(new THREE.Vector3(r.x0, o.seaLevel - 0.01, r.z0), new THREE.Vector3(r.x1, o.seaLevel + 0.01, r.z1)) });
    }
    this.group.name = 'ocean';
    scene.add(this.group);
  }

  /** The sky's light, once the atmosphere has made it (it is made in Atmosphere.init: the sea made before it waits for it). */
  private useSky() {
    skyOf(this.atmo, this.material, this.solid);
  }

  /**
   * Each frame: the waves on by the time gone, the hour's light, and the tiles out of reach left out. Given the camera,
   * the tiles out of its view are left out here, by their own flat boxes (three's own test is by a ball round each,
   * which for a tile a quarter of a kilometre wide takes in the tiles behind the eye).
   */
  update(dt: number, eye: THREE.Vector3, camera?: THREE.Camera) {
    this.time += dt;
    const u = this.material.uniforms;
    // (kept small: the waves' layers are scrolled by it, and a float of many thousands of seconds loses the step)
    u.uTime.value = this.time % 3600;
    u.uSun.value.copy(this.atmo.sunTint).multiplyScalar(this.atmo.sunNow);
    u.uSky.value = this.atmo.skyNow;
    if (!u.envMap.value) this.useSky();
    if (camera) this.frustum.setFromProjectionMatrix(this.seen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const t of this.tiles) {
      const dx = Math.max(t.r.x0 - eye.x, 0, eye.x - t.r.x1), dz = Math.max(t.r.z0 - eye.z, 0, eye.z - t.r.z1);
      t.mesh.visible = dx * dx + dz * dz < this.reach * this.reach && (!camera || this.frustum.intersectsBox(t.box));
      t.mesh.frustumCulled = !camera;
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.tiles[0]?.mesh.geometry.dispose();
    this.material.dispose();
    this.solid.dispose();
    this.depthTex.dispose();
  }
}

const VERTEX = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec3 vSea;
  void main() {
    vec4 w = modelMatrix * vec4( position, 1.0 );
    vSea = w.xyz;
    #ifdef USE_FOG
      vFogWorldPos = w.xyz;
    #endif
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/** @param most the slope the wave picture's 127 stands for (ocean-waves.ts waveMap); @param L the look (OCEAN, or a lake's) */
function fragment(most: number, L: OceanLook) {
  const wind = new THREE.Vector2(...L.wind).normalize();
  const layer = ([size, turn, pace]: [number, number, number, number]) => {
    const d = wind.clone().rotateAround(new THREE.Vector2(), turn);
    return `seaSlope( p, vec2( ${d.x.toFixed(5)}, ${d.y.toFixed(5)} ), ${(1 / size).toFixed(6)}, ${pace.toFixed(3)}, crest )`;
  };
  const [l1, l2, l3] = L.layers, surf = L.surf;
  // (the three at their highest together are L.slope)
  const scale = L.slope / (most * (l1[3] + l2[3] + l3[3]));
  return /* glsl */ `
  uniform sampler2D uWaves;
  uniform sampler2D uDepth;
  uniform vec4 uDepthMap;
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSun;
  uniform float uSky;
  varying vec3 vSea;
  #ifdef SEA_SKY
    uniform sampler2D envMap;
    #include <cube_uv_reflection_fragment>
  #endif
  #include <fog_pars_fragment>
  #ifndef USE_FOG
    uniform vec3 fogColor;
  #endif
  ${ROOMS_GLSL}

  // One layer of waves: the picture laid along the way it runs, scrolled along it, and its slopes turned back to the
  // world's. Its crests (how high it is, 0 to 1) are kept as well.
  vec2 seaSlope( vec2 p, vec2 d, float inv, float pace, inout float crest ) {
    vec2 side = vec2( -d.y, d.x );
    vec2 q = vec2( dot( p, d ) - pace * uTime, dot( p, side ) );
    vec4 t = texture2D( uWaves, q * inv );
    crest = max( crest, t.b );
    vec2 s = t.rg * 2.0 - 1.0;
    return s.x * d + s.y * side;
  }

  void main() {
    vec3 world = vSea;
    vec3 toEye = cameraPosition - world;
    float dist = length( toEye );
    vec3 V = toEye / max( dist, 1e-4 );
    vec2 p = world.xz;
    vec4 here = texture2D( uDepth, ( p - uDepthMap.xy ) * uDepthMap.zw );
    float depth = here.r, fromShore = here.g;
    vec2 away = here.ba / max( length( here.ba ), 1e-3 );
    float distant = smoothstep( 40.0, 900.0, dist );

    // The rooms standing in it: none of it in a dry one; under a roof, still and dark (\`indoor\`); and how near the
    // nearest wall is, on whichever side of it (\`wall\`: inside, from the wall's inner face, a hand's breadth in).
    float indoor = 0.0, wall = 1e3;
    #ifdef SEA_ROOMS
      for ( int i = 0; i < SEA_ROOMS; i++ ) {
        float sd = fromRoom( i, p );
        if ( uRoomB[ i ].z > 0.5 && sd < 0.0 ) discard;
        if ( uRoomB[ i ].z < 0.5 ) indoor = max( indoor, 1.0 - smoothstep( -0.3, 0.0, sd ) );
        wall = min( wall, sd >= 0.0 ? sd : max( -sd - 0.22, 0.0 ) );
      }
    #endif
    float atWall = 1.0 - smoothstep( 0.03, 0.45, wall );

    // the waves: calmer in the shallows; the finest let go far off
    float crest = 0.0, c1 = 0.0, c3 = 0.0;
    vec2 s = ${layer(l1)} * ${l1[3].toFixed(3)};
    c1 = crest;
    s += ${layer(l2)} * ${(l2[3]).toFixed(3)} * ( 1.0 - 0.75 * distant );
    crest = 0.0;
    s += ${layer(l3)} * ${l3[3].toFixed(3)};
    c3 = crest;
    s *= ${scale.toFixed(6)} * ( 0.4 + 0.6 * smoothstep( 0.0, 3.0, depth ) ) * ( 1.0 - 0.85 * indoor );

    // The breakers: lines a set distance apart coming in to the edge, bent a little along the shore by the swell's own
    // crests (so no two are straight), steeper and taller as they near it, a long back and a steep face, as a wave has.
    float inSurf = ( 1.0 - smoothstep( ${(surf.reach * 0.55).toFixed(1)}, ${surf.reach.toFixed(1)}, fromShore ) ) * step( 0.01, fromShore ) * ( 1.0 - 0.8 * distant );
    float bend = ( texture2D( uWaves, p * 0.0051 ).b - 0.5 ) * 9.0 + ( c3 - 0.5 ) * 2.0;
    float phase = ( fromShore + bend ) * ${((2 * Math.PI) / surf.apart).toFixed(5)} + uTime * ${((2 * Math.PI * surf.pace) / surf.apart).toFixed(5)};
    float swell = sin( phase ), lift = 0.55 + 0.45 * ( 1.0 - smoothstep( 4.0, ${surf.breaks.toFixed(1)}, fromShore ) );
    // (the slope across the line: up its back toward the sea, down its face toward the shore)
    s += away * cos( phase ) * ( 1.0 + 0.6 * swell ) * ${surf.steep.toFixed(4)} * inSurf * lift;
    vec3 N = normalize( vec3( -s.x, 1.0, -s.y ) );

    // the sky in it, more of it the flatter it is looked across
    float NdV = max( dot( N, V ), 0.0 );
    float F = 0.02 + 0.98 * pow( 1.0 - NdV, 5.0 );
    vec3 R = reflect( -V, N );
    // (a ray turned down into the sea by a steep wave is a ray of the sky still: the next wave's face)
    R.y = abs( R.y );
    #ifdef SEA_SKY
      vec3 sky = textureCubeUV( envMap, R, 0.1 + 0.35 * distant ).rgb * uSky;
    #else
      vec3 sky = fogColor * mix( 1.0, 0.75, R.y );
    #endif
    ${L.dim > 0 ? `sky *= 1.0 - ${L.dim.toFixed(3)} * ( 1.0 - smoothstep( 0.0, 0.6, R.y ) );` : ''}
    // (under a roof what it shows is the room's dark, not the sky)
    sky = mix( sky, fogColor * 0.04, indoor );

    // the sun's glint: sharp near, spread far off, never so bright that one point of the screen is a flash
    float tight = mix( 1400.0, 90.0, distant );
    float glint = pow( max( dot( R, uSunDir ), 0.0 ), tight ) * ( tight + 2.0 ) * 0.159;
    vec3 spec = uSun * min( glint * F, 12.0 ) * step( 0.0, uSunDir.y ) * ( 1.0 - indoor );

    // the water itself, as seen into it: sea-green in the shallows, dark blue-green deep, lit by the hour's air and sun
    float deep = 1.0 - exp( -max( depth, 0.0 ) * 0.12 );
    vec3 tint = mix( ${vec3(L.shallow)}, ${vec3(L.deep)}, deep );
    vec3 body = tint * ( fogColor * 0.9 + uSun * max( uSunDir.y, 0.0 ) * 0.12 );
    // (light through the crest of a wave between the eye and a low sun; and green through a breaker's face, thinnest
    // just before it breaks)
    float face = smoothstep( 0.2, 0.95, swell ) * inSurf * lift;
    body += tint * uSun * pow( max( dot( -V, uSunDir ), 0.0 ), 4.0 ) * ( c3 * 0.08 + face * 0.35 );
    body += ${vec3([0.02, 0.07, 0.055])} * face * ( fogColor.g + uSun.g * 0.15 );
    body *= 1.0 - 0.75 * indoor;
    // how much of what is under it is hidden: by the water looked through to reach the ground
    float murk = 1.0 - exp( -max( depth, 0.0 ) / max( V.y, 0.06 ) * ${L.murk.toFixed(4)} );
    #ifdef SEA_SOLID
      murk = 1.0;
    #endif
    // (flood water standing in a room is brown and thick with what it has soaked: the floor seen through it dimly)
    murk = max( murk, indoor * ( 0.62 + 0.2 * smoothstep( 0.1, 0.6, depth ) ) );
    body = mix( body, ${vec3([0.05, 0.038, 0.022])} * ( fogColor * 0.5 + 0.02 ), indoor * 0.7 );

    // foam: a line where the water ends, lines of surf rolling in toward it over the shallows (thin: on a flat shore
    // the shallows are wide, and foam over all of them was a sheet of ice), broken into a net; a few caps far out
    // (the wash runs further up the sand as each breaker arrives, and drains back)
    float arrive = 0.5 + 0.5 * sin( bend * ${((2 * Math.PI) / surf.apart).toFixed(5)} + uTime * ${((2 * Math.PI * surf.pace) / surf.apart).toFixed(5)} );
    float wash = 1.0 - smoothstep( 0.0, 0.18 + 0.32 * arrive * arrive, depth );
    // (a breaker breaks white along its crest inside the breaking line, and leaves foam behind it as it goes in)
    float breaking = 1.0 - smoothstep( ${(surf.breaks * 0.5).toFixed(1)}, ${surf.breaks.toFixed(1)}, fromShore );
    float crestLine = smoothstep( 0.8, 0.98, swell ) + 0.45 * smoothstep( 0.2, 0.9, sin( phase + 0.9 ) ) * smoothstep( 0.0, 0.6, swell + 0.3 );
    float shallows = 1.0 - smoothstep( 0.2, ${L.foamDepth.toFixed(3)}, depth );
    float cover = wash * 0.75 + crestLine * breaking * inSurf * 0.7 + shallows * 0.12 + smoothstep( 0.82, 0.97, c1 * c3 ) * 0.3 * ( 1.0 - inSurf );
    // (a line of it where the water meets a wall, as along a shore: thinner indoors, where nothing stirs it)
    cover = min( 1.0, cover + atWall * ( 0.8 - 0.45 * indoor ) );
    // (two sizes of the net drifting apart: one alone was a honeycomb)
    float net = texture2D( uWaves, p * 0.23 + vec2( uTime * 0.04, 0.0 ) ).a * 0.62 + texture2D( uWaves, p * 0.061 - vec2( 0.0, uTime * 0.013 ) ).a * 0.38;
    float foam = smoothstep( 1.0 - cover, 1.2 - cover, net ) * sqrt( cover ) * 0.85 * smoothstep( -0.05, 0.05, depth ) * ( 1.0 - 0.6 * distant ) * ${L.foam.toFixed(3)};
    vec3 white = vec3( 0.74, 0.77, 0.79 ) * ( fogColor * 1.1 + uSun * max( uSunDir.y, 0.0 ) * 0.4 ) * ( 1.0 - 0.75 * indoor );

    // laid over what is under it: premultiplied, so that what shows through is what is not covered
    vec3 col = F * sky + spec + ( 1.0 - F ) * murk * body;
    float a = F + ( 1.0 - F ) * murk;
    col = mix( col, white, foam );
    a = mix( a, 1.0, foam );
    ${L.weed > 0 ? /* glsl */ `
    // (duckweed and scum: in drifts the size of a pond, broken into bits, thickest where it is shallowest)
    float drift = smoothstep( 0.42, 0.72, texture2D( uWaves, p * 0.013 + 0.31 ).b );
    float bits = texture2D( uWaves, p * 0.37 ).a;
    // (and against a wall, where it drifts and gathers)
    float weed = smoothstep( 0.4, 0.75, bits * 0.55 + drift * 0.5 + ( 1.0 - smoothstep( 0.0, 0.5, depth ) ) * 0.35 + atWall * 0.3 ) * ${L.weed.toFixed(3)};
    weed *= smoothstep( -0.02, 0.03, depth );
    vec3 green = vec3( 0.05, 0.085, 0.022 ) * ( fogColor * 1.2 + uSun * max( uSunDir.y, 0.0 ) * 0.35 ) * ( 1.0 - 0.75 * indoor );
    col = mix( col, green, weed );
    a = mix( a, 1.0, weed );` : ''}

    #ifdef USE_FOG
      vec3 rd = -V;
      float fogAmt = atmoFogAmount( cameraPosition, rd, dist );
      col = col * ( 1.0 - fogAmt ) + atmoFogColor( rd ) * fogAmt * a;
      #ifdef GAS_ZONE
        vec3 gasIs = gasAmount( cameraPosition, rd, dist );
        col = col * ( 1.0 - gasIs.x ) + gasColor( rd, gasIs.y, gasIs.z ) * gasIs.x * a;
      #endif
    #endif
    #ifdef SEA_SOLID
      a = 1.0;
    #endif
    #ifdef SEA_CUT
      // (a lake's box past its shore: the water is not there, whatever the ground)
      if ( depth < -0.4 ) discard;
    #endif
    gl_FragColor = vec4( clamp( col, 0.0, 32.0 ), clamp( a, 0.0, 1.0 ) );
    if ( any( isnan( gl_FragColor ) ) ) gl_FragColor = vec4( 0.0 );
    #include <colorspace_fragment>
  }`;
}
