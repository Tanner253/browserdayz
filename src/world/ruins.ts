// The ruined town as it is built (see src/sim/ruins.ts for what and where, src/world/ruins-shape.ts for its shape
// and for which pictures it is painted with): each piece stood in the world at its own place and turn, and solid.
//
// It is big and it is far from everything, so it costs nothing until somebody goes to it:
//   - What stops a body is made at once (a shot from half a kilometre off must stop on it).
//   - From far off the whole town is ONE thing to draw: its walls as plain blocks, its floors and its big heaps,
//     painted with the colour its pictures come to and with no picture at all. A few thousand triangles.
//   - The first time the eye comes within COME metres of any of it, its pictures are asked for (for the first time:
//     somebody who never comes never fetches them), its real shape is worked out a piece at a time, and all of it
//     is got ready off the picture in the spare of frames (shaders, pictures onto the card, a first drawing).
//     Only then is it put in the world, and the far one taken out, in one frame.
//   - Near, a piece is one thing to draw for all its stone and earth (which of the two a point is painted with is
//     said with the point), and within NEAR metres two more: its small things, and its timber.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../core/assets';
import { GLASS_GROUPS, physics } from '../core/physics';
import type { Atmosphere } from './atmosphere';
import { hash, ruinAt, ruinFoot, type Paint, type Piece, type Place, type V3 } from '../sim/ruins';
import { BRIGHT, PAINTS, ruinShapeInTurns, ruinSolids, type Solid, type Stuff } from './ruins-shape';

/** how near the eye comes to any of it before its pictures are asked for and its real shape made; how far it goes before the far one is drawn again; and how far off a piece's small things and timber are drawn. Metres, from the edge of a piece. */
export const COME = 380, GO = 440, NEAR = 110;
/** the town in full let go of this far past GO, metres: its shapes and paints off the graphics card, its pictures left to
 * CardKeep, made again on the way back as the first time (kept for good, a long session filled the card: 2026-10-21) */
const LET_GO = 400;

export interface Stood { piece: Piece; place: Place }
/** a thing got ready to be drawn before it is put in the world: the game's own way of it (Renderer.ready, then Renderer.send) */
export type Ready = (o: THREE.Object3D) => Promise<unknown>;

/**
 * The two pictures of stone and of earth laid by one material: which a point has is in the fourth part of its colour.
 * The stone is laid twice, at two sizes and turned, and the two are mixed by a slow cloud across the world, and its
 * tone wanders with another: laid once, at a hand to a stone, a whole front came out a grid of squares from the town's
 * top (the owner, 2026-10-23: "one of our weakest POI's it is visually ugly").
 */
const twoPictures = (earth: THREE.Texture, earthN: THREE.Texture) => (shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }) => {
  Object.assign(shader.uniforms, { tEarth: { value: earth }, tEarthN: { value: earthN } });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vRuinW;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRuinW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
uniform sampler2D tEarth;
uniform sampler2D tEarthN;
varying vec3 vRuinW;
float ruinCell( vec2 c ) { vec3 q = fract( vec3( c.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
float ruinCloud( vec2 p ) { vec2 i = floor( p ), u = fract( p ); u = u * u * ( 3.0 - 2.0 * u ); return mix( mix( ruinCell( i ), ruinCell( i + vec2( 1.0, 0.0 ) ), u.x ), mix( ruinCell( i + vec2( 0.0, 1.0 ) ), ruinCell( i + vec2( 1.0, 1.0 ) ), u.x ), u.y ); }
// (the second laying: 1.6 times the size, turned end for end (the stone lies in courses: any other turn tilts them), moved off)
vec2 ruinTurn( vec2 uv ) { return -uv * 0.63 + vec2( 0.37, 0.71 ); }
float ruinMix() { vec2 w = vRuinW.xz + vRuinW.y * vec2( 0.6, -0.4 ); return smoothstep( 0.36, 0.64, ruinCloud( w * 0.09 ) * 0.72 + ruinCloud( w * 0.31 + 4.1 ) * 0.28 ); }`)
    .replace('#include <map_fragment>', `#ifdef USE_MAP
	vec4 ruinStone = mix( texture2D( map, vMapUv ), texture2D( map, ruinTurn( vMapUv ) ), ruinMix() );
	diffuseColor *= mix( ruinStone, texture2D( tEarth, vMapUv ), vColor.a );
	diffuseColor.rgb *= 0.86 + 0.26 * ruinCloud( vRuinW.xz * 0.045 + vRuinW.y * 0.06 + 9.3 );
#endif`)
    .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('texture2D( normalMap, vNormalMapUv ).xyz', 'mix( mix( texture2D( normalMap, vNormalMapUv ).xyz, ruinUnturn( texture2D( normalMap, ruinTurn( vNormalMapUv ) ).xyz ), ruinMix() ), texture2D( tEarthN, vNormalMapUv ).xyz, vColor.a )'))
    // (earth is dull all over: the stone's own map of where it shines is not laid on it)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor = mix( roughnessFactor, 1.0, vColor.a );');
  // (a turned picture's bumps turned back, so that its light falls as the first's does)
  shader.fragmentShader = shader.fragmentShader.replace('float ruinMix()', 'vec3 ruinUnturn( vec3 n ) { vec2 d = n.xy * 2.0 - 1.0; d = -d; return vec3( d * 0.5 + 0.5, n.z ); }\nfloat ruinMix()');
};

export class Ruins {
  readonly group = new THREE.Group();
  /** not yet come to; being got ready; drawn in full; made, but far off again and drawn as from far */
  state: 'far' | 'coming' | 'near' | 'away' = 'far';
  private far: THREE.Mesh;
  private full: THREE.Group | null = null;
  private pieces: { piece: Piece; place: Place; mid: THREE.Vector3; reach: number; detail: THREE.Object3D[] }[] = [];
  /** how much of it there is: what stops a body, the triangles and the bytes of it from far off and in full, the bytes of its pictures, how many things there are to draw in full, and how long it took to get ready, ms */
  readonly count = { solids: 0, farTriangles: 0, farBytes: 0, triangles: 0, bytes: 0, pictures: 0, meshes: 0, made: 0 };

  /**
   * @param plan each piece and where it stands (`ruinsPlan` for the town as it stood)
   * @param ready how a thing is got ready off the picture before it is shown (left out: it is shown as it is, and its first frame pays for it)
   */
  constructor(private atmo: Atmosphere, scene: THREE.Scene, plan: Stood[], private ready: Ready = async () => {}) {
    this.group.name = 'ruins';
    const pos: number[] = [], nor: number[] = [], col: number[] = [];
    for (const { piece, place } of plan) {
      const solids = ruinSolids(piece), foot = ruinFoot(piece);
      for (const s of solids) this.solid(s, place);
      this.count.solids += solids.length;
      // (what is drawn of it from far off: not the houses nor the remnants of the bank's wall, which are a metre high)
      if (piece !== 'honeycomb' && !piece.startsWith('stu')) for (const s of solids) if (s.far) this.farShape(s, place, pos, nor, col);
      const mx = foot.reduce((a, q) => a + q[0], 0) / foot.length, mz = foot.reduce((a, q) => a + q[1], 0) / foot.length;
      this.pieces.push({ piece, place, mid: new THREE.Vector3(...ruinAt(place, mx, mz)), reach: Math.max(...foot.map((q) => Math.hypot(q[0] - mx, q[1] - mz))), detail: [] });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    this.far = new THREE.Mesh(g, atmo.register(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })));
    this.far.name = 'ruins from far';
    this.far.receiveShadow = true;
    this.far.matrixAutoUpdate = false;
    this.group.add(this.far);
    this.count.farTriangles = pos.length / 9;
    this.count.farBytes = pos.length * 4 * 3;
    scene.add(this.group);
  }

  /** what stops a body, where it stands in the world: everything, or (a rail, a timber stair) a body and nothing else */
  private solid(s: Solid, p: Place) {
    const R = physics.R, groups = s.body === 'feet' ? GLASS_GROUPS : undefined;
    if (s.k === 'box') {
      const [x, y, z] = ruinAt(p, s.x, s.z, s.y), half = (p.rot + s.yaw) / 2;
      physics.addStaticQuat(R.ColliderDesc.cuboid(s.hx, s.hy, s.hz), s.ground, { x, y, z }, { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, undefined, groups);
      return;
    }
    const src = s.k === 'hull' ? s.pts : s.verts, verts = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) verts.set(ruinAt(p, src[i], src[i + 2], src[i + 1]), i);
    const desc = s.k === 'hull' ? R.ColliderDesc.convexHull(verts) : R.ColliderDesc.trimesh(verts, new Uint32Array(s.index));
    if (desc) physics.addStaticQuat(desc, s.ground, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, undefined, groups);
  }

  /** a thing that stops a body, as it is drawn from far off: a wall's block (its sides of stone, its top of what its heart is), a floor, a ramp's top, a heap */
  private farShape(s: Solid, p: Place, pos: number[], nor: number[], col: number[]) {
    const tone = (paint: Paint, k: number): V3 => {
      const P = PAINTS[paint], t = 0.86 + 0.2 * hash(Math.round(k * 7), pos.length, 3);
      return [P.mean[0] * P.tint[0] * t, P.mean[1] * P.tint[1] * t, P.mean[2] * P.tint[2] * t];
    };
    const tri = (a: V3, b: V3, c: V3, paint: Paint) => {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(n[0], n[1], n[2]) || 1, t = tone(paint, a[0] + a[2]);
      for (const q of [a, b, c]) {
        pos.push(q[0], q[1], q[2]);
        nor.push(n[0] / l, n[1] / l, n[2] / l);
        col.push(t[0], t[1], t[2]);
      }
    };
    const at = (x: number, y: number, z: number) => ruinAt(p, x, z, y);
    if (s.k === 'box') {
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      const corner = (i: number, j: number, k: number) => at(s.x + i * s.hx * c + k * s.hz * sn, s.y + j * s.hy, s.z - i * s.hx * sn + k * s.hz * c);
      const ring: [number, number][] = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
      ring.forEach(([i, k], n) => {
        const [i2, k2] = ring[(n + 1) % 4], a = corner(i, -1, k), b = corner(i2, -1, k2), b2 = corner(i2, 1, k2), a2 = corner(i, 1, k);
        tri(a, b, b2, s.far!);
        tri(a, b2, a2, s.far!);
      });
      const top = ring.map(([i, k]) => corner(i, 1, k)), cap = s.far === 'stone' ? 'core' : s.far!;
      tri(top[0], top[1], top[2], cap);
      tri(top[0], top[2], top[3], cap);
    } else if (s.k === 'sheet') {
      for (let i = 0; i < s.index.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => at(s.verts[s.index[i + k] * 3], s.verts[s.index[i + k] * 3 + 1], s.verts[s.index[i + k] * 3 + 2]));
        tri(a, b, c, s.far!);
      }
    } else {
      // (a slab: the four corners of its top come first, in order round it; whichever way round, it is seen from above)
      const q = [0, 1, 2, 3].map((k) => at(s.pts[k * 3], s.pts[k * 3 + 1], s.pts[k * 3 + 2]));
      const up = (q[1][2] - q[0][2]) * (q[2][0] - q[0][0]) - (q[1][0] - q[0][0]) * (q[2][2] - q[0][2]) > 0, [a, b, c, d] = up ? q : [q[3], q[2], q[1], q[0]];
      tri(a, b, c, s.far!);
      tri(a, c, d, s.far!);
    }
  }

  /** Its pictures asked for, its real shape made, and all of it got ready off the picture: then, in one frame, it is in the world and the far one is out of it. */
  private async come() {
    const t0 = performance.now(), pause = () => new Promise<void>((r) => setTimeout(r, 0));
    const stone = assets.pbr(PAINTS.stone.tex), wood = assets.pbr(PAINTS.timber.tex), e = assets.manifest.textures[PAINTS.earth.tex];
    // (of the earth, its colour and its grain: the third picture of the set, where it shines, is not fetched)
    const earth = assets.texture(e.diff, { srgb: true, repeat: true }), earthN = assets.texture(e.nor, { repeat: true });
    const mats: Record<Stuff, THREE.MeshStandardMaterial> = {
      masonry: new THREE.MeshStandardMaterial({ map: stone.map, normalMap: stone.normalMap, roughnessMap: stone.armMap, aoMap: stone.armMap, metalness: 0, roughness: 1, vertexColors: true }),
      timber: new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, roughnessMap: wood.armMap, metalness: 0, roughness: 1, vertexColors: true }),
    };
    for (const m of Object.values(mats)) m.color.setScalar(BRIGHT);
    // (the stone's joints are deep, and the whole of their shade laid on it left a wall in shadow near black)
    mats.masonry.aoMapIntensity = 0.5;
    this.atmo.register(mats.masonry, twoPictures(earth, earthN), 'ruins-masonry');
    this.atmo.register(mats.timber);
    const full = new THREE.Group(), small: THREE.BufferGeometry[][] = [[], []];
    full.name = 'ruins in full';
    const mesh = (geo: THREE.BufferGeometry, stuff: Stuff, into: THREE.Object3D) => {
      const m = new THREE.Mesh(geo, mats[stuff]);
      m.castShadow = m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      into.add(m);
      this.count.meshes++;
      this.count.triangles += geo.getAttribute('position').count / 3;
      for (const a of Object.values(geo.attributes)) this.count.bytes += (a.array as Float32Array).byteLength;
      return m;
    };
    for (const q of this.pieces) {
      const shape = await ruinShapeInTurns(q.piece, pause), turn = new THREE.Matrix4().makeRotationY(q.place.rot).setPosition(q.place.x, q.place.y, q.place.z);
      if (q.piece.startsWith('stu')) {
        // (the remnants of the bank's wall are a few hundred triangles each: all of them, wherever they stand, are one thing to draw)
        for (const d of shape.drawn) small[d.near ? 1 : 0].push(d.geometry.clone().applyMatrix4(turn));
        continue;
      }
      const group = new THREE.Group();
      group.name = `ruins ${q.piece}`;
      group.applyMatrix4(turn);
      group.matrixAutoUpdate = false;
      for (const d of shape.drawn) {
        const m = mesh(d.geometry, d.stuff, group);
        if (d.near) q.detail.push(m);
      }
      full.add(group);
    }
    small.forEach((list, near) => {
      if (!list.length) return;
      const m = mesh(mergeGeometries(list), 'masonry', full);
      m.geometry.computeBoundingSphere();
      if (near) for (const q of this.pieces) if (q.piece.startsWith('stu')) q.detail.push(m);
    });
    full.updateMatrixWorld(true);
    await assets.idle();
    for (const t of [stone.map, stone.normalMap, stone.armMap, earth, earthN]) {
      const i = t.image as { width?: number; height?: number } | null;
      this.count.pictures += ((i?.width || 1024) * (i?.height || 1024) * 4 * 4) / 3;
    }
    await this.ready(full);
    this.full = full;
    this.group.add(full);
    this.far.visible = false;
    this.state = 'near';
    this.count.made = Math.round(performance.now() - t0);
  }

  /** Told where the eye is, a few times a second: which of the two ways the town is drawn, and which pieces' small things are. */
  update(eye: { x: number; z: number }) {
    let nearest = Infinity;
    for (const q of this.pieces) nearest = Math.min(nearest, Math.hypot(q.mid.x - eye.x, q.mid.z - eye.z) - q.reach);
    if (this.state === 'far' && nearest < COME) {
      this.state = 'coming';
      void this.come().catch((err) => {
        console.error(err);
        this.state = 'far';
      });
    }
    if (!this.full) return;
    if (this.state === 'away' && nearest > GO + LET_GO) {
      const full = this.full;
      this.group.remove(full);
      const paints = new Set<THREE.Material>();
      full.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) paints.add(mat);
      });
      for (const mat of paints) mat.dispose();
      for (const q of this.pieces) q.detail.length = 0;
      this.full = null;
      this.state = 'far';
      return;
    }
    const away = this.state === 'near' ? nearest > GO : nearest > COME;
    this.state = away ? 'away' : 'near';
    this.full.visible = !away;
    this.far.visible = away;
    const seen = new Map<THREE.Object3D, boolean>();
    for (const q of this.pieces) {
      const on = Math.hypot(q.mid.x - eye.x, q.mid.z - eye.z) < q.reach + NEAR;
      // (the remnants share one mesh of small things: it is drawn while any of them is near)
      for (const m of q.detail) seen.set(m, (seen.get(m) ?? false) || on);
    }
    for (const [m, on] of seen) m.visible = on;
  }
}
