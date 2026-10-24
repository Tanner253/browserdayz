// The wheel's pictures (2026-10-24, the owner: "the radial menu should have visuals and icons for the building pieces and
// also actions of the wheel"): each piece drawn from its own solids (src/sim/build/solids.ts), looked down on from a
// corner, shaded by a sun, as the plan's card drew them; and a mark for each thing the hammer does.

import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { shutOf, type Solid } from '../../sim/build/solids';
import { FOUND, PIECES } from '../../sim/build/pieces';

const YAW = 0.55, PITCH = 0.5;
const V = new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH));
const LIGHT = new THREE.Vector3(-0.45, 1, 0.7).normalize();
/** a tier's colour on the wheel: frame, wood, stone, metal */
export const TIER_INK = ['#d9c9a3', '#a77a48', '#97948b', '#7f8c98'];

type Face = THREE.Vector3[];

function facesOf(s: Solid): Face[] {
  if ('box' in s) {
    const [cx, cy, cz, sx, sy, sz] = s.box, x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    return [[v(x0, y1, z0), v(x1, y1, z0), v(x1, y1, z1), v(x0, y1, z1)], [v(x0, y0, z0), v(x0, y0, z1), v(x1, y0, z1), v(x1, y0, z0)], [v(x1, y0, z0), v(x1, y0, z1), v(x1, y1, z1), v(x1, y1, z0)], [v(x0, y0, z0), v(x0, y1, z0), v(x0, y1, z1), v(x0, y0, z1)], [v(x0, y0, z1), v(x0, y1, z1), v(x1, y1, z1), v(x1, y0, z1)], [v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0)]];
  }
  if ('prism' in s) {
    const top = s.prism.map(([x, z]) => new THREE.Vector3(x, s.y1, z)), bot = s.prism.map(([x, z]) => new THREE.Vector3(x, s.y0, z));
    return [top, bot, ...s.prism.map((_, i) => { const j = (i + 1) % s.prism.length; return [bot[i], bot[j], top[j], top[i]]; })];
  }
  const hull = new ConvexHull().setFromPoints(s.hull.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  return hull.faces.map((f) => {
    const out: Face = [];
    let e = f.edge;
    do {
      out.push(e.head().point.clone());
      e = e.next;
    } while (e !== f.edge);
    return out;
  });
}

const shade = (hex: string, k: number) => `rgb(${[1, 3, 5].map((i) => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k))).join(',')})`;

/** a piece's solids as it is pictured: a foundation as its slab (what reaches into the ground is not what it is to a player choosing it) */
const pictured = (kind: string) => (PIECES[kind]?.ground ? shutOf(kind).map((q) => ('box' in q ? { ...q, box: [q.box[0], -FOUND.deep / 2, q.box[2], q.box[3], FOUND.deep, q.box[5]] as typeof q.box } : 'prism' in q ? { ...q, y0: -FOUND.deep } : q)) : shutOf(kind));

/** a piece drawn as an SVG picture (a data URL), in the colour of a tier */
export const pieceIcon = (kind: string, ink = TIER_INK[1]) => drawn(pictured(kind), ink);

/** a blueprint drawn whole: each of its pieces where it goes, turned as it goes (src/sim/build/blueprints.ts) */
export function printIcon(asks: { k: string; x: number; y: number; z: number; r: number }[], ink = TIER_INK[0]): string {
  const corners = (q: Solid): [number, number, number][] => {
    if ('box' in q) {
      const [cx, cy, cz, sx, sy, sz] = q.box, out: [number, number, number][] = [];
      for (const a of [-0.5, 0.5]) for (const b of [-0.5, 0.5]) for (const c of [-0.5, 0.5]) out.push([cx + a * sx, cy + b * sy, cz + c * sz]);
      return out;
    }
    if ('prism' in q) return q.prism.flatMap(([x, z]) => [[x, q.y0, z], [x, q.y1, z]] as [number, number, number][]);
    return q.hull;
  };
  const solids: Solid[] = asks.flatMap((a) => {
    const t = (a.r * Math.PI) / 6, c = Math.cos(t), s = Math.sin(t);
    return pictured(a.k).map((q) => ({ hull: corners(q).map(([x, y, z]) => [a.x + x * c + z * s, a.y + y, a.z - x * s + z * c] as [number, number, number]) }));
  });
  return drawn(solids, ink);
}

function drawn(solids: Solid[], ink: string): string {
  const cy = Math.cos(YAW), sy = Math.sin(YAW), cp = Math.cos(PITCH), sp = Math.sin(PITCH);
  const P = (p: THREE.Vector3) => [(p.x * cy - p.z * sy) * 20, ((p.x * sy + p.z * cy) * sp - p.y * cp) * 20];
  const drawn: { d: number; pts: number[][]; k: number }[] = [];
  for (const sol of solids) {
    const fs = facesOf(sol);
    const mid = fs.flat().reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(fs.flat().length);
    for (const f of fs) {
      let n = new THREE.Vector3().subVectors(f[1], f[0]).cross(new THREE.Vector3().subVectors(f[2], f[0]));
      const c = f.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(f.length);
      if (n.dot(c.clone().sub(mid)) < 0) n = n.negate();
      if (n.dot(V) <= 1e-6) continue;
      n.normalize();
      drawn.push({ d: mid.dot(V), pts: f.map(P), k: 0.55 + 0.5 * Math.max(0, n.dot(LIGHT)) });
    }
  }
  drawn.sort((a, b) => a.d - b.d);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const f of drawn) for (const [x, y] of f.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const pad = 4, w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
  const body = drawn.map((f) => `<polygon points="${f.pts.map(([x, y]) => `${(x - x0 + pad).toFixed(1)},${(y - y0 + pad).toFixed(1)}`).join(' ')}" fill="${shade(ink, f.k)}" stroke="#0b0d0b" stroke-opacity=".7" stroke-width="${(Math.max(w, h) / 90).toFixed(2)}" stroke-linejoin="round"/>`).join('');
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}">${body}</svg>`)}`;
}

/** what the hammer's wheel shows for each thing it does */
export function actionIcon(what: 'up' | 'remove' | 'rotate' | 'repair' | 'cancel' | 'lock', ink = '#e9e4d8'): string {
  const path = {
    lock: `<rect x="8" y="14" width="16" height="13" rx="2" fill="${ink}"/><path d="M11 14 V10 A5 5 0 0 1 21 10 V14" fill="none" stroke="${ink}" stroke-width="3"/>`,
    up: `<path d="M16 4 L28 18 L20 18 L20 28 L12 28 L12 18 L4 18 Z" fill="${ink}" stroke="#0b0d0b" stroke-width="1.2"/>`,
    remove: `<path d="M7 7 L25 25 M25 7 L7 25" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>`,
    rotate: `<path d="M24 16 A8 8 0 1 1 16 8" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/><path d="M14 2 L21 8 L14 13 Z" fill="${ink}"/>`,
    repair: `<path d="M8 24 L19 13 M18 6 A6 6 0 0 0 26 14 L22 10 Z" stroke="${ink}" stroke-width="4" stroke-linecap="round" fill="${ink}"/>`,
    cancel: `<circle cx="16" cy="16" r="10" fill="none" stroke="${ink}" stroke-width="3.5"/><path d="M9 23 L23 9" stroke="${ink}" stroke-width="3.5"/>`,
  }[what];
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${path}</svg>`)}`;
}
