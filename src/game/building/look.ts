// How a piece of a base looks (2026-10-24): its solids (src/sim/build/solids.ts) made into one shape for each kind and
// tier, and one paint for each tier, from Poly Haven's pictures (the owner's yes, plan v2: "the pieces as our own shapes
// in Poly Haven's free textures, as the map's buildings are made"). A frame is a lattice of bare timber with the light
// through it, as Rust's twig is; wood, stone and metal are what they say.

import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../../core/assets';
import type { Atmosphere } from '../../world/atmosphere';
import { PIECES, type Tier } from '../../sim/build/pieces';
import { shapeOf, type Solid } from '../../sim/build/solids';

/** metres of a piece to one picture of each tier's paint */
const TILE = [3, 1.6, 2, 1.5];

/** a box with its pictures laid on in metres (each face by its own two ways) */
function boxGeo(c: [number, number, number, number, number, number], tile: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(c[3], c[4], c[5]).toNonIndexed();
  g.translate(c[0], c[1], c[2]);
  planar(g, tile);
  return g;
}

/** an upright prism: its top and foot, and its sides */
function prismGeo(pts: [number, number][], y0: number, y1: number, tile: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const n = pts.length;
  // (wound so that its outside faces out, whichever way round the outline was given)
  let area = 0;
  for (let i = 0; i < n; i++) area += pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1];
  const p = area > 0 ? pts : [...pts].reverse();
  for (let i = 1; i < n - 1; i++) {
    pos.push(p[0][0], y1, p[0][1], p[i + 1][0], y1, p[i + 1][1], p[i][0], y1, p[i][1]);
    pos.push(p[0][0], y0, p[0][1], p[i][0], y0, p[i][1], p[i + 1][0], y0, p[i + 1][1]);
  }
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    pos.push(a[0], y0, a[1], b[0], y1, b[1], b[0], y0, b[1], a[0], y0, a[1], a[0], y1, a[1], b[0], y1, b[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  planar(g, tile);
  return g;
}

function hullGeo(pts: [number, number, number][], tile: number): THREE.BufferGeometry {
  const g = new ConvexGeometry(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))).toNonIndexed();
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  planar(g, tile);
  return g;
}

/** each face's picture laid on it from the side it most faces, in metres */
function planar(g: THREE.BufferGeometry, tile: number) {
  const p = g.getAttribute('position'), nrm = g.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    // (one way for the whole triangle, by its own normal: no seam across it)
    const nx = Math.abs(nrm.getX(i) + nrm.getX(i + 1) + nrm.getX(i + 2)), ny = Math.abs(nrm.getY(i) + nrm.getY(i + 1) + nrm.getY(i + 2)), nz = Math.abs(nrm.getZ(i) + nrm.getZ(i + 1) + nrm.getZ(i + 2));
    for (let k = i; k < i + 3; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const [u, v] = ny >= nx && ny >= nz ? [x, z] : nx >= nz ? [z, y] : [x, y];
      uv[k * 2] = u / tile;
      uv[k * 2 + 1] = v / tile;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function solidGeo(s: Solid, tile: number) {
  if ('box' in s) return boxGeo(s.box, tile);
  if ('prism' in s) return prismGeo(s.prism, s.y0, s.y1, tile);
  return hullGeo(s.hull, tile);
}

const geos = new Map<string, THREE.BufferGeometry>();
/** a kind's shape, its pictures laid on for a tier (`dress`: with what is only drawn) */
export function geometryOf(kind: string, t: Tier, dress = true): THREE.BufferGeometry {
  const key = `${kind}:${t}:${dress}`;
  let g = geos.get(key);
  if (!g) {
    const s = shapeOf(kind);
    const parts = [...s.solid, ...(dress ? (s.dress ?? []) : [])].map((q) => solidGeo(q, TILE[t]));
    g = mergeGeometries(parts.map((q) => {
      // (one set of attributes for all: what a box, a prism and a hull each carry)
      for (const name of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(name)) q.deleteAttribute(name);
      return q;
    }), false)!;
    g.computeBoundingSphere();
    geos.set(key, g);
  }
  return g;
}

/** a kind's dress alone (what is drawn of it in a paint of its own: the claim's flag) */
export function dressOf(kind: string): THREE.BufferGeometry | null {
  const key = `${kind}:dress`;
  let g = geos.get(key);
  if (g === undefined) {
    const d = shapeOf(kind).dress;
    g = d?.length ? mergeGeometries(d.map((q) => solidGeo(q, 1)), false)! : (null as unknown as THREE.BufferGeometry);
    geos.set(key, g);
  }
  return g ?? null;
}

let flag: THREE.MeshStandardMaterial | null = null;
/** the claim's flag: a red cloth, both sides */
export function flagPaint(atmo: Atmosphere | null) {
  if (!flag) {
    flag = new THREE.MeshStandardMaterial({ color: 0xa8322a, roughness: 0.95, side: THREE.DoubleSide, name: 'build-flag' });
    if (atmo) atmo.register(flag);
  }
  return flag;
}

/** a frame's lattice: timber round the edge of every 3 m and across it corner to corner, open between */
function lattice(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  const beam = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    g.strokeStyle = '#b8935f';
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.strokeStyle = 'rgba(70,45,22,0.55)';
    g.lineWidth = 2;
    g.stroke();
  };
  for (const [x0, y0, x1, y1] of [[0, 9, 256, 9], [0, 247, 256, 247], [9, 0, 9, 256], [247, 0, 247, 256]]) beam(x0, y0, x1, y1, 18);
  beam(14, 242, 242, 14, 14);
  beam(14, 128, 242, 128, 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

let paints: THREE.MeshStandardMaterial[] | null = null;
/** the paint of each tier (made once, lit as everything in the world is) */
export function paintsOf(atmo: Atmosphere | null): THREE.MeshStandardMaterial[] {
  if (paints) return paints;
  const pbr = (id: string, o: THREE.MeshStandardMaterialParameters = {}) => {
    const t = assets.pbr(id);
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.armMap, aoMap: t.armMap, metalness: 0, ...o });
  };
  paints = [
    new THREE.MeshStandardMaterial({ map: lattice(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, name: 'build-frame' }),
    pbr('weathered_planks', { name: 'build-wood' }),
    pbr('castle_wall_slates', { name: 'build-stone' }),
    pbr('rusty_corrugated_iron', { metalnessMap: assets.pbr('rusty_corrugated_iron').armMap, metalness: 1, name: 'build-metal' }),
  ];
  if (atmo) for (const m of paints) atmo.register(m);
  return paints;
}

/** what a piece of each tier sounds and is struck as */
export const SURFACE = ['wood', 'wood', 'rock', 'metal'] as const;

/** the tier a kind is drawn in when it comes in one only */
export const drawnAt = (kind: string, t: Tier): Tier => PIECES[kind].only ?? t;
