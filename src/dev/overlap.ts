// Where two faces lie in one plane, facing the same way, over the same ground: the two are
// drawn turn and turn about and the wall flickers there ("z-fighting"). Given the pieces a
// thing is built of, this finds every such place. (scripts/overlap-audit.ts runs it over the
// buildings; in the page it can be run over anything that is drawn, the bunker for one.)

import * as THREE from 'three';

export interface Piece {
  /** what it is painted with: one name, or one for each of the shape's groups */
  key: string | string[];
  /** its shape, in the measure all the pieces share */
  geo: THREE.BufferGeometry;
}

export interface Overlap {
  /** how much of the two lies one in the other, m² */
  area: number;
  at: THREE.Vector3;
  /** the way both face */
  n: THREE.Vector3;
  a: string;
  b: string;
  /** how far apart the two planes are (0: the same plane) */
  gap: number;
  /** false where the two are of one paint whose pattern runs on unbroken from one to the other: whichever is drawn, the same is seen */
  shows: boolean;
}

interface Tri { p: THREE.Vector3[]; uv: THREE.Vector2[]; n: THREE.Vector3; d: number; piece: number; key: string; lo: THREE.Vector3; hi: THREE.Vector3 }

/** what is left of a polygon on the inner side of the line through a and b (all flat, in two numbers each) */
function clip(poly: number[][], a: number[], b: number[]) {
  const out: number[][] = [];
  const side = (p: number[]) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

function area(poly: number[][]) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1];
  return s / 2;
}

/** the paint's own place at a point of a triangle */
function uvAt(t: Tri, at: THREE.Vector3) {
  const bc = new THREE.Vector3();
  THREE.Triangle.getBarycoord(at, t.p[0], t.p[1], t.p[2], bc);
  return new THREE.Vector2().addScaledVector(t.uv[0], bc.x).addScaledVector(t.uv[1], bc.y).addScaledVector(t.uv[2], bc.z);
}

/**
 * Every place where a face of one piece lies in a face of another (or within `near` metres of
 * it), both facing the same way. Left out: what is buried (a finger's breadth out from the
 * face is inside one of the pieces: it is against a wall, or in one).
 */
export function overlaps(pieces: Piece[], near = 0): Overlap[] {
  const SAME = 0.0015, tol = Math.max(SAME, near);
  const tris: Tri[] = [];
  // each piece as a solid: the planes of its faces, and the box it lies in
  const solids: { planes: [THREE.Vector3, number][]; lo: THREE.Vector3; hi: THREE.Vector3 }[] = pieces.map(() => ({ planes: [], lo: new THREE.Vector3(1e9, 1e9, 1e9), hi: new THREE.Vector3(-1e9, -1e9, -1e9) }));
  pieces.forEach((q, k) => {
    const P = q.geo.getAttribute('position') as THREE.BufferAttribute, U = q.geo.getAttribute('uv') as THREE.BufferAttribute | undefined, I = q.geo.getIndex();
    const count = I ? I.count : P.count;
    for (let t = 0; t < count; t += 3) {
      const ix = [0, 1, 2].map((c) => (I ? I.getX(t + c) : t + c));
      const p = ix.map((i) => new THREE.Vector3().fromBufferAttribute(P, i));
      const n = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]));
      if (n.length() < 1e-7) continue;
      n.normalize();
      solids[k].planes.push([n, n.dot(p[0])]);
      for (const v of p) solids[k].lo.min(v), solids[k].hi.max(v);
      const key = typeof q.key === 'string' ? q.key : q.key[q.geo.groups.find((g) => t >= g.start && t < g.start + g.count)?.materialIndex ?? 0] ?? '';
      tris.push({ p, uv: ix.map((i) => (U ? new THREE.Vector2().fromBufferAttribute(U, i) : new THREE.Vector2())), n, d: n.dot(p[0]), piece: k, key, lo: p[0].clone().min(p[1]).min(p[2]), hi: p[0].clone().max(p[1]).max(p[2]) });
    }
  });
  const found = new Map<string, Overlap>();
  const rel = new THREE.Vector3();
  for (let i = 0; i < tris.length; i++) {
    const A = tris[i];
    const u = A.p[1].clone().sub(A.p[0]).normalize(), v = A.n.clone().cross(u);
    const flat = (p: THREE.Vector3) => [rel.copy(p).sub(A.p[0]).dot(u), rel.dot(v)];
    let a2: number[][] | null = null;
    for (let j = i + 1; j < tris.length; j++) {
      const T = tris[j];
      if (T.piece === A.piece || A.n.dot(T.n) < 0.9995) continue;
      const off = Math.abs(A.n.dot(T.p[0]) - A.d);
      if (off > tol) continue;
      if (T.lo.x > A.hi.x + tol || T.hi.x < A.lo.x - tol || T.lo.y > A.hi.y + tol || T.hi.y < A.lo.y - tol || T.lo.z > A.hi.z + tol || T.hi.z < A.lo.z - tol) continue;
      a2 ??= A.p.map(flat);
      let poly = T.p.map(flat);
      if (area(poly) < 0) poly.reverse();
      for (let e = 0; e < 3 && poly.length; e++) poly = clip(poly, a2[e], a2[(e + 1) % 3]);
      const ar = poly.length > 2 ? Math.abs(area(poly)) : 0;
      if (ar < 2e-5) continue;
      const c = poly.reduce((s, p) => [s[0] + p[0] / poly.length, s[1] + p[1] / poly.length], [0, 0]);
      const at = A.p[0].clone().addScaledVector(u, c[0]).addScaledVector(v, c[1]);
      // (one paint, and its pattern at the same place on both: nothing to see)
      let shows = A.key !== T.key;
      if (!shows) {
        const d = uvAt(A, at).sub(uvAt(T, at));
        shows = Math.abs(d.x - Math.round(d.x)) > 0.004 || Math.abs(d.y - Math.round(d.y)) > 0.004;
      }
      const id = `${Math.min(A.piece, T.piece)}:${Math.max(A.piece, T.piece)}:${[A.n.x, A.n.y, A.n.z].map((x) => Math.round(x * 20)).join(',')}`;
      const f = found.get(id);
      if (f) {
        f.at.multiplyScalar(f.area).addScaledVector(at, ar).divideScalar(f.area + ar);
        f.area += ar;
        f.shows ||= shows;
        f.gap = Math.max(f.gap, off);
      } else found.set(id, { area: ar, at, n: A.n.clone(), a: A.key, b: T.key, gap: off, shows });
    }
  }
  const buried = (at: THREE.Vector3, n: THREE.Vector3) => {
    const p = at.clone().addScaledVector(n, 0.004);
    return solids.some((s) => {
      if (p.x < s.lo.x || p.x > s.hi.x || p.y < s.lo.y || p.y > s.hi.y || p.z < s.lo.z || p.z > s.hi.z) return false;
      return s.planes.every(([pn, pd]) => pn.dot(p) - pd < 1e-4);
    });
  };
  return [...found.values()].filter((f) => f.area > 0.002 && !buried(f.at, f.n)).sort((p, q) => q.area - p.area);
}
