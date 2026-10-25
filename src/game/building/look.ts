// How a piece of a base looks (2026-10-24): its solids (src/sim/build/solids.ts) made into one shape for each kind and
// tier, and one paint for each tier, from Poly Haven's pictures (the owner's yes, plan v2: "the pieces as our own shapes
// in Poly Haven's free textures, as the map's buildings are made"). A frame is a lattice of bare timber with the light
// through it, as Rust's twig is; wood, stone and metal are what they say. Doors, their frames and the claim's flag have
// paints of their own (src/sim/build/solids.ts, Paint), and their straps and rivets a shade (vertex colours).

import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../../core/assets';
import type { Atmosphere } from '../../world/atmosphere';
import { PIECES, type Tier } from '../../sim/build/pieces';
import { shapeOf, shutOf, type Paint, type Solid } from '../../sim/build/solids';
import { leafPoint } from '../../sim/build/doors';

/** metres of a piece to one picture of each paint */
const TILE: Record<string, number> = { 0: 3, 1: 1.6, 2: 2, 3: 1.5, 4: 1.5, door: 1.2, steel: 1, galv: 1.5, trim: 1.2, flag: 1, bag: 1, iron: 1 };

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

/** a solid as drawn: its pictures laid on in metres, and its shade (white: none) in every corner */
function solidGeo(s: Solid, tile: number) {
  const g = 'box' in s ? boxGeo(s.box, tile) : 'prism' in s ? prismGeo(s.prism, s.y0, s.y1, tile) : hullGeo(s.hull, tile);
  // (one set of attributes for all: what a box, a prism and a hull each carry, and the shade)
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  const c = new THREE.Color(s.c ?? 0xffffff), n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => (i % 3 === 0 ? c.r : i % 3 === 1 ? c.g : c.b)), 3));
  return g;
}

/** a merge of solids, as one shape drawn with one paint */
function merged(list: Solid[], tile: number): THREE.BufferGeometry {
  const g = mergeGeometries(list.map((q) => solidGeo(q, tile)), false)!;
  g.computeBoundingSphere();
  return g;
}

const geos = new Map<string, THREE.BufferGeometry>();
/** a kind's shape, its pictures laid on for a paint (`dress`: with what is only drawn) */
export function geometryOf(kind: string, p: Paint, dress = true): THREE.BufferGeometry {
  const key = `${kind}:${p}:${dress}`;
  let g = geos.get(key);
  if (!g) {
    const s = shapeOf(kind);
    // (a piece drawn by a model of its own elsewhere: nothing here)
    if (s.unseen) (g = new THREE.BufferGeometry()).setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    else g = merged([...s.solid, ...(dress ? (s.dress ?? []) : [])], TILE[p]);
    geos.set(key, g);
  }
  return g;
}

/** what of a kind is drawn in a paint of its own (an opening's frame, the claim's flag) */
export function clothGeometry(kind: string): THREE.BufferGeometry {
  const key = `${kind}:cloth`;
  let g = geos.get(key);
  if (!g) {
    const c = shapeOf(kind).cloth!;
    geos.set(key, (g = merged(c.solid, TILE[c.paint])));
  }
  return g;
}

/**
 * A leaf of a kind (its `i`th), in its hinge's own frame, its pictures laid on for a paint: and its ironwork, if it has
 * any, as a second group of the one geometry, which is drawn in iron (`paintFor('iron')`: see BaseDraw.rebuild).
 */
export function leafGeometry(kind: string, i: number, p: Paint): THREE.BufferGeometry {
  const key = `${kind}:L${i}:${p}`;
  let g = geos.get(key);
  if (!g) {
    const l = shapeOf(kind).leaves![i], body = merged([...l.solid, ...(l.dress ?? [])], TILE[p]);
    g = l.iron?.length ? mergeGeometries([body, merged(l.iron, TILE.iron)], true)! : body;
    g.computeBoundingSphere();
    geos.set(key, g);
  }
  return g;
}

/**
 * The ghost of a kind: all of it as it stands shut, and, for what swings sideways, the arc its leaves sweep drawn on the
 * floor (plan v2: "A door swings one way, set when it is hung: R flips it, the arc is drawn on the floor in the ghost").
 */
export function ghostGeometry(kind: string): THREE.BufferGeometry {
  const key = `${kind}:ghost`;
  let g = geos.get(key);
  if (g) return g;
  const parts = [merged(shutOf(kind, false), 1)];
  for (const l of shapeOf(kind).leaves ?? []) {
    if (l.axis !== 'y' || l.hinge[1] > 0.5 || !('box' in l.solid[0])) continue;
    const [cx, , , sx] = l.solid[0].box, far = cx + Math.sign(cx) * sx / 2, near = far * 0.8, pos: number[] = [];
    const at = (a: number, x: number) => leafPoint(l, a, [x, 0.03 - l.hinge[1], 0]);
    for (let k = 0; k < 16; k++) {
      const a0 = (l.open * k) / 16, a1 = (l.open * (k + 1)) / 16;
      const [p, q, r, s] = [at(a0, near), at(a0, far), at(a1, far), at(a1, near)];
      pos.push(...p, ...q, ...r, ...p, ...r, ...s);
    }
    const arc = new THREE.BufferGeometry();
    arc.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    arc.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    arc.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
    arc.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
    parts.push(arc);
  }
  g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  geos.set(key, g);
  return g;
}


/** a frame's poles in a 512 square (one to every 3 m, drawn at four times that): round the edge, corner to corner, and across the middle; and where they are tied */
const POLES: [number, number, number, number, number][] = [[0, 18, 512, 18, 34], [0, 494, 512, 494, 34], [18, 0, 18, 512, 34], [494, 0, 494, 512, 34], [26, 486, 486, 26, 28], [26, 256, 486, 256, 22]];
const TIED: [number, number, number][] = [[18, 18, 0.785], [494, 494, 0.785], [494, 18, -0.785], [18, 494, -0.785], [18, 256, 0], [494, 256, 0], [256, 256, 0.785]];
/**
 * A frame's lattice: poles lashed round the edge of every 3 m and across it, open between (the navigator's tier plan:
 * "lashed poles for twig"). Painted from the bark of a real tree (Poly Haven's bark_brown_02), each pole shaded round
 * and tied with rope where it crosses another; drawn plain until the bark has come, and again then. At 2048 a side,
 * the castle's sharpness (the owner, 2026-10-25: "can be the same quality as the castle is"; it was 512).
 */
function lattice(): THREE.Texture {
  const N = 2048, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const t = new THREE.CanvasTexture(c);
  const line = (x0: number, y0: number, x1: number, y1: number, w: number, style: string | CanvasPattern) => {
    g.strokeStyle = style;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  const paint = (bark: ImageBitmap | null) => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, N, N);
    g.scale(N / 512, N / 512);
    g.lineCap = 'round';
    for (const [x0, y0, x1, y1, w] of POLES) {
      // (its edges in shadow, its bark along it, a little light down its middle: a pole, not a plank)
      line(x0, y0, x1, y1, w, 'rgba(28,18,10,0.9)');
      const pat = bark && g.createPattern(bark, 'repeat');
      if (pat) pat.setTransform(new DOMMatrix().rotate((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI + 90).scale(0.22));
      line(x0, y0, x1, y1, w * 0.8, pat ?? '#7d5d3c');
      line(x0, y0, x1, y1, w * 0.28, 'rgba(255,236,205,0.13)');
    }
    // (rope wound round where they cross)
    for (const [x, y, a] of TIED) {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      for (let k = -3; k <= 3; k++) line(k * 4.5, -22, k * 4.5 + 3, 22, 3.2, k % 2 ? '#6e5a3c' : '#86704c');
      g.restore();
    }
    t.needsUpdate = true;
  };
  paint(null);
  // (its own copy of the bark's picture: the world's is let go of once the card has it)
  const rel = assets.manifest.textures.bark_brown_02?.diff;
  if (rel) void fetch(assets.url(rel)).then((r) => r.blob()).then((b) => createImageBitmap(b)).then(paint, () => {});
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const pbr = (id: string, o: THREE.MeshStandardMaterialParameters = {}) => {
  const t = assets.pbr(id);
  return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.armMap, aoMap: t.armMap, metalness: 0, ...o });
};

let paints: THREE.MeshStandardMaterial[] | null = null;
/** the paint of each tier (made once, lit as everything in the world is) */
export function paintsOf(atmo: Atmosphere | null): THREE.MeshStandardMaterial[] {
  if (paints) return paints;
  paints = [
    new THREE.MeshStandardMaterial({ map: lattice(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, name: 'build-frame' }),
    pbr('weathered_planks', { name: 'build-wood' }),
    pbr('castle_wall_slates', { name: 'build-stone' }),
    pbr('rusty_corrugated_iron', { metalnessMap: assets.pbr('rusty_corrugated_iron').armMap, metalness: 1, name: 'build-metal' }),
    // (the armoured tier: welded plates of dark steel, the progression plan's fifth. Its picture's steel is all metal:
    // drawn so it mirrored the sky and went black under a dull one, so a little under half as much)
    pbr('metal_plate_02', { metalnessMap: assets.pbr('metal_plate_02').armMap, metalness: 0.45, name: 'build-armour' }),
  ];
  if (atmo) for (const m of paints) atmo.register(m);
  return paints;
}

const own = new Map<string, THREE.MeshStandardMaterial>();
/**
 * A paint by its name (src/sim/build/solids.ts, Paint): a tier's, or one of the doors', their frames' or the flag's. A
 * wooden door is painted green boards, as Chernarus's are; a metal one painted steel; a garage door galvanised sheet;
 * an opening's frame dark worn timber. Each takes its parts' shades (straps and handles iron, rivets bright).
 */
export function paintFor(p: Paint, atmo: Atmosphere | null): THREE.MeshStandardMaterial {
  if (typeof p === 'number') return paintsOf(atmo)[p];
  let m = own.get(p);
  if (!m) {
    m = p === 'door' ? pbr('green_rough_planks', { vertexColors: true, name: 'build-door' })
      : p === 'steel' ? new THREE.MeshStandardMaterial({ color: 0x56605a, metalness: 0.6, roughness: 0.5, vertexColors: true, name: 'build-steel' })
      : p === 'galv' ? pbr('corrugated_iron', { metalnessMap: assets.pbr('corrugated_iron').armMap, metalness: 1, vertexColors: true, name: 'build-galv' })
      : p === 'trim' ? pbr('wood_floor_worn', { color: 0x76695e, vertexColors: true, name: 'build-trim' })
      : p === 'bag' ? new THREE.MeshStandardMaterial({ color: 0x5a6440, roughness: 0.95, vertexColors: true, name: 'build-bag' })
      // (forged iron: dark grey, a little sheen off it)
      : p === 'iron' ? new THREE.MeshStandardMaterial({ color: 0x6a6d71, metalness: 0.5, roughness: 0.4, vertexColors: true, name: 'build-iron' })
      : new THREE.MeshStandardMaterial({ color: 0xa8322a, roughness: 0.95, side: THREE.DoubleSide, name: 'build-flag' });
    if (atmo) atmo.register(m);
    own.set(p, m);
  }
  return m;
}

/** what a piece in each paint sounds and is struck as */
export const surfaceOf = (p: Paint) => (p === 'steel' || p === 'galv' || p === 3 || p === 4 ? 'metal' : p === 2 ? 'rock' : 'wood');

/** the tier a kind is drawn in when it comes in one only */
export const drawnAt = (kind: string, t: Tier): Tier => PIECES[kind].only ?? t;
