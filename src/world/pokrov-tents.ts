// The tented roofs over Pokrov's towers, as drawn (2026-10-23; the plan is src/sim/pokrov-towers.ts, TENT): the tent in
// painted iron with its seams running down it, boarded under; the board round its eave; the eight timber posts it stands
// on. Made in the buildings' own stuffs, all five towers in one shape a stuff. The little gilt onion on each point is
// one of the town's domes (`tentOnions`, drawn with the church's: src/world/domes.ts).

import * as THREE from 'three';
import { TENT, tentPosts, type TowerPlace } from '../sim/pokrov-towers';
import type { Dome } from './domes';

type Paint = { mat: THREE.Material; tile: number };

class Shape {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  tri(p: number[][], n: number[][], uv: number[][]) {
    for (let k = 0; k < 3; k++) this.pos.push(...p[k]), this.nrm.push(...n[k]), this.uv.push(...uv[k]);
  }
  /** a box standing on (x, y, z), w across and h high, its faces each a picture of its own size */
  post(x: number, y: number, z: number, w: number, h: number, tile: number) {
    const a = w / 2;
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ox = x + nx * a, oz = z + nz * a, sx = -nz * a, sz = nx * a, n = [nx, 0, nz];
      const c = [[ox - sx, y, oz - sz], [ox + sx, y, oz + sz], [ox + sx, y + h, oz + sz], [ox - sx, y + h, oz - sz]], u = [[0, 0], [w / tile, 0], [w / tile, h / tile], [0, h / tile]];
      this.tri([c[0], c[2], c[1]], [n, n, n], [u[0], u[2], u[1]]);
      this.tri([c[0], c[3], c[2]], [n, n, n], [u[0], u[3], u[2]]);
    }
  }
  mesh(paint: Paint, name: string) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, paint.mat);
    m.name = name;
    m.castShadow = m.receiveShadow = true;
    return m;
  }
}

/** every tower's tent, its boards and posts, and its onion */
export function tentRoofs(towers: TowerPlace[], iron: Paint, wood: Paint): THREE.Group {
  const g = new THREE.Group(), roof = new Shape(), boards = new Shape(), T = TENT, n = T.sides, slant = Math.hypot(T.r, T.rise);
  const arc = (2 * Math.PI * T.r) / n;
  for (const t of towers) {
    const y0 = t.foot + T.eave, apex = [t.x, y0 + T.rise, t.z];
    const rim = (a: number, r: number, y: number) => [t.x + Math.cos(a) * r, y, t.z + Math.sin(a) * r];
    // (the slope's normal: out and up as the tent leans)
    const out = (a: number, s: number) => { const l = Math.hypot(T.rise, T.r); return [(Math.cos(a) * T.rise * s) / l, (T.r * s) / l, (Math.sin(a) * T.rise * s) / l]; };
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * 2 * Math.PI, a1 = ((k + 1) / n) * 2 * Math.PI, am = (a0 + a1) / 2;
      const p0 = rim(a0, T.r, y0), p1 = rim(a1, T.r, y0);
      // the iron, its seams down the slope (the picture's ridges run along its height), and the boards under it
      roof.tri([p0, apex, p1], [out(a0, 1), out(am, 1), out(a1, 1)], [[0, 0], [(0.5 * arc) / iron.tile, slant / iron.tile], [arc / iron.tile, 0]]);
      const q0 = rim(a0, T.r, y0 - 0.06), q1 = rim(a1, T.r, y0 - 0.06), top = [apex[0], apex[1] - 0.06, apex[2]];
      boards.tri([q0, q1, top], [out(a0, -1), out(a1, -1), out(am, -1)], [[0, 0], [arc / wood.tile, 0], [(0.5 * arc) / wood.tile, slant / wood.tile]]);
      // the board round the eave, outside and in
      const b0 = rim(a0, T.r, y0 - T.fascia), b1 = rim(a1, T.r, y0 - T.fascia), u1 = arc / wood.tile, v1 = T.fascia / wood.tile;
      const no = [Math.cos(am), 0, Math.sin(am)], ni = [-no[0], 0, -no[2]];
      boards.tri([b0, p0, p1], [no, no, no], [[0, 0], [0, v1], [u1, v1]]);
      boards.tri([b0, p1, b1], [no, no, no], [[0, 0], [u1, v1], [u1, 0]]);
      boards.tri([b1, q0, b0], [ni, ni, ni], [[u1, 0], [0, v1], [0, 0]]);
      boards.tri([b1, q1, q0], [ni, ni, ni], [[u1, 0], [u1, v1], [0, v1]]);
    }
    for (const [x, y, z] of tentPosts(t)) boards.post(x, y, z, T.post, t.foot + T.eave - T.fascia - y, wood.tile);
  }
  g.add(roof.mesh(iron, 'Pokrov tower tents'), boards.mesh(wood, 'Pokrov tower tents boards'));
  return g;
}

/** the little gilt onion on each tent's point */
export const tentOnions = (towers: TowerPlace[]): Dome[] => towers.map((t) => ({ at: new THREE.Vector3(t.x, t.foot + TENT.eave + TENT.rise - 0.35, t.z), size: 0.17, gilt: true }));
